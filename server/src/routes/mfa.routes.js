'use strict';

const express = require('express');
const authService = require('../services/auth.service');
const mfaService = require('../services/mfa.service');
const config = require('../config');
const { optionalAuth, requireAuth } = require('../middleware/auth');
const { issueCsrfToken } = require('../services/csrf.service');

const router = express.Router();

function cookieOpts(maxAge) {
  return {
    httpOnly: true,
    sameSite: 'lax',
    secure: process.env.NODE_ENV === 'production',
    maxAge
  };
}

router.post('/verify', async (req, res) => {
  const { code } = req.body || {};
  const result = await mfaService.verifyMfaCode(req, code, { recovery: false });
  if (!result.ok) return res.status(result.status).json({ error: result.error });
  res.clearCookie(config.MFA_PENDING_COOKIE);
  res.cookie(config.SESSION_COOKIE, result.token, cookieOpts(config.SESSION_TTL_MS));
  issueCsrfToken(res);
  return res.json({ user: result.user, usedRecovery: result.usedRecovery });
});

router.post('/recovery', async (req, res) => {
  const { code } = req.body || {};
  const result = await mfaService.verifyMfaCode(req, code, { recovery: true });
  if (!result.ok) return res.status(result.status).json({ error: result.error });
  res.clearCookie(config.MFA_PENDING_COOKIE);
  res.cookie(config.SESSION_COOKIE, result.token, cookieOpts(config.SESSION_TTL_MS));
  issueCsrfToken(res);
  return res.json({ user: result.user, usedRecovery: true });
});

router.get('/status', optionalAuth, (req, res) => {
  const pending = mfaService.userFromMfaPending(req);
  if (pending) {
    const data = require('../store').load();
    return res.json({ pending: true, ...mfaService.getStatus(pending.user, data) });
  }
  if (!req.user) return res.status(401).json({ error: 'Não autenticado.' });
  const data = require('../store').load();
  const user = data.users.find((u) => u.id === req.user.id);
  if (!user) return res.status(401).json({ error: 'Não autenticado.' });
  return res.json({ pending: false, ...mfaService.getStatus(user, data) });
});

router.post('/enroll/start', optionalAuth, (req, res) => {
  const result = mfaService.enrollStart(req);
  if (!result.ok) return res.status(result.status).json({ error: result.error });
  if (result.pendingToken) {
    res.cookie(config.MFA_PENDING_COOKIE, result.pendingToken, cookieOpts(config.MFA.ENROLL_TTL_MS));
  }
  return res.json({ otpauthUrl: result.otpauthUrl, purpose: result.purpose });
});

router.post('/enroll/confirm', optionalAuth, (req, res) => {
  const { code } = req.body || {};
  const result = mfaService.enrollConfirm(req, code);
  if (!result.ok) return res.status(result.status).json({ error: result.error });
  res.clearCookie(config.MFA_PENDING_COOKIE);
  res.cookie(config.SESSION_COOKIE, result.token, cookieOpts(config.SESSION_TTL_MS));
  issueCsrfToken(res);
  return res.json({
    user: result.user,
    recoveryCodes: result.recoveryCodes
  });
});

router.post('/disable', requireAuth, (req, res) => {
  const result = mfaService.disableMfa(req, req.body || {});
  if (!result.ok) return res.status(result.status).json({ error: result.error });
  res.clearCookie(config.SESSION_COOKIE);
  return res.json({ message: result.message });
});

router.post('/recovery/regenerate', requireAuth, (req, res) => {
  const result = mfaService.regenerateRecoveryCodes(req, req.body || {});
  if (!result.ok) return res.status(result.status).json({ error: result.error });
  res.clearCookie(config.SESSION_COOKIE);
  return res.json({ recoveryCodes: result.recoveryCodes, message: 'Novos códigos gerados. Faça login novamente.' });
});

module.exports = router;
