"""Read-only conference views over immutable workflow results, never the latest store result."""
import copy
import csv
import html
import io
import json
import zipfile
from decimal import Decimal
from ..store import Store, EXPORTS
from ..pipeline.service import ServiceError

RESOLVED_STATUSES = {'accepted', 'adjusted', 'excluded', 'resolved'}
OUTPUT_DATASETS = {'comissoes': 'comissoes', 'divergencias': 'divergencias',
                   'notas': 'notas', 'pendencias': 'pendencias', 'rastro': 'rastro',
                   # The dataset named lancamentos is the ERP double-entry
                   # ledger. Official bank lines are a different saved output.
                   'lancamentos': 'bancos_classificados', 'details': 'detalhes_calculo'}
OUTPUT_TITLES = {'comissoes': 'Comissões', 'divergencias': 'Divergências',
                 'notas': 'Notas propostas', 'pendencias': 'Pendências e decisões',
                 'lancamentos': 'Lançamentos classificados', 'rastro': 'Rastro',
                 'details': 'Detalhes do cálculo'}


def _historical_result(run, rows):
    """Read pre-upgrade outputs without calling a calculator or writing a run.

    A missing table is different from a saved empty table. Consumers receive an
    explicit per-output limitation and cannot export a missing table as zeros.
    """
    if not any(name in run['datasets'] for name in ('comissoes', 'notas', 'pendencias', 'rastro')):
        raise ServiceError(409, 'RESULT_NOT_READY', 'A execução ainda não produziu a conferência. Acompanhe os passos do pipeline.')
    unavailable = [{'output': key, 'dataset': name,
                    'message': f'{OUTPUT_TITLES[key]} indisponível: esta execução antiga não preservou o dataset {name}. Nenhum valor foi recalculado.'}
                   for key, name in OUTPUT_DATASETS.items() if name not in run['datasets']]
    missing = {item['output'] for item in unavailable}
    result = {key: rows(name) for key, name in OUTPUT_DATASETS.items()}

    def total(key, column, business=None, absolute=False):
        if key in missing:
            return None
        values = (Decimal(r[column]) for r in result[key] if business is None or r.get('linha_negocio') == business)
        return format(sum((abs(v) if absolute else v for v in values), Decimal(0)), '.2f')

    steps = run.get('steps', [])
    checkout = next((s for s in steps if any(o.get('name') == 'checkout_calculado' for o in s.get('outputs', []))), {})
    remittance = next((s for s in steps if any(o.get('name') == 'cambio_calculado' for o in s.get('outputs', []))), {})
    # Old metrics save stage row counts, not the engine's checkout count after
    # rejecting conflicting duplicate IDs. Expose the metric with its own name.
    stage_counts = {'checkout_stage_rows': checkout.get('metrics', {}).get('rows_out'),
                    'remittance_unique_operations': remittance.get('metrics', {}).get('unique_operations')}
    result['summary'] = {
        'period': run['competencia'], 'checkout_brl': total('comissoes', 'comissao_brl', 'CHECKOUT'),
        'remessa_brl': total('comissoes', 'comissao_brl', 'REMESSA'),
        'divergencias_brl': total('divergencias', 'diferenca_brl'),
        'divergencias_abs_brl': total('divergencias', 'diferenca_brl', absolute=True),
        'notas_brl': total('notas', 'valor_brl'), 'checkout_count': None,
        'remessa_count': stage_counts['remittance_unique_operations'],
        'bank_count': None if 'lancamentos' in missing else len(result['lancamentos']),
        'pendencias_count': None if 'pendencias' in missing else len(result['pendencias']),
        'divergencias_count': None if 'divergencias' in missing else len(result['divergencias']),
        'notas_count': None if 'notas' in missing else len(result['notas']),
        'remittance_tolerance_pp': remittance.get('params', {}).get('tolerancia_pp'),
        'historical_stage_counts': stage_counts,
    }
    limitations = [*unavailable, {'output': 'summary.checkout_count', 'dataset': 'resultado_snapshot',
                   'message': 'A contagem original de operações checkout não foi preservada. A métrica de linhas da etapa permanece em historical_stage_counts; não substitui a contagem após tratamento de duplicidades.'}]
    return result, unavailable, limitations


def run_state(flow, store, run_id, comp=None):
    with flow.lock:
        run = flow.get_run(run_id)
        if comp and run['competencia'] != comp:
            raise ServiceError(422, 'RUN_PERIOD_MISMATCH', 'A execução selecionada pertence a outra competência.')
        def rows(name):
            return copy.deepcopy(flow._rows(run['datasets'][name])) if name in run['datasets'] else []
        meta = run['datasets'].get('resultado_snapshot')
        if meta:
            saved = rows('resultado_snapshot')
            if len(saved) != 1:
                raise ServiceError(409, 'RESULT_UNAVAILABLE', 'O snapshot de resultados desta execução está incompleto.')
            result, unavailable, limitations = saved[0], [], []
            basis = 'resultado_snapshot'
        else:
            result, unavailable, limitations = _historical_result(run, rows)
            basis = 'preserved_datasets'
        exceptions = flow._exceptions(run_id)
        decisions = {e['id']: e for e in exceptions}
        for issue in result['pendencias']:
            decision = decisions.get(issue['id_saida'], {})
            issue['status'] = 'resolved' if decision.get('status') in RESOLVED_STATUSES else 'open'
            issue['review_status'] = decision.get('status', 'open')
            detail = copy.deepcopy(decision.get('decision'))
            if detail:
                detail['note'] = detail.get('note', detail.get('justificativa', ''))
                detail.setdefault('actor', '')
                detail.setdefault('at', '')
                if detail.get('recommendation_id'):
                    issue['operational_status'] = detail.get('follow_up_status', 'pending')
                    issue['follow_up'] = detail.get('follow_up', '')
            issue['decision'] = detail
        summary = result['summary']
        summary.update(open_issues=sum(e.get('status') not in RESOLVED_STATUSES for e in exceptions),
                       resolved_issues=sum(e.get('status') in RESOLVED_STATUSES for e in exceptions),
                       blocking_issues=sum(e.get('status') not in RESOLVED_STATUSES and e.get('severidade') == 'bloqueante' for e in exceptions))
        sums, unknown, trace_counts = {}, {}, {}
        for row in result['rastro']:
            identifier = row['id_saida']
            trace_counts[identifier] = trace_counts.get(identifier, 0) + 1
            sums.setdefault(identifier, Decimal(0))
            if row.get('valor') is None:
                unknown[identifier] = unknown.get(identifier, 0) + 1
            else:
                sums[identifier] += Decimal(row['valor'])
        missing = {item['output'] for item in unavailable}
        errors = []
        if 'rastro' not in missing:
            for key, value in [('comissoes','comissao_brl'),('notas','valor_brl'),('divergencias','diferenca_brl'),('pendencias','valor_brl'),('lancamentos','valor')]:
                for row in result[key]:
                    identifier = row['id_saida']
                    if row.get(value) is None:
                        valid = (key == 'pendencias' and row.get('group_scope') == 'merchant_period'
                                 and row.get('exposure_status') in {'partial', 'unavailable'}
                                 and unknown.get(identifier, 0) == row.get('missing_exposure_count', 0) > 0
                                 and trace_counts.get(identifier) == row.get('operation_count')
                                 and sums.get(identifier) == Decimal(str(row.get('known_exposure_brl', '0'))))
                    else:
                        valid = not unknown.get(identifier) and sums.get(identifier) == Decimal(row[value])
                    if not valid: errors.append(f'Rastro não fecha: {identifier}')
        references = run['snapshot'].get('references', {})
        manifest = rows('input_manifest') or copy.deepcopy(run['snapshot'].get('sources', []))
        assumptions = copy.deepcopy(run['snapshot'].get('assumptions', []))
        if 'assumptions' not in run['snapshot']:
            limitations.append({'output': 'assumptions', 'dataset': 'snapshot',
                                'message': 'Esta execução antiga não preservou hipóteses. O catálogo atual não foi usado para reconstruir decisões históricas.'})
        base = store.state()
        return {**base, 'period': run['competencia'], 'competencia': run['competencia'], 'run_id': run_id,
                'assumptions': assumptions, 'assumptions_snapshot_status': 'captured' if 'assumptions' in run['snapshot'] else 'legacy_unavailable',
                'scope': {'competencia': run['competencia'], 'run_id': run_id}, 'read_only': True, 'has_data': True,
                'closing': {'status': run['status'], 'actor': run['created_by'], 'closed_at': run['finished_at'], 'waiver': False, 'reason': ''},
                'results': result, 'summary': summary, 'exceptions': exceptions, 'merchants': references.get('merchants', rows('raw_merchants')),
                'rates': references.get('rates', rows('raw_rates')), 'parameters': references.get('parameters', {}),
                'accounts': rows('accounts'), 'sources': manifest, 'input_manifest': manifest,
                'ingestion_counts': next(iter(rows('ingestion_counts')), {}),
                'source_dir': run.get('source_dir'), 'audit': flow.audit(run_id).get('records', []),
                'result_basis': basis, 'unavailable_outputs': unavailable, 'limitations': limitations,
                'notifications': [], 'emails': [], 'validation': {'errors': errors, 'warnings': rows('import_warnings'), 'limitations': limitations,
                'trace_ok': None if missing else not errors, 'source_count': len(manifest)}}


def official_csv(state, name):
    if name not in EXPORTS: raise ServiceError(422, 'INVALID_EXPORT', 'Arquivo oficial desconhecido.')
    key, columns = EXPORTS[name]
    limitation = next((item for item in state.get('unavailable_outputs', []) if item['output'] == key), None)
    if limitation:
        raise ServiceError(409, 'HISTORICAL_OUTPUT_UNAVAILABLE', limitation['message'], [limitation])
    # Preserve the supplied six-file public schema. Complete group provenance is
    # carried by the ZIP manifest and the pipeline exception report.
    out = io.StringIO(newline='')
    writer = csv.DictWriter(out, columns, delimiter=';', lineterminator='\n', extrasaction='ignore')
    writer.writeheader()
    for row in state['results'][key]:
        writer.writerow({key: json.dumps(value, ensure_ascii=False, sort_keys=True) if isinstance(value, (dict, list)) else value
                         for key, value in row.items()})
    return out.getvalue().encode('utf-8')


def report(state):
    class SnapshotView:
        def state(self): return state
    # Existing renderer reads only state, with no writes or access to the current period.
    document = Store.report(SnapshotView())
    if state.get('run_id'):
        document = document.replace('Os valores refletem as referências atuais.', 'Os valores financeiros originais e as referências desta execução estão preservados. As decisões aparecem na conferência; ajustes e exclusões do lote são aplicados somente à exportação ERP após aprovação.')
    for item in state.get('unavailable_outputs', []):
        title = OUTPUT_TITLES[item['output']]
        document = document.replace(f'<h2>{title}</h2><p>Nenhum registro.</p>', f'<h2>{title}</h2><p class="warning">{html.escape(item["message"])}</p>')
    if state.get('limitations'):
        warnings = '<aside class="warning"><strong>Limitações da conferência histórica</strong><ul>' + ''.join('<li>' + html.escape(item['message']) + '</li>' for item in state['limitations']) + '</ul></aside>'
        document = document.replace('</h1>', '</h1>' + warnings, 1)
    return document


def export_zip(state):
    out = io.BytesIO()
    missing = {item['output'] for item in state.get('unavailable_outputs', [])}
    included = [name for name, (key, _) in EXPORTS.items() if key not in missing]
    results = state['results']
    details = results.get('details', [])
    if isinstance(details, dict): details = list(details.values())
    groups = [{**issue,
               'trace': [row for row in results.get('rastro', []) if row.get('id_saida') == issue['id_saida']],
               'details': [row for row in details if row.get('id_saida') == issue['id_saida']]}
              for issue in results.get('pendencias', []) if issue.get('group_scope') == 'merchant_period']
    with zipfile.ZipFile(out, 'w', zipfile.ZIP_DEFLATED) as archive:
        for name in included: archive.writestr(name, official_csv(state, name))
        archive.writestr('relatorio.html', report(state))
        archive.writestr('manifesto.json', json.dumps({'run_id': state['run_id'], 'competencia': state['period'], 'sources': state['sources'],
                         'result_basis': state.get('result_basis', 'legacy_store'), 'files': included,
                         'registration_groups': groups,
                         'unavailable_outputs': state.get('unavailable_outputs', []), 'limitations': state.get('limitations', [])}, ensure_ascii=False))
    return out.getvalue()
