"""Turn uploaded course files into (a) slide images to show and (b) text Christine teaches from.

Every page or slide becomes an "asset" with an ID like S7. Lesson plans and
answers refer to these IDs, so Christine can show the right page and say
"see slide 7".
"""
from __future__ import annotations

import base64
import json
import sys
from dataclasses import asdict, dataclass
from pathlib import Path
from typing import Callable

SUPPORTED = {".pdf", ".docx", ".pptx", ".txt", ".md", ".jpg", ".jpeg", ".png", ".webp"}
IMAGE_EXT = {".jpg", ".jpeg", ".png", ".webp"}
MIN_TEXT = 40          # a page with less text than this is treated as scanned/handwritten
MAX_CORPUS_CHARS = 1_200_000


@dataclass
class Asset:
    id: str            # "S1", "S2", ...
    source: str        # original file name
    label: str         # "page 3", "slide 5", "photo"
    image: str         # file name inside the lesson's slides/ folder, or ""
    text: str          # extracted or transcribed text
    needs_vision: bool = False


Log = Callable[[str], None]
Transcriber = Callable[[bytes, str, str], str]   # (image bytes, media type, context) -> text


def _render_pdf(path: Path, out_dir: Path, prefix: str) -> list[str]:
    import pypdfium2 as pdfium

    pdf = pdfium.PdfDocument(str(path))
    names = []
    for i in range(len(pdf)):
        page = pdf[i]
        scale = 1600 / max(page.get_width(), 1)          # ~1600 px wide
        img = page.render(scale=min(scale, 3)).to_pil()
        name = f"{prefix}-p{i + 1}.jpg"
        img.convert("RGB").save(out_dir / name, quality=85)
        names.append(name)
    return names


def _export_pptx_images(path: Path, out_dir: Path, prefix: str) -> list[str]:
    """Use Microsoft PowerPoint (if installed) to save each slide as a picture."""
    if sys.platform != "win32":
        return []
    try:
        import pythoncom
        import win32com.client

        pythoncom.CoInitialize()
        app = win32com.client.DispatchEx("PowerPoint.Application")
        pres = app.Presentations.Open(str(path.resolve()), ReadOnly=True, Untitled=False, WithWindow=False)
        names = []
        for i in range(1, pres.Slides.Count + 1):
            name = f"{prefix}-s{i}.png"
            pres.Slides(i).Export(str((out_dir / name).resolve()), "PNG", 1600, 900)
            names.append(name)
        pres.Close()
        app.Quit()
        return names
    except Exception:
        return []


def _pptx_texts(path: Path) -> list[str]:
    from pptx import Presentation

    out = []
    for slide in Presentation(str(path)).slides:
        parts = []
        for shape in slide.shapes:
            if shape.has_text_frame:
                parts.extend(p.text for p in shape.text_frame.paragraphs if p.text.strip())
            if getattr(shape, "has_table", False) and shape.has_table:
                for row in shape.table.rows:
                    parts.append(" | ".join(c.text for c in row.cells))
        if slide.has_notes_slide:
            notes = slide.notes_slide.notes_text_frame.text.strip()
            if notes:
                parts.append(f"(Speaker notes: {notes})")
        out.append("\n".join(parts))
    return out


def ingest(lesson_dir: Path, log: Log, transcribe: Transcriber | None) -> list[Asset]:
    """Process every file in uploads/. Writes slides/ and assets.json. Returns the assets."""
    uploads, slides = lesson_dir / "uploads", lesson_dir / "slides"
    slides.mkdir(exist_ok=True)
    assets: list[Asset] = []

    def add(source, label, image, text):
        a = Asset(f"S{len(assets) + 1}", source, label, image, (text or "").strip())
        a.needs_vision = len(a.text) < MIN_TEXT and bool(image)
        assets.append(a)

    files = sorted(p for p in uploads.iterdir() if p.is_file())
    for n, f in enumerate(files, 1):
        ext = f.suffix.lower()
        prefix = f"f{n}"
        log(f"Reading {f.name}...")
        if ext == ".pdf":
            from pypdf import PdfReader

            texts = [(pg.extract_text() or "") for pg in PdfReader(str(f)).pages]
            images = _render_pdf(f, slides, prefix)
            for i, text in enumerate(texts):
                add(f.name, f"page {i + 1}", images[i] if i < len(images) else "", text)
        elif ext == ".pptx":
            texts = _pptx_texts(f)
            images = _export_pptx_images(f, slides, prefix)
            if not images:
                log("  (PowerPoint isn't available to make slide pictures; Christine will draw her own slides.)")
            for i, text in enumerate(texts):
                add(f.name, f"slide {i + 1}", images[i] if i < len(images) else "", text)
        elif ext == ".docx":
            import docx

            doc = docx.Document(str(f))
            # Split long Word documents into ~3000-character chunks so they can be referenced.
            chunk, part = "", 1
            for para in doc.paragraphs:
                chunk += para.text + "\n"
                if len(chunk) > 3000:
                    add(f.name, f"part {part}", "", chunk)
                    chunk, part = "", part + 1
            for table in doc.tables:
                chunk += "\n".join(" | ".join(c.text for c in r.cells) for r in table.rows) + "\n"
            if chunk.strip():
                add(f.name, f"part {part}", "", chunk)
        elif ext in (".txt", ".md"):
            add(f.name, "text", "", f.read_text(encoding="utf-8", errors="replace"))
        elif ext in IMAGE_EXT:
            from PIL import Image, ImageOps

            name = f"{prefix}.jpg"
            img = ImageOps.exif_transpose(Image.open(f)).convert("RGB")
            img.thumbnail((2000, 2000))
            img.save(slides / name, quality=88)
            add(f.name, "photo", name, "")
        else:
            log(f"  Skipped {f.name}: unsupported file type.")

    # Scanned pages and photos of handwritten notes: ask Claude to read them.
    to_read = [a for a in assets if a.needs_vision]
    if to_read and transcribe is None:
        log(f"{len(to_read)} page(s) look scanned or handwritten, but no AI is available to read them.")
    for i, a in enumerate(to_read, 1):
        if transcribe is None:
            break
        log(f"Reading handwriting/scanned page {i} of {len(to_read)} ({a.source}, {a.label})...")
        data = (slides / a.image).read_bytes()
        a.text = transcribe(data, "image/jpeg" if a.image.endswith(".jpg") else "image/png",
                            f"{a.source}, {a.label}")
        a.needs_vision = False

    (lesson_dir / "assets.json").write_text(json.dumps([asdict(a) for a in assets], indent=1), encoding="utf-8")
    log(f"Done reading: {len(assets)} pages/slides from {len(files)} file(s).")
    return assets


def load_assets(lesson_dir: Path) -> list[Asset]:
    p = lesson_dir / "assets.json"
    if not p.exists():
        return []
    return [Asset(**a) for a in json.loads(p.read_text(encoding="utf-8"))]


def corpus(assets: list[Asset]) -> str:
    """All course text, each part tagged with its ID so Claude can cite it."""
    text = "\n\n".join(f"=== [{a.id}] {a.source}, {a.label} ===\n{a.text}" for a in assets if a.text.strip())
    if len(text) > MAX_CORPUS_CHARS:
        raise ValueError(f"The course material is very long ({len(text):,} characters). Please split it into "
                         "smaller lessons (for example one chapter or unit each).")
    return text


def image_b64(path: Path) -> str:
    return base64.standard_b64encode(path.read_bytes()).decode("ascii")
