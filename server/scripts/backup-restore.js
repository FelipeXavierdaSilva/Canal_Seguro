'use strict';

/**
 * CLI: restaura um backup operacional (ou o mais recente).
 * Uso:
 *   node scripts/backup-restore.js
 *   node scripts/backup-restore.js bkp_2026-09-17T...
 *   node scripts/backup-restore.js --latest
 */

const path = require('path');

process.chdir(path.join(__dirname, '..'));

const backup = require('../src/services/backup.service');

const arg = String(process.argv[2] || '--latest').trim();
const actor = {
  id: 'cli_restore',
  role: 'superadmin',
  nome: 'CLI Restore',
  email: 'cli@local'
};

const result =
  !arg || arg === '--latest' || arg === 'latest'
    ? backup.restoreLatest(actor, { confirm: true })
    : backup.restoreBackup(actor, arg, { confirm: true });

if (!result.ok) {
  console.error('Falha:', result.error || result);
  process.exit(1);
}

console.log(JSON.stringify(result.data, null, 2));
console.log('\nRestauração concluída. Reinicie o servidor se estiver em execução.');
