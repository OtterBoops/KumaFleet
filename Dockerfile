FROM node:22-alpine AS builder

WORKDIR /app

COPY package*.json tsconfig.json ./
RUN if [ -f package-lock.json ]; then npm ci; else npm install; fi

COPY src ./src
RUN npm run build && npm prune --production

FROM node:22-alpine AS runner

WORKDIR /app

ENV NODE_ENV=production

COPY package*.json ./
COPY --from=builder /app/node_modules ./node_modules
COPY --from=builder /app/dist ./dist

ENTRYPOINT ["node", "dist/index.js"]
