'use strict';

/**
 * Fase C1 — contrato StorageService + LocalFilesystemStorage
 */
const { describe, it, before, after } = require('node:test');
const assert = require('node:assert/strict');
const path = require('path');
const fs = require('fs');
const os = require('os');
const {
  createLocalFilesystemStorage,
  createLocalFsStorage
} = require('../src/services/storage/local-fs.storage');
const { assertStorageService, STORAGE_SERVICE_METHODS } = require('../src/services/storage/storage-service');
const { getStorage } = require('../src/services/storage');

describe('Fase C1 — StorageService', () => {
  let tmpDir;
  let storage;

  before(() => {
    tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), 'cs-storage-c1-'));
    storage = createLocalFilesystemStorage(tmpDir);
  });

  after(() => {
    try {
      fs.rmSync(tmpDir, { recursive: true, force: true });
    } catch {
      /* ignore */
    }
  });

  it('expõe upload/download/delete/exists/getMetadata', () => {
    assertStorageService(storage);
    for (const m of STORAGE_SERVICE_METHODS) {
      assert.equal(typeof storage[m], 'function');
    }
  });

  it('createLocalFsStorage é alias do mesmo provider', () => {
    const a = createLocalFsStorage(tmpDir);
    assert.equal(a.provider, 'local-fs');
    assertStorageService(a);
  });

  it('upload/download/exists/getMetadata/delete mantêm path relativo', () => {
    const key = 'attachments/cmp_x/rpt_y/att_z_file.txt';
    assert.equal(storage.upload(key, Buffer.from('c1-ok')), key);
    assert.equal(storage.exists(key), true);
    assert.equal(storage.download(key).toString('utf8'), 'c1-ok');
    const meta = storage.getMetadata(key);
    assert.equal(meta.size, 5);
    assert.ok(meta.lastModified);
    assert.equal(storage.delete(key), true);
    assert.equal(storage.exists(key), false);
  });

  it('aliases put/get/remove preservam comportamento legado', () => {
    const key = `attachments/_alias/${Date.now()}.txt`;
    storage.put(key, Buffer.from('alias'));
    assert.equal(storage.get(key).toString('utf8'), 'alias');
    storage.remove(key);
    assert.equal(storage.exists(key), false);
  });

  it('getStorage() retorna StorageService válido', () => {
    assertStorageService(getStorage());
  });
});
