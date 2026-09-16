# Classificação de risco (Etapa 08)

Sistema de classificação de risco dos relatos com decisão humana, critérios configuráveis e sugestão auxiliar (não definitiva).

## Níveis

| Nível | ID | Uso |
|-------|-----|-----|
| 🟢 Baixo | `low` | Fluxo normal |
| 🟡 Moderado | `moderate` | Fluxo normal |
| 🟠 Alto | `high` | Prioridade elevada, ordenação no topo |
| 🔴 Crítico | `critical` | Alerta imediato, exige responsável para concluir |

## Modelo

- **`reports.riskLevel`** — estado atual (`null` = não classificado)
- **`reportRiskHistory[]`** — histórico imutável com justificativa, fatores, responsável e data
- **`companySettings[].riskClassification`** — fatores, pesos, regras de prioridade e sugestão

## Permissões

| Ação | Permissão | Regra extra |
|------|-----------|-------------|
| Ver classificação | `reports:read` | — |
| Classificar até Alto | `reports:classify_risk` | apurador, admin |
| Classificar Crítico | `reports:classify_risk` | **somente** `admin_empresa` e `superadmin` |

## API

| Método | Rota | Descrição |
|--------|------|-----------|
| GET | `/api/v1/reports?riskLevel=critical` | Filtro por risco |
| GET | `/api/v1/reports/metrics/dashboard` | KPIs incluindo `byRisk` |
| GET | `/api/v1/reports/:id/risk/suggestion` | Sugestão auxiliar (não persiste) |
| GET | `/api/v1/reports/:id/risk/history` | Histórico |
| POST | `/api/v1/reports/:id/risk` | Classificar / reclassificar |
| GET | `/api/v1/settings/risk-policy/:companyId` | Política do tenant |
| PUT | `/api/v1/settings/risk-policy/:companyId` | Atualizar política (admin) |

### Body POST classificação

```json
{
  "level": "high",
  "factors": ["violence", "evidence_exists"],
  "justification": "Texto obrigatório do responsável."
}
```

## Regras de prioridade

Configuráveis em `priorityRules` por nível:

- **Crítico:** alerta e-mail `risk_critical`, topo da listagem, bloqueio de conclusão sem responsável (configurável)
- **Alto:** ordenação elevada
- **Moderado / Baixo:** fluxo normal

## E-mail

- **`risk_critical`** — disparado ao classificar como crítico (genérico, sem conteúdo do relato)
- **`critical_alert`** — permanece para relatos **parados** além do SLA (Etapa 06) — conceitos distintos

## Privacidade

- Nível de risco **não** aparece na consulta pública (`protocolo.html`)
- Auditoria registra nível e contagem de fatores, **não** o texto integral da justificativa

## Demo

- `rpt_001` (CS-2026-000101) — **Crítico**
- Relato de violência Aurora — **Alto** (após seed)

## Testes

```bash
cd server
npm run seed
npm test
```

Arquivo: `server/tests/risk-classification.test.js`
