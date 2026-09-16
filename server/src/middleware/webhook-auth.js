'use strict';

const crypto = require('crypto');
const config = require('../config');

function timingSafeEqualStrings(a, b) {
  if (typeof a !== 'string' || typeof b !== 'string') return false;
  const ba = Buffer.from(a);
  const bb = Buffer.from(b);
  if (ba.length !== bb.length) return false;
  try {
    return crypto.timingSafeEqual(ba, bb);
  } catch {
    return false;
  }
}

function extractWebhookSecret(req) {
  const header =
    req.headers['x-cs-webhook-secret'] ||
    req.headers['x-webhook-secret'] ||
    req.headers.authorization ||
    '';
  if (typeof header === 'string' && header.startsWith('Bearer ')) {
    return header.slice(7).trim();
  }
  return String(header || '').trim();
}

function requireEmailWebhookSecret(req, res, next) {
  const expected = config.EMAIL_WEBHOOK_SECRET;
  if (!expected) {
    if (config.DEV_MODE) return next();
    return res.status(503).json({ error: 'Webhook de e-mail não configurado.' });
  }
  const provided = extractWebhookSecret(req);
  if (!provided || !timingSafeEqualStrings(provided, expected)) {
    return res.status(401).json({ error: 'Não autorizado.' });
  }
  return next();
}

module.exports = { requireEmailWebhookSecret, timingSafeEqualStrings, extractWebhookSecret };
