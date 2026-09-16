'use strict';

const store = require('../store');
const notification = require('./notification.service');
const reportMessages = require('./report-messages.service');
const riskClassification = require('./risk-classification.service');
const workflowService = require('./workflow.service');
const { stageOrder, LEGACY_STATUS_TO_STAGE, getCompanyWorkflowPolicy } = require('./workflow-policy.service');
const { riskLevelSortWeight } = require('./risk-policy.service');
const { hashTrackingCode } = require('../utils/tracking-crypto');
const { hasPermission } = require('../utils/tokens');

const ALLOWED_STATUS = new Set(['recebido', 'analise', 'apuracao', 'acompanhamento', 'concluido']);

function tenantIdForUser(user, requestedCompanyId = null) {
  if (!user) return null;
  if (user.role === 'superadmin') {
    return requestedCompanyId || null;
  }
  return user.companyId;
}

function assertTenantAccess(user, resourceCompanyId) {
  if (!user) return { ok: false, status: 401 };
  if (user.role === 'superadmin') return { ok: true };
  if (!resourceCompanyId || user.companyId !== resourceCompanyId) {
    return { ok: false, status: 404 };
  }
  return { ok: true };
}

function stripAttachmentForClient(att) {
  if (!att || typeof att !== 'object') return att;
  const {
    storageKey: _sk,
    path: _path,
    url: _url,
    downloadUrl: _du,
    storageUrl: _su,
    base64: _b64,
    dataUrl: _durl,
    content: _content,
    blob: _blob,
    file: _file,
    ...safe
  } = att;
  return safe;
}

function stripReportForRole(report, user) {
  if (!report) return null;
  const copy = { ...report };
  delete copy.trackingCode;
  delete copy.trackingCodeHash;
  if (Array.isArray(copy.attachments)) {
    copy.attachments = copy.attachments.map(stripAttachmentForClient);
  }
  if (report.isAnonymous) {
    delete copy.reporter;
    delete copy.employeeId;
    delete copy.contactEmail;
    delete copy.contactPhone;
  } else if (!hasPermission(user, 'reports:view_identity')) {
    copy.reporter = copy.reporter
      ? { nome: '[restrito]', email: null, telefone: null, empresa: null, setor: null, cargo: null }
      : null;
    delete copy.employeeId;
    delete copy.contactEmail;
    delete copy.contactPhone;
  }
  return copy;
}

function listReports(user, filters = {}) {
  if (!hasPermission(user, 'reports:read')) {
    return { ok: false, status: 403 };
  }

  const data = store.load();
  let list = [...(data.reports || [])];

  const tenant = tenantIdForUser(user, filters.companyId);
  if (user.role !== 'superadmin') {
    list = list.filter((r) => r.companyId === user.companyId);
  } else if (tenant) {
    list = list.filter((r) => r.companyId === tenant);
  }

  if (filters.status) list = list.filter((r) => r.status === filters.status);
  if (filters.category) list = list.filter((r) => r.category === filters.category);
  if (filters.riskLevel) {
    if (filters.riskLevel === 'unclassified') {
      list = list.filter((r) => !r.riskLevel);
    } else {
      list = list.filter((r) => r.riskLevel === filters.riskLevel);
    }
  }
  if (filters.workflowStage) {
    list = list.filter((r) => {
      workflowService.initReportWorkflowFields(r, data);
      return r.workflowStage === filters.workflowStage;
    });
  }
  if (filters.priority) {
    list = list.filter((r) => r.priority === filters.priority);
  }
  if (filters.alert === 'stalled' || filters.alert === 'noAssignee') {
    const stalledMs = 120 * 60 * 60 * 1000;
    const now = Date.now();
    list = list.filter((r) => {
      workflowService.initReportWorkflowFields(r, data);
      if (r.workflowStage === 'concluido') return false;
      if (filters.alert === 'stalled') {
        const stageAt = r.workflowStageAt ? new Date(r.workflowStageAt).getTime() : now;
        return now - stageAt > stalledMs;
      }
      const policy = getCompanyWorkflowPolicy(data, r.companyId);
      const stageIdx = (policy.stages || []).findIndex((s) => s.id === r.workflowStage);
      const triageIdx = (policy.stages || []).findIndex((s) => s.id === 'triagem');
      return !r.assigneeId && stageIdx >= 0 && triageIdx >= 0 && stageIdx >= triageIdx;
    });
  }
  if (filters.q) {
    const q = String(filters.q).toLowerCase();
    list = list.filter(
      (r) =>
        r.protocol.toLowerCase().includes(q) ||
        (r.sector || '').toLowerCase().includes(q) ||
        (r.description || '').toLowerCase().includes(q)
    );
  }

  list.forEach((r) => workflowService.initReportWorkflowFields(r, data));
  list.sort((a, b) => {
    const policyA = getCompanyWorkflowPolicy(data, a.companyId);
    const policyB = getCompanyWorkflowPolicy(data, b.companyId);
    if (a.workflowStage === 'concluido' && b.workflowStage !== 'concluido') return 1;
    if (b.workflowStage === 'concluido' && a.workflowStage !== 'concluido') return -1;
    const rw = riskLevelSortWeight(b.riskLevel) - riskLevelSortWeight(a.riskLevel);
    if (rw !== 0) return rw;
    const pw = { urgente: 3, alta: 2, normal: 1 };
    const pp = (pw[b.priority] || 0) - (pw[a.priority] || 0);
    if (pp !== 0) return pp;
    return (a.updatedAt || a.createdAt) < (b.updatedAt || b.createdAt) ? 1 : -1;
  });

  return {
    ok: true,
    data: list.map((r) => {
      const row = stripReportForRole(r, user);
      row.threadUnreadCount = reportMessages.unreadCount(r.id, 'company');
      return row;
    })
  };
}

function getReport(user, idOrProtocol) {
  if (!hasPermission(user, 'reports:read')) {
    return { ok: false, status: 403 };
  }

  const data = store.load();
  const key = String(idOrProtocol);
  const report =
    (data.reports || []).find(
      (r) => r.id === key || r.protocol.toUpperCase() === key.toUpperCase()
    ) || null;

  if (!report) return { ok: false, status: 404 };

  const access = assertTenantAccess(user, report.companyId);
  if (!access.ok) return access;

  return { ok: true, data: stripReportForRole(report, user) };
}

function getHistory(user, reportId) {
  const found = getReport(user, reportId);
  if (!found.ok) return found;
  const data = store.load();
  const history = (data.reportHistory || [])
    .filter((h) => h.reportId === found.data.id)
    .sort((a, b) => (a.date < b.date ? 1 : -1));
  return { ok: true, data: history };
}

function updateStatus(user, reportId, status, note = '') {
  if (!hasPermission(user, 'reports:update_status')) {
    return { ok: false, status: 403 };
  }
  if (!ALLOWED_STATUS.has(status)) {
    return { ok: false, status: 400, message: 'Status inválido.' };
  }

  const targetStage = LEGACY_STATUS_TO_STAGE[status];
  if (targetStage && hasPermission(user, 'reports:transition_workflow')) {
    const result = workflowService.transitionReport(user, reportId, {
      stage: targetStage,
      justification: note || `Atualização via status legado (${status}).`,
      note
    });
    if (result.ok) {
      const data = store.load();
      const report = (data.reports || []).find((r) => r.id === reportId);
      return { ok: true, data: stripReportForRole(report, user) };
    }
    if (result.status !== 403 && result.status !== 400) {
      return { ok: false, status: result.status, message: result.error || result.message };
    }
  }

  const data = store.load();
  const report = (data.reports || []).find((r) => r.id === reportId);
  if (!report) return { ok: false, status: 404 };

  const access = assertTenantAccess(user, report.companyId);
  if (!access.ok) return access;

  if (status === 'concluido') {
    const riskCheck = riskClassification.validateCriticalConclude(report, data);
    if (!riskCheck.ok) return riskCheck;
  }

  const previousStatus = report.status;
  report.status = status;
  report.updatedAt = new Date().toISOString();

  const statusRow = (data.statuses || []).find((s) => s.id === status);
  const label = statusRow ? statusRow.label : status;

  data.reportHistory = data.reportHistory || [];
  data.reportHistory.push({
    id: store.uid('hist'),
    reportId: report.id,
    date: report.updatedAt,
    userId: user.id,
    userName: user.nome,
    action: note || `Alterou status para "${label}".`
  });

  data.auditLogs = data.auditLogs || [];
  data.auditLogs.unshift({
    id: store.uid('aud'),
    date: report.updatedAt,
    userId: user.id,
    userName: user.nome,
    action: 'alteracao_status',
    resourceType: 'report',
    resourceId: report.id,
    companyId: report.companyId,
    protocol: report.protocol,
    previousValue: { status: previousStatus },
    newValue: { status }
  });

  store.save(data);
  try {
    notification.emitReportStatusChanged(report, previousStatus);
  } catch {
    /* não bloqueia operação */
  }
  return { ok: true, data: stripReportForRole(report, user) };
}

function assignReport(user, reportId, assigneeId) {
  if (!hasPermission(user, 'reports:assign')) {
    return { ok: false, status: 403 };
  }

  const data = store.load();
  const report = (data.reports || []).find((r) => r.id === reportId);
  if (!report) return { ok: false, status: 404 };

  const access = assertTenantAccess(user, report.companyId);
  if (!access.ok) return access;

  const assignee = (data.users || []).find((u) => u.id === assigneeId);
  if (assignee && assignee.companyId && assignee.companyId !== report.companyId) {
    return { ok: false, status: 403, message: 'Responsável não pertence à empresa deste relato.' };
  }

  const previousAssigneeId = report.assigneeId;
  report.assigneeId = assigneeId;
  if (assigneeId && !(report.teamIds || []).includes(assigneeId)) {
    report.teamIds = [assigneeId, ...(report.teamIds || [])].slice(0, 10);
  }
  report.updatedAt = new Date().toISOString();
  workflowService.initReportWorkflowFields(report, data);

  data.reportHistory = data.reportHistory || [];
  data.reportHistory.push({
    id: store.uid('hist'),
    reportId: report.id,
    date: report.updatedAt,
    userId: user.id,
    userName: user.nome,
    action: `Encaminhou o relato para ${assignee ? assignee.nome : assigneeId}.`
  });

  data.auditLogs = data.auditLogs || [];
  data.auditLogs.unshift({
    id: store.uid('aud'),
    date: report.updatedAt,
    userId: user.id,
    userName: user.nome,
    action: 'atribuicao_relato',
    resourceType: 'report',
    resourceId: report.id,
    companyId: report.companyId,
    protocol: report.protocol,
    previousValue: { assigneeId: previousAssigneeId },
    newValue: { assigneeId, assigneeName: assignee ? assignee.nome : assigneeId }
  });

  store.save(data);
  return { ok: true, data: stripReportForRole(report, user) };
}

function addObservation(user, reportId, text, options = {}) {
  if (!hasPermission(user, 'reports:comment')) {
    return { ok: false, status: 403 };
  }
  if (!String(text || '').trim()) {
    return { ok: false, status: 400, message: 'Observação vazia.' };
  }

  const data = store.load();
  const report = (data.reports || []).find((r) => r.id === reportId);
  if (!report) return { ok: false, status: 404 };

  const access = assertTenantAccess(user, report.companyId);
  if (!access.ok) return access;

  const now = new Date().toISOString();
  report.updatedAt = now;
  data.reportHistory = data.reportHistory || [];
  data.reportHistory.push({
    id: store.uid('hist'),
    reportId: report.id,
    date: now,
    userId: user.id,
    userName: user.nome,
    action: `Observação: ${String(text).trim()}`
  });

  data.auditLogs = data.auditLogs || [];
  data.auditLogs.unshift({
    id: store.uid('aud'),
    date: now,
    userId: user.id,
    userName: user.nome,
    action: 'observacao_relato',
    resourceType: 'report',
    resourceId: report.id,
    companyId: report.companyId,
    protocol: report.protocol
  });

  store.save(data);
  try {
    notification.emitReportMessage(report, user, { kind: options.kind || 'message' });
  } catch {
    /* não bloqueia operação */
  }
  return { ok: true, data: stripReportForRole(report, user) };
}

const MEASURE_TYPES = {
  acao_executada: 'Ação executada',
  medida_adotada: 'Medida adotada'
};

function rebuildMeasuresAdoptedRollup(report) {
  const log = Array.isArray(report.measuresLog) ? report.measuresLog : [];
  if (!log.length) return;
  report.measuresAdopted = log
    .map((item) => {
      const label = MEASURE_TYPES[item.type] || 'Registro';
      const when = item.executedAt ? String(item.executedAt).slice(0, 10) : '';
      const who = item.userName ? ` — ${item.userName}` : '';
      const prefix = when ? `[${when}] ${label}` : label;
      return `${prefix}${who}: ${item.text}`;
    })
    .join('\n\n')
    .slice(0, 8000);
}

/**
 * Registra ação executada ou medida adotada no tratamento da denúncia (interno).
 */
function addMeasureAction(user, reportId, payload = {}) {
  if (!hasPermission(user, 'reports:comment')) {
    return { ok: false, status: 403 };
  }
  const text = String(payload.text || '').trim().slice(0, 4000);
  if (!text) {
    return { ok: false, status: 400, message: 'Descreva o que foi executado ou a medida adotada.' };
  }
  const type = MEASURE_TYPES[payload.type] ? payload.type : 'acao_executada';
  let executedAt = payload.executedAt ? String(payload.executedAt).trim() : '';
  if (executedAt) {
    const d = new Date(executedAt);
    if (Number.isNaN(d.getTime())) {
      return { ok: false, status: 400, message: 'Data de execução inválida.' };
    }
    executedAt = d.toISOString();
  } else {
    executedAt = new Date().toISOString();
  }

  const data = store.load();
  const report = (data.reports || []).find((r) => r.id === reportId);
  if (!report) return { ok: false, status: 404 };

  const access = assertTenantAccess(user, report.companyId);
  if (!access.ok) return access;

  const now = new Date().toISOString();
  if (!Array.isArray(report.measuresLog)) report.measuresLog = [];
  const entry = {
    id: store.uid('msu'),
    type,
    text,
    executedAt,
    createdAt: now,
    userId: user.id,
    userName: user.nome || user.email || user.id
  };
  report.measuresLog.push(entry);
  report.updatedAt = now;
  rebuildMeasuresAdoptedRollup(report);

  const typeLabel = MEASURE_TYPES[type];
  data.reportHistory = data.reportHistory || [];
  data.reportHistory.push({
    id: store.uid('hist'),
    reportId: report.id,
    date: now,
    userId: user.id,
    userName: user.nome,
    action: `${typeLabel}: ${text}`
  });

  data.auditLogs = data.auditLogs || [];
  data.auditLogs.unshift({
    id: store.uid('aud'),
    date: now,
    userId: user.id,
    userName: user.nome,
    action: 'medida_acao_relato',
    resourceType: 'report',
    resourceId: report.id,
    companyId: report.companyId,
    protocol: report.protocol,
    newValue: { type, measureId: entry.id }
  });

  store.save(data);
  return {
    ok: true,
    data: {
      report: stripReportForRole(report, user),
      entry
    }
  };
}

function generateProtocol(data, companyId) {
  const companyCfg = data.companySettings?.[companyId] || { protocolPrefix: 'CS', protocolCounter: 100 };
  const prefix = companyCfg.protocolPrefix || 'CS';
  companyCfg.protocolCounter = (companyCfg.protocolCounter || 100) + 1;
  const num = String(companyCfg.protocolCounter).padStart(6, '0');
  data.companySettings = data.companySettings || {};
  data.companySettings[companyId] = companyCfg;
  return `${prefix}-2026-${num.slice(-6)}`;
}

function generateTrackingCode() {
  const chars = 'ABCDEFGHJKLMNPQRSTUVWXYZ23456789';
  const parts = [];
  for (let p = 0; p < 3; p++) {
    let part = '';
    for (let i = 0; i < 4; i++) part += chars[Math.floor(Math.random() * chars.length)];
    parts.push(part);
  }
  return parts.join('-');
}

function createReport(employeeCtx, body) {
  const data = store.load();
  const emp = (data.employees || []).find(
    (e) => e.id === employeeCtx.employeeId && e.companyId === employeeCtx.companyId
  );
  if (!emp || emp.status !== 'ativo') {
    return { ok: false, status: 403, message: 'Colaborador não autorizado.' };
  }

  const companyId = employeeCtx.companyId;
  const company = (data.companies || []).find((c) => c.id === companyId && c.status === 'ativo');
  if (!company) {
    return { ok: false, status: 403, message: 'Empresa inválida.' };
  }

  const isAnonymous = Boolean(body.isAnonymous);
  const now = new Date().toISOString();
  const reportId = store.uid('rpt');
  const protocol = generateProtocol(data, companyId);
  const trackingCodePlain = generateTrackingCode();
  const trackingCodeHash = hashTrackingCode(trackingCodePlain);

  let reporter = null;
  if (!isAnonymous && body.reporter && typeof body.reporter === 'object') {
    reporter = {
      nome: String(body.reporter.nome || '').trim(),
      email: String(body.reporter.email || '').trim(),
      telefone: String(body.reporter.telefone || '').trim(),
      empresa: String(body.reporter.empresa || '').trim(),
      setor: String(body.reporter.setor || '').trim(),
      cargo: String(body.reporter.cargo || '').trim()
    };
  }

  const report = {
    id: reportId,
    protocol,
    trackingCodeHash,
    companyId,
    category: body.category,
    status: 'recebido',
    isAnonymous,
    dateApprox: body.dateApprox || '',
    timeApprox: body.timeApprox || '',
    location: String(body.location || '').trim(),
    involved: String(body.involved || '').trim(),
    description: String(body.description || '').trim(),
    witnesses: String(body.witnesses || '').trim(),
    attachments: Array.isArray(body.attachments)
      ? body.attachments.map((a, i) => ({
          id: store.uid('att'),
          reportId,
          name: String(a?.name || `anexo-${i + 1}`),
          size: Number(a?.size) || 0,
          mimeType: String(a?.mimeType || 'application/octet-stream'),
          status: 'simulated',
          createdAt: now
        }))
      : [],
    wantUpdates: Boolean(body.wantUpdates),
    contactEmail: body.wantUpdates ? body.contactEmail ?? null : null,
    contactPhone: body.wantUpdates ? body.contactPhone ?? null : null,
    reporter,
    sector: String(body.sector || '').trim(),
    assigneeId: null,
    workflowStage: 'recebido',
    workflowStageAt: now,
    priority: 'normal',
    teamIds: [],
    dueAt: null,
    riskLevel: null,
    riskClassifiedAt: null,
    riskClassifiedByUserId: null,
    createdAt: now,
    updatedAt: now
  };

  if (!isAnonymous) {
    report.employeeId = emp.id;
  }

  data.reports = data.reports || [];
  data.reports.push(report);
  data.reportHistory = data.reportHistory || [];
  data.reportHistory.push({
    id: store.uid('hist'),
    reportId,
    date: now,
    userId: 'system',
    userName: 'Sistema',
    action: 'Relato recebido e registrado.'
  });

  data.reportWorkflowHistory = data.reportWorkflowHistory || [];
  data.reportWorkflowHistory.push({
    id: store.uid('wfh'),
    reportId,
    companyId,
    protocol,
    previousStage: null,
    newStage: 'recebido',
    changedByUserId: 'system',
    changedByUserName: 'Sistema',
    justification: 'Registro inicial do relato.',
    assigneeIdAtTransition: null,
    teamIdsAtTransition: [],
    durationMs: 0,
    note: null,
    createdAt: now
  });

  data.auditLogs = data.auditLogs || [];
  data.auditLogs.unshift({
    id: store.uid('aud'),
    date: now,
    userId: 'system',
    userName: 'Sistema',
    action: 'criacao_relato',
    resourceType: 'report',
    resourceId: report.id,
    companyId,
    protocol,
    newValue: { status: 'recebido', isAnonymous, attachmentCount: report.attachments.length }
  });

  store.save(data);
  try {
    notification.emitReportNew(report);
  } catch {
    /* não bloqueia operação */
  }
  return {
    ok: true,
    data: {
      id: report.id,
      protocol: report.protocol,
      trackingCode: trackingCodePlain,
      companyId: report.companyId,
      status: report.status,
      category: report.category,
      isAnonymous: report.isAnonymous,
      createdAt: report.createdAt
    }
  };
}

function getDashboardMetrics(user, filters = {}) {
  const listed = listReports(user, filters);
  if (!listed.ok) return listed;
  const reports = listed.data;
  const byStatus = {};
  const byCategory = {};
  const byMonth = {};
  let anonymous = 0;
  let identified = 0;

  reports.forEach((r) => {
    byStatus[r.status] = (byStatus[r.status] || 0) + 1;
    byCategory[r.category] = (byCategory[r.category] || 0) + 1;
    const m = (r.createdAt || '').slice(0, 7);
    byMonth[m] = (byMonth[m] || 0) + 1;
    if (r.isAnonymous) anonymous++;
    else identified++;
  });

  const bySector = {};
  reports.forEach((r) => {
    const s = r.sector || 'Não informado';
    bySector[s] = (bySector[s] || 0) + 1;
  });

  const byRisk = riskClassification.riskMetrics(reports);
  const companyId = filters.companyId || (user.role !== 'superadmin' ? user.companyId : null);
  const rawData = store.load();
  const workflowAlerts = workflowService.workflowAlertsForReports(
    rawData.reports || [],
    rawData,
    companyId || null
  );

  return {
    ok: true,
    data: {
      total: reports.length,
      novos: byStatus.recebido || 0,
      emAnalise: byStatus.analise || 0,
      emApuracao: byStatus.apuracao || 0,
      emAcompanhamento: byStatus.acompanhamento || 0,
      concluidos: byStatus.concluido || 0,
      anonymous,
      identified,
      byStatus,
      byCategory,
      byMonth,
      bySector,
      byRisk,
      criticalCount: byRisk.critical || 0,
      highCount: byRisk.high || 0,
      unclassifiedCount: byRisk.unclassified || 0,
      workflowAlerts,
      recent: reports.slice(0, 20)
    }
  };
}

module.exports = {
  listReports,
  getReport,
  getHistory,
  updateStatus,
  assignReport,
  addObservation,
  addMeasureAction,
  createReport,
  getDashboardMetrics,
  tenantIdForUser,
  assertTenantAccess,
  MEASURE_TYPES
};
