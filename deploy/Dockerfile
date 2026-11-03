# syntax=docker/dockerfile:1
# Hexhaven: one container running the Node server (tsx) that also serves the built web app.
# Build from the repo root:  docker build -f deploy/Dockerfile .

# ---------------------------------------------------------------- base: node + pnpm + native build tools
FROM node:22-slim AS base
ENV COREPACK_HOME=/opt/corepack \
    COREPACK_ENABLE_DOWNLOAD_PROMPT=0
# python3/make/g++ let better-sqlite3 compile if no prebuilt binary matches.
RUN apt-get update \
 && apt-get install -y --no-install-recommends python3 make g++ ca-certificates \
 && rm -rf /var/lib/apt/lists/*
# A current corepack knows the signing keys of recent pnpm releases.
RUN npm install -g corepack@latest && corepack enable
WORKDIR /app
COPY package.json pnpm-lock.yaml pnpm-workspace.yaml ./
COPY apps/server/package.json apps/server/
COPY apps/web/package.json apps/web/
COPY packages/bot/package.json packages/bot/
COPY packages/engine/package.json packages/engine/
COPY packages/shared/package.json packages/shared/
# Download the pnpm version pinned in package.json#packageManager.
RUN corepack install

# ---------------------------------------------------------------- build: full install + web bundle
FROM base AS build
RUN pnpm install --frozen-lockfile
COPY . .
RUN pnpm build

# ---------------------------------------------------------------- prod-deps: runtime node_modules only
FROM base AS prod-deps
RUN pnpm install --frozen-lockfile --prod

# ---------------------------------------------------------------- runtime
# Hardened for `read_only: true`: code is owned by root (the app cannot modify itself), the
# only writable places are the /data volume and a /tmp tmpfs (tsx's compile cache).
FROM node:22-slim AS runtime
ENV NODE_ENV=production \
    PORT=3000 \
    WEB_DIST=/app/apps/web/dist \
    DB_PATH=/data/hexhaven.sqlite
WORKDIR /app
RUN mkdir -p /data && chown node:node /data
COPY --from=prod-deps /app /app
COPY . .
COPY --from=build /app/apps/web/dist /app/apps/web/dist

# Unprivileged user (uid 1000) from the base image.
USER node
VOLUME ["/data"]
EXPOSE 3000
HEALTHCHECK --interval=30s --timeout=5s --start-period=30s --retries=3 \
  CMD ["node", "-e", "fetch('http://127.0.0.1:'+(process.env.PORT||3000)+'/api/health').then(r=>process.exit(r.ok?0:1),()=>process.exit(1))"]
# Node directly (no pnpm wrapper at runtime): signals reach the server and nothing writes to $HOME.
WORKDIR /app/apps/server
CMD ["node", "--import", "tsx", "src/index.ts"]
