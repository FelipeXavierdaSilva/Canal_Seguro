# Comunicação anônima bidirecional (Etapa 07)

Canal de mensagens entre equipe responsável e denunciante, inclusive em relatos anônimos, sem expor identidade na thread pública.

## Modelo

- **`reportMessages[]`** — entidade separada de `reportHistory` (observações internas).
- **`trackingCodeHash`** — bcrypt do código normalizado; plaintext só na resposta de criação do relato.
- **Sessão reporter** — cookie HttpOnly `cs_reporter` (JWT `typ: reporter`, TTL 45 min) após validar protocolo + código.

### Campos de mensagem

| Campo | Descrição |
|-------|-----------|
| `direction` | `company` \| `reporter` |
| `messageType` | `message` \| `info_request` \| `reply` |
| `status` | `sent` → `delivered` (abriu thread) → `read` |
| `authorLabel` | "Equipe responsável" / "Você" (sem nome real na visão pública) |

## API

### Pública (denunciante)

| Método | Rota | Auth |
|--------|------|------|
| POST | `/api/v1/public/consult` | protocolo + tracking → emite cookie |
| GET | `/api/v1/public/messages` | cookie `cs_reporter` |
| POST | `/api/v1/public/messages` | cookie `cs_reporter` |

### Staff

| Método | Rota | Permissão |
|--------|------|-----------|
| GET | `/api/v1/reports/:id/messages` | `reports:read` |
| POST | `/api/v1/reports/:id/messages` | `reports:comment` |

Body staff: `{ text, messageType?: "message"|"info_request", attachments? }`

## UI

- **`protocolo.html`** — timeline + thread + resposta após consulta válida.
- **Painel de relato** — seção "Comunicação com denunciante" separada de observação interna.
- **Listagem** — badge `Msg` quando `threadUnreadCount > 0`.

## E-mail (Etapa 06)

Novas mensagens disparam `emitReportThreadMessage` → e-mail genérico (sem corpo da mensagem). Detalhes apenas na thread autenticada.

## Privacidade

- Thread pública nunca inclui `employeeId`, CPF, nome ou e-mail do relato.
- `sanitizeBody` remove tags HTML (anti-XSS).
- Rate limit denunciante: 30 mensagens / 15 min por relato.

## Demo

```
Protocolo: CS-2026-000101
Código:    7H9K-42MP-X8QZ
```

Mensagem demo pré-seedada solicita mais detalhes sobre horário.

## Testes

```bash
cd server
npm run seed
npm test
```

Arquivo: `server/tests/report-messages.test.js`
