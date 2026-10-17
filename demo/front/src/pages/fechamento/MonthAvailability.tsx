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
  return <><Icon name="calendar" /><span>Competência</span><select className="select sm" style={{ width: 'auto', minWidth: 120 }} value={comp} aria-label="Competência" onChange={event => onChange(event.target.value)}>{options.map(item => <option key={item.comp} value={item.comp}>{periodShort(item.comp)}{item.has_data ? '' : item.has_pack ? ' · pack disponível' : ' · sem entradas'}</option>)}</select></>;
}

export function UnstartedMonth({ comp, hasPack, deadline, onLaunch, onConfigure }: { comp: string; hasPack?: boolean; deadline?: string | null; onLaunch: () => void; onConfigure: () => void }) {
  return <div className="stack-lg"><PageHead eyebrow="Fechamento mensal" title={capitalize(periodLong(comp))} sub={<>Esta competência ainda não possui resultados calculados.{deadline && <> Prazo operacional: {dateBR(deadline)}.</>}</>}
    actions={<><button className="btn" onClick={onConfigure}><Icon name="calendar" />Prazo do mês</button><button className="btn primary lg" onClick={onLaunch}><Icon name="play" />Rodar fechamento</button></>} />
    <Callout tone="info" icon="info">{hasPack ? `O pack de ${periodShort(comp)} foi reconhecido pelo servidor. Clique em Rodar fechamento para usar esse pack, enviar arquivos ou selecionar uma pasta.` : 'Clique em Rodar fechamento para enviar as fontes desta competência ou indicar uma pasta no servidor.'}</Callout>
    <div className="card card-body"><strong>Comece pelas fontes do mês</strong><p className="text-2" style={{ marginTop: 6 }}>A aplicação validará cada arquivo e criará uma execução com resultados e revisão próprios. Nenhum valor de outra competência será exibido nesta seleção.</p></div>
  </div>;
}
