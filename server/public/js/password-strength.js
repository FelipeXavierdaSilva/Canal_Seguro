/**
 * password-strength.js – Regras e termômetro de senha (browser + Node).
 * Piso de aceite: média (6+ com maiúscula, minúscula, número e sem 3 dígitos em sequência).
 */
(function (root, factory) {
  const api = factory();
  if (typeof module === 'object' && module.exports) {
    module.exports = api;
  }
  if (root && typeof root === 'object') {
    root.CSPasswordStrength = api;
  }
})(typeof globalThis !== 'undefined' ? globalThis : this, function () {
  const MIN_LENGTH = 6;
  const VERY_STRONG_LENGTH = 12;

  const COMMON_WEAK = new Set([
    'password',
    'password123',
    '12345678',
    '123456789',
    'qwerty123',
    'admin123',
    'empresa123',
    'fxadmin123',
    'canalseguro',
    'senha123'
  ]);

  const LEVELS = {
    empty: { id: 'empty', score: 0, label: '', acceptable: false },
    weak: { id: 'weak', score: 1, label: 'Fraca', acceptable: false },
    medium: { id: 'medium', score: 2, label: 'Média', acceptable: true },
    strong: { id: 'strong', score: 3, label: 'Forte', acceptable: true },
    very_strong: { id: 'very_strong', score: 4, label: 'Muito forte', acceptable: true }
  };

  function hasSequentialDigits(value) {
    const runs = String(value).match(/\d+/g) || [];
    for (const run of runs) {
      if (run.length < 3) continue;
      for (let i = 0; i <= run.length - 3; i++) {
        const a = Number(run[i]);
        const b = Number(run[i + 1]);
        const c = Number(run[i + 2]);
        if (b === a + 1 && c === b + 1) return true;
        if (b === a - 1 && c === b - 1) return true;
      }
    }
    return false;
  }

  function collectFailures(value) {
    const reasons = [];
    if (value.length < MIN_LENGTH) {
      reasons.push(`deve ter ao menos ${MIN_LENGTH} caracteres`);
    }
    if (!/[a-z]/.test(value)) {
      reasons.push('deve conter ao menos uma letra minúscula');
    }
    if (!/[A-Z]/.test(value)) {
      reasons.push('deve conter ao menos uma letra maiúscula');
    }
    if (!/[0-9]/.test(value)) {
      reasons.push('deve conter ao menos um número');
    }
    if (COMMON_WEAK.has(value.toLowerCase())) {
      reasons.push('muito comum. Escolha uma senha mais segura');
    }
    if (hasSequentialDigits(value)) {
      reasons.push('não pode ter 3 ou mais números em sequência (ex.: 123)');
    }
    return reasons;
  }

  function assess(password) {
    const value = String(password || '');
    if (!value) {
      return {
        ...LEVELS.empty,
        message: '',
        reasons: []
      };
    }

    const reasons = collectFailures(value);
    if (reasons.length) {
      return {
        ...LEVELS.weak,
        message: 'Senha fraca. Escolha uma senha mais forte.',
        reasons
      };
    }

    const hasSpecial = /[^A-Za-z0-9]/.test(value);
    if (hasSpecial && value.length >= VERY_STRONG_LENGTH) {
      return { ...LEVELS.very_strong, message: 'Muito forte', reasons: [] };
    }
    if (hasSpecial) {
      return { ...LEVELS.strong, message: 'Forte', reasons: [] };
    }
    return { ...LEVELS.medium, message: 'Média', reasons: [] };
  }

  function validate(password, label = 'Senha') {
    const value = String(password || '');
    if (!value) return `${label} é obrigatória.`;
    const result = assess(value);
    if (result.acceptable) return null;
    const first = result.reasons && result.reasons[0];
    if (first) {
      return `${label} ${first}.`;
    }
    return result.message || `${label} fraca. Escolha uma senha mais forte.`;
  }

  function meterMarkup() {
    return (
      '<div class="pwd-meter" hidden>' +
        '<div class="pwd-meter__bar" role="meter" aria-valuemin="0" aria-valuemax="4" aria-valuenow="0">' +
          '<span class="pwd-meter__seg"></span>' +
          '<span class="pwd-meter__seg"></span>' +
          '<span class="pwd-meter__seg"></span>' +
          '<span class="pwd-meter__seg"></span>' +
        '</div>' +
        '<p class="pwd-meter__label" aria-live="polite"></p>' +
      '</div>'
    );
  }

  function renderMeter(meter, result) {
    const bar = meter.querySelector('.pwd-meter__bar');
    const label = meter.querySelector('.pwd-meter__label');
    meter.classList.remove('pwd-meter--weak', 'pwd-meter--medium', 'pwd-meter--strong', 'pwd-meter--very_strong');
    if (!result.score) {
      meter.hidden = true;
      if (bar) bar.setAttribute('aria-valuenow', '0');
      if (label) label.textContent = '';
      return;
    }
    meter.hidden = false;
    meter.classList.add(`pwd-meter--${result.id}`);
    if (bar) bar.setAttribute('aria-valuenow', String(result.score));
    if (label) {
      if (result.id === 'weak' && result.reasons && result.reasons[0]) {
        label.textContent = `Fraca — ${result.reasons[0]}.`;
      } else {
        label.textContent = result.label;
      }
    }
  }

  function bindMeter(input) {
    if (typeof document === 'undefined' || !input || input.dataset.pwdMeterBound === '1') return;
    input.dataset.pwdMeterBound = '1';

    const wrap = document.createElement('div');
    wrap.innerHTML = meterMarkup();
    const meter = wrap.firstElementChild;
    const host = input.closest('[style*="position:relative"]') || input;
    host.insertAdjacentElement('afterend', meter);

    const update = () => {
      const result = assess(input.value);
      renderMeter(meter, result);
      input.setAttribute('aria-invalid', result.score && !result.acceptable ? 'true' : 'false');
    };

    input.addEventListener('input', update);
    input.addEventListener('change', update);
    if (input.value) update();
  }

  function autoBind(root) {
    if (typeof document === 'undefined') return;
    const scope = root && root.querySelectorAll ? root : document;
    scope.querySelectorAll('[data-password-meter]').forEach(bindMeter);
  }

  if (typeof document !== 'undefined') {
    const run = () => autoBind();
    if (document.readyState === 'loading') {
      document.addEventListener('DOMContentLoaded', run);
    } else {
      run();
    }
  }

  return {
    MIN_LENGTH,
    VERY_STRONG_LENGTH,
    COMMON_WEAK,
    LEVELS,
    hasSequentialDigits,
    assess,
    validate,
    bindMeter,
    autoBind
  };
});
