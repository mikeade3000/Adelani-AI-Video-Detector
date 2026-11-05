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
TIME = re.compile(r"\b(what'?s the time|what time is it|tell me the time|the time now)\b", re.I)
DATE = re.compile(r"\b(what'?s the date|what is the date|what day is (it|today)|today'?s date)\b", re.I)
OPEN_SITE = re.compile(r"^(?:please )?(?:open|launch|go to|show me)\s+(?:the\s+)?(.+?)(?:\s+(?:website|site|page))?$", re.I)
CLOSE_SITE = re.compile(r"^(?:please )?close\s+(?:the\s+)?(.+?)(?:\s+(?:website|site|page|window|tab))?$", re.I)
CONTINUE = re.compile(r"^(continue|keep) reading$|^continue$", re.I)
DOMAIN = re.compile(r"^[a-z0-9-]+(\.[a-z0-9-]+)+$", re.I)


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
    if BATTERY.search(t) and len(t.split()) <= 10:
        return "handled", battery_sentence()
    if TIME.search(t):
        return "handled", "It's " + datetime.now().strftime("%I:%M %p").lstrip("0") + "."
    if DATE.search(t):
        return "handled", "Today is " + datetime.now().strftime("%A, %d %B %Y") + "."
    if CONTINUE.match(t):
        out, _ = run_tool(ctx, "continue_reading", {})
        return "handled", out if out.startswith("There's nothing") else None

    m = OPEN_SITE.match(t)
    if m:
        site = m.group(1).strip().lower()
        if site in KNOWN_SITES or DOMAIN.match(site):
            run_tool(ctx, "open_website", {"site": site})
            return "handled", f"Opening {site}."
    m = CLOSE_SITE.match(t)
    if m:
        site = m.group(1).strip().lower()
        if site in KNOWN_SITES or DOMAIN.match(site) or site in ("last", "all"):
            out, _ = run_tool(ctx, "close_website", {"site": site})
            return "handled", ("Closed it." if out.startswith("Closed") else out)
    return "brain", None
