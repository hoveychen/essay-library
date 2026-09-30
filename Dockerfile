FROM node:22-bookworm-slim AS build
WORKDIR /app
RUN apt-get update && apt-get install -y --no-install-recommends openssl && rm -rf /var/lib/apt/lists/*
COPY package.json package-lock.json ./
RUN npm ci
COPY . .
# prisma.config.ts requires DATABASE_URL even for generate; the build never opens it
ENV DATABASE_URL=file:/tmp/build.db NEXT_TELEMETRY_DISABLED=1
RUN npx prisma generate && npm run build

FROM node:22-bookworm-slim
WORKDIR /app
RUN apt-get update && apt-get install -y --no-install-recommends openssl && rm -rf /var/lib/apt/lists/*
ENV NODE_ENV=production \
    DATABASE_URL=file:/workspace/dev.db \
    UPLOAD_DIR=/workspace/uploads \
    NEXT_TELEMETRY_DISABLED=1
COPY --from=build /app ./
EXPOSE 8080
# /workspace is the persistent volume on Muvee: SQLite DB + uploaded images live there
CMD ["sh", "-c", "mkdir -p /workspace/uploads && npx prisma migrate deploy && npx next start -H 0.0.0.0 -p 8080"]
