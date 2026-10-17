"""Isolated browser QA, no Google network calls and no real mail.

Run explicitly: .venv/bin/python tests/serve_mail_demo.py
Never use this process for a real Gmail demonstration.
"""
import sys
import tempfile
from pathlib import Path

ROOT = Path(__file__).resolve().parents[1]
sys.path.insert(0, str(ROOT))

from src.api.app import create_app
from mail_fakes import BrowserDemoAuth, FakeGoogleProvider, test_config
import uvicorn


def main():
    with tempfile.TemporaryDirectory(prefix='tarvo-mail-ui-') as directory:
        base=Path(directory)
        provider=FakeGoogleProvider()
        auth=BrowserDemoAuth(base/'private',provider=provider,config=test_config('http://127.0.0.1:8766'))
        app=create_app(base/'qa.sqlite3', ROOT/'data/case',base/'runs',mail_auth=auth)
        print('QA isolado em http://127.0.0.1:8766 — provedor simulado, nenhum envio real.',flush=True)
        uvicorn.run(app,host='127.0.0.1',port=8766,log_level='warning',access_log=False)


if __name__=='__main__':
    main()
