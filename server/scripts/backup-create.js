'use strict';

/**
 * CLI: cria backup operacional completo (store + anexos).
 * Uso: node scripts/backup-create.js ["nota opcional"]
 */

const path = require('path');

process.chdir(path.join(__dirname, '..'));

const backup = require('../src/services/backup.service');

const note = process.argv.slice(2).join(' ').trim() || 'Backup CLI';
const actor = {
  id: 'cli_backup',
  role: 'superadmin',
  nome: 'CLI Backup',
  email: 'cli@local'
};

const result = backup.createBackup(actor, { note });
if (!result.ok) {
  console.error('Falha:', result.error || result);
  process.exit(1);
}

console.log(JSON.stringify(result.data, null, 2));
console.log(`\nBackup criado: ${result.data.id}`);
console.log(`Pasta: ${backup.backupsRoot()}\\${result.data.id}`);
