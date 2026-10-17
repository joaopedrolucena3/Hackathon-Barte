// A2: closing checklist grouped by area. Agent tasks follow the run; manual tasks are edited inline.
import { useState } from 'react';
import { useMutation, useQueryClient } from '@tanstack/react-query';
import { Link } from 'react-router-dom';
import { agent, type Area, type ChecklistTask, type Status } from '../api/agent';
import { dateTimeBR, plural } from '../lib/format';
import { keys } from '../state/queries';
import { Icon } from './Icon';
import { useToast } from './Toast';
import { Badge, StatusBadge } from './ui';

const AREAS: Area[] = ['Adquirência', 'Bancos', 'Câmbio', 'Comercial', 'Contabilidade'];
export const isDone = (status: Status) => status === 'done' || status === 'approved';
const MANUAL: { value: Status; label: string }[] = [
  { value: 'pending', label: 'Pendente' }, { value: 'running', label: 'Em andamento' }, { value: 'done', label: 'Concluído' },
];

function ManualControls({ task, comp }: { task: ChecklistTask; comp: string }) {
  const client = useQueryClient();
  const toast = useToast();
  const [comment, setComment] = useState(task.comment || '');
  const [editing, setEditing] = useState(false);
  const mutation = useMutation({
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
  return (
    <div className="row wrap" style={{ gap: 6 }}>
      <select className="select sm" style={{ width: 150 }} value={task.status} aria-label={`Situação de ${task.title}`}
        onChange={event => mutation.mutate({ status: event.target.value as Status })}>
        {MANUAL.map(option => <option key={option.value} value={option.value}>{option.label}</option>)}
      </select>
      {editing ? (
        <form className="row" style={{ gap: 6 }} onSubmit={event => { event.preventDefault(); mutation.mutate({ comment }); setEditing(false); }}>
          <input className="input sm" autoFocus value={comment} onChange={event => setComment(event.target.value)} placeholder="Comentário" style={{ width: 220 }} />
          <button className="btn xs primary" type="submit">Salvar</button>
        </form>
      ) : (
        <button type="button" className="btn xs ghost" onClick={() => setEditing(true)}><Icon name="edit" />{task.comment ? 'Editar comentário' : 'Comentar'}</button>
      )}
    </div>
  );
}

function TaskRow({ task, comp }: { task: ChecklistTask; comp: string }) {
  const runLink = task.run_id ? `/runs/${task.run_id}${task.step_id ? `?step=${task.step_id}` : ''}` : null;
  return (
    <div className="task-row">
      <div className="task-status">
        <StatusBadge status={task.status} label={task.kind === 'manual' && task.status === 'running' ? 'Em andamento' : undefined} />
      </div>
      <div className="grow">
        <div className="row wrap" style={{ gap: 8 }}>
          {runLink ? <Link to={runLink} className="task-title link-plain">{task.title}</Link> : <span className="task-title">{task.title}</span>}
          <Badge tone={task.kind === 'agent' ? 'info' : 'outline'}>{task.kind === 'agent' ? 'Agente' : 'Manual'}</Badge>
        </div>
        <p className="muted" style={{ fontSize: 12, marginTop: 2 }}>
          {task.kind === 'agent' ? `Revisor: ${task.reviewer}` : `Responsável: ${task.owner}`}
          {task.updated_at && ` · atualizado ${dateTimeBR(task.updated_at)}`}
          {task.updated_by && ` por ${task.updated_by}`}
          {task.comment && <> · <span className="text-2">“{task.comment}”</span></>}
        </p>
      </div>
      <div className="row" style={{ gap: 8 }}>
        {task.kind === 'manual' ? <ManualControls task={task} comp={comp} /> : (
          <>
            {!!task.exceptions && task.run_id && (
              <Link className="btn xs" to={`/runs/${task.run_id}/revisao?passo=${task.step_types?.join(',')}`}>
                <Icon name="alert" />{plural(task.exceptions, 'exceção', 'exceções')}
              </Link>
            )}
            {runLink && <Link className="icon-btn" to={runLink} aria-label={`Abrir ${task.title} no run`}><Icon name="chevronRight" /></Link>}
          </>
        )}
      </div>
    </div>
  );
}

export function Checklist({ tasks, comp }: { tasks: ChecklistTask[]; comp: string }) {
  const [closed, setClosed] = useState<Record<string, boolean>>({});
  return (
    <div className="stack" style={{ gap: 10 }}>
      {AREAS.map(area => {
        const list = tasks.filter(task => task.area === area);
        if (!list.length) return null;
        const done = list.filter(task => isDone(task.status)).length;
        const open = !closed[area];
        return (
          <section key={area} className="card">
            <button type="button" className="checklist-head" aria-expanded={open} onClick={() => setClosed(state => ({ ...state, [area]: open }))}>
              <Icon name="chevronDown" className={open ? '' : 'rot'} />
              <span className="grow" style={{ textAlign: 'left' }}>{area}</span>
              <span className="count num">{done}/{list.length}</span>
            </button>
            {open && <div>{list.map(task => <TaskRow key={task.id} task={task} comp={comp} />)}</div>}
          </section>
        );
      })}
    </div>
  );
}
