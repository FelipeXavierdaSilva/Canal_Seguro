'use strict';

const notification = require('./notification.service');
const queue = require('../email/queue.service');
const { consoleProvider } = require('../email/providers');

/** Fachada legada — delega à fila transacional (Etapa 06). */
async function sendPasswordResetEmail({ to, resetUrl, userName, companyId }) {
  return notification.emitPasswordReset({
    to,
    resetUrl,
    userName,
    companyId: companyId || null
  });
}

function getLastDevMail() {
  return consoleProvider.getLastDevMail();
}

module.exports = {
  sendPasswordResetEmail,
  getLastDevMail
};
