'use strict';

const { describe, it, before, after } = require('node:test');
const assert = require('node:assert/strict');
const http = require('node:http');
const { resetAllForTests } = require('../src/utils/rate-limit-gate');
const health = require('../src/services/health.service');

const TEST_PORT = process.env.CS_TEST_PORT_HEALTH || '3199';
const BASE = `http://127.0.0.1:${TEST_PORT}`;
const API = `${BASE}/api/v1`;

function request(method, pathName, { query, base = API } = {}) {
  return new Promise((resolve, reject) => {
    const url = new URL(pathName.startsWith('http') ? pathName : `${base}${pathName}`);
    if (query) {
      Object.entries(query).forEach(([k, v]) => url.searchParams.set(k, v));
    }
    const req = http.request(
      {
        method,
        hostname: url.hostname,
        port: url.port,
        path: url.pathname + url.search
      },
      (res) => {
        let data = '';
        res.on('data', (c) => (data += c));
        res.on('end', () => {
          let json = null;
          try {
            json = data ? JSON.parse(data) : null;
          } catch {
            json = data;
          }
          resolve({ status: res.statusCode, json });
        });
      }
    );
    req.on('error', reject);
    req.end();
  });
}

describe('health service (Etapa 6)', () => {
  it('getHealth reporta persistence json por padrão', async () => {
    const body = await health.getHealth({ deep: false });
    assert.equal(body.ok, true);
    assert.equal(body.service, 'canal-seguro-api');
    assert.ok(body.persistence);
    assert.equal(body.persistence.mode, 'json');
  });
});

describe('health API', () => {
  let server;

  before(async () => {
    process.env.CS_DEV_MODE = '1';
    delete process.env.CS_DB_ENABLED;
    await resetAllForTests();
    const { createApp } = require('../src/app');
    server = createApp().listen(Number(TEST_PORT));
  });

  after(async () => {
    if (server) await new Promise((r) => server.close(r));
  });

  it('GET /health retorna ok e persistence', async () => {
    const res = await request('GET', '/health');
    assert.equal(res.status, 200);
    assert.equal(res.json.ok, true);
    assert.equal(res.json.persistence.mode, 'json');
  });

  it('GET /health na raiz (probe Hostinger) retorna 200', async () => {
    const res = await request('GET', '/health', { base: BASE });
    assert.equal(res.status, 200);
    assert.equal(res.json.ok, true);
  });

  it('GET /health?deep=1 não quebra sem MySQL', async () => {
    const res = await request('GET', '/health', { query: { deep: '1' } });
    assert.ok(res.status === 200 || res.status === 503);
    assert.ok(res.json.mysql);
    assert.equal(res.json.mysql.checked, true);
  });
});
