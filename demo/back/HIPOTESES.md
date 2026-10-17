# Hipóteses e regras do fechamento

O documento consolidado da entrega é [HIPOTESES.md na raiz](../../HIPOTESES.md), que distingue regras esclarecidas, premissas, perguntas consultadas e decisões pendentes. Este guia conserva detalhes operacionais do backend. As [instruções oficiais](docs/01_instrucoes_participantes.docx), as [16 respostas já registradas](docs/FONTES_SLACK.md) e a [versão estruturada H01–H14](docs/assumptions.json) sustentam essas distinções; não são validação dos totais pela organização.

## Decisões que exigem atenção

- **Casa do Estudante:** isenção de MDR e antecipação entre 01/09 e 31/12 não retroage a uma venda de agosto estornada em setembro. A combinação da regra de vigência com a regra de estorno gera comissão de −R$ 5,50 e pendência, sem NF. Se o financeiro ampliar o alcance da isenção, revisar a vigência e recalcular. Não assumir que zero é ausência de taxa.
- **Atlas:** nome/CNPJ de 2025 é apenas candidato; taxas antigas nunca autorizam faturamento. Identidade e contrato vigente precisam de confirmação comercial. Cadastro e taxas são editáveis na plataforma.
- **Spread:** tolerância padrão de 0,002 ponto percentual, ajustável e auditada, evita alarmes pela precisão das cotações. Valor contestável é spread realizado menos spread contratual sobre ME×PTAX; valor da comissão é 50% realizado elegível, arredondado por operação. Contestações não reduzem automaticamente a NF da Ponte.
- **Negativos:** fora da comissão e NF segundo o financeiro, mantidos com evidência para contestação. Não presumir desconto correspondente no TED de outubro.
- **Duplicidade:** número da operação é único; duplicata idêntica conta uma vez e gera revisão/contestação. Duplicata conflitante deve ficar sem valor automático até uma pessoa decidir.
- **Prazos:** o Slack esclareceu que a contestação está em prazo no cenário do case, apesar do calendário do EML. Prazo de fechamento configurável é separado.
- **Bancos:** classificação é da contrapartida, incluindo baixa de provisões já registradas. Pix não identificado não vira receita. Não forçar conciliação do mês contra recebíveis parcelados sem agenda. Transferência 30/09 ainda em trânsito é pendência.
- **E-mail:** cobranças, avisos e relatórios do fluxo original são simulados. Gmail por senha de app ou OAuth permite envio real com conta conectada e permissão da versão exata. Avisos de execução têm ativação separada. O endereço preenchido na demo é caixa de teste, sem comprovação de contato oficial. Testes usam provedor simulado; aceitação pelo provedor real também não comprova entrega na caixa.
- **Identidade:** ator declarado localmente, sem autenticação. Adequado para demonstração em um computador, não para produção multiusuário.
- **Importação seguinte:** referências revisadas são preservadas; alterações contratuais não são aceitas silenciosamente em reimportação. Erros ou formatos não suportados exigem revisão.

## Entrega e colaboração

Não foram enviados novos questionamentos ao Slack nesta sessão. As respostas existentes do financeiro foram consultadas antes do código. O DOCX fala em entrega no canal e a resposta logística menciona e-mail; cabe ao time confirmar a logística. Nenhum repositório remoto, envio formal ou publicação é realizado pelo aplicativo.

## Arquitetura e limites

Cálculos financeiros usam Decimal com HALF_UP por linha; a IA não decide taxas nem aprova pagamentos. O motor é determinístico para entradas, parâmetros e referências iguais. SQLite mantém importações, cadastros, decisões, versões de cálculo e e-mails. Recalcular reabre o mês; decisões só são reaplicadas quando a evidência ainda é idêntica. Rastro deve somar exatamente o valor de cada saída.

Detalhes técnicos e evidências dos controles numéricos em `docs/ENGINE_NOTES.md`; cobertura e execução dos testes em `docs/TESTES.md`.

## Extensão de pipeline e ERP

- **Regras já esclarecidas:** a proposta posterior menciona dúvidas que o Slack já respondeu. Permanecem válidos o padrão de spread de 1,5%, participação de 50%, aceitação de ressalvas de compliance, taxas contratuais por data original e classificação de créditos Orbe sem conciliação de parcelas. Os valores do JSON de exemplo não substituem essas regras.
- **Partidas dobradas:** o case original exige classificação de contrapartidas; a nova solicitação adiciona lote contábil. O mapa `src/config/mapa_contabil.json` explicita contas de banco, recebíveis e receitas. A ligação de cada evento ao ERP é uma hipótese sujeita à revisão do contador antes da exportação. Nenhum tributo sobre a receita é inventado. Se o mapa estiver incorreto, alterá-lo e criar uma nova execução; a execução anterior permanece preservada.
- **Formato Fênix:** não foi fornecido um leiaute oficial de importação. O CSV produzido é um contrato explícito de partidas dobradas do MVP, com IDs, data, contas analíticas, valor, origem e justificativa. Não significa homologação no ERP real.
- **Reprodutibilidade:** datasets e arquivos financeiros são determinísticos para os mesmos bytes de entrada, parâmetros, versões e código. Datas de execução, IDs de run, responsáveis e durações pertencem à auditoria operacional e variam entre runs; portanto o arquivo de auditoria completo não é byte a byte igual. Os hashes de conteúdo permitem verificar a identidade dos resultados sem apagar essa história.
- **Imutabilidade e cadastros:** cada run lê uma cópia dos arquivos selecionados e a definição versionada. Pack, upload e pasta reconciliam referências recebidas com o catálogo revisado: conteúdo idêntico acrescenta proveniência, identidades novas ampliam o catálogo e conflitos ficam explícitos. Nenhuma edição muda uma execução existente. Aceitar uma exceção registra um encaminhamento, sem criar contrato, identidade ou comissão inexistente.
- **Identidade do revisor:** `X-User` é uma declaração de autoria no ambiente local da hackathon, não uma autenticação. A interface envia o nome informado pelo analista. Uma implantação multiusuário exigiria autenticação e controle de acesso.
