'use strict';

/**
 * Need-to-know: Apurador só vê relatos encaminhados a ele.
 */
const { describe, it, before, after } = require('node:test');
const assert = require('node:assert/strict');
const http = require('node:http');
const store = require('../src/store');
const queue = require('../src/email/queue.service');
const dedupe = require('../src/email/dedupe.service');
const bounce = require('../src/email/bounce.service');
const notification = require('../src/services/notification.service');
const { loginComplete } = require('./helpers/auth');
const { csrfHeaders } = require('./helpers/http');

const BASE = `http://127.0.0.1:${process.env.CS_TEST_PORT || 3155}`;
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
let adminCookie;
let apuradorACookie;
let apuradorBCookie;

before(async () => {
  process.env.CS_JWT_SECRET = 'test-secret-apurador-vis';
  process.env.CS_DEV_MODE = '1';
  process.env.CS_EMAIL_SYNC = '1';
  process.env.CS_TEST_PORT = process.env.CS_TEST_PORT || '3155';
  queue.clearForTests();
  dedupe.clearForTests();
  bounce.clearForTests();
  const { createApp } = require('../src/app');
  server = createApp().listen(Number(process.env.CS_TEST_PORT || 3155));

  adminCookie = await loginComplete(request, 'admin@aurora-demo.com.br', 'empresa123');
  apuradorACookie = await loginComplete(request, 'apuracao@aurora-demo.com.br', 'empresa123');
  apuradorBCookie = await loginComplete(request, 'apuracao2@aurora-demo.com.br', 'empresa123');

  const data = store.load();
  const unassigned = data.reports.find((r) => r.id === 'rpt_aurora_unassigned') || {
    id: 'rpt_aurora_unassigned',
    protocol: 'CS-2026-009901',
    companyId: 'cmp_aurora',
    category: 'outro',
    status: 'recebido',
    isAnonymous: true,
    description: 'Relato sem encaminhamento para teste need-to-know.',
    sector: 'TI',
    assigneeId: null,
    teamIds: [],
    workflowStage: 'recebido',
    workflowStageAt: new Date().toISOString(),
    priority: 'normal',
    createdAt: new Date().toISOString(),
    updatedAt: new Date().toISOString(),
    attachments: []
  };
  unassigned.assigneeId = null;
  unassigned.teamIds = [];
  if (!data.reports.some((r) => r.id === unassigned.id)) {
    data.reports.push(unassigned);
  }
  store.save(data);
});

after(() => {
  if (server) server.close();
});

describe('Visibilidade need-to-know do Apurador', () => {
  it('Adm_Empresa lista relatos sem encaminhamento', async () => {
    const res = await request('GET', '/reports', { cookie: adminCookie });
    assert.equal(res.status, 200);
    assert.ok(res.json.some((r) => r.id === 'rpt_aurora_unassigned'));
  });

  it('Apurador A não lista relato sem encaminhamento', async () => {
    const res = await request('GET', '/reports', { cookie: apuradorACookie });
    assert.equal(res.status, 200);
    assert.ok(res.json.every((r) => r.assigneeId === 'usr_aurora_ap' || (r.teamIds || []).includes('usr_aurora_ap')));
    assert.ok(!res.json.some((r) => r.id === 'rpt_aurora_unassigned'));
  });

  it('Apurador A recebe 404 em relato não direcionado', async () => {
    const res = await request('GET', '/reports/rpt_aurora_unassigned', { cookie: apuradorACookie });
    assert.equal(res.status, 404);
  });

  it('Apurador B não vê relatos encaminhados a A', async () => {
    const list = await request('GET', '/reports', { cookie: apuradorBCookie });
    assert.equal(list.status, 200);
    assert.ok(!list.json.some((r) => r.id === 'rpt_001'));
    const detail = await request('GET', '/reports/rpt_001', { cookie: apuradorBCookie });
    assert.equal(detail.status, 404);
  });

  it('após Encaminhar, só o Apurador B passa a ver o relato', async () => {
    const assign = await request('POST', '/reports/rpt_aurora_unassigned/assign', {
      cookie: adminCookie,
      body: { assigneeId: 'usr_aurora_ap2' }
    });
    assert.equal(assign.status, 200);
    assert.equal(assign.json.assigneeId, 'usr_aurora_ap2');

    const forA = await request('GET', '/reports/rpt_aurora_unassigned', { cookie: apuradorACookie });
    assert.equal(forA.status, 404);

    const forB = await request('GET', '/reports/rpt_aurora_unassigned', { cookie: apuradorBCookie });
    assert.equal(forB.status, 200);
    assert.equal(forB.json.id, 'rpt_aurora_unassigned');

    const listB = await request('GET', '/reports', { cookie: apuradorBCookie });
    assert.ok(listB.json.some((r) => r.id === 'rpt_aurora_unassigned'));
  });

  it('novo relato não notifica Apuradores (só Adm_Empresa)', async () => {
    queue.clearForTests();
    const data = store.load();
    const report = {
      id: 'rpt_email_need_to_know',
      companyId: 'cmp_aurora',
      assigneeId: null,
      teamIds: []
    };
    data.companySettings = data.companySettings || {};
    data.companySettings.cmp_aurora = data.companySettings.cmp_aurora || {};
    data.companySettings.cmp_aurora.emailNotifications = {
      enabled: true,
      events: {
        report_new: {
          enabled: true,
          roles: ['admin_empresa', 'apurador'],
          notifyCompanyEmail: false
        }
      }
    };
    store.save(data);

    notification.emitReportNew(report);
    await queue.processBatch(40);
    const logs = queue.getDeliveryLogs({ limit: 40, companyId: 'cmp_aurora' });
    const sent = logs.filter((l) => l.eventType === 'report_new' && l.status === 'sent');
    assert.ok(sent.length >= 1);
    const toHashes = sent.map((l) => l.toHash);
    const policy = require('../src/email/policy.service');
    const apHash = policy.emailHash('apuracao@aurora-demo.com.br');
    const ap2Hash = policy.emailHash('apuracao2@aurora-demo.com.br');
    assert.ok(!toHashes.includes(apHash));
    assert.ok(!toHashes.includes(ap2Hash));
  });
});
