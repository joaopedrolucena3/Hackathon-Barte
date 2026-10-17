# Verificação da interface

Verificação manual realizada no navegador Chrome em 17/10/2026, com a aplicação local. As ações que gravam decisões foram realizadas no banco separado `data/qa.sqlite3`; o banco principal permanece com os dados importados, sem decisões humanas, contatos ou e-mails de demonstração.

- Painel carregou os totais e as 304 pendências esperadas; rastro e exportações disponíveis.
- Revisão de divergência registrou encaminhamento, responsável informado no diálogo e justificativa; o nome também foi atualizado no cabeçalho.
- Concluir o mês com pendências exigiu aceite explícito e justificativa; o navegador impediu prosseguir sem o aceite.
- Cobrança: rascunho editável e envio bloqueado antes da aprovação; aprovação e envio simulado registraram conteúdo, responsável e horário.
- Layout conferido em desktop e na largura de 390 pixels; navegação e conteúdo permaneceram utilizáveis.
- Após reiniciar com o banco principal, painel, relatório e download do pacote responderam normalmente. O painel final está em `painel.jpg`.

Os testes automatizados das regras e dos controles estão descritos em TESTES.md. Não houve envio real de e-mail nem emissão fiscal.


## Pipeline versionado — 17/10/2026

Verificação adicional em navegador real, com banco de QA isolado: execução automática e SSE, pausa antes do ERP, exceções, exclusão de operação Atlas, checklist manual, criação de versão, validação de dependências, prévia com filtro e diferenças, e reprovação sem exportação. Layout também inspecionado a 390 × 844, com navegação inferior e etapas adaptadas.

A versão principal foi reiniciada com FastAPI. O lote de setembro foi preparado automaticamente e deixado aguardando revisão, sem decisões humanas ou aprovação contábil concedidas. O nome usado para essa ação foi “Preparação automática do MVP”. As aprovações usadas nos testes automatizados ocorreram somente em bancos temporários.
