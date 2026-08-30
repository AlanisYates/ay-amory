FROM node:22-alpine AS build
RUN corepack enable
WORKDIR /app
COPY pnpm-workspace.yaml package.json pnpm-lock.yaml ./
COPY packages/db/package.json ./packages/db/package.json
COPY apps/web/package.json ./apps/web/package.json
RUN pnpm install --frozen-lockfile
COPY packages/db ./packages/db
COPY apps/web ./apps/web
RUN pnpm --filter @ay-armory/web exec vite build

FROM caddy:2-alpine
COPY --from=build /app/apps/web/dist /srv
COPY Caddyfile /etc/caddy/Caddyfile
