# Tarvo Fechamento · front e back integrados

A interface React usa a API FastAPI real por padrão. Execuções, versões do pipeline, arquivos, checklist, decisões e auditoria ficam persistidos no servidor. O navegador não precisa manter o estado do fechamento aberto.

## Executar

Use Python 3.13 com `venv`, Node.js e npm. Nesta revisão foram conferidos Python 3.13.7, Node.js 26.10.0 e npm 11.19.1. Na primeira execução é necessário acesso aos repositórios de dependências. Os comandos abaixo partem da raiz do repositório.

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
2. No **Fechamento**, escolha o mês e rode usando o data pack, os arquivos enviados, incluindo complementos ou uma pasta local. Cada execução preserva suas fontes e versão de regras.
3. Em **Execução**, acompanhe os passos e consulte os dados persistidos, com paginação, filtros e totais calculados no servidor.
4. Em **Hipóteses e sugestões**, consulte fatos, regras, evidências, efeitos e próximos passos preservados nesta execução. **Seguir sugestões do agente** abre uma prévia e aplica todos os alertas elegíveis de divergência de taxa e duplicata idêntica, mantendo os valores calculados. Contatos, contestações e respostas continuam pendentes. Casos sem evidência suficiente permanecem para revisão individual. Execuções anteriores à funcionalidade não recebem hipóteses retroativas: crie uma nova execução para usar a revisão assistida.
5. Na **Revisão**, escolha explicitamente manter o tratamento, ajustar ou excluir exceções, com justificativa. A aprovação final continua separada e valida o lote antes de permitir sua exportação. A aplicação das sugestões registra cada decisão na auditoria e não duplica efeitos se repetida.
6. Em **Auditoria**, consulte fontes, parâmetros, hashes, decisões e compare execuções. O download de auditoria também funciona antes da aprovação; os arquivos ERP exigem aprovação.
7. Em **Pipeline**, valide e salve versões ou use **Testar** com mudanças ainda não salvas. O teste preserva sua própria definição e não aprova, exporta nem substitui o checklist da execução real. A prévia mostra dados de uma execução já calculada; use Testar para obter resultados de novos parâmetros.
8. Em **Cadastros**, mantenha lojistas, taxas e contatos. Pack, upload e pasta reconciliam as referências recebidas com o catálogo revisado: conteúdo idêntico acrescenta proveniência, identidades novas ampliam o catálogo e conflitos permanecem explícitos para revisão. Cada execução conserva seu catálogo efetivo; execuções anteriores não são reescritas.
9. Em **Comunicações → E-mail real**, conecte uma conta Gmail por OAuth ou senha de app e revise as sugestões de contestação da execução, com justificativa, destinatário e evidências. Cada envio exige permissão para a versão exata; mudanças exigem nova revisão. Os avisos internos de runs e testes têm ativação própria e explícita.

## E-mail e dados de conferência

A conexão simplificada usa Gmail SMTP com senha de app; OAuth continua disponível como alternativa avançada. A conta da demo é `financeirotarvo@gmail.com`, usada também como destinatário inicial para Orbe, Ponte e avisos. As notificações de runs e testes são reais quando ativadas na interface. Veja [back/docs/GMAIL.md](back/docs/GMAIL.md). As abas de cobranças, avisos internos e relatório do fluxo antigo continuam identificadas como simulação.

Os cartões de comissões, notas e bancos e os CSVs baixados pela aplicação mostram o lote atual do cadastro. As execuções do pipeline têm cálculos, decisões e saídas imutáveis próprios. Exclusões ou ajustes na revisão de um run afetam seu pacote ERP, sem reescrever as fontes nem os relatórios de conferência. O formato Fênix é a proposta do MVP, sem homologação no ERP.

O pacote oficial para a banca é gerado separadamente, com banco novo, pelo comando `./entrega.sh` na raiz. Ele publica os seis CSVs, `manifesto.json` e `verificacao.json` diretamente em `saida/`. Execute `./entrega.sh --check saida` para conferir o pacote. As subpastas `saida/setembro_2026/` e `saida/outubro_2026/` são registros anteriores preservados; outubro é sintético. Consulte o [README da entrega](../README.md) para parâmetros e reprodução isolada.

Os dados originais ficam em `back/data/case/`. O banco principal mantém o fechamento atual; bancos com sufixos `-workflow.sqlite3` e `-email.sqlite3` guardam execuções e mensagens. Arquivos de execução ficam em `back/saida/runs/`. Use `--db` e `--runs-dir` para isolar demonstrações. Tokens Gmail ficam fora do projeto.

## Contratos e validação

- [API do pipeline](back/docs/API_PIPELINE.md), [contrato do front integrado](front/API_PENDENTE.md) e `/api/openapi.json`.
- [Regras financeiras e hipóteses da entrega](../HIPOTESES.md), [notas do motor](back/docs/ENGINE_NOTES.md).
- [Verificação da integração](back/docs/INTEGRACAO_FRONT_BACK.md).

Servidor restrito ao computador local, com autoria declarada e sem autenticação corporativa. Não emite NFS-e nem executa pagamentos. As fontes e pendências não confirmadas permanecem explícitas.
