/**

 * app.js – UI compartilhada: tema, toasts, modais, shell

 */



const CSApp = (() => {

  const THEME_KEY = 'canal_seguro_theme';



  function initTheme() {

    const saved = localStorage.getItem(THEME_KEY) || 'light';

    document.documentElement.setAttribute('data-theme', saved);

    return saved;

  }



  function toggleTheme() {

    const cur = document.documentElement.getAttribute('data-theme') || 'light';

    const next = cur === 'dark' ? 'light' : 'dark';

    document.documentElement.setAttribute('data-theme', next);

    localStorage.setItem(THEME_KEY, next);

    return next;

  }



  function toast(message, type = 'info', ms = 3500) {

    let box = document.querySelector('.toast-container');

    if (!box) {

      box = document.createElement('div');

      box.className = 'toast-container';

      document.body.appendChild(box);

    }

    const el = document.createElement('div');

    el.className = `toast toast--${type}`;

    el.innerHTML = `<span>${escapeHtml(message)}</span>`;

    box.appendChild(el);

    setTimeout(() => {

      el.style.opacity = '0';

      setTimeout(() => el.remove(), 250);

    }, ms);

  }



  function escapeHtml(str) {

    return String(str)

      .replace(/&/g, '&amp;')

      .replace(/</g, '&lt;')

      .replace(/>/g, '&gt;')

      .replace(/"/g, '&quot;');

  }

  /** HTML permitido para conteúdos educativos (CMS). */
  function sanitizeHtml(html) {
    const allowedTags = new Set([
      'P', 'H2', 'H3', 'UL', 'OL', 'LI', 'STRONG', 'EM', 'B', 'I', 'BR', 'DIV', 'A', 'SPAN'
    ]);
    const allowedAttrs = {
      A: new Set(['href', 'class', 'data-tenant-link', 'target', 'rel']),
      DIV: new Set(['class']),
      SPAN: new Set(['class']),
      P: new Set(['class']),
      UL: new Set(['class']),
      OL: new Set(['class']),
      LI: new Set(['class']),
      H2: new Set(['class']),
      H3: new Set(['class'])
    };
    const allowedClasses = new Set([
      'callout',
      'callout--warn',
      'btn',
      'btn-primary',
      'btn-outline',
      'btn-sm',
      'mt-2',
      'mt-1'
    ]);
    const template = document.createElement('template');
    template.innerHTML = String(html || '');

    function clean(node) {
      [...node.childNodes].forEach((child) => {
        if (child.nodeType === Node.TEXT_NODE) return;
        if (child.nodeType !== Node.ELEMENT_NODE) {
          child.remove();
          return;
        }
        const tag = child.tagName;
        if (!allowedTags.has(tag)) {
          const text = document.createTextNode(child.textContent || '');
          child.replaceWith(text);
          return;
        }
        [...child.attributes].forEach((attr) => {
          const name = attr.name.toLowerCase();
          const allow = allowedAttrs[tag];
          if (!allow || !allow.has(name)) {
            child.removeAttribute(attr.name);
            return;
          }
          if (name === 'href') {
            const href = String(attr.value || '').trim();
            if (/^(https?:|mailto:|#|\/|[a-z0-9_.-]+\.html)/i.test(href) && !/^\s*javascript:/i.test(href)) {
              child.setAttribute('href', href);
            } else {
              child.removeAttribute('href');
            }
          }
          if (name === 'class') {
            const safe = String(attr.value || '')
              .split(/\s+/)
              .filter((c) => allowedClasses.has(c))
              .join(' ');
            if (safe) child.setAttribute('class', safe);
            else child.removeAttribute('class');
          }
          if (name === 'target' && attr.value !== '_blank') child.removeAttribute('target');
          if (name === 'rel') child.setAttribute('rel', 'noopener noreferrer');
        });
        clean(child);
      });
    }

    clean(template.content);
    return template.innerHTML;
  }

  function slugify(str) {
    return String(str || '')
      .normalize('NFD')
      .replace(/[\u0300-\u036f]/g, '')
      .toLowerCase()
      .replace(/[^a-z0-9]+/g, '-')
      .replace(/^-+|-+$/g, '')
      .slice(0, 64);
  }



  function confirmDialog({ title, message, confirmText = 'Confirmar', cancelText = 'Cancelar', danger = false }) {

    return new Promise((resolve) => {

      const overlay = document.createElement('div');

      overlay.className = 'modal-overlay open';

      overlay.innerHTML = `

        <div class="modal" role="dialog" aria-modal="true">

          <div class="modal__header">

            <h3>${escapeHtml(title)}</h3>

            <button type="button" class="btn-icon" data-cancel aria-label="Fechar">✕</button>

          </div>

          <p>${escapeHtml(message)}</p>

          <div class="modal__actions">

            <button type="button" class="btn btn-outline" data-cancel>${escapeHtml(cancelText)}</button>

            <button type="button" class="btn ${danger ? 'btn-danger' : 'btn-primary'}" data-ok>${escapeHtml(confirmText)}</button>

          </div>

        </div>`;

      document.body.appendChild(overlay);

      const close = (val) => {

        overlay.classList.remove('open');

        setTimeout(() => overlay.remove(), 200);

        resolve(val);

      };

      overlay.querySelectorAll('[data-cancel]').forEach((b) => b.addEventListener('click', () => close(false)));

      overlay.querySelector('[data-ok]').addEventListener('click', () => close(true));

      overlay.addEventListener('click', (e) => {

        if (e.target === overlay) close(false);

      });

    });

  }

  function chooseCommercialChannel({
    title = 'Falar com especialista',
    message = 'Como prefere falar com o atendimento comercial?',
    planName = '',
    whatsappAvailable = true
  } = {}) {
    return new Promise((resolve) => {
      const overlay = document.createElement('div');
      overlay.className = 'modal-overlay open';
      const planHint = planName
        ? `<p class="text-muted" style="margin:.5rem 0 0;font-size:.9rem">Plano: <strong>${escapeHtml(planName)}</strong></p>`
        : '';
      const waBtn = whatsappAvailable
        ? `<button type="button" class="btn btn-primary" data-wa style="width:100%">WhatsApp comercial</button>`
        : `<button type="button" class="btn btn-primary" disabled style="width:100%" title="Número não cadastrado">WhatsApp indisponível</button>`;
      overlay.innerHTML = `
        <div class="modal" role="dialog" aria-modal="true" aria-labelledby="cs-commercial-title">
          <div class="modal__header">
            <h3 id="cs-commercial-title">${escapeHtml(title)}</h3>
            <button type="button" class="btn-icon" data-cancel aria-label="Fechar">✕</button>
          </div>
          <p>${escapeHtml(message)}</p>
          ${planHint}
          <div class="modal__actions" style="flex-direction:column;align-items:stretch;gap:.65rem">
            <button type="button" class="btn btn-outline" data-email style="width:100%">Enviar por e-mail</button>
            ${waBtn}
            <button type="button" class="btn btn-ghost" data-cancel style="width:100%">Cancelar</button>
          </div>
        </div>`;
      document.body.appendChild(overlay);
      const close = (val) => {
        overlay.classList.remove('open');
        setTimeout(() => overlay.remove(), 200);
        resolve(val);
      };
      overlay.querySelectorAll('[data-cancel]').forEach((b) => b.addEventListener('click', () => close(null)));
      overlay.querySelector('[data-email]')?.addEventListener('click', () => close('email'));
      overlay.querySelector('[data-wa]')?.addEventListener('click', () => close('whatsapp'));
      overlay.addEventListener('click', (e) => {
        if (e.target === overlay) close(null);
      });
    });
  }

  async function openCommercialContact({
    planId = '',
    planName = '',
    origin = 'landing-planos',
    originLabel = 'site Canal Seguro (seção Planos e preços)'
  } = {}) {
    let contact = {
      supportEmail: 'contato@fxfelipexavier.com.br',
      whatsappAvailable: false,
      commercialWhatsAppE164: null
    };
    try {
      if (typeof CSApi !== 'undefined' && CSApi.getPublicCommercialContact) {
        contact = (await CSApi.getPublicCommercialContact()) || contact;
      }
    } catch {
      /* keep defaults */
    }
    const channel = await chooseCommercialChannel({
      planName: planName || planId,
      whatsappAvailable: Boolean(contact.whatsappAvailable && contact.commercialWhatsAppE164)
    });
    if (!channel) return null;

    const message =
      typeof CSApi !== 'undefined' && CSApi.buildCommercialInterestMessage
        ? CSApi.buildCommercialInterestMessage({ planId, planName, originLabel })
        : `Olá! Cheguei pelo ${originLabel}. Gostaria de saber mais a respeito do plano de contratação para o painel de denúncias (plano "${planName || planId || 'disponível'}").`;

    if (channel === 'whatsapp') {
      const e164 = contact.commercialWhatsAppE164;
      if (!e164) {
        toast('WhatsApp comercial não configurado.', 'error');
        return null;
      }
      window.open(`https://wa.me/${e164}?text=${encodeURIComponent(message)}`, '_blank', 'noopener,noreferrer');
      return 'whatsapp';
    }

    const params = new URLSearchParams();
    if (planId) params.set('plano', planId);
    if (planName) params.set('planoNome', planName);
    params.set('origem', origin);
    params.set('canal', 'email');
    const base =
      location.pathname.includes('/admin/') || location.pathname.includes('/empresa/')
        ? '../fale-conosco.html'
        : 'fale-conosco.html';
    location.href = `${base}?${params.toString()}`;
    return 'email';
  }

  async function guardPageInit(fn, options = {}) {

    const fallback = options.fallback || CSErrors.DEFAULT_FALLBACK;

    try {

      return await fn();

    } catch (err) {

      CSErrors.logError(err, options.page || 'pageInit');

      if (options.showToast !== false) {

        toast(CSErrors.userMessage(err, fallback), 'error');

      }

      if (options.errorTarget) {

        CSErrors.renderLoadError(options.errorTarget, fallback, options.onRetry);

      }

      return null;

    }

  }



  function onReady(fn, options = {}) {

    document.addEventListener('DOMContentLoaded', async () => {

      if (typeof CSRuntime !== 'undefined') {

        await CSRuntime.probe();

        if (CSRuntime.useServer()) {

          document.querySelectorAll('.demo-banner').forEach((el) => {

            if (/simulad|localStorage|protótipo|sessão simulada/i.test(el.textContent || '')) {

              el.innerHTML =

                '<strong>Modo servidor (Fase 1)</strong> — autenticação, relatos e consulta pública validados na API.';

            }

          });

        }

      }

      guardPageInit(fn, options);

    });

  }



  function runAsync(fn, options = {}) {

    return CSErrors.runAsync(fn, options);

  }



  function bindThemeButtons() {

    document.querySelectorAll('[data-toggle-theme]').forEach((btn) => {

      btn.addEventListener('click', () => {

        const next = toggleTheme();

        toast(next === 'dark' ? 'Modo escuro ativado' : 'Modo claro ativado', 'info', 2000);

      });

    });

  }



  function bindMobileSidebar() {

    const sidebar = document.querySelector('.sidebar');

    const overlay = document.querySelector('.sidebar-overlay');

    const openBtn = document.querySelector('[data-open-sidebar]');

    const close = () => {

      sidebar?.classList.remove('open');

      overlay?.classList.remove('open');

    };

    openBtn?.addEventListener('click', () => {

      sidebar?.classList.add('open');

      overlay?.classList.add('open');

    });

    overlay?.addEventListener('click', close);

    document.querySelectorAll('[data-close-sidebar]').forEach((b) => b.addEventListener('click', close));

    sidebar?.querySelectorAll('a').forEach((a) => {
      a.addEventListener('click', () => {
        if (window.matchMedia('(max-width: 959px)').matches) close();
      });
    });

  }



  async function populateTopbar() {

    const session = CSAuth.getSession();

    if (!session) return;

    const nameEl = document.querySelector('[data-user-name]');

    const roleEl = document.querySelector('[data-user-role]');

    const avatarEl = document.querySelector('[data-user-avatar]');

    const companyEl = document.querySelector('[data-user-company]');

    if (nameEl) nameEl.textContent = session.nome;

    if (roleEl) roleEl.textContent = CSUsers.roleLabel(session.role);

    if (avatarEl) avatarEl.textContent = CSUsers.initials(session.nome);

    if (companyEl) {

      if (session.companyId) {

        const c = await CSApi.getCompany(session.companyId);

        companyEl.textContent = c ? c.nomeFantasia : '—';

      } else {

        companyEl.textContent = 'Administração';

      }

    }

  }



  async function populateNotifications() {

    const session = CSAuth.getSession();

    if (!session) return;

    const list = document.querySelector('[data-notif-list]');

    const btn = document.querySelector('[data-notif-btn]');

    const dropdown = document.querySelector('[data-notif-dropdown]');

    if (!list) return;



    const filters = session.role === 'superadmin' ? {} : { companyId: session.companyId };

    const items = await CSApi.getNotifications(filters);

    const unread = items.filter((n) => !n.read).length;

    if (btn && unread > 0) {

      let dot = btn.querySelector('.dot');

      if (!dot) {

        dot = document.createElement('span');

        dot.className = 'dot';

        btn.appendChild(dot);

      }

    }



    list.innerHTML = items.slice(0, 8)

      .map(

        (n) => `

      <div class="notif-item">

        <strong>${escapeHtml(n.title)}</strong>

        <div>${escapeHtml(n.message)}</div>

        <div class="notif-item__time">${CSReports.formatDateTime(n.createdAt)}</div>

      </div>`

      )

      .join('') || '<div class="notif-item">Nenhuma notificação.</div>';



    btn?.addEventListener('click', (e) => {

      e.stopPropagation();

      dropdown?.classList.toggle('open');

    });

    document.addEventListener('click', () => dropdown?.classList.remove('open'));

  }



  function bindLogout() {

    document.querySelectorAll('[data-logout]').forEach((btn) => {

      btn.addEventListener('click', async (e) => {

        e.preventDefault();

        const ok = await confirmDialog({

          title: 'Sair',

          message: 'Deseja encerrar a sessão?',

          confirmText: 'Sair'

        });

        if (ok) {

          CSAuth.logout();

          const login = location.pathname.includes('/admin/') || location.pathname.includes('/empresa/')

            ? '../login.html'

            : 'login.html';

          location.href = login;

        }

      });

    });

  }



  function qs(name) {

    return new URLSearchParams(location.search).get(name);

  }



  function tenantQuery() {

    const id = CSCompanies.getTenantId();
    if (!id) return '';

    return `empresa=${encodeURIComponent(id)}`;

  }



  function withTenant(href) {
    if (!href || href.startsWith('mailto:') || href.startsWith('tel:')) return href;

    const q = tenantQuery();
    if (!q) return href;

    const hashIdx = href.indexOf('#');
    const hash = hashIdx >= 0 ? href.slice(hashIdx) : '';
    const base = hashIdx >= 0 ? href.slice(0, hashIdx) : href;

    // Âncora pura (#secao) na mesma página — não precisa de query de tenant
    if (!base) return href;

    const sep = base.includes('?') ? '&' : '?';
    return `${base}${sep}${q}${hash}`;
  }



  function rewriteTenantLinks() {

    document.querySelectorAll('[data-tenant-link]').forEach((a) => {

      const href = a.getAttribute('href');

      if (href && !href.includes('empresa=')) {

        a.setAttribute('href', withTenant(href));

      }

    });

  }



  async function initPublic(options = {}) {

    initTheme();

    bindThemeButtons();

    bindPublicMobileNav();

    window.CSStore.loadStore();

    // Página inicial / portal multiempresa: sem empresa pré-selecionada
    if (options.platformHome) {
      const params = new URLSearchParams(location.search);
      if (!params.get('empresa') && !params.get('tenant')) {
        CSCompanies.clearTenantId();
      }
    }

    const company = await runAsync(() => CSCompanies.renderCompanyBrand(), {

      context: 'renderCompanyBrand',

      toast: false

    });

    rewriteTenantLinks();

    if (typeof CSInfraLog !== 'undefined') {
      CSInfraLog.access('acesso_rota', { outcome: 'success', context: { area: 'public' } });
    }

    return company || null;

  }

  function bindPublicMobileNav() {
    const nav = document.querySelector('.nav-public');
    const actions = document.querySelector('.header-actions');
    if (!nav || !actions || document.querySelector('[data-open-public-nav]')) return;

    const toggle = document.createElement('button');
    toggle.type = 'button';
    toggle.className = 'btn-icon public-nav-toggle';
    toggle.setAttribute('data-open-public-nav', '');
    toggle.setAttribute('aria-label', 'Abrir menu');
    toggle.setAttribute('aria-expanded', 'false');
    toggle.textContent = '☰';
    actions.insertBefore(toggle, actions.firstChild);

    const overlay = document.createElement('div');
    overlay.className = 'public-nav-overlay';
    overlay.setAttribute('data-close-public-nav', '');

    const drawer = document.createElement('nav');
    drawer.className = 'public-nav-drawer';
    drawer.setAttribute('aria-label', 'Menu móvel');
    drawer.innerHTML = `
      <div class="public-nav-drawer__head">
        <strong>Menu</strong>
        <button type="button" class="btn-icon" data-close-public-nav aria-label="Fechar menu">✕</button>
      </div>
      <div class="public-nav-drawer__links"></div>
      <div class="public-nav-drawer__cta"></div>
    `;

    const linksWrap = drawer.querySelector('.public-nav-drawer__links');
    nav.querySelectorAll('a').forEach((a) => {
      const clone = a.cloneNode(true);
      clone.removeAttribute('class');
      if (a.classList.contains('active')) clone.classList.add('active');
      linksWrap.appendChild(clone);
    });

    const cta = actions.querySelector('.btn-primary');
    if (cta) {
      const ctaClone = cta.cloneNode(true);
      ctaClone.classList.remove('btn-sm');
      drawer.querySelector('.public-nav-drawer__cta').appendChild(ctaClone);
    }

    document.body.appendChild(overlay);
    document.body.appendChild(drawer);

    const open = () => {
      drawer.classList.add('open');
      overlay.classList.add('open');
      toggle.setAttribute('aria-expanded', 'true');
      document.body.classList.add('public-nav-lock');
    };
    const close = () => {
      drawer.classList.remove('open');
      overlay.classList.remove('open');
      toggle.setAttribute('aria-expanded', 'false');
      document.body.classList.remove('public-nav-lock');
    };

    toggle.addEventListener('click', open);
    overlay.addEventListener('click', close);
    drawer.querySelectorAll('[data-close-public-nav]').forEach((el) => el.addEventListener('click', close));
    drawer.querySelectorAll('a').forEach((a) => a.addEventListener('click', close));
    window.addEventListener('keydown', (e) => {
      if (e.key === 'Escape') close();
    });
  }



  async function initAdminShell(allowedRoles) {

    initTheme();

    bindThemeButtons();

    if (typeof CSRuntime !== 'undefined' && !CSRuntime.isResolved()) {

      await CSRuntime.probe();

    }

    if (typeof CSRuntime !== 'undefined' && CSRuntime.useServer()) {

      await CSAuth.syncSessionFromServer();

    } else {

      window.CSStore.loadStore();

    }

    const loginUrl = location.pathname.includes('/admin/') || location.pathname.includes('/empresa/')

      ? '../login.html'

      : 'login.html';

    const session = CSAuth.requireAuth(allowedRoles, loginUrl);

    if (!session) return null;

    bindMobileSidebar();

    bindLogout();

    document.querySelectorAll('[data-roles]').forEach((el) => {
      const roles = String(el.dataset.roles || '')
        .split(/[\s,]+/)
        .filter(Boolean);
      if (roles.length && !roles.includes(session.role)) {
        el.hidden = true;
      }
    });

    await runAsync(() => populateTopbar(), { context: 'populateTopbar', toast: false });

    await runAsync(() => populateNotifications(), { context: 'populateNotifications', toast: false });

    if (session.companyId) {

      await runAsync(

        async () => {

          const company = await CSApi.getCompany(session.companyId);

          if (company) {

            CSCompanies.applyCompanyTheme(company);

            document.querySelectorAll('[data-company-logo]').forEach((el) => {

              el.src = company.logo || CSCompanies.defaultLogoUrl();

              el.alt = company.nomeFantasia || '';

            });

          }

        },

        { context: 'initAdminShell.company', toast: false }

      );

    }

    if (typeof CSInfraLog !== 'undefined') {
      CSInfraLog.access('acesso_rota', {
        outcome: 'success',
        actor: session,
        context: {
          area: location.pathname.includes('/admin/') ? 'admin' : 'empresa',
          roles: allowedRoles
        }
      });
    }

    return session;

  }



  const ROW_ACTION_ICONS = {
    delete:
      '<svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" aria-hidden="true"><path d="M3 6h18"/><path d="M8 6V4h8v2"/><path d="M19 6l-1 14H6L5 6"/><path d="M10 11v6M14 11v6"/></svg>',
    edit:
      '<svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" aria-hidden="true"><path d="M12 20h9"/><path d="M16.5 3.5a2.1 2.1 0 0 1 3 3L7 19l-4 1 1-4 12.5-12.5z"/></svg>',
    view:
      '<svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" aria-hidden="true"><path d="M1 12s4-7 11-7 11 7 11 7-4 7-11 7S1 12 1 12z"/><circle cx="12" cy="12" r="3"/></svg>'
  };

  function rowActionsHtml(id, opts = {}) {
    const safeId = escapeHtml(id);
    const canDelete = opts.canDelete !== false;
    const deleteBtn = canDelete
      ? '<button type="button" class="btn-row-action btn-row-action--danger" data-delete="' +
        safeId +
        '" title="Excluir" aria-label="Excluir">' +
        ROW_ACTION_ICONS.delete +
        '</button>'
      : '<button type="button" class="btn-row-action" disabled title="Exclusão protegida" aria-label="Exclusão protegida">' +
        ROW_ACTION_ICONS.delete +
        '</button>';
    return (
      '<div class="row-actions" role="group" aria-label="Ações">' +
      deleteBtn +
      '<button type="button" class="btn-row-action" data-edit="' +
      safeId +
      '" title="Editar" aria-label="Editar">' +
      ROW_ACTION_ICONS.edit +
      '</button>' +
      '<button type="button" class="btn-row-action" data-view="' +
      safeId +
      '" title="Visualizar" aria-label="Visualizar">' +
      ROW_ACTION_ICONS.view +
      '</button></div>'
    );
  }


  function rowViewActionHtml(href) {
    const safeHref = escapeHtml(String(href || '#'));
    return (
      '<a class="btn-row-action" href="' +
      safeHref +
      '" title="Visualizar" aria-label="Visualizar">' +
      ROW_ACTION_ICONS.view +
      '</a>'
    );
  }

  function setFormReadonly(form, readonly) {
    if (!form) return;
    Array.from(form.elements).forEach((el) => {
      if (!el || el.type === 'hidden') return;
      if (el.tagName === 'BUTTON') return;
      el.disabled = Boolean(readonly);
    });
  }


  return {

    initTheme,

    toggleTheme,

    toast,

    confirmDialog,

    chooseCommercialChannel,

    openCommercialContact,

    escapeHtml,

    sanitizeHtml,

    slugify,

    guardPageInit,

    onReady,

    runAsync,

    bindThemeButtons,

    bindMobileSidebar,

    bindPublicMobileNav,

    populateTopbar,

    populateNotifications,

    bindLogout,

    qs,

    tenantQuery,

    withTenant,

    rewriteTenantLinks,

    initPublic,

    initAdminShell,

    rowActionsHtml,

    rowViewActionHtml,

    setFormReadonly

  };

})();



window.CSApp = CSApp;



document.addEventListener('DOMContentLoaded', () => {

  CSApp.initTheme();

});


