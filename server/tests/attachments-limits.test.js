'use strict';

/**
 * Limites de tipo/tamanho/contagem + isolamento storageKey
 */
const { describe, it, before, after } = require('node:test');
const assert = require('node:assert/strict');
const http = require('node:http');
const store = require('../src/store');
const attachmentStorage = require('../src/services/attachment-storage.service');
const { createLocalFsStorage } = require('../src/services/storage/local-fs.storage');
const { resetAllForTests } = require('../src/utils/rate-limit-gate');
const { loginComplete } = require('./helpers/auth');
const { csrfHeaders } = require('./helpers/http');

const TEST_PORT = process.env.CS_TEST_PORT_LIMITS || '3184';
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
let adminCookie;
let otherCookie;
let reportId;
let otherReportId;

before(async () => {
  process.env.CS_JWT_SECRET = 'test-secret-limits-attachments';
  process.env.CS_DEV_MODE = '1';
  await resetAllForTests();
  attachmentStorage.clearAttachmentsForTests();
  const { createApp } = require('../src/app');
  server = createApp().listen(Number(TEST_PORT));
  adminCookie = await loginComplete(request, 'admin@aurora-demo.com.br', 'empresa123');
  otherCookie = await loginComplete(request, 'admin@horizon-demo.com.br', 'empresa123');
  const data = store.load();
  const report = data.reports.find((r) => r.protocol === 'CS-2026-000101');
  reportId = report.id;
  report.attachments = [];
  const company = data.companies.find((c) => c.id === report.companyId);
  company.storageLimitBytes = 104857600;
  company.storageUsedBytes = 0;
  otherReportId = data.reports.find((r) => r.companyId === 'cmp_horizon').id;
  store.save(data);
});

after(async () => {
  attachmentStorage.clearAttachmentsForTests();
  await resetAllForTests();
  if (server) server.close();
});

describe('Limites de anexos', () => {
  it('rejeita MIME/ext inválidos', async () => {
    const sample = Buffer.from('exe-content').toString('base64');
    const res = await request('POST', `/reports/${reportId}/attachments`, {
      cookie: adminCookie,
      body: { name: 'malware.exe', mimeType: 'application/octet-stream', dataBase64: sample }
    });
    assert.equal(res.status, 400);
  });

  it('Fase A2: imagem acima de MAX_FILE_SIZE_IMAGE é rejeitada', async () => {
    const config = require('../src/config');
    const overImage = Buffer.alloc(config.ATTACHMENTS.MAX_FILE_SIZE_IMAGE + 1, 1);
    const res = await request('POST', `/reports/${reportId}/attachments`, {
      cookie: adminCookie,
      body: {
        name: 'foto.png',
        mimeType: 'image/png',
        dataBase64: overImage.toString('base64')
      }
    });
    assert.equal(res.status, 400);
    assert.match(String(res.json?.error || ''), /image|tamanho|máximo/i);
  });

  it('Fase A2: documento dentro de MAX_FILE_SIZE_DOCUMENT é aceito', async () => {
    const config = require('../src/config');
    const okDoc = Buffer.alloc(Math.min(64 * 1024, config.ATTACHMENTS.MAX_FILE_SIZE_DOCUMENT), 65);
    const res = await request('POST', `/reports/${reportId}/attachments`, {
      cookie: adminCookie,
      body: {
        name: 'nota.docx',
        mimeType: 'application/vnd.openxmlformats-officedocument.wordprocessingml.document',
        dataBase64: okDoc.toString('base64')
      }
    });
    assert.equal(res.status, 201, res.json?.error || res.raw);
  });

  it('Fase A2: áudio permanece fora da allowlist', async () => {
    const sample = Buffer.from('fake-audio').toString('base64');
    const res = await request('POST', `/reports/${reportId}/attachments`, {
      cookie: adminCookie,
      body: { name: 'voz.mp3', mimeType: 'audio/mpeg', dataBase64: sample }
    });
    assert.equal(res.status, 400);
    assert.match(String(res.json?.error || ''), /tipo|MIME|permitido/i);
  });

  it('Fase A2: thresholds de alerta 70/85/95/100', () => {
    const { storageAlertLevel } = require('../src/utils/attachment-limits');
    assert.equal(storageAlertLevel(50), null);
    assert.equal(storageAlertLevel(70), 70);
    assert.equal(storageAlertLevel(86), 85);
    assert.equal(storageAlertLevel(96), 95);
    assert.equal(storageAlertLevel(100), 100);
  });

  it('Fase A1: upload próximo de MAX_BYTES passa no parser (base64)', async () => {
    const near = Buffer.alloc(attachmentStorage.MAX_BYTES - 1024, 98);
    const res = await request('POST', `/reports/${reportId}/attachments`, {
      cookie: adminCookie,
      body: {
        name: 'near-limit.txt',
        mimeType: 'text/plain',
        dataBase64: near.toString('base64')
      }
    });
    assert.equal(res.status, 201, res.json?.error || res.raw);
    assert.ok(res.json.attachment?.id);
    assert.equal(res.json.attachment.size, near.length);
  });

  it('Fase A1: rejeita binário acima de MAX_BYTES (HTTP + auth/CSRF)', async () => {
    const over = Buffer.alloc(attachmentStorage.MAX_BYTES + 1, 99);
    const res = await request('POST', `/reports/${reportId}/attachments`, {
      cookie: adminCookie,
      body: {
        name: 'over-limit.txt',
        mimeType: 'text/plain',
        dataBase64: over.toString('base64')
      }
    });
    assert.equal(res.status, 400);
    assert.match(String(res.json?.error || ''), /tamanho|máximo|excede/i);
  });

  it('rejeita arquivo acima de MAX_BYTES (serviço)', () => {
    const data = store.load();
    const user = data.users.find((u) => u.email === 'admin@aurora-demo.com.br');
    const big = Buffer.alloc(attachmentStorage.MAX_BYTES + 1, 1);
    const result = attachmentStorage.uploadAttachment(user, reportId, {
      name: 'huge.txt',
      mimeType: 'text/plain',
      dataBase64: big.toString('base64')
    });
    assert.equal(result.ok, false);
    assert.equal(result.status, 400);
  });

  it('GET relato não expõe storageKey', async () => {
    const sample = Buffer.from('no-leak').toString('base64');
    const upload = await request('POST', `/reports/${reportId}/attachments`, {
      cookie: adminCookie,
      body: { name: 'noleak.txt', mimeType: 'text/plain', dataBase64: sample }
    });
    assert.equal(upload.status, 201);
    const get = await request('GET', `/reports/${reportId}`, { cookie: adminCookie });
    assert.equal(get.status, 200);
    const atts = get.json.attachments || [];
    atts.forEach((a) => {
      assert.equal(a.storageKey, undefined);
      assert.equal(a.path, undefined);
    });
    const stored = store.load().reports.find((r) => r.id === reportId);
    assert.ok((stored.attachments || []).some((a) => a.storageKey));
  });

  it('cross-tenant download retorna 404', async () => {
    const sample = Buffer.from('tenant-a').toString('base64');
    const upload = await request('POST', `/reports/${reportId}/attachments`, {
      cookie: adminCookie,
      body: { name: 'tenant.txt', mimeType: 'text/plain', dataBase64: sample }
    });
    assert.equal(upload.status, 201);
    const dl = await request(
      'GET',
      `/reports/${reportId}/attachments/${upload.json.attachment.id}/download`,
      { cookie: otherCookie, binary: true }
    );
    assert.equal(dl.status, 404);
  });

  it('LocalFs rejeita path traversal', () => {
    const fsStorage = createLocalFsStorage(store.DATA_DIR);
    assert.throws(() => fsStorage.get('../etc/passwd'), /inválido|fora|PATH/i);
  });

  it('LocalFs put/get sob DATA_DIR', () => {
    const fsStorage = createLocalFsStorage(store.DATA_DIR);
    const key = `attachments/_test/${Date.now()}.txt`;
    fsStorage.put(key, Buffer.from('ok'));
    assert.equal(fsStorage.get(key).toString('utf8'), 'ok');
    fsStorage.remove(key);
  });
});
