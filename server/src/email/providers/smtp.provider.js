'use strict';

const config = require('../../config');

async function send({ to, subject, html, text }) {
  let nodemailer;
  try {
    nodemailer = require('nodemailer');
  } catch {
    return { ok: false, error: 'nodemailer não instalado' };
  }

  if (!config.SMTP_HOST) {
    return { ok: false, error: 'CS_SMTP_HOST não configurado' };
  }

  const transporter = nodemailer.createTransport({
    host: config.SMTP_HOST,
    port: config.SMTP_PORT,
    secure: config.SMTP_SECURE,
    auth: config.SMTP_USER
      ? { user: config.SMTP_USER, pass: config.SMTP_PASS }
      : undefined
  });

  const from = config.MAIL_FROM || 'Canal Seguro <noreply@canalseguro.local>';
  const info = await transporter.sendMail({ from, to, subject, html, text });
  return { ok: true, messageId: info.messageId, mode: 'smtp' };
}

module.exports = { send };
