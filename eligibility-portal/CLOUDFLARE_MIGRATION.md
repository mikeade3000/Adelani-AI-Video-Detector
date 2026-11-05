# Moving the portal from Google Sheets to Cloudflare

After the move:

| Before (Google) | After (Cloudflare) |
|---|---|
| `Code.gs` in Apps Script | A **Cloudflare Worker** (`cloudflare/src/index.js`) with the same actions |
| The Google Sheet | A **Cloudflare D1** database (`cloudflare/schema.sql`) |
| The portal page hosted separately | Served **by the Worker**, at the same address as its API |

The portal page is the same file, and it detects when the Worker serves it.
Officers and MDA users notice nothing except the new web address.

What carries over:

* **Everyone keeps their password.** The Worker checks passwords the same way `Code.gs` does.
* **Every Form A comes across complete:** all fields, passport photographs, status and authorisation stamps.
* **Eligibility records, the verification log and Verified and Authentic Data** come across too, including SEAP numbers.
* **Per-MDA download links and slip QR codes stay valid,** because the secret that signs them is migrated.
* **Phone numbers that Google Sheets had shortened** (`8031234567`) get their leading `0` back.

Nothing is changed or deleted on the Google side. The old portal stays available as a fallback until you retire it.

---

## What you need

* A **Cloudflare account** (the free plan is enough to start). Create it in the Commission's name, not an individual's.
* A computer with **Node.js 18 or newer** (the LTS version from https://nodejs.org).
* This project folder (`eligibility-portal`) on that computer.
* The **super administrator** login for the current portal.

## Step 1: update Apps Script (needed to take the backup)

The backup button calls a new `exportTab` action in `Code.gs`.

1. Open the Google Sheet → **Extensions → Apps Script**.
2. Paste in the new `Code.gs`.
3. **Deploy → Manage deployments → Edit → Version: New version → Deploy.** The URL stays the same.

## Step 2: download a full backup

1. Open the current portal and sign in as the **super administrator**.
2. Go to **Admin Dashboard → Full backup → Download Full Backup (.json)**.
3. Keep the file private. It contains password hashes and personal data.

A `.json` backup is used rather than "File → Download → .xlsx" because Excel cuts any cell longer
than 32,767 characters. That would corrupt passport photographs.

## Step 3: upload to Cloudflare (one step, automated)

Open the `eligibility-portal/cloudflare` folder and:

* **Windows:** drag the backup `.json` file onto **`deploy.cmd`**. Double-clicking it without a file publishes only.
* **Mac / Linux:** in a terminal, run `./deploy.sh path/to/Y2027_Portal_Backup_YYYY-MM-DD.json`.

The script does everything:

1. **Signs you in to Cloudflare.** Your browser opens the first time.
2. **Sets up the database.** It finds the `eligibility_portal` database, or **creates it** if it doesn't exist, and writes its ID into `wrangler.toml` for you.
3. **Creates the tables.** Tables that already exist are left untouched.
4. **Imports the backup.** It shows how many users, Form As and records it found and asks you to confirm. Only rows not already in Cloudflare are added.
5. **Publishes the portal** and prints its address, e.g. `https://y2027-eligibility-portal.<your-subdomain>.workers.dev`.
6. **Stores settings.** If the database has **no accounts at all** (you didn't import a backup), it asks you to choose a password for the first super administrator. There is deliberately no default password on a public site.

**Run it again any time.** It is safe to repeat: it publishes the latest portal page and never duplicates or overwrites data.

Then open the printed address and check that:

* you can sign in as the super administrator, and as an MDA user, with their existing passwords;
* **Form A Review** lists the Form As with photographs;
* **Verification → Verified and Authentic Data** lists the verified officers, and a **Slip (PDF)** downloads;
* scanning a slip's QR code with a phone opens the verification page and says **VALID**.

<details><summary>The same thing by hand (if you prefer individual commands)</summary>

```bash
cd eligibility-portal/cloudflare
npm install
npx wrangler login
npx wrangler d1 create eligibility_portal        # copy the database_id into wrangler.toml
npm run db:schema:remote
node migrate/import-backup.js path/to/backup.json
npx wrangler d1 execute eligibility_portal --remote --file=import.sql
npm run deploy
```
</details>

## Step 4 (optional): publish automatically from GitHub

Once this is set up, **every change to `eligibility-portal/` pushed to the `main` branch is published to Cloudflare
automatically**. The workflow is `.github/workflows/deploy-cloudflare.yml`. You can also start it by hand from the
repository's **Actions** tab → **Deploy portal to Cloudflare** → **Run workflow**.

One-time setup:

1. In Cloudflare: **My Profile → API Tokens → Create Token → "Edit Cloudflare Workers" template**.
   Add the permission **Account · D1 · Edit**, then create the token and copy it.
2. In Cloudflare: copy your **Account ID** (Workers & Pages → right-hand side, "Account details").
3. In GitHub: **repository → Settings → Secrets and variables → Actions → New repository secret**. Add:
   * `CLOUDFLARE_API_TOKEN`: the token from step 1.
   * `CLOUDFLARE_ACCOUNT_ID`: the ID from step 2.
   * Optional: `RESEND_API_KEY`, `MAIL_FROM`, `PORTAL_URL`, and `BOOTSTRAP_ADMIN_PASSWORD` (only needed for an empty database).

The workflow creates the database and tables if they are missing, then publishes. It never imports backups:
those contain private data and must not be stored in GitHub. Load backups with Step 3.

## Step 5: switch over

1. Pick a quiet time, and tell MDAs the new address.
2. Replace the old hosted portal page with a page that forwards to the new address. For example:
   ```html
   <!DOCTYPE html><meta http-equiv="refresh" content="0; url=https://YOUR-NEW-ADDRESS/">
   <p>The portal has moved to <a href="https://YOUR-NEW-ADDRESS/">YOUR-NEW-ADDRESS</a>.</p>
   ```
3. **Pick up late submissions.** Anyone may have submitted on the old portal between Step 2 and now.
   Take a **second backup** from the old portal (Step 2), then run Step 3 again with it.
   * Only new rows are added; nothing is duplicated.
   * Rows already in Cloudflare are left as they are. If someone edited a Form A or changed their password on the
     old portal during that window, redo that change on the new one.

**Rolling back:** the Google Sheet and Apps Script are untouched. To go back, put the old portal page back.

## Optional settings

The deploy script stores any of these that are set as environment variables when it runs. In GitHub they are the
repository secrets above. You can also set them in the Cloudflare dashboard (**Workers & Pages →
y2027-eligibility-portal → Settings → Variables and Secrets**) or with `npx wrangler secret put NAME`:

| Setting | What it does |
|---|---|
| `RESEND_API_KEY`, `MAIL_FROM` | Optional. Sends account and password-reset emails (MDA Print Links don't need it: they are sent from your own mailbox). Sent through resend.com (free tier available). In Resend, verify your domain (it gives you DNS records to add) and set `MAIL_FROM` to an address on it, e.g. `Y2027 Portal <noreply@portals.com.ng>`. Without a verified domain, Resend only delivers to your own Resend account address. Apps Script sent these through Gmail for free; the Worker can't. Without this, "Forgot password" can't email anyone. An administrator can still remove an account and create it again, which shows a new temporary password. |
| `PORTAL_URL` | The address used in password-reset emails. Defaults to the Worker's own address. Set it if you add a custom domain. |
| `BOOTSTRAP_ADMIN_PASSWORD`, `BOOTSTRAP_ADMIN_EMAIL` | Only for a brand-new, empty database: the first super administrator's password, and optionally their email (default `admin@portal.local`). There is no default password. The deploy script asks for one when needed. Not used after a backup import, because your existing accounts come across. |

**Custom domain.** The portal is set up to run at **https://csc-registration-2027-promotion.portals.com.ng**.
This is set in `cloudflare/wrangler.toml`: `routes` attaches the domain, and `CANONICAL_HOST` / `PORTAL_URL` point to it.
* **Automatic setup:** `deploy.cmd` attaches the domain, and Cloudflare creates its DNS record and HTTPS certificate. The zone `portals.com.ng` must be on the same Cloudflare account.
* **Old address:** the `…workers.dev` address permanently redirects (301) to the same page on the new domain. Old bookmarks, per-MDA links and the QR codes on slips already printed keep working.
* **If deploy says the name already has a DNS record:** delete that record (portals.com.ng → DNS → Records → `csc-registration-2027-promotion`) and run `deploy.cmd` again.
* **To use a different address:** change it in those three places in `wrangler.toml`.

## Backups on Cloudflare

The same **Download Full Backup (.json)** button works on the Cloudflare portal. Take one regularly.
A backup can be loaded into a fresh D1 database with Step 3.

## Cost

At the time of writing, Cloudflare's free plan includes about 100,000 Worker requests per day and 5 GB of D1 storage.
That is far more than this exercise needs: a few thousand officers, each with a ~45 KB photograph, is well under 1 GB.
Check Cloudflare's current pricing page before go-live.

## Testing it locally (optional)

From `eligibility-portal/cloudflare`:

```bash
npm install
npx wrangler d1 execute eligibility_portal --local --file=schema.sql
echo "BOOTSTRAP_ADMIN_PASSWORD=choose-a-local-password" > .dev.vars
npm run dev          # http://127.0.0.1:8787 (super admin: admin@portal.local / the password above)
```
