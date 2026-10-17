#!/usr/bin/env python3
"""Reconcile a SQLite catalog transactionally; defaults to an isolated copy.

Usage: python scripts/migrate_catalog.py --database OLD.sqlite3 --output-copy NEW.sqlite3
Use --apply explicitly only after reviewing a copy. Other financial tables and
snapshots are never rewritten. --report writes the idempotence/audit result.
"""
import argparse
import json
import shutil
import sqlite3
import sys
from pathlib import Path

sys.path.insert(0, str(Path(__file__).resolve().parents[1]))
from src.catalog import migrate_catalog


def main():
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument('--database', required=True, type=Path)
    target = parser.add_mutually_exclusive_group(required=True)
    target.add_argument('--output-copy', type=Path)
    target.add_argument('--apply', action='store_true')
    parser.add_argument('--actor', default='Operador · migração cadastral')
    parser.add_argument('--report', type=Path)
    args = parser.parse_args()
    source = args.database.resolve()
    if not source.is_file():
        parser.error('Banco de origem não existe.')
    path = source
    if args.output_copy:
        path = args.output_copy.resolve()
        if path.exists() or path == source:
            parser.error('A cópia de destino deve ser um arquivo novo.')
        path.parent.mkdir(parents=True, exist_ok=True)
        # Copy the WAL alongside the database; the source is never opened writable.
        shutil.copy2(source, path)
        wal = Path(str(source)+'-wal')
        if wal.exists():
            shutil.copy2(wal, Path(str(path)+'-wal'))
    db = sqlite3.connect(path)
    try:
        db.execute('BEGIN IMMEDIATE')
        result = migrate_catalog(db, args.actor)
        db.commit()
        second = migrate_catalog(db, args.actor)
        db.commit()
        report = {'source_database': str(source), 'target_database': str(path),
                  'applied_to_original': bool(args.apply), 'migration': result,
                  'second_pass': second, 'idempotent': not second['changed']}
    except BaseException:
        db.rollback()
        raise
    finally:
        db.close()
    text = json.dumps(report, ensure_ascii=False, indent=2)
    if args.report:
        args.report.parent.mkdir(parents=True, exist_ok=True)
        args.report.write_text(text+'\n')
    print(text)


if __name__ == '__main__':
    main()
