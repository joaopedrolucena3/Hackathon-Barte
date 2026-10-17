"""Gera um data pack sintético de outubro/2026 no mesmo formato do pack de setembro.

Os seis arquivos reproduzem o leiaute de cada sistema (Orbe, planilha de taxas, e-mail da
Ponte com XLSX anexo, plano de contas, extratos Aurora CSV e Meridiano OFX). A geração é
determinística (semente fixa) e injeta as exceções de CENARIOS, com IDs conhecidos, para
os testes verificarem como o agente reage a cada uma.

Uso, a partir de demo/back:
    python -m tools.gerar_pack_outubro [pasta_destino]
Padrão: ../../Tarvo_Data_Pack_out2026 (ao lado do pack de setembro).
"""
from __future__ import annotations

import csv
import io
import random
import re
import shutil
import sys
from copy import copy
from datetime import date, datetime, timedelta, timezone
from decimal import Decimal, ROUND_DOWN, ROUND_HALF_UP
from email.message import EmailMessage
from email.utils import format_datetime
from pathlib import Path

import openpyxl

from src.importer import load_data

ROOT = Path(__file__).resolve().parents[1]
SEPTEMBER = ROOT / "data" / "case"
DEFAULT_TARGET = ROOT.parents[1] / "Tarvo_Data_Pack_out2026"
SEED = 202610

ATLAS_EC = "1076801732"
UNKNOWN_EC = "1099887766"
CASA = "00520815000100"
ROTA = "95927868000148"
DUBLIN = "68567965000102"
EDU = "16181276000153"
VELA = "20987545000140"
BRIDGE = "22224579000109"
MUNDO = "17217888000111"
UNKNOWN_CNPJ = "11222333000181"

# ID -> (tipo de exceção esperado ou None, descrição). Os testes leem este catálogo.
CENARIOS = {
    # Orbe (checkout)
    "TX99000001": ("CHECKOUT_INVALIDO", "Bruto menos taxa diferente do líquido"),
    "TX99000002": ("CHECKOUT_INVALIDO", "Crédito parcelado em 14x, fora das faixas contratuais"),
    "TX99000003": ("CHECKOUT_INVALIDO", "Modalidade BOLETO não reconhecida"),
    "TX99000004": ("CHECKOUT_INVALIDO", "VENDA com valor bruto negativo"),
    "TX99000005": ("LINHA_INVALIDA", "Valor bruto ilegível no arquivo (1.234,5,6)"),
    "TX99000006": ("CADASTRO_AUSENTE", "EC novo, sem cadastro nem contrato"),
    "TX99000007": ("DUPLICIDADE", "Mesma transação repetida com conteúdo idêntico"),
    "TX99000008": ("DUPLICIDADE_CONFLITANTE", "Mesmo ID com valores diferentes"),
    "TX99000009": (None, "Linha de 30/09 no relatório de outubro: fora da competência"),
    "TX99000010": (None, "Estorno de venda de setembro da Bridge: usa 2,59% da data original"),
    "TX99000011": ("DIVERGENCIA_TAXA", "Estorno de venda de setembro da Casa: Orbe devolve 2,69%, contrato isento"),
    "TX99000012": (None, "Venda de outubro que recebe estorno parcial válido"),
    "TX99000013": (None, "Estorno parcial válido da TX99000012"),
    "TX99000014": (None, "Venda de outubro usada nos estornos inválidos"),
    "TX99000015": ("CHECKOUT_INVALIDO", "Estorno com modalidade diferente da venda original"),
    "TX99000016": ("CHECKOUT_INVALIDO", "Estorno maior que a venda original"),
    "TX99000017": ("CHECKOUT_INVALIDO", "Estorno sem data da venda original"),
    "TX99000018": ("DIVERGENCIA_TAXA", "EduAbroad 7-12x após a troca de 16/10: Orbe ainda cobra 3,49%"),
    "TX99000019": ("DIVERGENCIA_TAXA", "Dublin Hub débito: Orbe cobra 1,39%, abaixo do contratado (diferença negativa)"),
    "AN99000001": (None, "Antecipação revertida integralmente (válida)"),
    "AN99000002": (None, "Reversão integral da AN99000001"),
    "AN99000003": (None, "Antecipação com reversão parcial"),
    "AN99000004": ("CHECKOUT_INVALIDO", "Reversão parcial de antecipação: sem política confirmada"),
    # Ponte Câmbio (remessa)
    "PC-1026-0050": ("DUPLICIDADE", "Operação reprocessada com conteúdo idêntico"),
    "PC-1026-0077": ("DUPLICIDADE_CONFLITANTE", "Mesma operação com spreads diferentes"),
    "PC-1026-0090": ("SPREAD_NEGATIVO", "Spread realizado negativo (trava vencida)"),
    "PC-1026-0101": ("COMPLIANCE_NAO_AUTORIZADO", "Status EM ANALISE, fora dos autorizados"),
    "PC-1026-0110": (None, "APROVADO C/ RESSALVA entra normalmente"),
    "PC-0926-0999": (None, "Contratada em 30/09: competência de setembro, fora de outubro"),
    "PC-1026-0120": (None, "Contratada em 31/10 e liquidada em 03/11: entra em outubro"),
    "PC-1026-0901": ("CADASTRO_AUSENTE", "Cliente com CNPJ sem cadastro"),
}
# Linhas de extrato injetadas (descrição -> tipo esperado).
BANCO = {
    "PIX ENVIADO GRAFICA RAPIDA LTDA": "CLASSIFICACAO_PENDENTE",
    "PIX ENVIADO NOVA ESCOLA INTERCAMBIO": "CLASSIFICACAO_PENDENTE",
    "TAR MANUTENCAO CONTA": "LINHA_INVALIDA",
}

CENT = Decimal("0.01")


def br(value: Decimal) -> str:
    return format(value.quantize(CENT), "f").replace(".", ",")


def br_thousands(value: Decimal) -> str:
    sign = "-" if value < 0 else ""
    whole, frac = format(abs(value).quantize(CENT), "f").split(".")
    return f"{sign}{int(whole):,}".replace(",", ".") + "," + frac


def dmy(day: date) -> str:
    return day.strftime("%d/%m/%Y")


def truncate(value: Decimal) -> Decimal:
    # A Orbe trunca a taxa em centavos (em direção a zero), como no relatório de setembro.
    return value.quantize(CENT, rounding=ROUND_DOWN)


class Rates:
    """Taxas de setembro (via importador) mais as mudanças da tabela de outubro."""

    def __init__(self, data):
        self.rates = data["rates"]

    def get(self, cnpj, product, when: date) -> Decimal:
        if cnpj == EDU and product == "CREDITO_7_12" and when >= date(2026, 10, 16):
            return Decimal("3.29")
        if cnpj == VELA and product == "CREDITO_A_VISTA" and when >= date(2026, 10, 10):
            return Decimal("2.49")
        text = when.isoformat()
        hits = [r for r in self.rates if r["cnpj"] == cnpj and r["product"] == product
                and (not r["start"] or r["start"] <= text) and (not r["end"] or text <= r["end"])]
        assert len(hits) == 1, (cnpj, product, when, hits)
        return Decimal(hits[0]["rate_pct"])


def orbe(data, rates, rng):
    sept = list(csv.DictReader(io.StringIO((SEPTEMBER / "01_orbe_relatorio_comissoes_set2026.csv").read_text("utf-8-sig")), delimiter=";"))
    names = {}
    for row in sept:
        names.setdefault(row["cod_estabelecimento"], row["nome_estabelecimento"])
    by_ec = {m["ec"]: m for m in data["merchants"] if m.get("ec") and not m.get("candidate") and m.get("active", True)}
    header = list(sept[0].keys())
    rows = []
    seq = iter(range(89000001, 89999999))

    def line(ident, day, ec, kind, modality, installments, brand, gross, applied, fee=None, net=None, ref="", original=""):
        fee = truncate(gross * applied / 100) if fee is None else fee
        net = gross - fee if net is None else net
        return {"id_transacao": ident, "data_movimento": dmy(day), "cod_estabelecimento": ec, "nome_estabelecimento": names.get(ec, "NOVA ESCOLA INTERCAMBIO"),
                "tipo_lancamento": kind, "modalidade": modality, "qtd_parcelas": installments, "bandeira": brand,
                "valor_bruto": br(gross), "taxa_aplicada_pct": br(applied), "valor_taxa": br(fee), "valor_liquido": br(net),
                "id_referencia": ref, "data_venda_original": original}

    def product_of(modality, installments):
        if modality == "CREDITO PARCELADO":
            return "CREDITO_2_6" if installments <= 6 else "CREDITO_7_12"
        return {"DEBITO": "DEBITO", "PIX": "PIX", "CREDITO A VISTA": "CREDITO_A_VISTA"}[modality]

    def applied_for(cnpj, product, day):
        contracted = rates.get(cnpj, product, day)
        if cnpj == CASA:
            return Decimal("0")  # Orbe passou a aplicar a isenção em outubro.
        if cnpj == ROTA and product.startswith("CREDITO"):
            return contracted + Decimal("0.50")  # Orbe segue com a tabela errada da Rota.
        if cnpj == EDU and product == "CREDITO_7_12" and day >= date(2026, 10, 16):
            return Decimal("3.29")
        return contracted

    # Vendas normais: a Orbe aplica a taxa contratada (exceto Rota) e trunca a taxa.
    modalities = ["CREDITO A VISTA"] * 3 + ["CREDITO PARCELADO"] * 5 + ["PIX", "DEBITO"]
    brands = ["VISA", "MASTERCARD", "ELO", "AMEX", "HIPERCARD"]
    for ec in sorted(by_ec):
        cnpj = by_ec[ec]["cnpj"]
        for _ in range(rng.randint(18, 34)):
            day = date(2026, 10, rng.randint(1, 31))
            modality = rng.choice(modalities)
            installments = rng.randint(2, 12) if modality == "CREDITO PARCELADO" else 1
            gross = Decimal(rng.randint(15000, 600000)) / 100
            if cnpj == EDU and modality == "CREDITO PARCELADO" and installments >= 7 and day >= date(2026, 10, 16):
                installments = 6  # o caso de EduAbroad após a troca fica só no cenário TX99000018
            product = product_of(modality, installments)
            rows.append(line(f"TX{next(seq)}", day, ec, "VENDA", modality, installments,
                             "" if modality == "PIX" else rng.choice(brands), gross, applied_for(cnpj, product, day)))
    # Antecipações normais.
    for ec in sorted(by_ec)[:4]:
        gross = Decimal(rng.randint(2000000, 6000000)) / 100
        rows.append(line(f"AN{next(seq)}", date(2026, 10, rng.randint(1, 28)), ec, "ANTECIPACAO", "", "", "", gross, Decimal("2.10") if by_ec[ec]["cnpj"] != CASA else Decimal("0")))
    # Atlas segue sem contrato confirmado.
    for _ in range(20):
        gross = Decimal(rng.randint(15000, 300000)) / 100
        rows.append(line(f"TX{next(seq)}", date(2026, 10, rng.randint(1, 31)), ATLAS_EC, "VENDA", "CREDITO A VISTA", 1, rng.choice(brands), gross, Decimal("2.99")))

    # ---------- cenários com ID fixo ----------
    rota_ec = next(ec for ec, m in by_ec.items() if m["cnpj"] == ROTA)
    dub_ec = next(ec for ec, m in by_ec.items() if m["cnpj"] == DUBLIN)
    edu_ec = next(ec for ec, m in by_ec.items() if m["cnpj"] == EDU)
    oct5, oct20 = date(2026, 10, 5), date(2026, 10, 20)
    g = Decimal("1000.00")
    rows.append(line("TX99000001", oct5, dub_ec, "VENDA", "CREDITO A VISTA", 1, "VISA", g, Decimal("2.59"), fee=Decimal("25.90"), net=Decimal("970.10")))
    rows.append(line("TX99000002", oct5, dub_ec, "VENDA", "CREDITO PARCELADO", 14, "VISA", g, Decimal("3.79")))
    rows.append(line("TX99000003", oct5, dub_ec, "VENDA", "BOLETO", 1, "", g, Decimal("1.49")))
    rows.append(line("TX99000004", oct5, dub_ec, "VENDA", "CREDITO A VISTA", 1, "ELO", -g, Decimal("2.59")))
    bad = line("TX99000005", oct5, dub_ec, "VENDA", "CREDITO A VISTA", 1, "ELO", g, Decimal("2.59"))
    bad["valor_bruto"] = "1.234,5,6"
    rows.append(bad)
    rows.append(line("TX99000006", oct5, UNKNOWN_EC, "VENDA", "CREDITO A VISTA", 1, "VISA", g, Decimal("2.69")))
    dup = line("TX99000007", oct5, dub_ec, "VENDA", "PIX", 1, "", Decimal("850.00"), Decimal("0.89"))
    rows += [dup, dict(dup)]
    rows.append(line("TX99000008", oct5, dub_ec, "VENDA", "PIX", 1, "", Decimal("400.00"), Decimal("0.89")))
    rows.append(line("TX99000008", oct5, dub_ec, "VENDA", "PIX", 1, "", Decimal("440.00"), Decimal("0.89")))
    rows.append(line("TX99000009", date(2026, 9, 30), dub_ec, "VENDA", "PIX", 1, "", Decimal("300.00"), Decimal("0.89")))
    # Estornos de vendas de setembro (ausentes do arquivo de outubro).
    bridge_sale = next(r for r in sept if r["cod_estabelecimento"] == "1075624862" and r["tipo_lancamento"] == "VENDA"
                       and r["modalidade"] == "CREDITO A VISTA" and r["data_movimento"] <= "14/09/2026" and r["taxa_aplicada_pct"] == "2,59")
    bg = -Decimal(bridge_sale["valor_bruto"].replace(",", "."))
    rows.append(line("TX99000010", date(2026, 10, 7), "1075624862", "ESTORNO", "CREDITO A VISTA", 1, bridge_sale["bandeira"], bg, Decimal("2.59"),
                     ref=bridge_sale["id_transacao"], original=bridge_sale["data_movimento"]))
    casa_sale = next(r for r in sept if r["cod_estabelecimento"] == "1018325654" and r["tipo_lancamento"] == "VENDA" and r["modalidade"] == "CREDITO A VISTA")
    cg = -Decimal(casa_sale["valor_bruto"].replace(",", "."))
    rows.append(line("TX99000011", date(2026, 10, 8), "1018325654", "ESTORNO", "CREDITO A VISTA", 1, casa_sale["bandeira"], cg, Decimal("2.69"),
                     ref=casa_sale["id_transacao"], original=casa_sale["data_movimento"]))
    # Estornos de vendas presentes no arquivo.
    rows.append(line("TX99000012", oct5, dub_ec, "VENDA", "CREDITO PARCELADO", 4, "VISA", Decimal("2400.00"), Decimal("3.19")))
    rows.append(line("TX99000013", oct20, dub_ec, "ESTORNO", "CREDITO PARCELADO", 4, "VISA", Decimal("-600.00"), Decimal("3.19"), ref="TX99000012", original=dmy(oct5)))
    rows.append(line("TX99000014", oct5, dub_ec, "VENDA", "CREDITO A VISTA", 1, "MASTERCARD", Decimal("500.00"), Decimal("2.59")))
    rows.append(line("TX99000015", oct20, dub_ec, "ESTORNO", "DEBITO", 1, "MASTERCARD", Decimal("-500.00"), Decimal("1.49"), ref="TX99000014", original=dmy(oct5)))
    rows.append(line("TX99000016", oct20, dub_ec, "ESTORNO", "CREDITO A VISTA", 1, "MASTERCARD", Decimal("-700.00"), Decimal("2.59"), ref="TX99000014", original=dmy(oct5)))
    rows.append(line("TX99000017", oct20, dub_ec, "ESTORNO", "CREDITO A VISTA", 1, "MASTERCARD", Decimal("-100.00"), Decimal("2.59"), ref="TX99000014", original=""))
    rows.append(line("TX99000018", date(2026, 10, 16), edu_ec, "VENDA", "CREDITO PARCELADO", 10, "ELO", Decimal("3000.00"), Decimal("3.49")))
    rows.append(line("TX99000019", oct5, dub_ec, "VENDA", "DEBITO", 1, "VISA", Decimal("2000.00"), Decimal("1.39")))
    # Antecipação e reversões.
    rows.append(line("AN99000001", date(2026, 10, 3), rota_ec, "ANTECIPACAO", "", "", "", Decimal("30000.00"), Decimal("2.10")))
    rows.append(line("AN99000002", date(2026, 10, 6), rota_ec, "REVERSAO ANTECIPACAO", "", "", "", Decimal("-30000.00"), Decimal("2.10"), ref="AN99000001", original="03/10/2026"))
    rows.append(line("AN99000003", date(2026, 10, 9), rota_ec, "ANTECIPACAO", "", "", "", Decimal("20000.00"), Decimal("2.10")))
    rows.append(line("AN99000004", date(2026, 10, 12), rota_ec, "REVERSAO ANTECIPACAO", "", "", "", Decimal("-5000.00"), Decimal("2.10"), ref="AN99000003", original="09/10/2026"))

    rows.sort(key=lambda r: (r["data_movimento"][6:] + r["data_movimento"][3:5] + r["data_movimento"][:2], r["id_transacao"]))
    out = io.StringIO()
    writer = csv.DictWriter(out, fieldnames=header, delimiter=";", lineterminator="\r\n")
    writer.writeheader()
    writer.writerows(rows)
    return out.getvalue().encode("ascii")


def tabela(target):
    book = openpyxl.load_workbook(SEPTEMBER / "02_tabela_taxas_contratadas.xlsx")
    sheet = book["Taxas vigentes"]
    sheet["A2"] = "Última atualização: 08/10 - Bia"

    def find(prefix):
        return next(r for r in range(1, sheet.max_row + 1) if str(sheet.cell(r, 1).value or "").startswith(prefix))

    def clone_below(row, values):
        sheet.insert_rows(row + 1)
        for col in range(1, sheet.max_column + 1):
            src, dst = sheet.cell(row, col), sheet.cell(row + 1, col)
            dst.value, dst.number_format = src.value, src.number_format
            dst.font, dst.fill, dst.border, dst.alignment = copy(src.font), copy(src.fill), copy(src.border), copy(src.alignment)
        for col, value in values.items():
            sheet.cell(row + 1, col).value = value

    # Troca no meio do mês: EduAbroad 7-12x cai para 3,29% a partir de 16/10.
    edu = find("EduAbroad")
    sheet.cell(edu, 11).value, sheet.cell(edu, 12).value = "até 15/10/2026", "renegociado - ver linha de baixo"
    clone_below(edu, {1: "EduAbroad (NOVA)", 7: 0.0329, 11: "a partir de 16/10/2026", 12: "só mudou o 7-12x"})
    # Vigência sobreposta: nova linha da Vela sem encerrar a antiga.
    vela = find("Vela")
    clone_below(vela, {1: "Vela (NOVA)", 5: 0.0249, 11: "a partir de 10/10/2026", 12: "renegociado em out/26"})
    book.properties.created = book.properties.modified = datetime(2026, 10, 8, 9, 0)
    book.save(target / "02_tabela_taxas_contratadas.xlsx")


def ponte(data, rates, rng):
    remessa = sorted({r["cnpj"] for r in data["rates"] if r["product"] == "REMESSA"})
    names = {m["cnpj"]: m["name"].upper()[:20] for m in data["merchants"]}
    ptax = {"USD": 5.41, "EUR": 6.02, "GBP": 7.15, "CAD": 3.95, "AUD": 3.58, "NZD": 3.24}
    ops = []

    def op(ident, contracted, settled, cnpj, spread_pct, status="APROVADO", obs=None, spread_override=None, currency=None):
        currency = currency or rng.choice(list(ptax))
        foreign = Decimal(rng.randint(150000, 900000)) / 100
        ref = Decimal(str(round(ptax[currency] * (1 + rng.uniform(-0.01, 0.01)), 4)))
        client = (ref * (1 + spread_pct)).quantize(Decimal("0.0001"))
        brl = (foreign * client).quantize(CENT, ROUND_HALF_UP)
        spread = (foreign * ref * spread_pct).quantize(CENT, ROUND_HALF_UP) if spread_override is None else spread_override
        estimate = (spread * Decimal(str(round(rng.uniform(0.9, 1.1), 3)))).quantize(CENT, ROUND_HALF_UP)
        iof = (brl * Decimal("0.0038")).quantize(CENT, ROUND_HALF_UP)
        doc = f"{cnpj[:2]}.{cnpj[2:5]}.{cnpj[5:8]}/{cnpj[8:12]}-{cnpj[12:]}" if rng.random() < 0.5 else cnpj
        return [ident, datetime.combine(contracted, datetime.min.time()), datetime.combine(settled, datetime.min.time()), doc,
                names.get(cnpj, "ESCOLA SEM CADASTRO"), currency, float(foreign), float(client), float(ref), float(brl), float(spread),
                float(spread_pct.quantize(Decimal("0.000001"))), float(estimate), float(iof), status, obs]

    for n in range(1, 141):
        cnpj = remessa[(n - 1) % len(remessa)]
        day = date(2026, 10, rng.randint(1, 30))
        contract = rates.get(cnpj, "REMESSA", day) / 100
        # Mundo Aberto segue sendo cobrada a 1,5% (contrato 1,2%); demais com ruído de cotação de até 0,0015 pp.
        pct = Decimal("0.015") if cnpj == MUNDO else contract + Decimal(rng.randint(-15, 15)) / 1000000
        ops.append(op(f"PC-1026-{n:04d}", day, day + timedelta(days=1), cnpj, pct))
    by_id = {o[0]: o for o in ops}
    first = remessa[0] if remessa[0] != MUNDO else remessa[1]
    dup = list(by_id["PC-1026-0050"]); dup[15] = "reprocessada"
    ops.insert(ops.index(by_id["PC-1026-0050"]) + 1, dup)
    conflict = list(by_id["PC-1026-0077"]); conflict[10] = round(conflict[10] + 150.0, 2)
    ops.insert(ops.index(by_id["PC-1026-0077"]) + 1, conflict)
    neg = op("PC-1026-0090", date(2026, 10, 14), date(2026, 10, 15), first, Decimal("-0.004"), obs="taxa travada vencida")
    ops[ops.index(by_id["PC-1026-0090"])] = neg
    by_id["PC-1026-0101"][14] = "EM ANALISE"
    by_id["PC-1026-0110"][14] = "APROVADO C/ RESSALVA"
    ops.append(op("PC-0926-0999", date(2026, 9, 30), date(2026, 10, 1), first, rates.get(first, "REMESSA", date(2026, 9, 30)) / 100))
    by_id["PC-1026-0120"][1], by_id["PC-1026-0120"][2] = datetime(2026, 10, 31), datetime(2026, 11, 3)
    ops.append(op("PC-1026-0901", date(2026, 10, 22), date(2026, 10, 23), UNKNOWN_CNPJ, Decimal("0.015")))

    book = openpyxl.Workbook()
    sheet = book.active
    sheet.title = "Operações"
    sheet.append(["PONTE CÂMBIO S.A. - Relatório Mensal de Operações por Parceiro"])
    sheet.append(["Parceiro: TARVO PAGAMENTOS LTDA  |  CNPJ 84.626.315/0001-39"])
    sheet.append(["Competência: 10/2026  |  Gerado em 03/11/2026 07:12"])
    sheet.append([])
    sheet.append(["Nº Operação", "Data Contratação", "Data Liquidação", "CNPJ Cliente", "Cliente", "Moeda", "Valor ME", "Taxa Cliente", "PTAX Ref.",
                  "Valor R$", "Spread R$", "Spread %", "Spread Estimado R$ (D-1)", "IOF R$", "Status Compliance", "Observação"])
    for row in ops:
        sheet.append(row)
    summary = book.create_sheet("Resumo")
    summary.append(["Moeda", "Qtd", "Volume ME", "Spread R$"])
    for currency in ptax:
        chosen = [o for o in ops if o[5] == currency]
        summary.append([currency, len(chosen), round(sum(o[6] for o in chosen), 2), round(sum(o[10] for o in chosen), 2)])
    book.properties.created = book.properties.modified = datetime(2026, 11, 3, 7, 12)
    payload = io.BytesIO()
    book.save(payload)

    msg = EmailMessage()
    msg["From"] = "Relatórios Ponte Câmbio <relatorios@pontecambio.com.br>"
    msg["To"] = "financeiro@tarvo.com.br"
    msg["Cc"] = "comercial.parceiros@pontecambio.com.br"
    msg["Date"] = format_datetime(datetime(2026, 11, 3, 7, 15, 3, tzinfo=timezone(timedelta(hours=-3))))
    msg["Subject"] = "Relatório mensal de operações - TARVO - 10/2026"
    msg.set_content(
        "Prezados,\n\nSegue em anexo o relatório mensal de operações de câmbio do parceiro TARVO PAGAMENTOS referente à competência 10/2026.\n\n"
        "Conforme contrato de parceria, o repasse da participação de 50% (cinquenta por cento) do spread realizado será creditado em 06/11/2026, "
        "mediante recebimento da nota fiscal de intermediação.\n\n"
        "Lembramos que operações com status \"APROVADO C/ RESSALVA\" seguem normalmente para liquidação.\n\n"
        "Em caso de divergência, favor responder este e-mail em até 5 dias úteis.\n\n"
        "Atenciosamente,\nBackoffice Parceiros - Ponte Câmbio S.A. - CNPJ 75.374.179/0001-46\nEste é um e-mail automático.\n",
        cte="quoted-printable")
    msg.add_attachment(payload.getvalue(), maintype="application", subtype="vnd.openxmlformats-officedocument.spreadsheetml.sheet",
                       filename="PonteCambio_Relatorio_TARVO_102026.xlsx")
    return msg.as_bytes(policy=msg.policy.clone(linesep="\r\n"))


def aurora():
    text = (SEPTEMBER / "05a_extrato_banco_aurora_cc4471_set2026.csv").read_bytes().decode("utf-8")
    lines = text.split("\r\n")
    header, body = [], []
    for raw in lines:
        cells = raw.split(";")
        if re.fullmatch(r"\d{2}/09/2026", cells[0]) and cells[1] != "SALDO ANTERIOR":
            body.append(cells)
        elif not body and "SALDO ANTERIOR" not in raw:
            header.append(raw)
    opening = Decimal("-1920088.60")  # saldo final de setembro
    moves = []
    for cells in body:
        desc = cells[1].replace("08/2026", "09/2026")
        moves.append([cells[0][:3] + "10/2026", desc, cells[2], cells[3]])
    # Exceções injetadas.
    moves.append(["13/10/2026", "PIX ENVIADO GRAFICA RAPIDA LTDA", "", "-1.250,00"])
    moves.append(["14/10/2026", "PIX ENVIADO NOVA ESCOLA INTERCAMBIO", "", "-8.420,55"])
    moves.append(["15/10/2026", "TRANSF ENTRE CONTAS P/ BCO MERIDIANO AG 0091 CC 90233-5", "", "-200.000,00"])
    moves.append(["17/10/2026", "TAR MANUTENCAO CONTA", "", "12.3x4,00"])
    moves.sort(key=lambda m: m[0][6:] + m[0][3:5] + m[0][:2])
    balance = opening
    out = [h.replace("01/09/2026 a 30/09/2026", "01/10/2026 a 31/10/2026") for h in header]
    out.append(f"30/09/2026;SALDO ANTERIOR;;;{br_thousands(opening)}")
    for day, desc, doc, value in moves:
        try:
            balance += Decimal(value.replace(".", "").replace(",", "."))
            shown = br_thousands(balance)
        except ArithmeticError:
            shown = ""
        out.append(f"{day};{desc};{doc};{value};{shown}")
    out += [";;;;", f";SALDO FINAL;;;{br_thousands(balance)}", ";Os lançamentos estão sujeitos a confirmação.;;;", ""]
    return "\r\n".join(out).encode("utf-8")


def meridiano():
    text = (SEPTEMBER / "05b_extrato_banco_meridiano_cc90233_set2026.ofx").read_bytes().decode("cp1252")
    text = text.replace("20261001063000", "20261101063000").replace("<DTEND>20260930", "<DTEND>20261031")
    text = text.replace("MRD202609", "MRD202610").replace("08/2026", "09/2026")
    text = re.sub(r"(<DTPOSTED>|<DTSTART>|<DTASOF>)202609", r"\g<1>202610", text)
    text = text.replace("<DTASOF>20261030", "<DTASOF>20261031")
    # Repasse de setembro: a Ponte paga em 06/10 o valor da NF de setembro.
    text = re.sub(r"(<DTPOSTED>)20261004(\d{6}\[-3:BRT\]\s*<TRNAMT>)61884\.12", r"\g<1>20261006\g<2>39543.45", text)
    # Crédito de 01/10 da transferência de 30/09 (em trânsito em setembro).
    extra = ("<STMTTRN>\r\n<TRNTYPE>CREDIT\r\n<DTPOSTED>20261001120000[-3:BRT]\r\n<TRNAMT>300000.00\r\n<FITID>MRD2026109001\r\n"
             "<CHECKNUM>900001\r\n<MEMO>TED RECEBIDA TARVO PAGAMENTOS LTDA - MESMA TITULARIDADE\r\n</STMTTRN>\r\n")
    text = text.replace("<BANKTRANLIST>\r\n", "<BANKTRANLIST>\r\n" + extra, 1)
    # A transferência de 30/10 (cópia da de 30/09) chega no mesmo dia em outubro.
    extra2 = extra.replace("20261001", "20261030").replace("MRD2026109001", "MRD2026109002").replace("900001", "900002")
    text = text.replace("</BANKTRANLIST>", extra2 + "</BANKTRANLIST>", 1)
    amounts = [Decimal(a) for a in re.findall(r"<TRNAMT>([^\r\n<]+)", text)]
    closing = Decimal("1320453.26") + sum(amounts, Decimal("0"))
    text = re.sub(r"(<LEDGERBAL>\s*<BALAMT>)[^\r\n<]+", lambda m: m.group(1) + format(closing, "f"), text)
    return text.encode("cp1252")


LEIA_ME = """# Tarvo Pagamentos: data pack sintético (outubro/2026)

Gerado por `demo/back/tools/gerar_pack_outubro.py` a partir do leiaute do pack de setembro, com semente fixa.
Os dados são fictícios e servem para testar o agente num mês novo. As exceções injetadas, com IDs conhecidos,
estão no catálogo `CENARIOS` do gerador e são verificadas em `demo/back/tests/test_outubro.py`.

Mudanças de cadastro em outubro: EduAbroad 7-12x passa a 3,29% em 16/10; a Vela ganhou uma linha nova a partir de
10/10 sem encerrar a anterior (vigência sobreposta, de propósito). A Orbe passou a aplicar a isenção da Casa do Estudante.
"""


def main(target: Path = DEFAULT_TARGET):
    data = load_data(SEPTEMBER)
    rates = Rates(data)
    rng = random.Random(SEED)
    target.mkdir(parents=True, exist_ok=True)
    (target / "00_LEIA-ME.md").write_bytes(LEIA_ME.replace("\n", "\r\n").encode("utf-8"))
    (target / "01_orbe_relatorio_comissoes_out2026.csv").write_bytes(orbe(data, rates, rng))
    tabela(target)
    (target / "03_email_ponte_cambio_relatorio_out2026.eml").write_bytes(ponte(data, rates, rng))
    shutil.copyfile(SEPTEMBER / "04_plano_de_contas_fenix_erp.csv", target / "04_plano_de_contas_fenix_erp.csv")
    (target / "05a_extrato_banco_aurora_cc4471_out2026.csv").write_bytes(aurora())
    (target / "05b_extrato_banco_meridiano_cc90233_out2026.ofx").write_bytes(meridiano())
    return target


if __name__ == "__main__":
    print(main(Path(sys.argv[1]) if len(sys.argv) > 1 else DEFAULT_TARGET))
