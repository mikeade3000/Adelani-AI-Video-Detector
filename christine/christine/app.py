"""Christine's main loop: listen, understand, act, speak."""
from __future__ import annotations

import queue
import threading
import time

from .brain import Brain
from .config import Config
from .memory import Memory
from .monitor import BatteryMonitor
from .router import route
from .tools import ToolContext, load_all
from .tools.files import FileIndex
from .tools.web import BrowserTracker


class Christine:
    def __init__(self, config: Config, voice: bool = True):
        load_all()
        self.config = config
        self.voice = voice
        self.stop_event = threading.Event()
        self.announcements: queue.Queue[str] = queue.Queue()
        self.running = True
        self.armed_until = 0.0  # set by the talk hotkey or a follow-up window

        if voice:
            from .audio.listener import Listener
            from .audio.speaker import Speaker
            self.speaker = Speaker(config, self.stop_event)
            self.listener = Listener(config)
        else:
            from .audio.speaker import SilentSpeaker
            self.speaker = SilentSpeaker(config, self.stop_event)
            self.listener = None

        self.memory = Memory(config.data_dir / "memory.db")
        self.file_index = FileIndex(config.data_dir / "files.db", config.default_index_folders())
        self.ctx = ToolContext(
            config=config, memory=self.memory, ask=self.ask, say=self.speaker.say,
            speaker=self.speaker, file_index=self.file_index, stop_event=self.stop_event,
            browser=BrowserTracker(),
        )
        self.brain = Brain(config, self.ctx)

    # -------------------------------------------------------- input/output
    def ask(self, question: str) -> str:
        """Say a question and wait for the answer. Used by confirmations."""
        self.stop_event.clear()
        self.speaker.say(question)
        if not self.voice:
            try:
                return input("You: ")
            except EOFError:
                return ""
        for _ in range(2):
            answer = self.listener.listen(wait_seconds=10)
            if answer:
                print(f"You: {answer}")
                return answer
            self.speaker.say("Sorry, I didn't hear you. " + question)
        return ""

    def handle(self, text: str) -> None:
        self.stop_event.clear()
        kind, reply = route(text, self.ctx)
        if kind == "stop":
            self.speaker.stop()
            return
        if kind == "quit":
            self.speaker.say(reply)
            self.running = False
            return
        if kind == "sleep":
            self.armed_until = 0
            self.speaker.say(reply)
            return
        if kind == "handled":
            if reply:
                self.speaker.say(reply)
                self.brain.note(f"The user said {text!r} and you replied {reply!r}.")
            return
        reply = self.brain.chat(text)
        self.speaker.say(reply)

    def speak_announcements(self) -> None:
        while not self.announcements.empty():
            self.speaker.say(self.announcements.get_nowait())

    # ---------------------------------------------------------------- run
    def start_background(self) -> None:
        if self.file_index.count() == 0:
            print("[Christine] indexing your files for the first time (this can take a minute)...")
        self.file_index.start_background_refresh()
        BatteryMonitor(self.config.battery_warn_at, self.announcements).start()

    def greeting(self) -> str:
        hour = time.localtime().tm_hour
        part = "morning" if hour < 12 else "afternoon" if hour < 17 else "evening"
        hello = f"Good {part}! {self.config.name} here."
        if not self.brain.online:
            hello += " I don't have a cloud API key yet, so I'm in basic mode."
        if self.voice:
            hello += f" Say my name, or press {self.config.talk_hotkey.replace('+', ' ')}, whenever you need me."
        return hello

    def run_text(self) -> None:
        self.start_background()
        self.speaker.say(self.greeting())
        print("(Text mode: type to talk, 'exit' to quit.)")
        while self.running:
            self.speak_announcements()
            try:
                text = input("\nYou: ").strip()
            except (EOFError, KeyboardInterrupt):
                break
            if text:
                self.handle(text)
        self.shutdown()

    def run_voice(self) -> None:
        from .audio.listener import split_wake_word

        self.listener.load()
        self._register_hotkeys()
        self.start_background()
        self.speaker.say(self.greeting())
        while self.running:
            try:
                self.speak_announcements()
                heard = self.listener.listen(wait_seconds=5)
                if not heard:
                    continue
                woke, command = split_wake_word(heard, self.config.wake_aliases)
                armed = time.time() < self.armed_until
                if not (woke or armed):
                    continue  # not talking to Christine
                print(f"You: {heard}")
                if woke and not command:
                    self.speaker.say("Yes?")
                    command = self.listener.listen(wait_seconds=8)
                    if not command:
                        continue
                    print(f"You: {command}")
                self.handle(command if woke else heard)
                if self.running:
                    self.armed_until = time.time() + self.config.follow_up_seconds
            except KeyboardInterrupt:
                break
        self.shutdown()

    def _register_hotkeys(self) -> None:
        try:
            import keyboard
        except ImportError:
            return

        def talk():
            self.speaker.stop()
            self.armed_until = time.time() + 10
            print("[Christine] listening...")

        def stop():
            self.speaker.stop()

        try:
            keyboard.add_hotkey(self.config.talk_hotkey, talk)
            keyboard.add_hotkey(self.config.stop_hotkey, stop)
        except Exception as exc:
            print(f"[Christine] hotkeys unavailable: {exc}")

    def shutdown(self) -> None:
        print("[Christine] saving memories...")
        self.brain.summarise_session()
