# Phase 6 — runtime image excludes verify/harness tooling (see .dockerignore)
FROM node:20-bookworm-slim AS base
WORKDIR /app
RUN apt-get update && apt-get install -y --no-install-recommends \
    python3 make g++ \
    && rm -rf /var/lib/apt/lists/*

FROM base AS deps
COPY package.json package-lock.json ./
RUN npm ci --omit=dev

FROM base AS runtime
COPY --from=deps /app/node_modules ./node_modules
COPY package.json package-lock.json docker-entrypoint.sh ./
COPY server.js database.js ./
COPY app ./app
COPY routes ./routes
COPY services ./services
COPY webhooks ./webhooks
COPY middleware ./middleware
COPY adapters ./adapters
COPY lib ./lib
COPY utils ./utils
COPY config ./config
COPY models ./models
COPY database ./database
COPY public ./public
COPY taxonomy ./taxonomy
COPY retell-functions ./retell-functions
COPY assets ./assets
COPY bootstrap ./bootstrap
COPY scripts/cloudrun-db-sync.sh scripts/cloudrun-db-sync.cjs scripts/gcs-cli-fallback.cjs scripts/ensure-face-read-env.cjs ./scripts/
COPY scripts/lib ./scripts/lib

ENV NODE_ENV=production
ENV DB_PATH=/var/data/middleware-staging.db
ENV GCS_DB_BUCKET=somo-staging-db-somo-callsomo
EXPOSE 8080
RUN chmod +x docker-entrypoint.sh scripts/cloudrun-db-sync.sh
ENTRYPOINT ["./docker-entrypoint.sh"]
