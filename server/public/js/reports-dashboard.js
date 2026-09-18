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
    const colspan = options.colspan || (options.showCompany ? 7 : 6);
    const actor = options.actor || (typeof CSAuth !== 'undefined' ? CSAuth.getSession() : null);
    const canManage =
      options.canManage === true ||
      (options.canManage !== false &&
        actor &&
        (actor.role === 'admin_empresa' || actor.role === 'superadmin'));

    try {
      const reports = await CSApi.getReports(filters);
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
          const closed = r.status === 'concluido';
          const actionsHtml =
            typeof CSApp !== 'undefined' && CSApp.rowReportActionsHtml
              ? CSApp.rowReportActionsHtml(href, {
                  reportId: r.id,
                  canManage,
                  closed
                })
              : typeof CSApp !== 'undefined' && CSApp.rowViewActionHtml
                ? CSApp.rowViewActionHtml(href)
                : `<a class="btn btn-sm btn-outline" href="${href}">Visualizar</a>`;
          return `
        <tr data-report-id="${esc(r.id)}">
          <td><strong>${esc(r.protocol)}</strong>${r.threadUnreadCount ? ' <span class="badge badge--accent" title="Nova mensagem do denunciante">Msg</span>' : ''}</td>
          ${options.showCompany ? `<td>${esc(companies[r.companyId] || '—')}</td>` : ''}
          <td>${esc(CSApi.categoryLabel(r.category))}</td>
          <td>${CSReports.riskPillHtml(r.riskLevel, esc)}</td>
          <td><span class="status-pill ${CSReports.statusClass(r.status)}">${esc(CSApi.statusLabel(r.status))}</span></td>
          <td title="Data e hora em que o relato foi registrado no canal">${CSReports.formatDateTime(r.createdAt)}</td>
          <td class="actions">${actionsHtml}</td>
        </tr>`;
        })
        .join('');

      bindReportRowActions(tbody, {
        actor,
        canManage,
        companyId: filters.companyId || actor?.companyId,
        onChanged: options.onChanged || (() => renderReportsTable(tbody, filters, options)),
        detailBase: options.detailBase || 'relatos.html'
      });

      return reports;
    } catch (err) {
      CSErrors.logError(err, 'renderReportsTable');
      CSErrors.renderTableRetry(tbody, colspan, () => renderReportsTable(tbody, filters, options));
      CSApp.toast(CSErrors.userMessage(err), 'error');
      return [];
    }
  }

  function bindReportRowActions(tbody, opts = {}) {
    if (!tbody || !opts.canManage || !opts.actor) return;

    tbody.querySelectorAll('[data-report-assign]').forEach((btn) => {
      btn.addEventListener('click', async (e) => {
        e.preventDefault();
        e.stopPropagation();
        const reportId = btn.getAttribute('data-report-assign');
        if (!reportId) return;
        await forwardReportToApurador(reportId, opts);
      });
    });

    tbody.querySelectorAll('[data-report-investigate]').forEach((btn) => {
      btn.addEventListener('click', async (e) => {
        e.preventDefault();
        e.stopPropagation();
        const reportId = btn.getAttribute('data-report-investigate');
        if (!reportId) return;
        await takeReportInvestigation(reportId, opts);
      });
    });
  }

  async function forwardReportToApurador(reportId, opts = {}) {
    const actor = opts.actor;
    let users = [];
    try {
      users = (await CSApi.getUsers({ companyId: opts.companyId || actor.companyId }, actor)) || [];
    } catch (err) {
      CSApp.toast(CSErrors.userMessage(err), 'error');
      return;
    }
    const apuradores = users.filter((u) => u.role === 'apurador' && u.status !== 'inativo');
    const assigneeId = await CSApp.selectDialog({
      title: 'Encaminhar ao Apurador',
      message: 'Selecione o apurador responsável. Somente ele terá ciência deste relato entre os apuradores.',
      options: apuradores.map((u) => ({
        value: u.id,
        label: u.nome || u.email || u.id
      })),
      confirmText: 'Encaminhar',
      emptyText: 'Nenhum apurador cadastrado.'
    });
    if (!assigneeId) return;

    const updated = await CSApp.runAsync(() => CSApi.assignReport(reportId, assigneeId, actor), {
      context: 'assignReport'
    });
    if (updated) {
      CSApp.toast('Relato encaminhado ao apurador.', 'success');
      if (typeof opts.onChanged === 'function') await opts.onChanged();
    }
  }

  async function takeReportInvestigation(reportId, opts = {}) {
    const actor = opts.actor;
    const ok = await CSApp.confirmDialog({
      title: 'Apurar relato',
      message:
        'Você assume a apuração deste relato como Adm_Empresa. O status passará para Em apuração.',
      confirmText: 'Apurar'
    });
    if (!ok) return;

    const assigned = await CSApp.runAsync(() => CSApi.assignReport(reportId, actor.id, actor), {
      context: 'assignReportSelf'
    });
    if (!assigned) return;

    const statusId = 'apuracao';
    if (assigned.status !== statusId && assigned.status !== 'concluido') {
      await CSApp.runAsync(() => CSApi.updateReportStatus(reportId, statusId, actor, 'Adm_Empresa iniciou a apuração.'), {
        context: 'updateReportStatus'
      });
    }

    CSApp.toast('Você iniciou a apuração deste relato.', 'success');
    const detailBase = opts.detailBase || 'relatos.html';
    location.href = `${detailBase}?id=${encodeURIComponent(reportId)}`;
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
      const canAssign = actor.role === 'admin_empresa' || actor.role === 'superadmin';

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



      if (typeof CSReportCaseWorkspace === 'undefined') {
        container.innerHTML = '<div class="empty-state">Módulo de apuração indisponível. Recarregue a página.</div>';
        return null;
      }

      container.innerHTML = CSReportCaseWorkspace.buildHtml({
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
      });

      CSReportCaseWorkspace.bindTabs(container.querySelector('[data-case-workspace]'));

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

        if (!report.riskLevel || !report.assigneeId) {
          CSApp.toast('Conclua a Triagem (risco e responsável) antes de encerrar.', 'warning');
          const tab = container.querySelector('[data-case-step="triagem"]');
          tab?.click();
          return;
        }

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


