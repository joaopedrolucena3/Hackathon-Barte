// Who ran the closing, when, and how long the agent took (waiting for a human is not processing time).
import type { Run } from '../api/agent';
import { dateTimeBR, duration, plural, shortHash } from '../lib/format';

export function RunSummaryCard({ run }: { run: Run }) {
  const processing = run.steps.filter(step => step.kind !== 'gate').reduce((sum, step) => sum + (step.duration_ms || 0), 0);
  const done = run.steps.filter(step => ['done', 'exceptions', 'approved'].includes(step.status)).length;
  return (
    <div className="card wb-summary">
      <p className="eyebrow">Resumo da execução</p>
      <dl className="wb-facts">
        <div><dt>Rodado por</dt><dd>{run.created_by}</dd></div>
        <div><dt>Quando</dt><dd>{dateTimeBR(run.created_at)}</dd></div>
        <div><dt>Processamento</dt><dd className="num">{duration(processing)}</dd></div>
        <div><dt>Passos</dt><dd className="num">{done} de {run.steps.length} concluídos</dd></div>
        <div><dt>Pipeline</dt><dd>v{run.pipeline.version} · {plural(run.files.filter(file => !file.name.includes('::')).length, 'arquivo', 'arquivos')}</dd></div>
        <div><dt>Código</dt><dd className="mono" title={run.code_version}>{shortHash(run.code_version, 10)}</dd></div>
      </dl>
    </div>
  );
}
