'use strict';

const store = require('../store');
const { appendAudit } = require('./audit.service');

const TABLE_FONT_SIZES = Object.freeze(['sm', 'md', 'lg', 'xl']);
const DEFAULT_TABLE_FONT = 'md';

function normalizeTableFontSize(value) {
  const v = String(value || '').trim().toLowerCase();
  return TABLE_FONT_SIZES.includes(v) ? v : null;
}

function ensurePlatformUiDefaults(data) {
  if (!data.platformSettings || typeof data.platformSettings !== 'object') {
    data.platformSettings = {};
  }
  if (!data.platformSettings.uiDefaults || typeof data.platformSettings.uiDefaults !== 'object') {
    data.platformSettings.uiDefaults = {};
  }
  const ui = data.platformSettings.uiDefaults;
  if (!normalizeTableFontSize(ui.tableFontSize)) {
    ui.tableFontSize = DEFAULT_TABLE_FONT;
  }
  return ui;
}

function ensureCompanySettings(data, companyId) {
  data.companySettings = data.companySettings || {};
  if (!data.companySettings[companyId] || typeof data.companySettings[companyId] !== 'object') {
    const prefix = data.platformSettings?.defaultProtocolPrefix || 'CS';
    data.companySettings[companyId] = { protocolPrefix: prefix, protocolCounter: 100 };
  }
  const cfg = data.companySettings[companyId];
  if (!cfg.uiDefaults || typeof cfg.uiDefaults !== 'object') {
    cfg.uiDefaults = {};
  }
  return cfg;
}

function isCompanyTableFontConfigured(cfg) {
  const ui = cfg?.uiDefaults;
  if (!ui || typeof ui !== 'object') return false;
  if (ui.tableFontSizeConfigured === true) return true;
  return Boolean(normalizeTableFontSize(ui.tableFontSize));
}

function getPlatformTableFont(data) {
  const ui = ensurePlatformUiDefaults(data);
  return normalizeTableFontSize(ui.tableFontSize) || DEFAULT_TABLE_FONT;
}

function getCompanyTableFont(data, companyId) {
  if (!companyId) return null;
  const cfg = ensureCompanySettings(data, companyId);
  if (!isCompanyTableFontConfigured(cfg)) return null;
  return normalizeTableFontSize(cfg.uiDefaults.tableFontSize);
}

function getUserTableFont(user) {
  if (!user?.preferences || typeof user.preferences !== 'object') return null;
  return normalizeTableFontSize(user.preferences.tableFontSize);
}

function resolveEffectiveTableFont({ user = null, companyId = null, data = null } = {}) {
  const storeData = data || store.load();
  const userFont = getUserTableFont(user);
  if (userFont) {
    return {
      effective: userFont,
      source: 'user',
      user: userFont,
      company: getCompanyTableFont(storeData, companyId || user?.companyId || null),
      platform: getPlatformTableFont(storeData),
      companyConfigured: isCompanyTableFontConfigured(
        companyId || user?.companyId
          ? ensureCompanySettings(storeData, companyId || user.companyId)
          : null
      )
    };
  }
  const cid = companyId || user?.companyId || null;
  const companyFont = getCompanyTableFont(storeData, cid);
  if (companyFont) {
    return {
      effective: companyFont,
      source: 'company',
      user: null,
      company: companyFont,
      platform: getPlatformTableFont(storeData),
      companyConfigured: true
    };
  }
  const platformFont = getPlatformTableFont(storeData);
  return {
    effective: platformFont,
    source: 'platform',
    user: null,
    company: null,
    platform: platformFont,
    companyConfigured: Boolean(cid && isCompanyTableFontConfigured(ensureCompanySettings(storeData, cid)))
  };
}

function getUiDefaultsForUser(user) {
  if (!user) return { ok: false, status: 401 };
  const data = store.load();
  const resolved = resolveEffectiveTableFont({ user, data });
  return {
    ok: true,
    data: {
      tableFontSize: resolved.effective,
      source: resolved.source,
      layers: {
        user: resolved.user,
        company: resolved.company,
        platform: resolved.platform
      },
      companyConfigured: resolved.companyConfigured,
      options: TABLE_FONT_SIZES.slice(),
      canEditPlatform: user.role === 'superadmin',
      canEditCompany: user.role === 'admin_empresa' && Boolean(user.companyId)
    }
  };
}

function updatePlatformTableFont(user, tableFontSize) {
  if (!user) return { ok: false, status: 401 };
  if (user.role !== 'superadmin') {
    return { ok: false, status: 403, error: 'Apenas o Adm_Plataforma pode definir o padrão geral.' };
  }
  const size = normalizeTableFontSize(tableFontSize);
  if (!size) return { ok: false, status: 400, error: 'Tamanho de fonte inválido.' };

  const data = store.load();
  const ui = ensurePlatformUiDefaults(data);
  const previous = ui.tableFontSize;
  ui.tableFontSize = size;
  data.platformSettings.uiDefaults = ui;
  appendAudit(data, {
    userId: user.id,
    userName: user.nome,
    action: 'atualizacao_ui_defaults_plataforma',
    resourceType: 'platform_settings',
    resourceId: 'ui_defaults',
    companyId: null,
    previousValue: { tableFontSize: previous },
    newValue: { tableFontSize: size }
  });
  store.save(data);
  return { ok: true, data: getUiDefaultsForUser(user).data };
}

function updateCompanyTableFont(user, tableFontSize) {
  if (!user) return { ok: false, status: 401 };
  if (user.role !== 'admin_empresa' || !user.companyId) {
    return {
      ok: false,
      status: 403,
      error: 'Apenas o Adm_Empresa pode definir o padrão das planilhas no painel da empresa.'
    };
  }

  const clear = tableFontSize == null || String(tableFontSize).trim() === '';
  const size = clear ? null : normalizeTableFontSize(tableFontSize);
  if (!clear && !size) return { ok: false, status: 400, error: 'Tamanho de fonte inválido.' };

  const data = store.load();
  const cfg = ensureCompanySettings(data, user.companyId);
  const previous = {
    tableFontSize: cfg.uiDefaults.tableFontSize || null,
    tableFontSizeConfigured: Boolean(cfg.uiDefaults.tableFontSizeConfigured)
  };

  if (clear) {
    delete cfg.uiDefaults.tableFontSize;
    cfg.uiDefaults.tableFontSizeConfigured = false;
  } else {
    cfg.uiDefaults.tableFontSize = size;
    cfg.uiDefaults.tableFontSizeConfigured = true;
  }

  appendAudit(data, {
    userId: user.id,
    userName: user.nome,
    action: 'atualizacao_ui_defaults_empresa',
    resourceType: 'company_settings',
    resourceId: 'ui_defaults',
    companyId: user.companyId,
    previousValue: previous,
    newValue: {
      tableFontSize: cfg.uiDefaults.tableFontSize || null,
      tableFontSizeConfigured: Boolean(cfg.uiDefaults.tableFontSizeConfigured)
    }
  });
  store.save(data);
  return { ok: true, data: getUiDefaultsForUser(user).data };
}

function updateMyTableFont(user, tableFontSize) {
  if (!user) return { ok: false, status: 401 };
  const clear = tableFontSize == null || String(tableFontSize).trim() === '';
  const size = clear ? null : normalizeTableFontSize(tableFontSize);
  if (!clear && !size) return { ok: false, status: 400, error: 'Tamanho de fonte inválido.' };

  const data = store.load();
  const idx = (data.users || []).findIndex((u) => u.id === user.id);
  if (idx < 0) return { ok: false, status: 404, error: 'Usuário não encontrado.' };

  const record = data.users[idx];
  if (!record.preferences || typeof record.preferences !== 'object') {
    record.preferences = {};
  }
  const previous = record.preferences.tableFontSize || null;

  if (clear) {
    delete record.preferences.tableFontSize;
  } else {
    record.preferences.tableFontSize = size;
  }

  appendAudit(data, {
    userId: user.id,
    userName: user.nome,
    action: 'atualizacao_preferencia_fonte_planilha',
    resourceType: 'user',
    resourceId: user.id,
    companyId: user.companyId || null,
    previousValue: { tableFontSize: previous },
    newValue: { tableFontSize: record.preferences.tableFontSize || null }
  });
  store.save(data);
  return { ok: true, data: getUiDefaultsForUser({ ...user, preferences: record.preferences }).data };
}

module.exports = {
  TABLE_FONT_SIZES,
  DEFAULT_TABLE_FONT,
  normalizeTableFontSize,
  resolveEffectiveTableFont,
  getUiDefaultsForUser,
  updatePlatformTableFont,
  updateCompanyTableFont,
  updateMyTableFont,
  isCompanyTableFontConfigured
};
