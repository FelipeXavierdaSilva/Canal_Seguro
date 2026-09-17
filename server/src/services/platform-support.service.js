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
  if (!Array.isArray(data.platformSupportThreads)) {
    data.platformSupportThreads = [];
  }
  return data.platformSupportThreads;
}

function companyName(data, companyId) {
  const c = (data.companies || []).find((x) => x.id === companyId);
  return c?.nomeFantasia || c?.razaoSocial || c?.nomeCanal || companyId || '—';
}

function slaDeadline(iso) {
  const t = new Date(iso).getTime();
  if (Number.isNaN(t)) return null;
  return new Date(t + SLA_HOURS * 60 * 60 * 1000).toISOString();
}

function isOverdue(thread, now = Date.now()) {
  if (!thread || thread.status !== 'aberto') return false;
  const due = thread.respondBy ? new Date(thread.respondBy).getTime() : NaN;
  return !Number.isNaN(due) && now > due;
}

function enrichThread(thread, now = Date.now()) {
  if (!thread) return null;
  const overdue = isOverdue(thread, now);
  const messages = Array.isArray(thread.messages) ? thread.messages : [];
  const unreadCount = messages.filter(
    (m) => m.direction === 'platform' && m.readByCompany !== true
  ).length;
  return {
    ...thread,
    messages,
    unreadCount,
    overdue,
    slaHours: SLA_HOURS,
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

function canCompanyAccess(user, thread) {
  if (!user || !thread) return false;
  if (user.role === 'superadmin') return true;
  if (!['admin_empresa', 'apurador'].includes(user.role)) return false;
  return user.companyId && user.companyId === thread.companyId;
}

function pushPlatformNotification(data, thread, preview) {
  data.notifications = data.notifications || [];
  const now = new Date().toISOString();
  const previewText = String(preview || '').slice(0, 120);
  const supers = (data.users || []).filter((u) => u.status === 'ativo' && u.role === 'superadmin');
  if (!supers.length) {
    data.notifications.unshift({
      id: store.uid('ntf'),
      type: 'platform_support_message',
      title: 'Nova mensagem de suporte',
      message: `${thread.companyName}: ${previewText}`,
      role: 'superadmin',
      companyId: thread.companyId,
      threadId: thread.id,
      read: false,
      createdAt: now
    });
    return;
  }
  for (const admin of supers) {
    data.notifications.unshift({
      id: store.uid('ntf'),
      type: 'platform_support_message',
      title: 'Nova mensagem de suporte',
      message: `${thread.companyName}: ${previewText}`,
      role: 'superadmin',
      userId: admin.id,
      companyId: thread.companyId,
      threadId: thread.id,
      read: false,
      createdAt: now
    });
  }
}

function clearPlatformPendingNotifications(data, threadId, now = new Date().toISOString()) {
  (data.notifications || []).forEach((n) => {
    if (n.type === 'platform_support_message' && n.threadId === threadId && !n.read) {
      n.read = true;
      n.readAt = now;
      n.clearedByReply = true;
    }
  });
}

function pushCompanyNotification(data, thread, preview) {
  data.notifications = data.notifications || [];
  data.notifications.unshift({
    id: store.uid('ntf'),
    type: 'platform_support_reply',
    title: 'Resposta do suporte da plataforma',
    message: preview,
    companyId: thread.companyId,
    threadId: thread.id,
    read: false,
    createdAt: new Date().toISOString()
  });
}

function notifyEmailSafe(thread, kind) {
  try {
    const notification = require('./notification.service');
    if (kind === 'new' && typeof notification.emitPlatformSupportNew === 'function') {
      notification.emitPlatformSupportNew(thread);
    } else if (kind === 'reply' && typeof notification.emitPlatformSupportReply === 'function') {
      notification.emitPlatformSupportReply(thread);
    }
  } catch {
    /* não bloqueia */
  }
}

function createThread(user, payload = {}) {
  if (!user) return { ok: false, status: 401 };
  if (!['admin_empresa', 'apurador'].includes(user.role)) {
    return { ok: false, status: 403, error: 'Apenas usuários da empresa podem abrir suporte.' };
  }
  if (!user.companyId) {
    return { ok: false, status: 400, error: 'Nenhuma empresa vinculada à sessão.' };
  }

  const subject = sanitizeText(payload.subject || 'Solicitação de suporte', SUBJECT_MAX) || 'Solicitação de suporte';
  const body = sanitizeText(payload.body, MESSAGE_MAX);
  if (!body) return { ok: false, status: 400, error: 'Escreva a mensagem para o suporte.' };
  const categoryRaw = sanitizeText(payload.category || 'suporte_tecnico', 40).toLowerCase();
  const category =
    categoryRaw === 'problema' || categoryRaw === 'suporte_tecnico' ? categoryRaw : 'suporte_tecnico';

  const data = store.load();
  const now = new Date().toISOString();
  const thread = {
    id: store.uid('psup'),
    companyId: user.companyId,
    companyName: companyName(data, user.companyId),
    subject,
    category,
    status: 'aberto',
    createdAt: now,
    updatedAt: now,
    respondBy: slaDeadline(now),
    firstResponseAt: null,
    closedAt: null,
    createdByUserId: user.id,
    createdByName: user.nome || user.email || user.id,
    createdByRole: user.role,
    messages: [
      {
        id: store.uid('psmsg'),
        direction: 'company',
        body,
        actorUserId: user.id,
        actorName: user.nome || user.email || user.id,
        createdAt: now,
        readByCompany: true
      }
    ]
  };

  ensureThreads(data).unshift(thread);
  pushPlatformNotification(data, thread, body.slice(0, 120));
  appendAudit(data, {
    userId: user.id,
    userName: user.nome || user.email || user.id,
    action: 'suporte_plataforma_aberto',
    resourceType: 'platform_support',
    resourceId: thread.id,
    companyId: thread.companyId,
    newValue: { subject: thread.subject }
  });
  store.save(data);
  notifyEmailSafe(thread, 'new');
  return { ok: true, data: enrichThread(thread) };
}

function listThreads(user, filters = {}) {
  if (!user) return { ok: false, status: 401 };
  const data = store.load();
  let list = [...ensureThreads(data)];

  if (user.role === 'superadmin') {
    if (filters.companyId) list = list.filter((t) => t.companyId === filters.companyId);
    if (filters.status) list = list.filter((t) => t.status === filters.status);
  } else if (['admin_empresa', 'apurador'].includes(user.role)) {
    list = list.filter((t) => t.companyId === user.companyId);
  } else {
    return { ok: false, status: 403, error: 'Acesso negado.' };
  }

  const now = Date.now();
  list.sort((a, b) => (a.updatedAt < b.updatedAt ? 1 : -1));
  const threads = list.map((t) => enrichThread(t, now));
  const unreadTotal = threads.reduce((sum, t) => sum + (Number(t.unreadCount) || 0), 0);
  return {
    ok: true,
    data: {
      threads,
      slaHours: SLA_HOURS,
      unreadTotal
    }
  };
}

function getThread(user, threadId) {
  if (!user) return { ok: false, status: 401 };
  const data = store.load();
  const thread = ensureThreads(data).find((t) => t.id === threadId);
  if (!thread || !canCompanyAccess(user, thread)) {
    return { ok: false, status: 404, error: 'Conversa não encontrada.' };
  }
  return { ok: true, data: enrichThread(thread) };
}

function addMessage(user, threadId, payload = {}) {
  if (!user) return { ok: false, status: 401 };
  const body = sanitizeText(payload.body, MESSAGE_MAX);
  if (!body) return { ok: false, status: 400, error: 'Mensagem vazia.' };

  const data = store.load();
  const thread = ensureThreads(data).find((t) => t.id === threadId);
  if (!thread || !canCompanyAccess(user, thread)) {
    return { ok: false, status: 404, error: 'Conversa não encontrada.' };
  }
  if (thread.status === 'fechado') {
    return { ok: false, status: 400, error: 'Esta conversa está fechada.' };
  }

  const isPlatform = user.role === 'superadmin';
  if (!isPlatform && !['admin_empresa', 'apurador'].includes(user.role)) {
    return { ok: false, status: 403, error: 'Acesso negado.' };
  }

  const now = new Date().toISOString();
  const msg = {
    id: store.uid('psmsg'),
    direction: isPlatform ? 'platform' : 'company',
    body,
    actorUserId: user.id,
    actorName: user.nome || user.email || user.id,
    createdAt: now,
    readByCompany: isPlatform ? false : true
  };
  thread.messages = Array.isArray(thread.messages) ? thread.messages : [];
  thread.messages.push(msg);
  thread.updatedAt = now;

  if (isPlatform) {
    if (!thread.firstResponseAt) thread.firstResponseAt = now;
    thread.status = 'respondido';
    thread.lastResponderUserId = user.id;
    thread.lastResponderName = user.nome || user.email || user.id;
    clearPlatformPendingNotifications(data, thread.id, now);
    pushCompanyNotification(data, thread, body.slice(0, 120));
    notifyEmailSafe(thread, 'reply');
  } else {
    thread.status = 'aberto';
    if (!thread.respondBy) thread.respondBy = slaDeadline(now);
    // Nova mensagem da empresa reinicia a expectativa de resposta em 24h
    thread.respondBy = slaDeadline(now);
    pushPlatformNotification(data, thread, body.slice(0, 120));
    notifyEmailSafe(thread, 'new');
  }

  appendAudit(data, {
    userId: user.id,
    userName: user.nome || user.email || user.id,
    action: isPlatform ? 'suporte_plataforma_resposta' : 'suporte_plataforma_mensagem',
    resourceType: 'platform_support',
    resourceId: thread.id,
    companyId: thread.companyId
  });
  store.save(data);
  return { ok: true, data: enrichThread(thread) };
}

function closeThread(user, threadId) {
  if (!user) return { ok: false, status: 401 };
  if (user.role !== 'superadmin') {
    return { ok: false, status: 403, error: 'Apenas o Adm_Plataforma pode fechar conversas.' };
  }
  const data = store.load();
  const thread = ensureThreads(data).find((t) => t.id === threadId);
  if (!thread) return { ok: false, status: 404, error: 'Conversa não encontrada.' };
  const now = new Date().toISOString();
  thread.status = 'fechado';
  thread.closedAt = now;
  thread.updatedAt = now;
  appendAudit(data, {
    userId: user.id,
    userName: user.nome || user.email || user.id,
    action: 'suporte_plataforma_fechado',
    resourceType: 'platform_support',
    resourceId: thread.id,
    companyId: thread.companyId
  });
  store.save(data);
  return { ok: true, data: enrichThread(thread) };
}

/**
 * Marca como lidas as respostas do suporte para a empresa (zera o badge do FAB).
 */
function markCompanyRead(user, threadId = null) {
  if (!user) return { ok: false, status: 401 };
  if (!['admin_empresa', 'apurador'].includes(user.role)) {
    return { ok: false, status: 403, error: 'Acesso negado.' };
  }
  if (!user.companyId) {
    return { ok: false, status: 400, error: 'Nenhuma empresa vinculada à sessão.' };
  }

  const data = store.load();
  const now = new Date().toISOString();
  let marked = 0;
  for (const thread of ensureThreads(data)) {
    if (thread.companyId !== user.companyId) continue;
    if (threadId && thread.id !== threadId) continue;
    const messages = Array.isArray(thread.messages) ? thread.messages : [];
    messages.forEach((m) => {
      if (m.direction === 'platform' && m.readByCompany !== true) {
        m.readByCompany = true;
        m.readByCompanyAt = now;
        marked += 1;
      }
    });
  }

  // Também marca notificações de resposta do suporte
  (data.notifications || []).forEach((n) => {
    if (
      n.type === 'platform_support_reply' &&
      n.companyId === user.companyId &&
      !n.read &&
      (!threadId || n.threadId === threadId)
    ) {
      n.read = true;
      n.readAt = now;
    }
  });

  store.save(data);
  return { ok: true, data: { marked, unreadTotal: 0 } };
}

function submitAssistantFeedback(user, payload = {}) {
  if (!user || !['admin_empresa', 'apurador'].includes(user.role)) {
    return { ok: false, status: 403, error: 'Acesso negado.' };
  }
  if (!user.companyId) {
    return { ok: false, status: 400, error: 'Nenhuma empresa vinculada à sessão.' };
  }

  const categoryRaw = sanitizeText(payload.category || payload.type || '', 40).toLowerCase();
  const isFreeform = categoryRaw === 'sugestao' || categoryRaw === 'reclamacao';
  const category = isFreeform ? categoryRaw : 'avaliacao';
  const subject = sanitizeText(payload.subject, SUBJECT_MAX);
  const message = sanitizeText(payload.message || payload.improvement || payload.body, 2000);

  let rating = null;
  if (isFreeform) {
    if (!message) {
      return {
        ok: false,
        status: 400,
        error: category === 'reclamacao' ? 'Descreva a reclamação.' : 'Descreva a sugestão.'
      };
    }
  } else {
    rating = Number(payload.rating);
    if (!Number.isInteger(rating) || rating < 1 || rating > 5) {
      return { ok: false, status: 400, error: 'Informe uma nota de 1 a 5.' };
    }
    if (rating < 5 && !message) {
      return { ok: false, status: 400, error: 'Descreva o que poderíamos melhorar.' };
    }
  }

  const data = store.load();
  if (!Array.isArray(data.assistantFeedback)) data.assistantFeedback = [];
  const now = new Date().toISOString();
  const entry = {
    id: store.uid('afb'),
    companyId: user.companyId,
    companyName: companyName(data, user.companyId),
    userId: user.id || null,
    userName: user.nome || user.name || user.email || null,
    role: user.role,
    category,
    subject: subject || '',
    rating: isFreeform ? null : rating,
    improvement: isFreeform ? message : rating < 5 ? message : '',
    source:
      sanitizeText(payload.source, 40) ||
      (isFreeform ? `empresa_${category}` : 'assistente_virtual'),
    createdAt: now
  };
  data.assistantFeedback.unshift(entry);
  if (data.assistantFeedback.length > 500) {
    data.assistantFeedback = data.assistantFeedback.slice(0, 500);
  }
  appendAudit(data, {
    userId: user.id,
    userName: entry.userName,
    action: isFreeform ? `empresa_${category}` : 'assistente_feedback',
    resourceType: 'assistant_feedback',
    resourceId: entry.id,
    companyId: user.companyId,
    newValue: {
      category,
      rating: entry.rating,
      hasImprovement: Boolean(entry.improvement)
    }
  });
  store.save(data);
  return {
    ok: true,
    data: { id: entry.id, rating: entry.rating, category: entry.category }
  };
}

function listAssistantFeedback(user, filters = {}) {
  if (!user || user.role !== 'superadmin') {
    return { ok: false, status: 403, error: 'Acesso negado.' };
  }
  const data = store.load();
  let list = [...(data.assistantFeedback || [])];
  const rating = filters.rating != null && filters.rating !== '' ? Number(filters.rating) : null;
  if (Number.isInteger(rating) && rating >= 1 && rating <= 5) {
    list = list.filter((f) => Number(f.rating) === rating);
  }
  if (filters.withImprovement === '1' || filters.withImprovement === true) {
    list = list.filter((f) => String(f.improvement || '').trim());
  }
  if (filters.companyId) {
    list = list.filter((f) => f.companyId === filters.companyId);
  }
  const category = sanitizeText(filters.category || '', 40).toLowerCase();
  if (category) {
    list = list.filter((f) => String(f.category || 'avaliacao').toLowerCase() === category);
  }
  list.sort((a, b) => (a.createdAt < b.createdAt ? 1 : -1));
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
  return {
    ok: true,
    data: {
      items: list.slice(0, 200),
      summary
    }
  };
}

module.exports = {
  SLA_HOURS,
  createThread,
  listThreads,
  getThread,
  addMessage,
  closeThread,
  markCompanyRead,
  enrichThread,
  isOverdue,
  submitAssistantFeedback,
  listAssistantFeedback
};
