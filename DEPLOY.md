# Deploy no Google Cloud Run

Este documento descreve como fazer o deploy da aplicação **Otimizador de Pedidos SmartPed** no Google Cloud Run utilizando o plano gratuito.

---

## Pré-requisitos

- Conta Google com billing habilitado (não será cobrado dentro do free tier)
- Google Cloud CLI (`gcloud`) instalado
- Node.js instalado localmente (para build)

### Instalar Google Cloud CLI

**Windows (via winget):**
```bash
winget install Google.CloudSDK
```

**macOS (via brew):**
```bash
brew install --cask google-cloud-sdk
```

**Linux (via script):**
```bash
curl https://sdk.cloud.google.com | bash
exec -l $SHELL
gcloud init
```

---

## Configuração Inicial

### 1. Login na conta Google

```bash
gcloud auth login
```

### 2. Criar projeto (ou usar existente)

```bash
gcloud projects create MEU_PROJETO --name="SmartPed"
gcloud config set project MEU_PROJETO
```

### 3. Habilitar APIs necessárias

```bash
gcloud services enable run.googleapis.com
gcloud services enable cloudbuild.googleapis.com
gcloud services enable artifactregistry.googleapis.com
```

### 4. Associar conta de billing

Acesse o Console de Billing: https://console.cloud.google.com/billing

Associe uma conta de pagamento ao projeto. Dentro do free tier, não haverá cobrança.

---

## Deploy da Aplicação

### Método 1: Deploy Direto (Recomendado)

Na pasta raiz do projeto, execute:

```bash
gcloud run deploy smartped \
  --source . \
  --region us-central1 \
  --allow-unauthenticated \
  --port 8080
```

O Cloud Run vai:
- Detectar automaticamente o `package.json`
- Executar `npm run build` (inclui testes automáticos via `backend-tests.ts`)
- Iniciar o servidor com `npm start`
- Expor na porta 8080

### Método 2: Deploy com Dockerfile (Controle Total)

O projeto já possui um `Dockerfile` na raiz com multi-stage build para compilar corretamente o `better-sqlite3`:

```dockerfile
FROM node:20-slim AS builder

RUN apt-get update && apt-get install -y python3 make g++ && rm -rf /var/lib/apt/lists/*
WORKDIR /app
COPY package*.json ./
RUN npm ci
COPY . .
RUN npm run build

FROM node:20-slim

RUN apt-get update && apt-get install -y python3 make g++ && rm -rf /var/lib/apt/lists/*
ENV NODE_ENV=production
WORKDIR /app
COPY package*.json ./
RUN npm ci --omit=dev
COPY --from=builder /app/dist ./dist

EXPOSE 8080
CMD ["node", "dist/server.cjs"]
```

Para fazer o deploy com mais memória (recomendado para SQLite):

```bash
gcloud run deploy smartped-cli \
  --source . \
  --region us-east1 \
  --allow-unauthenticated \
  --port 8080 \
  --memory 1Gi
```

---

## Variáveis de Ambiente

Configure as variáveis de ambiente necessárias para a aplicação:

```bash
# Gerar versão com data/hora de Panambi (UTC-3) e atualizar cloud-env.yaml
$panambiTime = (Get-Date).ToUniversalTime().AddHours(-3)
$version = "v" + $panambiTime.ToString("yyyy-MM-dd-HHmm")
(Get-Content cloud-env.yaml) -replace 'APP_VERSION: ".*"', "APP_VERSION: `"$version`"" | Set-Content cloud-env.yaml
Write-Host "Versao: $version"

# Deploy
gcloud run deploy smartped-cli --source . --region us-east1 --allow-unauthenticated --port 8080 --memory 1Gi --env-vars-file cloud-env.yaml
```

**⚠️ NUNCA usar `--set-env-vars`** — ele SUBSTITUI todas as variáveis, apagando as que não foram listadas. Sempre usar `--env-vars-file cloud-env.yaml` que contém TODAS as variáveis.

**Versionamento:** Formato `vYYYY-MM-DD-HHmm` (fuso Panambi/UTC-3). A versão aparece: (1) no header do app, (2) no `/api/health`, (3) no `cloud-env.yaml` (env var `APP_VERSION`).

---

## URL do Serviço

Após o deploy bem-sucedido, o Google fornece uma URL como:

```
https://smartped-XXXXXX-uc.a.run.app
```

Onde `XXXXXX` é um identificador único da região/projeto.

---

## Persistência de Dados

O Cloud Run utiliza um sistema de arquivos efêmero. O banco SQLite (`better-sqlite3`) é armazenado em `/tmp/smartped.db`, que:

- **Persiste** enquanto a instância estiver ativa
- **É perdido** quando a instância é desativada (cold start após período de inatividade)

Para dados que precisam sobreviver a cold starts, considere:
- Migrar para **Cloud SQL** (PostgreSQL/MySQL)
- Utilizar **Cloud Storage** para backups periódicos do SQLite

---

## Comandos Úteis

### Ver logs em tempo real

```bash
gcloud logging read "resource.type=cloud_run_revision AND resource.labels.service_name=smartped" --limit 50 --format "table(timestamp,textPayload)"
```

### Verificar status do serviço

```bash
gcloud run services describe smartped --region us-central1
```

### Listar revisões

```bash
gcloud run revisions list --service smartped --region us-central1
```

### Atualizar variáveis de ambiente

```bash
gcloud run services update smartped --region us-central1 --env-vars-file cloud-env.yaml
```

### Remover serviço

```bash
gcloud run services delete smartped --region us-central1
```

---

## Free Tier do Google Cloud Run

| Recurso | Limite Gratuito |
|---------|-----------------|
| Requests | 2 milhões/mês |
| vCPU-seconds | 360.000/mês |
| Memory-seconds | 180.000/mês |
| Invocações de background | 180.000/mês |
| Armazenamento | 1 GB (Cloud Storage) |

**Importante:** O free tier é suficiente para uso interno de uma farmácia ou rede pequena. Para alto volume de uso simultâneo, monitore o consumo no Console do GCP.

---

## Custos Estimados (Fora do Free Tier)

Se ultrapassar o free tier, os custos aproximados são:

| Componente | Custo |
|-----------|-------|
| vCPU | $0.00002400/vCPU-second |
| Memória | $0.00000250/GiB-second |
| Requests | $0.40/milhão de requests |
| Armazenamento | $0.026/GB/mês |

Para uma farmácia com uso moderado (algumas otimizações por dia), os custos ficam bem abaixo de R$ 10/mês.

---

## Solução de Problemas

### Erro: "Port 8080 was already in use"

O Cloud Run exige que a aplicação escute na porta definida pela variável `PORT`. O servidor já está configurado para isso em `server.ts`:

```typescript
const PORT = parseInt(process.env.PORT || '8080');
app.listen(PORT, '0.0.0.0');
```

### Erro: SIGSEGV (signal 11) do better-sqlite3

O `better-sqlite3` causa segmentation fault no Cloud Run. A solução é desabilitar o SQLite via variável de ambiente:

```dockerfile
ENV DISABLE_SQLITE=true
```

Quando desabilitado, o sistema funciona apenas com cache L1 (Map em memória). O SQLite é opcional para o funcionamento da aplicação.

### Erro: "Service Unavailable" (503)

Se o serviço retorna 503, verifique:
1. Se o container está crashando (SIGSEGV do better-sqlite3)
2. Se a memória é suficiente (recomendado: 1Gi)
3. Se o timeout é adequado (recomendado: 300s)

### Erro: "Build failed" com lockfile frozen

O erro `lockfile had changes, but lockfile is frozen` indica que o `package-lock.json` está desatualizado. Execute `npm install` localmente antes do deploy.

---

## Estado Atual do Deploy (2026-08-15)

| Item | Valor |
|------|-------|
| **Projeto GCP** | `gen-lang-client-0702342051` |
| **Serviço** | `smartped-cli` |
| **Região** | `us-east1` |
| **URL** | `https://smartped-cli-887122622666.us-east1.run.app` |
| **Memória** | 1Gi |
| **Timeout** | 300s |
| **NODE_ENV** | `production` |
| **DISABLE_SQLITE** | `true` |

### Configurações Importantes

- **SQLite Desabilitado:** O `better-sqlite3` causa SIGSEGV no Cloud Run. O sistema funciona apenas com cache L1 (Map em memória).
- **Dockerfile:** Single-stage build com `node:20` (não `-slim`), `npm rebuild better-sqlite3` para forçar compilação nativa.
- **Deduplicação:** Chave `${Ean}_${CodDist}_${Condicao}_${Prazo}` (sem preço).
- **Ordenação:** Resultados ordenados por `precoLiquido` ascendente.

### Erro: "Build failed"

Verifique se todos os testes passam localmente antes do deploy:

```bash
npm test
npm run build
```

### Erro: "Service Unavailable"

Verifique os logs para erros de inicialização:

```bash
gcloud logging read "resource.type=cloud_run_revision AND resource.labels.service_name=smartped" --limit 20
```

### SQLite perdendo dados

O armazenamento em `/tmp` é efêmero. Para dados críticos, considere migrar para Cloud SQL ou implementar backups periódicos.

---

## Referências

- [Documentação oficial do Cloud Run](https://cloud.google.com/run/docs)
- [Preços do Cloud Run](https://cloud.google.com/run/pricing)
- [Free Tier do GCP](https://cloud.google.com/free)
