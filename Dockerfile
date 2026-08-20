FROM node:20

ENV NODE_ENV=production
# Turso: SQLite na nuvem (sem SIGSEGV no Cloud Run)
# Variáveis TURSO_DATABASE_URL e TURSO_AUTH_TOKEN devem ser configuradas no Cloud Run
ENV npm_config_build_from_source=true

# Firebase config build args (optional, for Google OAuth)
ARG FIREBASE_API_KEY
ARG FIREBASE_AUTH_DOMAIN
ARG FIREBASE_PROJECT_ID
ARG FIREBASE_STORAGE_BUCKET
ARG FIREBASE_MESSAGING_SENDER_ID
ARG FIREBASE_APP_ID
ARG FIREBASE_MEASUREMENT_ID
ARG FIREBASE_FIRESTORE_DATABASE_ID

WORKDIR /app

COPY package*.json ./
RUN npm ci

COPY . .

# Create firebase config file from build args (if provided)
RUN if [ -n "$FIREBASE_API_KEY" ]; then \
    cat > firebase-applet-config.json <<EOF \
{ \
  "apiKey": "$FIREBASE_API_KEY", \
  "authDomain": "$FIREBASE_AUTH_DOMAIN", \
  "projectId": "$FIREBASE_PROJECT_ID", \
  "storageBucket": "$FIREBASE_STORAGE_BUCKET", \
  "messagingSenderId": "$FIREBASE_MESSAGING_SENDER_ID", \
  "appId": "$FIREBASE_APP_ID", \
  "measurementId": "$FIREBASE_MEASUREMENT_ID", \
  "firestoreDatabaseId": "$FIREBASE_FIRESTORE_DATABASE_ID" \
} \
EOF \
  else \
    echo '{"apiKey":"","authDomain":"","projectId":"","storageBucket":"","messagingSenderId":"","appId":"","measurementId":"","firestoreDatabaseId":""}' > firebase-applet-config.json; \
  fi

RUN npm run build && npm prune --omit=dev

EXPOSE 8080

CMD ["node", "dist/server.cjs"]
