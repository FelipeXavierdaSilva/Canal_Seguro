# Bundles JavaScript — Canal Seguro

Mapa de dependências (Etapa 10) e bundles otimizados por tipo de página.

## Ordem base (quando todos os módulos são usados)

0. `runtime.js` — CSRuntime (detecta API; antes de http-api)
0b. `http-api.js` — CSHttpApi (cliente REST Fase 1; antes de api.js)
1. `seed.js` — CSStore
2. `identifiers.js` — CSIdentifiers (relatos / protocolo)
3. `audit.js` — CSAudit (auditoria funcional de negócio)
4. `infra-log.js` — CSInfraLog (logs técnicos; antes de hooks em errors/auth/api)
5. `attachments.js` — CSAttachments (ficha de relato)
6. `validation.js` — CSValidation (antes de `api.js` se CRUD colaborador)
7. `api.js` — CSApi
8. `auth.js` — CSAuth (painel admin)
9. `employee-auth.js` — CSEmployeeAuth (após `api.js`)
10. `users.js` — CSUsers (topbar admin)
11. `companies.js` — CSCompanies
12. `reports.js` — CSReports (após `api.js`; timeline usa statusLabel)
13. `public-consult-guard.js` — CSPublicConsultGuard (após `api.js`)
14. `errors.js` — CSErrors (antes de `app.js`)
15. `app.js` — CSApp
16. `dashboard.js` / `reports-dashboard.js` — extras

## Bundles por página

| Bundle | Páginas |
|--------|---------|
| `public-light` | index.html, educacao.html, faq.html |
| `login` | login.html |
| `protocol` | protocolo.html |
| `report-form` | relato.html |
| `admin-shell` | integracoes, configuracoes (+ backup.js), auditoria, conteudos, usuarios, empresa/configuracoes |
| `admin-shell-infra-log` | logs-tecnico.html (+ infra-log.js antes de api.js) |
| `admin-shell-validation` | admin/colaboradores, admin/empresas, empresa/colaboradores |
| `admin-shell-dashboard` | admin/index, admin/indicadores, empresa/dashboard |
| `admin-shell-reports-ui` | admin/relatorios, empresa/relatorio |
| `admin-shell-reports-detail` | admin/relatos, empresa/relatos |

## Dependências indiretas críticas

- `auth.js` → exige `audit.js` (login/logout)
- `initAdminShell` → `auth`, `users`, `reports`, `companies`, `api`
- `reports-dashboard.js` (ficha) → exige `attachments.js`
- `errors.js` → sempre antes de `app.js`
