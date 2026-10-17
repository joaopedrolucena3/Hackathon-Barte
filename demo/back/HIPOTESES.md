# Hipóteses e regras do fechamento

As instruções oficiais estão em `docs/01_instrucoes_participantes.docx`. As 16 respostas consultadas antes da implementação estão referenciadas em `docs/FONTES_SLACK.md`. As hipóteses, fontes, decisões e impactos também aparecem na tela Evidências e no relatório; a versão estruturada está em `docs/assumptions.json`.

## Decisões que exigem atenção

- **Casa do Estudante:** isenção de MDR e antecipação entre 01/09 e 31/12 não retroage a uma venda de agosto estornada em setembro. A combinação da regra de vigência com a regra de estorno gera comissão de −R$ 5,50 e pendência, sem NF. Se o financeiro ampliar o alcance da isenção, revisar a vigência e recalcular. Não assumir que zero é ausência de taxa.
- **Atlas:** nome/CNPJ de 2025 é apenas candidato; taxas antigas nunca autorizam faturamento. Identidade e contrato vigente precisam de confirmação comercial. Cadastro e taxas são editáveis na plataforma.
- **Spread:** tolerância padrão de 0,002 ponto percentual, ajustável e auditada, evita alarmes pela precisão das cotações. Valor contestável é spread realizado menos spread contratual sobre ME×PTAX; valor da comissão é 50% realizado elegível, arredondado por operação. Contestações não reduzem automaticamente a NF da Ponte.
- **Negativos:** fora da comissão e NF segundo o financeiro, mantidos com evidência para contestação. Não presumir desconto correspondente no TED de outubro.
- **Duplicidade:** número da operação é único; duplicata idêntica conta uma vez e gera revisão/contestação. Duplicata conflitante deve ficar sem valor automático até uma pessoa decidir.
- **Prazos:** o Slack esclareceu que a contestação está em prazo no cenário do case, apesar do calendário do EML. Prazo de fechamento configurável é separado.
- **Bancos:** classificação é da contrapartida, incluindo baixa de provisões já registradas. Pix não identificado não vira receita. Não forçar conciliação do mês contra recebíveis parcelados sem agenda. Transferência 30/09 ainda em trânsito é pendência.
- **E-mail:** todos os envios são simulados. Contatos não são inventados. Cobrança/contestação requer aprovação da versão exata. O sandbox registra o que enviaria, sem alcançar nenhum destinatário.
- **Identidade:** ator declarado localmente, sem autenticação. Adequado para demonstração em um computador, não para produção multiusuário.
- **Importação seguinte:** referências revisadas são preservadas; alterações contratuais não são aceitas silenciosamente em reimportação. Erros ou formatos não suportados exigem revisão.

## Entrega e colaboração

Não foram enviados novos questionamentos ao Slack nesta sessão. As respostas existentes do financeiro foram consultadas antes do código. O DOCX fala em entrega no canal e a resposta logística menciona e-mail; cabe ao time confirmar a logística. Nenhum repositório remoto, envio formal ou publicação é realizado pelo aplicativo.

## Arquitetura e limites

Cálculos financeiros usam Decimal com HALF_UP por linha; a IA não decide taxas nem aprova pagamentos. O motor é determinístico para entradas, parâmetros e referências iguais. SQLite mantém importações, cadastros, decisões, versões de cálculo e e-mails. Recalcular reabre o mês; decisões só são reaplicadas quando a evidência ainda é idêntica. Rastro deve somar exatamente o valor de cada saída.

Detalhes técnicos e evidências dos controles numéricos em `docs/ENGINE_NOTES.md`; cobertura e execução dos testes em `docs/TESTES.md`.
