# Anexos e quotas — Canal Seguro

## Visão geral

- Binários em FS privado: `{DATA_DIR}/attachments/{companyId}/{reportId}/…`
- Metadados em `store.json` (`status`: `simulated` | `stored`)
- Upload/download autenticados; `storageKey` **não** é exposto no GET do relato
- Abstração `StorageService` (`upload` / `download` / `delete` / `exists` / `getMetadata`)
- Provider atual: **LocalFilesystemStorage** sob `{DATA_DIR}` (aliases `put`/`get`/`remove` para compat)
- Sem S3/R2 nesta onda — stub comentado em `object-storage.stub.js`

## Limites (config central)

Definidos em `server/src/config.js` → `ATTACHMENTS` (+ helper `server/src/utils/attachment-limits.js`).

| Chave | Default |
|-------|---------|
| `MAX_ATTACHMENTS_PER_REPORT` | 5 |
| `MAX_FILE_SIZE_IMAGE` | 5 MiB |
| `MAX_FILE_SIZE_AUDIO` | 5 MiB (estrutura; **não** na allowlist) |
| `MAX_FILE_SIZE_VIDEO` | 8 MiB (estrutura; **não** na allowlist) |
| `MAX_FILE_SIZE_DOCUMENT` | 10 MiB |
| `MAX_FILE_SIZE_OTHER` | 2 MiB |
| `STORAGE_ALERT_THRESHOLDS` | 70 / 85 / 95 / 100 (%) |
| `MAX_BYTES` | 10 MiB (teto absoluto / compat A1) |
| `JSON_BODY_LIMIT` | `15mb` (somente `POST …/attachments`; demais rotas `1mb`) |
| Ext / MIME allowlist | pdf, doc(x), txt, png, jpg, jpeg, gif, webp |

Frontend: espelho em `js/attachments.js` → `CSAttachments.LIMITS` (server continua fonte da verdade).

Env opcional: `CS_ATTACHMENTS_MAX_BYTES`, `CS_MAX_FILE_SIZE_IMAGE`, `CS_MAX_FILE_SIZE_DOCUMENT`, `CS_JSON_BODY_LIMIT`, `CS_DATA_DIR`, etc.

## Simulated vs stored

- **Criação de relato** (`createReport`): anexos ficam `simulated` (metadados only — sem binário).
- **Upload real**: `POST /api/v1/reports/:id/attachments` com `dataBase64` → `stored` + arquivo em disco + incrementa `storageUsedBytes`.
- Anexos `simulated` **não** entram na quota.

## Quotas por empresa (Fase A3)

Campos aditivos em `companies[]`:

- `storageLimitBytes` — default **1 GiB** (`CS_COMPANY_STORAGE_LIMIT_BYTES`)
- `storageUsedBytes` — cache; recalculável

Regras:

- Upload bloqueia se `used + novo > limit` (400 com mensagem clara)
- Anexos `simulated` **não** contam
- Se FS falhar → não grava `stored`
- Se `store.save` falhar após write → remove arquivo órfão + `store.reload()`

Utilitário:

```bash
cd server && npm run recalc-storage
# ou: node scripts/recalculate-storage.js
```

APIs (já existentes; painel UI fora desta fase A3):

- `GET /api/v1/settings/storage-usage`
- `GET /api/v1/settings/storage-usage/:companyId`
- `PUT /api/v1/settings/storage-usage/:companyId` — superadmin define limite

Funções: `recalculateCompanyStorage(companyId)`, `recalculateAllCompanyStorage()`.

## UI admin armazenamento (Fases B1–B2)

- Página `admin/armazenamento.html` (somente **superadmin**)
- Colunas: limite, utilizado, disponível, %, barra, faixa, **alterar quota**
- Dados: `GET /api/v1/settings/storage-usage` → `{ companies: [...] }` para superadmin
- `PUT /api/v1/settings/storage-usage/:companyId` — só superadmin; min **10 MiB**, max **100 GiB** (`MIN_COMPANY_QUOTA_BYTES` / `MAX_COMPANY_QUOTA_BYTES`)
- Auditoria: `alteracao_quota_armazenamento` (previous/new value)
- Se `used > novo limit`: **não** apaga arquivos; `overLimit: true` na resposta; UI marca **Crítico**; `assertQuota` bloqueia novos uploads
- Formulário de empresas também permite editar a quota (mesma API)

## Meu armazenamento — painel da empresa (Fase B3)

- Página `empresa/meu-armazenamento.html` (**somente leitura**)
- Papéis: `admin_empresa` e `superadmin` (`initAdminShell` + `data-roles` no menu); **apurador não** vê o item nem a página (sem permissão equivalente dedicada)
- Campos: utilizado, limite, disponível, %, barra e faixa/alerta (`CSAttachments.storageBand`)
- Tenant: `GET /settings/storage-usage` da própria empresa; sem PUT no painel
- Link no menu das páginas `empresa/*`; indicador discreto no dashboard (não altera cards KPI); card curto em Identidade com link para a página
- API: apurador ainda pode ler quota (hint de anexos no relato); UI da página permanece restrita

- `CSHttpApi.uploadAttachment` / `downloadAttachment` quando `CSHttpApi.enabled()`
- Painel de anexos no detalhe do relato: upload + download HTTP, fallback protótipo
- Exibe limites por tipo (`CSAttachments.LIMITS`) e espaço disponível (`getStorageUsage`)
- Relato público continua só com metadados (sem binário no create)


- `storageKey` / paths / URLs **não** saem no GET/list de relatos nem na resposta de upload
- Upload/download exigem sessão + `assertTenantAccess` (cross-tenant → 404)
- `companyId` no body é ignorado (tenant = relato + sessão)
- Nome com `../` é sanitizado; `storageKey` adulterado é rejeitado
- Download: `Cache-Control: no-store, private`
- Tentativas negadas: audit `acesso_anexo_negado` (best-effort)
- Exclusão destrutiva **não** implementada nesta fase (protótipo front ainda bloqueia remoção)

## StorageService (Fase C1)

- Contrato: `server/src/services/storage/storage-service.js`
- Provider: `LocalFilesystemStorage` em `local-fs.storage.js` (export legado `createLocalFsStorage`)
- `attachment-storage.service.js` usa `upload` / `download` / `delete`
- Paths: `{DATA_DIR}/attachments/{companyId}/{reportId}/…` — **sem** mudança de contrato HTTP
- Stub object storage (comentado): `object-storage.stub.js` — sem S3/R2 ativo

## Integridade SHA-256 (Fase C2)

- No upload `stored`: `sha256` hex do buffer gravado no metadado do anexo
- Bytes do arquivo **não** são alterados (sem compressão/thumbnail nesta fase)
- Auditoria: `upload_anexo` (ok), `upload_anexo_falha`, `upload_anexo_bloqueado` (quota/tamanho), `download_anexo`, `acesso_anexo_negado`
- Helper: `server/src/utils/attachment-hash.js`

1. Rode a API Node (não hospedagem só PHP/HTML).
2. Defina `CS_DATA_DIR` para um caminho **fora** do document root (ex.: `/home/user/canal-data`).
3. O processo precisa de permissão de escrita em `CS_DATA_DIR` (`store.json` + `attachments/`).
4. Não publique `server/data` como estático; o middleware já bloqueia `/server`, mas o ideal é data fora da árvore pública.
5. Produção: `NODE_ENV=production` + secrets (`CS_JWT_SECRET`, `CS_CORS_ORIGIN`, etc.).

## Rollback rápido

- Remover/reverter commits da fase correspondente (ver plano Prompt 1).
- Unset `CS_DATA_DIR` volta ao default `server/data`.
- Campos `storage*` em empresas são aditivos e inofensivos se o código antigo ignorá-los.
