'use strict';

const { describe, it, before, after } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('fs');
const path = require('path');
const http = require('node:http');
const store = require('../src/store');
const dbConfig = require('../src/services/db-config.service');
const { resetAllForTests } = require('../src/utils/rate-limit-gate');
const { loginComplete } = require('./helpers/auth');
const { csrfHeaders } = require('./helpers/http');

const TEST_PORT = process.env.CS_TEST_PORT_DB_CONFIG || '3188';
const BASE = `http://127.0.0.1:${TEST_PORT}`;
const API = `${BASE}/api/v1`;
const CONFIG_PATH = path.join(store.DATA_DIR, dbConfig.CONFIG_FILE);

function request(method, pathName, { body, cookie, headers, host = API } = {}) {
  return new Promise((resolve, reject) => {
    const fullPath = pathName.startsWith('http')
      ? pathName
      : `${host}${pathName.startsWith('/') ? pathName : `/${pathName}`}`;
    const url = new URL(fullPath);
    const opts = {
      method,
      hostname: url.hostname,
      port: url.port,
      path: url.pathname + url.search,
      headers: {
        ...(body ? { 'Content-Type': 'application/json' } : {}),
        ...(cookie ? { Cookie: cookie, ...csrfHeaders(cookie) } : {}),
        ...(headers || {})
      }
    };
    const req = http.request(opts, (res) => {
      const chunks = [];
      res.on('data', (c) => chunks.push(c));
      res.on('end', () => {
        const buf = Buffer.concat(chunks);
        let json = null;
        try {
          json = buf.length ? JSON.parse(buf.toString('utf8')) : null;
        } catch {
          json = buf.toString('utf8');
        }
        resolve({ status: res.statusCode, headers: res.headers, json });
      });
    });
    req.on('error', reject);
    if (body) req.write(JSON.stringify(body));
    req.end();
  });
}

describe('db-config service', () => {
  let previousExists = false;
  let previousContent = null;

  before(() => {
    previousExists = fs.existsSync(CONFIG_PATH);
    if (previousExists) previousContent = fs.readFileSync(CONFIG_PATH);
    if (previousExists) fs.unlinkSync(CONFIG_PATH);
  });

  after(() => {
    if (fs.existsSync(CONFIG_PATH)) fs.unlinkSync(CONFIG_PATH);
    if (previousExists && previousContent) fs.writeFileSync(CONFIG_PATH, previousContent);
  });

  it('criptografa e descriptografa senha', () => {
    const enc = dbConfig.encryptPassword('senha-teste-123');
    assert.ok(enc.startsWith('v1:'));
    assert.equal(dbConfig.decryptPassword(enc), 'senha-teste-123');
  });

  it('salva config sem devolver senha no payload público', () => {
    const actor = { id: 'u_sa', role: 'superadmin' };
    const saved = dbConfig.updateConfigForAdmin(actor, {
      enabled: true,
      host: '127.0.0.1',
      port: 3306,
      user: 'cs_user',
      database: 'cs_db',
      password: 'segredo'
    });
    assert.equal(saved.ok, true);
    assert.equal(saved.data.hasPassword, true);
    assert.equal(saved.data.host, '127.0.0.1');
    assert.equal(saved.data.user, 'cs_user');
    assert.ok(!('password' in saved.data));
    assert.ok(!JSON.stringify(saved.data).includes('segredo'));

    const file = JSON.parse(fs.readFileSync(CONFIG_PATH, 'utf8'));
    assert.ok(file.passwordEnc.startsWith('v1:'));
    assert.ok(!JSON.stringify(file).includes('segredo'));
  });

  it('bloqueia não-superadmin', () => {
    const denied = dbConfig.getConfigForAdmin({ id: 'u1', role: 'admin_empresa' });
    assert.equal(denied.ok, false);
    assert.equal(denied.status, 403);
  });
});

describe('db-config API', () => {
  let server;
  let cookie;
  let previousExists = false;
  let previousContent = null;

  before(async () => {
    previousExists = fs.existsSync(CONFIG_PATH);
    if (previousExists) previousContent = fs.readFileSync(CONFIG_PATH);
    if (fs.existsSync(CONFIG_PATH)) fs.unlinkSync(CONFIG_PATH);

    process.env.CS_JWT_SECRET = 'test-secret-db-config';
    process.env.CS_DEV_MODE = '1';
    await resetAllForTests();
    const { createApp } = require('../src/app');
    server = createApp().listen(Number(TEST_PORT));
    cookie = await loginComplete(request, 'admin@fxfelipexavier.com.br', 'fxadmin123');
  });

  after(async () => {
    if (server) await new Promise((r) => server.close(r));
    if (fs.existsSync(CONFIG_PATH)) fs.unlinkSync(CONFIG_PATH);
    if (previousExists && previousContent) fs.writeFileSync(CONFIG_PATH, previousContent);
  });

  it('GET /settings/database retorna config sem senha', async () => {
    const res = await request('GET', '/settings/database', { cookie });
    assert.equal(res.status, 200);
    assert.equal(res.json.persistenceMode, 'json');
    assert.ok(!('password' in res.json));
  });

  it('PUT /settings/database salva host e hasPassword', async () => {
    const res = await request('PUT', '/settings/database', {
      cookie,
      body: {
        enabled: false,
        host: 'mysql.hostinger.local',
        port: 3306,
        user: 'u123',
        database: 'db123',
        password: 'pwd-hostinger'
      }
    });
    assert.equal(res.status, 200, JSON.stringify(res.json));
    assert.equal(res.json.host, 'mysql.hostinger.local');
    assert.equal(res.json.hasPassword, true);
    assert.ok(!JSON.stringify(res.json).includes('pwd-hostinger'));
  });

  it('POST /settings/database/test falha com host inválido sem vazar senha', async () => {
    const res = await request('POST', '/settings/database/test', {
      cookie,
      body: {
        host: '127.0.0.1',
        port: 1,
        user: 'nobody',
        database: 'nodb',
        password: 'x'
      }
    });
    assert.ok(res.status === 400 || res.status === 503);
    assert.ok(res.json.error);
    assert.ok(!String(res.json.error).includes('pwd-hostinger'));
  });
});
