# Hosting the Handwritten Theory Grader

The hosted version adds what a static page cannot do safely:

- **Accounts.** A super admin signs in and creates lecturer accounts (Users tab).
- **A server-side API key.** AI reading and marking run on the server, so lecturers never need or see the Anthropic key.
- **The lecturer's rubric.** Upload a marking guide (PDF, Word, photo or text) and the AI turns it into the rubric the app marks against.
- **Scan → readable → grade.** Each page is transcribed exactly as written, turned into a clean readable version, then marked question by question against the rubric. Every mark comes with the reasons and feedback for the student. The paper's formula score is kept as a cross-check.

It is one Node.js app (`server/`) that also serves the browser app (`grader/`). It runs on any host that runs Node 20+ or Docker. It needs a **persistent disk** for `DATA_DIR`, which holds accounts and usage.

## Settings (environment variables)

| Variable | Required | What it is |
|---|---|---|
| `ANTHROPIC_API_KEY` | yes, for AI features | Your key from console.anthropic.com. Set it **only** in the host's secret settings, never in the code. |
| `SUPERADMIN_EMAIL` | first start | E-mail for the first super admin account. |
| `SUPERADMIN_PASSWORD` | first start | Its password: 10+ characters with letters and numbers. You can remove it from the host after the first start; the account stays. |
| `DATA_DIR` | yes | Folder on a persistent disk (the Docker image uses `/data`). |
| `COOKIE_SECURE` | recommended | `true` on any HTTPS host (the default in production). |
| `PORT` | no | Usually set by the host. Defaults to 8080. |
| `CLAUDE_MODEL` | no | Defaults to `claude-opus-5-5`. |

## Option A: Render (simplest, about 10 minutes)

1. Push this repository to GitHub (it already is).
2. On render.com, choose **New → Blueprint**, pick this repository, and Render reads `render.yaml`.
3. When prompted, enter `ANTHROPIC_API_KEY`, `SUPERADMIN_EMAIL` and `SUPERADMIN_PASSWORD`.
4. Deploy, then open the `https://…onrender.com` address and sign in as the super admin.
5. Optional: add your own domain (e.g. `grader.youruniversity.ac.ug`) under **Settings → Custom domains**.

`render.yaml` uses a paid "starter" instance, because free instances have no persistent disk and would lose accounts on restart.

## Option B: Railway, Fly.io, DigitalOcean App Platform and similar

Deploy from this repository using the `Dockerfile` at its root. Attach a volume at `/data`, set the variables above in the host's settings, and expose port 8080.

## Option C: Your own server (VPS) with Docker

```bash
git clone https://github.com/mikeade3000/Adelani-AI-Video-Detector.git grader && cd grader
docker build -t grader .
docker run -d --name grader --restart unless-stopped -p 8080:8080 -v grader-data:/data \
  -e ANTHROPIC_API_KEY=… -e SUPERADMIN_EMAIL=… -e SUPERADMIN_PASSWORD=… grader
```

Put it behind HTTPS, for example with Caddy (`caddy reverse-proxy --from grader.example.ac.ug --to localhost:8080`) or nginx with Let's Encrypt. HTTPS is needed for secure sign-in cookies and for the phone camera.

## Option D: Without Docker

```bash
cd server && npm ci --omit=dev
ANTHROPIC_API_KEY=… SUPERADMIN_EMAIL=… SUPERADMIN_PASSWORD=… DATA_DIR=/var/lib/grader node src/index.js
```

## After deploying

1. Sign in as the super admin and change the password (top right).
2. Open **Users → Create a user** for each lecturer. Pass on the temporary password privately; they must change it at first sign-in.
3. Optionally set a monthly limit of AI-read pages per user to control cost. The Users table shows each person's usage this month.
4. Back up `DATA_DIR/db.json` regularly. Lecturers' scripts and marks stay in their own browser; they can save them with **Results → Save session**.

## Security notes

- Passwords are stored as salted scrypt hashes. Session cookies are HttpOnly, SameSite=Strict and Secure. Five failed sign-ins lock that e-mail for 15 minutes.
- Every change request needs a custom header (CSRF protection). Strict security headers and a Content-Security-Policy are set.
- The Anthropic key is read from the environment only and is never sent to browsers.
- Page images go to the server and on to Anthropic only when the AI reader is used. Check this against your institution's data-protection rules.

## Running the tests

```bash
cd server && npm install && npm test   # accounts, permissions, AI routes (Claude API stubbed)
cd ../grader && npm test               # scoring, statistics, preprocessing
```
