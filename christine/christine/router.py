"""Fast local commands. These run instantly, cost nothing and work offline.
Anything not matched here goes to the AI brain."""
from __future__ import annotations

import re
from datetime import datetime

from .tools import run_tool
from .tools.system import battery_sentence
from .tools.web import KNOWN_SITES

STOP = re.compile(r"^(stop|stop it|stop talking|stop reading|stop singing|be quiet|quiet|shut up|enough|pause)$", re.I)
SLEEP = re.compile(r"^(go to sleep|sleep|that'?s all|that is all|goodbye|bye|good night|thank you,? that'?s all)$", re.I)
QUIT = re.compile(r"^(exit|quit|shut ?down christine|close christine|turn yourself off)$", re.I)
BATTERY = re.compile(r"\bbattery\b", re.I)
CONTINUE = re.compile(r"^(continue|keep) reading$|^continue$", re.I)

# Lenient patterns: people ask the same thing many ways ("what is it by the time?").
TIME = re.compile(r"\b(what|what'?s|whats|tell me|check|give me)\b.*\btime\b|\btime\b.*\b(now|please)\b|\bby the time\b", re.I)
NOT_TIME = re.compile(r"\b(timer|times|time zone|spend|spent|last time|next time|on time|in time|how much time|free time)\b", re.I)
DATE = re.compile(r"\b(what|what'?s|tell me|check)\b.*\b(date|day is (it|today)|today'?s date)\b|\bwhat day\b", re.I)
OPEN_WORDS = re.compile(r"\b(open|launch|go to|visit|show me|bring up|take me to|load|pull up)\b", re.I)
CLOSE_WORDS = re.compile(r"\b(close|shut)\b", re.I)
ALL_SITES = re.compile(r"\b(all|every)\b.*\b(sites?|websites?|windows?|tabs?|browsers?)\b", re.I)
LAST_SITE = re.compile(r"\b(last|that|this|the)\b.*\b(sites?|websites?|page|window|tab)\b|\bclose (it|that)\b", re.I)
DOMAIN_IN_TEXT = re.compile(
    r"\b([a-z0-9-]+(?:\.[a-z0-9-]+)*\.(?:com|ng|org|net|io|ai|co|uk|edu|gov|tv|info)(?:\.[a-z]{2})?)\b", re.I)


def find_site(text: str) -> str | None:
    """Find a known website name, or a domain like punchng.com, inside a sentence."""
    m = DOMAIN_IN_TEXT.search(text)
    if m:
        return m.group(1).lower()
    for name in sorted(KNOWN_SITES, key=len, reverse=True):  # "google maps" before "google"
        if len(name) > 1 and re.search(rf"\b{re.escape(name)}\b", text, re.I):
            return name
    return None


def route(text: str, ctx) -> tuple[str, str | None]:
    """Return (kind, reply). kind is 'stop', 'sleep', 'quit', 'handled' or 'brain'."""
    t = text.strip().strip(".!?").strip()
    if not t:
        return "brain", None
    if STOP.match(t):
        return "stop", None
    if SLEEP.match(t):
        return "sleep", "Okay! Just say my name when you need me."
    if QUIT.match(t):
        return "quit", "Goodbye! Talk soon."
    if CONTINUE.match(t):
        out, _ = run_tool(ctx, "continue_reading", {})
        return "handled", out if out.startswith("There's nothing") else None

    # Longer sentences usually need real understanding, so they go to the brain.
    if len(t.split()) > 12:
        return "brain", None
    if BATTERY.search(t):
        return "handled", battery_sentence()
    if TIME.search(t) and not NOT_TIME.search(t):
        return "handled", "It's " + datetime.now().strftime("%I:%M %p").lstrip("0") + "."
    if DATE.search(t):
        return "handled", "Today is " + datetime.now().strftime("%A, %d %B %Y") + "."

    site = find_site(t)
    if CLOSE_WORDS.search(t):
        if not site and ALL_SITES.search(t):
            site = "all"
        elif not site and LAST_SITE.search(t):
            site = "last"
        if site:
            out, _ = run_tool(ctx, "close_website", {"site": site})
            return "handled", ("Closed it." if out.startswith("Closed") else out)
    elif site and OPEN_WORDS.search(t):
        run_tool(ctx, "open_website", {"site": site})
        return "handled", f"Opening {site}."
    return "brain", None
