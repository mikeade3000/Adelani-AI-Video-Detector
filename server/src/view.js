/* Builds the slice of data a signed-in user may see. Nothing secret leaves the server:
 * no password hashes, no answers to challenges, no other students' queries or private details. */
'use strict';
const { SQ, stripChallenge } = require('./shared');

const PUBLIC_USER = (u) => ({ id: u.id, displayName: u.displayName, avatar: u.avatar, role: u.role, classId: u.classId || null, active: u.active !== false });
const SAFE_USER = (u) => { const c = Object.assign({}, u); delete c.salt; delete c.passHash; return c; };
const clone = (o) => JSON.parse(JSON.stringify(o));

function publicSettings(st) {
  return { platformName: st.platformName, allowStudentSignup: st.allowStudentSignup, showDemoAccounts: st.showDemoAccounts,
    lives: st.lives, hintCost: st.hintCost, retryPenaltyPct: st.retryPenaltyPct, reviewXP: st.reviewXP, bossTimeMultiplier: st.bossTimeMultiplier,
    speedBonusPct: st.speedBonusPct, accuracyBonusPct: st.accuracyBonusPct, queryTimeoutMs: st.queryTimeoutMs, blocked: st.blocked };
}

function build(meId, caps) {
  const S = SQ.Store, db = S.raw();
  const me = meId ? S.user(meId) : null;
  if (!me || !me.active) {
    return { meId: null, caps, db: { settings: { platformName: db.settings.platformName, allowStudentSignup: db.settings.allowStudentSignup, showDemoAccounts: db.settings.showDemoAccounts } } };
  }
  const role = me.role, admin = role === 'admin';
  const myClassIds = new Set(admin ? db.classes.map((c) => c.id) : role === 'teacher' ? db.classes.filter((c) => c.teacherId === me.id).map((c) => c.id) : (me.classId ? [me.classId] : []));
  /* users whose full details/progress this viewer may see */
  const full = new Set([me.id]);
  db.users.forEach((u) => { if (admin || (role === 'teacher' && u.role === 'student' && myClassIds.has(u.classId))) full.add(u.id); });

  const users = db.users.filter((u) => full.has(u.id) || (u.role === 'student' && u.active !== false) || (role === 'student' && db.classes.some((c) => c.id === me.classId && c.teacherId === u.id)))
    .map((u) => full.has(u.id) ? SAFE_USER(u) : PUBLIC_USER(u));
  const progress = {};
  users.forEach((u) => {
    const p = S.progress(u.id);
    progress[u.id] = full.has(u.id) ? clone(p) : { xp: p.xp, streak: p.streak, bestStreak: p.bestStreak, lastActive: p.lastActive };
  });

  const submissions = db.submissions.filter((s) => full.has(s.userId) && (s.userId === me.id || role !== 'student'));
  const teams = db.teams.filter((t) => myClassIds.has(t.classId));
  const myTeam = role === 'student' ? teams.find((t) => t.memberIds.indexOf(me.id) >= 0) : null;
  const drafts = {};
  if (myTeam) Object.keys(db.drafts).forEach((k) => { if (k.indexOf(myTeam.id + ':') === 0) drafts[k] = db.drafts[k]; });

  let reviews = db.reviews.filter((r) => myClassIds.has(r.classId));
  if (role === 'student') {
    const roster = db.users.filter((u) => u.classId === me.classId && u.role === 'student').map((u) => u.id).sort();
    reviews = reviews.map((r) => {
      const c = clone(r);
      if (r.authorId !== me.id) { c.authorLabel = 'Classmate #' + (roster.indexOf(r.authorId) + 1); c.authorId = null; }
      c.reviews = r.reviews.map((x) => Object.assign({}, x, { reviewerId: x.reviewerId === me.id ? me.id : null }));
      return c;
    });
  }

  const customChallenges = db.customChallenges
    .filter((c) => admin || c.authorId === me.id || (c.published !== false && !db.hidden[c.id]))
    .map((c) => (admin || c.authorId === me.id) ? clone(c) : stripChallenge(c));
  const customLessons = db.customLessons.filter((l) => role !== 'student' || l.published !== false);

  return {
    meId: me.id, caps,
    db: {
      version: 1, users, progress, submissions,
      userBadges: db.userBadges.filter((x) => progress[x.userId]),
      badges: db.badges, settings: admin ? db.settings : publicSettings(db.settings),
      classes: db.classes.filter((c) => myClassIds.has(c.id)),
      assignments: db.assignments.filter((a) => myClassIds.has(a.classId)),
      teams, drafts, reviews, customChallenges, customLessons, hidden: db.hidden
    }
  };
}

module.exports = { build };
