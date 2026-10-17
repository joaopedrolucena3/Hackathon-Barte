"""Real HTTP ingest/version regressions using isolated databases and source copies.

These are API checks, not claims of browser interaction. The supplied case
complement is preserved verbatim as a portable fixture.
"""
import csv
import hashlib
import io
import json
import tempfile
import time
import unittest
import zipfile
from decimal import Decimal
from pathlib import Path

from fastapi.testclient import TestClient

from src.api.app import create_app
from src.inputs import discover_files
from tests.test_ingestion import PACK, orbe_bytes

COMPLEMENT = Path(__file__).resolve().parent / 'fixtures' / '06_orbe_ajustes_tardios_set2026.csv'
# Frozen six-file public contract from the supplied participant instructions.
# Keep this independent of the writer's implementation constant.
OFFICIAL_HEADERS = {
    'comissoes_por_lojista.csv': ['id_saida', 'cnpj', 'lojista', 'linha_negocio', 'comissao_brl'],
    'divergencias_taxa.csv': ['id_saida', 'cnpj', 'linha_negocio', 'ref_origem', 'taxa_contratada_pct', 'taxa_aplicada_pct', 'diferenca_brl'],
    'notas_a_emitir.csv': ['id_saida', 'tomador_cnpj', 'tomador', 'linha_negocio', 'valor_brl', 'discriminacao'],
    'lancamentos_classificados.csv': ['id_saida', 'banco', 'ref_origem', 'data', 'descricao', 'valor', 'conta_codigo', 'metodo', 'confianca'],
    'pendencias.csv': ['id_saida', 'tipo', 'ref_origem', 'valor_brl', 'motivo', 'quem_decide'],
    'rastro.csv': ['id_saida', 'arquivo_origem', 'ref_origem', 'valor'],
}


class IngestionHTTPTests(unittest.TestCase):
    def setUp(self):
        self.temporary = tempfile.TemporaryDirectory(prefix='tarvo-ingestion-api-')
        self.root = Path(self.temporary.name)
        self.app = create_app(self.root / 'case.sqlite3', PACK, self.root / 'runs', mail_private_dir=self.root / 'private')
        self.context = TestClient(self.app, base_url='http://127.0.0.1')
        self.client = self.context.__enter__()
        self.actor = {'X-User': 'Regressao isolada de ingestao'}

    def tearDown(self):
        self.context.__exit__(None, None, None)
        self.temporary.cleanup()

    def upload(self, name, raw, role=None):
        args = {'headers': self.actor, 'files': {'file': (name, raw, 'application/octet-stream')}}
        if role is not None:
            args['data'] = {'role': role}
        response = self.client.post('/api/files', **args)
        self.assertEqual(response.status_code, 201, response.text)
        self.assertEqual(response.json()['sha256'], hashlib.sha256(raw).hexdigest())
        return response.json()

    def upload_pack(self, arbitrary=False):
        result = []
        for index, entry in enumerate(discover_files(PACK)):
            name = f'fonte-{index}.bin' if arbitrary else entry['name']
            result.append(self.upload(name, Path(entry['path']).read_bytes()))
        return result

    def wait(self, ident):
        deadline = time.monotonic() + 40
        while time.monotonic() < deadline:
            response = self.client.get('/api/runs/' + ident)
            self.assertEqual(response.status_code, 200, response.text)
            run = response.json()
            if run['status'] in {'done', 'failed', 'rejected', 'awaiting_approval'}:
                self.assertNotEqual(run['status'], 'failed', run)
                return run
            time.sleep(.02)
        self.fail('Worker não terminou em 40 segundos.')

    def start(self, files=None, draft=True, **other):
        payload = {'pipeline_id': 'fechamento-tarvo', 'competencia': '2026-09', 'draft': draft, **other}
        if files is not None:
            payload['file_ids'] = [item['file_id'] if isinstance(item, dict) else item for item in files]
        response = self.client.post('/api/runs', headers=self.actor, json=payload)
        self.assertEqual(response.status_code, 202, response.text)
        return self.wait(response.json()['run_id'])

    def state(self, run):
        response = self.client.get('/api/state', params={'comp': run['competencia'], 'run_id': run['id']})
        self.assertEqual(response.status_code, 200, response.text)
        return response.json()

    def value_tuple(self, run):
        summary = self.state(run)['summary']
        return tuple(summary[key] for key in ('checkout_brl', 'remessa_brl', 'notas_brl'))

    def test_actual_seven_files_arbitrary_names_1957_rows_and_fourteen_traceable_ids(self):
        before = {p.name: hashlib.sha256(p.read_bytes()).hexdigest() for p in PACK.iterdir() if p.is_file()}
        pack = self.upload_pack(arbitrary=True)
        raw = COMPLEMENT.read_bytes()
        supplement = self.upload('complemento-sem-prefixo.bin', raw)
        run = self.start(pack + [supplement])
        state = self.state(run)
        self.assertEqual(len(run['snapshot']['sources']), 7)
        self.assertEqual(len(state['input_manifest']), 7)
        self.assertEqual(state['ingestion_counts']['by_role']['orbe']['rows_received'], 1957)
        self.assertEqual(self.value_tuple(run), ('203735.34', '39543.45', '243284.29'))
        self.assertTrue(state['validation']['trace_ok'])
        ids = {row['id_transacao'] for row in csv.DictReader(io.StringIO(raw.decode('utf-8-sig')), delimiter=';')}
        self.assertEqual(len(ids), 14)
        details = state['results']['details']
        if isinstance(details, dict):
            details = list(details.values())
        commission_ids = {row['id_saida'] for row in state['results']['comissoes']}
        for source_id in ids:
            matches = [row for row in details if row['id_saida'] in commission_ids and row.get('entrada', {}).get('id') == source_id]
            self.assertTrue(matches, source_id)
            entry = matches[0]['entrada']
            self.assertEqual(entry['source_file'], 'complemento-sem-prefixo.bin')
            self.assertEqual(entry['source_id'], supplement['file_id'])
            self.assertIn(entry['physical_row'], range(2, 16))
        self.assertEqual(before, {p.name: hashlib.sha256(p.read_bytes()).hexdigest() for p in PACK.iterdir() if p.is_file()})
        self.assertEqual(hashlib.sha256(raw).hexdigest(), hashlib.sha256(COMPLEMENT.read_bytes()).hexdigest())

    def test_invalid_receipts_are_registered_and_presented_in_run_manifest(self):
        pack = self.upload_pack()
        bad = [self.upload('vazio.csv', b''), self.upload('cabecalho.csv', orbe_bytes([])),
               self.upload('incompativel.csv', b'hello;world\na;b\n')]
        self.assertEqual([item['status'] for item in bad], ['empty', 'header_only', 'invalid'])
        run = self.start(pack + bad)
        state = self.state(run)
        self.assertEqual(len(state['input_manifest']), 9)
        by_name = {entry['name']: entry for entry in state['input_manifest']}
        for receipt in bad:
            self.assertEqual(by_name[receipt['name']]['status'], receipt['status'])
            self.assertTrue(by_name[receipt['name']]['reason'])
        kinds = {warning['type'] for warning in state['validation']['warnings']}
        self.assertTrue({'ARQUIVO_VAZIO', 'ARQUIVO_SO_CABECALHO', 'ARQUIVO_INVALIDO'}.issubset(kinds))
        self.assertEqual(self.value_tuple(run), ('207039.73', '39543.45', '246588.68'))

    def test_invalid_required_source_rejection_includes_manifest(self):
        pack = self.upload_pack()
        other = [item for item in pack if item['role'] != 'orbe']
        empty = self.upload('original.csv', b'', role='orbe')
        response = self.client.post('/api/runs', headers=self.actor,
            json={'pipeline_id': 'fechamento-tarvo', 'competencia': '2026-09', 'file_ids': [item['file_id'] for item in other + [empty]]})
        self.assertEqual(response.status_code, 422, response.text)
        error = response.json()['error']
        self.assertEqual(error['code'], 'REQUIRED_SOURCES')
        manifest = next(item['manifest'] for item in error['details'] if 'manifest' in item)
        self.assertEqual(len(manifest), 6)
        self.assertEqual(next(item for item in manifest if item['id'] == empty['file_id'])['status'], 'empty')

    def test_same_name_different_bytes_repeats_renames_and_order_preserve_finance(self):
        pack = self.upload_pack()
        original = next(item for item in pack if item['role'] == 'orbe')
        supplement = self.upload(original['name'], orbe_bytes())
        equivalent_numbers = orbe_bytes().replace(b'100,00', b'100,000').replace(b'2,49', b'2,490').replace(b'97,51', b'97,510')
        renamed = self.upload('reenvio.csv', equivalent_numbers)
        baseline = self.start(pack + [supplement])
        replay = self.start(pack + [supplement, supplement, renamed])
        reversed_run = self.start(list(reversed(pack + [renamed, supplement, supplement])))
        self.assertEqual(self.value_tuple(baseline), self.value_tuple(replay))
        self.assertEqual(self.value_tuple(replay), self.value_tuple(reversed_run))
        expected = len(pack) + 3
        self.assertEqual(len(replay['snapshot']['sources']), expected)
        paths = [source['snapshot_path'] for source in replay['snapshot']['sources']]
        self.assertEqual(len(set(paths)), expected)
        self.assertEqual(len({source['receipt_id'] for source in replay['snapshot']['sources']}), expected)
        state = self.state(replay)
        counts = state['ingestion_counts']['by_role']['orbe']
        self.assertEqual((counts['rows_received'], counts['rows_unique'], counts['rows_duplicate']), (1946, 1944, 2))
        details = state['results']['details']
        if isinstance(details, dict):
            details = list(details.values())
        commission_ids = {row['id_saida'] for row in state['results']['comissoes']}
        entry = next(item['entrada'] for item in details if item['id_saida'] in commission_ids and item.get('entrada', {}).get('id') == 'T-1')
        self.assertEqual(len(entry['provenances']), 3)
        self.assertEqual(len({p['source_receipt_id'] for p in entry['provenances']}), 3)
        for source in replay['snapshot']['sources']:
            self.assertEqual(hashlib.sha256(Path(source['snapshot_path']).read_bytes()).hexdigest(), source['sha256'])

    def test_repeated_pack_keeps_all_receipts_but_single_role_rows_are_not_doubled(self):
        pack = self.upload_pack()
        baseline = self.start(pack)
        replay = self.start(pack + pack)
        self.assertEqual(self.value_tuple(baseline), self.value_tuple(replay))
        state = self.state(replay)
        self.assertEqual(len(state['input_manifest']), 12)
        self.assertEqual(state['summary']['bank_count'], 184)
        counts = state['ingestion_counts']['by_role']['orbe']
        self.assertEqual((counts['rows_received'], counts['rows_unique'], counts['rows_duplicate']), (3886, 1943, 1943))

    def test_conflicting_economic_id_is_pending_and_not_selected_by_order(self):
        pack = self.upload_pack()
        first = self.upload('versao-1.csv', orbe_bytes())
        second = self.upload('versao-2.csv', orbe_bytes().replace(b'100,00', b'200,00').replace(b'97,51', b'197,51'))
        run = self.start(pack + [first, second])
        reversed_run = self.start(pack + [second, first])
        self.assertEqual(self.value_tuple(run), ('207039.73', '39543.45', '246588.68'))
        self.assertEqual(self.value_tuple(run), self.value_tuple(reversed_run))
        state = self.state(run)
        commission_ids = {row['id_saida'] for row in state['results']['comissoes']}
        self.assertFalse(any(row['ref_origem'] == 'T-1' and row['id_saida'] in commission_ids for row in state['results']['rastro']))
        issues = [row for row in state['results']['pendencias'] if row['tipo'] == 'DUPLICIDADE_CONFLITANTE']
        self.assertTrue(any(row['ref_origem'] == 'T-1' for row in issues))
        counts = state['ingestion_counts']['by_role']['orbe']
        self.assertEqual((counts['rows_conflicting'], counts['conflicting_ids']), (2, 1))

    def test_child_revision_keeps_old_decisions_approval_snapshots_and_downloads(self):
        parent = self.start(draft=False)
        ident = parent['id']
        blockers = self.client.get(f'/api/runs/{ident}/exceptions', params={'severidade': 'bloqueante', 'page_size': 500}).json()['exceptions']
        self.assertTrue(blockers)
        for issue in blockers:
            response = self.client.post(f'/api/runs/{ident}/exceptions/{issue["id"]}/decision', headers=self.actor,
                json={'acao': 'aceitar', 'justificativa': 'Aprovação sintética em banco temporário para verificar isolamento de versões.'})
            self.assertEqual(response.status_code, 200, response.text)
        response = self.client.post(f'/api/runs/{ident}/approval', headers=self.actor,
            json={'decisao': 'aprovar', 'comentario': 'Apenas regressão isolada; nenhuma aprovação real.'})
        self.assertEqual(response.status_code, 200, response.text)
        approved = self.wait(ident)
        self.assertEqual(approved['status'], 'done')
        prior_audit = self.client.get(f'/api/runs/{ident}/audit').json()
        prior_package = self.client.get(f'/api/runs/{ident}/export').content
        old_official = {name: self.client.get('/api/export', params={'file': name, 'run_id': ident}).content for name in OFFICIAL_HEADERS}
        old_hashes = {str(path.relative_to(approved['directory'])): hashlib.sha256(path.read_bytes()).hexdigest()
                      for path in Path(approved['directory']).rglob('*') if path.is_file()}
        supplement = self.upload('complemento.csv', orbe_bytes())
        child = self.start([supplement], draft=False, parent_run_id=ident)
        self.assertEqual(child['status'], 'awaiting_approval')
        self.assertEqual(child['parent_run_id'], ident)
        self.assertIsNone(child['approval'])
        self.assertEqual(child['exports'], [])
        self.assertEqual(len(child['snapshot']['sources']), 7)
        self.assertEqual(self.state(child)['summary']['checkout_count'], 1944)
        summary = self.client.get(f'/api/runs/{child["id"]}/approval-summary').json()
        self.assertEqual(summary['decided'], 0)
        self.assertGreater(child['blocking_open'], 0)
        self.assertEqual(self.client.get(f'/api/runs/{child["id"]}/export').status_code, 409)
        self.assertEqual(self.client.get(f'/api/runs/{ident}/audit').json(), prior_audit)
        self.assertEqual(self.client.get(f'/api/runs/{ident}/export').content, prior_package)
        self.assertEqual(old_hashes, {str(path.relative_to(approved['directory'])): hashlib.sha256(path.read_bytes()).hexdigest()
                                    for path in Path(approved['directory']).rglob('*') if path.is_file()})
        current = self.client.get(f'/api/runs/{ident}').json()
        self.assertEqual(current['approval'], approved['approval'])
        for name, prior in old_official.items():
            response = self.client.get('/api/export', params={'file': name, 'run_id': ident})
            self.assertEqual(response.content, prior)
            fields = next(csv.reader(io.StringIO(response.content.decode()), delimiter=';'))
            self.assertEqual(fields, OFFICIAL_HEADERS[name])
        conference_package = self.client.get('/api/export.zip', params={'run_id': ident})
        # The dedicated six-file export is checked independently of the ERP package.
        self.assertEqual(conference_package.status_code, 200, conference_package.text[:500])
        with zipfile.ZipFile(io.BytesIO(conference_package.content)) as archive:
            for name, prior in old_official.items():
                self.assertEqual(archive.read(name), prior)


if __name__ == '__main__':
    unittest.main()
