# Roteiro de demonstração

Duração sugerida: cinco a sete minutos. Rode `./run.sh serve --port 8766 --db data/demo.sqlite3 --runs-dir data/demo-runs` para demonstrar sem alterar o banco principal. Use apenas endereços do domínio reservado example.com: o roteiro original abaixo usa somente os fluxos de simulação. Não utilize o fluxo Gmail real com destinatários fictícios.

1. **Abra o Resumo e informe o analista.** Explique que os arquivos chegam em formatos diferentes e que a plataforma mantém contrato, vigência e origem junto de cada número. Mostre checkout R$ 207.039,73, remessa R$ 39.543,45 e os valores provisórios, devido às pendências.
2. **Mostre uma regra de negócio.** Em Divergências, procure o CNPJ 00520815000100. Abra Ver rastro de TX88410932: bruto 608,88, aplicada 2,69%, contratada 0%, diferença 16,38. A Casa tem isenção, mas a Orbe cobrou. A soma das 118 diferenças da Casa é 15.397,42. A diferença é pela fórmula contratada, não apenas pelo campo truncado da Orbe.
3. **Trate uma divergência.** Abra a pendência correspondente. Confirme o encaminhamento de contestar/devolver com justificativa, ou ajuste o encaminhamento. Mostre responsável, horário e auditoria. Não use a confirmação para inventar um contrato da Atlas.
4. **Explique a remessa.** Em Notas, filtre REMESSA: uma nota para Ponte de 39.543,45. Rastro comprova 50% realizado arredondado por operação. Negativos não entram; duplicata conta uma vez. A contestação da Mundo Aberto não reduz essa NF automaticamente.
5. **Aprove uma cobrança.** Prepare o rascunho da Ponte; preencha financeiro@example.com, revise mensagem e salve. O envio está bloqueado até Aprovar esta versão. Aprove, depois Simular envio. Abra o registro de destinatário, conteúdo, aprovação e horário.
6. **Mostre avisos internos.** Em Cadastros > Contatos, adicione analista@example.com, tipo interno, severidade atenção, resumo consolidado. Em E-mails, processe alertas. O resumo aparece como envio simulado, sem exigir aprovação de cobrança.
7. **Mostre o fechamento responsável.** Tente concluir com pendências: exige aceite e justificativa. Para a demo, use a ressalva “Demonstração: Atlas aguarda contrato comercial; contestações e TED de outubro permanecem sob responsabilidade do financeiro”. Os itens continuam no relatório. Baixe o pacote com os seis CSVs e rastro.
8. **Mostre outubro.** Evidências > Importar competência permite novos arquivos sem editar planilhas. Taxas, vigências e contatos ficam no cadastro. Sem movimentos ou sem contrato, surge pendência; o sistema não inventa um mês fechado.

Não apresente a demo como fechamento aprovado pela organização. Valores foram recalculados e testados a partir das fontes; decisões comerciais abertas permanecem do financeiro.

## Demonstração do pipeline versionado

1. Abra **Pipeline**, informe o responsável e mantenha setembro de 2026. Clique **Executar fechamento** com os seis arquivos locais; acompanhe as etapas e o progresso.
2. Selecione **Conferir MDR**, a saída de conferência, e filtre o identificador `TX88410932`. Ative as diferenças para mostrar taxa contratada zero e o impacto de R$ 16,38, sem recalcular o pipeline.
3. Abra a revisão. O lote pausa com 305 exceções e 58 bloqueantes. A validação do mapa contábil proposto é uma dessas pendências. Mostre a aprovação indisponível enquanto há bloqueantes.
4. Em um banco de demonstração, exclua uma operação Atlas com justificativa. A evidência permanece e nenhuma receita é inventada. Abra a auditoria para ver a decisão.
5. Abra **Construtor**, altere a tolerância de MDR, valide e salve uma nova versão. A execução anterior continua ligada à definição antiga. Uma ordem que viola dependências é recusada.
6. Em **Checklist**, edite a tarefa comercial manual. As outras tarefas refletem a execução mais recente do mês.
7. Reprove o lote de demonstração com justificativa. Ele fica no histórico e não gera exportação. Para mostrar o caminho aprovado sem simular validações reais do financeiro, use o teste automatizado `test_approve_exports_balanced_ledger_and_preview_is_paginated`, que faz isso somente em banco temporário.

Após aprovação real das exceções e do mapa, a exportação gera o CSV de partidas dobradas, relatório de exceções, ajustes, manifesto e auditoria. O leiaute continua sujeito à homologação do Fênix; a aplicação não envia o lote ao ERP.

## Demonstração da integração Gmail

Siga o roteiro de `docs/GMAIL.md` para configurar OAuth, conectar uma conta de teste e cadastrar destinatários controlados pelo time. A geração parte de uma pendência e a revisão inclui texto e anexos. **Aprovar e enviar** é a única ação de aprovação/envio real. Não use o roteiro de simulação acima como evidência de entrega pelo Gmail.

Para repetir a verificação visual sem conta nem mensagens reais, execute `.venv/bin/python tests/serve_mail_demo.py` e abra `http://127.0.0.1:8766/#mail`. Esse processo usa um provedor falso injetado, um banco temporário e um retorno local de autorização; não testa o consentimento real do Google e não deve ser usado na demonstração real.
