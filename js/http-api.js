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

  async function updateCommercialContact(payload) {
    return request('/settings/commercial-contact', {
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

  async function deleteEmployee(employeeId) {
    return request(`/employees/${encodeURIComponent(employeeId)}`, { method: 'DELETE' });
  }

  async function deleteCompany(companyId) {
    return request(`/companies/${encodeURIComponent(companyId)}`, { method: 'DELETE' });
  }

  async function deleteAccessLog(logId) {
    return request(`/access-logs/${encodeURIComponent(logId)}`, { method: 'DELETE' });
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
    getCategories,
    getStatuses,
    getPublicStoragePlans,
    getPublicCommercialContact,
    getCommercialContact,
    updateCommercialContact,
    forgotPassword,
    validateResetToken,
    resetPassword,
    deleteUser,
    deleteEmployee,
    deleteCompany,
    deleteAccessLog,
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
