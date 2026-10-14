(() => {
  "use strict";

  const token = new URLSearchParams(location.search).get("token");
  const rows = document.getElementById("rows");
  const autoRefresh = document.getElementById("autoRefresh");
  let lastData = [];
  let timer = null;

  const esc = (s) => String(s ?? "—").replace(/[&<>"']/g, (c) => ({
    "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;",
  }[c]));

  const q = encodeURIComponent(token || "");

  async function refresh() {
    try {
      const r = await fetch("/api/telemetry?token=" + q, { cache: "no-store" });
      if (!r.ok) throw new Error("Could not load records (HTTP " + r.status + ")");
      lastData = await r.json();
      document.getElementById("count").textContent = lastData.length;
      document.getElementById("sessions").textContent =
        new Set(lastData.map((x) => x.sessionId)).size;
      const last = lastData[lastData.length - 1];
      document.getElementById("latest").textContent =
        last ? (last.receivedAt || "—").slice(11, 19) : "—";

      if (!lastData.length) {
        rows.innerHTML = '<tr><td colspan="8">No records yet. Scan the QR code and start '
          + "the demo with consent.</td></tr>";
        return;
      }
      rows.innerHTML = lastData.slice().reverse().map((x) => {
        const scr = x.screen
          ? `${esc(x.screen.width)}×${esc(x.screen.height)} @${esc(x.screen.pixelRatio || 1)}x`
          : "—";
        const vp = x.viewport ? `${esc(x.viewport.width)}×${esc(x.viewport.height)}` : "—";
        return `<tr>
          <td>${esc(x.receivedAt)}</td>
          <td><code>${esc(x.sessionId)}</code></td>
          <td>${esc(x.event)}</td>
          <td><div>${esc(x.platform)}</div><div class="small muted">${esc(x.userAgent)}</div></td>
          <td>${scr}<div class="small muted">View: ${vp}</div></td>
          <td>${esc(x.language)}<div class="small muted">${esc(x.timezone)} · online: ${esc(x.online)}</div></td>
          <td>${x.battery == null ? "Not available" : esc(x.battery) + "%"}</td>
          <td>${esc(x.sourceIp)}</td>
        </tr>`;
      }).join("");
    } catch (e) {
      rows.innerHTML = `<tr><td colspan="8">${esc(e.message)}. Check the dashboard token in the URL.</td></tr>`;
    }
  }

  function startAuto() {
    stopAuto();
    if (autoRefresh.checked) timer = setInterval(refresh, 5000);
  }
  function stopAuto() {
    if (timer) { clearInterval(timer); timer = null; }
  }

  document.getElementById("refresh").addEventListener("click", refresh);
  autoRefresh.addEventListener("change", startAuto);

  document.getElementById("export").addEventListener("click", () => {
    const blob = new Blob([JSON.stringify(lastData, null, 2)], { type: "application/json" });
    const a = document.createElement("a");
    a.href = URL.createObjectURL(blob);
    a.download = "mobile-telemetry-export.json";
    a.click();
    URL.revokeObjectURL(a.href);
  });

  document.getElementById("purge").addEventListener("click", async () => {
    if (!confirm("Erase all collected telemetry? This cannot be undone.")) return;
    try {
      const r = await fetch("/api/purge?token=" + q, { method: "POST", cache: "no-store" });
      if (!r.ok) throw new Error("HTTP " + r.status);
      await refresh();
    } catch (e) {
      alert("Could not erase data: " + e.message);
    }
  });

  refresh();
  startAuto();
})();
