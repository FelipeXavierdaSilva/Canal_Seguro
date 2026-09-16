'use strict';

const express = require('express');
const usersService = require('../services/users.service');
const { requireAuth, requireRole } = require('../middleware/auth');

const router = express.Router();

router.post('/', requireAuth, requireRole('superadmin'), (req, res) => {
  const result = usersService.createUser(req.user, req.body || {});
  if (!result.ok) return res.status(result.status).json({ error: result.error });
  return res.status(201).json({ user: result.user });
});

router.post('/:userId/activate', requireAuth, requireRole('superadmin', 'admin_empresa'), (req, res) => {
  const result = usersService.activateUser(req.user, req.params.userId);
  if (!result.ok) return res.status(result.status).json({ error: result.error });
  return res.json({ user: result.user });
});

module.exports = router;
