-- 001_initial_schema.sql
-- Espelho das chaves principais de store.json (Etapa 3).
-- Colunas indexáveis + payload JSON com o documento completo.
-- Anexos binários continuam no filesystem (CS_DATA_DIR/attachments).

CREATE TABLE IF NOT EXISTS schema_migrations (
  id INT UNSIGNED NOT NULL AUTO_INCREMENT,
  name VARCHAR(255) NOT NULL,
  applied_at DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
  PRIMARY KEY (id),
  UNIQUE KEY uq_schema_migrations_name (name)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

-- _meta
CREATE TABLE IF NOT EXISTS store_meta (
  id VARCHAR(64) NOT NULL,
  payload JSON NOT NULL,
  updated_at DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3) ON UPDATE CURRENT_TIMESTAMP(3),
  PRIMARY KEY (id)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

-- Flags top-level booleanas (ex.: __supportFaqsChanged)
CREATE TABLE IF NOT EXISTS store_flags (
  flag_key VARCHAR(128) NOT NULL,
  flag_value TINYINT(1) NOT NULL DEFAULT 0,
  updated_at DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3) ON UPDATE CURRENT_TIMESTAMP(3),
  PRIMARY KEY (flag_key)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

-- platformSettings (singleton)
CREATE TABLE IF NOT EXISTS platform_settings (
  id VARCHAR(64) NOT NULL,
  payload JSON NOT NULL,
  updated_at DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3) ON UPDATE CURRENT_TIMESTAMP(3),
  PRIMARY KEY (id)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

-- companySettings (mapa companyId -> objeto)
CREATE TABLE IF NOT EXISTS company_settings (
  company_id VARCHAR(64) NOT NULL,
  payload JSON NOT NULL,
  updated_at DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3) ON UPDATE CURRENT_TIMESTAMP(3),
  PRIMARY KEY (company_id)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

CREATE TABLE IF NOT EXISTS companies (
  id VARCHAR(64) NOT NULL,
  nome_fantasia VARCHAR(255) NULL,
  razao_social VARCHAR(255) NULL,
  cnpj VARCHAR(32) NULL,
  dominio VARCHAR(255) NULL,
  status VARCHAR(64) NULL,
  storage_limit_bytes BIGINT NULL,
  storage_used_bytes BIGINT NULL,
  created_at VARCHAR(64) NULL,
  payload JSON NOT NULL,
  PRIMARY KEY (id),
  KEY idx_companies_status (status),
  KEY idx_companies_dominio (dominio)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

CREATE TABLE IF NOT EXISTS users (
  id VARCHAR(64) NOT NULL,
  email VARCHAR(255) NULL,
  username VARCHAR(128) NULL,
  nome VARCHAR(255) NULL,
  role VARCHAR(64) NULL,
  company_id VARCHAR(64) NULL,
  status VARCHAR(64) NULL,
  is_platform_master TINYINT(1) NULL,
  session_version INT NULL,
  created_at VARCHAR(64) NULL,
  payload JSON NOT NULL,
  PRIMARY KEY (id),
  UNIQUE KEY uq_users_email (email),
  KEY idx_users_company (company_id),
  KEY idx_users_role (role)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

CREATE TABLE IF NOT EXISTS employees (
  id VARCHAR(64) NOT NULL,
  company_id VARCHAR(64) NULL,
  nome VARCHAR(255) NULL,
  email VARCHAR(255) NULL,
  matricula VARCHAR(128) NULL,
  status VARCHAR(64) NULL,
  cpf_hash VARCHAR(128) NULL,
  created_at VARCHAR(64) NULL,
  payload JSON NOT NULL,
  PRIMARY KEY (id),
  KEY idx_employees_company (company_id),
  KEY idx_employees_cpf_hash (cpf_hash)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

CREATE TABLE IF NOT EXISTS reports (
  id VARCHAR(64) NOT NULL,
  protocol VARCHAR(128) NULL,
  company_id VARCHAR(64) NULL,
  category VARCHAR(128) NULL,
  status VARCHAR(64) NULL,
  is_anonymous TINYINT(1) NULL,
  assignee_id VARCHAR(64) NULL,
  risk_level VARCHAR(64) NULL,
  workflow_stage VARCHAR(64) NULL,
  created_at VARCHAR(64) NULL,
  updated_at VARCHAR(64) NULL,
  payload JSON NOT NULL,
  PRIMARY KEY (id),
  UNIQUE KEY uq_reports_protocol (protocol),
  KEY idx_reports_company (company_id),
  KEY idx_reports_status (status),
  KEY idx_reports_assignee (assignee_id)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

CREATE TABLE IF NOT EXISTS report_history (
  id VARCHAR(64) NOT NULL,
  report_id VARCHAR(64) NULL,
  user_id VARCHAR(64) NULL,
  action VARCHAR(128) NULL,
  date_at VARCHAR(64) NULL,
  payload JSON NOT NULL,
  PRIMARY KEY (id),
  KEY idx_report_history_report (report_id)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

CREATE TABLE IF NOT EXISTS report_messages (
  id VARCHAR(64) NOT NULL,
  report_id VARCHAR(64) NULL,
  direction VARCHAR(64) NULL,
  message_type VARCHAR(64) NULL,
  status VARCHAR(64) NULL,
  actor_user_id VARCHAR(64) NULL,
  created_at VARCHAR(64) NULL,
  payload JSON NOT NULL,
  PRIMARY KEY (id),
  KEY idx_report_messages_report (report_id)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

CREATE TABLE IF NOT EXISTS report_risk_history (
  id VARCHAR(64) NOT NULL,
  report_id VARCHAR(64) NULL,
  company_id VARCHAR(64) NULL,
  protocol VARCHAR(128) NULL,
  level VARCHAR(64) NULL,
  created_at VARCHAR(64) NULL,
  payload JSON NOT NULL,
  PRIMARY KEY (id),
  KEY idx_report_risk_report (report_id),
  KEY idx_report_risk_company (company_id)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

CREATE TABLE IF NOT EXISTS report_workflow_history (
  id VARCHAR(64) NOT NULL,
  report_id VARCHAR(64) NULL,
  company_id VARCHAR(64) NULL,
  protocol VARCHAR(128) NULL,
  previous_stage VARCHAR(64) NULL,
  new_stage VARCHAR(64) NULL,
  created_at VARCHAR(64) NULL,
  payload JSON NOT NULL,
  PRIMARY KEY (id),
  KEY idx_report_workflow_report (report_id),
  KEY idx_report_workflow_company (company_id)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

CREATE TABLE IF NOT EXISTS contents (
  id VARCHAR(64) NOT NULL,
  type VARCHAR(64) NULL,
  title VARCHAR(512) NULL,
  slug VARCHAR(255) NULL,
  company_id VARCHAR(64) NULL,
  status VARCHAR(64) NULL,
  sort_order INT NULL,
  created_at VARCHAR(64) NULL,
  payload JSON NOT NULL,
  PRIMARY KEY (id),
  KEY idx_contents_company (company_id),
  KEY idx_contents_type (type)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

CREATE TABLE IF NOT EXISTS notifications (
  id VARCHAR(64) NOT NULL,
  type VARCHAR(64) NULL,
  company_id VARCHAR(64) NULL,
  report_id VARCHAR(64) NULL,
  protocol VARCHAR(128) NULL,
  is_read TINYINT(1) NULL,
  created_at VARCHAR(64) NULL,
  payload JSON NOT NULL,
  PRIMARY KEY (id),
  KEY idx_notifications_company (company_id),
  KEY idx_notifications_report (report_id)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

CREATE TABLE IF NOT EXISTS audit_logs (
  id VARCHAR(64) NOT NULL,
  date_at VARCHAR(64) NULL,
  user_id VARCHAR(64) NULL,
  action VARCHAR(128) NULL,
  resource_type VARCHAR(64) NULL,
  resource_id VARCHAR(64) NULL,
  company_id VARCHAR(64) NULL,
  payload JSON NOT NULL,
  PRIMARY KEY (id),
  KEY idx_audit_company (company_id),
  KEY idx_audit_action (action),
  KEY idx_audit_date (date_at)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

CREATE TABLE IF NOT EXISTS tech_logs (
  id VARCHAR(64) NOT NULL,
  created_at VARCHAR(64) NULL,
  payload JSON NOT NULL,
  PRIMARY KEY (id)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

CREATE TABLE IF NOT EXISTS categories (
  id VARCHAR(64) NOT NULL,
  label VARCHAR(255) NULL,
  sort_order INT NULL,
  payload JSON NOT NULL,
  PRIMARY KEY (id)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

CREATE TABLE IF NOT EXISTS statuses (
  id VARCHAR(64) NOT NULL,
  label VARCHAR(255) NULL,
  sort_order INT NULL,
  payload JSON NOT NULL,
  PRIMARY KEY (id)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

CREATE TABLE IF NOT EXISTS support_faqs (
  id VARCHAR(64) NOT NULL,
  audience VARCHAR(64) NULL,
  enabled TINYINT(1) NULL,
  sort_order INT NULL,
  updated_at VARCHAR(64) NULL,
  payload JSON NOT NULL,
  PRIMARY KEY (id),
  KEY idx_support_faqs_audience (audience)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

CREATE TABLE IF NOT EXISTS platform_support_threads (
  id VARCHAR(64) NOT NULL,
  company_id VARCHAR(64) NULL,
  status VARCHAR(64) NULL,
  created_at VARCHAR(64) NULL,
  updated_at VARCHAR(64) NULL,
  payload JSON NOT NULL,
  PRIMARY KEY (id),
  KEY idx_platform_support_company (company_id),
  KEY idx_platform_support_status (status)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

CREATE TABLE IF NOT EXISTS storage_upgrade_requests (
  id VARCHAR(64) NOT NULL,
  company_id VARCHAR(64) NULL,
  status VARCHAR(64) NULL,
  created_at VARCHAR(64) NULL,
  payload JSON NOT NULL,
  PRIMARY KEY (id),
  KEY idx_storage_upgrade_company (company_id),
  KEY idx_storage_upgrade_status (status)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

CREATE TABLE IF NOT EXISTS password_reset_tokens (
  id VARCHAR(64) NOT NULL,
  user_id VARCHAR(64) NULL,
  expires_at VARCHAR(64) NULL,
  payload JSON NOT NULL,
  PRIMARY KEY (id),
  KEY idx_password_reset_user (user_id)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

CREATE TABLE IF NOT EXISTS email_queue (
  id VARCHAR(64) NOT NULL,
  status VARCHAR(64) NULL,
  created_at VARCHAR(64) NULL,
  payload JSON NOT NULL,
  PRIMARY KEY (id),
  KEY idx_email_queue_status (status)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

CREATE TABLE IF NOT EXISTS email_delivery_logs (
  id VARCHAR(64) NOT NULL,
  created_at VARCHAR(64) NULL,
  payload JSON NOT NULL,
  PRIMARY KEY (id)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

CREATE TABLE IF NOT EXISTS email_dedupe_keys (
  id VARCHAR(64) NOT NULL,
  created_at VARCHAR(64) NULL,
  payload JSON NOT NULL,
  PRIMARY KEY (id)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

CREATE TABLE IF NOT EXISTS email_suppressions (
  id VARCHAR(64) NOT NULL,
  created_at VARCHAR(64) NULL,
  payload JSON NOT NULL,
  PRIMARY KEY (id)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;
