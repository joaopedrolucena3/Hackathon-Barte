# Verificação da integração Gmail

Em 17/10/2026, `./run.sh test` executou **130 testes com sucesso em 51,814 segundos**: 90 regressões existentes e 40 testes novos (17 de OAuth/provedor, 16 do serviço de mensagens e 7 da API). O registro completo está em [resultado-testes-email.txt](resultado-testes-email.txt).

Todos os testes de e-mail usam provedor simulado e bancos temporários. Nenhuma mensagem real foi enviada, nenhum consentimento Google real foi concluído e nenhuma credencial foi criada.

## Cobertura automatizada

| Área | Verificação |
|---|---|
| Contraparte e contatos | Checkout → Orbe; remessas → Ponte; ausência, duplicidade e origens misturadas bloqueiam; origem indefinida exige revisão justificada. Contatos de outros fluxos preservados. |
| Conteúdo e evidências | Modelos determinísticos; linhas relacionadas, operações originais e referências contratuais; HTML/CSV sem pacote integral. Edição de texto, múltiplas evidências, CSV seguro e anexos exatos no MIME enviado. |
| Desatualização | Mudança relevante na fonte, regra ou conta bloqueia; alteração sem relação com a pendência não invalida o rascunho. Atualização depende de ação explícita. |
| Sessão | Nome declarado não autoriza envio. Validação de conta Google, CSRF, origem, estado OAuth, vínculo com navegador, expiração, escopos mínimos, desconexão e renovação de token. Segredos não aparecem nas respostas. |
| Integridade | Aprovação exige versão e hash; remetente e todos os campos ficam preservados. Adulteração de anexos ou conteúdo bloqueia antes do provedor. |
| Concorrência | Duas chamadas da mesma versão produzem uma tentativa. Mutações financeiras aguardam o despacho. Revalidação após auditoria bloqueia alteração antes do envio. |
| Falhas | Rejeição conhecida permite nova versão e revisão; timeout, resposta inconclusiva e interrupção ficam incertos, sem repetição automática. Reinício conserva esse bloqueio. |
| Regressão | Avisos e cobranças continuam simulados. Rotas desses fluxos verificadas por HTTP. Envio não resolve pendência, não altera cálculos nem aprova fechamento. |

Verificações complementares: análise independente da autorização e concorrência; duas aprovações de rascunhos distintos concluíram em paralelo sem deadlock em banco temporário. A sintaxe de `web/app.js`, `web/workflow.js` e `web/mail.js` passou na verificação do Node.

## Roteiro executado no navegador

Servidor de teste isolado na porta 8766, iniciado explicitamente por `.venv/bin/python tests/serve_mail_demo.py`. Esse servidor injeta um provedor fictício; não há chave de configuração que transforme o servidor normal em provedor de teste.

1. Conectar a conta fictícia, com aviso visível de que não há envio ao Gmail real.
2. Cadastrar contato Orbe fictício no banco temporário.
3. Abrir a pendência da operação `TX88410932` e clicar **Gerar e-mail**.
4. Conferir contraparte, remetente, assunto, texto e dois anexos; abrir e inspecionar visualmente o relatório e baixar o CSV de 388 bytes.
5. Editar assunto/corpo, salvar, recarregar a página e reabrir; conteúdo e versão preservados.
6. Clicar uma vez **Aprovar e enviar**; confirmar o retorno `fake-gmail-1`, conteúdo preservado, histórico e bloqueio de reenvio.
7. Confirmar que a pendência permanece aberta e a quantidade de pendências permanece 304.
8. Desconectar; confirmar remoção da autorização e preservação do registro.
9. No servidor principal, conferir o estado sem credenciais, o bloqueio de conexão e o guia de configuração.

![Registro de envio no provedor simulado](gmail-envio-simulado.jpg)

## Preservação do banco principal

A comparação antes/depois, após reiniciar o servidor atualizado, coincidiu em todos os 12 itens: tabelas `imports`, `merchants`, `rates`, `contacts`, `decisions`, `emails`, `runs` e valores originais de `result`, `source_data`, `closing`, `parameters`, `period`. Foram comparados os hashes SHA-256 das mesmas linhas ordenadas e dos valores JSON armazenados, sem recalcular ou sobrescrever dados. Evidência: [preservacao-email.json](preservacao-email.json).

Permaneceram R$ 207.039,73 de checkout, R$ 39.543,45 de remessas, 21 notas somando R$ 246.588,68, 237 divergências e 304 pendências. Nenhum contato ou rascunho de teste foi incluído no banco principal.

O lote do pipeline `run-b9db179689a645d6b8cafb39b5eafbd3` permanece `awaiting_approval`, com 305 exceções, sem decisão humana ou aprovação. O código da nova versão difere do snapshot antigo, portanto o bloqueio já existente `CODE_CHANGED` exige nova execução para futura aprovação. O responsável deve arquivar/reprovar o lote anterior para liberar a competência; isso não foi feito automaticamente. Os detalhes estão no [guia Gmail](GMAIL.md#execuções-do-pipeline-anteriores-à-atualização).

## Configuração ainda necessária e limites

O servidor principal informa exatamente `TARVO_GOOGLE_CLIENT_FILE` e `TARVO_GMAIL_TEST_ACCOUNT` ausentes. São necessários o arquivo OAuth Web fora do projeto, a conta de teste autorizada no Google Cloud e o URI de retorno cadastrado. Depois, conectar pela interface, cadastrar destinatários controlados e realizar a demonstração entre contas de teste conforme [GMAIL.md](GMAIL.md).

A troca real de tokens, o consentimento Google, a aceitação pela Gmail API e o recebimento no destinatário **não foram validados**. Os testes HTTP usam respostas simuladas, e o navegador usa autorização fictícia explícita. A aceitação pelo Gmail, quando ocorrer, não confirma entrega ou leitura. O servidor permanece local, com um processo; autenticação corporativa, múltiplos processos, leitura de respostas e emissão fiscal continuam fora do escopo.
