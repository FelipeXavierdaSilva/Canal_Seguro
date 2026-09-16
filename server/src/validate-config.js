'use strict';

const DEFAULT_JWT_SECRET = 'canal-seguro-dev-secret-change-in-production';

function assertProductionConfig() {
  if (process.env.NODE_ENV !== 'production') return;

  const jwtSecret = process.env.CS_JWT_SECRET || '';
  if (!jwtSecret || jwtSecret === DEFAULT_JWT_SECRET || jwtSecret.length < 32) {
    throw new Error(
      'CS_JWT_SECRET deve ser definido em produção com pelo menos 32 caracteres e diferente do valor padrão de desenvolvimento.'
    );
  }

  const webhookSecret = process.env.CS_EMAIL_WEBHOOK_SECRET || '';
  if (!webhookSecret || webhookSecret.length < 16) {
    throw new Error(
      'CS_EMAIL_WEBHOOK_SECRET deve ser definido em produção com pelo menos 16 caracteres.'
    );
  }

  const corsOrigin = process.env.CS_CORS_ORIGIN || '';
  if (!corsOrigin.trim()) {
    throw new Error(
      'CS_CORS_ORIGIN deve ser definido em produção com a lista de origens permitidas (ex.: https://app.exemplo.com).'
    );
  }

  const cpfPepper = process.env.CS_CPF_PEPPER || '';
  if (!cpfPepper || cpfPepper.length < 16) {
    throw new Error(
      'CS_CPF_PEPPER deve ser definido em produção com pelo menos 16 caracteres para hash de CPF.'
    );
  }
}

module.exports = { assertProductionConfig, DEFAULT_JWT_SECRET };
