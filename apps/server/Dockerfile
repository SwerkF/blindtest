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
# db push refuses lossy-looking changes (e.g. Int -> BigInt, which keeps every value): set
# PRISMA_ACCEPT_DATA_LOSS=1 for the one deploy that needs it, then remove it.
CMD ["sh", "-c", "bunx prisma db push ${PRISMA_ACCEPT_DATA_LOSS:+--accept-data-loss} && bun prisma/seed.ts && bun src/index.ts"]
