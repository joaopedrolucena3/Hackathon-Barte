import type { ReviewException } from '../api/agent';
import { plural } from '../lib/format';
import { Money } from './ui';

/** Missing values must remain visible; a known subtotal is never labeled as the group's total. */
export function ExceptionExposure({ exception }: { exception: ReviewException }) {
  if (exception.exposure_status === 'partial') return <span>
    <Money value={exception.known_exposure_brl} />
    <span className="muted" style={{ display: 'block', fontSize: 11 }}>Subtotal conhecido · {exception.missing_exposure_count === undefined ? 'há valores não calculados' : plural(exception.missing_exposure_count, 'valor não calculado', 'valores não calculados')}</span>
  </span>;
  if (exception.exposure_status === 'unavailable' || exception.impact_brl === null) return <span className="muted">Não calculado</span>;
  return <Money value={exception.impact_brl} />;
}
