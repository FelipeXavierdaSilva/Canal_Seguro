/**
 * http-api.js – Cliente HTTP para API Canal Seguro (Etapa 03 Fase 1).
 * Credenciais via cookie HttpOnly; employee token em sessionStorage auxiliar.
 */
const CSHttpApi = (() => {
  const EMPLOYEE_TOKEN_KEY = 'canal_seguro_employee_token_v1';

  function base() {
    return CSRuntime.apiBase();
  }

  function readCsrfCookie() {
    if (typeof document === 'undefined') return '';
    const match = document.cookie.match(/(?:^|;\s*)cs_csrf=([^;]+)/);
    return match ? decodeURIComponent(match[1]) : '';
  }

  function withCsrf(headers, method) {
    const m = String(method || 'GET').toUpperCase();
    if (m === 'GET' || m === 'HEAD' || m === 'OPTIONS') return headers;
    const token = readCsrfCookie();
    if (token) headers['X-CSRF-Token'] = token;
    return headers;
  }

  async function request(path, options = {}) {
    const url = `${base()}${path}`;
    const headers = withCsrf({ ...(options.headers || {}) }, options.method || 'GET');
    if (options.body && !headers['Content-Type']) {
      headers['Content-Type'] = 'application/json';
    }
    const employeeToken = sessionStorage.getItem(EMPLOYEE_TOKEN_KEY);
    if (employeeToken && options.useEmployee) {
      headers['X-Employee-Token'] = employeeToken;
    }
    const res = await fetch(url, {
      ...options,
      headers,
      credentials: 'include',
      body: options.body !== undefined ? JSON.stringify(options.body) : undefined
    });
    let data = null;
    const text = await res.text();
    if (text) {
      try {
        data = JSON.parse(text);
      } catch {
        data = { raw: text };
      }
    }
    if (!res.ok) {
      const err = new Error(data?.error || `HTTP ${res.status}`);
      err.status = res.status;
      err.payload = data;
      throw err;
    }
    return data;
  }

  async function requestBlob(path, options = {}) {
    const url = `${base()}${path}`;
    const headers = withCsrf({ ...(options.headers || {}) }, options.method || 'GET');
    if (options.body && !headers['Content-Type']) {
      headers['Content-Type'] = 'application/json';
    }
    const res = await fetch(url, {
      method: options.method || 'GET',
      headers,
      credentials: 'include',
      body: options.body !== undefined ? JSON.stringify(options.body) : undefined
    });
    if (!res.ok) {
      let message = `HTTP ${res.status}`;
      try {
        const errJson = await res.json();
        message = errJson.error || message;
      } catch {
        /* ignore */
      }
      const err = new Error(message);
      err.status = res.status;
      throw err;
    }
    const blob = await res.blob();
    const disposition = res.headers.get('Content-Disposition') || '';
    const match = disposition.match(/filename="?([^";]+)"?/i);
    const filename = match ? match[1] : `export-${Date.now()}.pdf`;
    return { blob, filename };
  }

  async function login(email, password) {
    const data = await request('/auth/login', {
      method: 'POST',
      body: { email, password }
    });
    return data;
  }

  async function mfaVerify(code) {
    return request('/auth/mfa/verify', { method: 'POST', body: { code } });
  }

  async function mfaRecovery(code) {
    return request('/auth/mfa/recovery', { method: 'POST', body: { code } });
  }

  async function mfaEnrollStart() {
    return request('/auth/mfa/enroll/start', { method: 'POST', body: {} });
  }

  async function mfaEnrollConfirm(code) {
    return request('/auth/mfa/enroll/confirm', { method: 'POST', body: { code } });
  }

  async function mfaStatus() {
    return request('/auth/mfa/status');
  }

  async function getMfaPolicy() {
    return request('/settings/mfa-policy');
  }

  async function updateMfaPolicy(patch) {
    return request('/settings/mfa-policy', { method: 'PUT', body: patch });
  }

  async function adminResetUserMfa(userId) {
    return request(`/settings/users/${encodeURIComponent(userId)}/mfa/reset`, { method: 'POST', body: {} });
  }

  async function getEmailStats() {
    return request('/email/stats');
  }

  async function getEmailDeliveryLogs(limit = 50) {
    return request(`/email/delivery-logs?limit=${limit}`);
  }

  async function getCompanyEmailNotifications(companyId) {
    return request(`/email/notifications/${encodeURIComponent(companyId)}`);
  }

  async function updateCompanyEmailNotifications(companyId, patch) {
    return request(`/email/notifications/${encodeURIComponent(companyId)}`, {
      method: 'PUT',
      body: patch
    });
  }

  async function logout() {
    try {
      await request('/auth/logout', { method: 'POST' });
    } catch {
      /* ignore */
    }
    sessionStorage.removeItem(EMPLOYEE_TOKEN_KEY);
  }

  async function fetchMe() {
    try {
      const data = await request('/auth/me');
      return data.user;
    } catch {
      return null;
    }
  }

  async function validateEmployeeAccess(companyId, cpf) {
    try {
      const body = { cpf };
      if (companyId) body.companyId = companyId;
      const data = await request('/auth/employee/validate', {
        method: 'POST',
        body
      });
      if (data.employeeToken) {
        sessionStorage.setItem(EMPLOYEE_TOKEN_KEY, data.employeeToken);
      }
      return { ok: true, employee: data.employee };
    } catch (err) {
      return { ok: false, message: err.message || 'Não foi possível validar o acesso.' };
    }
  }

  function clearEmployeeToken() {
    sessionStorage.removeItem(EMPLOYEE_TOKEN_KEY);
    return request('/auth/employee/logout', { method: 'POST' }).catch(() => {});
  }

  async function getReports(filters = {}) {
    const params = new URLSearchParams();
    Object.entries(filters).forEach(([k, v]) => {
      if (v !== undefined && v !== null && v !== '') params.set(k, v);
    });
    const q = params.toString();
    return request(`/reports${q ? `?${q}` : ''}`);
  }

  async function getReport(idOrProtocol) {
    return request(`/reports/${encodeURIComponent(idOrProtocol)}`);
  }

  async function getReportHistory(reportId) {
    return request(`/reports/${encodeURIComponent(reportId)}/history`);
  }

  async function createReport(payload) {
    return request('/employee/reports', {
      method: 'POST',
      useEmployee: true,
      body: payload
    });
  }

  async function updateReportStatus(reportId, status, _actor, note = '') {
    return request(`/reports/${encodeURIComponent(reportId)}/status`, {
      method: 'PATCH',
      body: { status, note }
    });
  }

  async function assignReport(reportId, assigneeId) {
    return request(`/reports/${encodeURIComponent(reportId)}/assign`, {
      method: 'POST',
      body: { assigneeId }
    });
  }

  async function addReportObservation(reportId, text) {
    return request(`/reports/${encodeURIComponent(reportId)}/observations`, {
      method: 'POST',
      body: { text }
    });
  }

  async function addReportMeasure(reportId, payload) {
    return request(`/reports/${encodeURIComponent(reportId)}/measures`, {
      method: 'POST',
      body: payload || {}
    });
  }

  async function publicConsult(protocol, trackingCode) {
    return request('/public/consult', {
      method: 'POST',
      body: { protocol, trackingCode }
    });
  }

  async function getPublicMessages() {
    return request('/public/messages');
  }

  async function sendPublicMessage(text, attachments) {
    return request('/public/messages', {
      method: 'POST',
      body: { text, attachments }
    });
  }

  async function getReportMessages(reportId) {
    return request(`/reports/${encodeURIComponent(reportId)}/messages`);
  }

  async function sendReportMessage(reportId, text, options = {}) {
    return request(`/reports/${encodeURIComponent(reportId)}/messages`, {
      method: 'POST',
      body: {
        text,
        messageType: options.messageType || 'message',
        attachments: options.attachments
      }
    });
  }

  async function getDashboardMetrics(companyId) {
    const q = companyId ? `?companyId=${encodeURIComponent(companyId)}` : '';
    return request(`/reports/metrics/dashboard${q}`);
  }

  async function getRiskPolicy(companyId) {
    return request(`/settings/risk-policy/${encodeURIComponent(companyId)}`);
  }

  async function getRiskSuggestion(reportId) {
    return request(`/reports/${encodeURIComponent(reportId)}/risk/suggestion`);
  }

  async function getRiskHistory(reportId) {
    return request(`/reports/${encodeURIComponent(reportId)}/risk/history`);
  }

  async function classifyReportRisk(reportId, body) {
    return request(`/reports/${encodeURIComponent(reportId)}/risk`, {
      method: 'POST',
      body
    });
  }

  async function getReportWorkflow(reportId) {
    return request(`/reports/${encodeURIComponent(reportId)}/workflow`);
  }

  async function getReportWorkflowTimeline(reportId) {
    return request(`/reports/${encodeURIComponent(reportId)}/workflow/timeline`);
  }

  async function transitionReportWorkflow(reportId, body) {
    return request(`/reports/${encodeURIComponent(reportId)}/workflow/transition`, {
      method: 'POST',
      body
    });
  }

  async function updateReportWorkflowMeta(reportId, body) {
    return request(`/reports/${encodeURIComponent(reportId)}/workflow/meta`, {
      method: 'PATCH',
      body
    });
  }

  async function exportReportPdf(reportId, type = 'individual') {
    return requestBlob(`/reports/${encodeURIComponent(reportId)}/export/pdf`, {
      method: 'POST',
      body: { type }
    });
  }

  async function exportManagerialPdf(filters = {}) {
    return requestBlob('/reports/export/pdf', {
      method: 'POST',
      body: { filters }
    });
  }

  async function exportManagerialExcel(filters = {}) {
    return requestBlob('/reports/export/excel', {
      method: 'POST',
      body: { filters }
    });
  }

  async function getExportTypes() {
    return request('/reports/export/types');
  }

  async function getCompanyByDomain(domain) {
    return request(`/public/companies/${encodeURIComponent(domain)}`);
  }

  async function getPublicCompany(key) {
    return request(`/public/companies/${encodeURIComponent(key)}`);
  }

  async function getCompany(id) {
    return request(`/companies/${encodeURIComponent(id)}`);
  }

  async function updateCompany(id, payload) {
    return request(`/companies/${encodeURIComponent(id)}`, {
      method: 'PUT',
      body: payload
    });
  }

  async function downloadAttachment(reportId, attachmentId) {
    return requestBlob(
      `/reports/${encodeURIComponent(reportId)}/attachments/${encodeURIComponent(attachmentId)}/download`
    );
  }

  /**
   * Upload de anexo (base64) — POST /reports/:id/attachments
   * @param {string} reportId
   * @param {{ name: string, mimeType?: string, dataBase64: string }} payload
   */
  async function uploadAttachment(reportId, payload) {
    return request(`/reports/${encodeURIComponent(reportId)}/attachments`, {
      method: 'POST',
      body: {
        name: payload.name,
        mimeType: payload.mimeType || 'application/octet-stream',
        dataBase64: payload.dataBase64
      }
    });
  }

  async function getStorageUsage(companyId = null) {
    if (companyId) {
      return request(`/settings/storage-usage/${encodeURIComponent(companyId)}`);
    }
    return request('/settings/storage-usage');
  }

  async function updateStorageLimit(companyId, storageLimitBytes) {
    return request(`/settings/storage-usage/${encodeURIComponent(companyId)}`, {
      method: 'PUT',
      body: { storageLimitBytes }
    });
  }

  async function getStoragePlans(companyId = null) {
    const q = companyId ? `?companyId=${encodeURIComponent(companyId)}` : '';
    return request(`/settings/storage-plans${q}`);
  }

  async function getStoragePlanCatalog() {
    return request('/settings/storage-plan-catalog');
  }

  async function createStoragePlan(payload) {
    return request('/settings/storage-plan-catalog', {
      method: 'POST',
      body: payload || {}
    });
  }

  async function updateStoragePlan(planId, payload) {
    return request(`/settings/storage-plan-catalog/${encodeURIComponent(planId)}`, {
      method: 'PUT',
      body: payload || {}
    });
  }

  async function deleteStoragePlan(planId) {
    return request(`/settings/storage-plan-catalog/${encodeURIComponent(planId)}`, {
      method: 'DELETE'
    });
  }

  async function getPlatformStorage() {
    return request('/settings/platform-storage');
  }

  async function updatePlatformStorage(payload) {
    return request('/settings/platform-storage', {
      method: 'PUT',
      body: payload || {}
    });
  }

  async function getStoragePricing(companyId = null) {
    if (companyId) {
      return request(`/settings/storage-pricing/${encodeURIComponent(companyId)}`);
    }
    return request('/settings/storage-pricing');
  }

  async function updateStoragePricing(companyId, payload) {
    return request(`/settings/storage-pricing/${encodeURIComponent(companyId)}`, {
      method: 'PUT',
      body: payload || {}
    });
  }

  async function contractStoragePlan(planId, companyId = null) {
    const body = { planId };
    if (companyId) body.companyId = companyId;
    return request('/settings/storage-plans/contract', {
      method: 'POST',
      body
    });
  }

  async function getStorageUpgradeRequests(status = null) {
    const q = status ? `?status=${encodeURIComponent(status)}` : '';
    return request(`/settings/storage-upgrade-requests${q}`);
  }

  async function resolveStorageUpgradeRequest(requestId) {
    return request(`/settings/storage-upgrade-requests/${encodeURIComponent(requestId)}/resolve`, {
      method: 'POST',
      body: {}
    });
  }

  async function listPlatformSupport(filters = {}) {
    const q = new URLSearchParams();
    if (filters.companyId) q.set('companyId', filters.companyId);
    if (filters.status) q.set('status', filters.status);
    const qs = q.toString();
    return request(`/settings/platform-support${qs ? `?${qs}` : ''}`);
  }

  async function createPlatformSupport(payload) {
    return request('/settings/platform-support', { method: 'POST', body: payload || {} });
  }

  async function getPlatformSupportThread(threadId) {
    return request(`/settings/platform-support/${encodeURIComponent(threadId)}`);
  }

  async function replyPlatformSupport(threadId, body) {
    return request(`/settings/platform-support/${encodeURIComponent(threadId)}/messages`, {
      method: 'POST',
      body: { body }
    });
  }

  async function closePlatformSupport(threadId) {
    return request(`/settings/platform-support/${encodeURIComponent(threadId)}/close`, {
      method: 'POST',
      body: {}
    });
  }

  async function markPlatformSupportRead(threadId = null) {
    return request('/settings/platform-support/mark-read', {
      method: 'POST',
      body: threadId ? { threadId } : {}
    });
  }

  async function listInternalSupport() {
    return request('/settings/platform-internal-support');
  }

  async function createInternalSupport(payload) {
    return request('/settings/platform-internal-support', { method: 'POST', body: payload || {} });
  }

  async function getInternalSupportThread(threadId) {
    return request(`/settings/platform-internal-support/${encodeURIComponent(threadId)}`);
  }

  async function replyInternalSupport(threadId, body) {
    return request(`/settings/platform-internal-support/${encodeURIComponent(threadId)}/messages`, {
      method: 'POST',
      body: { body }
    });
  }

  async function markInternalSupportRead(threadId = null) {
    return request('/settings/platform-internal-support/mark-read', {
      method: 'POST',
      body: threadId ? { threadId } : {}
    });
  }

  async function getInternalSupportMaster() {
    return request('/settings/platform-internal-support/master');
  }

  async function submitAssistantFeedback(payload) {
    return request('/settings/platform-support/feedback', {
      method: 'POST',
      body: payload || {}
    });
  }

  async function listAssistantFeedback(filters = {}) {
    const q = new URLSearchParams();
    if (filters.rating != null && filters.rating !== '') q.set('rating', filters.rating);
    if (filters.withImprovement) q.set('withImprovement', '1');
    if (filters.companyId) q.set('companyId', filters.companyId);
    if (filters.category) q.set('category', filters.category);
    const qs = q.toString();
    return request(`/settings/platform-support/feedback${qs ? `?${qs}` : ''}`);
  }

  async function listSupportFaqs(opts = {}) {
    const q = opts.all ? '?all=1' : '';
    return request(`/settings/support-faq${q}`);
  }

  async function askSupportFaq(query) {
    return request('/settings/support-faq/ask', { method: 'POST', body: { query } });
  }

  async function askPublicSupportFaq(query) {
    return request('/public/support-faq/ask', { method: 'POST', body: { query } });
  }

  async function createSupportFaq(payload) {
    return request('/settings/support-faq', { method: 'POST', body: payload || {} });
  }

  async function updateSupportFaq(faqId, payload) {
    return request(`/settings/support-faq/${encodeURIComponent(faqId)}`, {
      method: 'PUT',
      body: payload || {}
    });
  }

  async function deleteSupportFaq(faqId) {
    return request(`/settings/support-faq/${encodeURIComponent(faqId)}`, { method: 'DELETE' });
  }

  async function getCategories() {
    return request('/public/meta/categories');
  }

  async function getStatuses() {
    return request('/public/meta/statuses');
  }

  async function getPublicStoragePlans() {
    return request('/public/meta/storage-plans');
  }

  async function getPublicCommercialContact() {
    return request('/public/meta/commercial-contact');
  }

  async function getCommercialContact() {
    return request('/settings/commercial-contact');
  }

  async function getDatabaseConfig() {
    return request('/settings/database');
  }

  async function updateDatabaseConfig(payload) {
    return request('/settings/database', {
      method: 'PUT',
      body: payload || {}
    });
  }

  async function testDatabaseConnection(payload) {
    return request('/settings/database/test', {
      method: 'POST',
      body: payload || {}
    });
  }

  async function updateCommercialContact(payload) {
    return request('/settings/commercial-contact', {
      method: 'PUT',
      body: payload || {}
    });
  }

  async function getUiDefaults() {
    return request('/settings/ui-defaults');
  }

  async function updatePlatformUiDefaults(payload) {
    return request('/settings/ui-defaults/platform', {
      method: 'PUT',
      body: payload || {}
    });
  }

  async function updateCompanyUiDefaults(payload) {
    return request('/settings/ui-defaults/company', {
      method: 'PUT',
      body: payload || {}
    });
  }

  async function updateMyUiDefaults(payload) {
    return request('/settings/ui-defaults/me', {
      method: 'PUT',
      body: payload || {}
    });
  }

  async function forgotPassword(email) {
    return request('/auth/forgot-password', {
      method: 'POST',
      body: { email }
    });
  }

  async function validateResetToken(token) {
    return request(`/auth/reset-password/validate?token=${encodeURIComponent(token)}`);
  }

  async function resetPassword(token, password, passwordConfirm) {
    return request('/auth/reset-password', {
      method: 'POST',
      body: { token, password, passwordConfirm }
    });
  }

  async function deleteUser(userId) {
    return request(`/users/${encodeURIComponent(userId)}`, { method: 'DELETE' });
  }

  async function getUsers(filters = {}) {
    const qs = new URLSearchParams();
    if (filters.companyId) qs.set('companyId', filters.companyId);
    if (filters.role) qs.set('role', filters.role);
    if (filters.status) qs.set('status', filters.status);
    const q = qs.toString();
    const data = await request(`/users${q ? `?${q}` : ''}`);
    return data.users || [];
  }

  async function getUser(userId) {
    const data = await request(`/users/${encodeURIComponent(userId)}`);
    return data.user;
  }

  async function createUser(payload) {
    const data = await request('/users', { method: 'POST', body: payload || {} });
    return data.user;
  }

  async function updateUser(userId, payload) {
    const data = await request(`/users/${encodeURIComponent(userId)}`, {
      method: 'PUT',
      body: payload || {}
    });
    return data.user;
  }

  async function getEmployees(filters = {}) {
    const qs = new URLSearchParams();
    if (filters.companyId) qs.set('companyId', filters.companyId);
    if (filters.status) qs.set('status', filters.status);
    if (filters.q) qs.set('q', filters.q);
    const q = qs.toString();
    const data = await request(`/employees${q ? `?${q}` : ''}`);
    return data.employees || [];
  }

  async function getEmployee(employeeId) {
    const data = await request(`/employees/${encodeURIComponent(employeeId)}`);
    return data.employee;
  }

  async function createEmployee(payload) {
    const data = await request('/employees', { method: 'POST', body: payload || {} });
    return data.employee;
  }

  async function updateEmployee(employeeId, payload) {
    const data = await request(`/employees/${encodeURIComponent(employeeId)}`, {
      method: 'PUT',
      body: payload || {}
    });
    return data.employee;
  }

  async function getContents(filters = {}) {
    const qs = new URLSearchParams();
    if (filters.companyId) qs.set('companyId', filters.companyId);
    if (filters.type) qs.set('type', filters.type);
    if (filters.status) qs.set('status', filters.status);
    if (filters.globalOnly) qs.set('globalOnly', '1');
    const q = qs.toString();
    const data = await request(`/contents${q ? `?${q}` : ''}`);
    return data.contents || [];
  }

  async function createContent(payload) {
    const data = await request('/contents', { method: 'POST', body: payload || {} });
    return data.content;
  }

  async function updateContent(contentId, payload) {
    const data = await request(`/contents/${encodeURIComponent(contentId)}`, {
      method: 'PUT',
      body: payload || {}
    });
    return data.content;
  }

  async function deleteContent(contentId) {
    return request(`/contents/${encodeURIComponent(contentId)}`, { method: 'DELETE' });
  }

  async function getCompanies(filters = {}) {
    const qs = new URLSearchParams();
    if (filters.status) qs.set('status', filters.status);
    if (filters.q) qs.set('q', filters.q);
    const q = qs.toString();
    const data = await request(`/companies${q ? `?${q}` : ''}`);
    return data.companies || [];
  }

  async function createCompany(payload) {
    const data = await request('/companies', { method: 'POST', body: payload || {} });
    return data.company;
  }

  async function deleteEmployee(employeeId) {
    return request(`/employees/${encodeURIComponent(employeeId)}`, { method: 'DELETE' });
  }

  async function deleteCompany(companyId) {
    return request(`/companies/${encodeURIComponent(companyId)}`, { method: 'DELETE' });
  }

  async function deleteAccessLog(logId) {
    return request(`/access-logs/${encodeURIComponent(logId)}`, { method: 'DELETE' });
  }

  async function getBackupStatus() {
    return request('/admin/backups/status');
  }

  async function listBackups() {
    return request('/admin/backups');
  }

  async function getBackup(backupId) {
    return request(`/admin/backups/${encodeURIComponent(backupId)}`);
  }

  async function createBackup(payload = {}) {
    return request('/admin/backups', { method: 'POST', body: payload || {} });
  }

  async function verifyBackup(backupId) {
    return request(`/admin/backups/${encodeURIComponent(backupId)}/verify`, {
      method: 'POST',
      body: {}
    });
  }

  async function restoreBackup(backupId, payload = {}) {
    return request(`/admin/backups/${encodeURIComponent(backupId)}/restore`, {
      method: 'POST',
      body: payload || {}
    });
  }

  async function restoreLatestBackup(payload = {}) {
    return request('/admin/backups/restore-latest', {
      method: 'POST',
      body: payload || {}
    });
  }

  function enabled() {
    return CSRuntime.useServer();
  }

  return {
    enabled,
    login,
    logout,
    fetchMe,
    validateEmployeeAccess,
    clearEmployeeToken,
    getReports,
    getReport,
    getReportHistory,
    createReport,
    updateReportStatus,
    assignReport,
    addReportObservation,
    addReportMeasure,
    publicConsult,
    getPublicMessages,
    sendPublicMessage,
    getReportMessages,
    sendReportMessage,
    getDashboardMetrics,
    getRiskPolicy,
    getRiskSuggestion,
    getRiskHistory,
    classifyReportRisk,
    getReportWorkflow,
    getReportWorkflowTimeline,
    transitionReportWorkflow,
    updateReportWorkflowMeta,
    exportReportPdf,
    exportManagerialPdf,
    exportManagerialExcel,
    getExportTypes,
    getCompanyByDomain,
    getPublicCompany,
    getCompany,
    updateCompany,
    downloadAttachment,
    uploadAttachment,
    getStorageUsage,
    updateStorageLimit,
    getStoragePlans,
    contractStoragePlan,
    getStoragePricing,
    updateStoragePricing,
    getStoragePlanCatalog,
    createStoragePlan,
    updateStoragePlan,
    deleteStoragePlan,
    getPlatformStorage,
    updatePlatformStorage,
    getStorageUpgradeRequests,
    resolveStorageUpgradeRequest,
    listPlatformSupport,
    createPlatformSupport,
    getPlatformSupportThread,
    replyPlatformSupport,
    closePlatformSupport,
    markPlatformSupportRead,
    listInternalSupport,
    createInternalSupport,
    getInternalSupportThread,
    replyInternalSupport,
    markInternalSupportRead,
    getInternalSupportMaster,
    submitAssistantFeedback,
    listAssistantFeedback,
    listSupportFaqs,
    askSupportFaq,
    askPublicSupportFaq,
    createSupportFaq,
    updateSupportFaq,
    deleteSupportFaq,
    getCategories,
    getStatuses,
    getPublicStoragePlans,
    getPublicCommercialContact,
    getCommercialContact,
    updateCommercialContact,
    getDatabaseConfig,
    updateDatabaseConfig,
    testDatabaseConnection,
    getUiDefaults,
    updatePlatformUiDefaults,
    updateCompanyUiDefaults,
    updateMyUiDefaults,
    forgotPassword,
    validateResetToken,
    resetPassword,
    deleteUser,
    getUsers,
    getUser,
    createUser,
    updateUser,
    getEmployees,
    getEmployee,
    createEmployee,
    updateEmployee,
    deleteEmployee,
    getContents,
    createContent,
    updateContent,
    deleteContent,
    getCompanies,
    createCompany,
    deleteCompany,
    deleteAccessLog,
    getBackupStatus,
    listBackups,
    getBackup,
    createBackup,
    verifyBackup,
    restoreBackup,
    restoreLatestBackup,
    mfaVerify,
    mfaRecovery,
    mfaEnrollStart,
    mfaEnrollConfirm,
    mfaStatus,
    getMfaPolicy,
    updateMfaPolicy,
    adminResetUserMfa,
    getEmailStats,
    getEmailDeliveryLogs,
    getCompanyEmailNotifications,
    updateCompanyEmailNotifications
  };
})();

window.CSHttpApi = CSHttpApi;
