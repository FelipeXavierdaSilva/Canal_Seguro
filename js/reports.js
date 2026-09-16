/**
 * reports.js – Helpers de relatos / protocolo
 */

const CSReports = (() => {
  function statusClass(status) {
    const map = {
      recebido: 'status-recebido',
      analise: 'status-analise',
      apuracao: 'status-apuracao',
      acompanhamento: 'status-acompanhamento',
      concluido: 'status-concluido'
    };
    return map[status] || '';
  }

  function formatDate(iso) {
    if (!iso) return '—';
    const d = new Date(iso);
    if (Number.isNaN(d.getTime())) return iso;
    return d.toLocaleDateString('pt-BR', {
      day: '2-digit',
      month: '2-digit',
      year: 'numeric'
    });
  }

  function formatDateTime(iso) {
    if (!iso) return '—';
    const d = new Date(iso);
    if (Number.isNaN(d.getTime())) return iso;
    return d.toLocaleString('pt-BR', {
      day: '2-digit',
      month: '2-digit',
      year: 'numeric',
      hour: '2-digit',
      minute: '2-digit'
    });
  }

  /** Data/hora da ocorrência informada no relato (pode ser só data YYYY-MM-DD). */
  function formatOccurrence(dateApprox, timeApprox) {
    const datePart = String(dateApprox || '').trim();
    const timePart = String(timeApprox || '').trim();
    if (!datePart && !timePart) return '—';
    let formattedDate = datePart;
    if (/^\d{4}-\d{2}-\d{2}$/.test(datePart)) {
      formattedDate = formatDate(datePart + 'T12:00:00');
    }
    if (timePart) return `${formattedDate} ${timePart}`.trim();
    return formattedDate || '—';
  }

  function timelineStates(currentStatus) {
    const order = ['recebido', 'analise', 'apuracao', 'acompanhamento', 'concluido'];
    const idx = order.indexOf(currentStatus);
    return order.map((id, i) => ({
      id,
      label: CSApi.statusLabel(id),
      state: i < idx ? 'done' : i === idx ? 'active' : ''
    }));
  }

  function renderTimeline(container, currentStatus, meta = {}) {
    if (!container) return;
    const steps = timelineStates(currentStatus);
    container.innerHTML = steps
      .map(
        (s) => `
      <div class="timeline__item ${s.state}">
        <div class="timeline__dot"></div>
        <div class="timeline__label">${s.label}</div>
        ${
          s.state === 'active' && meta.updatedAt
            ? `<div class="timeline__meta">Atualizado em ${formatDateTime(meta.updatedAt)}</div>`
            : s.id === 'recebido' && meta.createdAt
              ? `<div class="timeline__meta">Registrado em ${formatDateTime(meta.createdAt)}</div>`
              : ''
        }
      </div>`
      )
      .join('');
  }

  async function copyText(text, successMessage) {
    try {
      await navigator.clipboard.writeText(text);
      CSApp.toast(successMessage, 'success');
    } catch {
      const ta = document.createElement('textarea');
      ta.value = text;
      document.body.appendChild(ta);
      ta.select();
      document.execCommand('copy');
      ta.remove();
      CSApp.toast(successMessage, 'success');
    }
  }

  async function copyProtocol(protocol) {
    await copyText(protocol, 'Protocolo copiado.');
  }

  async function copyTrackingCode(code) {
    if (!code) return;
    await copyText(code, 'Código de acompanhamento copiado.');
  }

  function riskClass(level) {
    const map = {
      low: 'risk-pill--low',
      moderate: 'risk-pill--moderate',
      high: 'risk-pill--high',
      critical: 'risk-pill--critical'
    };
    return map[level] || 'risk-pill--none';
  }

  function riskLabel(level) {
    const map = {
      low: 'Baixo',
      moderate: 'Moderado',
      high: 'Alto',
      critical: 'Crítico'
    };
    return level ? map[level] || level : 'Não classificado';
  }

  function riskPillHtml(level, esc = (s) => s) {
    const label = riskLabel(level);
  const cls = riskClass(level);
    return `<span class="risk-pill ${cls}">${esc(label)}</span>`;
  }

  const WORKFLOW_STAGE_LABELS = {
    recebido: 'Recebido',
    triagem: 'Triagem',
    classificacao_risco: 'Classificação de risco',
    responsavel_definido: 'Responsável definido',
    em_apuracao: 'Em apuração',
    aguardando_informacoes: 'Aguardando informações',
    analise_parecer: 'Análise / parecer',
    medidas_adotadas: 'Medidas adotadas',
    concluido: 'Concluído'
  };

  function workflowStageLabel(stage) {
    return stage ? WORKFLOW_STAGE_LABELS[stage] || stage : '—';
  }

  function priorityLabel(priority) {
    const map = { normal: 'Normal', alta: 'Alta', urgente: 'Urgente' };
    return map[priority] || 'Normal';
  }

  function priorityClass(priority) {
    const map = { normal: 'priority-pill--normal', alta: 'priority-pill--alta', urgente: 'priority-pill--urgente' };
    return map[priority] || 'priority-pill--normal';
  }

  function priorityPillHtml(priority, esc = (s) => s) {
    return `<span class="priority-pill ${priorityClass(priority)}">${esc(priorityLabel(priority))}</span>`;
  }

  return {
    statusClass,
    formatDate,
    formatDateTime,
    formatOccurrence,
    timelineStates,
    renderTimeline,
    copyProtocol,
    copyTrackingCode,
    riskClass,
    riskLabel,
    riskPillHtml,
    workflowStageLabel,
    priorityLabel,
    priorityPillHtml
  };
})();

window.CSReports = CSReports;
