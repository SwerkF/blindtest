FROM oven/bun:1-alpine
WORKDIR /app

RUN apk add --no-cache openssl

COPY package.json bun.lock* bun.lockb* tsconfig.base.json ./
COPY packages/shared/package.json ./packages/shared/
COPY apps/server/package.json ./apps/server/

RUN bun install

COPY packages/ packages/
COPY apps/server/ apps/server/

WORKDIR /app/apps/server
RUN bunx prisma generate

EXPOSE 3001
CMD ["sh", "-c", "bunx prisma db push && bun prisma/seed.ts && bun src/index.ts"]
