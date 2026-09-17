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

  app.get('/api/v1/health', async (req, res) => {
    const health = require('./services/health.service');
    const deep = String(req.query.deep || '') === '1';
    try {
      const body = await health.getHealth({ deep });
      return res.status(body.ok ? 200 : 503).json(body);
    } catch (err) {
      return res.status(500).json({
        ok: false,
        service: 'canal-seguro-api',
        error: err && err.message ? err.message : 'health falhou'
      });
    }
  });

  app.use('/api/v1/auth', authRoutes);
  app.use('/api/v1/auth/mfa', mfaRoutes);
  app.use('/api/v1/settings', settingsRoutes);
  app.use('/api/v1/admin/backups', require('./routes/backups.routes'));
  app.use('/api/v1/email', emailRoutes);
  app.use('/api/v1/users', usersRoutes);
  app.use('/api/v1/employees', require('./routes/employees.routes'));
  app.use('/api/v1/contents', require('./routes/contents.routes'));
  app.use('/api/v1/companies', require('./routes/companies.routes'));
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

  app.put('/api/v1/companies/:id', optionalAuth, (req, res) => {
    if (!req.user) return res.status(401).json({ error: 'Não autenticado.' });
    const data = store.load();
    const idx = (data.companies || []).findIndex((c) => c.id === req.params.id);
    if (idx < 0) return res.status(404).json({ error: 'Empresa não encontrada.' });
    const previous = data.companies[idx];
    const isSuper = req.user.role === 'superadmin';
    const isTenantAdmin = req.user.role === 'admin_empresa' && req.user.companyId === previous.id;
    if (!isSuper && !isTenantAdmin) {
      return res.status(403).json({ error: 'Acesso negado.' });
    }

    const body = req.body || {};
    const allowedTenant = [
      'email',
      'telefone',
      'responsavel',
      'logo',
      'nomeCanal',
      'mensagemInicial',
      'corPrincipal',
      'corSecundaria'
    ];
    const allowedSuper = [
      ...allowedTenant,
      'razaoSocial',
      'nomeFantasia',
      'cnpj',
      'endereco',
      'dominio',
      'status'
    ];
    const allowed = isSuper ? allowedSuper : allowedTenant;
    const patch = {};
    for (const key of allowed) {
      if (Object.prototype.hasOwnProperty.call(body, key)) patch[key] = body[key];
    }
    if (!isSuper && patch.status && patch.status !== previous.status) {
      return res.status(403).json({ error: 'Apenas o administrador da plataforma pode alterar o status da empresa.' });
    }

    data.companies[idx] = { ...previous, ...patch, id: previous.id };
    if (typeof patch.email === 'string') {
      data.companySettings = data.companySettings || {};
      data.companySettings[previous.id] = data.companySettings[previous.id] || {};
      const emailPolicy = data.companySettings[previous.id].emailNotifications || {};
      data.companySettings[previous.id].emailNotifications = {
        ...emailPolicy,
        replyTo: patch.email.trim() || emailPolicy.replyTo || null
      };
    }
    data.auditLogs = data.auditLogs || [];
    data.auditLogs.unshift({
      id: store.uid('aud'),
      date: new Date().toISOString(),
      userId: req.user.id,
      userName: req.user.nome,
      action: 'edicao_empresa',
      resourceType: 'company',
      resourceId: previous.id,
      companyId: previous.id
    });
    store.save(data);
    return res.json(companyStorage.enrichCompanyForResponse(data.companies[idx], data));
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
