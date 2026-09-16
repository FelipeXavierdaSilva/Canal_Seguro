'use strict';

const store = require('../store');
const config = require('../config');
const {
  normalizeCpf,
  cpfMaskedFromDigits,
  employeeMatchesCpf
} = require('../utils/cpf-crypto');
const { hashIdentifier } = require('../utils/tokens');
const { normalizeTrackingCode, verifyTrackingCode } = require('../utils/tracking-crypto');
const reportMessages = require('./report-messages.service');
const { gateBlocked, recordFailure, clearGate } = require('../utils/rate-limit-gate');

function getClientKey(req) {
  return req.ip || req.headers['x-forwarded-for']?.split(',')[0]?.trim() || 'unknown';
}

async function consultGate(req) {
  const key = getClientKey(req);
  const cfg = config.PUBLIC_CONSULT || { WINDOW_MS: 15 * 60 * 1000, MAX_FAILURES: 5, BLOCK_MS: 5 * 60 * 1000 };
  const blockKey = `consult:block:${key}`;

  const blocked = await gateBlocked(blockKey, 1, cfg.BLOCK_MS);
  if (blocked.blocked) {
    return { allowed: false, blocked: true, retryAfterMs: blocked.retryAfterMs };
  }

  return { allowed: true, blocked: false, key, cfg, blockKey };
}

async function recordConsultFailure(gate) {
  const { key, cfg, blockKey } = gate;
  const failKey = `consult:fail:${key}`;
  const { count } = await recordFailure(failKey, cfg.WINDOW_MS);
  if (count >= cfg.MAX_FAILURES) {
    await recordFailure(blockKey, cfg.BLOCK_MS);
    await clearGate(failKey);
  }
}

async function recordConsultSuccess(gate) {
  await clearGate(`consult:fail:${gate.key}`);
}

function categoryLabel(categories, id) {
  const c = categories.find((x) => x.id === id);
  return c ? c.label : id;
}

async function publicConsult(req, protocol, trackingCode) {
  const gate = await consultGate(req);
  if (!gate.allowed) {
    return { ok: false, status: 429, generic: true, retryAfterMs: gate.retryAfterMs };
  }

  const auth = reportMessages.authenticateConsult(protocol, trackingCode);
  if (!auth.ok) {
    await recordConsultFailure(gate);
    return { ok: false, status: 404, generic: true };
  }

  await recordConsultSuccess(gate);
  const { report } = auth;
  const data = store.load();

  const unreadCount = reportMessages.unreadCount(report.id, 'reporter');

  return {
    ok: true,
    report,
    data: {
      protocol: report.protocol,
      status: report.status,
      createdAt: report.createdAt,
      updatedAt: report.updatedAt,
      categoryLabel: categoryLabel(data.categories || [], report.category),
      hasNewMessages: unreadCount > 0,
      unreadCount
    }
  };
}

function validateEmployee(companyId, cpf) {
  const digits = normalizeCpf(cpf);
  if (digits.length !== 11) {
    return { ok: false, code: 'invalid_cpf' };
  }
  const data = store.load();
  const companies = data.companies || [];
  const employees = data.employees || [];

  let emp = null;
  let company = null;

  if (companyId) {
    company = companies.find((c) => c.id === companyId && c.status === 'ativo');
    if (!company) {
      return { ok: false, code: 'not_found' };
    }
    emp = employees.find(
      (e) => e.companyId === companyId && employeeMatchesCpf(e, digits)
    );
  } else {
    const matches = employees.filter((e) => employeeMatchesCpf(e, digits));
    const active = matches.filter((e) => {
      if (e.status !== 'ativo') return false;
      const c = companies.find((x) => x.id === e.companyId && x.status === 'ativo');
      return Boolean(c);
    });
    if (!active.length) {
      return { ok: false, code: 'not_found' };
    }
    emp = active[0];
    company = companies.find((c) => c.id === emp.companyId);
  }

  if (!emp) {
    return { ok: false, code: 'not_found' };
  }
  if (emp.status !== 'ativo') {
    return { ok: false, code: 'inactive' };
  }
  return {
    ok: true,
    employee: {
      id: emp.id,
      nome: emp.nome,
      companyId: emp.companyId,
      setor: emp.setor,
      cargo: emp.cargo,
      email: emp.email || '',
      telefone: emp.telefone || '',
      cpfMasked: cpfMaskedFromDigits(digits)
    }
  };
}

function resetConsultGateForTests() {
  const { resetAllForTests } = require('../utils/rate-limit-gate');
  return resetAllForTests();
}

module.exports = {
  publicConsult,
  validateEmployee,
  hashIdentifier,
  normalizeTrackingCode,
  verifyTrackingCode,
  resetConsultGateForTests
};
