FROM node:20

ENV NODE_ENV=production
# DISABLE_SQLITE: better-sqlite3 causa SIGSEGV no Cloud Run (signal 11)
# Testado com v12.11.1 e v13.0.3 — ambos falham no container gVisor do Cloud Run
# Quando desabilitado, usa apenas cache L1 (Map em memória)
ENV DISABLE_SQLITE=true
ENV npm_config_build_from_source=true

WORKDIR /app

COPY package*.json ./
RUN npm ci

COPY . .
RUN npm run build && npm prune --omit=dev

EXPOSE 8080

CMD ["node", "dist/server.cjs"]
