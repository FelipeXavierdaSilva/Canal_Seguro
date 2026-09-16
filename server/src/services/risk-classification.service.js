'use strict';

const store = require('../store');
const notification = require('./notification.service');
const {
  getCompanyRiskPolicy,
  isValidRiskLevel,
  riskLevelSortWeight,
  defaultRiskClassificationSettings
} = require('./risk-policy.service');
const { hasPermission } = require('../utils/tokens');

const JUSTIFICATION_MAX = 2000;

function ensureHistory(data) {
  data.reportRiskHistory = data.reportRiskHistory || [];
  return data;
}

function canClassifyLevel(user, level, policy) {
  if (!hasPermission(user, 'reports:classify_risk')) return false;
  const criticalRoles = policy.permissions?.criticalOnlyRoles || ['admin_empresa', 'superadmin'];
  if (level === 'critical' && !criticalRoles.includes(user.role)) {
    return false;
  }
  return true;
}

function assertReportTenant(user, report) {
  if (!report) return { ok: false, status: 404, error: 'Relato não encontrado.' };
  if (user.role !== 'superadmin' && user.companyId !== report.companyId) {
    return { ok: false, status: 404, error: 'Relato não encontrado.' };
  }
  return { ok: true, report };
}

function historyView(entry, policy) {
  const levelMeta = policy.levels?.[entry.level] || {};
  const prevMeta = entry.previousLevel ? policy.levels?.[entry.previousLevel] || {} : null;
  return {
    id: entry.id,
    reportId: entry.reportId,
    level: entry.level,
    levelLabel: levelMeta.label || entry.level,
    previousLevel: entry.previousLevel,
    previousLevelLabel: prevMeta ? prevMeta.label || entry.previousLevel : null,
    factors: entry.factors || [],
    justification: entry.justification,
    classifiedByUserId: entry.classifiedByUserId,
    classifiedByUserName: entry.classifiedByUserName,
    source: entry.source,
    createdAt: entry.createdAt
  };
}

function listHistory(user, reportId) {
  if (!hasPermission(user, 'reports:read')) {
    return { ok: false, status: 403, error: 'Acesso negado.' };
  }
  const data = ensureHistory(store.load());
  const report = (data.reports || []).find((r) => r.id === reportId);
  const access = assertReportTenant(user, report);
  if (!access.ok) return access;

  const policy = getCompanyRiskPolicy(data, report.companyId);
  const list = (data.reportRiskHistory || [])
    .filter((h) => h.reportId === reportId)
    .sort((a, b) => (a.createdAt < b.createdAt ? 1 : -1))
    .map((h) => historyView(h, policy));

  return { ok: true, history: list };
}

function normalizeFactors(factorIds, policy) {
  const allowed = new Set((policy.factors || []).map((f) => f.id));
  return [...new Set((factorIds || []).filter((id) => allowed.has(id)))];
}

function suggestRisk(report, data, policy) {
  if (!policy.suggestion?.enabled) {
    return {
      suggestedLevel: null,
      score: 0,
      matchedFactors: [],
      disclaimer:
        'Sugestão auxiliar desativada. A classificação oficial é responsabilidade do profissional autorizado.'
    };
  }

  let score = 0;
  const matched = new Set();
  const text = `${report.description || ''} ${report.involved || ''} ${report.location || ''}`.toLowerCase();

  const catBoost = policy.suggestion.categoryBoost?.[report.category];
  if (catBoost) {
    score += catBoost;
    if (report.category === 'violencia') matched.add('violence');
    if (report.category === 'assedio_sexual') matched.add('sexual_harassment');
    if (report.category === 'ameaca') matched.add('immediate_risk');
    if (report.category === 'discriminacao') matched.add('discrimination');
  }

  Object.entries(policy.suggestion.keywordBoost || {}).forEach(([kw, boost]) => {
    if (text.includes(kw.toLowerCase())) {
      score += boost;
      if (kw.includes('arma') || kw.includes('amea')) matched.add('immediate_risk');
      if (kw.includes('supervisor') || kw.includes('gerente') || kw.includes('diretor')) {
        matched.add('leadership_involvement');
      }
    }
  });

  if ((report.attachments || []).length > 0) {
    score += 12;
    matched.add('evidence_exists');
  }

  if ((report.involved || '').match(/vários|duas|dois|equipe|grupo/i)) {
    score += 10;
    matched.add('multiple_people');
  }

  const windowDays = policy.suggestion.recurrenceWindowDays || 180;
  const minReports = policy.suggestion.recurrenceMinReports || 2;
  const cutoff = Date.now() - windowDays * 24 * 60 * 60 * 1000;
  const similar = (data.reports || []).filter(
    (r) =>
      r.id !== report.id &&
      r.companyId === report.companyId &&
      r.category === report.category &&
      (r.sector || '') === (report.sector || '') &&
      new Date(r.createdAt).getTime() >= cutoff
  );
  if (similar.length >= minReports - 1) {
    score += 18;
    matched.add('recurrence');
  }

  const thresholds = policy.suggestion.thresholds || { low: 15, moderate: 35, high: 60, critical: 85 };
  let suggestedLevel = 'low';
  if (score >= thresholds.critical) suggestedLevel = 'critical';
  else if (score >= thresholds.high) suggestedLevel = 'high';
  else if (score >= thresholds.moderate) suggestedLevel = 'moderate';

  return {
    suggestedLevel,
    score,
    matchedFactors: [...matched],
    disclaimer:
      'Sugestão auxiliar — não constitui diagnóstico automático. A classificação oficial é responsabilidade do profissional autorizado.'
  };
}

function getSuggestion(user, reportId) {
  if (!hasPermission(user, 'reports:read')) {
    return { ok: false, status: 403, error: 'Acesso negado.' };
  }
  const data = store.load();
  const report = (data.reports || []).find((r) => r.id === reportId);
  const access = assertReportTenant(user, report);
  if (!access.ok) return access;

  const policy = getCompanyRiskPolicy(data, report.companyId);
  const suggestion = suggestRisk(report, data, policy);
  return { ok: true, suggestion, policy: { factors: policy.factors, levels: policy.levels } };
}

function classifyReport(user, reportId, body = {}) {
  if (!hasPermission(user, 'reports:classify_risk')) {
    return { ok: false, status: 403, error: 'Sem permissão para classificar risco.' };
  }

  const level = body.level;
  if (!isValidRiskLevel(level)) {
    return { ok: false, status: 400, error: 'Nível de risco inválido.' };
  }

  const justification = String(body.justification || '').trim();
  if (!justification) {
    return { ok: false, status: 400, error: 'Justificativa obrigatória.' };
  }
  if (justification.length > JUSTIFICATION_MAX) {
    return { ok: false, status: 400, error: 'Justificativa muito longa.' };
  }

  const data = ensureHistory(store.load());
  const report = (data.reports || []).find((r) => r.id === reportId);
  const access = assertReportTenant(user, report);
  if (!access.ok) return access;

  const policy = getCompanyRiskPolicy(data, report.companyId);
  if (!policy.enabled) {
    return { ok: false, status: 400, error: 'Classificação de risco desativada para esta empresa.' };
  }
  if (!canClassifyLevel(user, level, policy)) {
    return {
      ok: false,
      status: 403,
      error: 'Apenas administradores podem classificar como Crítico.'
    };
  }

  const factors = normalizeFactors(body.factors, policy);
  const previousLevel = report.riskLevel || null;
  const now = new Date().toISOString();
  const isReclassification = Boolean(previousLevel);

  const historyEntry = {
    id: store.uid('rrh'),
    reportId: report.id,
    companyId: report.companyId,
    protocol: report.protocol,
    level,
    previousLevel,
    factors,
    justification,
    classifiedByUserId: user.id,
    classifiedByUserName: user.nome,
    source: isReclassification ? 'reclassification' : 'manual',
    suggestionSnapshot: body.suggestionSnapshot || null,
    createdAt: now
  };

  report.riskLevel = level;
  report.riskClassifiedAt = now;
  report.riskClassifiedByUserId = user.id;
  report.updatedAt = now;

  data.reportRiskHistory.push(historyEntry);

  data.auditLogs = data.auditLogs || [];
  data.auditLogs.unshift({
    id: store.uid('aud'),
    date: now,
    userId: user.id,
    userName: user.nome,
    action: isReclassification ? 'reclassificacao_risco' : 'classificacao_risco',
    resourceType: 'report_risk',
    resourceId: historyEntry.id,
    companyId: report.companyId,
    protocol: report.protocol,
    previousValue: previousLevel ? { level: previousLevel } : undefined,
    newValue: { level, factorCount: factors.length }
  });

  store.save(data);

  if (level === 'critical') {
    try {
      notification.emitRiskCritical(report);
    } catch {
      /* não bloqueia */
    }
  }

  const levelMeta = policy.levels?.[level] || {};
  return {
    ok: true,
    data: {
      riskLevel: level,
      riskLevelLabel: levelMeta.label || level,
      riskClassifiedAt: now,
      riskClassifiedByUserId: user.id,
      historyEntry: historyView(historyEntry, policy)
    }
  };
}

function getRiskPolicy(user, companyId) {
  if (!user) return { ok: false, status: 401, error: 'Não autenticado.' };
  if (user.role === 'admin_empresa' && user.companyId !== companyId) {
    return { ok: false, status: 403, error: 'Acesso negado.' };
  }
  if (user.role !== 'superadmin' && user.role !== 'admin_empresa') {
    return { ok: false, status: 403, error: 'Acesso negado.' };
  }
  const data = store.load();
  const policy = getCompanyRiskPolicy(data, companyId);
  return { ok: true, policy };
}

function updateRiskPolicy(user, companyId, patch) {
  if (!user) return { ok: false, status: 401, error: 'Não autenticado.' };
  if (user.role === 'admin_empresa' && user.companyId !== companyId) {
    return { ok: false, status: 403, error: 'Acesso negado.' };
  }
  if (user.role !== 'superadmin' && user.role !== 'admin_empresa') {
    return { ok: false, status: 403, error: 'Acesso negado.' };
  }

  const data = store.load();
  data.companySettings = data.companySettings || {};
  data.companySettings[companyId] = data.companySettings[companyId] || {};
  const prev = getCompanyRiskPolicy(data, companyId);
  const next = {
    ...prev,
    ...patch,
    levels: { ...prev.levels, ...(patch.levels || {}) },
    priorityRules: { ...prev.priorityRules, ...(patch.priorityRules || {}) },
    suggestion: { ...prev.suggestion, ...(patch.suggestion || {}) },
    permissions: { ...prev.permissions, ...(patch.permissions || {}) }
  };
  if (Array.isArray(patch.factors) && patch.factors.length) {
    next.factors = patch.factors;
  }
  data.companySettings[companyId].riskClassification = next;

  data.auditLogs = data.auditLogs || [];
  data.auditLogs.unshift({
    id: store.uid('aud'),
    date: new Date().toISOString(),
    userId: user.id,
    userName: user.nome,
    action: 'politica_risco_alterada',
    resourceType: 'company_settings',
    resourceId: companyId,
    companyId
  });

  store.save(data);
  return { ok: true, policy: next };
}

function validateCriticalConclude(report, data) {
  if (report.riskLevel !== 'critical') return { ok: true };
  const policy = getCompanyRiskPolicy(data, report.companyId);
  const rules = policy.priorityRules?.critical || {};
  if (rules.blockConcludeWithoutAssignee && !report.assigneeId) {
    return {
      ok: false,
      status: 400,
      message: 'Relatos classificados como Crítico exigem responsável atribuído antes da conclusão.'
    };
  }
  return { ok: true };
}

function sortReportsByRisk(list) {
  return [...list].sort((a, b) => {
    const wa = riskLevelSortWeight(a.riskLevel);
    const wb = riskLevelSortWeight(b.riskLevel);
    if (wb !== wa) return wb - wa;
    return (a.updatedAt || a.createdAt) < (b.updatedAt || b.createdAt) ? 1 : -1;
  });
}

function riskMetrics(reports) {
  const byRisk = { low: 0, moderate: 0, high: 0, critical: 0, unclassified: 0 };
  reports.forEach((r) => {
    if (!r.riskLevel) byRisk.unclassified++;
    else if (byRisk[r.riskLevel] !== undefined) byRisk[r.riskLevel]++;
  });
  return byRisk;
}

module.exports = {
  classifyReport,
  getSuggestion,
  listHistory,
  getRiskPolicy,
  updateRiskPolicy,
  validateCriticalConclude,
  sortReportsByRisk,
  riskMetrics,
  canClassifyLevel,
  defaultRiskClassificationSettings
};
