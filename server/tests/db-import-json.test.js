'use strict';

const { describe, it } = require('node:test');
const assert = require('node:assert/strict');
const path = require('path');
const { summarize, readStoreFile, importJsonToMysql, defaultStorePath } = require('../src/db/import-json');
const store = require('../src/store');

describe('db import-json (Etapa 5)', () => {
  it('defaultStorePath aponta para store.STORE_PATH', () => {
    assert.equal(defaultStorePath(), store.STORE_PATH);
  });

  it('readStoreFile lê o store.json do DATA_DIR', () => {
    const { path: p, data } = readStoreFile();
    assert.ok(p.endsWith('store.json') || p.includes('store.json'));
    assert.ok(Array.isArray(data.users));
    assert.ok(Array.isArray(data.companies));
  });

  it('summarize conta entidades principais', () => {
    const data = store.load();
    const s = summarize(data);
    assert.equal(s.users, data.users.length);
    assert.equal(s.companies, data.companies.length);
    assert.equal(s.reports, data.reports.length);
    assert.ok(s.counts.platformSettings >= 0);
  });

  it('dry-run sem credenciais retorna erro claro', async () => {
    const prev = {
      host: process.env.CS_DB_HOST,
      user: process.env.CS_DB_USER,
      name: process.env.CS_DB_NAME,
      pass: process.env.CS_DB_PASSWORD,
      enabled: process.env.CS_DB_ENABLED
    };
    delete process.env.CS_DB_HOST;
    delete process.env.CS_DB_USER;
    delete process.env.CS_DB_NAME;
    delete process.env.CS_DB_PASSWORD;
    delete process.env.CS_DB_ENABLED;

    try {
      const result = await importJsonToMysql({ dryRun: true });
      // Pode ok se houver db-config.json de teste; se não, erro de config
      if (!result.ok) {
        assert.match(result.error || '', /não configurado/i);
      } else {
        assert.equal(result.dryRun, true);
        assert.ok(result.summary.users >= 0);
      }
    } finally {
      if (prev.host != null) process.env.CS_DB_HOST = prev.host;
      else delete process.env.CS_DB_HOST;
      if (prev.user != null) process.env.CS_DB_USER = prev.user;
      else delete process.env.CS_DB_USER;
      if (prev.name != null) process.env.CS_DB_NAME = prev.name;
      else delete process.env.CS_DB_NAME;
      if (prev.pass != null) process.env.CS_DB_PASSWORD = prev.pass;
      else delete process.env.CS_DB_PASSWORD;
      if (prev.enabled != null) process.env.CS_DB_ENABLED = prev.enabled;
      else delete process.env.CS_DB_ENABLED;
    }
  });

  it('dry-run com connection forçada via env incompleto falha', async () => {
    process.env.CS_DB_HOST = '';
    process.env.CS_DB_USER = '';
    process.env.CS_DB_NAME = '';
    process.env.CS_DB_ENABLED = '0';
    // Força arquivo a não prevalecer: se houver db-config com dados, dry-run pode ok.
    // Garante pelo menos que arquivo inexistente via --file falha:
    const missing = await importJsonToMysql({
      dryRun: true,
      file: path.join(__dirname, 'no-such-store-file-xyz.json')
    });
    // Se MySQL não configurado, erro de config vem primeiro
    assert.equal(missing.ok, false);
    assert.ok(missing.error);
  });
});
