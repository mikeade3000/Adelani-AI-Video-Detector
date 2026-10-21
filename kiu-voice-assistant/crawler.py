"""Crawl kiu.ac.ug and save the readable text of every page to a JSONL file.

Usage:
    python crawler.py                       # crawl https://kiu.ac.ug -> data/pages.jsonl
    python crawler.py --max-pages 300       # smaller test crawl
    python crawler.py --domain kiu.ac.ug --domain admissions.kiu.ac.ug
"""

import argparse
import io
import json
import re
import sys
import time
import xml.etree.ElementTree as ET
from collections import deque
from datetime import datetime, timezone
from pathlib import Path
from urllib.parse import urldefrag, urljoin, urlparse
from urllib.robotparser import RobotFileParser

import requests
from bs4 import BeautifulSoup

USER_AGENT = "KIU-Voice-Assistant-Crawler/1.0 (+https://kiu.ac.ug)"

# File types that never contain readable page text.
SKIP_EXTENSIONS = {
    ".jpg", ".jpeg", ".png", ".gif", ".svg", ".webp", ".ico", ".bmp",
    ".mp3", ".mp4", ".avi", ".mov", ".wmv", ".webm",
    ".zip", ".rar", ".7z", ".gz", ".tar", ".exe", ".apk",
    ".css", ".js", ".json", ".xml", ".woff", ".woff2", ".ttf", ".eot",
    ".doc", ".docx", ".xls", ".xlsx", ".ppt", ".pptx",
}

# Page parts that are boilerplate rather than content.
NOISE_TAGS = ["script", "style", "noscript", "iframe", "svg", "form", "nav", "header", "footer", "aside"]

SITEMAP_PATHS = ["/sitemap.xml", "/sitemap_index.xml", "/wp-sitemap.xml"]


def normalize_url(url):
    url, _ = urldefrag(url)
    parsed = urlparse(url)
    if parsed.scheme not in ("http", "https"):
        return None
    path = parsed.path or "/"
    # Drop tracking/query noise but keep queries that select content (e.g. ?page_id=12).
    query = parsed.query
    if query and re.search(r"(utm_|fbclid|replytocom|share=)", query):
        query = ""
    return f"{parsed.scheme}://{parsed.netloc.lower()}{path}" + (f"?{query}" if query else "")


def host_allowed(url, domains):
    host = urlparse(url).netloc.lower().split(":")[0]
    if host.startswith("www."):
        host = host[4:]
    return host in domains


def should_skip(url):
    path = urlparse(url).path.lower()
    if any(path.endswith(ext) for ext in SKIP_EXTENSIONS):
        return True
    # Login pages, feeds and admin areas add nothing a caller would ask about.
    return bool(re.search(r"/(wp-admin|wp-login|wp-json|feed|login|cart|checkout)(/|$)", path))


def extract_html(html, url):
    soup = BeautifulSoup(html, "html.parser")
    title = soup.title.get_text(" ", strip=True) if soup.title else url
    links = [a["href"] for a in soup.find_all("a", href=True)]

    for tag in soup(NOISE_TAGS):
        tag.decompose()
    root = soup.find("main") or soup.find("article") or soup.body or soup

    lines, seen = [], set()
    for line in root.get_text("\n").splitlines():
        line = re.sub(r"\s+", " ", line).strip()
        if len(line) < 2 or line in seen:
            continue
        seen.add(line)
        lines.append(line)
    return title, "\n".join(lines), links


def extract_pdf(content):
    try:
        from pypdf import PdfReader
    except ImportError:
        return None
    try:
        reader = PdfReader(io.BytesIO(content))
        text = "\n".join((page.extract_text() or "") for page in reader.pages[:60])
    except Exception:
        return None
    return re.sub(r"[ \t]+", " ", text).strip()


def sitemap_urls(session, base, timeout):
    """Collect page URLs from the site's sitemap(s), following sitemap indexes."""
    found, queue, visited = [], [urljoin(base, p) for p in SITEMAP_PATHS], set()
    while queue and len(visited) < 50:
        sm = queue.pop(0)
        if sm in visited:
            continue
        visited.add(sm)
        try:
            resp = session.get(sm, timeout=timeout)
            if resp.status_code != 200:
                continue
            tree = ET.fromstring(resp.content)
        except (requests.RequestException, ET.ParseError):
            continue
        for loc in tree.iter():
            if not loc.tag.endswith("loc") or not loc.text:
                continue
            url = loc.text.strip()
            if url.endswith(".xml") or "sitemap" in url.rsplit("/", 1)[-1]:
                queue.append(url)
            else:
                found.append(url)
    return found


def load_robots(session, base, timeout):
    robots = RobotFileParser()
    try:
        resp = session.get(urljoin(base, "/robots.txt"), timeout=timeout)
        robots.parse(resp.text.splitlines() if resp.status_code == 200 else [])
    except requests.RequestException:
        robots.parse([])
    return robots


def crawl(start_url, domains, out_path, max_pages=2000, delay=0.5, timeout=20, log=print):
    session = requests.Session()
    session.headers["User-Agent"] = USER_AGENT
    robots = load_robots(session, start_url, timeout)

    queue = deque([normalize_url(start_url)])
    for url in sitemap_urls(session, start_url, timeout):
        url = normalize_url(url)
        if url and host_allowed(url, domains):
            queue.append(url)

    seen, saved = set(), 0
    crawled_at = datetime.now(timezone.utc).isoformat(timespec="seconds")
    out_path.parent.mkdir(parents=True, exist_ok=True)
    with open(out_path, "w", encoding="utf-8") as out:
        while queue and saved < max_pages:
            url = queue.popleft()
            if not url or url in seen:
                continue
            seen.add(url)
            if not host_allowed(url, domains) or should_skip(url) or not robots.can_fetch(USER_AGENT, url):
                continue

            try:
                resp = session.get(url, timeout=timeout)
            except requests.RequestException as e:
                log(f"  ! {url}: {e}")
                continue
            if resp.status_code != 200:
                continue
            final_url = normalize_url(resp.url) or url
            seen.add(final_url)

            ctype = resp.headers.get("Content-Type", "").lower()
            if "pdf" in ctype or final_url.lower().endswith(".pdf"):
                title, text, links = final_url.rsplit("/", 1)[-1], extract_pdf(resp.content), []
            elif "html" in ctype:
                title, text, links = extract_html(resp.text, final_url)
            else:
                continue

            for href in links:
                link = normalize_url(urljoin(final_url, href))
                if link and link not in seen and host_allowed(link, domains):
                    queue.append(link)

            if text and len(text) >= 80:
                out.write(json.dumps({"url": final_url, "title": title, "text": text,
                                      "crawled_at": crawled_at}, ensure_ascii=False) + "\n")
                saved += 1
                log(f"[{saved}] {final_url}")
            if delay:
                time.sleep(delay)
    return saved


def main(argv=None):
    parser = argparse.ArgumentParser(description=__doc__, formatter_class=argparse.RawDescriptionHelpFormatter)
    parser.add_argument("--start", default="https://kiu.ac.ug/")
    parser.add_argument("--domain", action="append",
                        help="Host to stay within (repeatable). Default: kiu.ac.ug")
    parser.add_argument("--out", default=str(Path(__file__).parent / "data" / "pages.jsonl"))
    parser.add_argument("--max-pages", type=int, default=2000)
    parser.add_argument("--delay", type=float, default=0.5, help="Seconds between requests")
    args = parser.parse_args(argv)

    domains = {d.lower().removeprefix("www.") for d in (args.domain or ["kiu.ac.ug"])}
    saved = crawl(args.start, domains, Path(args.out), args.max_pages, args.delay)
    print(f"Saved {saved} pages to {args.out}")
    return 0 if saved else 1


if __name__ == "__main__":
    sys.exit(main())
