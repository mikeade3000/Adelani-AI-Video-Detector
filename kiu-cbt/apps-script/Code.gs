var SHEETS = {
  staff: "Staff",
  candidates: "Candidates",
  questions: "Questions",
  assign: "Assignments",
  activity: "Activity",
  observers: "Observers",
  settings: "Settings",
  theoryq: "TheoryQuestions",
  theoryassign: "TheoryAssignments",
  recordings: "Recordings",
  programmes: "Programmes",
  courses: "Courses",
  students: "Students",
  schedule: "Schedule"
};
var STUDENT_COLS = ["student_id", "username", "password_hash", "full_name", "email", "phone", "programme", "created_at"];
var STAFF_COLS = ["username", "password_hash", "role", "full_name", "active", "created_at", "last_login", "email", "department", "must_change"];
var OBSERVER_COLS = ["token", "label", "active", "created_at", "expires_at", "show_scores"];
var SCHEDULE_COLS = ["course", "duration_minutes", "opens_at", "last_start_at", "updated_by", "updated_at"];
var QUESTION_COLS = ["question_id", "area", "question_text", "option_a", "option_b", "option_c", "option_d", "correct_answer", "marks", "course", "owner", "updated_at"];
var PROGRAMME_COLS = ["owner", "programme", "created_at"];
var COURSE_COLS = ["owner", "course_code", "course_title", "programme", "created_at"];
var CACHE_SECONDS = 21600;
var SUMMARY_CACHE_SECONDS = 8;
var ONLINE_WINDOW_MS = 9e4;
var SEEN_SHEET_MS = 12e4;
var TOKEN_TTL_MS = 10 * 3600 * 1e3;
var SUBMIT_GRACE_MS = 12e4;
var MAX_UPLOAD_BYTES = 25 * 1024 * 1024;
var MAX_SNAP_CHARS = 95e3;
var ACTIVITY_DOWNLOAD_MAX = 6e4;
var SCHEMA_VERSION = 5;
var PW_ROUNDS = 64;
var LOGIN_LIMITS = { staff: { max: 5, secs: 900 }, cand: { max: 10, secs: 300 } };
var OBSERVER_DEFAULT_DAYS = 7, OBSERVER_LEGACY_DAYS = 30;
var HEARTBEAT_GAP_MS = 18e4;
var MOVE_ALERT_KM = 5;
var FROZEN_ALERT = 3;
var VIRTUAL_CAM_RE = /obs|virtual|manycam|snap camera|xsplit|droidcam|epoccam|iriun|camtwist|e2esoft|vcam|splitcam|youcam|nvidia broadcast|mmhmm|chromacam|fake/i;
var DEFAULT_BLUEPRINT = [];
var CAND_COLS = [
  "exam_taker_id",
  "username",
  "password_hash",
  "full_name",
  "programme",
  "course",
  "year_of_study",
  "exam_venue",
  "current_step",
  "logged_in_at",
  "last_seen",
  "started_at",
  "submitted_at",
  "focus_loss",
  "geo_lat",
  "geo_lng",
  "geo_status",
  "answers_json",
  // Theory Part B
  "theory_step",
  "theory_started_at",
  "theory_submitted_at",
  "theory_scans_json",
  "theory_scores_json",
  "theory_total",
  // Proctoring
  "photo_file_id",
  "photo_at",
  "cam_status",
  "cam_events",
  "rec_segments",
  "rec_bytes",
  "last_rec_at",
  "last_snap_at",
  // Lecturer portal (owner = lecturer username; blank = managed by the exams office)
  "owner",
  "email",
  "phone",
  // Multi-course students: the student account this sitting belongs to (blank = stand-alone candidate)
  "student_id",
  // The exact question ids this candidate was given, frozen when the paper starts (marking uses this list)
  "paper_ids",
  // Server-side evidence counters (see integrityFlags_): silences, repeated frames, location moves, camera device
  "integrity_json"
];
var REC_COLS = ["at", "exam_taker_id", "kind", "seq", "file_id", "mime", "bytes", "phase", "session", "started"];
var DEFAULT_INSTRUCTIONS = "<p>Read these instructions carefully before you begin.</p><ul><li>This is a <b>proctored</b> examination. Your camera records you for the whole paper, and a live picture is shown to the invigilators.</li><li>Sit in a well-lit place with your face clearly visible. Do not cover or turn off the camera.</li><li>Do not switch tabs, minimise the window or open other applications. Every time you leave the exam window it is recorded.</li><li>Your device <b>location</b> must be switched on.</li><li>Once the paper starts the timer runs continuously and cannot be paused.</li></ul>";
var DEFAULT_TERMS = "<p>By continuing I confirm that:</p><ul><li>I am the student named on this account and I will write this examination myself.</li><li>I consent to my photograph, location, camera video and audio being captured and stored by Kampala International University for examination integrity.</li><li>I will remain on this examination window until I submit.</li></ul>";
var DEFAULT_THEORY_INS = "<p>This is <b>Section B (Theory)</b>. Write your answers by hand, then photograph each page and upload it here before the timer runs out.</p><ul><li>Write clearly in ink.</li><li>Put your registration number at the top of every page.</li><li>Upload one clear photo per page.</li></ul>";
function doGet(e) {
  var p = e && e.parameter || {};
  if (p.setup) {
    var st = SpreadsheetApp.getActiveSpreadsheet().getSheetByName(SHEETS.staff);
    if (st && st.getLastRow() >= 2) return html_("Already set up. Updates apply automatically \u2014 nothing to do here.");
    setup_();
    return html_("Setup complete. You can close this tab.");
  }
  return json_({ ok: true, service: "KIU CBT", ts: now_() });
}
function doPost(e) {
  CDATA_MEMO_ = null;
  LOCK_DEPTH_ = 0;
  LIVE_ROW_ = null;
  ROW_HINT_ = {};
  ROW_OK_ = {};
  LTI_TRUSTED_ID_ = null;
  var schemaKey = "schema:" + SCHEMA_VERSION;
  try {
    if (!CacheService.getScriptCache().get(schemaKey) && scriptProp_("SCHEMA_VERSION") !== String(SCHEMA_VERSION)) {
      withLock_(function() {
        if (scriptProp_("SCHEMA_VERSION") !== String(SCHEMA_VERSION)) setup_();
      }, 3e4);
    }
    CacheService.getScriptCache().put(schemaKey, "1", CACHE_SECONDS);
  } catch (err) {
  }
  var body = {};
  try {
    body = JSON.parse(e.postData.contents);
  } catch (err) {
    return json_({ error: "bad json" });
  }
  return json_(safe_(function() {
    return route_(body.action, body);
  }));
}
function safe_(fn) {
  try {
    return fn();
  } catch (err) {
    return { error: String(err && err.message || err) };
  }
}
function route_(action, d) {
  switch (action) {
    // ---- candidate ----
    case "candidateLogin":
      return candidateLogin_(d);
    case "ltiRedeem":
      return ltiRedeem_(d);
    case "candidateStart":
      return candidateStart_(d);
    case "candidateSync":
      return candidateSync_(d);
    case "candidateSubmit":
      return candidateSubmit_(d);
    case "updateProfile":
      return updateProfile_(d);
    case "photoUpload":
      return photoUpload_(d);
    case "recUpload":
      return recUpload_(d);
    // ---- theory part B (candidate) ----
    case "theoryInfo":
      return theoryInfo_(d);
    case "theoryStart":
      return theoryStart_(d);
    case "theoryUpload":
      return theoryUpload_(d);
    case "theoryDeleteScan":
      return theoryDeleteScan_(d);
    case "scanMedia":
      return scanMedia_(d);
    case "theorySubmit":
      return theorySubmit_(d);
    case "mcqScore":
      return mcqScore_(d);
    // ---- staff ----
    case "adminLogin":
      return adminLogin_(d);
    case "changePassword":
      return changePassword_(d);
    case "uploadCandidates":
      return uploadCandidates_(d);
    case "uploadQuestions":
      return uploadQuestions_(d);
    case "uploadAssign":
      return uploadAssign_(d);
    case "uploadTheory":
      return uploadTheory_(d);
    case "uploadTheoryAssign":
      return uploadTheoryAssign_(d);
    case "bankSummary":
      return bankSummary_(d);
    case "monitor":
      return monitor_(d);
    case "liveWall":
      return liveWall_(d);
    case "proctorView":
      return proctorView_(d);
    case "proctorMedia":
      return proctorMedia_(d);
    case "resetCandidate":
      return resetCandidate_(d);
    case "deleteCandidateMedia":
      return deleteCandidateMedia_(d);
    case "results":
      return results_(d);
    case "marking":
      return marking_(d);
    case "saveTheoryScore":
      return saveTheoryScore_(d);
    case "activity":
      return activityLog_(d);
    case "saveSettings":
      return saveSettings_(d);
    case "getSettings":
      return getSettings_(d);
    case "createAdmin":
      return createAdmin_(d);
    case "listAdmins":
      return listAdmins_(d);
    case "toggleAdmin":
      return toggleAdmin_(d);
    case "createObserver":
      return createObserver_(d);
    case "listObservers":
      return listObservers_(d);
    case "toggleObserver":
      return toggleObserver_(d);
    // ---- students / lecturers / catalogue / questions (scoped by role) ----
    case "myOverview":
      return myOverview_(d);
    case "listStudents":
      return listStudents_(d);
    case "saveStudents":
      return saveStudents_(d);
    case "deleteStudents":
      return deleteStudents_(d);
    case "resetStudentPassword":
      return resetStudentPassword_(d);
    case "addPracticeSittings":
      return addPracticeSittings_(d);
    case "orphanCourses":
      return orphanCourses_(d);
    case "deleteOrphanCourses":
      return deleteOrphanCourses_(d);
    case "savePracticeTiming":
      return savePracticeTiming_(d);
    case "getPracticeTiming":
      return getPracticeTiming_(d);
    case "removePracticeSittings":
      return removePracticeSittings_(d);
    case "mailInfo":
      return mailInfo_(d);
    case "emailStudents":
      return emailStudents_(d);
    case "listCatalog":
      return listCatalog_(d);
    case "saveProgramme":
      return saveProgramme_(d);
    case "deleteProgramme":
      return deleteProgramme_(d);
    case "saveCourse":
      return saveCourse_(d);
    case "deleteCourse":
      return deleteCourse_(d);
    case "listQuestions":
      return listQuestions_(d);
    case "saveQuestion":
      return saveQuestion_(d);
    case "deleteQuestions":
      return deleteQuestions_(d);
    case "assignQuestions":
      return assignQuestions_(d);
    case "listLecturers":
      return listLecturers_(d);
    case "saveLecturer":
      return saveLecturer_(d);
    case "deleteLecturer":
      return deleteLecturer_(d);
    case "examUploads":
      return examUploads_(d);
    case "importKiu":
      return importKiu_(d);
    case "listSchedule":
      return listSchedule_(d);
    case "saveSchedule":
      return saveSchedule_(d);
    // ---- observer (passwordless) ----
    case "observeData":
      return observeData_(d);
    default:
      return { error: "unknown action: " + action };
  }
}
function defaultSettings_() {
  return {
    exam_title: "KIU Online Examination",
    duration_minutes: "60",
    paper_size: "",
    // questions each candidate attempts, drawn from the unit's bank ('' = all of them)
    mark_per_question: "",
    // one mark for every Section A question in every unit ('' = each question's own marks)
    scheduled_start: "",
    last_start_at: "",
    // the practice test has its own time, separate from the real examinations (Uploads → Practice test)
    practice_duration_minutes: "15",
    practice_opens_at: "",
    // '' = open now
    practice_last_start_at: "",
    // '' = no closing time
    require_location: "1",
    require_photo: "1",
    require_camera: "1",
    record_video: "1",
    record_audio: "1",
    record_quality: "low",
    record_segment_seconds: "120",
    snapshot_seconds: "30",
    sync_seconds: "30",
    burst_spread_seconds: "20",
    shuffle_questions: "1",
    shuffle_options: "0",
    area_blueprint: JSON.stringify(DEFAULT_BLUEPRINT),
    theory_enabled: "0",
    theory_duration_minutes: "60",
    theory_upload_enabled: "1",
    theory_sheet_enabled: "1",
    reveal_mcq_score: "1",
    instructions_html: DEFAULT_INSTRUCTIONS,
    terms_html: DEFAULT_TERMS,
    theory_instructions_html: DEFAULT_THEORY_INS,
    // LMS (Moodle) single sign-on, LTI 1.3: the platform's details, from the LMS administrator
    lti_enabled: "0",
    lti_issuer: "",
    lti_client_id: "",
    lti_deployment_ids: "",
    lti_jwks_url: "",
    lti_auth_url: "",
    lti_token_url: ""
  };
}
function runSetup() {
  setup_();
  return "Setup complete.";
}
function exportForCloudflare() {
  var ss = SpreadsheetApp.getActiveSpreadsheet(), out = { kind: "kiu-cbt-export", schema: SCHEMA_VERSION, at: now_(), props: { APP_SECRET: scriptProp_("APP_SECRET") || "" }, sheets: {} };
  Object.keys(SHEETS).forEach(function(k) {
    var sh = ss.getSheetByName(SHEETS[k]);
    if (!sh || sh.getLastRow() < 1) return;
    out.sheets[SHEETS[k]] = sh.getDataRange().getValues().map(function(r) {
      return r.map(function(v) {
        return v instanceof Date ? v.toISOString() : v;
      });
    });
  });
  var f = DriveApp.createFile(Utilities.newBlob(JSON.stringify(out), "application/json", "kiu-cbt-export-" + stamp_() + ".json"));
  var msg = "Saved " + f.getName() + " in your Google Drive (" + f.getUrl() + "). Download it and import it into the Cloudflare version.";
  Logger.log(msg);
  return msg;
}
function resetSuperAdmin() {
  if (!scriptProp_("APP_SECRET")) setup_();
  return withLock_(function() {
    var sh = sheet_(SHEETS.staff), v = sh.getDataRange().getValues(), hash = makeHash_("changeme"), row = -1;
    for (var i = 1; i < v.length; i++) if (String(v[i][0]).trim().toLowerCase() === "super") {
      row = i + 1;
      break;
    }
    if (row > 0) {
      var r = v[row - 1].slice(0, STAFF_COLS.length);
      while (r.length < STAFF_COLS.length) r.push("");
      r[0] = "super";
      r[1] = hash;
      r[2] = "superadmin";
      r[4] = "1";
      r[9] = "1";
      if (!r[3]) r[3] = "Superadmin";
      sh.getRange(row, 1, 1, STAFF_COLS.length).setValues([r]);
    } else {
      appendRows_(sh, [["super", hash, "superadmin", "Superadmin", "1", now_(), "", "", "", "1"]], STAFF_COLS.length);
    }
    clearStaffCache_();
    throttleClear_("staff", "super");
    logEvent_("superadmin_reset", "", "from the Apps Script editor by " + (function() {
      try {
        return Session.getEffectiveUser().getEmail();
      } catch (e) {
        return "";
      }
    })());
    var msg = "Superadmin reset. Sign in to admin.html as super / changeme now and choose a new password.";
    Logger.log(msg);
    return msg;
  });
}
function setup_() {
  scriptProp_("APP_SECRET", scriptProp_("APP_SECRET") || Utilities.getUuid());
  var ss = SpreadsheetApp.getActiveSpreadsheet();
  ensureSheet_(ss, SHEETS.staff, STAFF_COLS);
  ensureSheet_(ss, SHEETS.candidates, CAND_COLS);
  ensureSheet_(ss, SHEETS.questions, QUESTION_COLS);
  ensureSheet_(ss, SHEETS.assign, ["exam_taker_id", "question_id", "sort_order"]);
  ensureSheet_(ss, SHEETS.activity, ["at", "event", "exam_taker_id", "detail"]);
  ensureSheet_(ss, SHEETS.observers, OBSERVER_COLS);
  ensureSheet_(ss, SHEETS.settings, ["key", "value"]);
  ensureSheet_(ss, SHEETS.theoryq, ["theory_id", "number", "prompt", "model_answer", "max_marks"]);
  ensureSheet_(ss, SHEETS.theoryassign, ["exam_taker_id", "theory_ids"]);
  ensureSheet_(ss, SHEETS.recordings, REC_COLS);
  ensureSheet_(ss, SHEETS.programmes, PROGRAMME_COLS);
  ensureSheet_(ss, SHEETS.courses, COURSE_COLS);
  ensureSheet_(ss, SHEETS.students, STUDENT_COLS);
  ensureSheet_(ss, SHEETS.schedule, SCHEDULE_COLS);
  var cur = settingsMap_(), defs = defaultSettings_();
  Object.keys(defs).forEach(function(k) {
    if (cur[k] === void 0) setSetting_(k, defs[k]);
  });
  var staff = sheet_(SHEETS.staff);
  if (staff.getLastRow() < 2) staff.appendRow(["super", makeHash_("changeme"), "superadmin", "Superadmin", "1", now_(), "", "", "", "1"]);
  [[SHEETS.candidates, CAND_COLS], [SHEETS.staff, STAFF_COLS], [SHEETS.questions, QUESTION_COLS], [SHEETS.observers, OBSERVER_COLS]].forEach(function(x) {
    var sh = sheet_(x[0]);
    if (sh.getMaxColumns() < x[1].length) sh.insertColumnsAfter(sh.getMaxColumns(), x[1].length - sh.getMaxColumns());
    if (sh.getLastColumn() < x[1].length) sh.getRange(1, 1, 1, x[1].length).setValues([x[1]]);
  });
  scriptProp_("SCHEMA_VERSION", String(SCHEMA_VERSION));
  clearDataCache_();
  clearStaffCache_();
}
function setSetting_(key, value) {
  var sh = sheet_(SHEETS.settings);
  var v = sh.getDataRange().getValues();
  for (var i = 1; i < v.length; i++) if (v[i][0] === key) {
    sh.getRange(i + 1, 2).setValue(value);
    return;
  }
  sh.appendRow([key, value]);
}
function ensureSheet_(ss, name, headers) {
  var sh = ss.getSheetByName(name);
  if (!sh) sh = ss.insertSheet(name);
  if (sh.getMaxColumns() < headers.length) sh.insertColumnsAfter(sh.getMaxColumns(), headers.length - sh.getMaxColumns());
  if (sh.getLastRow() === 0) {
    try {
      sh.getRange(1, 1, sh.getMaxRows(), sh.getMaxColumns()).setNumberFormat("@");
    } catch (e) {
    }
    sh.getRange(1, 1, 1, headers.length).setValues([headers]);
    sh.setFrozenRows(1);
  }
  return sh;
}
function authorizeDrive() {
  var p = proctorRoot_(), s = scanFolder_();
  return "Drive authorised. Proctoring folder: " + p.getName() + " (" + p.getId() + "); scans folder: " + s.getName() + ".";
}
function candidateLogin_(d) {
  var username = String(d.username || "").trim();
  var password = String(d.password || "");
  var data = candidateData_();
  var c = null;
  if (d.student_token) {
    var st = readToken_(d.student_token);
    if (!st || st.role !== "stu") return { error: "Session expired. Please sign in again." };
    var sid = String(d.sitting || "");
    if (!sid) {
      var me = studentMap_().byId[st.subject];
      if (!me) return { error: "Session expired. Please sign in again." };
      return studentSittings_(me, data);
    }
    if (data.studentById[sid] !== st.subject) return { error: "That examination is not on your list." };
    c = { exam_taker_id: sid };
  } else {
    if (!username) return { error: "Enter your username." };
    var locked = LTI_TRUSTED_ID_ ? "" : throttleCheck_("cand", username);
    if (locked) return { error: locked };
    var BAD = "Incorrect username or password.";
    c = data.byUser[username.toLowerCase()];
    if (!c) {
      var stu = studentMap_().byUser[username.toLowerCase()];
      var sv = stu ? verifyPassword_(password, stu.password_hash) : { ok: false };
      if (!sv.ok) {
        throttleFail_("cand", username);
        return { error: BAD };
      }
      throttleClear_("cand", username);
      if (sv.legacy) setStudentHash_(stu.student_id, makeHash_(password));
      return studentSittings_(stu, data);
    }
    var row = candidateRow_(c.exam_taker_id);
    var trusted = LTI_TRUSTED_ID_ !== null && !!row && String(row.exam_taker_id) === LTI_TRUSTED_ID_;
    var cv = trusted ? { ok: true } : row ? verifyPassword_(password, row.password_hash) : { ok: false };
    LIVE_ROW_ = row;
    if (!cv.ok) {
      throttleFail_("cand", username);
      return { error: BAD };
    }
    if (!trusted) throttleClear_("cand", username);
    if (cv.legacy) patchCandidate_(c.exam_taker_id, { password_hash: makeHash_(password) });
  }
  var live = (LIVE_ROW_ && LIVE_ROW_.exam_taker_id === String(c.exam_taker_id) ? LIVE_ROW_ : candidateRow_(c.exam_taker_id)) || c;
  var settings = settingsMap_();
  finalizeTheoryIfExpired_(live, settings);
  if (isFullyDone_(live, settings)) {
    var reveal = settings.reveal_mcq_score !== "0";
    var sc = computeMcqScore_(live, data, settings);
    logEvent_("reattempt_blocked", c.exam_taker_id, "");
    return {
      attempted: true,
      full_name: live.full_name,
      reveal,
      score: reveal ? sc.score : null,
      max_score: reveal ? sc.max : null
    };
  }
  var tm = timingFor_(live, settings);
  if (!live.started_at && tm.last_start_at && Date.now() > new Date(tm.last_start_at).getTime())
    return { error: "This examination closed for new starts at " + fmtWhen_(tm.last_start_at) + ". Contact the examinations office if you believe this is wrong.", closed_at: tm.last_start_at };
  var step = live.current_step && live.current_step !== "password" ? live.current_step : "instructions";
  patchCandidate_(c.exam_taker_id, { current_step: step, logged_in_at: live.logged_in_at || now_(), last_seen: now_() });
  logEvent_("login", c.exam_taker_id, String(d.ua || "").slice(0, 180));
  var qs = assignedQuestions_(c.exam_taker_id, data, settings, live);
  if (!qs.length && !live.started_at) return { error: "The questions for this examination have not been uploaded yet. Please check again later or contact your lecturer." };
  var counts = {}, order = [];
  qs.forEach(function(q) {
    if (!counts[q.area]) order.push(q.area);
    counts[q.area] = (counts[q.area] || 0) + 1;
  });
  var areas = order.map(function(a) {
    return { area: a, count: counts[a] };
  });
  return {
    ok: true,
    token: makeToken_("cand", c.exam_taker_id, null, data.rowById[c.exam_taker_id]),
    step,
    profile: {
      full_name: live.full_name,
      programme: live.programme,
      course: live.course,
      year_of_study: live.year_of_study,
      exam_venue: live.exam_venue,
      exam_taker_id: c.exam_taker_id,
      student_id: live.student_id || "",
      course_title: data.courseTitle[normCourse_(live.course)] || ""
    },
    questions: qs,
    areas,
    saved_answers: live.answers_json ? safeParse_(live.answers_json, {}) : {},
    duration_minutes: tm.duration,
    scheduled_start: tm.opens_at,
    last_start_at: tm.last_start_at,
    require_location: settings.require_location !== "0",
    instructions_html: settings.instructions_html || "",
    terms_html: settings.terms_html || "",
    exam_title: settings.exam_title || "Examination",
    theory_enabled: settingsFor_(live, settings).theory_enabled !== "0",
    started_at: live.started_at || "",
    has_photo: !!live.photo_file_id,
    proctor: proctorSettings_(settings),
    pacing: pacing_(settings),
    time_zone: officialTz_(),
    server_now: now_()
  };
}
function proctorSettings_(s) {
  return {
    require_photo: s.require_photo !== "0",
    require_camera: s.require_camera !== "0",
    record_video: s.record_video !== "0",
    record_audio: s.record_audio !== "0",
    quality: { minimal: 1, low: 1, standard: 1 }[s.record_quality] ? s.record_quality : "low",
    segment_seconds: Math.max(30, Math.min(300, int_(s.record_segment_seconds, 120))),
    snapshot_seconds: Math.max(10, Math.min(300, int_(s.snapshot_seconds, 30)))
  };
}
function blueprint_(settings) {
  var p = safeParse_(settings.area_blueprint || "[]", []);
  return p && p.length ? p.filter(function(b) {
    return b && b.area && int_(b.count, 0) > 0;
  }) : [];
}
function seededShuffle_(arr, seedStr) {
  var a = arr.slice(), seed = hashInt_(seedStr);
  for (var i = a.length - 1; i > 0; i--) {
    seed = seed * 1103515245 + 12345 & 2147483647;
    var j = seed % (i + 1);
    var t = a[i];
    a[i] = a[j];
    a[j] = t;
  }
  return a;
}
function paperSize_(settings) {
  var n = int_(settings && settings.paper_size, 0);
  return n > 0 ? n : 0;
}
function paperIds_(examId, data, settings) {
  var assigned = data.assignById[examId], n = paperSize_(settings);
  if (assigned && assigned.length) return n && assigned.length > n ? assigned.slice(0, n) : assigned.slice();
  var pool = paperPool_(examId, data, settings);
  return n && pool.length > n ? seededShuffle_(pool, examId + "|paper").slice(0, n) : pool;
}
function mcqCompleted_(c, settings) {
  if (!c || !c.started_at) return false;
  if (c.current_step === "submitted") return true;
  var end = new Date(c.started_at).getTime() + timingFor_(c, settings).duration * 6e4 + SUBMIT_GRACE_MS;
  return Date.now() > end;
}
function capPaper_(c, ids, settings) {
  var n = paperSize_(settings);
  if (!n || ids.length <= n || !mcqCompleted_(c, settings)) return ids;
  var ans = c.answers_json ? safeParse_(c.answers_json, {}) : {}, keep = {}, k = 0;
  ids.forEach(function(q) {
    if (k < n && ans[q]) {
      keep[q] = 1;
      k++;
    }
  });
  ids.forEach(function(q) {
    if (k < n && !keep[q]) {
      keep[q] = 1;
      k++;
    }
  });
  return ids.filter(function(q) {
    return keep[q];
  });
}
function paperPool_(examId, data, settings) {
  var owner = data.ownerById && data.ownerById[examId];
  var lects = lecturersFor_(data, data.progById && data.progById[examId], data.courseById && data.courseById[examId]);
  if (owner || lects.length) {
    var course = normCourse_(data.courseById[examId]), pool = [], seen = {};
    var owners = lects.slice();
    if (owner && owners.indexOf(String(owner).toLowerCase()) < 0) owners.unshift(String(owner).toLowerCase());
    owners.forEach(function(o) {
      (data.qByOwner[o] || []).forEach(function(qid) {
        if (seen[qid]) return;
        var qc = normCourse_(data.questions[qid].course);
        var okc = lects.length ? qc && (course === qc || course.indexOf(qc + " ") === 0) : !qc || !course || course === qc || course.indexOf(qc + " ") === 0;
        if (okc) {
          seen[qid] = 1;
          pool.push(qid);
        }
      });
    });
    return pool;
  }
  if (data.studentById && data.studentById[examId]) {
    var cc = normCourse_(data.courseById[examId]);
    return data.qorder.filter(function(qid) {
      var qc = normCourse_(data.questions[qid].course);
      return qc && (cc === qc || cc.indexOf(qc + " ") === 0);
    });
  }
  var bp = blueprint_(settings);
  if (!bp.length) return data.qorder.slice();
  var ids = [];
  bp.forEach(function(b) {
    var pool2 = data.byArea[b.area] || [];
    ids = ids.concat(seededShuffle_(pool2, examId + "|" + b.area).slice(0, int_(b.count, 0)));
  });
  return ids;
}
function paperFor_(c, data, settings) {
  settings = settingsFor_(c, settings);
  var frozen = c && c.paper_ids ? safeParse_(c.paper_ids, null) : null;
  return frozen && frozen.length !== void 0 ? capPaper_(c, frozen.map(String), settings) : paperIds_(c.exam_taker_id, data, settings);
}
function ensureCandCols_() {
  var sh = sheet_(SHEETS.candidates);
  if (sh.getMaxColumns() < CAND_COLS.length) sh.insertColumnsAfter(sh.getMaxColumns(), CAND_COLS.length - sh.getMaxColumns());
  if (sh.getLastColumn() < CAND_COLS.length) sh.getRange(1, 1, 1, CAND_COLS.length).setValues([CAND_COLS]);
}
function assignedQuestions_(examId, data, settings, row) {
  var ids = row ? paperFor_(row, data, settings) : paperIds_(examId, data, settings);
  var list = [];
  var shuffleOpts = settings.shuffle_options === "1";
  ids.forEach(function(qid) {
    var q = data.questions[qid];
    if (!q) return;
    var opts = { A: q.option_a, B: q.option_b, C: q.option_c, D: q.option_d };
    var keys = ["A", "B", "C", "D"].filter(function(k) {
      return String(opts[k] || "") !== "";
    });
    var order = shuffleOpts ? seededShuffle_(keys, examId + "|opt|" + qid) : keys;
    list.push({ id: q.question_id, area: q.area, text: q.question_text, opts, order });
  });
  if (settings.shuffle_questions !== "0") list = seededShuffle_(list, examId + "|order");
  return list;
}
function studentSittings_(stu, data) {
  var settings = settingsMap_(), list = [];
  candidateRowsFor_((data.sitsByStudent || {})[String(stu.student_id)] || []).forEach(function(c) {
    if (String(c.student_id) !== String(stu.student_id)) return;
    finalizeTheoryIfExpired_(c, settings);
    var done = isFullyDone_(c, settings);
    var status = done ? "done" : c.started_at ? "started" : "ready";
    var n = paperFor_(c, data, settings).length;
    if (!done && !n) status = "not_ready";
    var tm = timingFor_(c, settings);
    if (status === "ready" && tm.last_start_at && Date.now() > new Date(tm.last_start_at).getTime()) status = "closed";
    list.push({
      id: c.exam_taker_id,
      course: c.course,
      title: data.courseTitle[normCourse_(c.course)] || "",
      status,
      questions: n,
      duration_minutes: tm.duration,
      opens_at: tm.opens_at,
      last_start_at: tm.last_start_at
    });
  });
  list.sort(function(a, b) {
    return String(a.course).localeCompare(String(b.course));
  });
  logEvent_("student_login", stu.student_id, list.length + " course units");
  return {
    ok: true,
    choose: true,
    student_token: makeToken_("stu", stu.student_id),
    full_name: stu.full_name,
    programme: stu.programme,
    sittings: list,
    exam_title: settings.exam_title || "Examination",
    time_zone: officialTz_(),
    server_now: now_()
  };
}
var LTI_TRUSTED_ID_ = null;
var LTI_CODE_RE = /^[a-f0-9]{64}$/;
function ltiRand_() {
  return (Utilities.getUuid() + Utilities.getUuid()).replace(/-/g, "");
}
function ltiConfig_() {
  var s = settingsMap_();
  return {
    enabled: s.lti_enabled === "1",
    issuer: String(s.lti_issuer || "").trim().replace(/\/+$/, ""),
    client_id: String(s.lti_client_id || "").trim(),
    deployments: String(s.lti_deployment_ids || "").split(/[\s,;]+/).filter(String),
    jwks_url: String(s.lti_jwks_url || "").trim(),
    auth_url: String(s.lti_auth_url || "").trim(),
    token_url: String(s.lti_token_url || "").trim()
  };
}
function ltiNewState_(o) {
  var st = ltiRand_();
  CacheService.getScriptCache().put("ltist:" + st, JSON.stringify(o || {}), 600);
  return st;
}
function ltiTakeState_(st) {
  st = String(st || "");
  if (!LTI_CODE_RE.test(st)) return null;
  var c = CacheService.getScriptCache(), v = c.get("ltist:" + st);
  if (!v) return null;
  c.remove("ltist:" + st);
  return safeParse_(v, null);
}
function ltiIssue_(info) {
  var adm = String(info && info.admission || "").trim();
  if (!adm) return { error: "The LMS did not send your admission number. The LMS administrator should add the custom parameter admission=$User.username to the KIU Online CBT tool." };
  var studs = studentMap_(), data = candidateData_();
  var stu = studs.byId[adm] || studs.byUser[adm.toLowerCase()], kind, id;
  if (stu) {
    kind = "stu";
    id = stu.student_id;
  } else {
    var c = data.byUser[adm.toLowerCase()];
    if (!c) return { error: "Admission number " + adm + " is not registered for any online examination yet. Please contact the examinations office." };
    kind = "cand";
    id = c.exam_taker_id;
  }
  var code = ltiRand_();
  CacheService.getScriptCache().put("ltic:" + code, JSON.stringify({ kind, id, course: String(info.course || "") }), 120);
  logEvent_("lti_launch", id, "from the LMS" + (info.course ? " (" + String(info.course).slice(0, 60) + ")" : ""));
  return { ok: true, code };
}
function ltiUnitMatch_(course, unit) {
  var k = normCourse_(course), u = normCourse_(unit), kc = k.replace(/ /g, ""), uc = u.replace(/ /g, "");
  if (!k || !u) return false;
  if (kc === uc || k.indexOf(u + " ") === 0) return true;
  return kc.indexOf(uc) === 0 && !/[a-z0-9]/.test(kc.charAt(uc.length));
}
function ltiRedeem_(d) {
  var code = String(d.code || "");
  if (!LTI_CODE_RE.test(code)) return { error: "This link is not valid. Open the examination again from the LMS." };
  var cache = CacheService.getScriptCache(), v = cache.get("ltic:" + code);
  if (!v) return { error: "This link has expired or was already used. Open the examination again from the LMS." };
  cache.remove("ltic:" + code);
  var x = safeParse_(v, null) || {};
  try {
    if (x.kind === "stu") {
      var tok = makeToken_("stu", x.id), list = candidateLogin_({ student_token: tok });
      if (list.error) return list;
      list.username = x.id;
      list.via_lms = true;
      var hit = x.course ? (list.sittings || []).filter(function(s) {
        return ltiUnitMatch_(x.course, s.course);
      }) : [];
      if (hit.length === 1 && ["done", "not_ready", "closed"].indexOf(hit[0].status) < 0) {
        var r = candidateLogin_({ student_token: tok, sitting: hit[0].id, ua: d.ua });
        if (!r.error) {
          r.student_token = tok;
          r.username = x.id;
          r.via_lms = true;
          return r;
        }
      }
      return list;
    }
    var row = candidateRow_(x.id);
    if (!row) return { error: "You are not registered for this examination." };
    LTI_TRUSTED_ID_ = String(row.exam_taker_id);
    var r2 = candidateLogin_({ username: row.username, ua: d.ua });
    r2.username = row.username;
    r2.via_lms = true;
    return r2;
  } finally {
    LTI_TRUSTED_ID_ = null;
  }
}
function candidateStart_(d) {
  var id = authCand_(d.token);
  var c = candidateRow_(id);
  var settings = settingsMap_();
  var tm = timingFor_(c, settings);
  if (!c.started_at) {
    var opens = tm.opens_at ? new Date(tm.opens_at).getTime() : 0;
    if (opens && Date.now() < opens - 5e3) return { error: "The examination has not opened yet. Please wait for the countdown." };
    if (tm.last_start_at && Date.now() > new Date(tm.last_start_at).getTime()) return { error: "This examination closed for new starts at " + fmtWhen_(tm.last_start_at) + "." };
  }
  var needPhoto = settings.require_photo !== "0";
  if (needPhoto && !c.photo_file_id) return { error: "Your identity photo has not been saved. Please take your photo again." };
  var dur = tm.duration;
  var startAt = c.started_at || now_();
  if (!c.started_at) {
    var sp = { current_step: "exam", started_at: startAt, last_seen: now_() };
    if (!c.paper_ids) {
      sp.paper_ids = JSON.stringify(paperIds_(id, candidateData_(), settingsFor_(c, settings)));
    }
    patchCandidate_(id, sp);
    logEvent_("exam_started", id, "");
  }
  var remaining = Math.max(0, Math.floor((new Date(startAt).getTime() + dur * 6e4 - Date.now()) / 1e3));
  var live = candidateRow_(id), data = candidateData_();
  return { ok: true, started_at: startAt, remaining, server_now: now_(), questions: assignedQuestions_(id, data, settings, live) };
}
function candidateSync_(d) {
  var id = authCand_(d.token);
  var c = candidateRow_(id);
  var settings = settingsMap_();
  var dur = timingFor_(c, settings).duration;
  var mcqOpen = c.current_step !== "submitted";
  var cache = CacheService.getScriptCache(), nowIso = now_(), cput = {};
  var sheetSeen = c.last_seen, sheetSnap = c.last_snap_at;
  overlayLive_([c]);
  var patch = {}, same = function(a, b) {
    return String(a == null ? "" : a) === String(b == null ? "" : b);
  };
  var put = function(k, v) {
    if (!same(c[k], v)) patch[k] = v;
  };
  if (d.answers && mcqOpen && c.started_at && Date.now() <= mcqDeadline_(c, dur)) put("answers_json", JSON.stringify(d.answers));
  if (typeof d.focus_loss === "number") put("focus_loss", Math.max(int_(c.focus_loss, 0), d.focus_loss));
  if (d.step && mcqOpen) put("current_step", d.step);
  if (d.geo && d.geo.lat != null) {
    put("geo_lat", d.geo.lat);
    put("geo_lng", d.geo.lng);
    put("geo_status", d.geo.status);
  } else if (d.geo && d.geo.status && !c.geo_status) put("geo_status", d.geo.status);
  if (d.cam) {
    if (d.cam.status) put("cam_status", String(d.cam.status).slice(0, 20));
    if (typeof d.cam.events === "number") put("cam_events", Math.max(int_(c.cam_events, 0), d.cam.events));
  }
  var integ = safeParse_(c.integrity_json || "{}", {}) || {};
  var hot = safeParse_(cache.get("ih:" + id) || "", null);
  if (hot) {
    integ.snap_h = hot.snap_h;
    integ.snap_same = hot.snap_same;
    integ.snaps = Math.max(integ.snaps || 0, hot.snaps || 0);
  }
  var coldOf = function(o) {
    var x = {};
    for (var k in o) if (k !== "snap_h" && k !== "snap_same" && k !== "snaps") x[k] = o[k];
    return JSON.stringify(x);
  };
  var integBefore = coldOf(integ);
  var active = c.current_step === "exam" && !!c.started_at || c.theory_step === "theory";
  if (active && c.last_seen) {
    var gap = Date.now() - new Date(c.last_seen).getTime();
    if (gap > HEARTBEAT_GAP_MS) {
      integ.gaps = (integ.gaps || 0) + 1;
      integ.gap_max_s = Math.max(integ.gap_max_s || 0, Math.round(gap / 1e3));
      logEvent_("heartbeat_gap", id, Math.round(gap / 1e3) + " s without contact");
    }
  }
  if (d.snap && typeof d.snap === "string" && d.snap.length < MAX_SNAP_CHARS && d.snap.indexOf("data:image/") === 0) {
    var at = nowIso;
    cput["snap:" + id] = JSON.stringify({ at, data: d.snap, dark: !!d.dark });
    cput["snapt:" + id] = at;
    if (!sheetSnap || Date.now() - new Date(sheetSnap).getTime() > SEEN_SHEET_MS) patch.last_snap_at = at;
    var h = Utilities.base64EncodeWebSafe(Utilities.computeDigest(Utilities.DigestAlgorithm.MD5, d.snap)).slice(0, 12);
    if (integ.snap_h === h) {
      integ.snap_same = (integ.snap_same || 1) + 1;
      integ.frozen_max = Math.max(integ.frozen_max || 0, integ.snap_same);
    } else integ.snap_same = 1;
    integ.snap_h = h;
    integ.snaps = (integ.snaps || 0) + 1;
    if (integ.snap_same === FROZEN_ALERT) logEvent_("camera_frozen", id, FROZEN_ALERT + " identical pictures in a row");
  }
  if (d.geo && d.geo.lat != null && !isNaN(parseFloat(d.geo.lat))) {
    var la = parseFloat(d.geo.lat), lo = parseFloat(d.geo.lng);
    if (!integ.g0 && active) integ.g0 = [la, lo];
    else if (integ.g0) {
      var km = distKm_(integ.g0[0], integ.g0[1], la, lo);
      if (km > (integ.moved_km || 0)) {
        integ.moved_km = Math.round(km * 10) / 10;
        if (km >= MOVE_ALERT_KM && !integ.moved_logged) {
          integ.moved_logged = 1;
          logEvent_("location_moved", id, integ.moved_km + " km from the start");
        }
      }
    }
  }
  if (d.cam && d.cam.label) {
    var lbl = String(d.cam.label).slice(0, 80);
    if (integ.cam_label !== lbl) {
      integ.cam_label = lbl;
      if (VIRTUAL_CAM_RE.test(lbl)) {
        integ.virtual_cam = 1;
        logEvent_("virtual_camera", id, lbl);
      }
    }
  }
  if (d.screens && int_(d.screens, 1) > 1 && !integ.multi_screen) {
    integ.multi_screen = 1;
    logEvent_("extra_screen", id, "more than one screen connected");
  }
  var dt = (d.events || []).filter(function(e) {
    return e && e.event === "devtools_opened";
  }).length;
  if (dt && (c.started_at || c.theory_started_at)) integ.devtools = (integ.devtools || 0) + dt;
  cput["ih:" + id] = JSON.stringify({ snap_h: integ.snap_h, snap_same: integ.snap_same, snaps: integ.snaps });
  var integDirty = coldOf(integ) !== integBefore;
  if (d.events && d.events.length) logEvents_(id, d.events);
  var remaining = null;
  if (c.started_at && mcqOpen) {
    remaining = Math.max(0, Math.floor((new Date(c.started_at).getTime() + dur * 6e4 - Date.now()) / 1e3));
    if (remaining <= 0) {
      patch.current_step = "submitted";
      patch.submitted_at = now_();
      logEvent_("auto_submitted_timeout", id, "");
    }
  }
  cput["seen:" + id] = nowIso;
  try {
    cache.putAll(cput, CACHE_SECONDS);
  } catch (e) {
  }
  var refresh = !sheetSeen || Date.now() - new Date(sheetSeen).getTime() > SEEN_SHEET_MS;
  if (refresh) patch.last_seen = nowIso;
  if (integDirty || refresh && !same(c.integrity_json, JSON.stringify(integ))) patch.integrity_json = JSON.stringify(integ);
  if (Object.keys(patch).length) patchCandidate_(id, patch);
  return { ok: true, remaining, sync_s: pacing_(settings).sync_s };
}
function candidateSubmit_(d) {
  var id = authCand_(d.token);
  var c = candidateRow_(id);
  var settings = settingsMap_();
  var dur = timingFor_(c, settings).duration;
  var patch = { last_seen: now_() };
  var accept = !!c.started_at && Date.now() <= mcqDeadline_(c, dur);
  if (d.answers && accept) patch.answers_json = JSON.stringify(d.answers);
  else if (d.answers) logEvent_("late_answers_rejected", id, "");
  if (typeof d.focus_loss === "number") patch.focus_loss = Math.max(int_(c.focus_loss, 0), d.focus_loss);
  if (c.current_step !== "submitted") {
    patch.current_step = "submitted";
    patch.submitted_at = now_();
  }
  patchCandidate_(id, patch);
  logEvent_(d.auto ? "submitted_time_up" : "submitted", id, "");
  return { ok: true };
}
function mcqDeadline_(c, durMinutes) {
  return new Date(c.started_at).getTime() + durMinutes * 6e4 + SUBMIT_GRACE_MS;
}
function updateProfile_(d) {
  var id = authCand_(d.token);
  var p = d.profile || {}, patch = {};
  ["full_name", "year_of_study"].forEach(function(k) {
    if (p[k] !== void 0 && String(p[k]).trim() !== "") patch[k] = String(p[k]).trim().slice(0, 150);
  });
  if (Object.keys(patch).length) {
    patchCandidate_(id, patch);
    logEvent_("profile_edited", id, JSON.stringify(patch).slice(0, 300));
  }
  return { ok: true };
}
function proctorRoot_() {
  var fid = scriptProp_("PROCTOR_FOLDER_ID");
  if (fid) {
    try {
      return DriveApp.getFolderById(fid);
    } catch (e) {
    }
  }
  var f = DriveApp.createFolder("KIU CBT \u2014 Proctoring (private)");
  scriptProp_("PROCTOR_FOLDER_ID", f.getId());
  return f;
}
function candFolder_(id) {
  var cache = CacheService.getScriptCache(), key = "fold:" + id;
  var fid = cache.get(key);
  if (fid) {
    try {
      return DriveApp.getFolderById(fid);
    } catch (e) {
    }
  }
  return withLock_(function() {
    var root = proctorRoot_();
    var it = root.getFoldersByName(String(id));
    var f = it.hasNext() ? it.next() : root.createFolder(String(id));
    cache.put(key, f.getId(), CACHE_SECONDS);
    return f;
  });
}
function decodeDataUrl_(dataUrl) {
  var s = String(dataUrl || ""), i = s.indexOf(";base64,");
  if (s.lastIndexOf("data:", 0) !== 0 || i < 6 || i > 300) return null;
  var mime = s.slice(5, i).split(";")[0].trim();
  if (!/^[\w.+-]+\/[\w.+-]+$/.test(mime)) return null;
  return { mime, bytes: Utilities.base64Decode(s.slice(i + 8)) };
}
function extFor_(mime) {
  if (/png/.test(mime)) return "png";
  if (/jpe?g/.test(mime)) return "jpg";
  if (/mp4/.test(mime)) return "mp4";
  if (/webm/.test(mime)) return "webm";
  if (/ogg/.test(mime)) return "ogg";
  return "bin";
}
function saveProctorFile_(id, kind, dec2, label) {
  var name = id + "_" + kind + "_" + label + "." + extFor_(dec2.mime);
  var blob = Utilities.newBlob(dec2.bytes, dec2.mime, name);
  return candFolder_(id).createFile(blob);
}
function photoUpload_(d) {
  var id = authCand_(d.token);
  var dec2 = decodeDataUrl_(d.image);
  if (!dec2 || dec2.mime.indexOf("image/") !== 0) return { error: "The photo could not be read. Please retake it." };
  if (dec2.bytes.length > 5 * 1024 * 1024) return { error: "Photo too large." };
  var file = saveProctorFile_(id, "photo", dec2, stamp_());
  var at = now_();
  recRow_([at, id, "photo", 0, file.getId(), dec2.mime, dec2.bytes.length, "identity", "", at]);
  if (d.thumb && String(d.thumb).length < MAX_SNAP_CHARS) CacheService.getScriptCache().put("pthumb:" + id, String(d.thumb), CACHE_SECONDS);
  patchCandidate_(id, { photo_file_id: file.getId(), photo_at: at, cam_status: "on", last_seen: at });
  logEvent_("photo_captured", id, "");
  return { ok: true, at };
}
function recUpload_(d) {
  var id = authCand_(d.token);
  var session = String(d.session || "").replace(/[^\w-]/g, "").slice(0, 40) || "x";
  var seq = int_(d.seq, 0);
  var cache = CacheService.getScriptCache();
  var dupKey = "rec:" + id + ":" + session + ":" + seq;
  if (cache.get(dupKey)) return { ok: true, duplicate: true };
  var dec2 = decodeDataUrl_(d.data);
  if (!dec2) return { error: "Invalid recording data." };
  if (dec2.bytes.length > MAX_UPLOAD_BYTES) return { error: "Recording segment too large." };
  var label = session + "_" + ("0000" + seq).slice(-4);
  var file = saveProctorFile_(id, "rec", dec2, label);
  var at = now_();
  recRow_([at, id, "video", seq, file.getId(), dec2.mime, dec2.bytes.length, String(d.phase || ""), session, String(d.started || "")]);
  cache.put(dupKey, file.getId(), CACHE_SECONDS);
  var c = candidateRow_(id);
  patchCandidate_(id, {
    rec_segments: int_(c.rec_segments, 0) + 1,
    rec_bytes: int_(c.rec_bytes, 0) + dec2.bytes.length,
    last_rec_at: at
  });
  cache.put("seen:" + id, at, CACHE_SECONDS);
  return { ok: true, file: file.getId() };
}
function activityFor_(id) {
  var av = sheet_(SHEETS.activity).getDataRange().getValues(), out = [];
  for (var j = 1; j < av.length; j++) if (String(av[j][2]) === id) out.push(av[j]);
  return out;
}
function activityRecent_(limit) {
  var sh = sheet_(SHEETS.activity), last = sh.getLastRow();
  if (last < 2) return [];
  var n = Math.min(limit, last - 1);
  return sh.getRange(last - n + 1, 1, n, 4).getValues().reverse();
}
function recordingsFor_(id) {
  var rs = ensureSheet_(SpreadsheetApp.getActiveSpreadsheet(), SHEETS.recordings, REC_COLS).getDataRange().getValues(), out = [];
  for (var i = 1; i < rs.length; i++) if (String(rs[i][1]) === id) out.push(rs[i]);
  return out;
}
function removeRecordings_(id) {
  return removeRowsWhere_(ensureSheet_(SpreadsheetApp.getActiveSpreadsheet(), SHEETS.recordings, REC_COLS), function(r) {
    return String(r[1]) === String(id);
  });
}
function recordingOwner_(fid) {
  var sh = ensureSheet_(SpreadsheetApp.getActiveSpreadsheet(), SHEETS.recordings, REC_COLS);
  var hit = sh.getRange(1, 5, Math.max(1, sh.getLastRow()), 1).createTextFinder(fid).matchEntireCell(true).findNext();
  return hit ? String(sh.getRange(hit.getRow(), 2).getValue()) : null;
}
function recRow_(row) {
  var sh = ensureSheet_(SpreadsheetApp.getActiveSpreadsheet(), SHEETS.recordings, REC_COLS);
  sh.appendRow(row);
}
function liveWall_(d) {
  var t = authAny_(d.token);
  var nowMs = Date.now(), filter = String(d.filter || "active"), names = staffNames_(), settings = settingsMap_();
  var everyone = overlayLive_(allCandidateRows_()), groups = geoGroups_(everyone);
  var list = everyone.filter(function(c) {
    if (!canSee_(t, c)) return false;
    if (d.owner && rowLects_(candidateData_(), c).indexOf(String(d.owner).toLowerCase()) < 0) return false;
    if (filter === "all") return !!c.logged_in_at;
    var online = c.last_seen && nowMs - new Date(c.last_seen).getTime() < ONLINE_WINDOW_MS;
    var inExam = c.current_step === "exam" || c.theory_step === "theory";
    return online || inExam;
  });
  list.sort(function(a, b) {
    return String(a.full_name).localeCompare(String(b.full_name));
  });
  var total = list.length, offset = Math.max(0, int_(d.offset, 0)), limit = Math.max(1, Math.min(48, int_(d.limit, 24)));
  var page2 = list.slice(offset, offset + limit);
  var keys = [];
  page2.forEach(function(c) {
    keys.push("snap:" + c.exam_taker_id, "pthumb:" + c.exam_taker_id);
  });
  var got = keys.length ? CacheService.getScriptCache().getAll(keys) : {};
  var tiles = page2.map(function(c) {
    var s = safeParse_(got["snap:" + c.exam_taker_id] || "", null);
    var online = c.last_seen && nowMs - new Date(c.last_seen).getTime() < ONLINE_WINDOW_MS;
    return {
      exam_taker_id: c.exam_taker_id,
      full_name: c.full_name,
      step: c.current_step,
      theory_step: c.theory_step || "",
      course: c.course || "",
      owner_name: lectNames_(names, rowLects_(candidateData_(), c)),
      online: !!online,
      cam_status: c.cam_status || "",
      cam_events: int_(c.cam_events, 0),
      focus_loss: int_(c.focus_loss, 0),
      rec_segments: int_(c.rec_segments, 0),
      snap: s ? s.data : "",
      snap_at: s ? s.at : "",
      dark: s ? !!s.dark : false,
      photo: got["pthumb:" + c.exam_taker_id] || "",
      flags: integrityFlags_(c, settings, nowMs, groups)
    };
  });
  return { ok: true, total, offset, tiles, server_now: now_() };
}
function proctorView_(d) {
  var t = authAny_(d.token);
  var id = String(d.exam_taker_id || "");
  var c = candidateRow_(id);
  if (!c || !canSee_(t, c)) return { error: "Candidate not found." };
  overlayLive_([c]);
  var cache = CacheService.getScriptCache();
  var s = safeParse_(cache.get("snap:" + id) || "", null);
  var integ = safeParse_(c.integrity_json || "{}", {}) || {};
  var hotI = safeParse_(cache.get("ih:" + id) || "", null);
  if (hotI) integ.snaps = Math.max(integ.snaps || 0, hotI.snaps || 0);
  var flags = integrityFlags_(c, settingsMap_(), Date.now(), geoGroups_(allCandidateRows_()));
  var recs = recordingsFor_(id).map(function(r) {
    return { at: r[0], kind: r[2], seq: r[3], file_id: r[4], mime: r[5], bytes: r[6], phase: r[7], session: r[8], started: r[9] };
  });
  recs.sort(function(a, b) {
    return new Date(a.at).getTime() - new Date(b.at).getTime();
  });
  var ev = activityFor_(id).map(function(r) {
    return { at: r[0], event: r[1], detail: r[3] };
  });
  return {
    ok: true,
    candidate: {
      exam_taker_id: c.exam_taker_id,
      full_name: c.full_name,
      programme: c.programme,
      course: c.course,
      year_of_study: c.year_of_study,
      exam_venue: c.exam_venue,
      step: c.current_step,
      theory_step: c.theory_step || "",
      started_at: c.started_at,
      submitted_at: c.submitted_at,
      focus_loss: int_(c.focus_loss, 0),
      cam_status: c.cam_status || "",
      cam_events: int_(c.cam_events, 0),
      geo_lat: c.geo_lat,
      geo_lng: c.geo_lng,
      photo_file_id: c.photo_file_id || "",
      rec_segments: int_(c.rec_segments, 0),
      rec_bytes: int_(c.rec_bytes, 0)
    },
    photo_thumb: cache.get("pthumb:" + id) || "",
    snap: s ? s.data : "",
    snap_at: s ? s.at : "",
    recordings: recs,
    events: ev,
    flags,
    evidence: { pictures: integ.snaps || 0, camera_device: integ.cam_label || "", longest_silence_s: integ.gap_max_s || 0, moved_km: integ.moved_km || 0 }
  };
}
function proctorMedia_(d) {
  var t = authAny_(d.token);
  var fid = String(d.file_id || "");
  if (!fid) return { error: "Missing file." };
  var owner = recordingOwner_(fid);
  if (owner === null) return { error: "That file is not a proctoring record." };
  if (t.lecturer && !canSee_(t, candidateRow_(String(owner)))) return { error: "That file is not a proctoring record." };
  var file = DriveApp.getFileById(fid);
  var blob = file.getBlob();
  return { ok: true, name: file.getName(), mime: blob.getContentType(), data: Utilities.base64Encode(blob.getBytes()) };
}
function resetCandidate_(d) {
  var t = requireSuper_(d.token);
  var id = String(d.exam_taker_id || "");
  var cur = candidateRow_(id);
  if (!cur) return { error: "Candidate not found." };
  var media = d.delete_media && d.mode !== "extend" ? purgeMedia_(id, cur, true) : null;
  if (media) logEvent_("media_deleted_by_admin", id, media.files + " file(s), with the reset, by " + t.subject);
  var patch = {
    current_step: "password",
    started_at: "",
    submitted_at: "",
    answers_json: "",
    focus_loss: 0,
    theory_step: "",
    theory_started_at: "",
    theory_submitted_at: "",
    theory_scans_json: "",
    theory_scores_json: "",
    theory_total: "",
    paper_ids: "",
    integrity_json: ""
  };
  if (d.mode === "extend") {
    patch = { current_step: "exam", submitted_at: "", started_at: now_() };
  }
  patchCandidate_(id, patch);
  logEvent_(d.mode === "extend" ? "reopened_by_admin" : "reset_by_admin", id, "by " + t.subject);
  clearSummaryCache_();
  return media ? { ok: true, deleted: media.files, bytes: media.bytes } : { ok: true };
}
function deleteCandidateMedia_(d) {
  var t = requireSuper_(d.token);
  var id = String(d.exam_taker_id || ""), c = candidateRow_(id);
  if (!c) return { error: "Candidate not found." };
  var r = purgeMedia_(id, c, false);
  logEvent_("media_deleted_by_admin", id, r.files + " file(s) by " + t.subject);
  clearSummaryCache_();
  return { ok: true, deleted: r.files, bytes: r.bytes };
}
function purgeMedia_(id, c, withScans) {
  var n = 0, bytes = 0, done = {};
  var trash = function(fid, size) {
    fid = String(fid || "");
    if (!fid || done[fid]) return;
    done[fid] = 1;
    try {
      DriveApp.getFileById(fid).setTrashed(true);
      n++;
      bytes += int_(size, 0);
    } catch (e) {
    }
  };
  recordingsFor_(id).forEach(function(r) {
    trash(r[4], r[6]);
  });
  trash(c.photo_file_id, 0);
  var patch = { photo_file_id: "", photo_at: "", rec_segments: 0, rec_bytes: 0, last_rec_at: "", last_snap_at: "" };
  if (withScans) (safeParse_(c.theory_scans_json || "[]", []) || []).forEach(function(s) {
    trash(s.fileId, 0);
  });
  removeRecordings_(id);
  patchCandidate_(id, patch);
  CacheService.getScriptCache().removeAll(["snap:" + id, "snapt:" + id, "pthumb:" + id, "ih:" + id]);
  return { files: n, bytes };
}
function theorySheet_() {
  return ensureSheet_(SpreadsheetApp.getActiveSpreadsheet(), SHEETS.theoryq, ["theory_id", "number", "prompt", "model_answer", "max_marks"]);
}
function theoryAssignMap_() {
  var sh = ensureSheet_(SpreadsheetApp.getActiveSpreadsheet(), SHEETS.theoryassign, ["exam_taker_id", "theory_ids"]);
  var v = sh.getDataRange().getValues(), map = {};
  for (var i = 1; i < v.length; i++) {
    if (!v[i][0]) continue;
    map[String(v[i][0])] = String(v[i][1] || "").split(/[;,\|\s]+/).filter(function(x) {
      return x;
    });
  }
  return map;
}
function theoryQuestionsFor_(examId, bank, assignMap) {
  var ids = assignMap[examId];
  if (!ids || !ids.length) return bank;
  var byId = {};
  bank.forEach(function(q) {
    byId[q.theory_id] = q;
  });
  return ids.map(function(t) {
    return byId[t];
  }).filter(function(q) {
    return q;
  });
}
function theoryQuestionRows_() {
  var v = theorySheet_().getDataRange().getValues(), out = [];
  for (var i = 1; i < v.length; i++) {
    if (!v[i][0]) continue;
    out.push({ theory_id: String(v[i][0]), number: v[i][1], prompt: v[i][2], model_answer: v[i][3], max_marks: Math.max(0, num_(v[i][4], 0)) });
  }
  return out;
}
function theoryInfo_(d) {
  var id = authCand_(d.token);
  var c = candidateRow_(id);
  var settings = settingsMap_();
  finalizeTheoryIfExpired_(c, settings);
  var mine = c.theory_started_at ? theoryQuestionsFor_(id, theoryQuestionRows_(), theoryAssignMap_()) : [];
  return {
    ok: true,
    enabled: settingsFor_(c, settings).theory_enabled !== "0",
    upload_enabled: settings.theory_upload_enabled !== "0",
    sheet_enabled: settings.theory_sheet_enabled !== "0",
    duration_minutes: int_(settings.theory_duration_minutes, 60),
    instructions_html: settings.theory_instructions_html || "",
    exam_title: settings.exam_title || "Examination",
    questions: mine.map(function(q) {
      return { number: q.number, prompt: q.prompt, max_marks: q.max_marks };
    }),
    theory_step: c.theory_step || "",
    theory_started_at: c.theory_started_at || "",
    scans: scansOut_(c.theory_scans_json ? safeParse_(c.theory_scans_json, []) : []),
    profile: { full_name: c.full_name, exam_taker_id: c.exam_taker_id, programme: c.programme, course: c.course }
  };
}
function theoryStart_(d) {
  var id = authCand_(d.token);
  var c = candidateRow_(id);
  var settings = settingsMap_();
  if (c.current_step !== "submitted") return { error: "Submit Section A first." };
  var dur = int_(settings.theory_duration_minutes, 60);
  if (settingsFor_(c, settings).theory_enabled === "0") return { error: "Section B is not part of this examination." };
  var startAt = c.theory_started_at || now_();
  if (!c.theory_started_at) {
    patchCandidate_(id, { theory_step: "theory", theory_started_at: startAt, last_seen: now_() });
    logEvent_("theory_started", id, "");
  }
  var remaining = Math.max(0, Math.floor((new Date(startAt).getTime() + dur * 6e4 - Date.now()) / 1e3));
  var mine = theoryQuestionsFor_(id, theoryQuestionRows_(), theoryAssignMap_());
  return {
    ok: true,
    started_at: startAt,
    remaining,
    questions: mine.map(function(q) {
      return { number: q.number, prompt: q.prompt, max_marks: q.max_marks };
    })
  };
}
function scanFolder_() {
  var fid = scriptProp_("SCAN_FOLDER_ID");
  if (fid) {
    try {
      return DriveApp.getFolderById(fid);
    } catch (e) {
    }
  }
  var folder = DriveApp.createFolder("KIU CBT \u2014 Theory Scans");
  scriptProp_("SCAN_FOLDER_ID", folder.getId());
  return folder;
}
function theoryUpload_(d) {
  var id = authCand_(d.token);
  var c = candidateRow_(id);
  var settings = settingsMap_();
  if (settings.theory_upload_enabled === "0") return { error: "Answer-sheet upload is disabled for this examination." };
  if (!c.theory_started_at) return { error: "Open Section B first." };
  if (c.theory_step === "theory_submitted") return { error: "Section B has been submitted." };
  var dur = int_(settings.theory_duration_minutes, 60);
  if (Date.now() > new Date(c.theory_started_at).getTime() + dur * 6e4 + SUBMIT_GRACE_MS) return { error: "Theory time is up \u2014 uploads are closed." };
  var dec2 = decodeDataUrl_(d.image);
  if (!dec2 || dec2.mime.indexOf("image/") !== 0) return { error: "Invalid image data." };
  if (dec2.bytes.length > 10 * 1024 * 1024) return { error: "Page photo too large." };
  var name = id + "_p" + (d.page || "x") + "_" + Date.now() + "." + extFor_(dec2.mime);
  var file = scanFolder_().createFile(Utilities.newBlob(dec2.bytes, dec2.mime, name));
  var scans = c.theory_scans_json ? safeParse_(c.theory_scans_json, []) : [];
  scans.push({ page: d.page || scans.length + 1, fileId: file.getId(), at: now_() });
  patchCandidate_(id, { theory_scans_json: JSON.stringify(scans), last_seen: now_() });
  logEvent_("theory_scan_uploaded", id, "page " + (d.page || ""));
  return { ok: true, scans: scansOut_(scans) };
}
function scansOut_(scans) {
  return (scans || []).map(function(s) {
    return { page: s.page, fileId: s.fileId, at: s.at };
  });
}
function scanMedia_(d) {
  var id, c, t = readToken_(d.token);
  if (t && t.role === "cand") {
    id = t.subject;
    c = candidateRow_(id);
  } else {
    var st = authAny_(d.token);
    id = String(d.exam_taker_id || "");
    c = candidateRow_(id);
    if (!c || !canSee_(st, c)) return { error: "Candidate not found." };
  }
  if (!c) return { error: "Session expired. Please sign in again." };
  var fid = String(d.fileId || "");
  var mine = (c.theory_scans_json ? safeParse_(c.theory_scans_json, []) : []).some(function(s) {
    return s.fileId === fid;
  });
  if (!fid || !mine) return { error: "That page is not part of this script." };
  var blob = DriveApp.getFileById(fid).getBlob();
  return { ok: true, mime: blob.getContentType(), data: Utilities.base64Encode(blob.getBytes()) };
}
function makeScansPrivate() {
  var it = scanFolder_().getFiles(), n = 0, started = Date.now();
  while (it.hasNext() && Date.now() - started < 3e5) {
    var f = it.next();
    try {
      if (f.getSharingAccess() !== DriveApp.Access.PRIVATE) {
        f.setSharing(DriveApp.Access.PRIVATE, DriveApp.Permission.NONE);
        n++;
      }
    } catch (e) {
    }
  }
  return n + " page(s) made private" + (it.hasNext() ? " \u2014 more remain, run it again." : ".");
}
function theoryDeleteScan_(d) {
  var id = authCand_(d.token);
  var c = candidateRow_(id);
  if (c.theory_step === "theory_submitted") return { error: "Section B has been submitted." };
  var scans = c.theory_scans_json ? safeParse_(c.theory_scans_json, []) : [];
  var fid = String(d.fileId || "");
  var keep = scans.filter(function(s) {
    return s.fileId !== fid;
  });
  if (keep.length !== scans.length) {
    try {
      DriveApp.getFileById(fid).setTrashed(true);
    } catch (e) {
    }
    patchCandidate_(id, { theory_scans_json: JSON.stringify(keep) });
  }
  return { ok: true, scans: scansOut_(keep) };
}
function theorySubmit_(d) {
  var id = authCand_(d.token);
  var c = candidateRow_(id);
  if (!c.theory_started_at) return { error: "Open Section B first." };
  if (c.theory_step !== "theory_submitted") {
    patchCandidate_(id, { theory_step: "theory_submitted", theory_submitted_at: now_(), last_seen: now_() });
    logEvent_(d.auto ? "theory_submitted_time_up" : "theory_submitted", id, "");
  }
  return { ok: true };
}
function isFullyDone_(c, settings) {
  if (settingsFor_(c, settings).theory_enabled !== "0") return c.theory_step === "theory_submitted";
  return c.current_step === "submitted";
}
function finalizeTheoryIfExpired_(c, settings) {
  if (c && c.theory_step === "theory" && c.theory_started_at) {
    var dur = int_(settings.theory_duration_minutes, 60);
    if (Date.now() > new Date(c.theory_started_at).getTime() + dur * 6e4 + SUBMIT_GRACE_MS) {
      var at = c.theory_submitted_at || now_();
      patchCandidate_(c.exam_taker_id, { theory_step: "theory_submitted", theory_submitted_at: at });
      c.theory_step = "theory_submitted";
      c.theory_submitted_at = at;
    }
  }
  return c;
}
function computeMcqScore_(c, data, settings) {
  var ans = c.answers_json ? safeParse_(c.answers_json, {}) : {};
  var score = 0, max = 0, answered = 0;
  settings = settingsFor_(c, settings);
  paperFor_(c, data, settings).forEach(function(qid) {
    var q = data.questions[qid];
    if (!q) return;
    var m = questionMark_(q, settings);
    max = round2_(max + m);
    if (ans[qid]) {
      answered++;
      if (String(ans[qid]).toUpperCase() === String(q.correct_answer).toUpperCase()) score = round2_(score + m);
    }
  });
  return { score, max, answered };
}
function mcqScore_(d) {
  var id = authCand_(d.token);
  var c = candidateRow_(id);
  if (!c || c.current_step !== "submitted") return { error: "Submit Section A first." };
  var settings = settingsMap_();
  var reveal = settings.reveal_mcq_score !== "0";
  var sc = computeMcqScore_(c, candidateData_(), settings);
  return {
    ok: true,
    reveal,
    score: reveal ? sc.score : null,
    max_score: reveal ? sc.max : null,
    theory_enabled: settingsFor_(c, settings).theory_enabled !== "0"
  };
}
function adminLogin_(d) {
  var u = String(d.username || "").trim(), pw = String(d.password || "");
  var locked = throttleCheck_("staff", u);
  if (locked) return { error: locked };
  var s = staffMap_()[u.toLowerCase()];
  var v = s ? verifyPassword_(pw, s.password_hash) : { ok: false };
  if (!s || s.active === "0" || !v.ok) {
    throttleFail_("staff", u);
    return { error: "Invalid username or password." };
  }
  throttleClear_("staff", u);
  var patch = { last_login: now_() };
  if (v.legacy) patch.password_hash = makeHash_(pw);
  var mustChange = s.must_change === "1" || pw === "changeme";
  if (mustChange && s.must_change !== "1") patch.must_change = "1";
  patchStaff_(s.username, patch);
  var hashNow = patch.password_hash || s.password_hash;
  return {
    ok: true,
    token: makeToken_(s.role, s.username, hashNow),
    role: s.role,
    full_name: s.full_name || s.username,
    must_change: mustChange,
    default_password: pw === "changeme",
    time_zone: officialTz_()
  };
}
function changePassword_(d) {
  var t = authAny_(d.token, true);
  var s = staffMap_()[String(t.subject).toLowerCase()];
  var locked = throttleCheck_("staff", s ? s.username : "");
  if (locked) return { error: locked };
  if (!s || !verifyPassword_(String(d.current || ""), s.password_hash).ok) {
    if (s) throttleFail_("staff", s.username);
    return { error: "Your current password is incorrect." };
  }
  var err = weakPassword_(String(d.next || ""), s.username);
  if (err) return { error: err };
  if (String(d.next) === String(d.current)) return { error: "Choose a password different from the current one." };
  patchStaff_(s.username, { password_hash: makeHash_(String(d.next)), must_change: "" });
  logEvent_("password_changed", "", s.username);
  return { ok: true, signed_out: true };
}
function weakPassword_(pw, username) {
  if (pw.length < 10) return "The new password must be at least 10 characters.";
  if (!/[A-Za-z]/.test(pw) || !/[0-9]/.test(pw)) return "Use both letters and numbers in the new password.";
  var low = pw.toLowerCase();
  if (low === "changeme" || low.indexOf("password") >= 0 || username && low.indexOf(String(username).toLowerCase()) >= 0 || /^(.)\1+$/.test(pw))
    return "That password is too easy to guess.";
  return "";
}
function uploadCandidates_(d) {
  return withLock_(function() {
    return uploadCandidatesLocked_(d);
  });
}
function uploadCandidatesLocked_(d) {
  authStaff_(d.token);
  var rows = d.rows || [];
  var sh = sheet_(SHEETS.candidates);
  var existing = candidateData_();
  var appendRows = [], n = 0, skipped = 0, seenUser = {}, known = knownCourses_(), unknown = {};
  rows.forEach(function(r) {
    var id = pick_(r, ["exam_taker_id", "reg_no", "registration_number", "registration no", "student_id", "id"]);
    var un = pick_(r, ["username", "user name", "login"]);
    var pw = pick_(r, ["password", "pass", "pwd"]);
    var nm = pick_(r, ["full_name", "name", "fullname", "student name"]);
    if (!id || !un || !pw || !nm) {
      skipped++;
      return;
    }
    var crs = pick_(r, ["course", "course_unit", "course unit", "course_code", "course code", "paper"]);
    if (crs) {
      var sc = systemCourse_(known, crs);
      if (!sc) {
        skipped++;
        unknown[String(crs).trim()] = 1;
        return;
      }
      crs = sc;
    }
    var lu = un.toLowerCase();
    var owner = existing.byUser[lu];
    if (seenUser[lu] || owner && String(owner.exam_taker_id) !== id) {
      skipped++;
      return;
    }
    seenUser[lu] = 1;
    var vals = {
      exam_taker_id: id,
      username: un,
      password_hash: makeHash_(pw),
      full_name: nm,
      programme: pick_(r, ["programme", "program", "course_of_study", "programme of study"]),
      course: crs,
      year_of_study: pick_(r, ["year_of_study", "year", "year of study", "level", "semester"]),
      exam_venue: pick_(r, ["exam_venue", "venue", "campus", "exam_location", "location"])
    };
    if (existing.rowById[id]) patchCandidate_(id, vals);
    else appendRows.push(CAND_COLS.map(function(col) {
      if (col in vals) return vals[col];
      if (col === "current_step") return "password";
      if (col === "focus_loss" || col === "cam_events" || col === "rec_segments" || col === "rec_bytes") return 0;
      return "";
    }));
    n++;
  });
  if (appendRows.length) appendRows_(sh, appendRows, CAND_COLS.length);
  clearDataCache_();
  var note = notInSystemNote_(unknown);
  return { ok: true, processed: n, skipped, notes: note ? [note] : [], not_in_system: Object.keys(unknown) };
}
function uploadQuestions_(d) {
  return withLock_(function() {
    return uploadQuestionsLocked_(d);
  });
}
function uploadQuestionsLocked_(d) {
  var t = authAny_(d.token);
  var rows = d.rows || [];
  var sh = sheet_(SHEETS.questions);
  var v = sh.getDataRange().getValues(), idx = {}, ownerOf = {};
  for (var i = 1; i < v.length; i++) if (v[i][0] !== "") {
    idx[String(v[i][0])] = i + 1;
    ownerOf[String(v[i][0])] = String(v[i][10] || "");
  }
  var me = t.lecturer ? t.subject : "";
  var defCourse = String(d.course || "").trim();
  var known = knownCourses_(), unknown = {};
  var appends = [], n = 0, skipped = 0, notes = [], stampNow = now_();
  var placed = { A: 0, B: 0, C: 0, D: 0 }, keptOrder = 0, key = [];
  if (sh.getMaxColumns() < QUESTION_COLS.length) sh.insertColumnsAfter(sh.getMaxColumns(), QUESTION_COLS.length - sh.getMaxColumns());
  rows.forEach(function(r) {
    var qid = pick_(r, ["question_id", "questionid", "qid", "question id"]);
    var txt = pick_(r, ["question_text", "question", "text", "question text"]);
    var correct = String(pick_(r, ["correct_answer", "correct", "answer", "correct option"]) || "A").toUpperCase().charAt(0);
    var given = [pick_(r, ["option_a", "a", "optiona"]), pick_(r, ["option_b", "b", "optionb"]), pick_(r, ["option_c", "c", "optionc"]), pick_(r, ["option_d", "d", "optiond"])];
    if (!txt || "ABCD".indexOf(correct) < 0 || !given["ABCD".indexOf(correct)]) {
      skipped++;
      if (notes.length < 5) notes.push((qid || txt.slice(0, 40) || "A row") + ": the correct option has no text");
      return;
    }
    if (!qid) qid = newQuestionId_(idx);
    var course = pick_(r, ["course", "course_code", "course code", "course_unit"]) || defCourse;
    if (course) {
      var sc = systemCourse_(known, course);
      if (!sc) {
        skipped++;
        unknown[String(course).trim()] = 1;
        return;
      }
      course = sc;
    }
    if (t.lecturer && idx[qid] && ownerOf[qid].toLowerCase() !== me.toLowerCase()) {
      skipped++;
      if (notes.length < 5) notes.push(qid + " is already used by another examiner");
      return;
    }
    var lay = r._keep ? { opts: given, letter: correct, kept: true } : placeAnswer_(given, "ABCD".indexOf(correct), placed, idx[qid] > 0 ? v[idx[qid] - 1] : null);
    if (lay.kept && !r._keep) keptOrder++;
    if (!r._keep) placed[lay.letter]++;
    key.push({ question_id: qid, correct: lay.letter, answer: lay.opts["ABCD".indexOf(lay.letter)] });
    var row = [
      qid,
      pick_(r, ["area", "section", "topic", "subject"]) || "General",
      txt,
      lay.opts[0],
      lay.opts[1],
      lay.opts[2],
      lay.opts[3],
      lay.letter,
      mark_(pick_(r, ["marks", "mark", "score"]))
    ];
    if (idx[qid] > 0) {
      sh.getRange(idx[qid], 1, 1, row.length).setValues([row]);
      if (course) sh.getRange(idx[qid], 10).setValue(course);
      sh.getRange(idx[qid], 12).setValue(stampNow);
    } else if (!idx[qid]) {
      appends.push(row.concat([course, me, stampNow]));
      idx[qid] = -1;
      ownerOf[qid] = me;
    }
    n++;
  });
  if (appends.length) appendRows_(sh, appends, QUESTION_COLS.length);
  clearDataCache_();
  var un = notInSystemNote_(unknown);
  if (un) notes.unshift(un);
  if (keptOrder && notes.length < 6) notes.push(keptOrder + ' question(s) kept in your order because an option refers to the others ("all of the above", "both A and B" \u2026)');
  return { ok: true, processed: n, skipped, notes, placed, kept_order: keptOrder, key, not_in_system: Object.keys(unknown) };
}
var FIXED_ORDER_RE = /\b(all|none|both|neither)\s+of\s+(the\s+)?(above|these|them|the\s+options)\b|\b(options?\s+)?\(?[A-D]\)?\s*(,|and|&|or)\s*\(?[A-D]\)?(\s|$|\.|,)/i;
function placeAnswer_(given, ci, counts, existing) {
  var texts = given.map(function(x) {
    return String(x == null ? "" : x).trim();
  });
  var right = texts[ci], others = texts.filter(function(x, i) {
    return x !== "" && i !== ci;
  });
  var n = others.length + 1;
  var pad = function(list) {
    while (list.length < 4) list.push("");
    return list;
  };
  if (existing) {
    var ex = [3, 4, 5, 6].map(function(i) {
      return String(existing[i] == null ? "" : existing[i]).trim();
    });
    var exL = String(existing[7] || "").toUpperCase().charAt(0), exRight = ex["ABCD".indexOf(exL)];
    var sortKey = function(a) {
      return a.filter(String).sort().join("");
    };
    if (exRight === right && sortKey(ex) === sortKey(texts)) return { opts: ex, letter: exL, kept: false };
  }
  if (texts.some(function(x) {
    return FIXED_ORDER_RE.test(x);
  })) return { opts: texts, letter: "ABCD".charAt(ci), kept: true };
  var low = texts.filter(String).map(function(x) {
    return x.toLowerCase();
  });
  if (n === 2 && (low.sort().join() === "false,true" || low.sort().join() === "no,yes")) {
    var first = low.indexOf("true") >= 0 ? "true" : "yes";
    var ordered = texts.filter(String).sort(function(a, b) {
      return (a.toLowerCase() === first ? 0 : 1) - (b.toLowerCase() === first ? 0 : 1);
    });
    return { opts: pad(ordered), letter: "AB".charAt(ordered.indexOf(right)), kept: false };
  }
  var best = [], min = Infinity;
  for (var p = 0; p < n; p++) {
    var c = counts["ABCD".charAt(p)];
    if (c < min) {
      min = c;
      best = [p];
    } else if (c === min) best.push(p);
  }
  var pos = best[Math.floor(Math.random() * best.length)];
  var out = others.slice();
  out.splice(pos, 0, right);
  return { opts: pad(out), letter: "ABCD".charAt(pos), kept: false };
}
function uploadAssign_(d) {
  authStaff_(d.token);
  var rows = d.rows || [];
  var sh = sheet_(SHEETS.assign);
  var seen = {}, v = sh.getDataRange().getValues();
  for (var i = 1; i < v.length; i++) seen[v[i][0] + "|" + v[i][1]] = 1;
  var appends = [], n = 0;
  rows.forEach(function(r) {
    var id = pick_(r, ["exam_taker_id", "reg_no", "registration_number", "student_id", "id"]);
    if (!id) return;
    var list = pick_(r, ["question_ids", "questionids", "questions"]);
    if (list) {
      String(list).split(/[;,|\s]+/).filter(String).forEach(function(qid2, o) {
        if (!seen[id + "|" + qid2]) {
          appends.push([id, qid2, o]);
          seen[id + "|" + qid2] = 1;
          n++;
        }
      });
    } else {
      var qid = pick_(r, ["question_id", "questionid", "qid", "question id"]);
      if (qid && !seen[id + "|" + qid]) {
        appends.push([id, qid, int_(pick_(r, ["sort_order", "order"]), 0)]);
        seen[id + "|" + qid] = 1;
        n++;
      }
    }
  });
  if (appends.length) appendRows_(sh, appends, 3);
  clearDataCache_();
  return { ok: true, processed: n };
}
function uploadTheory_(d) {
  authStaff_(d.token);
  var rows = d.rows || [];
  var sh = theorySheet_();
  var idx = indexBy_(sh, "theory_id");
  var appends = [], n = 0;
  rows.forEach(function(r) {
    var tid = pick_(r, ["theory_id", "id", "qid", "question_id"]);
    var prompt = pick_(r, ["prompt", "question", "question_text", "text"]);
    if (!tid || !prompt) return;
    var mm = pick_(r, ["max_marks", "marks", "max", "max marks"]);
    mm = mm === "" || mm == null ? 10 : Math.max(0, num_(mm, 0));
    var row = [tid, pick_(r, ["number", "no", "q"]) || n + 1, prompt, pick_(r, ["model_answer", "answer", "marking_guide", "model answer"]), mm];
    if (idx[tid]) sh.getRange(idx[tid], 1, 1, row.length).setValues([row]);
    else appends.push(row);
    n++;
  });
  if (appends.length) appendRows_(sh, appends, 5);
  return { ok: true, processed: n };
}
function uploadTheoryAssign_(d) {
  authStaff_(d.token);
  var rows = d.rows || [];
  var sh = ensureSheet_(SpreadsheetApp.getActiveSpreadsheet(), SHEETS.theoryassign, ["exam_taker_id", "theory_ids"]);
  var idx = indexBy_(sh, "exam_taker_id");
  var appends = [], n = 0;
  rows.forEach(function(r) {
    var id = pick_(r, ["exam_taker_id", "reg_no", "registration_number", "student_id", "id"]);
    var ids = pick_(r, ["theory_ids", "theory_id", "question_ids", "questions", "ids"]);
    if (!id || !ids) return;
    var row = [id, String(ids).split(/[;,\|\s]+/).filter(function(x) {
      return x;
    }).join(" ")];
    if (idx[id]) sh.getRange(idx[id], 1, 1, 2).setValues([row]);
    else appends.push(row);
    n++;
  });
  if (appends.length) appendRows_(sh, appends, 2);
  return { ok: true, processed: n };
}
function bankSummary_(d) {
  authStaff_(d.token);
  var data = candidateData_();
  var areas = {};
  Object.keys(data.byArea).forEach(function(a) {
    areas[a] = data.byArea[a].length;
  });
  return {
    ok: true,
    candidates: Object.keys(data.byId).length,
    questions: data.qorder.length,
    areas,
    assigned: Object.keys(data.assignById).length,
    theory: theoryQuestionRows_().length
  };
}
function monitor_(d) {
  var t = authAny_(d.token), all = monitorSummary_();
  if (!t.lecturer) return all;
  var me = String(t.subject).toLowerCase();
  var rows = all.rows.filter(function(r) {
    return (r.lects || []).indexOf(me) >= 0;
  });
  return { ok: true, stats: statsFromRows_(rows), rows };
}
function statsFromRows_(rows) {
  var stats = { total: 0, logged_in: 0, online: 0, in_progress: 0, submitted: 0, theory: 0, completed: 0, left: 0, cam_alerts: 0, integrity_alerts: 0, students: 0 };
  var uniq = {};
  rows.forEach(function(r) {
    stats.total++;
    uniq[r.student_id || r.exam_taker_id] = 1;
    if (r.logged_in_at) stats.logged_in++;
    if (r.online) stats.online++;
    statusBucket_({ current_step: r.step, theory_step: r.theory_step, logged_in_at: r.logged_in_at }, r.online, stats);
    var active = r.step === "exam" || r.theory_step === "theory";
    if (active && r.cam_status && r.cam_status !== "on") stats.cam_alerts++;
    if ((r.flags || []).some(function(x) {
      return x.level === "high";
    })) stats.integrity_alerts++;
  });
  stats.students = Object.keys(uniq).length;
  return stats;
}
function staffNames_() {
  var m = staffMap_(), out = {};
  Object.keys(m).forEach(function(k) {
    out[k] = m[k].full_name || m[k].username;
  });
  return out;
}
function statusBucket_(c, online, stats) {
  if (c.theory_step === "theory_submitted") stats.completed++;
  else if (c.theory_step === "theory") stats.theory++;
  else if (c.current_step === "submitted") stats.submitted++;
  else if (c.current_step === "exam" && online) stats.in_progress++;
  else if (["instructions", "photo", "confirm", "exam_info", "exam"].indexOf(c.current_step) >= 0 && !online && c.logged_in_at) stats.left++;
}
function monitorSummary_() {
  var cache = CacheService.getScriptCache();
  var cached = cache.get("summary");
  if (cached) return JSON.parse(cached);
  var data = candidateData_(), settings = settingsMap_(), nowMs = Date.now(), names = staffNames_();
  var rows = [], stats = { total: 0, logged_in: 0, online: 0, in_progress: 0, submitted: 0, theory: 0, completed: 0, left: 0, cam_alerts: 0, integrity_alerts: 0 };
  var allRows = overlayLive_(allCandidateRows_()), groups = geoGroups_(allRows);
  allRows.forEach(function(c) {
    finalizeTheoryIfExpired_(c, settings);
    stats.total++;
    if (c.logged_in_at) stats.logged_in++;
    var online = !!(c.last_seen && nowMs - new Date(c.last_seen).getTime() < ONLINE_WINDOW_MS);
    if (online) stats.online++;
    statusBucket_(c, online, stats);
    var active = c.current_step === "exam" || c.theory_step === "theory";
    if (active && c.cam_status && c.cam_status !== "on") stats.cam_alerts++;
    var sc = computeMcqScore_(c, data, settings);
    rows.push({
      exam_taker_id: c.exam_taker_id,
      full_name: c.full_name,
      course: c.course,
      programme: c.programme,
      step: c.current_step,
      owner: c.owner || "",
      lects: rowLects_(data, c),
      owner_name: lectNames_(names, rowLects_(data, c)),
      student_id: c.student_id || "",
      last_seen: c.last_seen || "",
      online,
      answered: sc.answered,
      total_q: paperFor_(c, data, settings).length,
      theory_step: c.theory_step || "",
      focus_loss: int_(c.focus_loss, 0),
      cam_status: c.cam_status || "",
      cam_events: int_(c.cam_events, 0),
      rec_segments: int_(c.rec_segments, 0),
      last_rec_at: c.last_rec_at || "",
      last_snap_at: c.last_snap_at || "",
      has_photo: !!c.photo_file_id,
      flags: integrityFlags_(c, settings, nowMs, groups),
      geo_lat: c.geo_lat,
      geo_lng: c.geo_lng,
      geo_status: c.geo_status,
      logged_in_at: c.logged_in_at
    });
    if (rows[rows.length - 1].flags.some(function(x) {
      return x.level === "high";
    })) stats.integrity_alerts++;
  });
  rows.sort(function(a, b) {
    return String(a.full_name).localeCompare(String(b.full_name)) || String(a.course).localeCompare(String(b.course));
  });
  var uq = {};
  rows.forEach(function(r) {
    uq[r.student_id || r.exam_taker_id] = 1;
  });
  stats.students = Object.keys(uq).length;
  var out = { ok: true, stats, rows };
  try {
    cache.put("summary", JSON.stringify(out), SUMMARY_CACHE_SECONDS);
  } catch (e) {
  }
  return out;
}
function observeData_(d) {
  var t = String(d.token || "");
  var obs = observerMap_()[t];
  if (!observerOk_(obs)) return { error: "This observer link is not valid, has been revoked or has expired." };
  var showScores = obs.show_scores === "1", cacheKey = "obsdata:" + (showScores ? 1 : 0);
  var cache = CacheService.getScriptCache();
  var cached = cache.get(cacheKey);
  if (cached) return JSON.parse(cached);
  var data = candidateData_(), settings = settingsMap_(), nowMs = Date.now(), names = staffNames_();
  var rows = [], stats = { total: 0, logged_in: 0, online: 0, in_progress: 0, submitted: 0, theory: 0, completed: 0, left: 0 };
  overlayLive_(allCandidateRows_()).forEach(function(c) {
    finalizeTheoryIfExpired_(c, settings);
    stats.total++;
    if (c.logged_in_at) stats.logged_in++;
    var online = !!(c.last_seen && nowMs - new Date(c.last_seen).getTime() < ONLINE_WINDOW_MS);
    if (online) stats.online++;
    statusBucket_(c, online, stats);
    var sc = computeMcqScore_(c, data, settings);
    var tt = c.theory_total !== "" && c.theory_total != null ? num_(c.theory_total, 0) : "";
    var row = {
      exam_taker_id: c.exam_taker_id,
      full_name: c.full_name,
      course: c.course,
      programme: c.programme,
      step: c.current_step,
      owner: c.owner || "",
      lects: rowLects_(data, c),
      owner_name: lectNames_(names, rowLects_(data, c)),
      student_id: c.student_id || "",
      answered: sc.answered,
      total_q: paperFor_(c, data, settings).length,
      last_seen: c.last_seen || "",
      theory_step: c.theory_step || "",
      online,
      focus_loss: int_(c.focus_loss, 0),
      cam_status: c.cam_status || "",
      cam_events: int_(c.cam_events, 0),
      rec_segments: int_(c.rec_segments, 0),
      has_photo: !!c.photo_file_id,
      logged_in_at: c.logged_in_at
    };
    if (showScores) {
      row.score = sc.score;
      row.max_score = sc.max;
      row.theory_total = tt;
      row.grand_total = tt === "" ? sc.score : round2_(sc.score + tt);
    }
    rows.push(row);
  });
  rows.sort(function(a, b) {
    return String(a.full_name).localeCompare(String(b.full_name));
  });
  var cat = catalogue_(null), lect = lecturerSummaries_(rows, data, cat);
  stats.lecturers = lect.length;
  var uq = {};
  rows.forEach(function(r) {
    uq[r.student_id || r.exam_taker_id] = 1;
  });
  stats.students = Object.keys(uq).length;
  var up = examUploadReport_(null);
  var out = {
    ok: true,
    stats,
    rows,
    title: settings.exam_title || "",
    lecturers: lect,
    uploads: up,
    programmes: progSummary_(cat, names),
    courses: unitSummary_(cat, names),
    show_scores: showScores
  };
  try {
    cache.put(cacheKey, JSON.stringify(out), SUMMARY_CACHE_SECONDS);
  } catch (e) {
  }
  return out;
}
function results_(d) {
  var tok = String(d.token || "");
  if (isStaff_(tok)) return { ok: true, rows: computeResults_() };
  var lt = null;
  try {
    lt = authAny_(tok);
  } catch (e) {
  }
  if (lt && lt.lecturer) {
    var me = String(lt.subject).toLowerCase();
    return { ok: true, rows: computeResults_().filter(function(r) {
      return (r.lects || []).indexOf(me) >= 0;
    }) };
  }
  return { error: "Not authorised." };
}
function computeResults_() {
  var data = candidateData_(), settings = settingsMap_(), out = [], names = staffNames_(), nowMs = Date.now();
  var allRows = allCandidateRows_(), groups = geoGroups_(allRows);
  allRows.forEach(function(c) {
    finalizeTheoryIfExpired_(c, settings);
    var sc = computeMcqScore_(c, data, settings);
    var tt = c.theory_total !== "" && c.theory_total != null ? num_(c.theory_total, 0) : "";
    var scans = c.theory_scans_json ? safeParse_(c.theory_scans_json, []) : [];
    out.push({
      exam_taker_id: c.exam_taker_id,
      full_name: c.full_name,
      programme: c.programme,
      course: c.course,
      year_of_study: c.year_of_study,
      exam_venue: c.exam_venue,
      owner: c.owner || "",
      lects: rowLects_(data, c),
      owner_name: lectNames_(names, rowLects_(data, c)),
      student_id: c.student_id || "",
      step: c.current_step,
      answered: sc.answered,
      total_q: paperFor_(c, data, settings).length,
      score: sc.score,
      max_score: sc.max,
      theory_step: c.theory_step || "",
      theory_scans: scans.length,
      theory_total: tt,
      grand_total: tt === "" ? sc.score : round2_(sc.score + tt),
      focus_loss: int_(c.focus_loss, 0),
      cam_events: int_(c.cam_events, 0),
      rec_segments: int_(c.rec_segments, 0),
      has_photo: !!c.photo_file_id,
      geo: c.geo_lat && c.geo_lng ? c.geo_lat + "," + c.geo_lng : "",
      logged_in_at: c.logged_in_at,
      started_at: c.started_at,
      submitted_at: c.submitted_at,
      theory_submitted_at: c.theory_submitted_at,
      integrity: integrityFlags_(c, settings, nowMs, groups).concat(pastFlags_(c)).map(function(x) {
        return x.text;
      }).filter(function(x, i, a) {
        return a.indexOf(x) === i;
      }).join("; ")
    });
  });
  out.sort(function(a, b) {
    return String(a.full_name).localeCompare(String(b.full_name));
  });
  return out;
}
function marking_(d) {
  authStaff_(d.token);
  var bank = theoryQuestionRows_(), assignMap = theoryAssignMap_();
  var rows = allCandidateRows_().filter(function(c) {
    return c.theory_step || c.theory_scans_json && safeParse_(c.theory_scans_json, []).length;
  }).map(function(c) {
    return {
      exam_taker_id: c.exam_taker_id,
      full_name: c.full_name,
      theory_step: c.theory_step || "",
      scans: scansOut_(c.theory_scans_json ? safeParse_(c.theory_scans_json, []) : []),
      scores: c.theory_scores_json ? safeParse_(c.theory_scores_json, {}) : {},
      theory_total: c.theory_total !== "" && c.theory_total != null ? c.theory_total : "",
      questions: theoryQuestionsFor_(c.exam_taker_id, bank, assignMap)
    };
  });
  rows.sort(function(a, b) {
    return String(a.full_name).localeCompare(String(b.full_name));
  });
  return { ok: true, has_bank: bank.length > 0, rows };
}
function saveTheoryScore_(d) {
  authStaff_(d.token);
  var id = String(d.exam_taker_id || "");
  if (!candidateRow_(id)) return { error: "Candidate not found." };
  if (d.overall !== void 0 && d.overall !== null && d.overall !== "") {
    var ov = Math.max(0, num_(d.overall, 0));
    patchCandidate_(id, { theory_scores_json: JSON.stringify({ overall: ov }), theory_total: ov });
    logEvent_("theory_marked", id, "overall " + ov);
    return { ok: true, total: ov };
  }
  var scores = d.scores || {}, maxById = {}, total = 0;
  theoryQuestionRows_().forEach(function(q) {
    maxById[q.theory_id] = q.max_marks;
  });
  Object.keys(scores).forEach(function(tid) {
    var mk = Math.max(0, num_(scores[tid], 0));
    if (maxById[tid] != null) mk = Math.min(mk, maxById[tid]);
    scores[tid] = mk;
    total = round2_(total + mk);
  });
  patchCandidate_(id, { theory_scores_json: JSON.stringify(scores), theory_total: total });
  logEvent_("theory_marked", id, "total " + total);
  return { ok: true, total };
}
function activityLog_(d) {
  authStaff_(d.token);
  var rows = activityRecent_(ACTIVITY_DOWNLOAD_MAX).map(function(r) {
    return { at: r[0], event: r[1], exam_taker_id: r[2], detail: r[3] };
  });
  return { ok: true, rows };
}
function getSettings_(d) {
  authAny_(d.token);
  return { ok: true, settings: settingsMap_(), time_zone: officialTz_() };
}
function saveSettings_(d) {
  authStaff_(d.token);
  var s = d.settings || {}, allowed = defaultSettings_();
  var sh = sheet_(SHEETS.settings), v = sh.getDataRange().getValues(), idx = {};
  for (var i = 1; i < v.length; i++) idx[v[i][0]] = i + 1;
  if (s.paper_size !== void 0) {
    var ps = String(s.paper_size).trim();
    if (ps !== "" && !/^\d+$/.test(ps)) return { error: "Questions per paper must be a whole number (or blank for all questions)." };
    s.paper_size = ps === "" || ps === "0" ? "" : String(Math.min(500, parseInt(ps, 10)));
  }
  if (s.mark_per_question !== void 0) {
    var mp = String(s.mark_per_question).trim().replace(",", ".");
    if (/^0+(\.0+)?$/.test(mp)) mp = "";
    if (mp !== "" && !(/^\d+(\.\d+)?$/.test(mp) && +mp > 0 && +mp <= 100)) return { error: "Marks per question must be a number above 0 and up to 100, e.g. 1, 2 or 0.5 (or blank for each question's own marks)." };
    s.mark_per_question = mp === "" ? "" : String(round2_(+mp));
  }
  Object.keys(s).forEach(function(k) {
    if (!(k in allowed)) return;
    if (idx[k]) sh.getRange(idx[k], 2).setValue(s[k]);
    else sh.appendRow([k, s[k]]);
  });
  clearDataCache_();
  return { ok: true, short: paperShortfall_(), impact: paperImpact_() };
}
function paperImpact_() {
  var settings = settingsMap_(), n = paperSize_(settings), out = { completed: 0, writing: 0, assigned: 0 };
  if (!n) return out;
  var data = candidateData_();
  allCandidateRows_().forEach(function(c) {
    if (isPracticeSitting_(c)) return;
    var frozen = c.paper_ids ? safeParse_(c.paper_ids, null) : null;
    if (c.started_at && frozen && frozen.length > n) {
      if (mcqCompleted_(c, settings)) out.completed++;
      else out.writing++;
    } else if (!c.started_at && (data.assignById[c.exam_taker_id] || []).length > n) out.assigned++;
  });
  return out;
}
function paperShortfall_() {
  var settings = settingsMap_(), n = paperSize_(settings);
  if (!n) return [];
  var data = candidateData_(), seen = {}, out = [];
  allCandidateRows_().forEach(function(c) {
    var k = normCourse_(c.course) || "(no course)";
    if (seen[k] || c.started_at || isPracticeSitting_(c) || (data.assignById[c.exam_taker_id] || []).length) return;
    seen[k] = 1;
    var have = paperPool_(c.exam_taker_id, data, settings).length;
    if (have < n) out.push({ course: c.course || "(no course)", available: have });
  });
  out.sort(function(a, b) {
    return String(a.course).localeCompare(String(b.course));
  });
  return out;
}
function createAdmin_(d) {
  requireSuper_(d.token);
  var u = String(d.username || "").trim(), p = String(d.password || "");
  if (!u || p.length < 8) return { error: "Username required; password at least 8 characters (they choose their own at first sign-in)." };
  if (staffMap_()[u.toLowerCase()]) return { error: "Username already taken." };
  appendRows_(sheet_(SHEETS.staff), [[u, makeHash_(p), "admin", String(d.full_name || ""), "1", now_(), "", "", "", "1"]], STAFF_COLS.length);
  clearStaffCache_();
  return { ok: true };
}
function listAdmins_(d) {
  requireSuper_(d.token);
  var v = sheet_(SHEETS.staff).getDataRange().getValues(), out = [];
  for (var i = 1; i < v.length; i++) if (v[i][2] === "admin")
    out.push({ username: v[i][0], full_name: v[i][3], active: String(v[i][4]) !== "0", last_login: v[i][6] });
  return { ok: true, rows: out };
}
function toggleAdmin_(d) {
  requireSuper_(d.token);
  var sh = sheet_(SHEETS.staff), v = sh.getDataRange().getValues();
  for (var i = 1; i < v.length; i++) if (v[i][0] === d.username && v[i][2] === "admin") {
    sh.getRange(i + 1, 5).setValue(String(v[i][4]) === "0" ? "1" : "0");
    clearStaffCache_();
    return { ok: true };
  }
  return { error: "Admin not found." };
}
function createObserver_(d) {
  requireSuper_(d.token);
  var tok = Utilities.getUuid().replace(/-/g, "") + Utilities.getUuid().replace(/-/g, "").slice(0, 16);
  var days = Math.max(1, Math.min(90, int_(d.days, OBSERVER_DEFAULT_DAYS)));
  var exp = new Date(Date.now() + days * 864e5).toISOString();
  appendRows_(sheet_(SHEETS.observers), [[tok, String(d.label || "Observer").slice(0, 120), "1", now_(), exp, d.show_scores ? "1" : "0"]], OBSERVER_COLS.length);
  return { ok: true, token: tok, expires_at: exp };
}
function listObservers_(d) {
  requireSuper_(d.token);
  var v = sheet_(SHEETS.observers).getDataRange().getValues(), out = [];
  var m = observerMap_();
  for (var i = 1; i < v.length; i++) {
    if (!v[i][0]) continue;
    var o = m[v[i][0]];
    out.push({
      token: v[i][0],
      label: v[i][1],
      active: String(v[i][2]) !== "0",
      created_at: v[i][3],
      expires_at: observerExpiry_(o),
      expired: Date.now() > new Date(observerExpiry_(o)).getTime(),
      show_scores: o.show_scores === "1"
    });
  }
  return { ok: true, rows: out };
}
function toggleObserver_(d) {
  requireSuper_(d.token);
  var sh = sheet_(SHEETS.observers), v = sh.getDataRange().getValues();
  for (var i = 1; i < v.length; i++) if (v[i][0] === d.observer) {
    var o = observerMap_()[v[i][0]], expired = Date.now() > new Date(observerExpiry_(o)).getTime();
    var turnOn = String(v[i][2]) === "0" || expired;
    sh.getRange(i + 1, 3).setValue(turnOn ? "1" : "0");
    if (turnOn) sh.getRange(i + 1, 5).setValue(new Date(Date.now() + Math.max(1, Math.min(90, int_(d.days, OBSERVER_DEFAULT_DAYS))) * 864e5).toISOString());
    CacheService.getScriptCache().removeAll(["obsdata:0", "obsdata:1"]);
    return { ok: true };
  }
  return { error: "Observer link not found." };
}
function normCourse_(s) {
  return String(s || "").toLowerCase().replace(/\s+/g, " ").trim();
}
function courseKey_(s) {
  return normCourse_(s).replace(/ /g, "");
}
function knownCourses_() {
  var map = {}, v = catSheet_(SHEETS.courses, COURSE_COLS).getDataRange().getValues();
  for (var i = 1; i < v.length; i++) {
    var code = String(v[i][1] || "").trim();
    if (code && !map[courseKey_(code)]) map[courseKey_(code)] = code;
  }
  map[courseKey_("PRACTICE")] = map[courseKey_("PRACTICE")] || "PRACTICE";
  allCandidateRows_().forEach(function(c) {
    if (String(c.exam_venue) === PRACTICE_VENUE && c.course && !map[courseKey_(c.course)]) map[courseKey_(c.course)] = String(c.course).trim();
  });
  return map;
}
function systemCourse_(known, given) {
  var k = courseKey_(given);
  if (!k) return "";
  if (known[k]) return known[k];
  var best = "";
  Object.keys(known).forEach(function(key) {
    if (ltiUnitMatch_(given, known[key]) && known[key].length > best.length) best = known[key];
  });
  return best;
}
var NOT_IN_SYSTEM_HINT = "add the course unit first (Programmes & courses, or import the KIU workbook), then upload again";
function notInSystemNote_(list) {
  var names = Object.keys(list);
  return names.length ? "Not in the system, so not uploaded: course unit" + (names.length > 1 ? "s " : " ") + names.slice(0, 8).join(", ") + (names.length > 8 ? " \u2026" : "") + " \u2014 " + NOT_IN_SYSTEM_HINT : "";
}
function randPassword_() {
  var abc = "ABCDEFGHJKLMNPQRSTUVWXYZabcdefghjkmnpqrstuvwxyz23456789", u = Utilities.getUuid().replace(/-/g, ""), out = "";
  for (var i = 0; i < 8; i++) out += abc.charAt(parseInt(u.substr(i * 2, 2), 16) % abc.length);
  return out;
}
function newQuestionId_(idx) {
  var id;
  do {
    id = "Q" + Utilities.getUuid().replace(/-/g, "").slice(0, 7).toUpperCase();
  } while (idx && idx[id]);
  return id;
}
function catSheet_(name, cols) {
  return ensureSheet_(SpreadsheetApp.getActiveSpreadsheet(), name, cols);
}
function removeRowsWhere_(sh, dropFn) {
  return withLock_(function() {
    var v = sh.getDataRange().getValues();
    if (v.length < 2) return 0;
    var keep = [v[0]], removed = 0;
    for (var i = 1; i < v.length; i++) {
      if (v[i][0] !== "" && dropFn(v[i])) removed++;
      else keep.push(v[i]);
    }
    if (!removed) return 0;
    var width = v[0].length, blank = [];
    for (var b = 0; b < width; b++) blank.push("");
    while (keep.length < v.length) keep.push(blank.slice());
    sh.getRange(1, 1, v.length, width).setValues(keep);
    return removed;
  });
}
function catalogue_(owner) {
  var me = owner ? String(owner).toLowerCase() : null;
  var pv = catSheet_(SHEETS.programmes, PROGRAMME_COLS).getDataRange().getValues();
  var cv = catSheet_(SHEETS.courses, COURSE_COLS).getDataRange().getValues();
  var programmes = [], courses = [];
  for (var i = 1; i < pv.length; i++) if (pv[i][1] && (!me || String(pv[i][0]).toLowerCase() === me))
    programmes.push({ owner: String(pv[i][0]), programme: String(pv[i][1]) });
  var data = candidateData_(), stu = {}, stuPC = {}, qn = {};
  allCandidateRows_().forEach(function(c) {
    var k = String(c.owner || "").toLowerCase() + "|" + normCourse_(c.course);
    if (c.owner && lecturersFor_(data, c.programme, c.course).indexOf(String(c.owner).toLowerCase()) < 0) stu[k] = (stu[k] || 0) + 1;
    var pk = normCourse_(c.programme) + "|" + normCourse_(c.course);
    stuPC[pk] = (stuPC[pk] || 0) + 1;
  });
  Object.keys(data.questions).forEach(function(qid) {
    var q = data.questions[qid];
    var k = String(q.owner || "").toLowerCase() + "|" + normCourse_(q.course);
    qn[k] = (qn[k] || 0) + 1;
  });
  for (var j = 1; j < cv.length; j++) if (cv[j][1] && (!me || String(cv[j][0]).toLowerCase() === me)) {
    var key = String(cv[j][0]).toLowerCase() + "|" + normCourse_(cv[j][1]);
    var pkey = normCourse_(cv[j][3]) + "|" + normCourse_(cv[j][1]);
    var lectsHere = data.courseLects[pkey] || [], qcount = 0;
    lectsHere.concat(cv[j][0] ? [String(cv[j][0]).toLowerCase()] : []).forEach(function(o, ix, arr) {
      if (arr.indexOf(o) === ix) qcount += qn[o + "|" + normCourse_(cv[j][1])] || 0;
    });
    courses.push({
      owner: String(cv[j][0]),
      course_code: String(cv[j][1]),
      course_title: String(cv[j][2] || ""),
      programme: String(cv[j][3] || ""),
      students: (cv[j][3] ? stuPC[pkey] || 0 : 0) + (cv[j][0] ? stu[key] || 0 : 0),
      questions: qcount,
      own_questions: qn[key] || 0
    });
  }
  programmes.sort(function(a, b) {
    return a.programme.localeCompare(b.programme);
  });
  courses.sort(function(a, b) {
    return a.course_code.localeCompare(b.course_code);
  });
  return { programmes, courses };
}
function lecturerSummaries_(monRows, data, cat) {
  var m = staffMap_(), out = {};
  Object.keys(m).forEach(function(k) {
    if (m[k].role !== "lecturer") return;
    out[k] = {
      username: m[k].username,
      full_name: m[k].full_name || m[k].username,
      email: m[k].email,
      department: m[k].department,
      active: m[k].active !== "0",
      last_login: m[k].last_login,
      created_at: m[k].created_at,
      students: 0,
      online: 0,
      writing: 0,
      submitted: 0,
      questions: (data.qByOwner[k] || []).length,
      programmes: 0,
      courses: 0
    };
  });
  monRows.forEach(function(r) {
    (r.lects || []).forEach(function(u) {
      var L = out[u];
      if (!L) return;
      L.students++;
      if (r.online) L.online++;
      if ((r.step === "exam" || r.theory_step === "theory") && r.online) L.writing++;
      if (r.step === "submitted") L.submitted++;
    });
  });
  cat.programmes.forEach(function(p) {
    var L = out[p.owner.toLowerCase()];
    if (L) L.programmes++;
  });
  cat.courses.forEach(function(c) {
    var L = out[c.owner.toLowerCase()];
    if (L) L.courses++;
  });
  return Object.keys(out).map(function(k) {
    return out[k];
  }).sort(function(a, b) {
    return String(a.full_name).localeCompare(String(b.full_name));
  });
}
function unitSummary_(cat, names) {
  var by = {}, out = [];
  cat.courses.forEach(function(c) {
    var k = c.programme + "|" + c.course_code;
    var u = by[k];
    if (!u) {
      u = by[k] = { course_code: c.course_code, course_title: c.course_title, programme: c.programme, lecturers: [], students: c.students, questions: 0 };
      out.push(u);
    }
    if (c.owner) u.lecturers.push(names[c.owner.toLowerCase()] || c.owner);
    u.questions = Math.max(u.questions, c.questions);
    u.students = Math.max(u.students, c.students);
  });
  out.forEach(function(u) {
    u.owner_name = u.lecturers.length ? u.lecturers.join(", ") : "No lecturer assigned";
  });
  out.sort(function(a, b) {
    return (a.programme + a.course_code).localeCompare(b.programme + b.course_code);
  });
  return out;
}
function progSummary_(cat, names) {
  var by = {};
  unitSummary_(cat, names).forEach(function(u) {
    var p = by[u.programme] = by[u.programme] || { programme: u.programme, units: 0, lect: {}, ready: 0 };
    p.units++;
    if (u.questions) p.ready++;
    u.lecturers.forEach(function(n) {
      p.lect[n] = 1;
    });
  });
  cat.programmes.forEach(function(p) {
    if (!by[p.programme]) by[p.programme] = { programme: p.programme, units: 0, lect: {}, ready: 0 };
  });
  return Object.keys(by).sort().map(function(k) {
    var p = by[k];
    return { programme: p.programme, units: p.units, units_ready: p.ready, lecturers: Object.keys(p.lect).length, owner_name: Object.keys(p.lect).length + " lecturer(s)" };
  });
}
function myOverview_(d) {
  var t = authAny_(d.token);
  var data = candidateData_(), cat = catalogue_(t.lecturer ? t.subject : null);
  var mon = monitor_(d);
  return {
    ok: true,
    role: t.role,
    full_name: t.full_name,
    stats: mon.stats,
    questions: t.lecturer ? (data.qByOwner[String(t.subject).toLowerCase()] || []).length : Object.keys(data.questions).length,
    programmes: uniqCount_(cat.programmes, function(p) {
      return p.programme;
    }),
    courses: uniqCount_(cat.courses, function(c) {
      return c.programme + "|" + c.course_code;
    })
  };
}
function uniqCount_(arr, keyFn) {
  var s = {};
  arr.forEach(function(x) {
    s[String(keyFn(x)).toLowerCase()] = 1;
  });
  return Object.keys(s).length;
}
function studentView_(c, names, nowMs, data, settings, studs) {
  if (c.student_id && studs) {
    var su = studs.byId[String(c.student_id)];
    if (su) {
      c.username = su.username;
      c.email = c.email || su.email;
      c.phone = c.phone || su.phone;
    }
  }
  var online = !!(c.last_seen && nowMs - new Date(c.last_seen).getTime() < ONLINE_WINDOW_MS);
  var tm = timingFor_(c, settings);
  return {
    exam_taker_id: c.exam_taker_id,
    username: c.username,
    full_name: c.full_name,
    programme: c.programme,
    course: c.course,
    year_of_study: c.year_of_study,
    exam_venue: c.exam_venue,
    email: c.email || "",
    phone: c.phone || "",
    owner: c.owner || "",
    lects: rowLects_(data, c),
    owner_name: lectNames_(names, rowLects_(data, c)),
    student_id: c.student_id || "",
    course_title: data.courseTitle[normCourse_(c.course)] || "",
    step: c.current_step || "",
    theory_step: c.theory_step || "",
    online,
    last_seen: c.last_seen || "",
    assigned: (data.assignById[c.exam_taker_id] || []).length,
    paper: paperFor_(c, data, settings).length,
    exam_minutes: tm.duration,
    exam_opens_at: tm.opens_at,
    exam_last_start: tm.last_start_at
  };
}
function listStudents_(d) {
  var t = authAny_(d.token);
  var names = staffNames_(), nowMs = Date.now(), data = candidateData_(), settings = settingsMap_();
  var studs = studentMap_();
  var rows = overlayLive_(allCandidateRows_().filter(function(c) {
    return canSee_(t, c);
  })).map(function(c) {
    var v = studentView_(c, names, nowMs, data, settings, studs);
    v.editable = canEdit_(t, c);
    return v;
  });
  rows.sort(function(a, b) {
    return String(a.full_name).localeCompare(String(b.full_name));
  });
  var lect = [];
  if (!t.lecturer) {
    var m = staffMap_();
    Object.keys(m).forEach(function(k) {
      if (m[k].role === "lecturer") lect.push({ username: m[k].username, full_name: m[k].full_name || m[k].username });
    });
  }
  return { ok: true, rows, lecturers: lect };
}
function saveStudents_(d) {
  var t = authAny_(d.token);
  return withLock_(function() {
    clearDataCache_();
    var data = candidateData_(), staff = staffMap_(), results = [], appends = [], known = knownCourses_();
    var sh = sheet_(SHEETS.candidates);
    (d.rows || []).slice(0, 2e3).forEach(function(r) {
      var id = String(pick_(r, ["exam_taker_id", "reg_no", "registration_number", "registration no", "student_id", "id"]) || "").trim();
      var nm = pick_(r, ["full_name", "name", "fullname", "student name"]);
      var un = String(pick_(r, ["username", "user name", "login"]) || "").trim();
      var pw = String(r.password != null ? r.password : "").trim();
      if (!id || !nm) {
        results.push({ exam_taker_id: id, status: "skipped", reason: "Registration number and full name are required." });
        return;
      }
      if (!un) un = id;
      var crsIn = pick_(r, ["course", "course_code", "course code", "course_unit", "paper"]), crsOk = crsIn ? systemCourse_(known, crsIn) : "";
      if (crsIn && !crsOk) {
        results.push({ exam_taker_id: id, status: "skipped", reason: 'Course unit "' + String(crsIn).trim() + '" is not in the system \u2014 ' + NOT_IN_SYSTEM_HINT + "." });
        return;
      }
      if (data.rowById[id] === -1) {
        results.push({ exam_taker_id: id, status: "skipped", reason: "Listed twice in this file." });
        return;
      }
      var existing = data.rowById[id] ? candidateRow_(id) : null;
      if (existing && !canEdit_(t, existing)) {
        results.push({ exam_taker_id: id, status: "skipped", reason: existing.student_id ? "University-registered students are changed by the examinations office." : "This registration number belongs to another examiner's student." });
        return;
      }
      if (existing && existing.student_id) {
        var up = {
          full_name: nm,
          email: pick_(r, ["email", "e-mail", "mail"]),
          phone: pick_(r, ["phone", "telephone", "mobile", "whatsapp"]),
          programme: pick_(r, ["programme", "program", "course_of_study"])
        };
        if (pw) up.password = pw;
        updateStudentAccount_(existing.student_id, up);
        var sp = { full_name: nm, year_of_study: pick_(r, ["year_of_study", "year", "year of study", "level"]), exam_venue: pick_(r, ["exam_venue", "venue", "campus", "location"]) };
        if (crsOk) sp.course = crsOk;
        if (r.owner !== void 0 && r.owner !== null) sp.owner = String(r.owner).trim();
        patchCandidate_(id, sp);
        results.push({ exam_taker_id: id, username: (studentMap_().byId[existing.student_id] || {}).username || "", full_name: nm, status: "updated", password: pw || "" });
        return;
      }
      var holder = data.byUser[un.toLowerCase()];
      if (holder && String(holder.exam_taker_id) !== id) {
        results.push({ exam_taker_id: id, status: "skipped", reason: 'Username "' + un + '" is already in use.' });
        return;
      }
      var owner;
      if (t.lecturer) owner = t.subject;
      else if (r.owner !== void 0 && r.owner !== null) {
        owner = String(r.owner).trim();
        if (owner && !(staff[owner.toLowerCase()] && staff[owner.toLowerCase()].role === "lecturer")) {
          results.push({ exam_taker_id: id, status: "skipped", reason: 'Unknown lecturer "' + owner + '".' });
          return;
        }
      } else owner = existing ? existing.owner || "" : "";
      var vals = {
        username: un,
        full_name: nm,
        owner,
        programme: pick_(r, ["programme", "program", "course_of_study"]),
        course: crsOk,
        year_of_study: pick_(r, ["year_of_study", "year", "year of study", "level"]),
        exam_venue: pick_(r, ["exam_venue", "venue", "campus", "location"]),
        email: pick_(r, ["email", "e-mail", "mail"]),
        phone: pick_(r, ["phone", "telephone", "mobile", "whatsapp"])
      };
      var newPw = pw;
      if (existing) {
        if (newPw) vals.password_hash = makeHash_(newPw);
        patchCandidate_(id, vals);
        data.byUser[un.toLowerCase()] = { exam_taker_id: id };
        results.push({ exam_taker_id: id, username: un, full_name: nm, status: "updated", password: newPw || "" });
      } else {
        if (!newPw) newPw = randPassword_();
        vals.exam_taker_id = id;
        vals.password_hash = makeHash_(newPw);
        appends.push(CAND_COLS.map(function(col) {
          if (col in vals) return vals[col];
          if (col === "current_step") return "password";
          if (col === "focus_loss" || col === "cam_events" || col === "rec_segments" || col === "rec_bytes") return 0;
          return "";
        }));
        data.rowById[id] = -1;
        data.byUser[un.toLowerCase()] = { exam_taker_id: id };
        results.push({ exam_taker_id: id, username: un, full_name: nm, status: "created", password: newPw });
      }
    });
    if (appends.length) appendRows_(sh, appends, CAND_COLS.length);
    clearDataCache_();
    results.forEach(function(x) {
      if (x.status !== "skipped") logEvent_("student_" + x.status, x.exam_taker_id, "by " + t.subject);
    });
    return {
      ok: true,
      results,
      created: results.filter(function(x) {
        return x.status === "created";
      }).length,
      updated: results.filter(function(x) {
        return x.status === "updated";
      }).length,
      skipped: results.filter(function(x) {
        return x.status === "skipped";
      }).length
    };
  });
}
function deleteStudents_(d) {
  var t = authAny_(d.token);
  var ids = (d.ids || []).map(String), done = [], refused = [];
  var sh = sheet_(SHEETS.candidates), blank = CAND_COLS.map(function() {
    return "";
  });
  ids.forEach(function(id) {
    var c = candidateRow_(id);
    if (!c || !canEdit_(t, c)) {
      refused.push(id);
      return;
    }
    var rowNum = rowNumFor_(id);
    if (rowNum) {
      sh.getRange(rowNum, 1, 1, CAND_COLS.length).setValues([blank]);
      done.push(id);
      logEvent_("student_removed", id, "by " + t.subject);
    }
  });
  if (done.length) {
    var set = {};
    done.forEach(function(x) {
      set[x] = 1;
    });
    removeRowsWhere_(sheet_(SHEETS.assign), function(r) {
      return set[String(r[0])];
    });
    CacheService.getScriptCache().removeAll(done.map(function(x) {
      return "snap:" + x;
    }).concat(done.map(function(x) {
      return "pthumb:" + x;
    })));
  }
  clearDataCache_();
  return { ok: true, removed: done.length, refused };
}
function resetStudentPassword_(d) {
  var t = authAny_(d.token);
  var id = String(d.exam_taker_id || ""), c = candidateRow_(id);
  if (!c || !canSee_(t, c)) return { error: "Student not found." };
  if (!canEdit_(t, c)) return { error: "This student is registered by the university; ask the examinations office for a new password." };
  var pw = String(d.password || "").trim() || randPassword_();
  var uname = c.username;
  if (c.student_id) {
    updateStudentAccount_(c.student_id, { password: pw });
    uname = (studentMap_().byId[c.student_id] || {}).username || c.student_id;
  } else patchCandidate_(id, { password_hash: makeHash_(pw) });
  throttleClear_("cand", uname || c.username || "");
  clearDataCache_();
  logEvent_("password_reset", id, "by " + t.subject);
  return { ok: true, exam_taker_id: id, username: uname, full_name: c.full_name, password: pw, email: c.email || "", phone: c.phone || "", course: c.course || "" };
}
var PRACTICE_VENUE = "Online (practice test)";
function isPracticeCode_(code) {
  var k = courseKey_(code);
  if (!k) return false;
  if (k === courseKey_("PRACTICE")) return true;
  return allCandidateRows_().some(function(c) {
    return isPracticeSitting_(c) && courseKey_(c.course) === k;
  });
}
function isPracticeSitting_(c) {
  return !!c && String(c.exam_venue) === PRACTICE_VENUE;
}
function settingsFor_(c, settings) {
  if (!isPracticeSitting_(c)) return settings;
  var o = {};
  for (var k in settings) o[k] = settings[k];
  o.theory_enabled = "0";
  o.paper_size = "";
  o.mark_per_question = "";
  return o;
}
function savePracticeTiming_(d) {
  var t = authStaff_(d.token);
  var dur = String(d.duration_minutes == null ? "" : d.duration_minutes).trim();
  if (!/^\d+$/.test(dur) || int_(dur, 0) < 1 || int_(dur, 0) > 600) return { error: "Practice duration must be 1\u2013600 minutes." };
  var op = String(d.opens_at || "").trim(), ls = String(d.last_start_at || "").trim();
  var opD = op ? new Date(op) : null, lsD = ls ? new Date(ls) : null;
  if (opD && isNaN(opD) || lsD && isNaN(lsD)) return { error: "Dates must be like 2026-11-03T09:00." };
  if (opD && lsD && lsD < opD) return { error: "The latest start is before the opening time." };
  var r = saveSettings_({ token: d.token, settings: { practice_duration_minutes: String(int_(dur, 15)), practice_opens_at: opD ? opD.toISOString() : "", practice_last_start_at: lsD ? lsD.toISOString() : "" } });
  if (r.error) return r;
  clearSummaryCache_();
  logEvent_("practice_timing_saved", "", dur + " min, opens " + (opD ? opD.toISOString() : "now") + ", latest start " + (lsD ? lsD.toISOString() : "none") + ", by " + t.subject);
  return { ok: true, timing: practiceTiming_(settingsMap_()) };
}
function practiceTiming_(settings) {
  return { duration_minutes: int_(settings.practice_duration_minutes, 0) || 15, opens_at: iso_(settings.practice_opens_at) || "", last_start_at: iso_(settings.practice_last_start_at) || "" };
}
function getPracticeTiming_(d) {
  authStaff_(d.token);
  return { ok: true, timing: practiceTiming_(settingsMap_()) };
}
function practiceCode_(d) {
  var code = String(d && d.course || "PRACTICE").trim().replace(/\s+/g, " ").toUpperCase();
  if (!/^[A-Z0-9][A-Z0-9 ._-]{1,39}$/.test(code)) throw new Error("The practice course code may use letters, numbers, spaces, dots and dashes (2 to 40 characters).");
  return code;
}
function addPracticeSittings_(d) {
  var t = authStaff_(d.token), code = practiceCode_(d), k = normCourse_(code);
  return withLock_(function() {
    var studs = studentMap_(), have = {}, real = 0, alone = {};
    allCandidateRows_().forEach(function(c) {
      if (normCourse_(c.course) === k && String(c.exam_venue) !== PRACTICE_VENUE) real++;
      if (c.student_id) {
        if (normCourse_(c.course) === k) have[String(c.student_id)] = 1;
      } else if (c.username) alone[String(c.username).toLowerCase()] = 1;
    });
    if (real) return { error: code + " is already a real course unit (" + real + " sitting(s)). Choose another code for the practice test, e.g. PRACTICE." };
    var rows = [];
    Object.keys(studs.byId).forEach(function(id) {
      if (have[id]) return;
      var s = studs.byId[id];
      var vals = {
        exam_taker_id: id + "-" + code,
        username: "",
        password_hash: "",
        full_name: s.full_name,
        programme: s.programme || "",
        course: code,
        exam_venue: PRACTICE_VENUE,
        email: s.email || "",
        phone: s.phone || "",
        student_id: id
      };
      rows.push(CAND_COLS.map(function(col) {
        if (col in vals) return vals[col];
        if (col === "current_step") return "password";
        if (col === "focus_loss" || col === "cam_events" || col === "rec_segments" || col === "rec_bytes") return 0;
        return "";
      }));
    });
    if (rows.length) appendRows_(sheet_(SHEETS.candidates), rows, CAND_COLS.length);
    clearDataCache_();
    var data = candidateData_(), qn = data.qorder.filter(function(qid) {
      return normCourse_(data.questions[qid].course) === k;
    }).length;
    logEvent_("practice_sittings_added", "", rows.length + " x " + code + " by " + t.subject);
    return { ok: true, course: code, created: rows.length, already: Object.keys(have).length, standalone: Object.keys(alone).length, questions: qn };
  }, 3e4);
}
function removePracticeSittings_(d) {
  var t = authStaff_(d.token), code = practiceCode_(d), k = normCourse_(code);
  var CI = CAND_COLS.indexOf("course"), VI = CAND_COLS.indexOf("exam_venue"), SI = CAND_COLS.indexOf("student_id");
  var isPractice = function(c) {
    return normCourse_(c.course) === k && String(c.exam_venue) === PRACTICE_VENUE && String(c.student_id) !== "";
  };
  var files = 0;
  if (d.keep_media !== true) allCandidateRows_().forEach(function(c) {
    if (isPractice(c)) files += purgeMedia_(c.exam_taker_id, c, true).files;
  });
  var n = removeRowsWhere_(sheet_(SHEETS.candidates), function(r) {
    return normCourse_(r[CI]) === k && String(r[VI]) === PRACTICE_VENUE && String(r[SI]) !== "";
  });
  clearDataCache_();
  clearSummaryCache_();
  logEvent_("practice_sittings_removed", "", n + " x " + code + ", " + files + " media file(s) deleted, by " + t.subject);
  return { ok: true, course: code, removed: n, media_deleted: files };
}
function orphanScan_() {
  var known = knownCourses_(), data = candidateData_(), out = {};
  var at = function(code) {
    var k = courseKey_(code);
    if (!k || known[k]) return null;
    return out[k] || (out[k] = { course: String(code).trim(), questions: 0, sittings: 0, started: 0, finished: 0, timetable: false });
  };
  Object.keys(data.questions).forEach(function(qid) {
    var o2 = at(data.questions[qid].course);
    if (o2) o2.questions++;
  });
  allCandidateRows_().forEach(function(c) {
    if (String(c.exam_venue) === PRACTICE_VENUE) return;
    var o2 = at(c.course);
    if (!o2) return;
    o2.sittings++;
    if (c.submitted_at) o2.finished++;
    else if (c.started_at) o2.started++;
  });
  var sv = catSheet_(SHEETS.schedule, SCHEDULE_COLS).getDataRange().getValues();
  for (var i = 1; i < sv.length; i++) {
    var o = at(sv[i][0]);
    if (o) o.timetable = true;
  }
  return Object.keys(out).sort().map(function(k) {
    return out[k];
  });
}
function orphanCourses_(d) {
  authStaff_(d.token);
  return { ok: true, rows: orphanScan_() };
}
function deleteOrphanCourses_(d) {
  var t = requireSuper_(d.token);
  var orphans = {};
  orphanScan_().forEach(function(o) {
    orphans[courseKey_(o.course)] = o;
  });
  var drop = {}, refused = [];
  (d.courses || []).forEach(function(c) {
    var k = courseKey_(c);
    if (orphans[k]) drop[k] = 1;
    else if (k) refused.push(String(c));
  });
  var codes = Object.keys(drop).map(function(k) {
    return orphans[k].course;
  });
  if (!codes.length) return refused.length ? { error: "These course units are in the system and were not deleted: " + refused.join(", ") + "." } : { error: "Choose at least one course unit." };
  var hit = function(code) {
    return !!drop[courseKey_(code)];
  };
  var ids = {}, files = 0, sh = sheet_(SHEETS.candidates), blank = CAND_COLS.map(function() {
    return "";
  });
  allCandidateRows_().forEach(function(c) {
    if (String(c.exam_venue) === PRACTICE_VENUE || !hit(c.course)) return;
    files += purgeMedia_(c.exam_taker_id, c, true).files;
    var rowNum = rowNumFor_(c.exam_taker_id);
    if (rowNum) {
      sh.getRange(rowNum, 1, 1, CAND_COLS.length).setValues([blank]);
      ids[c.exam_taker_id] = 1;
    }
  });
  var data = candidateData_(), qids = {};
  Object.keys(data.questions).forEach(function(qid) {
    if (hit(data.questions[qid].course)) qids[qid] = 1;
  });
  var qn = removeRowsWhere_(sheet_(SHEETS.questions), function(r2) {
    return hit(r2[9]);
  });
  removeRowsWhere_(sheet_(SHEETS.assign), function(r2) {
    return ids[String(r2[0])] || qids[String(r2[1])];
  });
  removeRowsWhere_(ensureSheet_(SpreadsheetApp.getActiveSpreadsheet(), SHEETS.theoryassign, ["exam_taker_id", "theory_ids"]), function(r2) {
    return ids[String(r2[0])];
  });
  var tn = removeRowsWhere_(catSheet_(SHEETS.schedule, SCHEDULE_COLS), function(r2) {
    return hit(r2[0]);
  });
  var idList = Object.keys(ids);
  if (idList.length) CacheService.getScriptCache().removeAll(idList.map(function(x) {
    return "snap:" + x;
  }).concat(idList.map(function(x) {
    return "pthumb:" + x;
  })));
  clearDataCache_();
  clearSummaryCache_();
  var r = { ok: true, courses: codes, questions_removed: qn, sittings_removed: idList.length, media_deleted: files, timetable_removed: tn, refused };
  logEvent_("orphan_courses_deleted", "", codes.join(", ").slice(0, 200) + ": " + qn + " question(s), " + idList.length + " sitting(s), " + files + " file(s), by " + t.subject);
  return r;
}
var MAIL_BATCH_MAX = 50;
var EMAIL_RE = /^[^\s@,;<>"]+@[^\s@,;<>"]+\.[^\s@,;<>"]+$/;
function mailStatus_() {
  try {
    var left = MailApp.getRemainingDailyQuota();
    return { ready: left > 0, via: "Google (MailApp)", left, reason: left > 0 ? "" : `Today's Google email quota is used up. Try again tomorrow, or use "Download for mail merge".` };
  } catch (e) {
    return { ready: false, via: "Google (MailApp)", reason: "Email sending is not authorised yet: in the Apps Script editor, run authorizeMail once, then deploy a new version." };
  }
}
function deliverMail_(msgs) {
  return msgs.map(function(m) {
    try {
      MailApp.sendEmail({ to: m.to, subject: m.subject, body: m.text, name: m.name });
      return { ok: true };
    } catch (e) {
      return { ok: false, error: String(e && e.message || e) };
    }
  });
}
function authorizeMail() {
  var n = MailApp.getRemainingDailyQuota();
  Logger.log(n + " emails can be sent today.");
  return n + " emails can be sent today.";
}
function mailInfo_(d) {
  authAny_(d.token);
  var s = mailStatus_();
  return { ok: true, ready: !!s.ready, via: s.via || "", from: s.from || "", left: s.left === void 0 ? null : s.left, reason: s.reason || "", batch: MAIL_BATCH_MAX };
}
function emailStudents_(d) {
  var t = authAny_(d.token);
  var items = (d.items || []).slice(0, MAIL_BATCH_MAX);
  var subject = String(d.subject || "KIU online examinations").replace(/[\r\n]+/g, " ").trim().slice(0, 200) || "KIU online examinations";
  var download = d.mode === "download", test = d.test_to ? String(d.test_to).trim() : "", newPw = d.new_passwords === true && !test;
  if (test && !EMAIL_RE.test(test)) return { error: "Enter a valid address for the test email." };
  var st = download ? { ready: true } : mailStatus_();
  if (!st.ready) return { error: st.reason || "Email sending is not set up." };
  if (test) items = items.slice(0, 1);
  var names = staffNames_(), sender = t.lecturer ? (names[String(t.subject).toLowerCase()] || t.subject) + " (KIU)" : "KIU Examinations Office";
  var studs = studentMap_(), out = [], msgs = [], done = {};
  items.forEach(function(it) {
    var id = String(it.exam_taker_id || ""), c = id ? candidateRow_(id) : null;
    var res = { exam_taker_id: id, full_name: c ? c.full_name : "", email: "" };
    out.push(res);
    if (!c || !canSee_(t, c)) {
      res.status = "skipped";
      res.reason = "Student not found.";
      return;
    }
    var acct = c.student_id ? studs.byId[String(c.student_id)] : null;
    var to = test || String(acct && acct.email || c.email || "").trim();
    res.email = to;
    if (!EMAIL_RE.test(to)) {
      res.status = "skipped";
      res.reason = "No valid email address on record.";
      return;
    }
    var key = c.student_id ? "s:" + c.student_id : "c:" + id;
    if (done[key]) {
      res.status = "skipped";
      res.reason = "Already in this batch.";
      return;
    }
    done[key] = 1;
    var text = String(it.text || "").slice(0, 8e3);
    if (!text.trim()) {
      res.status = "skipped";
      res.reason = "Empty message.";
      return;
    }
    var pw = "";
    if (newPw) {
      if (!canEdit_(t, c)) {
        res.status = "skipped";
        res.reason = "Registered by the university: only the examinations office can issue a new password.";
        return;
      }
      pw = randPassword_();
      if (c.student_id) updateStudentAccount_(c.student_id, { password: pw });
      else {
        patchCandidate_(id, { password_hash: makeHash_(pw) });
        throttleClear_("cand", c.username || "");
      }
      logEvent_("password_reset", id, "by " + t.subject + " (sent by email)");
      res.password_changed = true;
    }
    text = text.split("{{PASSWORD}}").join(pw || (test ? "(the student's password)" : "(the password already given to you)"));
    res._i = msgs.length;
    msgs.push({ to, subject, text, name: sender });
    if (download || newPw) res.message = text;
    if (download) {
      res.status = "ready";
      res.subject = subject;
    }
  });
  if (newPw) clearDataCache_();
  if (!download && msgs.length) {
    var sent = deliverMail_(msgs);
    out.forEach(function(r) {
      if (r._i === void 0) return;
      var s = sent[r._i] || {};
      if (s.pending) {
        r.status = "pending";
        r.pending = s.pending;
      } else {
        r.status = s.ok ? "sent" : "failed";
        if (!s.ok) r.reason = s.error || "Not sent.";
      }
      if (!test && r.status !== "failed") logEvent_("exam_details_emailed", r.exam_taker_id, r.email + (r.password_changed ? " (new password)" : ""));
    });
  }
  out.forEach(function(r) {
    delete r._i;
  });
  var count = function(s) {
    return out.filter(function(r) {
      return r.status === s;
    }).length;
  };
  return { ok: true, test: !!test, sent: count("sent"), failed: count("failed"), skipped: count("skipped"), pending: count("pending"), ready: count("ready"), results: out };
}
function listCatalog_(d) {
  var t = authAny_(d.token), names = staffNames_();
  var cat = catalogue_(t.lecturer ? t.subject : d.owner || null);
  cat.programmes.forEach(function(p) {
    p.owner_name = names[p.owner.toLowerCase()] || p.owner;
  });
  cat.courses.forEach(function(c) {
    c.owner_name = names[c.owner.toLowerCase()] || c.owner;
  });
  return { ok: true, programmes: cat.programmes, courses: cat.courses };
}
function unitTakenByOthers_(me, programme, code) {
  var p = normCourse_(programme), k = normCourse_(code);
  var v = catSheet_(SHEETS.courses, COURSE_COLS).getDataRange().getValues();
  for (var i = 1; i < v.length; i++)
    if (v[i][1] && String(v[i][0]).toLowerCase() !== me && normCourse_(v[i][3]) === p && normCourse_(v[i][1]) === k) return true;
  var data = candidateData_();
  return Object.keys(data.studentById).some(function(id) {
    return normCourse_(data.progById[id]) === p && normCourse_(data.courseById[id]) === k;
  });
}
function catOwner_(t, d) {
  if (t.lecturer) return t.subject;
  var o = String(d.owner || "").trim();
  if (!o) throw new Error("Choose the lecturer this belongs to.");
  var s = staffMap_()[o.toLowerCase()];
  if (!s || s.role !== "lecturer") throw new Error("Unknown lecturer.");
  return s.username;
}
function saveProgramme_(d) {
  return withLock_(function() {
    return saveProgrammeLocked_(d);
  });
}
function saveProgrammeLocked_(d) {
  var t = authAny_(d.token), owner = catOwner_(t, d), me = owner.toLowerCase();
  var name = String(d.programme || "").trim(), old = String(d.old || "").trim();
  if (!name) return { error: "Enter the programme name." };
  var sh = catSheet_(SHEETS.programmes, PROGRAMME_COLS), v = sh.getDataRange().getValues();
  for (var i = 1; i < v.length; i++) if (String(v[i][0]).toLowerCase() === me && String(v[i][1]).toLowerCase() === name.toLowerCase() && name.toLowerCase() !== old.toLowerCase())
    return { error: "You already have that programme." };
  if (old) {
    var mineC = catSheet_(SHEETS.courses, COURSE_COLS).getDataRange().getValues();
    if (t.lecturer) {
      for (var y = 1; y < mineC.length; y++)
        if (String(mineC[y][0]).toLowerCase() === me && String(mineC[y][3]) === old && unitTakenByOthers_(me, name, mineC[y][1]))
          return { error: "Course unit " + mineC[y][1] + " in " + name + " is managed by the examinations office or another lecturer." };
    }
    for (var j = 1; j < v.length; j++) if (String(v[j][0]).toLowerCase() === me && String(v[j][1]) === old) {
      sh.getRange(j + 1, 2).setValue(name);
      var cs = catSheet_(SHEETS.courses, COURSE_COLS), cv = cs.getDataRange().getValues();
      for (var k = 1; k < cv.length; k++) if (String(cv[k][0]).toLowerCase() === me && String(cv[k][3]) === old) cs.getRange(k + 1, 4).setValue(name);
      clearDataCache_();
      return { ok: true };
    }
    return { error: "Programme not found." };
  }
  appendRows_(sh, [[owner, name, now_()]], 3);
  clearDataCache_();
  return { ok: true };
}
function deleteProgramme_(d) {
  var t = authAny_(d.token), owner = catOwner_(t, d).toLowerCase(), name = String(d.programme || "");
  var n = removeRowsWhere_(catSheet_(SHEETS.programmes, PROGRAMME_COLS), function(r) {
    return String(r[0]).toLowerCase() === owner && String(r[1]) === name;
  });
  var c = removeRowsWhere_(catSheet_(SHEETS.courses, COURSE_COLS), function(r) {
    return String(r[0]).toLowerCase() === owner && String(r[3]) === name;
  });
  clearDataCache_();
  return n ? { ok: true, courses_removed: c } : { error: "Programme not found." };
}
function saveCourse_(d) {
  return withLock_(function() {
    return saveCourseLocked_(d);
  });
}
function saveCourseLocked_(d) {
  var t = authAny_(d.token), owner = catOwner_(t, d), me = owner.toLowerCase();
  var code = String(d.course_code || "").trim(), title = String(d.course_title || "").trim(), prog = String(d.programme || "").trim();
  var old = String(d.old || "").trim();
  if (!code) return { error: "Enter the course code." };
  if (t.lecturer && unitTakenByOthers_(me, prog, code))
    return { error: "That course unit is managed by the examinations office or another lecturer. Ask the examinations office to add you to it." };
  var sh = catSheet_(SHEETS.courses, COURSE_COLS), v = sh.getDataRange().getValues();
  for (var i = 1; i < v.length; i++) if (String(v[i][0]).toLowerCase() === me && normCourse_(v[i][1]) === normCourse_(code) && normCourse_(code) !== normCourse_(old))
    return { error: "You already have a course with that code." };
  if (old) {
    for (var j = 1; j < v.length; j++) if (String(v[j][0]).toLowerCase() === me && String(v[j][1]) === old) {
      sh.getRange(j + 1, 2, 1, 3).setValues([[code, title, prog]]);
      if (old !== code) {
        var qs = sheet_(SHEETS.questions), qv = qs.getDataRange().getValues();
        for (var q = 1; q < qv.length; q++) if (String(qv[q][10] || "").toLowerCase() === me && normCourse_(qv[q][9]) === normCourse_(old)) qs.getRange(q + 1, 10).setValue(code);
        allCandidateRows_().forEach(function(c) {
          if (String(c.owner || "").toLowerCase() === me && normCourse_(c.course) === normCourse_(old)) patchCandidate_(c.exam_taker_id, { course: code });
        });
        clearDataCache_();
      }
      clearDataCache_();
      return { ok: true };
    }
    return { error: "Course not found." };
  }
  appendRows_(sh, [[owner, code, title, prog, now_()]], 5);
  clearDataCache_();
  return { ok: true };
}
function deleteCourse_(d) {
  var t = authAny_(d.token), owner = catOwner_(t, d).toLowerCase(), code = String(d.course_code || "");
  var n = removeRowsWhere_(catSheet_(SHEETS.courses, COURSE_COLS), function(r) {
    return String(r[0]).toLowerCase() === owner && String(r[1]) === code;
  });
  clearDataCache_();
  return n ? { ok: true } : { error: "Course not found." };
}
function listQuestions_(d) {
  var t = authAny_(d.token), data = candidateData_(), names = staffNames_(), me = String(t.subject).toLowerCase();
  var rows = [];
  Object.keys(data.questions).forEach(function(qid) {
    var q = data.questions[qid];
    if (t.lecturer && String(q.owner).toLowerCase() !== me) return;
    if (!t.lecturer && d.owner !== void 0 && d.owner !== null && String(q.owner).toLowerCase() !== String(d.owner).toLowerCase()) return;
    var o = {};
    for (var k in q) o[k] = q[k];
    o.owner_name = q.owner ? names[String(q.owner).toLowerCase()] || q.owner : "";
    rows.push(o);
  });
  rows.sort(function(a, b) {
    return (a.course + a.question_id).localeCompare(b.course + b.question_id);
  });
  return { ok: true, rows };
}
function saveQuestion_(d) {
  var t = authAny_(d.token);
  var q = d.question || {};
  var r = {
    question_id: String(q.question_id || "").trim(),
    area: q.area,
    question_text: q.question_text,
    option_a: q.option_a,
    option_b: q.option_b,
    option_c: q.option_c,
    option_d: q.option_d,
    correct_answer: q.correct_answer,
    marks: q.marks,
    course: q.course
  };
  if (!String(r.question_text || "").trim()) return { error: "Enter the question." };
  if (!String(r.option_a || "").trim() || !String(r.option_b || "").trim()) return { error: "Enter at least options A and B." };
  var ca = String(r.correct_answer || "").toUpperCase().charAt(0);
  if ("ABCD".indexOf(ca) < 0 || !ca || !String(r["option_" + ca.toLowerCase()] || "").trim()) return { error: "Choose a correct answer that has text." };
  r._keep = true;
  var res = uploadQuestions_({ token: d.token, rows: [r], course: q.course });
  if (res.skipped) return { error: res.notes && res.notes[0] || "The question could not be saved." };
  return { ok: true };
}
function deleteQuestions_(d) {
  var t = authAny_(d.token), me = String(t.subject).toLowerCase(), data = candidateData_();
  var set = {}, refused = [];
  (d.ids || []).forEach(function(id) {
    id = String(id);
    var q = data.questions[id];
    if (!q || t.lecturer && String(q.owner).toLowerCase() !== me) {
      refused.push(id);
      return;
    }
    set[id] = 1;
  });
  var n = removeRowsWhere_(sheet_(SHEETS.questions), function(r) {
    return set[String(r[0])];
  });
  removeRowsWhere_(sheet_(SHEETS.assign), function(r) {
    return set[String(r[1])];
  });
  clearDataCache_();
  return { ok: true, removed: n, refused };
}
function assignQuestions_(d) {
  var t = authAny_(d.token), me = String(t.subject).toLowerCase(), data = candidateData_();
  var ids = (d.ids || []).map(String), qids = (d.question_ids || []).map(String);
  if (!ids.length) return { error: "Choose at least one student." };
  var okIds = [], refused = [];
  ids.forEach(function(id) {
    var c = candidateRow_(id);
    if (c && canSee_(t, c)) okIds.push(id);
    else refused.push(id);
  });
  var badQ = qids.filter(function(q) {
    var x = data.questions[q];
    return !x || t.lecturer && String(x.owner).toLowerCase() !== me;
  });
  if (badQ.length) return { error: "You can only assign your own questions (" + badQ.slice(0, 3).join(", ") + ")." };
  if (d.mode !== "clear" && !qids.length) return { error: "Choose at least one question." };
  var set = {};
  okIds.forEach(function(x) {
    set[x] = 1;
  });
  var sh = sheet_(SHEETS.assign);
  withLock_(function() {
    removeRowsWhere_(sh, function(r) {
      return set[String(r[0])];
    });
    if (d.mode !== "clear" && okIds.length) {
      var rows = [];
      okIds.forEach(function(id) {
        qids.forEach(function(q, o) {
          rows.push([id, q, o]);
        });
      });
      appendRows_(sh, rows, 3);
    }
  });
  clearDataCache_();
  return { ok: true, students: okIds.length, questions: d.mode === "clear" ? 0 : qids.length, refused };
}
function examUploadReport_(owner) {
  var m = staffMap_(), data = candidateData_(), cat = catalogue_(owner || null), settings = settingsMap_();
  var only = owner ? String(owner).toLowerCase() : null;
  var qa = {};
  Object.keys(data.questions).forEach(function(qid) {
    var q = data.questions[qid];
    if (!q.course) return;
    var k = String(q.owner || "").toLowerCase() + "|" + normCourse_(q.course);
    var a = qa[k] = qa[k] || { owner: q.owner || "", course: q.course, questions: 0, marks: 0, last: "" };
    a.questions++;
    a.marks = round2_(a.marks + questionMark_(q, settings));
    if (q.updated_at && q.updated_at > a.last) a.last = q.updated_at;
  });
  var sitPC = {}, sitOC = {};
  allCandidateRows_().forEach(function(c) {
    var ready = paperFor_(c, data, settings).length > 0;
    var pk = normCourse_(c.programme) + "|" + normCourse_(c.course), ok = String(c.owner || "").toLowerCase() + "|" + normCourse_(c.course);
    var a = sitPC[pk] = sitPC[pk] || { students: 0, ready: 0 };
    a.students++;
    if (ready) a.ready++;
    if (c.owner && lecturersFor_(data, c.programme, c.course).indexOf(String(c.owner).toLowerCase()) < 0) {
      var b = sitOC[ok] = sitOC[ok] || { students: 0, ready: 0 };
      b.students++;
      if (ready) b.ready++;
    }
  });
  function lectInfo(o) {
    if (!o) return { owner_name: "No lecturer assigned", department: "", email: "" };
    var x = m[String(o).toLowerCase()] || {};
    return { owner_name: x.full_name || o + " (removed)", department: x.department || "", email: x.email || "" };
  }
  var rows = [], seenOwnCode = {}, hasCourse = {}, units = {};
  cat.courses.forEach(function(c) {
    var o = c.owner.toLowerCase(), code = normCourse_(c.course_code), pk = normCourse_(c.programme) + "|" + code;
    var own = qa[o + "|" + code] || {}, lects = data.courseLects[pk] || [];
    var unitQ = 0, last = own.last || "";
    lects.forEach(function(l) {
      var x = qa[l + "|" + code];
      if (x) {
        unitQ += x.questions;
        if (x.last > last) last = x.last;
      }
    });
    var office = qa["|" + code];
    if (!lects.length && office) {
      unitQ += office.questions;
      if (office.last > last) last = office.last;
    }
    seenOwnCode[o + "|" + code] = 1;
    if (o) hasCourse[o] = 1;
    var s1 = c.programme ? sitPC[pk] || {} : {}, s2 = o ? sitOC[o + "|" + code] || {} : {};
    var st = { students: (s1.students || 0) + (s2.students || 0), ready: (s1.ready || 0) + (s2.ready || 0) };
    var status = !o ? unitQ ? "uploaded" : "no_lecturer" : own.questions ? "uploaded" : unitQ ? "covered" : "pending";
    var li = lectInfo(c.owner);
    rows.push({
      owner: c.owner,
      owner_name: li.owner_name,
      department: li.department,
      email: li.email,
      programme: c.programme,
      course_code: c.course_code,
      course_title: c.course_title,
      questions: o ? own.questions || 0 : unitQ,
      unit_questions: unitQ,
      marks: o ? own.marks || 0 : office ? office.marks : 0,
      last_upload: o ? own.last || "" : last,
      students: st.students || 0,
      students_ready: st.ready || 0,
      registered: true,
      co_lecturers: Math.max(0, lects.length - 1),
      status
    });
    var uk2 = c.programme + "|" + c.course_code;
    units[uk2] = units[uk2] || { lect: false, q: false };
    if (o) units[uk2].lect = true;
    if (unitQ) units[uk2].q = true;
  });
  Object.keys(qa).forEach(function(k) {
    var a = qa[k], o = String(a.owner).toLowerCase();
    if (!o || seenOwnCode[k]) return;
    if (only && o !== only) return;
    var li = lectInfo(a.owner), st = sitOC[k] || {};
    hasCourse[o] = 1;
    rows.push({
      owner: a.owner,
      owner_name: li.owner_name,
      department: li.department,
      email: li.email,
      programme: "",
      course_code: a.course || "(no course)",
      course_title: data.courseTitle[normCourse_(a.course)] || "",
      questions: a.questions,
      unit_questions: a.questions,
      marks: a.marks,
      last_upload: a.last,
      students: st.students || 0,
      students_ready: st.ready || 0,
      registered: false,
      co_lecturers: 0,
      status: "uploaded"
    });
  });
  Object.keys(m).forEach(function(k) {
    if (m[k].role !== "lecturer" || hasCourse[k] || only && k !== only) return;
    rows.push({
      owner: m[k].username,
      owner_name: m[k].full_name || m[k].username,
      department: m[k].department || "",
      email: m[k].email || "",
      programme: "",
      course_code: "",
      course_title: "",
      questions: 0,
      unit_questions: 0,
      marks: 0,
      last_upload: "",
      students: 0,
      students_ready: 0,
      registered: false,
      co_lecturers: 0,
      status: "no_course"
    });
  });
  rows.sort(function(a, b) {
    return (String(a.owner_name) + "|" + a.programme + "|" + a.course_code).localeCompare(String(b.owner_name) + "|" + b.programme + "|" + b.course_code);
  });
  var byLect = {};
  rows.forEach(function(r) {
    if (!r.owner) return;
    var L = byLect[r.owner.toLowerCase()] = byLect[r.owner.toLowerCase()] || { total: 0, done: 0, own: 0 };
    if (r.status !== "no_course") {
      L.total++;
      if (r.status === "uploaded" || r.status === "covered") L.done++;
      if (r.status === "uploaded") L.own++;
    }
  });
  var lk = Object.keys(byLect), uk = Object.keys(units);
  var summary = {
    units: uk.length,
    units_uploaded: uk.filter(function(k) {
      return units[k].q;
    }).length,
    units_pending: uk.filter(function(k) {
      return units[k].lect && !units[k].q;
    }).length,
    units_no_lecturer: uk.filter(function(k) {
      return !units[k].lect && !units[k].q;
    }).length,
    courses: rows.filter(function(r) {
      return r.owner && r.status !== "no_course";
    }).length,
    uploaded: rows.filter(function(r) {
      return r.status === "uploaded" && r.owner;
    }).length,
    pending: rows.filter(function(r) {
      return r.status === "pending";
    }).length,
    lecturers: lk.length,
    lecturers_complete: lk.filter(function(k) {
      return byLect[k].total > 0 && byLect[k].done === byLect[k].total;
    }).length,
    lecturers_none: lk.filter(function(k) {
      return byLect[k].own === 0;
    }).length
  };
  return { summary, rows };
}
function examUploads_(d) {
  var t = authAny_(d.token);
  var r = examUploadReport_(t.lecturer ? t.subject : null);
  return { ok: true, summary: r.summary, rows: r.rows };
}
function studentMap_() {
  var cache = CacheService.getScriptCache(), c = cache.get("studmap");
  if (c) return JSON.parse(c);
  var v = ensureSheet_(SpreadsheetApp.getActiveSpreadsheet(), SHEETS.students, STUDENT_COLS).getDataRange().getValues();
  var out = { byUser: {}, byId: {} };
  for (var i = 1; i < v.length; i++) {
    if (!v[i][0]) continue;
    var r = { student_id: String(v[i][0]), username: String(v[i][1]), password_hash: v[i][2], full_name: v[i][3], email: v[i][4], phone: v[i][5], programme: v[i][6] };
    out.byId[r.student_id] = r;
    out.byUser[r.username.toLowerCase()] = r;
  }
  try {
    cache.put("studmap", JSON.stringify(out), 1800);
  } catch (e) {
  }
  return out;
}
function updateStudentAccount_(studentId, up) {
  var sh = ensureSheet_(SpreadsheetApp.getActiveSpreadsheet(), SHEETS.students, STUDENT_COLS), v = sh.getDataRange().getValues();
  for (var i = 1; i < v.length; i++) if (String(v[i][0]) === String(studentId)) {
    ["full_name", "email", "phone", "programme"].forEach(function(k) {
      if (up[k] !== void 0 && up[k] !== "") sh.getRange(i + 1, STUDENT_COLS.indexOf(k) + 1).setValue(up[k]);
    });
    if (up.password) {
      sh.getRange(i + 1, 3).setValue(makeHash_(up.password));
      throttleClear_("cand", String(v[i][1]));
    }
    break;
  }
  var sp = {};
  if (up.full_name) sp.full_name = up.full_name;
  if (up.email) sp.email = up.email;
  if (up.phone) sp.phone = up.phone;
  if (up.programme) sp.programme = up.programme;
  if (Object.keys(sp).length) allCandidateRows_().forEach(function(c) {
    if (String(c.student_id) === String(studentId)) patchCandidate_(c.exam_taker_id, sp);
  });
  CacheService.getScriptCache().remove("studmap");
}
function importKiu_(d) {
  var t = authStaff_(d.token);
  return withLock_(function() {
    var units = d.units || [], lect = d.lecturers || [], studs = d.students || [], enrol = d.enrolments || [];
    var report = {
      lecturers_created: 0,
      lecturers_updated: 0,
      programmes_added: 0,
      courses_added: 0,
      students_created: 0,
      students_updated: 0,
      sittings_created: 0,
      sittings_updated: 0,
      skipped: []
    };
    var creds = { lecturers: [], students: [] };
    var ss = SpreadsheetApp.getActiveSpreadsheet();
    var clean = function(x) {
      return String(x == null ? "" : x).replace(/\s+/g, " ").trim();
    };
    var title = {}, unitProg = {};
    units.forEach(function(u) {
      var code = clean(u.code), prog = clean(u.programme), desc = clean(u.description);
      if (!code || !prog) return;
      var tt = desc.indexOf(code + " - ") === 0 ? desc.slice(code.length + 3) : desc;
      title[code.toUpperCase()] = tt;
      unitProg[prog + "|" + code.toUpperCase()] = 1;
    });
    clearStaffCache_();
    var staff = staffMap_(), staffSh = sheet_(SHEETS.staff), newStaff = [], seenL = {};
    lect.forEach(function(l) {
      var email = clean(l.email).toLowerCase(), name = clean(l.name);
      if (!email || seenL[email]) return;
      seenL[email] = 1;
      if (!/^[^@\s]+@[^@\s]+\.[^@\s]+$/.test(email)) {
        report.skipped.push('Lecturer "' + name + '": invalid email ' + email);
        return;
      }
      var ex = staff[email];
      if (ex) {
        if (ex.role !== "lecturer") {
          report.skipped.push(email + " is already an " + ex.role + " account \u2014 not changed");
          return;
        }
        if (name && name !== ex.full_name || ex.email !== email) {
          patchStaff_(ex.username, { full_name: name || ex.full_name, email });
          report.lecturers_updated++;
        }
        return;
      }
      var pw = clean(l.password) || randPassword_();
      newStaff.push([email, makeHash_(pw), "lecturer", name || email, "1", now_(), "", email, clean(l.department), "1"]);
      creds.lecturers.push({ name, username: email, password: pw, email });
      report.lecturers_created++;
    });
    if (newStaff.length) appendRows_(staffSh, newStaff, newStaff[0].length);
    clearStaffCache_();
    var pSh = catSheet_(SHEETS.programmes, PROGRAMME_COLS), cSh = catSheet_(SHEETS.courses, COURSE_COLS);
    var pv = pSh.getDataRange().getValues(), cvv = cSh.getDataRange().getValues(), haveP = {}, haveC = {};
    for (var i = 1; i < pv.length; i++) if (pv[i][1]) haveP[String(pv[i][0]).toLowerCase() + "|" + String(pv[i][1])] = 1;
    for (var j = 1; j < cvv.length; j++) if (cvv[j][1]) haveC[String(cvv[j][0]).toLowerCase() + "|" + String(cvv[j][3]) + "|" + String(cvv[j][1]).toUpperCase()] = 1;
    var addP = [], addC = [], unitHasLect = {};
    lect.forEach(function(l) {
      var email = clean(l.email).toLowerCase(), prog = clean(l.programme), code = clean(l.code).toUpperCase();
      if (!prog || !code) return;
      if (!email) return;
      if (!seenL[email] || !staffMap_()[email] || staffMap_()[email].role !== "lecturer") return;
      unitHasLect[prog + "|" + code] = 1;
      if (!haveP[email + "|" + prog]) {
        haveP[email + "|" + prog] = 1;
        addP.push([email, prog, now_()]);
      }
      if (!haveC[email + "|" + prog + "|" + code]) {
        haveC[email + "|" + prog + "|" + code] = 1;
        addC.push([email, code, title[code] || "", prog, now_()]);
      }
    });
    Object.keys(unitProg).forEach(function(k) {
      if (unitHasLect[k]) return;
      var prog = k.split("|")[0], code = k.split("|")[1];
      if (!haveP["|" + prog]) {
        haveP["|" + prog] = 1;
        addP.push(["", prog, now_()]);
      }
      if (!haveC["|" + prog + "|" + code]) {
        haveC["|" + prog + "|" + code] = 1;
        addC.push(["", code, title[code] || "", prog, now_()]);
      }
    });
    if (addP.length) appendRows_(pSh, addP, 3);
    if (addC.length) appendRows_(cSh, addC, 5);
    report.programmes_added = addP.length;
    report.courses_added = addC.length;
    var sSh = ensureSheet_(ss, SHEETS.students, STUDENT_COLS);
    CacheService.getScriptCache().remove("studmap");
    var smap = studentMap_(), addS = [], sInfo = {};
    var candUsers = candidateData_().byUser;
    studs.forEach(function(x) {
      var id = clean(x.admission), name = clean(x.name), email = clean(x.email), prog = clean(x.programme);
      if (!id || !name) {
        report.skipped.push("Student row without admission number or name");
        return;
      }
      sInfo[id] = { name, email, programme: prog };
      var ex = smap.byId[id];
      if (ex) {
        if (String(ex.full_name) !== name || String(ex.email) !== email || String(ex.programme) !== prog) {
          updateStudentAccount_(id, { full_name: name, email, programme: prog });
          report.students_updated++;
        }
        return;
      }
      if (candUsers[id.toLowerCase()]) {
        report.skipped.push("Student " + id + ": username already used by a stand-alone candidate");
        return;
      }
      var pw = clean(x.password) || randPassword_();
      addS.push([id, id, makeHash_(pw), name, email, "", prog, now_()]);
      smap.byId[id] = { student_id: id };
      creds.students.push({ admission: id, name, email, programme: prog, username: id, password: pw });
      report.students_created++;
    });
    if (addS.length) appendRows_(sSh, addS, STUDENT_COLS.length);
    CacheService.getScriptCache().remove("studmap");
    clearDataCache_();
    var data = candidateData_(), cSheet = sheet_(SHEETS.candidates), addR = [], cur = {}, known = knownCourses_();
    allCandidateRows_().forEach(function(c) {
      cur[c.exam_taker_id] = c;
    });
    enrol.forEach(function(e) {
      var id = clean(e.admission), code = clean(e.code).toUpperCase(), prog = clean(e.programme);
      if (!id || !code) return;
      if (!known[courseKey_(code)]) {
        report.skipped.push("Enrolment " + id + " " + code + ": course unit not in the Course Units sheet or the system");
        return;
      }
      if (!smap.byId[id]) {
        report.skipped.push("Enrolment " + id + " " + code + ": student not in the Students list");
        return;
      }
      var info = sInfo[id] || {};
      var sid = id + "-" + code;
      var vals = {
        exam_taker_id: sid,
        username: "",
        password_hash: "",
        full_name: info.name || clean(e.name),
        programme: prog || info.programme || "",
        course: code,
        year_of_study: "",
        exam_venue: "Online",
        email: info.email || clean(e.email),
        student_id: id
      };
      if (data.rowById[sid]) {
        var o = cur[sid] || {};
        if (data.rowById[sid] > 0 && (String(o.full_name) !== vals.full_name || String(o.programme) !== vals.programme || String(o.course) !== code || String(o.email) !== vals.email || String(o.student_id) !== id)) {
          patchCandidate_(sid, { full_name: vals.full_name, programme: vals.programme, course: code, email: vals.email, student_id: id });
          report.sittings_updated++;
        }
      } else {
        data.rowById[sid] = -1;
        addR.push(CAND_COLS.map(function(col) {
          if (col in vals) return vals[col];
          if (col === "current_step") return "password";
          if (col === "focus_loss" || col === "cam_events" || col === "rec_segments" || col === "rec_bytes") return 0;
          return "";
        }));
        report.sittings_created++;
      }
    });
    if (addR.length) appendRows_(cSheet, addR, CAND_COLS.length);
    clearDataCache_();
    clearStaffCache_();
    logEvent_("kiu_import", "", JSON.stringify(report).slice(0, 300) + " by " + t.subject);
    return { ok: true, report, credentials: creds };
  }, 3e4);
}
function overlayLive_(rows) {
  var keys = [];
  rows.forEach(function(c) {
    if (c && c.logged_in_at) keys.push("seen:" + c.exam_taker_id, "snapt:" + c.exam_taker_id);
  });
  if (!keys.length) return rows;
  var got = {};
  for (var i = 0; i < keys.length; i += 500) {
    var part = CacheService.getScriptCache().getAll(keys.slice(i, i + 500));
    for (var k in part) got[k] = part[k];
  }
  var later = function(a, b) {
    if (!a) return b || "";
    if (!b) return a;
    return new Date(a).getTime() >= new Date(b).getTime() ? a : b;
  };
  rows.forEach(function(c) {
    if (!c || !c.logged_in_at) return;
    c.last_seen = later(iso_(c.last_seen), got["seen:" + c.exam_taker_id]);
    c.last_snap_at = later(iso_(c.last_snap_at), got["snapt:" + c.exam_taker_id]);
  });
  return rows;
}
function pacing_(settings) {
  return {
    sync_s: Math.max(15, Math.min(120, int_(settings.sync_seconds, 30))),
    burst_s: Math.max(0, Math.min(60, int_(settings.burst_spread_seconds, 20)))
  };
}
function distKm_(a1, o1, a2, o2) {
  var R = 6371, r = Math.PI / 180, da = (a2 - a1) * r, dob = (o2 - o1) * r;
  var x = Math.sin(da / 2) * Math.sin(da / 2) + Math.cos(a1 * r) * Math.cos(a2 * r) * Math.sin(dob / 2) * Math.sin(dob / 2);
  return 2 * R * Math.asin(Math.min(1, Math.sqrt(x)));
}
function geoGroups_(rows) {
  var g = {};
  rows.forEach(function(c) {
    var active = c.current_step === "exam" || c.theory_step === "theory";
    if (!active || c.geo_lat === "" || c.geo_lat == null || isNaN(parseFloat(c.geo_lat))) return;
    var k = parseFloat(c.geo_lat).toFixed(4) + "," + parseFloat(c.geo_lng).toFixed(4);
    (g[k] = g[k] || {})[c.student_id || c.exam_taker_id] = 1;
  });
  var out = {};
  Object.keys(g).forEach(function(k) {
    out[k] = Object.keys(g[k]).length;
  });
  return out;
}
function pastFlags_(c) {
  var integ = safeParse_(c.integrity_json || "{}", {}) || {}, f = [];
  if ((integ.frozen_max || 0) >= FROZEN_ALERT) f.push({ text: "Camera picture identical " + integ.frozen_max + " times in a row (frozen or replayed)" });
  if (integ.virtual_cam) f.push({ text: "Virtual camera software: " + (integ.cam_label || "") });
  if (integ.gaps) f.push({ text: "Lost contact " + integ.gaps + " time(s), longest " + Math.round(integ.gap_max_s / 60) + " min" });
  if ((integ.moved_km || 0) >= MOVE_ALERT_KM) f.push({ text: "Location moved " + integ.moved_km + " km during the paper" });
  if (integ.devtools) f.push({ text: "Opened browser developer tools " + integ.devtools + " time(s)" });
  if (integ.multi_screen) f.push({ text: "More than one screen connected" });
  if (c.started_at && proctorSettings_(settingsMap_()).record_video && !int_(c.rec_segments, 0)) f.push({ text: "No recording was received" });
  return f;
}
function integrityFlags_(c, settings, nowMs, groups) {
  var f = [], integ = safeParse_(c.integrity_json || "{}", {}) || {}, ps = proctorSettings_(settings);
  var active = c.current_step === "exam" && c.started_at || c.theory_step === "theory";
  var since = function(t) {
    return t ? nowMs - new Date(t).getTime() : Infinity;
  };
  var startedAgo = since(c.theory_step === "theory" ? c.theory_started_at : c.started_at);
  if (active && ps.require_camera && ps.record_video) {
    var recWin = (ps.segment_seconds * 2 + 90) * 1e3;
    if (startedAgo > recWin && since(c.last_rec_at) > recWin)
      f.push({ code: "no_video", level: "high", text: c.last_rec_at ? "No recording received for " + Math.round(since(c.last_rec_at) / 6e4) + " min" : "No recording received yet" });
  }
  if (active && ps.require_camera) {
    var snapWin = (ps.snapshot_seconds * 4 + 60) * 1e3;
    if (startedAgo > snapWin && since(c.last_snap_at) > snapWin) f.push({ code: "no_pictures", level: "high", text: "No camera picture received for " + Math.round(Math.min(since(c.last_snap_at), startedAgo) / 6e4) + " min" });
    if (c.cam_status === "on" && since(c.last_snap_at) > snapWin && startedAgo > snapWin) f.push({ code: "camera_claim", level: "high", text: "Browser says the camera is on, but no pictures arrive" });
  }
  if ((integ.frozen_max || 0) >= FROZEN_ALERT) f.push({ code: "frozen", level: "high", text: "Camera picture identical " + integ.frozen_max + " times in a row (frozen or replayed)" });
  if (integ.virtual_cam) f.push({ code: "virtual_cam", level: "high", text: "Virtual camera software: " + (integ.cam_label || "") });
  if (integ.gaps) f.push({ code: "gaps", level: integ.gap_max_s > 600 ? "high" : "mid", text: "Lost contact " + integ.gaps + " time(s), longest " + Math.round(integ.gap_max_s / 60) + " min" });
  if ((integ.moved_km || 0) >= MOVE_ALERT_KM) f.push({ code: "moved", level: "mid", text: "Location moved " + integ.moved_km + " km during the paper" });
  if (groups && c.geo_lat !== "" && c.geo_lat != null && !isNaN(parseFloat(c.geo_lat)) && active) {
    var n = groups[parseFloat(c.geo_lat).toFixed(4) + "," + parseFloat(c.geo_lng).toFixed(4)] || 0;
    if (n > 1) f.push({ code: "same_place", level: "mid", text: "Same location as " + (n - 1) + " other candidate(s) writing now" });
  }
  if (integ.devtools) f.push({ code: "devtools", level: "high", text: "Opened browser developer tools " + integ.devtools + " time(s)" });
  if (integ.multi_screen) f.push({ code: "multi_screen", level: "mid", text: "More than one screen connected" });
  if (active && settings.require_location !== "0" && (c.geo_lat === "" || c.geo_lat == null)) f.push({ code: "no_location", level: "mid", text: "No location received" });
  return f;
}
function officialTz_() {
  try {
    return Session.getScriptTimeZone() || "UTC";
  } catch (e) {
    return "UTC";
  }
}
function tzLabel_(d, tz) {
  var p = Utilities.formatDate(d, tz, "yyyy-MM-dd HH:mm").split(/[- :]/).map(Number);
  var off = Math.round((Date.UTC(p[0], p[1] - 1, p[2], p[3], p[4]) - Math.floor(d.getTime() / 6e4) * 6e4) / 6e4);
  var sign = off < 0 ? "-" : "+", a = Math.abs(off), utc = "UTC" + (off ? sign + Math.floor(a / 60) + (a % 60 ? ":" + (a % 60 < 10 ? "0" : "") + a % 60 : "") : "");
  if (tz === "UTC" || tz === "Etc/UTC") return "UTC";
  return String(tz).split("/").pop().replace(/_/g, " ") + " time, " + utc;
}
function fmtWhen_(t) {
  var d = new Date(t);
  if (isNaN(d)) return String(t || "");
  try {
    var tz = officialTz_(), hm = Utilities.formatDate(d, tz, "HH:mm"), out;
    if (hm === "00:00") out = Utilities.formatDate(new Date(d.getTime() - 432e5), tz, "EEE d MMM yyyy") + ", 23:59";
    else if (hm === "12:00") out = Utilities.formatDate(d, tz, "EEE d MMM yyyy") + ", 12:00 noon";
    else out = Utilities.formatDate(d, tz, "EEE d MMM yyyy, HH:mm");
    return out + " (" + tzLabel_(d, tz) + ")";
  } catch (e) {
    return d.toUTCString();
  }
}
function iso_(x) {
  return x instanceof Date ? x.toISOString() : String(x == null ? "" : x).trim();
}
function scheduleMap_() {
  var cache = CacheService.getScriptCache(), c = cache.get("sched");
  if (c) return JSON.parse(c);
  var v = catSheet_(SHEETS.schedule, SCHEDULE_COLS).getDataRange().getValues(), m = {};
  for (var i = 1; i < v.length; i++) if (v[i][0])
    m[normCourse_(v[i][0])] = {
      course: String(v[i][0]),
      duration_minutes: int_(v[i][1], 0) || "",
      opens_at: iso_(v[i][2]),
      last_start_at: iso_(v[i][3]),
      updated_by: String(v[i][4] || ""),
      updated_at: iso_(v[i][5])
    };
  try {
    cache.put("sched", JSON.stringify(m), 600);
  } catch (e) {
  }
  return m;
}
function scheduleFor_(course, m) {
  var k = normCourse_(course);
  return m[k] || m[k.split(" ")[0]] || null;
}
function timingFor_(c, settings) {
  if (isPracticeSitting_(c)) return {
    duration: int_(settings.practice_duration_minutes, 0) || 15,
    opens_at: iso_(settings.practice_opens_at) || "",
    last_start_at: iso_(settings.practice_last_start_at) || "",
    own: true,
    practice: true
  };
  var s = scheduleFor_(c && c.course, scheduleMap_()) || {};
  return {
    duration: int_(s.duration_minutes, 0) || int_(settings.duration_minutes, 60),
    opens_at: s.opens_at || settings.scheduled_start || "",
    last_start_at: s.last_start_at || settings.last_start_at || "",
    own: !!(s.duration_minutes || s.opens_at || s.last_start_at)
  };
}
function lecturerMaySchedule_(me, code) {
  var k = normCourse_(code), mine = false;
  var v = catSheet_(SHEETS.courses, COURSE_COLS).getDataRange().getValues();
  for (var i = 1; i < v.length; i++) if (v[i][1] && normCourse_(v[i][1]) === k) {
    if (String(v[i][0]).toLowerCase() === me) mine = true;
    else return false;
  }
  if (!mine) return false;
  var data = candidateData_();
  return !Object.keys(data.byId).some(function(id) {
    return normCourse_(data.courseById[id]) === k && (String(data.ownerById[id] || "").toLowerCase() !== me || data.studentById[id]);
  });
}
function listSchedule_(d) {
  var t = authAny_(d.token), me = String(t.subject).toLowerCase(), settings = settingsMap_(), sched = scheduleMap_();
  var units = {};
  function unit(code, title) {
    var k = normCourse_(code);
    if (!k) return null;
    var u = units[k] = units[k] || { course: String(code).trim(), title: "", entries: 0, started: 0, submitted: 0 };
    if (title && !u.title) u.title = String(title);
    return u;
  }
  catalogue_(t.lecturer ? t.subject : null).courses.forEach(function(c) {
    unit(c.course_code, c.course_title);
  });
  allCandidateRows_().forEach(function(c) {
    if (!c.course || isPracticeSitting_(c) || t.lecturer && !canSee_(t, c)) return;
    var u = unit(c.course, "");
    if (!u) return;
    u.entries++;
    if (c.started_at) u.started++;
    if (c.current_step === "submitted") u.submitted++;
  });
  if (!t.lecturer) Object.keys(sched).forEach(function(k) {
    unit(sched[k].course, "");
  });
  var rows = Object.keys(units).sort().map(function(k) {
    var u = units[k], s = scheduleFor_(u.course, sched) || {};
    u.duration_minutes = s.duration_minutes || "";
    u.opens_at = s.opens_at || "";
    u.last_start_at = s.last_start_at || "";
    u.updated_by = s.updated_by || "";
    u.updated_at = s.updated_at || "";
    u.editable = !t.lecturer || lecturerMaySchedule_(me, u.course);
    return u;
  });
  return { ok: true, rows, defaults: { duration_minutes: int_(settings.duration_minutes, 60), opens_at: settings.scheduled_start || "", last_start_at: settings.last_start_at || "" } };
}
function saveSchedule_(d) {
  var t = authAny_(d.token), me = String(t.subject).toLowerCase();
  return withLock_(function() {
    var sh = catSheet_(SHEETS.schedule, SCHEDULE_COLS), v = sh.getDataRange().getValues(), at = {}, results = [], appends = [], drop = {};
    for (var i = 1; i < v.length; i++) if (v[i][0]) at[normCourse_(v[i][0])] = i + 1;
    var known = knownCourses_();
    (d.rows || []).slice(0, 5e3).forEach(function(r) {
      var code = String(pick_(r, ["course", "course_code", "course code", "code", "course_unit"]) || "").trim();
      var k = normCourse_(code);
      if (!k) {
        results.push({ course: code, status: "skipped", reason: "Course code is required." });
        return;
      }
      var clearing = r.clear || !String(pick_(r, ["duration_minutes", "duration", "minutes"]) || "").trim() && !String(pick_(r, ["opens_at", "opens", "open", "start", "start_time"]) || "").trim() && !String(pick_(r, ["last_start_at", "latest_start", "last_start", "closes_at", "close"]) || "").trim();
      if (!clearing && isPracticeCode_(code)) {
        results.push({ course: code, status: "skipped", reason: "The practice test has its own time: set it under Uploads \u2192 Practice test for every student." });
        return;
      }
      if (!clearing) {
        var sc = systemCourse_(known, code);
        if (!sc) {
          results.push({ course: code, status: "skipped", reason: "This course unit is not in the system \u2014 " + NOT_IN_SYSTEM_HINT + "." });
          return;
        }
        if (!at[normCourse_(sc)] && at[k]) sc = code;
        code = sc;
        k = normCourse_(sc);
      }
      if (t.lecturer && !lecturerMaySchedule_(me, code)) {
        results.push({ course: code, status: "skipped", reason: "This unit is timetabled by the examinations office." });
        return;
      }
      var dur = String(pick_(r, ["duration_minutes", "duration", "minutes"]) || "").trim();
      var op = String(pick_(r, ["opens_at", "opens", "open", "start", "start_time"]) || "").trim();
      var ls = String(pick_(r, ["last_start_at", "latest_start", "last_start", "closes_at", "close"]) || "").trim();
      if (r.clear || !dur && !op && !ls) {
        if (at[k]) {
          drop[k] = 1;
          results.push({ course: code, status: "cleared" });
        } else results.push({ course: code, status: "unchanged" });
        return;
      }
      if (dur && !(int_(dur, 0) >= 1 && int_(dur, 0) <= 600)) {
        results.push({ course: code, status: "skipped", reason: "Duration must be 1\u2013600 minutes." });
        return;
      }
      var opD = op ? new Date(op) : null, lsD = ls ? new Date(ls) : null;
      if (opD && isNaN(opD) || lsD && isNaN(lsD)) {
        results.push({ course: code, status: "skipped", reason: "Dates must be like 2026-11-03T09:00 (or the ISO time)." });
        return;
      }
      if (opD && lsD && lsD < opD) {
        results.push({ course: code, status: "skipped", reason: "Latest start is before the opening time." });
        return;
      }
      var row = [code, dur ? String(int_(dur, 0)) : "", opD ? opD.toISOString() : "", lsD ? lsD.toISOString() : "", t.subject, now_()];
      if (at[k] > 0) {
        sh.getRange(at[k], 1, 1, row.length).setValues([row]);
        results.push({ course: code, status: "updated" });
      } else {
        appends.push(row);
        at[k] = -1;
        results.push({ course: code, status: "added" });
      }
    });
    if (appends.length) appendRows_(sh, appends, SCHEDULE_COLS.length);
    if (Object.keys(drop).length) removeRowsWhere_(sh, function(r) {
      return drop[normCourse_(r[0])];
    });
    CacheService.getScriptCache().remove("sched");
    clearSummaryCache_();
    var changed = results.filter(function(x) {
      return x.status === "added" || x.status === "updated" || x.status === "cleared";
    });
    if (changed.length) logEvent_("timetable_saved", "", changed.length + " unit(s) by " + t.subject + ": " + changed.slice(0, 10).map(function(x) {
      return x.course;
    }).join(", "));
    return { ok: true, results, saved: changed.length, skipped: results.filter(function(x) {
      return x.status === "skipped";
    }).length };
  });
}
function listLecturers_(d) {
  authStaff_(d.token);
  var data = candidateData_();
  return { ok: true, rows: lecturerSummaries_(monitorSummary_().rows, data, catalogue_(null)) };
}
function saveLecturer_(d) {
  var t = authStaff_(d.token);
  var u = String(d.username || "").trim(), m = staffMap_(), ex = m[u.toLowerCase()];
  if (!/^[A-Za-z0-9._@-]{3,40}$/.test(u)) return { error: "Username: 3\u201340 letters, numbers, dot, dash, underscore or @." };
  var pw = String(d.password || "");
  if (d.mode === "create") {
    if (ex) return { error: "That username is already taken." };
    if (pw.length < 8) return { error: "Password must be at least 8 characters." };
    appendRows_(sheet_(SHEETS.staff), [[
      u,
      makeHash_(pw),
      "lecturer",
      String(d.full_name || u).trim(),
      d.active === false ? "0" : "1",
      now_(),
      "",
      String(d.email || "").trim(),
      String(d.department || "").trim(),
      "1"
    ]], STAFF_COLS.length);
    clearStaffCache_();
    clearSummaryCache_();
    logEvent_("lecturer_created", "", u + " by " + t.subject);
    return { ok: true };
  }
  if (!ex || ex.role !== "lecturer") return { error: "Lecturer not found." };
  if (pw && pw.length < 8) return { error: "New password must be at least 8 characters." };
  var patch = {
    full_name: String(d.full_name || "").trim() || ex.full_name,
    email: String(d.email || "").trim(),
    department: String(d.department || "").trim(),
    active: d.active === false ? "0" : "1"
  };
  if (pw) {
    patch.password_hash = makeHash_(pw);
    patch.must_change = "1";
    throttleClear_("staff", ex.username);
  }
  patchStaff_(ex.username, patch);
  clearSummaryCache_();
  logEvent_("lecturer_updated", "", ex.username + " by " + t.subject);
  return { ok: true };
}
function deleteLecturer_(d) {
  var t = authStaff_(d.token);
  var u = String(d.username || "").toLowerCase(), ex = staffMap_()[u];
  if (!ex || ex.role !== "lecturer") return { error: "Lecturer not found." };
  removeRowsWhere_(sheet_(SHEETS.staff), function(r) {
    return String(r[0]).toLowerCase() === u && r[2] === "lecturer";
  });
  clearStaffCache_();
  var out = { ok: true, students: 0, questions: 0 };
  if (d.purge) {
    var mine = allCandidateRows_().filter(function(c) {
      return String(c.owner || "").toLowerCase() === u;
    }).map(function(c) {
      return c.exam_taker_id;
    });
    if (mine.length) out.students = deleteStudents_({ token: d.token, ids: mine }).removed;
    var qset = {};
    (candidateData_().qByOwner[u] || []).forEach(function(q) {
      qset[q] = 1;
    });
    out.questions = removeRowsWhere_(sheet_(SHEETS.questions), function(r) {
      return qset[String(r[0])];
    });
    removeRowsWhere_(sheet_(SHEETS.assign), function(r) {
      return qset[String(r[1])];
    });
    removeRowsWhere_(catSheet_(SHEETS.programmes, PROGRAMME_COLS), function(r) {
      return String(r[0]).toLowerCase() === u;
    });
    removeRowsWhere_(catSheet_(SHEETS.courses, COURSE_COLS), function(r) {
      return String(r[0]).toLowerCase() === u;
    });
  }
  clearDataCache_();
  logEvent_("lecturer_removed", "", ex.username + (d.purge ? " with data" : "") + " by " + t.subject);
  return out;
}
var LIVE_ROW_ = null;
var CDATA_MEMO_ = null;
function candidateData_() {
  if (CDATA_MEMO_) return CDATA_MEMO_;
  var cached = cacheGetLarge_("cdata");
  if (cached) {
    CDATA_MEMO_ = cached;
    return cached;
  }
  var byUser = {}, byId = {}, rowById = {}, ownerById = {}, courseById = {};
  var OI = CAND_COLS.indexOf("owner"), CI = CAND_COLS.indexOf("course"), PI = CAND_COLS.indexOf("programme"), SI = CAND_COLS.indexOf("student_id");
  var progById = {}, studentById = {}, sitsByStudent = {};
  var csh = sheet_(SHEETS.candidates), last = csh.getLastRow(), cs = [[]];
  if (last >= 2) {
    var left = csh.getRange(2, 1, last - 1, CI + 1).getValues(), right = csh.getRange(2, OI + 1, last - 1, SI - OI + 1).getValues();
    for (var x = 0; x < left.length; x++) {
      var full = left[x].slice();
      full.length = CAND_COLS.length;
      for (var y = 0; y < right[x].length; y++) full[OI + y] = right[x][y];
      cs.push(full);
    }
  }
  for (var i = 1; i < cs.length; i++) {
    if (!cs[i][0]) continue;
    var row = { exam_taker_id: String(cs[i][0]), username: cs[i][1], full_name: cs[i][3] };
    if (String(row.username) !== "") byUser[String(row.username).toLowerCase()] = row;
    if (cs[i][PI]) progById[row.exam_taker_id] = String(cs[i][PI]);
    if (cs[i][SI]) {
      studentById[row.exam_taker_id] = String(cs[i][SI]);
      (sitsByStudent[String(cs[i][SI])] = sitsByStudent[String(cs[i][SI])] || []).push(row.exam_taker_id);
    }
    byId[row.exam_taker_id] = 1;
    rowById[row.exam_taker_id] = i + 1;
    if (cs[i][OI]) ownerById[row.exam_taker_id] = String(cs[i][OI]);
    if (cs[i][CI]) courseById[row.exam_taker_id] = String(cs[i][CI]);
  }
  var qs = sheet_(SHEETS.questions).getDataRange().getValues();
  var questions = {}, byArea = {}, qorder = [], qByOwner = {};
  for (var j = 1; j < qs.length; j++) {
    if (!qs[j][0]) continue;
    var qid = String(qs[j][0]), area = String(qs[j][1] || "General"), qowner = String(qs[j][10] || "");
    questions[qid] = {
      question_id: qid,
      area,
      question_text: qs[j][2],
      option_a: qs[j][3],
      option_b: qs[j][4],
      option_c: qs[j][5],
      option_d: qs[j][6],
      correct_answer: qs[j][7],
      marks: qs[j][8],
      course: String(qs[j][9] || ""),
      owner: qowner,
      updated_at: qs[j][11] instanceof Date ? qs[j][11].toISOString() : String(qs[j][11] || "")
    };
    if (qowner) {
      (qByOwner[qowner.toLowerCase()] = qByOwner[qowner.toLowerCase()] || []).push(qid);
      continue;
    }
    (byArea[area] = byArea[area] || []).push(qid);
    qorder.push(qid);
  }
  var as = sheet_(SHEETS.assign).getDataRange().getValues(), pairs = [];
  for (var k = 1; k < as.length; k++) if (as[k][0]) pairs.push([String(as[k][0]), String(as[k][1]), as[k][2]]);
  pairs.sort(function(a, b) {
    return (a[2] || 0) - (b[2] || 0);
  });
  var assignById = {};
  pairs.forEach(function(p) {
    (assignById[p[0]] = assignById[p[0]] || []).push(p[1]);
  });
  var courseLects = {}, courseTitle = {};
  var cv = ensureSheet_(SpreadsheetApp.getActiveSpreadsheet(), SHEETS.courses, COURSE_COLS).getDataRange().getValues();
  for (var c = 1; c < cv.length; c++) {
    if (!cv[c][1]) continue;
    var ck = normCourse_(cv[c][3]) + "|" + normCourse_(cv[c][1]);
    if (!courseTitle[normCourse_(cv[c][1])] && cv[c][2]) courseTitle[normCourse_(cv[c][1])] = String(cv[c][2]);
    if (!cv[c][0]) continue;
    var lst = courseLects[ck] = courseLects[ck] || [];
    var ow = String(cv[c][0]).toLowerCase();
    if (lst.indexOf(ow) < 0) lst.push(ow);
  }
  var out = {
    byUser,
    byId,
    rowById,
    assignById,
    questions,
    byArea,
    qorder,
    ownerById,
    courseById,
    qByOwner,
    progById,
    studentById,
    sitsByStudent,
    courseLects,
    courseTitle
  };
  cachePutLarge_("cdata", out, CACHE_SECONDS);
  CDATA_MEMO_ = out;
  return out;
}
var ROW_HINT_ = {}, ROW_OK_ = {};
function rowNumFor_(examId) {
  if (ROW_OK_[examId]) return ROW_OK_[examId];
  var data = candidateData_();
  var rowNum = data.rowById[examId];
  if (!rowNum) {
    clearDataCache_();
    rowNum = candidateData_().rowById[examId];
  }
  return rowNum || 0;
}
function patchCandidate_(examId, patch) {
  var rowNum = rowNumFor_(examId);
  if (!rowNum) return;
  var cells = [];
  Object.keys(patch).forEach(function(k) {
    var ci = CAND_COLS.indexOf(k);
    if (ci >= 0) cells.push([ci, patch[k]]);
  });
  if (!cells.length) return;
  cells.sort(function(a, b) {
    return a[0] - b[0];
  });
  var sh = sheet_(SHEETS.candidates), run = [cells[0]];
  function flush() {
    sh.getRange(rowNum, run[0][0] + 1, 1, run.length).setValues([run.map(function(x) {
      return x[1];
    })]);
  }
  for (var i = 1; i < cells.length; i++) {
    if (cells[i][0] === run[run.length - 1][0] + 1) run.push(cells[i]);
    else {
      flush();
      run = [cells[i]];
    }
  }
  flush();
}
function candidateRow_(examId) {
  examId = String(examId);
  var sh = sheet_(SHEETS.candidates), hint = ROW_HINT_[examId], vals;
  if (hint > 1) {
    vals = sh.getRange(hint, 1, 1, CAND_COLS.length).getValues()[0];
    if (String(vals[0]) !== examId) vals = null;
  }
  var rowNum = vals ? hint : rowNumFor_(examId);
  if (!rowNum) return null;
  if (!vals) vals = sh.getRange(rowNum, 1, 1, CAND_COLS.length).getValues()[0];
  if (String(vals[0]) !== examId) return null;
  ROW_OK_[examId] = rowNum;
  var o = {};
  for (var i = 0; i < CAND_COLS.length; i++) o[CAND_COLS[i]] = vals[i];
  o.exam_taker_id = examId;
  return o;
}
function candidateRowsFor_(ids) {
  var data = candidateData_(), nums = [];
  ids.forEach(function(id) {
    var n = data.rowById[id];
    if (n > 0) nums.push(n);
  });
  if (!nums.length) return [];
  nums.sort(function(a, b) {
    return a - b;
  });
  var lo = nums[0], hi = nums[nums.length - 1], sh = sheet_(SHEETS.candidates), out = [];
  var toObj = function(vals) {
    var o = {};
    for (var c = 0; c < CAND_COLS.length; c++) o[CAND_COLS[c]] = vals[c];
    o.exam_taker_id = String(o.exam_taker_id);
    return o;
  };
  if (hi - lo + 1 <= nums.length * 4 + 20) {
    var block = sh.getRange(lo, 1, hi - lo + 1, CAND_COLS.length).getValues();
    nums.forEach(function(n) {
      var o = toObj(block[n - lo]);
      if (o.exam_taker_id) out.push(o);
    });
  } else nums.forEach(function(n) {
    var o = toObj(sh.getRange(n, 1, 1, CAND_COLS.length).getValues()[0]);
    if (o.exam_taker_id) out.push(o);
  });
  return out;
}
function allCandidateRows_() {
  var sh = sheet_(SHEETS.candidates);
  var last = sh.getLastRow(), out = [];
  if (last < 2) return out;
  var cs = sh.getRange(2, 1, last - 1, CAND_COLS.length).getValues();
  for (var i = 0; i < cs.length; i++) {
    var r = {};
    for (var c = 0; c < CAND_COLS.length; c++) r[CAND_COLS[c]] = cs[i][c];
    if (r.exam_taker_id) {
      r.exam_taker_id = String(r.exam_taker_id);
      out.push(r);
    }
  }
  return out;
}
function staffMap_() {
  var cache = CacheService.getScriptCache(), c = cache.get("staffmap");
  if (c) return JSON.parse(c);
  var v = sheet_(SHEETS.staff).getDataRange().getValues(), m = {};
  for (var i = 1; i < v.length; i++) {
    if (!v[i][0]) continue;
    m[String(v[i][0]).toLowerCase()] = {
      username: String(v[i][0]),
      password_hash: v[i][1],
      role: v[i][2],
      full_name: v[i][3],
      active: String(v[i][4]),
      created_at: v[i][5] || "",
      last_login: v[i][6] || "",
      email: v[i][7] || "",
      department: v[i][8] || "",
      must_change: String(v[i][9] || "")
    };
  }
  try {
    cache.put("staffmap", JSON.stringify(m), 120);
  } catch (e) {
  }
  return m;
}
function clearStaffCache_() {
  CacheService.getScriptCache().remove("staffmap");
}
function patchStaff_(username, patch) {
  var sh = sheet_(SHEETS.staff), v = sh.getDataRange().getValues();
  for (var i = 1; i < v.length; i++) if (String(v[i][0]).toLowerCase() === String(username).toLowerCase()) {
    for (var col in patch) {
      var ci = STAFF_COLS.indexOf(col);
      if (ci >= 0) sh.getRange(i + 1, ci + 1).setValue(patch[col]);
    }
    break;
  }
  clearStaffCache_();
}
function observerMap_() {
  var v = sheet_(SHEETS.observers).getDataRange().getValues(), m = {};
  var iso = function(x) {
    return x instanceof Date ? x.toISOString() : String(x || "");
  };
  for (var i = 1; i < v.length; i++) if (v[i][0])
    m[v[i][0]] = { label: v[i][1], active: String(v[i][2]), created_at: iso(v[i][3]), expires_at: iso(v[i][4]), show_scores: String(v[i][5] || "0") };
  return m;
}
function observerExpiry_(o) {
  if (!o) return (/* @__PURE__ */ new Date(0)).toISOString();
  if (o.expires_at) return o.expires_at;
  var made = new Date(o.created_at).getTime();
  return new Date((isNaN(made) ? 0 : made) + OBSERVER_LEGACY_DAYS * 864e5).toISOString();
}
function observerOk_(o) {
  return !!o && o.active !== "0" && Date.now() <= new Date(observerExpiry_(o)).getTime();
}
function settingsMap_() {
  var cache = CacheService.getScriptCache(), c = cache.get("settings");
  if (c) return JSON.parse(c);
  var v = sheet_(SHEETS.settings).getDataRange().getValues(), m = {};
  for (var i = 1; i < v.length; i++) if (v[i][0]) m[v[i][0]] = v[i][1] instanceof Date ? v[i][1].toISOString() : String(v[i][1]);
  try {
    cache.put("settings", JSON.stringify(m), 300);
  } catch (e) {
  }
  return m;
}
function makeToken_(role, subject, pwHash, rowHint) {
  var tail = pwHash ? pwFingerprint_(pwHash) : rowHint > 0 ? "r" + rowHint : "";
  var b = Utilities.base64EncodeWebSafe(role + "|" + subject + "|" + (Date.now() + TOKEN_TTL_MS) + "|" + tail);
  return b + "." + sign_(b);
}
function pwFingerprint_(h) {
  return sign_("pw|" + h).slice(0, 16);
}
function readToken_(token) {
  if (!token || String(token).indexOf(".") < 0) return null;
  var parts = String(token).split(".");
  if (sign_(parts[0]) !== parts[1]) return null;
  var payload = Utilities.newBlob(Utilities.base64DecodeWebSafe(parts[0])).getDataAsString().split("|");
  if (parseInt(payload[2], 10) < Date.now()) return null;
  return { role: payload[0], subject: payload[1], fp: payload[3] || "" };
}
function authCand_(token) {
  var t = readToken_(token);
  if (!t || t.role !== "cand") throw new Error("Session expired. Please sign in again.");
  if (/^r\d+$/.test(t.fp || "")) ROW_HINT_[t.subject] = parseInt(t.fp.slice(1), 10);
  return t.subject;
}
function authAny_(token, allowMustChange) {
  var t = readToken_(token);
  if (!t || ["admin", "superadmin", "lecturer"].indexOf(t.role) < 0) throw new Error("Not authorised. Please sign in again.");
  var s = staffMap_()[String(t.subject).toLowerCase()];
  if (!s || s.active === "0" || s.role !== t.role) throw new Error("Your account is not active. Please contact the examinations office.");
  if (t.fp !== pwFingerprint_(s.password_hash)) throw new Error("Your password was changed. Please sign in again.");
  if (s.must_change === "1" && !allowMustChange) throw new Error("Choose a new password under My account before continuing.");
  t.lecturer = t.role === "lecturer";
  t.full_name = s.full_name || s.username;
  return t;
}
function authStaff_(token) {
  var t = authAny_(token);
  if (t.lecturer) throw new Error("Not authorised. Please sign in again.");
  return t;
}
function isStaff_(token) {
  try {
    authStaff_(token);
    return true;
  } catch (e) {
    return false;
  }
}
function requireSuper_(token) {
  var t = authStaff_(token);
  if (t.role !== "superadmin") throw new Error("Superadmin only.");
  return t;
}
function lecturersFor_(data, programme, course) {
  if (!course || !data.courseLects) return [];
  return data.courseLects[normCourse_(programme) + "|" + normCourse_(course)] || [];
}
function canSee_(t, c) {
  if (!c) return false;
  if (!t.lecturer) return true;
  var me = String(t.subject).toLowerCase();
  if (String(c.owner || "").toLowerCase() === me) return true;
  return lecturersFor_(candidateData_(), c.programme, c.course).indexOf(me) >= 0;
}
function canEdit_(t, c) {
  if (!c) return false;
  if (!t.lecturer) return true;
  return String(c.owner || "").toLowerCase() === String(t.subject).toLowerCase() && !c.student_id;
}
function rowLects_(data, c) {
  var l = lecturersFor_(data, c.programme, c.course).slice();
  if (c.owner && l.indexOf(String(c.owner).toLowerCase()) < 0) l.unshift(String(c.owner).toLowerCase());
  return l;
}
function lectNames_(names, lects, owner) {
  if (!lects.length) return "";
  return lects.map(function(u) {
    return names[u] || u + " (removed)";
  }).join(", ");
}
function sheet_(name) {
  return SpreadsheetApp.getActiveSpreadsheet().getSheetByName(name);
}
function now_() {
  return (/* @__PURE__ */ new Date()).toISOString();
}
function stamp_() {
  return (/* @__PURE__ */ new Date()).toISOString().replace(/[-:]/g, "").replace(/\..*$/, "");
}
function int_(v, def) {
  var n = parseInt(v, 10);
  return isNaN(n) ? def : n;
}
function round2_(n) {
  return Math.round(n * 100) / 100;
}
function num_(v, def) {
  var n = parseFloat(String(v == null ? "" : v).trim().replace(",", "."));
  return isFinite(n) ? round2_(n) : def;
}
function mark_(v) {
  var n = num_(v, 1);
  return n > 0 ? n : 1;
}
function markPerQuestion_(settings) {
  var n = num_(settings && settings.mark_per_question, 0);
  return n > 0 ? n : 0;
}
function questionMark_(q, settings) {
  return markPerQuestion_(settings) || mark_(q.marks);
}
function json_(obj) {
  return ContentService.createTextOutput(JSON.stringify(obj)).setMimeType(ContentService.MimeType.JSON);
}
function html_(msg) {
  return HtmlService.createHtmlOutput(`<p style="font:16px 'Times New Roman',serif;padding:24px">` + msg + "</p>");
}
function scriptProp_(k, v) {
  var p = PropertiesService.getScriptProperties();
  if (v !== void 0) {
    p.setProperty(k, v);
    return v;
  }
  return p.getProperty(k);
}
function sign_(s) {
  var raw = Utilities.computeHmacSha256Signature(s, scriptProp_("APP_SECRET") || "kiu-secret");
  return Utilities.base64EncodeWebSafe(raw);
}
function hash_(s) {
  var raw = Utilities.computeDigest(Utilities.DigestAlgorithm.SHA_256, String(s) + "|" + (scriptProp_("APP_SECRET") || "kiu-secret"));
  return Utilities.base64EncodeWebSafe(raw);
}
var SECRET_BYTES_ = null;
function secretBytes_() {
  if (!SECRET_BYTES_) SECRET_BYTES_ = Utilities.newBlob(scriptProp_("APP_SECRET") || "kiu-secret").getBytes();
  return SECRET_BYTES_;
}
function pwDigest_(pw, salt) {
  var key = secretBytes_();
  var h = Utilities.computeHmacSha256Signature(Utilities.newBlob(salt + "|" + String(pw)).getBytes(), key);
  for (var i = 1; i < PW_ROUNDS; i++) h = Utilities.computeHmacSha256Signature(h, key);
  return Utilities.base64EncodeWebSafe(h);
}
function makeHash_(pw) {
  var salt = Utilities.getUuid().replace(/-/g, "").slice(0, 16);
  return "v2$" + salt + "$" + pwDigest_(pw, salt);
}
function verifyPassword_(pw, stored) {
  stored = String(stored || "");
  if (!stored) return { ok: false };
  if (stored.indexOf("v2$") === 0) {
    var parts = stored.split("$");
    return { ok: parts.length === 3 && pwDigest_(pw, parts[1]) === parts[2], legacy: false };
  }
  return { ok: hash_(pw) === stored, legacy: true };
}
function setStudentHash_(studentId, h) {
  var sh = ensureSheet_(SpreadsheetApp.getActiveSpreadsheet(), SHEETS.students, STUDENT_COLS), v = sh.getRange(1, 1, Math.max(1, sh.getLastRow()), 1).getValues();
  for (var i = 1; i < v.length; i++) if (String(v[i][0]) === String(studentId)) {
    sh.getRange(i + 1, 3).setValue(h);
    return;
  }
}
function throttleKey_(kind, user) {
  return "fail:" + kind + ":" + String(user || "").trim().toLowerCase();
}
function throttleCheck_(kind, user) {
  var n = int_(CacheService.getScriptCache().get(throttleKey_(kind, user)), 0), L = LOGIN_LIMITS[kind];
  return n >= L.max ? "Too many unsuccessful sign-in attempts. Wait " + Math.round(L.secs / 60) + " minutes and try again, or ask the examinations office to reset your password." : "";
}
function throttleFail_(kind, user) {
  var c = CacheService.getScriptCache(), k = throttleKey_(kind, user), L = LOGIN_LIMITS[kind];
  var n = int_(c.get(k), 0) + 1;
  c.put(k, String(n), L.secs);
  if (n === L.max) logEvent_("signin_locked", "", kind + " " + String(user).slice(0, 80));
}
function throttleClear_(kind, user) {
  if (user) CacheService.getScriptCache().remove(throttleKey_(kind, user));
}
function hashInt_(s) {
  var h = 0;
  s = String(s);
  for (var i = 0; i < s.length; i++) h = h * 31 + s.charCodeAt(i) & 2147483647;
  return h || 1;
}
function pick_(row, keys) {
  for (var i = 0; i < keys.length; i++) {
    var k = keys[i];
    if (row[k] != null && String(row[k]).trim() !== "") return String(row[k]).trim();
    for (var rk in row) if (rk.toLowerCase() === k.toLowerCase() && String(row[rk]).trim() !== "") return String(row[rk]).trim();
  }
  return "";
}
function indexBy_(sh, colName) {
  var v = sh.getDataRange().getValues(), ci = v[0].indexOf(colName), m = {};
  for (var i = 1; i < v.length; i++) if (v[i][ci] !== "") m[String(v[i][ci])] = i + 1;
  return m;
}
function logEvent_(event, examId, detail) {
  try {
    sheet_(SHEETS.activity).appendRow([now_(), event, examId, detail || ""]);
  } catch (e) {
  }
}
function logEvents_(examId, events) {
  try {
    var rows = events.slice(0, 30).map(function(e) {
      return [String(e.at || now_()), String(e.event || "event").slice(0, 60), examId, String(e.detail || "").slice(0, 300)];
    });
    var sh = sheet_(SHEETS.activity);
    rows.forEach(function(r) {
      sh.appendRow(r);
    });
  } catch (err) {
  }
}
var LOCK_DEPTH_ = 0;
function withLock_(fn, ms) {
  if (LOCK_DEPTH_ > 0) return fn();
  var lock = LockService.getScriptLock();
  lock.waitLock(ms || 2e4);
  LOCK_DEPTH_++;
  try {
    return fn();
  } finally {
    LOCK_DEPTH_--;
    lock.releaseLock();
  }
}
function appendRows_(sh, rows, width) {
  if (!rows || !rows.length) return;
  withLock_(function() {
    appendRowsUnlocked_(sh, rows, width);
  });
}
function appendRowsUnlocked_(sh, rows, width) {
  var start = sh.getLastRow() + 1, need = start + rows.length - 1, max = sh.getMaxRows();
  if (need > max) {
    var add = need - max + 200;
    sh.insertRowsAfter(max, add);
    try {
      sh.getRange(max + 1, 1, add, sh.getMaxColumns()).setNumberFormat("@");
    } catch (e) {
    }
  }
  sh.getRange(start, 1, rows.length, width).setValues(rows);
}
function safeParse_(s, def) {
  try {
    return JSON.parse(s);
  } catch (e) {
    return def;
  }
}
function clearSummaryCache_() {
  CacheService.getScriptCache().removeAll(["summary", "obsdata:0", "obsdata:1"]);
}
function clearDataCache_() {
  CDATA_MEMO_ = null;
  cacheDelLarge_("cdata");
  CacheService.getScriptCache().removeAll(["summary", "obsdata:0", "obsdata:1", "settings", "studmap", "sched"]);
}
function cachePutLarge_(key, obj, ttl) {
  var s = JSON.stringify(obj), size = 9e4, chunks = Math.ceil(s.length / size), c = CacheService.getScriptCache(), map = {};
  for (var i = 0; i < chunks; i++) map[key + "." + i] = s.substr(i * size, size);
  map[key + ".n"] = String(chunks);
  try {
    c.putAll(map, ttl);
  } catch (e) {
  }
}
function cacheGetLarge_(key) {
  var c = CacheService.getScriptCache(), n = c.get(key + ".n");
  if (!n) return null;
  n = parseInt(n, 10);
  var keys = [];
  for (var i = 0; i < n; i++) keys.push(key + "." + i);
  var got = c.getAll(keys), s = "";
  for (var j = 0; j < n; j++) {
    if (got[key + "." + j] == null) return null;
    s += got[key + "." + j];
  }
  return safeParse_(s, null);
}
function cacheDelLarge_(key) {
  var c = CacheService.getScriptCache(), n = c.get(key + ".n");
  if (!n) return;
  n = parseInt(n, 10);
  var keys = [key + ".n"];
  for (var i = 0; i < n; i++) keys.push(key + "." + i);
  c.removeAll(keys);
}
