// Christine's animated face: an original illustrated lecturer drawn in SVG.
// The mouth follows the real audio volume; expressions blend smoothly.
(function () {
  const NS = "http://www.w3.org/2000/svg";
  const EXPRESSIONS = {
    neutral:  { smile: 0.25, brow: 0,  browTilt: 0,  eyeOpen: 1,    lookX: 0,  lookY: 0,  tilt: 0 },
    speaking: { smile: 0.3,  brow: 1,  browTilt: 0,  eyeOpen: 1,    lookX: 0,  lookY: 0,  tilt: 0 },
    smile:    { smile: 0.95, brow: 2,  browTilt: 0,  eyeOpen: 0.85, lookX: 0,  lookY: 0,  tilt: 2 },
    thinking: { smile: 0.05, brow: 4,  browTilt: 5,  eyeOpen: 0.95, lookX: 6, lookY: -6, tilt: -3 },
    curious:  { smile: 0.4,  brow: 6,  browTilt: -3, eyeOpen: 1.05, lookX: -2, lookY: 0,  tilt: 4 },
  };

  function el(tag, attrs, parent) {
    const e = document.createElementNS(NS, tag);
    for (const k in attrs) e.setAttribute(k, attrs[k]);
    if (parent) parent.appendChild(e);
    return e;
  }

  function Avatar(container) {
    const svg = el("svg", { viewBox: "0 0 400 470", class: "avatar-svg", role: "img",
                            "aria-label": "Christine, the AI lecturer" }, container);
    const defs = el("defs", {}, svg);
    const skin = el("radialGradient", { id: "skin", cx: "45%", cy: "40%", r: "70%" }, defs);
    el("stop", { offset: "0%", "stop-color": "#b07a52" }, skin);
    el("stop", { offset: "100%", "stop-color": "#8a5a3b" }, skin);
    const glow = el("radialGradient", { id: "glow", cx: "50%", cy: "45%", r: "55%" }, defs);
    el("stop", { offset: "0%", style: "stop-color: var(--avatar-glow, #3d6fa8); stop-opacity: .55" }, glow);
    el("stop", { offset: "100%", style: "stop-color: var(--avatar-glow, #3d6fa8); stop-opacity: 0" }, glow);
    const mouthClip = el("clipPath", { id: "mouthClip" }, defs);
    const mouthClipPath = el("path", {}, mouthClip);

    el("circle", { cx: 200, cy: 250, r: 200, fill: "url(#glow)" }, svg);
    const body = el("g", {}, svg);
    // Shoulders: navy blazer, white blouse collar.
    el("path", { d: "M40 470 C50 395 110 370 160 362 L240 362 C290 370 350 395 360 470 Z", fill: "#1f3a5f" }, body);
    el("path", { d: "M160 362 L200 430 L240 362 Z", fill: "#f4f1ea" }, body);
    el("path", { d: "M160 362 L185 470 L200 430 Z M240 362 L215 470 L200 430 Z", fill: "#16304f" }, body);
    el("path", { d: "M176 360 L176 335 L224 335 L224 360 L200 392 Z", fill: "#7d5034" }, body); // neck
    el("circle", { cx: 200, cy: 402, r: 5, fill: "#d9b44a" }, body); // pendant

    const head = el("g", {}, svg);
    // Hair (back): a full rounded natural style.
    el("path", { d: "M92 250 C70 150 120 70 205 66 C292 64 338 140 314 252 C320 300 300 330 286 338 " +
                     "L118 338 C100 325 84 296 92 250 Z", fill: "#1d1411" }, head);
    // Ears and earrings.
    el("ellipse", { cx: 108, cy: 262, rx: 14, ry: 22, fill: "#8f5e3e" }, head);
    el("ellipse", { cx: 292, cy: 262, rx: 14, ry: 22, fill: "#8f5e3e" }, head);
    el("circle", { cx: 106, cy: 290, r: 5, fill: "#d9b44a" }, head);
    el("circle", { cx: 294, cy: 290, r: 5, fill: "#d9b44a" }, head);
    // Face.
    el("path", { d: "M112 230 C112 160 150 128 200 128 C250 128 288 160 288 230 C288 300 252 352 200 352 " +
                     "C148 352 112 300 112 230 Z", fill: "url(#skin)" }, head);
    // Hair (front): soft side-swept fringe.
    el("path", { d: "M108 214 C110 150 150 104 210 104 C262 106 296 140 294 206 C276 168 240 150 196 152 " +
                     "C160 154 132 172 108 214 Z", fill: "#241915" }, head);
    const cheekL = el("ellipse", { cx: 150, cy: 290, rx: 18, ry: 10, fill: "#c46a5a", opacity: 0 }, head);
    const cheekR = el("ellipse", { cx: 250, cy: 290, rx: 18, ry: 10, fill: "#c46a5a", opacity: 0 }, head);

    // Eyes.
    const eyes = [];
    for (const cx of [160, 240]) {
      const g = el("g", {}, head);
      el("ellipse", { cx, cy: 238, rx: 17, ry: 11, fill: "#fbf8f2" }, g);
      const iris = el("circle", { cx, cy: 238, r: 8, fill: "#3b2417" }, g);
      const pupil = el("circle", { cx, cy: 238, r: 3.6, fill: "#0d0806" }, g);
      const shine = el("circle", { cx: cx + 3, cy: 235, r: 1.8, fill: "#fff" }, g);
      const lid = el("path", { fill: "#94603f" }, g);
      el("path", { d: `M${cx - 18} 236 Q${cx} 222 ${cx + 18} 236`, fill: "none", stroke: "#1a110d",
                   "stroke-width": 2.6, "stroke-linecap": "round" }, g);
      eyes.push({ cx, iris, pupil, shine, lid });
    }
    // Glasses: thin academic frames.
    const glasses = el("g", { fill: "none", stroke: "#2b2b33", "stroke-width": 3 }, head);
    el("rect", { x: 133, y: 218, width: 54, height: 40, rx: 14 }, glasses);
    el("rect", { x: 213, y: 218, width: 54, height: 40, rx: 14 }, glasses);
    el("path", { d: "M187 236 Q200 229 213 236 M133 232 L114 228 M267 232 L286 228" }, glasses);
    // Brows.
    const browL = el("path", { fill: "none", stroke: "#1a110d", "stroke-width": 5, "stroke-linecap": "round" }, head);
    const browR = el("path", { fill: "none", stroke: "#1a110d", "stroke-width": 5, "stroke-linecap": "round" }, head);
    // Nose.
    el("path", { d: "M200 248 C196 270 190 284 194 290 C198 294 206 294 210 289", fill: "none",
                 stroke: "#6e452c", "stroke-width": 3, "stroke-linecap": "round" }, head);
    // Mouth: dark opening, teeth, tongue, lips.
    const mouthInner = el("path", { fill: "#4a1620" }, head);
    const teethGroup = el("g", { "clip-path": "url(#mouthClip)" }, head);
    const teeth = el("rect", { x: 160, width: 80, height: 9, rx: 3, fill: "#f6f3ee" }, teethGroup);
    const tongue = el("ellipse", { cx: 200, rx: 18, ry: 8, fill: "#a8434d" }, teethGroup);
    const lips = el("path", { fill: "none", stroke: "#7b3a3a", "stroke-width": 4, "stroke-linejoin": "round" }, head);

    const cur = Object.assign({}, EXPRESSIONS.neutral);
    let target = EXPRESSIONS.neutral, open = 0, openTarget = 0, blink = 0, nextBlink = performance.now() + 2500;
    let level = 0;

    function lerp(a, b, t) { return a + (b - a) * t; }

    function draw(now) {
      for (const k in cur) cur[k] = lerp(cur[k], target[k], 0.08);
      open = lerp(open, openTarget, 0.45);
      // Blink every few seconds.
      if (now > nextBlink) { blink = 1; nextBlink = now + 2500 + Math.random() * 3500; }
      blink = Math.max(0, blink - 0.12);
      const lidAmount = Math.min(1, (1 - Math.min(cur.eyeOpen, 1)) * 0.6 + (blink > 0.5 ? 1 : blink * 2));
      const sway = Math.sin(now / 1700) * 1.2;
      head.setAttribute("transform", `rotate(${cur.tilt + sway} 200 300)`);

      for (const e of eyes) {
        const x = e.cx + cur.lookX, y = 238 + cur.lookY;
        e.iris.setAttribute("cx", x); e.iris.setAttribute("cy", y);
        e.pupil.setAttribute("cx", x); e.pupil.setAttribute("cy", y);
        e.shine.setAttribute("cx", x + 3); e.shine.setAttribute("cy", y - 3);
        const lidY = 226 + lidAmount * 24;
        e.lid.setAttribute("d", `M${e.cx - 19} 224 L${e.cx + 19} 224 L${e.cx + 19} ${lidY} ` +
                                `Q${e.cx} ${lidY + 6 * lidAmount} ${e.cx - 19} ${lidY} Z`);
      }
      const by = 206 - cur.brow;
      browL.setAttribute("d", `M138 ${by + 4 + cur.browTilt} Q160 ${by - 6} 182 ${by + 2 - cur.browTilt}`);
      browR.setAttribute("d", `M218 ${by + 2 - cur.browTilt * -1} Q240 ${by - 6 - cur.browTilt} 262 ${by + 4}`);
      cheekL.setAttribute("opacity", Math.max(0, cur.smile - 0.4) * 0.5);
      cheekR.setAttribute("opacity", Math.max(0, cur.smile - 0.4) * 0.5);

      // Mouth shape from smile and openness.
      const w = 30 + cur.smile * 6 - open * 4, cy = 316, cornerY = cy - cur.smile * 7;
      const upper = cy - 4 - open * 5, lower = cy + 5 + cur.smile * 5 + open * 26;
      const L = 200 - w, R = 200 + w;
      const shape = `M${L} ${cornerY} C${200 - w * 0.5} ${upper} ${200 + w * 0.5} ${upper} ${R} ${cornerY} ` +
                    `C${200 + w * 0.5} ${lower} ${200 - w * 0.5} ${lower} ${L} ${cornerY} Z`;
      mouthInner.setAttribute("d", shape);
      mouthClipPath.setAttribute("d", shape);
      mouthInner.setAttribute("opacity", open > 0.04 ? 1 : 0);
      teethGroup.setAttribute("opacity", open > 0.1 ? 1 : 0);   // no teeth showing when the mouth is closed
      teeth.setAttribute("y", upper - 1);
      tongue.setAttribute("cy", lower - 4);
      tongue.setAttribute("opacity", open > 0.35 ? 1 : 0);
      lips.setAttribute("d", open > 0.04 ? shape :
        `M${L} ${cornerY} C${200 - w * 0.5} ${cy + 2 + cur.smile * 7} ${200 + w * 0.5} ${cy + 2 + cur.smile * 7} ${R} ${cornerY}`);
      requestAnimationFrame(draw);
    }
    requestAnimationFrame(draw);

    return {
      setExpression(name) { target = EXPRESSIONS[name] || EXPRESSIONS.neutral; },
      // level: 0..1 loudness of the voice right now
      setLevel(v) { level = v; openTarget = Math.min(1, Math.max(0, (v - 0.02) * 4.5)); },
      pulse() { openTarget = 0.55 + Math.random() * 0.3; setTimeout(() => { openTarget = 0.08; }, 140); },
      close() { openTarget = 0; },
    };
  }

  window.ChristineAvatar = Avatar;
})();
