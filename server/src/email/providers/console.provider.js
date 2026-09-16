'use strict';

const config = require('../../config');

let lastDevMail = null;

async function send({ to, subject, html, text, eventType, actionUrl }) {
  const payload = {
    to,
    subject,
    eventType,
    sentAt: new Date().toISOString(),
    previewText: String(text || '').slice(0, 200),
    resetUrl: actionUrl || null
  };
  lastDevMail = payload;
  console.log('\n[Canal Seguro – e-mail transacional – DEV]');
  console.log(`Evento: ${eventType}`);
  console.log(`Para: ${to}`);
  console.log(`Assunto: ${subject}`);
  console.log(`Texto: ${payload.previewText}`);
  console.log('(Corpo HTML omitido no log — sem dados sensíveis.)\n');
  return { ok: true, messageId: `dev_${Date.now()}`, mode: 'console' };
}

function getLastDevMail() {
  if (!config.DEV_MODE) return null;
  return lastDevMail;
}

function resetForTests() {
  lastDevMail = null;
}

module.exports = { send, getLastDevMail, resetForTests };
