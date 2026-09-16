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
  if (!actor || actor.role !== 'superadmin') {
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
    role: payload.role || 'admin_empresa',
    companyId: payload.companyId || null,
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
    companyId: user.companyId
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

module.exports = { createUser, activateUser, sanitizeUser, permissionsForRole };
