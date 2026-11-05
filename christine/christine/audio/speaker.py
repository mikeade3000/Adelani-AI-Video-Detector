"""Christine's voice.

"edge" uses Microsoft's free neural voices (needs internet) and falls back to
the built-in Windows voice when offline. "system" always uses the built-in voice.
"""
from __future__ import annotations

import asyncio
import io
import re
import threading
import time


def _clean_for_speech(text: str) -> str:
    text = re.sub(r"```.*?```", " ", text, flags=re.S)        # drop code blocks
    text = re.sub(r"[*_#`>|]", "", text)                        # markdown symbols
    text = re.sub(r"https?://\S+", "the link", text)
    return " ".join(text.split())


class Speaker:
    def __init__(self, config, stop_event: threading.Event | None = None, echo: bool = True):
        self.config = config
        self.stop_event = stop_event or threading.Event()
        self.echo = echo
        self._lock = threading.Lock()
        self._pygame_ready = False
        self._sapi = None
        self.speaking = threading.Event()

    # ------------------------------------------------------------------ api
    def say(self, text: str) -> None:
        self._speak(text, rate=self.config.voice_rate, pitch="+0Hz")

    def sing_line(self, text: str, pitch: str, rate: str) -> None:
        self._speak(text, rate=rate, pitch=pitch, prefix="♪ ")

    def stop(self) -> None:
        self.stop_event.set()
        try:
            if self._pygame_ready:
                import pygame
                pygame.mixer.music.stop()
            if self._sapi is not None:
                self._sapi.stop()
        except Exception:
            pass

    # ------------------------------------------------------------- internals
    def _speak(self, text: str, rate: str, pitch: str, prefix: str = "") -> None:
        text = _clean_for_speech(text)
        if not text:
            return
        if self.echo:
            print(f"\n{self.config.name}: {prefix}{text}", flush=True)
        with self._lock:
            self.speaking.set()
            try:
                if self.config.voice_engine == "edge":
                    try:
                        audio = self._edge_audio(text, rate, pitch)
                        self._play_mp3(audio)
                        return
                    except Exception as exc:
                        print(f"[Christine] online voice unavailable ({exc}); using the Windows voice.")
                self._system_say(text)
            finally:
                self.speaking.clear()

    def _edge_audio(self, text: str, rate: str, pitch: str) -> bytes:
        import edge_tts

        async def run() -> bytes:
            comm = edge_tts.Communicate(text, self.config.edge_voice, rate=rate, pitch=pitch)
            buf = bytearray()
            async for chunk in comm.stream():
                if chunk["type"] == "audio":
                    buf.extend(chunk["data"])
            return bytes(buf)

        audio = asyncio.run(run())
        if not audio:
            raise RuntimeError("no audio returned")
        return audio

    def _play_mp3(self, audio: bytes) -> None:
        import pygame

        if not self._pygame_ready:
            pygame.mixer.init()
            self._pygame_ready = True
        pygame.mixer.music.load(io.BytesIO(audio), "mp3")
        pygame.mixer.music.play()
        while pygame.mixer.music.get_busy():
            if self.stop_event.is_set():
                pygame.mixer.music.stop()
                break
            time.sleep(0.05)

    def _system_say(self, text: str) -> None:
        try:
            import pyttsx3
        except ImportError:
            return  # text was already printed
        if self._sapi is None:
            self._sapi = pyttsx3.init()
            for v in self._sapi.getProperty("voices"):
                if any(n in (v.name or "").lower() for n in ("zira", "female", "hazel", "susan")):
                    self._sapi.setProperty("voice", v.id)
                    break
        self._sapi.say(text)
        self._sapi.runAndWait()


class SilentSpeaker(Speaker):
    """Prints instead of speaking (text mode and tests)."""

    def _speak(self, text: str, rate: str, pitch: str, prefix: str = "") -> None:
        text = _clean_for_speech(text)
        if text and self.echo:
            print(f"\n{self.config.name}: {prefix}{text}", flush=True)
