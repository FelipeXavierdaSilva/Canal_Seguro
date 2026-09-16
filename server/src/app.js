'use strict';

const path = require('path');
const express = require('express');
const cookieParser = require('cookie-parser');
const cors = require('cors');
const { optionalAuth } = require('./middleware/auth');
const { securityHeaders } = require('./middleware/security-headers');
const { resolveCorsOptions } = require('./middleware/cors-config');
const authRoutes = require('./routes/auth.routes');
const mfaRoutes = require('./routes/mfa.routes');
const settingsRoutes = require('./routes/settings.routes');
const emailRoutes = require('./routes/email.routes');
const usersRoutes = require('./routes/users.routes');
const hardDeleteRoutes = require('./routes/hard-delete.routes');
const publicRoutes = require('./routes/public.routes');
const { router: reportsRoutes, employeeRouter: employeeReportsRoutes } = require('./routes/reports.routes');
const store = require('./store');
const { blockSensitiveStatic } = require('./middleware/block-sensitive-static');
const { serveHtmlWithNonce } = require('./middleware/html-csp');
const { requireCsrf } = require('./middleware/csrf');
const config = require('./config');
const companyStorage = require('./services/company-storage.service');

function createApp() {
  const app = express();

  app.set('trust proxy', 1);
  app.use(securityHeaders());
  app.use(cors(resolveCorsOptions()));
  /* Fase A1: 1mb global; JSON maior (ATTACHMENTS.JSON_BODY_LIMIT, default 15mb)
   * apenas em POST /api/v1/reports/:id/attachments (base64). CSRF/auth inalterados. */
  app.use((req, res, next) => {
    const isAttachmentUpload =
      req.method === 'POST' && /^\/api\/v1\/reports\/[^/]+\/attachments\/?$/.test(req.path);
    const limit = isAttachmentUpload ? config.ATTACHMENTS.JSON_BODY_LIMIT : '1mb';
    return express.json({ limit })(req, res, next);
  });
  app.use(cookieParser());
  app.use(optionalAuth);
  app.use('/api/v1', requireCsrf);

  app.get('/api/v1/health', (_req, res) => {
    res.json({ ok: true, service: 'canal-seguro-api', phase: 1, mfa: true, email: true });
  });

  app.use('/api/v1/auth', authRoutes);
  app.use('/api/v1/auth/mfa', mfaRoutes);
  app.use('/api/v1/settings', settingsRoutes);
  app.use('/api/v1/email', emailRoutes);
  app.use('/api/v1/users', usersRoutes);
  app.use('/api/v1', hardDeleteRoutes);
  app.use('/api/v1/public', publicRoutes);
  app.use('/api/v1/reports', reportsRoutes);
  app.use('/api/v1/employee/reports', employeeReportsRoutes);

  app.get('/api/v1/companies/:id', optionalAuth, (req, res) => {
    if (!req.user) return res.status(401).json({ error: 'Não autenticado.' });
    const data = store.load();
    const company = (data.companies || []).find((c) => c.id === req.params.id);
    if (!company) return res.status(404).json({ error: 'Empresa não encontrada.' });
    if (req.user.role !== 'superadmin' && req.user.companyId !== company.id) {
      return res.status(404).json({ error: 'Empresa não encontrada.' });
    }
    const enriched = companyStorage.enrichCompanyForResponse(company, data);
    return res.json(enriched);
  });

  const staticRoot = path.join(__dirname, '..', '..');
  app.use(blockSensitiveStatic);
  app.use(serveHtmlWithNonce(staticRoot));
  app.use(
    express.static(staticRoot, {
      dotfiles: 'deny',
      index: 'index.html'
    })
  );

  app.use((err, _req, res, _next) => {
    console.error(err);
    res.status(500).json({ error: 'Erro interno.' });
  });

  return app;
}

module.exports = { createApp };
