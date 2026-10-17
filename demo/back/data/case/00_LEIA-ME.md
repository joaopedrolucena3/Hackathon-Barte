# Tarvo Pagamentos: data pack (fechamento de setembro/2026)

Dados sintéticos. Empresas, bancos, parceiros, CNPJs e pessoas são fictícios. Os formatos foram mantidos como cada sistema exporta: datas em pt-BR, vírgula decimal, ponto e vírgula como separador, nomes inconsistentes, planilha mantida à mão. É isso que você receberia de verdade.

| Arquivo | O que é | Como chega na Tarvo |
|---|---|---|
| `01_orbe_relatorio_comissoes_set2026.csv` | Relatório da adquirente Orbe: uma linha por transação (vendas, estornos, antecipações e reversões), com a taxa que a Orbe aplicou | Download do portal da adquirente |
| `02_tabela_taxas_contratadas.xlsx` | Taxas negociadas com cada lojista (MDR, antecipação, spread de remessa) | Planilha mantida à mão pelo financeiro |
| `03_email_ponte_cambio_relatorio_set2026.eml` | E-mail do parceiro de câmbio com o relatório mensal das remessas em anexo | Caixa de entrada do financeiro |
| `04_plano_de_contas_fenix_erp.csv` | Plano de contas | Exportado do ERP Fênix |
| `05a_extrato_banco_aurora_cc4471_set2026.csv` | Extrato da conta principal | Exportado do internet banking (CSV) |
| `05b_extrato_banco_meridiano_cc90233_set2026.ofx` | Extrato da conta usada nas remessas | Exportado do internet banking (OFX) |

Isto é uma amostra de um mês. A operação real tem o mesmo formato e mais volume, todo mês. Considere que a solução vai rodar de novo em outubro, com arquivos novos no mesmo formato.

Regras de negócio que não estão escritas em nenhum arquivo existem. Quem sabe é o time financeiro da Tarvo, que responde no canal do Slack.
