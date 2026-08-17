<div align="center">

# OTIMIZADOR DE PEDIDOS SMARTPED

**Sistema de Otimização Financeira de Compras de Medicamentos**

[![TypeScript](https://img.shields.io/badge/TypeScript-5.3-blue.svg)](https://www.typescriptlang.org/)
[![React](https://img.shields.io/badge/React-19-61DAFB.svg)](https://react.dev/)
[![Vite](https://img.shields.io/badge/Vite-6-646CFF.svg)](https://vitejs.dev/)
[![Node.js](https://img.shields.io/badge/Node.js-20-339933.svg)](https://nodejs.org/)
[![Cloud Run](https://img.shields.io/badge/Google_Cloud_Run-Deployed-F9AB00.svg)](https://cloud.google.com/run)
[![Turso](https://img.shields.io/badge/Turso-Database-4FF8D2.svg)](https://turso.tech/)

</div>

---

## Visão Geral

O **Otimizador de Pedidos SmartPed** é uma ferramenta B2B que automatiza e otimiza financeiramente a compra de medicamentos para farmácias. O sistema conecta-se à API SmartPed para buscar preços em tempo real, sugerir substitutos inteligentes e gerar pedidos otimizados com economia comprovada.

### Fluxo Principal

```
┌─────────────┐     ┌──────────────┐     ┌─────────────┐     ┌──────────────┐
│  Upload SICF │ ──▶ │  SmartPed API │ ──▶ │  Motor de   │ ──▶ │  Faturamento │
│  (EANs)      │     │  (Preços)     │     │  Otimização │     │  Direto      │
└─────────────┘     └──────────────┘     └─────────────┘     └──────────────┘
```

### Capacidades Principais

- **Importação SICF:** Upload de arquivos SICF com lista de medicamentos desejados
- **Busca Inteligente:** Consulta paralela à API SmartPed (Condicoes/Ean + Condicoes/Molecula)
- **Motor de Troca:** Algoritmo que seleciona o melhor substituto por menor preço com estoque
- **Faturamento Direto:** Envio automático do pedido para a API SmartPed
- **Histórico:** Persistência de pedidos, faturados e itens confirmados via Turso
- **Cache Inteligente:** Sistema L1 (memória) + L2 (SQLite) com purga automática
- **Sync de Preços:** Sincronização automática diária às 10h com cache persistente
- **Análise de Retorno:** Monitoramento de status do pedido (Faturado, Falta, Erro)

---

## Stack Tecnológica

| Camada | Tecnologia | Versão |
|--------|------------|--------|
| Frontend | React + Tailwind CSS | 19 + v4 |
| Backend | Express.js | v4 |
| Linguagem | TypeScript | 5.3 |
| Build | Vite + esbuild | 6 |
| Cache L1 | Map (em memória) | - |
| Cache L2 | Turso (SQLite na nuvem) | - |
| Persistência | Turso / better-sqlite3 | - |
| APIs | SmartPed + Ferramentinhas | - |
| Deploy | Google Cloud Run | - |

---

## Arquitetura do Sistema

### Diretório de Arquivos

```
otimizador-de-pedidos-smartped/
├── server.ts                    # Ponto de entrada Express (rotas + bootstrap)
├── swap-validation.ts           # Validação de equivalência de trocas
├── backend-tests.ts             # Suíte de auto-testes bloqueantes
├── server/                      # Módulos backend
│   ├── config.ts                # Configuração via .env
│   ├── cache.ts                 # Cache L1+L2 (Map + SQLite)
│   ├── database.ts              # Persistência Turso/SQLite
│   ├── swap-engine.ts           # Motor de seleção de substitutos
│   ├── ean-utils.ts             # Utilitários de EAN
│   ├── parsers.ts               # Parsing de preços, dosagens, etc.
│   ├── distributors.ts          # Mapa de distribuidoras
│   ├── smartped-api.ts          # Clientes API externa
│   └── smartped-transforms.ts   # Normalização de dados SmartPed
├── src/                         # Frontend React
│   ├── App.tsx                  # Orquestrador visual principal
│   ├── types.ts                 # Interfaces TypeScript
│   ├── hooks/                   # Hooks customizados
│   │   ├── useOptimizationResult.ts
│   │   ├── useBilling.ts
│   │   ├── useDailyOrders.ts
│   │   └── useAuth.ts
│   └── components/              # Componentes UI
│       ├── SwapsTable.tsx       # Tabela de resultados
│       ├── ConditionSelector.tsx # Dropdown de alternativas
│       ├── UploadBox.tsx        # Zona de drag-and-drop
│       └── ...
├── docs/                        # Documentação
│   ├── architecture.md
│   ├── business-rules.md
│   ├── sensitive-points.md
│   └── testing.md
├── API_TREE_SMARTPED.md         # Endpoints SmartPed
├── API_TREE_TRIER.md            # Endpoints Trier (ERP)
├── LLM_CONTEXT.md               # Contexto para IA
├── AGENTS.md                    # Regras de operação
└── DEPLOY.md                    # Instruções de deploy
```

### Fluxo de Otimização

```
┌─────────────────────────────────────────────────────────────────┐
│                    FLUXO DE OTIMIZAÇÃO                           │
│                   endpoint /api/optimize                          │
├─────────────────────────────────────────────────────────────────┤
│                                                                  │
│  1. COTAÇÃO EM LOTE (todos os EANs do SICF)                     │
│     ├─ Condicoes/Ean (batch de 40, AceitaOntem=1)               │
│     └─ Condicoes/Molecula (batch de 40, ConsideraTipo=1)        │
│     → apiResponses[ean] = { ItemPedido, Substitutos[], Condicoes[] }│
│                                                                  │
│  2. CACHE INTELIGENTE (evita chamadas redundantes)              │
│     ├─ Consulta precos_cache antes de cada batch                │
│     ├─ Apenas EANs ausentes vão à API                           │
│     └─ Resultados são salvos para reuso futuro                  │
│                                                                  │
│  3. BUSCAS EXTRAS (conforme tipo de item)                       │
│     ├─ TARGET-EAN-PRE: consulta EANs alvo dos substitutos       │
│     ├─ RUPTURA-REGEX: busca por descrição (Produtos/Buscar)     │
│     │   └─ Consulta precos_cache primeiro, API apenas para     │
│     │      EANs ausentes                                        │
│     └─ Rebuild: substitutos, condicoes, stockMap                │
│                                                                  │
│  4. MOTOR DE TROCA (findBestSubstitute)                          │
│     ├─ Filtra por: estoque>0, preço>0, tipo, equivalência       │
│     ├─ Ordena por: isRealOffer DESC, preço ASC                  │
│     └─ Se ruptura: aceita qualquer preço com estoque            │
│                                                                  │
│  5. PÓS-MOTOR                                                    │
│     ├─ TARGET-EAN-API: enriquece substituto escolhido           │
│     ├─ Filtro do dropdown por tipo de item                      │
│     └─ Monta report com alternatives para o dropdown            │
│                                                                  │
└─────────────────────────────────────────────────────────────────┘
```

---

## Sistema de Cache

### Estrutura de Cache em Duas Camadas

| Camada | Armazenamento | TTL | Limite | Utilidade |
|--------|---------------|-----|--------|-----------|
| **L1** | Map (em memória) | 5 min | 2000 entradas | Resposta rápida para buscas repetidas |
| **L2** | Turso/SQLite | 5 min | - | Persistência entre reinicializações |
| **precos_cache** | Turso/SQLite | Diário | - | Preços das distribuidoras (purged às 10h) |
| **produtos_cache** | Turso/SQLite | Permanente | - | DCB, molécula, concentração |

### Fluxo de Cache

```
┌─────────────┐     ┌─────────────┐     ┌─────────────┐
│   Requisição │ ──▶ │  Cache L1   │ ──▶ │  Cache L2   │
│              │     │  (Map)      │     │  (SQLite)   │
└─────────────┘     └─────────────┘     └─────────────┘
       │                   │                   │
       │              HIT (rápido)         HIT (rápido)
       │                   │                   │
       │                   ▼                   ▼
       │              Retorna dados      Retorna dados
       │
       │              MISS
       │                   │
       ▼                   ▼
┌─────────────────────────────────────┐
│         API SmartPed                │
│  (Condicoes/Ean + Molecula)         │
└─────────────────────────────────────┘
       │
       ▼
┌─────────────────────────────────────┐
│    Salva em L1 + L2 + precos_cache  │
└─────────────────────────────────────┘
```

### Purge Diário do precos_cache

- **Horário:** 10:00 (junto com sync-prices)
- **Ação:** Deleta TODOS os registros do precos_cache
- **Repopulação:** sync-prices busca preços frescos da SmartPed
- **Efeito:** Garante que preços antigos não persistam mais de 24h

---

## Persistência (Turso)

### Tabelas do Banco de Dados

| Tabela | Propósito | Chave Primária | Purge |
|--------|-----------|----------------|-------|
| `orders` | Histórico de pedidos | autoincrement | 6 meses |
| `order_items` | Itens de cada pedido | autoincrement | 6 meses |
| `faturados` | Itens faturados do dia | ean+cod_dist+data | 6 meses |
| `itens_confirmados` | Itens com retorno finalizado | ean+cod_dist+data | 6 meses |
| `itens_manuais` | Itens adicionados manualmente | ean+cod_dist+data | 6 meses |
| `api_cache` | Cache L2 de respostas API | chave_cache | 10 min |
| `precos_cache` | Preços das distribuidoras | ean+cod_dist+condicao+prazo | Diário |
| `produtos_cache` | DCB/molécula/concentração | ean | Permanente |

### Fallback de Persistência

| Cenário | Comportamento |
|---------|---------------|
| Turso configurado e online | Usa Turso (L1 + L2 + persistência) |
| Turso não configurado | Usa better-sqlite3 local (dev) |
| better-sqlite3 falha (Cloud Run) | Sem persistência, só cache L1 |

---

## Endpoints da API

### Otimização

| Método | Endpoint | Descrição |
|--------|----------|-----------|
| `POST` | `/api/optimize` | Otimiza pedidos (fluxo principal) |
| `GET` | `/api/health` | Health check |

### Sync de Preços

| Método | Endpoint | Descrição |
|--------|----------|-----------|
| `POST` | `/api/sync-prices` | Inicia sync de preços |
| `GET` | `/api/sync-prices/status` | Status do sync em andamento |
| `GET` | `/api/precos-cache` | Lista preços cacheados |
| `GET` | `/api/precos-cache/:ean` | Busca preço por EAN |
| `GET` | `/api/precos-cache-stats` | Estatísticas do cache |

### Sync de Produtos

| Método | Endpoint | Descrição |
|--------|----------|-----------|
| `POST` | `/api/sync-produtos` | Sincroniza produtos (async) |
| `GET` | `/api/sync-status` | Status da sincronização |

### Pedidos

| Método | Endpoint | Descrição |
|--------|----------|-----------|
| `POST` | `/api/pedidos-do-dia` | Lista pedidos do dia |
| `POST` | `/api/faturar` | Fatura pedido na SmartPed |
| `POST` | `/api/itens-confirmados-do-dia` | Itens faturados/confirmados |
| `POST` | `/api/itens-manuais` | Itens manuais |

### Busca

| Método | Endpoint | Descrição |
|--------|----------|-----------|
| `POST` | `/api/search-products` | Busca produtos na SmartPed |
| `POST` | `/api/smartped-find-substitutes` | Busca substitutos inteligente |
| `GET` | `/api/similares/:ean` | Busca similares no Trier (ERP) |

---

## Variáveis de Ambiente

### SmartPed API

| Variável | Descrição | Obrigatória |
|----------|-----------|-------------|
| `SMARTPED_PRODUCTION_TOKEN` | Token API SmartPed produção | Sim |
| `SMARTPED_SANDBOX_TOKEN` | Token API SmartPed sandbox | Não |
| `SMARTPED_DEFAULT_CNPJ` | CNPJ default para chamadas | Sim |
| `SMARTPED_PRODUCTION_URL` | URL base produção | Não (default: api.smartped.com.br) |
| `SMARTPED_SANDBOX_URL` | URL base sandbox | Não (default: apitest.smartped.com.br) |

### Banco de Dados

| Variável | Descrição | Obrigatória |
|----------|-----------|-------------|
| `TURSO_DATABASE_URL` | URL do banco Turso | Sim (produção) |
| `TURSO_AUTH_TOKEN` | Token de autenticação Turso | Sim (produção) |

### Aplicação

| Variável | Descrição | Obrigatória |
|----------|-----------|-------------|
| `APP_ADMIN_EMAILS` | E-mails admin (separados por vírgula) | Não |
| `APP_ADMIN_PASSWORD` | Senha admin | Não |
| `FERRAMENTINHAS_API_URL` | URL API Ferramentinhas | Não |

---

## Comandos de Execução

### Desenvolvimento

```bash
# Instalar dependências
npm install

# Iniciar servidor de desenvolvimento
npm run dev

# Build para produção
npm run build

# Executar em produção (build prévio necessário)
npm run start

# Verificar tipos
npm run lint
```

### Git

```bash
# Ver alterações pendentes
git status

# Ver diff das alterações
git diff

# Ver últimos 10 commits
git log --oneline -10

# Criar branch de backup
git checkout -b backup/nome

# Commit das alterações
git add -A && git commit -m "msg"

# Push para GitHub
git push origin master
```

### Google Cloud CLI

```powershell
# Path do gcloud no Windows
$gcloud = "C:\Users\carlo\AppData\Local\Google\Cloud SDK\google-cloud-sdk\bin\gcloud.cmd"

# Deploy com variáveis Turso
$envFile = Get-Content .env
$tursoUrl = ($envFile | Select-String "TURSO_DATABASE_URL=").ToString().Split("=",2)[1]
$tursoToken = ($envFile | Select-String "TURSO_AUTH_TOKEN=").ToString().Split("=",2)[1]
& "$gcloud" run deploy smartped-cli --source . --region us-east1 --project gen-lang-client-0702342051 --set-env-vars="TURSO_DATABASE_URL=$tursoUrl,TURSO_AUTH_TOKEN=$tursoToken"

# Ver logs (últimas 20 entradas)
& "$gcloud" logging read "resource.type=cloud_run_revision AND resource.labels.service_name=smartped-cli" --limit 20 --project gen-lang-client-0702342051 --format="text(timestamp,textPayload)"

# Logs frescos (últimos 2min)
& "$gcloud" logging read "resource.type=cloud_run_revision AND resource.labels.service_name=smartped-cli" --limit 20 --project gen-lang-client-0702342051 --format="text(timestamp,textPayload)" --freshness=2m
```

---

## Deploy no Google Cloud Run

### Pré-requisitos

- Conta Google com billing habilitado
- Google Cloud CLI (`gcloud`) instalado
- Node.js 20+ instalado

### Deploy Direto

```bash
gcloud run deploy smartped-cli \
  --source . \
  --region us-east1 \
  --allow-unauthenticated \
  --port 8080 \
  --memory 1Gi
```

### Configurações Atuais

| Item | Valor |
|------|-------|
| **Projeto GCP** | `gen-lang-client-0702342051` |
| **Serviço** | `smartped-cli` |
| **Região** | `us-east1` |
| **URL** | `https://smartped-cli-887122622666.us-east1.run.app` |
| **Memória** | 1Gi |
| **Timeout** | 300s |

### Free Tier

| Recurso | Limite Gratuito |
|---------|-----------------|
| Requests | 2 milhões/mês |
| vCPU-seconds | 360.000/mês |
| Memory-seconds | 180.000/mês |

---

## Funcionalidades Detalhadas

### 1. Upload SICF

- Suporte a drag-and-drop ou seleção de arquivo
- Parsing automático de EANs, quantidades e códigos
- Validação de formato SICF

### 2. Busca de Preços

- Consulta paralela em lotes de 40 EANs
- Endpoints: `Condicoes/Ean` + `Condicoes/Molecula`
- Enriquecimento com dados de estoque e condições comerciais
- Cache inteligente para evitar chamadas redundantes

### 3. Motor de Otimização

- Algoritmo de seleção do melhor substituto
- Considera: preço, estoque, tipo do item, equivalência terapêutica
- Trata separadamente: genéricos, éticos, similares, referência
- Suporte a ruptura de estoque (substituição automática)

### 4. Faturamento

- Envio direto para a API SmartPed
- Polling de status (Faturado, Falta, Erro)
- Exportação de relatórios

### 5. Análise de Retorno

- Histórico de pedidos faturados
- Itens confirmados vs pendentes
- Alertas de mínimo comercial e quantities

---

## Segurança e LGPD

- **Mascaramento de dados:** CNPJ e token mascarados em logs
- **Credenciais:** Nunca em texto claro, apenas via variáveis de ambiente
- **Retenção:** Cache purge automático (10 min), dados permanentes com purge de 6 meses
- **Acesso:** Sistema B2B interno (compradores de drogarias)

---

## Solução de Problemas

### Erro: Port 8080 already in use

```bash
# Matar processos node na porta 3000
Get-Process -Name "node" | Stop-Process -Force
```

### Erro: SIGSEGV do better-sqlite3

O `better-sqlite3` causa segmentation fault no Cloud Run. Solução: usar Turso em produção.

### Erro: Build failed

```bash
# Verificar se testes passam
npm test

# Reinstalar dependências
rm -rf node_modules
npm install
```

---

## Documentação Adicional

| Arquivo | Conteúdo |
|---------|----------|
| [DEPLOY.md](DEPLOY.md) | Instruções detalhadas de deploy |
| [docs/architecture.md](docs/architecture.md) | Mapeamento de arquivos e módulos |
| [docs/business-rules.md](docs/business-rules.md) | Regras de negócio e fluxos |
| [docs/sensitive-points.md](docs/sensitive-points.md) | Zonas de perigo e débitos técnicos |
| [docs/testing.md](docs/testing.md) | Massa de testes e diagnósticos |
| [API_TREE_SMARTPED.md](API_TREE_SMARTPED.md) | Endpoints SmartPed documentados |
| [API_TREE_TRIER.md](API_TREE_TRIER.md) | Endpoints Trier (ERP) |
| [LLM_CONTEXT.md](LLM_CONTEXT.md) | Contexto para assistentes IA |
| [AGENTS.md](AGENTS.md) | Regras permanentes de operação |

---

## Licença

Uso interno - Sistema proprietário para otimização de compras de farmácias.

---

<div align="center">

**Desenvolvido com dedicação para otimizar compras de medicamentos**

</div>
