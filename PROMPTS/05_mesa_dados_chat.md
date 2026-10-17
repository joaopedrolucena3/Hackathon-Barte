# Sessão 05 — Mesa de dados por passo + chat de consulta

- **Data:** 2026-10-17
- **Ferramenta:** Claude Code

## Prompt

> Estamos construindo, dentro do pipeline de tratamento de planilhas do fechamento da subadquirente, uma aba para visualizar os dados de cada etapa, com uma linha de chat embaixo para consultar os dados e fazer perguntas que exijam raciocínio. [...] Tudo é SOMENTE LEITURA. [...] A referência visual é o FloQast Transform. [...] Não implemente nada ainda. Quero um PLANO. [...] Entregue primeiro as perguntas bloqueantes. Depois das minhas respostas, entregue o plano completo.

A especificação completa trazia o desenho da tela (passos à esquerda, grid tipo planilha, rodapé com totais de controle, chat embaixo), os princípios do chat (o modelo gera consultas, todo número vem de consulta, precisão decimal exata, camada semântica) e nove funcionalidades em ordem de prioridade.

## Decisões confirmadas pelo usuário

| Tema | Decisão |
|---|---|
| Horizonte | Demo do hackathon (dias): onda 1 com a base e as funcionalidades de maior impacto; o resto em onda 2 |
| LLM | Claude via API Anthropic, chave só no backend |
| Dados | Só o pack atual (1.943 linhas Orbe, um mês); volume de 25 mil linhas testado à parte |
| Local | Evoluir a aba Passos do run |

Premissas adotadas sem resposta explícita (a confirmar): destaque por severidade de exceção, exportação XLSX/CSV `;`, glossário v0 escrito pelo time técnico, papel de trabalho em XLSX, perguntas fixadas da equipe, sem login.

## Plano

Arquitetura escolhida: dataset inteiro do passo no navegador (Glide Data Grid) com servidor como autoridade dos números; agente text-to-SQL em Python sobre DuckDB somente leitura, com marcadores resolvidos no servidor (o modelo não escreve números) e selo de verificação cruzada; contrato grid ↔ chat por store tipado com comandos.

Onda 1: F0 fundação · F1 grid e API de integração · F2 chat base (apontar na planilha, perguntar sobre a seleção) · F3 cascata + hipóteses · F4 briefing · F5 papel de trabalho. Onda 2: caça ao centavo, história do lojista, perguntas fixadas.

## Fases

### Fase 0 — Fundação

- Branch `feature/dados-chat` a partir da `origin/main` (f604f13).
- Dependências fixadas: `duckdb==1.5.6` e `anthropic==1.15.0` em `requirements.txt` e `requirements.lock.txt` (com dependências transitivas); `run.sh` passa a conferir os dois imports. Front: `@glideapps/glide-data-grid@6.0.3` e peers (`lodash@4.17.21`, `marked@4.3.0`, `react-responsive-carousel@3.2.23`).
- `src/lib/format.ts`: `money`, `decimal` e `pp` formatam a partir do texto decimal (BigInt, ROUND_HALF_UP como o back), sem `Number()`. Valores fora do formato decimal caem no caminho anterior.
- `src/config/semantica.json` v0: contexto do negócio, tipos por coluna, significado de todas as colunas dos 24 datasets do pipeline, glossário com `disponivel_nos_dados` (chargeback, cancelamento, D+N e agenda de recebíveis = não), seis invariantes entre passos e chips de sugestão por passo e por coluna.
- Verificação:
  - back: 135 testes passaram (Python 3.13; ver observação abaixo);
  - front: 52 testes passaram (novo teste de formatação exata: `4715852.69` → `R$ 4.715.852,69`, valores acima da precisão de float, arredondamento e negativo zero) e `tsc --noEmit` passou;
  - os seis invariantes conferem no DuckDB sobre os Parquet de um run do pack (bruto 7.496.228,56 preservado do passo 1 ao 5; bruto − taxa = líquido 7.264.348,20; comissão checkout 207.039,73 e remessa 39.543,45 iguais entre cálculo, comissões e métrica do passo; lote 23.474.915,80 a débito e a crédito; extrato −1.416.088,18 igual à soma classificada);
  - toda coluna real dos datasets tem significado na camada semântica.
- Observação: o `.venv` local do back usa Python 3.14, e o `pyarrow==20.0.0` fixado pelo time não tem wheel para 3.14 (a instalação falha). A verificação usou um ambiente separado com Python 3.13. A versão do pyarrow não foi alterada.
- Mudança em relação ao plano: a camada semântica ficou em `src/chat/semantica.json`, não em `src/config/`. O serviço do pipeline tira hash de `src/config/*.json` e bloqueia a aprovação de runs em andamento quando esse hash muda; revisar o glossário não pode travar aprovações.

### Fase 1 — Grid e API de integração

- Back (`demo/back/src/chat/`):
  - `semantic.py`: rótulos, significados, tipos semânticos, ordem de leitura das colunas (o Parquet guarda em ordem alfabética), títulos das tabelas, totais de controle e invariantes entre passos, todos somados em Decimal no Python.
  - `views.py`: tabela inteira do passo em linhas colunares e exportação da visão (XLSX com abas "dados" e "Sobre", ou CSV `;` com vírgula decimal e BOM), na ordem da tela.
  - `pipeline/service.py`: `step_rows` (somente leitura) e cache das saídas por hash de conteúdo, com o hash do arquivo conferido a cada pedido.
  - `api/app.py`: `GET /api/runs/{id}/steps/{step}/data` (gzip acima de 64 KB) e `POST /api/runs/{id}/steps/{step}/export`.
- Front (`demo/front/src/workbench/`):
  - `contract.ts` e `store.ts`: contrato grid ↔ chat (filtros, ordenação, seleção, foco, destaques, filtro do chat, pergunta pendente) num store externo, no padrão de `lib/actor.ts`.
  - `table.ts`: exibição, filtros, ordenação e estatísticas da seleção com decimal exato (BigInt), sem float.
  - `DataGrid.tsx` (Glide Data Grid): letras nas colunas, números nas linhas, coluna de status (▲ bloqueante, ● alerta, ✓ decidida), fundo discreto por severidade, seleção de intervalo/coluna/linha, cópia com vírgula decimal, menu de cabeçalho (ordenar, filtrar, significado da coluna) e menu de célula ("Por quê?", perguntar sobre a seleção, filtrar pelo valor, copiar, ver exceção).
  - `StepWorkspace.tsx`, `GridFooter.tsx`, `RunSummaryCard.tsx`, `Menu.tsx`, `ChatSlot.tsx` (espaço do chat até a fase 2).
  - `pages/run/StepsTab.tsx`: a aba Passos virou a mesa; detalhes do passo e da exceção abrem em painel lateral, somente leitura (decisões continuam na aba Revisão).
  - `lib/storage.ts#downloadBlob`; adaptador mock com `getStepTable`/`exportView` para o modo demonstração.
- Verificação:
  - back: 145 testes passaram (135 existentes + 10 novos em `tests/test_step_data_api.py`);
  - front: 62 testes passaram (10 novos em `src/workbench/table.test.ts`, incluindo 25 mil linhas filtradas e ordenadas com decimal exato), `tsc` e build passaram;
  - navegador (servidor na porta 8791, banco descartável): seleção da coluna Bruto inteira soma R$ 7.496.228,56, igual ao total de controle do back; filtro Bandeira = ELO mostra 343 linhas, bruto R$ 1.261.151,94, taxa R$ 42.166,88, impacto R$ 2.631,84 e 49 com exceção, os mesmos números calculados à parte no DuckDB; "Por quê?" entrega ao chat "Por que Bruto é R$ 608,88 em TX88410932?"; controles entre passos ✓; modo `?volume=25000` rola com quadros de 17 ms em média;
  - o salto de rolagem visto ao clicar no grid com a ferramenta de automação não ocorre com eventos de ponteiro comuns.

### Fase 2 — Chat base (apontar na planilha, perguntar sobre a seleção)

- Back (`demo/back/src/chat/`):
  - `engine.py`: um DuckDB em memória por run, com cada saída do passo carregada do Parquet com `_rid` e tipos exatos (dinheiro `DECIMAL(18,2)`, percentuais `DECIMAL(18,6)`, datas `DATE`). Depois da carga, acesso externo desligado e configuração travada. Guarda de SQL: uma única instrução `SELECT`/`WITH`/`FROM`/`VALUES` (recusa DDL, DML, `ATTACH`, `COPY`, `PRAGMA`, `read_csv`), colunas `DOUBLE` recusadas com a dica de arredondar para `DECIMAL`, limite de 10 s e 1.000 linhas. Cada pergunta abre uma sessão com as tabelas temporárias `selecao` e `visao` (linhas da seleção e da visão filtrada). `recompute()` refaz o agregado principal em Decimal no Python sobre o texto do Parquet, usando o DuckDB só para escolher as linhas.
  - `agent.py`: laço manual com `claude-opus-5-5` (pensamento adaptativo, esforço médio, streaming, prompt em cache em dois blocos: instruções + glossário fixos, catálogo do run). Ferramentas `consultar_sql`, `funil` e `responder` (estrita, entrada validada por JSON Schema). O modelo escreve o texto com marcadores `{q1.total:brl}` que o servidor troca pelo valor da consulta; algarismo fora de marcador é recusado (uma nova tentativa, depois o texto some e só os dados ficam). Selo da resposta: recálculo independente, total de controle (quando a base é a tabela inteira) e partes somando o total; estados ok, falhou, incompleto, sem verificação. Custo estimado a partir do `usage`.
  - `store.py`: conversas em `*-chat.sqlite3`, com as mensagens da API repetidas byte a byte na pergunta seguinte.
  - `api/chat.py`: `GET /api/runs/{id}/chat` (disponibilidade, sugestões, conversas) e `POST /api/runs/{id}/chat` em SSE (etapas, consultas, funil, resposta, erro). Sem credencial, 503 com instruções de configuração; a planilha continua funcionando.
- Front (`demo/front/src/chat/`, `src/api/chat.ts`):
  - `ChatDock.tsx` sob a planilha: chips de sugestão do passo e da coluna em foco, chip da seleção (removível), chip da visão filtrada, Parar, Nova conversa, Recolher. "Por quê?" no menu da célula envia a pergunta na hora.
  - `AnswerCard.tsx`: texto com valores marcados, gráfico (barras ou colunas diárias), tabela, funil, selo, consultas SQL abertas, custo; ações Destacar, Filtrar só estas linhas e Abrir no passo N.
  - `session.ts`: conversa por run num store externo; uma resposta destaca suas linhas no grid por vez; a última conversa volta ao recarregar.
- Teste sem API: `tests/chat_fakes.py` (cliente simulado), `tests/chat_golden.py` (10 perguntas de ouro com SQL de referência e valores calculados em Decimal) e `tests/run_golden.py` (`--simulado` ou, com credencial, `--confirmar-custo`). `tests/serve_chat_demo.py` sobe um servidor isolado com um analista roteirizado para conferir a tela.
- Verificação:
  - back: 191 testes passaram (32 novos: motor 11, agente 17, API 4);
  - front: 73 testes passaram (11 novos), `tsc` e build passaram;
  - `run_golden.py --simulado`: 10 de 10 (prova o roteiro e as SQL de referência, não o modelo);
  - navegador (servidor de QA na 8792, analista roteirizado): sugestão respondida com R$ 7.496.228,56 em 1.943 linhas, igual ao total de controle, selo "Conferido", gráfico, tabela e as duas consultas visíveis; seleção de 9 células em 3 linhas vira contexto e a resposta soma R$ 2.058,35 só dessas linhas, com as 3 destacadas no grid; "Por quê?" na célula Lojista envia "Por que Lojista é Bem-Vindo Exchange Ltda em TX88410833?"; a conversa volta com autor depois de recarregar; nenhum erro no console;
  - correção feita no navegador: numa janela de 678 px de altura a resposta espremia o grid até sobrar só o cabeçalho. O grid agora tem altura mínima de 160 px e a conversa encolhe primeiro (`app.css`).
- Pendente: rodar as perguntas de ouro com o modelo real (falta credencial da API na máquina; custo estimado de US$ 1 a 3). Os parâmetros novos da API (fallback do servidor, notas de progresso do pensamento, ferramenta estrita com entrada em streaming) só foram exercitados com o cliente simulado.
