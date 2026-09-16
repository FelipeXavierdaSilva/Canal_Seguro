'use strict';

const crypto = require('crypto');
const config = require('../config');

const DEV_CPF_PEPPER = 'canal-seguro-dev-cpf-pepper';

function cpfPepper() {
  return process.env.CS_CPF_PEPPER || config.JWT_SECRET || DEV_CPF_PEPPER;
}

function normalizeCpf(cpf) {
  return String(cpf || '').replace(/\D/g, '');
}

function hashCpf(cpf) {
  const digits = normalizeCpf(cpf);
  if (digits.length !== 11) return null;
  return crypto.createHmac('sha256', cpfPepper()).update(digits).digest('hex');
}

function cpfMaskedFromDigits(digits) {
  if (digits.length !== 11) return '***';
  return `${digits.slice(0, 3)}.***.***-${digits.slice(-2)}`;
}

function employeeMatchesCpf(employee, cpf) {
  if (!employee) return false;
  const digits = normalizeCpf(cpf);
  if (digits.length !== 11) return false;
  const hash = hashCpf(digits);
  if (employee.cpfHash) return employee.cpfHash === hash;
  if (employee.cpf) return employee.cpf === digits;
  return false;
}

function sanitizeEmployeeRecord(employee) {
  if (!employee) return null;
  const { cpf, cpfHash, ...rest } = employee;
  return rest;
}

module.exports = {
  normalizeCpf,
  hashCpf,
  cpfMaskedFromDigits,
  employeeMatchesCpf,
  sanitizeEmployeeRecord,
  DEV_CPF_PEPPER
};
