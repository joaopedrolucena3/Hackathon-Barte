"""Integração do fluxo humano, persistência, exportações e e-mail em simulação."""
import csv
from io import BytesIO, StringIO
from pathlib import Path
import re
import shutil
import tempfile
import unittest
from zipfile import ZipFile

from src.store import Store

ROOT = Path(__file__).resolve().parents[1]
PACK = ROOT / 'data' / 'case'
ACTOR = 'Analista de teste'


class WorkflowSafety(unittest.TestCase):
    def setUp(self):
        self.tmp = tempfile.TemporaryDirectory(prefix='tarvo-quality-')
        self.db_path = Path(self.tmp.name) / 'test.sqlite3'
        self.store = Store(self.db_path, PACK)

    def tearDown(self):
        self.store.close_db()
        self.tmp.cleanup()

    def act(self, endpoint, **fields):
        return self.store.mutate(endpoint, {'actor': ACTOR, **fields})

    def issue(self):
        return self.store.state()['results']['pendencias'][0]

    def draft(self, kind='billing'):
        if kind == 'billing':
            invoice = self.store.state()['results']['notas'][0]
            payload = {'invoice_id': invoice['id_saida']}
        elif kind == 'dispute':
            payload = {'issue_id': self.issue()['id_saida']}
        else:
            payload = {'report': True}
        email = self.act('emails/draft', **payload)['email']
        return self.act('emails/save', id=email['id'], to='review@example.invalid',
                        subject=email['subject'], body=email['body'])['email']

    def contact(self, **changes):
        payload = {'name': 'Teste interno', 'email': 'internal@example.invalid', 'kind': 'internal',
                   'cnpj': '', 'min_severity': 'bloqueante', 'frequency': 'digest', 'enabled': True}
        payload.update(changes)
        self.act('contacts', **payload)

    def test_actor_is_required_for_every_change(self):
        for action in ('recalculate', 'close', 'decisions', 'rates', 'merchants', 'parameters',
                       'contacts', 'import', 'emails/draft', 'emails/approve', 'emails/send'):
            with self.subTest(action=action):
                with self.assertRaises(ValueError):
                    self.store.mutate(action, {})

    def test_pending_issues_block_closing_without_explicit_waiver_and_reason(self):
        self.assertGreater(self.store.state()['summary']['open_issues'], 0)
        for fields in ({}, {'allow_open': True}, {'allow_open': 'true', 'reason': 'revisado'}):
            with self.subTest(fields=fields):
                with self.assertRaises(ValueError):
                    self.act('close', **fields)
        self.assertEqual(self.store.state()['closing']['status'], 'open')
        self.act('close', allow_open=True, reason='Demo: aceite explícito de todas as ressalvas')
        closing = self.store.state()['closing']
        self.assertEqual(closing['status'], 'closed')
        self.assertTrue(closing['waiver'])
        self.assertEqual(closing['actor'], ACTOR)
        self.assertTrue(closing['open_issue_ids'])

    def test_reject_keeps_issue_open_and_decision_has_actor_time_and_reason(self):
        issue = self.issue()
        before = self.store.state()['summary']['open_issues']
        self.act('decisions', id=issue['id_saida'], action='reject', note='Regra contestada pelo analista')
        state = self.store.state()
        row = next(p for p in state['results']['pendencias'] if p['id_saida'] == issue['id_saida'])
        self.assertEqual(row['status'], 'rejected')
        self.assertEqual(state['summary']['open_issues'], before)
        self.assertEqual(row['decision']['actor'], ACTOR)
        self.assertEqual(row['decision']['note'], 'Regra contestada pelo analista')
        self.assertTrue(row['decision']['at'])

    def test_confirmed_decision_survives_reopen_database_and_identical_recalculation(self):
        issue = self.issue()
        self.act('decisions', id=issue['id_saida'], action='confirm', note='Encaminhado para financeiro')
        self.store.close_db()
        self.store = Store(self.db_path, PACK)
        self.act('recalculate', period='2026-09')
        saved = next(p for p in self.store.state()['results']['pendencias'] if p['id_saida'] == issue['id_saida'])
        self.assertEqual(saved['status'], 'resolved')
        self.assertEqual(saved['decision']['actor'], ACTOR)

    def test_changed_raw_evidence_invalidates_decision_with_same_id_type_and_value(self):
        issue = next(p for p in self.store.state()['results']['pendencias']
                     if p['tipo'] == 'DIVERGENCIA_TAXA' and p['ref_origem'].startswith('TX'))
        self.act('decisions', id=issue['id_saida'], action='confirm', note='Confirmada a evidência original')
        accepted = next(p for p in self.store.state()['results']['pendencias'] if p['id_saida'] == issue['id_saida'])
        self.assertEqual(accepted['status'], 'resolved')
        copied = Path(self.tmp.name) / 'reimported'
        copied.mkdir()
        for source in PACK.iterdir():
            if source.is_file() and source.name[:2] in ('01', '02', '03', '04', '05'):
                shutil.copy2(source, copied / source.name)
        checkout_file = copied / '01_orbe_relatorio_comissoes_set2026.csv'
        with checkout_file.open(newline='', encoding='utf-8-sig') as source:
            reader = csv.DictReader(source, delimiter=';')
            fields = reader.fieldnames
            rows = list(reader)
        changed = next(r for r in rows if r['id_transacao'] == issue['ref_origem'])
        changed['nome_estabelecimento'] += ' (EVIDÊNCIA REVISADA)'
        with checkout_file.open('w', newline='', encoding='utf-8') as output:
            writer = csv.DictWriter(output, fields, delimiter=';')
            writer.writeheader()
            writer.writerows(rows)
        self.act('import', source_dir=str(copied), period='2026-09')
        reopened = next(p for p in self.store.state()['results']['pendencias'] if p['id_saida'] == issue['id_saida'])
        self.assertEqual(reopened['tipo'], issue['tipo'])
        self.assertEqual(reopened['valor_brl'], issue['valor_brl'])
        self.assertNotEqual(reopened['source_fingerprint'], issue['source_fingerprint'])
        self.assertEqual(reopened['status'], 'open')
        self.assertIsNone(reopened['decision'])

    def test_trace_details_are_scoped_to_output_and_include_original_input(self):
        state = self.store.state()
        commission = next(c for c in state['results']['comissoes'] if c['linha_negocio'] == 'CHECKOUT')
        ident = commission['id_saida']
        trace = self.store.trace(ident)
        self.assertTrue(trace['rows'])
        self.assertTrue(trace['details'])
        self.assertTrue(all(r['id_saida'] == ident for r in trace['rows']))
        self.assertTrue(all(d['id_saida'] == ident for d in trace['details']))
        self.assertEqual(len(trace['rows']), len(trace['details']))
        for detail in trace['details']:
            original = detail['entrada']
            self.assertEqual(original['id'], detail['ref_origem'])
            self.assertTrue({'gross', 'applied_rate_pct', 'reported_fee', 'net', 'date', 'type'}.issubset(original))
            self.assertTrue(detail['formula'])
            self.assertTrue(detail['regra'])
        # The same transaction also contributes to invoices/issues; those details must stay out.
        refs = {r['ref_origem'] for r in trace['rows']}
        self.assertTrue(any(d['ref_origem'] in refs and d['id_saida'] != ident
                            for d in state['results']['details']))
        self.assertEqual(self.store.trace('ID-INEXISTENTE'), {'rows': [], 'details': []})

    def test_recalculation_reopens_a_closed_month(self):
        self.act('close', allow_open=True, reason='Exceções aceitas para teste')
        self.act('recalculate', period='2026-09')
        self.assertEqual(self.store.state()['closing']['status'], 'open')

    def test_new_overlapping_rate_is_rejected_without_partial_mutation(self):
        before = self.store.state()['rates']
        existing = next(r for r in before if r['start'] and not r.get('end'))
        with self.assertRaises(ValueError):
            self.act('rates', cnpj=existing['cnpj'], product=existing['product'],
                     start='2026-09-01', end='', rate_pct='9', reason='Contrato concorrente')
        self.assertEqual(self.store.state()['rates'], before)

    def test_reference_edit_reopens_and_preserves_audit_history(self):
        rate = next(r for r in self.store.state()['rates'] if r['start'] and not r.get('end'))
        self.act('close', allow_open=True, reason='Exceções aceitas para teste')
        self.act('rates', id=rate['id'], cnpj=rate['cnpj'], product=rate['product'],
                 start=rate['start'], end=rate.get('end', ''), rate_pct='1.01', reason='Contrato revisado pelo teste')
        state = self.store.state()
        self.assertEqual(state['closing']['status'], 'open')
        audit = next(a for a in state['audit'] if a['action'] == 'rate_edit')
        self.assertEqual(audit['actor'], ACTOR)
        self.assertEqual(audit['detail']['before']['rate_pct'], rate['rate_pct'])
        self.assertEqual(audit['detail']['after']['rate_pct'], '1.01')

    def test_invalid_numeric_parameter_never_replaces_previous_configuration(self):
        before = self.store.state()['parameters']
        for invalid in ('NaN', 'Infinity', '-0.01', '1.00', 'texto'):
            with self.subTest(invalid=invalid):
                with self.assertRaises(ValueError):
                    self.act('parameters', remittance_tolerance_pp=invalid, reason='teste de validação')
        self.assertEqual(self.store.state()['parameters'], before)

    def test_duplicate_establishment_cannot_be_assigned_to_another_merchant(self):
        merchants = [m for m in self.store.state()['merchants'] if m.get('ec')]
        first, second = merchants[:2]
        with self.assertRaises(ValueError):
            self.act('merchants', cnpj=second['cnpj'], name=second['name'], ec=first['ec'],
                     active=True, reason='Cadastro em conflito')

    def test_billing_and_dispute_cannot_send_without_approval(self):
        for kind in ('billing', 'dispute'):
            with self.subTest(kind=kind):
                email = self.draft(kind)
                with self.assertRaises(ValueError):
                    self.act('emails/send', id=email['id'])
                saved = next(e for e in self.store.state()['emails'] if e['id'] == email['id'])
                self.assertEqual(saved['status'], 'draft')
                self.assertIsNone(saved['sent_at'])

    def test_approval_then_edit_invalidates_permission(self):
        email = self.draft()
        self.act('emails/approve', id=email['id'])
        self.act('emails/save', id=email['id'], to=email['to'], subject=email['subject'],
                 body=email['body'] + '\nConteúdo alterado após aprovação.')
        with self.assertRaises(ValueError):
            self.act('emails/send', id=email['id'])
        saved = next(e for e in self.store.state()['emails'] if e['id'] == email['id'])
        self.assertIsNone(saved['approved_by'])

    def test_simulated_send_records_exact_content_and_approver_and_prevents_double_send(self):
        email = self.draft()
        self.act('emails/approve', id=email['id'])
        sent = self.act('emails/send', id=email['id'])['email']
        self.assertEqual(sent['status'], 'simulated')
        self.assertEqual(sent['mode'], 'simulation')
        self.assertEqual(sent['approved_by'], ACTOR)
        self.assertEqual(sent['body'], email['body'])
        self.assertEqual(sent['to'], email['to'])
        self.assertTrue(sent['approved_at'])
        self.assertTrue(sent['sent_at'])
        with self.assertRaises(ValueError):
            self.act('emails/send', id=email['id'])

    def test_changed_calculation_requires_fresh_email_even_if_old_content_is_saved(self):
        email = self.draft()
        self.act('emails/approve', id=email['id'])
        self.act('recalculate', period='2026-10')
        self.act('emails/save', id=email['id'], to=email['to'], subject=email['subject'], body=email['body'])
        with self.assertRaises(ValueError):
            self.act('emails/approve', id=email['id'])
        with self.assertRaises(ValueError):
            self.act('emails/send', id=email['id'])

    def test_internal_report_can_be_simulated_without_billing_approval(self):
        email = self.draft('internal')
        sent = self.act('emails/send', id=email['id'])['email']
        self.assertEqual(sent['kind'], 'internal')
        self.assertEqual(sent['status'], 'simulated')
        self.assertIsNone(sent['approved_by'])

    def test_digest_respects_severity_and_is_not_resent(self):
        self.contact()
        self.assertFalse(self.store.state()['emails'], 'Resumo deve aguardar o processamento')
        self.act('notifications/run')
        state = self.store.state()
        mails = state['emails']
        self.assertEqual(len(mails), 1)
        self.assertEqual(mails[0]['kind'], 'internal')
        self.assertEqual(mails[0]['status'], 'simulated')
        self.assertIn('http://127.0.0.1:8765', mails[0]['body'])
        delivered = [n for n in state['notifications'] if n['deliveries']]
        self.assertTrue(delivered)
        self.assertTrue(all(n['severity'] == 'bloqueante' for n in delivered))
        self.act('notifications/run')
        self.assertEqual(len(self.store.state()['emails']), 1)

    def test_disabled_contact_receives_no_internal_notification(self):
        self.contact(frequency='immediate', enabled=False)
        self.act('notifications/run')
        self.assertFalse(self.store.state()['emails'])

    def test_bank_adjustment_rejects_synthetic_account_and_applies_analytic_account(self):
        state = self.store.state()
        bank = next(r for r in state['results']['lancamentos'] if 'SEM IDENTIFICACAO' in r['descricao'])
        issue = next(p for p in state['results']['pendencias'] if p['ref_origem'] == bank['ref_origem'])
        synthetic = next(a for a in state['accounts'] if not a['postable'])
        with self.assertRaises(ValueError):
            self.act('decisions', id=issue['id_saida'], action='adjust', account_code=synthetic['code'], note='Revisão da conta')
        analytic = next(a for a in state['accounts'] if a['postable'])
        self.act('decisions', id=issue['id_saida'], action='adjust', account_code=analytic['code'], note='Classificação confirmada por evidência externa')
        updated = next(r for r in self.store.state()['results']['lancamentos'] if r['id_saida'] == bank['id_saida'])
        self.assertEqual(updated['conta_codigo'], analytic['code'])
        self.assertEqual(updated['conta_descricao'], analytic['name'])
        self.assertEqual(updated['metodo'], 'HUMANO')

    def test_import_failure_rolls_back_current_period_and_reference_data(self):
        before = self.store.state()
        with self.assertRaises(ValueError):
            self.act('import', source_dir=self.tmp.name, period='2026-10')
        after = self.store.state()
        self.assertEqual(after['period'], before['period'])
        self.assertEqual(after['summary'], before['summary'])
        self.assertEqual(after['sources'], before['sources'])

    def test_six_official_csv_headers_and_export_zip(self):
        expected = {
            'comissoes_por_lojista.csv': ['id_saida','cnpj','lojista','linha_negocio','comissao_brl'],
            'divergencias_taxa.csv': ['id_saida','cnpj','linha_negocio','ref_origem','taxa_contratada_pct','taxa_aplicada_pct','diferenca_brl'],
            'notas_a_emitir.csv': ['id_saida','tomador_cnpj','tomador','linha_negocio','valor_brl','discriminacao'],
            'lancamentos_classificados.csv': ['id_saida','banco','ref_origem','data','descricao','valor','conta_codigo','metodo','confianca'],
            'pendencias.csv': ['id_saida','tipo','ref_origem','valor_brl','motivo','quem_decide'],
            'rastro.csv': ['id_saida','arquivo_origem','ref_origem','valor'],
        }
        for name, fields in expected.items():
            with self.subTest(file=name):
                rows = list(csv.reader(StringIO(self.store.export_csv(name).decode('utf-8')), delimiter=';'))
                self.assertEqual(rows[0][:len(fields)], fields)
                self.assertGreater(len(rows), 1)
        with ZipFile(BytesIO(self.store.export_zip())) as archive:
            self.assertTrue(set(expected).issubset(archive.namelist()))
            self.assertIn('relatorio.html', archive.namelist())
            self.assertIn('HIPOTESES.md', archive.namelist())
        self.assertTrue(self.store.state()['validation']['trace_ok'])


if __name__ == '__main__':
    unittest.main()
