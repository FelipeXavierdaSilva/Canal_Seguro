'use strict';

const store = require('../store');
const { appendAudit } = require('./audit.service');

const QUESTION_MAX = 240;
const ANSWER_MAX = 4000;
const KEYWORDS_MAX = 20;
const MATCH_THRESHOLD = 2.5;
const SUGGESTION_MIN_SCORE = 0.8;
const SUGGESTION_MAX = 4;
/** Score alto o bastante para responder sem pedir escolha (quase exato). */
const CONFIDENT_MATCH_SCORE = 18;
/** Diferença mínima entre 1º e 2º para considerar a resposta inequívoca. */
const CONFIDENT_SCORE_GAP = 5;

const DEFAULT_FAQS = [
  {
    id: 'faq_seed_fluxo_completo_adm',
    question: 'Recebi um relato novo. O que fazer até concluir a denúncia? (passo a passo da apuração)',
    answer:
      'Partindo do Dashboard, siga esta ordem:\n' +
      '1) Relatos — abra o protocolo novo (status Relato recebido / etapa Recebido). Só o Adm_Empresa vê relatos ainda sem encaminhamento.\n' +
      '2) Classificação de risco — escolha Baixo, Moderado, Alto ou Crítico (Crítico só Adm_Empresa), marque fatores, escreva justificativa e Classificar. Obrigatório antes de avançar para Responsável definido / Em apuração.\n' +
      '3) Encaminhar — em Ações, Encaminhar para o Apurador responsável (need-to-know: só ele verá o caso). Obrigatório antes de Em apuração e das etapas seguintes.\n' +
      '4) Fluxo de apuração — avance na ordem: Recebido → Triagem → Classificação de risco → Responsável definido → Em apuração → (opcional: Aguardando informações) → Análise / parecer → Medidas adotadas → Concluído. Use Avançar etapa e Aplicar etapa; informe justificativa quando pedida.\n' +
      '5) Comunicação com denunciante — quando precisar de dados, Enviar mensagem ou Solicitar informações (visível na consulta pública). Enquanto espera, a etapa pode ser Aguardando informações.\n' +
      '6) Medidas e ações executadas — registre ações e medidas com data (alimenta histórico e PDF).\n' +
      '7) Observações internas (opcional) — só para a equipe; não vão ao denunciante.\n' +
      '8) Concluir — no Fluxo, vá para Concluído (justificativa obrigatória) ou use Concluir relato em Ações. Exige responsável encaminhado; em risco Crítico o responsável é obrigatório. Resultado: etapa e status Concluído.\n' +
      'Dica: prioridade (Normal/Alta/Urgente) é aparte do risco — ajuste em Fluxo de apuração se necessário.',
    keywords: [
      'recebi',
      'novo',
      'relato',
      'denuncia',
      'seguimento',
      'fluxo',
      'completo',
      'passo',
      'passo a passo',
      'concluir',
      'resolucao',
      'apuracao',
      'tratar',
      'inicio',
      'comecar',
      'dar seguimento',
      'chega',
      'quando chega',
      'o que fazer'
    ],
    audience: ['admin_empresa'],
    enabled: true,
    sortOrder: 5
  },
  {
    id: 'faq_seed_fluxo_completo_apu',
    question: 'Recebi um relato encaminhado. Como dar seguimento até concluir?',
    answer:
      'Partindo do Dashboard (você só vê o que foi Encaminhado a você):\n' +
      '1) Relatos — abra o protocolo sob sua responsabilidade.\n' +
      '2) Classificação de risco — Baixo, Moderado ou Alto + fatores + justificativa → Classificar (Crítico só o Adm_Empresa).\n' +
      '3) Fluxo de apuração — avance: Triagem / Classificação de risco / Responsável definido → Em apuração → (opcional Aguardando informações) → Análise / parecer → Medidas adotadas → Concluído. Justificativa quando o sistema pedir. Você não Encaminha nem retrocede etapa (peça ao Adm_Empresa).\n' +
      '4) Comunicação com denunciante — Enviar mensagem ou Solicitar informações se faltar dado.\n' +
      '5) Medidas e ações executadas — registre o que foi feito, com data.\n' +
      '6) Concluir — etapa Concluído no fluxo (justificativa obrigatória) ou Concluir relato. Sem responsável ou sem risco quando a etapa exige, o sistema bloqueia — alinhe com o Adm_Empresa.\n' +
      'Se o relato não aparece: peça Encaminhar ao Adm_Empresa.',
    keywords: [
      'encaminhado',
      'recebi',
      'seguimento',
      'fluxo',
      'concluir',
      'apuracao',
      'passo',
      'resolucao',
      'denuncia',
      'tratar',
      'rotina'
    ],
    audience: ['apurador'],
    enabled: true,
    sortOrder: 5
  },
  {
    id: 'faq_seed_etapas_fluxo',
    question: 'Quais são as etapas do fluxo de apuração até a conclusão?',
    answer:
      'Partindo do Dashboard → Relatos → detalhe → Fluxo de apuração, a ordem padrão é:\n' +
      'Recebido → Triagem → Classificação de risco → Responsável definido → Em apuração → Aguardando informações (opcional) → Análise / parecer → Medidas adotadas → Concluído.\n' +
      'Marcos da timeline: Recebido · Triagem · Apuração · Parecer · Conclusão.\n' +
      'Status legado sincronizado (consulta/relatórios): Relato recebido · Em análise · Em apuração · Em acompanhamento · Concluído.\n' +
      'Regras: risco classificado antes de Responsável definido/Em apuração; Encaminhar (responsável) antes de Em apuração e conclusão; justificativa na conclusão e em saltos/retrocessos.',
    keywords: [
      'etapas',
      'fluxo',
      'apuracao',
      'ordem',
      'triagem',
      'parecer',
      'medidas',
      'concluido',
      'timeline',
      'marcos'
    ],
    audience: ['all'],
    enabled: true,
    sortOrder: 52
  },

  // —— Compartilhadas (Adm_Empresa + Apurador) ——
  {
    id: 'faq_seed_suporte',
    question: 'Como falar com o suporte da plataforma?',
    answer:
      'Use o botão flutuante (Assistente Virtual) no canto da tela. Abra a aba Ajuda para perguntas rápidas. Se não resolver, use “Não resolveu — enviar mensagem” ou a aba Mensagem. A mensagem vai ao Adm_Plataforma, com resposta em até 24 horas.',
    keywords: ['suporte', 'ajuda', 'contato', 'humano', '24h', 'faq', 'botao', 'flutuante'],
    audience: ['all'],
    enabled: true,
    sortOrder: 10
  },
  {
    id: 'faq_seed_badge',
    question: 'O que significa o número laranja no ícone de ajuda?',
    answer:
      'É a quantidade de respostas novas da plataforma ainda não visualizadas. Ao abrir a aba Mensagem e ver as conversas, o contador zera.',
    keywords: ['badge', 'laranja', 'numero', 'nao lida', 'mensagem', 'icone', 'contador'],
    audience: ['all'],
    enabled: true,
    sortOrder: 20
  },
  {
    id: 'faq_seed_minimizar',
    question: 'Qual a diferença entre minimizar e fechar o chat de ajuda?',
    answer:
      'Minimizar esconde o painel e mantém a conversa. Fechar limpa o histórico do assistente na sessão. Use minimizar se quiser continuar depois.',
    keywords: ['minimizar', 'fechar', 'chat', 'conversa', 'historico'],
    audience: ['all'],
    enabled: true,
    sortOrder: 30
  },
  {
    id: 'faq_seed_need_to_know',
    question: 'Por que o Apurador não vê todos os relatos?',
    answer:
      'Por confidencialidade (need-to-know). O Apurador só acessa relatos encaminhados a ele pelo Adm_Empresa. Assim se evita que alguém com possível relação com o caso tenha ciência indevida.',
    keywords: ['need-to-know', 'ciencia', 'visivel', 'acesso', 'apurador', 'relato', 'todos'],
    audience: ['all'],
    enabled: true,
    sortOrder: 40
  },
  {
    id: 'faq_seed_tratar_relato',
    question: 'Como tratar um relato passo a passo?',
    answer:
      'Partindo do Dashboard: 1) No menu lateral, clique em Relatos (ou em “Ver todos” / um relato recente na lista). 2) Abra o relato desejado. 3) Avance o fluxo de apuração. 4) Em Comunicação com denunciante, troque mensagens se precisar. 5) Em Medidas e ações executadas, registre o que foi feito. 6) Use observações internas só para a equipe. 7) Conclua quando apropriado.',
    keywords: ['tratar', 'relato', 'fluxo', 'apuracao', 'passo', 'status', 'medida', 'dashboard'],
    audience: ['all'],
    enabled: true,
    sortOrder: 50
  },
  {
    id: 'faq_seed_classificar_risco',
    question: 'Como classificar o risco de uma denúncia?',
    answer:
      'Na ficha do relato, abra a etapa Triagem (Classificação de risco):\n' +
      '1) Escolha o nível: Baixo, Moderado, Alto ou Crítico (Crítico só Adm_Empresa).\n' +
      '2) Marque os fatores que se aplicam.\n' +
      '3) Escreva a justificativa (obrigatória).\n' +
      '4) Clique em Classificar (ou Reclassificar).\n\n' +
      'O que é “Ver sugestão auxiliar”?\n' +
      'É só uma dica automática do sistema (ex.: “Moderado — score 50”). Ela analisa categoria, texto, anexos e padrões parecidos e sugere um nível. Não decide sozinha e não substitui a classificação oficial. Você pode aceitar, ajustar ou ignorar — a decisão final é sempre do profissional autorizado, com justificativa.\n\n' +
      'O nível de risco não aparece na consulta pública do denunciante.',
    keywords: [
      'classificar',
      'risco',
      'nivel',
      'denuncia',
      'sugestao',
      'auxiliar',
      'score',
      'moderado',
      'critico',
      'alto',
      'baixo',
      'justificativa',
      'triagem'
    ],
    audience: ['admin_empresa', 'apurador'],
    enabled: true,
    sortOrder: 55
  },
  {
    id: 'faq_seed_conversar_denunciante',
    question: 'Como conversar com o denunciante?',
    answer:
      'Partindo do Dashboard: 1) Vá em Relatos no menu lateral. 2) Abra o relato. 3) Na seção “Comunicação com denunciante”, leia a thread. 4) Digite em “Enviar mensagem ao denunciante”. 5) Clique em Enviar mensagem (ou use solicitar informações, se disponível). A mensagem fica visível na consulta pública com protocolo + código. Não peça dados desnecessários. Observações internas não vão ao denunciante.',
    keywords: ['conversar', 'falar', 'denunciante', 'mensagem', 'thread', 'comunicacao', 'responder', 'protocolo'],
    audience: ['all'],
    enabled: true,
    sortOrder: 56
  },
  {
    id: 'faq_seed_medidas',
    question: 'Para que serve Medidas e ações executadas?',
    answer:
      'Partindo do Dashboard: 1) Abra Relatos → detalhe do caso. 2) Localize “Medidas e ações executadas”. 3) Registre a ação feita e a providência (medida), com data. Isso alimenta o histórico e o PDF de apuração. Faça isso antes de concluir casos sensíveis.',
    keywords: ['medidas', 'acoes', 'executadas', 'pdf', 'historico', 'providencia', 'dashboard'],
    audience: ['all'],
    enabled: true,
    sortOrder: 60
  },
  {
    id: 'faq_seed_comunicacao',
    question: 'Como falar com o denunciante pelo painel?',
    answer:
      'Partindo do Dashboard: menu Relatos → abra o relato → seção “Comunicação com denunciante” → escreva e envie. O conteúdo aparece na consulta pública. Para dúvidas internas da equipe, use observações internas (não visíveis ao denunciante).',
    keywords: ['denunciante', 'mensagem', 'thread', 'comunicacao', 'protocolo', 'responder', 'painel'],
    audience: ['all'],
    enabled: true,
    sortOrder: 70
  },
  {
    id: 'faq_seed_sigilo',
    question: 'Quais regras de sigilo e LGPD devo seguir?',
    answer:
      'Trate todos os relatos como confidenciais. Não compartilhe prints fora do painel. Não peça dados demais ao denunciante. Respeite o que o sistema mascara. Nunca compartilhe protocolo + código de acompanhamento com terceiros.',
    keywords: ['sigilo', 'lgpd', 'confidencial', 'print', 'protocolo', 'codigo', 'privacidade'],
    audience: ['all'],
    enabled: true,
    sortOrder: 80
  },
  {
    id: 'faq_seed_anonimo',
    question: 'Como funciona relato anônimo e identidade?',
    answer:
      'Relatos anônimos não exibem identidade. Em relatos identificados, o Adm_Empresa pode ver dados do denunciante; o Apurador normalmente vê campos mascarados conforme a política. Use a identidade só quando for necessário à apuração.',
    keywords: ['anonimo', 'identidade', 'denunciante', 'mascarado', 'confidencial', 'cpf'],
    audience: ['all'],
    enabled: true,
    sortOrder: 90
  },
  {
    id: 'faq_seed_relatorios',
    question: 'Onde gero relatórios e exportações?',
    answer:
      'No menu Relatórios do painel da empresa. O que você pode exportar depende do perfil (PDF individual, apuração, gerencial etc.). Evite compartilhar exportações com dados sensíveis fora do painel.',
    keywords: ['relatorio', 'exportar', 'pdf', 'excel', 'csv', 'gerencial'],
    audience: ['all'],
    enabled: true,
    sortOrder: 100
  },
  {
    id: 'faq_seed_minha_conta',
    question: 'Como alterar senha ou dados da minha conta?',
    answer:
      'Em Minha conta você atualiza nome, contato e senha. Se esqueceu a senha, use “Esqueci minha senha” na tela de login. Mantenha MFA ativo quando a política exigir.',
    keywords: ['senha', 'conta', 'login', 'mfa', 'perfil', 'minha conta'],
    audience: ['all'],
    enabled: true,
    sortOrder: 110
  },
  {
    id: 'faq_seed_dashboard',
    question: 'Para que serve o Dashboard da empresa?',
    answer:
      'É o ponto de partida do painel: resumo, alertas e relatos recentes. Dali você vai ao menu Relatos, Relatórios, Armazenamento etc. Nos guias do assistente, partimos sempre do Dashboard para indicar o caminho passo a passo.',
    keywords: ['dashboard', 'resumo', 'alerta', 'prioridade', 'inicio', 'menu'],
    audience: ['all'],
    enabled: true,
    sortOrder: 120
  },
  {
    id: 'faq_seed_abrir_relato',
    question: 'Como abrir um relato a partir do Dashboard?',
    answer:
      'No Dashboard: clique em um item de “Relatos recentes”, ou use “Ver todos”, ou o menu Relatos. Na lista, clique no protocolo desejado para abrir o detalhe (fluxo, risco, comunicação e medidas).',
    keywords: ['abrir', 'relato', 'dashboard', 'recentes', 'lista', 'protocolo', 'detalhe'],
    audience: ['all'],
    enabled: true,
    sortOrder: 125
  },
  {
    id: 'faq_seed_solicitar_info',
    question: 'Como solicitar informações ao denunciante?',
    answer:
      'Partindo do Dashboard → Relatos → abra o relato → Comunicação com denunciante. Use a opção de solicitar informações (quando disponível) ou envie uma mensagem clara pedindo o que falta. A pessoa responde na consulta pública com protocolo + código.',
    keywords: ['solicitar', 'informacoes', 'pedido', 'denunciante', 'duvida', 'complementar'],
    audience: ['all'],
    enabled: true,
    sortOrder: 57
  },

  // —— Adm_Plataforma ——
  {
    id: 'faq_seed_platform_inbox',
    question: 'Como atender o suporte das empresas?',
    answer:
      'No painel Adm_Plataforma, abra Suporte empresas. Lá você vê as conversas abertas pelas empresas, responde e acompanha o SLA de 24h. Priorize itens atrasados.',
    keywords: ['suporte', 'empresas', 'inbox', 'atender', 'sla', 'mensagem'],
    audience: ['superadmin'],
    enabled: true,
    sortOrder: 300
  },
  {
    id: 'faq_seed_platform_master',
    question: 'Como falar com o Adm_Plataforma Master?',
    answer:
      'No Assistente Virtual do painel, use “Falar com um Atendente”. A mensagem vai ao Adm_Plataforma Master (primeiro administrador da plataforma). O histórico fica disponível para os Adm_Plataforma.',
    keywords: ['master', 'atendente', 'interno', 'assistente', 'falar', 'adm plataforma'],
    audience: ['superadmin'],
    enabled: true,
    sortOrder: 310
  },
  {
    id: 'faq_seed_platform_faq_bot',
    question: 'Como gerenciar as respostas do Assistente Virtual?',
    answer:
      'No menu Sistema → FAQ do bot. Crie, edite ou desative perguntas e defina o público (empresa, apurador, plataforma ou todos).',
    keywords: ['faq', 'bot', 'assistente', 'perguntas', 'respostas', 'gerenciar'],
    audience: ['superadmin'],
    enabled: true,
    sortOrder: 320
  },

  // —— Só Adm_Empresa ——
  {
    id: 'faq_seed_encaminhar',
    question: 'Como encaminhar um relato para um Apurador?',
    answer:
      'Partindo do Dashboard: 1) Menu Relatos (ou um relato recente). 2) Abra o detalhe. 3) Use Encaminhar e escolha o Apurador. Só ele verá aquele caso (need-to-know). Apuradores não encaminham — função do Adm_Empresa.',
    keywords: ['encaminhar', 'atribuir', 'responsavel', 'apurador', 'direcionar', 'assign', 'dashboard'],
    audience: ['admin_empresa'],
    enabled: true,
    sortOrder: 200
  },
  {
    id: 'faq_seed_adm_limites',
    question: 'O que o Adm_Empresa pode fazer no painel?',
    answer:
      'Do Dashboard você acessa todo o menu da empresa: Relatos (tratar e encaminhar), Usuários, Colaboradores, Empresa, Aparência/Identidade, Armazenamento, Acessos e Relatórios. Não acessa o painel Adm_Plataforma de outros clientes.',
    keywords: ['adm', 'admin', 'empresa', 'limites', 'permissao', 'pode', 'dashboard'],
    audience: ['admin_empresa'],
    enabled: true,
    sortOrder: 210
  },
  {
    id: 'faq_seed_usuarios',
    question: 'Como cadastrar usuários da empresa?',
    answer:
      'Partindo do Dashboard: 1) Menu Gestão → Usuários. 2) Novo usuário. 3) Escolha perfil Adm_Empresa ou Apurador. 4) Preencha e-mail/senha e salve. A conta fica só na sua empresa.',
    keywords: ['usuarios', 'cadastrar', 'apurador', 'adm', 'equipe', 'criar', 'dashboard'],
    audience: ['admin_empresa'],
    enabled: true,
    sortOrder: 220
  },
  {
    id: 'faq_seed_colaboradores',
    question: 'Para que serve a lista de Colaboradores?',
    answer:
      'Partindo do Dashboard: menu Gestão → Colaboradores. É a lista de CPFs autorizados a registrar relato identificado. Mantenha atualizada.',
    keywords: ['colaboradores', 'cpf', 'allowlist', 'identificado', 'lista', 'dashboard'],
    audience: ['admin_empresa'],
    enabled: true,
    sortOrder: 230
  },
  {
    id: 'faq_seed_empresa_vs_aparencia',
    question: 'Qual a diferença entre Empresa e Aparência / Identidade?',
    answer:
      'Partindo do Dashboard, em Configurações: Empresa = dados cadastrais e notificações. Aparência / Identidade = nome, logo e visual do canal. Depois valide no link Canal Seguro (menu Ajuda).',
    keywords: ['empresa', 'aparencia', 'identidade', 'logo', 'cadastro', 'notificacao', 'dashboard'],
    audience: ['admin_empresa'],
    enabled: true,
    sortOrder: 240
  },
  {
    id: 'faq_seed_acessos',
    question: 'O que vejo em Acessos?',
    answer:
      'Partindo do Dashboard: Configurações → Acessos. Mostra tentativas e acessos relevantes da empresa para acompanhar segurança do tenant.',
    keywords: ['acessos', 'login', 'historico', 'seguranca', 'tentativa', 'dashboard'],
    audience: ['admin_empresa'],
    enabled: true,
    sortOrder: 250
  },
  {
    id: 'faq_seed_armazenamento_adm',
    question: 'Como solicitar mais armazenamento?',
    answer:
      'Partindo do Dashboard: 1) Configurações → Armazenamento. 2) Veja uso × limite e os pacotes. 3) Solicite upgrade. O Adm_Plataforma trata o comercial. Com limite estourado, novos anexos podem ser bloqueados.',
    keywords: ['armazenamento', 'pacote', 'upgrade', 'quota', 'anexo', 'espaco', 'limite', 'dashboard'],
    audience: ['admin_empresa'],
    enabled: true,
    sortOrder: 260
  },
  {
    id: 'faq_seed_risco_critico',
    question: 'Quem pode classificar um relato como risco crítico?',
    answer:
      'Partindo do Dashboard → Relatos → detalhe → Classificação de risco: o nível Crítico só aparece para Adm_Empresa (e Adm_Plataforma). O Apurador classifica Baixo, Moderado ou Alto. Sempre informe a justificativa.',
    keywords: ['critico', 'risco', 'classificar', 'adm', 'apurador', 'nivel'],
    audience: ['admin_empresa'],
    enabled: true,
    sortOrder: 265
  },
  {
    id: 'faq_seed_notificacao_novo',
    question: 'Quem é avisado quando chega um relato novo?',
    answer:
      'Do Dashboard você vê os recentes. Relatos novos notificam o Adm_Empresa. O Apurador só é avisado depois do Encaminhar. Por isso encaminhe cedo os casos dele.',
    keywords: ['notificacao', 'email', 'aviso', 'novo', 'relato', 'encaminhar', 'dashboard'],
    audience: ['admin_empresa'],
    enabled: true,
    sortOrder: 270
  },

  // —— Só Apurador ——
  {
    id: 'faq_seed_apurador_limites',
    question: 'O que o Apurador pode e não pode fazer?',
    answer:
      'Do Dashboard: abra Relatos (só os encaminhados a você). Pode atualizar fluxo, classificar risco (exceto Crítico), conversar com o denunciante e registrar medidas. Não pode Encaminhar, nem gerenciar Usuários, Colaboradores, Empresa, Aparência ou Acessos.',
    keywords: ['limites', 'permissao', 'pode', 'nao pode', 'apurador', 'dashboard'],
    audience: ['apurador'],
    enabled: true,
    sortOrder: 300
  },
  {
    id: 'faq_seed_apurador_visibilidade',
    question: 'Quais relatos aparecem para mim como Apurador?',
    answer:
      'Partindo do Dashboard → Relatos: só os encaminhados a você. Se a lista estiver vazia, peça ao Adm_Empresa para Encaminhar o caso.',
    keywords: ['visibilidade', 'lista', 'encaminhado', 'meu', 'relatos', 'aparecem', 'dashboard'],
    audience: ['apurador'],
    enabled: true,
    sortOrder: 310
  },
  {
    id: 'faq_seed_apurador_rotina',
    question: 'Qual a rotina recomendada do Apurador?',
    answer:
      'No Dashboard, veja alertas e recentes. Depois: Relatos → priorize urgentes/risco alto → avance o fluxo → converse com o denunciante se preciso → registre Medidas e ações. Sem acesso a um caso, peça Encaminhar ao Adm_Empresa.',
    keywords: ['rotina', 'prioridade', 'urgencia', 'fluxo', 'dia', 'trabalho', 'dashboard'],
    audience: ['apurador'],
    enabled: true,
    sortOrder: 320
  },
  {
    id: 'faq_seed_apurador_armazenamento',
    question: 'Posso contratar mais armazenamento como Apurador?',
    answer:
      'Partindo do Dashboard → Armazenamento: você só consulta o consumo. Preços podem estar “Sob consulta”. Contratação é do Adm_Empresa — avise-o se o limite estiver crítico.',
    keywords: ['armazenamento', 'contratar', 'upgrade', 'preco', 'consulta', 'apurador', 'dashboard'],
    audience: ['apurador'],
    enabled: true,
    sortOrder: 330
  },
  {
    id: 'faq_seed_apurador_ajuda_adm',
    question: 'Quando devo pedir ajuda ao Adm_Empresa?',
    answer:
      'Quando precisar Encaminhar/reatribuir, ver dados mascarados além do necessário, cadastrar usuários/colaboradores, mudar identidade ou contratar armazenamento. Para dúvidas do sistema: botão flutuante Assistente Virtual no Dashboard.',
    keywords: ['ajuda', 'adm', 'pedir', 'encaminhar', 'dados', 'suporte interno', 'dashboard'],
    audience: ['apurador'],
    enabled: true,
    sortOrder: 340
  },
  {
    id: 'faq_seed_apurador_risco',
    question: 'Como o Apurador classifica o risco de um relato?',
    answer:
      'Abra o relato encaminhado a você → etapa Triagem → Classificação de risco → escolha Baixo, Moderado ou Alto → marque fatores → escreva a justificativa → Classificar.\n' +
      'Nível Crítico só o Adm_Empresa define.\n' +
      'O botão “Ver sugestão auxiliar” mostra uma dica automática (ex.: Moderado com score). É só apoio: não substitui sua classificação oficial com justificativa.',
    keywords: ['risco', 'classificar', 'apurador', 'nivel', 'justificativa', 'sugestao', 'auxiliar', 'dashboard', 'triagem'],
    audience: ['apurador'],
    enabled: true,
    sortOrder: 350
  },

  // —— Público / denunciante (home e registro de denúncia) ——
  {
    id: 'faq_seed_public_fazer_denuncia',
    question: 'Como faço uma denúncia neste canal?',
    answer:
      'Como fazer uma denúncia\n' +
      '1. Acesse o formulário oficial pelo botão “Fazer uma denúncia”.\n' +
      '2. Informe o CPF para validar o vínculo com a empresa cadastrada.\n' +
      '3. Escolha se o relato será identificado ou anônimo, quando a opção estiver disponível.\n' +
      '4. Descreva os fatos com clareza e anexe documentos, se necessário.\n' +
      '5. Envie o relato e guarde o protocolo e o código de acompanhamento em local seguro.',
    keywords: [
      'denuncia',
      'relato',
      'fazer',
      'registrar',
      'como',
      'comecar',
      'enviar',
      'cpf',
      'acesso',
      'formulario'
    ],
    audience: ['public'],
    enabled: true,
    sortOrder: 10
  },
  {
    id: 'faq_seed_public_assedio_moral',
    question: 'O que é assédio moral?',
    answer:
      'Assédio moral, de forma geral, envolve condutas abusivas e reiteradas que humilham, isolam ou pressionam alguém no ambiente de trabalho.\n\n' +
      'Este assistente oferece orientação geral. Para exemplos e conteúdos educativos, consulte a área Sobre / Orientações. Se você vivenciou uma situação inadequada, utilize o formulário oficial de denúncia.',
    keywords: ['assedio', 'moral', 'humilhacao', 'pressao', 'isolamento', 'o que e'],
    audience: ['public'],
    enabled: true,
    sortOrder: 15
  },
  {
    id: 'faq_seed_public_anonimo',
    question: 'Posso fazer uma denúncia anônima?',
    answer:
      'Quando a opção estiver disponível no canal da sua organização, você pode escolher o modo anônimo. Nesse caso, dados pessoais não são obrigatórios. Em qualquer modo, trate protocolo e código como informações confidenciais.',
    keywords: ['anonimo', 'anonimato', 'identificado', 'nome', 'sigilo'],
    audience: ['public'],
    enabled: true,
    sortOrder: 20
  },
  {
    id: 'faq_seed_public_protocolo',
    question: 'Como consulto o andamento da minha denúncia?',
    answer:
      'Como acompanhar uma denúncia\n' +
      '1. Acesse “Consultar protocolo” na página inicial.\n' +
      '2. Informe o número do protocolo e o código de acompanhamento recebidos no registro.\n' +
      '3. Consulte as informações disponíveis sobre o andamento.\n\n' +
      'Sem protocolo e código, o canal não exibe o andamento — isso protege a confidencialidade.',
    keywords: ['protocolo', 'consultar', 'andamento', 'codigo', 'acompanhamento', 'status', 'acompanhar'],
    audience: ['public'],
    enabled: true,
    sortOrder: 30
  },
  {
    id: 'faq_seed_public_depois',
    question: 'O que acontece depois que eu envio o relato?',
    answer:
      'O relato é registrado no canal e encaminhado conforme o procedimento da organização. Você acompanha informações disponíveis pela consulta com protocolo e código. Prazos e etapas internas podem variar conforme a política da empresa.',
    keywords: ['depois', 'envio', 'proximo', 'analise', 'apuracao', 'prazo'],
    audience: ['public'],
    enabled: true,
    sortOrder: 40
  },
  {
    id: 'faq_seed_public_provas',
    question: 'Preciso ter provas para denunciar?',
    answer:
      'Não é obrigatório ter provas completas para iniciar. Descreva o que aconteceu com o máximo de clareza possível. Se tiver anexos (mensagens, documentos), você poderá enviá-los nas etapas do formulário, conforme as opções do canal.',
    keywords: ['provas', 'evidencias', 'anexo', 'documento', 'foto', 'obrigatorio'],
    audience: ['public'],
    enabled: true,
    sortOrder: 50
  },
  {
    id: 'faq_seed_public_confidencial',
    question: 'O canal é confidencial?',
    answer:
      'Sim. O Canal Seguro foi pensado para comunicação confidencial.\n\n' +
      'O acesso interno aos relatos é restrito a perfis autorizados. Não compartilhe protocolo, código ou detalhes do caso com terceiros. Para mais detalhes, consulte a Política de Privacidade.',
    keywords: ['confidencial', 'sigilo', 'privacidade', 'seguro', 'lgpd', 'minha denuncia'],
    audience: ['public'],
    enabled: true,
    sortOrder: 60
  },
  {
    id: 'faq_seed_public_fale_conosco',
    question: 'Qual a diferença entre Fale conosco e fazer uma denúncia?',
    answer:
      '“Fazer uma denúncia” é para relatar situações de assédio ou condutas inadequadas. “Fale conosco” é para dúvidas gerais sobre o uso do canal (acesso, orientações, sugestões) — não substitui o registro de um relato.',
    keywords: ['fale', 'conosco', 'contato', 'duvida', 'diferenca', 'suporte'],
    audience: ['public'],
    enabled: true,
    sortOrder: 70
  },
  {
    id: 'faq_seed_public_esqueci_protocolo',
    question: 'Esqueci o protocolo ou o código de acompanhamento. E agora?',
    answer:
      'Por política de privacidade e segurança, o canal não reenvia nem revela protocolo ou código por este assistente. Guarde esses dados no momento do registro. Se precisar de orientação geral sobre o uso do canal, use “Fale conosco”.',
    keywords: ['esqueci', 'perdi', 'protocolo', 'codigo', 'recuperar', 'reenviar'],
    audience: ['public'],
    enabled: true,
    sortOrder: 80
  }
];

function normalize(text) {
  return String(text || '')
    .toLowerCase()
    .normalize('NFD')
    .replace(/[\u0300-\u036f]/g, '')
    .replace(/[^a-z0-9\s]/g, ' ')
    .replace(/\s+/g, ' ')
    .trim();
}

function tokenize(text) {
  const stop = new Set([
    'a',
    'o',
    'os',
    'as',
    'de',
    'da',
    'do',
    'das',
    'dos',
    'e',
    'ou',
    'um',
    'uma',
    'para',
    'por',
    'com',
    'no',
    'na',
    'nos',
    'nas',
    'em',
    'que',
    'como',
    'qual',
    'quais',
    'meu',
    'minha',
    'seu',
    'sua'
  ]);
  return normalize(text)
    .split(' ')
    .filter((w) => w.length > 2 && !stop.has(w));
}

function sanitizeKeywords(raw) {
  const list = Array.isArray(raw)
    ? raw
    : String(raw || '')
        .split(/[,;\n]/)
        .map((s) => s.trim())
        .filter(Boolean);
  const out = [];
  const seen = new Set();
  for (const item of list.slice(0, KEYWORDS_MAX)) {
    const n = normalize(item).slice(0, 40);
    if (!n || seen.has(n)) continue;
    seen.add(n);
    out.push(n);
  }
  return out;
}

function sanitizeAudience(raw) {
  const allowed = new Set(['admin_empresa', 'apurador', 'superadmin', 'all', 'public']);
  let list = Array.isArray(raw) ? raw : String(raw || 'all').split(/[,\s]+/);
  list = list.map((x) => String(x || '').trim()).filter((x) => allowed.has(x));
  if (!list.length) return ['all'];
  if (list.includes('all') && !list.includes('public')) return ['all'];
  if (list.includes('all') && list.includes('public')) return ['all', 'public'];
  return [...new Set(list)];
}

function audienceAllows(faq, role) {
  const aud = faq.audience || ['all'];
  if (role === 'public') return aud.includes('public');
  if (aud.includes('all')) return true;
  if (role === 'superadmin' && aud.includes('superadmin')) return true;
  return aud.includes(role);
}

const CONFIDENTIAL_REFUSAL =
  'Por política de privacidade e confidencialidade do canal, não posso informar, confirmar nem comentar dados pessoais, identidade de denunciantes, conteúdo de relatos ou qualquer informação confidencial de usuários. Use apenas as orientações gerais deste assistente ou a consulta com o seu próprio protocolo e código.';

function isConfidentialQuery(queryNorm) {
  const patterns = [
    /\b(cpf|rg|nome completo|dados pessoais|identidade)\b.{0,40}\b(de|do|da|dos|das)\b/,
    /\b(quem|qual)\b.{0,30}\b(denunciou|denunciante|relatou|fez o relato|fez a denuncia)\b/,
    /\b(me diga|informe|mostrar|mostrar|revelar|listar|buscar)\b.{0,40}\b(nome|cpf|email|telefone|identidade|denunciante)\b/,
    /\b(dados|informacoes|info)\b.{0,30}\b(do usuario|da pessoa|do colaborador|do denunciante|de fulano)\b/,
    /\b(conteudo|detalhe|detalhes|texto)\b.{0,30}\b(do relato|da denuncia|do protocolo)\b.{0,20}\b(de outra|de um|de alguem|alheio)\b/,
    /\b(protocolo|codigo)\b.{0,40}\b(de outra pessoa|de um colega|de fulano|de alguem)\b/,
    /\b(existe relato|tem denuncia|houve denuncia)\b.{0,40}\b(sobre|contra|de)\b/,
    /\b(vazamento|vazar|compartilhar)\b.{0,30}\b(dados|relato|protocolo|identidade)\b/
  ];
  return patterns.some((re) => re.test(queryNorm));
}

function ensureFaqs(data) {
  const now = new Date().toISOString();
  if (!Array.isArray(data.supportFaqs)) data.supportFaqs = [];

  const byId = new Map(data.supportFaqs.map((f) => [f.id, f]));
  let changed = false;

  for (const seed of DEFAULT_FAQS) {
    const existing = byId.get(seed.id);
    if (!existing) {
      const row = {
        ...seed,
        createdAt: now,
        updatedAt: now,
        updatedByUserId: 'system',
        updatedByName: 'Sistema'
      };
      data.supportFaqs.push(row);
      byId.set(seed.id, row);
      changed = true;
      continue;
    }
    // Atualiza conteúdo das FAQs semente (preserva enabled se o Adm desativou)
    const next = {
      ...existing,
      question: seed.question,
      answer: seed.answer,
      keywords: [...(seed.keywords || [])],
      audience: [...(seed.audience || ['all'])],
      sortOrder: seed.sortOrder,
      updatedAt: now,
      updatedByUserId: existing.updatedByUserId || 'system',
      updatedByName: existing.updatedByName || 'Sistema'
    };
    if (
      existing.question !== next.question ||
      existing.answer !== next.answer ||
      JSON.stringify(existing.keywords || []) !== JSON.stringify(next.keywords) ||
      JSON.stringify(existing.audience || []) !== JSON.stringify(next.audience) ||
      Number(existing.sortOrder) !== Number(next.sortOrder)
    ) {
      Object.assign(existing, next);
      changed = true;
    }
  }

  // Remove semente antiga substituída (armazenamento genérico → específica Adm)
  const legacyIds = new Set(['faq_seed_armazenamento']);
  const before = data.supportFaqs.length;
  data.supportFaqs = data.supportFaqs.filter((f) => !legacyIds.has(f.id));
  if (data.supportFaqs.length !== before) changed = true;

  data.__supportFaqsChanged = changed;
  return data.supportFaqs;
}

function saveIfFaqsChanged(data) {
  if (data.__supportFaqsChanged) {
    delete data.__supportFaqsChanged;
    store.save(data);
  }
}

function publicFaqView(faq) {
  return {
    id: faq.id,
    question: faq.question,
    answer: faq.answer,
    keywords: faq.keywords || [],
    audience: faq.audience || ['all'],
    enabled: faq.enabled !== false,
    sortOrder: Number(faq.sortOrder) || 0,
    createdAt: faq.createdAt || null,
    updatedAt: faq.updatedAt || null,
    updatedByName: faq.updatedByName || null
  };
}

function scoreFaq(faq, queryNorm, queryTokens) {
  const q = normalize(faq.question);
  const ans = normalize(faq.answer);
  const keywords = (faq.keywords || []).map(normalize);
  let score = 0;

  if (q && queryNorm === q) score += 20;
  else if (q && (q.includes(queryNorm) || queryNorm.includes(q))) score += 8;

  for (const kw of keywords) {
    if (!kw) continue;
    if (queryNorm.includes(kw)) score += 4;
    if (queryTokens.includes(kw)) score += 2.5;
    const kwTokens = kw.split(' ').filter((w) => w.length > 2);
    if (kwTokens.length > 1 && kwTokens.every((t) => queryNorm.includes(t))) score += 3;
    for (const kt of kwTokens) {
      if (queryTokens.includes(kt)) score += 1.8;
    }
  }

  const qTokens = tokenize(faq.question);
  for (const t of queryTokens) {
    if (qTokens.includes(t)) score += 1.2;
    if (ans.includes(t)) score += 0.25;
  }

  return score;
}

function rankFaqs(faqs, queryNorm, queryTokens) {
  return faqs
    .map((faq) => ({ faq, score: scoreFaq(faq, queryNorm, queryTokens) }))
    .sort((a, b) => b.score - a.score);
}

function buildFaqSuggestions(ranked, { excludeId = null, minScore = SUGGESTION_MIN_SCORE } = {}) {
  const out = [];
  const seen = new Set();
  for (const row of ranked) {
    if (row.score < minScore) continue;
    if (excludeId && row.faq.id === excludeId) continue;
    const key = row.faq.id;
    if (seen.has(key)) continue;
    seen.add(key);
    out.push({
      id: row.faq.id,
      question: row.faq.question,
      score: Number(row.score.toFixed(2))
    });
    if (out.length >= SUGGESTION_MAX) break;
  }
  return out;
}

function evaluateFaqQuery(ranked, matchThreshold, { queryTokens = [] } = {}) {
  const best = ranked[0];
  if (!best || best.score < SUGGESTION_MIN_SCORE) {
    return {
      matched: false,
      partialMatch: false,
      best: null,
      score: 0,
      suggestions: []
    };
  }

  const second = ranked[1];
  const gap = second ? best.score - second.score : best.score;
  const candidates = ranked.filter((row) => row.score >= SUGGESTION_MIN_SCORE);
  const shortQuery = queryTokens.length > 0 && queryTokens.length <= 2;

  // Palavra-chave / dúvida ambígua: oferece alternativas em vez de responder sozinho.
  let confident = false;
  if (best.score >= matchThreshold) {
    if (best.score >= CONFIDENT_MATCH_SCORE) {
      confident = true;
    } else if (shortQuery && candidates.length >= 2) {
      confident = false;
    } else if (candidates.length === 1) {
      confident = true;
    } else if (!shortQuery && gap >= 2.5) {
      // Frase completa com líder claro → responde direto.
      confident = true;
    } else if (gap >= CONFIDENT_SCORE_GAP) {
      confident = true;
    }
  }

  if (confident) {
    return {
      matched: true,
      partialMatch: false,
      best,
      score: Number(best.score.toFixed(2)),
      suggestions: buildFaqSuggestions(ranked, {
        excludeId: best.faq.id,
        minScore: 1
      })
    };
  }

  const suggestions = buildFaqSuggestions(ranked, {
    excludeId: null,
    minScore: SUGGESTION_MIN_SCORE
  });
  return {
    matched: false,
    partialMatch: suggestions.length > 0,
    best: null,
    score: 0,
    suggestions
  };
}

function listFaqs(user, { includeDisabled = false } = {}) {
  if (!user) return { ok: false, status: 401 };
  const data = store.load();
  let list = [...ensureFaqs(data)];
  saveIfFaqsChanged(data);

  if (user.role === 'superadmin') {
    if (!includeDisabled) list = list.filter((f) => f.enabled !== false);
  } else if (['admin_empresa', 'apurador'].includes(user.role)) {
    list = list.filter((f) => f.enabled !== false && audienceAllows(f, user.role));
  } else {
    return { ok: false, status: 403, error: 'Acesso negado.' };
  }

  list.sort((a, b) => (Number(a.sortOrder) || 0) - (Number(b.sortOrder) || 0) || (a.question > b.question ? 1 : -1));
  return { ok: true, data: { faqs: list.map(publicFaqView) } };
}

function getFaq(user, faqId) {
  if (!user) return { ok: false, status: 401 };
  if (user.role !== 'superadmin') return { ok: false, status: 403, error: 'Acesso negado.' };
  const data = store.load();
  const faq = ensureFaqs(data).find((f) => f.id === faqId);
  if (!faq) return { ok: false, status: 404, error: 'FAQ não encontrada.' };
  return { ok: true, data: publicFaqView(faq) };
}

function createFaq(user, payload = {}) {
  if (!user) return { ok: false, status: 401 };
  if (user.role !== 'superadmin') return { ok: false, status: 403, error: 'Apenas o Adm_Plataforma gerencia FAQs.' };

  const question = String(payload.question || '')
    .trim()
    .replace(/<[^>]*>/g, '')
    .slice(0, QUESTION_MAX);
  const answer = String(payload.answer || '')
    .trim()
    .replace(/<[^>]*>/g, '')
    .slice(0, ANSWER_MAX);
  if (!question) return { ok: false, status: 400, error: 'Informe a pergunta.' };
  if (!answer) return { ok: false, status: 400, error: 'Informe a resposta do bot.' };

  const data = store.load();
  const now = new Date().toISOString();
  const faq = {
    id: store.uid('faq'),
    question,
    answer,
    keywords: sanitizeKeywords(payload.keywords),
    audience: sanitizeAudience(payload.audience),
    enabled: payload.enabled !== false,
    sortOrder: Number.isFinite(Number(payload.sortOrder)) ? Number(payload.sortOrder) : 100,
    createdAt: now,
    updatedAt: now,
    updatedByUserId: user.id,
    updatedByName: user.nome || user.email || user.id
  };
  ensureFaqs(data).push(faq);
  appendAudit(data, {
    userId: user.id,
    userName: user.nome || user.email || user.id,
    action: 'faq_suporte_criada',
    resourceType: 'support_faq',
    resourceId: faq.id,
    newValue: { question: faq.question }
  });
  store.save(data);
  return { ok: true, data: publicFaqView(faq) };
}

function updateFaq(user, faqId, payload = {}) {
  if (!user) return { ok: false, status: 401 };
  if (user.role !== 'superadmin') return { ok: false, status: 403, error: 'Apenas o Adm_Plataforma gerencia FAQs.' };

  const data = store.load();
  const list = ensureFaqs(data);
  const idx = list.findIndex((f) => f.id === faqId);
  if (idx < 0) return { ok: false, status: 404, error: 'FAQ não encontrada.' };

  const prev = list[idx];
  const next = { ...prev };
  if (payload.question !== undefined) {
    const question = String(payload.question || '')
      .trim()
      .replace(/<[^>]*>/g, '')
      .slice(0, QUESTION_MAX);
    if (!question) return { ok: false, status: 400, error: 'Informe a pergunta.' };
    next.question = question;
  }
  if (payload.answer !== undefined) {
    const answer = String(payload.answer || '')
      .trim()
      .replace(/<[^>]*>/g, '')
      .slice(0, ANSWER_MAX);
    if (!answer) return { ok: false, status: 400, error: 'Informe a resposta do bot.' };
    next.answer = answer;
  }
  if (payload.keywords !== undefined) next.keywords = sanitizeKeywords(payload.keywords);
  if (payload.audience !== undefined) next.audience = sanitizeAudience(payload.audience);
  if (payload.enabled !== undefined) next.enabled = Boolean(payload.enabled);
  if (payload.sortOrder !== undefined && Number.isFinite(Number(payload.sortOrder))) {
    next.sortOrder = Number(payload.sortOrder);
  }
  next.updatedAt = new Date().toISOString();
  next.updatedByUserId = user.id;
  next.updatedByName = user.nome || user.email || user.id;
  list[idx] = next;

  appendAudit(data, {
    userId: user.id,
    userName: user.nome || user.email || user.id,
    action: 'faq_suporte_atualizada',
    resourceType: 'support_faq',
    resourceId: next.id,
    previousValue: { question: prev.question },
    newValue: { question: next.question, enabled: next.enabled }
  });
  store.save(data);
  return { ok: true, data: publicFaqView(next) };
}

function deleteFaq(user, faqId) {
  if (!user) return { ok: false, status: 401 };
  if (user.role !== 'superadmin') return { ok: false, status: 403, error: 'Apenas o Adm_Plataforma gerencia FAQs.' };

  const data = store.load();
  const list = ensureFaqs(data);
  const idx = list.findIndex((f) => f.id === faqId);
  if (idx < 0) return { ok: false, status: 404, error: 'FAQ não encontrada.' };
  const [removed] = list.splice(idx, 1);
  appendAudit(data, {
    userId: user.id,
    userName: user.nome || user.email || user.id,
    action: 'faq_suporte_excluida',
    resourceType: 'support_faq',
    resourceId: faqId,
    previousValue: { question: removed.question }
  });
  store.save(data);
  return { ok: true, data: { id: faqId } };
}

function askBot(user, payload = {}) {
  if (!user) return { ok: false, status: 401 };
  if (!['admin_empresa', 'apurador', 'superadmin'].includes(user.role)) {
    return { ok: false, status: 403, error: 'Acesso negado.' };
  }
  const query = String(payload.query || payload.question || '')
    .trim()
    .replace(/<[^>]*>/g, '')
    .slice(0, QUESTION_MAX);
  if (!query) return { ok: false, status: 400, error: 'Digite sua pergunta.' };

  const data = store.load();
  const role = user.role;
  const faqs = ensureFaqs(data).filter((f) => f.enabled !== false && audienceAllows(f, role));
  saveIfFaqsChanged(data);

  const queryNorm = normalize(query);
  const queryTokens = tokenize(query);
  const ranked = rankFaqs(faqs, queryNorm, queryTokens);
  const evalResult = evaluateFaqQuery(ranked, MATCH_THRESHOLD, { queryTokens });

  const escalateHint =
    user.role === 'superadmin'
      ? 'Se a resposta não resolver, use “Falar com um Atendente” para falar com o Adm_Plataforma Master.'
      : 'Se a resposta não resolver, use “Falar com um Atendente”. Um atendente da plataforma responde conforme a demanda (prazo de até 24h).';

  return {
    ok: true,
    data: {
      matched: evalResult.matched,
      partialMatch: evalResult.partialMatch,
      score: evalResult.score,
      faq: evalResult.best ? publicFaqView(evalResult.best.faq) : null,
      suggestions: evalResult.suggestions,
      escalateHint
    }
  };
}

function askPublicBot(payload = {}) {
  const query = String(payload.query || payload.question || '')
    .trim()
    .replace(/<[^>]*>/g, '')
    .slice(0, QUESTION_MAX);
  if (!query) return { ok: false, status: 400, error: 'Digite sua pergunta.' };

  const queryNorm = normalize(query);
  if (isConfidentialQuery(queryNorm)) {
    return {
      ok: true,
      data: {
        matched: false,
        confidential: true,
        score: 0,
        faq: null,
        answer: CONFIDENTIAL_REFUSAL,
        suggestions: [],
        escalateHint:
          'Para dúvidas gerais sobre o uso do canal (sem dados confidenciais), use Fale conosco na página inicial.'
      }
    };
  }

  const data = store.load();
  const faqs = ensureFaqs(data).filter((f) => f.enabled !== false && audienceAllows(f, 'public'));
  saveIfFaqsChanged(data);

  const queryTokens = tokenize(query);
  const ranked = rankFaqs(faqs, queryNorm, queryTokens);
  const publicThreshold = Math.max(MATCH_THRESHOLD, 6);
  const evalResult = evaluateFaqQuery(ranked, publicThreshold, { queryTokens });

  return {
    ok: true,
    data: {
      matched: evalResult.matched,
      partialMatch: evalResult.partialMatch,
      confidential: false,
      score: evalResult.score,
      faq: evalResult.best ? publicFaqView(evalResult.best.faq) : null,
      answer: evalResult.best ? evalResult.best.faq.answer : null,
      suggestions: evalResult.suggestions,
      escalateHint:
        'Se precisar de orientação geral, use Fale conosco. Para denúncias, use Fazer uma denúncia. Não solicitamos nem revelamos dados confidenciais por este assistente.'
    }
  };
}

module.exports = {
  DEFAULT_FAQS,
  MATCH_THRESHOLD,
  ensureFaqs,
  listFaqs,
  getFaq,
  createFaq,
  updateFaq,
  deleteFaq,
  askBot,
  askPublicBot,
  publicFaqView,
  isConfidentialQuery,
  CONFIDENTIAL_REFUSAL
};
