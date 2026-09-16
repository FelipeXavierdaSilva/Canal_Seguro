'use strict';

const crypto = require('crypto');
const config = require('../config');

const PERMISSIONS = {
  superadmin: [
    'reports:read',
    'reports:create',
    'reports:update_status',
    'reports:assign',
    'reports:comment',
    'reports:classify_risk',
    'reports:transition_workflow',
    'reports:manage_sla',
    'reports:view_identity',
    'reports:export',
    'reports:export_report',
    'companies:read',
    'employees:read',
    'audit:read',
    'infra:read'
  ],
  admin_empresa: [
    'reports:read',
    'reports:update_status',
    'reports:assign',
    'reports:comment',
    'reports:classify_risk',
    'reports:transition_workflow',
    'reports:manage_sla',
    'reports:view_identity',
    'reports:export',
    'reports:export_report',
    'companies:read',
    'employees:read',
    'audit:read'
  ],
  apurador: [
    'reports:read',
    'reports:update_status',
    'reports:comment',
    'reports:classify_risk',
    'reports:transition_workflow',
    'reports:export_report'
  ]
};

function permissionsForRole(role) {
  return PERMISSIONS[role] || [];
}

function hasPermission(user, permission) {
  if (!user) return false;
  return permissionsForRole(user.role).includes(permission);
}

function signToken(payload, ttlMs) {
  const header = Buffer.from(JSON.stringify({ alg: 'HS256', typ: 'JWT' })).toString('base64url');
  const exp = Date.now() + ttlMs;
  const body = Buffer.from(JSON.stringify({ ...payload, exp })).toString('base64url');
  const sig = crypto
    .createHmac('sha256', config.JWT_SECRET)
    .update(`${header}.${body}`)
    .digest('base64url');
  return `${header}.${body}.${sig}`;
}

function verifyToken(token) {
  if (!token || typeof token !== 'string') return null;
  const parts = token.split('.');
  if (parts.length !== 3) return null;
  const [header, body, sig] = parts;
  const expected = crypto
    .createHmac('sha256', config.JWT_SECRET)
    .update(`${header}.${body}`)
    .digest('base64url');
  if (sig.length !== expected.length) return null;
  try {
    if (!crypto.timingSafeEqual(Buffer.from(sig), Buffer.from(expected))) return null;
  } catch {
    return null;
  }
  let payload;
  try {
    payload = JSON.parse(Buffer.from(body, 'base64url').toString('utf8'));
  } catch {
    return null;
  }
  if (!payload.exp || Date.now() > payload.exp) return null;
  return payload;
}

function hashIdentifier(value) {
  return crypto.createHash('sha256').update(String(value || '')).digest('hex').slice(0, 16);
}

module.exports = {
  PERMISSIONS,
  permissionsForRole,
  hasPermission,
  signToken,
  verifyToken,
  hashIdentifier
};
