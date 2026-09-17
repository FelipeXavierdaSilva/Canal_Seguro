'use strict';

const { hashIdentifier } = require('../utils/tokens');

const DEFAULT_EVENTS = {
  password_reset: { enabled: true },
  user_created: { enabled: true },
  account_activation: { enabled: true },
  // Need-to-know: novo relato só Adm_Empresa (+ e-mail cadastral). Apurador só após Encaminhar.
  report_new: {
    enabled: true,
    roles: ['admin_empresa'],
    notifyCompanyEmail: true
  },
  report_assigned: {
    enabled: true,
    roles: [],
    notifyAssignee: true,
    notifyTeam: true
  },
  report_status: {
    enabled: true,
    roles: ['admin_empresa'],
    notifyAssignee: true,
    notifyTeam: true
  },
  report_message: {
    enabled: true,
    roles: ['admin_empresa'],
    notifyReporter: true,
    notifyInternal: true,
    notifyAssignee: true,
    notifyTeam: true
  },
  report_info_request: { enabled: true, notifyReporter: true },
  report_completed: {
    enabled: true,
    roles: ['admin_empresa'],
    notifyReporter: true,
    notifyAssignee: true,
    notifyTeam: true
  },
  sla_alert: {
    enabled: true,
    roles: ['admin_empresa'],
    notifyAssignee: true,
    notifyTeam: true,
    daysInStatus: 5
  },
  critical_alert: {
    enabled: true,
    roles: ['admin_empresa'],
    notifySuperadmin: true,
    daysStalled: 10
  },
  risk_critical: {
    enabled: true,
    roles: ['admin_empresa'],
    notifyAssignee: true,
    notifyTeam: true,
    notifySuperadmin: true
  },
  platform_support: { enabled: true }
};

function defaultCompanyEmailSettings(company) {
  return {
    enabled: true,
    fromName: company?.nomeCanal || 'Canal Seguro',
    replyTo: company?.email || null,
    events: JSON.parse(JSON.stringify(DEFAULT_EVENTS))
  };
}

function getCompanyPolicy(data, companyId) {
  const company = (data.companies || []).find((c) => c.id === companyId);
  const stored = data.companySettings?.[companyId]?.emailNotifications;
  if (!stored) return defaultCompanyEmailSettings(company);
  return {
    ...defaultCompanyEmailSettings(company),
    ...stored,
    events: { ...DEFAULT_EVENTS, ...(stored.events || {}) }
  };
}

function isEventEnabled(data, companyId, eventType) {
  const policy = getCompanyPolicy(data, companyId);
  if (!policy.enabled) return false;
  const ev = policy.events?.[eventType];
  return ev ? ev.enabled !== false : false;
}

function addUserIfMissing(users, user) {
  if (!user || user.status !== 'ativo') return users;
  if (users.some((u) => u.id === user.id)) return users;
  return [...users, user];
}

/**
 * Destinatários internos. Apuradores só entram se forem assignee/team do relato
 * (need-to-know), mesmo que a política armazenada ainda liste o papel `apurador`.
 */
function resolveInternalRecipients(data, companyId, eventType, { assigneeId, teamIds } = {}) {
  const policy = getCompanyPolicy(data, companyId);
  const ev = policy.events?.[eventType] || {};
  const roles = ev.roles || ['admin_empresa'];
  let users = (data.users || []).filter(
    (u) => u.status === 'ativo' && u.companyId === companyId && roles.includes(u.role)
  );

  if (ev.notifyAssignee && assigneeId) {
    const assignee = (data.users || []).find((u) => u.id === assigneeId && u.status === 'ativo');
    users = addUserIfMissing(users, assignee);
  }

  if (ev.notifyTeam && Array.isArray(teamIds)) {
    for (const tid of teamIds) {
      const member = (data.users || []).find((u) => u.id === tid && u.status === 'ativo');
      users = addUserIfMissing(users, member);
    }
  }

  if (ev.notifySuperadmin) {
    const supers = (data.users || []).filter((u) => u.status === 'ativo' && u.role === 'superadmin');
    for (const s of supers) users = addUserIfMissing(users, s);
  }

  // Need-to-know: Apurador sem direcionamento nunca recebe ciência do relato
  users = users.filter((u) => {
    if (u.role !== 'apurador') return true;
    if (assigneeId && u.id === assigneeId) return true;
    if (Array.isArray(teamIds) && teamIds.includes(u.id)) return true;
    return false;
  });

  const seen = new Set();
  return users.filter((u) => {
    const key = String(u.email || '').toLowerCase();
    if (!key || seen.has(key)) return false;
    seen.add(key);
    return true;
  });
}

function emailHash(email) {
  return hashIdentifier(String(email || '').toLowerCase());
}

module.exports = {
  DEFAULT_EVENTS,
  defaultCompanyEmailSettings,
  getCompanyPolicy,
  isEventEnabled,
  resolveInternalRecipients,
  emailHash
};
