'use strict';

/** Etapas internas do workflow de apuração (Etapa 09) */
const WORKFLOW_STAGES = [
  'recebido',
  'triagem',
  'classificacao_risco',
  'responsavel_definido',
  'em_apuracao',
  'aguardando_informacoes',
  'analise_parecer',
  'medidas_adotadas',
  'concluido'
];

const STAGE_LABELS = {
  recebido: 'Recebido',
  triagem: 'Triagem',
  classificacao_risco: 'Classificação de risco',
  responsavel_definido: 'Responsável definido',
  em_apuracao: 'Em apuração',
  aguardando_informacoes: 'Aguardando informações',
  analise_parecer: 'Análise / parecer',
  medidas_adotadas: 'Medidas adotadas',
  concluido: 'Concluído'
};

const PRIORITY_LEVELS = ['normal', 'alta', 'urgente'];

const DEFAULT_STATUS_MAP = {
  recebido: 'recebido',
  triagem: 'analise',
  classificacao_risco: 'analise',
  responsavel_definido: 'analise',
  em_apuracao: 'apuracao',
  aguardando_informacoes: 'apuracao',
  analise_parecer: 'acompanhamento',
  medidas_adotadas: 'acompanhamento',
  concluido: 'concluido'
};

/** Marcos visuais (5) agrupando etapas internas */
const DEFAULT_VISUAL_MILESTONES = [
  { id: 'recebido', label: 'Recebido', stages: ['recebido'] },
  { id: 'triagem', label: 'Triagem', stages: ['triagem', 'classificacao_risco', 'responsavel_definido'] },
  { id: 'apuracao', label: 'Apuração', stages: ['em_apuracao', 'aguardando_informacoes'] },
  { id: 'parecer', label: 'Parecer', stages: ['analise_parecer', 'medidas_adotadas'] },
  { id: 'conclusao', label: 'Conclusão', stages: ['concluido'] }
];

const DEFAULT_TRANSITIONS = {
  recebido: ['triagem'],
  triagem: ['classificacao_risco', 'em_apuracao'],
  classificacao_risco: ['responsavel_definido', 'triagem'],
  responsavel_definido: ['em_apuracao', 'classificacao_risco'],
  em_apuracao: ['aguardando_informacoes', 'analise_parecer'],
  aguardando_informacoes: ['em_apuracao', 'analise_parecer'],
  analise_parecer: ['medidas_adotadas', 'em_apuracao'],
  medidas_adotadas: ['concluido', 'analise_parecer'],
  concluido: []
};

const DEFAULT_STAGE_META = {
  recebido: { order: 1, slaHours: 24, requiresJustification: false },
  triagem: { order: 2, slaHours: 48, requiresJustification: false },
  classificacao_risco: { order: 3, slaHours: 48, requiresJustification: false },
  responsavel_definido: { order: 4, slaHours: 24, requiresJustification: false },
  em_apuracao: { order: 5, slaHours: 120, requiresJustification: false },
  aguardando_informacoes: { order: 6, slaHours: 72, requiresJustification: false },
  analise_parecer: { order: 7, slaHours: 72, requiresJustification: false },
  medidas_adotadas: { order: 8, slaHours: 48, requiresJustification: false },
  concluido: { order: 9, slaHours: null, requiresJustification: true }
};

const LEGACY_STATUS_TO_STAGE = {
  recebido: 'recebido',
  analise: 'triagem',
  apuracao: 'em_apuracao',
  acompanhamento: 'analise_parecer',
  concluido: 'concluido'
};

function defaultInvestigationWorkflow() {
  return {
    enabled: true,
    stages: WORKFLOW_STAGES.map((id) => ({
      id,
      label: STAGE_LABELS[id],
      ...DEFAULT_STAGE_META[id]
    })),
    transitions: JSON.parse(JSON.stringify(DEFAULT_TRANSITIONS)),
    statusMapping: { ...DEFAULT_STATUS_MAP },
    visualMilestones: JSON.parse(JSON.stringify(DEFAULT_VISUAL_MILESTONES)),
    rules: {
      requireAssigneeBefore: ['em_apuracao', 'analise_parecer', 'medidas_adotadas', 'concluido'],
      requireRiskBefore: ['responsavel_definido', 'em_apuracao'],
      requireJustificationOnBackward: true,
      requireJustificationOnSkip: true,
      backwardAllowedRoles: ['admin_empresa', 'superadmin'],
      stalledHours: 120
    }
  };
}

function getCompanyWorkflowPolicy(data, companyId) {
  const stored = data.companySettings?.[companyId]?.investigationWorkflow;
  const defaults = defaultInvestigationWorkflow();
  if (!stored) return defaults;
  return {
    ...defaults,
    ...stored,
    transitions: { ...defaults.transitions, ...(stored.transitions || {}) },
    statusMapping: { ...defaults.statusMapping, ...(stored.statusMapping || {}) },
    rules: { ...defaults.rules, ...(stored.rules || {}) },
    visualMilestones: stored.visualMilestones?.length
      ? stored.visualMilestones
      : defaults.visualMilestones
  };
}

function isValidStage(stage) {
  return WORKFLOW_STAGES.includes(stage);
}

function stageLabel(stage, policy) {
  const row = (policy?.stages || []).find((s) => s.id === stage);
  return row?.label || STAGE_LABELS[stage] || stage;
}

function legacyStatusForStage(stage, policy) {
  return policy?.statusMapping?.[stage] || DEFAULT_STATUS_MAP[stage] || 'analise';
}

function inferStageFromLegacyStatus(status, report) {
  if (report?.workflowStage && isValidStage(report.workflowStage)) {
    return report.workflowStage;
  }
  if (status === 'analise' && report?.riskLevel && report?.assigneeId) {
    return 'responsavel_definido';
  }
  if (status === 'analise' && report?.riskLevel) {
    return 'classificacao_risco';
  }
  return LEGACY_STATUS_TO_STAGE[status] || 'recebido';
}

function visualMilestoneForStage(stage, policy) {
  const milestones = policy?.visualMilestones || DEFAULT_VISUAL_MILESTONES;
  return milestones.find((m) => m.stages.includes(stage)) || milestones[0];
}

function stageOrder(stage, policy) {
  const row = (policy?.stages || []).find((s) => s.id === stage);
  return row?.order ?? WORKFLOW_STAGES.indexOf(stage) + 1;
}

module.exports = {
  WORKFLOW_STAGES,
  STAGE_LABELS,
  PRIORITY_LEVELS,
  DEFAULT_STATUS_MAP,
  DEFAULT_VISUAL_MILESTONES,
  LEGACY_STATUS_TO_STAGE,
  defaultInvestigationWorkflow,
  getCompanyWorkflowPolicy,
  isValidStage,
  stageLabel,
  legacyStatusForStage,
  inferStageFromLegacyStatus,
  visualMilestoneForStage,
  stageOrder
};
