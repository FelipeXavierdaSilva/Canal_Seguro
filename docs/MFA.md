# MFA — Autenticação em duas etapas (Etapa 05)

Autenticação TOTP (RFC 6238) com códigos de recuperação, política por perfil e login em duas fases.

## Fluxo de login

1. `POST /api/v1/auth/login` — valida e-mail e senha.
2. Se MFA **não** exigido (ex.: apurador) → cookie `cs_session` e `{ complete: true }`.
3. Se MFA exigido e **não configurado** → cookie `cs_mfa_pending` e redirecionamento para `configurar-mfa.html`.
4. Se MFA **já ativo** → cookie `cs_mfa_pending` e redirecionamento para `verificar-mfa.html`.
5. Após verificação ou enrollment → cookie `cs_session` com claim JWT `mfa: true`.

## Endpoints

| Método | Rota | Auth | Descrição |
|--------|------|------|-----------|
| POST | `/auth/mfa/verify` | `cs_mfa_pending` | Valida TOTP |
| POST | `/auth/mfa/recovery` | `cs_mfa_pending` | Valida código de recuperação (uso único) |
| POST | `/auth/mfa/enroll/start` | pending ou sessão | Gera URI otpauth (QR) |
| POST | `/auth/mfa/enroll/confirm` | pending ou sessão | Confirma TOTP e retorna recovery codes |
| GET | `/auth/mfa/status` | pending ou sessão | Status MFA do usuário |
| POST | `/auth/mfa/disable` | sessão | Desativa (bloqueado se obrigatório) |
| POST | `/auth/mfa/recovery/regenerate` | sessão | Novos códigos (invalida sessão) |
| GET | `/settings/mfa-policy` | superadmin | Lê política |
| PUT | `/settings/mfa-policy` | superadmin | Atualiza política |
| POST | `/settings/users/:id/mfa/reset` | superadmin | Reset MFA (perda de dispositivo) |

## Política padrão

- **Obrigatório:** `superadmin`, `admin_empresa`, quem tem `reports:view_identity`
- **Opcional:** demais perfis (ex.: apurador)
- **Carência:** 7 dias após `enforcedAt` (superadmin define em Configurações)
- **Recovery codes:** 10 códigos, hash bcrypt, exibidos uma vez no enrollment

## Segurança

- Segredo TOTP cifrado com AES-256-GCM (`CS_MFA_ENCRYPTION_KEY` ou fallback `CS_JWT_SECRET`)
- Segredo **nunca** enviado ao cliente após enrollment — apenas URI otpauth na configuração
- Rate limit em verificação (IP + usuário)
- JWT final inclui `mfa: true`; sessões sem MFA rejeitadas para perfis obrigatórios
- `sessionVersion` incrementado ao reset MFA / regenerar recovery codes

## Frontend

| Página | Uso |
|--------|-----|
| `verificar-mfa.html` | Segunda etapa do login |
| `configurar-mfa.html` | Enrollment inicial (QR + recovery codes) |
| `admin/configuracoes.html` | Política MFA (superadmin) |

Modo protótipo (localStorage): login **sem** MFA — banner honesto, igual Etapa 04.

## Variáveis de ambiente

| Variável | Descrição |
|----------|-----------|
| `CS_MFA_ENCRYPTION_KEY` | Chave dedicada para cifrar segredos TOTP |
| `CS_JWT_SECRET` | Fallback da chave MFA |

## Testes

```bash
cd server
npm run seed
npm test
```

Arquivo: `server/tests/mfa.test.js`

## Auditoria

Eventos: `mfa_ativado`, `mfa_desativado`, `mfa_verificacao_sucesso`, `mfa_verificacao_falha`, `mfa_recovery_usado`, `mfa_recovery_regenerado`, `mfa_politica_alterada`, `mfa_admin_reset`

Documentação relacionada: [AUTHORIZATION-MATRIX.md](./AUTHORIZATION-MATRIX.md) · [SERVER-API-PHASE1.md](./SERVER-API-PHASE1.md)
