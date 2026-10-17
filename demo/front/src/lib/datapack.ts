// Naming convention of the monthly data pack (see back/data/case/00_LEIA-ME.md).
/** Expected data-pack names for a competência (two reference files do not carry the month). */
export function expectedFiles(comp: string) {
  const [year, month] = comp.split('-');
  const months = ['jan', 'fev', 'mar', 'abr', 'mai', 'jun', 'jul', 'ago', 'set', 'out', 'nov', 'dez'];
  const token = `${months[Number(month) - 1] || month}${year}`;
  return [
    { prefix: '01_', name: `01_orbe_relatorio_comissoes_${token}.csv`, monthly: true },
    { prefix: '02_', name: '02_tabela_taxas_contratadas.xlsx', monthly: false },
    { prefix: '03_', name: `03_email_ponte_cambio_relatorio_${token}.eml`, monthly: true },
    { prefix: '04_', name: '04_plano_de_contas_fenix_erp.csv', monthly: false },
    { prefix: '05a_', name: `05a_extrato_banco_aurora_cc4471_${token}.csv`, monthly: true },
    { prefix: '05b_', name: `05b_extrato_banco_meridiano_cc90233_${token}.ofx`, monthly: true },
  ];
}
