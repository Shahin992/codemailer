# syntax=docker/dockerfile:1

FROM node:22-alpine AS base
WORKDIR /app
ENV NEXT_TELEMETRY_DISABLED=1

# All dependencies (dev ones are needed to build and to generate migrations)
FROM base AS deps
RUN apk add --no-cache libc6-compat
COPY package.json package-lock.json ./
RUN npm ci --no-audit --no-fund

# Next.js production build
FROM deps AS builder
COPY . .
RUN npm run build

# One-shot database job, run by the "migrate" service before the app starts:
# writes a new migration if lib/db/schema.ts changed, then applies all pending migrations.
FROM deps AS migrator
COPY drizzle.config.ts tsconfig.json ./
COPY lib/db/schema.ts ./lib/db/schema.ts
COPY scripts/migrate.mjs scripts/db-sync.sh ./scripts/
COPY drizzle ./drizzle
CMD ["sh", "scripts/db-sync.sh"]

# The app (and the cron runner, which uses the same image)
FROM base AS runner
ENV NODE_ENV=production \
    PORT=3000 \
    HOSTNAME=0.0.0.0 \
    STORAGE_DIR=/app/storage
RUN addgroup -S app && adduser -S app -G app && mkdir -p /app/storage && chown app:app /app/storage
COPY --from=builder /app/public ./public
COPY --from=builder --chown=app:app /app/.next/standalone ./
COPY --from=builder --chown=app:app /app/.next/static ./.next/static
COPY --from=builder /app/scripts/cron.mjs ./scripts/cron.mjs
USER app
EXPOSE 3000
CMD ["node", "server.js"]
