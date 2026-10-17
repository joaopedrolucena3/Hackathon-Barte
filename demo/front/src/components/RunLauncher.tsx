// B3: one click to run the closing. A short panel, not a wizard.
import { useState } from 'react';
import { Link, useNavigate } from 'react-router-dom';
import { agent, type InputFile, type PipelineStep } from '../api/agent';
import { expectedFiles } from '../lib/datapack';
import { ApiError } from '../api/http';
import { bytes, count, periodShort } from '../lib/format';
import { useAppState, usePipeline } from '../state/queries';
import { useAction } from '../state/useAction';
import { Icon } from './Icon';
import { Sheet } from './Overlay';
import { Callout, Field, HashChip } from './ui';

type Source = 'pack' | 'upload' | 'folder';

function OptionCard({ selected, onSelect, title, children }: { selected: boolean; onSelect: () => void; title: string; children?: React.ReactNode }) {
  return (
    <div className="card" style={{ padding: 14, borderColor: selected ? 'var(--accent)' : undefined, boxShadow: selected ? '0 0 0 3px var(--focus)' : 'none' }}>
      <label className="row" style={{ gap: 10, cursor: 'pointer', fontWeight: 600 }}>
        <input type="radio" name="source" checked={selected} onChange={onSelect} style={{ accentColor: 'var(--accent)' }} />
        {title}
      </label>
      {selected && children && <div style={{ marginTop: 12 }}>{children}</div>}
    </div>
  );
}

export function RunLauncher({ comp: initial, onClose, draft, steps }: { comp: string; onClose: () => void; draft?: boolean; steps?: PipelineStep[] }) {
  const navigate = useNavigate();
  const { data: state } = useAppState();
  const { data: pipeline } = usePipeline();
  const { run, busy } = useAction();
  const [comp, setComp] = useState(initial);
  const [source, setSource] = useState<Source>('pack');
  const [files, setFiles] = useState<InputFile[]>([]);
  const [folder, setFolder] = useState(state?.source_dir || '');
  const [conflict, setConflict] = useState<string | null>(null);
  const hasPack = comp === state?.period;
  const expected = expectedFiles(comp);
  const missing = expected.filter(file => !files.some(item => item.name.startsWith(file.prefix)));

  async function start() {
    setConflict(null);
    try {
      const created = await run('start', () => agent.createRun({ comp, source, files, folder, draft, steps }), { rethrow: true, invalidate: [['runs'], ['checklist']] });
      if (created) { onClose(); navigate(`/runs/${created.id}`); }
    } catch (error) {
      if (error instanceof ApiError && error.status === 409) setConflict(String(error.data?.run_id || ''));
      else throw error;
    }
  }

  return (
    <Sheet
      narrow
      eyebrow={draft ? 'Teste do pipeline' : 'Execução com um clique'}
      title={draft ? 'Testar pipeline em rascunho' : 'Rodar fechamento'}
      sub={draft ? 'Roda até a aprovação humana e não gera exportação.' : 'O agente executa os passos do pipeline e para na aprovação humana antes do ERP.'}
      onClose={onClose}
      footer={<>
        <button type="button" className="btn ghost" onClick={onClose}>Cancelar</button>
        <button type="button" className="btn primary lg" disabled={!!busy || (source === 'folder' && !folder.trim())} onClick={() => start().catch(() => {})}>
          {busy ? <span className="spin" /> : <Icon name="play" />}{draft ? 'Testar' : 'Rodar'}
        </button>
      </>}
    >
      <div className="stack-lg">
        {conflict !== null && (
          <Callout tone="warning" icon="alert">
            Já existe um run em andamento para {periodShort(comp)}. {conflict && <Link className="link" to={`/runs/${conflict}`} onClick={onClose}>Acompanhar {conflict} →</Link>}
          </Callout>
        )}
        <Field label="Competência" help="Formato AAAA-MM.">
          <input className="input" type="month" value={comp} onChange={event => setComp(event.target.value)} required />
        </Field>

        <div className="stack" style={{ gap: 8 }}>
          <span className="field"><span>Arquivos</span></span>
          <OptionCard selected={source === 'pack'} onSelect={() => setSource('pack')} title="Usar data pack da competência">
            {hasPack ? (
              <div className="stack" style={{ gap: 6 }}>
                {state!.sources.filter(source => !source.embedded).map(file => (
                  <div key={file.name} className="row between" style={{ fontSize: 12.5 }}>
                    <span className="mono" style={{ overflow: 'hidden', textOverflow: 'ellipsis' }}>{file.name}</span>
                    <span className="row">{file.rows !== undefined && <span className="muted num">{count(file.rows)} linhas</span>}<HashChip hash={file.sha256} size={4} /></span>
                  </div>
                ))}
              </div>
            ) : <Callout tone="warning" icon="alert">Não há data pack de {periodShort(comp)} no servidor. Envie os arquivos ou aponte a pasta; senão o primeiro passo falha e lista o que falta.</Callout>}
          </OptionCard>
          <OptionCard selected={source === 'upload'} onSelect={() => setSource('upload')} title="Enviar arquivos">
            <input className="input" type="file" multiple accept=".csv,.xlsx,.eml,.ofx" style={{ height: 'auto', padding: 8 }}
              onChange={async event => {
                const list = Array.from(event.target.files || []);
                const uploaded = await run('upload', () => agent.uploadFiles(list));
                if (uploaded) setFiles(uploaded);
              }} />
            {busy === 'upload' && <p className="muted row" style={{ marginTop: 8 }}><span className="spin" /> Calculando SHA-256…</p>}
            {!!files.length && (
              <div className="stack" style={{ gap: 6, marginTop: 10 }}>
                {files.map(file => (
                  <div key={file.name} className="row between" style={{ fontSize: 12.5 }}>
                    <span className="mono">{file.name}</span>
                    <span className="row"><span className="muted">{bytes(file.size)}</span><HashChip hash={file.sha256} size={4} /></span>
                  </div>
                ))}
              </div>
            )}
            <div className="stack" style={{ gap: 4, marginTop: 10, fontSize: 12.5 }}>
              {expected.map(file => {
                const ok = !missing.includes(file);
                return <span key={file.prefix} className="row" style={{ color: ok ? 'var(--st-good-ink)' : 'var(--muted)' }}><Icon name={ok ? 'check' : 'circle'} />{file.name}</span>;
              })}
            </div>
            {agent.mode === 'mock' && <p className="help" style={{ marginTop: 8 }}>Nesta versão os arquivos são conferidos no navegador (nome, tamanho, SHA-256); o envio ao servidor depende do endpoint POST /api/files.</p>}
          </OptionCard>
          <OptionCard selected={source === 'folder'} onSelect={() => setSource('folder')} title="Importar de uma pasta no servidor">
            <Field label="Caminho completo da pasta" help="Mesmo padrão de nomes do data pack. A importação valida e preserva os originais.">
              <input className="input" value={folder} onChange={event => setFolder(event.target.value)} placeholder="/Users/voce/Downloads/data-pack-out2026" />
            </Field>
          </OptionCard>
        </div>

        <div className="card" style={{ padding: 14, boxShadow: 'none', background: 'var(--surface-2)' }}>
          <div className="row between">
            <div>
              <p className="muted" style={{ fontSize: 12 }}>Pipeline usado</p>
              <p style={{ fontWeight: 600 }}>{pipeline ? `${pipeline.name} v${pipeline.version}${steps ? ' + alterações não salvas' : ''}` : '…'} · {(steps || pipeline?.steps)?.filter(step => step.enabled).length ?? '–'} passos</p>
            </div>
            <Link className="link" to="/pipeline" onClick={onClose}>Abrir construtor <Icon name="arrowRight" /></Link>
          </div>
        </div>
      </div>
    </Sheet>
  );
}
