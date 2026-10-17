# Contrato da interface integrada

O nome deste arquivo foi preservado para manter links existentes. Os endpoints do agente agora estão implementados e o modo padrão é HTTP real; `VITE_AGENT_API=mock` ativa explicitamente o simulador anterior.

`src/api/agent/contract.ts` descreve os modelos de exibição. `adapters.ts` traduz os objetos persistidos do backend e `http.ts` faz as chamadas. Não envie o modelo de exibição diretamente à API.

## Diferenças traduzidas pelo adaptador

- Mutações novas usam `X-User` com `X-User-Encoding: percent-utf8`, sem campo `actor` em corpos estritos. Operações antigas continuam recebendo `actor` no JSON.
- Erros usam `{error:{code,message,details}}`; a mensagem aparece na interface.
- Catálogo, runs, checklist, versões e exceções usam envelopes; a lista de exceções é paginada e o adaptador carrega todas as páginas.
- Upload envia um arquivo por requisição no campo `file`. O run recebe os seis IDs, `pipeline_id` e `competencia`; a resposta 202 identifica o run, cujo snapshot é consultado depois.
- SSE nomeado inclui cursor persistido e reconexão por snapshot. O estado final não depende de receber todos os eventos.
- Decisões usam `acao: aceitar|ajustar|excluir`, `justificativa`, `conta` e `valor`. Todos os encaminhamentos exigem justificativa. Ajustes e exclusões afetam de fato o lote exportado.
- Aprovação usa `decisao: aprovar|reprovar` e `comentario`. A interface não libera exportação antes do gate.
- O catálogo entrega JSON Schema; valores fixados por `const` aparecem bloqueados no construtor.
- `draft: true` permite testar `steps` ainda não salvos. O teste não aprova, exporta ou substitui o checklist real.
- Prévia usa o ID do passo, filtros, paginação e totais de dinheiro do servidor. Os dados são os do snapshot; mudança de parâmetros exige nova execução de teste.

## Rotas de integração

Além das rotas documentadas em [API_PIPELINE.md](../back/docs/API_PIPELINE.md), o front usa:

| Método | Rota | Uso |
|---|---|---|
| GET | `/api/competencias` | Competências disponíveis |
| GET | `/api/insights?comp=AAAA-MM` | Agregações para gráficos |
| GET | `/api/runs/{id}/approval-summary` | Revisão, bloqueantes e equilíbrio |
| POST | `/api/runs/{id}/exceptions/decisions` | Aceite atômico de alertas em lote |
| GET | `/api/runs/compare?a=&b=` | Comparação de hashes e contexto |
| GET | `/api/runs/{id}/exports/{nome}` | Artefato individual aprovado ou auditoria |

O contrato de transporte completo é gerado em `/api/openapi.json`. As rotas `/api/mail/*` têm cliente separado em `src/api/mail.ts`, incluindo OAuth, evidências e aprovação da mensagem exata. Cobranças e avisos simulados continuam no cliente `core.ts`.
