"""Delivery contract: real intake, tamper detection and failed publication."""
import csv
from decimal import Decimal
import json
from pathlib import Path
import shutil
import tempfile
import unittest
from unittest.mock import patch

from src import delivery
from src.importer import load_data
from src.store import EXPORTS, ROOT


class OfficialDelivery(unittest.TestCase):
    @classmethod
    def setUpClass(cls):
        cls.temp = tempfile.TemporaryDirectory(prefix='tarvo-delivery-tests-')
        cls.base = Path(cls.temp.name)
        cls.source = ROOT / 'data' / 'case'
        cls.package = cls.base / 'original'
        cls.source_hashes = delivery.inspect_sources(cls.source)
        cls.manifest = delivery.generate_delivery(cls.source, cls.package, '2026-09')
        cls.data = load_data(cls.source)

    @classmethod
    def tearDownClass(cls):
        cls.temp.cleanup()

    def package_copy(self):
        path = Path(tempfile.mkdtemp(dir=self.base)) / 'copy'
        shutil.copytree(self.package, path)
        return path

    def edit(self, path, name, change):
        with (path / name).open(encoding='utf-8', newline='') as handle:
            reader = csv.DictReader(handle, delimiter=';')
            fields, rows = reader.fieldnames, list(reader)
        change(rows)
        with (path / name).open('w', encoding='utf-8', newline='') as handle:
            writer = csv.DictWriter(handle, fields, delimiter=';', lineterminator='\n')
            writer.writeheader(); writer.writerows(rows)

    def test_clean_generation_repeats_and_preserves_history_and_sources(self):
        target = self.base / 'repeat'
        history = target / 'historico'
        history.mkdir(parents=True)
        (history / 'original.txt').write_text('não apagar', encoding='utf-8')
        delivery.generate_delivery(self.source, target, '2026-09')
        for name in EXPORTS:
            self.assertEqual((target / name).read_bytes(), (self.package / name).read_bytes(), name)
        self.assertEqual((history / 'original.txt').read_text(encoding='utf-8'), 'não apagar')
        self.assertEqual(delivery.inspect_sources(self.source), self.source_hashes)
        result = delivery.verify_package(target, self.source)
        self.assertGreater(result['known_outputs'], 0)
        self.assertTrue(result['trace_ok'])
        state = json.loads((target / 'verificacao.json').read_text())
        self.assertEqual(state['summary']['checkout_brl'], '207039.73')

    def test_modified_artifact_fails_hash_verification(self):
        folder = self.package_copy()
        with (folder / 'pendencias.csv').open('a') as handle:
            handle.write('\n')
        with self.assertRaisesRegex(ValueError, 'Hash'):
            delivery.verify_package(folder, self.source)

    def test_balanced_but_invented_source_reference_is_rejected(self):
        folder = self.package_copy()
        self.edit(folder, 'rastro.csv', lambda rows: rows[0].update(ref_origem='INVENTADA'))
        with self.assertRaisesRegex(ValueError, 'referência não encontrada'):
            delivery.validate_csvs(folder, self.data)

    def test_stale_code_and_output_reference_are_rejected(self):
        with patch.object(delivery, 'code_identity', return_value={'sha256': 'changed'}):
            with self.assertRaisesRegex(ValueError, 'Código atual difere'):
                delivery.verify_package(self.package, self.source)
        folder = self.package_copy()
        self.edit(folder, 'divergencias_taxa.csv', lambda rows: rows[0].update(ref_origem='INVENTADA'))
        with self.assertRaisesRegex(ValueError, 'referência da saída'):
            delivery.validate_csvs(folder, self.data)

    def test_symlink_destination_cannot_retarget_existing_data(self):
        link = self.base / 'linked-destination'
        try:
            link.symlink_to(self.package, target_is_directory=True)
        except OSError:
            self.skipTest('Ambiente sem criação de links simbólicos.')
        with self.assertRaisesRegex(ValueError, 'link simbólico'):
            delivery.generate_delivery(self.source, link, '2026-09')

    def test_duplicate_output_and_missing_trace_are_rejected(self):
        folder = self.package_copy()
        self.edit(folder, 'notas_a_emitir.csv', lambda rows: rows.append(dict(rows[0])))
        with self.assertRaisesRegex(ValueError, 'ID vazio ou repetido'):
            delivery.validate_csvs(folder, self.data)
        folder = self.package_copy()
        def remove_id(rows):
            ident = rows[0]['id_saida']
            rows[:] = [r for r in rows if r['id_saida'] != ident]
        self.edit(folder, 'rastro.csv', remove_id)
        with self.assertRaisesRegex(ValueError, 'sem rastro'):
            delivery.validate_csvs(folder, self.data)

    def test_unknown_exposure_is_not_silently_zero(self):
        folder = self.package_copy()
        with (folder / 'pendencias.csv').open(encoding='utf-8') as handle:
            rows = list(csv.DictReader(handle, delimiter=';'))
        grouped = next(r for r in rows if r.get('group_scope') == 'merchant_period')
        ident = grouped['id_saida']
        with (folder / 'rastro.csv').open(encoding='utf-8') as handle:
            traces = [r for r in csv.DictReader(handle, delimiter=';') if r['id_saida'] == ident]
        subtotal = sum((Decimal(r['valor']) for r in traces[1:]), Decimal(0))
        def mark_partial(rows):
            next(r for r in rows if r['id_saida'] == ident).update(
                valor_brl='', exposure_status='partial', known_exposure_brl=str(subtotal), missing_exposure_count='1')
        def missing_value(rows):
            next(r for r in rows if r['id_saida'] == ident)['valor'] = ''
        self.edit(folder, 'pendencias.csv', mark_partial)
        self.edit(folder, 'rastro.csv', missing_value)
        self.assertEqual(delivery.validate_csvs(folder, self.data)['unknown_outputs'], 1)
        self.edit(folder, 'pendencias.csv', lambda rows: next(r for r in rows if r['id_saida'] == ident).update(valor_brl='0.00'))
        with self.assertRaisesRegex(ValueError, 'desconhecido'):
            delivery.validate_csvs(folder, self.data)

    def test_source_tampering_and_wrong_period_do_not_publish(self):
        source = self.base / 'changed-inputs'
        shutil.copytree(self.source, source)
        original = source / next(iter(self.source_hashes))
        original.write_bytes(original.read_bytes() + b'\n')
        with self.assertRaisesRegex(ValueError, 'fontes atuais diferem'):
            delivery.verify_package(self.package, source)
        output = self.base / 'wrong-month'
        with self.assertRaisesRegex(ValueError, 'Nenhum movimento'):
            delivery.generate_delivery(self.source, output, '2027-01')
        self.assertFalse(output.exists())

    def test_failed_directory_swap_restores_entire_old_delivery(self):
        folder = self.package_copy()
        (folder / 'historico.txt').write_text('preservar')
        before = {p.name: p.read_bytes() for p in folder.iterdir() if p.is_file()}
        replace = delivery.os.replace
        def fail_stage(src, dst):
            if Path(src).name == 'package':
                raise OSError('falha de disco simulada')
            return replace(src, dst)
        with patch.object(delivery.os, 'replace', side_effect=fail_stage):
            with self.assertRaisesRegex(OSError, 'falha de disco'):
                delivery.publish_package(self.package, folder)
        self.assertEqual(before, {p.name: p.read_bytes() for p in folder.iterdir() if p.is_file()})

    def test_reserved_directory_is_preserved_and_rejected(self):
        folder = self.package_copy()
        (folder / 'rastro.csv').unlink()
        (folder / 'rastro.csv').mkdir()
        (folder / 'rastro.csv' / 'important.txt').write_text('preservar')
        with self.assertRaisesRegex(ValueError, 'Destino reservado'):
            delivery.publish_package(self.package, folder)
        self.assertEqual((folder / 'rastro.csv' / 'important.txt').read_text(), 'preservar')

    def test_concurrent_history_change_aborts_without_overwriting_it(self):
        folder = self.package_copy()
        historic = folder / 'historico.txt'
        historic.write_text('primeira versão')
        copytree = shutil.copytree
        def update_after_copy(src, dst, **kwargs):
            result = copytree(src, dst, **kwargs)
            historic.write_text('nova versão de outro processo')
            return result
        with patch.object(delivery.shutil, 'copytree', side_effect=update_after_copy):
            with self.assertRaisesRegex(ValueError, 'Destino alterado'):
                delivery.publish_package(self.package, folder)
        self.assertEqual(historic.read_text(), 'nova versão de outro processo')

    def test_recovery_restores_directory_after_interrupted_swap(self):
        folder = self.package_copy()
        backup = folder.parent / f'.{folder.name}.entrega-backup'
        journal = folder.parent / f'.{folder.name}.entrega-transaction.json'
        delivery.write_json(journal, {'manifest_sha256': delivery.sha(self.package / 'manifesto.json')})
        delivery.os.replace(folder, backup)
        delivery.recover_publication(folder)
        self.assertTrue((folder / 'rastro.csv').is_file())
        self.assertFalse(backup.exists())
        self.assertFalse(journal.exists())

    def test_interrupt_after_each_rename_remains_recoverable(self):
        for interrupt_number in (1, 2):
            with self.subTest(rename=interrupt_number):
                folder = self.package_copy()
                replace = delivery.os.replace
                calls = 0
                def interrupt_after_rename(src, dst):
                    nonlocal calls
                    replace(src, dst)
                    calls += 1
                    if calls == interrupt_number:
                        raise KeyboardInterrupt()
                with patch.object(delivery.os, 'replace', side_effect=interrupt_after_rename):
                    with self.assertRaises(KeyboardInterrupt):
                        delivery.publish_package(self.package, folder)
                delivery.recover_publication(folder)
                self.assertTrue(delivery.verify_package(folder, self.source)['trace_ok'])
                self.assertFalse((folder.parent / f'.{folder.name}.entrega-backup').exists())


if __name__ == '__main__':
    unittest.main()
