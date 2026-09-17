/**

 * app.js – UI compartilhada: tema, toasts, modais, shell

 */



const CSApp = (() => {

  const THEME_KEY = 'canal_seguro_theme';
  const TABLE_FONT_KEY = 'canal_seguro_table_font';
  const TABLE_FONT_SIZES = ['sm', 'md', 'lg', 'xl'];

  function normalizeTableFontSize(value) {
    const v = String(value || '').trim().toLowerCase();
    return TABLE_FONT_SIZES.includes(v) ? v : null;
  }

  function applyTableFontSize(size) {
    const next = normalizeTableFontSize(size) || 'md';
    document.documentElement.setAttribute('data-table-font', next);
    try {
      localStorage.setItem(TABLE_FONT_KEY, next);
    } catch {
      /* ignore */
    }
    return next;
  }

  function initTableFontSize() {
    let saved = null;
    try {
      saved = localStorage.getItem(TABLE_FONT_KEY);
    } catch {
      saved = null;
    }
    return applyTableFontSize(saved || 'md');
  }

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

  function selectDialog({
    title,
    message = '',
    options = [],
    confirmText = 'Confirmar',
    cancelText = 'Cancelar',
    emptyText = 'Nenhuma opção disponível.'
  }) {
    return new Promise((resolve) => {
      const overlay = document.createElement('div');
      overlay.className = 'modal-overlay open';
      const optsHtml = (options || [])
        .map(
          (o) =>
            `<option value="${escapeHtml(o.value)}">${escapeHtml(o.label)}</option>`
        )
        .join('');
      overlay.innerHTML = `
        <div class="modal" role="dialog" aria-modal="true">
          <div class="modal__header">
            <h3>${escapeHtml(title)}</h3>
            <button type="button" class="btn-icon" data-cancel aria-label="Fechar">✕</button>
          </div>
          ${message ? `<p>${escapeHtml(message)}</p>` : ''}
          <div class="form-group" style="margin:0 0 1rem">
            <select class="form-control" data-select ${options.length ? '' : 'disabled'}>
              <option value="">${escapeHtml(options.length ? 'Selecionar…' : emptyText)}</option>
              ${optsHtml}
            </select>
          </div>
          <div class="modal__actions">
            <button type="button" class="btn btn-outline" data-cancel>${escapeHtml(cancelText)}</button>
            <button type="button" class="btn btn-primary" data-ok ${options.length ? '' : 'disabled'}>${escapeHtml(confirmText)}</button>
          </div>
        </div>`;
      document.body.appendChild(overlay);
      const close = (val) => {
        overlay.classList.remove('open');
        setTimeout(() => overlay.remove(), 200);
        resolve(val);
      };
      overlay.querySelectorAll('[data-cancel]').forEach((b) => b.addEventListener('click', () => close(null)));
      overlay.querySelector('[data-ok]').addEventListener('click', () => {
        const v = overlay.querySelector('[data-select]')?.value || '';
        if (!v) return;
        close(v);
      });
      overlay.addEventListener('click', (e) => {
        if (e.target === overlay) close(null);
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
        ? '../index.html'
        : 'index.html';
    location.href = `${base}?${params.toString()}#fale-conosco`;
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

        if (CSRuntime.requireServer() && !CSRuntime.useServer()) {

          showServerRequiredBanner(CSRuntime.getLastProbeError());

          if (options.allowOfflinePrototype) {

            /* continua só se a página pedir explicitamente */

          } else {

            return;

          }

        }

      }

      guardPageInit(fn, options);

    });

  }

  function showServerRequiredBanner(detail) {

    if (document.getElementById('cs-server-required')) return;

    const el = document.createElement('div');

    el.id = 'cs-server-required';

    el.setAttribute('role', 'alert');

    el.style.cssText =

      'position:fixed;inset:0;z-index:99999;display:flex;align-items:center;justify-content:center;' +

      'background:rgba(15,23,42,.92);color:#f8fafc;padding:1.5rem;font-family:system-ui,sans-serif;text-align:center';

    const msg = detail ? ` (${String(detail).slice(0, 160)})` : '';

    el.innerHTML =

      '<div style="max-width:28rem">' +

      '<strong style="font-size:1.15rem;display:block;margin-bottom:.75rem">Servidor indisponível</strong>' +

      '<p style="margin:0 0 1rem;line-height:1.45;opacity:.9">O Canal Seguro em produção exige a API Node. ' +

      'O modo localStorage foi desativado neste ambiente' +

      msg +

      '.</p>' +

      '<p style="margin:0;font-size:.85rem;opacity:.75">Verifique o app Node na Hostinger e ' +

      '<code style="opacity:1">/api/v1/health</code>.</p>' +

      '</div>';

    document.body.appendChild(el);

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
        persistSidebarNavScroll();
        if (window.matchMedia('(max-width: 959px)').matches) close();
      });
    });

  }

  const SIDEBAR_NAV_SCROLL_KEY = 'cs-sidebar-nav-scroll';

  function persistSidebarNavScroll() {
    const nav = document.querySelector('.sidebar__nav');
    if (!nav) return;
    try {
      sessionStorage.setItem(SIDEBAR_NAV_SCROLL_KEY, String(nav.scrollTop || 0));
    } catch {
      /* ignore quota / private mode */
    }
  }

  function restoreSidebarNavScroll() {
    const nav = document.querySelector('.sidebar__nav');
    if (!nav) return;

    let y = NaN;
    try {
      y = Number(sessionStorage.getItem(SIDEBAR_NAV_SCROLL_KEY));
    } catch {
      y = NaN;
    }

    const apply = () => {
      if (Number.isFinite(y) && y >= 0) {
        nav.scrollTop = y;
      }
      const active = nav.querySelector('a.active:not([hidden])');
      if (!active) return;
      const navRect = nav.getBoundingClientRect();
      const aRect = active.getBoundingClientRect();
      if (aRect.top < navRect.top || aRect.bottom > navRect.bottom) {
        active.scrollIntoView({ block: 'nearest', inline: 'nearest' });
      }
    };

    apply();
    requestAnimationFrame(apply);

    nav.addEventListener('scroll', persistSidebarNavScroll, { passive: true });
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



  function setTopbarBadge(btn, count) {
    if (!btn) return;
    let badge = btn.querySelector('[data-topbar-badge]');
    const n = Number(count) || 0;
    if (n <= 0) {
      if (badge) badge.remove();
      btn.querySelectorAll('.dot').forEach((el) => el.remove());
      return;
    }
    if (!badge) {
      badge = document.createElement('span');
      badge.className = 'topbar-badge';
      badge.setAttribute('data-topbar-badge', '1');
      btn.appendChild(badge);
    }
    badge.textContent = n > 99 ? '99+' : String(n);
    btn.querySelectorAll('.dot').forEach((el) => el.remove());
  }

  function isSupportNotification(n) {
    return (
      n &&
      (n.type === 'platform_support_message' ||
        n.type === 'platform_support_reply' ||
        n.type === 'platform_internal_support' ||
        n.type === 'platform_internal_support_reply')
    );
  }

  /** Tipos de ocorrência de relato (exclui suporte/armazenamento). */
  function isCompanyReportNotification(n) {
    if (!n || isSupportNotification(n)) return false;
    const type = String(n.type || '');
    if (type === 'platform_storage_alert') return false;
    if (
      type.startsWith('report_') ||
      type === 'sla_alert' ||
      type === 'risk_critical'
    ) {
      return true;
    }
    if (!type) {
      const text = `${n.title || ''} ${n.message || ''}`.toLowerCase();
      return /(relato|protocolo|encaminhad|den[uú]ncia|ocorr[eê]ncia)/i.test(text);
    }
    return false;
  }

  /**
   * Adm_Empresa: todas as notificações da empresa (escopo companyId, sem destinatário individual).
   * Apurador: apenas encaminhamentos destinados a ele (userId/assigneeId).
   */
  function canSeeBellNotification(n, session) {
    if (!n || !session || !isCompanyReportNotification(n)) return false;
    if (session.role === 'admin_empresa') {
      if (!session.companyId || n.companyId !== session.companyId) return false;
      // Notificações pessoais do apurador não entram no sino do admin
      if (n.userId || n.assigneeId) return false;
      return true;
    }
    if (session.role === 'apurador') {
      if (String(n.type || '') !== 'report_assigned') return false;
      const target = n.userId || n.assigneeId;
      return target === session.id;
    }
    return false;
  }

  function ensurePlatformSupportTopbar() {
    const right = document.querySelector('.topbar__right');
    if (!right || right.querySelector('[data-support-inbox-btn]')) return;

    const themeBtn = right.querySelector('[data-toggle-theme]');
    const wrap = document.createElement('div');
    wrap.className = 'topbar-inbox';
    wrap.innerHTML = `
      <button type="button" class="btn-icon topbar-icon-btn" data-support-inbox-btn aria-expanded="false" aria-controls="csSupportInboxDropdown" title="Suporte empresas">
        <span aria-hidden="true">💬</span>
      </button>
      <div class="notif-dropdown support-inbox-dropdown" id="csSupportInboxDropdown" data-support-inbox-dropdown>
        <div class="notif-dropdown__header">Suporte empresas</div>
        <div data-support-inbox-list></div>
        <a class="notif-dropdown__footer" href="suporte.html">Abrir inbox de suporte</a>
      </div>
    `;
    if (themeBtn) right.insertBefore(wrap, themeBtn);
    else right.appendChild(wrap);
    wrap.addEventListener('click', (e) => e.stopPropagation());
  }

  async function markNotificationReadLocal(id) {
    try {
      if (typeof CSApi === 'undefined' || typeof CSApi.markNotificationRead !== 'function') return;
      await CSApi.markNotificationRead(id);
    } catch (_) {
      /* ignore */
    }
  }

  async function markNotificationsReadLocal(ids) {
    try {
      if (typeof CSApi === 'undefined') return;
      if (typeof CSApi.markNotificationsRead === 'function') {
        await CSApi.markNotificationsRead(ids);
        return;
      }
      if (typeof CSApi.markNotificationRead === 'function') {
        for (const id of ids || []) {
          if (id) await CSApi.markNotificationRead(id);
        }
      }
    } catch (_) {
      /* ignore */
    }
  }

  async function populateNotifications() {
    const session = CSAuth.getSession();
    if (!session) return;

    const list = document.querySelector('[data-notif-list]');
    const btn = document.querySelector('[data-notif-btn]');
    const dropdown = document.querySelector('[data-notif-dropdown]');
    if (!list) return;

    const isPlatform = session.role === 'superadmin' && location.pathname.includes('/admin/');
    if (isPlatform) ensurePlatformSupportTopbar();

    const filters = session.role === 'superadmin' ? {} : { companyId: session.companyId };
    let items = [];
    try {
      items = (await CSApi.getNotifications(filters)) || [];
    } catch (_) {
      items = [];
    }

    const supportItems = items.filter((n) => {
      if (!isSupportNotification(n) || n.role !== 'superadmin') return false;
      if (n.userId && session.id) return n.userId === session.id;
      return true;
    });
    const reportItems = items.filter((n) => canSeeBellNotification(n, session));
    const unreadReportItems = reportItems.filter((n) => !n.read);
    const reportUnread = unreadReportItems.length;
    setTopbarBadge(btn, reportUnread);

    const header = dropdown?.querySelector('.notif-dropdown__header');
    if (header) {
      header.textContent =
        session.role === 'apurador' ? 'Encaminhamentos' : 'Ocorrências da empresa';
    }

    const relatosHref =
      location.pathname.includes('/admin/') || location.pathname.includes('/empresa/')
        ? 'relatos.html'
        : '#';

    list.innerHTML =
      unreadReportItems
        .slice(0, 8)
        .map((n) => {
          const hash = n.reportId ? `#relato-${encodeURIComponent(n.reportId)}` : '';
          const href = `${relatosHref}${hash}`;
          return `
      <div class="notif-item" data-notif-row="${escapeHtml(n.id || '')}">
        <a class="notif-item__body" href="${escapeHtml(href)}" data-notif-id="${escapeHtml(n.id || '')}">
          <strong>${escapeHtml(n.title || 'Ocorrência')}</strong>
          <div>${escapeHtml(n.message || '')}</div>
          <div class="notif-item__time">${CSReports.formatDateTime(n.createdAt)}</div>
        </a>
        <button type="button" class="notif-item__mark" data-mark-one="${escapeHtml(n.id || '')}" title="Marcar como lida">
          Marcar como lida
        </button>
      </div>`;
        })
        .join('') ||
      `<div class="notif-item">${
        session.role === 'apurador'
          ? 'Nenhum encaminhamento pendente.'
          : 'Nenhuma ocorrência pendente.'
      }</div>`;

    let footer = dropdown?.querySelector('[data-notif-footer]');
    if (dropdown && !footer) {
      footer = document.createElement('button');
      footer.type = 'button';
      footer.className = 'notif-dropdown__footer';
      footer.setAttribute('data-notif-footer', '1');
      dropdown.appendChild(footer);
      footer.addEventListener('click', async (e) => {
        e.preventDefault();
        e.stopPropagation();
        const ids = String(footer.dataset.unreadIds || '')
          .split(',')
          .map((s) => s.trim())
          .filter(Boolean);
        await markNotificationsReadLocal(ids);
        await populateNotifications();
      });
    }
    if (footer) {
      footer.hidden = reportUnread === 0;
      footer.textContent = 'Marcar todas como lidas';
      footer.dataset.unreadIds = unreadReportItems.map((n) => n.id).filter(Boolean).join(',');
    }

    list.querySelectorAll('[data-notif-id]').forEach((el) => {
      el.addEventListener('click', () => {
        const id = el.getAttribute('data-notif-id');
        if (id) markNotificationReadLocal(id);
      });
    });

    list.querySelectorAll('[data-mark-one]').forEach((el) => {
      el.addEventListener('click', async (e) => {
        e.preventDefault();
        e.stopPropagation();
        const id = el.getAttribute('data-mark-one');
        if (!id) return;
        await markNotificationReadLocal(id);
        await populateNotifications();
      });
    });

    if (btn) {
      const bellLabel =
        session.role === 'apurador'
          ? 'Relatos encaminhados a você'
          : 'Notificações da empresa';
      btn.setAttribute('title', bellLabel);
      btn.setAttribute('aria-label', bellLabel);
      if (!btn.dataset.notifBound) {
        btn.dataset.notifBound = '1';
        btn.addEventListener('click', (e) => {
          e.stopPropagation();
          dropdown?.classList.toggle('open');
          document.querySelector('[data-support-inbox-dropdown]')?.classList.remove('open');
          document.querySelector('[data-support-inbox-btn]')?.setAttribute('aria-expanded', 'false');
        });
      }
    }

    if (isPlatform) {
      await populateSupportInbox(session, supportItems);
    }

    if (!document.body.dataset.topbarNotifDocBound) {
      document.body.dataset.topbarNotifDocBound = '1';
      document.addEventListener('click', () => {
        dropdown?.classList.remove('open');
        document.querySelector('[data-support-inbox-dropdown]')?.classList.remove('open');
        document.querySelector('[data-support-inbox-btn]')?.setAttribute('aria-expanded', 'false');
      });
    }
  }

  async function populateSupportInbox(session, supportNotifs = []) {
    const btn = document.querySelector('[data-support-inbox-btn]');
    const dropdown = document.querySelector('[data-support-inbox-dropdown]');
    const list = document.querySelector('[data-support-inbox-list]');
    if (!btn || !list) return;

    let threads = [];
    try {
      const data = await CSApi.listPlatformSupport({}, session);
      threads = data?.threads || [];
    } catch (_) {
      threads = [];
    }

    const awaiting = threads.filter((t) => t.status === 'aberto');
    const unreadNotifs = (supportNotifs || []).filter((n) => !n.read);
    const badgeCount = Math.max(awaiting.length, unreadNotifs.length);
    setTopbarBadge(btn, badgeCount);

    const byThread = new Map();
    unreadNotifs.forEach((n) => {
      if (n.threadId) byThread.set(n.threadId, n);
    });
    awaiting.forEach((t) => {
      if (!byThread.has(t.id)) {
        byThread.set(t.id, {
          id: `thread-${t.id}`,
          threadId: t.id,
          title: t.companyName || 'Empresa',
          message: t.subject || 'Mensagem de suporte',
          createdAt: t.updatedAt || t.createdAt,
          read: false
        });
      } else {
        const n = byThread.get(t.id);
        n.title = t.companyName || n.title;
        n.message = t.subject || n.message;
      }
    });

    const rows = [...byThread.values()].slice(0, 8);
    list.innerHTML =
      rows
        .map((n) => {
          const href = `suporte.html?thread=${encodeURIComponent(n.threadId || '')}`;
          return `
      <a class="notif-item" href="${escapeHtml(href)}" data-support-notif-id="${escapeHtml(n.id || '')}" data-thread-id="${escapeHtml(n.threadId || '')}">
        <strong>${escapeHtml(n.title || 'Suporte')}</strong>
        <div>${escapeHtml(n.message || '')}</div>
        <div class="notif-item__time">${n.createdAt ? CSReports.formatDateTime(n.createdAt) : ''}</div>
      </a>`;
        })
        .join('') || '<div class="notif-item">Nenhuma mensagem de suporte.</div>';

    list.querySelectorAll('[data-support-notif-id]').forEach((el) => {
      el.addEventListener('click', () => {
        const id = el.getAttribute('data-support-notif-id');
        if (id && !String(id).startsWith('thread-')) markNotificationReadLocal(id);
      });
    });

    if (!btn.dataset.supportBound) {
      btn.dataset.supportBound = '1';
      btn.addEventListener('click', (e) => {
        e.stopPropagation();
        const open = !dropdown.classList.contains('open');
        dropdown.classList.toggle('open', open);
        btn.setAttribute('aria-expanded', open ? 'true' : 'false');
        document.querySelector('[data-notif-dropdown]')?.classList.remove('open');
      });
    }
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

    if (options.assistant !== false) {
      initPublicAssistantWidget();
    }

    return company || null;

  }

  /** Enquanto o FAQ do bot não estiver pronto, exibe aviso de manutenção. */
  const ASSISTANT_BOT_MAINTENANCE = true;

  function initPublicAssistantWidget() {
    if (!document.body.classList.contains('landing-home') && !document.body.classList.contains('public-page')) return;
    if (document.querySelector('.cs-support-fab-root')) return;
    if (typeof CSApi === 'undefined' || typeof CSApi.askPublicSupportFaq !== 'function') return;

    const assetSrc = 'assets/images/support-assistant-fab.png';
    const SUGGESTIONS = [
      'Como faço uma denúncia?',
      'O que é assédio moral?',
      'Minha denúncia é confidencial?',
      'Como acompanhar uma denúncia?'
    ];
    const WELCOME_1 = 'Olá! 👋 Sou o Assistente Virtual do Canal Seguro. Tudo bem?';
    const WELCOME_2 =
      'Se você tem alguma dúvida sobre o canal, precisa de orientação ou quer entender como fazer uma denúncia, estou aqui para ajudar.\n\nFique à vontade para perguntar. Como posso ajudar você?';
    const MAINTENANCE_MSG =
      '**Assistente Virtual em manutenção**\n\nEstamos finalizando este recurso. Por enquanto, ele não está disponível para perguntas.\n\nSe precisar de ajuda, use Fale conosco na página inicial ou registre sua denúncia pelo formulário oficial.';
    const QUERY_MAX = 240;
    const FAQ_CHIP_MAX = 4;

    const root = document.createElement('div');
    root.className = 'cs-support-fab-root cs-support-fab-root--public';
    root.innerHTML = `
      <div class="cs-support-panel" id="csPublicAssistPanel" role="dialog" aria-label="Assistente Virtual" aria-modal="true" hidden>
        <div class="cs-support-panel__header">
          <div class="cs-support-panel__brand">
            <img class="cs-support-panel__avatar" src="${assetSrc}" alt="" width="40" height="40" decoding="async" />
            <div>
              <h2 id="csPublicAssistTitle">Assistente Virtual</h2>
              <p>${ASSISTANT_BOT_MAINTENANCE ? 'Temporariamente em manutenção' : 'Orientação sobre o uso do Canal Seguro'}</p>
            </div>
          </div>
          <div class="cs-support-panel__actions">
            <button type="button" class="cs-support-panel__icon-btn" data-public-assist-close aria-label="Fechar assistente" title="Fechar">×</button>
          </div>
        </div>
        <div class="cs-support-panel__body">
          <div class="cs-support-chat" data-public-bot-chat aria-live="polite" aria-relevant="additions"></div>
          <div class="cs-assist-composer">
            <p class="cs-assist-privacy">${
              ASSISTANT_BOT_MAINTENANCE
                ? 'O assistente automático está em manutenção. Use as opções abaixo para obter ajuda.'
                : 'Evite compartilhar senhas ou informações pessoais desnecessárias. Para registrar uma denúncia, utilize o formulário oficial do canal.'
            }</p>
            ${
              ASSISTANT_BOT_MAINTENANCE
                ? `<div class="cs-assist-actions">
                    <div class="cs-assist-actions__secondary">
                      <a class="btn btn-primary btn-block" href="index.html#fale-conosco" data-tenant-link>Fale conosco</a>
                      <a class="btn btn-outline btn-block" href="relato.html" data-tenant-link>Fazer uma denúncia</a>
                    </div>
                  </div>`
                : `<form class="cs-support-form cs-assist-form" data-public-bot-form>
              <div class="form-group">
                <label for="csPublicBotQuery">Sua dúvida</label>
                <textarea id="csPublicBotQuery" class="form-control" required maxlength="${QUERY_MAX}" rows="3" placeholder="Digite sua dúvida ou descreva o que você precisa saber..." aria-describedby="csPublicBotHint"></textarea>
                <span class="cs-assist-charhint" id="csPublicBotHint"><span data-char-count>0</span>/${QUERY_MAX}</span>
              </div>
              <div class="cs-assist-actions">
                <button type="submit" class="btn btn-primary btn-block cs-assist-ask">Perguntar</button>
                <div class="cs-assist-actions__secondary">
                  <a class="btn btn-outline btn-block" href="index.html#fale-conosco" data-tenant-link>Fale conosco</a>
                  <a class="btn btn-outline btn-block" href="relato.html" data-tenant-link>Fazer uma denúncia</a>
                </div>
              </div>
            </form>`
            }
          </div>
        </div>
      </div>
      <button type="button" class="cs-support-fab" data-public-assist-toggle aria-expanded="false" aria-controls="csPublicAssistPanel" title="Assistente Virtual" aria-label="Abrir Assistente Virtual">
        <img class="cs-support-fab__img" src="${assetSrc}" alt="" width="56" height="56" decoding="async" />
      </button>
    `;
    document.body.appendChild(root);

    const panel = root.querySelector('#csPublicAssistPanel');
    const toggle = root.querySelector('[data-public-assist-toggle]');
    const closeBtn = root.querySelector('[data-public-assist-close]');
    const chat = root.querySelector('[data-public-bot-chat]');
    const form = root.querySelector('[data-public-bot-form]');
    const field = form?.querySelector('#csPublicBotQuery');
    const charCount = form?.querySelector('[data-char-count]');
    const history = [];
    let welcomeTimer = null;
    let welcomeStarted = false;
    let asking = false;
    let showSuggest = false;

    function formatAssistHtml(text) {
      const raw = String(text || '').trim();
      if (!raw) return '';
      const lines = raw.split(/\n/);
      const blocks = [];
      let listItems = [];
      let para = [];

      const flushPara = () => {
        if (!para.length) return;
        const body = para.join(' ').trim();
        if (body) blocks.push(`<p>${escapeHtml(body)}</p>`);
        para = [];
      };
      const flushList = () => {
        if (!listItems.length) return;
        blocks.push(`<ol>${listItems.map((item) => `<li>${escapeHtml(item)}</li>`).join('')}</ol>`);
        listItems = [];
      };

      lines.forEach((line) => {
        const trimmed = line.trim();
        if (!trimmed) {
          flushList();
          flushPara();
          return;
        }
        const numbered = trimmed.match(/^(\d+)[.)]\s+(.+)$/);
        if (numbered) {
          flushPara();
          listItems.push(numbered[2]);
          return;
        }
        flushList();
        if (/^\*\*(.+)\*\*$/.test(trimmed)) {
          flushPara();
          blocks.push(`<p class="cs-assist-bubble__title"><strong>${escapeHtml(trimmed.replace(/^\*\*(.+)\*\*$/, '$1'))}</strong></p>`);
          return;
        }
        para.push(trimmed);
      });
      flushList();
      flushPara();
      return blocks.join('') || `<p>${escapeHtml(raw)}</p>`;
    }

    function updateCharCount() {
      if (charCount && field) charCount.textContent = String((field.value || '').length);
    }

    function suggestionsHtml() {
      if (ASSISTANT_BOT_MAINTENANCE || !showSuggest) return '';
      return faqRelatedChipsHtml(
        SUGGESTIONS.map((question) => ({ question })),
        'data-suggest',
        'Sugestões'
      );
    }

    function faqRelatedChipsHtml(suggestions, attr, label = 'Perguntas relacionadas') {
      if (!suggestions?.length) return '';
      return `
        <div class="cs-assist-suggestions cs-assist-suggestions--inline" role="group" aria-label="${escapeHtml(label)}">
          <p class="cs-assist-suggestions__label">${escapeHtml(label)}</p>
          <div class="cs-assist-suggestions__list">
            ${suggestions
              .map(
                (s) =>
                  `<button type="button" class="cs-assist-chip" ${attr}="${escapeHtml(s.question)}">${escapeHtml(s.question)}</button>`
              )
              .join('')}
          </div>
        </div>`;
    }

    function renderChat() {
      const hasUser = history.some((m) => m.side === 'user');
      showSuggest = !hasUser && welcomeStarted && history.length >= 2;
      chat.innerHTML =
        history
          .map((m) => {
            const cls = m.side === 'user' ? 'company' : 'platform';
            const who = m.side === 'user' ? 'Você' : 'Assistente Virtual';
            const body =
              m.side === 'user' ? escapeHtml(m.text) : formatAssistHtml(m.text);
            const chips =
              m.side === 'bot' && m.suggestions?.length
                ? faqRelatedChipsHtml(m.suggestions, 'data-suggest')
                : '';
            return `<div class="cs-support-bubble cs-support-bubble--${cls}">${body}<small>${escapeHtml(who)}</small></div>${chips}`;
          })
          .join('') + suggestionsHtml();
      chat.scrollTop = chat.scrollHeight;
    }

    function startWelcomeSequence() {
      if (welcomeStarted || history.length) {
        renderChat();
        return;
      }
      welcomeStarted = true;
      if (ASSISTANT_BOT_MAINTENANCE) {
        history.push({ side: 'bot', text: MAINTENANCE_MSG });
        renderChat();
        return;
      }
      history.push({ side: 'bot', text: WELCOME_1 });
      renderChat();
      if (welcomeTimer) window.clearTimeout(welcomeTimer);
      welcomeTimer = window.setTimeout(() => {
        if (history.some((m) => m.side === 'user')) return;
        history.push({ side: 'bot', text: WELCOME_2 });
        renderChat();
      }, 650);
    }

    async function askQuestion(query) {
      if (ASSISTANT_BOT_MAINTENANCE) return;
      const q = String(query || '').trim();
      if (!q || asking) return;
      asking = true;
      if (welcomeTimer) {
        window.clearTimeout(welcomeTimer);
        welcomeTimer = null;
      }
      if (!history.some((m) => m.text === WELCOME_1)) {
        history.push({ side: 'bot', text: WELCOME_1 });
        history.push({ side: 'bot', text: WELCOME_2 });
      } else if (!history.some((m) => m.text === WELCOME_2)) {
        history.push({ side: 'bot', text: WELCOME_2 });
      }
      history.push({ side: 'user', text: q.slice(0, QUERY_MAX) });
      field.value = '';
      updateCharCount();
      showSuggest = false;
      renderChat();

      const result = await runAsync(() => CSApi.askPublicSupportFaq(q), {
        context: 'askPublicSupportFaq',
        toast: false
      });

      if (!result) {
        history.push({
          side: 'bot',
          text: 'Não foi possível responder agora. Tente novamente ou use Fale conosco.'
        });
      } else if (result.confidential && result.answer) {
        history.push({ side: 'bot', text: result.answer });
      } else if (result.matched && (result.answer || result.faq?.answer)) {
        const answer = result.answer || result.faq.answer;
        const title = result.faq?.question ? `**${result.faq.question}**\n\n` : '';
        const related = (result.suggestions || []).slice(0, FAQ_CHIP_MAX);
        history.push({
          side: 'bot',
          text: `${title}${answer}`,
          suggestions: related.length ? related : null
        });
      } else if (result.partialMatch && result.suggestions?.length) {
        history.push({
          side: 'bot',
          text:
            'Encontrei perguntas relacionadas ao que você digitou. Escolha uma opção abaixo ou reformule sua dúvida.' +
            (result.escalateHint ? `\n\n${result.escalateHint}` : ''),
          suggestions: result.suggestions.slice(0, FAQ_CHIP_MAX)
        });
      } else {
        const related = (result.suggestions || []).slice(0, FAQ_CHIP_MAX);
        history.push({
          side: 'bot',
          text:
            'Não encontrei uma resposta específica para isso neste assistente. Posso ajudar com orientações gerais sobre o canal e o registro de denúncias.' +
            (result.escalateHint ? `\n\n${result.escalateHint}` : ''),
          suggestions: related.length ? related : null
        });
      }
      renderChat();
      asking = false;
      field.focus();
    }

    function setOpen(open) {
      panel.hidden = !open;
      panel.classList.toggle('is-open', open);
      toggle.setAttribute('aria-expanded', open ? 'true' : 'false');
      if (open) {
        startWelcomeSequence();
        field.focus();
      }
    }

    toggle.addEventListener('click', () => setOpen(panel.hidden));
    closeBtn.addEventListener('click', () => setOpen(false));
    if (field) {
      field.addEventListener('input', updateCharCount);
      updateCharCount();
    }

    if (chat) {
      chat.addEventListener('click', (e) => {
        if (ASSISTANT_BOT_MAINTENANCE) return;
        const btn = e.target.closest('[data-suggest]');
        if (!btn || !chat.contains(btn)) return;
        askQuestion(btn.getAttribute('data-suggest') || '');
      });
    }

    if (form) {
      form.addEventListener('submit', (e) => {
        e.preventDefault();
        askQuestion(field?.value);
      });
    }

    rewriteTenantLinks();
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



  function applyPanelSkin(session) {
    const body = document.body;
    if (!body) return;
    const path = location.pathname || '';
    body.classList.remove('panel-platform', 'panel-empresa', 'panel-apurador', 'panel-canal');
    if (path.includes('/admin/')) {
      body.classList.add('panel-platform', 'panel-canal');
      return;
    }
    if (path.includes('/empresa/')) {
      const role = session && session.role;
      if (role === 'apurador') {
        body.classList.add('panel-apurador', 'panel-canal');
      } else {
        body.classList.add('panel-empresa', 'panel-canal');
      }
    }
  }

  async function initAdminShell(allowedRoles) {

    initTheme();
    initTableFontSize();

    applyPanelSkin();

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

    applyPanelSkin(session);

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

    /* Apurador: oculta apenas o item Acessos (display:flex na sidebar anula [hidden]) */
    if (session.role === 'apurador') {
      document.querySelectorAll('.sidebar__nav a[href="acessos.html"]').forEach((a) => {
        a.hidden = true;
        a.style.display = 'none';
      });
    }

    /* Oculta títulos de seção sem links visíveis (ex.: menu do Apurador) */
    document.querySelectorAll('.sidebar__nav').forEach((nav) => {
      nav.querySelectorAll('.nav-section').forEach((section) => {
        let sibling = section.nextElementSibling;
        let hasVisibleLink = false;
        while (sibling && !sibling.classList.contains('nav-section')) {
          if (sibling.matches('a') && !sibling.hidden) {
            hasVisibleLink = true;
            break;
          }
          sibling = sibling.nextElementSibling;
        }
        section.hidden = !hasVisibleLink;
      });
    });

    const tagline = document.querySelector('[data-panel-tagline]');
    if (tagline && session.role === 'apurador') {
      tagline.textContent = 'Painel do Apurador';
    }

    restoreSidebarNavScroll();

    await runAsync(() => populateTopbar(), { context: 'populateTopbar', toast: false });

    await runAsync(() => populateNotifications(), { context: 'populateNotifications', toast: false });

    if (session.companyId) {

      await runAsync(

        async () => {

          const company = await CSApi.getCompany(session.companyId);

          if (company) {

            CSCompanies.applyCompanyTheme(company);

            document.querySelectorAll('[data-company-logo]').forEach((el) => {

              const defaultLogo = el.getAttribute('data-default-logo');

              el.src = company.logo || defaultLogo || CSCompanies.defaultLogoUrl();

              el.alt = company.nomeFantasia || '';

            });

          }

        },

        { context: 'initAdminShell.company', toast: false }

      );

    }

    await runAsync(
      async () => {
        if (typeof CSApi === 'undefined' || !CSApi.getUiDefaults) return;
        const ui = await CSApi.getUiDefaults();
        if (ui?.tableFontSize) applyTableFontSize(ui.tableFontSize);
      },
      { context: 'initAdminShell.uiDefaults', toast: false }
    );

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

    initSupportWidget(session);

    return session;

  }

  function initSupportWidget(session) {
    if (!session) return;
    const path = location.pathname || '';
    const isEmpresaPanel =
      ['admin_empresa', 'apurador'].includes(session.role) && path.includes('/empresa/');
    const isPlatformPanel = session.role === 'superadmin' && path.includes('/admin/');
    if (!isEmpresaPanel && !isPlatformPanel) return;
    if (document.querySelector('.cs-support-fab-root')) return;
    if (typeof CSApi === 'undefined') return;
    if (isEmpresaPanel && typeof CSApi.createPlatformSupport !== 'function') return;
    if (isPlatformPanel && typeof CSApi.createInternalSupport !== 'function') return;

    const hasFaqBot = typeof CSApi.askSupportFaq === 'function';
    const botInMaintenance = ASSISTANT_BOT_MAINTENANCE;
    const showBotPanel = hasFaqBot || botInMaintenance;
    const assetSrc = '../assets/images/support-assistant-fab.png';
    const manualHref = 'manual.html';
    const supportTechHref = isEmpresaPanel ? 'suporte-tecnico.html' : 'manual.html';
    let isMasterViewer = false;
    let masterLabel = 'Adm_Plataforma Master';

    const supportApi = isPlatformPanel
      ? {
          list: () => CSApi.listInternalSupport(session),
          create: (payload) => CSApi.createInternalSupport(payload, session),
          get: (id) => CSApi.getInternalSupportThread(id, session),
          reply: (id, body) => CSApi.replyInternalSupport(id, body, session),
          markRead: (id) => CSApi.markInternalSupportRead(id, session)
        }
      : {
          list: () => CSApi.listPlatformSupport({}, session),
          create: (payload) => CSApi.createPlatformSupport(payload, session),
          get: (id) => CSApi.getPlatformSupportThread(id, session),
          reply: (id, body) => CSApi.replyPlatformSupport(id, body, session),
          markRead: (id) => CSApi.markPlatformSupportRead(id, session)
        };

    const BOT_SUGGESTIONS = isPlatformPanel
      ? [
          'Como atender o suporte das empresas?',
          'Como falar com o Adm_Plataforma Master?',
          'Como gerenciar as respostas do Assistente Virtual?',
          'Onde configurar MFA da plataforma?'
        ]
      : [
          'Como encaminhar um relato?',
          'Como classificar o risco de uma denúncia?',
          'Como acompanhar prazos?',
          'Como gerenciar usuários?'
        ];
    const BOT_WELCOME_1 = 'Olá! 👋 Sou o Assistente Virtual do Canal Seguro. Tudo bem?';
    const BOT_WELCOME_2 = isPlatformPanel
      ? 'Posso ajudar com orientações do painel da plataforma. Se precisar, fale com o Adm_Plataforma Master.\n\nComo posso ajudar você?'
      : 'Se você tem dúvida sobre o painel, preciso de orientação ou quer entender um fluxo, estou aqui para ajudar.\n\nFique à vontade para perguntar. Como posso ajudar você?';
    const BOT_MAINTENANCE_MSG = isEmpresaPanel
      ? '**Assistente Virtual em manutenção**\n\nEstamos finalizando este recurso. Por enquanto, as respostas automáticas não estão disponíveis.\n\nSe precisar de ajuda:\n1. Consulte o Manual do painel\n2. Abra um chamado em Suporte Técnico\n\nVocê também pode falar com um atendente pelo botão abaixo.'
      : '**Assistente Virtual em manutenção**\n\nEstamos finalizando este recurso. Por enquanto, as respostas automáticas não estão disponíveis.\n\nConsulte o Manual ou use o atendimento interno abaixo.';
    const QUERY_MAX = 240;
    const FAQ_CHIP_MAX = 4;
    const escalateBtnLabel = () =>
      isPlatformPanel
        ? isMasterViewer
          ? 'Atendimento interno'
          : 'Falar com um Atendente'
        : 'Falar com um Atendente';
    const humanPrivacyText = () =>
      isPlatformPanel
        ? isMasterViewer
          ? 'Você é o Adm_Plataforma Master. Responda as mensagens dos demais administradores da plataforma.'
          : `Mensagens para o ${masterLabel}. Resposta conforme a demanda, em até 24h.`
        : 'Mensagens para um atendente da plataforma. Resposta conforme a demanda, em até 24h.';
    const humanWelcomeHtml = () =>
      isPlatformPanel && isMasterViewer
        ? '<div class="cs-support-bubble cs-support-bubble--platform"><p>Olá! Você é o Adm_Plataforma Master.</p><p>Abra uma conversa pendente abaixo ou aguarde novas mensagens dos demais Adm_Plataforma.</p><small>Atendimento Master</small></div>'
        : `<div class="cs-support-bubble cs-support-bubble--platform"><p>Olá! Você está falando com ${
            isPlatformPanel ? 'o Adm_Plataforma Master' : 'um atendente da plataforma'
          }.</p><p>Descreva sua dúvida ou problema. Resposta conforme a demanda, em até 24h.</p><small>Atendimento</small></div>`;

    const root = document.createElement('div');
    root.className = 'cs-support-fab-root';
    root.innerHTML = `
      <div class="cs-support-panel" id="csSupportPanel" role="dialog" aria-label="Assistente Virtual" hidden>
        <div class="cs-support-panel__header">
          <div class="cs-support-panel__brand">
            <img class="cs-support-panel__avatar" src="${assetSrc}" alt="" width="40" height="40" decoding="async" />
            <div>
              <h2 data-support-title>Assistente Virtual</h2>
              <p data-support-subtitle>${
                botInMaintenance ? 'Temporariamente em manutenção' : 'Orientação sobre o uso do Canal Seguro'
              }</p>
            </div>
          </div>
          <div class="cs-support-panel__actions">
            <button type="button" class="cs-support-panel__icon-btn" data-support-minimize aria-label="Minimizar conversa" title="Minimizar">−</button>
            <button type="button" class="cs-support-panel__icon-btn" data-support-close aria-label="Fechar e limpar conversa" title="Fechar">×</button>
          </div>
        </div>
        <div class="cs-support-panel__body">
          <div class="cs-support-main" data-support-main>
            <div class="cs-support-mode-panel" data-mode-panel="bot"${showBotPanel ? '' : ' hidden'}>
              <div class="cs-support-chat" data-bot-chat aria-live="polite" aria-relevant="additions"></div>
              <div class="cs-assist-composer">
                <p class="cs-assist-privacy" data-bot-privacy>${
                  botInMaintenance
                    ? 'O assistente automático está em manutenção. Use o Manual ou o Suporte Técnico.'
                    : 'Evite compartilhar senhas ou dados sensíveis desnecessários. Para suporte humano, use Falar com um Atendente.'
                }</p>
                ${
                  botInMaintenance
                    ? `<div class="cs-assist-actions">
                    <div class="cs-assist-actions__secondary">
                      <a class="btn btn-primary btn-block" href="${manualHref}">Ver manual</a>
                      ${
                        isEmpresaPanel
                          ? `<a class="btn btn-outline btn-block" href="${supportTechHref}">Suporte Técnico</a>`
                          : ''
                      }
                      <button type="button" class="btn btn-outline btn-block cs-assist-badge-btn" data-escalate-human>
                        <span data-escalate-label>Falar com um Atendente</span>
                        <span class="cs-assist-btn-badge is-empty" data-attend-badge aria-hidden="false">0</span>
                      </button>
                    </div>
                  </div>`
                    : `<form class="cs-support-form cs-assist-form" data-bot-form>
                  <div class="form-group">
                    <label for="csBotQuery">Sua dúvida</label>
                    <textarea id="csBotQuery" class="form-control" required maxlength="${QUERY_MAX}" rows="3" placeholder="Digite sua dúvida ou descreva o que você precisa saber..." aria-describedby="csBotHint"></textarea>
                    <span class="cs-assist-charhint" id="csBotHint"><span data-bot-char-count>0</span>/${QUERY_MAX}</span>
                  </div>
                  <div class="cs-assist-actions">
                    <button type="submit" class="btn btn-primary btn-block cs-assist-ask">Perguntar</button>
                    <div class="cs-assist-actions__secondary">
                      <button type="button" class="btn btn-outline btn-block cs-assist-badge-btn" data-escalate-human>
                        <span data-escalate-label>Falar com um Atendente</span>
                        <span class="cs-assist-btn-badge is-empty" data-attend-badge aria-hidden="false">0</span>
                      </button>
                      <a class="btn btn-outline btn-block" href="${manualHref}">Ver manual</a>
                    </div>
                  </div>
                </form>`
                }
              </div>
            </div>
            <div class="cs-support-mode-panel" data-mode-panel="human"${showBotPanel ? ' hidden' : ''}>
              <div class="cs-support-chat" data-support-chat aria-live="polite"></div>
              <div class="cs-assist-composer">
                <p class="cs-assist-privacy" data-human-privacy>Mensagens para um atendente da plataforma. Resposta conforme a demanda, em até 24h.</p>
                <form class="cs-support-form cs-assist-form" data-support-form>
                  <input type="hidden" id="csSupportSubject" name="subject" value="" />
                  <div class="form-group" data-human-compose>
                    <label for="csSupportBody">Sua mensagem</label>
                    <textarea id="csSupportBody" class="form-control" name="body" required maxlength="4000" rows="3" placeholder="Digite sua mensagem para o atendente..."></textarea>
                  </div>
                  <div class="cs-assist-actions">
                    <button type="submit" class="btn btn-primary btn-block" data-support-submit>Enviar</button>
                    <div class="cs-assist-actions__secondary">
                      <button type="button" class="btn btn-outline btn-block" data-back-to-bot${showBotPanel ? '' : ' hidden'}>Assistente Virtual</button>
                      <button type="button" class="btn btn-outline btn-block" data-support-new hidden>Nova conversa</button>
                    </div>
                  </div>
                </form>
              </div>
            </div>
          </div>
          <div class="cs-support-survey" data-support-survey hidden>
            <div class="cs-support-survey__step" data-survey-step="end" hidden>
              <p class="cs-support-survey__title">Deseja finalizar a conversa?</p>
              <p class="cs-support-survey__text">Você ficou um tempo sem interagir. Podemos encerrar agora ou continuar.</p>
              <div class="cs-support-survey__actions">
                <button type="button" class="btn btn-primary btn-block" data-survey-end-yes>Sim, finalizar</button>
                <button type="button" class="btn btn-outline btn-block" data-survey-end-no>Não, continuar</button>
              </div>
            </div>
            <div class="cs-support-survey__step" data-survey-step="rating" hidden>
              <p class="cs-support-survey__title">Como foi o atendimento?</p>
              <p class="cs-support-survey__text">Selecione uma nota de 1 a 5.</p>
              <div class="cs-support-rating" role="group" aria-label="Nota de 1 a 5">
                <button type="button" class="cs-support-rating__btn" data-survey-rating="1" aria-label="Nota 1">1</button>
                <button type="button" class="cs-support-rating__btn" data-survey-rating="2" aria-label="Nota 2">2</button>
                <button type="button" class="cs-support-rating__btn" data-survey-rating="3" aria-label="Nota 3">3</button>
                <button type="button" class="cs-support-rating__btn" data-survey-rating="4" aria-label="Nota 4">4</button>
                <button type="button" class="cs-support-rating__btn" data-survey-rating="5" aria-label="Nota 5">5</button>
              </div>
              <p class="cs-support-rating__hint"><span>Pouco satisfeito</span><span>Muito satisfeito</span></p>
            </div>
            <div class="cs-support-survey__step" data-survey-step="improve" hidden>
              <p class="cs-support-survey__title">O que poderíamos melhorar no atendimento?</p>
              <div class="form-group">
                <label for="csSurveyImprove">Sua sugestão</label>
                <textarea id="csSurveyImprove" class="form-control" data-survey-improve maxlength="1000" rows="4" placeholder="Conte o que podemos melhorar…"></textarea>
              </div>
              <button type="button" class="btn btn-primary btn-block" data-survey-improve-send>Enviar avaliação</button>
            </div>
            <div class="cs-support-survey__step" data-survey-step="thanks" hidden>
              <p class="cs-support-survey__title">Obrigado pelo feedback!</p>
              <p class="cs-support-survey__text">Sua avaliação ajuda a melhorar o atendimento da plataforma.</p>
            </div>
          </div>
        </div>
      </div>
      <button type="button" class="cs-support-fab" data-support-toggle aria-expanded="false" aria-controls="csSupportPanel" title="Assistente Virtual" aria-label="Abrir Assistente Virtual">
        <img class="cs-support-fab__img" src="../assets/images/support-assistant-fab.png" alt="" width="56" height="56" decoding="async" />
        <span class="cs-support-fab__badge is-empty" data-support-badge aria-hidden="false">0</span>
      </button>
    `;
    document.body.appendChild(root);

    const panel = root.querySelector('#csSupportPanel');
    const toggle = root.querySelector('[data-support-toggle]');
    const escalateLabelEl = root.querySelector('[data-escalate-label]');
    const botPrivacyEl = root.querySelector('[data-bot-privacy]');
    const humanPrivacyEl = root.querySelector('[data-human-privacy]');
    const humanComposeEl = root.querySelector('[data-human-compose]');
    const badge = root.querySelector('[data-support-badge]');
    const attendBadge = root.querySelector('[data-attend-badge]');
    const titleEl = root.querySelector('[data-support-title]');
    const subtitleEl = root.querySelector('[data-support-subtitle]');
    const botPanel = root.querySelector('[data-mode-panel="bot"]');
    const humanPanel = root.querySelector('[data-mode-panel="human"]');
    const botChat = root.querySelector('[data-bot-chat]');
    const botForm = root.querySelector('[data-bot-form]');
    const botQuery = root.querySelector('#csBotQuery');
    const botCharCount = root.querySelector('[data-bot-char-count]');
    const chatEl = root.querySelector('[data-support-chat]');
    const form = root.querySelector('[data-support-form]');
    const subjectInput = root.querySelector('#csSupportSubject');
    const bodyInput = root.querySelector('#csSupportBody');
    const submitBtn = root.querySelector('[data-support-submit]');
    const newBtn = root.querySelector('[data-support-new]');
    const backToBotBtn = root.querySelector('[data-back-to-bot]');
    const mainEl = root.querySelector('[data-support-main]');
    const surveyEl = root.querySelector('[data-support-survey]');
    const improveInput = root.querySelector('[data-survey-improve]');

    function applyPlatformLabels() {
      if (escalateLabelEl) escalateLabelEl.textContent = escalateBtnLabel();
      if (humanPrivacyEl) humanPrivacyEl.textContent = humanPrivacyText();
      if (botPrivacyEl) {
        botPrivacyEl.textContent = botInMaintenance
          ? 'O assistente automático está em manutenção. Use o Manual ou o Suporte Técnico.'
          : isPlatformPanel
            ? isMasterViewer
              ? 'Evite compartilhar senhas. Use Atendimento interno para ver mensagens dos demais Adm_Plataforma.'
              : `Evite compartilhar senhas. Para falar com o ${masterLabel}, use Falar com um Atendente.`
            : 'Evite compartilhar senhas ou dados sensíveis desnecessários. Para suporte humano, use Falar com um Atendente.';
      }
      if (humanComposeEl) humanComposeEl.hidden = Boolean(isPlatformPanel && isMasterViewer && !activeThreadId);
      if (form) {
        const req = Boolean(!(isPlatformPanel && isMasterViewer && !activeThreadId));
        if (bodyInput) bodyInput.required = req;
      }
      if (submitBtn) {
        submitBtn.hidden = Boolean(isPlatformPanel && isMasterViewer && !activeThreadId);
      }
      if (newBtn && isPlatformPanel && isMasterViewer) newBtn.hidden = true;
    }
    let activeThreadId = null;
    let threadsCache = [];
    let lastBotQuery = '';
    let lastBotAnswer = '';
    let currentMode = showBotPanel ? 'bot' : 'human';
    const botHistory = [];
    let botWelcomeStarted = false;
    let botWelcomeTimer = null;
    let botAsking = false;
    let showBotSuggest = false;
    let humanWelcomeShown = false;
    const IDLE_MS = 10 * 60 * 1000;
    let idleTimer = null;
    let surveyPhase = null;
    let pendingRating = null;
    let feedbackDone = false;
    let thanksTimer = null;

    function hasEngagement() {
      return botHistory.some((m) => m.side === 'user') || Boolean(activeThreadId);
    }

    function clearIdleTimer() {
      if (idleTimer) {
        clearTimeout(idleTimer);
        idleTimer = null;
      }
    }

    function touchActivity() {
      if (surveyPhase) return;
      clearIdleTimer();
      if (!hasEngagement()) return;
      idleTimer = setTimeout(onIdleTimeout, IDLE_MS);
    }

    function onIdleTimeout() {
      if (feedbackDone || surveyPhase || !hasEngagement()) return;
      setOpen(true);
      showSurvey('end');
    }

    function showSurvey(phase) {
      surveyPhase = phase;
      clearIdleTimer();
      if (mainEl) mainEl.hidden = true;
      if (surveyEl) surveyEl.hidden = false;
      surveyEl.querySelectorAll('[data-survey-step]').forEach((el) => {
        el.hidden = el.getAttribute('data-survey-step') !== phase;
      });
      if (phase === 'improve' && improveInput) {
        improveInput.value = '';
        setTimeout(() => improveInput.focus(), 50);
      }
      if (phase === 'rating') {
        surveyEl.querySelectorAll('[data-survey-rating]').forEach((btn) => {
          btn.classList.remove('is-selected');
        });
      }
    }

    function hideSurvey() {
      surveyPhase = null;
      pendingRating = null;
      if (mainEl) mainEl.hidden = false;
      if (surveyEl) {
        surveyEl.hidden = true;
        surveyEl.querySelectorAll('[data-survey-step]').forEach((el) => {
          el.hidden = true;
        });
      }
    }

    async function finishWithThanks() {
      showSurvey('thanks');
      feedbackDone = true;
      if (thanksTimer) clearTimeout(thanksTimer);
      thanksTimer = setTimeout(() => {
        hideSurvey();
        closeAndResetPanel(true);
      }, 1600);
    }

    async function submitFeedback(rating, improvement) {
      if (typeof CSApi.submitAssistantFeedback === 'function') {
        await runAsync(
          () =>
            CSApi.submitAssistantFeedback(
              {
                rating,
                improvement: improvement || '',
                source: 'assistente_virtual'
              },
              session
            ),
          { context: 'submitAssistantFeedback', toast: false }
        );
      }
    }

    function requestConversationEnd(fromClose) {
      if (feedbackDone) {
        closeAndResetPanel(true);
        return;
      }
      if (!hasEngagement()) {
        closeAndResetPanel(true);
        return;
      }
      setOpen(true);
      showSurvey(fromClose ? 'rating' : 'end');
    }

    function setMode(mode) {
      const prev = currentMode;
      currentMode = mode === 'human' ? 'human' : 'bot';
      if (!showBotPanel) currentMode = 'human';
      const isBot = currentMode === 'bot';
      if (botPanel) botPanel.hidden = !isBot;
      if (humanPanel) humanPanel.hidden = isBot;
      if (titleEl) titleEl.textContent = isBot ? 'Assistente Virtual' : isPlatformPanel ? 'Atendimento interno' : 'Atendimento';
      if (subtitleEl) {
        subtitleEl.textContent = isBot
          ? botInMaintenance
            ? 'Temporariamente em manutenção'
            : 'Orientação sobre o uso do Canal Seguro'
          : isPlatformPanel
            ? isMasterViewer
              ? 'Mensagens dos Adm_Plataforma'
              : `Fale com o ${masterLabel}`
            : 'Fale com um atendente da plataforma.';
      }
      applyPlatformLabels();
      if (isBot) {
        startBotWelcome();
        if (botQuery && !botInMaintenance) setTimeout(() => botQuery.focus(), 40);
      } else {
        refreshThreads();
        if (prev !== 'human' && panel.classList.contains('is-open')) {
          markSupportAsRead();
        }
        if (bodyInput && !(isPlatformPanel && isMasterViewer && !activeThreadId)) {
          setTimeout(() => bodyInput.focus(), 40);
        }
      }
    }

    function updateBotCharCount() {
      if (botCharCount && botQuery) botCharCount.textContent = String((botQuery.value || '').length);
    }

    function updateFabHint() {
      const hasConversation = botHistory.some((m) => m.side === 'user') || Boolean(activeThreadId);
      toggle.title = hasConversation ? 'Abrir Assistente Virtual' : 'Assistente Virtual';
      toggle.setAttribute('aria-label', toggle.title);
      toggle.classList.toggle('has-session', hasConversation && !panel.classList.contains('is-open'));
    }

    async function setOpen(open) {
      panel.classList.toggle('is-open', open);
      panel.hidden = !open;
      toggle.setAttribute('aria-expanded', open ? 'true' : 'false');
      if (open) {
        if (!surveyPhase) {
          setMode(currentMode);
          renderBotChat();
          if (currentMode === 'human') {
            await refreshThreads();
            await markSupportAsRead();
          } else {
            await syncUnreadBadge();
          }
          touchActivity();
        }
      } else {
        await syncUnreadBadge();
      }
      updateFabHint();
    }

    function minimizePanel() {
      if (surveyPhase === 'end' || surveyPhase === 'rating' || surveyPhase === 'improve') {
        return;
      }
      setOpen(false);
      touchActivity();
    }

    function closeAndResetPanel(skipSurvey = false) {
      if (!skipSurvey && hasEngagement() && !feedbackDone) {
        requestConversationEnd(true);
        return;
      }
      clearIdleTimer();
      if (thanksTimer) {
        clearTimeout(thanksTimer);
        thanksTimer = null;
      }
      hideSurvey();
      botHistory.length = 0;
      lastBotQuery = '';
      lastBotAnswer = '';
      botWelcomeStarted = false;
      showBotSuggest = false;
      botAsking = false;
      if (botWelcomeTimer) {
        clearTimeout(botWelcomeTimer);
        botWelcomeTimer = null;
      }
      activeThreadId = null;
      feedbackDone = false;
      pendingRating = null;
      humanWelcomeShown = false;
      if (subjectInput) {
        subjectInput.disabled = false;
        subjectInput.value = '';
      }
      bodyInput.value = '';
      if (botQuery) botQuery.value = '';
      if (improveInput) improveInput.value = '';
      newBtn.hidden = true;
      submitBtn.textContent = 'Enviar';
      chatEl.innerHTML = '';
      currentMode = showBotPanel ? 'bot' : 'human';
      setMode(currentMode);
      renderBotChat();
      setOpen(false);
      updateFabHint();
    }

    function applyBadgeEl(el, count) {
      if (!el) return;
      const n = Math.max(0, Number(count) || 0);
      el.hidden = false;
      el.removeAttribute('hidden');
      el.setAttribute('aria-hidden', 'false');
      el.textContent = n > 99 ? '99+' : String(n);
      el.classList.toggle('is-empty', n === 0);
    }

    function updateUnreadBadge(count) {
      const n = Math.max(0, Number(count) || 0);
      applyBadgeEl(badge, n);
      applyBadgeEl(attendBadge, n);
      if (badge) {
        badge.style.cssText = [
          'position:absolute',
          'top:-5px',
          'right:-5px',
          'z-index:20',
          'box-sizing:border-box',
          'min-width:22px',
          'height:22px',
          'padding:0 6px',
          'margin:0',
          'border-radius:999px',
          n === 0
            ? 'background:linear-gradient(180deg,#d7e3ec 0%,#c5d4e0 100%)'
            : 'background:linear-gradient(180deg,#2bc4b3 0%,#1fb8a8 100%)',
          n === 0 ? 'color:#3d5a73' : 'color:#05352f',
          'font-size:11px',
          'font-weight:800',
          'line-height:1',
          'display:inline-flex',
          'align-items:center',
          'justify-content:center',
          'border:2px solid #fff',
          'box-shadow:0 2px 8px rgba(11,44,74,.28)',
          'pointer-events:none'
        ].join(';');
      }
      const escalateBtn = root.querySelector('[data-escalate-human]');
      if (escalateBtn) {
        escalateBtn.setAttribute(
          'aria-label',
          n > 0
            ? `Falar com um Atendente, ${n} mensagem${n === 1 ? '' : 'ns'} não lida${n === 1 ? '' : 's'}`
            : 'Falar com um Atendente'
        );
      }
      toggle.setAttribute(
        'aria-label',
        n > 0
          ? `Assistente Virtual, ${n} mensagem${n === 1 ? '' : 'ns'} do atendente`
          : 'Abrir Assistente Virtual'
      );
    }

    async function markSupportAsRead() {
      updateUnreadBadge(0);
      await runAsync(() => supportApi.markRead(null), {
        context: isPlatformPanel ? 'markInternalSupportRead' : 'markPlatformSupportRead',
        toast: false
      });
      threadsCache = threadsCache.map((t) => ({
        ...t,
        unreadCount: 0,
        messages: (t.messages || []).map((m) => {
          if (isPlatformPanel) {
            const readBy = m.readBy && typeof m.readBy === 'object' ? { ...m.readBy } : {};
            readBy[session.id] = true;
            return { ...m, readBy };
          }
          return m.direction === 'platform' ? { ...m, readByCompany: true } : m;
        })
      }));
    }

    async function syncUnreadBadge() {
      const data = await runAsync(() => supportApi.list(), {
        context: isPlatformPanel ? 'listInternalSupport' : 'listPlatformSupport',
        toast: false
      });
      if (!data) return 0;
      if (isPlatformPanel) {
        isMasterViewer = Boolean(data.isMaster);
        if (data.master?.nome) masterLabel = data.master.nome;
        applyPlatformLabels();
      }
      threadsCache = data.threads || threadsCache;
      const unread = Number(data.unreadTotal) || 0;
      const viewingHuman = panel.classList.contains('is-open') && currentMode === 'human';
      if (viewingHuman && unread > 0) {
        await markSupportAsRead();
        return 0;
      }
      updateUnreadBadge(unread);
      return unread;
    }

    function formatWhen(iso) {
      if (!iso) return '';
      try {
        return CSReports.formatDateTime(iso);
      } catch {
        return new Date(iso).toLocaleString('pt-BR');
      }
    }

    function formatAssistHtml(text) {
      const raw = String(text || '').trim();
      if (!raw) return '';
      const lines = raw.split(/\n/);
      const blocks = [];
      let listItems = [];
      let para = [];

      const flushPara = () => {
        if (!para.length) return;
        const body = para.join(' ').trim();
        if (body) blocks.push(`<p>${escapeHtml(body)}</p>`);
        para = [];
      };
      const flushList = () => {
        if (!listItems.length) return;
        blocks.push(`<ol>${listItems.map((item) => `<li>${escapeHtml(item)}</li>`).join('')}</ol>`);
        listItems = [];
      };

      lines.forEach((line) => {
        const trimmed = line.trim();
        if (!trimmed) {
          flushList();
          flushPara();
          return;
        }
        const numbered = trimmed.match(/^(\d+)[.)]\s+(.+)$/);
        if (numbered) {
          flushPara();
          listItems.push(numbered[2]);
          return;
        }
        flushList();
        if (/^\*\*(.+)\*\*$/.test(trimmed)) {
          flushPara();
          blocks.push(
            `<p class="cs-assist-bubble__title"><strong>${escapeHtml(trimmed.replace(/^\*\*(.+)\*\*$/, '$1'))}</strong></p>`
          );
          return;
        }
        if (trimmed.startsWith('• ')) {
          flushPara();
          listItems.push(trimmed.slice(2));
          return;
        }
        para.push(trimmed);
      });
      flushList();
      flushPara();
      return blocks.join('') || `<p>${escapeHtml(raw)}</p>`;
    }

    function appendBotBubble(side, text, meta = '', suggestions = null) {
      botHistory.push({ side, text, meta, suggestions: suggestions?.length ? suggestions : null });
      renderBotChat();
      touchActivity();
    }

    function botFaqChipsHtml(suggestions, attr, label = 'Perguntas relacionadas') {
      if (!suggestions?.length) return '';
      return `
        <div class="cs-assist-suggestions cs-assist-suggestions--inline" role="group" aria-label="${escapeHtml(label)}">
          <p class="cs-assist-suggestions__label">${escapeHtml(label)}</p>
          <div class="cs-assist-suggestions__list">
            ${suggestions
              .map(
                (s) =>
                  `<button type="button" class="cs-assist-chip" ${attr}="${escapeHtml(s.question)}">${escapeHtml(s.question)}</button>`
              )
              .join('')}
          </div>
        </div>`;
    }

    function botSuggestionsHtml() {
      if (botInMaintenance || !showBotSuggest) return '';
      return botFaqChipsHtml(
        BOT_SUGGESTIONS.map((question) => ({ question })),
        'data-bot-suggest',
        'Sugestões'
      );
    }

    function startBotWelcome() {
      if (!showBotPanel) return;
      if (botWelcomeStarted || botHistory.length) {
        renderBotChat();
        return;
      }
      botWelcomeStarted = true;
      if (botInMaintenance) {
        botHistory.push({ side: 'bot', text: BOT_MAINTENANCE_MSG, meta: 'Assistente Virtual' });
        renderBotChat();
        return;
      }
      botHistory.push({ side: 'bot', text: BOT_WELCOME_1 });
      renderBotChat();
      if (botWelcomeTimer) clearTimeout(botWelcomeTimer);
      botWelcomeTimer = setTimeout(() => {
        if (botHistory.some((m) => m.side === 'user')) return;
        botHistory.push({ side: 'bot', text: BOT_WELCOME_2 });
        renderBotChat();
      }, 650);
    }

    function renderBotChat() {
      if (!botChat) return;
      const hasUser = botHistory.some((m) => m.side === 'user');
      showBotSuggest = !hasUser && botWelcomeStarted && botHistory.length >= 2;
      if (!botHistory.length) {
        botChat.innerHTML = '';
        updateFabHint();
        return;
      }
      botChat.innerHTML =
        botHistory
          .map((m) => {
            const cls = m.side === 'user' ? 'company' : 'platform';
            const who = m.side === 'user' ? 'Você' : m.meta || 'Assistente Virtual';
            const body = m.side === 'user' ? escapeHtml(m.text) : formatAssistHtml(m.text);
            const chips =
              m.side === 'bot' && m.suggestions?.length
                ? botFaqChipsHtml(m.suggestions, 'data-bot-suggest')
                : '';
            return `<div class="cs-support-bubble cs-support-bubble--${cls}">${body}<small>${escapeHtml(who)}</small></div>${chips}`;
          })
          .join('') + botSuggestionsHtml();
      botChat.scrollTop = botChat.scrollHeight;
      updateFabHint();
    }

    async function askBotQuestion(query) {
      if (botInMaintenance) {
        toast('Assistente em manutenção. Use o Manual ou o Suporte Técnico.', 'info');
        return;
      }
      if (!hasFaqBot) {
        toast('Ajuda rápida indisponível no momento. Fale com um atendente.', 'warning');
        setMode('human');
        return;
      }
      const q = String(query || '').trim().slice(0, QUERY_MAX);
      if (!q || botAsking) return;
      botAsking = true;
      if (botWelcomeTimer) {
        clearTimeout(botWelcomeTimer);
        botWelcomeTimer = null;
      }
      if (!botHistory.some((m) => m.text === BOT_WELCOME_1)) {
        botHistory.push({ side: 'bot', text: BOT_WELCOME_1 });
        botHistory.push({ side: 'bot', text: BOT_WELCOME_2 });
      } else if (!botHistory.some((m) => m.text === BOT_WELCOME_2)) {
        botHistory.push({ side: 'bot', text: BOT_WELCOME_2 });
      }
      lastBotQuery = q;
      showBotSuggest = false;
      appendBotBubble('user', q);
      botQuery.value = '';
      updateBotCharCount();
      const result = await runAsync(() => CSApi.askSupportFaq(q, session), {
        context: 'askSupportFaq'
      });
      botAsking = false;
      if (!result) {
        appendBotBubble('bot', 'Não foi possível responder agora. Tente novamente ou fale com um atendente.');
        return;
      }
      touchActivity();
      if (result.matched && result.faq) {
        lastBotAnswer = result.faq.answer;
        const title = result.faq.question ? `**${result.faq.question}**\n\n` : '';
        const related = (result.suggestions || []).slice(0, FAQ_CHIP_MAX);
        appendBotBubble('bot', `${title}${result.faq.answer}`, 'Assistente Virtual', related);
      } else if (result.partialMatch && result.suggestions?.length) {
        lastBotAnswer = '';
        appendBotBubble(
          'bot',
          `Encontrei perguntas relacionadas ao que você digitou. Escolha uma opção abaixo ou reformule sua dúvida.\n\n${result.escalateHint || 'Se preferir, fale com um atendente.'}`,
          'Assistente Virtual',
          result.suggestions.slice(0, FAQ_CHIP_MAX)
        );
      } else {
        lastBotAnswer = '';
        const related = (result.suggestions || []).slice(0, FAQ_CHIP_MAX);
        const msg = related.length
          ? `Não encontrei uma resposta exata.\n\n${result.escalateHint || 'Se preferir, fale com um atendente.'}`
          : `Não encontrei essa dúvida.\n${result.escalateHint || 'Fale com um atendente.'}`;
        appendBotBubble('bot', msg, 'Assistente Virtual', related.length ? related : null);
      }
      botQuery.focus();
    }

    function renderHumanChat(thread) {
      const messages = thread?.messages || [];
      if (!messages.length) {
        renderHumanIdle();
        return;
      }
      humanWelcomeShown = true;
      chatEl.innerHTML = messages
        .map((m) => {
          const attendantSide = m.direction === 'attendant' || m.direction === 'platform';
          const who = attendantSide
            ? m.actorName
              ? `${isPlatformPanel ? 'Master' : 'Atendente'} · ${m.actorName}`
              : isPlatformPanel
                ? 'Master'
                : 'Atendente'
            : m.actorName || 'Você';
          return `<div class="cs-support-bubble cs-support-bubble--${
            attendantSide ? 'platform' : 'company'
          }">${escapeHtml(m.body)}<small>${escapeHtml(who)} · ${escapeHtml(formatWhen(m.createdAt))}</small></div>`;
        })
        .join('');
      chatEl.scrollTop = chatEl.scrollHeight;
      applyPlatformLabels();
    }

    function previousThreadsHtml() {
      const others = (threadsCache || []).filter((t) => t.id !== activeThreadId).slice(0, 4);
      if (!others.length) return '';
      return `
        <div class="cs-assist-suggestions" role="group" aria-label="Conversas anteriores">
          <p class="cs-assist-suggestions__label">${
            isPlatformPanel && isMasterViewer ? 'Conversas pendentes' : 'Conversas anteriores'
          }</p>
          <div class="cs-assist-suggestions__list">
            ${others
              .map(
                (t) =>
                  `<button type="button" class="cs-assist-chip" data-open-thread="${escapeHtml(t.id)}">${escapeHtml(
                    (isPlatformPanel && isMasterViewer ? t.createdByName || t.subject : t.subject) || 'Atendimento'
                  )}</button>`
              )
              .join('')}
          </div>
        </div>`;
    }

    function renderHumanIdle() {
      chatEl.innerHTML = humanWelcomeHtml() + previousThreadsHtml();
      chatEl.scrollTop = chatEl.scrollHeight;
      humanWelcomeShown = true;
      applyPlatformLabels();
    }

    async function openHumanThread(threadId) {
      if (!threadId) return;
      activeThreadId = threadId;
      if (!(isPlatformPanel && isMasterViewer)) newBtn.hidden = false;
      submitBtn.textContent = 'Enviar';
      const thread = await runAsync(() => supportApi.get(activeThreadId), {
        context: isPlatformPanel ? 'getInternalSupportThread' : 'getPlatformSupportThread',
        toast: false
      });
      if (thread) {
        if (subjectInput) subjectInput.value = thread.subject || '';
        renderHumanChat(thread);
      }
      await runAsync(() => supportApi.markRead(activeThreadId), {
        context: isPlatformPanel ? 'markInternalSupportRead' : 'markPlatformSupportRead',
        toast: false
      });
      updateUnreadBadge(0);
      threadsCache = threadsCache.map((t) =>
        t.id === activeThreadId ? { ...t, unreadCount: 0 } : t
      );
      applyPlatformLabels();
      touchActivity();
    }

    async function refreshThreads() {
      const data = await runAsync(() => supportApi.list(), {
        context: isPlatformPanel ? 'listInternalSupport' : 'listPlatformSupport',
        toast: false
      });
      if (!data) return;
      if (isPlatformPanel) {
        isMasterViewer = Boolean(data.isMaster);
        if (data.master?.nome) masterLabel = data.master.nome;
      }
      threadsCache = data.threads || [];
      const unread = Number(data.unreadTotal) || 0;
      const viewingHuman = panel.classList.contains('is-open') && currentMode === 'human';
      if (viewingHuman && unread > 0) {
        await markSupportAsRead();
      } else if (!viewingHuman) {
        updateUnreadBadge(unread);
      } else {
        updateUnreadBadge(0);
      }
      applyPlatformLabels();
      if (currentMode !== 'human' || humanPanel.hidden) return;
      if (activeThreadId) {
        const thread = await runAsync(() => supportApi.get(activeThreadId), {
          context: isPlatformPanel ? 'getInternalSupportThread' : 'getPlatformSupportThread',
          toast: false
        });
        if (thread) renderHumanChat(thread);
        else {
          activeThreadId = null;
          renderHumanIdle();
        }
      } else {
        renderHumanIdle();
      }
    }

    function goEscalateHuman() {
      setMode('human');
      activeThreadId = null;
      if (!(isPlatformPanel && isMasterViewer)) newBtn.hidden = true;
      submitBtn.textContent = 'Enviar';
      if (subjectInput) {
        subjectInput.value = lastBotQuery ? `Dúvida: ${lastBotQuery.slice(0, 120)}` : 'Atendimento';
      }
      if (isPlatformPanel && isMasterViewer) {
        bodyInput.value = '';
      } else {
        const parts = [];
        if (lastBotQuery) parts.push(`Pergunta (ajuda rápida):\n${lastBotQuery}`);
        if (lastBotAnswer) parts.push(`Resposta automática:\n${lastBotAnswer}`);
        parts.push(
          isPlatformPanel
            ? 'Ainda preciso de ajuda do Adm_Plataforma Master:'
            : 'Ainda preciso de ajuda de um atendente:'
        );
        bodyInput.value = parts.join('\n\n');
      }
      renderHumanIdle();
      if (!(isPlatformPanel && isMasterViewer)) bodyInput.focus();
    }

    toggle.addEventListener('click', (e) => {
      e.stopPropagation();
      setOpen(!panel.classList.contains('is-open'));
    });
    root.querySelector('[data-support-minimize]')?.addEventListener('click', (e) => {
      e.stopPropagation();
      minimizePanel();
    });
    root.querySelector('[data-support-close]')?.addEventListener('click', (e) => {
      e.stopPropagation();
      requestConversationEnd(true);
    });
    document.addEventListener('click', (e) => {
      if (!root.contains(e.target) && panel.classList.contains('is-open')) {
        if (surveyPhase === 'end' || surveyPhase === 'rating' || surveyPhase === 'improve') return;
        minimizePanel();
      }
    });
    root.querySelector('[data-escalate-human]')?.addEventListener('click', () => {
      goEscalateHuman();
      touchActivity();
    });
    backToBotBtn?.addEventListener('click', () => {
      setMode('bot');
      touchActivity();
    });
    root.querySelector('[data-survey-end-yes]')?.addEventListener('click', () => {
      showSurvey('rating');
    });
    root.querySelector('[data-survey-end-no]')?.addEventListener('click', () => {
      hideSurvey();
      touchActivity();
    });
    root.querySelectorAll('[data-survey-rating]').forEach((btn) => {
      btn.addEventListener('click', async () => {
        const rating = Number(btn.getAttribute('data-survey-rating'));
        if (!rating) return;
        pendingRating = rating;
        surveyEl.querySelectorAll('[data-survey-rating]').forEach((b) => {
          b.classList.toggle('is-selected', b === btn);
        });
        if (rating === 5) {
          await submitFeedback(5, '');
          await finishWithThanks();
          return;
        }
        showSurvey('improve');
      });
    });
    root.querySelector('[data-survey-improve-send]')?.addEventListener('click', async () => {
      const text = String(improveInput?.value || '').trim();
      if (!text) {
        toast('Conte o que podemos melhorar.', 'warning');
        improveInput?.focus();
        return;
      }
      const rating = pendingRating || 0;
      if (rating < 1 || rating > 5) {
        showSurvey('rating');
        return;
      }
      await submitFeedback(rating, text);
      await finishWithThanks();
    });

    if (botQuery) {
      botQuery.addEventListener('input', () => {
        updateBotCharCount();
        touchActivity();
      });
      botQuery.addEventListener('keydown', touchActivity);
      updateBotCharCount();
    }
    [subjectInput, bodyInput, improveInput].forEach((el) => {
      if (!el) return;
      el.addEventListener('input', touchActivity);
      el.addEventListener('keydown', touchActivity);
    });

    if (botChat) {
      botChat.addEventListener('click', (e) => {
        const btn = e.target.closest('[data-bot-suggest]');
        if (!btn || !botChat.contains(btn)) return;
        askBotQuestion(btn.getAttribute('data-bot-suggest') || '');
      });
    }

    chatEl.addEventListener('click', (e) => {
      const btn = e.target.closest('[data-open-thread]');
      if (!btn || !chatEl.contains(btn)) return;
      openHumanThread(btn.getAttribute('data-open-thread') || '');
    });

    botForm?.addEventListener('submit', async (e) => {
      e.preventDefault();
      const query = String(botQuery.value || '').trim();
      if (!query) {
        toast('Digite sua dúvida.', 'warning');
        return;
      }
      await askBotQuestion(query);
    });

    newBtn.addEventListener('click', () => {
      activeThreadId = null;
      if (subjectInput) subjectInput.value = 'Atendimento';
      bodyInput.value = '';
      newBtn.hidden = true;
      submitBtn.textContent = 'Enviar';
      renderHumanIdle();
      touchActivity();
      bodyInput.focus();
    });

    form.addEventListener('submit', async (e) => {
      e.preventDefault();
      if (isPlatformPanel && isMasterViewer && !activeThreadId) {
        toast('Abra uma conversa pendente para responder.', 'warning');
        return;
      }
      const body = String(bodyInput.value || '').trim();
      if (!body) {
        toast('Escreva a mensagem.', 'warning');
        return;
      }
      if (activeThreadId) {
        const updated = await runAsync(() => supportApi.reply(activeThreadId, body), {
          context: isPlatformPanel ? 'replyInternalSupport' : 'replyPlatformSupport'
        });
        if (!updated) return;
        bodyInput.value = '';
        toast(
          isPlatformPanel && isMasterViewer ? 'Resposta enviada.' : 'Mensagem enviada ao atendente.',
          'success'
        );
        touchActivity();
        await refreshThreads();
        return;
      }
      const subject =
        String(subjectInput?.value || '').trim() ||
        (lastBotQuery ? `Dúvida: ${lastBotQuery.slice(0, 120)}` : body.slice(0, 80)) ||
        'Atendimento';
      const created = await runAsync(() => supportApi.create({ subject, body }), {
        context: isPlatformPanel ? 'createInternalSupport' : 'createPlatformSupport'
      });
      if (!created) return;
      activeThreadId = created.id;
      if (subjectInput) subjectInput.value = subject;
      newBtn.hidden = false;
      submitBtn.textContent = 'Enviar';
      bodyInput.value = '';
      toast('Mensagem enviada. Resposta em até 24h.', 'success');
      touchActivity();
      await refreshThreads();
    });

    setMode(currentMode);
    updateFabHint();
    syncUnreadBadge();
    const unreadPoll = window.setInterval(() => {
      if (document.hidden) return;
      syncUnreadBadge();
    }, 20000);
    window.addEventListener(
      'beforeunload',
      () => {
        window.clearInterval(unreadPoll);
      },
      { once: true }
    );
  }



  const ROW_ACTION_ICONS = {
    delete:
      '<svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" aria-hidden="true"><path d="M3 6h18"/><path d="M8 6V4h8v2"/><path d="M19 6l-1 14H6L5 6"/><path d="M10 11v6M14 11v6"/></svg>',
    edit:
      '<svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" aria-hidden="true"><path d="M12 20h9"/><path d="M16.5 3.5a2.1 2.1 0 0 1 3 3L7 19l-4 1 1-4 12.5-12.5z"/></svg>',
    view:
      '<svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" aria-hidden="true"><path d="M1 12s4-7 11-7 11 7 11 7-4 7-11 7S1 12 1 12z"/><circle cx="12" cy="12" r="3"/></svg>',
    assign:
      '<svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" aria-hidden="true"><path d="M16 21v-2a4 4 0 0 0-4-4H6a4 4 0 0 0-4 4v2"/><circle cx="9" cy="7" r="4"/><path d="M22 11l-3-3 3-3"/><path d="M16 8h6"/></svg>',
    investigate:
      '<svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" aria-hidden="true"><circle cx="11" cy="11" r="7"/><path d="M21 21l-4.3-4.3"/><path d="M11 8v6M8 11h6"/></svg>'
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

  function rowReportActionsHtml(href, opts = {}) {
    const safeHref = escapeHtml(String(href || '#'));
    const safeId = escapeHtml(String(opts.reportId || ''));
    const canManage = Boolean(opts.canManage);
    const closed = Boolean(opts.closed);
    let html = '<div class="row-actions" role="group" aria-label="Ações">';
    if (canManage && !closed) {
      html +=
        '<button type="button" class="btn-row-action" data-report-assign="' +
        safeId +
        '" title="Encaminhar ao Apurador" aria-label="Encaminhar ao Apurador">' +
        ROW_ACTION_ICONS.assign +
        '</button>';
      html +=
        '<button type="button" class="btn-row-action" data-report-investigate="' +
        safeId +
        '" title="Apurar" aria-label="Apurar">' +
        ROW_ACTION_ICONS.investigate +
        '</button>';
    }
    html +=
      '<a class="btn-row-action" href="' +
      safeHref +
      '" title="Visualizar" aria-label="Visualizar">' +
      ROW_ACTION_ICONS.view +
      '</a></div>';
    return html;
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

    initTableFontSize,

    applyPanelSkin,

    applyTableFontSize,

    normalizeTableFontSize,

    toggleTheme,

    toast,

    confirmDialog,

    selectDialog,

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

    initSupportWidget,

    initPublicAssistantWidget,

    rowActionsHtml,

    rowViewActionHtml,
    rowReportActionsHtml,

    setFormReadonly

  };

})();



window.CSApp = CSApp;

if (typeof location !== 'undefined') {
  const markPanelSkin = () => {
    if (!document.body) return;
    const path = location.pathname || '';
    if (/\/admin\//.test(path)) {
      document.body.classList.add('panel-platform', 'panel-canal');
    } else if (/\/empresa\//.test(path)) {
      document.body.classList.add('panel-empresa', 'panel-canal');
    }
  };
  if (document.body) markPanelSkin();
  else document.addEventListener('DOMContentLoaded', markPanelSkin, { once: true });
}

document.addEventListener('DOMContentLoaded', () => {

  CSApp.initTheme();
  CSApp.initTableFontSize();

});


