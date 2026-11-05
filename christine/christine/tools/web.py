"""Open and close websites, and search the web."""
from __future__ import annotations

import os
import shutil
import subprocess
import time
import urllib.parse
import webbrowser
from dataclasses import dataclass, field

from . import IS_WINDOWS, S, tool

KNOWN_SITES = {
    "google": "https://www.google.com", "youtube": "https://www.youtube.com",
    "gmail": "https://mail.google.com", "facebook": "https://www.facebook.com",
    "instagram": "https://www.instagram.com", "twitter": "https://x.com", "x": "https://x.com",
    "linkedin": "https://www.linkedin.com", "whatsapp": "https://web.whatsapp.com",
    "netflix": "https://www.netflix.com", "amazon": "https://www.amazon.com",
    "wikipedia": "https://www.wikipedia.org", "github": "https://github.com",
    "outlook": "https://outlook.live.com", "chatgpt": "https://chatgpt.com",
    "claude": "https://claude.ai", "bbc": "https://www.bbc.com", "cnn": "https://www.cnn.com",
    "spotify": "https://open.spotify.com", "maps": "https://maps.google.com",
    "google maps": "https://maps.google.com", "google drive": "https://drive.google.com",
    "drive": "https://drive.google.com", "tiktok": "https://www.tiktok.com",
    "reddit": "https://www.reddit.com", "punch": "https://punchng.com",
}

BROWSER_PROCESSES = {"msedge.exe", "chrome.exe", "firefox.exe", "brave.exe", "opera.exe"}

# Words a site's window title usually contains, when it differs from the domain name.
TITLE_HINTS = {"x.com": "x", "mail.google.com": "gmail", "web.whatsapp.com": "whatsapp",
               "maps.google.com": "maps", "drive.google.com": "drive", "outlook.live.com": "outlook",
               "open.spotify.com": "spotify", "punchng.com": "punch"}


@dataclass
class BrowserTracker:
    opened: list[dict] = field(default_factory=list)  # {"name", "url", "keyword", "time"}


def resolve_url(site: str) -> str:
    s = site.strip()
    low = s.lower().removeprefix("open ").strip()
    if low in KNOWN_SITES:
        return KNOWN_SITES[low]
    if low.startswith(("http://", "https://")):
        return s
    if "." in low and " " not in low:
        return "https://" + low
    return "https://www.google.com/search?q=" + urllib.parse.quote_plus(s)


def _keyword(url: str, name: str) -> str:
    host = urllib.parse.urlparse(url).netloc.lower().removeprefix("www.")
    if host in TITLE_HINTS:
        return TITLE_HINTS[host]
    if host.startswith("google.") and "search" in url:
        return "google search"
    return host.split(".")[0] if host else name.lower()


def _browser_exe() -> list[str] | None:
    candidates = [
        os.path.expandvars(r"%ProgramFiles%\Google\Chrome\Application\chrome.exe"),
        os.path.expandvars(r"%ProgramFiles(x86)%\Google\Chrome\Application\chrome.exe"),
        os.path.expandvars(r"%LocalAppData%\Google\Chrome\Application\chrome.exe"),
        os.path.expandvars(r"%ProgramFiles(x86)%\Microsoft\Edge\Application\msedge.exe"),
        os.path.expandvars(r"%ProgramFiles%\Microsoft\Edge\Application\msedge.exe"),
    ]
    for c in candidates:
        if os.path.exists(c):
            return [c]
    found = shutil.which("chrome") or shutil.which("msedge")
    return [found] if found else None


def browser_windows() -> list[tuple[int, str, str]]:
    """(window handle, title, process name) for visible browser windows."""
    if not IS_WINDOWS:
        return []
    import psutil
    import win32gui
    import win32process

    out = []

    def visit(hwnd, _):
        if not win32gui.IsWindowVisible(hwnd):
            return
        title = win32gui.GetWindowText(hwnd)
        if not title:
            return
        try:
            _, pid = win32process.GetWindowThreadProcessId(hwnd)
            pname = psutil.Process(pid).name().lower()
        except Exception:
            return
        if pname in BROWSER_PROCESSES:
            out.append((hwnd, title, pname))

    win32gui.EnumWindows(visit, None)
    return out


@tool("open_website",
      "Open a website in its own new browser window. site can be a name ('YouTube', 'Gmail'), "
      "a domain ('punchng.com'), a full URL, or search words (opens a Google search).",
      site=S("site name, domain, URL or search words"))
def open_website(ctx, site: str) -> str:
    url = resolve_url(site)
    exe = _browser_exe() if IS_WINDOWS else None
    if exe:
        subprocess.Popen(exe + ["--new-window", url])
    else:
        webbrowser.open_new(url)
    if ctx.browser is not None:
        ctx.browser.opened.append({"name": site, "url": url, "keyword": _keyword(url, site), "time": time.time()})
    return f"Opened {url}."


@tool("close_website",
      "Close the browser window showing a website, e.g. 'YouTube'. Use 'last' to close the most recent "
      "site Christine opened, or 'all' to close every browser window Christine opened.",
      site=S("site name, 'last' or 'all'"))
def close_website(ctx, site: str) -> str:
    if not IS_WINDOWS:
        return "Closing browser windows is only supported on Windows."
    import win32con
    import win32gui

    tracker = ctx.browser
    target = site.lower().strip()
    if target == "last" and tracker and tracker.opened:
        keywords = [tracker.opened[-1]["keyword"]]
    elif target == "all" and tracker and tracker.opened:
        keywords = [o["keyword"] for o in tracker.opened]
    else:
        url = resolve_url(site)
        keywords = list({target, _keyword(url, site)})

    closed = []
    for hwnd, title, _ in browser_windows():
        t = title.lower()
        if any(k and k in t for k in keywords):
            win32gui.PostMessage(hwnd, win32con.WM_CLOSE, 0, 0)
            closed.append(title)
    if tracker:
        tracker.opened = [o for o in tracker.opened if o["keyword"] not in keywords]
    if not closed:
        titles = [t for _, t, _ in browser_windows()]
        return (f"I couldn't find a browser window for '{site}'. Open browser windows: "
                + ("; ".join(titles) if titles else "none") + ". If the site is a tab inside a bigger "
                "window, I can only close whole windows.")
    return "Closed: " + "; ".join(closed)


@tool("list_browser_windows", "List the titles of the open browser windows.")
def list_browser_windows(ctx) -> dict:
    return {"windows": [t for _, t, _ in browser_windows()]}
