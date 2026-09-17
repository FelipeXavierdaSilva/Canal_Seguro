'use strict';

const { validateCsrf, usesCookieSession } = require('../services/csrf.service');

const SAFE_METHODS = new Set(['GET', 'HEAD', 'OPTIONS']);

const EXEMPT_PREFIXES = [
  '/api/v1/health',
  '/api/v1/auth/login',
  '/api/v1/auth/forgot-password',
  '/api/v1/auth/reset-password',
  '/api/v1/auth/reset-password/validate',
  '/api/v1/auth/employee/validate',
  '/api/v1/public/consult',
  '/api/v1/public/support-faq/ask',
  '/api/v1/email/webhooks/'
];

function isExempt(req) {
  const path = (req.originalUrl || req.url || '').split('?')[0];
  return EXEMPT_PREFIXES.some((prefix) => path === prefix || path.startsWith(prefix));
}

function requireCsrf(req, res, next) {
  if (SAFE_METHODS.has(req.method)) return next();
  if (isExempt(req)) return next();
  if (!usesCookieSession(req)) return next();

  if (!validateCsrf(req)) {
    return res.status(403).json({ error: 'Token CSRF inválido ou ausente.' });
  }
  return next();
}

module.exports = { requireCsrf, isExempt };
