'use strict';

const { permissionsForRole } = require('../utils/tokens');

const DEFAULT_POLICY = {
  enabled: true,
  requiredRoles: ['superadmin', 'admin_empresa'],
  requiredPermissions: ['reports:view_identity'],
  optionalForOthers: true,
  gracePeriodDays: 7,
  allowRecoveryCodes: true,
  enforcedAt: null
};

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
  return { ...policy };
}

module.exports = {
  DEFAULT_POLICY,
  getPolicy,
  isMfaEnabled,
  mfaRequiredForUser,
  mustEnroll,
  isWithinGracePeriod,
  sanitizePolicyForClient,
  userPermissions
};
