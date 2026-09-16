'use strict';

const config = require('../../config');
const consoleProvider = require('./console.provider');
const smtpProvider = require('./smtp.provider');

function getProvider() {
  if (config.MAIL_PROVIDER === 'smtp' && config.SMTP_HOST) {
    return smtpProvider;
  }
  return consoleProvider;
}

module.exports = { getProvider, consoleProvider, smtpProvider };
