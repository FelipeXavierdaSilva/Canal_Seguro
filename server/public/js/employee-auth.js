/**
 * employee-auth.js – Sessão do colaborador após validação por CPF (protótipo).
 * Em produção: token JWT curto emitido pelo back-end após validação segura.
 */

const CSEmployeeAuth = (() => {
  const SESSION_KEY = 'canal_seguro_employee_session_v1';
  const TTL_MS = 30 * 60 * 1000; // 30 minutos

  function getSession() {
    try {
      const raw = sessionStorage.getItem(SESSION_KEY);
      if (!raw) return null;
      const session = JSON.parse(raw);
      if (!session.expiresAt || Date.now() > session.expiresAt) {
        clearSession();
        return null;
      }
      return session;
    } catch {
      return null;
    }
  }

  function setSession(companyId, employee) {
    const session = {
      companyId,
      employeeId: employee.id,
      nome: employee.nome,
      setor: employee.setor || '',
      cargo: employee.cargo || '',
      email: employee.email || '',
      telefone: employee.telefone || '',
      loggedAt: new Date().toISOString(),
      expiresAt: Date.now() + TTL_MS
    };
    sessionStorage.setItem(SESSION_KEY, JSON.stringify(session));
    return session;
  }

  function clearSession() {
    sessionStorage.removeItem(SESSION_KEY);
    if (typeof CSRuntime !== 'undefined' && CSRuntime.useServer() && typeof CSHttpApi !== 'undefined') {
      CSHttpApi.clearEmployeeToken();
    }
  }

  function isAuthorizedForCompany(companyId) {
    const s = getSession();
    return s && s.companyId === companyId && s.employeeId;
  }

  async function validateAccess(companyId, cpf) {
    const result = await CSApi.validateEmployeeAccess(companyId || null, cpf);
    if (!result.ok) {
      throw new Error(result.message || 'CPF não autorizado.');
    }
    const resolvedCompanyId = result.employee.companyId || companyId;
    if (!resolvedCompanyId) {
      throw new Error('Não foi possível identificar a empresa deste CPF.');
    }
    if (typeof CSCompanies !== 'undefined') {
      CSCompanies.setTenantId(resolvedCompanyId);
    }
    return setSession(resolvedCompanyId, result.employee);
  }

  return {
    getSession,
    setSession,
    clearSession,
    isAuthorizedForCompany,
    validateAccess
  };
})();

window.CSEmployeeAuth = CSEmployeeAuth;
