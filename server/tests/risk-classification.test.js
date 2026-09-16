'use strict';

const { describe, it, before, after } = require('node:test');
const assert = require('node:assert/strict');
const http = require('node:http');
const store = require('../src/store');
const { loginComplete } = require('./helpers/auth');
const { csrfHeaders } = require('./helpers/http');

const BASE = `http://127.0.0.1:${process.env.CS_TEST_PORT || 3140}`;
const API = `${BASE}/api/v1`;

function request(method, path, { body, cookie } = {}) {
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

let server;
let auroraAdminCookie;
let auroraApuradorCookie;
let horizonCookie;

before(async () => {
  process.env.CS_JWT_SECRET = 'test-secret-risk';
  process.env.CS_DEV_MODE = '1';
  process.env.CS_EMAIL_SYNC = '1';
  process.env.CS_TEST_PORT = process.env.CS_TEST_PORT || '3140';
  const { createApp } = require('../src/app');
  server = createApp().listen(Number(process.env.CS_TEST_PORT || 3140));
  auroraAdminCookie = await loginComplete(request, 'admin@aurora-demo.com.br', 'empresa123');
  auroraApuradorCookie = await loginComplete(request, 'apuracao@aurora-demo.com.br', 'empresa123');
  horizonCookie = await loginComplete(request, 'admin@horizon-demo.com.br', 'empresa123');
});

after(() => {
  if (server) server.close();
});

describe('Seed e política', () => {
  it('relato demo rpt_001 está classificado como critical', () => {
    const data = store.load();
    const r = data.reports.find((x) => x.id === 'rpt_001');
    assert.equal(r.riskLevel, 'critical');
    assert.ok((data.reportRiskHistory || []).length >= 1);
  });

  it('admin consulta política de risco', async () => {
    const res = await request('GET', '/settings/risk-policy/cmp_aurora', { cookie: auroraAdminCookie });
    assert.equal(res.status, 200);
    assert.ok(res.json.policy.factors.length >= 10);
  });
});

describe('Sugestão auxiliar', () => {
  it('sugestão não altera o store', async () => {
    const dataBefore = store.load();
    const before = dataBefore.reports.find((r) => r.id === 'rpt_002').riskLevel;
    const res = await request('GET', '/reports/rpt_002/risk/suggestion', { cookie: auroraAdminCookie });
    assert.equal(res.status, 200);
    assert.ok(res.json.suggestion.disclaimer.includes('auxiliar'));
    const dataAfter = store.load();
    const after = dataAfter.reports.find((r) => r.id === 'rpt_002').riskLevel;
    assert.equal(before, after);
  });
});

describe('Classificação manual', () => {
  it('apurador classifica como high', async () => {
    const res = await request('POST', '/reports/rpt_002/risk', {
      cookie: auroraApuradorCookie,
      body: {
        level: 'high',
        factors: ['violence'],
        justification: 'Indícios de agressão verbal reiterada com testemunhas.'
      }
    });
    assert.equal(res.status, 200);
    assert.equal(res.json.riskLevel, 'high');
  });

  it('apurador não classifica como critical', async () => {
    const res = await request('POST', '/reports/rpt_002/risk', {
      cookie: auroraApuradorCookie,
      body: {
        level: 'critical',
        factors: ['immediate_risk'],
        justification: 'Tentativa de elevar para crítico.'
      }
    });
    assert.equal(res.status, 403);
  });

  it('admin reclassifica para moderate com histórico', async () => {
    const res = await request('POST', '/reports/rpt_002/risk', {
      cookie: auroraAdminCookie,
      body: {
        level: 'moderate',
        factors: ['discrimination'],
        justification: 'Após triagem inicial, reduzir prioridade operacional.'
      }
    });
    assert.equal(res.status, 200);
    const hist = await request('GET', '/reports/rpt_002/risk/history', { cookie: auroraAdminCookie });
    assert.ok(hist.json.length >= 2);
    assert.ok(hist.json[0].previousLevel);
  });

  it('justificativa vazia é rejeitada', async () => {
    const res = await request('POST', '/reports/rpt_004/risk', {
      cookie: auroraAdminCookie,
      body: { level: 'low', factors: [], justification: '  ' }
    });
    assert.equal(res.status, 400);
  });
});

describe('Filtros e ordenação', () => {
  it('filtro riskLevel=critical retorna apenas críticos Aurora', async () => {
    const res = await request('GET', '/reports?riskLevel=critical', { cookie: auroraAdminCookie });
    assert.equal(res.status, 200);
    assert.ok(res.json.length >= 1);
    assert.ok(res.json.every((r) => r.riskLevel === 'critical'));
  });

  it('críticos aparecem antes na listagem', async () => {
    const res = await request('GET', '/reports', { cookie: auroraAdminCookie });
    assert.equal(res.status, 200);
    const firstCriticalIdx = res.json.findIndex((r) => r.riskLevel === 'critical');
    const firstHighIdx = res.json.findIndex((r) => r.riskLevel === 'high');
    if (firstCriticalIdx >= 0 && firstHighIdx >= 0) {
      assert.ok(firstCriticalIdx < firstHighIdx);
    }
  });
});

describe('Regra crítico sem responsável', () => {
  it('bloqueia conclusão de crítico sem assignee', async () => {
    const data = store.load();
    const report = data.reports.find((r) => r.id === 'rpt_001');
    report.assigneeId = null;
    report.status = 'apuracao';
    store.save(data);

    const res = await request('PATCH', '/reports/rpt_001/status', {
      cookie: auroraAdminCookie,
      body: { status: 'concluido' }
    });
    assert.equal(res.status, 400);
  });
});

describe('Isolamento tenant', () => {
  it('Horizon não classifica relato Aurora', async () => {
    const res = await request('POST', '/reports/rpt_001/risk', {
      cookie: horizonCookie,
      body: { level: 'low', factors: [], justification: 'Tentativa cross-tenant.' }
    });
    assert.equal(res.status, 404);
  });
});

describe('Métricas dashboard', () => {
  it('retorna contagem por risco', async () => {
    const res = await request('GET', '/reports/metrics/dashboard', { cookie: auroraAdminCookie });
    assert.equal(res.status, 200);
    assert.ok(res.json.byRisk);
    assert.ok(res.json.criticalCount >= 1);
  });
});

describe('Consulta pública', () => {
  it('consulta pública não expõe riskLevel', async () => {
    const res = await request('POST', '/public/consult', {
      body: { protocol: 'CS-2026-000101', trackingCode: '7H9K-42MP-X8QZ' }
    });
    assert.equal(res.status, 200);
    assert.equal(res.json.riskLevel, undefined);
  });
});
