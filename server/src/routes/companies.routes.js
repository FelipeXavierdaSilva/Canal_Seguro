'use strict';

const express = require('express');
const companiesService = require('../services/companies.service');
const { requireAuth, requireRole } = require('../middleware/auth');

const router = express.Router();

router.get('/', requireAuth, (req, res) => {
  const result = companiesService.listCompanies(req.user, req.query || {});
  if (!result.ok) return res.status(result.status).json({ error: result.error });
  return res.json({ companies: result.companies });
});

router.post('/', requireAuth, requireRole('superadmin'), (req, res) => {
  const result = companiesService.createCompany(req.user, req.body || {});
  if (!result.ok) return res.status(result.status).json({ error: result.error });
  return res.status(201).json({ company: result.company });
});

module.exports = router;
