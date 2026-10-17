"""Decimal-only summaries of the current source conference (not workflow approvals)."""
from decimal import Decimal


def build_insights(period, results):
    def number(value):
        return Decimal(str(value))
    def money(value):
        return format(value, '.2f')
    def counter():
        return {'count': 0, 'total': Decimal(0)}
    states = {key: counter() for key in ('bloqueante', 'alerta', 'resolvido')}
    types = {}
    for issue in results.get('pendencias', []):
        value = abs(number(issue['valor_brl']))
        decided = issue.get('status') == 'resolved'
        blocking = issue.get('severity') == 'bloqueante'
        bucket = states['resolvido' if decided else 'bloqueante' if blocking else 'alerta']
        bucket['count'] += 1
        bucket['total'] += value
        item = types.setdefault(issue['tipo'], {**counter(), 'open': 0, 'blocking': False})
        item['count'] += 1
        item['blocking'] |= blocking
        if not decided:
            item['open'] += 1
            item['total'] += value
    divergences = {}
    for row in results.get('divergencias', []):
        item = divergences.setdefault(row.get('cnpj', ''), {'count': 0, 'signed': Decimal(0), 'abs': Decimal(0), 'name': row.get('lojista', row.get('cnpj', ''))})
        value = number(row['diferenca_brl'])
        item['count'] += 1
        item['signed'] += value
        item['abs'] += abs(value)
    banks, accounts = {}, {}
    for row in results.get('lancamentos', []):
        value = number(row['valor'])
        inflow, outflow = max(value, Decimal(0)), max(-value, Decimal(0))
        bank = banks.setdefault(row['banco'], {'account': row.get('conta_bancaria', ''), 'count': 0, 'in': Decimal(0), 'out': Decimal(0), 'daily': {}})
        bank['count'] += 1
        bank['in'] += inflow
        bank['out'] += outflow
        day = bank['daily'].setdefault(row['data'], {'in': Decimal(0), 'out': Decimal(0)})
        day['in'] += inflow
        day['out'] += outflow
        account = accounts.setdefault(row.get('conta_codigo', ''), {'name': row.get('conta_descricao', ''), 'count': 0, 'in': Decimal(0), 'out': Decimal(0), 'abs': Decimal(0)})
        account['count'] += 1
        account['in'] += inflow
        account['out'] += outflow
        account['abs'] += abs(value)
    note_lines = {}
    notes = results.get('notas', [])
    for row in notes:
        item = note_lines.setdefault(row['linha_negocio'], counter())
        item['count'] += 1
        item['total'] += number(row['valor_brl'])
    labels = {'bloqueante': 'Bloqueantes abertas', 'alerta': 'Alertas abertos', 'resolvido': 'Decididas'}
    return {
        'comp': period, 'source': 'current_conference',
        'pendencias': {
            'open_brl': money(states['bloqueante']['total'] + states['alerta']['total']),
            'resolved_brl': money(states['resolvido']['total']),
            'open_count': states['bloqueante']['count'] + states['alerta']['count'], 'resolved_count': states['resolvido']['count'],
            'by_state': [{'key': key, 'label': labels[key], 'count': item['count'], 'brl': money(item['total'])} for key, item in states.items()],
            'by_type': [{'key': key, 'label': key.replace('_', ' ').capitalize(), 'count': item['count'], 'open_count': item['open'], 'brl': money(item['total']), 'severity': 'bloqueante' if item['blocking'] else 'alerta'} for key, item in sorted(types.items(), key=lambda pair: (-pair[1]['total'], -pair[1]['open']))],
        },
        'divergencias_por_lojista': [{'cnpj': key, 'lojista': item['name'], 'count': item['count'], 'signed_brl': money(item['signed']), 'abs_brl': money(item['abs'])} for key, item in sorted(divergences.items(), key=lambda pair: -pair[1]['abs'])],
        'bancos': [{'bank': key, 'account': item['account'], 'count': item['count'], 'in_brl': money(item['in']), 'out_brl': money(item['out']), 'net_brl': money(item['in'] - item['out']), 'daily': [{'date': day, 'in_brl': money(values['in']), 'out_brl': money(values['out'])} for day, values in sorted(item['daily'].items())]} for key, item in sorted(banks.items())],
        'contas': [{'code': key, 'name': item['name'], 'count': item['count'], 'abs_brl': money(item['abs']), 'in_brl': money(item['in']), 'out_brl': money(item['out'])} for key, item in sorted(accounts.items(), key=lambda pair: -pair[1]['abs'])],
        'notas': {'total_brl': money(sum((item['total'] for item in note_lines.values()), Decimal(0))), 'count': len(notes), 'by_line': [{'line': key, 'count': item['count'], 'brl': money(item['total'])} for key, item in sorted(note_lines.items())]},
    }
