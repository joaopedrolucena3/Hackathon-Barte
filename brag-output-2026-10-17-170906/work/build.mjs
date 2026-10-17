// Builds composition/index.html, captions (SRT) and the storyboard table from
// timings.json (narration) + scenes.mjs (visuals). Run: node work/build.mjs
import { readFileSync, writeFileSync } from 'node:fs';
import { scenes } from './scenes.mjs';

const W = new URL('./', import.meta.url);
const T = JSON.parse(readFileSync(new URL('timings.json', W), 'utf8'));
const S = JSON.parse(readFileSync(new URL('script.json', W), 'utf8'));
const TOTAL = Math.ceil(T.total * 10) / 10;
const STAGE_H = 900;
const MUSIC = 'assets/music/happy-beats-business-moves-vol-12-by-ende-dot-app.mp3';
const MUSIC_LEN = 117.36;

const r = n => Math.round(n * 1000) / 1000;
const esc = s => s.replace(/&/g, '&amp;').replace(/</g, '&lt;');

// Camera: keep the capture covering the 1920×900 stage.
function camXY([, fx, fy, s]) {
  const hx = 960 / s, hy = STAGE_H / 2 / s;
  fx = Math.min(Math.max(fx, hx), 1920 - hx);
  fy = Math.min(Math.max(fy, hy), 1080 - hy);
  return { x: r(960 - fx * s), y: r(STAGE_H / 2 - fy * s), scale: s };
}

// Caption chunks: split long sentences at punctuation so each chunk fits two lines.
function chunks(line) {
  const text = line.text, max = 92;
  const parts = [];
  let cur = '';
  for (const piece of text.split(/(?<=[.:;?!])\s+|(?<=,)\s+/)) {
    if ((cur + ' ' + piece).trim().length > max && cur) { parts.push(cur.trim()); cur = piece; }
    else cur = (cur + ' ' + piece).trim();
  }
  if (cur) parts.push(cur);
  const total = parts.reduce((a, p) => a + p.length, 0);
  let t = line.start;
  return parts.map(p => { const d = (line.end - line.start) * p.length / total; const c = { start: t, end: t + d, text: p }; t += d; return c; });
}

let html = '', under = '', js = '', audio = '', caps = [], board = [];
const vwrap = (id, vid, start, dur, src) => `
  <div class="vstage"><div class="cam" id="${id}"><video class="clip vid" id="${vid}" data-start="${start}" data-duration="${dur}" data-track-index="4" muted playsinline src="assets/clips/${src}.mp4"></video></div></div>`;
let chapter = '';
T.scenes.forEach((sc, i) => {
  const spec = scenes[sc.id];
  const st = r(sc.start), du = r(sc.duration);
  const sid = `sc-${sc.id}`;
  if (sc.chapter) chapter = sc.chapter;
  let body = '';
  if (spec.kind === 'html') body = `<div class="card-stage">${spec.html}</div>`;
  const camLayer = (id, img, boxes = []) => `<div class="cam" id="${id}"><img class="shot" src="assets/img/${img}.jpg" alt="">${boxes.map((b, k) => `<div class="hl" id="${id}-b${k}" style="left:${b.x}px;top:${b.y}px;width:${b.w}px;height:${b.h}px;--dim:${b.dim ?? 0.28}"></div>`).join('')}</div>`;
  if (spec.kind === 'shot') body = camLayer(`${sid}-cam`, spec.img, spec.boxes);
  if (spec.kind === 'clip' || spec.kind === 'clip_then_shot') {
    const vEnd = spec.kind === 'clip' ? du : spec.imgAt;
    under += vwrap(`${sid}-vcam`, `${sid}-video`, r(st + spec.voff), r(Math.min(spec.vlen, vEnd - spec.voff)), spec.video);
    if (spec.kind === 'clip_then_shot') body += `<div class="sublayer" id="${sid}-sl">${camLayer(`${sid}-cam`, spec.img, spec.boxes)}</div>`;
  }
  if (spec.kind === 'drawer_run') {
    under += vwrap(`${sid}-vcam`, `${sid}-video`, r(st + spec.imgEnd), r(Math.min(spec.vlen, du - spec.imgEnd)), spec.video);
    body = `<div class="sublayer" id="${sid}-dl">${camLayer(`${sid}-cam`, spec.img)}</div>`
      
      + `<svg class="cursor" id="${sid}-cur" viewBox="0 0 24 24"><path d="M4 2 L4 20 L9 15.5 L12.5 22 L15.5 20.6 L12.2 14.3 L19 14 Z" fill="#fff" stroke="#14040a" stroke-width="1.4" stroke-linejoin="round"/></svg>`;
  }
  const overlay = spec.overlay ? `<div class="overlay" id="${sid}-ov">${spec.overlay.html}</div>` : '';
  const badge = spec.badge ? `<div class="badge">${esc(spec.badge)}</div>` : '';
  html += `
  <section class="clip scene" id="${sid}" data-start="${st}" data-duration="${du}" data-track-index="1">
    <div class="stage">${body}${overlay}</div>
    <div class="top">${badge}<div class="title">${esc(spec.title)}</div></div>
    <div class="band"><div class="chapter">${esc(chapter)}</div></div>
  </section>`;

  // Scene motion (absolute times on the root timeline).
  js += `\n  // ${sc.id} · ${spec.title}\n`;
  js += `  tl.fromTo('#${sid} .stage', { opacity: 0 }, { opacity: 1, duration: 0.35, ease: 'power2.out' }, ${st});\n`;
  js += `  tl.fromTo('#${sid} .top', { opacity: 0, y: -12 }, { opacity: 1, y: 0, duration: 0.4, ease: 'power2.out' }, ${r(st + 0.15)});\n`;
  js += `  tl.to('#${sid} .stage, #${sid} .top', { opacity: 0, duration: 0.25, ease: 'power1.in' }, ${r(st + du - 0.25)});\n`;
  const cams = (id, list, t0) => {
    js += `  tl.set('#${id}', ${JSON.stringify(camXY(list[0]))}, ${r(t0)});\n`;
    for (let k = 1; k < list.length; k++) {
      const d = Math.max(0.4, Math.min(1.1, list[k][0] - list[k - 1][0]));
      js += `  tl.to('#${id}', { ...${JSON.stringify(camXY(list[k]))}, duration: ${r(d)}, ease: 'power2.inOut' }, ${r(t0 + list[k][0] - d)});\n`;
    }
  };
  if (spec.kind === 'shot') cams(`${sid}-cam`, spec.cams, st);
  if (spec.kind === 'clip') cams(`${sid}-vcam`, spec.cams, st);
  if (spec.kind === 'clip_then_shot') {
    cams(`${sid}-vcam`, spec.cams, st); cams(`${sid}-cam`, spec.scams, st);
    js += `  tl.fromTo('#${sid}-sl', { opacity: 0 }, { opacity: 1, duration: 0.3 }, ${r(st + spec.imgAt)});\n`;
  }
  if (spec.kind === 'drawer_run') {
    cams(`${sid}-cam`, spec.cams, st); cams(`${sid}-vcam`, spec.vcams, st + spec.imgEnd);
    js += `  tl.set('#${sid}-vcam', { opacity: 0 }, ${st});\n  tl.to('#${sid}-vcam', { opacity: 1, duration: 0.25 }, ${r(st + spec.imgEnd)});\n`;
    js += `  tl.to('#${sid}-dl', { opacity: 0, duration: 0.25 }, ${r(st + spec.imgEnd)});\n`;
    const [cx, cy, ct] = spec.click; const c = camXY(spec.cams[0]);
    const sx = r(c.x + cx * c.scale), sy = r(c.y + cy * c.scale);
    js += `  tl.fromTo('#${sid}-cur', { opacity: 0, x: ${sx - 260}, y: ${sy - 180} }, { opacity: 1, x: ${sx - 8}, y: ${sy - 4}, duration: 0.9, ease: 'power2.inOut' }, ${r(st + ct - 0.9)});\n`;
    js += `  tl.to('#${sid}-cur', { scale: 0.85, duration: 0.08, yoyo: true, repeat: 1 }, ${r(st + ct)});\n  tl.to('#${sid}-cur', { opacity: 0, duration: 0.2 }, ${r(st + spec.imgEnd)});\n`;
    audio += `\n  <audio id="sfx-${sc.id}" data-start="${r(st + ct)}" data-duration="0.06" data-track-index="5" data-volume="0.45" src="assets/sfx/mouseclick1.ogg"></audio>`;
  }
  (spec.boxes || []).forEach((b, k) => {
    js += `  tl.fromTo('#${sid}-cam-b${k}', { opacity: 0 }, { opacity: 1, duration: 0.35 }, ${r(st + b.t0)});\n`;
    if (b.t1 < du - 0.3) js += `  tl.to('#${sid}-cam-b${k}', { opacity: 0, duration: 0.3 }, ${r(st + b.t1)});\n`;
  });
  if (spec.overlay) {
    js += `  tl.fromTo('#${sid}-ov', { opacity: 0, y: 16 }, { opacity: 1, y: 0, duration: 0.4, ease: 'power2.out' }, ${r(st + spec.overlay.at)});\n`;
    if (spec.overlay.until) js += `  tl.to('#${sid}-ov', { opacity: 0, duration: 0.3 }, ${r(st + spec.overlay.until)});\n`;
  }
  // data-at reveals inside html cards and overlays
  const ats = [...(spec.html || '').matchAll(/data-at="([\d.]+)"/g)].map(m => m[1]);
  ats.forEach((a, k) => { js += `  tl.fromTo('#${sid} [data-at="${a}"]', { opacity: 0, y: 18 }, { opacity: 1, y: 0, duration: 0.45, ease: 'power2.out' }, ${r(st + +a)});\n`; });
  if (spec.kind === 'html' && ats.length && sc.id === 's05') ats.slice(0, 2).forEach(a => { audio += `\n  <audio id="sfx-${sc.id}-${a.replace('.', '_')}" data-start="${r(st + +a)}" data-duration="0.11" data-track-index="6" data-volume="0.3" src="assets/sfx/drop_001.ogg"></audio>`; });

  // Captions
  for (const line of sc.lines) for (const c of chunks(line)) caps.push(c);
  const say = S.scenes.find(x => x.id === sc.id).lines.map(l => l[1]).join(' ');
  board.push(`| ${sc.id} | ${new Date(st * 1000).toISOString().slice(14, 19)}–${new Date((st + du) * 1000).toISOString().slice(14, 19)} (${du.toFixed(1)} s) | ${say} | ${spec.badge ? spec.badge + ' · ' : ''}${spec.title} | ${spec.kind === 'html' ? 'Cartão animado' : spec.kind === 'shot' ? 'Captura ' + spec.img + ', zoom e destaques' : 'Gravação ' + spec.video + (spec.img ? ' + captura ' + spec.img : '')} | ${spec.src} | ${spec.state} |`);
});

caps.forEach((c, k) => {
  // Hold each caption a beat past its sentence, but never into the next one.
  c.out = Math.min(c.end + 0.15, k + 1 < caps.length ? caps[k + 1].start : Infinity);
  html += `\n  <div class="clip caption" id="cap-${k}" data-start="${r(c.start)}" data-duration="${r(c.out - c.start)}" data-track-index="2"><span>${esc(c.text)}</span></div>`;
});

// Music bed: track looped with overlapping crossfades, under the narration.
const loops = [];
for (let t = 0, k = 0; t < TOTAL; t += MUSIC_LEN - 2, k++) loops.push({ k, t, d: Math.min(MUSIC_LEN, TOTAL - t) });
for (const m of loops) audio += `\n  <audio id="music-${m.k}" data-start="${r(m.t)}" data-duration="${r(m.d)}" data-track-index="${10 + m.k}" data-volume="0.11" data-fade-in="${m.k ? 2 : 1}" data-fade-out="${m.t + m.d >= TOTAL - 0.01 ? 3 : 2}" src="${MUSIC}"></audio>`;
audio += `\n  <audio id="vo" data-start="0" data-duration="${r(T.total)}" data-track-index="3" data-volume="1" src="assets/vo/voiceover.wav"></audio>`;

const css = readFileSync(new URL('style.css', W), 'utf8');
const page = `<!doctype html>
<html lang="pt-BR" data-resolution="landscape">
<head>
<meta charset="UTF-8" />
<meta name="viewport" content="width=1920, height=1080" />
<script src="assets/gsap.min.js"></script>
<style>
${css}
</style>
</head>
<body>
<div id="root" data-composition-id="main" data-start="0" data-duration="${TOTAL}" data-width="1920" data-height="1080">
  <div class="bg"></div>${under}${html}${audio}
</div>
<script>
  window.__timelines = window.__timelines || {};
  const tl = gsap.timeline({ paused: true });
${js}
  window.__timelines["main"] = tl;
  tl.seek(0);
</script>
</body>
</html>
`;
writeFileSync(new URL('../composition/index.html', W), page);

const ts = s => { const ms = Math.round(s * 1000); const h = Math.floor(ms / 3600000), m = Math.floor(ms / 60000) % 60, sec = Math.floor(ms / 1000) % 60; return `${String(h).padStart(2, '0')}:${String(m).padStart(2, '0')}:${String(sec).padStart(2, '0')},${String(ms % 1000).padStart(3, '0')}`; };
writeFileSync(new URL('../brag.srt', W), caps.map((c, k) => `${k + 1}\n${ts(c.start)} --> ${ts(c.out)}\n${c.text}\n`).join('\n'));
writeFileSync(new URL('storyboard.md', W), `| Cena | Tempo | Narração (legenda) | Texto na tela | Ação visual | Fonte dos dados | Estado do produto |\n|---|---|---|---|---|---|---|\n${board.join('\n')}\n`);
console.log('scenes', T.scenes.length, 'captions', caps.length, 'total', TOTAL);
