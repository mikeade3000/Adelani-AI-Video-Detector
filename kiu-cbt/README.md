# KIU CBT — online examinations with proctoring

Kampala International University's computer-based testing system: student sign-in, timed papers, camera
proctoring and recording, automatic marking of Section A, Section B (theory) page uploads and marking, a lecturer
portal, and an examinations-office admin page.

Live: **https://kiu-cbt.portals.com.ng** (students: `index.html`, staff: `admin.html`, lecturers: `lecturer.html`).

## What is in this folder

| Path | What it is |
|---|---|
| `index.html` | The student page (sign in, choose a course unit, write, upload Section B pages) |
| `admin.html` | Examinations office and lecturer portal (all the tabs below) |
| `lecturer.html`, `observe.html` | Lecturer entry link; read-only observer page |
| `assets/` | Shared scripts and styles (`common.js`, `proctor.js`, `protect.js`, `app.css`), logos |
| `samples/` | Sample upload files (questions, candidates, practice test …) |
| `config.js` | Front-end settings (the Cloudflare build fills in the address itself) |
| `apps-script/Code.gs` | The exam backend. On Cloudflare it runs inside the engine; it can also run as a Google Apps Script |
| `cloudflare/` | The Cloudflare version: `src/` (Worker, engine, storage), `tools/build.mjs`, `wrangler.toml`, `deploy.cmd` |

`cloudflare/tools/build.mjs` turns `apps-script/Code.gs` into `cloudflare/src/app.generated.js` and copies the
pages into `cloudflare/public/`; both are produced on every deploy and are not kept in the repository.

## Putting an update live (Cloudflare)

1. Get the latest version of this folder (download it from GitHub, or the zip you were sent).
2. Double-click **`cloudflare\deploy.cmd`**. The first time in a folder it installs the Cloudflare tools (about a
   minute); if a browser window asks you to allow Wrangler, click **Allow**. Wait for **DONE**.
3. Open the admin page and press **Ctrl + F5**.

Your data (accounts, questions, answers, results, recordings) lives in Cloudflare and is never touched by an update.
See `cloudflare/DEPLOY.md` for first-time set-up, email, LMS sign-in and maintenance.

## The admin page, tab by tab

- **Dashboard / Live monitor / Live proctoring**: who is signed in, writing, finished; camera tiles and alerts.
- **Lecturers / Exam uploads**: lecturer accounts and which course units have questions.
- **Students**: every student and sitting; reset passwords, reset or remove a sitting, delete recordings.
- **Exam links**: links, timetables and logins for each student; **Email exam details** to everyone at once.
- **Uploads**: the KIU registration workbook, candidates, question bank, assignments, Section B files, the
  practice test, **Change students' programme**, and **Course units not in the system**.
- **Results**: scores (CSV download) and the activity log.
- **Answer review** (superadmin only): how each student answered, question by question, against the answer key (see below).
- **Theory marking**: Section B pages and marks.
- **Timetable**: each course unit's duration, opening time and last start.
- **Settings**: duration, opening time, last start, questions per paper, marks per question, proctoring, LMS.

## Answer review

*Answer review* shows, for one course unit at a time, how the students answered — read-only, also after the
examination is over (answers are kept with each sitting):

- **Students**: each student's status, number answered and score; **View answers** lists every question on their
  paper with the option they chose, the correct option, right / wrong / not answered, and the marks. A tick box
  narrows it to the wrong and unanswered ones.
- **Questions**: for each question, how many completed papers chose A, B, C, D or nothing, and the % correct.
  *Check the key* marks a question where more students chose one wrong option than the correct one — usually a
  sign of a wrong answer key.
- **Answer key**: every question of the unit with its options, the correct option (as stored: on upload the
  correct answer is moved from A to an even spread of A–D), its marks, who set it, and on how many papers it is.
- **Downloads** (CSV): all answers (a row per student, a column per question, with the key in the first row), the
  question analysis, and the answer key.

**Superadmin only**: the tab is hidden for admins and lecturers, and the server refuses their requests. Students never see it.
Answers are shown by the option's original letter, so shuffled options on the students' screens do not affect it.

## Running an examination (summary)

1. **Uploads → Import the KIU registration workbook** (course units, lecturers, students, enrolments). Course units
   must be in the system before questions, candidates or timetable rows are uploaded for them.
2. Lecturers (or the office) upload questions. Write every question with the correct answer in `option_a`; the
   system spreads the correct answers over A–D and offers the answer key to check.
3. **Settings**: duration, opening time and **last start** (the latest a student may begin; anyone who starts before
   it still gets the full time, so the exam *ends by* last start + duration), **questions per paper** (enforced on
   every real paper, never on the practice test) and **marks per question**. All times are Kampala time (UTC+3);
   students abroad also see their own time.
4. During the exam: Live monitor and Live proctoring. Afterwards: Results, Answer review, Theory marking.

## Changing a student's programme

*Uploads → Change students' programme* reads an Excel file (the KIU VP developer-handoff workbook works as it is):
a **Students** sheet with the new programme, **Student Course Enrolments** with the new programme's course units
(by course code, or by `course_id` when the same file gives its code) and, optionally, a removals sheet. **Check file**
shows the plan and changes nothing; **Apply changes** does it. Each student is all-or-nothing, and a course unit the
student has already started is never removed.

## Recovery note

The working copy was lost on 13 Nov 2026 and rebuilt from the live deployment; see `RECOVERY.md`. Every version is
now committed to this repository.
