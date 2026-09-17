'use strict';

const express = require('express');
const usersService = require('../services/users.service');
const { requireAuth, requireRole } = require('../middleware/auth');

const router = express.Router();

router.get('/', requireAuth, requireRole('superadmin', 'admin_empresa', 'apurador'), (req, res) => {
  const result = usersService.listUsers(req.user, req.query || {});
  if (!result.ok) return res.status(result.status).json({ error: result.error });
  return res.json({ users: result.users });
});

router.post('/', requireAuth, requireRole('superadmin', 'admin_empresa'), (req, res) => {
  const result = usersService.createUser(req.user, req.body || {});
  if (!result.ok) return res.status(result.status).json({ error: result.error });
  return res.status(201).json({ user: result.user });
});

router.get('/:userId', requireAuth, requireRole('superadmin', 'admin_empresa', 'apurador'), (req, res) => {
  const result = usersService.getUser(req.user, req.params.userId);
  if (!result.ok) return res.status(result.status).json({ error: result.error });
  return res.json({ user: result.user });
});

router.put('/:userId', requireAuth, requireRole('superadmin', 'admin_empresa'), (req, res) => {
  const result = usersService.updateUser(req.user, req.params.userId, req.body || {});
  if (!result.ok) return res.status(result.status).json({ error: result.error });
  return res.json({ user: result.user });
});

router.post('/:userId/activate', requireAuth, requireRole('superadmin', 'admin_empresa'), (req, res) => {
  const result = usersService.activateUser(req.user, req.params.userId);
  if (!result.ok) return res.status(result.status).json({ error: result.error });
  return res.json({ user: result.user });
});

module.exports = router;
