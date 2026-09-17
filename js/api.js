/**
 * api.js – Camada de acesso a dados.
 * Protótipo: usa localStorage via CSStore.
 * Futuro: substituir corpos das funções por fetch() para API REST.
 *
 * Exemplo futuro:
 *   const res = await fetch(`${API_BASE}/companies`, { headers: authHeaders() });
 *   return res.json();
 */

const CSApi = (() => {
  const delay = (ms = 120) => new Promise((r) => setTimeout(r, ms));

  function useHttp() {
    return typeof CSHttpApi !== 'undefined' && CSHttpApi.enabled();
  }

  function store() {
    return window.CSStore.loadStore();
  }

  function persist(data) {
    window.CSStore.saveStore(data);
  }

  function uid(prefix) {
    return `${prefix}_${Date.now().toString(36)}_${Math.random().toString(36).slice(2, 7)}`;
  }

  function audit(data, entry) {
    if (typeof CSAudit !== 'undefined') {
      CSAudit.write(data, entry);
    }
  }

  function auditActor(payload = {}, actor = {}) {
    return {
      userId: payload._actorId || actor.id || 'system',
      userName: payload._actorName || actor.nome || 'Sistema'
    };
  }

  /* ---------- Access guards (espelham enforcement futuro no backend) ---------- */
  function resolveActor(actor) {
    if (actor && (actor.id || actor.role)) return actor;
    if (typeof CSAuth !== 'undefined') {
      const session = CSAuth.getSession();
      if (session) return session;
    }
    return actor || {};
  }

  function isSuperadmin(actor) {
    return resolveActor(actor).role === 'superadmin';
  }

  const PROTECTED_PLATFORM_EMAIL = 'admin@fxfelipexavier.com.br';

  function normalizeEmail(value) {
    return String(value || '')
      .trim()
      .toLowerCase();
  }

  function isProtectedUser(user) {
    return normalizeEmail(user && user.email) === PROTECTED_PLATFORM_EMAIL;
  }

  function assertNotProtectedUser(user, action = 'alterar') {
    if (isProtectedUser(user)) {
      throw new Error(
        `Não é permitido ${action} o administrador protegido da plataforma (${PROTECTED_PLATFORM_EMAIL}).`
      );
    }
  }

  function assertSuperadmin(actor, message = 'Operação restrita ao administrador da plataforma.') {
    if (!isSuperadmin(actor)) {
      if (typeof CSInfraLog !== 'undefined') {
        CSInfraLog.security('acesso_negado', {
          severity: 'warn',
          outcome: 'failure',
          actor: resolveActor(actor),
          context: { reason: 'superadmin_required' }
        });
      }
      throw new Error(message);
    }
    return resolveActor(actor);
  }

  function assertCompanyScope(companyId, actor, message = 'Acesso não autorizado a dados de outra empresa.') {
    if (!companyId || isSuperadmin(actor)) return resolveActor(actor);
    const a = resolveActor(actor);
    if (!a.id) return a;
    if (!a.companyId || a.companyId !== companyId) {
      if (typeof CSInfraLog !== 'undefined') {
        CSInfraLog.security('acesso_negado_cross_tenant', {
          severity: 'warn',
          outcome: 'failure',
          actor: a,
          context: { targetCompanyId: companyId, sessionCompanyId: a.companyId || null }
        });
      }
      throw new Error(message);
    }
    return a;
  }

  function assertReportAccess(report, actor, message = 'Acesso não autorizado a este relato.') {
    if (!report) throw new Error('Relato não encontrado.');
    assertCompanyScope(report.companyId, actor, message);
    const a = resolveActor(actor);
    if (a.role === 'apurador') {
      const onTeam = Array.isArray(report.teamIds) && report.teamIds.includes(a.id);
      if (report.assigneeId !== a.id && !onTeam) {
        throw new Error('Relato não encontrado.');
      }
    }
    return report;
  }

  function filterReportsForActor(list, actor) {
    const a = resolveActor(actor);
    if (!a.id || a.role !== 'apurador') return list;
    return list.filter((r) => {
      if (r.assigneeId === a.id) return true;
      return Array.isArray(r.teamIds) && r.teamIds.includes(a.id);
    });
  }

  /** Força companyId do token quando o usuário não é superadmin. */
  function scopeFilters(filters = {}, actor = null) {
    const a = actor !== null ? resolveActor(actor) : resolveActor({});
    if (!a.id || isSuperadmin(a)) return { ...filters };
    if (a.companyId) return { ...filters, companyId: a.companyId };
    return { ...filters };
  }

  function ensureCompanySettings(data, companyId) {
    data.companySettings = data.companySettings || {};
    if (!data.companySettings[companyId]) {
      const prefix = data.platformSettings?.defaultProtocolPrefix || 'CS';
      data.companySettings[companyId] = { protocolPrefix: prefix, protocolCounter: 100 };
    }
    return data.companySettings[companyId];
  }

  function companySettingsSync(data, companyId) {
    return ensureCompanySettings(data, companyId);
  }

  /* ---------- Settings (platform vs company) ---------- */
  function platformSettingsSync(data) {
    if (data.platformSettings) {
      if (!data.platformSettings.supportEmail) {
        data.platformSettings.supportEmail = 'contato@fxfelipexavier.com.br';
      }
      if (
        data.platformSettings.commercialWhatsApp == null ||
        data.platformSettings.commercialWhatsApp === ''
      ) {
        data.platformSettings.commercialWhatsApp = '047984570646';
      }
      if (typeof data.platformSettings.hideLandingPlans !== 'boolean') {
        data.platformSettings.hideLandingPlans = false;
      }
      if (!data.platformSettings.uiDefaults || typeof data.platformSettings.uiDefaults !== 'object') {
        data.platformSettings.uiDefaults = { tableFontSize: 'md' };
      } else if (!['sm', 'md', 'lg', 'xl'].includes(data.platformSettings.uiDefaults.tableFontSize)) {
        data.platformSettings.uiDefaults.tableFontSize = 'md';
      }
      return data.platformSettings;
    }
    const legacy = data.settings || {};
    return {
      defaultTheme: legacy.defaultTheme || 'light',
      fxBrandName: legacy.fxBrandName || 'FX Felipe Xavier',
      fxProductName: legacy.fxProductName || 'Canal Seguro',
      supportEmail: legacy.supportEmail || 'contato@fxfelipexavier.com.br',
      commercialWhatsApp: '047984570646',
      hideLandingPlans: false,
      defaultProtocolPrefix: legacy.protocolPrefix || 'CS'
    };
  }

  function normalizeLocalWhatsAppE164(raw) {
    let d = String(raw || '').replace(/\D/g, '');
    if (!d) return '';
    if (d.startsWith('0')) d = d.slice(1);
    if (!d.startsWith('55') && (d.length === 10 || d.length === 11)) d = `55${d}`;
    if (d.length < 12 || d.length > 13) return '';
    return d;
  }

  function buildCommercialInterestMessage({
    planId = '',
    planName = '',
    originLabel = 'site Canal Seguro (seção Planos e preços)'
  } = {}) {
    const plan = String(planName || '').trim() || String(planId || '').trim() || 'disponível';
    return [
      `Olá! Cheguei pelo ${originLabel}.`,
      `Gostaria de saber mais a respeito do plano de contratação para o painel de denúncias (plano "${plan}").`
    ].join(' ');
  }

  async function getPlatformSettings() {
    if (useHttp()) {
      try {
        const contact = await CSHttpApi.getCommercialContact();
        const data = store();
        const platform = platformSettingsSync(data);
        if (contact?.supportEmail) platform.supportEmail = contact.supportEmail;
        if (contact?.commercialWhatsApp != null) platform.commercialWhatsApp = contact.commercialWhatsApp;
        if (typeof contact?.hideLandingPlans === 'boolean') {
          platform.hideLandingPlans = contact.hideLandingPlans;
        }
        data.platformSettings = platform;
        persist(data);
        return { ...platform };
      } catch {
        /* fallback local */
      }
    }
    await delay();
    return platformSettingsSync(store());
  }

  async function getPublicCommercialContact() {
    if (useHttp()) return CSHttpApi.getPublicCommercialContact();
    await delay(20);
    const platform = platformSettingsSync(store());
    const display = String(platform.commercialWhatsApp || '').trim();
    const e164 = normalizeLocalWhatsAppE164(display);
    return {
      supportEmail: platform.supportEmail || 'contato@fxfelipexavier.com.br',
      commercialWhatsApp: display,
      commercialWhatsAppE164: e164 || null,
      whatsappAvailable: Boolean(e164)
    };
  }

  async function getDatabaseConfig() {
    if (CSRuntime.useServer()) {
      return CSHttpApi.getDatabaseConfig();
    }
    return {
      enabled: false,
      host: '',
      port: 3306,
      user: '',
      database: '',
      hasPassword: false,
      source: 'local',
      envOverridesActive: false,
      persistenceMode: 'json',
      mysqlReady: false,
      note: 'Configuração MySQL disponível apenas com API servidor.'
    };
  }

  async function updateDatabaseConfig(payload = {}, actor = null) {
    if (CSRuntime.useServer()) {
      return CSHttpApi.updateDatabaseConfig(payload);
    }
    throw new Error('Configuração MySQL requer o servidor API.');
  }

  async function testDatabaseConnection(payload = {}, actor = null) {
    if (CSRuntime.useServer()) {
      return CSHttpApi.testDatabaseConnection(payload);
    }
    throw new Error('Teste de MySQL requer o servidor API.');
  }

  async function updateCommercialContact(payload = {}, actor = null) {
    if (useHttp()) {
      const result = await CSHttpApi.updateCommercialContact(payload);
      try {
        const data = store();
        const platform = platformSettingsSync(data);
        if (result?.supportEmail) platform.supportEmail = result.supportEmail;
        if (result?.commercialWhatsApp != null) platform.commercialWhatsApp = result.commercialWhatsApp;
        if (typeof result?.hideLandingPlans === 'boolean') {
          platform.hideLandingPlans = result.hideLandingPlans;
        }
        data.platformSettings = platform;
        persist(data);
      } catch {
        /* ignore local sync */
      }
      return result;
    }
    await delay(40);
    assertSuperadmin(resolveActor(actor));
    const data = store();
    const platform = platformSettingsSync(data);
    const previous = {
      supportEmail: platform.supportEmail,
      commercialWhatsApp: platform.commercialWhatsApp,
      hideLandingPlans: Boolean(platform.hideLandingPlans)
    };
    if (payload.supportEmail != null) {
      const email = String(payload.supportEmail || '').trim().slice(0, 120);
      if (!email || !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email)) {
        throw new Error('E-mail de suporte inválido.');
      }
      platform.supportEmail = email;
    }
    if (payload.commercialWhatsApp != null) {
      const display = String(payload.commercialWhatsApp || '').trim().slice(0, 20);
      if (display) {
        const e164 = normalizeLocalWhatsAppE164(display);
        if (!e164) {
          throw new Error('WhatsApp comercial inválido. Use DDD + número (ex.: 047984570646).');
        }
        platform.commercialWhatsApp = display;
      } else {
        platform.commercialWhatsApp = '';
      }
    }
    if (payload.hideLandingPlans != null) {
      platform.hideLandingPlans = Boolean(payload.hideLandingPlans);
    }
    data.platformSettings = platform;
    audit(data, {
      ...auditActor({}, resolveActor(actor)),
      action: 'atualizacao_contato_comercial',
      resourceType: 'platform_settings',
      resourceId: 'commercial_contact',
      companyId: null,
      previousValue: previous,
      newValue: {
        supportEmail: platform.supportEmail,
        commercialWhatsApp: platform.commercialWhatsApp,
        hideLandingPlans: Boolean(platform.hideLandingPlans)
      }
    });
    persist(data);
    return {
      supportEmail: platform.supportEmail,
      commercialWhatsApp: platform.commercialWhatsApp,
      commercialWhatsAppE164: normalizeLocalWhatsAppE164(platform.commercialWhatsApp) || null,
      hideLandingPlans: Boolean(platform.hideLandingPlans)
    };
  }

  const TABLE_FONT_SIZES = ['sm', 'md', 'lg', 'xl'];

  function normalizeLocalTableFont(value) {
    const v = String(value || '').trim().toLowerCase();
    return TABLE_FONT_SIZES.includes(v) ? v : null;
  }

  function ensureLocalPlatformUiDefaults(data) {
    const platform = platformSettingsSync(data);
    if (!platform.uiDefaults || typeof platform.uiDefaults !== 'object') platform.uiDefaults = {};
    if (!normalizeLocalTableFont(platform.uiDefaults.tableFontSize)) {
      platform.uiDefaults.tableFontSize = 'md';
    }
    data.platformSettings = platform;
    return platform.uiDefaults;
  }

  function isLocalCompanyTableFontConfigured(cfg) {
    const ui = cfg?.uiDefaults;
    if (!ui || typeof ui !== 'object') return false;
    if (ui.tableFontSizeConfigured === true) return true;
    return Boolean(normalizeLocalTableFont(ui.tableFontSize));
  }

  function buildLocalUiDefaults(actor) {
    const data = store();
    const uiPlat = ensureLocalPlatformUiDefaults(data);
    const platformSize = normalizeLocalTableFont(uiPlat.tableFontSize) || 'md';
    let companySize = null;
    let companyConfigured = false;
    if (actor?.companyId) {
      const cfg = ensureCompanySettings(data, actor.companyId);
      companyConfigured = isLocalCompanyTableFontConfigured(cfg);
      if (companyConfigured) companySize = normalizeLocalTableFont(cfg.uiDefaults.tableFontSize);
    }
    const userRec = (data.users || []).find((u) => u.id === actor?.id);
    const userSize = normalizeLocalTableFont(userRec?.preferences?.tableFontSize);
    const effective = userSize || companySize || platformSize;
    const source = userSize ? 'user' : companySize ? 'company' : 'platform';
    return {
      tableFontSize: effective,
      source,
      layers: { user: userSize || null, company: companySize, platform: platformSize },
      companyConfigured,
      options: TABLE_FONT_SIZES.slice(),
      canEditPlatform: actor?.role === 'superadmin',
      canEditCompany: actor?.role === 'admin_empresa' && Boolean(actor?.companyId)
    };
  }

  async function getUiDefaults(actor = null) {
    if (useHttp()) {
      try {
        return await CSHttpApi.getUiDefaults();
      } catch {
        /* fallback local */
      }
    }
    await delay(20);
    return buildLocalUiDefaults(resolveActor(actor));
  }

  async function updatePlatformUiDefaults(payload = {}, actor = null) {
    if (useHttp()) return CSHttpApi.updatePlatformUiDefaults(payload);
    await delay(40);
    const a = resolveActor(actor);
    assertSuperadmin(a);
    const size = normalizeLocalTableFont(payload.tableFontSize);
    if (!size) throw new Error('Tamanho de fonte inválido.');
    const data = store();
    const ui = ensureLocalPlatformUiDefaults(data);
    const previous = ui.tableFontSize;
    ui.tableFontSize = size;
    data.platformSettings.uiDefaults = ui;
    audit(data, {
      ...auditActor({}, a),
      action: 'atualizacao_ui_defaults_plataforma',
      resourceType: 'platform_settings',
      resourceId: 'ui_defaults',
      companyId: null,
      previousValue: { tableFontSize: previous },
      newValue: { tableFontSize: size }
    });
    persist(data);
    return buildLocalUiDefaults(a);
  }

  async function updateCompanyUiDefaults(payload = {}, actor = null) {
    if (useHttp()) return CSHttpApi.updateCompanyUiDefaults(payload);
    await delay(40);
    const a = resolveActor(actor);
    if (a.role !== 'admin_empresa' || !a.companyId) {
      throw new Error('Apenas o Adm_Empresa pode definir o padrão das planilhas no painel da empresa.');
    }
    const clear = payload.tableFontSize == null || String(payload.tableFontSize).trim() === '';
    const size = clear ? null : normalizeLocalTableFont(payload.tableFontSize);
    if (!clear && !size) throw new Error('Tamanho de fonte inválido.');
    const data = store();
    const cfg = ensureCompanySettings(data, a.companyId);
    if (!cfg.uiDefaults || typeof cfg.uiDefaults !== 'object') cfg.uiDefaults = {};
    const previous = {
      tableFontSize: cfg.uiDefaults.tableFontSize || null,
      tableFontSizeConfigured: Boolean(cfg.uiDefaults.tableFontSizeConfigured)
    };
    if (clear) {
      delete cfg.uiDefaults.tableFontSize;
      cfg.uiDefaults.tableFontSizeConfigured = false;
    } else {
      cfg.uiDefaults.tableFontSize = size;
      cfg.uiDefaults.tableFontSizeConfigured = true;
    }
    audit(data, {
      ...auditActor({}, a),
      action: 'atualizacao_ui_defaults_empresa',
      resourceType: 'company_settings',
      resourceId: 'ui_defaults',
      companyId: a.companyId,
      previousValue: previous,
      newValue: {
        tableFontSize: cfg.uiDefaults.tableFontSize || null,
        tableFontSizeConfigured: Boolean(cfg.uiDefaults.tableFontSizeConfigured)
      }
    });
    persist(data);
    return buildLocalUiDefaults(a);
  }

  async function updateMyUiDefaults(payload = {}, actor = null) {
    if (useHttp()) return CSHttpApi.updateMyUiDefaults(payload);
    await delay(40);
    const a = resolveActor(actor);
    if (!a.id) throw new Error('Sessão inválida.');
    const clear = payload.tableFontSize == null || String(payload.tableFontSize).trim() === '';
    const size = clear ? null : normalizeLocalTableFont(payload.tableFontSize);
    if (!clear && !size) throw new Error('Tamanho de fonte inválido.');
    const data = store();
    const idx = (data.users || []).findIndex((u) => u.id === a.id);
    if (idx < 0) throw new Error('Usuário não encontrado.');
    if (!data.users[idx].preferences || typeof data.users[idx].preferences !== 'object') {
      data.users[idx].preferences = {};
    }
    const previous = data.users[idx].preferences.tableFontSize || null;
    if (clear) delete data.users[idx].preferences.tableFontSize;
    else data.users[idx].preferences.tableFontSize = size;
    audit(data, {
      userId: a.id,
      userName: data.users[idx].nome,
      action: 'atualizacao_preferencia_fonte_planilha',
      resourceType: 'user',
      resourceId: a.id,
      companyId: data.users[idx].companyId || null,
      previousValue: { tableFontSize: previous },
      newValue: { tableFontSize: data.users[idx].preferences.tableFontSize || null }
    });
    persist(data);
    return buildLocalUiDefaults({ ...a, preferences: data.users[idx].preferences });
  }

  async function getCompanySettings(companyId, actor = null) {
    await delay();
    if (!companyId) throw new Error('Empresa não informada.');
    const a = resolveActor(actor !== null ? actor : {});
    if (a.id) assertCompanyScope(companyId, a);
    const data = store();
    return { companyId, ...companySettingsSync(data, companyId) };
  }

  /* ---------- Companies ---------- */
  async function getCompanies(filters = {}, actor = null) {
    if (useHttp()) return CSHttpApi.getCompanies(filters);
    await delay();
    const scoped = scopeFilters({}, actor);
    let list = [...store().companies];
    if (scoped.companyId) list = list.filter((c) => c.id === scoped.companyId);
    if (filters.status) list = list.filter((c) => c.status === filters.status);
    if (filters.q) {
      const q = filters.q.toLowerCase();
      list = list.filter(
        (c) =>
          c.nomeFantasia.toLowerCase().includes(q) ||
          c.razaoSocial.toLowerCase().includes(q) ||
          c.cnpj.includes(q)
      );
    }
    return list;
  }

  async function getCompany(id, actor = undefined) {
    if (useHttp()) return CSHttpApi.getCompany(id);
    await delay();
    const company = store().companies.find((c) => c.id === id) || null;
    if (company) {
      const a = actor !== undefined ? resolveActor(actor) : resolveActor({});
      if (a.id) assertCompanyScope(company.id, a);
    }
    return company;
  }

  async function getCompanyByDomain(domain) {
    if (useHttp()) {
      try {
        return await CSHttpApi.getCompanyByDomain(domain);
      } catch {
        return null;
      }
    }
    await delay();
    const d = (domain || '').toLowerCase();
    return store().companies.find((c) => c.dominio.toLowerCase() === d || c.id === domain) || null;
  }

  async function getPublicCompany(key) {
    if (useHttp()) {
      try {
        return await CSHttpApi.getPublicCompany(key);
      } catch {
        return null;
      }
    }
    await delay();
    const lookup = String(key || '').toLowerCase();
    const company =
      store().companies.find((c) => c.id === key || String(c.dominio || '').toLowerCase() === lookup) || null;
    if (!company || company.status !== 'ativo') return null;
    const { razaoSocial, cnpj, endereco, responsavel, email, telefone, ...publicFields } = company;
    return publicFields;
  }

  async function createCompany(payload) {
    if (useHttp()) {
      const { _actorId, _actorName, ...body } = payload || {};
      return CSHttpApi.createCompany(body);
    }
    await delay();
    assertSuperadmin(resolveActor(payload));
    const data = store();
    const company = {
      id: uid('cmp'),
      status: 'ativo',
      createdAt: new Date().toISOString(),
      logo: null,
      storageLimitBytes:
        typeof payload.storageLimitBytes === 'number' ? payload.storageLimitBytes : 1073741824,
      storageUsedBytes: 0,
      nomeCanal: payload.nomeCanal || `Canal Seguro ${payload.nomeFantasia}`,
      mensagemInicial:
        payload.mensagemInicial ||
        'Este é um canal seguro destinado à orientação, prevenção e comunicação de situações que possam comprometer o respeito, a segurança e o bem-estar no ambiente de trabalho.',
      ...payload
    };
    data.companies.push(company);
    ensureCompanySettings(data, company.id);
    audit(data, {
      ...auditActor(payload),
      action: 'criacao_empresa',
      resourceType: 'company',
      resourceId: company.id,
      companyId: company.id
    });
    persist(data);
    return company;
  }

  async function updateCompany(id, payload) {
    if (useHttp()) {
      const { _actorId, _actorName, ...body } = payload || {};
      return CSHttpApi.updateCompany(id, body);
    }
    await delay();
    const data = store();
    const idx = data.companies.findIndex((c) => c.id === id);
    if (idx < 0) throw new Error('Empresa não encontrada');
    const previous = { ...data.companies[idx] };
    const a = resolveActor(payload);
    if (!isSuperadmin(a)) {
      assertCompanyScope(id, a);
      if (payload.status && payload.status !== previous.status) {
        throw new Error('Apenas o administrador da plataforma pode alterar o status da empresa.');
      }
    }
    data.companies[idx] = { ...data.companies[idx], ...payload, id };
    const updated = data.companies[idx];
    if (typeof payload.email === 'string') {
      const cfg = ensureCompanySettings(data, id);
      cfg.emailNotifications = {
        ...(cfg.emailNotifications || {}),
        replyTo: payload.email.trim() || cfg.emailNotifications?.replyTo || null
      };
    }
    const statusChanged = payload.status && payload.status !== previous.status;
    audit(data, {
      ...auditActor(payload),
      action: statusChanged && payload.status === 'inativo' ? 'desativacao_empresa' : 'edicao_empresa',
      resourceType: 'company',
      resourceId: id,
      companyId: id,
      previousValue: statusChanged ? { status: previous.status } : undefined,
      newValue: statusChanged ? { status: updated.status } : undefined
    });
    persist(data);
    return data.companies[idx];
  }

  async function getCompanyEmailNotifications(companyId, actor = null) {
    if (useHttp()) return CSHttpApi.getCompanyEmailNotifications(companyId);
    await delay();
    const a = resolveActor(actor !== null ? actor : {});
    if (a.id) assertCompanyScope(companyId, a);
    const data = store();
    const company = data.companies.find((c) => c.id === companyId);
    const cfg = ensureCompanySettings(data, companyId);
    const defaults = {
      enabled: true,
      fromName: company?.nomeCanal || 'Canal Seguro',
      replyTo: company?.email || null,
      events: {
        report_new: {
          enabled: true,
          roles: ['admin_empresa'],
          notifyCompanyEmail: true
        }
      }
    };
    const stored = cfg.emailNotifications || {};
    return {
      policy: {
        ...defaults,
        ...stored,
        events: { ...defaults.events, ...(stored.events || {}) }
      }
    };
  }

  async function updateCompanyEmailNotifications(companyId, patch, actor = null) {
    if (useHttp()) return CSHttpApi.updateCompanyEmailNotifications(companyId, patch);
    await delay();
    const a = resolveActor(actor !== null ? actor : {});
    if (a.id) assertCompanyScope(companyId, a);
    if (a.role && a.role !== 'superadmin' && a.role !== 'admin_empresa') {
      throw new Error('Acesso negado.');
    }
    const data = store();
    const cfg = ensureCompanySettings(data, companyId);
    const prev = (await getCompanyEmailNotifications(companyId, a)).policy;
    const { events: patchEvents, ...restPatch } = patch || {};
    const patchedEvents = { ...(prev.events || {}) };
    for (const [key, value] of Object.entries(patchEvents || {})) {
      patchedEvents[key] = { ...(patchedEvents[key] || {}), ...(value || {}) };
    }
    const next = { ...prev, ...restPatch, events: patchedEvents };
    cfg.emailNotifications = next;
    audit(data, {
      ...auditActor(actor || {}),
      action: 'email_politica_alterada',
      resourceType: 'company',
      resourceId: companyId,
      companyId,
      previousValue: { enabled: prev.enabled },
      newValue: { enabled: next.enabled }
    });
    persist(data);
    return { policy: next };
  }

  async function deactivateCompany(id, actor = {}) {
    assertSuperadmin(actor);
    return updateCompany(id, { status: 'inativo', _actorId: actor.id, _actorName: actor.nome });
  }

  async function deleteCompany(id, actor = {}) {
    const a = assertSuperadmin(actor);
    if (useHttp()) {
      try {
        await CSHttpApi.deleteCompany(id);
      } catch (err) {
        if (!(err && err.status === 404)) throw err;
      }
    }
    await delay();
    const data = store();
    const company = (data.companies || []).find((c) => c.id === id);
    if (!company) {
      if (useHttp()) return { ok: true };
      throw new Error('Empresa não encontrada');
    }
    const protectedOnCompany = (data.users || []).filter(
      (u) => u.companyId === id && isProtectedUser(u)
    );
    if (protectedOnCompany.length) {
      throw new Error(
        'Não é possível excluir a empresa: há um administrador protegido vinculado a ela.'
      );
    }
    const reportIds = new Set(
      (data.reports || []).filter((r) => r.companyId === id).map((r) => r.id)
    );
    data.reports = (data.reports || []).filter((r) => r.companyId !== id);
    data.reportHistory = (data.reportHistory || []).filter((h) => !reportIds.has(h.reportId));
    data.reportMessages = (data.reportMessages || []).filter((m) => !reportIds.has(m.reportId));
    data.reportRiskHistory = (data.reportRiskHistory || []).filter(
      (h) => h.companyId !== id && !reportIds.has(h.reportId)
    );
    data.employees = (data.employees || []).filter((e) => e.companyId !== id);
    data.users = (data.users || []).filter((u) => u.companyId !== id || isProtectedUser(u));
    data.contents = (data.contents || []).filter((c) => c.companyId !== id);
    data.notifications = (data.notifications || []).filter((n) => n.companyId !== id);
    if (data.companySettings && data.companySettings[id]) delete data.companySettings[id];
    data.companies = (data.companies || []).filter((c) => c.id !== id);
    audit(data, {
      userId: a.id || 'system',
      userName: a.nome || 'Sistema',
      action: 'exclusao_empresa',
      resourceType: 'company',
      resourceId: id,
      companyId: null,
      previousValue: {
        nomeFantasia: company.nomeFantasia,
        reportsRemoved: reportIds.size
      }
    });
    persist(data);
    return { ok: true };
  }

  /* ---------- Employees (colaboradores admitidos) ---------- */
  function normalizeCpfLocal(cpf) {
    return String(cpf || '').replace(/\D/g, '');
  }

  function sanitizeEmployee(emp) {
    if (!emp) return null;
    const { cpf, ...safe } = emp;
    return {
      ...safe,
      cpfMasked: typeof CSValidation !== 'undefined' ? CSValidation.maskCpf(cpf) : '***.***.***-**'
    };
  }

  async function getEmployees(filters = {}, actor = null) {
    if (useHttp()) return CSHttpApi.getEmployees(scopeFilters(filters, actor));
    await delay();
    const scoped = scopeFilters(filters, actor);
    let list = [...(store().employees || [])];
    if (scoped.companyId) list = list.filter((e) => e.companyId === scoped.companyId);
    if (scoped.status) list = list.filter((e) => e.status === scoped.status);
    if (scoped.q) {
      const q = scoped.q.toLowerCase();
      const qCpf = normalizeCpfLocal(q);
      list = list.filter(
        (e) =>
          e.nome.toLowerCase().includes(q) ||
          e.cpf.includes(qCpf) ||
          (e.matricula || '').toLowerCase().includes(q) ||
          (e.setor || '').toLowerCase().includes(q)
      );
    }
    return list.map(sanitizeEmployee);
  }

  async function getEmployee(id, actor = null) {
    if (useHttp()) return CSHttpApi.getEmployee(id);
    await delay();
    const emp = (store().employees || []).find((e) => e.id === id);
    if (emp) {
      const a = resolveActor(actor !== null ? actor : {});
      if (a.id) assertCompanyScope(emp.companyId, a);
    }
    return sanitizeEmployee(emp);
  }

  function getEmployeeByCpfSync(companyId, cpf) {
    const digits = normalizeCpfLocal(cpf);
    return (store().employees || []).find((e) => e.companyId === companyId && e.cpf === digits) || null;
  }

  async function validateEmployeeAccess(companyId, cpf) {
    if (useHttp()) return CSHttpApi.validateEmployeeAccess(companyId, cpf);
    await delay(150);
    const formatErr = CSValidation.cpf(cpf);
    if (formatErr) {
      return { ok: false, message: formatErr };
    }
    let emp = null;
    if (companyId) {
      emp = getEmployeeByCpfSync(companyId, cpf);
    } else {
      const digits = normalizeCpfLocal(cpf);
      const matches = (store().employees || []).filter((e) => e.cpf === digits);
      const active = matches.filter((e) => {
        if (e.status !== 'ativo') return false;
        const company = (store().companies || []).find((c) => c.id === e.companyId && c.status === 'ativo');
        return Boolean(company);
      });
      emp = active[0] || null;
    }
    if (!emp) {
      return {
        ok: false,
        message: 'CPF não encontrado na base de colaboradores. Verifique o cadastro com o RH da sua empresa.'
      };
    }
    if (emp.status !== 'ativo') {
      return {
        ok: false,
        message: 'Este CPF não está ativo na empresa. Colaboradores desligados não podem registrar novos relatos.'
      };
    }
    return { ok: true, employee: sanitizeEmployee(emp) };
  }

  async function createEmployee(payload) {
    if (useHttp()) {
      const { _actorId, _actorName, ...body } = payload || {};
      return CSHttpApi.createEmployee(body);
    }
    await delay();
    assertCompanyScope(payload.companyId, payload);
    const data = store();
    data.employees = data.employees || [];
    const cpf = normalizeCpfLocal(payload.cpf);
    const formatErr = CSValidation.cpf(cpf);
    if (formatErr) throw new Error(formatErr);
    const dup = data.employees.find((e) => e.companyId === payload.companyId && e.cpf === cpf);
    if (dup) throw new Error('Este CPF já está cadastrado nesta empresa.');
    const employee = {
      id: uid('emp'),
      companyId: payload.companyId,
      cpf,
      nome: payload.nome,
      email: payload.email || '',
      telefone: payload.telefone || '',
      matricula: payload.matricula || '',
      setor: payload.setor || '',
      cargo: payload.cargo || '',
      status: payload.status || 'ativo',
      createdAt: new Date().toISOString()
    };
    data.employees.push(employee);
    audit(data, {
      ...auditActor(payload),
      action: 'criacao_colaborador',
      resourceType: 'employee',
      resourceId: employee.id,
      companyId: payload.companyId
    });
    persist(data);
    return sanitizeEmployee(employee);
  }

  async function updateEmployee(id, payload) {
    if (useHttp()) {
      const { _actorId, _actorName, ...body } = payload || {};
      return CSHttpApi.updateEmployee(id, body);
    }
    await delay();
    const data = store();
    const idx = (data.employees || []).findIndex((e) => e.id === id);
    if (idx < 0) throw new Error('Colaborador não encontrado');
    const current = data.employees[idx];
    assertCompanyScope(current.companyId, payload);
    let cpf = current.cpf;
    if (payload.cpf) {
      cpf = normalizeCpfLocal(payload.cpf);
      const formatErr = CSValidation.cpf(cpf);
      if (formatErr) throw new Error(formatErr);
      const dup = data.employees.find(
        (e) => e.companyId === current.companyId && e.cpf === cpf && e.id !== id
      );
      if (dup) throw new Error('Este CPF já está cadastrado nesta empresa.');
    }
    const { _actorId, _actorName, ...rest } = payload;
    const previous = { ...current };
    data.employees[idx] = {
      ...current,
      ...rest,
      id,
      cpf,
      companyId: current.companyId
    };
    const updated = data.employees[idx];
    const statusChanged = payload.status && payload.status !== previous.status;
    audit(data, {
      userId: _actorId || 'system',
      userName: _actorName || 'Sistema',
      action: statusChanged && payload.status === 'desligado' ? 'desativacao_colaborador' : 'edicao_colaborador',
      resourceType: 'employee',
      resourceId: id,
      companyId: current.companyId,
      previousValue: statusChanged ? { status: previous.status } : undefined,
      newValue: statusChanged ? { status: updated.status } : undefined
    });
    persist(data);
    return sanitizeEmployee(data.employees[idx]);
  }

  async function deactivateEmployee(id, actor = {}) {
    return updateEmployee(id, { status: 'desligado', _actorId: actor.id, _actorName: actor.nome });
  }

  async function deleteEmployee(id, actor = {}) {
    const a = resolveActor(actor);
    if (a.role !== 'superadmin' && a.role !== 'admin_empresa') {
      throw new Error('Acesso negado.');
    }
    if (useHttp()) {
      try {
        await CSHttpApi.deleteEmployee(id);
      } catch (err) {
        if (!(err && err.status === 404)) throw err;
      }
    }
    await delay();
    const data = store();
    const idx = (data.employees || []).findIndex((e) => e.id === id);
    if (idx < 0) {
      if (useHttp()) return { ok: true };
      throw new Error('Colaborador não encontrado');
    }
    const emp = data.employees[idx];
    if (a.role !== 'superadmin') assertCompanyScope(emp.companyId, a);
    data.employees.splice(idx, 1);
    audit(data, {
      userId: a.id || 'system',
      userName: a.nome || 'Sistema',
      action: 'exclusao_colaborador',
      resourceType: 'employee',
      resourceId: id,
      companyId: emp.companyId,
      previousValue: { nome: emp.nome, matricula: emp.matricula || null }
    });
    persist(data);
    return { ok: true };
  }

  /* ---------- Reports ---------- */
  async function getReports(filters = {}, actor = null) {
    if (useHttp()) return CSHttpApi.getReports(scopeFilters(filters, actor));
    await delay();
    const scoped = scopeFilters(filters, actor);
    const data = store();
    let list = [...data.reports];
    if (scoped.companyId) list = list.filter((r) => r.companyId === scoped.companyId);
    if (scoped.status) list = list.filter((r) => r.status === scoped.status);
    if (scoped.category) list = list.filter((r) => r.category === scoped.category);
    if (scoped.sector) list = list.filter((r) => (r.sector || '').toLowerCase().includes(scoped.sector.toLowerCase()));
    if (scoped.anonymous === true) list = list.filter((r) => r.isAnonymous);
    if (scoped.anonymous === false) list = list.filter((r) => !r.isAnonymous);
    if (scoped.q) {
      const q = scoped.q.toLowerCase();
      list = list.filter(
        (r) =>
          r.protocol.toLowerCase().includes(q) ||
          (r.sector || '').toLowerCase().includes(q) ||
          (r.description || '').toLowerCase().includes(q)
      );
    }
    if (scoped.from) list = list.filter((r) => r.createdAt >= scoped.from);
    if (scoped.to) list = list.filter((r) => r.createdAt <= scoped.to);
    if (scoped.riskLevel === 'unclassified') list = list.filter((r) => !r.riskLevel);
    else if (scoped.riskLevel) list = list.filter((r) => r.riskLevel === scoped.riskLevel);
    if (scoped.workflowStage) list = list.filter((r) => r.workflowStage === scoped.workflowStage);
    if (scoped.priority) list = list.filter((r) => (r.priority || 'normal') === scoped.priority);
    if (scoped.alert === 'stalled') {
      const stalledMs = 120 * 60 * 60 * 1000;
      const now = Date.now();
      list = list.filter((r) => {
        if (r.workflowStage === 'concluido' || r.status === 'concluido') return false;
        initLocalWorkflow(r);
        const stageAt = r.workflowStageAt ? new Date(r.workflowStageAt).getTime() : now;
        return now - stageAt > stalledMs;
      });
    } else if (scoped.alert === 'noAssignee') {
      list = list.filter((r) => {
        if (r.workflowStage === 'concluido' || r.status === 'concluido') return false;
        initLocalWorkflow(r);
        return (
          !r.assigneeId &&
          LOCAL_WORKFLOW_ORDER.indexOf(r.workflowStage) >= LOCAL_WORKFLOW_ORDER.indexOf('triagem')
        );
      });
    }
    list = filterReportsForActor(list, actor !== null ? actor : {});
    list.sort((a, b) => {
      const rw = riskSortWeight(b.riskLevel) - riskSortWeight(a.riskLevel);
      if (rw !== 0) return rw;
      const pw = { urgente: 3, alta: 2, normal: 1 };
      const pp = (pw[b.priority] || 0) - (pw[a.priority] || 0);
      if (pp !== 0) return pp;
      return a.createdAt < b.createdAt ? 1 : -1;
    });
    ensureReportMessages(data);
    return list.map((r) => ({
      ...r,
      threadUnreadCount: threadUnreadCount(data, r.id, 'company')
    }));
  }

  function riskSortWeight(level) {
    const map = { critical: 4, high: 3, moderate: 2, low: 1 };
    return map[level] || 0;
  }

  const LOCAL_RISK_FACTORS = [
    { id: 'physical_integrity', label: 'Ameaça à integridade física' },
    { id: 'violence', label: 'Violência' },
    { id: 'sexual_harassment', label: 'Assédio sexual' },
    { id: 'immediate_risk', label: 'Risco imediato' },
    { id: 'leadership_involvement', label: 'Envolvimento de liderança' },
    { id: 'discrimination', label: 'Discriminação' },
    { id: 'reputational_risk', label: 'Risco reputacional' },
    { id: 'legal_risk', label: 'Risco jurídico' },
    { id: 'security_risk', label: 'Risco de segurança' },
    { id: 'recurrence', label: 'Reincidência' },
    { id: 'evidence_exists', label: 'Existência de evidências' },
    { id: 'multiple_people', label: 'Envolvimento de múltiplas pessoas' }
  ];

  function canClassifyCritical(actor) {
    return actor?.role === 'admin_empresa' || actor?.role === 'superadmin';
  }

  const LOCAL_WORKFLOW_TRANSITIONS = {
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

  const LOCAL_WORKFLOW_TO_STATUS = {
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

  const LOCAL_WORKFLOW_ORDER = [
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

  function initLocalWorkflow(report) {
    if (!report.workflowStage) {
      const map = {
        recebido: 'recebido',
        analise: 'triagem',
        apuracao: 'em_apuracao',
        acompanhamento: 'analise_parecer',
        concluido: 'concluido'
      };
      report.workflowStage = map[report.status] || 'recebido';
    }
    report.workflowStageAt = report.workflowStageAt || report.updatedAt || report.createdAt;
    report.priority = report.priority || 'normal';
    report.teamIds = report.teamIds || (report.assigneeId ? [report.assigneeId] : []);
    report.status = LOCAL_WORKFLOW_TO_STATUS[report.workflowStage] || report.status;
  }

  function localWorkflowTimeline(report, data) {
    const history = (data.reportWorkflowHistory || []).filter((h) => h.reportId === report.id);
    const milestones = [
      { id: 'recebido', label: 'Recebido', stages: ['recebido'] },
      { id: 'triagem', label: 'Triagem', stages: ['triagem', 'classificacao_risco', 'responsavel_definido'] },
      { id: 'apuracao', label: 'Apuração', stages: ['em_apuracao', 'aguardando_informacoes'] },
      { id: 'parecer', label: 'Parecer', stages: ['analise_parecer', 'medidas_adotadas'] },
      { id: 'conclusao', label: 'Conclusão', stages: ['concluido'] }
    ];
    const currentIdx = LOCAL_WORKFLOW_ORDER.indexOf(report.workflowStage);
    return milestones.map((m) => {
      const stageEntries = history.filter((h) => m.stages.includes(h.newStage));
      const lastEntry = stageEntries[stageEntries.length - 1];
      const isActive = m.stages.includes(report.workflowStage);
      const maxOrder = Math.max(...m.stages.map((s) => LOCAL_WORKFLOW_ORDER.indexOf(s)));
      const isDone = currentIdx > maxOrder || report.workflowStage === 'concluido';
      return {
        id: m.id,
        label: m.label,
        state: isActive ? 'active' : isDone ? 'done' : '',
        date: lastEntry?.createdAt || (isActive ? report.workflowStageAt : null),
        responsible: lastEntry?.changedByUserName || null,
        durationLabel: '—',
        note: lastEntry?.justification || null
      };
    });
  }

  async function getReportWorkflow(reportId, actor = {}) {
    if (useHttp()) return CSHttpApi.getReportWorkflow(reportId);
    await delay();
    const data = store();
    const report = data.reports.find((r) => r.id === reportId);
    assertReportAccess(report, actor);
    initLocalWorkflow(report);
    const currentIdx = LOCAL_WORKFLOW_ORDER.indexOf(report.workflowStage);
    const allowed = (LOCAL_WORKFLOW_TRANSITIONS[report.workflowStage] || [])
      .filter((target) => {
        if (LOCAL_WORKFLOW_ORDER.indexOf(target) >= currentIdx) return true;
        return actor.role === 'admin_empresa' || actor.role === 'superadmin';
      })
      .map((stage) => ({
        stage,
        label: CSReports.workflowStageLabel(stage),
        isBackward: LOCAL_WORKFLOW_ORDER.indexOf(stage) < currentIdx
      }));
    const history = (data.reportWorkflowHistory || [])
      .filter((h) => h.reportId === reportId)
      .sort((a, b) => (a.createdAt < b.createdAt ? -1 : 1))
      .map((h) => ({
        ...h,
        previousStageLabel: h.previousStage ? CSReports.workflowStageLabel(h.previousStage) : null,
        newStageLabel: CSReports.workflowStageLabel(h.newStage)
      }));
    return {
      ok: true,
      current: {
        stage: report.workflowStage,
        label: CSReports.workflowStageLabel(report.workflowStage),
        since: report.workflowStageAt,
        priority: report.priority,
        assigneeId: report.assigneeId
      },
      allowedTransitions: allowed,
      history
    };
  }

  async function getReportWorkflowTimeline(reportId, actor = {}) {
    if (useHttp()) return CSHttpApi.getReportWorkflowTimeline(reportId);
    await delay();
    const data = store();
    const report = data.reports.find((r) => r.id === reportId);
    assertReportAccess(report, actor);
    initLocalWorkflow(report);
    return {
      ok: true,
      timeline: localWorkflowTimeline(report, data),
      current: { stage: report.workflowStage, label: CSReports.workflowStageLabel(report.workflowStage) }
    };
  }

  async function transitionReportWorkflow(reportId, body = {}, actor = {}) {
    if (useHttp()) return CSHttpApi.transitionReportWorkflow(reportId, body);
    await delay();
    const data = store();
    const report = data.reports.find((r) => r.id === reportId);
    if (!report) throw new Error('Relato não encontrado');
    assertReportAccess(report, actor);
    initLocalWorkflow(report);
    const stage = body.stage;
    const justification = String(body.justification || '').trim();
    const allowed = LOCAL_WORKFLOW_TRANSITIONS[report.workflowStage] || [];
    if (!allowed.includes(stage)) throw new Error('Transição não permitida neste fluxo.');
    const isBackward = LOCAL_WORKFLOW_ORDER.indexOf(stage) < LOCAL_WORKFLOW_ORDER.indexOf(report.workflowStage);
    if (isBackward && actor.role !== 'admin_empresa' && actor.role !== 'superadmin') {
      throw new Error('Retrocesso exige perfil administrativo.');
    }
    if (
      ['em_apuracao', 'analise_parecer', 'medidas_adotadas', 'concluido'].includes(stage) &&
      !report.assigneeId
    ) {
      throw new Error('Defina um responsável antes de avançar para esta etapa.');
    }
    if (['responsavel_definido', 'em_apuracao'].includes(stage) && !report.riskLevel) {
      throw new Error('Classifique o risco antes de avançar para esta etapa.');
    }
    if (stage === 'concluido' && report.riskLevel === 'critical' && !report.assigneeId) {
      throw new Error('Relatos críticos exigem responsável atribuído antes da conclusão.');
    }
    if ((isBackward || stage === 'concluido') && !justification) {
      throw new Error('Justificativa obrigatória para esta transição.');
    }
    const now = new Date().toISOString();
    const previousStage = report.workflowStage;
    report.workflowStage = stage;
    report.workflowStageAt = now;
    report.status = LOCAL_WORKFLOW_TO_STATUS[stage];
    report.updatedAt = now;
    data.reportWorkflowHistory = data.reportWorkflowHistory || [];
    data.reportWorkflowHistory.push({
      id: uid('wfh'),
      reportId,
      previousStage,
      newStage: stage,
      changedByUserId: actor.id || 'system',
      changedByUserName: actor.nome || 'Sistema',
      justification,
      assigneeIdAtTransition: report.assigneeId || null,
      teamIdsAtTransition: report.teamIds || [],
      durationMs: 0,
      createdAt: now
    });
    data.reportHistory.push({
      id: uid('hist'),
      reportId,
      date: now,
      userId: actor.id || 'system',
      userName: actor.nome || 'Sistema',
      action: `Etapa: ${CSReports.workflowStageLabel(previousStage)} → ${CSReports.workflowStageLabel(stage)}`
    });
    audit(data, {
      ...CSAudit.actorFields(actor),
      action: 'transicao_workflow',
      resourceType: 'report',
      resourceId: reportId,
      companyId: report.companyId,
      protocol: report.protocol,
      previousValue: { workflowStage: previousStage },
      newValue: { workflowStage: stage }
    });
    persist(data);
    return report;
  }

  async function updateReportWorkflowMeta(reportId, patch = {}, actor = {}) {
    if (useHttp()) return CSHttpApi.updateReportWorkflowMeta(reportId, patch);
    await delay();
    const data = store();
    const report = data.reports.find((r) => r.id === reportId);
    if (!report) throw new Error('Relato não encontrado');
    assertReportAccess(report, actor);
    if (patch.priority !== undefined) {
      if (!['normal', 'alta', 'urgente'].includes(patch.priority)) throw new Error('Prioridade inválida.');
      report.priority = patch.priority;
    }
    report.updatedAt = new Date().toISOString();
    persist(data);
    return { priority: report.priority, dueAt: report.dueAt, teamIds: report.teamIds };
  }

  async function getRiskPolicy(companyId, actor = {}) {
    if (useHttp()) {
      const res = await CSHttpApi.getRiskPolicy(companyId);
      return res.policy;
    }
    await delay();
    return {
      enabled: true,
      factors: LOCAL_RISK_FACTORS,
      levels: {
        low: { label: 'Baixo' },
        moderate: { label: 'Moderado' },
        high: { label: 'Alto' },
        critical: { label: 'Crítico' }
      },
      permissions: { criticalOnlyRoles: ['admin_empresa', 'superadmin'] }
    };
  }

  async function getRiskHistory(reportId, actor = {}) {
    if (useHttp()) return CSHttpApi.getRiskHistory(reportId);
    await delay();
    const data = store();
    const report = data.reports.find((r) => r.id === reportId);
    if (!report) throw new Error('Relato não encontrado');
    assertReportAccess(report, actor);
    return (data.reportRiskHistory || [])
      .filter((h) => h.reportId === reportId)
      .sort((a, b) => (a.createdAt < b.createdAt ? 1 : -1))
      .map((h) => ({
        ...h,
        levelLabel: CSReports.riskLabel(h.level),
        previousLevelLabel: h.previousLevel ? CSReports.riskLabel(h.previousLevel) : null
      }));
  }

  async function getRiskSuggestion(reportId, actor = {}) {
    if (useHttp()) {
      const res = await CSHttpApi.getRiskSuggestion(reportId);
      return res;
    }
    await delay();
    const data = store();
    const report = data.reports.find((r) => r.id === reportId);
    if (!report) throw new Error('Relato não encontrado');
    assertReportAccess(report, actor);
    let score = 0;
    const matched = [];
    const catMap = { violencia: 35, assedio_sexual: 40, ameaca: 38, assedio_moral: 18 };
    if (catMap[report.category]) {
      score += catMap[report.category];
      if (report.category === 'violencia') matched.push('violence');
    }
    if ((report.attachments || []).length) {
      score += 12;
      matched.push('evidence_exists');
    }
    let suggestedLevel = 'low';
    if (score >= 60) suggestedLevel = 'high';
    else if (score >= 35) suggestedLevel = 'moderate';
    return {
      suggestion: {
        suggestedLevel,
        score,
        matchedFactors: matched,
        disclaimer:
          'Sugestão auxiliar — não constitui diagnóstico automático. A classificação oficial é responsabilidade do profissional autorizado.'
      },
      policy: { factors: LOCAL_RISK_FACTORS }
    };
  }

  async function classifyReportRisk(reportId, body, actor = {}) {
    if (useHttp()) return CSHttpApi.classifyReportRisk(reportId, body);
    await delay();
    const data = store();
    const report = data.reports.find((r) => r.id === reportId);
    if (!report) throw new Error('Relato não encontrado');
    assertReportAccess(report, actor);
    const level = body.level;
    if (level === 'critical' && !canClassifyCritical(actor)) {
      throw new Error('Apenas administradores podem classificar como Crítico.');
    }
    const justification = String(body.justification || '').trim();
    if (!justification) throw new Error('Justificativa obrigatória.');
    const now = new Date().toISOString();
    const previousLevel = report.riskLevel || null;
    data.reportRiskHistory = data.reportRiskHistory || [];
    const entry = {
      id: uid('rrh'),
      reportId,
      companyId: report.companyId,
      protocol: report.protocol,
      level,
      previousLevel,
      factors: body.factors || [],
      justification,
      classifiedByUserId: actor.id,
      classifiedByUserName: actor.nome || 'Usuário',
      source: previousLevel ? 'reclassification' : 'manual',
      createdAt: now
    };
    data.reportRiskHistory.push(entry);
    report.riskLevel = level;
    report.riskClassifiedAt = now;
    report.riskClassifiedByUserId = actor.id;
    report.updatedAt = now;
    audit(data, {
      ...CSAudit.actorFields(actor),
      action: previousLevel ? 'reclassificacao_risco' : 'classificacao_risco',
      resourceType: 'report_risk',
      resourceId: entry.id,
      companyId: report.companyId,
      protocol: report.protocol,
      previousValue: previousLevel ? { level: previousLevel } : undefined,
      newValue: { level, factorCount: (body.factors || []).length }
    });
    persist(data);
    return {
      riskLevel: level,
      riskLevelLabel: CSReports.riskLabel(level),
      riskClassifiedAt: now,
      historyEntry: entry
    };
  }

  const REPORTER_SESSION_KEY = 'canal_seguro_reporter_v1';

  function ensureReportMessages(data) {
    data.reportMessages = data.reportMessages || [];
    return data;
  }

  function threadUnreadCount(data, reportId, forParty) {
    return (data.reportMessages || []).filter((m) => {
      if (m.reportId !== reportId) return false;
      if (forParty === 'reporter') return m.direction === 'company' && m.status !== 'read';
      if (forParty === 'company') return m.direction === 'reporter' && m.status !== 'read';
      return false;
    }).length;
  }

  function saveReporterSession(reportId, protocol) {
    sessionStorage.setItem(REPORTER_SESSION_KEY, JSON.stringify({ reportId, protocol }));
  }

  function loadReporterSession() {
    try {
      const raw = sessionStorage.getItem(REPORTER_SESSION_KEY);
      return raw ? JSON.parse(raw) : null;
    } catch {
      return null;
    }
  }

  function publicMessageView(msg) {
    return {
      id: msg.id,
      direction: msg.direction,
      messageType: msg.messageType,
      body: msg.body,
      authorLabel: msg.authorLabel,
      status: msg.status,
      createdAt: msg.createdAt,
      readAt: msg.readAt || null,
      attachments: msg.attachments || []
    };
  }

  async function getReport(idOrProtocol, actor = null) {
    if (useHttp()) {
      try {
        return await CSHttpApi.getReport(idOrProtocol);
      } catch {
        return null;
      }
    }
    await delay();
    const data = store();
    const report =
      data.reports.find((r) => r.id === idOrProtocol || r.protocol.toUpperCase() === String(idOrProtocol).toUpperCase()) ||
      null;
    if (!report) return null;
    const a = resolveActor(actor !== null ? actor : {});
    if (a.id) assertReportAccess(report, a);
    if (typeof CSAttachments !== 'undefined') {
      return {
        ...report,
        attachments: CSAttachments.normalizeReportList(report.id, report.attachments)
      };
    }
    return report;
  }

  async function getReportPublicStatus(protocol, trackingCode) {
    if (useHttp()) {
      try {
        return await CSHttpApi.publicConsult(protocol, trackingCode);
      } catch {
        return null;
      }
    }
    await delay();
    const report = await getReport(protocol);
    if (!report) return null;

    if (report.trackingCode) {
      const normalized = CSIdentifiers.normalizeTrackingCode(trackingCode);
      if (!normalized || CSIdentifiers.normalizeTrackingCode(report.trackingCode) !== normalized) {
        return null;
      }
    }

    saveReporterSession(report.id, report.protocol);
    const data = store();
    ensureReportMessages(data);
    const unreadCount = threadUnreadCount(data, report.id, 'reporter');

    return {
      protocol: report.protocol,
      status: report.status,
      createdAt: report.createdAt,
      updatedAt: report.updatedAt,
      categoryLabel: categoryLabel(report.category),
      hasNewMessages: unreadCount > 0,
      unreadCount
    };
  }

  async function getPublicMessages() {
    if (useHttp()) return CSHttpApi.getPublicMessages();
    await delay();
    const ctx = loadReporterSession();
    if (!ctx) throw new Error('Sessão expirada');
    const data = store();
    ensureReportMessages(data);
    const messages = data.reportMessages
      .filter((m) => m.reportId === ctx.reportId)
      .sort((a, b) => (a.createdAt < b.createdAt ? -1 : 1))
      .map(publicMessageView);
    messages.forEach((m) => {
      const row = data.reportMessages.find((x) => x.id === m.id);
      if (row && row.direction === 'company' && row.status !== 'read') {
        if (row.status === 'sent') {
          row.status = 'delivered';
          row.deliveredAt = new Date().toISOString();
        }
        row.status = 'read';
        row.readAt = new Date().toISOString();
      }
    });
    persist(data);
    return { messages, unreadCount: threadUnreadCount(data, ctx.reportId, 'reporter') };
  }

  async function sendPublicMessage(text) {
    if (useHttp()) return CSHttpApi.sendPublicMessage(text);
    await delay();
    const ctx = loadReporterSession();
    if (!ctx) throw new Error('Sessão expirada');
    const body = String(text || '').trim();
    if (!body) throw new Error('Mensagem vazia.');
    const data = store();
    ensureReportMessages(data);
    const report = data.reports.find((r) => r.id === ctx.reportId);
    if (!report) throw new Error('Relato não encontrado');
    const now = new Date().toISOString();
    const msg = {
      id: uid('msg'),
      reportId: report.id,
      direction: 'reporter',
      messageType: 'reply',
      body,
      attachments: [],
      status: 'sent',
      authorLabel: 'Você',
      actorUserId: null,
      createdAt: now,
      deliveredAt: null,
      readAt: null
    };
    data.reportMessages.push(msg);
    report.updatedAt = now;
    persist(data);
    return publicMessageView(msg);
  }

  async function getReportMessages(reportId, actor = {}) {
    if (useHttp()) return CSHttpApi.getReportMessages(reportId);
    await delay();
    const data = store();
    const report = data.reports.find((r) => r.id === reportId);
    if (!report) throw new Error('Relato não encontrado');
    assertReportAccess(report, actor);
    ensureReportMessages(data);
    const now = new Date().toISOString();
    data.reportMessages.forEach((m) => {
      if (m.reportId !== reportId || m.direction !== 'reporter' || m.status === 'read') return;
      if (m.status === 'sent') {
        m.status = 'delivered';
        m.deliveredAt = now;
      }
      m.status = 'read';
      m.readAt = now;
    });
    persist(data);
    return {
      messages: data.reportMessages
        .filter((m) => m.reportId === reportId)
        .sort((a, b) => (a.createdAt < b.createdAt ? -1 : 1))
        .map(publicMessageView),
      unreadCount: threadUnreadCount(data, reportId, 'company')
    };
  }

  async function sendReportMessage(reportId, text, actor = {}, options = {}) {
    if (useHttp()) return CSHttpApi.sendReportMessage(reportId, text, options);
    await delay();
    const body = String(text || '').trim();
    if (!body) throw new Error('Mensagem vazia.');
    const data = store();
    const report = data.reports.find((r) => r.id === reportId);
    if (!report) throw new Error('Relato não encontrado');
    assertReportAccess(report, actor);
    ensureReportMessages(data);
    const now = new Date().toISOString();
    const msg = {
      id: uid('msg'),
      reportId: report.id,
      direction: 'company',
      messageType: options.messageType === 'info_request' ? 'info_request' : 'message',
      body,
      attachments: [],
      status: 'sent',
      authorLabel: 'Equipe responsável',
      actorUserId: actor.id || null,
      createdAt: now,
      deliveredAt: null,
      readAt: null
    };
    data.reportMessages.push(msg);
    report.updatedAt = now;
    persist(data);
    return publicMessageView(msg);
  }

  function categoryLabel(id) {
    const c = (store().categories || []).find((x) => x.id === id);
    return c ? c.label : id;
  }

  function statusLabel(id) {
    const s = (store().statuses || []).find((x) => x.id === id);
    return s ? s.label : id;
  }

  function pickReportInput(payload) {
    const isAnonymous = Boolean(payload.isAnonymous);
    let reporter = null;
    if (!isAnonymous && payload.reporter && typeof payload.reporter === 'object') {
      reporter = {
        nome: String(payload.reporter.nome || '').trim(),
        email: String(payload.reporter.email || '').trim(),
        telefone: String(payload.reporter.telefone || '').trim(),
        empresa: String(payload.reporter.empresa || '').trim(),
        setor: String(payload.reporter.setor || '').trim(),
        cargo: String(payload.reporter.cargo || '').trim()
      };
    }
    const attachments =
      typeof CSAttachments !== 'undefined'
        ? CSAttachments.sanitizeList(payload.attachments)
        : Array.isArray(payload.attachments)
          ? payload.attachments.map((a) => ({
              name: String(a?.name || ''),
              size: Number(a?.size) || 0
            }))
          : [];

    return {
      companyId: payload.companyId,
      category: payload.category,
      isAnonymous,
      dateApprox: payload.dateApprox || '',
      timeApprox: payload.timeApprox || '',
      location: String(payload.location || '').trim(),
      involved: String(payload.involved || '').trim(),
      description: String(payload.description || '').trim(),
      witnesses: String(payload.witnesses || '').trim(),
      attachments,
      wantUpdates: Boolean(payload.wantUpdates),
      contactEmail: payload.wantUpdates ? payload.contactEmail ?? null : null,
      contactPhone: payload.wantUpdates ? payload.contactPhone ?? null : null,
      sector: String(payload.sector || '').trim(),
      reporter
    };
  }

  async function createReport(payload) {
    if (useHttp()) return CSHttpApi.createReport(payload);
    await delay(200);

    const authEmployeeId = payload.employeeId;
    if (!authEmployeeId) {
      throw new Error('Acesso não autorizado. Valide seu CPF antes de enviar o relato.');
    }
    const emp = (store().employees || []).find((e) => e.id === authEmployeeId);
    if (!emp || emp.companyId !== payload.companyId || emp.status !== 'ativo') {
      throw new Error('Colaborador não autorizado para registrar relato nesta empresa.');
    }

    const input = pickReportInput(payload);
    const data = store();
    const companyCfg = companySettingsSync(data, payload.companyId);
    const platform = platformSettingsSync(data);
    const existingProtocols = new Set(
      (data.reports || [])
        .filter((r) => r.companyId === payload.companyId)
        .map((r) => r.protocol.toUpperCase())
    );
    const existingTrackingCodes = new Set(
      (data.reports || [])
        .filter((r) => r.companyId === payload.companyId && r.trackingCode)
        .map((r) => CSIdentifiers.normalizeTrackingCode(r.trackingCode))
    );
    const protocol = CSIdentifiers.generateProtocol({
      prefix: companyCfg.protocolPrefix || platform.defaultProtocolPrefix || 'CS',
      existingProtocols
    });
    companyCfg.protocolCounter = (companyCfg.protocolCounter || 100) + 1;
    const trackingCode = CSIdentifiers.generateTrackingCode({ existingTrackingCodes });
    const now = new Date().toISOString();
    const reportId = CSIdentifiers.generateReportId();
    const report = {
      id: reportId,
      protocol,
      trackingCode,
      status: 'recebido',
      workflowStage: 'recebido',
      workflowStageAt: now,
      priority: 'normal',
      teamIds: [],
      dueAt: null,
      assigneeId: null,
      createdAt: now,
      updatedAt: now,
      ...input,
      attachments:
        typeof CSAttachments !== 'undefined'
          ? CSAttachments.finalizeForReport(reportId, input.attachments)
          : input.attachments
    };
    if (!report.isAnonymous) {
      report.employeeId = authEmployeeId;
    }
    // reload store before persist
    const fresh = store();
    fresh.reports.push(report);
    fresh.reportHistory.push({
      id: uid('hist'),
      reportId: report.id,
      date: report.createdAt,
      userId: 'system',
      userName: 'Sistema',
      action: 'Relato recebido e registrado.'
    });
    fresh.reportWorkflowHistory = fresh.reportWorkflowHistory || [];
    fresh.reportWorkflowHistory.push({
      id: uid('wfh'),
      reportId: report.id,
      previousStage: null,
      newStage: 'recebido',
      changedByUserId: 'system',
      changedByUserName: 'Sistema',
      justification: 'Registro inicial.',
      assigneeIdAtTransition: null,
      teamIdsAtTransition: [],
      durationMs: 0,
      createdAt: now
    });
    fresh.notifications = fresh.notifications || [];
    fresh.notifications.unshift({
      id: uid('ntf'),
      type: 'report_new',
      title: 'Novo relato recebido',
      message: `Protocolo ${protocol} aguarda triagem.`,
      companyId: report.companyId,
      reportId: report.id,
      protocol: report.protocol,
      read: false,
      createdAt: report.createdAt
    });
    audit(fresh, {
      userId: 'system',
      userName: 'Sistema',
      action: 'criacao_relato',
      resourceType: 'report',
      resourceId: report.id,
      companyId: report.companyId,
      protocol: report.protocol,
      newValue: {
        status: report.status,
        isAnonymous: report.isAnonymous,
        attachmentCount: (report.attachments || []).length
      }
    });
    (report.attachments || []).forEach((att) => {
      audit(fresh, {
        userId: 'system',
        userName: 'Sistema',
        action: 'upload_anexo',
        resourceType: 'attachment',
        resourceId: att.id,
        companyId: report.companyId,
        protocol: report.protocol,
        newValue: { name: att.name, size: att.size, mimeType: att.mimeType, status: att.status }
      });
    });
    persist(fresh);
    return report;
  }

  async function updateReportStatus(reportId, status, actor = {}, note = '') {
    if (useHttp()) return CSHttpApi.updateReportStatus(reportId, status, actor, note);
    await delay();
    const data = store();
    const report = data.reports.find((r) => r.id === reportId);
    if (!report) throw new Error('Relato não encontrado');
    assertReportAccess(report, actor);
    if (status === 'concluido' && report.riskLevel === 'critical' && !report.assigneeId) {
      throw new Error(
        'Relatos classificados como Crítico exigem responsável atribuído antes da conclusão.'
      );
    }
    const label = statusLabel(status);
    const previousStatus = report.status;
    report.status = status;
    report.updatedAt = new Date().toISOString();
    data.reportHistory.push({
      id: uid('hist'),
      reportId,
      date: report.updatedAt,
      userId: actor.id || 'system',
      userName: actor.nome || 'Sistema',
      action: note || `Alterou status para "${label}".`
    });
    audit(data, {
      ...CSAudit.actorFields(actor),
      action: 'alteracao_status',
      resourceType: 'report',
      resourceId: reportId,
      companyId: report.companyId,
      protocol: report.protocol,
      previousValue: { status: previousStatus },
      newValue: { status }
    });
    data.notifications = data.notifications || [];
    data.notifications.unshift({
      id: uid('ntf'),
      type: status === 'concluido' ? 'report_completed' : 'report_status',
      title: status === 'concluido' ? 'Relato concluído' : 'Relato atualizado',
      message: `Protocolo ${report.protocol} — status: ${label}.`,
      companyId: report.companyId,
      reportId: report.id,
      protocol: report.protocol,
      read: false,
      createdAt: report.updatedAt
    });
    persist(data);
    return report;
  }

  async function addReportObservation(reportId, text, actor = {}) {
    if (useHttp()) return CSHttpApi.addReportObservation(reportId, text);
    await delay();
    const data = store();
    const report = data.reports.find((r) => r.id === reportId);
    if (!report) throw new Error('Relato não encontrado');
    assertReportAccess(report, actor);
    const now = new Date().toISOString();
    report.updatedAt = now;
    data.reportHistory.push({
      id: uid('hist'),
      reportId,
      date: now,
      userId: actor.id || 'system',
      userName: actor.nome || 'Sistema',
      action: `Observação: ${text}`
    });
    audit(data, {
      ...CSAudit.actorFields(actor),
      action: 'observacao_relato',
      resourceType: 'report',
      resourceId: reportId,
      companyId: report.companyId,
      protocol: report.protocol
    });
    persist(data);
    return report;
  }

  const MEASURE_TYPE_LABELS = {
    acao_executada: 'Ação executada',
    medida_adotada: 'Medida adotada'
  };

  function rebuildLocalMeasuresRollup(report) {
    const log = Array.isArray(report.measuresLog) ? report.measuresLog : [];
    if (!log.length) return;
    report.measuresAdopted = log
      .map((item) => {
        const label = MEASURE_TYPE_LABELS[item.type] || 'Registro';
        const when = item.executedAt ? String(item.executedAt).slice(0, 10) : '';
        const who = item.userName ? ` — ${item.userName}` : '';
        const prefix = when ? `[${when}] ${label}` : label;
        return `${prefix}${who}: ${item.text}`;
      })
      .join('\n\n')
      .slice(0, 8000);
  }

  async function addReportMeasure(reportId, payload = {}, actor = {}) {
    if (useHttp()) return CSHttpApi.addReportMeasure(reportId, payload);
    await delay();
    const data = store();
    const report = data.reports.find((r) => r.id === reportId);
    if (!report) throw new Error('Relato não encontrado');
    assertReportAccess(report, actor);
    const text = String(payload.text || '').trim().slice(0, 4000);
    if (!text) throw new Error('Descreva o que foi executado ou a medida adotada.');
    const type = MEASURE_TYPE_LABELS[payload.type] ? payload.type : 'acao_executada';
    let executedAt = payload.executedAt ? String(payload.executedAt).trim() : '';
    if (executedAt) {
      const d = new Date(executedAt);
      if (Number.isNaN(d.getTime())) throw new Error('Data de execução inválida.');
      executedAt = d.toISOString();
    } else {
      executedAt = new Date().toISOString();
    }
    const now = new Date().toISOString();
    if (!Array.isArray(report.measuresLog)) report.measuresLog = [];
    const entry = {
      id: uid('msu'),
      type,
      text,
      executedAt,
      createdAt: now,
      userId: actor.id || 'system',
      userName: actor.nome || actor.email || 'Sistema'
    };
    report.measuresLog.push(entry);
    report.updatedAt = now;
    rebuildLocalMeasuresRollup(report);
    data.reportHistory.push({
      id: uid('hist'),
      reportId,
      date: now,
      userId: actor.id || 'system',
      userName: actor.nome || 'Sistema',
      action: `${MEASURE_TYPE_LABELS[type]}: ${text}`
    });
    audit(data, {
      ...CSAudit.actorFields(actor),
      action: 'medida_acao_relato',
      resourceType: 'report',
      resourceId: reportId,
      companyId: report.companyId,
      protocol: report.protocol,
      newValue: { type, measureId: entry.id }
    });
    persist(data);
    return { report, entry };
  }

  async function assignReport(reportId, assigneeId, actor = {}) {
    if (useHttp()) return CSHttpApi.assignReport(reportId, assigneeId);
    await delay();
    const data = store();
    const report = data.reports.find((r) => r.id === reportId);
    if (!report) throw new Error('Relato não encontrado');
    const a = resolveActor(actor);
    if (a.role === 'apurador') throw new Error('Sem permissão para encaminhar relatos.');
    assertReportAccess(report, actor);
    const user = data.users.find((u) => u.id === assigneeId);
    if (user && user.companyId && user.companyId !== report.companyId) {
      throw new Error('Responsável não pertence à empresa deste relato.');
    }
    const previousAssigneeId = report.assigneeId;
    report.assigneeId = assigneeId || null;
    report.teamIds = assigneeId ? [assigneeId] : [];
    report.updatedAt = new Date().toISOString();
    data.reportHistory.push({
      id: uid('hist'),
      reportId,
      date: report.updatedAt,
      userId: actor.id || 'system',
      userName: actor.nome || 'Sistema',
      action: `Encaminhou o relato para ${user ? user.nome : assigneeId}.`
    });
    audit(data, {
      ...CSAudit.actorFields(actor),
      action: 'atribuicao_relato',
      resourceType: 'report',
      resourceId: reportId,
      companyId: report.companyId,
      protocol: report.protocol,
      previousValue: { assigneeId: previousAssigneeId },
      newValue: { assigneeId, assigneeName: user ? user.nome : assigneeId, teamIds: report.teamIds }
    });
    if (assigneeId && assigneeId !== previousAssigneeId) {
      data.notifications = data.notifications || [];
      const assigneeName = user ? user.nome : 'apurador';
      data.notifications.unshift({
        id: uid('ntf'),
        type: 'report_assigned',
        title: 'Relato encaminhado',
        message: `Protocolo ${report.protocol} encaminhado para ${assigneeName}.`,
        companyId: report.companyId,
        reportId: report.id,
        protocol: report.protocol,
        read: false,
        createdAt: report.updatedAt
      });
      data.notifications.unshift({
        id: uid('ntf'),
        type: 'report_assigned',
        title: 'Relato encaminhado a você',
        message: `Protocolo ${report.protocol} foi encaminhado para sua apuração.`,
        companyId: report.companyId,
        reportId: report.id,
        protocol: report.protocol,
        userId: assigneeId,
        assigneeId,
        read: false,
        createdAt: report.updatedAt
      });
    }
    persist(data);
    return report;
  }

  async function createReportHistory(reportId, action, actor = {}) {
    await delay();
    const data = store();
    const report = data.reports.find((r) => r.id === reportId);
    assertReportAccess(report, actor);
    const entry = {
      id: uid('hist'),
      reportId,
      date: new Date().toISOString(),
      userId: actor.id || 'system',
      userName: actor.nome || 'Sistema',
      action
    };
    data.reportHistory.push(entry);
    persist(data);
    return entry;
  }

  async function getReportHistory(reportId, actor = {}) {
    if (useHttp()) return CSHttpApi.getReportHistory(reportId);
    await delay();
    const report = store().reports.find((r) => r.id === reportId);
    assertReportAccess(report, actor);
    return store()
      .reportHistory.filter((h) => h.reportId === reportId)
      .sort((a, b) => (a.date < b.date ? 1 : -1));
  }

  /* ---------- Report attachments (protótipo → storage privado futuro) ---------- */
  function assertReportAttachmentAccess(report, actor = {}) {
    assertReportAccess(report, actor);
  }

  function findAttachmentInStore(data, attachmentId) {
    for (const report of data.reports || []) {
      const att = (report.attachments || []).find((a) => a.id === attachmentId);
      if (att) return { report, attachment: att };
    }
    return { report: null, attachment: null };
  }

  async function getReportAttachments(reportId, actor = {}) {
    await delay();
    const report = (store().reports || []).find((r) => r.id === reportId);
    assertReportAttachmentAccess(report, actor);
    if (typeof CSAttachments === 'undefined') return report.attachments || [];
    return CSAttachments.normalizeReportList(report.id, report.attachments);
  }

  /**
   * Download autenticado. Em modo HTTP: GET /reports/:id/attachments/:attId/download.
   * Protótipo local: registra auditoria e informa indisponibilidade.
   */
  async function requestAttachmentDownload(attachmentId, actor = {}, reportId = null) {
    if (useHttp()) {
      let rid = reportId;
      if (!rid) {
        const found = findAttachmentInStore(store(), attachmentId);
        rid = found.report?.id;
      }
      if (!rid) throw new Error('Informe o relato do anexo.');
      const { blob, filename } = await CSHttpApi.downloadAttachment(rid, attachmentId);
      return {
        ok: true,
        message: 'Download autorizado.',
        blob,
        filename,
        attachmentId
      };
    }

    await delay(150);
    const data = store();
    const { report, attachment } = findAttachmentInStore(data, attachmentId);
    if (!report || !attachment) throw new Error('Anexo não encontrado.');
    assertReportAttachmentAccess(report, actor);

    if (typeof CSInfraLog !== 'undefined') {
      CSInfraLog.security('download_anexo_solicitado', {
        severity: 'info',
        outcome: 'success',
        actor,
        context: { attachmentId, reportId: report.id, companyId: report.companyId }
      });
    }

    audit(data, {
      ...CSAudit.actorFields(actor),
      action: 'download_anexo',
      resourceType: 'attachment',
      resourceId: attachmentId,
      companyId: report.companyId,
      protocol: report.protocol,
      newValue: { ok: false, reason: 'prototype_no_storage', name: attachment.name }
    });
    persist(data);

    return {
      ok: false,
      message:
        'Download indisponível no protótipo. Em produção, o servidor validará permissões e entregará o arquivo via rota autenticada — sem link público permanente.',
      attachment:
        typeof CSAttachments !== 'undefined'
          ? CSAttachments.normalizeStored(attachment, report.id)
          : attachment
    };
  }

  async function getStorageUsage(companyId = null, actor = null) {
    if (useHttp()) return CSHttpApi.getStorageUsage(companyId);
    await delay(50);
    const a = resolveActor(actor);
    const data = store();
    const defaultLimit = 1073741824;
    function view(c) {
      const limit = typeof c.storageLimitBytes === 'number' ? c.storageLimitBytes : defaultLimit;
      let used = typeof c.storageUsedBytes === 'number' ? c.storageUsedBytes : null;
      if (used === null) {
        used = 0;
        (data.reports || [])
          .filter((r) => r.companyId === c.id)
          .forEach((r) => {
            (r.attachments || []).forEach((att) => {
              if (att.status === 'stored') used += Number(att.size) || 0;
            });
          });
      }
      const overLimit = used > limit;
      return {
        companyId: c.id,
        nomeFantasia: c.nomeFantasia || c.razaoSocial || c.id,
        storageLimitBytes: limit,
        storageUsedBytes: used,
        storageAvailableBytes: Math.max(0, limit - used),
        storagePercent: limit > 0 ? Math.round((used / limit) * 1000) / 10 : 0,
        overLimit
      };
    }
    if (isSuperadmin(a)) {
      if (companyId) {
        const c = (data.companies || []).find((x) => x.id === companyId);
        if (!c) throw new Error('Empresa não encontrada.');
        return view(c);
      }
      return { companies: (data.companies || []).map(view) };
    }
    const tid = a.companyId;
    if (!tid) throw new Error('Sem empresa vinculada.');
    if (companyId && companyId !== tid) throw new Error('Empresa não encontrada.');
    const c = (data.companies || []).find((x) => x.id === tid);
    if (!c) throw new Error('Empresa não encontrada.');
    return view(c);
  }

  async function updateStorageLimit(companyId, storageLimitBytes, actor = null) {
    if (useHttp()) return CSHttpApi.updateStorageLimit(companyId, storageLimitBytes);
    await delay(50);
    const a = assertSuperadmin(resolveActor(actor));
    const data = store();
    const idx = data.companies.findIndex((c) => c.id === companyId);
    if (idx < 0) throw new Error('Empresa não encontrada.');
    const n = Number(storageLimitBytes);
    const min = (typeof CSAttachments !== 'undefined' && CSAttachments.LIMITS?.MIN_COMPANY_QUOTA_BYTES) || 10 * 1024 * 1024;
    const max = (typeof CSAttachments !== 'undefined' && CSAttachments.LIMITS?.MAX_COMPANY_QUOTA_BYTES) || 100 * 1024 * 1024 * 1024;
    if (!Number.isFinite(n)) throw new Error('Quota inválida.');
    const nextLimit = Math.floor(n);
    if (nextLimit < min || nextLimit > max) {
      throw new Error(`Quota deve estar entre ${min} e ${max} bytes.`);
    }
    const previousLimit = data.companies[idx].storageLimitBytes;
    data.companies[idx].storageLimitBytes = nextLimit;
    if (typeof data.companies[idx].storageUsedBytes !== 'number') {
      data.companies[idx].storageUsedBytes = 0;
    }
    const used = Number(data.companies[idx].storageUsedBytes) || 0;
    audit(data, {
      ...auditActor({}, a),
      action: 'alteracao_quota_armazenamento',
      resourceType: 'company',
      resourceId: companyId,
      companyId,
      previousValue: { storageLimitBytes: previousLimit },
      newValue: {
        storageLimitBytes: nextLimit,
        storageUsedBytes: used,
        overLimit: used > nextLimit
      }
    });
    persist(data);
    return getStorageUsage(companyId);
  }

  function formatStoragePriceLabel(amount) {
    if (amount == null || !Number.isFinite(Number(amount))) return 'Sob consulta';
    const n = Math.round(Number(amount) * 100) / 100;
    const formatted = n.toLocaleString('pt-BR', {
      minimumFractionDigits: Number.isInteger(n) ? 0 : 2,
      maximumFractionDigits: 2
    });
    return `R$ ${formatted}`;
  }

  function getDefaultStoragePricing() {
    return {
      baseAmount: 149,
      upgradePercent: 20,
      corporativoConsult: true,
      planAmounts: {},
      planDetails: {}
    };
  }

  function sanitizeLocalPlanDetails(rawDetails) {
    const src = rawDetails && typeof rawDetails === 'object' ? rawDetails : {};
    const out = {};
    for (const id of Object.keys(src)) {
      const raw = src[id];
      if (!raw || typeof raw !== 'object') continue;
      const detail = {};
      if (typeof raw.description === 'string' && raw.description.trim()) {
        detail.description = raw.description.trim().slice(0, 280);
      }
      if (typeof raw.usersLabel === 'string' && raw.usersLabel.trim()) {
        detail.usersLabel = raw.usersLabel.trim().slice(0, 80);
      }
      if (typeof raw.retentionLabel === 'string' && raw.retentionLabel.trim()) {
        detail.retentionLabel = raw.retentionLabel.trim().slice(0, 120);
      }
      if (typeof raw.billingNote === 'string' && raw.billingNote.trim()) {
        detail.billingNote = raw.billingNote.trim().slice(0, 120);
      }
      if (Array.isArray(raw.advantages)) {
        const adv = raw.advantages
          .map((x) => String(x == null ? '' : x).trim())
          .filter(Boolean)
          .slice(0, 20);
        if (adv.length) detail.advantages = adv;
      }
      if (typeof raw.consultPricing === 'boolean') detail.consultPricing = raw.consultPricing;
      if (typeof raw.hidePriceForApurador === 'boolean') {
        detail.hidePriceForApurador = raw.hidePriceForApurador;
      }
      if (typeof raw.featured === 'boolean') detail.featured = raw.featured;
      if (raw.priceAmount === null || raw.priceAmount === '') {
        detail.priceAmount = null;
      } else if (raw.priceAmount != null) {
        const n = Number(raw.priceAmount);
        if (Number.isFinite(n) && n >= 0) detail.priceAmount = Math.round(n * 100) / 100;
      }
      if (Object.keys(detail).length) out[id] = detail;
    }
    return out;
  }

  const LOCAL_GiB = 1024 * 1024 * 1024;

  function formatLocalStorageLabel(bytes) {
    const n = Number(bytes) || 0;
    const gib = n / LOCAL_GiB;
    if (gib >= 1) {
      const rounded = Math.round(gib * 10) / 10;
      return `${rounded} GB`;
    }
    return `${Math.round(n / (1024 * 1024))} MB`;
  }

  function formatLocalPriceLabel(amount) {
    if (amount == null || !Number.isFinite(Number(amount))) return 'Sob consulta';
    const n = Math.round(Number(amount) * 100) / 100;
    return `R$ ${n.toLocaleString('pt-BR', {
      minimumFractionDigits: Number.isInteger(n) ? 0 : 2,
      maximumFractionDigits: 2
    })}`;
  }

  function defaultLocalPlanAdvantages(plan) {
    return [
      `${plan.storageLabel || formatLocalStorageLabel(plan.storageLimitBytes)} de armazenamento`,
      plan.usersLabel,
      plan.retentionLabel
    ].filter(Boolean);
  }

  function recomputeLocalBarPercents(plans) {
    const max = Math.max(...plans.map((p) => Number(p.storageLimitBytes) || 0), 1);
    return plans.map((p, idx) => ({
      ...p,
      tierIndex: typeof p.tierIndex === 'number' ? p.tierIndex : idx,
      barPercent: Math.min(100, Math.max(1, Math.round(((Number(p.storageLimitBytes) || 0) / max) * 100)))
    }));
  }

  function cloneDefaultLocalPlans() {
    const base = (typeof CSAttachments !== 'undefined' && CSAttachments.STORAGE_PLANS) || [];
    return base.map((p) => ({
      ...p,
      advantages: Array.isArray(p.advantages) && p.advantages.length ? [...p.advantages] : defaultLocalPlanAdvantages(p)
    }));
  }

  function ensureLocalStoragePlansCatalog(data) {
    const platform = platformSettingsSync(data);
    if (!Array.isArray(platform.storagePlans) || !platform.storagePlans.length) {
      platform.storagePlans = cloneDefaultLocalPlans();
    }
    platform.storagePlans = recomputeLocalBarPercents(
      platform.storagePlans
        .filter((p) => p && p.id && p.active !== false)
        .map((p, idx) => ({
          ...p,
          storageLabel: p.storageLabel || formatLocalStorageLabel(p.storageLimitBytes),
          tierIndex: typeof p.tierIndex === 'number' ? p.tierIndex : idx,
          advantages:
            Array.isArray(p.advantages) && p.advantages.length
              ? p.advantages
              : defaultLocalPlanAdvantages(p)
        }))
        .sort((a, b) => (Number(a.storageLimitBytes) || 0) - (Number(b.storageLimitBytes) || 0))
    );
    data.platformSettings = platform;
    return platform.storagePlans;
  }

  function getLocalStoragePlansCatalog(data) {
    return ensureLocalStoragePlansCatalog(data).map((p) => ({ ...p }));
  }

  function sanitizeLocalPlanDefinition(raw, { existingId = null } = {}) {
    const src = raw && typeof raw === 'object' ? raw : {};
    const name = String(src.name || '').trim().slice(0, 80);
    if (!name) throw new Error('Nome do plano é obrigatório.');

    let storageLimitBytes = Number(src.storageLimitBytes);
    if (src.storageGiB != null && src.storageGiB !== '') {
      const fromGib = Number(src.storageGiB) * LOCAL_GiB;
      if (Number.isFinite(fromGib) && fromGib > 0) storageLimitBytes = fromGib;
    }
    if (!Number.isFinite(storageLimitBytes) || storageLimitBytes <= 0) {
      throw new Error('Informe o limite de armazenamento do plano.');
    }
    storageLimitBytes = Math.floor(storageLimitBytes);

    let id = existingId || String(src.id || '').trim();
    if (!id) {
      id = name
        .normalize('NFD')
        .replace(/[\u0300-\u036f]/g, '')
        .toLowerCase()
        .replace(/[^a-z0-9]+/g, '_')
        .replace(/^_+|_+$/g, '')
        .slice(0, 40) || 'plano';
    }
    id = id.replace(/[^a-zA-Z0-9_-]/g, '_').slice(0, 48);

    const usersLabel = String(src.usersLabel || 'Usuários conforme contrato').trim().slice(0, 80);
    const retentionLabel = String(
      src.retentionLabel || 'Retenção de evidências por 1 ano'
    )
      .trim()
      .slice(0, 120);
    const description = String(src.description || '').trim().slice(0, 280);
    const billingNote = String(src.billingNote || 'Contratação anual').trim().slice(0, 120);
    const ctaLabel = String(src.ctaLabel || 'Contratar').trim().slice(0, 60);
    const featured = Boolean(src.featured);
    const hidePriceOnPublic = Boolean(src.hidePriceOnPublic);
    const consultPricing = Boolean(src.consultPricing) || src.priceAmount === null || src.priceAmount === '';
    let priceAmount = null;
    if (!consultPricing && src.priceAmount != null && src.priceAmount !== '') {
      const n = Number(src.priceAmount);
      if (!Number.isFinite(n) || n < 0) throw new Error('Preço de referência inválido.');
      priceAmount = Math.round(n * 100) / 100;
    }
    const advantages = Array.isArray(src.advantages)
      ? src.advantages
          .map((x) => String(x == null ? '' : x).trim())
          .filter(Boolean)
          .slice(0, 20)
      : null;

    return {
      id,
      name,
      storageLimitBytes,
      storageLabel: formatLocalStorageLabel(storageLimitBytes),
      barPercent: 0,
      priceLabel: consultPricing ? 'Sob consulta' : formatLocalPriceLabel(priceAmount),
      priceSuffix: consultPricing ? '' : '/mês',
      priceAmount: consultPricing ? null : priceAmount,
      billingNote,
      usersLabel,
      retentionLabel,
      description: description || `Plano ${name}.`,
      featured,
      ctaLabel: consultPricing ? ctaLabel || 'Falar com especialista' : ctaLabel,
      consultPricing,
      hidePriceOnPublic,
      advantages:
        advantages && advantages.length
          ? advantages
          : defaultLocalPlanAdvantages({
              storageLabel: formatLocalStorageLabel(storageLimitBytes),
              usersLabel,
              retentionLabel
            }),
      tierIndex:
        Number.isFinite(Number(src.tierIndex)) && Number(src.tierIndex) >= 0
          ? Math.floor(Number(src.tierIndex))
          : null,
      active: src.active === false ? false : true
    };
  }

  function resolveLocalStoragePricing(data, companyId) {
    const platform = platformSettingsSync(data);
    const defaults = {
      defaultBaseAmount: platform.storagePricing?.defaultBaseAmount ?? 149,
      defaultUpgradePercent: platform.storagePricing?.defaultUpgradePercent ?? 20,
      defaultCorporativoConsult: platform.storagePricing?.defaultCorporativoConsult !== false
    };
    const cfg = companyId ? companySettingsSync(data, companyId)?.storagePricing : null;
    const src = cfg && typeof cfg === 'object' ? cfg : {};
    const baseAmount = Number(src.baseAmount);
    const upgradePercent = Number(src.upgradePercent);
    const planAmounts =
      src.planAmounts && typeof src.planAmounts === 'object' ? { ...src.planAmounts } : {};
    return {
      baseAmount:
        Number.isFinite(baseAmount) && baseAmount >= 0
          ? Math.round(baseAmount * 100) / 100
          : defaults.defaultBaseAmount,
      upgradePercent:
        Number.isFinite(upgradePercent) && upgradePercent >= 0
          ? Math.round(upgradePercent * 100) / 100
          : defaults.defaultUpgradePercent,
      corporativoConsult:
        typeof src.corporativoConsult === 'boolean'
          ? src.corporativoConsult
          : defaults.defaultCorporativoConsult,
      planAmounts,
      planDetails: sanitizeLocalPlanDetails(src.planDetails)
    };
  }

  function applyLocalPlanPricing(plans, pricing, platformCatalog = {}) {
    const catalog = Array.isArray(plans) ? plans : [];
    return catalog.map((p, idx) => {
      const tierIndex = typeof p.tierIndex === 'number' ? p.tierIndex : idx;
      const companyDetail = pricing.planDetails?.[p.id] || {};
      const platformDetail = platformCatalog?.[p.id] || {};
      let amount = null;
      if (companyDetail.consultPricing === true) {
        amount = null;
      } else if (Object.prototype.hasOwnProperty.call(companyDetail, 'priceAmount')) {
        if (companyDetail.priceAmount === null || companyDetail.priceAmount === '') amount = null;
        else {
          const n = Number(companyDetail.priceAmount);
          amount = Number.isFinite(n) && n >= 0 ? Math.round(n * 100) / 100 : null;
        }
      } else if (Object.prototype.hasOwnProperty.call(pricing.planAmounts || {}, p.id)) {
        const o = pricing.planAmounts[p.id];
        amount = o === null || o === '' ? null : Number(o);
      } else if (p.id === 'corporativo' && pricing.corporativoConsult) {
        amount = null;
      } else {
        amount =
          Math.round(
            Number(pricing.baseAmount) * Math.pow(1 + Number(pricing.upgradePercent) / 100, tierIndex) * 100
          ) / 100;
      }
      const consult = amount == null || !Number.isFinite(amount);
      const usersLabel = companyDetail.usersLabel || platformDetail.usersLabel || p.usersLabel;
      const retentionLabel =
        companyDetail.retentionLabel || platformDetail.retentionLabel || p.retentionLabel;
      const description = companyDetail.description || platformDetail.description || p.description;
      const billingNote = companyDetail.billingNote || platformDetail.billingNote || p.billingNote;
      const advantages =
        (companyDetail.advantages && companyDetail.advantages.length
          ? companyDetail.advantages
          : null) ||
        (platformDetail.advantages && platformDetail.advantages.length
          ? platformDetail.advantages
          : null) || [
          `${p.storageLabel || ''} de armazenamento`.trim(),
          usersLabel,
          retentionLabel
        ].filter(Boolean);
      const hidePriceForApurador = companyDetail.hidePriceForApurador !== false;
      const featured =
        typeof companyDetail.featured === 'boolean' ? companyDetail.featured : Boolean(p.featured);
      return {
        ...p,
        tierIndex,
        description,
        usersLabel,
        retentionLabel,
        billingNote,
        advantages: [...advantages],
        priceAmount: consult ? null : amount,
        priceLabel: consult ? 'Sob consulta' : formatStoragePriceLabel(amount),
        priceSuffix: consult ? '' : '/mês',
        upgradePercent: pricing.upgradePercent,
        pricingMode: 'company',
        consultPricing: consult,
        hidePriceForApurador,
        featured,
        ctaLabel: consult ? p.ctaLabel || 'Falar com especialista' : p.ctaLabel || 'Contratar'
      };
    });
  }

  async function getStoragePlanCatalog(actor = null) {
    if (useHttp()) return CSHttpApi.getStoragePlanCatalog();
    await delay(30);
    assertSuperadmin(resolveActor(actor));
    const data = store();
    const plans = getLocalStoragePlansCatalog(data);
    persist(data);
    return { plans };
  }

  async function createStoragePlan(payload = {}, actor = null) {
    if (useHttp()) return CSHttpApi.createStoragePlan(payload);
    await delay(40);
    const a = assertSuperadmin(resolveActor(actor));
    const data = store();
    const list = ensureLocalStoragePlansCatalog(data);
    let plan = sanitizeLocalPlanDefinition(payload);
    let id = plan.id;
    let n = 2;
    while (list.some((p) => p.id === id)) {
      id = `${plan.id}_${n}`;
      n += 1;
    }
    plan = { ...plan, id };
    if (plan.tierIndex == null) plan.tierIndex = list.length;
    if (plan.featured) list.forEach((p) => { p.featured = false; });
    list.push(plan);
    data.platformSettings.storagePlans = recomputeLocalBarPercents(list);
    audit(data, {
      ...auditActor({}, a),
      action: 'criacao_plano_armazenamento',
      resourceType: 'storage_plan',
      resourceId: plan.id,
      companyId: null,
      newValue: { id: plan.id, name: plan.name, storageLimitBytes: plan.storageLimitBytes }
    });
    persist(data);
    return { plan, plans: getLocalStoragePlansCatalog(data) };
  }

  async function updateStoragePlan(planId, payload = {}, actor = null) {
    if (useHttp()) return CSHttpApi.updateStoragePlan(planId, payload);
    await delay(40);
    const a = assertSuperadmin(resolveActor(actor));
    if (!planId) throw new Error('Informe o plano.');
    const data = store();
    const list = ensureLocalStoragePlansCatalog(data);
    const idx = list.findIndex((p) => p.id === planId);
    if (idx < 0) throw new Error('Plano não encontrado.');
    const plan = sanitizeLocalPlanDefinition(
      { ...list[idx], ...payload, id: planId },
      { existingId: planId }
    );
    if (plan.featured) {
      list.forEach((p, i) => {
        if (i !== idx) p.featured = false;
      });
    }
    const previous = { ...list[idx] };
    list[idx] = plan;
    data.platformSettings.storagePlans = recomputeLocalBarPercents(list);
    audit(data, {
      ...auditActor({}, a),
      action: 'edicao_plano_armazenamento',
      resourceType: 'storage_plan',
      resourceId: planId,
      companyId: null,
      previousValue: { name: previous.name, storageLimitBytes: previous.storageLimitBytes },
      newValue: { name: plan.name, storageLimitBytes: plan.storageLimitBytes, hidePriceOnPublic: plan.hidePriceOnPublic }
    });
    persist(data);
    return { plan, plans: getLocalStoragePlansCatalog(data) };
  }

  async function deleteStoragePlan(planId, actor = null) {
    if (useHttp()) return CSHttpApi.deleteStoragePlan(planId);
    await delay(40);
    const a = assertSuperadmin(resolveActor(actor));
    if (!planId) throw new Error('Informe o plano.');
    const data = store();
    const list = ensureLocalStoragePlansCatalog(data);
    const idx = list.findIndex((p) => p.id === planId);
    if (idx < 0) throw new Error('Plano não encontrado.');
    if (list.length <= 1) throw new Error('É necessário manter ao menos um plano no catálogo.');
    const removed = list[idx];
    const inUse = (data.companies || []).some((c) => {
      const limit =
        typeof c.storageLimitBytes === 'number' ? c.storageLimitBytes : 5 * LOCAL_GiB;
      return Math.abs(limit - (Number(removed.storageLimitBytes) || 0)) < 1;
    });
    if (inUse) {
      throw new Error('Não é possível excluir: há empresas com este limite de armazenamento.');
    }
    list.splice(idx, 1);
    data.platformSettings.storagePlans = recomputeLocalBarPercents(list);
    audit(data, {
      ...auditActor({}, a),
      action: 'exclusao_plano_armazenamento',
      resourceType: 'storage_plan',
      resourceId: planId,
      companyId: null,
      previousValue: { name: removed.name, storageLimitBytes: removed.storageLimitBytes }
    });
    persist(data);
    return { plans: getLocalStoragePlansCatalog(data) };
  }

  async function getPlatformStorage(actor = null) {
    if (useHttp()) return CSHttpApi.getPlatformStorage();
    await delay(30);
    assertSuperadmin(resolveActor(actor));
    const data = store();
    const platform = platformSettingsSync(data);
    if (!platform.platformStorage) {
      platform.platformStorage = {
        poolBytes: 500 * 1024 * 1024 * 1024,
        alertThresholds: { attention: 70, warning: 85, critical: 95 },
        alertOnAllocatedOvercommit: true,
        lastAlert: { usedBand: 'normal', allocatedBand: 'normal', overcommit: false, at: null }
      };
      data.platformSettings = platform;
      persist(data);
    }
    const cfg = platform.platformStorage;
    let usedTotal = 0;
    let allocatedTotal = 0;
    (data.companies || []).forEach((c) => {
      usedTotal += Number(c.storageUsedBytes) || 0;
      allocatedTotal +=
        typeof c.storageLimitBytes === 'number' ? c.storageLimitBytes : 5 * 1024 * 1024 * 1024;
    });
    const pool = Number(cfg.poolBytes) || 1;
    const usedPercent = Math.round((usedTotal / pool) * 1000) / 10;
    const allocatedPercent = Math.round((allocatedTotal / pool) * 1000) / 10;
    const overcommit = allocatedTotal > pool;
    const t = cfg.alertThresholds || { attention: 70, warning: 85, critical: 95 };
    function band(p, over) {
      if (over || p > 100) return { id: 'critico', label: 'Crítico' };
      if (p >= t.critical) return { id: 'critico', label: 'Crítico' };
      if (p >= t.warning) return { id: 'alerta', label: 'Alerta' };
      if (p >= t.attention) return { id: 'atencao', label: 'Atenção' };
      return { id: 'normal', label: 'Normal' };
    }
    const usedBand = band(usedPercent, false);
    const allocatedBand = band(allocatedPercent, overcommit);
    const alerts = [];
    if (usedBand.id !== 'normal') {
      alerts.push({
        type: 'used',
        severity: usedBand.id,
        message: `Uso real da plataforma em zona ${usedBand.label}: ${usedPercent}% do pool contratado.`
      });
    }
    if (cfg.alertOnAllocatedOvercommit !== false && overcommit) {
      alerts.push({
        type: 'overcommit',
        severity: 'alerta',
        message: `Overcommit: cotas alocadas (${allocatedPercent}%) superam o pool. Cadastros não são bloqueados.`
      });
    }
    return {
      capacity: {
        poolBytes: pool,
        usedTotalBytes: usedTotal,
        allocatedTotalBytes: allocatedTotal,
        freeAllocatedBytes: Math.max(0, pool - allocatedTotal),
        freeUsedBytes: Math.max(0, pool - usedTotal),
        usedPercent,
        allocatedPercent,
        overcommit,
        companyCount: (data.companies || []).length,
        alertThresholds: { ...t },
        alertOnAllocatedOvercommit: cfg.alertOnAllocatedOvercommit !== false,
        usedBand,
        allocatedBand,
        alerts
      },
      config: {
        poolBytes: pool,
        alertThresholds: { ...t },
        alertOnAllocatedOvercommit: cfg.alertOnAllocatedOvercommit !== false
      },
      newAlerts: []
    };
  }

  async function updatePlatformStorage(payload = {}, actor = null) {
    if (useHttp()) return CSHttpApi.updatePlatformStorage(payload);
    await delay(40);
    const a = assertSuperadmin(resolveActor(actor));
    const data = store();
    const platform = platformSettingsSync(data);
    if (!platform.platformStorage) platform.platformStorage = {};
    const cfg = platform.platformStorage;
    const previous = { ...cfg };
    if (payload.poolBytes != null && payload.poolBytes !== '') {
      const n = Number(payload.poolBytes);
      if (!Number.isFinite(n) || n < 10 * 1024 * 1024) throw new Error('Pool inválido. Informe ao menos 10 MiB.');
      cfg.poolBytes = Math.floor(n);
    }
    if (payload.alertThresholds && typeof payload.alertThresholds === 'object') {
      cfg.alertThresholds = {
        attention: Number(payload.alertThresholds.attention) || 70,
        warning: Number(payload.alertThresholds.warning) || 85,
        critical: Number(payload.alertThresholds.critical) || 95
      };
    }
    if (typeof payload.alertOnAllocatedOvercommit === 'boolean') {
      cfg.alertOnAllocatedOvercommit = payload.alertOnAllocatedOvercommit;
    }
    data.platformSettings = platform;
    audit(data, {
      ...auditActor({}, a),
      action: 'atualizacao_capacidade_plataforma',
      resourceType: 'platform_storage',
      resourceId: 'platform',
      previousValue: previous,
      newValue: {
        poolBytes: cfg.poolBytes,
        alertThresholds: cfg.alertThresholds,
        alertOnAllocatedOvercommit: cfg.alertOnAllocatedOvercommit
      }
    });
    persist(data);
    return getPlatformStorage(a);
  }

  async function getStoragePlans(actor = null, companyIdOverride = null) {
    const a = resolveActor(actor);
    const companyId =
      a?.role === 'superadmin'
        ? companyIdOverride || a.companyId || null
        : a?.companyId || companyIdOverride || null;
    if (useHttp()) return CSHttpApi.getStoragePlans(companyId);
    await delay(30);
    if (a && !['admin_empresa', 'apurador', 'superadmin'].includes(a.role)) {
      throw new Error('Acesso negado.');
    }
    const data = store();
    const pricing = resolveLocalStoragePricing(data, companyId);
    const platformCatalog = platformSettingsSync(data).storagePlanCatalog || {};
    const catalog = getLocalStoragePlansCatalog(data);
    persist(data);
    let plans = applyLocalPlanPricing(catalog, pricing, platformCatalog);
    if (a?.role === 'apurador') {
      plans = plans.map((p) =>
        p.hidePriceForApurador !== false
          ? {
              ...p,
              priceAmount: null,
              priceLabel: 'Sob consulta',
              priceSuffix: '',
              upgradePercent: null,
              priceHiddenForApurador: true
            }
          : p
      );
    }
    return { plans, companyId };
  }

  const LOCAL_LANDING_SCOPE_ID = 'pagina_inicial';

  async function getStoragePricing(companyId = null, actor = null) {
    if (useHttp()) return CSHttpApi.getStoragePricing(companyId);
    await delay(30);
    assertSuperadmin(resolveActor(actor));
    const data = store();
    if (!companyId) {
      return {
        companies: [
          {
            companyId: LOCAL_LANDING_SCOPE_ID,
            companyName: 'Página inicial',
            scope: 'landing',
            baseAmount: null,
            upgradePercent: null,
            corporativoConsult: false
          },
          ...(data.companies || []).map((c) => {
            const pricing = resolveLocalStoragePricing(data, c.id);
            return {
              companyId: c.id,
              companyName: c.nomeFantasia || c.razaoSocial || c.id,
              scope: 'company',
              baseAmount: pricing.baseAmount,
              upgradePercent: pricing.upgradePercent,
              corporativoConsult: pricing.corporativoConsult
            };
          })
        ],
        platformDefaults: platformSettingsSync(data).storagePricing || {
          defaultBaseAmount: 149,
          defaultUpgradePercent: 20,
          defaultCorporativoConsult: true
        }
      };
    }
    if (companyId === LOCAL_LANDING_SCOPE_ID) {
      const catalog = getLocalStoragePlansCatalog(data);
      persist(data);
      return {
        companyId: LOCAL_LANDING_SCOPE_ID,
        companyName: 'Página inicial',
        scope: 'landing',
        hideLandingPlans: Boolean(platformSettingsSync(data).hideLandingPlans),
        pricing: {
          baseAmount: null,
          upgradePercent: null,
          corporativoConsult: false,
          planAmounts: {},
          planDetails: {}
        },
        platformCatalog: platformSettingsSync(data).storagePlanCatalog || {},
        plans: catalog
      };
    }
    const company = (data.companies || []).find((c) => c.id === companyId);
    if (!company) throw new Error('Empresa não encontrada.');
    const pricing = resolveLocalStoragePricing(data, companyId);
    const platformCatalog = platformSettingsSync(data).storagePlanCatalog || {};
    const catalog = getLocalStoragePlansCatalog(data);
    persist(data);
    return {
      companyId,
      companyName: company.nomeFantasia || company.razaoSocial || company.id,
      scope: 'company',
      pricing,
      platformCatalog,
      plans: applyLocalPlanPricing(catalog, pricing, platformCatalog)
    };
  }

  async function updateStoragePricing(companyId, payload = {}, actor = null) {
    if (useHttp()) return CSHttpApi.updateStoragePricing(companyId, payload);
    await delay(40);
    const a = assertSuperadmin(resolveActor(actor));
    if (!companyId) throw new Error('Informe a empresa.');
    const data = store();

    if (companyId === LOCAL_LANDING_SCOPE_ID) {
      const list = ensureLocalStoragePlansCatalog(data);
      const details =
        payload.planDetails && typeof payload.planDetails === 'object' ? payload.planDetails : {};
      let featuredId = null;
      for (const plan of list) {
        const raw = details[plan.id];
        if (!raw || typeof raw !== 'object') continue;
        if (typeof raw.description === 'string') {
          plan.description = raw.description.trim().slice(0, 280) || plan.description;
        }
        if (typeof raw.usersLabel === 'string') {
          plan.usersLabel = raw.usersLabel.trim().slice(0, 80) || plan.usersLabel;
        }
        if (typeof raw.retentionLabel === 'string') {
          plan.retentionLabel = raw.retentionLabel.trim().slice(0, 120) || plan.retentionLabel;
        }
        if (typeof raw.billingNote === 'string') {
          plan.billingNote = raw.billingNote.trim().slice(0, 120) || plan.billingNote;
        }
        if (Array.isArray(raw.advantages) && raw.advantages.length) {
          plan.advantages = raw.advantages
            .map((x) => String(x == null ? '' : x).trim())
            .filter(Boolean)
            .slice(0, 20);
        }
        if (typeof raw.hidePriceOnPublic === 'boolean') plan.hidePriceOnPublic = raw.hidePriceOnPublic;
        if (typeof raw.featured === 'boolean' && raw.featured) featuredId = plan.id;
        else if (typeof raw.featured === 'boolean' && !raw.featured) plan.featured = false;
        if (raw.consultPricing === true || raw.priceAmount === null || raw.priceAmount === '') {
          plan.consultPricing = true;
          plan.priceAmount = null;
          plan.priceLabel = 'Sob consulta';
          plan.priceSuffix = '';
        } else if (raw.priceAmount != null && raw.priceAmount !== '') {
          const n = Number(raw.priceAmount);
          if (!Number.isFinite(n) || n < 0) {
            throw new Error(`Preço inválido no plano ${plan.name || plan.id}.`);
          }
          plan.consultPricing = false;
          plan.priceAmount = Math.round(n * 100) / 100;
          plan.priceLabel = formatLocalPriceLabel(plan.priceAmount);
          plan.priceSuffix = '/mês';
        }
      }
      if (featuredId) list.forEach((p) => { p.featured = p.id === featuredId; });
      data.platformSettings.storagePlans = recomputeLocalBarPercents(list);
      if (payload.hideLandingPlans != null) {
        const platform = platformSettingsSync(data);
        platform.hideLandingPlans = Boolean(payload.hideLandingPlans);
        data.platformSettings = platform;
      }
      audit(data, {
        ...auditActor({}, a),
        action: 'atualizacao_planos_landing',
        resourceType: 'landing_storage_plans',
        resourceId: LOCAL_LANDING_SCOPE_ID,
        companyId: null
      });
      persist(data);
      return {
        companyId: LOCAL_LANDING_SCOPE_ID,
        companyName: 'Página inicial',
        scope: 'landing',
        hideLandingPlans: Boolean(platformSettingsSync(data).hideLandingPlans),
        pricing: { baseAmount: null, upgradePercent: null, corporativoConsult: false },
        plans: getLocalStoragePlansCatalog(data)
      };
    }

    const company = (data.companies || []).find((c) => c.id === companyId);
    if (!company) throw new Error('Empresa não encontrada.');
    const cfg = companySettingsSync(data, companyId);
    const previous = resolveLocalStoragePricing(data, companyId);
    const next = {
      ...previous,
      planAmounts: { ...previous.planAmounts },
      planDetails: { ...previous.planDetails }
    };
    if (payload.baseAmount != null && payload.baseAmount !== '') {
      const n = Number(payload.baseAmount);
      if (!Number.isFinite(n) || n < 0) throw new Error('Valor base inválido.');
      next.baseAmount = Math.round(n * 100) / 100;
    }
    if (payload.upgradePercent != null && payload.upgradePercent !== '') {
      const n = Number(payload.upgradePercent);
      if (!Number.isFinite(n) || n < 0 || n > 500) throw new Error('Porcentagem de upgrade inválida (0–500).');
      next.upgradePercent = Math.round(n * 100) / 100;
    }
    if (typeof payload.corporativoConsult === 'boolean') {
      next.corporativoConsult = payload.corporativoConsult;
    }
    if (payload.planDetails && typeof payload.planDetails === 'object') {
      next.planDetails = sanitizeLocalPlanDetails({
        ...next.planDetails,
        ...payload.planDetails
      });
      next.planAmounts = { ...next.planAmounts };
      for (const [id, detail] of Object.entries(next.planDetails)) {
        if (!detail || typeof detail !== 'object') continue;
        if (detail.consultPricing === true || detail.priceAmount === null) {
          next.planAmounts[id] = null;
        } else if (detail.priceAmount != null && detail.priceAmount !== '') {
          const n = Number(detail.priceAmount);
          if (Number.isFinite(n) && n >= 0) next.planAmounts[id] = Math.round(n * 100) / 100;
        }
      }
    }
    if (payload.platformCatalog && typeof payload.platformCatalog === 'object') {
      const platform = platformSettingsSync(data);
      platform.storagePlanCatalog = sanitizeLocalPlanDetails({
        ...(platform.storagePlanCatalog || {}),
        ...payload.platformCatalog
      });
      data.platformSettings = platform;
    }
    cfg.storagePricing = {
      baseAmount: next.baseAmount,
      upgradePercent: next.upgradePercent,
      corporativoConsult: next.corporativoConsult,
      planAmounts: next.planAmounts,
      planDetails: next.planDetails
    };
    audit(data, {
      ...auditActor({}, a),
      action: 'atualizacao_precos_armazenamento',
      resourceType: 'company_storage_pricing',
      resourceId: companyId,
      companyId,
      previousValue: previous,
      newValue: cfg.storagePricing
    });
    persist(data);
    const catalog = getLocalStoragePlansCatalog(data);
    const platformCatalog = platformSettingsSync(data).storagePlanCatalog || {};
    return {
      companyId,
      companyName: company.nomeFantasia || company.razaoSocial || company.id,
      pricing: next,
      platformCatalog,
      plans: applyLocalPlanPricing(catalog, next, platformCatalog)
    };
  }

  async function contractStoragePlan(planId, actor = null, companyIdOverride = null) {
    if (useHttp()) {
      const a = resolveActor(actor);
      if (a?.role === 'apurador') {
        throw new Error('Apenas o Adm_Empresa pode contratar este serviço.');
      }
      const cid =
        a?.role === 'superadmin'
          ? companyIdOverride || a.companyId || null
          : null;
      return CSHttpApi.contractStoragePlan(planId, cid);
    }
    await delay(50);
    const a = resolveActor(actor);
    if (!a || a.role === 'apurador' || (a.role !== 'admin_empresa' && a.role !== 'superadmin')) {
      throw new Error('Apenas o Adm_Empresa pode contratar este serviço.');
    }
    const companyId =
      a.role === 'superadmin' ? companyIdOverride || a.companyId : a.companyId;
    if (!companyId) throw new Error('Nenhuma empresa vinculada à sessão.');
    const data = store();
    const pricing = resolveLocalStoragePricing(data, companyId);
    const platformCatalog = platformSettingsSync(data).storagePlanCatalog || {};
    const catalog = getLocalStoragePlansCatalog(data);
    const priced = applyLocalPlanPricing(catalog, pricing, platformCatalog);
    const plan = priced.find((p) => p.id === planId);
    if (!plan) throw new Error('Pacote inválido.');
    const idx = data.companies.findIndex((c) => c.id === companyId);
    if (idx < 0) throw new Error('Empresa não encontrada.');
    const company = data.companies[idx];
    const previousLimit =
      typeof company.storageLimitBytes === 'number' ? company.storageLimitBytes : 1073741824;
    const previousPlanId = company.storagePlanId || null;
    if (plan.storageLimitBytes <= previousLimit) {
      throw new Error('Selecione um pacote com limite maior que o atual.');
    }
    company.storageLimitBytes = plan.storageLimitBytes;
    company.storagePlanId = plan.id;
    if (typeof company.storageUsedBytes !== 'number') company.storageUsedBytes = 0;
    if (!Array.isArray(data.storageUpgradeRequests)) data.storageUpgradeRequests = [];
    const previousPlan = previousPlanId ? priced.find((p) => p.id === previousPlanId) : null;
    const request = {
      id: uid('stgup'),
      companyId: company.id,
      companyName: company.nomeFantasia || company.razaoSocial || company.id,
      planId: plan.id,
      planName: plan.name,
      previousLimitBytes: previousLimit,
      newLimitBytes: plan.storageLimitBytes,
      previousAmount: previousPlan?.priceAmount ?? null,
      newAmount: plan.priceAmount ?? null,
      upgradePercent: pricing.upgradePercent,
      priceLabel: plan.priceLabel,
      requestedByUserId: a.id,
      requestedByName: a.nome || a.email || a.id,
      status: 'pendente_comercial',
      createdAt: new Date().toISOString(),
      resolvedAt: null,
      resolvedByUserId: null
    };
    data.storageUpgradeRequests.unshift(request);
    audit(data, {
      ...auditActor({}, a),
      action: 'contratacao_pacote_armazenamento',
      resourceType: 'company',
      resourceId: company.id,
      companyId: company.id,
      previousValue: { storageLimitBytes: previousLimit, storagePlanId: previousPlanId },
      newValue: {
        storageLimitBytes: plan.storageLimitBytes,
        planId: plan.id,
        planName: plan.name,
        amount: plan.priceAmount,
        upgradePercent: pricing.upgradePercent,
        requestId: request.id,
        billingNote: 'Valores serão reajustados conforme o plano solicitado.'
      }
    });
    persist(data);
    const usage = await getStorageUsage(companyId, a);
    return {
      usage,
      plan,
      request,
      pricing: { baseAmount: pricing.baseAmount, upgradePercent: pricing.upgradePercent },
      message:
        'Pacote contratado. A cota foi atualizada imediatamente. Os valores serão reajustados conforme o plano solicitado.'
    };
  }

  async function getStorageUpgradeRequests(status = null, actor = null) {
    if (useHttp()) return CSHttpApi.getStorageUpgradeRequests(status);
    await delay(30);
    assertSuperadmin(resolveActor(actor));
    let list = store().storageUpgradeRequests || [];
    if (status) list = list.filter((r) => r.status === status);
    return { requests: list };
  }

  async function resolveStorageUpgradeRequest(requestId, actor = null) {
    if (useHttp()) return CSHttpApi.resolveStorageUpgradeRequest(requestId);
    await delay(40);
    const a = assertSuperadmin(resolveActor(actor));
    const data = store();
    if (!Array.isArray(data.storageUpgradeRequests)) data.storageUpgradeRequests = [];
    const idx = data.storageUpgradeRequests.findIndex((r) => r.id === requestId);
    if (idx < 0) throw new Error('Solicitação não encontrada.');
    const prev = data.storageUpgradeRequests[idx];
    if (prev.status !== 'tratado') {
      data.storageUpgradeRequests[idx] = {
        ...prev,
        status: 'tratado',
        resolvedAt: new Date().toISOString(),
        resolvedByUserId: a.id
      };
      audit(data, {
        ...auditActor({}, a),
        action: 'tratamento_solicitacao_pacote_armazenamento',
        resourceType: 'storage_upgrade_request',
        resourceId: requestId,
        companyId: prev.companyId,
        previousValue: { status: prev.status },
        newValue: { status: 'tratado' }
      });
      persist(data);
    }
    return { request: data.storageUpgradeRequests[idx] };
  }

  async function listPlatformSupport(filters = {}, actor = null) {
    if (useHttp()) return CSHttpApi.listPlatformSupport(filters);
    await delay();
    const a = resolveActor(actor !== null ? actor : {});
    const data = store();
    if (!Array.isArray(data.platformSupportThreads)) data.platformSupportThreads = [];
    let list = [...data.platformSupportThreads];
    if (a.role === 'superadmin') {
      if (filters.companyId) list = list.filter((t) => t.companyId === filters.companyId);
      if (filters.status) list = list.filter((t) => t.status === filters.status);
    } else if (a.role === 'admin_empresa' || a.role === 'apurador') {
      list = list.filter((t) => t.companyId === a.companyId);
    } else {
      throw new Error('Acesso negado.');
    }
    list.sort((x, y) => (x.updatedAt < y.updatedAt ? 1 : -1));
    const threads = list.map((t) => {
      const messages = Array.isArray(t.messages) ? t.messages : [];
      const unreadCount = messages.filter(
        (m) => m.direction === 'platform' && m.readByCompany !== true
      ).length;
      return { ...t, messages, unreadCount };
    });
    const unreadTotal = threads.reduce((sum, t) => sum + (Number(t.unreadCount) || 0), 0);
    return { threads, slaHours: 24, unreadTotal };
  }

  async function createPlatformSupport(payload = {}, actor = null) {
    if (useHttp()) return CSHttpApi.createPlatformSupport(payload);
    await delay();
    const a = resolveActor(actor !== null ? actor : {});
    if (a.role !== 'admin_empresa' && a.role !== 'apurador') {
      throw new Error('Apenas usuários da empresa podem abrir suporte.');
    }
    if (!a.companyId) throw new Error('Nenhuma empresa vinculada à sessão.');
    const body = String(payload.body || '')
      .trim()
      .replace(/<[^>]*>/g, '')
      .slice(0, 4000);
    if (!body) throw new Error('Escreva a mensagem para o suporte.');
    const subject =
      String(payload.subject || 'Solicitação de suporte')
        .trim()
        .replace(/<[^>]*>/g, '')
        .slice(0, 160) || 'Solicitação de suporte';
    const categoryRaw = String(payload.category || 'suporte_tecnico')
      .trim()
      .toLowerCase()
      .slice(0, 40);
    const category =
      categoryRaw === 'problema' || categoryRaw === 'suporte_tecnico' ? categoryRaw : 'suporte_tecnico';
    const data = store();
    const company = (data.companies || []).find((c) => c.id === a.companyId);
    const now = new Date().toISOString();
    const thread = {
      id: uid('psup'),
      companyId: a.companyId,
      companyName: company?.nomeFantasia || company?.razaoSocial || a.companyId,
      subject,
      category,
      status: 'aberto',
      createdAt: now,
      updatedAt: now,
      respondBy: new Date(Date.now() + 24 * 60 * 60 * 1000).toISOString(),
      firstResponseAt: null,
      closedAt: null,
      createdByUserId: a.id,
      createdByName: a.nome || a.email || a.id,
      createdByRole: a.role,
      messages: [
        {
          id: uid('psmsg'),
          direction: 'company',
          body,
          actorUserId: a.id,
          actorName: a.nome || a.email || a.id,
          createdAt: now,
          readByCompany: true
        }
      ]
    };
    if (!Array.isArray(data.platformSupportThreads)) data.platformSupportThreads = [];
    data.platformSupportThreads.unshift(thread);
    data.notifications = data.notifications || [];
    const preview = body.slice(0, 120);
    const supers = (data.users || []).filter((u) => u.status === 'ativo' && u.role === 'superadmin');
    if (supers.length) {
      supers.forEach((admin) => {
        data.notifications.unshift({
          id: uid('ntf'),
          type: 'platform_support_message',
          title: 'Nova mensagem de suporte',
          message: `${thread.companyName}: ${preview}`,
          role: 'superadmin',
          userId: admin.id,
          companyId: thread.companyId,
          threadId: thread.id,
          read: false,
          createdAt: now
        });
      });
    } else {
      data.notifications.unshift({
        id: uid('ntf'),
        type: 'platform_support_message',
        title: 'Nova mensagem de suporte',
        message: `${thread.companyName}: ${preview}`,
        role: 'superadmin',
        companyId: thread.companyId,
        threadId: thread.id,
        read: false,
        createdAt: now
      });
    }
    persist(data);
    return thread;
  }

  async function getPlatformSupportThread(threadId, actor = null) {
    if (useHttp()) return CSHttpApi.getPlatformSupportThread(threadId);
    await delay();
    const a = resolveActor(actor !== null ? actor : {});
    const data = store();
    const thread = (data.platformSupportThreads || []).find((t) => t.id === threadId);
    if (!thread) throw new Error('Conversa não encontrada.');
    if (a.role !== 'superadmin' && thread.companyId !== a.companyId) {
      throw new Error('Conversa não encontrada.');
    }
    return thread;
  }

  async function replyPlatformSupport(threadId, bodyText, actor = null) {
    if (useHttp()) return CSHttpApi.replyPlatformSupport(threadId, bodyText);
    await delay();
    const a = resolveActor(actor !== null ? actor : {});
    const body = String(bodyText || '')
      .trim()
      .replace(/<[^>]*>/g, '')
      .slice(0, 4000);
    if (!body) throw new Error('Mensagem vazia.');
    const data = store();
    const thread = (data.platformSupportThreads || []).find((t) => t.id === threadId);
    if (!thread) throw new Error('Conversa não encontrada.');
    if (a.role !== 'superadmin' && thread.companyId !== a.companyId) {
      throw new Error('Conversa não encontrada.');
    }
    if (thread.status === 'fechado') throw new Error('Esta conversa está fechada.');
    const now = new Date().toISOString();
    const isPlatform = a.role === 'superadmin';
    thread.messages = thread.messages || [];
    thread.messages.push({
      id: uid('psmsg'),
      direction: isPlatform ? 'platform' : 'company',
      body,
      actorUserId: a.id,
      actorName: a.nome || a.email || a.id,
      createdAt: now,
      readByCompany: isPlatform ? false : true
    });
    thread.updatedAt = now;
    data.notifications = data.notifications || [];
    if (isPlatform) {
      if (!thread.firstResponseAt) thread.firstResponseAt = now;
      thread.status = 'respondido';
      thread.lastResponderUserId = a.id;
      thread.lastResponderName = a.nome || a.email || a.id;
      (data.notifications || []).forEach((n) => {
        if (n.type === 'platform_support_message' && n.threadId === thread.id && !n.read) {
          n.read = true;
          n.readAt = now;
          n.clearedByReply = true;
        }
      });
      data.notifications.unshift({
        id: uid('ntf'),
        type: 'platform_support_reply',
        title: 'Resposta do suporte da plataforma',
        message: body.slice(0, 120),
        companyId: thread.companyId,
        threadId: thread.id,
        read: false,
        createdAt: now
      });
    } else {
      thread.status = 'aberto';
      thread.respondBy = new Date(Date.now() + 24 * 60 * 60 * 1000).toISOString();
      const preview = body.slice(0, 120);
      const supers = (data.users || []).filter((u) => u.status === 'ativo' && u.role === 'superadmin');
      if (supers.length) {
        supers.forEach((admin) => {
          data.notifications.unshift({
            id: uid('ntf'),
            type: 'platform_support_message',
            title: 'Nova mensagem de suporte',
            message: `${thread.companyName}: ${preview}`,
            role: 'superadmin',
            userId: admin.id,
            companyId: thread.companyId,
            threadId: thread.id,
            read: false,
            createdAt: now
          });
        });
      } else {
        data.notifications.unshift({
          id: uid('ntf'),
          type: 'platform_support_message',
          title: 'Nova mensagem de suporte',
          message: `${thread.companyName}: ${preview}`,
          role: 'superadmin',
          companyId: thread.companyId,
          threadId: thread.id,
          read: false,
          createdAt: now
        });
      }
    }
    persist(data);
    return thread;
  }

  async function closePlatformSupport(threadId, actor = null) {
    if (useHttp()) return CSHttpApi.closePlatformSupport(threadId);
    await delay();
    const a = assertSuperadmin(resolveActor(actor));
    const data = store();
    const thread = (data.platformSupportThreads || []).find((t) => t.id === threadId);
    if (!thread) throw new Error('Conversa não encontrada.');
    const now = new Date().toISOString();
    thread.status = 'fechado';
    thread.closedAt = now;
    thread.updatedAt = now;
    persist(data);
    return thread;
  }

  async function markPlatformSupportRead(threadId = null, actor = null) {
    if (useHttp()) return CSHttpApi.markPlatformSupportRead(threadId);
    await delay();
    const a = resolveActor(actor !== null ? actor : {});
    if (a.role !== 'admin_empresa' && a.role !== 'apurador') {
      throw new Error('Acesso negado.');
    }
    if (!a.companyId) throw new Error('Nenhuma empresa vinculada à sessão.');
    const data = store();
    const now = new Date().toISOString();
    let marked = 0;
    (data.platformSupportThreads || []).forEach((thread) => {
      if (thread.companyId !== a.companyId) return;
      if (threadId && thread.id !== threadId) return;
      (thread.messages || []).forEach((m) => {
        if (m.direction === 'platform' && m.readByCompany !== true) {
          m.readByCompany = true;
          m.readByCompanyAt = now;
          marked += 1;
        }
      });
    });
    (data.notifications || []).forEach((n) => {
      if (
        n.type === 'platform_support_reply' &&
        n.companyId === a.companyId &&
        !n.read &&
        (!threadId || n.threadId === threadId)
      ) {
        n.read = true;
        n.readAt = now;
      }
    });
    persist(data);
    return { marked, unreadTotal: 0 };
  }

  function resolveLocalPlatformMaster(data) {
    const supers = (data.users || []).filter((u) => u.role === 'superadmin' && u.status === 'ativo');
    if (!supers.length) return null;
    const flagged = supers.find((u) => u.isPlatformMaster === true);
    if (flagged) return flagged;
    return supers
      .slice()
      .sort((a, b) => {
        const ca = String(a.createdAt || '');
        const cb = String(b.createdAt || '');
        if (ca && cb && ca !== cb) return ca.localeCompare(cb);
        if (ca && !cb) return -1;
        if (!ca && cb) return 1;
        return String(a.id || '').localeCompare(String(b.id || ''));
      })[0];
  }

  function enrichInternalThread(thread, actor, data) {
    const messages = Array.isArray(thread.messages) ? thread.messages : [];
    const master = resolveLocalPlatformMaster(data);
    const isMaster = Boolean(master && actor.id === master.id);
    let unreadCount = 0;
    messages.forEach((m) => {
      const readBy = m.readBy && typeof m.readBy === 'object' ? m.readBy : {};
      if (isMaster) {
        if (m.direction === 'requester' && readBy[actor.id] !== true) unreadCount += 1;
      } else if (m.direction === 'attendant' && readBy[actor.id] !== true) {
        unreadCount += 1;
      }
    });
    return {
      ...thread,
      messages,
      unreadCount,
      assigneeUserId: thread.assigneeUserId || master?.id || null,
      assigneeName: thread.assigneeName || master?.nome || 'Adm_Plataforma Master',
      isMasterViewer: isMaster
    };
  }

  async function listInternalSupport(actor = null) {
    if (useHttp()) return CSHttpApi.listInternalSupport();
    await delay();
    const a = assertSuperadmin(resolveActor(actor !== null ? actor : {}));
    const data = store();
    const master = resolveLocalPlatformMaster(data);
    const threads = (data.platformInternalSupportThreads || [])
      .slice()
      .sort((x, y) => (x.updatedAt < y.updatedAt ? 1 : -1))
      .map((t) => enrichInternalThread(t, a, data));
    const unreadTotal = threads.reduce((s, t) => s + (Number(t.unreadCount) || 0), 0);
    return {
      threads,
      slaHours: 24,
      unreadTotal,
      master: master
        ? { id: master.id, nome: master.nome || master.email || master.id, email: master.email || null }
        : null,
      isMaster: Boolean(master && master.id === a.id)
    };
  }

  async function createInternalSupport(payload = {}, actor = null) {
    if (useHttp()) return CSHttpApi.createInternalSupport(payload);
    await delay();
    const a = assertSuperadmin(resolveActor(actor !== null ? actor : {}));
    const data = store();
    const master = resolveLocalPlatformMaster(data);
    if (!master) throw new Error('Nenhum Adm_Plataforma Master disponível.');
    if (a.id === master.id) {
      throw new Error('O Adm_Plataforma Master já é o atendente deste canal.');
    }
    const body = String(payload.body || '')
      .trim()
      .replace(/<[^>]*>/g, '')
      .slice(0, 4000);
    if (!body) throw new Error('Escreva a mensagem para o Master.');
    const subject =
      String(payload.subject || 'Suporte interno')
        .trim()
        .replace(/<[^>]*>/g, '')
        .slice(0, 160) || 'Suporte interno';
    const now = new Date().toISOString();
    const thread = {
      id: uid('pisup'),
      channel: 'internal',
      subject,
      status: 'aberto',
      createdAt: now,
      updatedAt: now,
      respondBy: new Date(Date.now() + 24 * 60 * 60 * 1000).toISOString(),
      firstResponseAt: null,
      closedAt: null,
      createdByUserId: a.id,
      createdByName: a.nome || a.email || a.id,
      assigneeUserId: master.id,
      assigneeName: master.nome || master.email || master.id,
      messages: [
        {
          id: uid('pimsg'),
          direction: 'requester',
          body,
          actorUserId: a.id,
          actorName: a.nome || a.email || a.id,
          createdAt: now,
          readBy: { [a.id]: true }
        }
      ]
    };
    if (!Array.isArray(data.platformInternalSupportThreads)) data.platformInternalSupportThreads = [];
    data.platformInternalSupportThreads.unshift(thread);
    data.notifications = data.notifications || [];
    data.notifications.unshift({
      id: uid('ntf'),
      type: 'platform_internal_support',
      title: 'Mensagem interna de Adm_Plataforma',
      message: `${thread.createdByName}: ${body.slice(0, 120)}`,
      role: 'superadmin',
      userId: master.id,
      threadId: thread.id,
      channel: 'internal',
      read: false,
      createdAt: now
    });
    persist(data);
    return enrichInternalThread(thread, a, data);
  }

  async function getInternalSupportThread(threadId, actor = null) {
    if (useHttp()) return CSHttpApi.getInternalSupportThread(threadId);
    await delay();
    const a = assertSuperadmin(resolveActor(actor !== null ? actor : {}));
    const data = store();
    const thread = (data.platformInternalSupportThreads || []).find((t) => t.id === threadId);
    if (!thread) throw new Error('Conversa não encontrada.');
    return enrichInternalThread(thread, a, data);
  }

  async function replyInternalSupport(threadId, bodyText, actor = null) {
    if (useHttp()) return CSHttpApi.replyInternalSupport(threadId, bodyText);
    await delay();
    const a = assertSuperadmin(resolveActor(actor !== null ? actor : {}));
    const body = String(bodyText || '')
      .trim()
      .replace(/<[^>]*>/g, '')
      .slice(0, 4000);
    if (!body) throw new Error('Mensagem vazia.');
    const data = store();
    const master = resolveLocalPlatformMaster(data);
    const thread = (data.platformInternalSupportThreads || []).find((t) => t.id === threadId);
    if (!thread) throw new Error('Conversa não encontrada.');
    if (thread.status === 'fechado') throw new Error('Esta conversa está fechada.');
    const asMaster = Boolean(master && a.id === master.id);
    const now = new Date().toISOString();
    thread.messages = thread.messages || [];
    thread.messages.push({
      id: uid('pimsg'),
      direction: asMaster ? 'attendant' : 'requester',
      body,
      actorUserId: a.id,
      actorName: a.nome || a.email || a.id,
      createdAt: now,
      readBy: { [a.id]: true }
    });
    thread.updatedAt = now;
    data.notifications = data.notifications || [];
    if (asMaster) {
      if (!thread.firstResponseAt) thread.firstResponseAt = now;
      thread.status = 'respondido';
      thread.lastResponderUserId = a.id;
      thread.lastResponderName = a.nome || a.email || a.id;
      data.notifications.unshift({
        id: uid('ntf'),
        type: 'platform_internal_support_reply',
        title: 'Resposta do Adm_Plataforma Master',
        message: body.slice(0, 120),
        role: 'superadmin',
        userId: thread.createdByUserId,
        threadId: thread.id,
        channel: 'internal',
        read: false,
        createdAt: now
      });
      (data.notifications || []).forEach((n) => {
        if (n.type === 'platform_internal_support' && n.threadId === thread.id && n.userId === a.id) {
          n.read = true;
          n.readAt = now;
        }
      });
    } else {
      thread.status = 'aberto';
      thread.respondBy = new Date(Date.now() + 24 * 60 * 60 * 1000).toISOString();
      if (master) {
        data.notifications.unshift({
          id: uid('ntf'),
          type: 'platform_internal_support',
          title: 'Mensagem interna de Adm_Plataforma',
          message: `${a.nome || a.email}: ${body.slice(0, 120)}`,
          role: 'superadmin',
          userId: master.id,
          threadId: thread.id,
          channel: 'internal',
          read: false,
          createdAt: now
        });
      }
    }
    persist(data);
    return enrichInternalThread(thread, a, data);
  }

  async function markInternalSupportRead(threadId = null, actor = null) {
    if (useHttp()) return CSHttpApi.markInternalSupportRead(threadId);
    await delay();
    const a = assertSuperadmin(resolveActor(actor !== null ? actor : {}));
    const data = store();
    const master = resolveLocalPlatformMaster(data);
    const isMaster = Boolean(master && master.id === a.id);
    const now = new Date().toISOString();
    let marked = 0;
    (data.platformInternalSupportThreads || []).forEach((thread) => {
      if (threadId && thread.id !== threadId) return;
      (thread.messages || []).forEach((m) => {
        if (!m.readBy || typeof m.readBy !== 'object') m.readBy = {};
        const relevant = isMaster ? m.direction === 'requester' : m.direction === 'attendant';
        if (relevant && m.readBy[a.id] !== true) {
          m.readBy[a.id] = true;
          marked += 1;
        }
      });
    });
    (data.notifications || []).forEach((n) => {
      if (
        (n.type === 'platform_internal_support' || n.type === 'platform_internal_support_reply') &&
        n.userId === a.id &&
        !n.read &&
        (!threadId || n.threadId === threadId)
      ) {
        n.read = true;
        n.readAt = now;
      }
    });
    persist(data);
    return { marked, unreadTotal: 0, isMaster };
  }

  async function getInternalSupportMaster(actor = null) {
    if (useHttp()) return CSHttpApi.getInternalSupportMaster();
    await delay();
    const a = assertSuperadmin(resolveActor(actor !== null ? actor : {}));
    const data = store();
    const master = resolveLocalPlatformMaster(data);
    return {
      master: master
        ? { id: master.id, nome: master.nome || master.email || master.id, email: master.email || null }
        : null,
      isMaster: Boolean(master && master.id === a.id)
    };
  }

  async function submitAssistantFeedback(payload = {}, actor = null) {
    if (useHttp()) return CSHttpApi.submitAssistantFeedback(payload);
    await delay();
    const a = resolveActor(actor !== null ? actor : {});
    if (a.role !== 'admin_empresa' && a.role !== 'apurador') {
      throw new Error('Acesso negado.');
    }
    if (!a.companyId) throw new Error('Nenhuma empresa vinculada à sessão.');
    const categoryRaw = String(payload.category || payload.type || '')
      .trim()
      .toLowerCase()
      .slice(0, 40);
    const isFreeform = categoryRaw === 'sugestao' || categoryRaw === 'reclamacao';
    const category = isFreeform ? categoryRaw : 'avaliacao';
    const subject = String(payload.subject || '')
      .trim()
      .replace(/<[^>]*>/g, '')
      .slice(0, 160);
    const message = String(payload.message || payload.improvement || payload.body || '')
      .trim()
      .replace(/<[^>]*>/g, '')
      .slice(0, 2000);
    let rating = null;
    if (isFreeform) {
      if (!message) {
        throw new Error(category === 'reclamacao' ? 'Descreva a reclamação.' : 'Descreva a sugestão.');
      }
    } else {
      rating = Number(payload.rating);
      if (!Number.isInteger(rating) || rating < 1 || rating > 5) {
        throw new Error('Informe uma nota de 1 a 5.');
      }
      if (rating < 5 && !message) {
        throw new Error('Descreva o que poderíamos melhorar.');
      }
    }
    const data = store();
    if (!Array.isArray(data.assistantFeedback)) data.assistantFeedback = [];
    const company = (data.companies || []).find((c) => c.id === a.companyId);
    const entry = {
      id: uid('afb'),
      companyId: a.companyId,
      companyName: company?.nomeFantasia || company?.razaoSocial || a.companyId,
      userId: a.id || null,
      userName: a.nome || a.email || null,
      role: a.role,
      category,
      subject: subject || '',
      rating: isFreeform ? null : rating,
      improvement: isFreeform ? message : rating < 5 ? message : '',
      source: String(payload.source || (isFreeform ? `empresa_${category}` : 'assistente_virtual')).slice(0, 40),
      createdAt: new Date().toISOString()
    };
    data.assistantFeedback.unshift(entry);
    persist(data);
    return { id: entry.id, rating: entry.rating, category: entry.category };
  }

  async function listAssistantFeedback(filters = {}, actor = null) {
    if (useHttp()) return CSHttpApi.listAssistantFeedback(filters);
    await delay();
    const a = resolveActor(actor !== null ? actor : {});
    if (a.role !== 'superadmin') throw new Error('Acesso negado.');
    const data = store();
    let list = [...(data.assistantFeedback || [])];
    const rating = filters.rating != null && filters.rating !== '' ? Number(filters.rating) : null;
    if (Number.isInteger(rating) && rating >= 1 && rating <= 5) {
      list = list.filter((f) => Number(f.rating) === rating);
    }
    if (filters.withImprovement) {
      list = list.filter((f) => String(f.improvement || '').trim());
    }
    if (filters.companyId) {
      list = list.filter((f) => f.companyId === filters.companyId);
    }
    const category = String(filters.category || '')
      .trim()
      .toLowerCase();
    if (category) {
      list = list.filter((f) => String(f.category || 'avaliacao').toLowerCase() === category);
    }
    list.sort((x, y) => (x.createdAt < y.createdAt ? 1 : -1));
    const rated = list.filter((f) => Number(f.rating) >= 1);
    const summary = {
      total: list.length,
      avgRating:
        rated.length > 0
          ? Number((rated.reduce((s, f) => s + (Number(f.rating) || 0), 0) / rated.length).toFixed(2))
          : null,
      withImprovement: list.filter((f) => String(f.improvement || '').trim()).length,
      sugestoes: list.filter((f) => f.category === 'sugestao').length,
      reclamacoes: list.filter((f) => f.category === 'reclamacao').length,
      byRating: { 1: 0, 2: 0, 3: 0, 4: 0, 5: 0 }
    };
    list.forEach((f) => {
      const r = Number(f.rating);
      if (summary.byRating[r] != null) summary.byRating[r] += 1;
    });
    return { items: list.slice(0, 200), summary };
  }

  function ensureLocalSupportFaqs(data) {
    if (!Array.isArray(data.supportFaqs)) data.supportFaqs = [];
    const now = new Date().toISOString();
    const seeds = [
      {
        id: 'faq_seed_suporte',
        question: 'Como falar com o suporte da plataforma?',
        answer:
          'Use o botão flutuante no canto da tela (Assistente Virtual). Abra a aba Ajuda. Se não resolver, envie uma mensagem — resposta em até 24h.',
        keywords: ['suporte', 'ajuda', 'humano', '24h', 'faq'],
        audience: ['all'],
        sortOrder: 10
      },
      {
        id: 'faq_seed_badge',
        question: 'O que significa o número laranja no ícone de ajuda?',
        answer:
          'São respostas novas da plataforma ainda não vistas. Ao abrir a aba Mensagem e visualizar, o contador zera.',
        keywords: ['badge', 'laranja', 'numero', 'icone', 'contador'],
        audience: ['all'],
        sortOrder: 20
      },
      {
        id: 'faq_seed_need_to_know',
        question: 'Por que o Apurador não vê todos os relatos?',
        answer:
          'Por need-to-know: só vê relatos encaminhados a ele pelo Adm_Empresa.',
        keywords: ['need-to-know', 'apurador', 'acesso', 'relato'],
        audience: ['all'],
        sortOrder: 40
      },
      {
        id: 'faq_seed_tratar_relato',
        question: 'Como tratar um relato passo a passo?',
        answer:
          'Em Relatos, avance o fluxo, fale com o denunciante, registre Medidas e ações e conclua quando apropriado.',
        keywords: ['tratar', 'relato', 'fluxo', 'medida'],
        audience: ['all'],
        sortOrder: 50
      },
      {
        id: 'faq_seed_sigilo',
        question: 'Quais regras de sigilo e LGPD devo seguir?',
        answer:
          'Não compartilhe prints nem protocolo + código. Peça só dados necessários ao denunciante.',
        keywords: ['sigilo', 'lgpd', 'protocolo', 'confidencial'],
        audience: ['all'],
        sortOrder: 80
      },
      {
        id: 'faq_seed_encaminhar',
        question: 'Como encaminhar um relato para um Apurador?',
        answer:
          'No detalhe do relato, use Encaminhar e escolha o Apurador. Só ele verá aquele caso.',
        keywords: ['encaminhar', 'atribuir', 'apurador'],
        audience: ['admin_empresa'],
        sortOrder: 200
      },
      {
        id: 'faq_seed_usuarios',
        question: 'Como cadastrar usuários da empresa?',
        answer: 'Em Usuários, cadastre Adm_Empresa e Apuradores da sua empresa.',
        keywords: ['usuarios', 'cadastrar', 'apurador'],
        audience: ['admin_empresa'],
        sortOrder: 220
      },
      {
        id: 'faq_seed_armazenamento_adm',
        question: 'Como solicitar mais armazenamento?',
        answer:
          'Em Armazenamento, consulte os pacotes e solicite upgrade. O Adm_Plataforma trata o comercial.',
        keywords: ['armazenamento', 'upgrade', 'pacote', 'quota'],
        audience: ['admin_empresa'],
        sortOrder: 260
      },
      {
        id: 'faq_seed_apurador_limites',
        question: 'O que o Apurador pode e não pode fazer?',
        answer:
          'Pode tratar relatos encaminhados a você. Não pode encaminhar nem gerenciar usuários/colaboradores/identidade.',
        keywords: ['limites', 'apurador', 'pode'],
        audience: ['apurador'],
        sortOrder: 300
      },
      {
        id: 'faq_seed_apurador_visibilidade',
        question: 'Quais relatos aparecem para mim como Apurador?',
        answer: 'Somente os encaminhados a você pelo Adm_Empresa.',
        keywords: ['visibilidade', 'encaminhado', 'relatos'],
        audience: ['apurador'],
        sortOrder: 310
      },
      {
        id: 'faq_seed_apurador_armazenamento',
        question: 'Posso contratar mais armazenamento como Apurador?',
        answer: 'Não. Só consulte o consumo; a contratação é do Adm_Empresa.',
        keywords: ['armazenamento', 'contratar', 'apurador'],
        audience: ['apurador'],
        sortOrder: 330
      },
      {
        id: 'faq_seed_public_fazer_denuncia',
        question: 'Como faço uma denúncia neste canal?',
        answer:
          'Como fazer uma denúncia\n1. Acesse o formulário oficial pelo botão “Fazer uma denúncia”.\n2. Informe o CPF para validar o vínculo com a empresa cadastrada.\n3. Escolha se o relato será identificado ou anônimo, quando a opção estiver disponível.\n4. Descreva os fatos com clareza e anexe documentos, se necessário.\n5. Envie o relato e guarde o protocolo e o código de acompanhamento em local seguro.',
        keywords: ['denuncia', 'relato', 'fazer', 'registrar', 'como', 'comecar', 'enviar', 'cpf', 'formulario'],
        audience: ['public'],
        sortOrder: 10
      },
      {
        id: 'faq_seed_public_assedio_moral',
        question: 'O que é assédio moral?',
        answer:
          'Assédio moral, de forma geral, envolve condutas abusivas e reiteradas que humilham, isolam ou pressionam alguém no ambiente de trabalho.\n\nEste assistente oferece orientação geral. Para exemplos e conteúdos educativos, consulte a área Sobre / Orientações. Se você vivenciou uma situação inadequada, utilize o formulário oficial de denúncia.',
        keywords: ['assedio', 'moral', 'humilhacao', 'pressao', 'isolamento', 'o que e'],
        audience: ['public'],
        sortOrder: 15
      },
      {
        id: 'faq_seed_public_anonimo',
        question: 'Posso fazer uma denúncia anônima?',
        answer:
          'Quando a opção estiver disponível no canal da sua organização, você pode escolher o modo anônimo. Nesse caso, dados pessoais não são obrigatórios.',
        keywords: ['anonimo', 'anonimato', 'identificado', 'sigilo'],
        audience: ['public'],
        sortOrder: 20
      },
      {
        id: 'faq_seed_public_protocolo',
        question: 'Como consulto o andamento da minha denúncia?',
        answer:
          'Como acompanhar uma denúncia\n1. Acesse “Consultar protocolo” na página inicial.\n2. Informe o número do protocolo e o código de acompanhamento recebidos no registro.\n3. Consulte as informações disponíveis sobre o andamento.\n\nSem protocolo e código, o canal não exibe o andamento — isso protege a confidencialidade.',
        keywords: ['protocolo', 'consultar', 'andamento', 'codigo', 'acompanhamento', 'acompanhar'],
        audience: ['public'],
        sortOrder: 30
      },
      {
        id: 'faq_seed_public_depois',
        question: 'O que acontece depois que eu envio o relato?',
        answer:
          'O relato é registrado e encaminhado conforme o procedimento da organização. Acompanhe pela consulta com protocolo e código.',
        keywords: ['depois', 'envio', 'analise', 'prazo'],
        audience: ['public'],
        sortOrder: 40
      },
      {
        id: 'faq_seed_public_provas',
        question: 'Preciso ter provas para denunciar?',
        answer:
          'Não é obrigatório ter provas completas para iniciar. Descreva o que aconteceu com clareza; anexos podem ser enviados nas etapas do formulário.',
        keywords: ['provas', 'evidencias', 'anexo', 'obrigatorio'],
        audience: ['public'],
        sortOrder: 50
      },
      {
        id: 'faq_seed_public_confidencial',
        question: 'O canal é confidencial?',
        answer:
          'Sim. O Canal Seguro foi pensado para comunicação confidencial.\n\nO acesso interno aos relatos é restrito a perfis autorizados. Não compartilhe protocolo, código ou detalhes do caso com terceiros. Para mais detalhes, consulte a Política de Privacidade.',
        keywords: ['confidencial', 'sigilo', 'privacidade', 'lgpd', 'minha denuncia'],
        audience: ['public'],
        sortOrder: 60
      },
      {
        id: 'faq_seed_public_fale_conosco',
        question: 'Qual a diferença entre Fale conosco e fazer uma denúncia?',
        answer:
          '“Fazer uma denúncia” é para relatar situações inadequadas. “Fale conosco” é para dúvidas gerais sobre o uso do canal — não substitui o registro de um relato.',
        keywords: ['fale', 'conosco', 'contato', 'duvida', 'diferenca'],
        audience: ['public'],
        sortOrder: 70
      },
      {
        id: 'faq_seed_public_esqueci_protocolo',
        question: 'Esqueci o protocolo ou o código de acompanhamento. E agora?',
        answer:
          'Por política de privacidade, o canal não reenvia nem revela protocolo ou código por este assistente. Guarde esses dados no momento do registro.',
        keywords: ['esqueci', 'perdi', 'protocolo', 'codigo', 'recuperar'],
        audience: ['public'],
        sortOrder: 80
      }
    ];
    const byId = new Map(data.supportFaqs.map((f) => [f.id, f]));
    let changed = false;
    for (const seed of seeds) {
      if (!byId.has(seed.id)) {
        data.supportFaqs.push({ ...seed, enabled: true, createdAt: now, updatedAt: now });
        changed = true;
      }
    }
    if (changed) persist(data);
    return data.supportFaqs;
  }

  function localFaqNorm(text) {
    return String(text || '')
      .toLowerCase()
      .normalize('NFD')
      .replace(/[\u0300-\u036f]/g, '')
      .replace(/[^a-z0-9\s]/g, ' ')
      .replace(/\s+/g, ' ')
      .trim();
  }

  const LOCAL_FAQ_MATCH_THRESHOLD = 2.5;
  const LOCAL_FAQ_SUGGESTION_MIN = 0.8;
  const LOCAL_FAQ_SUGGESTION_MAX = 4;
  const LOCAL_FAQ_CONFIDENT_SCORE = 18;
  const LOCAL_FAQ_CONFIDENT_GAP = 5;
  const LOCAL_FAQ_STOP = new Set([
    'a', 'o', 'os', 'as', 'de', 'da', 'do', 'das', 'dos', 'e', 'ou', 'um', 'uma',
    'para', 'por', 'com', 'no', 'na', 'nos', 'nas', 'em', 'que', 'como', 'qual',
    'quais', 'meu', 'minha', 'seu', 'sua'
  ]);

  function localFaqTokenize(text) {
    return localFaqNorm(text)
      .split(' ')
      .filter((w) => w.length > 2 && !LOCAL_FAQ_STOP.has(w));
  }

  function scoreLocalFaq(faq, queryNorm, queryTokens) {
    const q = localFaqNorm(faq.question);
    const ans = localFaqNorm(faq.answer);
    const keywords = (faq.keywords || []).map(localFaqNorm);
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

    const qTokens = localFaqTokenize(faq.question);
    for (const t of queryTokens) {
      if (qTokens.includes(t)) score += 1.2;
      if (ans.includes(t)) score += 0.25;
    }

    return score;
  }

  function rankLocalFaqs(faqs, queryNorm, queryTokens) {
    return faqs
      .map((faq) => ({ faq, score: scoreLocalFaq(faq, queryNorm, queryTokens) }))
      .sort((a, b) => b.score - a.score);
  }

  function buildLocalFaqSuggestions(ranked, { excludeId = null, minScore = LOCAL_FAQ_SUGGESTION_MIN } = {}) {
    const out = [];
    const seen = new Set();
    for (const row of ranked) {
      if (row.score < minScore) continue;
      if (excludeId && row.faq.id === excludeId) continue;
      if (seen.has(row.faq.id)) continue;
      seen.add(row.faq.id);
      out.push({
        id: row.faq.id,
        question: row.faq.question,
        score: Number(row.score.toFixed(2))
      });
      if (out.length >= LOCAL_FAQ_SUGGESTION_MAX) break;
    }
    return out;
  }

  function evaluateLocalFaqQuery(ranked, matchThreshold, { queryTokens = [] } = {}) {
    const best = ranked[0];
    if (!best || best.score < LOCAL_FAQ_SUGGESTION_MIN) {
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
    const candidates = ranked.filter((row) => row.score >= LOCAL_FAQ_SUGGESTION_MIN);
    const shortQuery = queryTokens.length > 0 && queryTokens.length <= 2;

    let confident = false;
    if (best.score >= matchThreshold) {
      if (best.score >= LOCAL_FAQ_CONFIDENT_SCORE) {
        confident = true;
      } else if (shortQuery && candidates.length >= 2) {
        confident = false;
      } else if (candidates.length === 1) {
        confident = true;
      } else if (!shortQuery && gap >= 2.5) {
        confident = true;
      } else if (gap >= LOCAL_FAQ_CONFIDENT_GAP) {
        confident = true;
      }
    }

    if (confident) {
      return {
        matched: true,
        partialMatch: false,
        best,
        score: Number(best.score.toFixed(2)),
        suggestions: buildLocalFaqSuggestions(ranked, {
          excludeId: best.faq.id,
          minScore: 1
        })
      };
    }

    const suggestions = buildLocalFaqSuggestions(ranked, {
      excludeId: null,
      minScore: LOCAL_FAQ_SUGGESTION_MIN
    });
    return {
      matched: false,
      partialMatch: suggestions.length > 0,
      best: null,
      score: 0,
      suggestions
    };
  }

  async function listSupportFaqs(opts = {}, actor = null) {
    if (useHttp()) return CSHttpApi.listSupportFaqs(opts);
    await delay();
    const a = resolveActor(actor !== null ? actor : {});
    const data = store();
    let list = [...ensureLocalSupportFaqs(data)];
    if (a.role === 'superadmin') {
      if (!opts.all) list = list.filter((f) => f.enabled !== false);
    } else if (a.role === 'admin_empresa' || a.role === 'apurador') {
      list = list.filter((f) => {
        if (f.enabled === false) return false;
        const aud = f.audience || ['all'];
        return aud.includes('all') || aud.includes(a.role);
      });
    } else throw new Error('Acesso negado.');
    list.sort((x, y) => (x.sortOrder || 0) - (y.sortOrder || 0));
    return { faqs: list };
  }

  async function askSupportFaq(query, actor = null) {
    if (useHttp()) return CSHttpApi.askSupportFaq(query);
    await delay();
    const a = resolveActor(actor !== null ? actor : {});
    const q = String(query || '').trim();
    if (!q) throw new Error('Digite sua pergunta.');
    const data = store();
    const role = a.role === 'superadmin' ? 'admin_empresa' : a.role;
    const faqs = ensureLocalSupportFaqs(data).filter((f) => {
      if (f.enabled === false) return false;
      const aud = f.audience || ['all'];
      if (role === 'public') return aud.includes('public');
      return aud.includes('all') || aud.includes(role);
    });
    const qn = localFaqNorm(q);
    const tokens = localFaqTokenize(q);
    const ranked = rankLocalFaqs(faqs, qn, tokens);
    const evalResult = evaluateLocalFaqQuery(ranked, LOCAL_FAQ_MATCH_THRESHOLD, {
      queryTokens: tokens
    });
    return {
      matched: evalResult.matched,
      partialMatch: evalResult.partialMatch,
      score: evalResult.score,
      faq: evalResult.best ? evalResult.best.faq : null,
      suggestions: evalResult.suggestions,
      escalateHint:
        'Se a resposta não resolver, envie uma mensagem à plataforma (prazo de até 24h).'
    };
  }

  const PUBLIC_CONFIDENTIAL_REFUSAL =
    'Por política de privacidade e confidencialidade do canal, não posso informar, confirmar nem comentar dados pessoais, identidade de denunciantes, conteúdo de relatos ou qualquer informação confidencial de usuários. Use apenas as orientações gerais deste assistente ou a consulta com o seu próprio protocolo e código.';

  function isPublicConfidentialQuery(qn) {
    const patterns = [
      /\b(cpf|rg|nome completo|dados pessoais|identidade)\b.{0,40}\b(de|do|da|dos|das)\b/,
      /\b(quem|qual)\b.{0,30}\b(denunciou|denunciante|relatou|fez o relato|fez a denuncia)\b/,
      /\b(me diga|informe|mostrar|revelar|listar|buscar)\b.{0,40}\b(nome|cpf|email|telefone|identidade|denunciante)\b/,
      /\b(dados|informacoes|info)\b.{0,30}\b(do usuario|da pessoa|do colaborador|do denunciante|de fulano)\b/,
      /\b(protocolo|codigo)\b.{0,40}\b(de outra pessoa|de um colega|de fulano|de alguem)\b/,
      /\b(existe relato|tem denuncia|houve denuncia)\b.{0,40}\b(sobre|contra|de)\b/,
      /\b(vazamento|vazar|compartilhar)\b.{0,30}\b(dados|relato|protocolo|identidade)\b/
    ];
    return patterns.some((re) => re.test(qn));
  }

  async function askPublicSupportFaq(query) {
    if (useHttp()) return CSHttpApi.askPublicSupportFaq(query);
    await delay();
    const q = String(query || '').trim();
    if (!q) throw new Error('Digite sua pergunta.');
    const qn = localFaqNorm(q);
    if (isPublicConfidentialQuery(qn)) {
      return {
        matched: false,
        confidential: true,
        score: 0,
        faq: null,
        answer: PUBLIC_CONFIDENTIAL_REFUSAL,
        suggestions: [],
        escalateHint:
          'Para dúvidas gerais sobre o uso do canal (sem dados confidenciais), use Fale conosco na página inicial.'
      };
    }
    const data = store();
    const faqs = ensureLocalSupportFaqs(data).filter((f) => {
      if (f.enabled === false) return false;
      return (f.audience || []).includes('public');
    });
    const tokens = localFaqTokenize(q);
    const ranked = rankLocalFaqs(faqs, qn, tokens);
    const publicThreshold = Math.max(LOCAL_FAQ_MATCH_THRESHOLD, 6);
    const evalResult = evaluateLocalFaqQuery(ranked, publicThreshold, {
      queryTokens: tokens
    });
    return {
      matched: evalResult.matched,
      partialMatch: evalResult.partialMatch,
      confidential: false,
      score: evalResult.score,
      faq: evalResult.best ? evalResult.best.faq : null,
      answer: evalResult.best ? evalResult.best.faq.answer : null,
      suggestions: evalResult.suggestions,
      escalateHint:
        'Se precisar de orientação geral, use Fale conosco. Para denúncias, use Fazer uma denúncia. Não solicitamos nem revelamos dados confidenciais por este assistente.'
    };
  }

  async function createSupportFaq(payload = {}, actor = null) {
    if (useHttp()) return CSHttpApi.createSupportFaq(payload);
    await delay();
    const a = assertSuperadmin(resolveActor(actor));
    const question = String(payload.question || '').trim();
    const answer = String(payload.answer || '').trim();
    if (!question || !answer) throw new Error('Informe pergunta e resposta.');
    const data = store();
    ensureLocalSupportFaqs(data);
    const now = new Date().toISOString();
    const faq = {
      id: uid('faq'),
      question,
      answer,
      keywords: String(payload.keywords || '')
        .split(/[,;\n]/)
        .map((s) => s.trim())
        .filter(Boolean),
      audience: Array.isArray(payload.audience) ? payload.audience : ['all'],
      enabled: payload.enabled !== false,
      sortOrder: Number(payload.sortOrder) || 100,
      createdAt: now,
      updatedAt: now,
      updatedByName: a.nome || a.email
    };
    data.supportFaqs.push(faq);
    persist(data);
    return faq;
  }

  async function updateSupportFaq(faqId, payload = {}, actor = null) {
    if (useHttp()) return CSHttpApi.updateSupportFaq(faqId, payload);
    await delay();
    assertSuperadmin(resolveActor(actor));
    const data = store();
    const idx = ensureLocalSupportFaqs(data).findIndex((f) => f.id === faqId);
    if (idx < 0) throw new Error('FAQ não encontrada.');
    const prev = data.supportFaqs[idx];
    data.supportFaqs[idx] = {
      ...prev,
      ...payload,
      id: prev.id,
      question: payload.question != null ? String(payload.question).trim() : prev.question,
      answer: payload.answer != null ? String(payload.answer).trim() : prev.answer,
      keywords:
        payload.keywords != null
          ? Array.isArray(payload.keywords)
            ? payload.keywords
            : String(payload.keywords)
                .split(/[,;\n]/)
                .map((s) => s.trim())
                .filter(Boolean)
          : prev.keywords,
      updatedAt: new Date().toISOString()
    };
    persist(data);
    return data.supportFaqs[idx];
  }

  async function deleteSupportFaq(faqId, actor = null) {
    if (useHttp()) return CSHttpApi.deleteSupportFaq(faqId);
    await delay();
    assertSuperadmin(resolveActor(actor));
    const data = store();
    const idx = ensureLocalSupportFaqs(data).findIndex((f) => f.id === faqId);
    if (idx < 0) throw new Error('FAQ não encontrada.');
    data.supportFaqs.splice(idx, 1);
    persist(data);
    return { id: faqId };
  }

  function fileToBase64(file) {
    return new Promise((resolve, reject) => {
      const reader = new FileReader();
      reader.onload = () => {
        const result = String(reader.result || '');
        const idx = result.indexOf(',');
        resolve(idx >= 0 ? result.slice(idx + 1) : result);
      };
      reader.onerror = () => reject(new Error('Falha ao ler o arquivo.'));
      reader.readAsDataURL(file);
    });
  }

  /**
   * Upload pós-criação. HTTP: POST .../attachments (base64).
   * Protótipo: mantém mensagem clara (sem storage binário local).
   */
  async function uploadReportAttachment(reportId, files, actor = {}, options = {}) {
    const list = Array.isArray(files) ? [...files] : files ? [files] : [];
    if (!list.length) throw new Error('Nenhum arquivo selecionado.');
    const currentCount = Number(options.currentCount) || 0;

    if (useHttp()) {
      const results = [];
      for (const file of list) {
        if (typeof CSAttachments !== 'undefined') {
          const err = CSAttachments.validateFile(file, currentCount + results.length);
          if (err) throw new Error(err);
        }
        const dataBase64 = await fileToBase64(file);
        let inferredMime = file.type || 'application/octet-stream';
        if (
          (!inferredMime || inferredMime === 'application/octet-stream') &&
          typeof CSAttachments !== 'undefined'
        ) {
          inferredMime = CSAttachments.createPendingMetadata(file).mimeType;
        }
        try {
          const res = await CSHttpApi.uploadAttachment(reportId, {
            name: file.name,
            mimeType: inferredMime,
            dataBase64
          });
          results.push(res.attachment || res);
        } catch (ex) {
          const msg = ex?.message || String(ex);
          if (/quota|esgotad/i.test(msg)) {
            throw new Error(msg);
          }
          if (/tamanho|máximo|image|document|tipo|MIME|anexos/i.test(msg)) {
            throw new Error(msg);
          }
          throw ex;
        }
      }
      return results;
    }

    await delay();
    const report = (store().reports || []).find((r) => r.id === reportId);
    assertReportAttachmentAccess(report, actor);
    throw new Error(
      'Upload de anexos exige API no servidor. No modo protótipo local apenas metadados são gravados no relato público.'
    );
  }

  /** Futuro: DELETE com autorização e auditoria no servidor. */
  async function removeReportAttachment(attachmentId, actor = {}) {
    await delay();
    const data = store();
    const { report, attachment } = findAttachmentInStore(data, attachmentId);
    if (!report || !attachment) throw new Error('Anexo não encontrado.');
    assertReportAttachmentAccess(report, actor);
    throw new Error('Remoção de anexos exige storage privado no servidor (não disponível no protótipo).');
  }

  function assertNewPassword(password, label = 'Senha') {
    if (typeof CSPasswordStrength !== 'undefined' && CSPasswordStrength.validate) {
      const err = CSPasswordStrength.validate(password, label);
      if (err) throw new Error(err);
      return;
    }
    if (typeof CSValidation !== 'undefined' && CSValidation.strongPassword) {
      const err = CSValidation.strongPassword(password, label);
      if (err) throw new Error(err);
    }
  }

  async function getUsers(filters = {}, actor = null) {
    if (useHttp()) return CSHttpApi.getUsers(scopeFilters(filters, actor));
    await delay();
    const scoped = scopeFilters(filters, actor);
    let list = store().users.map(({ senha, ...u }) => u);
    if (scoped.companyId !== undefined) {
      list = list.filter((u) => u.companyId === scoped.companyId);
    }
    if (scoped.role) list = list.filter((u) => u.role === scoped.role);
    return list;
  }

  async function getUser(id, actor = null) {
    if (useHttp()) return CSHttpApi.getUser(id);
    await delay();
    const u = store().users.find((x) => x.id === id);
    if (!u) return null;
    const a = resolveActor(actor !== null ? actor : {});
    if (a.id && u.companyId) assertCompanyScope(u.companyId, a);
    const { senha, ...safe } = u;
    return safe;
  }

  function normalizeUserCpf(value) {
    if (typeof CSValidation !== 'undefined' && CSValidation.normalizeCpf) {
      return CSValidation.normalizeCpf(value);
    }
    return String(value || '').replace(/\D/g, '');
  }

  function assertOptionalUserContact({ cpf, telefone }, { excludeUserId } = {}) {
    const cpfDigits = normalizeUserCpf(cpf);
    if (cpfDigits) {
      if (typeof CSValidation !== 'undefined' && CSValidation.cpf) {
        const err = CSValidation.cpf(cpfDigits);
        if (err) throw new Error(err);
      } else if (cpfDigits.length !== 11) {
        throw new Error('CPF deve conter 11 dígitos.');
      }
      const dup = store().users.find(
        (u) =>
          u.id !== excludeUserId &&
          normalizeUserCpf(u.cpf) === cpfDigits
      );
      if (dup) throw new Error('Este CPF já está cadastrado para outro usuário.');
    }
    if (telefone && typeof CSValidation !== 'undefined' && CSValidation.phone) {
      const err = CSValidation.phone(telefone, 'Tel/WhatsApp');
      if (err) throw new Error(err);
    }
    return {
      cpf: cpfDigits || null,
      telefone: String(telefone || '').trim() || null
    };
  }

  function assertCanManageUser(actorInput, target, options = {}) {
    const a = resolveActor(actorInput);
    const { creating = false, nextRole, nextCompanyId } = options;
    if (!a || !a.id) throw new Error('Não autenticado.');
    if (a.role === 'superadmin') return a;
    if (a.role !== 'admin_empresa') {
      throw new Error('Operação restrita ao Adm_Empresa ou Adm_Plataforma.');
    }
    if (!a.companyId) throw new Error('Sem empresa vinculada.');
    if (creating) {
      if (nextRole && nextRole !== 'apurador' && nextRole !== 'admin_empresa') {
        throw new Error('Adm_Empresa só pode cadastrar Adm_Empresa ou Apurador da própria empresa.');
      }
      return a;
    }
    if (!target) throw new Error('Usuário não encontrado');
    if (isProtectedUser(target)) {
      throw new Error('Não é permitido alterar o administrador protegido da plataforma.');
    }
    if (target.companyId !== a.companyId) {
      throw new Error('Acesso não autorizado a usuários de outra empresa.');
    }
    const isSelf = target.id === a.id;
    if (!isSelf && target.role !== 'apurador' && target.role !== 'admin_empresa') {
      throw new Error('Adm_Empresa só pode alterar a própria conta e usuários Adm_Empresa/Apurador da empresa.');
    }
    if (nextRole === 'superadmin') {
      throw new Error('Não é permitido atribuir perfil Adm_Plataforma.');
    }
    if (isSelf && nextRole && nextRole !== 'admin_empresa') {
      throw new Error('Você não pode alterar o próprio perfil.');
    }
    if (!isSelf && nextRole && nextRole !== 'apurador' && nextRole !== 'admin_empresa') {
      throw new Error('Adm_Empresa só pode atribuir perfil Adm_Empresa ou Apurador.');
    }
    if (nextCompanyId && nextCompanyId !== a.companyId) {
      throw new Error('Não é permitido transferir usuário para outra empresa.');
    }
    return a;
  }

  async function createUser(payload, actor = null) {
    if (useHttp()) {
      const { _actorId, _actorName, senha, ...rest } = payload || {};
      const body = { ...rest };
      if (senha) body.password = senha;
      if (!body.status) body.status = 'ativo';
      return CSHttpApi.createUser(body);
    }
    await delay();
    const actorResolved = resolveActor(actor !== null ? actor : {});
    const requestedRole = payload.role || 'admin_empresa';
    const a = assertCanManageUser(actorResolved, null, {
      creating: true,
      nextRole: requestedRole
    });
    if (payload.senha) assertNewPassword(payload.senha);
    const contact = assertOptionalUserContact(payload);
    const data = store();
    const { _actorId, _actorName, cpf, telefone, ...rest } = payload;
    const username = String(rest.username || '').trim();
    if (!username || !String(rest.nome || '').trim()) {
      throw new Error('Nome e usuário (login) são obrigatórios.');
    }
    if ((data.users || []).some((u) => u.username && u.username.toLowerCase() === username.toLowerCase())) {
      throw new Error('Usuário (login) já cadastrado.');
    }
    if (a.role === 'admin_empresa') {
      rest.role = requestedRole === 'admin_empresa' ? 'admin_empresa' : 'apurador';
      rest.companyId = a.companyId;
    }
    if (rest.role === 'superadmin') {
      throw new Error('Não é permitido atribuir perfil Adm_Plataforma por esta operação.');
    }
    const user = {
      id: uid('usr'),
      status: 'ativo',
      ...rest,
      username,
      cpf: contact.cpf,
      telefone: contact.telefone
    };
    delete user._actorId;
    delete user._actorName;
    data.users.push(user);
    audit(data, {
      userId: a.id || _actorId || 'system',
      userName: a.nome || _actorName || 'Sistema',
      action: 'criacao_usuario',
      resourceType: 'user',
      resourceId: user.id,
      companyId: user.companyId,
      newValue: {
        role: user.role,
        status: user.status,
        username: user.username,
        hasCpf: !!user.cpf,
        hasTelefone: !!user.telefone
      }
    });
    if (typeof CSInfraLog !== 'undefined') {
      CSInfraLog.security('permissao_alterada', {
        severity: 'info',
        outcome: 'success',
        actor: { id: a.id || _actorId, nome: a.nome || _actorName },
        context: { userId: user.id, newRole: user.role, action: 'create' }
      });
    }
    persist(data);
    const { senha, ...safe } = user;
    return safe;
  }

  async function updateUser(id, payload, actor = null) {
    if (useHttp()) {
      const { _actorId, _actorName, senha, ...rest } = payload || {};
      const body = { ...rest };
      if (senha) body.password = senha;
      return CSHttpApi.updateUser(id, body);
    }
    await delay();
    const actorResolved = resolveActor(actor !== null ? actor : {});
    const data = store();
    const idx = data.users.findIndex((u) => u.id === id);
    if (idx < 0) throw new Error('Usuário não encontrado');
    const previous = data.users[idx];
    const a = assertCanManageUser(actorResolved, previous, {
      nextRole: payload.role !== undefined ? payload.role : previous.role,
      nextCompanyId:
        payload.companyId !== undefined ? payload.companyId || null : previous.companyId
    });
    if (isProtectedUser(previous)) {
      if (payload.role !== undefined && payload.role !== previous.role) {
        throw new Error('Não é permitido alterar o perfil do administrador protegido da plataforma.');
      }
      if (payload.status !== undefined && payload.status !== 'ativo') {
        throw new Error('Não é permitido desativar o administrador protegido da plataforma.');
      }
      if (
        payload.email !== undefined &&
        normalizeEmail(payload.email) !== PROTECTED_PLATFORM_EMAIL
      ) {
        throw new Error('Não é permitido alterar o e-mail do administrador protegido da plataforma.');
      }
    }
    const { _actorId, _actorName, ...rest } = payload;
    if (payload.username !== undefined) {
      const nextUsername = String(payload.username || '').trim();
      if (!nextUsername) throw new Error('Usuário (login) é obrigatório.');
      const dup = (data.users || []).some(
        (u) =>
          u.id !== id &&
          u.username &&
          u.username.toLowerCase() === nextUsername.toLowerCase()
      );
      if (dup) throw new Error('Usuário (login) já cadastrado.');
      rest.username = nextUsername;
    }
    if (payload.senha !== undefined && payload.senha !== previous.senha) {
      assertNewPassword(payload.senha);
    }
    if (a.role === 'admin_empresa') {
      rest.companyId = a.companyId;
      if (previous.id === a.id) {
        rest.role = 'admin_empresa';
      } else if (rest.role !== undefined) {
        rest.role = rest.role === 'admin_empresa' ? 'admin_empresa' : 'apurador';
      }
    }
    const contact =
      payload.cpf !== undefined || payload.telefone !== undefined
        ? assertOptionalUserContact(
            {
              cpf: payload.cpf !== undefined ? payload.cpf : previous.cpf,
              telefone: payload.telefone !== undefined ? payload.telefone : previous.telefone
            },
            { excludeUserId: id }
          )
        : null;
    data.users[idx] = {
      ...previous,
      ...rest,
      id,
      ...(contact
        ? { cpf: contact.cpf, telefone: contact.telefone }
        : {})
    };
    delete data.users[idx]._actorId;
    delete data.users[idx]._actorName;
    const updated = data.users[idx];
    const auditNewValue = {
      nome: updated.nome,
      username: updated.username,
      role: updated.role,
      status: updated.status,
      email: updated.email,
      hasCpf: !!updated.cpf,
      hasTelefone: !!updated.telefone
    };
    if (payload.senha !== undefined && payload.senha !== previous.senha) {
      auditNewValue.senhaAlterada = true;
    }
    if (previous.username !== updated.username) {
      auditNewValue.loginAlterado = true;
    }
    audit(data, {
      userId: a.id || _actorId || 'system',
      userName: a.nome || _actorName || 'Sistema',
      action: 'edicao_usuario',
      resourceType: 'user',
      resourceId: id,
      companyId: updated.companyId,
      previousValue: {
        nome: previous.nome,
        username: previous.username,
        role: previous.role,
        status: previous.status,
        email: previous.email
      },
      newValue: auditNewValue
    });
    if (typeof CSInfraLog !== 'undefined' && (payload.role || payload.status)) {
      CSInfraLog.security('permissao_alterada', {
        severity: 'info',
        outcome: 'success',
        actor: { id: a.id || _actorId, nome: a.nome || _actorName },
        context: {
          userId: id,
          previousRole: previous.role,
          newRole: updated.role,
          previousStatus: previous.status,
          newStatus: updated.status
        }
      });
    }
    persist(data);
    const { senha, ...safe } = data.users[idx];
    return safe;
  }

  async function deleteUser(id, actor = {}) {
    const a = assertSuperadmin(actor);
    if (useHttp()) {
      try {
        await CSHttpApi.deleteUser(id);
      } catch (err) {
        if (!(err && err.status === 404)) throw err;
      }
    }
    await delay();
    const data = store();
    const idx = (data.users || []).findIndex((u) => u.id === id);
    if (idx < 0) {
      if (useHttp()) return { ok: true };
      throw new Error('Usuário não encontrado');
    }
    const user = data.users[idx];
    assertNotProtectedUser(user, 'excluir');
    if (a.id && a.id === user.id) {
      throw new Error('Você não pode excluir a própria conta em uso.');
    }
    data.users.splice(idx, 1);
    audit(data, {
      userId: a.id || 'system',
      userName: a.nome || 'Sistema',
      action: 'exclusao_usuario',
      resourceType: 'user',
      resourceId: id,
      companyId: user.companyId || null,
      previousValue: {
        nome: user.nome,
        username: user.username,
        email: user.email,
        role: user.role
      }
    });
    persist(data);
    return { ok: true };
  }

  async function updateMyAccount(sessionUserId, payload) {
    await delay();
    const data = store();
    const idx = data.users.findIndex((u) => u.id === sessionUserId);
    if (idx < 0) throw new Error('Usuário não encontrado');
    const previous = data.users[idx];
    if (payload.senhaAtual && previous.senha !== payload.senhaAtual) {
      throw new Error('Senha atual incorreta.');
    }
    if (payload.novaSenha) assertNewPassword(payload.novaSenha, 'Nova senha');
    if (payload.nome) data.users[idx].nome = payload.nome.trim();
    if (payload.username) {
      const nextUsername = String(payload.username || '').trim();
      if (!nextUsername) throw new Error('Usuário (login) é obrigatório.');
      const dup = (data.users || []).some(
        (u) =>
          u.id !== sessionUserId &&
          u.username &&
          u.username.toLowerCase() === nextUsername.toLowerCase()
      );
      if (dup) throw new Error('Usuário (login) já cadastrado.');
      data.users[idx].username = nextUsername;
    }
    if (payload.novaSenha) data.users[idx].senha = payload.novaSenha;
    if (payload.email !== undefined) data.users[idx].email = payload.email.trim();
    if (payload.cpf !== undefined || payload.telefone !== undefined) {
      const contact = assertOptionalUserContact(
        {
          cpf: payload.cpf !== undefined ? payload.cpf : previous.cpf,
          telefone: payload.telefone !== undefined ? payload.telefone : previous.telefone
        },
        { excludeUserId: sessionUserId }
      );
      data.users[idx].cpf = contact.cpf;
      data.users[idx].telefone = contact.telefone;
    }
    const updated = data.users[idx];
    const changes = {};
    if (payload.nome) changes.nome = updated.nome;
    if (payload.username) {
      changes.username = updated.username;
      if (previous.username !== updated.username) changes.loginAlterado = true;
    }
    if (payload.novaSenha) changes.senhaAlterada = true;
    if (payload.email !== undefined) changes.email = updated.email;
    if (payload.cpf !== undefined) changes.hasCpf = !!updated.cpf;
    if (payload.telefone !== undefined) changes.hasTelefone = !!updated.telefone;
    audit(data, {
      userId: sessionUserId,
      userName: updated.nome,
      action: 'edicao_conta_propria',
      resourceType: 'user',
      resourceId: sessionUserId,
      companyId: updated.companyId,
      previousValue: {
        nome: previous.nome,
        username: previous.username,
        email: previous.email
      },
      newValue: changes
    });
    persist(data);
    const { senha, ...safe } = data.users[idx];
    return safe;
  }

  /* ---------- Contents ---------- */
  async function getContents(filters = {}) {
    if (useHttp()) return CSHttpApi.getContents(filters);
    await delay();
    let list = [...store().contents];
    if (filters.companyId) {
      list = list.filter((c) => !c.companyId || c.companyId === filters.companyId);
    }
    if (filters.type) list = list.filter((c) => c.type === filters.type);
    if (filters.globalOnly) list = list.filter((c) => !c.companyId);
    if (filters.status) list = list.filter((c) => c.status === filters.status);
    list.sort((a, b) => {
      const ao = Number.isFinite(a.sortOrder) ? a.sortOrder : 9999;
      const bo = Number.isFinite(b.sortOrder) ? b.sortOrder : 9999;
      if (ao !== bo) return ao - bo;
      return String(a.title || '').localeCompare(String(b.title || ''), 'pt-BR');
    });
    return list;
  }

  async function createContent(payload) {
    if (useHttp()) {
      const { _actorId, _actorName, ...body } = payload || {};
      return CSHttpApi.createContent(body);
    }
    await delay();
    const a = resolveActor(payload);
    if (payload.companyId) assertCompanyScope(payload.companyId, a);
    else assertSuperadmin(a);
    const data = store();
    const content = {
      id: uid('cnt'),
      status: 'publicado',
      slug: payload.slug || null,
      sortOrder: Number.isFinite(Number(payload.sortOrder)) ? Number(payload.sortOrder) : null,
      createdAt: new Date().toISOString(),
      ...payload
    };
    if (content.sortOrder != null) content.sortOrder = Number(content.sortOrder);
    data.contents.push(content);
    audit(data, {
      ...auditActor(payload),
      action: 'criacao_conteudo',
      resourceType: 'content',
      resourceId: content.id,
      companyId: content.companyId || null,
      newValue: { type: content.type, title: content.title, status: content.status }
    });
    persist(data);
    return content;
  }

  async function updateContent(id, payload) {
    if (useHttp()) {
      const { _actorId, _actorName, ...body } = payload || {};
      return CSHttpApi.updateContent(id, body);
    }
    await delay();
    const data = store();
    const idx = data.contents.findIndex((c) => c.id === id);
    if (idx < 0) throw new Error('Conteúdo não encontrado');
    const previous = data.contents[idx];
    const a = resolveActor(payload);
    if (previous.companyId) assertCompanyScope(previous.companyId, a);
    else assertSuperadmin(a);
    if (payload.companyId !== undefined && payload.companyId !== previous.companyId) {
      if (payload.companyId) assertCompanyScope(payload.companyId, a);
      else assertSuperadmin(a);
    }
    data.contents[idx] = { ...previous, ...payload, id };
    const updated = data.contents[idx];
    if (updated.sortOrder != null && updated.sortOrder !== '') {
      updated.sortOrder = Number(updated.sortOrder);
    } else if (payload.sortOrder === '' || payload.sortOrder === null) {
      updated.sortOrder = null;
    }
    if (payload.slug !== undefined) {
      updated.slug = payload.slug ? String(payload.slug).trim() : null;
    }
    audit(data, {
      ...auditActor(payload),
      action: 'edicao_conteudo',
      resourceType: 'content',
      resourceId: id,
      companyId: updated.companyId || null,
      previousValue: { type: previous.type, title: previous.title, status: previous.status },
      newValue: { type: updated.type, title: updated.title, status: updated.status }
    });
    persist(data);
    return data.contents[idx];
  }

  async function deleteContent(id, actorPayload = {}) {
    if (useHttp()) return CSHttpApi.deleteContent(id);
    await delay();
    const data = store();
    const idx = data.contents.findIndex((c) => c.id === id);
    if (idx < 0) throw new Error('Conteúdo não encontrado');
    const previous = data.contents[idx];
    const a = resolveActor(actorPayload);
    if (previous.companyId) assertCompanyScope(previous.companyId, a);
    else assertSuperadmin(a);
    data.contents.splice(idx, 1);
    audit(data, {
      ...auditActor(actorPayload),
      action: 'exclusao_conteudo',
      resourceType: 'content',
      resourceId: id,
      companyId: previous.companyId || null,
      previousValue: { type: previous.type, title: previous.title, status: previous.status }
    });
    persist(data);
    return { id, deleted: true };
  }

  /* ---------- Notifications / Audit / Reports gen ---------- */
  async function getNotifications(filters = {}) {
    await delay();
    let list = [...(store().notifications || [])];
    if (filters.companyId) {
      list = list.filter((n) => {
        if (n.role === 'superadmin') return false;
        return n.companyId === filters.companyId;
      });
    }
    return list.sort((a, b) => (a.createdAt < b.createdAt ? 1 : -1));
  }

  async function markNotificationRead(notificationId) {
    await delay();
    const data = store();
    const item = (data.notifications || []).find((n) => n.id === notificationId);
    if (!item) return { ok: false };
    item.read = true;
    item.readAt = new Date().toISOString();
    persist(data);
    return { ok: true };
  }

  async function markNotificationsRead(ids = []) {
    await delay();
    const data = store();
    const now = new Date().toISOString();
    const idSet = new Set((ids || []).filter(Boolean));
    let count = 0;
    (data.notifications || []).forEach((n) => {
      if (!idSet.has(n.id) || n.read) return;
      n.read = true;
      n.readAt = now;
      count += 1;
    });
    if (count) persist(data);
    return { ok: true, count };
  }

  async function getAuditLogs(filters = {}, actor = null) {
    await delay();
    const scoped = scopeFilters(filters, actor);
    let list = [...store().auditLogs];
    if (scoped.companyId) list = list.filter((a) => a.companyId === scoped.companyId);
    return list.sort((a, b) => (a.date < b.date ? 1 : -1));
  }

  async function deleteAccessLog(logId, actor = {}) {
    const a = resolveActor(actor);
    if (a.role !== 'superadmin' && a.role !== 'admin_empresa') {
      throw new Error('Acesso negado.');
    }
    if (useHttp()) {
      try {
        await CSHttpApi.deleteAccessLog(logId);
      } catch (err) {
        if (!(err && err.status === 404)) throw err;
      }
    }
    await delay();
    const data = store();
    const idx = (data.auditLogs || []).findIndex((l) => l.id === logId);
    if (idx < 0) {
      if (useHttp()) return { ok: true };
      throw new Error('Registro de acesso não encontrado');
    }
    const log = data.auditLogs[idx];
    if (log.action !== 'login' && log.action !== 'logout') {
      throw new Error('Somente registros de login/logout podem ser excluídos nesta tela.');
    }
    if (a.role !== 'superadmin') {
      assertCompanyScope(log.companyId, a);
    }
    data.auditLogs.splice(idx, 1);
    audit(data, {
      userId: a.id || 'system',
      userName: a.nome || 'Sistema',
      action: 'exclusao_acesso',
      resourceType: 'access_log',
      resourceId: logId,
      companyId: log.companyId || a.companyId || null,
      previousValue: { action: log.action, userId: log.userId, date: log.date }
    });
    persist(data);
    return { ok: true };
  }

  async function getTechLogs(filters = {}, actor = null) {
    await delay();
    assertSuperadmin(actor !== null ? actor : resolveActor({}));
    if (typeof CSInfraLog === 'undefined') return [];
    return CSInfraLog.query(filters);
  }

  async function getInfraLogPolicy() {
    await delay();
    if (typeof CSInfraLog === 'undefined') return null;
    return CSInfraLog.getPolicy();
  }

  async function generateReport(filters = {}, actor = null) {
    await delay(300);
    const scoped = scopeFilters(filters, actor);
    const reports = await getReports(scoped, actor);
    return {
      generatedAt: new Date().toISOString(),
      filters: scoped,
      total: reports.length,
      rows: reports.map((r) => ({
        protocol: r.protocol,
        registeredAt: r.createdAt,
        occurrenceAt: r.dateApprox || '',
        occurrenceTime: r.timeApprox || '',
        date: r.createdAt,
        category: categoryLabel(r.category),
        sector: r.sector,
        anonymous: r.isAnonymous ? 'Anônimo' : 'Identificado',
        status: statusLabel(r.status),
        companyId: r.companyId
      })),
      // Exportações: PDF / Excel / CSV (UI + servidor)
      exportFormatsReady: ['pdf', 'excel', 'csv']
    };
  }

  async function getCategories() {
    if (useHttp()) return CSHttpApi.getCategories();
    return store().categories || window.CSStore.DEMO_CATEGORIES;
  }

  async function getStatuses() {
    if (useHttp()) return CSHttpApi.getStatuses();
    return store().statuses || window.CSStore.DEMO_STATUSES;
  }

  async function getPublicStoragePlans() {
    if (useHttp()) return CSHttpApi.getPublicStoragePlans();
    await delay(20);
    const data = store();
    const catalog = getLocalStoragePlansCatalog(data);
    persist(data);
    const plans = catalog.map((p) => {
      const consult = Boolean(p.consultPricing) || p.priceAmount == null;
      const hidePrice = Boolean(p.hidePriceOnPublic) || consult;
      return {
        id: p.id,
        name: p.name,
        description: p.description || '',
        storageLabel: p.storageLabel,
        storageLimitBytes: p.storageLimitBytes,
        barPercent: p.barPercent || 0,
        billingNote: p.billingNote || 'Contratação anual',
        usersLabel: p.usersLabel || '',
        retentionLabel: p.retentionLabel || '',
        advantages: Array.isArray(p.advantages)
          ? p.advantages
          : defaultLocalPlanAdvantages(p),
        featured: Boolean(p.featured),
        hidePriceOnPublic: Boolean(p.hidePriceOnPublic),
        consultPricing: consult,
        priceLabel: hidePrice ? 'Sob consulta' : p.priceLabel || 'Sob consulta',
        priceSuffix: hidePrice ? '' : p.priceSuffix || '/mês',
        ctaLabel: hidePrice ? 'Falar com especialista' : p.ctaLabel || 'Contratar'
      };
    });
    return {
      plans,
      hideLandingPlans: Boolean(platformSettingsSync(data).hideLandingPlans)
    };
  }

  async function getSettings() {
    return getPlatformSettings();
  }

  async function getDashboardMetrics(companyId = null, actor = null) {
    if (useHttp()) return CSHttpApi.getDashboardMetrics(companyId);
    await delay();
    const a = resolveActor(actor !== null ? actor : {});
    let scopedCompanyId = companyId;
    if (a.id && !isSuperadmin(a)) scopedCompanyId = a.companyId;
    const reports = await getReports(scopedCompanyId ? { companyId: scopedCompanyId } : {}, actor);
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

    const byRisk = { low: 0, moderate: 0, high: 0, critical: 0, unclassified: 0 };
    reports.forEach((r) => {
      if (!r.riskLevel) byRisk.unclassified++;
      else if (byRisk[r.riskLevel] !== undefined) byRisk[r.riskLevel]++;
    });

    const workflowAlerts = {
      noAssignee: 0,
      stalled: 0,
      slaWarning: 0,
      slaOverdue: 0,
      criticalRisk: 0,
      awaitingInfo: 0,
      dueSoon: 0,
      dueOverdue: 0
    };
    {
      const stalledMs = 120 * 60 * 60 * 1000;
      const now = Date.now();
      reports.forEach((r) => {
        if (r.workflowStage === 'concluido') return;
        initLocalWorkflow(r);
        if (!r.assigneeId && LOCAL_WORKFLOW_ORDER.indexOf(r.workflowStage) >= LOCAL_WORKFLOW_ORDER.indexOf('triagem')) {
          workflowAlerts.noAssignee += 1;
        }
        if (r.riskLevel === 'critical') workflowAlerts.criticalRisk += 1;
        if (r.workflowStage === 'aguardando_informacoes') workflowAlerts.awaitingInfo += 1;
        const stageAt = r.workflowStageAt ? new Date(r.workflowStageAt).getTime() : now;
        if (now - stageAt > stalledMs) workflowAlerts.stalled += 1;
      });
    }

    return {
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
    };
  }

  return {
    getCompanies,
    getCompany,
    getCompanyByDomain,
    getPublicCompany,
    createCompany,
    updateCompany,
    getCompanyEmailNotifications,
    updateCompanyEmailNotifications,
    deactivateCompany,
    deleteCompany,
    getEmployees,
    getEmployee,
    validateEmployeeAccess,
    createEmployee,
    updateEmployee,
    deactivateEmployee,
    deleteEmployee,
    getReports,
    getReport,
    getReportPublicStatus,
    getPublicMessages,
    sendPublicMessage,
    getReportMessages,
    sendReportMessage,
    getRiskPolicy,
    getRiskHistory,
    getRiskSuggestion,
    classifyReportRisk,
    getReportWorkflow,
    getReportWorkflowTimeline,
    transitionReportWorkflow,
    updateReportWorkflowMeta,
    createReport,
    updateReportStatus,
    addReportObservation,
    addReportMeasure,
    assignReport,
    createReportHistory,
    getReportHistory,
    getReportAttachments,
    requestAttachmentDownload,
    getStorageUsage,
    updateStorageLimit,
    getStoragePlans,
    contractStoragePlan,
    getStoragePricing,
    updateStoragePricing,
    getStoragePlanCatalog,
    createStoragePlan,
    updateStoragePlan,
    deleteStoragePlan,
    getPlatformStorage,
    updatePlatformStorage,
    getStorageUpgradeRequests,
    resolveStorageUpgradeRequest,
    listPlatformSupport,
    createPlatformSupport,
    getPlatformSupportThread,
    replyPlatformSupport,
    closePlatformSupport,
    markPlatformSupportRead,
    listInternalSupport,
    createInternalSupport,
    getInternalSupportThread,
    replyInternalSupport,
    markInternalSupportRead,
    getInternalSupportMaster,
    submitAssistantFeedback,
    listAssistantFeedback,
    listSupportFaqs,
    askSupportFaq,
    askPublicSupportFaq,
    createSupportFaq,
    updateSupportFaq,
    deleteSupportFaq,
    uploadReportAttachment,
    removeReportAttachment,
    getUsers,
    getUser,
    createUser,
    updateUser,
    deleteUser,
    updateMyAccount,
    getContents,
    createContent,
    updateContent,
    deleteContent,
    getNotifications,
    markNotificationRead,
    markNotificationsRead,
    getAuditLogs,
    deleteAccessLog,
    getTechLogs,
    getInfraLogPolicy,
    generateReport,
    getCategories,
    getStatuses,
    getPublicStoragePlans,
    getPlatformSettings,
    getPublicCommercialContact,
    updateCommercialContact,
    getDatabaseConfig,
    updateDatabaseConfig,
    testDatabaseConnection,
    buildCommercialInterestMessage,
    getUiDefaults,
    updatePlatformUiDefaults,
    updateCompanyUiDefaults,
    updateMyUiDefaults,
    getCompanySettings,
    getSettings,
    getDashboardMetrics,
    categoryLabel,
    statusLabel,
    isProtectedUser,
    PROTECTED_PLATFORM_EMAIL
  };
})();

window.CSApi = CSApi;
