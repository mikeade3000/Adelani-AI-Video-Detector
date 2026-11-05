"""Look inside the Windows Recycle Bin and restore items from it."""
from __future__ import annotations

import os

from rapidfuzz import fuzz

from . import IS_WINDOWS, I, S, tool

RECYCLE_BIN = 10  # Shell special folder id (CSIDL_BITBUCKET)


def _bin():
    import pythoncom
    import win32com.client

    pythoncom.CoInitialize()
    shell = win32com.client.Dispatch("Shell.Application")
    return shell.NameSpace(RECYCLE_BIN)


def _items():
    folder = _bin()
    out = []
    for item in folder.Items():
        try:
            original_dir = folder.GetDetailsOf(item, 1)   # "Original Location"
            deleted_on = folder.GetDetailsOf(item, 2)     # "Date Deleted"
        except Exception:
            original_dir, deleted_on = "", ""
        out.append({"item": item, "name": item.Name, "original_folder": original_dir,
                    "deleted_on": _clean(deleted_on)})
    return out


def _clean(s: str) -> str:
    # Explorer puts invisible direction marks in dates.
    return "".join(ch for ch in s if ch.isprintable() and ch not in "‎‏")


def _restore(item) -> bool:
    try:
        item.InvokeVerb("undelete")   # canonical verb, works on any Windows language
        return True
    except Exception:
        pass
    for verb in item.Verbs():
        label = verb.Name.replace("&", "").lower()
        if label in ("restore", "undelete"):
            verb.DoIt()
            return True
    return False


def find_in_bin(name: str, limit: int = 10) -> list[dict]:
    q = name.lower().strip()
    scored = []
    for entry in _items():
        score = max(fuzz.token_set_ratio(q, entry["name"].lower()), fuzz.partial_ratio(q, entry["name"].lower())) if q else 50
        scored.append((score, entry))
    scored.sort(key=lambda x: x[0], reverse=True)
    return [e for s, e in scored[:limit] if s >= (60 if q else 0)]


@tool("list_recycle_bin",
      "List what is in the Recycle Bin, optionally filtered by name. Use an empty query to list the newest items.",
      query=S("part of the name to look for, or empty"),
      limit=I("how many items, 1-30"))
def list_recycle_bin(ctx, query: str, limit: int) -> dict:
    if not IS_WINDOWS:
        return {"error": "The Recycle Bin is only available on Windows."}
    entries = find_in_bin(query, max(1, min(30, limit))) if query.strip() else _items()[-limit:]
    return {"items": [{k: v for k, v in e.items() if k != "item"} for e in entries],
            "total_in_bin": len(_items())}


@tool("restore_from_recycle_bin",
      "Bring a deleted file or folder back from the Recycle Bin to where it was originally. "
      "Give the item's name exactly as listed by list_recycle_bin, plus its original_folder if several "
      "items share the name (or empty).",
      name=S("name of the item in the Recycle Bin"),
      original_folder=S("the item's original folder, or empty if the name is unique"))
def restore_from_recycle_bin(ctx, name: str, original_folder: str) -> str:
    if not IS_WINDOWS:
        return "The Recycle Bin is only available on Windows."
    # Explorer may hide file extensions, so "report" and "report.docx" both count as a match.
    wanted = {name.lower().strip(), os.path.splitext(name.lower().strip())[0]}
    matches = [e for e in _items()
               if e["name"].lower() in wanted or os.path.splitext(e["name"].lower())[0] in wanted]
    if original_folder.strip():
        matches = [e for e in matches if e["original_folder"].lower().rstrip("\\") ==
                   original_folder.lower().strip().rstrip("\\")] or matches
    if not matches:
        close = find_in_bin(name, 5)
        if not close:
            return f"I couldn't find '{name}' in the Recycle Bin."
        return "No exact match. Closest items: " + "; ".join(
            f"{e['name']} (from {e['original_folder']}, deleted {e['deleted_on']})" for e in close)
    if len(matches) > 1:
        return "Several items have that name: " + "; ".join(
            f"{e['name']} from {e['original_folder']} (deleted {e['deleted_on']})" for e in matches) + \
            ". Ask which one, then call again with original_folder."
    entry = matches[0]
    if not _restore(entry["item"]):
        return "Windows didn't let me restore that item."
    target = os.path.join(entry["original_folder"], entry["name"])
    ctx.memory.log_action("restore", {"path": target})
    return f"Restored {entry['name']} to {entry['original_folder']}."


@tool("undo_last_delete",
      "Restore the most recent item Christine deleted, from the Recycle Bin.")
def undo_last_delete(ctx) -> str:
    last = ctx.memory.last_action("delete")
    if not last:
        return "I haven't deleted anything that I can undo."
    path = last["detail"]["path"]
    if os.path.exists(path):
        return f"{path} is already back in place."
    return restore_from_recycle_bin(ctx, os.path.basename(path), os.path.dirname(path))
