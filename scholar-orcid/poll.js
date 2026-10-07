/*
 * Live poll engine shared by the presentation (index.html) and the
 * audience voting page (vote.html).
 *
 * Votes travel through a free public relay so the whole thing can live on
 * GitHub Pages with no server of your own:
 *   - Default: ntfy.sh (no sign-up; messages are kept for ~12 hours).
 *   - Optional: a Firebase Realtime Database URL (persistent storage).
 */
(function (global) {
  'use strict';

  var CONFIG = {
    ntfyServer: 'https://ntfy.sh',
    topicPrefix: 'scholar-orcid-ai-rank-',
    // Optional. Example: 'https://your-project-default-rtdb.firebaseio.com'
    // Database rules must allow read/write under /polls.
    firebaseUrl: ''
  };

  var TOOLS = [
    { id: 'consensus',  name: 'Consensus',  blurb: 'Answers drawn from peer-reviewed papers', hue: 212 },
    { id: 'elicit',     name: 'Elicit',     blurb: 'Literature review & data extraction',     hue: 262 },
    { id: 'scispace',   name: 'SciSpace',   blurb: 'Read, explain & chat with papers',        hue: 190 },
    { id: 'scite',      name: 'Scite',      blurb: 'Smart citations: supporting vs contrasting', hue: 24 },
    { id: 'notebooklm', name: 'NotebookLM', blurb: 'AI notebook grounded in your sources',    hue: 140 },
    { id: 'paperpal',   name: 'Paperpal',   blurb: 'Academic writing & language checks',      hue: 330 },
    { id: 'julius',     name: 'Julius AI',  blurb: 'Chat-based data analysis & charts',       hue: 46 },
    { id: 'chatgpt',    name: 'ChatGPT',    blurb: 'General-purpose AI assistant',            hue: 165 },
    { id: 'gemini',     name: 'Gemini',     blurb: 'General-purpose AI assistant',            hue: 228 },
    { id: 'perplexity', name: 'Perplexity', blurb: 'Answer engine with cited sources',        hue: 182 }
  ];
  var TOOL_IDS = TOOLS.map(function (t) { return t.id; });

  /* ---------- small helpers ---------- */
  function store(key, value) {
    try {
      if (value === undefined) return localStorage.getItem(key);
      if (value === null) localStorage.removeItem(key); else localStorage.setItem(key, value);
    } catch (e) { /* storage blocked: fine */ }
    return null;
  }

  function newId(len) {
    var abc = 'abcdefghjkmnpqrstuvwxyz23456789', out = '';
    var bytes = (global.crypto && crypto.getRandomValues) ? crypto.getRandomValues(new Uint8Array(len || 8)) : null;
    for (var i = 0; i < (len || 8); i++) out += abc[(bytes ? bytes[i] : Math.floor(Math.random() * 256)) % abc.length];
    return out;
  }

  function sanitizeVote(v) {
    if (!v || typeof v !== 'object' || !Array.isArray(v.r) || typeof v.vid !== 'string') return null;
    var seen = {}, r = [];
    v.r.forEach(function (id) {
      if (TOOL_IDS.indexOf(id) >= 0 && !seen[id]) { seen[id] = 1; r.push(id); }
    });
    if (!r.length) return null;
    return { vid: v.vid.slice(0, 32), r: r, t: Number(v.t) || 0, demo: !!v.demo };
  }

  function sleep(ms) { return new Promise(function (res) { setTimeout(res, ms); }); }

  /* ---------- transport ---------- */
  function topicFor(session) { return CONFIG.topicPrefix + session; }

  function submit(session, payload) {
    var body = JSON.stringify(payload);
    var attempt = 0;
    function once() {
      var req = CONFIG.firebaseUrl
        ? fetch(CONFIG.firebaseUrl.replace(/\/$/, '') + '/polls/' + encodeURIComponent(session) + '/' + encodeURIComponent(payload.vid) + '.json', { method: 'PUT', body: body })
        : fetch(CONFIG.ntfyServer + '/' + topicFor(session), { method: 'POST', body: body });
      return req.then(function (res) {
        if (res.ok) return true;
        throw new Error('HTTP ' + res.status);
      }).catch(function (err) {
        attempt++;
        if (attempt > 5) throw err;
        return sleep(1500 * Math.pow(2, attempt - 1)).then(once);
      });
    }
    return once();
  }

  /**
   * Listen for votes. onVotes receives the de-duplicated list (latest vote per
   * voter). onStatus receives 'live' | 'connecting' | 'offline'.
   * Returns a function that stops listening.
   */
  function subscribe(session, onVotes, onStatus) {
    var votes = {}, stopped = false, timers = [], es = null;
    onStatus = onStatus || function () {};

    function ingest(raw) {
      var v = sanitizeVote(raw);
      if (!v) return false;
      var prev = votes[v.vid];
      if (prev && prev.t >= v.t) return false;
      votes[v.vid] = v;
      return true;
    }
    function emit() { onVotes(Object.keys(votes).map(function (k) { return votes[k]; })); }

    if (CONFIG.firebaseUrl) {
      var url = CONFIG.firebaseUrl.replace(/\/$/, '') + '/polls/' + encodeURIComponent(session) + '.json';
      var pollFb = function () {
        if (stopped) return;
        fetch(url, { cache: 'no-store' }).then(function (r) { return r.json(); }).then(function (data) {
          var changed = false;
          Object.keys(data || {}).forEach(function (k) { if (ingest(data[k])) changed = true; });
          if (changed) emit();
          onStatus('live');
        }).catch(function () { onStatus('offline'); })
          .then(function () { if (!stopped) timers.push(setTimeout(pollFb, 4000)); });
      };
      onStatus('connecting');
      pollFb();
    } else {
      var base = CONFIG.ntfyServer + '/' + topicFor(session);
      var handleMsg = function (m) {
        if (!m || m.event !== 'message' || typeof m.message !== 'string') return false;
        try { return ingest(JSON.parse(m.message)); } catch (e) { return false; }
      };
      // Safety-net poll (also covers browsers/networks that block streaming).
      var pollNtfy = function () {
        if (stopped) return;
        fetch(base + '/json?poll=1&since=all', { cache: 'no-store' }).then(function (r) {
          if (!r.ok) throw new Error('HTTP ' + r.status);
          return r.text();
        }).then(function (txt) {
          var changed = false;
          txt.split('\n').forEach(function (line) {
            if (!line.trim()) return;
            try { if (handleMsg(JSON.parse(line))) changed = true; } catch (e) { /* skip */ }
          });
          if (changed) emit();
          if (!es || es.readyState !== 1) onStatus('live');
        }).catch(function () { if (!es || es.readyState !== 1) onStatus('offline'); })
          .then(function () { if (!stopped) timers.push(setTimeout(pollNtfy, 15000)); });
      };
      onStatus('connecting');
      if (global.EventSource) {
        es = new EventSource(base + '/sse?since=all');
        es.onopen = function () { onStatus('live'); };
        es.onerror = function () { onStatus(es.readyState === 2 ? 'offline' : 'connecting'); };
        es.onmessage = function (e) {
          try { if (handleMsg(JSON.parse(e.data))) emit(); } catch (err) { /* skip */ }
        };
      }
      pollNtfy();
    }

    return function stop() {
      stopped = true;
      timers.forEach(clearTimeout);
      if (es) es.close();
    };
  }

  /* ---------- ranking analysis ---------- */
  function analyze(votes) {
    var N = TOOLS.length, m = votes.length;
    var stats = TOOLS.map(function (t) {
      return { id: t.id, name: t.name, hue: t.hue, borda: 0, firsts: 0, count: 0, rankSum: 0, kr: 0, dist: new Array(N).fill(0) };
    });
    var byId = {};
    stats.forEach(function (s) { byId[s.id] = s; });
    var listLen = 0;

    votes.forEach(function (v) {
      var k = v.r.length, tie = (k + 1 + N) / 2;
      listLen += k;
      v.r.forEach(function (id, i) {
        var s = byId[id];
        s.borda += N - i;          // Borda count: 1st = 10 pts ... 10th = 1 pt
        s.count++;
        s.rankSum += i + 1;
        s.dist[i]++;
        if (i === 0) s.firsts++;
      });
      stats.forEach(function (s) {
        var i = v.r.indexOf(s.id);
        s.kr += i >= 0 ? i + 1 : tie;   // unranked tools share the remaining positions
      });
    });

    stats.forEach(function (s) {
      s.score = m ? (s.borda / (m * N)) * 100 : 0;
      s.avgRank = s.count ? s.rankSum / s.count : null;
      s.reach = m ? (s.count / m) * 100 : 0;
      s.firstShare = m ? (s.firsts / m) * 100 : 0;
    });

    // Kendall's coefficient of concordance (0 = no agreement, 1 = identical rankings)
    var W = null;
    if (m > 1) {
      var mean = m * (N + 1) / 2, S = 0;
      stats.forEach(function (s) { S += Math.pow(s.kr - mean, 2); });
      W = Math.min(1, (12 * S) / (m * m * (Math.pow(N, 3) - N)));
    }

    var ranked = stats.slice().sort(function (a, b) {
      return b.borda - a.borda || b.firsts - a.firsts || a.name.localeCompare(b.name);
    });
    return { m: m, N: N, stats: stats, ranked: ranked, W: W, avgListLen: m ? listLen / m : 0 };
  }

  function demoVotes(count) {
    // Plausible synthetic audience: general assistants familiar, niche tools less so.
    var weight = { chatgpt: 10, gemini: 7.5, perplexity: 5.5, notebooklm: 4.5, scispace: 4, consensus: 3.6, elicit: 3.2, paperpal: 3, scite: 2.2, julius: 1.6 };
    var out = [];
    for (var n = 0; n < count; n++) {
      var pool = TOOL_IDS.slice(), r = [];
      var take = 3 + Math.floor(Math.random() * 8);
      while (r.length < take && pool.length) {
        var total = pool.reduce(function (a, id) { return a + weight[id]; }, 0), x = Math.random() * total;
        for (var i = 0; i < pool.length; i++) {
          x -= weight[pool[i]];
          if (x <= 0) { r.push(pool.splice(i, 1)[0]); break; }
        }
      }
      out.push({ vid: 'demo-' + newId(6), r: r, t: Date.now(), demo: true });
    }
    return out;
  }

  function toCSV(result, votes) {
    var lines = ['Overall rank,Tool,Familiarity score (0-100),Borda points,First-choice votes,Respondents who ranked it,Reach %,Average position'];
    result.ranked.forEach(function (s, i) {
      lines.push([i + 1, s.name, s.score.toFixed(1), s.borda, s.firsts, s.count, s.reach.toFixed(1), s.avgRank ? s.avgRank.toFixed(2) : ''].join(','));
    });
    lines.push('', 'Respondent,' + TOOLS.map(function (t, i) { return 'Position ' + (i + 1); }).join(','));
    votes.forEach(function (v, i) {
      lines.push(['R' + (i + 1)].concat(v.r.map(function (id) { return TOOLS[TOOL_IDS.indexOf(id)].name; })).join(','));
    });
    return lines.join('\n');
  }

  global.Poll = {
    CONFIG: CONFIG, TOOLS: TOOLS, store: store, newId: newId,
    submit: submit, subscribe: subscribe, analyze: analyze, demoVotes: demoVotes, toCSV: toCSV
  };
})(window);
