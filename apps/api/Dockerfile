FROM node:22-alpine AS base
RUN corepack enable
WORKDIR /app

# copy workspace manifests first for layer caching
COPY pnpm-workspace.yaml package.json pnpm-lock.yaml ./
COPY packages/db/package.json ./packages/db/package.json
COPY apps/api/package.json ./apps/api/package.json

RUN pnpm install --frozen-lockfile

# copy source
COPY packages/db ./packages/db
COPY apps/api ./apps/api

ENV NODE_ENV=production
EXPOSE 3000
CMD ["pnpm", "--filter", "@ay-armory/api", "run", "start"]
