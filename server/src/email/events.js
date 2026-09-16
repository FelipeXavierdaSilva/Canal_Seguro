'use strict';

/** Catálogo de eventos transacionais — Etapa 06 */
const EMAIL_EVENTS = {
  PASSWORD_RESET: 'password_reset',
  USER_CREATED: 'user_created',
  ACCOUNT_ACTIVATION: 'account_activation',
  REPORT_NEW: 'report_new',
  REPORT_STATUS: 'report_status',
  REPORT_MESSAGE: 'report_message',
  REPORT_INFO_REQUEST: 'report_info_request',
  REPORT_COMPLETED: 'report_completed',
  SLA_ALERT: 'sla_alert',
  CRITICAL_ALERT: 'critical_alert',
  RISK_CRITICAL: 'risk_critical'
};

const EVENT_LABELS = {
  password_reset: 'Recuperação de senha',
  user_created: 'Novo usuário',
  account_activation: 'Ativação de conta',
  report_new: 'Novo relato',
  report_status: 'Alteração de status',
  report_message: 'Nova mensagem do apurador',
  report_info_request: 'Solicitação de informações',
  report_completed: 'Relato concluído',
  sla_alert: 'Alerta de SLA',
  critical_alert: 'Alerta crítico',
  risk_critical: 'Classificação de risco crítico'
};

module.exports = { EMAIL_EVENTS, EVENT_LABELS };
