# Auditoria Técnica Completa — Canal Seguro

**Data:** 17/09/2026  
**Branch de auditoria:** `audit/pre-hosting-2026-09-17`  
**Ambiente:** Windows · Node.js v24.18.0 · npm 11.16.0  
**Escopo:** instalação (`npm ci`), testes, inventário, duplicidades, prontidão Hostinger  
**Regra:** nenhuma alteração de código de aplicação nesta auditoria (apenas instalação de deps e análise).

---

## 1. Sumário executivo

| Pergunta | Resposta |
|----------|----------|
| Dependências instaláveis? | **Sim** — `npm ci` em `server/` concluiu (152 pacotes) |
| Testes automatizados? | **188/190 passaram** na suíte oficial; **2 falhas** por `EADDRINUSE` na porta 3160 (ambiente). Reexecução isolada dos mesmos arquivos em portas livres: **19/19 OK** |
| Pronto para produção Hostinger agora? | **Não** — faltam evidências de ops (secrets, MySQL ausente, dual-mode front, dados JSON) |
| Remover arquivos por “nome duplicado”? | **Não** — a maioria é multi-área (público / admin / empresa) |

**Veredito:** o backend está **tecnicamente saudável** na suíte de testes quando o ambiente está limpo. O sistema **não** está pronto para ir ao ar sem checklist de implantação e decisão sobre persistência (JSON atual vs MySQL desejado).

---

## 2. Etapa — Preparação do ambiente

### 2.1 Evidências

| Item | Resultado | Classificação |
|------|-----------|---------------|
| Pasta raiz | `Sistema_Canal_de_Assédio` | OK |
| `server/package.json` | Presente | OK |
| `server/package-lock.json` | Presente | OK |
| `package.json` na raiz do site | Ausente | OK (API só em `server/`) |
| `package-lock.json` na raiz | Existe (~vazio / órfão) | **SUGESTÃO** limpar |
| Node declarado | `>=18` | OK |
| Node instalado | **v24.18.0** | OK (≥18) |
| npm | **11.16.0** | OK |
| `.env` / `.env.example` | **Ausentes** | **CONFIRMADO** |
| MySQL no código | **Nenhuma referência** | **CONFIRMADO** (gap vs meta Hostinger+MySQL) |
| Persistência atual | `server/data/store.json` + FS anexos | **CONFIRMADO** |
| Redis | Opcional (`CS_REDIS_URL`) | **RISCO** multi-instância |

### 2.2 Instalação

```text
cd server
npm ci
```

**Resultado:** sucesso — `added 152 packages`, audited 153.  
**Avisos:** deprecações `otplib` v12 / `crypto-js` / `jpeg-exif` (não bloqueiam).  
**npm audit:** 3 vulnerabilidades **moderate** (cadeia `qs` → `express`/`body-parser`). Fix disponível via `npm audit fix` — **não aplicado** nesta auditoria (regra: não atualizar deps só por aviso).

**Classificação:** instalação OK. Vulnerabilidades moderate = **RISCO** a tratar antes do go-live (após avaliação de breaking change).

---

## 3. Etapa — Testes automatizados

### 3.1 Comando oficial

```text
cd server
npm test
```

Fluxo: `npm run seed` → `node --test` (26 arquivos listados no script).

### 3.2 Resultado da suíte oficial (evidência)

| Métrica | Valor |
|---------|------:|
| Suites | 73 |
| Tests | 190 |
| **Pass** | **188** |
| **Fail** | **2** |
| Duração | ~55 s |
| Seed | OK (`Empresas: 3 \| Relatos: 12 \| Usuários: 6`) |

### 3.3 Falhas — análise

| Arquivo | Erro | Causa | Reexecução |
|---------|------|-------|------------|
| `tests/platform-support.test.js` | `listen EADDRINUSE :::3160` | Porta 3160 ocupada por processo Node antigo (PID 9204) | Em porta 3171: **5/5 pass** |
| `tests/security-p1.test.js` | `listen EADDRINUSE :::3160` | Mesma porta fixa padrão | Em porta 3172: **14/14 pass** |

**Classificação:** falhas da suíte = **problema de ambiente / isolamento de porta**, não regressão lógica confirmada.  
**SUGESTÃO:** testes devem usar porta efêmera (`listen(0)`) ou porta aleatória para evitar flake em CI/auditoria.

### 3.4 Cobertura do script vs disco

| Em `npm test` | Fora do script (existem no disco) |
|---------------|-----------------------------------|
| 26 arquivos | `commercial-contact`, `landing-pricing`, `report-measures`, `ui-defaults` |

**SUGESTÃO:** incluir no script ou documentar exclusão consciente.

### 3.5 Nota de validação (atualizada)

| Antes (deps ausentes) | Depois desta auditoria |
|----------------------:|-----------------------:|
| 3/10 | **8/10** na suíte oficial (lógica OK; flake de porta e 4 testes fora do script impedem 10/10) |

---

## 4. Etapa — Inventário

| Item | Quantidade | Observações |
|------|----------:|-------------|
| HTML | 45 | 14 raiz + 17 admin + 13 empresa + 1 partial |
| JavaScript front (`js/`) | 24 | Inclui `api.js` grande (dual-mode) |
| JavaScript `server/src` | 78 | App, rotas, services, middleware, email, utils |
| CSS | 9 | Landing + dashboard |
| Testes `*.test.js` | 30 | 26 no `npm test` |
| Rotas | 8 | auth, mfa, users, reports, public, settings, email, hard-delete |
| Serviços `*.service.js` | 37 | + storage providers |
| Middlewares | 7 | |
| Dependências npm diretas | 9 | bcryptjs, cookie-parser, cors, express, helmet, otplib, pdfkit, redis, uuid |
| Docs | ~19 | |
| Imagens | 24 | Algumas bit-idênticas / órfãs |
| Python (scripts) | 4 | Manutenção, não runtime |
| Config `.env.example` | 0 | Gap de ops |

### Pastas

| Pasta | Responsabilidade |
|-------|------------------|
| `/` | Canal público + login/MFA + páginas legais |
| `admin/` | Adm_Plataforma (multi-empresa) |
| `empresa/` | Adm_Empresa / Apurador |
| `js/` | Cliente (localStorage **ou** HTTP) |
| `css/` | Estilos compartilhados |
| `server/` | API Express + store JSON + anexos + testes |
| `docs/` | Especificações e auditorias anteriores |
| `assets/` | Mídia estática |
| `partials/` | Fragmentos HTML |
| `scripts/` | Utilitários de manutenção |

---

## 5. Etapa — Duplicidades

### 5.1 Mesmo nome ≠ lixo (manter)

| Arquivo 1 | Arquivo 2 | Tipo | Ação sugerida |
|-----------|-----------|------|---------------|
| `index.html` | `admin/index.html` | Áreas diferentes | Manter |
| `suporte.html` | `admin/suporte.html` | Público vs inbox admin | Manter |
| `admin/relatos.html` | `empresa/relatos.html` | Persona diferente | Manter |
| `admin/usuarios.html` | `empresa/usuarios.html` | Idem | Manter |
| `js/app.js` | `server/src/app.js` | Front vs Express | Manter |
| `js/auth.js` | `server/src/middleware/auth.js` | Camadas diferentes | Manter |
| `server/index.js` | `…/storage/index.js` etc. | Entry vs barrels | Manter |

### 5.2 Candidatos a limpeza (após aprovação)

| Item | Tipo | Classificação |
|------|------|---------------|
| `logo-canal-seguro.png` ≡ `mark.png` ≡ `shield.png` (mesmo hash) | Bit-idêntico | **SUGESTÃO** |
| Imagens sem referência (`hero-shield*`, etc.) | Órfãs | **SUGESTÃO** |
| `package-lock.json` vazio na raiz | Órfão | **SUGESTÃO** |
| Docs FAQ ainda citando `faq.html` deletado | Docs desatualizados | **CONFIRMADO** |
| 4 testes fora do `npm test` | Cobertura incompleta no CI | **SUGESTÃO** |

**Nenhuma exclusão foi feita nesta auditoria.**

---

## 6. Riscos de produção / Hostinger

### CONFIRMADO

1. Persistência = **JSON file**, não MySQL (meta de hospedagem ainda não implementada).
2. Sem `.env.example` — secrets obrigatórios em produção (`CS_JWT_SECRET`, `CS_CORS_ORIGIN`, `CS_CPF_PEPPER`, `CS_EMAIL_WEBHOOK_SECRET`).
3. Dual-mode front: se a API cair, UI pode cair em **localStorage** (protótipo).
4. Seed/demo com credenciais conhecidas no README — risco se forem para produção.

### RISCO

1. `NODE_ENV` não setado → defaults de desenvolvimento (JWT fraco possível).
2. `store.json` / anexos no disco local — multi-instância e backup frágeis.
3. Redis opcional — rate-limit em memória.
4. E-mail default `console` — sem SMTP não há notificação real.
5. 3 CVEs moderate em `qs` via Express.
6. Testes com porta fixa 3160 → flake (visto nesta auditoria).

### SUGESTÃO (próximos passos, com sua aprovação)

1. Criar `.env.example` e checklist Hostinger.
2. Decidir: manter JSON (V1) **ou** migrar MySQL/PostgreSQL antes do go-live.
3. Garantir front sempre em modo HTTP em produção (`CSRuntime` / health).
4. Trocar senhas demo; desabilitar seed em produção.
5. Incluir 4 testes faltantes no script; porta efêmera nos testes.
6. Avaliar `npm audit fix` em staging.
7. Limpar imagens duplicadas/órfãs e docs quebrados.

---

## 7. O que NÃO foi feito (propositalmente)

- Não reescreveu arquitetura.
- Não migrou para MySQL.
- Não removeu arquivos.
- Não aplicou `npm audit fix`.
- Não matou o processo Node na porta 3160 (ação destrutiva bloqueada; contornou-se com outra porta).
- Não implementou MFA “em duas etapas” adicionais além do já existente.
- Não inventou resultados: números vêm de `npm ci` / `npm test` / reexecução isolada.

---

## 8. Conclusão

| Critério | Status |
|----------|--------|
| Instalação | **OK** |
| Testes (lógica) | **OK** (188 + 19 revalidados; 2 fails = porta ocupada) |
| Organização | **OK** (duplicidades de nome são multi-área) |
| Segurança de base (suíte) | **Boa cobertura** (IDOR, anexos, MFA, headers) |
| Pronto para o ar | **NÃO** sem checklist de secrets, decisão de banco, SMTP, e endurecimento dual-mode |

**Recomendação:** tratar o sistema como **pré-produção estável no backend de arquivo**, não como produto Hostinger+MySQL pronto. Próximo ciclo deve ser **plano de implantação**, não novas features de negócio, até fechar os itens CONFIRMADO/RISCO acima.

---

*Relatório gerado na branch `audit/pre-hosting-2026-09-17` sem modificar o código-fonte da aplicação.*
