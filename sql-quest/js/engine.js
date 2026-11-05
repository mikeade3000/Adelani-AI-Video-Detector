/* Game engine: content assembly, unlocking, XP, levels, badges, analytics helpers. */
window.SQ = window.SQ || {};

SQ.Engine = (function () {
  var S = SQ.Store;

  /* ───────── content ───────── */
  function worlds() {
    var db = S.raw();
    return SQ.WORLDS.map(function (w) {
      var levels = w.levels.map(function (l) {
        var chs = l.challenges.concat(db.customChallenges.filter(function (c) { return c.levelId === l.id && c.published !== false; }))
          .filter(function (c) { return !db.hidden[c.id]; });
        var lessons = [l.lesson].concat(db.customLessons.filter(function (x) { return x.levelId === l.id && x.published !== false; }));
        return Object.assign({}, l, { challenges: chs, lessons: lessons, worldId: w.id });
      });
      return Object.assign({}, w, { levels: levels });
    });
  }
  function world(id) { return worlds().find(function (w) { return w.id === id; }); }
  function find(chId) {
    var ws = worlds();
    for (var i = 0; i < ws.length; i++) {
      var w = ws[i];
      for (var j = 0; j < w.levels.length; j++) {
        var c = w.levels[j].challenges.find(function (x) { return x.id === chId; });
        if (c) return { ch: c, world: w, level: w.levels[j] };
      }
      var b = w.boss.challenges.find(function (x) { return x.id === chId; });
      if (b) return { ch: b, world: w, boss: true };
    }
    var tm = SQ.TEAM_MISSIONS.find(function (x) { return x.id === chId; });
    if (tm) return { ch: tm, world: world(tm.worldId), team: true };
    return null;
  }
  function allChallenges(includeHidden) {
    var out = [], db = S.raw();
    SQ.WORLDS.forEach(function (w) {
      w.levels.forEach(function (l) {
        l.challenges.concat(db.customChallenges.filter(function (c) { return c.levelId === l.id; })).forEach(function (c) {
          if (includeHidden || (!db.hidden[c.id] && c.published !== false)) out.push({ ch: c, world: w, level: l });
        });
      });
    });
    return out;
  }

  /* ───────── progress & unlocking ───────── */
  function levelDone(p, level) { return level.challenges.length > 0 && level.challenges.every(function (c) { return p.completed[c.id]; }); }
  function assignedUnlocks(u) {
    if (!u || !u.classId) return {};
    var m = {};
    S.raw().assignments.forEach(function (a) { if (a.classId === u.classId && a.unlock) m[a.worldId] = true; });
    return m;
  }
  function worldUnlocked(userId, w) {
    var u = S.user(userId);
    if (u && u.role !== 'student') return true;
    if (w.num === 1) return true;
    if (assignedUnlocks(u)[w.id]) return true;
    var prev = SQ.WORLDS[w.num - 2];
    return !!S.progress(userId).bosses[prev.id];
  }
  function levelUnlocked(userId, w, idx) {
    if (!worldUnlocked(userId, w)) return false;
    var u = S.user(userId);
    if (u && u.role !== 'student') return true;
    if (idx === 0) return true;
    return levelDone(S.progress(userId), w.levels[idx - 1]);
  }
  function bossUnlocked(userId, w) {
    if (!worldUnlocked(userId, w)) return false;
    var u = S.user(userId); if (u && u.role !== 'student') return true;
    var p = S.progress(userId);
    return w.levels.every(function (l) { return levelDone(p, l); });
  }
  function worldProgress(userId, w) {
    var p = S.progress(userId), total = 0, done = 0;
    w.levels.forEach(function (l) { l.challenges.forEach(function (c) { total++; if (p.completed[c.id]) done++; }); });
    total++; if (p.bosses[w.id]) done++;
    return { done: done, total: total, pct: Math.round(100 * done / total) };
  }
  function nextStep(userId) {
    var ws = worlds(), p = S.progress(userId);
    for (var i = 0; i < ws.length; i++) {
      var w = ws[i];
      if (!worldUnlocked(userId, w)) continue;
      for (var j = 0; j < w.levels.length; j++) {
        var l = w.levels[j];
        if (!levelUnlocked(userId, w, j)) break;
        if (!p.lessons[l.id]) return { kind: 'lesson', world: w, level: l, href: '#/lesson/' + l.id };
        var c = l.challenges.find(function (x) { return !p.completed[x.id]; });
        if (c) return { kind: 'challenge', world: w, level: l, ch: c, href: '#/play/' + c.id };
      }
      if (!p.bosses[w.id] && bossUnlocked(userId, w)) return { kind: 'boss', world: w, href: '#/boss/' + w.id };
    }
    return null;
  }

  /* ───────── levels ───────── */
  var TITLES = ['Novice', 'Apprentice', 'Query Scout', 'Data Ranger', 'Join Knight', 'Schema Sage', 'Index Wizard', 'Vault Keeper', 'DB Legend'];
  function xpForLevel(n) { return 50 * n * (n - 1); }
  function levelInfo(xp) {
    var n = 1; while (xpForLevel(n + 1) <= xp) n++;
    var lo = xpForLevel(n), hi = xpForLevel(n + 1);
    return { level: n, title: TITLES[Math.min(n - 1, TITLES.length - 1)], into: xp - lo, span: hi - lo, pct: Math.round(100 * (xp - lo) / (hi - lo)), next: hi };
  }

  /* ───────── rewards ───────── */
  function award(userId, ch, info) {
    var st = S.settings(), p = S.progress(userId), beforeLvl = levelInfo(p.xp).level;
    if (p.completed[ch.id]) return { total: 0, already: true, newBadges: [] };
    var base = ch.xp || 20;
    var speed = info.seconds <= (ch.par || 60) ? Math.round(base * st.speedBonusPct / 100) : 0;
    var accuracy = info.wrong === 0 ? Math.round(base * st.accuracyBonusPct / 100) : 0;
    var penalty = p.retries[ch.id] ? -Math.round((base + speed + accuracy) * st.retryPenaltyPct / 100) : 0;
    var total = Math.max(0, base + speed + accuracy + penalty);
    p.xp += total;
    p.completed[ch.id] = { at: Date.now(), xp: total, wrong: info.wrong, seconds: info.seconds, type: ch.type, usedJoin: !!info.usedJoin };
    if (info.wrong === 0) p.firstTry++;
    if (speed) p.speed++;
    S.touchStreak(userId);
    S.save();
    var nb = checkBadges(userId);
    return { base: base, speed: speed, accuracy: accuracy, penalty: penalty, total: total, newBadges: nb, levelUp: levelInfo(p.xp).level > beforeLvl ? levelInfo(p.xp) : null };
  }
  function awardBoss(userId, w, info) {
    var p = S.progress(userId), beforeLvl = levelInfo(p.xp).level;
    if (p.bosses[w.id]) return { total: 0, already: true, newBadges: [] };
    var base = w.boss.xp, timeBonus = Math.round(base * 0.5 * info.timeLeft / info.timeLimit), livesBonus = info.lives * 10;
    var total = base + timeBonus + livesBonus;
    p.xp += total; p.bosses[w.id] = { at: Date.now(), xp: total, seconds: info.seconds };
    S.touchStreak(userId); S.save();
    var nb = checkBadges(userId);
    return { base: base, timeBonus: timeBonus, livesBonus: livesBonus, total: total, newBadges: nb, levelUp: levelInfo(p.xp).level > beforeLvl ? levelInfo(p.xp) : null };
  }
  function grantXP(userId, amount) {
    var p = S.progress(userId); p.xp += amount; S.save(); return checkBadges(userId);
  }
  function spendHint(userId, chId) {
    var p = S.progress(userId), cost = S.settings().hintCost;
    p.hints[chId] = (p.hints[chId] || 0) + 1; p.xp = Math.max(0, p.xp - cost); S.save();
    return cost;
  }

  /* ───────── badges ───────── */
  function badgeEarned(p, rule) {
    var comp = Object.keys(p.completed).map(function (k) { return p.completed[k]; });
    switch (rule.type) {
      case 'firstType': return comp.some(function (c) { return c.type === rule.value || (rule.value === 'query' && c.type === 'fix'); });
      case 'join': return comp.some(function (c) { return c.usedJoin; });
      case 'bosses': return Object.keys(p.bosses).length >= rule.value;
      case 'streak': return p.bestStreak >= rule.value;
      case 'firstTry': return p.firstTry >= rule.value;
      case 'speed': return p.speed >= rule.value;
      case 'xp': return p.xp >= rule.value;
      case 'reviews': return p.reviewsGiven >= rule.value;
      case 'team': return p.teamMissions >= rule.value;
      case 'completed': return comp.length >= rule.value;
    }
    return false;
  }
  function checkBadges(userId) {
    var db = S.raw(), p = S.progress(userId), out = [];
    db.badges.forEach(function (b) {
      if (b.disabled) return;
      var has = db.userBadges.some(function (x) { return x.userId === userId && x.badgeId === b.id; });
      if (!has && badgeEarned(p, b.rule)) { db.userBadges.push({ userId: userId, badgeId: b.id, at: Date.now() }); out.push(b); }
    });
    if (out.length) S.save();
    return out;
  }
  function userBadges(userId) {
    var db = S.raw();
    return db.userBadges.filter(function (x) { return x.userId === userId; })
      .map(function (x) { var b = db.badges.find(function (y) { return y.id === x.badgeId; }); return b && !b.disabled ? Object.assign({ at: x.at }, b) : null; })
      .filter(Boolean);
  }

  /* ───────── analytics ───────── */
  function subsFor(filter) { return S.raw().submissions.filter(filter); }
  function topicStats(userIds) {
    var set = {}; userIds.forEach(function (id) { set[id] = 1; });
    var t = {};
    subsFor(function (s) { return set[s.userId]; }).forEach(function (s) {
      var k = s.topic || 'other'; t[k] = t[k] || { tries: 0, pass: 0 }; t[k].tries++; if (s.ok) t[k].pass++;
    });
    return t;
  }
  function weakTopics(userId) {
    var t = topicStats([userId]);
    return Object.keys(t).filter(function (k) { return t[k].tries >= 2; })
      .map(function (k) { return { topic: k, label: SQ.TOPICS[k] || k, rate: Math.round(100 * t[k].pass / t[k].tries), tries: t[k].tries }; })
      .filter(function (x) { return x.rate < 70; })
      .sort(function (a, b) { return a.rate - b.rate; }).slice(0, 4);
  }
  function leaderboard(classId) {
    return S.users().filter(function (u) { return u.role === 'student' && u.active && (!classId || u.classId === classId); })
      .map(function (u) { var p = S.progress(u.id); return { user: u, xp: p.xp, level: levelInfo(p.xp).level, streak: p.streak, badges: userBadges(u.id).length }; })
      .sort(function (a, b) { return b.xp - a.xp || a.user.displayName.localeCompare(b.user.displayName); });
  }
  function classAnalytics(classId) {
    var students = S.users().filter(function (u) { return u.role === 'student' && u.classId === classId; });
    var ids = {}; students.forEach(function (u) { ids[u.id] = 1; });
    var subs = subsFor(function (s) { return ids[s.userId]; });
    var errors = {}, perWorld = {}, perLevel = {};
    subs.forEach(function (s) {
      if (!s.ok && s.category && s.category !== 'incomplete') errors[s.category] = (errors[s.category] || 0) + 1;
      var w = s.worldId || 'other'; perWorld[w] = perWorld[w] || { tries: 0, pass: 0 }; perWorld[w].tries++; if (s.ok) perWorld[w].pass++;
      if (s.ok && s.levelId && s.seconds) { perLevel[s.levelId] = perLevel[s.levelId] || { total: 0, n: 0 }; perLevel[s.levelId].total += s.seconds; perLevel[s.levelId].n++; }
    });
    return { students: students, subs: subs, errors: errors, perWorld: perWorld, perLevel: perLevel, topics: topicStats(students.map(function (u) { return u.id; })) };
  }

  /* ───────── demo seed (simulated history so dashboards have data) ───────── */
  function finishSeed() {
    var db = S.raw();
    if (!db._seedPlan) return;
    var rnd = (function (s) { return function () { s = (s * 16807) % 2147483647; return (s - 1) / 2147483646; }; })(42);
    var cats = { query: ['missing_where', 'syntax', 'columns', 'row_count'], fix: ['syntax', 'unknown_name'], quiz: ['concept'], short: ['concept'], drag: ['design'] };
    var joinCats = ['join_condition', 'join_condition', 'join_type', 'ambiguous'];
    var orderCats = ['order', 'missing_limit'];
    db._seedPlan.forEach(function (plan, pi) {
      var p = S.progress(plan.userId), steps = 0, day = 0;
      var activeDays = 1 + Math.floor(rnd() * 8);
      outer:
      for (var wi = 0; wi < SQ.WORLDS.length; wi++) {
        var w = SQ.WORLDS[wi];
        for (var li = 0; li < w.levels.length; li++) {
          var l = w.levels[li]; p.lessons[l.id] = true;
          for (var ci = 0; ci < l.challenges.length; ci++) {
            if (steps >= plan.steps) break outer;
            var c = l.challenges[ci];
            var wrong = rnd() < 0.45 ? 1 + Math.floor(rnd() * 3) : 0;
            var pool = c.topic === 'innerjoin' || c.topic === 'leftjoin' || c.topic === 'relationships' ? joinCats.concat(cats[c.type] || []) :
              c.topic === 'orderby' ? orderCats.concat(cats[c.type] || []) : (cats[c.type] || ['wrong_values']);
            var at = Date.now() - (plan.steps - steps) * 3600e3 * (2 + rnd() * 6);
            for (var k = 0; k < wrong; k++) db.submissions.push({ id: S.uid('sub'), userId: plan.userId, challengeId: c.id, worldId: w.id, levelId: l.id, topic: c.topic, ok: false, category: pool[Math.floor(rnd() * pool.length)], at: at - (wrong - k) * 60e3 });
            var secs = Math.round((c.par || 60) * (0.5 + rnd() * 1.6));
            db.submissions.push({ id: S.uid('sub'), userId: plan.userId, challengeId: c.id, worldId: w.id, levelId: l.id, topic: c.topic, ok: true, seconds: secs, at: at });
            var base = c.xp || 20, xp = base + (secs <= (c.par || 60) ? Math.round(base * .1) : 0) + (wrong ? 0 : Math.round(base * .2));
            p.xp += xp; p.completed[c.id] = { at: at, xp: xp, wrong: wrong, seconds: secs, type: c.type, usedJoin: /JOIN/i.test(c.solution || '') };
            if (!wrong) p.firstTry++; if (secs <= (c.par || 60)) p.speed++;
            steps++;
          }
        }
        if (steps >= plan.steps) break;
        p.bosses[w.id] = { at: Date.now() - 86400e3, xp: w.boss.xp + 40, seconds: 150 }; p.xp += w.boss.xp + 40;
      }
      p.streak = Math.min(activeDays, 12); p.bestStreak = p.streak + (pi % 3 === 0 ? 4 : 0);
      var yd = new Date(); yd.setDate(yd.getDate() - 1);
      p.lastActive = pi % 4 === 0 ? S.today(yd) : S.today();
      if (pi === 0) { p.streak = 3; p.bestStreak = 4; p.lastActive = S.today(yd); }
      var days = []; for (var d = p.streak - 1; d >= 0; d--) { var dd = new Date(p.lastActive + 'T12:00'); dd.setDate(dd.getDate() - d); days.push(S.today(dd)); }
      p.activeDays = days;
      checkBadges(plan.userId);
    });
    var team = db._seedTeam, plan = db._seedPlan;
    if (team) { team.memberIds = [plan[0].userId, plan[1].userId, plan[3].userId]; team.leaderId = plan[1].userId; }
    /* A shared query waiting for peer review */
    db.reviews.push({ id: S.uid('r'), classId: S.user(plan[2].userId).classId, authorId: plan[2].userId, challengeId: 'w2l2c1',
      query: 'SELECT name, gpa\nFROM students\nWHERE gpa >= 3.5 AND age >= 20;', note: 'Is there a neater way to write this?', createdAt: Date.now() - 7200e3, reviews: [] });
    delete db._seedPlan; delete db._seedTeam;
    S.save();
  }

  return {
    worlds: worlds, world: world, find: find, allChallenges: allChallenges, worldUnlocked: worldUnlocked, levelUnlocked: levelUnlocked,
    bossUnlocked: bossUnlocked, levelDone: levelDone, worldProgress: worldProgress, nextStep: nextStep, levelInfo: levelInfo,
    award: award, awardBoss: awardBoss, grantXP: grantXP, spendHint: spendHint, checkBadges: checkBadges, userBadges: userBadges,
    weakTopics: weakTopics, leaderboard: leaderboard, classAnalytics: classAnalytics, topicStats: topicStats, finishSeed: finishSeed
  };
})();
