# Instructor Guide — QR Mobile Security Lab

A 30&ndash;45 minute lesson that lets students *feel* a QR-code social-engineering
attack from the inside, then debriefs the real security lessons. Everything is
simulated and consent-based; no device is actually compromised.

> **Ethics first.** Only run this on devices the participants own or are
> explicitly authorized to test, on an isolated/trusted network. Read the consent
> screen aloud before anyone scans. Make clear that doing this to someone without
> consent is both harmful and, in most jurisdictions, illegal.

---

## Learning objectives

By the end, students can:
1. Explain **quishing** — phishing delivered through a QR code — and why QR codes
   lower a victim's guard.
2. Describe how a single tap can hand over device/browser **fingerprinting** data.
3. Recognize **scareware**: a fake &ldquo;your device is locked / pay to unlock&rdquo; screen,
   and explain why a web page can never truly lock a phone.
4. List concrete defenses for QR codes and scareware.

---

## The attack pattern being modeled

```
   [1] Lure            [2] Delivery         [3] Payload           [4] Pressure
   Poster / sticker →  QR code opens a  →   Page collects    →    Fake lock screen,
   "Scan to win /      web page on the      browser/device        "pay to unlock"
    verify / pay"      phone's browser      fingerprint           (scareware)
```

- **Quishing** works because a QR code hides its destination. People scan posters,
  menus, parking meters, and email attachments without previewing the URL.
- The **payload** here is deliberately tame: ordinary fields any website can read
  from a browser (user-agent, time zone, screen size, language). The point is to
  show how much is exposed by *just visiting a page*, with no exploit at all.
- The **pressure** stage is scareware. Real campaigns add a countdown, a logo, and
  a payment demand. The defense is the same: a web page cannot lock your phone.

What a **real** attacker would do differently (discuss, do not build):
skip the consent box, disguise the page as a bank or employer, hide any exit,
and try to lure the victim into entering credentials or paying. This lab stops
exactly where those lines begin — which is itself a teaching point.

---

## Before class (setup, ~5 min)

1. Put the computer and phones on the same trusted Wi-Fi.
2. Start the server: `python3 server.py` (see README).
3. Generate the QR from the printed **Phone URL**:
   `python generate_qr.py "http://.../?token=..." --terminal`
4. Open the **Dashboard** URL and project it.

---

## Run of show

| Time | Step |
| --- | --- |
| 0:00 | Show a QR code with no visible URL. Ask: &ldquo;Would you scan this in the wild?&rdquo; |
| 0:05 | Volunteers scan. Read the consent screen aloud; everyone taps **Consent and start**. |
| 0:08 | The simulated lock screen appears. Let the tension sit, then show the exit paths. |
| 0:12 | Switch to the projected dashboard. Walk through what each column reveals. |
| 0:20 | Debrief the four defensive takeaways (below). |
| 0:30 | Discussion questions. Erase the data in front of the class (`--purge`). |

---

## Debrief: defensive takeaways

1. **Preview before you open.** Most phone cameras show the URL before opening it.
   Treat an unexpected QR code like an unexpected link in a text message.
2. **A web page cannot lock your phone.** The power button, the app switcher, and
   force-closing the browser always work. &ldquo;You are locked&rdquo; is a bluff.
3. **Browsers reveal more than people expect.** User-agent, time zone, and screen
   size are normal fingerprinting signals, not a breach — but they still identify
   and track you. Privacy settings and tracker-blockers reduce this.
4. **&ldquo;Pay to unlock&rdquo; is scareware.** Never pay, never call the number. Close the
   tab, clear the site data, move on.

---

## Discussion questions

- Why is a QR code more persuasive than a plain link? Where have you scanned one
  this week without checking it?
- Which fields on the dashboard surprised you? Which could identify you across
  sites?
- How would the attack change if the page asked for your bank login? What makes
  this lab stop before that step?
- What would you tell a non-technical family member to do when a screen says their
  phone is locked?

---

## Responsible-use boundary

This project is intentionally limited so it can teach without causing harm:

- It requires explicit, on-screen consent and will not store a record without it.
- It collects only low-sensitivity, already-browser-exposed fields.
- The lock is visual only, always escapable, and auto-ends.
- It keeps no cloud copy; data stays on the instructor machine and is easy to erase.

Do not extend it to remove consent, collect sensitive data, add persistence, or
disguise it as a real organization. Those changes convert a teaching aid into an
attack, and this repository does not support that use.
