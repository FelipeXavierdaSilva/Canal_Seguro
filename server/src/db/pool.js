'use strict';

/**
 * Pool mysql2 compartilhado (Etapa 4).
 * Só cria conexão quando CS_DB_ENABLED (ou arquivo enabled) e credenciais ok.
 */

const dbConfig = require('../services/db-config.service');

let pool = null;

function wantsMysql() {
  const cfg = dbConfig.resolveConnectionConfig();
  return Boolean(cfg.enabled && cfg.host && cfg.user && cfg.database);
}

function getPoolConfig(options = {}) {
  const cfg = dbConfig.resolveConnectionConfig();
  if (!cfg.enabled && !options.allowDisabled) {
    const err = new Error('MySQL desabilitado (CS_DB_ENABLED≠1 / enabled=false).');
    err.code = 'MYSQL_DISABLED';
    throw err;
  }
  if (!cfg.host || !cfg.user || !cfg.database) {
    const err = new Error('MySQL incompleto: informe host, user e database.');
    err.code = 'MYSQL_CONFIG';
    throw err;
  }
  return {
    host: cfg.host,
    port: cfg.port || 3306,
    user: cfg.user,
    password: cfg.password || '',
    database: cfg.database,
    waitForConnections: true,
    connectionLimit: Number(process.env.CS_DB_POOL_SIZE) || 5,
    queueLimit: 0,
    enableKeepAlive: true
  };
}

async function getPool(options = {}) {
  if (pool && !options.forceNew) return pool;
  let mysql;
  try {
    mysql = require('mysql2/promise');
  } catch {
    const err = new Error('Pacote mysql2 não instalado. Execute: cd server && npm install mysql2');
    err.code = 'MYSQL2_MISSING';
    throw err;
  }
  if (pool && options.forceNew) {
    await endPool();
  }
  pool = mysql.createPool(getPoolConfig(options));
  const conn = await pool.getConnection();
  try {
    await conn.query('SELECT 1 AS ok');
  } finally {
    conn.release();
  }
  return pool;
}

async function endPool() {
  if (!pool) return;
  const p = pool;
  pool = null;
  await p.end();
}

function resetPoolForTests() {
  pool = null;
}

module.exports = {
  wantsMysql,
  getPool,
  endPool,
  resetPoolForTests,
  getPoolConfig
};
