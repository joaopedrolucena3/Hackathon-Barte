# Tarvo Fechamento

Plataforma local para apurar setembro de 2026 a partir dos arquivos originais da Tarvo. Calcula comissões, diferenças de taxa, notas propostas e contrapartidas bancárias; mantém pendências e decisões humanas, rastros e relatórios. E-mails diretos para Orbe/Ponte, pendências revisadas e avisos de runs/testes podem ser enviados pelo Gmail após conectar a conta. Cobranças e avisos do fluxo antigo continuam em simulação. O analista trabalha pela interface, sem abrir planilhas.

## Rodar

Pré-requisitos: Python 3.11 ou superior com venv, Node.js 18+ e npm; acesso ao PyPI e npm na primeira execução. O fechamento funciona sem chave de API. Para envio real, conecte o Gmail com uma senha de app na aba Comunicações → E-mail real. OAuth também está disponível.

```sh
./run.sh
```

Abra http://127.0.0.1:8765. A interface React integrada está em `../front/`; o launcher a compila automaticamente. Use **Fechamento** para iniciar e **Execução** para revisar o pipeline; veja também `docs/ENTREGA_PIPELINE.md`. A primeira execução cria `.venv`, instala as dependências fixadas em `requirements.lock.txt` e importa automaticamente `data/case/` para `data/tarvo.sqlite3`. As próximas execuções reutilizam o banco. Para parar, pressione Ctrl+C no terminal.

```sh
./run.sh test       # suíte automatizada, bancos temporários
./run.sh export     # gera os seis CSVs oficiais e relatório em saida/
./run.sh serve --port 8766 --db data/demo.sqlite3 --runs-dir data/demo-runs  # demonstração isolada
```

Windows: crie o ambiente com `python -m venv .venv`, instale as dependências usando `.venv\Scripts\python -m pip install -r requirements.lock.txt`, compile o front com `cd ..\front && npm ci && npm run build`, volte para `back` e rode `.venv\Scripts\python -m src.app`.

## E-mail real da demo

Em **Comunicações → E-mail real**, conecte `financeirotarvo@gmail.com` com uma senha de app do Google. A conta envia e recebe os exemplos de Orbe/Ponte. Revise o destinatário e o texto e clique **Enviar e-mail real**. Ative os avisos para receber o resultado de uma execução ou teste do pipeline. A sessão dura até 30 dias; o segredo fica fora do repositório. Um e-mail de teste permite conferir a caixa de entrada. Veja **[Conectar o Gmail e demonstrar](docs/GMAIL.md)**.

## Chat de consulta

Na aba **Passos** de um run, o chat abaixo da planilha responde perguntas sobre os dados do passo, somente leitura: o Claude monta consultas SQL e cada número da resposta vem de uma delas, conferido pelo servidor. Precisa de uma credencial da Anthropic no servidor; veja **[Conectar o chat à API](docs/CHAT_API.md)**. Sem ela, o resto da plataforma funciona normalmente.

## E-mails de pendências pelo Gmail

Em **Comunicações → Gmail · pendências**, selecione a pendência e use **Gerar e-mail**. A mensagem tem texto editável, contraparte identificada pelas fontes e anexos restritos às evidências relacionadas. **Gmail · pendências** reúne os rascunhos, o histórico, os contatos Orbe/Ponte e a conexão da conta de teste.

O botão **Aprovar e enviar** registra a versão revisada e inicia o envio real. Exige sessão Gmail autorizada no servidor, além do nome declarado do responsável. Alterações nas evidências exigem nova revisão. Tentativas simultâneas não duplicam mensagens; um resultado incerto exige conferência manual e não é repetido automaticamente.

O envio real exige conectar a conta Gmail; funciona com senha de app ou OAuth. Veja **[Configurar e demonstrar Gmail](docs/GMAIL.md)**. Rascunhos e anexos são persistidos no banco com sufixo `-email.sqlite3`; tokens ficam fora do projeto. Os testes e a revisão de navegador usam um provedor simulado.

## Pipeline versionado e checklist

Use **Pipeline** na navegação para escolher a competência, enviar os seis arquivos ou executar com as fontes locais. A lateral acompanha as etapas e a prévia lê os arquivos Parquet salvos. O construtor valida dependências e parâmetros antes de criar uma nova versão; a aprovação humana é obrigatória e não pode ser removida.

Ao chegar à aprovação, trate as exceções bloqueantes. Decisões exigem responsável e justificativa. Ajustes são registros adicionais; as saídas calculadas continuam preservadas. Somente um lote aprovado produz o pacote de partidas dobradas para o ERP. O formato CSV é uma proposta documentada para o case; a importação real no Fênix não foi homologada nem executada.

O **Checklist** combina tarefas derivadas da execução com tarefas manuais. O backend completo e os exemplos de integração estão em `docs/API_PIPELINE.md`; o contrato OpenAPI está em `/api/openapi.json`. As saídas oficiais de conferência do MVP original continuam disponíveis e são distintas do pacote ERP aprovado.

O banco de workflows usa o mesmo nome-base com sufixo `-workflow.sqlite3`. Os arquivos imutáveis de cada execução ficam em `saida/runs/<run_id>/`. Para demonstração isolada, defina tanto `--db` como `--runs-dir`. A consulta de execuções e a revisão não precisam de serviços externos.

## Resultado inicial verificado

Os valores são provisórios até o analista tratar as pendências ou aceitar as ressalvas. As 57 operações da Atlas não entram no faturamento sem contrato e identidade confirmados.

Novos processamentos consolidam `CADASTRO_NAO_CONFIRMADO` em uma pendência por CNPJ e competência, com todas as operações e evidências vinculadas. A ressalva não autoriza faturamento. Veja [escopo, riscos e critérios de aceite](docs/CADASTRO_POR_EMPRESA.md). As contagens históricas abaixo antecedem esse agrupamento e outras revisões do motor.

| Controle | Resultado |
|---|---:|
| Movimentos Orbe | 1.943 |
| Remessas importadas / operações únicas | 233 / 232 |
| Lançamentos Aurora / Meridiano | 84 / 100 |
| Comissão de checkout autorizada pelas referências | R$ 207.039,73 |
| Comissão de remessa | R$ 39.543,45 |
| Notas propostas (21) | R$ 246.588,68 |
| Divergências de taxa (237), valor assinado | R$ 14.826,55 |
| Exposição em divergências, soma dos valores absolutos | R$ 22.173,57 |
| Pendências iniciais | 304 |

O pipeline adiciona uma exceção bloqueante para a validação do mapa contábil proposto: são 305 exceções, 58 bloqueantes. Seu lote contábil inicial contém 4.360 linhas, com R$ 23.474.915,80 em débitos e o mesmo valor em créditos; esse total de movimentação não representa receita.

A comissão da Casa do Estudante é −R$ 5,50: a isenção de setembro não é tratada como retroativa à venda de agosto estornada em setembro. Não se emite NF negativa. Por isso as notas superam a soma das comissões em R$ 5,50. A interpretação está em HIPOTESES.md e na interface. Não somar pendências, divergências e comissões: são visões diferentes das mesmas operações.

## Fluxo do analista

1. Informe seu nome e confira Resumo, fontes e hipóteses.
2. Em Comissões ou Divergências, abra Ver rastro para consultar transação, valores, taxa, vigência, fórmula e linha de origem.
3. Em Pendências, confirme, rejeite ou ajuste o encaminhamento. Rejeitar mantém o item aberto. Mudança de taxa acontece no cadastro com vigência e justificativa; reclassificação bancária registra método HUMANO.
4. Cadastre contatos internos e de cobrança, com severidade e frequência. Abra Notas e cobranças, prepare e edite o rascunho, aprove e simule o envio. Alterações invalidam a aprovação.
5. Conclua o mês. Pendências abertas exigem caixa de aceite e justificativa explícitas. Baixe relatório ou pacote de saídas.

O roteiro detalhado está em DEMO.md.

## Fontes e regras

- Dados sintéticos originais copiados sem alteração para `data/case/`; hashes registrados por importação.
- Instruções oficiais em `docs/01_instrucoes_participantes.docx`.
- 16 respostas do financeiro consultadas antes do código, com links em `docs/FONTES_SLACK.md`.
- Hipóteses e conflitos em `HIPOTESES.md` e `docs/assumptions.json`.
- Controles independentes e funcionamento do motor em `docs/ENGINE_NOTES.md`; cobertura em `docs/TESTES.md`.

Checkout usa taxa contratada por produto/data, com HALF_UP por linha, estornos pela data original e reversões vinculadas à antecipação. Remessa usa 50% do spread realizado elegível por operação, exclui negativos e conta duplicata idêntica uma vez. Notas de remessa têm Ponte como única tomadora. Banco classifica contrapartidas; recebimentos de provisões não viram receita novamente.

## Arquitetura

Python + FastAPI/Uvicorn + SQLite + PyArrow/Parquet + interface React/TypeScript compilada pelo Vite. Um processo local, um worker por execução e nenhum serviço externo no workflow. As transformações mantêm Decimal e listas de registros para aproveitar o motor já verificado, sem converter dinheiro em float. A IA ajudou a construir e revisar; o workflow não chama LLM. As versões diretas estão em `requirements.txt` e o ambiente completo em `requirements.lock.txt`.

- `src/importer.py`: CSV pt-BR, XLSX com taxas numéricas/textuais, anexo XLSX do EML e OFX em cp1252. Preserva origem física e valida formatos.
- `src/engine.py`: funções determinísticas com Decimal; seis tabelas oficiais e detalhes de cálculo.
- `src/store.py`: SQLite com cadastros, taxas e histórico, importações imutáveis, cálculos versionados, decisões por evidência, avisos, e-mails e auditoria.
- `src/app.py` e `src/api/`: FastAPI limitado a 127.0.0.1, contrato REST, SSE, validação de origem e agenda local de avisos.
- `src/pipeline/`: catálogo, validação, etapas determinísticas, Parquet, versões, execuções, decisões, checklist e exportação aprovada.
- `src/config/`: pipeline padrão, checklist e mapa contábil explícito.
- `src/mail/`: autorização Google, evidências, rascunhos versionados, tentativas e envio explícito pela Gmail API.
- `../front/`: interface React integrada à API real.
- `web/`: interface anterior de verificação, preservada como referência.

Recalcular ou alterar referências reabre o mês. A decisão só permanece válida se a evidência do item não mudou. A aprovação de e-mail se vincula ao destinatário, assunto, corpo e versão do cálculo. Cada envio simulado registra conteúdo, responsável e horário; os alertas internos respeitam as preferências e dispensam aprovação.

Avisos imediatos são processados quando surgem eventos ou se ativa um contato. Resumos e prazos são processados uma vez por dia enquanto o servidor está ativo (verificação a cada minuto), além do botão Processar alertas. O horário do calendário usa America/Sao_Paulo. Sem o servidor ativo, não há agendamento em segundo plano.

## Outubro e reimportação

No Fechamento, use Rodar fechamento e escolha a competência e a pasta local, ou envie os seis arquivos. Os arquivos devem manter o mesmo padrão de nomes e estrutura do case. Referências revisadas são preservadas; novas referências entram; alterações detectadas em uma taxa existente geram aviso para revisão. Cadastre vigências sem sobreposição na interface. O formato atual exige o conjunto de fontes correspondente; arquivos ausentes ou linhas inválidas geram pendência. Um mês sem movimentos também gera bloqueio.

O fechamento original arquiva importações e apresenta o lote ativo. A nova tela Pipeline permite selecionar execuções independentes por competência e mantém suas evidências, versões e saídas. A tela Checklist acompanha a execução mais recente do mês. Para isolamento completo, use um banco por demonstração ou cliente.

## Saídas

`saida/` contém `comissoes_por_lojista.csv`, `divergencias_taxa.csv`, `notas_a_emitir.csv`, `lancamentos_classificados.csv`, `pendencias.csv` e `rastro.csv`. Delimitador `;`, decimal `.`, datas ISO e CNPJ 14 dígitos. Colunas extras documentam decisões e evidências. O pacote inclui relatório HTML imprimível; também há `verificacao.json` com totais, validação e hashes.

## Limitações conhecidas

- Cobranças, relatórios e avisos internos do fluxo antigo são simulados. A aba E-mail real envia mensagens diretas, pendências aprovadas e avisos automáticos de runs/testes após conectar a conta e ativar os avisos. Aceitação pelo provedor não confirma entrega na caixa; os testes automatizados não enviam mensagens reais.
- Ator declarado pelo operador; a sessão Google autoriza o envio de pendências, mas não verifica a identidade individual de quem compartilha a conta. Sem login corporativo para o fechamento. Servidor local, não adequado a exposição na internet ou múltiplos usuários sem autenticação.
- Notas são propostas de emissão, sem integração com NFS-e ou ERP. Não executa transferências, pagamentos ou devoluções.
- Identificações sem chave confirmada, contratos ausentes, negativos e dados inválidos permanecem em revisão. Exceções podem ser aceitas como ressalvas com autoria e motivo.
- Reversão parcial e mudança de formatos exigem regra adicional; não são inventadas pelo motor. Regras bancárias conhecidas são explícitas; novos históricos desconhecidos geram pendência.
- Não há conciliação parcelada Orbe sem agenda de recebíveis nem confirmação do TED de outubro sem extrato, conforme esclarecimento do financeiro.
- Histórico de preparação anterior a esta sessão deve ser complementado pelo time em PROMPTS; não é fabricado. A exportação desta sessão exclui raciocínio interno e instruções de sistema.
- Não houve publicação do site, push de repositório ou envio formal à organização.
