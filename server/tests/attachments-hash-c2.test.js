'use strict';

/**
 * Fase C2 — SHA-256 em anexos stored + auditoria
 */
const { describe, it, before, after } = require('node:test');
const assert = require('node:assert/strict');
const crypto = require('crypto');
const http = require('node:http');
const store = require('../src/store');
const attachmentStorage = require('../src/services/attachment-storage.service');
const companyStorage = require('../src/services/company-storage.service');
const { sha256Hex } = require('../src/utils/attachment-hash');
const { resetAllForTests } = require('../src/utils/rate-limit-gate');
const { loginComplete } = require('./helpers/auth');
const { csrfHeaders } = require('./helpers/http');

const TEST_PORT = process.env.CS_TEST_PORT_HASH_C2 || '3186';
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
let otherCookie;
let reportId;
let companyId;

before(async () => {
  process.env.CS_JWT_SECRET = 'test-secret-hash-c2';
  process.env.CS_DEV_MODE = '1';
  await resetAllForTests();
  attachmentStorage.clearAttachmentsForTests();
  const { createApp } = require('../src/app');
  server = createApp().listen(Number(TEST_PORT));
  adminCookie = await loginComplete(request, 'admin@aurora-demo.com.br', 'empresa123');
  otherCookie = await loginComplete(request, 'admin@horizon-demo.com.br', 'empresa123');
  const data = store.load();
  const report = data.reports.find((r) => r.protocol === 'CS-2026-000112');
  reportId = report.id;
  companyId = report.companyId;
  report.attachments = [];
  const company = data.companies.find((c) => c.id === companyId);
  companyStorage.ensureCompanyStorageFields(company, data);
  company.storageLimitBytes = companyStorage.defaultLimit();
  company.storageUsedBytes = 0;
  store.save(data);
});

after(async () => {
  attachmentStorage.clearAttachmentsForTests();
  await resetAllForTests();
  if (server) server.close();
});

describe('Fase C2 — SHA-256 e auditoria de anexos', () => {
  it('sha256Hex é estável para o mesmo conteúdo', () => {
    const a = Buffer.from('conteudo-estavel-c2');
    const b = Buffer.from('conteudo-estavel-c2');
    const h1 = sha256Hex(a);
    const h2 = sha256Hex(b);
    assert.equal(h1, h2);
    assert.equal(h1, crypto.createHash('sha256').update(a).digest('hex'));
    assert.notEqual(sha256Hex(Buffer.from('outro')), h1);
    assert.ok(Buffer.compare(a, Buffer.from('conteudo-estavel-c2')) === 0);
  });

  it('upload stored grava sha256 sem alterar bytes', async () => {
    const payload = Buffer.from('hash-payload-identical-bytes');
    const expected = sha256Hex(payload);
    const upload = await request('POST', `/reports/${reportId}/attachments`, {
      cookie: adminCookie,
      body: {
        name: 'hash.txt',
        mimeType: 'text/plain',
        dataBase64: payload.toString('base64')
      }
    });
    assert.equal(upload.status, 201, upload.json?.error || upload.raw);
    assert.equal(upload.json.attachment.sha256, expected);

    const data = store.load();
    const report = data.reports.find((r) => r.id === reportId);
    const att = (report.attachments || []).find((a) => a.id === upload.json.attachment.id);
    assert.equal(att.sha256, expected);
    assert.equal(att.size, payload.length);

    const dl = await request(
      'GET',
      `/reports/${reportId}/attachments/${att.id}/download`,
      { cookie: adminCookie, binary: true }
    );
    assert.equal(dl.status, 200);
    assert.ok(Buffer.compare(dl.raw, payload) === 0);
    assert.equal(sha256Hex(dl.raw), expected);

    const auditOk = (data.auditLogs || []).find(
      (l) => l.action === 'upload_anexo' && l.resourceId === att.id && l.newValue?.sha256 === expected
    );
    assert.ok(auditOk, 'auditoria upload ok esperada');
    const auditDl = (store.load().auditLogs || []).find(
      (l) => l.action === 'download_anexo' && l.resourceId === att.id
    );
    assert.ok(auditDl, 'auditoria download esperada');
  });

  it('dois uploads do mesmo conteúdo compartilham o mesmo sha256', async () => {
    const payload = Buffer.from('mesmo-conteudo-duas-vezes');
    const expected = sha256Hex(payload);
    const u1 = await request('POST', `/reports/${reportId}/attachments`, {
      cookie: adminCookie,
      body: { name: 'a1.txt', mimeType: 'text/plain', dataBase64: payload.toString('base64') }
    });
    const u2 = await request('POST', `/reports/${reportId}/attachments`, {
      cookie: adminCookie,
      body: { name: 'a2.txt', mimeType: 'text/plain', dataBase64: payload.toString('base64') }
    });
    assert.equal(u1.status, 201);
    assert.equal(u2.status, 201);
    assert.equal(u1.json.attachment.sha256, expected);
    assert.equal(u2.json.attachment.sha256, expected);
    assert.notEqual(u1.json.attachment.id, u2.json.attachment.id);
  });

  it('upload bloqueado por tamanho gera auditoria', async () => {
    const over = Buffer.alloc(attachmentStorage.MAX_BYTES + 1, 0x61);
    const before = (store.load().auditLogs || []).filter((l) => l.action === 'upload_anexo_bloqueado')
      .length;
    const upload = await request('POST', `/reports/${reportId}/attachments`, {
      cookie: adminCookie,
      body: {
        name: 'big.txt',
        mimeType: 'text/plain',
        dataBase64: over.toString('base64')
      }
    });
    assert.equal(upload.status, 400);
    const blocked = (store.load().auditLogs || []).filter((l) => l.action === 'upload_anexo_bloqueado');
    assert.ok(blocked.length > before);
    assert.ok(blocked.some((l) => l.newValue?.reason === 'size_limit'));
  });

  it('upload bloqueado por quota gera auditoria', async () => {
    const data = store.load();
    const company = data.companies.find((c) => c.id === companyId);
    company.storageLimitBytes = 10;
    company.storageUsedBytes = 10;
    store.save(data);

    const before = (store.load().auditLogs || []).filter((l) => l.action === 'upload_anexo_bloqueado')
      .length;
    const upload = await request('POST', `/reports/${reportId}/attachments`, {
      cookie: adminCookie,
      body: {
        name: 'quota.txt',
        mimeType: 'text/plain',
        dataBase64: Buffer.from('x').toString('base64')
      }
    });
    assert.equal(upload.status, 400);
    const blocked = (store.load().auditLogs || []).filter((l) => l.action === 'upload_anexo_bloqueado');
    assert.ok(blocked.length > before);
    assert.ok(blocked.some((l) => l.newValue?.reason === 'quota'));

    company.storageLimitBytes = companyStorage.defaultLimit();
    company.storageUsedBytes = 0;
    store.save(store.load());
    const fix = store.load();
    const c = fix.companies.find((x) => x.id === companyId);
    c.storageLimitBytes = companyStorage.defaultLimit();
    c.storageUsedBytes = companyStorage.sumStoredBytesForCompany(fix, companyId);
    store.save(fix);
  });

  it('negado cross-tenant gera acesso_anexo_negado', async () => {
    const data = store.load();
    const report = data.reports.find((r) => r.id === reportId);
    const att = (report.attachments || []).find((a) => a.status === 'stored');
    assert.ok(att);
    const before = (store.load().auditLogs || []).filter((l) => l.action === 'acesso_anexo_negado')
      .length;
    const dl = await request('GET', `/reports/${reportId}/attachments/${att.id}/download`, {
      cookie: otherCookie,
      binary: true
    });
    assert.equal(dl.status, 404);
    const denied = (store.load().auditLogs || []).filter((l) => l.action === 'acesso_anexo_negado');
    assert.ok(denied.length > before);
  });
});
