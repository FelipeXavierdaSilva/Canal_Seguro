'use strict';

const express = require('express');
const config = require('../config');
const publicService = require('../services/public.service');
const reportMessages = require('../services/report-messages.service');
const reporterSession = require('../services/reporter-session.service');
const { issueCsrfToken } = require('../services/csrf.service');
const store = require('../store');
const { requireReporter } = require('../middleware/auth');

const router = express.Router();

router.post('/consult', async (req, res) => {
  const { protocol, trackingCode } = req.body || {};
  const result = await publicService.publicConsult(req, protocol, trackingCode);
  if (!result.ok) {
    if (result.status === 429) {
      return res.status(429).json({
        error: 'Não foi possível validar os dados informados.',
        retryAfterMs: result.retryAfterMs
      });
    }
    return res.status(404).json({ error: 'Não foi possível validar os dados informados.' });
  }

  const token = reporterSession.issueReporterToken(result.report.id, result.report.protocol);
  res.cookie(config.REPORTER_COOKIE, token, reporterSession.cookieOptions());
  issueCsrfToken(res);
  return res.json(result.data);
});

router.get('/messages', requireReporter, (req, res) => {
  const result = reportMessages.getThreadForReporter(req.reporter);
  if (!result.ok) return res.status(result.status).json({ error: result.error });
  return res.json({ messages: result.messages, unreadCount: result.unreadCount });
});

router.post('/messages', requireReporter, async (req, res) => {
  const { text, attachments } = req.body || {};
  const result = await reportMessages.sendReporterMessage(req.reporter, { text, attachments });
  if (!result.ok) return res.status(result.status).json({ error: result.error });
  return res.status(201).json(result.message);
});

router.get('/companies/:key', (req, res) => {
  const key = String(req.params.key || '').toLowerCase();
  const data = store.load();
  const company =
    (data.companies || []).find(
      (c) => c.id === req.params.key || String(c.dominio || '').toLowerCase() === key
    ) || null;
  if (!company || company.status !== 'ativo') {
    return res.status(404).json({ error: 'Empresa não encontrada.' });
  }
  const {
    razaoSocial,
    cnpj,
    endereco,
    responsavel,
    email,
    telefone,
    ...publicFields
  } = company;
  return res.json(publicFields);
});

router.get('/meta/categories', (_req, res) => {
  const data = store.load();
  return res.json(data.categories || []);
});

router.get('/meta/statuses', (_req, res) => {
  const data = store.load();
  return res.json(data.statuses || []);
});

router.get('/meta/storage-plans', (_req, res) => {
  const storagePlans = require('../services/storage-plans.service');
  const result = storagePlans.listPublicPlans();
  return res.json(result.data);
});

router.get('/meta/commercial-contact', (_req, res) => {
  const commercial = require('../services/commercial-contact.service');
  const result = commercial.getPublicCommercialContact();
  return res.json(result.data);
});

module.exports = router;
