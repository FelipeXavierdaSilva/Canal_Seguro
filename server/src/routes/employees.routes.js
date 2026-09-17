'use strict';

const express = require('express');
const employeesService = require('../services/employees.service');
const { requireAuth, requireRole } = require('../middleware/auth');

const router = express.Router();

router.get('/', requireAuth, requireRole('superadmin', 'admin_empresa', 'apurador'), (req, res) => {
  const result = employeesService.listEmployees(req.user, req.query || {});
  if (!result.ok) return res.status(result.status).json({ error: result.error });
  return res.json({ employees: result.employees });
});

router.post('/', requireAuth, requireRole('superadmin', 'admin_empresa'), (req, res) => {
  const result = employeesService.createEmployee(req.user, req.body || {});
  if (!result.ok) return res.status(result.status).json({ error: result.error });
  return res.status(201).json({ employee: result.employee });
});

router.get('/:employeeId', requireAuth, requireRole('superadmin', 'admin_empresa', 'apurador'), (req, res) => {
  const result = employeesService.getEmployee(req.user, req.params.employeeId);
  if (!result.ok) return res.status(result.status).json({ error: result.error });
  return res.json({ employee: result.employee });
});

router.put('/:employeeId', requireAuth, requireRole('superadmin', 'admin_empresa'), (req, res) => {
  const result = employeesService.updateEmployee(req.user, req.params.employeeId, req.body || {});
  if (!result.ok) return res.status(result.status).json({ error: result.error });
  return res.json({ employee: result.employee });
});

module.exports = router;
