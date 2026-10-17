"""Golden questions against the real model: runs the pack in a temporary folder, asks the 10 questions of
chat_golden.py through the chat service and grades each answer against the value computed in Python Decimal.

Needs an Anthropic credential (`ant auth login` or ANTHROPIC_API_KEY) and spends real money, roughly
US$ 0,10–0,30 per question. Run explicitly:  .venv/bin/python tests/run_golden.py --confirmar-custo
"""
import argparse
import sys
import tempfile
import time
from decimal import Decimal
from pathlib import Path

ROOT = Path(__file__).resolve().parents[1]
sys.path.insert(0, str(ROOT))
sys.path.insert(0, str(Path(__file__).resolve().parent))

from fastapi.testclient import TestClient  # noqa: E402

from src.api.app import create_app  # noqa: E402
from src.chat.agent import SETUP, credentials, fmt  # noqa: E402
from chat_fakes import FakeAnthropic, answer, query_id, sql  # noqa: E402
from chat_golden import GOLDEN  # noqa: E402

STYLE_TYPES = {'brl': 'DECIMAL(38,2)', 'int': 'BIGINT', 'texto': 'VARCHAR'}


def expected_text(item, value):
    return str(value) if item['estilo'] == 'texto' else fmt(value, STYLE_TYPES[item['estilo']], item['estilo'])


def grade(item, expected, result):
    if not result: return False, 'sem resposta'
    values = [segment['v'] for segment in result['segmentos'] if segment['t'] == 'valor']
    seal = result['selo']
    if seal['status'] == 'falhou': return False, 'selo não confere'
    if expected in values or seal.get('valor') == expected: return True, seal['status']
    return False, 'valores citados: ' + (', '.join(values) or 'nenhum')


def main():
    parser = argparse.ArgumentParser(description='Perguntas de ouro do chat com o modelo real')
    parser.add_argument('--confirmar-custo', action='store_true', help='Confirma o gasto com a API da Anthropic')
    parser.add_argument('--so', help='Rodar só esta pergunta (id)')
    parser.add_argument('--simulado', action='store_true', help='Testa o roteiro sem a API: o "modelo" usa as SQL de referência')
    args = parser.parse_args()
    oracle = None
    if args.simulado:
        oracle = FakeAnthropic([])
    else:
        available, reason = credentials()
        if not available:
            print(f'{reason} {SETUP}')
            return 2
        if not args.confirmar_custo:
            print('Este roteiro chama o modelo de verdade (~US$ 0,10–0,30 por pergunta). Rode de novo com --confirmar-custo.')
            return 2
    with tempfile.TemporaryDirectory(prefix='tarvo-ouro-') as directory, \
            TestClient(create_app(Path(directory)/'ouro.sqlite3', ROOT/'data'/'case', Path(directory)/'runs',
                                  mail_private_dir=Path(directory)/'private', chat_client=oracle), base_url='http://127.0.0.1') as client:
        flow, chat = client.app.state.workflow, client.app.state.chat
        # Same entry point as the interface, so the run gets the registry references of the open period.
        run_id = client.post('/api/runs', headers={'X-User': 'Perguntas de ouro'}, json={'pipeline_id': 'fechamento-tarvo', 'competencia': '2026-09'}).json()['run_id']
        until = time.monotonic() + 120
        while flow.get_run(run_id)['status'] not in ('awaiting_approval', 'failed') and time.monotonic() < until: time.sleep(.1)
        rows_of = flow.run_outputs(run_id)['rows_of']
        hits, cost, rows = 0, Decimal(0), []
        for item in GOLDEN:
            if args.so and item['id'] != args.so: continue
            expected = expected_text(item, item['esperado'](rows_of))
            request = {'pergunta': item['pergunta'], 'modo': 'pergunta', 'thread_id': None, 'step_id': item['step_id'], 'dataset': item['dataset'], 'contexto': {}}
            if oracle:
                oracle.script = [[sql(item['sql'], 'Referência')],
                                 lambda params, results, style=item['estilo']: [answer(f'Resposta: {{{query_id(results)}.valor:{style}}}.')]]
            started = time.perf_counter()
            result, error = None, None
            for event in chat.ask(run_id, request, 'Perguntas de ouro'):
                if event['type'] == 'answer': result = event['answer']
                if event['type'] == 'error': error = event['message']
            ok, note = grade(item, expected, result) if not error else (False, error)
            spent = Decimal(result['usage'].get('custo_usd', '0')) if result else Decimal(0)
            hits += ok
            cost += spent
            rows.append(item['id'])
            print(f"{'✓' if ok else '✗'} {item['id']:<20} esperado {expected:<22} US$ {spent:.4f}  {time.perf_counter() - started:5.1f} s  {note}", flush=True)
        if rows:
            print(f'\nAcertos: {hits} de {len(rows)} · custo total estimado US$ {cost:.4f} · médio US$ {cost / len(rows):.4f} por pergunta'
                  + (' (modo simulado: custo do cliente falso, sem valor real)' if oracle else ''))
    return 0 if rows and hits >= len(rows) - 1 else 1


if __name__ == '__main__':
    sys.exit(main())
