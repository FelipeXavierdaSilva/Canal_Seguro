'use strict';

const crypto = require('crypto');
const bcrypt = require('bcryptjs');
const { authenticator } = require('otplib');
const store = require('../store');
const config = require('../config');
const { signToken, verifyToken, hashIdentifier } = require('../utils/tokens');
const { encryptSecret, decryptSecret } = require('../utils/mfa-crypto');
const mfaPolicy = require('./mfa-policy.service');
const { gateAttempt } = require('../utils/rate-limit-gate');
const { appendAudit } = require('./audit.service');

authenticator.options = { window: 1 };

const RECOVERY_CODE_COUNT = 10;

function sleep(ms) {
  return new Promise((r) => setTimeout(r, ms));
}

function clientIp(req) {
  return req.ip || req.headers['x-forwarded-for']?.split(',')[0]?.trim() || 'unknown';
}

function resetRateLimitsForTests() {
  const { resetAllForTests } = require('../utils/rate-limit-gate');
  return resetAllForTests();
}

function writeAudit(data, entry) {
  appendAudit(data, entry);
}

function ensureMfa(user) {
  if (!user.mfa) user.mfa = { enabled: false, secretEnc: null, recoveryCodes: [], enrolledAt: null };
  if (!user.mfa.recoveryCodes) user.mfa.recoveryCodes = [];
  return user.mfa;
}

function sanitizeUserPublic(user) {
  const { passwordHash, senha, mfa, ...safe } = user;
  return {
    ...safe,
    mfaEnabled: Boolean(mfa?.enabled)
  };
}

function issueAdminSession(user, mfaVerified = false) {
  return signToken(
    {
      typ: 'admin',
      sub: user.id,
      role: user.role,
      companyId: user.companyId || null,
      nome: user.nome,
      email: user.email,
      sv: user.sessionVersion || 1,
      mfa: Boolean(mfaVerified)
    },
    config.SESSION_TTL_MS
  );
}

function issueMfaPendingToken(user, purpose = 'verify') {
  return signToken(
    {
      typ: 'mfa_pending',
      sub: user.id,
      purpose,
      email: user.email
    },
    purpose === 'enroll' ? config.MFA.ENROLL_TTL_MS : config.MFA.PENDING_TTL_MS
  );
}

function userFromMfaPending(req) {
  const token = req.cookies?.[config.MFA_PENDING_COOKIE] || bearerFromReq(req);
  if (!token) return null;
  const payload = verifyToken(token);
  if (!payload || payload.typ !== 'mfa_pending') return null;
  const data = store.reload();
  const user = (data.users || []).find((u) => u.id === payload.sub && u.status === 'ativo');
  if (!user) return null;
  return { user, payload };
}

function bearerFromReq(req) {
  const h = req.headers.authorization || '';
  if (h.startsWith('Bearer ')) return h.slice(7);
  return null;
}

function getSecretPlain(user) {
  return decryptSecret(user.mfa?.secretEnc);
}

function verifyTotp(user, code) {
  const secret = getSecretPlain(user);
  if (!secret) return false;
  try {
    return authenticator.verify({ token: String(code).replace(/\s/g, ''), secret });
  } catch {
    return false;
  }
}

function generateRecoveryCodes() {
  const chars = 'ABCDEFGHJKLMNPQRSTUVWXYZ23456789';
  const codes = [];
  for (let i = 0; i < RECOVERY_CODE_COUNT; i++) {
    let part1 = '';
    let part2 = '';
    for (let j = 0; j < 4; j++) part1 += chars[crypto.randomInt(chars.length)];
    for (let j = 0; j < 4; j++) part2 += chars[crypto.randomInt(chars.length)];
    codes.push(`${part1}-${part2}`);
  }
  return codes;
}

function normalizeRecoveryCode(code) {
  return String(code || '').toUpperCase().replace(/[^A-Z0-9]/g, '');
}

function hashRecoveryCode(code) {
  return bcrypt.hashSync(normalizeRecoveryCode(code), 10);
}

function verifyRecoveryCode(user, code) {
  const norm = normalizeRecoveryCode(code);
  if (norm.length !== 8) return null;
  const mfa = ensureMfa(user);
  for (const entry of mfa.recoveryCodes) {
    if (entry.usedAt) continue;
    if (bcrypt.compareSync(norm, entry.hash)) return entry;
  }
  return null;
}

function storeRecoveryCodes(mfa, plainCodes) {
  mfa.recoveryCodes = plainCodes.map((code) => ({
    id: store.uid('rc'),
    hash: hashRecoveryCode(code),
    codeHint: `${code.slice(0, 2)}**`,
    usedAt: null,
    createdAt: new Date().toISOString()
  }));
}

function afterLoginDecision(user, data) {
  const required = mfaPolicy.mfaRequiredForUser(user, data);
  const enrolled = mfaPolicy.isMfaEnabled(user);
  const enroll = mfaPolicy.mustEnroll(user, data);

  if (!required && !enrolled) {
    return {
      ok: true,
      complete: true,
      token: issueAdminSession(user, false),
      user: sanitizeUserPublic(user)
    };
  }

  if (enrolled) {
    return {
      ok: true,
      complete: false,
      mfaRequired: true,
      enrollmentRequired: false,
      pendingToken: issueMfaPendingToken(user, 'verify'),
      user: { id: user.id, email: user.email, nome: user.nome, role: user.role }
    };
  }

  if (enroll || required) {
    return {
      ok: true,
      complete: false,
      mfaRequired: true,
      enrollmentRequired: true,
      pendingToken: issueMfaPendingToken(user, 'enroll'),
      user: { id: user.id, email: user.email, nome: user.nome, role: user.role }
    };
  }

  return {
    ok: true,
    complete: true,
    token: issueAdminSession(user, false),
    user: sanitizeUserPublic(user)
  };
}

function loginPhaseResult(user, data) {
  const decision = afterLoginDecision(user, data);
  writeAudit(data, {
    userId: user.id,
    userName: user.nome,
    action: 'login',
    resourceType: 'session',
    companyId: user.companyId || null,
    newValue: { mfaPending: !decision.complete }
  });
  store.save(data);
  return decision;
}

function getStatus(user, data) {
  const policy = mfaPolicy.getPolicy(data);
  return {
    enabled: mfaPolicy.isMfaEnabled(user),
    required: mfaPolicy.mfaRequiredForUser(user, data),
    mustEnroll: mfaPolicy.mustEnroll(user, data),
    withinGracePeriod: mfaPolicy.isWithinGracePeriod(policy),
    policy: mfaPolicy.sanitizePolicyForClient(policy)
  };
}

async function verifyMfaCode(req, code, { recovery = false } = {}) {
  await sleep(config.MFA.MIN_RESPONSE_MS / 2);
  const ip = clientIp(req);
  const ipGate = await gateAttempt(
    `mfa:ip:${ip}`,
    config.MFA.MAX_FAILURES_IP,
    config.MFA.WINDOW_MS
  );
  if (!ipGate.allowed) {
    return { ok: false, status: 429, error: 'Muitas tentativas. Aguarde e tente novamente.' };
  }

  const pending = userFromMfaPending(req);
  if (!pending) return { ok: false, status: 401, error: 'Sessão MFA expirada. Faça login novamente.' };

  const { user, payload } = pending;
  const userKey = user.id;
  const userGate = await gateAttempt(
    `mfa:user:${userKey}`,
    config.MFA.MAX_FAILURES_USER,
    config.MFA.WINDOW_MS
  );
  if (!userGate.allowed) {
    return { ok: false, status: 429, error: 'Muitas tentativas. Aguarde e tente novamente.' };
  }

  const data = store.load();
  const idx = data.users.findIndex((u) => u.id === user.id);
  const current = data.users[idx];
  let verified = false;
  let usedRecovery = false;

  if (recovery) {
    const entry = verifyRecoveryCode(current, code);
    if (entry) {
      entry.usedAt = new Date().toISOString();
      verified = true;
      usedRecovery = true;
    }
  } else {
    verified = verifyTotp(current, code);
  }

  if (!verified) {
    writeAudit(data, {
      userId: user.id,
      userName: user.nome,
      action: 'mfa_verificacao_falha',
      resourceType: 'user',
      resourceId: user.id,
      companyId: user.companyId || null
    });
    store.save(data);
    return { ok: false, status: 401, error: 'Código inválido.' };
  }

  writeAudit(data, {
    userId: user.id,
    userName: user.nome,
    action: usedRecovery ? 'mfa_recovery_usado' : 'mfa_verificacao_sucesso',
    resourceType: 'user',
    resourceId: user.id,
    companyId: user.companyId || null
  });
  store.save(data);

  return {
    ok: true,
    token: issueAdminSession(current, true),
    user: sanitizeUserPublic(current),
    usedRecovery
  };
}

function enrollStart(req) {
  const pending = userFromMfaPending(req);
  const data = store.load();
  let user;
  let purpose = 'enroll';

  if (pending) {
    user = pending.user;
    purpose = pending.payload.purpose || 'enroll';
  } else if (req.user) {
    user = data.users.find((u) => u.id === req.user.id);
  }

  if (!user) return { ok: false, status: 401, error: 'Não autorizado.' };

  const secret = authenticator.generateSecret();
  const otpauthUrl = authenticator.keyuri(user.email, 'Canal Seguro', secret);

  const idx = data.users.findIndex((u) => u.id === user.id);
  ensureMfa(data.users[idx]);
  data.users[idx].mfa.pendingSecretEnc = encryptSecret(secret);
  data.users[idx].mfa.pendingAt = new Date().toISOString();
  store.save(data);

  const pendingToken =
    pending?.payload ? req.cookies?.[config.MFA_PENDING_COOKIE] : issueMfaPendingToken(user, 'enroll');

  return {
    ok: true,
    otpauthUrl,
    pendingToken: pending ? null : pendingToken,
    purpose
  };
}

function enrollConfirm(req, code) {
  const pending = userFromMfaPending(req);
  if (!pending && !req.user) return { ok: false, status: 401, error: 'Não autorizado.' };

  const data = store.load();
  const userId = pending ? pending.user.id : req.user.id;
  const idx = data.users.findIndex((u) => u.id === userId);
  if (idx < 0) return { ok: false, status: 404, error: 'Usuário não encontrado.' };

  const user = data.users[idx];
  const mfa = ensureMfa(user);
  const pendingSecret = decryptSecret(mfa.pendingSecretEnc);
  if (!pendingSecret) return { ok: false, status: 400, error: 'Inicie a configuração MFA novamente.' };

  if (!authenticator.verify({ token: String(code).replace(/\s/g, ''), secret: pendingSecret })) {
    return { ok: false, status: 400, error: 'Código inválido. Verifique o aplicativo autenticador.' };
  }

  const plainCodes = generateRecoveryCodes();
  mfa.secretEnc = encryptSecret(pendingSecret);
  mfa.pendingSecretEnc = null;
  mfa.pendingAt = null;
  mfa.enabled = true;
  mfa.enrolledAt = new Date().toISOString();
  storeRecoveryCodes(mfa, plainCodes);

  writeAudit(data, {
    userId: user.id,
    userName: user.nome,
    action: 'mfa_ativado',
    resourceType: 'user',
    resourceId: user.id,
    companyId: user.companyId || null
  });
  store.save(data);

  const sessionToken = issueAdminSession(user, true);

  return {
    ok: true,
    recoveryCodes: plainCodes,
    token: sessionToken,
    user: sanitizeUserPublic(user)
  };
}

function disableMfa(req, { password, code, recoveryCode }) {
  if (!req.user) return { ok: false, status: 401, error: 'Não autenticado.' };

  const data = store.load();
  const idx = data.users.findIndex((u) => u.id === req.user.id);
  if (idx < 0) return { ok: false, status: 404, error: 'Usuário não encontrado.' };

  const user = data.users[idx];
  if (!bcrypt.compareSync(String(password || ''), user.passwordHash)) {
    return { ok: false, status: 401, error: 'Senha incorreta.' };
  }

  if (mfaPolicy.mfaRequiredForUser(user, data)) {
    return {
      ok: false,
      status: 403,
      error: 'MFA é obrigatório para seu perfil. Não é possível desativar.'
    };
  }

  let verified = false;
  if (recoveryCode) {
    verified = Boolean(verifyRecoveryCode(user, recoveryCode));
  } else {
    verified = verifyTotp(user, code);
  }
  if (!verified) return { ok: false, status: 401, error: 'Código inválido.' };

  user.mfa = { enabled: false, secretEnc: null, recoveryCodes: [], enrolledAt: null };
  user.sessionVersion = (user.sessionVersion || 1) + 1;

  writeAudit(data, {
    userId: user.id,
    userName: user.nome,
    action: 'mfa_desativado',
    resourceType: 'user',
    resourceId: user.id,
    companyId: user.companyId || null
  });
  store.save(data);

  return { ok: true, message: 'MFA desativado.', sessionVersion: user.sessionVersion };
}

function regenerateRecoveryCodes(req, { password, code }) {
  if (!req.user) return { ok: false, status: 401, error: 'Não autenticado.' };

  const data = store.load();
  const idx = data.users.findIndex((u) => u.id === req.user.id);
  const user = data.users[idx];
  if (!user?.mfa?.enabled) return { ok: false, status: 400, error: 'MFA não está ativo.' };

  if (!bcrypt.compareSync(String(password || ''), user.passwordHash)) {
    return { ok: false, status: 401, error: 'Senha incorreta.' };
  }
  if (!verifyTotp(user, code)) {
    return { ok: false, status: 401, error: 'Código TOTP inválido.' };
  }

  const plainCodes = generateRecoveryCodes();
  storeRecoveryCodes(ensureMfa(user), plainCodes);
  user.sessionVersion = (user.sessionVersion || 1) + 1;

  writeAudit(data, {
    userId: user.id,
    userName: user.nome,
    action: 'mfa_recovery_regenerado',
    resourceType: 'user',
    resourceId: user.id,
    companyId: user.companyId || null
  });
  store.save(data);

  return { ok: true, recoveryCodes: plainCodes };
}

function adminResetUserMfa(actor, targetUserId) {
  if (!actor || actor.role !== 'superadmin') {
    return { ok: false, status: 403, error: 'Acesso negado.' };
  }

  const data = store.load();
  const idx = data.users.findIndex((u) => u.id === targetUserId);
  if (idx < 0) return { ok: false, status: 404, error: 'Usuário não encontrado.' };

  const target = data.users[idx];
  target.mfa = { enabled: false, secretEnc: null, recoveryCodes: [], enrolledAt: null };
  target.sessionVersion = (target.sessionVersion || 1) + 1;

  writeAudit(data, {
    userId: actor.id,
    userName: actor.nome,
    action: 'mfa_admin_reset',
    resourceType: 'user',
    resourceId: target.id,
    companyId: target.companyId || null,
    newValue: { targetUserId: target.id, targetEmailHash: hashIdentifier(target.email) }
  });
  store.save(data);

  return { ok: true, message: 'MFA resetado. O usuário deve configurar novamente no próximo login.' };
}

function updatePlatformPolicy(actor, patch) {
  if (!actor || actor.role !== 'superadmin') {
    return { ok: false, status: 403, error: 'Acesso negado.' };
  }

  const data = store.load();
  data.platformSettings = data.platformSettings || {};
  const prev = mfaPolicy.getPolicy(data);
  const next = { ...prev, ...patch };
  if (patch.enforcedAt === 'now') {
    next.enforcedAt = new Date().toISOString();
  }
  data.platformSettings.mfaPolicy = next;

  writeAudit(data, {
    userId: actor.id,
    userName: actor.nome,
    action: 'mfa_politica_alterada',
    resourceType: 'platform',
    companyId: null,
    previousValue: prev,
    newValue: next
  });
  store.save(data);

  return { ok: true, policy: mfaPolicy.sanitizePolicyForClient(next) };
}

function getPlatformPolicy() {
  const data = store.load();
  return mfaPolicy.sanitizePolicyForClient(mfaPolicy.getPolicy(data));
}

module.exports = {
  loginPhaseResult,
  issueAdminSession,
  issueMfaPendingToken,
  userFromMfaPending,
  verifyMfaCode,
  enrollStart,
  enrollConfirm,
  disableMfa,
  regenerateRecoveryCodes,
  adminResetUserMfa,
  updatePlatformPolicy,
  getPlatformPolicy,
  getStatus,
  resetRateLimitsForTests,
  sanitizeUserPublic
};
