"""Historical original resolution and cumulative controls through actual API runs."""
import csv
import io
import tempfile
import time
import unittest
from pathlib import Path
from fastapi.testclient import TestClient
from src.api.app import create_app
from src.store import ROOT

class HistoricalAPI(unittest.TestCase):
    def setUp(self):
        self.tmp=tempfile.TemporaryDirectory();self.base=Path(self.tmp.name)
        self.app=create_app(self.base/'db.sqlite3',ROOT/'data/case',self.base/'runs',mail_private_dir=self.base/'private')
        self.ctx=TestClient(self.app,base_url='http://127.0.0.1');self.c=self.ctx.__enter__()
        self.user={'X-User':'QA history'}
        source=next((ROOT/'data/case').glob('01*.csv'))
        self.header=source.read_text(encoding='utf-8-sig').splitlines()[0].split(';')
        self.template=next(csv.DictReader(io.StringIO(source.read_text(encoding='utf-8-sig')),delimiter=';'))
        self.template.update(id_transacao='QA-ORIGINAL',data_movimento='01/09/2026',cod_estabelecimento='1018325654',tipo_lancamento='VENDA',modalidade='CREDITO A VISTA',qtd_parcelas='1',valor_bruto='100,00',taxa_aplicada_pct='0',valor_taxa='0',valor_liquido='100,00',id_referencia='',data_venda_original='')

    def tearDown(self):
        self.ctx.__exit__(None,None,None);self.tmp.cleanup()

    def run_rows(self,rows,period='2026-10'):
        out=io.StringIO();w=csv.DictWriter(out,self.header,delimiter=';');w.writeheader();w.writerows(rows)
        files=[]
        for f in (ROOT/'data/case').iterdir():
            if f.suffix in ('.csv','.eml','.xlsx','.ofx') and not f.name.startswith('01'):
                r=self.c.post('/api/files',headers=self.user,files={'file':(f.name,f.read_bytes())});self.assertEqual(r.status_code,201,r.text);files.append(r.json()['id'])
        r=self.c.post('/api/files',headers=self.user,files={'file':('arbitrary.csv',out.getvalue().encode())});files.append(r.json()['id'])
        r=self.c.post('/api/runs',headers=self.user,json={'pipeline_id':'fechamento-tarvo','competencia':period,'file_ids':files});self.assertEqual(r.status_code,202,r.text);rid=r.json()['run_id']
        for _ in range(600):
            run=self.c.get('/api/runs/'+rid).json()
            if run['status'] not in ('queued','running'):break
            time.sleep(.05)
        self.assertEqual(run['status'],'awaiting_approval',run.get('error'))
        r=self.c.get('/api/state',params={'run_id':rid});self.assertEqual(r.status_code,200,r.text)
        return rid,r.json()

    def reversal(self,**changes):
        return {**self.template,'id_transacao':'QA-REFUND','data_movimento':'01/10/2026','tipo_lancamento':'ESTORNO','valor_bruto':'-60,00','valor_liquido':'-60,00','id_referencia':'QA-ORIGINAL','data_venda_original':'01/09/2026',**changes}

    def types(self,state):
        return {x['tipo'] for x in state['results']['pendencias'] if x['ref_origem'].startswith('QA-')}

    def test_found_missing_ambiguous_incompatible_and_cumulative_unique_snapshots(self):
        _,missing=self.run_rows([self.reversal()]);self.assertIn('ORIGINAL_AUSENTE',self.types(missing))
        self.run_rows([self.template],period='2026-09')
        self.run_rows([self.template],period='2026-09')
        _,found=self.run_rows([self.reversal()]);self.assertNotIn('ORIGINAL_AUSENTE',self.types(found))
        entries=[x['entrada'] for x in found['results']['details'] if x.get('entrada',{}).get('id')=='QA-REFUND']
        self.assertTrue(any(x.get('original_resolution')=='historical' for x in entries))
        _,bad=self.run_rows([self.reversal(modalidade='PIX')]);self.assertIn('ORIGINAL_INCOMPATIVEL',self.types(bad))
        original={**self.template,'id_transacao':'QA-CUM-ORIGINAL'}
        prior={**self.reversal(),'id_transacao':'QA-CUM-SEP','id_referencia':'QA-CUM-ORIGINAL','data_movimento':'25/09/2026'}
        self.run_rows([original,prior],period='2026-09')
        self.run_rows([original,prior],period='2026-09')
        current={**self.reversal(),'id_transacao':'QA-CUM-OCT','id_referencia':'QA-CUM-ORIGINAL','valor_bruto':'-50,00','valor_liquido':'-50,00'}
        _,excess=self.run_rows([current]);self.assertIn('REVERSAO_ACUMULADA_EXCEDENTE',self.types(excess))
        self.run_rows([{**self.template,'valor_bruto':'101,00','valor_liquido':'101,00'}],period='2026-09')
        _,ambiguous=self.run_rows([self.reversal(id_transacao='QA-AMBIGUOUS')]);self.assertIn('ORIGINAL_AMBIGUO',self.types(ambiguous))

    def test_legacy_history_and_monthly_configuration_are_snapshotted(self):
        import shutil
        folder=self.base/'history-import';shutil.copytree(ROOT/'data/case',folder)
        orbe=next(folder.glob('01*.csv'))
        with orbe.open('w',newline='') as f:
            w=csv.DictWriter(f,self.header,delimiter=';');w.writeheader();w.writerow({**self.template,'modalidade':'CREDITO PARCELADO'})
        for source in (folder,ROOT/'data/case'):
            r=self.c.post('/api/import',json={'period':'2026-09','source_dir':str(source),'actor':'QA history'})
            self.assertEqual(r.status_code,200,r.text)
        _,state=self.run_rows([self.reversal()])
        self.assertNotIn('ORIGINAL_AUSENTE',self.types(state));self.assertNotIn('ORIGINAL_INCOMPATIVEL',self.types(state))
        entries=[x['entrada'] for x in state['results']['details'] if x.get('entrada',{}).get('id')=='QA-REFUND']
        self.assertTrue(any(x.get('original_resolution')=='historical' for x in entries))
        r=self.c.put('/api/competencias/2026-10/config',headers=self.user,json={'closing_deadline':'2026-11-17','remittance_tolerance_pp':'0.01','reason':'Configuração mensal isolada de teste'})
        self.assertEqual(r.status_code,200,r.text)
        _,updated=self.run_rows([self.reversal()])
        self.assertEqual(updated['parameters']['closing_deadline'],'2026-11-17')
        self.assertEqual(updated['summary']['remittance_tolerance_pp'],'0.01')
        self.assertNotEqual(state['parameters']['closing_deadline'],'2026-11-17')
        old=self.c.get('/api/state',params={'run_id':state['run_id']}).json()
        self.assertEqual(old['parameters'],state['parameters'])
