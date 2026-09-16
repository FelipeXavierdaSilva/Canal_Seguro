'use strict';

/** Conta Adm_Plataforma que não pode ser excluída / desativada / rebaixada. */
const PROTECTED_PLATFORM_EMAIL = 'felipesilva.tst.mte@gmail.com';

function normalizeEmail(value) {
  return String(value || '')
    .trim()
    .toLowerCase();
}

function isProtectedUser(user) {
  return normalizeEmail(user && user.email) === PROTECTED_PLATFORM_EMAIL;
}

function assertNotProtectedUser(user, action = 'alterar') {
  if (isProtectedUser(user)) {
    const err = new Error(
      `Não é permitido ${action} o administrador protegido da plataforma (${PROTECTED_PLATFORM_EMAIL}).`
    );
    err.code = 'PROTECTED_USER';
    err.status = 403;
    throw err;
  }
}

module.exports = {
  PROTECTED_PLATFORM_EMAIL,
  normalizeEmail,
  isProtectedUser,
  assertNotProtectedUser
};
