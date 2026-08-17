# Arquitetura e Mapeamento de Arquivos

O projeto utiliza um repositório modular (Express + React) com separação clara entre backend e frontend.

## Diretório Raiz
*   `server.ts`: **(CRÍTICO)** Ponto de entrada do servidor Express. Contém rotas de API, bootstrap do servidor, jobs automáticos (sync-prices às 10h), endpoints de cache de preços e otimização. Toda a lógica utilitária foi extraída para módulos em `server/`.
*   `swap-validation.ts`: Módulo de validação de similaridade e equivalência de trocas (`validateSwapEquivalence`, `areDosagesEqual`, `areFlavorsEqual`). Contém o dicionário estrito de termos sensíveis (sabores, fragrâncias, cores, dosagens e apresentações).
*   `backend-tests.ts`: Suíte autônoma de auto-testes bloqueantes (`runEngineSelfTests`). Valida 8 cenários mandatórios de troca. Se houver falha, encerra a execução com `process.exit(1)`, abortando o build de produção.

## Módulos Backend (`server/`)
*   `server/config.ts`: Configuração centralizada via `.env` (tokens, URLs, CNPJs).
*   `server/cache.ts`: Cache L1 (Map em memória, 2000 entradas) + L2 (SQLite persistente). TTL 5min para SmartPed. Hit L1 = rápido. Miss L1 = busca SQLite. Escrita = ambos. Purga automática no startup.
*   `server/database.ts`: **Persistência Turso (SQLite na nuvem)** com fallback better-sqlite3 local. Tabelas: `orders`, `order_items`, `api_cache`, `faturados`, `itens_confirmados`, `itens_manuais`, `precos_cache`, `produtos_cache`. Purge automática de 6 meses. **Novo:** `purgePrecosCache()` para purge diário, `savePrecosCacheBatch()` para salvar preços em lote, `getPrecoCacheByEans()` para busca em lote.
*   `server/rate-limiter.ts`: Middleware de rate limiting por IP (120 req/min).
*   `server/ean-utils.ts`: Limpeza de EANs, banco de dados local de EANs (`EAN_DATABASE`), carregamento a partir de arquivos SICF.
*   `server/smartped-api.ts`: Clientes de API externa (`fetchEanDescriptions`, `fetchSimilarGenerics`).
*   `server/parsers.ts`: Utilitários de parsing de texto/números (preço, PMC, dosagem, molécula, curingas, quantidade).
*   `server/distributors.ts`: Mapa de distribuidoras (`DISTRIBUIDORAS_MAP`).
*   `server/equivalents-db.ts`: Banco de dados local de equivalentes de mercado (cross-reference).
*   `server/swap-engine.ts`: Algoritmo core de seleção de melhor substituto (`findBestSubstitute`).
*   `server/smartped-transforms.ts`: Normalização de dados SmartPed (`enrichReturnedItem`, `parseSmartPedEstoque`).
*   `server/mock-data.ts`: Dados de simulação para testes offline.

## Frontend (`src/`)
*   `App.tsx`: Orquestrador visual. Controla guias de navegação (Otimização, Retornos, Itens do Dia), exibe os relatórios gerados e os modais. Reduzido de 5409 para ~2890 linhas via extração de hooks.
*   `types.ts`: Contratos e interfaces (TypeScript). Ponto único da verdade das estruturas de dados (`SwapReportItem`, `OptimizerConfig`, `DistributorOption`).
*   `utils.ts`: Utilitários isolados (ex: `formatCurrency`) e strings de arquivos SICF de teste (ex: `SAMPLE_SICF_FILE`).

### Hooks Customizados (`src/hooks/`)
*   `useAuth.ts`: Autenticação (login, Google auth, logout, authorizedCompanies).
*   `useOptimizerConfig.ts`: Configuração do otimizador (config, distribuidoras, status backend).
*   `useDailyOrders.ts`: Pedidos do dia e consulta direta de retorno.
*   `useOptimizationResult.ts`: Resultado da otimização (file handling, report, economia, interceptação de quantidades).
*   `useBilling.ts`: Ciclo de vida do faturamento (envio, polling de retornos, faltas, exportação).
*   `useManualSearch.ts`: Cockpit de busca manual de produtos.
*   `useDistributorWizards.ts`: Assistentes de dispersão/completar pedido e mínimos de distribuidora.
*   `useOfferTableColumns.ts`: Configuração de colunas da tabela de ofertas (visibilidade, larguras, resize).

### Componentes Principais (`src/components/`)
*   `UploadBox.tsx`: Zona de *drag-and-drop*. Nele também são listadas as **Distribuidoras Disponíveis** onde o usuário pode desmarcar (fazer *opt-out*) distribuidores indesejados antes da otimização.
*   `ConfigurationPanel.tsx`: Painel de ajustes finos (Token da API, CNPJ, Valor de Economia Mínima, URLs Customizadas).
*   `SwapsTable.tsx`: A tabela densa de resultados. Exibe o que foi trocado (`De -> Para`), lucros e alertas de ruptura. Coluna "De (Produto Original)" mostra substituto com fundo vermelho quando `isRupturaSubstitution`; botão 🔔 abre detalhes do original em ruptura.
*   `OrderReturnView.tsx`, `PendingOrdersTable.tsx`: Interfaces para monitorar o status do pedido (Faturado, Falta, Erro) após o envio final para a SmartPed.
*   `ConditionSelector.tsx`: **Dropdown de alternativas de compra** com badge de condição atual. Recebe `item.alternatives` do backend. **Novo:** Badge azul mostra ★ Atual com distribuidora, preço, condição e EAN. Dropdown lista apenas alternativas para trocar (não inclui opção já escolhida). Suporta PascalCase do SmartPed via `getAlt()` helper.
*   `SimilarProductsModal.tsx` (`/api/similares/:ean`): Busca **local no Trier** (ERP), não SmartPed. Mostra estoque físico de prateleira. Independente do fluxo de cotação.
*   `InterchangeabilityModal.tsx`: Validação de intercambialidade ANVISA (mesmo princípio ativo, dosagem, forma farmacêutica).
*   `ObservationBell.tsx`: Botão 🔔 que expande detalhes do original em ruptura (`originalRupturaEan`, `originalRupturaDescricao`, `originalRupturaLaboratorio`, `originalRupturaPreco`).
*   `ConfirmQuantitiesModal.tsx`: Confirmação de quantidades antes do faturamento.
*   `OptimizationSummary.tsx`: Cards de economia total, itens otimizados, alertas.
*   `FaturadosModal.tsx`: Histórico de itens faturados do dia.
*   `BillingLogsModal.tsx`: Logs de envio/retorno do faturamento.
*   `VisualChart.tsx`: Gráfico de economia por distribuidora/laboratório.
*   `EanEyeButton.tsx`: Botão de busca manual (abre SimilarProductsModal).
*   `WhatsAppOrderModal.tsx`: Compartilhamento de pedido via WhatsApp.

## Endpoints Principais (`server.ts`)

### Otimização
*   `POST /api/optimize` — Fluxo principal de otimização (cache L1+L2, paralelismo, RUPTURA-REGEX com cache)
*   `GET /api/health` — Health check

### Sync de Preços
*   `POST /api/sync-prices` — Inicia sync de preços (async)
*   `GET /api/sync-prices/status` — Status e logs do sync
*   `GET /api/precos-cache` — Lista preços cacheados
*   `GET /api/precos-cache/:ean` — Busca preço por EAN
*   `GET /api/precos-cache-stats` — Estatísticas (count, lastSync)

### Sync de Produtos
*   `POST /api/sync-produtos` — Sincroniza produtos (async, background)
*   `GET /api/sync-status` — Status da sincronização

### Jobs Automáticos
*   **Sync-prices às 10h:** `checkAndRunPriceSync()` roda a cada 60s, dispara às 10:00. Fluxo: purge precos_cache → busca Sugestoes → preenche cache.

## Fluxo de Cache de Preços

```
precos_cache (Turso/SQLite)
├── Populado por: sync-prices (10h) + RUPTURA-REGEX (durante otimização)
├── Purge: diário às 10h antes do sync
├── Chave: ean + cod_dist + condicao + prazo
└── Campos: preco_liquido, estoque, nome_dist, qtd_min, tipo_item
```

