'use strict';

/**
 * Pool da plataforma + termômetros (uso / alocado) sem bloquear overcommit.
 */
const { describe, it, before, after } = require('node:test');
const assert = require('node:assert/strict');
const http = require('node:http');
const store = require('../src/store');
const { resetAllForTests } = require('../src/utils/rate-limit-gate');
const { loginComplete } = require('./helpers/auth');
const { csrfHeaders } = require('./helpers/http');

const TEST_PORT = process.env.CS_TEST_PORT_PLATFORM_STORAGE || '3192';
const BASE = `http://127.0.0.1:${TEST_PORT}`;
const API = `${BASE}/api/v1`;
const GiB = 1024 * 1024 * 1024;

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
        resolve({ status: res.statusCode, headers: res.headers, json });
      });
    });
    req.on('error', reject);
    if (body) req.write(JSON.stringify(body));
    req.end();
  });
}

let server;
let superCookie;
let adminCookie;
let previousPlatformStorage;

before(async () => {
  process.env.CS_JWT_SECRET = 'test-secret-platform-storage';
  process.env.CS_DEV_MODE = '1';
  await resetAllForTests();
  const { createApp } = require('../src/app');
  server = createApp().listen(Number(TEST_PORT));
  superCookie = await loginComplete(request, 'admin@fxfelipexavier.com.br', 'fxadmin123');
  adminCookie = await loginComplete(request, 'admin@aurora-demo.com.br', 'empresa123');
  const data = store.load();
  data.platformSettings = data.platformSettings || {};
  previousPlatformStorage = data.platformSettings.platformStorage
    ? JSON.parse(JSON.stringify(data.platformSettings.platformStorage))
    : null;
  data.platformSettings.platformStorage = {
    poolBytes: 100 * GiB,
    alertThresholds: { attention: 70, warning: 85, critical: 95 },
    alertOnAllocatedOvercommit: true,
    lastAlert: { usedBand: 'normal', allocatedBand: 'normal', overcommit: false, at: null }
  };
  store.save(data);
});

after(async () => {
  const data = store.load();
  if (data.platformSettings) {
    if (previousPlatformStorage) data.platformSettings.platformStorage = previousPlatformStorage;
    else delete data.platformSettings.platformStorage;
  }
  store.save(data);
  await resetAllForTests();
  if (server) server.close();
});

describe('Capacidade da plataforma', () => {
  it('admin_empresa não acessa pool', async () => {
    const res = await request('GET', '/settings/platform-storage', { cookie: adminCookie });
    assert.equal(res.status, 403);
  });

  it('superadmin lê e atualiza pool + limiares', async () => {
    const get = await request('GET', '/settings/platform-storage', { cookie: superCookie });
    assert.equal(get.status, 200);
    assert.ok(get.json.capacity);
    assert.equal(get.json.config.poolBytes, 100 * GiB);
    assert.ok(typeof get.json.capacity.usedTotalBytes === 'number');
    assert.ok(typeof get.json.capacity.allocatedTotalBytes === 'number');

    const put = await request('PUT', '/settings/platform-storage', {
      cookie: superCookie,
      body: {
        poolBytes: 50 * GiB,
        alertThresholds: { attention: 60, warning: 75, critical: 90 },
        alertOnAllocatedOvercommit: true
      }
    });
    assert.equal(put.status, 200);
    assert.equal(put.json.config.poolBytes, 50 * GiB);
    assert.equal(put.json.config.alertThresholds.attention, 60);
    assert.equal(put.json.config.alertThresholds.warning, 75);
    assert.equal(put.json.config.alertThresholds.critical, 90);
  });

  it('overcommit de cotas não bloqueia e gera alerta quando configurado', async () => {
    /* Pool pequeno o suficiente para Σ cotas > pool (empresas seed ~5GiB cada) */
    const put = await request('PUT', '/settings/platform-storage', {
      cookie: superCookie,
      body: {
        poolBytes: 1 * GiB,
        alertThresholds: { attention: 70, warning: 85, critical: 95 },
        alertOnAllocatedOvercommit: true
      }
    });
    assert.equal(put.status, 200);

    const data = store.load();
    if (data.platformSettings?.platformStorage?.lastAlert) {
      data.platformSettings.platformStorage.lastAlert.overcommit = false;
      data.platformSettings.platformStorage.lastAlert.usedBand = 'normal';
      data.platformSettings.platformStorage.lastAlert.allocatedBand = 'normal';
      store.save(data);
    }

    const get = await request('GET', '/settings/platform-storage', { cookie: superCookie });
    assert.equal(get.status, 200);
    assert.equal(get.json.capacity.overcommit, true);
    assert.ok((get.json.capacity.alerts || []).some((a) => a.type === 'overcommit'));
    assert.ok(get.json.capacity.allocatedPercent > 100);
  });

  it('storage-usage do superadmin inclui capacity', async () => {
    const res = await request('GET', '/settings/storage-usage', { cookie: superCookie });
    assert.equal(res.status, 200);
    assert.ok(Array.isArray(res.json.companies));
    assert.ok(res.json.capacity);
    assert.ok(typeof res.json.capacity.poolBytes === 'number');
  });
});
