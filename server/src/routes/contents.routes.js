'use strict';

const express = require('express');
const contentsService = require('../services/contents.service');
const { requireAuth, requireRole } = require('../middleware/auth');

const router = express.Router();

router.get('/', requireAuth, requireRole('superadmin', 'admin_empresa', 'apurador'), (req, res) => {
  const result = contentsService.listContents(req.user, req.query || {});
  if (!result.ok) return res.status(result.status).json({ error: result.error });
  return res.json({ contents: result.contents });
});

router.post('/', requireAuth, requireRole('superadmin', 'admin_empresa'), (req, res) => {
  const result = contentsService.createContent(req.user, req.body || {});
  if (!result.ok) return res.status(result.status).json({ error: result.error });
  return res.status(201).json({ content: result.content });
});

router.put('/:contentId', requireAuth, requireRole('superadmin', 'admin_empresa'), (req, res) => {
  const result = contentsService.updateContent(req.user, req.params.contentId, req.body || {});
  if (!result.ok) return res.status(result.status).json({ error: result.error });
  return res.json({ content: result.content });
});

router.delete('/:contentId', requireAuth, requireRole('superadmin', 'admin_empresa'), (req, res) => {
  const result = contentsService.deleteContent(req.user, req.params.contentId);
  if (!result.ok) return res.status(result.status).json({ error: result.error });
  return res.json({ ok: true, deleted: result.deleted, id: result.id });
});

module.exports = router;
