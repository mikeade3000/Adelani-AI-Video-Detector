"""Excel workbook of the class: scores, every answer, every question asked."""
from __future__ import annotations

import io

from openpyxl import Workbook
from openpyxl.styles import Alignment, Font, PatternFill
from openpyxl.utils import get_column_letter

from .models import LessonPlan
from .store import Store

HEADER = PatternFill("solid", fgColor="1F3A5F")


def _sheet(wb, title, headers, rows, widths):
    ws = wb.create_sheet(title)
    ws.append(headers)
    for cell in ws[1]:
        cell.font = Font(bold=True, color="FFFFFF")
        cell.fill = HEADER
    for r in rows:
        # Text typed by students must never become an Excel formula.
        ws.append([("'" + v) if isinstance(v, str) and v[:1] in ("=", "+", "-", "@") else v for v in r])
    for i, w in enumerate(widths, 1):
        ws.column_dimensions[get_column_letter(i)].width = w
    for row in ws.iter_rows(min_row=2):
        for cell in row:
            cell.alignment = Alignment(wrap_text=True, vertical="top")
    ws.freeze_panes = "A2"
    return ws


def workbook(store: Store, lesson_id: str, plan: LessonPlan) -> bytes:
    meta = store.meta(lesson_id)
    wb = Workbook()
    wb.remove(wb.active)
    max_mcq = len(plan.mcqs)
    max_short = sum(q.marks for q in plan.short_questions)
    rows = []
    for s in store.scores(lesson_id):
        pct = round(100 * (s["total"] or 0) / s["max_total"], 1) if s["max_total"] else None
        rows.append([s["name"], s["matric"], s["mcq"] or 0, s["short"] or 0, s["total"] or 0,
                     max_mcq + max_short, pct, "yes" if s["answered"] else "no",
                     s["unmarked"] or 0])
    _sheet(wb, "Scores", ["Name", "Matric no.", f"MCQ (/{max_mcq})", f"Short answers (/{max_short})", "Total",
                          "Out of", "Percent", "Submitted", "Still unmarked"], rows,
           [28, 16, 10, 16, 8, 8, 9, 10, 12])

    answers = []
    for r in store.responses(lesson_id):
        q = plan.mcqs[r["qindex"]].question if r["kind"] == "mcq" else plan.short_questions[r["qindex"]].question
        answers.append([r["name"], r["matric"], f"{'MCQ' if r['kind'] == 'mcq' else 'Short'} {r['qindex'] + 1}", q,
                        r["answer"], r["score"], r["max_score"], r["feedback"], r["marked_by"]])
    _sheet(wb, "Answers", ["Name", "Matric no.", "Question", "Question text", "Answer", "Score", "Out of",
                           "Feedback", "Marked by"], answers, [24, 14, 10, 40, 50, 7, 7, 40, 11])

    qs = [[q["name"], q["matric"], q["text"], q["status"], q["answer"], q["asked"]]
          for q in store.questions(lesson_id)]
    _sheet(wb, "Questions asked", ["Name", "Matric no.", "Question", "Status", "Christine's answer", "Time"], qs,
           [24, 14, 50, 11, 60, 20])

    info = wb.create_sheet("Lesson")
    for k, v in [("Lesson", plan.title), ("Course", meta.get("course_code", "")), ("Level", meta.get("level", "")),
                 ("Students joined", len(store.students(lesson_id)))]:
        info.append([k, v])
    info.column_dimensions["A"].width = 18
    info.column_dimensions["B"].width = 60
    buf = io.BytesIO()
    wb.save(buf)
    return buf.getvalue()
