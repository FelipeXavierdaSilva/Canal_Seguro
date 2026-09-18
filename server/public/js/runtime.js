/**
 * runtime.js – Detecta modo servidor (Etapa 03 Fase 1 / Etapa 6 go-live).
 * Quando a API está disponível, operações críticas usam CSHttpApi.
 * Em hosts de produção (não-localhost), o fallback localStorage é bloqueado.
 */
const CSRuntime = (() => {
  const DEFAULT_BASE = '';

  function apiBase() {
    if (typeof window.CS_API_BASE === 'string' && window.CS_API_BASE) {
      return window.CS_API_BASE.replace(/\/$/, '');
    }
    if (location.protocol.startsWith('http')) {
      return `${location.origin}/api/v1`;
    }
    return DEFAULT_BASE;
  }

  let serverMode = null;
  let lastProbeError = null;

  function isLocalDevHost() {
    const h = (location.hostname || '').toLowerCase();
    return (
      h === 'localhost' ||
      h === '127.0.0.1' ||
      h === '[::1]' ||
      h === '' ||
      h.endsWith('.local')
    );
  }

  /**
   * Produção / Hostinger: exige API. Dev local e file:// podem usar protótipo localStorage.
   * Override: window.CS_FORCE_API = true|false
   */
  function requireServer() {
    if (typeof window.CS_FORCE_API === 'boolean') return window.CS_FORCE_API;
    if (location.protocol === 'file:') return false;
    return !isLocalDevHost();
  }

  async function probe() {
    const base = apiBase();
    lastProbeError = null;
    if (!base) {
      serverMode = false;
      lastProbeError = 'API base vazia';
      return false;
    }
    try {
      const res = await fetch(`${base}/health`, { credentials: 'include' });
      serverMode = res.ok;
      if (!res.ok) lastProbeError = `health HTTP ${res.status}`;
    } catch (err) {
      serverMode = false;
      lastProbeError = err && err.message ? err.message : 'Falha de rede no health';
    }
    return serverMode;
  }

  function useServer() {
    return serverMode === true;
  }

  function isResolved() {
    return serverMode !== null;
  }

  function getLastProbeError() {
    return lastProbeError;
  }

  return {
    apiBase,
    probe,
    useServer,
    isResolved,
    requireServer,
    isLocalDevHost,
    getLastProbeError
  };
})();

window.CSRuntime = CSRuntime;
