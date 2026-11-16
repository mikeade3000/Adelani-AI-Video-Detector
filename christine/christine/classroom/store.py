"""Lessons on disk, and the class records (students, questions, quiz answers) in SQLite."""
from __future__ import annotations

import json
import re
import secrets
import sqlite3
import threading
from datetime import datetime
from pathlib import Path

from .models import LessonPlan

SCHEMA = """
CREATE TABLE IF NOT EXISTS students (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    lesson_id TEXT NOT NULL,
    name TEXT NOT NULL,
    matric TEXT NOT NULL,
    token TEXT NOT NULL UNIQUE,
    joined TEXT NOT NULL,
    UNIQUE(lesson_id, matric)
);
CREATE TABLE IF NOT EXISTS questions (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    lesson_id TEXT NOT NULL,
    student_id INTEGER NOT NULL,
    text TEXT NOT NULL,
    status TEXT NOT NULL DEFAULT 'pending',   -- pending, answered, hidden, skipped
    answer TEXT NOT NULL DEFAULT '',
    section INTEGER NOT NULL DEFAULT 0,
    asked TEXT NOT NULL
);
CREATE TABLE IF NOT EXISTS responses (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    lesson_id TEXT NOT NULL,
    student_id INTEGER NOT NULL,
    kind TEXT NOT NULL,          -- mcq or short
    qindex INTEGER NOT NULL,
    answer TEXT NOT NULL,
    score REAL,
    max_score REAL NOT NULL,
    feedback TEXT NOT NULL DEFAULT '',
    marked_by TEXT NOT NULL DEFAULT '',   -- auto, christine, lecturer
    UNIQUE(lesson_id, student_id, kind, qindex)
);
"""


def _now() -> str:
    return datetime.now().isoformat(timespec="seconds")


def slugify(text: str) -> str:
    s = re.sub(r"[^a-z0-9]+", "-", text.lower()).strip("-")
    return s[:40] or "lesson"


class Store:
    def __init__(self, root: Path):
        self.root = root
        self.root.mkdir(parents=True, exist_ok=True)
        self._lock = threading.Lock()
        self._db = sqlite3.connect(str(root / "classroom.db"), check_same_thread=False)
        self._db.row_factory = sqlite3.Row
        self._db.executescript(SCHEMA)
        self._db.commit()

    # ------------------------------------------------------------ lessons
    def lesson_dir(self, lesson_id: str) -> Path:
        if not re.fullmatch(r"[a-z0-9-]+", lesson_id):
            raise ValueError("bad lesson id")
        return self.root / "lessons" / lesson_id

    def create_lesson(self, title: str, course_code: str, level: str) -> str:
        base = slugify(f"{course_code} {title}")
        lesson_id = f"{base}-{secrets.token_hex(2)}"
        d = self.lesson_dir(lesson_id)
        (d / "uploads").mkdir(parents=True)
        self.save_meta(lesson_id, {"id": lesson_id, "title": title, "course_code": course_code, "level": level,
                                   "status": "new", "created": _now(), "log": []})
        return lesson_id

    def meta(self, lesson_id: str) -> dict:
        return json.loads((self.lesson_dir(lesson_id) / "meta.json").read_text(encoding="utf-8"))

    def save_meta(self, lesson_id: str, meta: dict) -> None:
        path = self.lesson_dir(lesson_id) / "meta.json"
        tmp = path.with_suffix(".tmp")
        tmp.write_text(json.dumps(meta, indent=2), encoding="utf-8")
        tmp.replace(path)

    def update_meta(self, lesson_id: str, **changes) -> dict:
        with self._lock:
            meta = self.meta(lesson_id)
            meta.update(changes)
            self.save_meta(lesson_id, meta)
            return meta

    def log(self, lesson_id: str, message: str) -> None:
        with self._lock:
            meta = self.meta(lesson_id)
            meta.setdefault("log", []).append(f"{datetime.now():%H:%M:%S} {message}")
            self.save_meta(lesson_id, meta)

    def lessons(self) -> list[dict]:
        out = []
        base = self.root / "lessons"
        if base.exists():
            for d in sorted(base.iterdir(), reverse=True):
                if (d / "meta.json").exists():
                    m = json.loads((d / "meta.json").read_text(encoding="utf-8"))
                    m.pop("log", None)
                    out.append(m)
        return sorted(out, key=lambda m: m.get("created", ""), reverse=True)

    def plan(self, lesson_id: str) -> LessonPlan | None:
        p = self.lesson_dir(lesson_id) / "plan.json"
        return LessonPlan.model_validate_json(p.read_text(encoding="utf-8")) if p.exists() else None

    def save_plan(self, lesson_id: str, plan: LessonPlan) -> None:
        (self.lesson_dir(lesson_id) / "plan.json").write_text(plan.model_dump_json(indent=2), encoding="utf-8")

    # ------------------------------------------------------------ students
    def join(self, lesson_id: str, name: str, matric: str) -> dict:
        name, matric = " ".join(name.split())[:80], matric.strip().upper()[:30]
        if not name or not matric:
            raise ValueError("Name and matric number are required.")
        with self._lock:
            row = self._db.execute("SELECT * FROM students WHERE lesson_id=? AND matric=?",
                                   (lesson_id, matric)).fetchone()
            if row:  # same student rejoining (new phone, refreshed page)
                self._db.execute("UPDATE students SET name=? WHERE id=?", (name, row["id"]))
                self._db.commit()
                return dict(row) | {"name": name}
            token = secrets.token_urlsafe(16)
            cur = self._db.execute(
                "INSERT INTO students(lesson_id, name, matric, token, joined) VALUES (?,?,?,?,?)",
                (lesson_id, name, matric, token, _now()))
            self._db.commit()
            return {"id": cur.lastrowid, "lesson_id": lesson_id, "name": name, "matric": matric, "token": token}

    def student_by_token(self, token: str) -> dict | None:
        with self._lock:
            row = self._db.execute("SELECT * FROM students WHERE token=?", (token,)).fetchone()
        return dict(row) if row else None

    def students(self, lesson_id: str) -> list[dict]:
        with self._lock:
            rows = self._db.execute("SELECT * FROM students WHERE lesson_id=? ORDER BY name", (lesson_id,)).fetchall()
        return [dict(r) for r in rows]

    # ------------------------------------------------------------ questions
    def add_question(self, lesson_id: str, student_id: int, text: str, section: int) -> int:
        text = " ".join(text.split())[:500]
        if len(text) < 3:
            raise ValueError("Please type a question.")
        with self._lock:
            recent = self._db.execute(
                "SELECT COUNT(*) FROM questions WHERE student_id=? AND asked > ?",
                (student_id, datetime.now().replace(second=0, microsecond=0).isoformat())).fetchone()[0]
            if recent >= 5:
                raise ValueError("You've asked several questions this minute. Please wait a moment.")
            cur = self._db.execute(
                "INSERT INTO questions(lesson_id, student_id, text, section, asked) VALUES (?,?,?,?,?)",
                (lesson_id, student_id, text, section, _now()))
            self._db.commit()
            return int(cur.lastrowid)

    def questions(self, lesson_id: str, status: str | None = None, student_id: int | None = None) -> list[dict]:
        sql = ("SELECT q.*, s.name, s.matric FROM questions q JOIN students s ON s.id=q.student_id "
               "WHERE q.lesson_id=?")
        params: list = [lesson_id]
        if status:
            sql += " AND q.status=?"
            params.append(status)
        if student_id is not None:
            sql += " AND q.student_id=?"
            params.append(student_id)
        with self._lock:
            rows = self._db.execute(sql + " ORDER BY q.id", params).fetchall()
        return [dict(r) for r in rows]

    def set_question(self, qid: int, status: str, answer: str = "") -> None:
        with self._lock:
            self._db.execute("UPDATE questions SET status=?, answer=? WHERE id=?", (status, answer, qid))
            self._db.commit()

    # ------------------------------------------------------------ quiz
    def save_response(self, lesson_id: str, student_id: int, kind: str, qindex: int, answer: str,
                      max_score: float, score: float | None = None, marked_by: str = "", feedback: str = "") -> None:
        with self._lock:
            self._db.execute(
                "INSERT OR IGNORE INTO responses(lesson_id, student_id, kind, qindex, answer, score, max_score, "
                "feedback, marked_by) VALUES (?,?,?,?,?,?,?,?,?)",
                (lesson_id, student_id, kind, qindex, answer[:3000], score, max_score, feedback, marked_by))
            self._db.commit()

    def has_submitted(self, lesson_id: str, student_id: int) -> bool:
        with self._lock:
            return self._db.execute("SELECT 1 FROM responses WHERE lesson_id=? AND student_id=? LIMIT 1",
                                    (lesson_id, student_id)).fetchone() is not None

    def responses(self, lesson_id: str, kind: str | None = None, unmarked: bool = False) -> list[dict]:
        sql = ("SELECT r.*, s.name, s.matric FROM responses r JOIN students s ON s.id=r.student_id "
               "WHERE r.lesson_id=?")
        params: list = [lesson_id]
        if kind:
            sql += " AND r.kind=?"
            params.append(kind)
        if unmarked:
            sql += " AND r.score IS NULL"
        with self._lock:
            rows = self._db.execute(sql + " ORDER BY s.name, r.kind, r.qindex", params).fetchall()
        return [dict(r) for r in rows]

    def set_mark(self, response_id: int, score: float, feedback: str, marked_by: str) -> None:
        with self._lock:
            self._db.execute("UPDATE responses SET score=?, feedback=?, marked_by=? WHERE id=?",
                             (score, feedback, marked_by, response_id))
            self._db.commit()

    def scores(self, lesson_id: str) -> list[dict]:
        """One row per student with totals."""
        with self._lock:
            rows = self._db.execute(
                "SELECT s.id, s.name, s.matric, "
                "SUM(CASE WHEN r.kind='mcq' THEN r.score ELSE 0 END) AS mcq, "
                "SUM(CASE WHEN r.kind='short' THEN r.score ELSE 0 END) AS short, "
                "SUM(r.score) AS total, SUM(r.max_score) AS max_total, "
                "SUM(CASE WHEN r.score IS NULL THEN 1 ELSE 0 END) AS unmarked, COUNT(r.id) AS answered "
                "FROM students s LEFT JOIN responses r ON r.student_id=s.id AND r.lesson_id=s.lesson_id "
                "WHERE s.lesson_id=? GROUP BY s.id ORDER BY s.name", (lesson_id,)).fetchall()
        return [dict(r) for r in rows]
