/*
 * © 2026 Michael Adelani Adewusi · Adelani Super Intelligent Agents. All rights reserved.
 * No part or section of this application may be copied, reproduced or redistributed
 * without written permission.
 *
 * Copy deterrents: blocks the usual developer-tools and view-source shortcuts, the
 * context menu, and copying or dragging page content. Typing, editing and pasting in
 * the app's own text boxes still work, as do its Copy buttons and printing of results.
 * (A web page cannot fully stop a determined visitor, but this stops casual copying.)
 */
(function () {
  'use strict';

  var NOTICE = '© 2026 Michael Adelani Adewusi · Adelani Super Intelligent Agents. No part or section of this application may be copied.';

  function editable(el) {
    if (!el || el.nodeType !== 1) el = el && el.parentElement;
    return !!(el && el.closest && el.closest('input, textarea, select, [contenteditable="true"]'));
  }

  var last = 0;
  function warn() {
    var now = Date.now();
    if (now - last < 2500) return;
    last = now;
    var t = document.getElementById('toast');
    if (!t) return;
    t.textContent = NOTICE;
    t.classList.remove('hidden');
    setTimeout(function () { t.classList.add('hidden'); }, 3500);
  }

  function block(e) { e.preventDefault(); e.stopPropagation(); warn(); return false; }

  document.addEventListener('keydown', function (e) {
    var k = (e.key || '').toLowerCase();
    var mod = e.ctrlKey || e.metaKey;
    if (k === 'f12') return block(e);
    // Developer tools: Ctrl+Shift+I/J/C/K (Windows/Linux), Cmd+Option+I/J/C (Mac)
    if (mod && (e.shiftKey || e.altKey) && ['i', 'j', 'c', 'k'].indexOf(k) >= 0) return block(e);
    // View source and save page
    if (mod && (k === 'u' || k === 's')) return block(e);
    // Copy / cut outside the app's own text boxes
    if (mod && (k === 'c' || k === 'x') && !editable(e.target)) return block(e);
  }, true);

  document.addEventListener('contextmenu', function (e) { if (!editable(e.target)) block(e); }, true);
  document.addEventListener('copy', function (e) { if (!editable(e.target) && !editable(document.activeElement)) block(e); }, true);
  document.addEventListener('cut', function (e) { if (!editable(e.target)) block(e); }, true);
  document.addEventListener('dragstart', function (e) { if (!editable(e.target)) block(e); }, true);
  document.addEventListener('selectstart', function (e) { if (!editable(e.target)) e.preventDefault(); }, true);
})();
