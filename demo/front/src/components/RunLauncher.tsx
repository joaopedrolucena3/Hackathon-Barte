import { useState } from 'react';
import { Link, useNavigate } from 'react-router-dom';
import { agent, type InputFile, type PipelineStep, type Run } from '../api/agent';
import { adaptFile, array, object } from '../api/agent/adapters';
import { ApiError } from '../api/http';
import { count, periodShort, shortRunId } from '../lib/format';
import { useCompetencias, usePipeline, useOperationalConfig } from '../state/queries';
import { useAction } from '../state/useAction';
import { Icon } from './Icon';
import { Sheet } from './Overlay';
import { Badge, Callout, Field } from './ui';
import { InputManifest, SOURCE_ROLES } from './InputManifest';

type Source = 'pack' | 'upload' | 'folder';
function OptionCard({ selected, onSelect, title, children }: { selected: boolean; onSelect: () => void; title: string; children?: React.ReactNode }) {
  return <div className="card" style={{ padding: 14, borderColor: selected ? 'var(--accent)' : undefined, boxShadow: selected ? '0 0 0 3px var(--focus)' : 'none' }}>
    <label className="row" style={{ gap: 10, cursor: 'pointer', fontWeight: 600 }}><input type="radio" name="source" checked={selected} onChange={onSelect} style={{ accentColor: 'var(--accent)' }} />{title}</label>
    {selected && children && <div style={{ marginTop: 12 }}>{children}</div>}
  </div>;
}
export function RunLauncher({ comp: initial, onClose, draft, steps, parentRun }: { comp: string; onClose: () => void; draft?: boolean; steps?: PipelineStep[]; parentRun?: Run }) {
  const navigate = useNavigate();
  const { data: comps } = useCompetencias();
  const { data: pipeline } = usePipeline();
  const { run, busy } = useAction();
  const [comp, setComp] = useState(parentRun?.comp || initial);
  const { data: config } = useOperationalConfig(comp);
  const [source, setSource] = useState<Source>(parentRun ? 'upload' : 'pack');
  const [files, setFiles] = useState<InputFile[]>([]);
  const [folder, setFolder] = useState('');
  const [deadline, setDeadline] = useState<string | undefined>();
  const [failure, setFailure] = useState<{ message: string; files: InputFile[]; details: string[]; conflict?: string } | null>(null);
  const month = comps?.find(item => item.comp === comp);
  const knownFiles = parentRun?.files || [];
  const uploaded = files.length > 0 && files.every(file => !!file.id);

  async function start() {
    setFailure(null);
    try {
      const created = await run('start', () => agent.createRun({ comp, source, files, folder, draft, steps, parent_run_id: parentRun?.id,
        ...(deadline !== undefined ? { operational_parameters: { closing_deadline: deadline || null } } : {}),
      }), { rethrow: true, invalidate: [['runs'], ['checklist'], ['competencias'], ['state']] });
      if (created) { onClose(); navigate(`/runs/${created.id}`); }
    } catch (error) {
      const info = error instanceof ApiError ? object(error.data?.error) : {};
      const detail = object(info.details);
      const items = array(info.details);
      const manifest = array(detail.manifest ?? detail.files ?? info.manifest ?? (error instanceof ApiError ? error.data?.manifest : undefined));
      const fromItems = items.flatMap(item => array(object(item).manifest ?? object(item).files));
      const fileItems = [...manifest, ...fromItems, ...items.filter(item => object(item).name || object(item).original_name)];
      setFailure({ message: error instanceof Error ? error.message : 'Não foi possível iniciar a execução.', files: fileItems.map(adaptFile),
        conflict: info.code === 'PERIOD_BUSY' ? String(object(items[0]).id || '') : undefined,
        details: items.filter(item => !object(item).name && !object(item).manifest).map(item => { const row = object(item); return String(row.message || row.reason || row.role && `${row.role}: ${row.count ?? ''}` || ''); }).filter(Boolean),
      });
    }
  }

  return <Sheet narrow eyebrow={parentRun ? 'Nova versão do fechamento' : draft ? 'Teste do pipeline' : 'Execução do fechamento'}
    title={parentRun ? 'Adicionar complemento' : draft ? 'Testar pipeline em rascunho' : 'Rodar fechamento'}
    sub={parentRun ? 'As fontes anteriores permanecem. O novo conjunto completo será recalculado e terá sua própria revisão.' : 'Envie as fontes da competência. A validação usa o conteúdo e preserva cada recebimento.'} onClose={onClose}
    footer={<><button type="button" className="btn ghost" onClick={onClose}>Cancelar</button><button type="button" className="btn primary lg" disabled={!!busy || !comp || (source === 'upload' && !uploaded && !parentRun) || (source === 'upload' && files.some(file => !file.id)) || (source === 'folder' && !folder.trim())} onClick={() => void start()}>{busy ? <span className="spin" /> : <Icon name="play" />}{parentRun ? 'Criar nova execução' : draft ? 'Testar' : 'Rodar'}</button></>}>
    <div className="stack-lg">
      {failure && <Callout tone="critical" icon="alert"><div><strong>{failure.message}</strong>{failure.conflict && <p><Link className="link" to={`/runs/${failure.conflict}`} onClick={onClose}>Abrir execução em andamento</Link></p>}{failure.details.length > 0 && <ul>{failure.details.map((text, i) => <li key={i}>{text}</li>)}</ul>}</div></Callout>}
      {failure?.files.length ? <InputManifest files={failure.files} compact /> : null}
      <Field label="Competência" help={parentRun ? 'O complemento pertence à mesma competência da execução anterior.' : 'A data dos movimentos determina a competência; a chegada do arquivo não muda o mês.'}>
        <input className="input" type="month" value={comp} onChange={event => { setComp(event.target.value); setDeadline(undefined); setFailure(null); }} required disabled={!!parentRun} />
      </Field>
      <Field label="Prazo operacional" help="Opcional. Esta configuração não altera taxas, vigências nem fatos financeiros.">
        <input className="input" type="date" value={deadline ?? config?.closing_deadline ?? ''} onChange={event => setDeadline(event.target.value)} />
      </Field>
      {parentRun && <Callout tone="info" icon="origin"><div>Execução anterior <Link to={`/runs/${parentRun.id}`} className="link">{shortRunId(parentRun.id)}</Link> · {count(parentRun.files.length)} recebimentos preservados. Decisões e aprovação anteriores não são transferidas.</div></Callout>}
      {knownFiles.length > 0 && <details><summary>{parentRun ? 'Ver fontes preservadas da execução anterior' : 'Ver fontes do pack atual'}</summary><div style={{ marginTop: 10 }}><InputManifest files={knownFiles.map(file => ({ ...file, inherited: !!parentRun }))} compact /></div></details>}
      <div className="stack" style={{ gap: 8 }}>
        <OptionCard selected={source === 'pack'} onSelect={() => setSource('pack')} title={parentRun ? 'Recalcular somente o conjunto anterior' : 'Usar data pack da competência'}>
          {parentRun ? <Callout tone="info" icon="info">Reutiliza as fontes preservadas da execução anterior, sem acrescentar arquivos.</Callout> : month?.has_pack ? <Callout tone="good" icon="check">Pack de {periodShort(comp)} reconhecido pelo servidor. Todas as entradas serão validadas e registradas.</Callout>
            : <Callout tone="info" icon="info">{parentRun ? 'As fontes anteriores serão mantidas. ' : ''}O servidor ainda não informou um pack para {periodShort(comp)}. Você pode enviar arquivos ou indicar uma pasta.</Callout>}
        </OptionCard>
        <OptionCard selected={source === 'upload'} onSelect={() => setSource('upload')} title={parentRun ? 'Enviar arquivos complementares' : 'Enviar arquivos'}>
          <input aria-label="Selecionar arquivos de entrada" className="input" type="file" multiple disabled={!!busy} style={{ height: 'auto', padding: 8 }} onChange={async event => {
            const input = event.currentTarget; const list = Array.from(input.files || []); if (!list.length) return;
            setFailure(null);
            const received = await run('upload', () => agent.uploadFiles(list));
            if (received) setFiles(previous => [...previous, ...received]);
            input.value = '';
          }} />
          <p className="help" style={{ marginTop: 8 }}>Nomes e extensões livres; a estrutura é validada pelo servidor. CSV, XLSX, EML e OFX são formatos esperados, mesmo quando o nome tem outra extensão. Você pode selecionar mais arquivos depois. Arquivos com o mesmo nome permanecem separados.</p>
          {busy === 'upload' && <p className="muted row"><span className="spin" />Recebendo e validando todas as entradas…</p>}
          {files.length > 0 && <div style={{ marginTop: 10 }}><InputManifest files={files} compact /></div>}
          <details style={{ marginTop: 12 }}><summary>Fontes necessárias no conjunto completo</summary><ul className="note-list">{SOURCE_ROLES.map(([role, label, help]) => <li key={role}><strong>{label}:</strong> {help}</li>)}</ul></details>
          {parentRun && <p className="help">Envie apenas os complementos; a execução incorpora automaticamente as fontes da versão anterior.</p>}
        </OptionCard>
        <OptionCard selected={source === 'folder'} onSelect={() => setSource('folder')} title="Importar de uma pasta no servidor">
          <Field label="Caminho completo da pasta" help="Os arquivos são identificados pela estrutura. Entradas rejeitadas ou ambíguas são apresentadas com o motivo."><input className="input" value={folder} onChange={event => setFolder(event.target.value)} placeholder="/caminho/para/as/fontes" /></Field>
        </OptionCard>
      </div>
      <div className="card" style={{ padding: 14, background: 'var(--surface-2)' }}><div className="row between wrap"><div><p className="muted">Pipeline</p><strong>{pipeline ? `${pipeline.name} v${pipeline.version}` : 'Carregando…'}</strong><p className="muted">{(steps || pipeline?.steps)?.filter(step => step.enabled).length ?? '–'} passos{steps ? ' · parâmetros de teste' : ''}</p></div><Badge tone="gate">Revisão própria obrigatória</Badge></div></div>
    </div>
  </Sheet>;
}
