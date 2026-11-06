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


def setup_key(cfg) -> None:
    print("Christine uses Claude (by Anthropic) as her cloud brain.")
    print("Create an API key at https://console.anthropic.com/settings/keys and paste it below.")
    print("(Leave empty to skip; Christine will run in basic offline mode.)")
    key = ""
    for _ in range(3):
        raw = getpass.getpass("API key (hidden - paste with right-click, then press Enter): ")
        # Drop spaces, line breaks and hidden characters (e.g. from pressing Ctrl+V).
        key = "".join(c for c in raw if c.isprintable() and not c.isspace() and ord(c) < 128)
        if not raw.strip():
            print("Skipped.")
            return
        if key.startswith("sk-ant-") and len(key) > 40:
            if key != raw.strip():
                print("(Removed some hidden characters from what was pasted.)")
            break
        print(f"That doesn't look like an Anthropic key (it should start with sk-ant-; got "
              f"'{key[:7]}...', {len(key)} characters). Please try again.")
    else:
        print("Key not saved. Run install.bat again when you have the key ready.")
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
