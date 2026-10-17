"""Local FastAPI server; new workflow routes coexist with the original analyst API."""
from __future__ import annotations

import asyncio
import gzip
import hashlib
import os
import json
import logging
import threading
from contextlib import asynccontextmanager
from pathlib import Path
from typing import Literal
from urllib.parse import unquote

from pydantic import BaseModel, ConfigDict, Field

from fastapi import Body, Depends, FastAPI, File, Form, Header, Request, UploadFile
from fastapi.encoders import jsonable_encoder
from fastapi.exceptions import RequestValidationError
from fastapi.responses import FileResponse, JSONResponse, Response, StreamingResponse
from starlette.exceptions import HTTPException

from ..store import ConflictError, ROOT, Store
from ..engine import calculate
from .insights import build_insights
from . import conference
from ..pipeline.service import PipelineService, ServiceError
from ..chat import semantic, views as desk
from ..chat.agent import ChatService
from ..mail.auth import AuthManager, AuthError
from ..mail.service import MailService
from ..mail.demo import DemoMailService
from ..mail.notifications import NotificationService
from ..mail.suggestions import SuggestionService
from .chat import chat_router
from .mail import mail_router

logger = logging.getLogger(__name__)
MAX_UPLOAD = 25 * 1024 * 1024


class RunRequest(BaseModel):
    model_config = ConfigDict(extra="forbid")
    pipeline_id: str = Field(min_length=1, max_length=160)
    competencia: str = Field(pattern=r"^\d{4}-(0[1-9]|1[0-2])$")
    file_ids: list[str] | None = Field(default=None, max_length=200)
    source_dir: str | None = None
    parent_run_id: str | None = None
    pipeline_version: int | None = Field(default=None, ge=1)
    draft: bool = False
    steps: list[dict] | None = None


class DecisionRequest(BaseModel):
    model_config = ConfigDict(extra="forbid")
    acao: Literal["aceitar", "ajustar", "excluir"]
    valor: str | int | float | None = None
    conta: str | None = None
    entry_id: str | None = None
    justificativa: str = Field(min_length=1, max_length=10000)


class BatchDecisionRequest(BaseModel):
    model_config = ConfigDict(extra="forbid")
    ids: list[str] = Field(min_length=1, max_length=500)
    acao: Literal["aceitar", "excluir"]
    justificativa: str = Field(min_length=1, max_length=10000)


class ApplyRecommendationsRequest(BaseModel):
    model_config = ConfigDict(extra="forbid")
    preview_token: str = Field(pattern=r"^[a-f0-9]{64}$")


class ApprovalRequest(BaseModel):
    model_config = ConfigDict(extra="forbid")
    decisao: Literal["aprovar", "reprovar"]
    comentario: str = Field(min_length=1, max_length=10000)


class ViewExportRequest(BaseModel):
    model_config = ConfigDict(extra="forbid")
    dataset: str = Field(min_length=1, max_length=120)
    rids: list[int] = Field(max_length=100_000)
    columns: list[str] = Field(min_length=1, max_length=400)
    formato: Literal["xlsx", "csv"]
    descricao: str = Field(default="", max_length=2000)


class ChecklistRequest(BaseModel):
    model_config = ConfigDict(extra="forbid")
    status: str | None = None
    responsavel: str | None = Field(default=None, max_length=160)
    comentario: str | None = Field(default=None, max_length=10000)


def failure(status, code, message, details=None):
    return JSONResponse(status_code=status, content={"error": {
        "code": code, "message": message, "details": jsonable_encoder(details or [])}})


def actor_header(x_user: str | None = Header(default=None), x_user_encoding: str | None = Header(default=None)):
    value = x_user or ""
    if x_user_encoding:
        if x_user_encoding != "percent-utf8":
            raise ServiceError(422, "INVALID_ACTOR_ENCODING", "Codificação de X-User não reconhecida.")
        try:
            value = unquote(value, encoding="utf-8", errors="strict")
        except UnicodeDecodeError:
            raise ServiceError(422, "INVALID_ACTOR_ENCODING", "Nome do responsável inválido.")
    value = value.strip()
    if not value or len(value) > 120 or any(ord(c) < 32 for c in value):
        raise ServiceError(422, "ACTOR_REQUIRED", "Informe o responsável no cabeçalho X-User.")
    return value


def create_app(db_path=None, source_dir=None, runs_dir=None, *, legacy_store=None, workflow=None, email_service=None, mail_auth=None, mail_private_dir=None,
               chat_client=None):
    db_path = Path(db_path or ROOT / "data" / "tarvo.sqlite3")
    source_dir = Path(source_dir or ROOT / "data" / "case")
    runs_dir = Path(runs_dir or ROOT / "saida" / "runs")
    store = legacy_store or Store(db_path, source_dir)
    flow = workflow or PipelineService(db_path.with_name(db_path.stem + "-workflow.sqlite3"), source_dir, runs_dir)
    mail = email_service or MailService(db_path.with_name(db_path.stem + "-email.sqlite3"), store)
    private_dir = mail_private_dir or os.environ.get('TARVO_MAIL_PRIVATE_DIR') or (
        Path.home() / '.local' / 'share' / 'tarvo' / 'gmail' / hashlib.sha256(str(db_path.resolve()).encode()).hexdigest()[:16])
    auth = mail_auth or AuthManager(private_dir)
    mail_db = db_path.with_name(db_path.stem + '-email.sqlite3')
    demo_mail = DemoMailService(mail_db, auth)
    notifications = NotificationService(mail_db, auth)
    suggestions = SuggestionService(mail_db, flow, mail, auth)

    def after_run(run):
        # Preparing a suggestion never grants permission to send a contestation.
        # Internal run notices retain their separate, explicit opt-in setting.
        for callback in (suggestions.on_run, notifications.on_run):
            try:
                callback(run)
            except Exception:
                logger.warning('Não foi possível atualizar uma comunicação da run %s.', run.get('id'))

    flow.on_run = after_run
    chat = ChatService(db_path.with_name(db_path.stem + "-chat.sqlite3"), flow, client=chat_client)
    stop = threading.Event()

    def legacy_history():
        with store.lock:
            return [json.loads(row['data']) for row in store.db.execute('SELECT data FROM imports ORDER BY id')]
    flow.history_provider = legacy_history

    def scheduler():
        while not stop.is_set():
            try:
                store.scheduler_tick()
            except Exception:
                logger.exception("Falha na agenda local de avisos")
            stop.wait(60)

    @asynccontextmanager
    async def lifespan(app):
        worker = threading.Thread(target=scheduler, daemon=True)
        worker.start()
        try:
            yield
        finally:
            stop.set()
            worker.join(timeout=2)
            chat.close()
            flow.close()
            suggestions.close()
            notifications.close()
            demo_mail.close()
            mail.close()
            auth.close()
            store.close_db()

    app = FastAPI(title="Tarvo · API de fechamento", version="3.0.0", lifespan=lifespan,
                  docs_url=None, redoc_url=None, openapi_url="/api/openapi.json")
    app.state.store = store
    app.state.workflow = flow
    app.state.mail = mail
    app.state.mail_auth = auth
    app.state.demo_mail = demo_mail
    app.state.mail_notifications = notifications
    app.state.mail_suggestions = suggestions
    app.state.chat = chat

    @app.middleware("http")
    async def local_boundary(request: Request, call_next):
        host = request.headers.get("host", "").lower()
        if host.split(":")[0] not in ("127.0.0.1", "localhost"):
            return failure(403, "LOCAL_ONLY", "Acesso restrito ao computador local.")
        if request.method in ("POST", "PUT", "PATCH", "DELETE"):
            origin = request.headers.get("origin")
            if origin and origin != "http://" + host:
                return failure(403, "ORIGIN_NOT_ALLOWED", "Origem externa não permitida.")
            try:
                length = int(request.headers.get("content-length", "0"))
            except ValueError:
                return failure(400, "INVALID_LENGTH", "Tamanho de requisição inválido.")
            limit = MAX_UPLOAD + 1024 * 1024 if request.url.path == "/api/files" else 1024 * 1024
            if length < 0 or length > limit:
                return failure(413, "PAYLOAD_TOO_LARGE", "Arquivo ou requisição excede o limite permitido.")
            if request.url.path != "/api/files" and not request.headers.get("content-type", "").startswith("application/json"):
                return failure(415, "JSON_REQUIRED", "Envie um objeto JSON.")
        response = await call_next(request)
        response.headers["X-Content-Type-Options"] = "nosniff"
        response.headers["Cache-Control"] = "no-store"
        response.headers["Referrer-Policy"] = "no-referrer"
        response.headers.setdefault("Content-Security-Policy", "default-src 'self'; script-src 'self' 'unsafe-inline'; style-src 'self' 'unsafe-inline'; img-src 'self' data:; frame-ancestors 'none'")
        return response

    @app.exception_handler(AuthError)
    async def auth_error(request, exc):
        return failure(exc.status, exc.code, exc.message, exc.details)

    @app.exception_handler(ServiceError)
    async def service_error(request, exc):
        return failure(exc.status, exc.code, exc.message, exc.details)

    @app.exception_handler(RequestValidationError)
    async def validation_error(request, exc):
        details = [{"path": list(e["loc"]), "message": e["msg"], "type": e["type"]} for e in exc.errors()]
        return failure(422, "VALIDATION_ERROR", "Verifique os dados enviados.", details)

    @app.exception_handler(HTTPException)
    async def http_error(request, exc):
        return failure(exc.status_code, "HTTP_ERROR", str(exc.detail))

    @app.exception_handler(ConflictError)
    async def conflict_error(request, exc):
        return failure(409, "CONFLICT", str(exc))

    @app.exception_handler(ValueError)
    async def value_error(request, exc):
        return failure(422, "INVALID_VALUE", str(exc))

    @app.exception_handler(Exception)
    async def unexpected_error(request, exc):
        logger.exception("Falha ao processar %s", request.url.path, exc_info=exc)
        return failure(500, "INTERNAL_ERROR", "Não foi possível concluir a operação. Consulte a auditoria.")

    @app.get("/api/steps/catalog")
    def catalog():
        return {"steps": flow.catalog()}

    @app.get("/api/pipelines/{pipeline_id}/versions")
    def versions(pipeline_id: str):
        return {"versions": flow.versions(pipeline_id)}

    @app.post("/api/pipelines/{pipeline_id}/validate")
    def validate(pipeline_id: str, body: dict = Body(...)):
        result = flow.validate_pipeline(pipeline_id, body)
        errors = result.get("errors", []) if isinstance(result, dict) else result
        if errors:
            raise ServiceError(422, "PIPELINE_INVALID", "A definição do pipeline contém erros.", errors)
        return {"valid": True, "errors": []}

    @app.get("/api/pipelines/{pipeline_id}")
    def pipeline(pipeline_id: str, version: int | None = None):
        return flow.get_pipeline(pipeline_id, version)

    @app.put("/api/pipelines/{pipeline_id}")
    def save_pipeline(pipeline_id: str, body: dict = Body(...), actor: str = Depends(actor_header)):
        return flow.save_pipeline(pipeline_id, body, actor)

    @app.post("/api/files", status_code=201)
    async def upload(file: UploadFile = File(...), role: str | None = Form(default=None), actor: str = Depends(actor_header)):
        data = await file.read(MAX_UPLOAD + 1)
        await file.close()
        if len(data) > MAX_UPLOAD:
            raise ServiceError(413, "FILE_TOO_LARGE", "Cada arquivo pode ter até 25 MB.")
        return flow.upload_file(file.filename or "", data, actor, role=role)

    @app.post("/api/runs", status_code=202)
    def start(body: RunRequest, actor: str = Depends(actor_header)):
        references = store.reference_snapshot(body.competencia)
        result = flow.start_run(body.model_dump(exclude_none=True), actor, references=references)
        return {"run_id": result} if isinstance(result, str) else result

    @app.get("/api/runs")
    def runs(competencia: str | None = None):
        return {"runs": flow.list_runs(competencia)}

    @app.get("/api/runs/compare")
    def compare(a: str, b: str):
        return flow.compare_runs(a, b)

    @app.get("/api/runs/{run_id}/accounts")
    def accounts(run_id: str):
        return flow.accounts(run_id)

    @app.get("/api/runs/{run_id}/approval-summary")
    def approval_summary(run_id: str):
        return flow.approval_summary(run_id)

    @app.get("/api/runs/{run_id}/recommendations")
    def recommendations(run_id: str):
        return flow.recommendations(run_id)

    @app.post("/api/runs/{run_id}/recommendations/apply")
    def apply_recommendations(run_id: str, body: ApplyRecommendationsRequest, actor: str = Depends(actor_header)):
        return flow.apply_recommendations(run_id, body.preview_token, actor)

    @app.get("/api/runs/{run_id}/exports/{name}")
    def export_file(run_id: str, name: str):
        content = flow.export_file(run_id, name)
        return Response(content, media_type="application/json" if name.endswith('.json') else "text/csv",
                        headers={"Content-Disposition": f'attachment; filename="{name}"'})

    @app.post("/api/runs/{run_id}/exceptions/decisions")
    def batch_decisions(run_id: str, body: BatchDecisionRequest, actor: str = Depends(actor_header)):
        return flow.decide_many(run_id, body.ids, {'acao': body.acao, 'justificativa': body.justificativa}, actor)

    @app.get("/api/runs/{run_id}/events")
    async def events(request: Request, run_id: str, after: int = 0,
                     last_event_id: str | None = Header(default=None)):
        flow.get_run(run_id)
        try:
            cursor = int(last_event_id) if last_event_id is not None else after
            if cursor < 0:
                raise ValueError()
        except ValueError:
            raise ServiceError(422, "INVALID_CURSOR", "O cursor de eventos deve ser inteiro não negativo.")

        async def stream():
            nonlocal cursor
            idle = 0
            yield "retry: 1500\n\n"
            while not await request.is_disconnected():
                batch = flow.events(run_id, cursor)
                if isinstance(batch, dict):
                    batch = batch.get("events", [])
                for event in batch:
                    seq = int(event.get("seq", event.get("id", 0)))
                    if seq <= cursor:
                        continue
                    cursor = seq
                    yield f"id: {cursor}\nevent: {event['type']}\ndata: {json.dumps(event, ensure_ascii=False, separators=(',', ':'))}\n\n"
                snapshot = flow.get_run(run_id)
                if snapshot["status"] in ("done", "failed", "rejected"):
                    # Flush events committed just after the last read before closing.
                    tail = flow.events(run_id, cursor)
                    if isinstance(tail, dict):
                        tail = tail.get("events", [])
                    for event in tail:
                        seq = int(event.get("seq", event.get("id", 0)))
                        if seq > cursor:
                            cursor = seq
                            yield f"id: {cursor}\nevent: {event['type']}\ndata: {json.dumps(event, ensure_ascii=False, separators=(',', ':'))}\n\n"
                    break
                idle += 1
                if idle % 30 == 0:
                    yield ": heartbeat\n\n"
                await asyncio.sleep(0.5)

        return StreamingResponse(stream(), media_type="text/event-stream", headers={"X-Accel-Buffering": "no"})

    @app.get("/api/runs/{run_id}/steps/{step_id}/preview")
    def preview(request: Request, run_id: str, step_id: str):
        return flow.preview(run_id, step_id, dict(request.query_params))

    @app.get("/api/runs/{run_id}/steps/{step_id}/data")
    def step_data(request: Request, run_id: str, step_id: str, dataset: str | None = None):
        view = flow.step_rows(run_id, step_id, dataset)
        payload = {"run_id": run_id, "step_id": step_id, "step_number": view["step"]["number"],
                   "datasets": [{**item, "title": semantic.title(item["name"])} for item in view["datasets"]],
                   **desk.table(view["meta"], view["rows"], view["steps"], view["rows_of"])}
        body = json.dumps(payload, ensure_ascii=False, separators=(",", ":"), allow_nan=False).encode()
        if len(body) > 64 * 1024 and "gzip" in request.headers.get("accept-encoding", ""):
            return Response(gzip.compress(body, 5), media_type="application/json", headers={"Content-Encoding": "gzip", "Vary": "Accept-Encoding"})
        return Response(body, media_type="application/json")

    @app.post("/api/runs/{run_id}/steps/{step_id}/export")
    def export_view(run_id: str, step_id: str, body: ViewExportRequest):
        view = flow.step_rows(run_id, step_id, body.dataset)
        columns = {column["name"]: column for column in semantic.describe(body.dataset, view["meta"].get("schema", []))}
        unknown = [name for name in body.columns if name not in columns]
        if unknown: raise ServiceError(422, "UNKNOWN_COLUMN", "Coluna desconhecida na tabela do passo.", unknown)
        rows = view["rows"]
        if any(rid < 0 or rid >= len(rows) for rid in body.rids): raise ServiceError(422, "INVALID_ROW", "Linha fora da tabela do passo.")
        about = {"run_id": run_id, "step_id": step_id, "step_number": view["step"]["number"], "step_title": view["step"]["title"],
                 "dataset": body.dataset, "sha256": view["meta"]["sha256"], "row_count": len(rows), "descricao": body.descricao}
        filename, media, content = desk.export(body.formato, [columns[name] for name in body.columns], [(rid, rows[rid]) for rid in body.rids], about)
        return Response(content, media_type=media, headers={"Content-Disposition": f'attachment; filename="{filename}"'})

    @app.get("/api/runs/{run_id}/exceptions")
    def exceptions(request: Request, run_id: str):
        result = flow.exceptions(run_id, dict(request.query_params))
        return {**result, "exceptions": result.get("exceptions", result.get("items", []))} if isinstance(result, dict) else {"exceptions": result}

    @app.post("/api/runs/{run_id}/exceptions/{exception_id}/decision")
    def decision(run_id: str, exception_id: str, body: DecisionRequest, actor: str = Depends(actor_header)):
        return flow.decision(run_id, exception_id, body.model_dump(exclude_none=True), actor)

    @app.post("/api/runs/{run_id}/approval")
    def approval(run_id: str, body: ApprovalRequest, actor: str = Depends(actor_header)):
        return flow.approval(run_id, body.model_dump(), actor)

    @app.get("/api/runs/{run_id}/audit")
    def audit(run_id: str):
        return flow.audit(run_id)

    @app.get("/api/runs/{run_id}/export")
    def export(run_id: str):
        content = flow.export(run_id)
        return Response(content, media_type="application/zip", headers={"Content-Disposition": 'attachment; filename="tarvo-erp.zip"'})

    @app.get("/api/runs/{run_id}")
    def run(run_id: str):
        return flow.get_run(run_id)

    def source_periods():
        with store.lock:
            data = store.get('source_data', {})
        return {row.get('date', '')[:7] for row in data.get('checkout', []) + data.get('bank', []) if row.get('date')} | {row['contracted_date'][:7] for row in data.get('remittances', []) if row.get('contracted_date')}

    @app.get("/api/competencias")
    def competencias():
        packs = flow.available_packs()
        runs = flow.list_runs()
        current = store.get('period')
        periods = source_periods() | {r['competencia'] for r in runs} | {p['comp'] for p in packs} | {current}
        records = []
        for period in sorted(periods, reverse=True):
            versions = [r for r in runs if r['competencia'] == period and not r.get('draft')]
            available = [p['path'] for p in packs if p['comp'] == period]
            records.append({'comp': period, 'current': period == current, 'has_data': bool(versions) or period in source_periods(),
                            'has_pack': bool(available), 'origin': available, 'status': versions[0]['status'] if versions else 'available' if available else 'no_inputs',
                            'latest_run_id': versions[0]['id'] if versions else None, 'runs': [{'id': r['id'], 'status': r['status']} for r in versions]})
        return records

    def scoped_state(comp=None, run_id=None):
        if run_id: return conference.run_state(flow, store, run_id, comp)
        period = flow._period(comp) if comp else store.get('period')
        versions = [r for r in flow.list_runs(period) if not r.get('draft')]
        if versions: return conference.run_state(flow, store, versions[0]['id'], period)
        if period == store.get('period'):
            return {**store.state(), 'run_id': None, 'competencia': period, 'scope': {'competencia': period, 'run_id': None}, 'has_data': True, 'read_only': False}
        raise ServiceError(404, 'PERIOD_WITHOUT_INPUTS', 'Inicie uma execução para conferir esta competência.')

    @app.get("/api/insights")
    def insights(comp: str | None = None, run_id: str | None = None):
        state = scoped_state(comp, run_id)
        return {**build_insights(state['period'], state['results']), 'run_id': state['run_id'], 'source': 'workflow_snapshot' if state['run_id'] else 'current_conference'}

    @app.get("/api/competencias/{competencia}/checklist")
    def checklist(competencia: str, run_id: str | None = None):
        return flow.checklist(competencia, run_id)

    @app.get("/api/competencias/{competencia}/config")
    def operational_config(competencia: str):
        return store.operational_config(flow._period(competencia))

    @app.put("/api/competencias/{competencia}/config")
    def save_operational_config(competencia: str, body: dict = Body(...), actor: str = Depends(actor_header)):
        return store.set_operational_config(flow._period(competencia), body, actor)

    @app.patch("/api/checklist/{task_id}")
    def update_task(task_id: str, body: ChecklistRequest, actor: str = Depends(actor_header)):
        return flow.update_task(task_id, body.model_dump(exclude_none=True), actor)

    app.include_router(mail_router(mail, auth, store, actor_header, demo_mail=demo_mail, notifications=notifications,
                                   suggestions=suggestions, workflow=flow))
    app.include_router(chat_router(chat, actor_header))

    @app.get("/api/health")
    def health():
        index = ROOT.parent / 'front' / 'dist' / 'index.html'
        return {"ok": True, "mode": "local", "workflow": True, "legacy_emails": "simulation", "gmail_configured": auth.status().get("configured", False),
                'backend_content_hash': flow.loaded_code_hash,
                'frontend_index_sha256': hashlib.sha256(index.read_bytes()).hexdigest() if index.exists() else None}

    @app.get("/api/state")
    def state(comp: str | None = None, run_id: str | None = None):
        return scoped_state(comp, run_id)

    @app.get("/api/trace")
    def trace(id: str = "", comp: str | None = None, run_id: str | None = None):
        state = scoped_state(comp, run_id)
        return {'run_id': state['run_id'], 'period': state['period'], 'rows': [r for r in state['results']['rastro'] if r['id_saida'] == id],
                'details': [r for r in state['results']['details'] if r['id_saida'] == id]}

    @app.get("/api/export")
    def legacy_csv(file: str = "", comp: str | None = None, run_id: str | None = None):
        state = scoped_state(comp, run_id)
        content = conference.official_csv(state, file)
        return Response(content, media_type="text/csv", headers={"Content-Disposition": f'attachment; filename="{file}"'})

    @app.get("/api/report")
    def report(comp: str | None = None, run_id: str | None = None):
        return Response(conference.report(scoped_state(comp, run_id)), media_type="text/html")

    @app.get("/api/export.zip")
    def legacy_export(comp: str | None = None, run_id: str | None = None):
        return Response(conference.export_zip(scoped_state(comp, run_id)), media_type="application/zip", headers={"Content-Disposition": 'attachment; filename="tarvo-conferencia.zip"'})

    @app.post("/api/emails/{action}")
    def legacy_email_action(action: str, body: dict = Body(...)):
        if action not in {"draft", "save", "approve", "send"}:
            raise HTTPException(404, "Ação de simulação não encontrada.")
        return store.mutate("emails/" + action, body)

    @app.post("/api/notifications/run")
    def legacy_notifications(body: dict = Body(...)):
        return store.mutate("notifications/run", body)

    @app.post("/api/{action}")
    def legacy_action(action: str, body: dict = Body(...)):
        return store.mutate(action, body)

    @app.get("/{path:path}")
    def static(path: str):
        if path.startswith("api/"):
            raise HTTPException(404, "Rota não encontrada.")
        frontend = ROOT.parent / "front" / "dist"
        if path.startswith('legacy/') or path == 'legacy':
            root = ROOT / 'web'
            relative = path.removeprefix('legacy').lstrip('/') or 'index.html'
        else:
            root = frontend if (frontend / 'index.html').is_file() else ROOT / 'web'
            relative = path or 'index.html'
        target = (root / relative).resolve()
        if not target.is_relative_to(root.resolve()):
            raise HTTPException(404, "Página não encontrada.")
        if target.is_file(): return FileResponse(target)
        # React Router deep links resolve only within known app routes.
        if root == frontend and path.split('/')[0] in {'competencias', 'runs', 'pipeline', 'comunicacoes', 'cadastros', 'notas-bancos'}:
            return FileResponse(frontend / 'index.html')
        raise HTTPException(404, "Página não encontrada.")

    return app
