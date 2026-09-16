'use strict';

/**
 * Fase A3 — Quotas de armazenamento por empresa
 */
const { describe, it, before, after } = require('node:test');
const assert = require('node:assert/strict');
const http = require('node:http');
const store = require('../src/store');
const attachmentStorage = require('../src/services/attachment-storage.service');
const companyStorage = require('../src/services/company-storage.service');
const { resetAllForTests } = require('../src/utils/rate-limit-gate');
const { loginComplete } = require('./helpers/auth');
const { csrfHeaders } = require('./helpers/http');

const TEST_PORT = process.env.CS_TEST_PORT_QUOTA || '3183';
const BASE = `http://127.0.0.1:${TEST_PORT}`;
const API = `${BASE}/api/v1`;

function request(method, path, { body, cookie, headers, host = API, binary } = {}) {
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
        if (binary) {
          return resolve({ status: res.statusCode, headers: res.headers, raw: buf });
        }
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

function resetReportAndQuota({ limit, used }) {
  const data = store.load();
  const report = data.reports.find((r) => r.id === reportId);
  report.attachments = [];
  const company = data.companies.find((c) => c.id === companyId);
  company.storageLimitBytes = limit;
  company.storageUsedBytes = used;
  store.save(data);
}

let server;
let adminCookie;
let reportId;
let companyId;

before(async () => {
  process.env.CS_JWT_SECRET = 'test-secret-quota-attachments';
  process.env.CS_DEV_MODE = '1';
  await resetAllForTests();
  attachmentStorage.clearAttachmentsForTests();
  const { createApp } = require('../src/app');
  server = createApp().listen(Number(TEST_PORT));
  adminCookie = await loginComplete(request, 'admin@aurora-demo.com.br', 'empresa123');
  const data = store.load();
  const report = data.reports.find((r) => r.protocol === 'CS-2026-000112');
  reportId = report.id;
  companyId = report.companyId;
  report.attachments = [];
  const company = data.companies.find((c) => c.id === companyId);
  delete company.storageLimitBytes;
  delete company.storageUsedBytes;
  store.save(data);
});

after(async () => {
  const data = store.load();
  const company = data.companies.find((c) => c.id === companyId);
  if (company) {
    company.storageLimitBytes = companyStorage.defaultLimit();
    store.save(data);
  }
  attachmentStorage.clearAttachmentsForTests();
  await resetAllForTests();
  if (server) server.close();
});

describe('Fase A3 — Quotas de anexos', () => {
  it('empresa antiga sem campos recebe defaults e permite upload', async () => {
    const sample = Buffer.from('quota-default-ok').toString('base64');
    const upload = await request('POST', `/reports/${reportId}/attachments`, {
      cookie: adminCookie,
      body: { name: 'quota-ok.txt', mimeType: 'text/plain', dataBase64: sample }
    });
    assert.equal(upload.status, 201);
    const data = store.load();
    const company = data.companies.find((c) => c.id === companyId);
    assert.equal(typeof company.storageLimitBytes, 'number');
    assert.ok(company.storageUsedBytes >= Buffer.from('quota-default-ok').length);
  });

  it('simulated não conta na quota', () => {
    const data = store.load();
    const before = companyStorage.sumStoredBytesForCompany(data, companyId);
    const report = data.reports.find((r) => r.id === reportId);
    report.attachments = report.attachments || [];
    report.attachments.push({
      id: 'att_sim_test',
      name: 'fake.pdf',
      size: 5_000_000,
      status: 'simulated',
      createdAt: new Date().toISOString()
    });
    store.save(data);
    const after = companyStorage.sumStoredBytesForCompany(store.load(), companyId);
    assert.equal(after, before);
  });

  it('dentro do limite: upload permitido', async () => {
    resetReportAndQuota({ limit: 100, used: 10 });
    const sample = Buffer.from('abcdefghij').toString('base64'); // 10 bytes → 20 <= 100
    const upload = await request('POST', `/reports/${reportId}/attachments`, {
      cookie: adminCookie,
      body: { name: 'within.txt', mimeType: 'text/plain', dataBase64: sample }
    });
    assert.equal(upload.status, 201, upload.json?.error || upload.raw);
    const company = store.load().companies.find((c) => c.id === companyId);
    assert.equal(company.storageUsedBytes, 20);
  });

  it('exatamente no limite: upload permitido', async () => {
    resetReportAndQuota({ limit: 20, used: 10 });
    const sample = Buffer.from('abcdefghij').toString('base64'); // 10 → used+add === 20
    const upload = await request('POST', `/reports/${reportId}/attachments`, {
      cookie: adminCookie,
      body: { name: 'exact.txt', mimeType: 'text/plain', dataBase64: sample }
    });
    assert.equal(upload.status, 201, upload.json?.error || upload.raw);
    const company = store.load().companies.find((c) => c.id === companyId);
    assert.equal(company.storageUsedBytes, 20);
  });

  it('acima do limite: 400 com mensagem clara', async () => {
    resetReportAndQuota({ limit: 20, used: 18 });
    const sample = Buffer.from('abcdefghij').toString('base64'); // 10 → 28 > 20
    const upload = await request('POST', `/reports/${reportId}/attachments`, {
      cookie: adminCookie,
      body: { name: 'overflow.txt', mimeType: 'text/plain', dataBase64: sample }
    });
    assert.equal(upload.status, 400);
    assert.match(String(upload.json?.error || ''), /quota|esgotad|limite/i);
  });

  it('recalculateCompanyStorage após upload', async () => {
    const dataClear = store.load();
    for (const r of dataClear.reports || []) {
      if (r.companyId === companyId) r.attachments = [];
    }
    store.save(dataClear);
    attachmentStorage.clearAttachmentsForTests();

    resetReportAndQuota({ limit: 10_000, used: 0 });
    const payload = Buffer.from('recalc-me-please');
    const upload = await request('POST', `/reports/${reportId}/attachments`, {
      cookie: adminCookie,
      body: {
        name: 'recalc.txt',
        mimeType: 'text/plain',
        dataBase64: payload.toString('base64')
      }
    });
    assert.equal(upload.status, 201);

    const dataCorrupt = store.load();
    const companyCorrupt = dataCorrupt.companies.find((c) => c.id === companyId);
    companyCorrupt.storageUsedBytes = 999999;
    store.save(dataCorrupt);

    const result = companyStorage.recalculateCompanyStorage(companyId);
    assert.equal(result.ok, true);
    assert.equal(result.storageUsedBytes, payload.length);

    const all = companyStorage.recalculateAllCompanyStorage();
    assert.equal(all.ok, true);
    assert.ok(all.companies.some((c) => c.companyId === companyId && c.storageUsedBytes === payload.length));
  });

  it('GET storage-usage retorna consumo da própria empresa', async () => {
    const res = await request('GET', '/settings/storage-usage', { cookie: adminCookie });
    assert.equal(res.status, 200);
    assert.equal(res.json.companyId, companyId);
    assert.equal(typeof res.json.storageUsedBytes, 'number');
    assert.equal(typeof res.json.storageLimitBytes, 'number');
  });

  it('empresa não vê storage de outra empresa', async () => {
    const res = await request('GET', '/settings/storage-usage/cmp_horizon', { cookie: adminCookie });
    assert.equal(res.status, 404);
  });
});
