"""Golden questions about the September 2026 pack, with the expected answer computed in Python Decimal
straight from the step outputs (never from SQL). Used two ways:
- tests check that each reference SQL, run through the chat engine, gives exactly the expected value;
- run_golden.py asks the real model (needs a credential) and grades its verified answers.
"""
from collections import defaultdict
from decimal import ROUND_HALF_UP, Decimal


def _sum(rows, column, keep=lambda row: True):
    return sum((Decimal(row[column]) for row in rows if keep(row) and row.get(column) not in (None, '')), Decimal(0))


def _top_merchant(rows_of):
    totals = defaultdict(Decimal)
    for row in rows_of('comissoes'): totals[row['lojista']] += Decimal(row['comissao_brl'])
    return max(totals.items(), key=lambda item: item[1])[0]


GOLDEN = [
    {'id': 'bruto_orbe', 'pergunta': 'Qual o bruto total do relatório da Orbe?', 'step_id': 's1', 'dataset': 'raw_orbe', 'estilo': 'brl',
     'sql': 'SELECT SUM(gross) AS valor FROM raw_orbe', 'esperado': lambda r: _sum(r('raw_orbe'), 'gross')},
    {'id': 'bruto_elo', 'pergunta': 'Quanto a bandeira ELO soma de bruto?', 'step_id': 's4', 'dataset': 'mdr_conferido', 'estilo': 'brl',
     'sql': "SELECT SUM(gross) AS valor FROM mdr_conferido WHERE brand = 'ELO'", 'esperado': lambda r: _sum(r('mdr_conferido'), 'gross', lambda row: row['brand'] == 'ELO')},
    {'id': 'linhas_com_excecao', 'pergunta': 'Quantas transações têm exceção neste passo?', 'step_id': 's4', 'dataset': 'mdr_conferido', 'estilo': 'int',
     'sql': "SELECT COUNT(*) AS valor FROM mdr_conferido WHERE __exception_ids IS NOT NULL AND __exception_ids <> '[]'",
     'esperado': lambda r: Decimal(sum(1 for row in r('mdr_conferido') if row.get('__exception_ids')))},
    {'id': 'impacto_mdr', 'pergunta': 'Qual o impacto total das divergências de taxa?', 'step_id': 's4', 'dataset': 'mdr_conferido', 'estilo': 'brl',
     'sql': 'SELECT SUM(impacto_rs) AS valor FROM mdr_conferido', 'esperado': lambda r: _sum(r('mdr_conferido'), 'impacto_rs')},
    {'id': 'comissao_checkout', 'pergunta': 'Qual a comissão de checkout total do mês?', 'step_id': 's5', 'dataset': 'checkout_calculado', 'estilo': 'brl',
     'sql': 'SELECT SUM(comissao_brl) AS valor FROM checkout_calculado', 'esperado': lambda r: _sum(r('checkout_calculado'), 'comissao_brl')},
    {'id': 'comissao_remessa', 'pergunta': 'Qual a comissão total das remessas de câmbio?', 'step_id': 's7', 'dataset': 'cambio_calculado', 'estilo': 'brl',
     'sql': 'SELECT SUM(comissao_brl) AS valor FROM cambio_calculado', 'esperado': lambda r: _sum(r('cambio_calculado'), 'comissao_brl')},
    {'id': 'maior_comissao', 'pergunta': 'Qual lojista tem a maior comissão no mês, somando checkout e remessa?', 'step_id': 's8', 'dataset': 'comissoes', 'estilo': 'texto',
     'sql': 'SELECT lojista AS valor FROM comissoes GROUP BY lojista ORDER BY SUM(comissao_brl) DESC LIMIT 1', 'esperado': _top_merchant},
    {'id': 'spread_negativo', 'pergunta': 'Quantas operações de câmbio têm spread negativo?', 'step_id': 's7', 'dataset': 'cambio_calculado', 'estilo': 'int',
     'sql': 'SELECT COUNT(*) AS valor FROM cambio_calculado WHERE spread_brl < 0',
     'esperado': lambda r: Decimal(sum(1 for row in r('cambio_calculado') if row.get('spread_brl') not in (None, '') and Decimal(row['spread_brl']) < 0))},
    {'id': 'lote_debito', 'pergunta': 'Qual o total a débito do lote de lançamentos?', 'step_id': 's8', 'dataset': 'lancamentos', 'estilo': 'brl',
     'sql': 'SELECT SUM(debito) AS valor FROM lancamentos', 'esperado': lambda r: _sum(r('lancamentos'), 'debito')},
    {'id': 'ticket_medio', 'pergunta': 'Qual o bruto médio por transação no relatório da Orbe?', 'step_id': 's1', 'dataset': 'raw_orbe', 'estilo': 'brl',
     'sql': 'SELECT ROUND(SUM(gross) / COUNT(*), 2)::DECIMAL(18,2) AS valor FROM raw_orbe',
     'esperado': lambda r: (_sum(r('raw_orbe'), 'gross') / len(r('raw_orbe'))).quantize(Decimal('0.01'), rounding=ROUND_HALF_UP)},
]
