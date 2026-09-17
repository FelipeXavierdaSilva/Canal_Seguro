'use strict';

const store = require('../store');
const notification = require('./notification.service');
const bcrypt = require('bcryptjs');
const { permissionsForRole } = require('../utils/tokens');
const { validateStrongPassword } = require('../utils/password');
const { normalizeCpf } = require('../utils/cpf-crypto');

function sanitizeUser(user) {
  const { passwordHash, senha, ...safe } = user;
  return safe;
}

function normalizePhone(value) {
  const text = String(value || '').trim();
  return text || null;
}

function resolveOptionalContact(payload, data, { excludeUserId } = {}) {
  const cpfDigits = normalizeCpf(payload.cpf);
  if (cpfDigits) {
    if (cpfDigits.length !== 11) {
      return { ok: false, status: 400, error: 'CPF deve conter 11 dígitos.' };
    }
    const dup = (data.users || []).some(
      (u) => u.id !== excludeUserId && normalizeCpf(u.cpf) === cpfDigits
    );
    if (dup) {
      return { ok: false, status: 409, error: 'Este CPF já está cadastrado para outro usuário.' };
    }
  }
  const telefone = normalizePhone(payload.telefone);
  if (telefone) {
    const digits = telefone.replace(/\D/g, '');
    if (digits.length < 10) {
      return { ok: false, status: 400, error: 'Tel/WhatsApp inválido.' };
    }
  }
  return {
    ok: true,
    cpf: cpfDigits || null,
    telefone
  };
}

/**
 * Cria usuário no backend e dispara e-mails transacionais (Etapa 06).
 * Stub preparado para migração do CRUD do localStorage.
 */
function createUser(actor, payload) {
  if (!actor || (actor.role !== 'superadmin' && actor.role !== 'admin_empresa')) {
    return { ok: false, status: 403, error: 'Acesso negado.' };
  }

  const data = store.load();
  const username = String(payload.username || '').trim();
  const email = String(payload.email || '').trim().toLowerCase();
  if (!username || !payload.nome) {
    return { ok: false, status: 400, error: 'Nome e usuário (login) são obrigatórios.' };
  }
  if ((data.users || []).some((u) => u.username && u.username.toLowerCase() === username.toLowerCase())) {
    return { ok: false, status: 409, error: 'Usuário já cadastrado.' };
  }
  if (email && (data.users || []).some((u) => u.email && u.email.toLowerCase() === email)) {
    return { ok: false, status: 409, error: 'E-mail já cadastrado.' };
  }

  let role = payload.role || 'admin_empresa';
  let companyId = payload.companyId || null;
  if (actor.role === 'admin_empresa') {
    if (role !== 'admin_empresa' && role !== 'apurador') {
      return {
        ok: false,
        status: 403,
        error: 'Adm_Empresa só pode cadastrar Adm_Empresa ou Apurador da própria empresa.'
      };
    }
    companyId = actor.companyId;
  }
  if (role === 'superadmin' && actor.role !== 'superadmin') {
    return { ok: false, status: 403, error: 'Não é permitido atribuir perfil Adm_Plataforma.' };
  }

  const contact = resolveOptionalContact(payload, data);
  if (!contact.ok) return contact;

  const plainPassword = payload.password || payload.senha || store.uid('tmp');
  if (payload.password || payload.senha) {
    const strengthErr = validateStrongPassword(plainPassword);
    if (strengthErr) return { ok: false, status: 400, error: strengthErr };
  }
  const status = payload.status || 'pendente';
  const user = {
    id: store.uid('usr'),
    nome: String(payload.nome).trim(),
    username,
    email: email || null,
    cpf: contact.cpf,
    telefone: contact.telefone,
    role,
    companyId,
    status,
    passwordHash: bcrypt.hashSync(plainPassword, 10),
    sessionVersion: 1,
    mfa: { enabled: false, secretEnc: null, recoveryCodes: [], enrolledAt: null },
    createdAt: new Date().toISOString()
  };

  data.users.push(user);
  data.auditLogs = data.auditLogs || [];
  data.auditLogs.unshift({
    id: store.uid('aud'),
    date: new Date().toISOString(),
    userId: actor.id,
    userName: actor.nome,
    action: 'criacao_usuario',
    resourceType: 'user',
    resourceId: user.id,
    companyId: user.companyId,
    newValue: { role: user.role, status: user.status, username: user.username }
  });
  store.save(data);

  notification.emitUserCreated({
    user,
    companyId: user.companyId,
    setupUrl: `${require('../config').PUBLIC_APP_URL || 'http://localhost:3000'}/login.html`
  });

  if (status === 'ativo') {
    notification.emitAccountActivation({ user, companyId: user.companyId });
  }

  return { ok: true, user: sanitizeUser(user) };
}

function activateUser(actor, userId) {
  const data = store.load();
  const idx = data.users.findIndex((u) => u.id === userId);
  if (idx < 0) return { ok: false, status: 404, error: 'Usuário não encontrado.' };
  if (actor.role !== 'superadmin' && actor.companyId !== data.users[idx].companyId) {
    return { ok: false, status: 403, error: 'Acesso negado.' };
  }

  const user = data.users[idx];
  if (user.status === 'ativo') {
    return { ok: true, user: sanitizeUser(user), alreadyActive: true };
  }

  user.status = 'ativo';
  user.updatedAt = new Date().toISOString();
  store.save(data);

  notification.emitAccountActivation({ user, companyId: user.companyId });
  return { ok: true, user: sanitizeUser(user) };
}

function listUsers(actor, query = {}) {
  if (!actor || !['superadmin', 'admin_empresa', 'apurador'].includes(actor.role)) {
    return { ok: false, status: 403, error: 'Acesso negado.' };
  }
  const data = store.load();
  let list = (data.users || []).map(sanitizeUser);
  if (actor.role !== 'superadmin') {
    list = list.filter((u) => u.companyId === actor.companyId);
  } else if (query.companyId) {
    list = list.filter((u) => u.companyId === query.companyId);
  }
  if (query.role) list = list.filter((u) => u.role === query.role);
  if (query.status) list = list.filter((u) => u.status === query.status);
  return { ok: true, users: list };
}

function getUser(actor, userId) {
  if (!actor) return { ok: false, status: 401, error: 'Não autenticado.' };
  const data = store.load();
  const user = (data.users || []).find((u) => u.id === userId);
  if (!user) return { ok: false, status: 404, error: 'Usuário não encontrado.' };
  if (actor.role !== 'superadmin' && user.companyId !== actor.companyId) {
    return { ok: false, status: 404, error: 'Usuário não encontrado.' };
  }
  return { ok: true, user: sanitizeUser(user) };
}

function updateUser(actor, userId, payload = {}) {
  if (!actor || (actor.role !== 'superadmin' && actor.role !== 'admin_empresa')) {
    return { ok: false, status: 403, error: 'Acesso negado.' };
  }
  const { isProtectedUser } = require('../utils/protected-user');
  const data = store.load();
  const idx = (data.users || []).findIndex((u) => u.id === userId);
  if (idx < 0) return { ok: false, status: 404, error: 'Usuário não encontrado.' };
  const previous = data.users[idx];
  if (actor.role !== 'superadmin' && previous.companyId !== actor.companyId) {
    return { ok: false, status: 403, error: 'Acesso negado.' };
  }
  if (isProtectedUser(previous)) {
    if (payload.role !== undefined && payload.role !== previous.role) {
      return { ok: false, status: 403, error: 'Não é permitido alterar o perfil do administrador protegido.' };
    }
    if (payload.status !== undefined && payload.status !== 'ativo') {
      return { ok: false, status: 403, error: 'Não é permitido desativar o administrador protegido.' };
    }
    if (
      payload.email !== undefined &&
      String(payload.email).trim().toLowerCase() !== String(previous.email || '').toLowerCase()
    ) {
      return { ok: false, status: 403, error: 'Não é permitido alterar o e-mail do administrador protegido.' };
    }
  }

  const next = { ...previous };
  if (payload.nome !== undefined) next.nome = String(payload.nome).trim();
  if (payload.username !== undefined) {
    const username = String(payload.username || '').trim();
    if (!username) return { ok: false, status: 400, error: 'Usuário (login) é obrigatório.' };
    const dup = (data.users || []).some(
      (u) => u.id !== userId && u.username && u.username.toLowerCase() === username.toLowerCase()
    );
    if (dup) return { ok: false, status: 409, error: 'Usuário já cadastrado.' };
    next.username = username;
  }
  if (payload.email !== undefined) {
    const email = String(payload.email || '').trim().toLowerCase();
    if (email) {
      const dup = (data.users || []).some(
        (u) => u.id !== userId && u.email && u.email.toLowerCase() === email
      );
      if (dup) return { ok: false, status: 409, error: 'E-mail já cadastrado.' };
    }
    next.email = email || null;
  }
  if (payload.status !== undefined) next.status = payload.status;

  if (actor.role === 'admin_empresa') {
    next.companyId = actor.companyId;
    if (previous.id === actor.id) next.role = 'admin_empresa';
    else if (payload.role !== undefined) {
      next.role = payload.role === 'admin_empresa' ? 'admin_empresa' : 'apurador';
    }
  } else {
    if (payload.role !== undefined) {
      if (payload.role === 'superadmin' && actor.role !== 'superadmin') {
        return { ok: false, status: 403, error: 'Não é permitido atribuir perfil Adm_Plataforma.' };
      }
      next.role = payload.role;
    }
    if (payload.companyId !== undefined) next.companyId = payload.companyId || null;
  }

  if (payload.cpf !== undefined || payload.telefone !== undefined) {
    const contact = resolveOptionalContact(
      {
        cpf: payload.cpf !== undefined ? payload.cpf : previous.cpf,
        telefone: payload.telefone !== undefined ? payload.telefone : previous.telefone
      },
      data,
      { excludeUserId: userId }
    );
    if (!contact.ok) return contact;
    next.cpf = contact.cpf;
    next.telefone = contact.telefone;
  }

  const plainPassword = payload.password || payload.senha;
  if (plainPassword) {
    const strengthErr = validateStrongPassword(plainPassword);
    if (strengthErr) return { ok: false, status: 400, error: strengthErr };
    next.passwordHash = bcrypt.hashSync(plainPassword, 10);
    next.sessionVersion = (next.sessionVersion || 1) + 1;
  }

  next.updatedAt = new Date().toISOString();
  data.users[idx] = next;
  data.auditLogs = data.auditLogs || [];
  data.auditLogs.unshift({
    id: store.uid('aud'),
    date: new Date().toISOString(),
    userId: actor.id,
    userName: actor.nome,
    action: 'edicao_usuario',
    resourceType: 'user',
    resourceId: userId,
    companyId: next.companyId,
    previousValue: { role: previous.role, status: previous.status, username: previous.username },
    newValue: { role: next.role, status: next.status, username: next.username }
  });
  store.save(data);
  return { ok: true, user: sanitizeUser(next) };
}

module.exports = {
  createUser,
  activateUser,
  listUsers,
  getUser,
  updateUser,
  sanitizeUser,
  permissionsForRole
};
