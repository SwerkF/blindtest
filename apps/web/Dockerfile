FROM oven/bun:1-alpine AS builder
WORKDIR /app

COPY package.json bun.lock* bun.lockb* tsconfig.base.json ./
COPY packages/shared/package.json ./packages/shared/
COPY apps/web/package.json ./apps/web/

RUN bun install

COPY packages/ packages/
COPY apps/web/ apps/web/

WORKDIR /app/apps/web
RUN node_modules/.bin/vite build

FROM nginx:alpine
COPY --from=builder /app/apps/web/dist /usr/share/nginx/html
COPY apps/web/nginx.conf /etc/nginx/conf.d/default.conf
EXPOSE 80
