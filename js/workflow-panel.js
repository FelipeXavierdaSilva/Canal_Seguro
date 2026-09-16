/**
 * workflow-panel.js – Painel de fluxo de apuração (Etapa 09)
 */

const CSWorkflowPanel = (() => {
  function milestonesHtml(timeline, esc) {
    if (!timeline?.length) {
      return '<p class="text-muted">Timeline indisponível.</p>';
    }
    return `<div class="workflow-milestones">${timeline
      .map(
        (m) => `
      <div class="workflow-milestone workflow-milestone--${m.state || 'pending'}">
        <div class="workflow-milestone__dot"></div>
        <div class="workflow-milestone__body">
          <div class="workflow-milestone__label">${esc(m.label)}</div>
          ${
            m.date
              ? `<div class="workflow-milestone__meta">${CSReports.formatDateTime(m.date)}${m.responsible ? ` · ${esc(m.responsible)}` : ''}${m.durationLabel && m.durationLabel !== '—' ? ` · ${esc(m.durationLabel)}` : ''}</div>`
              : ''
          }
          ${m.note ? `<div class="workflow-milestone__note">${esc(m.note)}</div>` : ''}
        </div>
      </div>`
      )
      .join('')}</div>`;
  }

  function panelHtml(report, workflowState, timeline, esc) {
    const current = workflowState?.current || {};
    const transitions = workflowState?.allowedTransitions || [];
    return `
      <div class="panel mb-2" id="workflowPanel">
        <div class="panel__header">
          <h3>Fluxo de apuração</h3>
          ${CSReports.priorityPillHtml(current.priority || report.priority, esc)}
          ${current.slaStatus === 'overdue' ? '<span class="badge badge--accent">SLA vencido</span>' : ''}
          ${current.slaStatus === 'warning' ? '<span class="badge">SLA próximo</span>' : ''}
        </div>
        <div class="panel__body">
          <div class="detail-field mb-2">
            <div class="detail-field__label">Etapa atual</div>
            <div class="detail-field__value">${esc(current.label || CSReports.workflowStageLabel(report.workflowStage))}</div>
          </div>
          ${milestonesHtml(timeline, esc)}
          ${
            transitions.length
              ? `<div class="form-group mt-2">
            <label for="workflowStage">Avançar etapa</label>
            <select id="workflowStage" class="form-control">
              <option value="">Selecionar etapa</option>
              ${transitions
                .map(
                  (t) =>
                    `<option value="${esc(t.stage)}">${esc(t.label)}${t.isBackward ? ' (retrocesso)' : ''}</option>`
                )
                .join('')}
            </select>
          </div>
          <div class="form-group">
            <label for="workflowJustification">Justificativa</label>
            <textarea id="workflowJustification" class="form-control" rows="2" placeholder="Obrigatória em retrocesso, conclusão ou saltos"></textarea>
          </div>
          <div class="form-group">
            <label for="workflowPriority">Prioridade operacional</label>
            <select id="workflowPriority" class="form-control">
              <option value="normal" ${(current.priority || report.priority) === 'normal' ? 'selected' : ''}>Normal</option>
              <option value="alta" ${(current.priority || report.priority) === 'alta' ? 'selected' : ''}>Alta</option>
              <option value="urgente" ${(current.priority || report.priority) === 'urgente' ? 'selected' : ''}>Urgente</option>
            </select>
          </div>
          <div class="form-group hidden" id="workflowMeasuresGroup">
            <label for="workflowMeasures">Medidas adotadas</label>
            <textarea id="workflowMeasures" class="form-control" rows="3" placeholder="Registre as medidas adotadas (incluído no PDF de apuração)"></textarea>
          </div>
          <div class="form-group hidden" id="workflowConclusionGroup">
            <label for="workflowConclusion">Resumo da conclusão</label>
            <textarea id="workflowConclusion" class="form-control" rows="3" placeholder="Resumo da conclusão do relato"></textarea>
          </div>
          <div class="flex gap-1 flex-wrap">
            <button type="button" class="btn btn-primary btn-sm" id="btnWorkflowTransition">Aplicar etapa</button>
            <button type="button" class="btn btn-outline btn-sm" id="btnWorkflowPriority">Salvar prioridade</button>
          </div>`
              : '<p class="text-muted">Nenhuma transição disponível nesta etapa.</p>'
          }
          <h4 style="font-size:.9rem;margin:1rem 0 .5rem">Histórico de etapas</h4>
          <div class="history-list">
            ${
              (workflowState?.history || []).length
                ? workflowState.history
                    .slice()
                    .reverse()
                    .map(
                      (h) => `<div class="history-item">
                <div class="history-item__meta">${CSReports.formatDateTime(h.createdAt)} · ${esc(h.changedByUserName)}</div>
                <div>${esc(h.previousStageLabel ? `${h.previousStageLabel} → ${h.newStageLabel}` : h.newStageLabel)}</div>
                ${h.justification ? `<div class="text-muted" style="font-size:.85rem">${esc(h.justification)}</div>` : ''}
              </div>`
                    )
                    .join('')
                : '<p class="text-muted">Sem transições registradas.</p>'
            }
          </div>
        </div>
      </div>`;
  }

  function bind(container, reportId, actor, refresh) {
    const stageSel = document.getElementById('workflowStage');
    const measuresGroup = document.getElementById('workflowMeasuresGroup');
    const conclusionGroup = document.getElementById('workflowConclusionGroup');

    function toggleWorkflowExtras() {
      const stage = stageSel?.value || '';
      if (measuresGroup) measuresGroup.classList.toggle('hidden', stage !== 'medidas_adotadas' && stage !== 'concluido');
      if (conclusionGroup) conclusionGroup.classList.toggle('hidden', stage !== 'concluido');
    }
    stageSel?.addEventListener('change', toggleWorkflowExtras);
    toggleWorkflowExtras();

    document.getElementById('btnWorkflowTransition')?.addEventListener('click', async () => {
      const stage = document.getElementById('workflowStage')?.value;
      const justification = document.getElementById('workflowJustification')?.value || '';
      const measuresAdopted = document.getElementById('workflowMeasures')?.value || '';
      const conclusionSummary = document.getElementById('workflowConclusion')?.value || '';
      if (!stage) {
        CSApp.toast('Selecione uma etapa.', 'warning');
        return;
      }
      try {
        await CSApi.transitionReportWorkflow(
          reportId,
          { stage, justification, measuresAdopted, conclusionSummary },
          actor
        );
        CSApp.toast('Etapa atualizada.', 'success');
        await refresh();
      } catch (err) {
        CSApp.toast(CSErrors.userMessage(err), 'error');
      }
    });

    document.getElementById('btnWorkflowPriority')?.addEventListener('click', async () => {
      const priority = document.getElementById('workflowPriority')?.value;
      try {
        await CSApi.updateReportWorkflowMeta(reportId, { priority }, actor);
        CSApp.toast('Prioridade atualizada.', 'success');
        await refresh();
      } catch (err) {
        CSApp.toast(CSErrors.userMessage(err), 'error');
      }
    });
  }

  return { panelHtml, bind };
})();

window.CSWorkflowPanel = CSWorkflowPanel;
