FROM node:24-alpine AS dependencies

WORKDIR /app

COPY package*.json ./
RUN apk add --no-cache python3 make g++ \
    && npm_config_nodedir=/usr/local npm ci --omit=dev

FROM node:24-alpine

ENV NODE_ENV=production
WORKDIR /app
COPY --from=dependencies /app/node_modules ./node_modules
COPY package*.json ./
COPY src ./src
COPY scripts ./scripts
RUN mkdir -p /data && chown node:node /data
USER node

EXPOSE 7749
HEALTHCHECK --interval=30s --timeout=5s --retries=3 \
  CMD node -e "fetch('http://127.0.0.1:' + (process.env.PORT || '7749') + '/healthz').then(response => process.exit(response.ok ? 0 : 1)).catch(() => process.exit(1))"
CMD ["node", "src/index.js"]
