# QR Mobile Cybersecurity Demo

A **consent-based classroom demonstration** of a QR-code (&ldquo;quishing&rdquo;) plus
scareware attack pattern. A QR code opens a web page on a test phone; after the
participant checks a consent box and presses **Consent and start simulation**, the
page sends a small set of browser/device telemetry to a local Python server and
displays a full-screen **simulated** lock screen.

> ⚠️ **Authorized, educational use only.** Run this only on devices you own or are
> explicitly permitted to test, on a trusted lab network. It is a teaching aid, not
> an attack tool.

---

## What it does / does not do

**Does**
- Report, after consent: browser user-agent, reported platform, language, time zone,
  screen/viewport dimensions and pixel ratio, online status, optional battery
  percentage (only if the browser exposes it), a random session ID, event name,
  timestamps, and the phone's local-network source IP as seen by the server.
- Show a convincing but clearly-labeled **simulated** lock screen.
- Store records locally in `telemetry.jsonl` and display them on a local dashboard.

**Does not**
- Lock Android, disable physical buttons, or change any device setting.
- Persist after the browser tab is closed, or install any software.
- Collect contacts, SMS, call logs, photos, files, passwords, GPS location,
  camera, microphone, or clipboard contents.

The participant can always leave the simulation: an **End simulation** button,
the <kbd>Esc</kbd> key, the browser **Back** control, a hidden five-tap corner
gesture, or an automatic timeout (120 s).

---

## Requirements

- A computer with **Python 3.9+** (server uses only the standard library).
- An Android (or any) phone with a current browser and a QR scanner.
- Both devices on the **same trusted Wi-Fi/LAN**.
- *For QR image generation only:* the `qrcode[pil]` package
  (`pip install -r requirements.txt`).

---

## Quick start

1. Open a terminal in the `qr_mobile_cyber_demo` folder.
2. Start the server:

   **Windows**
   ```powershell
   py server.py
   ```
   **macOS / Linux**
   ```bash
   python3 server.py
   ```

3. The server prints three URLs and a unique token, e.g.:
   ```
   Phone URL (encode this as the QR code):
       http://192.168.1.23:8000/?token=XXXXXXXX
   Dashboard (this computer):
       http://127.0.0.1:8000/dashboard?token=XXXXXXXX
   ```

4. Turn the **Phone URL** into a QR code (optional helper):
   ```bash
   pip install -r requirements.txt
   python generate_qr.py "http://192.168.1.23:8000/?token=XXXXXXXX"
   # or, to print it in the terminal without saving a file:
   python generate_qr.py "http://..." --terminal
   ```

5. Open the **Dashboard** URL on the instructor's computer.
6. Have a consenting participant scan the QR code, read the disclosure, tick the
   consent box, and start the simulation. Records appear on the dashboard.

Change the port or interface:
```bash
python server.py --port 9000 --host 127.0.0.1
```

---

## Erasing collected data

The log lives in `telemetry.jsonl`. Erase it any time:

```bash
python server.py --purge
```
or use the **Erase all data** button on the dashboard. The log is also
automatically capped at the most recent 2000 records.

---

## How it is kept safe (design notes)

- **Consent gate** — no telemetry is accepted unless the payload carries
  `consent: true`; the server rejects anything else.
- **Data minimization** — the server persists only an explicit allowlist of
  fields (`ALLOWED_FIELDS` in `server.py`); unknown keys are dropped.
- **Token-gated operator views** — the dashboard, config, and purge endpoints
  require the per-run token (compared in constant time).
- **Bounded input** — request bodies over 16 KB are rejected before parsing.
- **Security headers** — `Content-Security-Policy`, `nosniff`, `no-store`,
  `no-referrer` on every response; scripts load only from the same origin.
- **Always-available exit** and an automatic timeout so no participant is ever
  stuck on the simulated lock screen.

---

## Files

| File | Purpose |
| --- | --- |
| `server.py` | Standard-library HTTP server, telemetry ingest, dashboard API. |
| `static/index.html`, `app.js`, `style.css` | Participant-facing consent flow, simulation, and debrief. |
| `static/dashboard.html`, `dashboard.js` | Instructor dashboard (token-gated). |
| `generate_qr.py` | Turn the phone URL into a QR image or terminal QR. |
| `INSTRUCTOR_GUIDE.md` | Lesson plan, attack-pattern explanation, discussion prompts. |
| `telemetry.jsonl` | Collected records (created at run time; safe to delete). |
| `.demo_token` | Persisted per-install token (created at run time). |

---

## Limitations

- Uses **plain HTTP**, not TLS — intended only for an isolated lab network.
- The simulated lock screen depends on the browser's full-screen API, which some
  browsers restrict; the demo still works without full screen.
- The battery field is unavailable in most modern browsers (the Battery Status
  API has been removed or restricted) and will read &ldquo;Not available.&rdquo;

See **INSTRUCTOR_GUIDE.md** for how to run this as a lesson.
