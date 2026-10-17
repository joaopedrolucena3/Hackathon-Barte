# Fontes dos números e cenas ilustrativas

Os dados do case são sintéticos. As telas foram gravadas em 17/10/2026, numa instância isolada do produto (porta 8799, banco e pasta de execuções novos, usuário fictício "Analista Tarvo"). O banco principal, o servidor da porta 8765 e as saídas anteriores não foram alterados. Nenhum e-mail foi enviado.

## Números
| Valor | Onde aparece | Fonte conferida |
|---|---|---|
| R$ 15.397,42 · 118 operações (Casa do Estudante) | s01, s05 | `steps/s8/divergencias` da execução de setembro `61dbabc4`; ENGINE_NOTES.md |
| TX88410932: R$ 608,88 · 2,69% · 0% · R$ 16,38 | s02 | Revisão da execução `61dbabc4` (tela real) e registro da divergência (vigência 01/09–31/12/2026) |
| R$ 246.588,68 · 21 notas (R$ 207.045,23 checkout + R$ 39.543,45 Ponte) | s05 | `steps/s8/notas` da execução `61dbabc4`; ENGINE_NOTES.md |
| R$ 22.173,57 · 237 divergências (valor absoluto) | s05 | `steps/s8/divergencias` da execução `61dbabc4` |
| R$ 1.039,37 · 6 remessas 30/09 → 01/10 | s06 | Passo 7 da execução `61dbabc4` com filtro "Liquidação maior que 30/09/2026" (rodapé "Comissão · visão R$ 1.039,37"); conferido em `saida/setembro_2026/02_run_pipeline/s7_cambio_calculado.csv` |
| Vela: 2 contratos, 22 operações, quem decide: Comercial | s08 | Revisão da execução de outubro `c9f2a7d6` (pacote sintético) |
| 63 bloqueantes sem decisão | s09 | Revisão `c9f2a7d6` depois da decisão registrada (64 → 63) |
| Atlas: 57 operações, R$ 7.876,05 | s12 | Revisão `61dbabc4` (Cadastro não confirmado) |

Os totais da execução de setembro gravada são iguais aos do pacote-base (checkout R$ 207.039,73; remessas R$ 39.543,45). A tela inicial "Fechamento" mostrava uma prévia com outros totais e por isso ficou fora do vídeo.

## Cenas ilustrativas ou reconstruídas
- **s01, s05, s13:** cartões animados com valores conferidos. Não são telas do produto.
- **s03:** esquema das fontes, com os nomes reais dos arquivos do pacote.
- **s11:** a tela é real, mas o chat estava **indisponível** (não há credencial da Anthropic nesta máquina). Nenhuma resposta foi gerada nem mostrada. Os três blocos (IA / Regras / Financeiro) descrevem o papel de cada parte com base em `src/chat/agent.py`, HIPOTESES.md e ENGINE_NOTES.md.
- **s12:** cartão de limites, com base em demo/README.md e HIPOTESES.md.
- **s04:** a gravação dos passos de setembro vem de uma execução anterior do mesmo pacote-base, com os mesmos totais, feita em outra instância isolada.
- **s07 e s09:** gravações reais aceleradas para caber no tempo (rodar outubro; digitação da justificativa).

## Ações reais executadas no ambiente isolado
- Execução de setembro (`61dbabc4`) e de outubro (`c9f2a7d6`) com os pacotes do servidor.
- Uma decisão registrada na exceção TX89000499 da Vela: "Manter tratamento atual", com a justificativa "Linha segue sem faturamento até o Comercial corrigir a vigência da Vela."
- Sugestão de contestação aberta para revisão, sem salvar nem enviar. O Gmail não estava conectado.
