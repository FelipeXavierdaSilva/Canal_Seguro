'use strict';

/**
 * Auditoria append-only — impede alteração ou remoção de entradas existentes.
 */
function assertAuditIntegrity(previousData, nextData) {
  if (!previousData || !nextData) return;

  const prevLogs = previousData.auditLogs || [];
  const nextById = new Map((nextData.auditLogs || []).map((log) => [log.id, log]));

  for (const prev of prevLogs) {
    if (!prev?.id) continue;
    const current = nextById.get(prev.id);
    if (!current) {
      /* Exceção estreita: logs de sessão (login/logout) podem ser apagados pelo Adm. */
      if (prev.action === 'login' || prev.action === 'logout') continue;
      const err = new Error('Remoção de registro de auditoria não permitida.');
      err.code = 'AUDIT_IMMUTABLE';
      throw err;
    }
    if (JSON.stringify(current) !== JSON.stringify(prev)) {
      const err = new Error('Alteração de registro de auditoria não permitida.');
      err.code = 'AUDIT_IMMUTABLE';
      throw err;
    }
  }
}

function appendAudit(data, entry) {
  const store = require('../store');
  data.auditLogs = data.auditLogs || [];
  data.auditLogs.unshift({
    id: store.uid('aud'),
    date: new Date().toISOString(),
    ...entry
  });
  return data.auditLogs[0];
}

module.exports = { assertAuditIntegrity, appendAudit };
