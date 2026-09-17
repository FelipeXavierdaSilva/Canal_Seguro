'use strict';

const store = require('../store');

function canRead(actor) {
  return actor && ['superadmin', 'admin_empresa', 'apurador'].includes(actor.role);
}

function canWrite(actor, companyId) {
  if (!actor) return false;
  if (actor.role === 'superadmin') return true;
  if (actor.role === 'admin_empresa' && companyId && actor.companyId === companyId) return true;
  return false;
}

function listContents(actor, query = {}) {
  if (!canRead(actor)) return { ok: false, status: 403, error: 'Acesso negado.' };
  const data = store.load();
  let list = [...(data.contents || [])];
  if (query.globalOnly) list = list.filter((c) => !c.companyId);
  if (query.type) list = list.filter((c) => c.type === query.type);
  if (query.status) list = list.filter((c) => c.status === query.status);
  if (query.companyId) {
    list = list.filter((c) => !c.companyId || c.companyId === query.companyId);
  } else if (actor.role !== 'superadmin') {
    list = list.filter((c) => !c.companyId || c.companyId === actor.companyId);
  }
  list.sort((a, b) => {
    const ao = Number.isFinite(a.sortOrder) ? a.sortOrder : 9999;
    const bo = Number.isFinite(b.sortOrder) ? b.sortOrder : 9999;
    if (ao !== bo) return ao - bo;
    return String(a.title || '').localeCompare(String(b.title || ''), 'pt-BR');
  });
  return { ok: true, contents: list };
}

function createContent(actor, payload = {}) {
  const companyId = payload.companyId || null;
  if (companyId) {
    if (!canWrite(actor, companyId)) return { ok: false, status: 403, error: 'Acesso negado.' };
  } else if (!actor || actor.role !== 'superadmin') {
    return { ok: false, status: 403, error: 'Apenas Adm_Plataforma cria conteúdo global.' };
  }
  const data = store.load();
  data.contents = data.contents || [];
  const content = {
    id: store.uid('cnt'),
    type: payload.type || 'faq',
    title: String(payload.title || '').trim(),
    body: payload.body || '',
    status: payload.status || 'publicado',
    slug: payload.slug ? String(payload.slug).trim() : null,
    sortOrder: Number.isFinite(Number(payload.sortOrder)) ? Number(payload.sortOrder) : null,
    companyId,
    createdAt: new Date().toISOString()
  };
  if (!content.title) return { ok: false, status: 400, error: 'Título é obrigatório.' };
  data.contents.push(content);
  data.auditLogs = data.auditLogs || [];
  data.auditLogs.unshift({
    id: store.uid('aud'),
    date: new Date().toISOString(),
    userId: actor.id,
    userName: actor.nome,
    action: 'criacao_conteudo',
    resourceType: 'content',
    resourceId: content.id,
    companyId: content.companyId || null
  });
  store.save(data);
  return { ok: true, content };
}

function updateContent(actor, contentId, payload = {}) {
  const data = store.load();
  const idx = (data.contents || []).findIndex((c) => c.id === contentId);
  if (idx < 0) return { ok: false, status: 404, error: 'Conteúdo não encontrado.' };
  const previous = data.contents[idx];
  if (previous.companyId) {
    if (!canWrite(actor, previous.companyId)) return { ok: false, status: 403, error: 'Acesso negado.' };
  } else if (!actor || actor.role !== 'superadmin') {
    return { ok: false, status: 403, error: 'Acesso negado.' };
  }
  const next = { ...previous };
  if (payload.title !== undefined) next.title = String(payload.title || '').trim();
  if (payload.body !== undefined) next.body = payload.body;
  if (payload.type !== undefined) next.type = payload.type;
  if (payload.status !== undefined) next.status = payload.status;
  if (payload.slug !== undefined) next.slug = payload.slug ? String(payload.slug).trim() : null;
  if (payload.sortOrder !== undefined) {
    next.sortOrder =
      payload.sortOrder === '' || payload.sortOrder === null
        ? null
        : Number(payload.sortOrder);
  }
  if (payload.companyId !== undefined && payload.companyId !== previous.companyId) {
    if (payload.companyId) {
      if (!canWrite(actor, payload.companyId)) return { ok: false, status: 403, error: 'Acesso negado.' };
    } else if (actor.role !== 'superadmin') {
      return { ok: false, status: 403, error: 'Acesso negado.' };
    }
    next.companyId = payload.companyId || null;
  }
  data.contents[idx] = next;
  data.auditLogs = data.auditLogs || [];
  data.auditLogs.unshift({
    id: store.uid('aud'),
    date: new Date().toISOString(),
    userId: actor.id,
    userName: actor.nome,
    action: 'edicao_conteudo',
    resourceType: 'content',
    resourceId: contentId,
    companyId: next.companyId || null
  });
  store.save(data);
  return { ok: true, content: next };
}

function deleteContent(actor, contentId) {
  const data = store.load();
  const idx = (data.contents || []).findIndex((c) => c.id === contentId);
  if (idx < 0) return { ok: false, status: 404, error: 'Conteúdo não encontrado.' };
  const previous = data.contents[idx];
  if (previous.companyId) {
    if (!canWrite(actor, previous.companyId)) return { ok: false, status: 403, error: 'Acesso negado.' };
  } else if (!actor || actor.role !== 'superadmin') {
    return { ok: false, status: 403, error: 'Acesso negado.' };
  }
  data.contents.splice(idx, 1);
  data.auditLogs = data.auditLogs || [];
  data.auditLogs.unshift({
    id: store.uid('aud'),
    date: new Date().toISOString(),
    userId: actor.id,
    userName: actor.nome,
    action: 'exclusao_conteudo',
    resourceType: 'content',
    resourceId: contentId,
    companyId: previous.companyId || null
  });
  store.save(data);
  return { ok: true, deleted: true, id: contentId };
}

module.exports = { listContents, createContent, updateContent, deleteContent };
