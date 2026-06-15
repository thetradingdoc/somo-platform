# Speech metrics roadmap

## Implemented (G1 / S4–S6)

- [`voice-speech-metrics.js`](../../middleware-platform/services/voice-speech-metrics.js) — counters for STT confidence, end-of-turn latency, RTF
- [`kelly-asr-gate.js`](../../middleware-platform/services/kelly-asr-gate.js) — records every ASR evaluation
- [`kelly-turn-resolver.js`](../../middleware-platform/services/kelly-turn-resolver.js) — assistant latency via `recordAssistantLatency`

## Phase 3 research (S1–S3, S7–S9)

| Metric | Approach |
|--------|----------|
| WER / CER / SER | Golden transcript set + batch ASR replay — run `node scripts/speech-asr-eval.cjs` |
| Diarization | Compare Retell speaker labels vs reference |
| OOV | Token dictionary miss rate on transcripts |
| SNR-varied WER | Synthetic noise augmentation test suite |

Golden set: [`eval/speech-golden-set.json`](../../middleware-platform/eval/speech-golden-set.json)

Not in production billing path until eval pipeline ships.
