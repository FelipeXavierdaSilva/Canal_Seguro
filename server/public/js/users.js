/**
 * users.js – Helpers de usuários e perfis
 */

const CSUsers = (() => {
  const ROLE_LABELS = {
    superadmin: 'Adm_Plataforma',
    admin_empresa: 'Adm_Empresa',
    apurador: 'Apurador'
  };

  function roleLabel(role) {
    return ROLE_LABELS[role] || role;
  }

  function initials(name) {
    if (!name) return '?';
    return name
      .split(/\s+/)
      .filter(Boolean)
      .slice(0, 2)
      .map((p) => p[0].toUpperCase())
      .join('');
  }

  return { ROLE_LABELS, roleLabel, initials };
})();

window.CSUsers = CSUsers;
