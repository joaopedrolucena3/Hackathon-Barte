# Verificação da integração front/back

Verificação local em 17/10/2026, na branch `integration/front-back`. A base `backend` (`e863a32`) já contém o histórico de `frontend` (`45a27de`); a integração adapta os contratos e expõe as funcionalidades existentes na interface React. A publicação remota e a alteração de `main` não fazem parte desta verificação.

## Resultado

- A interface usa HTTP por padrão; o mock exige seleção explícita.
- O servidor entrega o front compilado, incluindo navegação direta nas rotas. `demo/back/run.sh` instala dependências ausentes e prepara a compilação.
- Catálogo, versões, validação, upload dos seis arquivos, execuções, prévias, SSE, revisão, aprovação, auditoria, comparação, checklist e downloads estão conectados.
- Testes de alterações não salvas são execuções isoladas, sem aprovação ou exportação ERP e sem substituir o checklist real.
- Revisões de cadastro entram em snapshot de novas execuções do pack atual, condicionado à igualdade dos hashes das seis fontes. A escolha de conta em ajustes usa o plano do snapshot.
- O painel Gmail inclui conexão, contatos, geração/edição de rascunhos, evidências, anexos, aprovação da versão exata e histórico. A interface identifica o provedor simulado e conserva essa identificação no histórico.

## Verificações executadas

| Verificação | Resultado |
|---|---|
| `demo/back/run.sh test` | 135 testes passaram, 55,9 s |
| `npm test -- --run` em `demo/front` | 51 testes passaram, em 6 arquivos |
| `npm run build` em `demo/front` | TypeScript e compilação de produção passaram |
| Adaptador HTTP contra servidor real local, com banco descartável | 18 verificações passaram |
| Navegador com front de produção servido pelo backend | Execução, progresso, bloqueio de aprovação, decisão com justificativa e auditoria conferidos |
| Gmail no navegador, com provedor injetado de teste | Cadastro de contato, geração de rascunho, anexos, retorno OAuth, aprovação da versão exata, aceite simulado e bloqueio de reenvio conferidos |

O teste HTTP percorreu catálogo, validação válida/inválida, versões, autoria Unicode, checklist, upload dos seis arquivos, teste isolado, execução real, contas do snapshot, prévia de dataset, paginação das 305 exceções, aceitação atômica de 247 alertas, revisão individual de 58 bloqueantes, aprovação, quatro arquivos de exportação, auditoria, comparação e indicadores. As decisões foram feitas apenas em banco descartável para exercitar o contrato; não constituem validação financeira das pendências do case.

Os testes backend também cobrem rejeição de decisões em lote sem alteração parcial, imutabilidade de referências, totais Decimal, proteção das exportações, enriquecimento de exceções por origem exata, segurança de rotas e aprovação de e-mail vinculada ao conteúdo.

## Limites da verificação

Nenhuma mensagem real foi enviada e nenhuma conta Google real foi conectada. O envio Gmail real depende da configuração OAuth descrita em [GMAIL.md](GMAIL.md), conta autorizada e aprovação explícita. O teste do provedor não comprova entrega externa.

Os dados originais do case foram preservados. Os testes usaram bancos e diretórios temporários. Os cartões/CSVs de conferência representam o cadastro atual; o lote ERP pertence à execução específica. O formato Fênix permanece sem homologação externa.

Downloads foram verificados pelo contrato HTTP e conteúdo dos artefatos; a interação de download do navegador não foi usada como evidência de conclusão.
