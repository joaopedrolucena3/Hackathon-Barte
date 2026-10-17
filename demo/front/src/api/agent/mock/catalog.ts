// Fixed steps the accountant can arrange (C1). Mirrors what back/src/engine.py already computes.
import type { PipelineStep, StepCatalogItem, ValidationIssue, ValidationResult } from '../contract';

export const PIPELINE_ID = 'fechamento-tarvo';

export const CATALOG: StepCatalogItem[] = [
  {
    type: 'ler_arquivos', title: 'Ler arquivos da competência', area: 'Contabilidade', kind: 'calc', requires: [],
    description: 'Lê os arquivos do data pack (Orbe, taxas, e-mail da Ponte, plano de contas e extratos), registra SHA-256 e linhas lidas.',
    params_schema: [
      { key: 'registrar_hash', label: 'Registrar SHA-256 de cada arquivo', type: 'boolean', default: true, readonly: true,
        help: 'Garante que o resultado pode ser reproduzido a partir dos mesmos arquivos.' },
    ],
  },
  {
    type: 'normalizar_orbe', title: 'Normalizar Orbe', area: 'Adquirência', kind: 'calc', requires: ['ler_arquivos'],
    description: 'Converte o relatório da Orbe em transações padronizadas: produto contratado, CNPJ do lojista e valores exatos.',
    params_schema: [
      { key: 'arredondamento', label: 'Arredondamento', type: 'select', default: 'HALF_UP', readonly: true,
        options: [{ value: 'HALF_UP', label: 'Comercial, linha a linha' }],
        help: 'Cada transação é arredondada antes da soma, como a Orbe faz.' },
    ],
  },
  {
    type: 'conferir_mdr', title: 'Conferir MDR', area: 'Adquirência', kind: 'calc', requires: ['normalizar_orbe'],
    description: 'Compara a taxa aplicada pela Orbe com a contratada vigente na data original da venda e calcula o impacto em R$.',
    params_schema: [
      { key: 'tolerancia_pp', label: 'Tolerância de taxa', type: 'number', default: 0, min: 0, max: 1, step: 0.01, unit: 'p.p.',
        help: 'Diferenças até este limite não viram exceção. Com 0, qualquer diferença vai para a revisão.' },
      { key: 'data_vigencia', label: 'Data que define a taxa vigente', type: 'select', default: 'original', readonly: true,
        options: [{ value: 'original', label: 'Data original da venda' }],
        help: 'Definido pelo financeiro: estornos usam a taxa da venda original.' },
    ],
  },
  {
    type: 'estornos', title: 'Tratar estornos e antecipações', area: 'Adquirência', kind: 'calc', requires: ['normalizar_orbe'],
    description: 'Aplica estornos pela data da venda original e vincula reversões à antecipação correspondente.',
    params_schema: [
      { key: 'reversao_parcial', label: 'Reversão parcial de antecipação', type: 'select', default: 'pendencia', readonly: true,
        options: [{ value: 'pendencia', label: 'Enviar para revisão' }],
        help: 'Os dados só sustentam reversões integrais; casos parciais não recebem regra inventada.' },
    ],
  },
  {
    type: 'comissao_checkout', title: 'Calcular comissão de checkout', area: 'Adquirência', kind: 'calc',
    requires: ['conferir_mdr', 'estornos'],
    description: 'Soma a comissão por lojista com a taxa contratada. Sem contrato confirmado, a operação fica em revisão e não é faturada.',
    params_schema: [
      { key: 'exigir_contrato', label: 'Exigir contrato vigente para faturar', type: 'boolean', default: true, readonly: true,
        help: 'Operações sem contrato (ex.: Atlas) ficam fora da comissão até o comercial confirmar.' },
    ],
  },
  {
    type: 'duplicidade', title: 'Detectar duplicidade', area: 'Câmbio', kind: 'calc', requires: ['ler_arquivos'],
    description: 'Conta uma única vez operações repetidas com o mesmo ID no relatório da Ponte Câmbio.',
    params_schema: [
      { key: 'chave', label: 'Chave de duplicidade', type: 'select', default: 'id_operacao', readonly: true,
        options: [{ value: 'id_operacao', label: 'ID da operação' }], help: 'Linhas idênticas com o mesmo ID contam uma vez.' },
    ],
  },
  {
    type: 'spread_remessa', title: 'Apurar participação no spread', area: 'Câmbio', kind: 'calc', requires: ['ler_arquivos'],
    description: 'Calcula a participação no spread realizado positivo por operação da Ponte e confere com a taxa contratada.',
    params_schema: [
      { key: 'participacao_pct', label: 'Participação no spread', type: 'number', default: 50, unit: '%', readonly: true,
        help: 'Percentual do spread realizado que cabe à Tarvo, conforme contrato com a Ponte.' },
      { key: 'tolerancia_pp', label: 'Tolerância de divergência de spread', type: 'number', default: 0.002, min: 0, max: 0.05,
        step: 0.001, unit: 'p.p.', help: 'Diferença máxima aceita entre spread realizado e contratado. Salvar sincroniza com o motor.' },
      { key: 'excluir_negativos', label: 'Excluir spreads negativos', type: 'boolean', default: true, readonly: true,
        help: 'Spread negativo não gera receita e vai para revisão.' },
    ],
  },
  {
    type: 'classificar_bancos', title: 'Classificar extratos bancários', area: 'Bancos', kind: 'calc', requires: ['ler_arquivos'],
    description: 'Classifica os lançamentos da Aurora e do Meridiano no plano de contas Fênix por regras explícitas.',
    params_schema: [
      { key: 'confianca_minima', label: 'Confiança mínima para classificar', type: 'number', default: 0.9, min: 0.5, max: 1,
        step: 0.05, help: 'Abaixo deste valor o lançamento vai para revisão em vez de ser classificado.' },
      { key: 'somente_analiticas', label: 'Usar só contas analíticas', type: 'boolean', default: true, readonly: true,
        help: 'Contas sintéticas do plano Fênix não aceitam lançamento.' },
    ],
  },
  {
    type: 'propor_notas', title: 'Propor notas fiscais', area: 'Comercial', kind: 'calc', requires: ['comissao_checkout', 'spread_remessa'],
    description: 'Agrupa comissões por tomador; na remessa a Ponte é a única tomadora. Não propõe nota negativa.',
    params_schema: [
      { key: 'nota_negativa', label: 'Comissão negativa', type: 'select', default: 'nao_emitir', readonly: true,
        options: [{ value: 'nao_emitir', label: 'Não emitir nota negativa' }], help: 'Saldo negativo segue para análise do financeiro.' },
    ],
  },
  {
    type: 'aprovacao', title: 'Aprovação humana', area: 'Contabilidade', kind: 'gate', requires: [], locked: true,
    description: 'Portão: nada vai para o ERP sem revisão das exceções e aprovação de um responsável.',
    params_schema: [
      { key: 'justificativa', label: 'Exigir justificativa em ajustes e exclusões', type: 'boolean', default: true, readonly: true,
        help: 'Toda decisão fica com autor, data e motivo na auditoria.' },
    ],
  },
  {
    type: 'exportar_erp', title: 'Exportar lançamentos (Fênix)', area: 'Contabilidade', kind: 'export',
    requires: ['classificar_bancos', 'aprovacao'],
    description: 'Gera o arquivo de lançamentos balanceados para o ERP Fênix. Só roda depois da aprovação.',
    params_schema: [
      { key: 'formato', label: 'Formato', type: 'select', default: 'csv', readonly: true,
        options: [{ value: 'csv', label: 'CSV Fênix (;)' }], help: 'Exportamos arquivo; não há integração direta com o ERP.' },
    ],
  },
];

export const catalogByType = new Map(CATALOG.map(item => [item.type, item]));

export function stepTitle(type: string) {
  return catalogByType.get(type)?.title || type;
}

export function defaultParams(type: string, overrides: Record<string, string | number | boolean> = {}) {
  const item = catalogByType.get(type);
  return Object.fromEntries((item?.params_schema || []).map(field => [field.key, overrides[field.key] ?? field.default]));
}

export function defaultSteps(remittanceTolerance?: string): PipelineStep[] {
  const order = ['ler_arquivos', 'normalizar_orbe', 'conferir_mdr', 'estornos', 'comissao_checkout', 'duplicidade',
    'spread_remessa', 'classificar_bancos', 'propor_notas', 'aprovacao', 'exportar_erp'];
  return order.map(type => ({
    id: `s-${type}`,
    type,
    enabled: true,
    params: defaultParams(type, type === 'spread_remessa' && remittanceTolerance ? { tolerancia_pp: Number(remittanceTolerance) } : {}),
  }));
}

export function validateSteps(steps: PipelineStep[]): ValidationResult {
  const issues: ValidationIssue[] = [];
  const seen = new Set<string>();
  steps.forEach((step, index) => {
    const item = catalogByType.get(step.type);
    if (!item) { issues.push({ step_id: step.id, message: 'Tipo de passo desconhecido.' }); return; }
    if (seen.has(step.type)) issues.push({ step_id: step.id, message: `“${item.title}” aparece mais de uma vez.` });
    seen.add(step.type);
    if (item.locked && !step.enabled) issues.push({ step_id: step.id, message: 'A aprovação humana não pode ser desligada.' });
    if (!step.enabled) return;
    for (const required of item.requires) {
      const position = steps.findIndex(other => other.type === required);
      const title = stepTitle(required);
      if (position < 0) issues.push({ step_id: step.id, message: `Precisa de “${title}” no pipeline.` });
      else if (!steps[position].enabled) issues.push({ step_id: step.id, message: `Precisa de “${title}” ligado.` });
      else if (position > index) issues.push({ step_id: step.id, message: `Precisa de “${title}” antes.` });
    }
    for (const field of item.params_schema) {
      const value = step.params[field.key];
      if (field.type !== 'number') continue;
      const number = Number(value);
      if (value === '' || Number.isNaN(number)) issues.push({ step_id: step.id, field: field.key, message: `${field.label}: informe um número.` });
      else if (field.min !== undefined && number < field.min) issues.push({ step_id: step.id, field: field.key, message: `${field.label}: mínimo ${field.min}.` });
      else if (field.max !== undefined && number > field.max) issues.push({ step_id: step.id, field: field.key, message: `${field.label}: máximo ${field.max}.` });
    }
  });
  const gate = steps.findIndex(step => step.type === 'aprovacao');
  const exporter = steps.findIndex(step => step.type === 'exportar_erp');
  if (gate < 0) issues.push({ message: 'O pipeline precisa da aprovação humana antes de exportar.' });
  if (gate >= 0 && exporter >= 0 && exporter < gate) {
    issues.push({ step_id: steps[exporter].id, message: 'A exportação para o ERP só pode vir depois da aprovação humana.' });
  }
  return { ok: issues.length === 0, issues };
}
