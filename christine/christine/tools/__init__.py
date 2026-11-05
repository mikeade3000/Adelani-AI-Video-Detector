"""Tool registry. Each tool is a plain Python function Christine's brain can call."""
from __future__ import annotations

import json
import sys
import threading
import traceback
from dataclasses import dataclass, field
from typing import Any, Callable

IS_WINDOWS = sys.platform == "win32"


@dataclass
class ToolContext:
    """Everything a tool may need, passed in by the app."""
    config: Any
    memory: Any
    ask: Callable[[str], str]          # speak a question, return the user's answer
    say: Callable[[str], None]         # speak something right now
    speaker: Any = None                # audio.speaker.Speaker (for reading / singing)
    file_index: Any = None             # tools.files.FileIndex
    stop_event: threading.Event = field(default_factory=threading.Event)
    browser: Any = None                # tools.web.BrowserTracker


@dataclass
class Tool:
    name: str
    description: str
    properties: dict
    func: Callable[..., str]

    def schema(self) -> dict:
        return {
            "name": self.name,
            "description": self.description,
            "strict": True,
            "input_schema": {
                "type": "object",
                "properties": self.properties,
                "required": list(self.properties),
                "additionalProperties": False,
            },
        }


REGISTRY: dict[str, Tool] = {}


def tool(_tool_name: str, _tool_description: str, /, **properties: dict):
    """Register a function as a tool. Every listed property is required."""
    def wrap(func):
        REGISTRY[_tool_name] = Tool(_tool_name, _tool_description, properties, func)
        return func
    return wrap


def S(desc: str) -> dict:
    return {"type": "string", "description": desc}


def I(desc: str) -> dict:
    return {"type": "integer", "description": desc}


def B(desc: str) -> dict:
    return {"type": "boolean", "description": desc}


def run_tool(ctx: ToolContext, name: str, args: dict) -> tuple[str, bool]:
    """Run a tool. Returns (text result, is_error)."""
    t = REGISTRY.get(name)
    if not t:
        return f"Unknown tool {name}.", True
    if not isinstance(args, dict) or set(args) != set(t.properties):
        return f"Invalid arguments for {name}: expected {sorted(t.properties)}, got {args!r}.", True
    try:
        result = t.func(ctx, **args)
        if not isinstance(result, str):
            result = json.dumps(result, ensure_ascii=False, default=str)
        return result, False
    except Exception as exc:  # report to the model instead of crashing Christine
        traceback.print_exc()
        return f"Error while running {name}: {exc}", True


def load_all() -> dict[str, Tool]:
    # Importing the modules registers their tools.
    from . import apps, files, media, memory_tools, reader, recycle, system, web  # noqa: F401
    return REGISTRY
