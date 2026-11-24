# ESAMI@50 Live Poll: AI Grading session

An interactive version of slide 20, "Your turn: four questions for the room", from
*AI-Powered Grading of Handwritten Theory Examinations* (ESAMI@50 Colloquium, Arusha, 25–27 November 2026).

| View | URL | Who |
|---|---|---|
| Presentation with live poll | `…/esami-poll/` | Projected on screen |
| Participant voting form | `…/esami-poll/?s=<session>&api=<server>#vote` | Opened by the QR code |

The QR code builds the participant link for you, so participants never type anything.

## Running order (28 slides)

| Slides | Content |
|---|---|
| 1–18 | The presentation, from the title to *Limitations and the road ahead* |
| 19 | **Your turn:** the four questions with a large QR code |
| 20–23 | **Q1–Q4 live results**, with *Reveal answer* on Q1 and Q2 and a word cloud on Q4 |
| 24–25 | **Live summary and analysis** for discussion |
| 26 | Conclusion: a first reader, not an autonomous marker |
| 27–28 | About the presenter · Follow ESAMI |

**Keys:** → / Space / PgDn next, ← / PgUp back, **P** jump to the poll, **R** reveal answer, **F** full screen, **S** settings.
Presentation clickers work, and so does swiping on a tablet. The page remembers the last slide shown.

## What it does

1. **Collect:** participants scan the QR code and answer the four questions on their phones (optional role, Q1–Q3 multiple choice, Q4 one-word answer). Each device has one response per session, and resubmitting updates it.
2. **Discuss:** the presenter steps through Q1–Q4 with live bar charts and a word cloud. "Reveal answer" shows the correct option and the study's explanation for the two quick-check questions.
3. **Summarise and analyse:** the *Summary & analysis* tab recalculates live:
   - headline figures: % correct on Q1 and Q2, % ready to adopt, leading worry theme
   - a written summary of what the room said
   - adoption by role (cross-tab of Q3 by role)
   - Q4 words grouped into 8 worry themes (accuracy/OCR, bias and fairness, trust and transparency, privacy, gaming, human role, meaning and context, cost and infrastructure), plus the concerns of people who are not ready to adopt
   - suggested discussion questions generated from the results
   - **Copy summary text**, **Download CSV** and **Download JSON** for the report or for further analysis

## Setup (about 10 minutes, free)

### 1. Results server (Google Sheet + Apps Script)
1. Create a new Google Sheet, e.g. "ESAMI AI Grading Poll".
2. **Extensions → Apps Script**. Replace the sample code with [`apps-script/Code.gs`](apps-script/Code.gs) and save.
3. **Deploy → New deployment → Web app**. Set *Execute as*: **Me** and *Who has access*: **Anyone**.
4. Authorise it and copy the **Web app URL** (it ends in `/exec`).

All responses go into the sheet's `Responses` tab, which you own.

### 2. Host the page
Upload the whole `esami-poll` folder (`index.html`, `slides/`, `vendor/`) to any static HTTPS host. With GitHub Pages:
1. Merge this folder into the branch you publish (e.g. `main`).
2. Go to repo **Settings → Pages**, choose *Deploy from a branch*, then pick `main` and `/ (root)`.
3. The presenter page will be at `https://<user>.github.io/Adelani-AI-Video-Detector/esami-poll/`.

### 3. Connect them
Open the presenter page and click **Settings**:
- paste the Web app URL and click **Test connection**
- (optional) set a **session code**, e.g. `day2-pm`. A new code starts a fresh poll, and earlier sessions stay in the sheet.
- (optional) add a **short link** (e.g. bit.ly to the participant link) so the QR code scans more easily from the back of the room.

The status chip turns green and shows **Live** when the page is connected.

## Rehearsing
Without a server URL the page runs in **demo mode**: votes sync only between tabs in the same browser.
Open the presenter page in one tab and `#vote` in another, or use **Settings → Add 40 sample responses**
to preview the charts and analysis. Sample data is never sent to the server.

## Notes
- Answers are anonymous: only a random device ID, the time, the optional role and the answers are stored.
- The QR generator ([qrcode-generator](https://github.com/kazuhikoarase/qrcode-generator), MIT) is bundled in `vendor/`, so the QR code still works if a CDN is blocked. The only other external resource is the Lato font from Google Fonts, which falls back to system fonts if it can't load.
- If you edit `Code.gs`, use **Deploy → Manage deployments → Edit → New version**, so the URL stays the same.
