'use strict';

const store = require('../store');
const { appendAudit } = require('./audit.service');
const { assertNotProtectedUser, isProtectedUser } = require('../utils/protected-user');
const { getStorage } = require('./storage');

function requireSuperadmin(actor) {
  if (!actor || actor.role !== 'superadmin') {
    return { ok: false, status: 403, error: 'Operação restrita ao administrador da plataforma.' };
  }
  return null;
}

function cascadeCompanyData(data, companyId) {
  const reportIds = new Set(
    (data.reports || []).filter((r) => r.companyId === companyId).map((r) => r.id)
  );

  data.reports = (data.reports || []).filter((r) => r.companyId !== companyId);
  data.reportHistory = (data.reportHistory || []).filter((h) => !reportIds.has(h.reportId));
  data.reportMessages = (data.reportMessages || []).filter((m) => !reportIds.has(m.reportId));
  data.reportRiskHistory = (data.reportRiskHistory || []).filter(
    (h) => h.companyId !== companyId && !reportIds.has(h.reportId)
  );
  data.employees = (data.employees || []).filter((e) => e.companyId !== companyId);
  data.users = (data.users || []).filter(
    (u) => u.companyId !== companyId || isProtectedUser(u)
  );
  data.contents = (data.contents || []).filter((c) => c.companyId !== companyId);
  data.notifications = (data.notifications || []).filter((n) => n.companyId !== companyId);
  if (data.companySettings && data.companySettings[companyId]) {
    delete data.companySettings[companyId];
  }
  data.companies = (data.companies || []).filter((c) => c.id !== companyId);

  try {
    getStorage().clearPrefix(`attachments/${companyId}`);
  } catch {
    /* ignore missing storage */
  }

  return { reportCount: reportIds.size };
}

function deleteUser(actor, userId) {
  const denied = requireSuperadmin(actor);
  if (denied) return denied;

  const data = store.load();
  const idx = (data.users || []).findIndex((u) => u.id === userId);
  if (idx < 0) return { ok: false, status: 404, error: 'Usuário não encontrado.' };

  const user = data.users[idx];
  try {
    assertNotProtectedUser(user, 'excluir');
  } catch (err) {
    return { ok: false, status: err.status || 403, error: err.message };
  }

  if (actor.id && actor.id === user.id) {
    return { ok: false, status: 400, error: 'Você não pode excluir a própria conta em uso.' };
  }

  const snapshot = {
    nome: user.nome,
    username: user.username,
    email: user.email,
    role: user.role,
    companyId: user.companyId
  };
  data.users.splice(idx, 1);
  appendAudit(data, {
    userId: actor.id,
    userName: actor.nome,
    action: 'exclusao_usuario',
    resourceType: 'user',
    resourceId: userId,
    companyId: snapshot.companyId || null,
    previousValue: snapshot
  });
  store.save(data);
  return { ok: true, deleted: snapshot };
}

function deleteEmployee(actor, employeeId) {
  if (!actor) return { ok: false, status: 401, error: 'Não autenticado.' };
  if (actor.role !== 'superadmin' && actor.role !== 'admin_empresa') {
    return { ok: false, status: 403, error: 'Acesso negado.' };
  }

  const data = store.load();
  const idx = (data.employees || []).findIndex((e) => e.id === employeeId);
  if (idx < 0) return { ok: false, status: 404, error: 'Colaborador não encontrado.' };

  const emp = data.employees[idx];
  if (actor.role !== 'superadmin' && actor.companyId !== emp.companyId) {
    return { ok: false, status: 403, error: 'Acesso negado.' };
  }

  const snapshot = {
    nome: emp.nome,
    companyId: emp.companyId,
    matricula: emp.matricula || null
  };
  data.employees.splice(idx, 1);
  appendAudit(data, {
    userId: actor.id,
    userName: actor.nome,
    action: 'exclusao_colaborador',
    resourceType: 'employee',
    resourceId: employeeId,
    companyId: emp.companyId,
    previousValue: snapshot
  });
  store.save(data);
  return { ok: true, deleted: snapshot };
}

function deleteCompany(actor, companyId) {
  const denied = requireSuperadmin(actor);
  if (denied) return denied;

  const data = store.load();
  const company = (data.companies || []).find((c) => c.id === companyId);
  if (!company) return { ok: false, status: 404, error: 'Empresa não encontrada.' };

  const protectedOnCompany = (data.users || []).filter(
    (u) => u.companyId === companyId && isProtectedUser(u)
  );
  if (protectedOnCompany.length) {
    return {
      ok: false,
      status: 409,
      error:
        'Não é possível excluir a empresa: há um administrador protegido vinculado a ela.'
    };
  }

  const snapshot = {
    nomeFantasia: company.nomeFantasia,
    razaoSocial: company.razaoSocial,
    cnpj: company.cnpj
  };
  const cascade = cascadeCompanyData(data, companyId);
  appendAudit(data, {
    userId: actor.id,
    userName: actor.nome,
    action: 'exclusao_empresa',
    resourceType: 'company',
    resourceId: companyId,
    companyId: null,
    previousValue: { ...snapshot, reportsRemoved: cascade.reportCount }
  });
  store.save(data);
  return { ok: true, deleted: snapshot, cascade };
}

/**
 * Remove apenas logs de login/logout (acessos). Auditoria de negócio permanece imutável.
 */
function deleteAccessLog(actor, logId) {
  if (!actor) return { ok: false, status: 401, error: 'Não autenticado.' };
  if (actor.role !== 'superadmin' && actor.role !== 'admin_empresa') {
    return { ok: false, status: 403, error: 'Acesso negado.' };
  }

  const data = store.load();
  const idx = (data.auditLogs || []).findIndex((l) => l.id === logId);
  if (idx < 0) return { ok: false, status: 404, error: 'Registro de acesso não encontrado.' };

  const log = data.auditLogs[idx];
  if (log.action !== 'login' && log.action !== 'logout') {
    return {
      ok: false,
      status: 400,
      error: 'Somente registros de login/logout podem ser excluídos nesta tela.'
    };
  }
  if (actor.role !== 'superadmin') {
    if (!log.companyId || log.companyId !== actor.companyId) {
      return { ok: false, status: 403, error: 'Acesso negado.' };
    }
  }

  data.auditLogs.splice(idx, 1);
  appendAudit(data, {
    userId: actor.id,
    userName: actor.nome,
    action: 'exclusao_acesso',
    resourceType: 'access_log',
    resourceId: logId,
    companyId: log.companyId || actor.companyId || null,
    previousValue: { action: log.action, userId: log.userId, date: log.date }
  });
  store.save(data);
  return { ok: true };
}

module.exports = {
  deleteUser,
  deleteEmployee,
  deleteCompany,
  deleteAccessLog,
  cascadeCompanyData
};
