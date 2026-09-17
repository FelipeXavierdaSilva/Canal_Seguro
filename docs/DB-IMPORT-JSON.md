# Import JSON → MySQL (Etapa 5)

## Comando

```bash
cd server
npm run db:migrate          # se ainda não rodou
npm run db:import-json -- --dry-run
npm run db:import-json
```

Opções:

| Flag | Efeito |
|------|--------|
| `--dry-run` | Só lê o JSON e mostra contagens; não grava |
| `--file=PATH` | Usa outro arquivo em vez de `DATA_DIR/store.json` |
| `--no-migrate` | Não aplica migrations antes do import |

O import **não exige** `CS_DB_ENABLED=1` — basta host/user/database (env ou Configurações).

## Idempotência

Cada execução **substitui** o conteúdo das tabelas de domínio pelo snapshot do JSON (DELETE+INSERT / UPSERT). Reexecutar o mesmo arquivo produz o mesmo estado no MySQL.

Não altera anexos em `CS_DATA_DIR/attachments`.

## Cutover (passar a usar MySQL)

1. `npm run db:migrate`
2. `npm run db:import-json`
3. Definir `CS_DB_ENABLED=1` (hPanel ou Configurações → Banco de dados → habilitado)
4. Reiniciar o processo Node

## Rollback (voltar ao JSON)

1. Definir `CS_DB_ENABLED=0` (ou desmarcar “habilitado” na UI; env tem prioridade)
2. Reiniciar o Node
3. O app volta a ler/gravar `CS_DATA_DIR/store.json`

**Importante:** enquanto o app esteve em MySQL, alterações novas **não** foram gravadas automaticamente de volta no JSON (salvo fallback de erro). Se precisar do estado MySQL no arquivo:

- Exporte/backup do MySQL, **ou**
- Mantenha um backup operacional (`npm run backup`) feito **antes** do cutover e restaure o `store.json` se necessário.

Anexos em disco não dependem do cutover MySQL.
