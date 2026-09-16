'use strict';

const store = require('../store');
const notification = require('./notification.service');
const riskClassification = require('./risk-classification.service');
const {
  getCompanyWorkflowPolicy,
  isValidStage,
  stageLabel,
  legacyStatusForStage,
  inferStageFromLegacyStatus,
  visualMilestoneForStage,
  stageOrder,
  PRIORITY_LEVELS,
  defaultInvestigationWorkflow
} = require('./workflow-policy.service');
const { hasPermission } = require('../utils/tokens');

function ensureWorkflowHistory(data) {
  data.reportWorkflowHistory = data.reportWorkflowHistory || [];
  return data;
}

function assertReportTenant(user, report) {
  if (!report) return { ok: false, status: 404, error: 'Relato não encontrado.' };
  if (user.role !== 'superadmin' && user.companyId !== report.companyId) {
    return { ok: false, status: 404, error: 'Relato não encontrado.' };
  }
  return { ok: true, report };
}

function initReportWorkflowFields(report, data) {
  const policy = getCompanyWorkflowPolicy(data, report.companyId);
  const now = report.createdAt || new Date().toISOString();
  if (!report.workflowStage) {
    report.workflowStage = inferStageFromLegacyStatus(report.status, report);
  }
  if (!report.workflowStageAt) {
    report.workflowStageAt = now;
  }
  if (!report.priority || !PRIORITY_LEVELS.includes(report.priority)) {
    report.priority = 'normal';
  }
  if (!Array.isArray(report.teamIds)) {
    report.teamIds = report.assigneeId ? [report.assigneeId] : [];
  }
  report.status = legacyStatusForStage(report.workflowStage, policy);
  return report;
}

function historyEntryView(entry, policy) {
  return {
    id: entry.id,
    reportId: entry.reportId,
    previousStage: entry.previousStage,
    previousStageLabel: entry.previousStage ? stageLabel(entry.previousStage, policy) : null,
    newStage: entry.newStage,
    newStageLabel: stageLabel(entry.newStage, policy),
    changedByUserId: entry.changedByUserId,
    changedByUserName: entry.changedByUserName,
    justification: entry.justification || '',
    assigneeIdAtTransition: entry.assigneeIdAtTransition || null,
    durationMs: entry.durationMs ?? null,
    durationLabel: formatDuration(entry.durationMs),
    createdAt: entry.createdAt,
    note: entry.note || null
  };
}

function formatDuration(ms) {
  if (ms == null || ms < 0) return '—';
  const hours = Math.floor(ms / (60 * 60 * 1000));
  if (hours < 24) return `${hours}h`;
  const days = Math.floor(hours / 24);
  return `${days}d ${hours % 24}h`;
}

function getAllowedTransitions(user, report, policy) {
  const current = report.workflowStage;
  const allowed = policy.transitions[current] || [];
  const backwardRoles = policy.rules?.backwardAllowedRoles || ['admin_empresa', 'superadmin'];
  const canGoBack = backwardRoles.includes(user.role);

  return allowed
    .filter((target) => {
      if (stageOrder(target, policy) >= stageOrder(current, policy)) return true;
      return canGoBack;
    })
    .map((target) => ({
      stage: target,
      label: stageLabel(target, policy),
      isBackward: stageOrder(target, policy) < stageOrder(current, policy)
    }));
}

function validateTransition(user, report, targetStage, { justification } = {}, data, policy) {
  if (!isValidStage(targetStage)) {
    return { ok: false, status: 400, error: 'Etapa inválida.' };
  }
  const current = report.workflowStage;
  if (current === targetStage) {
    return { ok: false, status: 400, error: 'O relato já está nesta etapa.' };
  }

  const allowed = (policy.transitions[current] || []).includes(targetStage);
  const isBackward = stageOrder(targetStage, policy) < stageOrder(current, policy);
  const backwardRoles = policy.rules?.backwardAllowedRoles || ['admin_empresa', 'superadmin'];

  if (!allowed) {
    return { ok: false, status: 403, error: 'Transição não permitida neste fluxo.' };
  }
  if (isBackward && !backwardRoles.includes(user.role)) {
    return { ok: false, status: 403, error: 'Retrocesso exige perfil administrativo.' };
  }

  const just = String(justification || '').trim();
  const targetMeta = (policy.stages || []).find((s) => s.id === targetStage);
  const needsJustification =
    (isBackward && policy.rules?.requireJustificationOnBackward !== false) ||
    targetMeta?.requiresJustification ||
    (stageOrder(targetStage, policy) > stageOrder(current, policy) + 1 &&
      policy.rules?.requireJustificationOnSkip !== false);

  if (needsJustification && !just) {
    return { ok: false, status: 400, error: 'Justificativa obrigatória para esta transição.' };
  }

  const requireAssignee = policy.rules?.requireAssigneeBefore || [];
  if (requireAssignee.includes(targetStage) && !report.assigneeId) {
    return {
      ok: false,
      status: 400,
      error: 'Defina um responsável antes de avançar para esta etapa.'
    };
  }

  const requireRisk = policy.rules?.requireRiskBefore || [];
  if (requireRisk.includes(targetStage) && !report.riskLevel) {
    return {
      ok: false,
      status: 400,
      error: 'Classifique o risco antes de avançar para esta etapa.'
    };
  }

  if (targetStage === 'concluido') {
    const riskCheck = riskClassification.validateCriticalConclude(report, data);
    if (!riskCheck.ok) return riskCheck;
  }

  return { ok: true, justification: just };
}

function applyStageToReport(report, targetStage, policy, now) {
  const previousStage = report.workflowStage;
  const stageEnteredAt = report.workflowStageAt || now;
  report.workflowStage = targetStage;
  report.workflowStageAt = now;
  report.status = legacyStatusForStage(targetStage, policy);
  report.updatedAt = now;
  return { previousStage, stageEnteredAt };
}

function transitionReport(user, reportId, body = {}) {
  if (!hasPermission(user, 'reports:transition_workflow')) {
    return { ok: false, status: 403, error: 'Sem permissão para alterar etapa do workflow.' };
  }

  const data = ensureWorkflowHistory(store.load());
  const report = (data.reports || []).find((r) => r.id === reportId);
  const access = assertReportTenant(user, report);
  if (!access.ok) return access;

  initReportWorkflowFields(report, data);
  const policy = getCompanyWorkflowPolicy(data, report.companyId);
  if (!policy.enabled) {
    return { ok: false, status: 400, error: 'Workflow de apuração desativado.' };
  }

  const targetStage = body.stage;
  const validation = validateTransition(user, report, targetStage, body, data, policy);
  if (!validation.ok) return validation;

  const now = new Date().toISOString();
  const { previousStage, stageEnteredAt } = applyStageToReport(report, targetStage, policy, now);

  if (targetStage === 'medidas_adotadas' && body.measuresAdopted) {
    report.measuresAdopted = String(body.measuresAdopted).trim().slice(0, 5000);
  }
  if (targetStage === 'concluido') {
    if (body.conclusionSummary) {
      report.conclusionSummary = String(body.conclusionSummary).trim().slice(0, 5000);
    }
    if (body.measuresAdopted && !report.measuresAdopted) {
      report.measuresAdopted = String(body.measuresAdopted).trim().slice(0, 5000);
    }
  }

  const durationMs = Math.max(0, new Date(now).getTime() - new Date(stageEnteredAt).getTime());

  const historyEntry = {
    id: store.uid('wfh'),
    reportId: report.id,
    companyId: report.companyId,
    protocol: report.protocol,
    previousStage,
    newStage: targetStage,
    changedByUserId: user.id,
    changedByUserName: user.nome,
    justification: validation.justification || '',
    assigneeIdAtTransition: report.assigneeId || null,
    teamIdsAtTransition: [...(report.teamIds || [])],
    durationMs,
    note: body.note ? String(body.note).trim().slice(0, 500) : null,
    createdAt: now
  };

  data.reportWorkflowHistory.push(historyEntry);

  data.reportHistory = data.reportHistory || [];
  data.reportHistory.push({
    id: store.uid('hist'),
    reportId: report.id,
    date: now,
    userId: user.id,
    userName: user.nome,
    action: `Etapa: ${stageLabel(previousStage, policy)} → ${stageLabel(targetStage, policy)}`
  });

  data.auditLogs = data.auditLogs || [];
  data.auditLogs.unshift({
    id: store.uid('aud'),
    date: now,
    userId: user.id,
    userName: user.nome,
    action: 'transicao_workflow',
    resourceType: 'report_workflow',
    resourceId: historyEntry.id,
    companyId: report.companyId,
    protocol: report.protocol,
    previousValue: { stage: previousStage },
    newValue: { stage: targetStage }
  });

  store.save(data);

  try {
    notification.emitReportStatusChanged(report, legacyStatusForStage(previousStage, policy));
  } catch {
    /* ignore */
  }

  return {
    ok: true,
    data: {
      workflowStage: report.workflowStage,
      workflowStageLabel: stageLabel(report.workflowStage, policy),
      status: report.status,
      workflowStageAt: report.workflowStageAt,
      historyEntry: historyEntryView(historyEntry, policy)
    }
  };
}

function getWorkflowState(user, reportId) {
  if (!hasPermission(user, 'reports:read')) {
    return { ok: false, status: 403, error: 'Acesso negado.' };
  }
  const data = ensureWorkflowHistory(store.load());
  const report = (data.reports || []).find((r) => r.id === reportId);
  const access = assertReportTenant(user, report);
  if (!access.ok) return access;

  initReportWorkflowFields(report, data);
  const policy = getCompanyWorkflowPolicy(data, report.companyId);
  const history = (data.reportWorkflowHistory || [])
    .filter((h) => h.reportId === reportId)
    .sort((a, b) => (a.createdAt < b.createdAt ? -1 : 1))
    .map((h) => historyEntryView(h, policy));

  const stageAt = report.workflowStageAt ? new Date(report.workflowStageAt).getTime() : Date.now();
  const elapsedMs = Date.now() - stageAt;
  const stageMeta = (policy.stages || []).find((s) => s.id === report.workflowStage);
  const slaHours = stageMeta?.slaHours;
  let slaStatus = 'ok';
  if (slaHours != null) {
    const slaMs = slaHours * 60 * 60 * 1000;
    if (elapsedMs > slaMs) slaStatus = 'overdue';
    else if (elapsedMs > slaMs * 0.8) slaStatus = 'warning';
  }

  return {
    ok: true,
    current: {
      stage: report.workflowStage,
      label: stageLabel(report.workflowStage, policy),
      since: report.workflowStageAt,
      elapsedMs,
      milestone: visualMilestoneForStage(report.workflowStage, policy),
      slaHours,
      slaStatus,
      priority: report.priority,
      dueAt: report.dueAt || null,
      assigneeId: report.assigneeId,
      teamIds: report.teamIds || []
    },
    allowedTransitions: getAllowedTransitions(user, report, policy),
    history,
    milestones: policy.visualMilestones
  };
}

function buildVisualTimeline(reportId, data, policy) {
  const history = (data.reportWorkflowHistory || [])
    .filter((h) => h.reportId === reportId)
    .sort((a, b) => (a.createdAt < b.createdAt ? -1 : 1));

  const report = (data.reports || []).find((r) => r.id === reportId);
  const milestones = policy.visualMilestones || [];
  const now = Date.now();
  const currentOrder = stageOrder(report?.workflowStage, policy);

  return milestones.map((milestone) => {
    const stageEntries = history.filter((h) => milestone.stages.includes(h.newStage));
    const lastEntry = stageEntries[stageEntries.length - 1];
    const isActive = milestone.stages.includes(report?.workflowStage);
    const maxMilestoneOrder = Math.max(...milestone.stages.map((s) => stageOrder(s, policy)));
    const isDone = currentOrder > maxMilestoneOrder || report?.workflowStage === 'concluido';

    let durationMs = null;
    if (lastEntry) {
      durationMs = lastEntry.durationMs;
    } else if (isActive && report?.workflowStageAt) {
      durationMs = now - new Date(report.workflowStageAt).getTime();
    }

    return {
      id: milestone.id,
      label: milestone.label,
      state: isActive ? 'active' : isDone ? 'done' : '',
      date: lastEntry?.createdAt || (isActive ? report.workflowStageAt : null),
      responsible: lastEntry?.changedByUserName || null,
      durationMs,
      durationLabel: formatDuration(durationMs),
      note: lastEntry?.justification || lastEntry?.note || null
    };
  });
}

function getVisualTimeline(user, reportId) {
  const state = getWorkflowState(user, reportId);
  if (!state.ok) return state;
  const data = store.load();
  const report = (data.reports || []).find((r) => r.id === reportId);
  const policy = getCompanyWorkflowPolicy(data, report.companyId);
  return {
    ok: true,
    timeline: buildVisualTimeline(reportId, data, policy),
    current: state.current
  };
}

function updateReportMeta(user, reportId, patch = {}) {
  const data = store.load();
  const report = (data.reports || []).find((r) => r.id === reportId);
  const access = assertReportTenant(user, report);
  if (!access.ok) return access;

  if (patch.priority !== undefined) {
    if (user.role !== 'admin_empresa' && user.role !== 'superadmin' && user.role !== 'apurador') {
      return { ok: false, status: 403, error: 'Sem permissão.' };
    }
    if (!PRIORITY_LEVELS.includes(patch.priority)) {
      return { ok: false, status: 400, error: 'Prioridade inválida.' };
    }
    report.priority = patch.priority;
  }

  if (patch.dueAt !== undefined) {
    if (user.role !== 'admin_empresa' && user.role !== 'superadmin') {
      return { ok: false, status: 403, error: 'Sem permissão para definir prazo.' };
    }
    report.dueAt = patch.dueAt || null;
  }

  if (patch.teamIds !== undefined) {
    if (user.role !== 'admin_empresa' && user.role !== 'superadmin') {
      return { ok: false, status: 403, error: 'Sem permissão para equipe.' };
    }
    report.teamIds = Array.isArray(patch.teamIds) ? patch.teamIds.slice(0, 10) : [];
  }

  report.updatedAt = new Date().toISOString();
  store.save(data);
  return { ok: true, data: { priority: report.priority, dueAt: report.dueAt, teamIds: report.teamIds } };
}

function migrateReportWorkflow(report, data) {
  initReportWorkflowFields(report, data);
}

function workflowAlertsForReports(reports, data, companyId = null) {
  const now = Date.now();
  const alerts = {
    noAssignee: 0,
    stalled: 0,
    slaWarning: 0,
    slaOverdue: 0,
    criticalRisk: 0,
    awaitingInfo: 0,
    dueSoon: 0,
    dueOverdue: 0
  };
  const policyCache = new Map();

  reports.forEach((r) => {
    if (companyId && r.companyId !== companyId) return;
    if (r.workflowStage === 'concluido') return;

    let policy = policyCache.get(r.companyId);
    if (!policy) {
      policy = getCompanyWorkflowPolicy(data, r.companyId);
      policyCache.set(r.companyId, policy);
    }
    const stalledMs = (policy.rules?.stalledHours || 120) * 60 * 60 * 1000;

    initReportWorkflowFields(r, data);

    if (!r.assigneeId && stageOrder(r.workflowStage, policy) >= stageOrder('triagem', policy)) {
      alerts.noAssignee += 1;
    }
    if (r.riskLevel === 'critical') alerts.criticalRisk += 1;
    if (r.workflowStage === 'aguardando_informacoes') alerts.awaitingInfo += 1;

    const stageAt = r.workflowStageAt ? new Date(r.workflowStageAt).getTime() : now;
    if (now - stageAt > stalledMs) alerts.stalled += 1;

    const stageMeta = (policy.stages || []).find((s) => s.id === r.workflowStage);
    if (stageMeta?.slaHours) {
      const slaMs = stageMeta.slaHours * 60 * 60 * 1000;
      const elapsed = now - stageAt;
      if (elapsed > slaMs) alerts.slaOverdue += 1;
      else if (elapsed > slaMs * 0.8) alerts.slaWarning += 1;
    }

    if (r.dueAt) {
      const due = new Date(r.dueAt).getTime();
      if (now > due) alerts.dueOverdue += 1;
      else if (due - now < 48 * 60 * 60 * 1000) alerts.dueSoon += 1;
    }
  });

  return alerts;
}

module.exports = {
  initReportWorkflowFields,
  migrateReportWorkflow,
  transitionReport,
  getWorkflowState,
  getVisualTimeline,
  updateReportMeta,
  workflowAlertsForReports,
  defaultInvestigationWorkflow
};
