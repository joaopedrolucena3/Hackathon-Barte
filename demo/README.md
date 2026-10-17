# Tarvo Fechamento

Plataforma local para apurar setembro de 2026 a partir dos arquivos originais da Tarvo. Calcula comissões, diferenças de taxa, notas propostas e contrapartidas bancárias; mantém pendências e decisões humanas, rastros, relatórios e e-mails em simulação. O analista trabalha pela interface, sem abrir planilhas.

## Rodar

Pré-requisito: Python 3.10 ou superior com venv e acesso ao PyPI na primeira execução. Nenhuma chave de API é necessária.

```sh
./run.sh
```

Abra http://127.0.0.1:8765. A primeira execução cria `.venv`, instala a dependência `openpyxl` e importa automaticamente `data/case/` para `data/tarvo.sqlite3`. As próximas execuções reutilizam o banco. Para parar, pressione Ctrl+C no terminal.

```sh
./run.sh test       # suíte automatizada, bancos temporários
./run.sh export     # gera os seis CSVs oficiais e relatório em saida/
./run.sh serve --port 8766 --db data/demo.sqlite3  # demonstração isolada
```

Windows: crie o ambiente com `python -m venv .venv`, instale `requirements.txt` usando `.venv\Scripts\python -m pip install -r requirements.txt`, e rode `.venv\Scripts\python -m src.app`.

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

1. Informe seu nome e confira Resumo, fontes e hipóteses.
2. Em Comissões ou Divergências, abra Ver rastro para consultar transação, valores, taxa, vigência, fórmula e linha de origem.
3. Em Pendências, confirme, rejeite ou ajuste o encaminhamento. Rejeitar mantém o item aberto. Mudança de taxa acontece no cadastro com vigência e justificativa; reclassificação bancária registra método HUMANO.
4. Cadastre contatos internos e de cobrança, com severidade e frequência. Abra Notas e cobranças, prepare e edite o rascunho, aprove e simule o envio. Alterações invalidam a aprovação.
5. Conclua o mês. Pendências abertas exigem caixa de aceite e justificativa explícitas. Baixe relatório ou pacote de saídas.

O roteiro detalhado está em DEMO.md.

## Fontes e regras

- Dados sintéticos originais copiados sem alteração para `data/case/`; hashes registrados por importação.
- Instruções oficiais em `docs/01_instrucoes_participantes.docx`.
- 16 respostas do financeiro consultadas antes do código, com links em `docs/FONTES_SLACK.md`.
- Hipóteses e conflitos em `HIPOTESES.md` e `docs/assumptions.json`.
- Controles independentes e funcionamento do motor em `docs/ENGINE_NOTES.md`; cobertura em `docs/TESTES.md`.

Checkout usa taxa contratada por produto/data, com HALF_UP por linha, estornos pela data original e reversões vinculadas à antecipação. Remessa usa 50% do spread realizado elegível por operação, exclui negativos e conta duplicata idêntica uma vez. Notas de remessa têm Ponte como única tomadora. Banco classifica contrapartidas; recebimentos de provisões não viram receita novamente.

## Arquitetura

Python + SQLite + interface HTML/CSS/JavaScript sem compilação. Uma dependência para XLSX, um processo local e nenhum serviço externo: instalação pequena e demonstração reproduzível. A IA ajudou a construir e revisar; ela não executa decisões financeiras no motor.

- `src/importer.py`: CSV pt-BR, XLSX com taxas numéricas/textuais, anexo XLSX do EML e OFX em cp1252. Preserva origem física e valida formatos.
- `src/engine.py`: funções determinísticas com Decimal; seis tabelas oficiais e detalhes de cálculo.
- `src/store.py`: SQLite com cadastros, taxas e histórico, importações imutáveis, cálculos versionados, decisões por evidência, avisos, e-mails e auditoria.
- `src/app.py`: servidor limitado a 127.0.0.1, validação de origem para mutações e agenda local de avisos.
- `web/`: interface responsiva, filtros, cadastros, rastros e aprovações.

Recalcular ou alterar referências reabre o mês. A decisão só permanece válida se a evidência do item não mudou. A aprovação de e-mail se vincula ao destinatário, assunto, corpo e versão do cálculo. Cada envio simulado registra conteúdo, responsável e horário; os alertas internos respeitam as preferências e dispensam aprovação.

Avisos imediatos são processados quando surgem eventos ou se ativa um contato. Resumos e prazos são processados uma vez por dia enquanto o servidor está ativo (verificação a cada minuto), além do botão Processar alertas. O horário do calendário usa America/Sao_Paulo. Sem o servidor ativo, não há agendamento em segundo plano.

## Outubro e reimportação

Em Evidências, use Importar competência, informe mês e pasta local. Os arquivos devem manter o mesmo padrão de nomes e estrutura do case. Referências revisadas são preservadas; novas referências entram; alterações detectadas em uma taxa existente geram aviso para revisão. Cadastre vigências sem sobreposição na interface. O formato atual exige o conjunto de fontes correspondente; arquivos ausentes ou linhas inválidas geram pendência. Um mês sem movimentos também gera bloqueio.

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
- Histórico de preparação anterior a esta sessão deve ser complementado pelo time em PROMPTS; não é fabricado. A exportação desta sessão exclui raciocínio interno e instruções de sistema.
- Não houve publicação do site, push de repositório ou envio formal à organização.
