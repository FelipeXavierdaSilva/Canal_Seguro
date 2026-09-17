'use strict';

/**
 * Visibilidade de relatos (need-to-know).
 * Adm_Empresa / superadmin: todos do tenant.
 * Apurador: somente se for o responsável (assigneeId) ou estiver em teamIds.
 */

function assertTenantAccess(user, resourceCompanyId) {
  if (!user) return { ok: false, status: 401 };
  if (user.role === 'superadmin') return { ok: true };
  if (!resourceCompanyId || user.companyId !== resourceCompanyId) {
    return { ok: false, status: 404 };
  }
  return { ok: true };
}

function isDirectedToUser(report, userId) {
  if (!report || !userId) return false;
  if (report.assigneeId === userId) return true;
  return Array.isArray(report.teamIds) && report.teamIds.includes(userId);
}

function assertReportVisibility(user, report) {
  if (!user) return { ok: false, status: 401 };
  if (!report) return { ok: false, status: 404 };

  const tenant = assertTenantAccess(user, report.companyId);
  if (!tenant.ok) return tenant;

  if (user.role === 'superadmin' || user.role === 'admin_empresa') {
    return { ok: true };
  }

  if (user.role === 'apurador') {
    if (isDirectedToUser(report, user.id)) return { ok: true };
    return { ok: false, status: 404 };
  }

  return { ok: false, status: 403 };
}

function filterVisibleReports(user, list) {
  if (!user || user.role !== 'apurador') return list || [];
  return (list || []).filter((r) => isDirectedToUser(r, user.id));
}

module.exports = {
  assertTenantAccess,
  assertReportVisibility,
  isDirectedToUser,
  filterVisibleReports
};
