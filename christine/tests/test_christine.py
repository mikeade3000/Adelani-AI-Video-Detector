import os
from pathlib import Path
from types import SimpleNamespace

import pytest

from christine.config import load_config
from christine.memory import Memory
from christine.monitor import BatteryMonitor
from christine.safety import double_confirm, protected_reason
from christine.tools import REGISTRY, ToolContext, load_all, run_tool
from christine.tools.files import FileIndex

load_all()


def answers(*replies):
    it = iter(replies)
    asked = []

    def ask(q):
        asked.append(q)
        return next(it)
    ask.asked = asked
    return ask


@pytest.fixture
def ctx(tmp_path):
    cfg = load_config(tmp_path / "data")
    mem = Memory(tmp_path / "data" / "memory.db")
    docs = tmp_path / "docs"
    docs.mkdir()
    (docs / "Tax Return 2025.pdf").write_text("x")
    (docs / "holiday photo.jpg").write_text("x")
    (docs / "Projects").mkdir()
    (docs / "Projects" / "budget plan.xlsx").write_text("x")
    idx = FileIndex(tmp_path / "data" / "files.db", [docs])
    idx.rebuild()
    said = []
    c = ToolContext(config=cfg, memory=mem, ask=answers(), say=said.append, file_index=idx)
    c.said = said
    c.docs = docs
    return c


# ---- double confirmation ----------------------------------------------------

def test_double_confirm_needs_both_answers():
    assert double_confirm(answers("yes", "confirm delete"), "x")[0] is True
    assert double_confirm(answers("no", "confirm delete"), "x")[0] is False
    assert double_confirm(answers("yes", "yes"), "x")[0] is False          # 2nd needs "confirm"
    assert double_confirm(answers("yes", "don't confirm"), "x")[0] is False
    assert double_confirm(answers("", ""), "x")[0] is False
    assert double_confirm(answers("hmm maybe", "confirm"), "x")[0] is False


def test_double_confirm_asks_exactly_twice():
    ask = answers("yes please", "confirm delete")
    double_confirm(ask, "the file a.txt")
    assert len(ask.asked) == 2 and "Second confirmation" in ask.asked[1]


def test_protected_paths():
    home = Path.home()
    assert protected_reason(home)
    assert protected_reason(home / "Documents")
    assert protected_reason(Path(Path.cwd().anchor))
    assert protected_reason(home / "AppData" / "Roaming" / "x")
    assert protected_reason(home / "Documents" / "some file.txt") is None


# ---- delete tool --------------------------------------------------------------

def test_delete_cancelled_at_first_question(ctx):
    target = ctx.docs / "holiday photo.jpg"
    ctx.ask = answers("no")
    out, err = run_tool(ctx, "delete_path", {"path": str(target)})
    assert target.exists() and "Not deleted" in out and not err


def test_delete_cancelled_at_second_question(ctx):
    target = ctx.docs / "holiday photo.jpg"
    ctx.ask = answers("yes", "cancel")
    out, _ = run_tool(ctx, "delete_path", {"path": str(target)})
    assert target.exists() and "second confirmation" in out


def test_delete_after_two_confirmations(ctx, monkeypatch):
    trashed = []
    import send2trash
    monkeypatch.setattr(send2trash, "send2trash", lambda p: (trashed.append(p), os.remove(p)))
    target = ctx.docs / "holiday photo.jpg"
    ctx.ask = answers("yes", "confirm delete")
    out, _ = run_tool(ctx, "delete_path", {"path": str(target)})
    assert trashed == [str(target)] and "Recycle Bin" in out
    assert ctx.memory.last_action("delete")["detail"]["path"] == str(target)
    assert not any("holiday" in r["path"] for r in ctx.file_index.search("holiday"))


def test_delete_refuses_protected(ctx):
    ctx.ask = answers()  # must never be asked
    out, _ = run_tool(ctx, "delete_path", {"path": str(Path.home())})
    assert out.startswith("Refused")


def test_forget_memory_needs_two_confirmations(ctx):
    fid = ctx.memory.remember("Likes jollof rice", "preference")
    ctx.ask = answers("yes", "no")
    run_tool(ctx, "forget", {"memory_id": fid})
    assert ctx.memory.get_fact(fid)
    ctx.ask = answers("yes", "confirm")
    run_tool(ctx, "forget", {"memory_id": fid})
    assert ctx.memory.get_fact(fid) is None


# ---- files, memory, reader ------------------------------------------------------

def test_find_files(ctx):
    res = ctx.file_index.search("tax return")
    assert res and res[0]["path"].endswith("Tax Return 2025.pdf")
    assert ctx.file_index.search("budget", kind="spreadsheet")[0]["path"].endswith("budget plan.xlsx")
    assert ctx.file_index.search("projects", kind="folder")[0]["type"] == "folder"


def test_memory_roundtrip(ctx):
    ctx.memory.remember("The user's name is Ade", "personal")
    ctx.memory.remember("The user's name is Ade", "personal")  # no duplicates
    assert len(ctx.memory.recall("name")) == 1
    assert "Ade" in ctx.memory.profile_text()


def test_read_aloud_and_bookmark(ctx):
    doc = ctx.docs / "manual.txt"
    doc.write_text("First sentence. " * 80 + "\n\nLast part here.")
    out, _ = run_tool(ctx, "read_aloud", {"source": str(doc), "start_section": 0})
    assert "Finished" in out and len(ctx.said) >= 3
    assert ctx.memory.get("reading_bookmark") is None


def test_continue_reading_resumes_from_bookmark(ctx):
    doc = ctx.docs / "manual.txt"
    doc.write_text("Alpha sentence. " * 80 + "\n\nOmega ending.")
    ctx.memory.set("reading_bookmark", {"source": str(doc), "section": 2, "title": "manual.txt"})
    out, _ = run_tool(ctx, "continue_reading", {})
    assert "Finished" in out and ctx.said[-1].endswith("Omega ending.")


def test_tool_schemas_are_strict():
    for t in REGISTRY.values():
        s = t.schema()
        assert s["input_schema"]["additionalProperties"] is False
        assert set(s["input_schema"]["required"]) == set(s["input_schema"]["properties"])
        assert len(s["description"]) > 20, t.name


def test_invalid_args_rejected(ctx):
    out, err = run_tool(ctx, "delete_path", {"oops": 1})
    assert err


# ---- battery monitor ---------------------------------------------------------------

def test_battery_monitor_warns_once_per_level():
    import queue
    m = BatteryMonitor([20, 10, 5], queue.Queue())
    assert m.check({"present": True, "percent": 50, "plugged_in": False}) == []
    assert "Heads up" in m.check({"present": True, "percent": 19, "plugged_in": False})[0]
    assert m.check({"present": True, "percent": 18, "plugged_in": False}) == []
    assert "very low" in m.check({"present": True, "percent": 9, "plugged_in": False})[0]
    assert "connected" in m.check({"present": True, "percent": 9, "plugged_in": True})[0]


# ---- router ---------------------------------------------------------------------------

def test_router(ctx):
    from christine.router import route
    assert route("stop", ctx)[0] == "stop"
    assert route("What time is it?", ctx)[0] == "handled"
    assert route("how's my battery", ctx)[0] == "handled"
    assert route("open my tax document", ctx)[0] == "brain"
    assert route("delete the budget file", ctx)[0] == "brain"


def test_wake_word():
    from christine.audio.listener import split_wake_word
    aliases = ["christine", "kristine", "christina"]
    assert split_wake_word("Hey Christine, open YouTube", aliases) == (True, "open YouTube")
    assert split_wake_word("Kristine what's the time?", aliases) == (True, "what's the time")
    assert split_wake_word("christine", aliases) == (True, "")
    assert split_wake_word("open youtube", aliases)[0] is False


# ---- brain loop with a fake Claude client -----------------------------------------

def test_brain_runs_tools_then_answers(ctx):
    from christine.brain import Brain

    calls = []

    def block(**kw):
        return SimpleNamespace(**kw)

    responses = [
        SimpleNamespace(stop_reason="tool_use", content=[
            block(type="text", text="Let me look."),
            block(type="tool_use", id="t1", name="find_files",
                  input={"query": "tax return", "kind": "document", "limit": 3})]),
        SimpleNamespace(stop_reason="end_turn", content=[block(type="text", text="Found your tax return.")]),
    ]

    class FakeMessages:
        def create(self, **kw):
            calls.append(kw)
            return responses[len(calls) - 1]

    brain = Brain(ctx.config, ctx)
    brain.client = SimpleNamespace(beta=SimpleNamespace(messages=FakeMessages()))
    assert brain.chat("where is my tax return?") == "Found your tax return."
    assert ctx.said == ["Let me look."]
    tool_result = brain.messages[2]["content"][0]  # user turn carrying the tool results
    assert tool_result["type"] == "tool_result" and "Tax Return 2025.pdf" in tool_result["content"]
    assert calls[0]["output_config"] == {"effort": "low"}
    assert calls[0]["fallbacks"] == "default"
