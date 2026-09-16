'use strict';

const bcrypt = require('bcryptjs');

function normalizeTrackingCode(code) {
  return String(code || '')
    .toUpperCase()
    .replace(/[^A-Z0-9]/g, '');
}

function hashTrackingCode(plainCode) {
  const norm = normalizeTrackingCode(plainCode);
  if (norm.length < 8) return null;
  return bcrypt.hashSync(norm, 10);
}

function verifyTrackingCode(plainCode, hash) {
  if (!hash || !plainCode) return false;
  const norm = normalizeTrackingCode(plainCode);
  if (norm.length < 8) return false;
  try {
    return bcrypt.compareSync(norm, hash);
  } catch {
    return false;
  }
}

module.exports = {
  normalizeTrackingCode,
  hashTrackingCode,
  verifyTrackingCode
};
