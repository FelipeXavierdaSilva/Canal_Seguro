'use strict';

const store = require('../store');
const config = require('../config');
const queue = require('../email/queue.service');
const emailPolicy = require('../email/policy.service');
const { EMAIL_EVENTS } = require('../email/events');
const { firstName } = require('../email/privacy');

function appBase(req) {
  if (config.PUBLIC_APP_URL) return config.PUBLIC_APP_URL.replace(/\/$/, '');
  if (req) return `${req.protocol}://${req.get('host') || 'localhost:3000'}`.replace(/\/$/, '');
  return 'http://localhost:3000';
}

function channelName(data, companyId) {
  const company = (data.companies || []).find((c) => c.id === companyId);
  return company?.nomeCanal || 'Canal Seguro';
}

function internalReportUrl(base, reportId) {
  return `${base}/empresa/relatos.html#relato-${encodeURIComponent(reportId)}`;
}

function consultUrl(base) {
  return `${base}/protocolo.html`;
}

function loginUrl(base) {
  return `${base}/login.html`;
}

function enqueueSafe(eventType, to, companyId, payload, dedupeKey, dedupeWindowMs) {
  const data = store.load();
  if (companyId && !emailPolicy.isEventEnabled(data, companyId, eventType)) {
    return Promise.resolve({ ok: false, disabled: true });
  }
  return queue.enqueue({
    eventType,
    to,
    companyId,
    payload,
    dedupeKey,
    dedupeWindowMs
  });
}

function enqueueToInternalUsers(data, companyId, eventType, payloadBuilder, dedupePrefix, opts) {
  const users = emailPolicy.resolveInternalRecipients(data, companyId, eventType, opts);
  const results = [];
  for (const user of users) {
    const payload = payloadBuilder(user);
    const dedupeKey = dedupePrefix ? `${dedupePrefix}:${emailPolicy.emailHash(user.email)}` : null;
    results.push(
      enqueueSafe(eventType, user.email, companyId, payload, dedupeKey)
    );
  }
  return results;
}

function emitPasswordReset({ to, userName, resetUrl, companyId }) {
  return enqueueSafe(
    EMAIL_EVENTS.PASSWORD_RESET,
    to,
    companyId,
    {
      firstName: firstName(userName),
      actionUrl: resetUrl,
      channelName: channelName(store.load(), companyId),
      ttlMinutes: String(config.PASSWORD_RESET.TTL_MINUTES)
    },
    `password_reset:${emailPolicy.emailHash(to)}:${Math.floor(Date.now() / (60 * 60 * 1000))}`,
    config.PASSWORD_RESET.EMAIL_WINDOW_MS
  );
}

function emitUserCreated({ user, setupUrl, companyId }) {
  const data = store.load();
  return enqueueSafe(
    EMAIL_EVENTS.USER_CREATED,
    user.email,
    companyId || user.companyId,
    {
      firstName: firstName(user.nome),
      actionUrl: setupUrl || loginUrl(appBase()),
      channelName: channelName(data, companyId || user.companyId)
    },
    `user_created:${user.id}`
  );
}

function emitAccountActivation({ user, companyId }) {
  const data = store.load();
  const cid = companyId || user.companyId;
  return enqueueSafe(
    EMAIL_EVENTS.ACCOUNT_ACTIVATION,
    user.email,
    cid,
    {
      firstName: firstName(user.nome),
      actionUrl: loginUrl(appBase()),
      channelName: channelName(data, cid)
    },
    `account_activation:${user.id}:${Date.now()}`
  );
}

function emitReportNew(report) {
  const data = store.load();
  const base = appBase();
  const ch = channelName(data, report.companyId);
  return enqueueToInternalUsers(
    data,
    report.companyId,
    EMAIL_EVENTS.REPORT_NEW,
    (user) => ({
      firstName: firstName(user.nome),
      actionUrl: internalReportUrl(base, report.id),
      channelName: ch,
      ctaLabel: 'Ver relatos no painel'
    }),
    `report_new:${report.id}`,
    { assigneeId: report.assigneeId }
  );
}

function emitReportStatusChanged(report, previousStatus) {
  const data = store.load();
  const base = appBase();
  const ch = channelName(data, report.companyId);
  const eventType =
    report.status === 'concluido' ? EMAIL_EVENTS.REPORT_COMPLETED : EMAIL_EVENTS.REPORT_STATUS;

  const internal = enqueueToInternalUsers(
    data,
    report.companyId,
    eventType,
    (user) => ({
      firstName: firstName(user.nome),
      actionUrl: internalReportUrl(base, report.id),
      channelName: ch,
      ctaLabel: 'Ver atualização no painel'
    }),
    `${eventType}:${report.id}:${report.status}`,
    { assigneeId: report.assigneeId }
  );

  const reporterResults = [];
  if (
    report.wantUpdates &&
    report.contactEmail &&
    emailPolicy.isEventEnabled(data, report.companyId, eventType)
  ) {
    const ev = emailPolicy.getCompanyPolicy(data, report.companyId).events?.[eventType];
    if (ev?.notifyReporter !== false) {
      reporterResults.push(
        enqueueSafe(
          eventType,
          report.contactEmail,
          report.companyId,
          {
            firstName: 'Olá',
            actionUrl: consultUrl(base),
            channelName: ch,
            ctaLabel: 'Consultar andamento'
          },
          `${eventType}:reporter:${report.id}:${report.status}`
        )
      );
    }
  }

  return { internal, reporter: reporterResults, previousStatus };
}

function emitReportThreadMessage(report, { direction, messageType = 'message' } = {}) {
  const kind = messageType === 'info_request' ? 'info_request' : 'message';
  return emitReportMessage(report, null, { kind });
}

function emitReportMessage(report, actor, { kind = 'message' } = {}) {
  const data = store.load();
  const base = appBase();
  const ch = channelName(data, report.companyId);
  const eventType =
    kind === 'info_request' ? EMAIL_EVENTS.REPORT_INFO_REQUEST : EMAIL_EVENTS.REPORT_MESSAGE;

  const results = { internal: [], reporter: [] };

  const policy = emailPolicy.getCompanyPolicy(data, report.companyId).events?.[eventType];
  if (policy?.notifyInternal !== false) {
    results.internal = enqueueToInternalUsers(
      data,
      report.companyId,
      eventType,
      (user) => ({
        firstName: firstName(user.nome),
        actionUrl: internalReportUrl(base, report.id),
        channelName: ch,
        ctaLabel: 'Ver mensagens no painel'
      }),
      `${eventType}:internal:${report.id}:${Date.now()}`,
      { assigneeId: report.assigneeId }
    );
  }

  if (
    report.wantUpdates &&
    report.contactEmail &&
    policy?.notifyReporter !== false &&
    emailPolicy.isEventEnabled(data, report.companyId, eventType)
  ) {
    results.reporter.push(
      enqueueSafe(
        eventType,
        report.contactEmail,
        report.companyId,
        {
          firstName: 'Olá',
          actionUrl: consultUrl(base),
          channelName: ch,
          ctaLabel: 'Consultar andamento'
        },
        `${eventType}:reporter:${report.id}:${Math.floor(Date.now() / (30 * 60 * 1000))}`
      )
    );
  }

  return results;
}

function emitRiskCritical(report) {
  const data = store.load();
  const base = appBase();
  const ch = channelName(data, report.companyId);
  return enqueueToInternalUsers(
    data,
    report.companyId,
    EMAIL_EVENTS.RISK_CRITICAL,
    (user) => ({
      firstName: firstName(user.nome),
      actionUrl: internalReportUrl(base, report.id),
      channelName: ch,
      ctaLabel: 'Ver relato classificado como crítico'
    }),
    `risk_critical:${report.id}:${report.riskClassifiedAt || Date.now()}`,
    { assigneeId: report.assigneeId, notifySuperadmin: true }
  );
}

function runScheduledAlerts() {
  const data = store.load();
  const base = appBase();
  const now = Date.now();
  const results = { sla: [], critical: [] };

  for (const company of data.companies || []) {
    if (company.status !== 'ativo') continue;
    const policy = emailPolicy.getCompanyPolicy(data, company.id);

    const slaCfg = policy.events?.sla_alert;
    if (slaCfg?.enabled !== false && slaCfg?.daysInStatus) {
      const thresholdMs = slaCfg.daysInStatus * 24 * 60 * 60 * 1000;
      const reports = (data.reports || []).filter(
        (r) =>
          r.companyId === company.id &&
          r.status !== 'concluido' &&
          now - new Date(r.updatedAt || r.createdAt).getTime() >= thresholdMs
      );
      for (const report of reports) {
        results.sla.push(
          ...enqueueToInternalUsers(
            data,
            company.id,
            EMAIL_EVENTS.SLA_ALERT,
            (user) => ({
              firstName: firstName(user.nome),
              actionUrl: internalReportUrl(base, report.id),
              channelName: channelName(data, company.id),
              ctaLabel: 'Ver relato no painel'
            }),
            `sla_alert:${report.id}:${report.status}`,
            { assigneeId: report.assigneeId }
          )
        );
      }
    }

    const critCfg = policy.events?.critical_alert;
    if (critCfg?.enabled !== false && critCfg?.daysStalled) {
      const thresholdMs = critCfg.daysStalled * 24 * 60 * 60 * 1000;
      const reports = (data.reports || []).filter(
        (r) =>
          r.companyId === company.id &&
          r.status !== 'concluido' &&
          now - new Date(r.updatedAt || r.createdAt).getTime() >= thresholdMs
      );
      for (const report of reports.slice(0, 5)) {
        results.critical.push(
          ...enqueueToInternalUsers(
            data,
            company.id,
            EMAIL_EVENTS.CRITICAL_ALERT,
            (user) => ({
              firstName: firstName(user.nome),
              actionUrl: internalReportUrl(base, report.id),
              channelName: channelName(data, company.id),
              ctaLabel: 'Verificar no painel'
            }),
            `critical_alert:${report.id}`,
            { assigneeId: report.assigneeId, notifySuperadmin: critCfg.notifySuperadmin }
          )
        );
      }
    }
  }

  return results;
}

function updateCompanyEmailPolicy(actor, companyId, patch) {
  const data = store.load();
  if (actor.role === 'admin_empresa' && actor.companyId !== companyId) {
    return { ok: false, status: 403, error: 'Acesso negado.' };
  }
  if (actor.role !== 'superadmin' && actor.role !== 'admin_empresa') {
    return { ok: false, status: 403, error: 'Acesso negado.' };
  }

  data.companySettings = data.companySettings || {};
  data.companySettings[companyId] = data.companySettings[companyId] || {};
  const prev = emailPolicy.getCompanyPolicy(data, companyId);
  const next = {
    ...prev,
    ...patch,
    events: { ...prev.events, ...(patch.events || {}) }
  };
  data.companySettings[companyId].emailNotifications = next;

  data.auditLogs = data.auditLogs || [];
  data.auditLogs.unshift({
    id: store.uid('aud'),
    date: new Date().toISOString(),
    userId: actor.id,
    userName: actor.nome,
    action: 'email_politica_alterada',
    resourceType: 'company',
    resourceId: companyId,
    companyId,
    previousValue: { enabled: prev.enabled },
    newValue: { enabled: next.enabled }
  });
  store.save(data);
  return { ok: true, policy: next };
}

function getCompanyEmailPolicy(companyId) {
  const data = store.load();
  return emailPolicy.getCompanyPolicy(data, companyId);
}

module.exports = {
  emitPasswordReset,
  emitUserCreated,
  emitAccountActivation,
  emitReportNew,
  emitReportStatusChanged,
  emitReportMessage,
  emitReportThreadMessage,
  emitRiskCritical,
  runScheduledAlerts,
  updateCompanyEmailPolicy,
  getCompanyEmailPolicy,
  EMAIL_EVENTS
};
