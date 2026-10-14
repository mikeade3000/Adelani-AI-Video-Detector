# CAT Portal backend (Google Drive + Google Sheets)

The portal website is hosted on GitHub Pages, which cannot receive files. This small
Google Apps Script backend runs on your own Google account and:

- **re-checks every upload** on the server with the same rules as the website;
- **saves every submitted .docx** to a private Google Drive folder, `KIU CAT Submissions`
  (`Accepted/` and `Rejected/` subfolders). A form that fails the check in the browser is
  never sent; the lecturer has to fix it first. So `Rejected/` only holds the rare file that
  passed in the browser but failed on the server;
- **records every submission** in a Google Sheet, `KIU CAT Submissions Register`:
  - **Schedule** tab: one row per course, with lecturer, course, exam date and time,
    venue and a **link to the file**. A resubmission replaces that course's row.
  - **Submissions Log** tab: every file the server received, with its result and any problems found;
- **serves the CAT schedule** to the website, so every visitor sees new entries instantly.

The files and sheet are private to you. The website shows only the schedule, never
file links or question content.

## One-time setup (about 10 minutes)

1. Open <https://script.google.com> while signed in to the Google account that should
   own the submissions. Click **New project** and rename it to `KIU CAT Portal`.
2. Delete everything in `Code.gs` and paste in the full contents of **`backend/Code.gs`**.
3. Click **+** next to *Files*, choose **Script** and name it `Validator`. Delete its contents
   and paste in the full contents of **`backend/Validator.gs`**. Click **Save** (💾).
4. In the toolbar, pick the function **`setup`** and click **Run**.
   Google asks for permission: click **Review permissions**, choose your account, then
   **Advanced → Go to KIU CAT Portal (unsafe)** → **Allow**. It is your own script, so this
   warning is expected.
   The *Execution log* then shows the links to the new Drive folder and sheet.
5. Click **Deploy → New deployment**. Click the gear ⚙ and choose **Web app**:
   - *Execute as*: **Me**
   - *Who has access*: **Anyone**

   Click **Deploy** and copy the **Web app URL**. It ends in `/exec`.
6. In your GitHub repository, open the portal page (`index.html`, or `cat.html` in the
   detector repo). Find this line near the bottom:

   ```js
   const API_URL = '';
   ```

   Paste your URL between the quotes, for example
   `const API_URL = 'https://script.google.com/macros/s/AKfy.../exec';`, then commit.

The live site now sends accepted forms to your Drive.

## Downloading the lecturers' files

- **One file**: open the sheet, go to the **Schedule** tab and click the lecturer's **File Link**.
  Or open the Drive folder `KIU CAT Submissions → Accepted` and right-click the file → **Download**.
- **All files at once**: in Drive, right-click the `Accepted` folder → **Download**. Drive
  zips the folder for you.

Files are named `COURSE CODE - LECTURER NAME - date time.docx`. The original file name is in
the sheet.

## Day-to-day

- **Remove an entry from the public schedule**: delete its row in the **Schedule** tab.
- **Change an exam time**: edit the *Exam Date*, *Start Time* or *End Time* cell in the
  **Schedule** tab. Keep the formats `YYYY-MM-DD` and `HH:MM`.
- **Updating the code later**: paste the new code, then go to **Deploy → Manage deployments**,
  click ✏️, set *Version* to **New version** and click **Deploy**. The URL stays the same.
  `Validator.gs` must always be an exact copy of `cat/validator.js`.

## Notes

- Google limits a free account's web app to about 20,000 requests a day, which is far
  more than a CAT portal needs.
- *Who has access: Anyone* is what lets lecturers submit without signing in to Google.
  Anyone who finds the URL could send a file, but the server checks it, and nothing is
  shared from your Drive.
