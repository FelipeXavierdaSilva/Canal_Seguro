'use strict';

const express = require('express');
const authService = require('../services/auth.service');
const publicService = require('../services/public.service');
const passwordResetService = require('../services/password-reset.service');
const mailService = require('../services/mail.service');
const config = require('../config');
const { optionalAuth } = require('../middleware/auth');
const authRateLimit = require('../services/auth-rate-limit.service');
const { issueCsrfToken, clearCsrfToken } = require('../services/csrf.service');

const router = express.Router();

function cookieOpts(maxAge) {
  return {
    httpOnly: true,
    sameSite: 'lax',
    secure: process.env.NODE_ENV === 'production',
    maxAge
  };
}

router.post('/login', async (req, res) => {
  const { email, password } = req.body || {};
  const gate = await authRateLimit.checkLoginAllowed(req, email);
  if (!gate.allowed) {
    return res.status(429).json({
      error: gate.message,
      retryAfterMs: gate.retryAfterMs
    });
  }
  const result = authService.login(email, password);
  if (!result.ok) {
    await authRateLimit.recordLoginFailure(req, email);
    return res.status(401).json({ error: 'Credenciais inválidas ou usuário inativo.' });
  }
  await authRateLimit.recordLoginSuccess(req, email);
  issueCsrfToken(res);
  if (result.complete) {
    res.cookie(config.SESSION_COOKIE, result.token, cookieOpts(config.SESSION_TTL_MS));
    res.clearCookie(config.MFA_PENDING_COOKIE);
    return res.json({ complete: true, user: result.user });
  }
  res.cookie(config.MFA_PENDING_COOKIE, result.pendingToken, cookieOpts(config.MFA.PENDING_TTL_MS));
  return res.json({
    complete: false,
    mfaRequired: result.mfaRequired,
    enrollmentRequired: result.enrollmentRequired,
    user: result.user
  });
});

router.post('/logout', optionalAuth, (req, res) => {
  authService.logout(req);
  res.clearCookie(config.SESSION_COOKIE);
  res.clearCookie(config.MFA_PENDING_COOKIE);
  res.clearCookie(config.EMPLOYEE_COOKIE);
  clearCsrfToken(res);
  return res.json({ ok: true });
});

router.get('/me', optionalAuth, (req, res) => {
  const me = authService.meFromRequest(req);
  if (!me) return res.status(401).json({ error: 'Não autenticado.' });
  const csrfToken = issueCsrfToken(res);
  return res.json({ ...me, csrfToken });
});

router.post('/forgot-password', async (req, res) => {
  const { email } = req.body || {};
  const result = await passwordResetService.requestReset(req, email);
  if (result.rateLimited) {
    return res.status(429).json({ message: result.message });
  }
  return res.json({ message: result.message });
});

router.get('/reset-password/validate', (req, res) => {
  const token = req.query.token;
  const result = passwordResetService.validateResetToken(token);
  if (!result.ok) {
    return res.status(400).json({ valid: false, error: passwordResetService.GENERIC_RESET_FAILURE });
  }
  return res.json({ valid: true });
});

router.post('/reset-password', async (req, res) => {
  const { token, password, passwordConfirm } = req.body || {};
  const result = await passwordResetService.resetPassword(req, token, password, passwordConfirm);
  if (!result.ok) {
    return res.status(result.status).json({ error: result.error });
  }
  res.clearCookie(config.SESSION_COOKIE);
  res.clearCookie(config.MFA_PENDING_COOKIE);
  return res.json({ message: result.message });
});

router.get('/dev/last-reset-email', (req, res) => {
  if (!config.DEV_MODE) {
    return res.status(404).json({ error: 'Não disponível.' });
  }
  const mail = mailService.getLastDevMail();
  if (!mail) return res.json({ sent: false });
  return res.json({ sent: true, to: mail.to, subject: mail.subject, resetUrl: mail.resetUrl, sentAt: mail.sentAt });
});

router.post('/employee/validate', async (req, res) => {
  const { companyId, cpf } = req.body || {};
  const gate = await authRateLimit.checkEmployeeValidateAllowed(req, companyId);
  if (!gate.allowed) {
    return res.status(429).json({
      error: gate.message,
      retryAfterMs: gate.retryAfterMs
    });
  }
  const result = publicService.validateEmployee(companyId, cpf);
  if (!result.ok) {
    await authRateLimit.recordEmployeeValidateFailure(req, companyId);
    return res.status(404).json({ error: 'Não foi possível validar o acesso.' });
  }
  const resolvedCompanyId = result.employee.companyId || companyId;
  await authRateLimit.recordEmployeeValidateSuccess(req, resolvedCompanyId);
  const token = authService.issueEmployeeToken(result.employee.id, resolvedCompanyId);
  res.cookie(config.EMPLOYEE_COOKIE, token, cookieOpts(config.EMPLOYEE_TTL_MS));
  issueCsrfToken(res);
  return res.json({ employee: result.employee, employeeToken: token });
});

router.post('/employee/logout', (req, res) => {
  res.clearCookie(config.EMPLOYEE_COOKIE);
  return res.json({ ok: true });
});

module.exports = router;
