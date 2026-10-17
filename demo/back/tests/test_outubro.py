"""Mês novo (outubro/2026, sintético): como o agente reage a cada exceção injetada.

O pack é gerado por tools/gerar_pack_outubro.py com semente fixa. Os valores esperados
abaixo são calculados a partir das linhas brutas e das regras do financeiro, sem usar o motor.
"""
from collections import defaultdict
from decimal import Decimal, ROUND_HALF_UP
from pathlib import Path
import tempfile
import time
import unittest

from src.engine import calculate
from src.importer import load_data
from src.pipeline.service import PipelineService, ServiceError
from tools.gerar_pack_outubro import BANCO, CENARIOS, CASA, DUBLIN, EDU, MUNDO, ROTA, VELA, main as gerar

ROOT = Path(__file__).resolve().parents[1]
PACK = ROOT.parents[1] / 'Tarvo_Data_Pack_out2026'
D = Decimal
# Pendência agregada que cita todas as operações de remessa como base da NF; não indica problema na operação.
AGREGADAS = {'CONFERIR_REPASSE_PONTE'}


def r2(value):
    return value.quantize(D('0.01'), rounding=ROUND_HALF_UP)


class OutubroTests(unittest.TestCase):
    @classmethod
    def setUpClass(cls):
        cls.temp = tempfile.TemporaryDirectory(prefix='tarvo-outubro-')
        cls.generated = gerar(Path(cls.temp.name) / 'Tarvo_Data_Pack_out2026')
        cls.data = load_data(cls.generated)
        cls.out = calculate(cls.data)
        cls.by_ref = defaultdict(list)
        for issue in cls.out['pendencias']:
            for evidence in issue['evidence']:
                cls.by_ref[evidence['ref']].append(issue)
        cls.rows = {r['id']: r for r in cls.data['checkout']}

    @classmethod
    def tearDownClass(cls):
        cls.temp.cleanup()

    def kinds(self, ref):
        return {i['tipo'] for i in self.by_ref.get(ref, []) if i['tipo'] not in AGREGADAS}

    def billed(self, business):
        """Refs que entraram na comissão (rastro das linhas COM-), com a taxa contratada usada."""
        ids = {c['id_saida'] for c in self.out['comissoes'] if c['linha_negocio'] == business}
        return {d['ref_origem']: d for d in self.out['details'] if d['id_saida'] in ids}

    def test_pack_versionado_e_reproduzivel(self):
        """O pack versionado é o que o gerador produz hoje: mesmas linhas em todos os arquivos."""
        committed = load_data(PACK)
        for key in ('checkout', 'remittances', 'bank', 'rates', 'merchants', 'accounts', 'import_warnings'):
            strip = lambda rows: [{k: v for k, v in r.items() if k not in ('source_file', 'path')} for r in rows]
            self.assertEqual(strip(committed[key]), strip(self.data[key]), key)

    def test_competencia_outubro_sem_linhas_de_setembro(self):
        """A competência é outubro; linhas datadas/contratadas em setembro ficam fora do cálculo e do rastro."""
        self.assertEqual(self.out['summary']['period'], '2026-10')
        refs = {r['ref_origem'] for r in self.out['rastro']}
        self.assertNotIn('TX99000009', refs)
        self.assertNotIn('PC-0926-0999', refs)

    def test_cada_cenario_gera_a_excecao_esperada(self):
        """Cada exceção injetada vira pendência do tipo certo; cenários válidos não geram pendência."""
        for ref, (kind, description) in CENARIOS.items():
            if kind == 'LINHA_INVALIDA':
                continue  # coberto em test_linha_ilegivel_vira_pendencia_legivel (referência é a linha física)
            with self.subTest(ref=ref, cenario=description):
                if kind:
                    self.assertIn(kind, self.kinds(ref))
                else:
                    self.assertEqual(self.kinds(ref), set())

    def test_excecoes_nao_sao_resolvidas_automaticamente(self):
        """Linha inválida, duplicata conflitante, cadastro ausente e compliance não entram na comissão."""
        checkout, remessa = self.billed('CHECKOUT'), self.billed('REMESSA')
        for ref in ('TX99000001', 'TX99000002', 'TX99000003', 'TX99000004', 'TX99000006', 'TX99000008',
                    'TX99000015', 'TX99000016', 'TX99000017', 'AN99000004'):
            self.assertNotIn(ref, checkout, ref)
        for ref in ('PC-1026-0077', 'PC-1026-0090', 'PC-1026-0101', 'PC-1026-0901'):
            self.assertNotIn(ref, remessa, ref)
        blocking = {i['tipo'] for i in self.out['pendencias'] if i['severity'] == 'bloqueante'}
        self.assertTrue({'CHECKOUT_INVALIDO', 'DUPLICIDADE_CONFLITANTE', 'CADASTRO_AUSENTE', 'TAXA_SOBREPOSTA',
                         'COMPLIANCE_NAO_AUTORIZADO', 'CADASTRO_NAO_CONFIRMADO', 'LINHA_INVALIDA'} <= blocking)

    def test_linha_ilegivel_vira_pendencia_legivel(self):
        """Valor ilegível no arquivo vira pendência bloqueante com mensagem clara e linha física, sem travar a importação."""
        invalid = [i for i in self.out['pendencias'] if i['tipo'] == 'LINHA_INVALIDA']
        self.assertEqual({i['evidence'][0]['arquivo'] for i in invalid},
                         {'01_orbe_relatorio_comissoes_out2026.csv', '05a_extrato_banco_aurora_cc4471_out2026.csv'})
        for issue in invalid:
            self.assertIn('Número financeiro ilegível', issue['motivo'])
            self.assertRegex(issue['ref_origem'], r'^L\d+$')
        self.assertNotIn('TX99000005', self.rows)

    def test_divergencias_com_sinal_e_valor_corretos(self):
        """Divergência = bruto × (aplicada − contratada); positiva quando a Orbe cobra a mais, negativa quando cobra a menos."""
        div = {d['ref_origem']: d for d in self.out['divergencias']}
        self.assertEqual(D(div['TX99000019']['diferenca_brl']), D('-2.00'))  # 2000 × (1,39 − 1,49)%
        self.assertEqual(D(div['TX99000018']['diferenca_brl']), D('6.00'))   # 3000 × (3,49 − 3,29)%
        casa = self.rows['TX99000011']
        self.assertEqual(D(div['TX99000011']['diferenca_brl']), r2(D(casa['gross']) * D('2.69') / 100))
        self.assertLess(D(div['TX99000011']['diferenca_brl']), 0)  # estorno devolve a taxa cobrada em setembro
        rota = [d for d in self.out['divergencias'] if d['cnpj'] == ROTA]
        self.assertTrue(rota)
        for item in rota:
            row = self.rows[item['ref_origem']]
            self.assertEqual(D(item['taxa_aplicada_pct']) - D(item['taxa_contratada_pct']), D('0.50'))
            self.assertEqual(D(item['diferenca_brl']), r2(D(row['gross']) * D('0.50') / 100))
        self.assertFalse([d for d in self.out['divergencias'] if d['cnpj'] == DUBLIN and d['ref_origem'] != 'TX99000019'])

    def test_casa_isenta_sem_nota_nem_divergencia_nova(self):
        """Orbe passou a aplicar a isenção da Casa: só o estorno de setembro diverge; sem NF nem comissão negativa."""
        casa_div = {d['ref_origem'] for d in self.out['divergencias'] if d['cnpj'] == CASA and d['linha_negocio'] == 'CHECKOUT'}
        self.assertEqual(casa_div, {'TX99000011'})
        self.assertFalse([n for n in self.out['notas'] if n['tomador_cnpj'] == CASA])
        self.assertFalse([i for i in self.out['pendencias'] if i['tipo'] == 'COMISSAO_NEGATIVA'])

    def test_troca_de_vigencia_no_meio_do_mes(self):
        """EduAbroad 7-12x: 3,49% até 15/10 e 3,29% a partir de 16/10, pela data de cada venda."""
        billed = self.billed('CHECKOUT')
        rows = [r for r in self.data['checkout'] if r['ec'] == '1020660828' and r['type'] == 'VENDA'
                and r['modality'] == 'CREDITO PARCELADO' and r['installments'] >= 7 and r['date'].startswith('2026-10')]
        self.assertTrue([r for r in rows if r['date'] < '2026-10-16'])
        self.assertTrue([r for r in rows if r['date'] >= '2026-10-16'])
        for row in rows:
            expected = '3.4900' if row['date'] < '2026-10-16' else '3.2900'
            self.assertEqual(D(billed[row['id']]['contract']['rate_pct']), D(expected), row['id'])

    def test_vigencia_sobreposta_bloqueia_sem_escolher_taxa(self):
        """Vela tem duas linhas vigentes a partir de 10/10: essas vendas não são faturadas; as anteriores são."""
        billed = self.billed('CHECKOUT')
        vela = [r for r in self.data['checkout'] if r['ec'] == '1086291869' and r['date'].startswith('2026-10')]
        before = [r for r in vela if r['date'] < '2026-10-10']
        after = [r for r in vela if r['date'] >= '2026-10-10']
        self.assertTrue(before and after)
        for row in before:
            self.assertIn(row['id'], billed)
        for row in after:
            self.assertNotIn(row['id'], billed)
            self.assertIn('TAXA_SOBREPOSTA', self.kinds(row['id']))

    def test_estorno_de_setembro_usa_taxa_da_data_original(self):
        """Estorno de venda da Bridge de setembro (ausente do arquivo) usa 2,59%, vigente na data original."""
        detail = self.billed('CHECKOUT')['TX99000010']
        self.assertEqual(D(detail['contract']['rate_pct']), D('2.59'))
        self.assertEqual(D(detail['valor']), r2(D(self.rows['TX99000010']['gross']) * D('2.59') / 100))

    def test_remessa_calculada_a_partir_das_linhas_brutas(self):
        """NF da Ponte = soma de HALF_UP(50% do spread) das operações únicas, autorizadas, cadastradas e de outubro."""
        known = {m['cnpj'] for m in self.data['merchants'] if not m.get('candidate')}
        counts = defaultdict(int)
        for op in self.data['remittances']:
            counts[op['id']] += 1
        seen, total = set(), D('0')
        conflicting = {'PC-1026-0077'}
        vela_overlap = {op['id'] for op in self.data['remittances'] if op['cnpj'] == VELA and op['contracted_date'] >= '2026-10-10'}
        for op in self.data['remittances']:
            if op['id'] in seen or op['id'] in conflicting or op['id'] in vela_overlap:
                continue
            seen.add(op['id'])
            if not op['contracted_date'].startswith('2026-10') or op['compliance'] not in ('APROVADO', 'APROVADO C/ RESSALVA'):
                continue
            if op['cnpj'] not in known or D(op['spread_brl']) < 0:
                continue
            total += r2(D(op['spread_brl']) * D('0.5'))
        nota = next(n for n in self.out['notas'] if n['tomador_cnpj'] == '75374179000146')
        self.assertEqual(D(nota['valor_brl']), total)
        mundo = [d for d in self.out['divergencias'] if d['cnpj'] == MUNDO and d['linha_negocio'] == 'REMESSA']
        self.assertTrue(mundo)
        for item in mundo:
            op = next(o for o in self.data['remittances'] if o['id'] == item['ref_origem'])
            expected = r2(D(op['foreign_amount']) * D(op['ptax_rate']) * D('1.2') / 100)
            self.assertEqual(D(item['diferenca_brl']), D(op['spread_brl']) - expected)  # valor cheio, não 50%

    def test_banco_sem_regra_vai_para_o_analista(self):
        """Todo lançamento tem conta analítica ou fica pendente; nada é classificado por aproximação."""
        accounts = {a['code'] for a in self.data['accounts'] if a['postable']}
        pending = {i['ref_origem'] for i in self.out['pendencias'] if i['tipo'] == 'CLASSIFICACAO_PENDENTE'}
        for entry in self.out['lancamentos']:
            if entry['conta_codigo']:
                self.assertIn(entry['conta_codigo'], accounts)
            else:
                self.assertIn(entry['ref_origem'], pending)
        by_desc = {e['descricao']: e for e in self.out['lancamentos']}
        for description, kind in BANCO.items():
            if kind == 'CLASSIFICACAO_PENDENTE':
                self.assertEqual(by_desc[description]['conta_codigo'], '', description)
        transit = [i for i in self.out['pendencias'] if i['tipo'] == 'TRANSFERENCIA_EM_TRANSITO']
        self.assertEqual([(i['valor_brl'], i['severity']) for i in transit], [('200000.00', 'atencao')])

    def test_regras_bancarias_de_setembro_nao_cobrem_outubro(self):
        """Limitação documentada: baixas de provisão e o repasse da Ponte só têm regra para 08/2026; em outubro viram pendência."""
        pending = {e['descricao'] for e in self.out['lancamentos'] if not e['conta_codigo']}
        self.assertTrue(any(d.startswith('PAGTO SALARIOS') and '09/2026' in d for d in pending))
        self.assertTrue(any(d.startswith('DEBITO DARF') for d in pending))
        self.assertTrue(any('PONTE CAMBIO' in d and 'COMISSAO 09/2026' in d for d in pending))

    def test_pipeline_outubro_para_na_aprovacao_humana(self):
        """O run de outubro termina em aprovação humana; bloqueantes impedem aprovar e o ERP não é exportado."""
        with tempfile.TemporaryDirectory(prefix='tarvo-outubro-run-') as temp:
            base = Path(temp)
            service = PipelineService(base / 'workflow.sqlite3', ROOT / 'data' / 'case', base / 'runs')
            try:
                created = service.start_run({'pipeline_id': 'fechamento-tarvo', 'competencia': '2026-10', 'source_dir': str(self.generated)}, 'Analista outubro')
                until = time.monotonic() + 60
                while (run := service.get_run(created['run_id']))['status'] not in ('awaiting_approval', 'failed', 'done') and time.monotonic() < until:
                    time.sleep(.05)
                self.assertEqual(run['status'], 'awaiting_approval')
                items = service.exceptions(run['id'], {'page_size': 500})['items']
                self.assertTrue([i for i in items if i['severidade'] == 'bloqueante' and i['tipo'] == 'TAXA_SOBREPOSTA'])
                with self.assertRaises(ServiceError):
                    service.approval(run['id'], {'decisao': 'aprovar', 'comentario': 'Tentativa com bloqueantes'}, 'Analista outubro')
                with self.assertRaises(ServiceError):
                    service.export(run["id"])
                service.approval(run['id'], {'decisao': 'reprovar', 'comentario': 'Encerrar run de teste'}, 'Analista outubro')
            finally:
                service.close()


if __name__ == '__main__':
    unittest.main()
