# syntax=docker/dockerfile:1

# ---------- base ----------
FROM node:24-bookworm-slim AS base
ENV PNPM_HOME=/pnpm \
    PATH=/pnpm:$PATH \
    NEXT_TELEMETRY_DISABLED=1 \
    DATABASE_URL=file:/app/data/app.db
RUN npm install -g pnpm@11.17.0
# Prisma (generate in the build stage) needs OpenSSL, which the slim image lacks
RUN apt-get update \
 && apt-get install -y --no-install-recommends openssl ca-certificates \
 && rm -rf /var/lib/apt/lists/*
WORKDIR /app

# ---------- dependencies (includes native better-sqlite3) ----------
FROM base AS deps
# build tools, only used if no prebuilt better-sqlite3 binary exists for this platform
RUN apt-get update \
 && apt-get install -y --no-install-recommends python3 make g++ ca-certificates \
 && rm -rf /var/lib/apt/lists/*
COPY package.json pnpm-lock.yaml pnpm-workspace.yaml prisma.config.ts ./
COPY prisma ./prisma
RUN pnpm install --frozen-lockfile

# ---------- build ----------
FROM base AS build
# public URL baked into page metadata (canonical URL, Open Graph image links)
ARG APP_URL=http://localhost:3000
ENV APP_URL=$APP_URL
COPY --from=deps /app/node_modules ./node_modules
COPY . .
RUN pnpm build

# ---------- migration runner (Prisma CLI, used at container start) ----------
FROM base AS migrator
WORKDIR /migrate
RUN npm init -y >/dev/null \
 && npm install --omit=dev prisma@7.10.0 dotenv@18 \
 && npm cache clean --force

# ---------- runtime ----------
FROM node:24-bookworm-slim AS runner
ENV NODE_ENV=production \
    NEXT_TELEMETRY_DISABLED=1 \
    PORT=3000 \
    HOSTNAME=0.0.0.0 \
    DATABASE_URL=file:/app/data/app.db
WORKDIR /app

# Prisma's schema engine (used by `prisma migrate deploy` at start-up) needs OpenSSL, which the slim image lacks
RUN apt-get update \
 && apt-get install -y --no-install-recommends openssl ca-certificates \
 && rm -rf /var/lib/apt/lists/*

# Next.js standalone server + static assets
COPY --from=build --chown=node:node /app/.next/standalone ./
COPY --from=build --chown=node:node /app/.next/static ./.next/static
COPY --from=build --chown=node:node /app/public ./public

# Prisma CLI + schema/migrations for `prisma migrate deploy` on start-up
COPY --from=migrator --chown=node:node /migrate/node_modules ./migrate/node_modules
COPY --chown=node:node prisma ./migrate/prisma
COPY --chown=node:node prisma.config.ts ./migrate/prisma.config.ts

COPY --chown=node:node docker-entrypoint.sh /usr/local/bin/docker-entrypoint.sh
RUN sed -i 's/\r$//' /usr/local/bin/docker-entrypoint.sh \
 && chmod +x /usr/local/bin/docker-entrypoint.sh \
 && mkdir -p /app/data && chown node:node /app/data

USER node
VOLUME ["/app/data"]
EXPOSE 3000
HEALTHCHECK --interval=30s --timeout=5s --start-period=20s --retries=3 \
  CMD node -e "fetch('http://127.0.0.1:'+(process.env.PORT||3000)+'/api/auth/me').then(r=>process.exit(r.ok?0:1)).catch(()=>process.exit(1))"

ENTRYPOINT ["docker-entrypoint.sh"]
CMD ["node", "server.js"]
