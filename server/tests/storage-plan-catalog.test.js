'use strict';

const { describe, it, before, after } = require('node:test');
const assert = require('node:assert/strict');
const http = require('node:http');
const store = require('../src/store');
const { resetAllForTests } = require('../src/utils/rate-limit-gate');
const { loginComplete } = require('./helpers/auth');
const { csrfHeaders } = require('./helpers/http');

const TEST_PORT = process.env.CS_TEST_PORT_PLAN_CATALOG || '3193';
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
let previousPlans;
let createdPlanId;

before(async () => {
  process.env.CS_JWT_SECRET = 'test-secret-plan-catalog';
  process.env.CS_DEV_MODE = '1';
  await resetAllForTests();
  const { createApp } = require('../src/app');
  server = createApp().listen(Number(TEST_PORT));
  superCookie = await loginComplete(request, 'admin@fxfelipexavier.com.br', 'fxadmin123');
  adminCookie = await loginComplete(request, 'admin@aurora-demo.com.br', 'empresa123');
  const data = store.load();
  data.platformSettings = data.platformSettings || {};
  previousPlans = Array.isArray(data.platformSettings.storagePlans)
    ? JSON.parse(JSON.stringify(data.platformSettings.storagePlans))
    : null;
  delete data.platformSettings.storagePlans;
  store.save(data);
});

after(async () => {
  const data = store.load();
  if (data.platformSettings) {
    if (previousPlans) data.platformSettings.storagePlans = previousPlans;
    else delete data.platformSettings.storagePlans;
  }
  store.save(data);
  await resetAllForTests();
  if (server) server.close();
});

describe('Catálogo dinâmico de planos', () => {
  it('lista catálogo para superadmin e bloqueia admin_empresa', async () => {
    const denied = await request('GET', '/settings/storage-plan-catalog', { cookie: adminCookie });
    assert.equal(denied.status, 403);

    const list = await request('GET', '/settings/storage-plan-catalog', { cookie: superCookie });
    assert.equal(list.status, 200);
    assert.ok(Array.isArray(list.json.plans));
    assert.ok(list.json.plans.length >= 4);
  });

  it('cria um novo plano e ele aparece em storage-plans', async () => {
    const res = await request('POST', '/settings/storage-plan-catalog', {
      cookie: superCookie,
      body: {
        name: 'Enterprise Plus',
        storageGiB: 40,
        usersLabel: '10 usuários',
        description: 'Plano customizado de teste',
        priceAmount: 899,
        advantages: ['40 GB de armazenamento', '10 usuários', 'Suporte 24h'],
        featured: false
      }
    });
    assert.equal(res.status, 201);
    assert.ok(res.json.plan);
    assert.equal(res.json.plan.storageLimitBytes, 40 * GiB);
    createdPlanId = res.json.plan.id;

    const listed = await request('GET', '/settings/storage-plans', { cookie: adminCookie });
    assert.equal(listed.status, 200);
    assert.ok(listed.json.plans.some((p) => p.id === createdPlanId));
  });

  it('edita o plano criado', async () => {
    const res = await request('PUT', `/settings/storage-plan-catalog/${encodeURIComponent(createdPlanId)}`, {
      cookie: superCookie,
      body: {
        name: 'Enterprise Plus Pro',
        storageGiB: 45,
        usersLabel: '12 usuários',
        priceAmount: 999
      }
    });
    assert.equal(res.status, 200);
    assert.equal(res.json.plan.name, 'Enterprise Plus Pro');
    assert.equal(res.json.plan.storageLimitBytes, 45 * GiB);
  });

  it('exclui o plano criado', async () => {
    const res = await request('DELETE', `/settings/storage-plan-catalog/${encodeURIComponent(createdPlanId)}`, {
      cookie: superCookie
    });
    assert.equal(res.status, 200);
    assert.ok(!(res.json.plans || []).some((p) => p.id === createdPlanId));
  });

  it('endpoint público lista planos sem autenticação e respeita hidePriceOnPublic', async () => {
    const create = await request('POST', '/settings/storage-plan-catalog', {
      cookie: superCookie,
      body: {
        name: 'Landing Hide',
        storageGiB: 50,
        usersLabel: '15 usuários',
        priceAmount: 1200,
        hidePriceOnPublic: true,
        advantages: ['50 GB', '15 usuários']
      }
    });
    assert.equal(create.status, 201);
    const hideId = create.json.plan.id;

    const pub = await request('GET', '/public/meta/storage-plans');
    assert.equal(pub.status, 200);
    assert.ok(Array.isArray(pub.json.plans));
    assert.ok(pub.json.plans.length >= 4);
    const hidden = pub.json.plans.find((p) => p.id === hideId);
    assert.ok(hidden);
    assert.equal(hidden.priceLabel, 'Sob consulta');
    assert.equal(hidden.priceSuffix, '');
    assert.equal(hidden.hidePriceOnPublic, true);
    assert.equal(hidden.priceAmount, undefined);

    await request('DELETE', `/settings/storage-plan-catalog/${encodeURIComponent(hideId)}`, {
      cookie: superCookie
    });
  });
});
