# Hosting the Handwritten Theory Grader

The hosted version adds what a static page cannot do safely:

- **Accounts.** A super admin signs in and creates lecturer accounts (Users tab).
- **A server-side API key.** AI reading and marking run on the server, so lecturers never need or see the Anthropic key.
- **The lecturer's rubric.** Upload a marking guide (PDF, Word, photo or text) and the AI turns it into the rubric the app marks against.
- **Scan → readable → grade.** Each page is transcribed exactly as written, turned into a clean readable version, then marked question by question against the rubric. Every mark comes with the reasons and feedback for the student. The paper's formula score is kept as a cross-check.

It is one Node.js app (`server/`) that also serves the browser app (`grader/`). It runs on any host that runs Node 20+ or Docker. It needs a **persistent disk** for `DATA_DIR`, which holds accounts and usage.

## Cloudflare Workers at ma-grader.portals.com.ng (recommended)

The `worker/` folder is the Cloudflare version. The Worker serves the app and the `/api` routes, accounts live in a **Cloudflare D1** database (created automatically on the first deploy), and your Anthropic key is a **Cloudflare secret**. It was tested in Cloudflare's own runtime (workerd + D1) with the real Claude API.

**You need:**
- The **Cloudflare account that manages portals.com.ng**. The domain already uses Cloudflare's nameservers, so no DNS changes are needed.
- That account on the **Workers Paid plan (US$5/month)**. Hashing a password at a safe strength takes about 18 ms of CPU, and the free plan allows only 10 ms per request, so sign-in could fail there.

### 1. Nothing to do for the domain

On the first deploy, Cloudflare creates the `ma-grader.portals.com.ng` DNS record and its HTTPS certificate automatically. Your main site on `portals.com.ng` is not touched. If a `ma-grader` DNS record already exists in Cloudflare by then, delete it first, or the deploy will report a conflict.

### 2. Deploy from GitHub (no command line)

1. Cloudflare dashboard → **Workers & Pages → Create → Import a repository** → connect GitHub and pick `mikeade3000/Adelani-AI-Video-Detector`.
2. Settings:
   - **Production branch:** the branch that contains the `worker/` folder: `claude/sweet-johnson-1e8kdt`, or `main` once the code is merged into it. Each push to this branch redeploys the site.
   - **Root directory:** `worker` (or `/worker`). This matters: the build fails with a blank root directory, because `package.json` lives in `worker/`.
   - **Build command:** `npm ci`
   - **Deploy command:** `npx wrangler deploy`
3. Click **Deploy**. The first deploy creates the Worker, the `grader-db` database and the `ma-grader.portals.com.ng` address.

### 3. Add the secrets

Worker → **Settings → Variables and Secrets → Add**. Choose type **Secret** for each:

| Name | Value |
|---|---|
| `ANTHROPIC_API_KEY` | your key from console.anthropic.com |
| `SUPERADMIN_EMAIL` | the super admin's e-mail |
| `SUPERADMIN_PASSWORD` | 10+ characters, letters and numbers |

Saving a secret redeploys the Worker. Open **https://ma-grader.portals.com.ng**, sign in as the super admin, then change the password (top right). The `SUPERADMIN_*` secrets are only used to create the first account; you may delete them afterwards.

### Alternatively, with the command line

```bash
cd worker
npm install
npx wrangler login
npx wrangler secret put ANTHROPIC_API_KEY      # paste the key when asked
npx wrangler secret put SUPERADMIN_EMAIL
npx wrangler secret put SUPERADMIN_PASSWORD
npx wrangler deploy
```

### Local testing

Copy `worker/.dev.vars.example` to `worker/.dev.vars` (git ignores it), fill it in, then run `npx wrangler dev` and open http://localhost:8787. Run the tests with `npm test`.

### Looking after it

- **Users:** in the app, **Users** tab (super admin only).
- **Usage and cost:** the Users table shows AI-read pages per person this month. Set monthly limits there. Also set a spending limit in the Anthropic console.
- **Logs:** Worker → **Logs** in the Cloudflare dashboard.
- **Backups:** dashboard → **Storage & Databases → D1 → grader-db** (Time Travel restores to any minute in the last 30 days), or `npx wrangler d1 export grader-db --remote --output backup.sql`.

---

# Other hosts (Node.js server)

The `server/` folder is the same backend as a Node.js/Express app, for hosts other than Cloudflare.

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
cd worker && npm install && npm test   # Cloudflare version: accounts, permissions, AI routes (Claude API stubbed)
cd ../server && npm install && npm test # Node version, same checks
cd ../grader && npm test               # scoring, statistics, preprocessing
```
