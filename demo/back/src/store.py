"""Local SQLite workflow: immutable imports, recalculation, human decisions and mail sandbox."""
from __future__ import annotations

import copy
import csv
import hashlib
import html
import io
import json
import re
import sqlite3
import threading
import zipfile
from datetime import date, datetime, timezone
from decimal import Decimal, InvalidOperation
from pathlib import Path
from zoneinfo import ZoneInfo

from .engine import calculate, load_data

ROOT = Path(__file__).resolve().parents[1]
FRONT = ROOT.parent / 'front' / 'dist'
EXPORTS = {
    'comissoes_por_lojista.csv': ('comissoes', ['id_saida','cnpj','lojista','linha_negocio','comissao_brl']),
    'divergencias_taxa.csv': ('divergencias', ['id_saida','cnpj','linha_negocio','ref_origem','taxa_contratada_pct','taxa_aplicada_pct','diferenca_brl']),
    'notas_a_emitir.csv': ('notas', ['id_saida','tomador_cnpj','tomador','linha_negocio','valor_brl','discriminacao']),
    'lancamentos_classificados.csv': ('lancamentos', ['id_saida','banco','ref_origem','data','descricao','valor','conta_codigo','metodo','confianca']),
    'pendencias.csv': ('pendencias', ['id_saida','tipo','ref_origem','valor_brl','motivo','quem_decide']),
    'rastro.csv': ('rastro', ['id_saida','arquivo_origem','ref_origem','valor']),
}
SEVERITIES = {'informativo': 0, 'atencao': 1, 'bloqueante': 2}


def encode(value):
    return json.dumps(value, ensure_ascii=False, sort_keys=True, default=str)


def digest(value):
    return hashlib.sha256(encode(value).encode()).hexdigest()


def now():
    return datetime.now(timezone.utc).isoformat(timespec='microseconds')


def today():
    return datetime.now(ZoneInfo('America/Sao_Paulo')).date()


class ConflictError(ValueError):
    pass


class Store:
    def __init__(self, db_path, source_dir):
        self.lock = threading.RLock()
        self.source_dir = str(Path(source_dir).resolve())
        Path(db_path).parent.mkdir(parents=True, exist_ok=True)
        self.db = sqlite3.connect(str(db_path), check_same_thread=False)
        self.db.row_factory = sqlite3.Row
        self.db.execute('PRAGMA journal_mode=WAL')
        self.db.executescript('''
            CREATE TABLE IF NOT EXISTS kv (key TEXT PRIMARY KEY, value TEXT NOT NULL);
            CREATE TABLE IF NOT EXISTS imports (id INTEGER PRIMARY KEY, at TEXT, path TEXT, hash TEXT, data TEXT);
            CREATE TABLE IF NOT EXISTS merchants (cnpj TEXT PRIMARY KEY, data TEXT NOT NULL);
            CREATE TABLE IF NOT EXISTS rates (id TEXT PRIMARY KEY, cnpj TEXT, product TEXT, start TEXT, end TEXT, rate_pct TEXT, data TEXT NOT NULL);
            CREATE TABLE IF NOT EXISTS contacts (id TEXT PRIMARY KEY, data TEXT NOT NULL);
            CREATE TABLE IF NOT EXISTS decisions (period TEXT, id TEXT, fingerprint TEXT, data TEXT, PRIMARY KEY(period,id));
            CREATE TABLE IF NOT EXISTS emails (id TEXT PRIMARY KEY, data TEXT NOT NULL);
            CREATE TABLE IF NOT EXISTS notifications (id TEXT PRIMARY KEY, data TEXT NOT NULL);
            CREATE TABLE IF NOT EXISTS audit (id INTEGER PRIMARY KEY, at TEXT, actor TEXT, action TEXT, detail TEXT);
            CREATE TABLE IF NOT EXISTS runs (id INTEGER PRIMARY KEY, at TEXT, period TEXT, input_hash TEXT, result_hash TEXT, result TEXT);
        ''')
        self.db.commit()
        fresh=self.get('source_data') is None
        if fresh:
            with self.db:
                self.put('period','2026-09')
                self.put('parameters', {'remittance_tolerance_pp':'0.002','closing_deadline':'2026-10-17','remittance_share_pct':'50','mode':'simulation'})
                self._import(self.source_dir, 'Sistema · importação inicial')
        engine_version=hashlib.sha256((ROOT/'src'/'engine.py').read_bytes()).hexdigest()
        with self.db:
            if not fresh and self.get('engine_version')!=engine_version:
                self._recalculate('Sistema · atualização das regras verificadas')
            self.put('engine_version',engine_version)

    def close_db(self):
        self.db.close()

    def get(self,key,default=None):
        row=self.db.execute('SELECT value FROM kv WHERE key=?',(key,)).fetchone()
        return json.loads(row[0]) if row else default

    def put(self,key,value):
        self.db.execute('INSERT OR REPLACE INTO kv VALUES (?,?)',(key,encode(value)))

    def records(self,table):
        if table not in {'merchants','rates','contacts','emails','notifications'}:
            raise ValueError('Tabela inválida')
        return [json.loads(r['data']) for r in self.db.execute(f'SELECT data FROM {table} ORDER BY rowid')]

    def _audit(self,actor,action,detail):
        self.db.execute('INSERT INTO audit(at,actor,action,detail) VALUES (?,?,?,?)',(now(),actor,action,encode(detail)))

    def _import(self,path,actor):
        p=Path(path).expanduser().resolve()
        if not p.is_dir():
            raise ValueError('A pasta de origem não existe.')
        data=load_data(p)
        if not data.get('checkout') and not data.get('remittances'):
            raise ValueError('Nenhuma operação foi encontrada na importação.')
        old_rates={r['id']:r for r in self.records('rates')}
        for rate in data.get('rates',[]):
            old=old_rates.get(rate['id'])
            fields=('cnpj','product','start','end','rate_pct')
            if old and any(str(old.get(k,''))!=str(rate.get(k,'')) for k in fields):
                data.setdefault('import_warnings',[]).append({'type':'REFERENCIA_ALTERADA','message':f'Taxa {rate["id"]} difere da referência já revisada. A referência do banco foi preservada; revisar vigência e taxa pela interface.','source_file':rate.get('source_file',''),'source_ref':rate.get('source_ref','')})
        self.db.execute('INSERT INTO imports(at,path,hash,data) VALUES (?,?,?,?)',(now(),str(p),digest(data),encode(data)))
        self.put('source_data',data)
        self.put('source_dir',str(p))
        # Reimporting raw transactions must not discard analyst-maintained reference data.
        for merchant in data.get('merchants',[]):
            self.db.execute('INSERT OR IGNORE INTO merchants VALUES (?,?)',(merchant['cnpj'],encode(merchant)))
        for rate in data.get('rates',[]):
            self._store_rate(rate,ignore=True)
        self._audit(actor,'import',{'path':str(p),'sources':data.get('sources',[]),'hash':digest(data)})
        self._recalculate(actor)

    def _store_rate(self,r,ignore=False):
        command='INSERT OR IGNORE' if ignore else 'INSERT OR REPLACE'
        self.db.execute(f'{command} INTO rates VALUES (?,?,?,?,?,?,?)',(r['id'],r['cnpj'],r['product'],r['start'],r.get('end',''),str(r['rate_pct']),encode(r)))

    def _data(self):
        data=self.get('source_data')
        data['merchants']=self.records('merchants')
        data['rates']=self.records('rates')
        return data

    def _recalculate(self,actor):
        data=self._data()
        params=self.get('parameters') | {'period':self.get('period')}
        result=calculate(data,params)
        for key in ('comissoes','divergencias','notas','lancamentos','pendencias','rastro','details'):
            result.setdefault(key,[])
        result.setdefault('summary',{})
        self.put('result',result)
        self.db.execute('INSERT INTO runs(at,period,input_hash,result_hash,result) VALUES (?,?,?,?,?)',(now(),self.get('period'),digest({'data':data,'params':params}),digest(result),encode(result)))
        self.put('closing',{'status':'open','actor':actor,'closed_at':None,'waiver':False,'reason':''})
        self._audit(actor,'recalculate',{'period':self.get('period'),'input_hash':digest({'data':data,'params':params}),'result_hash':digest(result)})
        # Only content tied to a genuinely changed closing loses approval.
        for email in self.records('emails'):
            if email.get('result_hash') != digest(result) and email.get('status') != 'simulated':
                email.update(status='draft',approved_by=None,approved_at=None,approval_hash=None,stale=True)
                self._save_email(email)
        self._event('stage_completed','informativo','Cálculo concluído',f'Fechamento {self.get("period")} recalculado. Revise as pendências e as notas.', '/#overview',digest(result))
        for issue in result['pendencias']:
            self._event('new_issue',issue.get('severity','atencao'),issue.get('tipo','Pendência'),issue.get('motivo',''),'/#issues',issue['id_saida']+digest(issue))

    def _results(self):
        result=self.get('result',{})
        account_names={a['code']:a['name'] for a in self.get('source_data',{}).get('accounts',[])}
        decisions={r['id']:dict(r) for r in self.db.execute('SELECT * FROM decisions WHERE period=?',(self.get('period'),))}
        for row in result.get('pendencias',[]):
            decision=decisions.get(row['id_saida'])
            row['status']='open'
            row['decision']=None
            if decision and decision['fingerprint']==digest({k:v for k,v in row.items() if k not in ('status','decision')}):
                d=json.loads(decision['data'])
                row['decision']=d
                row['status']='rejected' if d['action']=='reject' else 'resolved'
        for row in result.get('lancamentos',[]):
            decision=decisions.get(row['id_saida'])
            if decision and decision['fingerprint']==digest(row):
                d=json.loads(decision['data'])
                if d.get('account_code'):
                    row.update(conta_codigo=d['account_code'],conta_descricao=account_names.get(d['account_code'],''),metodo='HUMANO',confianca='1',decisao=d['note'])
            # Decisions on a matching bank issue may also provide its classification.
            for issue in result.get('pendencias',[]):
                d=issue.get('decision') or {}
                if issue['status']=='resolved' and d.get('account_code') and issue.get('ref_origem')==row.get('ref_origem'):
                    row.update(conta_codigo=d['account_code'],conta_descricao=account_names.get(d['account_code'],''),metodo='HUMANO',confianca='1',decisao=d['note'])
        return result

    def _validation(self,result):
        errors=[]
        warnings=[]
        sums={}
        for row in result.get('rastro',[]):
            sums[row['id_saida']]=sums.get(row['id_saida'],Decimal('0'))+Decimal(str(row['valor']))
        ids=set()
        for key,field in [('comissoes','comissao_brl'),('divergencias','diferenca_brl'),('notas','valor_brl'),('lancamentos','valor'),('pendencias','valor_brl')]:
            for row in result.get(key,[]):
                ident=row['id_saida']
                if ident in ids: errors.append(f'ID de saída repetido: {ident}')
                ids.add(ident)
                if ident not in sums or sums[ident]!=Decimal(str(row[field] or '0')):
                    errors.append(f'Rastro não fecha: {ident}')
        for group in self._rate_groups().values():
            ordered=sorted(group,key=lambda r:r['start'])
            for a,b in zip(ordered,ordered[1:]):
                if a.get('end') and date.fromisoformat(b['start']).toordinal()>date.fromisoformat(a['end']).toordinal()+1:
                    warnings.append(f'Lacuna de vigência {a["cnpj"]} / {a["product"]}: {a["end"]} a {b["start"]}.')
        warnings.extend(self.get('source_data',{}).get('import_warnings',[]))
        return {'errors':errors,'warnings':warnings,'trace_ok':not errors,'source_count':len(self.get('source_data',{}).get('sources',[]))}

    def _rate_groups(self):
        groups={}
        for r in self.records('rates'): groups.setdefault((r['cnpj'],r['product']),[]).append(r)
        return groups

    def state(self):
        with self.lock:
            result=self._results()
            summary=result.get('summary',{})
            summary.update(open_issues=sum(p['status']!='resolved' for p in result['pendencias']),resolved_issues=sum(p['status']=='resolved' for p in result['pendencias']),blocking_issues=sum(p['status']!='resolved' and p.get('severity')=='bloqueante' for p in result['pendencias']))
            assumptions_path=ROOT/'docs'/'assumptions.json'
            assumptions=json.loads(assumptions_path.read_text()) if assumptions_path.exists() else []
            audit=[{**dict(r),'detail':json.loads(r['detail'])} for r in self.db.execute('SELECT * FROM audit ORDER BY id DESC LIMIT 1000')]
            return {'period':self.get('period'),'closing':self.get('closing'),'summary':summary,'results':result,'merchants':self.records('merchants'),'rates':self.records('rates'),'accounts':self.get('source_data',{}).get('accounts',[]),'parameters':self.get('parameters'),'contacts':self.records('contacts'),'notifications':self.records('notifications'),'emails':self.records('emails'),'audit':audit,'sources':self.get('source_data',{}).get('sources',[]),'source_dir':self.get('source_dir'),'assumptions':assumptions,'validation':self._validation(result)}

    def trace(self,ident):
        with self.lock:
            return self._trace(ident)

    def _trace(self,ident):
        result=self._results()
        rows=[r for r in result['rastro'] if r['id_saida']==ident]
        refs={r['ref_origem'] for r in rows}
        details=result.get('details',[])
        if isinstance(details,dict): details=list(details.values())
        return {'rows':rows,'details':[d for d in details if d.get('id_saida')==ident]}

    def mutate(self,action,payload):
        with self.lock, self.db:
            p=copy.deepcopy(payload)
            actor=str(p.get('actor','')).strip()
            if not actor or len(actor)>120: raise ValueError('Informe o nome de quem está decidindo (até 120 caracteres).')
            out=self._mutate(action,p,actor)
            return {'ok':True,**(out or {})}

    def _mutate(self,action,p,actor):
        if action=='recalculate':
            period=p.get('period',self.get('period'))
            self._period(period)
            self.put('period',period)
            self._recalculate(actor)
        elif action=='import':
            self._period(p.get('period',self.get('period')))
            self.put('period',p.get('period',self.get('period')))
            self._import(p.get('source_dir',''),actor)
        elif action=='decisions':
            ident=p.get('id')
            original=self.get('result')
            row=next((r for r in original['pendencias']+original['lancamentos'] if r['id_saida']==ident),None)
            if not row: raise ValueError('Item não encontrado nesta competência.')
            if p.get('action') not in ('confirm','reject','adjust'): raise ValueError('Decisão inválida.')
            if not str(p.get('note','')).strip(): raise ValueError('Registre a justificativa e o encaminhamento da decisão.')
            code=p.get('account_code','')
            if code:
                account=next((a for a in self.get('source_data')['accounts'] if a['code']==code and a.get('postable')),None)
                if not account: raise ValueError('Selecione uma conta analítica que aceita lançamentos.')
                if p.get('action')!='adjust': raise ValueError('Reclassificação exige a decisão Ajustar.')
            decision={'action':p['action'],'actor':actor,'at':now(),'note':p['note'],'account_code':code}
            self.db.execute('INSERT OR REPLACE INTO decisions VALUES (?,?,?,?)',(self.get('period'),ident,digest(row),encode(decision)))
            self._audit(actor,'decision',{'id':ident,**decision})
            self.put('closing',{'status':'open','actor':actor,'closed_at':None,'waiver':False,'reason':''})
        elif action=='close':
            state=self.state()
            if state['validation']['errors']: raise ConflictError('O rastro contém erros; recalcule antes de fechar.')
            opened=state['summary']['open_issues']
            if opened and (p.get('allow_open') is not True or not str(p.get('reason','')).strip()):
                raise ConflictError(f'Existem {opened} pendências abertas. Exige aceite explícito e justificativa para fechar com ressalvas.')
            closing={'status':'closed','actor':actor,'closed_at':now(),'waiver':bool(opened),'reason':p.get('reason',''),'open_issue_ids':[i['id_saida'] for i in state['results']['pendencias'] if i['status']!='resolved']}
            self.put('closing',closing)
            self._audit(actor,'close',closing)
            self._event('report_ready','informativo','Relatório de fechamento pronto',f'Competência {self.get("period")} concluída'+(' com ressalvas.' if opened else '.'),'/api/report',digest(closing))
        elif action=='reopen':
            if not p.get('reason'): raise ValueError('Informe o motivo da reabertura.')
            self.put('closing',{'status':'open','actor':actor,'closed_at':None,'waiver':False,'reason':p['reason']})
            self._audit(actor,'reopen',p)
        elif action=='rates':
            self._edit_rate(p,actor)
        elif action=='merchants':
            cnpj=re.sub(r'\D','',str(p.get('cnpj','')))
            if len(cnpj)!=14 or not str(p.get('name','')).strip(): raise ValueError('Informe CNPJ com 14 dígitos e nome.')
            if not p.get('reason'): raise ValueError('Informe o motivo e a fonte da alteração cadastral.')
            old=next((m for m in self.records('merchants') if m['cnpj']==cnpj),{})
            ec=str(p.get('ec','')).strip()
            if ec and any(m.get('ec')==ec and m['cnpj']!=cnpj for m in self.records('merchants')): raise ValueError('Este EC já pertence a outro CNPJ.')
            merchant={**old,'cnpj':cnpj,'name':p['name'],'ec':ec,'active':bool(p.get('active',True)),'candidate':bool(p.get('candidate',old.get('candidate',False))),'source_ref':old.get('source_ref','CADASTRO HUMANO'),'reviewed_by':actor,'reviewed_at':now()}
            self.db.execute('INSERT OR REPLACE INTO merchants VALUES (?,?)',(cnpj,encode(merchant)))
            self._audit(actor,'merchant_edit',{'before':old,'after':merchant,'reason':p['reason']})
            self._recalculate(actor)
        elif action=='parameters':
            if not p.get('reason'): raise ValueError('Informe a justificativa do parâmetro.')
            params=self.get('parameters')
            value=self._decimal(p.get('remittance_tolerance_pp',params['remittance_tolerance_pp']))
            if not Decimal('0')<=value<=Decimal('0.05'): raise ValueError('Tolerância deve estar entre 0 e 0,05 ponto percentual.')
            deadline=p.get('closing_deadline',params['closing_deadline'])
            date.fromisoformat(deadline)
            updated={**params,'remittance_tolerance_pp':str(value),'closing_deadline':deadline}
            self.put('parameters',updated)
            self._audit(actor,'parameter_edit',{'before':params,'after':updated,'reason':p['reason']})
            self._recalculate(actor)
        elif action=='contacts':
            email=self._address(p.get('email',''))
            if p.get('kind') not in ('internal','billing'): raise ValueError('Tipo de contato inválido.')
            if p.get('frequency') not in ('immediate','digest'): raise ValueError('Frequência inválida.')
            if p.get('min_severity') not in SEVERITIES: raise ValueError('Severidade inválida.')
            ident=p.get('id') or 'CT-'+digest({'email':email,'kind':p['kind'],'cnpj':p.get('cnpj','')})[:14]
            contact={k:p.get(k,'') for k in ('name','kind','cnpj','min_severity','frequency')}
            contact.update(id=ident,email=email,enabled=p.get('enabled',True) is True)
            self.db.execute('INSERT OR REPLACE INTO contacts VALUES (?,?)',(ident,encode(contact)))
            self._audit(actor,'contact_edit',contact)
            self._deliver_notifications(immediate_only=True)
        elif action.startswith('emails/'):
            return self._email_action(action.split('/',1)[1],p,actor)
        elif action=='notifications/run':
            deadline=date.fromisoformat(self.get('parameters')['closing_deadline'])
            delta=(deadline-today()).days
            if delta<=2 and self.get('closing',{}).get('status')!='closed':
                self._event('deadline','atencao','Prazo do fechamento',f'Prazo configurado: {deadline.isoformat()}. Revise os bloqueios e conclua o fechamento.','/#issues',self.get('period')+deadline.isoformat()+today().isoformat())
            self._deliver_notifications(immediate_only=False)
            self._audit(actor,'notifications_run',{'mode':'simulation'})
        else:
            raise ValueError('Ação não reconhecida.')

    def scheduler_tick(self):
        """At least once per local date while the app runs; delivery IDs prevent duplicates."""
        with self.lock, self.db:
            key=self.get('period')+'-'+today().isoformat()
            if self.get('last_notification_day')!=key:
                self._mutate('notifications/run',{},'Sistema · agenda local')
                self.put('last_notification_day',key)

    @staticmethod
    def _period(value):
        if not re.fullmatch(r'\d{4}-(0[1-9]|1[0-2])',str(value)): raise ValueError('Competência deve usar AAAA-MM.')

    @staticmethod
    def _decimal(value):
        try: result=Decimal(str(value))
        except InvalidOperation: raise ValueError('Número decimal inválido.')
        if not result.is_finite(): raise ValueError('Número decimal deve ser finito.')
        return result

    def _edit_rate(self,p,actor):
        cnpj=re.sub(r'\D','',str(p.get('cnpj','')))
        if not any(m['cnpj']==cnpj for m in self.records('merchants')): raise ValueError('Cadastre o lojista antes da taxa.')
        product=p.get('product')
        if product not in ('DEBITO','CREDITO_A_VISTA','CREDITO_2_6','CREDITO_7_12','PIX','ANTECIPACAO','REMESSA'): raise ValueError('Produto inválido.')
        start=date.fromisoformat(p.get('start',''))
        end=date.fromisoformat(p['end']) if p.get('end') else None
        if end and end<start: raise ValueError('Fim de vigência anterior ao início.')
        value=self._decimal(p.get('rate_pct'))
        if value<0 or value>100: raise ValueError('Taxa deve estar entre 0 e 100%.')
        if not str(p.get('reason','')).strip(): raise ValueError('Informe justificativa e fonte da taxa.')
        ident=p.get('id') or 'RATE-'+digest({'cnpj':cnpj,'product':product,'start':str(start)})[:16]
        previous=next((r for r in self.records('rates') if r['id']==ident),None)
        for rate in self.records('rates'):
            if rate['id']==ident or rate['cnpj']!=cnpj or rate['product']!=product: continue
            if str(start)<=(rate.get('end') or '9999-12-31') and (str(end) if end else '9999-12-31')>=rate['start']:
                raise ValueError(f'Vigência sobreposta à taxa {rate["id"]}. Ajuste o fim da taxa anterior primeiro.')
        rate={**(previous or {}),'id':ident,'cnpj':cnpj,'product':product,'start':str(start),'end':str(end) if end else '', 'rate_pct':str(value),'source_file':'CADASTRO HUMANO','source_ref':ident,'reviewed_by':actor,'reviewed_at':now(),'reason':p['reason']}
        self._store_rate(rate)
        self._audit(actor,'rate_edit',{'before':previous,'after':rate})
        self._recalculate(actor)

    @staticmethod
    def _address(value):
        value=str(value).strip()
        if not re.fullmatch(r'[^\s@,;<>\r\n]+@[^\s@,;<>\r\n]+\.[^\s@,;<>\r\n]+',value): raise ValueError('Informe um destinatário de e-mail válido.')
        return value

    def _save_email(self,email):
        self.db.execute('INSERT OR REPLACE INTO emails VALUES (?,?)',(email['id'],encode(email)))

    def _email_hash(self,email):
        return digest({k:email.get(k) for k in ('to','subject','body','kind','related_id','result_hash')})

    def _email_action(self,action,p,actor):
        if action=='draft':
            results=self._results()
            cnpj=''
            if p.get('invoice_id'):
                row=next((r for r in results['notas'] if r['id_saida']==p['invoice_id']),None)
                if not row: raise ValueError('Nota não encontrada.')
                cnpj=row['tomador_cnpj']
                kind='billing'
                related=row['id_saida']
                subject=f'Comissão de {self.get("period")} · Tarvo Pagamentos'
                body=f'Olá, {row["tomador"]}.\n\nEncaminhamos a apuração de {row["linha_negocio"]} referente a {self.get("period")}, no valor de R$ {row["valor_brl"]}.\n{row["discriminacao"]}\n\nReferência: {related}. Favor confirmar o recebimento e o encaminhamento do pagamento.\n\nAtenciosamente,\nFinanceiro Tarvo'
            elif p.get('issue_id'):
                row=next((r for r in results['pendencias'] if r['id_saida']==p['issue_id']),None)
                if not row: raise ValueError('Pendência não encontrada.')
                kind='dispute'
                related=row['id_saida']
                subject=f'Contestação · {self.get("period")} · {row["ref_origem"]}'
                body=f'Prezados,\n\nSolicitamos a revisão da ocorrência {row["ref_origem"]}:\n{row["motivo"]}\nValor de referência: R$ {row["valor_brl"]}.\nEncaminhamento proposto: {row.get("suggestion", "Favor analisar e responder.")}\n\nReferência de auditoria: {related}.\n\nAtenciosamente,\nFinanceiro Tarvo'
                if 'PC-' in str(row.get('ref_origem')): cnpj='75374179000146'
            elif p.get('report') is True:
                row={}
                kind='internal'; related='REPORT-'+self.get('period')
                subject=f'Relatório de fechamento · {self.get("period")}'
                body=f'O relatório da competência {self.get("period")} está disponível.\nAcesse http://127.0.0.1:8765/api/report\nSituação: {self.get("closing")["status"]}.\nRevise as pendências antes de encaminhar o relatório.'
            else: raise ValueError('Selecione uma nota, pendência ou relatório.')
            contacts=[c for c in self.records('contacts') if c.get('enabled') and c['kind']==('internal' if kind=='internal' else 'billing') and (kind=='internal' or (cnpj and c.get('cnpj')==cnpj))]
            ident='MAIL-'+digest({'at':now(),'related':related})[:16]
            email={'id':ident,'kind':kind,'related_id':related,'period':self.get('period'),'to':contacts[0]['email'] if len(contacts)==1 else '', 'subject':subject,'body':body,'status':'draft','created_by':actor,'created_at':now(),'approved_by':None,'approved_at':None,'sent_at':None,'result_hash':digest(self.get('result')),'stale':False,'mode':'simulation'}
            self._save_email(email)
            self._audit(actor,'email_draft',{'id':ident,'related_id':related})
            return {'email':email}
        email=next((e for e in self.records('emails') if e['id']==p.get('id')),None)
        if not email: raise ValueError('E-mail não encontrado.')
        if email['status']=='simulated': raise ConflictError('Este envio já foi registrado. Crie outro rascunho para reenviar.')
        if action=='save':
            if p.get('to'): self._address(p['to'])
            if '\n' in p.get('subject','') or '\r' in p.get('subject',''): raise ValueError('Assunto não pode conter quebras de linha.')
            email.update(to=str(p.get('to','')).strip(),subject=p.get('subject',''),body=p.get('body',''),status='draft',approved_by=None,approved_at=None,approval_hash=None)
            # A changed calculation requires a fresh draft, not a silent refresh of old amounts.
        elif action=='approve':
            self._address(email['to'])
            if not email['subject'].strip() or not email['body'].strip(): raise ValueError('Revise assunto e conteúdo antes de aprovar.')
            if email.get('stale') or email.get('result_hash')!=digest(self.get('result')): raise ConflictError('O cálculo mudou. Gere um novo rascunho com os valores atuais.')
            email.update(status='approved',approved_by=actor,approved_at=now(),approval_hash=self._email_hash(email))
        elif action=='send':
            self._address(email['to'])
            if email.get('stale') or email.get('result_hash')!=digest(self.get('result')): raise ConflictError('O cálculo mudou. Gere um novo rascunho.')
            if email['kind']!='internal' and (email.get('status')!='approved' or email.get('approval_hash')!=self._email_hash(email)):
                raise ConflictError('Cobranças e contestações exigem aprovação explícita desta versão exata do e-mail.')
            email.update(status='simulated',sent_at=now(),sent_by=actor,delivery='sandbox-local',mode='simulation')
        else: raise ValueError('Ação de e-mail inválida.')
        self._save_email(email)
        self._audit(actor,'email_'+action,copy.deepcopy(email))
        return {'email':email}

    def _event(self,event,severity,title,body,link,key):
        ident='NOTICE-'+digest({'period':self.get('period'),'event':event,'key':key})[:20]
        data={'id':ident,'event':event,'severity':severity,'title':title,'body':body,'link':link,'at':now(),'period':self.get('period'),'deliveries':[]}
        self.db.execute('INSERT OR IGNORE INTO notifications VALUES (?,?)',(ident,encode(data)))
        self._deliver_notifications(immediate_only=True)

    def _deliver_notifications(self,immediate_only):
        for contact in self.records('contacts'):
            if contact.get('kind')!='internal' or not contact.get('enabled'): continue
            if immediate_only and contact['frequency']!='immediate': continue
            notices=[n for n in self.records('notifications') if n.get('period')==self.get('period') and contact['id'] not in n.get('deliveries',[]) and SEVERITIES[n['severity']]>=SEVERITIES[contact['min_severity']]]
            if not notices: continue
            groups=[[n] for n in notices] if contact['frequency']=='immediate' else [notices]
            for group in groups:
                ident='NOTICE-MAIL-'+digest({'contact':contact['id'],'notices':[n['id'] for n in group]})[:18]
                email={'id':ident,'kind':'internal','related_id':group[0]['id'],'period':self.get('period'),'to':contact['email'],'subject':group[0]['title'] if len(group)==1 else f'Resumo Tarvo · {len(group)} avisos','body':'\n\n'.join(f'{n["title"]}\n{n["body"]}\nAção: http://127.0.0.1:8765{n["link"]}' for n in group),'status':'simulated','created_at':now(),'sent_at':now(),'sent_by':'Sistema','approved_by':None,'approved_at':None,'mode':'simulation','delivery':'sandbox-local'}
                self._save_email(email)
                self._audit('Sistema','internal_notification_sent',email)
                for notice in group:
                    notice['deliveries'].append(contact['id'])
                    self.db.execute('UPDATE notifications SET data=? WHERE id=?',(encode(notice),notice['id']))

    def export_csv(self,name):
        with self.lock:
            return self._export_csv(name)

    def _export_csv(self,name):
        if name not in EXPORTS: raise ValueError('Arquivo de exportação inválido.')
        key,columns=EXPORTS[name]
        rows=self._results().get(key,[])
        extras=sorted({k for row in rows for k in row if k not in columns})
        output=io.StringIO(newline='')
        writer=csv.DictWriter(output,columns+extras,delimiter=';',lineterminator='\n')
        writer.writeheader()
        for row in rows:
            writer.writerow({k:encode(v) if isinstance(v,(dict,list)) else v for k,v in row.items()})
        return output.getvalue().encode('utf-8')

    def report(self):
        state=self.state(); esc=lambda x:html.escape(str(x))
        body=f'<h1>Fechamento Tarvo · {esc(state["period"])}</h1><p>Situação: {esc(state["closing"]["status"])}. Pendências abertas: {state["summary"]["open_issues"]}. E-mails em simulação.</p>'
        if state['closing'].get('waiver'): body+=f'<p class="warning">Fechamento com ressalvas aceito por {esc(state["closing"]["actor"])}: {esc(state["closing"]["reason"])}</p>'
        body+='<p>Os valores refletem as referências atuais. Operações sem regra comprovada permanecem pendentes. As notas são propostas de emissão; este sistema não emite NFS-e.</p>'
        report_columns={
            'comissoes':['lojista','cnpj','linha_negocio','comissao_brl','id_saida'],
            'divergencias':['cnpj','linha_negocio','ref_origem','taxa_contratada_pct','taxa_aplicada_pct','diferenca_brl'],
            'notas':['tomador','tomador_cnpj','linha_negocio','valor_brl','discriminacao'],
            'pendencias':['tipo','ref_origem','valor_brl','motivo','quem_decide','status','decision'],
            'lancamentos':['banco','ref_origem','data','descricao','valor','conta_codigo','conta_descricao','metodo'],
        }
        labels={'lojista':'Lojista','cnpj':'CNPJ','tomador_cnpj':'CNPJ','linha_negocio':'Linha','comissao_brl':'Comissão (R$)','id_saida':'ID do rastro','ref_origem':'Origem','taxa_contratada_pct':'Contratada (%)','taxa_aplicada_pct':'Aplicada (%)','diferenca_brl':'Diferença (R$)','tomador':'Tomador','valor_brl':'Valor (R$)','discriminacao':'Serviço','tipo':'Ocorrência','motivo':'Motivo','quem_decide':'Responsável','status':'Situação','decision':'Decisão registrada','banco':'Banco','data':'Data','descricao':'Histórico','valor':'Valor (R$)','conta_codigo':'Conta','conta_descricao':'Contrapartida','metodo':'Método'}
        for key,title in [('comissoes','Comissões'),('divergencias','Divergências'),('notas','Notas propostas'),('pendencias','Pendências e decisões'),('lancamentos','Lançamentos classificados')]:
            rows=state['results'][key]; body+=f'<h2>{title}</h2>'
            if not rows: body+='<p>Nenhum registro.</p>'; continue
            columns=report_columns[key]
            body+='<table><thead><tr>'+''.join('<th>'+esc(labels[c])+'</th>' for c in columns)+'</tr></thead><tbody>'
            for row in rows:
                cells=[]
                for column in columns:
                    value=row.get(column,'')
                    if column=='decision':
                        value=f'{value["actor"]} · {value["at"]}: {value["note"]}' if value else 'Aguardando análise'
                    elif column=='status': value={'open':'Aberta','resolved':'Encaminhada','rejected':'Rejeitada; aberta'}.get(value,value)
                    elif column=='tipo': value=str(value).replace('_',' ').capitalize()
                    cells.append('<td>'+esc(value)+'</td>')
                body+='<tr>'+''.join(cells)+'</tr>'
            body+='</tbody></table>'
        body+='<h2>Fontes preservadas</h2><ul>'+''.join('<li>'+esc(s.get('name'))+' · SHA256 '+esc(s.get('sha256'))+'</li>' for s in state['sources'])+'</ul>'
        body+='<h2>Hipóteses</h2>'+''.join(f'<p><strong>{esc(a["id"])}: {esc(a["question"])}</strong><br>{esc(a["decision"])}<br>Impacto: {esc(a["impact"])}</p>' for a in state['assumptions'])
        return '<!doctype html><html lang="pt-BR"><meta charset="utf-8"><title>Relatório Tarvo</title><style>body{font:14px system-ui;margin:32px;color:#182e35;overflow-wrap:anywhere}table{border-collapse:collapse;width:100%;font-size:11px;table-layout:fixed}td,th{border:1px solid #d4dcdf;padding:6px;text-align:left;vertical-align:top}th{background:#eef2f3}h2{margin-top:36px}.warning{background:#fff0d8;padding:16px}@media print{body{margin:12mm}thead{display:table-header-group}tr{break-inside:avoid}button{display:none}}</style><button onclick="window.print()">Imprimir / salvar PDF</button>'+body+'</html>'

    def export_zip(self):
        with self.lock:
            return self._export_zip()

    def _export_zip(self):
        out=io.BytesIO()
        with zipfile.ZipFile(out,'w',zipfile.ZIP_DEFLATED) as archive:
            for name in EXPORTS: archive.writestr(name,self.export_csv(name))
            archive.writestr('relatorio.html',self.report())
            hypotheses=ROOT/'HIPOTESES.md'
            if hypotheses.exists(): archive.writestr('HIPOTESES.md',hypotheses.read_bytes())
        return out.getvalue()
