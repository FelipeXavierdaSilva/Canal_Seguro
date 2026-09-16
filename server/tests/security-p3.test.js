'use strict';

/**
 * Testes P3 – Etapa 11
 * CSRF, auditoria append-only, anexos privados, rate limits migrados
 */
const { describe, it, before, after } = require('node:test');
const assert = require('node:assert/strict');
const http = require('node:http');
const fs = require('node:fs');
const path = require('node:path');
const store = require('../src/store');
const { assertAuditIntegrity } = require('../src/services/audit.service');
const attachmentStorage = require('../src/services/attachment-storage.service');
const { resetAllForTests } = require('../src/utils/rate-limit-gate');
const { loginComplete } = require('./helpers/auth');
const { csrfHeaders } = require('./helpers/http');

const TEST_PORT = process.env.CS_TEST_PORT || '3180';
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

function parseCookie(setCookie) {
  if (!setCookie) return '';
  const arr = Array.isArray(setCookie) ? setCookie : [setCookie];
  return arr.map((c) => c.split(';')[0]).join('; ');
}

let server;
let adminCookie;
let reportId;

before(async () => {
  process.env.CS_JWT_SECRET = 'test-secret-p3-security';
  process.env.CS_DEV_MODE = '1';
  process.env.CS_TEST_PORT = TEST_PORT;
  await resetAllForTests();
  attachmentStorage.clearAttachmentsForTests();
  const { createApp } = require('../src/app');
  server = createApp().listen(Number(TEST_PORT));
  adminCookie = await loginComplete(request, 'admin@aurora-demo.com.br', 'empresa123');
  const data = store.load();
  const report = data.reports.find((r) => r.protocol === 'CS-2026-000101');
  reportId = report.id;
  report.attachments = [];
  const company = data.companies.find((c) => c.id === report.companyId);
  if (company) {
    company.storageLimitBytes = 104857600;
    company.storageUsedBytes = 0;
  }
  store.save(data);
});

after(async () => {
  attachmentStorage.clearAttachmentsForTests();
  await resetAllForTests();
  if (server) server.close();
});

describe('CSRF – mutações com cookie', () => {
  it('bloqueia PATCH sem header X-CSRF-Token', async () => {
    const res = await request('PATCH', `/reports/${reportId}/status`, {
      body: { status: 'em_analise' },
      cookie: adminCookie,
      headers: { 'X-CSRF-Token': '' }
    });
    assert.equal(res.status, 403);
    assert.match(res.json.error, /CSRF/i);
  });

  it('permite PATCH com token CSRF válido', async () => {
    const res = await request('POST', `/reports/${reportId}/observations`, {
      body: { text: 'observação teste csrf p3', kind: 'interna' },
      cookie: adminCookie
    });
    assert.equal(res.status, 200);
  });
});

describe('Auditoria append-only', () => {
  it('impede remoção de logs existentes no save', () => {
    const data = store.load();
    const copy = JSON.parse(JSON.stringify(data));
    if (!copy.auditLogs?.length) {
      copy.auditLogs = [{ id: 'aud_test', date: new Date().toISOString(), action: 'test' }];
      store.save(copy);
    }
    const tampered = store.load();
    const next = JSON.parse(JSON.stringify(tampered));
    next.auditLogs = next.auditLogs.slice(1);
    assert.throws(() => assertAuditIntegrity(tampered, next), /Remoção de registro/);
  });

  it('impede alteração de log existente', () => {
    const current = store.load();
    const next = JSON.parse(JSON.stringify(current));
    if (!next.auditLogs?.length) return;
    next.auditLogs[0] = { ...next.auditLogs[0], action: 'tampered' };
    assert.throws(() => assertAuditIntegrity(current, next), /Alteração de registro/);
  });
});

describe('Anexos em storage privado', () => {
  const sample = Buffer.from('conteudo teste p3').toString('base64');

  it('faz upload e download autenticado', async () => {
    const upload = await request('POST', `/reports/${reportId}/attachments`, {
      cookie: adminCookie,
      body: { name: 'nota.txt', mimeType: 'text/plain', dataBase64: sample }
    });
    assert.equal(upload.status, 201);
    assert.ok(upload.json.attachment?.id);

    const download = await request(
      'GET',
      `/reports/${reportId}/attachments/${upload.json.attachment.id}/download`,
      { cookie: adminCookie, binary: true }
    );
    assert.equal(download.status, 200);
    assert.equal(download.raw.toString('utf8'), 'conteudo teste p3');
  });

  it('arquivo não fica exposto em URL pública', () => {
    const data = store.load();
    const report = data.reports.find((r) => r.id === reportId);
    const att = (report.attachments || []).find((a) => a.storageKey);
    assert.ok(att?.storageKey);
    const abs = path.join(store.DATA_DIR, att.storageKey);
    assert.ok(fs.existsSync(abs));
    assert.ok(att.storageKey.startsWith('attachments/'));
  });

  it('GET relato não devolve storageKey ao cliente', async () => {
    const get = await request('GET', `/reports/${reportId}`, { cookie: adminCookie });
    assert.equal(get.status, 200);
    (get.json.attachments || []).forEach((a) => {
      assert.equal(a.storageKey, undefined);
    });
  });
});

describe('Rate limit – consulta pública', () => {
  it('retorna 429 após excesso de tentativas', async () => {
    await resetAllForTests();
    const cfg = require('../src/config').PUBLIC_CONSULT;
    let lastStatus = 404;
    for (let i = 0; i < cfg.MAX_FAILURES + 2; i += 1) {
      const res = await request('POST', '/public/consult', {
        body: { protocol: 'INVALID', trackingCode: '000000' }
      });
      lastStatus = res.status;
      if (res.status === 429) break;
    }
    assert.equal(lastStatus, 429);
  });
});
