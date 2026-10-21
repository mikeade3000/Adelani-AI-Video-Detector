"""Web server for the KIU voice assistant.

Run:  uvicorn server:app --port 8000     then open http://localhost:8000
"""

import os
from pathlib import Path
from typing import Literal

import anthropic
from fastapi import FastAPI, HTTPException
from fastapi.responses import FileResponse
from fastapi.staticfiles import StaticFiles
from pydantic import BaseModel, Field

from assistant import Assistant
from knowledge import KnowledgeBase

HERE = Path(__file__).parent
PAGES_PATH = Path(os.environ.get("KIU_PAGES", HERE / "data" / "pages.jsonl"))


class Turn(BaseModel):
    role: str
    content: str = Field(max_length=4000)


class Question(BaseModel):
    question: str = Field(min_length=1, max_length=1000)
    history: list[Turn] = Field(default_factory=list, max_length=20)
    language: Literal["en", "sw"] = "en"


def create_app(assistant=None):
    app = FastAPI(title="KIU Voice Assistant")
    state = {"assistant": assistant}

    def get_assistant():
        if state["assistant"] is None:
            state["assistant"] = Assistant(KnowledgeBase.from_jsonl(PAGES_PATH))
        return state["assistant"]

    @app.get("/api/health")
    def health():
        kb = get_assistant().kb
        return {"pages": kb.page_count, "chunks": len(kb.chunks), "crawled_at": kb.crawled_at}

    @app.post("/api/ask")
    def ask(q: Question):
        bot = get_assistant()
        if not bot.kb.chunks:
            raise HTTPException(503, "No website content loaded. Run crawler.py first.")
        try:
            return bot.answer(q.question.strip(), [t.model_dump() for t in q.history], q.language)
        except anthropic.RateLimitError:
            raise HTTPException(429, "The assistant is busy. Please try again in a moment.")
        except anthropic.APIStatusError as e:
            raise HTTPException(502, f"Claude API error ({e.status_code}).")
        except anthropic.APIConnectionError:
            raise HTTPException(502, "Could not reach the Claude API.")

    @app.get("/")
    def index():
        return FileResponse(HERE / "static" / "index.html")

    app.mount("/static", StaticFiles(directory=HERE / "static"), name="static")
    return app


app = create_app()
