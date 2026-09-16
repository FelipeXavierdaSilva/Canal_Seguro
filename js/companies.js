/**
 * companies.js – Helpers de empresa / multi-tenant
 */

const CSCompanies = (() => {
  const TENANT_KEY = 'canal_seguro_tenant';

  function getTenantId() {
    const params = new URLSearchParams(location.search);
    const fromQuery = params.get('empresa') || params.get('tenant');
    if (fromQuery) {
      sessionStorage.setItem(TENANT_KEY, fromQuery);
      return fromQuery;
    }
    return sessionStorage.getItem(TENANT_KEY) || null;
  }

  function setTenantId(id) {
    if (!id) {
      sessionStorage.removeItem(TENANT_KEY);
      return;
    }
    sessionStorage.setItem(TENANT_KEY, id);
  }

  function clearTenantId() {
    sessionStorage.removeItem(TENANT_KEY);
  }

  function hasTenant() {
    return Boolean(getTenantId());
  }

  async function getCurrentCompany() {
    const id = getTenantId();
    if (!id) return null;
    return CSApi.getPublicCompany(id);
  }

  function clearCompanyThemeOverrides() {
    const root = document.documentElement;
    ['--cs-primary', '--cs-primary-hover', '--cs-primary-soft', '--cs-secondary'].forEach((prop) => {
      root.style.removeProperty(prop);
    });
  }

  function renderPlatformBrand(selectors = {}) {
    clearCompanyThemeOverrides();
    document.querySelectorAll(selectors.name || '[data-company-name]').forEach((el) => {
      if (el.tagName === 'INPUT' || el.tagName === 'TEXTAREA') el.value = '';
      else el.textContent = '';
    });
    document.querySelectorAll(selectors.logo || '[data-company-logo]').forEach((el) => {
      const defaultLogo = el.getAttribute('data-default-logo');
      el.src = defaultLogo ? assetPath(defaultLogo) : assetPath('assets/images/logo-canal-seguro.png');
      el.alt = 'Canal Seguro — Canal de Denúncias';
    });
    // Mantém mensagem genérica já escrita no HTML ([data-canal-message])
  }

  function applyCompanyTheme(company) {
    if (!company) return;
    const root = document.documentElement;
    if (company.corPrincipal) {
      root.style.setProperty('--cs-primary', company.corPrincipal);
      root.style.setProperty('--cs-primary-hover', shadeColor(company.corPrincipal, -18));
      root.style.setProperty('--cs-primary-soft', hexToRgba(company.corPrincipal, 0.12));
    }
    if (company.corSecundaria) {
      root.style.setProperty('--cs-secondary', company.corSecundaria);
    }
  }

  function shadeColor(hex, percent) {
    const { r, g, b } = hexToRgb(hex);
    const t = percent < 0 ? 0 : 255;
    const p = Math.abs(percent) / 100;
    const R = Math.round((t - r) * p + r);
    const G = Math.round((t - g) * p + g);
    const B = Math.round((t - b) * p + b);
    return `rgb(${R},${G},${B})`;
  }

  function hexToRgb(hex) {
    let h = hex.replace('#', '');
    if (h.length === 3) h = h.split('').map((c) => c + c).join('');
    const n = parseInt(h, 16);
    return { r: (n >> 16) & 255, g: (n >> 8) & 255, b: n & 255 };
  }

  function hexToRgba(hex, a) {
    const { r, g, b } = hexToRgb(hex);
    return `rgba(${r},${g},${b},${a})`;
  }

  async function renderCompanyBrand(selectors = {}) {
    const company = await getCurrentCompany();
    if (!company) {
      renderPlatformBrand(selectors);
      return null;
    }
    applyCompanyTheme(company);

    const setText = (el, value) => {
      if (el.tagName === 'INPUT' || el.tagName === 'TEXTAREA') el.value = value;
      else el.textContent = value;
    };

    document.querySelectorAll(selectors.name || '[data-company-name]').forEach((el) => {
      setText(el, company.nomeFantasia);
    });
    document.querySelectorAll(selectors.canal || '[data-canal-name]').forEach((el) => {
      const name = company.nomeCanal || 'Canal Seguro';
      if (
        (el.classList.contains('brand__name') || el.classList.contains('brand__name--split')) &&
        /canal\s+seguro/i.test(name)
      ) {
        el.innerHTML =
          '<span class="brand__canal">CANAL</span><span class="brand__seguro">SEGURO</span>';
      } else {
        setText(el, name);
      }
    });
    document.querySelectorAll(selectors.message || '[data-canal-message]').forEach((el) => {
      setText(el, company.mensagemInicial);
    });
    document.querySelectorAll(selectors.logo || '[data-company-logo]').forEach((el) => {
      if (company.logo) {
        el.src = company.logo;
        el.alt = company.nomeFantasia || 'Logo da empresa';
      } else {
        const defaultLogo = el.getAttribute('data-default-logo');
        el.src = defaultLogo ? assetPath(defaultLogo) : assetPath('assets/images/logo-empresa.svg');
        el.alt = company.nomeFantasia || 'Logo da empresa';
      }
    });
    return company;
  }

  function assetPath(rel) {
    if (location.pathname.includes('/admin/') || location.pathname.includes('/empresa/')) {
      return `../${rel}`;
    }
    return rel;
  }

  function defaultLogoUrl() {
    return assetPath('assets/images/logo-empresa.svg');
  }

  /**
   * Lê imagem do input e gera data URL redimensionada (protótipo / localStorage).
   * Em produção: upload para storage seguro no back-end.
   */
  function readLogoFile(file, options = {}) {
    const maxBytes = options.maxBytes || 2.5 * 1024 * 1024;
    const maxSide = options.maxSide || 512;
    const quality = options.quality || 0.88;

    return new Promise((resolve, reject) => {
      if (!file) {
        reject(new Error('Selecione um arquivo de imagem.'));
        return;
      }
      const allowed = ['image/jpeg', 'image/png', 'image/webp', 'image/gif', 'image/svg+xml'];
      if (!allowed.includes(file.type) && !/\.(jpe?g|png|webp|gif|svg)$/i.test(file.name)) {
        reject(new Error('Use PNG, JPG, WEBP, GIF ou SVG.'));
        return;
      }
      if (file.size > maxBytes) {
        reject(new Error('Arquivo muito grande. Máximo aproximado: 2,5 MB.'));
        return;
      }

      if (file.type === 'image/svg+xml') {
        const reader = new FileReader();
        reader.onload = () => resolve(String(reader.result));
        reader.onerror = () => reject(new Error('Não foi possível ler o arquivo.'));
        reader.readAsDataURL(file);
        return;
      }

      const reader = new FileReader();
      reader.onerror = () => reject(new Error('Não foi possível ler o arquivo.'));
      reader.onload = () => {
        const img = new Image();
        img.onerror = () => reject(new Error('Imagem inválida ou corrompida.'));
        img.onload = () => {
          let { width, height } = img;
          const scale = Math.min(1, maxSide / Math.max(width, height));
          width = Math.max(1, Math.round(width * scale));
          height = Math.max(1, Math.round(height * scale));
          const canvas = document.createElement('canvas');
          canvas.width = width;
          canvas.height = height;
          const ctx = canvas.getContext('2d');
          ctx.fillStyle = '#ffffff';
          ctx.fillRect(0, 0, width, height);
          ctx.drawImage(img, 0, 0, width, height);
          const mime = file.type === 'image/png' ? 'image/png' : 'image/jpeg';
          const dataUrl = canvas.toDataURL(mime, quality);
          if (dataUrl.length > 900000) {
            reject(new Error('Imagem ainda muito grande após compactar. Use um arquivo menor.'));
            return;
          }
          resolve(dataUrl);
        };
        img.src = String(reader.result);
      };
      reader.readAsDataURL(file);
    });
  }

  function bindLogoUploader(root, options = {}) {
    if (!root) return null;
    const input = root.querySelector('[data-logo-input]');
    const preview = root.querySelector('[data-logo-preview]');
    const hidden = root.querySelector('[data-logo-value]');
    const removeBtn = root.querySelector('[data-logo-remove]');
    const zone = root.querySelector('[data-logo-zone]');
    const fallback = options.fallback || defaultLogoUrl();

    function setPreview(src) {
      if (preview) {
        preview.src = src || fallback;
        preview.classList.toggle('is-empty', !src);
      }
      if (hidden) hidden.value = src || '';
      if (removeBtn) removeBtn.classList.toggle('hidden', !src);
    }

    async function handleFile(file) {
      try {
        const dataUrl = await readLogoFile(file);
        setPreview(dataUrl);
        if (typeof options.onChange === 'function') options.onChange(dataUrl);
        if (window.CSApp) CSApp.toast('Logo carregada. Salve para aplicar.', 'success');
      } catch (err) {
        if (window.CSApp) CSApp.toast(err.message || 'Falha no upload', 'error');
      }
    }

    zone?.addEventListener('click', () => input?.click());
    input?.addEventListener('change', () => {
      const file = input.files && input.files[0];
      if (file) handleFile(file);
      input.value = '';
    });
    removeBtn?.addEventListener('click', (e) => {
      e.preventDefault();
      setPreview('');
      if (typeof options.onChange === 'function') options.onChange(null);
    });

    ['dragenter', 'dragover'].forEach((ev) => {
      zone?.addEventListener(ev, (e) => {
        e.preventDefault();
        zone.classList.add('dragover');
      });
    });
    ['dragleave', 'drop'].forEach((ev) => {
      zone?.addEventListener(ev, (e) => {
        e.preventDefault();
        zone.classList.remove('dragover');
      });
    });
    zone?.addEventListener('drop', (e) => {
      const file = e.dataTransfer?.files?.[0];
      if (file) handleFile(file);
    });

    return {
      setValue(src) {
        setPreview(src || '');
      },
      getValue() {
        return (hidden?.value || '').trim() || null;
      }
    };
  }

  return {
    getTenantId,
    setTenantId,
    clearTenantId,
    hasTenant,
    getCurrentCompany,
    applyCompanyTheme,
    renderCompanyBrand,
    assetPath,
    defaultLogoUrl,
    readLogoFile,
    bindLogoUploader
  };
})();

window.CSCompanies = CSCompanies;
