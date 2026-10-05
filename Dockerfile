# Production image for the Kamal deployment (config/deploy.yml).
# Built locally on an x86 machine (`bin/deploy`), never on the VPS.
#
# Three stages share one dependency install:
#   deps    full install (dev deps needed by `next build`)
#   build   `pnpm build` → .next/standalone
#   prod    prod-only node_modules for the start sequence (prisma CLI, seeds)
# The runtime image carries both the standalone server (with its own traced
# node_modules) and the prod node_modules — ~1 GB, but the node_modules layer
# only changes with pnpm-lock.yaml, so most deploys push just the app layer.

ARG NODE_VERSION=22

FROM node:${NODE_VERSION}-bookworm-slim AS base
ENV PNPM_HOME=/pnpm PATH=/pnpm:$PATH CI=true NEXT_TELEMETRY_DISABLED=1
RUN corepack enable
WORKDIR /app

FROM base AS deps
COPY package.json pnpm-lock.yaml pnpm-workspace.yaml .npmrc ./
COPY prisma ./prisma
RUN --mount=type=cache,id=pnpm,target=/pnpm/store pnpm install --frozen-lockfile

FROM base AS prod-deps
COPY package.json pnpm-lock.yaml pnpm-workspace.yaml .npmrc ./
COPY prisma ./prisma
COPY prisma.config.ts ./
# The root "prepare" script runs husky, a dev dependency → drop it here.
RUN --mount=type=cache,id=pnpm,target=/pnpm/store npm pkg delete scripts.prepare \
 && pnpm install --frozen-lockfile --prod \
 && DATABASE_URL=postgresql://dummy:dummy@localhost:5432/dummy ./node_modules/.bin/prisma generate

FROM base AS build
# NEXT_PUBLIC_* are inlined at build time. NEXTAUTH_URL feeds
# NEXT_PUBLIC_APP_HOSTNAME in next.config.ts.
ARG NEXTAUTH_URL
ARG NEXT_PUBLIC_CUSTOM_DOMAIN_TARGET
ARG NEXT_PUBLIC_KARA_TILESET_URL
ARG NEXT_PUBLIC_GIT_COMMIT_SHA
ARG NEXT_PUBLIC_GIT_COMMIT_MESSAGE
ARG NEXT_PUBLIC_BUILD_TIME
ENV NEXTAUTH_URL=$NEXTAUTH_URL \
    NEXT_PUBLIC_CUSTOM_DOMAIN_TARGET=$NEXT_PUBLIC_CUSTOM_DOMAIN_TARGET \
    NEXT_PUBLIC_KARA_TILESET_URL=$NEXT_PUBLIC_KARA_TILESET_URL \
    NEXT_PUBLIC_GIT_COMMIT_SHA=$NEXT_PUBLIC_GIT_COMMIT_SHA \
    NEXT_PUBLIC_GIT_COMMIT_MESSAGE=$NEXT_PUBLIC_GIT_COMMIT_MESSAGE \
    NEXT_PUBLIC_BUILD_TIME=$NEXT_PUBLIC_BUILD_TIME
COPY --from=deps /app/node_modules ./node_modules
COPY . .
# Server-action IDs are encrypted with this key; it must be identical at build
# and run time or every server action from a cached page breaks after deploy.
# src/lib/prisma.ts throws at import without DATABASE_URL; route config
# collection imports it. A dummy is enough — the build never connects.
RUN --mount=type=secret,id=NEXT_SERVER_ACTIONS_ENCRYPTION_KEY,env=NEXT_SERVER_ACTIONS_ENCRYPTION_KEY \
    DATABASE_URL=postgresql://dummy:dummy@localhost:5432/dummy pnpm build

FROM node:${NODE_VERSION}-bookworm-slim AS runtime
# Script import (src/lib/script-import/): native pandoc (the .deb from the
# pandoc releases, pinned + checksummed; Debian's 2.17 is too old) and
# LibreOffice headless for .doc/.odt/.rtf → .docx. Both run as child processes
# only during an import. LibreOffice adds ~700 MB to the image; the layer only
# changes when these versions change.
ARG PANDOC_VERSION=3.12
ARG PANDOC_SHA256=91903ff19f1b1d4db4129797c7e18f71212990d7394fcff1787719aebf04e372
RUN apt-get update \
 && apt-get install -y --no-install-recommends ca-certificates curl fonts-dejavu-core tini \
      libreoffice-writer-nogui libreoffice-math-nogui \
 && curl -fsSL -o /tmp/pandoc.deb https://github.com/jgm/pandoc/releases/download/${PANDOC_VERSION}/pandoc-${PANDOC_VERSION}-1-amd64.deb \
 && echo "${PANDOC_SHA256}  /tmp/pandoc.deb" | sha256sum -c - \
 && dpkg -i /tmp/pandoc.deb && rm /tmp/pandoc.deb \
 && apt-get purge -y curl && apt-get autoremove -y \
 && rm -rf /var/lib/apt/lists/*
WORKDIR /app
# Docker sets HOSTNAME to the container id; Next standalone binds to it, which
# breaks the localhost:$PORT calls in src/proxy.ts. Bind all interfaces.
ENV NODE_ENV=production HOSTNAME=0.0.0.0 PORT=3000 NEXT_TELEMETRY_DISABLED=1
COPY --from=prod-deps --chown=node:node /app/node_modules ./node_modules
COPY --chown=node:node package.json prisma.config.ts docker-entrypoint.sh ./
COPY --chown=node:node prisma ./prisma
COPY --chown=node:node scripts ./scripts
COPY --chown=node:node docs ./docs
COPY --chown=node:node demo-content ./demo-content
COPY --from=build --chown=node:node /app/.next/standalone ./.next/standalone
USER node
EXPOSE 3000
ENTRYPOINT ["/usr/bin/tini", "--", "/app/docker-entrypoint.sh"]
