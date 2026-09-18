/**
 * attachments.js – Anexos de relatos (protótipo + espelho de limites do servidor).
 *
 * Espelho documentado de server/src/config.js → ATTACHMENTS (Fase A2).
 * Fonte da verdade em produção: API/servidor. Não ampliar allowlist aqui sem o server.
 *
 * Protótipo: metadados no localStorage — nunca binário, URL pública ou storageKey.
 */

const CSAttachments = (() => {
  /** Espelho de config.ATTACHMENTS — manter alinhado ao server */
  const LIMITS = {
    MAX_ATTACHMENTS_PER_REPORT: 5,
    MAX_FILE_SIZE_IMAGE: 5 * 1024 * 1024,
    MAX_FILE_SIZE_AUDIO: 5 * 1024 * 1024,
    MAX_FILE_SIZE_VIDEO: 8 * 1024 * 1024,
    MAX_FILE_SIZE_DOCUMENT: 10 * 1024 * 1024,
    MAX_FILE_SIZE_OTHER: 2 * 1024 * 1024,
    STORAGE_ALERT_THRESHOLDS: [70, 85, 95, 100],
    MIN_COMPANY_QUOTA_BYTES: 10 * 1024 * 1024,
    MAX_COMPANY_QUOTA_BYTES: 2 * 1024 * 1024 * 1024 * 1024,
    DEFAULT_COMPANY_QUOTA_BYTES: 5 * 1024 * 1024 * 1024,
    /** Teto absoluto (compat) */
    MAX_BYTES: 10 * 1024 * 1024
  };

  const GiB = 1024 * 1024 * 1024;
  const STORAGE_PLANS = [
    {
      id: 'essencial',
      name: 'Essencial',
      storageLimitBytes: 5 * GiB,
      storageLabel: '5 GB',
      barPercent: 17,
      priceLabel: 'R$ 149',
      priceSuffix: '/mês',
      priceAmount: 149,
      billingNote: 'Contratação anual',
      usersLabel: '2 usuários',
      retentionLabel: 'Retenção de evidências por 1 ano',
      description: 'Indicado para empresas pequenas.',
      featured: false,
      ctaLabel: 'Contratar',
      tierIndex: 0
    },
    {
      id: 'plus',
      name: 'Plus',
      storageLimitBytes: 10 * GiB,
      storageLabel: '10 GB',
      barPercent: 33,
      priceLabel: 'R$ 299',
      priceSuffix: '/mês',
      priceAmount: 299,
      billingNote: 'Contratação anual',
      usersLabel: '3 usuários',
      retentionLabel: 'Retenção de evidências por 1 ano',
      description: 'Indicado para pequenas empresas.',
      featured: true,
      ctaLabel: 'Contratar',
      tierIndex: 1
    },
    {
      id: 'pro',
      name: 'Pro',
      storageLimitBytes: 20 * GiB,
      storageLabel: '20 GB',
      barPercent: 67,
      priceLabel: 'R$ 599',
      priceSuffix: '/mês',
      priceAmount: 599,
      billingNote: 'Contratação anual',
      usersLabel: '5 usuários',
      retentionLabel: 'Retenção de evidências por 1 ano',
      description: 'Indicado para empresas médias.',
      featured: false,
      ctaLabel: 'Contratar',
      tierIndex: 2
    },
    {
      id: 'corporativo',
      name: 'Corporativo',
      storageLimitBytes: 30 * GiB,
      storageLabel: '30 GB',
      barPercent: 100,
      priceLabel: 'Sob consulta',
      priceSuffix: '',
      priceAmount: null,
      billingNote: 'Contratação anual',
      usersLabel: 'Usuários ilimitados',
      retentionLabel: 'Retenção de evidências por 1 ano',
      description: 'Indicado para empresas maiores.',
      featured: false,
      ctaLabel: 'Falar com especialista',
      tierIndex: 3
    }
  ];

  const MAX_COUNT = LIMITS.MAX_ATTACHMENTS_PER_REPORT;
  const MAX_BYTES = LIMITS.MAX_BYTES;

  const ALLOWED_EXTENSIONS = new Set(['pdf', 'doc', 'docx', 'txt', 'png', 'jpg', 'jpeg', 'gif', 'webp']);

  const ALLOWED_MIME = new Set([
    'application/pdf',
    'application/msword',
    'application/vnd.openxmlformats-officedocument.wordprocessingml.document',
    'text/plain',
    'image/png',
    'image/jpeg',
    'image/gif',
    'image/webp'
  ]);

  const IMAGE_EXT = new Set(['png', 'jpg', 'jpeg', 'gif', 'webp']);
  const DOCUMENT_EXT = new Set(['pdf', 'doc', 'docx', 'txt']);

  const EXT_TO_MIME = {
    pdf: 'application/pdf',
    doc: 'application/msword',
    docx: 'application/vnd.openxmlformats-officedocument.wordprocessingml.document',
    txt: 'text/plain',
    png: 'image/png',
    jpg: 'image/jpeg',
    jpeg: 'image/jpeg',
    gif: 'image/gif',
    webp: 'image/webp'
  };

  const STATUS_LABELS = {
    pending_upload: 'Aguardando envio',
    simulated: 'Metadado simulado',
    stored: 'Armazenado (servidor)',
    scanning: 'Verificação antivírus',
    rejected: 'Rejeitado'
  };

  const BLOCKED_STORE_KEYS = new Set([
    'url',
    'blob',
    'content',
    'base64',
    'dataUrl',
    'storageKey',
    'storageUrl',
    'downloadUrl',
    'path',
    'file'
  ]);

  function uid() {
    return `att_${Date.now().toString(36)}_${Math.random().toString(36).slice(2, 8)}`;
  }

  function extensionFromName(name) {
    const match = String(name || '').match(/\.([a-z0-9]+)$/i);
    return match ? match[1].toLowerCase() : '';
  }

  function resolveCategory(name, mimeType) {
    const ext = extensionFromName(name);
    const mime = String(mimeType || '').toLowerCase();
    if (IMAGE_EXT.has(ext) || mime.startsWith('image/')) return 'image';
    if (DOCUMENT_EXT.has(ext) || mime.includes('pdf') || mime.includes('msword') || mime.includes('document') || mime === 'text/plain') {
      return 'document';
    }
    if (mime.startsWith('audio/')) return 'audio';
    if (mime.startsWith('video/')) return 'video';
    return 'other';
  }

  function maxBytesForFile(name, mimeType) {
    const category = resolveCategory(name, mimeType);
    const map = {
      image: LIMITS.MAX_FILE_SIZE_IMAGE,
      audio: LIMITS.MAX_FILE_SIZE_AUDIO,
      video: LIMITS.MAX_FILE_SIZE_VIDEO,
      document: LIMITS.MAX_FILE_SIZE_DOCUMENT,
      other: LIMITS.MAX_FILE_SIZE_OTHER
    };
    return { category, maxBytes: map[category] || LIMITS.MAX_FILE_SIZE_OTHER };
  }

  function inferMimeType(file) {
    const type = String(file?.type || '').toLowerCase();
    if (type && ALLOWED_MIME.has(type)) return type;
    const ext = extensionFromName(file?.name);
    return EXT_TO_MIME[ext] || 'application/octet-stream';
  }

  function formatSize(bytes) {
    const n = Number(bytes) || 0;
    if (n < 1024) return `${n} B`;
    if (n < 1024 * 1024) return `${(n / 1024).toFixed(1)} KB`;
    return `${(n / (1024 * 1024)).toFixed(1)} MB`;
  }

  function statusLabel(status) {
    return STATUS_LABELS[status] || status || '—';
  }

  function validateFile(file, currentCount = 0) {
    if (!file) return 'Arquivo inválido.';
    if (currentCount >= MAX_COUNT) {
      return `Máximo de ${MAX_COUNT} anexos por relato.`;
    }
    if (file.size <= 0) return 'Arquivo vazio não é permitido.';

    const ext = extensionFromName(file.name);
    if (!ext || !ALLOWED_EXTENSIONS.has(ext)) {
      return 'Tipo não permitido. Use imagens (PNG, JPG, WEBP, GIF), PDF, DOC, DOCX ou TXT.';
    }

    const mime = inferMimeType(file);
    if (file.type && !ALLOWED_MIME.has(file.type) && mime === 'application/octet-stream') {
      return 'Tipo de arquivo não reconhecido ou não permitido.';
    }

    const { category, maxBytes } = maxBytesForFile(file.name, mime);
    if (file.size > maxBytes) {
      return `Arquivo muito grande para ${category}. Máximo: ${formatSize(maxBytes)}.`;
    }
    if (file.size > MAX_BYTES) {
      return `Arquivo muito grande. Máximo: ${formatSize(MAX_BYTES)}.`;
    }

    return null;
  }

  /** Metadados locais antes do envio (sem id definitivo). */
  function createPendingMetadata(file) {
    const ext = extensionFromName(file.name);
    return {
      name: String(file.name || 'arquivo').trim(),
      size: Number(file.size) || 0,
      mimeType: inferMimeType(file),
      ext
    };
  }

  /** Whitelist ao receber payload — descarta URLs, blobs e storageKey. */
  function sanitizeIncoming(raw) {
    if (!raw || typeof raw !== 'object') return null;
    const name = String(raw.name || '').trim();
    const size = Number(raw.size) || 0;
    const ext = extensionFromName(name);
    if (!name || size <= 0 || !ALLOWED_EXTENSIONS.has(ext)) return null;

    const mimeType = String(raw.mimeType || EXT_TO_MIME[ext] || 'application/octet-stream');
    const safeMime = ALLOWED_MIME.has(mimeType) ? mimeType : EXT_TO_MIME[ext] || 'application/octet-stream';

    return { name, size, mimeType: safeMime, ext };
  }

  function sanitizeList(list, max = MAX_COUNT) {
    if (!Array.isArray(list)) return [];
    const out = [];
    for (const item of list) {
      if (out.length >= max) break;
      const safe = sanitizeIncoming(item);
      if (safe) out.push(safe);
    }
    return out;
  }

  /** Atribui ids e status ao persistir relato (protótipo). */
  function finalizeForReport(reportId, list) {
    const now = new Date().toISOString();
    return sanitizeList(list).map((item) => ({
      id: uid(),
      reportId,
      name: item.name,
      size: item.size,
      mimeType: item.mimeType,
      ext: item.ext,
      status: 'simulated',
      createdAt: now
    }));
  }

  /** Normaliza anexo já armazenado (migração / leitura). */
  function normalizeStored(raw, reportId = null) {
    if (!raw || typeof raw !== 'object') return null;
    const name = String(raw.name || '').trim();
    if (!name) return null;

    const ext = raw.ext || extensionFromName(name);
    const size = Number(raw.size) || 0;
    const mimeType = String(raw.mimeType || EXT_TO_MIME[ext] || 'application/octet-stream');

    const normalized = {
      id: raw.id || uid(),
      reportId: raw.reportId || reportId || null,
      name,
      size,
      mimeType: ALLOWED_MIME.has(mimeType) ? mimeType : EXT_TO_MIME[ext] || mimeType,
      ext,
      status: raw.status || 'simulated',
      createdAt: raw.createdAt || new Date().toISOString()
    };
    if (raw.sha256 && typeof raw.sha256 === 'string') {
      normalized.sha256 = raw.sha256;
    }

    BLOCKED_STORE_KEYS.forEach((key) => {
      if (key in normalized) delete normalized[key];
    });

    return normalized;
  }

  function normalizeReportList(reportId, list) {
    if (!Array.isArray(list)) return [];
    return list.map((a) => normalizeStored(a, reportId)).filter(Boolean);
  }

  function addFilesToSelection(files, current = []) {
    const next = [...current];
    const errors = [];

    [...files].forEach((file) => {
      const err = validateFile(file, next.length);
      if (err) {
        errors.push(`${file.name}: ${err}`);
        return;
      }
      const dup = next.some((a) => a.name === file.name && a.size === file.size);
      if (dup) {
        errors.push(`${file.name}: arquivo já adicionado.`);
        return;
      }
      next.push(createPendingMetadata(file));
    });

    return { items: next, errors };
  }

  function removeAt(items, index) {
    const next = [...items];
    next.splice(index, 1);
    return next;
  }

  function renderFileListHtml(items, escapeHtml) {
    const esc = escapeHtml || ((s) => String(s));
    if (!items.length) return '';
    return items
      .map(
        (f, i) => `
      <div class="file-item">
        <span>${esc(f.name)} <span class="text-muted">(${formatSize(f.size)})</span></span>
        <button type="button" class="btn btn-ghost btn-sm" data-rm="${i}">Remover</button>
      </div>`
      )
      .join('');
  }

  function bindFileList(container, items, onChange) {
    if (!container) return;
    container.innerHTML = renderFileListHtml(items, window.CSApp?.escapeHtml);
    container.querySelectorAll('[data-rm]').forEach((btn) => {
      btn.addEventListener('click', () => {
        const idx = Number(btn.dataset.rm);
        onChange(removeAt(items, idx));
      });
    });
  }

  function storageBand(percentUsed, options = {}) {
    const p = Number(percentUsed) || 0;
    const overLimit = Boolean(options.overLimit);
    const thresholds = LIMITS.STORAGE_ALERT_THRESHOLDS || [70, 85, 95, 100];
    if (overLimit || p > 100) return { id: 'critico', label: 'Crítico' };
    if (p >= (thresholds[3] ?? 100)) return { id: 'bloqueio', label: 'Bloqueio' };
    if (p >= (thresholds[2] ?? 95)) return { id: 'critico', label: 'Crítico' };
    if (p >= (thresholds[1] ?? 85)) return { id: 'alerta', label: 'Alerta' };
    if (p >= (thresholds[0] ?? 70)) return { id: 'atencao', label: 'Atenção' };
    return { id: 'normal', label: 'Normal' };
  }

  function limitsHintHtml(escapeHtml) {
    const esc = escapeHtml || ((s) => String(s));
    return `Tamanho máximo: imagens ${esc(formatSize(LIMITS.MAX_FILE_SIZE_IMAGE))}, documentos ${esc(formatSize(LIMITS.MAX_FILE_SIZE_DOCUMENT))} · até ${LIMITS.MAX_ATTACHMENTS_PER_REPORT} anexos por relato.`;
  }

  function storageHintHtml(storageUsage, escapeHtml) {
    if (!storageUsage || typeof storageUsage.storageLimitBytes !== 'number') return '';
    const esc = escapeHtml || ((s) => String(s));
    const used = Number(storageUsage.storageUsedBytes) || 0;
    const limit = Number(storageUsage.storageLimitBytes) || 0;
    const available = Math.max(0, limit - used);
    const pct = storageUsage.storagePercent != null ? storageUsage.storagePercent : 0;
    const overLimit = Boolean(storageUsage.overLimit) || used > limit;
    const band = storageBand(pct, { overLimit });
    const critical =
      overLimit || band.id === 'critico' || band.id === 'bloqueio'
        ? ` · <strong>${esc(band.label)}</strong> — novos uploads bloqueados enquanto o uso superar o limite.`
        : '';
    return `Espaço disponível: ${esc(formatSize(available))} de ${esc(formatSize(limit))} (${esc(String(pct))}% usado).${critical}`;
  }

  function renderAdminPanelHtml(attachments, escapeHtml, options = {}) {
    const esc = escapeHtml || ((s) => String(s));
    const list = Array.isArray(attachments) ? attachments : [];
    const httpActive = Boolean(options.httpActive);
    const storageUsage = options.storageUsage || null;

    const limitsLine = limitsHintHtml(esc);
    const storageLine = storageHintHtml(storageUsage, esc);

    const uploadBlock = httpActive
      ? `
      <div class="attachment-upload mt-2" style="margin-top:.75rem">
        <label class="btn btn-outline btn-sm" style="cursor:pointer;display:inline-block">
          Enviar anexo
          <input type="file" id="attachmentUploadInput" accept=".pdf,.doc,.docx,.txt,.png,.jpg,.jpeg,.gif,.webp,application/pdf,image/*" hidden />
        </label>
        <span class="text-muted" id="attachmentUploadStatus" style="font-size:.85rem;margin-left:.5rem"></span>
      </div>`
      : `<p class="hint mt-2">Modo protótipo: download/upload binário indisponível sem API. Relato público continua só com metadados.</p>`;

    const listHtml = !list.length
      ? '<p class="text-muted">Nenhum anexo armazenado neste relato.</p>'
      : `
      <div class="attachment-admin-list">
        ${list
          .map(
            (a) => `
          <div class="attachment-admin-item file-item" data-attachment-id="${esc(a.id)}">
            <div>
              <strong>${esc(a.name)}</strong>
              <div class="text-muted" style="font-size:.85rem">
                ${esc(formatSize(a.size))} · ${esc(a.mimeType || '—')} · ${esc(statusLabel(a.status))}
              </div>
              <div class="text-muted" style="font-size:.8rem">ID: ${esc(a.id)}</div>
            </div>
            <button type="button" class="btn btn-outline btn-sm" data-dl="${esc(a.id)}" ${
              a.status === 'simulated' ? 'disabled title="Anexo simulado sem binário"' : 'title="Download autenticado"'
            }>
              ${a.status === 'simulated' ? 'Indisponível' : 'Download'}
            </button>
          </div>`
          )
          .join('')}
      </div>`;

    return `
      <p class="hint" style="margin-top:0">${limitsLine}</p>
      ${storageLine ? `<p class="hint" style="margin-top:.35rem">${storageLine}</p>` : ''}
      ${listHtml}
      ${uploadBlock}
      <p class="hint mt-2">Download via rota autenticada. Sem URL pública permanente.</p>`;
  }

  function bindAdminPanel(container, attachments, actor, onRefresh, reportId = null) {
    if (!container) return;

    container.querySelectorAll('[data-dl]').forEach((btn) => {
      btn.addEventListener('click', async () => {
        const attachmentId = btn.dataset.dl;
        try {
          const result = await CSApi.requestAttachmentDownload(attachmentId, actor, reportId);
          if (result.ok && result.blob) {
            const url = URL.createObjectURL(result.blob);
            const a = document.createElement('a');
            a.href = url;
            a.download = result.filename || 'anexo';
            document.body.appendChild(a);
            a.click();
            a.remove();
            URL.revokeObjectURL(url);
            CSApp.toast(result.message || 'Download iniciado.', 'success');
          } else {
            CSApp.toast(result.message || 'Download indisponível no protótipo.', result.ok ? 'success' : 'info');
          }
          if (onRefresh) onRefresh();
        } catch (ex) {
          CSApp.toast(CSErrors.userMessage(ex, CSErrors.ACTION_FALLBACK), 'error');
        }
      });
    });

    const input = container.querySelector('#attachmentUploadInput');
    if (input && reportId) {
      input.addEventListener('change', async () => {
        const files = input.files ? [...input.files] : [];
        input.value = '';
        if (!files.length) return;
        const statusEl = container.querySelector('#attachmentUploadStatus');
        if (statusEl) statusEl.textContent = 'Enviando…';
        try {
          await CSApi.uploadReportAttachment(reportId, files, actor, {
            currentCount: Array.isArray(attachments) ? attachments.length : 0
          });
          CSApp.toast('Anexo enviado.', 'success');
          if (onRefresh) onRefresh();
        } catch (ex) {
          CSApp.toast(CSErrors.userMessage(ex, 'Não foi possível enviar o anexo.'), 'error');
          if (statusEl) statusEl.textContent = '';
        }
      });
    }
  }

  /**
   * Futuro: POST multipart para storage privado + scan antivírus.
   * Protótipo: retorna metadados simulados.
   */
  async function simulateUpload(reportId, files) {
    const { items, errors } = addFilesToSelection(files, []);
    if (errors.length) {
      throw new Error(errors.join(' '));
    }
    return finalizeForReport(reportId, items);
  }

  return {
    LIMITS,
    STORAGE_PLANS,
    MAX_COUNT,
    MAX_BYTES,
    MAX_ATTACHMENTS_PER_REPORT: LIMITS.MAX_ATTACHMENTS_PER_REPORT,
    ALLOWED_EXTENSIONS,
    validateFile,
    maxBytesForFile,
    resolveCategory,
    createPendingMetadata,
    sanitizeIncoming,
    sanitizeList,
    finalizeForReport,
    normalizeStored,
    normalizeReportList,
    addFilesToSelection,
    removeAt,
    formatSize,
    statusLabel,
    storageBand,
    renderFileListHtml,
    bindFileList,
    limitsHintHtml,
    storageHintHtml,
    renderAdminPanelHtml,
    bindAdminPanel,
    simulateUpload
  };
})();

window.CSAttachments = CSAttachments;
