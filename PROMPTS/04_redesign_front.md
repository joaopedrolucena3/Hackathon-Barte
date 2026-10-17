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
