'use strict';

const bcrypt = require('bcryptjs');
const path = require('path');
const strength = require(path.join(__dirname, '../../../js/password-strength.js'));

function validateStrongPassword(password, label = 'Senha') {
  return strength.validate(password, label);
}

function isSameAsPrevious(password, passwordHash) {
  if (!passwordHash) return false;
  try {
    return bcrypt.compareSync(password, passwordHash);
  } catch {
    return false;
  }
}

module.exports = {
  validateStrongPassword,
  isSameAsPrevious,
  assessPassword: strength.assess,
  COMMON_WEAK: strength.COMMON_WEAK,
  MIN_LENGTH: strength.MIN_LENGTH
};
