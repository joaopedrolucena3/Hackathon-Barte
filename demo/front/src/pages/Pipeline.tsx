// C1: the accountant arranges and configures fixed steps. No free text interpreted by AI.
import { useEffect, useMemo, useState } from 'react';
import { Link, useSearchParams } from 'react-router-dom';
import { closestCenter, DndContext, KeyboardSensor, PointerSensor, useSensor, useSensors, type DragEndEvent } from '@dnd-kit/core';
import { arrayMove, SortableContext, sortableKeyboardCoordinates, useSortable, verticalListSortingStrategy } from '@dnd-kit/sortable';
import { CSS } from '@dnd-kit/utilities';
import { useQueryClient } from '@tanstack/react-query';
import { agent, type ParamField, type ParamValue, type PipelineStep, type StepCatalogItem, type ValidationIssue } from '../api/agent';
import { DataPreview } from '../components/DataPreview';
import { Icon } from '../components/Icon';
import { Modal, Sheet } from '../components/Overlay';
import { RunLauncher } from '../components/RunLauncher';
import { useToast } from '../components/Toast';
import { Badge, Callout, Empty, Loading, PageHead, Tip, Toggle } from '../components/ui';
import { dateTimeBR } from '../lib/format';
import { keys, lastComp, useAppState, useCatalog, usePipeline, usePipelineVersions, useRuns } from '../state/queries';

function SortableStep({ step, item, index, selected, issues, readOnly, onSelect, onToggle, onRemove }: {
  step: PipelineStep; item?: StepCatalogItem; index: number; selected: boolean; issues: ValidationIssue[]; readOnly: boolean;
  onSelect: () => void; onToggle: (enabled: boolean) => void; onRemove: () => void;
}) {
  const { attributes, listeners, setNodeRef, transform, transition, isDragging } = useSortable({ id: step.id, disabled: readOnly });
  const locked = !!item?.locked;
  return (
    <li ref={setNodeRef} style={{ transform: CSS.Transform.toString(transform), transition, zIndex: isDragging ? 5 : undefined }}
      className={`builder-step ${selected ? 'selected' : ''} ${step.enabled ? '' : 'off'} ${issues.length ? 'invalid' : ''} ${item?.kind === 'gate' ? 'gate' : ''} ${isDragging ? 'dragging' : ''}`}>
      {!readOnly && <button type="button" className="drag-handle" {...attributes} {...listeners} aria-label={`Arrastar ${item?.title}`}><Icon name="grip" /></button>}
      <button type="button" className="builder-step-main" onClick={onSelect}>
        <span className="builder-index num">{index + 1}</span>
        <span className="grow" style={{ minWidth: 0 }}>
          <span className="step-title">{item?.title || step.type}</span>
          <span className="step-meta">{item?.area}{item?.kind === 'gate' ? ' · portão humano' : item?.kind === 'export' ? ' · exportação' : ''}{!step.enabled ? ' · desligado' : ''}</span>
          {issues.map(issue => <span key={issue.message} className="step-error">{issue.message}</span>)}
        </span>
      </button>
      {locked ? (
        <Tip text="A aprovação humana é obrigatória: não pode ser removida, desligada nem ir para depois da exportação ao ERP."><Icon name="lock" className="muted" /></Tip>
      ) : !readOnly && (
        <span className="row" style={{ gap: 2 }}>
          <Toggle checked={step.enabled} onChange={onToggle} label={`Ligar ${item?.title}`} />
          <button type="button" className="icon-btn" style={{ width: 28, height: 28 }} onClick={onRemove} aria-label={`Remover ${item?.title}`}><Icon name="trash" /></button>
        </span>
      )}
    </li>
  );
}

function ParamInput({ field, value, readOnly, error, onChange }: { field: ParamField; value: ParamValue; readOnly: boolean; error?: string; onChange: (value: ParamValue) => void }) {
  const disabled = readOnly || field.readonly;
  return (
    <div className="param-field">
      <div className="row between" style={{ gap: 8 }}>
        <label className="param-label" htmlFor={`p-${field.key}`}>{field.label}</label>
        {field.readonly && <Tip text="Regra definida pelo financeiro; mudar exige nova versão do passo."><Icon name="lock" className="muted" size={13} /></Tip>}
      </div>
      {field.type === 'boolean' ? (
        <label className="row" style={{ gap: 8, fontSize: 13 }}><Toggle checked={!!value} disabled={disabled} onChange={onChange} label={field.label} />{value ? 'Sim' : 'Não'}</label>
      ) : field.type === 'select' ? (
        <select id={`p-${field.key}`} className="select" disabled={disabled} value={String(value)} onChange={event => onChange(event.target.value)}>
          {field.options?.map(option => <option key={option.value} value={option.value}>{option.label}</option>)}
        </select>
      ) : (
        <div className="row" style={{ gap: 8 }}>
          <input id={`p-${field.key}`} className="input" type={field.type === 'number' ? 'number' : 'text'} disabled={disabled} value={String(value ?? '')} step={field.step} min={field.min} max={field.max}
            aria-invalid={!!error} onChange={event => onChange(field.type === 'number' ? (event.target.value === '' ? '' : Number(event.target.value)) : event.target.value)} />
          {field.unit && <span className="muted nowrap" style={{ fontSize: 12.5 }}>{field.unit}</span>}
        </div>
      )}
      <p className="help">{field.help}</p>
      {error && <p className="neg" style={{ fontSize: 12 }}>{error}</p>}
    </div>
  );
}

export default function PipelinePage() {
  const [params, setParams] = useSearchParams();
  const viewVersion = params.get('versao') ? Number(params.get('versao')) : undefined;
  const { data: latest } = usePipeline();
  const { data: viewed } = usePipeline(viewVersion);
  const { data: catalog } = useCatalog();
  const { data: versions } = usePipelineVersions();
  const { data: state } = useAppState();
  const comp = state ? lastComp(state.period) : '';
  const { data: runs } = useRuns(comp);
  const sampleRun = runs?.find(run => run.status !== 'running' && run.status !== 'pending' && run.status !== 'failed');
  const client = useQueryClient();
  const toast = useToast();
  const readOnly = !!viewVersion && viewVersion !== latest?.version;
  const base = readOnly ? viewed : latest;
  const [steps, setSteps] = useState<PipelineStep[]>([]);
  const [selected, setSelected] = useState<string | null>(null);
  const [issues, setIssues] = useState<ValidationIssue[]>([]);
  const [modal, setModal] = useState<'catalog' | 'versions' | 'test' | null>(null);
  const [saving, setSaving] = useState(false);
  const sensors = useSensors(useSensor(PointerSensor, { activationConstraint: { distance: 4 } }), useSensor(KeyboardSensor, { coordinateGetter: sortableKeyboardCoordinates }));

  useEffect(() => { if (base) { setSteps(structuredClone(base.steps)); setSelected(current => current && base.steps.some(step => step.id === current) ? current : base.steps[0]?.id || null); } }, [base?.version, readOnly]);
  const dirty = !readOnly && !!latest && JSON.stringify(steps) !== JSON.stringify(latest.steps);
  useEffect(() => {
    if (!steps.length) return;
    const timer = setTimeout(() => { agent.validatePipeline(steps).then(result => setIssues(result.issues)).catch(() => {}); }, 300);
    return () => clearTimeout(timer);
  }, [steps]);
  const byType = useMemo(() => new Map((catalog || []).map(item => [item.type, item])), [catalog]);

  if (!latest || !catalog || !base) return <Loading page />;
  const step = steps.find(item => item.id === selected) || steps[0];
  const item = step ? byType.get(step.type) : undefined;
  const update = (id: string, change: Partial<PipelineStep>) => setSteps(list => list.map(entry => (entry.id === id ? { ...entry, ...change } : entry)));
  const stepIssues = (id: string) => issues.filter(issue => issue.step_id === id);
  const globalIssues = issues.filter(issue => !issue.step_id);
  const onDragEnd = ({ active, over }: DragEndEvent) => {
    if (!over || active.id === over.id) return;
    const from = steps.findIndex(entry => entry.id === active.id), to = steps.findIndex(entry => entry.id === over.id);
    const next = arrayMove(steps, from, to);
    const gate = next.findIndex(entry => entry.type === 'aprovacao'), exporter = next.findIndex(entry => entry.type === 'exportar_erp');
    if (gate >= 0 && exporter >= 0 && gate > exporter) { toast.error(new Error('A aprovação humana precisa vir antes da exportação para o ERP.')); return; }
    setSteps(next);
  };
  const save = async () => {
    setSaving(true);
    try {
      const saved = await agent.savePipeline(steps);
      toast.ok(`v${saved.version} salva.`);
      await Promise.all([keys.pipeline(), keys.versions, keys.state].map(queryKey => client.invalidateQueries({ queryKey })));
    } catch (error) { toast.error(error); } finally { setSaving(false); }
  };

  return (
    <>
      <PageHead
        eyebrow="Construtor do agente"
        title={<span className="row" style={{ gap: 12 }}>Pipeline {base.name} <Badge tone={readOnly ? 'neutral' : 'accent'}>v{base.version}{readOnly ? ' · só leitura' : ''}</Badge>{dirty && <Badge tone="warning" dot>Alterações não salvas</Badge>}</span>}
        sub={`Monte e ajuste o agente com passos prontos. Salvar cria uma nova versão; runs antigos continuam apontando para a versão que usaram. Última: v${latest.version} por ${latest.author} em ${dateTimeBR(latest.updated_at)}.`}
        actions={<>
          <button className="btn" onClick={() => setModal('versions')}><Icon name="clock" />Versões</button>
          {!readOnly && <button className="btn" disabled={issues.length > 0} onClick={() => setModal('test')}><Icon name="play" />Testar</button>}
          {!readOnly && <button className="btn primary" disabled={!dirty || issues.length > 0 || saving} onClick={save}>{saving ? <span className="spin" /> : <Icon name="check" />}Salvar v{latest.version + 1}</button>}
        </>}
      />
      {readOnly && <div style={{ marginBottom: 14 }}><Callout tone="info">Você está vendo a v{base.version}, de {dateTimeBR(base.updated_at)}. <Link className="link" to="/pipeline">Voltar para a versão atual (v{latest.version})</Link></Callout></div>}
      {globalIssues.map(issue => <div key={issue.message} style={{ marginBottom: 10 }}><Callout tone="critical" icon="alert">{issue.message}</Callout></div>)}

      <div className="builder-layout">
        <aside className="card builder-steps">
          <div className="run-col-head"><span>Passos · arraste para reordenar</span><span className="muted num">{steps.filter(entry => entry.enabled).length}/{steps.length}</span></div>
          <DndContext sensors={sensors} collisionDetection={closestCenter} onDragEnd={onDragEnd}>
            <SortableContext items={steps.map(entry => entry.id)} strategy={verticalListSortingStrategy}>
              <ol className="builder-list">
                {steps.map((entry, index) => (
                  <SortableStep key={entry.id} step={entry} item={byType.get(entry.type)} index={index} selected={entry.id === step?.id} issues={stepIssues(entry.id)} readOnly={readOnly}
                    onSelect={() => setSelected(entry.id)} onToggle={enabled => update(entry.id, { enabled })}
                    onRemove={() => { setSteps(list => list.filter(other => other.id !== entry.id)); if (selected === entry.id) setSelected(null); }} />
                ))}
              </ol>
            </SortableContext>
          </DndContext>
          {!readOnly && <div style={{ padding: 10 }}><button className="btn sm" style={{ width: '100%' }} onClick={() => setModal('catalog')}><Icon name="plus" />Adicionar passo</button></div>}
        </aside>

        <section className="card run-preview">
          <div className="run-col-head">
            <div className="row" style={{ gap: 8, minWidth: 0 }}><strong style={{ fontSize: 14 }}>{item?.title}</strong><span className="muted" style={{ fontWeight: 500 }}>amostra do {sampleRun ? sampleRun.id : 'último run'}</span></div>
          </div>
          {!step ? <Empty title="Selecione um passo" /> : item?.kind === 'gate' ? (
            <div className="card-body"><Callout tone="gate" icon="lock">Portão de aprovação: não transforma dados. Aqui o run para até um responsável decidir as exceções e aprovar o lote.</Callout></div>
          ) : sampleRun ? (
            <DataPreview runId={sampleRun.id} stepId={step.type} paramsOverride={step.params} pageSize={50}
              header={<p className="help">Prévia com os parâmetros desta tela, sobre os dados do {sampleRun.id}. Mude um parâmetro e veja o efeito.</p>} />
          ) : <Empty icon="play" title="Sem amostra ainda">Rode o fechamento uma vez para ver aqui o efeito de cada passo.</Empty>}
        </section>

        <aside className="card builder-params">
          <div className="card-body stack-lg">
            {step && item ? (
              <>
                <div>
                  <p className="eyebrow" style={{ marginBottom: 4 }}>{item.area}</p>
                  <h3 className="overlay-title">{item.title}</h3>
                  <p className="text-2" style={{ fontSize: 13, marginTop: 4 }}>{item.description}</p>
                </div>
                {item.requires.length > 0 && <p className="muted" style={{ fontSize: 12.5 }}>Depende de: {item.requires.map(type => byType.get(type)?.title || type).join(', ')}</p>}
                {stepIssues(step.id).map(issue => <Callout key={issue.message} tone="critical" icon="alert">{issue.message}</Callout>)}
                <div className="stack" style={{ gap: 14 }}>
                  {item.params_schema.map(field => (
                    <ParamInput key={field.key} field={field} value={step.params[field.key]} readOnly={readOnly}
                      error={stepIssues(step.id).find(issue => issue.field === field.key)?.message}
                      onChange={value => update(step.id, { params: { ...step.params, [field.key]: value } })} />
                  ))}
                </div>
              </>
            ) : <Empty title="Selecione um passo" />}
          </div>
        </aside>
      </div>

      {modal === 'catalog' && (
        <Modal wide title="Adicionar passo" sub="Passos prontos do agente. Cada um tem parâmetros com ajuda em português." onClose={() => setModal(null)}>
          <div className="catalog-grid">
            {catalog.map(entry => {
              const present = steps.some(other => other.type === entry.type);
              return (
                <button key={entry.type} type="button" className="catalog-item" disabled={present} onClick={() => {
                  const created: PipelineStep = { id: `s-${entry.type}`, type: entry.type, enabled: true, params: Object.fromEntries(entry.params_schema.map(field => [field.key, field.default])) };
                  setSteps(list => {
                    const gate = list.findIndex(other => other.type === 'aprovacao');
                    const at = entry.kind === 'export' || gate < 0 ? list.length : gate;
                    return [...list.slice(0, at), created, ...list.slice(at)];
                  });
                  setSelected(created.id);
                  setModal(null);
                }}>
                  <span className="row between"><strong>{entry.title}</strong>{present ? <Badge tone="good">No pipeline</Badge> : <Badge tone="outline">{entry.area}</Badge>}</span>
                  <span className="text-2" style={{ fontSize: 12.5 }}>{entry.description}</span>
                </button>
              );
            })}
          </div>
        </Modal>
      )}
      {modal === 'versions' && (
        <Sheet narrow eyebrow="Histórico do pipeline" title="Versões" sub="Abrir uma versão antiga é só leitura." onClose={() => setModal(null)}>
          <ol className="version-list">
            {(versions || []).map(version => (
              <li key={version.version} className={`card version-item ${version.version === base.version ? 'current' : ''}`}>
                <div className="row between">
                  <strong>v{version.version}{version.version === latest.version && <Badge tone="accent">atual</Badge>}</strong>
                  <span className="muted" style={{ fontSize: 12 }}>{dateTimeBR(version.updated_at)}</span>
                </div>
                <p className="muted" style={{ fontSize: 12.5 }}>por {version.author}</p>
                <ul>{version.changes.map(change => <li key={change}>{change}</li>)}</ul>
                <button className="btn xs" onClick={() => { setModal(null); setParams(version.version === latest.version ? {} : { versao: String(version.version) }); }}>{version.version === latest.version ? 'Abrir atual' : 'Ver esta versão'}</button>
              </li>
            ))}
          </ol>
        </Sheet>
      )}
      {modal === 'test' && <RunLauncher comp={comp} draft steps={dirty ? steps : undefined} onClose={() => setModal(null)} />}
    </>
  );
}
