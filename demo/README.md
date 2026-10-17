# Tarvo Fechamento · front e back integrados

A interface React usa a API FastAPI real por padrão. Execuções, versões do pipeline, arquivos, checklist, decisões e auditoria ficam persistidos no servidor. O navegador não precisa manter o estado do fechamento aberto.

## Executar

Requisitos: Python 3.11+, Node.js 18+ e npm. Na primeira execução é necessário acesso aos repositórios de dependências.

```sh
cd demo/back
./run.sh
```

Abra http://127.0.0.1:8765. O comando instala as dependências fixadas, compila `front/` e inicia o servidor local. Alterações no front provocam nova compilação na próxima inicialização. Rotas diretas como `/pipeline` e `/runs/<id>/revisao` abrem a mesma aplicação.

```sh
./run.sh front     # compila a interface conectada ao backend
./run.sh test      # testes Python, usando bancos temporários
./run.sh serve --port 8766 --db data/demo.sqlite3 --runs-dir data/demo-runs
```

Para desenvolver com recarga automática, deixe o back ativo e execute em `demo/front`:

```sh
npm ci
npm run dev
# Outra porta no backend:
TARVO_BACKEND=http://127.0.0.1:8766 npm run dev
npm test
npm run build
```

O mock anterior continua disponível somente quando explicitamente selecionado com `VITE_AGENT_API=mock npm run dev`. O comando `run.sh` sempre prepara a interface para a API real.

## Fluxo integrado

1. Informe o responsável no topo. A autoria declarada acompanha tanto as operações de cadastro quanto as do pipeline.
2. No **Fechamento**, escolha o mês e rode usando o data pack, os seis arquivos enviados ou uma pasta local. Cada execução preserva suas fontes e versão de regras.
3. Em **Execução**, acompanhe os passos e consulte os dados persistidos, com paginação, filtros e totais calculados no servidor.
4. Na **Revisão**, aceite, ajuste ou exclua exceções com justificativa. Alertas podem ser aceitos em lote; bloqueantes são decididas individualmente. A aprovação valida o lote antes de permitir sua exportação.
5. Em **Auditoria**, consulte fontes, parâmetros, hashes, decisões e compare execuções. O download de auditoria também funciona antes da aprovação; os arquivos ERP exigem aprovação.
6. Em **Pipeline**, valide e salve versões ou use **Testar** com mudanças ainda não salvas. O teste preserva sua própria definição e não aprova, exporta nem substitui o checklist da execução real. A prévia mostra dados de uma execução já calculada; use Testar para obter resultados de novos parâmetros.
7. Em **Cadastros**, mantenha lojistas, taxas e contatos. Ao rodar o pack atual, referências revisadas são copiadas para a nova execução quando os hashes das fontes coincidem. Uploads e outras pastas usam suas próprias referências. Execuções anteriores não são reescritas.
8. Em **Comunicações → Gmail · pendências**, configure contatos, gere e revise mensagens e anexos, conecte uma conta autorizada e aprove a versão exata para envio. Uma mudança na mensagem ou nas evidências exige nova revisão.

## E-mail e dados de conferência

Gmail de pendências usa OAuth e aprovação explícita. A configuração está em [back/docs/GMAIL.md](back/docs/GMAIL.md). Cobranças, avisos internos e relatório do fluxo original continuam em simulação. Não há envio real sem configuração e autorização.

Os cartões de comissões, notas e bancos e os seis CSVs de conferência mostram o lote atual do cadastro. As execuções do pipeline têm cálculos, decisões e saídas imutáveis próprios. Exclusões ou ajustes na revisão de um run afetam seu pacote ERP, sem reescrever as fontes nem os relatórios de conferência. O formato Fênix é a proposta do MVP, sem homologação no ERP.

Os dados originais ficam em `back/data/case/`. O banco principal mantém o fechamento atual; bancos com sufixos `-workflow.sqlite3` e `-email.sqlite3` guardam execuções e mensagens. Arquivos de execução ficam em `back/saida/runs/`. Use `--db` e `--runs-dir` para isolar demonstrações. Tokens Gmail ficam fora do projeto.

## Contratos e validação

- [API do pipeline](back/docs/API_PIPELINE.md), [contrato do front integrado](front/API_PENDENTE.md) e `/api/openapi.json`.
- [Regras financeiras e hipóteses](back/HIPOTESES.md), [notas do motor](back/docs/ENGINE_NOTES.md).
- [Verificação da integração](back/docs/INTEGRACAO_FRONT_BACK.md).

Servidor restrito ao computador local, com autoria declarada e sem autenticação corporativa. Não emite NFS-e nem executa pagamentos. As fontes e pendências não confirmadas permanecem explícitas.
