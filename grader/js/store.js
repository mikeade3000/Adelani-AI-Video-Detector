/*
 * Local persistence. Session metadata goes to localStorage; page images
 * (Blobs) go to IndexedDB. Both are wrapped so the app keeps working in
 * memory when storage is blocked (private windows, strict settings).
 */
(function (root) {
  'use strict';

  var KEY = 'hwgrader.session.v1';
  var dbp = null;
  var memory = new Map();

  function openDb() {
    if (dbp) return dbp;
    dbp = new Promise(function (resolve) {
      try {
        var req = indexedDB.open('hwgrader', 1);
        req.onupgradeneeded = function () { req.result.createObjectStore('blobs'); };
        req.onsuccess = function () { resolve(req.result); };
        req.onerror = function () { resolve(null); };
        req.onblocked = function () { resolve(null); };
      } catch (e) { resolve(null); }
    });
    return dbp;
  }

  function tx(mode, fn) {
    return openDb().then(function (db) {
      if (!db) return null;
      return new Promise(function (resolve) {
        try {
          var t = db.transaction('blobs', mode);
          var req = fn(t.objectStore('blobs'));
          t.oncomplete = function () { resolve(req ? req.result : null); };
          t.onerror = t.onabort = function () { resolve(null); };
        } catch (e) { resolve(null); }
      });
    });
  }

  function putBlob(id, blob) {
    memory.set(id, blob);
    return tx('readwrite', function (s) { return s.put(blob, id); });
  }

  function getBlob(id) {
    if (memory.has(id)) return Promise.resolve(memory.get(id));
    return tx('readonly', function (s) { return s.get(id); }).then(function (b) {
      if (b) memory.set(id, b);
      return b || null;
    });
  }

  function deleteBlob(id) {
    memory.delete(id);
    return tx('readwrite', function (s) { return s.delete(id); });
  }

  function clearBlobs() {
    memory.clear();
    return tx('readwrite', function (s) { return s.clear(); });
  }

  function saveState(state) {
    try { localStorage.setItem(KEY, JSON.stringify(state)); return true; } catch (e) { return false; }
  }

  function loadState() {
    try { var s = localStorage.getItem(KEY); return s ? JSON.parse(s) : null; } catch (e) { return null; }
  }

  function getPref(k, d) { try { var v = localStorage.getItem('hwgrader.' + k); return v === null ? d : v; } catch (e) { return d; } }
  function setPref(k, v) { try { if (v === null) localStorage.removeItem('hwgrader.' + k); else localStorage.setItem('hwgrader.' + k, v); } catch (e) { /* ignore */ } }

  root.GraderStore = {
    putBlob: putBlob, getBlob: getBlob, deleteBlob: deleteBlob, clearBlobs: clearBlobs,
    saveState: saveState, loadState: loadState, getPref: getPref, setPref: setPref
  };
})(typeof self !== 'undefined' ? self : this);
