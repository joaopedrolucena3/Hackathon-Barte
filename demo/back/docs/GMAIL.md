# E-mails de pendências pelo Gmail

A integração prepara um e-mail por pendência, com relatório de evidências e CSV das linhas relacionadas. A geração só acontece ao clicar em **Gerar e-mail**. Os rascunhos ficam na Tarvo; o Gmail só recebe a mensagem quando uma sessão autorizada usa **Aprovar e enviar**.

Avisos internos, cobranças e relatórios antigos continuam em simulação. Enviar um e-mail não resolve a pendência nem altera valores ou aprova o fechamento.

## Configuração da conta de teste

1. Crie ou selecione um projeto no Google Cloud e habilite a **Gmail API**.
2. Configure a tela de consentimento OAuth. Para a demonstração, mantenha o aplicativo em teste e adicione a conta Gmail de teste como usuário autorizado.
3. Crie uma credencial OAuth do tipo **Aplicativo da Web**. Cadastre exatamente este URI de redirecionamento: `http://127.0.0.1:8765/api/mail/oauth/callback`.
4. Baixe o JSON dessa credencial e guarde fora da pasta do projeto. Não cole seu conteúdo na interface, em mensagens, em logs ou no repositório.
5. Antes de iniciar o servidor, configure as variáveis abaixo. Substitua o caminho e o endereço pelos seus valores reais de demonstração; os textos abaixo são somente exemplos.

```sh
export TARVO_GOOGLE_CLIENT_FILE='/caminho/privado/google-client.json'
export TARVO_GMAIL_TEST_ACCOUNT='sua-conta-de-teste@gmail.com'
export TARVO_GOOGLE_REDIRECT_URI='http://127.0.0.1:8765/api/mail/oauth/callback'
./run.sh
```

O arquivo JSON precisa conter a credencial Web do Google. A conta autorizada deve coincidir com `TARVO_GMAIL_TEST_ACCOUNT`. O endereço corporativo `financeiro@tarvo.com.br` não é aceito como remetente da demonstração. Não é necessário copiar tokens manualmente.

Abra sempre a mesma origem, `http://127.0.0.1:8765`, para que o cookie de autorização retorne ao navegador que iniciou a conexão. Se mudar a porta, configure tanto o URI no Google quanto `TARVO_GOOGLE_REDIRECT_URI` e reinicie. Um URI diferente gera erro de redirecionamento.

Em **Gmail · pendências**, clique **Conectar conta Google** e conclua o consentimento com a conta de teste. O endereço autorizado aparecerá na plataforma. A sessão vale por oito horas; outro navegador precisa autorizar sua própria sessão. O nome do analista é registrado separadamente e não comprova identidade individual quando a equipe compartilha a conta.

## Permissões solicitadas

A aplicação pede `https://www.googleapis.com/auth/gmail.send` para envio. Os escopos `openid` e `email` identificam a conta autorizada; não dão leitura de mensagens. Não solicita `gmail.readonly`, `gmail.modify`, `gmail.compose` nem acesso completo à caixa. O uso de escopo de envio está descrito na [documentação oficial de escopos do Gmail](https://developers.google.com/workspace/gmail/api/auth/scopes).

Tokens ficam no servidor, em diretório privado fora do projeto, com acesso restrito ao usuário do sistema. A localização padrão fica em `~/.local/share/tarvo/gmail/`, separada por banco. `TARVO_MAIL_PRIVATE_DIR` permite escolher outro diretório privado fora do projeto. Não inclua esse diretório em pacotes de entrega nem o exponha por um servidor web. A API e o navegador recebem somente dados públicos da conexão e um cookie de sessão HttpOnly.

**Desconectar** invalida as sessões locais e tenta revogar o acesso no Google. Se a revogação remota não puder ser confirmada, a interface informa isso; a conexão local continua removida. Nesse caso, também é possível remover o acesso nas configurações da conta Google.

## Destinatários e revisão

Cadastre, na área Gmail, os endereços de teste que representarão Orbe e Ponte. Nenhum endereço é extraído dos arquivos do case. A aplicação usa os cadastros de contatos existentes, com uma finalidade específica de contraparte, e mantém os contatos de avisos e cobranças separados.

A origem estruturada identifica Orbe nas operações de checkout e Ponte nas remessas. Ausência de contato, contato ambíguo ou origem indefinida bloqueia o envio. Uma origem indefinida exige revisão explícita; evidências misturadas entre as duas contrapartes não podem ser enviadas como um único e-mail.

Na pendência, clique **Gerar e-mail** e confira:

- Pendência, competência, contraparte e conta remetente.
- Destinatário, assunto e corpo editáveis.
- Relatório de evidências e CSV, disponíveis para visualização e download.
- Informações faltantes ou evidências desatualizadas.

Salve para continuar depois ou use **Aprovar e enviar**. Esse botão registra a aprovação e inicia o envio real em uma única ação. Se você alterou o texto na tela, os campos são salvos como nova versão antes da aprovação, mantendo exatamente o conteúdo revisado.

A aprovação vincula remetente, destinatário, assunto, corpo, anexos e evidências. Mudanças na fonte exigem atualização explícita do rascunho e nova revisão; nada é regenerado silenciosamente durante o envio. Os anexos aprovados e a mensagem enviada permanecem no histórico.

## Resultado do envio

- **Rascunho:** editável, ainda sem envio iniciado.
- **Enviando:** aprovação registrada e tentativa em andamento. Repetir o clique não cria outra tentativa.
- **Aceito pelo Gmail:** o Gmail retornou um identificador. Isso não confirma entrega nem leitura.
- **Falha conhecida:** a tentativa não foi aceita; revise o problema e salve uma nova versão antes de aprovar novamente.
- **Resultado incerto:** houve interrupção, timeout ou resposta inconclusiva depois de iniciar a tentativa. Não há repetição automática. Confira manualmente a pasta Enviados no Gmail antes de qualquer providência fora da plataforma.

Uma mensagem com resultado incerto ou já aceita não pode ser reenviada pela mesma pendência nesta versão. O histórico conserva horários, conteúdo, anexos, responsável declarado, conta autorizada e tentativas. A implementação não lê a caixa para verificar respostas ou pesquisar mensagens enviadas.

## Roteiro da demonstração real

1. Configure o projeto e a conta de teste; conecte a conta Google pela interface.
2. Cadastre dois destinatários de teste controlados pelo time, representando Orbe e Ponte.
3. Escolha uma divergência de checkout e clique **Gerar e-mail**. Abra os anexos e confirme que contêm somente as evidências relacionadas.
4. Edite uma frase, salve e reabra o rascunho. Confira conta, destinatário e conteúdo.
5. Clique **Aprovar e enviar**. Confira o estado **Aceito pelo Gmail** e o identificador retornado. Verifique a mensagem manualmente nas contas de teste.
6. Confira que a pendência permanece aberta e que as comissões não mudaram. Repita com uma pendência de remessa para demonstrar a contraparte Ponte.
7. Desconecte a conta e mostre que a aprovação fica indisponível.

## Verificação local e limites

Execute `./run.sh test`. Os testes usam provedores simulados; não usam credenciais nem enviam mensagens reais. A revisão em navegador também deve usar banco e provedor isolados. O resultado detalhado da entrega fica em `docs/TESTES_EMAIL.md`.

O fluxo OAuth segue a [documentação oficial para aplicações de servidor](https://developers.google.com/identity/protocols/oauth2/web-server), e o envio usa mensagem MIME codificada em base64url com `users.messages.send`, conforme o [guia de envio do Gmail](https://developers.google.com/workspace/gmail/api/guides/sending).

Esta aplicação continua sendo local. Não é uma solução de autenticação corporativa para todo o fechamento. Não publica o serviço na internet, não conecta o endereço corporativo e não recebe ou acompanha respostas. A aceitação real pelo Gmail só pode ser validada depois da configuração e autorização da conta de teste.

## Execuções do pipeline anteriores à atualização

O pipeline preserva a cópia do código usado em cada execução. Como esta atualização acrescenta código, uma execução iniciada na versão anterior continua disponível para consulta, mas sua aprovação retorna `CODE_CHANGED`. No banco principal, o lote de setembro permanece em revisão, sem decisões humanas ou aprovação concedida por esta implementação. Para processar com a versão atual, o responsável deve reprovar/arquivar o lote antigo pela interface e iniciar uma nova execução. A integração de e-mail usa as pendências existentes do fechamento e não toma essa decisão automaticamente.
