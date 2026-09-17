'use strict';

const { describe, it, before, after } = require('node:test');
const assert = require('node:assert/strict');
const http = require('node:http');
const store = require('../src/store');
const { loginComplete } = require('./helpers/auth');
const { csrfHeaders } = require('./helpers/http');

const BASE = `http://127.0.0.1:${process.env.CS_TEST_PORT || 3141}`;
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

before(async () => {
  process.env.CS_JWT_SECRET = 'test-secret-workflow';
  process.env.CS_DEV_MODE = '1';
  process.env.CS_EMAIL_SYNC = '1';
  process.env.CS_TEST_PORT = process.env.CS_TEST_PORT || '3141';
  const { createApp } = require('../src/app');
  server = createApp().listen(Number(process.env.CS_TEST_PORT || 3141));
  auroraAdminCookie = await loginComplete(request, 'admin@aurora-demo.com.br', 'empresa123');
  auroraApuradorCookie = await loginComplete(request, 'apuracao@aurora-demo.com.br', 'empresa123');

  const data = store.load();
  const r1 = data.reports.find((r) => r.id === 'rpt_001');
  if (r1) {
    r1.workflowStage = 'em_apuracao';
    r1.priority = 'urgente';
    r1.workflowStageAt = '2026-08-10T16:00:00.000Z';
    r1.status = 'apuracao';
    r1.assigneeId = 'usr_aurora_ap';
    r1.teamIds = ['usr_aurora_ap'];
  }
  const r2 = data.reports.find((r) => r.id === 'rpt_002');
  if (r2) {
    r2.workflowStage = 'classificacao_risco';
    r2.priority = 'alta';
    r2.status = 'analise';
    r2.assigneeId = 'usr_aurora_ap';
    r2.teamIds = ['usr_aurora_ap'];
  }
  store.save(data);
});

after(() => {
  if (server) server.close();
});

describe('Seed e estado inicial', () => {
  it('relato demo rpt_001 está em apuração com prioridade urgente', () => {
    const data = store.load();
    const r = data.reports.find((x) => x.id === 'rpt_001');
    assert.equal(r.workflowStage, 'em_apuracao');
    assert.equal(r.priority, 'urgente');
    assert.ok((data.reportWorkflowHistory || []).length >= 1);
  });

  it('consulta estado do workflow', async () => {
    const res = await request('GET', '/reports/rpt_001/workflow', { cookie: auroraAdminCookie });
    assert.equal(res.status, 200);
    assert.equal(res.json.current.stage, 'em_apuracao');
    assert.ok(Array.isArray(res.json.allowedTransitions));
    assert.ok(res.json.milestones.length === 5);
  });

  it('timeline visual com 5 marcos', async () => {
    const res = await request('GET', '/reports/rpt_001/workflow/timeline', { cookie: auroraAdminCookie });
    assert.equal(res.status, 200);
    assert.equal(res.json.timeline.length, 5);
    assert.ok(res.json.timeline.some((m) => m.state === 'active'));
  });
});

describe('Transições governadas', () => {
  it('apurador avança rpt_002 para responsável definido', async () => {
    const data = store.load();
    const report = data.reports.find((r) => r.id === 'rpt_002');
    report.workflowStage = 'classificacao_risco';
    report.status = 'analise';
    report.riskLevel = report.riskLevel || 'high';
    report.workflowStageAt = new Date().toISOString();
    store.save(data);

    const res = await request('POST', '/reports/rpt_002/workflow/transition', {
      cookie: auroraApuradorCookie,
      body: { stage: 'responsavel_definido', justification: 'Risco alto classificado; definir responsável.' }
    });
    assert.equal(res.status, 200);
    assert.equal(res.json.workflowStage, 'responsavel_definido');
  });

  it('apurador não retrocede etapa', async () => {
    const data = store.load();
    const report = data.reports.find((r) => r.id === 'rpt_002');
    report.workflowStage = 'classificacao_risco';
    report.status = 'analise';
    store.save(data);

    const res = await request('POST', '/reports/rpt_002/workflow/transition', {
      cookie: auroraApuradorCookie,
      body: { stage: 'triagem', justification: 'Tentativa de retrocesso.' }
    });
    assert.equal(res.status, 403);
  });

  it('admin pode retroceder com justificativa', async () => {
    const data = store.load();
    const report = data.reports.find((r) => r.id === 'rpt_002');
    report.workflowStage = 'responsavel_definido';
    report.status = 'analise';
    store.save(data);

    const res = await request('POST', '/reports/rpt_002/workflow/transition', {
      cookie: auroraAdminCookie,
      body: { stage: 'classificacao_risco', justification: 'Revisão administrativa da etapa.' }
    });
    assert.equal(res.status, 200);
    assert.equal(res.json.workflowStage, 'classificacao_risco');
  });

  it('justificativa obrigatória na conclusão', async () => {
    const data = store.load();
    const report = data.reports.find((r) => r.id === 'rpt_001');
    report.workflowStage = 'medidas_adotadas';
    report.workflowStageAt = new Date().toISOString();
    report.status = 'acompanhamento';
    report.assigneeId = 'usr_aurora_ap';
    report.teamIds = ['usr_aurora_ap'];
    report.riskLevel = 'critical';
    store.save(data);

    const res = await request('POST', '/reports/rpt_001/workflow/transition', {
      cookie: auroraAdminCookie,
      body: { stage: 'concluido', justification: '' }
    });
    assert.equal(res.status, 400);
  });
});

describe('Meta operacional', () => {
  it('apurador altera prioridade', async () => {
    const res = await request('PATCH', '/reports/rpt_002/workflow/meta', {
      cookie: auroraApuradorCookie,
      body: { priority: 'alta' }
    });
    assert.equal(res.status, 200);
    assert.equal(res.json.priority, 'alta');
  });
});

describe('Dashboard e consulta pública', () => {
  it('métricas incluem workflowAlerts', async () => {
    const res = await request('GET', '/reports/metrics/dashboard', { cookie: auroraAdminCookie });
    assert.equal(res.status, 200);
    assert.ok(res.json.workflowAlerts);
    assert.ok(typeof res.json.workflowAlerts.noAssignee === 'number');
  });

  it('consulta pública não expõe workflow interno', async () => {
    const res = await request('POST', '/public/consult', {
      body: { protocol: 'CS-2026-000101', trackingCode: '7H9K-42MP-X8QZ' }
    });
    assert.equal(res.status, 200);
    assert.equal(res.json.workflowStage, undefined);
  });
});

describe('Filtros', () => {
  it('filtro workflowStage=em_apuracao', async () => {
    const res = await request('GET', '/reports?workflowStage=em_apuracao', { cookie: auroraAdminCookie });
    assert.equal(res.status, 200);
    assert.ok(res.json.every((r) => r.workflowStage === 'em_apuracao'));
  });
});
