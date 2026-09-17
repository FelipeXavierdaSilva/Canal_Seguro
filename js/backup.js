/**
 * backup.js – Backup e recuperação (Canal Seguro).
 *
 * Com API servidor: backup operacional completo (store.json + anexos).
 * Sem API: snapshot DEV no localStorage (não substitui backup de produção).
 *
 * Ver docs/BACKUP-RECOVERY.md
 */

const CSBackup = (() => {
  const API_VERSION = 'v1';
  /** Alinhado a `_meta.version` do store (seed / migrações). */
  const SCHEMA_VERSION = 16;

  const BACKEND_REQUIRED = {
    ok: false,
    code: 'backend_required',
    message:
      'Backup operacional exige o servidor da API. Inicie o backend (cd server && npm start) e recarregue o painel.'
  };

  /** Política alvo / operacional exibida no painel. */
  const PRODUCTION_POLICY = {
    apiVersion: API_VERSION,
    schemaVersion: SCHEMA_VERSION,
    schedules: {
      fullDaily: 'Manual / antes de cada atualização',
      incrementalDb: 'N/A (store JSON)',
      attachmentsSync: 'Incluídos no backup full'
    },
    retention: {
      dailyFullDays: 30,
      weeklyFullWeeks: 12,
      monthlyArchiveMonths: 12,
      walDays: null
    },
    storage: {
      primary: 'server/data/backups/',
      replica: 'Copie a pasta backups/ para off-site',
      encryption: 'Criptografe o volume / cópia off-site',
      publicAccess: false
    },
    verification: {
      postBackupChecksum: true,
      monthlyRestoreTest: true,
      stagingEnvironment: true
    }
  };

  const STORE_KEYS = [
    'companies',
    'users',
    'employees',
    'reports',
    'reportHistory',
    'reportMessages',
    'reportRiskHistory',
    'reportWorkflowHistory',
    'contents',
    'notifications',
    'auditLogs',
    'techLogs',
    'platformSettings',
    'companySettings',
    'categories',
    'statuses',
    'supportFaqs',
    'platformSupportThreads',
    'platformInternalSupportThreads',
    'storageUpgradeRequests',
    '_meta'
  ];

  const EXCLUDED_KEYS = new Set([
    'passwordResetTokens',
    'emailQueue',
    'emailDeliveryLogs',
    'emailDedupeKeys',
    'emailSuppressions',
    'mfaSecrets',
    'sessions'
  ]);

  const ENTITY_LABELS = {
    companies: 'Empresas (dados e branding do canal)',
    users: 'Usuários e perfis',
    employees: 'Colaboradores',
    reports: 'Relatos',
    reportHistory: 'Histórico de relatos',
    reportMessages: 'Mensagens dos relatos',
    reportRiskHistory: 'Classificação de risco',
    reportWorkflowHistory: 'Workflow de apuração',
    contents: 'Conteúdos (FAQ, Informação e Prevenção, artigos)',
    notifications: 'Notificações',
    auditLogs: 'Auditoria funcional',
    techLogs: 'Logs técnicos',
    platformSettings: 'Configurações da plataforma',
    companySettings: 'Configurações por empresa (protocolo, workflow, e-mail, risco)',
    categories: 'Categorias de relato',
    statuses: 'Status de relato',
    supportFaqs: 'FAQ do Assistente Virtual',
    platformSupportThreads: 'Suporte técnico (empresas)',
    platformInternalSupportThreads: 'Atendimento interno',
    storageUpgradeRequests: 'Solicitações de armazenamento'
  };

  function useHttpBackup() {
    return typeof CSHttpApi !== 'undefined' && typeof CSHttpApi.enabled === 'function' && CSHttpApi.enabled();
  }

  function isBackendConnected() {
    return useHttpBackup() || Boolean(window.CS_BACKUP_API_BASE);
  }

  function assertSuperadmin(actor) {
    if (!actor || actor.role !== 'superadmin') {
      throw new Error('Operação restrita ao administrador da plataforma.');
    }
  }

  function resolveActor(actor) {
    if (actor && actor.id) return actor;
    if (typeof CSAuth !== 'undefined') {
      const s = CSAuth.getSession();
      if (s) return s;
    }
    return actor || {};
  }

  function logTechnicalEvent(action, actor = {}, details = {}) {
    if (typeof CSInfraLog === 'undefined' || typeof window.CSStore === 'undefined') return null;
    return CSInfraLog.application(action, {
      severity: details.severity || 'info',
      outcome: details.outcome || (details.ok === false ? 'failure' : 'success'),
      actor,
      context: {
        mode: isBackendConnected() ? 'operational' : 'prototype',
        backupId: details.backupId || null,
        snapshotId: details.snapshotId || null,
        reason: details.reason || null,
        errorCode: details.errorCode || null
      }
    });
  }

  async function delay(ms = 80) {
    return new Promise((r) => setTimeout(r, ms));
  }

  function listIncludedKeys(data) {
    const keys = [...STORE_KEYS];
    if (data && typeof data === 'object') {
      Object.keys(data).forEach((key) => {
        if (EXCLUDED_KEYS.has(key)) return;
        if (!keys.includes(key)) keys.push(key);
      });
    }
    return keys;
  }

  function collectSnapshotData(data) {
    const keys = listIncludedKeys(data);
    return keys.reduce((out, key) => {
      if (EXCLUDED_KEYS.has(key)) return out;
      if (data[key] !== undefined) out[key] = data[key];
      return out;
    }, {});
  }

  function countEntity(val) {
    if (Array.isArray(val)) return val.length;
    if (val && typeof val === 'object') return Object.keys(val).length || 1;
    return val ? 1 : 0;
  }

  async function getPolicy() {
    if (useHttpBackup()) {
      const status = await CSHttpApi.getBackupStatus();
      return status.policy || { ...PRODUCTION_POLICY, backendConnected: true };
    }
    await delay();
    return { ...PRODUCTION_POLICY, backendConnected: false };
  }

  async function getStatus() {
    if (useHttpBackup()) {
      return CSHttpApi.getBackupStatus();
    }
    await delay();
    const policy = await getPolicy();
    const data = typeof window.CSStore !== 'undefined' ? window.CSStore.loadStore() : null;
    const includedKeys = listIncludedKeys(data || {}).filter((k) => k !== '_meta');
    return {
      ok: true,
      mode: 'prototype',
      backendConnected: false,
      message:
        'API offline: apenas snapshot DEV do navegador. Com o servidor ligado, o backup operacional restaura store + anexos após atualizações.',
      policy,
      storeMeta: data?._meta || null,
      includedEntities: includedKeys,
      includedEntityLabels: includedKeys.map((k) => ENTITY_LABELS[k] || k),
      adminEditableNote:
        'Inclui tudo editável no painel (empresas, usuários, colaboradores, relatos, conteúdos FAQ/educação, configurações e auditoria).',
      attachmentsNote:
        'No modo protótipo: só metadados. Com servidor: binários de anexos entram no backup.',
      lastBackup: null,
      backupCount: 0
    };
  }

  async function listBackups() {
    if (useHttpBackup()) {
      return CSHttpApi.listBackups();
    }
    await delay();
    return { ...BACKEND_REQUIRED, items: [] };
  }

  async function getBackup(backupId) {
    if (!backupId) throw new Error('ID do backup não informado.');
    if (useHttpBackup()) {
      return CSHttpApi.getBackup(backupId);
    }
    await delay();
    return BACKEND_REQUIRED;
  }

  async function triggerBackup(actor = {}, options = {}) {
    const a = resolveActor(actor);
    assertSuperadmin(a);
    if (useHttpBackup()) {
      const created = await CSHttpApi.createBackup({ note: options.note || null });
      logTechnicalEvent('backup_concluido', a, { backupId: created.id, ok: true });
      return { ok: true, ...created };
    }
    await delay();
    logTechnicalEvent('backup_falhou', a, {
      reason: 'backend_required',
      errorCode: 'backend_unavailable'
    });
    return BACKEND_REQUIRED;
  }

  async function verifyBackup(backupId, actor = {}) {
    const a = resolveActor(actor);
    assertSuperadmin(a);
    if (useHttpBackup()) {
      return CSHttpApi.verifyBackup(backupId);
    }
    await delay();
    logTechnicalEvent('backup_verificacao_falhou', a, { backupId, reason: 'backend_required' });
    return BACKEND_REQUIRED;
  }

  async function restoreBackup(backupId, actor = {}, options = {}) {
    const a = resolveActor(actor);
    assertSuperadmin(a);
    if (useHttpBackup()) {
      const result = await CSHttpApi.restoreBackup(backupId, {
        confirm: options.confirm !== false,
        skipSafetyBackup: Boolean(options.skipSafetyBackup)
      });
      logTechnicalEvent('restore_concluido', a, { backupId, ok: true });
      return result;
    }
    await delay();
    logTechnicalEvent('restore_falhou', a, { backupId, reason: 'backend_required' });
    return BACKEND_REQUIRED;
  }

  async function restoreLatestBackup(actor = {}, options = {}) {
    const a = resolveActor(actor);
    assertSuperadmin(a);
    if (useHttpBackup()) {
      return CSHttpApi.restoreLatestBackup({
        confirm: options.confirm !== false,
        skipSafetyBackup: Boolean(options.skipSafetyBackup)
      });
    }
    await delay();
    return BACKEND_REQUIRED;
  }

  function buildDevManifest(data, snapshotData) {
    const counts = {};
    Object.keys(snapshotData).forEach((key) => {
      if (key === '_meta') {
        counts._meta = snapshotData._meta?.version ?? null;
        return;
      }
      counts[key] = countEntity(snapshotData[key]);
    });
    return {
      type: 'dev_snapshot',
      warning: 'DEV ONLY — Não usar como backup de produção. Sem criptografia off-site.',
      exportedAt: new Date().toISOString(),
      schemaVersion: data._meta?.version ?? SCHEMA_VERSION,
      contractSchemaVersion: SCHEMA_VERSION,
      includedKeys: Object.keys(snapshotData),
      entityCounts: counts,
      coversAdminEdits: true
    };
  }

  async function exportDevSnapshot(actor = {}) {
    await delay(150);
    const a = resolveActor(actor);
    assertSuperadmin(a);
    if (typeof window.CSStore === 'undefined') {
      throw new Error('Store indisponível.');
    }
    const data = window.CSStore.loadStore();
    const snapshotId = `dev_${Date.now().toString(36)}`;
    const snapshotData = collectSnapshotData(data);
    const manifest = buildDevManifest(data, snapshotData);
    const payload = {
      manifest,
      data: snapshotData
    };
    logTechnicalEvent('backup_export_dev', a, {
      snapshotId,
      schemaVersion: manifest.schemaVersion,
      entityCounts: manifest.entityCounts
    });
    return {
      ok: true,
      snapshotId,
      filename: `canal-seguro-DEV-SNAPSHOT-${manifest.exportedAt.replace(/[:.]/g, '-')}.json`,
      payload,
      message:
        'Snapshot DEV exportado. Para atualização em produção, use o backup operacional do servidor (Gerar backup).'
    };
  }

  function downloadDevSnapshot(result) {
    if (!result?.ok || !result.payload) throw new Error('Snapshot inválido.');
    const blob = new Blob([JSON.stringify(result.payload, null, 2)], { type: 'application/json' });
    const a = document.createElement('a');
    a.href = URL.createObjectURL(blob);
    a.download = result.filename;
    a.click();
    URL.revokeObjectURL(a.href);
  }

  async function importDevSnapshot(payload, actor = {}) {
    await delay(150);
    const a = resolveActor(actor);
    assertSuperadmin(a);
    if (typeof window.CSStore === 'undefined') {
      throw new Error('Store indisponível.');
    }
    if (!payload || typeof payload !== 'object') {
      throw new Error('Arquivo de snapshot inválido.');
    }
    const manifest = payload.manifest || {};
    const incoming = payload.data;
    if (manifest.type && manifest.type !== 'dev_snapshot') {
      throw new Error('Tipo de arquivo não suportado. Use um snapshot DEV exportado por este sistema.');
    }
    if (!incoming || typeof incoming !== 'object') {
      throw new Error('Snapshot sem dados.');
    }

    const current = window.CSStore.loadStore();
    const next = { ...current };

    Object.keys(incoming).forEach((key) => {
      if (EXCLUDED_KEYS.has(key)) return;
      next[key] = incoming[key];
    });

    STORE_KEYS.forEach((key) => {
      if (key === '_meta') return;
      if (next[key] === undefined) {
        if (key === 'platformSettings' || key === 'companySettings') next[key] = next[key] || {};
        else next[key] = [];
      }
    });

    next._meta = {
      ...(next._meta || {}),
      ...(incoming._meta || {}),
      restoredFromDevSnapshotAt: new Date().toISOString(),
      restoredByUserId: a.id || null
    };

    window.CSStore.saveStore(next);
    logTechnicalEvent('backup_import_dev', a, {
      snapshotId: manifest.exportedAt || null,
      schemaVersion: next._meta?.version ?? null,
      outcome: 'success'
    });

    return {
      ok: true,
      message: 'Snapshot DEV restaurado. Recarregue a página para aplicar em todas as telas.',
      schemaVersion: next._meta?.version ?? null,
      includedKeys: Object.keys(incoming).filter((k) => !EXCLUDED_KEYS.has(k))
    };
  }

  return {
    API_VERSION,
    SCHEMA_VERSION,
    STORE_KEYS,
    ENTITY_LABELS,
    PRODUCTION_POLICY,
    BACKEND_REQUIRED,
    getPolicy,
    getStatus,
    listBackups,
    getBackup,
    triggerBackup,
    verifyBackup,
    restoreBackup,
    restoreLatestBackup,
    exportDevSnapshot,
    downloadDevSnapshot,
    importDevSnapshot,
    logTechnicalEvent
  };
})();

window.CSBackup = CSBackup;
