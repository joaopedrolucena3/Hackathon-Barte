import type { IngestionCounts, InputFile } from '../api/agent';
import { count } from '../lib/format';
import { Badge, HashChip } from './ui';

export const SOURCE_ROLES = [
  ['orbe', 'Relatórios Orbe', 'Um ou mais relatórios, incluindo complementos'],
  ['taxas', 'Contratos e taxas', 'Uma fonte contratual validada'],
  ['ponte', 'Relatório Ponte', 'Uma fonte de remessas validada'],
  ['contas', 'Plano de contas', 'Uma fonte validada'],
  ['aurora', 'Extrato Aurora', 'Um extrato validado'],
  ['meridiano', 'Extrato Meridiano', 'Um extrato validado'],
] as const;
export const roleLabel = (role?: string) => SOURCE_ROLES.find(([key]) => key === role)?.[1] || role || 'Fonte não identificada';
export function inputStatus(file: InputFile) {
  const value = file.import_action === 'duplicate_receipt' ? 'duplicate' : file.status || (file.id ? 'received' : 'unknown');
  const labels: Record<string, string> = { accepted: 'Validado', valid: 'Estrutura reconhecida', received: 'Recebido', imported: 'Importado', rejected: 'Rejeitado', invalid: 'Inválido', empty: 'Arquivo vazio', empty_file: 'Arquivo vazio', header_only: 'Somente cabeçalho', duplicate: 'Recebimento duplicado', duplicated: 'Recebimento duplicado', ambiguous: 'Fonte ambígua', incompatible: 'Layout incompatível', pending: 'A validar', unknown: 'A validar' };
  return { label: labels[value] || value.replaceAll('_', ' '), rejected: ['rejected', 'invalid', 'empty', 'empty_file', 'header_only', 'incompatible', 'ambiguous'].includes(value) };
}
export function InputManifest({ files, compact = false }: { files: InputFile[]; compact?: boolean }) {
  if (!files.length) return null;
  return <div className="stack" style={{ gap: 8 }} aria-label="Manifesto de arquivos apresentados">{files.map((file, index) => {
    const status = inputStatus(file);
    return <div className="card" key={`${file.id || file.sha256}-${index}`} style={{ padding: compact ? 10 : 14, boxShadow: 'none' }}>
      <div className="row between wrap"><strong className="mono" style={{ fontSize: 12, overflowWrap: 'anywhere' }}>{file.name}</strong><Badge tone={status.rejected ? 'critical' : file.status === 'accepted' || file.status === 'valid' ? 'good' : 'info'}>{status.label}</Badge></div>
      <p className="muted" style={{ marginTop: 5, fontSize: 12 }}>{roleLabel(file.role)}{file.inherited ? ' · herdado da execução anterior' : ''}</p>
      <div className="row wrap muted" style={{ marginTop: 5, fontSize: 12 }}>
        {(file.rows_received ?? file.rows) !== undefined && <span>{count(file.rows_received ?? file.rows ?? 0)} recebidas</span>}
        {file.rows_valid !== undefined && <span>{count(file.rows_valid)} válidas</span>}
        {file.rows_unique !== undefined && <span>{count(file.rows_unique)} únicas</span>}
        {file.rows_duplicated !== undefined && <span>{count(file.rows_duplicated)} duplicadas</span>}
        {file.rows_conflicting !== undefined && <span>{count(file.rows_conflicting)} conflitantes</span>}
        {!!file.discarded && <span>{count(file.discarded)} inválidas</span>}
        <HashChip hash={file.sha256} size={12} />
      </div>
      {file.validation_reason && <p className={status.rejected ? 'text-critical' : 'text-2'} style={{ marginTop: 6, fontSize: 12 }}>{file.validation_reason}</p>}
    </div>;
  })}</div>;
}

export function IngestionSummary({ counts }: { counts?: IngestionCounts }) {
  if (!counts?.by_role) return null;
  const columns = [['rows_received', 'Recebidas'], ['rows_valid', 'Válidas'], ['rows_discarded', 'Inválidas'], ['rows_unique', 'Únicas'], ['rows_duplicate', 'Duplicadas'], ['rows_conflicting', 'Conflitantes']] as const;
  return <div className="stack" style={{ gap: 8 }}><strong>Conferência das entradas</strong><p className="help">Contagens do conjunto completo. Recebimentos repetidos permanecem no manifesto; operações únicas são apuradas pelo motor.</p><div className="table-wrap"><table className="table"><thead><tr><th>Fonte</th>{columns.map(([key, label]) => <th key={key} className="r">{label}</th>)}</tr></thead><tbody>{Object.entries(counts.by_role).map(([role, values]) => <tr key={role}><td>{roleLabel(role)}</td>{columns.map(([key]) => <td className="r num" key={key}>{typeof values[key] === 'number' ? count(values[key]) : '—'}</td>)}</tr>)}</tbody></table></div></div>;
}
