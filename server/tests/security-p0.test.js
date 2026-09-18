'use strict';

/**
 * Testes de segurança P0 – Etapa 11
 * static root, JWT guard, rate limits login/CPF, webhook auth
 */
const { describe, it, before, after } = require('node:test');
const assert = require('node:assert/strict');
const http = require('node:http');

const TEST_PORT = process.env.CS_TEST_PORT || '3150';
const BASE = `http://127.0.0.1:${TEST_PORT}`;
const API = `${BASE}/api/v1`;

function request(method, path, { body, headers, host = API } = {}) {
  return new Promise((resolve, reject) => {
    const fullPath = path.startsWith('http') ? path : `${host}${path.startsWith('/') ? path : `/${path}`}`;
    const url = new URL(fullPath);
    const opts = {
      method,
      hostname: url.hostname,
      port: url.port,
      path: url.pathname + url.search,
      headers: {
        ...(body ? { 'Content-Type': 'application/json' } : {}),
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
        resolve({ status: res.statusCode, headers: res.headers, json, raw: data });
      });
    });
    req.on('error', reject);
    if (body) req.write(JSON.stringify(body));
    req.end();
  });
}

let server;

before(async () => {
  process.env.CS_JWT_SECRET = 'test-secret-security-p0-32chars-min';
  process.env.CS_DEV_MODE = '1';
  process.env.CS_EMAIL_WEBHOOK_SECRET = 'test-webhook-secret-p0';
  process.env.CS_LOGIN_MAX_FAILURES_IP = '3';
  process.env.CS_LOGIN_MAX_FAILURES_EMAIL = '3';
  process.env.CS_EMPLOYEE_VALIDATE_MAX_FAILURES_IP = '3';
  process.env.CS_EMPLOYEE_VALIDATE_MAX_FAILURES_COMPANY = '3';
  process.env.CS_TEST_PORT = TEST_PORT;

  delete require.cache[require.resolve('../src/config')];
  const authRateLimit = require('../src/services/auth-rate-limit.service');
  await authRateLimit.resetForTests();

  const { createApp } = require('../src/app');
  server = createApp().listen(Number(TEST_PORT));
});

after(() => {
  if (server) server.close();
});

describe('P0 – static root bloqueia server/', () => {
  it('GET /server/data/store.json retorna 404', async () => {
    const res = await request('GET', '/server/data/store.json', { host: BASE });
    assert.equal(res.status, 404);
  });

  it('GET /node_modules/ retorna 404', async () => {
    const res = await request('GET', '/node_modules/', { host: BASE });
    assert.equal(res.status, 404);
  });

  it('GET /index.html continua acessível', async () => {
    const res = await request('GET', '/index.html', { host: BASE });
    assert.equal(res.status, 200);
    assert.match(String(res.raw), /html/i);
  });

  it('GET / serve index.html (landing)', async () => {
    const res = await request('GET', '/', { host: BASE });
    assert.equal(res.status, 200);
    assert.match(String(res.headers['content-type'] || ''), /html/i);
    assert.match(String(res.raw), /<!DOCTYPE html>/i);
  });
});

describe('P0 – JWT guard em produção', () => {
  it('assertProductionConfig falha sem CS_JWT_SECRET forte', () => {
    const prevNode = process.env.NODE_ENV;
    const prevJwt = process.env.CS_JWT_SECRET;
    const prevWebhook = process.env.CS_EMAIL_WEBHOOK_SECRET;
    process.env.NODE_ENV = 'production';
    delete process.env.CS_JWT_SECRET;
    delete process.env.CS_EMAIL_WEBHOOK_SECRET;

    delete require.cache[require.resolve('../src/validate-config')];
    const { assertProductionConfig } = require('../src/validate-config');

    assert.throws(() => assertProductionConfig(), /CS_JWT_SECRET/);

    process.env.NODE_ENV = prevNode;
    if (prevJwt) process.env.CS_JWT_SECRET = prevJwt;
    if (prevWebhook) process.env.CS_EMAIL_WEBHOOK_SECRET = prevWebhook;
  });

  it('assertProductionConfig falha sem webhook secret em produção', () => {
    const prevNode = process.env.NODE_ENV;
    const prevJwt = process.env.CS_JWT_SECRET;
    const prevWebhook = process.env.CS_EMAIL_WEBHOOK_SECRET;
    process.env.NODE_ENV = 'production';
    process.env.CS_JWT_SECRET = 'a'.repeat(32);
    delete process.env.CS_EMAIL_WEBHOOK_SECRET;

    delete require.cache[require.resolve('../src/validate-config')];
    const { assertProductionConfig } = require('../src/validate-config');

    assert.throws(() => assertProductionConfig(), /CS_EMAIL_WEBHOOK_SECRET/);

    process.env.NODE_ENV = prevNode;
    if (prevJwt) process.env.CS_JWT_SECRET = prevJwt;
    if (prevWebhook) process.env.CS_EMAIL_WEBHOOK_SECRET = prevWebhook;
  });
});

describe('P0 – rate limit login', () => {
  it('bloqueia após falhas repetidas de login', async () => {
    const authRateLimit = require('../src/services/auth-rate-limit.service');
    await authRateLimit.resetForTests();

    for (let i = 0; i < 3; i++) {
      const res = await request('POST', '/auth/login', {
        body: { email: 'admin@aurora-demo.com.br', password: 'senha-errada' }
      });
      assert.equal(res.status, 401);
    }

    const blocked = await request('POST', '/auth/login', {
      body: { email: 'admin@aurora-demo.com.br', password: 'senha-errada' }
    });
    assert.equal(blocked.status, 429);
    assert.ok(blocked.json.retryAfterMs);
  });
});

describe('P0 – rate limit validação CPF', () => {
  it('bloqueia após falhas repetidas de CPF', async () => {
    const authRateLimit = require('../src/services/auth-rate-limit.service');
    await authRateLimit.resetForTests();

    for (let i = 0; i < 3; i++) {
      const res = await request('POST', '/auth/employee/validate', {
        body: { companyId: 'cmp_aurora', cpf: '00000000000' }
      });
      assert.equal(res.status, 404);
    }

    const blocked = await request('POST', '/auth/employee/validate', {
      body: { companyId: 'cmp_aurora', cpf: '00000000000' }
    });
    assert.equal(blocked.status, 429);
    assert.ok(blocked.json.retryAfterMs);
  });
});

describe('P0 – webhook bounce autenticado', () => {
  it('rejeita POST sem secret', async () => {
    const res = await request('POST', '/email/webhooks/bounce', {
      body: { email: 'reject@test.invalid', reason: 'hard_bounce' }
    });
    assert.equal(res.status, 401);
  });

  it('aceita POST com X-CS-Webhook-Secret válido', async () => {
    const res = await request('POST', '/email/webhooks/bounce', {
      body: { email: 'bounce-p0@test.invalid', reason: 'hard_bounce' },
      headers: { 'X-CS-Webhook-Secret': 'test-webhook-secret-p0' }
    });
    assert.equal(res.status, 200);
    assert.equal(res.json.ok, true);
  });
});
