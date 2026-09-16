# API Canal Seguro — Etapa 03 Fase 1

Backend Node.js/Express com autenticação por cookie HttpOnly, isolamento multi-tenant e operações críticas de relatos.

## Subir o servidor

```bash
cd server
npm install
npm run seed    # gera data/store.json a partir de js/seed.js
npm start       # http://localhost:3000
```

O frontend estático é servido na **mesma origem** — abra `http://localhost:3000/index.html`.

Banner **Modo servidor (Fase 1)** indica que login, relatos e consulta pública usam a API.

## Modo fallback (sem servidor)

Abrir HTML via `file://` ou `npx serve .` sem API → continua protótipo localStorage (comportamento anterior).

## Endpoints Fase 1

| Método | Rota | Descrição |
|--------|------|-----------|
| GET | `/api/v1/health` | Health check |
| POST | `/api/v1/auth/login` | Login admin (cookie) |
| POST | `/api/v1/auth/logout` | Logout |
| GET | `/api/v1/auth/me` | Sessão atual |
| POST | `/api/v1/auth/employee/validate` | Valida CPF → token employee |
| POST | `/api/v1/public/consult` | Consulta protocolo + tracking |
| GET | `/api/v1/public/companies/:key` | Resolução tenant pública |
| GET | `/api/v1/reports` | Lista relatos (scoped) |
| GET | `/api/v1/reports/:id` | Detalhe relato |
| PATCH | `/api/v1/reports/:id/status` | Alterar status |
| POST | `/api/v1/reports/:id/assign` | Atribuir responsável |
| POST | `/api/v1/reports/:id/observations` | Observação |
| POST | `/api/v1/employee/reports` | Criar relato (token employee) |

## Segurança

- Senhas: bcrypt no servidor (`data/store.json` sem campo `senha` em texto claro).
- Sessão: JWT assinado em cookie `cs_session` HttpOnly.
- Colaborador: JWT em cookie `cs_employee` + header `X-Employee-Token`.
- **Nunca** confiar em `companyId` / `employeeId` do body para autorização.
- Respostas cross-tenant: **404** (anti-enumeração).

## Variáveis de ambiente

| Variável | Default | Uso |
|----------|---------|-----|
| `PORT` | `3000` | Porta HTTP |
| `CS_JWT_SECRET` | dev secret | Assinatura tokens (**obrigatório alterar em produção**) |
| `NODE_ENV` | — | `production` → cookie `secure` |

## Testes

```bash
cd server
npm test
```

## Frontend

- `js/runtime.js` — detecta API via `/api/v1/health`
- `js/http-api.js` — cliente HTTP (credentials: include)
- `js/api.js` / `js/auth.js` — delegam ao servidor quando disponível

Matriz completa: [AUTHORIZATION-MATRIX.md](./AUTHORIZATION-MATRIX.md)
