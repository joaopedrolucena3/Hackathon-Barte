# Conectar o chat de consulta à API da Anthropic

O chat da aba **Passos** usa o Claude (`claude-opus-5-5`) pela API da Anthropic. A credencial fica só no servidor; o navegador nunca a recebe. Sem credencial, a planilha funciona normalmente e o chat mostra como configurar.

O `/login` do Claude Code não serve para isso: ele autentica o Claude Code, não o servidor da Tarvo.

## Opção 1 — chave de API

Crie uma chave em https://console.anthropic.com/settings/keys e exporte-a no mesmo terminal em que vai subir o servidor:

```sh
export ANTHROPIC_API_KEY='sk-ant-...'
cd demo/back
./run.sh
```

A variável precisa existir antes do `./run.sh`. Se o servidor já estava no ar, pare com Ctrl+C e suba de novo. Não grave a chave no repositório.

## Opção 2 — login pela CLI `ant` (sem chave fixa)

```sh
brew install anthropics/tap/ant
ant auth login        # abre o navegador e guarda um perfil em ~/.config/anthropic/
ant auth status       # confirma qual credencial está ativa
cd demo/back
./run.sh
```

O servidor encontra o perfil sozinho. Se `ANTHROPIC_API_KEY` também estiver definida (mesmo vazia), ela vence o perfil: use `unset ANTHROPIC_API_KEY` para usar o login.

## Conferir

1. Abra http://127.0.0.1:8765, entre num run e vá à aba **Passos**. O campo "Pergunte sobre os dados deste passo…" deve estar habilitado, sem o aviso de configuração.
2. Opcional: rode as 10 perguntas de ouro contra o modelo real. Isso gasta dinheiro (cerca de US$ 0,10 a 0,30 por pergunta, US$ 1 a 3 no total):

```sh
.venv/bin/python tests/run_golden.py --confirmar-custo
.venv/bin/python tests/run_golden.py --confirmar-custo --so bruto_orbe   # só uma pergunta
```

O relatório marca cada pergunta com ✓ ou ✗ contra o valor esperado (calculado em Decimal), com custo e tempo, e fecha com os acertos e o custo médio. Sem gastar nada, `tests/run_golden.py --simulado` testa o roteiro e `tests/serve_chat_demo.py 8792` sobe a tela com um analista roteirizado.

## Custo e dados enviados

- Cada pergunta manda à API o prompt fixo (instruções, glossário e catálogo das tabelas, cerca de 23 mil tokens, em cache depois da primeira pergunta), a pergunta, o contexto da tela e até 50 linhas de cada resultado de consulta. As tabelas inteiras não saem do servidor.
- A primeira pergunta custa por volta de US$ 0,12 só de entrada; as seguintes saem mais baratas pelo cache. O custo estimado aparece no rodapé de cada resposta.
- Limites por pergunta: 10 chamadas ao modelo e 10 s por consulta SQL.
