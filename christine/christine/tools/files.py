"""Find, open and delete files. Deleting always goes to the Recycle Bin and
always needs two confirmations from the user."""
from __future__ import annotations

import os
import sqlite3
import subprocess
import threading
import time
from datetime import datetime
from pathlib import Path

from rapidfuzz import fuzz

from ..safety import double_confirm, protected_reason
from . import IS_WINDOWS, I, S, tool

SKIP_DIRS = {"node_modules", ".git", "__pycache__", "$recycle.bin", "appdata", ".venv", "venv",
             "site-packages", ".cache", "temp", "tmp"}

KIND_EXT = {
    "document": {".pdf", ".doc", ".docx", ".txt", ".rtf", ".odt", ".md", ".pages"},
    "spreadsheet": {".xls", ".xlsx", ".csv", ".ods"},
    "presentation": {".ppt", ".pptx", ".odp", ".key"},
    "image": {".jpg", ".jpeg", ".png", ".gif", ".bmp", ".heic", ".webp", ".tiff"},
    "video": {".mp4", ".mkv", ".mov", ".avi", ".wmv", ".webm"},
    "audio": {".mp3", ".wav", ".m4a", ".flac", ".aac", ".ogg", ".wma"},
    "archive": {".zip", ".rar", ".7z", ".tar", ".gz"},
}


class FileIndex:
    """A small local index of file names so voice search is instant."""

    def __init__(self, db_path: Path, folders: list[Path]):
        self.folders = folders
        self.db_path = db_path
        self._lock = threading.Lock()
        self._db = sqlite3.connect(str(db_path), check_same_thread=False)
        self._db.execute(
            "CREATE TABLE IF NOT EXISTS files (path TEXT PRIMARY KEY, name TEXT, ext TEXT, "
            "is_dir INTEGER, modified REAL, size INTEGER)")
        self._db.execute("CREATE INDEX IF NOT EXISTS idx_name ON files(name)")
        self._db.commit()
        self.ready = threading.Event()
        if self.count() > 0:
            self.ready.set()

    def count(self) -> int:
        with self._lock:
            return self._db.execute("SELECT COUNT(*) FROM files").fetchone()[0]

    def rebuild(self) -> int:
        rows = []
        for root_folder in self.folders:
            for dirpath, dirnames, filenames in os.walk(root_folder, onerror=lambda e: None):
                dirnames[:] = [d for d in dirnames if d.lower() not in SKIP_DIRS and not d.startswith(".")]
                for d in dirnames:
                    p = os.path.join(dirpath, d)
                    rows.append((p, d.lower(), "", 1, _mtime(p), 0))
                for f in filenames:
                    if f.startswith("~$") or f.lower() in ("desktop.ini", "thumbs.db"):
                        continue
                    p = os.path.join(dirpath, f)
                    try:
                        st = os.stat(p)
                    except OSError:
                        continue
                    rows.append((p, f.lower(), os.path.splitext(f)[1].lower(), 0, st.st_mtime, st.st_size))
        with self._lock:
            self._db.execute("DELETE FROM files")
            self._db.executemany("INSERT OR REPLACE INTO files VALUES (?,?,?,?,?,?)", rows)
            self._db.commit()
        self.ready.set()
        return len(rows)

    def start_background_refresh(self, every_minutes: int = 30) -> None:
        def loop():
            while True:
                try:
                    self.rebuild()
                except Exception as exc:
                    print(f"[Christine] file index refresh failed: {exc}")
                time.sleep(every_minutes * 60)
        threading.Thread(target=loop, daemon=True, name="file-index").start()

    def search(self, query: str, kind: str = "any", limit: int = 8) -> list[dict]:
        q = query.lower().strip()
        words = [w for w in q.replace("_", " ").replace("-", " ").split() if w]
        exts = KIND_EXT.get(kind.lower().strip())
        sql = "SELECT path, name, ext, is_dir, modified, size FROM files"
        params: list = []
        where = []
        if kind.lower().strip() == "folder":
            where.append("is_dir=1")
        elif exts:
            where.append(f"ext IN ({','.join('?' * len(exts))})")
            params += sorted(exts)
        if words:
            # Pre-filter: name contains at least one word; then rank with fuzzy matching.
            where.append("(" + " OR ".join("name LIKE ?" for _ in words) + ")")
            params += [f"%{w}%" for w in words]
        if where:
            sql += " WHERE " + " AND ".join(where)
        sql += " LIMIT 5000"
        with self._lock:
            rows = self._db.execute(sql, params).fetchall()
        scored = []
        for path, name, ext, is_dir, modified, size in rows:
            stem = os.path.splitext(name)[0] if not is_dir else name
            score = max(fuzz.token_set_ratio(q, stem), fuzz.partial_ratio(q, stem)) if q else 50
            score += min(10, max(0, 10 - (time.time() - (modified or 0)) / 86400 / 30))  # newer is better
            scored.append((score, path, is_dir, modified, size))
        scored.sort(reverse=True)
        return [
            {"path": p, "type": "folder" if d else "file",
             "modified": datetime.fromtimestamp(m).strftime("%Y-%m-%d %H:%M") if m else None,
             "size_kb": round(s / 1024) if s else None}
            for _, p, d, m, s in scored[:limit] if os.path.exists(p)
        ]

    def recent(self, kind: str = "any", limit: int = 8) -> list[dict]:
        exts = KIND_EXT.get(kind.lower().strip())
        sql = "SELECT path, modified FROM files WHERE is_dir=0"
        params: list = []
        if exts:
            sql += f" AND ext IN ({','.join('?' * len(exts))})"
            params += sorted(exts)
        sql += " ORDER BY modified DESC LIMIT ?"
        params.append(limit)
        with self._lock:
            rows = self._db.execute(sql, params).fetchall()
        return [{"path": p, "modified": datetime.fromtimestamp(m).strftime("%Y-%m-%d %H:%M")} for p, m in rows]

    def forget_path(self, path: str) -> None:
        with self._lock:
            self._db.execute("DELETE FROM files WHERE path=? OR path LIKE ?", (path, path.rstrip("\\/") + os.sep + "%"))
            self._db.commit()


def _mtime(p: str) -> float:
    try:
        return os.path.getmtime(p)
    except OSError:
        return 0.0


def open_with_default_app(path: str) -> None:
    if IS_WINDOWS:
        os.startfile(path)  # type: ignore[attr-defined]
    else:
        subprocess.Popen(["xdg-open", path])


def _describe(p: Path) -> str:
    kind = "the folder" if p.is_dir() else "the file"
    return f"{kind} {p.name}, in {p.parent}"


# ---------------------------------------------------------------- tools ----

@tool("find_files",
      "Search the user's indexed folders (Desktop, Documents, Downloads, Pictures, Music, Videos, OneDrive) "
      "for files or folders by name. kind is one of: any, document, spreadsheet, presentation, image, video, "
      "audio, archive, folder. Returns the best matches with full paths.",
      query=S("words from the file or folder name, e.g. 'tax return 2025'"),
      kind=S("any, document, spreadsheet, presentation, image, video, audio, archive or folder"),
      limit=I("how many results, 1-20"))
def find_files(ctx, query: str, kind: str, limit: int) -> dict:
    idx = ctx.file_index
    if idx is None:
        return {"error": "File index is not available."}
    if not idx.ready.is_set():
        idx.ready.wait(timeout=20)
        if not idx.ready.is_set():
            return {"note": "I'm still indexing your files for the first time. Try again in a minute.", "results": []}
    results = idx.search(query, kind, max(1, min(20, limit)))
    return {"results": results, "searched": [str(f) for f in idx.folders]}


@tool("recent_files",
      "List the files the user changed most recently. kind as in find_files.",
      kind=S("any, document, spreadsheet, presentation, image, video, audio or archive"),
      limit=I("how many, 1-20"))
def recent_files(ctx, kind: str, limit: int) -> dict:
    return {"results": ctx.file_index.recent(kind, max(1, min(20, limit)))}


@tool("open_path",
      "Open a file with its default program, or open a folder in File Explorer. Needs the full path "
      "(use find_files first if you only know the name).",
      path=S("full path of the file or folder"))
def open_path(ctx, path: str) -> str:
    p = Path(os.path.expandvars(path)).expanduser()
    if not p.exists():
        return f"Nothing exists at {p}."
    open_with_default_app(str(p))
    return f"Opened {p}."


@tool("show_in_folder", "Open File Explorer with this file selected, so the user can see where it is stored.",
      path=S("full path of the file"))
def show_in_folder(ctx, path: str) -> str:
    p = Path(path)
    if not p.exists():
        return f"Nothing exists at {p}."
    if IS_WINDOWS:
        subprocess.Popen(["explorer", "/select,", str(p)])
    else:
        open_with_default_app(str(p.parent))
    return f"Showing {p.name} in {p.parent}."


@tool("delete_path",
      "Move a file or folder to the Recycle Bin. The app itself asks the user TWO confirmation questions "
      "before anything happens, so call this directly once you know the exact full path; do not ask the "
      "user to confirm yourself first. Never permanently deletes. Refuses system and main user folders.",
      path=S("full path of the file or folder to delete"))
def delete_path(ctx, path: str) -> str:
    from send2trash import send2trash

    p = Path(os.path.expandvars(path)).expanduser()
    if not p.exists():
        return f"Nothing exists at {p}, so there is nothing to delete."
    reason = protected_reason(p)
    if reason:
        return f"Refused: I will never delete {p} because {reason}."

    approved, why = double_confirm(ctx.ask, _describe(p))
    if not approved:
        return f"Not deleted. {why}"
    send2trash(str(p))
    ctx.memory.log_action("delete", {"path": str(p), "name": p.name})
    if ctx.file_index:
        ctx.file_index.forget_path(str(p))
    return f"Moved {p} to the Recycle Bin. ({why}) It can be restored from the Recycle Bin."
