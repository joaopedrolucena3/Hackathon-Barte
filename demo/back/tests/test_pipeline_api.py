"""HTTP contract checks against real SQLite, readers, workers, and Parquet outputs."""
import copy
import json
import tempfile
import time
import unittest
from pathlib import Path

from fastapi.testclient import TestClient

from src.api.app import create_app
from src.store import ROOT


class WorkflowHTTPTests(unittest.TestCase):
    def setUp(self):
        self.temp = tempfile.TemporaryDirectory()
        self.base = Path(self.temp.name)
        self.app = create_app(self.base/'case.sqlite3', ROOT/'data'/'case', self.base/'runs', mail_private_dir=self.base/'private')
        self.client_context = TestClient(self.app, base_url='http://127.0.0.1')
        self.client = self.client_context.__enter__()
        self.user = {'X-User': 'Teste de contrato HTTP'}

    def tearDown(self):
        self.client_context.__exit__(None, None, None)
        self.temp.cleanup()

    def wait_run(self, run_id):
        until = time.monotonic() + 30
        while time.monotonic() < until:
            state = self.client.get('/api/runs/'+run_id).json()
            if state['status'] in ('awaiting_approval','done','failed','rejected'):
                return state
            time.sleep(.02)
        self.fail('A execução não terminou a etapa assíncrona em 30 segundos.')

    def start(self):
        response = self.client.post('/api/runs', headers=self.user,
                                    json={'pipeline_id':'fechamento-tarvo','competencia':'2026-09'})
        self.assertEqual(response.status_code, 202, response.text)
        run_id = response.json()['run_id']
        return run_id, self.wait_run(run_id)

    def test_local_boundary_and_uniform_validation_errors(self):
        response = self.client.post('/api/runs', json={'competencia':'2026-09'})
        self.assertEqual(response.status_code, 422)
        self.assertEqual(set(response.json()['error']), {'code','message','details'})
        response = self.client.post('/api/runs', headers={**self.user,'Origin':'https://example.com'}, json={})
        self.assertEqual(response.status_code, 403)
        self.assertEqual(response.json()['error']['code'], 'ORIGIN_NOT_ALLOWED')
        self.assertEqual(self.client.get('/api/health', headers={'Host':'example.com'}).status_code,403)
        self.assertEqual(self.client.get('/api/not-a-route').status_code,404)
        response = self.client.get('/api/pipelines/fechamento-tarvo?version=abc')
        self.assertEqual(response.status_code,422)
        self.assertIsInstance(response.json()['error']['details'],list)

    def test_versioned_builder_rejects_removing_approval(self):
        original = self.client.get('/api/pipelines/fechamento-tarvo').json()
        invalid = copy.deepcopy(original)
        invalid['steps'] = [s for s in invalid['steps'] if s['type'] != 'aprovacao']
        response = self.client.post('/api/pipelines/fechamento-tarvo/validate',json=invalid)
        self.assertEqual(response.status_code,422,response.text)
        self.assertTrue(response.json()['error']['details'])
        response = self.client.put('/api/pipelines/fechamento-tarvo',headers=self.user,json=original)
        self.assertEqual(response.status_code,200,response.text)
        latest = response.json()
        self.assertGreater(latest['version'],original['version'])
        historical = self.client.get('/api/pipelines/fechamento-tarvo?version='+str(original['version'])).json()
        self.assertEqual(historical,original)

    def test_reject_run_keeps_erp_unavailable_and_sse_replays(self):
        run_id, state = self.start()
        self.assertEqual(state['status'],'awaiting_approval',state)
        self.assertGreater(state['blocking_open'],0)
        response = self.client.get(f'/api/runs/{run_id}/export')
        self.assertEqual(response.status_code,409,response.text)
        response = self.client.post(f'/api/runs/{run_id}/approval',headers=self.user,
                                    json={'decisao':'aprovar','comentario':'Sem resolver bloqueantes'})
        self.assertEqual(response.status_code,422,response.text)
        response = self.client.post(f'/api/runs/{run_id}/approval',headers=self.user,
                                    json={'decisao':'reprovar','comentario':'Contrato pendente; solicitar documentos'})
        self.assertEqual(response.status_code,200,response.text)
        self.assertEqual(self.client.get(f'/api/runs/{run_id}').json()['status'],'rejected')
        self.assertEqual(self.client.get(f'/api/runs/{run_id}/export').status_code,409)
        events = self.client.get(f'/api/runs/{run_id}/events')
        self.assertEqual(events.status_code,200,events.text)
        self.assertTrue(events.headers['content-type'].startswith('text/event-stream'))
        lines = events.text.splitlines()
        ids = [int(line[4:]) for line in lines if line.startswith('id: ')]
        payloads = [json.loads(line[6:]) for line in lines if line.startswith('data: ')]
        self.assertIn('run_started',[e['type'] for e in payloads])
        self.assertEqual(ids, sorted(set(ids)))
        self.assertGreater(len(ids),10)
        midpoint = ids[len(ids)//2]
        replay = self.client.get(f'/api/runs/{run_id}/events',headers={'Last-Event-ID':str(midpoint)})
        replay_ids = [int(line[4:]) for line in replay.text.splitlines() if line.startswith('id: ')]
        self.assertEqual(replay_ids,[n for n in ids if n>midpoint])
        self.assertEqual(self.client.get(f'/api/runs/{run_id}/events?after=-1').status_code,422)

    def test_approve_exports_balanced_ledger_and_preview_is_paginated(self):
        run_id, state = self.start()
        self.assertEqual(state['status'],'awaiting_approval',state)
        preview=self.client.get(f'/api/runs/{run_id}/steps/s4/preview?only_exceptions=true&page_size=2').json()
        self.assertEqual(len(preview['rows']),2)
        self.assertTrue(all(row['__exception_ids'] for row in preview['rows']))
        self.assertTrue(any(col.get('new') for col in preview['schema']))
        self.assertEqual(self.client.get(f'/api/runs/{run_id}/steps/s4/preview?page_size=501').status_code,422)
        blocked=self.client.get(f'/api/runs/{run_id}/exceptions?severidade=bloqueante&page_size=500').json()
        self.assertEqual(blocked['total'],58)
        for issue in blocked['exceptions']:
            response=self.client.post(f"/api/runs/{run_id}/exceptions/{issue['id']}/decision",headers=self.user,
                json={'acao':'aceitar','justificativa':'Fixture de aprovação; sem alteração de valor.'})
            self.assertEqual(response.status_code,200,response.text)
        response=self.client.post(f'/api/runs/{run_id}/approval',headers=self.user,
                                 json={'decisao':'aprovar','comentario':'Teste temporário de exportação após revisão explícita.'})
        self.assertEqual(response.status_code,200,response.text)
        self.assertEqual(self.wait_run(run_id)['status'],'done')
        response=self.client.get(f'/api/runs/{run_id}/export')
        self.assertEqual(response.status_code,200,response.text[:100] if response.status_code!=200 else '')
        import csv,io,zipfile
        from decimal import Decimal
        with zipfile.ZipFile(io.BytesIO(response.content)) as archive:
            self.assertIn('auditoria.json',archive.namelist())
            rows=list(csv.DictReader(io.StringIO(archive.read('lancamentos_fenix.csv').decode()),delimiter=';'))
        self.assertEqual(len(rows),4360)
        debit=sum(Decimal(row['debito']) for row in rows)
        credit=sum(Decimal(row['credito']) for row in rows)
        self.assertEqual(debit,Decimal('23474915.80'))
        self.assertEqual(debit,credit)
        old=self.client.get('/api/state').json()
        self.assertEqual(old['summary']['resolved_issues'],0)
        self.assertEqual(len(old['emails']),0)

    def test_upload_requires_actor_and_preserves_hash(self):
        filename='01_orbe_relatorio_comissoes_set2026.csv'
        content=(ROOT/'data'/'case'/filename).read_bytes()
        response=self.client.post('/api/files',files={'file':(filename,content,'text/csv')})
        self.assertEqual(response.status_code,422,response.text)
        response=self.client.post('/api/files',headers=self.user,files={'file':(filename,content,'text/csv')})
        self.assertEqual(response.status_code,201,response.text)
        import hashlib
        self.assertEqual(response.json()['sha256'],hashlib.sha256(content).hexdigest())
        self.assertIn('file_id',response.json())
        from urllib.parse import quote
        unicode_actor='João — revisão financeira'
        response=self.client.post('/api/files',headers={'X-User':quote(unicode_actor),'X-User-Encoding':'percent-utf8'},files={'file':(filename,content,'text/csv')})
        self.assertEqual(response.status_code,201,response.text)
        self.assertEqual(response.json()['actor'],unicode_actor)
        response=self.client.post('/api/files',headers=self.user,files={'file':('../../app.py',b'bad','text/plain')})
        self.assertGreaterEqual(response.status_code,400,response.text)

    def test_frontend_draft_keeps_gate_exports_and_checklist_isolated(self):
        pipeline = self.client.get('/api/pipelines/fechamento-tarvo').json()
        run_id, actual = self.start()
        request = {'pipeline_id': pipeline['id'], 'competencia': '2026-09', 'draft': True, 'steps': pipeline['steps']}
        request['steps'][2]['params']['sugerir_nome'] = False
        response = self.client.post('/api/runs', headers=self.user, json=request)
        self.assertEqual(response.status_code, 202, response.text)
        draft_id = response.json()['run_id']
        draft = self.wait_run(draft_id)
        self.assertEqual(draft['status'], 'done', draft)
        self.assertTrue(draft['draft'])
        self.assertIsNone(draft['approval'])
        self.assertEqual(draft['exports'], [])
        self.assertEqual([step['status'] for step in draft['steps'][-2:]], ['skipped', 'skipped'])
        self.assertEqual(self.client.get(f'/api/runs/{draft_id}/export').status_code, 409)
        self.assertEqual(self.client.get(f'/api/runs/{draft_id}/exports/lancamentos_fenix.csv').status_code, 409)
        audit = self.client.get(f'/api/runs/{draft_id}/exports/auditoria.json')
        self.assertEqual(audit.status_code, 200, audit.text)
        self.assertEqual(audit.json()['run_id'], draft_id)
        self.assertEqual(self.client.get('/api/competencias/2026-09/checklist').json()['run_id'], run_id)
        self.assertEqual(self.client.get('/api/pipelines/fechamento-tarvo').json()['steps'], pipeline['steps'][:2] + [{**pipeline['steps'][2], 'params': {**pipeline['steps'][2]['params'], 'sugerir_nome': True}}] + pipeline['steps'][3:])
        compare = self.client.get(f'/api/runs/compare?a={run_id}&b={draft_id}')
        self.assertEqual(compare.status_code, 200, compare.text)
        self.assertFalse(compare.json()['reproducible'])
        self.assertEqual(compare.json()['a']['id'], run_id)
        self.assertTrue(actual['steps'][0]['output_hash'])

    def test_preview_totals_summary_and_atomic_alert_decisions(self):
        from decimal import Decimal
        run_id, _ = self.start()
        summary = self.client.get(f'/api/runs/{run_id}/approval-summary').json()
        self.assertEqual(summary['batch']['debit_brl'], '23474915.80')
        self.assertEqual(summary['batch']['debit_brl'], summary['batch']['credit_brl'])
        preview = self.client.get(f'/api/runs/{run_id}/steps/s8/preview?dataset=lancamentos&page_size=2').json()
        self.assertEqual(preview['totals']['all']['debito'], summary['batch']['debit_brl'])
        self.assertEqual(Decimal(preview['totals']['page']['debito']), sum(Decimal(row['debito']) for row in preview['rows']))
        changed = self.client.get(f'/api/runs/{run_id}/steps/s3/preview', params={'params_override': json.dumps({'fallback': 'cnpj', 'sugerir_nome': False})})
        self.assertEqual(changed.status_code, 422)
        self.assertEqual(changed.json()['error']['code'], 'PREVIEW_REQUIRES_DRAFT')
        rows = self.client.get(f'/api/runs/{run_id}/exceptions?page_size=500').json()['exceptions']
        alerts = [row for row in rows if row['severidade'] != 'bloqueante'][:2]
        blocker = next(row for row in rows if row['severidade'] == 'bloqueante')
        batch = {'ids': [alerts[0]['id'], blocker['id']], 'acao': 'aceitar', 'justificativa': 'Revisão de teste'}
        response = self.client.post(f'/api/runs/{run_id}/exceptions/decisions', headers=self.user, json=batch)
        self.assertEqual(response.status_code, 422, response.text)
        self.assertEqual(self.client.get(f'/api/runs/{run_id}/approval-summary').json()['decided'], 0)
        batch['ids'] = [row['id'] for row in alerts]
        response = self.client.post(f'/api/runs/{run_id}/exceptions/decisions', headers=self.user, json=batch)
        self.assertEqual(response.status_code, 200, response.text)
        self.assertEqual(response.json()['decided'], 2)
        self.assertEqual(self.client.get(f'/api/runs/{run_id}/approval-summary').json()['decided'], 2)
        self.assertTrue(any(row['postable'] for row in self.client.get(f'/api/runs/{run_id}/accounts').json()['accounts']))
        self.assertTrue(any(row.get('bank_line_id') and row.get('associated_entries') for row in rows))
        sale = next(row for row in rows if row.get('ref_origem') == 'TX88410932')
        self.assertEqual(sale['merchant'], 'CASA DO ESTUDANTE VIAGENS')
        self.assertEqual(sale['date'], '2026-09-01')
        self.assertEqual(sale['amount'], '608.88')
        stored = next(row for row in self.app.state.workflow._exceptions(run_id) if row['id'] == sale['id'])
        self.assertNotIn('merchant', stored)

    def test_pack_references_are_snapshotted_and_unsaved_steps_require_draft(self):
        store = self.app.state.store
        pipeline = self.client.get('/api/pipelines/fechamento-tarvo').json()
        response = self.client.post('/api/runs', headers=self.user, json={'pipeline_id': pipeline['id'], 'competencia': '2026-09', 'steps': pipeline['steps']})
        self.assertEqual(response.status_code, 422, response.text)
        self.assertEqual(response.json()['error']['code'], 'DRAFT_REQUIRED')
        with store.lock, store.db:
            rate = store.records('rates')[0]
            rate['rate_pct'] = '0.1234'
            store._store_rate(rate)
        response = self.client.post('/api/runs', headers=self.user, json={'pipeline_id': pipeline['id'], 'competencia': '2026-09', 'draft': True})
        self.assertEqual(response.status_code, 202, response.text)
        run_id = response.json()['run_id']
        run = self.wait_run(run_id)
        self.assertEqual(run['status'], 'done', run)
        self.assertEqual(next(row for row in run['snapshot']['references']['rates'] if row['id'] == rate['id'])['rate_pct'], '0.1234')
        snapshot_hash = run['snapshot']['references_hash']
        with store.lock, store.db:
            rate['rate_pct'] = '0.5678'
            store._store_rate(rate)
        after = self.client.get(f'/api/runs/{run_id}').json()
        self.assertEqual(after['snapshot']['references_hash'], snapshot_hash)
        self.assertEqual(next(row for row in after['snapshot']['references']['rates'] if row['id'] == rate['id'])['rate_pct'], '0.1234')
        preview = self.client.get(f'/api/runs/{run_id}/steps/s1/preview?dataset=raw_rates&page_size=500').json()
        self.assertEqual(next(row for row in preview['rows'] if row['id'] == rate['id'])['rate_pct'], '0.1234')

    def test_competencias_insights_and_spa_deep_links(self):
        from unittest.mock import patch
        periods = self.client.get('/api/competencias').json()
        self.assertTrue(any(item['comp'] == '2026-09' and item['has_data'] and item['current'] for item in periods))
        insights = self.client.get('/api/insights?comp=2026-09')
        self.assertEqual(insights.status_code, 200, insights.text)
        from decimal import Decimal
        notes = self.client.get('/api/state').json()['results']['notas']
        self.assertEqual(insights.json()['notas']['total_brl'], format(sum((Decimal(row['valor_brl']) for row in notes), Decimal(0)), '.2f'))
        self.assertTrue(insights.json()['bancos'])
        self.assertEqual(self.client.get('/api/insights?comp=2040-01').status_code, 404)
        fake_root = self.base / 'demo' / 'back'
        frontend = fake_root.parent / 'front' / 'dist'
        frontend.mkdir(parents=True)
        (frontend / 'index.html').write_text('<html>Integrated app</html>')
        with patch('src.api.app.ROOT', fake_root):
            for route in ('/', '/competencias/2026-09', '/runs/example/revisao', '/pipeline', '/comunicacoes', '/cadastros', '/notas-bancos'):
                response = self.client.get(route)
                self.assertEqual(response.status_code, 200, route)
                self.assertIn('Integrated app', response.text)
            self.assertEqual(self.client.get('/api/unknown').status_code, 404)
            self.assertEqual(self.client.get('/assets/missing.js').status_code, 404)
            self.assertEqual(self.client.get('/%2e%2e/secrets').status_code, 404)

    def test_original_summary_and_sources_remain_available(self):
        response=self.client.get('/api/state')
        self.assertEqual(response.status_code,200,response.text)
        self.assertEqual(response.json()['summary']['checkout_brl'],'207039.73')
        self.assertEqual(response.json()['summary']['remessa_brl'],'39543.45')
        self.assertTrue(response.json()['validation']['trace_ok'])
        self.assertEqual(self.client.get('/api/export?file=rastro.csv').status_code,200)
        self.assertEqual(self.client.get('/').status_code,200)
        self.assertEqual(self.client.get('/api/openapi.json').status_code,200)


if __name__=='__main__':
    unittest.main()
