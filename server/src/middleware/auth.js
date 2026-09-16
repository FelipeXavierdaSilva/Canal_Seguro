'use strict';

const authService = require('../services/auth.service');
const reporterSession = require('../services/reporter-session.service');
const { hasPermission } = require('../utils/tokens');

/** DENY BY DEFAULT – anexa req.user apenas se token válido. */
function optionalAuth(req, res, next) {
  req.user = authService.sessionFromRequest(req) || null;
  req.employee = authService.employeeFromRequest(req) || null;
  next();
}

function requireAuth(req, res, next) {
  if (!req.user) {
    return res.status(401).json({ error: 'Não autenticado.' });
  }
  next();
}

function requireEmployee(req, res, next) {
  if (!req.employee) {
    return res.status(401).json({ error: 'Validação de colaborador necessária.' });
  }
  next();
}

function requirePermission(permission) {
  return (req, res, next) => {
    if (!req.user || !hasPermission(req.user, permission)) {
      return res.status(403).json({ error: 'Acesso negado.' });
    }
    next();
  };
}

function requireRole(...roles) {
  return (req, res, next) => {
    if (!req.user || !roles.includes(req.user.role)) {
      return res.status(403).json({ error: 'Perfil não autorizado.' });
    }
    next();
  };
}

/** Ignora companyId do cliente para usuários de tenant. */
function tenantFromSession(req, res, next) {
  if (req.user && req.user.role !== 'superadmin') {
    req.tenantId = req.user.companyId;
  } else {
    req.tenantId = null;
  }
  next();
}

function requireReporter(req, res, next) {
  const reporter = reporterSession.reporterFromRequest(req);
  if (!reporter) {
    return res.status(401).json({ error: 'Sessão de consulta expirada. Valide protocolo e código novamente.' });
  }
  req.reporter = reporter;
  next();
}

module.exports = {
  optionalAuth,
  requireAuth,
  requireEmployee,
  requirePermission,
  requireRole,
  tenantFromSession,
  requireReporter
};
