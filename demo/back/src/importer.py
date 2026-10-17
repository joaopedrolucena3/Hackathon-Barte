"""Read validated source receipts, preserving bytes, identity and physical rows."""
from __future__ import annotations

import hashlib
import io
import re
from collections import defaultdict
from datetime import date, datetime
from decimal import Decimal
from pathlib import Path

import openpyxl

from .inputs import (AURORA_COLUMNS, PONTE_COLUMNS, RATE_COLUMNS, ROLES,
                     csv_rows, decode_text, discover_files, inspect_file,
                     operation_fingerprint, ponte_attachments, workbook_rows)

SLACK_SOURCE = "Slack #duvidas-hackathon-ai, respostas do financeiro de 16/10/2026"
PRODUCT_COLUMNS = {
    "Débito": "DEBITO", "Crédito à vista": "CREDITO_A_VISTA",
    "Créd. 2-6x": "CREDITO_2_6", "Créd. 7-12x": "CREDITO_7_12",
    "Pix": "PIX", "Antecipação": "ANTECIPACAO", "Spread remessa": "REMESSA",
}
CONFIRMED_EC = {"66564512000199": "1043300981", "78576234000179": "1043396662", "07752116000126": "1038867654"}


def decimal_text(value, brazilian=False):
    if value is None or value == "":
        return ""
    original = str(value).strip()
    text = original.replace(".", "").replace(",", ".") if brazilian else original
    try:
        value = Decimal(text)
    except ArithmeticError:
        raise ValueError(f"Número financeiro ilegível: {original!r}.") from None
    if not value.is_finite():
        raise ValueError("Número financeiro não finito.")
    return format(value, "f")


def cnpj_text(value):
    if value is None or value == "":
        return ""
    if isinstance(value, (int, float)):
        value = str(int(value))
    text = re.sub(r"\D", "", str(value))
    return text.zfill(14) if len(text) <= 14 else text


def date_text(value):
    if value is None or value == "":
        return ""
    if isinstance(value, (date, datetime)):
        return value.strftime("%Y-%m-%d")
    text = str(value).strip()
    for pattern in ("%d/%m/%Y", "%Y-%m-%d"):
        try:
            return datetime.strptime(text, pattern).strftime("%Y-%m-%d")
        except ValueError:
            pass
    raise ValueError(f"Data não reconhecida: {text}")


def read_text(path):
    return decode_text(Path(path).read_bytes())


def _records(entry):
    """Headers may follow report preambles; no filename or column-position rule."""
    text, _ = read_text(entry["path"])
    headers = None
    for line, cells in csv_rows(text, entry.get("delimiter", ";")):
        if line == entry["header_row"]:
            headers = [c.strip() for c in cells]
            continue
        if headers is None or not any(c.strip() for c in cells):
            continue
        # A truncated/oversized line is a row error, not a silently incomplete dict.
        yield line, dict(zip(headers, cells)), len(cells) == len(headers)


def _counts(rows):
    groups = defaultdict(list)
    for row in rows:
        groups[str(row.get("id", ""))].append(row)
    unique = duplicate = conflicting = conflict_ids = 0
    for group in groups.values():
        signatures = {operation_fingerprint(row) for row in group}
        if len(signatures) == 1:
            unique += 1
            duplicate += len(group) - 1
        else:
            conflicting += len(group)
            conflict_ids += 1
    return {"rows_unique": unique, "rows_duplicate": duplicate,
            "rows_conflicting": conflicting, "conflicting_ids": conflict_ids}


def load_data(source_dir, files=None):
    """Load a folder or an explicit list of immutable receipts.

    ``files`` entries contain name/path/role/id/sha256. Byte hashes and structures
    are checked again; an earlier validation result is not trusted blindly.
    No bad receipt disappears and there is no implicit first-file selection.
    """
    root = Path(source_dir).expanduser().resolve()
    if not root.is_dir():
        raise ValueError("A pasta de origem não existe.")
    data = {key: [] for key in ("merchants", "rates", "accounts", "checkout", "remittances", "bank", "sources", "import_warnings")}
    data.update(source_dir=str(root), bank_balances={})
    if files is None:
        manifest = discover_files(root)
    else:
        if not isinstance(files, (list, tuple)) or any(not isinstance(item, dict) for item in files):
            raise ValueError("O manifesto de entrada deve conter uma lista de arquivos.")
        manifest = []
        for receipt in files:
            original = str(receipt.get("name") or Path(str(receipt.get("path", ""))).name)
            path = Path(str(receipt.get("path") or original)).expanduser()
            if not path.is_absolute():
                path = root / path
            item = inspect_file(path, role=receipt.get("role"), file_id=receipt.get("id"), name=original)
            if receipt.get("receipt_id"):
                item["receipt_id"] = str(receipt["receipt_id"])
            if receipt.get("sha256") and receipt["sha256"] != item["sha256"]:
                item.update(status="invalid", reason="O hash do arquivo difere do recebimento registrado; entrada não importada.")
                item["validation"] = {"status": item["status"], "reason": item["reason"]}
            manifest.append(item)
    data["input_manifest"] = manifest
    equivalent_receipts = {}

    def provenance(item, line=None, file=None):
        result = {"source_file": file or item["name"], "source_id": item["id"], "source_sha256": item["sha256"]}
        if item.get("receipt_id"):
            result["source_receipt_id"] = item["receipt_id"]
        if line is not None:
            result["physical_row"] = line
        if item["id"] in equivalent_receipts:
            suffix = (file or item["name"])[len(item["name"]):]
            result["provenances"] = [{"source_file": receipt["name"] + suffix,
                "source_id": receipt["id"], "source_sha256": receipt["sha256"],
                **({"source_receipt_id": receipt["receipt_id"]} if receipt.get("receipt_id") else {}),
                **({"physical_row": line} if line is not None else {})}
                for receipt in equivalent_receipts[item["id"]]]
        return result

    def warning(kind, message, item=None, ref="", **extra):
        data["import_warnings"].append({"type": kind, "message": message,
            **(provenance(item) if item else {"source_file": ""}), "source_ref": ref, **extra})

    status_types = {"empty": "ARQUIVO_VAZIO", "header_only": "ARQUIVO_SO_CABECALHO",
                    "invalid": "ARQUIVO_INVALIDO", "ambiguous": "ARQUIVO_AMBIGUO"}
    for item in manifest:
        item.update(rows_received=item["row_count"], rows_valid=0, rows_discarded=0, import_action="not_imported")
        if item["status"] != "valid":
            warning(status_types[item["status"]], item["reason"], item, "arquivo")
    selected = defaultdict(list)
    for role in ROLES:
        available = [item for item in manifest if item["role"] == role and item["status"] == "valid"]
        if not available:
            # An invalid receipt already describes the concrete failure; absence
            # remains a separate warning only when no receipt claims this role.
            if not any(item["role"] == role for item in manifest):
                warning("ARQUIVO_AUSENTE", f"Fonte obrigatória {role} não encontrada entre os arquivos apresentados.", ref=role)
        elif role != "orbe" and len({item["sha256"] for item in available}) > 1:
            for item in available:
                item.update(status="ambiguous", reason=f"Há {len(available)} arquivos válidos para a fonte única {role}.")
                item["validation"] = {"status": item["status"], "reason": item["reason"]}
                warning("ARQUIVO_AMBIGUO", item["reason"], item, "arquivo")
        else:
            if role != "orbe":
                available = sorted(available, key=lambda entry: (entry["name"], entry["id"]))
                primary = available[0]
                equivalent_receipts[primary["id"]] = available
                for duplicate in available[1:]:
                    duplicate.update(duplicate_of=primary["id"], import_action="duplicate_receipt")
                selected[role] = [primary]
            else:
                selected[role] = available
            for accepted in selected[role]:
                accepted["import_action"] = "imported"

    for item in selected["orbe"]:
        for line, row, full in _records(item):
            try:
                if not full:
                    raise ValueError("Quantidade de colunas diferente do cabeçalho.")
                if not row["id_transacao"]:
                    raise ValueError("ID da transação ausente.")
                data["checkout"].append({
                    "id": row["id_transacao"], "date": date_text(row["data_movimento"]),
                    "ec": row["cod_estabelecimento"], "name": row["nome_estabelecimento"],
                    "type": row["tipo_lancamento"], "modality": row["modalidade"],
                    "installments": int(row["qtd_parcelas"]) if row["qtd_parcelas"] else None,
                    "brand": row["bandeira"], "gross": decimal_text(row["valor_bruto"], True),
                    "applied_rate_pct": decimal_text(row["taxa_aplicada_pct"], True),
                    "reported_fee": decimal_text(row["valor_taxa"], True), "net": decimal_text(row["valor_liquido"], True),
                    "original_id": row["id_referencia"], "original_date": date_text(row["data_venda_original"]),
                    "source_ref": row["id_transacao"], **provenance(item, line),
                })
                item["rows_valid"] += 1
            except (ValueError, KeyError, TypeError, ArithmeticError) as exc:
                item["rows_discarded"] += 1
                warning("LINHA_INVALIDA", str(exc), item, f"L{line}", physical_row=line)

    for item in selected["taxas"]:
        book = openpyxl.load_workbook(io.BytesIO(Path(item["path"]).read_bytes()), read_only=True, data_only=True)
        _, _, rows = workbook_rows(book, "Taxas vigentes", RATE_COLUMNS)
        merchants = {}
        for line, row in rows:
            cnpj = cnpj_text(row.get("CNPJ"))
            ref = f"Taxas vigentes!A{line}:L{line}"
            if not cnpj or not row.get("Lojista"):
                item["rows_discarded"] += 1
                warning("LINHA_INVALIDA", "Lojista ou CNPJ ausente na tabela de taxas.", item, ref, physical_row=line)
                continue
            ec = str(row.get("EC Orbe") or CONFIRMED_EC.get(cnpj, ""))
            active = "INATIVO" not in str(row.get("Obs") or "").upper()
            if cnpj not in merchants:
                merchants[cnpj] = {"cnpj": cnpj, "name": str(row["Lojista"]), "ec": ec,
                    "active": active, "candidate": False, "source_ref": ref, **provenance(item, line),
                    "identity_rule": SLACK_SOURCE if cnpj in CONFIRMED_EC else "CNPJ e EC da tabela vigente"}
            validity = str(row.get("Vigência") or "")
            found = re.search(r"\d{2}/\d{2}/\d{4}", validity)
            try:
                start = "" if "até" in validity else date_text(found.group()) if found else ""
                end = date_text(found.group()) if found and "até" in validity else ""
            except ValueError as exc:
                item["rows_discarded"] += 1
                warning("LINHA_INVALIDA", str(exc), item, ref, physical_row=line)
                continue
            item["rows_valid"] += 1
            if not active:
                continue
            for column, product in PRODUCT_COLUMNS.items():
                value = row.get(column)
                default = product == "REMESSA" and (value is None or str(value).strip().lower() == "padrão")
                if value is None and not default:
                    continue
                try:
                    pct = Decimal("1.5") if default else (Decimal(str(value).replace("%", "").replace(",", ".")) if isinstance(value, str) else Decimal(str(value)) * 100)
                    if not pct.is_finite():
                        raise ValueError("Taxa não finita.")
                except (ArithmeticError, ValueError):
                    warning("TAXA_INVALIDA", f"Taxa inválida para {product}.", item, ref, physical_row=line)
                    continue
                base = {"id": f"RATE-{cnpj}-{product}-{line}", "cnpj": cnpj, "product": product,
                    "start": start, "end": end, "rate_pct": format(pct, "f"), "source_ref": ref,
                    **provenance(item, line), "rule": SLACK_SOURCE + ": spread padrão 1,5%" if default else "Tabela contratada vigente"}
                if cnpj == "00520815000100" and product != "REMESSA":
                    base["end"] = "2026-08-31"
                    data["rates"].append(base)
                    data["rates"].append({**base, "id": base["id"] + "-ISENCAO", "start": "2026-09-01", "end": "2026-12-31", "rate_pct": "0", "rule": SLACK_SOURCE + ": Casa isenta MDR e antecipação set–dez; data original da operação"})
                else:
                    data["rates"].append(base)
        data["merchants"].extend(merchants.values())
        old_name = "ANTIGO 2025 - nao usar"
        if old_name in book.sheetnames:
            for line, cells in enumerate(book[old_name].values, 1):
                if cells and cells[0] == "Atlas Idiomas Ltda":
                    data["merchants"].append({"cnpj": cnpj_text(cells[1]), "name": cells[0], "ec": "1076801732",
                        "active": True, "candidate": True, **provenance(item, line), "source_ref": f"{old_name}!A{line}:B{line}",
                        "identity_rule": "Identidade candidata pela aba histórica e nome do relatório Orbe; confirmar cadastro. Taxas antigas não importadas."})
        book.close()

    for item in selected["ponte"]:
        message, attachments = ponte_attachments(Path(item["path"]).read_bytes())
        data["partner_email"] = {"from": str(message.get("From", "")), "subject": str(message.get("Subject", "")), "date": str(message.get("Date", ""))}
        attachment = attachments[0]  # Inspector has established unambiguous structure.
        payload = attachment["content"]
        book = openpyxl.load_workbook(io.BytesIO(payload), read_only=True, data_only=True)
        source_file = f"{item['name']}::{attachment['name']}"
        _, _, rows = workbook_rows(book, "Operações", PONTE_COLUMNS)
        for line, row in rows:
            try:
                if not row.get("Nº Operação"):
                    raise ValueError("Número da operação de câmbio ausente.")
                data["remittances"].append({
                    "id": str(row["Nº Operação"]), "contracted_date": date_text(row["Data Contratação"]),
                    "settlement_date": date_text(row["Data Liquidação"]), "cnpj": cnpj_text(row["CNPJ Cliente"]),
                    "name": row["Cliente"], "currency": row["Moeda"], "foreign_amount": decimal_text(row["Valor ME"]),
                    "client_rate": decimal_text(row["Taxa Cliente"]), "ptax_rate": decimal_text(row["PTAX Ref."]),
                    "gross_brl": decimal_text(row["Valor R$"]), "spread_brl": decimal_text(row["Spread R$"]),
                    "applied_rate_pct": decimal_text(Decimal(str(row["Spread %"])) * 100),
                    "estimated_spread_brl": decimal_text(row["Spread Estimado R$ (D-1)"]), "iof_brl": decimal_text(row["IOF R$"]),
                    "compliance": row["Status Compliance"], "observation": str(row["Observação"] or ""),
                    "source_ref": str(row["Nº Operação"]), **provenance(item, line, source_file),
                    "attachment_sha256": hashlib.sha256(payload).hexdigest(),
                })
                item["rows_valid"] += 1
            except (ValueError, KeyError, TypeError, ArithmeticError) as exc:
                item["rows_discarded"] += 1
                warning("LINHA_INVALIDA", str(exc), item, f"Operações!L{line}", source_file=source_file, physical_row=line)
        book.close()
        data["sources"].append({"id": item["id"] + "::attachment", "name": source_file,
            "sha256": hashlib.sha256(payload).hexdigest(), "rows": len(rows), "rows_received": len(rows),
            "rows_valid": item["rows_valid"], "rows_discarded": item["rows_discarded"],
            "embedded": True, "source_id": item["id"], "role": "ponte", "status": "valid"})

    for item in selected["contas"]:
        for line, row, full in _records(item):
            try:
                if not full or not row.get("COD_CONTA") or not row.get("DESCRICAO"):
                    raise ValueError("Conta sem código/descrição ou com quantidade de colunas incorreta.")
                data["accounts"].append({"code": row["COD_CONTA"], "name": row["DESCRICAO"],
                    "postable": row["ACEITA_LANCTO"] == "S", "nature": row["NATUREZA"],
                    "source_ref": f"L{line}", **provenance(item, line)})
                item["rows_valid"] += 1
            except (ValueError, KeyError, TypeError) as exc:
                item["rows_discarded"] += 1
                warning("LINHA_INVALIDA", str(exc), item, f"L{line}", physical_row=line)

    for item in selected["aurora"]:
        for line, row, full in _records(item):
            try:
                if not full:
                    raise ValueError("Quantidade de colunas diferente do cabeçalho bancário.")
                label = row["Lançamento"]
                if label == "Os lançamentos estão sujeitos a confirmação.":
                    continue
                if label in {"SALDO ANTERIOR", "SALDO FINAL"}:
                    key = "opening" if label == "SALDO ANTERIOR" else "closing"
                    data["bank_balances"].setdefault("AURORA", {}).update({key: decimal_text(row["Saldo (R$)"], True), key + "_ref": f"L{line}"})
                    continue
                if not row["Data"] or not row["Valor (R$)"]:
                    raise ValueError("Movimento bancário sem data ou valor.")
                data["bank"].append({"id": f"AURORA-L{line}", "bank": "AURORA", "ref_origem": f"L{line}",
                    "date": date_text(row["Data"]), "description": label, "amount": decimal_text(row["Valor (R$)"], True),
                    "balance": decimal_text(row["Saldo (R$)"], True), **provenance(item, line)})
                item["rows_valid"] += 1
            except (ValueError, KeyError, ArithmeticError) as exc:
                # Balance lines are contextual evidence and not movement counts.
                if row.get("Lançamento") not in {"SALDO ANTERIOR", "SALDO FINAL"}:
                    item["rows_discarded"] += 1
                warning("LINHA_INVALIDA", str(exc), item, f"L{line}", physical_row=line)

    for item in selected["meridiano"]:
        text, _ = read_text(item["path"])
        for match in re.finditer(r"<STMTTRN>(.*?)</STMTTRN>", text, re.S | re.I):
            row = {key.upper(): value for key, value in re.findall(r"<([^/>]+)>([^<\r\n]*)", match.group(1))}
            line = text[:match.start()].count("\n") + 1
            try:
                data["bank"].append({"id": "MERIDIANO-" + row["FITID"], "bank": "MERIDIANO", "ref_origem": row["FITID"],
                    "date": datetime.strptime(row["DTPOSTED"][:8], "%Y%m%d").date().isoformat(),
                    "description": row["MEMO"], "amount": decimal_text(row["TRNAMT"]), **provenance(item, line)})
                item["rows_valid"] += 1
            except (ValueError, KeyError, ArithmeticError) as exc:
                item["rows_discarded"] += 1
                warning("LINHA_INVALIDA", str(exc), item, f"L{line}", physical_row=line)
        balance = re.search(r"<LEDGERBAL>\s*<BALAMT>([^<\s]+)", text, re.I)
        if balance:
            try:
                data["bank_balances"]["MERIDIANO"] = {"closing": decimal_text(balance.group(1)), "closing_ref": "LEDGERBAL/BALAMT", "opening": "", "opening_explicit": False}
            except ValueError as exc:
                warning("LINHA_INVALIDA", str(exc), item, "LEDGERBAL/BALAMT")

    # The catalog owns contract identity; import order/physical row is evidence only.
    from .catalog import normalize_rate
    data["rates"] = [normalize_rate(row) for row in data["rates"]]
    for receipts in equivalent_receipts.values():
        primary = receipts[0]
        for duplicate in receipts[1:]:
            duplicate.update(rows_valid=primary["rows_valid"], rows_discarded=primary["rows_discarded"])
    data["sources"].extend(dict(item) for item in manifest)
    by_role = {}
    for role in ROLES:
        entries = [item for item in manifest if item["role"] == role]
        by_role[role] = {"files_received": len(entries),
            **{key: sum(item[key] for item in entries) for key in ("rows_received", "rows_valid", "rows_discarded")}}
    by_role["orbe"].update(_counts(data["checkout"]))
    by_role["ponte"].update(_counts(data["remittances"]))
    data["ingestion_counts"] = {"files_received": len(manifest), "files_valid": sum(item["status"] == "valid" for item in manifest), "by_role": by_role}
    return data
