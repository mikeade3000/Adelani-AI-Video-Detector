import json
import sys
import threading
from functools import partial
from http.server import SimpleHTTPRequestHandler, ThreadingHTTPServer
from pathlib import Path
from types import SimpleNamespace

sys.path.insert(0, str(Path(__file__).resolve().parent.parent))

from fastapi.testclient import TestClient

import crawler
from assistant import Assistant
from knowledge import KnowledgeBase, chunk_text
from server import create_app

PAGES = [
    {"url": "https://kiu.ac.ug/fees", "title": "Tuition Fees",
     "text": "Bachelor of Medicine tuition is 5,500,000 UGX per semester.\nFunctional fees are 650,000 UGX."},
    {"url": "https://kiu.ac.ug/admissions", "title": "Admissions",
     "text": "Applications for the August intake close on 30 July.\nApply online through the admissions portal."},
    {"url": "https://kiu.ac.ug/campuses", "title": "Campuses",
     "text": "KIU has campuses in Kansanga (Kampala), Ishaka-Bushenyi (Western Campus) and Dar es Salaam."},
]


class FakeMessages:
    """Stands in for client.beta.messages; replies are returned in order, the last one repeats."""

    def __init__(self, reply="Tuition is five and a half million shillings.", stop_reason="end_turn"):
        self.calls, self.stop_reason = [], stop_reason
        self.replies = list(reply) if isinstance(reply, list) else [reply]

    def create(self, **kwargs):
        self.calls.append(kwargs)
        text = self.replies[min(len(self.calls), len(self.replies)) - 1]
        return SimpleNamespace(stop_reason=self.stop_reason,
                               content=[SimpleNamespace(type="text", text=text)])


def fake_client(**kw):
    messages = FakeMessages(**kw)
    return SimpleNamespace(beta=SimpleNamespace(messages=messages)), messages


def test_search_ranks_relevant_page_first():
    kb = KnowledgeBase(PAGES)
    assert kb.search("how much is tuition for medicine")[0]["url"] == "https://kiu.ac.ug/fees"
    assert kb.search("when do applications close")[0]["url"] == "https://kiu.ac.ug/admissions"
    assert kb.search("the of and") == []


def test_chunking_keeps_all_text():
    text = "\n".join(f"Line number {i} with some words" for i in range(300))
    chunks = chunk_text(text, size=500, overlap=50)
    assert len(chunks) > 5 and all(len(c) <= 750 for c in chunks)
    assert "Line number 299" in chunks[-1]


def test_assistant_sends_grounded_request():
    client, messages = fake_client()
    bot = Assistant(KnowledgeBase(PAGES), client=client)
    history = [{"role": "user", "content": "Tell me about medicine"},
               {"role": "assistant", "content": "KIU offers medicine."}]
    out = bot.answer("How much are the fees?", history)

    assert out["answer"].startswith("Tuition")
    assert out["sources"][0]["url"] == "https://kiu.ac.ug/fees"
    call = messages.calls[0]
    assert call["model"] == "claude-opus-5-5"
    assert call["fallbacks"] == "default" and call["betas"] == ["server-side-fallback-2026-07-01"]
    assert [m["role"] for m in call["messages"]] == ["user", "assistant", "user"]
    assert "5,500,000 UGX" in call["messages"][-1]["content"]


def test_swahili_question_is_translated_for_search_and_answered_in_swahili():
    client, messages = fake_client(reply=["tuition fees medicine", "Ada ni shilingi milioni tano na nusu."])
    out = Assistant(KnowledgeBase(PAGES), client=client).answer("Ada ya udaktari ni kiasi gani?", language="sw")

    assert out["answer"].startswith("Ada")
    assert out["sources"][0]["url"] == "https://kiu.ac.ug/fees"
    translate, reply = messages.calls
    assert translate["messages"][0]["content"] == "Ada ya udaktari ni kiasi gani?"
    assert "Reply language: Kiswahili" in reply["messages"][-1]["content"]


def test_english_question_skips_translation():
    client, messages = fake_client()
    Assistant(KnowledgeBase(PAGES), client=client).answer("fees?", language="en")
    assert len(messages.calls) == 1
    assert "Reply language: English" in messages.calls[0]["messages"][-1]["content"]


def test_swahili_refusal_reply_is_in_swahili():
    client, _ = fake_client(reply="", stop_reason="refusal")
    out = Assistant(KnowledgeBase(PAGES), client=client).answer("ada?", language="sw")
    assert out["answer"].startswith("Samahani")


def test_refusal_gets_safe_reply():
    client, _ = fake_client(reply="", stop_reason="refusal")
    out = Assistant(KnowledgeBase(PAGES), client=client).answer("fees?")
    assert "contact the university" in out["answer"]


def test_api_endpoints():
    client, _ = fake_client()
    app = create_app(Assistant(KnowledgeBase(PAGES), client=client))
    http = TestClient(app)
    assert http.get("/api/health").json()["pages"] == 3
    r = http.post("/api/ask", json={"question": "tuition fees?"})
    assert r.status_code == 200 and r.json()["answer"]
    assert http.post("/api/ask", json={"question": ""}).status_code == 422
    assert http.post("/api/ask", json={"question": "ada?", "language": "sw"}).status_code == 200
    assert http.post("/api/ask", json={"question": "hi", "language": "fr"}).status_code == 422
    assert "KIU Voice Assistant" in http.get("/").text


def test_api_without_content_returns_503():
    client, _ = fake_client()
    http = TestClient(create_app(Assistant(KnowledgeBase([]), client=client)))
    assert http.post("/api/ask", json={"question": "hi"}).status_code == 503


def test_crawler_on_local_site(tmp_path):
    site = tmp_path / "site"
    (site / "about").mkdir(parents=True)
    filler = "Kampala International University is a chartered private university. " * 3
    (site / "index.html").write_text(
        f"<html><head><title>Home</title></head><body><nav>Menu</nav><main><p>{filler}</p>"
        '<a href="/about/">About</a><a href="https://example.com/x">Out</a><a href="/logo.png">L</a>'
        "</main></body></html>")
    (site / "about" / "index.html").write_text(
        f"<html><head><title>About</title></head><body><p>Founded in 2001. {filler}</p></body></html>")
    (site / "robots.txt").write_text("User-agent: *\nDisallow:\n")

    handler = partial(SimpleHTTPRequestHandler, directory=str(site))
    handler.log_message = lambda *a: None
    server = ThreadingHTTPServer(("127.0.0.1", 0), handler)
    threading.Thread(target=server.serve_forever, daemon=True).start()
    try:
        out = tmp_path / "pages.jsonl"
        saved = crawler.crawl(f"http://127.0.0.1:{server.server_port}/", {"127.0.0.1"}, out,
                              delay=0, log=lambda *a: None)
    finally:
        server.shutdown()

    pages = [json.loads(l) for l in out.read_text().splitlines()]
    assert saved == 2
    assert {p["title"] for p in pages} == {"Home", "About"}
    assert all("Menu" not in p["text"] for p in pages)
