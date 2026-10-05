# Y2027 Promotion Eligibility List Portal

Two files make up the portal:

| File | What it is |
|---|---|
| `Y2027_Eligibility_List_Portal.html` | The portal page that officers, MDA users and administrators open. |
| `Code.gs` | The Google Apps Script backend that stores everything in a Google Sheet. |

## Deploying this update

Officers have already submitted Form A, so **keep the same Google Sheet**. Don't create a new one. The update adds to the existing data and leaves it in place.

1. Open the Google Sheet → **Extensions → Apps Script**.
2. Replace the contents of `Code.gs` with the new `Code.gs` and save.
3. **Deploy → Manage deployments →** edit the existing Web App deployment → **Version: New version → Deploy**.
   This keeps the same Web App URL, so the portal doesn't need to be reconfigured.
4. Replace the hosted `Y2027_Eligibility_List_Portal.html` with the new file.

A new **Verifications** sheet is created automatically the first time an MDA runs a check.

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

Each check is also logged, one row per officer, in the **Verifications** sheet (who checked, when,
which file, the result and the discrepancies).

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
