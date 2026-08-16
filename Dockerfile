FROM node:20

ENV NODE_ENV=production
# Turso: SQLite na nuvem (sem SIGSEGV no Cloud Run)
# Variáveis TURSO_DATABASE_URL e TURSO_AUTH_TOKEN devem ser configuradas no Cloud Run
ENV npm_config_build_from_source=true

WORKDIR /app

COPY package*.json ./
RUN npm ci

COPY . .
RUN npm run build && npm prune --omit=dev

EXPOSE 8080

CMD ["node", "dist/server.cjs"]
