'use strict';

/**
 * CLI: importa store.json → MySQL (Etapa 5).
 *
 * Uso:
 *   npm run db:import-json
 *   npm run db:import-json -- --dry-run
 *   npm run db:import-json -- --file=./data/store.json
 *   npm run db:import-json -- --no-migrate
 *
 * Idempotente: reexecutar com o mesmo JSON substitui as tabelas pelo mesmo snapshot.
 *
 * Rollback do app (voltar a usar JSON):
 *   CS_DB_ENABLED=0  (ou enabled=false em Configurações) e reiniciar o Node.
 *   O arquivo store.json / CS_DATA_DIR permanece; anexos em disco não são alterados.
 */

const path = require('path');
const { importJsonToMysql } = require('../src/db/import-json');

function parseArgs(argv) {
  const opts = { dryRun: false, migrate: true, file: undefined };
  for (const arg of argv) {
    if (arg === '--dry-run') opts.dryRun = true;
    else if (arg === '--no-migrate') opts.migrate = false;
    else if (arg.startsWith('--file=')) opts.file = arg.slice('--file='.length);
  }
  return opts;
}

async function main() {
  const opts = parseArgs(process.argv.slice(2));
  console.log('Import store.json → MySQL (Etapa 5)');
  if (opts.file) console.log(`Arquivo: ${path.resolve(opts.file)}`);
  if (opts.dryRun) console.log('Modo: dry-run (sem gravar)');
  if (!opts.migrate) console.log('Migrations: puladas (--no-migrate)');

  const result = await importJsonToMysql(opts);
  if (!result.ok) {
    console.error('Falha:', result.error || 'erro desconhecido');
    process.exitCode = 1;
    return;
  }

  if (result.target) {
    console.log(`Alvo: ${result.target.host}:${result.target.port}/${result.target.database}`);
  }
  if (result.file) console.log(`Origem: ${result.file}`);
  const s = result.summary || {};
  console.log(
    `Resumo: users=${s.users} companies=${s.companies} reports=${s.reports} employees=${s.employees} faqs=${s.supportFaqs}`
  );

  if (result.dryRun) {
    console.log(result.note || 'Dry-run OK.');
    return;
  }

  if (result.verified) {
    console.log(
      `Verificado no MySQL: users=${result.verified.users} companies=${result.verified.companies} reports=${result.verified.reports}`
    );
  }
  console.log(result.note || 'Import OK.');
  console.log('');
  console.log('Próximos passos:');
  console.log('  1) CS_DB_ENABLED=1 no ambiente Hostinger');
  console.log('  2) Reiniciar o app Node');
  console.log('Rollback: CS_DB_ENABLED=0 e reiniciar (volta a ler store.json).');
}

main().catch((err) => {
  console.error(err);
  process.exitCode = 1;
});
