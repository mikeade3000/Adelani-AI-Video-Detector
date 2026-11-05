"""Read documents and web articles: aloud, or as text for summaries and questions."""
from __future__ import annotations

import re
from pathlib import Path

from . import I, S, tool

MAX_CHARS_FOR_MODEL = 150_000  # ~40k tokens


def extract_text(source: str) -> tuple[str, str]:
    """Return (title, text) for a file path or a web URL."""
    if source.lower().startswith(("http://", "https://")):
        import trafilatura

        downloaded = trafilatura.fetch_url(source)
        if not downloaded:
            raise ValueError(f"Couldn't download {source}.")
        text = trafilatura.extract(downloaded, include_comments=False, include_tables=True) or ""
        meta = trafilatura.extract_metadata(downloaded)
        return (meta.title if meta and meta.title else source), text

    p = Path(source).expanduser()
    if not p.exists():
        raise FileNotFoundError(f"No file at {p}.")
    ext = p.suffix.lower()
    if ext == ".pdf":
        from pypdf import PdfReader

        reader = PdfReader(str(p))
        pages = [page.extract_text() or "" for page in reader.pages]
        text = "\n\n".join(f"[Page {i + 1}]\n{t}" for i, t in enumerate(pages))
        if not text.strip() or sum(len(t) for t in pages) < 50:
            raise ValueError("This PDF seems to be scanned images, so there's no text I can read.")
    elif ext == ".docx":
        import docx

        d = docx.Document(str(p))
        text = "\n".join(par.text for par in d.paragraphs)
    elif ext in {".txt", ".md", ".csv", ".log", ".json", ".py", ".html", ".htm", ".rtf"}:
        text = p.read_text(encoding="utf-8", errors="replace")
        if ext in {".html", ".htm"}:
            text = re.sub(r"<[^>]+>", " ", text)
    else:
        raise ValueError(f"I can't read {ext} files yet. I can read PDF, Word (.docx), text and web pages.")
    return p.name, text


def chunks(text: str, size: int = 600) -> list[str]:
    """Split text into speakable pieces on sentence boundaries."""
    text = re.sub(r"\[Page \d+\]", "", text)
    sentences = re.split(r"(?<=[.!?])\s+|\n{2,}", text)
    out, buf = [], ""
    for s in sentences:
        s = " ".join(s.split())
        if not s:
            continue
        if len(buf) + len(s) > size and buf:
            out.append(buf)
            buf = s
        else:
            buf = f"{buf} {s}".strip()
    if buf:
        out.append(buf)
    return out


@tool("get_document_text",
      "Get the text of a document (PDF, Word, text file) or a web article URL, so you can summarise it, "
      "explain it, or answer questions about it.",
      source=S("full file path or web URL"))
def get_document_text(ctx, source: str) -> dict:
    title, text = extract_text(source)
    truncated = len(text) > MAX_CHARS_FOR_MODEL
    return {
        "title": title,
        "characters": len(text),
        "truncated": truncated,
        "note": (f"Only the first {MAX_CHARS_FOR_MODEL} characters are included. Tell the user the "
                 "document is long and you read the first part.") if truncated else "",
        "text": text[:MAX_CHARS_FOR_MODEL],
    }


@tool("read_aloud",
      "Read a document or web article out loud to the user, word for word, starting from a section number "
      "(0 = the beginning). The user can say 'stop' or press the stop hotkey; Christine remembers where she "
      "stopped so 'continue reading' resumes.",
      source=S("full file path or web URL"),
      start_section=I("section to start from, 0 for the beginning"))
def read_aloud(ctx, source: str, start_section: int) -> str:
    title, text = extract_text(source)
    parts = chunks(text)
    if not parts:
        return "That document has no readable text."
    start = max(0, min(start_section, len(parts) - 1))
    ctx.stop_event.clear()
    if start == 0:
        ctx.say(f"Reading {title}.")
    i = start
    for i in range(start, len(parts)):
        if ctx.stop_event.is_set():
            break
        ctx.memory.set("reading_bookmark", {"source": source, "section": i, "title": title})
        ctx.say(parts[i])
    else:
        ctx.memory.set("reading_bookmark", None)
        return f"Finished reading {title} ({len(parts)} sections)."
    return f"Stopped reading {title} at section {i} of {len(parts)}. Bookmark saved."


@tool("continue_reading", "Continue reading aloud from where Christine last stopped.")
def continue_reading(ctx) -> str:
    mark = ctx.memory.get("reading_bookmark")
    if not mark:
        return "There's nothing to continue; I finished the last document, or haven't read one yet."
    return read_aloud(ctx, mark["source"], mark["section"])
