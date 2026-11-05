"""Long-term memory: facts about the user, conversation summaries, an action log.

Everything is stored locally in %APPDATA%\\Christine\\memory.db (SQLite).
"""
from __future__ import annotations

import json
import sqlite3
import threading
from datetime import datetime
from pathlib import Path

SCHEMA = """
CREATE TABLE IF NOT EXISTS facts (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    text TEXT NOT NULL,
    category TEXT NOT NULL DEFAULT 'general',
    created TEXT NOT NULL
);
CREATE TABLE IF NOT EXISTS summaries (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    text TEXT NOT NULL,
    created TEXT NOT NULL
);
CREATE TABLE IF NOT EXISTS actions (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    kind TEXT NOT NULL,
    detail TEXT NOT NULL,
    created TEXT NOT NULL
);
CREATE TABLE IF NOT EXISTS kv (
    key TEXT PRIMARY KEY,
    value TEXT NOT NULL
);
"""


def _now() -> str:
    return datetime.now().isoformat(timespec="seconds")


class Memory:
    def __init__(self, path: Path):
        self.path = path
        self._lock = threading.Lock()
        self._db = sqlite3.connect(str(path), check_same_thread=False)
        self._db.row_factory = sqlite3.Row
        self._db.executescript(SCHEMA)
        self._db.commit()

    # ---- facts -------------------------------------------------------------
    def remember(self, text: str, category: str = "general") -> int:
        text = text.strip()
        with self._lock:
            existing = self._db.execute("SELECT id FROM facts WHERE lower(text)=lower(?)", (text,)).fetchone()
            if existing:
                return int(existing["id"])
            cur = self._db.execute(
                "INSERT INTO facts(text, category, created) VALUES (?,?,?)", (text, category or "general", _now())
            )
            self._db.commit()
            return int(cur.lastrowid)

    def recall(self, query: str = "", limit: int = 20) -> list[dict]:
        with self._lock:
            if not query.strip():
                rows = self._db.execute("SELECT * FROM facts ORDER BY id DESC LIMIT ?", (limit,)).fetchall()
            else:
                words = [w for w in query.lower().split() if len(w) > 2] or [query.lower()]
                clause = " OR ".join("lower(text) LIKE ?" for _ in words)
                rows = self._db.execute(
                    f"SELECT * FROM facts WHERE {clause} ORDER BY id DESC LIMIT ?",
                    [f"%{w}%" for w in words] + [limit],
                ).fetchall()
        return [dict(r) for r in rows]

    def get_fact(self, fact_id: int) -> dict | None:
        with self._lock:
            row = self._db.execute("SELECT * FROM facts WHERE id=?", (fact_id,)).fetchone()
        return dict(row) if row else None

    def forget(self, fact_id: int) -> bool:
        with self._lock:
            cur = self._db.execute("DELETE FROM facts WHERE id=?", (fact_id,))
            self._db.commit()
            return cur.rowcount > 0

    def all_facts(self, limit: int = 200) -> list[dict]:
        with self._lock:
            rows = self._db.execute("SELECT * FROM facts ORDER BY id LIMIT ?", (limit,)).fetchall()
        return [dict(r) for r in rows]

    # ---- conversation summaries -------------------------------------------
    def add_summary(self, text: str) -> None:
        with self._lock:
            self._db.execute("INSERT INTO summaries(text, created) VALUES (?,?)", (text.strip(), _now()))
            self._db.commit()

    def recent_summaries(self, limit: int = 5) -> list[dict]:
        with self._lock:
            rows = self._db.execute("SELECT * FROM summaries ORDER BY id DESC LIMIT ?", (limit,)).fetchall()
        return [dict(r) for r in reversed(rows)]

    # ---- action log --------------------------------------------------------
    def log_action(self, kind: str, detail: dict) -> None:
        with self._lock:
            self._db.execute(
                "INSERT INTO actions(kind, detail, created) VALUES (?,?,?)", (kind, json.dumps(detail), _now())
            )
            self._db.commit()

    def last_action(self, kind: str) -> dict | None:
        with self._lock:
            row = self._db.execute(
                "SELECT * FROM actions WHERE kind=? ORDER BY id DESC LIMIT 1", (kind,)
            ).fetchone()
        if not row:
            return None
        out = dict(row)
        out["detail"] = json.loads(out["detail"])
        return out

    # ---- small key/value store (bookmarks etc.) ---------------------------
    def set(self, key: str, value) -> None:
        with self._lock:
            self._db.execute("INSERT OR REPLACE INTO kv(key, value) VALUES (?,?)", (key, json.dumps(value)))
            self._db.commit()

    def get(self, key: str, default=None):
        with self._lock:
            row = self._db.execute("SELECT value FROM kv WHERE key=?", (key,)).fetchone()
        return json.loads(row["value"]) if row else default

    def profile_text(self) -> str:
        """Memory block placed in Christine's instructions at the start of a session."""
        facts = self.all_facts()
        summaries = self.recent_summaries()
        parts = []
        if facts:
            parts.append("Things you remember about the user (id: fact):\n" + "\n".join(
                f"- [{f['id']}] {f['text']}" for f in facts))
        if summaries:
            parts.append("Summaries of your recent conversations:\n" + "\n".join(
                f"- ({s['created'][:10]}) {s['text']}" for s in summaries))
        return "\n\n".join(parts) if parts else "You don't have any saved memories about the user yet."
