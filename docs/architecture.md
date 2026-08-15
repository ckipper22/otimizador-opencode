# Arquitetura e Mapeamento de Arquivos

O projeto utiliza um repositório modular (Express + React) com separação clara entre backend e frontend.

## Diretório Raiz
*   `server.ts`: **(CRÍTICO)** Ponto de entrada do servidor Express. Contém apenas as rotas de API e o bootstrap do servidor. Toda a lógica utilitária foi extraída para módulos em `server/`.
*   `swap-validation.ts`: Módulo de validação de similaridade e equivalência de trocas (`validateSwapEquivalence`, `areDosagesEqual`, `areFlavorsEqual`). Contém o dicionário estrito de termos sensíveis (sabores, fragrâncias, cores, dosagens e apresentações).
*   `backend-tests.ts`: Suíte autônoma de auto-testes bloqueantes (`runEngineSelfTests`). Valida 8 cenários mandatórios de troca. Se houver falha, encerra a execução com `process.exit(1)`, abortando o build de produção.

## Módulos Backend (`server/`)
*   `server/config.ts`: Configuração centralizada via `.env` (tokens, URLs, CNPJs).
*   `server/cache.ts`: Cache L1 (Map em memória, 2000 entradas) + L2 (SQLite persistente). TTL 5min para SmartPed. Hit L1 = rápido. Miss L1 = busca SQLite. Escrita = ambos. Purga automática no startup.
*   `server/rate-limiter.ts`: Middleware de rate limiting por IP (120 req/min).
*   `server/ean-utils.ts`: Limpeza de EANs, banco de dados local de EANs (`EAN_DATABASE`), carregamento a partir de arquivos SICF.
*   `server/smartped-api.ts`: Clientes de API externa (`fetchEanDescriptions`, `fetchSimilarGenerics`).
*   `server/parsers.ts`: Utilitários de parsing de texto/números (preço, PMC, dosagem, molécula, curingas, quantidade).
*   `server/distributors.ts`: Mapa de distribuidoras (`DISTRIBUIDORAS_MAP`).
*   `server/equivalents-db.ts`: Banco de dados local de equivalentes de mercado (cross-reference).
*   `server/swap-engine.ts`: Algoritmo core de seleção de melhor substituto (`findBestSubstitute`).
*   `server/smartped-transforms.ts`: Normalização de dados SmartPed (`enrichReturnedItem`, `parseSmartPedEstoque`).
*   `server/mock-data.ts`: Dados de simulação para testes offline.
*   `server/database.ts`: Persistência SQLite (orders, order_items, api_cache, faturados). Usa `/tmp` em produção (Cloud Run).

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
*   `SwapsTable.tsx`: A tabela densa de resultados. Exibe o que foi trocado (`De -> Para`), lucros e alertas de ruptura.
*   `OrderReturnView.tsx`, `PendingOrdersTable.tsx`: Interfaces para monitorar o status do pedido (Faturado, Falta, Erro) após o envio final para a SmartPed.
