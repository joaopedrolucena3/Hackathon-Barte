import type { ReactNode } from 'react';
import { NavLink, useLocation } from 'react-router-dom';
import { agent } from '../api/agent';
import { useActor } from '../lib/actor';
import { CODE_VERSION } from '../lib/queryClient';
import { useAppState, useDataScope, useRun } from '../state/queries';
import { scopedUrl } from '../lib/scope';
import { Icon, type IconName } from './Icon';

function NavItem({ to, icon, label, count, match }: { to: string; icon: IconName; label: string; count?: number; match?: string }) {
  const { pathname } = useLocation();
  const active = pathname.startsWith(match || to);
  return (
    <NavLink to={to} className={`nav-link ${active ? 'active' : ''}`} aria-current={active ? 'page' : undefined} title={label}>
      <Icon name={icon} />
      <span>{label}</span>
      {!!count && <span className="nav-count">{count}</span>}
    </NavLink>
  );
}

export function Shell({ children }: { children: ReactNode }) {
  const { data: state } = useAppState();
  const [actor, setActor] = useActor();
  const selected = useDataScope();
  const { data: selectedRun } = useRun(selected.run_id || '');
  const comp = selected.comp || selectedRun?.comp || state?.period || '';
  const scope = { comp, run_id: selected.run_id || state?.run_id };
  const closingPath = comp ? scopedUrl(`/competencias/${comp}`, { run_id: scope.run_id }) : '/';
  const open = state?.summary.open_issues || 0;
  return (
    <div className="shell">
      <a className="sr-only" href="#main">Ir para o conteúdo</a>
      <aside className="sidebar" aria-label="Navegação principal">
        <NavLink to={closingPath} className="brand" aria-label="Tarvo, fechamento">
          <span className="brand-mark" aria-hidden>t</span>tarvo<span className="brand-dot">.</span>
        </NavLink>
        <p className="nav-label">Fechamento</p>
        <nav className="nav">
          <NavItem to={closingPath} match="/competencias" icon="overview" label="Fechamento" />
          <NavItem to={scopedUrl('/runs', scope)} match="/runs" icon="run" label="Execução" count={open} />
          <NavItem to={scopedUrl('/notas-bancos', scope)} match="/notas-bancos" icon="invoice" label="Notas e bancos" />
          <NavItem to="/cadastros" icon="records" label="Cadastros" />
          <NavItem to={scopedUrl('/pipeline', scope)} match="/pipeline" icon="pipeline" label="Pipeline" />
          <NavItem to="/comunicacoes" icon="mail" label="Comunicações" />
        </nav>
        <div className="sidebar-footer">
          <strong><span className="live-dot" /> Ambiente local</strong>
          Dados sintéticos do case. Conecte o Gmail em Comunicações para enviar mensagens e receber avisos de runs e testes. Cobranças do fluxo antigo são simuladas.{agent.mode === 'mock' && <><br />Agente em modo demonstração.</>}
        </div>
      </aside>
      <div className="workspace">
        <header className="topbar">
          <div className="topbar-context" id="topbar-context" />
          <div className="topbar-right">
            <label className="actor-field">
              <Icon name="user" />
              <span className="sr-only">Responsável</span>
              <input value={actor} onChange={event => setActor(event.target.value)} placeholder="Seu nome" maxLength={100} autoComplete="name" aria-label="Responsável pelas ações" />
            </label>
            <span className="pill-sim"><span className="live-dot" /> {agent.mode === 'mock' ? 'Demonstração' : 'Ambiente local'}</span>
          </div>
        </header>
        <main className="main" id="main" tabIndex={-1}>{children}</main>
        <footer className="footer-seal">
          <span>Tarvo · cada número tem uma origem.</span>
          <span className="mono">código {CODE_VERSION}{agent.mode === 'mock' ? ' · agente: demonstração no navegador' : ' · execuções persistidas'}</span>
        </footer>
      </div>
    </div>
  );
}
