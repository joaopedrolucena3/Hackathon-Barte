# Tarvo Fechamento · Equipe Insper AI

Fechamento de setembro de 2026 da Tarvo a partir dos arquivos originais do case: comissões de checkout e remessas, divergências de taxa, notas propostas, classificação dos dois extratos e pendências com responsável. Cada valor dos CSVs de conferência tem rastro até a origem. O processamento financeiro é determinístico; o chat de consulta à API e o envio de e-mail são recursos opcionais.

As [instruções oficiais](demo/back/docs/01_instrucoes_participantes.docx) definem a entrega. As [hipóteses e regras](HIPOTESES.md) separam respostas do financeiro, interpretações adotadas e decisões ainda pendentes.

## Instalar e gerar a entrega do zero

Use **Python 3.13** com suporte a `venv` e acesso ao PyPI na primeira instalação. O comando prepara o ambiente em `demo/back/.venv` com as dependências de `demo/back/requirements.lock.txt`. O ambiente conferido nesta revisão usa Python 3.13.7; não se presume compatibilidade do conjunto fixado com todas as versões anteriores.

O inicializador procura `python3.13`. Para selecionar outro executável da mesma versão ao criar o ambiente, use `TARVO_PYTHON=/caminho/python3.13 ./entrega.sh`. Um `.venv` existente incompatível é preservado e a execução para com uma orientação; renomeie esse ambiente antes de criar outro.

Obtenha o repositório público com Git (ou baixe e extraia seu ZIP):

```sh
git clone https://github.com/joaopedrolucena3/Hackathon-Barte.git
cd Hackathon-Barte
```

Na raiz do repositório:

```sh
./entrega.sh --period 2026-09 --source-dir Tarvo_Data_Pack_set2026 --output-dir saida
./entrega.sh --check saida
```

`./entrega.sh` sem argumentos usa exatamente os mesmos valores padrão. A geração lê as fontes originais, usa banco temporário novo e não incorpora decisões de bancos usados na demonstração. Não exige chave de API, conta Gmail, Node.js nem interface aberta.

O pacote é preparado e validado antes de substituir os arquivos oficiais. A publicação tem rollback e recuperação de interrupção; subpastas existentes em `saida/` são preservadas. `manifesto.json` identifica competência, fontes, hashes, código e artefatos; `verificacao.json` registra os controles executados. A validação confere estrutura, formatos, IDs, fontes e somas do rastro. Ela não substitui a validação das regras pelo financeiro.

Não edite a pasta de destino enquanto a geração estiver em andamento. O comando impede duas publicações simultâneas e aborta ao detectar alterações concorrentes no histórico, mas outros programas não obedecem necessariamente ao bloqueio. `--check` também compara a identidade do código financeiro atual com a versão registrada: após alterar o código, gere novamente.

Para reproduzir em outro diretório, sem trocar o pacote principal:

```sh
./entrega.sh --period 2026-09 --source-dir Tarvo_Data_Pack_set2026 --output-dir /tmp/tarvo-conferencia
./entrega.sh --check /tmp/tarvo-conferencia
```

## Arquivos oficiais

Os seis arquivos ficam **diretamente em `saida/`**. Usam `;` como separador, ponto decimal, datas `AAAA-MM-DD` e CNPJ com 14 dígitos. Colunas adicionais preservam evidências e decisões.

| Arquivo | Colunas obrigatórias |
|---|---|
| `comissoes_por_lojista.csv` | `id_saida;cnpj;lojista;linha_negocio;comissao_brl` |
| `divergencias_taxa.csv` | `id_saida;cnpj;linha_negocio;ref_origem;taxa_contratada_pct;taxa_aplicada_pct;diferenca_brl` |
| `notas_a_emitir.csv` | `id_saida;tomador_cnpj;tomador;linha_negocio;valor_brl;discriminacao` |
| `lancamentos_classificados.csv` | `id_saida;banco;ref_origem;data;descricao;valor;conta_codigo;metodo;confianca` |
| `pendencias.csv` | `id_saida;tipo;ref_origem;valor_brl;motivo;quem_decide` |
| `rastro.csv` | `id_saida;arquivo_origem;ref_origem;valor` |

`linha_negocio` usa `CHECKOUT` ou `REMESSA`; `banco`, `AURORA` ou `MERIDIANO`; `metodo`, `REGRA`, `IA` ou `HUMANO`; `confianca` vai de 0 a 1. A referência é o ID Orbe, número da operação Ponte, linha física `L...` do Aurora ou FITID do Meridiano. O rastro da Ponte identifica o anexo dentro do EML. Para cada valor conhecido, a soma decimal de `rastro.valor` por `id_saida` deve coincidir com a saída; valor indisponível permanece explícito e não vira zero.

As pastas `saida/setembro_2026/` e `saida/outubro_2026/` são **histórico anterior**, preservado como evidência e não atualizado pela geração oficial. Outubro foi construído com dados sintéticos para exercitar continuidade; não constitui fechamento real de outubro. `demo/back/saida/` pertence ao fluxo local da aplicação e também não é a pasta oficial de entrega.

## Abrir a aplicação

A interface exige Node.js e npm, além do Python 3.13. Nesta revisão os executáveis locais foram Node.js **26.10.0** e npm **11.19.1**; as dependências da interface estão fixadas em `demo/front/package-lock.json`.

```sh
./demo/back/run.sh
```

Abra [http://127.0.0.1:8765](http://127.0.0.1:8765). Na primeira execução, o comando instala dependências, compila o front e cria os bancos locais. As próximas reutilizam os dados. Para parar, pressione Ctrl+C. O [guia da aplicação](demo/README.md) descreve o fluxo; o [guia do backend](demo/back/README.md) reúne opções e contratos.

Para isolar uma demonstração, escolha tanto o banco como a pasta de execuções:

```sh
./demo/back/run.sh serve --port 8766 --db /tmp/tarvo-demo.sqlite3 --runs-dir /tmp/tarvo-demo-runs
```

No Windows, use um ambiente compatível com os launchers shell, como WSL. O [guia do backend](demo/back/README.md) também descreve a inicialização manual da aplicação; essa alternativa não substitui a validação do pacote oficial.

## Chaves e serviços opcionais

| Recurso | Configuração e limite |
|---|---|
| Fechamento, CSVs e revisão local | Não exigem credencial externa. |
| Chat sobre os dados dos passos | `ANTHROPIC_API_KEY` ou perfil de autenticação aceito pelo servidor; consulte [CHAT_API.md](demo/back/docs/CHAT_API.md). O uso da API pode gerar cobrança. Sem credencial, o fechamento continua disponível. |
| Envio real de e-mail | Conectar Gmail por senha de app ou OAuth e revisar o destinatário e a versão da mensagem; consulte [GMAIL.md](demo/back/docs/GMAIL.md). Avisos automáticos têm ativação própria. |

Não versionar chaves, senhas, tokens ou arquivos privados de autenticação. O endereço preenchido na demo é uma caixa de teste; não comprova contato oficial de Orbe/Ponte. Aceitação pelo provedor não confirma chegada à caixa. Os testes automatizados de e-mail usam provedores simulados.

## Resultado reproduzido em 17/10/2026

A geração limpa com os seis arquivos originais de setembro produziu os resultados abaixo. São controles desta versão e destas entradas, **não um gabarito validado pela organização**. Mudanças de regras ou fontes podem alterar contagens e exigem nova geração.

| Controle | Resultado |
|---|---:|
| Movimentos Orbe | 1.943 |
| Remessas recebidas / operações únicas | 233 / 232 |
| Movimentos Aurora / Meridiano | 84 / 100 |
| Comissão checkout | R$ 207.039,73 |
| Comissão remessa | R$ 39.543,45 |
| Notas propostas | 21, somando R$ 246.588,68 |
| Divergências | 237; soma assinada R$ 14.826,55 |
| Pendências / bloqueantes | 295 / 10 |
| Registros de resultado / linhas de rastro | 772 / 5.226 |

As 57 operações da Atlas ficam em uma pendência por empresa e competência, sem faturamento. As nove ocorrências de origem histórica ausente permanecem bloqueantes; 38 divergências de bandeira são alertas de qualidade. A comissão de −R$ 5,50 da Casa não gera nota negativa, por isso as notas superam a soma das comissões nesse valor. Pendências, divergências, comissões e movimentação bancária se sobrepõem e não devem ser somadas como uma única perda ou receita.

## Verificar o projeto

```sh
./entrega.sh --check saida
./demo/back/run.sh test
```

Para a interface, a partir de `demo/front/`:

```sh
npm ci
npm test
npm run build
```

Consulte a [verificação desta entrega](demo/back/docs/VERIFICACAO_ENTREGA.md) para os resultados e limites desta revisão. Os [registros anteriores de testes](demo/back/docs/TESTES.md) incluem execuções históricas; contagens e resultados desses registros não comprovam automaticamente a revisão atual. Uma validação dos CSVs não verifica entrega real de e-mail, emissão fiscal, integração ERP nem todos os caminhos da interface.

## Limitações e decisões humanas

- Identidade e contrato da Atlas, evidência histórica de estornos, classificação de movimentos novos e demais pendências exigem revisão. Aprovar um encaminhamento não cria contrato nem comprova resposta do parceiro.
- As notas são propostas: o sistema não emite NFS-e, não calcula tributos sobre a receita e não executa pagamentos ou devoluções.
- O lote de partidas dobradas do pipeline exige aprovação humana. O mapa contábil e o leiaute Fênix são propostas do MVP, sem homologação ou importação real no ERP.
- Sem agenda de recebíveis, não há conciliação individual das parcelas Orbe. O TED da Ponte e a transferência em trânsito dependem dos extratos seguintes.
- O motor reconhece estruturas conhecidas e preserva complementos, duplicidades e linhas inválidas para revisão; formatos novos podem exigir adaptação. O pack sintético de outubro não prova aceitação de qualquer fonte futura.
- O responsável é declarado localmente; não há autenticação corporativa. O servidor é destinado ao computador local. Avisos agendados dependem de o servidor permanecer ativo.
- Cobranças e avisos do fluxo antigo são simulações; os painéis de envio real e suas autorizações são separados.

## Organização e entrega à banca

- `src/` equivalente: [demo/back/src/](demo/back/src/) e [demo/front/src/](demo/front/src/).
- Fontes preservadas: [Tarvo_Data_Pack_set2026/](Tarvo_Data_Pack_set2026/); a aplicação traz cópia em `demo/back/data/case/`.
- Premissas, perguntas consultadas e respostas: [HIPOTESES.md](HIPOTESES.md) e [FONTES_SLACK.md](demo/back/docs/FONTES_SLACK.md).
- Histórico de IA e momentos: [PROMPTS/](PROMPTS/) e [MOMENTOS.md](PROMPTS/MOMENTOS.md).
- Pacote oficial: [saida/](saida/).

O DOCX exige repositório público e link de entrega até **18h30 de 17/10/2026**, além do pitch até **19h**, no horário de São Paulo. Há diferença entre o canal indicado no DOCX e uma resposta logística registrada no Slack; ela permanece descrita em HIPOTESES.md para o time confirmar com a organização. Gerar os arquivos não publica o repositório, não envia o link e não substitui o pitch.
