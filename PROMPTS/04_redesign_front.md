# Sessão 04 — Redesign do front e features do agente de fechamento

- **Data:** 2026-10-17
- **Ferramenta:** Claude Code

## Prompt

> Quero fazer mudanças para o front end. Na aba de resumo quero gráficos que mostrem o progresso do fechamento assim como o valor em pendências. Essa aba deve ser visual. A aba comissões e divergências deve ser apenas algo que aparece quando você clica em um dos dois na aba de resumo. A aba de notas e cobranças e bancos deve ser mais visual e user friendly, as duas devem ser juntadas. Cadastros deve melhorar e ser mais simples de mexer. Repagine todo o design do app pensando nessas decisões e nas implementações descritas nesse feature description. Algumas novas features precisam de atualização do front, leia isso e gere um plano considerando tudo o que já havia mandado anteriormente.

Anexo: spec "Frontend — Agente de fechamento Tarvo (set/2026)" com as features A2, B1, B3, B4, B5, B6, C1 e C8.

Depois: "Faça perguntas sobre as mudanças do front e confirmações que você precisa" e, por fim, "Execute tudo".

## Decisões confirmadas pelo usuário

| Tema | Decisão |
|---|---|
| Stack | React + Vite + TypeScript; `run.sh` compila o front e o Python serve `front/dist` |
| Back | Só mocks, mas com adaptador tipado no formato dos endpoints da spec (`front/API_PENDENTE.md`) |
| Pendências × revisão | Uma fila só: a aba Revisão do run (Aceitar / Ajustar / Excluir do lote) |
| Comissões / Divergências | Painel lateral aberto pelos cards do Resumo |
| Notas e bancos | Faixa de números + seletor `Notas e cobranças \| Bancos`; cards por tomador com etapas da cobrança |
| Cadastros | Lista de lojistas + ficha com taxas em linha do tempo de vigências e edição inline |
| E-mails | "Comunicações" enxuta; cobranças passam a viver em Notas e bancos |
| Front antigo | Substituído direto |
| Prioridade | Pedidos do usuário primeiro; depois Execução, Revisão, Auditoria e Pipeline |
| Identidade visual | Link de Claude Doc enviado não estava acessível; mantida a marca atual (petróleo + terracota) em tokens |
| Registro | Este arquivo + commit e push ao fim de cada fase |

## Fases

### Fase 0 — Fundação

- `demo/front/` virou projeto Vite + React + TS (React Query, React Router, dnd-kit, Inter auto-hospedada).
- Contrato do agente em `src/api/agent/contract.ts`; adaptador real em `http.ts`; mock em `mock/` que lê `/api/state` e grava decisões, recálculo, importação e parâmetros no back real.
- `back/src/store.py` aponta `FRONT` para `front/dist`; `back/src/app.py` devolve `index.html` para rotas do SPA e 503 explicativo se o front não foi compilado.
- `back/run.sh` compila o front quando `dist/` falta ou está mais velho que o código (`./run.sh front` só compila).
- Verificação: `npm run build` ok; 10 testes de front (decimal exato, formatação pt-BR, reducer de eventos SSE); 55 testes do back ok; `/`, `/runs/R-0001` e `/pipeline` respondem o SPA; `/assets/inexistente.js` e `/api/inexistente` respondem 404.

### Fase 1 — Fechamento visual

- Rota `/competencias/:comp` é a casa do fechamento: progresso (segmentos por tarefa + etapas Importar → Concluir), valor em pendências (barra empilhada bloqueante/alerta/decididas), último run, quatro cartões, pendências abertas por tipo, relatório e saídas, checklist por área (A2) com tarefas manuais editáveis e atualização otimista.
- Comissões e Divergências saíram da navegação: abrem como painel lateral pelos cartões (`?painel=comissoes|divergencias`), com gráfico, tabela e rastro inline (`GET /api/trace`).
- Botão **Rodar fechamento** (B3): painel curto com data pack, envio de arquivos com SHA-256 ou pasta no servidor; trata 409.
- Gráficos seguem a skill de dataviz: paleta validada (`#2a78d6`/`#eb6834` séries; vermelho/âmbar/verde de estado com rótulo sempre visível), barras ≤ 24px, rótulo na ponta, tooltip por marca.
- Verificação no navegador (porta 8777, banco separado): números do case conferem (checkout R$ 207.039,73; remessa R$ 39.543,45; divergências R$ 22.173,57; notas R$ 246.588,68; 304 pendências); painéis e rastro abrem; sem erros no console. Corrigido rótulo da maior barra que vazava do cartão e o foco que rolava o painel.

### Fase 2 — Notas e bancos, Cadastros e Comunicações

- **Notas e bancos** (uma tela, seletor `Notas e cobranças | Bancos`): faixa com notas propostas, cobranças por etapa e bancos; cards por tomador com etapas Proposta → Rascunho → Aprovada → Enviada e ação principal conforme a etapa; editor de cobrança em painel (aprovação vinculada ao texto exato, envio simulado); bancos com "Precisa de você", entradas × saídas por dia, "para onde foi cada lançamento" por conta Fênix e lista agrupada com reclassificação inline (só contas analíticas, justificativa obrigatória → `/api/decisions`).
- **Cadastros**: lista de lojistas + ficha; nome, EC e situação editáveis direto na ficha com uma justificativa só; identidade candidata confirmada na própria ficha; taxas como linha do tempo de vigências por produto (vigência da competência em destaque, lacunas hachuradas, sobreposições marcadas) com editor inline; contatos de cobrança na ficha; abas de contatos, plano de contas (só leitura) e prazo. Parâmetros de cálculo apontam para o construtor.
- **Comunicações**: rascunhos e envios simulados, avisos internos e quem recebe; o e-mail do relatório abre direto no editor.
- Verificação no navegador: ficha da Casa do Estudante mostra 0% a partir de 01/09/2026 em destaque; rascunho de cobrança da Ponte criado e aberto no editor (banco de verificação); valores negativos não quebram mais linha; toast passou para o topo.

### Fase 3 — Execução do run (B1, B3, B4, C8)

- `/runs/:id`: cabeçalho com barra de progresso, tempo decorrido e status; abas Passos · Revisão · Auditoria; banner fixo "O agente terminou. N exceções aguardam sua revisão" com botão Revisar; selo `Pipeline … · código … · N arquivos`.
- Lateral (B1/B4): ícone por estado (○, girando, ✓, !, ✕, ⏸, –), resultado do passo (`1.943 linhas · 210 exceções · 1,7 s`), barra `800 / 1.943` durante a execução, portão de aprovação com visual próprio, falha com mensagem e "Ver detalhes".
- Eventos ao vivo: `useRunEvents` aplica `step_started/progress/finished/awaiting_approval/run_finished` ao cache (reducer testado) e seleciona o passo em execução enquanto o usuário não escolheu outro. O mock retoma runs interrompidos por recarga.
- Preview (C8): paginação, ordenação e filtros no "servidor" (mock), colunas novas destacadas com marcador "novo", linhas com exceção marcadas na margem, "Só exceções", "Comparar com entrada" (linha duplicada removida aparece riscada), totais de dinheiro da página e do dataset.
- Painel direito: métricas, parâmetros efetivos, versão do código e hash de saída do passo; clique numa exceção abre o detalhe com origem.
- Verificação no navegador: run R-0001 rodou do início ao portão em ~20 s; Conferir MDR mostra 1.886 linhas, 210 exceções e as colunas taxa contratada, diferença (p.p.) e impacto; banner mostra 304 exceções e 57 bloqueantes.
