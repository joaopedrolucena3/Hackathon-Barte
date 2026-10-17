"""Generate the pt-BR narration sentence by sentence with Kokoro and write exact timings.

Outputs (in composition/assets/vo/): one WAV per scene, voiceover.wav (all scenes back to back),
and work/timings.json with scene and sentence start/end times used by the composition and the SRT.
"""
import json
import re
import sys
from pathlib import Path

import numpy as np
import soundfile as sf
from kokoro_onnx import Kokoro

ROOT = Path(__file__).resolve().parent.parent
CACHE = Path.home() / ".cache" / "hyperframes" / "tts"
SPOKEN = [(r"\bMDR\b", "eme-dê-érre"), (r"\bERP\b", "ê-érre-pê"), (r"\bIA\b", "i-á")]


def spoken(text):
    for pattern, repl in SPOKEN:
        text = re.sub(pattern, repl, text)
    return text


def main():
    script = json.loads((ROOT / "work" / "script.json").read_text(encoding="utf-8"))
    kokoro = Kokoro(str(CACHE / "models" / "kokoro-v1.0.onnx"), str(CACHE / "voices" / "voices-v1.0.bin"))
    out = ROOT / "composition" / "assets" / "vo"
    out.mkdir(parents=True, exist_ok=True)
    speed = float(sys.argv[1]) if len(sys.argv) > 1 else 1.0
    sr = 24000
    gap = script["gap_sentence"]
    timeline, full, t = [], [], 0.0
    for scene in script["scenes"]:
        parts = [np.zeros(int(scene["lead"] * sr), dtype=np.float32)]
        local = scene["lead"]
        lines = []
        for i, (say, caption) in enumerate(scene["lines"]):
            audio, rate = kokoro.create(spoken(say), voice=script["voice"], speed=speed, lang=script["lang"])
            assert rate == sr
            audio = audio.astype(np.float32)
            lines.append({"start": round(t + local, 3), "end": round(t + local + len(audio) / sr, 3), "text": caption})
            parts.append(audio)
            local += len(audio) / sr
            if i < len(scene["lines"]) - 1:
                parts.append(np.zeros(int(gap * sr), dtype=np.float32))
                local += gap
        parts.append(np.zeros(int(scene["tail"] * sr), dtype=np.float32))
        local += scene["tail"]
        wav = np.concatenate(parts)
        sf.write(out / f"{scene['id']}.wav", wav, sr)
        full.append(wav)
        timeline.append({"id": scene["id"], "chapter": scene.get("chapter"), "start": round(t, 3),
                         "duration": round(len(wav) / sr, 3), "lines": lines})
        t += len(wav) / sr
        print(scene["id"], round(len(wav) / sr, 2), flush=True)
    sf.write(out / "voiceover.wav", np.concatenate(full), sr)
    (ROOT / "work" / "timings.json").write_text(json.dumps({"total": round(t, 3), "scenes": timeline}, ensure_ascii=False, indent=1), encoding="utf-8")
    print("total", round(t, 2))


if __name__ == "__main__":
    main()
