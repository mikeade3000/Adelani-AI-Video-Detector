# Code review — CBT Platform (Lagos State promotion practice)

Findings from reviewing `Code.gs` and `index.html` as originally supplied, with the fix that was applied. Severity: **High** = security or data-integrity risk; **Medium** = wrong behaviour users will hit; **Low** = quality or maintainability.

## Security & integrity

| # | Sev | Finding | Fix |
|---|-----|---------|-----|
| 1 | High | **Scores were trusted from the browser.** `addAttempt` stored whatever `score` and `per[].correct` the client sent, so any candidate could post 100%. | The server now re-grades every attempt against the question bank (`cbtGrade`, shared with the client). It ignores the client's flags and drops duplicate question IDs and questions outside the candidate's cadre. |
| 2 | High | **The default `superadmin / changeme123` was never forced to change.** `mustChange` was stored but nothing enforced it, and `resetSuperAdmin()` even cleared it. Admins could also clear their own `mustChange` without changing their password. | The server blocks every action except bootstrap, password change and logout while `mustChange` is set. The client shows a "Choose a new password" screen. New admins and reset passwords get `mustChange`. |
| 3 | High | **Seeding ran outside the lock.** `ensureSetup_()` ran before the lock was taken, so two simultaneous first requests could seed the bank twice (which is probably why "Remove duplicates" exists). | Seeding now runs under the script lock, with a fast flag check first. |
| 4 | High | **Writes ran unlocked when the lock timed out.** The code did `try{lock.waitLock()}catch{}` and carried on, so concurrent writes could interleave and corrupt rows. | It now uses `tryLock` and returns "server busy" instead of writing unlocked. |
| 5 | Medium | **No brute-force protection on login.** | There is now a per-username lockout (8 failures → 15 minutes) via `CacheService`. |
| 6 | Medium | **Logout did not end the session.** The 30-day token stayed valid on the server after logout. | Added a `logout` action that deletes the session row. |
| 7 | Medium | **Client-chosen record IDs and fields were trusted.** `createUser`/`createAccount` accepted any `id` (collisions corrupt `findRow`), and `addQuestions` stored arbitrary JSON. | Fields are whitelisted, colliding or invalid IDs are replaced, and questions are validated (type, answer index, options) before storing. |
| 8 | Medium | **Candidates could set any cadre string**, gaining access to another cadre's bank. | The cadre and post are validated against the shared `CADRES` list on the server. |
| 9 | Medium | **Super admin could delete their own account** (lock-out). | Self-deletion and deleting super accounts are blocked. |
| 10 | Medium | **The JSONP `callback` parameter was reflected unchecked** into a JavaScript response. | It is restricted to a plain identifier. |
| 11 | Medium | **The AI-key notice was wrong in server mode.** It said "keys are stored only on this device", but the key is saved in the Config sheet. | The text is corrected; `diagnostics()` now masks the key in logs. |
| 12 | Low | **`PEPPER` hard-coded in source** (a public repo makes it public). | It is read from the `PEPPER` Script Property first, falling back to the existing value so current passwords keep working. |
| 13 | Low | **No password-length rule.** | A minimum of 8 characters on the server and client for new passwords. |
| 14 | Note | **Answers still reach the candidate's browser.** Questions arrive with their answer keys, so a determined candidate can read them in DevTools. The "content protection" script is only a deterrent. Fix #1 stops forged scores, not peeking. A full fix needs server-side exam delivery: the server picks the questions, strips the answers and reveals the key only after submission. | Not done — it is a larger redesign. Recommended if the platform is ever used for real assessment rather than practice. |
| 15 | Note | **Login sends the password in a GET URL** (the JSONP transport), which can end up in logs. | Not changed: the POST path's cross-origin behaviour couldn't be verified against a live deployment from here. Consider moving `login` to `apiPost`. |

## Bugs

| # | Sev | Finding | Fix |
|---|-----|---------|-----|
| 16 | Medium | **Drag-and-drop ordering never worked.** The content-protection `dragstart` handler cancelled every drag outside form fields, including the list items. Only the arrow buttons worked. | Drags inside `.dnd` lists are allowed. |
| 17 | Medium | **`esc()` was applied to text nodes**, so "Admin & Human Resources" displayed as `Admin &amp; Human Resources` in the candidate header, the Manage dialog, "Signed in as" and the bank's "Answer:" lines. | `esc()` was removed where text goes through `el()`; it is kept only for `innerHTML`. |
| 18 | Medium | **Timer/modal race.** If time ran out while the "Submit?" dialog was open, clicking "Submit now" called `gradeAndReview()` with `EXAM = null` and crashed. Logging out mid-exam left the interval running. | `gradeAndReview` is guarded, closes open dialogs, and the timer is stopped on logout. |
| 19 | Medium | **Short-answer matching stripped all dots.** `"3.5"` matched `"35"`, and `"300.00"` only worked by accident. | A new normaliser compares numbers by value (handling ₦ and thousands commas) and strips only surrounding punctuation from text. |
| 20 | Medium | **CSV true/false regex had an operator-precedence bug.** `/^t|true|1|yes$/` made `"10"` or `"not true"` count as TRUE. | Anchored alternatives are used, and the row is rejected if it is neither TRUE nor FALSE. |
| 21 | Low | **Ordering questions counted as "answered" before the candidate touched them**, and could be shown already in the correct order (a free mark). | The question is "answered" only after a reorder or "This order is my answer", and the display order never starts correct. |
| 22 | Low | **MCQ options were never shuffled.** Most seeded MCQs (272 of 402, including the new banks) are keyed to option B, so position alone was a strong hint. | Options are shuffled per session; answers are still stored as the original index. |
| 23 | Low | **Matching "— choose —" counted as answered**, because it stored an empty string. | The key is removed instead. |
| 24 | Low | **"Your answer" for MCQs showed a letter (A–D)** while "Correct answer" showed text. | Option text is shown for both. |
| 25 | Low | **A session claimed to span "all subject areas" but drew questions at random.** | Questions are now drawn round-robin across categories. |
| 26 | Low | **The bank listed only the first 300 items** with no indication. | It now says "Showing the first 300 of N — narrow the filters". |
| 27 | Low | **No server validation of `examLength` / `durationMins`.** | They are validated (1–150 / 1–600). The 150 cap also keeps an attempt under Google Sheets' 50,000-character cell limit. |
| 28 | Low | **Seeding appended rows one at a time** (`appendRow` per question). With the new banks this would exceed the client's 25-second timeout on first load. | Uses a single `setValues` call (`appendMany`). |

## Question-content corrections

* **ICT, IPv4 question:** option 3 had become a Markdown link (`[www.gov.ng](https://www.gov.ng)`) through copy-paste.
* **Disciplinary ordering:** ranked Suspension *below* Interdiction. Under the PSR, interdiction is at least half pay pending investigation and suspension is no pay where dismissal or prosecution is in view, so the order is now Query → Warning → Interdiction → Suspension → Dismissal.

Existing databases get both corrections automatically, once (`SEED_PATCHES_V2`).

## Worth checking yourself

* The **Administrative Officer** and **Youth Development** ladders top out at Director on GL 16; every other cadre has Director on GL 17. Confirm against the current Lagos scheme of service.
* The **law-enforcement grade ladders** (LASTMA, VIS, enforcement, LNSC) are built on the standard Lagos GL pattern. The exact post titles were not publicly verifiable, so confirm them with each agency's HR.
* The ICT question "Put the basic steps of sending an email in the correct order" has steps (recipient / subject / body) that can be done in any order, so it is unfair as an exact-order question. Consider deleting it.

## Structure

The CADRES list, the base and ICT question banks were **duplicated** between `Code.gs` and `index.html`, and had already drifted (e.g. the client seeded ICT via a different path). They now live in shared files used by both sides:

* `cbt-shared.js` — cadres, scope groups, grading, base + ICT banks
* `cbt-bank-permsec.js` — Permanent Secretary bank
* `cbt-bank-law-enforcement.js` — law-enforcement banks
