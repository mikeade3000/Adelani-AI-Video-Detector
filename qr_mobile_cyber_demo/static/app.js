(() => {
  "use strict";

  const params = new URLSearchParams(location.search);
  const token = params.get("token");

  const consentPanel = document.getElementById("consentPanel");
  const agree = document.getElementById("agree");
  const startBtn = document.getElementById("startBtn");
  const status = document.getElementById("status");
  const lockScreen = document.getElementById("lockScreen");
  const exitBtn = document.getElementById("exitBtn");
  const debriefPanel = document.getElementById("debriefPanel");
  const restartBtn = document.getElementById("restartBtn");

  const sessionId = (window.crypto && crypto.randomUUID)
    ? crypto.randomUUID()
    : "sess-" + Date.now().toString(36) + "-" + Math.random().toString(36).slice(2, 9);

  // Safety: the simulation always ends on its own after this long, so no one
  // can ever be stuck on the lock screen.
  const AUTO_EXIT_MS = 120000;
  let autoExitTimer = null;

  // Hidden "realistic" recovery gesture kept for teaching, in addition to the
  // always-visible exit button: five taps in the top-right corner within 4s.
  let taps = 0;
  let tapTimer = null;

  if (!token) {
    status.textContent = "Missing demo token. Please scan the QR code supplied by the instructor.";
    startBtn.disabled = true;
  }

  agree.addEventListener("change", () => {
    startBtn.disabled = !agree.checked || !token;
  });

  async function getBatteryPercent() {
    try {
      if (navigator.getBattery) {
        const b = await navigator.getBattery();
        return Math.round(b.level * 100);
      }
    } catch (_) { /* battery API blocked or unsupported */ }
    return null;
  }

  async function sendTelemetry(eventName) {
    const payload = {
      sessionId,
      consent: true,
      consentAt: new Date().toISOString(),
      userAgent: navigator.userAgent,
      platform: (navigator.userAgentData && navigator.userAgentData.platform)
        || navigator.platform || "not reported",
      language: navigator.language || "not reported",
      timezone: (Intl.DateTimeFormat().resolvedOptions().timeZone) || "not reported",
      screen: {
        width: screen.width,
        height: screen.height,
        pixelRatio: window.devicePixelRatio || 1,
      },
      viewport: { width: window.innerWidth, height: window.innerHeight },
      online: navigator.onLine,
      battery: await getBatteryPercent(),
      startedAt: new Date().toISOString(),
      event: eventName,
      pageVisibility: document.visibilityState,
    };
    const response = await fetch("/api/telemetry?token=" + encodeURIComponent(token), {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(payload),
      cache: "no-store",
    });
    if (!response.ok) {
      throw new Error("Telemetry endpoint returned " + response.status);
    }
  }

  function enterSimulation() {
    consentPanel.hidden = true;
    debriefPanel.hidden = true;
    lockScreen.hidden = false;
    document.body.classList.add("simulation");
    exitBtn.focus();
    clearTimeout(autoExitTimer);
    autoExitTimer = setTimeout(() => endSimulation(), AUTO_EXIT_MS);
    // Fullscreen makes the illusion stronger but is optional; failure is fine.
    if (document.documentElement.requestFullscreen) {
      document.documentElement.requestFullscreen().catch(() => {});
    }
  }

  function endSimulation() {
    clearTimeout(autoExitTimer);
    taps = 0;
    try {
      if (document.fullscreenElement && document.exitFullscreen) {
        document.exitFullscreen().catch(() => {});
      }
    } catch (_) { /* ignore */ }
    document.body.classList.remove("simulation");
    lockScreen.hidden = true;
    consentPanel.hidden = true;
    debriefPanel.hidden = false;
    agree.checked = false;
    startBtn.disabled = true;
    status.textContent = "";
    sendTelemetry("simulation_ended").catch(() => {});
  }

  function backToStart() {
    debriefPanel.hidden = true;
    consentPanel.hidden = false;
    status.textContent = "";
  }

  startBtn.addEventListener("click", async () => {
    if (!agree.checked || !token) return;
    startBtn.disabled = true;
    status.textContent = "Starting the simulation…";
    try {
      await sendTelemetry("simulation_started");
      enterSimulation();
    } catch (err) {
      status.textContent = "Could not reach the lab dashboard. Check that the phone and "
        + "computer are on the same Wi-Fi, then retry.";
      startBtn.disabled = false;
    }
  });

  exitBtn.addEventListener("click", endSimulation);
  restartBtn.addEventListener("click", backToStart);

  // Esc always exits the simulation.
  document.addEventListener("keydown", (e) => {
    if (!lockScreen.hidden && (e.key === "Escape" || e.key === "Esc")) {
      endSimulation();
    }
  });

  // Hidden corner-tap recovery gesture (teaching aid for "it looks trapped").
  document.addEventListener("pointerdown", (event) => {
    if (lockScreen.hidden) return;
    if (event.clientX > window.innerWidth * 0.78 && event.clientY < window.innerHeight * 0.18) {
      taps += 1;
      clearTimeout(tapTimer);
      tapTimer = setTimeout(() => { taps = 0; }, 4000);
      if (taps >= 5) endSimulation();
    }
  });

  window.addEventListener("online", () => {
    if (!lockScreen.hidden) sendTelemetry("network_online").catch(() => {});
  });
  window.addEventListener("offline", () => {
    if (!lockScreen.hidden) sendTelemetry("network_offline").catch(() => {});
  });
})();
