'use strict';

/**
 * Fase B3 — Meu armazenamento (tenant + campos de leitura)
 */
const { describe, it, before, after } = require('node:test');
const assert = require('node:assert/strict');
const http = require('node:http');
const store = require('../src/store');
const { resetAllForTests } = require('../src/utils/rate-limit-gate');
const { loginComplete } = require('./helpers/auth');
const { csrfHeaders } = require('./helpers/http');

const TEST_PORT = process.env.CS_TEST_PORT_STORAGE_B3 || '3185';
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
let adminCookie;
let apuradorCookie;
let companyId;

before(async () => {
  process.env.CS_JWT_SECRET = 'test-secret-storage-b3';
  process.env.CS_DEV_MODE = '1';
  await resetAllForTests();
  const { createApp } = require('../src/app');
  server = createApp().listen(Number(TEST_PORT));
  adminCookie = await loginComplete(request, 'admin@aurora-demo.com.br', 'empresa123');
  apuradorCookie = await loginComplete(request, 'apuracao@aurora-demo.com.br', 'empresa123');
  const data = store.load();
  const user = data.users.find((u) => u.email === 'admin@aurora-demo.com.br');
  companyId = user.companyId;
});

after(async () => {
  await resetAllForTests();
  if (server) server.close();
});

describe('Fase B3 — Meu armazenamento (API tenant)', () => {
  it('admin_empresa vê só a própria empresa com utilizado/limite/disponível/%', async () => {
    const res = await request('GET', '/settings/storage-usage', { cookie: adminCookie });
    assert.equal(res.status, 200);
    assert.equal(res.json.companyId, companyId);
    assert.equal(typeof res.json.storageUsedBytes, 'number');
    assert.equal(typeof res.json.storageLimitBytes, 'number');
    assert.equal(typeof res.json.storageAvailableBytes, 'number');
    assert.equal(typeof res.json.storagePercent, 'number');
    assert.equal(typeof res.json.overLimit, 'boolean');
    assert.equal(res.json.companies, undefined);
  });

  it('admin_empresa não acessa storage de outra empresa', async () => {
    const res = await request('GET', '/settings/storage-usage/cmp_horizon', { cookie: adminCookie });
    assert.equal(res.status, 404);
  });

  it('admin_empresa não pode alterar limite (somente leitura no painel)', async () => {
    const res = await request('PUT', `/settings/storage-usage/${companyId}`, {
      cookie: adminCookie,
      body: { storageLimitBytes: 20 * 1024 * 1024 }
    });
    assert.equal(res.status, 403);
  });

  it('apurador pode ler quota da própria empresa na API (UI da página fica restrita)', async () => {
    const res = await request('GET', '/settings/storage-usage', { cookie: apuradorCookie });
    assert.equal(res.status, 200);
    assert.equal(res.json.companyId, companyId);
    assert.equal(res.json.companies, undefined);
  });
});
