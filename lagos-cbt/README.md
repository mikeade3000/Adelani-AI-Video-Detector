# CBT Platform — Lagos State promotion examination practice

| File | Where it goes |
|---|---|
| `index.html` | Your web host (e.g. GitHub Pages) |
| `cbt-shared.js`, `cbt-bank-permsec.js`, `cbt-bank-law-enforcement.js` | **Both** places: next to `index.html` on the web host, **and** pasted into the Apps Script project as `cbt-shared.gs`, `cbt-bank-permsec.gs`, `cbt-bank-law-enforcement.gs` |
| `Code.gs` | Apps Script project only |
| `tools/` | Checks to run locally (`node tools/validate-banks.js`, `node tools/test-backend.js`) |

## Updating an existing deployment

1. In the Apps Script editor, replace `Code.gs` and add the three `.gs` files above.
2. *(Recommended)* Project Settings ▸ Script properties ▸ add `PEPPER` with **exactly** the current value of `PEPPER_FALLBACK` in `Code.gs` (`cbt::change-this-secret::9f3a7`). Do not change it, or existing passwords stop working.
3. Deploy ▸ Manage deployments ▸ edit ▸ **New version**, so the `/exec` URL stays the same.
4. Upload `index.html` and the three `.js` files to the web host.
5. On the next request the server adds the new banks once (Permanent Secretary, the Law Enforcement group, Traffic/LASTMA, VIS, Environmental Enforcement and LNSC) and fixes two old questions. Existing questions, users and attempts are left alone.
6. The super admin is asked to set a new password at the next login if the account still has `mustChange`. Admins you create from now on must also set their own password at first login.
7. *(Optional)* Add a daily time-driven trigger for `pruneSessions`.

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
