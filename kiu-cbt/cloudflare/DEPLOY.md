# KIU CBT on Cloudflare

One Worker serves the website and the exam API (`/api`); one Durable Object (`CbtEngine`) runs the exam engine with
its own permanent SQLite database; one R2 bucket (`kiu-cbt-media`) holds photos, recordings and Section B pages.
Plan: Workers Paid. Custom domain: `kiu-cbt.portals.com.ng`.

## Updating (the usual case)

Double-click `deploy.cmd` in this folder and wait for **DONE**, then press Ctrl + F5 on the admin page. It runs:

```
npm install            (first time in a folder only)
node tools/build.mjs   (Code.gs → src/app.generated.js, pages → public/)
npx wrangler deploy --env=""
```

If the upload fails because the Cloudflare sign-in has expired, `deploy.cmd` signs in again (a browser window asks
you to Allow) and retries once. Nothing on the live site changes unless the upload finishes.

Data is never touched by a deploy. Students who are writing at that moment carry on: their pages keep their answers
and retry automatically.

## First-time set-up (already done for kiu-cbt)

1. Install Node.js (LTS) and run `npx wrangler login` once.
2. `npx wrangler r2 bucket create kiu-cbt-media`
3. `npx wrangler secret put OPS_KEY` — a long random maintenance key (keep it safe).
4. `deploy.cmd`, then open `https://<your address>/api?setup=1` once.
5. Sign in to `admin.html` as `super` / `changeme`; you are asked to choose a new password.

## Settings in `wrangler.toml`

- `compatibility_date = "2024-09-01"` with `nodejs_compat`: reproduces the deployed build exactly.
- `TIME_ZONE = "Africa/Kampala"`: the official time of every examination, shown to students everywhere.
- `MAIL_FROM` / `[[send_email]]`: Cloudflare Email Service for *Exam links → Email exam details* (set up a sending
  domain in Cloudflare → Email Service first).
- `[env.test]`: a separate test installation (`npx wrangler deploy --env test`) with its own data.

## Maintenance (needs the OPS_KEY)

`POST /ops/<command>` with the header `X-Ops-Key: <OPS_KEY>`:

| Command | Does |
|---|---|
| `reset-super-admin` | Puts the superadmin back to `super` / `changeme` (new password at next sign-in) |
| `setup` | Re-runs first-time setup (safe) |
| `stats` | Row counts and stored files |
| `export` | Downloads a full backup (JSON) |
| `import` | Replaces everything with a backup (media files excluded) |

## LMS (Moodle) sign-in

Settings → *LMS connection* lists the four addresses to give the Moodle administrator (Tool URL, Public keyset URL,
Initiate login URL, Redirection URI) and takes the platform's issuer, client ID, deployment ID, keyset URL and
authentication URL. Students then open the examination from Moodle without a password.
