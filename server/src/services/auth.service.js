'use strict';

const bcrypt = require('bcryptjs');
const store = require('../store');
const config = require('../config');
const { verifyToken } = require('../utils/tokens');
const mfaPolicy = require('./mfa-policy.service');
const mfaService = require('./mfa.service');

function sanitizeUser(user) {
  if (!user) return null;
  return mfaService.sanitizeUserPublic(user);
}

function findUserByLogin(input) {
  const data = store.load();
  const norm = String(input).toLowerCase();
  return (data.users || []).find(
    (u) =>
      ((u.username && u.username.toLowerCase() === norm) ||
       (u.email && u.email.toLowerCase() === norm)) &&
      u.status === 'ativo'
  );
}

function login(email, password) {
  const user = findUserByLogin(email);
  if (!user || !user.passwordHash || !bcrypt.compareSync(password, user.passwordHash)) {
    return { ok: false, reason: 'invalid_credentials' };
  }
  const data = store.load();
  const decision = mfaService.loginPhaseResult(user, data);
  return { ok: true, ...decision };
}

function sessionFromRequest(req) {
  const token = req.cookies?.[config.SESSION_COOKIE] || bearerToken(req);
  if (!token) return null;
  const payload = verifyToken(token);
  if (!payload || payload.typ !== 'admin') return null;
  const data = store.reload();
  const user = (data.users || []).find((u) => u.id === payload.sub && u.status === 'ativo');
  if (!user) return null;
  const expectedSv = user.sessionVersion || 1;
  if ((payload.sv || 1) !== expectedSv) return null;
  if (mfaPolicy.mfaRequiredForUser(user, data) && !payload.mfa) return null;
  return {
    id: user.id,
    nome: user.nome,
    email: user.email,
    role: user.role,
    companyId: user.companyId || null,
    mfaVerified: Boolean(payload.mfa)
  };
}

function employeeFromRequest(req) {
  const token =
    req.cookies?.[config.EMPLOYEE_COOKIE] ||
    req.headers['x-employee-token'] ||
    bearerToken(req);
  if (!token) return null;
  const payload = verifyToken(token);
  if (!payload || payload.typ !== 'employee') return null;
  return {
    employeeId: payload.sub,
    companyId: payload.companyId
  };
}

function bearerToken(req) {
  const h = req.headers.authorization || '';
  if (h.startsWith('Bearer ')) return h.slice(7);
  return null;
}

function issueEmployeeToken(employeeId, companyId) {
  const { signToken } = require('../utils/tokens');
  return signToken({ typ: 'employee', sub: employeeId, companyId }, config.EMPLOYEE_TTL_MS);
}

function logout(req) {
  const session = sessionFromRequest(req);
  if (session) {
    const data = store.load();
    const user = (data.users || []).find((u) => u.id === session.id);
    if (user) {
      user.sessionVersion = (user.sessionVersion || 1) + 1;
    }
    data.auditLogs = data.auditLogs || [];
    data.auditLogs.unshift({
      id: store.uid('aud'),
      date: new Date().toISOString(),
      userId: session.id,
      userName: session.nome,
      action: 'logout',
      resourceType: 'session',
      companyId: session.companyId || null,
      newValue: { sessionInvalidated: true }
    });
    store.save(data);
  }
  return { ok: true };
}

function meFromRequest(req) {
  if (!req.user) return null;
  const data = store.load();
  const user = (data.users || []).find((u) => u.id === req.user.id);
  if (!user) return null;
  return {
    user: sanitizeUser(user),
    mfa: mfaService.getStatus(user, data)
  };
}

module.exports = {
  login,
  logout,
  sessionFromRequest,
  employeeFromRequest,
  issueEmployeeToken,
  sanitizeUser,
  meFromRequest,
  hashIdentifier: require('../utils/tokens').hashIdentifier
};
