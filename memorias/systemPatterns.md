# System Patterns — Arquitetura e Decisões Técnicas

## Estrutura
```
server.ts          — Ponto de entrada Express (rotas, bootstrap, jobs)
server/            — Módulos backend
  config.ts        — Config via .env
  cache.ts         — L1 (Map 2000 entradas) + L2 (Turso)
  database.ts      — Turso + fallback better-sqlite3 local
  parsers.ts       — classificarProduto(), mesmaApresentacao(), parseSmartPedEstoque()
  swap-engine.ts   — findBestSubstitute()
  smartped-api.ts  — fetchSimilarGenericsBatch()
  ean-utils.ts     — cleanEan(), EAN_DATABASE
  distributors.ts  — DISTRIBUIDORAS_MAP
swap-validation.ts — validateSwapEquivalence()
src/               — Frontend React
  App.tsx          — Orquestrador visual
  hooks/           — useAuth, useOptimizerConfig, useBilling, etc.
  components/      — SwapsTable, ConditionSelector, etc.
```

## Decisões Arquiteturais

### Turso em produção
- better-sqlite3 causa SIGSEGV no gVisor (Cloud Run)
- Turso (libSQL na nuvem) resolve — via @tursodatabase/serverless
- Fallback: better-sqlite3 local (dev)

### Cache L1+L2
- L1: Map em memória, 2000 entradas, TTL 5min
- L2: Turso/SQLite persistente, TTL 5min
- Escrita: sempre ambos. Leitura: L1 → L2

### Normalização de dados SmartPed
- API retorna PascalCase inconsistente (`PMC`/`pmc`/`Pmc`)
- Backend normaliza para lowercase antes de retornar ao frontend
- Banco Turso usa snake_case → normalizar com `rows.map()` em endpoints de leitura

### resolveDistName() — Resolução de distribuidoras
- Nome NÃO vem no objeto individual da oferta
- Cadeia de fallback: NomeDist → NomeDistribuidora → Nome_Dpe → Nome → DYNAMIC_CACHE → MAP → "Distribuidor X"
- isNotFoundName() é ÚNICA forma de checar nomes inválidos

### Versionsamento
- Formato: `vYYYY-MM-DD-HHmm` (fuso Panambi/UTC-3)
- Gerado no build por `vite.config.ts`
- NÃO usar `process.env.APP_VERSION`

## Zonas de Perigo
1. Manipulação de propriedades da API SmartPed (case-sensitivity)
2. Construção de strings SICF (parser do ERP)
3. Motor de trocas (findBestSubstitute)
4. Validação de equivalência (validateSwapEquivalence)
5. Filtro de EAN no dropdown de ruptura
