"""Background job: read the uploaded files, plan the lesson, write the lecture scripts."""
from __future__ import annotations

import threading
import traceback

from .ai import ClassroomAI, catalog_text
from .materials import corpus, ingest
from .models import LessonPlan
from .store import Store

_running: set[str] = set()


def prepare_async(store: Store, ai: ClassroomAI, lesson_id: str, minutes: int, guidance: str) -> bool:
    if lesson_id in _running:
        return False
    _running.add(lesson_id)
    threading.Thread(target=_prepare, args=(store, ai, lesson_id, minutes, guidance), daemon=True).start()
    return True


def _prepare(store: Store, ai: ClassroomAI, lesson_id: str, minutes: int, guidance: str) -> None:
    def log(msg):
        print(f"[Classroom] {msg}")
        store.log(lesson_id, msg)

    try:
        d = store.lesson_dir(lesson_id)
        store.update_meta(lesson_id, status="reading", error="")
        assets = ingest(d, log, ai.transcribe)
        text = corpus(assets)
        if not text.strip():
            raise ValueError("I couldn't find any text in the uploaded files.")

        store.update_meta(lesson_id, status="planning")
        log("Designing the lesson plan, sections and quiz...")
        meta = store.meta(lesson_id)
        plan = LessonPlan.from_draft(ai.plan(text, catalog_text(assets), meta, minutes, guidance))
        known = {a.id for a in assets}
        for s in plan.sections:
            s.slide_ids = [x for x in s.slide_ids if x in known]
        for q in plan.mcqs:
            q.answer_index = max(0, min(q.answer_index, len(q.options) - 1))
        store.save_plan(lesson_id, plan)

        store.update_meta(lesson_id, status="writing")
        for i, s in enumerate(plan.sections):
            log(f"Writing the lecture for section {i + 1} of {len(plan.sections)}: {s.title}...")
            s.script = ai.script(text, plan, i, meta)
            store.save_plan(lesson_id, plan)
        store.update_meta(lesson_id, status="review")
        log("Ready for your review. Check each section and the quiz, then approve.")
    except Exception as exc:
        traceback.print_exc()
        store.update_meta(lesson_id, status="error", error=str(exc))
        log(f"Problem: {exc}")
    finally:
        _running.discard(lesson_id)
