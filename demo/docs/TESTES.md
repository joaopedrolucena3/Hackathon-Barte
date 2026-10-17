# Verificação do fechamento Tarvo

A suíte contém 55 testes e usa `unittest` e arquivos temporários para as verificações de persistência. Os arquivos do data pack são somente lidos. Rode a partir da pasta `tarvo-mvp`:

```sh
./run.sh test
```

Os testes combinam exemplos pequenos calculados manualmente, regressões derivadas do data pack e testes de segurança do fluxo de trabalho. Não consideram a saída do próprio motor como gabarito.

## Regras e resultados esperados

| Teste | Evidência / comportamento esperado |
|---|---|
| Baseline checkout setembro | R$ 207.039,73 após taxas contratuais, antecipações, reversões, isenção vigente da Casa e bloqueio de Atlas. |
| Baseline remessas setembro | R$ 39.543,45: 50% do spread realizado positivo, uma vez por operação, arredondamento HALF_UP por operação. |
| Rota Global | Divergências de checkout somam R$ 1.546,28. |
| Bridge Idiomas | Divergências de checkout somam R$ 29,95, respeitando a renegociação em 15/09. |
| Casa: cobrança durante isenção | 118 divergências, total R$ 15.397,42. Taxa contratada zero deve continuar comparada à taxa cobrada pela Orbe; o estorno de agosto não integra estas divergências. |
| Casa do Estudante | Estorno `TX88445133`, venda original em 21/08: −R$ 369,39 × 1,49% = −R$ 5,50. Isenção setembro–dezembro não aplicada retroativamente. Total negativo não gera NF e exige revisão. Esta combinação de regras está explicitada nas hipóteses. |
| Atlas | 57 linhas de checkout aguardam validação de cadastro/contrato; nenhuma NF emitida automaticamente. |
| Fonte preservada | Hashes dos originais antes e depois da importação são iguais. |
| Rastro | A soma de `rastro.valor` para cada `id_saida` coincide exatamente com cada valor das cinco tabelas oficiais. |
| Repetição | Mesma entrada e parâmetros produzem a mesma saída, inclusive IDs e ordem. |

## Casos construídos manualmente

- Vigência em 14/09 e 15/09: duas vendas de R$ 1.000,00 com contratos de 2,59% e 2,19% geram R$ 47,80; taxa antiga aplicada à segunda venda gera divergência de R$ 4,00 e pendência.
- Estorno de venda de agosto realizado em setembro: aplica a taxa original; falta de data original bloqueia cálculo e pede revisão.
- Antecipação de R$ 1.000,00 e reversão de −R$ 1.000,00, ambas a 2,10%, somadas à comissão de uma venda de R$ 2,00: NF única de checkout de R$ 2,00.
- Contratos sobrepostos, lacuna de vigência ou estabelecimento desconhecido: nenhuma escolha silenciosa ou casamento aproximado de nome.
- Duas remessas de spread R$ 100,01: 50% de cada uma arredondados para R$ 50,01, total R$ 100,02. O spread estimado não participa da receita.
- Spread negativo: exclusão da comissão e pendência; duplicata idêntica: contabilizar uma vez e alertar; duplicata conflitante: não escolher uma das versões automaticamente.
- Tolerância de 0,002 ponto percentual: pequena diferença percentual em base grande não se confunde com limite monetário; diferença de 0,10 ponto percentual em base pequena continua gerando divergência.
- Valores não finitos (NaN/Infinity), linhas inválidas, sinais incompatíveis e líquido inconsistente geram pendência. A importação aponta arquivo e linha física rejeitada.
- Data original da reversão incompatível com a antecipação referenciada não é corrigida silenciosamente.
- Outubro sem dados não reaproveita movimentos nem alertas de duplicatas de setembro; gera apenas o bloqueio de competência sem movimentos.
- O detalhe de rastro exibe somente o ID solicitado e inclui a entrada completa da origem, além da fórmula e da regra.

## Controle humano e e-mails

Os testes de serviço verificam assinatura obrigatória, decisões persistidas, fechamento bloqueado por pendências, aceite explícito para concluir com itens abertos e reabertura após recalcular/alterar referência. A rejeição de uma proposta não resolve a pendência. Alterar a evidência original em uma reimportação invalida a decisão anterior mesmo preservando ID, tipo e valor; o teste muda o nome da linha no CSV e verifica o retorno à fila de revisão. Reclassificação humana atualiza tanto o código como a descrição da conta.

Cobranças e contestações só podem chegar ao registro de envio simulado depois de revisão e aprovação explícita. Alterar conteúdo depois de aprovar invalida aquela aprovação. E-mails internos obedecem às preferências do contato e podem ser enviados em simulação sem aprovação, conforme pedido do usuário. Os testes não acessam nenhum serviço de e-mail externo.

Os testes de exportação validam nomes, cabeçalhos, separador, valores e presença dos seis CSVs oficiais, relatório e hipóteses no ZIP.

## Limites da verificação

A suíte verifica regras implementadas, rastreabilidade e controles do MVP. Não confirma que hipóteses ainda abertas foram aprovadas pelo financeiro, nem homologa a emissão fiscal no ERP, nem envio real de mensagens. A revisão visual e a navegação pela interface são verificações complementares ao teste automatizado.
