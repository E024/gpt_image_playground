FROM node:24-alpine

WORKDIR /app

ARG NPM_REGISTRY=https://registry.npmmirror.com

ENV NODE_ENV=production
ENV BACKEND_API_HOST=0.0.0.0
ENV BACKEND_API_PORT=3018
ENV BACKEND_SQLITE_PATH=/data/backend.sqlite

COPY package.json package-lock.json ./
RUN npm config set registry "$NPM_REGISTRY" \
    && npm config set fetch-retries 5 \
    && npm config set fetch-retry-mintimeout 20000 \
    && npm config set fetch-retry-maxtimeout 120000 \
    && npm ci --omit=dev

COPY scripts ./scripts

RUN mkdir -p /data

EXPOSE 3018

CMD ["node", "scripts/backend-api.mjs"]
