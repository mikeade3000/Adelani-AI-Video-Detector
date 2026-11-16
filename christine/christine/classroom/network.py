"""Find the laptop's address for students, and control the Windows Mobile Hotspot."""
from __future__ import annotations

import socket
import subprocess
import sys

import psutil

HOTSPOT_IP_PREFIX = "192.168.137."   # Windows Mobile Hotspot always uses this network

_PS_PRELUDE = r"""
$ErrorActionPreference = 'Stop'
Add-Type -AssemblyName System.Runtime.WindowsRuntime
$asTask = ([System.WindowsRuntimeSystemExtensions].GetMethods() | Where-Object {
  $_.Name -eq 'AsTask' -and $_.GetParameters().Count -eq 1 -and
  $_.GetParameters()[0].ParameterType.Name -eq 'IAsyncOperation`1' })[0]
function Await($op, $type) { $t = $asTask.MakeGenericMethod($type).Invoke($null, @($op)); $t.Wait(-1) | Out-Null; $t.Result }
$profile = [Windows.Networking.Connectivity.NetworkInformation,Windows.Networking.Connectivity,ContentType=WindowsRuntime]::GetInternetConnectionProfile()
if ($profile -eq $null) { Write-Output 'ERROR:no-internet'; exit }
$tm = [Windows.Networking.NetworkOperators.NetworkOperatorTetheringManager,Windows.Networking.NetworkOperators,ContentType=WindowsRuntime]::CreateFromConnectionProfile($profile)
$cfg = $tm.GetCurrentAccessPointConfiguration()
"""


def local_addresses() -> list[str]:
    """IPv4 addresses students could reach, hotspot first."""
    addrs = []
    for name, entries in psutil.net_if_addrs().items():
        for e in entries:
            if e.family == socket.AF_INET and not e.address.startswith(("127.", "169.254.")):
                addrs.append(e.address)
    addrs.sort(key=lambda a: (not a.startswith(HOTSPOT_IP_PREFIX), not a.startswith("192.168."), a))
    return addrs


def best_address() -> str:
    addrs = local_addresses()
    if addrs:
        return addrs[0]
    try:  # fall back to the address used for the internet
        with socket.socket(socket.AF_INET, socket.SOCK_DGRAM) as s:
            s.connect(("8.8.8.8", 80))
            return s.getsockname()[0]
    except OSError:
        return "127.0.0.1"


def _powershell(script: str, timeout: int = 40) -> str:
    out = subprocess.run(["powershell", "-NoProfile", "-ExecutionPolicy", "Bypass", "-Command", script],
                         capture_output=True, text=True, timeout=timeout,
                         creationflags=getattr(subprocess, "CREATE_NO_WINDOW", 0))
    return (out.stdout + out.stderr).strip()


def hotspot_status() -> dict:
    if sys.platform != "win32":
        return {"supported": False, "message": "The hotspot is only available on Windows."}
    try:
        out = _powershell(_PS_PRELUDE + r"""
Write-Output ("STATE:" + $tm.TetheringOperationalState)
Write-Output ("SSID:" + $cfg.Ssid)
Write-Output ("PASS:" + $cfg.Passphrase)
Write-Output ("CLIENTS:" + $tm.ClientCount + "/" + $tm.MaxClientCount)
""")
    except Exception as exc:
        return {"supported": False, "message": f"Couldn't check the hotspot: {exc}"}
    return _parse(out)


def start_hotspot() -> dict:
    if sys.platform != "win32":
        return {"supported": False, "message": "The hotspot is only available on Windows."}
    try:
        out = _powershell(_PS_PRELUDE + r"""
if ($tm.TetheringOperationalState -ne 1) {
  $r = Await ($tm.StartTetheringAsync()) ([Windows.Networking.NetworkOperators.NetworkOperatorTetheringOperationResult])
  Write-Output ("RESULT:" + $r.Status + " " + $r.AdditionalErrorMessage)
}
Write-Output ("STATE:" + $tm.TetheringOperationalState)
Write-Output ("SSID:" + $cfg.Ssid)
Write-Output ("PASS:" + $cfg.Passphrase)
Write-Output ("CLIENTS:" + $tm.ClientCount + "/" + $tm.MaxClientCount)
""", timeout=60)
    except Exception as exc:
        return {"supported": False, "message": f"Couldn't start the hotspot: {exc}"}
    return _parse(out)


def _parse(out: str) -> dict:
    info: dict = {"supported": True, "raw": out[-500:]}
    for line in out.splitlines():
        if ":" in line:
            k, v = line.split(":", 1)
            info[k.strip().lower()] = v.strip()
    if info.get("error") == "no-internet":
        return {"supported": False, "message": "The laptop needs an internet connection (Wi-Fi, cable or a phone "
                                               "via USB) to share as a hotspot. Christine also needs it to think."}
    info["on"] = info.get("state", "").lower() in ("on", "1")
    if not info["on"]:
        info["message"] = ("The hotspot didn't turn on. Open Windows Settings > Network & Internet > Mobile "
                           "hotspot and switch it on there. " + info.get("result", ""))
    return info


def wifi_qr_payload(ssid: str, password: str) -> str:
    def esc(s):
        return "".join("\\" + c if c in '\\;,:"' else c for c in s)
    return f"WIFI:T:WPA;S:{esc(ssid)};P:{esc(password)};;"


def qr_svg(data: str) -> str:
    import io

    import qrcode
    import qrcode.image.svg

    img = qrcode.make(data, image_factory=qrcode.image.svg.SvgPathImage, box_size=10, border=2)
    buf = io.BytesIO()
    img.save(buf)
    return buf.getvalue().decode("utf-8")
