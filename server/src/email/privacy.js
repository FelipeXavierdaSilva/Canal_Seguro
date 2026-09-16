'use strict';

/** Campos permitidos por template — qualquer outro campo bloqueia o envio. */
const ALLOWLIST = {
  password_reset: new Set(['firstName', 'actionUrl', 'channelName', 'ttlMinutes']),
  user_created: new Set(['firstName', 'actionUrl', 'channelName']),
  account_activation: new Set(['firstName', 'actionUrl', 'channelName']),
  report_update: new Set(['firstName', 'actionUrl', 'channelName', 'ctaLabel']),
  sla_alert: new Set(['firstName', 'actionUrl', 'channelName', 'ctaLabel']),
  critical_alert: new Set(['firstName', 'actionUrl', 'channelName', 'ctaLabel']),
  risk_critical: new Set(['firstName', 'actionUrl', 'channelName', 'ctaLabel'])
};

const FORBIDDEN_KEYS = new Set([
  'description',
  'involved',
  'witnesses',
  'location',
  'category',
  'categoryLabel',
  'protocol',
  'trackingCode',
  'cpf',
  'contactEmail',
  'contactPhone',
  'reporter',
  'attachments',
  'password',
  'senha',
  'token',
  'resetToken'
]);

const FORBIDDEN_SUBSTRINGS = [
  'assédio',
  'assedio',
  'denúncia',
  'denuncia',
  'cpf',
  'denunciado'
];

function templateForEvent(eventType) {
  if (
    [
      'report_new',
      'report_status',
      'report_message',
      'report_info_request',
      'report_completed'
    ].includes(eventType)
  ) {
    return 'report_update';
  }
  if (eventType === 'sla_alert') return 'sla_alert';
  if (eventType === 'critical_alert' || eventType === 'risk_critical') return 'critical_alert';
  return eventType;
}

function validatePayload(eventType, payload) {
  const template = templateForEvent(eventType);
  const allowed = ALLOWLIST[template];
  if (!allowed) return { ok: false, error: `Template desconhecido: ${template}` };

  const keys = Object.keys(payload || {});
  for (const key of keys) {
    if (FORBIDDEN_KEYS.has(key)) {
      return { ok: false, error: `Campo proibido no e-mail: ${key}` };
    }
    if (!allowed.has(key)) {
      return { ok: false, error: `Campo não permitido: ${key}` };
    }
  }

  for (const val of Object.values(payload || {})) {
    if (typeof val !== 'string') continue;
    const lower = val.toLowerCase();
    for (const bad of FORBIDDEN_SUBSTRINGS) {
      if (lower.includes(bad)) {
        return { ok: false, error: `Conteúdo sensível detectado no payload` };
      }
    }
  }

  return { ok: true, template };
}

function firstName(fullName) {
  return String(fullName || 'Usuário').trim().split(/\s+/)[0] || 'Usuário';
}

module.exports = { validatePayload, templateForEvent, firstName, ALLOWLIST };
