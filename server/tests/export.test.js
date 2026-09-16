'use strict';

const { describe, it, before, after } = require('node:test');
const assert = require('node:assert/strict');
const http = require('node:http');
const store = require('../src/store');
const { loginComplete } = require('./helpers/auth');
const { csrfHeaders } = require('./helpers/http');

const BASE = `http://127.0.0.1:${process.env.CS_TEST_PORT || 3142}`;
const API = `${BASE}/api/v1`;

function request(method, path, { body, cookie, binary } = {}) {
  return new Promise((resolve, reject) => {
    const url = new URL(`${API}${path.startsWith('/') ? path : `/${path}`}`);
    const opts = {
      method,
      hostname: url.hostname,
      port: url.port,
      path: url.pathname + url.search,
      headers: {
        ...(body ? { 'Content-Type': 'application/json' } : {}),
        ...(cookie ? { Cookie: cookie, ...csrfHeaders(cookie) } : {})
      }
    };
    const req = http.request(opts, (res) => {
      const chunks = [];
      res.on('data', (c) => chunks.push(c));
      res.on('end', () => {
        const buf = Buffer.concat(chunks);
        if (binary) {
          return resolve({
            status: res.statusCode,
            headers: res.headers,
            buffer: buf,
            contentType: res.headers['content-type']
          });
        }
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
let auroraAdminCookie;
let auroraApuradorCookie;
let horizonCookie;

before(async () => {
  process.env.CS_JWT_SECRET = 'test-secret-export';
  process.env.CS_DEV_MODE = '1';
  process.env.CS_EMAIL_SYNC = '1';
  process.env.CS_TEST_PORT = process.env.CS_TEST_PORT || '3142';
  const { createApp } = require('../src/app');
  server = createApp().listen(Number(process.env.CS_TEST_PORT || 3142));
  auroraAdminCookie = await loginComplete(request, 'admin@aurora-demo.com.br', 'empresa123');
  auroraApuradorCookie = await loginComplete(request, 'apuracao@aurora-demo.com.br', 'empresa123');
  horizonCookie = await loginComplete(request, 'admin@horizon-demo.com.br', 'empresa123');
});

after(() => {
  if (server) server.close();
});

describe('Permissões de exportação', () => {
  it('apurador pode exportar PDF individual', async () => {
    const res = await request('POST', '/reports/rpt_001/export/pdf', {
      cookie: auroraApuradorCookie,
      body: { type: 'individual' },
      binary: true
    });
    assert.equal(res.status, 200);
    assert.match(res.contentType || '', /pdf/);
    assert.ok(res.buffer.length > 500);
    assert.ok(res.buffer.slice(0, 5).toString() === '%PDF-');
  });

  it('apurador não exporta gerencial', async () => {
    const res = await request('POST', '/reports/export/pdf', {
      cookie: auroraApuradorCookie,
      body: { filters: {} },
      binary: true
    });
    assert.equal(res.status, 403);
  });

  it('admin exporta gerencial', async () => {
    const res = await request('POST', '/reports/export/pdf', {
      cookie: auroraAdminCookie,
      body: { filters: { companyId: 'cmp_aurora' } },
      binary: true
    });
    assert.equal(res.status, 200);
    assert.ok(res.buffer.slice(0, 5).toString() === '%PDF-');
  });

  it('horizon não exporta relato aurora', async () => {
    const res = await request('POST', '/reports/rpt_001/export/pdf', {
      cookie: horizonCookie,
      body: { type: 'individual' },
      binary: true
    });
    assert.equal(res.status, 404);
  });
});

describe('Auditoria', () => {
  it('registra exportacao_pdf após export individual', async () => {
    const before = (store.load().auditLogs || []).filter((a) => a.action === 'exportacao_pdf').length;
    await request('POST', '/reports/rpt_002/export/pdf', {
      cookie: auroraAdminCookie,
      body: { type: 'investigation' },
      binary: true
    });
    const after = (store.load().auditLogs || []).filter((a) => a.action === 'exportacao_pdf').length;
    assert.ok(after > before);
    const last = (store.load().auditLogs || []).find((a) => a.action === 'exportacao_pdf');
    assert.equal(last.newValue.exportType, 'investigation');
    assert.equal(last.protocol, 'CS-2026-000102');
  });
});

describe('Tipos disponíveis', () => {
  it('apurador vê individual e investigation', async () => {
    const res = await request('GET', '/reports/export/types', { cookie: auroraApuradorCookie });
    assert.equal(res.status, 200);
    const ids = res.json.types.map((t) => t.id);
    assert.ok(ids.includes('individual'));
    assert.ok(ids.includes('investigation'));
    assert.ok(!ids.includes('managerial'));
  });
});
