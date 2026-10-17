// Scene spec: one entry per narration scene (same ids as script.json / timings.json).
// Coordinates in `shot` scenes are pixels of the 1920×1080 capture; cams are [t, fx, fy, scale] relative to the scene.
// `src` documents where the facts on screen come from; `state` the product state shown.

const SET = 'Base sintética — setembro/2026';
const OUT = 'Cenário de teste — outubro/2026';

export const scenes = {
  s01: { badge: SET, title: 'A isenção não chegou à cobrança', kind: 'html', html: `
    <div class="hero">
      <div class="hero-k">Casa do Estudante · divergências líquidas</div>
      <div class="hero-v" data-at="0.5">R$ 15.397,42</div>
      <div class="hero-s" data-at="4.0">118 operações em setembro · sujeitas a contestação/devolução</div>
      <div class="hero-q" data-at="10.0">A Casa tinha isenção. <span class="acc">A cobrança continuou.</span></div>
    </div>`,
    src: 'ENGINE_NOTES.md (controles do pack de setembro); s8/divergencias da execução 61dbabc4 (118 op., R$ 15.397,42)', state: 'Cartão de abertura (sem tela do produto)' },

  s02: { badge: SET, title: 'Uma venda mostra a falha', kind: 'shot', img: 'sep_tx_a',
    cams: [[0, 960, 560, 1.0], [1.2, 870, 790, 1.6], [5.0, 870, 790, 1.6], [6.0, 1386, 760, 1.8], [10.4, 1386, 760, 1.8], [11.2, 1100, 790, 1.7]],
    boxes: [{ x: 372, y: 798, w: 998, h: 54, t0: 1.3, t1: 5.2 }, { x: 1400, y: 734, w: 372, h: 58, t0: 6.2, t1: 10.5, dim: 0 }, { x: 1190, y: 806, w: 80, h: 38, t0: 11.3, t1: 15.4 }],
    src: 'Revisão da execução 61dbabc4 (pack-base 09/2026): TX88410932, bruto R$ 608,88, aplicada 2,69%, contratada 0%, R$ 16,38', state: 'Revisão real, exceção aberta' },

  s03: { badge: SET + ' · esquema', title: 'O erro está entre o acordo e a cobrança', kind: 'html', html: `
    <div class="chain">
      <div class="node" data-at="0.4"><div class="nk">Planilha de taxas</div><div class="nv">Casa do Estudante</div><div class="nd">MDR e antecipação 0%<br>vigência 01/09 a 31/12/2026</div></div>
      <div class="arrow" data-at="1.6">→</div>
      <div class="node bad" data-at="2.2"><div class="nk">Relatório Orbe</div><div class="nv">TX88410932 · 01/09/2026</div><div class="nd">taxa aplicada 2,69%</div></div>
      <div class="arrow" data-at="3.4">→</div>
      <div class="node ok" data-at="4.0"><div class="nk">Conferência</div><div class="nv">Diferença R$ 16,38</div><div class="nd">contrato × vigência × operação</div></div>
    </div>`,
    src: 'ENGINE_NOTES.md regra 4; registro da divergência (vigência 2026-09-01 a 2026-12-31)', state: 'Esquema ilustrativo com dados da execução' },

  s04: { badge: 'Esquema', title: 'Fontes separadas precisam ser ligadas', kind: 'html', html: `
    <div class="sources">
      <div class="src" data-at="0.6"><b>Orbe</b><span>01_orbe_relatorio_comissoes_set2026.csv</span></div>
      <div class="src" data-at="1.4"><b>Contratos e taxas</b><span>02_tabela_taxas_contratadas.xlsx</span></div>
      <div class="src" data-at="2.2"><b>Ponte Câmbio · e-mail</b><span>03_email_ponte_cambio_relatorio_set2026.eml</span></div>
      <div class="src" data-at="3.0"><b>Extratos Aurora e Meridiano</b><span>05a_…aurora….csv · 05b_…meridiano….ofx</span></div>
      <div class="src" data-at="3.8"><b>Plano de contas Fênix</b><span>04_plano_de_contas_fenix_erp.csv</span></div>
    </div>
    <div class="chips">
      <span data-at="8.9">Estornos</span><span data-at="9.6">Duplicidades</span><span data-at="10.3">Contratada num mês, liquidada no outro</span>
      <span data-at="11.6">Cadastro sem contrato</span><span data-at="12.6">Entrada no banco ≠ receita</span>
    </div>`,
    src: 'Arquivos do data pack; instruções do case', state: 'Esquema' },

  s05: { badge: SET, title: 'O fechamento vira uma sequência acompanhável', kind: 'clip', video: 'sep_run', vlen: 9.1, voff: 0.2,
    cams: [[0, 1000, 470, 1.12], [11.6, 930, 560, 1.22]],
    src: 'Execução real do pack-base 09/2026 (captura de 17/10, mesmos totais)', state: 'Passos rodando até "Aprovação humana"' },

  s06: { badge: SET, title: 'Faturamento e divergências são medidas distintas', kind: 'html', html: `
    <div class="nums">
      <div class="num" data-at="4.3"><div class="v">R$ 246.588,68</div><div class="l">Faturamento proposto</div>
        <div class="d">21 notas a preparar, sujeitas à revisão</div>
        <div class="split"><span>20 de checkout · R$ 207.045,23</span><span>1 para a Ponte · R$ 39.543,45</span></div></div>
      <div class="num" data-at="11.7"><div class="v">R$ 22.173,57</div><div class="l">237 divergências de taxa</div>
        <div class="d">soma dos valores absolutos · não é perda</div>
        <div class="split"><span>inclui a Casa do Estudante · R$ 15.397,42</span></div></div>
    </div>
    <div class="foot" data-at="0.3">Medidas diferentes · não se somam</div>`,
    src: 'ENGINE_NOTES.md (controles); s8/notas e s8/divergencias da execução 61dbabc4', state: 'Cartão de números' },

  s07: { badge: SET, title: 'Cada valor mostra origem, regra e quem decide', kind: 'shot', img: 'sep_tx_b',
    cams: [[0, 1209, 600, 1.35], [4.2, 1209, 600, 1.35], [5.0, 1209, 420, 1.35]],
    boxes: [{ x: 1400, y: 692, w: 372, h: 160, t0: 0.4, t1: 4.4 }, { x: 1400, y: 288, w: 372, h: 48, t0: 2.2, t1: 4.4, dim: 0 }, { x: 1588, y: 138, w: 184, h: 46, t0: 5.4, t1: 8.8 }],
    src: 'Revisão da execução 61dbabc4: linha de origem, regra, quem decide', state: 'Revisão real, exceção aberta' },

  s08: { badge: SET, title: 'Devolução de repasse aguarda confirmação', kind: 'shot', img: 'sep_rev_dev',
    cams: [[0, 1100, 700, 1.0], [1.0, 1150, 700, 1.35]],
    boxes: [{ x: 372, y: 798, w: 998, h: 54, t0: 0.8, t1: 11.6 }, { x: 1400, y: 704, w: 380, h: 84, t0: 5.6, t1: 11.6, dim: 0 }],
    src: 'Revisão da execução 61dbabc4: L65, R$ 12.400,00, Conferir bancos', state: 'Revisão real, alerta aberto' },

  s09: { badge: SET + ' · esquema', title: 'A competência segue a contratação', kind: 'html', html: `
    <div class="tl">
      <div class="tl-line"></div>
      <div class="tl-pt a" data-at="4.4"><div class="d">30/09</div><div class="k">Contratação</div><div class="m">competência de setembro</div></div>
      <div class="tl-pt b" data-at="6.0"><div class="d">01/10</div><div class="k">Liquidação</div><div class="m">não muda a competência</div></div>
      <div class="tl-ops" data-at="7.6">6 remessas · Ponte Câmbio</div>
    </div>`,
    src: 'ENGINE_NOTES.md regra 7; s7/cambio_calculado da execução 61dbabc4', state: 'Esquema' },

  s10: { badge: SET, title: 'R$ 1.039,37 pertencem a setembro', kind: 'shot', img: 'sep_cambio_footer',
    cams: [[0, 1100, 520, 1.0], [1.0, 1152, 560, 1.25]],
    boxes: [{ x: 800, y: 318, w: 270, h: 176, t0: 1.2, t1: 6.0, dim: 0.2 }, { x: 1346, y: 826, w: 330, h: 28, t0: 4.0, t1: 15.6 }],
    src: 'Passo 7 da execução 61dbabc4, filtro Liquidação > 30/09/2026: 6 linhas, Comissão · visão R$ 1.039,37', state: 'Prévia real do passo com filtro aplicado' },

  s11: { badge: OUT, title: 'Cenário de teste — outubro/2026', kind: 'html', html: `
    <div class="card-oct">
      <div class="co-k">Cenário de teste</div>
      <div class="co-t">Outubro/2026</div>
      <div class="co-s" data-at="1.2">Pacote sintético gerado para testar continuidade.<br>Não é um fechamento real da Tarvo.</div>
      <div class="co-n" data-at="7.8">A Orbe já aplica a isenção da Casa neste pacote.</div>
    </div>`,
    src: 'Tarvo_Data_Pack_out2026/00_LEIA-ME.md', state: 'Cartão de transição' },

  s12: { badge: OUT, title: 'Outubro roda com o pacote do mês', kind: 'drawer_run',
    img: 'oct_2_drawer', imgEnd: 2.7, video: 'oct_run', vlen: 6.07, click: [1846, 1045, 2.0],
    cams: [[0, 1180, 734, 1.3]], vcams: [[0, 1000, 470, 1.12], [6.3, 930, 560, 1.22]],
    src: 'Execução c9f2a7d6 (pack sintético 10/2026)', state: 'Gaveta "Rodar fechamento" e passos reais' },

  s13: { badge: OUT, title: 'Problemas de importação ficam visíveis', kind: 'shot', img: 'oct_aud',
    cams: [[0, 900, 450, 1.0], [1.0, 790, 360, 1.6]],
    boxes: [{ x: 388, y: 256, w: 800, h: 30, t0: 5.7, t1: 13.4 }, { x: 388, y: 368, w: 800, h: 30, t0: 8.3, t1: 13.4, dim: 0 }],
    src: 'Auditoria da execução c9f2a7d6: Aurora 88/87/1; Orbe 616/615/1, 1 duplicada, 2 conflitantes', state: 'Auditoria real' },

  s14: { badge: OUT, title: 'Contrato ambíguo exige revisão', kind: 'shot', img: 'oct_rev_vela',
    cams: [[0, 1080, 650, 1.0], [1.0, 1080, 700, 1.35]],
    boxes: [{ x: 372, y: 762, w: 998, h: 92, t0: 0.8, t1: 13.6 }, { x: 1400, y: 726, w: 380, h: 84, t0: 3.0, t1: 13.6, dim: 0 }],
    overlay: { at: 13.8, html: '<div class="note"><div class="nk">Também no pacote de outubro</div><div class="nv">EduAbroad 7–12x passa a 3,29% em 16/10</div><div class="nd">Fonte: LEIA-ME do pacote sintético</div></div>' },
    src: 'Revisão c9f2a7d6: TAXA_SOBREPOSTA Vela (22 op.); LEIA-ME de outubro (EduAbroad)', state: 'Revisão real, bloqueante aberta' },

  s15: { badge: OUT, title: 'A decisão é registrada com justificativa', kind: 'clip', video: 'oct_decide', vlen: 4.4, voff: 0.15,
    cams: [[0, 1209, 600, 1.35]],
    src: 'Decisão real registrada na execução c9f2a7d6 (ambiente isolado)', state: 'Formulário de decisão' },

  s16: { badge: OUT, title: 'Bloqueante aberta impede aprovar', kind: 'shot', img: 'oct_dec_3',
    cams: [[0, 1209, 690, 1.35]],
    boxes: [{ x: 1400, y: 530, w: 372, h: 126, t0: 0.2, t1: 11.3, dim: 0.2 }, { x: 380, y: 894, w: 200, h: 30, t0: 1.0, t1: 11.3, dim: 0 }, { x: 1594, y: 890, w: 182, h: 40, t0: 2.4, t1: 11.3, dim: 0 }],
    src: 'Revisão c9f2a7d6 após a decisão: 63 bloqueantes sem decisão, Aprovar e exportar desabilitado', state: 'Revisão real, lote bloqueado' },

  s17: { badge: OUT, title: 'Comunicação só sai com permissão', kind: 'shot', img: 'com_2',
    cams: [[0, 1258, 460, 1.0], [1.0, 1258, 400, 1.45]],
    boxes: [{ x: 900, y: 176, w: 1000, h: 90, t0: 1.0, t1: 6.6 }, { x: 900, y: 296, w: 1000, h: 112, t0: 6.9, t1: 14.6 }, { x: 900, y: 478, w: 1000, h: 70, t0: 9.6, t1: 14.6, dim: 0 }],
    src: 'Comunicações → sugestão de contestação da execução c9f2a7d6; Gmail não conectado; nada enviado', state: 'Sugestão aguardando permissão' },

  s18: { badge: OUT, title: 'Complemento gera nova execução', kind: 'shot', img: 'oct_compl',
    cams: [[0, 1258, 400, 1.0], [0.8, 1258, 310, 1.45]],
    boxes: [{ x: 1376, y: 36, w: 524, h: 84, t0: 0.6, t1: 5.7 }, { x: 1376, y: 356, w: 524, h: 54, t0: 2.4, t1: 5.7, dim: 0 }],
    src: 'Gaveta "Adicionar complemento" (sem envio de arquivo)', state: 'Gaveta aberta, nada submetido' },

  s19: { badge: SET + ' · pergunta ilustrativa', title: 'A IA consulta; não decide', kind: 'shot', img: 'sep_chat',
    cams: [[0, 1100, 700, 1.0], [1.0, 1182, 734, 1.3]],
    boxes: [{ x: 648, y: 862, w: 1146, h: 46, t0: 15.8, t1: 21.4 }, { x: 648, y: 906, w: 760, h: 24, t0: 9.8, t1: 15.6, dim: 0 }],
    overlay: { at: 3.0, until: 9.6, html: '<div class="ask"><div class="ask-k">Exemplo de pergunta · ilustrativo, sem resposta gerada</div><div class="ask-q">“Quais lojistas concentram as divergências desta execução?”</div></div>' },
    src: 'agent.py / CHAT_API (consulta somente leitura, números resolvidos pelo servidor); tela real com chat indisponível', state: 'Chat indisponível (sem credencial); nenhuma resposta' },

  s20: { badge: null, title: 'IA consulta · Regras calculam · Financeiro decide', kind: 'html', html: `
    <div class="cols">
      <div class="col" data-at="1.2"><div class="ck">IA</div><div class="ct">Ajuda a consultar e explicar</div><div class="cd">Chat de leitura; números vêm de consultas conferidas</div></div>
      <div class="col" data-at="2.6"><div class="ck">Regras financeiras</div><div class="ct">Calculam os valores</div><div class="cd">Fixas e reproduzíveis; sugestões de revisão seguem políticas definidas</div></div>
      <div class="col" data-at="3.8"><div class="ck">Financeiro</div><div class="ct">Decide exceções e aprova</div><div class="cd">Justificativa registrada para cada decisão</div></div>
    </div>
    <div class="nots" data-at="6.9">A IA não inventa contrato · não escolhe taxa · não altera dados · não aprova o fechamento · não executa pagamentos · não autoriza devoluções</div>`,
    src: 'agent.py, HIPOTESES.md, ENGINE_NOTES.md (review-guidance-v1)', state: 'Cartão' },

  s21: { badge: SET, title: 'Contrato ausente exige revisão', kind: 'shot', img: 'sep_rev_atlas',
    cams: [[0, 1080, 650, 1.0], [1.0, 1080, 700, 1.35]],
    boxes: [{ x: 372, y: 798, w: 998, h: 54, t0: 0.8, t1: 14.8 }, { x: 1400, y: 770, w: 380, h: 80, t0: 9.8, t1: 14.8, dim: 0 }],
    src: 'Revisão 61dbabc4: Atlas Idiomas, 57 operações, R$ 7.876,05, Cadastro não confirmado', state: 'Revisão real, bloqueante aberta' },

  s22: { badge: null, title: 'Onde a solução para, a pendência aparece', kind: 'html', html: `
    <div class="tiles">
      <div class="tile" data-at="0.4"><div class="th" style="background-image:url(assets/img/oct_rev_banco.jpg);background-position:-1390px -660px"></div><div class="tt">Descrição bancária nova fica pendente</div><div class="tb">${OUT}</div></div>
      <div class="tile" data-at="3.0"><div class="th" style="background-image:url(assets/img/oct_dec_3.jpg);background-position:-370px -860px"></div><div class="tt">Bloqueante impede aprovar</div><div class="tb">${OUT}</div></div>
      <div class="tile" data-at="5.6"><div class="th txt">Envio incerto → registrado, sem repetição automática</div><div class="tt">E-mail com resultado incerto não é reenviado</div><div class="tb">Comportamento documentado · GMAIL.md</div></div>
    </div>`,
    src: 'Revisão c9f2a7d6 (L15 classificação pendente; barra de bloqueio); GMAIL.md (resultado incerto)', state: 'Recortes de telas reais + cartão' },

  s23: { badge: null, title: 'O que a solução ainda não faz', kind: 'html', html: `
    <div class="limits">
      <div data-at="2.5">Lê apenas os formatos conhecidos</div>
      <div data-at="4.0">Arquivo para o Fênix ainda sem homologação</div>
      <div data-at="5.6">Não emite NFS-e · não executa pagamentos</div>
      <div data-at="7.4">Não concilia parcelas da adquirente com repasses agregados</div>
      <div data-at="11.9">E-mail real implementado; depende de conta conectada · entrega externa não comprovada</div>
      <div data-at="14.5">Ambiente local, sem autenticação corporativa</div>
    </div>`,
    src: 'demo/README.md, GMAIL.md, TESTES_EMAIL.md, HIPOTESES.md', state: 'Cartão' },

  s24: { badge: null, title: 'Mais um mês: três prioridades verificáveis', kind: 'html', html: `
    <div class="prio">
      <div class="p" data-at="0.4"><div class="pn">1</div><div class="pt">Piloto acompanhado pelo financeiro</div><div class="pr">Resultado: tempo de revisão, retrabalho e exceções bem tratadas, medidos</div></div>
      <div class="p" data-at="7.6"><div class="pn">2</div><div class="pt">Homologar a saída com o Fênix</div><div class="pr">Resultado: arquivo aceito pelo ERP; faturamento e comunicação validados</div></div>
      <div class="p" data-at="10.2"><div class="pn">3</div><div class="pt">Uso em equipe</div><div class="pr">Resultado: acessos, quem prepara ≠ quem aprova, pendências acompanhadas</div></div>
    </div>`,
    src: 'Plano proposto (futuro)', state: 'Cartão' },

  s25: { badge: null, title: 'Próximo passo: um ciclo acompanhado', kind: 'html', html: `
    <div class="close">
      <div class="cl-p" data-at="0.4">Rodar o próximo fechamento junto com a rotina atual e comparar, item por item, notas, divergências e pendências.</div>
      <div class="cl-t" data-at="8.8">Cada valor ligado ao <span class="acc">contrato certo</span>, à <span class="acc">competência certa</span> e à <span class="acc">evidência</span> que permite aprová-lo.</div>
      <div class="brand" data-at="13.0"><span class="brand-mark">t</span>tarvo<span class="brand-dot">.</span><span class="motto">cada número tem uma origem</span></div>
    </div>`,
    src: 'Proposta do time; frase central do pitch', state: 'Encerramento' },
};
