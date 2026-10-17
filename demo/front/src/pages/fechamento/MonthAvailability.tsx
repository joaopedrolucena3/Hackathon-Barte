import type { CompetenciaInfo } from '../../api/agent';
import { ApiError } from '../../api/http';
import { Icon } from '../../components/Icon';
import { Callout, PageHead } from '../../components/ui';
import { capitalize, dateBR, periodLong, periodShort } from '../../lib/format';

/** An absent initial calculation is a launchable month; a missing/mismatched snapshot is an error. */
export function isUnstartedMonth(error: unknown, selectedRun?: string) {
  return !selectedRun && error instanceof ApiError && (error.data?.error as { code?: string })?.code === 'PERIOD_WITHOUT_INPUTS';
}

export function MonthSelector({ comp, months = [], onChange }: { comp: string; months?: CompetenciaInfo[]; onChange: (comp: string) => void }) {
  const options = months.some(item => item.comp === comp) ? months : [...months, { comp, has_data: false, current: false }];
  return <><Icon name="calendar" /><span>Competência</span><select className="select sm" style={{ width: 'auto', minWidth: 120 }} value={comp} aria-label="Competência" onChange={event => onChange(event.target.value)}>{options.map(item => <option key={item.comp} value={item.comp}>{periodShort(item.comp)}{item.has_data ? '' : item.has_pack ? ' · arquivos disponíveis' : ' · sem entradas'}</option>)}</select></>;
}

export function UnstartedMonth({ comp, hasPack, deadline, onLaunch, onConfigure }: { comp: string; hasPack?: boolean; deadline?: string | null; onLaunch: () => void; onConfigure: () => void }) {
  return <div className="stack-lg"><PageHead eyebrow="Fechamento mensal" title={capitalize(periodLong(comp))} sub={<>Sem resultados calculados.{deadline && <> Prazo interno: {dateBR(deadline)}.</>}</>}
    actions={<><button className="btn" onClick={onConfigure}><Icon name="calendar" />Prazo do mês</button><button className="btn primary lg" onClick={onLaunch}><Icon name="play" />Calcular fechamento</button></>} />
    <Callout tone="info" icon="info">{hasPack ? `Arquivos de ${periodShort(comp)} disponíveis. Ao calcular, você também pode enviar arquivos ou indicar uma pasta.` : 'Envie os arquivos do mês ou indique uma pasta no servidor para calcular o fechamento.'}</Callout>
  </div>;
}
