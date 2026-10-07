# Google Scholar & ORCID: Practical Demonstration (KIU template)

An animated HTML slide deck with a live audience poll and ranking analysis, built for GitHub Pages.

| File | Purpose |
|------|---------|
| `index.html` | The presentation (23 slides) |
| `vote.html` | Mobile voting page opened by the QR code |
| `poll.js` | Shared poll engine: sending votes, live updates, ranking analysis |
| `assets/` | KIU logo and classroom icon from the KIU teaching template |

## Personalise
At the bottom of `index.html`, edit the `DECK` object (presenter name, event, contact).

## Presenting
Open `https://<user>.github.io/<repo>/scholar-orcid/` (do not use a local file, or phones can't reach the voting page).

* `→` / `Space`: next slide · `←`: previous · `F`: fullscreen
* `P`: presenter panel (voting link, add sample responses for rehearsal, CSV export, new session)
* `Q`: jump to the QR slide · `R`: jump to the results · `T`: light/dark theme

## How the live poll works
The QR code points to `vote.html?s=<session>`. Each phone ranks the 10 tools by tapping them in order of familiarity. Votes go through the free [ntfy.sh](https://ntfy.sh) relay (no account; messages are kept for about 12 hours), so the deck updates live with no server of your own. A person who resubmits replaces their earlier vote.

Use **Start a new poll session** in the presenter panel before each new audience. Remove sample responses before presenting.

**Optional, for persistent storage:** create a Firebase Realtime Database, allow read/write on `/polls`, and put its URL in `CONFIG.firebaseUrl` in `poll.js`.

## Ranking analysis
* **Familiarity score (Borda count):** 1st place = 10 points, 10th = 1 point. Unranked tools get 0. The total is scaled to 0–100.
* **First-choice votes:** how many people ranked each tool #1.
* **Reach:** the % of respondents who ranked the tool at all.
* **Average position:** the mean rank among people who ranked the tool.
* **Heatmap:** how many people placed each tool at each position.
* **Kendall's W:** how much the audience agrees (0 = no agreement, 1 = identical rankings).
