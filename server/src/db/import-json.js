'use strict';

/**
 * Importa store.json → MySQL (Etapa 5).
 * Idempotente: cada execução substitui o conteúdo das tabelas de domínio
 * pelo snapshot do JSON (mesmo resultado se reexecutar o mesmo arquivo).
 *
 * Não exige CS_DB_ENABLED=1 (pode importar antes do cutover).
 * Anexos em disco não são movidos.
 */

const fs = require('fs');
const path = require('path');
const store = require('../store');
const dbConfig = require('../services/db-config.service');
const poolMod = require('./pool');
const adapter = require('./store-mysql-adapter');
const { runMigrations } = require('./migrate');

function defaultStorePath() {
  return store.STORE_PATH;
}

function readStoreFile(filePath) {
  const full = path.resolve(filePath || defaultStorePath());
  if (!fs.existsSync(full)) {
    const err = new Error(`Arquivo não encontrado: ${full}`);
    err.code = 'STORE_MISSING';
    throw err;
  }
  const raw = JSON.parse(fs.readFileSync(full, 'utf8'));
  if (!raw || typeof raw !== 'object') {
    const err = new Error('store.json inválido (não é objeto).');
    err.code = 'STORE_INVALID';
    throw err;
  }
  return { path: full, data: raw };
}

function summarize(data) {
  const counts = {};
  for (const ent of adapter.ENTITY_MAP) {
    if (ent.kind === 'array') {
      counts[ent.storeKey] = Array.isArray(data[ent.storeKey]) ? data[ent.storeKey].length : 0;
    } else if (ent.kind === 'map') {
      counts[ent.storeKey] = data[ent.storeKey] && typeof data[ent.storeKey] === 'object'
        ? Object.keys(data[ent.storeKey]).length
        : 0;
    } else if (ent.kind === 'singleton') {
      counts[ent.storeKey] = data[ent.storeKey] && typeof data[ent.storeKey] === 'object' ? 1 : 0;
    } else if (ent.kind === 'flag') {
      counts[ent.storeKey] = data[ent.storeKey] ? 1 : 0;
    }
  }
  return {
    users: counts.users || 0,
    companies: counts.companies || 0,
    reports: counts.reports || 0,
    employees: counts.employees || 0,
    auditLogs: counts.auditLogs || 0,
    supportFaqs: counts.supportFaqs || 0,
    counts
  };
}

/**
 * @param {object} [options]
 * @param {string} [options.file]
 * @param {boolean} [options.dryRun]
 * @param {boolean} [options.migrate] — aplica migrations pendentes antes (default true)
 * @returns {Promise<object>}
 */
async function importJsonToMysql(options = {}) {
  const cfg = dbConfig.resolveConnectionConfig();
  if (!cfg.host || !cfg.user || !cfg.database) {
    return {
      ok: false,
      error:
        'MySQL não configurado. Defina CS_DB_* ou salve em Configurações → Banco de dados.'
    };
  }

  let fileInfo;
  try {
    fileInfo = readStoreFile(options.file);
  } catch (err) {
    return { ok: false, error: err.message };
  }

  const summary = summarize(fileInfo.data);
  const target = { host: cfg.host, port: cfg.port, database: cfg.database };

  if (options.dryRun) {
    return {
      ok: true,
      dryRun: true,
      file: fileInfo.path,
      target,
      summary,
      note: 'Nenhuma alteração escrita. Remova --dry-run para importar.'
    };
  }

  const doMigrate = options.migrate !== false;
  if (doMigrate) {
    const mig = await runMigrations({ connection: cfg });
    if (!mig.ok) {
      return { ok: false, error: `Migration falhou: ${mig.error}`, target };
    }
  }

  try {
    await poolMod.endPool().catch(() => {});
    poolMod.resetPoolForTests();
    const pool = await poolMod.getPool({ allowDisabled: true });
    await adapter.saveAll(fileInfo.data, pool);

    const verify = await adapter.loadAll(pool);
    const after = summarize(verify);

    return {
      ok: true,
      file: fileInfo.path,
      target,
      summary,
      verified: after,
      idempotent: true,
      note:
        'Import concluído. Para usar MySQL no app: CS_DB_ENABLED=1 e reinicie o Node. Rollback: CS_DB_ENABLED=0 (volta ao store.json).'
    };
  } catch (err) {
    return {
      ok: false,
      error: err && err.message ? err.message : String(err),
      target,
      summary
    };
  } finally {
    try {
      await poolMod.endPool();
      poolMod.resetPoolForTests();
    } catch {
      /* ignore */
    }
  }
}

module.exports = {
  importJsonToMysql,
  readStoreFile,
  summarize,
  defaultStorePath
};
