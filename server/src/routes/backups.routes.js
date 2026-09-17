'use strict';

const express = require('express');
const backup = require('../services/backup.service');
const { requireAuth, requireRole } = require('../middleware/auth');

const router = express.Router();

router.get('/status', requireAuth, requireRole('superadmin'), (req, res) => {
  const result = backup.getStatus(req.user);
  if (!result.ok) return res.status(result.status || 400).json({ error: result.error || 'Acesso negado.' });
  return res.json(result.data);
});

router.get('/', requireAuth, requireRole('superadmin'), (req, res) => {
  const result = backup.listBackups(req.user);
  if (!result.ok) return res.status(result.status || 400).json({ error: result.error || 'Acesso negado.' });
  return res.json(result.data);
});

router.get('/:id', requireAuth, requireRole('superadmin'), (req, res) => {
  const result = backup.getBackup(req.user, req.params.id);
  if (!result.ok) return res.status(result.status || 400).json({ error: result.error || 'Não encontrado.' });
  return res.json(result.data);
});

router.post('/', requireAuth, requireRole('superadmin'), (req, res) => {
  const result = backup.createBackup(req.user, { note: req.body?.note || null });
  if (!result.ok) return res.status(result.status || 400).json({ error: result.error || 'Falha ao criar backup.' });
  return res.status(201).json(result.data);
});

router.post('/restore-latest', requireAuth, requireRole('superadmin'), (req, res) => {
  const result = backup.restoreLatest(req.user, {
    confirm: Boolean(req.body?.confirm),
    skipSafetyBackup: Boolean(req.body?.skipSafetyBackup)
  });
  if (!result.ok) return res.status(result.status || 400).json({ error: result.error || 'Falha ao restaurar.' });
  return res.json(result.data);
});

router.post('/:id/verify', requireAuth, requireRole('superadmin'), (req, res) => {
  const result = backup.verifyBackup(req.user, req.params.id);
  if (!result.ok) {
    return res.status(result.status || 400).json({
      error: result.error || 'Falha na verificação.',
      ...(result.data ? { details: result.data } : {})
    });
  }
  return res.json(result.data);
});

router.post('/:id/restore', requireAuth, requireRole('superadmin'), (req, res) => {
  const result = backup.restoreBackup(req.user, req.params.id, {
    confirm: Boolean(req.body?.confirm),
    skipSafetyBackup: Boolean(req.body?.skipSafetyBackup)
  });
  if (!result.ok) return res.status(result.status || 400).json({ error: result.error || 'Falha ao restaurar.' });
  return res.json(result.data);
});

module.exports = router;
