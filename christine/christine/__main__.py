"""Start Christine.

    python -m christine            voice mode (microphone + speakers)
    python -m christine --text     type instead of talking (good for testing)
    python -m christine --setup    enter or change your Claude API key
    python -m christine --check    test the API key and the connection to Claude
"""
from __future__ import annotations

import argparse
import getpass
import sys

from .config import load_config


def _clean_key(raw: str) -> str:
    # Drop spaces, line breaks and hidden characters (e.g. from pressing Ctrl+V).
    return "".join(c for c in raw if c.isprintable() and not c.isspace() and ord(c) < 128)


def _looks_like_key(key: str) -> bool:
    return key.startswith("sk-ant-") and len(key) > 40


def _clipboard_text() -> str:
    try:
        import tkinter
        root = tkinter.Tk()
        root.withdraw()
        try:
            return root.clipboard_get()
        finally:
            root.destroy()
    except Exception:
        return ""


def setup_key(cfg) -> None:
    print("Christine uses Claude (by Anthropic) as her cloud brain.")
    print("1. Open https://console.anthropic.com/settings/keys and create a key.")
    print("2. Click the copy button next to the key.")
    print("3. Come back here and just press Enter - Christine reads the key from your clipboard.")
    print("   (Or paste it with RIGHT-CLICK, then press Enter. Ctrl+V does not work here.)")
    print("   Type 'skip' to continue without a key (basic offline mode).")
    import os
    existing = _clean_key(os.environ.get("ANTHROPIC_API_KEY", ""))
    if _looks_like_key(existing):
        print(f"   A key is already saved ({existing[:10]}...). Press Enter to keep it, or copy a new one first.")
    key = ""
    for _ in range(3):
        raw = getpass.getpass("Press Enter to use the copied key (input is hidden): ")
        if raw.strip().lower() == "skip":
            print("Skipped. You can add the key later with the 'Christine - set API key' shortcut.")
            return
        key = _clean_key(raw)
        if not _looks_like_key(key):
            clip = _clean_key(_clipboard_text())
            if _looks_like_key(clip):
                key = clip
                print(f"Found the key on your clipboard ({key[:10]}..., {len(key)} characters).")
        if not _looks_like_key(key) and not raw.strip() and _looks_like_key(existing):
            print("Keeping the key that is already saved.")
            return
        if _looks_like_key(key):
            break
        print("I couldn't find an Anthropic key (it starts with sk-ant-). Copy it again and press Enter.")
    else:
        print("Key not saved. Run the 'Christine - set API key' shortcut when you have it ready.")
        return
    env_path = cfg.data_dir / ".env"
    lines = []
    if env_path.exists():
        lines = [l for l in env_path.read_text(encoding="utf-8").splitlines() if not l.startswith("ANTHROPIC_API_KEY=")]
    lines.append(f"ANTHROPIC_API_KEY={key}")
    env_path.write_text("\n".join(lines) + "\n", encoding="utf-8")
    print(f"Saved to {env_path}. Settings file: {cfg.data_dir / 'config.toml'}")


def main(argv: list[str] | None = None) -> int:
    parser = argparse.ArgumentParser(prog="christine", description="Christine, your voice assistant.")
    parser.add_argument("--text", action="store_true", help="type instead of talking")
    parser.add_argument("--setup", action="store_true", help="enter your Claude API key")
    parser.add_argument("--check", action="store_true", help="test the connection to Claude")
    args = parser.parse_args(argv)

    cfg = load_config()
    if args.setup:
        setup_key(cfg)
        return 0
    if args.check:
        from .diagnose import run
        run(cfg)
        return 0

    from .app import Christine

    if args.text:
        Christine(cfg, voice=False).run_text()
        return 0
    try:
        app = Christine(cfg, voice=True)
    except ImportError as exc:
        print(f"Voice libraries are missing ({exc}). Run install.bat again, or use --text mode.")
        return 1
    app.run_voice()
    return 0


if __name__ == "__main__":
    sys.exit(main())
