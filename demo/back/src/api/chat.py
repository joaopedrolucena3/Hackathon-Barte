"""Query chat routes: availability and past conversations of a run, and the question stream (SSE).
Read-only over the run; the Anthropic credential stays on this server."""
from __future__ import annotations

import json
from typing import Any, Literal

from fastapi import APIRouter, Depends
from fastapi.responses import StreamingResponse
from pydantic import BaseModel, ConfigDict, Field

from ..chat.agent import ChatUnavailable
from ..pipeline.service import ServiceError

MAX_RIDS = 100_000


class GridFilter(BaseModel):
    model_config = ConfigDict(extra='forbid')
    column: str = Field(max_length=120)
    op: Literal['eq', 'neq', 'contains', 'gt', 'gte', 'lt', 'lte', 'empty', 'filled']
    value: str | None = Field(default=None, max_length=500)


class Sort(BaseModel):
    model_config = ConfigDict(extra='forbid')
    column: str = Field(max_length=120)
    dir: Literal['asc', 'desc']


class SelectionStats(BaseModel):
    model_config = ConfigDict(extra='forbid')
    cells: int = Field(ge=0)
    numeric: int = Field(ge=0)
    sum: str | None = Field(default=None, max_length=60)
    avg: str | None = Field(default=None, max_length=60)
    money: bool = False


class Selection(BaseModel):
    model_config = ConfigDict(extra='forbid')
    dataset: str = Field(max_length=120)
    columns: list[str] = Field(max_length=400)
    rids: list[int] = Field(max_length=MAX_RIDS)
    stats: SelectionStats | None = None


class Cell(BaseModel):
    model_config = ConfigDict(extra='forbid')
    dataset: str = Field(max_length=120)
    rid: int = Field(ge=0)
    column: str = Field(max_length=120)
    label: str = Field(default='', max_length=200)
    value: Any = None


class Focus(BaseModel):
    model_config = ConfigDict(extra='forbid')
    column: str | None = Field(default=None, max_length=120)
    cell: Cell | None = None


class View(BaseModel):
    model_config = ConfigDict(extra='forbid')
    total: int = Field(ge=0)
    shown: int = Field(ge=0)


class ScreenContext(BaseModel):
    model_config = ConfigDict(extra='forbid')
    filters: list[GridFilter] = Field(default_factory=list, max_length=50)
    sort: Sort | None = None
    only_exceptions: bool = False
    chat_filter_rids: list[int] | None = Field(default=None, max_length=MAX_RIDS)
    view_rids: list[int] | None = Field(default=None, max_length=MAX_RIDS)
    selection: Selection | None = None
    focus: Focus | None = None
    view: View | None = None


class ChatRequest(BaseModel):
    model_config = ConfigDict(extra='forbid')
    pergunta: str = Field(min_length=1, max_length=2000)
    modo: Literal['pergunta', 'por_que'] = 'pergunta'
    thread_id: str | None = Field(default=None, max_length=64)
    step_id: str = Field(min_length=1, max_length=64)
    dataset: str = Field(min_length=1, max_length=120)
    contexto: ScreenContext = Field(default_factory=ScreenContext)


def _sse(event):
    return f"event: {event['type']}\ndata: {json.dumps(event, ensure_ascii=False, separators=(',', ':'), default=str)}\n\n"


def chat_router(chat, actor_dependency):
    router = APIRouter(prefix='/api/runs/{run_id}/chat', tags=['Chat de consulta'])

    @router.get('')
    def status(run_id: str):
        return chat.status(run_id)

    @router.post('')
    def ask(run_id: str, body: ChatRequest, actor: str = Depends(actor_dependency)):
        if not body.pergunta.strip():
            raise ServiceError(422, 'EMPTY_QUESTION', 'Escreva a pergunta.')
        try:
            events = chat.ask(run_id, body.model_dump(), actor)
        except ChatUnavailable as exc:
            raise ServiceError(503, 'CHAT_UNAVAILABLE', str(exc))
        except LookupError as exc:
            raise ServiceError(404, 'THREAD_NOT_FOUND', str(exc))
        return StreamingResponse((_sse(event) for event in events), media_type='text/event-stream', headers={'X-Accel-Buffering': 'no'})

    return router
