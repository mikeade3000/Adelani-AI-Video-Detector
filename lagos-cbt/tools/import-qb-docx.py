#!/usr/bin/env python3
"""Convert the 'Question Bank with Answers' Word document into cbt-bank-qb2026.js.

Usage:
  pandoc Question_Bank_with_Answers.docx -t plain --wrap=none -o qb.txt
  python3 -I tools/import-qb-docx.py qb.txt cbt-bank-qb2026.js

The document numbers questions 1..268 across six subject sections. Each
question has options "a." to "d." and a line "Answer: (x) text". Questions
damaged in the source photos are repaired by the FIXES table below, or left
out (SKIP) when they cannot be answered.
"""
import json, re, sys

SET_ID = "QB-2026-11"   # identifies this bank and the 'first session' built from it

SECTIONS = {
    "Lagos State Public Procurement Law": "Lagos State Public Procurement Law",
    "Public Service Rules": "Lagos State Civil Service Rules",
    "Financial Regulations": "Lagos State Financial Regulations",
    "Schemes of Service": "Schemes of Service",
    "Circulars": "Circulars",
    "Developmental Objectives": "Developmental Objectives",
}

# Question 149: the numbered statements I-III were never captured, so it has no determinable answer.
SKIP = {149}

# Repairs, keyed by question number. 'stem' replaces the stem; 'options' replaces the option
# list (the answer is then given by 'answer', a 0-based index into the new list).
FIXES = {
    4: {"stem": "What is the main purpose of keeping procurement records?"},
    90: {"options": [
        "A procedural deficiency in the Ministry's medical referral arrangements.",
        "An irregularity in the computation of the officer's leave balance.",
        "An act of misconduct involving the falsification or fraudulent use of supporting documentation."],
        "answer": 2},
    103: {"options": [
        "The officer's refusal to respond automatically establishes guilt without further consideration.",
        "The disciplinary process becomes invalid because the officer has not acknowledged the allegations.",
        "The officer forfeits the opportunity to be heard, and the disciplinary authority may proceed to determine the matter on the available evidence."],
        "answer": 2},
    134: {"stem": "Which of the following is required of a newly appointed officer under the Public Service Rules?"},
    135: {"stem": "The leave year in the Lagos State Public Service runs from"},
    157: {"stem": "An irregularity is discovered in the entries of a vote. What should be the IMMEDIATE response?"},
    193: {"options": [
        "Whether the balances were eventually remitted in full to the appropriate Government account.",
        "Whether the arrangement expedited the safe-keeping of the receipts and improved operational efficiency.",
        "Whether the account was disclosed to the auditors during the next inspection.",
        "That the account was opened without authority, in breach of the rules on the custody of public funds."],
        "answer": 3},
}

SEC_RE = re.compile(r"^\d\. (" + "|".join(re.escape(k) for k in SECTIONS) + r")\s*$")


def parse(lines):
    sec, cur, out = None, None, []
    for raw in lines:
        line = raw.rstrip()
        m = SEC_RE.match(line)
        if m:
            sec = m.group(1); continue
        if sec is None:
            continue
        m = re.match(r"^(\d+)\. (.*)$", line)
        if m and not line.startswith(" "):
            cur = {"n": int(m.group(1)), "sec": sec, "stem": m.group(2).strip(), "opts": [], "ans": None}
            out.append(cur); continue
        if cur is None:
            continue
        s = line.strip()
        if not s:
            continue
        m = re.match(r"^([a-h])\. (.*)$", s)
        if m and cur["ans"] is None:
            cur["opts"].append(m.group(2).strip()); continue
        m = re.match(r"^Answer:\s*(.*)$", s)
        if m:
            cur["ans"] = m.group(1).strip(); continue
        if cur["ans"] is None and not cur["opts"]:
            cur["stem"] += " " + s
    return out


def convert(q):
    fix = FIXES.get(q["n"], {})
    confirm = bool(re.search(r"Confirm again", q["ans"] or ""))
    stem = fix.get("stem", q["stem"])
    if "options" in fix:
        opts, ans = fix["options"], fix["answer"]
    else:
        m = re.match(r"^\(([a-h])\)", q["ans"] or "")
        if not m:
            raise SystemExit(f"Q{q['n']}: unreadable answer {q['ans']!r} - add it to FIXES or SKIP")
        letter_index = "abcdefgh".index(m.group(1))
        keep = [(i, o) for i, o in enumerate(q["opts"])
                if "option not captured" not in o and "[option repeated on screen]" not in o]
        opts = [o for _, o in keep]
        ans = [i for i, _ in keep].index(letter_index)
    if re.search(r"\[.*(not captured|blurred).*\]", stem) or any("[" in o for o in opts):
        raise SystemExit(f"Q{q['n']}: photo note still present - add a FIX")
    if len(opts) < 2 or len(set(o.lower() for o in opts)) != len(opts):
        raise SystemExit(f"Q{q['n']}: needs at least two distinct options")
    expl = f"Correct answer: {opts[ans]}"
    if confirm:
        expl += " (This answer depends on a specific circular or rule figure; confirm it against the current circular.)"
    return {"scope": "COMMON", "set": SET_ID, "category": SECTIONS[q["sec"]], "type": "mcq",
            "difficulty": "medium", "stem": stem, "options": opts, "answer": ans,
            "explanation": expl, "srcNo": q["n"]}


def main():
    src, dst = sys.argv[1], sys.argv[2]
    raw = parse(open(src, encoding="utf-8").read().split("\n"))
    if len(raw) != 268:
        raise SystemExit(f"expected 268 questions, found {len(raw)}")
    qs = [convert(q) for q in raw if q["n"] not in SKIP]
    body = ",\n".join(json.dumps(q, ensure_ascii=False) for q in qs)
    with open(dst, "w", encoding="utf-8") as f:
        f.write(f"""/* ============================================================
   2026 QUESTION BANK — imported from 'Question Bank with Answers' (Word)
   {len(qs)} questions, scope COMMON (every user), set "{SET_ID}".
   Every user's first practice session after this update is this whole set,
   in the document's order. GENERATED by tools/import-qb-docx.py — edit the
   Word file or the FIXES table there, then regenerate; do not edit by hand.
   Shared file (browser + Apps Script).
   ============================================================ */
var QB_SET_ID="{SET_ID}";
var SEED_QB2026=[
{body}
];
""")
    print(f"wrote {len(qs)} questions to {dst}")


main()
