# Interface Gmail para pendências

## Áreas e geração explícita

A navegação **Gmail · pendências** prepara mensagens externas com as evidências de uma ocorrência. **Envios simulados** preserva os fluxos anteriores de cobrança, relatórios e avisos internos; eles não foram conectados ao Gmail real.

Na fila ou na revisão de uma pendência, **Gerar e-mail** solicita a geração ao servidor. A interface não cria rascunhos em segundo plano. **Histórico de e-mails** consulta os registros associados à ocorrência.

## Conta e destinatários

O cartão da conta mostra o endereço conectado e distingue conexão de autorização da sessão. O nome declarado do responsável não é autenticação. Ações de aprovação utilizam a sessão validada no servidor e o token CSRF mantido apenas em memória no navegador. Credenciais e tokens OAuth não são exibidos nem armazenados pela interface.

**Conectar conta Google** inicia a autorização pelo servidor. A configuração que faltar é apresentada por nome, sem campos para colar segredos. Configure o projeto Google e a conta de teste conforme `docs/GMAIL.md` ou o guia acessível em `/api/mail/setup`. A funcionalidade solicita envio; não lê a caixa de entrada.

**Desconectar** remove a conexão local. Se o servidor não confirmar a revogação no Google, a tela mantém um aviso para conferir e remover as permissões diretamente na conta Google. A remoção local não é apresentada como confirmação de revogação remota.

Em **Destinatários Orbe e Ponte**, cadastre as caixas de teste que representam cada contraparte. Nenhum contato é extraído de documentos. Os contatos deste fluxo são separados dos utilizados nas simulações anteriores.

## Revisão e envio

1. Gere o rascunho a partir de uma pendência.
2. Confira a descrição da origem, a conta remetente, o destinatário sugerido, o assunto e o corpo.
3. Abra ou baixe cada anexo apresentado. Eles pertencem à versão em revisão.
4. **Salvar rascunho** preserva a edição sem enviar. Quando a contraparte for ambígua, confirme o vínculo com justificativa; o servidor continua validando a origem.
5. **Atualizar texto e evidências** é uma ação explícita: regenera modelo e anexos e abre uma nova versão para revisão. Não envia a mensagem.
6. **Aprovar e enviar** salva o conteúdo revisado e envia a versão e o hash retornados pelo servidor. Se remetente, evidências, anexos ou conteúdo retornado divergirem do que estava em revisão, a interface interrompe o envio e exige nova conferência.

O clique é bloqueado localmente enquanto a operação está em andamento; a prevenção de duplicidades e a validação de versão também pertencem ao servidor. A autorização de envio não resolve a pendência nem altera cálculos ou o fechamento.

## Estados e recuperação

- **Rascunho:** editável, sem envio iniciado.
- **Envio em andamento:** somente consultas de status; nenhuma repetição automática da tentativa.
- **Aceito pelo Gmail:** o provedor aceitou a mensagem. Não significa entrega ou leitura.
- **Falha conhecida:** a revisão pode ser salva como nova versão antes de uma aprovação deliberada; não há tentativa automática.
- **Resultado incerto:** registro somente para consulta. Confira manualmente o Gmail antes de qualquer nova comunicação.

Quando o servidor usa o provedor injetado de teste, a tela identifica o ambiente simulado e não afirma que houve envio real. Interrupções após iniciar a tentativa provocam consulta de status; a interface nunca repete automaticamente a aprovação ou o envio.

## Arquivos e fronteira de validação

`web/mail.js` e `web/mail.css` implementam a área Gmail com pequenas integrações em `app.js` e `index.html`. A camada usa cookies da mesma origem, cabeçalho CSRF quando disponível e `X-User` codificado em UTF-8 para o nome declarado. Os testes locais usam respostas simuladas; uma validação real depende de credenciais OAuth, conta de teste autorizada e envio deliberado entre destinatários de teste.
