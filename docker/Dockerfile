# ────────── 构建阶段 ──────────
FROM node:22-alpine AS builder

WORKDIR /app
COPY package.json tsconfig.json ./

RUN npm install && \
    apk add --no-cache python3 make g++ && \
    npm rebuild better-sqlite3 && \
    rm -rf /var/cache/apk/*

COPY src/ ./src/
RUN npx tsc

# ────────── 运行阶段 ──────────
FROM node:22-alpine

WORKDIR /app

COPY package.json ./
RUN apk add --no-cache python3 make g++ && \
    npm install --omit=dev && \
    apk del python3 make g++ && \
    rm -rf /var/cache/apk/*

COPY --from=builder /app/dist /app/dist

RUN apk add --no-cache dumb-init

EXPOSE 3000
ENTRYPOINT ["dumb-init", "node", "dist/index.js"]
