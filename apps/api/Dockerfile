# Build context: repository root (the API depends on packages/contract).
FROM node:24-slim
RUN apt-get update && apt-get install -y --no-install-recommends openssl ca-certificates && rm -rf /var/lib/apt/lists/*
WORKDIR /app

COPY package.json package-lock.json ./
COPY packages/contract/package.json packages/contract/
COPY apps/api/package.json apps/api/
RUN npm ci --workspace packages/contract --workspace apps/api --include-workspace-root

COPY packages/contract packages/contract
COPY apps/api apps/api
RUN npm run build -w packages/contract && npm run build -w apps/api

ENV NODE_ENV=production
WORKDIR /app/apps/api
USER node
EXPOSE 4000
# Apply pending migrations, then start.
CMD ["sh", "-c", "npx prisma migrate deploy && node dist/index.js"]
