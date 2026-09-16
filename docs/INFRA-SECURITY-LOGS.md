# Logs de infraestrutura e segurança — Canal Seguro

Camada **técnica**, separada da **auditoria funcional** (`CSAudit` / `auditLogs`).

| Trilha | Módulo | Storage protótipo | Propósito |
|--------|--------|-------------------|-----------|
| Auditoria funcional | `CSAudit` | `auditLogs[]` | Ações de usuário no produto |
| Logs técnicos | `CSInfraLog` | `techLogs[]` | Infra, app, segurança, acesso |
| Produção | Servidor | SIEM / log store | Fonte da verdade |

---

## 1. Categorias

### APPLICATION
- Erros de aplicação, exceções, falhas de operação, serviços indisponíveis.

### SECURITY
- Login (tentativa / recusa — sucesso funcional permanece em `CSAudit`).
- Acesso negado, cross-tenant, alteração de permissões.
- Consulta pública bloqueada / falhas repetidas.
- Downloads de anexo em sequência.
- Alertas automatizados (`alerta_seguranca`).

### DATABASE
- Falha ao persistir `localStorage` (protótipo).
- Futuro: conexão, transação, indisponibilidade PostgreSQL.

### ACCESS
- Acesso a rotas/páginas (path, resultado).
- Futuro: endpoint HTTP, status, IP (gateway), user-agent resumido.

---

## 2. Minimização de dados

**Nunca registrar:**
- Senhas, tokens completos, `trackingCode`, CPF, texto integral de relatos.

**Sanitização:** `CSInfraLog` remove chaves sensíveis e trunca strings longas.

**E-mail em login recusado:** apenas `emailHash` (hash local de demo).

---

## 3. Retenção (protótipo)

| Categoria | Máx. registros em memória |
|-----------|---------------------------|
| application | 300 |
| security | 500 |
| database | 200 |
| access | 400 |

Produção (alvo): access 90d, security 1a, application 30d, database 90d — ver política infra.

---

## 4. Permissões

| Papel | Ver auditoria | Ver logs técnicos |
|-------|---------------|-------------------|
| superadmin | Sim | Sim |
| Demais | Conforme painel | **Não** |

Logs são **append-only** — sem API de exclusão exposta ao cliente.

---

## 5. Alertas (exemplos)

| Regra | Condição | Severidade |
|-------|----------|------------|
| brute_force_login | ≥5 `login_recusado` / 15 min | critical |
| protocol_enumeration | ≥5 falhas consulta / 15 min | warn |
| cross_tenant | ≥3 `acesso_negado_cross_tenant` / 1 h | critical |
| attachment_burst | ≥10 downloads anexo / 5 min | warn |
| permission_changes | ≥3 `permissao_alterada` / 1 h | warn |

Gera entrada `alerta_seguranca` com `alert: true`.

---

## 6. Onde os logs são gerados

### Protótipo (espelho)

| Arquivo | Eventos |
|---------|---------|
| `js/errors.js` | `erro_aplicacao`, `excecao_nao_tratada` |
| `js/auth.js` | `login_recusado`, `acesso_negado` |
| `js/api.js` | `acesso_negado_cross_tenant`, `permissao_alterada`, `download_anexo_solicitado` |
| `js/public-consult-guard.js` | `consulta_protocolo_falha`, `consulta_protocolo_bloqueio` |
| `js/backup.js` | eventos de backup (categoria application) |
| `js/app.js` | `acesso_rota` |
| `js/seed.js` | `persistencia_falhou` (saveStore) |

### Produção (fonte da verdade)

- API Gateway → ACCESS
- Auth service → SECURITY (login)
- App middleware → SECURITY + APPLICATION
- DB driver / pool → DATABASE
- Jobs backup → APPLICATION (via servidor)

Configure `window.CS_INFRA_LOG_API_BASE` para envio futuro.

---

## 7. Visualização

`admin/logs-tecnico.html` — superadmin, filtros por categoria.

Auditoria funcional: `admin/auditoria.html` (**inalterada** na finalidade).

---

## 8. Integração API (futuro)

```
POST /api/v1/internal/infra-logs     (servidor only)
GET  /api/v1/admin/infra-logs      (superadmin / platform_security)
```

Frontend **não** substitui logs de segurança do servidor.
