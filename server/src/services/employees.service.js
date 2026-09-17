'use strict';

const store = require('../store');
const {
  normalizeCpf,
  hashCpf,
  employeeMatchesCpf,
  sanitizeEmployeeRecord
} = require('../utils/cpf-crypto');

function toPublicEmployee(emp) {
  if (!emp) return null;
  const base = sanitizeEmployeeRecord(emp);
  return {
    ...base,
    cpfMasked: '***.***.***-**',
    hasCpf: Boolean(emp.cpfHash || emp.cpf)
  };
}

function assertTenant(actor, companyId) {
  if (!actor) return { ok: false, status: 401, error: 'Não autenticado.' };
  if (actor.role === 'superadmin') return { ok: true };
  if (actor.role === 'admin_empresa' && actor.companyId === companyId) return { ok: true };
  return { ok: false, status: 403, error: 'Acesso negado.' };
}

function listEmployees(actor, query = {}) {
  if (!actor || !['superadmin', 'admin_empresa', 'apurador'].includes(actor.role)) {
    return { ok: false, status: 403, error: 'Acesso negado.' };
  }
  const data = store.load();
  let list = [...(data.employees || [])];
  const companyId =
    actor.role === 'superadmin' ? query.companyId || null : actor.companyId;
  if (companyId) list = list.filter((e) => e.companyId === companyId);
  else if (actor.role !== 'superadmin') list = [];
  if (query.status) list = list.filter((e) => e.status === query.status);
  if (query.q) {
    const q = String(query.q).toLowerCase();
    const qCpf = normalizeCpf(q);
    list = list.filter(
      (e) =>
        String(e.nome || '')
          .toLowerCase()
          .includes(q) ||
        (qCpf.length >= 3 && employeeMatchesCpf(e, qCpf)) ||
        String(e.matricula || '')
          .toLowerCase()
          .includes(q) ||
        String(e.setor || '')
          .toLowerCase()
          .includes(q)
    );
  }
  return { ok: true, employees: list.map(toPublicEmployee) };
}

function getEmployee(actor, employeeId) {
  if (!actor) return { ok: false, status: 401, error: 'Não autenticado.' };
  const data = store.load();
  const emp = (data.employees || []).find((e) => e.id === employeeId);
  if (!emp) return { ok: false, status: 404, error: 'Colaborador não encontrado.' };
  const scope = assertTenant(actor, emp.companyId);
  if (!scope.ok) return { ok: false, status: 404, error: 'Colaborador não encontrado.' };
  return { ok: true, employee: toPublicEmployee(emp) };
}

function createEmployee(actor, payload = {}) {
  if (!actor || (actor.role !== 'superadmin' && actor.role !== 'admin_empresa')) {
    return { ok: false, status: 403, error: 'Acesso negado.' };
  }
  let companyId = payload.companyId || null;
  if (actor.role === 'admin_empresa') companyId = actor.companyId;
  if (!companyId) return { ok: false, status: 400, error: 'Empresa obrigatória.' };
  const scope = assertTenant(actor, companyId);
  if (!scope.ok) return scope;

  const digits = normalizeCpf(payload.cpf);
  if (digits.length !== 11) return { ok: false, status: 400, error: 'CPF deve conter 11 dígitos.' };
  const cpfHash = hashCpf(digits);
  const data = store.load();
  data.employees = data.employees || [];
  const dup = data.employees.find((e) => e.companyId === companyId && employeeMatchesCpf(e, digits));
  if (dup) return { ok: false, status: 409, error: 'Este CPF já está cadastrado nesta empresa.' };

  const employee = {
    id: store.uid('emp'),
    companyId,
    cpfHash,
    nome: String(payload.nome || '').trim(),
    email: payload.email || '',
    telefone: payload.telefone || '',
    matricula: payload.matricula || '',
    setor: payload.setor || '',
    cargo: payload.cargo || '',
    status: payload.status || 'ativo',
    createdAt: new Date().toISOString()
  };
  if (!employee.nome) return { ok: false, status: 400, error: 'Nome é obrigatório.' };

  data.employees.push(employee);
  data.auditLogs = data.auditLogs || [];
  data.auditLogs.unshift({
    id: store.uid('aud'),
    date: new Date().toISOString(),
    userId: actor.id,
    userName: actor.nome,
    action: 'criacao_colaborador',
    resourceType: 'employee',
    resourceId: employee.id,
    companyId
  });
  store.save(data);
  return { ok: true, employee: toPublicEmployee(employee) };
}

function updateEmployee(actor, employeeId, payload = {}) {
  if (!actor || (actor.role !== 'superadmin' && actor.role !== 'admin_empresa')) {
    return { ok: false, status: 403, error: 'Acesso negado.' };
  }
  const data = store.load();
  const idx = (data.employees || []).findIndex((e) => e.id === employeeId);
  if (idx < 0) return { ok: false, status: 404, error: 'Colaborador não encontrado.' };
  const current = data.employees[idx];
  const scope = assertTenant(actor, current.companyId);
  if (!scope.ok) return scope;

  const next = { ...current };
  if (payload.nome !== undefined) next.nome = String(payload.nome || '').trim();
  if (payload.email !== undefined) next.email = payload.email || '';
  if (payload.telefone !== undefined) next.telefone = payload.telefone || '';
  if (payload.matricula !== undefined) next.matricula = payload.matricula || '';
  if (payload.setor !== undefined) next.setor = payload.setor || '';
  if (payload.cargo !== undefined) next.cargo = payload.cargo || '';
  if (payload.status !== undefined) next.status = payload.status;

  if (payload.cpf) {
    const digits = normalizeCpf(payload.cpf);
    if (digits.length !== 11) return { ok: false, status: 400, error: 'CPF deve conter 11 dígitos.' };
    const dup = data.employees.find(
      (e) => e.id !== employeeId && e.companyId === current.companyId && employeeMatchesCpf(e, digits)
    );
    if (dup) return { ok: false, status: 409, error: 'Este CPF já está cadastrado nesta empresa.' };
    next.cpfHash = hashCpf(digits);
    delete next.cpf;
  }

  const statusChanged = payload.status && payload.status !== current.status;
  data.employees[idx] = next;
  data.auditLogs = data.auditLogs || [];
  data.auditLogs.unshift({
    id: store.uid('aud'),
    date: new Date().toISOString(),
    userId: actor.id,
    userName: actor.nome,
    action: statusChanged && payload.status === 'desligado' ? 'desativacao_colaborador' : 'edicao_colaborador',
    resourceType: 'employee',
    resourceId: employeeId,
    companyId: current.companyId
  });
  store.save(data);
  return { ok: true, employee: toPublicEmployee(next) };
}

module.exports = {
  listEmployees,
  getEmployee,
  createEmployee,
  updateEmployee,
  toPublicEmployee
};
