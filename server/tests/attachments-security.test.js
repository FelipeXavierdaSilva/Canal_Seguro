'use strict';

/**
 * Fase A4 — Segurança de anexos (tenant, strip, traversal, auth)
 */
const { describe, it, before, after } = require('node:test');
const assert = require('node:assert/strict');
const http = require('node:http');
const path = require('path');
const fs = require('node:fs');
const store = require('../src/store');
const attachmentStorage = require('../src/services/attachment-storage.service');
const { createLocalFsStorage } = require('../src/services/storage/local-fs.storage');
const { resetAllForTests } = require('../src/utils/rate-limit-gate');
const { loginComplete } = require('./helpers/auth');
const { csrfHeaders } = require('./helpers/http');

const TEST_PORT = process.env.CS_TEST_PORT_ATT_SEC || '3185';
const BASE = `http://127.0.0.1:${TEST_PORT}`;
const API = `${BASE}/api/v1`;

function request(method, pathName, { body, cookie, headers, host = API, binary } = {}) {
  return new Promise((resolve, reject) => {
    const fullPath = pathName.startsWith('http')
      ? pathName
      : `${host}${pathName.startsWith('/') ? pathName : `/${pathName}`}`;
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
let auroraCookie;
let horizonCookie;
let auroraReportId;
let auroraCompanyId;
let attachmentId;

before(async () => {
  process.env.CS_JWT_SECRET = 'test-secret-a4-attachments-security';
  process.env.CS_DEV_MODE = '1';
  await resetAllForTests();
  attachmentStorage.clearAttachmentsForTests();
  const { createApp } = require('../src/app');
  server = createApp().listen(Number(TEST_PORT));
  auroraCookie = await loginComplete(request, 'admin@aurora-demo.com.br', 'empresa123');
  horizonCookie = await loginComplete(request, 'admin@horizon-demo.com.br', 'empresa123');
  const data = store.load();
  const report = data.reports.find((r) => r.protocol === 'CS-2026-000101');
  auroraReportId = report.id;
  auroraCompanyId = report.companyId;
  report.attachments = [];
  const company = data.companies.find((c) => c.id === auroraCompanyId);
  if (company) {
    company.storageLimitBytes = 1 * 1024 * 1024 * 1024;
    company.storageUsedBytes = 0;
  }
  store.save(data);

  const upload = await request('POST', `/reports/${auroraReportId}/attachments`, {
    cookie: auroraCookie,
    body: {
      name: 'sec-a4.txt',
      mimeType: 'text/plain',
      dataBase64: Buffer.from('conteudo-a4').toString('base64')
    }
  });
  assert.equal(upload.status, 201, upload.json?.error || upload.raw);
  attachmentId = upload.json.attachment.id;
  assert.equal(upload.json.attachment.storageKey, undefined);
});

after(async () => {
  attachmentStorage.clearAttachmentsForTests();
  await resetAllForTests();
  if (server) server.close();
});

describe('Fase A4 — Segurança de anexos', () => {
  it('GET relato não expõe storageKey nem paths', async () => {
    const get = await request('GET', `/reports/${auroraReportId}`, { cookie: auroraCookie });
    assert.equal(get.status, 200);
    for (const a of get.json.attachments || []) {
      assert.equal(a.storageKey, undefined);
      assert.equal(a.path, undefined);
      assert.equal(a.url, undefined);
      assert.equal(a.downloadUrl, undefined);
    }
  });

  it('Empresa A não baixa anexo da Empresa B (cross-tenant → 404)', async () => {
    const dl = await request(
      'GET',
      `/reports/${auroraReportId}/attachments/${attachmentId}/download`,
      { cookie: horizonCookie, binary: true }
    );
    assert.equal(dl.status, 404);
  });

  it('companyId spoof no body não altera tenant do arquivo', async () => {
    const spoof = await request('POST', `/reports/${auroraReportId}/attachments`, {
      cookie: auroraCookie,
      body: {
        name: 'spoof.txt',
        mimeType: 'text/plain',
        dataBase64: Buffer.from('spoof-body').toString('base64'),
        companyId: 'cmp_horizon'
      }
    });
    assert.equal(spoof.status, 201, spoof.json?.error || spoof.raw);
    const data = store.load();
    const report = data.reports.find((r) => r.id === auroraReportId);
    const att = (report.attachments || []).find((a) => a.id === spoof.json.attachment.id);
    assert.ok(att.storageKey.startsWith(`attachments/${auroraCompanyId}/`));
    assert.ok(!att.storageKey.includes('cmp_horizon'));
  });

  it('path traversal no nome é sanitizado e permanece sob DATA_DIR', async () => {
    const res = await request('POST', `/reports/${auroraReportId}/attachments`, {
      cookie: auroraCookie,
      body: {
        name: '../../etc/passwd.txt',
        mimeType: 'text/plain',
        dataBase64: Buffer.from('trav').toString('base64')
      }
    });
    assert.equal(res.status, 201, res.json?.error || res.raw);
    const data = store.load();
    const report = data.reports.find((r) => r.id === auroraReportId);
    const att = (report.attachments || []).find((a) => a.id === res.json.attachment.id);
    assert.ok(att);
    assert.equal(att.name.includes('..'), false);
    assert.ok(att.storageKey.startsWith(`attachments/${auroraCompanyId}/${auroraReportId}/`));
    const abs = path.join(store.DATA_DIR, att.storageKey);
    assert.ok(path.resolve(abs).startsWith(path.resolve(store.DATA_DIR)));
    assert.ok(fs.existsSync(abs));
  });

  it('storageKey adulterado com traversal é rejeitado no download', async () => {
    const data = store.load();
    const report = data.reports.find((r) => r.id === auroraReportId);
    const att = (report.attachments || []).find((a) => a.id === attachmentId);
    assert.ok(att);
    const original = att.storageKey;
    att.storageKey = 'attachments/../etc/passwd';
    store.save(data);

    const dl = await request(
      'GET',
      `/reports/${auroraReportId}/attachments/${attachmentId}/download`,
      { cookie: auroraCookie, binary: true }
    );
    assert.equal(dl.status, 404);

    const dataFix = store.load();
    const reportFix = dataFix.reports.find((r) => r.id === auroraReportId);
    const attFix = (reportFix.attachments || []).find((a) => a.id === attachmentId);
    attFix.storageKey = original;
    store.save(dataFix);

    const fsStorage = createLocalFsStorage(store.DATA_DIR);
    assert.throws(() => fsStorage.get('attachments/../../../etc/passwd'), /inválido|fora|PATH/i);
  });

  it('download sem autenticação retorna 401', async () => {
    const dl = await request(
      'GET',
      `/reports/${auroraReportId}/attachments/${attachmentId}/download`,
      { binary: true }
    );
    assert.equal(dl.status, 401);
  });

  it('download autenticado envia Cache-Control private', async () => {
    const dl = await request(
      'GET',
      `/reports/${auroraReportId}/attachments/${attachmentId}/download`,
      { cookie: auroraCookie, binary: true }
    );
    assert.equal(dl.status, 200);
    const cc = String(dl.headers['cache-control'] || '');
    assert.match(cc, /private/i);
    assert.match(cc, /no-store/i);
  });

  it('tentativa cross-tenant gera auditoria de negação', async () => {
    const before = (store.load().auditLogs || []).length;
    await request('GET', `/reports/${auroraReportId}/attachments/${attachmentId}/download`, {
      cookie: horizonCookie,
      binary: true
    });
    const logs = store.load().auditLogs || [];
    assert.ok(logs.length >= before);
    const denied = logs.filter((l) => l.action === 'acesso_anexo_negado');
    assert.ok(denied.length >= 1);
  });
});
