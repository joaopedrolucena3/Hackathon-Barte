/* External issue mail: explicit generation, exact-version review, session-protected approval. */
'use strict';
window.TarvoMail=(()=>{
  const M={loaded:false,loading:false,error:'',account:null,contacts:[],drafts:[],view:'drafts',filter:'',search:'',review:null,history:null,busy:new Set(),generating:new Set(),pollTimer:null,pollAttempts:0,connectionUnknown:false,disconnectNotice:''};
  const enc=encodeURIComponent;
  const statusNames={draft:['Rascunho','neutral'],sending:['Envio em andamento','blue'],sent:['Aceito pelo Gmail','green'],failed:['Falha conhecida','red'],uncertain:['Resultado incerto','amber']};
  function senderEmail(value){return typeof value==='string'?value:value?.email||'';}
  function testProvider(draft){const mode=draft?.provider_mode||M.account?.provider_mode;return ['test','mock','fake','simulated','simulation','sandbox','injected','injected_test'].includes(mode);}
  function statusBadge(draft){const [label,color]=statusNames[draft.status]||[readable(draft.status),'neutral'];return `<span class="badge ${color}">${escapeHtml(draft.status==='sent'&&testProvider(draft)?'Aceito pelo provedor de teste':label)}</span>`;}
  function counterpartyName(value){return value==='orbe'?'Orbe':value==='ponte'?'Ponte Câmbio':'Contraparte a revisar';}
  function repaint(){if(activePage==='mail'&&state)render();}
  function errorDetails(details){return array(details).map(d=>typeof d==='string'?d:d.message||d.msg||'').filter(Boolean).join('\n');}
  async function request(path,{method='GET',body,declaredActor=true}={}){
    const headers={};
    if(method!=='GET'){
      headers['Content-Type']='application/json';
      if(declaredActor){headers['X-User']=encodeURIComponent(actor());headers['X-User-Encoding']='percent-utf8';}
      if(M.account?.csrf_token)headers['X-CSRF-Token']=M.account.csrf_token;
    }
    const response=await fetch(path,{method,credentials:'same-origin',cache:'no-store',headers,...(body!==undefined?{body:JSON.stringify(body)}:{})});
    let result;try{result=await response.json();}catch(_){throw new Error('Não foi possível confirmar a resposta do servidor. Atualize o estado antes de tentar outra ação.');}
    if(!response.ok||result.error){const info=result.error||{};const error=new Error([typeof info==='string'?info:info.message||'Não foi possível concluir a operação.',errorDetails(info.details)].filter(Boolean).join('\n'));error.code=info.code;error.details=info.details;error.httpStatus=response.status;throw error;}
    return result;
  }
  function normalizeDraft(value){return value?.draft||value;}
  async function refreshAccount(){M.account=await request('/api/mail/account');return M.account;}
  async function load(force=false){
    if(M.loading||M.loaded&&!force)return;
    M.loading=true;M.error='';
    try{
      const results=await Promise.allSettled([refreshAccount(),request('/api/mail/contacts'),request('/api/mail/drafts')]);
      const failed=results.find(r=>r.status==='rejected');if(failed)throw failed.reason;
      M.contacts=array(results[1].value.contacts||results[1].value);M.drafts=array(results[2].value.drafts||results[2].value);M.loaded=true;
      startReadOnlyPolling();
    }catch(error){M.error=error.message;}finally{M.loading=false;repaint();}
  }
  function replaceDraft(draft){const index=M.drafts.findIndex(d=>d.id===draft.id);if(index>=0)M.drafts[index]=draft;else M.drafts.unshift(draft);}
  function startReadOnlyPolling(){
    clearTimeout(M.pollTimer);M.pollTimer=null;
    if(!M.drafts.some(d=>d.status==='sending')||M.pollAttempts>=30)return;
    M.pollTimer=setTimeout(async()=>{
      M.pollAttempts++;
      try{
        const pending=M.drafts.filter(d=>d.status==='sending');
        for(const draft of pending){const updated=normalizeDraft(await request(`/api/mail/drafts/${enc(draft.id)}`));replaceDraft(updated);if(M.review?.id===updated.id&&$('#dialog').open&&updated.status!=='sending')renderReview(updated);}
        repaint();
      }catch(_){M.connectionUnknown=true;repaint();}
      startReadOnlyPolling();
    },2200);
  }
  function accountCard(compact=false){
    const account=M.account||{};const email=account.email||senderEmail(account.account);const test=testProvider();
    return `<section class="panel mail-account ${compact?'compact':''}"><div class="mail-account-heading"><div class="mail-account-icon">${icon('emails')}</div><div><p class="eyebrow">CONTA REMETENTE</p><h2>${escapeHtml(email||'Nenhuma conta Gmail conectada')}</h2><p>${account.authorized?'Esta sessão está autorizada pela conta Google.':account.connected?'A conta está conectada, mas esta sessão ainda precisa de autorização.':'Conecte uma conta Gmail de teste para revisar e aprovar o envio.'}</p></div><div class="mail-account-state">${account.authorized?'<span class="badge green">Sessão autorizada</span>':account.connected?'<span class="badge amber">Sessão não autorizada</span>':'<span class="badge neutral">Desconectada</span>'}${test?'<span class="badge blue">Provedor de teste</span>':'<span class="badge neutral">Envio pela Gmail API</span>'}</div></div><div class="mail-account-footer"><span>${test?'Ambiente de teste: nenhuma mensagem é enviada ao Gmail real.':'Permissão de envio. A plataforma não lê a caixa de entrada.'}</span><div class="heading-actions">${button(account.connected?'Autorizar esta sessão':'Conectar conta Google','mail-connect',{icon:'close',disabled:!account.configured||M.busy.has('oauth')})}${account.connected?button('Desconectar','mail-disconnect',{class:'ghost',disabled:!account.authorized}):''}${button('Atualizar estado','mail-refresh',{class:'small',icon:'refresh'})}</div></div>${M.disconnectNotice?`<div class="callout warn mail-config-note">${icon('info')}<span>${escapeHtml(M.disconnectNotice)}</span></div>`:''}${!account.configured?`<div class="callout warn mail-config-note">${icon('info')}<div><strong>A integração ainda precisa de configuração local.</strong><p>${array(account.missing_config).length?'Falta configurar: '+array(account.missing_config).map(item=>escapeHtml(typeof item==='string'?item:item.name||item.message||'configuração requerida')).join(', ')+'.':'As credenciais OAuth da aplicação ainda não estão disponíveis no servidor.'}</p><p>Credenciais e tokens ficam no servidor; não os cole nesta tela.</p><p><a class="text-link" href="/api/mail/setup" target="_blank" rel="noopener">Ver guia de configuração Gmail →</a></p></div></div>`:''}</section>`;
  }
  function renderPage(){
    if(!M.loaded&&!M.loading&&!M.error)Promise.resolve().then(()=>load());
    const top=heading('COMUNICAÇÃO DE PENDÊNCIAS','Gmail · pendências','Gere a mensagem a partir de uma pendência, confira as evidências e aprove a versão exata para envio.',button('Ir para pendências','mail-issues',{icon:'issues'}));
    if(!M.loaded)return top+(M.error?`<div class="callout error">${escapeHtml(M.error)}</div><div class="mail-space">${button('Tentar novamente','mail-refresh',{class:'primary'})}</div>`:'<div class="loading" style="min-height:260px"><div class="spinner"></div><p>Consultando conta, contatos e rascunhos…</p></div>');
    return top+accountCard()+`<div class="callout info mail-space">${icon('info')}<span>A sessão Google autoriza o envio. O nome do responsável é uma declaração para auditoria e não comprova identidade individual. Enviar um e-mail não resolve a pendência nem conclui o fechamento.</span></div>`+tabs([['drafts','Rascunhos e comunicações',M.drafts.length],['contacts','Destinatários Orbe e Ponte'],['access','Conta e acesso']],M.view,'mail-view')+(M.error?`<div class="callout error mail-space">${escapeHtml(M.error)}</div>`:'')+(M.connectionUnknown?`<div class="callout warn mail-space">${icon('info')}<span>A conexão foi interrompida durante a consulta de status. Nenhum envio será repetido automaticamente. Atualize o estado ou confira manualmente o Gmail.</span></div>`:'')+(M.view==='contacts'?contactsView():M.view==='access'?accessView():draftList());
  }
  function draftList(){
    const list=M.drafts.filter(d=>(!M.filter||d.status===M.filter)&&(!M.search||[d.subject,d.to,d.issue_id,d.body].join(' ').toLocaleLowerCase('pt-BR').includes(M.search.toLocaleLowerCase('pt-BR'))));
    return `<section class="panel"><div class="table-toolbar"><label class="search-field">${icon('search')}<input id="mail-search" type="search" value="${attr(M.search)}" placeholder="Buscar pendência, destinatário ou assunto…" aria-label="Buscar comunicações Gmail"></label><select id="mail-status-filter" aria-label="Filtrar situação do envio"><option value="">Todas as situações</option>${Object.entries(statusNames).map(([key,[name]])=>`<option value="${key}" ${M.filter===key?'selected':''}>${name}</option>`).join('')}</select><span class="cell-secondary">${count(list.length)} comunicações</span></div>${list.length?`<div class="mail-draft-list">${[...list].sort((a,b)=>new Date(b.updated_at||b.created_at)-new Date(a.updated_at||a.created_at)).map(draft=>`<article class="mail-draft-row"><div class="mail-draft-icon">${icon('emails')}</div><div class="mail-draft-content"><div class="pill-line">${statusBadge(draft)}<span class="badge neutral">${counterpartyName(draft.counterparty)}</span>${draft.stale?'<span class="badge amber">Evidências desatualizadas</span>':''}</div><h3>${escapeHtml(draft.subject||'Mensagem da pendência')}</h3><p>Para: ${escapeHtml(draft.to||'Destinatário a configurar')}</p><div class="mail-draft-meta"><span class="monospace">${escapeHtml(draft.issue_id)}</span><span>Versão ${escapeHtml(draft.version)}</span><span>${dateTime(draft.updated_at||draft.created_at)}</span><span>${array(draft.attachments).length} anexos</span></div></div><div class="mail-draft-actions">${button(['sent','uncertain','sending'].includes(draft.status)?'Ver registro':'Revisar','mail-open',{id:draft.id,class:'small',icon:'edit'})}${button('Histórico','mail-history',{id:draft.issue_id,class:'small',icon:'audit'})}</div></article>`).join('')}</div>`:empty('Nenhuma comunicação nesta seleção','Use “Gerar e-mail” em uma pendência para preparar uma mensagem com as evidências relacionadas.')}</section>`;
  }
  function contactsView(){
    return `<div class="mail-contact-grid">${['orbe','ponte'].map(counterparty=>{const contact=M.contacts.find(c=>c.counterparty===counterparty)||{};return `<section class="panel mail-contact-card"><div class="pill-line"><span class="badge neutral">${counterparty==='orbe'?'Checkout':'Remessas'}</span><span class="badge ${contact.email&&contact.enabled?'green':'amber'}">${contact.email&&contact.enabled?'Contato ativo':'Configuração pendente'}</span></div><h2>${counterpartyName(counterparty)}</h2><p>${escapeHtml(contact.name||'Contato ainda não cadastrado')}</p><strong class="mail-contact-address">${escapeHtml(contact.email||'Nenhum endereço configurado')}</strong><p class="subtext">${counterparty==='orbe'?'Destinatário sugerido para pendências estruturadas de checkout.':'Destinatário sugerido para pendências estruturadas de remessas.'}</p><div class="form-actions">${button(contact.email?'Editar contato':'Cadastrar contato','mail-edit-contact',{id:counterparty,class:'primary',icon:'edit'})}</div></section>`;}).join('')}</div><div class="callout info mail-space">${icon('info')}<span>Cadastre endereços de teste para a demonstração. Nenhum destinatário é extraído automaticamente dos documentos de origem. Estes contatos são separados dos avisos e cobranças simulados.</span></div>`;
  }
  function accessView(){return `<section class="panel"><div class="panel-header"><h2>O que esta autorização permite</h2></div><div class="panel-body"><ul class="note-list"><li>Enviar mensagens de pendências pela conta conectada, após revisão e aprovação explícita.</li><li>Manter rascunhos, anexos e histórico na plataforma. A integração não lê mensagens recebidas.</li><li>Registrar separadamente a conta Google autorizada e o nome declarado do responsável.</li><li>Preservar cobranças, relatórios e alertas internos existentes exclusivamente em simulação.</li><li>Desconectar a conta impede novos envios por esta conexão. Os registros anteriores continuam disponíveis.</li></ul><div class="callout info">${icon('info')}<span>A demonstração usa uma conta Gmail de teste. O endereço corporativo futuro não é utilizado como remetente.</span></div></div></section>`;}
  function contactDialog(counterparty){
    const contact=M.contacts.find(c=>c.counterparty===counterparty)||{};
    openDialog(`Contato da ${counterpartyName(counterparty)}`,`<form id="modal-form"><p class="form-note">Este endereço será sugerido nas mensagens para ${counterpartyName(counterparty)}. Use uma caixa de teste sob controle do time na demonstração.</p><div class="form-grid">${field('name','Nome do contato',contact.name,{required:true})}${field('email','E-mail do destinatário',contact.email,{required:true,type:'email'})}${field('enabled','Contato ativo',contact.enabled===false?'false':'true',{options:[['true','Sim'],['false','Não']]})}</div>${formFooter('Salvar contato')}</form>`,async form=>{
      await request(`/api/mail/contacts/${enc(counterparty)}`,{method:'PUT',body:{email:form.get('email'),name:form.get('name'),enabled:form.get('enabled')==='true'}});M.contacts=array((await request('/api/mail/contacts')).contacts);repaint();toast('Contato salvo. Revise o destinatário dos rascunhos já existentes.');
    });
  }
  function blockersView(draft){
    const blockers=array(draft.blockers);
    return blockers.length?`<div class="callout warn mail-space">${icon('issues')}<div><strong>${['sent','uncertain','sending'].includes(draft.status)?'Proteção contra reenvio':'Antes de enviar'}</strong><ul>${blockers.map(item=>`<li>${escapeHtml(typeof item==='string'?item:item.message||item.code)}</li>`).join('')}</ul></div></div>`:'';
  }
  function attachmentsView(draft){
    return `<section class="mail-attachments"><div class="mail-section-heading"><h3>Evidências anexadas</h3><span class="cell-secondary">${array(draft.attachments).length} arquivos desta versão</span></div>${array(draft.attachments).length?array(draft.attachments).map(attachment=>{const base=`/api/mail/drafts/${enc(draft.id)}/attachments/${enc(attachment.id)}`;return `<div class="mail-attachment"><div class="mail-file-icon">${icon('source')}</div><div><strong>${escapeHtml(attachment.name)}</strong><span>${escapeHtml(attachment.content_type)} · ${count(attachment.size)} bytes</span><span class="monospace" title="${attr(attachment.sha256)}">SHA-256 ${escapeHtml(String(attachment.sha256||'').slice(0,18))}…</span></div><a class="button small" href="${base}" target="_blank" rel="noopener">Ver</a><a class="button small" href="${base}?download=1" download>${icon('download')}Baixar</a></div>`;}).join(''):'<p class="subtext">Nenhum anexo disponível. Revise os bloqueios antes de aprovar.</p>'}<p class="mail-attachment-note">Somente as evidências vinculadas a esta ocorrência são incluídas. O conteúdo aprovado é preservado para auditoria.</p></section>`;
  }
  function sendStatus(draft){
    if(draft.status==='sent')return `<div class="callout ${testProvider(draft)?'info':''} mail-space">${icon('check')}<span>${testProvider(draft)?'<strong>Teste simulado concluído.</strong> O provedor de teste aceitou a mensagem; nenhum e-mail real foi enviado.':'<strong>Aceito pelo Gmail.</strong> Isso não confirma entrega nem leitura pelo destinatário.'}${draft.provider_message_id?` Referência: ${escapeHtml(draft.provider_message_id)}.`:''}</span></div>`;
    if(draft.status==='sending')return `<div class="callout info mail-space">${icon('refresh')}<span><strong>Envio em andamento.</strong> Estamos consultando o resultado. Nenhuma nova tentativa será feita automaticamente.</span></div>`;
    if(draft.status==='uncertain')return `<div class="callout warn mail-space">${icon('issues')}<span><strong>Resultado incerto.</strong> Não é seguro repetir este envio. Confira manualmente a pasta Enviados da conta ${escapeHtml(senderEmail(draft.sender)||'conectada')} no Gmail. Atualizar o estado apenas consulta o registro.</span></div>`;
    if(draft.status==='failed')return `<div class="callout error mail-space">${icon('issues')}<span><strong>Falha conhecida.</strong> ${escapeHtml(draft.error?.message||draft.last_error?.message||draft.error_message||'A mensagem não teve envio confirmado.')} Não há nova tentativa automática. Salve uma revisão e confira a nova versão antes de aprová-la.</span></div>`;
    return '';
  }
  function immutableSnapshot(draft){return JSON.stringify({sender:draft.sender||null,evidence_hash:draft.evidence_hash,attachments:array(draft.attachments).map(a=>({name:a.name,sha256:a.sha256,content_type:a.content_type,size:a.size})).sort((a,b)=>a.name.localeCompare(b.name))});}
  function canApprove(draft,ignoreBusy=false){return draft.status==='draft'&&!draft.stale&&M.account?.connected&&M.account?.authorized&&!array(draft.blockers).length&&(ignoreBusy||!M.busy.has(draft.id))&&draft.sender?.connection_id===M.account?.connection?.connection_id&&draft.sender?.email===M.account?.connection?.email&&!!draft.sender?.connection_id;}
  function matchesSavedFields(form,draft){const values=new FormData(form);return String(values.get('to')||'').trim()===draft.to&&String(values.get('subject')||'')===draft.subject&&String(values.get('body')||'')===draft.body&&!values.get('counterparty')&&!values.get('counterparty_reason');}
  function syncReviewApproval(reset=false){const form=$('#mail-review-form');if(!form||!M.review)return;const permission=form.querySelector('[name="permission"]'),approve=form.querySelector('[value="approve"]');if(!permission||!approve)return;const allowed=canApprove(M.review)&&matchesSavedFields(form,M.review)&&!!form.querySelector('[name="actor_name"]')?.value.trim();if(reset||!allowed)permission.checked=false;permission.disabled=!allowed;approve.disabled=!allowed||!permission.checked;}
  function renderReview(draft){
    M.review=draft;replaceDraft(draft);
    const readonly=['sending','sent','uncertain'].includes(draft.status);const issue=draft.issue||issues().find(row=>identifier(row)===draft.issue_id)||{};const sender=senderEmail(draft.sender);const currentSender=senderEmail(draft.current_sender)||M.account?.email||'';
    const ambiguous=!draft.counterparty;const editable=!readonly;
    const statusBar=`<div class="pill-line">${statusBadge(draft)}<span class="badge neutral">${counterpartyName(draft.counterparty)}</span><span class="cell-secondary">Versão ${escapeHtml(draft.version)} · ${escapeHtml(draft.period||'')}</span>${draft.stale?'<span class="badge amber">Revisão desatualizada</span>':''}</div>`;
    const source=`<section class="mail-origin"><div><p class="eyebrow">PENDÊNCIA DE ORIGEM</p><h3>${escapeHtml(readable(issue.tipo)||'Pendência financeira ou de dados')}</h3><p>${escapeHtml(issue.motivo||issue.descricao||'Consulte as referências preservadas nos anexos.')}</p></div><div class="mail-origin-meta"><span class="monospace">${escapeHtml(draft.issue_id)}</span><span>Referência: ${escapeHtml(stringify(issue.ref_origem||'—'))}</span>${issue.valor_brl!==undefined?`<span>Valor de referência: ${money(issue.valor_brl)}</span>`:''}</div></section>`;
    const accountInfo=`<div class="mail-review-identities"><div><span>Remetente desta versão</span><strong>${escapeHtml(sender||'Conta remetente ainda não vinculada')}</strong></div><div><span>Sessão Google</span><strong>${escapeHtml(M.account?.authorized?(M.account.email||currentSender):'Não autorizada para enviar')}</strong><small>O nome do analista é registrado separadamente.</small></div></div>`;
    const actions=editable?`<div class="form-error" role="alert"></div><div class="mail-review-actions"><label class="field actor-note"><span>Responsável declarado *</span><input name="actor_name" value="${attr(actorInput.value.trim())}" required maxlength="100" autocomplete="name" placeholder="Seu nome"></label><button type="submit" name="intent" value="save" class="button">Salvar para revisão</button><button type="submit" name="intent" value="approve" class="button primary" disabled>Autorizar e enviar esta versão</button></div><p class="mail-send-explanation">Salve as alterações e confira a versão retornada antes de dar permissão. ${testProvider(draft)?'O provedor atual é de teste; não envia mensagens reais.':'A autorização inicia o envio real desta versão salva pela conta conectada.'}</p><label class="mail-send-explanation"><input type="checkbox" name="permission" value="true" disabled> Revisei a justificativa, o texto e os anexos. Autorizo enviar a versão ${escapeHtml(draft.version)} para <strong>${escapeHtml(draft.to||'o destinatário informado')}</strong>, usando <strong>${escapeHtml(sender||'a conta remetente')}</strong>.</label>`:`<div class="form-actions">${button('Atualizar estado','mail-open',{id:draft.id,icon:'refresh'})}${button('Fechar','close-dialog')}</div>`;
    openDialog(readonly?'Registro da comunicação':'Revisar e-mail da pendência',`${statusBar}${source}${accountInfo}${sendStatus(draft)}${blockersView(draft)}${editable&&(draft.stale||!sender||sender!==currentSender||ambiguous)?`<div class="callout warn mail-space">${icon('info')}<span>Confirme a contraparte e atualize explicitamente o texto e as evidências antes de enviar. A atualização abre uma nova versão para revisão.</span></div>`:''}<form id="mail-review-form" data-draft-id="${attr(draft.id)}"><div class="form-grid">${editable&&ambiguous?`${field('counterparty','Contraparte confirmada','',{options:[['','Selecione após conferir a origem'],['orbe','Orbe · checkout'],['ponte','Ponte Câmbio · remessas']]})}${field('counterparty_reason','Justificativa do vínculo','',{help:'Informe a evidência que identifica a contraparte.'})}`:''}${readonly?`<div class="field wide"><span>Destinatário</span><div class="mail-readonly">${escapeHtml(draft.to||'—')}</div></div><div class="field wide"><span>Assunto</span><div class="mail-readonly">${escapeHtml(draft.subject)}</div></div><div class="field wide"><span>Mensagem preservada</span><div class="email-detail-body">${escapeHtml(draft.body)}</div></div>`:`${field('to','Destinatário',draft.to,{type:'email',wide:true,help:'Confira o endereço antes de aprovar. Nenhum contato é inferido do documento.'})}${field('subject','Assunto',draft.subject,{required:true,wide:true})}${field('body','Mensagem',draft.body,{required:true,textarea:true,rows:10,wide:true})}`}</div>${attachmentsView(draft)}${editable?`<div class="mail-refresh-row">${button('Atualizar texto e evidências','mail-refresh-evidence',{id:draft.id,icon:'refresh'})}<span>Regenera o modelo e os anexos; exige nova revisão antes do envio.</span></div>`:''}${actions}</form><section class="mail-history-section"><div class="mail-section-heading"><h3>Histórico desta pendência</h3>${button('Consultar histórico','mail-history',{id:draft.issue_id,class:'small',icon:'audit'})}</div><div id="mail-review-history"><p class="cell-secondary">Conteúdo, aprovações, tentativas e anexos são preservados por versão.</p></div></section>`,null,true);
    syncReviewApproval();
  }
  async function openReview(id){await refreshAccount();const draft=normalizeDraft(await request(`/api/mail/drafts/${enc(id)}`));renderReview(draft);startReadOnlyPolling();}
  function updateOpenReview(draft){replaceDraft(draft);if(M.review?.id===draft.id&&$('#dialog').open)renderReview(draft);repaint();}
  async function generate(issueId){
    if(M.generating.has(issueId))return;actor();M.generating.add(issueId);
    try{await refreshAccount();const draft=normalizeDraft(await request('/api/mail/drafts',{method:'POST',body:{issue_id:issueId}}));replaceDraft(draft);renderReview(draft);toast('Rascunho gerado por solicitação. Confira destinatário, mensagem e evidências.');repaint();}finally{M.generating.delete(issueId);}
  }
  async function historyView(issueId){
    const response=await request(`/api/mail/issues/${enc(issueId)}/history`);
    const history=Array.isArray(response)?response:array(response.history||response.events||response.audit||response.entries);const drafts=array(response.drafts);
    const html=`${drafts.length?`<div class="mail-history-drafts">${drafts.map(d=>`<div>${statusBadge(d)}<span>Versão ${escapeHtml(d.version)} · ${escapeHtml(d.subject||'Mensagem')}</span>${button('Abrir registro','mail-open',{id:d.id,class:'small'})}</div>`).join('')}</div>`:''}${history.length?`<ol class="mail-history-list">${history.map(event=>`<li><div><strong>${escapeHtml(historyLabel(event.type||event.action))}</strong><span>${dateTime(event.at||event.created_at)}</span></div><p>${escapeHtml(event.actor||event.declared_actor||'Sistema')}${event.google_account?' · Conta Google: '+escapeHtml(senderEmail(event.google_account)||event.google_account):''}${event.version?' · Versão '+escapeHtml(event.version):''}</p>${event.status?statusBadge(event):''}${event.provider_message_id?`<p class="monospace">Referência do provedor: ${escapeHtml(event.provider_message_id)}</p>`:''}</li>`).join('')}</ol>`:empty('Nenhum evento retornado','Novos registros de geração, revisão e envio serão associados a esta pendência.')}`;
    if(M.review?.issue_id===issueId&&$('#dialog').open&&$('#mail-review-history'))$('#mail-review-history').innerHTML=html;else openDialog('Histórico das comunicações',`<p class="monospace">${escapeHtml(issueId)}</p>${html}`,null,true);
  }
  function historyLabel(type){return ({draft_created:'Rascunho gerado',created:'Rascunho gerado',draft_saved:'Revisão salva',saved:'Revisão salva',evidence_refreshed:'Evidências atualizadas',approved:'Versão aprovada',send_approved:'Versão aprovada para envio',send_sent:'Aceitação registrada pelo provedor',send_uncertain:'Resultado do envio incerto',recovered_uncertain:'Envio interrompido recuperado com resultado incerto',send_started:'Envio iniciado',sent:'Aceitação registrada pelo provedor',send_failed:'Falha conhecida no envio',failed:'Falha conhecida no envio',uncertain:'Resultado incerto',sending:'Envio em andamento',approval:'Aprovação registrada'})[type]||readable(type);}
  async function refreshEvidence(id){
    if(M.busy.has(id))return;
    const draft=M.review;if(!draft||draft.id!==id)throw new Error('Reabra o rascunho para atualizar as evidências.');
    const form=$('#mail-review-form');const data=new FormData(form);const counterparty=data.get('counterparty'),reason=data.get('counterparty_reason');
    if(!draft.counterparty&&(!counterparty||!String(reason||'').trim()))throw new Error('Confirme a contraparte e registre a justificativa antes de atualizar as evidências.');
    M.busy.add(id);setReviewBusy(true);
    try{const updated=normalizeDraft(await request(`/api/mail/drafts/${enc(id)}`,{method:'PUT',body:{version:draft.version,refresh_evidence:true,...(counterparty?{counterparty,counterparty_reason:reason}:{})}}));updateOpenReview(updated);toast('Modelo e evidências atualizados. Revise a nova versão antes de aprovar.');}finally{M.busy.delete(id);setReviewBusy(false);}
  }
  function setReviewBusy(busy){const form=$('#mail-review-form');if(!form)return;for(const control of form.querySelectorAll('button,input,textarea,select'))control.disabled=busy;const permission=form.querySelector('[name="permission"]');if(busy&&permission)permission.checked=false;if(!busy)syncReviewApproval();}
  function reviewError(message){const node=$('.form-error',$('#mail-review-form')||$('#dialog'));if(node){node.textContent=message;node.scrollIntoView({block:'nearest'});}else toast(message,true);}
  async function saveOrSend(form,intent){
    const id=form.dataset.draftId;if(M.busy.has(id))return;
    const original=M.review;if(!original||original.id!==id)throw new Error('Reabra o rascunho antes de continuar.');
    actor();const values=new FormData(form);const body={version:original.version,to:String(values.get('to')||'').trim(),subject:String(values.get('subject')||''),body:String(values.get('body')||'')};
    if(intent==='approve'&&(!body.to||values.get('permission')!=='true'||!matchesSavedFields(form,original)||!canApprove(original)))throw new Error('Salve as alterações, confira a versão retornada e marque a permissão antes de enviar.');
    if(values.get('counterparty')){body.counterparty=values.get('counterparty');body.counterparty_reason=values.get('counterparty_reason');}
    M.busy.add(id);setReviewBusy(true);reviewError('');
    let approveAttempted=false;
    try{
      await refreshAccount();
      if(intent==='approve'&&(!M.account.connected||!M.account.authorized))throw new Error('Autorize esta sessão pela conta Google antes de aprovar. Salvar o nome do analista não autoriza o envio.');
      if(intent!=='approve'){const saved=normalizeDraft(await request(`/api/mail/drafts/${enc(id)}`,{method:'PUT',body}));updateOpenReview(saved);toast('Versão salva. Confira o conteúdo e os anexos antes de dar permissão. Nenhuma mensagem foi enviada.');return;}
      const saved=normalizeDraft(await request(`/api/mail/drafts/${enc(id)}`));
      if(saved.version!==original.version||saved.content_hash!==original.content_hash||immutableSnapshot(saved)!==immutableSnapshot(original)||saved.to!==body.to||saved.subject!==body.subject||saved.body!==body.body||!canApprove(saved,true)){updateOpenReview(saved);reviewError('A versão, o remetente ou as evidências mudaram, ou há bloqueios. Confira esta versão atualizada antes de dar outra permissão. Nenhum envio foi iniciado.');return;}
      approveAttempted=true;
      const result=normalizeDraft(await request(`/api/mail/drafts/${enc(id)}/approve-send`,{method:'POST',body:{version:original.version,content_hash:original.content_hash,permission:true}}));updateOpenReview(result);M.pollAttempts=0;startReadOnlyPolling();
      toast(result.status==='sent'?(testProvider(result)?'Provedor de teste aceitou a mensagem. Nenhum envio real.':'Gmail aceitou a mensagem. Entrega e leitura não foram confirmadas.'):'Tentativa registrada. Confira o estado do envio.');
    }catch(error){
      if(approveAttempted){
        try{const current=normalizeDraft(await request(`/api/mail/drafts/${enc(id)}`));updateOpenReview(current);if(['sending','sent','uncertain','failed'].includes(current.status)){M.pollAttempts=0;startReadOnlyPolling();reviewError(error.message);return;}}catch(_){M.connectionUnknown=true;updateOpenReview({...original,status:'uncertain',local_status_unconfirmed:true});}
      }
      reviewError(error.message);throw error;
    }finally{M.busy.delete(id);setReviewBusy(false);repaint();}
  }
  async function connect(){
    if(M.busy.has('oauth'))return;M.busy.add('oauth');repaint();
    try{await refreshAccount();const result=await request('/api/mail/oauth/start',{method:'POST',body:{},declaredActor:false});if(!result.authorization_url)throw new Error('O servidor não retornou a URL de autorização.');const url=new URL(result.authorization_url,location.origin);if(!['https:','http:'].includes(url.protocol))throw new Error('URL de autorização inválida.');window.location.assign(url.href);}finally{M.busy.delete('oauth');repaint();}
  }
  function disconnect(){
    openDialog('Desconectar conta Google',`<form id="mail-disconnect-form"><p class="form-note">Desconectar ${escapeHtml(M.account?.email||'a conta')} impede novos envios por esta conexão. Os rascunhos e registros anteriores permanecem na plataforma.</p><div class="form-error" role="alert"></div><div class="form-actions">${button('Cancelar','close-dialog')}<button class="button danger" type="submit">Desconectar conta</button></div></form>`,null);
  }
  async function action(name,id){
    if(name==='mail-issues'){location.hash='issues';return;}
    if(name==='mail-refresh'){M.connectionUnknown=false;M.pollAttempts=0;return load(true);}
    if(name==='mail-view'){M.view=id;return repaint();}
    if(name==='mail-generate')return generate(id);
    if(name==='mail-open')return openReview(id);
    if(name==='mail-history')return historyView(id);
    if(name==='mail-edit-contact'){if(!M.loaded)await load();return contactDialog(id);}
    if(name==='mail-refresh-evidence')return refreshEvidence(id);
    if(name==='mail-connect')return connect();
    if(name==='mail-disconnect')return disconnect();
  }
  document.addEventListener('submit',async event=>{
    if(event.target.id==='mail-review-form'){
      event.preventDefault();try{await saveOrSend(event.target,event.submitter?.value||'save');}catch(error){reviewError(error.message);}return;
    }
    if(event.target.id==='mail-disconnect-form'){
      event.preventDefault();const submit=$('[type="submit"]',event.target);if(submit.disabled)return;submit.disabled=true;
      try{await refreshAccount();const result=await request('/api/mail/disconnect',{method:'POST',body:{},declaredActor:false});M.disconnectNotice=result.revocation_confirmed===false?'A conexão foi removida deste aplicativo, mas a revogação no Google não foi confirmada. Confira as permissões da conta Google para remover o acesso, se necessário.':'';await load(true);$('#dialog').close();toast(M.disconnectNotice||'Conta desconectada. Os registros anteriores foram preservados.');}catch(error){$('.form-error',event.target).textContent=error.message;}finally{submit.disabled=false;}
    }
  });
  document.addEventListener('input',event=>{if(event.target.closest?.('#mail-review-form'))syncReviewApproval(event.target.name!=='permission');if(event.target.id!=='mail-search')return;M.search=event.target.value;const position=event.target.selectionStart;repaint();const input=$('#mail-search');input.focus();input.setSelectionRange(position,position);});
  document.addEventListener('change',event=>{if(event.target.closest?.('#mail-review-form'))syncReviewApproval(event.target.name!=='permission');if(event.target.id==='mail-status-filter'){M.filter=event.target.value;repaint();}});
  window.addEventListener('beforeunload',()=>clearTimeout(M.pollTimer));
  return {renderPage,action,request};
})();
if(state&&activePage==='mail')render();
