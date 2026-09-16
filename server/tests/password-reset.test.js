'use strict';

/**
 * Testes Etapa 04 — recuperação segura de senha
 */
const { describe, it, before, after } = require('node:test');
const assert = require('node:assert/strict');
const http = require('node:http');
const crypto = require('node:crypto');

const BASE = `http://127.0.0.1:${process.env.CS_TEST_PORT || 3100}`;
const API = `${BASE}/api/v1`;

function request(method, path, { body, cookie, headers } = {}) {
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
        ...(cookie ? { Cookie: cookie } : {}),
        ...(headers || {})
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

const { parseCookie, loginComplete } = require('./helpers/auth');

function hashToken(raw) {
  return crypto.createHash('sha256').update(String(raw)).digest('hex');
}

function restoreUserPassword(email, plainPassword) {
  const bcrypt = require('bcryptjs');
  const storeMod = require('../src/store');
  const data = storeMod.load();
  const u = data.users.find((x) => x.email === email);
  if (u) {
    u.passwordHash = bcrypt.hashSync(plainPassword, 10);
    u.sessionVersion = 1;
    u.mfa = { enabled: false, secretEnc: null, recoveryCodes: [], enrolledAt: null };
    storeMod.save(data);
  }
}

let server;
let lastResetUrl;
let lastRawToken;

before(async () => {
  process.env.CS_JWT_SECRET = 'test-secret-reset';
  process.env.CS_DEV_MODE = '1';
  process.env.CS_EMAIL_SYNC = '1';
  process.env.CS_TEST_PORT = process.env.CS_TEST_PORT || '3100';
  const { createApp } = require('../src/app');
  const passwordReset = require('../src/services/password-reset.service');
  passwordReset.resetRateLimitsForTests();
  server = createApp().listen(Number(process.env.CS_TEST_PORT || 3100));
});

after(() => {
  if (server) server.close();
});

async function requestReset(email, { clearLimits = true } = {}) {
  if (clearLimits) {
    const passwordReset = require('../src/services/password-reset.service');
    passwordReset.resetRateLimitsForTests();
  }
  return request('POST', '/auth/forgot-password', { body: { email } });
}

async function fetchDevResetLink() {
  const res = await request('GET', '/auth/dev/last-reset-email');
  assert.equal(res.status, 200);
  assert.ok(res.json.resetUrl);
  lastResetUrl = res.json.resetUrl;
  const u = new URL(lastResetUrl);
  lastRawToken = u.searchParams.get('token');
  return lastRawToken;
}

describe('Resposta genérica', () => {
  it('e-mail inexistente retorna mesma mensagem genérica (200)', async () => {
    const res = await requestReset('naoexiste@teste.invalid');
    assert.equal(res.status, 200);
    assert.match(res.json.message, /Se o usuário ou e-mail estiver cadastrado/i);
  });

  it('e-mail existente retorna mesma mensagem genérica (200)', async () => {
    const res = await requestReset('admin@aurora-demo.com.br');
    assert.equal(res.status, 200);
    assert.match(res.json.message, /Se o usuário ou e-mail estiver cadastrado/i);
    await fetchDevResetLink();
    assert.ok(lastRawToken);
  });
});

describe('Token válido e reset', () => {
  it('token válido passa na validação', async () => {
    await requestReset('admin@aurora-demo.com.br');
    const token = await fetchDevResetLink();
    const res = await request('GET', `/auth/reset-password/validate?token=${encodeURIComponent(token)}`);
    assert.equal(res.status, 200);
    assert.equal(res.json.valid, true);
  });

  it('redefine senha com senha forte', async () => {
    await requestReset('admin@aurora-demo.com.br');
    const token = await fetchDevResetLink();
    const newPass = 'NovaSenha9X';
    const res = await request('POST', '/auth/reset-password', {
      body: { token, password: newPass, passwordConfirm: newPass }
    });
    assert.equal(res.status, 200);
    assert.match(res.json.message, /redefinida/i);

    const loginOld = await request('POST', '/auth/login', {
      body: { email: 'admin@aurora-demo.com.br', password: 'empresa123' }
    });
    assert.equal(loginOld.status, 401);

    const loginNew = await loginComplete(request, 'admin@aurora-demo.com.br', newPass);
    assert.ok(loginNew.includes('cs_session'));

    restoreUserPassword('admin@aurora-demo.com.br', 'empresa123');
  });
});

describe('Token inválido, usado e expirado', () => {
  it('token inválido falha', async () => {
    const res = await request('GET', '/auth/reset-password/validate?token=token-invalido-xyz');
    assert.equal(res.status, 400);
  });

  it('token usado não pode ser reutilizado', async () => {
    await requestReset('admin@horizon-demo.com.br');
    const token = await fetchDevResetLink();
    const pass = 'OutraSenha8Y';
    const first = await request('POST', '/auth/reset-password', {
      body: { token, password: pass, passwordConfirm: pass }
    });
    assert.equal(first.status, 200);

    const second = await request('POST', '/auth/reset-password', {
      body: { token, password: pass, passwordConfirm: pass }
    });
    assert.equal(second.status, 400);

    restoreUserPassword('admin@horizon-demo.com.br', 'empresa123');
  });

  it('token expirado falha', async () => {
    const store = require('../src/store');
    const data = store.load();
    const user = data.users.find((u) => u.email === 'apuracao@aurora-demo.com.br');
    const raw = crypto.randomBytes(32).toString('base64url');
    data.passwordResetTokens = data.passwordResetTokens || [];
    data.passwordResetTokens.push({
      id: store.uid('prt'),
      userId: user.id,
      tokenHash: hashToken(raw),
      expiresAt: new Date(Date.now() - 1000).toISOString(),
      usedAt: null,
      createdAt: new Date().toISOString()
    });
    store.save(data);

    const res = await request('GET', `/auth/reset-password/validate?token=${encodeURIComponent(raw)}`);
    assert.equal(res.status, 400);
  });
});

describe('Senha fraca', () => {
  it('rejeita senha fraca', async () => {
    await requestReset('admin@verdecampo-demo.com.br');
    const token = await fetchDevResetLink();
    const res = await request('POST', '/auth/reset-password', {
      body: { token, password: '123', passwordConfirm: '123' }
    });
    assert.equal(res.status, 400);
    assert.ok(res.json.error);
  });
});

describe('Sessão antiga invalidada', () => {
  it('cookie de sessão anterior deixa de valer após reset', async () => {
    const oldCookie = await loginComplete(request, 'admin@verdecampo-demo.com.br', 'empresa123');

    const meBefore = await request('GET', '/auth/me', { cookie: oldCookie });
    assert.equal(meBefore.status, 200);

    await requestReset('admin@verdecampo-demo.com.br');
    const token = await fetchDevResetLink();
    const newPass = 'VerdeCampo9Z';
    const resetRes = await request('POST', '/auth/reset-password', {
      body: { token, password: newPass, passwordConfirm: newPass }
    });
    assert.equal(resetRes.status, 200);

    const meAfter = await request('GET', '/auth/me', { cookie: oldCookie });
    assert.equal(meAfter.status, 401);

    restoreUserPassword('admin@verdecampo-demo.com.br', 'empresa123');
  });
});

describe('Piso de 6 caracteres e sequência', () => {
  it('aceita senha média de 6 caracteres (1649Ma)', async () => {
    await requestReset('apuracao@aurora-demo.com.br');
    const token = await fetchDevResetLink();
    const newPass = '1649Ma';
    const res = await request('POST', '/auth/reset-password', {
      body: { token, password: newPass, passwordConfirm: newPass }
    });
    assert.equal(res.status, 200);

    const loginNew = await loginComplete(request, 'apuracao@aurora-demo.com.br', newPass);
    assert.ok(loginNew.includes('cs_session'));

    restoreUserPassword('apuracao@aurora-demo.com.br', 'empresa123');
  });

  it('rejeita 3 ou mais dígitos em sequência no reset', async () => {
    const res = await request('POST', '/auth/reset-password', {
      body: { token: 'token-placeholder-com-mais-de-vinte', password: '1234Ma', passwordConfirm: '1234Ma' }
    });
    assert.equal(res.status, 400);
    assert.match(String(res.json.error), /sequência/i);
  });
});

describe('Rate limiting', () => {
  it('muitas solicitações retornam 429', async () => {
    const passwordReset = require('../src/services/password-reset.service');
    passwordReset.resetRateLimitsForTests();
    const email = 'admin@fxfelipexavier.com.br';
    let lastStatus = 200;
    for (let i = 0; i < 8; i++) {
      const res = await requestReset(email, { clearLimits: false });
      lastStatus = res.status;
      if (res.status === 429) break;
    }
    assert.equal(lastStatus, 429);
  });
});
