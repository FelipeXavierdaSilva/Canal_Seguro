/**
 * auth.js – Sessão simulada (protótipo).
 * Em produção: autenticação segura no back-end (JWT/session, HTTPS, etc.).
 */

const CSAuth = (() => {
  const SESSION_KEY = 'canal_seguro_session_v1';

  function getSession() {
    try {
      const raw = sessionStorage.getItem(SESSION_KEY);
      return raw ? JSON.parse(raw) : null;
    } catch {
      return null;
    }
  }

  function setSession(user) {
    const { senha, ...safe } = user;
    sessionStorage.setItem(
      SESSION_KEY,
      JSON.stringify({
        ...safe,
        loggedAt: new Date().toISOString()
      })
    );
    return getSession();
  }

  function clearSession() {
    sessionStorage.removeItem(SESSION_KEY);
  }

  function isLoggedIn() {
    return !!getSession();
  }

  function hasRole(...roles) {
    const s = getSession();
    return s && roles.includes(s.role);
  }

  function canAccessCompany(companyId) {
    const s = getSession();
    if (!s) return false;
    if (s.role === 'superadmin') return true;
    return s.companyId === companyId;
  }

  async function login(email, password) {
    if (typeof CSRuntime !== 'undefined' && CSRuntime.useServer()) {
      try {
        const result = await CSHttpApi.login(email, password);
        if (result.complete === false) {
          return { mfaFlow: true, ...result };
        }
        return setSession(result.user);
      } catch (err) {
        if (typeof CSInfraLog !== 'undefined') {
          CSInfraLog.security('login_recusado', {
            severity: 'warn',
            outcome: 'failure',
            context: { emailHash: CSInfraLog.hashIdentifier(email), source: 'api' }
          });
        }
        throw new Error('Credenciais inválidas ou usuário inativo.');
      }
    }
    const data = window.CSStore.loadStore();
    const input = String(email).toLowerCase();
    const user = data.users.find(
      (u) => (
        (u.username && u.username.toLowerCase() === input) ||
        (u.email && u.email.toLowerCase() === input)
      ) && u.senha === password && u.status === 'ativo'
    );
    if (!user) {
      if (typeof CSInfraLog !== 'undefined') {
        CSInfraLog.security('login_recusado', {
          severity: 'warn',
          outcome: 'failure',
          context: { emailHash: CSInfraLog.hashIdentifier(email) }
        });
      }
      throw new Error('Credenciais inválidas ou usuário inativo.');
    }
    CSAudit.write(data, {
      userId: user.id,
      userName: user.nome,
      action: 'login',
      resourceType: 'session',
      companyId: user.companyId
    });
    window.CSStore.saveStore(data);
    return setSession(user);
  }

  async function logout() {
    if (typeof CSRuntime !== 'undefined' && CSRuntime.useServer()) {
      await CSHttpApi.logout();
      clearSession();
      return;
    }
    const s = getSession();
    if (s) {
      const data = window.CSStore.loadStore();
      CSAudit.write(data, {
        userId: s.id,
        userName: s.nome,
        action: 'logout',
        resourceType: 'session',
        companyId: s.companyId
      });
      window.CSStore.saveStore(data);
    }
    clearSession();
  }

  /**
   * Protege páginas administrativas.
   * @param {string[]} allowedRoles
   * @param {string} loginUrl
   */
  function requireAuth(allowedRoles = [], loginUrl = '../login.html') {
    const s = getSession();
    if (!s) {
      if (typeof CSInfraLog !== 'undefined') {
        CSInfraLog.security('acesso_negado', {
          severity: 'info',
          outcome: 'failure',
          context: { reason: 'no_session', requiredRoles: allowedRoles }
        });
      }
      window.location.href = loginUrl;
      return null;
    }
    if (allowedRoles.length && !allowedRoles.includes(s.role)) {
      if (typeof CSInfraLog !== 'undefined') {
        CSInfraLog.security('acesso_negado', {
          severity: 'warn',
          outcome: 'failure',
          actor: s,
          context: { reason: 'role_mismatch', requiredRoles: allowedRoles, userRole: s.role }
        });
      }
      if (s.role === 'superadmin') window.location.href = relativeAdmin();
      else window.location.href = relativeEmpresa();
      return null;
    }
    return s;
  }

  function relativeAdmin() {
    // detect path depth
    if (location.pathname.includes('/admin/')) return 'index.html';
    if (location.pathname.includes('/empresa/')) return '../admin/index.html';
    return 'admin/index.html';
  }

  function relativeEmpresa() {
    if (location.pathname.includes('/empresa/')) return 'dashboard.html';
    if (location.pathname.includes('/admin/')) return '../empresa/dashboard.html';
    return 'empresa/dashboard.html';
  }

  function redirectAfterLogin(user) {
    if (user.role === 'superadmin') {
      window.location.href = pathTo('admin/index.html');
    } else {
      window.location.href = pathTo('empresa/dashboard.html');
    }
  }

  function pathTo(target) {
    const path = location.pathname.replace(/\\/g, '/');
    if (path.includes('/admin/') || path.includes('/empresa/')) return `../${target}`;
    return target;
  }

  async function syncSessionFromServer() {
    if (typeof CSRuntime === 'undefined' || !CSRuntime.useServer()) {
      return getSession();
    }
    try {
      const user = await CSHttpApi.fetchMe();
      if (user) return setSession(user);
    } catch {
      /* ignore */
    }
    clearSession();
    return null;
  }

  return {
    getSession,
    setSession,
    clearSession,
    isLoggedIn,
    hasRole,
    canAccessCompany,
    login,
    logout,
    syncSessionFromServer,
    requireAuth,
    redirectAfterLogin
  };
})();

window.CSAuth = CSAuth;
