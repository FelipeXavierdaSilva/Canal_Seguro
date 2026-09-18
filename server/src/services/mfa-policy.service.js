'use strict';

const { permissionsForRole } = require('../utils/tokens');

const DEFAULT_POLICY = {
  // Política no store; o login MFA só é exigido se CS_MFA_LOGIN=1 (ver isLoginMfaEnforced).
  enabled: false,
  requiredRoles: ['superadmin', 'admin_empresa'],
  requiredPermissions: ['reports:view_identity'],
  optionalForOthers: true,
  gracePeriodDays: 7,
  allowRecoveryCodes: true,
  enforcedAt: null
};

/**
 * Kill switch temporário: por padrão o login é só e-mail/senha.
 * Para voltar a exigir MFA no login: CS_MFA_LOGIN=1 e mfaPolicy.enabled=true.
 */
function isLoginMfaEnforced(data) {
  const flag = String(process.env.CS_MFA_LOGIN || '').trim().toLowerCase();
  if (flag === '0' || flag === 'false' || flag === 'off') return false;
  if (flag !== '1' && flag !== 'true' && flag !== 'on') {
    // Ausência da flag = desligado (pedido atual: sem 2FA no login)
    return false;
  }
  return getPolicy(data).enabled;
}

function getPolicy(data) {
  const p = data.platformSettings?.mfaPolicy || {};
  return { ...DEFAULT_POLICY, ...p };
}

function userPermissions(user) {
  return permissionsForRole(user?.role || '');
}

function isMfaEnabled(user) {
  return Boolean(user?.mfa?.enabled && user.mfa.secretEnc);
}

function isWithinGracePeriod(policy) {
  if (!policy.enforcedAt || !policy.gracePeriodDays) return false;
  const start = new Date(policy.enforcedAt).getTime();
  if (Number.isNaN(start)) return false;
  const end = start + policy.gracePeriodDays * 24 * 60 * 60 * 1000;
  return Date.now() < end;
}

function mfaRequiredForUser(user, data) {
  if (!isLoginMfaEnforced(data)) return false;

  const policy = getPolicy(data);
  if (!policy.enabled) return false;
  if (isMfaEnabled(user)) return true;

  const roleRequired = (policy.requiredRoles || []).includes(user.role);
  const perms = userPermissions(user);
  const permRequired = (policy.requiredPermissions || []).some((p) => perms.includes(p));

  if (!roleRequired && !permRequired) return false;
  if (isWithinGracePeriod(policy) && !isMfaEnabled(user)) return false;
  return true;
}

function mustEnroll(user, data) {
  return mfaRequiredForUser(user, data) && !isMfaEnabled(user);
}

function sanitizePolicyForClient(policy) {
  return {
    ...policy,
    loginEnforced: String(process.env.CS_MFA_LOGIN || '').trim() === '1' && Boolean(policy.enabled)
  };
}

module.exports = {
  DEFAULT_POLICY,
  getPolicy,
  isLoginMfaEnforced,
  isMfaEnabled,
  mfaRequiredForUser,
  mustEnroll,
  isWithinGracePeriod,
  sanitizePolicyForClient,
  userPermissions
};
