'use strict';

const DEFAULT_SUPPORT_EMAIL = 'contato@fxfelipexavier.com.br';
/** Número comercial padrão (SC) — exibido como informado pelo Adm. */
const DEFAULT_COMMERCIAL_WHATSAPP = '047984570646';

function ensurePlatformSettings(data) {
  if (!data.platformSettings || typeof data.platformSettings !== 'object') {
    data.platformSettings = {};
  }
  const ps = data.platformSettings;
  if (!ps.supportEmail) ps.supportEmail = DEFAULT_SUPPORT_EMAIL;
  if (ps.commercialWhatsApp == null || ps.commercialWhatsApp === '') {
    ps.commercialWhatsApp = DEFAULT_COMMERCIAL_WHATSAPP;
  }
  return ps;
}

/** Normaliza para dígitos E.164 BR (wa.me): remove 0 do DDD e prefixa 55 se necessário. */
function normalizeWhatsAppE164(raw) {
  let d = String(raw || '').replace(/\D/g, '');
  if (!d) return '';
  if (d.startsWith('0')) d = d.slice(1);
  if (!d.startsWith('55') && (d.length === 10 || d.length === 11)) d = `55${d}`;
  if (d.length < 12 || d.length > 13) return '';
  return d;
}

function formatWhatsAppDisplay(raw) {
  const stored = String(raw || '').trim();
  if (stored) return stored.slice(0, 20);
  return '';
}

function buildCommercialInterestMessage({
  planId = '',
  planName = '',
  originLabel = 'site Canal Seguro (seção Planos e preços)'
} = {}) {
  const plan =
    String(planName || '').trim() ||
    String(planId || '').trim() ||
    'disponível';
  return [
    `Olá! Cheguei pelo ${originLabel}.`,
    `Gostaria de saber mais a respeito do plano de contratação para o painel de denúncias (plano "${plan}").`
  ].join(' ');
}

function toPublicContact(ps) {
  const whatsappDisplay = formatWhatsAppDisplay(ps.commercialWhatsApp);
  const whatsappE164 = normalizeWhatsAppE164(whatsappDisplay);
  return {
    supportEmail: String(ps.supportEmail || DEFAULT_SUPPORT_EMAIL).trim(),
    commercialWhatsApp: whatsappDisplay,
    commercialWhatsAppE164: whatsappE164 || null,
    whatsappAvailable: Boolean(whatsappE164)
  };
}

function getPublicCommercialContact() {
  const store = require('../store');
  const data = store.load();
  const ps = ensurePlatformSettings(data);
  return { ok: true, data: toPublicContact(ps) };
}

function getCommercialContactForAdmin(user) {
  if (!user) return { ok: false, status: 401 };
  if (user.role !== 'superadmin') return { ok: false, status: 403, error: 'Acesso negado.' };
  const store = require('../store');
  const data = store.load();
  const ps = ensurePlatformSettings(data);
  return {
    ok: true,
    data: {
      supportEmail: ps.supportEmail || DEFAULT_SUPPORT_EMAIL,
      commercialWhatsApp: formatWhatsAppDisplay(ps.commercialWhatsApp),
      commercialWhatsAppE164: normalizeWhatsAppE164(ps.commercialWhatsApp) || null
    }
  };
}

function updateCommercialContact(user, payload = {}) {
  const store = require('../store');
  const { appendAudit } = require('./audit.service');
  if (!user) return { ok: false, status: 401 };
  if (user.role !== 'superadmin') return { ok: false, status: 403, error: 'Acesso negado.' };

  const data = store.load();
  const ps = ensurePlatformSettings(data);
  const previous = {
    supportEmail: ps.supportEmail,
    commercialWhatsApp: ps.commercialWhatsApp
  };

  if (payload.supportEmail != null) {
    const email = String(payload.supportEmail || '').trim().slice(0, 120);
    if (!email || !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email)) {
      return { ok: false, status: 400, error: 'E-mail de suporte inválido.' };
    }
    ps.supportEmail = email;
  }

  if (payload.commercialWhatsApp != null) {
    const display = formatWhatsAppDisplay(payload.commercialWhatsApp);
    if (display) {
      const e164 = normalizeWhatsAppE164(display);
      if (!e164) {
        return {
          ok: false,
          status: 400,
          error: 'WhatsApp comercial inválido. Use DDD + número (ex.: 047984570646).'
        };
      }
      ps.commercialWhatsApp = display;
    } else {
      ps.commercialWhatsApp = '';
    }
  }

  data.platformSettings = ps;
  appendAudit(data, {
    userId: user.id,
    userName: user.nome,
    action: 'atualizacao_contato_comercial',
    resourceType: 'platform_settings',
    resourceId: 'commercial_contact',
    companyId: null,
    previousValue: previous,
    newValue: {
      supportEmail: ps.supportEmail,
      commercialWhatsApp: ps.commercialWhatsApp
    }
  });
  store.save(data);
  return {
    ok: true,
    data: {
      supportEmail: ps.supportEmail,
      commercialWhatsApp: formatWhatsAppDisplay(ps.commercialWhatsApp),
      commercialWhatsAppE164: normalizeWhatsAppE164(ps.commercialWhatsApp) || null
    }
  };
}

module.exports = {
  DEFAULT_SUPPORT_EMAIL,
  DEFAULT_COMMERCIAL_WHATSAPP,
  normalizeWhatsAppE164,
  buildCommercialInterestMessage,
  getPublicCommercialContact,
  getCommercialContactForAdmin,
  updateCommercialContact,
  ensurePlatformSettings
};
