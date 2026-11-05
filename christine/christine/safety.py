"""Safety rules: protected locations and the two-step delete confirmation.

The confirmation is enforced here, in code, not by the AI model. The model can
ask for a deletion, but nothing is deleted until the person has answered YES
to two separate spoken (or typed) questions.
"""
from __future__ import annotations

import os
import re
from pathlib import Path
from typing import Callable

# A function that says something to the user and returns what they answered.
AskFn = Callable[[str], str]

NEGATIVE = re.compile(r"\b(no|nope|nah|cancel|stop|don'?t|do not|wait|never|abort|hold on)\b", re.I)
FIRST_YES = re.compile(r"\b(yes|yeah|yep|yup|sure|correct|go ahead|do it|confirm|affirmative|ok|okay)\b", re.I)
SECOND_YES = re.compile(r"\bconfirm(ed)?\b", re.I)


def _windows_protected() -> list[Path]:
    env = os.environ
    candidates = [
        env.get("SystemRoot", r"C:\Windows"),
        env.get("ProgramFiles", r"C:\Program Files"),
        env.get("ProgramFiles(x86)", r"C:\Program Files (x86)"),
        env.get("ProgramData", r"C:\ProgramData"),
        r"C:\Recovery",
        r"C:\System Volume Information",
        r"C:\$Recycle.Bin",
    ]
    return [Path(c) for c in candidates if c]


def protected_reason(path: Path) -> str | None:
    """Return why a path must never be deleted, or None if it is allowed."""
    try:
        p = path.resolve()
    except OSError:
        p = path.absolute()
    home = Path.home().resolve()

    if p == Path(p.anchor):
        return "it is the root of a drive"
    if p == home:
        return "it is your whole user folder"
    if p.parent == home and p.name in {
        "Desktop", "Documents", "Downloads", "Pictures", "Music", "Videos",
        "OneDrive", "AppData", "Contacts", "Favorites", "Links", "Saved Games",
    }:
        return f"it is your main {p.name} folder"
    if "appdata" in [part.lower() for part in p.parts]:
        return "it is inside AppData, where programs keep their settings"
    for prot in _windows_protected():
        try:
            prot = prot.resolve()
        except OSError:
            pass
        if p == prot or prot in p.parents:
            return f"it is part of Windows or installed programs ({prot})"
    for unix in (Path("/bin"), Path("/etc"), Path("/usr"), Path("/System"), Path("/Library")):
        if p == unix or unix in p.parents:
            return "it is a system folder"
    return None


def double_confirm(ask: AskFn, description: str, action_word: str = "delete") -> tuple[bool, str]:
    """Ask the user twice. Returns (approved, explanation).

    Question 1 needs a clear yes. Question 2 needs the word "confirm".
    Any "no"/"cancel"/"stop" at either step cancels.
    """
    first = ask(
        f"You asked me to {action_word} {description}. Are you sure? Please say yes or no."
    ).strip()
    if not first or NEGATIVE.search(first) or not FIRST_YES.search(first):
        return False, f"Cancelled at the first confirmation (user said: {first!r})."

    second = ask(
        f"Second confirmation. To {action_word} {description}, say: confirm {action_word}. "
        f"Say cancel to stop."
    ).strip()
    if not second or NEGATIVE.search(second) or not SECOND_YES.search(second):
        return False, f"Cancelled at the second confirmation (user said: {second!r})."
    return True, "Confirmed twice by the user."


def single_confirm(ask: AskFn, question: str) -> tuple[bool, str]:
    answer = ask(question).strip()
    if not answer or NEGATIVE.search(answer) or not FIRST_YES.search(answer):
        return False, f"Cancelled (user said: {answer!r})."
    return True, "Confirmed by the user."
