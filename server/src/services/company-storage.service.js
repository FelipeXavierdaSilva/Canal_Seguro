'use strict';

const config = require('../config');

function defaultLimit() {
  return Number(config.ATTACHMENTS.DEFAULT_COMPANY_QUOTA_BYTES) || 1 * 1024 * 1024 * 1024;
}

/** Soma apenas anexos status=stored com storageKey (ignora simulated). */
function sumStoredBytesForCompany(data, companyId) {
  let total = 0;
  for (const report of data.reports || []) {
    if (report.companyId !== companyId) continue;
    for (const att of report.attachments || []) {
      if (att && att.status === 'stored' && att.storageKey) {
        total += Number(att.size) || 0;
      }
    }
  }
  return total;
}

/**
 * Garante campos aditivos em empresas antigas. Mutates company.
 * @returns {{ company: object, dirty: boolean }}
 */
function ensureCompanyStorageFields(company, data, { recomputeUsed = false } = {}) {
  if (!company) return { company: null, dirty: false };
  let dirty = false;
  if (typeof company.storageLimitBytes !== 'number' || Number.isNaN(company.storageLimitBytes)) {
    company.storageLimitBytes = defaultLimit();
    dirty = true;
  }
  if (
    recomputeUsed ||
    typeof company.storageUsedBytes !== 'number' ||
    Number.isNaN(company.storageUsedBytes)
  ) {
    company.storageUsedBytes = sumStoredBytesForCompany(data, company.id);
    dirty = true;
  }
  return { company, dirty };
}

function findCompany(data, companyId) {
  return (data.companies || []).find((c) => c.id === companyId) || null;
}

function ensureAndMaybePersist(data, companyId, saveFn) {
  const company = findCompany(data, companyId);
  if (!company) return null;
  const { dirty } = ensureCompanyStorageFields(company, data);
  if (dirty && typeof saveFn === 'function') saveFn(data);
  return company;
}

function assertQuota(company, additionalBytes) {
  const limit = Number(company.storageLimitBytes) || defaultLimit();
  const used = Number(company.storageUsedBytes) || 0;
  const add = Number(additionalBytes) || 0;
  if (used + add > limit) {
    return {
      ok: false,
      error: `Quota de armazenamento da empresa esgotada (uso ${used} + ${add} > limite ${limit} bytes).`
    };
  }
  return { ok: true };
}

function incrementUsed(company, bytes) {
  const n = Number(bytes) || 0;
  company.storageUsedBytes = Math.max(0, (Number(company.storageUsedBytes) || 0) + n);
}

/**
 * Recalcula storageUsedBytes a partir dos anexos stored da empresa.
 */
function recalculateCompanyStorage(companyId, { persist = true } = {}) {
  const store = require('../store');
  const data = store.load();
  const company = findCompany(data, companyId);
  if (!company) return { ok: false, error: 'Empresa não encontrada.' };
  if (typeof company.storageLimitBytes !== 'number' || Number.isNaN(company.storageLimitBytes)) {
    company.storageLimitBytes = defaultLimit();
  }
  company.storageUsedBytes = sumStoredBytesForCompany(data, companyId);
  if (persist) store.save(data);
  return {
    ok: true,
    companyId: company.id,
    storageLimitBytes: company.storageLimitBytes,
    storageUsedBytes: company.storageUsedBytes
  };
}

/** Recalcula storageUsedBytes de todas as empresas (consistência). */
function recalculateAllCompanyStorage() {
  const store = require('../store');
  const data = store.load();
  const companies = [];
  for (const company of data.companies || []) {
    if (typeof company.storageLimitBytes !== 'number' || Number.isNaN(company.storageLimitBytes)) {
      company.storageLimitBytes = defaultLimit();
    }
    company.storageUsedBytes = sumStoredBytesForCompany(data, company.id);
    companies.push({
      companyId: company.id,
      storageLimitBytes: company.storageLimitBytes,
      storageUsedBytes: company.storageUsedBytes
    });
  }
  store.save(data);
  return { ok: true, companies };
}

function storageUsageView(company) {
  const limit = Number(company.storageLimitBytes) || defaultLimit();
  const used = Number(company.storageUsedBytes) || 0;
  const overLimit = used > limit;
  const pct = limit > 0 ? Math.round((used / limit) * 1000) / 10 : 0;
  return {
    companyId: company.id,
    nomeFantasia: company.nomeFantasia || company.razaoSocial || company.id,
    storageLimitBytes: limit,
    storageUsedBytes: used,
    storageAvailableBytes: Math.max(0, limit - used),
    storagePercent: pct,
    overLimit
  };
}

function getStorageUsageForUser(user, companyId = null) {
  const store = require('../store');
  const data = store.load();
  if (!user) return { ok: false, status: 401 };

  if (user.role === 'superadmin') {
    if (companyId) {
      const company = findCompany(data, companyId);
      if (!company) return { ok: false, status: 404, error: 'Empresa não encontrada.' };
      const { dirty } = ensureCompanyStorageFields(company, data);
      if (dirty) store.save(data);
      return { ok: true, data: storageUsageView(company) };
    }
    let dirtyAny = false;
    const list = (data.companies || []).map((c) => {
      const { dirty } = ensureCompanyStorageFields(c, data);
      if (dirty) dirtyAny = true;
      return storageUsageView(c);
    });
    if (dirtyAny) store.save(data);
    let capacity = null;
    try {
      const platformStorage = require('./platform-storage.service');
      capacity = platformStorage.buildCapacitySummary(data);
    } catch {
      capacity = null;
    }
    return { ok: true, data: { companies: list, capacity } };
  }

  const tid = user.companyId;
  if (!tid) return { ok: false, status: 403, error: 'Sem empresa vinculada.' };
  if (companyId && companyId !== tid) {
    return { ok: false, status: 404, error: 'Empresa não encontrada.' };
  }
  const company = findCompany(data, tid);
  if (!company) return { ok: false, status: 404, error: 'Empresa não encontrada.' };
  const { dirty } = ensureCompanyStorageFields(company, data);
  if (dirty) store.save(data);
  return { ok: true, data: storageUsageView(company) };
}

function updateCompanyStorageLimit(user, companyId, storageLimitBytes) {
  const store = require('../store');
  const { appendAudit } = require('./audit.service');
  if (!user) return { ok: false, status: 401 };
  if (user.role !== 'superadmin') return { ok: false, status: 403, error: 'Acesso negado.' };
  const data = store.load();
  const company = findCompany(data, companyId);
  if (!company) return { ok: false, status: 404, error: 'Empresa não encontrada.' };

  const n = Number(storageLimitBytes);
  const min = Number(config.ATTACHMENTS.MIN_COMPANY_QUOTA_BYTES) || 10 * 1024 * 1024;
  const max = Number(config.ATTACHMENTS.MAX_COMPANY_QUOTA_BYTES) || 100 * 1024 * 1024 * 1024;
  if (!Number.isFinite(n)) {
    return { ok: false, status: 400, error: 'Quota inválida.' };
  }
  const nextLimit = Math.floor(n);
  if (nextLimit < min || nextLimit > max) {
    return {
      ok: false,
      status: 400,
      error: `Quota deve estar entre ${min} e ${max} bytes.`
    };
  }

  ensureCompanyStorageFields(company, data);
  const previousLimit = company.storageLimitBytes;
  company.storageLimitBytes = nextLimit;
  /* used > novo limit: não apaga arquivos; uploads novos continuam bloqueados via assertQuota */

  appendAudit(data, {
    userId: user.id,
    userName: user.nome,
    action: 'alteracao_quota_armazenamento',
    resourceType: 'company',
    resourceId: company.id,
    companyId: company.id,
    previousValue: { storageLimitBytes: previousLimit },
    newValue: {
      storageLimitBytes: nextLimit,
      storageUsedBytes: company.storageUsedBytes,
      overLimit: Number(company.storageUsedBytes) > nextLimit
    }
  });

  store.save(data);
  return { ok: true, data: storageUsageView(company) };
}

function enrichCompanyForResponse(company, data) {
  if (!company) return null;
  const copy = { ...company };
  ensureCompanyStorageFields(copy, data);
  return copy;
}

module.exports = {
  defaultLimit,
  sumStoredBytesForCompany,
  ensureCompanyStorageFields,
  ensureAndMaybePersist,
  assertQuota,
  incrementUsed,
  recalculateCompanyStorage,
  recalculateAllCompanyStorage,
  storageUsageView,
  getStorageUsageForUser,
  enrichCompanyForResponse,
  findCompany,
  updateCompanyStorageLimit
};
