'use strict';

const crypto = require('crypto');
const bcrypt = require('bcryptjs');
const store = require('../store');
const config = require('../config');
const { hashIdentifier } = require('../utils/tokens');
const { validateStrongPassword, isSameAsPrevious } = require('../utils/password');
const { gateAttempt } = require('../utils/rate-limit-gate');
const { appendAudit } = require('./audit.service');
const mailService = require('./mail.service');

const GENERIC_REQUEST_MESSAGE =
  'Se o usuário ou e-mail estiver cadastrado, você receberá instruções para redefinir sua senha.';
const GENERIC_RESET_FAILURE = 'Não foi possível redefinir a senha. Solicite um novo link.';

function sleep(ms) {
  return new Promise((r) => setTimeout(r, ms));
}

function hashToken(rawToken) {
  return crypto.createHash('sha256').update(String(rawToken)).digest('hex');
}

function clientIp(req) {
  return req.ip || req.headers['x-forwarded-for']?.split(',')[0]?.trim() || 'unknown';
}

function ensureResetStore(data) {
  data.passwordResetTokens = data.passwordResetTokens || [];
  return data;
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

function writeAudit(data, entry) {
  appendAudit(data, entry);
}

function buildResetUrl(rawToken, req) {
  const base =
    config.PUBLIC_APP_URL ||
    `${req.protocol}://${req.get('host') || 'localhost:3000'}`;
  return `${base.replace(/\/$/, '')}/redefinir-senha.html?token=${encodeURIComponent(rawToken)}`;
}

async function requestReset(req, email) {
  const started = Date.now();
  const ip = clientIp(req);
  const emailNorm = String(email || '').trim().toLowerCase();

  const ipGate = await gateAttempt(
    `pwdreset:ip:${ip}`,
    config.PASSWORD_RESET.MAX_PER_IP,
    config.PASSWORD_RESET.IP_WINDOW_MS
  );
  if (!ipGate.allowed) {
    await sleep(config.PASSWORD_RESET.MIN_RESPONSE_MS);
    return { ok: true, message: GENERIC_REQUEST_MESSAGE, rateLimited: true, status: 429 };
  }

  if (emailNorm) {
    const emailGate = await gateAttempt(
      `pwdreset:email:${hashIdentifier(emailNorm)}`,
      config.PASSWORD_RESET.MAX_PER_EMAIL,
      config.PASSWORD_RESET.EMAIL_WINDOW_MS
    );
    if (!emailGate.allowed) {
      await sleep(config.PASSWORD_RESET.MIN_RESPONSE_MS);
      return { ok: true, message: GENERIC_REQUEST_MESSAGE, rateLimited: true, status: 429 };
    }
  }

  const user = emailNorm ? findUserByLogin(emailNorm) : null;

  if (user) {
    const data = ensureResetStore(store.load());
    const rawToken = crypto.randomBytes(32).toString('base64url');
    const tokenRecord = {
      id: store.uid('prt'),
      userId: user.id,
      tokenHash: hashToken(rawToken),
      expiresAt: new Date(Date.now() + config.PASSWORD_RESET.TTL_MS).toISOString(),
      usedAt: null,
      createdAt: new Date().toISOString(),
      requestedFromIpHash: hashIdentifier(ip)
    };
    data.passwordResetTokens.push(tokenRecord);

    writeAudit(data, {
      userId: user.id,
      userName: user.nome,
      action: 'solicitacao_recuperacao_senha',
      resourceType: 'user',
      resourceId: user.id,
      companyId: user.companyId || null,
      newValue: { emailHash: hashIdentifier(emailNorm) }
    });

    store.save(data);

    const resetUrl = buildResetUrl(rawToken, req);
    await mailService.sendPasswordResetEmail({
      to: user.email,
      resetUrl,
      userName: user.nome,
      companyId: user.companyId || null
    });
  }

  const elapsed = Date.now() - started;
  if (elapsed < config.PASSWORD_RESET.MIN_RESPONSE_MS) {
    await sleep(config.PASSWORD_RESET.MIN_RESPONSE_MS - elapsed);
  }

  return { ok: true, message: GENERIC_REQUEST_MESSAGE, status: 200 };
}

function findValidTokenRecord(rawToken) {
  if (!rawToken || String(rawToken).length < 20) return null;
  const data = ensureResetStore(store.load());
  const hash = hashToken(rawToken);
  const now = Date.now();
  const record = (data.passwordResetTokens || []).find(
    (t) => t.tokenHash === hash && !t.usedAt && new Date(t.expiresAt).getTime() > now
  );
  if (!record) return null;
  const user = (data.users || []).find((u) => u.id === record.userId && u.status === 'ativo');
  if (!user) return null;
  return { data, record, user };
}

function validateResetToken(rawToken) {
  const found = findValidTokenRecord(rawToken);
  return { ok: !!found };
}

async function resetPassword(req, rawToken, password, passwordConfirm) {
  await sleep(config.PASSWORD_RESET.MIN_RESPONSE_MS / 2);

  if (!rawToken || password !== passwordConfirm) {
    return { ok: false, status: 400, error: GENERIC_RESET_FAILURE };
  }

  const strengthErr = validateStrongPassword(password);
  if (strengthErr) {
    return { ok: false, status: 400, error: strengthErr };
  }

  const found = findValidTokenRecord(rawToken);
  if (!found) {
    return { ok: false, status: 400, error: GENERIC_RESET_FAILURE };
  }

  const { data, record, user } = found;

  if (isSameAsPrevious(password, user.passwordHash)) {
    return {
      ok: false,
      status: 400,
      error: 'A nova senha deve ser diferente da senha anterior.'
    };
  }

  const idx = data.users.findIndex((u) => u.id === user.id);
  data.users[idx].passwordHash = bcrypt.hashSync(password, 10);
  data.users[idx].sessionVersion = (data.users[idx].sessionVersion || 1) + 1;

  record.usedAt = new Date().toISOString();

  writeAudit(data, {
    userId: user.id,
    userName: user.nome,
    action: 'redefinicao_senha',
    resourceType: 'user',
    resourceId: user.id,
    companyId: user.companyId || null,
    newValue: { sessionInvalidated: true }
  });

  store.save(data);

  return { ok: true, status: 200, message: 'Senha redefinida com sucesso. Faça login com a nova senha.' };
}

module.exports = {
  requestReset,
  validateResetToken,
  resetPassword,
  resetRateLimitsForTests() {
    const { resetAllForTests } = require('../utils/rate-limit-gate');
    return resetAllForTests();
  },
  GENERIC_REQUEST_MESSAGE,
  GENERIC_RESET_FAILURE
};
