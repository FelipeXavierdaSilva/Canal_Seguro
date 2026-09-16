'use strict';

/**
 * Recalcula storageUsedBytes de todas as empresas (anexos status=stored).
 * Uso: node scripts/recalculate-storage.js
 *      npm run recalc-storage
 */
const path = require('path');

process.chdir(path.join(__dirname, '..'));

const companyStorage = require('../src/services/company-storage.service');

const result = companyStorage.recalculateAllCompanyStorage();
if (!result.ok) {
  console.error('Falha ao recalcular storage.');
  process.exit(1);
}

console.log('Recálculo de storage concluído:');
for (const row of result.companies) {
  console.log(
    `  ${row.companyId}: used=${row.storageUsedBytes} / limit=${row.storageLimitBytes}`
  );
}
