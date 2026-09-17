'use strict';

const { describe, it, before, after } = require('node:test');
const assert = require('node:assert/strict');
const http = require('node:http');
const store = require('../src/store');
const { loginComplete } = require('./helpers/auth');
const { csrfHeaders } = require('./helpers/http');

const TEST_PORT = process.env.CS_TEST_PORT_CRUD || '3195';
const BASE = `http://127.0.0.1:${TEST_PORT}`;
const API = `${BASE}/api/v1`;

function request(method, pathName, { body, cookie } = {}) {
  return new Promise((resolve, reject) => {
    const url = new URL(`${API}${pathName.startsWith('/') ? pathName : `/${pathName}`}`);
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

describe('CRUD HTTP users/employees/contents/companies', () => {
  let server;
  let cookie;

  before(async () => {
    process.env.CS_JWT_SECRET = 'test-secret-crud';
    process.env.CS_DEV_MODE = '1';
    process.env.CS_MFA_DISABLED_FOR_TESTS = '1';
    const { createApp } = require('../src/app');
    server = createApp().listen(Number(TEST_PORT));
    cookie = await loginComplete(request, 'admin@fxfelipexavier.com.br', 'fxadmin123');
  });

  after(() => {
    if (server) server.close();
  });

  it('cria, lista e edita usuário', async () => {
    const username = `usr_crud_${Date.now()}`;
    const created = await request('POST', '/users', {
      cookie,
      body: {
        nome: 'User CRUD',
        username,
        email: `${username}@example.com`,
        password: 'SenhaForte@9x7!',
        role: 'apurador',
        companyId: 'cmp_aurora',
        status: 'ativo'
      }
    });
    assert.equal(created.status, 201, JSON.stringify(created.json));
    assert.ok(created.json.user?.id);

    const listed = await request('GET', '/users?companyId=cmp_aurora', { cookie });
    assert.equal(listed.status, 200);
    assert.ok((listed.json.users || []).some((u) => u.id === created.json.user.id));

    const updated = await request('PUT', `/users/${created.json.user.id}`, {
      cookie,
      body: { nome: 'User CRUD Editado' }
    });
    assert.equal(updated.status, 200, JSON.stringify(updated.json));
    assert.equal(updated.json.user.nome, 'User CRUD Editado');
  });

  it('cria, lista e edita colaborador', async () => {
    const cpf = String(10000000000 + (Date.now() % 8999999999)).slice(0, 11);
    const created = await request('POST', '/employees', {
      cookie,
      body: {
        companyId: 'cmp_aurora',
        nome: 'Colab CRUD',
        cpf,
        status: 'ativo'
      }
    });
    assert.equal(created.status, 201, JSON.stringify(created.json));
    assert.ok(created.json.employee?.id);

    const listed = await request('GET', '/employees?companyId=cmp_aurora', { cookie });
    assert.equal(listed.status, 200);
    assert.ok((listed.json.employees || []).some((e) => e.id === created.json.employee.id));

    const updated = await request('PUT', `/employees/${created.json.employee.id}`, {
      cookie,
      body: { nome: 'Colab CRUD Editado', setor: 'RH' }
    });
    assert.equal(updated.status, 200, JSON.stringify(updated.json));
    assert.equal(updated.json.employee.nome, 'Colab CRUD Editado');
  });

  it('cria e edita conteúdo', async () => {
    const created = await request('POST', '/contents', {
      cookie,
      body: { type: 'faq', title: `FAQ CRUD ${Date.now()}`, body: 'texto', status: 'publicado' }
    });
    assert.equal(created.status, 201, JSON.stringify(created.json));
    assert.ok(created.json.content?.id);

    const listed = await request('GET', '/contents', { cookie });
    assert.equal(listed.status, 200);
    assert.ok((listed.json.contents || []).some((c) => c.id === created.json.content.id));

    const updated = await request('PUT', `/contents/${created.json.content.id}`, {
      cookie,
      body: { title: 'FAQ CRUD Editado' }
    });
    assert.equal(updated.status, 200, JSON.stringify(updated.json));
    assert.equal(updated.json.content.title, 'FAQ CRUD Editado');
  });

  it('cria empresa', async () => {
    const nome = `Empresa CRUD ${Date.now()}`;
    const created = await request('POST', '/companies', {
      cookie,
      body: { nomeFantasia: nome, razaoSocial: nome, cnpj: '00.000.000/0001-91' }
    });
    assert.equal(created.status, 201, JSON.stringify(created.json));
    assert.ok(created.json.company?.id);
    assert.equal(created.json.company.nomeFantasia, nome);
    const data = store.load();
    assert.ok((data.companies || []).some((c) => c.id === created.json.company.id));
  });
});
