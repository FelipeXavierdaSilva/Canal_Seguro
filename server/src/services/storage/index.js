'use strict';

const store = require('../../store');
const { createLocalFilesystemStorage } = require('./local-fs.storage');
const { assertStorageService } = require('./storage-service');

let cached = null;
let cachedRoot = null;

/**
 * Retorna o StorageService ativo.
 * Fase C1: somente LocalFilesystemStorage (mesmo path sob DATA_DIR).
 * Futuro: trocar provider sem alterar attachment-storage / rotas HTTP.
 */
function getStorage() {
  const root = store.DATA_DIR;
  if (!cached || cachedRoot !== root) {
    cached = assertStorageService(
      createLocalFilesystemStorage(root),
      'LocalFilesystemStorage'
    );
    cachedRoot = root;
  }
  return cached;
}

module.exports = {
  getStorage,
  assertStorageService
};
