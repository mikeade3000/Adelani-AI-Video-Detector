"""Background watcher that lets Christine speak up on her own (low battery, charger)."""
from __future__ import annotations

import queue
import threading
import time

from .tools.system import battery_info


class BatteryMonitor:
    def __init__(self, warn_at: list[int], announce: "queue.Queue[str]", interval: float = 60.0):
        self.warn_at = sorted(warn_at, reverse=True)
        self.announce = announce
        self.interval = interval
        self._warned: set[int] = set()
        self._last_plugged: bool | None = None

    def check(self, info: dict | None = None) -> list[str]:
        info = info if info is not None else battery_info()
        if not info.get("present"):
            return []
        msgs = []
        pct, plugged = info["percent"], info["plugged_in"]
        if self._last_plugged is not None and plugged != self._last_plugged:
            msgs.append("Charger connected. Thanks!" if plugged else f"Charger unplugged. Battery is at {pct} percent.")
        self._last_plugged = plugged
        if plugged:
            self._warned.clear()
            return msgs
        for level in self.warn_at:
            if pct <= level and level not in self._warned:
                self._warned.update(l for l in self.warn_at if l >= level)
                if level <= 5:
                    msgs.append(f"Battery critical: {pct} percent! Please plug in now or save your work.")
                elif level <= 10:
                    msgs.append(f"Your battery is very low, at {pct} percent. Please plug in your charger.")
                else:
                    msgs.append(f"Heads up, your battery is at {pct} percent. You might want to plug in soon.")
                break
        return msgs

    def start(self) -> None:
        def loop():
            while True:
                try:
                    for m in self.check():
                        self.announce.put(m)
                except Exception as exc:
                    print(f"[Christine] battery check failed: {exc}")
                time.sleep(self.interval)
        threading.Thread(target=loop, daemon=True, name="battery-monitor").start()
