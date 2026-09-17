'use strict';

const { describe, it, before, after } = require('node:test');
const assert = require('node:assert/strict');
const http = require('node:http');
const store = require('../src/store');
const { loginComplete } = require('./helpers/auth');
const { csrfHeaders } = require('./helpers/http');

const BASE = `http://127.0.0.1:${process.env.CS_TEST_PORT || 3162}`;
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
let superCookie;
let previousFaqs;

before(async () => {
  process.env.CS_JWT_SECRET = 'test-secret-faq-bot';
  process.env.CS_DEV_MODE = '1';
  process.env.CS_TEST_PORT = process.env.CS_TEST_PORT || '3162';
  const data = store.load();
  previousFaqs = Array.isArray(data.supportFaqs) ? JSON.parse(JSON.stringify(data.supportFaqs)) : undefined;
  delete data.supportFaqs;
  store.save(data);

  const { createApp } = require('../src/app');
  server = createApp().listen(Number(process.env.CS_TEST_PORT || 3162));
  adminCookie = await loginComplete(request, 'admin@aurora-demo.com.br', 'empresa123');
  superCookie = await loginComplete(request, 'admin@fxfelipexavier.com.br', 'fxadmin123');
});

after(() => {
  const data = store.load();
  if (previousFaqs === undefined) delete data.supportFaqs;
  else data.supportFaqs = previousFaqs;
  store.save(data);
  if (server) server.close();
});

describe('FAQ do bot de suporte', () => {
  it('Adm_Plataforma cria FAQ e empresa recebe resposta do bot', async () => {
    const created = await request('POST', '/settings/support-faq', {
      cookie: superCookie,
      body: {
        question: 'Como resetar a senha do painel?',
        answer: 'Em Minha conta, use a opção de alterar senha. Se precisar de reset, use Esqueci minha senha na tela de login.',
        keywords: 'senha, reset, login, minha conta',
        audience: ['all'],
        enabled: true,
        sortOrder: 5
      }
    });
    assert.equal(created.status, 201);
    assert.ok(created.json.id);

    const ask = await request('POST', '/settings/support-faq/ask', {
      cookie: adminCookie,
      body: { query: 'preciso resetar senha do painel' }
    });
    assert.equal(ask.status, 200);
    assert.equal(ask.json.matched, true);
    assert.match(ask.json.faq.answer, /Minha conta|senha/i);
  });

  it('empresa não cria FAQ', async () => {
    const res = await request('POST', '/settings/support-faq', {
      cookie: adminCookie,
      body: { question: 'x', answer: 'y' }
    });
    assert.equal(res.status, 403);
  });

  it('lista administrativa inclui inativas com all=1', async () => {
    const created = await request('POST', '/settings/support-faq', {
      cookie: superCookie,
      body: {
        question: 'FAQ inativa de teste',
        answer: 'Não deve aparecer no bot.',
        enabled: false,
        audience: ['all']
      }
    });
    assert.equal(created.status, 201);

    const all = await request('GET', '/settings/support-faq?all=1', { cookie: superCookie });
    assert.equal(all.status, 200);
    assert.ok(all.json.faqs.some((f) => f.id === created.json.id && f.enabled === false));

    const ask = await request('POST', '/settings/support-faq/ask', {
      cookie: adminCookie,
      body: { query: 'FAQ inativa de teste' }
    });
    assert.equal(ask.status, 200);
    if (ask.json.matched) {
      assert.notEqual(ask.json.faq.id, created.json.id);
    }
  });

  it('bot sugere alternativas por palavras-chave do FAQ', async () => {
    const ask = await request('POST', '/settings/support-faq/ask', {
      cookie: adminCookie,
      body: { query: 'risco' }
    });
    assert.equal(ask.status, 200);
    assert.equal(ask.json.matched, false);
    assert.equal(ask.json.partialMatch, true);
    assert.ok(Array.isArray(ask.json.suggestions));
    assert.ok(ask.json.suggestions.length >= 2);
    assert.ok(
      ask.json.suggestions.some((s) => /risco|classificar/i.test(String(s.question || '')))
    );
  });

  it('assistente público responde só FAQs de denunciante e recusa dados confidenciais', async () => {
    const ask = await request('POST', '/public/support-faq/ask', {
      body: { query: 'Como faço uma denúncia neste canal?' }
    });
    assert.equal(ask.status, 200);
    assert.equal(ask.json.matched, true);
    assert.ok(String(ask.json.answer || ask.json.faq?.answer || '').toLowerCase().includes('denúncia') || String(ask.json.faq?.answer || '').toLowerCase().includes('denuncia'));

    const confidential = await request('POST', '/public/support-faq/ask', {
      body: { query: 'Quem denunciou e qual o CPF do denunciante?' }
    });
    assert.equal(confidential.status, 200);
    assert.equal(confidential.json.confidential, true);
    assert.equal(confidential.json.matched, false);
    assert.match(String(confidential.json.answer || ''), /política de privacidade/i);

    const internal = await request('POST', '/public/support-faq/ask', {
      body: { query: 'Como cadastrar usuários da empresa e encaminhar para Apurador?' }
    });
    assert.equal(internal.status, 200);
    assert.equal(internal.json.matched, false);
  });
});
