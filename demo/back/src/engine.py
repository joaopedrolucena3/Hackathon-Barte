"""Deterministic close. Money stays Decimal until the JSON output boundary."""
from __future__ import annotations

import hashlib
import json
import re
from copy import deepcopy
from collections import defaultdict
from decimal import Decimal, InvalidOperation, ROUND_HALF_UP

from .importer import load_data, SLACK_SOURCE
from .inputs import operation_fingerprint, canonical_operation


ZERO = Decimal("0")
CENT = Decimal("0.01")
DEFAULT_PARAMETERS = {"period": "2026-09", "remittance_tolerance_pp": "0.002", "closing_deadline": "2026-10-17"}


def dec(value):
    result = Decimal(str(value))
    if not result.is_finite():
        raise ValueError("Número financeiro não finito.")
    return result


def rounded(value):
    return dec(value).quantize(CENT, rounding=ROUND_HALF_UP)


def money(value):
    number = rounded(value)
    return format(ZERO if number == 0 else number, ".2f")


def uid(prefix, *values):
    digest = hashlib.sha256(json.dumps(values, ensure_ascii=False, sort_keys=True, default=str).encode()).hexdigest()[:18]
    return f"{prefix}-{digest}"


def valid_cnpj(value):
    # Data are synthetic; validating check digits would reject the supplied identifiers.
    return bool(re.fullmatch(r"\d{14}", str(value or "")))


class Closing:
    def __init__(self, data, parameters):
        self.data = data
        periods = sorted({r.get("date", "")[:7] for r in data.get("checkout", [])} | {r.get("contracted_date", "")[:7] for r in data.get("remittances", [])})
        self.params = {**DEFAULT_PARAMETERS, "period": next((p for p in reversed(periods) if p), "2026-09"), **(parameters or {})}
        self.period = self.params["period"]
        if not re.fullmatch(r"\d{4}-\d{2}", self.period):
            raise ValueError("Competência deve usar AAAA-MM.")
        self.tolerance = dec(self.params["remittance_tolerance_pp"])
        if self.tolerance < 0:
            raise ValueError("Tolerância não pode ser negativa.")
        self.out = {k: [] for k in ("comissoes", "divergencias", "notas", "lancamentos", "pendencias", "rastro", "details")}
        self.by_ec = defaultdict(list)
        self.by_cnpj = defaultdict(list)
        for merchant in data.get("merchants", []):
            self.by_cnpj[merchant.get("cnpj", "")].append(merchant)
            if merchant.get("ec"):
                self.by_ec[merchant["ec"]].append(merchant)
        self.groups = defaultdict(list)
        self.counts = {"checkout": 0, "remessa": 0, "bank": 0}
        self.issue_ids = set()
        self.registration_groups = defaultdict(dict)

    def trace(self, output_id, row, value, rule, formula, **extra):
        ref = row.get("source_ref") or row.get("ref_origem") or row.get("id") or "arquivo"
        source = row.get("source_file", "Fonte não informada")
        item = {"id_saida": output_id, "arquivo_origem": source, "ref_origem": ref, "valor": money(value) if value is not None else None, "source_row": row.get("physical_row", ""), "regra": rule}
        self.out["rastro"].append(item)
        self.out["details"].append({**item, "formula": formula, "entrada": dict(row), **extra})

    def issue(self, kind, rows, value, reason, owner="Financeiro Tarvo", severity="bloqueante", suggestion="Revisar evidências e registrar a decisão.", rule="Revisão humana necessária", **extra):
        if isinstance(rows, dict):
            rows = [rows]
        row = rows[0]
        references = [r.get("source_ref") or r.get("ref_origem") or r.get("id") or "arquivo" for r in rows]
        iid = uid("PEND", self.period, kind, references, row.get("source_file", ""))
        if iid in self.issue_ids:
            return iid
        self.issue_ids.add(iid)
        evidence = [{"arquivo": r.get("source_file", ""), "ref": r.get("source_ref") or r.get("ref_origem") or r.get("id", ""), "linha": r.get("physical_row", "")} for r in rows]
        self.out["pendencias"].append({"id_saida": iid, "tipo": kind, "ref_origem": references[0], "valor_brl": money(value),
            "motivo": reason, "quem_decide": owner, "severity": severity, "suggestion": suggestion, "evidence": evidence,
            "source_fingerprint": hashlib.sha256(json.dumps(rows, ensure_ascii=False, sort_keys=True, default=str).encode()).hexdigest(), "rule": rule, **extra})
        self.trace(iid, row, value, rule, "Valor exposto na evidência; nenhuma receita reconhecida por esta pendência.", motivo=reason)
        return iid

    def unique(self, rows, kind):
        grouped = defaultdict(list)
        for row in rows:
            grouped[row.get("id", "")].append(row)
        result = []
        for key, copies in sorted(grouped.items()):
            copies = sorted(copies, key=lambda r: (r.get('source_sha256', ''), r.get('source_file', ''), str(r.get('physical_row', ''))))
            if not key:
                self.issue("ID_AUSENTE", copies, ZERO, "Identificador de origem ausente.")
                continue
            if len(copies) > 1:
                signatures = {operation_fingerprint(r) for r in copies}
                if len(signatures) > 1:
                    self.issue("DUPLICIDADE_CONFLITANTE", copies, ZERO, f"{kind}: mesmo ID possui valores distintos; nenhuma versão foi contabilizada.", suggestion="Solicitar versão correta ao fornecedor.", rule="Nunca escolher silenciosamente uma versão conflitante.")
                    continue
                try:
                    amount = dec(copies[0].get("spread_brl", copies[0].get("reported_fee", copies[0].get("amount", "0"))))
                except (InvalidOperation, ValueError, TypeError):
                    self.issue("DUPLICIDADE_INVALIDA", copies, ZERO, f"{kind}: duplicata contém número financeiro inválido; valor indisponível e nenhuma versão contabilizada.")
                    continue
                self.issue("DUPLICIDADE", copies, amount, f"{kind}: ID repetido em {len(copies)} linhas; contabilizado uma única vez.", severity="atencao", suggestion="Contestar a duplicata junto ao fornecedor.", rule=SLACK_SOURCE + ": duplicata por operação conta uma vez")
            selected = dict(copies[0])
            origins = {}
            for item in copies:
                for origin in [{k: item.get(k) for k in ('source_file', 'source_id', 'source_sha256', 'source_receipt_id', 'source_ref', 'physical_row')}] + (item.get('provenances') or []):
                    origins[json.dumps(origin, sort_keys=True)] = origin
            selected['provenances'] = list(origins.values())
            result.append(selected)
        return result

    def merchant(self, row, by_ec=False):
        key = row.get("ec" if by_ec else "cnpj", "")
        choices = self.by_ec.get(key, []) if by_ec else self.by_cnpj.get(key, [])
        if not choices:
            self.issue("CADASTRO_AUSENTE", row, ZERO, f"Não há cadastro confirmado para {'EC' if by_ec else 'CNPJ'} {key}.", owner="Comercial e cadastro", rule="Identidade por chave exata; sem casamento aproximado de nomes.")
            return None
        if len(choices) != 1:
            self.issue("CADASTRO_AMBIGUO", row, ZERO, f"A chave {key} corresponde a mais de um cadastro.", owner="Comercial e cadastro")
            return None
        merchant = choices[0]
        if not valid_cnpj(merchant.get("cnpj")):
            self.issue("CNPJ_INVALIDO", row, ZERO, "CNPJ ausente ou sem os 14 dígitos necessários.", owner="Comercial e cadastro")
            return None
        if merchant.get("candidate") or not merchant.get("active", True):
            business = "CHECKOUT" if by_ec else "REMESSA"
            exposure_field = "reported_fee" if by_ec else "spread_brl"
            try:
                exposure = rounded(row.get(exposure_field))
            except (InvalidOperation, ValueError, TypeError):
                exposure = None
                self.issue("VALOR_INVALIDO", row, ZERO, "Valor financeiro inválido, exposição monetária indisponível.")
            # unique() has already collapsed economic duplicates, retaining every receipt.
            self.registration_groups[merchant["cnpj"]][(business, row["id"])] = {
                "row": deepcopy(row), "merchant": deepcopy(merchant), "business": business,
                "exposure": exposure, "exposure_basis": exposure_field,
            }
            return None
        return merchant

    def registration_issues(self):
        """One cause per exact merchant and period; all affected operations remain blocked."""
        kind = "CADASTRO_NAO_CONFIRMADO"
        rule = "Cadastro candidato ou inativo não autoriza faturamento; confirmar identidade e contrato vigente."
        reason = "Cadastro candidato ou inativo. As operações vinculadas permanecem sem faturamento até a confirmação da identidade e de contrato vigente."
        serialize = lambda value: json.dumps(value, ensure_ascii=False, sort_keys=True, default=str)
        provenance_fields = ("source_file", "source_ref", "physical_row", "source_id", "source_sha256", "source_receipt_id")
        for cnpj, members in sorted(self.registration_groups.items()):
            iid = uid("PEND", self.period, kind, cnpj)
            operations, evidence, fingerprints, traces = [], {}, [], []
            known, missing = ZERO, 0
            merchant = None
            for _, member in sorted(members.items()):
                row, merchant, exposure = member["row"], member["merchant"], member["exposure"]
                ref = row.get("source_ref") or row.get("ref_origem") or row["id"]
                origins = [{k: row.get(k) for k in provenance_fields}]
                origins.extend(row.get("provenances") or [])
                origins = sorted({serialize(origin): origin for origin in origins}.values(), key=serialize)
                # Both the displayed evidence and original provenance metadata participate in identity.
                for origin in origins:
                    item = {**deepcopy(origin), "arquivo": origin.get("source_file") or row.get("source_file", ""),
                            "ref": origin.get("source_ref") or ref,
                            "linha": origin.get("physical_row") if origin.get("physical_row") is not None else row.get("physical_row", "")}
                    evidence[serialize(item)] = item
                operation = {"id": row["id"], "ref": ref, "arquivo": row.get("source_file", ""),
                             "linha": row.get("physical_row", ""), "date": row.get("date") or row.get("contracted_date", ""),
                             "business": member["business"], "exposure_brl": money(exposure) if exposure is not None else None,
                             "exposure_basis": member["exposure_basis"]}
                operations.append(operation)
                if exposure is None: missing += 1
                else: known += exposure
                fingerprints.append({"operation": canonical_operation(row), "provenances": origins,
                                     "business": member["business"], "merchant": merchant})
                trace_row = {**row, "provenances": origins}
                traces.append((trace_row, exposure, operation))
            evidence = sorted(evidence.values(), key=serialize)
            self.issue_ids.add(iid)
            self.out["pendencias"].append({
                "id_saida": iid, "tipo": kind, "ref_origem": operations[0]["ref"],
                "valor_brl": money(known) if not missing else None, "motivo": reason,
                "quem_decide": "Comercial e cadastro", "severity": "bloqueante",
                "suggestion": "Confirmar identidade e cadastrar contrato vigente; recalcular para validar todas as operações.",
                "evidence": evidence, "rule": rule, "cnpj": cnpj, "merchant_name": merchant.get("name", ""),
                "group_scope": "merchant_period", "period": self.period,
                "operation_count": len(operations), "affected_operations": operations,
                "known_exposure_brl": money(known), "missing_exposure_count": missing,
                "exposure_status": "complete" if not missing else "unavailable" if missing == len(operations) else "partial",
                "source_fingerprint": hashlib.sha256(serialize({"period": self.period, "cnpj": cnpj,
                    "members": fingerprints, "evidence": evidence}).encode()).hexdigest(),
            })
            for row, exposure, operation in traces:
                self.trace(iid, row, exposure, rule,
                           "Exposição reportada por operação econômica; nenhuma receita reconhecida por esta pendência.",
                           motivo=reason, affected_operation=operation, group_scope="merchant_period", period=self.period)

    def rate(self, cnpj, product, when, row):
        choices = [rate for rate in self.data.get("rates", []) if rate.get("cnpj") == cnpj and rate.get("product") == product
                   and (not rate.get("start") or rate["start"] <= when) and (not rate.get("end") or when <= rate["end"])]
        if len(choices) != 1:
            self.issue("TAXA_SOBREPOSTA" if choices else "TAXA_AUSENTE", row, ZERO,
                       f"{len(choices)} contratos para {product}, CNPJ {cnpj}, data {when}. Linha não faturada.",
                       owner="Comercial", suggestion="Corrigir vigências sem sobreposição nem preenchimento por taxa antiga.", rule="Uma única taxa contratada por produto e data.", cnpj=cnpj)
            return None
        try:
            value = dec(choices[0]["rate_pct"])
            if value < 0:
                raise ValueError("Taxa contratada negativa.")
        except (InvalidOperation, ValueError, KeyError) as exc:
            self.issue("TAXA_INVALIDA", row, ZERO, str(exc), owner="Comercial")
            return None
        return choices[0]

    def divergence(self, row, merchant, business, contract, actual, difference, formula):
        did = uid("DIV", self.period, business, row["id"])
        self.out["divergencias"].append({"id_saida": did, "cnpj": merchant["cnpj"], "lojista": merchant["name"], "linha_negocio": business,
            "ref_origem": row["id"], "taxa_contratada_pct": str(contract["rate_pct"]), "taxa_aplicada_pct": format(actual, "f"),
            "diferenca_brl": money(difference), "produto": contract["product"], "vigencia_inicio": contract.get("start", ""), "vigencia_fim": contract.get("end", "")})
        self.trace(did, row, difference, "Comparar taxas percentuais, sem transformar truncamento em cobrança indevida.", formula, contract=contract)
        self.issue("DIVERGENCIA_TAXA", row, difference, f"Taxa aplicada {actual}% difere da contratada {contract['rate_pct']}% em {business}.",
            owner="Financeiro / parceiro", severity="atencao", suggestion="Contestar diferença integral; revisar encaminhamento antes de enviar.",
            rule=SLACK_SOURCE, divergence_id=did, cnpj=merchant["cnpj"])

    def checkout(self):
        source_rows = self.data.get("checkout", [])
        originals = {r.get("original_id") for r in source_rows if r.get("date", "")[:7] == self.period and r.get("original_id")}
        relevant_rows = [r for r in source_rows if r.get("date", "")[:7] == self.period or r.get("id") in originals]
        all_rows = self.unique(relevant_rows, "Orbe")
        # Historical evidence is indexed separately: it never enters monthly receipts or billing.
        history = self.data.get('history_checkout', [])
        candidates = defaultdict(dict)
        reversals = defaultdict(dict)
        for item in source_rows + history:
            if item.get('date', '')[:7] > self.period:
                continue
            candidates[item.get('id')].setdefault(operation_fingerprint(item), []).append(item)
            if item.get('type') in ('ESTORNO', 'REVERSAO ANTECIPACAO'):
                reversals[item.get('original_id')].setdefault(item.get('id'), {})[operation_fingerprint(item)] = item
        for row in all_rows:
            if row.get("date", "")[:7] != self.period:
                continue
            self.counts["checkout"] += 1
            merchant = self.merchant(row, True)
            if merchant is None:
                continue
            try:
                gross = dec(row["gross"])
                actual = dec(row["applied_rate_pct"])
                kind = row["type"]
                when = row.get("original_date") if kind in ("ESTORNO", "REVERSAO ANTECIPACAO") else row["date"]
                if kind not in ("VENDA", "ESTORNO", "ANTECIPACAO", "REVERSAO ANTECIPACAO"):
                    raise ValueError(f"Tipo de lançamento desconhecido: {kind}")
                if (kind in ("VENDA", "ANTECIPACAO") and gross <= 0) or (kind in ("ESTORNO", "REVERSAO ANTECIPACAO") and gross >= 0):
                    raise ValueError("Sinal do valor bruto incompatível com o tipo do lançamento.")
                if gross - dec(row["reported_fee"]) != dec(row["net"]):
                    raise ValueError("Bruto menos taxa reportada não coincide com o líquido da fonte.")
                if kind in ("ESTORNO", "REVERSAO ANTECIPACAO") and not when:
                    raise ValueError("Estorno/reversão sem data original.")
                if kind in ('ESTORNO', 'REVERSAO ANTECIPACAO'):
                    versions = candidates.get(row.get('original_id'), {})
                    if len(versions) > 1:
                        self.issue('ORIGINAL_AMBIGUO', [row] + [v for group in versions.values() for v in group], ZERO,
                                   'Operação original possui versões conflitantes; confirmar a versão correta.')
                        continue
                    if not versions:
                        self.issue('ORIGINAL_AUSENTE', row, ZERO,
                                   'Operação original não encontrada nas fontes atuais ou históricas. Confirmar vínculo e atributos; cálculo por data declarada, quando aplicável, é provisório.',
                                   suggestion='Importar a fonte histórica e criar nova versão para validar o vínculo.')
                        # The documented case prices prior-period refunds by their declared original date.
                        # Preserve that provisional calculation while making the missing evidence blocking.
                        if kind != 'ESTORNO' or when[:7] >= self.period:
                            continue
                    else:
                        copies = next(iter(versions.values()))
                        original = copies[0]
                        original_gross = dec(original['gross'])
                        expected = 'ANTECIPACAO' if kind == 'REVERSAO ANTECIPACAO' else 'VENDA'
                        compatible = (original.get('ec') == row.get('ec') and original.get('type') == expected
                                      and original.get('date') == when and when <= row['date'] and original_gross > 0
                                      and canonical_operation(original).get('modality') == canonical_operation(row).get('modality')
                                      and str(original.get('installments')) == str(row.get('installments'))
                                      and abs(gross) <= original_gross
                                      and original_gross - dec(original['reported_fee']) == dec(original['net']))
                        if kind == 'REVERSAO ANTECIPACAO': compatible &= gross == -original_gross
                        if not compatible:
                            self.issue('ORIGINAL_INCOMPATIVEL', [row, original], ZERO,
                                       'Original incompatível com EC, natureza, sinal, valor, modalidade, parcelas ou datas; linha retida.')
                            continue
                        accumulated = ZERO
                        contributing = []
                        conflict = False
                        for versions_of_reversal in reversals[row.get('original_id')].values():
                            if len(versions_of_reversal) != 1:
                                conflict = True
                                continue
                            reversal = next(iter(versions_of_reversal.values()))
                            if reversal.get('ec') == original.get('ec') and reversal.get('type') == kind:
                                try:
                                    reversal_gross = dec(reversal['gross'])
                                    contributing.append(reversal)
                                    if (reversal_gross >= 0 or reversal.get('original_date') != original.get('date')
                                            or reversal.get('date', '') < original.get('date', '')
                                            or canonical_operation(reversal).get('modality') != canonical_operation(original).get('modality')
                                            or str(reversal.get('installments')) != str(original.get('installments'))):
                                        conflict = True
                                    else:
                                        accumulated += abs(reversal_gross)
                                except (InvalidOperation, ValueError, KeyError): conflict = True
                        if conflict or accumulated > original_gross:
                            self.issue('REVERSAO_ACUMULADA_EXCEDENTE' if accumulated > original_gross else 'REVERSAO_ACUMULADA_AMBIGUA',
                                       [row, original] + contributing, ZERO, f'Reversões econômicas únicas acumuladas: {money(accumulated)}; bruto original: {money(original_gross)}. Revisão necessária.')
                            continue
                        row['original_evidence'] = {**original, 'provenances': [
                            {k: item.get(k) for k in ('source_file', 'source_id', 'source_sha256', 'physical_row')} for item in copies]}
                        row['original_resolution'] = 'current' if any(item in source_rows for item in copies) else 'historical'
                        row['accumulated_reversal_brl'] = money(accumulated)
                        row['reversal_evidence'] = contributing
                        if original.get('brand') != row.get('brand'):
                            self.issue('BANDEIRA_DIVERGENTE', [row, original], ZERO,
                                       'Bandeira difere da operação original. Alerta de qualidade; não altera tarifa ou cálculo.', severity='atencao')
                if "ANTECIPACAO" in kind:
                    product = "ANTECIPACAO"
                elif row["modality"] == "CREDITO PARCELADO":
                    n = row.get("installments")
                    if n is None or not 2 <= int(n) <= 12:
                        raise ValueError("Quantidade de parcelas fora das faixas contratuais.")
                    product = "CREDITO_2_6" if int(n) <= 6 else "CREDITO_7_12"
                else:
                    product = {"DEBITO": "DEBITO", "PIX": "PIX", "CREDITO A VISTA": "CREDITO_A_VISTA"}.get(row["modality"])
                    if not product:
                        raise ValueError("Modalidade não reconhecida.")
                contract = self.rate(merchant["cnpj"], product, when, row)
                if contract is None:
                    continue
                pct = dec(contract["rate_pct"])
                fee = rounded(gross * pct / 100)
                self.groups[(merchant["cnpj"], "CHECKOUT")].append((row, fee, "ROUND_HALF_UP(bruto × taxa contratada / 100, 2), com sinal", contract))
                if actual != pct:
                    self.divergence(row, merchant, "CHECKOUT", contract, actual, rounded(gross * (actual - pct) / 100), "ROUND_HALF_UP(bruto × (taxa aplicada − contratada) / 100, 2)")
            except (KeyError, ValueError, TypeError, InvalidOperation) as exc:
                self.issue("CHECKOUT_INVALIDO", row, ZERO, str(exc), rule="Linha inválida fica fora do faturamento até correção.")

    def remittances(self):
        relevant_rows = [r for r in self.data.get("remittances", []) if r.get("contracted_date", "")[:7] == self.period]
        for row in self.unique(relevant_rows, "Ponte Câmbio"):
            self.counts["remessa"] += 1
            merchant = self.merchant(row)
            if merchant is None:
                continue
            try:
                spread = dec(row["spread_brl"])
                if row.get("compliance") not in ("APROVADO", "APROVADO C/ RESSALVA"):
                    self.issue("COMPLIANCE_NAO_AUTORIZADO", row, spread, "Status fora dos dois estados autorizados pelo financeiro; comissão retida para revisão.", owner="Compliance e financeiro")
                    continue
                if spread < 0:
                    self.issue("SPREAD_NEGATIVO", row, spread, "Spread realizado negativo; excluído da comissão e da NF, sem compensar outras operações.",
                        owner="Financeiro / Ponte Câmbio", severity="atencao", suggestion="Contestar a operação de taxa travada e registrar a resposta.", rule=SLACK_SOURCE)
                contract = self.rate(merchant["cnpj"], "REMESSA", row["contracted_date"], row)
                if contract is None:
                    continue
                if spread >= 0:
                    commission = rounded(spread * Decimal("0.5"))
                    self.groups[(merchant["cnpj"], "REMESSA")].append((row, commission, "ROUND_HALF_UP(spread realizado positivo × 50%, 2); uma vez por operação", contract))
                actual = dec(row["applied_rate_pct"])
                pct = dec(contract["rate_pct"])
                if abs(actual - pct) > self.tolerance:
                    expected = rounded(dec(row["foreign_amount"]) * dec(row["ptax_rate"]) * pct / 100)
                    self.divergence(row, merchant, "REMESSA", contract, actual, rounded(spread - expected), "spread realizado − ROUND_HALF_UP(valor ME × PTAX × taxa contratada / 100, 2); diferença integral, não 50%")
            except (KeyError, ValueError, TypeError, InvalidOperation) as exc:
                self.issue("REMESSA_INVALIDA", row, ZERO, str(exc))

    def commissions_and_invoices(self):
        remittance_sources = []
        for (cnpj, business), entries in sorted(self.groups.items()):
            merchant = self.by_cnpj[cnpj][0]
            total = sum((entry[1] for entry in entries), ZERO)
            cid = uid("COM", self.period, cnpj, business)
            self.out["comissoes"].append({"id_saida": cid, "cnpj": cnpj, "lojista": merchant["name"], "linha_negocio": business, "comissao_brl": money(total), "quantidade_origens": len(entries)})
            for row, value, formula, contract in entries:
                self.trace(cid, row, value, contract.get("rule", SLACK_SOURCE), formula, contract=contract)
            if business == "REMESSA":
                remittance_sources.extend(entries)
                continue
            if total < 0:
                issue = self.issue("COMISSAO_NEGATIVA", [e[0] for e in entries], total, "Comissão líquida negativa. A isenção Casa segue a data original e não apaga estorno de agosto; nenhuma NF negativa emitida.",
                    owner="Financeiro e fiscal", severity="atencao", suggestion="Confirmar tratamento como crédito/ajuste fiscal; preservar o estorno anterior à isenção.", rule=SLACK_SOURCE + ": composição de vigência com data original", cnpj=cnpj)
                # Replace the aggregated issue trace with its complete transaction decomposition.
                self.out["rastro"] = [r for r in self.out["rastro"] if r["id_saida"] != issue]
                self.out["details"] = [r for r in self.out["details"] if r["id_saida"] != issue]
                for row, value, formula, contract in entries:
                    self.trace(issue, row, value, contract.get("rule", SLACK_SOURCE), formula)
            elif total > 0:
                iid = uid("NF", self.period, cnpj, business)
                self.out["notas"].append({"id_saida": iid, "tomador_cnpj": cnpj, "tomador": merchant["name"], "linha_negocio": business, "valor_brl": money(total), "discriminacao": f"MDR e antecipação, líquidos de estornos e reversões, competência {self.period}."})
                for row, value, formula, contract in entries:
                    self.trace(iid, row, value, contract.get("rule", SLACK_SOURCE), formula)
        total = sum((entry[1] for entry in remittance_sources), ZERO)
        if total > 0:
            iid = uid("NF", self.period, "75374179000146", "REMESSA")
            self.out["notas"].append({"id_saida": iid, "tomador_cnpj": "75374179000146", "tomador": "Ponte Câmbio S.A.", "linha_negocio": "REMESSA", "valor_brl": money(total), "discriminacao": f"Intermediação de câmbio {self.period}: participação de 50% no spread realizado positivo; inclui operações aprovadas com ressalva."})
            for row, value, formula, contract in remittance_sources:
                self.trace(iid, row, value, "EML e " + SLACK_SOURCE + ": NF da participação à Ponte Câmbio", formula)
            pending = self.issue("CONFERIR_REPASSE_PONTE", [entry[0] for entry in remittance_sources], total,
                "Conferir repasse da Ponte contra a NF. O valor exposto é o faturado; o valor efetivo da TED não é presumido. O EML prevê crédito em 06/10 mediante NF, mas o extrato de outubro não foi fornecido.",
                owner="Financeiro / Ponte Câmbio", severity="atencao", suggestion="Solicitar extrato e demonstrativo do repasse, conferir e registrar diferenças.", rule="EML e " + SLACK_SOURCE, invoice_id=iid)
            self.out["rastro"] = [r for r in self.out["rastro"] if r["id_saida"] != pending]
            self.out["details"] = [r for r in self.out["details"] if r["id_saida"] != pending]
            for row, value, formula, contract in remittance_sources:
                self.trace(pending, row, value, "Base faturada a conferir; não representa TED recebida.", formula)

    def bank(self):
        accounts = {a["code"]: a for a in self.data.get("accounts", []) if a.get("postable")}
        rows = self.unique([r for r in self.data.get("bank", []) if r.get("date", "")[:7] == self.period], "Extrato bancário")
        outgoing_aliases = {
            "ROTA GLOBAL INTERCAMBIO LT", "NOVO HORIZONTE INTERCAMBIO", "KIWI EXPERIENCE TURISMO LT", "ANDES EXPEDICÕES LTDA", "DUBLIN HUB INTERCAMBIO LTD",
            "SOL NASCENTE VIAGENS LTDA", "VELA TURISMO EDUCACIONAL L", "MUNDO ABERTO INTERCAMBIO L", "CASA DO ESTUDANTE VIAGENS", "EDU ABROAD CONSULTORIA LTD",
            "OXFORD PREP CURSOS LTDA", "BEM-VINDO EXCHANGE LTDA", "ESCOLA BRIDGE DE IDIOMAS L", "HORIZONTE VIAGENS E TURISM", "ATLAS IDIOMAS LTDA",
            "MAPLE STUDY ASSESSORIA EDU", "LISBOA CURSOS E VIAGENS LT", "TRILHA JOVEM TURISMO LTDA", "CANGURU INTERCAMBIOS LTDA", "FLUENTE IDIOMAS ONLINE LTD",
            "BAGAGEM LIVRE TURISMO LTDA", "CAMPUS GLOBAL LTDA",
        }
        incoming_aliases = {
            "BAGAGEM LIVRE TURISMO LT", "BEM-VINDO EXCHANGE LTDA", "CANGURU INTERCÂMBIOS LTD", "CASA DO ESTUDANTE VIAGEN", "DUBLIN HUB INTERCÂMBIO L",
            "EDU ABROAD CONSULTORIA L", "KIWI EXPERIENCE TURISMO", "LISBOA CURSOS E VIAGENS", "MAPLE STUDY ASSESSORIA E", "MUNDO ABERTO INTERCÂMBIO",
            "NORDICA EDUCACAO INTERNA", "NOVO HORIZONTE INTERCÂMB", "PONTE AEREA ESTUDANTIL L", "PONTE AÉREA ESTUDANTIL L", "ROTA GLOBAL INTERCÂMBIO",
        }
        valid_rows = []
        for row in rows:
            self.counts["bank"] += 1
            description = row.get("description", "").strip()
            try:
                amount = dec(row["amount"])
            except (InvalidOperation, ValueError, KeyError, TypeError):
                self.issue("BANCO_INVALIDO", row, ZERO, "Valor bancário inválido; não classificado e exposição indisponível.")
                continue
            valid_rows.append(row)
            bank = row["bank"]
            code = ""
            explanation = ""
            if "ORBE ADQUIRENCIA" in description and description.startswith("TED RECEBIDA"):
                code, explanation = "1.1.03.001", "Baixa de recebível Orbe, não receita do depósito."
            elif description.startswith("TRANSF ENTRE CONTAS") or "MESMA TITULARIDADE" in description:
                code, explanation = "1.1.09.001", "Transferência entre contas próprias, conta transitória."
            elif description.startswith("PIX ENVIADO CONTABILIDADE EXATA"):
                code, explanation = "4.2.06", "Serviço contábil do período, despesa direta."
            elif description.startswith("PIX ENVIADO ") and description.removeprefix("PIX ENVIADO ") in outgoing_aliases:
                code, explanation = "2.1.01.001", "Baixa de obrigação de repasse a lojista; alias exato do extrato."
            elif description.startswith("PIX RECEB ") and bank == "MERIDIANO" and description.removeprefix("PIX RECEB ") in incoming_aliases:
                code, explanation = "2.1.02.001", "Recursos recebidos de lojistas para remessas, passivo."
            elif description.startswith("TED ENVIADA PONTE CAMBIO"):
                code, explanation = "2.1.02.001", "Liquidação de recursos de lojistas junto à Ponte."
            elif description.startswith("TED RECEB PONTE CAMBIO") and "COMISSAO 08/2026" in description:
                code, explanation = "1.1.03.002", "Recebimento da comissão de agosto já provisionada."
            elif description.startswith("PAGTO SALARIOS") and "08/2026" in description:
                code, explanation = "2.1.04.001", "Baixa da folha de agosto já provisionada."
            elif description.startswith("PAGTO ISS") and "08/2026" in description:
                code, explanation = "2.1.03.003", "Baixa do ISS já provisionado."
            elif description.startswith("GPS INSS") and "08/2026" in description:
                code, explanation = "2.1.04.002", "Baixa de INSS já provisionado."
            elif description.startswith("GRF FGTS") and "08/2026" in description:
                code, explanation = "2.1.04.003", "Baixa de FGTS já provisionado."
            elif description.startswith("DEBITO DARF") and self.period == "2026-09":
                codes = {"0561": "2.1.03.004", "8109": "2.1.03.001", "2172": "2.1.03.002"}
                code = next((v for k, v in codes.items() if k in description), "")
                explanation = "Tributo já provisionado, conforme confirmação do financeiro para setembro."
            elif description.startswith("TAR ") or description.startswith("TARIFA "):
                code, explanation = "4.2.01", "Tarifa bancária do período."
            elif "CONDOMINIO" in description:
                code, explanation = "4.2.02", "Aluguel/condomínio, despesa direta."
            elif "AMAZON WEB SERVICES" in description:
                code, explanation = "4.2.03", "Cloud e infraestrutura, despesa direta."
            elif "GOOGLE WORKSPACE" in description:
                code, explanation = "4.2.04", "Software/assinatura, despesa direta."
            elif description.startswith("SEGURO EMPRESARIAL"):
                code, explanation = "4.2.05", "Seguro, despesa direta."
            elif description.startswith("IOF S/"):
                code, explanation = "4.3.01", "IOF de operação de crédito."
            elif description.startswith("APLICACAO AUTOMATICA") or description.startswith("RESGATE AUTOMATICO"):
                code, explanation = "1.1.02.001", "Movimento de principal de aplicação financeira, sem reconhecer o resgate como receita."
            elif description.startswith("RENDIMENTO APLIC"):
                code, explanation = "3.2.01", "Rendimento explicitamente identificado."
            elif "SEM IDENTIFICACAO" in description:
                code, explanation = "1.1.09.002", "Crédito não identificado, sem reconhecer receita."
                self.issue("CREDITO_NAO_IDENTIFICADO", row, amount, "Origem do PIX não identificada.", owner="Tesouraria", severity="atencao", suggestion="Identificar pagador e natureza; manter em conta transitória.", rule=SLACK_SOURCE)
            elif description.startswith("DEVOLUCAO PIX"):
                code, explanation = "2.1.01.001", "Repasse devolvido recompõe obrigação com lojista; motivo da devolução não identificado."
                self.issue("DEVOLUCAO_REPASSE", row, amount, "Repasse voltou; motivo e destino da nova tentativa dependem de confirmação.", owner="Operações e tesouraria", severity="atencao", suggestion="Confirmar motivo da devolução e obrigação com o lojista.", rule=SLACK_SOURCE)
            if not code or code not in accounts:
                code = ""
                self.issue("CLASSIFICACAO_PENDENTE", row, amount, "Descrição sem regra confirmada ou conta analítica indisponível.", owner="Contabilidade", rule="Não inventar contrapartida nem lançar em conta sintética.")
            output_id = uid("BANCO", self.period, bank, row["ref_origem"])
            self.out["lancamentos"].append({"id_saida": output_id, "banco": bank, "ref_origem": row["ref_origem"], "data": row["date"], "descricao": description,
                "valor": money(amount), "conta_codigo": code, "conta_descricao": accounts.get(code, {}).get("name", "Pendente"), "metodo": "REGRA", "confianca": "1.0" if code else "0.0",
                "regra": explanation, "conta_bancaria": "1.1.01.001" if bank == "AURORA" else "1.1.01.002", "contrapartida_sentido": "C" if amount > 0 else "D"})
            self.trace(output_id, row, amount, explanation or "Classificação pendente", "Valor assinado do extrato, sem alteração")
        # Pair transfer amounts exactly; September's missing credit is known to settle on October 1.
        outgoing = [r for r in valid_rows if r["bank"] == "AURORA" and r["description"].startswith("TRANSF ENTRE CONTAS")]
        credits = [r for r in valid_rows if r["bank"] == "MERIDIANO" and "MESMA TITULARIDADE" in r["description"]]
        used = set()
        for row in outgoing:
            candidates = [r for r in credits if r["id"] not in used and r["date"] == row["date"] and dec(r["amount"]) == -dec(row["amount"])]
            if len(candidates) == 1:
                used.add(candidates[0]["id"])
            else:
                known = row["date"] == "2026-09-30" and dec(row["amount"]) == Decimal("-300000")
                self.issue("TRANSFERENCIA_EM_TRANSITO", row, -dec(row["amount"]), "Transferência enviada sem crédito correspondente neste extrato." + (" Financeiro informou crédito em 01/10/2026." if known else ""),
                    owner="Tesouraria", severity="informativo" if known else "atencao", suggestion="Conciliar com o extrato da competência seguinte.", rule=SLACK_SOURCE if known else "Pareamento por data, valor e mesma titularidade.")

    def run(self):
        for warning in self.data.get("import_warnings", []):
            self.issue(warning.get("type", "IMPORTACAO"), warning, ZERO, warning.get("message", "Falha de importação"), rule="Arquivo preservado; linhas inválidas exigem correção.")
        self.checkout()
        self.remittances()
        self.registration_issues()
        self.commissions_and_invoices()
        self.bank()
        if not any(self.counts.values()):
            self.issue("COMPETENCIA_SEM_MOVIMENTOS", {"source_file": "Seleção de competência", "source_ref": self.period}, ZERO,
                f"Nenhum movimento importado pertence à competência {self.period}.", severity="bloqueante", suggestion="Importar as fontes da competência e recalcular antes de fechar.", rule="Ausência de movimentos não comprova fechamento completo.")
        business_total = lambda business: sum((dec(r["comissao_brl"]) for r in self.out["comissoes"] if r["linha_negocio"] == business), ZERO)
        self.out["summary"] = {"checkout_brl": money(business_total("CHECKOUT")), "remessa_brl": money(business_total("REMESSA")),
            "divergencias_brl": money(sum((dec(r["diferenca_brl"]) for r in self.out["divergencias"]), ZERO)),
            "divergencias_abs_brl": money(sum((abs(dec(r["diferenca_brl"])) for r in self.out["divergencias"]), ZERO)),
            "notas_brl": money(sum((dec(r["valor_brl"]) for r in self.out["notas"]), ZERO)),
            "checkout_count": self.counts["checkout"], "remessa_count": self.counts["remessa"], "bank_count": self.counts["bank"],
            "pendencias_count": len(self.out["pendencias"]), "divergencias_count": len(self.out["divergencias"]), "notas_count": len(self.out["notas"]),
            "period": self.period, "remittance_tolerance_pp": format(self.tolerance, "f")}
        self.out["parameters"] = self.params
        return self.out


def calculate(data, parameters=None):
    """Compute JSON-serializable official outputs; never mutate the source data."""
    return Closing(data, parameters).run()
