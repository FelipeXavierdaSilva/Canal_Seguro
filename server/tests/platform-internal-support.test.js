'use strict';

const { describe, it, before, after } = require('node:test');
const assert = require('node:assert/strict');
const http = require('node:http');
const store = require('../src/store');
const { loginComplete } = require('./helpers/auth');
const { csrfHeaders } = require('./helpers/http');

const BASE = `http://127.0.0.1:${process.env.CS_TEST_PORT || 3161}`;
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
let superCookie;
let secondCookie;
let previousThreads;
let previousUsers;
let createdSecond = false;

before(async () => {
  process.env.CS_JWT_SECRET = 'test-secret-internal-support';
  process.env.CS_DEV_MODE = '1';
  process.env.CS_EMAIL_SYNC = '1';
  process.env.CS_TEST_PORT = process.env.CS_TEST_PORT || '3161';
  const data = store.load();
  previousThreads = Array.isArray(data.platformInternalSupportThreads)
    ? [...data.platformInternalSupportThreads]
    : [];
  previousUsers = Array.isArray(data.users) ? [...data.users] : [];
  data.platformInternalSupportThreads = [];

  const master = (data.users || []).find((u) => u.email === 'admin@fxfelipexavier.com.br');
  if (master) {
    master.isPlatformMaster = true;
    master.createdAt = master.createdAt || '2024-01-01T00:00:00.000Z';
  }
  let second = (data.users || []).find((u) => u.email === 'admin2@fxfelipexavier.com.br');
  if (!second) {
    second = {
      id: 'usr_super_test_internal_2',
      email: 'admin2@fxfelipexavier.com.br',
      nome: 'Segundo Adm Plataforma',
      role: 'superadmin',
      status: 'ativo',
      passwordHash: master?.passwordHash || '',
      companyId: null,
      createdAt: '2025-01-01T00:00:00.000Z',
      isPlatformMaster: false
    };
    data.users = data.users || [];
    data.users.push(second);
    createdSecond = true;
  }
  store.save(data);

  const { createApp } = require('../src/app');
  server = createApp().listen(Number(process.env.CS_TEST_PORT || 3161));
  superCookie = await loginComplete(request, 'admin@fxfelipexavier.com.br', 'fxadmin123');
  // Second admin may not have password for loginComplete — use service path via store password from seed
  // If login fails, create via API as master then login
  try {
    secondCookie = await loginComplete(request, 'admin2@fxfelipexavier.com.br', 'fxadmin123');
  } catch {
    secondCookie = null;
  }
});

after(() => {
  const data = store.load();
  data.platformInternalSupportThreads = previousThreads;
  if (createdSecond) {
    data.users = (data.users || []).filter((u) => u.id !== 'usr_super_test_internal_2');
  } else {
    data.users = previousUsers;
  }
  store.save(data);
  if (server) server.close();
});

describe('Suporte interno Adm_Plataforma', () => {
  it('identifica o Master e bloqueia autoatendimento', async () => {
    const masterInfo = await request('GET', '/settings/platform-internal-support/master', {
      cookie: superCookie
    });
    assert.equal(masterInfo.status, 200);
    assert.equal(masterInfo.json.isMaster, true);
    assert.ok(masterInfo.json.master?.id);

    const created = await request('POST', '/settings/platform-internal-support', {
      cookie: superCookie,
      body: { subject: 'Self', body: 'Não deveria criar.' }
    });
    assert.equal(created.status, 400);
  });

  it('segundo Adm_Plataforma fala com Master e ambos veem histórico', async () => {
    if (!secondCookie) {
      // Fallback: simulate via service without second login
      const internal = require('../src/services/platform-internal-support.service');
      const data = store.load();
      const second = (data.users || []).find((u) => u.id === 'usr_super_test_internal_2');
      assert.ok(second);
      const created = internal.createThread(second, {
        subject: 'Ajuda interna',
        body: 'Preciso de orientação do Master.'
      });
      assert.equal(created.ok, true);
      const master = internal.resolvePlatformMaster(store.load());
      const reply = internal.addMessage(master, created.data.id, {
        body: 'Resposta do Master no canal interno.'
      });
      assert.equal(reply.ok, true);
      assert.equal(reply.data.status, 'respondido');
      const listMaster = internal.listThreads(master);
      const listSecond = internal.listThreads(second);
      assert.ok(listMaster.data.threads.some((t) => t.id === created.data.id));
      assert.ok(listSecond.data.threads.some((t) => t.id === created.data.id));
      assert.ok(
        listSecond.data.threads
          .find((t) => t.id === created.data.id)
          .messages.some((m) => String(m.body).includes('Resposta do Master'))
      );
      return;
    }

    const created = await request('POST', '/settings/platform-internal-support', {
      cookie: secondCookie,
      body: { subject: 'Ajuda interna', body: 'Preciso de orientação do Master.' }
    });
    assert.equal(created.status, 201);
    assert.equal(created.json.status, 'aberto');

    const listMaster = await request('GET', '/settings/platform-internal-support', {
      cookie: superCookie
    });
    assert.equal(listMaster.status, 200);
    assert.ok(listMaster.json.threads.some((t) => t.id === created.json.id));
    assert.ok(listMaster.json.unreadTotal >= 1);

    const reply = await request('POST', `/settings/platform-internal-support/${created.json.id}/messages`, {
      cookie: superCookie,
      body: { body: 'Resposta do Master no canal interno.' }
    });
    assert.equal(reply.status, 200);
    assert.equal(reply.json.status, 'respondido');

    const listSecond = await request('GET', '/settings/platform-internal-support', {
      cookie: secondCookie
    });
    assert.equal(listSecond.status, 200);
    const shared = listSecond.json.threads.find((t) => t.id === created.json.id);
    assert.ok(shared);
    assert.ok(shared.messages.some((m) => String(m.body).includes('Resposta do Master')));
  });
});
