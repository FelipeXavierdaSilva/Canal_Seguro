'use strict';

const { describe, it, before, after } = require('node:test');
const assert = require('node:assert/strict');
const store = require('../src/store');
const pool = require('../src/db/pool');
const adapter = require('../src/db/store-mysql-adapter');

describe('store mysql adapter (Etapa 4)', () => {
  it('ENTITY_MAP cobre chaves principais do store', () => {
    const keys = adapter.ENTITY_MAP.map((e) => e.storeKey);
    for (const k of [
      'users',
      'companies',
      'reports',
      'employees',
      'auditLogs',
      'platformSettings',
      'companySettings',
      '_meta',
      'supportFaqs',
      'emailQueue'
    ]) {
      assert.ok(keys.includes(k), `faltou ${k}`);
    }
  });

  it('emptyStore tem arrays/objetos seguros', () => {
    const empty = adapter.emptyStore();
    assert.ok(Array.isArray(empty.users));
    assert.equal(typeof empty.platformSettings, 'object');
    assert.equal(typeof empty.companySettings, 'object');
    assert.equal(empty.__supportFaqsChanged, false);
  });

  it('parsePayload aceita objeto e string JSON', () => {
    assert.deepEqual(adapter.parsePayload({ a: 1 }), { a: 1 });
    assert.deepEqual(adapter.parsePayload('{"b":2}'), { b: 2 });
    assert.equal(adapter.parsePayload('nope'), null);
  });

  it('wantsMysql é false sem CS_DB_ENABLED', () => {
    const prev = process.env.CS_DB_ENABLED;
    delete process.env.CS_DB_ENABLED;
    try {
      // sem arquivo enabled, deve ser false
      assert.equal(pool.wantsMysql(), false);
    } finally {
      if (prev != null) process.env.CS_DB_ENABLED = prev;
      else delete process.env.CS_DB_ENABLED;
    }
  });
});

describe('store dual-mode JSON default', () => {
  before(async () => {
    await store.resetForTests();
    delete process.env.CS_DB_ENABLED;
  });

  after(async () => {
    await store.resetForTests();
  });

  it('init sem MySQL permanece em json', async () => {
    const mode = await store.init();
    assert.equal(mode, 'json');
    assert.equal(store.getPersistenceMode(), 'json');
  });

  it('load/save JSON continua funcionando', () => {
    const data = store.load();
    assert.ok(Array.isArray(data.users));
    const n = data.users.length;
    store.save(data);
    store.reload();
    assert.equal(store.load().users.length, n);
  });
});
