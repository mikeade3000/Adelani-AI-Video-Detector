/* KIU CBT — page lock: no right-click menu, no developer tools, no "view source" / "save page".
 * Loaded first on every page. Turn it off for maintenance with PROTECT: false in config.js.
 * This is a deterrent in the browser; answers, timing and access are enforced by the server. */
(function (w, d) {
  'use strict';
  function on() { var c = w.KIU_CONFIG; return !(c && c.PROTECT === false); }
  function editable(t) { return t && (/^(INPUT|TEXTAREA|SELECT)$/.test(t.tagName) || t.isContentEditable); }
  var listeners = [];
  var KIUProtect = w.KIUProtect = {
    open: false,
    onDetect: function (fn) { listeners.push(fn); }   // fn(true) when developer tools open, fn(false) when closed
  };

  // 1. right-click / long-press menu
  d.addEventListener('contextmenu', function (e) { if (on()) e.preventDefault(); }, true);

  // 2. keyboard shortcuts for developer tools, view source and save page
  function code(e) { return e.code ? e.code.replace(/^Key/, '') : String(e.key || '').toUpperCase(); }
  function blocked(e) {
    var k = code(e), ctrl = e.ctrlKey || e.metaKey;
    if (k === 'F12') return true;                                                            // developer tools
    if (e.ctrlKey && e.shiftKey && 'IJCKEM'.indexOf(k) >= 0 && k.length === 1) return true;  // Windows / Linux tools, console, inspector
    if (e.metaKey && e.altKey && 'IJCKUE'.indexOf(k) >= 0 && k.length === 1) return true;    // Mac tools, console, inspector, source
    if (ctrl && !e.shiftKey && !e.altKey && (k === 'U' || k === 'S')) return true;            // view source, save page
    return false;
  }
  function key(e) { if (on() && blocked(e)) { e.preventDefault(); e.stopPropagation(); return false; } }
  w.addEventListener('keydown', key, true);
  w.addEventListener('keyup', function (e) { if (on() && blocked(e)) e.preventDefault(); }, true);

  // 3. dragging page images or text out of the page (still allowed inside answer boxes)
  d.addEventListener('dragstart', function (e) { if (on() && !editable(e.target)) e.preventDefault(); }, true);

  // 4. developer tools opened anyway (from the browser menu, or a detached window):
  //    a "debugger" statement is skipped when the tools are closed, but stops the page while they are open.
  //    A stop of more than a moment means the tools are open: the page is covered until they are closed.
  var cover = null;
  function showCover(v) {
    if (!d.body) return;
    if (!cover) {
      cover = d.createElement('div'); cover.id = 'kiu-protect-cover';
      cover.setAttribute('role', 'alertdialog');
      cover.style.cssText = 'position:fixed;inset:0;z-index:2147483647;background:#034a27;color:#fff;display:none;' +
        'align-items:center;justify-content:center;text-align:center;padding:24px;font:20px/1.5 "Times New Roman",serif';
      cover.innerHTML = '<div style="max-width:560px"><div style="font-size:30px;font-weight:bold;margin-bottom:12px">Developer tools are not allowed</div>' +
        'Close the developer tools window or panel to continue. This has been recorded.</div>';
      d.body.appendChild(cover);
    }
    cover.style.display = v ? 'flex' : 'none';
  }
  function set(open) {
    if (open === KIUProtect.open) return;
    KIUProtect.open = open; showCover(open);
    listeners.forEach(function (fn) { try { fn(open); } catch (e) {} });
  }
  function probe() {
    if (!on()) { set(false); return; }
    var t = Date.now();
    debugger;                                                  // eslint-disable-line no-debugger
    set(Date.now() - t > 150);
  }
  setInterval(probe, 1000);
})(window, document);
