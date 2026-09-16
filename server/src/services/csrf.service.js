'use strict';

const crypto = require('crypto');
const config = require('../config');

const CSRF_COOKIE = 'cs_csrf';
const CSRF_HEADER = 'x-csrf-token';

function generateCsrfToken() {
  return crypto.randomBytes(32).toString('base64url');
}

function cookieOptions() {
  return {
    httpOnly: false,
    sameSite: 'lax',
    secure: process.env.NODE_ENV === 'production',
    maxAge: config.SESSION_TTL_MS
  };
}

function issueCsrfToken(res) {
  const token = generateCsrfToken();
  res.cookie(CSRF_COOKIE, token, cookieOptions());
  return token;
}

function clearCsrfToken(res) {
  res.clearCookie(CSRF_COOKIE);
}

function timingSafeEqualStrings(a, b) {
  if (typeof a !== 'string' || typeof b !== 'string') return false;
  const ba = Buffer.from(a);
  const bb = Buffer.from(b);
  if (ba.length !== bb.length) return false;
  try {
    return crypto.timingSafeEqual(ba, bb);
  } catch {
    return false;
  }
}

function usesCookieSession(req) {
  return Boolean(
    req.cookies?.[config.SESSION_COOKIE] ||
      req.cookies?.[config.MFA_PENDING_COOKIE] ||
      req.cookies?.[config.EMPLOYEE_COOKIE] ||
      req.cookies?.[config.REPORTER_COOKIE]
  );
}

function validateCsrf(req) {
  const cookieToken = req.cookies?.[CSRF_COOKIE];
  const headerToken = req.headers[CSRF_HEADER] || req.headers['X-CSRF-Token'];
  if (!cookieToken || !headerToken) return false;
  return timingSafeEqualStrings(String(cookieToken), String(headerToken));
}

module.exports = {
  CSRF_COOKIE,
  CSRF_HEADER,
  issueCsrfToken,
  clearCsrfToken,
  validateCsrf,
  usesCookieSession
};
