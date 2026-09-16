/**
 * infra-log.js – Logs técnicos e de segurança (Canal Seguro).
 *
 * SEPARADO de CSAudit (auditoria funcional de negócio).
 * Protótipo: techLogs[] no store — espelho para demo; produção: servidor (CS_INFRA_LOG_API_BASE).
 *
 * Ver docs/INFRA-SECURITY-LOGS.md
 */

const CSInfraLog = (() => {
  const RETENTION_MAX = {
    application: 300,
    security: 500,
    database: 200,
    access: 400
  };

  const SENSITIVE_KEYS = new Set([
    'senha',
    'password',
    'token',
    'authorization',
    'trackingCode',
    'tracking_code',
    'cpf',
    'contactEmail',
    'contactPhone',
    'description',
    'involved',
    'witnesses',
    'reporter',
    'stack',
    'stackTrace'
  ]);

  const EVENT_LABELS = {
    erro_aplicacao: 'Erro de aplicação',
    excecao_nao_tratada: 'Exceção não tratada',
    falha_operacao: 'Falha de operação',
    servico_indisponivel: 'Serviço indisponível',
    login_tentativa: 'Tentativa de login',
    login_sucesso: 'Login bem-sucedido (segurança)',
    login_recusado: 'Login recusado',
    logout_seguranca: 'Logout (segurança)',
    acesso_negado: 'Acesso negado',
    acesso_negado_cross_tenant: 'Tentativa cross-tenant',
    permissao_alterada: 'Alteração de permissões',
    consulta_protocolo_falha: 'Consulta pública falhou',
    consulta_protocolo_bloqueio: 'Consulta pública bloqueada',
    download_anexo_rapido: 'Downloads de anexo em sequência',
    persistencia_falhou: 'Falha ao persistir dados',
    store_indisponivel: 'Store indisponível',
    backup_iniciado: 'Backup iniciado',
    backup_concluido: 'Backup concluído',
    backup_falhou: 'Falha no backup',
    backup_export_dev: 'Export snapshot DEV',
    acesso_rota: 'Acesso a rota',
    alerta_seguranca: 'Alerta de segurança'
  };

  const ALERT_RULES = [
    {
      id: 'brute_force_login',
      label: 'Múltiplas tentativas de login recusadas',
      match: (e) => e.category === 'security' && e.event === 'login_recusado',
      windowMs: 15 * 60 * 1000,
      threshold: 5,
      key: (e) => e.context?.emailHash || 'unknown',
      severity: 'critical'
    },
    {
      id: 'protocol_enumeration',
      label: 'Consultas públicas de protocolo excessivas',
      match: (e) =>
        e.category === 'security' &&
        (e.event === 'consulta_protocolo_falha' || e.event === 'consulta_protocolo_bloqueio'),
      windowMs: 15 * 60 * 1000,
      threshold: 5,
      key: () => 'public_consult',
      severity: 'warn'
    },
    {
      id: 'cross_tenant',
      label: 'Tentativas de acesso a outra empresa',
      match: (e) => e.category === 'security' && e.event === 'acesso_negado_cross_tenant',
      windowMs: 60 * 60 * 1000,
      threshold: 3,
      key: (e) => e.actor?.userId || e.context?.sessionKey || 'anon',
      severity: 'critical'
    },
    {
      id: 'attachment_burst',
      label: 'Muitos downloads de anexo em curto período',
      match: (e) => e.category === 'security' && e.event === 'download_anexo_solicitado',
      windowMs: 5 * 60 * 1000,
      threshold: 10,
      key: (e) => e.actor?.userId || 'anon',
      severity: 'warn'
    },
    {
      id: 'permission_changes',
      label: 'Alterações repetidas de permissões',
      match: (e) => e.category === 'security' && e.event === 'permissao_alterada',
      windowMs: 60 * 60 * 1000,
      threshold: 3,
      key: () => 'global',
      severity: 'warn'
    }
  ];

  function uid() {
    return `tlog_${Date.now().toString(36)}_${Math.random().toString(36).slice(2, 7)}`;
  }

  function isBackendConnected() {
    return Boolean(window.CS_INFRA_LOG_API_BASE);
  }

  function hashIdentifier(value) {
    const s = String(value || '').toLowerCase().trim();
    if (!s) return null;
    let h = 0;
    for (let i = 0; i < s.length; i += 1) {
      h = (Math.imul(31, h) + s.charCodeAt(i)) >>> 0;
    }
    return `h_${h.toString(16)}`;
  }

  function sanitize(value, depth = 0) {
    if (value == null || depth > 4) return value;
    if (typeof value === 'string') {
      const t = value.trim();
      if (t.length > 500) return `${t.slice(0, 120)}…[truncated]`;
      return t;
    }
    if (Array.isArray(value)) {
      return value.slice(0, 15).map((item) => sanitize(item, depth + 1));
    }
    if (typeof value !== 'object') return value;
    const out = {};
    Object.keys(value).forEach((key) => {
      if (SENSITIVE_KEYS.has(key)) return;
      out[key] = sanitize(value[key], depth + 1);
    });
    return out;
  }

  function normalizeActor(actor = {}) {
    return sanitize({
      userId: actor.id || actor.userId || null,
      userName: actor.nome || actor.userName || null,
      role: actor.role || null,
      companyId: actor.companyId || null
    });
  }

  function routeContext() {
    if (typeof location === 'undefined') return {};
    return sanitize({
      path: location.pathname || '',
      route: (location.pathname || '').split('/').pop() || 'index.html'
    });
  }

  function trimRetention(data) {
    data.techLogs = data.techLogs || [];
    const byCat = {};
    data.techLogs.forEach((log) => {
      byCat[log.category] = byCat[log.category] || [];
      byCat[log.category].push(log);
    });
    const kept = [];
    Object.keys(byCat).forEach((cat) => {
      const max = RETENTION_MAX[cat] || 200;
      kept.push(...byCat[cat].slice(0, max));
    });
    kept.sort((a, b) => (a.date < b.date ? 1 : -1));
    data.techLogs = kept;
  }

  function evaluateAlerts(newEntry, allLogs) {
    const alerts = [];
    const now = Date.now();
    ALERT_RULES.forEach((rule) => {
      if (!rule.match(newEntry)) return;
      const key = rule.key(newEntry);
      const recent = allLogs.filter((e) => {
        if (!rule.match(e)) return false;
        if (rule.key(e) !== key) return false;
        return now - new Date(e.date).getTime() <= rule.windowMs;
      });
      if (recent.length >= rule.threshold) {
        alerts.push({ ruleId: rule.id, label: rule.label, severity: rule.severity, count: recent.length });
      }
    });
    return alerts;
  }

  function emit(payload) {
    if (!payload || !payload.category || !payload.event) return null;
    if (typeof window.CSStore === 'undefined') return null;

    const data = window.CSStore.loadStore();
    data.techLogs = data.techLogs || [];

    const entry = {
      id: uid(),
      date: new Date().toISOString(),
      category: payload.category,
      event: payload.event,
      severity: payload.severity || 'info',
      outcome: payload.outcome || null,
      actor: normalizeActor(payload.actor),
      context: sanitize({ ...routeContext(), ...(payload.context || {}) }),
      meta: sanitize(payload.meta || {}),
      mode: isBackendConnected() ? 'production' : 'prototype',
      alert: false
    };

    data.techLogs.unshift(entry);
    trimRetention(data);

    const alerts = evaluateAlerts(entry, data.techLogs);
    if (alerts.length) {
      alerts.forEach((a) => {
        data.techLogs.unshift({
          id: uid(),
          date: new Date().toISOString(),
          category: 'security',
          event: 'alerta_seguranca',
          severity: a.severity,
          outcome: 'blocked',
          actor: entry.actor,
          context: sanitize({ ruleId: a.ruleId, ruleLabel: a.label, triggerEvent: entry.event, count: a.count }),
          meta: { automated: true },
          mode: entry.mode,
          alert: true
        });
      });
      trimRetention(data);
    }

    try {
      window.CSStore.saveStore(data);
    } catch (err) {
      if (typeof console !== 'undefined') console.error('[CSInfraLog] Falha ao persistir log', err);
      return entry;
    }

    if (isBackendConnected()) {
      /* Futuro: fetch(CS_INFRA_LOG_API_BASE, { method: 'POST', body: JSON.stringify(entry) }) */
    }

    return entry;
  }

  function application(event, options = {}) {
    return emit({
      category: 'application',
      event,
      severity: options.severity || 'error',
      outcome: options.outcome || 'failure',
      actor: options.actor,
      context: options.context,
      meta: options.meta
    });
  }

  function security(event, options = {}) {
    return emit({
      category: 'security',
      event,
      severity: options.severity || 'warn',
      outcome: options.outcome || 'failure',
      actor: options.actor,
      context: options.context,
      meta: options.meta
    });
  }

  function database(event, options = {}) {
    return emit({
      category: 'database',
      event,
      severity: options.severity || 'error',
      outcome: options.outcome || 'failure',
      actor: options.actor,
      context: options.context,
      meta: options.meta
    });
  }

  function access(event, options = {}) {
    return emit({
      category: 'access',
      event,
      severity: options.severity || 'info',
      outcome: options.outcome || 'success',
      actor: options.actor,
      context: options.context,
      meta: options.meta
    });
  }

  function logError(err, context = '', options = {}) {
    const msg = err?.message || String(err || '');
    return application(options.event || 'erro_aplicacao', {
      severity: options.severity || 'error',
      outcome: 'failure',
      actor: options.actor,
      context: {
        operation: context,
        errorType: err?.name || 'Error',
        message: looksTechnical(msg) ? '[redacted]' : msg.slice(0, 180)
      }
    });
  }

  function looksTechnical(message) {
    const msg = String(message || '');
    return msg.length > 220 || /stack|at\s+\w+|undefined is not|null is not/i.test(msg);
  }

  function query(filters = {}) {
    if (typeof window.CSStore === 'undefined') return [];
    let list = [...(window.CSStore.loadStore().techLogs || [])];
    if (filters.category) list = list.filter((l) => l.category === filters.category);
    if (filters.event) list = list.filter((l) => l.event === filters.event);
    if (filters.severity) list = list.filter((l) => l.severity === filters.severity);
    if (filters.alertOnly) list = list.filter((l) => l.alert);
    if (filters.since) list = list.filter((l) => l.date >= filters.since);
    if (filters.limit) list = list.slice(0, filters.limit);
    return list;
  }

  function getPolicy() {
    return {
      backendConnected: isBackendConnected(),
      retentionMax: { ...RETENTION_MAX },
      categories: ['application', 'security', 'database', 'access'],
      alertRules: ALERT_RULES.map((r) => ({ id: r.id, label: r.label, threshold: r.threshold, windowMs: r.windowMs })),
      note: 'Em produção, logs oficiais são gerados no servidor (gateway, auth, app, DB). Protótipo espelha eventos para demo.'
    };
  }

  function eventLabel(event) {
    return EVENT_LABELS[event] || event;
  }

  function categoryLabel(category) {
    const map = {
      application: 'Aplicação',
      security: 'Segurança',
      database: 'Banco de dados',
      access: 'Acesso'
    };
    return map[category] || category;
  }

  return {
    emit,
    application,
    security,
    database,
    access,
    logError,
    query,
    getPolicy,
    hashIdentifier,
    eventLabel,
    categoryLabel,
    EVENT_LABELS,
    ALERT_RULES
  };
})();

window.CSInfraLog = CSInfraLog;
