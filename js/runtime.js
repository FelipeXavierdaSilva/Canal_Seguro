/**
 * runtime.js – Detecta modo servidor (Etapa 03 Fase 1).
 * Quando a API está disponível, operações críticas usam CSHttpApi.
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

  async function probe() {
    const base = apiBase();
    if (!base) {
      serverMode = false;
      return false;
    }
    try {
      const res = await fetch(`${base}/health`, { credentials: 'include' });
      serverMode = res.ok;
    } catch {
      serverMode = false;
    }
    return serverMode;
  }

  function useServer() {
    return serverMode === true;
  }

  function isResolved() {
    return serverMode !== null;
  }

  return {
    apiBase,
    probe,
    useServer,
    isResolved
  };
})();

window.CSRuntime = CSRuntime;
