# ----------------------------
# Base stage: Node.js setup
# ----------------------------
FROM node:22-alpine AS base
WORKDIR /app

# Install runtime deps for Prisma / SQLite
RUN apk add --no-cache libc6-compat openssl

# ----------------------------
# Deps stage: install dependencies
# ----------------------------
FROM base AS deps
COPY package.json pnpm-lock.yaml* pnpm-workspace.yaml ./
COPY prisma ./prisma
RUN corepack enable pnpm && pnpm install --frozen-lockfile

# ----------------------------
# Builder stage: build app & generate Prisma client
# ----------------------------
FROM base AS builder
WORKDIR /app

# Copy deps
COPY --from=deps /app/node_modules ./node_modules

# Copy source
COPY . .

# Capture git commit info during build
RUN apk add --no-cache git
ARG GIT_COMMIT_SHA
ARG GIT_COMMIT_MESSAGE
ARG BUILD_TIME
ENV NEXT_PUBLIC_GIT_COMMIT_SHA=${GIT_COMMIT_SHA}
ENV NEXT_PUBLIC_GIT_COMMIT_MESSAGE=${GIT_COMMIT_MESSAGE}
ENV NEXT_PUBLIC_BUILD_TIME=${BUILD_TIME}

# Dummy DATABASE_URL at build time for Prisma
ENV DATABASE_URL="file:/app/data/dummy.db"

# Generate Prisma client first
RUN corepack enable pnpm && pnpm prisma generate

# Build app
RUN pnpm build

# ----------------------------
# Runner stage: production image
# ----------------------------
FROM node:22-alpine AS runner
WORKDIR /app

ENV NODE_ENV=production
ENV NEXT_TELEMETRY_DISABLED=1
ENV PORT=3000
ENV HOSTNAME="0.0.0.0"

# Install sudo for permission fixes
RUN apk add --no-cache sudo

# Create non-root user
RUN addgroup --system --gid 1001 nodejs && \
    adduser --system --uid 1001 nextjs && \
    echo "nextjs ALL=(ALL) NOPASSWD: /bin/chown, /bin/chmod" >> /etc/sudoers

# Copy Next.js standalone output
COPY --from=builder --chown=nextjs:nodejs /app/.next/standalone ./
COPY --from=builder --chown=nextjs:nodejs /app/.next/static ./.next/static

# Copy generated Prisma client and schema (pnpm structure)
COPY --from=builder --chown=nextjs:nodejs /app/node_modules/.pnpm/@prisma+client@*/node_modules/@prisma/client ./node_modules/@prisma/client
COPY --from=builder --chown=nextjs:nodejs /app/prisma ./prisma

# Create persistent directories (uploads + SQLite)
RUN mkdir -p /app/data /app/uploads && \
    chown -R nextjs:nodejs /app/data /app/uploads && \
    chmod -R 755 /app/data /app/uploads

# Copy startup script
COPY start.sh /app/start.sh
RUN chmod +x /app/start.sh && chown nextjs:nodejs /app/start.sh

EXPOSE 3000

# Switch to non-root user
USER nextjs

CMD ["/app/start.sh"]
