'use strict';

const { describe, it } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('fs');
const path = require('path');
const { listMigrationFiles, splitStatements, runMigrations, MIGRATIONS_DIR } = require('../src/db/migrate');

const STORE_KEYS_EXPECTED_TABLES = [
  'store_meta',
  'store_flags',
  'platform_settings',
  'company_settings',
  'companies',
  'users',
  'employees',
  'reports',
  'report_history',
  'report_messages',
  'report_risk_history',
  'report_workflow_history',
  'contents',
  'notifications',
  'audit_logs',
  'tech_logs',
  'categories',
  'statuses',
  'support_faqs',
  'platform_support_threads',
  'storage_upgrade_requests',
  'password_reset_tokens',
  'email_queue',
  'email_delivery_logs',
  'email_dedupe_keys',
  'email_suppressions',
  'schema_migrations'
];

describe('db migrate (Etapa 3 schema)', () => {
  it('lista migrations numeradas em ordem', () => {
    const files = listMigrationFiles();
    assert.ok(files.length >= 1);
    assert.equal(files[0], '001_initial_schema.sql');
    const sorted = [...files].sort();
    assert.deepEqual(files, sorted);
  });

  it('001 cobre as chaves principais do store', () => {
    const sql = fs.readFileSync(path.join(MIGRATIONS_DIR, '001_initial_schema.sql'), 'utf8');
    for (const table of STORE_KEYS_EXPECTED_TABLES) {
      assert.match(
        sql,
        new RegExp(`CREATE TABLE IF NOT EXISTS ${table}\\b`, 'i'),
        `faltou tabela ${table}`
      );
    }
    assert.match(sql, /\bpayload JSON\b/i);
  });

  it('splitStatements remove comentários e parte por ;', () => {
    const stmts = splitStatements(`
      -- comentario
      CREATE TABLE a (id INT);
      CREATE TABLE b (id INT);
    `);
    assert.equal(stmts.length, 2);
    assert.ok(stmts[0].includes('CREATE TABLE a'));
    assert.ok(stmts[1].includes('CREATE TABLE b'));
  });

  it('dry-run não exige MySQL se credenciais ausentes retorna erro claro', async () => {
    const prev = {
      host: process.env.CS_DB_HOST,
      user: process.env.CS_DB_USER,
      name: process.env.CS_DB_NAME,
      pass: process.env.CS_DB_PASSWORD,
      enabled: process.env.CS_DB_ENABLED
    };
    delete process.env.CS_DB_HOST;
    delete process.env.CS_DB_USER;
    delete process.env.CS_DB_NAME;
    delete process.env.CS_DB_PASSWORD;
    delete process.env.CS_DB_ENABLED;

    try {
      const dry = await runMigrations({
        dryRun: true,
        connection: { host: 'h', user: 'u', database: 'd', port: 3306, password: '' }
      });
      assert.equal(dry.ok, true);
      assert.equal(dry.dryRun, true);
      assert.ok(dry.pending.includes('001_initial_schema.sql'));

      const missing = await runMigrations({
        dryRun: false,
        connection: { host: '', user: '', database: '', password: '' }
      });
      assert.equal(missing.ok, false);
      assert.match(missing.error || '', /não configurado/i);
    } finally {
      if (prev.host != null) process.env.CS_DB_HOST = prev.host;
      else delete process.env.CS_DB_HOST;
      if (prev.user != null) process.env.CS_DB_USER = prev.user;
      else delete process.env.CS_DB_USER;
      if (prev.name != null) process.env.CS_DB_NAME = prev.name;
      else delete process.env.CS_DB_NAME;
      if (prev.pass != null) process.env.CS_DB_PASSWORD = prev.pass;
      else delete process.env.CS_DB_PASSWORD;
      if (prev.enabled != null) process.env.CS_DB_ENABLED = prev.enabled;
      else delete process.env.CS_DB_ENABLED;
    }
  });
});
