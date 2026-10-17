"""Network-free stand-in for the Anthropic client in chat tests; never selected by production config.

`FakeAnthropic(script)` answers `client.beta.messages.stream(...)` with scripted turns. Each script item
is a list of content blocks, or a callable `(params, previous_results) -> blocks` that can read the tool
results of the previous turn (e.g. to cite the query id the server assigned).
"""
import copy
import itertools
import json
import re
from types import SimpleNamespace


def sql(query, purpose='Consulta de teste'):
    return {'type': 'tool_use', 'name': 'consultar_sql', 'input': {'sql': query, 'proposito': purpose}}


def funnel(dataset, base, steps, value=None):
    return {'type': 'tool_use', 'name': 'funil', 'input': {'dataset': dataset, 'rotulo_base': base,
            'etapas': [{'rotulo': label, 'filtro_sql': where} for label, where in steps], 'coluna_valor': value}}


def answer(texto, **parts):
    data = {'texto': texto, 'tabela': None, 'grafico': None, 'linhas': None, 'verificacao': None, 'partes': None}
    data.update(parts)
    return {'type': 'tool_use', 'name': 'responder', 'input': data}


def note(text):
    return {'type': 'thinking', 'thinking': text, 'signature': 'fake-signature'}


def text(value):
    return {'type': 'text', 'text': value}


class FakeBlock:
    def __init__(self, data):
        self.data = data
        self.type = data['type']

    def to_dict(self, mode='python'):
        return copy.deepcopy(self.data)


class FakeStream:
    def __init__(self, message):
        self.message = message

    def __enter__(self):
        return self

    def __exit__(self, *exc):
        return False

    def get_final_message(self):
        return self.message


class FakeAnthropic:
    def __init__(self, script, model='claude-opus-5-5', usage=(1200, 300, 9000, 0)):
        self.script = list(script)
        self.model = model
        self.usage = usage
        self.requests = []
        self.ids = itertools.count(1)
        self.beta = SimpleNamespace(messages=SimpleNamespace(stream=self.stream))

    def stream(self, **params):
        self.requests.append(copy.deepcopy(params))
        if not self.script: raise AssertionError('O roteiro do cliente falso acabou.')
        step = self.script.pop(0)
        blocks = step(params, last_results(params)) if callable(step) else step
        if isinstance(blocks, Exception): raise blocks
        forced = blocks.get('stop_reason') if isinstance(blocks, dict) else None
        if isinstance(blocks, dict): blocks = blocks['content']
        content = []
        for block in blocks:
            block = copy.deepcopy(block)
            if block['type'] == 'tool_use': block.setdefault('id', f'toolu_fake_{next(self.ids)}')
            content.append(FakeBlock(block))
        stop = forced or ('tool_use' if any(block.type == 'tool_use' for block in content) else 'end_turn')
        usage = SimpleNamespace(input_tokens=self.usage[0], output_tokens=self.usage[1], cache_read_input_tokens=self.usage[2], cache_creation_input_tokens=self.usage[3])
        return FakeStream(SimpleNamespace(content=content, stop_reason=stop, usage=usage, model=self.model))


def last_results(params):
    """Tool results the server sent in the last user message, parsed when they are JSON."""
    messages = params['messages']
    if not messages or messages[-1]['role'] != 'user': return []
    results = []
    for block in messages[-1]['content']:
        if block.get('type') != 'tool_result': continue
        try: content = json.loads(block['content'])
        except (TypeError, ValueError): content = block['content']
        results.append({'content': content, 'is_error': block.get('is_error', False)})
    return results


def query_id(results, index=0):
    return results[index]['content']['id']


class DemoAnalyst(FakeAnthropic):
    """Browser QA without the API: answers any question about the open table with real queries on it
    (row count and the first money control column, broken down by a short category column when there is one).
    Used only by serve_chat_demo.py."""

    def __init__(self):
        super().__init__([])

    def stream(self, **params):
        self.script = [self._plan(params)] if not self.script else self.script
        return super().stream(**params)

    def _plan(self, params):
        messages = params['messages']
        if messages[-1]['role'] == 'user' and any(block.get('type') == 'tool_result' for block in messages[-1]['content']):
            return self._answer(params)
        prompt = next(block['text'] for block in messages[-1]['content'] if block.get('type') == 'text')
        dataset = re.search(r'tabela (\w+),', prompt).group(1)
        catalog = params['system'][1]['text']
        section = catalog.split(f'\n## {dataset}:')[1].split('\n## ')[0]
        money = re.findall(r'^- (\w+) DECIMAL\(18,2\)', section, re.M)
        category = next(iter(re.findall(r'^- (\w+) VARCHAR: [^\n]* Valores: ', section, re.M)), None)
        self.plan = {'dataset': dataset, 'money': money[0] if money else None, 'category': category,
                     'selection': 'selecao' in prompt and 'Seleção do analista' in prompt}
        where = ' WHERE _rid IN (SELECT _rid FROM selecao)' if self.plan['selection'] else ''
        value = f', SUM({self.plan["money"]}) AS total' if self.plan['money'] else ''
        blocks = [note('Vou somar a tabela do passo e quebrar pela categoria principal.'),
                  sql(f'SELECT COUNT(*) AS linhas{value} FROM {dataset}{where}', 'Total da base')]
        if category and self.plan['money']:
            blocks.append(sql(f'SELECT {category} AS categoria, COUNT(*) AS linhas, SUM({self.plan["money"]}) AS total FROM {dataset}{where} '
                              f'GROUP BY 1 ORDER BY total DESC', 'Quebra por categoria'))
        return blocks

    def _answer(self, params):
        plan, results = self.plan, last_results(params)
        if any(item['is_error'] for item in results):
            return [answer('Não consegui consultar esta tabela.')]
        first = query_id(results)
        where = '_rid IN (SELECT _rid FROM selecao)' if plan['selection'] else ''
        base = 'nas linhas selecionadas' if plan['selection'] else 'na tabela do passo'
        if not plan['money']:
            return [answer(f'Há {{{first}.linhas:int}} linhas {base}.', linhas={'dataset': plan['dataset'], 'filtro_sql': where, 'rotulo': 'Linhas da base'},
                           verificacao={'consulta': first, 'coluna': 'linhas', 'linha': None, 'dataset': plan['dataset'], 'coluna_base': None,
                                        'agregacao': 'contagem', 'filtro_sql': where or None})]
        parts = {}
        texto = f'O total {base} é {{{first}.total:brl}}, em {{{first}.linhas:int}} linhas.'
        if len(results) > 1:
            second = query_id(results, 1)
            texto += f' A maior parte está em {{{second}.categoria:texto}}, com {{{second}.total:brl}}.'
            parts = {'tabela': {'consulta': second, 'colunas': ['categoria', 'linhas', 'total']},
                     'grafico': {'tipo': 'barras', 'consulta': second, 'coluna_rotulo': 'categoria', 'coluna_valor': 'total', 'formato': 'brl'},
                     'partes': {'consulta': second, 'coluna': 'total'}}
        return [answer(texto, linhas={'dataset': plan['dataset'], 'filtro_sql': where, 'rotulo': 'Linhas somadas'},
                       verificacao={'consulta': first, 'coluna': 'total', 'linha': None, 'dataset': plan['dataset'], 'coluna_base': plan['money'],
                                    'agregacao': 'soma', 'filtro_sql': where or None}, **parts)]
