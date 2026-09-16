'use strict';

/**
 * Resolve origens CORS a partir de CS_CORS_ORIGIN.
 * - Ausente em dev: true (reflect origin — apenas desenvolvimento)
 * - Lista separada por vírgula: allowlist explícita
 * - "true" / "false": comportamento cors legado
 */
function parseCorsOriginEnv(raw) {
  if (raw === undefined || raw === null || raw === '') {
    return process.env.NODE_ENV === 'production' ? [] : true;
  }
  const trimmed = String(raw).trim();
  if (trimmed === 'true') return true;
  if (trimmed === 'false') return false;
  return trimmed
    .split(',')
    .map((s) => s.trim())
    .filter(Boolean);
}

function buildCorsOptions(originConfig) {
  if (originConfig === true) {
    return { origin: true, credentials: true, methods: ['GET', 'POST', 'PUT', 'PATCH', 'DELETE', 'OPTIONS'] };
  }
  if (originConfig === false) {
    return { origin: false, credentials: false };
  }
  const allowlist = Array.isArray(originConfig) ? originConfig : [originConfig];
  return {
    origin(origin, callback) {
      if (!origin) {
        return callback(null, true);
      }
      if (allowlist.includes(origin)) {
        return callback(null, true);
      }
      return callback(null, false);
    },
    credentials: true,
    methods: ['GET', 'POST', 'PUT', 'PATCH', 'DELETE', 'OPTIONS']
  };
}

function resolveCorsOptions() {
  const originConfig = parseCorsOriginEnv(process.env.CS_CORS_ORIGIN);
  return buildCorsOptions(originConfig);
}

module.exports = { parseCorsOriginEnv, buildCorsOptions, resolveCorsOptions };
