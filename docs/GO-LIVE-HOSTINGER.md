# Go-live Hostinger + MySQL (Etapa 6)

Checklist final após Etapas 1–5. Complementa [HOSTINGER-DEPLOY.md](./HOSTINGER-DEPLOY.md) e [DB-IMPORT-JSON.md](./DB-IMPORT-JSON.md).

---

## 1. Antes do cutover

- [ ] Secrets no hPanel: `CS_JWT_SECRET`, `CS_CPF_PEPPER`, `CS_EMAIL_WEBHOOK_SECRET`, `CS_CORS_ORIGIN`, `CS_PUBLIC_APP_URL`
- [ ] `CS_DATA_DIR` fora da pasta de deploy
- [ ] SSL/HTTPS ativo no domínio
- [ ] `npm run db:migrate` + `npm run db:import-json` (ou dry-run revisado)
- [ ] Backup operacional gerado no painel (Configurações → Backup) **antes** de `CS_DB_ENABLED=1`
- [ ] (Opcional) Export MySQL no hPanel (mysqldump) se já houver dados de teste no banco

---

## 2. Cutover

1. `CS_DB_ENABLED=1` (env ou Configurações → Banco de dados)
2. Reiniciar o app Node
3. Confirmar logs: `Persistência: mysql`

### Rollback rápido

1. `CS_DB_ENABLED=0`
2. Reiniciar Node  
→ volta a `store.json`. Ver [DB-IMPORT-JSON.md](./DB-IMPORT-JSON.md).

---

## 3. Health check

```bash
# Básico (front / probe)
curl -sS https://SEU_DOMINIO/api/v1/health

# Com ping MySQL (quando habilitado ou ?deep=1)
curl -sS "https://SEU_DOMINIO/api/v1/health?deep=1"
```

Esperado em produção com MySQL:

```json
{
  "ok": true,
  "persistence": { "mode": "mysql", "storeFileExists": true },
  "mysql": { "connected": true, "enabled": true, "checked": true }
}
```

Se `persistence.mode` for `mysql` e o banco cair → HTTP **503** (`ok: false`).

---

## 4. Backup (dados + anexos)

| Tipo | O quê | Como |
|------|--------|------|
| Operacional | Snapshot do store (memória→JSON) + pasta `attachments/` | Admin → Configurações → Backup → Gerar |
| MySQL | Dump do schema/dados SQL | hPanel → Databases → Backup / mysqldump |
| Off-site | Copiar `CS_DATA_DIR/backups/` | Cron/SFTP periódico |

Em modo MySQL o backup operacional **não substitui** o mysqldump; os dois são recomendados antes de deploy.

---

## 5. Front: sem fallback localStorage em produção

- Em hosts que **não** são `localhost` / `127.0.0.1`, se `/api/v1/health` falhar, a UI **bloqueia** (não usa localStorage como banco).
- Override de emergência: `window.CS_FORCE_API = false` (só diagnóstico).
- Dev local continua podendo usar protótipo offline.

Arquivos: `js/runtime.js` (`requireServer`), `js/app.js` (banner).

---

## 6. Smoke test (manual)

Marque após o cutover:

| # | Fluxo | OK? |
|---|--------|-----|
| 1 | `GET /api/v1/health` e `?deep=1` | ☐ |
| 2 | Landing `https://dominio/` carrega | ☐ |
| 3 | Login Adm_Plataforma (+ MFA se ativo) | ☐ |
| 4 | Login Adm_Empresa | ☐ |
| 5 | Criar relato público (canal da empresa) | ☐ |
| 6 | Consulta por protocolo + senha | ☐ |
| 7 | Abrir relato no painel empresa | ☐ |
| 8 | Upload de anexo (se usado) | ☐ |
| 9 | Configurações → Banco de dados mostra modo mysql | ☐ |
| 10 | Gerar backup operacional | ☐ |

---

## 7. Critérios de go-live

Pronto para uso real quando:

1. Health `ok: true` com `persistence.mode` desejado (`mysql` ou `json` consciente)
2. Smoke 1–8 OK
3. Pelo menos um backup operacional verificado
4. Plano de rollback (`CS_DB_ENABLED=0`) conhecido pela equipe
5. Anexos sob `CS_DATA_DIR` sobrevivem a um redeploy de teste
