'use strict';

const store = require('../store');
const { appendAudit } = require('./audit.service');

const MESSAGE_MAX = 4000;
const SUBJECT_MAX = 160;
const SLA_HOURS = 24;

function sanitizeText(text, max) {
  return String(text || '')
    .trim()
    .replace(/<[^>]*>/g, '')
    .slice(0, max);
}

function ensureThreads(data) {
  if (!Array.isArray(data.platformInternalSupportThreads)) {
    data.platformInternalSupportThreads = [];
  }
  return data.platformInternalSupportThreads;
}

function slaDeadline(iso) {
  const t = new Date(iso).getTime();
  if (Number.isNaN(t)) return null;
  return new Date(t + SLA_HOURS * 60 * 60 * 1000).toISOString();
}

/**
 * Adm_Plataforma Master = marcado explicitamente OU o primeiro superadmin criado.
 */
function resolvePlatformMaster(data) {
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

function isMasterUser(user, data) {
  if (!user || user.role !== 'superadmin') return false;
  const master = resolvePlatformMaster(data);
  return Boolean(master && master.id === user.id);
}

function ensureMessageReadMap(msg) {
  if (!msg.readBy || typeof msg.readBy !== 'object') msg.readBy = {};
  return msg.readBy;
}

function enrichThread(thread, user, data, now = Date.now()) {
  if (!thread) return null;
  const messages = Array.isArray(thread.messages) ? thread.messages : [];
  const master = resolvePlatformMaster(data);
  const isMaster = Boolean(master && user && user.id === master.id);
  let unreadCount = 0;
  messages.forEach((m) => {
    const readBy = ensureMessageReadMap(m);
    if (isMaster) {
      if (m.direction === 'requester' && readBy[user.id] !== true) unreadCount += 1;
    } else if (user) {
      if (m.direction === 'attendant' && readBy[user.id] !== true) unreadCount += 1;
    }
  });
  const due = thread.respondBy ? new Date(thread.respondBy).getTime() : NaN;
  const overdue = thread.status === 'aberto' && !Number.isNaN(due) && now > due;
  return {
    ...thread,
    messages,
    unreadCount,
    overdue,
    slaHours: SLA_HOURS,
    assigneeUserId: thread.assigneeUserId || master?.id || null,
    assigneeName: thread.assigneeName || master?.nome || master?.email || 'Adm_Plataforma Master',
    isMasterViewer: isMaster,
    statusLabel:
      thread.status === 'fechado'
        ? 'Fechado'
        : thread.status === 'respondido'
          ? 'Respondido'
          : overdue
            ? 'Aguardando (atrasado)'
            : 'Aguardando resposta'
  };
}

function pushMasterNotification(data, thread, preview, master) {
  if (!master) return;
  data.notifications = data.notifications || [];
  data.notifications.unshift({
    id: store.uid('ntf'),
    type: 'platform_internal_support',
    title: 'Mensagem interna de Adm_Plataforma',
    message: `${thread.createdByName || 'Adm_Plataforma'}: ${String(preview || '').slice(0, 120)}`,
    role: 'superadmin',
    userId: master.id,
    threadId: thread.id,
    channel: 'internal',
    read: false,
    createdAt: new Date().toISOString()
  });
}

function pushRequesterNotification(data, thread, preview, requesterId) {
  if (!requesterId) return;
  data.notifications = data.notifications || [];
  data.notifications.unshift({
    id: store.uid('ntf'),
    type: 'platform_internal_support_reply',
    title: 'Resposta do Adm_Plataforma Master',
    message: String(preview || '').slice(0, 120),
    role: 'superadmin',
    userId: requesterId,
    threadId: thread.id,
    channel: 'internal',
    read: false,
    createdAt: new Date().toISOString()
  });
}

function clearInternalPendingForUser(data, threadId, userId, now) {
  (data.notifications || []).forEach((n) => {
    if (
      (n.type === 'platform_internal_support' || n.type === 'platform_internal_support_reply') &&
      n.threadId === threadId &&
      n.userId === userId &&
      !n.read
    ) {
      n.read = true;
      n.readAt = now;
    }
  });
}

function createThread(user, payload = {}) {
  if (!user || user.role !== 'superadmin') {
    return { ok: false, status: 403, error: 'Apenas Adm_Plataforma pode abrir suporte interno.' };
  }
  const data = store.load();
  const master = resolvePlatformMaster(data);
  if (!master) {
    return { ok: false, status: 400, error: 'Nenhum Adm_Plataforma Master disponível.' };
  }
  if (user.id === master.id) {
    return {
      ok: false,
      status: 400,
      error: 'O Adm_Plataforma Master já é o atendente deste canal. Aguarde mensagens dos demais administradores.'
    };
  }

  const subject = sanitizeText(payload.subject || 'Suporte interno', SUBJECT_MAX) || 'Suporte interno';
  const body = sanitizeText(payload.body, MESSAGE_MAX);
  if (!body) return { ok: false, status: 400, error: 'Escreva a mensagem para o Master.' };

  const now = new Date().toISOString();
  const thread = {
    id: store.uid('pisup'),
    channel: 'internal',
    subject,
    status: 'aberto',
    createdAt: now,
    updatedAt: now,
    respondBy: slaDeadline(now),
    firstResponseAt: null,
    closedAt: null,
    createdByUserId: user.id,
    createdByName: user.nome || user.email || user.id,
    assigneeUserId: master.id,
    assigneeName: master.nome || master.email || master.id,
    messages: [
      {
        id: store.uid('pimsg'),
        direction: 'requester',
        body,
        actorUserId: user.id,
        actorName: user.nome || user.email || user.id,
        createdAt: now,
        readBy: { [user.id]: true }
      }
    ]
  };

  ensureThreads(data).unshift(thread);
  pushMasterNotification(data, thread, body, master);
  appendAudit(data, {
    userId: user.id,
    userName: user.nome || user.email || user.id,
    action: 'suporte_interno_aberto',
    resourceType: 'platform_internal_support',
    resourceId: thread.id,
    newValue: { subject: thread.subject, assigneeUserId: master.id }
  });
  store.save(data);
  return { ok: true, data: enrichThread(thread, user, data) };
}

function listThreads(user) {
  if (!user || user.role !== 'superadmin') {
    return { ok: false, status: 403, error: 'Acesso negado.' };
  }
  const data = store.load();
  const master = resolvePlatformMaster(data);
  const list = [...ensureThreads(data)].sort((a, b) => (a.updatedAt < b.updatedAt ? 1 : -1));
  const now = Date.now();
  const threads = list.map((t) => enrichThread(t, user, data, now));
  const unreadTotal = threads.reduce((sum, t) => sum + (Number(t.unreadCount) || 0), 0);
  return {
    ok: true,
    data: {
      threads,
      slaHours: SLA_HOURS,
      unreadTotal,
      master: master
        ? { id: master.id, nome: master.nome || master.email || master.id, email: master.email || null }
        : null,
      isMaster: Boolean(master && master.id === user.id)
    }
  };
}

function getThread(user, threadId) {
  if (!user || user.role !== 'superadmin') {
    return { ok: false, status: 403, error: 'Acesso negado.' };
  }
  const data = store.load();
  const thread = ensureThreads(data).find((t) => t.id === threadId);
  if (!thread) return { ok: false, status: 404, error: 'Conversa não encontrada.' };
  return { ok: true, data: enrichThread(thread, user, data) };
}

function addMessage(user, threadId, payload = {}) {
  if (!user || user.role !== 'superadmin') {
    return { ok: false, status: 403, error: 'Acesso negado.' };
  }
  const body = sanitizeText(payload.body, MESSAGE_MAX);
  if (!body) return { ok: false, status: 400, error: 'Mensagem vazia.' };

  const data = store.load();
  const master = resolvePlatformMaster(data);
  const thread = ensureThreads(data).find((t) => t.id === threadId);
  if (!thread) return { ok: false, status: 404, error: 'Conversa não encontrada.' };
  if (thread.status === 'fechado') {
    return { ok: false, status: 400, error: 'Esta conversa está fechada.' };
  }

  const asMaster = Boolean(master && user.id === master.id);
  const now = new Date().toISOString();
  const msg = {
    id: store.uid('pimsg'),
    direction: asMaster ? 'attendant' : 'requester',
    body,
    actorUserId: user.id,
    actorName: user.nome || user.email || user.id,
    createdAt: now,
    readBy: { [user.id]: true }
  };
  thread.messages = Array.isArray(thread.messages) ? thread.messages : [];
  thread.messages.push(msg);
  thread.updatedAt = now;

  if (asMaster) {
    if (!thread.firstResponseAt) thread.firstResponseAt = now;
    thread.status = 'respondido';
    thread.lastResponderUserId = user.id;
    thread.lastResponderName = user.nome || user.email || user.id;
    pushRequesterNotification(data, thread, body, thread.createdByUserId);
    clearInternalPendingForUser(data, thread.id, user.id, now);
  } else {
    thread.status = 'aberto';
    thread.respondBy = slaDeadline(now);
    pushMasterNotification(data, thread, body, master);
  }

  appendAudit(data, {
    userId: user.id,
    userName: user.nome || user.email || user.id,
    action: asMaster ? 'suporte_interno_resposta_master' : 'suporte_interno_mensagem',
    resourceType: 'platform_internal_support',
    resourceId: thread.id
  });
  store.save(data);
  return { ok: true, data: enrichThread(thread, user, data) };
}

function markRead(user, threadId = null) {
  if (!user || user.role !== 'superadmin') {
    return { ok: false, status: 403, error: 'Acesso negado.' };
  }
  const data = store.load();
  const master = resolvePlatformMaster(data);
  const isMaster = Boolean(master && master.id === user.id);
  const now = new Date().toISOString();
  let marked = 0;

  for (const thread of ensureThreads(data)) {
    if (threadId && thread.id !== threadId) continue;
    const messages = Array.isArray(thread.messages) ? thread.messages : [];
    messages.forEach((m) => {
      const readBy = ensureMessageReadMap(m);
      const relevant = isMaster ? m.direction === 'requester' : m.direction === 'attendant';
      if (relevant && readBy[user.id] !== true) {
        readBy[user.id] = true;
        marked += 1;
      }
    });
    clearInternalPendingForUser(data, thread.id, user.id, now);
  }

  store.save(data);
  return { ok: true, data: { marked, unreadTotal: 0, isMaster } };
}

function getMasterInfo(user) {
  if (!user || user.role !== 'superadmin') {
    return { ok: false, status: 403, error: 'Acesso negado.' };
  }
  const data = store.load();
  const master = resolvePlatformMaster(data);
  return {
    ok: true,
    data: {
      master: master
        ? { id: master.id, nome: master.nome || master.email || master.id, email: master.email || null }
        : null,
      isMaster: Boolean(master && master.id === user.id)
    }
  };
}

module.exports = {
  SLA_HOURS,
  resolvePlatformMaster,
  isMasterUser,
  createThread,
  listThreads,
  getThread,
  addMessage,
  markRead,
  getMasterInfo,
  enrichThread
};
