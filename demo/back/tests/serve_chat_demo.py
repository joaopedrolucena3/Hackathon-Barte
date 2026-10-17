"""Isolated browser QA of the query chat, without the Anthropic API: a scripted analyst (chat_fakes.DemoAnalyst)
answers any question with real queries on the open table. It exercises the screen and the server path
(SQL guard, markers, seal, highlights); it says nothing about answer quality.

Run explicitly: .venv/bin/python tests/serve_chat_demo.py [porta]   (default 8792)
"""
import sys
import tempfile
from pathlib import Path

ROOT = Path(__file__).resolve().parents[1]
sys.path.insert(0, str(ROOT))

from src.api.app import create_app
from chat_fakes import DemoAnalyst
import uvicorn


def main():
    port = int(sys.argv[1]) if len(sys.argv) > 1 else 8792
    with tempfile.TemporaryDirectory(prefix='tarvo-chat-ui-') as directory:
        base = Path(directory)
        app = create_app(base/'qa.sqlite3', ROOT/'data/case', base/'runs', mail_private_dir=base/'private', chat_client=DemoAnalyst())
        print(f'QA do chat em http://127.0.0.1:{port} — analista roteirizado, nenhuma chamada à Anthropic.', flush=True)
        uvicorn.run(app, host='127.0.0.1', port=port, log_level='warning', access_log=False)


if __name__ == '__main__':
    main()
