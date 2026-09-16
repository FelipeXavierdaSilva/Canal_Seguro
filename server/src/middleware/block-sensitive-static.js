'use strict';

/** Prefixos de URL que nunca devem ser servidos como arquivos estáticos. */
const BLOCKED_PREFIXES = ['/server', '/node_modules', '/.git'];

function blockSensitiveStatic(req, res, next) {
  const pathLower = (req.path || '').toLowerCase();
  for (const prefix of BLOCKED_PREFIXES) {
    if (pathLower === prefix || pathLower.startsWith(`${prefix}/`)) {
      return res.status(404).end();
    }
  }
  return next();
}

module.exports = { blockSensitiveStatic, BLOCKED_PREFIXES };
