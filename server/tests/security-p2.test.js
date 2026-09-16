'use strict';

/**
 * Testes P2 – Etapa 11
 * CPF hash, logout revoga sessão, CSP nonces, rate limit store
 */
const { describe, it, before, after } = require('node:test');
const assert = require('node:assert/strict');
const http = require('node:http');
const store = require('../src/store');
const { hashCpf, employeeMatchesCpf } = require('../src/utils/cpf-crypto');
const { loginComplete, parseCookie } = require('./helpers/auth');
const { csrfHeaders } = require('./helpers/http');

const TEST_PORT = process.env.CS_TEST_PORT || '3170';
const BASE = `http://127.0.0.1:${TEST_PORT}`;
const API = `${BASE}/api/v1`;

function request(method, path, { body, cookie, headers, host = API } = {}) {
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
        ...(cookie ? { Cookie: cookie, ...csrfHeaders(cookie) } : {}),
        ...(headers || {})
      }
    };
    const req = http.request(opts, (res) => {
      const chunks = [];
      res.on('data', (c) => chunks.push(c));
      res.on('end', () => {
        const buf = Buffer.concat(chunks);
        let json = null;
        try {
          json = buf.length ? JSON.parse(buf.toString('utf8')) : null;
        } catch {
          json = buf.toString('utf8');
        }
        resolve({ status: res.statusCode, headers: res.headers, json, raw: buf.toString('utf8') });
      });
    });
    req.on('error', reject);
    if (body) req.write(JSON.stringify(body));
    req.end();
  });
}

let server;

before(async () => {
  process.env.CS_JWT_SECRET = 'test-secret-security-p2-32chars';
  process.env.CS_DEV_MODE = '1';
  process.env.CS_CORS_ORIGIN = `http://127.0.0.1:${TEST_PORT}`;
  process.env.CS_TEST_PORT = TEST_PORT;
  delete process.env.CS_REDIS_URL;

  const authRateLimit = require('../src/services/auth-rate-limit.service');
  await authRateLimit.resetForTests();

  delete require.cache[require.resolve('../src/app')];
  const { createApp } = require('../src/app');
  server = createApp().listen(Number(TEST_PORT));
});

after(async () => {
  if (server) server.close();
  const authRateLimit = require('../src/services/auth-rate-limit.service');
  await authRateLimit.resetForTests();
});

describe('P2 – CPF hasheado em repouso', () => {
  it('employees no store não possuem cpf plaintext', () => {
    const data = store.load();
    for (const emp of data.employees || []) {
      assert.equal(emp.cpf, undefined, `employee ${emp.id} ainda tem cpf plaintext`);
      assert.ok(emp.cpfHash, `employee ${emp.id} sem cpfHash`);
    }
  });

  it('validação de CPF funciona com cpfHash', async () => {
    const res = await request('POST', '/auth/employee/validate', {
      body: { companyId: 'cmp_aurora', cpf: '529.982.247-25' }
    });
    assert.equal(res.status, 200);
    assert.equal(res.json.employee.nome, 'Juliana Costa (fictício)');
  });

  it('employeeMatchesCpf compara via hash', () => {
    const emp = { cpfHash: hashCpf('52998224725') };
    assert.equal(employeeMatchesCpf(emp, '52998224725'), true);
    assert.equal(employeeMatchesCpf(emp, '00000000000'), false);
  });
});

describe('P2 – logout revoga sessão', () => {
  it('cookie de sessão deixa de valer após logout', async () => {
    const login = await request('POST', '/auth/login', {
      body: { email: 'apuracao@aurora-demo.com.br', password: 'empresa123' }
    });
    assert.equal(login.status, 200);
    const cookie = parseCookie(login.headers['set-cookie']);

    const meBefore = await request('GET', '/auth/me', { cookie });
    assert.equal(meBefore.status, 200);

    const logout = await request('POST', '/auth/logout', { cookie });
    assert.equal(logout.status, 200);

    const meAfter = await request('GET', '/auth/me', { cookie });
    assert.equal(meAfter.status, 401);
  });
});

describe('P2 – CSP com nonce em HTML', () => {
  it('GET /index.html inclui Content-Security-Policy', async () => {
    const res = await request('GET', '/index.html', { host: BASE });
    assert.equal(res.status, 200);
    assert.ok(res.headers['content-security-policy']);
    assert.match(res.headers['content-security-policy'], /nonce-/);
  });

  it('scripts inline recebem atributo nonce', async () => {
    const res = await request('GET', '/index.html', { host: BASE });
    assert.match(res.raw, /<script nonce="[^"]+">/);
  });
});

describe('P2 – rate limit store', () => {
  it('incrementFailure persiste contagem em memória', async () => {
    const rateLimitStore = require('../src/utils/rate-limit-store');
    rateLimitStore.clearMemoryForTests();
    const first = await rateLimitStore.incrementFailure('test:key', 60000);
    const second = await rateLimitStore.incrementFailure('test:key', 60000);
    assert.equal(first.count, 1);
    assert.equal(second.count, 2);
  });
});

describe('P2 – validate-config produção', () => {
  it('exige CS_CPF_PEPPER em produção', () => {
    const prevNode = process.env.NODE_ENV;
    const prevJwt = process.env.CS_JWT_SECRET;
    const prevWebhook = process.env.CS_EMAIL_WEBHOOK_SECRET;
    const prevCors = process.env.CS_CORS_ORIGIN;
    const prevPepper = process.env.CS_CPF_PEPPER;

    process.env.NODE_ENV = 'production';
    process.env.CS_JWT_SECRET = 'a'.repeat(32);
    process.env.CS_EMAIL_WEBHOOK_SECRET = 'webhook-secret-ok';
    process.env.CS_CORS_ORIGIN = 'https://app.example.com';
    delete process.env.CS_CPF_PEPPER;

    delete require.cache[require.resolve('../src/validate-config')];
    const { assertProductionConfig } = require('../src/validate-config');

    assert.throws(() => assertProductionConfig(), /CS_CPF_PEPPER/);

    process.env.NODE_ENV = prevNode;
    if (prevJwt) process.env.CS_JWT_SECRET = prevJwt;
    if (prevWebhook) process.env.CS_EMAIL_WEBHOOK_SECRET = prevWebhook;
    if (prevCors) process.env.CS_CORS_ORIGIN = prevCors;
    if (prevPepper) process.env.CS_CPF_PEPPER = prevPepper;
  });
});
