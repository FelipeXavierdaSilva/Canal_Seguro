'use strict';

/**
 * CLI: aplica migrations MySQL (Etapa 3).
 * Uso:
 *   npm run db:migrate
 *   npm run db:migrate -- --dry-run
 *
 * Credenciais: CS_DB_* ou Configurações → Banco de dados (db-config.json).
 * Não liga o store.js ao MySQL.
 */

const { runMigrations, listMigrationFiles } = require('../src/db/migrate');

async function main() {
  const dryRun = process.argv.includes('--dry-run');
  const files = listMigrationFiles();
  console.log(`Migrations encontradas (${files.length}):`);
  files.forEach((f) => console.log(`  - ${f}`));

  const result = await runMigrations({ dryRun });
  if (!result.ok) {
    console.error('Falha:', result.error || 'erro desconhecido');
    process.exitCode = 1;
    return;
  }

  if (result.dryRun) {
    console.log('Dry-run OK. Pendentes:', (result.pending || []).join(', ') || '(nenhuma)');
    if (result.target) {
      console.log(`Alvo: ${result.target.host}:${result.target.port}/${result.target.database}`);
    } else {
      console.log('MySQL ainda não configurado (CS_DB_* ou Configurações → Banco de dados).');
    }
    return;
  }

  console.log(`Aplicadas: ${result.applied.length ? result.applied.join(', ') : '(nenhuma)'}`);
  console.log(`Já aplicadas (skip): ${result.skipped.length ? result.skipped.join(', ') : '(nenhuma)'}`);
  if (result.target) {
    console.log(`Banco: ${result.target.host}:${result.target.port}/${result.target.database}`);
  }
  console.log('Schema MySQL atualizado.');
}

main().catch((err) => {
  console.error(err);
  process.exitCode = 1;
});
