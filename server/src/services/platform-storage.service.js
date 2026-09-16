'use strict';

/**
 * Capacidade contratada da plataforma (pool) + termômetros de uso/alocação.
 * Overcommit de cotas é permitido; alertas não bloqueiam cadastros.
 */

const DEFAULT_POOL_BYTES = 500 * 1024 * 1024 * 1024; // 500 GiB

const DEFAULT_THRESHOLDS = {
  attention: 70,
  warning: 85,
  critical: 95
};

const BAND_RANK = {
  normal: 0,
  atencao: 1,
  alerta: 2,
  critico: 3
};

function ensurePlatformSettings(data) {
  if (!data.platformSettings || typeof data.platformSettings !== 'object') {
    data.platformSettings = {};
  }
  return data.platformSettings;
}

function normalizeThresholds(raw) {
  const src = raw && typeof raw === 'object' ? raw : {};
  let attention = Number(src.attention);
  let warning = Number(src.warning);
  let critical = Number(src.critical);
  if (!Number.isFinite(attention) || attention < 1 || attention > 99) {
    attention = DEFAULT_THRESHOLDS.attention;
  }
  if (!Number.isFinite(warning) || warning < 1 || warning > 99) {
    warning = DEFAULT_THRESHOLDS.warning;
  }
  if (!Number.isFinite(critical) || critical < 1 || critical > 100) {
    critical = DEFAULT_THRESHOLDS.critical;
  }
  attention = Math.round(attention * 10) / 10;
  warning = Math.round(warning * 10) / 10;
  critical = Math.round(critical * 10) / 10;
  if (attention >= warning) warning = Math.min(99, attention + 5);
  if (warning >= critical) critical = Math.min(100, warning + 5);
  return { attention, warning, critical };
}

function ensurePlatformStorage(data) {
  const ps = ensurePlatformSettings(data);
  if (!ps.platformStorage || typeof ps.platformStorage !== 'object') {
    ps.platformStorage = {
      poolBytes: DEFAULT_POOL_BYTES,
      alertThresholds: { ...DEFAULT_THRESHOLDS },
      alertOnAllocatedOvercommit: true,
      lastAlert: {
        usedBand: 'normal',
        allocatedBand: 'normal',
        overcommit: false,
        at: null
      }
    };
  }
  const cfg = ps.platformStorage;
  if (!Number.isFinite(Number(cfg.poolBytes)) || Number(cfg.poolBytes) < 1) {
    cfg.poolBytes = DEFAULT_POOL_BYTES;
  }
  cfg.alertThresholds = normalizeThresholds(cfg.alertThresholds);
  if (typeof cfg.alertOnAllocatedOvercommit !== 'boolean') {
    cfg.alertOnAllocatedOvercommit = true;
  }
  if (!cfg.lastAlert || typeof cfg.lastAlert !== 'object') {
    cfg.lastAlert = {
      usedBand: 'normal',
      allocatedBand: 'normal',
      overcommit: false,
      at: null
    };
  }
  return cfg;
}

function bandForPercent(percent, thresholds, { overLimit = false } = {}) {
  const p = Number(percent) || 0;
  const t = normalizeThresholds(thresholds);
  if (overLimit || p > 100) {
    return { id: 'critico', label: 'Crítico' };
  }
  if (p >= t.critical) return { id: 'critico', label: 'Crítico' };
  if (p >= t.warning) return { id: 'alerta', label: 'Alerta' };
  if (p >= t.attention) return { id: 'atencao', label: 'Atenção' };
  return { id: 'normal', label: 'Normal' };
}

function roundPct(used, pool) {
  if (!pool || pool <= 0) return 0;
  return Math.round((used / pool) * 1000) / 10;
}

function computeCapacityTotals(data) {
  const companyStorage = require('./company-storage.service');
  let usedTotal = 0;
  let allocatedTotal = 0;
  let companyCount = 0;
  for (const c of data.companies || []) {
    companyStorage.ensureCompanyStorageFields(c, data);
    usedTotal += Number(c.storageUsedBytes) || 0;
    allocatedTotal += Number(c.storageLimitBytes) || 0;
    companyCount += 1;
  }
  return { usedTotal, allocatedTotal, companyCount };
}

function buildCapacitySummary(data) {
  const cfg = ensurePlatformStorage(data);
  const { usedTotal, allocatedTotal, companyCount } = computeCapacityTotals(data);
  const poolBytes = Number(cfg.poolBytes) || DEFAULT_POOL_BYTES;
  const usedPercent = roundPct(usedTotal, poolBytes);
  const allocatedPercent = roundPct(allocatedTotal, poolBytes);
  const overcommit = allocatedTotal > poolBytes;
  const usedBand = bandForPercent(usedPercent, cfg.alertThresholds);
  const allocatedBand = bandForPercent(allocatedPercent, cfg.alertThresholds, {
    overLimit: overcommit
  });
  const freeAllocatedBytes = Math.max(0, poolBytes - allocatedTotal);
  const freeUsedBytes = Math.max(0, poolBytes - usedTotal);

  const alerts = [];
  if (usedBand.id !== 'normal') {
    alerts.push({
      type: 'used',
      severity: usedBand.id,
      message: `Uso real da plataforma em zona ${usedBand.label}: ${usedPercent}% do pool contratado.`
    });
  }
  if (cfg.alertOnAllocatedOvercommit && overcommit) {
    alerts.push({
      type: 'overcommit',
      severity: 'alerta',
      message: `Overcommit: cotas alocadas (${allocatedPercent}%) superam o pool contratado. Cadastros não são bloqueados.`
    });
  } else if (allocatedBand.id !== 'normal' && !overcommit) {
    alerts.push({
      type: 'allocated',
      severity: allocatedBand.id,
      message: `Cotas alocadas em zona ${allocatedBand.label}: ${allocatedPercent}% do pool.`
    });
  }

  return {
    poolBytes,
    usedTotalBytes: usedTotal,
    allocatedTotalBytes: allocatedTotal,
    freeAllocatedBytes,
    freeUsedBytes,
    usedPercent,
    allocatedPercent,
    overcommit,
    companyCount,
    alertThresholds: { ...cfg.alertThresholds },
    alertOnAllocatedOvercommit: cfg.alertOnAllocatedOvercommit,
    usedBand,
    allocatedBand,
    alerts,
    lastAlert: { ...cfg.lastAlert }
  };
}

function maybeEmitCapacityAlerts(data, summary, actor = null) {
  const cfg = ensurePlatformStorage(data);
  const prev = cfg.lastAlert || {};
  const now = new Date().toISOString();
  const raised = [];

  const usedRank = BAND_RANK[summary.usedBand.id] ?? 0;
  const prevUsedRank = BAND_RANK[prev.usedBand] ?? 0;
  if (usedRank > prevUsedRank && usedRank > 0) {
    raised.push({
      kind: 'used',
      band: summary.usedBand.id,
      message: summary.alerts.find((a) => a.type === 'used')?.message || summary.usedBand.label
    });
  }

  const allocRank = BAND_RANK[summary.allocatedBand.id] ?? 0;
  const prevAllocRank = BAND_RANK[prev.allocatedBand] ?? 0;
  if (!summary.overcommit && allocRank > prevAllocRank && allocRank > 0) {
    raised.push({
      kind: 'allocated',
      band: summary.allocatedBand.id,
      message:
        summary.alerts.find((a) => a.type === 'allocated')?.message || summary.allocatedBand.label
    });
  }

  if (cfg.alertOnAllocatedOvercommit && summary.overcommit && !prev.overcommit) {
    raised.push({
      kind: 'overcommit',
      band: 'alerta',
      message: summary.alerts.find((a) => a.type === 'overcommit')?.message || 'Overcommit detectado.'
    });
  }

  if (!raised.length) {
    /* ainda atualiza lastAlert se saiu de overcommit / baixou faixa — sem notificação */
    cfg.lastAlert = {
      usedBand: summary.usedBand.id,
      allocatedBand: summary.allocatedBand.id,
      overcommit: summary.overcommit,
      at: prev.at || null
    };
    return { raised: [], summary };
  }

  if (!Array.isArray(data.notifications)) data.notifications = [];
  const { appendAudit } = require('./audit.service');

  for (const item of raised) {
    const id =
      typeof require('../store').uid === 'function'
        ? require('../store').uid('ntf')
        : `ntf_${Date.now()}`;
    data.notifications.unshift({
      id,
      type: 'platform_storage_alert',
      title: 'Alerta de armazenamento da plataforma',
      message: item.message,
      severity: item.band,
      kind: item.kind,
      companyId: null,
      userId: null,
      role: 'superadmin',
      read: false,
      createdAt: now
    });
    appendAudit(data, {
      userId: actor?.id || 'system',
      userName: actor?.nome || 'Sistema',
      action: 'alerta_capacidade_plataforma',
      resourceType: 'platform_storage',
      resourceId: 'platform',
      companyId: null,
      newValue: {
        kind: item.kind,
        band: item.band,
        message: item.message,
        usedPercent: summary.usedPercent,
        allocatedPercent: summary.allocatedPercent,
        poolBytes: summary.poolBytes
      }
    });
  }

  cfg.lastAlert = {
    usedBand: summary.usedBand.id,
    allocatedBand: summary.allocatedBand.id,
    overcommit: summary.overcommit,
    at: now
  };

  return { raised, summary };
}

function getPlatformCapacity(user, { emitAlerts = true } = {}) {
  if (!user) return { ok: false, status: 401 };
  if (user.role !== 'superadmin') return { ok: false, status: 403, error: 'Acesso negado.' };

  const store = require('../store');
  const data = store.load();
  ensurePlatformStorage(data);
  const summary = buildCapacitySummary(data);
  let raised = [];
  if (emitAlerts) {
    const result = maybeEmitCapacityAlerts(data, summary, user);
    raised = result.raised;
  }
  store.save(data);
  return {
    ok: true,
    data: {
      capacity: buildCapacitySummary(data),
      config: {
        poolBytes: ensurePlatformStorage(data).poolBytes,
        alertThresholds: { ...ensurePlatformStorage(data).alertThresholds },
        alertOnAllocatedOvercommit: ensurePlatformStorage(data).alertOnAllocatedOvercommit
      },
      newAlerts: raised
    }
  };
}

function updatePlatformCapacityConfig(user, payload = {}) {
  const store = require('../store');
  const { appendAudit } = require('./audit.service');
  if (!user) return { ok: false, status: 401 };
  if (user.role !== 'superadmin') return { ok: false, status: 403, error: 'Acesso negado.' };

  const data = store.load();
  const cfg = ensurePlatformStorage(data);
  const previous = {
    poolBytes: cfg.poolBytes,
    alertThresholds: { ...cfg.alertThresholds },
    alertOnAllocatedOvercommit: cfg.alertOnAllocatedOvercommit
  };

  if (payload.poolBytes != null && payload.poolBytes !== '') {
    const n = Number(payload.poolBytes);
    if (!Number.isFinite(n) || n < 10 * 1024 * 1024) {
      return {
        ok: false,
        status: 400,
        error: 'Pool inválido. Informe ao menos 10 MiB.'
      };
    }
    cfg.poolBytes = Math.floor(n);
  }

  if (payload.alertThresholds && typeof payload.alertThresholds === 'object') {
    cfg.alertThresholds = normalizeThresholds({
      ...cfg.alertThresholds,
      ...payload.alertThresholds
    });
  }

  if (typeof payload.alertOnAllocatedOvercommit === 'boolean') {
    cfg.alertOnAllocatedOvercommit = payload.alertOnAllocatedOvercommit;
  }

  /* reset ranking leve ao mudar limiares/pool — evita alerta falso no próximo GET */
  if (
    previous.poolBytes !== cfg.poolBytes ||
    previous.alertThresholds.attention !== cfg.alertThresholds.attention ||
    previous.alertThresholds.warning !== cfg.alertThresholds.warning ||
    previous.alertThresholds.critical !== cfg.alertThresholds.critical
  ) {
    const summary = buildCapacitySummary(data);
    cfg.lastAlert = {
      usedBand: summary.usedBand.id,
      allocatedBand: summary.allocatedBand.id,
      overcommit: summary.overcommit,
      at: new Date().toISOString()
    };
  }

  appendAudit(data, {
    userId: user.id,
    userName: user.nome,
    action: 'atualizacao_capacidade_plataforma',
    resourceType: 'platform_storage',
    resourceId: 'platform',
    companyId: null,
    previousValue: previous,
    newValue: {
      poolBytes: cfg.poolBytes,
      alertThresholds: { ...cfg.alertThresholds },
      alertOnAllocatedOvercommit: cfg.alertOnAllocatedOvercommit
    }
  });

  store.save(data);
  return {
    ok: true,
    data: {
      capacity: buildCapacitySummary(data),
      config: {
        poolBytes: cfg.poolBytes,
        alertThresholds: { ...cfg.alertThresholds },
        alertOnAllocatedOvercommit: cfg.alertOnAllocatedOvercommit
      }
    }
  };
}

module.exports = {
  DEFAULT_POOL_BYTES,
  DEFAULT_THRESHOLDS,
  ensurePlatformStorage,
  buildCapacitySummary,
  getPlatformCapacity,
  updatePlatformCapacityConfig,
  bandForPercent,
  normalizeThresholds
};
