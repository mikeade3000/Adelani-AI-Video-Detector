"""The live class: teaches section by section, takes questions, runs and marks the quiz.

The teaching runs on a background thread. The projector page plays each piece
of speech and reports back when it has finished, so the lesson moves at the
pace of the real audio. The lecturer steers with commands (pause, next...).
"""
from __future__ import annotations

import threading
import time
import uuid
from concurrent.futures import ThreadPoolExecutor
from typing import Callable

from .ai import ClassroomAI
from .materials import corpus, load_assets
from .models import LessonPlan
from .store import Store
from .voice import split_for_speech, synthesize


class Interrupt(Exception):
    """Raised inside speech when the lecturer skips, goes back or ends the class."""


COMMANDS = {"pause", "resume", "next", "previous", "repeat", "questions", "example", "open_quiz",
            "close_quiz", "end", "release_results"}


class LiveClass:
    def __init__(self, store: Store, ai: ClassroomAI | None, lesson_id: str, voice: str,
                 approve_questions: bool = False, synth: Callable | None = None):
        self.store, self.ai, self.lesson_id = store, ai, lesson_id
        self.voice, self.synth = voice, synth or synthesize
        self.approve_questions = approve_questions
        self.plan: LessonPlan = store.plan(lesson_id)
        self.assets = {a.id: a for a in load_assets(store.lesson_dir(lesson_id))}
        self.course_text = corpus(list(self.assets.values()))
        self.lock = threading.RLock()
        self.audio: dict[str, bytes] = {}
        self.done_speech: set[str] = set()
        self.display_seen = 0.0
        self.paused = threading.Event()
        self.flags: set[str] = set()
        self.thread: threading.Thread | None = None
        self.chunk_pos = 0
        self.pool = ThreadPoolExecutor(max_workers=2)
        self.state = {
            "status": "ready", "section": 0, "sections": len(self.plan.sections), "title": self.plan.title,
            "section_title": "", "caption": "", "expression": "smile", "slide": self._slide_for(None),
            "speech": None, "quiz_open": False, "results_released": False, "notice": "",
            "quiz_summary": None, "answering": None, "version": 0,
        }

    # ---------------------------------------------------------------- state
    def _set(self, **changes) -> None:
        with self.lock:
            self.state.update(changes)
            self.state["version"] += 1

    def snapshot(self) -> dict:
        with self.lock:
            s = dict(self.state)
        s["pending_questions"] = len(self.store.questions(self.lesson_id, "pending")) + \
            len(self.store.questions(self.lesson_id, "approved"))
        s["students"] = len(self.store.students(self.lesson_id))
        s["paused"] = self.paused.is_set()
        return s

    def _slide_for(self, index: int | None, slide_id: str | None = None) -> dict:
        if index is None:
            return {"image": None, "title": self.plan.title, "points": self.plan.objectives, "ref": ""}
        section = self.plan.sections[index]
        ids = [slide_id] if slide_id else section.slide_ids
        for sid in ids:
            a = self.assets.get(sid)
            if a and a.image:
                return {"image": f"/lesson-assets/{self.lesson_id}/{a.image}", "title": section.title,
                        "points": section.key_points, "ref": f"{a.source}, {a.label}"}
        return {"image": None, "title": section.title, "points": section.key_points, "ref": ""}

    # -------------------------------------------------------------- control
    def start(self) -> None:
        if self.thread and self.thread.is_alive():
            return
        self.thread = threading.Thread(target=self._run, daemon=True, name="live-class")
        self.thread.start()

    def command(self, cmd: str) -> None:
        if cmd not in COMMANDS:
            raise ValueError(f"unknown command {cmd}")
        if cmd == "pause":
            self.paused.set()
        elif cmd == "resume":
            self.paused.clear()
        elif cmd == "open_quiz":
            self._set(quiz_open=True, status="quiz")
        elif cmd == "release_results":
            self._set(results_released=True)
        else:
            self.flags.add(cmd)
            self.paused.clear()

    def display_ping(self) -> None:
        self.display_seen = time.time()

    def speech_done(self, speech_id: str) -> None:
        self.done_speech.add(speech_id)

    # --------------------------------------------------------------- speech
    def _prepare(self, text: str) -> dict:
        sid = uuid.uuid4().hex[:12]
        try:
            audio, words = self.synth(text, self.voice)
            self.audio[sid] = audio
            return {"id": sid, "text": text, "words": words, "audio": True}
        except Exception as exc:  # offline: the browser speaks instead
            print(f"[Classroom] online voice unavailable ({exc}); the browser voice will be used.")
            return {"id": sid, "text": text, "words": [], "audio": False}

    def say(self, text: str, expression: str = "speaking", interruptible: bool = True, start: int = 0) -> None:
        """Speak text chunk by chunk. self.chunk_pos tracks progress so teaching can resume mid-section."""
        chunks = split_for_speech(text)[start:]
        if not chunks:
            return
        futures = [self.pool.submit(self._prepare, chunks[0])]
        i = 0
        while i < len(chunks):
            if i + 1 < len(chunks) and len(futures) == i + 1:
                futures.append(self.pool.submit(self._prepare, chunks[i + 1]))   # prepare the next one now
            if interruptible:
                self.chunk_pos = start + i
            speech = futures[i].result()
            while True:
                self._play(speech, expression, interruptible)
                if not (interruptible and "repeat" in self.flags):
                    break
                # "Repeat that": play the same chunk again under a new id so the page restarts it.
                self.flags.discard("repeat")
                old, speech = speech, dict(speech, id=uuid.uuid4().hex[:12])
                if old["id"] in self.audio:
                    self.audio[speech["id"]] = self.audio.pop(old["id"])
            self.audio.pop(speech["id"], None)
            i += 1
        self._set(speech=None, expression="neutral")

    def _play(self, speech: dict, expression: str, interruptible: bool) -> None:
        # Wait for the projector page to be open.
        while time.time() - self.display_seen > 8:
            self._set(notice="Open the classroom display on the projector to continue.")
            self._check(interruptible)
            time.sleep(0.5)
        self._set(notice="")
        while self.paused.is_set():
            self._set(status="paused")
            self._check(interruptible)
            time.sleep(0.3)
        if self.state["status"] == "paused":
            self._set(status="teaching")
        self._set(speech=speech, caption=speech["text"], expression=expression)
        expected = 4 + len(speech["text"].split()) / 2.0 * 1.6   # generous: ~2 words per second
        start = time.time()
        while speech["id"] not in self.done_speech:
            self._check(interruptible)
            if interruptible and "repeat" in self.flags:
                return                              # say() replays this chunk
            if self.paused.is_set():               # paused mid-sentence: the page stops the audio
                start = time.time()
            if time.time() - start > expected and time.time() - self.display_seen > 8:
                start = time.time()                 # display gone; wait for it to come back
            elif time.time() - start > expected * 2:
                break                               # never block the class forever
            time.sleep(0.1)
        self.done_speech.discard(speech["id"])

    def _check(self, interruptible: bool) -> None:
        if interruptible and self.flags & {"next", "previous", "end", "questions", "example"}:
            raise Interrupt()

    def _thinking(self, label: str) -> None:
        self._set(expression="thinking", caption=label, speech=None)

    # --------------------------------------------------------------- lesson
    def _run(self) -> None:
        try:
            self._teach()
            self._quiz()
        except Exception as exc:
            import traceback
            traceback.print_exc()
            self._set(notice=f"Christine hit a problem: {exc}", status="error", expression="neutral")

    def _teach(self) -> None:
        self._set(status="teaching")
        idx, resume = 0, 0
        sections = self.plan.sections
        while 0 <= idx < len(sections):
            section = sections[idx]
            self._set(section=idx, section_title=section.title, slide=self._slide_for(idx))
            self.store.update_meta(self.lesson_id, last_section=idx)
            try:
                self.say(section.script or " ".join(section.key_points), start=resume)
                resume = 0
                self._question_break(idx, ask_check=True)
                self.flags -= {"next", "questions", "example"}   # already moving on
                idx += 1
            except Interrupt:
                flags, self.flags = set(self.flags), set()
                if "end" in flags:
                    return
                if "previous" in flags:
                    idx, resume = max(0, idx - 1), 0
                elif "next" in flags:
                    idx, resume = idx + 1, 0
                else:
                    resume = self.chunk_pos      # carry on from the interrupted sentence afterwards
                    if "questions" in flags:
                        self._question_break(idx, ask_check=False)
                    elif "example" in flags:
                        self._example(idx)
        self._set(section=len(sections) - 1)

    def _example(self, idx: int) -> None:
        if not self.ai:
            return
        self._thinking("Preparing another example...")
        text = self.ai.extra_example(self.course_text, self.plan.sections[idx])
        self.say("Here is another example. " + text, interruptible=False)

    def _waiting_questions(self) -> list[dict]:
        if self.approve_questions:
            return self.store.questions(self.lesson_id, "approved")
        return self.store.questions(self.lesson_id, "pending")

    def _question_break(self, idx: int, ask_check: bool) -> None:
        section = self.plan.sections[idx]
        if ask_check and section.check_question and not self._waiting_questions():
            self.say(f"Before we continue, consider this question. {section.check_question} "
                     "If anything so far is unclear, you may send me a question from your phone now.",
                     expression="curious", interruptible=False)
            self._set(status="questions", caption="Questions? Send them from your phone.", expression="smile")
            deadline = time.time() + 12
            while time.time() < deadline and not self._waiting_questions() and not self.flags:
                time.sleep(0.5)
        self._set(status="questions")
        answered = 0
        while answered < 6:
            pending = self._waiting_questions()
            if not pending or not self.ai:
                break
            q = pending[0]
            self._set(answering={"name": q["name"].split()[0] if q["name"] else "", "text": ""})
            self._thinking("Considering a question from the class...")
            try:
                ans = self.ai.answer(self.course_text, self.plan, idx, q["text"])
            except Exception as exc:
                print(f"[Classroom] could not answer question {q['id']}: {exc}")
                self.store.set_question(q["id"], "skipped")
                continue
            if not ans.appropriate:
                self.store.set_question(q["id"], "hidden", "Not answered in class.")
                continue
            slide = self._slide_for(idx, ans.slide_ids[0]) if ans.slide_ids else None
            if slide and slide["image"]:
                self._set(slide=slide)
            self._set(answering={"name": q["name"].split()[0] if q["name"] else "", "text": ans.restated_question})
            self.say(f"A student asks: {ans.restated_question}", expression="curious", interruptible=False)
            self.say(ans.answer, interruptible=False)
            self.store.set_question(q["id"], "answered", ans.answer)
            answered += 1
        if answered:
            self._set(slide=self._slide_for(idx))
        self._set(status="teaching", answering=None)

    # ----------------------------------------------------------------- quiz
    def _quiz(self) -> None:
        self.flags.discard("end")
        n_mcq, n_short = len(self.plan.mcqs), len(self.plan.short_questions)
        self._set(status="quiz_intro", slide={"image": None, "title": "Quiz", "ref": "",
                                               "points": [f"{n_mcq} multiple-choice questions",
                                                          f"{n_short} short-answer questions",
                                                          "Answer on your phone, then press Submit"]})
        self.say(f"That brings us to the end of the lesson. We will now take a short quiz: {n_mcq} multiple "
                 f"choice and {n_short} short answer questions. Please answer on your phone and press submit "
                 "when you are done.", expression="smile", interruptible=False)
        self._set(quiz_open=True, status="quiz", caption="The quiz is open on your phones.")
        while "close_quiz" not in self.flags and "end" not in self.flags:
            time.sleep(0.5)
        self.flags.clear()
        self._set(quiz_open=False, status="marking")
        self.say("Thank you. The quiz is now closed. Allow me a moment to mark your answers.",
                 interruptible=False)
        self._thinking("Marking short answers...")
        self.mark_short_answers()
        summary = quiz_summary(self.store, self.lesson_id, self.plan)
        self._set(quiz_summary=summary, status="finished", slide={
            "image": None, "title": "Quiz results", "ref": "", "points": summary["lines"]})
        self.say(summary["spoken"], expression="smile", interruptible=False)
        self.say("That concludes today's class. Thank you for your attention.", expression="smile",
                 interruptible=False)
        self.store.update_meta(self.lesson_id, status="taught")

    def mark_short_answers(self) -> None:
        if not self.ai:
            return
        for qi, q in enumerate(self.plan.short_questions):
            todo = [r for r in self.store.responses(self.lesson_id, "short", unmarked=True) if r["qindex"] == qi]
            for start in range(0, len(todo), 25):
                batch = todo[start:start + 25]
                try:
                    result = self.ai.mark(self.course_text, q.model_dump(),
                                          [{"student_id": r["student_id"], "answer": r["answer"]} for r in batch])
                except Exception as exc:
                    print(f"[Classroom] marking failed: {exc}")
                    continue
                by_student = {m.student_id: m for m in result.marks}
                for r in batch:
                    m = by_student.get(r["student_id"])
                    if m:
                        score = max(0.0, min(float(q.marks), round(m.score * 2) / 2))
                        self.store.set_mark(r["id"], score, m.feedback, "christine")


def submit_quiz(store: Store, plan: LessonPlan, lesson_id: str, student_id: int,
                mcq: list[int | None], short: list[str]) -> None:
    """Save a student's quiz. Multiple choice is marked immediately."""
    if store.has_submitted(lesson_id, student_id):
        raise ValueError("You have already submitted this quiz.")
    for i, q in enumerate(plan.mcqs):
        choice = mcq[i] if i < len(mcq) else None
        answer = q.options[choice] if isinstance(choice, int) and 0 <= choice < len(q.options) else ""
        store.save_response(lesson_id, student_id, "mcq", i, answer, 1,
                            score=1.0 if choice == q.answer_index else 0.0, marked_by="auto",
                            feedback=q.explanation)
    for i, q in enumerate(plan.short_questions):
        text = short[i].strip() if i < len(short) else ""
        store.save_response(lesson_id, student_id, "short", i, text, q.marks,
                            score=0.0 if not text else None, marked_by="auto" if not text else "",
                            feedback="No answer given." if not text else "")


def quiz_summary(store: Store, lesson_id: str, plan: LessonPlan) -> dict:
    scores = [s for s in store.scores(lesson_id) if s["answered"]]
    if not scores:
        return {"lines": ["No quiz answers were submitted."], "spoken": "No quiz answers were submitted.",
                "average": None, "submitted": 0, "mcq_rates": []}
    pcts = [100 * (s["total"] or 0) / s["max_total"] for s in scores if s["max_total"]]
    avg = sum(pcts) / len(pcts) if pcts else 0
    mcq = store.responses(lesson_id, "mcq")
    rates = []
    for i in range(len(plan.mcqs)):
        rs = [r for r in mcq if r["qindex"] == i]
        rates.append(round(100 * sum(r["score"] or 0 for r in rs) / len(rs)) if rs else 0)
    hardest = min(range(len(rates)), key=lambda i: rates[i]) if rates else None
    lines = [f"{len(scores)} students submitted", f"Class average: {avg:.0f}%"]
    lines += [f"Q{i + 1}: {r}% correct" for i, r in enumerate(rates)]
    spoken = f"{len(scores)} students submitted the quiz, with a class average of {avg:.0f} percent."
    if hardest is not None and rates[hardest] < 60:
        q = plan.mcqs[hardest]
        spoken += (f" The most challenging was question {hardest + 1}, which {rates[hardest]} percent answered "
                   f"correctly. The correct answer was: {q.options[q.answer_index]}. {q.explanation}")
    spoken += " Your individual results and feedback are now available on your phones."
    return {"lines": lines, "spoken": spoken, "average": round(avg, 1), "submitted": len(scores),
            "mcq_rates": rates}
