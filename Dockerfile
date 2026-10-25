# Agent Allowance: the API and the built dashboard on one port.
#
#   docker build -t agent-allowance .
#   docker run --rm -p 127.0.0.1:8787:8787 agent-allowance                 # local, sample data
#   docker run --rm -p 8787:8787 -e PUBLIC_DEMO=1 agent-allowance          # hosted public demo
#
# No .env is copied into the image (see .dockerignore). Keys, when a deploy
# needs them, come from the host's secret store as environment variables.

FROM node:22-bookworm-slim AS build
WORKDIR /app
COPY package.json package-lock.json ./
COPY dashboard/package.json dashboard/package-lock.json dashboard/
RUN npm ci && npm --prefix dashboard ci
COPY . .
RUN npm --prefix dashboard run build \
  && npm prune --omit=dev \
  && rm -rf dashboard/node_modules

FROM node:22-bookworm-slim
WORKDIR /app
ENV NODE_ENV=production \
    PORT=8787 \
    HOST=0.0.0.0 \
    SERVE_DASHBOARD=1
COPY --from=build /app /app
# The store, the rules file, and merchant state are the only paths the server writes.
RUN mkdir -p server/data merchant/state merchant/state-history \
  && chown -R node:node server/data merchant/state merchant/state-history agent/rules.json
USER node
EXPOSE 8787
HEALTHCHECK --interval=30s --timeout=5s --start-period=20s \
  CMD node -e "fetch('http://127.0.0.1:'+(process.env.PORT||8787)+'/api/health').then((r)=>process.exit(r.ok?0:1)).catch(()=>process.exit(1))"
CMD ["node", "server/index.js"]
