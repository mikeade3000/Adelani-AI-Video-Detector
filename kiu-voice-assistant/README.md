# Dlano — KIU Voice Assistant

A voice question-answering assistant for Kampala International University. It reads the
whole of **kiu.ac.ug** and answers spoken questions about anything on the site
(admissions, fees, programmes, campuses, contacts) out loud, citing the pages it used.

```
 kiu.ac.ug ──crawler.py──▶ data/pages.jsonl ──knowledge.py (BM25 search)──┐
                                                                          ▼
 Browser mic ──speech-to-text──▶ /api/ask (server.py) ──▶ Claude (assistant.py)
 Browser speaker ◀──text-to-speech── answer + source links ◀──────────────┘
```

## Quick start on Windows

1. Install Python 3.13:
   - **Python Install Manager** (the default download on python.org): run the MSIX installer,
     then in Command Prompt run `py install 3.13` and answer **Y** if asked to add Python to PATH.
   - **Classic installer:** download Python 3.13 from https://www.python.org/downloads/windows/
     and tick **"Add python.exe to PATH"** on the first screen.

   Avoid Python 3.15 for now: some packages may not have Windows builds for it yet.
2. Get an API key at https://console.anthropic.com.
3. Double-click **`start-windows.bat`** and paste the key when asked.

The first run reads the whole of kiu.ac.ug (20-30 minutes), then opens
http://localhost:8000. Later runs start straight away. To refresh the website content,
delete `data\pages.jsonl` and run it again.

> **"Failed to fetch"?** The page must be opened from the running server at
> http://localhost:8000. Opening `index.html` by double-click, VS Code Live Server or
> GitHub Pages shows the page but can't reach the Python server that answers questions.

## Setup (any system)

```bash
cd kiu-voice-assistant
python -m venv .venv && source .venv/bin/activate     # Windows: .venv\Scripts\activate
pip install -r requirements.txt
export ANTHROPIC_API_KEY=sk-ant-...                  # Windows PowerShell: $env:ANTHROPIC_API_KEY="sk-ant-..."
```

## 1. Crawl the website

```bash
python crawler.py                    # whole site, up to 2000 pages (~20-30 min)
python crawler.py --max-pages 100    # quick trial
```

The crawler follows robots.txt and the site's sitemaps, stays on `kiu.ac.ug`, pauses
0.5 s between requests, and also reads linked PDFs (fee structures, prospectuses).
To include subdomains, repeat `--domain`, e.g. `--domain kiu.ac.ug --domain admissions.kiu.ac.ug`.
Re-run it whenever the site changes (e.g. a weekly cron job), then restart the server.

## 2. Start the assistant

```bash
uvicorn server:app --port 8000
```

Open http://localhost:8000 in **Chrome or Edge**, tap the microphone and ask, e.g.
*"What are the requirements for the Bachelor of Nursing?"* You can also type questions.

## Talking to Dlano

1. Open http://localhost:8000 and tap the microphone **once**. It turns green: Dlano is now
   listening for its name. It ignores everything else said in the room.
2. Say **"Dlano"**, alone or followed by your question:
   *"Dlano, can you assist me with information concerning KIU, Uganda?"*
3. Dlano introduces itself and asks for your name. Answer naturally: *"My name is Amina"*,
   *"I'm John Okello"* or just *"Peter"*.
4. Dlano welcomes you by name, answers the question you started with, and then uses your
   first name in every reply. Keep talking: there's no need to repeat "Dlano" during the
   conversation.
5. Say **"goodbye"** (or *"kwaheri"*) to end, or just stop talking. After 90 seconds of quiet
   the session ends. Dlano then forgets the name and waits for "Dlano" again, so the next
   caller is asked for their own name.

The microphone pauses while Dlano speaks, so it doesn't answer itself. If speech recognition
writes the name differently (e.g. "Delano", "the Lano"), Dlano still wakes up.
You can also type into the box below instead of speaking.

## English and Kiswahili

Use the **English / Kiswahili** switch at the top of the page (the choice is remembered).
In Kiswahili mode:

- the microphone listens for Swahili (`sw-KE`), e.g. *"Ada ya udaktari ni kiasi gani?"*;
- the question is translated to English first, because the website is in English, so
  the right pages are found;
- Claude answers in Kiswahili, keeping programme and office names in English;
- answers are spoken with a Swahili voice if the device has one. Android Chrome and
  Microsoft Edge usually do; on other devices, install a Swahili voice in the system
  speech settings, otherwise the default voice reads the Swahili text.

Swahili questions take one extra Claude call (the translation), so they are slightly slower.

## How answers stay accurate

- Each question retrieves the 6 most relevant passages from the crawled site; Claude is told to
  answer **only** from those passages and to say so when the site doesn't have the answer.
- Answers are short, plain spoken sentences in English or Kiswahili (no URLs or markdown) so they sound natural aloud.
- Source page links are shown under each answer so staff can verify.

## Put it online with Cloudflare

Dlano runs on **Cloudflare Containers** (the Python server in a Docker container, behind a
Cloudflare Worker). GitHub does all the work, so no Python or Docker is needed on your computer:

- **`Crawl kiu.ac.ug`** workflow: reads the website every Monday and saves `data/pages.jsonl`.
- **`Deploy Dlano to Cloudflare`** workflow: runs the tests and deploys whenever the code
  changes on `main` or a crawl finishes.

One-time setup:

1. **Merge this code into `main`** on GitHub (scheduled workflows only run from `main`).
2. **Cloudflare account:** sign up at https://dash.cloudflare.com and subscribe to the
   **Workers Paid** plan (Workers & Pages > Plans). Containers need it.
3. **Cloudflare API token:** My Profile > API Tokens > Create Token > use the
   **"Edit Cloudflare Workers"** template > Create. Copy the token.
4. **Cloudflare Account ID:** shown on the right of the Workers & Pages overview page.
5. **GitHub secrets:** in your repository, Settings > Secrets and variables > Actions >
   New repository secret. Add three:
   `CLOUDFLARE_API_TOKEN`, `CLOUDFLARE_ACCOUNT_ID`, `ANTHROPIC_API_KEY`.
6. **First crawl:** Actions tab > **Crawl kiu.ac.ug** > Run workflow. It takes 20-30 minutes.
   When it succeeds, **Deploy Dlano to Cloudflare** starts by itself.
7. **Open Dlano:** the deploy log ends with the address, e.g.
   `https://dlano-kiu.<your-subdomain>.workers.dev`. It's HTTPS, so the microphone works on
   phones and computers. To use your own address (e.g. `dlano.kiu.ac.ug`), add a
   Custom Domain under the Worker's Settings > Domains & Routes.

After 15 quiet minutes the container sleeps to save money; the next visitor wakes it, which
takes a few seconds.

## Configuration

| Env var | Default | Purpose |
|---|---|---|
| `ANTHROPIC_API_KEY` | — | Claude API key (required) |
| `KIU_MODEL` | `claude-opus-5-5` | Claude model used to answer |
| `KIU_PAGES` | `data/pages.jsonl` | Crawled content file |

## Tests

```bash
pytest -q tests
```

## Next steps

- **Phone line:** connect a number through a telephony provider (e.g. Twilio or Africa's
  Talking) whose speech webhook calls `/api/ask`, so callers get the same answers by phone.
- **More languages:** add an entry to `TEXT` in `static/index.html` and to `LANGUAGES` in
  `assistant.py` (e.g. Luganda, if the browser supports its speech recognition).
