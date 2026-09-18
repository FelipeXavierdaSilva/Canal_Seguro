# Deploy Hostinger (Node.js) — Canal Seguro

Checklist operacional para subir o sistema na **Hostinger Node.js** com HTTPS, dados privados e MySQL preparado (ainda **sem** migrar persistência — dados continuam em `store.json` + anexos em disco).

Relacionado: [ROADMAP-HOSTINGER-MYSQL.md](./ROADMAP-HOSTINGER-MYSQL.md) · [`.env.example`](../.env.example)

---

## 1. O que você está implantando

| Camada | Onde fica |
|--------|-----------|
| API Express + front estático | Processo Node (`server/index.js`) |
| Front (`index.html`, `admin/`, `empresa/`, `js/`, `css/`) | Servido pelo Express a partir da **raiz do repositório** (um nível acima de `server/`) |
| Dados | `STORE_DATA_DIR` ou `{home}/private/canal-seguro-data` → `store.json`, anexos, backups |
| MySQL | Criado no hPanel; **não** usado como store até as Etapas 3–5 (`CS_DB_ENABLED=0`) |

O front detecta a API em `mesmo-domínio/api/v1/health` (`js/runtime.js`). Em produção, **same-origin** é o caminho suportado (sem abrir o HTML como arquivo local).

---

## 2. Pré-requisitos no hPanel

1. Plano com **Node.js** (não basta hospedagem só PHP/estática).
2. Domínio (ou subdomínio) com **SSL** ativo (Let’s Encrypt no hPanel).
3. Banco **MySQL** criado (Databases) — anote host, porta, usuário, senha, nome do banco.
4. Repositório Git completo do projeto (ou upload do zip **inteiro**, não só a pasta `server/`).

Node.js: **18+** (preferência **20** ou **22**). O `package.json` do servidor exige `>=18`.

---

## 3. Layout no painel Node.js

O `package.json` da API está em `server/`. O Express serve o front de `../..` relativo a `server/src` (= raiz do repo).

### Configuração recomendada

| Campo hPanel | Valor |
|--------------|--------|
| **Root directory** (app root) | `server` (recomendado) **ou** `.` (raiz do repo, com `package.json` na raiz) |
| **Entry file** | `index.js` (se root=`server`) **ou** use Start command `npm start` na raiz |
| **Build command** | `npm ci && npm run build` (copia o front para `server/public`) |
| **Start** | A Hostinger inicia o **entry file**; equivalente a `node index.js` / `npm start` dentro de `server/` |
| **PORT** | Use a variável `PORT` injetada pela Hostinger (o app já lê `process.env.PORT`) |

O frontend **não** usa Vite/Webpack (`dist`/`build`). São HTML/JS/CSS estáticos. O script `npm run build` em `server/` publica esses arquivos em `server/public/` para o Express servir com Application root = `server`.

### Atenção ao monorepo / root `server`

Se a Hostinger **só** publicar o conteúdo de `server/` e omitir `admin/`, `js/`, `index.html`, etc., o site quebrará (404 no front) **a menos que** o Build command rode `npm run build` com o repositório completo (gera `server/public`).

**Como verificar após o deploy:**

- `GET https://seudominio/api/v1/health` → `{ "ok": true, ... }`
- `GET https://seudominio/` → landing (HTML)
- `GET https://seudominio/login.html` → página de login
- Log de start deve mostrar `Frontend root: .../server/public` (ou a raiz do repo)

Se a API sobe mas o HTML não: confira o Build command (`npm ci && npm run build`) e se o deploy inclui a **raiz do repositório**. Alternativa: Application root = `.` e `npm start` via `package.json` na raiz.

### Comando de start (referência)

Dentro de `server/`:

```bash
npm ci
npm run seed    # só na 1ª vez / se não houver store.json no diretório de dados
npm start       # node index.js
```

Em produção Hostinger o processo fica sob o entry file; rode o **seed** uma vez via terminal SSH/console do app ou como passo manual pós-deploy (não deixe `seed` apagar dados reais depois do go-live).

---

## 4. Pasta de dados fora do docroot / fora do deploy

O app resolve o diretório assim (mesmo caminho no seed e no runtime):

1. `STORE_DATA_DIR` se definido
2. caso contrário: `{os.homedir()}/private/canal-seguro-data`

**Nunca** use placeholder literal como `/home/USUARIO/...` — isso causa `EACCES` no build.

| Evitar | Preferir |
|--------|----------|
| `server/data` dentro do Git deploy | Default automático via `os.homedir()` |
| Path com `USUARIO` copiado de exemplo | `STORE_DATA_DIR` com path real da conta, se precisar |

Exemplo opcional (path real da conta Hostinger, sem placeholder):

```bash
STORE_DATA_DIR=/home/u123456789/private/canal-seguro-data
```

Conteúdo esperado nessa pasta:

- `store.json` — estado da aplicação (até migrar MySQL)
- `attachments/` — arquivos de relatos
- `db-config.json` — credenciais MySQL da UI (Etapa 1), se não usar só env
- `backups/` — backups operacionais

Na primeira subida, `npm run seed` (ou `store.init()`) cria a pasta e o `store.json` a partir de `store.seed.json` se ainda não existir. O seed **não** sobrescreve `store.json` existente.

O middleware bloqueia HTTP em `/server`, `/data`, etc.; mesmo assim **não** use o docroot como pasta de dados.

---

## 5. Variáveis de ambiente (obrigatórias em produção)

Definir no hPanel → **Environment variables** (não no Git).  
`NODE_ENV=production` ativa `validate-config.js`, que **recusa** subir sem estes itens:

| Variável | Regra |
|----------|--------|
| `NODE_ENV` | `production` |
| `CS_JWT_SECRET` | ≥ 32 caracteres; **diferente** do secret de desenvolvimento |
| `CS_CPF_PEPPER` | ≥ 16 caracteres (hash de CPF) |
| `CS_EMAIL_WEBHOOK_SECRET` | ≥ 16 caracteres |
| `CS_CORS_ORIGIN` | Origem(ões) HTTPS do site, ex.: `https://seudominio.com.br` |

Fortemente recomendadas:

| Variável | Uso |
|----------|-----|
| `STORE_DATA_DIR` | Opcional — pasta privada; default `{home}/private/canal-seguro-data` |
| `CS_PUBLIC_APP_URL` | `https://seudominio.com.br` (links de e-mail / reset) |
| `CS_MFA_ENCRYPTION_KEY` | Criptografia MFA (se já usada no ambiente) |
| `PORT` | Normalmente a Hostinger injeta; não force porta errada |

Same-origin (recomendado):

```bash
CS_CORS_ORIGIN=https://seudominio.com.br
CS_PUBLIC_APP_URL=https://seudominio.com.br
```

Se o site for `www` e apex, liste as duas origens no formato aceito pelo app (mesmo valor de produção que você usa no DNS/SSL).

Modelo completo: [`.env.example`](../.env.example).

---

## 6. MySQL Hostinger (preparar, não migrar)

Nesta etapa o app **continua em JSON** (`CS_DB_ENABLED=0`).

1. hPanel → **Databases** → criar banco + usuário.
2. Anotar:
   - **Host** — use o host **interno** mostrado no painel (muitas vezes `localhost` ou hostname interno Hostinger; não exponha MySQL na internet).
   - **Porta** — em geral `3306`
   - Usuário, senha, nome do banco
3. Opcional já na Etapa 1:
   - Preencher **Admin → Configurações → Banco de dados** e **Testar conexão**, **ou**
   - Definir no env (tem prioridade sobre o arquivo):

```bash
CS_DB_ENABLED=0
CS_DB_HOST=localhost
CS_DB_PORT=3306
CS_DB_USER=...
CS_DB_PASSWORD=...
CS_DB_NAME=...
```

Só ative `CS_DB_ENABLED=1` depois das Etapas 3–5 (schema + adapter + import).

---

## 7. HTTPS e cookies

- Force HTTPS no domínio (hPanel / SSL).
- O app usa `trust proxy` e cookies `secure` em produção — sem HTTPS, login/MFA quebram.
- Não misture `http://` em `CS_PUBLIC_APP_URL` / `CS_CORS_ORIGIN` em produção.

---

## 8. O que NÃO commitar

| Item | Motivo |
|------|--------|
| `.env` / `.env.local` / arquivos com senhas | Segredos |
| `server/data/store.json` com dados reais | LGPD / vazamento |
| `server/data/attachments/**` | Evidências de relatos |
| `server/data/db-config.json` | Credenciais MySQL |
| `server/data/backups/**` | Cópias completas do sistema |
| `server/node_modules/` | Já no `.gitignore` do server |
| Chaves MFA, dumps SQL de produção | Segredos / PII |

Pode versionar: `.env.example`, este guia, código-fonte, assets públicos de marca.

Antes de commitar, confira `git status` e nunca force-add pastas `data/`.

---

## 9. Checklist pós-deploy (smoke)

Use a lista completa em [GO-LIVE-HOSTINGER.md](./GO-LIVE-HOSTINGER.md). Mínimo:

1. `https://seudominio/api/v1/health` e `?deep=1`
2. Landing e login no mesmo domínio
3. Relato + consulta por protocolo
4. Backup operacional (+ mysqldump se MySQL ativo)

---

## 10. Ordem sugerida (ops)

1. Garantir pasta de dados gravável (default `{home}/private/canal-seguro-data` ou `STORE_DATA_DIR`)  
2. Configurar env (secrets + CORS + DATA_DIR) com `CS_DB_ENABLED=0`  
3. Deploy do repositório completo + entry `server/index.js`  
4. Seed **uma vez** no DATA_DIR (ou copiar store inicial)  
5. Smoke HTTPS + login  
6. Criar MySQL e testar conexão (UI ou env)
7. Aplicar schema: `cd server && npm run db:migrate` (Etapa 3)
8. Importar: `npm run db:import-json` (ver [DB-IMPORT-JSON.md](./DB-IMPORT-JSON.md)); depois `CS_DB_ENABLED=1` e reiniciar
9. Smoke + Etapa 6. Rollback: `CS_DB_ENABLED=0` e reiniciar

---

## 11. Limitações conscientes (Etapa 2)

- Persistência ainda é **arquivo JSON**, não MySQL.
- Redeploy **apaga** dados se eles estiverem dentro da pasta publicada — por isso o default usa `{home}/private/...` (fora do deploy).
- Anexos permanecem em disco local do Node (não object storage).
- Dual-mode localStorage no navegador só entra se a API `health` falhar; em produção a API deve estar sempre no ar no mesmo host.
