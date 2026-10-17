// Scene spec for the 120 s cut: one entry per narration scene (ids match script.json / timings.json).
// `shot` coordinates are pixels of the 1920×1080 capture; cams are [t, fx, fy, scale] relative to the scene start.
// `src` documents where the facts on screen come from; `state` the product state shown.

const SET = 'Base sintética — setembro/2026';
const OUT = 'Cenário de teste — outubro/2026';

export const scenes = {
  s01: { badge: SET, title: 'A isenção não chegou à cobrança', kind: 'html', html: `
    <div class="hero">
      <div class="hero-k">Casa do Estudante · divergências líquidas</div>
      <div class="hero-v" data-at="0.4">R$ 15.397,42</div>
      <div class="hero-s" data-at="1.6">118 operações em setembro · sujeitas a contestação/devolução</div>
      <div class="hero-q" data-at="3.8">A Casa tinha isenção. <span class="acc">A cobrança continuou.</span></div>
    </div>`,
    src: 'ENGINE_NOTES.md (controles do pack de setembro); s8/divergencias da execução 61dbabc4 (118 op., R$ 15.397,42)', state: 'Cartão de abertura' },

  s02: { badge: SET, title: 'Uma venda mostra a falha: 0% contratado, 2,69% aplicado', kind: 'shot', img: 'sep_tx_a',
    cams: [[0, 960, 560, 1.0], [0.9, 870, 790, 1.6], [3.6, 870, 790, 1.6], [4.4, 1386, 760, 1.8]],
    boxes: [{ x: 372, y: 798, w: 998, h: 54, t0: 0.9, t1: 4.0 }, { x: 1190, y: 806, w: 80, h: 38, t0: 2.4, t1: 4.0, dim: 0 }, { x: 1400, y: 734, w: 372, h: 58, t0: 4.6, t1: 10.8, dim: 0 }],
    src: 'Revisão da execução 61dbabc4 (pack-base 09/2026): TX88410932, bruto R$ 608,88, aplicada 2,69%, contratada 0%, diferença R$ 16,38', state: 'Revisão real, exceção aberta' },

  s03: { badge: 'Esquema', title: 'Contrato, vigência e operação estão em fontes separadas', kind: 'html', html: `
    <div class="sources">
      <div class="src" data-at="2.6"><b>Orbe</b><span>01_orbe_relatorio_comissoes_set2026.csv</span></div>
      <div class="src" data-at="3.6"><b>Contratos e taxas</b><span>02_tabela_taxas_contratadas.xlsx</span></div>
      <div class="src" data-at="4.6"><b>Ponte Câmbio · e-mail</b><span>03_email_ponte_cambio_relatorio_set2026.eml</span></div>
      <div class="src" data-at="5.6"><b>Extratos Aurora e Meridiano</b><span>05a_…aurora….csv · 05b_…meridiano….ofx</span></div>
      <div class="src" data-at="6.8"><b>Plano de contas Fênix</b><span>04_plano_de_contas_fenix_erp.csv</span></div>
    </div>`,
    src: 'Arquivos do data pack de setembro', state: 'Esquema' },

  s04: { badge: SET, title: 'Regras calculam; a execução para antes do ERP', kind: 'clip', video: 'sep_run', vlen: 7.2, voff: 0.1,
    cams: [[0, 1000, 470, 1.12], [7.6, 930, 560, 1.22]],
    src: 'Execução real do pack-base 09/2026 (mesmos totais)', state: 'Passos rodando até "Aprovação humana"' },

  s05: { badge: SET, title: 'Faturamento e divergências são medidas distintas', kind: 'html', html: `
    <div class="nums">
      <div class="num" data-at="0.3"><div class="v">R$ 246.588,68</div><div class="l">Faturamento proposto</div>
        <div class="d">21 notas a preparar, sujeitas à revisão</div>
        <div class="split"><span>20 de checkout · R$ 207.045,23</span><span>1 para a Ponte · R$ 39.543,45</span></div></div>
      <div class="num" data-at="6.5"><div class="v">R$ 22.173,57</div><div class="l">237 divergências de taxa</div>
        <div class="d">soma dos valores absolutos · não é perda</div>
        <div class="split"><span>inclui a Casa do Estudante · R$ 15.397,42</span></div></div>
    </div>
    <div class="foot" data-at="8.5">Medidas diferentes · não se somam</div>`,
    src: 'ENGINE_NOTES.md (controles); s8/notas e s8/divergencias da execução 61dbabc4', state: 'Cartão de números' },

  s06: { badge: SET, title: 'Competência pela contratação: R$ 1.039,37 ficam em setembro', kind: 'shot', img: 'sep_cambio_footer',
    cams: [[0, 1100, 520, 1.0], [0.8, 1152, 560, 1.25]],
    boxes: [{ x: 800, y: 318, w: 270, h: 176, t0: 0.9, t1: 8.8, dim: 0.2 }, { x: 1276, y: 826, w: 256, h: 28, t0: 4.6, t1: 8.8, dim: 0 }],
    src: 'Passo 7 da execução 61dbabc4, filtro Liquidação > 30/09/2026: 6 linhas, Comissão · visão R$ 1.039,37', state: 'Prévia real do passo com filtro' },

  s07: { badge: OUT, title: 'Outubro roda com o pacote do mês', kind: 'drawer_run',
    img: 'oct_2_drawer', imgEnd: 2.0, video: 'oct_run', vlen: 4.5, click: [1846, 1045, 1.4],
    cams: [[0, 1182, 734, 1.3]], vcams: [[0, 1000, 470, 1.12], [4.5, 930, 560, 1.22]],
    src: 'Execução c9f2a7d6 (pack sintético 10/2026, gerado para testar continuidade)', state: 'Gaveta "Rodar fechamento" e passos reais' },

  s08: { badge: OUT, title: 'Contrato ambíguo exige revisão', kind: 'shot', img: 'oct_rev_vela',
    cams: [[0, 1080, 650, 1.0], [0.8, 1080, 700, 1.35]],
    boxes: [{ x: 372, y: 762, w: 998, h: 92, t0: 0.6, t1: 9.1 }, { x: 1400, y: 726, w: 380, h: 84, t0: 3.0, t1: 9.1, dim: 0 }],
    src: 'Revisão c9f2a7d6: vigências de taxa sobrepostas da Vela (22 operações, quem decide: Comercial)', state: 'Revisão real, bloqueante aberta' },

  s09: { badge: OUT, title: 'Bloqueante aberta impede aprovar', kind: 'clip_then_shot', video: 'oct_decide', vlen: 3.4, voff: 0.1, img: 'oct_dec_3', imgAt: 3.6,
    cams: [[0, 1209, 600, 1.35]], scams: [[0, 1120, 705, 1.2]],
    boxes: [{ x: 1400, y: 530, w: 372, h: 126, t0: 3.8, t1: 7.9, dim: 0.2 }, { x: 380, y: 894, w: 200, h: 30, t0: 4.6, t1: 7.9, dim: 0 }, { x: 1594, y: 890, w: 182, h: 40, t0: 5.2, t1: 7.9, dim: 0 }],
    src: 'Decisão real registrada na execução c9f2a7d6 (ambiente isolado); 63 bloqueantes sem decisão', state: 'Formulário de decisão → lote bloqueado' },

  s10: { badge: OUT, title: 'Comunicação só sai com permissão', kind: 'shot', img: 'com_2',
    cams: [[0, 1258, 460, 1.0], [0.6, 1258, 400, 1.45]],
    boxes: [{ x: 900, y: 296, w: 1000, h: 112, t0: 0.8, t1: 5.7 }, { x: 900, y: 478, w: 1000, h: 70, t0: 2.6, t1: 5.7, dim: 0 }],
    src: 'Comunicações → sugestão de contestação da execução c9f2a7d6; Gmail não conectado; nada enviado', state: 'Sugestão aguardando permissão' },

  s11: { badge: SET, title: 'IA consulta · Regras calculam · Financeiro decide', kind: 'shot', img: 'sep_chat',
    cams: [[0, 1100, 700, 1.0], [0.6, 1182, 734, 1.3]],
    boxes: [{ x: 648, y: 862, w: 1146, h: 46, t0: 7.2, t1: 10.3 }],
    overlay: { at: 0.6, until: 7.0, html: '<div class="cols mini"><div class="col"><div class="ck">IA</div><div class="ct">Ajuda a consultar</div><div class="cd">Chat só de leitura; números vêm de consultas conferidas</div></div><div class="col"><div class="ck">Regras</div><div class="ct">Calculam os valores</div><div class="cd">Fixas e reproduzíveis</div></div><div class="col"><div class="ck">Financeiro</div><div class="ct">Decide e aprova</div><div class="cd">Com justificativa registrada</div></div></div><div class="nots mini">A IA não inventa contrato, não escolhe taxa, não altera dados, não aprova, não paga.</div>' },
    src: 'agent.py (consulta somente leitura, números resolvidos pelo servidor); tela real com chat indisponível', state: 'Chat indisponível (sem credencial); nenhuma resposta mostrada' },

  s12: { badge: SET, title: 'Contrato ausente exige revisão', kind: 'shot', img: 'sep_rev_atlas',
    cams: [[0, 1080, 650, 1.0], [0.8, 1080, 700, 1.35]],
    boxes: [{ x: 372, y: 798, w: 998, h: 54, t0: 0.6, t1: 6.3 }, { x: 1400, y: 770, w: 380, h: 80, t0: 2.6, t1: 6.3, dim: 0 }],
    overlay: { at: 6.5, html: '<div class="limits mini"><div>Saída do Fênix ainda sem homologação</div><div>Não emite NFS-e · não executa pagamentos</div><div>Apenas formatos conhecidos · ambiente local</div></div>' },
    src: 'Revisão 61dbabc4: Atlas Idiomas, 57 operações, R$ 7.876,05; limites em demo/README.md e HIPOTESES.md', state: 'Revisão real, bloqueante aberta + cartão de limites' },

  s13: { badge: null, title: 'Próximo passo: um ciclo acompanhado', kind: 'html', html: `
    <div class="close">
      <div class="prio-row" data-at="0.3"><span>1 · Piloto acompanhado pelo financeiro</span><span>2 · Homologação com o Fênix</span><span>3 · Uso em equipe</span></div>
      <div class="cl-p" data-at="5.0">Rodar o próximo fechamento junto com a rotina atual e comparar, item por item, notas, divergências e pendências.</div>
      <div class="cl-t" data-at="7.4">Cada valor ligado ao <span class="acc">contrato certo</span>, à <span class="acc">competência certa</span> e à <span class="acc">evidência</span> que permite aprová-lo.</div>
      <div class="brand" data-at="9.2"><span class="brand-mark">t</span>tarvo<span class="brand-dot">.</span><span class="motto">cada número tem uma origem</span></div>
    </div>`,
    src: 'Plano proposto (futuro); frase central do pitch', state: 'Encerramento' },
};
