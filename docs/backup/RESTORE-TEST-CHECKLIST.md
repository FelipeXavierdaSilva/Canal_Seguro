# Checklist — teste de restauração de backup

Executar **mensalmente** em ambiente **staging** isolado (nunca primeiro teste em produção).

---

## Pré-requisitos

- [ ] Backup full mais recente com status `completed`
- [ ] Manifest com checksum SHA-256 disponível
- [ ] Ambiente staging vazio ou descartável
- [ ] Credenciais superadmin de teste
- [ ] Runbook `docs/BACKUP-RECOVERY.md` à mão

---

## Procedimento

### 1. Preparação

- [ ] Registrar início em auditoria técnica (`restore_teste_iniciado`)
- [ ] Anotar `backup_id`, data/hora e `schema_version`

### 2. Restore do banco

- [ ] Restaurar dump PostgreSQL no staging
- [ ] Aplicar WAL até ponto desejado (se PITR)
- [ ] Validar migrations / `schema_version`

### 3. Restore de anexos

- [ ] Restaurar objetos do bucket conforme manifest
- [ ] Conferir amostra de 5 `storage_key` vs registros em `report_attachments`

### 4. Validação de dados

- [ ] Contagem de `companies`, `users`, `employees`, `reports`
- [ ] Amostrar 5 relatos: protocolo, `company_id`, status, histórico
- [ ] Verificar `audit_logs` append-only (últimas entradas)
- [ ] Verificar `platform_settings` e `company_settings`

### 5. Smoke test funcional

- [ ] Login superadmin staging
- [ ] Listar relatos de uma empresa
- [ ] Abrir ficha de relato (sem expor dados em log)
- [ ] Consulta pública de protocolo (ambiente de teste)

### 6. Integridade

- [ ] Comparar checksum do dump com manifest
- [ ] Tempo total de restore dentro do RTO acordado
- [ ] Registrar `restore_teste_concluido` ou `restore_teste_falhou` com evidências

---

## Critérios de sucesso

- Restore completo sem erro crítico
- Contagens dentro de tolerância (±0) vs manifest
- Smoke test 100% OK
- Evidência arquivada (ticket + hash do backup)

---

## Em caso de falha

1. Não promover backup à produção
2. Abrir incidente; marcar backup como `failed` / `unverified`
3. Repetir após correção da causa raiz
4. Documentar lições aprendidas no runbook
