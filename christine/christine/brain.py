"""Christine's brain: Claude with tools, plus an offline fallback."""
from __future__ import annotations

import json
import random
import urllib.request

import anthropic

from .persona import PERSONA, SUMMARY_PROMPT
from .tools import REGISTRY, ToolContext, run_tool

MAX_TOOL_ROUNDS = 15
FALLBACK_MODELS = {"claude-opus-5-5", "claude-opus-5", "claude-fable-5-1", "claude-sonnet-5-5"}

OFFLINE_JOKES = [
    "Why did the computer go to the doctor? Because it had a virus. Don't worry, I checked, you're fine.",
    "I told my laptop a joke about UDP. I'm not sure it got it.",
    "Why was the computer cold? It left its Windows open.",
    "What do you call a computer that sings? A Dell.",
    "Why did the PowerPoint presentation cross the road? To get to the other slide.",
    "I would tell you a joke about the cloud, but I'm offline right now, so it's over your head anyway.",
    "Why don't keyboards ever sleep? Because they have two shifts.",
]


class Brain:
    def __init__(self, config, ctx: ToolContext):
        self.config = config
        self.ctx = ctx
        self.client = anthropic.Anthropic(max_retries=2, timeout=90.0) if config.has_api_key else None
        self.messages: list = []
        self.pending_notes: list[str] = []
        self.turns = 0
        self.use_fallbacks = config.model in FALLBACK_MODELS
        self.disabled: set[str] = set()   # optional features this account rejected
        self.tools = [t.schema() for t in REGISTRY.values()]
        # Frozen for the whole session so the prompt cache keeps working.
        self.system = [{"type": "text", "text": PERSONA.format(memory=ctx.memory.profile_text()),
                        "cache_control": {"type": "ephemeral"}}]

    # ------------------------------------------------------------------ api
    @property
    def online(self) -> bool:
        return self.client is not None

    def note(self, text: str) -> None:
        """Tell the model about something that happened without it (e.g. a local command)."""
        self.pending_notes.append(text)

    def chat(self, user_text: str) -> str:
        if self.client is None:
            return self._offline(user_text)
        content = user_text
        if self.pending_notes:
            content = "[Context: " + " ".join(self.pending_notes) + "]\n\n" + user_text
            self.pending_notes = []
        if self.messages and self.messages[-1]["role"] == "user":
            # A previous turn was cut off after tool results; add to that message
            # instead of sending two user messages in a row.
            last = self.messages[-1]
            if isinstance(last["content"], str):
                last["content"] = [{"type": "text", "text": last["content"]}]
            last["content"].append({"type": "text", "text": content})
        else:
            self.messages.append({"role": "user", "content": content})
        self.turns += 1
        try:
            return self._run_loop()
        except anthropic.AuthenticationError:
            self.client = None
            return ("My cloud brain rejected the API key. Please check the key in the Christine settings. "
                    "Until then I can still do simple things like the battery, time and websites.")
        except anthropic.RateLimitError:
            self._drop_dangling_user_turn()
            return "I'm being rate limited by the cloud right now. Give me a few seconds and ask again."
        except anthropic.APIConnectionError:
            self._drop_dangling_user_turn()
            return self._offline(user_text, prefix="I can't reach the internet right now. ")
        except anthropic.APIStatusError as exc:
            self._drop_dangling_user_turn()
            detail = error_detail(exc)
            log_error(self.config, exc, detail)
            print(f"[Christine] API error {exc.status_code}: {detail}")
            if is_billing_problem(detail) or exc.status_code == 402:
                return ("My cloud brain says your Anthropic account has no credit left. Please add credit "
                        "in the Anthropic Console under Billing, then talk to me again. Until then I can still "
                        "do the time, battery and websites.")
            if exc.status_code == 404:
                return (f"My cloud brain can't use the model {self.config.model} on your account. You can "
                        "pick another model in my settings file. The exact reason is in the window.")
            if exc.status_code == 403:
                return "Your Anthropic account isn't allowed to do that. The exact reason is in the window."
            return "Something went wrong in my cloud brain. The exact reason is written in the window."

    def summarise_session(self) -> str | None:
        if self.client is None or self.turns < 2:
            return None
        try:
            self.messages.append({"role": "user", "content": SUMMARY_PROMPT})
            resp = self._create()
            self.messages.append({"role": "assistant", "content": resp.content})
            text = _text_of(resp)
            if text:
                self.ctx.memory.add_summary(text)
            return text
        except anthropic.APIError as exc:
            print(f"[Christine] couldn't save a conversation summary: {exc}")
            return None

    # ------------------------------------------------------------- internals
    def _create(self):
        while True:
            try:
                return self._send()
            except anthropic.BadRequestError as exc:
                detail = error_detail(exc)
                log_error(self.config, exc, detail)
                if is_billing_problem(detail):
                    raise
                # Some accounts aren't enabled for optional features. Switch the next
                # one off and try again, so Christine still works without it.
                feature = next((f for f in OPTIONAL_FEATURES if f not in self.disabled), None)
                if feature is None:
                    raise
                self.disabled.add(feature)
                print(f"[Christine] Claude rejected the request ({detail}); retrying without '{feature}'.")

    def _send(self):
        betas, extra = [], {}
        if self.use_fallbacks and "fallbacks" not in self.disabled:
            betas.append("server-side-fallback-2026-07-01")
            extra["fallbacks"] = "default"
        if "compaction" not in self.disabled:
            betas.append("compact-2026-01-12")
            extra["context_management"] = {"edits": [{"type": "compact_20260112"}]}
        tools = self.tools
        if "strict_tools" in self.disabled:
            tools = [{k: v for k, v in t.items() if k != "strict"} for t in tools]
        system = self.system
        if "prompt_caching" in self.disabled:
            system = [{"type": "text", "text": self.system[0]["text"]}]
        if "effort" not in self.disabled:
            extra["output_config"] = {"effort": self.config.effort}
        if betas:
            extra["betas"] = betas
        api = self.client.beta.messages if betas else self.client.messages
        return api.create(
            model=self.config.model,
            max_tokens=16000,
            system=system,
            tools=tools,
            messages=self.messages,
            **extra,
        )

    def _run_loop(self) -> str:
        spoken: list[str] = []
        for _ in range(MAX_TOOL_ROUNDS):
            resp = self._create()
            # Append the full content (keeps thinking and compaction blocks intact).
            self.messages.append({"role": "assistant", "content": resp.content})

            if resp.stop_reason == "refusal":
                return "Sorry, that's something I can't help with."
            if resp.stop_reason == "pause_turn":
                continue
            tool_uses = [b for b in resp.content if b.type == "tool_use"]
            text = _text_of(resp)
            if resp.stop_reason != "tool_use" or not tool_uses:
                spoken.append(text)
                return " ".join(s for s in spoken if s).strip() or "Done."
            if text:
                # Say "let me check..." style lines straight away, while tools run.
                self.ctx.say(text)

            results = []
            for block in tool_uses:
                print(f"[Christine] tool: {block.name} {json.dumps(block.input, ensure_ascii=False)[:200]}")
                out, is_error = run_tool(self.ctx, block.name, block.input)
                results.append({"type": "tool_result", "tool_use_id": block.id, "content": out,
                                "is_error": is_error})
            self.messages.append({"role": "user", "content": results})
        return "That took more steps than I expected, so I stopped. Want me to try a different way?"

    def _drop_dangling_user_turn(self) -> None:
        # Keep the history valid: remove the user message that never got an answer.
        if self.messages and self.messages[-1]["role"] == "user":
            last = self.messages[-1]["content"]
            if isinstance(last, str):
                self.messages.pop()
                self.turns -= 1

    def _offline(self, user_text: str, prefix: str = "") -> str:
        low = user_text.lower()
        if self.config.ollama_model:
            try:
                return prefix + _ollama_chat(self.config.ollama_model, user_text)
            except Exception as exc:
                print(f"[Christine] Ollama not available: {exc}")
        if any(w in low for w in ("joke", "funny", "laugh", "bored")):
            return prefix + random.choice(OFFLINE_JOKES)
        return prefix + ("Without my cloud brain I can do the basics: battery, time, opening and closing "
                         "websites, and jokes. Ask me again when we're back online for anything else.")


OPTIONAL_FEATURES = ["fallbacks", "compaction", "strict_tools", "effort", "prompt_caching"]


def error_detail(exc) -> str:
    """The human-readable reason the API gave for an error."""
    body = getattr(exc, "body", None)
    if isinstance(body, dict):
        err = body.get("error", body)
        if isinstance(err, dict) and err.get("message"):
            return str(err["message"])
    response = getattr(exc, "response", None)
    if response is not None:
        try:
            text = response.text.strip()
            if text:
                return text[:500]
        except Exception:
            pass
        if "request-id" not in response.headers:
            server = response.headers.get("server", "unknown")
            return (f"empty reply with no Anthropic request id (server: {server}); something on this "
                    "computer or network may be blocking the connection. Run 'Christine connection check'.")
    return getattr(exc, "message", None) or str(exc)


def is_billing_problem(detail: str) -> bool:
    d = detail.lower()
    return "credit balance" in d or "billing" in d or "purchase credits" in d


def log_error(config, exc, detail: str) -> None:
    try:
        from datetime import datetime
        with open(config.data_dir / "christine.log", "a", encoding="utf-8") as f:
            f.write(f"{datetime.now().isoformat(timespec='seconds')} API {getattr(exc, 'status_code', '?')} "
                    f"request_id={getattr(exc, 'request_id', None)} model={config.model}: {detail}\n")
    except OSError:
        pass


def _text_of(resp) -> str:
    return " ".join(b.text for b in resp.content if b.type == "text").strip()


def _ollama_chat(model: str, text: str) -> str:
    body = json.dumps({
        "model": model, "stream": False,
        "messages": [
            {"role": "system", "content": "You are Christine, a witty, warm voice assistant. Reply in 1-3 short spoken sentences, no markdown."},
            {"role": "user", "content": text},
        ],
    }).encode()
    req = urllib.request.Request("http://localhost:11434/api/chat", data=body,
                                 headers={"Content-Type": "application/json"})
    with urllib.request.urlopen(req, timeout=60) as r:
        return json.loads(r.read())["message"]["content"].strip()
