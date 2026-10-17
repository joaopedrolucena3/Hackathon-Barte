"""Export only user-visible transcript events, never private reasoning/system context.

Usage: python PROMPTS/exportar_sessoes.py /path/to/rollout.jsonl [...]
The raw input is not modified. Review the visible export for personal data before publishing.
"""
import json
import re
import sys
from pathlib import Path

destination=Path(__file__).resolve().parent
for filename in sys.argv[1:]:
    source=Path(filename)
    events=[]
    lines=source.read_text(encoding='utf-8').split('\n')
    for position,line in enumerate(lines):
        if not line.strip():
            continue
        try:
            event=json.loads(line)
        except json.JSONDecodeError:
            if position==len(lines)-1:
                print(source.name, 'último evento ainda em gravação; exporte novamente depois')
                break
            raise
        if event.get('type')!='response_item':
            continue
        payload=event.get('payload',{})
        kind=payload.get('type')
        if kind in ('reasoning','compaction'):
            continue
        if kind=='message' and (payload.get('role') not in ('user','assistant') or payload.get('channel') not in (None,'commentary','final')):
            continue
        if kind not in ('message','function_call','function_call_output','custom_tool_call','custom_tool_call_output'):
            continue
        # Personal filesystem account name; no rewriting of substantive conversation.
        serialized=json.dumps(event,ensure_ascii=False)
        serialized=serialized.replace('/Users/joaopedro/','/Users/[USUARIO]/')
        serialized=re.sub(r'sk-[A-Za-z0-9_-]{20,}', '[CHAVE_REMOVIDA]',serialized)
        events.append(serialized)
    suffix=source.stem.split('T',1)[-1]
    output=destination/f'SESSAO_{suffix}.jsonl'
    output.write_text('\n'.join(events)+'\n',encoding='utf-8')
    print(output.name, len(events), 'eventos visíveis')
