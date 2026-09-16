'use strict';

const config = require('../config');
const { createDistributedRateLimiter, clientIp } = require('../utils/rate-limit');
const { hashIdentifier } = require('../utils/tokens');

const loginByIp = createDistributedRateLimiter();
const loginByEmail = createDistributedRateLimiter();
const employeeByIp = createDistributedRateLimiter();
const employeeByCompany = createDistributedRateLimiter();

const LOGIN_GENERIC =
  'Muitas tentativas de login. Aguarde alguns minutos e tente novamente.';
const EMPLOYEE_GENERIC =
  'Muitas tentativas de validação. Aguarde alguns minutos e tente novamente.';

function loginCfg() {
  return config.LOGIN || { MAX_FAILURES_IP: 15, MAX_FAILURES_EMAIL: 8, WINDOW_MS: 15 * 60 * 1000 };
}

function employeeCfg() {
  return (
    config.EMPLOYEE_VALIDATE || {
      MAX_FAILURES_IP: 15,
      MAX_FAILURES_COMPANY: 10,
      WINDOW_MS: 15 * 60 * 1000
    }
  );
}

async function checkLoginAllowed(req, email) {
  const cfg = loginCfg();
  const ip = clientIp(req);
  const ipGate = await loginByIp.isBlocked(`login:ip:${ip}`, cfg.MAX_FAILURES_IP, cfg.WINDOW_MS);
  if (ipGate.blocked) {
    return { allowed: false, retryAfterMs: ipGate.retryAfterMs, message: LOGIN_GENERIC };
  }
  const normalized = String(email || '')
    .trim()
    .toLowerCase();
  if (normalized) {
    const emailKey = `login:email:${hashIdentifier(normalized)}`;
    const emailGate = await loginByEmail.isBlocked(emailKey, cfg.MAX_FAILURES_EMAIL, cfg.WINDOW_MS);
    if (emailGate.blocked) {
      return { allowed: false, retryAfterMs: emailGate.retryAfterMs, message: LOGIN_GENERIC };
    }
  }
  return { allowed: true };
}

async function recordLoginFailure(req, email) {
  const cfg = loginCfg();
  const ip = clientIp(req);
  await loginByIp.recordFailure(`login:ip:${ip}`, cfg.WINDOW_MS);
  const normalized = String(email || '')
    .trim()
    .toLowerCase();
  if (normalized) {
    await loginByEmail.recordFailure(`login:email:${hashIdentifier(normalized)}`, cfg.WINDOW_MS);
  }
}

async function recordLoginSuccess(req, email) {
  const normalized = String(email || '')
    .trim()
    .toLowerCase();
  if (normalized) {
    await loginByEmail.clear(`login:email:${hashIdentifier(normalized)}`);
  }
}

async function checkEmployeeValidateAllowed(req, companyId) {
  const cfg = employeeCfg();
  const ip = clientIp(req);
  const ipGate = await employeeByIp.isBlocked(`emp:ip:${ip}`, cfg.MAX_FAILURES_IP, cfg.WINDOW_MS);
  if (ipGate.blocked) {
    return { allowed: false, retryAfterMs: ipGate.retryAfterMs, message: EMPLOYEE_GENERIC };
  }
  const companyKey = `emp:company:${String(companyId || 'unknown')}`;
  const companyGate = await employeeByCompany.isBlocked(
    companyKey,
    cfg.MAX_FAILURES_COMPANY,
    cfg.WINDOW_MS
  );
  if (companyGate.blocked) {
    return { allowed: false, retryAfterMs: companyGate.retryAfterMs, message: EMPLOYEE_GENERIC };
  }
  return { allowed: true };
}

async function recordEmployeeValidateFailure(req, companyId) {
  const cfg = employeeCfg();
  const ip = clientIp(req);
  await employeeByIp.recordFailure(`emp:ip:${ip}`, cfg.WINDOW_MS);
  await employeeByCompany.recordFailure(`emp:company:${String(companyId || 'unknown')}`, cfg.WINDOW_MS);
}

async function recordEmployeeValidateSuccess(req, companyId) {
  const ip = clientIp(req);
  await employeeByIp.clear(`emp:ip:${ip}`);
  await employeeByCompany.clear(`emp:company:${String(companyId || 'unknown')}`);
}

async function resetForTests() {
  const { resetAllForTests } = require('../utils/rate-limit-gate');
  await resetAllForTests();
}

module.exports = {
  checkLoginAllowed,
  recordLoginFailure,
  recordLoginSuccess,
  checkEmployeeValidateAllowed,
  recordEmployeeValidateFailure,
  recordEmployeeValidateSuccess,
  resetForTests,
  LOGIN_GENERIC,
  EMPLOYEE_GENERIC
};
