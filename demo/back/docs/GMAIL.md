# E-mail real na demonstração Tarvo

A área de e-mail permite conectar uma conta Gmail, enviar uma mensagem simples para Orbe ou Ponte e receber avisos das runs. A tela começa com `financeirotarvo@gmail.com` como remetente e destinatário da demonstração. Isso é apenas um preenchimento inicial: a conexão só existe depois que o Google aceita a credencial, e o envio só ocorre para o destinatário mostrado na tela.

O fluxo de pendências com evidências continua disponível. Enviar uma mensagem não resolve uma pendência, não altera valores e não aprova o fechamento. As simulações antigas de cobrança e relatórios continuam separadas desses envios reais.

## Sugestões justificadas por execução

Ao chegar à revisão ou concluir um teste, a execução prepara sugestões de contestação agrupadas por parceiro, competência e motivo. Nenhuma contestação é enviada por esse evento. Em **Comunicações > E-mail**, selecione a execução para ver o motivo da sugestão, as operações envolvidas, as limitações e os anexos. Execuções anteriores podem ter suas sugestões preparadas pelo botão da tela, sem novo cálculo financeiro.

As evidências pertencem aos arquivos preservados naquela execução. Pendências internas sem base suficiente para uma solicitação ao parceiro ficam fora dos lotes, com a razão apresentada na tela. O corpo resume o pedido e até cinco ocorrências; os anexos preservam o detalhamento completo. Valores de operações não são tratados como valores automaticamente recuperáveis. Sem um contato único cadastrado para o parceiro, o preenchimento inicial da demo usa `financeirotarvo@gmail.com` e informa essa escolha; contatos ambíguos bloqueiam a aprovação.

Revise o destinatário, o assunto e a mensagem e salve a versão. Confira então o remetente e os anexos da versão salva, marque a autorização e confirme o envio. **A permissão vale apenas para aquela versão e aquele destinatário.** Alterar a mensagem exige nova revisão. É possível descartar uma sugestão sem enviar nada. Resolver ou excluir uma pendência depois da preparação bloqueia uma sugestão que ficou desatualizada.

Ocorrências com as mesmas evidências, remetente e destinatário não são reenviadas pelo fluxo de sugestões em outra execução. Ao salvar o remetente e destinatário, a nova versão separa evidências já enviadas das novas ou alteradas para revisão. Uma falha conhecida exige nova versão e nova permissão; um envio incerto não é repetido automaticamente. Os avisos internos de execução continuam sujeitos à configuração própria e não autorizam contestações.

## Conexão simples com senha de app

1. Entre na conta Gmail usada na demonstração e ative a verificação em duas etapas.
2. Abra [Senhas de app do Google](https://myaccount.google.com/apppasswords), crie uma senha para “Tarvo demo” e copie os 16 caracteres gerados.
3. Na Tarvo, em **Conectar o e-mail**, informe o endereço completo e essa senha de app; clique **Conectar Gmail**. Não use a senha normal da conta.
4. O servidor verifica a conexão com o Gmail antes de salvar a credencial. O endereço conectado aparece na tela. Conectar não envia mensagem.
5. A sessão do navegador dura até 30 dias e sobrevive a reinicializações do servidor. Outro navegador precisa conectar sua própria sessão.

Este caminho não exige projeto Google Cloud nem credencial OAuth. A senha de app exige verificação em duas etapas e pode não estar disponível para contas de organização, Proteção Avançada ou configuração apenas com chaves de segurança. O Google revoga senhas de app quando a senha principal da conta muda. Se a opção não estiver disponível, use a conexão OAuth abaixo. O Google recomenda OAuth quando disponível. [Orientações oficiais sobre senhas de app](https://support.google.com/mail/answer/185833?hl=pt-BR).

O transporte é fixo: `smtp.gmail.com`, porta 465, com TLS e verificação do certificado. Não há servidor SMTP arbitrário configurável. A Tarvo apenas envia mensagens; a senha de app não possui o escopo restrito de envio do OAuth. [Configuração SMTP documentada pelo Google](https://knowledge.workspace.google.com/admin/gmail/send-email-from-a-printer-scanner-or-app).

## Enviar para Orbe ou Ponte

Em **Enviar para Orbe ou Ponte**, escolha a empresa, confira o destinatário, ajuste assunto e mensagem, informe seu nome e clique **Enviar e-mail real**. A empresa escolhida muda o modelo de texto; quem recebe é o endereço exibido no campo destinatário. O preenchimento inicial usa a própria caixa da demo e não pretende ser um contato oficial da Orbe ou Ponte.

O histórico registra a conta conectada, o destinatário, o conteúdo e o resultado. Repetir a mesma solicitação com o mesmo identificador não dispara outra mensagem. Uma tentativa aceita ou incerta deve ser conferida no histórico e na caixa de e-mail antes de preparar uma nova mensagem.

## Avisos de runs e teste da conexão

Em **Receber avisos de runs e testes**, confira o destinatário, marque **Enviar avisos automáticos por e-mail** e clique **Salvar avisos**. O servidor usa a conta conectada para os avisos configurados, inclusive quando a aba está fechada ou a sessão do navegador expira. Desconectar a conta interrompe essa autorização. Trocar a conta exige confirmar a configuração de avisos para a nova conexão.

O botão **Enviar e-mail de teste** envia uma mensagem real ao destinatário salvo. Confira a caixa de entrada e o spam. O histórico de avisos mostra falhas e resultados incertos; uma falha de e-mail não altera o resultado financeiro da run e não provoca repetição automática do envio.

As runs geram avisos ao ficar **aguardando revisão**, ao **concluir** e ao **falhar**. Uma run de teste do pipeline é identificada como teste, sem exportação contábil. Cada combinação de run e evento gera no máximo uma tentativa de aviso; ativar os avisos não envia mensagens retroativas de runs antigas.

Os testes automatizados de desenvolvimento (`./run.sh test`) usam transportes injetados e não precisam de credenciais reais. Os avisos de testes do pipeline e o teste real da interface são ações distintas dessa suíte de desenvolvimento. O botão de teste funciona mesmo com os avisos automáticos desativados, usando o destinatário salvo.

## Credenciais e desconexão

As credenciais ficam fora de todo o repositório, em diretório privado do servidor. Por padrão, ficam em `~/.local/share/tarvo/gmail/`, separadas por banco. `TARVO_MAIL_PRIVATE_DIR` permite escolher outro diretório fora do projeto. Em sistemas POSIX, o diretório tem modo `0700` e o arquivo `0600`. Em Windows, a privacidade depende das permissões do perfil do usuário. A senha de app fica armazenada localmente nesse arquivo; não é criptografada por um cofre do sistema.

A API não devolve a senha de app nem os tokens Google. O navegador recebe dados públicos da conexão, um cookie HttpOnly e a confirmação de segurança da sessão. A senha digitada é apagada do formulário após a tentativa. Não inclua o diretório privado no pacote da demo nem o sirva pela web.

**Desconectar** remove a credencial e invalida as sessões locais. Com senha de app, remova também a senha em [Senhas de app do Google](https://myaccount.google.com/apppasswords) para revogá-la no Google. Com OAuth, a Tarvo tenta revogar o acesso remotamente e informa quando não pode confirmar a revogação. O nome do responsável é declarado; ele não comprova identidade individual quando a conta é compartilhada.

## Alternativa: conexão OAuth Google

1. Crie ou selecione um projeto no Google Cloud e habilite a **Gmail API**.
2. Configure o consentimento OAuth. Para a demo, mantenha o aplicativo em teste e adicione sua conta Gmail como usuário de teste.
3. Crie uma credencial do tipo **Aplicativo da Web**, com este URI de redirecionamento: `http://127.0.0.1:8765/api/mail/oauth/callback`.
4. Baixe o JSON e guarde fora da pasta do projeto. Configure as variáveis abaixo antes de iniciar o servidor.

```sh
export TARVO_GOOGLE_CLIENT_FILE='/caminho/privado/google-client.json'
export TARVO_GMAIL_TEST_ACCOUNT='financeirotarvo@gmail.com'
export TARVO_GOOGLE_REDIRECT_URI='http://127.0.0.1:8765/api/mail/oauth/callback'
./run.sh
```

Em **Conexão Google avançada**, use **Conectar com Google** e conclua o consentimento. A conta deve coincidir com `TARVO_GMAIL_TEST_ACCOUNT`. O endereço corporativo do case, `financeiro@tarvo.com.br`, permanece bloqueado como remetente. Abra sempre a mesma origem local. Se mudar a porta, ajuste o URI no Google e na variável, e reinicie.

O OAuth solicita somente `https://www.googleapis.com/auth/gmail.send`, `openid` e `email`: envio e identidade, sem leitura de mensagens. Os tokens são renovados antes do envio e a identidade é verificada novamente. Referências: [escopos do Gmail](https://developers.google.com/workspace/gmail/api/auth/scopes), [OAuth para aplicações de servidor](https://developers.google.com/identity/protocols/oauth2/web-server) e [envio pela Gmail API](https://developers.google.com/workspace/gmail/api/guides/sending).

## Pendências com evidências

Cadastre os contatos de teste de Orbe e Ponte na área de pendências. Os destinatários não são extraídos dos arquivos do case. A origem estruturada identifica Orbe nas operações de checkout e Ponte nas remessas. Ausência de contato, contato ambíguo ou origem indefinida bloqueia o envio. Evidências das duas contrapartes não podem ser enviadas como um único e-mail.

Na pendência, clique **Gerar e-mail** e confira competência, contraparte, remetente, destinatário, assunto, corpo e anexos. Salve os campos alterados e revise a versão salva antes de marcar sua permissão e enviar. O envio permanece vinculado ao conteúdo e às evidências revisados; mudanças na fonte exigem atualização explícita e nova revisão.

## Como interpretar o resultado

- **Aceito pelo servidor de e-mail:** o SMTP do Gmail confirmou código 250 após receber a mensagem. Isso não confirma entrega nem leitura. O identificador MIME exibido é da mensagem preparada pela Tarvo, não um ID retornado pela Gmail API.
- **Aceito pelo Gmail via API:** a Gmail API retornou um ID da mensagem; entrega e leitura também não foram confirmadas.
- **Falha conhecida:** houve rejeição explícita ou a conexão falhou antes de transmitir a mensagem. Nenhuma aceitação foi confirmada.
- **Resultado incerto:** houve interrupção durante o envio sem resposta conclusiva. Não há repetição automática. Confira o histórico e a pasta Enviados antes de qualquer nova tentativa.

No SMTP, se um destinatário for recusado, a Tarvo não transmite a mensagem a nenhum dos destinatários daquela tentativa. A aplicação não lê a caixa de entrada nem pesquisa mensagens enviadas.

## Verificação local

Execute `./run.sh test` para a suíte local. Os testes de autenticação, envio e notificações usam provedores simulados, sem mensagens reais. Para validar a entrega externa, conecte a conta e use **Enviar e-mail de teste**; somente a verificação da caixa confirma o recebimento.

A aplicação permanece local. Uma run anterior conserva a versão do código com que foi iniciada; alterações no código podem exigir iniciar uma nova run antes da aprovação. A integração de e-mail não toma decisões financeiras nem arquiva runs antigas automaticamente.
