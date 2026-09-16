'use strict';

const express = require('express');
const hardDelete = require('../services/hard-delete.service');
const { requireAuth, requireRole } = require('../middleware/auth');

const router = express.Router();

router.delete('/users/:userId', requireAuth, requireRole('superadmin'), (req, res) => {
  const result = hardDelete.deleteUser(req.user, req.params.userId);
  if (!result.ok) return res.status(result.status).json({ error: result.error });
  return res.json({ ok: true, deleted: result.deleted });
});

router.delete('/employees/:employeeId', requireAuth, requireRole('superadmin', 'admin_empresa'), (req, res) => {
  const result = hardDelete.deleteEmployee(req.user, req.params.employeeId);
  if (!result.ok) return res.status(result.status).json({ error: result.error });
  return res.json({ ok: true, deleted: result.deleted });
});

router.delete('/companies/:companyId', requireAuth, requireRole('superadmin'), (req, res) => {
  const result = hardDelete.deleteCompany(req.user, req.params.companyId);
  if (!result.ok) return res.status(result.status).json({ error: result.error });
  return res.json({ ok: true, deleted: result.deleted, cascade: result.cascade });
});

router.delete('/access-logs/:logId', requireAuth, requireRole('superadmin', 'admin_empresa'), (req, res) => {
  const result = hardDelete.deleteAccessLog(req.user, req.params.logId);
  if (!result.ok) return res.status(result.status).json({ error: result.error });
  return res.json({ ok: true });
});

module.exports = router;
