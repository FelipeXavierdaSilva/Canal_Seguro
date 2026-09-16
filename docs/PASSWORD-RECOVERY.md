# Recuperação segura de senha — Etapa 04

Fluxo profissional de "Esqueci minha senha" implementado **somente no servidor** (`server/`).

## Fluxo

1. Login → **Esqueci minha senha** → `recuperar-senha.html`
2. Usuário informa e-mail
3. API responde sempre com mensagem genérica (200)
4. Se o e-mail existir: token seguro (32 bytes, base64url), TTL 30 min, hash SHA-256 no store
5. E-mail DEV: link impresso no **console do servidor**
6. Usuário abre `redefinir-senha.html?token=...`
7. Define senha forte → sessões anteriores invalidadas (`sessionVersion`)

## Segurança

| Requisito | Implementação |
|-----------|----------------|
| Sem senha em texto puro | bcrypt no `passwordHash` |
| Não revelar e-mail existente | Mesma resposta + delay mínimo 500ms |
| Token uso único | `usedAt` após reset |
| Token não em logs | Só hash persistido; link só no e-mail DEV |
| Rate limit | 5/IP/15min, 3/e-mail/1h |
| Senha forte | Servidor: 10+ chars, maiúsc/minúsc/número, lista fraca |
| Invalidar sessões | `sessionVersion` no JWT (`sv`) |
| Auditoria | `solicitacao_recuperacao_senha`, `redefinicao_senha` |

## Endpoints

| Método | Rota | Descrição |
|--------|------|-----------|
| POST | `/api/v1/auth/forgot-password` | Solicitar reset |
| GET | `/api/v1/auth/reset-password/validate?token=` | Validar token |
| POST | `/api/v1/auth/reset-password` | Nova senha |
| GET | `/api/v1/auth/dev/last-reset-email` | DEV: último link (`CS_DEV_MODE=1`) |

## Testar manualmente

```bash
cd server
npm run seed
CS_DEV_MODE=1 npm start
```

1. Abra http://localhost:3000/recuperar-senha.html
2. E-mail: `admin@aurora-demo.com.br`
3. Veja o link no **terminal do servidor**
4. Abra o link e defina senha (ex.: `MinhaSenha9A`)

Ou: `GET http://localhost:3000/api/v1/auth/dev/last-reset-email`

## Testes automatizados

```bash
cd server
npm test
```

Cenários: token expirado, usado, inválido, rate limit, e-mail inexistente, senha fraca, reutilização, sessão antiga.

## Produção

Configure:

- `CS_JWT_SECRET` — segredo forte
- `CS_PUBLIC_APP_URL` — URL base do frontend (links no e-mail)
- `CS_SMTP_HOST` (+ credenciais) — envio real de e-mail
- `CS_DEV_MODE=0` — desativa endpoint DEV

Matriz de autorização: [AUTHORIZATION-MATRIX.md](./AUTHORIZATION-MATRIX.md)
