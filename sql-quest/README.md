# SQL Quest — a gamified database learning platform

SQL Quest teaches database concepts to computer-education students through play:
**learn** a short lesson → **practise** in a game challenge → get **instant feedback** from the auto-grader →
**earn** XP, badges and streak points → **unlock** the next level.

It is a complete static web app (HTML + CSS + JavaScript). Students run **real SQL** against a real
SQLite database compiled to WebAssembly ([sql.js](https://github.com/sql-js/sql.js), included in `vendor/`), so no server is needed.

![Student dashboard](screenshots/03-student-dashboard.jpg)

## Upload to a website

1. Upload the **contents of this `sql-quest` folder** (keep the sub-folders) to any web host:
   Netlify, Vercel, GitHub Pages, cPanel/`public_html`, Hostinger, InfinityFree, etc.
2. Open the site's address. That's it.

> Open it through a web address (`https://…` or `http://localhost`), not by double-clicking `index.html`.
> Browsers block the database engine on `file://` pages. To test on your own computer, run
> `python3 -m http.server 8000` inside this folder and open http://localhost:8000.

### Demo accounts

| Role | Username | Password |
|---|---|---|
| Student | `student` | `student123` |
| Teacher | `teacher` | `teacher123` |
| Admin | `admin` | `admin123` |

Nine more demo students (`amaka`, `tunde`, `zainab`, `chinedu`, `fatima`, `grace`, `ibrahim`, `ngozi`, `samuel`, password `student123`)
have progress already, so leaderboards and analytics show data. Demo class codes are **DBQ-201** and **DBQ-202**.

**Before going live:** log in as admin → **Settings** → untick “Show demo accounts”, and change the admin password
(Profile → Change password). Admin → Settings → “Reset platform to demo data” restores everything.

## What's included (mapped to the design document)

| Design document | Implemented |
|---|---|
| Core loop | Lesson → challenge → instant feedback → XP/badges/streak → unlock |
| 5 Worlds | Data Village (tables, rows, columns, keys) · Query Canyon (SELECT, WHERE, ORDER BY) · Join Jungle (INNER/LEFT JOIN, 1:N, M:N) · Design Citadel (ER diagrams, normalization) · Vault Summit (transactions, indexes, security) |
| Boss battles | A timed boss at the end of each world: 4 questions, shared lives, time & lives bonuses |
| XP & levels | XP per challenge plus speed and accuracy bonuses; 9 level titles |
| Badges | 14 badges (First Query, First JOIN, Ten-Day Streak, Boss Slayer, …); admins can edit them or add more |
| Daily streaks | Consecutive-day tracking, best streak, 4-week activity calendar |
| Leaderboards | Class and global rankings with a podium |
| Lives & hints | 3 lives per challenge (retry after losing all lives = reduced XP); hints cost XP |
| Mission types | Write a query · Fix a broken query · Drag & drop (ER diagram, keys, relationships, normal forms) · Multiple choice · Short answer |
| Sandbox database | A fresh SQLite database for every run (reset after each challenge), running in a Web Worker |
| Auto-grader | Compares your result set with the model solution's result. Accepts any row order unless sorting is required, columns in a different order, aliases, and comma joins. Checks the database state after INSERT/UPDATE/CREATE scripts. Gives targeted feedback (missing JOIN condition, INNER vs LEFT, missing WHERE/LIMIT, wrong ORDER BY, unquoted text, …) |
| Student role | Register, join a class by code, lessons, challenges, hints, retries, progress dashboard with weak topics, leaderboard |
| Team sub-roles | Team missions: members draft together, the **team leader** submits, every member earns XP. **Peer reviewers** rate a classmate's shared query anonymously for bonus XP |
| Teacher role | Create classes with join codes, assign worlds (with due date and optional early unlock), manage teams, analytics, create and edit lessons and challenges |
| Admin role | Manage users and roles, reset passwords, disable or delete accounts, publish or hide any challenge, configure badges, platform settings, backup export/import |
| Analytics | Most common errors, pass rate by world, average time per level, weakest topics, students who may need help |
| Safety | Blocked commands (DROP TABLE/DATABASE, ATTACH, PRAGMA, …; admins can change the list), per-challenge allowed statement types, query time limit (runaway queries are stopped), salted + hashed passwords, role check on every page |
| Responsive | Works on phones and desktops, with light and dark mode |

## Important: where data is stored

This version keeps all data (accounts, progress, classes) in **each browser's local storage**. It works out of the box
on any static host, but data is **not shared between devices**: a student on their phone and a teacher on a laptop
will not see each other's progress. Role checks also run in the browser, which is fine for a classroom or demo but not
for high-stakes grading.

For a real multi-device class, add a backend (for example Node.js + PostgreSQL, as the design document suggests).
All data access goes through one module, `js/store.js`, so it can be replaced with API calls without touching the game.
In the meantime, admins can move data between devices with **Settings → Export / Import backup**.

## Project structure

```
sql-quest/
├── index.html             App shell
├── css/style.css          Styles (light and dark themes, responsive)
├── js/content.js          Curriculum: sandbox data, 5 worlds, lessons, 30 challenges, 5 bosses, badges, team missions
├── js/store.js            Data layer (localStorage), password hashing, demo seed
├── js/engine.js           Unlocking, XP, levels, badges, analytics
├── js/grader.js           Sandbox runner (Web Worker + time limit) and auto-grader
├── js/sandbox-worker.js   Runs each query in a fresh SQLite database
├── js/app.js              Router with role checks, login, student screens
├── js/play.js             Challenge player, boss battles, team missions
├── js/teacher.js          Classes, assignments, teams, analytics, content editor
├── js/admin.js            Users, content, badges, settings
├── vendor/                sql.js 1.10.3 (SQLite → WebAssembly, MIT licence)
└── screenshots/           Sample of every screen
```

## Adding content

- **Without code:** log in as a teacher → **Content** → *New challenge* / *New lesson*. Use “Test solution” to preview the result.
- **In code:** add challenges to `SQ.WORLDS` in `js/content.js`. For a `query`/`fix` challenge you only write the
  model `solution`; the grader runs it to get the expected result.

## Screens

| | |
|---|---|
| ![](screenshots/01-login.jpg) Login | ![](screenshots/04-world-map.jpg) World map |
| ![](screenshots/05-lesson.jpg) Lesson | ![](screenshots/06-sql-challenge-feedback.jpg) SQL challenge with feedback |
| ![](screenshots/07-reward.jpg) Reward | ![](screenshots/10-drag-drop-keys.jpg) Drag & drop |
| ![](screenshots/14-boss-battle.jpg) Boss battle | ![](screenshots/16-leaderboard.jpg) Leaderboard |
| ![](screenshots/26-teacher-analytics.jpg) Teacher analytics | ![](screenshots/31-admin-users.jpg) Admin users |

All 37 screens are in [`screenshots/`](screenshots/).
