"""Chat HTTP contract over a real run of the pack, with a scripted model: status, SSE stream, validation,
and the golden questions' reference SQL against values computed in Python Decimal."""
import json
import tempfile
import time
import unittest
from decimal import Decimal
from pathlib import Path
from unittest import mock

from fastapi.testclient import TestClient

from src.api.app import create_app
from src.chat import agent
from src.store import ROOT
from chat_fakes import FakeAnthropic, answer, query_id, sql
from chat_golden import GOLDEN

HEADERS = {'X-User': 'Teste do chat'}


def events_of(response):
    events = []
    for chunk in response.text.split('\n\n'):
        lines = dict(line.split(': ', 1) for line in chunk.splitlines() if ': ' in line)
        if 'event' in lines: events.append({**json.loads(lines['data']), 'type': lines['event']})
    return events


class ChatHTTPTests(unittest.TestCase):
    @classmethod
    def setUpClass(cls):
        cls.temp = tempfile.TemporaryDirectory()
        base = Path(cls.temp.name)
        cls.fake = FakeAnthropic([])
        cls.app = create_app(base/'case.sqlite3', ROOT/'data'/'case', base/'runs', mail_private_dir=base/'private', chat_client=cls.fake)
        cls.client_context = TestClient(cls.app, base_url='http://127.0.0.1')
        cls.client = cls.client_context.__enter__()
        response = cls.client.post('/api/runs', headers={'X-User': 'Teste do chat'}, json={'pipeline_id': 'fechamento-tarvo', 'competencia': '2026-09'})
        assert response.status_code == 202, response.text
        cls.run_id = response.json()['run_id']
        until = time.monotonic() + 60
        while time.monotonic() < until:
            state = cls.client.get('/api/runs/' + cls.run_id).json()
            if state['status'] in ('awaiting_approval', 'failed'): break
            time.sleep(.05)
        assert state['status'] == 'awaiting_approval', state.get('error')

    @classmethod
    def tearDownClass(cls):
        cls.client_context.__exit__(None, None, None)
        cls.temp.cleanup()

    def ask(self, body, headers=HEADERS):
        payload = {'pergunta': 'Qual o bruto do passo?', 'step_id': 's5', 'dataset': 'checkout_calculado', **body}
        return self.client.post(f'/api/runs/{self.run_id}/chat', headers=headers, json=payload)

    def test_status_brings_suggestions_and_availability(self):
        status = self.client.get(f'/api/runs/{self.run_id}/chat').json()
        self.assertTrue(status['disponivel'])
        self.assertEqual(status['modelo'], 'claude-opus-5-5')
        self.assertIn('conferir_mdr', status['sugestoes']['por_passo'])
        self.assertEqual(self.client.get('/api/runs/run-inexistente/chat').status_code, 404)

    def test_question_streams_stages_queries_and_a_verified_answer(self):
        self.fake.script = [
            [sql('SELECT SUM(gross) AS bruto, COUNT(*) AS linhas FROM checkout_calculado', 'Bruto do passo')],
            lambda params, results: [answer(f'O bruto do passo 5 é {{{query_id(results)}.bruto:brl}} em {{{query_id(results)}.linhas:int}} linhas.',
                linhas={'dataset': 'checkout_calculado', 'filtro_sql': '', 'rotulo': 'Todas as linhas'},
                verificacao={'consulta': query_id(results), 'coluna': 'bruto', 'linha': None, 'dataset': 'checkout_calculado', 'coluna_base': 'gross',
                             'agregacao': 'soma', 'filtro_sql': None})],
        ]
        response = self.ask({'contexto': {'filters': [{'column': 'brand', 'op': 'eq', 'value': 'ELO'}], 'view': {'total': 1943, 'shown': 343}, 'view_rids': [0, 1]}})
        self.assertEqual(response.status_code, 200, response.text)
        self.assertTrue(response.headers['content-type'].startswith('text/event-stream'))
        events = events_of(response)
        self.assertEqual([event['type'] for event in events], ['thread', 'stage', 'query', 'answer', 'done'])
        result = events[3]['answer']
        self.assertEqual(''.join(segment['v'] for segment in result['segmentos']), 'O bruto do passo 5 é R$ 7.496.228,56 em 1.943 linhas.')
        self.assertEqual(result['selo']['status'], 'ok')
        self.assertEqual([check['tipo'] for check in result['selo']['checks']], ['recalculo', 'total_controle'])
        self.assertEqual((result['linhas']['total'], result['autor']), (1943, 'Teste do chat'))
        prompt = self.fake.requests[-2]['messages'][0]['content'][0]['text']
        self.assertIn('Filtros na tela: Bandeira igual a “ELO”.', prompt)
        self.assertIn('Linhas visíveis: 343 de 1943', prompt)
        saved = self.client.get(f'/api/runs/{self.run_id}/chat').json()['conversas']
        self.assertEqual(saved[0]['id'], result['thread_id'])

    def test_requests_are_validated_before_streaming(self):
        self.fake.script = []
        calls = len(self.fake.requests)
        self.assertEqual(self.ask({}, headers={}).json()['error']['code'], 'ACTOR_REQUIRED')
        self.assertEqual(self.ask({'dataset': 'inexistente'}).json()['error']['code'], 'INVALID_VALUE')
        self.assertEqual(self.ask({'thread_id': 'conv-inexistente'}).json()['error']['code'], 'THREAD_NOT_FOUND')
        self.assertEqual(self.ask({'extra': True}).json()['error']['code'], 'VALIDATION_ERROR')
        self.assertEqual(self.ask({'pergunta': '   '}).json()['error']['code'], 'EMPTY_QUESTION')
        chat = self.app.state.chat
        with mock.patch.object(chat, '_client', None), mock.patch.object(agent, 'credentials', return_value=(False, 'Não há credencial da Anthropic nesta máquina.')):
            refused = self.ask({})
            self.assertEqual((refused.status_code, refused.json()['error']['code']), (503, 'CHAT_UNAVAILABLE'))
            self.assertFalse(self.client.get(f'/api/runs/{self.run_id}/chat').json()['disponivel'])
        self.assertEqual(len(self.fake.requests), calls)

    def test_golden_reference_sql_matches_python_decimal(self):
        chat = self.app.state.chat
        sources = self.app.state.workflow.run_outputs(self.run_id)
        session = chat.engines.get(sources).session()
        try:
            for item in GOLDEN:
                expected = item['esperado'](sources['rows_of'])
                value = session.query(item['sql'])['rows'][0][0]
                obtained = value if item['estilo'] == 'texto' else Decimal(str(value))
                self.assertEqual(obtained, expected, item['id'])
        finally:
            session.close()
        self.assertEqual(len(GOLDEN), 10)


if __name__ == '__main__':
    unittest.main()
