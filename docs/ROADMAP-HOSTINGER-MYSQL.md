# Roadmap Hostinger + MySQL

Objetivo: rodar o Canal Seguro no **Node.js da Hostinger** com persistência em **MySQL Hostinger**, e permitir que o **Adm_Plataforma** configure host, usuário, senha e banco em **Configurações**.

**Status do roadmap:** Etapas **1–6 concluídas**. Operação: seguir [GO-LIVE-HOSTINGER.md](./GO-LIVE-HOSTINGER.md).

---

## Princípios

1. **Não reescrever o sistema de uma vez** — adaptar o `store` atrás de uma interface.
2. **Credenciais fora do `store.json`** — arquivo `db-config.json` em `DATA_DIR` (fora do docroot) + variáveis de ambiente.
3. **Env vence arquivo** — na Hostinger, `CS_DB_*` no painel sobrescreve o que foi salvo na UI (ops / recuperação).
4. **Senha nunca volta na API** — GET só indica `hasPassword: true|false`.
5. **JSON continua funcionando** até a Etapa 5 (modo dual / cutover).
6. **Anexos** continuam em filesystem nesta fase (MySQL só para dados estruturados).

---

## Etapas e prompts

Copie o prompt da etapa, cole no chat e peça para executar **somente aquela etapa**.

### Etapa 1 — Configuração de acesso (UI + API) ✅ concluída

**Entregue:** card “Banco de dados” em Configurações; API get/save/test; `db-config.json` com senha criptografada; `.env.example`; testes `db-config.test.js` (6/6).

---

### Etapa 2 — Checklist Hostinger (ops, sem código de negócio) ✅ concluída

**Entregue:** [`docs/HOSTINGER-DEPLOY.md`](./HOSTINGER-DEPLOY.md) — app root `server`, entry `index.js`, `CS_DATA_DIR` fora do deploy, secrets de produção, MySQL interno (ainda `CS_DB_ENABLED=0`), HTTPS/CORS same-origin, o que não commitar, smoke pós-deploy.
---

### Etapa 3 — Schema MySQL + migrations ✅ concluída

**Entregue:** `server/src/db/migrations/001_initial_schema.sql` (tabelas espelhando chaves do `store.json`, colunas indexáveis + `payload` JSON); runner `npm run db:migrate` / `--dry-run`; testes `db-migrate.test.js`. **store.js ainda não usa MySQL.**

---

### Etapa 4 — Pool MySQL + adapter de leitura/escrita ✅ concluída

**Entregue:** `pool.js` + `store-mysql-adapter.js`; `store.init()` escolhe MySQL se `CS_DB_ENABLED=1` e houver dados (senão JSON); save MySQL em fila async com fallback JSON; anexos em disco; boot em `index.js` com flush no shutdown. Testes `store-mysql-adapter.test.js` (JSON default).

---

### Etapa 5 — Importação store.json → MySQL ✅ concluída

**Entregue:** `npm run db:import-json` (+ `--dry-run`, `--file=`, `--no-migrate`); import idempotente via adapter; docs [`DB-IMPORT-JSON.md`](./DB-IMPORT-JSON.md) com cutover e rollback (`CS_DB_ENABLED=0`).

---

### Etapa 6 — Hardening + go-live ✅ concluída

**Entregue:** `/api/v1/health` com `persistence` + MySQL (`?deep=1`); backup operacional a partir do estado em memória + nota mysqldump; front bloqueia localStorage fora de localhost; checklist [`GO-LIVE-HOSTINGER.md`](./GO-LIVE-HOSTINGER.md) com smoke tests.

---

## Variáveis de ambiente (MySQL)

| Variável | Descrição |
|----------|-----------|
| `CS_DB_ENABLED` | `1` para usar MySQL (após Etapa 4) |
| `CS_DB_HOST` | Host MySQL Hostinger |
| `CS_DB_PORT` | Porta (padrão `3306`) |
| `CS_DB_USER` | Usuário |
| `CS_DB_PASSWORD` | Senha |
| `CS_DB_NAME` | Nome do banco |
| `CS_DATA_DIR` | Pasta privada (store, anexos, `db-config.json`) |

---

## Ordem recomendada na Hostinger

1. Subir Node + `CS_DATA_DIR` + secrets (ainda JSON).
2. Criar banco MySQL no hPanel.
3. Etapa 1: preencher Configurações → Banco de dados → Testar.
4. Etapas 3–5: migrar e ativar `CS_DB_ENABLED=1`.
5. Etapa 6: smoke + backup — ver [GO-LIVE-HOSTINGER.md](./GO-LIVE-HOSTINGER.md).
