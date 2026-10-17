"""Persisted deterministic workflow with immutable inputs and a human approval gate.

Execution metadata (run IDs, actors and clocks) is deliberately separate from
reproducible dataset/content hashes. No network or LLM is used by this service.
"""
from __future__ import annotations

import copy
import csv
import hashlib
import io
import json
import re
import shutil
import sqlite3
import subprocess
import threading
import traceback
import uuid
import zipfile
from contextlib import nullcontext
from datetime import date, datetime, timezone
from decimal import Decimal, InvalidOperation
from pathlib import Path

from . import registry, datasets as dataset_io
from .steps import execute_step, _adjusted_ledger
from ..importer import load_data

ROOT = Path(__file__).resolve().parents[2]
# Repository root, also searched for next-month packs (Tarvo_Data_Pack_*).
PACKS_ROOT = ROOT.parent.parent
ACTIVE = {'queued', 'running', 'awaiting_approval', 'approved', 'exporting'}
TERMINAL = {'done', 'failed', 'rejected'}
FILE_ROLES = {
    'orbe': re.compile(r'^01.*comissoes.*\.csv$', re.I),
    'taxas': re.compile(r'^02.*\.xlsx$', re.I),
    'ponte': re.compile(r'^03.*\.eml$', re.I),
    'contas': re.compile(r'^04.*\.csv$', re.I),
    'aurora': re.compile(r'^05a.*\.csv$', re.I),
    'meridiano': re.compile(r'^05b.*\.ofx$', re.I),
}
DEFAULT_CHECKLIST = [
    {'id': 'mdr', 'area': 'Adquirência', 'title': 'Conferir taxas MDR cobradas pela Orbe', 'step_type': 'conferir_mdr'},
    {'id': 'estornos', 'area': 'Adquirência', 'title': 'Tratar estornos e reversões', 'step_type': 'vincular_estornos'},
    {'id': 'aurora', 'area': 'Bancos', 'title': 'Conciliar Banco Aurora', 'step_type': 'conciliar_aurora'},
    {'id': 'cambio', 'area': 'Câmbio', 'title': 'Apurar receita de intermediação', 'step_type': 'processar_cambio'},
    {'id': 'aprovacao', 'area': 'Contabilidade', 'title': 'Revisar e aprovar lançamentos', 'step_type': 'aprovacao'},
    {'id': 'exportar', 'area': 'Contabilidade', 'title': 'Exportar para o Fênix', 'step_type': 'exportar_erp'},
    {'id': 'taxas', 'area': 'Comercial', 'title': 'Atualizar tabela de taxas', 'manual': True},
]


def _json(value):
    return json.dumps(value, ensure_ascii=False, sort_keys=True, separators=(',', ':'), default=str, allow_nan=False)


def _hash(value):
    return hashlib.sha256(_json(value).encode()).hexdigest()


def _now():
    return datetime.now(timezone.utc).isoformat(timespec='microseconds')


def _sha(path):
    return hashlib.sha256(Path(path).read_bytes()).hexdigest()


def _source_code_snapshot(destination=None):
    """Read each file once so archived bytes and their hash cannot diverge."""
    items = []
    paths = sorted((ROOT / 'src').rglob('*.py')) + sorted((ROOT / 'src' / 'config').glob('*.json'))
    for path in paths:
        relative = path.relative_to(ROOT).as_posix()
        content = path.read_bytes()
        items.append({'name': relative, 'sha256': hashlib.sha256(content).hexdigest(), 'size': len(content)})
        if destination is not None:
            target = Path(destination) / relative
            target.parent.mkdir(parents=True, exist_ok=True)
            target.write_bytes(content)
            target.chmod(0o444)
    return {'files': items, 'content_hash': _hash(items)}


# Captured when this module and its step handlers are imported, not when a new
# service instance is constructed. Recreating an instance in the same Python
# process does not reload imported functions and must not bless changed bytes.
_IMPORTED_CODE_HASH = _source_code_snapshot()['content_hash']


class ServiceError(ValueError):
    def __init__(self, status, code, message, details=None):
        super().__init__(message)
        self.status = status
        self.code = code
        self.message = message
        self.details = details or []


class PipelineService:
    def __init__(self, db_path, source_dir, runs_dir):
        self.lock = threading.RLock()
        self.loaded_code_hash = _IMPORTED_CODE_HASH
        self.source_dir = Path(source_dir).expanduser().resolve()
        self.runs_dir = Path(runs_dir).expanduser().resolve()
        self.runs_dir.mkdir(parents=True, exist_ok=True)
        self.upload_dir = self.runs_dir.parent / 'workflow_uploads'
        self.upload_dir.mkdir(parents=True, exist_ok=True)
        Path(db_path).parent.mkdir(parents=True, exist_ok=True)
        self.db = sqlite3.connect(str(db_path), check_same_thread=False)
        self.db.row_factory = sqlite3.Row
        self.db.execute('PRAGMA journal_mode=WAL')
        self.db.executescript('''
          CREATE TABLE IF NOT EXISTS wf_pipelines (
            pipeline_id TEXT, version INTEGER, definition TEXT, content_hash TEXT,
            actor TEXT, created_at TEXT, PRIMARY KEY(pipeline_id,version));
          CREATE TABLE IF NOT EXISTS wf_files (id TEXT PRIMARY KEY, data TEXT NOT NULL);
          CREATE TABLE IF NOT EXISTS wf_runs (id TEXT PRIMARY KEY, competencia TEXT, status TEXT, data TEXT NOT NULL);
          CREATE TABLE IF NOT EXISTS wf_events (id INTEGER PRIMARY KEY AUTOINCREMENT, run_id TEXT, data TEXT NOT NULL);
          CREATE INDEX IF NOT EXISTS wf_events_run ON wf_events(run_id,id);
          CREATE TABLE IF NOT EXISTS wf_audit (id INTEGER PRIMARY KEY AUTOINCREMENT, run_id TEXT, data TEXT NOT NULL);
          CREATE TABLE IF NOT EXISTS wf_exceptions (run_id TEXT, id TEXT, data TEXT NOT NULL, PRIMARY KEY(run_id,id));
          CREATE TABLE IF NOT EXISTS wf_decisions (id INTEGER PRIMARY KEY AUTOINCREMENT, run_id TEXT, exception_id TEXT, data TEXT NOT NULL);
          CREATE TABLE IF NOT EXISTS wf_tasks (id TEXT PRIMARY KEY, competencia TEXT, data TEXT NOT NULL);
        ''')
        self.threads = {}
        self.stopping = False
        self._row_cache = {}
        with self.lock, self.db:
            definition = registry.default_definition()
            if not self.db.execute('SELECT 1 FROM wf_pipelines WHERE pipeline_id=?', (definition['id'],)).fetchone():
                definition = copy.deepcopy(definition)
                definition['version'] = 1
                self._insert_definition(definition, 'Sistema')
            # A process cannot resume an executing Python stack. Paused reviews can resume safely.
            for row in self.db.execute("SELECT data FROM wf_runs WHERE status IN ('queued','running','approved','exporting')").fetchall():
                run = json.loads(row['data'])
                run.update(status='failed', finished_at=_now(), error={'code': 'EXECUTION_INTERRUPTED', 'message': 'Execução interrompida pelo reinício. Inicie um novo run com as fontes preservadas.'})
                for step in run['steps']:
                    if step['status'] == 'running': step['status'] = 'failed'
                    elif step['status'] == 'pending': step['status'] = 'skipped'
                self._save_run(run)
                self._audit(run['id'], 'execution_interrupted', 'Sistema', run['error'])
                self._event(run['id'], 'run_finished', status='failed', error=run['error'])

    def _actor(self, actor):
        value = str(actor or '').strip()
        if not value or len(value) > 120:
            raise ServiceError(422, 'ACTOR_REQUIRED', 'Informe X-User com o nome de quem executa a ação (até 120 caracteres).')
        return value

    def _period(self, value):
        if not isinstance(value, str) or not re.fullmatch(r'\d{4}-(0[1-9]|1[0-2])', value):
            raise ServiceError(422, 'INVALID_PERIOD', 'Competência deve usar AAAA-MM.')
        return value

    def _run(self, ident):
        row = self.db.execute('SELECT data FROM wf_runs WHERE id=?', (ident,)).fetchone()
        if not row: raise ServiceError(404, 'RUN_NOT_FOUND', 'Execução não encontrada.')
        return json.loads(row['data'])

    def _save_run(self, run):
        self.db.execute('INSERT OR REPLACE INTO wf_runs VALUES (?,?,?,?)', (run['id'], run['competencia'], run['status'], _json(run)))

    def _audit(self, run_id, action, actor, details):
        record = {'run_id': run_id, 'action': action, 'actor': actor, 'at': _now(), 'details': details}
        cursor = self.db.execute('INSERT INTO wf_audit(run_id,data) VALUES (?,?)', (run_id, _json(record)))
        return {**record, 'id': cursor.lastrowid}

    def _event(self, run_id, kind, **fields):
        event = {'type': kind, 'run_id': run_id, 'at': _now(), **fields}
        cursor = self.db.execute('INSERT INTO wf_events(run_id,data) VALUES (?,?)', (run_id, _json(event)))
        return {**event, 'id': cursor.lastrowid, 'sequence': cursor.lastrowid}

    def catalog(self):
        return copy.deepcopy(registry.catalog())

    def _insert_definition(self, definition, actor):
        self.db.execute('INSERT INTO wf_pipelines VALUES (?,?,?,?,?,?)',
                        (definition['id'], definition['version'], _json(definition), _hash(definition), actor, _now()))

    def get_pipeline(self, ident, version=None):
        with self.lock:
            if version is None:
                row = self.db.execute('SELECT * FROM wf_pipelines WHERE pipeline_id=? ORDER BY version DESC LIMIT 1', (ident,)).fetchone()
            else:
                try: version = int(version)
                except (TypeError, ValueError): raise ServiceError(422, 'INVALID_VERSION', 'Versão deve ser inteira.')
                row = self.db.execute('SELECT * FROM wf_pipelines WHERE pipeline_id=? AND version=?', (ident, version)).fetchone()
            if not row: raise ServiceError(404, 'PIPELINE_NOT_FOUND', 'Pipeline ou versão não encontrado.')
            return {**json.loads(row['definition']), 'content_hash': row['content_hash'], 'created_at': row['created_at'], 'created_by': row['actor']}

    def versions(self, ident):
        with self.lock:
            rows = self.db.execute('SELECT * FROM wf_pipelines WHERE pipeline_id=? ORDER BY version DESC', (ident,)).fetchall()
            if not rows: raise ServiceError(404, 'PIPELINE_NOT_FOUND', 'Pipeline não encontrado.')
            return [{'id': ident, 'version': r['version'], 'content_hash': r['content_hash'], 'created_at': r['created_at'], 'created_by': r['actor']} for r in rows]

    def validate_pipeline(self, ident, definition):
        if not isinstance(definition, dict):
            raise ServiceError(422, 'INVALID_PIPELINE', 'Definição deve ser um objeto JSON.')
        definition = {k: copy.deepcopy(v) for k, v in definition.items() if k not in ('content_hash', 'created_at', 'created_by')}
        definition['id'] = ident
        errors = registry.validate_definition(definition)
        if isinstance(errors, dict): errors = errors.get('errors', [])
        return {'valid': not errors, 'errors': errors}

    def save_pipeline(self, ident, definition, actor):
        actor = self._actor(actor)
        validated = self.validate_pipeline(ident, definition)
        if not validated['valid']:
            raise ServiceError(422, 'INVALID_PIPELINE', 'Corrija os parâmetros e a ordem dos passos.', validated['errors'])
        with self.lock, self.db:
            last = self.db.execute('SELECT MAX(version) FROM wf_pipelines WHERE pipeline_id=?', (ident,)).fetchone()[0] or 0
            saved = {k: copy.deepcopy(v) for k, v in definition.items() if k not in ('content_hash', 'created_at', 'created_by')}
            saved.update(id=ident, version=last + 1)
            self._insert_definition(saved, actor)
            self._audit(None, 'pipeline_saved', actor, {'pipeline_id': ident, 'version': saved['version'], 'content_hash': _hash(saved)})
        return self.get_pipeline(ident, saved['version'])

    @staticmethod
    def _role(name):
        if Path(name).name != name or '\\' in name or not name or len(name) > 200:
            raise ServiceError(422, 'INVALID_FILENAME', 'Use somente o nome original do arquivo, sem diretórios.')
        matches = [role for role, pattern in FILE_ROLES.items() if pattern.fullmatch(name)]
        if len(matches) != 1:
            raise ServiceError(422, 'UNSUPPORTED_FILE', 'Arquivo não corresponde a uma das seis fontes do fechamento.')
        return matches[0]

    def upload_file(self, filename, content, actor):
        actor = self._actor(actor)
        role = self._role(filename)
        if not isinstance(content, bytes) or not content or len(content) > 64 * 1024 * 1024:
            raise ServiceError(422, 'INVALID_FILE', 'Arquivo vazio ou maior que 64 MB.')
        ident = 'file-' + uuid.uuid4().hex
        directory = self.upload_dir / ident
        directory.mkdir()
        path = directory / filename
        path.write_bytes(content)
        path.chmod(0o444)
        record = {'id': ident, 'file_id': ident, 'name': filename, 'role': role, 'path': str(path), 'sha256': _sha(path), 'size': len(content), 'created_at': _now(), 'actor': actor}
        with self.lock, self.db:
            self.db.execute('INSERT INTO wf_files VALUES (?,?)', (ident, _json(record)))
            self._audit(None, 'file_uploaded', actor, {k: v for k, v in record.items() if k != 'path'})
        return {k: v for k, v in record.items() if k != 'path'}

    def _input_files(self, payload, period):
        if payload.get('file_ids') is not None:
            ids = payload['file_ids']
            if not isinstance(ids, list) or not ids or any(not isinstance(item, str) for item in ids) or len(ids) != len(set(ids)):
                raise ServiceError(422, 'INVALID_FILE_SELECTION', 'Selecione seis arquivos distintos.')
            files = []
            for ident in ids:
                row = self.db.execute('SELECT data FROM wf_files WHERE id=?', (str(ident),)).fetchone()
                if not row: raise ServiceError(404, 'FILE_NOT_FOUND', 'Um arquivo selecionado não existe.', [{'file_id': ident}])
                record = json.loads(row['data'])
                if _sha(record['path']) != record['sha256']:
                    raise ServiceError(409, 'INPUT_CHANGED', 'Arquivo enviado mudou desde o upload; envie uma nova cópia.')
                files.append(record)
        else:
            if payload.get('source_dir'):
                source = Path(payload['source_dir']).expanduser().resolve()
            else:
                month_names = ['jan', 'fev', 'mar', 'abr', 'mai', 'jun', 'jul', 'ago', 'set', 'out', 'nov', 'dez']
                names = [f'Tarvo_Data_Pack_{period}', f'Tarvo_Data_Pack_{month_names[int(period[5:])-1]}{period[:4]}']
                default_periods = set()
                if self.source_dir.is_dir():
                    try:
                        existing = load_data(self.source_dir)
                        default_periods = {r.get('date', '')[:7] for r in existing.get('checkout', []) + existing.get('bank', [])}
                        default_periods |= {r.get('contracted_date', '')[:7] for r in existing.get('remittances', [])}
                    except Exception as exc:
                        raise ServiceError(422, 'INPUT_UNREADABLE', 'A fonte padrão não pôde ser interpretada; indique uma pasta válida.', [{'reason': str(exc)}]) from exc
                if period in default_periods:
                    source = self.source_dir
                else:
                    roots = {self.source_dir.parent, PACKS_ROOT}
                    candidates = sorted({(base / name).resolve() for base in roots for name in names if (base / name).is_dir()})
                    if len(candidates) > 1:
                        raise ServiceError(422, 'SOURCE_DIRECTORY_AMBIGUOUS', 'Mais de uma pasta corresponde à competência; indique source_dir ou envie os seis arquivos.', [{'paths': [str(p) for p in candidates]}])
                    source = candidates[0] if candidates else self.source_dir
            if not source.is_dir(): raise ServiceError(422, 'SOURCE_NOT_FOUND', 'Pasta de fontes não encontrada.')
            files = []
            for path in sorted(source.iterdir()):
                if path.is_file() and any(p.fullmatch(path.name) for p in FILE_ROLES.values()):
                    files.append({'name': path.name, 'path': str(path), 'role': self._role(path.name), 'sha256': _sha(path), 'size': path.stat().st_size})
        grouped = {role: [f for f in files if f['role'] == role] for role in FILE_ROLES}
        errors = [{'role': role, 'count': len(rows), 'message': 'Fonte obrigatória ausente.' if not rows else 'Fontes ambíguas para a mesma função.'} for role, rows in grouped.items() if len(rows) != 1]
        if errors: raise ServiceError(422, 'REQUIRED_SOURCES', 'São necessárias as seis fontes, sem duplicidades.', errors)
        return sorted(files, key=lambda f: f['name'])

    def _code_snapshot(self, destination=None):
        return _source_code_snapshot(destination)

    def _assert_loaded_code(self, snapshot=None):
        code = snapshot if snapshot is not None else self._code_snapshot()
        if code['content_hash'] != self.loaded_code_hash:
            raise ServiceError(409, 'CODE_RESTART_REQUIRED', 'Os arquivos de código mudaram desde que o processo foi iniciado. Reinicie o serviço antes de iniciar uma nova execução.')
        return code

    def start_run(self, payload, actor, references=None):
        actor = self._actor(actor)
        if not isinstance(payload, dict): raise ServiceError(422, 'INVALID_REQUEST', 'Envie um objeto JSON.')
        period = self._period(payload.get('competencia', payload.get('period')))
        ident = 'run-' + uuid.uuid4().hex
        directory = self.runs_dir / ident
        with self.lock, self.db:
            if self.stopping: raise ServiceError(409, 'SERVICE_STOPPING', 'Serviço encerrando.')
            self._assert_loaded_code()
            draft = payload.get('draft', False)
            if not isinstance(draft, bool): raise ServiceError(422, 'INVALID_DRAFT', 'draft deve ser booleano.')
            active = [json.loads(row['data']) for row in self.db.execute("SELECT data FROM wf_runs WHERE competencia=? AND status IN ('queued','running','awaiting_approval','approved','exporting')", (period,))]
            active = next((run for run in active if not run.get('draft')), None)
            if active and not draft: raise ServiceError(409, 'PERIOD_BUSY', 'Já existe uma execução ativa ou aguardando revisão nesta competência.', [{'id': active['id'], 'status': active['status']}])
            definition = self.get_pipeline(payload.get('pipeline_id', 'fechamento-tarvo'), payload.get('version', payload.get('pipeline_version')))
            pure_definition = {k: v for k, v in definition.items() if k not in ('content_hash', 'created_at', 'created_by')}
            if payload.get('steps') is not None:
                if not draft: raise ServiceError(422, 'DRAFT_REQUIRED', 'Passos não salvos só podem ser executados como teste.')
                pure_definition['steps'] = copy.deepcopy(payload['steps'])
            errors = self.validate_pipeline(definition['id'], pure_definition)['errors']
            if errors: raise ServiceError(422, 'INVALID_PIPELINE', 'Pipeline inválido.', errors)
            files = self._input_files(payload, period)
            input_dir = directory / 'inputs'
            input_dir.mkdir(parents=True)
            sources = []
            for source in files:
                target = input_dir / source['name']
                shutil.copyfile(source['path'], target)
                if _sha(target) != source['sha256']:
                    raise ServiceError(409, 'INPUT_CHANGED', 'Fonte mudou durante a captura; tente novamente.')
                target.chmod(0o444)
                sources.append({**{k: v for k, v in source.items() if k != 'path'}, 'original_path': source['path'], 'snapshot_path': str(target)})
            try: imported = load_data(input_dir)
            except Exception as exc: raise ServiceError(422, 'INPUT_UNREADABLE', 'Uma fonte não pôde ser interpretada.', [{'reason': str(exc)}]) from exc
            observed = {r.get('date', '')[:7] for r in imported.get('checkout', []) + imported.get('bank', [])}
            observed |= {r.get('contracted_date', '')[:7] for r in imported.get('remittances', [])}
            if period not in observed:
                raise ServiceError(422, 'PERIOD_WITHOUT_INPUTS', 'Os arquivos enviados não contêm movimentos desta competência.', [{'competencia': period, 'observed_periods': sorted(observed - {''})}])
            for source in sources:
                info = next((s for s in imported.get('sources', []) if s['name'] == source['name']), {})
                discarded = sum(w.get('source_file') == source['name'] and w.get('type') == 'LINHA_INVALIDA' for w in imported.get('import_warnings', []))
                source.update(rows_read=info.get('rows', 0), rows_discarded=discarded)
            code = self._assert_loaded_code(self._code_snapshot(directory / 'code_snapshot'))
            try:
                result = subprocess.run(['git', 'rev-parse', 'HEAD'], cwd=ROOT, capture_output=True, text=True, timeout=3)
                commit = result.stdout.strip() if result.returncode == 0 else None
            except (OSError, subprocess.TimeoutExpired): commit = None
            snapshot = {'definition': pure_definition, 'pipeline_hash': _hash(pure_definition), 'sources': sources, 'source_content_hash': _hash([{'name': s['name'], 'sha256': s['sha256']} for s in sources]), 'code': code, 'loaded_code_hash': self.loaded_code_hash, 'git_commit': commit, 'step_versions': {c['type']: c['version'] for c in self.catalog()}, 'effective_parameters': {s['id']: registry.effective_params(s['type'], s.get('params', {})) for s in pure_definition['steps']}, 'reference_source': 'Cópia imutável dos seis arquivos; cadastros do fechamento legado não são usados.', 'import_warnings': imported.get('import_warnings', [])}
            if references is not None:
                expected = references.get('source_hashes', {})
                actual = {s['name']: s['sha256'] for s in sources}
                if expected != actual:
                    raise ServiceError(409, 'REFERENCE_SOURCE_CHANGED', 'As fontes do cadastro e da execução diferem. Reimporte o pacote antes de executar com os cadastros revisados.')
                snapshot['references'] = copy.deepcopy(references)
                snapshot['references_hash'] = _hash(references)
                snapshot['reference_source'] = 'Cadastros, taxas e parâmetros revisados, capturados de forma imutável nesta execução.'
            run = {'draft': draft, 'source': 'upload' if payload.get('file_ids') is not None else 'folder' if payload.get('source_dir') else 'pack', 'source_dir': payload.get('source_dir'), 'id': ident, 'run_id': ident, 'competencia': period, 'period': period, 'status': 'queued', 'pipeline_id': definition['id'], 'pipeline_version': definition['version'], 'created_at': _now(), 'created_by': actor, 'started_at': None, 'finished_at': None, 'directory': str(directory), 'snapshot': snapshot, 'datasets': {}, 'approval': None, 'exports': [], 'steps': [{'id': s['id'], 'type': s['type'], 'params': snapshot['effective_parameters'][s['id']], 'status': 'pending', 'metrics': {}, 'outputs': [], 'datasets': [], 'started_at': None, 'finished_at': None} for s in pure_definition['steps']]}
            (directory / 'snapshot.json').write_text(_json(snapshot), encoding='utf-8')
            (directory / 'snapshot.json').chmod(0o444)
            self._save_run(run)
            self._audit(ident, 'run_created', actor, {'snapshot': snapshot, 'execution_metadata_is_nondeterministic': True})
            self._event(ident, 'run_queued', status='queued')
        self._launch(ident)
        return {'id': ident, 'run_id': ident, 'status': 'queued', 'competencia': period}

    def _launch(self, ident):
        with self.lock:
            if self.stopping: return
            thread = threading.Thread(target=self._execute, args=(ident,), name='tarvo-' + ident, daemon=True)
            self.threads[ident] = thread
            thread.start()

    def _exceptions(self, ident):
        return [json.loads(r['data']) for r in self.db.execute('SELECT data FROM wf_exceptions WHERE run_id=? ORDER BY rowid', (ident,))]

    def _adjustments(self, ident):
        latest = {}
        for row in self.db.execute('SELECT exception_id,data FROM wf_decisions WHERE run_id=? ORDER BY id', (ident,)):
            latest[row['exception_id']] = json.loads(row['data'])
        return [d for d in latest.values() if d['acao'] in ('ajustar', 'excluir')]

    def _context(self, run):
        data = {}
        for name, meta in run['datasets'].items():
            path = Path(meta['path'])
            if _sha(path) != meta['sha256']:
                raise ServiceError(409, 'DATASET_CHANGED', 'Uma saída imutável foi alterada; inicie novo run.', [{'dataset': name}])
            data[name] = dataset_io.read_dataset(path)
        return {'references': copy.deepcopy(run['snapshot'].get('references', {})), 'period': run['competencia'], 'source_dir': str(Path(run['directory']) / 'inputs'), 'datasets': data, 'scratch': {}, 'run_dir': run['directory'], 'export_dir': str(Path(run['directory']) / 'export'), 'exceptions': self._exceptions(run['id']), 'adjustments': self._adjustments(run['id']), 'approved': bool(run.get('approval') and run['approval']['decisao'] == 'aprovar')}

    def _assert_snapshot(self, run):
        for source in run['snapshot']['sources']:
            if _sha(source['snapshot_path']) != source['sha256']:
                raise ServiceError(409, 'INPUT_CHANGED', 'A cópia de uma fonte foi alterada; inicie novo run.')
        if self._code_snapshot()['content_hash'] != run['snapshot']['code']['content_hash']:
            raise ServiceError(409, 'CODE_CHANGED', 'O código mudou desde o início desta execução. Inicie novo run para usar a nova versão.')

    def _execute(self, ident):
        current_step = None
        try:
            with self.lock, self.db:
                run = self._run(ident)
                if run['status'] not in ('queued', 'approved'): return
                self._assert_snapshot(run)
                continuing = run['status'] == 'approved'
                run['status'] = 'exporting' if continuing else 'running'
                if not run['started_at']: run['started_at'] = _now()
                self._save_run(run)
                self._event(ident, 'run_started' if not continuing else 'export_started', status=run['status'])
                ctx = self._context(run)
            for index, definition in enumerate(run['snapshot']['definition']['steps']):
                current_step = definition['id']
                effective_params = run['snapshot'].get('effective_parameters', {}).get(current_step, definition.get('params', {}))
                with self.lock, self.db:
                    fresh = self._run(ident)
                    if self.stopping: raise RuntimeError('Serviço encerrado durante execução; inicie novo run.')
                    state = fresh['steps'][index]
                    if state['status'] in ('done', 'done_with_exceptions'): continue
                    if fresh['status'] not in ('running', 'exporting'): return
                    if fresh.get('draft') and definition['type'] in ('aprovacao', 'exportar_erp'):
                        state.update(status='skipped', finished_at=_now(), logs=['Teste de pipeline: aprovação e exportação indisponíveis.'])
                        self._save_run(fresh)
                        self._event(ident, 'step_finished', step_id=current_step, status='skipped', metrics={}, duration_ms=0)
                        continue
                    if definition['type'] == 'aprovacao':
                        state.update(status='running', started_at=_now())
                        self._event(ident, 'step_started', step_id=current_step, step_type=definition['type'])
                        self._audit(ident, 'step_started', 'Sistema', {'step_id': current_step, 'params': effective_params, 'step_version': fresh['snapshot']['step_versions'].get(definition['type'])})
                        gate = execute_step(definition['type'], ctx, effective_params)
                        gate_result = gate if isinstance(gate, dict) else vars(gate)
                        gate_outputs = []
                        for name, rows in gate_result.get('datasets', {}).items():
                            destination = Path(run['directory']) / 'steps' / current_step / (name + '.parquet')
                            destination.parent.mkdir(parents=True, exist_ok=True)
                            meta = dataset_io.write_dataset(destination, rows)
                            meta.update(name=name, dataset=name, step_id=current_step, path=str(destination), sha256=_sha(destination), rows=len(rows))
                            destination.chmod(0o444)
                            fresh['datasets'][name] = meta
                            gate_outputs.append(meta)
                            ctx['datasets'][name] = rows
                        state.update(outputs=gate_outputs, datasets=[m['name'] for m in gate_outputs], metrics=gate_result.get('metrics', {}), logs=gate_result.get('logs', []))
                        fresh['status'] = 'awaiting_approval'
                        self._save_run(fresh)
                        self._audit(ident, 'approval_requested', 'Sistema', {'step_id': current_step, 'datasets': gate_outputs})
                        self._event(ident, 'awaiting_approval', step_id=current_step, exceptions_open=sum(e['status'] == 'open' for e in self._exceptions(ident)), exceptions_total=len(self._exceptions(ident)), blocking_open=sum(e['status'] == 'open' and e.get('severidade') == 'bloqueante' for e in self._exceptions(ident)))
                        return
                    state.update(status='running', started_at=_now())
                    self._save_run(fresh)
                    self._event(ident, 'step_started', step_id=current_step, step_type=definition['type'])
                    self._audit(ident, 'step_started', 'Sistema', {'step_id': current_step, 'params': effective_params, 'step_version': fresh['snapshot']['step_versions'].get(definition['type'])})
                started = datetime.now(timezone.utc)
                def progress(done=0, total=0, **extra):
                    if isinstance(done, dict): extra = {**done, **extra}; done = extra.pop('done', 0); total = extra.pop('total', total)
                    with self.lock, self.db: self._event(ident, 'step_progress', step_id=current_step, done=done, total=total, **extra)
                ctx['progress'] = progress
                ctx['step_id'] = current_step
                if definition['type'] == 'exportar_erp':
                    if not ctx['approved']: raise ServiceError(409, 'APPROVAL_REQUIRED', 'Exportação exige aprovação explícita.')
                    self._assert_snapshot(self._run(ident))
                result = execute_step(definition['type'], ctx, effective_params)
                results = result if isinstance(result, dict) else vars(result)
                produced = results.get('datasets', {})
                exceptions = results.get('exceptions', [])
                output_meta = []
                for name, rows in produced.items():
                    if not re.fullmatch(r'[A-Za-z0-9_-]+', name): raise ValueError('Nome inválido de dataset produzido.')
                    destination = Path(run['directory']) / 'steps' / current_step / (name + '.parquet')
                    destination.parent.mkdir(parents=True, exist_ok=True)
                    if destination.exists(): raise ValueError('Uma saída imutável já existe para este passo.')
                    meta = dataset_io.write_dataset(destination, rows)
                    if not isinstance(meta, dict): meta = {}
                    meta = {**meta, 'name': name, 'dataset': name, 'step_id': current_step, 'path': str(destination), 'sha256': _sha(destination), 'rows': len(rows)}
                    destination.chmod(0o444)
                    output_meta.append(meta)
                    ctx['datasets'][name] = rows
                duration = round((datetime.now(timezone.utc) - started).total_seconds() * 1000)
                with self.lock, self.db:
                    fresh = self._run(ident)
                    for n, exc in enumerate(exceptions):
                        item = copy.deepcopy(exc)
                        item.setdefault('id', 'exc-' + _hash({'step': current_step, 'index': n, 'data': item})[:20])
                        item.update(step_id=current_step, status='open', decision=None)
                        item.setdefault('severidade', item.get('severity', 'alerta'))
                        item.setdefault('descricao', item.get('motivo', item.get('message', 'Revisão necessária.')))
                        item.setdefault('impacto_rs', item.get('valor_brl', '0.00'))
                        item.setdefault('tipo', item.get('type', 'REVISAO'))
                        previous = self.db.execute('SELECT 1 FROM wf_exceptions WHERE run_id=? AND id=?', (ident, item['id'])).fetchone()
                        if previous: item['id'] = current_step + '-' + item['id']
                        self.db.execute('INSERT INTO wf_exceptions VALUES (?,?,?)', (ident, item['id'], _json(item)))
                    state = fresh['steps'][index]
                    state.update(status='done_with_exceptions' if exceptions else 'done', finished_at=_now(), duration_ms=duration, metrics=results.get('metrics', {}), outputs=output_meta, datasets=[m['name'] for m in output_meta], logs=results.get('logs', []))
                    for meta in output_meta: fresh['datasets'][meta['name']] = meta
                    if definition['type'] == 'exportar_erp': fresh['exports'] = self._collect_exports(fresh, produced)
                    self._save_run(fresh)
                    self._audit(ident, 'step_finished', 'Sistema', {'step_id': current_step, 'status': state['status'], 'params': effective_params, 'metrics': state['metrics'], 'duration_ms': duration, 'datasets': output_meta, 'exceptions': exceptions, 'logs': state['logs']})
                    self._event(ident, 'step_finished', step_id=current_step, status=state['status'], metrics=state['metrics'], duration_ms=duration, datasets=output_meta, output_hash=self._output_hash(state))
                    ctx['exceptions'] = self._exceptions(ident)
            with self.lock, self.db:
                final = self._run(ident)
                if not final.get('draft') and (not final.get('approval') or final['approval']['decisao'] != 'aprovar'):
                    raise ServiceError(409, 'APPROVAL_REQUIRED', 'Run não pode concluir sem aprovação.')
                final.update(status='done', finished_at=_now())
                self._save_run(final)
                self._audit(ident, 'run_finished', 'Sistema', {'status': 'done', 'exports': final['exports']})
                self._event(ident, 'run_finished', status='done')
                if not final.get('draft'): self._write_audit_export(final)
        except Exception as exc:
            with self.lock, self.db:
                failed = self._run(ident)
                failed.update(status='failed', finished_at=_now(), error={'code': getattr(exc, 'code', 'STEP_FAILED'), 'message': str(exc), 'step_id': current_step})
                for step in failed['steps']:
                    if step['status'] == 'running': step.update(status='failed', finished_at=_now())
                    elif step['status'] == 'pending': step['status'] = 'skipped'
                self._save_run(failed)
                self._audit(ident, 'run_failed', 'Sistema', {'error': failed['error'], 'traceback': traceback.format_exc()})
                self._event(ident, 'run_finished', status='failed', error=failed['error'])
        finally:
            with self.lock:
                if self.threads.get(ident) is threading.current_thread(): self.threads.pop(ident, None)

    def _collect_exports(self, run, produced):
        folder = Path(run['directory']) / 'export'
        files = []
        for item in produced.get('export_manifest', []):
            name = item.get('name')
            if not name or Path(name).name != name: continue
            target = folder / name
            if target.is_file(): files.append({**item, 'path': str(target), 'name': name, 'sha256': _sha(target), 'size': target.stat().st_size})
        if not files and folder.exists():
            for target in sorted(folder.iterdir()):
                if target.is_file() and target.name != 'auditoria.json': files.append({'name': target.name, 'path': str(target), 'sha256': _sha(target), 'size': target.stat().st_size})
        if not files: raise ValueError('Passo de exportação não produziu arquivos.')
        for item in files: Path(item['path']).chmod(0o444)
        return files

    def _write_audit_export(self, run):
        directory = Path(run['directory']) / 'export'
        directory.mkdir(exist_ok=True)
        audit = self.audit(run['id'])
        audit['reproducibility'] = {'content_hashes': {name: meta['sha256'] for name, meta in run['datasets'].items()}, 'execution_metadata': 'IDs, usuários, timestamps e durações pertencem a esta execução e não entram na comparação dos hashes de conteúdo.'}
        path = directory / 'auditoria.json'
        if path.exists(): raise ValueError('Auditoria exportada já existe.')
        path.write_text(_json(audit), encoding='utf-8')
        path.chmod(0o444)
        run['exports'].append({'name': path.name, 'path': str(path), 'sha256': _sha(path), 'size': path.stat().st_size, 'reproducible': False})
        self._save_run(run)
        self._audit(run['id'], 'audit_file_exported', 'Sistema', run['exports'][-1])

    def list_runs(self, competencia=None):
        if competencia is not None: self._period(competencia)
        with self.lock:
            if competencia is None: rows = self.db.execute('SELECT id FROM wf_runs ORDER BY rowid DESC').fetchall()
            else: rows = self.db.execute('SELECT id FROM wf_runs WHERE competencia=? ORDER BY rowid DESC', (competencia,)).fetchall()
            return [self.get_run(row['id']) for row in rows]

    @staticmethod
    def _output_hash(step):
        outputs = step.get('outputs', [])
        return _hash(sorted([{'name': m['name'], 'sha256': m['sha256']} for m in outputs], key=lambda m: m['name'])) if outputs else None

    def get_run(self, ident):
        with self.lock:
            run = self._run(ident)
            exceptions = self._exceptions(ident)
            for step in run['steps']: step['output_hash'] = self._output_hash(step)
            run.update(exceptions_open=sum(e['status'] == 'open' for e in exceptions), blocking_open=sum(e['status'] == 'open' and e.get('severidade') == 'bloqueante' for e in exceptions), exceptions_total=len(exceptions))
            return run

    def events(self, ident, after=0):
        try: after = max(0, int(after))
        except (TypeError, ValueError): raise ServiceError(422, 'INVALID_EVENT_CURSOR', 'Cursor de eventos inválido.')
        with self.lock:
            self._run(ident)
            return [{**json.loads(row['data']), 'id': row['id'], 'sequence': row['id']} for row in self.db.execute('SELECT * FROM wf_events WHERE run_id=? AND id>? ORDER BY id', (ident, after))]

    def preview(self, ident, step_id, query):
        with self.lock:
            run = self._run(ident)
            index = next((i for i, s in enumerate(run['steps']) if s['id'] == step_id), None)
            if index is None: raise ServiceError(404, 'STEP_NOT_FOUND', 'Passo não encontrado.')
            step = run['steps'][index]
            if not step['outputs']: raise ServiceError(409, 'DATASET_NOT_READY', 'Este passo ainda não produziu uma tabela.')
            query = dict(query or {})
            override = query.get('params_override', query.get('params'))
            if override is not None:
                try: override = json.loads(override) if isinstance(override, str) else override
                except (ValueError, TypeError): raise ServiceError(422, 'INVALID_PREVIEW_QUERY', 'Parâmetros devem ser JSON válido.')
                if override != step['params']:
                    raise ServiceError(422, 'PREVIEW_REQUIRES_DRAFT', 'Use Testar para calcular os parâmetros alterados em uma nova execução de teste.')
            for alias, canonical in [('op', 'filter_op'), ('value', 'filter_value'), ('order', 'sort_dir')]:
                if alias in query and canonical not in query: query[canonical] = query[alias]
            requested = query.get('dataset')
            meta = next((m for m in step['outputs'] if m['name'] == requested), None) if requested else step['outputs'][0]
            if meta is None: raise ServiceError(404, 'DATASET_NOT_FOUND', 'Dataset não pertence ao passo solicitado.')
            if _sha(meta['path']) != meta['sha256']: raise ServiceError(409, 'DATASET_CHANGED', 'Saída imutável alterada.')
            input_rows = None
            catalog = next(c for c in self.catalog() if c['type'] == step['type'])
            inputs = catalog.get('inputs', [])
            if inputs:
                previous = [m for s in run['steps'][:index] for m in s['outputs'] if m['name'] == inputs[0]]
                if previous: input_rows = dataset_io.read_dataset(previous[-1]['path'])
            try: response = dataset_io.preview(meta['path'], query, input_rows=input_rows)
            except (ValueError, TypeError, KeyError) as exc: raise ServiceError(422, 'INVALID_PREVIEW_QUERY', str(exc)) from exc
            return {**response, 'dataset': meta['name'], 'datasets': [m['name'] for m in step['outputs']], 'step_id': step_id, 'sha256': meta['sha256']}

    def _rows(self, meta, verify=True):
        """Immutable outputs are cached by content hash; the file hash is checked on first read and when asked."""
        rows = self._row_cache.get(meta['sha256'])
        if (verify or rows is None) and _sha(meta['path']) != meta['sha256']:
            raise ServiceError(409, 'DATASET_CHANGED', 'Saída imutável alterada.')
        if rows is None:
            rows = dataset_io.read_dataset(meta['path'])
            self._row_cache[meta['sha256']] = rows
            while len(self._row_cache) > 64: self._row_cache.pop(next(iter(self._row_cache)))
        return rows

    def step_rows(self, ident, step_id, dataset=None):
        """Read-only view of one step output for the data desk. Rows are shared: callers must not mutate them."""
        with self.lock:
            run = self._run(ident)
            index = next((i for i, s in enumerate(run['steps']) if s['id'] == step_id), None)
            if index is None: raise ServiceError(404, 'STEP_NOT_FOUND', 'Passo não encontrado.')
            step = run['steps'][index]
            if not step['outputs']: raise ServiceError(409, 'DATASET_NOT_READY', 'Este passo ainda não produziu uma tabela.')
            meta = next((m for m in step['outputs'] if m['name'] == dataset), None) if dataset else step['outputs'][0]
            if meta is None: raise ServiceError(404, 'DATASET_NOT_FOUND', 'Dataset não pertence ao passo solicitado.')
            rows = self._rows(meta)
            titles = {c['type']: c['title'] for c in self.catalog()}
            steps = [{'id': s['id'], 'number': i + 1, 'type': s['type'], 'title': titles.get(s['type'], s['type']), 'metrics': s.get('metrics', {}),
                      'datasets': [m['name'] for m in s.get('outputs', [])]} for i, s in enumerate(run['steps'])]
            produced = {m['name']: m for s in run['steps'] for m in s.get('outputs', [])}

        def rows_of(name):
            with self.lock: return self._rows(produced[name], verify=False)
        return {'run_id': ident, 'step': steps[index], 'meta': meta, 'datasets': [{'name': m['name'], 'rows': m['rows']} for m in step['outputs']],
                'rows': rows, 'steps': steps, 'rows_of': rows_of}

    def run_outputs(self, ident):
        """Every immutable output of a run, hash-checked, for the query chat. Read-only, like `step_rows`."""
        with self.lock:
            run = self._run(ident)
            titles = {c['type']: c['title'] for c in self.catalog()}
            steps = [{'id': s['id'], 'number': i + 1, 'type': s['type'], 'title': titles.get(s['type'], s['type']), 'status': s.get('status'),
                      'metrics': s.get('metrics', {}), 'datasets': [m['name'] for m in s.get('outputs', [])]} for i, s in enumerate(run['steps'])]
            outputs = [{**m, 'step_id': s['id']} for s in run['steps'] for m in s.get('outputs', [])]
            for meta in outputs: self._rows(meta)
            produced = {m['name']: m for m in outputs}

        def rows_of(name):
            with self.lock: return self._rows(produced[name], verify=False)
        return {'run': {'id': run['id'], 'competencia': run['competencia'], 'status': run['status'], 'pipeline_id': run.get('pipeline_id'),
                        'pipeline_version': run.get('pipeline_version')}, 'steps': steps, 'outputs': outputs, 'rows_of': rows_of}

    def exceptions(self, ident, query=None):
        with self.lock:
            run = self._run(ident)
            query = query or {}
            rows = self._exceptions(ident)
            data = self._context(run)['datasets']
            ledger = data.get('lancamentos', [])
            sources = [row for name in ('raw_orbe', 'raw_remittances', 'raw_bank') for row in data.get(name, [])]
            resolved = {(row.get('source_file'), row.get('physical_row')): row for row in data.get('orbe_resolvido', []) if row.get('match_confirmed')}
            for item in rows:
                # Presentation-only join: all available provenance must match one physical source row.
                matches = []
                for origin in item.get('origens', []):
                    ref, filename, line = origin.get('ref'), origin.get('arquivo'), origin.get('linha')
                    if not ref or not filename: continue
                    candidates = [row for row in sources if row.get('source_file') == filename and ref in (row.get('source_ref'), row.get('ref_origem'), row.get('id')) and (line in (None, '') or str(row.get('physical_row')) == str(line))]
                    if len(candidates) == 1 and candidates[0] not in matches: matches.append(candidates[0])
                if len(matches) == 1:
                    source = matches[0]
                    item['merchant'] = source.get('name') or source.get('description') or ''
                    item['date'] = source.get('date') or source.get('contracted_date')
                    item['amount'] = source.get('gross', source.get('gross_brl', source.get('amount')))
                    confirmed = resolved.get((source.get('source_file'), source.get('physical_row')), {})
                    if not item.get('cnpj') and (confirmed.get('cnpj') or source.get('cnpj')):
                        item['cnpj'] = confirmed.get('cnpj') or source['cnpj']
                editable = [row for row in ledger if item['id'] in row.get('__exception_ids', []) and row.get('adjustable_account')]
                item['associated_entries'] = [{'entry_id': row['entry_id'], 'account_code': row['conta_codigo'], 'amount': row['valor'], 'event': row.get('event_type', '')} for row in editable]
                if len(editable) == 1 and editable[0].get('event_type') == 'BANCO':
                    item['bank_line_id'] = item.get('ref_origem', '')
                    item['current_account'] = editable[0]['conta_codigo']
            for key in ('status', 'step_id', 'tipo', 'severidade'):
                if query.get(key): rows = [r for r in rows if r.get(key) == query[key]]
            try: page = max(1, int(query.get('page', 1))); size = min(500, max(1, int(query.get('page_size', 100))))
            except (TypeError, ValueError): raise ServiceError(422, 'INVALID_PAGINATION', 'Página e tamanho devem ser inteiros.')
            return {'items': rows[(page - 1) * size:page * size], 'total': len(rows), 'page': page, 'page_size': size}

    def decision(self, ident, exception_id, payload, actor, *, _commit=True):
        actor = self._actor(actor)
        with self.lock, (self.db if _commit else nullcontext()):
            run = self._run(ident)
            if run['status'] != 'awaiting_approval': raise ServiceError(409, 'RUN_NOT_REVIEWABLE', 'Decisões só podem ser alteradas enquanto o run aguarda aprovação.')
            row = self.db.execute('SELECT data FROM wf_exceptions WHERE run_id=? AND id=?', (ident, exception_id)).fetchone()
            if not row: raise ServiceError(404, 'EXCEPTION_NOT_FOUND', 'Exceção não encontrada.')
            exception = json.loads(row['data'])
            action = payload.get('acao', payload.get('action'))
            action = {'accept': 'aceitar', 'adjust': 'ajustar', 'exclude': 'excluir', 'excluir_do_lote': 'excluir'}.get(action, action)
            if action not in ('aceitar', 'ajustar', 'excluir'): raise ServiceError(422, 'INVALID_DECISION', 'Selecione aceitar, ajustar ou excluir.')
            reason = str(payload.get('justificativa', payload.get('note', ''))).strip()
            if not reason: raise ServiceError(422, 'JUSTIFICATION_REQUIRED', 'Registre a justificativa da decisão.')
            after = {'exception_id': exception_id, 'acao': action, 'justificativa': reason, 'actor': actor, 'at': _now(), 'ref_origem': exception.get('ref_origem'), 'origens': exception.get('origens', []), 'step_id': exception['step_id']}
            if payload.get('entry_id'): after['entry_id'] = str(payload['entry_id'])
            if action == 'ajustar':
                if payload.get('valor') is None and not payload.get('conta'):
                    raise ServiceError(422, 'ADJUSTMENT_REQUIRED', 'Informe valor ou conta corrigida.')
                if payload.get('valor') is not None:
                    try: amount = Decimal(str(payload['valor']))
                    except (InvalidOperation, ValueError): raise ServiceError(422, 'INVALID_MONEY', 'Valor deve ser decimal, usando ponto.')
                    if not amount.is_finite() or amount < 0 or amount > Decimal('999999999999.99') or amount != amount.quantize(Decimal('.01')):
                        raise ServiceError(422, 'INVALID_MONEY', 'Valor deve ser positivo ou zero, finito e ter no máximo duas casas.')
                    after['valor'] = format(amount, '.2f')
                if payload.get('conta'):
                    accounts = self._context(run)['datasets'].get('accounts', [])
                    account = next((a for a in accounts if a.get('code', a.get('conta_codigo')) == str(payload['conta']) and a.get('postable', a.get('aceita_lancto') == 'S')), None)
                    if not account: raise ServiceError(422, 'INVALID_ACCOUNT', 'Use uma conta analítica presente no plano desta execução.')
                    after['conta'] = str(payload['conta'])
            if action in ('ajustar', 'excluir'):
                context = self._context(run)
                entries = context['datasets'].get('lancamentos', [])
                origins = {str(exception.get('ref_origem', ''))}
                for origin in exception.get('origens', []):
                    if isinstance(origin, dict): origins.add(str(origin.get('ref_origem', origin.get('ref', ''))))
                    else: origins.add(str(origin))
                candidates = {str(e['entry_id']) for e in entries if e.get('entry_id') and exception_id in e.get('__exception_ids', [])}
                if after.get('entry_id') and after['entry_id'] not in candidates:
                    raise ServiceError(422, 'INVALID_ADJUSTMENT_TARGET', 'Lançamento não pertence às origens desta exceção.')
                if after.get('entry_id'): candidates = {after['entry_id']}
                if not candidates and action == 'excluir': after['already_excluded'] = True
                elif not after.get('entry_id') and action == 'ajustar':
                    if len(candidates) != 1:
                        raise ServiceError(422, 'AMBIGUOUS_ADJUSTMENT', 'Informe um lançamento inequívoco desta exceção; não é permitido ajustar números sem vínculo.', [{'entry_ids': sorted(candidates)}])
                    after['entry_id'] = next(iter(candidates))
                after['target_entry_ids'] = sorted(candidates)
                for previous in self._adjustments(ident):
                    previous_targets = set(previous.get('target_entry_ids', [previous.get('entry_id')])) - {None}
                    if previous['exception_id'] != exception_id and candidates & previous_targets:
                        raise ServiceError(422, 'CONFLICTING_ADJUSTMENT', 'Este lançamento já possui ajuste em outra exceção. Revise a decisão anterior para evitar alterações conflitantes.')
            before = copy.deepcopy(exception)
            exception.update(status={'aceitar': 'accepted', 'ajustar': 'adjusted', 'excluir': 'excluded'}[action], decision=after)
            self.db.execute('UPDATE wf_exceptions SET data=? WHERE run_id=? AND id=?', (_json(exception), ident, exception_id))
            self.db.execute('INSERT INTO wf_decisions(run_id,exception_id,data) VALUES (?,?,?)', (ident, exception_id, _json(after)))
            self._audit(ident, 'exception_decision', actor, {'before': before, 'after': exception, 'justificativa': reason})
            self._event(ident, 'exception_decided', exception_id=exception_id, status=exception['status'])
            return exception

    def decide_many(self, ident, ids, payload, actor):
        actor = self._actor(actor)
        if not ids or len(ids) != len(set(ids)):
            raise ServiceError(422, 'INVALID_SELECTION', 'Selecione exceções distintas.')
        if payload.get('acao') != 'aceitar':
            raise ServiceError(422, 'INVALID_BATCH_ACTION', 'A decisão em lote aceita somente alertas.')
        with self.lock, self.db:
            existing = {item['id']: item for item in self._exceptions(ident)}
            for key in ids:
                if key not in existing: raise ServiceError(404, 'EXCEPTION_NOT_FOUND', 'Uma exceção selecionada não existe.')
                if existing[key].get('severidade') == 'bloqueante':
                    raise ServiceError(422, 'BATCH_BLOCKER', 'Exceções bloqueantes exigem decisão individual.')
            for key in ids: self.decision(ident, key, payload, actor, _commit=False)
            return {'decided': len(ids)}

    def approval(self, ident, payload, actor):
        actor = self._actor(actor)
        with self.lock, self.db:
            run = self._run(ident)
            if run['status'] != 'awaiting_approval': raise ServiceError(409, 'NOT_AWAITING_APPROVAL', 'Run não está aguardando aprovação.')
            action = payload.get('decisao', payload.get('decision'))
            action = {'approve': 'aprovar', 'reject': 'reprovar'}.get(action, action)
            if action not in ('aprovar', 'reprovar'): raise ServiceError(422, 'INVALID_APPROVAL', 'Selecione aprovar ou reprovar.')
            comment = str(payload.get('comentario', '')).strip()
            if not comment: raise ServiceError(422, 'COMMENT_REQUIRED', 'Registre o comentário da revisão final.')
            if action == 'aprovar':
                blocked = [e for e in self._exceptions(ident) if e['status'] == 'open' and e.get('severidade') == 'bloqueante']
                if blocked: raise ServiceError(422, 'OPEN_BLOCKERS', 'Resolva todas as exceções bloqueantes antes de aprovar.', [{'id': e['id'], 'tipo': e['tipo']} for e in blocked])
                self._assert_snapshot(run)
            approval = {'decisao': action, 'comentario': comment, 'actor': actor, 'at': _now()}
            run['approval'] = approval
            approval_step = next(s for s in run['steps'] if s['type'] == 'aprovacao')
            approval_step.update(status='done', finished_at=_now(), duration_ms=round((datetime.now(timezone.utc)-datetime.fromisoformat(approval_step['started_at'])).total_seconds()*1000), metrics={**approval_step.get('metrics', {}), 'exceptions_open': sum(e['status'] == 'open' for e in self._exceptions(ident))})
            run['status'] = 'approved' if action == 'aprovar' else 'rejected'
            if action == 'reprovar':
                run['finished_at'] = _now()
                for step in run['steps']:
                    if step['status'] == 'pending': step['status'] = 'skipped'
            else:
                adjustments = self._adjustments(ident)
                destination = Path(run['directory']) / 'decisions' / 'ajustes.parquet'
                destination.parent.mkdir(exist_ok=True)
                content_adjustments = [{k: v for k, v in item.items() if k not in ('actor', 'at')} for item in adjustments]
                metadata = dataset_io.write_dataset(destination, content_adjustments)
                destination.chmod(0o444)
                run['datasets']['ajustes'] = {**metadata, 'name': 'ajustes', 'step_id': approval_step['id'], 'path': str(destination), 'sha256': _sha(destination), 'rows': len(adjustments)}
            self._save_run(run)
            self._audit(ident, 'step_finished', actor, {'step_id': approval_step['id'], 'status': 'done', 'params': approval_step['params'], 'metrics': approval_step['metrics'], 'duration_ms': approval_step['duration_ms'], 'datasets': approval_step['outputs']})
            self._event(ident, 'step_finished', step_id=approval_step['id'], status='done', metrics=approval_step['metrics'], duration_ms=approval_step['duration_ms'])
            self._audit(ident, 'approval_decision', actor, {'before': {'status': 'awaiting_approval'}, 'after': approval, 'status': run['status']})
            self._event(ident, 'approval_decided', decision=action, actor=actor, status=run['status'])
            if action == 'reprovar': self._event(ident, 'run_finished', status='rejected')
        if action == 'aprovar': self._launch(ident)
        return self.get_run(ident)

    def audit(self, ident):
        with self.lock:
            run = self._run(ident)
            records = [{**json.loads(row['data']), 'id': row['id']} for row in self.db.execute('SELECT * FROM wf_audit WHERE run_id=? ORDER BY id', (ident,))]
            return {'run_id': ident, 'competencia': run['competencia'], 'status': run['status'], 'snapshot': run['snapshot'], 'steps': run['steps'], 'approval': run['approval'], 'exceptions': self._exceptions(ident), 'adjustments': self._adjustments(ident), 'exports': run['exports'], 'records': records}

    def export(self, ident):
        with self.lock:
            run = self._run(ident)
            if run['status'] != 'done' or not run.get('approval') or run['approval']['decisao'] != 'aprovar':
                raise ServiceError(409, 'EXPORT_NOT_APPROVED', 'Exportação disponível somente após aprovação e conclusão deste run.')
            out = io.BytesIO()
            with zipfile.ZipFile(out, 'w', zipfile.ZIP_DEFLATED) as archive:
                for item in sorted(run['exports'], key=lambda f: f['name']):
                    if _sha(item['path']) != item['sha256']: raise ServiceError(409, 'EXPORT_CHANGED', 'Arquivo exportado foi alterado após a auditoria.')
                    info = zipfile.ZipInfo(item['name'], date_time=(2026, 1, 1, 0, 0, 0))
                    info.compress_type = zipfile.ZIP_DEFLATED
                    archive.writestr(info, Path(item['path']).read_bytes())
            return out.getvalue()

    def accounts(self, ident):
        with self.lock:
            run = self._run(ident)
            return {'accounts': self._context(run)['datasets'].get('accounts', [])}

    def approval_summary(self, ident):
        with self.lock:
            run = self._run(ident)
            issues = self._exceptions(ident)
            context = self._context(run)
            original = context['datasets'].get('lancamentos', [])
            rows = original
            if original:
                rows, _ = _adjusted_ledger(context, self._adjustments(ident))
            amount = lambda item: abs(Decimal(str(item.get('impacto_rs', '0.00'))))
            blocking = [e for e in issues if e.get('severidade') == 'bloqueante']
            opened = [e for e in issues if e['status'] == 'open']
            debit = sum((Decimal(str(r['debito'])) for r in rows), Decimal(0))
            credit = sum((Decimal(str(r['credito'])) for r in rows), Decimal(0))
            return {'total': len(issues), 'blocking': len(blocking), 'alerts': len(issues) - len(blocking),
                    'decided': len(issues) - len(opened), 'open_blocking': sum(e.get('severidade') == 'bloqueante' for e in opened),
                    'open_alerts': sum(e.get('severidade') != 'bloqueante' for e in opened),
                    'impact_brl': format(sum(map(amount, issues), Decimal(0)), '.2f'),
                    'open_impact_brl': format(sum(map(amount, opened), Decimal(0)), '.2f'),
                    'batch': {'entries': len(rows), 'excluded': len(original) - len(rows), 'debit_brl': format(debit, '.2f'),
                              'credit_brl': format(credit, '.2f'), 'balanced': bool(original) and debit == credit}}

    def compare_runs(self, a, b):
        with self.lock:
            first, second = self.get_run(a), self.get_run(b)
            titles = {step['type']: step['title'] for step in self.catalog()}
            left = {step['type']: step for step in first['steps']}
            right = {step['type']: step for step in second['steps']}
            steps = []
            for typ in dict.fromkeys([*left, *right]):
                hash_a = left.get(typ, {}).get('output_hash')
                hash_b = right.get(typ, {}).get('output_hash')
                steps.append({'type': typ, 'title': titles.get(typ, typ), 'hash_a': hash_a, 'hash_b': hash_b,
                              'match': bool(hash_a and hash_b and hash_a == hash_b)})
            comparable = [step for step in steps if step['type'] not in ('aprovacao', 'exportar_erp')]
            snapshots_match = all(first['snapshot'].get(key) == second['snapshot'].get(key)
                                  for key in ('source_content_hash', 'pipeline_hash', 'references_hash', 'loaded_code_hash'))
            return {'a': first, 'b': second, 'steps': steps,
                    'reproducible': bool(comparable) and snapshots_match and all(step['match'] for step in comparable)}

    def export_file(self, ident, name):
        with self.lock:
            run = self._run(ident)
            if name == 'auditoria.json' and not any(item['name'] == name for item in run['exports']):
                return _json(self.audit(ident)).encode('utf-8')
            if run.get('draft') or run['status'] != 'done' or not run.get('approval') or run['approval']['decisao'] != 'aprovar':
                raise ServiceError(409, 'EXPORT_NOT_APPROVED', 'Exportação disponível somente após aprovação e conclusão deste run.')
            item = next((item for item in run['exports'] if item['name'] == name), None)
            if not item or Path(name).name != name:
                raise ServiceError(404, 'EXPORT_NOT_FOUND', 'Arquivo não pertence às exportações desta execução.')
            content = Path(item['path']).read_bytes()
            if hashlib.sha256(content).hexdigest() != item['sha256']:
                raise ServiceError(409, 'EXPORT_CHANGED', 'Arquivo exportado foi alterado após a auditoria.')
            return content

    def checklist(self, competencia):
        period = self._period(competencia)
        with self.lock, self.db:
            template_path = ROOT / 'src' / 'config' / 'checklist.json'
            template = json.loads(template_path.read_text()) if template_path.exists() else DEFAULT_CHECKLIST
            if isinstance(template, dict): template = template.get('tasks', template.get('tarefas', DEFAULT_CHECKLIST))
            for index, task in enumerate(template):
                suffix = str(task.get('id', index))
                ident = period + ':' + suffix
                entry = {**task, 'id': ident, 'competencia': period, 'manual': bool(task.get('manual', not task.get('step_type', task.get('step')))), 'status': 'pendente', 'responsavel': '', 'comentario': ''}
                entry.setdefault('step_type', task.get('step', task.get('linked_step')))
                entry.setdefault('title', task.get('titulo', task.get('name', suffix)))
                self.db.execute('INSERT OR IGNORE INTO wf_tasks VALUES (?,?,?)', (ident, period, _json(entry)))
            candidates = self.db.execute('SELECT data FROM wf_runs WHERE competencia=? ORDER BY rowid DESC', (period,)).fetchall()
            run = next((r for r in (json.loads(row['data']) for row in candidates) if not r.get('draft')), None)
            entries = [json.loads(r['data']) for r in self.db.execute('SELECT data FROM wf_tasks WHERE competencia=? ORDER BY rowid', (period,))]
            for task in entries:
                if task['manual']: continue
                step = next((s for s in run['steps'] if s['type'] == task.get('step_type')), None) if run else None
                task['run_id'] = run['id'] if run else None
                task['step_id'] = step['id'] if step else None
                if not step or step['status'] in ('pending', 'skipped'): task['status'] = 'pendente'
                elif step['type'] == 'aprovacao' and run['status'] == 'awaiting_approval': task['status'] = 'awaiting_approval'
                elif step['status'] == 'running': task['status'] = 'em_andamento'
                elif step['status'] in ('done_with_exceptions', 'failed'): task['status'] = 'com_excecoes'
                else: task['status'] = 'concluida'
            return {'competencia': period, 'run_id': run['id'] if run else None, 'tasks': entries}

    def update_task(self, task_id, payload, actor):
        actor = self._actor(actor)
        with self.lock, self.db:
            row = self.db.execute('SELECT data FROM wf_tasks WHERE id=?', (task_id,)).fetchone()
            if not row: raise ServiceError(404, 'TASK_NOT_FOUND', 'Tarefa não encontrada; abra a competência primeiro.')
            task = json.loads(row['data'])
            if not task.get('manual'): raise ServiceError(409, 'DERIVED_TASK', 'Tarefa vinculada ao pipeline tem status derivado da execução.')
            status = payload.get('status', task['status'])
            if status not in ('pendente', 'em_andamento', 'concluida'): raise ServiceError(422, 'INVALID_TASK_STATUS', 'Status de tarefa manual inválido.')
            before = copy.deepcopy(task)
            task.update(status=status, responsavel=str(payload.get('responsavel', payload.get('owner', task.get('responsavel', '')))), comentario=str(payload.get('comentario', payload.get('comment', task.get('comentario', '')))), updated_by=actor, updated_at=_now())
            self.db.execute('UPDATE wf_tasks SET data=? WHERE id=?', (_json(task), task_id))
            self._audit(None, 'checklist_updated', actor, {'before': before, 'after': task})
            return task

    def close(self):
        with self.lock:
            self.stopping = True
            threads = list(self.threads.values())
        for thread in threads:
            if thread is not threading.current_thread(): thread.join(timeout=15)
        with self.lock:
            if not any(t.is_alive() for t in threads): self.db.close()
