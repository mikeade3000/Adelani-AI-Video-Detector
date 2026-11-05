"""System information: battery, CPU, memory, disks, hardware, running programs."""
from __future__ import annotations

import json
import platform
import subprocess
import time
from datetime import datetime

import psutil

from . import IS_WINDOWS, S, tool


def battery_info() -> dict:
    b = psutil.sensors_battery()
    if b is None:
        return {"present": False}
    secs = b.secsleft
    if secs in (psutil.POWER_TIME_UNLIMITED, psutil.POWER_TIME_UNKNOWN) or secs is None or secs < 0:
        left = None
    else:
        left = f"{secs // 3600}h {(secs % 3600) // 60}m"
    return {"present": True, "percent": round(b.percent), "plugged_in": bool(b.power_plugged), "time_left": left}


def battery_sentence() -> str:
    b = battery_info()
    if not b["present"]:
        return "This computer doesn't report a battery, so it's probably a desktop running on mains power."
    s = f"Your battery is at {b['percent']} percent"
    if b["plugged_in"]:
        s += " and it's charging."
    else:
        s += " and running on battery"
        s += f", with about {b['time_left']} left." if b["time_left"] else "."
    return s


def _powershell_json(command: str) -> list | dict | None:
    if not IS_WINDOWS:
        return None
    try:
        out = subprocess.run(
            ["powershell", "-NoProfile", "-Command", command + " | ConvertTo-Json -Compress"],
            capture_output=True, text=True, timeout=20,
            creationflags=getattr(subprocess, "CREATE_NO_WINDOW", 0),
        ).stdout.strip()
        return json.loads(out) if out else None
    except Exception:
        return None


def hardware_info() -> dict:
    info: dict = {
        "os": f"{platform.system()} {platform.release()} ({platform.version()})",
        "machine": platform.node(),
        "processor": platform.processor(),
        "cpu_cores": psutil.cpu_count(logical=False),
        "cpu_threads": psutil.cpu_count(),
        "ram_gb": round(psutil.virtual_memory().total / 1e9, 1),
    }
    if IS_WINDOWS:
        cpu = _powershell_json("Get-CimInstance Win32_Processor | Select-Object -First 1 Name")
        if isinstance(cpu, dict):
            info["processor"] = cpu.get("Name", info["processor"])
        gpu = _powershell_json("Get-CimInstance Win32_VideoController | Select-Object Name, DriverVersion")
        if gpu:
            info["graphics"] = [g.get("Name") for g in (gpu if isinstance(gpu, list) else [gpu])]
        cs = _powershell_json("Get-CimInstance Win32_ComputerSystem | Select-Object Manufacturer, Model")
        if isinstance(cs, dict):
            info["maker"] = f"{cs.get('Manufacturer', '')} {cs.get('Model', '')}".strip()
    return info


@tool("get_system_status",
      "Check the computer right now: battery, CPU load, memory use, disk space, uptime, network, "
      "and the programs using the most memory. Use for 'how is my system', 'check my laptop', "
      "'is my battery low', 'how much space do I have'.",
      )
def get_system_status(ctx) -> dict:
    vm = psutil.virtual_memory()
    disks = []
    for part in psutil.disk_partitions(all=False):
        if IS_WINDOWS and "cdrom" in part.opts:
            continue
        try:
            u = psutil.disk_usage(part.mountpoint)
        except (PermissionError, OSError):
            continue
        disks.append({"drive": part.mountpoint, "free_gb": round(u.free / 1e9, 1),
                      "total_gb": round(u.total / 1e9, 1), "used_percent": u.percent})
    procs = []
    for p in psutil.process_iter(["name", "memory_info"]):
        try:
            procs.append((p.info["memory_info"].rss, p.info["name"]))
        except (psutil.Error, AttributeError, TypeError):
            continue
    procs.sort(reverse=True)
    uptime_h = (time.time() - psutil.boot_time()) / 3600
    net = psutil.net_if_stats()
    return {
        "time": datetime.now().strftime("%A %d %B %Y, %I:%M %p"),
        "battery": battery_info(),
        "cpu_percent": psutil.cpu_percent(interval=0.5),
        "memory_used_percent": vm.percent,
        "memory_free_gb": round(vm.available / 1e9, 1),
        "disks": disks,
        "uptime_hours": round(uptime_h, 1),
        "network_up": [name for name, s in net.items() if s.isup and "loopback" not in name.lower()],
        "top_memory_programs": [n for _, n in procs[:6]],
    }


@tool("get_hardware_info",
      "Describe the computer's components: operating system, processor, cores, RAM, graphics card, "
      "maker and model. Use for 'what's inside my computer', 'what processor do I have'.")
def get_hardware_info(ctx) -> dict:
    return hardware_info()


@tool("get_battery", "Get the battery percentage, whether it's charging, and time left.")
def get_battery(ctx) -> str:
    return battery_sentence()


@tool("lock_computer", "Lock the Windows screen (like pressing Windows+L).")
def lock_computer(ctx) -> str:
    if not IS_WINDOWS:
        return "Locking is only supported on Windows."
    import ctypes
    ctypes.windll.user32.LockWorkStation()
    return "Screen locked."


@tool("set_volume",
      "Change the speaker volume. action is one of: up, down, mute.",
      action=S("up, down or mute"))
def set_volume(ctx, action: str) -> str:
    if not IS_WINDOWS:
        return "Volume control is only supported on Windows."
    import ctypes
    keys = {"up": 0xAF, "down": 0xAE, "mute": 0xAD}
    vk = keys.get(action.lower().strip())
    if vk is None:
        return "Action must be up, down or mute."
    for _ in range(5 if action != "mute" else 1):  # each press is about 2%
        ctypes.windll.user32.keybd_event(vk, 0, 0, 0)
        ctypes.windll.user32.keybd_event(vk, 0, 2, 0)
    return f"Volume {action}."
