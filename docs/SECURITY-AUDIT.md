# Auditoria de Segurança — Canal Seguro (Etapa 11)

Documentação técnica das correções e pendências de homologação para produção.

| Campo | Valor |
|-------|-------|
| **Relatório final** | [SECURITY-AUDIT-REPORT-v1.0.md](./SECURITY-AUDIT-REPORT-v1.0.md) |
| **Auditoria completa (Etapa 11)** | [ETAPA-11-AUDITORIA-COMPLETA-v1.0.md](./ETAPA-11-AUDITORIA-COMPLETA-v1.0.md) |
| **Versão técnica** | 1.0 |
| **Última atualização** | 2026-09-01 |
| **Status geral** | ✅ P0–P3 implementados e testados — homologação com restrições |

> Para resumo executivo, consulte [SECURITY-AUDIT-REPORT-v1.0.md](./SECURITY-AUDIT-REPORT-v1.0.md).  
> Para auditoria completa (25 seções do prompt Etapa 11), consulte [ETAPA-11-AUDITORIA-COMPLETA-v1.0.md](./ETAPA-11-AUDITORIA-COMPLETA-v1.0.md).

---

## Correções P0 implementadas

### V-01 — Bloqueio de arquivos sensíveis no static root

**Problema:** `express.static` servia a raiz do projeto, expondo `server/data/store.json` via HTTP.

**Correção:**
- Middleware `blockSensitiveStatic` bloqueia `/server`, `/node_modules` e `/.git` antes do static.
- `dotfiles: 'deny'` no `express.static`.

**Arquivos:** `server/src/middleware/block-sensitive-static.js`, `server/src/app.js`

**Teste:** `server/tests/security-p0.test.js` — `GET /server/data/store.json` → 404

---

### V-02 — JWT guard em produção

**Problema:** `CS_JWT_SECRET` padrão permitia forjar sessões se não configurado em produção.

**Correção:** `assertProductionConfig()` em `server/index.js` falha no boot se:
- `NODE_ENV=production` e `CS_JWT_SECRET` ausente, igual ao default ou com menos de 32 caracteres.
- `CS_EMAIL_WEBHOOK_SECRET` ausente ou com menos de 16 caracteres.

**Arquivos:** `server/src/validate-config.js`, `server/index.js`

**Teste:** `security-p0.test.js` — validação unitária de `assertProductionConfig`

---

### V-05 / V-06 — Rate limit em login e validação de CPF

**Problema:** Brute force em `/auth/login` e enumeração de CPF em `/auth/employee/validate`.

**Correção:** `auth-rate-limit.service.js` com limites configuráveis:

| Variável | Default |
|----------|---------|
| `CS_LOGIN_MAX_FAILURES_IP` | 15 / 15 min |
| `CS_LOGIN_MAX_FAILURES_EMAIL` | 8 / 15 min |
| `CS_EMPLOYEE_VALIDATE_MAX_FAILURES_IP` | 15 / 15 min |
| `CS_EMPLOYEE_VALIDATE_MAX_FAILURES_COMPANY` | 10 / 15 min |

Respostas: `429` com `retryAfterMs`. Falhas de login retornam `401` genérico até o bloqueio.

**Arquivos:** `server/src/services/auth-rate-limit.service.js`, `server/src/routes/auth.routes.js`, `server/src/config.js`

**Testes:** `security-p0.test.js` — bloqueio após 3 falhas (limites reduzidos no teste)

---

### V-07 — Webhook bounce autenticado

**Problema:** `POST /api/v1/email/webhooks/bounce` aceitava requisições sem autenticação.

**Correção:**
- Header `X-CS-Webhook-Secret` ou `Authorization: Bearer <secret>`.
- Comparação com `timingSafeEqual`.
- Em `DEV_MODE` sem secret configurado: permite (desenvolvimento local).
- Em produção: `CS_EMAIL_WEBHOOK_SECRET` obrigatório (via `assertProductionConfig`).

**Arquivos:** `server/src/middleware/webhook-auth.js`, `server/src/routes/email.routes.js`, `server/src/config.js`

**Teste:** `security-p0.test.js` — 401 sem secret, 200 com secret válido

---

## Variáveis de ambiente — produção

```bash
NODE_ENV=production
CS_JWT_SECRET=<mínimo 32 caracteres aleatórios>
CS_MFA_ENCRYPTION_KEY=<chave separada recomendada>
CS_EMAIL_WEBHOOK_SECRET=<mínimo 16 caracteres>
CS_CORS_ORIGIN=https://seu-dominio.com
CS_CPF_PEPPER=<mínimo 16 caracteres aleatórios>
CS_REDIS_URL=redis://localhost:6379
CS_DEV_MODE=0
```

Opcionais de rate limit: `CS_LOGIN_MAX_FAILURES_IP`, `CS_LOGIN_MAX_FAILURES_EMAIL`, `CS_EMPLOYEE_VALIDATE_MAX_FAILURES_IP`, `CS_EMPLOYEE_VALIDATE_MAX_FAILURES_COMPANY`.

---

## Correções P1 implementadas

### V-10 — Redação de `contactEmail` / `contactPhone`

**Problema:** Apurador via API e exportação recebia e-mail/telefone de retorno sem permissão `reports:view_identity`.

**Correção:**
- `stripReportForRole()` remove `contactEmail` e `contactPhone` quando o usuário não tem `reports:view_identity`.
- `redactReportIdentity()` na exportação PDF aplica a mesma regra.
- `buildReportExportPayload()` inclui contato no PDF apenas para quem tem `view_identity`.
- Correção em `pdf-export.service.js`: seção "Comunicante" renderiza quando há `identity`, não só `identityNote`.

**Arquivos:** `reports.service.js`, `export-policy.service.js`, `export-data.service.js`, `pdf-export.service.js`

**Testes:** `security-p1.test.js`, `idor.test.js` (regressão)

---

### V-12 — Security headers (helmet)

**Correção:** Middleware `securityHeaders()` com `helmet`:
- `X-Content-Type-Options: nosniff`
- `Referrer-Policy: strict-origin-when-cross-origin`
- `Cross-Origin-Resource-Policy: same-site`
- `HSTS` em produção
- CSP com `nonce` por requisição (ver P2)

**Arquivos:** `server/src/middleware/security-headers.js`, `app.js`

**Teste:** `security-p1.test.js`

---

### V-08 — CORS allowlist

**Problema:** `CORS_ORIGIN: true` refletia qualquer origem com credentials.

**Correção:**
- `resolveCorsOptions()` interpreta `CS_CORS_ORIGIN` como lista separada por vírgula.
- Em dev sem env: mantém `true` (compatibilidade local).
- Em produção: `CS_CORS_ORIGIN` obrigatório (`validate-config.js`).

**Arquivos:** `server/src/middleware/cors-config.js`, `validate-config.js`, `app.js`

**Testes:** `security-p1.test.js`

---

## Correções P2 implementadas

### V-04 — CPF hasheado em repouso

**Problema:** CPF de colaboradores armazenado em plaintext no `store.json`.

**Correção:**
- `cpf-crypto.js` — HMAC-SHA256 com `CS_CPF_PEPPER` (fallback dev via `JWT_SECRET`).
- `build-store.js` — gera `cpfHash`, remove campo `cpf`.
- `validateEmployee()` — busca por hash; suporte legado a `cpf` plaintext durante migração.

**Arquivos:** `server/src/utils/cpf-crypto.js`, `build-store.js`, `public.service.js`

**Testes:** `security-p2.test.js`

**Produção:** `CS_CPF_PEPPER` obrigatório (≥ 16 chars) via `validate-config.js`.

---

### Rate limits distribuídos (Redis opcional)

**Problema:** Rate limits apenas em memória (single-process).

**Correção:**
- `rate-limit-store.js` — backend em memória (default) ou Redis quando `CS_REDIS_URL` / `REDIS_URL` configurado.
- `auth-rate-limit.service.js` migrado para API assíncrona com prefixos de chave (`login:`, `emp:`).

**Dependência:** `redis@^4.7.0` (opcional — sem URL usa memória).

**Testes:** `security-p2.test.js` (memória); Redis validado em deploy com URL real.

---

### V-14 — Revogação de sessão no logout

**Problema:** JWT permanecia válido após logout até expirar.

**Correção:** `logout()` incrementa `sessionVersion` do usuário (mesmo padrão de reset de senha).

**Arquivo:** `auth.service.js`

**Teste:** `security-p2.test.js` — `/auth/me` retorna 401 após logout

---

### CSP com nonces

**Problema:** Scripts inline sem CSP; XSS amplificado.

**Correção:**
- `security-headers.js` — CSP por requisição com `nonce` em `script-src`.
- `html-csp.js` — serve `.html` com `nonce` injetado em `<script>` inline (externos via `'self'`).
- `style-src 'unsafe-inline'` mantido (CSS existente).

**Testes:** `security-p2.test.js`

---

## P3 — Infraestrutura e endurecimento adicional

### Rate limits unificados (consulta, MFA, reset, mensagens)

**Problema:** Limites de tentativas espalhados em memória local por serviço.

**Correção:**
- `rate-limit-gate.js` — API comum (`gateAttempt`, `gateBlocked`, `clearGate`) sobre `rate-limit-store` (memória ou Redis).
- Migrados: `password-reset.service.js`, `mfa.service.js`, `public.service.js` (consulta), `report-messages.service.js` (mensagens do comunicante).
- `auth-rate-limit.service.js` — `resetForTests()` delega a `resetAllForTests()`.

**Testes:** `security-p3.test.js` (consulta pública 429).

---

### CSRF para mutações com cookie

**Problema:** Sessões via cookie vulneráveis a CSRF em mutações.

**Correção:**
- `csrf.service.js` — double-submit: cookie `cs_csrf` (legível pelo JS) + header `X-CSRF-Token`.
- `middleware/csrf.js` — aplicado em `/api/v1`; rotas públicas de login/consulta isentas.
- Tokens emitidos no login, MFA, `/auth/me`, validação de colaborador e consulta pública.
- `js/http-api.js` — envia header automaticamente em mutações.

**Testes:** `security-p3.test.js`

---

### Auditoria append-only

**Problema:** Logs de auditoria podiam ser alterados ou removidos no `store.json`.

**Correção:**
- `audit.service.js` — `appendAudit`, `assertAuditIntegrity`.
- `store.save()` valida integridade antes de gravar.

**Testes:** `security-p3.test.js`

---

### Anexos em storage privado

**Problema:** Anexos apenas como metadados; sem persistência segura.

**Correção:**
- `attachment-storage.service.js` — grava em `server/data/attachments/` (fora do static).
- Rotas `POST /reports/:id/attachments` e `GET /reports/:id/attachments/:attachmentId/download`.
- Validação de tipo/tamanho; auditoria de upload/download.

**Testes:** `security-p3.test.js`

---

## Pendências pós-P3 (compliance)

| ID | Item |
|----|------|
| — | Banco relacional (substituir JSON store) |
| — | Revisão jurídica LGPD |

---

## Executar testes de segurança

```bash
cd server
npm test
```

Suite P0: `tests/security-p0.test.js` (9 testes)  
Suite P1: `tests/security-p1.test.js` (14 testes)  
Suite P2: `tests/security-p2.test.js` (8 testes)  
Suite P3: `tests/security-p3.test.js` (7 testes)  
**Total: 113 testes**

---

## Veredito

| Escopo | Status |
|--------|--------|
| P0 — bloqueadores críticos de código | ✅ Implementado e testado |
| P1 — endurecimento (contact, helmet, CORS) | ✅ Implementado e testado |
| P2 — CPF hash, Redis RL, logout, CSP | ✅ Implementado e testado |
| P3 — CSRF, auditoria, anexos, RL unificado | ✅ Implementado e testado |
| Produção com dados reais | 🟠 Homologação com restrições |

**Relatório formal:** [SECURITY-AUDIT-REPORT-v1.0.md](./SECURITY-AUDIT-REPORT-v1.0.md)
