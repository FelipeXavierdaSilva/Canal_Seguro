'use strict';

const express = require('express');
const reportsService = require('../services/reports.service');
const reportMessages = require('../services/report-messages.service');
const riskClassification = require('../services/risk-classification.service');
const workflowService = require('../services/workflow.service');
const exportService = require('../services/export.service');
const attachmentStorage = require('../services/attachment-storage.service');
const {
  requireAuth,
  requireEmployee,
  requirePermission,
  tenantFromSession
} = require('../middleware/auth');
const router = express.Router();

router.use(requireAuth, tenantFromSession);

router.get('/', requirePermission('reports:read'), (req, res) => {
  const filters = { ...req.query };
  if (req.tenantId) filters.companyId = req.tenantId;
  else if (req.query.companyId && req.user.role === 'superadmin') {
    filters.companyId = req.query.companyId;
  }
  const result = reportsService.listReports(req.user, filters);
  if (!result.ok) return res.status(result.status).json({ error: 'Acesso negado.' });
  return res.json(result.data);
});

router.get('/metrics/dashboard', requirePermission('reports:read'), (req, res) => {
  const filters = {};
  if (req.tenantId) filters.companyId = req.tenantId;
  else if (req.query.companyId && req.user.role === 'superadmin') {
    filters.companyId = req.query.companyId;
  }
  const result = reportsService.getDashboardMetrics(req.user, filters);
  if (!result.ok) return res.status(result.status).json({ error: 'Acesso negado.' });
  return res.json(result.data);
});

router.get('/export/types', requireAuth, (req, res) => {
  return res.json({ types: exportService.listExportTypes(req.user) });
});

router.post('/export/pdf', requirePermission('reports:export'), async (req, res) => {
  const filters = { ...(req.body?.filters || {}), ...req.query };
  if (req.tenantId) filters.companyId = req.tenantId;
  else if (filters.companyId && req.user.role !== 'superadmin') {
    delete filters.companyId;
  }
  const result = await exportService.exportManagerialPdf(req.user, filters);
  if (!result.ok) return res.status(result.status).json({ error: result.error });
  res.setHeader('Content-Type', result.contentType);
  res.setHeader('Content-Disposition', `attachment; filename="${result.filename}"`);
  res.setHeader('Cache-Control', 'no-store, private');
  return res.send(result.buffer);
});

router.post('/export/excel', requirePermission('reports:export'), async (req, res) => {
  const filters = { ...(req.body?.filters || {}), ...req.query };
  if (req.tenantId) filters.companyId = req.tenantId;
  else if (filters.companyId && req.user.role !== 'superadmin') {
    delete filters.companyId;
  }
  const result = await exportService.exportManagerialExcel(req.user, filters);
  if (!result.ok) return res.status(result.status).json({ error: result.error });
  res.setHeader('Content-Type', result.contentType);
  res.setHeader('Content-Disposition', `attachment; filename="${result.filename}"`);
  res.setHeader('Cache-Control', 'no-store, private');
  return res.send(result.buffer);
});

router.get('/export/download/:token', requireAuth, (req, res) => {
  const result = exportService.consumeDownloadToken(req.user, req.params.token);
  if (!result.ok) return res.status(result.status).json({ error: result.error });
  res.setHeader('Content-Type', result.contentType);
  res.setHeader('Content-Disposition', `attachment; filename="${result.filename}"`);
  res.setHeader('Cache-Control', 'no-store, private');
  return res.send(result.buffer);
});

router.get('/:id/risk/suggestion', requirePermission('reports:read'), (req, res) => {
  const result = riskClassification.getSuggestion(req.user, req.params.id);
  if (!result.ok) return res.status(result.status).json({ error: result.error });
  return res.json({ suggestion: result.suggestion, policy: result.policy });
});

router.get('/:id/risk/history', requirePermission('reports:read'), (req, res) => {
  const result = riskClassification.listHistory(req.user, req.params.id);
  if (!result.ok) return res.status(result.status).json({ error: result.error });
  return res.json(result.history);
});

router.post('/:id/risk', requirePermission('reports:classify_risk'), (req, res) => {
  const result = riskClassification.classifyReport(req.user, req.params.id, req.body || {});
  if (!result.ok) return res.status(result.status).json({ error: result.error });
  return res.json(result.data);
});

router.get('/:id/workflow', requirePermission('reports:read'), (req, res) => {
  const result = workflowService.getWorkflowState(req.user, req.params.id);
  if (!result.ok) return res.status(result.status).json({ error: result.error });
  return res.json(result);
});

router.get('/:id/workflow/timeline', requirePermission('reports:read'), (req, res) => {
  const result = workflowService.getVisualTimeline(req.user, req.params.id);
  if (!result.ok) return res.status(result.status).json({ error: result.error });
  return res.json(result);
});

router.post('/:id/workflow/transition', requirePermission('reports:transition_workflow'), (req, res) => {
  const result = workflowService.transitionReport(req.user, req.params.id, req.body || {});
  if (!result.ok) return res.status(result.status).json({ error: result.error });
  return res.json(result.data);
});

router.patch('/:id/workflow/meta', requirePermission('reports:transition_workflow'), (req, res) => {
  const result = workflowService.updateReportMeta(req.user, req.params.id, req.body || {});
  if (!result.ok) return res.status(result.status).json({ error: result.error });
  return res.json(result.data);
});

router.post('/:id/export/pdf', requireAuth, async (req, res) => {
  const exportType = req.body?.type || req.query.type || 'individual';
  const canIndividual = exportService.listExportTypes(req.user).some((t) => t.id === exportType);
  if (!canIndividual) {
    return res.status(403).json({ error: 'Sem permissão para este tipo de exportação.' });
  }
  const result = await exportService.exportReportPdf(req.user, req.params.id, exportType);
  if (!result.ok) return res.status(result.status).json({ error: result.error });
  res.setHeader('Content-Type', result.contentType);
  res.setHeader('Content-Disposition', `attachment; filename="${result.filename}"`);
  res.setHeader('Cache-Control', 'no-store, private');
  return res.send(result.buffer);
});

router.post('/:id/attachments', requirePermission('reports:comment'), (req, res) => {
  /* Ignora companyId/reportId spoof no body — tenant vem do relato + sessão */
  const { name, mimeType, dataBase64 } = req.body || {};
  const result = attachmentStorage.uploadAttachment(req.user, req.params.id, {
    name,
    mimeType,
    dataBase64
  });
  if (!result.ok) return res.status(result.status).json({ error: result.error });
  return res.status(201).json({ attachment: result.attachment });
});

router.get('/:id/attachments/:attachmentId/download', requirePermission('reports:read'), (req, res) => {
  const result = attachmentStorage.downloadAttachment(
    req.user,
    req.params.id,
    req.params.attachmentId
  );
  if (!result.ok) return res.status(result.status).json({ error: result.error });
  res.setHeader('Content-Type', result.contentType);
  res.setHeader('Content-Disposition', `attachment; filename="${result.filename}"`);
  res.setHeader('Cache-Control', 'no-store, private');
  return res.send(result.buffer);
});

router.get('/:id', requirePermission('reports:read'), (req, res) => {
  const result = reportsService.getReport(req.user, req.params.id);
  if (!result.ok) return res.status(result.status).json({ error: 'Relato não encontrado.' });
  return res.json(result.data);
});

router.get('/:id/history', requirePermission('reports:read'), (req, res) => {
  const result = reportsService.getHistory(req.user, req.params.id);
  if (!result.ok) return res.status(result.status).json({ error: 'Relato não encontrado.' });
  return res.json(result.data);
});

router.patch('/:id/status', requirePermission('reports:update_status'), (req, res) => {
  const { status, note } = req.body || {};
  const result = reportsService.updateStatus(req.user, req.params.id, status, note);
  if (!result.ok) {
    return res.status(result.status).json({ error: result.message || 'Operação negada.' });
  }
  return res.json(result.data);
});

router.post('/:id/assign', requirePermission('reports:assign'), (req, res) => {
  const { assigneeId } = req.body || {};
  const result = reportsService.assignReport(req.user, req.params.id, assigneeId);
  if (!result.ok) {
    return res.status(result.status).json({ error: result.message || 'Operação negada.' });
  }
  return res.json(result.data);
});

router.post('/:id/observations', requirePermission('reports:comment'), (req, res) => {
  const { text, kind } = req.body || {};
  const result = reportsService.addObservation(req.user, req.params.id, text, { kind });
  if (!result.ok) {
    return res.status(result.status).json({ error: result.message || 'Operação negada.' });
  }
  return res.json(result.data);
});

router.post('/:id/measures', requirePermission('reports:comment'), (req, res) => {
  const result = reportsService.addMeasureAction(req.user, req.params.id, req.body || {});
  if (!result.ok) {
    return res.status(result.status).json({ error: result.message || 'Operação negada.' });
  }
  return res.status(201).json(result.data);
});

router.get('/:id/messages', requirePermission('reports:read'), (req, res) => {
  const result = reportMessages.getThreadForStaff(req.user, req.params.id);
  if (!result.ok) return res.status(result.status).json({ error: result.error });
  return res.json({ messages: result.messages, unreadCount: result.unreadCount });
});

router.post('/:id/messages', requirePermission('reports:comment'), (req, res) => {
  const { text, messageType, attachments } = req.body || {};
  const result = reportMessages.sendCompanyMessage(req.user, req.params.id, {
    text,
    messageType,
    attachments
  });
  if (!result.ok) return res.status(result.status).json({ error: result.error });
  return res.status(201).json(result.message);
});

const employeeRouter = express.Router();
employeeRouter.post('/', requireEmployee, (req, res) => {
  const result = reportsService.createReport(req.employee, req.body || {});
  if (!result.ok) {
    return res.status(result.status).json({ error: result.message || 'Envio negado.' });
  }
  return res.status(201).json(result.data);
});

module.exports = { router, employeeRouter };
