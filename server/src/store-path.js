'use strict';

/**
 * Caminho único de persistência JSON (app, seed e email-worker).
 * - Com CS_DATA_DIR: {CS_DATA_DIR}/store.json
 * - Sem CS_DATA_DIR: server/data/store.json
 */
const fs = require('fs');
const path = require('path');

function resolveDataDir() {
  return path.resolve(process.env.CS_DATA_DIR || path.join(__dirname, '..', 'data'));
}

function resolveStorePath() {
  return path.resolve(
    process.env.CS_DATA_DIR || path.join(__dirname, '..', 'data'),
    'store.json'
  );
}

/** Template versionado em server/data (não depende de CS_DATA_DIR). */
function resolveStoreSeedPath() {
  return path.join(__dirname, '..', 'data', 'store.seed.json');
}

/**
 * Garante store.json no mesmo caminho do app.
 * Cria a pasta se faltar; só cria o arquivo se ainda não existir.
 * @returns {{ created: boolean, path: string }}
 */
function ensureStoreInitialized() {
  const storePath = resolveStorePath();
  const dataDir = resolveDataDir();

  if (fs.existsSync(storePath)) {
    return { created: false, path: storePath };
  }

  if (!fs.existsSync(dataDir)) {
    fs.mkdirSync(dataDir, { recursive: true });
  }

  const seedPath = resolveStoreSeedPath();
  if (fs.existsSync(seedPath)) {
    fs.copyFileSync(seedPath, storePath);
    console.warn(`[store] store.json ausente — criado em ${storePath}`);
    return { created: true, path: storePath };
  }

  throw new Error(
    `Arquivo store.json não encontrado em ${storePath}. ` +
      'Inclua server/data/store.seed.json no deploy ou execute: cd server && npm run seed'
  );
}

module.exports = {
  resolveDataDir,
  resolveStorePath,
  resolveStoreSeedPath,
  ensureStoreInitialized
};
