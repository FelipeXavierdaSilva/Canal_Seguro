'use strict';

/**
 * Contrato StorageService (Fase C1).
 *
 * Métodos obrigatórios:
 * - upload(key, buffer, options?) → key (posix relativo)
 * - download(key) → Buffer
 * - delete(key) → boolean
 * - exists(key) → boolean
 * - getMetadata(key) → { size, lastModified?, contentType? }
 *
 * Providers devem usar storageKey relativo (sem URL pública).
 * Path/contrato HTTP externo NÃO muda com a troca de provider.
 */

const REQUIRED = ['upload', 'download', 'delete', 'exists', 'getMetadata'];

function assertStorageService(storage, label = 'StorageService') {
  if (!storage || typeof storage !== 'object') {
    throw new Error(`${label} inválido.`);
  }
  for (const name of REQUIRED) {
    if (typeof storage[name] !== 'function') {
      throw new Error(`${label} incompleto: falta ${name}().`);
    }
  }
  return storage;
}

module.exports = {
  STORAGE_SERVICE_METHODS: REQUIRED,
  assertStorageService
};
