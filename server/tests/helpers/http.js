'use strict';

/** Extrai header CSRF a partir do cookie jar dos testes (double-submit). */
function csrfHeaders(cookie) {
  if (!cookie) return {};
  const match = String(cookie).match(/(?:^|;\s*)cs_csrf=([^;]+)/);
  return match ? { 'X-CSRF-Token': decodeURIComponent(match[1]) } : {};
}

module.exports = { csrfHeaders };
