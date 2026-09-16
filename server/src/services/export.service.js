'use strict';

const crypto = require('crypto');
const store = require('../store');
const {
  isValidExportType,
  canExportType,
  EXPORT_TYPES
} = require('./export-policy.service');
const { generatePdfBuffer } = require('./pdf-export.service');
const { buildSpreadsheetBuffer } = require('./excel-export.service');
const {
  buildReportExportPayload,
  buildManagerialExportPayload,
  categoryLabel,
  statusLabel,
  formatDateTime
} = require('./export-data.service');
const reportsService = require('./reports.service');

const downloadTokens = new Map();
const TOKEN_TTL_MS = 15 * 60 * 1000;

function purgeExpiredTokens() {
  const now = Date.now();
  for (const [token, entry] of downloadTokens.entries()) {
    if (entry.expiresAt <= now) downloadTokens.delete(token);
  }
}

function auditExport(user, details) {
  const data = store.load();
  data.auditLogs = data.auditLogs || [];
  data.auditLogs.unshift({
    id: store.uid('aud'),
    date: new Date().toISOString(),
    userId: user.id,
    userName: user.nome,
    action: details.action || 'exportacao_pdf',
    resourceType: 'report_export',
    resourceId: details.reportId || null,
    companyId: details.companyId || user.companyId || null,
    protocol: details.protocol || null,
    newValue: {
      exportType: details.exportType,
      filename: details.filename,
      format: details.format || 'pdf',
      filters: details.filters || null
    }
  });
  store.save(data);
}

function safeFilename(base) {
  return String(base)
    .replace(/[^\w\-]+/g, '_')
    .replace(/_+/g, '_')
    .slice(0, 80);
}

async function exportReportPdf(user, reportId, exportType) {
  if (!isValidExportType(exportType) || exportType === 'managerial') {
    return { ok: false, status: 400, error: 'Tipo de exportação inválido.' };
  }
  if (!canExportType(user, exportType)) {
    return { ok: false, status: 403, error: 'Sem permissão para exportar este relatório.' };
  }

  const built = buildReportExportPayload(user, reportId, exportType);
  if (!built.ok) return built;

  try {
    const buffer = await generatePdfBuffer(built.data);
    const protocol = built.data.meta.protocol;
    const filename = `${safeFilename(`canal-seguro_${exportType}_${protocol}_${Date.now()}`)}.pdf`;
    const data = store.load();
    const report = (data.reports || []).find(
      (r) => r.id === reportId || r.protocol === protocol
    );
    auditExport(user, {
      exportType,
      reportId: report?.id || reportId,
      protocol,
      companyId: built.data.meta.company?.id,
      filename
    });
    return {
      ok: true,
      buffer,
      filename,
      contentType: 'application/pdf',
      meta: {
        exportType,
        protocol,
        generatedAt: built.data.meta.generatedAt
      }
    };
  } catch {
    return { ok: false, status: 500, error: 'Falha ao gerar PDF.' };
  }
}

async function exportManagerialPdf(user, filters = {}) {
  if (!canExportType(user, 'managerial')) {
    return { ok: false, status: 403, error: 'Sem permissão para exportação gerencial.' };
  }

  const built = buildManagerialExportPayload(user, filters);
  if (!built.ok) return built;

  try {
    const buffer = await generatePdfBuffer(built.data);
    const companySlug = safeFilename(built.data.meta.company?.nomeFantasia || 'consolidado');
    const filename = `${safeFilename(`canal-seguro_gerencial_${companySlug}_${Date.now()}`)}.pdf`;
    auditExport(user, {
      exportType: 'managerial',
      companyId: built.data.meta.company?.id,
      filename,
      filters: {
        from: filters.from,
        to: filters.to,
        companyId: filters.companyId
      }
    });
    return {
      ok: true,
      buffer,
      filename,
      contentType: 'application/pdf',
      meta: {
        exportType: 'managerial',
        generatedAt: built.data.meta.generatedAt
      }
    };
  } catch {
    return { ok: false, status: 500, error: 'Falha ao gerar PDF.' };
  }
}

async function exportManagerialExcel(user, filters = {}) {
  if (!canExportType(user, 'managerial')) {
    return { ok: false, status: 403, error: 'Sem permissão para exportação gerencial.' };
  }

  const listed = reportsService.listReports(user, filters);
  if (!listed.ok) return listed;

  const data = store.load();
  const companyId = filters.companyId || (user.role !== 'superadmin' ? user.companyId : null);
  const company = companyId ? (data.companies || []).find((c) => c.id === companyId) : null;
  const includeCompany = !companyId || user.role === 'superadmin';

  const columns = [
    { key: 'protocol', label: 'Protocolo' },
    ...(includeCompany ? [{ key: 'company', label: 'Empresa' }] : []),
    { key: 'registeredAt', label: 'Data do registro' },
    { key: 'occurrenceAt', label: 'Data da ocorrência' },
    { key: 'category', label: 'Categoria' },
    { key: 'sector', label: 'Setor' },
    { key: 'anonymous', label: 'Tipo' },
    { key: 'status', label: 'Status' }
  ];

  const companyMap = Object.fromEntries((data.companies || []).map((c) => [c.id, c.nomeFantasia]));
  const rows = (listed.data || []).map((r) => {
    const occurrence = [r.dateApprox, r.timeApprox].filter(Boolean).join(' ') || '—';
    const row = {
      protocol: r.protocol,
      registeredAt: formatDateTime(r.createdAt),
      occurrenceAt: occurrence,
      category: categoryLabel(data, r.category),
      sector: r.sector || '—',
      anonymous: r.isAnonymous ? 'Anônimo' : 'Identificado',
      status: statusLabel(data, r.status)
    };
    if (includeCompany) row.company = companyMap[r.companyId] || r.companyId || '—';
    return row;
  });

  try {
    const buffer = buildSpreadsheetBuffer({
      title: `Relatório Canal Seguro — ${company?.nomeFantasia || 'Consolidado'}`,
      columns,
      rows
    });
    const companySlug = safeFilename(company?.nomeFantasia || 'consolidado');
    const filename = `${safeFilename(`canal-seguro_relatorio_${companySlug}_${Date.now()}`)}.xls`;
    auditExport(user, {
      action: 'exportacao_excel',
      exportType: 'managerial',
      format: 'excel',
      companyId: company?.id || null,
      filename,
      filters: {
        from: filters.from,
        to: filters.to,
        companyId: filters.companyId
      }
    });
    return {
      ok: true,
      buffer,
      filename,
      contentType: 'application/vnd.ms-excel',
      meta: {
        exportType: 'managerial',
        format: 'excel',
        generatedAt: new Date().toISOString(),
        total: rows.length
      }
    };
  } catch {
    return { ok: false, status: 500, error: 'Falha ao gerar Excel.' };
  }
}

function issueDownloadToken(user, buffer, meta) {
  purgeExpiredTokens();
  const token = crypto.randomBytes(24).toString('hex');
  downloadTokens.set(token, {
    userId: user.id,
    buffer,
    filename: meta.filename,
    contentType: meta.contentType,
    expiresAt: Date.now() + TOKEN_TTL_MS
  });
  return token;
}

function consumeDownloadToken(user, token) {
  purgeExpiredTokens();
  const entry = downloadTokens.get(token);
  if (!entry) return { ok: false, status: 404, error: 'Download expirado ou inválido.' };
  if (entry.userId !== user.id) return { ok: false, status: 403, error: 'Acesso negado.' };
  downloadTokens.delete(token);
  return {
    ok: true,
    buffer: entry.buffer,
    filename: entry.filename,
    contentType: entry.contentType
  };
}

function listExportTypes(user) {
  return Object.values(EXPORT_TYPES)
    .filter((t) => canExportType(user, t.id))
    .map((t) => ({ id: t.id, label: t.label, confidential: t.confidential }));
}

module.exports = {
  exportReportPdf,
  exportManagerialPdf,
  exportManagerialExcel,
  issueDownloadToken,
  consumeDownloadToken,
  listExportTypes
};
