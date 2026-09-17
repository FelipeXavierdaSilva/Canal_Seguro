'use strict';

const store = require('../store');
const config = require('../config');
const { verifyTrackingCode, normalizeTrackingCode, hashTrackingCode } = require('../utils/tracking-crypto');
const reporterSession = require('./reporter-session.service');
const notification = require('./notification.service');
const { gateAttempt } = require('../utils/rate-limit-gate');
const { appendAudit } = require('./audit.service');
const { assertReportVisibility } = require('./report-access.service');

const MESSAGE_MAX_LEN = 5000;
const PUBLIC_AUTHOR_LABEL = 'Você';
const COMPANY_AUTHOR_LABEL = 'Equipe responsável';

async function checkReporterRate(reportId) {
  const cfg = config.REPORTER_MESSAGE || { MAX_PER_SESSION: 30, WINDOW_MS: 15 * 60 * 1000 };
  const gate = await gateAttempt(`reporter:msg:${reportId}`, cfg.MAX_PER_SESSION, cfg.WINDOW_MS);
  if (!gate.allowed) {
    return { ok: false, status: 429, error: 'Limite de mensagens atingido. Tente novamente mais tarde.' };
  }
  return { ok: true };
}

function resetReporterRateForTests() {
  const { resetAllForTests } = require('../utils/rate-limit-gate');
  return resetAllForTests();
}

function sanitizeBody(text) {
  return String(text || '')
    .trim()
    .replace(/<[^>]*>/g, '')
    .slice(0, MESSAGE_MAX_LEN);
}

function ensureMessages(data) {
  data.reportMessages = data.reportMessages || [];
  return data;
}

function writeAudit(data, entry) {
  appendAudit(data, entry);
}

function findReportByProtocol(data, protocol) {
  const normalized = String(protocol || '').trim().toUpperCase();
  return (data.reports || []).find((r) => r.protocol.toUpperCase() === normalized) || null;
}

function verifyReportAccess(report, trackingCode) {
  if (!report?.trackingCodeHash) return false;
  return verifyTrackingCode(trackingCode, report.trackingCodeHash);
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
    attachments: (msg.attachments || []).map((a) => ({
      id: a.id,
      name: a.name,
      size: a.size,
      mimeType: a.mimeType,
      status: a.status || 'simulated'
    }))
  };
}

function staffMessageView(msg) {
  return {
    ...publicMessageView(msg),
    actorUserId: msg.actorUserId || null
  };
}

function listForReport(reportId, { publicView = false } = {}) {
  const data = ensureMessages(store.load());
  const list = (data.reportMessages || [])
    .filter((m) => m.reportId === reportId)
    .sort((a, b) => (a.createdAt < b.createdAt ? -1 : 1));
  return list.map((m) => (publicView ? publicMessageView(m) : staffMessageView(m)));
}

function unreadCount(reportId, forParty) {
  const data = ensureMessages(store.load());
  return (data.reportMessages || []).filter((m) => {
    if (m.reportId !== reportId) return false;
    if (forParty === 'reporter') return m.direction === 'company' && m.status !== 'read';
    if (forParty === 'company') return m.direction === 'reporter' && m.status !== 'read';
    return false;
  }).length;
}

function markDeliveredForReporter(reportId) {
  const data = ensureMessages(store.load());
  let changed = false;
  (data.reportMessages || []).forEach((m) => {
    if (m.reportId === reportId && m.direction === 'company' && m.status === 'sent') {
      m.status = 'delivered';
      m.deliveredAt = new Date().toISOString();
      changed = true;
    }
  });
  if (changed) store.save(data);
}

function markRead(reportId, { reader, messageIds = null }) {
  const data = ensureMessages(store.load());
  const now = new Date().toISOString();
  let count = 0;
  (data.reportMessages || []).forEach((m) => {
    if (m.reportId !== reportId) return;
    if (messageIds && !messageIds.includes(m.id)) return;
    if (reader === 'reporter' && m.direction !== 'company') return;
    if (reader === 'company' && m.direction !== 'reporter') return;
    if (m.status === 'read') return;
    if (m.status === 'sent') {
      m.status = 'delivered';
      m.deliveredAt = now;
    }
    m.status = 'read';
    m.readAt = now;
    count += 1;
  });
  if (count) store.save(data);
  return count;
}

function createMessage(report, { direction, messageType, body, actorUserId, attachments = [] }) {
  const data = ensureMessages(store.load());
  const now = new Date().toISOString();
  const msg = {
    id: store.uid('msg'),
    reportId: report.id,
    direction,
    messageType: messageType || 'message',
    body: sanitizeBody(body),
    attachments: (attachments || []).slice(0, 5).map((a, i) => ({
      id: store.uid('att'),
      name: String(a?.name || `anexo-${i + 1}`).slice(0, 200),
      size: Number(a?.size) || 0,
      mimeType: String(a?.mimeType || 'application/octet-stream').slice(0, 100),
      status: 'simulated',
      createdAt: now
    })),
    status: 'sent',
    authorLabel: direction === 'reporter' ? PUBLIC_AUTHOR_LABEL : COMPANY_AUTHOR_LABEL,
    actorUserId: direction === 'company' ? actorUserId || null : null,
    createdAt: now,
    deliveredAt: null,
    readAt: null
  };
  if (!msg.body && !msg.attachments.length) {
    return { ok: false, status: 400, error: 'Mensagem vazia.' };
  }
  data.reportMessages.push(msg);
  report.updatedAt = now;
  writeAudit(data, {
    userId: direction === 'company' ? actorUserId || 'system' : 'reporter',
    userName: direction === 'company' ? 'Equipe' : PUBLIC_AUTHOR_LABEL,
    action: direction === 'company' ? 'mensagem_empresa_enviada' : 'mensagem_denunciante_enviada',
    resourceType: 'report_message',
    resourceId: msg.id,
    companyId: report.companyId,
    protocol: report.protocol,
    newValue: { messageType: msg.messageType, attachmentCount: msg.attachments.length }
  });
  store.save(data);
  try {
    notification.emitReportThreadMessage(report, { direction, messageType: msg.messageType });
  } catch {
    /* ignore */
  }
  return { ok: true, message: publicMessageView(msg) };
}

function authenticateConsult(protocol, trackingCode) {
  const data = store.load();
  const report = findReportByProtocol(data, protocol);
  if (!report || !verifyReportAccess(report, trackingCode)) {
    return { ok: false };
  }
  return { ok: true, report };
}

function sendCompanyMessage(user, reportId, { text, messageType = 'message', attachments = [] }) {
  const data = store.load();
  const report = (data.reports || []).find((r) => r.id === reportId);
  if (!report) return { ok: false, status: 404, error: 'Relato não encontrado.' };
  const access = assertReportVisibility(user, report);
  if (!access.ok) return { ok: false, status: access.status || 404, error: 'Relato não encontrado.' };
  const type = messageType === 'info_request' ? 'info_request' : 'message';
  return createMessage(report, {
    direction: 'company',
    messageType: type,
    body: text,
    actorUserId: user.id,
    attachments
  });
}

async function sendReporterMessage(reporterCtx, { text, attachments = [] }) {
  const rate = await checkReporterRate(reporterCtx.reportId);
  if (!rate.ok) return rate;
  const data = store.load();
  const report = (data.reports || []).find((r) => r.id === reporterCtx.reportId);
  if (!report) return { ok: false, status: 401, error: 'Não autorizado.' };
  if (String(report.protocol).toUpperCase() !== String(reporterCtx.protocol).toUpperCase()) {
    return { ok: false, status: 401, error: 'Não autorizado.' };
  }
  return createMessage(report, {
    direction: 'reporter',
    messageType: 'reply',
    body: text,
    attachments
  });
}

function getThreadForReporter(reporterCtx) {
  const data = store.load();
  const report = (data.reports || []).find((r) => r.id === reporterCtx.reportId);
  if (!report) return { ok: false, status: 401, error: 'Não autorizado.' };
  markDeliveredForReporter(report.id);
  markRead(report.id, { reader: 'reporter' });
  const messages = listForReport(report.id, { publicView: true });
  return {
    ok: true,
    messages,
    unreadCount: unreadCount(report.id, 'reporter')
  };
}

function getThreadForStaff(user, reportId) {
  const data = store.load();
  const report = (data.reports || []).find((r) => r.id === reportId);
  if (!report) return { ok: false, status: 404, error: 'Relato não encontrado.' };
  const access = assertReportVisibility(user, report);
  if (!access.ok) return { ok: false, status: access.status || 404, error: 'Relato não encontrado.' };
  markRead(reportId, { reader: 'company' });
  return {
    ok: true,
    messages: listForReport(reportId, { publicView: false }),
    unreadCount: unreadCount(reportId, 'company')
  };
}

function hashReportTrackingOnCreate(plainTracking) {
  return hashTrackingCode(plainTracking);
}

module.exports = {
  sanitizeBody,
  authenticateConsult,
  verifyReportAccess,
  findReportByProtocol,
  hashReportTrackingOnCreate,
  createMessage,
  sendCompanyMessage,
  sendReporterMessage,
  getThreadForReporter,
  getThreadForStaff,
  markRead,
  unreadCount,
  listForReport,
  PUBLIC_AUTHOR_LABEL,
  COMPANY_AUTHOR_LABEL,
  resetReporterRateForTests
};
