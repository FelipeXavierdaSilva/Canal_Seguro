'use strict';

const assert = require('node:assert/strict');
const { authenticator } = require('otplib');
const { decryptSecret } = require('../../src/utils/mfa-crypto');
const { csrfHeaders } = require('./http');

function parseCookie(setCookie) {
  if (!setCookie) return '';
  const arr = Array.isArray(setCookie) ? setCookie : [setCookie];
  return arr.map((c) => c.split(';')[0]).join('; ');
}

function mergeCookies(...parts) {
  const map = new Map();
  parts
    .filter(Boolean)
    .join('; ')
    .split(';')
    .map((s) => s.trim())
    .filter(Boolean)
    .forEach((pair) => {
      const idx = pair.indexOf('=');
      if (idx > 0) map.set(pair.slice(0, idx), pair.slice(idx + 1));
    });
  return [...map.entries()].map(([k, v]) => `${k}=${v}`).join('; ');
}

function pendingSecretForEmail(email) {
  const store = require('../../src/store');
  const data = store.load();
  const user = data.users.find((u) => u.email.toLowerCase() === String(email).toLowerCase());
  assert.ok(user, `Usuário ${email} não encontrado no store`);
  return decryptSecret(user.mfa?.pendingSecretEnc);
}

function totpForSecret(secret) {
  return authenticator.generate(secret);
}

/**
 * Completa login incluindo enrollment ou verificação MFA quando necessário.
 * @param {Function} request - helper HTTP do teste
 * @param {string} email
 * @param {string} password
 * @returns {Promise<string>} cookie de sessão cs_session
 */
async function loginComplete(request, email, password) {
  const login = await request('POST', '/auth/login', { body: { email, password } });
  assert.equal(login.status, 200, `login falhou para ${email}: ${JSON.stringify(login.json)}`);

  if (login.json.complete) {
    return parseCookie(login.headers['set-cookie']);
  }

  let cookie = mergeCookies(parseCookie(login.headers['set-cookie']));
  assert.ok(cookie.includes('cs_mfa_pending'), 'cookie MFA pending esperado');

  if (login.json.enrollmentRequired) {
    const start = await request('POST', '/auth/mfa/enroll/start', {
      cookie,
      headers: csrfHeaders(cookie)
    });
    assert.equal(start.status, 200, JSON.stringify(start.json));
    const secret = pendingSecretForEmail(email);
    const code = totpForSecret(secret);
    const confirm = await request('POST', '/auth/mfa/enroll/confirm', {
      body: { code },
      cookie,
      headers: csrfHeaders(cookie)
    });
    assert.equal(confirm.status, 200, JSON.stringify(confirm.json));
    return mergeCookies(cookie, parseCookie(confirm.headers['set-cookie']));
  }

  const store = require('../../src/store');
  const data = store.load();
  const user = data.users.find((u) => u.email.toLowerCase() === String(email).toLowerCase());
  const secret = decryptSecret(user.mfa.secretEnc);
  const code = totpForSecret(secret);
  const verify = await request('POST', '/auth/mfa/verify', {
    body: { code },
    cookie,
    headers: csrfHeaders(cookie)
  });
  assert.equal(verify.status, 200, JSON.stringify(verify.json));
  return mergeCookies(cookie, parseCookie(verify.headers['set-cookie']));
}

function clearUserMfa(email) {
  const store = require('../../src/store');
  const data = store.load();
  const user = data.users.find((u) => u.email.toLowerCase() === String(email).toLowerCase());
  if (user) {
    user.mfa = { enabled: false, secretEnc: null, recoveryCodes: [], enrolledAt: null };
    user.sessionVersion = (user.sessionVersion || 1) + 1;
    store.save(data);
  }
}

module.exports = {
  parseCookie,
  mergeCookies,
  loginComplete,
  clearUserMfa,
  pendingSecretForEmail,
  totpForSecret
};
