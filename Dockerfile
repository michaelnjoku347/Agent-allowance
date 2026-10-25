# One-click image. The dashboard is built in, and the API serves it on port 8787.
# Funded payments still come from environment variables. This image does not copy .env.

FROM node:22-bookworm-slim

WORKDIR /app

COPY package.json package-lock.json ./
COPY dashboard/package.json dashboard/package-lock.json dashboard/

RUN npm ci && npm --prefix dashboard ci

COPY . .

RUN npm --prefix dashboard run build

ENV NODE_ENV=production
ENV PORT=8787
ENV SERVE_DASHBOARD=1

EXPOSE 8787

CMD ["node", "server/index.js"]
