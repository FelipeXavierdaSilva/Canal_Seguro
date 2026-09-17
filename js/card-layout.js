/**
 * card-layout.js – Layout dos dashboards Adm_Empresa / Adm_Plataforma.
 * Ops usam CSS Grid estático (sem freeform/altura fixa) para não cortar conteúdo.
 */
const CSCardLayout = (() => {
  const LAYOUT_REV = 20;
  const PREFIX = `cs_card_layout_v${LAYOUT_REV}:`;
  const MIN_W = 140;
  const MIN_H = 88;

  function keyFor(container) {
    const page = location.pathname.replace(/\\/g, '/');
    const id = container.id || container.dataset.layoutKey || '';
    const idx = [...(container.parentElement?.children || [])].indexOf(container);
    return `${PREFIX}${page}::${id || 'g' + idx}`;
  }

  function storageSuffix(container) {
    const page = location.pathname.replace(/\\/g, '/');
    const id = container.id || container.dataset.layoutKey || '';
    const idx = [...(container.parentElement?.children || [])].indexOf(container);
    return `${page}::${id || 'g' + idx}`;
  }

  function isOpsDashboard(container) {
    const preset = container && container.dataset.layoutPreset;
    return preset === 'empresa-dashboard' || preset === 'plataforma-dashboard';
  }

  function clearAbsoluteStyles(el) {
    if (!el) return;
    el.style.position = '';
    el.style.left = '';
    el.style.top = '';
    el.style.width = '';
    el.style.height = '';
    el.style.margin = '';
    el.style.maxWidth = '';
    el.style.gridColumn = '';
    el.style.gridRow = '';
    el.style.zIndex = '';
  }

  /**
   * Layout oficial em CSS Grid (sem posição absoluta / overflow hidden).
   * Esquerda: KPIs → Atenção → Fluxo|Status
   * Direita: Categorias + Risco
   * Em seguida: Período e Recentes em largura total
   */
  function applyOpsGrid(container) {
    container.classList.remove('is-layout-freeform');
    container.classList.add('dashboard-board--ops');
    container.style.position = '';
    container.style.display = '';
    container.style.minHeight = '';
    [...container.querySelectorAll(':scope > [data-layout-id]')].forEach((el) => {
      clearAbsoluteStyles(el);
      stripEditChrome(el);
    });
    try {
      localStorage.removeItem(keyFor(container));
      sessionStorage.removeItem(keyFor(container));
    } catch (_) {
      /* ignore */
    }
  }

  /** Mantido para compatibilidade de export / debug — não usado no layout live. */
  function computeOpsDefault(width) {
    const w = Math.max(960, width || 1180);
    return { freeform: false, rev: LAYOUT_REV, grid: 'ops', boardWidth: w, items: {} };
  }

  function readState(container) {
    try {
      const raw = localStorage.getItem(keyFor(container));
      return raw ? JSON.parse(raw) : null;
    } catch {
      return null;
    }
  }

  function saveState(container) {
    const items = {};
    [...container.querySelectorAll(':scope > [data-layout-id]')].forEach((el) => {
      const id = el.getAttribute('data-layout-id');
      if (!id) return;
      items[id] = {
        x: parseFloat(el.style.left) || 0,
        y: parseFloat(el.style.top) || 0,
        w: el.offsetWidth,
        h: el.offsetHeight
      };
    });
    localStorage.setItem(
      keyFor(container),
      JSON.stringify({ freeform: true, rev: LAYOUT_REV, height: container.offsetHeight, items })
    );
  }

  function clearLegacy(container) {
    const suffix = storageSuffix(container);
    const doomed = [];
    for (let i = 0; i < localStorage.length; i += 1) {
      const k = localStorage.key(i);
      if (!k || !k.includes('cs_card_layout') || !k.endsWith(suffix)) continue;
      if (k.startsWith(PREFIX)) continue;
      doomed.push(k);
    }
    doomed.forEach((k) => localStorage.removeItem(k));
    const sessionDoomed = [];
    for (let i = 0; i < sessionStorage.length; i += 1) {
      const k = sessionStorage.key(i);
      if (!k || !k.includes('cs_card_layout') || !k.endsWith(suffix)) continue;
      if (k.startsWith(PREFIX)) continue;
      sessionDoomed.push(k);
    }
    sessionDoomed.forEach((k) => sessionStorage.removeItem(k));
  }

  function ensureHandle(item) {
    let btn = item.querySelector('.card-move-handle');
    if (btn) return btn;
    btn = document.createElement('button');
    btn.type = 'button';
    btn.className = 'card-move-handle';
    btn.title = 'Arrastar para mover';
    btn.setAttribute('aria-label', 'Mover card');
    btn.innerHTML = '<span aria-hidden="true">⋮⋮</span>';
    const header = item.querySelector(':scope > .panel__header');
    if (header) header.appendChild(btn);
    else item.appendChild(btn);
    return btn;
  }

  function ensureResize(item) {
    let handle = item.querySelector(':scope > .card-resize-handle');
    if (handle) return handle;
    handle = document.createElement('div');
    handle.className = 'card-resize-handle';
    handle.title = 'Arrastar para redimensionar';
    handle.setAttribute('aria-hidden', 'true');
    item.appendChild(handle);
    return handle;
  }

  function placeAbsolute(item, x, y, w, h) {
    item.style.position = 'absolute';
    item.style.left = `${x}px`;
    item.style.top = `${Math.max(0, y)}px`;
    item.style.width = `${Math.max(MIN_W, w)}px`;
    item.style.height = `${Math.max(MIN_H, h)}px`;
    item.style.margin = '0';
    item.style.maxWidth = 'none';
    item.style.gridColumn = 'auto';
    item.style.gridRow = 'auto';
    item.style.zIndex = item.style.zIndex || '1';
  }

  function applyBoxes(container, state) {
    if (!state || !state.items) return;
    Object.entries(state.items).forEach(([id, box]) => {
      const el = container.querySelector(`[data-layout-id="${CSS.escape(String(id))}"]`);
      if (!el || !box) return;
      placeAbsolute(el, box.x, box.y, box.w, box.h);
    });
    if (state.height) container.style.minHeight = `${state.height}px`;
    bumpBoardHeight(container);
  }

  function bumpBoardHeight(container) {
    let maxBottom = 0;
    [...container.querySelectorAll(':scope > [data-layout-id]')].forEach((el) => {
      const bottom = (parseFloat(el.style.top) || 0) + el.offsetHeight;
      if (bottom > maxBottom) maxBottom = bottom;
    });
    container.style.minHeight = `${Math.max(maxBottom + 16, 120)}px`;
  }

  function lockSiblings(container, item, locked) {
    [...container.querySelectorAll(':scope > [data-layout-id]')].forEach((el) => {
      if (el === item) return;
      el.style.pointerEvents = locked ? 'none' : '';
    });
  }

  function notifyContentResize() {
    window.dispatchEvent(new Event('resize'));
  }

  function toFreeform(container) {
    if (container.classList.contains('is-layout-freeform')) return;
    const kids = [...container.querySelectorAll(':scope > [data-layout-id]')];
    if (!kids.length) return;

    const baseHeight = container.offsetHeight;
    container.classList.add('is-layout-freeform');
    container.style.position = 'relative';
    container.style.display = 'block';
    container.style.minHeight = `${Math.max(baseHeight, 120)}px`;

    kids.forEach((item) => {
      const x = item.offsetLeft;
      const y = item.offsetTop;
      const w = item.offsetWidth;
      const h = Math.max(item.offsetHeight, MIN_H);
      placeAbsolute(item, x, y, w, h);
    });
  }

  function applyPresetOrSaved(container) {
    if (isOpsDashboard(container)) {
      applyOpsGrid(container);
      return true;
    }
    const saved = readState(container);
    if (saved && saved.freeform && saved.items && saved.rev === LAYOUT_REV) {
      toFreeform(container);
      applyBoxes(container, saved);
      return true;
    }
    return false;
  }

  function bindMove(item, container) {
    const handle = ensureHandle(item);
    const header = item.querySelector(':scope > .panel__header');
    const startDrag = (e) => {
      if (e.button !== 0) return;
      if (e.target.closest('a, button:not(.card-move-handle)')) return;
      e.preventDefault();
      e.stopPropagation();
      toFreeform(container);
      const startX = e.clientX;
      const startY = e.clientY;
      let originLeft = parseFloat(item.style.left) || 0;
      let originTop = parseFloat(item.style.top) || 0;
      item.classList.add('is-dragging');
      item.style.zIndex = '50';
      lockSiblings(container, item, true);

      const onMove = (ev) => {
        const dx = ev.clientX - startX;
        const dy = ev.clientY - startY;
        const minVisible = 56;
        const boardW = container.clientWidth || 1;
        const x = Math.max(
          minVisible - item.offsetWidth,
          Math.min(boardW - minVisible, originLeft + dx)
        );
        const y = Math.max(0, originTop + dy);
        placeAbsolute(item, x, y, item.offsetWidth, item.offsetHeight);
        bumpBoardHeight(container);
      };

      const onUp = () => {
        document.removeEventListener('pointermove', onMove);
        document.removeEventListener('pointerup', onUp);
        document.removeEventListener('pointercancel', onUp);
        item.classList.remove('is-dragging');
        item.style.zIndex = '6';
        lockSiblings(container, item, false);
        bumpBoardHeight(container);
        saveState(container);
      };

      document.addEventListener('pointermove', onMove);
      document.addEventListener('pointerup', onUp);
      document.addEventListener('pointercancel', onUp);
    };

    handle.addEventListener('pointerdown', startDrag);
    if (header) header.addEventListener('pointerdown', startDrag);
  }

  function bindResize(item, container) {
    const handle = ensureResize(item);
    handle.addEventListener('pointerdown', (e) => {
      if (e.button !== 0) return;
      e.preventDefault();
      e.stopPropagation();
      toFreeform(container);
      const startX = e.clientX;
      const startY = e.clientY;
      const originW = item.offsetWidth;
      const originH = item.offsetHeight;
      const left = parseFloat(item.style.left) || 0;
      const top = parseFloat(item.style.top) || 0;
      item.classList.add('is-resizing');
      item.style.zIndex = '20';
      const onMove = (ev) => {
        const w = Math.max(MIN_W, originW + (ev.clientX - startX));
        const h = Math.max(MIN_H, originH + (ev.clientY - startY));
        placeAbsolute(item, left, top, w, h);
        bumpBoardHeight(container);
      };

      const onUp = () => {
        document.removeEventListener('pointermove', onMove);
        document.removeEventListener('pointerup', onUp);
        document.removeEventListener('pointercancel', onUp);
        item.classList.remove('is-resizing');
        item.style.zIndex = '6';
        bumpBoardHeight(container);
        saveState(container);
        notifyContentResize();
      };

      document.addEventListener('pointermove', onMove);
      document.addEventListener('pointerup', onUp);
      document.addEventListener('pointercancel', onUp);
    });
  }

  function stripEditChrome(item) {
    item.classList.remove('is-moveable');
    item.querySelectorAll('.card-move-handle, .card-resize-handle').forEach((el) => el.remove());
    delete item.dataset.layoutItemBound;
  }

  function bindContainer(container) {
    if (!container) return;
    clearLegacy(container);
    const items = [...container.querySelectorAll(':scope > [data-layout-id]')];
    if (!items.length) return;

    const placed = applyPresetOrSaved(container);
    const editable = !isOpsDashboard(container);

    items.forEach((item) => {
      if (!editable) {
        stripEditChrome(item);
        return;
      }
      if (item.dataset.layoutItemBound === '1') return;
      item.dataset.layoutItemBound = '1';
      item.classList.add('is-moveable');
      ensureHandle(item);
      ensureResize(item);
      bindMove(item, container);
      bindResize(item, container);
    });

    if (container.classList.contains('dashboard-board--ops')) {
      container.classList.add('is-layout-ready');
      notifyContentResize();
      return;
    }
    if (!placed && !container.classList.contains('is-layout-freeform')) {
      container.classList.add('is-layout-ready');
    } else {
      bumpBoardHeight(container);
      notifyContentResize();
    }
  }

  function bindPage(root) {
    const scope = root || document;
    scope.querySelectorAll('.dashboard-board, .kpi-grid, .panel-grid').forEach(bindContainer);
  }

  function resetPage(root) {
    const scope = root || document;
    scope.querySelectorAll('.dashboard-board, .kpi-grid, .panel-grid').forEach((container) => {
      localStorage.removeItem(keyFor(container));
      sessionStorage.removeItem(keyFor(container));
      clearLegacy(container);
    });
  }

  function exportLayout(container) {
    const el =
      container ||
      document.querySelector('[data-layout-preset="empresa-dashboard"]') ||
      document.querySelector('[data-layout-preset="plataforma-dashboard"]') ||
      document.getElementById('dashboardBoard');
    if (!el) {
      console.warn('[CSCardLayout] board não encontrado');
      return null;
    }
    saveState(el);
    const saved = readState(el) || {};
    const payload = {
      ...saved,
      rev: LAYOUT_REV,
      boardWidth: el.clientWidth,
      boardHeight: el.offsetHeight
    };
    const text = JSON.stringify(payload, null, 2);
    try {
      if (navigator.clipboard?.writeText) navigator.clipboard.writeText(text);
    } catch (_) {
      /* ignore */
    }
    console.log('[CSCardLayout] cole este JSON no chat:');
    console.log(text);
    return payload;
  }

  return {
    bindContainer,
    bindPage,
    resetPage,
    computeOpsDefault,
    computeEmpresaDefault: computeOpsDefault,
    exportLayout
  };
})();
