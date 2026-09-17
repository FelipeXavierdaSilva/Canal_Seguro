/**
 * Espaço de apuração do relato — fluxo progressivo em abas (case file).
 */
const CSReportCaseWorkspace = (() => {
  const STEPS = [
    { id: 'leitura', label: 'Leitura', hint: 'Entenda o relato' },
    { id: 'triagem', label: 'Triagem', hint: 'Risco e responsável' },
    { id: 'comunicacao', label: 'Comunicação', hint: 'Fale com o denunciante' },
    { id: 'apuracao', label: 'Apuração', hint: 'Medidas e registros' },
    { id: 'conclusao', label: 'Conclusão', hint: 'Status e fechamento' }
  ];

  function stepProgress(report) {
    const hasRisk = Boolean(report.riskLevel);
    const hasAssignee = Boolean(report.assigneeId);
    const hasMeasures =
      (Array.isArray(report.measuresLog) && report.measuresLog.length > 0) ||
      Boolean(report.measuresAdopted);
    const concluded = report.status === 'concluido';
    const done = {
      leitura: true,
      triagem: hasRisk && hasAssignee,
      comunicacao: hasRisk,
      apuracao: hasMeasures || concluded,
      conclusao: concluded
    };
    // Progressive unlock: next opens when previous required is done
    let max = 0;
    if (done.leitura) max = 1;
    if (hasRisk) max = 3; // comunicação e apuração liberadas após risco
    if (hasRisk && hasAssignee) max = 4;
    if (concluded) max = 4;
    return { done, maxIndex: max, hasRisk, hasAssignee, hasMeasures, concluded };
  }

  function initialStepId(report) {
    const { done, concluded } = stepProgress(report);
    if (concluded) return 'conclusao';
    if (!done.triagem) return report.riskLevel || report.assigneeId ? 'triagem' : 'leitura';
    if (!done.apuracao) return 'apuracao';
    return 'conclusao';
  }

  function measuresBlock(report, esc) {
    if (Array.isArray(report.measuresLog) && report.measuresLog.length) {
      return `<div class="history-list mb-2">${[...report.measuresLog]
        .slice()
        .reverse()
        .map((m) => {
          const typeLabel = m.type === 'medida_adotada' ? 'Medida adotada' : 'Ação executada';
          const when = m.executedAt
            ? CSReports.formatDateTime(m.executedAt)
            : CSReports.formatDateTime(m.createdAt);
          return `<div class="history-item">
            <div class="history-item__meta">${esc(when)} · ${esc(m.userName || '—')} · <strong>${esc(typeLabel)}</strong></div>
            <div>${esc(m.text || '')}</div>
          </div>`;
        })
        .join('')}</div>`;
    }
    if (report.measuresAdopted) {
      return `<div class="callout mb-2"><p style="margin:0;white-space:pre-wrap">${esc(report.measuresAdopted)}</p></div>`;
    }
    return '<p class="text-muted mb-2">Nenhuma medida ou ação registrada ainda.</p>';
  }

  function buildHtml(ctx) {
    const {
      report,
      company,
      actor,
      history,
      threadData,
      riskPolicy,
      riskHistory,
      statuses,
      users,
      attachmentsHtml,
      canCritical,
      canAssign,
      esc
    } = ctx;

    const progress = stepProgress(report);
    const startStep = initialStepId(report);
    const startIdx = Math.max(
      0,
      STEPS.findIndex((s) => s.id === startStep)
    );
    const pct = Math.round(((progress.concluded ? 5 : startIdx + (progress.done[STEPS[startIdx]?.id] ? 1 : 0)) / 5) * 100);
    const backHref = location.pathname;
    const assigneeName =
      (users || []).find((u) => u.id === report.assigneeId)?.nome || report.assigneeId || '—';

    const tabs = STEPS.map((step, i) => {
      const locked = i > progress.maxIndex;
      const isDone = progress.done[step.id];
      const isCurrent = step.id === startStep;
      return `<button type="button" class="case-flow__tab${isCurrent ? ' is-active' : ''}${isDone ? ' is-done' : ''}${locked ? ' is-locked' : ''}"
        data-case-step="${step.id}" data-step-index="${i}" ${locked ? 'aria-disabled="true"' : ''}
        title="${esc(locked ? 'Conclua a etapa anterior para avançar' : step.hint)}">
        <span class="case-flow__tab-num" aria-hidden="true">${isDone && !isCurrent ? '✓' : i + 1}</span>
        <span class="case-flow__tab-text">
          <strong>${esc(step.label)}</strong>
          <small>${esc(step.hint)}</small>
        </span>
      </button>`;
    }).join('');

    return `
    <div class="case-workspace" data-case-workspace data-max-step="${progress.maxIndex}" data-start-step="${esc(startStep)}">
      <div class="page-header case-workspace__header">
        <div class="page-header__lead">
          <a class="btn-back" href="${backHref}" title="Voltar à lista" aria-label="Voltar à lista de relatos">
            <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.2" aria-hidden="true"><path d="M15 18l-6-6 6-6"/></svg>
          </a>
          <div>
            <p class="case-workspace__kicker">Ficha de apuração</p>
            <h1>${esc(report.protocol)}</h1>
            <p>${company ? esc(company.nomeFantasia) : ''} · ${CSReports.formatDateTime(report.createdAt)}</p>
          </div>
        </div>
        <div class="flex gap-1 flex-wrap case-workspace__meta">
          ${
            typeof CSExportUI !== 'undefined' && CSExportUI.canExportReport(actor)
              ? `<button type="button" class="btn btn-outline btn-sm" id="btnExportIndividual">PDF individual</button>
          <button type="button" class="btn btn-outline btn-sm" id="btnExportInvestigation">PDF apuração</button>`
              : ''
          }
        </div>
      </div>

      <div class="panel case-flow">
        <div class="case-flow__progress" aria-hidden="true">
          <div class="case-flow__progress-bar" style="width:${pct}%"></div>
        </div>
        <div class="case-flow__tabs" role="tablist" aria-label="Etapas da apuração">${tabs}</div>
        <p class="case-flow__guide" data-case-guide>
          Siga as etapas em ordem. Você pode voltar a qualquer momento; avançar exige concluir o essencial da etapa atual.
        </p>

        <div class="case-flow__panels">
          <!-- 1. Leitura -->
          <section class="case-flow__panel${startStep === 'leitura' ? ' is-active' : ''}" data-case-panel="leitura" role="tabpanel">
            <div class="case-flow__panel-head">
              <h2>Leitura do relato</h2>
              <p>Conheça os fatos, anexos e o comunicante antes de classificar ou encaminhar.</p>
            </div>
            <div class="case-flow__split">
              <div>
                <h3 class="case-flow__section-title">Dados do relato</h3>
                <div class="detail-field"><div class="detail-field__label">Categoria</div><div class="detail-field__value">${esc(CSApi.categoryLabel(report.category))}</div></div>
                <div class="detail-field"><div class="detail-field__label">Data da ocorrência</div><div class="detail-field__value">${esc(CSReports.formatOccurrence(report.dateApprox, report.timeApprox))}</div></div>
                <div class="detail-field"><div class="detail-field__label">Local</div><div class="detail-field__value">${esc(report.location || '—')}</div></div>
                <div class="detail-field"><div class="detail-field__label">Setor</div><div class="detail-field__value">${esc(report.sector || '—')}</div></div>
                <div class="detail-field"><div class="detail-field__label">Envolvidos</div><div class="detail-field__value">${esc(report.involved || '—')}</div></div>
                <div class="detail-field"><div class="detail-field__label">Descrição</div><div class="detail-field__value">${esc(report.description || '')}</div></div>
                <div class="detail-field"><div class="detail-field__label">Testemunhas</div><div class="detail-field__value">${esc(report.witnesses || 'Não informado')}</div></div>
              </div>
              <div>
                <h3 class="case-flow__section-title">Comunicante</h3>
                ${
                  report.isAnonymous
                    ? '<p class="text-muted">Relato anônimo. O colaborador foi validado por CPF no acesso, porém optou por não exibir identificação neste relato.</p>'
                    : `<div class="detail-field"><div class="detail-field__label">Nome</div><div class="detail-field__value">${esc(report.reporter?.nome || '—')}</div></div>
                       <div class="detail-field"><div class="detail-field__label">E-mail</div><div class="detail-field__value">${esc(report.reporter?.email || '—')}</div></div>
                       <div class="detail-field"><div class="detail-field__label">Telefone</div><div class="detail-field__value">${esc(report.reporter?.telefone || '—')}</div></div>
                       <div class="detail-field"><div class="detail-field__label">Cargo / Setor</div><div class="detail-field__value">${esc(report.reporter?.cargo || '—')} / ${esc(report.reporter?.setor || '—')}</div></div>`
                }
                ${
                  report.wantUpdates
                    ? `<div class="callout mt-2"><p>Deseja retorno: Sim · ${esc(report.contactEmail || report.contactPhone || '')}</p></div>`
                    : '<p class="text-muted mt-2">Não solicitou retorno sobre o andamento.</p>'
                }
                <h3 class="case-flow__section-title mt-2">Anexos</h3>
                <div id="attachmentsPanel">${attachmentsHtml}</div>
              </div>
            </div>
          </section>

          <!-- 2. Triagem -->
          <section class="case-flow__panel${startStep === 'triagem' ? ' is-active' : ''}" data-case-panel="triagem" role="tabpanel">
            <div class="case-flow__panel-head">
              <h2>Triagem</h2>
              <p>Classifique o risco e defina o responsável. Sem isso, a apuração não avança com segurança.</p>
            </div>
            <div class="case-flow__checklist">
              <span class="case-chip ${progress.hasRisk ? 'is-ok' : ''}">${progress.hasRisk ? '✓' : '1'} Risco</span>
              <span class="case-chip ${progress.hasAssignee ? 'is-ok' : ''}">${progress.hasAssignee ? '✓' : '2'} Responsável</span>
            </div>
            <div class="case-flow__split">
              <div>
                <h3 class="case-flow__section-title">Classificação de risco ${report.riskLevel === 'critical' ? '<span class="badge badge--accent">Crítico</span>' : ''}</h3>
                <p class="text-muted" style="font-size:.85rem;margin-top:0">Decisão do responsável autorizado. A sugestão do sistema é apenas auxiliar.</p>
                <div class="detail-field mb-2">
                  <div class="detail-field__label">Nível atual</div>
                  <div class="detail-field__value">${CSReports.riskPillHtml(report.riskLevel, esc)}</div>
                </div>
                ${
                  report.riskClassifiedAt
                    ? `<p class="text-muted" style="font-size:.85rem">Classificado em ${CSReports.formatDateTime(report.riskClassifiedAt)}</p>`
                    : ''
                }
                <div class="form-group">
                  <label for="riskLevel">Nível</label>
                  <select id="riskLevel" class="form-control">
                    <option value="">Selecionar</option>
                    <option value="low" ${report.riskLevel === 'low' ? 'selected' : ''}>🟢 Baixo</option>
                    <option value="moderate" ${report.riskLevel === 'moderate' ? 'selected' : ''}>🟡 Moderado</option>
                    <option value="high" ${report.riskLevel === 'high' ? 'selected' : ''}>🟠 Alto</option>
                    ${canCritical ? `<option value="critical" ${report.riskLevel === 'critical' ? 'selected' : ''}>🔴 Crítico</option>` : ''}
                  </select>
                </div>
                <div class="form-group">
                  <label>Fatores identificados</label>
                  <div class="risk-factors-grid" id="riskFactors">
                    ${(riskPolicy.factors || [])
                      .map(
                        (f) =>
                          `<label class="risk-factor-check"><input type="checkbox" name="riskFactor" value="${esc(f.id)}" /> ${esc(f.label)}</label>`
                      )
                      .join('')}
                  </div>
                </div>
                <div class="form-group">
                  <label for="riskJustification">Justificativa</label>
                  <textarea id="riskJustification" class="form-control" rows="3" placeholder="Obrigatória para registrar a classificação"></textarea>
                </div>
                <div id="riskSuggestionBox" class="callout hidden" style="font-size:.85rem"></div>
                <div class="flex gap-1 flex-wrap mb-2">
                  <button type="button" class="btn btn-outline btn-sm" id="btnRiskSuggest">Ver sugestão auxiliar</button>
                  <button type="button" class="btn btn-primary btn-sm" id="btnRiskClassify">${report.riskLevel ? 'Reclassificar' : 'Classificar'}</button>
                </div>
                <h4 style="font-size:.9rem;margin:1rem 0 .5rem">Histórico de classificação</h4>
                <div class="history-list">
                  ${
                    riskHistory.length
                      ? riskHistory
                          .map(
                            (h) => `<div class="history-item">
                    <div class="history-item__meta">${CSReports.formatDateTime(h.createdAt)} · ${esc(h.classifiedByUserName)}</div>
                    <div>${esc(h.previousLevelLabel ? `${h.previousLevelLabel} → ${h.levelLabel}` : h.levelLabel)}</div>
                  </div>`
                          )
                          .join('')
                      : '<p class="text-muted">Sem classificação registrada.</p>'
                  }
                </div>
              </div>
              <div>
                <h3 class="case-flow__section-title">Responsável</h3>
                <p class="text-muted" style="font-size:.85rem">Atual: <strong>${esc(assigneeName)}</strong></p>
                ${
                  canAssign
                    ? `<div class="form-group">
                  <label for="assignTo">Encaminhar</label>
                  <select id="assignTo" class="form-control">
                    <option value="">Selecionar responsável</option>
                    ${users
                      .map(
                        (u) =>
                          `<option value="${esc(u.id)}" ${u.id === report.assigneeId ? 'selected' : ''}>${esc(u.nome)} (${esc(CSUsers.roleLabel(u.role))})</option>`
                      )
                      .join('')}
                  </select>
                </div>
                <button type="button" class="btn btn-outline btn-block mb-2" id="btnAssign">Encaminhar</button>
                <p class="text-muted" style="font-size:0.85rem;margin:0 0 0.75rem">Somente o Apurador encaminhado terá acesso a este relato. Os demais não terão ciência.</p>`
                    : report.assigneeId
                      ? `<p class="text-muted" style="font-size:0.85rem;margin:0 0 0.75rem">Você está com este relato porque o Adm_Empresa encaminhou para você.</p>`
                      : ''
                }
                <div id="workflowPanelMount"></div>
              </div>
            </div>
          </section>

          <!-- 3. Comunicação -->
          <section class="case-flow__panel${startStep === 'comunicacao' ? ' is-active' : ''}" data-case-panel="comunicacao" role="tabpanel">
            <div class="case-flow__panel-head">
              <h2>Comunicação com o denunciante</h2>
              <p>Mensagens visíveis na consulta pública. Observações internas ficam na etapa de Apuração.</p>
            </div>
            ${threadData.unreadCount ? '<span class="badge badge--accent mb-2">Nova resposta</span>' : ''}
            <div id="threadPanel" class="message-thread mb-2">
              ${
                threadData.messages.length
                  ? threadData.messages
                      .map(
                        (m) => `<div class="message-thread__item ${m.direction === 'company' ? 'message-thread__item--self' : 'message-thread__item--other'}">
                  <div class="message-thread__meta">${esc(m.authorLabel)} · ${CSReports.formatDateTime(m.createdAt)}${m.messageType === 'info_request' ? ' · Solicitação' : ''}</div>
                  <div class="message-thread__body">${esc(m.body)}</div>
                </div>`
                      )
                      .join('')
                  : '<p class="text-muted">Nenhuma mensagem na thread pública.</p>'
              }
            </div>
            <div class="form-group">
              <label for="threadMsg">Enviar mensagem ao denunciante</label>
              <textarea id="threadMsg" class="form-control" rows="3" placeholder="Texto visível na consulta pública (protocolo + código)"></textarea>
            </div>
            <div class="flex gap-1 flex-wrap">
              <button type="button" class="btn btn-primary" id="btnThreadMsg">Enviar mensagem</button>
              <button type="button" class="btn btn-outline" id="btnThreadInfo">Solicitar informações</button>
              <button type="button" class="btn btn-outline" data-case-skip-comm>Pular comunicação →</button>
            </div>
          </section>

          <!-- 4. Apuração -->
          <section class="case-flow__panel${startStep === 'apuracao' ? ' is-active' : ''}" data-case-panel="apuracao" role="tabpanel">
            <div class="case-flow__panel-head">
              <h2>Apuração</h2>
              <p>Registre medidas, ações e observações internas. Esses dados entram no PDF de apuração.</p>
            </div>
            <div class="case-flow__split">
              <div>
                <h3 class="case-flow__section-title">Medidas e ações</h3>
                ${measuresBlock(report, esc)}
                <div class="form-grid" style="display:grid;gap:1rem;grid-template-columns:repeat(auto-fit,minmax(160px,1fr));align-items:end">
                  <div class="form-group" style="margin:0">
                    <label for="measureType">Tipo</label>
                    <select id="measureType" class="form-control">
                      <option value="acao_executada">Ação executada</option>
                      <option value="medida_adotada">Medida adotada</option>
                    </select>
                  </div>
                  <div class="form-group" style="margin:0">
                    <label for="measureDate">Data da execução</label>
                    <input type="date" id="measureDate" class="form-control" />
                  </div>
                </div>
                <div class="form-group mt-2">
                  <label for="measureText">Descrição</label>
                  <textarea id="measureText" class="form-control" rows="3" placeholder="Ex.: Foi realizada reunião com o setor; afastamento cautelar aplicado…"></textarea>
                </div>
                <button type="button" class="btn btn-primary btn-block" id="btnMeasure">Registrar medida / ação</button>
              </div>
              <div>
                <h3 class="case-flow__section-title">Observação interna</h3>
                <div class="form-group">
                  <label for="obs">Registro interno (não visível ao denunciante)</label>
                  <textarea id="obs" class="form-control" rows="4" placeholder="Anotações de tratamento…"></textarea>
                </div>
                <button type="button" class="btn btn-outline btn-block" id="btnObs">Registrar observação</button>
              </div>
            </div>
          </section>

          <!-- 5. Conclusão -->
          <section class="case-flow__panel${startStep === 'conclusao' ? ' is-active' : ''}" data-case-panel="conclusao" role="tabpanel">
            <div class="case-flow__panel-head">
              <h2>Conclusão</h2>
              <p>Revise o status e encerre o relato quando o tratamento estiver completo.</p>
            </div>
            <div class="case-flow__split">
              <div>
                <h3 class="case-flow__section-title">Status e encerramento</h3>
                <div class="form-group">
                  <label for="newStatus">Alterar status</label>
                  <select id="newStatus" class="form-control">
                    ${statuses
                      .map(
                        (s) =>
                          `<option value="${esc(s.id)}" ${s.id === report.status ? 'selected' : ''}>${esc(s.label)}</option>`
                      )
                      .join('')}
                  </select>
                </div>
                <button type="button" class="btn btn-primary btn-block mb-2" id="btnStatus">Salvar status</button>
                <button type="button" class="btn btn-accent btn-block" id="btnConclude">Concluir relato</button>
                ${
                  !progress.hasRisk || !progress.hasAssignee
                    ? `<div class="callout mt-2"><p>Antes de concluir, complete a <strong>Triagem</strong> (risco e responsável).</p></div>`
                    : !progress.hasMeasures
                      ? `<div class="callout mt-2"><p>Recomendado: registre ao menos uma medida na etapa <strong>Apuração</strong>.</p></div>`
                      : ''
                }
              </div>
              <div>
                <h3 class="case-flow__section-title">Histórico de tratamento</h3>
                <div class="history-list">
                  ${
                    history.length
                      ? history
                          .map(
                            (h) => `
                  <div class="history-item">
                    <div class="history-item__meta">${CSReports.formatDateTime(h.date)} · ${esc(h.userName)}</div>
                    <div>${esc(h.action)}</div>
                  </div>`
                          )
                          .join('')
                      : '<p class="text-muted">Sem histórico.</p>'
                  }
                </div>
              </div>
            </div>
          </section>
        </div>

        <div class="case-flow__nav">
          <button type="button" class="btn btn-outline" data-case-prev>← Etapa anterior</button>
          <button type="button" class="btn btn-primary" data-case-next>Próxima etapa →</button>
        </div>
      </div>
    </div>`;
  }

  function bindTabs(root) {
    if (!root) return;
    const maxIndex = Number(root.dataset.maxStep || 0);
    const tabs = [...root.querySelectorAll('[data-case-step]')];
    const panels = [...root.querySelectorAll('[data-case-panel]')];
    const guide = root.querySelector('[data-case-guide]');
    const prevBtn = root.querySelector('[data-case-prev]');
    const nextBtn = root.querySelector('[data-case-next]');

    function currentIndex() {
      const active = root.querySelector('.case-flow__tab.is-active');
      return active ? Number(active.dataset.stepIndex || 0) : 0;
    }

    function activate(index, { force } = {}) {
      const i = Math.max(0, Math.min(STEPS.length - 1, index));
      if (!force && i > maxIndex) {
        const need = STEPS[Math.min(maxIndex, STEPS.length - 1)];
        if (typeof CSApp !== 'undefined') {
          CSApp.toast(
            maxIndex < 1
              ? 'Avance pela leitura e complete a triagem (risco + responsável).'
              : maxIndex < 4
                ? 'Classifique o risco e defina o responsável na Triagem para liberar a conclusão.'
                : `Conclua “${need.label}” antes de avançar.`,
            'warning'
          );
        }
        return;
      }
      tabs.forEach((t, idx) => {
        t.classList.toggle('is-active', idx === i);
      });
      panels.forEach((p, idx) => {
        p.classList.toggle('is-active', idx === i);
      });
      const step = STEPS[i];
      if (guide && step) {
        guide.textContent = `Etapa ${i + 1} de ${STEPS.length}: ${step.hint}.`;
      }
      if (prevBtn) prevBtn.disabled = i <= 0;
      if (nextBtn) {
        nextBtn.disabled = i >= STEPS.length - 1;
        nextBtn.textContent = i >= STEPS.length - 1 ? 'Fim do fluxo' : 'Próxima etapa →';
      }
      try {
        sessionStorage.setItem('cs_case_step_' + (root.closest('[data-report-id]')?.dataset.reportId || ''), step.id);
      } catch (_) {
        /* ignore */
      }
    }

    tabs.forEach((tab) => {
      tab.addEventListener('click', () => {
        const idx = Number(tab.dataset.stepIndex || 0);
        activate(idx);
      });
    });
    prevBtn?.addEventListener('click', () => activate(currentIndex() - 1, { force: true }));
    nextBtn?.addEventListener('click', () => activate(currentIndex() + 1));
    root.querySelector('[data-case-skip-comm]')?.addEventListener('click', () => {
      const idx = STEPS.findIndex((s) => s.id === 'apuracao');
      activate(idx >= 0 ? idx : currentIndex() + 1);
    });

    const start = root.dataset.startStep || 'leitura';
    const startIdx = STEPS.findIndex((s) => s.id === start);
    activate(startIdx >= 0 ? startIdx : 0, { force: true });
  }

  return { buildHtml, bindTabs, STEPS, stepProgress };
})();

window.CSReportCaseWorkspace = CSReportCaseWorkspace;
