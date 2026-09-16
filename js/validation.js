/**
 * validation.js – Validação de formulários (front-end)
 */

const CSValidation = (() => {
  function required(value, label = 'Campo') {
    if (value === undefined || value === null || String(value).trim() === '') {
      return `${label} é obrigatório.`;
    }
    return null;
  }

  function email(value, label = 'E-mail') {
    if (!value) return null;
    const ok = /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(String(value).trim());
    return ok ? null : `${label} inválido.`;
  }

  function phone(value, label = 'Telefone') {
    if (!value) return null;
    const digits = String(value).replace(/\D/g, '');
    return digits.length >= 10 ? null : `${label} inválido.`;
  }

  function cnpj(value) {
    if (!value) return 'CNPJ é obrigatório.';
    const digits = String(value).replace(/\D/g, '');
    return digits.length === 14 ? null : 'CNPJ deve conter 14 dígitos.';
  }

  function normalizeCpf(value) {
    return String(value || '').replace(/\D/g, '');
  }

  function maskCpf(digits) {
    const d = normalizeCpf(digits);
    if (d.length !== 11) return '***.***.***-**';
    return `***.${d.slice(3, 6)}.${d.slice(6, 9)}-**`;
  }

  function formatCpf(value) {
    const d = normalizeCpf(value);
    if (d.length !== 11) return value;
    return `${d.slice(0, 3)}.${d.slice(3, 6)}.${d.slice(6, 9)}-${d.slice(9)}`;
  }

  /** Valida dígitos verificadores do CPF (formato brasileiro). */
  function cpf(value, label = 'CPF') {
    const digits = normalizeCpf(value);
    if (!digits) return `${label} é obrigatório.`;
    if (digits.length !== 11) return `${label} deve conter 11 dígitos.`;
    if (/^(\d)\1{10}$/.test(digits)) return `${label} inválido.`;

    let sum = 0;
    for (let i = 0; i < 9; i++) sum += parseInt(digits[i], 10) * (10 - i);
    let rest = (sum * 10) % 11;
    if (rest === 10) rest = 0;
    if (rest !== parseInt(digits[9], 10)) return `${label} inválido.`;

    sum = 0;
    for (let i = 0; i < 10; i++) sum += parseInt(digits[i], 10) * (11 - i);
    rest = (sum * 10) % 11;
    if (rest === 10) rest = 0;
    if (rest !== parseInt(digits[10], 10)) return `${label} inválido.`;

    return null;
  }

  function minLength(value, min, label = 'Campo') {
    if (!value || String(value).trim().length < min) {
      return `${label} deve ter ao menos ${min} caracteres.`;
    }
    return null;
  }

  /** Validação UX — autoridade final no servidor. */
  function strongPassword(value, label = 'Senha') {
    if (typeof CSPasswordStrength !== 'undefined' && CSPasswordStrength.validate) {
      return CSPasswordStrength.validate(value, label);
    }
    const err = minLength(value, 6, label);
    if (err) return err;
    if (!/[a-z]/.test(value)) return `${label} deve conter ao menos uma letra minúscula.`;
    if (!/[A-Z]/.test(value)) return `${label} deve conter ao menos uma letra maiúscula.`;
    if (!/[0-9]/.test(value)) return `${label} deve conter ao menos um número.`;
    return null;
  }

  function setFieldError(el, message) {
    const group = el.closest('.form-group');
    if (!group) return;
    group.classList.toggle('has-error', !!message);
    let msg = group.querySelector('.error-msg');
    if (!msg) {
      msg = document.createElement('span');
      msg.className = 'error-msg';
      group.appendChild(msg);
    }
    msg.textContent = message || '';
  }

  function clearErrors(form) {
    form.querySelectorAll('.form-group.has-error').forEach((g) => g.classList.remove('has-error'));
  }

  function validateForm(form, rules) {
    clearErrors(form);
    let firstInvalid = null;
    const values = {};
    let ok = true;

    Object.entries(rules).forEach(([name, validators]) => {
      const el = form.elements[name] || form.querySelector(`[name="${name}"]`);
      const value = el ? el.value : '';
      values[name] = value;
      for (const fn of validators) {
        const err = fn(value);
        if (err) {
          ok = false;
          if (el) {
            setFieldError(el, err);
            if (!firstInvalid) firstInvalid = el;
          }
          break;
        }
      }
    });

    if (firstInvalid) firstInvalid.focus();
    return { ok, values };
  }

  return {
    required,
    email,
    phone,
    cnpj,
    cpf,
    normalizeCpf,
    maskCpf,
    formatCpf,
    minLength,
    strongPassword,
    setFieldError,
    clearErrors,
    validateForm
  };
})();

window.CSValidation = CSValidation;
