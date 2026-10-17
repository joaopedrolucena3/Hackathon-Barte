# Tarvo Fechamento

Plataforma local para apurar setembro de 2026 a partir dos arquivos originais da Tarvo. Calcula comissões, diferenças de taxa, notas propostas e contrapartidas bancárias; mantém pendências e decisões humanas, rastros, relatórios e e-mails em simulação. O analista trabalha pela interface, sem abrir planilhas.

## Estrutura: front e back

A demo está dividida em duas pastas para que os integrantes do time trabalhem em paralelo, sem conflito de arquivos:

- `front/`: interface React + Vite + TypeScript. Consome a API em `/api/*` (contrato atual em `back/docs/CONTRACT.md`) e o contrato do agente de fechamento em `front/src/api/agent/contract.ts`. Os endpoints do agente que o back ainda não tem estão em `front/API_PENDENTE.md`.
- `back/`: servidor Python, motor de cálculo, importador, SQLite, testes, dados do case (`data/case/`), `docs/`, `saida/`, `run.sh` e `requirements.txt`. Serve o build do front (`front/dist`).

Todos os comandos abaixo rodam a partir de `demo/back/`.

## Rodar

Pré-requisitos: Python 3.10 ou superior com venv, Node.js 18 ou superior com npm, e acesso ao PyPI e ao npm na primeira execução. Nenhuma chave de API é necessária.

```sh
cd back
./run.sh
```

Abra http://127.0.0.1:8765. A primeira execução cria `.venv`, instala a dependência `openpyxl`, instala as dependências do front e compila `front/dist`, e importa automaticamente `data/case/` para `data/tarvo.sqlite3`. As próximas execuções reutilizam o banco e só recompilam o front se o código dele mudou. Para parar, pressione Ctrl+C no terminal.

```sh
./run.sh test       # suíte automatizada do back, bancos temporários
./run.sh export     # gera os seis CSVs oficiais e relatório em saida/
./run.sh front      # só compila o front
./run.sh serve --port 8766 --db data/demo.sqlite3  # demonstração isolada
```

Desenvolvimento do front com recarga automática: com o back rodando, `cd ../front && npm run dev` e abra http://127.0.0.1:5173 (o Vite repassa `/api` para a porta 8765; use `TARVO_BACKEND=http://127.0.0.1:8766 npm run dev` para outra porta). Testes do front: `npm test`.

Windows: crie o ambiente com `python -m venv .venv`, instale `requirements.txt` usando `.venv\Scripts\python -m pip install -r requirements.txt`, compile o front com `cd ..\front && npm install && npm run build` e rode `.venv\Scripts\python -m src.app`.

### Agente em modo demonstração

As telas do agente (runs, passos ao vivo, revisão, auditoria e construtor) usam um mock no navegador (`front/src/api/agent/mock/`) enquanto o back não tem os endpoints de run. O mock lê os números reais de `/api/state` e grava no back real o que já existe: decisões de revisão (`/api/decisions`), recálculo, importação e a tolerância de spread. Runs, checklist manual e versões do pipeline ficam no `localStorage` do navegador. Quando o back implementar `front/API_PENDENTE.md`, compile com `VITE_AGENT_API=http npm run build`; as telas não mudam.

## Resultado inicial verificado

Os valores são provisórios até o analista tratar as pendências ou aceitar as ressalvas. As 57 operações da Atlas não entram no faturamento sem contrato e identidade confirmados.

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

A comissão da Casa do Estudante é −R$ 5,50: a isenção de setembro não é tratada como retroativa à venda de agosto estornada em setembro. Não se emite NF negativa. Por isso as notas superam a soma das comissões em R$ 5,50. A interpretação está em HIPOTESES.md e na interface. Não somar pendências, divergências e comissões: são visões diferentes das mesmas operações.

## Fluxo do analista

1. **Fechamento** (`/competencias/2026-09`): informe seu nome no topo e confira progresso, valor em pendências, último run e checklist. Os cartões de Comissões e Divergências abrem painéis com gráfico, tabela e rastro de cada valor.
2. **Rodar fechamento**: o agente executa os passos do pipeline ao vivo (`/runs/:id`). Cada passo mostra linhas, exceções e as colunas que criou; o run para na aprovação humana antes do ERP.
3. **Revisão** (aba do run, substitui Pendências): aceite, ajuste (conta analítica e/ou valor) ou exclua do lote cada exceção, com justificativa. Bloqueantes uma a uma; alertas podem ser aceitos em lote. Aprove e exporte, ou reprove com motivo.
4. **Auditoria** (aba do run): arquivos com SHA-256, pipeline e versão, passos com parâmetros e hash de saída, decisões antes → depois, aprovação e exportação. Compare dois runs para provar que o resultado é reprodutível.
5. **Notas e bancos**: prepare a cobrança de cada tomador, revise, aprove a versão exata e simule o envio; nos bancos, veja entradas e saídas por dia e reclassifique lançamentos (método HUMANO).
6. **Cadastros**: ajuste lojistas, taxas (linha do tempo de vigências) e contatos com uma justificativa por alteração. Mudança de taxa reabre o mês para recálculo.
7. **Pipeline**: ajuste parâmetros dos passos (ex.: tolerância de taxa), veja o efeito na prévia, salve uma nova versão e teste em rascunho.
8. Conclua o mês no Fechamento. Pendências abertas exigem caixa de aceite e justificativa explícitas. Baixe relatório ou pacote de saídas.

O roteiro detalhado está em DEMO.md.

## Fontes e regras

- Dados sintéticos originais copiados sem alteração para `data/case/`; hashes registrados por importação.
- Instruções oficiais em `docs/01_instrucoes_participantes.docx`.
- 16 respostas do financeiro consultadas antes do código, com links em `docs/FONTES_SLACK.md`.
- Hipóteses e conflitos em `HIPOTESES.md` e `docs/assumptions.json`.
- Controles independentes e funcionamento do motor em `docs/ENGINE_NOTES.md`; cobertura em `docs/TESTES.md`.

Checkout usa taxa contratada por produto/data, com HALF_UP por linha, estornos pela data original e reversões vinculadas à antecipação. Remessa usa 50% do spread realizado elegível por operação, exclui negativos e conta duplicata idêntica uma vez. Notas de remessa têm Ponte como única tomadora. Banco classifica contrapartidas; recebimentos de provisões não viram receita novamente.

## Arquitetura

Python + SQLite no back; React + Vite + TypeScript no front, compilado pelo `run.sh` e servido pelo próprio Python. Uma dependência Python para XLSX, um processo local e nenhum serviço externo. A IA ajudou a construir e revisar; ela não executa decisões financeiras no motor, e o agente de fechamento é um conjunto de passos fixos configurados pelo contador, sem LLM no fluxo.

- `src/importer.py`: CSV pt-BR, XLSX com taxas numéricas/textuais, anexo XLSX do EML e OFX em cp1252. Preserva origem física e valida formatos.
- `src/engine.py`: funções determinísticas com Decimal; seis tabelas oficiais e detalhes de cálculo.
- `src/store.py`: SQLite com cadastros, taxas e histórico, importações imutáveis, cálculos versionados, decisões por evidência, avisos, e-mails e auditoria.
- `src/app.py`: servidor limitado a 127.0.0.1, validação de origem para mutações e agenda local de avisos.
- `front/src/pages/`: Fechamento, Execução (passos, revisão, auditoria), Notas e bancos, Cadastros, Pipeline e Comunicações.
- `front/src/api/`: cliente da API atual (`core.ts`), contrato do agente (`agent/contract.ts`), adaptador real (`agent/http.ts`) e mock (`agent/mock/`).
- Valores em dinheiro vêm do back; o mock que substitui endpoints futuros soma em centavos inteiros (`front/src/lib/decimal.ts`), nunca em ponto flutuante.

Recalcular ou alterar referências reabre o mês. A decisão só permanece válida se a evidência do item não mudou. A aprovação de e-mail se vincula ao destinatário, assunto, corpo e versão do cálculo. Cada envio simulado registra conteúdo, responsável e horário; os alertas internos respeitam as preferências e dispensam aprovação.

Avisos imediatos são processados quando surgem eventos ou se ativa um contato. Resumos e prazos são processados uma vez por dia enquanto o servidor está ativo (verificação a cada minuto), além do botão Processar alertas. O horário do calendário usa America/Sao_Paulo. Sem o servidor ativo, não há agendamento em segundo plano.

## Outubro e reimportação

No Fechamento, escolha a competência, clique em Rodar fechamento e use "Importar de uma pasta no servidor", informando mês e pasta local. Sem arquivos, o primeiro passo do run falha e lista o que falta. Os arquivos devem manter o mesmo padrão de nomes e estrutura do case. Referências revisadas são preservadas; novas referências entram; alterações detectadas em uma taxa existente geram aviso para revisão. Cadastre vigências sem sobreposição na interface. O formato atual exige o conjunto de fontes correspondente; arquivos ausentes ou linhas inválidas geram pendência. Um mês sem movimentos também gera bloqueio.

O SQLite arquiva importações e execuções anteriores. A interface apresenta o lote ativo; consulta comparativa de históricos mensais não foi implementada. Para isolamento completo, use um banco por demonstração ou cliente.

## Saídas

`saida/` contém `comissoes_por_lojista.csv`, `divergencias_taxa.csv`, `notas_a_emitir.csv`, `lancamentos_classificados.csv`, `pendencias.csv` e `rastro.csv`. Delimitador `;`, decimal `.`, datas ISO e CNPJ 14 dígitos. Colunas extras documentam decisões e evidências. O pacote inclui relatório HTML imprimível; também há `verificacao.json` com totais, validação e hashes.

## Limitações conhecidas

- E-mails são exclusivamente simulados, sem SMTP e sem envio real. A integração de produção permanece indisponível, evitando qualquer envio acidental.
- Ator declarado pelo operador; sem login corporativo ou garantia criptográfica de autoria. Servidor local, não adequado a exposição na internet ou múltiplos usuários sem autenticação.
- Notas são propostas de emissão, sem integração com NFS-e ou ERP. Não executa transferências, pagamentos ou devoluções.
- Identificações sem chave confirmada, contratos ausentes, negativos e dados inválidos permanecem em revisão. Exceções podem ser aceitas como ressalvas com autoria e motivo.
- Reversão parcial e mudança de formatos exigem regra adicional; não são inventadas pelo motor. Regras bancárias conhecidas são explícitas; novos históricos desconhecidos geram pendência.
- Não há conciliação parcelada Orbe sem agenda de recebíveis nem confirmação do TED de outubro sem extrato, conforme esclarecimento do financeiro.
- Histórico de preparação anterior a esta sessão deve ser complementado pelo time em /PROMPTS (raiz do repositório); não é fabricado. A exportação desta sessão exclui raciocínio interno e instruções de sistema.
- O agente de fechamento roda em modo demonstração no navegador (ver acima): runs, checklist manual e versões do pipeline ficam no `localStorage`, por navegador, até o back implementar `front/API_PENDENTE.md`. O valor proposto em "Ajustar" vai na justificativa da decisão, porque o back não aceita número solto; "Excluir do lote" é registrado como ajuste com o prefixo `[Excluído do lote]`.
- Não houve publicação do site nem envio formal à organização.
