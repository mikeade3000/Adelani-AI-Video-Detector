"""Open and close programs."""
from __future__ import annotations

import os
import subprocess
from pathlib import Path

import psutil
from rapidfuzz import fuzz, process

from ..safety import single_confirm
from . import IS_WINDOWS, S, tool

BUILT_IN = {
    "notepad": ["notepad.exe"], "calculator": ["calc.exe"], "paint": ["mspaint.exe"],
    "file explorer": ["explorer.exe"], "explorer": ["explorer.exe"], "task manager": ["taskmgr.exe"],
    "command prompt": ["cmd.exe"], "powershell": ["powershell.exe"],
    "settings": ["explorer.exe", "ms-settings:"], "control panel": ["control.exe"],
    "snipping tool": ["explorer.exe", "ms-screenclip:"], "camera": ["explorer.exe", "microsoft.windows.camera:"],
    "recycle bin": ["explorer.exe", "shell:RecycleBinFolder"],
    "downloads": ["explorer.exe", "shell:Downloads"], "documents": ["explorer.exe", "shell:Personal"],
    "bluetooth settings": ["explorer.exe", "ms-settings:bluetooth"],
    "wifi settings": ["explorer.exe", "ms-settings:network-wifi"],
    "battery settings": ["explorer.exe", "ms-settings:batterysaver"],
    "display settings": ["explorer.exe", "ms-settings:display"],
    "windows update": ["explorer.exe", "ms-settings:windowsupdate"],
}

PROTECTED_PROCESSES = {"explorer.exe", "csrss.exe", "winlogon.exe", "services.exe", "lsass.exe",
                       "svchost.exe", "system", "smss.exe", "wininit.exe", "dwm.exe", "python.exe",
                       "pythonw.exe", "christine.exe"}


def start_menu_shortcuts() -> dict[str, str]:
    roots = [
        Path(os.environ.get("ProgramData", r"C:\ProgramData")) / "Microsoft/Windows/Start Menu/Programs",
        Path(os.environ.get("APPDATA", "")) / "Microsoft/Windows/Start Menu/Programs",
    ]
    out: dict[str, str] = {}
    for root in roots:
        if not root.exists():
            continue
        for lnk in root.rglob("*.lnk"):
            name = lnk.stem.lower()
            if "uninstall" in name or "readme" in name:
                continue
            out.setdefault(name, str(lnk))
    return out


@tool("open_app",
      "Open a program installed on the computer (e.g. 'Word', 'Chrome', 'Spotify', 'Calculator', "
      "'Settings', 'Task Manager', 'Recycle Bin').",
      name=S("the program's name"))
def open_app(ctx, name: str) -> str:
    key = name.lower().strip()
    if key in BUILT_IN:
        if IS_WINDOWS:
            subprocess.Popen(BUILT_IN[key])
        return f"Opened {name}."
    if not IS_WINDOWS:
        return "Opening programs is only supported on Windows."
    shortcuts = start_menu_shortcuts()
    if not shortcuts:
        return "I couldn't read the Start Menu."
    match = process.extractOne(key, list(shortcuts), scorer=fuzz.WRatio)
    if not match or match[1] < 70:
        return f"I couldn't find a program called {name}."
    os.startfile(shortcuts[match[0]])  # type: ignore[attr-defined]
    return f"Opened {match[0]}."


@tool("list_running_apps", "List the programs currently running that have open windows or use the most memory.")
def list_running_apps(ctx) -> dict:
    names: dict[str, float] = {}
    for p in psutil.process_iter(["name", "memory_info"]):
        try:
            n = p.info["name"]
            if n and n.lower() not in PROTECTED_PROCESSES:
                names[n] = names.get(n, 0) + p.info["memory_info"].rss / 1e6
        except (psutil.Error, TypeError, AttributeError):
            continue
    top = sorted(names.items(), key=lambda x: -x[1])[:20]
    return {"programs": [{"name": n, "memory_mb": round(m)} for n, m in top]}


@tool("close_app",
      "Close a running program, e.g. 'Word' or 'chrome'. The app asks the user once to confirm, because "
      "unsaved work in that program could be lost.",
      name=S("program name or process name"))
def close_app(ctx, name: str) -> str:
    key = name.lower().strip().removesuffix(".exe")
    running = {}
    for p in psutil.process_iter(["name"]):
        n = (p.info.get("name") or "").lower()
        if n and n not in PROTECTED_PROCESSES:
            running.setdefault(n, []).append(p)
    if not running:
        return "I couldn't list running programs."
    aliases = {"word": "winword", "excel": "excel", "powerpoint": "powerpnt", "edge": "msedge",
               "chrome": "chrome", "teams": "ms-teams", "outlook": "outlook"}
    key = aliases.get(key, key)
    match = process.extractOne(key, list(running), scorer=fuzz.WRatio)
    if not match or match[1] < 75:
        return f"{name} doesn't seem to be running."
    pname = match[0]
    ok, why = single_confirm(ctx.ask, f"Close {pname.removesuffix('.exe')}? Any unsaved work in it may be lost. Yes or no?")
    if not ok:
        return f"Did not close it. {why}"
    procs = running[pname]
    for p in procs:
        try:
            p.terminate()
        except psutil.Error:
            pass
    _, alive = psutil.wait_procs(procs, timeout=5)
    return f"Closed {pname}." if not alive else f"Asked {pname} to close; {len(alive)} part(s) are still running."
