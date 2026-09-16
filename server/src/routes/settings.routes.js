'use strict';

const express = require('express');
const mfaService = require('../services/mfa.service');
const riskClassification = require('../services/risk-classification.service');
const companyStorage = require('../services/company-storage.service');
const storagePlans = require('../services/storage-plans.service');
const platformStorage = require('../services/platform-storage.service');
const { requireAuth, requireRole } = require('../middleware/auth');
const router = express.Router();

router.get('/platform-storage', requireAuth, requireRole('superadmin'), (req, res) => {
  const result = platformStorage.getPlatformCapacity(req.user, { emitAlerts: true });
  if (!result.ok) return res.status(result.status).json({ error: result.error || 'Acesso negado.' });
  return res.json(result.data);
});

router.put('/platform-storage', requireAuth, requireRole('superadmin'), (req, res) => {
  const result = platformStorage.updatePlatformCapacityConfig(req.user, req.body || {});
  if (!result.ok) return res.status(result.status).json({ error: result.error || 'Acesso negado.' });
  return res.json(result.data);
});

router.get('/commercial-contact', requireAuth, requireRole('superadmin'), (req, res) => {
  const commercial = require('../services/commercial-contact.service');
  const result = commercial.getCommercialContactForAdmin(req.user);
  if (!result.ok) return res.status(result.status).json({ error: result.error || 'Acesso negado.' });
  return res.json(result.data);
});

router.put('/commercial-contact', requireAuth, requireRole('superadmin'), (req, res) => {
  const commercial = require('../services/commercial-contact.service');
  const result = commercial.updateCommercialContact(req.user, req.body || {});
  if (!result.ok) return res.status(result.status).json({ error: result.error || 'Acesso negado.' });
  return res.json(result.data);
});

router.get('/storage-plans', requireAuth, requireRole('admin_empresa', 'apurador', 'superadmin'), (req, res) => {
  const companyId = storagePlans.resolveCompanyIdForPlans(req.user, req.query?.companyId || null);
  return res.json({
    plans: storagePlans.listPlans(companyId),
    companyId: companyId || null
  });
});

router.get('/storage-plan-catalog', requireAuth, requireRole('superadmin'), (req, res) => {
  const result = storagePlans.listCatalogForAdmin(req.user);
  if (!result.ok) return res.status(result.status).json({ error: result.error || 'Acesso negado.' });
  return res.json(result.data);
});

router.post('/storage-plan-catalog', requireAuth, requireRole('superadmin'), (req, res) => {
  const result = storagePlans.createCatalogPlan(req.user, req.body || {});
  if (!result.ok) return res.status(result.status).json({ error: result.error || 'Acesso negado.' });
  return res.status(201).json(result.data);
});

router.put('/storage-plan-catalog/:planId', requireAuth, requireRole('superadmin'), (req, res) => {
  const result = storagePlans.updateCatalogPlan(req.user, req.params.planId, req.body || {});
  if (!result.ok) return res.status(result.status).json({ error: result.error || 'Acesso negado.' });
  return res.json(result.data);
});

router.delete('/storage-plan-catalog/:planId', requireAuth, requireRole('superadmin'), (req, res) => {
  const result = storagePlans.deleteCatalogPlan(req.user, req.params.planId);
  if (!result.ok) return res.status(result.status).json({ error: result.error || 'Acesso negado.' });
  return res.json(result.data);
});

router.get('/storage-pricing', requireAuth, requireRole('superadmin'), (req, res) => {
  const result = storagePlans.listPricingConfigs(req.user);
  if (!result.ok) return res.status(result.status).json({ error: result.error || 'Acesso negado.' });
  return res.json(result.data);
});

router.get('/storage-pricing/:companyId', requireAuth, requireRole('superadmin'), (req, res) => {
  const result = storagePlans.getPricingConfig(req.user, req.params.companyId);
  if (!result.ok) return res.status(result.status).json({ error: result.error || 'Acesso negado.' });
  return res.json(result.data);
});

router.put('/storage-pricing/:companyId', requireAuth, requireRole('superadmin'), (req, res) => {
  const result = storagePlans.updatePricingConfig(req.user, req.params.companyId, req.body || {});
  if (!result.ok) return res.status(result.status).json({ error: result.error || 'Acesso negado.' });
  return res.json(result.data);
});

router.post('/storage-plans/contract', requireAuth, (req, res) => {
  if (!req.user || !['admin_empresa', 'superadmin'].includes(req.user.role)) {
    return res.status(403).json({ error: 'Apenas o Adm_Empresa pode contratar este serviço.' });
  }
  const result = storagePlans.contractPlan(req.user, req.body?.planId, req.body?.companyId || null);
  if (!result.ok) return res.status(result.status).json({ error: result.error || 'Acesso negado.' });
  return res.json(result.data);
});

router.get('/storage-upgrade-requests', requireAuth, requireRole('superadmin'), (req, res) => {
  const result = storagePlans.listUpgradeRequests(req.user, {
    status: req.query?.status || null
  });
  if (!result.ok) return res.status(result.status).json({ error: result.error || 'Acesso negado.' });
  return res.json(result.data);
});

router.post(
  '/storage-upgrade-requests/:requestId/resolve',
  requireAuth,
  requireRole('superadmin'),
  (req, res) => {
    const result = storagePlans.resolveUpgradeRequest(req.user, req.params.requestId);
    if (!result.ok) return res.status(result.status).json({ error: result.error || 'Acesso negado.' });
    return res.json(result.data);
  }
);

router.get('/storage-usage', requireAuth, (req, res) => {
  /* Superadmin: lista todas. Demais roles: só a própria empresa. */
  const result = companyStorage.getStorageUsageForUser(req.user, null);
  if (!result.ok) return res.status(result.status).json({ error: result.error || 'Acesso negado.' });
  return res.json(result.data);
});

router.get('/storage-usage/:companyId', requireAuth, (req, res) => {
  const result = companyStorage.getStorageUsageForUser(req.user, req.params.companyId);
  if (!result.ok) return res.status(result.status).json({ error: result.error || 'Acesso negado.' });
  return res.json(result.data);
});

router.put('/storage-usage/:companyId', requireAuth, requireRole('superadmin'), (req, res) => {
  const result = companyStorage.updateCompanyStorageLimit(
    req.user,
    req.params.companyId,
    req.body?.storageLimitBytes
  );
  if (!result.ok) return res.status(result.status).json({ error: result.error || 'Acesso negado.' });
  return res.json(result.data);
});

router.get('/mfa-policy', requireAuth, requireRole('superadmin'), (_req, res) => {
  return res.json({ policy: mfaService.getPlatformPolicy() });
});

router.put('/mfa-policy', requireAuth, requireRole('superadmin'), (req, res) => {
  const result = mfaService.updatePlatformPolicy(req.user, req.body || {});
  if (!result.ok) return res.status(result.status).json({ error: result.error });
  return res.json({ policy: result.policy });
});

router.post('/users/:userId/mfa/reset', requireAuth, requireRole('superadmin'), (req, res) => {
  const result = mfaService.adminResetUserMfa(req.user, req.params.userId);
  if (!result.ok) return res.status(result.status).json({ error: result.error });
  return res.json({ message: result.message });
});

router.get('/risk-policy/:companyId', requireAuth, (req, res) => {
  const result = riskClassification.getRiskPolicy(req.user, req.params.companyId);
  if (!result.ok) return res.status(result.status).json({ error: result.error });
  return res.json({ policy: result.policy });
});

router.put('/risk-policy/:companyId', requireAuth, (req, res) => {
  const result = riskClassification.updateRiskPolicy(req.user, req.params.companyId, req.body || {});
  if (!result.ok) return res.status(result.status).json({ error: result.error });
  return res.json({ policy: result.policy });
});

module.exports = router;
