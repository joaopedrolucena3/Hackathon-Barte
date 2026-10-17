"""Chat agent with a scripted client: markers, digit rule, seal, retries, request shape and threads."""
import json
import tempfile
import unittest
from pathlib import Path
from unittest import mock

from src.chat import agent
from src.chat.agent import ChatService, ChatUnavailable, fmt, stray_digits
from src.pipeline.service import ServiceError
from chat_fakes import FakeAnthropic, answer, note, query_id, sql, text
from test_chat_engine import sources

ELO = "SELECT SUM(gross) AS total, COUNT(*) AS linhas FROM mdr_conferido WHERE brand = 'ELO'"
ELO_CHECK = {'consulta': 'q1', 'coluna': 'total', 'linha': None, 'dataset': 'mdr_conferido', 'coluna_base': 'gross', 'agregacao': 'soma', 'filtro_sql': "brand = 'ELO'"}
ELO_ROWS = {'dataset': 'mdr_conferido', 'filtro_sql': "brand = 'ELO'", 'rotulo': 'Vendas ELO'}


class FakeWorkflow:
    def __init__(self, data):
        self.data = data

    def get_run(self, run_id):
        if run_id != 'run-teste': raise ServiceError(404, 'RUN_NOT_FOUND', 'Run não encontrado.')
        return {'id': run_id}

    def run_outputs(self, run_id):
        self.get_run(run_id)
        return self.data


def request(pergunta, **extra):
    context = {'filters': [], 'sort': None, 'only_exceptions': False, 'chat_filter_rids': None, 'view_rids': None, 'selection': None, 'focus': None, 'view': None}
    context.update(extra.pop('contexto', {}))
    return {'pergunta': pergunta, 'modo': 'pergunta', 'thread_id': None, 'step_id': 's4', 'dataset': 'mdr_conferido', 'contexto': context, **extra}


class AgentTests(unittest.TestCase):
    @classmethod
    def setUpClass(cls):
        cls.temp = tempfile.TemporaryDirectory()
        cls.data = sources(cls.temp.name)

    @classmethod
    def tearDownClass(cls):
        cls.temp.cleanup()

    def service(self, script):
        self.client = FakeAnthropic(script)
        directory = tempfile.mkdtemp(dir=self.temp.name)
        service = ChatService(Path(directory) / 'chat.sqlite3', FakeWorkflow(self.data), client=self.client)
        self.addCleanup(service.close)
        return service

    def ask(self, service, pergunta='Quanto a bandeira ELO soma de bruto?', **extra):
        events = list(service.ask('run-teste', request(pergunta, **extra), 'Analista de teste'))
        self.events = events
        answers = [event['answer'] for event in events if event['type'] == 'answer']
        return answers[0] if answers else None

    def test_numbers_in_the_answer_come_from_the_queries(self):
        service = self.service([
            [note('Vou somar o bruto da bandeira ELO.'), sql(ELO, 'Bruto ELO')],
            lambda params, results: [answer(f'A bandeira ELO soma {{{query_id(results)}.total:brl}} em {{{query_id(results)}.linhas:int}} vendas.',
                                            linhas=ELO_ROWS, verificacao=ELO_CHECK)],
        ])
        result = self.ask(service)
        self.assertEqual([event['type'] for event in self.events], ['thread', 'stage', 'stage', 'query', 'answer', 'done'])
        self.assertEqual(self.events[2]['texto'], 'Vou somar o bruto da bandeira ELO.')
        self.assertEqual(''.join(segment['v'] for segment in result['segmentos']), 'A bandeira ELO soma R$ 75,00 em 500 vendas.')
        value = next(segment for segment in result['segmentos'] if segment['t'] == 'valor')
        self.assertEqual((value['ref'], value['bruto']), ('q1.total:brl', '75.00'))
        self.assertEqual(result['selo']['status'], 'ok')
        self.assertEqual(result['selo']['checks'][0]['esperado'], 'R$ 75,00')
        self.assertEqual((result['linhas']['total'], result['linhas']['step_number'], result['linhas']['rids'][:3]), (500, 4, [0, 3, 6]))
        self.assertEqual(result['consultas'][0]['sql'], ELO)
        self.assertEqual((result['usage']['chamadas'], result['usage']['custo_usd'], result['modelo']), (2, '0.0252', 'claude-opus-5-5'))
        saved = service.status('run-teste')['conversas'][0]
        self.assertEqual((saved['autor'], saved['perguntas'][0]['answer']['selo']['status']), ('Analista de teste', 'ok'))

    def test_request_follows_the_model_contract(self):
        service = self.service([[sql(ELO)], lambda params, results: [answer(f'Total {{{query_id(results)}.total:brl}}.')]])
        self.ask(service)
        params = self.client.requests[0]
        self.assertEqual((params['model'], params['output_config'], params['fallbacks']), ('claude-opus-5-5', {'effort': 'medium'}, 'default'))
        self.assertEqual(params['thinking'], {'type': 'adaptive', 'display': 'updates'})
        self.assertEqual(params['betas'], ['server-side-fallback-2026-07-01', 'thinking-display-updates-2026-08-18'])
        self.assertNotIn('tool_choice', params)
        tools = {tool['name']: tool for tool in params['tools']}
        self.assertTrue(tools['responder']['strict'])
        self.assertTrue(all(tool['eager_input_streaming'] for tool in tools.values()))
        self.assertTrue(all(block['cache_control'] == {'type': 'ephemeral'} for block in params['system']))
        self.assertIn('## mdr_conferido', params['system'][1]['text'])
        self.assertIn('gross DECIMAL(18,2)', params['system'][1]['text'])
        prompt = params['messages'][0]['content'][0]['text']
        self.assertIn('<contexto_da_tela>', prompt)
        self.assertTrue(prompt.endswith('Pergunta: Quanto a bandeira ELO soma de bruto?'))
        self.assertEqual(self.client.requests[1]['system'], params['system'])

    def test_bad_markers_and_loose_digits_go_back_to_the_model(self):
        service = self.service([
            [sql(ELO)],
            [answer('A bandeira ELO soma R$ 75,00 em 500 vendas ({q9.total}).')],
            lambda params, results: [answer('A bandeira ELO soma {q1.total:brl}.', verificacao=ELO_CHECK)],
        ])
        result = self.ask(service)
        feedback = self.client.requests[2]['messages'][-1]['content'][0]
        self.assertTrue(feedback['is_error'])
        self.assertIn('{q9.total}', feedback['content'])
        self.assertIn('Números fora de marcadores: 500, 75,00', feedback['content'])
        self.assertFalse(result['texto_oculto'])
        self.assertEqual(result['selo']['status'], 'ok')

    def test_numbers_from_the_question_and_step_references_are_allowed(self):
        service = self.service([
            [sql("SELECT COUNT(*) AS n FROM mdr_conferido WHERE gross > 0.15")],
            lambda params, results: [answer('No passo 4, {q1.n:int} linhas passam de 0,15.')],
        ])
        result = self.ask(service, 'Quantas linhas passam de 0,15?')
        self.assertEqual(''.join(segment['v'] for segment in result['segmentos']), 'No passo 4, 750 linhas passam de 0,15.')
        self.assertEqual(len(self.client.requests), 2)
        self.assertEqual(result['selo']['status'], 'sem_verificacao')

    def test_second_answer_with_loose_digits_hides_the_prose_and_keeps_the_data(self):
        breakdown = 'SELECT brand AS bandeira, SUM(gross) AS bruto FROM mdr_conferido GROUP BY 1 ORDER BY 1'
        loose = answer('ELO soma 75 reais.', tabela={'consulta': 'q1', 'colunas': ['bandeira', 'bruto']})
        service = self.service([[sql(breakdown)], [loose], [loose]])
        result = self.ask(service)
        self.assertTrue(result['texto_oculto'])
        self.assertEqual(result['segmentos'], [])
        self.assertIn('ocultado', result['avisos'][0])
        self.assertEqual(result['tabela']['linhas'], [['ELO', '75.00'], ['VISA', '150.00']])

    def test_seal_reports_a_disagreement_and_checks_the_parts(self):
        breakdown = 'SELECT brand AS bandeira, SUM(gross) AS bruto FROM mdr_conferido GROUP BY 1'
        service = self.service([
            [sql('SELECT SUM(gross) AS total FROM mdr_conferido'), sql(breakdown)],
            lambda params, results: [answer('O bruto total é {q1.total:brl}.',
                verificacao={**ELO_CHECK, 'filtro_sql': "brand = 'VISA'"}, partes={'consulta': 'q2', 'coluna': 'bruto'})],
        ])
        result = self.ask(service)
        recount, parts = result['selo']['checks']
        self.assertEqual(result['selo']['status'], 'falhou')
        self.assertEqual((recount['ok'], recount['obtido'], recount['esperado'], recount['diferenca']), (False, 'R$ 225,00', 'R$ 150,00', 'R$ 75,00'))
        self.assertEqual((parts['ok'], parts['obtido']), (True, 'R$ 225,00'))

    def test_whole_table_sum_is_compared_with_the_control_total(self):
        service = self.service([
            [sql('SELECT SUM(gross) AS total FROM mdr_conferido')],
            lambda params, results: [answer('O bruto do passo é {q1.total:brl}.', verificacao={**ELO_CHECK, 'filtro_sql': None})],
        ])
        result = self.ask(service)
        self.assertEqual([check['tipo'] for check in result['selo']['checks']], ['recalculo', 'total_controle'])
        self.assertTrue(all(check['ok'] for check in result['selo']['checks']))
        self.assertIn('passo 4', result['selo']['checks'][1]['texto'])

    def test_float_results_are_refused_back_to_the_model(self):
        service = self.service([
            [sql('SELECT AVG(gross) AS media FROM mdr_conferido')],
            lambda params, results: [sql('SELECT ROUND(AVG(gross), 2)::DECIMAL(18,2) AS media FROM mdr_conferido')] if results[0]['is_error'] else [],
            lambda params, results: [answer(f'A média é {{{query_id(results)}.media:brl}}.')],
        ])
        result = self.ask(service)
        refused = self.client.requests[1]['messages'][-1]['content'][0]
        self.assertTrue(refused['is_error'])
        self.assertIn('DECIMAL(18,2)', refused['content'])
        self.assertEqual([query['erro'] is not None for query in result['consultas']], [True, False])
        self.assertEqual(result['segmentos'][1]['v'], 'R$ 0,15')

    def test_the_answer_must_come_through_responder(self):
        service = self.service([[text('A bandeira ELO soma bastante.')], [sql(ELO)], lambda params, results: [answer('Total {q1.total:brl}.')]])
        result = self.ask(service)
        nudge = self.client.requests[1]['messages'][-1]
        self.assertEqual(nudge['role'], 'user')
        self.assertIn('responder', nudge['content'][0]['text'])
        self.assertEqual(result['segmentos'][1]['v'], 'R$ 75,00')

    def test_follow_up_replays_the_thread_byte_for_byte(self):
        service = self.service([
            [note('Somando ELO.'), sql(ELO)], lambda params, results: [answer('ELO soma {q1.total:brl}.')],
            [sql("SELECT SUM(gross) AS total FROM mdr_conferido WHERE brand = 'VISA'")], lambda params, results: [answer('VISA soma {q1.total:brl}.')],
        ])
        first = self.ask(service)
        second = self.ask(service, 'E a VISA?', thread_id=first['thread_id'])
        self.assertEqual(second['thread_id'], first['thread_id'])
        replay = self.client.requests[2]['messages']
        self.assertEqual(replay[:3], self.client.requests[1]['messages'])
        self.assertEqual(len(replay), 6)
        self.assertEqual(replay[1]['content'][0], {'type': 'thinking', 'thinking': 'Somando ELO.', 'signature': 'fake-signature'})
        self.assertEqual(replay[3]['content'][0]['name'], 'responder')
        self.assertEqual(replay[4]['content'][0]['type'], 'tool_result')
        self.assertTrue(replay[5]['content'][0]['text'].endswith('Pergunta: E a VISA?'))
        self.assertEqual(''.join(segment['v'] for segment in second['segmentos']), 'VISA soma R$ 150,00.')
        with self.assertRaises(LookupError):
            service.ask('run-teste', request('Outra', thread_id='conv-inexistente'), 'Analista de teste')

    def test_refusal_is_an_error_and_not_saved_as_an_answer(self):
        service = self.service([{'content': [], 'stop_reason': 'refusal'}])
        self.assertIsNone(self.ask(service))
        error = next(event for event in self.events if event['type'] == 'error')
        self.assertEqual(error['code'], 'CHAT_REFUSED')
        self.assertEqual(self.events[-1]['type'], 'done')
        self.assertEqual(service.status('run-teste')['conversas'][0]['perguntas'][0]['status'], 'erro')

    def test_selection_becomes_the_selecao_table(self):
        selection = {'dataset': 'mdr_conferido', 'columns': ['gross'], 'rids': [0, 2, 4], 'stats': {'cells': 3, 'numeric': 3, 'sum': '0.60', 'avg': '0.20', 'money': True}}
        service = self.service([
            [sql('SELECT SUM(gross) AS total FROM mdr_conferido WHERE _rid IN (SELECT _rid FROM selecao)')],
            lambda params, results: [answer('A seleção soma {q1.total:brl}.', verificacao={**ELO_CHECK, 'filtro_sql': '_rid IN (SELECT _rid FROM selecao)'})],
        ])
        result = self.ask(service, 'Quanto soma a seleção?', contexto={'selection': selection})
        prompt = self.client.requests[0]['messages'][0]['content'][0]['text']
        self.assertIn('Seleção do analista: 3 linhas, colunas Bruto (gross)', prompt)
        self.assertEqual((result['segmentos'][1]['v'], result['selo']['status']), ('R$ 0,60', 'ok'))
        stored = service.store.db.execute('SELECT data FROM chat_turns').fetchone()[0]
        self.assertEqual(json.loads(stored)['contexto']['selection']['rids'], '3 linhas')

    def test_focused_cell_brings_its_row_for_why_questions(self):
        cell = {'dataset': 'mdr_conferido', 'rid': 1, 'column': 'gross', 'label': 'Bruto', 'value': '0.10'}
        service = self.service([[answer('A linha tem exceção.', linhas={'dataset': 'mdr_conferido', 'filtro_sql': '_rid = 1', 'rotulo': 'Linha'})]])
        result = self.ask(service, 'Por que Bruto é R$ 0,10 em TX0001?', modo='por_que', contexto={'focus': {'column': 'gross', 'cell': cell}})
        prompt = self.client.requests[0]['messages'][0]['content'][0]['text']
        self.assertIn('origem de um valor', prompt)
        self.assertIn('"id": "TX0001"', prompt)
        self.assertEqual(result['linhas']['rids'], [1])

    def test_unknown_table_is_refused_before_any_call(self):
        service = self.service([])
        with self.assertRaises(ValueError):
            service.ask('run-teste', request('Oi', dataset='raw_orbe'), 'Analista de teste')
        self.assertEqual(self.client.requests, [])

    def test_without_credentials_the_chat_explains_how_to_configure(self):
        service = ChatService(Path(tempfile.mkdtemp(dir=self.temp.name)) / 'chat.sqlite3', FakeWorkflow(self.data))
        self.addCleanup(service.close)
        with mock.patch.object(agent, 'credentials', return_value=(False, 'Não há credencial da Anthropic nesta máquina.')):
            status = service.status('run-teste')
            self.assertFalse(status['disponivel'])
            self.assertIn('ant auth login', status['como_configurar'])
            with self.assertRaises(ChatUnavailable):
                service.ask('run-teste', request('Oi'), 'Analista de teste')


class FormattingTests(unittest.TestCase):
    def test_pt_br_exact_formats(self):
        self.assertEqual(fmt('4715852.69', 'DECIMAL(38,2)', 'brl'), 'R$ 4.715.852,69')
        self.assertEqual(fmt('-0.005', 'DECIMAL(18,3)', 'brl'), '-R$ 0,01')
        self.assertEqual(fmt('-0.004', 'DECIMAL(18,3)', 'brl'), 'R$ 0,00')
        self.assertEqual(fmt('2.590000', 'DECIMAL(18,6)', 'pct'), '2,59%')
        self.assertEqual(fmt('-0.125000', 'DECIMAL(18,6)', 'pp'), '−0,125 p.p.')
        self.assertEqual(fmt(1943, 'BIGINT'), '1.943')
        self.assertEqual(fmt('2026-09-30', 'DATE'), '30/09/2026')
        self.assertEqual(fmt('0.500000', 'DECIMAL(18,6)'), '0,5')
        self.assertEqual(fmt(None, 'DECIMAL(18,2)', 'brl'), 'vazio')

    def test_loose_digit_rule(self):
        self.assertEqual(stray_digits('Soma {q1.total:brl} no passo 4 e nos passos 5 e 8.', set()), [])
        self.assertEqual(stray_digits('Soma 1.234,56 em {q2.n} linhas, 12%.', set()), ['1.234,56', '12'])
        self.assertEqual(stray_digits('Acima de 80% do impacto.', {'80'}), [])


if __name__ == '__main__':
    unittest.main()
