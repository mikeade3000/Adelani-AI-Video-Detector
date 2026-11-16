"""Christine Classroom web server.

    Lecturer dashboard   http://localhost:8800/          (this laptop only, or a phone with the PIN)
    Projector display    http://localhost:8800/display
    Students             http://<laptop address>:8800/s
"""
from __future__ import annotations

import secrets
import shutil
from pathlib import Path

from fastapi import FastAPI, File, Form, HTTPException, Request, UploadFile
from fastapi.responses import FileResponse, HTMLResponse, JSONResponse, Response
from pydantic import BaseModel

from . import network
from .ai import ClassroomAI
from .export import workbook
from .materials import SUPPORTED
from .models import LessonPlan
from .prep import prepare_async
from .session import LiveClass, quiz_summary, submit_quiz
from .store import Store

WEB = Path(__file__).parent / "web"
PORT = 8800
MAX_UPLOAD_MB = 60


class PrepareBody(BaseModel):
    minutes: int = 50
    guidance: str = ""


class Command(BaseModel):
    cmd: str


class QuestionUpdate(BaseModel):
    status: str


class MarkBody(BaseModel):
    score: float
    feedback: str = ""


class Done(BaseModel):
    id: str


class JoinBody(BaseModel):
    name: str
    matric: str


class AskBody(BaseModel):
    text: str


class QuizBody(BaseModel):
    mcq: list[int | None]
    short: list[str]


class Ctx:
    def __init__(self, config, store: Store, ai: ClassroomAI | None):
        self.config, self.store, self.ai = config, store, ai
        self.live: LiveClass | None = None
        self.pin = f"{secrets.randbelow(900000) + 100000}"
        self.port = PORT


def create_app(config, store: Store, ai: ClassroomAI | None) -> FastAPI:
    app = FastAPI(title="Christine Classroom", docs_url=None, redoc_url=None, openapi_url=None)
    ctx = Ctx(config, store, ai)
    app.state.ctx = ctx

    # ------------------------------------------------------------ helpers
    def lecturer(request: Request) -> None:
        host = request.client.host if request.client else ""
        if host in ("127.0.0.1", "::1", "localhost", "testclient"):
            return
        pin = request.headers.get("x-pin") or request.query_params.get("pin")
        if pin and secrets.compare_digest(pin, ctx.pin):
            return
        raise HTTPException(403, "Lecturer access only. Enter the PIN shown on the lecturer's laptop.")

    def need_ai():
        if ctx.ai is None:
            raise HTTPException(400, "Christine's cloud brain isn't set up. Add your API key with the "
                                     "'Christine - set API key' shortcut, then restart the classroom.")
        return ctx.ai

    def plan_or_404(lesson_id: str) -> LessonPlan:
        try:
            plan = store.plan(lesson_id)
        except ValueError:
            raise HTTPException(404, "No such lesson")
        if not plan:
            raise HTTPException(404, "This lesson hasn't been prepared yet.")
        return plan

    def student(request: Request) -> dict:
        token = request.headers.get("x-student", "")
        s = store.student_by_token(token) if token else None
        if not s or not ctx.live or s["lesson_id"] != ctx.live.lesson_id:
            raise HTTPException(401, "Please join the class.")
        return s

    def page(name: str) -> HTMLResponse:
        return HTMLResponse((WEB / name).read_text(encoding="utf-8"),
                            headers={"Cache-Control": "no-store"})

    # ------------------------------------------------------------ pages
    @app.get("/")
    def dashboard(request: Request):
        lecturer(request)
        return page("dashboard.html")

    @app.get("/remote")
    def remote():
        return page("dashboard.html")   # the page asks for the PIN when not on the laptop

    @app.get("/display")
    def display(request: Request):
        lecturer(request)
        return page("display.html")

    @app.get("/s")
    def student_page():
        return page("student.html")

    @app.get("/static/{name}")
    def static(name: str):
        path = (WEB / name).resolve()
        if path.parent != WEB.resolve() or not path.exists():
            raise HTTPException(404)
        return FileResponse(path, headers={"Cache-Control": "no-cache"})

    @app.get("/lesson-assets/{lesson_id}/{name}")
    def lesson_asset(lesson_id: str, name: str):
        try:
            base = (store.lesson_dir(lesson_id) / "slides").resolve()
        except ValueError:
            raise HTTPException(404)
        path = (base / name).resolve()
        if path.parent != base or not path.exists():
            raise HTTPException(404)
        return FileResponse(path)

    # ------------------------------------------------------------ lessons
    @app.get("/api/lessons")
    def lessons(request: Request):
        lecturer(request)
        return {"lessons": store.lessons(), "ai": ctx.ai is not None, "model": config.model}

    @app.post("/api/lessons")
    async def new_lesson(request: Request, title: str = Form(...), course_code: str = Form(""),
                         level: str = Form("Undergraduate"), files: list[UploadFile] = File(...)):
        lecturer(request)
        if not title.strip():
            raise HTTPException(400, "Please give the lesson a title.")
        bad = [f.filename for f in files if Path(f.filename or "").suffix.lower() not in SUPPORTED]
        if bad:
            raise HTTPException(400, f"Unsupported file(s): {', '.join(bad)}. Use PDF, Word (.docx), PowerPoint "
                                     "(.pptx), text, or photos (JPG/PNG). Save older .doc/.ppt files in the new "
                                     "format first.")
        lesson_id = store.create_lesson(title.strip(), course_code.strip(), level.strip())
        up = store.lesson_dir(lesson_id) / "uploads"
        total = 0
        for i, f in enumerate(files, 1):
            name = f"{i:02d}-" + "".join(c for c in Path(f.filename).name if c.isalnum() or c in " ._-()")[:80]
            with open(up / name, "wb") as out:
                shutil.copyfileobj(f.file, out)
            total += (up / name).stat().st_size
        if total > MAX_UPLOAD_MB * 1024 * 1024:
            shutil.rmtree(store.lesson_dir(lesson_id))
            raise HTTPException(400, f"The files are larger than {MAX_UPLOAD_MB} MB in total. Please split the unit.")
        return {"id": lesson_id}

    @app.get("/api/lessons/{lesson_id}")
    def lesson(request: Request, lesson_id: str):
        lecturer(request)
        try:
            meta = store.meta(lesson_id)
        except (ValueError, FileNotFoundError):
            raise HTTPException(404, "No such lesson")
        plan = store.plan(lesson_id)
        from .materials import load_assets
        assets = [{"id": a.id, "label": f"{a.source}, {a.label}", "image": a.image}
                  for a in load_assets(store.lesson_dir(lesson_id))]
        return {"meta": meta, "plan": plan.model_dump() if plan else None, "assets": assets}


    @app.post("/api/lessons/{lesson_id}/prepare")
    def prepare(request: Request, lesson_id: str, body: PrepareBody):
        lecturer(request)
        ai_ = need_ai()
        store.update_meta(lesson_id, log=[])
        if not prepare_async(store, ai_, lesson_id, max(10, min(180, body.minutes)), body.guidance[:2000]):
            raise HTTPException(409, "This lesson is already being prepared.")
        return {"ok": True}

    @app.put("/api/lessons/{lesson_id}/plan")
    def save_plan(request: Request, lesson_id: str, plan: LessonPlan):
        lecturer(request)
        plan_or_404(lesson_id)
        store.save_plan(lesson_id, plan)
        if store.meta(lesson_id).get("status") == "approved":
            store.update_meta(lesson_id, status="review")   # edits need re-approval
        return {"ok": True}

    @app.post("/api/lessons/{lesson_id}/approve")
    def approve(request: Request, lesson_id: str):
        lecturer(request)
        plan = plan_or_404(lesson_id)
        if any(not s.script.strip() for s in plan.sections):
            raise HTTPException(400, "Some sections have no lecture script yet.")
        store.update_meta(lesson_id, status="approved")
        return {"ok": True}

    @app.post("/api/lessons/{lesson_id}/start")
    def start(request: Request, lesson_id: str):
        lecturer(request)
        plan_or_404(lesson_id)
        if store.meta(lesson_id).get("status") not in ("approved", "taught"):
            raise HTTPException(400, "Please review and approve the lesson plan before starting the class.")
        if ctx.live and ctx.live.thread and ctx.live.thread.is_alive() and ctx.live.lesson_id != lesson_id:
            raise HTTPException(409, "Another class is still running. End it first.")
        if not ctx.live or ctx.live.lesson_id != lesson_id:
            ctx.live = LiveClass(store, ctx.ai, lesson_id, config.classroom_voice,
                                 approve_questions=config.approve_questions)
        return {"ok": True}

    @app.post("/api/class/begin")
    def begin(request: Request):
        lecturer(request)
        if not ctx.live:
            raise HTTPException(400, "Choose a lesson and press Start class first.")
        ctx.live.start()
        return {"ok": True}

    @app.get("/api/lessons/{lesson_id}/export.xlsx")
    def export(request: Request, lesson_id: str):
        lecturer(request)
        data = workbook(store, lesson_id, plan_or_404(lesson_id))
        return Response(data, media_type="application/vnd.openxmlformats-officedocument.spreadsheetml.sheet",
                        headers={"Content-Disposition": f'attachment; filename="{lesson_id}-results.xlsx"'})

    # ------------------------------------------------------------ live class (lecturer)

    @app.post("/api/class/command")
    def command(request: Request, body: Command):
        lecturer(request)
        if not ctx.live:
            raise HTTPException(400, "No class is running.")
        try:
            ctx.live.command(body.cmd)
        except ValueError as exc:
            raise HTTPException(400, str(exc))
        return {"ok": True}

    @app.get("/api/class/lecturer")
    def lecturer_view(request: Request):
        lecturer(request)
        if not ctx.live:
            return {"live": None}
        lid = ctx.live.lesson_id
        return {"live": ctx.live.snapshot(), "lesson_id": lid, "questions": store.questions(lid)[-40:],
                "scores": store.scores(lid), "approve_questions": ctx.live.approve_questions,
                "short_responses": store.responses(lid, "short")}


    @app.post("/api/questions/{qid}")
    def update_question(request: Request, qid: int, body: QuestionUpdate):
        lecturer(request)
        if body.status not in ("approved", "hidden", "pending"):
            raise HTTPException(400, "bad status")
        store.set_question(qid, body.status)
        return {"ok": True}


    @app.post("/api/responses/{rid}/mark")
    def override_mark(request: Request, rid: int, body: MarkBody):
        lecturer(request)
        store.set_mark(rid, max(0.0, body.score), body.feedback[:1000], "lecturer")
        return {"ok": True}

    @app.get("/api/network")
    def net(request: Request):
        lecturer(request)
        addr = network.best_address()
        join = f"http://{addr}:{ctx.port}/s"
        hs = network.hotspot_status()
        out = {"addresses": network.local_addresses(), "join_url": join, "join_qr": network.qr_svg(join),
               "pin": ctx.pin, "remote_url": f"http://{addr}:{ctx.port}/remote", "hotspot": hs}
        if hs.get("on") and hs.get("ssid"):
            out["wifi_qr"] = network.qr_svg(network.wifi_qr_payload(hs["ssid"], hs.get("pass", "")))
        return out

    @app.post("/api/hotspot/start")
    def hotspot(request: Request):
        lecturer(request)
        return network.start_hotspot()

    # ------------------------------------------------------------ projector display
    @app.get("/api/display/state")
    def display_state(request: Request):
        lecturer(request)
        if not ctx.live:
            return {"live": None}
        ctx.live.display_ping()
        addr = network.best_address()
        return {"live": ctx.live.snapshot(), "join_url": f"http://{addr}:{ctx.port}/s"}

    @app.get("/api/display/join-qr")
    def join_qr(request: Request):
        lecturer(request)
        addr = network.best_address()
        return Response(network.qr_svg(f"http://{addr}:{ctx.port}/s"), media_type="image/svg+xml")

    @app.get("/api/audio/{sid}")
    def audio(request: Request, sid: str):
        lecturer(request)
        data = ctx.live.audio.get(sid) if ctx.live else None
        if not data:
            raise HTTPException(404)
        return Response(data, media_type="audio/mpeg")


    @app.post("/api/display/done")
    def display_done(request: Request, body: Done):
        lecturer(request)
        if ctx.live:
            ctx.live.speech_done(body.id)
        return {"ok": True}

    # ------------------------------------------------------------ students

    @app.post("/api/s/join")
    def join(body: JoinBody):
        if not ctx.live:
            raise HTTPException(400, "The class hasn't started yet. Please wait for your lecturer.")
        try:
            s = store.join(ctx.live.lesson_id, body.name, body.matric)
        except ValueError as exc:
            raise HTTPException(400, str(exc))
        return {"token": s["token"], "name": s["name"]}

    @app.get("/api/s/state")
    def student_state(request: Request):
        s = student(request)
        live = ctx.live
        snap = live.snapshot()
        plan = live.plan
        submitted = store.has_submitted(live.lesson_id, s["id"])
        out = {"name": s["name"], "matric": s["matric"], "title": plan.title, "status": snap["status"],
               "section_title": snap["section_title"], "section": snap["section"] + 1,
               "sections": snap["sections"], "quiz_open": snap["quiz_open"], "submitted": submitted,
               "my_questions": [{"text": q["text"], "status": q["status"], "answer": q["answer"]}
                                for q in store.questions(live.lesson_id, student_id=s["id"])]}
        if snap["quiz_open"] and not submitted:
            out["quiz"] = {"mcqs": [{"question": q.question, "options": q.options} for q in plan.mcqs],
                           "short": [{"question": q.question, "marks": q.marks} for q in plan.short_questions]}
        if submitted and snap["results_released"]:
            mine = [r for r in store.responses(live.lesson_id) if r["student_id"] == s["id"]]
            out["results"] = [{"kind": r["kind"], "n": r["qindex"] + 1, "answer": r["answer"], "score": r["score"],
                               "max": r["max_score"], "feedback": r["feedback"]} for r in mine]
        return out


    @app.post("/api/s/ask")
    def ask(request: Request, body: AskBody):
        s = student(request)
        try:
            store.add_question(ctx.live.lesson_id, s["id"], body.text, ctx.live.state["section"])
        except ValueError as exc:
            raise HTTPException(400, str(exc))
        return {"ok": True}


    @app.post("/api/s/quiz")
    def quiz(request: Request, body: QuizBody):
        s = student(request)
        if not ctx.live.state["quiz_open"]:
            raise HTTPException(400, "The quiz is not open.")
        try:
            submit_quiz(store, ctx.live.plan, ctx.live.lesson_id, s["id"], body.mcq, body.short)
        except ValueError as exc:
            raise HTTPException(400, str(exc))
        return {"ok": True}

    @app.get("/api/lessons/{lesson_id}/summary")
    def summary(request: Request, lesson_id: str):
        lecturer(request)
        return quiz_summary(store, lesson_id, plan_or_404(lesson_id))

    @app.exception_handler(HTTPException)
    async def http_error(request: Request, exc: HTTPException):
        return JSONResponse({"error": exc.detail}, status_code=exc.status_code)

    return app


def run(config) -> None:
    """Start the classroom server and open the lecturer dashboard."""
    import threading
    import webbrowser

    import uvicorn

    store = Store(config.data_dir / "classroom")
    ai = ClassroomAI(config.model) if config.has_api_key else None
    app = create_app(config, store, ai)
    ctx = app.state.ctx
    addr = network.best_address()
    print("\n  Christine Classroom is running.")
    print(f"  Lecturer dashboard : http://localhost:{PORT}/")
    print(f"  Students join at   : http://{addr}:{PORT}/s")
    print(f"  Phone remote PIN   : {ctx.pin}")
    print("  Keep this window open during the class. Close it to stop.\n")
    if ai is None:
        print("  NOTE: no API key is set, so lessons can't be prepared or taught yet.\n")
    threading.Timer(1.5, lambda: webbrowser.open(f"http://localhost:{PORT}/")).start()
    uvicorn.run(app, host="0.0.0.0", port=PORT, log_level="warning")
