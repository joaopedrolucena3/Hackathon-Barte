# Momentos de uso da IA

## 1 Ler antes de programar

O pedido exigiu três fontes: dados, instruções e Slack. A IA extraiu o DOCX, auditou os arquivos originais e leu 16 respostas do financeiro; o usuário confirmou que queria implementar o MVP completo. As regras esclarecidas foram registradas com links antes do código.

## 2 Corrigir um erro da IA na isenção

Uma primeira versão do motor excluiu as cobranças da Casa do Estudante da lista de divergências por tratá-las como isenção comercial. A revisão identificou que o financeiro havia dito que a Orbe cobrou e o valor seria devolvido; a supressão foi removida e um teste independente fixou 118 diferenças, totalizando R$ 15.397,42.

## 3 Não deixar o teste inventar uma política

Um teste inicial pressupôs reversão parcial de antecipação. A revisão constatou que os dados e respostas só sustentavam reversões integrais; o teste foi corrigido, e casos parciais permanecem em pendência em vez de receber regra inventada.

## 4 Conferir as decisões no produto

Depois dos testes automatizados, a IA percorreu a interface em um banco separado: registrou uma decisão com autoria, preparou e aprovou uma cobrança simulada e verificou que concluir com pendências exigia aceite. A aprovação se vincula ao conteúdo exato e é invalidada quando ele muda.

## 5 Um teste verde que dependia da máquina

O gerador do pack de outubro dividia o extrato Aurora de setembro por `"\r\n"`. Isso só funcionava porque o checkout no Windows convertia LF em CRLF, e o teste passava por causa dessa conversão. Ao fixar os bytes originais com `* -text` no `.gitattributes`, para que os SHA-256 da auditoria fossem iguais em todas as máquinas, nenhuma linha foi reconhecida e `test_outubro` quebrou. A correção foi trocar a divisão por `splitlines()`, que gera o mesmo `05a` de outubro, byte a byte, com LF ou CRLF. O erro foi tratar "o teste passa aqui" como prova de que o código estava certo. A verificação de verdade foi comparar a saída nas duas situações.

## Registro

`PEDIDO_ORIGINAL.txt` preserva o texto fornecido. Os arquivos `SESSAO_*.jsonl` exportam as mensagens visíveis disponíveis desta construção, com conteúdo textual preservado. Eventos de raciocínio interno, instruções de sistema e metadados privados não fazem parte da conversa visível. O time deve acrescentar o histórico de preparação e demais sessões anteriores: não foram reconstruídos nem inventados.
