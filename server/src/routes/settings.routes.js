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
    plans: storagePlans.listPlans(companyId, { forApurador: req.user.role === 'apurador' }),
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

const platformSupport = require('../services/platform-support.service');
const platformInternalSupport = require('../services/platform-internal-support.service');
const supportFaq = require('../services/support-faq.service');

router.get('/support-faq', requireAuth, (req, res) => {
  const includeDisabled = req.user.role === 'superadmin' && String(req.query?.all || '') === '1';
  const result = supportFaq.listFaqs(req.user, { includeDisabled });
  if (!result.ok) return res.status(result.status).json({ error: result.error || 'Acesso negado.' });
  return res.json(result.data);
});

router.post('/support-faq/ask', requireAuth, (req, res) => {
  const result = supportFaq.askBot(req.user, req.body || {});
  if (!result.ok) return res.status(result.status).json({ error: result.error || 'Acesso negado.' });
  return res.json(result.data);
});

router.post('/support-faq', requireAuth, requireRole('superadmin'), (req, res) => {
  const result = supportFaq.createFaq(req.user, req.body || {});
  if (!result.ok) return res.status(result.status).json({ error: result.error || 'Acesso negado.' });
  return res.status(201).json(result.data);
});

router.put('/support-faq/:faqId', requireAuth, requireRole('superadmin'), (req, res) => {
  const result = supportFaq.updateFaq(req.user, req.params.faqId, req.body || {});
  if (!result.ok) return res.status(result.status).json({ error: result.error || 'Acesso negado.' });
  return res.json(result.data);
});

router.delete('/support-faq/:faqId', requireAuth, requireRole('superadmin'), (req, res) => {
  const result = supportFaq.deleteFaq(req.user, req.params.faqId);
  if (!result.ok) return res.status(result.status).json({ error: result.error || 'Acesso negado.' });
  return res.json(result.data);
});

router.get('/platform-support', requireAuth, (req, res) => {
  const result = platformSupport.listThreads(req.user, {
    companyId: req.query?.companyId || null,
    status: req.query?.status || null
  });
  if (!result.ok) return res.status(result.status).json({ error: result.error || 'Acesso negado.' });
  return res.json(result.data);
});

router.post('/platform-support', requireAuth, (req, res) => {
  const result = platformSupport.createThread(req.user, req.body || {});
  if (!result.ok) return res.status(result.status).json({ error: result.error || 'Acesso negado.' });
  return res.status(201).json(result.data);
});

router.post('/platform-support/mark-read', requireAuth, (req, res) => {
  const result = platformSupport.markCompanyRead(req.user, req.body?.threadId || null);
  if (!result.ok) return res.status(result.status).json({ error: result.error || 'Acesso negado.' });
  return res.json(result.data);
});

router.post('/platform-support/feedback', requireAuth, (req, res) => {
  const result = platformSupport.submitAssistantFeedback(req.user, req.body || {});
  if (!result.ok) return res.status(result.status).json({ error: result.error || 'Acesso negado.' });
  return res.status(201).json(result.data);
});

router.get('/platform-support/feedback', requireAuth, requireRole('superadmin'), (req, res) => {
  const result = platformSupport.listAssistantFeedback(req.user, {
    rating: req.query?.rating || null,
    withImprovement: req.query?.withImprovement || null,
    companyId: req.query?.companyId || null,
    category: req.query?.category || null
  });
  if (!result.ok) return res.status(result.status).json({ error: result.error || 'Acesso negado.' });
  return res.json(result.data);
});

router.get('/platform-support/:threadId', requireAuth, (req, res) => {
  const result = platformSupport.getThread(req.user, req.params.threadId);
  if (!result.ok) return res.status(result.status).json({ error: result.error || 'Acesso negado.' });
  return res.json(result.data);
});

router.post('/platform-support/:threadId/messages', requireAuth, (req, res) => {
  const result = platformSupport.addMessage(req.user, req.params.threadId, req.body || {});
  if (!result.ok) return res.status(result.status).json({ error: result.error || 'Acesso negado.' });
  return res.json(result.data);
});

router.post('/platform-support/:threadId/close', requireAuth, requireRole('superadmin'), (req, res) => {
  const result = platformSupport.closeThread(req.user, req.params.threadId);
  if (!result.ok) return res.status(result.status).json({ error: result.error || 'Acesso negado.' });
  return res.json(result.data);
});

router.get('/platform-internal-support/master', requireAuth, requireRole('superadmin'), (req, res) => {
  const result = platformInternalSupport.getMasterInfo(req.user);
  if (!result.ok) return res.status(result.status).json({ error: result.error || 'Acesso negado.' });
  return res.json(result.data);
});

router.get('/platform-internal-support', requireAuth, requireRole('superadmin'), (req, res) => {
  const result = platformInternalSupport.listThreads(req.user);
  if (!result.ok) return res.status(result.status).json({ error: result.error || 'Acesso negado.' });
  return res.json(result.data);
});

router.post('/platform-internal-support', requireAuth, requireRole('superadmin'), (req, res) => {
  const result = platformInternalSupport.createThread(req.user, req.body || {});
  if (!result.ok) return res.status(result.status).json({ error: result.error || 'Acesso negado.' });
  return res.status(201).json(result.data);
});

router.post('/platform-internal-support/mark-read', requireAuth, requireRole('superadmin'), (req, res) => {
  const result = platformInternalSupport.markRead(req.user, req.body?.threadId || null);
  if (!result.ok) return res.status(result.status).json({ error: result.error || 'Acesso negado.' });
  return res.json(result.data);
});

router.get('/platform-internal-support/:threadId', requireAuth, requireRole('superadmin'), (req, res) => {
  const result = platformInternalSupport.getThread(req.user, req.params.threadId);
  if (!result.ok) return res.status(result.status).json({ error: result.error || 'Acesso negado.' });
  return res.json(result.data);
});

router.post('/platform-internal-support/:threadId/messages', requireAuth, requireRole('superadmin'), (req, res) => {
  const result = platformInternalSupport.addMessage(req.user, req.params.threadId, req.body || {});
  if (!result.ok) return res.status(result.status).json({ error: result.error || 'Acesso negado.' });
  return res.json(result.data);
});

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

const uiDefaults = require('../services/ui-defaults.service');

router.get('/ui-defaults', requireAuth, (req, res) => {
  const result = uiDefaults.getUiDefaultsForUser(req.user);
  if (!result.ok) return res.status(result.status).json({ error: result.error || 'Acesso negado.' });
  return res.json(result.data);
});

router.put('/ui-defaults/platform', requireAuth, requireRole('superadmin'), (req, res) => {
  const result = uiDefaults.updatePlatformTableFont(req.user, req.body?.tableFontSize);
  if (!result.ok) return res.status(result.status).json({ error: result.error || 'Acesso negado.' });
  return res.json(result.data);
});

router.put('/ui-defaults/company', requireAuth, requireRole('admin_empresa'), (req, res) => {
  const result = uiDefaults.updateCompanyTableFont(req.user, req.body?.tableFontSize);
  if (!result.ok) return res.status(result.status).json({ error: result.error || 'Acesso negado.' });
  return res.json(result.data);
});

router.put('/ui-defaults/me', requireAuth, (req, res) => {
  const result = uiDefaults.updateMyTableFont(req.user, req.body?.tableFontSize);
  if (!result.ok) return res.status(result.status).json({ error: result.error || 'Acesso negado.' });
  return res.json(result.data);
});

router.get('/database', requireAuth, requireRole('superadmin'), (req, res) => {
  const dbConfig = require('../services/db-config.service');
  const result = dbConfig.getConfigForAdmin(req.user);
  if (!result.ok) return res.status(result.status).json({ error: result.error || 'Acesso negado.' });
  return res.json(result.data);
});

router.put('/database', requireAuth, requireRole('superadmin'), (req, res) => {
  const dbConfig = require('../services/db-config.service');
  const result = dbConfig.updateConfigForAdmin(req.user, req.body || {});
  if (!result.ok) return res.status(result.status).json({ error: result.error || 'Acesso negado.' });
  return res.json(result.data);
});

router.post('/database/test', requireAuth, requireRole('superadmin'), async (req, res) => {
  const dbConfig = require('../services/db-config.service');
  const result = await dbConfig.testConnectionForAdmin(req.user, req.body || {});
  if (!result.ok) return res.status(result.status || 400).json({ error: result.error || 'Falha no teste.' });
  return res.json(result.data);
});

module.exports = router;
