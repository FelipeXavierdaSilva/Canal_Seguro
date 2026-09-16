'use strict';

const { describe, it, before, after } = require('node:test');
const assert = require('node:assert/strict');
const http = require('node:http');
const { authenticator } = require('otplib');
const {
  parseCookie,
  loginComplete,
  clearUserMfa,
  pendingSecretForEmail,
  totpForSecret
} = require('./helpers/auth');
const { csrfHeaders } = require('./helpers/http');

const BASE = `http://127.0.0.1:${process.env.CS_TEST_PORT || 3110}`;
const API = `${BASE}/api/v1`;

function request(method, path, { body, cookie } = {}) {
  return new Promise((resolve, reject) => {
    const fullPath = `${API}${path.startsWith('/') ? path : `/${path}`}`;
    const url = new URL(fullPath);
    const opts = {
      method,
      hostname: url.hostname,
      port: url.port,
      path: url.pathname + url.search,
      headers: {
        ...(body ? { 'Content-Type': 'application/json' } : {}),
        ...(cookie ? { Cookie: cookie, ...csrfHeaders(cookie) } : {})
      }
    };
    const req = http.request(opts, (res) => {
      let data = '';
      res.on('data', (c) => (data += c));
      res.on('end', () => {
        let json = null;
        try {
          json = data ? JSON.parse(data) : null;
        } catch {
          json = data;
        }
        resolve({ status: res.statusCode, headers: res.headers, json });
      });
    });
    req.on('error', reject);
    if (body) req.write(JSON.stringify(body));
    req.end();
  });
}

let server;

before(async () => {
  process.env.CS_JWT_SECRET = 'test-secret-mfa';
  process.env.CS_TEST_PORT = process.env.CS_TEST_PORT || '3110';
  const store = require('../src/store');
  const data = store.load();
  data.platformSettings.mfaPolicy = {
    enabled: true,
    requiredRoles: ['superadmin', 'admin_empresa'],
    requiredPermissions: ['reports:view_identity'],
    optionalForOthers: true,
    gracePeriodDays: 7,
    allowRecoveryCodes: true,
    enforcedAt: null
  };
  store.save(data);
  const mfaService = require('../src/services/mfa.service');
  mfaService.resetRateLimitsForTests();
  clearUserMfa('admin@fxfelipexavier.com.br');
  const { createApp } = require('../src/app');
  server = createApp().listen(Number(process.env.CS_TEST_PORT || 3110));
});

after(() => {
  if (server) server.close();
  clearUserMfa('admin@fxfelipexavier.com.br');
});

describe('Login com MFA obrigatório', () => {
  it('superadmin sem MFA exige enrollment', async () => {
    clearUserMfa('admin@fxfelipexavier.com.br');
    const login = await request('POST', '/auth/login', {
      body: { email: 'admin@fxfelipexavier.com.br', password: 'fxadmin123' }
    });
    assert.equal(login.status, 200);
    assert.equal(login.json.complete, false);
    assert.equal(login.json.enrollmentRequired, true);
  });

  it('apurador entra sem MFA', async () => {
    const login = await request('POST', '/auth/login', {
      body: { email: 'apuracao@aurora-demo.com.br', password: 'empresa123' }
    });
    assert.equal(login.status, 200);
    assert.equal(login.json.complete, true);
    const cookie = parseCookie(login.headers['set-cookie']);
    const me = await request('GET', '/auth/me', { cookie });
    assert.equal(me.status, 200);
  });
});

describe('Enrollment TOTP', () => {
  it('configura MFA e emite sessão com recovery codes', async () => {
    clearUserMfa('admin@fxfelipexavier.com.br');
    const login = await request('POST', '/auth/login', {
      body: { email: 'admin@fxfelipexavier.com.br', password: 'fxadmin123' }
    });
    const pending = parseCookie(login.headers['set-cookie']);
    const start = await request('POST', '/auth/mfa/enroll/start', { cookie: pending });
    assert.equal(start.status, 200);
    assert.ok(start.json.otpauthUrl.includes('otpauth://'));

    const secret = pendingSecretForEmail('admin@fxfelipexavier.com.br');
    const code = totpForSecret(secret);
    const confirm = await request('POST', '/auth/mfa/enroll/confirm', {
      body: { code },
      cookie: pending
    });
    assert.equal(confirm.status, 200);
    assert.ok(Array.isArray(confirm.json.recoveryCodes));
    assert.equal(confirm.json.recoveryCodes.length, 10);
    const session = parseCookie(confirm.headers['set-cookie']);
    assert.ok(session.includes('cs_session'));

    const me = await request('GET', '/auth/me', { cookie: session });
    assert.equal(me.status, 200);
    assert.equal(me.json.mfa.enabled, true);
  });
});

describe('Verificação no login', () => {
  it('exige TOTP após enrollment', async () => {
    await loginComplete(request, 'admin@fxfelipexavier.com.br', 'fxadmin123');

    const login = await request('POST', '/auth/login', {
      body: { email: 'admin@fxfelipexavier.com.br', password: 'fxadmin123' }
    });
    assert.equal(login.json.complete, false);
    assert.equal(login.json.enrollmentRequired, false);
    assert.equal(login.json.mfaRequired, true);

    const pending = parseCookie(login.headers['set-cookie']);
    const store = require('../src/store');
    const { decryptSecret } = require('../src/utils/mfa-crypto');
    const user = store.load().users.find((u) => u.email === 'admin@fxfelipexavier.com.br');
    const code = authenticator.generate(decryptSecret(user.mfa.secretEnc));
    const verify = await request('POST', '/auth/mfa/verify', { body: { code }, cookie: pending });
    assert.equal(verify.status, 200);
    assert.ok(parseCookie(verify.headers['set-cookie']).includes('cs_session'));
  });
});

describe('Recovery code', () => {
  it('aceita código de recuperação único', async () => {
    clearUserMfa('admin@fxfelipexavier.com.br');
    const login = await request('POST', '/auth/login', {
      body: { email: 'admin@fxfelipexavier.com.br', password: 'fxadmin123' }
    });
    const pending = parseCookie(login.headers['set-cookie']);
    await request('POST', '/auth/mfa/enroll/start', { cookie: pending });
    const secret = pendingSecretForEmail('admin@fxfelipexavier.com.br');
    const confirm = await request('POST', '/auth/mfa/enroll/confirm', {
      body: { code: totpForSecret(secret) },
      cookie: pending
    });
    const recoveryCodes = confirm.json.recoveryCodes;
    assert.ok(recoveryCodes.length);

    const login2 = await request('POST', '/auth/login', {
      body: { email: 'admin@fxfelipexavier.com.br', password: 'fxadmin123' }
    });
    const pending2 = parseCookie(login2.headers['set-cookie']);
    const recovery = await request('POST', '/auth/mfa/recovery', {
      body: { code: recoveryCodes[0] },
      cookie: pending2
    });
    assert.equal(recovery.status, 200);

    const login3 = await request('POST', '/auth/login', {
      body: { email: 'admin@fxfelipexavier.com.br', password: 'fxadmin123' }
    });
    const pending3 = parseCookie(login3.headers['set-cookie']);
    const reuse = await request('POST', '/auth/mfa/recovery', {
      body: { code: recoveryCodes[0] },
      cookie: pending3
    });
    assert.equal(reuse.status, 401);
  });
});

describe('Política e admin reset', () => {
  it('superadmin altera política MFA', async () => {
    const cookie = await loginComplete(request, 'admin@fxfelipexavier.com.br', 'fxadmin123');
    const get = await request('GET', '/settings/mfa-policy', { cookie });
    assert.equal(get.status, 200);
    assert.ok(get.json.policy.enabled);

    const put = await request('PUT', '/settings/mfa-policy', {
      cookie,
      body: { gracePeriodDays: 14, enforcedAt: 'now' }
    });
    assert.equal(put.status, 200);
    assert.equal(put.json.policy.gracePeriodDays, 14);
    assert.ok(put.json.policy.enforcedAt);
  });

  it('superadmin reseta MFA de usuário', async () => {
    const superCookie = await loginComplete(request, 'admin@fxfelipexavier.com.br', 'fxadmin123');
    const store = require('../src/store');
    const target = store.load().users.find((u) => u.email === 'admin@aurora-demo.com.br');
    const reset = await request('POST', `/settings/users/${target.id}/mfa/reset`, {
      cookie: superCookie
    });
    assert.equal(reset.status, 200);
    const data = store.load();
    const updated = data.users.find((u) => u.id === target.id);
    assert.equal(updated.mfa.enabled, false);
  });
});

describe('Sessão sem MFA inválida para perfis obrigatórios', () => {
  it('token admin sem claim mfa é rejeitado se MFA exigido', async () => {
    const store = require('../src/store');
    const data = store.load();
    data.platformSettings.mfaPolicy = {
      ...data.platformSettings.mfaPolicy,
      enforcedAt: null,
      gracePeriodDays: 0
    };
    store.save(data);
    clearUserMfa('admin@horizon-demo.com.br');
    const login = await request('POST', '/auth/login', {
      body: { email: 'admin@horizon-demo.com.br', password: 'empresa123' }
    });
    assert.equal(login.json.enrollmentRequired, true);
    const pending = parseCookie(login.headers['set-cookie']);
    const mePending = await request('GET', '/auth/me', { cookie: pending });
    assert.equal(mePending.status, 401);
  });
});
