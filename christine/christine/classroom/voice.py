"""Make speech audio for the projector page, with word timings for live captions.

The classroom plays audio in the browser on the projector, so the avatar's
mouth can move with the real sound. If the online voice is unavailable, the
page falls back to the browser's built-in voice.
"""
from __future__ import annotations

import asyncio
import re


def split_for_speech(text: str, max_chars: int = 320) -> list[str]:
    """Split a script into short chunks at sentence boundaries."""
    text = " ".join(text.split())
    sentences = re.split(r"(?<=[.!?])\s+", text)
    chunks, buf = [], ""
    for s in sentences:
        if buf and len(buf) + len(s) + 1 > max_chars:
            chunks.append(buf)
            buf = s
        else:
            buf = f"{buf} {s}".strip()
    if buf:
        chunks.append(buf)
    return chunks


def synthesize(text: str, voice: str, rate: str = "-5%") -> tuple[bytes, list[dict]]:
    """Return (mp3 bytes, [{"t": start_ms, "w": word}]). Raises if the voice service can't be reached."""
    import edge_tts

    async def run():
        comm = edge_tts.Communicate(text, voice, rate=rate, boundary="WordBoundary")
        audio, words = bytearray(), []
        async for chunk in comm.stream():
            if chunk["type"] == "audio":
                audio.extend(chunk["data"])
            elif chunk["type"] == "WordBoundary":
                words.append({"t": int(chunk["offset"] / 10_000), "w": chunk["text"]})  # 100 ns -> ms
        return bytes(audio), words

    audio, words = asyncio.run(run())
    if not audio:
        raise RuntimeError("no audio returned")
    return audio, words
