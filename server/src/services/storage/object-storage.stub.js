'use strict';

/**
 * Stub futuro Object Storage (S3/R2/etc.) — NÃO ativo na Fase C1.
 *
 * Quando migrar Hostinger/object storage:
 * 1. Implementar createObjectStorage(opts) com o contrato StorageService
 * 2. Selecionar provider em getStorage() via env (ex.: CS_STORAGE_PROVIDER=s3)
 * 3. Manter storageKey relativo e o mesmo contrato HTTP/API
 *
 * Exemplo (comentado de propósito):
 *
 * function createObjectStorage(_opts = {}) {
 *   const notImplemented = (op) => () => {
 *     const err = new Error(`ObjectStorage.${op} not implemented (Fase C1).`);
 *     err.code = 'NOT_IMPLEMENTED';
 *     throw err;
 *   };
 *   return {
 *     upload: notImplemented('upload'),
 *     download: notImplemented('download'),
 *     delete: notImplemented('delete'),
 *     exists: notImplemented('exists'),
 *     getMetadata: notImplemented('getMetadata'),
 *     provider: 'object-storage-stub'
 *   };
 * }
 *
 * module.exports = { createObjectStorage };
 */

module.exports = {};
