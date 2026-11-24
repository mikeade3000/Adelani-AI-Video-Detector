# Africa in the Algorithm: presentation with live poll

*Africa in the Algorithm: AI Governance, Research Ecosystems, and the Cost of Arriving Late*
(ESAMI@50 Colloquium, Arusha, 25–27 November 2026).

## Running order (28 slides)

| Slides | Content |
|---|---|
| 1–18 | The presentation, from the title to *Limitations, stated plainly* |
| 19 | **Your turn:** the four questions with a large QR code |
| 20–23 | **Q1–Q4 live results**, with *Reveal answer* on Q1 (high risk) and Q2 (2 Dec 2027) and a word cloud on Q4 |
| 24 | **What the room told us:** headline figures, written summary, Q4 themes |
| 25 | **Where the gaps bite:** most urgent gap by country beside its Readiness Index score, top words, discussion questions, Copy summary / CSV / JSON |
| 26 | Conclusion: *Africa did not write the algorithm…* |
| 27–28 | About the presenter · Follow ESAMI |

**Keys:** → / Space / PgDn next, ← / PgUp back, **P** poll, **R** reveal answer, **F** full screen, **S** settings. Clickers and swiping work.

## Participant questions
- Optional: role (policymaker/regulator, academic, industry, development partner, other) and country (the 8 Readiness Index settings, another African country, outside Africa)
- Q1 risk tier of mobile-money credit scoring · Q2 compliance date for standalone high-risk AI · Q3 most urgent structural gap · Q4 one word: what must AI in Africa answer for?

The analysis compares the most urgent gap reported from higher-readiness settings (Index ≥ 2.5) with lower-readiness ones, and groups Q4 words into 8 themes (fairness and inclusion, accountability and redress, transparency, data and privacy, sovereignty and context, development, rights and dignity, trust).

## Setup
1. **Results server:** use `apps-script/Code.gs` (the same script as the AI Grading poll; one deployment serves both talks, and each talk uses its own session code). If you already deployed the earlier version, paste this new code and use **Deploy → Manage deployments → Edit → New version**. The URL stays the same.
2. **Upload** the whole `africa-algorithm` folder (`index.html`, `slides/`, `vendor/`) to a static HTTPS host that doesn't add a strict Content-Security-Policy.
3. **Connect:** in `index.html`, find `const SERVER_URL = "";` and paste the `/exec` URL between the quotes (optionally set `PAGE_URL` too). Or press **S** on the page and paste it in Settings.

Without a server URL the page runs in demo mode. Use **Settings → Add 40 sample responses** to rehearse.
