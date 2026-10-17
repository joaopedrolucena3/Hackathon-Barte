"""Evidence-based review guidance. Text never becomes an executable command.

Only explicitly listed, evidenced, non-blocking cases can retain the existing
calculation in a batch. Follow-ups remain pending even after that review.
"""
from copy import deepcopy
from decimal import Decimal, InvalidOperation
import json
from pathlib import Path

POLICY_VERSION = 'review-guidance-v1'


def capture_assumptions(root):
    """Called at run creation; callers preserve this exact content with the run."""
    path = Path(root) / 'docs' / 'assumptions.json'
    return deepcopy(json.loads(path.read_text(encoding='utf-8'))) if path.exists() else []


# Each entry names an actual review consequence, not a claimed external action.
POLICIES = {
    'DIVERGENCIA_TAXA': {
        'title': 'Manter o cálculo e encaminhar a diferença para contestação',
        'assumptions': ['H02', 'H14'],
        'rule': 'Checkout usa a taxa contratada; remessa usa a participação no spread realizado elegível. A divergência é acompanhada separadamente.',
        'reason': 'A diferença de taxa não altera automaticamente a comissão calculada nem autoriza desconto na nota.',
        'effect': 'Registra a revisão do alerta. Preserva os lançamentos, comissões e notas já calculados.',
        'follow_up': 'Preparar a contestação com a origem e a diferença; revisar destinatário e conteúdo antes do envio. A resposta do parceiro continua pendente.',
        'missing': [], 'batch': True,
    },
    'DUPLICIDADE': {
        'title': 'Manter a operação contabilizada uma única vez',
        'assumptions': ['H14'],
        'rule': 'Cópias idênticas da mesma operação contam uma vez. A operação válida não deve ser excluída junto com a cópia.',
        'reason': 'O motor já removeu a repetição do cálculo. Excluir o lançamento remanescente eliminaria também a operação válida.',
        'effect': 'Registra a revisão e mantém o cálculo único existente; não exclui lançamentos.',
        'follow_up': 'Solicitar ao fornecedor a correção da duplicidade no arquivo. O contato e a resposta permanecem pendentes.',
        'missing': [], 'batch': True,
    },
    'CADASTRO_NAO_CONFIRMADO': {
        'title': 'Aguardar identidade e contrato vigente antes de faturar',
        'assumptions': ['H03'],
        'rule': 'Cadastro candidato e taxa histórica não autorizam faturamento.',
        'reason': 'Falta confirmação comercial para estabelecer a identidade e o contrato aplicáveis à operação.',
        'effect': 'Mantém a pendência e o tratamento atual, sem criar comissão ou nota.',
        'follow_up': 'Comercial confirma identidade, vigência e taxa com documento; atualizar o cadastro e criar nova execução.',
        'missing': ['Identidade confirmada por chave exata', 'Contrato válido na data da operação'],
    },
    'ORIGINAL_AUSENTE': {
        'title': 'Obter a operação original e validar o vínculo',
        'assumptions': ['H13'],
        'rule': 'A taxa de estorno depende da data original. O cálculo provisório não comprova o vínculo ausente.',
        'reason': 'A operação original não foi encontrada. A política de dispensa dessa evidência ainda exige validação do financeiro.',
        'effect': 'Mantém o bloqueio e qualquer cálculo provisório existente; não confirma a origem.',
        'follow_up': 'Importar a fonte histórica por identificador exato e criar nova execução; se a fonte não existir, pedir decisão formal sobre a hipótese H13.',
        'missing': ['Operação original compatível ou decisão formal sobre a dispensa da evidência'],
    },
    'CREDITO_NAO_IDENTIFICADO': {
        'title': 'Manter em conta transitória até identificar o crédito',
        'assumptions': ['H05'],
        'rule': 'Uma entrada de caixa sem natureza comprovada não é receita confirmada.',
        'reason': 'O valor consta do extrato, mas pagador e natureza permanecem desconhecidos.',
        'effect': 'Preserva a classificação transitória e a pendência operacional.',
        'follow_up': 'Tesouraria obtém comprovante, identifica pagador e natureza e registra a evidência antes de reclassificar.',
        'missing': ['Pagador e natureza do crédito comprovados'],
    },
    'DEVOLUCAO_REPASSE': {
        'title': 'Confirmar a devolução antes de definir novo repasse',
        'assumptions': ['H05'],
        'rule': 'A devolução recompõe a obrigação; a causa e o novo destino precisam de confirmação.',
        'reason': 'Conhecer a contrapartida contábil não esclarece por que o repasse voltou.',
        'effect': 'Mantém a obrigação e a pendência; não inicia pagamento.',
        'follow_up': 'Operações e Tesouraria confirmam causa, beneficiário e dados válidos para o tratamento posterior.',
        'missing': ['Motivo da devolução', 'Beneficiário e destino confirmados'],
    },
    'TRANSFERENCIA_EM_TRANSITO': {
        'title': 'Conferir o crédito da transferência na conta de destino',
        'assumptions': ['H05', 'H06'],
        'rule': 'Uma saída sem crédito correspondente permanece em trânsito até evidência bancária.',
        'reason': 'A previsão ou informação de recebimento não substitui a linha do extrato de destino.',
        'effect': 'Preserva o tratamento transitório; não registra conciliação concluída.',
        'follow_up': 'Obter o extrato do destino e conferir identificador, data e valor antes de encerrar a pendência.',
        'missing': ['Crédito correspondente no extrato de destino'],
    },
    'CONFERIR_REPASSE_PONTE': {
        'title': 'Conferir a nota contra o repasse efetivamente recebido',
        'assumptions': ['H06'],
        'rule': 'O valor faturado não comprova o valor nem o recebimento da TED.',
        'reason': 'A conferência exige extrato e demonstrativo do parceiro na competência do recebimento.',
        'effect': 'Mantém a nota calculada e a conferência pendente; não presume liquidação.',
        'follow_up': 'Obter extrato e demonstrativo do repasse, comparar com a nota e registrar diferenças.',
        'missing': ['Extrato do recebimento', 'Demonstrativo da Ponte'],
    },
    'SPREAD_NEGATIVO': {
        'title': 'Preservar a exclusão da comissão e solicitar esclarecimento',
        'assumptions': ['H14'],
        'rule': 'Spread negativo não compõe comissão nem nota e não compensa outras operações.',
        'reason': 'A causa do resultado negativo precisa de esclarecimento do parceiro.',
        'effect': 'Mantém o tratamento já calculado e a pendência; não presume desconto em repasse futuro.',
        'follow_up': 'Contestar a operação e registrar a resposta da Ponte antes de qualquer tratamento adicional.',
        'missing': ['Resposta do parceiro sobre o spread negativo'],
    },
    'COMISSAO_NEGATIVA': {
        'title': 'Submeter o saldo negativo ao financeiro e fiscal',
        'assumptions': ['H01'],
        'rule': 'Vigência e data original são consideradas; saldo negativo não gera nota negativa nem transporte automático.',
        'reason': 'O tratamento de crédito ou ajuste fiscal depende de decisão explícita.',
        'effect': 'Preserva o cálculo e a pendência fiscal, sem emitir nota ou compensar saldo.',
        'follow_up': 'Financeiro e fiscal confirmam o alcance da isenção e o tratamento do saldo, com evidência.',
        'missing': ['Decisão documentada sobre o crédito ou ajuste fiscal'],
    },
    'CLASSIFICACAO_PENDENTE': {
        'title': 'Confirmar a natureza antes de escolher a contrapartida',
        'assumptions': ['H05', 'H10'],
        'rule': 'Usar conta analítica compatível com a natureza comprovada; não inventar contrapartida.',
        'reason': 'Não há regra suficiente para classificar o movimento.',
        'effect': 'Mantém o bloqueio; nenhuma conta ou receita é criada.',
        'follow_up': 'Contabilidade consulta documento de suporte, define conta analítica e registra a justificativa do ajuste.',
        'missing': ['Documento que comprove a natureza do movimento', 'Conta analítica validada'],
    },
}

CONFLICTS = {'DUPLICIDADE_CONFLITANTE', 'ORIGINAL_AMBIGUO', 'ORIGINAL_INCOMPATIVEL', 'REVERSAO_ACUMULADA_EXCEDENTE', 'REVERSAO_ACUMULADA_AMBIGUA', 'CADASTRO_AMBIGUO'}
CONTRACTS = {'TAXA_AUSENTE', 'TAXA_SOBREPOSTA', 'TAXA_INVALIDA', 'CADASTRO_AUSENTE', 'CNPJ_INVALIDO'}
KNOWN_AMOUNTS = {'DIVERGENCIA_TAXA', 'DUPLICIDADE', 'CADASTRO_NAO_CONFIRMADO', 'CREDITO_NAO_IDENTIFICADO', 'DEVOLUCAO_REPASSE', 'TRANSFERENCIA_EM_TRANSITO', 'CONFERIR_REPASSE_PONTE', 'SPREAD_NEGATIVO', 'COMISSAO_NEGATIVA', 'CLASSIFICACAO_PENDENTE'}


def _policy(kind):
    if kind in POLICIES:
        return deepcopy(POLICIES[kind])
    if kind in CONFLICTS:
        return {'title': 'Resolver as evidências conflitantes antes de decidir', 'assumptions': ['H13'] if 'ORIGINAL' in kind or 'REVERSAO' in kind else ['H14'],
                'rule': 'Nenhuma versão conflitante pode ser escolhida automaticamente.',
                'reason': 'Os registros não sustentam uma decisão única.',
                'effect': 'Mantém o bloqueio e os resultados existentes.',
                'follow_up': 'Solicitar ao responsável a versão correta e sua comprovação; importar as fontes e criar nova execução.',
                'missing': ['Versão correta identificada e comprovada']}
    if kind in CONTRACTS:
        return {'title': 'Corrigir a referência contratual ou cadastral', 'assumptions': ['H03', 'H12'],
                'rule': 'Identidade exata e uma taxa válida para a data são necessárias ao cálculo.',
                'reason': 'A referência está ausente, inválida ou ambígua.',
                'effect': 'Preserva o bloqueio; nenhuma taxa é presumida.',
                'follow_up': 'Comercial valida documento, chave e vigência; corrigir cadastro e criar nova execução.',
                'missing': ['Identidade e contrato inequívocos para a operação']}
    return {'title': 'Revisar a evidência com o responsável', 'assumptions': ['H14'],
            'rule': 'Casos sem política de ação confirmada exigem revisão individual.',
            'reason': 'Não existe ação automática validada para este tipo de ocorrência.',
            'effect': 'Mantém o estado e os valores atuais.',
            'follow_up': 'Consultar a origem e registrar a informação ou correção necessária antes de decidir.',
            'missing': ['Evidência e tratamento específicos validados pelo responsável']}


def _origins(issue):
    return deepcopy(issue.get('origens') or issue.get('evidence') or [])


def _origin_keys(issue):
    return {(str(e.get('arquivo', '')), str(e.get('ref', ''))) for e in _origins(issue) if isinstance(e, dict) and e.get('arquivo') and e.get('ref')}


def build_recommendations(exceptions, assumptions):
    """Return stable guidance for a completed run, with conservative eligibility."""
    known_assumptions = {a['id'] for a in assumptions}
    blockers = set().union(*(_origin_keys(e) for e in exceptions if e.get('severidade', e.get('severity')) == 'bloqueante' and e.get('status', 'open') == 'open')) if exceptions else set()
    result = []
    for issue in sorted(exceptions, key=lambda e: e.get('id', e.get('id_saida', ''))):
        kind = issue.get('tipo', '')
        policy = _policy(kind)
        evidence = _origins(issue)
        severity = issue.get('severidade', issue.get('severity', 'bloqueante'))
        missing = list(policy['missing'])
        has_evidence = bool(evidence) and all(isinstance(e, dict) and e.get('arquivo') and e.get('ref') for e in evidence)
        if not has_evidence:
            missing.append('Referência de origem verificável')
        if not issue.get('source_fingerprint'):
            missing.append('Identificação preservada do conteúdo da evidência')
        if any(key not in known_assumptions for key in policy['assumptions']):
            missing.append('Hipóteses vinculadas preservadas nesta execução')
        if policy.get('batch') and _origin_keys(issue) & blockers:
            missing.append('Resolver a ocorrência bloqueante que compartilha esta origem')
        raw_rule = issue.get('regra') or issue.get('rule')
        if policy.get('batch') and (not raw_rule or raw_rule == 'Revisão humana necessária'):
            missing.append('Regra de origem confirmada')
        eligible = bool(policy.get('batch') and severity in ('alerta', 'atencao') and not missing)
        exposure = None
        if kind in KNOWN_AMOUNTS:
            try:
                value = Decimal(str(issue.get('impacto_rs', issue.get('valor_brl'))))
                if value.is_finite():
                    exposure = format(value, '.2f')
            except (InvalidOperation, TypeError, ValueError):
                pass
        if policy.get('batch') and exposure is None:
            missing.append('Valor relacionado válido na origem')
            eligible = False
        identifier = issue.get('id', issue.get('id_saida', ''))
        result.append({
            'id': identifier, 'exception_id': identifier, 'kind': kind,
            'title': policy['title'], 'severity': severity,
            'fact': issue.get('descricao') or issue.get('motivo') or 'Ocorrência sem descrição suficiente.',
            'rule': policy['rule'], 'rule_source': raw_rule or 'Política conservadora de revisão',
            'assumption_ids': policy['assumptions'], 'evidence': evidence,
            'source_fingerprint': issue.get('source_fingerprint'),
            'suggested_action': 'accept' if eligible else 'wait', 'eligible': eligible,
            'reason': policy['reason'], 'effect': policy['effect'],
            'owner': issue.get('quem_decide') or issue.get('who_decides') or 'Financeiro Tarvo',
            'missing_evidence': missing, 'follow_up': policy['follow_up'],
            'exposure_brl': exposure,
            **{key: deepcopy(issue[key]) for key in ('group_scope', 'period', 'cnpj', 'merchant_name',
                'operation_count', 'affected_operations', 'exposure_status', 'known_exposure_brl',
                'missing_exposure_count') if key in issue},
        })
    return result
