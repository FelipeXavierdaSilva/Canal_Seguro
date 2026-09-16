'use strict';

const express = require('express');
const notification = require('../services/notification.service');
const queue = require('../email/queue.service');
const bounce = require('../email/bounce.service');
const config = require('../config');
const { requireAuth, requireRole } = require('../middleware/auth');
const { requireEmailWebhookSecret } = require('../middleware/webhook-auth');

const router = express.Router();

router.get('/delivery-logs', requireAuth, requireRole('superadmin'), (req, res) => {
  const limit = Math.min(Number(req.query.limit) || 50, 200);
  return res.json({ logs: queue.getDeliveryLogs({ limit }) });
});

router.get('/stats', requireAuth, requireRole('superadmin'), (_req, res) => {
  return res.json({
    queue: queue.getQueueStats(),
    provider: config.MAIL_PROVIDER,
    smtpConfigured: Boolean(config.SMTP_HOST)
  });
});

router.get('/dev/last', (req, res) => {
  if (!config.DEV_MODE) return res.status(404).json({ error: 'Não disponível.' });
  const mail = require('../email/providers/console.provider').getLastDevMail();
  if (!mail) return res.json({ sent: false });
  return res.json({ sent: true, ...mail });
});

router.post('/webhooks/bounce', requireEmailWebhookSecret, (req, res) => {
  const result = bounce.handleBounceWebhook(req.body || {});
  if (!result.ok) return res.status(400).json(result);
  return res.json({ ok: true });
});

router.get('/notifications/:companyId', requireAuth, (req, res) => {
  const { companyId } = req.params;
  if (req.user.role !== 'superadmin' && req.user.companyId !== companyId) {
    return res.status(403).json({ error: 'Acesso negado.' });
  }
  return res.json({ policy: notification.getCompanyEmailPolicy(companyId) });
});

router.put('/notifications/:companyId', requireAuth, (req, res) => {
  const { companyId } = req.params;
  if (req.user.role !== 'superadmin' && req.user.companyId !== companyId) {
    return res.status(403).json({ error: 'Acesso negado.' });
  }
  const result = notification.updateCompanyEmailPolicy(req.user, companyId, req.body || {});
  if (!result.ok) return res.status(result.status).json({ error: result.error });
  return res.json({ policy: result.policy });
});

module.exports = router;
