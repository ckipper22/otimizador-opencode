# LEIA PRIMEIRO — Referência Rápida do Sistema

> **Data:** 2026-08-23
> **Última sessão:** Correção de estoque no modal Promoções do Dia

---

## 1. Arquivos de Contexto (SEMPRE ler no início)

| Arquivo | Conteúdo |
|---------|----------|
| `AGENTS.md` | Regras permanentes, bugs resolvidos, dependências cruzadas |
| `LLM_CONTEXT.md` | Visão geral, stack, regras rápidas, mapa de endpoints |
| `docs/ler-primeiro.md` | Este arquivo — referência rápida |

---

## 2. Sessão 2026-08-23 — O que foi feito

### 2.1. Botão de Busca (Lupa) no Modal Promoções do Dia

**Problema:** Usuário buscava produtos que não tinham promoção no Turso e não encontrava nada.

**Solução implementada:**
- Botão lupa 🔍 no header do modal (ao lado do X)
- Painel de busca com input, botão Buscar, e lista de resultados
- **Backend** `GET /api/ofertas-dia/buscar-produto?q=...`:
  - Se termo numérico (EAN): usa `GET /api/produtos/buscar-por-ean/{ean}` (novo endpoint Trier)
  - Se texto: usa `POST /api/produtos/buscar-lote` (limpa termos de busca)
- **Backend** `POST /api/ofertas-dia/analisar-referencia`:
  - Recebe EAN + dados do grupo (estoque, melhorPreco, labs, eans[])
  - Chama `analisarUmProduto` para SmartPed
  - Busca vendas/compras de TODOS os EANs do grupo
  - Retorna card com dados consolidados

**Endpoints novos no Ferramentinhas (main.py):**
- `GET /api/produtos/buscar-por-ean/{ean}` — busca produto por EAN com todos os dados

### 2.2. Agrupamento por DCB (Genéricos)

**Problema:** Ao buscar "ENALAPRIL 10MG 30CP", apareciam 3 cards separados (BELFAR, BIOLAB, TEUTO).

**Solução:** `buscar-produto` agrupa por `cod_dcb + cod_concentracao`:
- Retorna 1 card por grupo terapêutico
- Mostra total de estoque, melhor preço, todos os labs
- `eans[]` array com todos os EANs do grupo

### 2.3. Vendas Agregadas (últimos 3 meses)

**Problema:** Vendas mostravam apenas 1 EAN.

**Solução:** `analisar-referencia` chama `vendas-semanais` para CADA EAN do grupo:
- Média baseada no período real (não 4 semanas fixas)
- EANs sem movimentação nos últimos 3 meses são excluídos do cálculo de vendas
- Estoque NÃO é filtrado por movimentação

### 2.4. Compras com Nome do Laboratório

**Problema:** "Seus Preços" mostrava fornecedor mas não o lab.

**Solução:** `compras-historico` chamado para CADA EAN, com `laboratorio: e.lab` em cada compra.

### 2.5. Melhor SmartPed com Nome da Distribuidora

**Problema:** Mostrava "R$ 3,00 (SmartPed)" em vez do nome real.

**Solução:** `analisarUmProduto` usa `resolveDistName(c)` com fallbacks em cascata.

### 2.6. Correções de Bugs

| Bug | Correção |
|-----|----------|
| Vendas somava última semana × 4 | Agora usa média 3 meses (últimas 13 semanas) |
| Estoque filtrava por movimentação | Estoque soma TODOS os EANs com estoque > 0 |
| Compras filtravam por vendas | Compras usam `uniqueEans` (todos os EANs) |
| Estoque mostrava 22cx em vez de 25cx | `estoqueMesmoEan` agora usa total do grupo DCB (`eansGrupo.reduce()`) em vez de 1 EAN |
| Card não mostrava "Melhor SmartPed" | Frontend mostra fallback "Não encontrado" |
| Lab não aparecia nas compras | Coluna "Lab" adicionada na tabela |

### 2.7. Detalhe da Correção de Estoque (2026-08-23)

**Problema:** Card e detail modal mostravam "Estoque: 22cx" (apenas GLOBO) em vez de "25cx" (GLOBO 22 + NOVARTIS 3).

**Causa raiz:** `estoqueMesmoEan` vinha do `analisarUmProduto()` que contava estoque de **apenas 1 EAN** (o EAN do produto da lista). O frontend usava esse campo no card (linha 449) e no detail modal (linha 705).

**Correções:**
1. **`analisarFornecedorEmBackground`** (server.ts:836-847): Extraído `estoqueGrupo` do `eansGrupo.reduce()`. Agora `estoqueTotal` E `estoqueMesmoEan` usam o mesmo valor (total do grupo DCB).
2. **`analisar-referencia`** (server.ts:1329): `estoqueMesmoEan` agora usa `estoqueFinal` (soma de `eanList`) em vez de `estoque || 0` (request body).

**Arquivos:** `server.ts` (linhas 836-847, 1329)

---

## 3. O que FALTA corrigir (próxima sessão)

### 3.1. Vendas não aparece para produtos novos
- **Problema:** Vendas mostra 0/mês para produtos sem histórico no Trier
- **Causa:** API `vendas-semanais` retorna vazio para EANs sem vendas
- **Solução possível:** Buscar vendas por descrição (não só por EAN)

### 3.2. Performance lenta
- **Problema:** "Carregar Todas" demora porque chama muitas APIs em sequência
- **Causa:** Cada produto do Turso → `buscar-lote` + `vendas-semanais` × N EANs + `compras-historico` × N EANs
- **Solução possível:** Batch de vendas-semanais, cache de resultados

---

## 4. Fluxo Atual dos Dados

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
