/**
 * backup.js – Contrato de backup e recuperação (Canal Seguro).
 *
 * Produção: jobs no servidor, storage off-site criptografado, API REST.
 * Protótipo: stubs honestos + export/import DEV rotulado (superadmin) — NÃO substitui backup real.
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
      'Backup e restauração de produção exigem backend, banco de dados e armazenamento off-site. Não disponível no protótipo localStorage.'
  };

  /** Política alvo documentada — aplicada pelo backend quando integrado. */
  const PRODUCTION_POLICY = {
    apiVersion: API_VERSION,
    schemaVersion: SCHEMA_VERSION,
    schedules: {
      fullDaily: '02:00 UTC',
      incrementalDb: 'WAL / PITR contínuo (PostgreSQL)',
      attachmentsSync: 'Após cada upload + delta diário'
    },
    retention: {
      dailyFullDays: 30,
      weeklyFullWeeks: 12,
      monthlyArchiveMonths: 12,
      walDays: 14
    },
    storage: {
      primary: 'Object storage privado (ex.: S3 sa-east-1)',
      replica: 'Cross-region (ex.: us-east-1)',
      encryption: 'SSE-KMS + TLS',
      publicAccess: false
    },
    verification: {
      postBackupChecksum: true,
      monthlyRestoreTest: true,
      stagingEnvironment: true
    }
  };

  /**
   * Coleções do store incluídas no snapshot (painel admin + operação).
   * Ordem estável para manifesto / UI.
   */
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
    '_meta'
  ];

  /** Chaves efêmeras / sensíveis de servidor — nunca no snapshot DEV do browser. */
  const EXCLUDED_KEYS = new Set([
    'passwordResetTokens',
    'emailQueue',
    'emailDeliveryLogs',
    'emailDedupeKeys',
    'emailSuppressions',
    'mfaSecrets',
    'sessions'
  ]);

  /** Rótulos para o painel (o que o admin edita / opera). */
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
    statuses: 'Status de relato'
  };

  function isBackendConnected() {
    return Boolean(window.CS_BACKUP_API_BASE);
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

  /** Registra evento técnico de backup (techLogs — não auditoria funcional). */
  function logTechnicalEvent(action, actor = {}, details = {}) {
    if (typeof CSInfraLog === 'undefined' || typeof window.CSStore === 'undefined') return null;
    return CSInfraLog.application(action, {
      severity: details.severity || 'info',
      outcome: details.outcome || (details.ok === false ? 'failure' : 'success'),
      actor,
      context: {
        mode: isBackendConnected() ? 'production' : 'prototype',
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
    await delay();
    return { ...PRODUCTION_POLICY, backendConnected: isBackendConnected() };
  }

  async function getStatus() {
    await delay();
    const policy = await getPolicy();
    const data = typeof window.CSStore !== 'undefined' ? window.CSStore.loadStore() : null;
    const includedKeys = listIncludedKeys(data || {}).filter((k) => k !== '_meta');
    return {
      ok: true,
      mode: isBackendConnected() ? 'production' : 'prototype',
      backendConnected: isBackendConnected(),
      message: isBackendConnected()
        ? 'Backend de backup conectado.'
        : 'Protótipo: backup automático desativado. Consulte docs/BACKUP-RECOVERY.md.',
      policy,
      storeMeta: data?._meta || null,
      includedEntities: includedKeys,
      includedEntityLabels: includedKeys.map((k) => ENTITY_LABELS[k] || k),
      adminEditableNote:
        'Inclui tudo editável no painel (empresas, usuários, colaboradores, relatos, conteúdos FAQ/educação, configurações e auditoria).',
      attachmentsNote:
        'Metadados de anexos no store; binários exigem object storage separado em produção.'
    };
  }

  async function listBackups() {
    await delay();
    if (isBackendConnected()) {
      throw new Error('Integração GET /api/v1/admin/backups pendente de implementação no backend.');
    }
    return { ...BACKEND_REQUIRED, items: [] };
  }

  async function getBackup(backupId) {
    await delay();
    if (!backupId) throw new Error('ID do backup não informado.');
    return BACKEND_REQUIRED;
  }

  async function triggerBackup(actor = {}) {
    await delay();
    assertSuperadmin(resolveActor(actor));
    if (!isBackendConnected()) {
      logTechnicalEvent('backup_falhou', actor, {
        reason: 'backend_required',
        errorCode: 'backend_unavailable'
      });
      return BACKEND_REQUIRED;
    }
    throw new Error('Integração POST /api/v1/admin/backups pendente no backend.');
  }

  async function verifyBackup(backupId, actor = {}) {
    await delay();
    assertSuperadmin(resolveActor(actor));
    if (!isBackendConnected()) {
      logTechnicalEvent('backup_verificacao_falhou', actor, { backupId, reason: 'backend_required' });
      return BACKEND_REQUIRED;
    }
    throw new Error('Integração POST /api/v1/admin/backups/:id/verify pendente no backend.');
  }

  async function restoreBackup(backupId, actor = {}, options = {}) {
    await delay();
    assertSuperadmin(resolveActor(actor));
    if (options.target === 'production') {
      throw new Error('Restauração direta em produção via UI não é permitida. Use runbook em staging.');
    }
    if (!isBackendConnected()) {
      logTechnicalEvent('restore_falhou', actor, { backupId, reason: 'backend_required' });
      return BACKEND_REQUIRED;
    }
    throw new Error('Integração POST /api/v1/admin/backups/:id/restore pendente no backend.');
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

  /**
   * Exporta snapshot JSON local — apenas superadmin, rotulado DEV.
   * Inclui coleções do painel admin (conteúdos, empresas, configs, etc.).
   * Não substitui backup de produção (requisito 11).
   */
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
        'Snapshot DEV exportado (inclui edições do painel admin). Armazene apenas em ambiente controlado. Produção exige backend + storage off-site criptografado.'
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

  /**
   * Restaura snapshot DEV no localStorage (substitui o store atual).
   * Superadmin apenas. Não é restore de produção.
   */
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

    // Garante coleções críticas mesmo se ausentes no arquivo antigo
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
    exportDevSnapshot,
    downloadDevSnapshot,
    importDevSnapshot,
    logTechnicalEvent
  };
})();

window.CSBackup = CSBackup;
