"""Oráculos de negócio independentes: exemplos manuais e baselines do case."""
from collections import defaultdict
from copy import deepcopy
from decimal import Decimal, ROUND_HALF_UP
from pathlib import Path
import hashlib
import tempfile
import unittest

from src.importer import load_data
from src.engine import calculate

ROOT = Path(__file__).resolve().parents[1]
PACK = ROOT.parent
D = Decimal
CNPJ = '22224579000109'
EC = '1075624862'


def fixture():
    return {'merchants': [{'cnpj': CNPJ, 'name': 'Escola Bridge de Idiomas Ltda',
                          'ec': EC, 'active': True, 'source_ref': 'teste!6'}],
            'rates': [], 'accounts': [], 'checkout': [], 'remittances': [],
            'bank': [], 'sources': [], 'import_warnings': []}


def rate(id='r1', pct='2.00', start='2026-01-01', end='', product='CREDITO_A_VISTA'):
    return {'id': id, 'cnpj': CNPJ, 'product': product, 'start': start, 'end': end,
            'rate_pct': pct, 'source_file': 'contratos.xlsx', 'source_ref': id}


def checkout(id='T1', gross='100.00', date='2026-09-15', applied='2.00', **changes):
    fee = (D(gross) * D(applied) / 100).quantize(D('0.01'), rounding=ROUND_HALF_UP)
    net = D(gross) - fee
    row = {'id': id, 'date': date, 'ec': EC, 'name': 'BRIDGE', 'type': 'VENDA',
           'modality': 'CREDITO A VISTA', 'installments': 1, 'brand': 'VISA',
           'gross': gross, 'applied_rate_pct': applied, 'reported_fee': str(fee),
           'net': str(net), 'original_id': '', 'original_date': '',
           'source_file': 'orbe.csv', 'source_ref': id, 'physical_row': 2}
    row.update(changes)
    return row


def remittance(id='P1', spread='100.01', applied='2.00', **changes):
    row = {'id': id, 'contracted_date': '2026-09-14', 'settlement_date': '2026-09-15',
           'cnpj': CNPJ, 'name': 'BRIDGE', 'currency': 'USD', 'foreign_amount': '1000.00',
           'client_rate': '5.10', 'ptax_rate': '5.00', 'gross_brl': '5100.00',
           'spread_brl': spread, 'applied_rate_pct': applied, 'estimated_spread_brl': '999.99',
           'iof_brl': '19.38', 'compliance': 'APROVADO', 'observation': '',
           'source_file': 'ponte.xlsx', 'source_ref': id, 'physical_row': 6}
    row.update(changes)
    return row


def total(result, line):
    return sum((D(r['comissao_brl']) for r in result['comissoes']
                if r['linha_negocio'] == line), D('0'))


def issues_for(result, ref):
    return [p for p in result['pendencias'] if ref in str(p.get('ref_origem', ''))]


class ManualBusinessRules(unittest.TestCase):
    def test_rate_change_uses_transaction_date_and_inclusive_boundaries(self):
        data = fixture()
        data['rates'] = [rate('old', '2.59', end='2026-09-14'),
                         rate('new', '2.19', start='2026-09-15')]
        data['checkout'] = [checkout('BEFORE', '1000.00', '2026-09-14', '2.59'),
                            checkout('AFTER', '1000.00', '2026-09-15', '2.59')]
        result = calculate(data)
        self.assertEqual(total(result, 'CHECKOUT'), D('47.80'))
        self.assertEqual(len(result['divergencias']), 1)
        self.assertEqual(result['divergencias'][0]['ref_origem'], 'AFTER')
        self.assertEqual(D(result['divergencias'][0]['diferenca_brl']), D('4.00'))
        self.assertTrue(issues_for(result, 'AFTER'), 'Divergência deve pedir revisão humana')

    def test_refund_uses_original_sale_date_across_months(self):
        data = fixture()
        data['rates'] = [rate('old', '2.59', end='2026-08-31'),
                         rate('new', '0.00', start='2026-09-01')]
        data['checkout'] = [checkout('REFUND', '-1000.00', type='ESTORNO',
                                     original_date='2026-08-21', original_id='OLD', applied='2.59')]
        result = calculate(data)
        self.assertEqual(total(result, 'CHECKOUT'), D('-25.90'))
        self.assertFalse(result['notas'], 'Comissão negativa não deve virar NF positiva')
        self.assertTrue(result['pendencias'])

    def test_refund_missing_original_date_is_blocked(self):
        data = fixture()
        data['rates'] = [rate()]
        data['checkout'] = [checkout('NO-DATE', '-100.00', type='ESTORNO')]
        result = calculate(data)
        self.assertEqual(total(result, 'CHECKOUT'), D('0'))
        self.assertTrue(issues_for(result, 'NO-DATE'))

    def test_anticipation_and_reversal_join_same_checkout_invoice(self):
        data = fixture()
        data['rates'] = [rate(), rate('ant', '2.10', product='ANTECIPACAO')]
        data['checkout'] = [checkout('SALE', '100.00'),
                            checkout('ADVANCE', '1000.00', date='2026-09-10', type='ANTECIPACAO', applied='2.10'),
                            checkout('REVERSE', '-1000.00', type='REVERSAO ANTECIPACAO',
                                     applied='2.10', original_date='2026-09-10', original_id='ADVANCE')]
        result = calculate(data)
        self.assertEqual(total(result, 'CHECKOUT'), D('2.00'))
        notes = [n for n in result['notas'] if n['linha_negocio'] == 'CHECKOUT']
        self.assertEqual(len(notes), 1)
        self.assertEqual(D(notes[0]['valor_brl']), D('2.00'))

    def test_overlap_cannot_silently_choose_one_contract(self):
        data = fixture()
        data['rates'] = [rate('one', '2.00'), rate('two', '3.00', start='2026-09-01')]
        data['checkout'] = [checkout('OVERLAP')]
        result = calculate(data)
        self.assertEqual(total(result, 'CHECKOUT'), D('0'))
        self.assertTrue(issues_for(result, 'OVERLAP'))

    def test_gap_in_contract_is_a_pending_item(self):
        data = fixture()
        data['rates'] = [rate('old', end='2026-09-14'), rate('new', start='2026-09-16')]
        data['checkout'] = [checkout('GAP')]
        result = calculate(data)
        self.assertEqual(total(result, 'CHECKOUT'), D('0'))
        self.assertTrue(issues_for(result, 'GAP'))

    def test_unknown_establishment_is_not_matched_by_similar_name(self):
        data = fixture()
        data['rates'] = [rate()]
        data['checkout'] = [checkout('UNKNOWN', ec='UNKNOWN', name='Escola Bridge de Idiomas Ltda')]
        result = calculate(data)
        self.assertEqual(total(result, 'CHECKOUT'), D('0'))
        self.assertTrue(issues_for(result, 'UNKNOWN'))

    def test_conflicting_merchant_identity_cannot_choose_first_record(self):
        data = fixture()
        data['merchants'].append({**data['merchants'][0], 'cnpj': '95927868000148'})
        data['rates'] = [rate()]
        data['checkout'] = [checkout('EC-CONFLICT')]
        result = calculate(data)
        self.assertEqual(total(result, 'CHECKOUT'), D('0'))
        self.assertTrue(issues_for(result, 'EC-CONFLICT'))

    def test_remittance_without_cnpj_is_blocked_instead_of_name_matched(self):
        data = fixture()
        data['rates'] = [rate(product='REMESSA')]
        data['remittances'] = [remittance('NO-CNPJ', cnpj='', name=data['merchants'][0]['name'])]
        result = calculate(data)
        self.assertEqual(total(result, 'REMESSA'), D('0'))
        self.assertTrue(issues_for(result, 'NO-CNPJ'))

    def test_remittance_uses_realized_spread_and_half_up_per_operation(self):
        data = fixture()
        data['rates'] = [rate(product='REMESSA')]
        data['remittances'] = [remittance('P1', '100.01'), remittance('P2', '100.01')]
        result = calculate(data)
        self.assertEqual(total(result, 'REMESSA'), D('100.02'))
        notes = [n for n in result['notas'] if n['linha_negocio'] == 'REMESSA']
        self.assertEqual(len(notes), 1, 'A Ponte recebe NF única, independente do cliente final')
        self.assertEqual(D(notes[0]['valor_brl']), D('100.02'))

    def test_negative_spread_is_excluded_and_asks_for_review(self):
        data = fixture()
        data['rates'] = [rate(product='REMESSA')]
        data['remittances'] = [remittance('NEGATIVE', '-10.00')]
        result = calculate(data)
        self.assertEqual(total(result, 'REMESSA'), D('0'))
        self.assertFalse(result['notas'])
        self.assertTrue(issues_for(result, 'NEGATIVE'))

    def test_exact_duplicate_remittance_contributes_once(self):
        data = fixture()
        data['rates'] = [rate(product='REMESSA')]
        row = remittance('DUPLICATE', '100.00')
        data['remittances'] = [row, deepcopy(row)]
        result = calculate(data)
        self.assertEqual(total(result, 'REMESSA'), D('50.00'))
        self.assertTrue(issues_for(result, 'DUPLICATE'))

    def test_conflicting_duplicate_cannot_choose_a_value(self):
        data = fixture()
        data['rates'] = [rate(product='REMESSA')]
        data['remittances'] = [remittance('CONFLICT', '100.00'), remittance('CONFLICT', '200.00')]
        result = calculate(data)
        self.assertEqual(total(result, 'REMESSA'), D('0'))
        self.assertTrue(issues_for(result, 'CONFLICT'))

    def test_tolerance_is_percentage_points_not_currency(self):
        data = fixture()
        data['rates'] = [rate(product='REMESSA')]
        # A tiny percentage difference on a huge base stays below the pp tolerance.
        data['remittances'] = [remittance('ROUNDING', '200100.00', '2.001',
                                         foreign_amount='2000000.00', gross_brl='10200100.00'),
                               remittance('REAL-DIFF', '0.21', '2.10', foreign_amount='2.00',
                                          gross_brl='10.21')]
        result = calculate(data, {'period': '2026-09', 'remittance_tolerance_pp': '0.002'})
        refs = {d['ref_origem'] for d in result['divergencias']}
        self.assertNotIn('ROUNDING', refs)
        self.assertIn('REAL-DIFF', refs)
        self.assertTrue(issues_for(result, 'REAL-DIFF'))

    def test_non_finite_checkout_is_a_pending_item(self):
        for field in ('gross', 'applied_rate_pct', 'reported_fee', 'net'):
            with self.subTest(field=field):
                data = fixture()
                data['rates'] = [rate()]
                row = checkout('NON-FINITE')
                row[field] = 'NaN'
                data['checkout'] = [row]
                result = calculate(data)
                self.assertEqual(total(result, 'CHECKOUT'), D('0'))
                self.assertTrue(issues_for(result, 'NON-FINITE'))

    def test_non_finite_duplicate_evidence_does_not_crash_close(self):
        data = fixture()
        data['rates'] = [rate()]
        row = checkout('BAD-DUPLICATE', reported_fee='NaN')
        data['checkout'] = [row, deepcopy(row)]
        result = calculate(data)
        self.assertEqual(total(result, 'CHECKOUT'), D('0'))
        self.assertTrue(issues_for(result, 'BAD-DUPLICATE'))

    def test_inconsistent_checkout_amounts_are_not_automatically_invoiced(self):
        data = fixture()
        data['rates'] = [rate()]
        data['checkout'] = [checkout('BAD-NET', reported_fee='2.00', net='99.00')]
        result = calculate(data)
        self.assertEqual(total(result, 'CHECKOUT'), D('0'))
        self.assertTrue(issues_for(result, 'BAD-NET'))

    def test_sign_incompatible_with_operation_type_is_pending(self):
        for kind, gross in (('VENDA', '-100.00'), ('ANTECIPACAO', '-100.00'), ('ESTORNO', '100.00')):
            with self.subTest(kind=kind):
                data = fixture()
                data['rates'] = [rate(), rate('advance', product='ANTECIPACAO')]
                data['checkout'] = [checkout('BAD-SIGN', gross, type=kind,
                                             original_date='2026-08-21', original_id='AUGUST')]
                result = calculate(data)
                self.assertEqual(total(result, 'CHECKOUT'), D('0'))
                self.assertTrue(issues_for(result, 'BAD-SIGN'))

    def test_reversal_conflicting_original_date_is_not_silently_overridden(self):
        data = fixture()
        data['rates'] = [rate('advance', '2.10', product='ANTECIPACAO')]
        data['checkout'] = [checkout('ORIGINAL', '1000.00', date='2026-09-10', type='ANTECIPACAO', applied='2.10'),
                            checkout('BAD-DATE', '-1000.00', type='REVERSAO ANTECIPACAO', applied='2.10',
                                     original_id='ORIGINAL', original_date='2026-09-11')]
        result = calculate(data)
        self.assertEqual(total(result, 'CHECKOUT'), D('21.00'))
        self.assertTrue(issues_for(result, 'BAD-DATE'))

    def test_different_period_does_not_reuse_september_transactions(self):
        data = fixture()
        data['rates'] = [rate(), rate('rem', product='REMESSA')]
        data['checkout'] = [checkout()]
        data['remittances'] = [remittance()]
        result = calculate(data, {'period': '2026-10'})
        self.assertEqual(total(result, 'CHECKOUT'), D('0'))
        self.assertEqual(total(result, 'REMESSA'), D('0'))


class OfficialCaseRegression(unittest.TestCase):
    @classmethod
    def setUpClass(cls):
        cls.data = load_data(PACK)
        cls.result = calculate(cls.data)

    def test_imports_original_source_formats_without_mutation(self):
        before = {p.name: hashlib.sha256(p.read_bytes()).hexdigest()
                  for p in PACK.iterdir() if p.is_file()}
        loaded = load_data(PACK)
        after = {p.name: hashlib.sha256(p.read_bytes()).hexdigest()
                 for p in PACK.iterdir() if p.is_file()}
        self.assertEqual(before, after)
        self.assertEqual(len(loaded['checkout']), 1943)
        self.assertEqual(len(loaded['remittances']), 233, 'XLSX extraído do EML sem limpeza manual')
        self.assertEqual(len(loaded['bank']), 184)
        self.assertEqual(sum(r['bank'] == 'AURORA' for r in loaded['bank']), 84)
        self.assertEqual(sum(r['bank'] == 'MERIDIANO' for r in loaded['bank']), 100)
        self.assertEqual({r['bank'] for r in loaded['bank']}, {'AURORA', 'MERIDIANO'})
        self.assertTrue(all(s['sha256'] for s in loaded['sources']))

    def test_empty_month_has_only_current_month_issue_not_prior_duplicates(self):
        result = calculate(deepcopy(self.data), {'period': '2026-10'})
        self.assertFalse(result['comissoes'])
        self.assertFalse(result['notas'])
        self.assertFalse(result['divergencias'])
        self.assertFalse(result['lancamentos'])
        self.assertEqual(len(result['pendencias']), 1)
        issue = result['pendencias'][0]
        self.assertEqual(issue['tipo'], 'COMPETENCIA_SEM_MOVIMENTOS')
        self.assertEqual(issue['ref_origem'], '2026-10')
        self.assertEqual(issue['severity'], 'bloqueante')
        self.assertEqual(issue['valor_brl'], '0.00')
        self.assertTrue(all(r['ref_origem'] == '2026-10' for r in result['rastro']))

    def test_casa_zero_contract_still_reports_orbe_charges_for_refund(self):
        rows = [r for r in self.result['divergencias'] if r['cnpj'] == '00520815000100'
                and r['linha_negocio'] == 'CHECKOUT']
        self.assertEqual(len(rows), 118)
        self.assertEqual(sum((D(r['diferenca_brl']) for r in rows), D('0')), D('15397.42'))
        self.assertTrue(all(D(r['taxa_contratada_pct']) == 0 for r in rows))
        self.assertNotIn('TX88445133', {r['ref_origem'] for r in rows})
        self.assertTrue(all(issues_for(self.result, r['ref_origem']) for r in rows))

    def test_official_business_totals(self):
        self.assertEqual(total(self.result, 'CHECKOUT'), D('207039.73'))
        self.assertEqual(total(self.result, 'REMESSA'), D('39543.45'))

    def test_rota_and_bridge_rate_discrepancies(self):
        expected = {'95927868000148': D('1546.28'), '22224579000109': D('29.95')}
        for cnpj, amount in expected.items():
            with self.subTest(cnpj=cnpj):
                actual = sum((D(r['diferenca_brl']) for r in self.result['divergencias']
                              if r['cnpj'] == cnpj and r['linha_negocio'] == 'CHECKOUT'), D('0'))
                self.assertEqual(actual, amount)

    def test_casa_is_not_retroactively_exempted_for_august_refund(self):
        rows = [r for r in self.result['comissoes'] if r['cnpj'] == '00520815000100'
                and r['linha_negocio'] == 'CHECKOUT']
        self.assertEqual(sum((D(r['comissao_brl']) for r in rows), D('0')), D('-5.50'))
        self.assertFalse([n for n in self.result['notas'] if n['tomador_cnpj'] == '00520815000100'])
        traces = [r for r in self.result['rastro'] if r['ref_origem'] == 'TX88445133'
                  and r['id_saida'] in {c['id_saida'] for c in rows}]
        self.assertEqual(sum((D(r['valor']) for r in traces), D('0')), D('-5.50'))

    def test_atlas_57_lines_are_blocked_until_human_identity_validation(self):
        atlas = [r for r in self.data['checkout'] if 'ATLAS' in r['name'].upper()]
        self.assertEqual(len(atlas), 57)
        self.assertFalse([n for n in self.result['notas'] if n['tomador_cnpj'] == '39566044000119'])
        refs = {str(p['ref_origem']) for p in self.result['pendencias']}
        self.assertTrue(all(r['id'] in refs for r in atlas))

    def test_every_output_amount_reconciles_to_its_source_trace(self):
        traces = defaultdict(lambda: D('0'))
        for row in self.result['rastro']:
            self.assertTrue(row['arquivo_origem'])
            self.assertTrue(row['ref_origem'])
            traces[row['id_saida']] += D(row['valor'])
        for table, money in [('comissoes', 'comissao_brl'), ('divergencias', 'diferenca_brl'),
                             ('notas', 'valor_brl'), ('lancamentos', 'valor'),
                             ('pendencias', 'valor_brl')]:
            ids = [r['id_saida'] for r in self.result[table]]
            self.assertEqual(len(ids), len(set(ids)), f'IDs duplicados em {table}')
            for row in self.result[table]:
                with self.subTest(table=table, id=row['id_saida']):
                    self.assertIn(row['id_saida'], traces)
                    self.assertEqual(traces[row['id_saida']], D(row[money]))

    def test_repeated_execution_is_identical(self):
        self.assertEqual(self.result, calculate(deepcopy(self.data)))

    def test_real_unidentified_credit_uses_transit_and_stays_pending(self):
        credit = next(r for r in self.result['lancamentos'] if 'SEM IDENTIFICACAO' in r['descricao'])
        self.assertEqual(credit['conta_codigo'], '1.1.09.002')
        self.assertEqual(D(credit['valor']), D('7350.00'))
        self.assertTrue(issues_for(self.result, credit['ref_origem']))

    def test_unknown_bank_description_requires_human_classification(self):
        data = fixture()
        data['accounts'] = deepcopy(self.data['accounts'])
        data['bank'] = [{'id': 'UNKNOWN-BANK', 'bank': 'AURORA', 'ref_origem': 'L2',
                         'date': '2026-09-01', 'description': 'LANÇAMENTO NOVO SEM REGRA',
                         'amount': '42.00', 'source_file': 'banco.csv', 'physical_row': 2}]
        result = calculate(data)
        self.assertEqual(result['lancamentos'][0]['conta_codigo'], '')
        self.assertTrue(issues_for(result, 'L2'))


class ImportFailureReporting(unittest.TestCase):
    def test_malformed_source_row_is_reported_with_physical_line(self):
        import csv
        from io import StringIO
        source = PACK / '01_orbe_relatorio_comissoes_set2026.csv'
        rows = list(csv.reader(StringIO(source.read_text(encoding='utf-8-sig')), delimiter=';'))
        gross_column = rows[0].index('valor_bruto')
        rows[1][gross_column] = 'VALOR INVÁLIDO'
        with tempfile.TemporaryDirectory(prefix='tarvo-invalid-source-') as folder:
            target = Path(folder) / source.name
            with target.open('w', newline='', encoding='utf-8') as output:
                writer = csv.writer(output, delimiter=';')
                writer.writerows(rows)
            result = load_data(folder)
            self.assertEqual(len(result['checkout']), 1942)
            warnings = [w for w in result['import_warnings'] if w['type'] == 'LINHA_INVALIDA']
            self.assertEqual(len(warnings), 1)
            self.assertEqual(warnings[0]['source_ref'], 'L2')
            calculated = calculate(result)
            self.assertTrue(any(p['tipo'] == 'LINHA_INVALIDA' for p in calculated['pendencias']))

    def test_non_finite_import_values_are_reported_as_invalid_rows(self):
        import csv
        header = ['id_transacao','data_movimento','cod_estabelecimento','nome_estabelecimento',
                  'tipo_lancamento','modalidade','qtd_parcelas','bandeira','valor_bruto',
                  'taxa_aplicada_pct','valor_taxa','valor_liquido','id_referencia','data_venda_original']
        with tempfile.TemporaryDirectory(prefix='tarvo-non-finite-') as folder:
            target = Path(folder) / '01_orbe_relatorio_comissoes_test.csv'
            for value in ('NaN', 'Infinity', '-Infinity'):
                with self.subTest(value=value):
                    with target.open('w', newline='', encoding='utf-8') as output:
                        writer = csv.writer(output, delimiter=';')
                        writer.writerow(header)
                        writer.writerow(['T1','01/09/2026',EC,'BRIDGE','VENDA','CREDITO A VISTA',
                                         '1','VISA',value,'2,00','2,00','98,00','',''])
                    result = load_data(folder)
                    self.assertFalse(result['checkout'])
                    self.assertTrue(any(w['type'] == 'LINHA_INVALIDA' and w['source_ref'] == 'L2'
                                        for w in result['import_warnings']))

    def test_missing_sources_are_reported_instead_of_inventing_empty_success(self):
        with tempfile.TemporaryDirectory(prefix='tarvo-missing-source-') as folder:
            result = load_data(folder)
            self.assertEqual(len(result['import_warnings']), 6)
            self.assertTrue(all(w['type'] == 'ARQUIVO_AUSENTE' for w in result['import_warnings']))
            self.assertFalse(result['checkout'])
            self.assertFalse(result['remittances'])


if __name__ == '__main__':
    unittest.main()
