"""Singing and music."""
from __future__ import annotations

import os
import random
from pathlib import Path

from rapidfuzz import fuzz

from . import S, tool

AUDIO_EXT = {".mp3", ".wav", ".m4a", ".flac", ".aac", ".ogg", ".wma"}

# A simple melody: pitch offsets (Hz) and speeds cycled line by line, which
# turns the speaking voice into a sing-song performance.
MELODY = [("+0Hz", "-8%"), ("+18Hz", "-12%"), ("+30Hz", "-15%"), ("+12Hz", "-10%"),
          ("+0Hz", "-8%"), ("+22Hz", "-14%"), ("-6Hz", "-18%"), ("+8Hz", "-20%")]


@tool("sing_song",
      "Sing a short song to the user. Write the lyrics yourself (4-12 short, rhyming lines, separated by "
      "newlines) about whatever fits: the user's mood, the state of their computer, a joke. Christine "
      "performs them in a sing-song voice.",
      title=S("song title"),
      lyrics=S("the lyrics, one line per row, separated by newlines"))
def sing_song(ctx, title: str, lyrics: str) -> str:
    lines = [l.strip() for l in lyrics.splitlines() if l.strip()]
    if not lines:
        return "No lyrics given."
    speaker = ctx.speaker
    ctx.stop_event.clear()
    if speaker is None or not hasattr(speaker, "sing_line"):
        for line in lines:
            ctx.say(line)
        return f"Sang '{title}' (plain voice)."
    speaker.say(f"This one's called: {title}!")
    for n, line in enumerate(lines):
        if ctx.stop_event.is_set():
            return f"Stopped singing '{title}'."
        pitch, rate = MELODY[n % len(MELODY)]
        speaker.sing_line(line, pitch=pitch, rate=rate)
    return f"Sang '{title}', {len(lines)} lines."


def music_files(ctx) -> list[Path]:
    folders = [Path.home() / "Music"]
    if ctx.file_index:
        folders = [f for f in ctx.file_index.folders] or folders
    out = []
    for folder in folders:
        if not folder.exists():
            continue
        for root, _, files in os.walk(folder):
            for f in files:
                if os.path.splitext(f)[1].lower() in AUDIO_EXT:
                    out.append(Path(root) / f)
            if len(out) > 5000:
                return out
    return out


@tool("play_music",
      "Play a song from the user's own music files. query can be a song or artist name, or 'anything' "
      "for a random song. Opens it in the default music player.",
      query=S("song or artist name, or 'anything'"))
def play_music(ctx, query: str) -> str:
    from .files import open_with_default_app

    files = music_files(ctx)
    if not files:
        return "I couldn't find any music files on this computer. I can sing for you instead!"
    q = query.lower().strip()
    if q in ("", "anything", "any", "random", "something"):
        choice = random.choice(files)
    else:
        scored = sorted(files, key=lambda p: fuzz.token_set_ratio(q, p.stem.lower()), reverse=True)
        choice = scored[0]
        if fuzz.token_set_ratio(q, choice.stem.lower()) < 55:
            return f"I didn't find a song matching '{query}'."
    open_with_default_app(str(choice))
    return f"Playing {choice.stem}."
