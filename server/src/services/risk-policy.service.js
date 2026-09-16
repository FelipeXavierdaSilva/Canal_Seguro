'use strict';

const RISK_LEVELS = ['low', 'moderate', 'high', 'critical'];

const DEFAULT_FACTORS = [
  { id: 'physical_integrity', label: 'Ameaça à integridade física', weight: 40 },
  { id: 'violence', label: 'Violência', weight: 35 },
  { id: 'sexual_harassment', label: 'Assédio sexual', weight: 35 },
  { id: 'immediate_risk', label: 'Risco imediato', weight: 45 },
  { id: 'leadership_involvement', label: 'Envolvimento de liderança', weight: 25 },
  { id: 'discrimination', label: 'Discriminação', weight: 20 },
  { id: 'reputational_risk', label: 'Risco reputacional', weight: 15 },
  { id: 'legal_risk', label: 'Risco jurídico', weight: 20 },
  { id: 'security_risk', label: 'Risco de segurança', weight: 30 },
  { id: 'recurrence', label: 'Reincidência', weight: 25 },
  { id: 'evidence_exists', label: 'Existência de evidências', weight: 15 },
  { id: 'multiple_people', label: 'Envolvimento de múltiplas pessoas', weight: 20 }
];

const DEFAULT_LEVELS = {
  low: { label: 'Baixo', color: '#2d8a5e', sortOrder: 1, icon: '🟢' },
  moderate: { label: 'Moderado', color: '#c9894a', sortOrder: 2, icon: '🟡' },
  high: { label: 'Alto', color: '#d97706', sortOrder: 3, icon: '🟠' },
  critical: { label: 'Crítico', color: '#c53030', sortOrder: 4, icon: '🔴' }
};

const DEFAULT_PRIORITY_RULES = {
  critical: {
    alertImmediate: true,
    requireAssignee: true,
    blockConcludeWithoutAssignee: true,
    reducedSlaHours: 4,
    pinToTop: true,
    notifyRoles: ['admin_empresa', 'apurador']
  },
  high: {
    alertImmediate: false,
    requireAssignee: false,
    blockConcludeWithoutAssignee: false,
    reducedSlaHours: 24,
    pinToTop: true,
    notifyRoles: ['admin_empresa', 'apurador']
  },
  moderate: {
    alertImmediate: false,
    requireAssignee: false,
    blockConcludeWithoutAssignee: false,
    reducedSlaHours: 72,
    pinToTop: false,
    notifyRoles: []
  },
  low: {
    alertImmediate: false,
    requireAssignee: false,
    blockConcludeWithoutAssignee: false,
    reducedSlaHours: null,
    pinToTop: false,
    notifyRoles: []
  }
};

const DEFAULT_SUGGESTION = {
  enabled: true,
  thresholds: { low: 15, moderate: 35, high: 60, critical: 85 },
  categoryBoost: {
    violencia: 35,
    assedio_sexual: 40,
    ameaca: 38,
    assedio_moral: 18,
    discriminacao: 22,
    retaliacao: 25
  },
  keywordBoost: {
    arma: 25,
    ameaçou: 20,
    ameacou: 20,
    hoje: 12,
    agora: 10,
    supervisor: 8,
    gerente: 8,
    diretor: 10
  },
  recurrenceWindowDays: 180,
  recurrenceMinReports: 2
};

function defaultRiskClassificationSettings() {
  return {
    enabled: true,
    levels: JSON.parse(JSON.stringify(DEFAULT_LEVELS)),
    factors: JSON.parse(JSON.stringify(DEFAULT_FACTORS)),
    priorityRules: JSON.parse(JSON.stringify(DEFAULT_PRIORITY_RULES)),
    suggestion: JSON.parse(JSON.stringify(DEFAULT_SUGGESTION)),
    permissions: {
      criticalOnlyRoles: ['admin_empresa', 'superadmin']
    }
  };
}

function getCompanyRiskPolicy(data, companyId) {
  const stored = data.companySettings?.[companyId]?.riskClassification;
  const defaults = defaultRiskClassificationSettings();
  if (!stored) return defaults;
  return {
    ...defaults,
    ...stored,
    levels: { ...defaults.levels, ...(stored.levels || {}) },
    factors: stored.factors?.length ? stored.factors : defaults.factors,
    priorityRules: { ...defaults.priorityRules, ...(stored.priorityRules || {}) },
    suggestion: { ...defaults.suggestion, ...(stored.suggestion || {}) },
    permissions: { ...defaults.permissions, ...(stored.permissions || {}) }
  };
}

function riskLevelSortWeight(level) {
  const map = { critical: 4, high: 3, moderate: 2, low: 1 };
  return map[level] || 0;
}

function isValidRiskLevel(level) {
  return RISK_LEVELS.includes(level);
}

module.exports = {
  RISK_LEVELS,
  DEFAULT_FACTORS,
  DEFAULT_LEVELS,
  defaultRiskClassificationSettings,
  getCompanyRiskPolicy,
  riskLevelSortWeight,
  isValidRiskLevel
};
