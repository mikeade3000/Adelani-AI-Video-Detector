# Y2027 Promotion Eligibility List Portal

Two files make up the portal:

| File | What it is |
|---|---|
| `Y2027_Eligibility_List_Portal.html` | The portal page that officers, MDA users and administrators open. |
| `Code.gs` | The Google Apps Script backend that stores everything in a Google Sheet. |

## Moving to Cloudflare

The portal can run on **Cloudflare**: a Worker plus a D1 database, replacing Apps Script and the Google Sheet.
Users keep their passwords, and existing links and slip QR codes keep working.
The code is in `cloudflare/`, and the step-by-step guide is **[CLOUDFLARE_MIGRATION.md](CLOUDFLARE_MIGRATION.md)**.
**Uploading is automated:**
* On Windows, drag your backup file onto `cloudflare/deploy.cmd`. On Mac or Linux, run `cloudflare/deploy.sh backup.json`.
  This signs in, creates the database, imports the backup and publishes.
* Optionally, GitHub Actions can publish every change pushed to `main`.
Until you switch, everything below still applies to the Google Sheets backend.

## Live backend

The portal uses this Apps Script Web App URL:

`https://script.google.com/macros/s/AKfycbxKTcVbT3zHq4TeCmRHWjl9aPn6xxqH5SNrfXEjvt7Yw9yAAbitMpBqR5p0UWSemitk/exec`

It is set in `DEFAULT_SCRIPT_URL` near the top of the portal's script, so the first-time setup screen
no longer appears. When updating `Code.gs`, deploy it as a **new version of this same deployment**
(Deploy → Manage deployments → Edit → Version: New version). That keeps the URL above unchanged.
A brand-new deployment would get a different URL, and this constant would then need updating.

## Deploying this update

Officers have already submitted Form A, so **keep the same Google Sheet**. Don't create a new one. The update adds to the existing data and leaves it in place.

1. Open the Google Sheet → **Extensions → Apps Script**.
2. Replace the contents of `Code.gs` with the new `Code.gs` and save.
3. **Deploy → Manage deployments →** edit the existing Web App deployment → **Version: New version → Deploy**.
   This keeps the same Web App URL, so the portal doesn't need to be reconfigured.
4. Replace the hosted `Y2027_Eligibility_List_Portal.html` with the new file.

New **Verifications** and **Verified and Authentic Data** sheets are created automatically the first time an MDA runs a check.

## Verification (new tab)

The **Verification** tab lets an MDA check what its officers submitted online against the MDA's own Excel records.

1. Sign in as the MDA user. Administrators can also pick any MDA, or *All MDAs*.
2. Choose what to check:
   * **Form A — Brief on Candidate**: details the officers submitted themselves (the default).
   * **Eligibility List records**: records entered through Single Entry or Bulk Upload.
3. Upload the Excel sheet (`.xlsx`, `.xls` or `.csv`) with the officers' details. You can use
   **Download Verification Template**, the Y2027 bulk-upload template, or your own sheet. The heading
   row is found automatically, and columns are recognised by their headings, for example
   *Names (Surname First)*, *Oracle No*, *CSC File No*, *Date of Birth*, *Present Post / Cadre*. Only the columns
   present in your sheet are compared.
4. Officers are matched by **Oracle No**, then **CSC File No**, then **Name**. Every officer gets one of these results:
   * **Matched**: every compared field agrees.
   * **Discrepancy**: one or more fields differ. Each differing field is listed with both values.
   * **Not in sheet**: the officer submitted online but isn't in the uploaded sheet.
   * **Not submitted**: the officer is in the sheet but hasn't submitted online.
5. Downloads after the check:
   * **Download Summary** on any row gives that officer's individual verification summary (Word `.doc`):
     passport photo, a side-by-side comparison of every field, the discrepancies to resolve, and signature lines.
   * **Download All Individual Summaries** puts every summary in one Word document, with a cover page.
   * **Download Results Workbook** gives an `.xlsx` with *Summary*, *Field Details* and *About* sheets.
   * **Print All Summaries**.

Comparisons ignore differences that don't change the meaning: letter case, extra spaces, name order
("ADEYEMI JOHN OLU" vs "Adeyemi Olu John"), and date format (Excel date, 01/03/2010, 01-Mar-2010, 2010-03-01).
*Lagos* vs *Lagos State* also counts as the same value.
If an officer submitted Form A more than once, only the latest submission is checked, and the summary says so.

### Verified and Authentic Data

When you upload the eligibility list, **every officer on the list is saved** to **Verified and Authentic Data**,
ready for slip printing, using the details on the list. Each row records its *Form A check*:
* **Matches Form A**: every compared field agrees.
* **Differs from Form A**: the list's details are saved and printed. **Download list of differences / missing Form A (.xlsx)** shows what differs, so you can follow up.
* **No Form A**: the officer is saved without a photograph. An administrator can add one with **✎ Edit**.

Form As that are not on the list are left untouched. Uploading the list again replaces each officer's row; nothing is duplicated.
* **Official email, WhatsApp number and disability are never compared.**
* The server only saves officers for the user's own MDA (administrators can upload for any MDA).

* Panel **03 · Verified and Authentic Data** on the Verification tab lists the saved officers (MDA users
  see their own MDA) and downloads them as Excel.

### Candidate Eligibility Slip

Every officer in **Verified and Authentic Data** can get a **Candidate Eligibility Slip**: one elegant A4 page,
downloaded as a PDF or printed. The slip shows:

* the SEAP logo in the top banner, with the Lagos State crest as a faint background;
* the **Eligibility/SEAP Number**, name, MDA, CSC File No and Oracle No;
* the passport photograph from the officer's Form A;
* the service record: first appointment, confirmation, present post and promotion post, with grade levels and dates;
* a signature block for **Mr. Babatunde Aragbanda, Director, CMD**.

Where to get slips:
* **Slip (PDF)** on each fully matched officer in the results list, or **Download Slips for Verified Officers (PDF)** for all of them.
* In panel **03 · Verified and Authentic Data**: **Slip (PDF)** per officer, **Download All Slips (PDF)** as one PDF with one page each, or **Print All Slips**.

Every officer on the list gets a slip. Officers with no Form A show "No photograph supplied" until a photo is added with ✎ Edit.

**Verifying a slip.** Each slip carries two codes:
* **A QR code.** Scanning it with any phone camera opens the portal's verification page, no login needed. The page shows
  **VALID**, with the officer's details and photograph to compare against the paper. It shows **NOT GENUINE** if the code
  was forged or altered (it is signed with the server's secret). It shows **NO LONGER VALID** if the officer has since
  been removed from Verified and Authentic Data.
* **A barcode** (Code 128) of the Eligibility/SEAP Number, for desk barcode scanners.

Slips downloaded before this update have no codes. Download them again to get them.
The SEAP number comes from the uploaded list's **ELIGIBILITY/SEAP NUMBER** column. It is stored, not compared.
To change the signatory, edit `SLIP_SIGNATORY` in the portal's script.

### Which MDA an officer is listed under

Every officer is placed under the MDA written beside **"MDA:"** on the eligibility list they were uploaded from,
whatever MDA their own Form A names. The Form A still supplies the photograph and is still compared.
If a sheet has no "MDA:" line, the MDA chosen at upload is used. MDA users' uploads always go under their own MDA.

**Fix MDA grouping** (administrators, on the Verify & Print Slips tab) corrects officers uploaded before this rule.
It works per upload (one file from one uploader):
* That list's MDA is read from its officers who had no Form A, because they were always filed under the sheet's MDA.
* Every other officer from that list moves to it.
* If a list's MDA can't be told (every officer had a Form A), you choose it from a drop-down, or upload that list again.
* A preview shows every move before you click **Apply**.
* Officers whose MDA was changed by hand with ✎ Edit are left alone.
* If the same officer ends up twice in one MDA from two different lists, the older entry is removed.
* Each move is recorded in the log as "MDA corrected".

### MDA Print Links (passwordless, tied to the MDA's email)

The **MDA Print Links** tab (administrators) lists every MDA in Verify & Print Slips. Each MDA can have one private link.

**Creating and sending a link**
1. Type the MDA's email address(es). If the MDA has a portal account, click its email to add it.
2. Click **Create link**.
3. A **Send the link** window opens. Choose **Gmail**, **Yahoo Mail**, **Outlook.com** or **Email program**: your own mailbox opens with the message and link already written to the MDA, and you click Send there.
   No email service needs to be set up. **Copy message** is there for WhatsApp.

**How an MDA uses its link**
1. Open the link. It shows only the MDA's name.
2. Type the email address the link was sent to.
3. Only **that MDA's slips** open, for **1 hour**: print one slip or all of them, download them as PDF, download the list in Excel, and print or download each officer's **Form A**.
   Nothing can be edited or uploaded.

**Form A on the link page**
* Every officer who submitted a Form A (Brief on Candidate) has a **🖨 Form A** button and a **PDF** button on their row. Officers without one show **No Form A**.
* **Print All Form A** and **Download All Form A (PDF)** cover the whole MDA.
* Each Form A prints as the officer submitted it, with their photograph.
* Officers whose Form A differs are marked **Differs from slip** in the list.

**What protects it**
* A wrong email is refused, and 5 wrong emails lock the link for 15 minutes.
* **New link** replaces a link, and the old one stops working at once. **Switch off** blocks it.
* Removing an email from the list ends that email's session.
* Every sign-in, print and download is recorded in the log ("MDA print link").

**Shortcut:** on Verify & Print Slips, the **🔗 MDA link** button on each MDA heading jumps to that MDA's row.

These links replace the old per-MDA download links, which now say they have been replaced.

### Examination Results

**Accounts.** On the Admin Dashboard, an administrator creates accounts with one of three new roles:
* **Examination panel:** enters results.
* **Director CMD:** enters and **confirms** results.
* **Permanent Secretary:** enters results and **amends confirmed** results.

These accounts see only the **Results** tab. The super administrator can do everything.

**Entering and confirming (Results tab)**
1. Every officer in Verify & Print Slips is listed with their SEAP/Exam No, filtered by MDA, status or search.
2. A panel types the candidate's email, Written and Oral scores (0–100) and remark (Passed / Not passed / Absent). The total adds up automatically.
3. **Save** stores the result as **Draft**.
4. The **Director CMD** clicks **✓ Confirm** on a row, or **Confirm all Draft results shown**. A confirmed result is locked.
5. Only the **Permanent Secretary** or the **super administrator** can change a confirmed result: **✎ Amend**, edit, **Save**, and give a reason.

The list refreshes itself every 20 seconds, and at once when you come back to the window. Everyone sees new entries live without losing what they are typing.
Every entry, confirmation and amendment is recorded in the log with who did it, when, and (for amendments) why.
Administrators can **Import candidate emails (.xlsx)** from a sheet with an Eligibility/SEAP Number column and an Email column, and **Download Results (.xlsx)**.

**Officers: Check My Result.** On the portal's front page, the **Check My Result** tab (or the address ending `?result`) asks for:
* the **Examination Number**, which is the Eligibility/SEAP Number on the slip;
* the officer's **email address** recorded with the result.

It shows the officer's photograph, scores, total and remark, with a **Print** button. Only **confirmed** results are shown; before that it says the result has not been released. 5 wrong attempts on one number lock it for 15 minutes.

### Reports on Verified and Authentic Data

The **Reports** tab (administrators) has a **Report on** choice:
* **Verified and Authentic Data** (the default): every officer on the uploaded eligibility lists.
* **Eligibility List records**: Single Entry / Bulk Upload records, as before.

You can also limit a report to one MDA. All three reports work on either source.
With Verified and Authentic Data, they add Form A check counts (matches / differs / no Form A).
The Promotion Defence Report shows these per MDA, next to the GL06–10 and GL12–16 brackets.
Grade brackets use the officer's **present** grade level.

Each check is also logged, one row per officer, in the **Verifications** sheet (who checked, when,
which file, the result and the discrepancies).

## Fixes in the slip update

* **Simultaneous submissions could overwrite each other.** The previous update wrote each new row at
  "last row + 1". Two Form As sent at the same moment could pick the same row. Every action that writes
  now takes the Apps Script lock, so saves happen one at a time. If the lock can't be obtained within
  30 seconds, the user sees "The system is busy — please try again in a moment" and nothing is lost.
* A **Verified and Authentic Data** sheet created by the previous version automatically gains the new
  `seap_no` column at the end. Its existing rows are kept.

## Fixes in this update

* **Phone numbers lost their leading zero.** Google Sheets turned `08031234567` into `8031234567`, so
  records failed the 11-digit check in the Admin table. Dates such as `01/07/2027` could also be
  re-read as 7 January in a US-locale sheet. New records are now stored as plain text. Rows saved
  before this fix are still read correctly: dates are formatted in the sheet's time zone, and 10-digit
  numbers starting with 7, 8 or 9 get their 0 back.
* **Dates in Form A** previously came back as `1985-06-20T23:00:00.000Z`. They now show as `1985-06-20`.
* **Editing a Form A** now rewrites only the fields that changed. Authorising one now writes only the four status cells.
* Editing or authorising when the Briefs sheet was empty no longer crashes.
* Expired login sessions are now cleared at sign-in, so the Sessions sheet no longer grows forever.
* The Single Entry *Submit Queue* button no longer re-enables itself on an empty queue.
* The downloaded Form A said "last 3 years" for the four appraisal years. It now says "last 4 years".
