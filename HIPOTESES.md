# Hipóteses, regras e pendências da Tarvo

Este documento é o ponto de entrada da entrega. Baseia-se nas [instruções oficiais](demo/back/docs/01_instrucoes_participantes.docx), nas fontes originais do case e nas [16 respostas do financeiro já registradas em FONTES_SLACK.md](demo/back/docs/FONTES_SLACK.md). Essa lista é uma síntese com links, não transcrição integral nem aprovação dos nossos totais. A revisão deste repositório não enviou novas perguntas ao financeiro e não atribui ao time a autoria de perguntas que não está comprovada nos registros.

A [versão estruturada das hipóteses](demo/back/docs/assumptions.json) é capturada pelas novas execuções da aplicação. Os identificadores H01–H14 abaixo permitem relacionar esta documentação à interface. As [notas do motor](demo/back/docs/ENGINE_NOTES.md) detalham fórmulas e controles.

## Regras esclarecidas pelo financeiro

Os horários a seguir são de 16/10/2026, em São Paulo. Cada resposta e seu link original estão em FONTES_SLACK.md.

| Assunto consultado | Resposta registrada | Fonte |
|---|---|---|
| Base de faturamento checkout | Comissão inteira pela taxa contratada por produto/data, multiplicada pelo bruto. A taxa aplicada pela Orbe serve à comparação. Não deduzir um custo Orbe presumido. | 20h05 e 22h34 |
| Estornos e antecipação | Reconhecer no mês do estorno usando a taxa da data original; antecipação e reversão entram na mesma NF de checkout. | 20h06, 20h47 e 22h34 |
| Identidades | EC 1043300981: Novo Horizonte; 1043396662: Horizonte Viagens; 1038867654: Kiwi. Atlas não pode ser faturada sem confirmação comercial de identidade e contrato vigente. | 20h24 |
| Rota e Casa do Estudante | Rota não mudou o contrato. Casa tem isenção de MDR/antecipação de setembro a dezembro; remessa continua normal. | 20h49 |
| Comissão de remessa | 50% do spread realizado elegível, pela contratação. `padrão`/em branco = 1,5% sobre PTAX; Mundo Aberto = 1,2%; ressalva de compliance não exclui operação. | 20h48 |
| Negativos e duplicidades | Spread negativo de trava vencida fica fora da comissão/NF e deve ser contestado. Operação repetida conta uma vez e também deve ser comunicada. | 20h48 e 22h34 |
| Notas | Uma NF mensal de checkout por lojista; zero/negativo não emite, negativo vira pendência sem transporte automático. Remessas têm NF única para Ponte. Excesso contestável continua na receita realizada até eventual devolução. | 20h47 e 21h45 |
| Arredondamento e divergências | `ROUND_HALF_UP` por linha, depois somar. Checkout: bruto × (aplicada − contratada). Truncamento isolado não é divergência. Remessa contesta a diferença integral, não apenas os 50% de participação. | 20h58 e 21h13 |
| Bancos | Classificar contrapartidas, baixar provisões anteriores e reconhecer despesas correntes quando cabível. PIX não identificado não vira receita. Devolução recompõe obrigação; transferência de 30/09 fica em trânsito até 01/10. | 20h49 e 21h14 |
| Recebimentos e prazos | Não presumir desconto no TED Ponte; conferência futura é pendência. Sem agenda Orbe, não exigir conciliação parcela a parcela. Considerar contestação em prazo no cenário do case. | 22h33 e 22h34 |

## Premissas adotadas e decisões pendentes

| Referência | Natureza | Tratamento e consequência |
|---|---|---|
| H01 — Casa e estorno de agosto | Interpretação explícita | Combinar vigência da isenção com taxa da venda original: a isenção não retroage. O estorno `TX88445133` conserva −R$ 5,50 e a Casa fica com comissão negativa, sem NF. Se o financeiro ampliar a isenção, revisar vigência e recalcular; não tratar taxa zero como ausência. |
| H02 — Tolerância do spread | Parâmetro adotado | 0,002 ponto percentual, ajustável e auditado, para a precisão das cotações. O financeiro pediu tolerância justificada; não confirmou esse número como regra contratual. A diferença monetária usa spread realizado menos `ME × PTAX × taxa_contratada_pct / 100`, com a taxa em pontos percentuais e arredondamento por linha. |
| H03 — Atlas | Pendência comercial | Nome/CNPJ na aba de 2025 é somente candidato. Não usar taxas antigas. As 57 operações originais são agrupadas por empresa/competência, preservando cada evidência, e seguem sem faturamento. Exposição reportada não é comissão autorizada. |
| H04 — Prazo de contestação | Esclarecido no cenário | Usar o prazo aberto informado pelo financeiro, apesar do calendário do EML. Antes de uso real, confirmar datas e destinatários. Revisar a pendência não envia comunicação. |
| H05 — Bancos sem identificação | Pendência operacional | Crédito desconhecido permanece em transitória; devolução e transferência em trânsito continuam acompanhadas. Classificação provisória não comprova pagador ou liquidação. |
| H06 — Recebimentos seguintes | Limite de evidência | Não inferir o TED de outubro a partir da comissão de setembro nem reconhecer provisões novamente. Conciliação depende de dados posteriores e, para parcelas, de agenda da Orbe. |
| H08 — Canal de entrega | Pendência logística | DOCX exige link no thread do time; a resposta de 20h13 menciona e-mail. Confirmar com a organização. Esta divergência não autoriza publicar ou enviar automaticamente. |
| H10 — Mapa e leiaute ERP | Hipótese do MVP | O [mapa contábil](demo/back/src/config/mapa_contabil.json) deve ser revisado pelo contador. Não foi fornecido manual de importação Fênix; CSV balanceado não significa homologação. Não inventar tributos. |
| H13 — Original histórico ausente | Política pendente de validação | O motor atual gera `ORIGINAL_AUSENTE` bloqueante quando não localiza a operação e, para certos estornos anteriores ao mês, conserva cálculo provisório pela data declarada. Isso é mais restritivo que a interpretação inicial do case; importa validar a política e obter a fonte histórica, não apresentar o vínculo como confirmado. |

Os quatro spreads negativos também aparecem em divergências por diferirem do contrato. Essa é uma escolha explícita de apresentação; não prova que a causa seja uma cobrança tarifária simples. Pendências, divergências e receitas são visões sobre operações relacionadas e não devem ser somadas como perdas independentes. Valores desconhecidos permanecem indisponíveis; zero só representa valor conhecido ou um marcador explicitamente descrito, nunca estimativa silenciosa de exposição.

## Decisões de implementação e limites

- **H07 — Comunicação e autoria:** o operador declara seu nome localmente. Gmail por senha de app ou OAuth permite envio real após conexão e permissão da versão exata; avisos de execução têm autorização separada. Fluxos antigos continuam simulados. Aceitação pelo provedor não comprova entrega, leitura ou resposta. Testes usam provedores simulados; consulte [GMAIL.md](demo/back/docs/GMAIL.md).
- **H09 e H12 — Importação e catálogo:** arquivos originais e complementos preservam evidência. Pack, upload e pasta reconciliam referências com o catálogo revisado: conteúdo idêntico acrescenta proveniência, identidades novas ampliam o catálogo e conflitos permanecem para revisão. Uma alteração contratual não substitui silenciosamente a referência revisada; execuções existentes conservam seus snapshots.
- **H11 — Reprodutibilidade:** mesmos bytes, parâmetros, referências e código devem gerar o mesmo conteúdo financeiro. Horários, duração, IDs de execução e autoria pertencem à auditoria operacional e podem variar. A entrega oficial usa banco novo e registra fontes/código no manifesto; não depende de edições do banco de demonstração.
- **H14 — Revisão assistida:** aplicar sugestões registra decisões elegíveis de divergência de taxa ou duplicata idêntica, preservando o cálculo e exigindo evidência suficiente. Não cria identidade, contrato, resposta de parceiro, autorização de e-mail ou aprovação final do lote.
- **Cálculo e IA:** o motor usa `Decimal` e regras determinísticas. O chat opcional usa API Anthropic para consultar dados e exige credencial no servidor; falha ou ausência da API não autoriza estimar números nem aprovar decisões financeiras.
- **Fiscal e ERP:** notas são propostas, sem emissão de NFS-e. O aplicativo não executa pagamentos ou devoluções. Classificação bancária é exigência do case; o lote de partidas dobradas é uma extensão com aprovação humana e leiaute ainda não homologado.
- **Outubro:** o pack e as saídas existentes de outubro são sintéticos. Servem para exercitar o fluxo, sem comprovar fechamento de operação real nem suporte universal a novos formatos.

## Integridade da entrega

O comando [entrega.sh](entrega.sh) produz os seis CSVs diretamente em `saida/`, com manifesto e verificação. As subpastas de execuções anteriores são preservadas e identificadas como históricas; não representam automaticamente o resultado do código atual. A revisão compara somas do rastro por ID, formato e referências sem limpar os originais manualmente.

As perguntas e respostas já registradas devem permanecer com suas fontes; lacunas de histórico ou de confirmação são declaradas, não preenchidas por relatos inventados. Entrega no GitHub/canal da organização e pitch continuam atos do time, separados da geração local.
