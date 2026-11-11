# Build from the repo root: docker build -f apps/platform/auth/Dockerfile .
FROM node:22-slim AS build
RUN corepack enable
WORKDIR /repo
COPY pnpm-lock.yaml pnpm-workspace.yaml package.json ./
COPY packages/crypto/package.json packages/crypto/
COPY packages/shared-auth/package.json packages/shared-auth/
COPY apps/platform/auth/package.json apps/platform/auth/
RUN pnpm install --frozen-lockfile --filter @teamsuzie/auth...
COPY packages/crypto packages/crypto
COPY packages/shared-auth packages/shared-auth
COPY apps/platform/auth apps/platform/auth
# Dependencies first (the dev script's predev path skips crypto). tsc doesn't copy the .cjs migrations, so copy them.
RUN pnpm --filter @teamsuzie/crypto build \
 && pnpm --filter @teamsuzie/shared-auth build \
 && pnpm --filter @teamsuzie/auth build \
 && cp -r apps/platform/auth/src/migrations apps/platform/auth/dist/

FROM node:22-slim
ENV NODE_ENV=production PORT=3005 OIDC_SIGNING_KEY_PATH=/data/oidc/keys.json
WORKDIR /repo
COPY --from=build /repo /repo
WORKDIR /repo/apps/platform/auth
# The OIDC signing key is generated on first start and must persist: mount /data.
VOLUME /data
EXPOSE 3005
USER node
CMD ["sh", "-c", "node scripts/sync-tables.mjs && exec node dist/index.js"]
