'use strict';

const { describe, it } = require('node:test');
const assert = require('node:assert/strict');
const ui = require('../src/services/ui-defaults.service');

describe('ui-defaults', () => {
  it('normaliza tamanhos válidos', () => {
    assert.equal(ui.normalizeTableFontSize('LG'), 'lg');
    assert.equal(ui.normalizeTableFontSize('nope'), null);
  });

  it('resolve hierarquia user > company > platform', () => {
    const data = {
      platformSettings: { uiDefaults: { tableFontSize: 'lg' }, defaultProtocolPrefix: 'CS' },
      companySettings: {
        cmp_1: {
          uiDefaults: { tableFontSize: 'sm', tableFontSizeConfigured: true }
        }
      }
    };

    const fromPlatform = ui.resolveEffectiveTableFont({
      user: { id: 'u1', companyId: null },
      data
    });
    assert.equal(fromPlatform.effective, 'lg');
    assert.equal(fromPlatform.source, 'platform');

    const fromCompany = ui.resolveEffectiveTableFont({
      user: { id: 'u2', companyId: 'cmp_1' },
      data
    });
    assert.equal(fromCompany.effective, 'sm');
    assert.equal(fromCompany.source, 'company');
    assert.equal(fromCompany.companyConfigured, true);

    const fromUser = ui.resolveEffectiveTableFont({
      user: {
        id: 'u3',
        companyId: 'cmp_1',
        preferences: { tableFontSize: 'xl' }
      },
      data
    });
    assert.equal(fromUser.effective, 'xl');
    assert.equal(fromUser.source, 'user');
    assert.equal(fromUser.company, 'sm');
    assert.equal(fromUser.platform, 'lg');
  });

  it('empresa sem modelo configurado herda plataforma', () => {
    const data = {
      platformSettings: { uiDefaults: { tableFontSize: 'md' }, defaultProtocolPrefix: 'CS' },
      companySettings: {
        cmp_2: { uiDefaults: { tableFontSizeConfigured: false } }
      }
    };
    const resolved = ui.resolveEffectiveTableFont({
      user: { id: 'u4', companyId: 'cmp_2' },
      data
    });
    assert.equal(resolved.effective, 'md');
    assert.equal(resolved.source, 'platform');
    assert.equal(resolved.companyConfigured, false);
  });

  it('bloqueia Adm_Plataforma de gravar modelo da empresa', () => {
    const denied = ui.updateCompanyTableFont(
      { id: 'u_sa', nome: 'Super', role: 'superadmin' },
      'xl'
    );
    assert.equal(denied.ok, false);
    assert.equal(denied.status, 403);
  });
});
