/**
 * card-layout.js – Layout fixo dos dashboards Adm_Empresa / Adm_Plataforma.
 * Posição/tamanho vêm do padrão oficial (sem edição de arrastar/redimensionar).
 */
const CSCardLayout = (() => {
  const LAYOUT_REV = 19;
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

  /**
   * Padrão oficial Adm_Empresa / Adm_Plataforma:
   * Esquerda: KPIs → Atenção → Fluxo|Status
   * Direita (do topo até antes do período): Categoria + Risco
   * Período em largura total; Recentes alto (~10 linhas) em largura total
   */
  function computeOpsDefault(width) {
    const w = Math.max(960, width || 1180);
    const gap = 12;
    const items = {};

    const rightW = Math.floor(w * 0.27);
    const leftW = w - rightW - gap;

    const kpiIds = ['total', 'triage', 'apuracao', 'concluidos'];
    const kpiW = Math.floor((leftW - gap * (kpiIds.length - 1)) / kpiIds.length);
    const kpiH = 128;
    kpiIds.forEach((id, i) => {
      items[id] = { x: i * (kpiW + gap), y: 0, w: kpiW, h: kpiH };
    });

    const yAttn = kpiH + gap;
    const attnH = 156;
    items.attention = { x: 0, y: yAttn, w: leftW, h: attnH };

    const yMid = yAttn + attnH + gap;
    const flowW = Math.floor(leftW * 0.58);
    const statusW = leftW - flowW - gap;

    /* Direita: categorias + risco (altura do risco inclui o botão CTA) */
    const rightRefH = yMid + 280;
    const catH = Math.floor(rightRefH * 0.55);
    const riskH = Math.max(292, rightRefH - catH - gap + 28);
    items.categories = { x: leftW + gap, y: 0, w: rightW, h: catH };
    items.risk = { x: leftW + gap, y: catH + gap, w: rightW, h: riskH };

    /* Fluxo e Status alinham a base com o card de risco */
    const riskBottom = catH + gap + riskH;
    const midH = Math.max(280, riskBottom - yMid);
    items.flow = { x: 0, y: yMid, w: flowW, h: midH };
    items.status = { x: flowW + gap, y: yMid, w: statusW, h: midH };

    const yPeriod = Math.max(yMid + midH, riskBottom) + gap;
    const periodH = 280;
    items.months = { x: 0, y: yPeriod, w, h: periodH };

    const yRecent = yPeriod + periodH + 16;
    const recentH = 680;
    items.recent = { x: 0, y: yRecent, w, h: recentH };

    return { freeform: true, rev: LAYOUT_REV, height: yRecent + recentH + 8, items };
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
      /* Sempre o padrão oficial — Adm_Empresa e Adm_Plataforma ficam idênticos */
      toFreeform(container);
      applyBoxes(container, computeOpsDefault(container.clientWidth));
      saveState(container);
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
