# Sessão 02 — Prompt de construção do MVP (GPT Astra)

- **Data:** 2026-10-17
- **Ferramenta:** GPT Astra

## Prompt

````markdown
# Contexto

Você vai construir um MVP para uma hackathon. Você tem acesso a três fontes:
1. **Dados do case** (planilhas e arquivos de exemplo)
2. **Instruções oficiais do case**
3. **Dúvidas respondidas no Slack** pela organização

Leia as três fontes antes de escrever qualquer código. As respostas do Slack esclarecem ou corrigem as instruções. Quando houver conflito entre elas, ou algo não estiver coberto, registre isso como hipótese explícita. Não decida em silêncio.

# Objetivo

Entregar uma **plataforma** que automatize, por meio de scripts, o objetivo central do case. O foco é ajudar analistas a **fechar o mês de forma rápida, segura, confiável e fácil de entender**.

Prioridade em caso de trade-off:
**cumprir o case > confiabilidade dos resultados > clareza para o analista > acabamento visual**

# O que a plataforma precisa fazer

## 1. Automatizar o processo do case
- Implemente as regras de negócio do case como scripts ou serviços reprodutíveis.
- Rodar duas vezes com a mesma entrada deve dar o mesmo resultado.
- Cada número calculado deve ser rastreável até sua origem: qual dado, qual regra, qual taxa vigente.

## 2. Human in the loop em qualquer divergência ou ambiguidade
- Divergências, inconsistências, dados faltantes e casos que as regras não cobrem não devem ser resolvidos automaticamente.
- Esses casos devem gerar um item para o analista revisar, contendo:
  - o que foi encontrado
  - por que é um problema
  - o que o sistema sugere
  - os dados de apoio
- O analista deve poder confirmar, rejeitar ou ajustar cada item.
- Registre quem decidiu, o quê e quando.
- O fechamento do mês não deve ser concluído com pendências abertas, a menos que o analista aceite isso explicitamente.
- Você decide o formato: fila de pendências, avisos em tela, confirmações em etapas, ou outro.

## 3. Avisos, alertas e relatórios
- Use níveis de severidade claros, por exemplo informativo, atenção e bloqueante.
- O analista deve ver o status do fechamento rapidamente: o que está ok, o que está pendente e o que exige ação.
- **Os analistas também recebem alertas e avisos por e-mail**, além de vê-los na plataforma:
  - Pendências novas, itens bloqueantes, prazos do fechamento se aproximando, conclusão de etapas e relatórios prontos.
  - Os destinatários e o que cada um recebe ficam configuráveis na plataforma. Exemplos: severidade mínima, alerta imediato ou resumo consolidado.
  - Cada e-mail deve ser acionável: dizer o que aconteceu e o que o analista precisa fazer, com link ou referência para o item na plataforma.
  - Esses e-mails internos não precisam de aprovação para sair. Isso é diferente das cobranças para outras empresas (seção 4).
  - Registre todos os envios. Durante a demo, use modo simulação ou sandbox.
- Gere relatórios de fechamento que o analista possa baixar, receber por e-mail ou repassar. Inclua os resultados, as divergências encontradas e como cada uma foi resolvida.

## 4. Envio de e-mails de cobrança, sempre com permissão
- A plataforma gera rascunhos de e-mails de cobrança para outras empresas, com base nos resultados do fechamento.
- **Nenhum e-mail é enviado sem aprovação explícita do analista.** O analista deve poder revisar e editar antes de aprovar.
- O padrão deve ser modo simulação ou sandbox. O envio real exige configuração e confirmação deliberadas.
- Registre todo envio: destinatário, conteúdo, quem aprovou e quando.

## 5. Nenhuma planilha para o analista
- O analista não deve precisar abrir nem editar planilhas. Tudo acontece na plataforma.
- Dados de referência ficam em um banco de dados com estrutura clara e são editáveis pela interface. Exemplos: taxas e suas vigências, empresas/contrapartes, contatos de cobrança, parâmetros.
- Taxas com vigência precisam de histórico.
- Valide os dados de referência, por exemplo vigências sobrepostas ou lacunas de vigência. Alerte quando encontrar problemas.
- A importação inicial dos dados do case pode ser automática, mas deve ser validada e reportar o que não conseguiu interpretar.

## 6. Testes automatizados de qualidade
- Os testes devem garantir que o script cumpre o case, não apenas que o código roda.
- Inclua no mínimo:
  - Testes das regras de negócio, com resultados esperados derivados dos dados e instruções do case.
  - Casos de borda: vigência trocando no meio do período, dados faltantes, duplicidades, valores divergentes, e outros que você identificar.
  - Testes garantindo que divergências geram pendência em vez de decisão automática.
  - Testes garantindo que nenhum e-mail sai sem aprovação.
- Os testes devem rodar com um único comando.
- Deixe claro o que cada teste valida.

# Stack

Escolha um stack simples, adequado a um MVP de hackathon: rápido de montar, fácil de rodar localmente e fácil de demonstrar. Justifique a escolha em poucas linhas. Prefira menos peças a mais peças.

# Hipóteses e transparência

Mantenha um documento de hipóteses, acessível também pela plataforma se fizer sentido. Para cada hipótese, registre:
- a dúvida ou ambiguidade
- a fonte (instruções, Slack ou dados)
- a decisão tomada
- o impacto se a hipótese estiver errada

Se uma hipótese for configurável, por exemplo uma regra que poderia ser de dois jeitos, prefira torná-la um parâmetro visível em vez de fixá-la no código.

# Como trabalhar

Você define o seu plano de trabalho: as etapas, a ordem e o que priorizar em cada momento. Antes de começar a implementar, apresente esse plano em poucas linhas, para que fique claro o caminho que você escolheu. Quando o plano mudar no meio do caminho, diga o que mudou e por quê.

# Entregáveis

- Código da plataforma, rodando localmente com instruções simples (idealmente um comando).
- Banco de dados populado com os dados do case.
- Suíte de testes automatizados.
- README com: visão geral, como rodar, como testar, decisões de arquitetura e limitações conhecidas.
- Documento de hipóteses.
- Roteiro curto de demo: o passo a passo de um analista fechando o mês na plataforma, mostrando pelo menos uma divergência sendo tratada e um e-mail de cobrança sendo aprovado.

# Critério de sucesso

Um analista que nunca viu a plataforma consegue fechar o mês do case sem tocar em planilhas. Ele entende de onde vem cada número, é avisado de tudo que exige atenção, decide sobre cada ambiguidade e aprova cada cobrança antes do envio. Os testes comprovam que o resultado está correto.
````

## Resultado

Criação de um MVP inicial e basico, com alguns problemas a serem analisados

## Verificação

Observar o funcionamento e indentificar pontos de melhoria
