"""Settings for Christine.

Settings live in %APPDATA%\\Christine\\config.toml (created on first run) and
secrets in %APPDATA%\\Christine\\.env. Environment variables override both.
"""
from __future__ import annotations

import os
import sys
import tomllib
from dataclasses import dataclass, field
from pathlib import Path

DEFAULT_CONFIG = """\
# Christine settings. Edit and restart Christine to apply.

[assistant]
name = "Christine"
# Extra names the speech recogniser often hears instead of "Christine".
wake_aliases = ["christine", "kristine", "christina", "kristina", "christeen", "kristen", "christen"]
# After Christine answers, keep listening this many seconds for a follow-up
# without needing the wake word again.
follow_up_seconds = 8

[brain]
# The cloud model used for conversation and multi-step tasks.
# claude-opus-5-5 is the most capable. For cheaper long chats you can set
# "claude-sonnet-5-5" or "claude-haiku-5-5".
model = "claude-opus-5-5"
# low = fast and cheap replies, medium/high = more careful reasoning.
effort = "low"
# Optional offline fallback when there is no internet or no API key:
# install Ollama (https://ollama.com), run `ollama pull llama3.2`, and set
# this to the model name. Leave empty to disable.
ollama_model = ""

[voice]
# "edge" = natural Microsoft neural voices (free, needs internet)
# "system" = built-in Windows voice (works offline)
engine = "edge"
edge_voice = "en-US-AvaNeural"
# speaking speed for the edge voice, e.g. "+0%", "+10%", "-10%"
rate = "+0%"

[hearing]
# faster-whisper model size: tiny.en, base.en, small.en (bigger = more
# accurate but slower). base.en is a good start on most laptops.
whisper_model = "base.en"
# Microphone loudness needed to count as speech. Raise it in noisy rooms.
energy_threshold = 0.015
# Seconds of silence that end what you are saying.
silence_seconds = 1.0

[hotkeys]
talk = "ctrl+alt+c"
stop = "ctrl+alt+s"

[battery]
warn_at = [20, 10, 5]

[files]
# Folders Christine indexes so she can find your documents by voice.
# Empty means: Desktop, Documents, Downloads, Pictures, Music, Videos, OneDrive.
folders = []
"""


def app_dir() -> Path:
    base = os.environ.get("APPDATA") or str(Path.home() / ".config")
    path = Path(base) / "Christine"
    path.mkdir(parents=True, exist_ok=True)
    return path


def _load_env_file(path: Path) -> None:
    if not path.exists():
        return
    for line in path.read_text(encoding="utf-8").splitlines():
        line = line.strip()
        if not line or line.startswith("#") or "=" not in line:
            continue
        key, value = line.split("=", 1)
        os.environ.setdefault(key.strip(), value.strip().strip('"').strip("'"))


@dataclass
class Config:
    name: str = "Christine"
    wake_aliases: list[str] = field(default_factory=lambda: ["christine"])
    follow_up_seconds: float = 8
    model: str = "claude-opus-5-5"
    effort: str = "low"
    ollama_model: str = ""
    voice_engine: str = "edge"
    edge_voice: str = "en-US-AvaNeural"
    voice_rate: str = "+0%"
    whisper_model: str = "base.en"
    energy_threshold: float = 0.015
    silence_seconds: float = 1.0
    talk_hotkey: str = "ctrl+alt+c"
    stop_hotkey: str = "ctrl+alt+s"
    battery_warn_at: list[int] = field(default_factory=lambda: [20, 10, 5])
    index_folders: list[str] = field(default_factory=list)
    data_dir: Path = field(default_factory=app_dir)

    @property
    def has_api_key(self) -> bool:
        return bool(os.environ.get("ANTHROPIC_API_KEY") or os.environ.get("ANTHROPIC_AUTH_TOKEN"))

    def default_index_folders(self) -> list[Path]:
        if self.index_folders:
            return [Path(os.path.expandvars(p)).expanduser() for p in self.index_folders]
        home = Path.home()
        names = ["Desktop", "Documents", "Downloads", "Pictures", "Music", "Videos", "OneDrive"]
        found = [home / n for n in names if (home / n).exists()]
        # OneDrive often redirects Desktop/Documents.
        onedrive = os.environ.get("OneDrive")
        if onedrive and Path(onedrive).exists() and Path(onedrive) not in found:
            found.append(Path(onedrive))
        return found


def load_config(data_dir: Path | None = None) -> Config:
    data_dir = data_dir or app_dir()
    data_dir.mkdir(parents=True, exist_ok=True)
    _load_env_file(data_dir / ".env")
    cfg_path = data_dir / "config.toml"
    if not cfg_path.exists():
        cfg_path.write_text(DEFAULT_CONFIG, encoding="utf-8")
    try:
        raw = tomllib.loads(cfg_path.read_text(encoding="utf-8"))
    except tomllib.TOMLDecodeError as exc:
        print(f"[Christine] config.toml has an error ({exc}); using defaults.", file=sys.stderr)
        raw = tomllib.loads(DEFAULT_CONFIG)

    a, b, v = raw.get("assistant", {}), raw.get("brain", {}), raw.get("voice", {})
    h, k = raw.get("hearing", {}), raw.get("hotkeys", {})
    cfg = Config(
        name=a.get("name", "Christine"),
        wake_aliases=[w.lower() for w in a.get("wake_aliases", ["christine"])],
        follow_up_seconds=float(a.get("follow_up_seconds", 8)),
        model=os.environ.get("CHRISTINE_MODEL", b.get("model", "claude-opus-5-5")),
        effort=b.get("effort", "low"),
        ollama_model=b.get("ollama_model", ""),
        voice_engine=v.get("engine", "edge"),
        edge_voice=v.get("edge_voice", "en-US-AvaNeural"),
        voice_rate=v.get("rate", "+0%"),
        whisper_model=h.get("whisper_model", "base.en"),
        energy_threshold=float(h.get("energy_threshold", 0.015)),
        silence_seconds=float(h.get("silence_seconds", 1.0)),
        talk_hotkey=k.get("talk", "ctrl+alt+c"),
        stop_hotkey=k.get("stop", "ctrl+alt+s"),
        battery_warn_at=sorted((int(x) for x in raw.get("battery", {}).get("warn_at", [20, 10, 5])), reverse=True),
        index_folders=list(raw.get("files", {}).get("folders", [])),
        data_dir=data_dir,
    )
    return cfg
