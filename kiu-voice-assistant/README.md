# KIU Voice Assistant

A voice question-answering assistant for Kampala International University. It reads the
whole of **kiu.ac.ug** and answers spoken questions about anything on the site
(admissions, fees, programmes, campuses, contacts) out loud, citing the pages it used.

```
 kiu.ac.ug ──crawler.py──▶ data/pages.jsonl ──knowledge.py (BM25 search)──┐
                                                                          ▼
 Browser mic ──speech-to-text──▶ /api/ask (server.py) ──▶ Claude (assistant.py)
 Browser speaker ◀──text-to-speech── answer + source links ◀──────────────┘
```

## Setup

```bash
cd kiu-voice-assistant
python -m venv .venv && source .venv/bin/activate     # Windows: .venv\Scripts\activate
pip install -r requirements.txt
export ANTHROPIC_API_KEY=sk-ant-...                  # from https://console.anthropic.com
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

## How answers stay accurate

- Each question retrieves the 6 most relevant passages from the crawled site; Claude is told to
  answer **only** from those passages and to say so when the site doesn't have the answer.
- Answers are short, plain spoken sentences (no URLs or markdown) so they sound natural aloud.
- Source page links are shown under each answer so staff can verify.

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
- **Languages:** browser speech recognition supports Swahili (`sw-KE`/`sw-TZ`); set
  `recognizer.lang` and ask Claude to reply in the caller's language.
- **Deployment:** run behind HTTPS (required for microphone access on non-localhost sites).
