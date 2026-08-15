FROM node:20

ENV NODE_ENV=production
ENV npm_config_build_from_source=true

WORKDIR /app

COPY package*.json ./
RUN npm ci

COPY . .
RUN npm run build && npm prune --omit=dev

EXPOSE 8080

CMD ["node", "dist/server.cjs"]
