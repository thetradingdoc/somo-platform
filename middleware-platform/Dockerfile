# Cloud Run / GCP — Node middleware (better-sqlite3 + sharp need build tools)
FROM node:20-bookworm-slim
WORKDIR /app

RUN apt-get update && apt-get install -y --no-install-recommends \
    python3 make g++ \
    && rm -rf /var/lib/apt/lists/*

COPY package.json package-lock.json ./
RUN npm ci --omit=dev

COPY . .

ENV NODE_ENV=production
ENV DB_PATH=/var/data/middleware-staging.db
ENV GCS_DB_BUCKET=somo-staging-db
# Cloud Run sets PORT (default 8080)
EXPOSE 8080
RUN chmod +x docker-entrypoint.sh scripts/cloudrun-db-sync.sh
ENTRYPOINT ["./docker-entrypoint.sh"]
