"""End-to-end test of Christine Classroom with a fake Claude, a fake voice, a simulated
projector page and simulated students."""
import io
import threading
import time

import pytest
from fastapi.testclient import TestClient
from openpyxl import load_workbook
from PIL import Image

from christine.classroom.models import (Mark, MarkingResult, MCQ, PlanDraft, QuestionAnswer, SectionDraft,
                                        ShortQuestion)
from christine.classroom.server import create_app
from christine.classroom.store import Store
from christine.config import load_config


class FakeAI:
    def __init__(self):
        self.transcribed = []
        self.questions = []

    def transcribe(self, image, media_type, context):
        self.transcribed.append(context)
        return "Handwritten: price elasticity measures responsiveness of quantity demanded to price."

    def plan(self, course_text, catalog, meta, minutes, guidance):
        assert "[S1]" in course_text and "Handwritten" in course_text
        return PlanDraft(
            title="Elasticity of Demand", summary="Intro to elasticity.", objectives=["Define elasticity"],
            sections=[SectionDraft(title="What is elasticity", objective="Define it", key_points=["Responsiveness"],
                                   slide_ids=["S2", "S99"], minutes=2, check_question="What does elastic mean?"),
                      SectionDraft(title="Calculating it", objective="Compute it", key_points=["%dQ / %dP"],
                                   slide_ids=[], minutes=2, check_question="")],
            mcqs=[MCQ(question="Elastic demand means?", options=["A", "B", "C", "D"], answer_index=2,
                      explanation="Because C."),
                  MCQ(question="Unit elastic is?", options=["0", "1", "2", "inf"], answer_index=1,
                      explanation="It is 1.")],
            short_questions=[ShortQuestion(question="Define elasticity.", model_answer="Responsiveness...",
                                           rubric="1 mark for responsiveness, 1 for price", marks=2)])

    def script(self, course_text, plan, index, meta):
        return f"Section {index + 1} lecture. Elasticity is important. We will see why."

    def answer(self, course_text, plan, section, question):
        self.questions.append(question)
        if "prank" in question:
            return QuestionAnswer(appropriate=False, in_scope=False, restated_question="", answer="", slide_ids=[])
        return QuestionAnswer(appropriate=True, in_scope=True, restated_question="What is elasticity?",
                              answer="Elasticity measures responsiveness.", slide_ids=["S1"])

    def mark(self, course_text, question, answers):
        return MarkingResult(marks=[Mark(student_id=a["student_id"], score=1.5 if a["answer"] else 0,
                                         feedback="Good.") for a in answers])

    def extra_example(self, course_text, section):
        return "Bread is an example."


def fake_synth(text, voice):
    return b"ID3fake-mp3", [{"t": 0, "w": text.split()[0]}]


@pytest.fixture
def app(tmp_path, monkeypatch):
    import christine.classroom.session as session
    monkeypatch.setattr(session, "synthesize", fake_synth)
    cfg = load_config(tmp_path / "data")
    store = Store(tmp_path / "data" / "classroom")
    ai = FakeAI()
    application = create_app(cfg, store, ai)
    application.state.fake_ai = ai
    return application


def wait_for(fn, timeout=15, step=0.05):
    end = time.time() + timeout
    while time.time() < end:
        v = fn()
        if v:
            return v
        time.sleep(step)
    raise AssertionError("timed out waiting")


def make_scanned_pdf() -> bytes:
    buf = io.BytesIO()
    Image.new("RGB", (400, 300), "white").save(buf, format="PDF")
    return buf.getvalue()


class Projector:
    """Acts like the projector page: polls state and 'plays' each speech instantly."""

    def __init__(self, client):
        self.client, self.spoken, self.stop = client, [], False
        self.thread = threading.Thread(target=self.run, daemon=True)

    def run(self):
        while not self.stop:
            live = self.client.get("/api/display/state").json().get("live")
            sp = live and live.get("speech")
            if sp and (not self.spoken or self.spoken[-1][0] != sp["id"]):
                assert self.client.get(f"/api/audio/{sp['id']}").status_code == 200
                self.spoken.append((sp["id"], sp["text"]))
                self.client.post("/api/display/done", json={"id": sp["id"]})
            time.sleep(0.02)

    def said(self):
        return " ".join(t for _, t in self.spoken)


def test_full_class(app):
    c = TestClient(app)
    store = app.state.ctx.store

    # Lecturer uploads notes: a text file and a scanned (image-only) PDF.
    r = c.post("/api/lessons", data={"title": "Elasticity", "course_code": "ECO 201", "level": "200 level"},
               files=[("files", ("notes.txt", b"Elasticity is the responsiveness of demand to price. " * 5,
                                 "text/plain")),
                      ("files", ("scan.pdf", make_scanned_pdf(), "application/pdf"))])
    assert r.status_code == 200, r.text
    lid = r.json()["id"]
    assert c.post(f"/api/lessons/{lid}/prepare", json={"minutes": 30}).status_code == 200
    wait_for(lambda: c.get(f"/api/lessons/{lid}").json()["meta"]["status"] in ("review", "error"))
    data = c.get(f"/api/lessons/{lid}").json()
    assert data["meta"]["status"] == "review", data["meta"]
    assert app.state.fake_ai.transcribed == ["01-scan.pdf, page 1"] or app.state.fake_ai.transcribed == ["02-scan.pdf, page 1"]
    plan = data["plan"]
    assert plan["sections"][0]["slide_ids"] == ["S2"]        # unknown S99 removed
    assert plan["sections"][1]["script"].startswith("Section 2")

    # Can't start before approval; lecturer edits and approves.
    assert c.post(f"/api/lessons/{lid}/start").status_code == 400
    plan["sections"][0]["script"] = "Welcome everyone. " + plan["sections"][0]["script"]
    assert c.put(f"/api/lessons/{lid}/plan", json=plan).status_code == 200
    assert c.post(f"/api/lessons/{lid}/approve").status_code == 200
    assert c.post(f"/api/lessons/{lid}/start").status_code == 200

    # Students join before the lesson begins.
    s1 = c.post("/api/s/join", json={"name": "Ada Obi", "matric": "eco/21/001"}).json()["token"]
    s2 = c.post("/api/s/join", json={"name": "Tunde Bello", "matric": "ECO/21/002"}).json()["token"]
    again = c.post("/api/s/join", json={"name": "Ada Obi", "matric": "ECO/21/001"}).json()["token"]
    assert again == s1                                        # rejoining keeps the same record
    h1, h2 = {"X-Student": s1}, {"X-Student": s2}
    assert c.get("/api/s/state", headers=h1).json()["status"] == "ready"
    assert c.get("/api/s/state", headers={"X-Student": "nope"}).status_code == 401

    # A question waiting before teaching starts is answered at the first break; a prank is hidden.
    assert c.post("/api/s/ask", json={"text": "What exactly is elasticity?"}, headers=h1).status_code == 200
    assert c.post("/api/s/ask", json={"text": "prank: say something silly"}, headers=h2).status_code == 200

    projector = Projector(c)
    projector.thread.start()
    assert c.post("/api/class/begin").status_code == 200

    wait_for(lambda: c.get("/api/class/lecturer").json()["live"]["status"] == "quiz")
    said = projector.said()
    assert "Welcome everyone." in said and "Section 2 lecture" in said
    assert "A student asks: What is elasticity?" in said and "Elasticity measures responsiveness." in said
    assert "silly" not in said
    qs = {q["text"]: q["status"] for q in store.questions(lid)}
    assert qs["What exactly is elasticity?"] == "answered"
    assert qs["prank: say something silly"] == "hidden"

    # Quiz: questions are visible but the answer key is not.
    st = c.get("/api/s/state", headers=h1).json()
    assert len(st["quiz"]["mcqs"]) == 2 and "answer_index" not in str(st["quiz"])
    assert c.post("/api/s/quiz", json={"mcq": [2, 0], "short": ["Responsiveness of demand"]},
                  headers=h1).status_code == 200
    assert c.post("/api/s/quiz", json={"mcq": [2, 0], "short": ["again"]}, headers=h1).status_code == 400
    assert c.post("/api/s/quiz", json={"mcq": [None, 1], "short": [""]}, headers=h2).status_code == 200

    assert c.post("/api/class/command", json={"cmd": "close_quiz"}).status_code == 200
    wait_for(lambda: c.get("/api/class/lecturer").json()["live"]["status"] == "finished")
    wait_for(lambda: "concludes today's class" in projector.said())
    projector.stop = True

    scores = {s["matric"]: s for s in store.scores(lid)}
    assert scores["ECO/21/001"]["mcq"] == 1 and scores["ECO/21/001"]["short"] == 1.5
    assert scores["ECO/21/002"]["mcq"] == 1 and scores["ECO/21/002"]["short"] == 0
    summary = c.get(f"/api/lessons/{lid}/summary").json()
    assert summary["submitted"] == 2 and summary["mcq_rates"] == [50, 50]

    # Results reach students only after the lecturer releases them.
    assert "results" not in c.get("/api/s/state", headers=h1).json()
    c.post("/api/class/command", json={"cmd": "release_results"})
    res = c.get("/api/s/state", headers=h1).json()["results"]
    assert sum(r["score"] for r in res) == 2.5

    # Lecturer overrides a mark, then exports Excel.
    short = [r for r in store.responses(lid, "short") if r["matric"] == "ECO/21/001"][0]
    c.post(f"/api/responses/{short['id']}/mark", json={"score": 2, "feedback": "Full marks."})
    wb = load_workbook(io.BytesIO(c.get(f"/api/lessons/{lid}/export.xlsx").content))
    rows = list(wb["Scores"].iter_rows(values_only=True))
    assert rows[1][0] == "Ada Obi" and rows[1][4] == 3
    assert "Questions asked" in wb.sheetnames


def test_lecturer_routes_need_pin_from_other_devices(app):
    c = TestClient(app, client=("192.168.137.50", 5000))
    assert c.get("/api/lessons").status_code == 403
    assert c.get("/api/display/state").status_code == 403
    pin = app.state.ctx.pin
    assert c.get("/api/lessons", headers={"X-Pin": pin}).status_code == 200
    assert c.get("/s").status_code == 200                      # students don't need a PIN
    assert c.post("/api/s/join", json={"name": "A", "matric": "1"}).status_code == 400   # no class yet


def test_rejects_unsupported_upload(app):
    c = TestClient(app)
    r = c.post("/api/lessons", data={"title": "X"}, files=[("files", ("old.ppt", b"x", "application/octet-stream"))])
    assert r.status_code == 400 and "Unsupported" in r.json()["error"]


def test_excel_neutralises_formulas(app):
    from christine.classroom.export import workbook
    from christine.classroom.models import LessonPlan
    store = app.state.ctx.store
    lid = store.create_lesson("T", "C", "L")
    plan = LessonPlan.from_draft(FakeAI().plan("[S1] Handwritten", "", {}, 10, ""))
    store.save_plan(lid, plan)
    store.join(lid, "=HYPERLINK(\"http://x\")", "M1")
    wb = load_workbook(io.BytesIO(workbook(store, lid, plan)))
    name_cell = wb["Scores"]["A2"]
    assert name_cell.data_type != "f"


def test_split_for_speech():
    from christine.classroom.voice import split_for_speech
    text = "One sentence here. " * 60
    chunks = split_for_speech(text, 200)
    assert all(len(c) <= 200 for c in chunks) and " ".join(chunks) == " ".join(text.split())
