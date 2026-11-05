"""Christine's ears: microphone capture + speech-to-text (runs on your computer).

Speech recognition uses faster-whisper locally, so your voice is not sent to
the cloud just to be transcribed. Only the recognised text of commands meant
for Christine goes to the AI brain.
"""
from __future__ import annotations

import queue
import re
import time

import numpy as np

SAMPLE_RATE = 16000
BLOCK = 480  # 30 ms


class Listener:
    def __init__(self, config):
        self.config = config
        self.threshold = config.energy_threshold
        self._model = None

    def load(self) -> None:
        from faster_whisper import WhisperModel

        print(f"[Christine] loading speech model '{self.config.whisper_model}' (first run downloads it)...")
        self._model = WhisperModel(self.config.whisper_model, device="cpu", compute_type="int8")
        self.calibrate()

    def calibrate(self, seconds: float = 1.5) -> None:
        import sounddevice as sd

        audio = sd.rec(int(seconds * SAMPLE_RATE), samplerate=SAMPLE_RATE, channels=1, dtype="float32")
        sd.wait()
        ambient = float(np.sqrt(np.mean(audio ** 2)))
        self.threshold = max(self.config.energy_threshold, ambient * 3.0)
        print(f"[Christine] microphone ready (noise level {ambient:.4f}, speech threshold {self.threshold:.4f}).")

    def record_utterance(self, wait_seconds: float | None = None, max_seconds: float = 30.0) -> np.ndarray | None:
        """Wait for speech, then record until the speaker pauses."""
        import sounddevice as sd

        q: queue.Queue = queue.Queue()

        def callback(indata, frames, t, status):
            q.put(indata[:, 0].copy())

        pre_roll: list[np.ndarray] = []
        recorded: list[np.ndarray] = []
        started = False
        silence_blocks_needed = int(self.config.silence_seconds * SAMPLE_RATE / BLOCK)
        silent = 0
        t0 = time.time()
        with sd.InputStream(samplerate=SAMPLE_RATE, channels=1, dtype="float32", blocksize=BLOCK, callback=callback):
            while True:
                try:
                    block = q.get(timeout=0.5)
                except queue.Empty:
                    block = None
                if block is None:
                    if not started and wait_seconds is not None and time.time() - t0 > wait_seconds:
                        return None
                    continue
                loud = float(np.sqrt(np.mean(block ** 2))) > self.threshold
                if not started:
                    pre_roll.append(block)
                    pre_roll = pre_roll[-10:]  # keep 300 ms before speech starts
                    if loud:
                        started = True
                        recorded = list(pre_roll)
                        t_start = time.time()
                    elif wait_seconds is not None and time.time() - t0 > wait_seconds:
                        return None
                    continue
                recorded.append(block)
                silent = 0 if loud else silent + 1
                if silent >= silence_blocks_needed or time.time() - t_start > max_seconds:
                    break
        audio = np.concatenate(recorded)
        if len(audio) < SAMPLE_RATE * 0.4:  # under 0.4 s: a click or cough
            return None
        return audio

    def transcribe(self, audio: np.ndarray) -> str:
        segments, _ = self._model.transcribe(
            audio, language="en", beam_size=1, vad_filter=True,
            initial_prompt=f"{self.config.name}, open, delete, confirm, recycle bin, battery, website.",
        )
        return " ".join(s.text.strip() for s in segments).strip()

    def listen(self, wait_seconds: float | None = None) -> str:
        audio = self.record_utterance(wait_seconds)
        return self.transcribe(audio) if audio is not None else ""


def split_wake_word(text: str, aliases: list[str]) -> tuple[bool, str]:
    """If the text mentions Christine, return (True, the rest of the command)."""
    low = text.lower()
    for alias in sorted(aliases, key=len, reverse=True):
        m = re.search(rf"\b{re.escape(alias)}\b[\s,.!?]*", low)
        if m:
            rest = (text[:m.start()] + " " + text[m.end():]).strip(" ,.!?")
            rest = re.sub(r"^(hey|hi|hello|okay|ok|yo)\b[\s,]*", "", rest, flags=re.I).strip()
            return True, rest
    return False, text
