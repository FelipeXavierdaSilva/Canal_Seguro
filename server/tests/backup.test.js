'use strict';

const { describe, it, before, after } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('fs');
const path = require('path');
const http = require('node:http');
const store = require('../src/store');
const backup = require('../src/services/backup.service');
const { loginComplete } = require('./helpers/auth');
const { csrfHeaders } = require('./helpers/http');

const BASE = `http://127.0.0.1:${process.env.CS_TEST_PORT || 3165}`;
const API = `${BASE}/api/v1`;
const BACKUPS_DIR = path.join(store.DATA_DIR, 'backups');

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

function cleanupTestBackups() {
  if (!fs.existsSync(BACKUPS_DIR)) return;
  for (const name of fs.readdirSync(BACKUPS_DIR)) {
    if (!name.startsWith('bkp_')) continue;
    fs.rmSync(path.join(BACKUPS_DIR, name), { recursive: true, force: true });
  }
}

let server;
let superCookie;
let adminCookie;
let markerCompanyName;

before(async () => {
  process.env.CS_JWT_SECRET = 'test-secret-backup';
  process.env.CS_DEV_MODE = '1';
  process.env.CS_TEST_PORT = process.env.CS_TEST_PORT || '3165';
  cleanupTestBackups();

  const { createApp } = require('../src/app');
  server = createApp().listen(Number(process.env.CS_TEST_PORT || 3165));
  superCookie = await loginComplete(request, 'admin@fxfelipexavier.com.br', 'fxadmin123');
  adminCookie = await loginComplete(request, 'admin@aurora-demo.com.br', 'empresa123');
});

after(() => {
  cleanupTestBackups();
  if (server) server.close();
});

describe('Backup operacional', () => {
  it('empresa não acessa backups', async () => {
    const res = await request('GET', '/admin/backups/status', { cookie: adminCookie });
    assert.equal(res.status, 403);
  });

  it('cria backup completo e restaura dados/configurações', async () => {
    const data = store.load();
    const company = (data.companies || [])[0];
    assert.ok(company);
    markerCompanyName = `${company.nome || company.name || 'Empresa'}__BKP_MARKER_${Date.now()}`;
    company.nome = markerCompanyName;
    if (company.name) company.name = markerCompanyName;
    data.platformSettings = data.platformSettings || {};
    data.platformSettings.__backupTestFlag = 'keep-me';
    data.supportFaqs = data.supportFaqs || [];
    store.save(data);

    const created = await request('POST', '/admin/backups', {
      cookie: superCookie,
      body: { note: 'teste restauração' }
    });
    assert.equal(created.status, 201);
    assert.ok(created.json.id);
    assert.equal(created.json.verified, true);
    assert.ok(fs.existsSync(path.join(BACKUPS_DIR, created.json.id, 'store.json')));

    // Altera dados após o backup
    const after = store.load();
    const c2 = (after.companies || []).find((c) => c.id === company.id);
    c2.nome = 'ALTERADO_APOS_BACKUP';
    after.platformSettings.__backupTestFlag = 'changed';
    store.save(after);

    const restored = await request('POST', `/admin/backups/${created.json.id}/restore`, {
      cookie: superCookie,
      body: { confirm: true }
    });
    assert.equal(restored.status, 200);
    assert.equal(restored.json.restoredBackupId, created.json.id);
    assert.ok(restored.json.safetyBackupId);

    store.reload();
    const live = store.load();
    const restoredCompany = (live.companies || []).find((c) => c.id === company.id);
    assert.equal(restoredCompany.nome, markerCompanyName);
    assert.equal(live.platformSettings.__backupTestFlag, 'keep-me');
  });

  it('CLI createBackup gera pasta com manifesto', () => {
    const actor = { id: 'cli', role: 'superadmin', nome: 'CLI' };
    const result = backup.createBackup(actor, { note: 'cli-test' });
    assert.equal(result.ok, true);
    const dir = path.join(BACKUPS_DIR, result.data.id);
    assert.ok(fs.existsSync(path.join(dir, 'manifest.json')));
    assert.ok(fs.existsSync(path.join(dir, 'store.json')));
  });
});
