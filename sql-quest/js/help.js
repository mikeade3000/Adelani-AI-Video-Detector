/* In-app help: a short guide for the signed-in user's role. The full guides are in docs/ in the repository. */
(function () {
  var U = SQ.UI, S = SQ.Store, A = SQ.App;

  function sec(icon, title, body) { return '<details class="card" style="margin-bottom:12px" open><summary style="cursor:pointer;font:700 1.08rem var(--font-head)">' + icon + ' ' + title + '</summary><div style="margin-top:10px">' + body + '</div></details>'; }
  function dl(rows) { return '<div class="table-wrap"><table><tbody>' + rows.map(function (r) { return '<tr><td style="white-space:normal;width:34%"><b>' + r[0] + '</b></td><td style="white-space:normal">' + r[1] + '</td></tr>'; }).join('') + '</tbody></table></div>'; }

  function student(st) {
    return sec('🚀', 'How to play', '<ol><li>Open <b>Worlds</b> (or <b>Continue quest</b> on Home).</li><li>Read the <b>📖 lesson</b>, then do its two challenges.</li><li>Finish all levels in a world to unlock its <b>⚔️ boss</b>. Beat the boss to unlock the next world.</li></ol><p>Challenges marked <b>⭐ Bonus</b> were added by your teacher. They earn XP but are optional.</p>') +
      sec('⌨️', 'The SQL editor', dl([
        ['▶ Run (Ctrl+Enter)', 'Shows your result. It never costs a life, so run as often as you like.'],
        ['✔ Submit answer', 'Marks your answer. A wrong answer costs a ❤️.'],
        ['🗂️ Sandbox schema', 'All tables and columns. 🔑 = primary key, 🔗 = foreign key. <b>👁 rows</b> shows the data.'],
        ['Fresh database', 'The practice database resets on every run, so you can’t break anything.'],
        ['Row order', 'Doesn’t matter unless the question asks you to sort.']])) +
      sec('⭐', 'XP, lives and hints', dl([
        ['Base XP', 'Earned the first time you pass a challenge. Replays earn nothing.'],
        ['⚡ Speed bonus', '+' + st.speedBonusPct + '% if you finish within the par time.'],
        ['🎯 Accuracy bonus', '+' + st.accuracyBonusPct + '% if you made no wrong attempts.'],
        ['❤️ Lives', st.lives + ' per challenge. After losing them all, a retry earns ' + (100 - st.retryPenaltyPct) + '% of the XP.'],
        ['💡 Hints', 'Each costs ' + st.hintCost + ' XP.'],
        ['🔥 Streak', 'Pass a new challenge, beat a boss or write a peer review every day.']])) +
      sec('⚔️', 'Boss battles', '<p>4 questions, a time limit and ' + st.lives + ' lives for the whole battle. No hints. Win for big XP plus time and lives bonuses. If you lose, review the lessons and try again: the boss resets.</p>') +
      sec('🤝', 'Peer review and teams', '<p><b>Peer review:</b> share a query you solved; classmates review it anonymously. You earn +' + st.reviewXP + ' XP for each review you write.</p><p><b>Team missions:</b> anyone in the team can save a draft; only the 👑 leader submits. Everyone gets the XP.</p>') +
      sec('❓', 'Problems?', dl([
        ['Forgot password', 'Ask your teacher or administrator to reset it.'],
        ['🔒 Locked', 'Finish the earlier level or boss, or ask your teacher to assign the world.'],
        ['“no such column: Lagos”', 'Text needs single quotes: <code>\'Lagos\'</code>.'],
        ['Time limit exceeded', 'Your query ran too long (often a JOIN without ON). Simplify it.']]));
  }
  function teacher() {
    return sec('🏫', 'Classes', '<p><b>Classes → + New class</b> creates a join code (like <code>K7P-Q2M</code>). Students type it when they sign up or on their Home page. On a class page you can copy or replace the code, remove students, and see each student’s progress and weak topics.</p>') +
      sec('📌', 'Assignments', '<p>Class → <b>Assignments</b>: pick a world, a due date and a note. Tick <b>Unlock this world now</b> to let students start it before beating earlier bosses.</p>') +
      sec('🤝', 'Teams', '<p>Class → <b>Teams</b>: tick at least two students. The first one ticked is the leader (change it with <b>Make leader</b>). Only the leader submits team missions; every member earns the XP.</p>') +
      sec('📊', 'Analytics', dl([
        ['Most common errors', 'What the auto-grader caught most often, such as missing JOIN conditions or missing WHERE. Re-teach the top one.'],
        ['Pass rate by world', 'Where the class hits a wall.'],
        ['Time per level', 'Long times point to topics that need more examples.'],
        ['Weakest topics / Students who may need help', 'Who and what to follow up on.']])) +
      sec('✏️', 'Your own content', '<p><b>Content → + New challenge</b>: for query challenges, write only the <b>model solution</b>; the grader compares students’ results with its result. Use <b>Test solution</b> to check it. Your challenges appear as <b>⭐ Bonus</b> (optional, they never lock students out). <b>+ New lesson</b> supports <code>**bold**</code>, <code>`code`</code>, bullet lists and code blocks.</p>') +
      sec('👀', 'Previewing', '<p>Staff accounts have every world unlocked. Use <b>Worlds</b> to try any challenge or boss.</p>');
  }
  function admin() {
    return sec('👥', 'Users and roles', '<p><b>Users</b>: create teachers, change roles, reset passwords (signs the user out everywhere), disable or delete accounts. You can’t change your own role, so there is always an admin.</p>') +
      sec('📚', 'Content and badges', '<p><b>Content</b>: hide or publish any challenge. <b>Badges</b>: rename, change the icon, switch badges off, or add milestone badges (XP, streak, bosses…).</p>') +
      sec('⚙️', 'Settings', '<p>Lives, hint cost, bonuses, boss time, query time limit, blocked commands, student sign-up, and demo accounts (keep these <b>off</b> on a real site).</p>') +
      sec('💾', 'Backups', '<p><b>Settings → Export backup</b> downloads everything; <b>Import</b> replaces all data. To move from the browser-only version to a server, export there and import here.' + (SQ.Backend.mode() === 'server' ? ' Also back up the PostgreSQL database regularly.' : '') + '</p>') + teacher();
  }

  A.route('/help', null, function (p, me) {
    var st = S.settings();
    var body = me.role === 'student' ? student(st) : me.role === 'teacher' ? teacher() : admin();
    A.view('<div class="lesson"><div class="page-head"><div><h1>Help</h1><p>Quick guide for ' + (me.role === 'admin' ? 'administrators' : me.role + 's') + '. ' +
      (SQ.Backend.mode() === 'server' ? 'Your progress is saved on the server and follows you to any device.' : 'This site runs in browser-only mode: progress is saved in this browser only.') + '</p></div></div>' + body + '</div>');
  });
})();
