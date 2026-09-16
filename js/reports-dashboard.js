/**

 * reports-dashboard.js – Listagem, filtros e ficha de relatos

 */



const CSReportsUI = (() => {

  async function fillFilterSelects(form) {

    if (!form) return;

    return CSApp.runAsync(

      async () => {

        const catSel = form.querySelector('[name="category"]');

        const statusSel = form.querySelector('[name="status"]');

        if (catSel && catSel.options.length <= 1) {

          const cats = await CSApi.getCategories();

          cats.forEach((c) => {

            const opt = document.createElement('option');

            opt.value = c.id;

            opt.textContent = c.label;

            catSel.appendChild(opt);

          });

        }

        if (statusSel && statusSel.options.length <= 1) {

          const statuses = await CSApi.getStatuses();

          statuses.forEach((s) => {

            const opt = document.createElement('option');

            opt.value = s.id;

            opt.textContent = s.label;

            statusSel.appendChild(opt);

          });

        }

      },

      { context: 'fillFilterSelects', toast: false }

    );

  }



  function readFilters(form) {

    const fd = new FormData(form);

    const filters = {};

    ['companyId', 'status', 'category', 'sector', 'q', 'from', 'to', 'riskLevel', 'workflowStage', 'priority', 'alert'].forEach((k) => {

      const v = fd.get(k);

      if (v) filters[k] = v;

    });

    const anon = fd.get('anonymous');

    if (anon === 'true') filters.anonymous = true;

    if (anon === 'false') filters.anonymous = false;

    return filters;

  }

  function applyQueryToForm(form) {
    if (!form) return;
    const params = new URLSearchParams(location.search);
    const keys = ['companyId', 'status', 'category', 'sector', 'q', 'from', 'to', 'riskLevel', 'workflowStage', 'priority', 'alert', 'anonymous'];
    keys.forEach((k) => {
      const v = params.get(k);
      if (v == null || v === '') return;
      let el = form.elements.namedItem(k);
      if (!el) {
        el = document.createElement('input');
        el.type = 'hidden';
        el.name = k;
        form.appendChild(el);
      }
      if (el instanceof RadioNodeList) {
        [...el].forEach((node) => {
          if ('value' in node) node.value = v;
        });
      } else {
        el.value = v;
      }
    });
  }



  async function renderReportsTable(tbody, filters, options = {}) {

    if (!tbody) return [];

    const colspan = options.colspan || (options.showCompany ? 14 : 13);



    try {

      const reports = await CSApi.getReports(filters);

      const users = await CSApi.getUsers({});

      const userMap = Object.fromEntries(users.map((u) => [u.id, u.nome]));

      let companies = {};

      if (options.showCompany) {

        const list = await CSApi.getCompanies();

        companies = Object.fromEntries(list.map((c) => [c.id, c.nomeFantasia]));

      }

      const esc = CSApp.escapeHtml;



      if (!reports.length) {

        tbody.innerHTML = `<tr><td colspan="${colspan}" class="empty-state">Nenhum relato encontrado com os filtros atuais.</td></tr>`;

        return reports;

      }



      tbody.innerHTML = reports

        .map((r) => {

          const href = options.detailBase

            ? `${options.detailBase}?id=${encodeURIComponent(r.id)}`

            : `?id=${encodeURIComponent(r.id)}`;

          return `

        <tr>

          <td><strong>${esc(r.protocol)}</strong>${r.threadUnreadCount ? ' <span class="badge badge--accent" title="Nova mensagem do denunciante">Msg</span>' : ''}</td>

          ${options.showCompany ? `<td>${esc(companies[r.companyId] || '—')}</td>` : ''}

          <td title="Data e hora em que o relato foi registrado no canal">${CSReports.formatDateTime(r.createdAt)}</td>

          <td title="Data aproximada da ocorrência informada no relato">${esc(CSReports.formatOccurrence(r.dateApprox, r.timeApprox))}</td>

          <td>${esc(CSApi.categoryLabel(r.category))}</td>

          <td>${esc(r.sector || '—')}</td>

          <td>${CSReports.riskPillHtml(r.riskLevel, esc)}</td>

          <td>${CSReports.priorityPillHtml(r.priority, esc)}</td>

          <td>${esc(CSReports.workflowStageLabel(r.workflowStage))}</td>

          <td>${r.isAnonymous ? '<span class="badge">Anônimo</span>' : '<span class="badge badge--primary">Identificado</span>'}</td>

          <td><span class="status-pill ${CSReports.statusClass(r.status)}">${esc(CSApi.statusLabel(r.status))}</span></td>

          <td>${r.assigneeId ? esc(userMap[r.assigneeId] || '—') : '—'}</td>

          <td title="Última atualização do relato">${CSReports.formatDate(r.updatedAt)}</td>

          <td class="actions">

            ${typeof CSApp !== 'undefined' && CSApp.rowViewActionHtml ? CSApp.rowViewActionHtml(href) : `<a class="btn btn-sm btn-outline" href="${href}">Visualizar</a>`}

          </td>

        </tr>`;

        })

        .join('');

      return reports;

    } catch (err) {

      CSErrors.logError(err, 'renderReportsTable');

      CSErrors.renderTableRetry(tbody, colspan, () => renderReportsTable(tbody, filters, options));

      CSApp.toast(CSErrors.userMessage(err), 'error');

      return [];

    }

  }



  async function renderReportDetail(container, reportId, actor) {

    if (!container) return null;



    try {

      const report = await CSApi.getReport(reportId);

      if (!report) {

        container.innerHTML = '<div class="empty-state">Relato não encontrado.</div>';

        return null;

      }

      if (actor && actor.role !== 'superadmin' && report.companyId !== actor.companyId) {

        container.innerHTML = '<div class="empty-state">Acesso não autorizado a este relato.</div>';

        return null;

      }



      const history = await CSApi.getReportHistory(report.id, actor);

      let threadData = { messages: [], unreadCount: 0 };

      try {

        threadData = await CSApi.getReportMessages(report.id, actor);

      } catch (err) {

        CSErrors.logError(err, 'getReportMessages');

      }

      let riskPolicy = { factors: [], levels: {} };

      let riskHistory = [];

      const canCritical = actor.role === 'admin_empresa' || actor.role === 'superadmin';

      try {

        riskPolicy = await CSApi.getRiskPolicy(report.companyId, actor);

        riskHistory = await CSApi.getRiskHistory(report.id, actor);

      } catch (err) {

        CSErrors.logError(err, 'riskData');

      }

      let workflowState = { current: {}, allowedTransitions: [], history: [] };

      let workflowTimeline = [];

      try {

        workflowState = await CSApi.getReportWorkflow(report.id, actor);

        const timelineRes = await CSApi.getReportWorkflowTimeline(report.id, actor);

        workflowTimeline = timelineRes.timeline || [];

      } catch (err) {

        CSErrors.logError(err, 'workflowData');

      }

      const company = await CSApi.getCompany(report.companyId);

      const users = await CSApi.getUsers({ companyId: report.companyId });

      const statuses = await CSApi.getStatuses();

      const esc = CSApp.escapeHtml;

      const httpActive = typeof CSHttpApi !== 'undefined' && CSHttpApi.enabled();

      let storageUsage = null;

      try {

        storageUsage = await CSApi.getStorageUsage(report.companyId);

      } catch (err) {

        CSErrors.logError(err, 'storageUsage');

      }

      const attachmentsHtml = CSAttachments.renderAdminPanelHtml(report.attachments, esc, {

        httpActive,

        storageUsage

      });



      container.innerHTML = `

      <div class="page-header">

        <div>

          <p class="text-muted" style="margin:0 0 .25rem">Protocolo</p>

          <h1>${esc(report.protocol)}</h1>

          <p>${company ? esc(company.nomeFantasia) : ''} · Registrado em ${CSReports.formatDateTime(report.createdAt)}</p>

        </div>

            <div class="flex gap-1 flex-wrap">

          <span class="status-pill ${CSReports.statusClass(report.status)}">${esc(CSApi.statusLabel(report.status))}</span>

          ${CSReports.riskPillHtml(report.riskLevel, esc)}

          ${CSReports.priorityPillHtml(report.priority, esc)}

          <span class="badge badge--primary">${esc(CSReports.workflowStageLabel(report.workflowStage))}</span>

          ${
            typeof CSExportUI !== 'undefined' && CSExportUI.canExportReport(actor)
              ? `<button type="button" class="btn btn-outline btn-sm" id="btnExportIndividual">PDF individual</button>
          <button type="button" class="btn btn-outline btn-sm" id="btnExportInvestigation">PDF apuração</button>`
              : ''
          }

          <a class="btn btn-outline btn-sm" href="${location.pathname}">← Voltar</a>

        </div>

      </div>



      <div class="detail-grid">

        <div>

          <div class="panel mb-2">

            <div class="panel__header"><h3>Dados do relato</h3></div>

            <div class="panel__body">

              <div class="detail-field"><div class="detail-field__label">Categoria</div><div class="detail-field__value">${esc(CSApi.categoryLabel(report.category))}</div></div>

              <div class="detail-field"><div class="detail-field__label">Registrado em</div><div class="detail-field__value">${CSReports.formatDateTime(report.createdAt)}</div></div>

              <div class="detail-field"><div class="detail-field__label">Data da ocorrência</div><div class="detail-field__value">${esc(CSReports.formatOccurrence(report.dateApprox, report.timeApprox))}</div></div>

              <div class="detail-field"><div class="detail-field__label">Local</div><div class="detail-field__value">${esc(report.location || '—')}</div></div>

              <div class="detail-field"><div class="detail-field__label">Setor</div><div class="detail-field__value">${esc(report.sector || '—')}</div></div>

              <div class="detail-field"><div class="detail-field__label">Envolvidos</div><div class="detail-field__value">${esc(report.involved || '—')}</div></div>

              <div class="detail-field"><div class="detail-field__label">Descrição</div><div class="detail-field__value">${esc(report.description || '')}</div></div>

              <div class="detail-field"><div class="detail-field__label">Testemunhas</div><div class="detail-field__value">${esc(report.witnesses || 'Não informado')}</div></div>

            </div>

          </div>



          <div class="panel mb-2">

            <div class="panel__header"><h3>Anexos</h3></div>

            <div class="panel__body" id="attachmentsPanel">${attachmentsHtml}</div>

          </div>



          <div class="panel">

            <div class="panel__header"><h3>Comunicante</h3></div>

            <div class="panel__body">

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

            </div>

          </div>

        </div>



        <div>

          <div class="panel mb-2">

            <div class="panel__header">

              <h3>Classificação de risco</h3>

              ${report.riskLevel === 'critical' ? '<span class="badge badge--accent">Crítico</span>' : ''}

            </div>

            <div class="panel__body">

              <p class="text-muted" style="font-size:.85rem;margin-top:0">

                Decisão do responsável autorizado. A sugestão do sistema é apenas auxiliar.

              </p>

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

                      (f) => `<label class="risk-factor-check"><input type="checkbox" name="riskFactor" value="${esc(f.id)}" /> ${esc(f.label)}</label>`

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

          </div>



          <div id="workflowPanelMount"></div>



          <div class="panel mb-2">

            <div class="panel__header">

              <h3>Comunicação com denunciante</h3>

              ${threadData.unreadCount ? '<span class="badge badge--accent">Nova resposta</span>' : ''}

            </div>

            <div class="panel__body">

              <p class="text-muted" style="font-size:.85rem;margin-top:0">Mensagens visíveis ao denunciante na consulta pública. Observações internas ficam no histórico de tratamento.</p>

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

              </div>

            </div>

          </div>



          </div>



          <div class="panel mb-2">

            <div class="panel__header"><h3>Medidas e ações executadas</h3></div>

            <div class="panel__body">

              <p class="text-muted" style="margin:0 0 1rem;font-size:.88rem">

                Registre o que foi feito no tratamento desta denúncia (ações executadas e medidas adotadas).

                Os registros ficam no histórico interno e entram no PDF de apuração.

              </p>

              ${

                (Array.isArray(report.measuresLog) && report.measuresLog.length

                  ? `<div class="history-list mb-2">${[...report.measuresLog]

                      .slice()

                      .reverse()

                      .map((m) => {

                        const typeLabel =

                          m.type === 'medida_adotada' ? 'Medida adotada' : 'Ação executada';

                        const when = m.executedAt

                          ? CSReports.formatDateTime(m.executedAt)

                          : CSReports.formatDateTime(m.createdAt);

                        return `<div class="history-item">

                    <div class="history-item__meta">${CSApp.escapeHtml(when)} · ${CSApp.escapeHtml(m.userName || '—')} · <strong>${CSApp.escapeHtml(typeLabel)}</strong></div>

                    <div>${CSApp.escapeHtml(m.text || '')}</div>

                  </div>`;

                      })

                      .join('')}</div>`

                  : report.measuresAdopted

                    ? `<div class="callout mb-2"><p style="margin:0;white-space:pre-wrap">${CSApp.escapeHtml(report.measuresAdopted)}</p></div>`

                    : '<p class="text-muted mb-2">Nenhuma medida ou ação registrada ainda.</p>')

              }

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

                <textarea id="measureText" class="form-control" rows="3" placeholder="Ex.: Foi realizada reunião com o setor; afastamento cautelar aplicado; treinamento agendado…"></textarea>

              </div>

              <button type="button" class="btn btn-primary btn-block" id="btnMeasure">Registrar medida / ação</button>

            </div>

          </div>



          <div class="panel mb-2">

            <div class="panel__header"><h3>Ações</h3></div>

            <div class="panel__body">

              <div class="form-group">

                <label for="newStatus">Alterar status</label>

                <select id="newStatus" class="form-control">

                  ${statuses.map((s) => `<option value="${esc(s.id)}" ${s.id === report.status ? 'selected' : ''}>${esc(s.label)}</option>`).join('')}

                </select>

              </div>

              <button type="button" class="btn btn-primary btn-block mb-2" id="btnStatus">Salvar status</button>



              <div class="form-group">

                <label for="assignTo">Encaminhar</label>

                <select id="assignTo" class="form-control">

                  <option value="">Selecionar responsável</option>

                  ${users.map((u) => `<option value="${esc(u.id)}" ${u.id === report.assigneeId ? 'selected' : ''}>${esc(u.nome)} (${esc(CSUsers.roleLabel(u.role))})</option>`).join('')}

                </select>

              </div>

              <button type="button" class="btn btn-outline btn-block mb-2" id="btnAssign">Encaminhar</button>



              <div class="form-group">

                <label for="obs">Adicionar observação interna</label>

                <textarea id="obs" class="form-control" rows="3" placeholder="Registro interno de tratamento (não visível ao denunciante)"></textarea>

              </div>

              <button type="button" class="btn btn-outline btn-block mb-2" id="btnObs">Registrar observação</button>

              <button type="button" class="btn btn-accent btn-block" id="btnConclude">Concluir relato</button>

            </div>

          </div>



          <div class="panel">

            <div class="panel__header"><h3>Histórico de tratamento</h3></div>

            <div class="panel__body">

              <div class="history-list">

                ${

                  history.length

                    ? history

                        .map(

                          (h) => `

                  <div class="history-item">

                    <div class="history-item__meta">${CSReports.formatDateTime(h.date)} · ${CSApp.escapeHtml(h.userName)}</div>

                    <div>${CSApp.escapeHtml(h.action)}</div>

                  </div>`

                        )

                        .join('')

                    : '<p class="text-muted">Sem histórico.</p>'

                }

              </div>

            </div>

          </div>

        </div>

      </div>

    `;



      CSAttachments.bindAdminPanel(document.getElementById('attachmentsPanel'), report.attachments, actor, () =>

        renderReportDetail(container, reportId, actor)

      , reportId);

      const workflowMount = document.getElementById('workflowPanelMount');

      if (workflowMount && typeof CSWorkflowPanel !== 'undefined') {

        workflowMount.innerHTML = CSWorkflowPanel.panelHtml(report, workflowState, workflowTimeline, esc);

        CSWorkflowPanel.bind(container, reportId, actor, () => renderReportDetail(container, reportId, actor));

      }

      document.getElementById('btnExportIndividual')?.addEventListener('click', () => {
        CSExportUI.exportReport(reportId, 'individual', actor);
      });
      document.getElementById('btnExportInvestigation')?.addEventListener('click', () => {
        CSExportUI.exportReport(reportId, 'investigation', actor);
      });



      document.getElementById('btnStatus')?.addEventListener('click', async () => {

        const status = document.getElementById('newStatus').value;

        const ok = await CSApp.confirmDialog({

          title: 'Alterar status',

          message: `Confirma alteração para "${CSApi.statusLabel(status)}"?`,

          confirmText: 'Alterar'

        });

        if (!ok) return;

        const updated = await CSApp.runAsync(() => CSApi.updateReportStatus(report.id, status, actor), {

          context: 'updateReportStatus'

        });

        if (updated) {

          CSApp.toast('Status atualizado.', 'success');

          renderReportDetail(container, reportId, actor);

        }

      });



      document.getElementById('btnAssign')?.addEventListener('click', async () => {

        const assigneeId = document.getElementById('assignTo').value;

        if (!assigneeId) {

          CSApp.toast('Selecione um responsável.', 'warning');

          return;

        }

        const updated = await CSApp.runAsync(() => CSApi.assignReport(report.id, assigneeId, actor), {

          context: 'assignReport'

        });

        if (updated) {

          CSApp.toast('Relato encaminhado.', 'success');

          renderReportDetail(container, reportId, actor);

        }

      });



      document.getElementById('btnObs')?.addEventListener('click', async () => {

        const text = document.getElementById('obs').value.trim();

        if (!text) {

          CSApp.toast('Digite a observação.', 'warning');

          return;

        }

        const updated = await CSApp.runAsync(() => CSApi.addReportObservation(report.id, text, actor), {

          context: 'addReportObservation'

        });

        if (updated) {

          CSApp.toast('Observação registrada.', 'success');

          renderReportDetail(container, reportId, actor);

        }

      });

      const measureDateEl = document.getElementById('measureDate');
      if (measureDateEl && !measureDateEl.value) {
        measureDateEl.value = new Date().toISOString().slice(0, 10);
      }

      document.getElementById('btnMeasure')?.addEventListener('click', async () => {
        const text = document.getElementById('measureText')?.value.trim() || '';
        const type = document.getElementById('measureType')?.value || 'acao_executada';
        const dateVal = document.getElementById('measureDate')?.value || '';
        if (!text) {
          CSApp.toast('Descreva a medida ou ação executada.', 'warning');
          return;
        }
        const result = await CSApp.runAsync(
          () =>
            CSApi.addReportMeasure(
              report.id,
              {
                text,
                type,
                executedAt: dateVal ? `${dateVal}T12:00:00.000Z` : undefined
              },
              actor
            ),
          { context: 'addReportMeasure' }
        );
        if (result) {
          CSApp.toast('Registro salvo.', 'success');
          renderReportDetail(container, reportId, actor);
        }
      });

      async function sendThreadMessage(messageType) {

        const text = document.getElementById('threadMsg').value.trim();

        if (!text) {

          CSApp.toast('Digite a mensagem para o denunciante.', 'warning');

          return;

        }

        try {

          await CSApp.runAsync(

            () => CSApi.sendReportMessage(report.id, text, actor, { messageType }),

            { context: 'sendReportMessage' }

          );

          CSApp.toast('Mensagem enviada ao denunciante.', 'success');

          renderReportDetail(container, reportId, actor);

        } catch (err) {

          CSApp.toast(CSErrors.userMessage(err), 'error');

        }

      }



      document.getElementById('btnThreadMsg')?.addEventListener('click', () => sendThreadMessage('message'));

      document.getElementById('btnThreadInfo')?.addEventListener('click', () => sendThreadMessage('info_request'));



      document.getElementById('btnRiskSuggest')?.addEventListener('click', async () => {

        try {

          const res = await CSApp.runAsync(() => CSApi.getRiskSuggestion(report.id, actor), {

            context: 'getRiskSuggestion'

          });

          const box = document.getElementById('riskSuggestionBox');

          if (!res?.suggestion) return;

          box.classList.remove('hidden');

          box.innerHTML = `<p><strong>Sugestão:</strong> ${esc(CSReports.riskLabel(res.suggestion.suggestedLevel))} (score ${res.suggestion.score || 0})</p>

            <p class="text-muted">${esc(res.suggestion.disclaimer)}</p>`;

          if (res.suggestion.suggestedLevel) {

            document.getElementById('riskLevel').value = res.suggestion.suggestedLevel;

          }

          (res.suggestion.matchedFactors || []).forEach((fid) => {

            const cb = document.querySelector(`#riskFactors input[value="${fid}"]`);

            if (cb) cb.checked = true;

          });

        } catch (err) {

          CSApp.toast(CSErrors.userMessage(err), 'error');

        }

      });



      document.getElementById('btnRiskClassify')?.addEventListener('click', async () => {

        const level = document.getElementById('riskLevel').value;

        const justification = document.getElementById('riskJustification').value.trim();

        const factors = [...document.querySelectorAll('#riskFactors input:checked')].map((el) => el.value);

        if (!level) {

          CSApp.toast('Selecione o nível de risco.', 'warning');

          return;

        }

        if (!justification) {

          CSApp.toast('Informe a justificativa.', 'warning');

          return;

        }

        try {

          await CSApp.runAsync(

            () => CSApi.classifyReportRisk(report.id, { level, factors, justification }, actor),

            { context: 'classifyReportRisk' }

          );

          CSApp.toast('Classificação registrada.', 'success');

          renderReportDetail(container, reportId, actor);

        } catch (err) {

          CSApp.toast(CSErrors.userMessage(err), 'error');

        }

      });



      document.getElementById('btnConclude')?.addEventListener('click', async () => {

        const ok = await CSApp.confirmDialog({

          title: 'Concluir relato',

          message: 'Confirma a conclusão deste relato? Esta ação ficará registrada no histórico.',

          confirmText: 'Concluir'

        });

        if (!ok) return;

        const updated = await CSApp.runAsync(

          () => CSApi.updateReportStatus(report.id, 'concluido', actor, 'Concluiu o relato.'),

          { context: 'concludeReport' }

        );

        if (updated) {

          CSApp.toast('Relato concluído.', 'success');

          renderReportDetail(container, reportId, actor);

        }

      });



      return report;

    } catch (err) {

      CSErrors.logError(err, 'renderReportDetail');

      CSErrors.renderLoadError(container, CSErrors.userMessage(err), () =>

        renderReportDetail(container, reportId, actor)

      );

      CSApp.toast(CSErrors.userMessage(err), 'error');

      return null;

    }

  }



  return { fillFilterSelects, readFilters, applyQueryToForm, renderReportsTable, renderReportDetail };

})();



window.CSReportsUI = CSReportsUI;


