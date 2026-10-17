/* Tarvo local UI. Financial values are supplied by the backend, never calculated here. */
'use strict';

const $ = (selector, scope = document) => scope.querySelector(selector);
const escapeHtml = value => String(value ?? '').replace(/[&<>"']/g, c => ({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c]));
const attr = escapeHtml;
const money = value => value === undefined || value === null || value === '' ? '—' : new Intl.NumberFormat('pt-BR', {style:'currency', currency:'BRL'}).format(Number(value));
const count = value => new Intl.NumberFormat('pt-BR').format(Number(value || 0));
const dateTime = value => !value ? '—' : Number.isNaN(new Date(value).getTime()) ? escapeHtml(value) : new Date(value).toLocaleString('pt-BR', {dateStyle:'short', timeStyle:'short'});
const periodName = value => !value ? 'Competência não informada' : new Date(`${value}-15T12:00:00`).toLocaleDateString('pt-BR', {month:'long',year:'numeric'}).replace(/^./, s => s.toUpperCase());
const displayDate = value => /^\d{4}-\d{2}-\d{2}$/.test(String(value)) ? value.split('-').reverse().join('/') : escapeHtml(value || '—');
const array = value => Array.isArray(value) ? value : [];
const stringify = value => typeof value === 'object' ? JSON.stringify(value, null, 2) : String(value ?? '');
const identifier = row => row.id_saida || row.id || row.ref_origem || '';
const productNames = {DEBITO:'Débito',CREDITO_A_VISTA:'Crédito à vista',CREDITO_2_6:'Crédito de 2 a 6 parcelas',CREDITO_7_12:'Crédito de 7 a 12 parcelas',PIX:'Pix',ANTECIPACAO:'Antecipação',REMESSA:'Remessa'};
const issueNames = {CADASTRO_NAO_CONFIRMADO:'Cadastro não confirmado',COMISSAO_NEGATIVA:'Comissão negativa',CREDITO_NAO_IDENTIFICADO:'Crédito não identificado',DEVOLUCAO_REPASSE:'Devolução de repasse',DIVERGENCIA_TAXA:'Divergência de taxa',DUPLICIDADE:'Operação duplicada',SPREAD_NEGATIVO:'Spread negativo',TRANSFERENCIA_EM_TRANSITO:'Transferência em trânsito',TAXA_NAO_ENCONTRADA:'Taxa não encontrada',CONTRATO_AUSENTE:'Contrato ausente'};
const readable = value => issueNames[value] || String(value || '').replaceAll('_',' ').toLocaleLowerCase('pt-BR').replace(/^./, c=>c.toLocaleUpperCase('pt-BR'));
const auditNames = {decision:'Decisão do analista',close:'Fechamento concluído',reopen:'Fechamento reaberto',rate_edit:'Taxa alterada',merchant_edit:'Lojista alterado',parameter_edit:'Parâmetro alterado',contact_edit:'Contato alterado',notifications_run:'Alertas processados',import:'Fontes importadas',recalculate:'Fechamento recalculado',email_draft:'Rascunho criado',email_save:'Rascunho salvo',email_approve:'E-mail aprovado',email_send:'Envio simulado'};


const icons = {
  overview:'<rect x="3" y="3" width="7" height="7" rx="1"/><rect x="14" y="3" width="7" height="7" rx="1"/><rect x="3" y="14" width="7" height="7" rx="1"/><rect x="14" y="14" width="7" height="7" rx="1"/>',
  issues:'<path d="M10.3 4.4 2 19h20L13.7 4.4a2 2 0 0 0-3.4 0Z"/><path d="M12 9v4m0 3v.1"/>',
  commissions:'<path d="M3 17 9 11l4 4 8-10m-5 0h5v5"/><path d="M4 21h17"/>',
  differences:'<path d="M4 7h16m-4-4 4 4-4 4M20 17H4m4-4-4 4 4 4"/>',
  invoices:'<path d="M6 3h12v18l-3-2-3 2-3-2-3 2V3Z"/><path d="M9 7h6m-6 4h6m-6 4h3"/>',
  banks:'<path d="m3 8 9-5 9 5H3Zm0 13h18M5 10v8m5-8v8m4-8v8m5-8v8M3 18h18"/>',
  records:'<path d="M12 8v8m-4-4h8"/><rect x="3" y="3" width="18" height="18" rx="3"/>',
  evidence:'<path d="M14 3H5v18h14V8l-5-5Z"/><path d="M14 3v5h5M8 12h8m-8 4h6"/>',
  emails:'<rect x="3" y="5" width="18" height="14" rx="2"/><path d="m3 6 9 7 9-7"/>',
  audit:'<path d="M3 11a9 9 0 1 1 2.6 7M3 5v6h6m3-4v6l4 2"/>',
  calendar:'<rect x="3" y="5" width="18" height="16" rx="2"/><path d="M7 3v4m10-4v4M3 11h18m-13 4h2m4 0h2"/>',
  download:'<path d="M12 3v12m-4-4 4 4 4-4M4 16v5h16v-5"/>',
  refresh:'<path d="M20 7v5h-5M4 17v-5h5"/><path d="M6.1 7A7 7 0 0 1 18 5l2 2M4 17l2 2a7 7 0 0 0 11.9-2"/>',
  arrow:'<path d="M4 12h16m-6-6 6 6-6 6"/>',
  search:'<circle cx="10.5" cy="10.5" r="6.5"/><path d="m16 16 5 5"/>',
  check:'<path d="m5 12 4 4L19 6"/>',
  trace:'<circle cx="6" cy="6" r="3"/><circle cx="18" cy="18" r="3"/><path d="M9 6h6a3 3 0 0 1 3 3v6M6 9v9h9"/>',
  plus:'<path d="M12 5v14M5 12h14"/>',
  info:'<circle cx="12" cy="12" r="9"/><path d="M12 11v6m0-10v.1"/>',
  edit:'<path d="m14 5 5 5M4 20l4-1L20 7a2 2 0 0 0-4-4L4 15v5Z"/>',
  close:'<rect x="5" y="10" width="14" height="11" rx="2"/><path d="M8 10V7a4 4 0 0 1 8 0v3"/>',
  source:'<path d="M8 3H4v18h16V7l-4-4H8Z"/><path d="M15 3v5h5M8 12h8m-8 4h5"/>',
};
const icon = name => `<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true">${icons[name] || icons.source}</svg>`;
const nav = [
  ['overview','Resumo','overview'],['issues','Pendências','issues'],['commissions','Comissões','commissions'],['differences','Divergências','differences'],['invoices','Notas e cobranças','invoices'],['banks','Bancos','banks'],['records','Cadastros','records'],['evidence','Evidências e hipóteses','evidence'],['emails','E-mails','emails'],['audit','Auditoria','audit'],
];
const exportsList = [
  ['comissoes_por_lojista.csv','Comissões por lojista','Checkout e remessa'],['divergencias_taxa.csv','Divergências de taxa','Diferenças por transação'],['notas_a_emitir.csv','Notas a emitir','Tomadores e discriminação'],['lancamentos_classificados.csv','Lançamentos classificados','Contas e método'],['pendencias.csv','Pendências','Motivo e responsável'],['rastro.csv','Rastro completo','Origem de cada valor'],
];
const labels = {id_saida:'Identificador',cnpj:'CNPJ',lojista:'Lojista',linha_negocio:'Linha de negócio',comissao_brl:'Comissão',ref_origem:'Referência de origem',taxa_contratada_pct:'Taxa contratada',taxa_aplicada_pct:'Taxa aplicada',diferenca_brl:'Diferença',tomador_cnpj:'CNPJ do tomador',tomador:'Tomador',valor_brl:'Valor',discriminacao:'Discriminação',banco:'Banco',data:'Data',descricao:'Descrição',valor:'Valor',conta_codigo:'Conta contábil',metodo:'Método',confianca:'Confiança',tipo:'Tipo',motivo:'Motivo',quem_decide:'Quem decide',severity:'Severidade',suggestion:'Encaminhamento sugerido',evidence:'Evidência',rule:'Regra aplicada',status:'Situação',arquivo_origem:'Arquivo de origem',regra:'Regra',formula:'Fórmula',name:'Nome',ec:'Estabelecimento',active:'Ativo',product:'Produto',start:'Início da vigência',end:'Fim da vigência',rate_pct:'Taxa contratada',code:'Código',postable:'Aceita lançamento',source_ref:'Referência de origem',source_file:'Arquivo de origem',decision:'Decisão',actor:'Responsável',at:'Data e hora',action:'Ação',detail:'Detalhes',to:'Destinatário',subject:'Assunto',body:'Conteúdo',kind:'Finalidade',min_severity:'Severidade mínima',frequency:'Frequência',enabled:'Ativo',rows:'Linhas',sha256:'Integridade SHA-256',source:'Fonte',question:'Questão',impact:'Impacto',approved_by:'Aprovado por',approved_at:'Aprovação em',sent_at:'Simulado em',related_id:'Item vinculado',created_at:'Criado em',signature:'Assinatura',rate_date:'Data usada para vigência',original_sale_date:'Data da venda original',contract:'Contrato aplicado',source_row:'Linha física do arquivo',entrada:'Dados da operação',gross:'Valor bruto',applied_rate_pct:'Taxa aplicada',foreign_amount:'Valor em moeda estrangeira',ptax_rate:'PTAX',spread_brl:'Spread realizado',source_line:'Linha da fonte',source_refs:'Referências de origem',reference:'Referência',currency:'Moeda',rate:'Taxa',applied_fee:'Taxa cobrada em reais',fee:'Tarifa',net:'Valor líquido',sale_date:'Data da venda',movement_date:'Data do movimento',arquivo:'Arquivo',linha:'Linha',ref:'Referência',note:'Justificativa',reason:'Justificativa',before:'Antes da alteração',after:'Depois da alteração',mode:'Modo',title:'Assunto',event:'Evento',deliveries:'Entregas simuladas',link:'Referência na plataforma',period:'Competência',id:'Identificador',transaction_id:'Transação',original_id:'Transação original',account_code:'Conta contábil',signature:'Assinatura da decisão'};

let state = null;
let activePage = nav.some(([key]) => key === location.hash.slice(1)) ? location.hash.slice(1) : 'overview';
let recordTab = 'merchants', evidenceTab = 'sources', emailTab = 'emails';
const tableState = {};
let dialogSubmit = null, toastTimer, loading = false;
const actorInput = $('#actor');
try { actorInput.value = sessionStorage.getItem('tarvo-actor') || ''; } catch (_) { /* storage may be disabled */ }
actorInput.addEventListener('input', () => { try { sessionStorage.setItem('tarvo-actor', actorInput.value); } catch (_) {} });

function button(text, action, options = {}) {
  return `<button type="button" class="button ${options.class || ''}" data-action="${attr(action)}" ${options.id !== undefined ? `data-id="${attr(options.id)}"` : ''} ${options.value !== undefined ? `data-value="${attr(options.value)}"` : ''} ${options.disabled ? 'disabled' : ''}>${options.icon ? icon(options.icon) : ''}${escapeHtml(text)}</button>`;
}
function exportLink(file, text = 'Baixar CSV') { return `<a class="button" href="/api/export?file=${encodeURIComponent(file)}" download>${icon('download')}${escapeHtml(text)}</a>`; }
function badge(value) {
  const all = {open:['Aberta','amber'],resolved:['Resolvida','green'],rejected:['Rejeitada · aberta','red'],closed:['Concluído','green'],informativo:['Informativo','blue'],atencao:['Atenção','amber'],bloqueante:['Bloqueante','red'],draft:['Rascunho','neutral'],approved:['Aprovado','green'],simulated:['Envio simulado','blue'],sent:['Envio simulado','blue'],REGRA:['Regra','green'],HUMANO:['Humano','blue'],IA:['IA','amber'],CHECKOUT:['Checkout','blue'],REMESSA:['Remessa','neutral'],billing:['Cobrança','neutral'],dispute:['Contestação','amber'],internal:['Interno','blue'],hipotese_explicita:['Hipótese explícita','amber'],parametro:['Parâmetro configurável','blue'],pendencia:['Pendente de revisão','amber'],esclarecido:['Esclarecido','green'],limite_mvp:['Limite do MVP','neutral'],pendencia_logistica:['Logística pendente','amber'],arquitetura:['Decisão de arquitetura','neutral']};
  const [label,color] = all[value] || [String(value || 'Não informado'),'neutral'];
  return `<span class="badge ${color}">${escapeHtml(label)}</span>`;
}
function closed() { return state?.closing?.status === 'closed'; }
function issues() { return array(state?.results?.pendencias); }
function openIssues() { return issues().filter(row => row.status !== 'resolved'); }
function actor() {
  const modalActor = $('#dialog').open ? $('[name="actor_name"]', $('#dialog')) : null;
  const name = (modalActor ? modalActor.value : actorInput.value).trim();
  if (name) { actorInput.value = name; try { sessionStorage.setItem('tarvo-actor', name); } catch (_) {} }
  if (!name) { actorInput.focus(); throw new Error('Informe seu nome em “Analista responsável” antes de registrar uma ação.'); }
  return name;
}
function toast(message, error = false) {
  clearTimeout(toastTimer); const node = $('#toast'); node.textContent = message; node.classList.toggle('error', error); node.hidden = false;
  toastTimer = setTimeout(() => { node.hidden = true; }, error ? 9000 : 5500);
}
async function api(path, body) {
  const response = await fetch(path, body === undefined ? {cache:'no-store'} : {method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({...body,actor:actor()})});
  const result = await response.json();
  if (!response.ok || result.error) throw new Error(result.error || `Não foi possível concluir a ação (${response.status}).`);
  return result;
}
async function loadState() {
  state = await api('/api/state');
  render();
}
async function mutation(path, data, message) {
  await api(path, data); await loadState(); if (message) toast(message);
}
function heading(eyebrow, title, description, actions = '') {
  return `<div class="page-heading"><div><p class="eyebrow">${escapeHtml(eyebrow)}</p><h1>${escapeHtml(title)}</h1><p class="subtext">${escapeHtml(description)}</p></div><div class="heading-actions">${actions}</div></div>`;
}
function periodBar() {
  return `<div class="period-bar"><div class="period-left"><div class="period-icon">${icon('calendar')}</div><div><div class="period-label">Competência em análise</div><div class="period-name">${escapeHtml(periodName(state.period))}</div></div></div><div class="period-meta"><span>${array(state.sources).length} fontes importadas</span>${badge(closed() ? 'closed' : 'open')}<span>${closed() ? `Por ${escapeHtml(state.closing.actor || 'analista')} · ${dateTime(state.closing.closed_at)}` : 'Revisão e decisões em andamento'}</span></div></div>`;
}
function empty(title, detail = '') { return `<div class="empty">${icon('check')}<h3>${escapeHtml(title)}</h3><p>${escapeHtml(detail)}</p></div>`; }
function navRender() {
  $('#navigation').innerHTML = nav.map(([key,name,img],i) => `${i === 6 ? '<div class="nav-section">GESTÃO E CONTROLE</div>' : ''}<a href="#${key}" class="nav-link ${activePage === key ? 'active' : ''}" ${activePage === key ? 'aria-current="page"' : ''} title="${attr(name)}">${icon(img)}<span>${escapeHtml(name)}</span>${key === 'issues' && openIssues().length ? `<span class="nav-count">${count(openIssues().length)}</span>` : ''}</a>`).join('');
}
function render() {
  navRender();
  const pages = {overview:renderOverview,issues:renderIssues,commissions:renderCommissions,differences:renderDifferences,invoices:renderInvoices,banks:renderBanks,records:renderRecords,evidence:renderEvidence,emails:renderEmails,audit:renderAudit};
  $('#app').innerHTML = pages[activePage]();
  document.title = `${nav.find(([key]) => key === activePage)?.[1] || 'Resumo'} · Tarvo`;
}

function renderOverview() {
  const summary = state.summary || state.results?.summary || {};
  const pending = openIssues(), blocking = pending.filter(row => row.severity === 'bloqueante');
  const groups = new Map();
  for (const row of pending) { const key = `${row.tipo}|${row.cnpj || ''}`; if (!groups.has(key)) groups.set(key,{...row,groupCount:0}); groups.get(key).groupCount++; }
  const important = [...groups.values()].sort((a,b) => ({bloqueante:0,atencao:1,informativo:2}[a.severity] ?? 3)-({bloqueante:0,atencao:1,informativo:2}[b.severity] ?? 3)).slice(0,3);
  const kpis = [
    ['Comissão de checkout', money(summary.checkout_brl), `${count(summary.checkout_count)} transações na origem`,'commissions',''],
    ['Comissão de remessas', money(summary.remessa_brl), `${count(summary.remessa_count)} operações na origem`,'differences',''],
    ['Exposição em divergências', money(summary.divergencias_abs_brl), `${count(array(state.results?.divergencias).length)} diferenças para revisão`,'issues','attention'],
    ['Notas a emitir', money(summary.notas_brl), `${count(array(state.results?.notas).length)} notas calculadas`,'invoices',''],
  ];
  return heading('CENTRAL DE FECHAMENTO','Fechamento do mês','Do dado de origem à decisão do analista, em um só lugar.',`${button('Recalcular','recalculate',{icon:'refresh'})}${button(closed() ? 'Reabrir mês' : 'Concluir fechamento',closed() ? 'reopen' : 'close',{class:'primary',icon:'close'})}`)+periodBar()+
    `<div class="callout warn" style="margin-bottom:20px">${icon('info')}<span><strong>Valores provisórios.</strong> Operações sem contrato confirmado permanecem pendentes e não compõem a comissão calculada. A exposição soma as diferenças em valor absoluto; o rastro preserva o sinal de cada linha.</span></div><div class="kpi-grid">${kpis.map(([label,value,detail,img,cls]) => `<article class="kpi ${cls}"><div class="kpi-label">${label}${icon(img)}</div><div class="kpi-value">${value}</div><div class="kpi-detail">${detail}</div></article>`).join('')}</div>`+
    `<div class="overview-grid"><section class="panel"><div class="panel-header"><div><h2>O que precisa de você</h2><p>${count(pending.length)} pendências abertas${blocking.length ? ` · ${count(blocking.length)} bloqueantes` : ''}</p></div><a class="text-link" href="#issues">Ver todas →</a></div><div class="panel-body">${important.length ? important.map(row => `<div class="issue-preview"><div class="issue-severity ${row.severity === 'bloqueante' ? 'red' : ''}">${icon('issues')}</div><div class="issue-preview-content"><h3>${escapeHtml(readable(row.tipo) || 'Revisão necessária')}${row.groupCount>1?` <span class="count-chip">${count(row.groupCount)} itens</span>`:''}</h3><p>${escapeHtml(row.motivo)}</p><div class="issue-preview-meta">${badge(row.severity)}<span>${escapeHtml(row.quem_decide || 'Analista financeiro')}</span></div></div><button class="icon-button" data-action="review" data-id="${attr(identifier(row))}" aria-label="Revisar ${attr(identifier(row))}">${icon('arrow')}</button></div>`).join('') : empty('Tudo revisado por aqui','Não há pendências abertas nesta competência.')}</div></section>
    <section class="panel"><div class="panel-header"><div><h2>Seu caminho até o fechamento</h2><p>Controle em cada etapa</p></div></div><div class="panel-body">
      <div class="step"><div class="step-circle done">✓</div><div><h3>Fontes importadas</h3><p>${array(state.sources).length} arquivos preservados e identificados.</p></div></div>
      <div class="step"><div class="step-circle ${state.validation?.trace_ok === false ? 'current' : 'done'}">${state.validation?.trace_ok === false ? '2' : '✓'}</div><div><h3>Cálculos com rastro</h3><p>${state.validation?.trace_ok === true ? 'Conferência do rastro aprovada pelo motor.' : state.validation?.trace_ok === false ? 'A integridade do rastro requer atenção.' : 'Consulte as origens e regras de cada resultado.'}</p></div></div>
      <div class="step"><div class="step-circle ${pending.length ? 'current' : 'done'}">${pending.length ? '3' : '✓'}</div><div><h3>Revisão do analista</h3><p>${pending.length ? `${count(pending.length)} decisões precisam de encaminhamento.` : 'Todas as pendências foram encaminhadas.'}</p></div></div>
      <div class="step"><div class="step-circle ${closed() ? 'done' : ''}">${closed() ? '✓' : '4'}</div><div><h3>Fechar e compartilhar</h3><p>${closed() ? 'Fechamento registrado no histórico.' : 'Aceite explícito antes da conclusão.'}</p></div></div>
      <div class="callout">${icon('info')}<span>Uma alteração nas referências ou um novo cálculo reabre o mês para revisão.</span></div>
    </div></section></div>
    <section class="panel"><div class="panel-header"><div><h2>Fontes conectadas ao fechamento</h2><p>Arquivos originais preservados. Resultados reproduzíveis.</p></div><a class="text-link" href="#evidence">Ver evidências →</a></div><div class="panel-body"><div class="source-strip">${array(state.sources).slice(0,6).map(source => `<div class="source-mini">${icon('source')}<div><strong title="${attr(source.name)}">${escapeHtml(source.name)}</strong><span>${source.rows === undefined ? 'Arquivo identificado' : `${count(source.rows)} linhas`} · SHA-256 registrado</span></div></div>`).join('')}</div></div></section>
    <section class="panel section-space"><div class="panel-header"><div><h2>Relatório pronto para revisão</h2><p>Resultados, decisões e hipóteses da competência.</p></div><div class="heading-actions"><a class="button" href="/api/report" target="_blank" rel="noopener">${icon('evidence')}Abrir relatório</a><a class="button" href="/api/export.zip" download>${icon('download')}Baixar pacote</a>${button('Preparar e-mail','draft-report',{icon:'emails'})}</div></div></section>`;
}

function table(key, rows, columns, options = {}) {
  const ts = tableState[key] ||= {search:'',filter:'',status:'',page:1};
  let filtered = rows.filter(row => (!ts.search || Object.values(row).map(stringify).join(' ').toLocaleLowerCase('pt-BR').includes(ts.search.toLocaleLowerCase('pt-BR'))) && (!ts.filter || row[options.filterKey] === ts.filter) && (!ts.status || (ts.status === 'open' ? row.status !== 'resolved' : row.status === ts.status)));
  const pageCount = Math.max(1,Math.ceil(filtered.length / 20)); ts.page = Math.min(ts.page,pageCount);
  const pageRows = filtered.slice((ts.page-1)*20,ts.page*20);
  const filters = options.filterKey ? [...new Set(rows.map(row => row[options.filterKey]).filter(Boolean))] : [];
  return `<section class="panel"><div class="table-toolbar"><label class="search-field">${icon('search')}<input type="search" data-table-search="${key}" value="${attr(ts.search)}" placeholder="${attr(options.placeholder || 'Buscar por nome, referência ou valor…')}" aria-label="Buscar nesta tabela"></label>${options.filterKey ? `<select data-table-filter="${key}" aria-label="Filtrar por ${attr(labels[options.filterKey] || options.filterKey)}"><option value="">${escapeHtml(options.filterLabel || 'Todas as categorias')}</option>${filters.map(value => `<option value="${attr(value)}" ${ts.filter === value ? 'selected' : ''}>${escapeHtml(({CHECKOUT:'Checkout',REMESSA:'Remessa',informativo:'Informativo',atencao:'Atenção',bloqueante:'Bloqueante'})[value] || value)}</option>`).join('')}</select>` : ''}${options.status ? `<select data-table-status="${key}" aria-label="Filtrar situação"><option value="" ${ts.status === '' ? 'selected' : ''}>Todas as situações</option><option value="open" ${ts.status === 'open' ? 'selected' : ''}>Abertas</option><option value="resolved" ${ts.status === 'resolved' ? 'selected' : ''}>Resolvidas</option><option value="rejected" ${ts.status === 'rejected' ? 'selected' : ''}>Rejeitadas</option></select>` : ''}${options.toolbar || ''}</div>
    ${pageRows.length ? `<div class="table-wrap"><table><thead><tr>${columns.map(column => `<th scope="col" class="${column.numeric ? 'numeric' : ''}">${escapeHtml(column.label || labels[column.key] || column.key)}</th>`).join('')}${options.actions ? '<th scope="col" style="text-align:right">Ações</th>' : ''}</tr></thead><tbody>${pageRows.map(row => `<tr>${columns.map(column => `<td class="${column.numeric ? 'numeric' : ''} ${column.wrap ? 'wrap' : ''}">${column.render ? column.render(row[column.key],row) : formatCell(column.key,row[column.key])}</td>`).join('')}${options.actions ? `<td><div class="row-actions">${options.actions(row)}</div></td>` : ''}</tr>`).join('')}</tbody></table></div>` : empty('Nenhum registro encontrado',ts.search || ts.filter || ts.status ? 'Tente outro termo ou ajuste os filtros.' : options.empty || 'Os registros aparecerão após a importação e o cálculo.')}
    <div class="table-footer"><span>${filtered.length ? `${count((ts.page-1)*20+1)}–${count(Math.min(ts.page*20,filtered.length))} de ` : ''}${count(filtered.length)} registros${filtered.length !== rows.length ? ` · ${count(rows.length)} no total` : ''}</span><div class="pagination">${button('Anterior','table-page',{class:'small',id:key,value:ts.page-1,disabled:ts.page<=1})}<span>${ts.page} / ${pageCount}</span>${button('Próxima','table-page',{class:'small',id:key,value:ts.page+1,disabled:ts.page>=pageCount})}</div></div></section>`;
}
function formatCell(key, value) {
  if (value === undefined || value === null || value === '') return '<span class="cell-secondary">—</span>';
  if (['severity','status','linha_negocio','metodo','kind'].includes(key)) return badge(value);
  if (key === 'product') return escapeHtml(productNames[value] || readable(value));
  if (key === 'tipo') return escapeHtml(readable(value));
  if (key === 'action') return escapeHtml(auditNames[value] || readable(value));
  if (key.endsWith('_brl') || key === 'valor') return money(value);
  if (key.endsWith('_pct')) return `${escapeHtml(String(value).replace('.',','))}%`;
  if (key === 'confianca') return `${new Intl.NumberFormat('pt-BR',{maximumFractionDigits:1}).format(Number(value)*100)}%`;
  if (['cnpj','tomador_cnpj'].includes(key)) return `<span class="monospace">${escapeHtml(String(value).replace(/^(\d{2})(\d{3})(\d{3})(\d{4})(\d{2})$/,'$1.$2.$3/$4-$5'))}</span>`;
  if (['id_saida','ref_origem','code','conta_codigo','ec'].includes(key)) return `<span class="monospace">${escapeHtml(value)}</span>`;
  if (['active','enabled','postable'].includes(key)) return `<span class="badge ${value ? 'green' : 'neutral'}">${value ? 'Sim' : 'Não'}</span>`;
  if (['start','end','data'].includes(key)) return displayDate(value);
  if (['at','created_at','sent_at'].includes(key)) return dateTime(value);
  return escapeHtml(typeof value === 'object' ? stringify(value) : value);
}
const cols = (...keys) => keys.map(key => ({key,numeric:key.endsWith('_brl') || key === 'valor',wrap:['motivo','descricao','name','lojista','tomador','detail'].includes(key)}));
function traceButton(row) { return button('Ver rastro','trace',{class:'small',id:identifier(row),icon:'trace'}); }
function renderIssues() {
  const pending = openIssues();
  return heading('REVISÃO HUMANA','Pendências','Cada exceção tem uma evidência, uma sugestão e uma pessoa para decidir.',exportLink('pendencias.csv'))+
    `<div class="stat-inline"><div><strong>${count(pending.length)}</strong><span>Em aberto</span></div><div><strong>${count(pending.filter(row=>row.severity==='bloqueante').length)}</strong><span>Bloqueantes</span></div><div><strong>${count(issues().filter(row=>row.status==='resolved').length)}</strong><span>Resolvidas</span></div></div>`+
    table('issues',issues(),[{key:'severity'},{key:'tipo',wrap:true},{key:'motivo',wrap:true},{key:'valor_brl',numeric:true},{key:'quem_decide'},{key:'status'}],{filterKey:'severity',filterLabel:'Todas as severidades',status:true,actions:row=>button('Revisar','review',{class:'small',id:identifier(row),icon:'arrow'})});
}
function renderCommissions() {
  return heading('RESULTADOS DO MÊS','Comissões por lojista','Checkout e remessa com a origem de cada contribuição.',exportLink('comissoes_por_lojista.csv'))+periodBar()+table('commissions',array(state.results?.comissoes),cols('lojista','cnpj','linha_negocio','comissao_brl'),{filterKey:'linha_negocio',filterLabel:'Todas as linhas',actions:traceButton});
}
function renderDifferences() {
  return heading('TAXAS E CONTRATOS','Divergências de taxa','Compare a taxa contratada com a aplicada e confira o impacto em reais.',exportLink('divergencias_taxa.csv'))+`<div class="callout info" style="margin-bottom:20px">${icon('info')}<span>As diferenças são registradas para revisão. Alterações de taxa são feitas no cadastro com vigência e justificativa.</span></div>`+table('differences',array(state.results?.divergencias),cols('cnpj','linha_negocio','ref_origem','taxa_contratada_pct','taxa_aplicada_pct','diferenca_brl'),{filterKey:'linha_negocio',filterLabel:'Todas as linhas',actions:row=>`${traceButton(row)}${button('Revisar','related-issue',{class:'small',id:identifier(row)})}`});
}
function renderInvoices() {
  return heading('FATURAMENTO','Notas e cobranças','Revise os valores e prepare cobranças para aprovação do analista.',exportLink('notas_a_emitir.csv'))+`<div class="callout info" style="margin-bottom:20px">${icon('info')}<span>As notas são propostas de emissão. Cobranças exigem revisão e aprovação explícita. Todos os envios desta versão são simulados.</span></div>`+table('invoices',array(state.results?.notas),cols('tomador','tomador_cnpj','linha_negocio','valor_brl','discriminacao'),{filterKey:'linha_negocio',filterLabel:'Todas as linhas',actions:row=>`${traceButton(row)}${button('Preparar cobrança','draft-invoice',{class:'small',id:identifier(row),icon:'emails'})}`});
}
function renderBanks() {
  return heading('CLASSIFICAÇÃO BANCÁRIA','Lançamentos dos bancos','Classificação no plano de contas, método utilizado e decisão do analista.',exportLink('lancamentos_classificados.csv'))+table('banks',array(state.results?.lancamentos),cols('banco','data','ref_origem','descricao','valor','conta_codigo','metodo','confianca'),{filterKey:'banco',filterLabel:'Todos os bancos',actions:row=>`${traceButton(row)}${button('Reclassificar','reclassify',{class:'small',id:identifier(row),icon:'edit'})}`});
}

function tabs(items, selected, action) {
  return `<div class="tabs" role="tablist">${items.map(([id,name,n]) => `<button type="button" role="tab" aria-selected="${id===selected}" class="tab ${id===selected?'active':''}" data-action="${action}" data-id="${id}">${escapeHtml(name)}${n===undefined?'':`<span class="count-chip">${count(n)}</span>`}</button>`).join('')}</div>`;
}
function renderRecords() {
  const content = {
    merchants:()=> table('merchants',array(state.merchants),[{key:'name',wrap:true,render:(value,row)=>`<span class="cell-primary">${escapeHtml(value)}</span>${row.candidate?'<span class="cell-secondary">Identidade candidata · confirmar</span>':''}`},...cols('cnpj','ec','active')],{toolbar:button('Novo lojista','edit-merchant',{class:'primary',icon:'plus'}),actions:row=>button('Editar','edit-merchant',{class:'small',id:row.cnpj,icon:'edit'})}),
    rates:()=> `<div class="callout info" style="margin-bottom:18px">${icon('info')}<span>A vigência determina a taxa usada em cada cálculo. Sobreposições são recusadas; lacunas ficam sinalizadas. Toda alteração tem justificativa e histórico.</span></div>`+table('rates',array(state.rates),cols('cnpj','product','start','end','rate_pct'),{filterKey:'product',filterLabel:'Todos os produtos',toolbar:button('Nova vigência','edit-rate',{class:'primary',icon:'plus'}),actions:row=>button('Editar','edit-rate',{class:'small',id:row.id,icon:'edit'})}),
    contacts:()=> table('contacts',array(state.contacts),[{key:'name'},{key:'email',label:'E-mail'},{key:'kind'},{key:'min_severity'},{key:'frequency',render:value=>value==='immediate'?'Imediato':'Resumo consolidado'},{key:'enabled'}],{toolbar:button('Novo contato','edit-contact',{class:'primary',icon:'plus'}),actions:row=>button('Editar','edit-contact',{class:'small',id:row.id,icon:'edit'})}),
    parameters:()=> `<div class="parameter-grid"><section class="panel parameter-card"><p class="eyebrow">REMESSAS</p><h2>Tolerância de divergência de spread</h2><div class="value">${escapeHtml(state.parameters?.remittance_tolerance_pp ?? '—')} <span style="font-size:13px">p.p.</span></div><p>Limite configurado para revisão de diferenças entre spread realizado e contratado.</p></section><section class="panel parameter-card"><p class="eyebrow">CALENDÁRIO</p><h2>Prazo do fechamento</h2><div class="value">${displayDate(state.parameters?.closing_deadline)}</div><p>Usado nas notificações internas de acompanhamento do mês.</p></section></div><div style="margin-top:18px">${button('Editar parâmetros','edit-parameters',{class:'primary',icon:'edit'})}</div>`,
    accounts:()=>table('accounts',array(state.accounts),cols('code','name','postable'),{placeholder:'Buscar conta por código ou descrição…'}),
  };
  return heading('BASE DE REFERÊNCIA','Cadastros','Gerencie referências na plataforma. Cada alteração fica na auditoria.')+tabs([['merchants','Lojistas',array(state.merchants).length],['rates','Taxas e vigências',array(state.rates).length],['contacts','Contatos',array(state.contacts).length],['parameters','Parâmetros'],['accounts','Plano de contas']],recordTab,'record-tab')+content[recordTab]();
}
function renderEvidence() {
  const validation = state.validation || {};
  let body = '';
  if (evidenceTab === 'sources') body = `<div class="pill-line">${badge(validation.trace_ok === true?'resolved':validation.trace_ok===false?'bloqueante':'informativo')}<span class="subtext">${validation.trace_ok === true?'Conferência de integridade do rastro aprovada.':validation.trace_ok===false?'O rastro exige revisão.':'Consulte o rastro para verificar cada resultado.'}</span></div>`+table('sources',array(state.sources),[{key:'name',label:'Arquivo',wrap:true},{key:'rows'},{key:'sha256',render:value=>`<span class="monospace source-hash" title="${attr(value)}">${escapeHtml(value)}</span>`}],{})+`<section class="panel section-space"><div class="panel-header"><h2>Validação da importação</h2></div><div class="panel-body">${array(validation.errors).length?`<div class="callout error">${icon('issues')}<div>${array(validation.errors).map(x=>escapeHtml(stringify(x))).join('<br>')}</div></div>`:''}${array(validation.warnings).length?`<ul class="note-list">${array(validation.warnings).map(w=>`<li>${escapeHtml(stringify(w))}</li>`).join('')}</ul>`:!array(validation.errors).length?'<p class="subtext">Nenhum alerta adicional reportado pelo validador de importação.</p>':''}</div></section>`;
  if (evidenceTab === 'assumptions') body = `<section class="panel">${array(state.assumptions).length ? array(state.assumptions).map(item=>`<article class="assumption-card"><div class="pill-line"><span class="monospace">${escapeHtml(item.id || '')}</span>${item.status?badge(item.status):''}</div><h3>${escapeHtml(item.question || item.title || 'Hipótese')}</h3><p><strong>Fonte:</strong> ${escapeHtml(item.source || 'Não informada')}</p><p><strong>Decisão:</strong> ${escapeHtml(item.decision || '')}</p><p><strong>Se a hipótese estiver errada:</strong> ${escapeHtml(item.impact || '')}</p></article>`).join(''):empty('Nenhuma hipótese retornada','As hipóteses registradas pelo motor aparecerão aqui.')}</section>`;
  if (evidenceTab === 'trace') body = table('trace',array(state.results?.rastro),cols('id_saida','arquivo_origem','ref_origem','valor'),{toolbar:exportLink('rastro.csv'),actions:traceButton});
  if (evidenceTab === 'downloads') body = `<section class="panel"><div class="panel-header"><div><h2>Saídas oficiais do case</h2><p>CSV com ponto e vírgula, decimal com ponto e datas no padrão AAAA-MM-DD.</p></div></div><div class="panel-body"><div class="download-grid">${exportsList.map(([file,title,subtitle])=>`<a class="download-card" href="/api/export?file=${encodeURIComponent(file)}" download>${icon('download')}<div><strong>${title}</strong><span>${subtitle}</span></div></a>`).join('')}</div><div class="form-actions"><a class="button" href="/api/report" target="_blank" rel="noopener">${icon('evidence')}Abrir relatório imprimível</a><a class="button" href="/api/report?download=1" download="relatorio_fechamento.html">${icon('download')}Baixar relatório HTML</a><a class="button primary" href="/api/export.zip" download>${icon('download')}Baixar pacote completo</a></div></div></section>`;
  return heading('TRANSPARÊNCIA','Evidências e hipóteses','Fontes, regras e decisões documentadas para conferir o fechamento.',button('Importar competência','import',{icon:'plus'}))+tabs([['sources','Fontes e validação'],['assumptions','Hipóteses',array(state.assumptions).length],['trace','Rastro'],['downloads','Downloads']],evidenceTab,'evidence-tab')+body;
}
function renderEmails() {
  let body;
  if (emailTab === 'notifications') body = table('notifications',array(state.notifications),[{key:'at',label:'Data'},{key:'severity'},{key:'title',label:'Aviso',wrap:true},{key:'body',label:'Ação recomendada',wrap:true},{key:'deliveries',label:'Entregas simuladas',render:value=>array(value).length?`<span class="badge blue">${count(value.length)} registros</span>`:'<span class="cell-secondary">Sem entrega registrada</span>'}],{actions:row=>button('Ver registro','notification-detail',{class:'small',id:row.id})});
  else {
    const emails = array(state.emails);
    body = emails.length ? `<div class="email-grid">${[...emails].sort((a,b)=>new Date(b.created_at||b.at||0)-new Date(a.created_at||a.at||0)).map(email=>`<article class="email-card"><div class="email-meta">${badge(email.kind)}${email.stale?'<span class="badge amber">Cálculo alterado</span>':badge(email.status)}</div><h3>${escapeHtml(email.subject || 'Sem assunto')}</h3><p><strong>Para:</strong> ${escapeHtml(email.to || 'Destinatário ainda não informado')}</p><p class="email-excerpt">${escapeHtml(email.body || '')}</p><div class="email-meta"><span>${email.approved_by?`Aprovado por ${escapeHtml(email.approved_by)}`:'Aguardando revisão'}</span><span>${email.sent_at?dateTime(email.sent_at):''}</span></div><div class="row-actions">${button(email.status==='simulated'?'Ver registro':'Revisar e-mail','email-detail',{class:'small',id:email.id,icon:'edit'})}${email.status==='approved'&&!email.stale?button('Simular envio','email-send',{class:'small primary',id:email.id}):''}</div></article>`).join('')}</div>` : `<section class="panel">${empty('Sua caixa de revisão está vazia','Prepare uma cobrança em Notas e cobranças, uma contestação na pendência ou o e-mail do relatório.')}</section>`;
  }
  return heading('COMUNICAÇÃO COM CONTROLE','E-mails e notificações','Revise cada cobrança. A aprovação vale para a versão exata do conteúdo.',`${button('Processar alertas','notifications',{icon:'refresh'})}${button('Preparar relatório','draft-report',{class:'primary',icon:'emails'})}`)+`<div class="callout info" style="margin-bottom:20px">${icon('info')}<span><strong>Modo simulação.</strong> Nenhuma mensagem é enviada a destinatários reais. Alertas internos dispensam aprovação; cobranças e contestações precisam de aprovação explícita.</span></div>`+tabs([['emails','Rascunhos e envios',array(state.emails).length],['notifications','Notificações internas',array(state.notifications).length]],emailTab,'email-tab')+body;
}
function renderAudit() {
  return heading('HISTÓRICO DE DECISÕES','Auditoria','Quem fez, o que mudou e quando. O responsável é declarado neste ambiente local.')+table('audit',[...array(state.audit)].sort((a,b)=>new Date(b.at)-new Date(a.at)),[{key:'at',label:'Data e hora'},{key:'actor'},{key:'action'},{key:'detail',wrap:true,render:value=>`<span class="cell-secondary">${escapeHtml(stringify(value))}</span>`}],{});
}

function openDialog(title, html, submit = null, wide = false) {
  $('#dialog-title').textContent = title; $('#dialog-body').innerHTML = html; $('#dialog').classList.toggle('wide-dialog',wide); dialogSubmit = submit;
  if (!$('#dialog').open) $('#dialog').showModal();
}
function formFooter(text = 'Salvar alterações', note = '') {
  return `${note?`<p class="form-note" style="margin-top:18px">${escapeHtml(note)}</p>`:''}<div class="form-error" role="alert"></div><div class="form-actions"><label class="field actor-note"><span>Responsável por esta ação *</span><input name="actor_name" value="${attr(actorInput.value.trim())}" placeholder="Seu nome" required autocomplete="name" maxlength="100"></label>${button('Cancelar','close-dialog')}<button type="submit" class="button primary">${escapeHtml(text)}</button></div>`;
}
function field(name, label, value = '', options = {}) {
  let control;
  if (options.options) control = `<select name="${attr(name)}" ${options.required?'required':''}>${options.options.map(item=>{const [v,l]=Array.isArray(item)?item:[item,item];return `<option value="${attr(v)}" ${String(v)===String(value)?'selected':''}>${escapeHtml(l)}</option>`;}).join('')}</select>`;
  else if (options.textarea) control = `<textarea name="${attr(name)}" ${options.required?'required':''} ${options.rows?`rows="${options.rows}"`:''}>${escapeHtml(value)}</textarea>`;
  else control = `<input name="${attr(name)}" type="${options.type || 'text'}" value="${attr(value)}" ${options.required?'required':''} ${options.step?`step="${options.step}"`:''} ${options.min!==undefined?`min="${options.min}"`:''} ${options.max!==undefined?`max="${options.max}"`:''} ${options.pattern?`pattern="${attr(options.pattern)}"`:''} ${options.placeholder?`placeholder="${attr(options.placeholder)}"`:''}>`;
  return `<label class="field ${options.wide?'wide':''}"><span>${escapeHtml(label)}${options.required?' *':''}</span>${control}${options.help?`<small>${escapeHtml(options.help)}</small>`:''}</label>`;
}
function readableDetail(key, value) {
  if (Array.isArray(value)) return value.length ? value.map((item,index)=>typeof item==='object'&&item!==null?`<div class="nested-record">${value.length>1?`<span class="cell-secondary">Evidência ${index+1}</span>`:''}${detailsGrid(item)}</div>`:`<div>${escapeHtml(item)}</div>`).join('') : '<span class="cell-secondary">Nenhum registro</span>';
  if (typeof value==='object' && value!==null) return `<div class="nested-record">${detailsGrid(value)}</div>`;
  if (key==='gross' || key==='net' || key==='applied_fee' || key==='fee') return money(value);
  if (key==='mode' && value==='simulation') return 'Simulação';
  if (key==='action' && ['confirm','reject','adjust'].includes(value)) return ({confirm:'Confirmar encaminhamento',reject:'Rejeitar e manter aberta',adjust:'Ajustar encaminhamento'})[value];
  if (key==='formula') return escapeHtml(String(value).replaceAll('ROUND_HALF_UP','Arredondamento comercial').replaceAll('HALF_UP','arredondamento comercial'));
  return formatCell(key,value);
}
function detailsGrid(row, omit = []) {
  return `<dl class="record-grid">${Object.entries(row).filter(([key,value])=>!omit.includes(key) && value!==undefined && value!==null && value!=='').map(([key,value])=>`<div class="${typeof value==='object'||['motivo','suggestion','evidence','rule','regra','formula','discriminacao','body','detail'].includes(key)?'wide':''}"><dt>${escapeHtml(labels[key] || readable(key))}</dt><dd>${readableDetail(key,value)}</dd></div>`).join('')}</dl>`;
}
async function showTrace(id) {
  openDialog('Rastro do resultado',`<div class="loading" style="min-height:200px"><div class="spinner"></div><p>Consultando linhas e regras…</p></div>`,null,true);
  try {
    const trace = await api(`/api/trace?id=${encodeURIComponent(id)}`);
    $('#dialog-body').innerHTML = `<div class="pill-line"><span class="badge neutral monospace">${escapeHtml(id)}</span><span class="subtext">${count(array(trace.rows).length)} contribuições de origem</span></div><div class="callout info">${icon('info')}<span>O motor preserva os valores e as referências que compõem este resultado. Consulte a fórmula e a vigência nos detalhes.</span></div><h3 class="dialog-section-title">Linhas de origem</h3>${array(trace.rows).length?`<div class="table-wrap"><table><thead><tr><th>Arquivo</th><th>Referência</th><th class="numeric">Valor</th></tr></thead><tbody>${array(trace.rows).map(row=>`<tr><td>${escapeHtml(row.arquivo_origem)}</td><td class="monospace">${escapeHtml(row.ref_origem)}</td><td class="numeric">${money(row.valor)}</td></tr>`).join('')}</tbody></table></div>`:empty('Sem contribuições monetárias','O item pode representar uma decisão ou uma exceção sem valor calculável.')}<h3 class="dialog-section-title">Regras e detalhes de cálculo</h3>${array(trace.details).length?array(trace.details).map(row=>`<section class="trace-card">${detailsGrid(row)}</section>`).join(''):'<p class="subtext">Nenhum detalhe adicional retornado para este identificador.</p>'}`;
  } catch(error) { $('#dialog-body').innerHTML = `<div class="callout error">${escapeHtml(error.message)}</div>`; }
}
function accountsOptions() { return [['','Selecione uma conta'],...array(state.accounts).filter(row=>row.postable).map(row=>[row.code,`${row.code} · ${row.name}`])]; }
function reviewIssue(id) {
  const row = issues().find(row=>identifier(row)===id); if(!row) throw new Error('Pendência não encontrada. Atualize a página.');
  const banks = array(state.results?.lancamentos).filter(item=>item.ref_origem===row.ref_origem);
  openDialog('Revisar pendência',`<div class="pill-line">${badge(row.severity)}${badge(row.status || 'open')}<span class="monospace">${escapeHtml(id)}</span></div><h3>${escapeHtml(readable(row.tipo) || 'Decisão do analista')}</h3>${detailsGrid(row,['id_saida','id','severity','status','tipo'])}<div class="heading-actions" style="justify-content:flex-start;margin-bottom:22px">${button('Ver rastro','trace',{id,icon:'trace'})}${button('Preparar contestação','draft-issue',{id,icon:'emails'})}</div><form id="modal-form"><h3 class="dialog-section-title">Sua decisão</h3><div class="form-grid">${field('action','Encaminhamento','confirm',{required:true,options:[['confirm','Confirmar encaminhamento sugerido'],['reject','Rejeitar sugestão e manter aberta'],['adjust','Ajustar encaminhamento']]})}${banks.length?field('account_code','Conta contábil para reclassificação','',{options:accountsOptions(),help:'Obrigatória para ajustar a classificação bancária.'}):''}${field('note','Justificativa da decisão','',{required:true,textarea:true,wide:true,help:'Descreva a decisão e os dados usados. Confirmar não substitui contratos ou taxas faltantes.'})}</div>${formFooter('Registrar decisão','Para corrigir uma taxa ou valor de referência, edite o cadastro e recalcule o fechamento.')}</form>`,async form=>{
    await mutation('/api/decisions',{id,action:form.get('action'),note:form.get('note'),...(form.get('account_code')?{account_code:form.get('account_code')}:{})},'Decisão registrada com responsável e justificativa.');
  },true);
}
function relatedIssue(id) {
  const output = [...array(state.results?.divergencias),...array(state.results?.notas)].find(row=>identifier(row)===id);
  const matches = issues().filter(row=>row.ref_origem===output?.ref_origem || row.related_id===id || row.id_saida===id);
  if(matches.length===1) return reviewIssue(identifier(matches[0]));
  openDialog('Pendências relacionadas',matches.length?matches.map(row=>`<div class="issue-preview"><div class="issue-preview-content"><h3>${escapeHtml(readable(row.tipo))}</h3><p>${escapeHtml(row.motivo)}</p>${badge(row.status||'open')}</div>${button('Revisar','review',{class:'small',id:identifier(row)})}</div>`).join(''):`<div class="callout info">${icon('info')}<span>Nenhuma pendência vinculada foi retornada para esta linha. Consulte o rastro e a fila de revisão.</span></div><div class="form-actions">${button('Ver rastro','trace',{id,icon:'trace'})}</div>`);
}
function reclassify(id) {
  const row = array(state.results?.lancamentos).find(row=>identifier(row)===id); if(!row) throw new Error('Lançamento não encontrado.');
  openDialog('Reclassificar lançamento',`${detailsGrid(row)}<form id="modal-form"><div class="form-grid">${field('account_code','Nova conta contábil',row.conta_codigo,{required:true,wide:true,options:accountsOptions()})}${field('note','Justificativa','',{required:true,textarea:true,wide:true})}</div>${formFooter('Registrar reclassificação','A classificação será identificada como HUMANO e registrada na auditoria.')}</form>`,async form=>mutation('/api/decisions',{id,action:'adjust',account_code:form.get('account_code'),note:form.get('note')},'Lançamento reclassificado com decisão humana.'));
}
function editMerchant(id) {
  const row = array(state.merchants).find(row=>row.cnpj===id) || {};
  openDialog(id?'Editar lojista':'Cadastrar lojista',`<form id="modal-form"><div class="form-grid">${field('cnpj','CNPJ (14 dígitos)',row.cnpj,{required:true,pattern:'[0-9]{14}',help:'Somente números.'})}${field('name','Razão social',row.name,{required:true})}${field('ec','Código do estabelecimento',row.ec,{help:'Opcional para contrapartes que operam somente remessas.'})}${field('active','Cadastro ativo',row.active===false?'false':'true',{options:[['true','Sim'],['false','Não']]})}${field('reason','Justificativa', '',{required:true,textarea:true,wide:true})}</div>${row.candidate?'<label class="check-field"><input type="checkbox" name="identity_confirmed" required><span>Conferi a identidade deste candidato nas fontes e confirmo o vínculo entre estabelecimento e CNPJ.</span></label>':''}${formFooter('Salvar lojista')}</form>`,async form=>mutation('/api/merchants',{cnpj:form.get('cnpj'),name:form.get('name'),ec:form.get('ec'),active:form.get('active')==='true',reason:form.get('reason'),...(row.candidate?{candidate:false,identity_confirmed:form.get('identity_confirmed')==='on'}:{})},'Cadastro salvo. O fechamento foi reaberto para revisão.'));
}
function editRate(id) {
  const row = array(state.rates).find(row=>String(row.id)===String(id)) || {};
  const products = [...new Set(array(state.rates).map(row=>row.product).filter(Boolean))];
  openDialog(id?'Editar taxa e vigência':'Adicionar taxa vigente',`<form id="modal-form"><p class="form-note">A taxa é percentual. Para 2,5%, informe 2.5. A aplicação valida sobreposições antes de salvar.</p><div class="form-grid">${field('cnpj','Lojista',row.cnpj,{required:true,options:[['','Selecione um lojista'],...array(state.merchants).map(row=>[row.cnpj,`${row.name} · ${row.cnpj}`])]})}${field('product','Produto',row.product || products[0] || '',{required:true,options:products.map(product=>[product,productNames[product] || readable(product)])})}${field('start','Início da vigência',row.start,{required:true,type:'date'})}${field('end','Fim da vigência',row.end,{type:'date',help:'Deixe vazio para vigência em aberto.'})}${field('rate_pct','Taxa (%)',row.rate_pct,{required:true,type:'number',step:'0.000001',min:0,max:100})}${field('reason','Justificativa e origem do contrato','',{required:true,textarea:true,wide:true})}</div>${formFooter('Salvar taxa e recalcular')}</form>`,async form=>mutation('/api/rates',{...(id?{id}:{}),cnpj:form.get('cnpj'),product:form.get('product'),start:form.get('start'),end:form.get('end'),rate_pct:form.get('rate_pct'),reason:form.get('reason')},'Taxa salva com histórico. Resultados atualizados para revisão.'));
}
function editContact(id) {
  const row = array(state.contacts).find(row=>String(row.id)===String(id)) || {};
  openDialog(id?'Editar contato':'Adicionar contato',`<form id="modal-form"><div class="form-grid">${field('name','Nome',row.name,{required:true})}${field('email','E-mail',row.email,{required:true,type:'email'})}${field('kind','Finalidade',row.kind || 'internal',{required:true,options:[['internal','Alertas internos'],['billing','Cobrança / contraparte']]})}${field('cnpj','CNPJ vinculado',row.cnpj,{pattern:'[0-9]{14}',help:'14 dígitos. Pode ser um lojista ou a Ponte; deixe vazio para contato interno.'})}${field('min_severity','Severidade mínima',row.min_severity || 'atencao',{options:[['informativo','Informativo e acima'],['atencao','Atenção e bloqueante'],['bloqueante','Somente bloqueante']]})}${field('frequency','Frequência',row.frequency || 'digest',{options:[['immediate','Imediato'],['digest','Resumo consolidado']]})}${field('enabled','Receber notificações',row.enabled===false?'false':'true',{options:[['true','Ativo'],['false','Inativo']]})}</div>${formFooter('Salvar contato','A configuração vale para a simulação. Não existe envio real neste MVP.')}</form>`,async form=>mutation('/api/contacts',{...(id?{id}:{}),name:form.get('name'),email:form.get('email'),kind:form.get('kind'),cnpj:form.get('cnpj'),min_severity:form.get('min_severity'),frequency:form.get('frequency'),enabled:form.get('enabled')==='true'},'Contato salvo.'));
}
function editParameters() {
  openDialog('Parâmetros do fechamento',`<form id="modal-form"><div class="form-grid">${field('remittance_tolerance_pp','Tolerância de remessa (p.p.)',state.parameters?.remittance_tolerance_pp,{required:true,type:'number',min:0,max:0.05,step:'0.000001',help:'De 0 a 0,05 ponto percentual.'})}${field('closing_deadline','Prazo do fechamento',state.parameters?.closing_deadline,{required:true,type:'date'})}${field('reason','Justificativa','',{required:true,textarea:true,wide:true})}</div>${formFooter('Salvar parâmetros')}</form>`,async form=>mutation('/api/parameters',{remittance_tolerance_pp:form.get('remittance_tolerance_pp'),closing_deadline:form.get('closing_deadline'),reason:form.get('reason')},'Parâmetros salvos e fechamento reaberto.'));
}
function closePeriod() {
  const pending = openIssues();
  openDialog('Concluir fechamento',`<form id="modal-form"><p class="form-note">O registro de conclusão preserva quem assumiu a decisão e as condições do fechamento de ${escapeHtml(periodName(state.period))}.</p>${pending.length?`<div class="callout warn">${icon('issues')}<span><strong>${count(pending.length)} pendências continuam abertas.</strong> A conclusão exige seu aceite explícito e uma justificativa. As pendências permanecem visíveis no relatório.</span></div><label class="check-field"><input type="checkbox" name="allow_open" required><span>Aceito explicitamente concluir o mês com ${count(pending.length)} pendências abertas e assumo o encaminhamento descrito abaixo.</span></label>`:'<div class="callout">'+icon('check')+'<span>Nenhuma pendência aberta retornada para esta competência.</span></div>'}<div class="form-grid" style="margin-top:18px">${field('reason','Justificativa da conclusão','',{required:true,textarea:true,wide:true})}</div>${formFooter('Confirmar conclusão')}</form>`,async form=>mutation('/api/close',{allow_open:form.get('allow_open')==='on',reason:form.get('reason')},'Fechamento concluído e registrado na auditoria.'));
}
function reopenPeriod() {
  openDialog('Reabrir fechamento',`<form id="modal-form"><div class="form-grid">${field('reason','Motivo da reabertura','',{required:true,textarea:true,wide:true})}</div>${formFooter('Reabrir mês')}</form>`,async form=>mutation('/api/reopen',{reason:form.get('reason')},'Fechamento reaberto para revisão.'));
}
function importPeriod() {
  openDialog('Importar arquivos da competência',`<form id="modal-form"><p class="form-note">Informe uma pasta local acessível ao servidor contendo as fontes no formato original do case. Os arquivos originais serão preservados e a importação será validada.</p><div class="form-grid">${field('source_dir','Caminho da pasta de arquivos',state.source_dir || '',{required:true,wide:true,placeholder:'/Users/seu-nome/Downloads/novo-data-pack',help:'Caminho completo da pasta neste computador.'})}${field('period','Competência',state.period,{required:true,type:'month'})}</div><div class="callout warn" style="margin-top:18px">${icon('info')}<span>A importação atualiza o conjunto ativo e reabre o fechamento para revisão. Decisões anteriores continuam no histórico.</span></div>${formFooter('Validar e importar')}</form>`,async form=>mutation('/api/import',{source_dir:form.get('source_dir'),period:form.get('period')},'Fontes importadas. Confira a validação e as pendências.'));
}
function emailDetail(id) {
  const email = array(state.emails).find(row=>String(row.id)===String(id)); if(!email) throw new Error('E-mail não encontrado.');
  if(email.status==='simulated' || email.status==='sent') return openDialog('Registro de envio simulado',`<div class="pill-line">${badge(email.kind)}${badge(email.status)}</div>${detailsGrid(email,['body'])}<div class="email-detail-body">${escapeHtml(email.body)}</div>`);
  openDialog('Revisar e-mail',`<div class="pill-line">${badge(email.kind)}${badge(email.status)}</div>${email.stale?`<div class="callout warn" style="margin-bottom:16px">${icon('info')}<span>O cálculo mudou depois deste rascunho. Prepare uma nova versão com os valores atuais. ${button('Gerar novo rascunho','regenerate-email',{id,class:'small'})}</span></div>`:''}<p class="form-note">${email.kind==='internal'?'Notificação interna: aprovação é opcional.':'Aprovar autoriza somente o envio simulado desta versão exata.'} Qualquer alteração invalida a aprovação anterior.</p><form id="modal-form"><div class="form-grid">${field('to','Destinatário',email.to,{required:true,type:'email',wide:true})}${field('subject','Assunto',email.subject,{required:true,wide:true})}${field('body','Mensagem',email.body,{required:true,textarea:true,rows:11,wide:true})}</div>${formFooter('Salvar rascunho')}</form><div class="form-actions"><span class="actor-note">${email.approved_by?`Aprovado por ${escapeHtml(email.approved_by)} · ${dateTime(email.approved_at)}`:'Salve alterações antes de aprovar ou simular.'}</span>${button('Aprovar esta versão','email-approve',{id,class:'dark',disabled:email.status==='approved'||email.stale})}${button('Simular envio','email-send',{id,class:'primary',disabled:email.stale||(email.status!=='approved'&&email.kind!=='internal')})}</div>`,async form=>mutation('/api/emails/save',{id,to:form.get('to'),subject:form.get('subject'),body:form.get('body')},'Rascunho salvo. Revise a versão antes de aprovar.'));
  $('#modal-form').addEventListener('input',()=>{
    for(const control of $('#dialog-body').querySelectorAll('[data-action="email-approve"],[data-action="email-send"]')) control.disabled=true;
  });
}
function emailSendConfirm(id) {
  const email = array(state.emails).find(row=>String(row.id)===String(id)); if(!email) throw new Error('E-mail não encontrado.');
  openDialog('Simular envio do e-mail',`<form id="modal-form"><div class="callout info">${icon('info')}<span>Nenhuma mensagem será enviada a uma caixa postal real. O conteúdo e o responsável pela ação serão registrados.</span></div>${detailsGrid({to:email.to,subject:email.subject,approved_by:email.approved_by,approved_at:email.approved_at})}<div class="email-detail-body">${escapeHtml(email.body)}</div>${formFooter('Confirmar envio simulado')}</form>`,async()=>mutation('/api/emails/send',{id},'Envio simulado registrado. Nenhuma mensagem real foi enviada.'));
}

async function handleAction(action, id, value) {
  if(action==='close-dialog') return $('#dialog').close();
  if(action==='table-page'){tableState[id].page=Number(value);return render();}
  if(action==='record-tab'){recordTab=id;return render();}
  if(action==='evidence-tab'){evidenceTab=id;return render();}
  if(action==='email-tab'){emailTab=id;return render();}
  if(action==='trace')return showTrace(id);
  if(action==='review')return reviewIssue(id);
  if(action==='related-issue')return relatedIssue(id);
  if(action==='reclassify')return reclassify(id);
  if(action==='edit-merchant')return editMerchant(id);
  if(action==='edit-rate')return editRate(id);
  if(action==='edit-contact')return editContact(id);
  if(action==='edit-parameters')return editParameters();
  if(action==='close')return closePeriod();
  if(action==='reopen')return reopenPeriod();
  if(action==='import')return importPeriod();
  if(action==='email-detail')return emailDetail(id);
  if(action==='email-send')return emailSendConfirm(id);
  if(action==='notification-detail'){
    const notification = array(state.notifications).find(row=>String(row.id)===String(id));
    return openDialog('Registro de notificação interna',detailsGrid(notification || {}));
  }
  if(action==='regenerate-email'){
    const email=array(state.emails).find(row=>String(row.id)===String(id));
    if(!email)throw new Error('E-mail não encontrado.');
    return handleAction(email.kind==='internal'?'draft-report':email.kind==='billing'?'draft-invoice':'draft-issue',email.related_id);
  }
  if(action==='recalculate')return mutation('/api/recalculate',{period:state.period},'Cálculo atualizado. Revise o fechamento e as pendências.');
  if(action==='notifications')return mutation('/api/notifications/run',{},'Notificações processadas em modo simulação.');
  if(action==='email-approve'){
    await mutation('/api/emails/approve',{id},'Versão aprovada. O envio permanece em modo simulação.');
    return emailDetail(id);
  }
  if(['draft-report','draft-invoice','draft-issue'].includes(action)){
    const result=await api('/api/emails/draft',action==='draft-report'?{report:true}:action==='draft-invoice'?{invoice_id:id}:{issue_id:id});
    await loadState();$('#dialog').close();location.hash='emails';
    toast('Rascunho preparado. Revise destinatário e conteúdo antes de aprovar.');
    const emailId=result.id || result.email?.id;
    if(emailId)emailDetail(emailId);
    return;
  }
  if(action==='reload')return loadState();
}

document.addEventListener('click',async event=>{
  const control=event.target.closest('[data-action]');if(!control||control.disabled)return;
  event.preventDefault();
  const busyActions=['recalculate','notifications','email-approve','draft-report','draft-invoice','draft-issue','reload'];
  const busy=busyActions.includes(control.dataset.action);if(busy)control.disabled=true;
  try{await handleAction(control.dataset.action,control.dataset.id,control.dataset.value);}catch(error){toast(error.message,true);}finally{if(busy&&control.isConnected)control.disabled=false;}
});
document.addEventListener('submit',async event=>{
  if(event.target.id!=='modal-form')return;event.preventDefault();if(!dialogSubmit)return;
  const form=event.target;const submit=$('[type="submit"]',form);const errorNode=$('.form-error',form);if(submit.disabled)return;
  submit.disabled=true;errorNode.textContent='';
  try{actor();const handler=dialogSubmit;await handler(new FormData(form));$('#dialog').close();}
  catch(error){errorNode.textContent=error.message;errorNode.scrollIntoView({block:'nearest'});}
  finally{if(submit.isConnected)submit.disabled=false;}
});
document.addEventListener('input',event=>{
  const key=event.target.dataset.tableSearch;if(!key)return;
  const position=event.target.selectionStart;
  tableState[key].search=event.target.value;tableState[key].page=1;render();
  const input=$(`[data-table-search="${key}"]`);input.focus();if(position!==null)input.setSelectionRange(position,position);
});
document.addEventListener('change',event=>{
  const filter=event.target.dataset.tableFilter,status=event.target.dataset.tableStatus;
  if(filter){tableState[filter].filter=event.target.value;tableState[filter].page=1;render();}
  if(status){tableState[status].status=event.target.value;tableState[status].page=1;render();}
});
window.addEventListener('hashchange',()=>{
  const next=location.hash.slice(1);if(nav.some(([key])=>key===next)){activePage=next;if(state)render();window.scrollTo({top:0,behavior:'instant'});}
});
$('#dialog').addEventListener('click',event=>{if(event.target===$('#dialog')){const rect=$('#dialog').getBoundingClientRect();if(event.clientX<rect.left||event.clientX>rect.right||event.clientY<rect.top||event.clientY>rect.bottom)$('#dialog').close();}});
loadState().catch(error=>{$('#app').innerHTML=`<div class="loading">${icon('issues')}<h1>Não foi possível carregar o fechamento</h1><p>${escapeHtml(error.message)}</p>${button('Tentar novamente','reload',{class:'primary',icon:'refresh'})}</div>`;});
