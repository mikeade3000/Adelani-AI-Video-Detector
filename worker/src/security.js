/*! © 2026 Michael Adelani Adewusi · Adelani Super Intelligent Agents. All rights reserved. No part or section of this application may be copied. */
// Password hashing and tokens with the Web Crypto API (available in Workers).
// PBKDF2-SHA256 at 100,000 iterations, the most Workers allows. The iteration
// count is stored in each hash, so it can be raised later without breaking logins.

const enc = new TextEncoder();
const b64 = buf => btoa(String.fromCharCode(...new Uint8Array(buf)));
const unb64 = s => Uint8Array.from(atob(s), c => c.charCodeAt(0));

export const PBKDF2_ITERATIONS = 100000;

async function pbkdf2(password, salt, iterations) {
  const key = await crypto.subtle.importKey('raw', enc.encode(password), 'PBKDF2', false, ['deriveBits']);
  return new Uint8Array(await crypto.subtle.deriveBits({ name: 'PBKDF2', hash: 'SHA-256', salt, iterations }, key, 256));
}

export async function hashPassword(password, iterations = PBKDF2_ITERATIONS) {
  const salt = crypto.getRandomValues(new Uint8Array(16));
  const hash = await pbkdf2(password, salt, iterations);
  return `pbkdf2-sha256$${iterations}$${b64(salt)}$${b64(hash)}`;
}

function equal(a, b) {
  if (a.length !== b.length) return false;
  let diff = 0;
  for (let i = 0; i < a.length; i++) diff |= a[i] ^ b[i];
  return diff === 0;
}

export async function verifyPassword(password, stored) {
  const [scheme, iter, saltB64, hashB64] = String(stored || '').split('$');
  if (scheme !== 'pbkdf2-sha256') return false;
  const expected = unb64(hashB64);
  const actual = await pbkdf2(String(password), unb64(saltB64), Number(iter));
  return equal(actual, expected);
}

export function passwordProblem(pw) {
  if (typeof pw !== 'string' || pw.length < 10) return 'Password must be at least 10 characters.';
  if (pw.length > 200) return 'Password is too long.';
  if (!/[a-zA-Z]/.test(pw) || !/[0-9]/.test(pw)) return 'Password must contain letters and numbers.';
  return null;
}

export function temporaryPassword() {
  const alphabet = 'ABCDEFGHJKLMNPQRSTUVWXYZabcdefghijkmnpqrstuvwxyz23456789';
  let out;
  do {
    out = Array.from(crypto.getRandomValues(new Uint8Array(14)), b => alphabet[b % alphabet.length]).join('');
  } while (passwordProblem(out));
  return out;
}

export function randomToken() {
  return b64(crypto.getRandomValues(new Uint8Array(32))).replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '');
}

export async function sha256Hex(s) {
  const d = await crypto.subtle.digest('SHA-256', enc.encode(s));
  return Array.from(new Uint8Array(d), b => b.toString(16).padStart(2, '0')).join('');
}

export const normEmail = e => String(e || '').trim().toLowerCase();
export const validEmail = e => /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(e) && e.length <= 200;
