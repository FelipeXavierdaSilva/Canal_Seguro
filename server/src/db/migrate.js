'use strict';

/**
 * Runner de migrations MySQL (Etapa 3).
 * Não altera store.js — apenas cria/atualiza o schema no banco configurado.
 */

const fs = require('fs');
const path = require('path');
const dbConfig = require('../services/db-config.service');

const MIGRATIONS_DIR = path.join(__dirname, 'migrations');

function listMigrationFiles() {
  if (!fs.existsSync(MIGRATIONS_DIR)) return [];
  return fs
    .readdirSync(MIGRATIONS_DIR)
    .filter((f) => /^\d+_[\w-]+\.sql$/i.test(f))
    .sort();
}

function splitStatements(sql) {
  const lines = String(sql || '')
    .split(/\r?\n/)
    .filter((line) => {
      const t = line.trim();
      return t && !t.startsWith('--');
    });
  const cleaned = lines.join('\n');
  return cleaned
    .split(';')
    .map((s) => s.trim())
    .filter(Boolean);
}

async function createConnection(cfg) {
  let mysql;
  try {
    mysql = require('mysql2/promise');
  } catch {
    const err = new Error('Pacote mysql2 não instalado. Execute: cd server && npm install mysql2');
    err.code = 'MYSQL2_MISSING';
    throw err;
  }
  return mysql.createConnection({
    host: cfg.host,
    port: cfg.port || 3306,
    user: cfg.user,
    password: cfg.password || '',
    database: cfg.database,
    multipleStatements: false,
    connectTimeout: 15000
  });
}

async function ensureMigrationsTable(conn) {
  await conn.query(`
    CREATE TABLE IF NOT EXISTS schema_migrations (
      id INT UNSIGNED NOT NULL AUTO_INCREMENT,
      name VARCHAR(255) NOT NULL,
      applied_at DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
      PRIMARY KEY (id),
      UNIQUE KEY uq_schema_migrations_name (name)
    ) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci
  `);
}

async function appliedMigrations(conn) {
  const [rows] = await conn.query('SELECT name FROM schema_migrations ORDER BY name ASC');
  return new Set((rows || []).map((r) => r.name));
}

/**
 * @param {object} [options]
 * @param {boolean} [options.dryRun]
 * @param {object} [options.connection] override de resolveConnectionConfig()
 * @returns {Promise<{ok:boolean, applied:string[], skipped:string[], dryRun?:boolean, error?:string}>}
 */
async function runMigrations(options = {}) {
  const files = listMigrationFiles();
  if (!files.length) {
    return { ok: false, applied: [], skipped: [], error: 'Nenhum arquivo em src/db/migrations.' };
  }

  if (options.dryRun) {
    const cfg = options.connection || dbConfig.resolveConnectionConfig();
    const configured = Boolean(cfg.host && cfg.user && cfg.database);
    return {
      ok: true,
      dryRun: true,
      applied: [],
      skipped: [],
      pending: files,
      configured,
      target: configured
        ? { host: cfg.host, port: cfg.port, database: cfg.database }
        : null
    };
  }

  const cfg = options.connection || dbConfig.resolveConnectionConfig();
  if (!cfg.host || !cfg.user || !cfg.database) {
    return {
      ok: false,
      applied: [],
      skipped: [],
      error:
        'MySQL não configurado. Defina CS_DB_* ou salve em Configurações → Banco de dados (host, user, database).'
    };
  }

  let conn;
  try {
    conn = await createConnection(cfg);
    await ensureMigrationsTable(conn);
    const done = await appliedMigrations(conn);
    const applied = [];
    const skipped = [];

    for (const file of files) {
      if (done.has(file)) {
        skipped.push(file);
        continue;
      }
      const full = path.join(MIGRATIONS_DIR, file);
      const sql = fs.readFileSync(full, 'utf8');
      const statements = splitStatements(sql);
      await conn.beginTransaction();
      try {
        for (const stmt of statements) {
          await conn.query(stmt);
        }
        await conn.query('INSERT INTO schema_migrations (name) VALUES (?)', [file]);
        await conn.commit();
        applied.push(file);
      } catch (err) {
        await conn.rollback();
        throw err;
      }
    }

    return {
      ok: true,
      applied,
      skipped,
      target: { host: cfg.host, port: cfg.port, database: cfg.database }
    };
  } catch (err) {
    return {
      ok: false,
      applied: [],
      skipped: [],
      error: err && err.message ? err.message : String(err)
    };
  } finally {
    if (conn) {
      try {
        await conn.end();
      } catch {
        /* ignore */
      }
    }
  }
}

module.exports = {
  MIGRATIONS_DIR,
  listMigrationFiles,
  splitStatements,
  runMigrations
};
