# Camada MySQL (Etapa 3–5)

- `migrations/*.sql` — schema espelhando chaves de `store.json`
- `migrate.js` — `npm run db:migrate`
- `pool.js` — pool mysql2
- `store-mysql-adapter.js` — load/save do documento store nas tabelas
- `import-json.js` — `npm run db:import-json`

**Persistência (`store.js`):**
- Default / testes: JSON (`store.json`)
- `CS_DB_ENABLED=1` + conexão ok + MySQL com usuários: modo MySQL
- MySQL vazio com `store.json` presente: permanece em JSON até o import
- Anexos: sempre em disco (`CS_DATA_DIR/attachments`)

Cutover e rollback: [`docs/DB-IMPORT-JSON.md`](../../../docs/DB-IMPORT-JSON.md)
