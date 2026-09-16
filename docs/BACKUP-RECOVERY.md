# Backup e recuperação — Canal Seguro

Documentação técnica para ambiente de **produção**. O protótipo front-end (`localStorage`) **não** executa backup real; este documento define a arquitetura alvo e a integração via `js/backup.js` / API REST.

---

## 1. Dados incluídos no backup

| Domínio | Entidades / coleções | Storage produção |
|---------|----------------------|------------------|
| Empresas | `companies` | PostgreSQL |
| Usuários e permissões | `users` (`role`, `company_id`) | PostgreSQL |
| Colaboradores | `employees` | PostgreSQL |
| Relatos | `reports` | PostgreSQL |
| Histórico / observações | `report_history` | PostgreSQL |
| Mensagens do relato | `report_messages` | PostgreSQL |
| Classificação de risco | `report_risk_history` | PostgreSQL |
| Workflow de apuração | `report_workflow_history` | PostgreSQL |
| Anexos | `report_attachments` + **binários** | DB (metadados) + Object Storage |
| Auditoria de negócio | `audit_logs` | PostgreSQL (append-only) |
| Logs técnicos | `tech_logs` | PostgreSQL / log imutável |
| Configurações | `platform_settings`, `company_settings` (protocolo, workflow, e-mail, risco) | PostgreSQL |
| Categorias / status | `categories`, `statuses` | PostgreSQL |
| Conteúdos CMS | `contents` (FAQ, Informação e Prevenção, artigos, materiais) | PostgreSQL |
| Notificações | `notifications` | PostgreSQL |
| Auditoria de backup | `backup_runs`, `backup_audit_logs` | PostgreSQL / log imutável |

**Excluídos:** sessões, preferência de tema, tokens de reset de senha, fila de e-mail efêmera, rate limit de consulta pública.

O snapshot DEV do protótipo (`CSBackup.exportDevSnapshot`) inclui as mesmas coleções editáveis pelo **painel administrador** (empresas, usuários, colaboradores, relatos e históricos, **conteúdos FAQ/educação**, configurações e auditoria).

---

## 2. Onde os backups ficam

| Componente | Local | Acesso |
|------------|-------|--------|
| Dump PostgreSQL (full) | Bucket privado `s3://…/backups/db/` | IAM role do job apenas |
| WAL / incremental | Mesma região, lifecycle curto | Automático |
| Réplica off-site | Região secundária (cross-region replication) | Break-glass + MFA |
| Anexos | Bucket `s3://…/attachments/` versionado | Sem URL pública |
| Manifest + checksum | Junto ao dump (`manifest.json`) | Verificação automatizada |

**Nunca** armazenar backup no mesmo volume único do banco primário sem réplica externa.

---

## 3. Frequência e retenção

| Tipo | Frequência | Retenção |
|------|------------|----------|
| Full (DB + manifest anexos) | Diário 02:00 UTC | 30 dias |
| Incremental DB | WAL / PITR contínuo | 14 dias WAL |
| Sync anexos | Pós-upload + delta diário | Versionamento 90 dias |
| Full semanal | Domingo | 12 semanas |
| Archive mensal | Dia 1 | 12 meses (cold) |

Identificação de cada backup:

```
backup_id:      bkp_2026-09-01T02-00-00Z_full
schema_version: 16
checksum:       sha256:…
encrypted:      true (SSE-KMS)
status:         completed | failed | incomplete | verified
```

---

## 4. Criptografia e controle de acesso

- **Em trânsito:** TLS 1.2+
- **Em repouso:** SSE-KMS (ou equivalente)
- **Acesso humano:** role `superadmin` + MFA; sem endpoints públicos
- **Backups nunca expostos** via CDN ou link permanente

---

## 5. Verificação de integridade

1. Gerar `manifest.json` com SHA-256 por artefato.
2. Job pós-backup valida tamanho e checksum.
3. Restore dry-run mensal em **staging** isolado.
4. Marcar backup como `verified` ou registrar falha.
5. Alertas (e-mail/Slack) em `backup_falhou` / `backup_incompleto`.

---

## 6. Recuperação (runbook resumido)

| Cenário | Ação |
|---------|------|
| Corrupção lógica | PITR para timestamp anterior |
| Perda do banco | Restore último full + replay WAL |
| Anexo ausente | Restore objeto por `storage_key` |
| Perda de região | Failover bucket réplica + restore DB na DR |

**RPO sugerido:** ≤ 24 h (full diário + WAL)  
**RTO sugerido:** ≤ 4 h (equipe + runbook)

Restauração em **produção** não deve ser acionada pela UI sem runbook; usar staging primeiro.

---

## 7. Tratamento de falhas

| Falha | Comportamento |
|-------|----------------|
| Banco indisponível | Retry exponencial; status `failed`; alerta |
| Storage indisponível | Tentar bucket secundário; não marcar OK |
| Backup incompleto | Abortar; remover partial objects; `incomplete` |
| Erro de conexão | 3 tentativas; dead-letter |
| Falta de espaço | Alerta crítico; pausar política até limpeza |

Eventos registrados em auditoria técnica (`backup_iniciado`, `backup_concluido`, `backup_falhou`, etc.).

---

## 8. API REST (integração futura)

Substituir stubs em `CSBackup` por `fetch` quando `window.CS_BACKUP_API_BASE` estiver definido:

```
GET    /api/v1/admin/backups
GET    /api/v1/admin/backups/:id
POST   /api/v1/admin/backups
POST   /api/v1/admin/backups/:id/verify
POST   /api/v1/admin/backups/:id/restore   (target=staging only)
GET    /api/v1/admin/backups/policy
```

Headers: `Authorization: Bearer …`, role `superadmin`.

---

## 9. Protótipo atual

- Dados em `localStorage` (`canal_seguro_fx_v1`).
- `CSBackup.getStatus()` → `mode: prototype`; lista entidades cobertas (inclui CMS admin).
- **Exportar snapshot DEV** (`exportDevSnapshot`) — superadmin; JSON com edições do painel (FAQ, educação, empresas, etc.); arquivo rotulado `DEV-SNAPSHOT`.
- **Importar snapshot DEV** (`importDevSnapshot`) — superadmin; substitui o store local e recarrega a página.
- Botão **Restaurar dados demo** — reinicia seed; **não** é restore de backup.

---

## 10. Teste de restauração

Checklist mensal: [backup/RESTORE-TEST-CHECKLIST.md](./backup/RESTORE-TEST-CHECKLIST.md)

---

## 11. Referências no código

| Arquivo | Função |
|---------|--------|
| `js/backup.js` | Contrato `CSBackup` |
| `js/audit.js` | Labels de ações técnicas |
| `admin/configuracoes.html` | Painel informativo (superadmin) |
| `js/seed.js` | Schema `_meta.version` |
