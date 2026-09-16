'use strict';

const { describe, it, before, after } = require('node:test');
const assert = require('node:assert/strict');
const http = require('node:http');
const { parseCookie, mergeCookies, loginComplete } = require('./helpers/auth');
const { csrfHeaders } = require('./helpers/http');
const reportMessages = require('../src/services/report-messages.service');
const store = require('../src/store');

const BASE = `http://127.0.0.1:${process.env.CS_TEST_PORT || 3130}`;
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

async function reporterSession(protocol, trackingCode) {
  const res = await request('POST', '/public/consult', {
    body: { protocol, trackingCode }
  });
  assert.equal(res.status, 200);
  return parseCookie(res.headers['set-cookie']);
}

let server;
let auroraCookie;
let horizonCookie;

before(async () => {
  process.env.CS_JWT_SECRET = 'test-secret-messages';
  process.env.CS_DEV_MODE = '1';
  process.env.CS_TEST_PORT = process.env.CS_TEST_PORT || '3130';
  reportMessages.resetReporterRateForTests();
  const { createApp } = require('../src/app');
  server = createApp().listen(Number(process.env.CS_TEST_PORT || 3130));
  auroraCookie = await loginComplete(request, 'admin@aurora-demo.com.br', 'empresa123');
  horizonCookie = await loginComplete(request, 'admin@horizon-demo.com.br', 'empresa123');
});

after(() => {
  if (server) server.close();
});

describe('Tracking code hash', () => {
  it('store não persiste trackingCode em plaintext', () => {
    const data = store.load();
    const report = data.reports.find((r) => r.protocol === 'CS-2026-000101');
    assert.ok(report);
    assert.ok(report.trackingCodeHash);
    assert.equal(report.trackingCode, undefined);
  });
});

describe('Consulta pública e sessão reporter', () => {
  it('consulta válida emite cookie cs_reporter', async () => {
    const res = await request('POST', '/public/consult', {
      body: { protocol: 'CS-2026-000101', trackingCode: '7H9K-42MP-X8QZ' }
    });
    assert.equal(res.status, 200);
    assert.ok(res.json.hasNewMessages);
    const cookie = parseCookie(res.headers['set-cookie']);
    assert.match(cookie, /cs_reporter=/);
  });

  it('GET /public/messages sem cookie retorna 401', async () => {
    const res = await request('GET', '/public/messages');
    assert.equal(res.status, 401);
  });

  it('denunciante lê thread após consulta', async () => {
    const cookie = await reporterSession('CS-2026-000101', '7H9K-42MP-X8QZ');
    const res = await request('GET', '/public/messages', { cookie });
    assert.equal(res.status, 200);
    assert.ok(Array.isArray(res.json.messages));
    assert.ok(res.json.messages.length >= 1);
    assert.equal(res.json.messages[0].authorLabel, 'Equipe responsável');
  });
});

describe('Thread bidirecional', () => {
  it('apurador envia mensagem visível ao denunciante', async () => {
    const send = await request('POST', '/reports/rpt_001/messages', {
      cookie: auroraCookie,
      body: { text: 'Por favor confirme o setor onde ocorreu o fato.' }
    });
    assert.equal(send.status, 201);
    assert.equal(send.json.direction, 'company');
    assert.equal(send.json.authorLabel, 'Equipe responsável');
  });

  it('denunciante responde na thread', async () => {
    const cookie = await reporterSession('CS-2026-000101', '7H9K-42MP-X8QZ');
    const res = await request('POST', '/public/messages', {
      cookie,
      body: { text: 'Ocorreu no setor administrativo, por volta das 15h.' }
    });
    assert.equal(res.status, 201);
    assert.equal(res.json.direction, 'reporter');
    assert.equal(res.json.authorLabel, 'Você');
  });

  it('staff vê resposta do denunciante', async () => {
    const res = await request('GET', '/reports/rpt_001/messages', { cookie: auroraCookie });
    assert.equal(res.status, 200);
    assert.ok(res.json.messages.some((m) => m.direction === 'reporter'));
  });
});

describe('Isolamento', () => {
  it('Horizon não acessa mensagens de relato Aurora', async () => {
    const res = await request('GET', '/reports/rpt_001/messages', { cookie: horizonCookie });
    assert.equal(res.status, 404);
  });

  it('GET /reports não expõe trackingCodeHash', async () => {
    const res = await request('GET', '/reports/rpt_001', { cookie: auroraCookie });
    assert.equal(res.status, 200);
    assert.equal(res.json.trackingCode, undefined);
    assert.equal(res.json.trackingCodeHash, undefined);
  });
});

describe('Observação interna vs thread', () => {
  it('observação interna não aparece na thread pública', async () => {
    await request('POST', '/reports/rpt_001/observations', {
      cookie: auroraCookie,
      body: { text: 'Nota interna confidencial XYZ' }
    });
    const cookie = await reporterSession('CS-2026-000101', '7H9K-42MP-X8QZ');
    const thread = await request('GET', '/public/messages', { cookie });
    assert.ok(!thread.json.messages.some((m) => m.body.includes('Nota interna confidencial XYZ')));
  });
});
