# Etapa 09 — Workflow profissional de apuração

## Visão geral

O workflow de apuração governa o tratamento interno de relatos com **9 etapas** (`workflowStage`), mantendo os **5 status legados** (`status`) sincronizados para compatibilidade com consulta pública e relatórios existentes.

## Etapas internas

| ID | Label | Status legado |
|----|-------|---------------|
| `recebido` | Recebido | recebido |
| `triagem` | Triagem | analise |
| `classificacao_risco` | Classificação de risco | analise |
| `responsavel_definido` | Responsável definido | analise |
| `em_apuracao` | Em apuração | apuracao |
| `aguardando_informacoes` | Aguardando informações | apuracao |
| `analise_parecer` | Análise / parecer | acompanhamento |
| `medidas_adotadas` | Medidas adotadas | acompanhamento |
| `concluido` | Concluído | concluido |

## Marcos visuais (timeline — 5)

1. **Recebido**
2. **Triagem** (triagem + classificação de risco + responsável definido)
3. **Apuração** (em apuração + aguardando informações)
4. **Parecer** (análise/parecer + medidas adotadas)
5. **Conclusão**

## Campos no relato

```javascript
workflowStage, workflowStageAt, priority, teamIds[], dueAt
```

- **priority**: `normal` | `alta` | `urgente` (separado do `riskLevel` da Etapa 08)
- **status**: derivado de `workflowStage` via `statusMapping`

## Histórico append-only

Coleção `reportWorkflowHistory[]`:

```javascript
{
  id, reportId, previousStage, newStage,
  changedByUserId, changedByUserName, justification,
  assigneeIdAtTransition, teamIdsAtTransition, durationMs, createdAt
}
```

## Regras de negócio (MVP)

| Regra | Comportamento |
|-------|---------------|
| Retrocesso | Somente `admin_empresa` / `superadmin` |
| Transição | `apurador`, `admin_empresa`, `superadmin` |
| Responsável | Obrigatório antes de `em_apuracao`, parecer, medidas e conclusão |
| Risco | Obrigatório antes de `responsavel_definido` e `em_apuracao` |
| Crítico → concluir | Exige `assigneeId` (integração Etapa 08) |
| Justificativa | Obrigatória em retrocesso, saltos e conclusão |
| Consulta pública | **Não** expõe `workflowStage` |

## API

| Método | Rota | Permissão |
|--------|------|-----------|
| GET | `/reports/:id/workflow` | `reports:read` |
| GET | `/reports/:id/workflow/timeline` | `reports:read` |
| POST | `/reports/:id/workflow/transition` | `reports:transition_workflow` |
| PATCH | `/reports/:id/workflow/meta` | `reports:transition_workflow` |

Body de transição:

```json
{ "stage": "em_apuracao", "justification": "Motivo da mudança." }
```

## Alertas operacionais (dashboard)

Contagem em `workflowAlerts`:

- `noAssignee` — sem responsável após triagem
- `stalled` — parado > 120h na mesma etapa
- `slaWarning` / `slaOverdue` — SLA por etapa
- `criticalRisk` — relatos críticos abertos
- `awaitingInfo` — etapa aguardando informações
- `dueSoon` / `dueOverdue` — prazo operacional (`dueAt`)

## Configuração por empresa

`companySettings[companyId].investigationWorkflow` — política configurável; MVP usa defaults em `workflow-policy.service.js`.

## Arquivos principais

- `server/src/services/workflow-policy.service.js` — grafo, marcos, regras
- `server/src/services/workflow.service.js` — transições, timeline, alertas
- `js/workflow-panel.js` — UI na ficha do relato
- `js/reports-dashboard.js` — listagem e detalhe integrados

## Testes

```bash
cd server
npm run seed
npm test
```

Inclui `tests/workflow.test.js`.
