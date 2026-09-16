'use strict';

const { describe, it, before, after } = require('node:test');
const assert = require('node:assert/strict');
const store = require('../src/store');
const reportsService = require('../src/services/reports.service');

describe('Medidas e ações no relato', () => {
  let previousLog;
  let reportId;

  before(() => {
    const data = store.load();
    const report = (data.reports || []).find((r) => r.companyId === 'cmp_aurora') || data.reports[0];
    assert.ok(report, 'precisa de relato demo');
    reportId = report.id;
    previousLog = Array.isArray(report.measuresLog)
      ? JSON.parse(JSON.stringify(report.measuresLog))
      : null;
    report.measuresLog = [];
    store.save(data);
  });

  after(() => {
    const data = store.load();
    const report = (data.reports || []).find((r) => r.id === reportId);
    if (report) {
      if (previousLog) report.measuresLog = previousLog;
      else delete report.measuresLog;
      store.save(data);
    }
  });

  it('registra ação executada e atualiza measuresAdopted', () => {
    const user = {
      id: 'usr_aurora_admin',
      nome: 'Carla Mendes',
      role: 'admin_empresa',
      companyId: 'cmp_aurora',
      permissions: ['reports:comment', 'reports:read']
    };
    // permissions come from tokens - check how hasPermission works
    const data = store.load();
    const realUser = (data.users || []).find((u) => u.id === 'usr_aurora_admin');
    assert.ok(realUser);

    const result = reportsService.addMeasureAction(realUser, reportId, {
      type: 'acao_executada',
      text: 'Reunião com RH e afastamento cautelar do envolvido.',
      executedAt: '2026-09-10'
    });
    assert.equal(result.ok, true);
    assert.ok(result.data.entry);
    assert.equal(result.data.entry.type, 'acao_executada');
    assert.ok(Array.isArray(result.data.report.measuresLog));
    assert.ok(result.data.report.measuresLog.length >= 1);
    assert.match(result.data.report.measuresAdopted || '', /Reunião com RH/);
  });

  it('registra medida adotada', () => {
    const data = store.load();
    const realUser = (data.users || []).find((u) => u.id === 'usr_aurora_admin');
    const result = reportsService.addMeasureAction(realUser, reportId, {
      type: 'medida_adotada',
      text: 'Treinamento de prevenção agendado para a equipe.'
    });
    assert.equal(result.ok, true);
    assert.equal(result.data.entry.type, 'medida_adotada');
  });
});
