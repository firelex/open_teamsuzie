FROM node:25-slim

WORKDIR /app

ENV NODE_ENV=production

RUN apt-get update \
    && apt-get install -y --no-install-recommends zip unzip \
    && rm -rf /var/lib/apt/lists/*

COPY package.json pnpm-lock.yaml pnpm-workspace.yaml ./
COPY node_modules ./node_modules
COPY apps/agents/pptx-agent/package.json ./apps/agents/pptx-agent/package.json
COPY apps/agents/pptx-agent/node_modules ./apps/agents/pptx-agent/node_modules
COPY apps/agents/pptx-agent/dist ./apps/agents/pptx-agent/dist

# Rebuild sharp inside the Linux image so the native binding matches the runtime.
RUN corepack enable && pnpm rebuild sharp

WORKDIR /app/apps/agents/pptx-agent

EXPOSE 3009

CMD ["node", "dist/index.js"]
