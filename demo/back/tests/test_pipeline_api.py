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
