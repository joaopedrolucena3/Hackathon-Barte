# Interface do pipeline e checklist

As novas telas preservam as páginas anteriores. Abra **Pipeline** na navegação para escolher a competência, iniciar uma execução, acompanhar os passos e revisar as exceções. **Checklist** reúne tarefas derivadas da execução mais recente e tarefas manuais editáveis.

## Execução e revisão

- **Nova execução** recebe a competência e, opcionalmente, os seis arquivos originais. Sem upload, usa as fontes configuradas no servidor. Cada upload usa `POST /api/files`; o início usa `POST /api/runs`.
- O nome do analista declarado é enviado em `X-User` nas mutações, com codificação percentual UTF-8 e o marcador `X-User-Encoding: percent-utf8` para preservar nomes com acentos. Ele pode ser preenchido no cabeçalho ou no formulário de confirmação.
- A lista lateral mostra a definição ordenada, a situação e o progresso de cada passo. A conexão SSE escuta eventos nomeados e mensagens com `data.type`. Ao conectar ou perder a conexão, a interface consulta o estado consolidado; uma consulta periódica de recuperação mantém o acompanhamento enquanto a página está aberta.
- A seleção de um passo lê seu preview preservado, sem solicitar reprocessamento. Paginação, filtros por coluna, comparação, ordenação, somente exceções e comparação com a entrada são executados no servidor. Colunas novas ficam destacadas. Linhas com exceções levam à revisão.
- Cada exceção permite aceitar, ajustar valor/conta ou excluir do lote, sempre com justificativa. As alterações ficam para a exportação e não reescrevem a saída original.
- Aprovar permanece indisponível enquanto o snapshot reportar bloqueantes abertas. A decisão final, inclusive reprovação, exige comentário. O backend continua sendo a autoridade para essas validações.
- O link de exportação só aparece com situação `done`. Auditoria pode ser consultada e baixada em qualquer etapa.

## Construtor e versões

O catálogo fornece nomes, descrições, entradas, saídas e esquema dos parâmetros. O construtor permite ordenar, adicionar e remover passos, editar parâmetros, validar e salvar uma nova versão. A aprovação não pode ser removida pela interface. O servidor valida todas as dependências e a posição da aprovação antes de salvar. Versões antigas podem ser consultadas e usadas como base sem sobrescrever o histórico.

## Checklist

A competência selecionada define o checklist. Tarefas vinculadas a passos exibem o estado derivado e levam à execução. Tarefas manuais permitem editar situação, responsável e comentário por `PATCH /api/checklist/{id}`.

## Arquivos e limites

`web/workflow.js` e `web/workflow.css` adicionam as telas com integração pequena em `app.js` e `index.html`. Nenhum framework, serviço de LLM, editor de prompts ou envio externo é usado. A identidade continua declarada, sem autenticação corporativa. A validação e os cálculos financeiros pertencem ao servidor.
