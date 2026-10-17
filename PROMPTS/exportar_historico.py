"""Exportação aditiva: python3 PROMPTS/exportar_historico.py --output NOVA_PASTA.

Busca apenas 16 e 17/10/2026 e confere o cwd Tarvo antes de ler o histórico.
Não substitui o exportador legado nem modifica suas fontes.
"""
import argparse
from collections import Counter
from datetime import datetime, timezone
import hashlib
import json
from pathlib import Path
import re

FIELDS = {
    "message": {"type", "role", "content", "channel", "recipient"},
    "agent_message": {"type", "author", "recipient", "content"},
    "function_call": {"type", "id", "call_id", "name", "arguments", "status"},
    "function_call_output": {"type", "call_id", "output", "status"},
    "custom_tool_call": {"type", "id", "call_id", "name", "input", "status"},
    "custom_tool_call_output": {"type", "call_id", "output", "status"},
}
CONTEXT_TAGS = ("environment_context", "external_codex_apps_open_page", "in-app-browser-context", "codex_apps_client_time_context", "external_codex_apps_writing_block_edits")
SECRET_PATTERNS = (
    r"sk-(?:ant-|proj-)?[A-Za-z0-9_-]{20,}",
    r"(?:ghp_[A-Za-z0-9]{30,}|github_pat_[A-Za-z0-9_]{30,})",
    r"ya29\.[A-Za-z0-9_-]{20,}", r"GOCSPX-[A-Za-z0-9_-]{10,}",
    r"AKIA[A-Z0-9]{16}",
    r"-----BEGIN (?:RSA |EC |OPENSSH )?PRIVATE KEY-----[\s\S]*?-----END (?:RSA |EC |OPENSSH )?PRIVATE KEY-----",
)

def sha(data):
    return hashlib.sha256(data).hexdigest()

class Redactor:
    def __init__(self):
        self.counts = Counter()

    def sub(self, text, pattern, replacement, category):
        text, count = re.subn(pattern, replacement, text)
        self.counts[category] += count
        return text

    def media(self, value):
        self.counts["binary_media_omitted"] += 1
        return "[MIDIA_BINARIA_OMITIDA sha256=" + sha(value.encode()) + " caracteres=" + str(len(value)) + "]"

    def text(self, value):
        value = re.sub(r"data:[^;,\s]+;base64,[A-Za-z0-9+/=]+", lambda m: self.media(m[0]), value)
        value = re.sub(r"(?<![A-Za-z0-9+/])([A-Za-z0-9+/]{4096,}={0,2})(?![A-Za-z0-9+/])", lambda m: self.media(m[0]), value)
        for pattern in SECRET_PATTERNS:
            value = self.sub(value, pattern, "[CREDENCIAL_REMOVIDA]", "credentials")
        value = self.sub(value, r"(?i)(\bBearer\s+)[A-Za-z0-9._~+/-]{16,}", r"\1[CREDENCIAL_REMOVIDA]", "credentials")
        value = self.sub(value, r"(?i)([?&](?:code|access_token|refresh_token|id_token|client_secret|state)=)[^&\s\\\"<>]+", r"\1[CREDENCIAL_REMOVIDA]", "oauth_query")
        value = self.sub(value, r"(?i)((?:\\?[\"'])?(?:access_token|refresh_token|id_token|client_secret|api_key|smtp_password|password)(?:\\?[\"'])?\s*[:=]\s*(?:\\?[\"'])?)[A-Za-z0-9._~+/-]{16,}", r"\1[CREDENCIAL_REMOVIDA]", "credential_fields")
        value = self.sub(value, r"/Users/[^/\s\"'<>]+/", "/Users/[USUARIO]/", "personal_paths")
        value = self.sub(value, r"(?i)[A-Z]:\\(?:\\)?Users\\(?:\\)?[^\\\s\"']+", r"C:\\Users\\[USUARIO]", "personal_paths")
        value = self.sub(value, r"(?<![\w.-])[A-Za-z0-9.!#$%&'*+/=?^_`{|}~-]+@[A-Za-z0-9-]+(?:\.[A-Za-z0-9-]+)+", "[EMAIL_REMOVIDO]", "email_addresses")
        value = self.sub(value, r"Library file metadata: \{[^\n]*\}", "[METADADOS_PRIVADOS_DE_BIBLIOTECA_OMITIDOS]", "private_metadata")
        value = self.sub(value, r"external-gdrive:account:\d+", "external-gdrive:account:[CONTA_REMOVIDA]", "private_metadata")
        value = self.sub(value, r"((?:browserId|tabId)=)[^&\s<>]+", r"\1[ID_PRIVADO]", "private_metadata")
        for tag in CONTEXT_TAGS:
            value = self.sub(value, rf"<{tag}(?:\s[^>]*)?>[\s\S]*?</{tag}>", "[CONTEXTO_AUTOMATICO_PRIVADO_OMITIDO]", "private_context")
        return value

    def walk(self, value):
        if isinstance(value, str):
            return self.text(value)
        if isinstance(value, list):
            return [self.walk(item) for item in value]
        if isinstance(value, dict):
            if value.get("type") in {"input_image", "image", "image_url", "output_image", "input_audio", "audio"}:
                self.counts["binary_media_omitted"] += 1
                reference = value.get("path") or value.get("url")
                if isinstance(reference, str) and reference.startswith("data:"):
                    reference = None
                return {"type": value["type"], "omitted": "binary_media", "sha256_original_block": sha(json.dumps(value, ensure_ascii=False, sort_keys=True).encode()), "reference": self.text(reference) if isinstance(reference, str) else None}
            return {key: self.walk(item) for key, item in value.items()}
        return value

def meta(path):
    with path.open(encoding="utf-8") as handle:
        for _ in range(8):
            line = handle.readline()
            if not line:
                break
            event = json.loads(line)
            if event.get("type") == "session_meta":
                return event["payload"]
    raise ValueError("session_meta ausente: " + path.name)

def export(path, destination, cutoff):
    raw = path.read_bytes()
    metadata = meta(path)
    redactor, omitted = Redactor(), Counter()
    kept, source_lines, pending = [], [], set()
    incomplete = False
    lines = raw.decode("utf-8").split("\n")
    for number, line in enumerate(lines, 1):
        if not line.strip():
            continue
        try:
            event = json.loads(line)
        except json.JSONDecodeError:
            if number == len(lines):
                incomplete = True
                break
            raise ValueError(f"JSON inválido em {path.name}:{number}") from None
        if event.get("timestamp", "") > cutoff:
            omitted["after_cutoff"] += 1
            continue
        if event.get("type") != "response_item":
            omitted[event.get("type", "unknown")] += 1
            continue
        payload = event.get("payload", {})
        kind = payload.get("type")
        if kind not in FIELDS:
            omitted[str(kind)] += 1
            continue
        if kind == "message":
            if payload.get("role") not in {"user", "assistant"} or payload.get("channel") not in {None, "commentary", "final"}:
                omitted["private_message"] += 1
                continue
            text = "".join(part.get("text", "") for part in payload.get("content", []) if isinstance(part, dict)).strip()
            if any(re.fullmatch(rf"<{tag}(?:\s[^>]*)?>[\s\S]*?</{tag}>", text) for tag in CONTEXT_TAGS):
                omitted["automatic_context_message"] += 1
                continue
        public = {"timestamp": event.get("timestamp"), "type": "response_item", "payload": redactor.walk({key: value for key, value in payload.items() if key in FIELDS[kind]})}
        kept.append(json.dumps(public, ensure_ascii=False, separators=(",", ":")))
        source_lines.append(number)
        call = payload.get("call_id")
        if call and kind in {"function_call", "custom_tool_call"}:
            pending.add(call)
        elif call and kind in {"function_call_output", "custom_tool_call_output"}:
            pending.discard(call)
    name = path.stem.removeprefix("rollout-") + ".jsonl"
    data = ("\n".join(kept) + "\n").encode()
    if len(data) >= 95_000_000:
        raise ValueError("Segmente exportação maior que 95 MB: " + name)
    (destination / name).write_bytes(data)
    source = metadata.get("source", {})
    spawn = source.get("subagent", {}).get("thread_spawn", {}) if isinstance(source, dict) else {}
    return {"session_id": metadata.get("id"), "file": name, "kind": "subagent" if spawn else "conversation", "parent_session_id": spawn.get("parent_thread_id"), "agent_task": spawn.get("agent_path"), "source_file": path.name, "source_snapshot_sha256": sha(raw), "source_snapshot_bytes": len(raw), "export_sha256": sha(data), "export_bytes": len(data), "export_events": len(kept), "first_event_utc": json.loads(kept[0])["timestamp"] if kept else None, "last_event_utc": json.loads(kept[-1])["timestamp"] if kept else None, "source_line_for_export_line": source_lines, "omitted_event_counts": dict(omitted), "redaction_counts": {key: value for key, value in redactor.counts.items() if value}, "unanswered_tool_calls_at_cutoff": len(pending), "incomplete_trailing_source_event": incomplete, "coverage": "snapshot local; não comprova todo o histórico do time"}

def main():
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--output", type=Path, required=True)
    args = parser.parse_args()
    package = Path(__file__).resolve().parents[2]
    cutoff = datetime.now(timezone.utc).isoformat(timespec="milliseconds").replace("+00:00", "Z")
    sources, excluded_internal = [], 0
    for day in ("2026/10/16", "2026/10/17"):
        for path in sorted((Path.home() / ".codex/sessions" / day).glob("*.jsonl")):
            metadata = meta(path)
            cwd = Path(metadata.get("cwd", "/")).resolve()
            if cwd != package and not cwd.is_relative_to(package):
                continue
            source = metadata.get("source", {})
            if isinstance(source, dict) and source.get("subagent", {}).get("other"):
                excluded_internal += 1
                continue
            sources.append(path)
    if not sources:
        parser.error("Nenhuma sessão local relacionada ao pacote Tarvo")
    args.output.mkdir(parents=True, exist_ok=False)
    records = [export(path, args.output, cutoff) for path in sources]
    manifest = {"format_version": 1, "snapshot_cutoff_utc": cutoff, "scope": "Codex local; cwd do pacote Tarvo ou descendente; 16 e 17/10/2026", "internal_non_conversation_sessions_excluded": excluded_internal, "sessions": records}
    (args.output / "manifest.json").write_text(json.dumps(manifest, ensure_ascii=False, indent=2) + "\n", encoding="utf-8")
    print(json.dumps({"sessions": len(records), "events": sum(row["export_events"] for row in records), "bytes": sum(row["export_bytes"] for row in records), "snapshot_cutoff_utc": cutoff, "output": str(args.output)}, ensure_ascii=False))

if __name__ == "__main__":
    main()
