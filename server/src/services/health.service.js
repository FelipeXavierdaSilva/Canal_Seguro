'use strict';

/**
 * Health / readiness para go-live Hostinger (Etapa 6).
 */

const fs = require('fs');
const store = require('../store');
const dbConfig = require('./db-config.service');
const poolMod = require('../db/pool');

async function pingMysql() {
  const cfg = dbConfig.resolveConnectionConfig();
  if (!cfg.host || !cfg.user || !cfg.database) {
    return { configured: false, connected: false, message: 'MySQL não configurado.' };
  }
  try {
    const pool = await poolMod.getPool({ allowDisabled: true });
    await pool.query('SELECT 1 AS ok');
    return {
      configured: true,
      connected: true,
      enabled: Boolean(cfg.enabled),
      host: cfg.host,
      database: cfg.database,
      message: 'MySQL OK'
    };
  } catch (err) {
    try {
      await poolMod.endPool();
      poolMod.resetPoolForTests();
    } catch {
      /* ignore */
    }
    return {
      configured: true,
      connected: false,
      enabled: Boolean(cfg.enabled),
      host: cfg.host,
      database: cfg.database,
      message: err && err.message ? err.message : 'Falha ao conectar MySQL'
    };
  }
}

/**
 * @param {{ deep?: boolean }} [options] — deep=true tenta ping MySQL quando habilitado/configurado
 */
async function getHealth(options = {}) {
  const persistenceMode =
    typeof store.getPersistenceMode === 'function' ? store.getPersistenceMode() : 'json';
  const storeFileExists = fs.existsSync(store.STORE_PATH);
  const deep = options.deep === true;

  const body = {
    ok: true,
    service: 'canal-seguro-api',
    phase: 1,
    mfa: true,
    email: true,
    persistence: {
      mode: persistenceMode,
      storeFileExists,
      dataDirConfigured: Boolean(process.env.CS_DATA_DIR)
    },
    mysql: {
      enabledFlag: dbConfig.resolveConnectionConfig().enabled,
      checked: false
    }
  };

  if (deep || persistenceMode === 'mysql' || dbConfig.resolveConnectionConfig().enabled) {
    body.mysql = { ...(await pingMysql()), checked: true };
    if (persistenceMode === 'mysql' && !body.mysql.connected) {
      body.ok = false;
      body.error = 'Persistência MySQL ativa, mas o banco não responde.';
    }
  }

  return body;
}

module.exports = { getHealth, pingMysql };
