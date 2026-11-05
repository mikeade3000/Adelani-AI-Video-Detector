"""Tools that let Christine remember and forget things about the user."""
from __future__ import annotations

from ..safety import double_confirm
from . import I, S, tool


@tool("remember",
      "Save a fact about the user for future conversations, e.g. their name, preferences, where they keep "
      "important files, people in their life, things they asked you to remember. Write it as a short "
      "standalone sentence.",
      fact=S("the fact, e.g. 'The user keeps their tax documents in D:\\\\Finance'"),
      category=S("one word: personal, preference, files, people, work, reminder or general"))
def remember(ctx, fact: str, category: str) -> str:
    fid = ctx.memory.remember(fact, category)
    return f"Saved to memory as #{fid}."


@tool("recall",
      "Search your saved memories about the user. Use an empty query to list recent memories.",
      query=S("what to look for, or empty"))
def recall(ctx, query: str) -> dict:
    return {"memories": ctx.memory.recall(query)}


@tool("forget",
      "Delete one saved memory by its id (from recall). The app asks the user twice to confirm.",
      memory_id=I("id of the memory to delete"))
def forget(ctx, memory_id: int) -> str:
    fact = ctx.memory.get_fact(memory_id)
    if not fact:
        return f"There's no memory #{memory_id}."
    ok, why = double_confirm(ctx.ask, f"the memory: {fact['text']}", action_word="delete")
    if not ok:
        return f"Kept the memory. {why}"
    ctx.memory.forget(memory_id)
    return f"Deleted memory #{memory_id}. {why}"
