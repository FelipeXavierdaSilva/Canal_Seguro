'use strict';

/**
 * Credenciais MySQL para Hostinger.
 * Persistência: DATA_DIR/db-config.json (senha criptografada).
 * Variáveis CS_DB_* têm prioridade sobre o arquivo (ops / recuperação).
 * Não grava senha em store.json nem a devolve na API.
 */

const fs = require('fs');
const path = require('path');
const crypto = require('crypto');
const config = require('../config');

const CONFIG_FILE = 'db-config.json';
const DEFAULT_PORT = 3306;

function dataDir() {
  return config.DATA_DIR
    ? path.resolve(config.DATA_DIR)
    : path.join(__dirname, '..', '..', 'data');
}

function configPath() {
  return path.join(dataDir(), CONFIG_FILE);
}

function deriveKey() {
  const secret =
    process.env.CS_DB_CONFIG_KEY ||
    process.env.CS_JWT_SECRET ||
    config.JWT_SECRET ||
    'canal-seguro-dev-db-config-key';
  return crypto.createHash('sha256').update(String(secret)).digest();
}

function encryptPassword(plain) {
  if (plain == null || plain === '') return '';
  const iv = crypto.randomBytes(12);
  const cipher = crypto.createCipheriv('aes-256-gcm', deriveKey(), iv);
  const enc = Buffer.concat([cipher.update(String(plain), 'utf8'), cipher.final()]);
  const tag = cipher.getAuthTag();
  return `v1:${iv.toString('base64')}:${tag.toString('base64')}:${enc.toString('base64')}`;
}

function decryptPassword(blob) {
  if (!blob || typeof blob !== 'string') return '';
  if (!blob.startsWith('v1:')) return blob;
  const parts = blob.split(':');
  if (parts.length !== 4) return '';
  const [, ivB64, tagB64, dataB64] = parts;
  try {
    const decipher = crypto.createDecipheriv(
      'aes-256-gcm',
      deriveKey(),
      Buffer.from(ivB64, 'base64')
    );
    decipher.setAuthTag(Buffer.from(tagB64, 'base64'));
    return Buffer.concat([
      decipher.update(Buffer.from(dataB64, 'base64')),
      decipher.final()
    ]).toString('utf8');
  } catch {
    return '';
  }
}

function emptyFileConfig() {
  return {
    enabled: false,
    host: '',
    port: DEFAULT_PORT,
    user: '',
    passwordEnc: '',
    database: '',
    updatedAt: null
  };
}

function readFileConfig() {
  const p = configPath();
  if (!fs.existsSync(p)) return emptyFileConfig();
  try {
    const raw = JSON.parse(fs.readFileSync(p, 'utf8'));
    return {
      enabled: Boolean(raw.enabled),
      host: String(raw.host || '').trim(),
      port: Number(raw.port) || DEFAULT_PORT,
      user: String(raw.user || '').trim(),
      passwordEnc: String(raw.passwordEnc || ''),
      database: String(raw.database || '').trim(),
      updatedAt: raw.updatedAt || null
    };
  } catch {
    return emptyFileConfig();
  }
}

function writeFileConfig(cfg) {
  const dir = dataDir();
  if (!fs.existsSync(dir)) {
    fs.mkdirSync(dir, { recursive: true });
  }
  const payload = {
    enabled: Boolean(cfg.enabled),
    host: String(cfg.host || '').trim(),
    port: Number(cfg.port) || DEFAULT_PORT,
    user: String(cfg.user || '').trim(),
    passwordEnc: String(cfg.passwordEnc || ''),
    database: String(cfg.database || '').trim(),
    updatedAt: new Date().toISOString()
  };
  fs.writeFileSync(configPath(), JSON.stringify(payload, null, 2), { mode: 0o600 });
  return payload;
}

function envOverrideActive() {
  return Boolean(
    process.env.CS_DB_HOST ||
      process.env.CS_DB_USER ||
      process.env.CS_DB_NAME ||
      process.env.CS_DB_PASSWORD ||
      process.env.CS_DB_ENABLED
  );
}

/**
 * Credenciais efetivas (env > arquivo). Inclui senha em claro — só uso interno.
 */
function resolveConnectionConfig() {
  const file = readFileConfig();
  const fromEnv = envOverrideActive();

  const enabled = fromEnv
    ? process.env.CS_DB_ENABLED === '1' ||
      (process.env.CS_DB_ENABLED == null && file.enabled)
    : file.enabled;

  const host = (process.env.CS_DB_HOST || file.host || '').trim();
  const port = Number(process.env.CS_DB_PORT) || file.port || DEFAULT_PORT;
  const user = (process.env.CS_DB_USER || file.user || '').trim();
  const database = (process.env.CS_DB_NAME || file.database || '').trim();
  const password =
    process.env.CS_DB_PASSWORD != null && process.env.CS_DB_PASSWORD !== ''
      ? String(process.env.CS_DB_PASSWORD)
      : decryptPassword(file.passwordEnc);

  return {
    enabled: Boolean(enabled),
    host,
    port,
    user,
    password,
    database,
    source: fromEnv ? 'env' : 'file',
    hasPassword: Boolean(password),
    updatedAt: file.updatedAt
  };
}

/** Payload seguro para a UI (sem senha). */
function getPublicConfig() {
  const resolved = resolveConnectionConfig();
  const file = readFileConfig();
  let persistenceMode = 'json';
  let mysqlReady = false;
  try {
    const store = require('../store');
    if (typeof store.getPersistenceMode === 'function') {
      persistenceMode = store.getPersistenceMode();
      mysqlReady = persistenceMode === 'mysql';
    }
  } catch {
    /* store ainda não inicializado */
  }
  return {
    enabled: resolved.enabled,
    host: resolved.host,
    port: resolved.port,
    user: resolved.user,
    database: resolved.database,
    hasPassword: resolved.hasPassword,
    source: resolved.source,
    envOverridesActive: envOverrideActive(),
    persistenceMode,
    mysqlReady,
    note: mysqlReady
      ? 'Persistência ativa em MySQL (CS_DB_ENABLED). Anexos continuam em disco.'
      : resolved.enabled
        ? 'MySQL marcado como habilitado, mas o processo está em JSON (falha de conexão ou store.init pendente).'
        : 'Dados em store.json. Ative CS_DB_ENABLED=1 após migrate + import (Etapas 3–5).',
    updatedAt: file.updatedAt
  };
}

function getConfigForAdmin(actor) {
  if (!actor || actor.role !== 'superadmin') {
    return { ok: false, status: 403, error: 'Apenas Adm_Plataforma.' };
  }
  return { ok: true, data: getPublicConfig() };
}

function normalizePort(value) {
  const n = Number(value);
  if (!Number.isFinite(n) || n < 1 || n > 65535) return DEFAULT_PORT;
  return Math.floor(n);
}

function updateConfigForAdmin(actor, body = {}) {
  if (!actor || actor.role !== 'superadmin') {
    return { ok: false, status: 403, error: 'Apenas Adm_Plataforma.' };
  }

  const current = readFileConfig();
  const next = {
    enabled: body.enabled != null ? Boolean(body.enabled) : current.enabled,
    host: body.host != null ? String(body.host).trim() : current.host,
    port: body.port != null ? normalizePort(body.port) : current.port,
    user: body.user != null ? String(body.user).trim() : current.user,
    database: body.database != null ? String(body.database).trim() : current.database,
    passwordEnc: current.passwordEnc
  };

  if (body.password != null && String(body.password) !== '') {
    next.passwordEnc = encryptPassword(String(body.password));
  }
  if (body.clearPassword === true) {
    next.passwordEnc = '';
  }

  writeFileConfig(next);
  return { ok: true, data: getPublicConfig() };
}

async function testConnection(connectionOverride = null) {
  let mysql;
  try {
    mysql = require('mysql2/promise');
  } catch {
    return {
      ok: false,
      status: 503,
      error: 'Pacote mysql2 não instalado. Execute: cd server && npm install mysql2'
    };
  }

  const base = connectionOverride || resolveConnectionConfig();
  if (!base.host || !base.user || !base.database) {
    return {
      ok: false,
      status: 400,
      error: 'Informe host, usuário e nome do banco antes de testar.'
    };
  }

  let conn;
  try {
    conn = await mysql.createConnection({
      host: base.host,
      port: base.port || DEFAULT_PORT,
      user: base.user,
      password: base.password || '',
      database: base.database,
      connectTimeout: 8000
    });
    const [rows] = await conn.query('SELECT 1 AS ok');
    const ok = Array.isArray(rows) && rows[0] && Number(rows[0].ok) === 1;
    return {
      ok: true,
      data: {
        connected: Boolean(ok),
        host: base.host,
        port: base.port || DEFAULT_PORT,
        database: base.database,
        message: 'Conexão MySQL bem-sucedida.'
      }
    };
  } catch (err) {
    return {
      ok: false,
      status: 400,
      error: err && err.message ? `Falha na conexão: ${err.message}` : 'Falha na conexão MySQL.'
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

async function testConnectionForAdmin(actor, body = {}) {
  if (!actor || actor.role !== 'superadmin') {
    return { ok: false, status: 403, error: 'Apenas Adm_Plataforma.' };
  }

  const saved = resolveConnectionConfig();
  const override = {
    host: body.host != null ? String(body.host).trim() : saved.host,
    port: body.port != null ? normalizePort(body.port) : saved.port,
    user: body.user != null ? String(body.user).trim() : saved.user,
    database: body.database != null ? String(body.database).trim() : saved.database,
    password:
      body.password != null && String(body.password) !== ''
        ? String(body.password)
        : saved.password
  };

  return testConnection(override);
}

module.exports = {
  CONFIG_FILE,
  getConfigForAdmin,
  updateConfigForAdmin,
  testConnectionForAdmin,
  resolveConnectionConfig,
  getPublicConfig,
  encryptPassword,
  decryptPassword,
  readFileConfig,
  writeFileConfig,
  configPath
};
