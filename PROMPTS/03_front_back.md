# Sessão 03 — Divisão da demo em /front e /back

- **Data:** 2026-10-17
- **Ferramenta:** Claude Code

## Prompt

> Faca alteracoes para a demo para que ela seja organizada em duas pastas /front e /back. Registre em prompts e indique que o intuito foi dividir as tarefas entre os integrantes.

## Intuito

Dividir as tarefas entre os integrantes do time: uma pessoa (ou dupla) cuida do `demo/front/` e outra do `demo/back/`, trabalhando em paralelo com menos conflitos de arquivos.

## Resultado

- `demo/front/`: interface (`index.html`, `app.js`, `styles.css`), antes em `demo/web/`.
- `demo/back/`: `src/`, `tests/`, `data/`, `docs/`, `saida/`, `run.sh`, `requirements.txt`, `HIPOTESES.md` e `.gitignore`.
- Em `demo/` ficam README, DEMO.md e PROMPTS.
- Código: `back/src/store.py` define `FRONT = ROOT.parent / 'front'` e `back/src/app.py` serve a interface a partir dele. Nenhuma outra lógica mudou.
- Movimentação feita com `git mv`, preservando o histórico. README e DEMO.md atualizados com os novos caminhos.

## Verificação

Primeira passada, logo após a reorganização:

- Servidor sobe a partir de `demo/back` e responde 200 para `/` e `/app.js`.
- `./run.sh test` falhava igual antes e depois da mudança (8 falhas, 23 erros): os testes apontavam para `ROOT.parent` como pasta dos dados do case, caminho inexistente.

Segunda passada (pedido: "Verifique o funcionamento do mvp apos a reorganizacao e adicione me verificação"):

- **Testes corrigidos:** `PACK` em `back/tests/test_engine.py` e `back/tests/test_store.py` agora é `back/data/case`. Resultado: **55 testes, todos OK**.
- **Servidor:** `/`, `/app.js`, `/styles.css`, `/api/state`, `/api/report`, `/api/export.zip` e `/api/export?file=...` respondem 200. Um caminho fora de `front/` (`/../../README.md`) responde 404.
- **Números do case** em `/api/state`, conferem com o README: 35 comissões, 237 divergências, 21 notas, 184 lançamentos, 304 pendências, competência 2026-09.
- **Exportação:** `./run.sh export` regera os seis CSVs, o relatório e `verificacao.json` byte a byte iguais aos versionados.
- **Não verificado:** a interface no navegador (cliques, diálogos). A checagem cobriu servidor, API e arquivos estáticos.

## Prompts na raiz

Pedido: "Deixe todos os prompts no /PROMPTS da root nao no da demo". `demo/PROMPTS/` foi movida com `git mv` para `/PROMPTS` (MOMENTOS.md, PEDIDO_ORIGINAL.txt, quatro SESSAO_*.jsonl e exportar_sessoes.py). O `MOMENTOS.md` da raiz estava vazio e foi substituído pelo da demo. `demo/PROMPTS/` não existe mais.
