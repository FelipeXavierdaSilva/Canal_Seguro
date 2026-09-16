'use strict';

const { hashIdentifier } = require('../utils/tokens');

const DEFAULT_EVENTS = {
  password_reset: { enabled: true },
  user_created: { enabled: true },
  account_activation: { enabled: true },
  report_new: { enabled: true, roles: ['admin_empresa', 'apurador'] },
  report_status: { enabled: true, roles: ['admin_empresa', 'apurador'], notifyAssignee: true },
  report_message: { enabled: true, notifyReporter: true, notifyInternal: true },
  report_info_request: { enabled: true, notifyReporter: true },
  report_completed: {
    enabled: true,
    roles: ['admin_empresa', 'apurador'],
    notifyReporter: true
  },
  sla_alert: { enabled: true, roles: ['admin_empresa', 'apurador'], daysInStatus: 5 },
  critical_alert: {
    enabled: true,
    roles: ['admin_empresa'],
    notifySuperadmin: true,
    daysStalled: 10
  },
  risk_critical: {
    enabled: true,
    roles: ['admin_empresa', 'apurador'],
    notifySuperadmin: true
  }
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

function resolveInternalRecipients(data, companyId, eventType, { assigneeId } = {}) {
  const policy = getCompanyPolicy(data, companyId);
  const ev = policy.events?.[eventType] || {};
  const roles = ev.roles || ['admin_empresa'];
  let users = (data.users || []).filter(
    (u) => u.status === 'ativo' && u.companyId === companyId && roles.includes(u.role)
  );

  if (ev.notifyAssignee && assigneeId) {
    const assignee = (data.users || []).find((u) => u.id === assigneeId && u.status === 'ativo');
    if (assignee && !users.some((u) => u.id === assignee.id)) {
      users = [...users, assignee];
    }
  }

  if (ev.notifySuperadmin) {
    const supers = (data.users || []).filter((u) => u.status === 'ativo' && u.role === 'superadmin');
    users = [...users, ...supers];
  }

  const seen = new Set();
  return users.filter((u) => {
    const key = u.email.toLowerCase();
    if (seen.has(key)) return false;
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
