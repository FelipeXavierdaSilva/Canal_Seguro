'use strict';

/**
 * Testes IDOR/BOLA – Etapa 03 Fase 1
 * Executar com servidor rodando: npm start (outro terminal) && npm test
 */
const { describe, it, before, after } = require('node:test');
const assert = require('node:assert/strict');
const http = require('node:http');

const BASE = `http://127.0.0.1:${process.env.CS_TEST_PORT || 3099}`;
const API = `${BASE}/api/v1`;

function request(method, path, { body, cookie, headers } = {}) {
  return new Promise((resolve, reject) => {
    const fullPath = `${API}${path.startsWith('/') ? path : `/${path}`}`;
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
      let data = '';
      res.on('data', (c) => (data += c));
      res.on('end', () => {
        let json = null;
        try {
          json = data ? JSON.parse(data) : null;
        } catch {
          json = data;
        }
        resolve({ status: res.statusCode, headers: res.headers, json });
      });
    });
    req.on('error', reject);
    if (body) req.write(JSON.stringify(body));
    req.end();
  });
}

const { parseCookie, loginComplete } = require('./helpers/auth');
const { csrfHeaders } = require('./helpers/http');

let server;
let auroraCookie;
let horizonCookie;

before(async () => {
  process.env.CS_JWT_SECRET = 'test-secret';
  const { createApp } = require('../src/app');
  server = createApp().listen(Number(process.env.CS_TEST_PORT || 3099));

  auroraCookie = await loginComplete(request, 'admin@aurora-demo.com.br', 'empresa123');
  horizonCookie = await loginComplete(request, 'admin@horizon-demo.com.br', 'empresa123');
});

after(() => {
  if (server) server.close();
});

describe('Auth deny by default', () => {
  it('GET /reports sem sessão retorna 401', async () => {
    const res = await request('GET', '/reports');
    assert.equal(res.status, 401);
  });
});

describe('IDOR cross-tenant', () => {
  it('Usuário Aurora não acessa relato Horizon (rpt_003)', async () => {
    const res = await request('GET', '/reports/rpt_003', { cookie: auroraCookie });
    assert.equal(res.status, 404);
  });

  it('Usuário Aurora lista apenas relatos Aurora', async () => {
    const res = await request('GET', '/reports', { cookie: auroraCookie });
    assert.equal(res.status, 200);
    assert.ok(Array.isArray(res.json));
    assert.ok(res.json.every((r) => r.companyId === 'cmp_aurora'));
  });

  it('companyId no query string não expande tenant de admin_empresa', async () => {
    const res = await request('GET', '/reports?companyId=cmp_horizon', { cookie: auroraCookie });
    assert.equal(res.status, 200);
    assert.ok(res.json.every((r) => r.companyId === 'cmp_aurora'));
  });
});

describe('BOLA status change', () => {
  it('Horizon admin não altera status de relato Aurora', async () => {
    const res = await request('PATCH', '/reports/rpt_001/status', {
      cookie: horizonCookie,
      body: { status: 'concluido' }
    });
    assert.equal(res.status, 404);
  });
});

describe('Consulta pública', () => {
  it('Protocolo sem tracking code retorna 404 genérico', async () => {
    const res = await request('POST', '/public/consult', {
      body: { protocol: 'CS-2026-000101', trackingCode: 'WRONG-CODE-HERE' }
    });
    assert.equal(res.status, 404);
  });

  it('Protocolo + tracking válidos retornam apenas campos públicos', async () => {
    const res = await request('POST', '/public/consult', {
      body: { protocol: 'CS-2026-000101', trackingCode: '7H9K-42MP-X8QZ' }
    });
    assert.equal(res.status, 200);
    assert.equal(res.json.protocol, 'CS-2026-000101');
    assert.ok(res.json.status);
    assert.equal(res.json.description, undefined);
    assert.equal(res.json.trackingCode, undefined);
  });
});

describe('Employee report token', () => {
  it('createReport sem token employee retorna 401', async () => {
    const res = await request('POST', '/employee/reports', {
      body: {
        companyId: 'cmp_aurora',
        employeeId: 'emp_aurora_1',
        category: 'outro',
        description: 'teste'
      }
    });
    assert.equal(res.status, 401);
  });

  it('employeeId spoofado no body é ignorado – exige token', async () => {
    const validate = await request('POST', '/auth/employee/validate', {
      body: { companyId: 'cmp_aurora', cpf: '52998224725' }
    });
    assert.equal(validate.status, 200);
    const empCookie = parseCookie(validate.headers['set-cookie']);
    const token = validate.json.employeeToken;

    const create = await request('POST', '/employee/reports', {
      cookie: empCookie,
      headers: { 'X-Employee-Token': token },
      body: {
        companyId: 'cmp_horizon',
        employeeId: 'emp_horizon_1',
        category: 'outro',
        isAnonymous: true,
        description: 'Relato teste automatizado'
      }
    });
    assert.equal(create.status, 201);
    assert.equal(create.json.companyId, 'cmp_aurora');
  });
});

describe('Identidade restrita', () => {
  it('Apurador não recebe dados completos de reporter', async () => {
    const login = await request('POST', '/auth/login', {
      body: { email: 'apuracao@aurora-demo.com.br', password: 'empresa123' }
    });
    assert.equal(login.status, 200);
    assert.equal(login.json.complete, true);
    const cookie = parseCookie(login.headers['set-cookie']);
    const res = await request('GET', '/reports/rpt_002', { cookie });
    assert.equal(res.status, 200);
    if (res.json.reporter) {
      assert.equal(res.json.reporter.nome, '[restrito]');
    }
  });

  it('Apurador não recebe contactEmail nem contactPhone', async () => {
    const login = await request('POST', '/auth/login', {
      body: { email: 'apuracao@aurora-demo.com.br', password: 'empresa123' }
    });
    const cookie = parseCookie(login.headers['set-cookie']);
    const res = await request('GET', '/reports/rpt_002', { cookie });
    assert.equal(res.status, 200);
    assert.equal(res.json.contactEmail, undefined);
    assert.equal(res.json.contactPhone, undefined);
  });
});
