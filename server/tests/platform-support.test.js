'use strict';

const { describe, it, before, after } = require('node:test');
const assert = require('node:assert/strict');
const http = require('node:http');
const store = require('../src/store');
const { loginComplete } = require('./helpers/auth');
const { csrfHeaders } = require('./helpers/http');

const BASE = `http://127.0.0.1:${process.env.CS_TEST_PORT || 3160}`;
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
let apuradorCookie;
let superCookie;
let previousThreads;

before(async () => {
  process.env.CS_JWT_SECRET = 'test-secret-platform-support';
  process.env.CS_DEV_MODE = '1';
  process.env.CS_EMAIL_SYNC = '1';
  process.env.CS_TEST_PORT = process.env.CS_TEST_PORT || '3160';
  const data = store.load();
  previousThreads = Array.isArray(data.platformSupportThreads) ? [...data.platformSupportThreads] : [];
  data.platformSupportThreads = [];
  store.save(data);

  const { createApp } = require('../src/app');
  server = createApp().listen(Number(process.env.CS_TEST_PORT || 3160));
  adminCookie = await loginComplete(request, 'admin@aurora-demo.com.br', 'empresa123');
  apuradorCookie = await loginComplete(request, 'apuracao@aurora-demo.com.br', 'empresa123');
  superCookie = await loginComplete(request, 'admin@fxfelipexavier.com.br', 'fxadmin123');
});

after(() => {
  const data = store.load();
  data.platformSupportThreads = previousThreads;
  store.save(data);
  if (server) server.close();
});

describe('Suporte plataforma', () => {
  it('empresa abre conversa e Adm_Plataforma vê na inbox', async () => {
    const created = await request('POST', '/settings/platform-support', {
      cookie: adminCookie,
      body: { subject: 'Dúvida de acesso', body: 'Preciso de ajuda com encaminhamento.' }
    });
    assert.equal(created.status, 201);
    assert.equal(created.json.status, 'aberto');
    assert.ok(created.json.respondBy);
    assert.equal(created.json.messages.length, 1);

    const list = await request('GET', '/settings/platform-support', { cookie: superCookie });
    assert.equal(list.status, 200);
    assert.ok(list.json.threads.some((t) => t.id === created.json.id));
  });

  it('Apurador também pode abrir suporte da própria empresa', async () => {
    const created = await request('POST', '/settings/platform-support', {
      cookie: apuradorCookie,
      body: { subject: 'Ajuda Apurador', body: 'Como registro medidas?' }
    });
    assert.equal(created.status, 201);
    assert.equal(created.json.createdByRole, 'apurador');
  });

  it('Adm_Plataforma responde e empresa vê a mensagem', async () => {
    const created = await request('POST', '/settings/platform-support', {
      cookie: adminCookie,
      body: { subject: 'SLA', body: 'Mensagem para resposta.' }
    });
    assert.equal(created.status, 201);

    const reply = await request('POST', `/settings/platform-support/${created.json.id}/messages`, {
      cookie: superCookie,
      body: { body: 'Recebemos sua solicitação. Orientação enviada.' }
    });
    assert.equal(reply.status, 200);
    assert.equal(reply.json.status, 'respondido');
    assert.ok(reply.json.firstResponseAt);
    assert.ok(reply.json.messages.some((m) => m.direction === 'platform'));

    const mine = await request('GET', `/settings/platform-support/${created.json.id}`, {
      cookie: adminCookie
    });
    assert.equal(mine.status, 200);
    assert.ok(mine.json.messages.some((m) => m.body.includes('Recebemos')));
  });

  it('badge de não lidas incrementa com resposta e zera ao marcar como lida', async () => {
    const created = await request('POST', '/settings/platform-support', {
      cookie: adminCookie,
      body: { subject: 'Não lidas', body: 'Aguardando retorno.' }
    });
    assert.equal(created.status, 201);

    await request('POST', `/settings/platform-support/${created.json.id}/messages`, {
      cookie: superCookie,
      body: { body: 'Primeira resposta do suporte.' }
    });
    await request('POST', `/settings/platform-support/${created.json.id}/messages`, {
      cookie: superCookie,
      body: { body: 'Segunda resposta do suporte.' }
    });

    const listBefore = await request('GET', '/settings/platform-support', { cookie: adminCookie });
    assert.equal(listBefore.status, 200);
    assert.ok(listBefore.json.unreadTotal >= 2);
    const thread = listBefore.json.threads.find((t) => t.id === created.json.id);
    assert.ok(thread);
    assert.ok(thread.unreadCount >= 2);

    const marked = await request('POST', '/settings/platform-support/mark-read', {
      cookie: adminCookie,
      body: {}
    });
    assert.equal(marked.status, 200);
    assert.equal(marked.json.unreadTotal, 0);
    assert.ok(marked.json.marked >= 2);

    const listAfter = await request('GET', '/settings/platform-support', { cookie: adminCookie });
    assert.equal(listAfter.status, 200);
    assert.equal(listAfter.json.unreadTotal, 0);
  });

  it('empresa de outro tenant não lê conversa alheia', async () => {
    const created = await request('POST', '/settings/platform-support', {
      cookie: adminCookie,
      body: { subject: 'Privado', body: 'Só Aurora.' }
    });
    const horizon = await loginComplete(request, 'admin@horizon-demo.com.br', 'empresa123');
    const res = await request('GET', `/settings/platform-support/${created.json.id}`, {
      cookie: horizon
    });
    assert.equal(res.status, 404);
  });

  it('notifica todos os Adm_Plataforma e limpa pendências ao responder', async () => {
    const data = store.load();
    const existingSupers = (data.users || []).filter((u) => u.role === 'superadmin' && u.status === 'ativo');
    let secondSuper = existingSupers.find((u) => u.email !== 'admin@fxfelipexavier.com.br');
    let createdSecond = false;
    if (!secondSuper) {
      secondSuper = {
        id: 'usr_super_test_2',
        email: 'admin2@fxfelipexavier.com.br',
        nome: 'Segundo Adm Plataforma',
        role: 'superadmin',
        status: 'ativo',
        passwordHash: existingSupers[0]?.passwordHash || '',
        companyId: null
      };
      data.users = data.users || [];
      data.users.push(secondSuper);
      store.save(data);
      createdSecond = true;
    }

    const beforeNotifs = (store.load().notifications || []).length;
    const created = await request('POST', '/settings/platform-support', {
      cookie: adminCookie,
      body: { subject: 'Multi admin', body: 'Notificar todos os atendentes.' }
    });
    assert.equal(created.status, 201);

    const after = store.load();
    const threadNotifs = (after.notifications || []).filter(
      (n) =>
        n.type === 'platform_support_message' &&
        n.threadId === created.json.id &&
        !n.read
    );
    const superIds = (after.users || [])
      .filter((u) => u.role === 'superadmin' && u.status === 'ativo')
      .map((u) => u.id);
    assert.ok(threadNotifs.length >= superIds.length);
    for (const id of superIds) {
      assert.ok(threadNotifs.some((n) => n.userId === id), `faltou notificação para ${id}`);
    }
    assert.ok((after.notifications || []).length > beforeNotifs);

    const reply = await request('POST', `/settings/platform-support/${created.json.id}/messages`, {
      cookie: superCookie,
      body: { body: 'Atendente 1 respondeu na conversa compartilhada.' }
    });
    assert.equal(reply.status, 200);
    assert.equal(reply.json.status, 'respondido');
    assert.ok(reply.json.lastResponderName);

    const cleared = (store.load().notifications || []).filter(
      (n) => n.type === 'platform_support_message' && n.threadId === created.json.id
    );
    assert.ok(cleared.every((n) => n.read === true));

    const listA = await request('GET', '/settings/platform-support', { cookie: superCookie });
    assert.equal(listA.status, 200);
    const shared = listA.json.threads.find((t) => t.id === created.json.id);
    assert.ok(shared);
    assert.ok(shared.messages.some((m) => String(m.body).includes('Atendente 1 respondeu')));

    if (createdSecond) {
      const cleanup = store.load();
      cleanup.users = (cleanup.users || []).filter((u) => u.id !== 'usr_super_test_2');
      store.save(cleanup);
    }
  });
});
