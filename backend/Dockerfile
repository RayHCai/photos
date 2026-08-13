# syntax=docker/dockerfile:1
#
# Multi-stage. The previous single-stage image shipped the entire devDependency tree
# (typescript, eslint, prisma CLI, husky, vitest) into the runtime layer and started
# with `npx tsx src/index.ts` — which strips types *without checking them*, so a type
# error tsc would have caught reached production as a 500, and every boot paid
# transpilation. It also ran as root, set no NODE_ENV, and had no healthcheck or init.

# ─── Builder ─────────────────────────────────────────────────────────────────
FROM node:22-alpine AS builder
WORKDIR /app

COPY package.json yarn.lock ./
RUN yarn install --frozen-lockfile

COPY prisma ./prisma
COPY tsconfig.json ./
COPY src ./src

RUN npx prisma generate
# Fails the image build on a type error rather than deferring it to runtime.
RUN yarn build

# ─── Production dependencies ─────────────────────────────────────────────────
FROM node:22-alpine AS deps
WORKDIR /app

COPY package.json yarn.lock ./
RUN yarn install --frozen-lockfile --production
# The Prisma client is generated into node_modules, so it must be regenerated against
# the pruned tree.
COPY prisma ./prisma
RUN npx prisma generate

# ─── Runtime ─────────────────────────────────────────────────────────────────
FROM node:22-alpine AS runtime
WORKDIR /app

# tini reaps zombies and forwards signals, so SIGTERM actually reaches Node and the
# graceful-shutdown path in index.ts runs instead of the process being killed outright.
RUN apk add --no-cache tini

ENV NODE_ENV=production

COPY --from=deps    /app/node_modules ./node_modules
COPY --from=builder /app/dist         ./dist
COPY --from=builder /app/prisma       ./prisma
COPY package.json ./

# The node image ships an unprivileged `node` user; PID 1 was previously root.
USER node

EXPOSE 4000

# Readiness rather than liveness: this verifies Postgres and Redis are actually
# reachable, which is what "can this container serve traffic" means. There was no
# healthcheck and no health endpoint at all, so a post-boot loss of either dependency
# was invisible to any orchestrator.
HEALTHCHECK --interval=15s --timeout=5s --start-period=20s --retries=3 \
    CMD node -e "fetch('http://127.0.0.1:4000/readyz').then(r=>process.exit(r.ok?0:1)).catch(()=>process.exit(1))"

ENTRYPOINT ["/sbin/tini", "--"]
CMD ["node", "dist/index.js"]
