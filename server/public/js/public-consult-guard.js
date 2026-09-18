/**
 * public-consult-guard.js – Proteção simulada contra enumeração na consulta pública.
 * Protótipo: sessionStorage. Futuro: substituir por rate limiting no back-end.
 */

const CSPublicConsultGuard = (() => {
  const STORAGE_KEY = 'canal_seguro_public_consult_v1';
  const WINDOW_MS = 15 * 60 * 1000;
  const MAX_FAILURES = 5;
  const BLOCK_MS = 5 * 60 * 1000;
  const MIN_RESPONSE_MS = 400;
  const PROGRESSIVE_DELAYS = [0, 500, 1000, 2000, 4000, 5000];

  const GENERIC_MESSAGE = 'Não foi possível validar os dados informados.';

  function loadState() {
    try {
      const raw = sessionStorage.getItem(STORAGE_KEY);
      if (!raw) return defaultState();
      return { ...defaultState(), ...JSON.parse(raw) };
    } catch {
      return defaultState();
    }
  }

  function defaultState() {
    return {
      failures: 0,
      windowStartedAt: Date.now(),
      blockedUntil: null
    };
  }

  function saveState(state) {
    sessionStorage.setItem(STORAGE_KEY, JSON.stringify(state));
  }

  function resetWindow(state) {
    state.failures = 0;
    state.windowStartedAt = Date.now();
    state.blockedUntil = null;
    return state;
  }

  function normalizeState(state) {
    const now = Date.now();
    if (state.blockedUntil && now >= state.blockedUntil) {
      return resetWindow(state);
    }
    if (!state.blockedUntil && now - state.windowStartedAt > WINDOW_MS) {
      state.failures = 0;
      state.windowStartedAt = now;
    }
    return state;
  }

  function checkAllowed() {
    let state = normalizeState(loadState());
    saveState(state);
    const now = Date.now();
    if (state.blockedUntil && now < state.blockedUntil) {
      return {
        allowed: false,
        blocked: true,
        retryAfterMs: state.blockedUntil - now,
        failures: state.failures,
        message: GENERIC_MESSAGE
      };
    }
    return {
      allowed: true,
      blocked: false,
      retryAfterMs: 0,
      failures: state.failures,
      message: GENERIC_MESSAGE
    };
  }

  function recordFailure() {
    let state = normalizeState(loadState());
    state.failures += 1;
    if (state.failures >= MAX_FAILURES) {
      state.blockedUntil = Date.now() + BLOCK_MS;
    }
    saveState(state);
    return checkAllowed();
  }

  function recordSuccess() {
    saveState(resetWindow(loadState()));
  }

  function progressiveDelayMs(failures) {
    const idx = Math.min(Math.max(failures, 0), PROGRESSIVE_DELAYS.length - 1);
    return PROGRESSIVE_DELAYS[idx];
  }

  function sleep(ms) {
    return new Promise((resolve) => setTimeout(resolve, ms));
  }

  function formatRetryWait(ms) {
    const totalSec = Math.ceil(ms / 1000);
    const min = Math.ceil(totalSec / 60);
    return min <= 1 ? '1 minuto' : `${min} minutos`;
  }

  /**
   * Consulta pública protegida. Mesma interface poderá ser usada via API REST no back-end.
   */
  async function consult(protocol, trackingCode) {
    const gate = checkAllowed();
    if (!gate.allowed) {
      if (typeof CSInfraLog !== 'undefined') {
        CSInfraLog.security('consulta_protocolo_bloqueio', {
          severity: 'warn',
          outcome: 'blocked',
          context: { failures: gate.failures, retryAfterMs: gate.retryAfterMs }
        });
      }
      return {
        ok: false,
        blocked: true,
        retryAfterMs: gate.retryAfterMs,
        message: GENERIC_MESSAGE,
        waitLabel: formatRetryWait(gate.retryAfterMs)
      };
    }

    const startedAt = Date.now();
    await sleep(progressiveDelayMs(gate.failures));

    let data = null;
    try {
      data = await CSApi.getReportPublicStatus(protocol, trackingCode);
    } catch (err) {
      CSErrors.logError(err, 'publicConsult.getReportPublicStatus');
      const afterFail = recordFailure();
      if (typeof CSInfraLog !== 'undefined') {
        CSInfraLog.security('consulta_protocolo_falha', {
          severity: 'info',
          outcome: 'failure',
          context: { failures: afterFail.failures, blocked: afterFail.blocked, source: 'exception' }
        });
      }
      return {
        ok: false,
        blocked: afterFail.blocked,
        retryAfterMs: afterFail.retryAfterMs,
        message: GENERIC_MESSAGE,
        waitLabel: afterFail.blocked ? formatRetryWait(afterFail.retryAfterMs) : null
      };
    }

    const elapsed = Date.now() - startedAt;
    if (elapsed < MIN_RESPONSE_MS) {
      await sleep(MIN_RESPONSE_MS - elapsed);
    }

    if (data) {
      recordSuccess();
      return { ok: true, data, message: null };
    }

    const afterFail = recordFailure();
    if (typeof CSInfraLog !== 'undefined') {
      CSInfraLog.security('consulta_protocolo_falha', {
        severity: 'info',
        outcome: 'failure',
        context: { failures: afterFail.failures, blocked: afterFail.blocked }
      });
    }
    return {
      ok: false,
      blocked: afterFail.blocked,
      retryAfterMs: afterFail.retryAfterMs,
      message: GENERIC_MESSAGE,
      waitLabel: afterFail.blocked ? formatRetryWait(afterFail.retryAfterMs) : null
    };
  }

  return {
    consult,
    checkAllowed,
    recordSuccess,
    recordFailure,
    GENERIC_MESSAGE,
    formatRetryWait
  };
})();

window.CSPublicConsultGuard = CSPublicConsultGuard;
