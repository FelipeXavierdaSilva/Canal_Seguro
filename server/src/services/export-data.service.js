'use strict';

const store = require('../store');
const reportMessages = require('./report-messages.service');
const workflowService = require('./workflow.service');
const reportsService = require('./reports.service');
const { stageLabel, getCompanyWorkflowPolicy } = require('./workflow-policy.service');
const { redactReportIdentity, sectionsForType } = require('./export-policy.service');
const { hasPermission } = require('../utils/tokens');

const PDF_VERSION = '1.0';

function assertReportAccess(user, report) {
  if (!report) return { ok: false, status: 404, error: 'Relato não encontrado.' };
  if (user.role !== 'superadmin' && user.companyId !== report.companyId) {
    return { ok: false, status: 404, error: 'Relato não encontrado.' };
  }
  return { ok: true };
}

function categoryLabel(data, id) {
  const c = (data.categories || []).find((x) => x.id === id);
  return c ? c.label : id;
}

function statusLabel(data, id) {
  const s = (data.statuses || []).find((x) => x.id === id);
  return s ? s.label : id;
}

function riskLabel(level) {
  const map = {
    low: 'Baixo',
    moderate: 'Moderado',
    high: 'Alto',
    critical: 'Crítico'
  };
  return level ? map[level] || level : 'Não classificado';
}

function priorityLabel(p) {
  const map = { normal: 'Normal', alta: 'Alta', urgente: 'Urgente' };
  return map[p] || 'Normal';
}

function userNameById(data, userId) {
  if (!userId) return '—';
  const u = (data.users || []).find((x) => x.id === userId);
  return u ? u.nome : userId;
}

function formatDateTime(iso) {
  if (!iso) return '—';
  const d = new Date(iso);
  if (Number.isNaN(d.getTime())) return iso;
  return d.toLocaleString('pt-BR', {
    day: '2-digit',
    month: '2-digit',
    year: 'numeric',
    hour: '2-digit',
    minute: '2-digit'
  });
}

function buildReportExportPayload(user, reportId, exportType) {
  if (!hasPermission(user, 'reports:read')) {
    return { ok: false, status: 403, error: 'Acesso negado.' };
  }

  const data = store.load();
  const key = String(reportId);
  const report =
    (data.reports || []).find(
      (r) => r.id === key || r.protocol.toUpperCase() === key.toUpperCase()
    ) || null;

  const access = assertReportAccess(user, report);
  if (!access.ok) return access;

  workflowService.initReportWorkflowFields(report, data);
  const company = (data.companies || []).find((c) => c.id === report.companyId);
  const platform = data.platformSettings || {};
  const policy = getCompanyWorkflowPolicy(data, report.companyId);
  const sections = sectionsForType(exportType);
  const redacted = redactReportIdentity(report, user);

  const payload = {
    meta: {
      exportType,
      documentVersion: PDF_VERSION,
      generatedAt: new Date().toISOString(),
      generatedBy: { id: user.id, name: user.nome, role: user.role },
      confidential: true,
      company: {
        id: company?.id,
        nomeFantasia: company?.nomeFantasia || '—',
        nomeCanal: company?.nomeCanal || company?.nomeFantasia || '—',
        corPrincipal: company?.corPrincipal || '#6b9e9e'
      },
      platform: {
        productName: platform.fxProductName || 'Canal Seguro',
        brandName: platform.fxBrandName || 'FX Felipe Xavier'
      },
      protocol: report.protocol
    },
    report: {
      protocol: report.protocol,
      createdAt: formatDateTime(report.createdAt),
      category: categoryLabel(data, report.category),
      status: statusLabel(data, report.status),
      workflowStage: stageLabel(report.workflowStage, policy),
      priority: priorityLabel(report.priority),
      riskLevel: riskLabel(report.riskLevel),
      riskClassifiedAt: formatDateTime(report.riskClassifiedAt),
      sector: report.sector || '—',
      dateApprox: report.dateApprox || '—',
      timeApprox: report.timeApprox || '—',
      location: report.location || '—',
      involved: report.involved || '—',
      description: report.description || '',
      witnesses: report.witnesses || 'Não informado',
      isAnonymous: report.isAnonymous,
      assigneeName: userNameById(data, report.assigneeId),
      conclusionSummary: report.conclusionSummary || null,
      measuresAdopted: report.measuresAdopted || null,
      measuresLog: Array.isArray(report.measuresLog)
        ? report.measuresLog.map((m) => ({
            id: m.id,
            type: m.type,
            text: m.text,
            executedAt: m.executedAt,
            createdAt: m.createdAt,
            userName: m.userName
          }))
        : []
    },
    identity: null,
    attachments: [],
    treatmentHistory: [],
    workflowHistory: [],
    riskHistory: [],
    messages: []
  };

  if (sections.identity && !report.isAnonymous) {
    payload.identity = redacted.reporter;
    payload.identityNote = redacted._identityNote || null;
    if (hasPermission(user, 'reports:view_identity')) {
      payload.contactEmail = redacted.contactEmail || null;
      payload.contactPhone = redacted.contactPhone || null;
    }
  } else if (report.isAnonymous) {
    payload.identityNote = 'Relato registrado de forma anônima.';
  }

  if (sections.attachments) {
    payload.attachments = (report.attachments || []).map((a) => ({
      name: a.name,
      size: a.size,
      mimeType: a.mimeType,
      createdAt: formatDateTime(a.createdAt),
      note: 'Referência — arquivo disponível apenas no sistema.'
    }));
  }

  if (sections.treatmentHistory) {
    payload.treatmentHistory = (data.reportHistory || [])
      .filter((h) => h.reportId === report.id)
      .sort((a, b) => (a.date < b.date ? -1 : 1))
      .map((h) => ({
        date: formatDateTime(h.date),
        userName: h.userName,
        action: h.action
      }));
  }

  if (sections.workflow) {
    payload.workflowHistory = (data.reportWorkflowHistory || [])
      .filter((h) => h.reportId === report.id)
      .sort((a, b) => (a.createdAt < b.createdAt ? -1 : 1))
      .map((h) => ({
        date: formatDateTime(h.createdAt),
        userName: h.changedByUserName,
        from: h.previousStage ? stageLabel(h.previousStage, policy) : '—',
        to: stageLabel(h.newStage, policy),
        justification: h.justification || ''
      }));

    try {
      const tl = workflowService.getVisualTimeline(user, report.id);
      if (tl.ok) payload.workflowTimeline = tl.timeline;
    } catch {
      /* ignore */
    }
  }

  if (sections.riskHistory) {
    payload.riskHistory = (data.reportRiskHistory || [])
      .filter((h) => h.reportId === report.id)
      .sort((a, b) => (a.createdAt < b.createdAt ? -1 : 1))
      .map((h) => ({
        date: formatDateTime(h.createdAt),
        userName: h.classifiedByUserName,
        level: riskLabel(h.level),
        previousLevel: h.previousLevel ? riskLabel(h.previousLevel) : null,
        justification: h.justification || ''
      }));
  }

  if (sections.messages) {
    const thread = reportMessages.listForReport(report.id, { publicView: false });
    payload.messages = thread.map((m) => ({
      date: formatDateTime(m.createdAt),
      direction: m.direction === 'company' ? 'Equipe' : 'Denunciante',
      type: m.messageType === 'info_request' ? 'Solicitação de informações' : 'Mensagem',
      authorLabel: m.direction === 'reporter' ? 'Denunciante' : m.authorLabel || 'Equipe',
      body: m.body
    }));
  }

  return { ok: true, data: payload };
}

function averageTreatmentDays(reports) {
  const closed = reports.filter((r) => r.workflowStage === 'concluido' || r.status === 'concluido');
  if (!closed.length) return null;
  const totalMs = closed.reduce((sum, r) => {
    const start = new Date(r.createdAt).getTime();
    const end = new Date(r.updatedAt || r.createdAt).getTime();
    return sum + Math.max(0, end - start);
  }, 0);
  return Math.round(totalMs / closed.length / (24 * 60 * 60 * 1000));
}

function buildManagerialExportPayload(user, filters = {}) {
  if (!hasPermission(user, 'reports:export')) {
    return { ok: false, status: 403, error: 'Sem permissão para exportação gerencial.' };
  }

  const metricsResult = reportsService.getDashboardMetrics(user, filters);
  if (!metricsResult.ok) return metricsResult;

  const data = store.load();
  const companyId = filters.companyId || (user.role !== 'superadmin' ? user.companyId : null);
  const company = companyId ? (data.companies || []).find((c) => c.id === companyId) : null;
  const platform = data.platformSettings || {};
  const m = metricsResult.data;

  const pending =
    (m.byStatus?.recebido || 0) +
    (m.byStatus?.analise || 0) +
    (m.byStatus?.apuracao || 0) +
    (m.byStatus?.acompanhamento || 0);

  const listed = reportsService.listReports(user, filters);
  const reports = listed.ok ? listed.data : [];

  return {
    ok: true,
    data: {
      meta: {
        exportType: 'managerial',
        documentVersion: PDF_VERSION,
        generatedAt: new Date().toISOString(),
        generatedBy: { id: user.id, name: user.nome, role: user.role },
        confidential: true,
        period: {
          from: filters.from || null,
          to: filters.to || null
        },
        company: company
          ? {
              id: company.id,
              nomeFantasia: company.nomeFantasia,
              nomeCanal: company.nomeCanal || company.nomeFantasia,
              corPrincipal: company.corPrincipal || '#6b9e9e'
            }
          : { nomeFantasia: 'Todas as empresas', nomeCanal: 'Consolidado', corPrincipal: '#6b9e9e' },
        platform: {
          productName: platform.fxProductName || 'Canal Seguro',
          brandName: platform.fxBrandName || 'FX Felipe Xavier'
        }
      },
      summary: {
        total: m.total,
        concluidos: m.concluidos || m.byStatus?.concluido || 0,
        pendentes: pending,
        anonymous: m.anonymous,
        identified: m.identified,
        criticalCount: m.criticalCount || 0,
        highCount: m.highCount || 0,
        unclassifiedCount: m.unclassifiedCount || 0,
        avgTreatmentDays: averageTreatmentDays(reports)
      },
      byStatus: m.byStatus || {},
      byCategory: Object.fromEntries(
        Object.entries(m.byCategory || {}).map(([k, v]) => [categoryLabel(data, k), v])
      ),
      byRisk: m.byRisk || {},
      byMonth: m.byMonth || {},
      workflowAlerts: m.workflowAlerts || {}
    }
  };
}

module.exports = {
  PDF_VERSION,
  buildReportExportPayload,
  buildManagerialExportPayload,
  categoryLabel,
  statusLabel,
  riskLabel,
  formatDateTime
};
