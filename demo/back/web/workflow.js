/* Deterministic pipeline controls. All financial results and approvals come from the API. */
'use strict';
window.TarvoWorkflow = (() => {
  const W = {pipelineId:'fechamento-tarvo',period:'',catalog:[],definition:null,versions:[],runs:[],run:null,stepId:'',tab:'execution',loaded:false,loading:false,error:'',busy:false,builder:null,validation:null,checklist:null,exceptions:[],exceptionPage:1,exceptionTotal:0,preview:null,previewError:'',previewLoading:false,previewPage:1,previewSize:20,previewOptions:{dataset:'',column:'',op:'contains',value:'',sort:'',order:'asc',only:false,diff:false},connection:'offline',events:[],progress:{},uploadMessage:''};
  let stream=null, streamRunId='', pollTimer=null, refreshTimer=null, snapshotBusy=false, generation=0, previewGeneration=0;
  const enc=encodeURIComponent;
  const liveStatuses=['queued','running','approved','exporting'];
  const terminalStatuses=['done','failed','rejected'];
  const stateLabels={queued:['Na fila','neutral'],running:['Em execução','blue'],awaiting_approval:['Aguardando aprovação','amber'],approved:['Aprovada','green'],exporting:['Exportando','blue'],done:['Concluído','green'],failed:['Falhou','red'],rejected:['Reprovado','red'],pending:['Pendente','neutral'],done_with_exceptions:['Com exceções','amber'],skipped:['Não executado','neutral'],open:['Aberta','amber'],accepted:['Aceita','green'],adjusted:['Ajustada','blue'],excluded:['Excluída','neutral'],resolved:['Resolvida','green'],aceitar:['Aceita','green'],ajustar:['Ajustada','blue'],excluir:['Excluída','neutral'],bloqueante:['Bloqueante','red'],alerta:['Alerta','amber'],pendente:['Pendente','neutral'],em_andamento:['Em andamento','blue'],com_excecoes:['Com exceções','amber'],concluida:['Concluída','green']};
  const eventLabels={run_started:'Execução iniciada',step_started:'Passo iniciado',step_progress:'Processamento em andamento',step_finished:'Passo concluído',awaiting_approval:'Revisão humana disponível',run_finished:'Execução encerrada',run_failed:'Falha na execução',decision:'Decisão registrada',exception_decided:'Exceção revisada',approval:'Aprovação registrada',approved:'Execução aprovada',rejected:'Execução reprovada',export_started:'Exportação iniciada'};
  const datasetLabels={raw_orbe:'Orbe · dados de origem',raw_rates:'Taxas · dados de origem',raw_merchants:'Lojistas · cadastro de origem',raw_bank:'Bancos · extratos de origem',accounts:'Plano de contas',sources:'Arquivos de origem',raw_remittances:'Remessas · dados de origem',import_warnings:'Alertas de importação',bank_balances:'Saldos bancários',orbe_normalizado:'Orbe normalizada',orbe_resolvido:'Lojistas identificados',mdr_conferido:'Taxas MDR conferidas',checkout_calculado:'Checkout calculado',bancos_classificados:'Classificação bancária',saldos_conferidos:'Conferência de saldos',cambio_calculado:'Câmbio calculado',lancamentos:'Partidas dobradas',comissoes:'Comissões',divergencias:'Divergências',notas:'Notas propostas',pendencias:'Pendências',rastro:'Rastro de origem',detalhes_calculo:'Detalhes de cálculo',aprovacao_pendente:'Revisão para aprovação',export_manifest:'Arquivos exportados',ajustes:'Ajustes do revisor'};
  const columnLabels={adjustable_account:'Conta ajustável',event_type:'Tipo de evento',credito:'Crédito',debito:'Débito',historico:'Histórico',brand:'Bandeira',date:'Data',installments:'Parcelas',modality:'Modalidade',original_date:'Data original',physical_row:'Linha física',reported_fee:'Taxa reportada em reais',type:'Tipo',contracted_date:'Data da contratação',settlement_date:'Data da liquidação',client_rate:'Cotação do cliente',gross_brl:'Valor bruto em reais',estimated_spread_brl:'Spread estimado',iof_brl:'IOF',compliance:'Situação de compliance',observation:'Observação',nature:'Natureza',candidate:'Cadastro candidato',identity_rule:'Regra de identificação',encoding:'Codificação do arquivo',path:'Caminho do arquivo',size:'Tamanho em bytes',embedded:'Anexo incorporado',sheets:'Abas de origem',message:'Descrição',bank:'Banco',amount:'Valor',description:'Descrição',balance:'Saldo',opening:'Saldo inicial',closing:'Saldo final',opening_ref:'Referência do saldo inicial',closing_ref:'Referência do saldo final',entry_id:'Identificador do lançamento',debit_account:'Conta de débito',credit_account:'Conta de crédito',source_refs:'Referências de origem',match_method:'Método de identificação',match_status:'Situação do vínculo',merchant_cnpj:'CNPJ do lojista',merchant_name:'Lojista identificado',match_candidates:'Candidatos à identificação'};
  const parameterLabels={fallback:'Vínculo alternativo',sugerir_nome:'Sugerir vínculo por nome',tolerancia_pp:'Tolerância (p.p.)',janela_dias:'Janela de datas (dias)',conciliar_parcelas_orbe:'Conciliar parcelas da Orbe',participacao_spread:'Participação no spread',spread_padrao_pct:'Spread padrão (%)',mapa:'Mapeamento contábil',calcular_tributos:'Calcular tributos',formato:'Formato de exportação'};
  function colLabel(name){return columnLabels[name]||labels[name]||readable(name);}
  function datasetLabel(name){return datasetLabels[name]||readable(name);}
  const metricLabels={credit_total:'Total de créditos',debit_total:'Total de débitos',rows_in:'Linhas de entrada',rows_out:'Linhas de saída',exceptions:'Exceções',rows:'Linhas',total_brl:'Total',debit_brl:'Débitos',credit_brl:'Créditos',duration_ms:'Duração (ms)',files:'Arquivos',files_read:'Arquivos lidos',read:'Linhas lidas',discarded:'Linhas descartadas',total_debit:'Total de débitos',total_credit:'Total de créditos',balanced:'Lote balanceado'};
  function wb(value){const [label,color]=stateLabels[value]||[readable(value||'pending'),'neutral'];return `<span class="badge ${color}">${escapeHtml(label)}</span>`;}
  function currentRunId(){return W.run?.id||W.run?.run_id||'';}
  function getStep(){return array(W.run?.steps).find(s=>s.id===W.stepId);}
  function getCatalog(type){return W.catalog.find(s=>s.type===type)||{};}
  function stepTitle(step){return step.title||getCatalog(step.type).title||readable(step.type);}
  function visible(){return ['pipeline','checklist'].includes(activePage);}
  function repaint(){if(visible()&&state)render();}
  function detailsMessage(details){return array(details).map(d=>typeof d==='string'?d:[d.step_id,d.path,d.message||d.msg||d.error,d.entry_ids?.length?'Lançamentos possíveis: '+d.entry_ids.join(', '):'',d.id,d.tipo?readable(d.tipo):''].filter(Boolean).join(' · ')).filter(Boolean).join('\n');}
  async function request(path,{method='GET',body,multipart=false}={}){
    const headers={};if(method!=='GET'){headers['X-User']=encodeURIComponent(actor());headers['X-User-Encoding']='percent-utf8';}
    if(body!==undefined&&!multipart)headers['Content-Type']='application/json';
    const response=await fetch(path,{method,headers,cache:'no-store',...(body!==undefined?{body:multipart?body:JSON.stringify(body)}:{})});
    const result=await response.json();
    if(!response.ok||result.error){const error=result.error||{};const message=typeof error==='string'?error:error.message||'Não foi possível concluir a operação.';const extra=detailsMessage(error.details||result.detail);throw new Error(`${message}${extra?'\n'+extra:''}`);}
    return result;
  }
  async function ensure(force=false){
    if(W.loading)return;if(W.loaded&&!force){if(W.run)connect();return;}
    W.loading=true;W.error='';W.period=W.period||state?.period||new Date().toISOString().slice(0,7);
    try{
      const result=await Promise.allSettled([request('/api/steps/catalog'),request(`/api/pipelines/${enc(W.pipelineId)}`),request(`/api/pipelines/${enc(W.pipelineId)}/versions`),request(`/api/runs?competencia=${enc(W.period)}`),request(`/api/competencias/${enc(W.period)}/checklist`)]);
      const failed=result.find(r=>r.status==='rejected');if(failed)throw failed.reason;
      const [catalog,definition,versions,runs,checklist]=result.map(r=>r.value);
      W.catalog=array(catalog.steps);W.definition=definition;W.versions=array(versions.versions);W.runs=array(runs.runs);W.checklist=checklist;W.loaded=true;
      if(!W.builder)W.builder=structuredClone(W.definition);
      if(W.runs.length){const target=W.runs.find(r=>(r.id||r.run_id)===currentRunId())||W.runs[0];await selectRun(target.id||target.run_id,false);}else{pause();W.run=null;W.preview=null;W.exceptions=[];}
    }catch(error){W.error=error.message;}finally{W.loading=false;repaint();}
  }
  async function refreshChecklist(){W.checklist=await request(`/api/competencias/${enc(W.period)}/checklist`);}
  async function loadExceptions(){
    if(!currentRunId())return;
    const result=await request(`/api/runs/${enc(currentRunId())}/exceptions?page=${W.exceptionPage}&page_size=20`);
    W.exceptions=array(result.exceptions||result.items);W.exceptionTotal=result.total??W.exceptions.length;
  }
  async function snapshot(renderAfter=true){
    if(!currentRunId()||snapshotBusy)return;
    snapshotBusy=true;const id=currentRunId();
    try{
      const result=await request(`/api/runs/${enc(id)}`);if(currentRunId()!==id)return;
      const changed=JSON.stringify(result.steps)!==JSON.stringify(W.run.steps)||result.status!==W.run.status;
      W.run=result;W.runs=W.runs.map(run=>(run.id||run.run_id)===id?{...run,...result}:run);
      if(!W.stepId)W.stepId=array(result.steps).find(s=>array(s.outputs).length||array(s.datasets).length)?.id||array(result.steps)[0]?.id||'';
      await Promise.all([loadExceptions(),refreshChecklist()]);
      if(changed&&W.stepId&&datasetNames(getStep()).length)await loadPreview(false);
      if(terminalStatuses.includes(result.status)){pause();W.connection='complete';}
      if(renderAfter&&W.tab!=='builder'&&!document.activeElement?.closest?.('#wf-preview-form'))repaint();
    }catch(error){W.connection='reconnecting';W.error=error.message;if(renderAfter)repaint();}finally{snapshotBusy=false;}
  }
  async function selectRun(id,renderAfter=true){
    pause();previewGeneration++;W.run=await request(`/api/runs/${enc(id)}`);W.stepId=array(W.run.steps).find(s=>datasetNames(s).length)?.id||array(W.run.steps)[0]?.id||'';
    W.preview=null;W.previewPage=1;W.previewOptions.dataset='';W.exceptionPage=1;W.events=[];W.progress={};W.error='';
    await loadExceptions();if(datasetNames(getStep()).length)await loadPreview(false);
    connect();if(renderAfter)repaint();
  }
  function pause(){if(stream)stream.close();stream=null;streamRunId='';clearInterval(pollTimer);pollTimer=null;clearTimeout(refreshTimer);refreshTimer=null;}
  function connect(){
    const id=currentRunId();if(!id||!visible()||terminalStatuses.includes(W.run.status)){if(W.run&&terminalStatuses.includes(W.run.status))W.connection='complete';return;}
    if(streamRunId===id&&stream)return;
    pause();streamRunId=id;W.connection='connecting';
    stream=new EventSource(`/api/runs/${enc(id)}/events`);
    stream.onopen=()=>{W.connection='live';snapshot();};
    const receive=event=>{
      let data;try{data=JSON.parse(event.data);}catch(_){return;}
      if(currentRunId()!==id)return;
      if(data.step_id&&data.done!==undefined)W.progress[data.step_id]={done:data.done,total:data.total};
      if(data.type!=='step_progress')W.events=[...W.events,data].slice(-30);
      W.connection='live';clearTimeout(refreshTimer);refreshTimer=setTimeout(()=>snapshot(),180);
    };
    stream.onmessage=receive;
    for(const name of Object.keys(eventLabels))stream.addEventListener(name,receive);
    stream.onerror=()=>{W.connection='reconnecting';repaint();};
    pollTimer=setInterval(()=>{if(visible())snapshot();},4500);
  }
  function datasetNames(step){
    if(!step)return[];
    if(Array.isArray(step.datasets))return step.datasets.map(d=>typeof d==='string'?d:d.name||d.id).filter(Boolean);
    if(step.datasets&&typeof step.datasets==='object')return Object.keys(step.datasets);
    return array(step.outputs).map(d=>typeof d==='string'?d:d.name||d.id).filter(Boolean);
  }
  function schemaColumns(){
    const schema=W.preview?.schema;
    return Array.isArray(schema)?schema.map(c=>typeof c==='string'?{name:c,type:'text'}:c):schema&&typeof schema==='object'?Object.entries(schema).map(([name,meta])=>({name,...(typeof meta==='object'?meta:{type:meta})})):Object.keys(W.preview?.rows?.[0]||{}).filter(k=>!k.startsWith('__')).map(name=>({name,type:'text'}));
  }
  async function loadPreview(renderAfter=true){
    if(!currentRunId()||!W.stepId||!datasetNames(getStep()).length){W.preview=null;return;}
    const token=++previewGeneration;W.previewLoading=true;W.previewError='';
    const options=W.previewOptions;const params=new URLSearchParams({page:String(W.previewPage),page_size:String(W.previewSize),only_exceptions:String(options.only),diff:String(options.diff)});
    if(options.dataset)params.set('dataset',options.dataset);
    if(options.column&&options.value!==''){params.set('filter_column',options.column);params.set('filter_op',options.op);params.set('filter_value',options.value);}
    if(options.sort){params.set('sort_by',options.sort);params.set('sort_dir',options.order);}
    try{const result=await request(`/api/runs/${enc(currentRunId())}/steps/${enc(W.stepId)}/preview?${params}`);if(token===previewGeneration)W.preview=result;}catch(error){if(token===previewGeneration){W.previewError=error.message;W.preview=null;}}finally{if(token===previewGeneration){W.previewLoading=false;if(renderAfter)repaint();}}
  }
  function periodControls(){return `<div class="wf-period"><label class="field"><span>Competência</span><input id="wf-period" type="month" value="${attr(W.period)}" aria-label="Competência do pipeline"></label>${button('Atualizar','wf-refresh',{icon:'refresh'})}</div>`;}
  function pipelinePage(){
    return heading('EXECUÇÃO E REVISÃO','Pipeline do fechamento','Passos determinísticos, resultados preservados e aprovação antes da exportação.',`${button('Nova execução','wf-new-run',{class:'primary',icon:'plus',disabled:W.busy})}`)+
      `<div class="wf-toolbar">${periodControls()}<div class="wf-pipeline-version"><span>Definição atual</span><strong>${escapeHtml(W.definition?.id||W.pipelineId)} · v${escapeHtml(W.definition?.version||'—')}</strong></div></div>`+
      tabs([['execution','Execução'],['exceptions','Exceções',W.run?.exceptions_open??W.exceptionTotal],['builder','Construtor e versões']],W.tab,'wf-tab')+
      (W.error?`<div class="callout error wf-space">${icon('issues')}<span>${escapeHtml(W.error)}</span></div>`:'')+
      (W.tab==='builder'?builderView():`${runPicker()}${W.tab==='exceptions'?exceptionsView():executionView()}`);
  }
  function runPicker(){return `<div class="wf-runbar"><label class="field"><span>Execução em análise</span><select id="wf-run-select" aria-label="Selecionar execução"><option value="">${W.runs.length?'Selecione uma execução':'Nenhuma execução nesta competência'}</option>${W.runs.map(run=>`<option value="${attr(run.id||run.run_id)}" ${(run.id||run.run_id)===currentRunId()?'selected':''}>${escapeHtml(run.id||run.run_id)} · ${escapeHtml(stateLabels[run.status]?.[0]||run.status)}${run.created_at?' · '+dateTime(run.created_at):''}</option>`).join('')}</select></label>${W.run?`<div class="wf-run-status">${wb(W.run.status)}<span class="wf-connection ${W.connection==='live'?'online':''}" role="status">${{live:'Atualização ao vivo',connecting:'Conectando…',reconnecting:'Reconectando · recuperando estado',complete:'Estado final preservado',offline:'Estado consolidado'}[W.connection]}</span></div><div class="heading-actions">${button('Auditoria','wf-audit',{icon:'audit'})}${W.run.status==='done'?`<a class="button primary" href="/api/runs/${enc(currentRunId())}/export" download>${icon('download')}Baixar exportação</a>`:'<span class="badge neutral">Exportação após aprovação</span>'}</div>`:''}</div>`;}
  function executionView(){
    const steps=W.run?array(W.run.steps):array(W.definition?.steps);
    return `<div class="wf-layout"><section class="panel wf-step-panel"><div class="panel-header"><div><h2>Passos do fechamento</h2><p>${steps.length} etapas · ${W.run?'versão '+escapeHtml(W.run.pipeline_version||W.run.pipeline?.version||'—'):'definição atual'}</p></div></div><ol class="wf-step-list">${steps.map((step,index)=>`<li><button class="wf-step ${step.id===W.stepId?'selected':''}" data-action="wf-step" data-id="${attr(step.id)}" ${!W.run?'disabled':''}><span class="wf-step-number ${['done','done_with_exceptions'].includes(step.status)?'finished':''}">${step.status==='done'?'✓':index+1}</span><span class="wf-step-copy"><strong>${escapeHtml(stepTitle(step))}</strong>${wb(step.status||'pending')}${W.progress[step.id]?.total?`<progress max="${attr(W.progress[step.id].total)}" value="${attr(W.progress[step.id].done)}" aria-label="Progresso de ${attr(stepTitle(step))}"></progress>`:''}</span></button></li>`).join('')}</ol></section><div class="wf-output">${approvalBanner()}${W.run?stepView():`<section class="panel">${empty('Pronto para executar','Escolha a competência e inicie uma execução. Sem upload, o servidor usa as fontes configuradas para o mês.')}</section>`}${eventFeed()}</div></div>`;
  }
  function approvalBanner(){
    if(!W.run)return'';
    if(W.run.status==='awaiting_approval'){
      const blocking=Number(W.run.blocking_open??W.exceptions.filter(isBlockingOpen).length);
      return `<div class="wf-approval panel"><div><p class="eyebrow">REVISÃO HUMANA</p><h2>A execução precisa de uma decisão</h2><p>${count(W.run.exceptions_open??W.exceptionTotal)} exceções abertas · ${count(blocking)} bloqueantes. Nenhum arquivo para o ERP foi exportado.</p></div><div class="heading-actions">${button('Revisar exceções','wf-tab',{id:'exceptions'})}${button('Reprovar','wf-approval',{value:'reprovar',class:'danger'})}${button('Aprovar execução','wf-approval',{value:'aprovar',class:'primary',disabled:blocking>0})}</div>${blocking>0?'<p class="wf-blocked-note">Aprovação indisponível enquanto houver exceção bloqueante aberta.</p>':''}</div>`;
    }
    if(W.run.status==='rejected')return `<div class="callout warn wf-space">${icon('info')}<span>Esta execução foi reprovada e está preservada para auditoria. Crie uma nova execução para continuar.</span></div>`;
    if(W.run.status==='failed')return `<div class="callout error wf-space">${icon('issues')}<span>A execução falhou. Os passos seguintes não foram exportados. ${escapeHtml(W.run.error?.message||W.run.error||'Consulte a auditoria para identificar a origem.')}</span></div>`;
    return'';
  }
  function stepView(){
    const step=getStep();if(!step)return `<section class="panel">${empty('Selecione um passo','A lista ao lado acompanha o processamento da execução.')}</section>`;
    const metrics=Object.entries(step.metrics||{}).filter(([,value])=>typeof value!=='object');
    return `<section class="panel"><div class="panel-header"><div><h2>${escapeHtml(stepTitle(step))}</h2><p>${escapeHtml(getCatalog(step.type).description||'Resultados preservados desta etapa.')}</p></div>${wb(step.status)}</div><div class="panel-body">${metrics.length?`<div class="wf-metrics">${metrics.map(([key,value])=>`<div><span>${escapeHtml(metricLabels[key]||readable(key))}</span><strong>${(key.endsWith('_brl')||['credit_total','debit_total','total_debit','total_credit'].includes(key))?money(value):escapeHtml(typeof value==='boolean'?(value?'Sim':'Não'):value)}</strong></div>`).join('')}</div>`:''}${!datasetNames(step).length?empty(step.type==='aprovacao'?'Etapa de revisão humana':'Nenhuma tabela disponível',step.type==='aprovacao'?'As decisões estão na aba Exceções.':'Os resultados aparecerão após a conclusão deste passo.'):'<div class="callout info">'+icon('info')+'<span>O preview lê o resultado já salvo. Colunas adicionadas nesta etapa aparecem em destaque.</span></div>'}</div>${datasetNames(step).length?previewView():''}</section>`;
  }
  function previewView(){
    const columns=schemaColumns().filter(c=>!c.name?.startsWith('__'));const options=W.previewOptions,names=datasetNames(getStep());
    return `<form id="wf-preview-form" class="wf-preview-filters"><label class="field"><span>Tabela</span><select name="dataset">${names.map(name=>`<option value="${attr(name)}" ${(options.dataset||W.preview?.dataset||names[0])===name?'selected':''}>${escapeHtml(datasetLabel(name))}</option>`).join('')}</select></label><label class="field"><span>Filtrar coluna</span><select name="column"><option value="">Sem filtro</option>${columns.map(c=>`<option value="${attr(c.name)}" ${options.column===c.name?'selected':''}>${escapeHtml(colLabel(c.name))}</option>`).join('')}</select></label><label class="field"><span>Comparação</span><select name="op">${[['contains','Contém'],['eq','Igual a'],['gt','Maior que'],['lt','Menor que']].map(([v,l])=>`<option value="${v}" ${options.op===v?'selected':''}>${l}</option>`).join('')}</select></label><label class="field"><span>Valor</span><input name="value" value="${attr(options.value)}" placeholder="Valor do filtro"></label><label class="field"><span>Ordenar</span><select name="sort"><option value="">Ordem de origem</option>${columns.map(c=>`<option value="${attr(c.name)}" ${options.sort===c.name?'selected':''}>${escapeHtml(colLabel(c.name))}</option>`).join('')}</select></label><label class="field"><span>Direção</span><select name="order"><option value="asc" ${options.order==='asc'?'selected':''}>Crescente</option><option value="desc" ${options.order==='desc'?'selected':''}>Decrescente</option></select></label><div class="wf-filter-checks"><label><input type="checkbox" name="only" ${options.only?'checked':''}> Só linhas com exceção</label><label><input type="checkbox" name="diff" ${options.diff?'checked':''}> Comparar com entrada</label></div><button class="button" type="submit" ${W.previewLoading?'disabled':''}>Aplicar</button></form>
      ${W.previewError?`<div class="callout error" style="margin:16px">${escapeHtml(W.previewError)}</div>`:''}${W.previewLoading&&!W.preview?'<div class="empty">Carregando dados preservados…</div>':''}${W.preview?.diff?`<div class="wf-diff"><strong>Alterações neste passo</strong>${diffSummary(W.preview.diff)}</div>`:''}${array(W.preview?.rows).length?`<div class="table-wrap"><table><thead><tr><th>Revisão</th>${columns.map(c=>`<th class="${c.new||c.is_new?'wf-new-column':''}" scope="col">${escapeHtml(colLabel(c.name))}${c.new||c.is_new?'<span class="wf-new-tag">nova</span>':''}</th>`).join('')}</tr></thead><tbody>${array(W.preview.rows).map(row=>`<tr class="${array(row.__exception_ids).length?'wf-exception-row':''}"><td>${array(row.__exception_ids).length?array(row.__exception_ids).map(id=>button('Revisar','wf-exception',{id,class:'small'})).join(''):'<span class="cell-secondary">—</span>'}</td>${columns.map(c=>`<td class="${c.type==='money'?'numeric':''} ${c.new||c.is_new?'wf-new-column':''}">${previewCell(c,row[c.name])}</td>`).join('')}</tr>`).join('')}</tbody></table></div>`:W.preview?empty('Nenhuma linha nesta seleção','Ajuste os filtros ou selecione outra tabela.'):''}
      <div class="table-footer"><span>${count(W.preview?.total||0)} linhas · paginação no servidor</span><label class="wf-page-size">Por página <select id="wf-preview-size">${[20,50,100,250,500].map(size=>`<option value="${size}" ${size===W.previewSize?'selected':''}>${size}</option>`).join('')}</select></label><div class="pagination">${button('Anterior','wf-preview-page',{value:W.previewPage-1,class:'small',disabled:W.previewPage<=1||W.previewLoading})}<span>${W.previewPage} / ${Math.max(1,Math.ceil((W.preview?.total||0)/W.previewSize))}</span>${button('Próxima','wf-preview-page',{value:W.previewPage+1,class:'small',disabled:W.previewPage*W.previewSize>=(W.preview?.total||0)||W.previewLoading})}</div></div>`;
  }
  function previewCell(column,value){
    if(value===null||value===undefined||value==='')return'<span class="cell-secondary">—</span>';
    if(column.name==='foreign_amount')return new Intl.NumberFormat('pt-BR',{minimumFractionDigits:2,maximumFractionDigits:2}).format(Number(value));
    if(column.type==='money')return money(value);
    if(typeof value==='boolean')return value?'Sim':'Não';
    if(column.type==='date')return displayDate(value);
    if(typeof value==='object')return escapeHtml(stringify(value));
    return escapeHtml(value);
  }
  function diffSummary(diff){return Object.entries(diff).filter(([key])=>!['added_rows','removed_rows'].includes(key)).map(([key,value])=>`<span>${escapeHtml(({added:'Linhas adicionadas',removed:'Linhas removidas',changed:'Linhas alteradas',rows_added:'Linhas adicionadas',rows_removed:'Linhas removidas',new_columns:'Colunas novas',columns_added:'Colunas novas'})[key]||readable(key))}: ${escapeHtml(Array.isArray(value)?value.map(colLabel).join(', '):stringify(value))}</span>`).join('');}
  function eventFeed(){return W.events.length?`<section class="panel wf-space-top"><div class="panel-header"><h2>Atividade desta conexão</h2></div><div class="panel-body wf-event-feed">${[...W.events].reverse().slice(0,8).map(event=>`<div><span>${dateTime(event.at)}</span><strong>${escapeHtml(eventLabels[event.type]||readable(event.type))}</strong>${event.step_id?`<span>${escapeHtml(stepTitle(array(W.run?.steps).find(step=>step.id===event.step_id)||{type:event.step_id}))}</span>`:''}</div>`).join('')}</div></section>`:'';}
  function isOpen(exception){return !['accepted','adjusted','excluded','resolved','aceitar','ajustar','excluir','closed'].includes(exception.status)&&!exception.decision&&!exception.decisao;}
  function isBlockingOpen(exception){return (exception.severidade||exception.severity)==='bloqueante'&&isOpen(exception);}
  function exceptionsView(){
    if(!W.run)return `<section class="panel">${empty('Nenhuma execução selecionada','Inicie uma execução para revisar as exceções produzidas pelos passos.')}</section>`;
    return approvalBanner()+`<section class="panel"><div class="panel-header"><div><h2>Exceções da execução</h2><p>${count(W.run.exceptions_open??W.exceptions.filter(isOpen).length)} abertas · ${count(W.run.blocking_open??W.exceptions.filter(isBlockingOpen).length)} bloqueantes</p></div>${button('Atualizar','wf-snapshot',{icon:'refresh'})}</div>${W.exceptions.length?`<div class="table-wrap"><table><thead><tr><th>Severidade</th><th>Ocorrência</th><th>Origem</th><th class="numeric">Impacto</th><th>Situação</th><th>Ação</th></tr></thead><tbody>${W.exceptions.map(exception=>`<tr><td>${wb(exception.severidade||exception.severity)}</td><td class="wrap"><strong>${escapeHtml(readable(exception.tipo))}</strong><span class="cell-secondary">${escapeHtml(exception.descricao||exception.description||exception.motivo||'')}</span></td><td class="monospace">${escapeHtml(stringify(exception.ref_origem||exception.source_ref||exception.references||exception.refs||''))}</td><td class="numeric">${money(exception.impacto_rs??exception.valor_brl)}</td><td>${wb(exception.status||exception.decision?.acao||exception.decisao?.acao||'open')}</td><td>${button(isOpen(exception)?'Revisar':'Ver decisão','wf-exception',{id:exception.id,class:'small',icon:'edit'})}</td></tr>`).join('')}</tbody></table></div>`:empty('Nenhuma exceção nesta página','As ocorrências geradas pelo processamento aparecerão aqui.')}<div class="table-footer"><span>${count(W.exceptionTotal)} registros</span><div class="pagination">${button('Anterior','wf-exception-page',{value:W.exceptionPage-1,class:'small',disabled:W.exceptionPage<=1})}<span>${W.exceptionPage} / ${Math.max(1,Math.ceil(W.exceptionTotal/20))}</span>${button('Próxima','wf-exception-page',{value:W.exceptionPage+1,class:'small',disabled:W.exceptionPage*20>=W.exceptionTotal})}</div></div></section>`;
  }
  function schemaFields(step,index){
    const schema=getCatalog(step.type).params_schema||{},properties=schema.properties||{};
    if(!Object.keys(properties).length)return '<p class="cell-secondary">Este passo não possui parâmetros editáveis.</p>';
    return `<div class="wf-param-grid">${Object.entries(properties).map(([key,spec])=>{const value=step.params?.[key]??spec.default??'';const inputAttr=`${spec.const!==undefined?'disabled ':''}data-wf-param="${attr(key)}" data-wf-index="${index}" data-wf-type="${attr(spec.type||'string')}"`;const required=array(schema.required).includes(key);let input;if(spec.enum)input=`<select ${inputAttr}>${spec.enum.map(v=>`<option value="${attr(v)}" ${String(v)===String(value)?'selected':''}>${escapeHtml(readable(v))}</option>`).join('')}</select>`;else if(spec.type==='boolean')input=`<select ${inputAttr}><option value="true" ${value===true?'selected':''}>Sim</option><option value="false" ${value===false?'selected':''}>Não</option></select>`;else if(['object','array'].includes(spec.type))input=`<textarea ${inputAttr} rows="3" aria-label="${attr(spec.title||parameterLabels[key]||readable(key))}">${escapeHtml(typeof value==='object'?JSON.stringify(value,null,2):value)}</textarea>`;else input=`<input ${inputAttr} type="${['number','integer'].includes(spec.type)?'number':'text'}" value="${attr(value)}" ${spec.minimum!==undefined?`min="${spec.minimum}"`:''} ${spec.maximum!==undefined?`max="${spec.maximum}"`:''} ${['number','integer'].includes(spec.type)?`step="${spec.type==='integer'?'1':'any'}"`:''} ${required?'required':''}>`;return `<label class="field"><span>${escapeHtml(spec.title||parameterLabels[key]||readable(key))}${required?' *':''}</span>${input}${spec.description?`<small>${escapeHtml(spec.description)}</small>`:''}${spec.const!==undefined?'<small>Valor fixo nesta implementação.</small>':''}</label>`;}).join('')}</div>`;
  }
  function builderView(){
    if(!W.builder)return '';
    return `<div class="callout info wf-space">${icon('info')}<span>Alterações criam uma nova versão. A ordem precisa respeitar as entradas de cada passo; a aprovação humana continua obrigatória antes da exportação.</span></div><section class="panel"><div class="panel-header"><div><h2>Definição de passos</h2><p>Base: versão ${escapeHtml(W.builder.version)} · as execuções anteriores mantêm a definição original.</p></div><label class="field"><span>Consultar versão</span><select id="wf-definition-version"><option value="">Versão atual</option>${W.versions.map(v=>{const version=typeof v==='object'?v.version:v;return `<option value="${attr(version)}">Versão ${escapeHtml(version)}</option>`;}).join('')}</select></label></div><div class="panel-body"><ol class="wf-builder-list">${array(W.builder.steps).map((step,index)=>`<li class="wf-builder-step"><div class="wf-builder-heading"><span class="wf-step-number">${index+1}</span><div><h3>${escapeHtml(stepTitle(step))}</h3><p>${escapeHtml(getCatalog(step.type).description||'')}</p><span class="cell-secondary">Entradas: ${escapeHtml(array(getCatalog(step.type).inputs).map(datasetLabel).join(', ')||'arquivos')} · Saídas: ${escapeHtml(array(getCatalog(step.type).outputs).map(datasetLabel).join(', ')||'aprovação')}</span></div><div class="wf-order-buttons">${button('↑ Subir','wf-move-step',{id:index,value:-1,class:'small',disabled:index===0})}${button('↓ Descer','wf-move-step',{id:index,value:1,class:'small',disabled:index===W.builder.steps.length-1})}${button('Remover','wf-remove-step',{id:index,class:'small ghost',disabled:step.type==='aprovacao'})}</div></div>${schemaFields(step,index)}</li>`).join('')}</ol><div class="wf-builder-add"><label class="field"><span>Adicionar passo do catálogo</span><select id="wf-catalog-type">${W.catalog.map(step=>`<option value="${attr(step.type)}">${escapeHtml(step.title)}</option>`).join('')}</select></label>${button('Adicionar passo','wf-add-step',{icon:'plus'})}</div>${W.validation?`<div class="callout ${W.validation.valid?'':'error'} wf-space-top">${icon(W.validation.valid?'check':'issues')}<span>${W.validation.valid?'Definição válida. Pronta para salvar uma nova versão.':escapeHtml(detailsMessage(W.validation.errors)||'A definição contém erros.')}</span></div>`:''}<div class="form-actions"><span class="actor-note">As regras financeiras são executadas em código determinístico.</span>${button('Descartar edição','wf-reset-builder')}${button('Validar definição','wf-validate',{disabled:W.busy})}${button('Salvar nova versão','wf-save-definition',{class:'primary',disabled:W.busy})}</div></div></section>`;
  }
  function checklistPage(){
    const tasks=array(W.checklist?.tasks),areas=[...new Set(tasks.map(task=>task.area))];
    return heading('ACOMPANHAMENTO DO MÊS','Checklist do fechamento','Tarefas ligadas aos passos acompanham a execução mais recente. Tarefas manuais têm responsável e comentário.')+`<div class="wf-toolbar">${periodControls()}<span class="subtext">${count(tasks.filter(task=>task.status==='concluida').length)} de ${count(tasks.length)} tarefas concluídas</span></div>${W.error?`<div class="callout error wf-space">${escapeHtml(W.error)}</div>`:''}${areas.map(area=>`<section class="panel wf-space-top"><div class="panel-header"><h2>${escapeHtml(area)}</h2></div><div class="panel-body wf-checklist">${tasks.filter(task=>task.area===area).map(task=>`<article class="wf-checklist-row"><div class="wf-check-icon ${task.status==='concluida'?'done':''}">${task.status==='concluida'?icon('check'):icon(task.manual?'edit':'trace')}</div><div class="wf-checklist-copy"><h3>${escapeHtml(task.title)}</h3><p>${task.manual?'Tarefa manual':'Vinculada a '+escapeHtml(getCatalog(task.step_type).title||readable(task.step_type))}${task.responsavel?' · '+escapeHtml(task.responsavel):''}</p>${task.comentario?`<p>${escapeHtml(task.comentario)}</p>`:''}</div>${wb(task.status)}${button(task.manual?'Atualizar tarefa':'Ver execução',task.manual?'wf-edit-task':'wf-open-pipeline',{id:task.id,class:'small'})}</article>`).join('')}</div></section>`).join('')||empty('Checklist ainda não disponível','Atualize a competência para instanciar as tarefas do mês.')}`;
  }
  function renderPage(page){
    if(!W.loaded&&!W.loading&&!W.error)Promise.resolve().then(()=>ensure());
    if(W.run&&visible()&&!stream&&!terminalStatuses.includes(W.run.status))Promise.resolve().then(connect);
    if(!W.loaded)return heading('CENTRAL DE FECHAMENTO',page==='checklist'?'Checklist':'Pipeline','Carregando definição, execuções e tarefas.')+(W.error?`<div class="callout error">${escapeHtml(W.error)}</div><div class="wf-space-top">${button('Tentar novamente','wf-refresh',{class:'primary'})}</div>`:'<div class="loading" style="min-height:260px"><div class="spinner"></div><p>Consultando o estado preservado no servidor…</p></div>');
    return page==='checklist'?checklistPage():pipelinePage();
  }
  function newRun(){
    openDialog('Executar fechamento',`<form id="modal-form"><p class="form-note">Uma nova execução preserva entradas, definição e saídas. Será usada a versão ${escapeHtml(W.definition?.version||'atual')} do pipeline. A exportação pausa para aprovação humana.</p><div class="form-grid">${field('competencia','Competência',W.period,{required:true,type:'month'})}<label class="field wide"><span>Arquivos da competência (opcional)</span><input type="file" name="files" multiple accept=".csv,.xlsx,.eml,.ofx"><small>Selecione os seis arquivos originais. Sem upload, serão usadas as fontes configuradas para a competência.</small></label></div><p id="wf-upload-status" class="form-note" role="status" style="margin-top:15px"></p>${formFooter('Iniciar execução')}</form>`,async form=>{
      const files=form.getAll('files').filter(file=>file&&file.size>0);if(files.length&&files.length!==6)throw new Error('Selecione os seis arquivos de entrada ou deixe o campo vazio para usar as fontes configuradas.');
      const ids=[];W.busy=true;
      try{
        for(let index=0;index<files.length;index++){const formData=new FormData();formData.append('file',files[index]);$('#wf-upload-status').textContent=`Importando ${index+1} de ${files.length}: ${files[index].name}`;const result=await request('/api/files',{method:'POST',body:formData,multipart:true});ids.push(result.file_id);}
        const result=await request('/api/runs',{method:'POST',body:{pipeline_id:W.pipelineId,pipeline_version:W.definition?.version,competencia:form.get('competencia'),...(ids.length?{file_ids:ids}:{})}});
        W.period=form.get('competencia');W.tab='execution';const runs=await request(`/api/runs?competencia=${enc(W.period)}`);W.runs=array(runs.runs);await selectRun(result.run_id);await refreshChecklist();toast('Execução iniciada. O progresso e os resultados aparecem por etapa.');
      }finally{W.busy=false;repaint();}
    });
  }
  async function findException(id){
    const known=W.exceptions.find(e=>e.id===id);if(known)return known;
    let page=1;while(page<=50){const response=await request(`/api/runs/${enc(currentRunId())}/exceptions?page=${page}&page_size=500`);const items=array(response.exceptions||response.items);const match=items.find(e=>e.id===id);if(match)return match;if(!items.length||page*500>=(response.total||items.length))break;page++;}
    throw new Error('Exceção não encontrada nesta execução. Atualize o estado.');
  }
  async function exceptionDialog(id){
    const exception=await findException(id);const readOnly=W.run.status!=='awaiting_approval';const previous=exception.decision||exception.decisao||{};
    const detail={tipo:readable(exception.tipo),severity:exception.severidade||exception.severity,motivo:exception.descricao||exception.description||exception.motivo,ref_origem:exception.ref_origem||exception.source_ref||exception.references||exception.refs,valor_brl:exception.impacto_rs??exception.valor_brl,step_id:exception.step_id,decision:exception.decision||exception.decisao};
    openDialog(readOnly?'Decisão da exceção':'Revisar exceção',`${detailsGrid(detail)}${readOnly?'<div class="callout info">'+icon('info')+'<span>Este registro está preservado na auditoria. A revisão só fica disponível enquanto a execução aguarda aprovação.</span></div>':`<form id="modal-form"><div class="form-grid">${field('acao','Encaminhamento',previous.acao||'aceitar',{required:true,options:[['aceitar','Aceitar e seguir com a evidência'],['ajustar','Ajustar valor ou conta'],['excluir','Excluir do lote de exportação']]})}${field('valor','Valor corrigido (R$)',previous.valor||'',{type:'number',min:0,step:'0.01',help:'Somente para ajuste. Não preencha para manter o valor.'})}${field('conta','Conta corrigida',previous.conta||'',{options:accountsOptions(),help:'Somente contas analíticas que aceitam lançamentos.'})}${field('entry_id','Identificador do lançamento (se houver mais de um)',previous.entry_id||'',{help:'Para ajuste ambíguo, informe o entry_id mostrado no preview de Gerar lançamentos.'})}${field('justificativa','Justificativa da decisão',previous.justificativa||'',{required:true,textarea:true,wide:true})}</div><div class="callout info wf-space-top">${icon('info')}<span>A decisão cria um ajuste rastreável para a exportação. Os resultados originais dos passos permanecem preservados.</span></div>${formFooter('Registrar decisão')}</form>`}`,readOnly?null:async form=>{
      const choice=form.get('acao'),value=form.get('valor'),account=form.get('conta');if(choice==='ajustar'&&!value&&!account)throw new Error('Informe um valor corrigido ou uma conta para ajustar.');
      await request(`/api/runs/${enc(currentRunId())}/exceptions/${enc(id)}/decision`,{method:'POST',body:{acao:choice,justificativa:form.get('justificativa'),...(choice==='ajustar'&&value!==''?{valor:value}:{}),...(choice==='ajustar'&&account?{conta:account}:{}),...(choice!=='aceitar'&&form.get('entry_id')?{entry_id:form.get('entry_id')}:{})}});await snapshot();toast('Decisão registrada. A saída original do passo foi preservada.');
    },true);
  }
  function approveDialog(decision){
    const blocked=Number(W.run.blocking_open??W.exceptions.filter(isBlockingOpen).length);if(decision==='aprovar'&&blocked>0)throw new Error('Resolva as exceções bloqueantes antes de aprovar.');
    openDialog(decision==='aprovar'?'Aprovar execução e exportar':'Reprovar execução',`<form id="modal-form"><div class="callout ${decision==='aprovar'?'info':'warn'}">${icon('info')}<span>${decision==='aprovar'?'A aprovação autoriza a geração dos arquivos do lote para o ERP. Nenhum arquivo é transmitido automaticamente a um sistema externo.':'Esta execução será encerrada como reprovada. Nenhum lote será exportado; para continuar, inicie uma nova execução.'}</span></div><div class="form-grid wf-space-top">${field('comentario','Comentário da revisão','',{required:true,textarea:true,wide:true})}</div>${formFooter(decision==='aprovar'?'Aprovar e gerar exportação':'Confirmar reprovação')}</form>`,async form=>{await request(`/api/runs/${enc(currentRunId())}/approval`,{method:'POST',body:{decisao:decision,comentario:form.get('comentario')}});await snapshot();connect();toast(decision==='aprovar'?'Aprovação registrada. A exportação será disponibilizada ao concluir.':'Execução reprovada e arquivada.');});
  }
  async function auditDialog(){const result=await request(`/api/runs/${enc(currentRunId())}/audit`);openDialog('Auditoria da execução',`<div class="heading-actions" style="justify-content:flex-start;margin-bottom:18px"><a class="button" href="/api/runs/${enc(currentRunId())}/audit" download="auditoria.json">${icon('download')}Baixar auditoria JSON</a></div>${detailsGrid(result)}`,null,true);}
  function editTask(id){
    const task=array(W.checklist?.tasks).find(t=>t.id===id);if(!task?.manual)throw new Error('Tarefas vinculadas a passos têm situação derivada da execução.');
    openDialog('Atualizar tarefa manual',`<form id="modal-form"><h3>${escapeHtml(task.title)}</h3><p class="form-note">Área: ${escapeHtml(task.area)}</p><div class="form-grid">${field('status','Situação',task.status,{required:true,options:[['pendente','Pendente'],['em_andamento','Em andamento'],['concluida','Concluída']]})}${field('responsavel','Responsável pela tarefa',task.responsavel||actorInput.value,{required:true})}${field('comentario','Comentário',task.comentario,{textarea:true,wide:true})}</div>${formFooter('Salvar tarefa')}</form>`,async form=>{await request(`/api/checklist/${enc(id)}`,{method:'PATCH',body:{status:form.get('status'),responsavel:form.get('responsavel'),comentario:form.get('comentario')}});await refreshChecklist();repaint();toast('Tarefa manual atualizada.');});
  }
  function draftDefinition(){return {id:W.pipelineId,version:W.builder.version,steps:W.builder.steps.map(step=>({id:step.id,type:step.type,params:step.params||{}}))};}
  async function validateBuilder(){
    for(const control of document.querySelectorAll('[data-wf-param]'))if(!control.checkValidity()){control.reportValidity();W.validation={valid:false,errors:['Revise os parâmetros destacados antes de validar.']};return W.validation;}
    try{W.validation=await request(`/api/pipelines/${enc(W.pipelineId)}/validate`,{method:'POST',body:draftDefinition()});}catch(error){W.validation={valid:false,errors:[error.message]};}
    repaint();return W.validation;
  }
  async function action(name,id,value){
    W.error='';
    if(name==='wf-refresh')return ensure(true);
    if(name==='wf-tab'){W.tab=id;if(id==='exceptions')await loadExceptions();return repaint();}
    if(name==='wf-new-run')return newRun();
    if(name==='wf-step'){W.stepId=id;W.preview=null;W.previewPage=1;W.previewOptions={dataset:'',column:'',op:'contains',value:'',sort:'',order:'asc',only:false,diff:false};repaint();return loadPreview();}
    if(name==='wf-snapshot')return snapshot();
    if(name==='wf-preview-page'){W.previewPage=Number(value);return loadPreview();}
    if(name==='wf-exception-page'){W.exceptionPage=Number(value);await loadExceptions();return repaint();}
    if(name==='wf-exception')return exceptionDialog(id);
    if(name==='wf-approval')return approveDialog(value);
    if(name==='wf-audit')return auditDialog();
    if(name==='wf-edit-task')return editTask(id);
    if(name==='wf-open-pipeline'){W.tab='execution';location.hash='pipeline';return;}
    if(name==='wf-move-step'){const from=Number(id),to=from+Number(value);if(to>=0&&to<W.builder.steps.length)[W.builder.steps[from],W.builder.steps[to]]=[W.builder.steps[to],W.builder.steps[from]];W.validation=null;return repaint();}
    if(name==='wf-remove-step'){if(W.builder.steps[Number(id)]?.type!=='aprovacao')W.builder.steps.splice(Number(id),1);W.validation=null;return repaint();}
    if(name==='wf-add-step'){const type=$('#wf-catalog-type').value,spec=getCatalog(type),params={};for(const [key,item]of Object.entries(spec.params_schema?.properties||{}))if(item.default!==undefined)params[key]=structuredClone(item.default);let next=1;while(W.builder.steps.some(step=>step.id===`s${next}`))next++;W.builder.steps.push({id:`s${next}`,type,params});W.validation=null;return repaint();}
    if(name==='wf-reset-builder'){W.builder=structuredClone(W.definition);W.validation=null;return repaint();}
    if(name==='wf-validate')return validateBuilder();
    if(name==='wf-save-definition'){
      actor();W.busy=true;repaint();try{const checked=await validateBuilder();if(!checked.valid)return;await request(`/api/pipelines/${enc(W.pipelineId)}`,{method:'PUT',body:draftDefinition()});W.definition=await request(`/api/pipelines/${enc(W.pipelineId)}`);W.builder=structuredClone(W.definition);W.versions=array((await request(`/api/pipelines/${enc(W.pipelineId)}/versions`)).versions);W.validation=null;toast('Nova versão salva. Execuções anteriores permanecem preservadas.');}finally{W.busy=false;repaint();}return;
    }
  }
  document.addEventListener('change',async event=>{
    try{
      if(event.target.id==='wf-period'){const period=event.target.value;if(!/^\d{4}-(0[1-9]|1[0-2])$/.test(period))return;W.period=period;pause();W.run=null;W.loaded=false;W.preview=null;W.error='';await ensure(true);}
      if(event.target.id==='wf-run-select'&&event.target.value)await selectRun(event.target.value);
      if(event.target.id==='wf-preview-size'){W.previewSize=Math.min(500,Number(event.target.value));W.previewPage=1;await loadPreview();}
      if(event.target.id==='wf-definition-version'){W.builder=structuredClone(await request(`/api/pipelines/${enc(W.pipelineId)}${event.target.value?'?version='+enc(event.target.value):''}`));W.validation=null;repaint();}
    }catch(error){toast(error.message,true);}
  });
  document.addEventListener('input',event=>{
    const control=event.target;if(!control.dataset.wfParam)return;
    const step=W.builder?.steps[Number(control.dataset.wfIndex)];if(!step)return;
    let value=control.value;try{if(control.dataset.wfType==='boolean')value=value==='true';else if(['number','integer'].includes(control.dataset.wfType)&&value!=='')value=Number(value);else if(['object','array'].includes(control.dataset.wfType))value=JSON.parse(value);control.setCustomValidity('');}catch(_){control.setCustomValidity('Informe uma configuração válida.');return;}
    step.params||={};step.params[control.dataset.wfParam]=value;W.validation=null;
  });
  document.addEventListener('submit',async event=>{
    if(event.target.id!=='wf-preview-form')return;event.preventDefault();const data=new FormData(event.target);W.previewOptions={dataset:data.get('dataset'),column:data.get('column'),op:data.get('op'),value:data.get('value'),sort:data.get('sort'),order:data.get('order'),only:data.get('only')==='on',diff:data.get('diff')==='on'};W.previewPage=1;await loadPreview();
  });
  window.addEventListener('beforeunload',pause);
  return {renderPage,action,pause,request};
})();

if(state&&['pipeline','checklist'].includes(activePage))render();
