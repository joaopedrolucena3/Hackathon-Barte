// A2: closing checklist as one table grouped by area (FloQast folders). Agent tasks follow the run; manual tasks are edited inline.
import { useState } from 'react';
import { useMutation, useQueryClient } from '@tanstack/react-query';
import { Link } from 'react-router-dom';
import { agent, type Area, type ChecklistTask, type Status } from '../api/agent';
import { dateTimeBR, plural } from '../lib/format';
import { keys } from '../state/queries';
import { Icon } from './Icon';
import { useToast } from './Toast';
import { StatusBadge } from './ui';

const AREAS: Area[] = ['Adquirência', 'Bancos', 'Câmbio', 'Comercial', 'Contabilidade'];
export const isDone = (status: Status) => status === 'done' || status === 'approved';
const MANUAL: { value: Status; label: string }[] = [
  { value: 'pending', label: 'Pendente' }, { value: 'running', label: 'Em andamento' }, { value: 'done', label: 'Concluído' },
];

function useTaskMutation(task: ChecklistTask, comp: string) {
  const client = useQueryClient();
  const toast = useToast();
  return useMutation({
    mutationFn: (patch: Partial<ChecklistTask>) => agent.updateChecklistTask(task.id, patch),
    onMutate: async patch => {
      await client.cancelQueries({ queryKey: keys.checklist(comp) });
      const previous = client.getQueryData<ChecklistTask[]>(keys.checklist(comp));
      client.setQueryData<ChecklistTask[]>(keys.checklist(comp), list => list?.map(item => (item.id === task.id ? { ...item, ...patch } : item)));
      return { previous };
    },
    onError: (error, _patch, context) => { client.setQueryData(keys.checklist(comp), context?.previous); toast.error(error); },
    onSettled: () => client.invalidateQueries({ queryKey: keys.checklist(comp) }),
  });
}

function TaskRow({ task, comp }: { task: ChecklistTask; comp: string }) {
  const mutation = useTaskMutation(task, comp);
  const [owner, setOwner] = useState(task.owner || '');
  const [comment, setComment] = useState(task.comment || '');
  const [editing, setEditing] = useState(false);
  const manual = task.kind === 'manual';
  const runLink = task.run_id ? `/runs/${task.run_id}${task.step_id ? `?step=${task.step_id}` : ''}` : null;
  return (
    <div className="task-row" role="row">
      <div className="task-cell task-main" role="cell">
        <span className="row" style={{ gap: 8 }}>
          {runLink ? <Link to={runLink} className="task-title link-plain">{task.title}</Link> : <span className="task-title">{task.title}</span>}
          <span className={`task-kind ${task.kind}`} title={manual ? 'Tarefa manual' : 'Executada pelo agente'}>{manual ? 'Manual' : 'Agente'}</span>
        </span>
        {editing ? (
          <form className="row" style={{ gap: 6, marginTop: 4 }} onSubmit={event => { event.preventDefault(); mutation.mutate({ comment }); setEditing(false); }}>
            <input className="input sm" autoFocus value={comment} onChange={event => setComment(event.target.value)} placeholder="Comentário" style={{ maxWidth: 320 }} />
            <button className="btn xs primary" type="submit">Salvar</button>
            <button className="btn xs ghost" type="button" onClick={() => setEditing(false)}>Cancelar</button>
          </form>
        ) : task.comment && <span className="task-note">“{task.comment}”</span>}
      </div>
      <div className="task-cell" role="cell">
        {manual ? (
          <input className="inline-input" value={owner} onChange={event => setOwner(event.target.value)} aria-label={`Responsável por ${task.title}`}
            placeholder="A definir" maxLength={160} onBlur={() => { if (owner !== task.owner) mutation.mutate({ owner }); }} />
        ) : <span className="text-2">{task.owner || 'Agente'}</span>}
      </div>
      <div className="task-cell text-2" role="cell">{task.reviewer || <span className="muted">—</span>}</div>
      <div className="task-cell muted num" role="cell" title={task.updated_by ? `por ${task.updated_by}` : undefined}>{task.updated_at ? dateTimeBR(task.updated_at) : '—'}</div>
      <div className="task-cell" role="cell">
        {manual ? (
          <select className="select sm" value={task.status} aria-label={`Situação de ${task.title}`} onChange={event => mutation.mutate({ status: event.target.value as Status })}>
            {MANUAL.map(option => <option key={option.value} value={option.value}>{option.label}</option>)}
          </select>
        ) : <StatusBadge status={task.status} />}
      </div>
      <div className="task-cell task-actions" role="cell">
        {manual && !editing && (
          <button type="button" className="icon-btn" onClick={() => setEditing(true)} aria-label={task.comment ? 'Editar comentário' : 'Comentar'} title={task.comment ? 'Editar comentário' : 'Comentar'}><Icon name="edit" /></button>
        )}
        {!!task.exceptions && task.run_id && (
          <Link className="btn xs" to={`/runs/${task.run_id}/revisao?passo=${task.step_types?.join(',')}`}>{plural(task.exceptions, 'exceção', 'exceções')}</Link>
        )}
        {runLink && <Link className="icon-btn" to={runLink} aria-label={`Abrir ${task.title} no run`}><Icon name="chevronRight" /></Link>}
      </div>
    </div>
  );
}

export function Checklist({ tasks, comp }: { tasks: ChecklistTask[]; comp: string }) {
  const [closed, setClosed] = useState<Record<string, boolean>>({});
  return (
    <div className="card checklist" role="table" aria-label="Checklist do fechamento">
      <div className="task-row task-header" role="row">
        <span role="columnheader">Tarefa</span>
        <span role="columnheader">Responsável</span>
        <span role="columnheader">Revisor</span>
        <span role="columnheader">Atualizado</span>
        <span role="columnheader">Status</span>
        <span role="columnheader" className="sr-only">Ações</span>
      </div>
      {AREAS.map(area => {
        const list = tasks.filter(task => task.area === area);
        if (!list.length) return null;
        const done = list.filter(task => isDone(task.status)).length;
        const open = !closed[area];
        return (
          <div key={area} role="rowgroup">
            <button type="button" className="checklist-head" aria-expanded={open} onClick={() => setClosed(state => ({ ...state, [area]: open }))}>
              <Icon name="chevronDown" className={open ? '' : 'rot'} />
              <span>{area}</span>
              <span className="muted num">{done} de {list.length}</span>
              {done === list.length && <Icon name="check" className="checklist-done" />}
            </button>
            {open && list.map(task => <TaskRow key={task.id} task={task} comp={comp} />)}
          </div>
        );
      })}
    </div>
  );
}
