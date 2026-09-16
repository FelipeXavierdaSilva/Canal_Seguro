# Etapa 10 — Exportação profissional em PDF

## Visão geral

Exportação **server-side** com PDFKit, respeitando permissões e tenant. O usuário só recebe dados que teria autorização para visualizar na API.

## Tipos de exportação

| Tipo | ID | Permissão | Perfis |
|------|-----|-----------|--------|
| Relatório individual | `individual` | `reports:export_report` | apurador, admin, superadmin |
| Relatório de apuração | `investigation` | `reports:export_report` | apurador, admin, superadmin |
| Relatório gerencial | `managerial` | `reports:export` | admin, superadmin |

## API

| Método | Rota | Descrição |
|--------|------|-----------|
| GET | `/reports/export/types` | Tipos disponíveis para o usuário |
| POST | `/reports/:id/export/pdf` | PDF individual ou apuração (`body.type`) |
| POST | `/reports/export/pdf` | PDF gerencial (`body.filters`) |
| GET | `/reports/export/download/:token` | Download temporário (token único, 15 min) |

Resposta: `application/pdf` com `Content-Disposition: attachment` e `Cache-Control: no-store`.

## Privacidade

- **Anônimo:** nunca inclui `reporter`, `employeeId`, `contactEmail`, `contactPhone`.
- **Identificado:** dados pessoais só com `reports:view_identity` (admin/superadmin).
- **Apurador:** identidade mascarada como `[restrito]`.
- **Gerencial:** apenas agregados, sem descrições nem PII.

## Conteúdo por tipo

### Individual
Protocolo, datas, categoria, status, workflow, prioridade, risco, responsável, fatos, anexos (referência), identidade (se autorizado).

### Apuração
Tudo do individual + timeline workflow, histórico de etapas/risco/tratamento, mensagens com denunciante, medidas adotadas, conclusão.

### Gerencial
Totais, pendentes/concluídos, por status/categoria/risco, alertas SLA, tempo médio de tratamento.

## Campos de conclusão (Etapa 10)

No relato:
- `conclusionSummary` — preenchido na transição para `concluido`
- `measuresAdopted` — preenchido em `medidas_adotadas` ou `concluido`

## PDF — elementos visuais

- Cabeçalho com cor da empresa
- Marca **DOCUMENTO CONFIDENCIAL** (individual e apuração)
- Rodapé: protocolo, data/hora, usuário gerador, versão do documento, paginação
- Aviso de confidencialidade

## Auditoria

Cada exportação gera `auditLogs` com `action: 'exportacao_pdf'`:
- usuário, data/hora, protocolo, tipo, filename (sem conteúdo do PDF)

## Arquivos

- `server/src/services/export-policy.service.js`
- `server/src/services/export-data.service.js`
- `server/src/services/pdf-export.service.js`
- `server/src/services/export.service.js`
- `js/export-ui.js`

## Testes

```bash
cd server
npm test
```

Inclui `tests/export.test.js`.

## Frontend

- Ficha do relato: botões **PDF individual** e **PDF apuração**
- `empresa/relatorio.html`: **PDF gerencial** (admin)
- Requer `npm start` no servidor (`CSRuntime.useServer()`)
