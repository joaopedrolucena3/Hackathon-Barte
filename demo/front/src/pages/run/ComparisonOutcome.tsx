import type { RunComparison } from '../../api/agent';
import { Callout, HashChip } from '../../components/ui';
export function ComparisonOutcome({ result }: { result: RunComparison }) {
  return <div className="stack" style={{ gap: 8 }}>
    {result.reproducible ? <Callout tone="good" icon="check"><strong>Resultados e regras equivalentes.</strong> O motor confirmou a equivalência dos dados econômicos únicos, contratos, parâmetros, valores e partidas.</Callout>
      : <Callout tone="warning" icon="alert"><strong>Há diferenças nos resultados ou regras.</strong> Confira operações, contratos, parâmetros e decisões nas duas execuções.</Callout>}
    {result.binary_identical !== undefined && <p className="help">{result.binary_identical ? 'Arquivos e snapshots idênticos na comparação binária.' : 'Arquivos ou snapshots diferentes na comparação binária. Recebimentos e proveniências são preservados na auditoria de cada execução.'}</p>}
    {result.comparison_basis && <p className="help">Critério: {result.comparison_basis}</p>}
    {(result.business_hash_a || result.business_hash_b) && <div className="row wrap muted" style={{ fontSize: 12 }}><span>Assinaturas dos resultados e regras:</span><HashChip hash={result.business_hash_a || ''} /><HashChip hash={result.business_hash_b || ''} /></div>}
  </div>;
}
