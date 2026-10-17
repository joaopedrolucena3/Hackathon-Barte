// Closing checklist (A2): agent tasks derive from the latest run; manual tasks are edited by people.
import { getActor } from '../../../lib/actor';
import type { Area, ChecklistTask, ReviewException, Run, Status } from '../contract';
import { listExceptions } from './review';
import { loadChecklistOverrides, loadRuns, saveChecklistOverride } from './store';

interface TaskDef {
  id: string;
  area: Area;
  title: string;
  kind: 'agent' | 'manual';
  owner: string;
  reviewer?: string;
  step_types?: string[];
}

export const TASKS: TaskDef[] = [
  { id: 'orbe', area: 'Adquirência', title: 'Importar e normalizar o relatório da Orbe', kind: 'agent', owner: 'Agente', reviewer: 'Analista financeiro', step_types: ['ler_arquivos', 'normalizar_orbe'] },
  { id: 'mdr', area: 'Adquirência', title: 'Conferir MDR cobrado × contratado', kind: 'agent', owner: 'Agente', reviewer: 'Financeiro', step_types: ['conferir_mdr'] },
  { id: 'comissao', area: 'Adquirência', title: 'Calcular comissões de checkout', kind: 'agent', owner: 'Agente', reviewer: 'Analista financeiro', step_types: ['estornos', 'comissao_checkout'] },
  { id: 'bancos', area: 'Bancos', title: 'Classificar extratos Aurora e Meridiano', kind: 'agent', owner: 'Agente', reviewer: 'Contabilidade', step_types: ['classificar_bancos'] },
  { id: 'cambio', area: 'Câmbio', title: 'Apurar participação no spread da Ponte', kind: 'agent', owner: 'Agente', reviewer: 'Analista financeiro', step_types: ['duplicidade', 'spread_remessa'] },
  { id: 'notas', area: 'Comercial', title: 'Propor notas fiscais', kind: 'agent', owner: 'Agente', reviewer: 'Faturamento', step_types: ['propor_notas'] },
  { id: 'atlas', area: 'Comercial', title: 'Confirmar contrato e cadastro da Atlas', kind: 'manual', owner: 'Comercial e cadastro' },
  { id: 'cobrancas', area: 'Comercial', title: 'Aprovar e enviar cobranças', kind: 'manual', owner: 'Faturamento' },
  { id: 'aprovacao', area: 'Contabilidade', title: 'Revisar exceções e aprovar o lote', kind: 'agent', owner: 'Agente', reviewer: 'Responsável pelo fechamento', step_types: ['aprovacao'] },
  { id: 'erp', area: 'Contabilidade', title: 'Exportar lançamentos para o Fênix', kind: 'agent', owner: 'Agente', reviewer: 'Contabilidade', step_types: ['exportar_erp'] },
];

export const DONE_STATUSES: Status[] = ['done', 'approved'];

export function latestRun(comp: string): Run | undefined {
  return loadRuns()
    .filter(run => run.comp === comp && !run.draft)
    .sort((a, b) => b.created_at.localeCompare(a.created_at))[0];
}

function agentStatus(def: TaskDef, run: Run | undefined, exceptions: ReviewException[]) {
  if (!run) return { status: 'pending' as Status, open: 0 };
  const steps = run.steps.filter(step => def.step_types!.includes(step.type));
  if (!steps.length) return { status: 'skipped' as Status, open: 0, steps };
  const open = exceptions.filter(item => def.step_types!.includes(item.step_type) && !item.decision).length;
  const has = (status: Status) => steps.some(step => step.status === status);
  let status: Status;
  if (has('failed')) status = 'failed';
  else if (has('running')) status = 'running';
  else if (has('awaiting_approval')) status = 'awaiting_approval';
  else if (has('rejected')) status = 'rejected';
  else if (has('pending')) status = 'pending';
  else if (steps.every(step => step.status === 'skipped')) status = 'skipped';
  else if (open) status = 'exceptions';
  else if (has('approved')) status = 'approved';
  else status = 'done';
  return { status, open, steps };
}

export async function getChecklist(comp: string): Promise<ChecklistTask[]> {
  const run = latestRun(comp);
  const exceptions = run ? await listExceptions(run) : [];
  const overrides = loadChecklistOverrides();
  return TASKS.map(def => {
    if (def.kind === 'manual') {
      const override = overrides[`${comp}:${def.id}`] || {};
      return { id: `${comp}:${def.id}`, comp, area: def.area, title: def.title, kind: 'manual', owner: def.owner, status: 'pending', ...override };
    }
    const { status, open, steps = [] } = agentStatus(def, run, exceptions);
    const focus = steps.find(step => step.status === 'exceptions' || step.status === 'failed' || step.status === 'running') || steps[0];
    const finished = steps.map(step => step.finished_at || '').filter(Boolean).sort();
    return {
      id: `${comp}:${def.id}`, comp, area: def.area, title: def.title, kind: 'agent', owner: def.owner, reviewer: def.reviewer,
      status, step_types: def.step_types, run_id: run?.id, step_id: focus?.id, exceptions: open,
      updated_at: finished[finished.length - 1] || run?.created_at,
    };
  });
}

export async function updateTask(id: string, patch: Partial<Pick<ChecklistTask, 'status' | 'owner' | 'comment'>>): Promise<ChecklistTask> {
  const [comp, taskId] = id.split(':');
  const def = TASKS.find(task => task.id === taskId);
  if (!def) throw new Error('Tarefa não encontrada.');
  if (def.kind !== 'manual') throw new Error('Tarefas do agente seguem o run e não são editáveis.');
  const current = loadChecklistOverrides()[id] || {};
  saveChecklistOverride(id, { ...current, ...patch, updated_at: new Date().toISOString(), updated_by: getActor() || undefined });
  return (await getChecklist(comp)).find(task => task.id === id)!;
}
