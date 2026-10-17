"""Loopback-only HTTP interface for the local closing platform."""
from __future__ import annotations
import argparse
import json
import mimetypes
import os
import threading
from http.server import BaseHTTPRequestHandler, ThreadingHTTPServer
from pathlib import Path
from urllib.parse import parse_qs, urlparse
from .store import Store, ConflictError, EXPORTS, ROOT, FRONT


def main():
    parser=argparse.ArgumentParser(description='Tarvo · fechamento financeiro local')
    parser.add_argument('--port',type=int,default=8765)
    parser.add_argument('--data-dir',default=os.environ.get('TARVO_SOURCE_DIR',str(ROOT/'data'/'case')))
    parser.add_argument('--db',default=str(ROOT/'data'/'tarvo.sqlite3'))
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

    class Handler(BaseHTTPRequestHandler):
        def log_message(self,fmt,*values):
            # Avoid request bodies, contacts and draft content in process logs.
            print(f'{self.command} {urlparse(self.path).path} · {values[1] if len(values)>1 else ""}',flush=True)

        def respond(self,status,body,content_type='application/json; charset=utf-8',filename=None):
            if isinstance(body,dict): body=json.dumps(body,ensure_ascii=False,default=str).encode()
            if isinstance(body,str): body=body.encode()
            self.send_response(status)
            self.send_header('Content-Type',content_type)
            self.send_header('Content-Length',str(len(body)))
            self.send_header('X-Content-Type-Options','nosniff')
            self.send_header('Cache-Control','no-store')
            self.send_header('Content-Security-Policy',"default-src 'self'; script-src 'self' 'unsafe-inline'; style-src 'self' 'unsafe-inline'; img-src 'self' data:; frame-ancestors 'none'")
            if filename: self.send_header('Content-Disposition',f'attachment; filename="{filename}"')
            self.end_headers()
            self.wfile.write(body)

        def allowed_host(self):
            return self.headers.get('Host','').split(':')[0] in ('127.0.0.1','localhost')

        def do_GET(self):
            if not self.allowed_host(): return self.respond(403,{'error':'Acesso restrito ao computador local.'})
            url=urlparse(self.path); params=parse_qs(url.query)
            try:
                if url.path=='/api/state': return self.respond(200,store.state())
                if url.path=='/api/trace': return self.respond(200,store.trace(params.get('id',[''])[0]))
                if url.path=='/api/export':
                    name=params.get('file',[''])[0]
                    return self.respond(200,store.export_csv(name),'text/csv; charset=utf-8',name)
                if url.path=='/api/report': return self.respond(200,store.report(),'text/html; charset=utf-8')
                if url.path=='/api/export.zip': return self.respond(200,store.export_zip(),'application/zip','tarvo-fechamento.zip')
                if url.path=='/api/health': return self.respond(200,{'ok':True,'mode':'simulation'})
                if url.path.startswith('/api/'): return self.respond(404,{'error':'Recurso não encontrado.'})
                index=FRONT/'index.html'
                if not index.is_file(): return self.respond(503,'Interface não compilada. Rode ./run.sh para gerar front/dist.','text/plain; charset=utf-8')
                name='index.html' if url.path=='/' else url.path.lstrip('/')
                path=(FRONT/name).resolve()
                if not path.is_relative_to(FRONT.resolve()): return self.respond(404,{'error':'Página não encontrada.'})
                if not path.is_file():
                    # Client-side routes (/runs/R-0001, /pipeline...) fall back to the SPA; missing assets stay 404.
                    if '.' in Path(url.path).name: return self.respond(404,{'error':'Página não encontrada.'})
                    path=index
                return self.respond(200,path.read_bytes(),mimetypes.guess_type(path.name)[0] or 'application/octet-stream')
            except ValueError as e: return self.respond(400,{'error':str(e)})

        def do_POST(self):
            if not self.allowed_host(): return self.respond(403,{'error':'Acesso restrito ao computador local.'})
            origin=self.headers.get('Origin')
            if origin and origin not in (f'http://127.0.0.1:{args.port}',f'http://localhost:{args.port}'):
                return self.respond(403,{'error':'Origem externa não permitida.'})
            if not self.headers.get('Content-Type','').startswith('application/json'):
                return self.respond(415,{'error':'Envie JSON.'})
            try:
                length=int(self.headers.get('Content-Length','0'))
                if length<1 or length>1024*1024: return self.respond(413,{'error':'Corpo de requisição inválido ou grande demais.'})
                payload=json.loads(self.rfile.read(length))
                if not isinstance(payload,dict): raise ValueError('Objeto JSON obrigatório.')
                path=urlparse(self.path).path
                if not path.startswith('/api/'): return self.respond(404,{'error':'Ação não encontrada.'})
                return self.respond(200,store.mutate(path.removeprefix('/api/'),payload))
            except ConflictError as e: return self.respond(409,{'error':str(e)})
            except (ValueError,KeyError,TypeError) as e: return self.respond(400,{'error':str(e)})
            except Exception:
                import traceback
                traceback.print_exc()
                return self.respond(500,{'error':'Falha ao processar a operação. Nenhuma alteração parcial foi confirmada.'})

    server=ThreadingHTTPServer(('127.0.0.1',args.port),Handler)
    stop_scheduler=threading.Event()
    def schedule():
        while not stop_scheduler.is_set():
            try: store.scheduler_tick()
            except Exception:
                import traceback
                traceback.print_exc()
            stop_scheduler.wait(60)
    worker=threading.Thread(target=schedule,daemon=True)
    worker.start()
    print(f'Tarvo disponível em http://127.0.0.1:{args.port} · e-mails em simulação',flush=True)
    try: server.serve_forever()
    except KeyboardInterrupt: pass
    finally:
        stop_scheduler.set();worker.join(timeout=2)
        server.server_close();store.close_db()


if __name__=='__main__': main()
