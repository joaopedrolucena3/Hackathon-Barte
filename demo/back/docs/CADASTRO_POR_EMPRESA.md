# Pendência de cadastro por empresa

## Problema e comportamento esperado

O cadastro candidato ou inativo é um problema da empresa, mas o fechamento gerava uma exceção `CADASTRO_NAO_CONFIRMADO` para cada operação. O analista precisava repetir a mesma decisão e justificativa dezenas de vezes. No caso original de setembro, as 57 operações da Atlas representam uma única causa cadastral.

A funcionalidade reúne essas operações em uma pendência por **tipo de problema, CNPJ exato e competência**, dentro de cada execução. O analista vê a empresa, o CNPJ, a competência, a quantidade de operações, o valor relacionado e as evidências. Uma decisão registra o encaminhamento de todo o conjunto apresentado, com responsável, horário e justificativa.

O total é exposição informada nas fontes, não receita autorizada, valor de cobrança ou valor bruto das operações. A tela permite consultar cada operação e todas as linhas de origem. A quantidade de pendências passa a contar problemas; a quantidade de operações afetadas permanece explícita.

## Escopo e decisões

- Somente `CADASTRO_NAO_CONFIRMADO` é consolidado. Cadastro ausente, ambíguo, CNPJ inválido, contrato ausente, taxa divergente e outros motivos mantêm tratamento próprio.
- A correspondência usa as chaves exatas já verificadas pelo motor. Nomes semelhantes não juntam empresas. Uma identidade candidata continua candidata: agrupar suas evidências não confirma sua identidade.
- Operações de checkout e remessa podem pertencer à mesma pendência cadastral, com a origem e a natureza do valor identificadas no detalhe.
- **Aceitar como ressalva** registra ciência e encaminhamento. **Excluir o grupo do lote** preserva a exclusão das operações e o relatório da pendência. Nenhuma das ações confirma cadastro, inventa contrato, calcula receita ou libera faturamento.
- O cadastro não é corrigido por ajuste monetário da pendência. Para regularizar, Comercial confirma identidade, situação e contrato/taxa aplicável, e o analista inicia novo processamento. Outras pendências continuam exigindo sua própria decisão.
- A decisão registra os membros exatos e a impressão digital das evidências. Ela não é uma autorização permanente para a empresa ou para operações futuras.

## Problemas previstos e tratamento

| Situação | Tratamento |
| --- | --- |
| Mesmo nome, CNPJs diferentes | Grupos separados. |
| Cadastro ausente ou identidade ambígua | Não presumir empresa para consolidar; manter exceção específica. |
| Nova operação, valor alterado, evidência ou cadastro alterado | Invalidar a decisão no fechamento recalculado; exigir nova revisão. |
| Apenas mudança da ordem das linhas em memória | Ordenação determinística mantém grupo e evidências equivalentes. Mudanças reais nos arquivos e suas proveniências continuam relevantes. |
| Operação idêntica recebida mais de uma vez | Contar a operação econômica uma vez, preservar proveniências; duplicidade mantém sua pendência própria. |
| Mesmo identificador em arquivos distintos, inclusive arquivos com o mesmo nome | Vincular usando arquivo, referência, linha e identificadores disponíveis de conteúdo/recebimento, evitando que a decisão alcance lançamentos de outra fonte. |
| Valor de alguma operação ausente ou inválido | Mostrar total indisponível, subtotal conhecido e quantidade sem valor; não converter desconhecido em zero. |
| Valores positivos e negativos | Preservar sinais e rastrear cada contribuição; o total não prova comissão devida. O módulo do total do grupo pode diferir da antiga soma dos módulos por operação: os indicadores de exposição não são receita nem uma medida de perda máxima. |
| Regularização de cadastro sem contrato vigente | Continuar impedindo cálculo/faturamento pela validação contratual. |
| Decisão sobre o grupo com outros bloqueios abertos | Registrar apenas a decisão desse problema; os demais bloqueios permanecem. |
| Execução anterior já revisada ou aprovada | Conservar dados, decisões e arquivos históricos. O agrupamento vale para novos processamentos. |
| Evidências de Orbe e Ponte no mesmo grupo | Consulta local consolidada permitida; o envio de e-mail não pode compartilhar um pacote misto de contrapartes. A proteção existente continua ativa. |

## Critérios de aceite

1. Um CNPJ com várias operações elegíveis no mês produz uma única exceção cadastral, com todas as operações acessíveis.
2. CNPJs, competências e motivos distintos permanecem separados; a identificação do grupo independe da ordem de entrada.
3. Evidências, rastros e exportações preservam as operações e a informação de valores desconhecidos. O rastro conhecido fecha com o subtotal conhecido.
4. Uma decisão válida alcança o grupo apresentado e fica auditada; justificativa e responsável são obrigatórios.
5. Aceitar ou excluir a pendência não altera comissões, notas ou partidas válidas de outras operações.
6. Novo processamento reavalia cadastro e contrato. Nova execução não herda automaticamente a aprovação anterior.
7. Execuções históricas e arquivos de origem não são migrados nem reescritos.

## Compatibilidade e disponibilidade

Os metadados do grupo são adicionais ao contrato existente: `group_scope`, `period`, `cnpj`, `merchant_name`, `operation_count`, `affected_operations`, `exposure_status`, `known_exposure_brl` e `missing_exposure_count`. O total monetário pode ser nulo quando incompleto. Os consumidores exibem indisponibilidade explicitamente.

Os seis CSVs oficiais de conferência mantêm seus cabeçalhos públicos. O pacote conserva os detalhes dos grupos em `manifesto.json`, no campo `registration_groups`, e os rastros mantêm todas as contribuições por ID de pendência. O relatório de exceções do pacote ERP e a auditoria incluem diretamente operações, evidências, impressão digital e decisão. Valores monetários desconhecidos ficam vazios nos CSVs, acompanhados da informação explícita no manifesto.

O fluxo de aprovação continua sendo uma decisão sobre uma exceção bloqueante. O recurso não habilita aceitação genérica em lote de outros bloqueios. Decisões antigas por operação permanecem no histórico e não são convertidas silenciosamente em decisões sobre a empresa.

Após atualizar o código, o servidor precisa carregar a nova versão. Para visualizar o agrupamento, crie uma nova execução ou recalcule a conferência desejada; abrir uma execução histórica preserva sua apresentação original.

## Caso conferido

Com as fontes originais de setembro, Atlas Idiomas Ltda (CNPJ 39566044000119) passa a ter uma pendência com **57 operações, 57 referências de origem e 57 contribuições no rastro**, totalizando **R$ 7.876,05 de exposição reportada**. Esse valor continua sem autorização de faturamento.

Os totais financeiros conferidos permanecem: checkout **R$ 207.039,73**, remessa **R$ 39.543,45** e notas propostas **R$ 246.588,68**. A redução da quantidade de pendências cadastrais não elimina operações nem aumenta receita.

## Validação da implementação

Em 17/10/2026, passaram os **259 testes do backend**, executados em quatro conjuntos sobre uma cópia estável cujas fontes foram comparadas com a versão local, e os **111 testes da interface**. A compilação da interface e a conferência no navegador também passaram. A prévia de demonstração usa banco separado e permanece sem decisões registradas. Os registros da validação estão em `evidence/cadastro-empresa-20261017/`, na raiz do projeto.
