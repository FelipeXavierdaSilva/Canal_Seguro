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
