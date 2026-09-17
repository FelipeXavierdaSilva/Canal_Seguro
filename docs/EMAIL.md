# E-mail transacional — Etapa 06

Sistema profissional de envio de e-mails **somente pelo backend**, com fila, retry, dedupe, templates privados e política por empresa.

## Princípios de privacidade

- Assuntos genéricos: *"Nova atualização disponível no Canal Seguro"*
- **Nunca** incluir no assunto/corpo: descrição da denúncia, nome do denunciado, CPF, categoria sensível, anexos
- Logs armazenam `toHash` (SHA-256 truncado), não o e-mail em claro
- `privacy.js` bloqueia payloads com campos proibidos antes do envio

## Eventos

| Evento | ID | Gatilho |
|--------|-----|---------|
| Recuperação de senha | `password_reset` | `POST /auth/forgot-password` |
| Novo usuário | `user_created` | `POST /api/v1/users` |
| Ativação de conta | `account_activation` | `POST /api/v1/users/:id/activate` |
| Novo relato | `report_new` | `POST /employee/reports` → **somente Adm_Empresa** (+ e-mail cadastral se `notifyCompanyEmail`). Apuradores **não** são notificados até o encaminhamento |
| Relato encaminhado | `report_assigned` | `POST /reports/:id/assign` → Apurador responsável (`notifyAssignee` / `notifyTeam`) |
| Alteração de status | `report_status` | `PATCH /reports/:id/status` → Adm_Empresa + responsável direcionado |
| Mensagem do apurador | `report_message` | `POST /reports/:id/observations` |
| Solicitação de informações | `report_info_request` | `observations` com `kind: "info_request"` |
| Relato concluído | `report_completed` | status → `concluido` |
| Alerta SLA | `sla_alert` | Worker (dias no status) |
| Alerta crítico | `critical_alert` | Worker (relato parado) |

## Arquitetura

```
Serviço de negócio → notification.service → queue.service → worker → provider (console/SMTP)
```

- **Fila:** `store.json` → `emailQueue[]` (preparado para Redis/BullMQ)
- **Retry:** 1 min, 5 min, 30 min (max 3 tentativas)
- **Dedupe:** janela 15 min por `dedupeKey`
- **Bounce:** `POST /api/v1/email/webhooks/bounce` → suppress list

## API

| Método | Rota | Perfil |
|--------|------|--------|
| GET | `/api/v1/email/stats` | superadmin |
| GET | `/api/v1/email/delivery-logs` | superadmin |
| GET | `/api/v1/email/dev/last` | DEV |
| GET/PUT | `/api/v1/email/notifications/:companyId` | superadmin / admin tenant |
| PUT | `/api/v1/companies/:id` | superadmin (completo) / admin_empresa (contato + identidade) |
| POST | `/api/v1/email/webhooks/bounce` | webhook |
| POST | `/api/v1/users` | superadmin / admin_empresa (tenant: Adm_Empresa ou Apurador) |
| POST | `/api/v1/users/:id/activate` | superadmin / admin tenant |

## Variáveis de ambiente

```bash
CS_MAIL_PROVIDER=console|smtp
CS_SMTP_HOST=
CS_SMTP_PORT=587
CS_SMTP_USER=
CS_SMTP_PASS=
CS_MAIL_FROM="Canal Seguro <noreply@dominio.com>"
CS_PUBLIC_APP_URL=http://localhost:3000
CS_EMAIL_SYNC=1          # processa fila síncrona (testes)
CS_EMAIL_WORKER_INTERVAL_MS=5000
```

## Testar

```bash
cd server
npm run seed
npm start
```

1. Recuperação de senha → console do servidor  
2. Criar relato (colaborador) → e-mail para admins Aurora  
3. Alterar status → e-mail genérico  
4. Admin → Integrações → painel de fila/logs  

```bash
npm test   # inclui tests/email.test.js
```

## Configuração por empresa

`companySettings[companyId].emailNotifications` — toggles por evento, roles destinatárias, SLA (dias), alerta crítico.

### Novo relato → e-mail cadastral

- Campo: `events.report_new.notifyCompanyEmail` (padrão: `true`)
- Destino: `companies[].email` (fallback: `replyTo` da política)
- UI: **Adm. Plataforma** → Empresas (formulário) · **Adm. Empresa** → Empresa → “Notificação de novos relatos”
- O corpo do e-mail permanece genérico (sem descrição/protocolo/identidade do denunciante)

Documentação relacionada: [PASSWORD-RECOVERY.md](./PASSWORD-RECOVERY.md) · [AUTHORIZATION-MATRIX.md](./AUTHORIZATION-MATRIX.md)
