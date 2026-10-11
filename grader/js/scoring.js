/*
 * Rubric parsing, text normalisation and the scoring model (manuscript §3.4).
 *
 *   S_i = M_i × [ w · cos(a_i, m_i) + (1 − w) · k_i ]
 *
 * cos  – cosine similarity of bag-of-words term-frequency vectors
 * k_i  – keyword coverage: share of rubric keyword groups matched, where a
 *        word matches when its normalised Levenshtein similarity ≥ θ
 * Scores are rounded to the nearest step (half mark by default). Responses
 * with cos < τ and no matched keyword group are flagged as off-topic.
 *
 * Pure functions only, so the module runs unchanged in the browser and Node.
 */
(function (root) {
  'use strict';

  var DEFAULTS = {
    w: 0.5,            // weight of overall similarity
    theta: 0.8,        // Levenshtein similarity threshold for a keyword match
    tau: 0.1,          // off-topic cosine threshold
    step: 0.5,         // rounding step in marks (0 = no rounding)
    removeStopwords: true,
    stem: true
  };

  var DEFAULT_SUBSTITUTIONS = [
    'stere => store', 'tbe => the', 'tlie => the', 'teh => the', 'aud => and',
    'wlth => with', 'whicb => which', 'informaten => information',
    'infomation => information', 'informaton => information',
    'securty => security', 'scurity => security', 'acess => access',
    'pasword => password', 'passward => password', 'netwerk => network',
    'sistem => system', 'systen => system', 'dala => data', 'cornputer => computer',
    'comuter => computer', 'rnalware => malware', 'encyption => encryption'
  ].join('\n');

  var STOPWORDS = {};
  ('a an and are as at be been being but by can could did do does doing for from had has have having he her hers him his how i if in into is it its itself just me more most my no nor not of off on once only or other our ours out over own same she should so some such than that the their theirs them then there these they this those through to too under until up very was we were what when where which while who whom why will with would you your yours also may might must shall etc ie eg')
    .split(' ').forEach(function (w) { STOPWORDS[w] = true; });

  // ---------------------------------------------------------------- rubric

  var Q_HEADER = /^\s*(?:q|qn|ques|question)\s*\.?\s*([0-9]+[a-z]?)\s*(?:\[\s*([0-9]+(?:\.[0-9]+)?)\s*(?:marks?)?\s*\]|\(\s*([0-9]+(?:\.[0-9]+)?)\s*(?:marks?)?\s*\))?\s*[:.\-–]?\s*(.*)$/i;
  var DIRECTIVE = /^\s*(model|model answer|answer|keywords?|key words?|max|marks?|title)\s*:\s*(.*)$/i;

  function splitGroup(s) {
    return s.split('|').map(function (x) { return x.trim(); }).filter(Boolean);
  }

  function parseRubric(text) {
    var questions = [];
    var errors = [];
    var warnings = [];
    var q = null;
    var mode = null; // 'model' | 'keywords'
    var lines = String(text || '').replace(/\r\n?/g, '\n').split('\n');

    function finish() {
      if (!q) return;
      q.model = q.model.trim();
      if (!q.max || !(q.max > 0)) errors.push(q.label + ': maximum mark is missing (write e.g. "Q1 [5]" or "Max: 5").');
      if (!q.model) errors.push(q.label + ': model answer is missing (add a "Model:" line).');
      if (!q.keywordGroups.length) warnings.push(q.label + ': no keyword groups — the score will use similarity only.');
      questions.push(q);
    }

    lines.forEach(function (raw, idx) {
      var line = raw.replace(/\s+$/, '');
      if (/^\s*(#|\/\/)/.test(line)) return;
      var h = line.match(Q_HEADER);
      // A header must start the line with Q/Question and a number; avoid matching prose.
      if (h && /^\s*(q|qn|ques|question)\s*\.?\s*[0-9]/i.test(line)) {
        finish();
        q = {
          id: h[1].toLowerCase(),
          label: 'Q' + h[1].toLowerCase(),
          max: h[2] ? parseFloat(h[2]) : (h[3] ? parseFloat(h[3]) : 0),
          title: (h[4] || '').trim(),
          model: '',
          keywordGroups: []
        };
        mode = null;
        if (questions.some(function (x) { return x.id === q.id; })) errors.push('Line ' + (idx + 1) + ': question ' + q.label + ' is defined twice.');
        return;
      }
      if (!q) {
        if (line.trim()) warnings.push('Line ' + (idx + 1) + ' ignored (it comes before the first question header).');
        return;
      }
      var d = line.match(DIRECTIVE);
      if (d) {
        var key = d[1].toLowerCase();
        var val = d[2].trim();
        if (key === 'max' || key === 'mark' || key === 'marks') {
          q.max = parseFloat(val);
          mode = null;
        } else if (key === 'title') {
          q.title = val;
          mode = null;
        } else if (key.indexOf('key') === 0) {
          mode = 'keywords';
          if (val) val.split(';').forEach(function (g) { g = splitGroup(g); if (g.length) q.keywordGroups.push(g); });
        } else {
          mode = 'model';
          if (val) q.model += val + '\n';
        }
        return;
      }
      if (mode === 'keywords') {
        var m = line.match(/^\s*(?:[-*•]|\d+[.)])?\s*(.*)$/);
        var g = splitGroup(m ? m[1] : line);
        if (g.length) q.keywordGroups.push(g);
      } else if (mode === 'model') {
        q.model += line + '\n';
      } else if (line.trim()) {
        warnings.push('Line ' + (idx + 1) + ' ignored (expected "Model:", "Keywords:" or "Max:").');
      }
    });
    finish();
    if (!questions.length) errors.push('No questions found. Start each question with a header such as "Q1 [5]".');
    return { questions: questions, errors: errors, warnings: warnings };
  }

  // --------------------------------------------------------- normalisation

  function parseSubstitutions(text) {
    var map = Object.create(null);
    String(text || '').split(/\n/).forEach(function (line) {
      var m = line.match(/^\s*([^=#]+?)\s*=>?\s*(.+?)\s*$/);
      if (m) map[m[1].toLowerCase()] = m[2].toLowerCase();
    });
    return map;
  }

  // Digits OCR commonly produces inside words: "c0mputer", "sca1e", "5ecure".
  var DIGIT_FIX = { '0': 'o', '1': 'l', '5': 's', '|': 'l', '$': 's', '@': 'a' };

  function normalizeText(text, subs) {
    var t = String(text || '')
      .replace(/[‘’ʼ`]/g, "'")
      .replace(/[“”]/g, '"')
      .replace(/(\w)-\s*\n\s*(\w)/g, '$1$2') // join words hyphenated across lines
      .toLowerCase();
    t = t.replace(/'s\b/g, '').replace(/'/g, '');
    var tokens = t.split(/[^a-z0-9|$@]+/).filter(Boolean).map(function (tok) {
      if (/[a-z]/.test(tok) && /[0-9|$@]/.test(tok)) {
        var letters = tok.replace(/[^a-z]/g, '').length;
        if (letters >= tok.length / 2) tok = tok.replace(/[015|$@]/g, function (c) { return DIGIT_FIX[c]; });
      }
      return tok.replace(/[|$@]/g, '');
    }).filter(Boolean);
    if (subs) {
      var out = [];
      tokens.forEach(function (tok) {
        var r = subs[tok];
        if (r !== undefined) r.split(/\s+/).forEach(function (x) { if (x) out.push(x); });
        else out.push(tok);
      });
      tokens = out;
    }
    return tokens;
  }

  // Very light suffix stripping so "passwords"/"password", "encrypted"/"encrypt" meet.
  function stem(w) {
    if (w.length <= 4) return w;
    if (/ies$/.test(w)) return w.slice(0, -3) + 'y';
    if (/sses$/.test(w)) return w.slice(0, -2);
    if (/ing$/.test(w) && w.length > 6) return w.slice(0, -3);
    if (/ed$/.test(w) && w.length > 5) return w.slice(0, -2);
    if (/es$/.test(w) && /(ss|x|ch|sh)es$/.test(w)) return w.slice(0, -2);
    if (/s$/.test(w) && !/(ss|us|is)$/.test(w)) return w.slice(0, -1);
    return w;
  }

  function contentTokens(tokens, opts) {
    var out = [];
    for (var i = 0; i < tokens.length; i++) {
      var t = tokens[i];
      if (opts.removeStopwords && STOPWORDS[t]) continue;
      if (/^[0-9]+$/.test(t)) continue;
      out.push(opts.stem ? stem(t) : t);
    }
    return out;
  }

  // ------------------------------------------------------------ similarity

  function levenshtein(a, b) {
    if (a === b) return 0;
    var n = a.length, m = b.length;
    if (!n) return m;
    if (!m) return n;
    var prev = new Array(m + 1), cur = new Array(m + 1);
    for (var j = 0; j <= m; j++) prev[j] = j;
    for (var i = 1; i <= n; i++) {
      cur[0] = i;
      for (j = 1; j <= m; j++) {
        var cost = a[i - 1] === b[j - 1] ? 0 : 1;
        cur[j] = Math.min(prev[j] + 1, cur[j - 1] + 1, prev[j - 1] + cost);
      }
      var tmp = prev; prev = cur; cur = tmp;
    }
    return prev[m];
  }

  function levSimilarity(a, b) {
    var L = Math.max(a.length, b.length);
    return L ? 1 - levenshtein(a, b) / L : 1;
  }

  function termFreq(tokens) {
    var tf = Object.create(null);
    tokens.forEach(function (t) { tf[t] = (tf[t] || 0) + 1; });
    return tf;
  }

  function cosine(tokensA, tokensB) {
    var a = termFreq(tokensA), b = termFreq(tokensB);
    var dot = 0, na = 0, nb = 0, k;
    for (k in a) { na += a[k] * a[k]; if (b[k]) dot += a[k] * b[k]; }
    for (k in b) nb += b[k] * b[k];
    return na && nb ? dot / (Math.sqrt(na) * Math.sqrt(nb)) : 0;
  }

  // ----------------------------------------------------- keyword matching

  function matchKeywordGroups(tokens, groups, opts, subs) {
    var theta = opts.theta;
    var stems = opts.stem ? tokens.map(stem) : tokens;
    var matched = [], missed = [];
    groups.forEach(function (group, gi) {
      var best = null;
      group.forEach(function (alt) {
        var prefix = /\*$/.test(alt);
        var altToks = normalizeText(alt.replace(/\*$/, ''), subs);
        var n = altToks.length;
        if (!n) return;
        var altStr = altToks.join(' ');
        var altStem = opts.stem ? altToks.map(stem).join(' ') : altStr;
        for (var i = 0; i + n <= tokens.length; i++) {
          var win = tokens.slice(i, i + n).join(' ');
          var sim;
          if (prefix) {
            var lastTok = tokens[i + n - 1];
            var head = n > 1 ? tokens.slice(i, i + n - 1).join(' ') : '';
            var altHead = altToks.slice(0, -1).join(' ');
            var lastAlt = altToks[n - 1];
            sim = (head === altHead || levSimilarity(head, altHead) >= theta) &&
              lastTok.indexOf(lastAlt) === 0 ? 1 : levSimilarity(win, altStr);
          } else if (win === altStr || stems.slice(i, i + n).join(' ') === altStem) {
            sim = 1;
          } else {
            sim = levSimilarity(win, altStr);
          }
          if (sim >= theta && (!best || sim > best.similarity)) {
            best = { group: gi, keyword: alt, found: win, similarity: sim, start: i, length: n };
          }
          if (best && best.similarity === 1) break;
        }
      });
      if (best) matched.push(best); else missed.push({ group: gi, keywords: group });
    });
    return { matched: matched, missed: missed, coverage: groups.length ? matched.length / groups.length : null };
  }

  // -------------------------------------------------------------- scoring

  function roundTo(x, step) {
    if (!step) return Math.round(x * 100) / 100;
    return Math.round(x / step) * step;
  }

  function scoreResponse(answerText, question, options, subs, ocrInfo) {
    var opts = Object.assign({}, DEFAULTS, options || {});
    var tokens = normalizeText(answerText, subs);
    var modelTokens = normalizeText(question.model, subs);
    var aContent = contentTokens(tokens, opts);
    var mContent = contentTokens(modelTokens, opts);
    var cos = cosine(aContent, mContent);
    var kw = matchKeywordGroups(tokens, question.keywordGroups || [], opts, subs);
    var hasKeywords = kw.coverage !== null;
    var k = hasKeywords ? kw.coverage : 0;
    var w = hasKeywords ? opts.w : 1;
    var blended = w * cos + (1 - w) * k;
    var raw = question.max * blended;
    var empty = tokens.length === 0;
    var offTopic = !empty && cos < opts.tau && kw.matched.length === 0;
    var suggested = empty || offTopic ? 0 : Math.max(0, Math.min(question.max, roundTo(raw, opts.step)));

    // Confidence: how much the examiner should look at this one.
    var reasons = [];
    var level = 'green';
    function flag(lv, msg) {
      reasons.push(msg);
      if (lv === 'red' || (lv === 'amber' && level === 'green')) level = lv;
    }
    if (empty) flag('red', 'No text was recognised for this question.');
    if (offTopic) flag('red', 'Possible off-topic answer (similarity below τ and no keywords matched).');
    var dictRatio = ocrInfo && typeof ocrInfo.dictRatio === 'number' ? ocrInfo.dictRatio : null;
    if (dictRatio !== null) {
      if (dictRatio < 0.5) flag('red', 'Poor OCR quality (' + Math.round(dictRatio * 100) + '% recognisable words).');
      else if (dictRatio < 0.75) flag('amber', 'Uncertain OCR quality (' + Math.round(dictRatio * 100) + '% recognisable words).');
    }
    if (!empty && tokens.length < 5) flag('amber', 'Very short answer (' + tokens.length + ' words).');
    if (hasKeywords && !empty && !offTopic) {
      var gap = Math.abs(cos - k);
      if (gap > 0.6) flag('red', 'Similarity and keyword coverage disagree strongly.');
      else if (gap > 0.4) flag('amber', 'Similarity and keyword coverage disagree.');
    }
    if (!empty && !offTopic && Math.abs(raw - question.max / 2) <= Math.max(opts.step || 0.5, question.max * 0.05)) {
      flag('amber', 'Mark is close to half of the maximum.');
    }

    return {
      cosine: cos,
      coverage: hasKeywords ? k : null,
      matched: kw.matched,
      missed: kw.missed,
      raw: raw,
      suggested: suggested,
      offTopic: offTopic,
      empty: empty,
      wordCount: tokens.length,
      confidence: level,
      reasons: reasons
    };
  }

  // -------------------------------------------- OCR quality / best-of-two

  function dictionaryRatio(text, extraVocab, subs) {
    var words = (root.GraderWords || (typeof require === 'function' ? require('./words.js') : {})).COMMON_WORDS || {};
    var toks = normalizeText(text, subs).filter(function (t) { return /^[a-z]{2,}$/.test(t); });
    if (!toks.length) return 0;
    var hit = 0;
    toks.forEach(function (t) {
      var s = stem(t);
      if (words[t] || words[s] || STOPWORDS[t] || (extraVocab && (extraVocab[t] || extraVocab[s]))) hit++;
    });
    return hit / toks.length;
  }

  function rubricVocabulary(rubric, subs) {
    var v = Object.create(null);
    (rubric.questions || []).forEach(function (q) {
      var all = [q.model, q.title].concat([].concat.apply([], q.keywordGroups || []));
      normalizeText(all.join(' ').replace(/\*/g, ''), subs).forEach(function (t) { v[t] = true; v[stem(t)] = true; });
    });
    return v;
  }

  // ------------------------------------------------- answer segmentation

  var MARKER_STRICT = /^\s*[(\[]?\s*(?:q{1,2}|qn|ques|question|qu)\s*\.?\s*(?:no\.?\s*)?([0-9lI|oO]{1,2}[a-z]?)\s*[)\].:\-–]?\s*/i;
  var MARKER_LOOSE = /^\s*[(\[]?\s*([0-9]{1,2}[a-z]?)\s*[)\].:]\s*/i;

  function cleanId(s) {
    return s.replace(/[lI|]/g, '1').replace(/[oO]/g, '0').replace(/^0+(?=\d)/, '').toLowerCase();
  }

  /**
   * Split OCR text into per-question answers using "Q1"/"Question 2" markers
   * (strict) or also bare "3." / "4)" numbers (loose). Each marker is used once.
   */
  function segmentAnswers(text, questionIds, mode) {
    var ids = {};
    questionIds.forEach(function (id) { ids[id] = true; });
    var out = {};
    var unassigned = [];
    var current = null;
    var found = 0;
    String(text || '').replace(/\r\n?/g, '\n').split('\n').forEach(function (line) {
      var m = line.match(MARKER_STRICT);
      if (!m && mode === 'loose') m = line.match(MARKER_LOOSE);
      if (m) {
        var id = cleanId(m[1]);
        if (ids[id] && out[id] === undefined) {
          current = id;
          out[id] = '';
          found++;
          line = line.slice(m[0].length);
        }
      }
      if (current) out[current] += line + '\n';
      else unassigned.push(line);
    });
    Object.keys(out).forEach(function (k) { out[k] = out[k].trim(); });
    var rest = unassigned.join('\n').trim();
    if (!found && questionIds.length === 1) {
      out[questionIds[0]] = rest;
      rest = '';
    }
    return { answers: out, unassigned: rest, markersFound: found };
  }

  var api = {
    DEFAULTS: DEFAULTS,
    DEFAULT_SUBSTITUTIONS: DEFAULT_SUBSTITUTIONS,
    STOPWORDS: STOPWORDS,
    parseRubric: parseRubric,
    parseSubstitutions: parseSubstitutions,
    normalizeText: normalizeText,
    stem: stem,
    contentTokens: contentTokens,
    levenshtein: levenshtein,
    levSimilarity: levSimilarity,
    cosine: cosine,
    matchKeywordGroups: matchKeywordGroups,
    roundTo: roundTo,
    scoreResponse: scoreResponse,
    dictionaryRatio: dictionaryRatio,
    rubricVocabulary: rubricVocabulary,
    segmentAnswers: segmentAnswers
  };
  if (typeof module !== 'undefined' && module.exports) module.exports = api;
  else root.GraderScoring = api;
})(typeof self !== 'undefined' ? self : this);
