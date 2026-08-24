# LEIA PRIMEIRO — Referência Rápida do Sistema

> **Data:** 2026-08-23
> **Última sessão:** Correções de Ofertas do Dia (timezone + INSERT OR REPLACE + nome fornecedor)

---

## 1. Arquivos de Contexto (SEMPRE ler no início)

| Arquivo | Conteúdo |
|---------|----------|
| `AGENTS.md` | Regras permanentes, bugs resolvidos, dependências cruzadas |
| `LLM_CONTEXT.md` | Visão geral, stack, regras rápidas, mapa de endpoints |
| `docs/ler-primeiro.md` | Este arquivo — referência rápida |

---

## 2. Sessão 2026-08-23 (noite) — Ofertas do Dia: 3 Bugs Corrigidos

### 2.1. INSERT OR REPLACE apagava dados de análise (CRÍTICO)

**Problema:** `saveExternalSupplier` usava `INSERT OR REPLACE` que substituía a linha inteira — colunas `dados_analise`, `status_analise`, `analyzed_at` ficavam NULL a cada save. O frontend re-salvava todos os fornecedores a cada alteração de config, destruindo análises.

**Sequência do bug:**
1. Usuário salva fornecedor → background analysis grava `dados_analise` ✅
2. Qualquer mudança no config → frontend re-POSTa fornecedores → `INSERT OR REPLACE` apaga `dados_analise` ❌
3. "Carregar Todas" vê `status_analise = NULL` → precisa re-analisar tudo

**Correção:** `INSERT ... ON CONFLICT(id) DO UPDATE SET ...` preserva colunas de análise.

**Arquivo:** `server/database.ts:776`

### 2.2. Filtro de validade em UTC (Cloud Run)

**Problema:** `new Date().toLocaleDateString('sv-SE')` no Cloud Run retornava data UTC. Usuário (UTC-3) definia validade "2026-08-23", mas servidor já calculava "2026-08-24" → fornecedor filtrado como expirado.

**Correção:** Offset `-3h`: `new Date(Date.now() - 3*60*60*1000)` em dois pontos:
- `GET /api/ofertas-dia/analisar` (server.ts:897)
- Fluxo de otimização (server.ts:4287)

### 2.3. Nome do fornecedor sem destaque visual

**Problema:** Nome do fornecedor aparecia pequeno e cinza (`text-[10px] text-gray-500`), misturado com validade.

**Correção:** `OfertasDoDiaModal.tsx` — card e detail modal:
- Card: `text-xs font-black text-amber-700` (grande, negrito, laranja)
- Detail modal: mesmo tratamento
- Validade separada em linha menor

**Deploy:** `smartped-cli-00061-x74`

---

## 3. Sessão 2026-08-23 (tarde) — Estoque no Modal Promoções do Dia

### 3.1. Correção de Estoque (2026-08-23)

**Problema:** Card e detail modal mostravam "Estoque: 22cx" (apenas GLOBO) em vez de "25cx" (GLOBO 22 + NOVARTIS 3).

**Causa raiz:** `estoqueMesmoEan` vinha do `analisarUmProduto()` que contava estoque de **apenas 1 EAN**. O frontend usava esse campo no card (linha 449) e no detail modal (linha 705).

**Correções:**
1. **`analisarFornecedorEmBackground`** (server.ts:836-847): Extraído `estoqueGrupo` do `eansGrupo.reduce()`.
2. **`analisar-referencia`** (server.ts:1329): `estoqueMesmoEan` agora usa `estoqueFinal` (soma de `eanList`).

### 3.2. Botão de Busca (Lupa) no Modal Promoções do Dia

- Botão lupa 🔍 no header do modal
- **Backend** `GET /api/ofertas-dia/buscar-produto?q=...`
- **Backend** `POST /api/ofertas-dia/analisar-referencia`
- Agrupamento por DCB, vendas agregadas (3 meses), compras com lab

### 3.3. Correções de Bugs anteriores

| Bug | Correção |
|-----|----------|
| Vendas somava última semana × 4 | Agora usa média 3 meses |
| Estoque filtrava por movimentação | Estoque soma TODOS os EANs com estoque > 0 |
| Estoque mostrava 22cx em vez de 25cx | `estoqueMesmoEan` usa total do grupo DCB |
| Card não mostrava "Melhor SmartPed" | Frontend mostra fallback "Não encontrado" |

---

## 4. O que FALTA corrigir (próxima sessão)

### 4.1. Vendas não aparece para produtos novos
- **Problema:** Vendas mostra 0/mês para produtos sem histórico no Trier
- **Solução possível:** Buscar vendas por descrição (não só por EAN)

### 4.2. Performance lenta
- **Problema:** "Carregar Todas" demora porque chama muitas APIs em sequência
- **Solução possível:** Batch de vendas-semanais, cache de resultados

---

## 5. Fluxo Atual dos Dados

```
┌─────────────────────────────────────────────────────────┐
│  FLUXO: Promoções Turso (Carregar Todas)                │
├─────────────────────────────────────────────────────────┤
│                                                          │
│  1. Buscar fornecedores no Turso (external_suppliers)    │
│  2. Para cada fornecedor:                                │
│     a. Ler products[] do JSON                            │
│     b. Buscar EANs via buscar-lote (produtos sem EAN)    │
│     c. Para cada produto:                                │
│        - analisarUmProduto(product) → SmartPed/vendas    │
│        - buscar-lote(description) → todos EANs do DCB    │
│        - vendas-semanais(CADA EAN) → somar               │
│        - compras-historico(CADA EAN) → merge com lab     │
│        - Montar eansGrupo com estoque/labs               │
│     d. Retornar produto com dados agregados              │
│  3. Salvar em external_suppliers.dados_analise           │
│  4. Frontend renderiza cards                             │
│                                                          │
└─────────────────────────────────────────────────────────┘

┌─────────────────────────────────────────────────────────┐
│  FLUXO: Busca Manual (Lupa)                             │
├─────────────────────────────────────────────────────────┤
│                                                          │
│  1. Usuário digita EAN ou descrição                      │
│  2. Backend: buscar-produto(q)                           │
│     - Se numérico: buscar-por-ean/{ean} (Trier)          │
│     - Se texto: buscar-lote(termo) → agrupar por DCB    │
│  3. Frontend: mostrar lista de resultados                │
│  4. Usuário clica "Analisar"                             │
│  5. Backend: analisar-referencia                         │
│     - Recebe eans[] do grupo                             │
│     - vendas-semanais(CADA EAN) → somar                 │
│     - compras-historico(CADA EAN) → merge com lab       │
│     - analisarUmProduto(melhor EAN) → SmartPed          │
│  6. Frontend: renderiza card igual promoções Turso       │
│                                                          │
└─────────────────────────────────────────────────────────┘
```

---

## 5. Variáveis de Ambiente Necessárias

| Variável | Descrição |
|----------|-----------|
| `FERRAMENTINHAS_API_URL` | URL da API Trier (ex: https://api.ferramentinhas.com.br) |
| `SMARTPED_PRODUCTION_TOKEN` | Token API SmartPed |
| `SMARTPED_PRODUCTION_URL` | URL base SmartPed |
| `TURSO_DATABASE_URL` | URL do banco Turso |
| `TURSO_AUTH_TOKEN` | Token Turso |

---

## 6. Endpoints Principais

### Backend (server.ts)
| Endpoint | Método | Função |
|----------|--------|--------|
| `/api/ofertas-dia/buscar-produto?q=` | GET | Buscar produto por EAN ou descrição |
| `/api/ofertas-dia/analisar-referencia` | POST | Analisar produto com dados do grupo |
| `/api/ofertas-dia/analisar?cnpj=&force=true` | GET | Carregar todas as promoções Turso |
| `/api/produtos/buscar-por-ean/{ean}` | GET | Buscar produto no Trier por EAN |

### Trier (main.py)
| Endpoint | Método | Função |
|----------|--------|--------|
| `GET /api/produtos/buscar-por-ean/{ean}` | GET | Buscar produto por EAN (NOVO) |
| `POST /api/produtos/buscar-lote` | POST | Buscar por descrição (agrupado) |
| `GET /api/produtos/compras-historico/{ean}` | GET | Histórico de compras |
| `GET /api/chatbot/produto/vendas-semanais/{ean}` | GET | Vendas semanais |

---

## 7. Comandos Úteis

```bash
# Verificar TypeScript
npx tsc --noEmit

# Testar endpoint de busca
Invoke-RestMethod -Uri "http://localhost:3000/api/ofertas-dia/buscar-produto?q=SINVASTATINA+20MG" -Method GET

# Testar endpoint de análise
$body = @{ ean = "7899620911031"; descricao = "SINVASTATINA 20MG 30CP"; cnpj = "13408443000168"; estoque = 25; melhorPreco = 2.69; labs = @("GLOBO","NOVARTIS"); eans = @(@{ean="7899620911031";lab="GLOBO";estoque=22;preco=2.69},@{ean="7897595632548";lab="NOVARTIS";estoque=3;preco=3.69}) } | ConvertTo-Json -Depth 5
Invoke-RestMethod -Uri "http://localhost:3000/api/ofertas-dia/analisar-referencia" -Method POST -ContentType "application/json" -Body $body

# Testar API Trier
Invoke-RestMethod -Uri "https://api.ferramentinhas.com.br/api/produtos/buscar-por-ean/7899620911031" -Method GET
```
