#!/usr/bin/env python3
"""
QR-triggered mobile cybersecurity classroom demo.

Standard-library HTTP server; no external packages are required to run it.
It only ever receives the small set of explicitly consented, low-sensitivity
browser/device fields listed in ALLOWED_FIELDS below. It cannot and does not
access the phone's private content.

Educational / authorized-use only. See README.md and INSTRUCTOR_GUIDE.md.
"""
from http.server import ThreadingHTTPServer, BaseHTTPRequestHandler
from urllib.parse import urlparse, parse_qs
from pathlib import Path
import argparse
import hmac
import json
import os
import secrets
import socket
import threading
import time

ROOT = Path(__file__).resolve().parent
STATIC = (ROOT / "static").resolve()
TOKEN_FILE = ROOT / ".demo_token"
DATA_FILE = ROOT / "telemetry.jsonl"
LOCK = threading.Lock()

# Keep the on-disk log bounded so a long or repeated lab session cannot grow
# the file without limit.
MAX_RECORDS = 2000
# Reject bodies larger than this many bytes before parsing.
MAX_BODY_BYTES = 16_000

# The ONLY keys the server will persist. Anything else a client sends is
# silently dropped. This is the data-minimization boundary of the demo.
ALLOWED_FIELDS = {
    "sessionId", "consent", "consentAt", "userAgent", "platform", "language",
    "timezone", "screen", "viewport", "online", "battery", "startedAt",
    "event", "pageVisibility",
}

MIME_TYPES = {
    ".html": "text/html; charset=utf-8",
    ".css": "text/css; charset=utf-8",
    ".js": "application/javascript; charset=utf-8",
    ".json": "application/json; charset=utf-8",
    ".png": "image/png",
    ".svg": "image/svg+xml",
}

# Static files that may be served without the dashboard token.
PUBLIC_STATIC = {"index.html", "app.js", "style.css"}
# Static files that require the dashboard token (operator-only views).
PRIVATE_STATIC = {"dashboard.html", "dashboard.js"}

SECURITY_HEADERS = {
    "X-Content-Type-Options": "nosniff",
    "Cache-Control": "no-store",
    "Referrer-Policy": "no-referrer",
    "Content-Security-Policy": (
        "default-src 'self'; img-src 'self' data:; "
        "style-src 'self' 'unsafe-inline'; script-src 'self'; "
        "connect-src 'self'; base-uri 'none'; form-action 'none'; "
        "frame-ancestors 'none'"
    ),
}


def load_or_create_token() -> str:
    """Load the persisted demo token, or mint and store a new one."""
    if TOKEN_FILE.exists():
        existing = TOKEN_FILE.read_text(encoding="utf-8").strip()
        if existing:
            return existing
    token = secrets.token_urlsafe(18)
    TOKEN_FILE.write_text(token, encoding="utf-8")
    try:
        TOKEN_FILE.chmod(0o600)
    except OSError:
        pass
    return token


TOKEN = load_or_create_token()


def valid_token(params) -> bool:
    """Constant-time comparison of the supplied ?token= against the demo token."""
    supplied = params.get("token", [""])[0]
    return hmac.compare_digest(supplied, TOKEN)


def local_ip() -> str:
    """Best-effort LAN IP discovery; no packet is actually sent to the target."""
    s = socket.socket(socket.AF_INET, socket.SOCK_DGRAM)
    try:
        s.connect(("192.0.2.1", 80))  # TEST-NET-1; routing lookup only
        return s.getsockname()[0]
    except OSError:
        return "127.0.0.1"
    finally:
        s.close()


def read_static(name: str):
    """Return (body_bytes, mime, status) for a file under STATIC, safely."""
    candidate = (STATIC / name).resolve()
    # Path-traversal guard: the resolved path must stay inside STATIC.
    if candidate != STATIC and STATIC not in candidate.parents:
        return b"Not found", "text/plain; charset=utf-8", 404
    if not candidate.is_file():
        return b"Not found", "text/plain; charset=utf-8", 404
    mime = MIME_TYPES.get(candidate.suffix, "application/octet-stream")
    return candidate.read_bytes(), mime, 200


def append_record(record: dict) -> None:
    """Append one record and trim the log to MAX_RECORDS lines."""
    with LOCK:
        with DATA_FILE.open("a", encoding="utf-8") as f:
            f.write(json.dumps(record, ensure_ascii=False) + "\n")
        try:
            lines = DATA_FILE.read_text(encoding="utf-8").splitlines()
            if len(lines) > MAX_RECORDS:
                DATA_FILE.write_text(
                    "\n".join(lines[-MAX_RECORDS:]) + "\n", encoding="utf-8"
                )
        except OSError:
            pass


def read_records():
    """Return the stored records (most recent MAX_RECORDS), tolerating bad lines."""
    rows = []
    if not DATA_FILE.exists():
        return rows
    with LOCK:
        lines = DATA_FILE.read_text(encoding="utf-8").splitlines()[-MAX_RECORDS:]
    for line in lines:
        try:
            rows.append(json.loads(line))
        except json.JSONDecodeError:
            continue
    return rows


class Handler(BaseHTTPRequestHandler):
    server_version = "ClassroomCyberDemo/1.1"
    protocol_version = "HTTP/1.1"

    def log_message(self, fmt, *args):
        # Log method + path only; never echo query strings (they carry tokens).
        path = urlparse(self.path).path
        print(f"{self.client_address[0]} - {self.command} {path}")

    def send_bytes(self, status, body: bytes, content_type="text/plain; charset=utf-8"):
        self.send_response(status)
        self.send_header("Content-Type", content_type)
        self.send_header("Content-Length", str(len(body)))
        for key, value in SECURITY_HEADERS.items():
            self.send_header(key, value)
        self.end_headers()
        if self.command != "HEAD":
            self.wfile.write(body)

    def send_json(self, status, obj):
        self.send_bytes(status, json.dumps(obj).encode("utf-8"),
                        "application/json; charset=utf-8")

    # ---- routing -------------------------------------------------------

    def do_HEAD(self):
        self.do_GET()

    def do_GET(self):
        parsed = urlparse(self.path)
        params = parse_qs(parsed.query)
        route = parsed.path

        if route == "/":
            return self._serve_static("index.html")
        if route in ("/app.js", "/style.css"):
            return self._serve_static(route.lstrip("/"))

        if route == "/dashboard":
            if not valid_token(params):
                return self.send_bytes(403, b"Forbidden. Open the dashboard URL printed by server.py.")
            return self._serve_static("dashboard.html")
        if route == "/dashboard.js":
            if not valid_token(params):
                return self.send_bytes(403, b"Forbidden.")
            return self._serve_static("dashboard.js")

        if route == "/api/config":
            if not valid_token(params):
                return self.send_json(403, {"error": "forbidden"})
            return self.send_json(200, {"token": TOKEN, "maxRecords": MAX_RECORDS})

        if route == "/api/telemetry":
            if not valid_token(params):
                return self.send_json(403, {"error": "forbidden"})
            return self.send_json(200, read_records())

        if route == "/health":
            return self.send_bytes(200, b"ok")

        return self.send_bytes(404, b"Not found")

    def do_POST(self):
        parsed = urlparse(self.path)
        params = parse_qs(parsed.query)
        route = parsed.path

        if route == "/api/telemetry":
            return self._ingest_telemetry(params)
        if route == "/api/purge":
            return self._purge(params)
        return self.send_bytes(404, b"Not found")

    def do_PUT(self):
        self.send_bytes(405, b"Method not allowed")

    do_DELETE = do_PUT
    do_PATCH = do_PUT

    # ---- helpers -------------------------------------------------------

    def _serve_static(self, name):
        body, mime, status = read_static(name)
        return self.send_bytes(status, body, mime)

    def _read_body(self):
        """Read and size-check the request body. Returns bytes or None."""
        try:
            length = int(self.headers.get("Content-Length", "0"))
        except ValueError:
            return None
        if length < 1 or length > MAX_BODY_BYTES:
            return None
        return self.rfile.read(length)

    def _ingest_telemetry(self, params):
        if not valid_token(params):
            return self.send_json(403, {"error": "forbidden"})
        raw = self._read_body()
        if raw is None:
            return self.send_json(413, {"error": "invalid size"})
        try:
            payload = json.loads(raw.decode("utf-8"))
        except (ValueError, UnicodeDecodeError):
            return self.send_json(400, {"error": "bad request"})
        if not isinstance(payload, dict):
            return self.send_json(400, {"error": "bad request"})

        # Only persist consented submissions, and only allowlisted keys.
        if payload.get("consent") is not True:
            return self.send_json(400, {"error": "consent required"})

        record = {k: payload[k] for k in ALLOWED_FIELDS if k in payload}
        # Never accept arbitrary fields such as files, contacts,
        # geolocation, clipboard, or credentials.
        record["receivedAt"] = time.strftime("%Y-%m-%dT%H:%M:%SZ", time.gmtime())
        record["sourceIp"] = self.client_address[0]  # LAN address, lab correlation only
        append_record(record)
        return self.send_json(201, {"ok": True})

    def _purge(self, params):
        """Operator-only: erase all collected telemetry (token required)."""
        if not valid_token(params):
            return self.send_json(403, {"error": "forbidden"})
        with LOCK:
            try:
                if DATA_FILE.exists():
                    DATA_FILE.unlink()
            except OSError:
                return self.send_json(500, {"error": "could not erase"})
        return self.send_json(200, {"ok": True, "purged": True})


def parse_args():
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--host", default=os.environ.get("DEMO_HOST", "0.0.0.0"),
                        help="Interface to bind (default 0.0.0.0 for LAN access).")
    parser.add_argument("--port", type=int, default=int(os.environ.get("DEMO_PORT", "8000")),
                        help="Port to listen on (default 8000).")
    parser.add_argument("--purge", action="store_true",
                        help="Erase telemetry.jsonl and exit.")
    return parser.parse_args()


def main():
    args = parse_args()
    if args.purge:
        if DATA_FILE.exists():
            DATA_FILE.unlink()
            print(f"Erased {DATA_FILE}")
        else:
            print("No telemetry file to erase.")
        return

    ip = local_ip()
    ThreadingHTTPServer.allow_reuse_address = True
    server = ThreadingHTTPServer((args.host, args.port), Handler)
    port = args.port
    print("\nQR Mobile Cybersecurity Demo (authorized classroom use only)")
    print("------------------------------------------------------------")
    print(f"Phone URL (encode this as the QR code):")
    print(f"    http://{ip}:{port}/?token={TOKEN}")
    print(f"Dashboard (this computer):")
    print(f"    http://127.0.0.1:{port}/dashboard?token={TOKEN}")
    print(f"Dashboard (another LAN device):")
    print(f"    http://{ip}:{port}/dashboard?token={TOKEN}")
    print("\nGenerate the QR image:")
    print(f"    python generate_qr.py \"http://{ip}:{port}/?token={TOKEN}\"")
    print("\nKeep this on a trusted lab network. The server uses plain HTTP, not TLS.")
    print("Stop with Ctrl+C. Erase collected data with:  python server.py --purge\n")
    try:
        server.serve_forever()
    except KeyboardInterrupt:
        print("\nStopping demo server.")
    finally:
        server.server_close()


if __name__ == "__main__":
    main()
