# Handwritten Theory Grader

A browser-based OCR and rubric-scoring tool for handwritten theory examinations, built for low-resource settings. It implements the system described in *AI-Powered Grading of Handwritten Theory Examinations: A Browser-Based OCR and Rubric-Scoring Tool for Low-Resource Settings* (Adewusi, Kampala International University).

The tool is a **first reader under examiner review**. It suggests a mark for every answer, and the examiner sees why, corrects it if needed and confirms it. It is not an autonomous marker.

## Features

| Component | What it does |
|---|---|
| Upload & rendering | JPG/PNG/WebP and multi-page PDF (Mozilla PDF.js). Files can be grouped into scripts per file, by filename prefix (`S01_p1.jpg`), or as one script. Pages can be rotated, reordered, removed and assigned to a question. |
| Handwriting boost | Greyscale → median filter → contrast stretch → sharpen → optional Otsu or adaptive binarisation → morphological closing. Strength is adjustable, with a before/after preview. |
| Dual-engine OCR | **Tesseract.js** runs offline in the browser (WebAssembly; engine and English model are bundled in `vendor/`). **OCR.space** is optional and needs a key. **Best of two** keeps the output with more dictionary words (rubric vocabulary + general English). |
| Rubric | Plain text: maximum mark, model answer and keyword groups with alternatives (`store \| save \| retain`, prefix `encrypt*`). The parsed preview shows errors. |
| Scoring | Normalisation and an OCR substitution list. Fuzzy keyword matching with normalised Levenshtein similarity ≥ θ (0.80). Cosine similarity of term-frequency vectors. `S = M × [w·cos + (1−w)·k]`, rounded to half marks. Off-topic flag when cos < τ (0.10) and no keywords match. |
| Examiner review | Page viewer, editable OCR text (re-scores live), matched keywords highlighted in context, missing keywords, green/amber/red confidence with reasons. Accept or change each mark and record the reason (OCR text corrected or different judgement). A marking timer runs per script. Scripts near the pass mark are flagged for full re-marking (default 8–12 of 20). |
| Results | Per-question and per-script CSV export, JSON session save/load (with or without images), print view, override statistics. |
| Evaluation | MAE (marks and % of max), RMSE, bias, Bland–Altman limits and plot, standardised mean difference, QWK, ICC(2,1), Spearman's ρ on script totals with cluster-bootstrap CIs. Script- and response-level confusion matrices with accuracy, sensitivity, specificity, PPV, NPV, F1, Cohen's κ and McNemar's test (Clopper–Pearson CIs). Error-band table and pre-specified acceptance criteria. CER/WER for OCR, and a Wilcoxon signed-rank test for marking time. |

## Privacy

With the default Tesseract.js engine, nothing leaves the device. Pages are stored in the browser's IndexedDB, and marks in localStorage. Page images are sent to OCR.space only when the examiner turns on the cloud engine; the header badge shows which mode is active.

## Running it

The app is static files with no build step and no server code. Because OCR runs in a web worker, the folder must be served over HTTP rather than opened as a `file://` page:

```bash
cd grader
python3 -m http.server 8080      # or: npm start
# open http://localhost:8080
```

It also works on GitHub Pages: open `/grader/` on the Pages site. After the first visit, a service worker caches the app, OCR engine and language model, so it keeps working offline. It is installable as a PWA.

Quick start: **Rubric** → *Load sample*, then **Scripts** → *Add demo script* → *Run OCR & score*, then **Review**.

## Tests

```bash
cd grader && npm test     # node --test, no dependencies
```

The statistics tests reproduce the manuscript's Table 7 values (e.g. script-level κ = 0.80, McNemar χ² = 0.25, p = 0.62; response-level κ = 0.73, χ² = 1.71, p = 0.19). They also reproduce the Shrout & Fleiss ICC(2,1) worked example.

## Layout

```
grader/
  index.html, css/app.css, sw.js, manifest.webmanifest, icon.svg
  js/scoring.js      rubric parser, normalisation, keyword matching, cosine, score, segmentation
  js/stats.js        agreement / classification statistics
  js/evaluation.js   CSV handling and the evaluation report
  js/preprocess.js   handwriting boost
  js/ocr.js          PDF.js rendering, Tesseract.js, OCR.space, best-of-two
  js/store.js        IndexedDB / localStorage persistence
  js/app.js          UI controller
  vendor/            PDF.js 3.11.174, Tesseract.js 5.1.1 + core, eng model (Apache-2.0)
  tests/             node:test unit tests
```

## Limits (from the study)

- Scores measure word overlap, not meaning. Add alternative phrasings to the keyword groups, and review every mark.
- Mathematical notation, formulae and diagrams are not recognised reliably.
- OCR accuracy depends on scan quality. Scan at 300 dpi or more, with flat pages and even lighting.
