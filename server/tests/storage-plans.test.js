'use strict';

/**
 * Contratação de pacote de armazenamento: cota imediata + solicitação comercial.
 */
const { describe, it, before, after } = require('node:test');
const assert = require('node:assert/strict');
const http = require('node:http');
const store = require('../src/store');
const companyStorage = require('../src/services/company-storage.service');
const { resetAllForTests } = require('../src/utils/rate-limit-gate');
const { loginComplete } = require('./helpers/auth');
const { csrfHeaders } = require('./helpers/http');

const TEST_PORT = process.env.CS_TEST_PORT_STORAGE_PLANS || '3191';
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
        resolve({ status: res.statusCode, headers: res.headers, json });
      });
    });
    req.on('error', reject);
    if (body) req.write(JSON.stringify(body));
    req.end();
  });
}

let server;
let adminCookie;
let superCookie;
let apuradorCookie;
let companyId;
let previousLimit;
let previousPlanId;
let previousRequests;

let previousPricing;

before(async () => {
  process.env.CS_JWT_SECRET = 'test-secret-storage-plans';
  process.env.CS_DEV_MODE = '1';
  await resetAllForTests();
  const { createApp } = require('../src/app');
  server = createApp().listen(Number(TEST_PORT));
  adminCookie = await loginComplete(request, 'admin@aurora-demo.com.br', 'empresa123');
  superCookie = await loginComplete(request, 'admin@fxfelipexavier.com.br', 'fxadmin123');
  apuradorCookie = await loginComplete(request, 'apuracao@aurora-demo.com.br', 'empresa123');
  const data = store.load();
  const company = data.companies.find((c) => c.nomeFantasia && /aurora/i.test(c.nomeFantasia)) || data.companies[0];
  companyId = company.id;
  companyStorage.ensureCompanyStorageFields(company, data);
  previousLimit = company.storageLimitBytes;
  previousPlanId = company.storagePlanId || null;
  previousRequests = Array.isArray(data.storageUpgradeRequests)
    ? [...data.storageUpgradeRequests]
    : [];
  if (!data.companySettings) data.companySettings = {};
  if (!data.companySettings[companyId]) data.companySettings[companyId] = {};
  previousPricing = data.companySettings[companyId].storagePricing
    ? { ...data.companySettings[companyId].storagePricing }
    : null;
  delete data.companySettings[companyId].storagePricing;
  company.storageLimitBytes = 5 * 1024 * 1024 * 1024;
  company.storagePlanId = 'essencial';
  data.storageUpgradeRequests = [];
  store.save(data);
});

after(async () => {
  const data = store.load();
  const company = data.companies.find((c) => c.id === companyId);
  if (company) {
    company.storageLimitBytes = previousLimit;
    company.storagePlanId = previousPlanId;
  }
  data.storageUpgradeRequests = previousRequests;
  if (data.companySettings?.[companyId]) {
    if (previousPricing) data.companySettings[companyId].storagePricing = previousPricing;
    else delete data.companySettings[companyId].storagePricing;
  }
  store.save(data);
  await resetAllForTests();
  if (server) server.close();
});

describe('Pacotes de armazenamento', () => {
  it('lista pacotes para admin_empresa', async () => {
    const res = await request('GET', '/settings/storage-plans', { cookie: adminCookie });
    assert.equal(res.status, 200);
    assert.ok(Array.isArray(res.json.plans));
    assert.ok(res.json.plans.some((p) => p.id === 'plus'));
  });

  it('apurador pode listar pacotes, mas não contratar', async () => {
    const list = await request('GET', '/settings/storage-plans', { cookie: apuradorCookie });
    assert.equal(list.status, 200);
    assert.ok(Array.isArray(list.json.plans));
    assert.ok(list.json.plans.length > 0);
    for (const p of list.json.plans) {
      assert.equal(p.priceLabel, 'Sob consulta');
      assert.equal(p.priceAmount, null);
      assert.equal(p.priceHiddenForApurador, true);
    }

    const contract = await request('POST', '/settings/storage-plans/contract', {
      cookie: apuradorCookie,
      body: { planId: 'plus' }
    });
    assert.equal(contract.status, 403);
    assert.match(String(contract.json?.error || ''), /Adm_Empresa.*contratar/i);
  });

  it('Adm_Plataforma oculta/libera preços por plano da empresa para Apurador', async () => {
    const show = await request('PUT', `/settings/storage-pricing/${encodeURIComponent(companyId)}`, {
      cookie: superCookie,
      body: {
        baseAmount: 200,
        upgradePercent: 25,
        planDetails: {
          plus: { hidePriceForApurador: false, priceAmount: 250 },
          essencial: { hidePriceForApurador: true }
        }
      }
    });
    assert.equal(show.status, 200);

    const listShown = await request('GET', '/settings/storage-plans', { cookie: apuradorCookie });
    assert.equal(listShown.status, 200);
    const plusShown = (listShown.json.plans || []).find((p) => p.id === 'plus');
    const essShown = (listShown.json.plans || []).find((p) => p.id === 'essencial');
    assert.ok(plusShown);
    assert.notEqual(plusShown.priceHiddenForApurador, true);
    assert.equal(essShown?.priceHiddenForApurador, true);
    assert.equal(essShown?.priceLabel, 'Sob consulta');

    const hide = await request('PUT', `/settings/storage-pricing/${encodeURIComponent(companyId)}`, {
      cookie: superCookie,
      body: {
        planDetails: {
          plus: { hidePriceForApurador: true }
        }
      }
    });
    assert.equal(hide.status, 200);

    const listHidden = await request('GET', '/settings/storage-plans', { cookie: apuradorCookie });
    const plusHidden = (listHidden.json.plans || []).find((p) => p.id === 'plus');
    assert.equal(plusHidden?.priceHiddenForApurador, true);
    assert.equal(plusHidden?.priceLabel, 'Sob consulta');
  });

  it('superadmin define valor base e % de upgrade personalizados', async () => {
    const denied = await request('PUT', `/settings/storage-pricing/${encodeURIComponent(companyId)}`, {
      cookie: adminCookie,
      body: { baseAmount: 200, upgradePercent: 25 }
    });
    assert.equal(denied.status, 403);

    const res = await request('PUT', `/settings/storage-pricing/${encodeURIComponent(companyId)}`, {
      cookie: superCookie,
      body: {
        baseAmount: 200,
        upgradePercent: 25,
        corporativoConsult: true,
        planDetails: {
          plus: {
            description: 'Plano Plus personalizado para Aurora.',
            usersLabel: '3 usuários',
            retentionLabel: 'Retenção de evidências por 2 anos',
            advantages: ['10 GB de armazenamento', '3 usuários', 'Suporte prioritário', 'Exportação avançada']
          }
        }
      }
    });
    assert.equal(res.status, 200);
    assert.equal(res.json.pricing.baseAmount, 200);
    assert.equal(res.json.pricing.upgradePercent, 25);

    const essencial = res.json.plans.find((p) => p.id === 'essencial');
    const plus = res.json.plans.find((p) => p.id === 'plus');
    const pro = res.json.plans.find((p) => p.id === 'pro');
    const corp = res.json.plans.find((p) => p.id === 'corporativo');
    assert.equal(essencial.priceAmount, 200);
    assert.equal(plus.priceAmount, 250);
    assert.equal(pro.priceAmount, 312.5);
    assert.equal(corp.priceAmount, null);
    assert.equal(corp.priceLabel, 'Sob consulta');
    assert.equal(plus.description, 'Plano Plus personalizado para Aurora.');
    assert.deepEqual(plus.advantages, [
      '10 GB de armazenamento',
      '3 usuários',
      'Suporte prioritário',
      'Exportação avançada'
    ]);

    const listed = await request('GET', '/settings/storage-plans', { cookie: adminCookie });
    assert.equal(listed.status, 200);
    const listedPlus = listed.json.plans.find((p) => p.id === 'plus');
    assert.equal(listedPlus.priceAmount, 250);
    assert.match(String(listedPlus.priceLabel), /250/);
    assert.equal(listedPlus.advantages.length, 4);
    assert.ok(listedPlus.advantages.includes('Suporte prioritário'));
  });

  it('empresa contrata pacote maior: cota sobe e gera solicitação', async () => {
    const res = await request('POST', '/settings/storage-plans/contract', {
      cookie: adminCookie,
      body: { planId: 'plus' }
    });
    assert.equal(res.status, 200);
    assert.equal(res.json.plan.id, 'plus');
    assert.equal(res.json.usage.storageLimitBytes, 10 * 1024 * 1024 * 1024);
    assert.equal(res.json.request.status, 'pendente_comercial');
    assert.equal(res.json.request.newAmount, 250);
    assert.equal(res.json.request.upgradePercent, 25);
    assert.match(String(res.json.message || ''), /reajustad/i);

    const data = store.load();
    const company = data.companies.find((c) => c.id === companyId);
    assert.equal(company.storageLimitBytes, 10 * 1024 * 1024 * 1024);
    assert.ok((data.storageUpgradeRequests || []).some((r) => r.planId === 'plus' && r.companyId === companyId));
  });

  it('não permite contratar pacote menor ou igual', async () => {
    const res = await request('POST', '/settings/storage-plans/contract', {
      cookie: adminCookie,
      body: { planId: 'essencial' }
    });
    assert.equal(res.status, 400);
  });

  it('superadmin lista e marca solicitação como tratada', async () => {
    const list = await request('GET', '/settings/storage-upgrade-requests', { cookie: superCookie });
    assert.equal(list.status, 200);
    const pending = (list.json.requests || []).find(
      (r) => r.companyId === companyId && r.status === 'pendente_comercial'
    );
    assert.ok(pending);

    const resolved = await request(
      'POST',
      `/settings/storage-upgrade-requests/${encodeURIComponent(pending.id)}/resolve`,
      { cookie: superCookie, body: {} }
    );
    assert.equal(resolved.status, 200);
    assert.equal(resolved.json.request.status, 'tratado');
  });
});
