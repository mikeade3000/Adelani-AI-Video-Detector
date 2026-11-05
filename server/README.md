# SQL Quest server

Node.js API + PostgreSQL storage + server-side auto-grader for [SQL Quest](../sql-quest/).

```bash
npm ci --omit=dev
DATABASE_URL=postgres://user:pass@localhost:5432/sqlquest ADMIN_PASSWORD='choose-one' npm start
```

Then open http://localhost:3000. Full instructions, all environment variables, Docker and hosting:
[Installation Guide](../docs/INSTALLATION-GUIDE.md).

| File | Purpose |
|---|---|
| `src/index.js` | HTTP server, sessions, API (`/api/state`, `/api/act/:name`, `/api/export`, `/api/health`), static files |
| `src/shared.js` | Loads the game's own rules from `../sql-quest/js` into Node, and removes answers from the content sent to browsers |
| `src/view.js` | Decides what each role may see |
| `src/persist.js` | PostgreSQL schema, loading, and saving changed rows in transactions |
| `src/sandbox.js`, `src/sandbox-worker.js` | Worker-thread pool that runs student SQL in throwaway SQLite databases with time, memory and row limits |
| `scripts/reset-password.js` | Emergency password reset (run with the server stopped) |
| `test/api.test.js` | End-to-end tests: `TEST_DATABASE_URL=postgres://… npm test` (wipes that database) |
