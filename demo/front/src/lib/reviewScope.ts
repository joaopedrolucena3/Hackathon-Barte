import type { ReviewAction, ReviewException } from '../api/agent/contract';
import { cnpj, plural } from './format';

export const isRegistrationGroup = (item: Pick<ReviewException, 'kind' | 'group_scope'>) =>
  item.kind === 'CADASTRO_NAO_CONFIRMADO' && item.group_scope === 'merchant_period';

export function operationCountLabel(item: Pick<ReviewException, 'operation_count'>): string {
  return item.operation_count === undefined ? 'Quantidade de operações não informada' : plural(item.operation_count, 'operação', 'operações');
}

export function reviewDecisionLabel(item: ReviewException, action: ReviewAction): string {
  if (isRegistrationGroup(item) && action === 'accept') return 'Aceita como ressalva';
  if (isRegistrationGroup(item) && action === 'exclude') return 'Grupo excluído do lote';
  return { accept: 'Aceita', adjust: 'Ajustada', exclude: 'Excluída do lote' }[action];
}

export function reviewActions(item: ReviewException): { value: ReviewAction; label: string }[] {
  const grouped = isRegistrationGroup(item);
  return [
    { value: 'accept' as const, label: grouped ? 'Aceitar como ressalva' : 'Manter tratamento atual' },
    ...(!grouped && item.associated_entries?.length ? [{ value: 'adjust' as const, label: 'Ajustar' }] : []),
    { value: 'exclude' as const, label: grouped ? 'Excluir grupo do lote' : 'Excluir do lote' },
  ];
}

export function exceptionSearchText(item: ReviewException): string {
  return [item.merchant, item.cnpj, cnpj(item.cnpj), item.period, item.ref_origem, item.description,
    ...(item.affected_operations || []).flatMap(operation => [operation.id, operation.ref, operation.arquivo])]
    .filter(Boolean).join(' ').toLocaleLowerCase('pt-BR');
}
