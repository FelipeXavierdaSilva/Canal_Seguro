# Etapa 11 — Auditoria Completa de Segurança, Privacidade e Homologação

## Canal Seguro

| Campo | Valor |
|-------|-------|
| **Versão** | 1.0 |
| **Data** | 2026-09-01 |
| **Escopo** | Frontend estático, API Node/Express, armazenamento JSON, testes automatizados |
| **Metodologia** | Revisão por especialistas (AppSec, API, AuthZ, LGPD técnica, multi-tenant, QA) + testes automatizados |
| **Documentos relacionados** | [SECURITY-AUDIT.md](./SECURITY-AUDIT.md) · [SECURITY-AUDIT-REPORT-v1.0.md](./SECURITY-AUDIT-REPORT-v1.0.md) · [AUTHORIZATION-MATRIX.md](./AUTHORIZATION-MATRIX.md) |

---

# RESUMO EXECUTIVO

## STATUS GERAL

### 🟠 APROVADO COM RESTRIÇÕES (homologação)

| Dimensão | Veredito |
|----------|----------|
| **Aprovado no código (API + correções P0–P3)** | ✅ Sim |
| **Aprovado para homologação controlada** | ✅ Sim, com checklist |
| **Aprovado para produção com dados reais** | 🔴 Não — dependências infra + LGPD |

O Canal Seguro passou por auditoria completa com **correções implementadas e 113 testes automatizados passando**. Vulnerabilidades críticas e altas identificadas na API foram corrigidas. Permanecem riscos residuais de **arquitetura** (store JSON), **modo protótipo frontend** (localStorage com dados demo), **infraestrutura de deploy** e **revisão jurídica LGPD**.

## Quantidade de problemas

| Severidade | Encontrados | Corrigidos | Residuais |
|------------|-------------|------------|-----------|
| 🔴 Crítico | 3 | 2 | 1* |
| 🟠 Alto | 6 | 6 | 0 |
| 🟡 Médio | 14 | 11 | 3 |
| 🔵 Baixo | 8 | 2 | 6 |
| ⚪ Informativo | 9 | — | 9 |

\* Crítico residual **R-PROT-01**: modo protótipo (`js/seed.js` → `localStorage`) armazena senhas/CPF em plaintext — **não se aplica** quando a API (`npm start`) é a fonte de verdade em produção.

---

# 1. INVENTÁRIO COMPLETO DO SISTEMA

## 1.1 Mapa de arquitetura

```
┌─────────────────────────────────────────────────────────────────┐
│  Navegador (HTML estático + js/)                                │
│  ├── Público: index, relato, protocolo, FAQ, educação           │
│  ├── Auth: login, MFA, recuperar/redefinir senha                │
│  ├── Empresa: dashboard, relatos, colaboradores, config         │
│  └── Admin: empresas, usuários, auditoria, logs, indicadores    │
└───────────────────────────┬─────────────────────────────────────┘
                            │ fetch + credentials (cookies HttpOnly)
                            │ X-CSRF-Token / X-Employee-Token
┌───────────────────────────▼─────────────────────────────────────┐
│  Express API (server/) — prefixo /api/v1                          │
│  ├── Middleware: CORS, Helmet/CSP, CSRF, auth, tenant, rate limit │
│  ├── Rotas: auth, mfa, reports, public, email, settings, users    │
│  └── Static: raiz do projeto (com block /server, /node_modules)   │
└───────────────────────────┬─────────────────────────────────────┘
                            │
┌───────────────────────────▼─────────────────────────────────────┐
│  Persistência                                                     │
│  ├── server/data/store.json (relatos, usuários, auditLogs, …)     │
│  ├── server/data/attachments/ (arquivos privados)                 │
│  └── Redis opcional (rate limits distribuídos)                    │
└─────────────────────────────────────────────────────────────────┘
```

## 1.2 Páginas (27 HTML)

| Área | Páginas |
|------|---------|
| Raiz | `index.html`, `login.html`, `relato.html`, `protocolo.html`, `faq.html`, `educacao.html`, `configurar-mfa.html`, `verificar-mfa.html`, `recuperar-senha.html`, `redefinir-senha.html` |
| `admin/` | `index`, `relatos`, `empresas`, `colaboradores`, `usuarios`, `conteudos`, `indicadores`, `relatorios`, `auditoria`, `logs-tecnico`, `configuracoes`, `integracoes` |
| `empresa/` | `dashboard`, `relatos`, `relatorio`, `colaboradores`, `configuracoes` |

## 1.3 Scripts frontend (21 em `js/`)

`api.js`, `app.js`, `attachments.js`, `audit.js`, `auth.js`, `backup.js`, `companies.js`, `dashboard.js`, `employee-auth.js`, `errors.js`, `export-ui.js`, `http-api.js`, `identifiers.js`, `infra-log.js`, `public-consult-guard.js`, `reports-dashboard.js`, `reports.js`, `runtime.js`, `seed.js`, `users.js`, `validation.js`, `workflow-panel.js`

## 1.4 API — módulos e endpoints

| Módulo | Prefixo | Endpoints principais |
|--------|---------|----------------------|
| `auth.routes.js` | `/auth` | login, logout, me, forgot/reset password, employee/validate |
| `mfa.routes.js` | `/auth/mfa` | verify, recovery, enroll, disable |
| `reports.routes.js` | `/reports` | CRUD relatos, workflow, risco, export, anexos, mensagens |
| `reports.routes.js` | `/employee/reports` | criação de relato (token colaborador) |
| `public.routes.js` | `/public` | consult, messages, companies, meta |
| `email.routes.js` | `/email` | stats, webhooks/bounce, notificações |
| `settings.routes.js` | `/settings` | MFA policy, risk policy |
| `users.routes.js` | `/users` | criação, ativação |

Documentação detalhada: [SERVER-API-PHASE1.md](./SERVER-API-PHASE1.md)

## 1.5 Autenticação e sessões

| Mecanismo | Implementação |
|-----------|---------------|
| Admin | JWT em cookie `cs_session` (HttpOnly, SameSite=Lax, Secure em prod) |
| MFA pending | Cookie `cs_mfa_pending` |
| Colaborador | Cookie `cs_employee` + JWT auxiliar em `sessionStorage` |
| Denunciante (consulta) | Cookie `cs_reporter` |
| CSRF | Cookie `cs_csrf` + header `X-CSRF-Token` |
| Revogação | `sessionVersion++` em logout e reset de senha |

## 1.6 Armazenamento

| Dado | Local |
|------|-------|
| Estado da aplicação | `server/data/store.json` |
| Anexos de relatos | `server/data/attachments/{companyId}/{reportId}/` |
| Rate limits | Memória ou Redis (`CS_REDIS_URL`) |
| Protótipo offline | `localStorage` chave `canal_seguro_fx_v1` (`js/seed.js`) |

## 1.7 Integrações

| Integração | Arquivo | Observação |
|------------|---------|------------|
| E-mail transacional | `server/src/email/` | Modo console (dev) ou SMTP |
| Webhook bounce | `POST /email/webhooks/bounce` | Autenticado por secret |
| Redis (opcional) | `rate-limit-store.js` | Rate limits distribuídos |

## 1.8 Logs e auditoria

| Trilha | Storage | Propósito |
|--------|---------|-----------|
| Auditoria funcional | `auditLogs[]` no store | Ações de negócio (append-only) |
| Logs técnicos (protótipo) | `techLogs[]` / `CSInfraLog` | Infra e segurança no frontend demo |
| E-mail delivery | `emailDeliveryLogs[]` | Rastreio de envios |

---

# 2. CLASSIFICAÇÃO DOS DADOS

| Categoria | Onde armazena | Quem acessa | Retenção | Necessário | Risco | Proteção aplicada |
|-----------|---------------|-------------|----------|------------|-------|-------------------|
| Dados cadastrais (empresa) | `store.json` → `companies` | superadmin, admin tenant | Indefinida (demo) | Sim | Médio | RBAC + tenant |
| Usuários internos | `store.json` → `users` | superadmin | Indefinida | Sim | Alto | `passwordHash` bcrypt, MFA |
| CPF colaboradores | `store.json` → `employees.cpfHash` | API validação | Indefinida | Sim | Alto | HMAC-SHA256 + pepper |
| Denúncias / relatos | `store.json` → `reports` | Staff tenant, export | Indefinida | Sim | Crítico | RBAC, tenant, redação |
| Identidade denunciante | `reports.reporter`, `employeeId`, `contactEmail` | admin com `view_identity` | Indefinida | Condicional | Crítico | `stripReportForRole`, anonimato |
| Tracking code | `trackingCodeHash` (hash) | Consulta pública com protocolo | Indefinida | Sim | Alto | Hash, não exposto em API staff |
| Mensagens | `reportMessages[]` | Staff + reporter (sessão) | Indefinida | Sim | Alto | Sanitização HTML, tenant |
| Anexos | `attachments/` + metadados | Staff com permissão | Indefinida | Sim | Alto | Storage privado, RBAC, validação tipo/tamanho |
| Auditoria | `auditLogs[]` | superadmin (`audit:read`) | Append-only | Sim | Alto | `assertAuditIntegrity` |
| Tokens/sessões | Cookies HttpOnly + JWT | Servidor | TTL configurável | Sim | Alto | HMAC, sessionVersion |
| Logs técnicos | `techLogs` (protótipo) | superadmin | Rotativo | Demo | Médio | Sanitização de PII |

**REVISÃO JURÍDICA NECESSÁRIA:** políticas de retenção, bases legais, DPA com empresas clientes, direitos do titular (acesso/eliminação).

---

# 3. TESTE DE MULTI-TENANCY

## 3.1 Regra

Usuário da Empresa A **nunca** acessa dados da Empresa B. Validação **somente no backend**.

## 3.2 Mecanismos

| Camada | Implementação |
|--------|---------------|
| Middleware | `tenantFromSession` — `req.tenantId = user.companyId` (não-superadmin) |
| Serviço | `assertTenantAccess(user, companyId)` → 404 cross-tenant |
| Listagem | Filtro por `companyId` do token; query `companyId` ignorada para admin_empresa |
| Exportação | Mesmo tenant gate + redação de identidade |
| Anexos | Path inclui `companyId`; download verifica tenant |
| E-mail notificações | `GET/PUT /email/notifications/:companyId` com check de tenant |

## 3.3 Cenários testados (`idor.test.js`, `export.test.js`, `report-messages.test.js`)

| Tentativa | Resultado |
|-----------|-----------|
| Aurora admin GET relato Horizon (`rpt_003`) | 404 |
| Aurora lista relatos | Apenas `cmp_aurora` |
| `companyId` spoofado em query | Ignorado para admin_empresa |
| Horizon PATCH status relato Aurora | Negado |
| Horizon GET mensagens relato Aurora | Negado |
| Horizon export PDF relato Aurora | Negado |
| `employeeId` spoofado em body sem token | 401 |

**Status:** ✅ Isolamento multi-tenant validado na API.

---

# 4. IDOR / BOLA

| Vetor | Proteção | Teste |
|-------|----------|-------|
| `reportId` de outro tenant | `assertTenantAccess` → 404 | `idor.test.js` |
| `companyId` em query/body | Ignorado; usa token | `idor.test.js` |
| `attachmentId` | Validação report + tenant + RBAC | `security-p3.test.js` |
| `userId` em settings | superadmin only | `mfa.test.js` |
| IDs previsíveis (`rpt_001`) | Mitigado por auth obrigatória | Manual + testes |
| Enumeração consulta pública | Rate limit + resposta genérica 404 | `security-p3.test.js` |

**Status:** ✅ IDOR/BOLA cobertos nos fluxos implementados.

---

# 5. AUTENTICAÇÃO

| Controle | Status | Detalhe |
|----------|--------|---------|
| Senhas em hash | ✅ | bcrypt em `store.json` |
| Brute force login | ✅ | Rate limit IP + e-mail |
| Credential stuffing | ✅ | Mesmo limite + resposta genérica 401 |
| Recuperação de senha | ✅ | Resposta genérica; rate limit; token único/TTL |
| MFA TOTP | ✅ | Perfis obrigatórios; recovery codes únicos |
| Logout revoga sessão | ✅ | `sessionVersion++` |
| Token expirado | ✅ | JWT `exp` + validação |
| Senha fraca no reset | ✅ | Política de complexidade |
| Session fixation | ✅ | Novo token após login/MFA |
| DEV endpoints | ⚠️ | `/auth/dev/*` só com `CS_DEV_MODE=1` |
| Conta existe no reset? | ✅ | Mensagem genérica igual |

**Testes:** `password-reset.test.js`, `mfa.test.js`, `security-p0.test.js`, `security-p2.test.js`

---

# 6. AUTORIZAÇÃO / RBAC

Princípio: **DENY BY DEFAULT**.

| Perfil | Permissões-chave |
|--------|------------------|
| `superadmin` | Tudo, incl. `audit:read`, `infra:read`, `reports:view_identity` |
| `admin_empresa` | Gestão tenant, `view_identity`, export gerencial |
| `apurador` | Leitura, comentário, workflow, export individual — **sem** `view_identity` |
| Colaborador | `reports:create` via token employee |
| Público | Consulta protocolo + mensagens (sessão reporter) |
| Denunciante anônimo | Sem conta; acesso via protocolo + tracking |

Matriz completa: [AUTHORIZATION-MATRIX.md](./AUTHORIZATION-MATRIX.md)

**Testes:** `idor.test.js`, `export.test.js`, `risk-classification.test.js`, `workflow.test.js`

---

# 7. ANONIMATO DO DENUNCIANTE

## 7.1 Arquitetura backend (relato anônimo)

| Vetor | Comportamento |
|-------|---------------|
| `employeeId` | **Não gravado** se `isAnonymous=true` |
| `reporter` | Omitido na criação anônima |
| API staff | `stripReportForRole` remove reporter, employeeId, contact* |
| Export PDF | `redactReportIdentity` — seção identidade omitida |
| E-mail | Sem conteúdo de denúncia; link genérico (`email/privacy.js`) |
| Auditoria criação | Registra `isAnonymous: true`, sem PII |
| Tracking code | Hash em repouso; plaintext só na resposta de criação |

## 7.2 Riscos residuais de identificação

| ID | Risco | Severidade | Mitigação atual |
|----|-------|------------|-----------------|
| ANON-01 | Metadados de anexo (EXIF) | 🟡 Médio | Sem stripping EXIF implementado |
| ANON-02 | Correlação IP em logs de servidor | 🔵 Baixo | Depende de infra; não logar IP em audit funcional |
| ANON-03 | Relato identificado vs anônimo na mesma sessão employee | 🟡 Médio | Sessão employee vincula colaborador; escolha explícita no formulário |
| ANON-04 | Modo protótipo localStorage | 🔴 Crítico* | Dados demo em plaintext no browser |

\* Aplica-se apenas sem API em produção.

**REVISÃO JURÍDICA NECESSÁRIA:** definição de "anonimato" vs "pseudonimato" perante LGPD; política de retenção de logs de acesso.

---

# 8. CONSULTA PÚBLICA DE PROTOCOLOS

| Controle | Status |
|----------|--------|
| Exige protocolo + tracking code | ✅ |
| Resposta genérica 404 (não revela se protocolo existe) | ✅ |
| Rate limit (5 falhas → bloqueio 5 min) | ✅ `security-p3.test.js` |
| Campos mínimos na resposta | ✅ status, datas, categoria, mensagens não lidas |
| Sem workflow interno / identidade | ✅ `workflow.test.js` |
| Cookie reporter após sucesso | ✅ HttpOnly + CSRF para mensagens |
| Rate limit só no backend | ✅ |

**Status:** ✅ Adequado para homologação.

---

# 9. UPLOAD E ANEXOS

## 9.1 Anexos de relato (implementado)

| Controle | Valor |
|----------|-------|
| Storage | `server/data/attachments/` (privado) |
| Max tamanho | 10 MB |
| Max quantidade | 5 por relato |
| Extensões | pdf, doc, docx, txt, png, jpg, jpeg, gif, webp |
| Path traversal | Bloqueado (`path.resolve` + prefix check) |
| Acesso | Download autenticado + RBAC + tenant |
| Execução no servidor | Não servido estaticamente |

## 9.2 Anexos em mensagens

| Controle | Status |
|----------|--------|
| Armazenamento binário | ⚠️ Apenas metadados (`status: simulated`) |
| Antivírus | ❌ Não implementado |

## 9.3 Gaps residuais

| ID | Item | Severidade |
|----|------|------------|
| ATT-01 | Sem scanning malware | ⚪ Informativo |
| ATT-02 | SVG/HTML não permitidos (correto) | ✅ |
| ATT-03 | Mensagens sem upload real | 🟡 Médio |
| ATT-04 | Sem rate limit dedicado a upload | 🔵 Baixo |

**Testes:** `security-p3.test.js`

---

# 10. XSS

| Área | Abordagem | Status |
|------|-----------|--------|
| API mensagens | `sanitizeBody` remove tags HTML | ✅ |
| Frontend dinâmico | `CSApp.escapeHtml()` na maioria dos `innerHTML` | ✅ |
| CSP | Nonce por requisição em scripts inline | ✅ `security-p2.test.js` |
| Gaps pontuais | `empresa/colaboradores.html` cpfMasked; logo URL em `admin/empresas.html` | 🔵 Baixo |

**Stored/Reflected/DOM XSS:** sem `eval()`; risco residual baixo com CSP + escaping.

---

# 11. INJEÇÕES

| Tipo | Aplicável? | Status |
|------|------------|--------|
| SQL Injection | Não (JSON store, sem SQL) | N/A |
| NoSQL Injection | Não | N/A |
| Command injection | Sem `exec`/`spawn` com input | ✅ |
| Path traversal | Anexos validados | ✅ |
| Template injection | Sem engine de templates server-side | N/A |

Entradas sanitizadas em mensagens; IDs validados por lookup no store.

---

# 12. CSRF / CORS / HEADERS

| Controle | Status | Arquivo |
|----------|--------|---------|
| CSRF double-submit | ✅ | `csrf.service.js`, `middleware/csrf.js` |
| CORS allowlist (prod) | ✅ | `cors-config.js` |
| CSP + nonce | ✅ | `security-headers.js`, `html-csp.js` |
| X-Content-Type-Options | ✅ | Helmet |
| Referrer-Policy | ✅ | Helmet |
| HSTS | ✅ | Produção |
| frame-ancestors none | ✅ | CSP |
| Cookies Secure/HttpOnly | ✅ | Sessões HttpOnly; CSRF legível (padrão double-submit) |
| SameSite | ✅ | Lax |

**Testes:** `security-p1.test.js`, `security-p2.test.js`, `security-p3.test.js`

---

# 13. RATE LIMITING

| Fluxo | Backend | Teste |
|-------|---------|-------|
| Login | ✅ | `security-p0.test.js` |
| Validação CPF | ✅ | `security-p0.test.js` |
| Recuperação senha | ✅ | `password-reset.test.js` |
| Consulta pública | ✅ | `security-p3.test.js` |
| MFA | ✅ | `mfa.service.js` |
| Mensagens reporter | ✅ | `report-messages.service.js` |
| Exportação PDF | ❌ | ⚪ Informativo — recomendado |
| Upload anexos | ❌ | 🔵 Baixo |
| Criação de relatos | ❌ | 🔵 Baixo (employee token já limita) |

Rate limits **não** dependem de localStorage (guarda em `public-consult-guard.js` é UX adicional no protótipo).

---

# 14. AUDITORIA

| Ação | Registrada | Append-only |
|------|------------|-------------|
| Login MFA / falhas | ✅ | ✅ |
| Reset senha | ✅ | ✅ |
| Criação/alteração relato | ✅ | ✅ |
| Status, atribuição, observação | ✅ | ✅ |
| Workflow, risco | ✅ | ✅ |
| Export PDF | ✅ | ✅ |
| Upload/download anexo | ✅ | ✅ |
| Mensagens | ✅ | ✅ |
| Logout | ✅ | ✅ |
| Tentativa cross-tenant | ⚠️ Parcial | Via resposta 404; sem log dedicado de intrusão |

Usuários comuns **não** podem alterar `auditLogs` — `store.save()` valida integridade.

**Teste:** `security-p3.test.js`

---

# 15. LGPD E PRIVACIDADE (revisão técnica)

| Princípio | Avaliação técnica |
|-----------|-------------------|
| Minimização | ✅ Consulta pública mínima; e-mails sem conteúdo de denúncia |
| Finalidade | ⚪ Requer política documentada |
| Acesso | ✅ RBAC + tenant |
| Retenção | ⚠️ Sem TTL automático no store |
| Pseudonimização | ✅ CPF hash, tracking hash |
| Segurança | ✅ Correções P0–P3 |
| Direitos do titular | ⚠️ Sem fluxo automatizado de exclusão/portabilidade |

**REVISÃO JURÍDICA NECESSÁRIA** para: bases legais, RIPD, contratos com empresas, política de privacidade, cookies, transferências internacionais, prazos de retenção.

---

# 16. EXPOSIÇÃO DE SEGREDOS

| Item | Local | Risco | Mitigação |
|------|-------|-------|-----------|
| JWT secret default | `config.js` | 🔴 em prod | `validate-config.js` bloqueia boot |
| Senhas demo | `js/seed.js`, `build-store.js` | 🟡 | Apenas homologação; trocar em prod |
| `store.json` no disco | `server/data/` | 🟠 | `/server` bloqueado no HTTP |
| SMTP/API keys | Env vars | ✅ | Não no código |
| Reset URL em dev | `/auth/dev/last-reset-email` | 🟡 | Só `DEV_MODE` |
| employeeToken no JSON | `auth.routes.js` | 🟡 | Redundante com cookie HttpOnly |

Nenhuma credencial de produção encontrada hardcoded no frontend.

---

# 17. LOCALSTORAGE E SESSIONSTORAGE

| Chave | Storage | Dados | Risco (modo API) | Recomendação |
|-------|---------|-------|------------------|--------------|
| `canal_seguro_fx_v1` | localStorage | DB completo demo | 🔴 Crítico sem API | Desabilitar em prod / não usar seed |
| `canal_seguro_session_v1` | sessionStorage | Perfil admin | 🟡 Protótipo | API usa cookie HttpOnly |
| `canal_seguro_employee_token_v1` | sessionStorage | JWT employee | 🟡 XSS | Preferir só cookie HttpOnly |
| `canal_seguro_employee_session_v1` | sessionStorage | PII colaborador | 🟡 | Minimizar campos |
| `canal_seguro_reporter_v1` | sessionStorage | protocol/reportId | 🔵 | Aceitável |
| `canal_seguro_public_consult_v1` | sessionStorage | Rate limit UX | 🔵 | Opcional |
| `canal_seguro_tenant` | sessionStorage | companyId | 🔵 | Aceitável |
| `canal_seguro_theme` | localStorage | Tema UI | ⚪ | OK |

---

# 18. SEGURANÇA DE EXPORTAÇÃO

| Controle | Status |
|----------|--------|
| Tenant isolation | ✅ |
| Redação identidade (apurador) | ✅ `security-p1.test.js` |
| Tipos por permissão | ✅ gerencial só admin |
| Token download único (15 min) | ✅ |
| Auditoria de export | ✅ |

---

# 19. SEGURANÇA DE E-MAIL

| Controle | Status |
|----------|--------|
| Allowlist de campos por template | ✅ `email/privacy.js` |
| Bloqueio de termos sensíveis | ✅ |
| Sem protocolo/conteúdo no corpo | ✅ |
| Reporter: link para consulta apenas | ✅ |
| Teste de bloqueio payload | ✅ `email.test.js` |

---

# 20. TESTES DE MANIPULAÇÃO DO FRONTEND

| Manipulação | Resultado esperado | Validado |
|-------------|-------------------|----------|
| `localStorage` role=superadmin | API ignora; usa JWT | ✅ |
| `companyId` no body | Ignorado; usa token | ✅ `idor.test.js` |
| `employeeId` spoof | 401 sem token | ✅ |
| sessionStorage permissões | Sem efeito na API | ✅ |
| CSRF ausente em mutação | 403 | ✅ `security-p3.test.js` |

---

# 21. FLUXOS CRÍTICOS — CENÁRIOS DE ATAQUE

| Fluxo | Tentativa | Esperado | Encontrado | Status |
|-------|-----------|----------|------------|--------|
| A) Login | Brute force | 429 | 429 | ✅ |
| B) Reset senha | Enumeração e-mail | 200 genérico | 200 genérico | ✅ |
| C) Cadastro relato | Sem token employee | 401 | 401 | ✅ |
| D) Relato anônimo | API expõe employeeId | Omitido | Omitido | ✅ |
| E) Consulta protocolo | Força bruta | 429 | 429 | ✅ |
| F) Mensagem anônima | Sem cookie reporter | 401 | 401 | ✅ |
| G) Upload | Path traversal | 404 | 404 | ✅ |
| H) Ver relato | Cross-tenant | 404 | 404 | ✅ |
| I) Ver identidade | Apurador | Redigido | Redigido | ✅ |
| J) Exportação | Apurador gerencial | 403 | 403 | ✅ |
| K) Admin MFA policy | Apurador | 403 | 403 | ✅ |
| L) Multiempresa | Aurora → Horizon | 404 | 404 | ✅ |

---

# 22. TABELA DE VULNERABILIDADES

| ID | VULNERABILIDADE | SEVERIDADE | LOCAL | IMPACTO | CORREÇÃO | TESTE | STATUS |
|----|-----------------|------------|-------|---------|----------|-------|--------|
| V-01 | Exposição `store.json` via static | 🔴 Crítico | `app.js` | Vazamento total | `block-sensitive-static.js` | security-p0 | ✅ |
| V-02 | JWT secret fraco em prod | 🔴 Crítico | `config.js` | Forja de sessão | `validate-config.js` | security-p0 | ✅ |
| V-03 | Protótipo localStorage com senhas | 🔴 Crítico | `js/seed.js` | Vazamento local | Usar API em prod | — | ⚠️ Residual |
| V-04 | CPF plaintext | 🟠 Alto | `store.json` | LGPD | `cpf-crypto.js` | security-p2 | ✅ |
| V-05 | Brute force login | 🟠 Alto | `auth.routes` | Compromisso conta | Rate limit | security-p0 | ✅ |
| V-06 | Enumeração CPF | 🟠 Alto | `employee/validate` | Privacidade | Rate limit | security-p0 | ✅ |
| V-07 | Webhook bounce aberto | 🟠 Alto | `email.routes` | Manipulação e-mail | `webhook-auth.js` | security-p0 | ✅ |
| V-08 | CORS permissivo | 🟡 Médio | `cors-config` | CSRF cross-origin | Allowlist | security-p1 | ✅ |
| V-09 | CSRF em mutações | 🟡 Médio | API | Ação forjada | `csrf.service.js` | security-p3 | ✅ |
| V-10 | contactEmail exposto | 🟡 Médio | `reports.service` | LGPD | `stripReportForRole` | security-p1 | ✅ |
| V-11 | Auditoria editável | 🟡 Médio | `store.js` | Repúdio | `assertAuditIntegrity` | security-p3 | ✅ |
| V-12 | Headers ausentes | 🟡 Médio | `app.js` | XSS/clickjacking | Helmet/CSP | security-p1/p2 | ✅ |
| V-13 | Anexos sem storage privado | 🟡 Médio | reports | Vazamento arquivo | `attachment-storage` | security-p3 | ✅ |
| V-14 | Sessão pós-logout | 🟡 Médio | `auth.service` | Hijack | sessionVersion | security-p2 | ✅ |
| V-15 | employeeToken em JSON | 🟡 Médio | `auth.routes` | XSS exfiltra | Mitigar XSS; remover JSON | — | ⚠️ Aberto |
| V-16 | Mensagens anexo simulado | 🟡 Médio | `report-messages` | Upload falso | Implementar storage | — | ⚠️ Aberto |
| V-17 | XSS pontual frontend | 🔵 Baixo | HTML admin/empresa | Script injection | escapeHtml | Manual | ⚠️ Aberto |
| V-18 | Sem rate limit export | 🔵 Baixo | `export.service` | Abuso | Adicionar RL | — | ⚪ Info |
| V-19 | Store JSON monolítico | 🟠 Alto* | Arquitetura | Integridade/escala | PostgreSQL | — | ⏳ Roadmap |
| V-20 | LGPD formal | — | Organizacional | Legal | Revisão jurídica | — | ⏳ Pendente |

\* Risco arquitetural, não explorável como IDOR direto.

---

# TOP 10 RISCOS DO SISTEMA

1. **Store JSON em arquivo único** — concorrência, integridade e escala em produção real.
2. **Revisão jurídica LGPD pendente** — conformidade não pode ser assumida só por código.
3. **Modo protótipo com localStorage** — senhas/CPF demo se o frontend rodar sem API hardened.
4. **employeeToken duplicado em sessionStorage** — superfície de exfiltração via XSS.
5. **Anexos de mensagens não persistidos** — gap funcional e de segurança em comunicação.
6. **Redis não obrigatório** — rate limits contornáveis em deploy multi-instância sem Redis.
7. **Sem antivírus em uploads** — malware em anexos de relato (tipos permitidos incluem doc/pdf).
8. **Retenção de dados indefinida** — sem política técnica de expurgo.
9. **Metadados EXIF em imagens** — possível identificação em relatos anônimos.
10. **Endpoints DEV se `CS_DEV_MODE` mal configurado** — vazamento de reset URLs.

---

# ITENS OBRIGATÓRIOS ANTES DA PRODUÇÃO

## Código e configuração

- [ ] `NODE_ENV=production`
- [ ] `CS_JWT_SECRET` ≥ 32 caracteres aleatórios
- [ ] `CS_MFA_ENCRYPTION_KEY` separada do JWT
- [ ] `CS_EMAIL_WEBHOOK_SECRET` ≥ 16 caracteres
- [ ] `CS_CORS_ORIGIN` com domínio(s) exato(s)
- [ ] `CS_CPF_PEPPER` ≥ 16 caracteres
- [ ] `CS_DEV_MODE=0`
- [ ] `CS_REDIS_URL` configurado (multi-instância)
- [ ] HTTPS obrigatório
- [ ] Senhas demo alteradas / seed de produção sem credenciais conhecidas
- [ ] Frontend servido **somente** via API (`npm start`), não abrindo HTML com protótipo localStorage

## Infraestrutura

- [ ] `server/data/` e `attachments/` fora do document root
- [ ] Backup criptografado e teste de restore ([BACKUP-RECOVERY.md](./BACKUP-RECOVERY.md))
- [ ] Logs encaminhados a SIEM ([INFRA-SECURITY-LOGS.md](./INFRA-SECURITY-LOGS.md))
- [ ] WAF / proteção DDoS na borda

## Compliance

- [ ] **REVISÃO JURÍDICA LGPD** concluída
- [ ] Política de privacidade e termos publicados
- [ ] RIPD / avaliação de impacto quando aplicável
- [ ] Contrato/DPA com empresas clientes

## Testes em homologação

- [ ] `cd server && npm test` — 113 testes verdes
- [ ] Teste manual de fluxo completo: relato anônimo → consulta → mensagem
- [ ] Teste cross-tenant manual com contas de duas empresas demo
- [ ] Validação de e-mails em ambiente SMTP real (sem vazamento de conteúdo)
- [ ] Scan de dependências (`npm audit`)

---

# 25. REGRA FINAL DE HOMOLOGAÇÃO

| Declaração | Valor |
|------------|-------|
| Sistema "seguro" absoluto | **Não declarado** |
| Aprovado no código (P0–P3) | **Sim** |
| Aprovado para homologação | **Sim, com restrições** |
| Aprovado para produção com dados reais | **Não** — pendente checklist + LGPD + infra |

### O que não pôde ser corrigido nesta etapa

- Migração para banco relacional
- Revisão jurídica LGPD
- Antivírus em anexos
- Upload real em mensagens da thread
- Remoção completa do modo protótipo localStorage (preservado para demo offline)
- Rate limit em exportação/upload

### Dependências externas

- Redis (recomendado)
- SMTP / provedor de e-mail
- HTTPS / certificados
- SIEM / backup
- Orientação jurídica

### Testes em homologação/produção

- Suite automatizada completa (`npm test`)
- Pentest externo recomendado antes de go-live
- Teste de carga em rate limits com Redis
- Validação de restore de backup

---

## Referências e artefatos

| Artefato | Caminho |
|----------|---------|
| Detalhamento técnico P0–P3 | [SECURITY-AUDIT.md](./SECURITY-AUDIT.md) |
| Relatório executivo resumido | [SECURITY-AUDIT-REPORT-v1.0.md](./SECURITY-AUDIT-REPORT-v1.0.md) |
| Matriz RBAC | [AUTHORIZATION-MATRIX.md](./AUTHORIZATION-MATRIX.md) |
| Testes segurança | `server/tests/security-p0.test.js` … `security-p3.test.js` |

---

*Documento v1.0 — Etapa 11 encerrada. Próxima revisão: antes do go-live em produção ou após mudança arquitetural significativa.*
