'use strict';

const fs = require('fs');
const path = require('path');
const { assertStorageService } = require('./storage-service');

/**
 * LocalFilesystemStorage — provider atual (Fase C1).
 * Comportamento idêntico ao LocalFs anterior: arquivos sob DATA_DIR,
 * keys relativas posix, sem URLs públicas.
 *
 * Aliases put/get/remove mantidos para compatibilidade com testes P3.
 */
function createLocalFilesystemStorage(dataDir) {
  const root = path.resolve(dataDir);

  function resolveSafe(relativeKey) {
    const normalized = String(relativeKey || '')
      .replace(/\\/g, '/')
      .replace(/^\/+/, '');
    if (!normalized || normalized.includes('..')) {
      const err = new Error('storageKey inválido.');
      err.code = 'INVALID_KEY';
      throw err;
    }
    const abs = path.resolve(root, normalized);
    if (!abs.startsWith(root)) {
      const err = new Error('Path fora do DATA_DIR.');
      err.code = 'PATH_TRAVERSAL';
      throw err;
    }
    return abs;
  }

  function upload(relativeKey, buffer) {
    const abs = resolveSafe(relativeKey);
    fs.mkdirSync(path.dirname(abs), { recursive: true });
    fs.writeFileSync(abs, buffer);
    return String(relativeKey).replace(/\\/g, '/');
  }

  function download(relativeKey) {
    const abs = resolveSafe(relativeKey);
    if (!fs.existsSync(abs)) {
      const err = new Error('Arquivo não encontrado.');
      err.code = 'NOT_FOUND';
      throw err;
    }
    return fs.readFileSync(abs);
  }

  function exists(relativeKey) {
    try {
      return fs.existsSync(resolveSafe(relativeKey));
    } catch {
      return false;
    }
  }

  function remove(relativeKey) {
    try {
      const abs = resolveSafe(relativeKey);
      if (fs.existsSync(abs)) fs.unlinkSync(abs);
      return true;
    } catch {
      return false;
    }
  }

  function getMetadata(relativeKey) {
    const abs = resolveSafe(relativeKey);
    if (!fs.existsSync(abs)) {
      const err = new Error('Arquivo não encontrado.');
      err.code = 'NOT_FOUND';
      throw err;
    }
    const st = fs.statSync(abs);
    return {
      size: st.size,
      lastModified: st.mtime.toISOString(),
      contentType: null
    };
  }

  /** Helper de testes — fora do contrato StorageService público. */
  function clearPrefix(relativePrefix) {
    const abs = resolveSafe(relativePrefix || 'attachments');
    if (fs.existsSync(abs)) {
      fs.rmSync(abs, { recursive: true, force: true });
    }
  }

  const api = {
    upload,
    download,
    delete: remove,
    exists,
    getMetadata,
    /* aliases legados (mesma implementação) */
    put: upload,
    get: download,
    remove,
    resolveSafe,
    clearPrefix,
    root,
    provider: 'local-fs'
  };

  return assertStorageService(api, 'LocalFilesystemStorage');
}

/** Nome legado — idêntico a createLocalFilesystemStorage. */
const createLocalFsStorage = createLocalFilesystemStorage;

module.exports = {
  createLocalFilesystemStorage,
  createLocalFsStorage
};
