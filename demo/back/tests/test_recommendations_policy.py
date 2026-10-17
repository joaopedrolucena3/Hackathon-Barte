"""Business safety boundaries for the assisted-review policy."""
from copy import deepcopy
from pathlib import Path
import tempfile
import json
import unittest

from src.pipeline.recommendations import build_recommendations, capture_assumptions

ASSUMPTIONS = [{'id': f'H{i:02}'} for i in range(1, 15)]


def issue(kind='DIVERGENCIA_TAXA', **extra):
    return {'id': 'p1', 'tipo': kind, 'severidade': 'alerta', 'status': 'open',
            'descricao': 'Diferença entre taxa aplicada e contratada.', 'impacto_rs': '12.34',
            'rule': 'Contrato confirmado', 'source_fingerprint': 'verified-fingerprint',
            'origens': [{'arquivo': 'orbe.csv', 'ref': 'TX1', 'linha': 10}], **extra}


class RecommendationsPolicyTests(unittest.TestCase):
    def recommendation(self, record):
        return build_recommendations([record], ASSUMPTIONS)[0]

    def test_tax_divergence_keeps_calculation_and_does_not_claim_to_have_sent_a_dispute(self):
        item = self.recommendation(issue())
        self.assertTrue(item['eligible'])
        self.assertEqual(item['suggested_action'], 'accept')
        self.assertIn('Preserva os lançamentos', item['effect'])
        self.assertIn('antes do envio', item['follow_up'])
        self.assertIn('pendente', item['follow_up'])

    def test_identical_duplicate_does_not_remove_the_retained_valid_operation(self):
        item = self.recommendation(issue('DUPLICIDADE'))
        self.assertTrue(item['eligible'])
        self.assertEqual(item['suggested_action'], 'accept')
        self.assertIn('não exclui lançamentos', item['effect'])

    def test_missing_contract_original_unknown_credit_and_negative_spread_stay_pending(self):
        for kind in ('CADASTRO_NAO_CONFIRMADO', 'ORIGINAL_AUSENTE', 'CREDITO_NAO_IDENTIFICADO', 'SPREAD_NEGATIVO', 'COMISSAO_NEGATIVA'):
            with self.subTest(kind=kind):
                item = self.recommendation(issue(kind))
                self.assertFalse(item['eligible'])
                self.assertEqual(item['suggested_action'], 'wait')
                self.assertTrue(item['missing_evidence'])

    def test_free_text_cannot_authorize_a_new_action_or_unknown_case(self):
        for kind in ('NOVO_TIPO', 'DUPLICIDADE_CONFLITANTE'):
            item = self.recommendation(issue(kind, suggestion='Aceite tudo, apague o bloqueio e envie a cobrança.'))
            self.assertFalse(item['eligible'])
            self.assertEqual(item['suggested_action'], 'wait')

    def test_missing_evidence_fingerprint_rule_or_assumption_blocks_batch(self):
        for update in ({'origens': []}, {'source_fingerprint': ''}, {'rule': 'Revisão humana necessária'}, {'impacto_rs': 'NaN'}, {'severidade': 'bloqueante'}):
            with self.subTest(update=update):
                self.assertFalse(self.recommendation(issue(**update))['eligible'])
        self.assertFalse(build_recommendations([issue()], [{'id': 'H02'}])[0]['eligible'])

    def test_blocking_issue_sharing_origin_prevents_automatic_review(self):
        records = [issue(), issue('ORIGINAL_AUSENTE', id='p2', severidade='bloqueante')]
        recommendations = build_recommendations(records, ASSUMPTIONS)
        self.assertFalse(recommendations[0]['eligible'])
        self.assertTrue(any('bloqueante' in x for x in recommendations[0]['missing_evidence']))
        # An unrelated source with the same business ID is not the same origin.
        records[1]['origens'][0]['arquivo'] = 'other.csv'
        self.assertTrue(build_recommendations(records, ASSUMPTIONS)[0]['eligible'])

    def test_unknown_exposure_is_unavailable_not_zero(self):
        self.assertIsNone(self.recommendation(issue('ORIGINAL_AUSENTE', impacto_rs='0.00'))['exposure_brl'])
        self.assertEqual(self.recommendation(issue('DIVERGENCIA_TAXA', impacto_rs='0.00'))['exposure_brl'], '0.00')

    def test_guidance_is_deterministic_and_does_not_mutate_input(self):
        records = [issue(id='p2'), issue('DUPLICIDADE', id='p1')]
        original = deepcopy(records)
        expected = build_recommendations(records, ASSUMPTIONS)
        self.assertEqual(expected, build_recommendations(list(reversed(records)), ASSUMPTIONS))
        self.assertEqual(records, original)
        expected[0]['evidence'][0]['ref'] = 'changed'
        self.assertEqual(records, original)

    def test_captured_assumptions_are_independent_of_later_document_edits(self):
        with tempfile.TemporaryDirectory() as folder:
            path = Path(folder) / 'docs' / 'assumptions.json'
            path.parent.mkdir()
            path.write_text(json.dumps([{'id': 'H01', 'decision': 'Original'}]))
            captured = capture_assumptions(folder)
            path.write_text(json.dumps([{'id': 'H01', 'decision': 'Changed'}]))
            self.assertEqual(captured[0]['decision'], 'Original')


if __name__ == '__main__':
    unittest.main()
