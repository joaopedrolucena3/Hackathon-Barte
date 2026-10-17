# API do pipeline Tarvo

O servidor usa FastAPI em `http://127.0.0.1:8765`. O contrato OpenAPI pode ser consultado em `/api/openapi.json`. O workflow executa Python determinístico, sem chamadas a LLM. `./run.sh` inicia a aplicação; `./run.sh test` executa a suíte.

## Autoria e erros

Mutações do workflow exigem `X-User: Nome do analista`. É autoria declarada, sem autenticação. A interface codifica nomes Unicode com `encodeURIComponent` e informa `X-User-Encoding: percent-utf8`; o servidor restaura o nome para a auditoria. Clientes também podem enviar diretamente nomes compatíveis com o cabeçalho HTTP. Requisições JSON usam `Content-Type: application/json`; upload usa multipart. O servidor aceita apenas acesso local e recusa mutações de outra origem web.

Todos os erros HTTP retornam:

```json
{"error":{"code":"APPROVAL_BLOCKED","message":"Há exceções bloqueantes abertas.","details":[]}}
```

Dados inválidos e definições inconsistentes retornam 422; conflito de estado e exportação sem aprovação retornam 409. Recursos inexistentes retornam 404. Cada upload tem limite de 25 MB.

## Rotas

| Método | Rota | Retorno / ação |
|---|---|---|
| GET | `/api/competencias` | Competências disponíveis |
| GET | `/api/insights?competencia=AAAA-MM` | Indicadores da conferência atual, com origem explícita |
| GET | `/api/steps/catalog` | `{steps: [...]}`, com título, entradas, saídas, versão e JSON Schema |
| GET | `/api/pipelines/{id}` | Definição atual; aceita `?version=N` |
| GET | `/api/pipelines/{id}/versions` | `{versions: [...]}` |
| POST | `/api/pipelines/{id}/validate` | Valida dependências, tipos, parâmetros e aprovação antes de exportar; 422 com lista de erros |
| PUT | `/api/pipelines/{id}` | Salva uma nova versão; não sobrescreve a anterior |
| POST | `/api/files` | Multipart com campo `file`; retorna `file_id` e SHA-256 |
| POST | `/api/runs` | `{pipeline_id, competencia, file_ids?, source_dir?, draft?, steps?}`; retorna `run_id`, HTTP 202 |
| GET | `/api/runs?competencia=AAAA-MM` | `{runs: [...]}` |
| GET | `/api/runs/{id}` | Estado consolidado, etapas, métricas, saídas, aprovações e bloqueantes |
| GET | `/api/runs/{id}/events` | SSE persistido; replay por `Last-Event-ID` ou `?after=N` |
| GET | `/api/runs/{id}/steps/{step_id}/preview` | Página do dataset salvo em Parquet |
| GET | `/api/runs/{id}/exceptions` | Lista paginada de exceções; aliases `items` e `exceptions` |
| GET | `/api/runs/{id}/accounts` | Contas analíticas do snapshot da execução |
| POST | `/api/runs/{id}/exceptions/{exc_id}/decision` | Aceitar, ajustar ou excluir, com justificativa |
| POST | `/api/runs/{id}/exceptions/decisions` | Aceitação atômica de alertas selecionados; rejeita bloqueantes e escolhas inválidas |
| GET | `/api/runs/{id}/approval-summary` | Equilíbrio contábil, bloqueantes, alertas e estado do lote |
| POST | `/api/runs/{id}/approval` | Aprovar ou reprovar o lote; bloqueantes abertas impedem aprovação |
| GET | `/api/runs/{id}/audit` | Evidências, hashes, pipeline, código, eventos e decisões |
| GET | `/api/runs/compare?a=RUN_A&b=RUN_B` | Comparação entre execuções |
| GET | `/api/runs/{id}/export` | ZIP do lote aprovado; indisponível antes da conclusão |
| GET | `/api/runs/{id}/exports/{name}` | Arquivo individual pelo nome; auditoria disponível antes da aprovação |
| GET | `/api/competencias/{comp}/checklist` | Tarefas do mês, derivadas da última execução ou manuais |
| PATCH | `/api/checklist/{task_id}` | Atualiza apenas tarefa manual: status, responsável e comentário |

A definição inicial é `fechamento-tarvo`. O conjunto padrão inclui dez etapas, com aprovação e exportação ao final. Alterações respeitam os produtores/consumidores dos datasets e não podem remover o controle humano. Parâmetros de regras confirmadas têm limites explícitos no schema; parâmetros de hipóteses configuráveis ficam expostos.

## Executar com as fontes locais

```sh
curl -X POST http://127.0.0.1:8765/api/runs \
  -H 'Content-Type: application/json' \
  -H 'X-User: Analista da demo' \
  -d '{"pipeline_id":"fechamento-tarvo","competencia":"2026-09"}'
```

O processamento acontece em worker. Enquanto há execução real ativa para a competência, a API recusa outro disparo real concorrente. Enviar os seis arquivos retorna IDs que podem ser incluídos em `file_ids`. O lote usa cópias imutáveis desses arquivos, sem depender do caminho de upload após começar. Sem upload, usa a pasta de fontes configurada quando ela contém a competência; para outro mês, procura uma pasta irmã `Tarvo_Data_Pack_AAAA-MM` ou `Tarvo_Data_Pack_out2026` (abreviação do mês em português). Mais de uma pasta candidata exige `source_dir` explícito ou upload. As fontes locais de setembro não constituem dados de outubro; o período é validado e não recebe resultados do mês anterior.

`draft: true` permite testar `steps` ainda não salvos, preservando essa definição no snapshot. O teste termina após os cálculos, não aceita decisões/aprovação/exportação ERP e não substitui o checklist da execução real. Pode coexistir com uma execução real.

## Progresso e reconexão

```sh
curl -N 'http://127.0.0.1:8765/api/runs/RUN_ID/events' \
  -H 'Last-Event-ID: 12'
```

Eventos têm `id`, `event` (nome do tipo) e `data` JSON. Use listeners nomeados para `run_started`, `step_started`, `step_progress`, `step_finished`, `awaiting_approval` e `run_finished`. Consulte o snapshot em reconexões; o estado não depende de o navegador ter recebido todos os eventos. O SSE inclui heartbeat e encerra ao chegar a estado terminal.

## Prévia sem reprocessamento

A rota de prévia aceita `dataset` (para passos com múltiplas saídas), `page`, `page_size` até 500, `sort_by`, `order=asc|desc`, `filter_column`, `filter_op=eq|contains|gt|lt`, `filter_value`, `only_exceptions=true` e `diff=true`. A resposta informa `rows`, `schema`, `total`, `page`, `page_size` e diferenças quando solicitadas. Colunas financeiras são representadas sem perda de precisão; metadados distinguem dinheiro, taxa, data e texto. `__exception_ids` liga linhas às exceções.

## Revisar e exportar

```json
{"acao":"aceitar","justificativa":"Encaminhamento confirmado com o responsável; evidência registrada."}
```

Ajustar usa `acao: "ajustar"`, `valor` como decimal em texto e/ou `conta` analítica do snapshot, além de justificativa e `entry_id` quando houver mais de um lançamento associado. Excluir retira os lançamentos relacionados do lote exportado; não apaga a evidência. Uma exceção sem lançamento calculado não autoriza inventar receita. Os controles validam os ajustes e o equilíbrio antes de produzir o pacote.

```json
{"decisao":"aprovar","comentario":"Exceções bloqueantes tratadas; mapa contábil e lote revisados."}
```

Reprovar usa `decisao: "reprovar"`; o lote é arquivado sem exportação. Mudanças de arquivos ou regras exigem uma nova execução. O ZIP aprovado contém `lancamentos_fenix.csv`, `relatorio_excecoes.csv`, ajustes e auditoria, conforme o manifesto da execução. O formato Fênix é o leiaute proposto do MVP; não foi fornecida uma especificação oficial de importação nem realizada homologação no ERP.

## Preservação e reprodutibilidade

Cada run registra SHA-256, tamanho e contagens das entradas, definição/versionamento dos passos, parâmetros efetivos, início/fim/duração, métricas, exceções e hashes das saídas. O código é identificado por hashes e commit Git quando disponível. Alterar arquivos de código/configuração após iniciar o processo impede novos runs (`409 CODE_RESTART_REQUIRED`) até reiniciar o serviço. Um lote iniciado com código diferente do atual não pode ser aprovado (`409 CODE_CHANGED`); deve ser reprovado e executado novamente. Datasets Parquet e CSVs financeiros idênticos geram hashes idênticos. Metadados operacionais (horário, duração, ID e ator) diferem entre execuções e ficam na auditoria; não são usados como valores financeiros nem no hash semântico dos datasets.

Ao iniciar uma execução do pack atual, o servidor incorpora snapshot dos cadastros, taxas e parâmetros revisados somente quando os hashes dos seis arquivos coincidem com as fontes do fechamento atual. Uploads e outras pastas usam suas próprias referências. O snapshot preserva o resultado de edições posteriores. O SQLite guarda as decisões e a agenda do checklist; o diretório `saida/runs/<run_id>/` conserva entradas, etapas e artefatos. Os downloads de conferência continuam disponíveis; não são uma rota alternativa para exportar o novo lote ERP sem aprovação.

## Referências técnicas

- [Respostas HTTP e streaming no FastAPI](https://fastapi.tiangolo.com/advanced/custom-response/)
- [Uploads de arquivos no FastAPI](https://fastapi.tiangolo.com/tutorial/request-files/)
- [Parquet no PyArrow](https://arrow.apache.org/docs/python/parquet.html)
