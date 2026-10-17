"""Reproducible official delivery, isolated from the operator's databases.

This validates artifact integrity, not the organizer's financial answer key.
"""
from __future__ import annotations

import argparse
from collections import defaultdict
from contextlib import contextmanager
import csv
from datetime import date, datetime, timezone
from decimal import Decimal
import hashlib
import json
import os
from pathlib import Path
import re
import shutil
import subprocess
import tempfile

from .importer import load_data
from .inputs import discover_files, ROLES
from .store import Store, EXPORTS, ROOT

REPOSITORY = ROOT.parents[1]
MONEY_FIELDS = {
    'comissoes_por_lojista.csv': 'comissao_brl',
    'divergencias_taxa.csv': 'diferenca_brl',
    'notas_a_emitir.csv': 'valor_brl',
    'lancamentos_classificados.csv': 'valor',
    'pendencias.csv': 'valor_brl',
}
MANAGED = (*EXPORTS, 'verificacao.json', 'manifesto.json')


def sha(path):
    return hashlib.sha256(Path(path).read_bytes()).hexdigest()


def write_json(path, value):
    Path(path).write_text(json.dumps(value, ensure_ascii=False, sort_keys=True, indent=2) + '\n', encoding='utf-8')


def relative_path(path):
    try:
        return str(Path(path).relative_to(REPOSITORY))
    except ValueError:
        return str(path)


def resolve_path(value):
    path = Path(value).expanduser()
    return Path(os.path.abspath(path if path.is_absolute() else REPOSITORY / path))


def number(value, label, optional=False):
    if value == '' and optional:
        return None
    if not isinstance(value, str) or not re.fullmatch(r'-?\d+(?:\.\d+)?', value):
        raise ValueError(f'{label}: número decimal inválido: {value!r}')
    return Decimal(value)


def reference_index(data):
    index = defaultdict(set)
    for group in ('checkout', 'remittances', 'bank', 'merchants', 'rates', 'accounts', 'import_warnings'):
        for row in data.get(group, []):
            ref = row.get('source_ref') or row.get('ref_origem') or row.get('id')
            if row.get('source_file') and ref:
                index[row['source_file'], ref].add(str(row.get('physical_row', '')))
    return index


def validate_csvs(folder, data):
    """Validate the public CSV contract and each actual source reference."""
    tables = {}
    for name, (_, required) in EXPORTS.items():
        with (Path(folder) / name).open(encoding='utf-8-sig', newline='') as handle:
            reader = csv.DictReader(handle, delimiter=';', strict=True)
            fields = reader.fieldnames or []
            if len(fields) != len(set(fields)) or not set(required) <= set(fields):
                raise ValueError(f'{name}: cabeçalho incompatível com o regulamento.')
            rows = list(reader)
        if any(None in row or None in row.values() for row in rows):
            raise ValueError(f'{name}: quantidade inconsistente de colunas.')
        tables[name] = rows

    outputs, unknown = {}, {}
    for name, field in MONEY_FIELDS.items():
        for row in tables[name]:
            ident = row['id_saida']
            if not ident or ident in outputs:
                raise ValueError(f'ID vazio ou repetido: {ident!r}')
            partial = (name == 'pendencias.csv' and row.get('group_scope') == 'merchant_period'
                       and row.get('exposure_status') in ('partial', 'unavailable'))
            value = number(row[field], f'{name}/{ident}', optional=partial)
            outputs[ident] = value
            if partial:
                if value is not None:
                    raise ValueError(f'{ident}: valor desconhecido não pode ser preenchido.')
                unknown[ident] = (number(row.get('known_exposure_brl'), ident),
                                  int(row.get('missing_exposure_count', '0')))
            for col in ('cnpj', 'tomador_cnpj'):
                if col in row and (row[col] or col in EXPORTS[name][1]) and not re.fullmatch(r'\d{14}', row[col]):
                    raise ValueError(f'{ident}: {col} deve conter 14 dígitos.')
            if 'linha_negocio' in row and row['linha_negocio'] not in ('CHECKOUT', 'REMESSA'):
                raise ValueError(f'{ident}: linha de negócio inválida.')
            if name == 'divergencias_taxa.csv':
                for col in ('taxa_contratada_pct', 'taxa_aplicada_pct'):
                    number(row[col], f'{ident}/{col}')
            if name == 'lancamentos_classificados.csv':
                if row['banco'] not in ('AURORA', 'MERIDIANO') or row['metodo'] not in ('REGRA', 'IA', 'HUMANO'):
                    raise ValueError(f'{ident}: banco ou método inválido.')
                if not 0 <= number(row['confianca'], ident) <= 1:
                    raise ValueError(f'{ident}: confiança fora de 0 a 1.')
                if not re.fullmatch(r'\d{4}-\d{2}-\d{2}', row['data']):
                    raise ValueError(f'{ident}: data não está em formato ISO.')
                date.fromisoformat(row['data'])
            if name == 'pendencias.csv' and (not row['motivo'].strip() or not row['quem_decide'].strip()):
                raise ValueError(f'{ident}: pendência sem motivo ou responsável.')

    sources = reference_index(data)
    sums, missing, seen = defaultdict(Decimal), defaultdict(int), set()
    traced_refs = defaultdict(set)
    for row in tables['rastro.csv']:
        ident = row['id_saida']
        if ident not in outputs:
            raise ValueError(f'Rastro órfão: {ident}')
        key = row['arquivo_origem'], row['ref_origem']
        if key not in sources:
            raise ValueError(f'{ident}: referência não encontrada nas fontes: {key}')
        physical = row.get('source_row', '')
        if physical and physical not in sources[key]:
            raise ValueError(f'{ident}: linha física de origem não confere: {physical}')
        amount = number(row['valor'], f'rastro/{ident}', optional=ident in unknown)
        seen.add(ident)
        traced_refs[ident].add(row['ref_origem'])
        if amount is None:
            missing[ident] += 1
        else:
            sums[ident] += amount
    for ident, value in outputs.items():
        if ident not in seen:
            raise ValueError(f'Saída sem rastro: {ident}')
        if ident in unknown:
            subtotal, count = unknown[ident]
            if count <= 0 or missing[ident] != count or sums[ident] != subtotal:
                raise ValueError(f'{ident}: subtotal conhecido/rastros desconhecidos inconsistentes.')
        elif missing[ident] or sums[ident] != value:
            raise ValueError(f'{ident}: rastro {sums[ident]} difere da saída {value}.')
    for name in ('divergencias_taxa.csv', 'lancamentos_classificados.csv', 'pendencias.csv'):
        for row in tables[name]:
            if row['ref_origem'] not in traced_refs[row['id_saida']]:
                raise ValueError(f'{row["id_saida"]}: referência da saída não está no seu rastro.')
    return {'rows': {name: len(rows) for name, rows in tables.items()},
            'outputs': len(outputs), 'known_outputs': len(outputs) - len(unknown),
            'unknown_outputs': len(unknown), 'trace_ok': True, 'source_references_ok': True}


def code_identity():
    files = sorted(p for p in (ROOT / 'src').rglob('*') if p.suffix in ('.py', '.json'))
    files += [ROOT / 'requirements.lock.txt', ROOT / 'requirements.txt', ROOT / 'run.sh', REPOSITORY / 'entrega.sh']
    hashes = {relative_path(p): sha(p) for p in files}
    try:
        head = subprocess.check_output(['git', '-C', str(REPOSITORY), 'rev-parse', 'HEAD'], stderr=subprocess.DEVNULL, text=True).strip()
        dirty = bool(subprocess.check_output(['git', '-C', str(REPOSITORY), 'status', '--porcelain'], text=True))
    except (OSError, subprocess.CalledProcessError):
        head, dirty = None, None
    return {'git_commit': head, 'working_tree_dirty': dirty, 'files': hashes,
            'sha256': hashlib.sha256(json.dumps(hashes, sort_keys=True).encode()).hexdigest()}


def inspect_sources(source):
    entries = discover_files(source)
    if any(e['status'] != 'valid' for e in entries) or set(ROLES) - {e['role'] for e in entries}:
        raise ValueError('Entrega exige as seis fontes válidas; arquivos ausentes, inválidos ou ambíguos devem ser revisados.')
    for role in set(ROLES) - {'orbe'}:
        if len({e['sha256'] for e in entries if e['role'] == role}) > 1:
            raise ValueError(f'Fonte ambígua: {role}. Revise antes de publicar a entrega.')
    return {e['name']: e['sha256'] for e in entries}


def verify_package(folder, source=None):
    folder = Path(folder)
    manifest = json.loads((folder / 'manifesto.json').read_text(encoding='utf-8'))
    if manifest.get('schema_version') != 1 or set(manifest['artifacts']) != set(MANAGED) - {'manifesto.json'}:
        raise ValueError('Manifesto incompleto ou incompatível.')
    if manifest['code']['sha256'] != code_identity()['sha256']:
        raise ValueError('Código atual difere da versão da entrega; gere um novo pacote.')
    for name, expected in manifest['artifacts'].items():
        if sha(folder / name) != expected:
            raise ValueError(f'Hash da entrega não confere: {name}')
    source = Path(source) if source else resolve_path(manifest['source_dir'])
    if inspect_sources(source) != manifest['input_hashes']:
        raise ValueError('As fontes atuais diferem dos hashes da entrega.')
    result = validate_csvs(folder, load_data(source))
    if result != manifest['validation']:
        raise ValueError('Contagens de validação diferem do manifesto.')
    return result


@contextmanager
def output_lock(output):
    """OS-held lock survives exceptions safely; its tiny file may remain on disk."""
    output.parent.mkdir(parents=True, exist_ok=True)
    lock = output.parent / f'.{output.name}.entrega.lock'
    with lock.open('a+b') as handle:
        handle.seek(0)
        if os.name == 'nt':
            import msvcrt
            if lock.stat().st_size == 0:
                handle.write(b'0'); handle.flush(); handle.seek(0)
            msvcrt.locking(handle.fileno(), msvcrt.LK_NBLCK, 1)
        else:
            import fcntl
            fcntl.flock(handle, fcntl.LOCK_EX | fcntl.LOCK_NB)
        try:
            yield
        finally:
            if os.name == 'nt':
                handle.seek(0); msvcrt.locking(handle.fileno(), msvcrt.LK_UNLCK, 1)
            else:
                fcntl.flock(handle, fcntl.LOCK_UN)


def recover_publication(output):
    backup = output.parent / f'.{output.name}.entrega-backup'
    journal = output.parent / f'.{output.name}.entrega-transaction.json'
    if backup.exists():
        if not journal.exists():
            raise ValueError(f'Backup sem registro de transação; preserve e revise: {backup}')
        expected = json.loads(journal.read_text())['manifest_sha256']
        if output.exists():
            if not (output / 'manifesto.json').is_file() or sha(output / 'manifesto.json') != expected:
                raise ValueError(f'Publicação interrompida; backup preservado em {backup}.')
            manifest = json.loads((output / 'manifesto.json').read_text(encoding='utf-8'))
            if set(manifest['artifacts']) != set(MANAGED) - {'manifesto.json'} or any(
                    not (output / name).is_file() or sha(output / name) != expected_hash
                    for name, expected_hash in manifest['artifacts'].items()):
                raise ValueError(f'Publicação interrompida com arquivos alterados; backup preservado em {backup}.')
            shutil.rmtree(backup)
        else:
            os.replace(backup, output)
    journal.unlink(missing_ok=True)


def tree_fingerprint(folder):
    if not folder.exists():
        return None
    result = {}
    for path in sorted(folder.rglob('*')):
        key = str(path.relative_to(folder))
        if path.is_symlink():
            result[key] = ['symlink', os.readlink(path)]
        elif path.is_file():
            result[key] = ['file', sha(path)]
        elif path.is_dir():
            result[key] = ['directory']
        else:
            raise ValueError(f'Destino contém arquivo especial não suportado: {path}')
    return result


def publish_package(package, output):
    """Swap the complete directory, retaining its historical/unmanaged contents.

Ordinary failures roll back. If the process dies between renames, the next
invocation recovers the previous directory before generating anything.
"""
    backup = output.parent / f'.{output.name}.entrega-backup'
    journal = output.parent / f'.{output.name}.entrega-transaction.json'
    for name in MANAGED:
        target = output / name
        if target.exists() and not target.is_file() and not target.is_symlink():
            raise ValueError(f'Destino reservado é um diretório ou arquivo especial: {target}')
    previous = tree_fingerprint(output)
    with tempfile.TemporaryDirectory(prefix=f'.{output.name}.entrega-stage-', dir=output.parent) as temporary:
        stage = Path(temporary) / 'package'
        if output.exists():
            shutil.copytree(output, stage, symlinks=True)
        else:
            stage.mkdir()
        for name in MANAGED:
            target = stage / name
            if target.is_symlink():
                target.unlink()
            shutil.copy2(package / name, target)
        verify_package(stage)
        if tree_fingerprint(output) != previous:
            raise ValueError('Destino alterado durante a preparação; alterações preservadas, entrega não publicada.')
        write_json(journal, {'manifest_sha256': sha(package / 'manifesto.json')})
        moved = False
        try:
            if output.exists():
                os.replace(output, backup)
                moved = True
                if tree_fingerprint(backup) != previous:
                    raise ValueError('Destino alterado antes da troca; entrega anterior será restaurada.')
            os.replace(stage, output)
        except BaseException:
            # A signal can arrive after rename but before Python sets `moved`.
            # Inspect the filesystem, and retain the journal for ambiguous states.
            if backup.exists() and not output.exists():
                os.replace(backup, output)
            if not backup.exists():
                journal.unlink(missing_ok=True)
            raise
        if moved:
            shutil.rmtree(backup)
        journal.unlink(missing_ok=True)


def generate_delivery(source, output, period):
    if Path(output).is_symlink():
        raise ValueError('Destino não pode ser um link simbólico.')
    source, output = Path(source).resolve(), Path(output).resolve()
    if not re.fullmatch(r'\d{4}-\d{2}', period):
        raise ValueError('Competência deve estar em AAAA-MM.')
    date.fromisoformat(period + '-01')
    if source == output or source in output.parents or output in source.parents or output == REPOSITORY:
        raise ValueError('Destino deve ser separado das fontes e da raiz do repositório.')
    with output_lock(output):
        recover_publication(output)
        before = inspect_sources(source)
        code = code_identity()
        with tempfile.TemporaryDirectory(prefix='tarvo-delivery-') as temporary:
            temporary = Path(temporary)
            inputs, package = temporary / 'inputs', temporary / 'package'
            inputs.mkdir(); package.mkdir()
            for name in before:
                shutil.copyfile(source / name, inputs / name)
            if inspect_sources(inputs) != before:
                raise ValueError('Fonte mudou durante a cópia; nenhuma saída foi publicada.')
            store = Store(temporary / 'closing.sqlite3', inputs)
            try:
                store.mutate('recalculate', {'actor': 'Entrega reproduzível', 'period': period})
                state = store.state()
                if state['validation']['errors']:
                    raise ValueError(str(state['validation']['errors']))
                if any(p['tipo'] == 'COMPETENCIA_SEM_MOVIMENTOS' for p in state['results']['pendencias']):
                    raise ValueError('Nenhum movimento para a competência solicitada.')
                data = store.get('source_data')
                for name in EXPORTS:
                    (package / name).write_bytes(store.export_csv(name))
                verification = {'period': period, 'summary': state['summary'], 'validation': state['validation'],
                                'sources': [{k: s[k] for k in ('name', 'sha256', 'role', 'rows', 'rows_received', 'status', 'embedded') if k in s}
                                            for s in state['sources']]}
                write_json(package / 'verificacao.json', verification)
                validation = validate_csvs(package, data)
                manifest = {'schema_version': 1, 'period': period,
                            'generated_at': datetime.now(timezone.utc).isoformat(),
                            'source_dir': relative_path(source), 'input_hashes': before,
                            'parameters': {**state['parameters'], 'period': period}, 'code': code,
                            'validation': validation,
                            'artifacts': {name: sha(package / name) for name in MANAGED if name != 'manifesto.json'}}
                write_json(package / 'manifesto.json', manifest)
            finally:
                store.close_db()
            verify_package(package, source)
            if inspect_sources(source) != before or code_identity()['sha256'] != code['sha256']:
                raise ValueError('Fontes ou código mudaram durante a geração; nenhuma saída foi publicada.')
            publish_package(package, output)
        return manifest


def main(argv=None):
    parser = argparse.ArgumentParser(description='Gera ou verifica a entrega oficial sem usar bancos da demonstração. Caminhos relativos à raiz do repositório.')
    parser.add_argument('--period', default='2026-09')
    parser.add_argument('--source-dir', default=None, help='Padrão de geração: Tarvo_Data_Pack_set2026. Em --check: fonte do manifesto.')
    parser.add_argument('--output-dir', default='saida')
    parser.add_argument('--check', metavar='PASTA', help='Confere hashes, formato e rastros do pacote existente, sem escrever nele.')
    args = parser.parse_args(argv)
    try:
        if args.check:
            result = verify_package(resolve_path(args.check), resolve_path(args.source_dir) if args.source_dir else None)
            print(json.dumps(result, ensure_ascii=False, indent=2))
        else:
            result = generate_delivery(resolve_path(args.source_dir or 'Tarvo_Data_Pack_set2026'), resolve_path(args.output_dir), args.period)
            print(f'Entrega validada em {resolve_path(args.output_dir)}: {result["validation"]["outputs"]} saídas, '
                  f'{result["validation"]["rows"]["rastro.csv"]} rastros. Competência {args.period}.')
    except (ValueError, OSError, KeyError, csv.Error) as exc:
        parser.exit(1, f'Entrega não publicada/validada: {exc}\n')


if __name__ == '__main__':
    main()
