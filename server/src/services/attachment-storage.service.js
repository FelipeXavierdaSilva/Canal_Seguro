'use strict';

const path = require('path');
const store = require('../store');
const config = require('../config');
const { appendAudit } = require('./audit.service');
const { assertTenantAccess } = require('./reports.service');
const { getStorage } = require('./storage');
const companyStorage = require('./company-storage.service');
const { sha256Hex } = require('../utils/attachment-hash');

const ATT = config.ATTACHMENTS;
const MAX_COUNT = ATT.MAX_ATTACHMENTS_PER_REPORT || ATT.MAX_COUNT;
const MAX_BYTES = ATT.MAX_BYTES;
const ALLOWED_EXTENSIONS = new Set(ATT.ALLOWED_EXTENSIONS);
const ALLOWED_MIME = new Set(ATT.ALLOWED_MIME);
const attachmentLimits = require('../utils/attachment-limits');

function extensionFromName(name) {
  return attachmentLimits.extensionFromName(name);
}

function sanitizeFileName(name) {
  const base = path.basename(String(name || 'arquivo').trim());
  const safe = base.replace(/[^a-zA-Z0-9._-]/g, '_').replace(/\.{2,}/g, '_').slice(0, 120);
  return safe || 'arquivo';
}

function validateAttachmentMeta({ name, mimeType, size, buffer }) {
  if (!name) return 'Nome do arquivo obrigatório.';
  if (!buffer || !Buffer.isBuffer(buffer) || buffer.length === 0) return 'Arquivo vazio.';
  const ext = extensionFromName(name);
  if (!ALLOWED_EXTENSIONS.has(ext)) return 'Tipo de arquivo não permitido.';
  const mime = String(mimeType || '').toLowerCase();
  if (mime && !ALLOWED_MIME.has(mime)) return 'MIME não permitido.';
  if (Number(size) && Number(size) !== buffer.length) return 'Tamanho inconsistente.';

  const { category, maxBytes } = attachmentLimits.maxBytesForAttachment({
    name,
    mimeType: mime,
    ext
  });
  if (buffer.length > maxBytes) {
    return `Arquivo excede o tamanho máximo permitido para ${category} (${maxBytes} bytes).`;
  }
  if (buffer.length > MAX_BYTES) {
    return 'Arquivo excede o tamanho máximo permitido.';
  }
  return null;
}

function buildStorageKey(companyId, reportId, attachmentId, fileName) {
  const safeName = sanitizeFileName(fileName);
  return `attachments/${companyId}/${reportId}/${attachmentId}_${safeName}`;
}

function findReport(data, reportId) {
  const key = String(reportId);
  return (
    (data.reports || []).find((r) => r.id === key || r.protocol.toUpperCase() === key.toUpperCase()) ||
    null
  );
}

function auditDenied(data, user, { action, reportId, companyId, protocol, detail }) {
  try {
    appendAudit(data, {
      userId: user?.id || null,
      userName: user?.nome || null,
      action,
      resourceType: 'attachment',
      resourceId: reportId || null,
      companyId: companyId || user?.companyId || null,
      protocol: protocol || null,
      newValue: { denied: true, ...detail }
    });
    store.save(data);
  } catch {
    /* auditoria de negação best-effort */
  }
}

function auditUploadBlocked(data, user, report, detail) {
  try {
    appendAudit(data, {
      userId: user?.id || null,
      userName: user?.nome || null,
      action: 'upload_anexo_bloqueado',
      resourceType: 'attachment',
      resourceId: report?.id || null,
      companyId: report?.companyId || user?.companyId || null,
      protocol: report?.protocol || null,
      newValue: { blocked: true, ...detail }
    });
    store.save(data);
  } catch {
    /* best-effort */
  }
}

function auditUploadFail(data, user, report, detail) {
  try {
    appendAudit(data, {
      userId: user?.id || null,
      userName: user?.nome || null,
      action: 'upload_anexo_falha',
      resourceType: 'attachment',
      resourceId: report?.id || null,
      companyId: report?.companyId || user?.companyId || null,
      protocol: report?.protocol || null,
      newValue: { failed: true, ...detail }
    });
    store.save(data);
  } catch {
    /* best-effort */
  }
}

function storageKeyBelongsToReport(storageKey, companyId, reportId) {
  const key = String(storageKey || '').replace(/\\/g, '/');
  const prefix = `attachments/${companyId}/${reportId}/`;
  return key.startsWith(prefix) && !key.includes('..');
}

function uploadAttachment(user, reportId, { name, mimeType, dataBase64 }) {
  if (!user) return { ok: false, status: 401 };
  const data = store.load();
  const report = findReport(data, reportId);
  if (!report) return { ok: false, status: 404, error: 'Relato não encontrado.' };
  const access = assertTenantAccess(user, report.companyId);
  if (!access.ok) {
    auditDenied(data, user, {
      action: 'acesso_anexo_negado',
      reportId: report.id,
      companyId: report.companyId,
      protocol: report.protocol,
      detail: { op: 'upload' }
    });
    return { ok: false, status: access.status, error: 'Relato não encontrado.' };
  }

  const attachments = report.attachments || [];
  if (attachments.length >= MAX_COUNT) {
    auditUploadBlocked(data, user, report, {
      reason: 'count_limit',
      max: MAX_COUNT
    });
    return { ok: false, status: 400, error: 'Limite de anexos atingido.' };
  }

  let buffer;
  try {
    buffer = Buffer.from(String(dataBase64 || ''), 'base64');
  } catch {
    auditUploadBlocked(data, user, report, { reason: 'invalid_content' });
    return { ok: false, status: 400, error: 'Conteúdo do arquivo inválido.' };
  }

  const validationError = validateAttachmentMeta({ name, mimeType, size: buffer.length, buffer });
  if (validationError) {
    const reason = /tamanho|excede|vazio|inconsistent/i.test(validationError)
      ? 'size_limit'
      : 'validation';
    auditUploadBlocked(data, user, report, {
      reason,
      error: validationError,
      size: buffer.length,
      name: sanitizeFileName(name)
    });
    return { ok: false, status: 400, error: validationError };
  }

  const company = companyStorage.findCompany(data, report.companyId);
  if (!company) return { ok: false, status: 404, error: 'Empresa não encontrada.' };
  companyStorage.ensureCompanyStorageFields(company, data);
  const quota = companyStorage.assertQuota(company, buffer.length);
  if (!quota.ok) {
    auditUploadBlocked(data, user, report, {
      reason: 'quota',
      error: quota.error,
      size: buffer.length,
      storageUsedBytes: company.storageUsedBytes,
      storageLimitBytes: company.storageLimitBytes
    });
    return { ok: false, status: 400, error: quota.error };
  }

  const attachmentId = store.uid('att');
  /* tenant do arquivo = report.companyId (ignora companyId spoof no body) */
  const storageKey = buildStorageKey(report.companyId, report.id, attachmentId, name);
  const sha256 = sha256Hex(buffer);
  const storage = getStorage();

  try {
    /* Mesmo buffer — sem compressão/thumbnail; bytes inalterados */
    storage.upload(storageKey, buffer);
  } catch (err) {
    auditUploadFail(data, user, report, {
      reason: 'storage_write',
      name: sanitizeFileName(name),
      size: buffer.length,
      sha256
    });
    return { ok: false, status: 500, error: 'Falha ao gravar anexo.' };
  }

  const meta = {
    id: attachmentId,
    reportId: report.id,
    name: sanitizeFileName(name),
    size: buffer.length,
    mimeType: mimeType || 'application/octet-stream',
    ext: extensionFromName(name),
    status: 'stored',
    storageKey,
    sha256,
    createdAt: new Date().toISOString()
  };

  report.attachments = [...attachments, meta];
  report.updatedAt = new Date().toISOString();
  companyStorage.incrementUsed(company, buffer.length);

  appendAudit(data, {
    userId: user.id,
    userName: user.nome,
    action: 'upload_anexo',
    resourceType: 'attachment',
    resourceId: attachmentId,
    companyId: report.companyId,
    protocol: report.protocol,
    newValue: {
      name: meta.name,
      size: meta.size,
      mimeType: meta.mimeType,
      sha256: meta.sha256,
      outcome: 'ok'
    }
  });

  try {
    store.save(data);
  } catch {
    try {
      storage.delete(storageKey);
    } catch {
      /* ignore orphan cleanup errors */
    }
    try {
      store.reload();
    } catch {
      /* ignore */
    }
    const dataFail = store.load();
    const reportFail = findReport(dataFail, reportId);
    auditUploadFail(dataFail, user, reportFail || report, {
      reason: 'persist',
      name: meta.name,
      size: meta.size,
      sha256: meta.sha256
    });
    return { ok: false, status: 500, error: 'Falha ao persistir anexo.' };
  }

  return {
    ok: true,
    attachment: {
      id: meta.id,
      name: meta.name,
      size: meta.size,
      mimeType: meta.mimeType,
      status: meta.status,
      sha256: meta.sha256,
      createdAt: meta.createdAt
    }
  };
}

function downloadAttachment(user, reportId, attachmentId) {
  if (!user) return { ok: false, status: 401 };
  const data = store.load();
  const report = findReport(data, reportId);
  if (!report) return { ok: false, status: 404, error: 'Relato não encontrado.' };
  const access = assertTenantAccess(user, report.companyId);
  if (!access.ok) {
    auditDenied(data, user, {
      action: 'acesso_anexo_negado',
      reportId: report.id,
      companyId: report.companyId,
      protocol: report.protocol,
      detail: { op: 'download', attachmentId }
    });
    return { ok: false, status: access.status, error: 'Relato não encontrado.' };
  }

  const attachment = (report.attachments || []).find((a) => a.id === attachmentId);
  if (!attachment?.storageKey) {
    return { ok: false, status: 404, error: 'Anexo não disponível.' };
  }

  if (!storageKeyBelongsToReport(attachment.storageKey, report.companyId, report.id)) {
    auditDenied(data, user, {
      action: 'acesso_anexo_negado',
      reportId: report.id,
      companyId: report.companyId,
      protocol: report.protocol,
      detail: { op: 'download', reason: 'storageKey_invalid', attachmentId }
    });
    return { ok: false, status: 404, error: 'Arquivo não encontrado.' };
  }

  const storage = getStorage();
  let buffer;
  try {
    buffer = storage.download(attachment.storageKey);
  } catch {
    return { ok: false, status: 404, error: 'Arquivo não encontrado.' };
  }

  appendAudit(data, {
    userId: user.id,
    userName: user.nome,
    action: 'download_anexo',
    resourceType: 'attachment',
    resourceId: attachmentId,
    companyId: report.companyId,
    protocol: report.protocol,
    newValue: {
      name: attachment.name,
      sha256: attachment.sha256 || null,
      size: attachment.size || buffer.length
    }
  });
  store.save(data);

  return {
    ok: true,
    buffer,
    filename: attachment.name,
    contentType: attachment.mimeType || 'application/octet-stream'
  };
}

function clearAttachmentsForTests() {
  try {
    getStorage().clearPrefix('attachments');
  } catch {
    /* ignore */
  }
}

module.exports = {
  uploadAttachment,
  downloadAttachment,
  clearAttachmentsForTests,
  MAX_COUNT,
  MAX_BYTES,
  MAX_ATTACHMENTS_PER_REPORT: MAX_COUNT
};
