# Hyperframes Composition Brief: Tarvo · fechamento mensal

## Objective
Vídeo demonstrativo narrado em pt-BR para o time financeiro e o CFO da Tarvo (hackathon Desafio Barte AI). Adaptação deliberada do /brag: 120 s em vez de 15–25 s, a pedido do time.

## Output
- Composition directory: `composition/` (gerado por `work/build.mjs` a partir de `work/scenes.mjs` + `work/timings.json`)
- Rendered video: `brag.mp4`
- Format: landscape, 1920×1080, 30 fps
- Duration: 122,8 s

## Source Material
- Project root: `Hackathon-Barte/`
- Files read: demo/README.md, demo/back/docs/ENGINE_NOTES.md, demo/back/HIPOTESES.md, demo/back/docs/GMAIL.md, demo/back/docs/TESTES_EMAIL.md, demo/back/src/chat/agent.py, saida/setembro_2026, Tarvo_Data_Pack_out2026/00_LEIA-ME.md, front/src/styles/app.css
- Copy usada literalmente: "Tarvo · cada número tem uma origem" (rodapé do app), textos de exceção da tela de Revisão

## Creative Direction
- Tone preset: polished
- Angle: abrir com a isenção da Casa do Estudante que não chegou à cobrança; mostrar origem, regra e quem decide em telas reais; separar medidas de dinheiro; outubro como cenário de teste; IA só como consulta; limites com consequência; próximo passo concreto.
- Avoid: somar medidas, chamar contestação de recuperação, nota proposta de emitida, encenar envio de e-mail ou resposta do chat.

## Visual Identity
- Background: `--ink-900 #22060f` → `--ink-950 #14040a`
- Text: `#f6e9ec`
- Accent: `#de325d` / `#ff7a9c`
- Font: Inter (a mesma do app, arquivo local)
- Layout: área de cena 1920×900 (interface ocupa a maior parte) + faixa de legendas de 180 px que nunca cobre controles ou evidências

## Audio
- Voz: Kokoro `pf_dora` (pt-BR), faixa 3, volume 1, gerada frase a frase
- Música: vol-12 em loop com crossfade, volume 0,11 (sob a voz); fade-out no fim
- SFX: um clique na ação "Rodar" (s07) e dois toques suaves na entrada dos números (s05)
- Audio-reactive: nenhum (vídeo narrado, tom sóbrio)
- Final: loudness normalizada para −16 LUFS na entrega
