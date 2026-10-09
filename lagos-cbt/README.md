# CBT Platform — Lagos State promotion examination practice

## Simplest install: two files (`dist/`)

| File | Where it goes |
|---|---|
| `dist/index.html` | Your web host. Replace your current `index.html`. |
| `dist/Code.gs` | Apps Script editor. Replace everything in your current `Code.gs`. |

These two files contain everything (all cadres and question banks). No other files are needed.

1. **Back up.** Make a copy of the Google Sheet (File ▸ Make a copy), and copy your old `Code.gs` text into Notepad.
2. **Check PEPPER.** In the old `Code.gs`, find `var PEPPER=`. If its value is not `cbt::change-this-secret::9f3a7`, open Project Settings ▸ Script properties and add `PEPPER` with your old value. Otherwise nobody can log in.
3. **Replace `Code.gs`** with `dist/Code.gs` and press Ctrl+S.
4. **Run `diagnostics`** once from the function dropdown and approve the permissions. This loads the new questions.
5. **Deploy ▸ Manage deployments ▸ ✏️ Edit ▸ Version: New version ▸ Deploy.** The `/exec` link stays the same.
6. **Upload `dist/index.html`** to your web host in place of the old one. Then open the site and press Ctrl+F5.
7. Log in as **superadmin**. You may be asked to choose a new password (8+ characters).

Optional: add a daily time-driven trigger for `pruneSessions`.

## For developers: source files

The `dist/` files are generated. Edit the sources, then run `node tools/build-single.js`:

| Source | Contents |
|---|---|
| `index.html` | Page and application logic |
| `Code.gs` | Backend logic |
| `cbt-shared.js` | Cadres, scope groups, grading, base + ICT banks |
| `cbt-bank-permsec.js` | Permanent Secretary bank |
| `cbt-bank-law-enforcement.js` | Law-enforcement banks |

Checks: `node tools/validate-banks.js` and `node tools/test-backend.js`.

## Question banks

| Scope | Questions | Seen by |
|---|---:|---|
| COMMON | 41 | everyone |
| Information & Communication Technology (ICT) Cadre | 93 | ICT cadre |
| **Permanent Secretary Cadre** | **257** | PS cadre (GL 17 Directors, Tutors-General) |
| GROUP: Law Enforcement (all enforcement cadres) | 34 | every enforcement cadre below |
| Traffic Management Officer Cadre (LASTMA) | 56 | LASTMA |
| Vehicle Inspection Officer Cadre (VIS) | 29 | VIS |
| Environmental & Special Offences Enforcement Cadre | 14 | enforcement unit |
| Neighbourhood Safety Corps Cadre (LNSC) | 14 | LNSC |

A Permanent Secretary candidate therefore practises from 298 questions (COMMON + PS). A LASTMA officer practises from 131 (COMMON + Law Enforcement group + Traffic).

The PS bank covers the same subjects as the general examination, at managerial level: quantitative (NPV, CAGR, variance, weighted averages), verbal reasoning, critical reasoning and logic, official English, Civil Service Rules and the Constitution, Financial Regulations and PFM, current affairs and ICT. It adds two new subjects: **Public Policy & Governance** and **Leadership & Strategic Management**, the latter including situational-judgement scenarios.

> **About "past questions".** Lagos does not publish its Permanent Secretary selection papers. Public reporting only confirms that eligible Directors sit written examinations followed by interviews. These questions are modelled on that format and on the governing documents (1999 Constitution, PSR, Financial Regulations, Lagos procurement law and the Code of Conduct). They are not copies of actual past papers. Penalty amounts in Lagos traffic law have been amended and reported inconsistently, so the traffic questions test principles and procedure rather than fine figures.

To add more questions, use **Question bank ▸ Add question / Bulk upload (CSV)**. A CSV scope can be `COMMON`, any cadre name, or `GROUP: Law Enforcement (all enforcement cadres)`.
