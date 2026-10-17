"""Loopback-only HTTP interface for the local closing platform."""
from __future__ import annotations
import argparse
import json
import os
from pathlib import Path
from .store import Store, ConflictError, EXPORTS, ROOT


def main():
    parser=argparse.ArgumentParser(description='Tarvo · fechamento financeiro local')
    parser.add_argument('--port',type=int,default=8765)
    parser.add_argument('--data-dir',default=os.environ.get('TARVO_SOURCE_DIR',str(ROOT/'data'/'case')))
    parser.add_argument('--db',default=str(ROOT/'data'/'tarvo.sqlite3'))
    parser.add_argument('--runs-dir',default=str(ROOT/'saida'/'runs'))
    parser.add_argument('--export',action='store_true',help='Gerar saida/ e encerrar')
    args=parser.parse_args()
    store=Store(args.db,args.data_dir)
    if args.export:
        out=ROOT/'saida';out.mkdir(exist_ok=True)
        for name in EXPORTS: (out/name).write_bytes(store.export_csv(name))
        (out/'relatorio.html').write_text(store.report(),encoding='utf-8')
        state=store.state()
        (out/'verificacao.json').write_text(json.dumps({'period':state['period'],'summary':state['summary'],'validation':state['validation'],'sources':state['sources']},ensure_ascii=False,indent=2),encoding='utf-8')
        print(f'Saídas geradas em {out}')
        store.close_db()
        return

    store.close_db()
    import uvicorn
    from .api.app import create_app
    app = create_app(args.db, args.data_dir, args.runs_dir)
    print(f'Tarvo disponível em http://127.0.0.1:{args.port} · avisos internos e cobranças em simulação', flush=True)
    uvicorn.run(app, host='127.0.0.1', port=args.port, log_level='warning', access_log=False)


if __name__ == '__main__':
    main()
