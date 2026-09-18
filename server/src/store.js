'use strict';

/**
 * Persistência da aplicação.
 * - Default: store.json (síncrono) — testes e ambientes sem MySQL.
 * - CS_DB_ENABLED=1 (+ conexão ok): MySQL via adapter (Etapa 4).
 *   load/save continuam síncronos na API; MySQL grava em fila async.
 *   Em falha de save MySQL, faz fallback para JSON.
 * Anexos: sempre filesystem ({DATA_DIR}/attachments) — fora deste módulo.
 */

const fs = require('fs');
const { assertAuditIntegrity } = require('./services/audit.service');
const {
  resolveDataDir,
  resolveStorePath,
  ensureStoreInitialized
} = require('./store-path');

const DATA_DIR = resolveDataDir();
const STORE_PATH = resolveStorePath();

let cache = null;
/** @type {'json'|'mysql'} */
let persistenceMode = 'json';
let writeChain = Promise.resolve();
let initPromise = null;

/**
 * Garante store.json no DATA_DIR usado pelo app e pelo email-worker.
 * Nunca sobrescreve um store.json já existente.
 */
function ensureStoreFile() {
  ensureStoreInitialized();
}

function readJsonFile() {
  ensureStoreFile();
  return JSON.parse(fs.readFileSync(STORE_PATH, 'utf8'));
}

function writeJsonFile(data) {
  if (!fs.existsSync(DATA_DIR)) {
    fs.mkdirSync(DATA_DIR, { recursive: true });
  }
  fs.writeFileSync(STORE_PATH, JSON.stringify(data, null, 2));
}

function getPersistenceMode() {
  return persistenceMode;
}

/**
 * Inicializa o backend. Chamar no boot (index.js) antes de listen.
 * Testes podem omitir — permanecem em JSON.
 * @returns {Promise<'json'|'mysql'>}
 */
async function init() {
  if (initPromise) return initPromise;
  initPromise = (async () => {
    ensureStoreFile();
    const poolMod = require('./db/pool');
    if (!poolMod.wantsMysql()) {
      persistenceMode = 'json';
      cache = null;
      return 'json';
    }
    try {
      const adapter = require('./db/store-mysql-adapter');
      await poolMod.getPool();
      const fromMysql = await adapter.loadAll();
      const hasUsers = Array.isArray(fromMysql.users) && fromMysql.users.length > 0;
      if (!hasUsers && fs.existsSync(STORE_PATH)) {
        console.warn(
          '[store] MySQL sem usuários — mantendo JSON até npm run db:import-json (Etapa 5)'
        );
        await poolMod.endPool();
        poolMod.resetPoolForTests();
        persistenceMode = 'json';
        cache = null;
        return 'json';
      }
      cache = fromMysql;
      persistenceMode = 'mysql';
      console.log('[store] Persistência: MySQL');
      return 'mysql';
    } catch (err) {
      persistenceMode = 'json';
      cache = null;
      console.error(
        '[store] MySQL indisponível — usando JSON:',
        err && err.message ? err.message : err
      );
      return 'json';
    }
  })();
  try {
    return await initPromise;
  } catch (err) {
    initPromise = null;
    throw err;
  }
}

function load() {
  if (!cache) {
    cache = readJsonFile();
  }
  return cache;
}

function save(data) {
  let previous = cache;
  if (!previous && fs.existsSync(STORE_PATH)) {
    previous = JSON.parse(fs.readFileSync(STORE_PATH, 'utf8'));
  }
  if (previous) {
    assertAuditIntegrity(previous, data);
  }

  cache = data;

  if (persistenceMode === 'mysql') {
    const snapshot = data;
    writeChain = writeChain
      .then(async () => {
        const adapter = require('./db/store-mysql-adapter');
        await adapter.saveAll(snapshot);
      })
      .catch((err) => {
        console.error(
          '[store] Falha ao gravar MySQL — fallback JSON:',
          err && err.message ? err.message : err
        );
        try {
          writeJsonFile(snapshot);
        } catch (writeErr) {
          console.error('[store] Fallback JSON também falhou:', writeErr);
        }
      });
    return;
  }

  writeJsonFile(data);
}

function reload() {
  if (persistenceMode === 'mysql') {
    console.warn('[store] reload() síncrono em MySQL não relê o banco; use reloadAsync()');
    return cache || readJsonFile();
  }
  cache = null;
  return load();
}

async function reloadAsync() {
  cache = null;
  if (persistenceMode === 'mysql') {
    const adapter = require('./db/store-mysql-adapter');
    cache = await adapter.loadAll();
    return cache;
  }
  return load();
}

/** Aguarda gravações MySQL pendentes (shutdown / testes). */
async function flush() {
  await writeChain;
}

/**
 * Força modo JSON (testes). Encerra pool se existir.
 */
async function resetForTests() {
  await flush();
  try {
    const poolMod = require('./db/pool');
    await poolMod.endPool();
    poolMod.resetPoolForTests();
  } catch {
    /* ignore */
  }
  persistenceMode = 'json';
  cache = null;
  initPromise = null;
  writeChain = Promise.resolve();
}

function uid(prefix) {
  return `${prefix}_${Date.now().toString(36)}_${Math.random().toString(36).slice(2, 7)}`;
}

module.exports = {
  load,
  save,
  reload,
  reloadAsync,
  init,
  flush,
  resetForTests,
  getPersistenceMode,
  uid,
  STORE_PATH,
  DATA_DIR
};
