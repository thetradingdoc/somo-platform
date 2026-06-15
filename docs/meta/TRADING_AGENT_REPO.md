# Trading agent repository

**Status:** Moved out of this repo (2026-06-14)

The Somo **biotech trading agent** (paper trading shell, `trading-rails`, Pinecone news RAG) lives in a separate repository:

**https://github.com/richiejeremiah/trading-agent**

This repository (`somo-platform`) is the **AI front-desk receptionist** only: Kelly voice agent, provider portal, patient portal, and RCM.

Do not add trading routes, `TRADING_*` env vars, or `trading-rails` code here. Cross-repo shared patterns (lane/step orchestration, vector search) were forked at split time; they evolve independently.
