"""Chat record (tarvo-chat.sqlite3): threads per run and every question with its SQL, result hashes, tokens
and author. Append-only: a thread's model history is the concatenation of its successful turns, byte for
byte, so a follow-up question replays the conversation exactly as the model produced it."""
from __future__ import annotations

import json
import sqlite3
import threading
import uuid
from datetime import datetime, timezone

RID_KEYS = ("rids", "view_rids", "chat_filter_rids")


def _now():
    return datetime.now(timezone.utc).isoformat(timespec="seconds")


def _compact(context):
    """Row-id lists can be long; the record keeps their size, not the ids."""
    if isinstance(context, dict):
        return {key: (f"{len(value)} linhas" if key in RID_KEYS and isinstance(value, list) else _compact(value)) for key, value in context.items()}
    return context


class ChatStore:
    def __init__(self, path):
        self.lock = threading.Lock()
        self.db = sqlite3.connect(str(path), check_same_thread=False)
        self.db.row_factory = sqlite3.Row
        self.db.execute("PRAGMA journal_mode=WAL")
        self.db.executescript("""
            CREATE TABLE IF NOT EXISTS chat_threads (id TEXT PRIMARY KEY, run_id TEXT NOT NULL, created_at TEXT NOT NULL, actor TEXT NOT NULL);
            CREATE TABLE IF NOT EXISTS chat_turns (
                id TEXT PRIMARY KEY, thread_id TEXT NOT NULL REFERENCES chat_threads(id), run_id TEXT NOT NULL, seq INTEGER NOT NULL,
                created_at TEXT NOT NULL, actor TEXT NOT NULL, status TEXT NOT NULL, data TEXT NOT NULL);
            CREATE INDEX IF NOT EXISTS chat_turns_thread ON chat_turns(thread_id, seq);
            CREATE INDEX IF NOT EXISTS chat_threads_run ON chat_threads(run_id);
        """)

    def close(self):
        with self.lock: self.db.close()

    def new_thread(self, run_id, actor):
        ident = "conv-" + uuid.uuid4().hex[:16]
        with self.lock, self.db:
            self.db.execute("INSERT INTO chat_threads VALUES (?,?,?,?)", (ident, run_id, _now(), actor))
        return ident

    def _thread(self, run_id, thread_id):
        row = self.db.execute("SELECT * FROM chat_threads WHERE id=?", (thread_id,)).fetchone()
        if not row or row["run_id"] != run_id: raise LookupError("Conversa não encontrada neste run.")
        return row

    def history(self, run_id, thread_id):
        """(thread_id, model messages of its successful turns). A new question without thread → (None, [])."""
        if not thread_id: return None, []
        with self.lock:
            self._thread(run_id, thread_id)
            rows = self.db.execute("SELECT data FROM chat_turns WHERE thread_id=? AND status='ok' ORDER BY seq", (thread_id,)).fetchall()
        return thread_id, [message for row in rows for message in json.loads(row["data"])["api_messages"]]

    def turn_count(self, thread_id):
        with self.lock:
            return self.db.execute("SELECT COUNT(*) FROM chat_turns WHERE thread_id=? AND status='ok'", (thread_id,)).fetchone()[0]

    def save_turn(self, record):
        data = {**record, "contexto": _compact(record.get("contexto"))}
        with self.lock, self.db:
            seq = self.db.execute("SELECT COALESCE(MAX(seq), 0) + 1 FROM chat_turns WHERE thread_id=?", (record["thread_id"],)).fetchone()[0]
            self.db.execute("INSERT INTO chat_turns VALUES (?,?,?,?,?,?,?,?)", (record["id"], record["thread_id"], record["run_id"], seq, _now(),
                            record["actor"], record["status"], json.dumps(data, ensure_ascii=False, default=str, separators=(",", ":"))))

    def threads(self, run_id, limit=20):
        """Recent conversations of a run with their answered questions, newest first (for reopening the dock)."""
        with self.lock:
            threads = self.db.execute("SELECT * FROM chat_threads WHERE run_id=? ORDER BY created_at DESC, rowid DESC LIMIT ?", (run_id, limit)).fetchall()
            result = []
            for thread in threads:
                turns = self.db.execute("SELECT created_at, actor, status, data FROM chat_turns WHERE thread_id=? ORDER BY seq", (thread["id"],)).fetchall()
                items = []
                for turn in turns:
                    data = json.loads(turn["data"])
                    items.append({"id": data["id"], "pergunta": data["pergunta"], "modo": data.get("modo"), "autor": turn["actor"], "criado_em": turn["created_at"],
                                  "status": turn["status"], "answer": data.get("answer"), "erro": data.get("erro"), "step_id": data.get("step_id"), "dataset": data.get("dataset")})
                if items: result.append({"id": thread["id"], "criado_em": thread["created_at"], "autor": thread["actor"], "perguntas": items})
            return result
