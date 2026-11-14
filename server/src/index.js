/*! © 2026 Michael Adelani Adewusi · Adelani Super Intelligent Agents. All rights reserved. No part or section of this application may be copied. */
// Handwritten Theory Grader — server.
// Serves the browser app, handles sign-in and super-admin user management,
// and proxies AI reading/grading so the Anthropic key never leaves the server.
import express from 'express';
import crypto from 'node:crypto';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { createStore } from './store.js';
import {
  createAuth, publicUser, hashPassword, verifyPassword, passwordProblem,
  temporaryPassword, normEmail, validEmail, ROLES
} from './auth.js';
import * as aiDefault from './ai.js';

const here = path.dirname(fileURLToPath(import.meta.url));

export function createApp(options = {}) {
  const env = { ...process.env, ...(options.env || {}) };
  const ai = options.ai || aiDefault;
  const store = createStore(env.DATA_DIR || path.resolve(here, '../data'));
  const { db } = store;
  const secureCookies = env.COOKIE_SECURE ? env.COOKIE_SECURE === 'true' : env.NODE_ENV === 'production';
  const auth = createAuth(store, { secureCookies });
  const aiEnabled = !!(env.ANTHROPIC_API_KEY || options.ai);
  const graderDir = env.GRADER_DIR || path.resolve(here, '../../grader');

  const boot = auth.bootstrapSuperAdmin(env.SUPERADMIN_EMAIL, env.SUPERADMIN_PASSWORD);
  if (boot && boot !== 'created') console.warn('[setup] ' + boot);
  if (boot === 'created') console.log('[setup] Super admin account created for ' + normEmail(env.SUPERADMIN_EMAIL) + '.');

  const app = express();
  app.disable('x-powered-by');
  if (env.TRUST_PROXY !== 'false') app.set('trust proxy', 1); // hosts such as Render/Railway sit behind one proxy

  // ------------------------------------------------------------ security headers
  app.use((req, res, next) => {
    res.setHeader('X-Content-Type-Options', 'nosniff');
    res.setHeader('X-Frame-Options', 'DENY');
    res.setHeader('Referrer-Policy', 'same-origin');
    res.setHeader('Permissions-Policy', 'camera=(self), microphone=(), geolocation=()');
    res.setHeader('Content-Security-Policy', [
      "default-src 'self'",
      // Tesseract runs as WebAssembly in a blob: worker; PDF.js uses a worker too.
      "script-src 'self' 'wasm-unsafe-eval' blob:",
      "worker-src 'self' blob:",
      "style-src 'self' 'unsafe-inline'",
      "img-src 'self' data: blob:",
      "font-src 'self'",
      "connect-src 'self' blob: data:",
      "frame-ancestors 'none'",
      "base-uri 'self'",
      "form-action 'self'"
    ].join('; '));
    if (secureCookies) res.setHeader('Strict-Transport-Security', 'max-age=15552000');
    next();
  });

  app.use('/api', express.json({ limit: '20mb' }));
  // CSRF defence on top of SameSite=Strict cookies: state-changing calls must
  // carry a custom header, which other sites cannot send cross-origin.
  app.use('/api', (req, res, next) => {
    if (req.method !== 'GET' && req.get('x-requested-with') !== 'grader') return res.status(403).json({ error: 'Missing request header.' });
    next();
  });
  app.use('/api', auth.loadUser);

  // ------------------------------------------------------------ public
  app.get('/api/health', (req, res) => res.json({ ok: true, ai: aiEnabled, setupNeeded: db.users.length === 0 }));

  app.post('/api/auth/login', auth.login);
  app.post('/api/auth/logout', (req, res) => { auth.endSession(req, res); res.json({ ok: true }); });

  // ------------------------------------------------------------ signed-in user
  const monthKey = d => new Date(d).toISOString().slice(0, 7);
  function pagesThisMonth(userId) {
    const m = monthKey(Date.now());
    return db.usage.filter(u => u.userId === userId && u.kind === 'read' && monthKey(u.at) === m).length;
  }

  app.get('/api/me', auth.requireUser, (req, res) => {
    res.json({
      user: publicUser(req.user),
      ai: { enabled: aiEnabled, model: ai.MODEL },
      usage: { pagesThisMonth: pagesThisMonth(req.user.id), monthlyPageLimit: req.user.monthlyPageLimit || 0 }
    });
  });

  app.post('/api/auth/password', auth.requireUser, (req, res) => {
    const { current, next } = req.body || {};
    if (!verifyPassword(String(current || ''), req.user.passwordHash)) return res.status(400).json({ error: 'Current password is wrong.' });
    const problem = passwordProblem(next);
    if (problem) return res.status(400).json({ error: problem });
    if (next === current) return res.status(400).json({ error: 'Choose a password different from the current one.' });
    req.user.passwordHash = hashPassword(next);
    req.user.mustChangePassword = false;
    auth.endUserSessions(req.user.id, req.sessionHash); // sign out other devices
    store.save();
    res.json({ user: publicUser(req.user) });
  });

  // ------------------------------------------------------------ super admin: users
  const admin = express.Router();
  admin.use(auth.requireUser, auth.requireSuperAdmin);

  admin.get('/users', (req, res) => {
    const m = monthKey(Date.now());
    res.json({
      users: db.users.map(u => ({
        ...publicUser(u),
        pagesThisMonth: db.usage.filter(x => x.userId === u.id && x.kind === 'read' && monthKey(x.at) === m).length,
        gradesThisMonth: db.usage.filter(x => x.userId === u.id && x.kind === 'grade' && monthKey(x.at) === m).length
      }))
    });
  });

  admin.post('/users', (req, res) => {
    const b = req.body || {};
    const email = normEmail(b.email);
    if (!validEmail(email)) return res.status(400).json({ error: 'Enter a valid e-mail address.' });
    if (db.users.some(u => u.email === email)) return res.status(409).json({ error: 'An account with this e-mail already exists.' });
    const role = ROLES.includes(b.role) ? b.role : 'lecturer';
    const name = String(b.name || '').trim().slice(0, 100) || email.split('@')[0];
    let password = b.password ? String(b.password) : '';
    let generated = false;
    if (password) {
      const problem = passwordProblem(password);
      if (problem) return res.status(400).json({ error: problem });
    } else { password = temporaryPassword(); generated = true; }
    const user = {
      id: crypto.randomUUID(), email, name, role, passwordHash: hashPassword(password),
      mustChangePassword: true, monthlyPageLimit: Math.max(0, parseInt(b.monthlyPageLimit, 10) || 0),
      createdAt: new Date().toISOString(), createdBy: req.user.id
    };
    db.users.push(user);
    store.save();
    // The temporary password is returned once, for the admin to pass on; it is never stored in plain text.
    res.status(201).json({ user: publicUser(user), temporaryPassword: generated ? password : undefined });
  });

  function superAdminsLeft(excludeId) {
    return db.users.filter(u => u.role === 'superadmin' && !u.disabled && u.id !== excludeId).length;
  }

  admin.patch('/users/:id', (req, res) => {
    const u = db.users.find(x => x.id === req.params.id);
    if (!u) return res.status(404).json({ error: 'User not found.' });
    const b = req.body || {};
    if (b.name !== undefined) u.name = String(b.name).trim().slice(0, 100) || u.name;
    if (b.monthlyPageLimit !== undefined) u.monthlyPageLimit = Math.max(0, parseInt(b.monthlyPageLimit, 10) || 0);
    if (b.role !== undefined) {
      if (!ROLES.includes(b.role)) return res.status(400).json({ error: 'Unknown role.' });
      if (u.role === 'superadmin' && b.role !== 'superadmin' && !superAdminsLeft(u.id)) return res.status(400).json({ error: 'There must be at least one active super admin.' });
      u.role = b.role;
    }
    if (b.disabled !== undefined) {
      if (b.disabled && u.id === req.user.id) return res.status(400).json({ error: 'You cannot disable your own account.' });
      if (b.disabled && u.role === 'superadmin' && !superAdminsLeft(u.id)) return res.status(400).json({ error: 'There must be at least one active super admin.' });
      u.disabled = !!b.disabled;
      if (u.disabled) auth.endUserSessions(u.id);
    }
    let temporary;
    if (b.resetPassword) {
      temporary = temporaryPassword();
      u.passwordHash = hashPassword(temporary);
      u.mustChangePassword = true;
      auth.endUserSessions(u.id, u.id === req.user.id ? req.sessionHash : undefined);
    }
    store.save();
    res.json({ user: publicUser(u), temporaryPassword: temporary });
  });

  admin.delete('/users/:id', (req, res) => {
    const u = db.users.find(x => x.id === req.params.id);
    if (!u) return res.status(404).json({ error: 'User not found.' });
    if (u.id === req.user.id) return res.status(400).json({ error: 'You cannot delete your own account.' });
    if (u.role === 'superadmin' && !superAdminsLeft(u.id)) return res.status(400).json({ error: 'There must be at least one active super admin.' });
    db.users = db.users.filter(x => x.id !== u.id);
    store.db.users = db.users;
    auth.endUserSessions(u.id);
    store.save();
    res.json({ ok: true });
  });

  app.use('/api/admin', admin);

  // ------------------------------------------------------------ AI (signed-in users)
  const aiRoutes = express.Router();
  aiRoutes.use(auth.requireUser, (req, res, next) => {
    if (!aiEnabled) return res.status(503).json({ error: 'AI reading is not configured on this server (ANTHROPIC_API_KEY is missing).' });
    next();
  });

  function record(userId, kind, usage) {
    db.usage.push({ userId, kind, at: new Date().toISOString(), input: usage && usage.input_tokens || 0, output: usage && usage.output_tokens || 0 });
    if (db.usage.length > 200000) db.usage.splice(0, db.usage.length - 200000);
    store.save();
  }

  const IMAGE_TYPES = /^image\/(jpeg|png|webp|gif)$/;
  const b64ok = s => typeof s === 'string' && s.length > 100 && s.length < 20 * 1024 * 1024 && /^[A-Za-z0-9+/=]+$/.test(s.slice(0, 2000));

  const wrap = fn => async (req, res) => {
    try { await fn(req, res); } catch (e) {
      if (e instanceof ai.AIError) return res.status(e.status).json({ error: e.message });
      console.error(e);
      res.status(500).json({ error: 'Unexpected server error.' });
    }
  };

  aiRoutes.post('/read', wrap(async (req, res) => {
    const { image, mediaType } = req.body || {};
    if (!IMAGE_TYPES.test(mediaType || '') || !b64ok(image)) return res.status(400).json({ error: 'Send a JPEG, PNG or WebP page image.' });
    const limit = req.user.monthlyPageLimit || 0;
    if (limit && pagesThisMonth(req.user.id) >= limit) return res.status(429).json({ error: `Monthly limit of ${limit} AI-read pages reached. Ask the administrator to raise it.` });
    const out = await ai.readPage({ imageBase64: image, mediaType });
    record(req.user.id, 'read', out.usage);
    res.json({ transcription: out.transcription, readable: out.readable, legibility: out.legibility, notes: out.notes });
  }));

  aiRoutes.post('/grade', wrap(async (req, res) => {
    const { question, answer, step } = req.body || {};
    const q = question || {};
    const max = Number(q.max);
    if (!(max > 0 && max <= 1000) || typeof q.model !== 'string' || typeof answer !== 'string') return res.status(400).json({ error: 'Send the question (with max mark and model answer) and the answer text.' });
    if (answer.length > 30000 || q.model.length > 30000) return res.status(400).json({ error: 'Answer or model answer is too long.' });
    const groups = Array.isArray(q.keywordGroups) ? q.keywordGroups.filter(Array.isArray).map(g => g.map(String).slice(0, 20)).slice(0, 40) : [];
    const out = await ai.gradeAnswer({
      question: { label: String(q.label || '').slice(0, 20), title: String(q.title || '').slice(0, 300), max, model: q.model, keywordGroups: groups },
      answer, step: [0, 0.25, 0.5, 1].includes(Number(step)) ? Number(step) : 0.5
    });
    record(req.user.id, 'grade', out.usage);
    res.json({ mark: out.mark, criteria: out.criteria, rationale: out.rationale, feedback: out.feedback, confidence: out.confidence });
  }));

  aiRoutes.post('/rubric', wrap(async (req, res) => {
    const { file, mediaType, filename, text } = req.body || {};
    if (text !== undefined) {
      if (typeof text !== 'string' || text.trim().length < 20 || text.length > 200000) return res.status(400).json({ error: 'Paste the marking guide text (at least a few lines).' });
    } else if (!b64ok(file) || typeof mediaType !== 'string') return res.status(400).json({ error: 'Upload a PDF, Word (.docx), photo or text file.' });
    const out = await ai.rubricFromGuide({ fileBase64: file, mediaType, filename, text });
    record(req.user.id, 'rubric', out.usage);
    res.json({ rubricText: out.rubricText, questions: out.questions, warnings: out.warnings });
  }));

  app.use('/api/ai', aiRoutes);
  app.use('/api', (req, res) => res.status(404).json({ error: 'Not found.' }));

  // ------------------------------------------------------------ the browser app
  app.use(express.static(graderDir, { index: 'index.html', maxAge: '1h', setHeaders: (res, p) => { if (/index\.html$|sw\.js$/.test(p)) res.setHeader('Cache-Control', 'no-cache'); } }));

  return { app, store };
}

// Start when run directly (not when imported by tests).
if (process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  const { app } = createApp();
  const port = Number(process.env.PORT) || 8080;
  app.listen(port, () => console.log(`Handwritten Theory Grader listening on port ${port}${process.env.ANTHROPIC_API_KEY ? '' : ' (AI reading disabled: ANTHROPIC_API_KEY not set)'}.`));
}
