"""Stable catalog identity, financial conflicts and monthly continuity."""
import json
import sqlite3
import tempfile
import unittest
from pathlib import Path
from src.catalog import normalize_rate, stable_contract_id, reconcile_catalog, migrate_catalog
from src.store import Store
PACK=Path(__file__).resolve().parents[1]/'data'/'case'
OCT=Path(__file__).resolve().parents[3]/'Tarvo_Data_Pack_out2026'


def rate(value='2.5900',row=12,**changes):
    return {'id':f'RATE-11111111000111-CREDITO_A_VISTA-{row}','cnpj':'11111111000111',
            'product':'CREDITO_A_VISTA','start':'2026-01-01','end':'','rate_pct':value,
            'source_file':'contratos.xlsx','source_ref':f'Taxas!A{row}:L{row}','physical_row':row,**changes}


class CatalogIdentity(unittest.TestCase):
    def test_precise_rates_are_not_rounded_when_identifying_revisions(self):
        a=normalize_rate(rate('1.00000000000000000000000000001'))
        b=normalize_rate(rate('1.00000000000000000000000000002'))
        self.assertNotEqual(a['revision_id'],b['revision_id'])
        self.assertEqual(a['rate_pct'],'1.00000000000000000000000000001')
        self.assertEqual(normalize_rate(rate('1200.000'))['rate_pct'],'1200')
        self.assertEqual(normalize_rate(rate('-0.000'))['rate_pct'],'0')
        self.assertEqual(len(reconcile_catalog({'rates':[a,b]})['catalog_conflicts']),1)

    def test_reordering_and_numeric_equivalence_merge_origins(self):
        a=normalize_rate(rate());b=normalize_rate(rate('2.59',26,source_file='reordenada.xlsx'))
        self.assertEqual((a['id'],a['revision_id']),(b['id'],b['revision_id']))
        out=reconcile_catalog({'rates':[a,b]})
        self.assertEqual(len(out['rates']),1)
        self.assertEqual(len(out['rates'][0]['provenances']),2)
        self.assertFalse(out['catalog_conflicts'])
        self.assertEqual(out,reconcile_catalog({'rates':[b,a]}))

    def test_changed_value_is_explicit_revision_conflict(self):
        a,b=rate(),rate('3.10',20)
        out=reconcile_catalog({'rates':[a]},{'rates':[b]})
        self.assertEqual(len(out['rates']),2)
        self.assertEqual(len(out['catalog_conflicts']),1)
        self.assertEqual({r['rate_pct'] for r in out['rates']},{'2.59','3.1'})
        self.assertEqual({r['logical_id'] for r in out['rates']},{stable_contract_id(a)})
        self.assertEqual(out,reconcile_catalog({'rates':[b]},{'rates':[a]}))

    def test_human_review_survives_unknown_new_content(self):
        old=rate('2.1',reviewed_by='Analista',reviewed_at='2026-10-17',reason='Conferido')
        out=reconcile_catalog({'rates':[rate('3')]},{'rates':[old]})
        self.assertEqual([r['rate_pct'] for r in out['rates']],['2.1'])
        self.assertEqual(out['import_warnings'][0]['type'],'CONFLITO_CONTRATUAL')
        self.assertEqual(len(out['catalog_conflicts'][0]['variants']),2)
        self.assertEqual(len(reconcile_catalog({},out)['catalog_conflicts']),1)

    def test_explicitly_superseded_revision_does_not_return(self):
        old=normalize_rate(rate())
        new=rate('2.1',reviewed_by='Analista',supersedes_revision_ids=[old['revision_id']])
        out=reconcile_catalog({'rates':[old]},{'rates':[new]})
        self.assertEqual([r['rate_pct'] for r in out['rates']],['2.1'])
        self.assertFalse(out['catalog_conflicts'])

    def test_real_overlap_is_not_semantic_duplicate(self):
        out=reconcile_catalog({'rates':[rate(),rate(start='2026-09-01',row=22)]})
        self.assertEqual(len(out['rates']),2)
        self.assertNotEqual(out['rates'][0]['logical_id'],out['rates'][1]['logical_id'])

    def test_merchant_review_survives_known_source_and_flags_new_ec(self):
        source={'cnpj':'11111111000111','name':'Empresa','ec':'100','active':True}
        old=reconcile_catalog({'merchants':[source]})['merchants'][0]
        new={**old,'name':'Empresa revisada','reviewed_by':'Analista','supersedes_revision_ids':[old['revision_id']]}
        out=reconcile_catalog({'merchants':[source]},{'merchants':[new]})
        self.assertEqual(out['merchants'][0]['name'],'Empresa revisada')
        self.assertFalse(out['catalog_conflicts'])
        other=reconcile_catalog({'merchants':[{**source,'ec':'200'}]},out)
        self.assertEqual(other['merchants'][0]['ec'],'100')
        self.assertEqual(other['import_warnings'][0]['type'],'CONFLITO_CADASTRAL')

    def test_migration_atomic_idempotent_and_preserves_other_tables(self):
        db=sqlite3.connect(':memory:')
        db.executescript('CREATE TABLE rates(id TEXT PRIMARY KEY,cnpj,product,start,end,rate_pct,data); CREATE TABLE audit(id INTEGER PRIMARY KEY,at,actor,action,detail); CREATE TABLE kv(key TEXT PRIMARY KEY,value); CREATE TABLE decisions(id,data);')
        db.execute('INSERT INTO decisions VALUES (?,?)',('old','{"approved":true}'))
        for r in [rate(),rate(row=26),rate(start='2026-09-01',row=30)]:
            db.execute('INSERT INTO rates VALUES (?,?,?,?,?,?,?)',(r['id'],r['cnpj'],r['product'],r['start'],r['end'],r['rate_pct'],json.dumps(r)))
        db.commit();out=migrate_catalog(db)
        self.assertEqual((out['before_count'],out['after_count']),(3,2))
        self.assertEqual(db.execute('SELECT * FROM decisions').fetchall(),[('old','{"approved":true}')])
        self.assertGreaterEqual(db.execute('SELECT count(*) FROM catalog_history').fetchone()[0],3)
        audits=db.execute('SELECT count(*) FROM audit').fetchone()[0]
        self.assertFalse(migrate_catalog(db)['changed'])
        self.assertEqual(db.execute('SELECT count(*) FROM audit').fetchone()[0],audits)
        snapshot=db.execute('SELECT * FROM rates ORDER BY id').fetchall()
        r=rate('NaN',99)
        db.execute('INSERT INTO rates VALUES (?,?,?,?,?,?,?)',(r['id'],r['cnpj'],r['product'],r['start'],r['end'],r['rate_pct'],json.dumps(r)))
        with self.assertRaises(ValueError):migrate_catalog(db)
        self.assertEqual(db.execute('SELECT * FROM rates WHERE id<>? ORDER BY id',(r['id'],)).fetchall(),snapshot)
        db.close()


class StoreContinuity(unittest.TestCase):
    def setUp(self):
        self.temp=tempfile.TemporaryDirectory();self.store=Store(Path(self.temp.name)/'state.sqlite3',PACK)
    def tearDown(self):
        self.store.close_db();self.temp.cleanup()
    def test_monthly_reimport_preserves_human_review_and_prior_runs(self):
        old=next(r for r in self.store.records('rates') if r['start'] and not r['end'])
        self.store.mutate('rates',{**old,'actor':'Analista','reason':'Conferido sem mudar valor'})
        prior=self.store.db.execute('SELECT * FROM runs ORDER BY id').fetchall()
        self.store.mutate('import',{'period':'2026-10','source_dir':str(OCT),'actor':'Analista'})
        current=self.store.records('rates')
        self.assertEqual(len(current),176)
        self.assertEqual(next(r for r in current if r['logical_id']==old['logical_id'])['reviewed_by'],'Analista')
        self.assertEqual(self.store.db.execute('SELECT * FROM runs ORDER BY id').fetchall()[:len(prior)],prior)
        self.store.mutate('import',{'period':'2026-10','source_dir':str(OCT),'actor':'Analista'})
        self.assertEqual(len(self.store.records('rates')),176)
        self.assertEqual(self.store.state()['summary']['notas_brl'],'73111.46')
    def test_changed_human_rate_survives_reimport(self):
        old=next(r for r in self.store.records('rates') if r['start'] and not r['end'])
        self.store.mutate('rates',{**old,'rate_pct':'1.01','actor':'Analista','reason':'Nova evidência'})
        self.store.mutate('import',{'period':'2026-09','source_dir':str(PACK),'actor':'Analista'})
        self.assertEqual(next(r for r in self.store.records('rates') if r['logical_id']==old['logical_id'])['rate_pct'],'1.01')
        self.assertFalse(self.store.get('catalog_conflicts'))
    def test_dates_are_configured_per_period(self):
        self.assertEqual(self.store.get('period'),'2026-09')
        self.assertEqual(self.store.parameters_for()['closing_deadline'],'')
        self.store.set_operational_config('2026-09',{'closing_deadline':'2026-10-20','reason':'Prazo revisto'},'Analista')
        self.store.set_operational_config('2026-10',{'closing_deadline':'2026-11-18','reason':'Prazo outubro'},'Analista')
        self.assertEqual(self.store.operational_config('2026-09')['closing_deadline'],'2026-10-20')
        self.assertEqual(self.store.reference_snapshot('2026-10')['parameters']['closing_deadline'],'2026-11-18')
        self.assertEqual(self.store.parameters_for('2026-11')['closing_deadline'],'')
        self.assertEqual(self.store.get('period'),'2026-09')


if __name__=='__main__':unittest.main()
