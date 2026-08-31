# Mapa do Sistema — Visão Arquitetural

> Documento vivo, mesmo padrão de manutenção do AGENTS.md e `docs/arvore-decisoes-busca-api.md`.
> **NÃO duplicar conteúdo** — em AGENTS.md e arvore-decisoes, só adicionar ponteiros pra cá.

---

## 1. Visão Geral dos 3 Sistemas

```
┌──────────────────────────────────────────────────────────────────────┐
│                        ECOSSISTEMA FARMÁCIA                          │
├──────────────────────────────────────────────────────────────────────┤
│                                                                      │
│  ┌─────────────────┐    REST     ┌─────────────────────┐            │
│  │   OTIMIZADOR     │◄──────────►│    ENCOMENDAS        │            │
│  │  (este projeto)  │  proxy     │   (IA Estúdio)       │            │
│  │  Express+React   │  x-api-key │   Cloud Run separado │            │
│  │  Turso (banco)   │            │                      │            │
│  └────────┬────────┘            └─────────────────────┘            │
│           │                                                          │
│           │ API REST (_token próprio)                                │
│           ▼                                                          │
│  ┌─────────────────┐            ┌─────────────────────┐            │
│  │    SMARTPED      │            │  CHATBOT WHATSAPP    │            │
│  │  (distribuidores)│            │   (SAAS do Carlos)   │            │
│  │  Preços/Estoque  │            │   Farmácias clientes │            │
│  └─────────────────┘            └──────────┬──────────┘            │
│                                             │                       │
│                                    POST /api/external-suppliers      │
│                                    (escreve no Turso compartilhado)  │
│                                             ▼                       │
│                                   ┌─────────────────┐              │
│                                   │  Turso (banco)   │              │
│                                   │ external_suppliers│              │
│                                   └─────────────────┘              │
└──────────────────────────────────────────────────────────────────────┘
```

### Otimizador (este projeto)

- **Stack:** Express + React (Vite) + Turso (SQLite serverless)
- **Função:** Compara preços entre distribuidores SmartPed, sugere trocas, otimiza pedidos de farmácia
- **Deploy:** Cloud Run (`smartped-cli-*`), build via esbuild → `dist/server.cjs`
- **Banco:** Turso (`TURSO_DATABASE_URL` / `TURSO_AUTH_TOKEN`), fallback better-sqlite3 em dev

### Fallback de Persistência

| Cenário | Comportamento |
|---------|---------------|
| Turso configurado e online | Usa Turso (L1 + L2 + persistência) |
| Turso não configurado | Usa better-sqlite3 local (dev) |
| better-sqlite3 falha (Cloud Run/gVisor) | Sem persistência, só cache L1 |
| **Turso configurado mas offline** | **Sem persistência** (catch silencioso, sem fallback automático para better-sqlite3) |

**⚠️ No Cloud Run**, better-sqlite3 causa SIGSEGV (gVisor). Se o Turso ficar offline, o sistema funciona apenas com cache L1 (memória). Pedidos e histórico serão perdidos até o Turso voltar.

### Encomendas (IA Estúdio)

- **Stack:** Cloud Run separado (`encomenda-com-smartped-887122622666.us-east1.run.app`)
- **Função:** Registra encomendas do balcão de farmácia (cliente pede, balcão cadastra)
- **Comunicação:** REST, autenticado via `x-api-key`
- **Este projeto atua como PROXY:** recebe requisição do frontend sem token, injeta `x-api-key` (`ENCOMENDAS_INTEGRATION_KEY`) antes de repassar. Nunca expõe a chave ao frontend.
- **Detalhes:** `docs/encomendas-integracao.md`

### Chatbot WhatsApp SaaS

- **Stack:** Projeto separado do Carlos (não é este repo)
- **Função:** Chatbot SAAS pra farmácias clientes — pedidos via WhatsApp
- **Conexão com este projeto:** Escreve na tabela `external_suppliers` no Turso (listas de preço de fornecedores externos)
- **Pergunta em aberto:** Não está confirmado SE o chatbot escreve via HTTP no endpoint `POST /api/external-suppliers` (server.ts:441) ou se escreve direto no Turso compartilhado (ambos usariam a mesma `TURSO_DATABASE_URL`). Carlos pode confirmar numa conversa futura.
- **Detalhes:** `AGENTS.md` seção "Fornecedores Externos — Schema e Integração"

---

## 2. APIs Externas Consumidas

### SmartPed (distribuidores de medicamentos)

- **Base URL:** `https://api.smartped.com.br` (configurável via `SMARTPED_API_URL`)
- **Auth:** Token via `SMARTPED_PRODUCTION_TOKEN`
- **Endpoints principais:** `Condicoes/Ean`, `Condicoes/Molecula`, `Produtos/Buscar`, `Pedido/Envio`, `Pedido/Retorno`
- **Documentação completa:** `docs/API_TREE_SMARTPED.md` (1307 linhas, schemas completos de 18 endpoints)
- **Regra crítica:** `Condicoes/Ean` + `Condicoes/Molecula` SEMPRE em paralelo (`Promise.all`). QtdMin vem do Molecula.

### Trier / Ferramentinhas (ERP local da farmácia)

- **Base URL:** `CONFIG.FERRAMENTINHAS_API_URL` (configurável)
- **Auth:** Token interno da Ferramentinhas
- **Endpoints principais:** `similares/{ean}`, `vendas-detalhadas/{ean}`, `buscar-lote`, `compras-historico/{ean}`, `similares/batch`
- **Documentação completa:** `docs/API_TREE_TRIER.md` (742 linhas, schemas completos de 7 endpoints Ferramentinhas + catálogo SGF)
- **Nota sobre o prefixo `/api/chatbot/...`:** Endpoints como `/api/chatbot/produto/vendas-resumo/{ean}` e `/api/chatbot/produto/vendas-detalhadas/{ean}` são rotas do BACKEND TRIER/FERRAMENTINHAS, não deste projeto nem do Chatbot SaaS. O nome "chatbot" é só convenção de rota da Trier. Confirmado via leitura do código: todas as 4 ocorrências de "chatbot" em server.ts (linhas 2699, 2733, 9815, 9831) são chamadas `fetch()` de saída pra API externa, não rotas Express deste projeto.

---

## 3. Banco de Dados (Turso) — Inventário Completo

> Schema definido em `server/database.ts`. 11 tabelas + 1 tabela sem CREATE TABLE (`sugestoes_eans`).

### `orders`

| Coluna | Tipo | Constraints |
|--------|------|-------------|
| `id` | INTEGER | PRIMARY KEY AUTOINCREMENT |
| `num_pedido` | TEXT | UNIQUE |
| `cnpj` | TEXT | |
| `data_pedido` | TEXT | |
| `status` | TEXT | DEFAULT 'pending' |
| `payload_json` | TEXT | |
| `response_json` | TEXT | |
| `created_at` | TEXT | DEFAULT datetime('now') |
| `updated_at` | TEXT | DEFAULT datetime('now') |

- **Propósito:** Pedidos enviados à SmartPed (pre-pedido + retorno)
- **Quem escreve:** `saveOrder` (database.ts:279), `updateOrderResponse` (database.ts:289)
- **Quem lê:** `getOrder` (database.ts:299)
- **Purge:** `purgeOldData` (database.ts:601) — DELETE WHERE created_at < ?
- **Índices:** `idx_orders_cnpj`, `idx_orders_data`

### `order_items`

| Coluna | Tipo | Constraints |
|--------|------|-------------|
| `id` | INTEGER | PRIMARY KEY AUTOINCREMENT |
| `num_pedido` | TEXT | FOREIGN KEY → orders(num_pedido) |
| `ean` | TEXT | |
| `descricao` | TEXT | |
| `laboratorio` | TEXT | |
| `cod_dist` | INTEGER | |
| `nome_dist` | TEXT | |
| `qtd` | INTEGER | |
| `preco_liquido` | REAL | |
| `preco_original` | REAL | |
| `economia` | REAL | |
| `is_swap` | INTEGER | DEFAULT 0 |
| `origem` | TEXT | DEFAULT 'manual' |
| `id_encomenda` | TEXT | |
| `created_at` | TEXT | DEFAULT datetime('now') |

- **Propósito:** Itens de cada pedido SmartPed
- **Quem escreve:** `saveOrderItem` (database.ts:320)
- **Quem lê:** `getOrderItems` (database.ts:335) — exportado mas NÃO importado por server.ts
- **Purge:** `purgeOldData` (database.ts:601)
- **Colunas `origem`/`id_encomenda`:** Adicionadas via migração (bug #27, corrigido). `origem` rastreia se item veio de encomenda vs. fluxo manual.

### `api_cache`

| Coluna | Tipo | Constraints |
|--------|------|-------------|
| `cache_key` | TEXT | PRIMARY KEY |
| `data_json` | TEXT | |
| `created_at` | TEXT | DEFAULT datetime('now') |
| `expires_at` | TEXT | |

- **Propósito:** Cache de respostas de APIs externas (SmartPed, Ferramentinhas)
- **Quem escreve:** `setCache` (database.ts:346) — via `server/cache.ts`
- **Quem lê:** `getCache` (database.ts:357), `getCacheBatch` (database.ts:374)
- **Purge:** `purgeExpiredCache` (database.ts:398) — DELETE WHERE expires_at < now

### `faturados`

| Coluna | Tipo | Constraints |
|--------|------|-------------|
| `id` | INTEGER | PRIMARY KEY AUTOINCREMENT |
| `num_pedido` | TEXT | |
| `ean` | TEXT | |
| `descricao` | TEXT | |
| `laboratorio` | TEXT | |
| `cod_dist` | INTEGER | |
| `nome_dist` | TEXT | |
| `qtd` | INTEGER | |
| `preco_liquido` | REAL | |
| `created_at` | TEXT | DEFAULT datetime('now') |

- **Propósito:** Registro de itens faturados
- **Quem escreve:** `saveFaturado` (database.ts:412) — **DEFINIDA MAS NUNCA CHAMADA** (código morto)
- **Quem lê:** `getFaturados` (database.ts:425) — também nunca chamado
- **Purge:** `purgeOldData` (database.ts:601)
- **⚠️ Código morto:** A tabela existe e é purgada, mas `saveFaturado`/`getFaturados` não são importados por server.ts. O sistema migrou pra `itens_confirmados`. Investigar antes de assumir que é integração ativa.

### `itens_confirmados`

| Coluna | Tipo | Constraints |
|--------|------|-------------|
| `id` | INTEGER | PRIMARY KEY AUTOINCREMENT |
| `num_pedido` | TEXT | |
| `ean` | TEXT | |
| `descricao` | TEXT | |
| `laboratorio` | TEXT | |
| `cod_dist` | INTEGER | |
| `nome_dist` | TEXT | |
| `qtd_solicitada` | INTEGER | |
| `qtd_faturada` | INTEGER | |
| `preco_liquido` | REAL | |
| `status` | TEXT | |
| `motivo` | TEXT | |
| `cnpj` | TEXT | |
| `data_confirmacao` | TEXT | |
| `origem` | TEXT | DEFAULT 'manual' |
| `id_encomenda` | TEXT | |
| `created_at` | TEXT | DEFAULT datetime('now') |
| `updated_at` | TEXT | DEFAULT datetime('now') |

- **UNIQUE:** `(num_pedido, ean, cod_dist)`
- **Propósito:** Histórico de itens confirmados/faturados no retorno SmartPed
- **Quem escreve:** `saveItemConfirmado` (database.ts:436), `saveItensConfirmadosBatch` (database.ts:456)
- **Quem escreve (via server.ts):** `/api/pedido-retorno` (server.ts:~7508, ~7796) — salva itens no momento real do faturamento
- **Quem lê:** `getItensConfirmados` (database.ts:486), `getProfarmaFaturadosPendentes` (database.ts:513)
- **Purge:** `purgeOldData` (database.ts:601)
- **⚠️ Não é webhook externo:** O Profarma entra como resposta da API SmartPed, que este servidor então persiste. Não confundir "dado que veio de um distribuidor terceiro" com "distribuidor terceiro escreve no nosso banco".
- **Colunas `origem`/`id_encomenda`:** Presentes no CREATE TABLE e nas migrações (bug #27 corrigido).

### `itens_manuais`

| Coluna | Tipo | Constraints |
|--------|------|-------------|
| `id` | INTEGER | PRIMARY KEY AUTOINCREMENT |
| `cod_interno` | TEXT | UNIQUE |
| `ean` | TEXT | |
| `descricao` | TEXT | |
| `laboratorio` | TEXT | |
| `distribuidora` | TEXT | |
| `cod_dist` | INTEGER | |
| `qtd` | INTEGER | |
| `preco_liquido` | REAL | |
| `preco_fabrica` | REAL | |
| `condicao` | TEXT | |
| `prazo` | INTEGER | |
| `cnpj` | TEXT | |
| `status` | TEXT | DEFAULT 'adicionado' |
| `data_adicao` | TEXT | |
| `created_at` | TEXT | DEFAULT datetime('now') |
| `updated_at` | TEXT | DEFAULT datetime('now') |
| `origem` | TEXT | DEFAULT 'manual' |
| `id_encomenda` | TEXT | |

- **Propósito:** Itens adicionados manualmente (botão "+") ou importados de encomendas
- **Quem escreve:** `saveItemManual` (database.ts:539), `deleteItemManual` (database.ts:564)
- **Quem lê:** `getIten sManuais` (database.ts:576)
- **Purge:** `purgeOldData` (database.ts:601)
- **Índices:** `idx_itens_manuais_cnpj`, `idx_itens_manuais_data`, `idx_itens_manuais_status`
- **Colunas `origem`/`id_encomenda`:** Presentes no CREATE TABLE e nas migrações (bug #27 corrigido).

### `precos_cache`

| Coluna | Tipo | Constraints |
|--------|------|-------------|
| `ean` | TEXT | PRIMARY KEY (composite) |
| `cod_dist` | INTEGER | PRIMARY KEY (composite) |
| `condicao` | TEXT | PRIMARY KEY (composite) |
| `prazo` | INTEGER | PRIMARY KEY (composite) |
| `preco_liquido` | REAL | |
| `estoque` | INTEGER | |
| `nome_dist` | TEXT | |
| `qtd_min` | INTEGER | DEFAULT 0 |
| `tipo_item` | TEXT | |
| `ultima_atualizacao` | TEXT | DEFAULT datetime('now') |

- **Propósito:** Cache permanente de preços SmartPed por EAN+distribuidor+condição+prazo
- **Quem escreve:** `savePrecosCacheBatch` (database.ts:677)
- **Quem lê:** `getPrecoCacheByEan` (database.ts:702), `getPrecoCacheByEans` (database.ts:712), `listPrecosCache` (database.ts:730)
- **Purge:** `purgePrecosCache` (database.ts:751) — DELETE ALL (limpeza manual)

### `produtos_cache`

| Coluna | Tipo | Constraints |
|--------|------|-------------|
| `ean` | TEXT | PRIMARY KEY |
| `descricao` | TEXT | |
| `laboratorio` | TEXT | |
| `dcb` | TEXT | |
| `molecula` | TEXT | |
| `concentracao` | TEXT | |
| `apresentacao` | TEXT | |
| `tipo_item` | TEXT | |
| `ultima_atualizacao` | TEXT | DEFAULT datetime('now') |

- **Propósito:** Cache de dados mestre de produtos (DCB, molécula, concentração)
- **Quem escreve:** `saveProdutoCache` (database.ts:650)
- **Quem lê:** `countProdutosCache` (database.ts:665)

### `pedidos_whatsapp`

| Coluna | Tipo | Constraints |
|--------|------|-------------|
| `id` | INTEGER | PRIMARY KEY AUTOINCREMENT |
| `data_pedido` | TEXT | |
| `fornecedor` | TEXT | |
| `telefone` | TEXT | |
| `itens` | TEXT | |
| `status` | TEXT | DEFAULT 'Pendente' |
| `observacao` | TEXT | |
| `origem` | TEXT | DEFAULT 'lista' |
| `cnpj` | TEXT | |
| `created_at` | TEXT | DEFAULT datetime('now') |
| `updated_at` | TEXT | DEFAULT datetime('now') |

- **Propósito:** Pedidos manuais via WhatsApp (regra de laboratório — comprador manda mensagem manual pra representante)
- **⚠️ NÃO tem relação com o Chatbot SaaS:** Esta é uma feature INTERNA deste projeto. Dois conceitos de "WhatsApp" diferentes no mesmo projeto — não confundir.
- **Quem escreve:** `savePedidoWhatsApp` (database.ts:812), `updatePedidoWhatsAppStatus` (database.ts:837), `deletePedidoWhatsApp` (database.ts:847)
- **Quem lê:** `getPedidosWhatsApp` (database.ts:827)
- **Purge:** `purgeOldData` (database.ts:601)

### `whatsapp_rules`

| Coluna | Tipo | Constraints |
|--------|------|-------------|
| `id` | TEXT | PRIMARY KEY |
| `nome_regra` | TEXT | |
| `termo_filtro` | TEXT | |
| `nome_representante` | TEXT | |
| `telefone` | TEXT | |
| `tipo_filtro` | TEXT | DEFAULT 'todos' |
| `ocultar_precos` | INTEGER | DEFAULT 0 |
| `ativo` | INTEGER | DEFAULT 1 |
| `cnpj` | TEXT | |
| `created_at` | TEXT | DEFAULT datetime('now') |
| `updated_at` | TEXT | DEFAULT datetime('now') |

- **Propósito:** Regras de laboratório (comprador seleciona representante por filtro de produto)
- **⚠️ NÃO tem relação com o Chatbot SaaS:** Feature interna, mesmo aviso da tabela anterior.
- **Quem escreve:** `saveWhatsAppRule` (database.ts:857), `deleteWhatsAppRule` (database.ts:882)
- **Quem lê:** `getWhatsAppRules` (database.ts:872)

### `whatsapp_envios_lab`

| Coluna | Tipo | Constraints |
|--------|------|-------------|
| `ean` | TEXT | NOT NULL |
| `regra_id` | TEXT | NOT NULL |
| `cnpj` | TEXT | NOT NULL |
| `data_envio` | TEXT | DEFAULT datetime('now') |

- **UNIQUE/PRIMARY KEY:** `(ean, regra_id)`
- **Propósito:** Registro de envio de mensagem de WhatsApp lab (feita no handleCopy do WhatsAppOrderModal). Usado pra checar se o item chegou (via compras-historico) antes de permitir recompra.
- **⚠️ Feature nova (2026-08-31):** B.2 (checagem de liberação) e B.3 (alerta visual) ainda não implementados — só o registro está ativo.
- **Quem escreve:** `saveWhatsAppEnvioLab` (database.ts), endpoint `POST /api/whatsapp-rules/registrar-envio`
- **Quem lê:** `getWhatsAppEnviosLabPendentes` (database.ts), endpoint `GET /api/whatsapp-rules/envios-pendentes`

### `external_suppliers`

| Coluna | Tipo | Constraints |
|--------|------|-------------|
| `id` | TEXT | PRIMARY KEY |
| `name` | TEXT | |
| `raw_text` | TEXT | |
| `validade` | TEXT | |
| `products` | TEXT | (JSON array) |
| `cnpj` | TEXT | |
| `dados_analise` | TEXT | (JSON) |
| `status_analise` | TEXT | DEFAULT 'pendente' |
| `analyzed_at` | TEXT | |
| `created_at` | TEXT | DEFAULT datetime('now') |
| `updated_at` | TEXT | DEFAULT datetime('now') |

- **Propósito:** Listas de preço de fornecedores externos (via WhatsApp/Chatbot SaaS)
- **ÚNICO ponto de contato real com o Chatbot SaaS**
- **Pergunta em aberto:** O chatbot escreve via HTTP (`POST /api/external-suppliers`, server.ts:441) ou direto no Turso compartilhado?
- **Quem escreve:** `saveExternalSupplier` (database.ts:891), `updateSupplierAnalysis` (database.ts:931)
- **Quem lê:** `getExternalSuppliers` (database.ts:912), `getSuppliersPendentes` (database.ts:941), `getSuppliersAnalisados` (database.ts:951)
- **Purge:** `purgeOldData` (database.ts:601)
- **Consumido por:** `/api/optimize` (bloco `externalSuppliers`), `/api/ofertas-dia-analisar`, `analisarFornecedorEmBackground`
- **Detalhes:** `AGENTS.md` seção "Fornecedores Externos — Schema e Integração"

### `sugestoes_eans` (⚠️ sem CREATE TABLE)

- **Propósito:** EANs fixos do módulo Sugestões (populados uma vez via `/api/sync-eans-fixed`)
- **Quem escreve:** `saveEansFixos` (database.ts:777)
- **Quem lê:** `getEansFixos` (database.ts:789), `countEansFixos` (database.ts:800)
- **⚠️ Risco de fragilidade:** Não existe `CREATE TABLE` em nenhum lugar do código. A tabela existe no Turso real por fora do fluxo de schema versionado. Se o banco for recriado do zero, essas 3 funções quebram. Não é bug ativo — é dívida técnica registrada.

---

## 4. Integração com Encomendas — Detalhada

> Documento completo: `docs/encomendas-integracao.md` (movido de `_archive/`)

### Arquitetura

```
Frontend (React)
  │
  │ GET /api/integracao/encomendas/pendentes (sem token)
  ▼
Backend (Express — server.ts)
  │
  │ injeta x-api-key (ENCOMENDAS_INTEGRATION_KEY)
  ▼
Encomendas (Cloud Run — IA Estúdio)
  │
  │ retorna JSON com encomendas pendentes
  ▼
Backend processa:
  │
  ├─ COM EAN → Condicoes/Ean + Condicoes/Molecula (SmartPed)
  ├─ SEM EAN → Produtos/Buscar por descrição → Ean + Molecula
  │
  ▼
Modal de Revisão → Importar Selecionados → itens_manuais (origem="encomenda")
  │
  ▼
Opcional: POST confirmar-pedido → status "Encomendado"
```

### Endpoints locais (proxy)

| Endpoint local | Método | Proxy pra | Auth |
|---------------|--------|-----------|------|
| `/api/integracao/encomendas/pendentes` | GET | `GET ${ENCOMENDAS_API_URL}/api/integracao/encomendas/pendentes` | `x-api-key` injetado |
| `/api/integracao/encomendas/confirmar-pedido` | POST | `POST ${ENCOMENDAS_API_URL}/api/integracao/encomendas/confirmar-pedido` | `x-api-key` injetado |

### Endpoint direto (não é proxy)

| Endpoint | Método | Função | Throttle |
|----------|--------|--------|----------|
| `/api/encomendas/buscar-ofertas-batch` | POST | Busca SmartPed pra lote de encomendas | `CONCURRENCY=1`, delay 200ms (Bug #39, rate limit) |

### Variáveis de ambiente

| Variável | Descrição |
|----------|-----------|
| `ENCOMENDAS_API_URL` | URL base do sistema Encomendas |
| `ENCOMENDAS_INTEGRATION_KEY` | Chave `x-api-key` pra autenticação |

### Bugs históricos relevantes

- **Bug #27 (corrigido):** Migração `origem`/`id_encomenda` nunca rodava contra Turso — `initTursoSchema()` agora tem as 6 migrações ALTER TABLE (database.ts:266-271)
- **Bug #39:** Mesma razão do throttle `CONCURRENCY=1` — APIs externas sobrecarregavam e itens se perdiam

### Pendência conhecida

Fornecedores externos (`external_suppliers`) NÃO competem no fluxo de encomendas (`/api/encomendas/buscar-ofertas-batch`). Decisão pra outra sessão.

---

## 5. Integração com Chatbot — O que Existe Hoje

### Ponte: tabela `external_suppliers`

O Chatbot WhatsApp SaaS escreve listas de preço de fornecedores externos na tabela `external_suppliers` no Turso. Este projeto lê essa tabela em dois contextos:

1. **`/api/optimize` (SICF):** Bloco `externalSuppliers` — fornecedores externos competem com preço SmartPed durante otimização em lote. Matching primário por EAN exato, fallback por texto. Detalhes: `docs/arvore-decisoes-busca-api.md` seção 12.

2. **Tela "Ofertas do Dia":** `analisarFornecedorEmBackground` — análise detalhada com estoque (Ferramentinhas) e comparação de preço. Detalhes: `AGENTS.md` seção "Ofertas do Dia".

### Schema do produto externo

```typescript
interface ExternalProduct {
  description: string;
  price: number | null;        // null = fornecedor "trabalha com item" sem preço
  discountPercent?: number;     // desconto % (calcula preço via referência SmartPed)
  tiers?: PriceTier[];          // faixas de preço absoluto
  discountTiers?: Array<{minQty, discountPercent}>;  // faixas de desconto
  validade?: string | null;     // validade por item (YYYY-MM-DD)
}
```

### Pergunta em aberto

**Como o chatbot escreve no banco?** Duas hipóteses:
1. Via HTTP: `POST /api/external-suppliers` (server.ts:441) — passando `x-api-key` ou autenticação própria
2. Direto no Turso: escreve na tabela `external_suppliers` usando `TURSO_DATABASE_URL`/`TURSO_AUTH_TOKEN` compartilhados

Carlos pode confirmar qual (ou ambas) está correto. Resposta pode ser adicionada aqui depois.

---

## 6. Tabela de Decisões — Quem Faz O Que

| Necessidade | Sistema | Endpoint/Fonte |
|-------------|---------|----------------|
| Preço de distribuidor | SmartPed | `Condicoes/Ean` + `Condicoes/Molecula` |
| Estoque local da farmácia | Trier/Ferramentinhas | `similares/{ean}` |
| Vendas históricas | Trier/Ferramentinhas | `vendas-detalhadas/{ean}` |
| Compras históricas | Trier/Ferramentinhas | `compras-historico/{ean}` |
| Encomenda do balcão | Encomendas (IA Estúdio) | `GET .../pendentes` (proxy) |
| Confirmação de encomenda | Encomendas (IA Estúdio) | `POST .../confirmar-pedido` (proxy) |
| Lista de preço fornecedor externo | Chatbot SaaS → Turso | `external_suppliers` |
| Dados de produto (DCB, molécula) | Trier/Ferramentinhas | `buscar-lote`, `similares/{ean}` |
