'use strict';

/**
 * Testes P1 – Etapa 11
 * redação de contact fields, helmet, CORS allowlist
 */
const { describe, it, before, after } = require('node:test');
const assert = require('node:assert/strict');
const http = require('node:http');
const { parseCorsOriginEnv, buildCorsOptions } = require('../src/middleware/cors-config');
const { loginComplete } = require('./helpers/auth');
const { csrfHeaders } = require('./helpers/http');

const TEST_PORT = process.env.CS_TEST_PORT || '3160';
const ALLOWED_ORIGIN = `http://127.0.0.1:${TEST_PORT}`;
const BASE = `http://127.0.0.1:${TEST_PORT}`;
const API = `${BASE}/api/v1`;

function request(method, path, { body, cookie, headers, binary, host = API } = {}) {
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
        resolve({ status: res.statusCode, headers: res.headers, json, raw: buf.toString('utf8') });
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
let horizonAdminCookie;

before(async () => {
  process.env.CS_JWT_SECRET = 'test-secret-security-p1-32chars';
  process.env.CS_DEV_MODE = '1';
  process.env.CS_CORS_ORIGIN = ALLOWED_ORIGIN;
  process.env.CS_TEST_PORT = TEST_PORT;

  delete require.cache[require.resolve('../src/config')];
  delete require.cache[require.resolve('../src/app')];

  const { createApp } = require('../src/app');
  server = createApp().listen(Number(TEST_PORT));

  auroraAdminCookie = await loginComplete(request, 'admin@aurora-demo.com.br', 'empresa123');
  auroraApuradorCookie = await loginComplete(request, 'apuracao@aurora-demo.com.br', 'empresa123');
  horizonAdminCookie = await loginComplete(request, 'admin@horizon-demo.com.br', 'empresa123');
});

after(() => {
  if (server) server.close();
});

describe('P1 – redação de contactEmail/contactPhone', () => {
  it('apurador não recebe contactEmail em relato identificado', async () => {
    const res = await request('GET', '/reports/rpt_002', { cookie: auroraApuradorCookie });
    assert.equal(res.status, 200);
    assert.equal(res.json.contactEmail, undefined);
    assert.equal(res.json.contactPhone, undefined);
  });

  it('admin recebe contactEmail em relato identificado', async () => {
    const res = await request('GET', '/reports/rpt_002', { cookie: auroraAdminCookie });
    assert.equal(res.status, 200);
    assert.equal(res.json.contactEmail, 'colaborador.demo@email.com');
  });

  it('admin não recebe contactEmail em relato anônimo', async () => {
    const res = await request('GET', '/reports/rpt_003', { cookie: horizonAdminCookie });
    assert.equal(res.status, 200);
    assert.equal(res.json.isAnonymous, true);
    assert.equal(res.json.contactEmail, undefined);
    assert.equal(res.json.contactPhone, undefined);
  });

  it('listagem de relatos também redige contact para apurador', async () => {
    const res = await request('GET', '/reports', { cookie: auroraApuradorCookie });
    assert.equal(res.status, 200);
    const rpt002 = res.json.find((r) => r.id === 'rpt_002');
    assert.ok(rpt002);
    assert.equal(rpt002.contactEmail, undefined);
  });
});

describe('P1 – export PDF redige contato', () => {
  it('PDF do apurador não contém e-mail de contato do denunciante', async () => {
    const res = await request('POST', '/reports/rpt_002/export/pdf', {
      cookie: auroraApuradorCookie,
      body: { type: 'individual' },
      binary: true
    });
    assert.equal(res.status, 200);
    const text = res.buffer.toString('latin1');
    assert.ok(!text.includes('colaborador.demo@email.com'));
  });

  it('payload de exportação do admin inclui contactEmail', () => {
    const exportData = require('../src/services/export-data.service');
    const store = require('../src/store');
    const data = store.load();
    const admin = data.users.find((u) => u.email === 'admin@aurora-demo.com.br');
    const user = {
      id: admin.id,
      nome: admin.nome,
      role: admin.role,
      companyId: admin.companyId
    };
    const result = exportData.buildReportExportPayload(user, 'rpt_002', 'individual');
    assert.equal(result.ok, true);
    assert.equal(result.data.contactEmail, 'colaborador.demo@email.com');
    assert.equal(result.data.identity.nome, 'Juliana Costa (fictício)');
  });

  it('payload de exportação do apurador omite contactEmail', () => {
    const exportData = require('../src/services/export-data.service');
    const store = require('../src/store');
    const data = store.load();
    const apurador = data.users.find((u) => u.email === 'apuracao@aurora-demo.com.br');
    const user = {
      id: apurador.id,
      nome: apurador.nome,
      role: apurador.role,
      companyId: apurador.companyId
    };
    const result = exportData.buildReportExportPayload(user, 'rpt_002', 'individual');
    assert.equal(result.ok, true);
    assert.equal(result.data.contactEmail, undefined);
    assert.equal(result.data.identity.nome, '[restrito]');
  });
});

describe('P1 – security headers (helmet)', () => {
  it('resposta da API inclui X-Content-Type-Options', async () => {
    const res = await request('GET', '/health');
    assert.equal(res.status, 200);
    assert.equal(res.headers['x-content-type-options'], 'nosniff');
  });

  it('resposta inclui Referrer-Policy', async () => {
    const res = await request('GET', '/health');
    assert.ok(res.headers['referrer-policy']);
  });
});

describe('P1 – CORS allowlist', () => {
  it('origem permitida recebe Access-Control-Allow-Origin', async () => {
    const res = await request('GET', '/health', {
      headers: { Origin: ALLOWED_ORIGIN }
    });
    assert.equal(res.headers['access-control-allow-origin'], ALLOWED_ORIGIN);
  });

  it('origem não listada não recebe Access-Control-Allow-Origin', async () => {
    const res = await request('GET', '/health', {
      headers: { Origin: 'http://evil.example.com' }
    });
    assert.equal(res.headers['access-control-allow-origin'], undefined);
  });

  it('parseCorsOriginEnv interpreta lista separada por vírgula', () => {
    const origins = parseCorsOriginEnv('https://a.com, https://b.com');
    assert.deepEqual(origins, ['https://a.com', 'https://b.com']);
  });

  it('buildCorsOptions rejeita origem fora da lista', () => {
    const opts = buildCorsOptions(['https://allowed.com']);
    return new Promise((resolve, reject) => {
      opts.origin('https://allowed.com', (err, ok) => {
        try {
          assert.equal(err, null);
          assert.equal(ok, true);
          opts.origin('https://blocked.com', (err2, ok2) => {
            assert.equal(err2, null);
            assert.equal(ok2, false);
            resolve();
          });
        } catch (e) {
          reject(e);
        }
      });
    });
  });
});

describe('P1 – validate-config produção', () => {
  it('exige CS_CORS_ORIGIN em produção', () => {
    const prevNode = process.env.NODE_ENV;
    const prevJwt = process.env.CS_JWT_SECRET;
    const prevWebhook = process.env.CS_EMAIL_WEBHOOK_SECRET;
    const prevCors = process.env.CS_CORS_ORIGIN;

    process.env.NODE_ENV = 'production';
    process.env.CS_JWT_SECRET = 'a'.repeat(32);
    process.env.CS_EMAIL_WEBHOOK_SECRET = 'webhook-secret-ok';
    delete process.env.CS_CORS_ORIGIN;

    delete require.cache[require.resolve('../src/validate-config')];
    const { assertProductionConfig } = require('../src/validate-config');

    assert.throws(() => assertProductionConfig(), /CS_CORS_ORIGIN/);

    process.env.NODE_ENV = prevNode;
    if (prevJwt) process.env.CS_JWT_SECRET = prevJwt;
    if (prevWebhook) process.env.CS_EMAIL_WEBHOOK_SECRET = prevWebhook;
    if (prevCors) process.env.CS_CORS_ORIGIN = prevCors;
  });
});
