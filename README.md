# Canal Seguro – FX Felipe Xavier

Plataforma multiempresa (multi-tenant) para orientação, prevenção e comunicação responsável de situações relacionadas a assédio, discriminação, violência e outras condutas que possam prejudicar o ambiente de trabalho.

**Produto:** Canal Seguro  
**Administração central:** FX – Felipe Xavier | Segurança do Trabalho  
**Stack do protótipo:** HTML5, CSS3, JavaScript (ES6+) puro

---

## Como abrir

### Modo servidor (recomendado — Etapa 03 Fase 1)

Autenticação, relatos e consulta pública validados no backend:

```bash
cd server
npm install
npm run seed
npm start
```

Abra **http://localhost:3000/index.html**. Documentação: [docs/SERVER-API-PHASE1.md](docs/SERVER-API-PHASE1.md) · [docs/AUTHORIZATION-MATRIX.md](docs/AUTHORIZATION-MATRIX.md) · [docs/PASSWORD-RECOVERY.md](docs/PASSWORD-RECOVERY.md) · [docs/MFA.md](docs/MFA.md)

**MFA (Etapa 05):** superadmin e admins de empresa devem configurar autenticador no primeiro login via servidor. Apurador entra sem MFA.

**E-mail transacional (Etapa 06):** notificações enviadas pelo backend; ver [docs/EMAIL.md](docs/EMAIL.md).

### Modo protótipo (somente frontend)

Abra `index.html` em um navegador moderno ou use:

```bash
npx serve .
```

Persistência em `localStorage` — **não** usar como solução definitiva.

---

## Áreas do sistema

| Área | Caminho |
|------|---------|
| Canal público | `index.html` |
| Educação | `educacao.html` |
| FAQ | `faq.html` |
| Fazer relato | `relato.html` |
| Consultar protocolo | `protocolo.html` |
| Login | `login.html` |
| Painel da empresa | `empresa/` |
| Colaboradores (CPF) | `empresa/colaboradores.html`, `admin/colaboradores.html` |
| Painel FX | `admin/` |

---

## Contas de demonstração

| Perfil | E-mail | Senha |
|--------|--------|-------|
| Superadmin FX | `admin@fxfelipexavier.com.br` | `fxadmin123` |
| Admin Aurora | `admin@aurora-demo.com.br` | `empresa123` |
| Admin Horizon | `admin@horizon-demo.com.br` | `empresa123` |
| Apurador Aurora | `apuracao@aurora-demo.com.br` | `empresa123` |

### CPFs demo para relato (colaboradores cadastrados)

| Empresa | CPF | Nome |
|---------|-----|------|
| Aurora | `529.982.247-25` | Juliana Costa (fictício) |
| Aurora | `111.444.777-35` | Fernanda Oliveira (fictício) |
| Horizon | `390.533.447-05` | Maria Silva (fictício) |
| Verde Campo | `403.644.788-29` | João Santos (fictício) |

Protocolos de exemplo: `CS-2026-000101`, `CS-2026-000112`

---

## Multi-tenant

Cada empresa possui cores, nome do canal, mensagem e domínio.  
Selecione a empresa na home ou use `?empresa=cmp_aurora` (também `cmp_horizon`, `cmp_verde`).

---

## Arquitetura front-end

- `js/api.js` — camada pronta para futura API REST (`fetch`)
- `js/seed.js` — dados fictícios (3 empresas, 12 relatos)
- `js/auth.js` — sessão simulada (`sessionStorage`)
- Persistência de demo: `localStorage` (**não** usar como solução definitiva)

### Entidades previstas para o banco

`companies`, `users`, `reports`, `report_categories`, `report_status`, `report_history`, `attachments`, `contents`, `notifications`, `audit_logs`, `settings`

---

## O que é real neste protótipo

Navegação, formulários, validações, dashboards, gráficos, filtros, CRUD de empresas/conteúdos/usuários (local), geração de protocolo, consulta pública de status, temas claro/escuro.

## O que depende de back-end

**Fase 1 implementada (`server/`):** autenticação segura, isolamento multi-tenant, relatos, consulta pública, token de colaborador — ver [docs/SERVER-API-PHASE1.md](docs/SERVER-API-PHASE1.md).

**Etapa 04 implementada:** recuperação segura de senha — ver [docs/PASSWORD-RECOVERY.md](docs/PASSWORD-RECOVERY.md).

**Ainda no protótipo frontend:** anonimato operacional completo, upload seguro de anexos, CRUD usuários/empresas via API, exportações PDF/Excel, auditoria imutável server-side, LGPD operacional, **backup** ([docs/BACKUP-RECOVERY.md](docs/BACKUP-RECOVERY.md)), e-mails, criptografia de CPF.
