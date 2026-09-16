'use strict';

module.exports = {
  PORT: Number(process.env.PORT) || 3000,
  SESSION_COOKIE: 'cs_session',
  MFA_PENDING_COOKIE: 'cs_mfa_pending',
  EMPLOYEE_COOKIE: 'cs_employee',
  MFA_ENCRYPTION_KEY: process.env.CS_MFA_ENCRYPTION_KEY || '',
  SESSION_TTL_MS: 8 * 60 * 60 * 1000,
  EMPLOYEE_TTL_MS: 30 * 60 * 1000,
  REPORTER_COOKIE: 'cs_reporter',
  REPORTER_SESSION_TTL_MS: 45 * 60 * 1000,
  REPORTER_MESSAGE: {
    MAX_PER_SESSION: 30,
    WINDOW_MS: 15 * 60 * 1000
  },
  JWT_SECRET: process.env.CS_JWT_SECRET || 'canal-seguro-dev-secret-change-in-production',
  EMAIL_WEBHOOK_SECRET: process.env.CS_EMAIL_WEBHOOK_SECRET || '',
  REDIS_URL: process.env.CS_REDIS_URL || process.env.REDIS_URL || '',
  CORS_ORIGIN: process.env.CS_CORS_ORIGIN || true,
  DEV_MODE: process.env.CS_DEV_MODE === '1' || process.env.NODE_ENV !== 'production',
  MAIL_MODE: process.env.CS_MAIL_MODE || 'console',
  SMTP_HOST: process.env.CS_SMTP_HOST || '',
  PUBLIC_APP_URL: process.env.CS_PUBLIC_APP_URL || '',
  PUBLIC_CONSULT: {
    WINDOW_MS: 15 * 60 * 1000,
    MAX_FAILURES: 5,
    BLOCK_MS: 5 * 60 * 1000
  },
  PASSWORD_RESET: {
    TTL_MS: 30 * 60 * 1000,
    TTL_MINUTES: 30,
    MIN_RESPONSE_MS: 500,
    MAX_PER_IP: 5,
    IP_WINDOW_MS: 15 * 60 * 1000,
    MAX_PER_EMAIL: 3,
    EMAIL_WINDOW_MS: 60 * 60 * 1000
  },
  LOGIN: {
    MAX_FAILURES_IP: Number(process.env.CS_LOGIN_MAX_FAILURES_IP) || 15,
    MAX_FAILURES_EMAIL: Number(process.env.CS_LOGIN_MAX_FAILURES_EMAIL) || 8,
    WINDOW_MS: Number(process.env.CS_LOGIN_WINDOW_MS) || 15 * 60 * 1000
  },
  EMPLOYEE_VALIDATE: {
    MAX_FAILURES_IP: Number(process.env.CS_EMPLOYEE_VALIDATE_MAX_FAILURES_IP) || 15,
    MAX_FAILURES_COMPANY: Number(process.env.CS_EMPLOYEE_VALIDATE_MAX_FAILURES_COMPANY) || 10,
    WINDOW_MS: Number(process.env.CS_EMPLOYEE_VALIDATE_WINDOW_MS) || 15 * 60 * 1000
  },
  MFA: {
    PENDING_TTL_MS: 10 * 60 * 1000,
    ENROLL_TTL_MS: 20 * 60 * 1000,
    MIN_RESPONSE_MS: 400,
    MAX_FAILURES_IP: 20,
    MAX_FAILURES_USER: 10,
    WINDOW_MS: 15 * 60 * 1000
  },
  MAIL_PROVIDER: process.env.CS_MAIL_PROVIDER || process.env.CS_MAIL_MODE || 'console',
  MAIL_FROM: process.env.CS_MAIL_FROM || '',
  SMTP_PORT: Number(process.env.CS_SMTP_PORT) || 587,
  SMTP_SECURE: process.env.CS_SMTP_SECURE === '1',
  SMTP_USER: process.env.CS_SMTP_USER || '',
  SMTP_PASS: process.env.CS_SMTP_PASS || '',
  EMAIL: {
    WORKER_INTERVAL_MS: Number(process.env.CS_EMAIL_WORKER_INTERVAL_MS) || 5000,
    BATCH_SIZE: Number(process.env.CS_EMAIL_BATCH_SIZE) || 10,
    MAX_ATTEMPTS: Number(process.env.CS_EMAIL_MAX_ATTEMPTS) || 3,
    DEDUPE_WINDOW_MS: Number(process.env.CS_EMAIL_DEDUPE_WINDOW_MS) || 15 * 60 * 1000,
    SLA_CHECK_INTERVAL_MS: Number(process.env.CS_EMAIL_SLA_CHECK_INTERVAL_MS) || 60 * 60 * 1000
  },
  /** Diretório de dados (store.json + attachments). Em produção Hostinger Node: fora do docroot. */
  DATA_DIR: process.env.CS_DATA_DIR || '',
  ATTACHMENTS: {
    /** @deprecated use MAX_ATTACHMENTS_PER_REPORT — mantido para compat */
    MAX_COUNT: Number(process.env.CS_ATTACHMENTS_MAX_COUNT) || 5,
    MAX_ATTACHMENTS_PER_REPORT: Number(process.env.CS_ATTACHMENTS_MAX_COUNT) || 5,
    /** Teto absoluto (compat A1 / JSON body); validação por tipo usa MAX_FILE_SIZE_* */
    MAX_BYTES: Number(process.env.CS_ATTACHMENTS_MAX_BYTES) || 10 * 1024 * 1024,
    /** Fase A2 — limites por categoria (bytes). Áudio/vídeo preparados; allowlist atual não os aceita. */
    MAX_FILE_SIZE_IMAGE: Number(process.env.CS_MAX_FILE_SIZE_IMAGE) || 5 * 1024 * 1024,
    MAX_FILE_SIZE_AUDIO: Number(process.env.CS_MAX_FILE_SIZE_AUDIO) || 5 * 1024 * 1024,
    MAX_FILE_SIZE_VIDEO: Number(process.env.CS_MAX_FILE_SIZE_VIDEO) || 8 * 1024 * 1024,
    MAX_FILE_SIZE_DOCUMENT: Number(process.env.CS_MAX_FILE_SIZE_DOCUMENT) || 10 * 1024 * 1024,
    MAX_FILE_SIZE_OTHER: Number(process.env.CS_MAX_FILE_SIZE_OTHER) || 2 * 1024 * 1024,
    /** Percentuais de alerta de consumo (UI/ops); não altera upload sozinho */
    STORAGE_ALERT_THRESHOLDS: [70, 85, 95, 100],
    DEFAULT_COMPANY_QUOTA_BYTES:
      Number(process.env.CS_COMPANY_STORAGE_LIMIT_BYTES) || 5 * 1024 * 1024 * 1024,
    /** Fase B2 — limites ao editar quota por empresa (teto = plano Corporativo) */
    MIN_COMPANY_QUOTA_BYTES: Number(process.env.CS_MIN_COMPANY_QUOTA_BYTES) || 10 * 1024 * 1024,
    MAX_COMPANY_QUOTA_BYTES: Number(process.env.CS_MAX_COMPANY_QUOTA_BYTES) || 2 * 1024 * 1024 * 1024 * 1024,
    /**
     * Limite do express.json SOMENTE em POST /api/v1/reports/:id/attachments.
     * Demais rotas permanecem em 1mb.
     * 15mb cobre o maior MAX_FILE_SIZE_* atual (documento 10mb) em base64 (~4/3) + envelope JSON.
     */
    JSON_BODY_LIMIT: process.env.CS_JSON_BODY_LIMIT || '15mb',
    /** Allowlist atual — sem áudio/vídeo nesta fase */
    ALLOWED_EXTENSIONS: ['pdf', 'doc', 'docx', 'txt', 'png', 'jpg', 'jpeg', 'gif', 'webp'],
    ALLOWED_MIME: [
      'application/pdf',
      'application/msword',
      'application/vnd.openxmlformats-officedocument.wordprocessingml.document',
      'text/plain',
      'image/png',
      'image/jpeg',
      'image/gif',
      'image/webp'
    ]
  }
};
