# Matriz de autorização — Canal Seguro (Etapa 03)

Princípio: **DENY BY DEFAULT**. O `companyId` vem **somente** do token/sessão autenticada — nunca do body, query ou localStorage.

Perfis: `superadmin` | `admin_empresa` | `apurador` | colaborador (token employee) | público

Legenda: **Permitido** / **Negado**

## Fase 1 implementada (API)

| ROTA | PERFIL | PERMISSÃO | ACESSO |
|------|--------|-----------|--------|
| `POST /api/v1/auth/login` | Público | — | Permitido (rate limit IP + e-mail) |
| `POST /api/v1/auth/forgot-password` | Público | — | Permitido (rate limit) |
| `POST /api/v1/auth/reset-password` | Público | token reset | Permitido |
| `GET /api/v1/auth/dev/last-reset-email` | DEV | — | Permitido se `CS_DEV_MODE=1` |
| `POST /api/v1/auth/logout` | Autenticado | — | Permitido |
| `GET /api/v1/auth/me` | Autenticado | — | Permitido |
| `GET /api/v1/auth/me` | Anônimo | — | Negado (401) |
| `POST /api/v1/auth/mfa/verify` | MFA pending | — | Permitido |
| `POST /api/v1/auth/mfa/recovery` | MFA pending | — | Permitido |
| `POST /api/v1/auth/mfa/enroll/*` | MFA pending / autenticado | — | Permitido |
| `GET /api/v1/settings/mfa-policy` | superadmin | — | Permitido |
| `PUT /api/v1/settings/mfa-policy` | superadmin | — | Permitido |
| `POST /api/v1/settings/users/:id/mfa/reset` | superadmin | — | Permitido |
| `GET /api/v1/auth/me` | Sessão sem MFA | perfil obrigatório | Negado (401) |
| `POST /api/v1/auth/employee/validate` | Público | — | Permitido (rate limit IP + empresa) |
| `POST /api/v1/public/consult` | Público | — | Permitido (protocolo + tracking) |
| `GET /api/v1/public/companies/:key` | Público | — | Permitido (campos públicos) |
| `GET /api/v1/reports` | admin_empresa, apurador | `reports:read` | Permitido (tenant do token) |
| `GET /api/v1/reports` | apurador | `reports:read` | Só relatos encaminhados a ele (`assigneeId` / `teamIds`) |
| `GET /api/v1/reports` | admin_empresa | query `companyId` outro tenant | Negado (ignora query) |
| `GET /api/v1/reports` | superadmin | `reports:read` | Permitido (todos ou filtro auditado) |
| `GET /api/v1/reports/:id` | tenant errado | `reports:read` | Negado (404) |
| `GET /api/v1/reports/:id` | apurador sem encaminhamento | `reports:read` | Negado (404) |
| `PATCH /api/v1/reports/:id/status` | apurador, admin_empresa | `reports:update_status` | Permitido (tenant; Apurador só se direcionado) |
| `PATCH /api/v1/reports/:id/status` | outro tenant | — | Negado (404) |
| `POST /api/v1/reports/:id/assign` | admin_empresa | `reports:assign` | Permitido (tenant; define ciência exclusiva do Apurador) |
| `POST /api/v1/reports/:id/assign` | apurador | — | Negado (403) |
| `POST /api/v1/reports/:id/observations` | apurador, admin_empresa | `reports:comment` | Permitido (tenant; Apurador só se direcionado) |
| `GET /api/v1/reports/:id` (identidade) | apurador | `reports:view_identity` | Negado (campos mascarados) |
| `GET /api/v1/reports/:id` (identidade) | admin_empresa | `reports:view_identity` | Permitido (se não anônimo) |
| `POST /api/v1/employee/reports` | Colaborador (cookie/token) | `reports:create` | Permitido (tenant do token) |
| `POST /api/v1/employee/reports` | Sem token employee | — | Negado (401) |
| `POST /api/v1/employee/reports` | Body `companyId` spoofado | — | Negado (usa tenant do token) |
| `GET /api/v1/companies/:id` | admin_empresa | — | Permitido só `:id` = tenant |
| `GET /api/v1/companies/:id` | admin_empresa outro id | — | Negado (404) |

## Fases seguintes (planejado)

| Área | Rotas futuras | Status |
|------|---------------|--------|
| Anexos | `POST /attachments/:id/download-token` | Protótipo frontend |
| Usuários CRUD | `POST /users` | Backend: superadmin / admin_empresa (tenant) |
| Empresas CRUD | `POST/PATCH /companies` | localStorage + `PUT /companies/:id` |
| Exportações | `POST /reports/export` | localStorage |
| Backup | `/admin/backups` | Stubs |
| Configurações | `/settings/*` | localStorage |

## Testes IDOR/BOLA

```bash
cd server
npm test
```

Cenários cobertos: acesso sem sessão, cross-tenant GET/PATCH, consulta pública, recuperação de senha (Etapa 04), MFA (Etapa 05).

Documentação: [SERVER-API-PHASE1.md](./SERVER-API-PHASE1.md) · [PASSWORD-RECOVERY.md](./PASSWORD-RECOVERY.md) · [MFA.md](./MFA.md)
