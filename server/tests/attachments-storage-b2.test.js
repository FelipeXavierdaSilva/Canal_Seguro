'use strict';

/**
 * Fase B2 — Adm_Plataforma define storageLimitBytes (auth + auditoria + over-limit)
 */
const { describe, it, before, after } = require('node:test');
const assert = require('node:assert/strict');
const http = require('node:http');
const store = require('../src/store');
const attachmentStorage = require('../src/services/attachment-storage.service');
const companyStorage = require('../src/services/company-storage.service');
const config = require('../src/config');
const { resetAllForTests } = require('../src/utils/rate-limit-gate');
const { loginComplete } = require('./helpers/auth');
const { csrfHeaders } = require('./helpers/http');

const TEST_PORT = process.env.CS_TEST_PORT_STORAGE_B2 || '3184';
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

let server;
let adminCookie;
let superCookie;
let companyId;
let reportId;
let previousLimit;

const MIN = Number(config.ATTACHMENTS.MIN_COMPANY_QUOTA_BYTES) || 10 * 1024 * 1024;
const MAX = Number(config.ATTACHMENTS.MAX_COMPANY_QUOTA_BYTES) || 100 * 1024 * 1024 * 1024;

before(async () => {
  process.env.CS_JWT_SECRET = 'test-secret-storage-b2';
  process.env.CS_DEV_MODE = '1';
  await resetAllForTests();
  attachmentStorage.clearAttachmentsForTests();
  const { createApp } = require('../src/app');
  server = createApp().listen(Number(TEST_PORT));
  adminCookie = await loginComplete(request, 'admin@aurora-demo.com.br', 'empresa123');
  superCookie = await loginComplete(request, 'admin@fxfelipexavier.com.br', 'fxadmin123');
  const data = store.load();
  const report = data.reports.find((r) => r.protocol === 'CS-2026-000112');
  reportId = report.id;
  companyId = report.companyId;
  const company = data.companies.find((c) => c.id === companyId);
  companyStorage.ensureCompanyStorageFields(company, data);
  previousLimit = company.storageLimitBytes;
  store.save(data);
});

after(async () => {
  const data = store.load();
  const company = data.companies.find((c) => c.id === companyId);
  if (company) {
    company.storageLimitBytes = previousLimit || companyStorage.defaultLimit();
    store.save(data);
  }
  attachmentStorage.clearAttachmentsForTests();
  await resetAllForTests();
  if (server) server.close();
});

describe('Fase B2 — alteração de quota por empresa', () => {
  it('admin_empresa não pode alterar quota (403)', async () => {
    const res = await request('PUT', `/settings/storage-usage/${companyId}`, {
      cookie: adminCookie,
      body: { storageLimitBytes: MIN }
    });
    assert.equal(res.status, 403);
  });

  it('superadmin altera quota válida e gera auditoria', async () => {
    const next = MIN * 2;
    const beforeLogs = (store.load().auditLogs || []).length;
    const res = await request('PUT', `/settings/storage-usage/${companyId}`, {
      cookie: superCookie,
      body: { storageLimitBytes: next }
    });
    assert.equal(res.status, 200, res.json?.error || res.raw);
    assert.equal(res.json.storageLimitBytes, next);
    assert.equal(typeof res.json.overLimit, 'boolean');

    const data = store.load();
    const company = data.companies.find((c) => c.id === companyId);
    assert.equal(company.storageLimitBytes, next);
    assert.ok((data.auditLogs || []).length > beforeLogs);
    const entry = (data.auditLogs || []).find(
      (l) =>
        l.action === 'alteracao_quota_armazenamento' &&
        l.resourceId === companyId &&
        l.newValue?.storageLimitBytes === next
    );
    assert.ok(entry, 'entrada de auditoria esperada');
    assert.equal(entry.previousValue?.storageLimitBytes != null, true);
  });

  it('quota abaixo do mínimo é rejeitada', async () => {
    const res = await request('PUT', `/settings/storage-usage/${companyId}`, {
      cookie: superCookie,
      body: { storageLimitBytes: MIN - 1 }
    });
    assert.equal(res.status, 400);
    assert.match(String(res.json?.error || ''), /entre|quota/i);
  });

  it('quota acima do máximo é rejeitada', async () => {
    const res = await request('PUT', `/settings/storage-usage/${companyId}`, {
      cookie: superCookie,
      body: { storageLimitBytes: MAX + 1 }
    });
    assert.equal(res.status, 400);
  });

  it('used > novo limit: não apaga anexos, marca overLimit e bloqueia upload', async () => {
    const payload = Buffer.from('b2-over-limit-keep-me');
    const data0 = store.load();
    const report0 = data0.reports.find((r) => r.id === reportId);
    report0.attachments = [];
    const company0 = data0.companies.find((c) => c.id === companyId);
    company0.storageLimitBytes = MIN * 3;
    company0.storageUsedBytes = 0;
    store.save(data0);

    const upload = await request('POST', `/reports/${reportId}/attachments`, {
      cookie: adminCookie,
      body: {
        name: 'keep.txt',
        mimeType: 'text/plain',
        dataBase64: payload.toString('base64')
      }
    });
    assert.equal(upload.status, 201, upload.json?.error || upload.raw);

    const afterUpload = store.load();
    const companyUp = afterUpload.companies.find((c) => c.id === companyId);
    const used = Number(companyUp.storageUsedBytes);
    assert.ok(used >= payload.length);
    const attCount = (afterUpload.reports.find((r) => r.id === reportId).attachments || []).filter(
      (a) => a.status === 'stored'
    ).length;
    assert.ok(attCount >= 1);

    const newLimit = MIN;

    /* Garante used > limit sem apagar: sobe used artificialmente + baixa limite via API */
    companyUp.storageUsedBytes = Math.max(used, MIN + 1000);
    store.save(afterUpload);

    const put = await request('PUT', `/settings/storage-usage/${companyId}`, {
      cookie: superCookie,
      body: { storageLimitBytes: newLimit }
    });
    assert.equal(put.status, 200, put.json?.error || put.raw);
    assert.equal(put.json.overLimit, true);
    assert.ok(put.json.storagePercent >= 100);

    const mid = store.load();
    const still = (mid.reports.find((r) => r.id === reportId).attachments || []).filter(
      (a) => a.status === 'stored'
    );
    assert.ok(still.length >= 1, 'anexos existentes devem permanecer');
    assert.equal(still[0].name, 'keep.txt');

    const blocked = await request('POST', `/reports/${reportId}/attachments`, {
      cookie: adminCookie,
      body: {
        name: 'blocked.txt',
        mimeType: 'text/plain',
        dataBase64: Buffer.from('x').toString('base64')
      }
    });
    assert.equal(blocked.status, 400);
    assert.match(String(blocked.json?.error || ''), /quota|esgotad|limite/i);
  });
});
