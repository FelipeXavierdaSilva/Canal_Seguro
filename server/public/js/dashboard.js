/**
 * dashboard.js – Gráficos canvas leves (sem dependências)
 */

const CSCharts = (() => {
  function cssVar(name, fallback) {
    const v = getComputedStyle(document.documentElement).getPropertyValue(name).trim();
    return v || fallback;
  }

  function clear(canvas) {
    const ctx = canvas.getContext('2d');
    const dpr = window.devicePixelRatio || 1;
    const rect = canvas.getBoundingClientRect();
    canvas.width = rect.width * dpr;
    canvas.height = rect.height * dpr;
    ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
    ctx.clearRect(0, 0, rect.width, rect.height);
    return { ctx, w: rect.width, h: rect.height };
  }

  function barChart(canvas, labels, values, color) {
    const { ctx, w, h } = clear(canvas);
    const pad = { t: 16, r: 12, b: 36, l: 36 };
    const max = Math.max(...values, 1);
    const n = labels.length;
    const gap = 8;
    const barW = Math.max(12, (w - pad.l - pad.r - gap * (n - 1)) / n);
    const fill = color || cssVar('--cs-primary', '#146c6c');
    const text = cssVar('--cs-text-muted', '#6b827c');

    ctx.strokeStyle = cssVar('--cs-border', '#ddd');
    ctx.beginPath();
    ctx.moveTo(pad.l, pad.t);
    ctx.lineTo(pad.l, h - pad.b);
    ctx.lineTo(w - pad.r, h - pad.b);
    ctx.stroke();

    values.forEach((v, i) => {
      const x = pad.l + i * (barW + gap);
      const bh = ((h - pad.t - pad.b) * v) / max;
      const y = h - pad.b - bh;
      ctx.fillStyle = fill;
      roundRect(ctx, x, y, barW, bh, 4);
      ctx.fill();
      ctx.fillStyle = text;
      ctx.font = '11px "Nunito Sans", sans-serif';
      ctx.textAlign = 'center';
      ctx.fillText(String(v), x + barW / 2, y - 4);
      ctx.save();
      ctx.translate(x + barW / 2, h - pad.b + 12);
      ctx.fillText(truncate(labels[i], 10), 0, 0);
      ctx.restore();
    });
  }

  function drawStatusIcon(ctx, kind, cx, cy, size) {
    const s = size / 2;
    ctx.save();
    ctx.translate(cx, cy);
    ctx.strokeStyle = 'rgba(255,255,255,0.92)';
    ctx.fillStyle = 'rgba(255,255,255,0.92)';
    ctx.lineWidth = Math.max(1.2, size / 12);
    ctx.lineCap = 'round';
    ctx.lineJoin = 'round';
    if (kind === 'inbox') {
      ctx.strokeRect(-s * 0.7, -s * 0.15, s * 1.4, s * 0.85);
      ctx.beginPath();
      ctx.moveTo(-s * 0.7, -s * 0.15);
      ctx.lineTo(0, s * 0.25);
      ctx.lineTo(s * 0.7, -s * 0.15);
      ctx.stroke();
      ctx.beginPath();
      ctx.moveTo(0, -s * 0.75);
      ctx.lineTo(0, -s * 0.2);
      ctx.moveTo(-s * 0.28, -s * 0.45);
      ctx.lineTo(0, -s * 0.2);
      ctx.lineTo(s * 0.28, -s * 0.45);
      ctx.stroke();
    } else if (kind === 'search') {
      ctx.beginPath();
      ctx.arc(-s * 0.15, -s * 0.15, s * 0.48, 0, Math.PI * 2);
      ctx.stroke();
      ctx.beginPath();
      ctx.moveTo(s * 0.22, s * 0.22);
      ctx.lineTo(s * 0.7, s * 0.7);
      ctx.stroke();
    } else if (kind === 'shield') {
      ctx.beginPath();
      ctx.moveTo(0, -s * 0.75);
      ctx.lineTo(s * 0.62, -s * 0.4);
      ctx.lineTo(s * 0.5, s * 0.25);
      ctx.quadraticCurveTo(0, s * 0.85, -s * 0.5, s * 0.25);
      ctx.lineTo(-s * 0.62, -s * 0.4);
      ctx.closePath();
      ctx.stroke();
    } else if (kind === 'people') {
      ctx.beginPath();
      ctx.arc(-s * 0.28, -s * 0.28, s * 0.28, 0, Math.PI * 2);
      ctx.arc(s * 0.32, -s * 0.18, s * 0.24, 0, Math.PI * 2);
      ctx.stroke();
      ctx.beginPath();
      ctx.arc(-s * 0.28, s * 0.7, s * 0.5, Math.PI * 1.15, Math.PI * 1.85);
      ctx.stroke();
      ctx.beginPath();
      ctx.arc(s * 0.32, s * 0.72, s * 0.42, Math.PI * 1.15, Math.PI * 1.85);
      ctx.stroke();
    } else if (kind === 'check') {
      ctx.beginPath();
      ctx.arc(0, 0, s * 0.72, 0, Math.PI * 2);
      ctx.stroke();
      ctx.beginPath();
      ctx.moveTo(-s * 0.32, 0.05);
      ctx.lineTo(-s * 0.05, s * 0.32);
      ctx.lineTo(s * 0.4, -s * 0.32);
      ctx.stroke();
    }
    ctx.restore();
  }

  function statusBarChart(canvas, stages) {
    const { ctx, w, h } = clear(canvas);
    const pad = { t: 22, r: 8, b: 86, l: 8 };
    const values = stages.map((s) => s.value || 0);
    const max = Math.max(...values, 1);
    const n = stages.length;
    const gap = Math.max(6, w * 0.018);
    const barW = Math.max(18, (w - pad.l - pad.r - gap * (n - 1)) / n);
    const plotH = h - pad.t - pad.b;
    const muted = cssVar('--cs-text-muted', '#6b827c');
    const text = cssVar('--cs-text-secondary', '#4a625e');

    stages.forEach((stage, i) => {
      const x = pad.l + i * (barW + gap);
      const v = values[i];
      const bh = Math.max(v > 0 ? 10 : 4, (plotH * v) / max);
      const y = h - pad.b - bh;
      ctx.fillStyle = stage.color;
      roundRect(ctx, x, y, barW, bh, 5);
      ctx.fill();
      if (bh > 28 && stage.icon) {
        drawStatusIcon(ctx, stage.icon, x + barW / 2, y + bh / 2, Math.min(22, barW * 0.45));
      }
      ctx.fillStyle = text;
      ctx.font = '600 12px "Nunito Sans", sans-serif';
      ctx.textAlign = 'center';
      ctx.textBaseline = 'bottom';
      ctx.fillText(String(v), x + barW / 2, y - 4);

      const cx = x + barW / 2;
      ctx.textBaseline = 'top';
      ctx.fillStyle = cssVar('--cs-text', '#1a2e2c');
      ctx.font = '600 10px "Nunito Sans", sans-serif';
      ctx.fillText(truncate(stage.title, 16), cx, h - pad.b + 8);
      ctx.fillStyle = muted;
      ctx.font = '9px "Nunito Sans", sans-serif';
      ctx.fillText(truncate(stage.sub, 18), cx, h - pad.b + 22);
    });

    const gx = pad.l;
    const gw = w - pad.l - pad.r;
    const gy = h - 22;
    const grad = ctx.createLinearGradient(gx, gy, gx + gw, gy);
    grad.addColorStop(0, '#c53030');
    grad.addColorStop(0.25, '#e07a2f');
    grad.addColorStop(0.5, '#d4a017');
    grad.addColorStop(0.75, '#6db37a');
    grad.addColorStop(1, '#2d8a5e');
    ctx.fillStyle = grad;
    roundRect(ctx, gx, gy, gw, 5, 3);
    ctx.fill();
    ctx.font = '9px "Nunito Sans", sans-serif';
    ctx.textBaseline = 'bottom';
    ctx.fillStyle = '#c53030';
    ctx.textAlign = 'left';
    ctx.fillText('Mais crítico', gx, gy - 3);
    ctx.fillStyle = '#2d8a5e';
    ctx.textAlign = 'right';
    ctx.fillText('Mais resolvido', gx + gw, gy - 3);
  }

  function horizontalBarChart(canvas, labels, values, color) {
    const { ctx, w, h } = clear(canvas);
    const fill = color || cssVar('--cs-primary', '#146c6c');
    const text = cssVar('--cs-text', '#1a2e2c');
    const muted = cssVar('--cs-text-secondary', '#4a625e');
    const n = Math.max(labels.length, 1);

    const pairs = labels.map((label, i) => ({
      label: String(label || '—'),
      value: Number(values[i]) || 0
    })).sort((a, b) => b.value - a.value);

    const fontLabel = '600 11px "Nunito Sans", system-ui, sans-serif';
    const fontValue = '700 12px "Nunito Sans", system-ui, sans-serif';
    ctx.font = fontLabel;
    let maxLabelW = 0;
    pairs.forEach((p) => {
      maxLabelW = Math.max(maxLabelW, ctx.measureText(p.label).width);
    });

    const valueCol = 28;
    const gapLabel = 8;
    const gapValue = 8;
    const padT = 6;
    const padB = 6;
    const padL = Math.min(Math.max(72, Math.ceil(maxLabelW) + 4), Math.floor(w * 0.48));
    const padR = valueCol + gapValue;
    const barMax = Math.max(16, w - padL - padR - gapLabel);
    const rowH = Math.max(20, (h - padT - padB) / n);
    const barH = Math.min(12, Math.max(8, rowH * 0.42));
    const max = Math.max(...pairs.map((p) => p.value), 1);

    pairs.forEach((p, i) => {
      const cy = padT + i * rowH + rowH / 2;
      const bw = p.value > 0 ? Math.max(6, (barMax * p.value) / max) : 0;

      ctx.fillStyle = muted;
      ctx.font = fontLabel;
      ctx.textAlign = 'left';
      ctx.textBaseline = 'middle';
      const label = fitLabel(ctx, p.label, padL - 4);
      ctx.fillText(label, 2, cy);

      if (bw > 0) {
        ctx.fillStyle = fill;
        roundRect(ctx, padL + gapLabel, cy - barH / 2, bw, barH, barH / 2);
        ctx.fill();
      }

      ctx.fillStyle = text;
      ctx.font = fontValue;
      ctx.textAlign = 'right';
      ctx.fillText(String(p.value), w - 2, cy);
    });
  }

  function fitLabel(ctx, s, maxW) {
    if (ctx.measureText(s).width <= maxW) return s;
    let out = s;
    while (out.length > 1 && ctx.measureText(`${out}…`).width > maxW) {
      out = out.slice(0, -1);
    }
    return `${out}…`;
  }

  function doughnutChart(canvas, labels, values, colors) {
    const { ctx, w, h } = clear(canvas);
    const total = values.reduce((a, b) => a + b, 0) || 1;
    const cx = w * 0.38;
    const cy = h / 2;
    const r = Math.min(w, h) * 0.32;
    const rIn = r * 0.58;
    let start = -Math.PI / 2;
    const palette = colors || [
      cssVar('--cs-primary', '#146c6c'),
      cssVar('--cs-secondary', '#3a5f7d'),
      cssVar('--cs-accent', '#c9894a'),
      cssVar('--cs-info', '#3a7ca5'),
      cssVar('--cs-success', '#2d8a5e'),
      cssVar('--cs-warning', '#c9894a'),
      '#7a9590',
      '#8b6b9e',
      '#5c7a6e'
    ];

    values.forEach((v, i) => {
      const angle = (v / total) * Math.PI * 2;
      ctx.beginPath();
      ctx.moveTo(cx, cy);
      ctx.fillStyle = palette[i % palette.length];
      ctx.arc(cx, cy, r, start, start + angle);
      ctx.closePath();
      ctx.fill();
      start += angle;
    });

    ctx.globalCompositeOperation = 'destination-out';
    ctx.beginPath();
    ctx.arc(cx, cy, rIn, 0, Math.PI * 2);
    ctx.fill();
    ctx.globalCompositeOperation = 'source-over';

    ctx.fillStyle = cssVar('--cs-text', '#1a2e2c');
    ctx.font = '600 18px Lora, serif';
    ctx.textAlign = 'center';
    ctx.textBaseline = 'middle';
    ctx.fillText(String(values.reduce((a, b) => a + b, 0)), cx, cy);

    // legend
    let ly = 20;
    labels.forEach((label, i) => {
      const x = w * 0.68;
      ctx.fillStyle = palette[i % palette.length];
      ctx.fillRect(x, ly, 10, 10);
      ctx.fillStyle = cssVar('--cs-text-secondary', '#4a625e');
      ctx.font = '12px "Nunito Sans", sans-serif';
      ctx.textAlign = 'left';
      ctx.textBaseline = 'top';
      ctx.fillText(`${truncate(label, 16)} (${values[i]})`, x + 16, ly - 1);
      ly += 20;
    });
  }

  function lineChart(canvas, labels, values, color) {
    const { ctx, w, h } = clear(canvas);
    const pad = { t: 20, r: 16, b: 36, l: 36 };
    const max = Math.max(...values, 1);
    const n = labels.length;
    const fill = color || cssVar('--cs-primary', '#146c6c');
    const text = cssVar('--cs-text-muted', '#6b827c');
    const plotW = w - pad.l - pad.r;
    const plotH = h - pad.t - pad.b;

    ctx.strokeStyle = cssVar('--cs-border', '#ddd');
    ctx.beginPath();
    ctx.moveTo(pad.l, pad.t);
    ctx.lineTo(pad.l, h - pad.b);
    ctx.lineTo(w - pad.r, h - pad.b);
    ctx.stroke();

    const points = values.map((v, i) => {
      const x = pad.l + (n === 1 ? plotW / 2 : (i / (n - 1)) * plotW);
      const y = pad.t + plotH - (v / max) * plotH;
      return { x, y, v };
    });

    // area
    ctx.beginPath();
    points.forEach((p, i) => (i === 0 ? ctx.moveTo(p.x, p.y) : ctx.lineTo(p.x, p.y)));
    ctx.lineTo(points[points.length - 1].x, h - pad.b);
    ctx.lineTo(points[0].x, h - pad.b);
    ctx.closePath();
    ctx.fillStyle = hexAlpha(fill, 0.15);
    ctx.fill();

    ctx.beginPath();
    points.forEach((p, i) => (i === 0 ? ctx.moveTo(p.x, p.y) : ctx.lineTo(p.x, p.y)));
    ctx.strokeStyle = fill;
    ctx.lineWidth = 2.5;
    ctx.stroke();

    points.forEach((p, i) => {
      ctx.beginPath();
      ctx.arc(p.x, p.y, 4, 0, Math.PI * 2);
      ctx.fillStyle = fill;
      ctx.fill();
      ctx.fillStyle = text;
      ctx.font = '11px "Nunito Sans", sans-serif';
      ctx.textAlign = 'center';
      ctx.fillText(labels[i], p.x, h - pad.b + 16);
    });
  }

  function roundRect(ctx, x, y, w, h, r) {
    const rr = Math.min(r, w / 2, h / 2);
    ctx.beginPath();
    ctx.moveTo(x + rr, y);
    ctx.arcTo(x + w, y, x + w, y + h, rr);
    ctx.arcTo(x + w, y + h, x, y + h, rr);
    ctx.arcTo(x, y + h, x, y, rr);
    ctx.arcTo(x, y, x + w, y, rr);
    ctx.closePath();
  }

  function truncate(s, n) {
    return s.length > n ? s.slice(0, n - 1) + '…' : s;
  }

  function hexAlpha(color, a) {
    if (color.startsWith('#')) {
      let h = color.slice(1);
      if (h.length === 3) h = h.split('').map((c) => c + c).join('');
      const n = parseInt(h, 16);
      const r = (n >> 16) & 255;
      const g = (n >> 8) & 255;
      const b = n & 255;
      return `rgba(${r},${g},${b},${a})`;
    }
    return color;
  }

  return { barChart, statusBarChart, horizontalBarChart, doughnutChart, lineChart };
})();

window.CSCharts = CSCharts;

const CSDashboard = (() => {
  function summaryIcon(kind) {
    const icons = {
      total:
        '<svg viewBox="0 0 24 24" width="18" height="18" fill="none" stroke="currentColor" stroke-width="1.8"><rect x="3" y="4" width="18" height="14" rx="2"/><path d="M7 8h6M7 12h10M7 16h4" stroke-linecap="round"/></svg>',
      triage:
        '<svg viewBox="0 0 24 24" width="18" height="18" fill="none" stroke="currentColor" stroke-width="1.8"><path d="M7 3h8l4 4v14H7z"/><path d="M15 3v4h4M9 13h6M9 17h4" stroke-linecap="round"/></svg>',
      apuracao:
        '<svg viewBox="0 0 24 24" width="18" height="18" fill="none" stroke="currentColor" stroke-width="1.8"><circle cx="12" cy="12" r="8"/><path d="M12 8v4l3 2" stroke-linecap="round"/></svg>',
      done:
        '<svg viewBox="0 0 24 24" width="18" height="18" fill="none" stroke="currentColor" stroke-width="1.8"><path d="M12 3 4.5 6.5v5.2c0 4.4 3.1 7.7 7.5 8.8 4.4-1.1 7.5-4.4 7.5-8.8V6.5z"/><path d="m9 12 2 2 4-4" stroke-linecap="round" stroke-linejoin="round"/></svg>'
    };
    return icons[kind] || '';
  }

  function attentionIcon(kind) {
    const icons = {
      unclassified:
        '<svg viewBox="0 0 24 24" width="16" height="16" fill="none" stroke="currentColor" stroke-width="1.85"><path d="M12 3 4.8 6.2v5.1c0 4.2 3 7.4 7.2 8.5 4.2-1.1 7.2-4.3 7.2-8.5V6.2z"/><path d="M12 9.2v.2M12 12.2v3.2" stroke-linecap="round"/></svg>',
      stalled:
        '<svg viewBox="0 0 24 24" width="16" height="16" fill="none" stroke="currentColor" stroke-width="1.85"><circle cx="12" cy="12" r="8"/><path d="M12 8v4l2.8 1.8" stroke-linecap="round"/></svg>',
      noAssignee:
        '<svg viewBox="0 0 24 24" width="16" height="16" fill="none" stroke="currentColor" stroke-width="1.85"><circle cx="12" cy="9" r="3.2"/><path d="M6.2 18.2c1.1-2.4 3.1-3.6 5.8-3.6s4.7 1.2 5.8 3.6" stroke-linecap="round"/><path d="M17.2 8.2h3.2M18.8 6.6v3.2" stroke-linecap="round"/></svg>',
      high:
        '<svg viewBox="0 0 24 24" width="16" height="16" fill="none" stroke="currentColor" stroke-width="1.85"><path d="M12 4.2 3.8 18.5h16.4z"/><path d="M12 10v3.6M12 16.2v.2" stroke-linecap="round"/></svg>',
      critical:
        '<svg viewBox="0 0 24 24" width="16" height="16" fill="none" stroke="currentColor" stroke-width="1.85"><circle cx="12" cy="12" r="8"/><path d="M12 7.8v5M12 15.8v.3" stroke-linecap="round"/></svg>'
    };
    return icons[kind] || '';
  }

  function relatosHref(query) {
    if (!query) return 'relatos.html';
    const params = new URLSearchParams(query);
    const q = params.toString();
    return q ? `relatos.html?${q}` : 'relatos.html';
  }

  async function renderKpis(container, metrics) {
    if (!container) return;
    const alerts = metrics.workflowAlerts || {};

    if (container.classList.contains('dashboard-board')) {
      const summary = [
        {
          id: 'total',
          title: 'Total de relatos',
          value: metrics.total || 0,
          sub: 'Todos os registros',
          tone: 'accent',
          icon: 'total',
          href: relatosHref()
        },
        {
          id: 'triage',
          title: 'Aguardando triagem',
          value: metrics.novos || metrics.byStatus?.recebido || 0,
          sub: 'Recebidos',
          tone: 'danger',
          icon: 'triage',
          href: relatosHref({ status: 'recebido' })
        },
        {
          id: 'apuracao',
          title: 'Em apuração',
          value: metrics.emApuracao || metrics.byStatus?.apuracao || 0,
          sub: 'Investigações',
          tone: 'warn',
          icon: 'apuracao',
          href: relatosHref({ status: 'apuracao' })
        },
        {
          id: 'concluidos',
          title: 'Concluídos',
          value: metrics.concluidos || 0,
          sub: 'Finalizados',
          tone: 'success',
          icon: 'done',
          href: relatosHref({ status: 'concluido' })
        }
      ];

      const attentionItems = [
        {
          id: 'unclassified',
          value: metrics.unclassifiedCount || 0,
          label: 'Sem classificação',
          tone: 'success',
          icon: 'unclassified',
          href: relatosHref({ riskLevel: 'unclassified' })
        },
        {
          id: 'stalled',
          value: alerts.stalled || 0,
          label: 'Parados há +5 dias',
          tone: 'warn',
          icon: 'stalled',
          href: relatosHref({ alert: 'stalled' })
        },
        {
          id: 'noAssignee',
          value: alerts.noAssignee || 0,
          label: 'Sem responsável',
          tone: 'accent',
          icon: 'noAssignee',
          href: relatosHref({ alert: 'noAssignee' })
        },
        {
          id: 'high',
          value: metrics.highCount || 0,
          label: 'Alto risco',
          tone: 'warn',
          icon: 'high',
          href: relatosHref({ riskLevel: 'high' })
        },
        {
          id: 'critical',
          value: metrics.criticalCount || 0,
          label: 'Críticos',
          tone: 'danger',
          icon: 'critical',
          href: relatosHref({ riskLevel: 'critical' })
        }
      ];

      const legacyIds = ['critical', 'high', 'unclassified', 'novos', 'analise'];
      legacyIds.forEach((id) => {
        container.querySelectorAll(`:scope > [data-layout-id="${id}"]`).forEach((el) => el.remove());
      });

      const firstPanel = () => container.querySelector(':scope > .panel');

      summary.forEach((item) => {
        let el = container.querySelector(`:scope > [data-layout-id="${item.id}"]`);
        const body = `
            <a class="kpi-card__link" href="${item.href}" title="Ver ${item.title.toLowerCase()}">
              <div class="kpi-card__icon" aria-hidden="true">${summaryIcon(item.icon)}</div>
              <div class="kpi-card__title">${item.title}</div>
              <div class="kpi-card__value">${item.value}</div>
              <div class="kpi-card__sub">${item.sub}</div>
            </a>`;
        const html = `
          <div class="kpi-card kpi-card--summary kpi-card--clickable kpi-card--${item.tone}" data-layout-id="${item.id}">
            ${body}
          </div>`;
        if (!el) {
          const wrap = document.createElement('div');
          wrap.innerHTML = html.trim();
          el = wrap.firstElementChild;
          const anchor = firstPanel();
          if (anchor) container.insertBefore(el, anchor);
          else container.appendChild(el);
        } else {
          el.className = `kpi-card kpi-card--summary kpi-card--clickable kpi-card--${item.tone}`;
          el.innerHTML = body;
          delete el.dataset.layoutItemBound;
        }
      });

      let attention = container.querySelector(':scope > [data-layout-id="attention"]');
      const attentionCards = attentionItems
        .map(
          (a) => `
              <a class="attn-card attn-card--${a.tone} attn-card--clickable" href="${a.href}" title="Ver ${a.label.toLowerCase()}">
                <div class="attn-card__icon" aria-hidden="true">${attentionIcon(a.icon)}</div>
                <div class="attn-card__value">${a.value}</div>
                <div class="attn-card__label">${a.label}</div>
              </a>`
        )
        .join('');
      const attentionHtml = `
        <div class="attn-panel" data-layout-id="attention">
          <div class="attn-panel__title">Atenção necessária</div>
          <div class="attn-panel__grid">
            ${attentionCards}
          </div>
        </div>`;
      if (!attention) {
        const wrap = document.createElement('div');
        wrap.innerHTML = attentionHtml.trim();
        attention = wrap.firstElementChild;
        const anchor = firstPanel();
        if (anchor) container.insertBefore(attention, anchor);
        else container.appendChild(attention);
      } else {
        attention.innerHTML = `
          <div class="attn-panel__title">Atenção necessária</div>
          <div class="attn-panel__grid">
            ${attentionCards}
          </div>`;
        delete attention.dataset.layoutItemBound;
      }
      return;
    }

    const items = [
      { id: 'total', label: 'Total de relatos', value: metrics.total, cls: 'kpi-card--accent', hint: 'Base completa' },
      { id: 'critical', label: 'Críticos', value: metrics.criticalCount || 0, cls: 'kpi-card--danger', hint: 'Risco crítico' },
      { id: 'high', label: 'Alto risco', value: metrics.highCount || 0, cls: 'kpi-card--warn', hint: 'Prioridade alta' },
      { id: 'unclassified', label: 'Não classificados', value: metrics.unclassifiedCount || 0, hint: 'Sem risco' },
      { id: 'novos', label: 'Novos', value: metrics.novos, cls: 'kpi-card--warn', hint: 'Recebidos' },
      { id: 'analise', label: 'Em análise', value: metrics.emAnalise, hint: 'Em avaliação' },
      { id: 'concluidos', label: 'Concluídos', value: metrics.concluidos, cls: 'kpi-card--success', hint: 'Finalizados' }
    ];
    container.innerHTML = items
      .map(
        (i) => `
      <article class="kpi-card ${i.cls || ''}" data-layout-id="${i.id}">
        <div class="kpi-card__label">${i.label}</div>
        <div class="kpi-card__value">${i.value}</div>
        ${i.hint ? `<div class="kpi-card__hint">${i.hint}</div>` : ''}
      </article>`
      )
      .join('');
  }

  function flowIcon(kind) {
    const icons = {
      inbox:
        '<svg viewBox="0 0 24 24" width="17" height="17" fill="none" stroke="currentColor" stroke-width="1.85"><path d="M3.8 13.2h3.4l1.5 1.6h6.6l1.5-1.6h3.4v5.4c0 .8-.6 1.4-1.4 1.4H5.2c-.8 0-1.4-.6-1.4-1.4v-5.4z"/><path d="M3.8 13.2V8.6c0-1 .8-1.8 1.8-1.8h12.8c1 0 1.8.8 1.8 1.8v4.6"/><path d="M12 4v5.4M9.7 6.8 12 9.1l2.3-2.3" stroke-linecap="round" stroke-linejoin="round"/></svg>',
      search:
        '<svg viewBox="0 0 24 24" width="17" height="17" fill="none" stroke="currentColor" stroke-width="1.85"><circle cx="11" cy="11" r="5.6"/><path d="m15.9 15.9 3.4 3.4" stroke-linecap="round"/></svg>',
      shield:
        '<svg viewBox="0 0 24 24" width="17" height="17" fill="none" stroke="currentColor" stroke-width="1.85"><path d="M12 3.4 5.4 6.2v4.8c0 4.1 2.9 7.2 6.6 8.3 3.7-1.1 6.6-4.2 6.6-8.3V6.2z"/><path d="m9.4 12 1.8 1.8L15 10" stroke-linecap="round" stroke-linejoin="round"/></svg>',
      people:
        '<svg viewBox="0 0 24 24" width="17" height="17" fill="none" stroke="currentColor" stroke-width="1.85"><circle cx="9" cy="8.6" r="2.9"/><circle cx="16" cy="9.4" r="2.35"/><path d="M3.8 18.2c.85-2.35 2.75-3.55 5.2-3.55s4.35 1.2 5.2 3.55M13.3 18.2c.45-1.4 1.55-2.35 2.95-2.35s2.45.95 2.9 2.35" stroke-linecap="round"/></svg>',
      check:
        '<svg viewBox="0 0 24 24" width="17" height="17" fill="none" stroke="currentColor" stroke-width="1.85"><circle cx="12" cy="12" r="7.8"/><path d="m8.7 12.1 2.2 2.2 4.4-4.5" stroke-linecap="round" stroke-linejoin="round"/></svg>'
    };
    return icons[kind] || '';
  }

  function renderFlowTrack(container, metrics) {
    if (!container) return;
    const byStatus = metrics.byStatus || {};
    const stages = [
      { id: 'recebido', title: 'Recebidos', sub: 'Aguardando', tone: 'danger', icon: 'inbox' },
      { id: 'analise', title: 'Em análise', sub: 'Avaliação', tone: 'warn', icon: 'search' },
      { id: 'apuracao', title: 'Apuração', sub: 'Investigação', tone: 'amber', icon: 'shield' },
      { id: 'acompanhamento', title: 'Acompanhamento', sub: 'Monitoramento', tone: 'mint', icon: 'people' },
      { id: 'concluido', title: 'Concluídos', sub: 'Finalizado', tone: 'success', icon: 'check' }
    ];
    container.innerHTML = stages
      .map((s, i) => {
        const value = byStatus[s.id] || 0;
        const href = relatosHref({ status: s.id });
        const arrow =
          i < stages.length - 1
            ? `<span class="flow-track__arrow" aria-hidden="true">
                <svg class="flow-track__arrow-svg" viewBox="0 0 28 16" width="22" height="12" xmlns="http://www.w3.org/2000/svg">
                  <path d="M1.5 5.2h14.2V2.1L26.5 8 15.7 13.9V10.8H1.5z" fill="#a85a45" stroke="#5c2f24" stroke-width="1.1" stroke-linejoin="round"/>
                </svg>
              </span>`
            : '';
        return `
          <a class="flow-stage flow-stage--${s.tone} flow-stage--clickable" href="${href}" title="Ver ${s.title.toLowerCase()}">
            <div class="flow-stage__top">
              <div class="flow-stage__icon" aria-hidden="true">${flowIcon(s.icon)}</div>
              ${arrow}
            </div>
            <div class="flow-stage__value">${value}</div>
            <div class="flow-stage__title">${s.title}</div>
            <div class="flow-stage__sub">${s.sub}</div>
          </a>`;
      })
      .join('');
  }

  function renderStatusColumns(container, metrics) {
    if (!container) return;
    const byStatus = metrics.byStatus || {};
    const stages = [
      { id: 'recebido', title: 'Recebidos', sub: 'Aguardando', color: '#c53030', icon: 'inbox' },
      { id: 'analise', title: 'Análise', sub: 'Avaliação', color: '#e07a2f', icon: 'search' },
      { id: 'apuracao', title: 'Apuração', sub: 'Investigação', color: '#d4a017', icon: 'shield' },
      { id: 'acompanhamento', title: 'Acompanhamento', sub: 'Monitoramento', color: '#6db37a', icon: 'people' },
      { id: 'concluido', title: 'Concluídos', sub: 'Finalizado', color: '#2d8a5e', icon: 'check' }
    ].map((s) => ({ ...s, value: byStatus[s.id] || 0 }));
    const max = Math.max(...stages.map((s) => s.value), 1);
    container.innerHTML = `
      <div class="status-cols__row">
        ${stages
          .map((s) => {
            const pct = s.value > 0 ? Math.max(18, Math.round((s.value / max) * 100)) : 6;
            const href = relatosHref({ status: s.id });
            return `
            <a class="status-col status-col--clickable" href="${href}" title="Ver ${s.title.toLowerCase()}">
              <div class="status-col__value">${s.value}</div>
              <div class="status-col__track">
                <div class="status-col__fill" style="height:${pct}%;background:${s.color}">
                  <span class="status-col__icon" aria-hidden="true">${flowIcon(s.icon)}</span>
                </div>
              </div>
              <div class="status-col__title">${s.title}</div>
              <div class="status-col__sub">${s.sub}</div>
            </a>`;
          })
          .join('')}
      </div>
      <div class="status-cols__legend" aria-hidden="true">
        <span>Mais crítico</span>
        <span class="status-cols__legend-bar"></span>
        <span>Mais resolvido</span>
      </div>`;
  }

  function renderRiskDistribution(container, metrics) {
    if (!container) return;
    const byRisk = metrics.byRisk || {};
    const rows = [
      { id: 'critical', label: 'Crítico', tone: 'critical', value: byRisk.critical || 0 },
      { id: 'high', label: 'Alto', tone: 'high', value: byRisk.high || 0 },
      { id: 'moderate', label: 'Moderado', tone: 'moderate', value: byRisk.moderate || 0 },
      { id: 'low', label: 'Baixo', tone: 'low', value: byRisk.low || 0 },
      { id: 'unclassified', label: 'Não classificado', tone: 'none', value: byRisk.unclassified || 0 }
    ];
    const unclassified = byRisk.unclassified || 0;
    const btnLabel =
      unclassified === 1
        ? 'Ver 1 não classificado'
        : `Ver ${unclassified} não classificados`;
    container.innerHTML = `
      <ul class="risk-dist__list">
        ${rows
          .map((r) => {
            const href = relatosHref({ riskLevel: r.id });
            return `
          <li>
            <a class="risk-dist__row risk-dist__row--${r.tone} risk-dist__row--clickable" href="${href}" title="Ver relatos ${r.label.toLowerCase()}">
              <span class="risk-dist__label">${r.label}</span>
              <span class="risk-dist__value">${r.value}</span>
            </a>
          </li>`;
          })
          .join('')}
      </ul>
      <a class="risk-dist__cta" href="${relatosHref({ riskLevel: 'unclassified' })}">${btnLabel} →</a>
    `;
  }

  function renderCategoryBars(container, metrics) {
    if (!container) return;
    try {
      const esc =
        typeof CSApp !== 'undefined' && typeof CSApp.escapeHtml === 'function'
          ? CSApp.escapeHtml
          : (s) =>
              String(s ?? '')
                .replace(/&/g, '&amp;')
                .replace(/</g, '&lt;')
                .replace(/>/g, '&gt;')
                .replace(/"/g, '&quot;');
      const raw = metrics && metrics.byCategory ? metrics.byCategory : {};
      const entries = Object.entries(raw)
        .map(([id, value]) => {
          let label = id || 'Sem categoria';
          try {
            if (typeof CSApi !== 'undefined' && typeof CSApi.categoryLabel === 'function') {
              label = CSApi.categoryLabel(id) || label;
            }
          } catch (_) {
            /* keep id */
          }
          return { id, label: String(label), value: Number(value) || 0 };
        })
        .filter((e) => e.id !== '' && e.id != null)
        .sort((a, b) => b.value - a.value);

      if (!entries.length) {
        container.innerHTML = '<p class="cat-bars__empty">Sem dados de categoria.</p>';
        return;
      }

      const max = Math.max(...entries.map((e) => e.value), 1);
      container.innerHTML = `<ul class="cat-bars__list">${entries
        .map((e) => {
          const pct = e.value > 0 ? Math.max(10, Math.round((e.value / max) * 100)) : 0;
          const href = relatosHref({ category: e.id });
          return `<li><a class="cat-bars__row cat-bars__row--clickable" href="${href}" title="Ver relatos de ${esc(e.label)}"><span class="cat-bars__label">${esc(e.label)}</span><span class="cat-bars__track"><span class="cat-bars__fill" style="width:${pct}%"></span></span><strong class="cat-bars__value">${e.value}</strong></a></li>`;
        })
        .join('')}</ul>`;
    } catch (err) {
      if (typeof CSErrors !== 'undefined') CSErrors.logError(err, 'renderCategoryBars');
      container.innerHTML = '<p class="cat-bars__empty">Não foi possível carregar as categorias.</p>';
    }
  }

  async function renderCharts(metrics) {
    const riskCanvas = document.getElementById('chartRisk');
    const riskList = document.getElementById('riskDistribution');
    const catList = document.getElementById('categoryDistribution');
    const catCanvas = document.getElementById('chartCategories');
    const statusList = document.getElementById('statusDistribution');
    const statusCanvas = document.getElementById('chartStatus');
    const monthCanvas = document.getElementById('chartMonths');

    if (riskList) {
      renderRiskDistribution(riskList, metrics);
    } else if (riskCanvas && metrics.byRisk) {
      const order = [
        ['critical', 'Crítico'],
        ['high', 'Alto'],
        ['moderate', 'Moderado'],
        ['low', 'Baixo'],
        ['unclassified', 'Não class.']
      ];
      const labels = order.map(([, l]) => l);
      const values = order.map(([k]) => metrics.byRisk[k] || 0);
      CSCharts.doughnutChart(riskCanvas, labels, values, ['#c53030', '#d97706', '#c9894a', '#2d8a5e', '#9aa5a2']);
    }

    if (catList) {
      renderCategoryBars(catList, metrics);
    } else if (catCanvas) {
      const entries = Object.entries(metrics.byCategory || {});
      const labels = entries.map(([k]) => CSApi.categoryLabel(k));
      const values = entries.map(([, v]) => v);
      const safeLabels = labels.length ? labels : ['Sem dados'];
      const safeValues = values.length ? values : [0];
      if (catCanvas.getAttribute('data-chart') === 'hbar') {
        CSCharts.horizontalBarChart(catCanvas, safeLabels, safeValues);
      } else {
        CSCharts.doughnutChart(catCanvas, safeLabels, safeValues);
      }
    }

    renderFlowTrack(document.getElementById('flowTrack'), metrics);

    if (statusList) {
      renderStatusColumns(statusList, metrics);
    } else if (statusCanvas) {
      const stages = [
        { id: 'recebido', title: 'Recebido', sub: 'Aguardando', color: '#c53030', icon: 'inbox' },
        { id: 'analise', title: 'Em análise', sub: 'Avaliação', color: '#e07a2f', icon: 'search' },
        { id: 'apuracao', title: 'Em apuração', sub: 'Investigação', color: '#d4a017', icon: 'shield' },
        { id: 'acompanhamento', title: 'Acompanhamento', sub: 'Monitoramento', color: '#6db37a', icon: 'people' },
        { id: 'concluido', title: 'Concluído', sub: 'Finalizado', color: '#2d8a5e', icon: 'check' }
      ].map((s) => ({ ...s, value: metrics.byStatus[s.id] || 0 }));
      CSCharts.statusBarChart(statusCanvas, stages);
    }

    if (monthCanvas) {
      const months = Object.keys(metrics.byMonth).sort();
      const labels = months.map((m) => {
        const [y, mo] = m.split('-');
        return `${mo}/${y.slice(2)}`;
      });
      const values = months.map((m) => metrics.byMonth[m]);
      CSCharts.lineChart(
        monthCanvas,
        labels.length ? labels : ['—'],
        values.length ? values : [0]
      );
    }
  }

  function renderRecentTable(tbody, reports, { showCompany = false, detailBase = 'relatos.html' } = {}) {
    if (!tbody) return;
    const esc = CSApp.escapeHtml;
    if (!reports.length) {
      tbody.innerHTML = `<tr><td colspan="${showCompany ? 8 : 7}" class="text-center text-muted">Nenhum relato recente.</td></tr>`;
      return;
    }
    tbody.innerHTML = reports
      .map((r) => {
        const companyCell = showCompany
          ? `<td data-company="${esc(r.companyId)}">…</td>`
          : '';
        return `
        <tr>
          <td><strong>${esc(r.protocol)}</strong></td>
          ${companyCell}
          <td title="Data e hora em que o relato foi registrado no canal">${CSReports.formatDateTime(r.createdAt)}</td>
          <td>${esc(CSApi.categoryLabel(r.category))}</td>
          <td>${CSReports.riskPillHtml(r.riskLevel, esc)}</td>
          <td>${r.isAnonymous ? 'Anônimo' : 'Identificado'}</td>
          <td><span class="status-pill ${CSReports.statusClass(r.status)}">${esc(CSApi.statusLabel(r.status))}</span></td>
          <td><a class="btn btn-sm btn-outline" href="${detailBase}?id=${encodeURIComponent(r.id)}">Visualizar</a></td>
        </tr>`;
      })
      .join('');
  }

  async function renderDashboardPage(kpiContainer, metricsLoader) {
    try {
      const metrics = typeof metricsLoader === 'function' ? await metricsLoader() : metricsLoader;
      await renderKpis(kpiContainer, metrics);
      await renderCharts(metrics);
      if (typeof CSCardLayout !== 'undefined' && kpiContainer) {
        const root = kpiContainer.closest('.app-content') || document;
        if (!root.classList.contains('indicators-layout')) {
          CSCardLayout.bindPage(root);
        }
      }
      const catList = document.getElementById('categoryDistribution');
      if (catList) renderCategoryBars(catList, metrics);
      const riskList = document.getElementById('riskDistribution');
      if (riskList) renderRiskDistribution(riskList, metrics);
      const statusList = document.getElementById('statusDistribution');
      if (statusList) renderStatusColumns(statusList, metrics);
      return metrics;
    } catch (err) {
      CSErrors.logError(err, 'renderDashboardPage');
      if (kpiContainer) {
        CSErrors.renderLoadError(kpiContainer, CSErrors.userMessage(err), () =>
          renderDashboardPage(kpiContainer, metricsLoader)
        );
      }
      CSApp.toast(CSErrors.userMessage(err), 'error');
      return null;
    }
  }

  function renderWorkflowAlerts(container, alerts = {}) {
    if (!container) return;
    const items = [];
    if (alerts.noAssignee) items.push(`${alerts.noAssignee} relato(s) sem responsável após triagem`);
    if (alerts.stalled) items.push(`${alerts.stalled} relato(s) parado(s) há mais de 5 dias`);
    if (alerts.slaOverdue) items.push(`${alerts.slaOverdue} relato(s) com SLA vencido`);
    if (alerts.slaWarning) items.push(`${alerts.slaWarning} relato(s) próximo(s) do SLA`);
    if (alerts.awaitingInfo) items.push(`${alerts.awaitingInfo} aguardando informações do denunciante`);
    if (alerts.dueOverdue) items.push(`${alerts.dueOverdue} relato(s) com prazo operacional vencido`);
    if (!items.length) {
      container.classList.add('hidden');
      container.innerHTML = '';
      return;
    }
    container.classList.remove('hidden');
    container.innerHTML = `
      <a class="ops-alert" href="relatos.html" role="alert">
        <span class="ops-alert__icon" aria-hidden="true">
          <svg viewBox="0 0 24 24" width="18" height="18" fill="none" stroke="currentColor" stroke-width="2" stroke-linejoin="round">
            <path d="M12 3.5 21.5 20H2.5L12 3.5z"/>
            <path d="M12 10v4.5" stroke-linecap="round"/>
            <circle cx="12" cy="17.2" r="1" fill="currentColor" stroke="none"/>
          </svg>
        </span>
        <strong class="ops-alert__label">ATENÇÃO:</strong>
        <span class="ops-alert__text">${items.join(' · ')}</span>
        <span class="ops-alert__action">Ver relatos</span>
      </a>`;
  }

  return { renderKpis, renderCharts, renderRecentTable, renderDashboardPage, renderWorkflowAlerts };
})();

window.CSDashboard = CSDashboard;
