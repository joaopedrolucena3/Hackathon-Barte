# Endpoints que o front espera do back

O front novo funciona hoje com um **mock do agente** (`src/api/agent/mock/`) que lê os dados reais de `GET /api/state` e grava no back real o que já existe: decisões (`/api/decisions`), recálculo, importação e parâmetros. O resto (runs, eventos, checklist, pipeline) fica no `localStorage` do navegador.

Quando o back implementar os endpoints abaixo, rode o front com `VITE_AGENT_API=http npm run build` (ou `npm run dev`). As telas não mudam: o adaptador `src/api/agent/http.ts` já chama estes caminhos. Os tipos estão em `src/api/agent/contract.ts`.

Todo POST/PUT/PATCH recebe `actor`, como os endpoints atuais. Erros: `{error}` com 400/404/409.

## Competência e checklist (A2)

| Método | Caminho | Retorno |
|---|---|---|
| GET | `/api/competencias` | `CompetenciaInfo[]` |
| GET | `/api/insights?comp=AAAA-MM` | `Insights`: agregados em R$ para os gráficos (pendências por estado/tipo, divergências por lojista, bancos por dia/conta, notas). O front não soma dinheiro. |
| GET | `/api/competencias/{comp}/checklist` | `ChecklistTask[]`. Tarefas do agente derivam do run mais recente. |
| PATCH | `/api/checklist/{id}` | `{status?, owner?, comment?}` só para tarefas manuais → `ChecklistTask` |

## Runs (B3, B1/B4, C8)

| Método | Caminho | Retorno |
|---|---|---|
| POST | `/api/files` (multipart, campo `files`) | `{files: InputFile[]}` com nome, tamanho e SHA-256 |
| POST | `/api/runs` | `{comp, source: pack\|upload\|folder, files?, folder?, draft?}` → `Run`. 409 com `{run_id}` se já houver run rodando. |
| GET | `/api/runs?comp=` | `RunRef[]`, mais recente primeiro |
| GET | `/api/runs/{id}` | `Run` consolidado (fonte da verdade após reconexão) |
| GET | `/api/runs/{id}/events` | SSE com eventos `step_started`, `step_progress`, `step_finished`, `awaiting_approval`, `run_finished` (`RunEvent`) |
| GET | `/api/runs/{id}/steps/{step}/preview` | `PreviewPage`. Query: `page`, `page_size`, `sort`, `dir`, `filters` (JSON `ColumnFilter[]`), `only_exceptions`, `diff`, `params` (JSON, prévia do construtor). Totais de colunas de dinheiro da página e do dataset. |

## Revisão e aprovação (B5)

| Método | Caminho | Retorno |
|---|---|---|
| GET | `/api/runs/{id}/exceptions` | `ReviewException[]` |
| GET | `/api/runs/{id}/approval-summary` | `ApprovalSummary` (bloqueantes, alertas, impacto, lote balanceado) |
| POST | `/api/runs/{id}/exceptions/{eid}/decision` | `{action: accept\|adjust\|exclude, note, account_code?, amount?}` → `ReviewException`. Justificativa obrigatória em ajustar/excluir. |
| POST | `/api/runs/{id}/approval` | `{decision: approve\|reject, comment}` → `Run`. Aprovar falha com 409 se houver bloqueante aberta. |
| GET | `/api/runs/{id}/exports/{nome}` | `lancamentos_fenix.csv`, `relatorio_excecoes.csv`, `auditoria.json` |

Hoje o mock traduz: Aceitar → `confirm`; Ajustar → `adjust` (conta via `account_code`; o valor proposto vai no texto da justificativa, porque o back não aceita número solto); Excluir do lote → `adjust` com a justificativa prefixada por `[Excluído do lote]`.

## Auditoria (B6)

| Método | Caminho | Retorno |
|---|---|---|
| GET | `/api/runs/{id}/audit` | `AuditTrail` (arquivos com hash, pipeline, passos com parâmetros e hash de saída, decisões antes → depois, aprovação, exportações) |
| GET | `/api/runs/compare?a=&b=` | `RunComparison` (hash de saída por passo) |

## Construtor (C1)

| Método | Caminho | Retorno |
|---|---|---|
| GET | `/api/steps/catalog` | `StepCatalogItem[]` com `params_schema` |
| GET | `/api/pipelines/fechamento-tarvo?version=` | `Pipeline` |
| GET | `/api/pipelines/fechamento-tarvo/versions` | `PipelineVersion[]` com a lista de mudanças |
| POST | `/api/pipelines/fechamento-tarvo/validate` | `{steps}` → `ValidationResult` |
| PUT | `/api/pipelines/fechamento-tarvo` | `{steps}` → nova versão |

O servidor atual só trata GET e POST (`src/app.py`): PUT e PATCH precisam ser adicionados.
