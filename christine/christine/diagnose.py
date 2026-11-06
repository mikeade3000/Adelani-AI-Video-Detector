"""Connection check: python -m christine --check

Tests the API key and the connection to Claude step by step and prints what
comes back, so problems can be pinned down. The key itself is never printed.
"""
from __future__ import annotations

import os

import anthropic


def _show_error(exc: Exception) -> None:
    print(f"    FAILED: {type(exc).__name__}")
    response = getattr(exc, "response", None)
    if response is None:
        print(f"    {exc}")
        return
    print(f"    HTTP status : {response.status_code}")
    headers = response.headers
    for name in ("server", "request-id", "x-request-id", "cf-ray", "content-type", "via", "x-cache"):
        if name in headers:
            print(f"    {name:12}: {headers[name]}")
    try:
        body = response.text.strip()
    except Exception as read_exc:  # body could not be read
        body = f"<could not read body: {read_exc}>"
    print(f"    body        : {body[:800] if body else '<empty>'}")
    if "request-id" not in headers:
        print("    NOTE: no 'request-id' header, so this reply probably did NOT come from Anthropic.\n"
              "          Something on this computer or network (antivirus web shield, firewall, VPN,\n"
              "          proxy) may be intercepting the connection.")


def run(cfg) -> None:
    print("\n=== Christine connection check ===\n")

    key = os.environ.get("ANTHROPIC_API_KEY", "")
    print("1. API key")
    if not key:
        print("    No key found. Run Christine's setup again (install.bat) and paste your key.")
        return
    bad_chars = [c for c in key if not c.isprintable() or c.isspace() or ord(c) > 127]
    print(f"    starts with : {key[:10]}...  (length {len(key)})")
    print(f"    looks right : {'yes' if key.startswith('sk-ant-') else 'NO - Anthropic keys start with sk-ant-'}")
    if bad_chars:
        print(f"    PROBLEM     : the key contains {len(bad_chars)} hidden/invalid character(s) "
              f"{[hex(ord(c)) for c in bad_chars[:5]]}. Paste it again with right-click.")
    print(f"    saved in    : {cfg.data_dir / '.env'}")

    print("\n2. Proxy settings on this computer")
    proxies = {k: v for k, v in os.environ.items() if k.lower() in ("http_proxy", "https_proxy", "all_proxy", "no_proxy")}
    print("    " + ("\n    ".join(f"{k}={v[:70]}" for k, v in proxies.items()) if proxies else "none"))

    client = anthropic.Anthropic(max_retries=0, timeout=30.0)

    print("\n3. Can the key list models? (simple request, no message)")
    try:
        models = [m.id for m in client.models.list(limit=20)]
        print(f"    OK. Models available to your key: {', '.join(models)}")
        if cfg.model not in models:
            print(f"    NOTE: Christine's model '{cfg.model}' is not in that list.")
    except Exception as exc:
        _show_error(exc)

    print(f"\n4. Simple message with Christine's model ({cfg.model})")
    try:
        resp = client.messages.create(model=cfg.model, max_tokens=50,
                                      messages=[{"role": "user", "content": "Say OK."}])
        print("    OK. Reply: " + " ".join(b.text for b in resp.content if b.type == "text"))
    except Exception as exc:
        _show_error(exc)

    print("\n5. Simple message with claude-haiku-5-5 (to compare)")
    try:
        resp = client.messages.create(model="claude-haiku-5-5", max_tokens=50,
                                      messages=[{"role": "user", "content": "Say OK."}])
        print("    OK. Reply: " + " ".join(b.text for b in resp.content if b.type == "text"))
    except Exception as exc:
        _show_error(exc)

    print("\nDone. Please send a screenshot of everything above.\n")
