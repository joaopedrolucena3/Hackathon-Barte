# Motor de fechamento e controles independentes

O importador lê os arquivos originais; não os altera nem salva cópias limpas sobre eles. O motor recebe dados JSON e retorna seis tabelas, detalhes, parâmetros e resumo. As saídas são determinísticas. Todo valor monetário passa por `Decimal`, com `ROUND_HALF_UP` por origem, inclusive valores negativos. Taxas são pontos percentuais: `2.59` significa 2,59%.

## Fontes e identificação

- Orbe: 1.943 IDs únicos. 1.840 vendas, 59 estornos, 38 antecipações e seis reversões de antecipação. A identidade é o EC; nomes variantes não geram lojas novas.
- Planilha: aba `Taxas vigentes`, cabeçalho na linha 5; a aba `ANTIGO 2025 - nao usar` nunca fornece taxa. CNPJs numéricos são completados para 14 dígitos. Taxas escritas como texto percentual e como fração numérica são normalizadas explicitamente.
- ECs de Novo Horizonte (1043300981), Horizonte Viagens (1043396662) e Kiwi (1038867654) são os vínculos confirmados pelo financeiro no Slack. Atlas usa apenas um candidato cadastral da aba histórica: EC 1076801732, CNPJ 39566044000119. Não fatura antes de identidade e contrato vigentes confirmados.
- EML: extrai o anexo XLSX em memória. `Operações!A6:P238` contém 233 linhas, 232 números de operação. O resumo embutido não é base do cálculo porque inclui a duplicata e os spreads negativos.
- Aurora: cabeçalho físico na linha 7, 84 movimentos entre linhas 9–92; `ref_origem` usa L9 etc. OFX: 100 movimentos, `ref_origem` é FITID. Plano de contas e OFX são cp1252. Os demais CSVs usam UTF-8.
- Hash SHA-256 é conservado para cada arquivo e para o anexo embutido. Cada rastro também contém a linha física/linha de planilha.

## Regras usadas e interpretações explícitas

As regras comerciais são as respostas oficiais do financeiro consultadas pelo responsável pelo projeto no canal `#duvidas-hackathon-ai` em 16/10/2026, acrescidas da tabela e do corpo do EML.

1. Checkout é taxa contratada × bruto, por modalidade e faixa de parcelas. A comissão não é a taxa reportada pela adquirente. O truncamento isolado da adquirente não gera divergência: só taxa percentual diferente gera alerta, de valor `ROUND_HALF_UP(bruto × (aplicada − contratada) /100, 2)`.
2. Estornos de setembro são reconhecidos em setembro com taxa da data original, incluindo vendas de agosto ausentes no arquivo. Quando a venda está presente, validar identidade, tipo e data. Na regra original do case, a ausência histórica de venda de agosto, por si só, não gerava pendência porque a fonte trazia data, modalidade, EC e bruto. A extensão atual de histórico registra ORIGINAL_AUSENTE bloqueante quando não localiza a origem e preserva cálculo provisório quando aplicável. A diferença está explicitada na hipótese H13 e aguarda validação do financeiro; a revisão assistida não a resolve automaticamente.
3. Antecipação soma na mesma NF de checkout. Reversão usa data e taxa contratada da antecipação referenciada. As seis reversões fornecidas são integrais. Reversões parciais/excedentes ficam pendentes por faltar política comprovada; não há extrapolação silenciosa.
4. Casa do Estudante tem tarifa zero em MDR/antecipação de 01/09 a 31/12/2026. A Orbe cobrou indevidamente porque não foi avisada: 118 operações da vigência geram divergência aplicada menos zero e pendências de devolução, somando R$ 15.397,42 líquidos. A data usada é a original. Portanto, o estorno de 21/08 (Orbe TX88445133, linha 433) conserva -R$ 5,50; não se emite NF negativa. A composição destas duas regras é uma interpretação explícita, com pendência fiscal sobre crédito/ajuste. A tabela anterior termina 31/08, zero vale até 31/12; janeiro não presume retorno de preço sem contrato atualizado. Remessa Casa segue normal.
5. Bridge: crédito à vista 2,59% até 14/09, 2,19% desde 15/09. A data inicial antiga não é inventada: limite inferior aberto conforme texto disponível. Outras modalidades iguais, sem dupla taxa vigente.
6. Atlas: 57 registros bloqueados; nenhuma taxa histórica 2025 é usada. A pendência registra os R$ 7.876,05 reportados pela Orbe como exposição de dados não faturados, não como comissão devida.
7. Remessa: competência pela contratação. Incluir APROVADO e APROVADO C/ RESSALVA. Uma operação por ID; duplicatas de mesmo conteúdo geram contestação e contam uma vez. Versões conflitantes são bloqueadas, sem escolher a primeira como verdade.
8. Comissão remessa é 50% do spread realizado positivo, HALF_UP por operação. O spread estimado D-1 não substitui o realizado. Negativos não reduzem outras comissões nem entram na NF; são contestados. NF remessa é única para Ponte Câmbio, CNPJ 75374179000146; comissões continuam separadas por lojista.
9. Spread contratual em branco ou `padrão` equivale a 1,5%; Mundo Aberto 1,2%; demais valores explícitos da tabela são preservados. A receita usa spread realizado, inclusive excesso cobrado, enquanto a divergência contesta o valor integral.
10. Tolerância configurável padrão 0,002 ponto percentual. Observado máximo de 0,001600 pp entre taxa aplicada positiva e contratada fora Mundo Aberto, compatível com cotação em quatro casas. A tolerância não é percentual relativo nem dinheiro. Diferença monetária é `spread realizado − ROUND_HALF_UP(ME × PTAX × taxa contratada /100,2)`. Também registramos os quatro spreads negativos em divergências de taxa, por diferirem do contrato. Este critério de apresentação é explícito; não significa que a causa seja cobrança tarifária simples. Pendências e divergências não se somam como exposições independentes.
11. Valores negativos de comissão geram ajuste humano, não nota fiscal positiva/negativa automática. Comissão total e NF podem diferir em função desse bloqueio.

## Contrapartidas bancárias

`conta_codigo` é a contrapartida do movimento bancário. A coluna extra `conta_bancaria` conserva a própria conta do banco e `contrapartida_sentido` indica débito/crédito. Somente contas analíticas com `ACEITA_LANCTO=S` são usadas.

- Créditos Orbe: recebíveis de adquirente 1.1.03.001; repasses lojistas: obrigações 2.1.01.001. As descrições truncadas conhecidas são aliases exatos, não similaridade de nomes.
- Entradas de clientes Meridiano e saídas Ponte para liquidação: recursos de remessas 2.1.02.001. Recebimento Ponte em 04/09 de R$ 61.884,12: baixa de comissão agosto 1.1.03.002, já provisionada.
- Folha/tributos anteriores confirmados pelo financeiro: baixa dos passivos específicos. O mapeamento de DARFs sem competência explícita é confirmado apenas para o pack de setembro. Um DARF futuro desconhecido exige revisão.
- Despesas correntes: tarifas 4.2.01; condomínio 4.2.02; cloud 4.2.03; software 4.2.04; seguro 4.2.05; contabilidade 4.2.06; IOF 4.3.01.
- Aplicação/resgate: 1.1.02.001, movimento de principal. Rendimento explícito 3.2.01. Não inferimos rendimento de diferenças entre aplicação e resgate.
- Transferências próprias: 1.1.09.001. As três entradas de R$ 1.150.000,00 casam com saídas em mesma data/valor. Saída 30/09 de R$ 300.000,00 mantém pendência informativa de trânsito para 01/10.
- PIX Aurora R$ 7.350,00: créditos não identificados 1.1.09.002, com pendência de identidade. Devolução R$ 12.400,00: recompõe obrigação 2.1.01.001, motivo ainda pendente. Ter contrapartida conhecida não resolve a pendência operacional.
- Descrição nova sem regra: conta vazia e pendência. Não reconhecer receita por ser entrada de caixa.

## Controles do pack de setembro

| Controle | Valor/contagem |
|---|---:|
| Comissão checkout, incluindo Casa -5,50 |207.039,73|
| MDR checkout líquido |188.108,26|
| Antecipação checkout líquida |18.931,47|
| Comissão remessa, 228 operações não negativas únicas |39.543,45|
| Spread positivo único |79.085,76|
| Soma dos quatro spreads negativos excluídos das comissões |-1.834,05|
| Notas checkout: 20 tomadores |207.045,23|
| NF remessa Ponte: 1 tomador |39.543,45|
| Total 21 NFs |246.588,68|
| Divergência Rota: 83 vendas + 4 estornos |1.546,28|
| Divergência Bridge: 5 vendas |29,95|
| Divergência Mundo Aberto: 23 operações |1.418,88|
| Divergência Casa isenta: 118 operações |15.397,42|
| Divergência dos quatro negativos remessa |-3.565,98|
|237 divergências, soma assinada |14.826,55|
|237 divergências, soma de módulos |22.173,57|
| Aurora: saldo inicial |612.334,81|
| Aurora: movimentos líquidos |-2.532.423,41|
| Aurora: saldo final |-1.920.088,60|
| Meridiano: movimentos líquidos |1.116.335,23|
| Meridiano: saldo final |1.320.453,26|
| Meridiano: saldo inicial apenas inferido |204.118,03|

A diferença de R$ 0,57 entre 39.543,45 e metade arredondada do total de spread (39.542,88) comprova por que o arredondamento precisa ocorrer por operação. O saldo inicial Meridiano não consta como campo explícito; o valor acima é somente fechamento aritmético, não confirmação documental de abertura.

Duplicata PC-0926-0162 em `Operações` linhas 76–77: spread 821,88, observação `reprocessada` na segunda. Negativos: PC-0926-0210 linha 96 (-687,52), 0326 linha 141 (-509,22), 0491 linha 205 (-292,28), 0545 linha 228 (-345,03). Seis operações contratadas 30/09 e liquidadas 01/10 somam spread 2.078,71 e permanecem no mês de contratação.

Na geração limpa conferida em 17/10/2026, o código atual produz 295 pendências: 237 divergências de taxa, 38 alertas de bandeira divergente, nove origens históricas ausentes, uma pendência agrupando as 57 operações da Atlas, quatro spreads negativos e uma ocorrência de cada tipo restante (duplicata, comissão Casa negativa, crédito não identificado, devolução de repasse, transferência em trânsito e conferência do repasse da Ponte). São dez bloqueantes: Atlas e as nove origens ausentes. Os cinco CSVs de resultados contêm 772 registros, ligados a 5.226 linhas de rastro, com somas exatas nesta reprodução.

As 304 pendências/57 bloqueantes registradas em saídas e relatórios antigos pertencem à versão anterior, que não agrupava Atlas e ainda não emitia os 47 alertas de qualidade/origem acima. A conferência da Ponte continua expondo os R$ 39.543,45 faturados para comparação com extrato futuro; não presume que o TED terá esse valor. Contagens são itens de acompanhamento, não perdas independentes nem gabarito da organização. Use [o comando da entrega](../../../README.md) para reproduzir o estado atual.

## Verificação e limites

Uma auditoria independente dos arquivos confirmou os controles acima antes da implementação. Cada valor em comissão, divergência, nota, lançamento e pendência tem rastro cuja soma por `id_saida` é exatamente seu valor. As fontes originais são preservadas e o anexo é lido em memória.

Cada pendência também guarda um SHA-256 do conteúdo das suas próprias linhas de evidência. Uma mudança de evidência invalida a decisão anterior mesmo se arquivo, ID e valor permanecerem iguais. Os detalhes do rastro incluem a entrada completa normalizada, fórmula e contrato. A detecção de duplicidade considera somente o mês escolhido e, no checkout, as origens históricas efetivamente referenciadas por estornos/reversões desse mês.

Este motor não reconcilia parcelas individuais da adquirente contra TED agregada, não inventa contrato Atlas, não calcula tributos sobre NF, não emite documento fiscal e não envia mensagens reais. Contrapartidas representam classificação do extrato; não há partida contábil completa importada em ERP. Políticas futuras não inferíveis dos formatos conhecidos ficam pendentes. Estornos não podem ser liquidados só por similaridade de nome.

O motor também impede contabilização de linhas com sinal incompatível, bruto menos taxa diferente do líquido, reversão sem referência válida e estorno com identidade, data, modalidade ou parcelas diferentes da venda presente. Se nenhuma transação pertence à competência selecionada, gera pendência bloqueante de ausência de movimentos. Isso impede interpretar uma troca de mês sem importação como fechamento completo.

## Recomendações de revisão por execução

A política `review-guidance-v1` produz justificativas estruturadas com fato, regra, evidências, hipótese, efeito, responsável e próximo passo. Hipóteses são capturadas na criação da execução; recomendações são preservadas ao terminar o cálculo. Execuções antigas sem essa captura mostram a limitação, sem incorporar hipóteses atuais como se fossem históricas.

A ação “Seguir sugestões do agente” apresenta uma prévia e registra somente os alertas elegíveis de divergência de taxa e duplicata idêntica, mantendo os cálculos existentes. Não altera valores, elimina a operação válida de uma duplicata, modifica contrato, envia comunicação ou aprova a execução. Contato e resposta do parceiro permanecem pendentes e aparecem na justificativa. Outras ocorrências mostram o dado necessário e o responsável pela revisão individual.

A aplicação vincula a prévia à execução, à versão da política, às evidências e às decisões presentes. Uma prévia desatualizada exige nova revisão; repetir a mesma aplicação não duplica registros. Todas as decisões do conjunto são gravadas numa transação, com rastreabilidade individual e registro do conjunto.
