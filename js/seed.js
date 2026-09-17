/**
 * Canal Seguro – FX Felipe Xavier
 * Dados de demonstração (protótipo).
 * NÃO utilizar localStorage como armazenamento definitivo em produção.
 */

const CS_STORAGE_KEY = 'canal_seguro_fx_v1';

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
      protocolCounter: maxProtocolCounterForCompany(reports, c.id),
      investigationWorkflow: { enabled: true }
    };
  });
  return map;
}

const WORKFLOW_STAGE_LABELS = {
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

const LEGACY_STATUS_TO_WORKFLOW = {
  recebido: 'recebido',
  analise: 'triagem',
  apuracao: 'em_apuracao',
  acompanhamento: 'analise_parecer',
  concluido: 'concluido'
};

const WORKFLOW_TO_LEGACY_STATUS = {
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

function migrateReportWorkflowV14(data) {
  data.reportWorkflowHistory = data.reportWorkflowHistory || [];
  (data.reports || []).forEach((r) => {
    if (!r.workflowStage) {
      r.workflowStage = LEGACY_STATUS_TO_WORKFLOW[r.status] || 'recebido';
    }
    r.workflowStageAt = r.workflowStageAt || r.updatedAt || r.createdAt;
    r.priority = r.priority || 'normal';
    r.teamIds = r.teamIds || (r.assigneeId ? [r.assigneeId] : []);
    r.dueAt = r.dueAt || null;
    r.status = WORKFLOW_TO_LEGACY_STATUS[r.workflowStage] || r.status;
    if (!data.reportWorkflowHistory.some((h) => h.reportId === r.id)) {
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
        createdAt: r.workflowStageAt
      });
    }
  });
  const rpt001 = (data.reports || []).find((r) => r.id === 'rpt_001');
  if (rpt001) {
    rpt001.workflowStage = 'em_apuracao';
    rpt001.priority = 'urgente';
    rpt001.workflowStageAt = '2026-08-10T16:00:00.000Z';
    rpt001.status = 'apuracao';
  }
  const rpt002 = (data.reports || []).find((r) => r.id === 'rpt_002');
  if (rpt002) {
    rpt002.workflowStage = 'classificacao_risco';
    rpt002.priority = 'alta';
    rpt002.status = 'analise';
  }
  (data.companies || []).forEach((c) => {
    data.companySettings = data.companySettings || {};
    data.companySettings[c.id] = data.companySettings[c.id] || {};
    data.companySettings[c.id].investigationWorkflow = { enabled: true };
  });
}

function migrateEducationContentsV15(data) {
  data.contents = data.contents || [];
  const hasEducacao = data.contents.some((c) => c.type === 'educacao');
  if (hasEducacao) return;
  const fresh = createDemoData();
  const eduItems = (fresh.contents || []).filter((c) => c.type === 'educacao');
  const legacyIds = new Set(['cnt_1', 'cnt_2']);
  data.contents = data.contents.filter((c) => !legacyIds.has(c.id));
  data.contents.push(...eduItems);
}

function migrateFaqContentsV16(data) {
  data.contents = data.contents || [];
  const fresh = createDemoData();
  const faqSeed = (fresh.contents || []).filter((c) => c.type === 'faq');
  const seedIds = new Set(faqSeed.map((c) => c.id));
  const legacyFaqIds = new Set(['cnt_3', 'cnt_4']);

  if (faqSeed.every((s) => data.contents.some((c) => c.id === s.id))) {
    data.contents.forEach((c) => {
      if (c.type !== 'faq') return;
      const seed = faqSeed.find((s) => s.id === c.id);
      if (seed && (c.sortOrder == null || c.sortOrder === '')) c.sortOrder = seed.sortOrder;
    });
    return;
  }

  const customFaqs = data.contents.filter(
    (c) => c.type === 'faq' && !legacyFaqIds.has(c.id) && !seedIds.has(c.id)
  );
  data.contents = data.contents.filter((c) => c.type !== 'faq');
  data.contents.push(...faqSeed, ...customFaqs);
}

function migrateSettingsV6(data) {
  const old = data.settings || {};
  const defaultPrefix = old.protocolPrefix || 'CS';
  data.platformSettings = data.platformSettings || {
    defaultTheme: old.defaultTheme || 'light',
    fxBrandName: old.fxBrandName || 'FX Felipe Xavier',
    fxProductName: old.fxProductName || 'Canal Seguro',
    supportEmail: old.supportEmail || 'contato@fxfelipexavier.com.br',
    commercialWhatsApp: '047984570646',
    defaultProtocolPrefix: defaultPrefix,
    storagePricing: {
      defaultBaseAmount: 149,
      defaultUpgradePercent: 20,
      defaultCorporativoConsult: true
    },
    platformStorage: {
      poolBytes: 500 * 1024 * 1024 * 1024,
      alertThresholds: { attention: 70, warning: 85, critical: 95 },
      alertOnAllocatedOvercommit: true,
      lastAlert: { usedBand: 'normal', allocatedBand: 'normal', overcommit: false, at: null }
    }
  };
  if (!data.platformSettings.supportEmail) {
    data.platformSettings.supportEmail = old.supportEmail || 'contato@fxfelipexavier.com.br';
  }
  if (data.platformSettings.commercialWhatsApp == null || data.platformSettings.commercialWhatsApp === '') {
    data.platformSettings.commercialWhatsApp = '047984570646';
  }
  if (!data.platformSettings.storagePricing) {
    data.platformSettings.storagePricing = {
      defaultBaseAmount: 149,
      defaultUpgradePercent: 20,
      defaultCorporativoConsult: true
    };
  }
  if (!data.platformSettings.platformStorage) {
    data.platformSettings.platformStorage = {
      poolBytes: 500 * 1024 * 1024 * 1024,
      alertThresholds: { attention: 70, warning: 85, critical: 95 },
      alertOnAllocatedOvercommit: true,
      lastAlert: { usedBand: 'normal', allocatedBand: 'normal', overcommit: false, at: null }
    };
  }
  if (!Array.isArray(data.platformSettings.storagePlans) || !data.platformSettings.storagePlans.length) {
    const defaults =
      (typeof CSAttachments !== 'undefined' && CSAttachments.STORAGE_PLANS) || [];
    data.platformSettings.storagePlans = defaults.map((p) => ({ ...p }));
  }
  data.companySettings = data.companySettings || {};
  (data.companies || []).forEach((c) => {
    if (!data.companySettings[c.id]) {
      data.companySettings[c.id] = {
        protocolPrefix: defaultPrefix,
        protocolCounter: maxProtocolCounterForCompany(data.reports, c.id) || old.protocolCounter || 100
      };
    }
  });
  delete data.settings;
}

function createDemoData() {
  const companies = [
    {
      id: 'cmp_aurora',
      razaoSocial: 'Aurora Indústria e Comércio Ltda',
      nomeFantasia: 'Aurora Indústria',
      cnpj: '12.345.678/0001-90',
      endereco: 'Av. das Indústrias, 1200 – São Paulo/SP',
      responsavel: 'Carla Mendes (fictício)',
      email: 'compliance@aurora-demo.com.br',
      telefone: '(11) 3456-7890',
      logo: null,
      corPrincipal: '#6b9e9e',
      corSecundaria: '#1a5c38',
      dominio: 'aurora.canalseguro.com.br',
      nomeCanal: 'Canal Seguro Aurora',
      mensagemInicial: 'Este é um canal seguro destinado à orientação, prevenção e comunicação de situações que possam comprometer o respeito, a segurança e o bem-estar no ambiente de trabalho da Aurora Indústria.',
      status: 'ativo',
      storageLimitBytes: 5368709120,
      storageUsedBytes: 0,
      createdAt: '2025-11-10T10:00:00.000Z'
    },
    {
      id: 'cmp_horizon',
      razaoSocial: 'Horizon Serviços Digitais S.A.',
      nomeFantasia: 'Horizon Digital',
      cnpj: '98.765.432/0001-10',
      endereco: 'Rua Tecnológica, 450 – Curitiba/PR',
      responsavel: 'Roberto Lima (fictício)',
      email: 'gente@horizon-demo.com.br',
      telefone: '(41) 3333-2211',
      logo: null,
      corPrincipal: '#2a5a8c',
      corSecundaria: '#1a6b6b',
      dominio: 'horizon.canalseguro.com.br',
      nomeCanal: 'Canal de Escuta Horizon',
      mensagemInicial: 'Espaço confidencial para orientação e comunicação de situações que afetem o respeito e a convivência no trabalho.',
      status: 'ativo',
      storageLimitBytes: 5368709120,
      storageUsedBytes: 0,
      createdAt: '2026-01-15T14:00:00.000Z'
    },
    {
      id: 'cmp_verde',
      razaoSocial: 'Verde Campo Alimentos Ltda',
      nomeFantasia: 'Verde Campo',
      cnpj: '45.678.901/0001-55',
      endereco: 'Rod. BR-101, km 42 – Recife/PE',
      responsavel: 'Ana Paula Souza (fictício)',
      email: 'rh@verdecampo-demo.com.br',
      telefone: '(81) 3222-1100',
      logo: null,
      corPrincipal: '#2d6a4f',
      corSecundaria: '#40916c',
      dominio: 'verdecampo.canalseguro.com.br',
      nomeCanal: 'Canal Seguro Verde Campo',
      mensagemInicial: 'Canal acolhedor para prevenção, orientação e comunicação responsável sobre o ambiente de trabalho.',
      status: 'ativo',
      storageLimitBytes: 5368709120,
      storageUsedBytes: 0,
      createdAt: '2026-03-01T09:00:00.000Z'
    }
  ];

  const users = [
    {
      id: 'usr_fx_admin',
      nome: 'Administrador FX',
      username: 'FX_Admin',
      email: 'admin@fxfelipexavier.com.br',
      senha: 'fxadmin123',
      cpf: null,
      telefone: null,
      role: 'superadmin',
      companyId: null,
      status: 'ativo',
      isPlatformMaster: true,
      createdAt: '2024-01-01T00:00:00.000Z'
    },
    {
      id: 'usr_aurora_admin',
      nome: 'Carla Mendes',
      username: 'Aurora_Admin',
      email: 'admin@aurora-demo.com.br',
      senha: 'empresa123',
      cpf: null,
      telefone: null,
      role: 'admin_empresa',
      companyId: 'cmp_aurora',
      status: 'ativo'
    },
    {
      id: 'usr_aurora_ap',
      nome: 'Paulo Ferreira',
      username: 'Aurora_Apurador',
      email: 'apuracao@aurora-demo.com.br',
      senha: 'empresa123',
      cpf: null,
      telefone: null,
      role: 'apurador',
      companyId: 'cmp_aurora',
      status: 'ativo'
    },
    {
      id: 'usr_aurora_ap2',
      nome: 'Marina Rocha',
      username: 'Aurora_Apurador2',
      email: 'apuracao2@aurora-demo.com.br',
      senha: 'empresa123',
      cpf: null,
      telefone: null,
      role: 'apurador',
      companyId: 'cmp_aurora',
      status: 'ativo'
    },
    {
      id: 'usr_horizon_admin',
      nome: 'Roberto Lima',
      username: 'Horizon_Admin',
      email: 'admin@horizon-demo.com.br',
      senha: 'empresa123',
      cpf: null,
      telefone: null,
      role: 'admin_empresa',
      companyId: 'cmp_horizon',
      status: 'ativo'
    },
    {
      id: 'usr_verde_admin',
      nome: 'Ana Paula Souza',
      username: 'Verde_Admin',
      email: 'admin@verdecampo-demo.com.br',
      senha: 'empresa123',
      cpf: null,
      telefone: null,
      role: 'admin_empresa',
      companyId: 'cmp_verde',
      status: 'ativo'
    }
  ];

  const reports = [
    {
      id: 'rpt_001',
      protocol: 'CS-2026-000101',
      trackingCode: '7H9K-42MP-X8QZ',
      companyId: 'cmp_aurora',
      category: 'assedio_moral',
      status: 'analise',
      isAnonymous: true,
      dateApprox: '2026-07-12',
      timeApprox: '14:30',
      location: 'Setor de produção – linha 2',
      involved: 'Supervisor da linha (nome não informado com certeza)',
      description: 'Relato de cobranças públicas reiteradas e comentários depreciativos diante da equipe, causando constrangimento.',
      witnesses: 'Dois colegas da mesma linha (preferem não ser identificados neste momento)',
      attachments: [],
      wantUpdates: false,
      contactEmail: null,
      contactPhone: null,
      reporter: null,
      sector: 'Produção',
      assigneeId: 'usr_aurora_ap',
      createdAt: '2026-07-15T10:22:00.000Z',
      updatedAt: '2026-08-10T16:00:00.000Z'
    },
    {
      id: 'rpt_002',
      protocol: 'CS-2026-000102',
      trackingCode: '2M4P-76KN-Q3WX',
      companyId: 'cmp_aurora',
      category: 'comportamento_ofensivo',
      status: 'recebido',
      isAnonymous: false,
      dateApprox: '2026-08-01',
      timeApprox: '09:00',
      location: 'Refeitório',
      involved: 'Colega do setor administrativo',
      description: 'Comentários ofensivos e piadas repetidas sobre aparência, mesmo após pedido para cessar.',
      witnesses: '',
      attachments: [
        {
          id: 'att_demo_rpt002_1',
          reportId: 'rpt_002',
          name: 'anotacao.txt',
          size: 1200,
          mimeType: 'text/plain',
          ext: 'txt',
          status: 'simulated',
          createdAt: '2026-08-02T11:05:00.000Z'
        }
      ],
      wantUpdates: true,
      contactEmail: 'colaborador.demo@email.com',
      contactPhone: '(11) 98888-0001',
      reporter: {
        nome: 'Juliana Costa (fictício)',
        email: 'colaborador.demo@email.com',
        telefone: '(11) 98888-0001',
        empresa: 'Aurora Indústria',
        setor: 'Administrativo',
        cargo: 'Assistente'
      },
      sector: 'Administrativo',
      assigneeId: 'usr_aurora_ap',
      createdAt: '2026-08-02T11:05:00.000Z',
      updatedAt: '2026-08-02T11:05:00.000Z'
    },
    {
      id: 'rpt_003',
      protocol: 'CS-2026-000103',
      trackingCode: '9T3R-58HL-N6VY',
      companyId: 'cmp_horizon',
      category: 'discriminacao',
      status: 'apuracao',
      isAnonymous: true,
      dateApprox: '2026-06-20',
      timeApprox: '',
      location: 'Reuniões remotas e canal de mensagens',
      involved: 'Gestor de projeto',
      description: 'Tratamento diferenciado e exclusão de oportunidades aparentemente relacionados a características pessoais.',
      witnesses: 'Membros da squad',
      attachments: [],
      wantUpdates: true,
      contactEmail: 'anonimo.retorno@email.com',
      contactPhone: null,
      reporter: null,
      sector: 'Tecnologia',
      assigneeId: 'usr_horizon_admin',
      createdAt: '2026-06-25T08:40:00.000Z',
      updatedAt: '2026-08-18T09:30:00.000Z'
    },
    {
      id: 'rpt_004',
      protocol: 'CS-2026-000104',
      trackingCode: '5W8K-31JM-P4RZ',
      companyId: 'cmp_horizon',
      category: 'assedio_sexual',
      status: 'acompanhamento',
      isAnonymous: false,
      dateApprox: '2026-05-10',
      timeApprox: '18:20',
      location: 'Happy hour da empresa',
      involved: 'Parceiro comercial presente no evento',
      description: 'Abordagem indesejada e comentários de natureza sexual após o expediente, em evento da empresa.',
      witnesses: 'Uma colega presente',
      attachments: [],
      wantUpdates: true,
      contactEmail: 'maria.silva.demo@email.com',
      contactPhone: '(41) 97777-2222',
      reporter: {
        nome: 'Maria Silva (fictício)',
        email: 'maria.silva.demo@email.com',
        telefone: '(41) 97777-2222',
        empresa: 'Horizon Digital',
        setor: 'Comercial',
        cargo: 'Analista'
      },
      sector: 'Comercial',
      assigneeId: 'usr_horizon_admin',
      createdAt: '2026-05-12T19:00:00.000Z',
      updatedAt: '2026-08-01T14:00:00.000Z'
    },
    {
      id: 'rpt_005',
      protocol: 'CS-2026-000105',
      trackingCode: '6H2Q-94BT-X7NM',
      companyId: 'cmp_verde',
      category: 'violencia',
      status: 'concluido',
      isAnonymous: false,
      dateApprox: '2026-04-03',
      timeApprox: '07:45',
      location: 'Pátio de carga',
      involved: 'Motorista terceiro',
      description: 'Discussão que evoluiu para empurrão e ameaça verbal durante descarga.',
      witnesses: 'Porteiro e auxiliar de logística',
      attachments: [],
      wantUpdates: true,
      contactEmail: 'joao.santos.demo@email.com',
      contactPhone: null,
      reporter: {
        nome: 'João Santos (fictício)',
        email: 'joao.santos.demo@email.com',
        telefone: '(81) 96666-3333',
        empresa: 'Verde Campo',
        setor: 'Logística',
        cargo: 'Auxiliar'
      },
      sector: 'Logística',
      assigneeId: 'usr_verde_admin',
      createdAt: '2026-04-03T12:00:00.000Z',
      updatedAt: '2026-05-20T10:00:00.000Z'
    },
    {
      id: 'rpt_006',
      protocol: 'CS-2026-000106',
      trackingCode: '3F7N-22KP-W8HY',
      companyId: 'cmp_aurora',
      category: 'retaliacao',
      status: 'apuracao',
      isAnonymous: true,
      dateApprox: '2026-08-05',
      timeApprox: '',
      location: 'Escritório',
      involved: 'Liderança imediata',
      description: 'Após comunicação anterior interna, houve mudança abrupta de escala e isolamento de tarefas.',
      witnesses: '',
      attachments: [],
      wantUpdates: false,
      contactEmail: null,
      contactPhone: null,
      reporter: null,
      sector: 'Qualidade',
      assigneeId: 'usr_aurora_admin',
      createdAt: '2026-08-08T15:30:00.000Z',
      updatedAt: '2026-08-20T11:00:00.000Z'
    },
    {
      id: 'rpt_007',
      protocol: 'CS-2026-000107',
      trackingCode: '8K5M-67RQ-T2JP',
      companyId: 'cmp_verde',
      category: 'constrangimento',
      status: 'analise',
      isAnonymous: true,
      dateApprox: '2026-07-28',
      timeApprox: '11:00',
      location: 'Reunião de equipe',
      involved: 'Coordenador',
      description: 'Exposição vexatória de erro operacional diante de toda a equipe.',
      witnesses: 'Equipe presente na reunião',
      attachments: [],
      wantUpdates: true,
      contactEmail: null,
      contactPhone: '(81) 95555-4444',
      reporter: null,
      sector: 'Operações',
      assigneeId: null,
      createdAt: '2026-07-29T09:10:00.000Z',
      updatedAt: '2026-08-12T08:00:00.000Z'
    },
    {
      id: 'rpt_008',
      protocol: 'CS-2026-000108',
      trackingCode: '4N9H-83WM-K5TQ',
      companyId: 'cmp_horizon',
      category: 'ameaca',
      status: 'recebido',
      isAnonymous: false,
      dateApprox: '2026-08-18',
      timeApprox: '16:40',
      location: 'Chat interno',
      involved: 'Colega de outro time',
      description: 'Mensagens com tom intimidador após divergência técnica em projeto.',
      witnesses: '',
      attachments: [
        {
          id: 'att_demo_rpt008_1',
          reportId: 'rpt_008',
          name: 'prints-chat.png',
          size: 245000,
          mimeType: 'image/png',
          ext: 'png',
          status: 'simulated',
          createdAt: '2026-08-18T16:40:00.000Z'
        }
      ],
      wantUpdates: true,
      contactEmail: 'pedro.alves.demo@email.com',
      contactPhone: '(41) 94444-5555',
      reporter: {
        nome: 'Pedro Alves (fictício)',
        email: 'pedro.alves.demo@email.com',
        telefone: '(41) 94444-5555',
        empresa: 'Horizon Digital',
        setor: 'Produto',
        cargo: 'Designer'
      },
      sector: 'Produto',
      assigneeId: null,
      createdAt: '2026-08-19T08:00:00.000Z',
      updatedAt: '2026-08-19T08:00:00.000Z'
    },
    {
      id: 'rpt_009',
      protocol: 'CS-2026-000109',
      trackingCode: '7P3W-45HN-M9RK',
      companyId: 'cmp_aurora',
      category: 'outro',
      status: 'concluido',
      isAnonymous: false,
      dateApprox: '2026-03-15',
      timeApprox: '',
      location: 'Home office / reuniões',
      involved: 'Não especificado claramente',
      description: 'Situação de clima hostil recorrente; solicitação de orientação sobre como proceder.',
      witnesses: '',
      attachments: [],
      wantUpdates: false,
      contactEmail: 'lucia.ramos.demo@email.com',
      contactPhone: null,
      reporter: {
        nome: 'Lúcia Ramos (fictício)',
        email: 'lucia.ramos.demo@email.com',
        telefone: '(11) 93333-6666',
        empresa: 'Aurora Indústria',
        setor: 'RH',
        cargo: 'Analista'
      },
      sector: 'RH',
      assigneeId: 'usr_aurora_admin',
      createdAt: '2026-03-16T13:00:00.000Z',
      updatedAt: '2026-04-30T17:00:00.000Z'
    },
    {
      id: 'rpt_010',
      protocol: 'CS-2026-000110',
      trackingCode: '2R6K-88JT-Q4NW',
      companyId: 'cmp_verde',
      category: 'assedio_moral',
      status: 'acompanhamento',
      isAnonymous: true,
      dateApprox: '2026-06-01',
      timeApprox: '08:00',
      location: 'Linha de embalagem',
      involved: 'Encarregado de turno',
      description: 'Metas acompanhadas de humilhações verbais frequentes e isolamento social no turno.',
      witnesses: 'Operadores do mesmo turno',
      attachments: [],
      wantUpdates: false,
      contactEmail: null,
      contactPhone: null,
      reporter: null,
      sector: 'Embalagem',
      assigneeId: 'usr_verde_admin',
      createdAt: '2026-06-05T07:50:00.000Z',
      updatedAt: '2026-08-15T10:20:00.000Z'
    },
    {
      id: 'rpt_011',
      protocol: 'CS-2026-000111',
      trackingCode: '5M8T-19HQ-P6VX',
      companyId: 'cmp_horizon',
      category: 'comportamento_ofensivo',
      status: 'analise',
      isAnonymous: true,
      dateApprox: '2026-08-10',
      timeApprox: '10:15',
      location: 'Sala de reunião',
      involved: 'Participante externo de cliente',
      description: 'Insultos e interrupções agressivas durante apresentação, criando ambiente hostil.',
      witnesses: 'Equipe comercial',
      attachments: [],
      wantUpdates: true,
      contactEmail: 'retorno.demo@email.com',
      contactPhone: null,
      reporter: null,
      sector: 'Comercial',
      assigneeId: 'usr_horizon_admin',
      createdAt: '2026-08-11T18:00:00.000Z',
      updatedAt: '2026-08-22T09:00:00.000Z'
    },
    {
      id: 'rpt_012',
      protocol: 'CS-2026-000112',
      trackingCode: '4R2N-89TQ-K5WD',
      companyId: 'cmp_aurora',
      category: 'discriminacao',
      status: 'recebido',
      isAnonymous: false,
      dateApprox: '2026-08-20',
      timeApprox: '13:00',
      location: 'Processo seletivo interno',
      involved: 'Membros da banca',
      description: 'Perguntas e comentários inadequados relacionados a idade e situação familiar durante entrevista interna.',
      witnesses: '',
      attachments: [],
      wantUpdates: true,
      contactEmail: 'fernanda.oliveira.demo@email.com',
      contactPhone: '(11) 92222-7777',
      reporter: {
        nome: 'Fernanda Oliveira (fictício)',
        email: 'fernanda.oliveira.demo@email.com',
        telefone: '(11) 92222-7777',
        empresa: 'Aurora Indústria',
        setor: 'Engenharia',
        cargo: 'Engenheira'
      },
      sector: 'Engenharia',
      assigneeId: null,
      createdAt: '2026-08-21T10:45:00.000Z',
      updatedAt: '2026-08-21T10:45:00.000Z'
    }
  ];

  const rpt001 = reports.find((r) => r.id === 'rpt_001');
  if (rpt001) {
    rpt001.riskLevel = 'critical';
    rpt001.riskClassifiedAt = '2026-07-16T09:00:00.000Z';
    rpt001.riskClassifiedByUserId = 'usr_aurora_admin';
  }
  const rpt002 = reports.find((r) => r.id === 'rpt_002');
  if (rpt002) {
    rpt002.riskLevel = 'high';
    rpt002.riskClassifiedAt = '2026-07-20T11:00:00.000Z';
    rpt002.riskClassifiedByUserId = 'usr_aurora_ap';
  }
  const rpt005 = reports.find((r) => r.id === 'rpt_005');
  if (rpt005) {
    rpt005.riskLevel = 'high';
    rpt005.riskClassifiedAt = '2026-07-20T11:00:00.000Z';
    rpt005.riskClassifiedByUserId = 'usr_verde_admin';
  }

  const reportHistory = [
    { id: 'hist_1', reportId: 'rpt_001', date: '2026-07-15T10:22:00.000Z', userId: 'system', userName: 'Sistema', action: 'Relato recebido e registrado.' },
    { id: 'hist_2', reportId: 'rpt_001', date: '2026-08-10T16:00:00.000Z', userId: 'usr_aurora_admin', userName: 'Carla Mendes', action: 'Alterou status para "Em análise".' },
    { id: 'hist_3', reportId: 'rpt_003', date: '2026-06-25T08:40:00.000Z', userId: 'system', userName: 'Sistema', action: 'Relato recebido e registrado.' },
    { id: 'hist_4', reportId: 'rpt_003', date: '2026-07-10T11:00:00.000Z', userId: 'usr_horizon_admin', userName: 'Roberto Lima', action: 'Alterou status para "Em análise".' },
    { id: 'hist_5', reportId: 'rpt_003', date: '2026-08-18T09:30:00.000Z', userId: 'usr_horizon_admin', userName: 'Roberto Lima', action: 'Alterou status para "Em apuração".' },
    { id: 'hist_6', reportId: 'rpt_005', date: '2026-04-03T12:00:00.000Z', userId: 'system', userName: 'Sistema', action: 'Relato recebido e registrado.' },
    { id: 'hist_7', reportId: 'rpt_005', date: '2026-05-20T10:00:00.000Z', userId: 'usr_verde_admin', userName: 'Ana Paula Souza', action: 'Concluiu o relato. Providências registradas.' },
    { id: 'hist_8', reportId: 'rpt_004', date: '2026-08-01T14:00:00.000Z', userId: 'usr_horizon_admin', userName: 'Roberto Lima', action: 'Alterou status para "Em acompanhamento".' }
  ];

  const contents = [
    {
      id: 'cnt_edu_assedio',
      type: 'educacao',
      title: 'O que é assédio?',
      slug: 'assedio',
      sortOrder: 10,
      body:
        '<p>De forma simples, assédio no ambiente de trabalho costuma envolver condutas abusivas — muitas vezes reiteradas, ou em alguns casos graves mesmo isoladas — que atentam contra a dignidade, a integridade psíquica ou o bem-estar da pessoa.</p><p>Nem toda situação desconfortável, discordância ou cobrança profissional equivale automaticamente a assédio. O objetivo deste canal é acolher comunicações e orientar, sem estimular acusações precipitadas.</p>',
      companyId: null,
      status: 'publicado',
      createdAt: '2026-01-10T10:00:00.000Z'
    },
    {
      id: 'cnt_edu_moral',
      type: 'educacao',
      title: 'Assédio moral',
      slug: 'moral',
      sortOrder: 20,
      body:
        '<h3>Conceito</h3><p>Geralmente associado a exposição prolongada a situações humilhantes, constrangedoras ou hostis no trabalho, que podem degradar o ambiente e afetar a saúde e a dignidade.</p><h3>Exemplos que podem caracterizar (conforme contexto)</h3><ul><li>Humilhações públicas reiteradas;</li><li>Isolamento social deliberado no trabalho;</li><li>Atribuição sistemática de tarefas degradantes sem justificativa;</li><li>Critérios abusivos e desproporcionais de cobrança com caráter vexatório.</li></ul><h3>Situações que isoladamente podem não caracterizar assédio</h3><ul><li>Feedback profissional objetivo e respeitoso;</li><li>Cobrança legítima de prazos e metas;</li><li>Discordâncias pontuais de opinião;</li><li>Reorganização de funções por necessidade da empresa, feita com respeito.</li></ul><div class="callout"><p>A análise depende do contexto, frequência, intensidade e impactos. Em caso de dúvida, busque orientação e, se desejar, registre uma comunicação objetiva.</p></div>',
      companyId: null,
      status: 'publicado',
      createdAt: '2026-01-10T10:05:00.000Z'
    },
    {
      id: 'cnt_edu_sexual',
      type: 'educacao',
      title: 'Assédio sexual',
      slug: 'sexual',
      sortOrder: 30,
      body:
        '<h3>Conceito</h3><p>Envolve condutas de conotação sexual indesejadas, que possam constranger, intimidar ou criar ambiente hostil. Pode ocorrer entre pessoas de hierarquias diferentes ou entre pares.</p><h3>Exemplos e comportamentos inadequados</h3><ul><li>Comentários sexuais indesejados;</li><li>Cantadas insistentes após recusa;</li><li>Contato físico não consentido;</li><li>Exposição a conteúdo de natureza sexual sem consentimento;</li><li>Condicionamento de benefícios a favores sexuais.</li></ul><h3>Prevenção</h3><ul><li>Respeito a limites pessoais;</li><li>Comunicação clara e profissional;</li><li>Políticas internas de convivência;</li><li>Canais seguros de escuta, como este.</li></ul>',
      companyId: null,
      status: 'publicado',
      createdAt: '2026-01-10T10:10:00.000Z'
    },
    {
      id: 'cnt_edu_discriminacao',
      type: 'educacao',
      title: 'Discriminação',
      slug: 'discriminacao',
      sortOrder: 40,
      body:
        '<p>Comportamentos discriminatórios podem incluir tratamento desigual ou pejorativo com base em características pessoais protegidas, tais como:</p><ul><li>Raça, cor, origem ou etnia;</li><li>Gênero, identidade de gênero ou orientação sexual;</li><li>Idade, deficiência, religião;</li><li>Estado civil, gravidez ou condição familiar;</li><li>Outras características pessoais usadas de forma injusta.</li></ul><p>Exemplos: exclusão de oportunidades, piadas reiteradas, comentários pejorativos ou critérios de seleção enviesados.</p>',
      companyId: null,
      status: 'publicado',
      createdAt: '2026-01-10T10:15:00.000Z'
    },
    {
      id: 'cnt_edu_violencia',
      type: 'educacao',
      title: 'Violência no trabalho',
      slug: 'violencia',
      sortOrder: 50,
      body:
        '<p><strong>Física:</strong> agressões ou contato físico ofensivo.</p><p><strong>Verbal:</strong> gritos, insultos, ameaças explícitas.</p><p><strong>Psicológica:</strong> intimidação, humilhação sistemática, medo constante.</p><div class="callout callout--warn"><p>Em situações de risco imediato à integridade física, priorize sua segurança e acione os canais de emergência adequados.</p></div>',
      companyId: null,
      status: 'publicado',
      createdAt: '2026-01-10T10:20:00.000Z'
    },
    {
      id: 'cnt_edu_ofensivos',
      type: 'educacao',
      title: 'Comportamentos ofensivos',
      slug: 'ofensivos',
      sortOrder: 60,
      body:
        '<p>Podem incluir, conforme gravidade e contexto:</p><ul><li>Humilhações;</li><li>Ameaças;</li><li>Constrangimentos;</li><li>Insultos;</li><li>Exposição vexatória;</li><li>Comentários ofensivos reiterados.</li></ul>',
      companyId: null,
      status: 'publicado',
      createdAt: '2026-01-10T10:25:00.000Z'
    },
    {
      id: 'cnt_edu_conflitos',
      type: 'educacao',
      title: 'Conflitos x assédio',
      slug: 'conflitos',
      sortOrder: 70,
      body:
        '<p>É importante distinguir:</p><ul><li><strong>Conflito:</strong> divergência de ideias ou interesses, possível de mediação.</li><li><strong>Cobrança profissional:</strong> exigência legítima de desempenho, com respeito.</li><li><strong>Gestão:</strong> decisões organizacionais e direcionamento de equipe.</li><li><strong>Feedback:</strong> retorno sobre desempenho, preferencialmente construtivo.</li><li><strong>Assédio:</strong> conduta abusiva que fere dignidade e bem-estar, além do exercício regular da gestão.</li></ul><p>Esta plataforma não afirma automaticamente que determinada situação constitui crime ou assédio; cada caso deve ser apreciado com cuidado.</p>',
      companyId: null,
      status: 'publicado',
      createdAt: '2026-01-10T10:30:00.000Z'
    },
    {
      id: 'cnt_edu_direitos',
      type: 'educacao',
      title: 'Conheça seus direitos',
      slug: 'direitos',
      sortOrder: 80,
      body:
        '<p>Todo colaborador tem direito a um ambiente de trabalho com respeito à dignidade, à integridade e à não discriminação. Políticas internas, normas trabalhistas e princípios de convivência reforçam esses direitos.</p><p>Este canal é uma ferramenta de prevenção e escuta da empresa, complementar a outros meios institucionais eventualmente disponíveis.</p>',
      companyId: null,
      status: 'publicado',
      createdAt: '2026-01-10T10:35:00.000Z'
    },
    {
      id: 'cnt_edu_como_funciona',
      type: 'educacao',
      title: 'Como funciona',
      slug: 'como-funciona',
      sortOrder: 90,
      body:
        '<ol><li>Você acessa “Fazer um Relato” e escolhe identificado ou anônimo.</li><li>Preenche as etapas com informações objetivas.</li><li>Recebe um número de protocolo.</li><li>A equipe responsável analisa e atualiza o status.</li><li>Você pode consultar o andamento pelo protocolo (sem dados confidenciais na tela pública).</li></ol>',
      companyId: null,
      status: 'publicado',
      createdAt: '2026-01-10T10:40:00.000Z'
    },
    {
      id: 'cnt_edu_orientacoes',
      type: 'educacao',
      title: 'Orientações',
      slug: 'orientacoes',
      sortOrder: 100,
      body:
        '<ul><li>Descreva fatos de forma objetiva (o quê, quando, onde, quem, como).</li><li>Evite informações não relacionadas ao ocorrido.</li><li>Não é necessário ter certeza jurídica para comunicar uma situação.</li><li>Guarde o protocolo em local seguro.</li><li>Se solicitar retorno, informe um contato confiável.</li></ul><p><a class="btn btn-primary mt-2" href="relato.html" data-tenant-link>Fazer um Relato</a></p>',
      companyId: null,
      status: 'publicado',
      createdAt: '2026-01-10T10:45:00.000Z'
    },
    {
      id: 'cnt_faq_anonimo',
      type: 'faq',
      title: 'Posso fazer um relato anônimo?',
      sortOrder: 10,
      body: 'Sim. Você pode escolher a opção anônima. Neste protótipo, dados pessoais não são obrigatórios nessa modalidade. Em produção, o anonimato real depende de arquitetura segura no back-end.',
      companyId: null,
      status: 'publicado',
      createdAt: '2026-01-12T11:00:00.000Z'
    },
    {
      id: 'cnt_faq_certeza',
      type: 'faq',
      title: 'Preciso ter certeza de que ocorreu assédio?',
      sortOrder: 20,
      body: 'Não. O canal recebe comunicações sobre situações que possam comprometer o respeito e o bem-estar. Descreva os fatos com objetividade; a apuração caberá à equipe responsável.',
      companyId: null,
      status: 'publicado',
      createdAt: '2026-01-12T11:05:00.000Z'
    },
    {
      id: 'cnt_faq_depois',
      type: 'faq',
      title: 'O que acontece depois do envio?',
      sortOrder: 30,
      body: 'Você recebe um protocolo. A equipe da empresa analisa a comunicação e atualiza o status. Você pode acompanhar o andamento pela página Consultar Relato.',
      companyId: null,
      status: 'publicado',
      createdAt: '2026-01-12T11:10:00.000Z'
    },
    {
      id: 'cnt_faq_protegidas',
      type: 'faq',
      title: 'Minhas informações ficam protegidas?',
      sortOrder: 40,
      body: 'A plataforma é desenhada para confidencialidade e conformidade com boas práticas de privacidade (incluindo preparação para LGPD). Este protótipo usa armazenamento local apenas para demonstração — não é solução definitiva de segurança.',
      companyId: null,
      status: 'publicado',
      createdAt: '2026-01-12T11:15:00.000Z'
    },
    {
      id: 'cnt_faq_anexos',
      type: 'faq',
      title: 'Posso anexar arquivos?',
      sortOrder: 50,
      body: 'A interface de anexos está disponível no formulário. O upload seguro (armazenamento criptografado, antivírus, controle de acesso) será implementado no back-end.',
      companyId: null,
      status: 'publicado',
      createdAt: '2026-01-12T11:20:00.000Z'
    },
    {
      id: 'cnt_faq_retaliacao',
      type: 'faq',
      title: 'Haverá retaliação?',
      sortOrder: 60,
      body: 'A empresa se compromete a tratar comunicações com seriedade e a coibir retaliações. Se perceber retaliação, registre também por este canal.',
      companyId: null,
      status: 'publicado',
      createdAt: '2026-01-12T11:25:00.000Z'
    },
    {
      id: 'cnt_5',
      type: 'artigo',
      title: 'Política de convivência – Aurora',
      body: 'Conteúdo específico da Aurora Indústria sobre respeito e convivência no chão de fábrica e escritórios.',
      companyId: 'cmp_aurora',
      status: 'publicado',
      createdAt: '2026-02-01T10:00:00.000Z'
    }
  ];

  const notifications = [
    {
      id: 'ntf_1',
      type: 'report_new',
      title: 'Novo relato recebido',
      message: 'Protocolo CS-2026-000112 aguarda triagem.',
      companyId: 'cmp_aurora',
      reportId: 'rpt_012',
      protocol: 'CS-2026-000112',
      read: false,
      createdAt: '2026-08-21T10:45:00.000Z'
    },
    {
      id: 'ntf_2',
      type: 'report_assigned',
      title: 'Relato encaminhado',
      message: 'Protocolo CS-2026-000102 encaminhado para Paulo Ferreira.',
      companyId: 'cmp_aurora',
      reportId: 'rpt_002',
      protocol: 'CS-2026-000102',
      read: false,
      createdAt: '2026-08-02T11:05:00.000Z'
    },
    {
      id: 'ntf_2b',
      type: 'report_assigned',
      title: 'Relato encaminhado a você',
      message: 'Protocolo CS-2026-000102 foi encaminhado para sua apuração.',
      companyId: 'cmp_aurora',
      reportId: 'rpt_002',
      protocol: 'CS-2026-000102',
      userId: 'usr_aurora_ap',
      assigneeId: 'usr_aurora_ap',
      read: false,
      createdAt: '2026-08-02T11:05:00.000Z'
    },
    {
      id: 'ntf_3',
      type: 'report_status',
      title: 'Relato atualizado',
      message: 'Protocolo CS-2026-000103 — status: Em apuração.',
      companyId: 'cmp_horizon',
      reportId: 'rpt_003',
      protocol: 'CS-2026-000103',
      read: false,
      createdAt: '2026-08-18T09:30:00.000Z'
    },
    {
      id: 'ntf_4',
      type: 'report_assigned',
      title: 'Relato encaminhado',
      message: 'Protocolo CS-2026-000112 encaminhado para Paulo Ferreira.',
      companyId: 'cmp_aurora',
      reportId: 'rpt_012',
      protocol: 'CS-2026-000112',
      read: false,
      createdAt: '2026-08-21T11:00:00.000Z'
    },
    {
      id: 'ntf_4b',
      type: 'report_assigned',
      title: 'Relato encaminhado a você',
      message: 'Protocolo CS-2026-000112 foi encaminhado para sua apuração.',
      companyId: 'cmp_aurora',
      reportId: 'rpt_012',
      protocol: 'CS-2026-000112',
      userId: 'usr_aurora_ap',
      assigneeId: 'usr_aurora_ap',
      read: false,
      createdAt: '2026-08-21T11:00:00.000Z'
    }
  ];

  const auditLogs = [
    { id: 'aud_1', date: '2026-08-26T09:00:00.000Z', userId: 'usr_fx_admin', userName: 'Administrador FX', action: 'login', resourceType: 'session', companyId: null, targetId: null },
    { id: 'aud_login_ap', date: '2026-08-26T08:15:00.000Z', userId: 'usr_aurora_ap', userName: 'Paulo Ferreira', action: 'login', resourceType: 'session', companyId: 'cmp_aurora', targetId: null },
    { id: 'aud_logout_ap', date: '2026-08-26T12:40:00.000Z', userId: 'usr_aurora_ap', userName: 'Paulo Ferreira', action: 'logout', resourceType: 'session', companyId: 'cmp_aurora', targetId: null },
    { id: 'aud_login_aurora', date: '2026-08-26T08:05:00.000Z', userId: 'usr_aurora_admin', userName: 'Carla Mendes', action: 'login', resourceType: 'session', companyId: 'cmp_aurora', targetId: null },
    { id: 'aud_2', date: '2026-08-25T14:20:00.000Z', userId: 'usr_aurora_admin', userName: 'Carla Mendes', action: 'alteracao_status', resourceType: 'report', companyId: 'cmp_aurora', resourceId: 'rpt_001', targetId: 'rpt_001', protocol: 'CS-2026-000101', previousValue: { status: 'recebido' }, newValue: { status: 'analise' } },
    { id: 'aud_3', date: '2026-08-21T10:45:00.000Z', userId: 'system', userName: 'Sistema', action: 'criacao_relato', resourceType: 'report', companyId: 'cmp_aurora', resourceId: 'rpt_012', targetId: 'rpt_012', protocol: 'CS-2026-000112', newValue: { status: 'recebido', isAnonymous: false } },
    { id: 'aud_4', date: '2026-08-18T09:30:00.000Z', userId: 'usr_horizon_admin', userName: 'Roberto Lima', action: 'alteracao_status', resourceType: 'report', companyId: 'cmp_horizon', resourceId: 'rpt_003', targetId: 'rpt_003', protocol: 'CS-2026-000103', previousValue: { status: 'analise' }, newValue: { status: 'apuracao' } },
    { id: 'aud_5', date: '2026-08-15T11:00:00.000Z', userId: 'usr_fx_admin', userName: 'Administrador FX', action: 'edicao_empresa', resourceType: 'company', companyId: 'cmp_verde', resourceId: 'cmp_verde', targetId: 'cmp_verde' }
  ];

  const platformSettings = {
    defaultTheme: 'light',
    fxBrandName: 'FX Felipe Xavier',
    fxProductName: 'Canal Seguro',
    supportEmail: 'contato@fxfelipexavier.com.br',
    commercialWhatsApp: '047984570646',
    defaultProtocolPrefix: 'CS',
    storagePricing: {
      defaultBaseAmount: 149,
      defaultUpgradePercent: 20,
      defaultCorporativoConsult: true
    },
    platformStorage: {
      poolBytes: 500 * 1024 * 1024 * 1024,
      alertThresholds: { attention: 70, warning: 85, critical: 95 },
      alertOnAllocatedOvercommit: true,
      lastAlert: { usedBand: 'normal', allocatedBand: 'normal', overcommit: false, at: null }
    }
  };

  const companySettings = buildCompanySettings(companies, reports, 'CS');

  /** Colaboradores admitidos por empresa (CPF normalizado — protótipo; em produção usar hash). */
  const employees = [
    {
      id: 'emp_aurora_1',
      companyId: 'cmp_aurora',
      cpf: '52998224725',
      nome: 'Juliana Costa (fictício)',
      email: 'colaborador.demo@email.com',
      telefone: '(11) 98888-0001',
      matricula: 'AUR-1024',
      setor: 'Administrativo',
      cargo: 'Assistente',
      status: 'ativo',
      createdAt: '2025-12-01T10:00:00.000Z'
    },
    {
      id: 'emp_aurora_2',
      companyId: 'cmp_aurora',
      cpf: '11144477735',
      nome: 'Fernanda Oliveira (fictício)',
      email: 'fernanda.oliveira.demo@email.com',
      telefone: '(11) 92222-7777',
      matricula: 'AUR-2048',
      setor: 'Engenharia',
      cargo: 'Engenheira',
      status: 'ativo',
      createdAt: '2025-12-01T10:00:00.000Z'
    },
    {
      id: 'emp_aurora_3',
      companyId: 'cmp_aurora',
      cpf: '71428793860',
      nome: 'Lucas Pereira (fictício)',
      email: 'lucas.pereira.demo@email.com',
      telefone: '(11) 91111-8888',
      matricula: 'AUR-3050',
      setor: 'Produção',
      cargo: 'Operador',
      status: 'ativo',
      createdAt: '2026-01-10T10:00:00.000Z'
    },
    {
      id: 'emp_horizon_1',
      companyId: 'cmp_horizon',
      cpf: '39053344705',
      nome: 'Maria Silva (fictício)',
      email: 'maria.silva.demo@email.com',
      telefone: '(41) 97777-2222',
      matricula: 'HOR-501',
      setor: 'Comercial',
      cargo: 'Analista',
      status: 'ativo',
      createdAt: '2026-01-15T10:00:00.000Z'
    },
    {
      id: 'emp_horizon_2',
      companyId: 'cmp_horizon',
      cpf: '23100299981',
      nome: 'Pedro Alves (fictício)',
      email: 'pedro.alves.demo@email.com',
      telefone: '(41) 94444-5555',
      matricula: 'HOR-612',
      setor: 'Produto',
      cargo: 'Designer',
      status: 'ativo',
      createdAt: '2026-01-15T10:00:00.000Z'
    },
    {
      id: 'emp_verde_1',
      companyId: 'cmp_verde',
      cpf: '40364478829',
      nome: 'João Santos (fictício)',
      email: 'joao.santos.demo@email.com',
      telefone: '(81) 96666-3333',
      matricula: 'VC-880',
      setor: 'Logística',
      cargo: 'Auxiliar',
      status: 'ativo',
      createdAt: '2026-03-01T10:00:00.000Z'
    },
    {
      id: 'emp_verde_2',
      companyId: 'cmp_verde',
      cpf: '86853239083',
      nome: 'Beatriz Lima (fictício)',
      email: 'beatriz.lima.demo@email.com',
      telefone: '(81) 95555-4444',
      matricula: 'VC-881',
      setor: 'Operações',
      cargo: 'Coordenadora',
      status: 'ativo',
      createdAt: '2026-03-01T10:00:00.000Z'
    },
    {
      id: 'emp_aurora_inativo',
      companyId: 'cmp_aurora',
      cpf: '15350946056',
      nome: 'Ex-colaborador Demo (fictício)',
      email: 'desligado.demo@email.com',
      telefone: '',
      matricula: 'AUR-0099',
      setor: 'RH',
      cargo: 'Analista',
      status: 'desligado',
      createdAt: '2024-06-01T10:00:00.000Z'
    }
  ];

  const payload = {
    companies,
    users,
    employees,
    reports,
    reportHistory,
    reportMessages: [
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
    ],
    reportRiskHistory: [
      {
        id: 'rrh_demo_1',
        reportId: 'rpt_001',
        companyId: 'cmp_aurora',
        protocol: 'CS-2026-000101',
        level: 'critical',
        previousLevel: null,
        factors: ['physical_integrity', 'leadership_involvement', 'recurrence'],
        justification:
          'Relato descreve cobranças públicas reiteradas com possível retaliação e envolvimento de supervisor.',
        classifiedByUserId: 'usr_aurora_admin',
        classifiedByUserName: 'Carla Mendes',
        source: 'manual',
        createdAt: '2026-07-16T09:00:00.000Z'
      }
    ],
    contents,
    notifications,
    auditLogs,
    techLogs: [],
    storageUpgradeRequests: [],
    platformSupportThreads: [],
    platformSettings,
    companySettings,
    categories: DEMO_CATEGORIES,
    statuses: DEMO_STATUSES,
    _meta: {
      version: 16,
      seededAt: new Date().toISOString(),
      disclaimer: 'Dados fictícios para demonstração. localStorage não é armazenamento seguro.'
    }
  };
  migrateReportWorkflowV14(payload);
  return payload;
}

function loadStore() {
  try {
    const raw = localStorage.getItem(CS_STORAGE_KEY);
    if (!raw) {
      const data = createDemoData();
      localStorage.setItem(CS_STORAGE_KEY, JSON.stringify(data));
      return data;
    }
    const data = JSON.parse(raw);
    if (!data.employees || !data._meta || data._meta.version < 2) {
      const fresh = createDemoData();
      data.employees = fresh.employees;
      data._meta = { ...data._meta, version: 2 };
      localStorage.setItem(CS_STORAGE_KEY, JSON.stringify(data));
    }
    if (!data._meta || data._meta.version < 3) {
      const fresh = createDemoData();
      const codesById = Object.fromEntries(fresh.reports.map((r) => [r.id, r.trackingCode]));
      (data.reports || []).forEach((r) => {
        if (!r.trackingCode && codesById[r.id]) {
          r.trackingCode = codesById[r.id];
        }
      });
      data._meta = { ...data._meta, version: 3 };
      localStorage.setItem(CS_STORAGE_KEY, JSON.stringify(data));
    }
    if (!data._meta || data._meta.version < 4) {
      const reportsById = Object.fromEntries((data.reports || []).map((r) => [r.id, r]));
      (data.auditLogs || []).forEach((log) => {
        if (!log.resourceId && log.targetId) log.resourceId = log.targetId;
        if (log.action === 'login' || log.action === 'logout') {
          log.resourceType = log.resourceType || 'session';
        }
        if (log.action === 'criacao_relato' || log.action === 'alteracao_status') {
          log.resourceType = log.resourceType || 'report';
          const report = reportsById[log.resourceId || log.targetId];
          if (report && !log.protocol) log.protocol = report.protocol;
        }
        if (log.action === 'criacao_empresa' || log.action === 'edicao_empresa') {
          log.resourceType = log.resourceType || 'company';
        }
        if (log.action === 'criacao_colaborador' || log.action === 'edicao_colaborador') {
          log.resourceType = log.resourceType || 'employee';
        }
        if (log.action === 'criacao_usuario' || log.action === 'edicao_usuario') {
          log.resourceType = log.resourceType || 'user';
        }
      });
      data._meta = { ...data._meta, version: 4 };
      localStorage.setItem(CS_STORAGE_KEY, JSON.stringify(data));
    }
    if (!data._meta || data._meta.version < 5) {
      (data.reports || []).forEach((r) => {
        if (typeof CSAttachments !== 'undefined') {
          r.attachments = CSAttachments.normalizeReportList(r.id, r.attachments);
        } else {
          r.attachments = (r.attachments || []).map((a, idx) => {
            const name = String(a?.name || '').trim();
            const ext = name.includes('.') ? name.split('.').pop().toLowerCase() : '';
            return {
              id: a?.id || `att_mig_${r.id}_${idx}`,
              reportId: r.id,
              name,
              size: Number(a?.size) || 0,
              mimeType: a?.mimeType || 'application/octet-stream',
              ext: a?.ext || ext,
              status: a?.status || 'simulated',
              createdAt: a?.createdAt || r.createdAt || new Date().toISOString()
            };
          });
        }
      });
      data._meta = { ...data._meta, version: 5 };
      localStorage.setItem(CS_STORAGE_KEY, JSON.stringify(data));
    }
    if (!data._meta || data._meta.version < 6) {
      migrateSettingsV6(data);
      data._meta = { ...data._meta, version: 6 };
      localStorage.setItem(CS_STORAGE_KEY, JSON.stringify(data));
    }
    if (!data._meta || data._meta.version < 7) {
      if (!Array.isArray(data.techLogs)) data.techLogs = [];
      data._meta = { ...data._meta, version: 7 };
      localStorage.setItem(CS_STORAGE_KEY, JSON.stringify(data));
    }
    if (!data._meta || data._meta.version < 14) {
      migrateReportWorkflowV14(data);
      data._meta = { ...data._meta, version: 14 };
      localStorage.setItem(CS_STORAGE_KEY, JSON.stringify(data));
    }
    if (!data._meta || data._meta.version < 15) {
      migrateEducationContentsV15(data);
      data._meta = { ...data._meta, version: 15 };
      localStorage.setItem(CS_STORAGE_KEY, JSON.stringify(data));
    }
    if (!data._meta || data._meta.version < 16) {
      migrateFaqContentsV16(data);
      data._meta = { ...data._meta, version: 16 };
      localStorage.setItem(CS_STORAGE_KEY, JSON.stringify(data));
    }
    return data;
  } catch (e) {
    console.warn('Falha ao ler store; regenerando demo.', e);
    const data = createDemoData();
    localStorage.setItem(CS_STORAGE_KEY, JSON.stringify(data));
    return data;
  }
}

function saveStore(data) {
  try {
    localStorage.setItem(CS_STORAGE_KEY, JSON.stringify(data));
  } catch (e) {
    if (typeof CSInfraLog !== 'undefined') {
      CSInfraLog.database('persistencia_falhou', {
        severity: 'critical',
        outcome: 'failure',
        context: { reason: String(e.message || e), code: e.name || 'StorageError' }
      });
    }
    throw e;
  }
}

function resetDemoData() {
  const data = createDemoData();
  localStorage.setItem(CS_STORAGE_KEY, JSON.stringify(data));
  return data;
}

window.CSStore = { loadStore, saveStore, resetDemoData, createDemoData, DEMO_CATEGORIES, DEMO_STATUSES, CS_STORAGE_KEY };
