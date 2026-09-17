'use strict';

const { describe, it, before, after } = require('node:test');
const assert = require('node:assert/strict');
const http = require('node:http');
const { validatePayload } = require('../src/email/privacy');
const queue = require('../src/email/queue.service');
const dedupe = require('../src/email/dedupe.service');
const bounce = require('../src/email/bounce.service');
const notification = require('../src/services/notification.service');
const { loginComplete } = require('./helpers/auth');
const { csrfHeaders } = require('./helpers/http');

const BASE = `http://127.0.0.1:${process.env.CS_TEST_PORT || 3120}`;
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

before(async () => {
  process.env.CS_JWT_SECRET = 'test-secret-email';
  process.env.CS_DEV_MODE = '1';
  process.env.CS_EMAIL_SYNC = '1';
  process.env.CS_TEST_PORT = process.env.CS_TEST_PORT || '3120';
  queue.clearForTests();
  dedupe.clearForTests();
  bounce.clearForTests();
  const { createApp } = require('../src/app');
  server = createApp().listen(Number(process.env.CS_TEST_PORT || 3120));
});

after(() => {
  if (server) server.close();
});

describe('Privacidade de payload', () => {
  it('bloqueia descrição de relato no payload', () => {
    const result = validatePayload('report_new', {
      firstName: 'Carla',
      actionUrl: 'http://localhost/empresa/relatos.html',
      channelName: 'Canal Aurora',
      description: 'texto sensível'
    });
    assert.equal(result.ok, false);
  });

  it('aceita payload genérico seguro', () => {
    const result = validatePayload('report_status', {
      firstName: 'Carla',
      actionUrl: 'http://localhost/empresa/relatos.html',
      channelName: 'Canal Aurora',
      ctaLabel: 'Ver painel'
    });
    assert.equal(result.ok, true);
  });
});

describe('Fila e dedupe', () => {
  it('não duplica envio com mesma dedupeKey', async () => {
    const first = await queue.enqueue({
      eventType: 'report_new',
      to: 'admin@aurora-demo.com.br',
      companyId: 'cmp_aurora',
      payload: {
        firstName: 'Carla',
        actionUrl: 'http://localhost/empresa/relatos.html',
        channelName: 'Canal Aurora',
        ctaLabel: 'Ver painel'
      },
      dedupeKey: 'test:dedupe:1'
    });
    const second = await queue.enqueue({
      eventType: 'report_new',
      to: 'admin@aurora-demo.com.br',
      companyId: 'cmp_aurora',
      payload: {
        firstName: 'Carla',
        actionUrl: 'http://localhost/empresa/relatos.html',
        channelName: 'Canal Aurora',
        ctaLabel: 'Ver painel'
      },
      dedupeKey: 'test:dedupe:1'
    });
    assert.equal(first.ok, true);
    assert.equal(second.duplicate, true);
  });
});

describe('Eventos de relato', () => {
  it('novo relato enfileira e-mail genérico', async () => {
    queue.clearForTests();
    const store = require('../src/store');
    const data = store.load();
    const report = data.reports.find((r) => r.companyId === 'cmp_aurora');
    notification.emitReportNew(report);
    await queue.processBatch(20);
    const stats = queue.getQueueStats();
    assert.ok(stats.sent >= 1 || stats.pending >= 0);
    const logs = queue.getDeliveryLogs({ limit: 10, companyId: 'cmp_aurora' });
    assert.ok(logs.some((l) => l.eventType === 'report_new' && l.status === 'sent'));
  });

  it('novo relato também notifica e-mail cadastral da empresa', async () => {
    queue.clearForTests();
    const store = require('../src/store');
    const data = store.load();
    const company = data.companies.find((c) => c.id === 'cmp_aurora');
    assert.ok(company?.email);
    data.companySettings = data.companySettings || {};
    data.companySettings.cmp_aurora = data.companySettings.cmp_aurora || {};
    data.companySettings.cmp_aurora.emailNotifications = {
      ...(data.companySettings.cmp_aurora.emailNotifications || {}),
      enabled: true,
      events: {
        ...((data.companySettings.cmp_aurora.emailNotifications || {}).events || {}),
        report_new: {
          enabled: true,
          roles: ['admin_empresa', 'apurador'],
          notifyCompanyEmail: true
        }
      }
    };
    store.save(data);
    const report = data.reports.find((r) => r.companyId === 'cmp_aurora');
    notification.emitReportNew(report);
    await queue.processBatch(30);
    const logs = queue.getDeliveryLogs({ limit: 30, companyId: 'cmp_aurora' });
    const companyMails = logs.filter(
      (l) => l.eventType === 'report_new' && l.status === 'sent'
    );
    assert.ok(companyMails.length >= 1);
  });

  it('admin_empresa pode alterar notifyCompanyEmail', async () => {
    const cookie = await loginComplete(request, 'admin@aurora-demo.com.br', 'empresa123');
    const res = await request('PUT', '/email/notifications/cmp_aurora', {
      cookie,
      body: { events: { report_new: { notifyCompanyEmail: false } } }
    });
    assert.equal(res.status, 200);
    assert.equal(res.json.policy.events.report_new.notifyCompanyEmail, false);
    assert.ok(res.json.policy.events.report_new.roles.includes('admin_empresa'));

    const restore = await request('PUT', '/email/notifications/cmp_aurora', {
      cookie,
      body: { events: { report_new: { notifyCompanyEmail: true } } }
    });
    assert.equal(restore.status, 200);
  });

  it('PUT company atualiza e-mail cadastral para admin_empresa', async () => {
    const cookie = await loginComplete(request, 'admin@aurora-demo.com.br', 'empresa123');
    const store = require('../src/store');
    const before = store.load().companies.find((c) => c.id === 'cmp_aurora');
    const nextEmail = 'compliance-notify@aurora-demo.com.br';
    const res = await request('PUT', '/companies/cmp_aurora', {
      cookie,
      body: { email: nextEmail }
    });
    assert.equal(res.status, 200);
    assert.equal(res.json.email, nextEmail);
    // restore
    await request('PUT', '/companies/cmp_aurora', {
      cookie,
      body: { email: before.email }
    });
  });
});

describe('Bounce e suppress', () => {
  it('suprime endereço após bounce', () => {
    bounce.suppress('bounce@test.invalid', 'hard_bounce');
    assert.equal(bounce.isSuppressed('bounce@test.invalid'), true);
  });
});

describe('API admin e-mail', () => {
  it('superadmin consulta stats', async () => {
    const cookie = await loginComplete(request, 'admin@fxfelipexavier.com.br', 'fxadmin123');
    const res = await request('GET', '/email/stats', { cookie });
    assert.equal(res.status, 200);
    assert.ok(res.json.queue);
  });
});

describe('Criação de usuários por Adm_Empresa', () => {
  it('pode criar outro Adm_Empresa da própria empresa', async () => {
    const cookie = await loginComplete(request, 'admin@aurora-demo.com.br', 'empresa123');
    const username = `adm_extra_${Date.now()}`;
    const res = await request('POST', '/users', {
      cookie,
      body: {
        nome: 'Adm Extra Aurora',
        username,
        email: `${username}@aurora-demo.com.br`,
        role: 'admin_empresa',
        companyId: 'cmp_horizon',
        senha: 'AdmExtra9xYz',
        status: 'ativo'
      }
    });
    assert.equal(res.status, 201, res.json?.error || JSON.stringify(res.json));
    assert.equal(res.json.user.role, 'admin_empresa');
    assert.equal(res.json.user.companyId, 'cmp_aurora');
    const store = require('../src/store');
    const saved = store.load().users.find((u) => u.username === username);
    assert.ok(saved);
    assert.equal(saved.companyId, 'cmp_aurora');
  });

  it('não pode criar superadmin', async () => {
    const cookie = await loginComplete(request, 'admin@aurora-demo.com.br', 'empresa123');
    const res = await request('POST', '/users', {
      cookie,
      body: {
        nome: 'Hack',
        username: `hack_${Date.now()}`,
        role: 'superadmin',
        senha: 'AdmExtra9xYz',
        status: 'ativo'
      }
    });
    assert.equal(res.status, 403);
  });
});
