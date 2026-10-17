import { useEffect, useRef, useState, type ReactNode } from 'react';
import { Link, NavLink, useLocation } from 'react-router-dom';
import { agent } from '../api/agent';
import { useActor } from '../lib/actor';
import { CODE_VERSION } from '../lib/queryClient';
import { lastComp, useAppState, useApprovalSummary, useRuns } from '../state/queries';
import { Icon, type IconName } from './Icon';

function NavItem({ to, icon, label, count, match }: { to: string; icon: IconName; label: string; count?: number; match?: string | ((pathname: string) => boolean) }) {
  const { pathname } = useLocation();
  const active = typeof match === 'function' ? match(pathname) : pathname.startsWith(match || to);
  return (
    <Link to={to} className={`nav-link ${active ? 'active' : ''}`} aria-current={active ? 'page' : undefined} title={label}>
      <Icon name={icon} />
      <span>{label}</span>
      {!!count && <span className="nav-count">{count}</span>}
    </Link>
  );
}

/** The declared analyst lives behind an avatar: it signs every action but is not something to look at all day. */
function ActorMenu() {
  const [actor, setActor] = useActor();
  const [open, setOpen] = useState(false);
  const ref = useRef<HTMLDivElement>(null);
  useEffect(() => {
    if (!open) return;
    const close = (event: MouseEvent) => { if (!ref.current?.contains(event.target as Node)) setOpen(false); };
    const escape = (event: KeyboardEvent) => { if (event.key === 'Escape') setOpen(false); };
    document.addEventListener('mousedown', close);
    document.addEventListener('keydown', escape);
    return () => { document.removeEventListener('mousedown', close); document.removeEventListener('keydown', escape); };
  }, [open]);
  const initials = actor.trim().split(/\s+/).slice(0, 2).map(part => part[0]).join('') || '?';
  return (
    <div className="avatar-menu" ref={ref}>
      <button type="button" className="avatar-btn" aria-expanded={open} aria-haspopup="dialog" onClick={() => setOpen(value => !value)}>
        <span className="avatar" aria-hidden>{initials}</span>
        <span>{actor || 'Identificar-se'}</span>
        <Icon name="chevronDown" size={14} />
      </button>
      {open && (
        <div className="avatar-pop" role="dialog" aria-label="Responsável pelas ações">
          <label className="field">
            <span>Responsável pelas ações</span>
            <input className="input sm" autoFocus value={actor} onChange={event => setActor(event.target.value)} placeholder="Seu nome" maxLength={100} autoComplete="name" />
            <small>Assina aprovações, decisões e edições.</small>
          </label>
          <p className="mono muted">código {CODE_VERSION}{agent.mode === 'mock' ? ' · agente no navegador' : ' · execuções persistidas'}</p>
        </div>
      )}
    </div>
  );
}

export function Shell({ children }: { children: ReactNode }) {
  const { data: state } = useAppState();
  const comp = state ? lastComp(state.period) : '';
  // Same figure as the Revisão tab: undecided exceptions of the latest run waiting for a human.
  const { data: runs } = useRuns(comp);
  const latest = runs?.find(run => !run.draft);
  const { data: approval } = useApprovalSummary(latest?.id || '', latest?.status === 'awaiting_approval');
  const open = latest?.status === 'awaiting_approval' && approval ? approval.total - approval.decided : 0;
  return (
    <div className="shell">
      <a className="sr-only" href="#main">Ir para o conteúdo</a>
      <aside className="sidebar" aria-label="Navegação principal">
        <NavLink to={comp ? `/competencias/${comp}` : '/'} className="brand" aria-label="Tarvo, fechamento">
          <span className="brand-mark" aria-hidden>t</span>tarvo
        </NavLink>
        <p className="nav-label">Fechamento</p>
        <nav className="nav">
          <NavItem to={comp ? `/competencias/${comp}` : '/'} match="/competencias" icon="overview" label="Visão geral" />
          <NavItem to="/revisao" icon="alert" label="Revisão" count={open} match={path => path.startsWith('/runs/') && path.endsWith('/revisao')} />
          <NavItem to="/runs" icon="run" label="Execuções" match={path => path.startsWith('/runs') && !path.endsWith('/revisao')} />
        </nav>
        <p className="nav-label">Dados</p>
        <nav className="nav">
          <NavItem to="/notas-bancos" icon="invoice" label="Notas e bancos" />
          <NavItem to="/cadastros" icon="records" label="Cadastros" />
        </nav>
        <p className="nav-label">Configuração</p>
        <nav className="nav">
          <NavItem to="/pipeline" icon="pipeline" label="Fluxo do agente" />
          <NavItem to="/comunicacoes" icon="mail" label="Comunicações" />
        </nav>
        <div className="sidebar-footer" title="Dados sintéticos do case. Gmail de pendências exige conexão e aprovação. Cobranças e avisos são simulados.">
          <span className="live-dot" />{agent.mode === 'mock' ? 'Demonstração' : 'Ambiente local'}
        </div>
      </aside>
      <div className="workspace">
        <header className="topbar">
          <div className="topbar-context" id="topbar-context" />
          <div className="topbar-right">
            <ActorMenu />
          </div>
        </header>
        <main className="main" id="main" tabIndex={-1}>{children}</main>
      </div>
    </div>
  );
}
