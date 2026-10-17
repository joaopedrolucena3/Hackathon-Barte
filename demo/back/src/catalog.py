"""Versioned reference reconciliation; row positions are provenance, never identity.

The functions are pure and shared by imports and run snapshots. SQLite migration
only changes the active reference tables and records old rows in append-only
history; imports, financial runs, decisions and workflow snapshots are untouched.
"""
from __future__ import annotations

import copy
import hashlib
import json
import sqlite3
from collections import defaultdict
from datetime import date, datetime, timezone, timedelta
from decimal import Decimal, InvalidOperation

SCHEMA_VERSION = 1
IDENTITY_FIELDS = ('cnpj', 'product', 'start', 'end')
PROVENANCE_FIELDS = ('source_file', 'source_ref', 'physical_row', 'source_row', 'source_id', 'source_sha256', 'rule')


def canonical_json(value):
    return json.dumps(value, ensure_ascii=False, sort_keys=True, separators=(',', ':'), default=str)


def content_hash(value):
    return hashlib.sha256(canonical_json(value).encode()).hexdigest()


def canonical_number(value):
    try:
        number = Decimal(str(value))
    except (InvalidOperation, ValueError):
        raise ValueError('Taxa deve ser um número decimal válido.') from None
    if not number.is_finite():
        raise ValueError('Taxa deve ser finita.')
    if number == 0:
        return '0'
    # Decimal.normalize() applies the active context and can silently round a
    # precise contractual rate before its revision hash is calculated.
    text = format(number, 'f')
    return text.rstrip('0').rstrip('.') if '.' in text else text


def _identity(rate):
    result = {k: str(rate.get(k) or '').strip() for k in IDENTITY_FIELDS}
    if len(result['cnpj']) != 14 or not result['cnpj'].isdigit():
        raise ValueError('Contrato exige CNPJ com 14 dígitos.')
    if not result['product']:
        raise ValueError('Contrato exige produto.')
    for key in ('start', 'end'):
        if result[key]:
            result[key] = date.fromisoformat(result[key]).isoformat()
    if result['start'] and result['end'] and result['end'] < result['start']:
        raise ValueError('Fim de vigência anterior ao início.')
    return result


def stable_contract_id(rate):
    return 'RATE-' + content_hash(_identity(rate))[:24]


def _unique(items):
    return [json.loads(s) for s in sorted({canonical_json(item) for item in items})]


def _origins(row):
    origins = copy.deepcopy(row.get('provenances', []))
    own = {k: row[k] for k in PROVENANCE_FIELDS if row.get(k) not in (None, '')}
    if own and own not in origins:
        origins.append(own)
    return _unique(origins)


def normalize_rate(rate):
    result = copy.deepcopy(rate)
    result.update(_identity(rate))
    result['rate_pct'] = canonical_number(rate['rate_pct'])
    logical_id = stable_contract_id(result)
    result['logical_id'] = logical_id
    result['revision_id'] = 'REV-' + content_hash({**_identity(result), 'rate_pct': result['rate_pct']})[:24]
    result['id'] = logical_id
    aliases = list(result.get('legacy_ids', []))
    old = rate.get('id')
    if old and old != logical_id and not str(old).startswith(logical_id + '@'):
        aliases.append(old)
    result['legacy_ids'] = sorted(set(aliases))
    result['provenances'] = _origins(rate)
    result.pop('catalog_conflict', None)
    return result


def _equivalent(rows):
    # Human metadata wins only among financially equivalent revisions.
    selected = sorted(rows, key=lambda r: (bool(r.get('reviewed_by')), r.get('reviewed_at', ''), canonical_json(r)))[-1]
    result = copy.deepcopy(selected)
    result['provenances'] = _unique([p for r in rows for p in r.get('provenances', [])])
    result['legacy_ids'] = sorted({p for r in rows for p in r.get('legacy_ids', [])})
    result['supersedes_revision_ids'] = sorted({p for r in rows for p in r.get('supersedes_revision_ids', [])})
    result['supersedes_logical_ids'] = sorted({p for r in rows for p in r.get('supersedes_logical_ids', [])})
    evidence = []
    for row in rows:
        value = row.get('supersession_evidence')
        if value:
            evidence.extend(value if isinstance(value, list) else [value])
    if evidence:
        result['supersession_evidence'] = _unique(evidence)
    return result


def reconcile_rates(rows):
    groups = defaultdict(list)
    normalized_rows = [normalize_rate(row) for row in rows]
    retired = {key for r in normalized_rows if r.get('reviewed_by') or r.get('supersession_evidence')
               for key in r.get('supersedes_logical_ids', [])}
    for normalized in normalized_rows:
        if normalized['logical_id'] in retired and not normalized.get('reviewed_by'):
            continue
        groups[normalized['logical_id']].append(normalized)
    active, conflicts, warnings = [], [], []
    for logical_id, values in sorted(groups.items()):
        versions = defaultdict(list)
        for row in values:
            versions[row['revision_id']].append(row)
        merged = [_equivalent(v) for _, v in sorted(versions.items())]
        superseded = {v for r in merged if r.get('reviewed_by') for v in r.get('supersedes_revision_ids', [])}
        candidates = [r for r in merged if r['revision_id'] not in superseded]
        # A contradictory supersession graph is a conflict, not an empty catalog.
        if not candidates:
            candidates = merged
        if len(candidates) == 1:
            active.append(candidates[0])
            continue
        reviewed = [r for r in candidates if r.get('reviewed_by')]
        chosen = reviewed if len(reviewed) == 1 else candidates
        conflict = {'id': 'CAT-' + content_hash([logical_id, sorted(r['revision_id'] for r in candidates)])[:24],
                    'kind': 'rate', 'logical_id': logical_id, 'status': 'open',
                    'variants': candidates, 'selected_revision_id': reviewed[0]['revision_id'] if len(reviewed) == 1 else None}
        conflicts.append(conflict)
        for candidate in chosen:
            item = copy.deepcopy(candidate)
            if len(chosen) > 1:
                item['id'] = logical_id + '@' + item['revision_id'][4:16]
            item['catalog_conflict'] = conflict['id']
            active.append(item)
        origin = candidates[0]
        warnings.append({'type': 'CONFLITO_CONTRATUAL', 'message': f'Contrato {logical_id} tem conteúdos diferentes para o mesmo lojista, produto e vigência. ' +
                         ('A revisão humana foi preservada; conferir a nova evidência.' if len(reviewed) == 1 else 'Nenhuma versão foi escolhida; revisar o contrato.'),
                         'source_file': origin.get('source_file', ''), 'source_ref': logical_id, 'conflict_id': conflict['id'],
                         'variants': [{'revision_id': r['revision_id'], 'rate_pct': r['rate_pct'], 'provenances': r['provenances']} for r in candidates]})
    return sorted(active, key=lambda r: r['id']), conflicts, warnings


def _merchant_content(row):
    return {'cnpj': str(row['cnpj']), 'ec': str(row.get('ec') or ''),
            'name': ' '.join(str(row.get('name') or '').split()).casefold(),
            'active': bool(row.get('active', True)), 'candidate': bool(row.get('candidate', False))}


def _documented_successions(incoming, existing):
    """Recognize a declared closing interval followed by its contiguous successor.

    An open contract is NOT retired merely because a newer rate overlaps it.
    Both replacement intervals must occur in the newly supplied catalog, the
    old financial value must match the closing interval, and the split must be
    unique. A human-reviewed open interval requires human review of the change.
    """
    incoming = [normalize_rate(r) for r in incoming]
    existing = [normalize_rate(r) for r in existing]
    transitions = []
    for old in existing:
        if not old['start'] or old['end'] or old.get('reviewed_by'):
            continue
        pairs = {}
        for prior in incoming:
            if (prior['cnpj'], prior['product'], prior['rate_pct']) != (old['cnpj'], old['product'], old['rate_pct']):
                continue
            if not prior['end'] or (prior['start'] and prior['start'] > old['start']) or prior['end'] < old['start']:
                continue
            next_day = (date.fromisoformat(prior['end']) + timedelta(days=1)).isoformat()
            for after in incoming:
                if (after['cnpj'], after['product'], after['start']) == (old['cnpj'], old['product'], next_day):
                    pairs[(prior['logical_id'], after['logical_id'])] = (prior, after)
        if len(pairs) != 1:
            continue
        prior, after = next(iter(pairs.values()))
        transition = {'id': 'SUCCESSION-' + content_hash([old['logical_id'], prior['logical_id'], after['logical_id']])[:24],
                      'kind': 'documented_contiguous_split', 'retired_logical_id': old['logical_id'],
                      'previous': old, 'closing_logical_id': prior['logical_id'], 'successor_logical_id': after['logical_id'],
                      'closing_end': prior['end'], 'successor_start': after['start'],
                      'evidence': {'closing': prior['provenances'], 'successor': after['provenances']},
                      'reason': 'Catálogo recebido declara o encerramento com a mesma taxa anterior e uma vigência sucessora contígua; histórico preservado.'}
        transitions.append(transition)
        prior['supersedes_logical_ids'] = sorted(set(prior.get('supersedes_logical_ids', []) + [old['logical_id']]))
        prior['supersession_evidence'] = transition
    return incoming, _unique(transitions)


def reconcile_catalog(incoming, references=None):
    """Return the exact immutable catalog for a run, independently of input path.

    New logical identities extend the catalog. Equal content merges provenance.
    Existing reviewed content is never silently replaced. Unresolved differing
    rate revisions remain explicit and (unless one is reviewed) both stay active,
    so the existing financial engine blocks ambiguous contract selection.
    """
    references = references or {}
    new_rates, transitions = _documented_successions(incoming.get('rates', []), references.get('rates', []))
    transitions = _unique(copy.deepcopy(references.get('catalog_transitions', [])) + transitions)
    candidates = copy.deepcopy(references.get('rates', [])) + new_rates
    for conflict in references.get('catalog_conflicts', []):
        if conflict.get('kind') == 'rate' and conflict.get('status', 'open') == 'open':
            candidates.extend(copy.deepcopy(conflict.get('variants', [])))
    rates, conflicts, warnings = reconcile_rates(candidates)
    conflicts.extend(copy.deepcopy(c) for c in references.get('catalog_conflicts', []) if c.get('kind') == 'merchant' and c.get('status', 'open') == 'open')
    warnings.extend(copy.deepcopy(w) for w in references.get('catalog_warnings', []) if w.get('type') == 'CONFLITO_CADASTRAL')
    existing = {str(m['cnpj']): copy.deepcopy(m) for m in references.get('merchants', [])}
    for merchant in sorted(incoming.get('merchants', []), key=canonical_json):
        cnpj = str(merchant['cnpj'])
        old = existing.get(cnpj)
        if not old:
            existing[cnpj] = copy.deepcopy(merchant)
            continue
        incoming_revision = 'MER-' + content_hash(_merchant_content(merchant))[:24]
        if (_merchant_content(old) != _merchant_content(merchant)
                and incoming_revision not in old.get('supersedes_revision_ids', [])):
            variants = _unique([old, merchant])
            conflict = {'id': 'CAT-' + content_hash([cnpj, [_merchant_content(v) for v in variants]])[:24],
                        'kind': 'merchant', 'cnpj': cnpj, 'status': 'open', 'variants': variants}
            conflicts.append(conflict)
            warnings.append({'type': 'CONFLITO_CADASTRAL', 'message': f'Cadastro {cnpj} difere do catálogo existente. O cadastro vigente foi preservado; revisar a nova evidência.',
                             'source_file': merchant.get('source_file', ''), 'source_ref': merchant.get('source_ref', cnpj), 'conflict_id': conflict['id']})
        # A review marker (including name-only revisions) survives all paths.
        old['provenances'] = _unique(_origins(old) + _origins(merchant))
    merchants = []
    for cnpj, row in sorted(existing.items()):
        row['provenances'] = _origins(row)
        row['revision_id'] = 'MER-' + content_hash(_merchant_content(row))[:24]
        merchants.append(row)
    result = {'merchants': merchants, 'rates': rates, 'catalog_conflicts': _unique(conflicts),
              'catalog_transitions': transitions,
              'catalog_warnings': _unique(warnings), 'parameters': copy.deepcopy(references.get('parameters', {})),
              'catalog_schema_version': SCHEMA_VERSION}
    result['catalog_revision'] = content_hash({k: result[k] for k in ('merchants', 'rates', 'catalog_conflicts', 'catalog_transitions')})
    result['import_warnings'] = _unique(copy.deepcopy(incoming.get('import_warnings', [])) + warnings)
    return result


def ensure_catalog_schema(db):
    statements = [
        'CREATE TABLE IF NOT EXISTS catalog_history (hash TEXT PRIMARY KEY, legacy_id TEXT, logical_id TEXT, revision_id TEXT, data TEXT NOT NULL, actor TEXT, at TEXT)',
        'CREATE TABLE IF NOT EXISTS catalog_aliases (legacy_id TEXT, logical_id TEXT, revision_id TEXT, PRIMARY KEY(legacy_id,logical_id,revision_id))',
        'CREATE TABLE IF NOT EXISTS catalog_versions (logical_id TEXT, revision_id TEXT, data TEXT NOT NULL, PRIMARY KEY(logical_id,revision_id))',
        'CREATE TABLE IF NOT EXISTS catalog_migrations (id TEXT PRIMARY KEY, at TEXT, actor TEXT, detail TEXT NOT NULL)',
    ]
    for sql in statements:
        db.execute(sql)


def persist_rate(db, rate, actor='Sistema'):
    normalized = normalize_rate(rate)
    stamp = datetime.now(timezone.utc).isoformat()
    db.execute('INSERT OR IGNORE INTO catalog_history VALUES (?,?,?,?,?,?,?)',
               (content_hash(rate), str(rate.get('id', '')), normalized['logical_id'], normalized['revision_id'], canonical_json(rate), actor, stamp))
    prior = db.execute('SELECT data FROM catalog_versions WHERE logical_id=? AND revision_id=?', (normalized['logical_id'], normalized['revision_id'])).fetchone()
    version = _equivalent([normalize_rate(json.loads(prior[0])), normalized]) if prior else normalized
    db.execute('INSERT OR REPLACE INTO catalog_versions VALUES (?,?,?)', (version['logical_id'], version['revision_id'], canonical_json(version)))
    for alias in normalized['legacy_ids'] + [str(rate.get('id', normalized['id']))]:
        db.execute('INSERT OR IGNORE INTO catalog_aliases VALUES (?,?,?)', (alias, normalized['logical_id'], normalized['revision_id']))
    # rate.id may include a revision suffix for a genuinely conflicting group.
    db.execute('INSERT OR REPLACE INTO rates VALUES (?,?,?,?,?,?,?)',
               (rate['id'], normalized['cnpj'], normalized['product'], normalized['start'], normalized['end'], normalized['rate_pct'], canonical_json(rate)))


def migrate_catalog(db, actor='Sistema · migração cadastral'):
    """Idempotent atomic migration, safe inside an existing caller transaction."""
    name = 'catalog_reconcile_v1'
    db.execute('SAVEPOINT ' + name)
    try:
        ensure_catalog_schema(db)
        before = [json.loads(r[0]) for r in db.execute('SELECT data FROM rates ORDER BY id')]
        row = db.execute("SELECT value FROM kv WHERE key='source_data'").fetchone()
        latest = json.loads(row[0]) if row else {}
        semantic_rates, _, _ = reconcile_rates(before)
        reconciled = reconcile_catalog({'rates': latest.get('rates', [])}, {'rates': before})
        rates, conflicts, warnings = reconciled['rates'], reconciled['catalog_conflicts'], reconciled['catalog_warnings']
        changed = canonical_json(sorted(before, key=lambda r: r['id'])) != canonical_json(rates)
        detail = {'schema_version': SCHEMA_VERSION, 'before_count': len(before), 'after_count': len(rates),
                  'removed_duplicate_rows': len(before) - len(rates), 'before_hash': content_hash(before), 'after_hash': content_hash(rates),
                  'semantic_duplicate_rows': len(before)-len(semantic_rates),
                  'documented_successions': reconciled['catalog_transitions'], 'conflicts': conflicts, 'changed': changed}
        if changed:
            for row in before:
                persist_rate(db, row, actor)
            wanted = {r['id'] for r in rates}
            for row in before:
                if row['id'] not in wanted:
                    db.execute('DELETE FROM rates WHERE id=?', (row['id'],))
            for row in rates:
                persist_rate(db, row, actor)
            ident = 'MIG-' + content_hash([SCHEMA_VERSION, detail['before_hash'], detail['after_hash']])[:24]
            stamp = datetime.now(timezone.utc).isoformat()
            db.execute('INSERT OR IGNORE INTO catalog_migrations VALUES (?,?,?,?)', (ident, stamp, actor, canonical_json(detail)))
            db.execute('INSERT INTO audit(at,actor,action,detail) VALUES (?,?,?,?)', (stamp, actor, 'catalog_migration', canonical_json(detail)))
            for key, value in [('catalog_conflicts', conflicts), ('catalog_warnings', warnings), ('catalog_transitions', reconciled['catalog_transitions'])]:
                db.execute('INSERT OR REPLACE INTO kv VALUES (?,?)', (key, canonical_json(value)))
        db.execute('RELEASE SAVEPOINT ' + name)
        return detail
    except BaseException:
        db.execute('ROLLBACK TO SAVEPOINT ' + name)
        db.execute('RELEASE SAVEPOINT ' + name)
        raise
