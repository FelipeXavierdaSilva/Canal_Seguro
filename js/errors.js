/**
 * errors.js – Tratamento centralizado de erros (protótipo).
 * Mensagens amigáveis ao usuário; detalhes técnicos apenas no console.
 */

const CSErrors = (() => {
  const DEFAULT_FALLBACK = 'Não foi possível carregar as informações. Tente novamente.';
  const ACTION_FALLBACK = 'Não foi possível concluir a operação. Tente novamente.';

  const TECHNICAL_PATTERNS = [
    /cannot read propert/i,
    /undefined is not/i,
    /null is not/i,
    /is not a function/i,
    /failed to fetch/i,
    /networkerror/i,
    /unexpected token/i,
    /syntaxerror/i,
    /at\s+\w+/i,
    /\n\s+at /,
    /stack/i
  ];

  function escapeHtml(str) {
    if (typeof window.CSApp !== 'undefined') return CSApp.escapeHtml(str);
    return String(str)
      .replace(/&/g, '&amp;')
      .replace(/</g, '&lt;')
      .replace(/>/g, '&gt;');
  }

  function looksTechnical(message) {
    const msg = String(message || '').trim();
    if (!msg) return true;
    if (msg.length > 220) return true;
    return TECHNICAL_PATTERNS.some((pattern) => pattern.test(msg));
  }

  function userMessage(err, fallback = DEFAULT_FALLBACK) {
    if (!err) return fallback;
    if (typeof err === 'string') {
      return looksTechnical(err) ? fallback : err;
    }
    const msg = err.message || String(err);
    if (looksTechnical(msg)) return fallback;
    return msg.trim() || fallback;
  }

  function logError(err, context = '') {
    if (typeof console !== 'undefined' && console.error) {
      console.error('[Canal Seguro]', context || 'error', err);
    }
    if (typeof CSInfraLog !== 'undefined') {
      CSInfraLog.logError(err, context, {
        event: context === 'unhandledrejection' ? 'excecao_nao_tratada' : 'erro_aplicacao'
      });
    }
  }

  async function runAsync(fn, options = {}) {
    const {
      context = '',
      fallback = ACTION_FALLBACK,
      toast = true,
      toastType = 'error',
      rethrow = false
    } = options;

    try {
      return await fn();
    } catch (err) {
      logError(err, context);
      if (toast && typeof window.CSApp !== 'undefined') {
        CSApp.toast(userMessage(err, fallback), toastType);
      }
      if (rethrow) throw err;
      return null;
    }
  }

  function renderLoadError(container, message, onRetry) {
    if (!container) return;
    const msg = escapeHtml(message || DEFAULT_FALLBACK);
    container.innerHTML = `
      <div class="empty-state">
        <p>${msg}</p>
        ${onRetry ? '<button type="button" class="btn btn-outline btn-sm mt-2" data-retry-load>Tentar novamente</button>' : ''}
      </div>`;
    if (onRetry) {
      container.querySelector('[data-retry-load]')?.addEventListener('click', () => onRetry());
    }
  }

  function renderTableRetry(tbody, colspan, onRetry, message) {
    if (!tbody) return;
    const msg = escapeHtml(message || DEFAULT_FALLBACK);
    tbody.innerHTML = `
      <tr>
        <td colspan="${colspan}" class="empty-state">
          <p>${msg}</p>
          <button type="button" class="btn btn-outline btn-sm mt-2" data-retry-load>Tentar novamente</button>
        </td>
      </tr>`;
    tbody.querySelector('[data-retry-load]')?.addEventListener('click', () => onRetry());
  }

  function installGlobalHandlers() {
    window.addEventListener('unhandledrejection', (event) => {
      logError(event.reason, 'unhandledrejection');
      if (typeof window.CSApp !== 'undefined') {
        CSApp.toast(DEFAULT_FALLBACK, 'error');
      }
      event.preventDefault();
    });
  }

  installGlobalHandlers();

  return {
    DEFAULT_FALLBACK,
    ACTION_FALLBACK,
    userMessage,
    logError,
    runAsync,
    renderLoadError,
    renderTableRetry,
    installGlobalHandlers
  };
})();

window.CSErrors = CSErrors;
