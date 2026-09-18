/**
 * Gera server/data/store.json a partir do seed do protótipo (js/seed.js).
 * Executar: npm run seed
 */
const fs = require('fs');
const path = require('path');
const vm = require('vm');
const bcrypt = require('bcryptjs');
const { defaultCompanyEmailSettings } = require('../src/email/policy.service');
const { defaultRiskClassificationSettings } = require('../src/services/risk-policy.service');
const { defaultInvestigationWorkflow } = require('../src/services/workflow.service');
const {
  inferStageFromLegacyStatus,
  legacyStatusForStage,
  getCompanyWorkflowPolicy
} = require('../src/services/workflow-policy.service');
const { hashTrackingCode } = require('../src/utils/tracking-crypto');
const { hashCpf, normalizeCpf } = require('../src/utils/cpf-crypto');

const root = path.join(__dirname, '..', '..');
const seedPath = path.join(root, 'js', 'seed.js');
const { resolveStorePath, resolveStoreSeedPath, resolveDataDir } = require('../src/store-path');
const outPath = resolveStorePath();

const seedSrc = fs.readFileSync(seedPath, 'utf8');

const DEMO_CATEGORIES = [
  { id: 'assedio_moral', label: 'Assédio moral' },
  { id: 'assedio_sexual', label: 'Assédio sexual' },
  { id: 'discriminacao', label: 'Discriminação' },
  { id: 'violencia', label: 'Violência' },
  { id: 'ameaca', label: 'Ameaça' },
  { id: 'comportamento_ofensivo', label: 'Comportamento ofensivo' },
  { id: 'constrangimento', label: 'Constrangimento' },
  { id: 'retaliacao', label: 'Retaliação' },
  { id: 'outro', label: 'Outro' }
];

const DEMO_STATUSES = [
  { id: 'recebido', label: 'Relato recebido', order: 1 },
  { id: 'analise', label: 'Em análise', order: 2 },
  { id: 'apuracao', label: 'Em apuração', order: 3 },
  { id: 'acompanhamento', label: 'Em acompanhamento', order: 4 },
  { id: 'concluido', label: 'Concluído', order: 5 }
];

function maxProtocolCounterForCompany(reports, companyId) {
  let maxCounter = 100;
  (reports || [])
    .filter((r) => r.companyId === companyId)
    .forEach((r) => {
      const match = String(r.protocol || '').match(/(\d+)\s*$/);
      if (match) maxCounter = Math.max(maxCounter, parseInt(match[1], 10));
    });
  return maxCounter;
}

function buildCompanySettings(companies, reports, defaultPrefix = 'CS') {
  const map = {};
  (companies || []).forEach((c) => {
    map[c.id] = {
      protocolPrefix: defaultPrefix,
      protocolCounter: maxProtocolCounterForCompany(reports, c.id)
    };
  });
  return map;
}

const helperStart = seedSrc.indexOf('const WORKFLOW_STAGE_LABELS');
const start = seedSrc.indexOf('function createDemoData()');
const loadStart = seedSrc.indexOf('function loadStore()');
if (start < 0 || loadStart < 0) {
  throw new Error('Não foi possível localizar createDemoData() em js/seed.js');
}

const fnCode = seedSrc.slice(helperStart >= 0 ? helperStart : start, loadStart);
const sandbox = {
  DEMO_CATEGORIES,
  DEMO_STATUSES,
  maxProtocolCounterForCompany,
  buildCompanySettings,
  Date,
  Math,
  console
};

vm.runInNewContext(fnCode, sandbox);
const data = sandbox.createDemoData();

const supportFaq = require('../src/services/support-faq.service');
supportFaq.ensureFaqs(data);

data.users = data.users.map((u) => {
  const { senha, ...rest } = u;
  return {
    ...rest,
    passwordHash: bcrypt.hashSync(senha, 10),
    sessionVersion: rest.sessionVersion || 1,
    mfa: rest.mfa || { enabled: false, secretEnc: null, recoveryCodes: [], enrolledAt: null }
  };
});

data.passwordResetTokens = [];
data.emailQueue = [];
data.emailDeliveryLogs = [];
data.emailDedupeKeys = [];
data.emailSuppressions = [];

(data.reports || []).forEach((r) => {
  if (r.trackingCode && !r.trackingCodeHash) {
    r.trackingCodeHash = hashTrackingCode(r.trackingCode);
    delete r.trackingCode;
  }
});

(data.employees || []).forEach((e) => {
  const digits = normalizeCpf(e.cpf);
  if (digits.length === 11) {
    e.cpfHash = hashCpf(digits);
  }
  delete e.cpf;
});

data.reportMessages = data.reportMessages || [
  {
    id: 'msg_demo_1',
    reportId: 'rpt_001',
    direction: 'company',
    messageType: 'info_request',
    body: 'Precisamos de mais detalhes sobre o horário aproximado do ocorrido. Responda por esta caixa de mensagens.',
    attachments: [],
    status: 'sent',
    authorLabel: 'Equipe responsável',
    actorUserId: 'usr_aurora_admin',
    createdAt: '2026-01-15T14:30:00.000Z',
    deliveredAt: null,
    readAt: null
  }
];

const rpt001 = (data.reports || []).find((r) => r.id === 'rpt_001');
if (rpt001) {
  rpt001.riskLevel = 'critical';
  rpt001.riskClassifiedAt = '2026-07-16T09:00:00.000Z';
  rpt001.riskClassifiedByUserId = 'usr_aurora_admin';
}
const rptHigh = (data.reports || []).find((r) => r.id === 'rpt_002');
if (rptHigh) {
  rptHigh.riskLevel = 'high';
  rptHigh.riskClassifiedAt = '2026-07-20T11:00:00.000Z';
  rptHigh.riskClassifiedByUserId = 'usr_aurora_ap';
}

data.reportRiskHistory = [
  {
    id: 'rrh_demo_1',
    reportId: 'rpt_001',
    companyId: 'cmp_aurora',
    protocol: 'CS-2026-000101',
    level: 'critical',
    previousLevel: null,
    factors: ['physical_integrity', 'leadership_involvement', 'recurrence'],
    justification:
      'Relato descreve cobranças públicas reiteradas com possível retaliação e envolvimento de supervisor. Priorizar apuração.',
    classifiedByUserId: 'usr_aurora_admin',
    classifiedByUserName: 'Carla Admin',
    source: 'manual',
    suggestionSnapshot: null,
    createdAt: '2026-07-16T09:00:00.000Z'
  }
];
if (rptHigh) {
  data.reportRiskHistory.push({
    id: 'rrh_demo_2',
    reportId: rptHigh.id,
    companyId: rptHigh.companyId,
    protocol: rptHigh.protocol,
    level: 'high',
    previousLevel: null,
    factors: ['discrimination', 'evidence_exists'],
    justification: 'Comportamento ofensivo reiterado com anexo. Prioridade elevada na triagem.',
    classifiedByUserId: 'usr_aurora_ap',
    classifiedByUserName: 'Paulo Apurador',
    source: 'manual',
    suggestionSnapshot: null,
    createdAt: '2026-07-20T11:00:00.000Z'
  });
}

data.reportWorkflowHistory = data.reportWorkflowHistory || [];
(data.reports || []).forEach((r) => {
  const policy = getCompanyWorkflowPolicy(data, r.companyId);
  if (!r.workflowStage) {
    r.workflowStage = inferStageFromLegacyStatus(r.status, r);
  }
  r.workflowStageAt = r.workflowStageAt || r.updatedAt || r.createdAt;
  r.priority = r.priority || 'normal';
  r.teamIds = r.teamIds || (r.assigneeId ? [r.assigneeId] : []);
  r.dueAt = r.dueAt || null;
  r.status = legacyStatusForStage(r.workflowStage, policy);
  const hasEntry = data.reportWorkflowHistory.some((h) => h.reportId === r.id);
  if (!hasEntry) {
    data.reportWorkflowHistory.push({
      id: `wfh_seed_${r.id}`,
      reportId: r.id,
      companyId: r.companyId,
      protocol: r.protocol,
      previousStage: null,
      newStage: r.workflowStage,
      changedByUserId: 'system',
      changedByUserName: 'Sistema',
      justification: 'Migração inicial do workflow.',
      assigneeIdAtTransition: r.assigneeId || null,
      teamIdsAtTransition: r.teamIds || [],
      durationMs: 0,
      note: null,
      createdAt: r.workflowStageAt
    });
  }
});

if (rpt001) {
  rpt001.workflowStage = 'em_apuracao';
  rpt001.priority = 'urgente';
  rpt001.workflowStageAt = '2026-08-10T16:00:00.000Z';
  rpt001.status = legacyStatusForStage('em_apuracao', getCompanyWorkflowPolicy(data, rpt001.companyId));
}
if (rptHigh) {
  rptHigh.workflowStage = 'classificacao_risco';
  rptHigh.priority = 'alta';
}

Object.keys(data.companySettings || {}).forEach((companyId) => {
  const company = (data.companies || []).find((c) => c.id === companyId);
  data.companySettings[companyId].emailNotifications = defaultCompanyEmailSettings(company);
  data.companySettings[companyId].riskClassification = defaultRiskClassificationSettings();
  data.companySettings[companyId].investigationWorkflow = defaultInvestigationWorkflow();
});

data.platformSettings = {
  ...(data.platformSettings || {}),
  mfaPolicy: {
    enabled: true,
    requiredRoles: ['superadmin', 'admin_empresa'],
    requiredPermissions: ['reports:view_identity'],
    optionalForOthers: true,
    gracePeriodDays: 7,
    allowRecoveryCodes: true,
    enforcedAt: null
  }
};

data._meta = {
  ...data._meta,
  version: 14,
  serverSeededAt: new Date().toISOString(),
  source: 'js/seed.js via build-store.js'
};

try {
  fs.mkdirSync(resolveDataDir(), { recursive: true });
  const force = process.argv.includes('--force');
  if (fs.existsSync(outPath) && !force) {
    console.log('store.json já existe — não sobrescrito:', outPath);
    console.log('Para regenerar o demo: npm run seed -- --force');
    process.exit(0);
  }
  fs.writeFileSync(outPath, JSON.stringify(data, null, 2));
  const seedOut = resolveStoreSeedPath();
  fs.writeFileSync(seedOut, JSON.stringify(data, null, 2));
  console.log('Store gerado:', outPath);
  console.log('Seed template:', seedOut);
  console.log('Empresas:', data.companies.length, '| Relatos:', data.reports.length, '| Usuários:', data.users.length);
} catch (err) {
  const detail = err && err.message ? err.message : String(err);
  console.error(`[seed] Falha ao preparar/gravar store em ${outPath}: ${detail}`);
  process.exit(1);
}
