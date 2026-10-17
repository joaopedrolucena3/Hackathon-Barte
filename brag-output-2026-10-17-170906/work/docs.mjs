// Writes brag-plan.md from script.json, timings.json and the generated storyboard.
import { readFileSync, writeFileSync } from 'node:fs';

const W = new URL('./', import.meta.url);
const s = JSON.parse(readFileSync(new URL('script.json', W), 'utf8'));
const t = JSON.parse(readFileSync(new URL('timings.json', W), 'utf8'));
const sb = readFileSync(new URL('storyboard.md', W), 'utf8');
const vo = s.scenes.map(x => `**${x.id}** ${x.lines.map(l => l[1]).join(' ')}`).join('\n\n');

writeFileSync(new URL('../brag-plan.md', W), `# Tarvo · vídeo demonstrativo (120 s, narrado)

## Respostas do planejamento
- **O que é:** plataforma de fechamento mensal da Tarvo. Lê as fontes nos formatos conhecidos, calcula por regras fixas, aponta exceções com origem e para antes do ERP até o financeiro decidir.
- **Para quem:** time financeiro e CFO da Tarvo.
- **Tese:** cada valor do fechamento precisa estar ligado ao contrato certo, à competência certa e à evidência que permite aprová-lo.
- **Gancho:** R$ 15.397,42 de divergências da Casa do Estudante; a isenção não chegou à Orbe.
- **Tom:** \`polished\`, uma conversa com o financeiro, sem jargão de tecnologia.
- **Formato:** 1920×1080, 30 fps, ${t.total.toFixed(1)} s. O pedido mudou de 6 min para 120 s durante a produção.
- **Voz:** Kokoro \`pf_dora\`, pt-BR, velocidade natural (1,0), gerada frase a frase. As siglas MDR, ERP e IA foram escritas foneticamente para a voz.
- **Música:** happy-beats-business-moves-vol-12 (ende.app), em loop com crossfade, volume 0,11 sob a voz. O ritmo segue a narração, então as pistas de batida não guiaram os cortes. Não há tratamento reativo ao áudio (vídeo narrado e sóbrio).

## Cobertura dos sete pontos exigidos
| Ponto | Cenas |
|---|---|
| 1. O que está quebrado e a causa | s01–s03 (Casa do Estudante; acordo que não chegou à cobrança; fontes separadas) |
| 2. O que a solução faz | s04, s07–s10 |
| 3. Dinheiro em jogo | s01 (R$ 15.397,42), s05 (R$ 246.588,68 e R$ 22.173,57, sem somar), s06 (R$ 1.039,37 pela competência) |
| 4. Uso em outubro | s07–s10 (cenário de teste: rodar, Vela, decisão, bloqueio, comunicação) |
| 5. Onde a IA atua e onde não | s11 |
| 6. Onde falha e o que acontece | s08 (contrato ambíguo), s09 (bloqueio), s12 (Atlas; Fênix sem homologação; sem NFS-e nem pagamentos) |
| 7. Mais um mês | s13 |

## Storyboard
${sb}
## Roteiro final da narração (grafia das legendas)
${vo}

## Ficou fora da versão de 120 s
Estes trechos estão no roteiro de 6 minutos preservado em \`work/script-6min.json\` e \`work/scenes-6min.mjs\`: devolução bancária de R$ 12.400,00; detalhe das entradas de outubro (linha ilegível, duplicada e conflitantes); complemento gerando nova execução; mudança de taxa da EduAbroad; e-mail com resultado incerto.
`);
console.log('ok');
