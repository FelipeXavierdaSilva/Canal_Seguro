'use strict';

/**
 * Caminho único de persistência JSON (app, seed e email-worker).
 * - Com STORE_DATA_DIR: {STORE_DATA_DIR}/store.json
 * - Sem STORE_DATA_DIR: {os.homedir()}/private/canal-seguro-data/store.json
 * Nunca usa nome de usuário hardcoded (ex.: /home/USUARIO/...).
 */
const fs = require('fs');
const os = require('os');
const path = require('path');

function resolveDataDir() {
  const fromEnv = process.env.STORE_DATA_DIR && String(process.env.STORE_DATA_DIR).trim();
  if (fromEnv) {
    return path.resolve(fromEnv);
  }
  return path.join(os.homedir(), 'private', 'canal-seguro-data');
}

function resolveStorePath() {
  return path.join(resolveDataDir(), 'store.json');
}

/** Template versionado em server/data (sempre relativo ao pacote server). */
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
  const dataDirectory = resolveDataDir();

  try {
    if (fs.existsSync(storePath)) {
      return { created: false, path: storePath };
    }

    fs.mkdirSync(dataDirectory, { recursive: true });

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
  } catch (err) {
    const detail = err && err.message ? err.message : String(err);
    if (detail.includes(storePath) && detail.startsWith('Arquivo store.json')) {
      throw err;
    }
    throw new Error(`[store] Falha ao preparar armazenamento em ${storePath}: ${detail}`);
  }
}

module.exports = {
  resolveDataDir,
  resolveStorePath,
  resolveStoreSeedPath,
  ensureStoreInitialized
};
