"""Search index over the crawled pages: splits pages into chunks and ranks them with BM25."""

import json
import math
import re
from collections import Counter
from pathlib import Path

STOPWORDS = set("""
a an and are as at be by can do does for from has have how i in is it its me my of on or
our please tell that the their there this to was what when where which who why will with
you your about kiu kampala international university
""".split())


def tokenize(text):
    return [w for w in re.findall(r"[a-z0-9]+", text.lower()) if w not in STOPWORDS]


def chunk_text(text, size=1200, overlap=200):
    """Split text into ~size-character chunks on line boundaries, overlapping slightly."""
    lines, chunks, current = text.splitlines(), [], ""
    for line in lines:
        if current and len(current) + len(line) + 1 > size:
            chunks.append(current)
            current = current[-overlap:] if overlap else ""
        current = f"{current}\n{line}" if current else line
        while len(current) > size * 1.5:  # one very long line
            chunks.append(current[:size])
            current = current[size - overlap:]
    if current.strip():
        chunks.append(current)
    return chunks


class KnowledgeBase:
    def __init__(self, pages, k1=1.5, b=0.75):
        self.chunks = []
        for page in pages:
            for text in chunk_text(page["text"]):
                self.chunks.append({"url": page["url"], "title": page.get("title", ""), "text": text})

        self.k1, self.b = k1, b
        # Index the title with each chunk so "fees page" style questions match.
        self.term_freqs = [Counter(tokenize(c["title"] + " " + c["text"])) for c in self.chunks]
        self.lengths = [sum(tf.values()) for tf in self.term_freqs]
        self.avg_len = (sum(self.lengths) / len(self.lengths)) if self.lengths else 0
        doc_freq = Counter(term for tf in self.term_freqs for term in tf)
        n = len(self.chunks)
        self.idf = {t: math.log(1 + (n - df + 0.5) / (df + 0.5)) for t, df in doc_freq.items()}
        self.page_count = len({c["url"] for c in self.chunks})
        self.crawled_at = max((p.get("crawled_at", "") for p in pages), default="")

    @classmethod
    def from_jsonl(cls, path):
        path = Path(path)
        if not path.exists():
            return cls([])
        with open(path, encoding="utf-8") as f:
            return cls([json.loads(line) for line in f if line.strip()])

    def search(self, query, k=6):
        terms = set(tokenize(query))
        if not terms:
            return []
        scored = []
        for i, tf in enumerate(self.term_freqs):
            score = 0.0
            norm = self.k1 * (1 - self.b + self.b * self.lengths[i] / self.avg_len)
            for t in terms:
                if t in tf:
                    score += self.idf[t] * tf[t] * (self.k1 + 1) / (tf[t] + norm)
            if score > 0:
                scored.append((score, i))
        scored.sort(reverse=True)
        return [dict(self.chunks[i], score=round(s, 3)) for s, i in scored[:k]]
