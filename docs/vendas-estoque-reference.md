# Referência: Cálculo de Vendas e Estoque

> **Data:** 2026-08-25
> **Última sessão:** Correções de vendas/estoque no Promoções do Dia

---

## 1. Regra Fundamental

**TODOS os dados de vendas e estoque vêm do Ferramentinhas (Trier ERP).**
**SmartPed NÃO tem dados de venda nem estoque real do ERP.**

SmartPed fornece APENAS:
- Preços de distribuidoras (Condicoes/Ean, Condicoes/Molecula)
- Substitutos moleculares
- EANs extras (Produtos/Buscar)

---

## 2. Fontes de Dados

| Dado | Fonte | Endpoint | O que retorna |
|------|-------|----------|---------------|
| **Estoque** | Ferramentinhas | `similares/{ean}` | Produtos com mesma composição, estoque por lab |
| **Vendas** | Ferramentinhas | `vendas-detalhadas/{ean}` | Vendas históricas (data + quantidade) |
| **EANs do grupo** | Ferramentinhas | `buscar-lote` | Produtos por texto, agrupados por DCB |
| **Preço SmartPed** | SmartPed | `Condicoes/Ean` | Ofertas comerciais (preço, estoque dist.) |
| **Substitutos** | SmartPed | `Condicoes/Molecula` | Substitutos moleculares |

---

## 3. Os 3 Fluxos que usam Vendas/Estoque

### 3.1. Promoções do Dia — Background (`analisarFornecedorEmBackground`)

**Arquivo:** `server.ts` ~linha 1100

**Fluxo:**
```
buscar-lote("PRINCIPIO ATIVO") → eansGrupo (EANs do ERP)
  ↓ (fallback: buscar-lote("PRINCÍPIO%") → wildcards Trier)
  ↓ (fallback: similares/{ean})
  ↓
erpEans = EANs do Ferramentinhas (SEM SmartPed EANs)
  ↓
vendas-detalhadas/{ean} para CADA erpEan → soma / mesesDiff
  ↓
similares/{ean} → estoqueTotal + estoquePorLaboratorio
```

**Pontos críticos:**
- `erpEans` NÃO deve incluir EANs da SmartPed (não têm vendas no ERP)
- SmartPed EANs entram APENAS em `eanList` para pricing (`analisarUmProduto`)
- `estoqueTotal` e `estoquePorLaboratorio` vêm de `similares/{ean}` (Ferramentinhas)
- Aplicar filtro de apresentação (SH≠CR) nos EANs de vendas

### 3.2. P Button / Lupa (`analisar-referencia`)

**Arquivo:** `server.ts` ~linha 1765

**Fluxo:**
```
buscar-produto(q) → eans[] do grupo DCB (via buscar-lote)
  ↓
vendas-detalhadas/{ean} para CADA ean → soma / mesesDiff
  ↓
similares/{ean} → estoqueTotal (eanList[].estoque)
```

**Pontos críticos:**
- `eans` vem do frontend (montado a partir de `buscar-produto`)
- `buscar-produto` usa `buscar-lote` (Ferramentinhas) para expandir EANs
- Estoque: soma de `eanList[].estoque` (campo do buscar-lote)
- Vendas: `vendas-detalhadas/{ean}` para cada EAN

### 3.3. SICF Batch (optimize)

**Arquivo:** `server.ts` ~linha 3644

**Fluxo:**
```
marketSimilarMap (de buscar-lote/similares) → EANs expandidos
  ↓
vendas-detalhadas/{ean} para TODOS os EANs → soma / mesesDiff
  ↓
similares/{ean} → estoqueTotal por EAN
```

**Pontos críticos:**
- `marketSimilarMap` pode conter EANs SmartPed (marcados com `_origem: "smartped"`)
- Filtro: `_origem !== "smartped"` no cálculo de vendas
- Aplicar filtro de apresentação nos EANs

---

## 4. Regras de Cálculo

### 4.1. Vendas Mensais
```
1. Buscar vendas-detalhadas/{ean} para CADA EAN do grupo (Ferramentinhas)
2. Filtrar apenas últimos 4 meses
3. Somar TODAS as vendas (NÃO por-EAN)
4. Calcular mesesDiff das datas reais (primeiraData / ultimaData)
5. mediaMensal = Math.round(totalVendas / mesesDiff)
```

**NÃO:**
- ❌ Calcular por-EAN e depois somar (infla resultado)
- ❌ Usar `vendas-semanais` (desatualizado)
- ❌ Dividir por 4 hardcoded (usar mesesDiff real)
- ❌ Incluir EANs SmartPed (não têm vendas no ERP)

### 4.2. Estoque
```
1. Buscar similares/{ean} (Ferramentinhas)
2. Filtrar por apresentação (SH≠CR≠GEL)
3. estoqueTotal = soma de qtd_estoque dos produtos filtrados
4. estoquePorLaboratorio = agrupado por nom_laborat
```

**NÃO:**
- ❌ Usar estoque de SmartPed (`Estoque` em Condicoes) — é estoque da dist., não do ERP
- ❌ Misturar apresentações (SH com CR)
- ❌ Usar `eansGrupo[].estoque` do buscar-lote (pode estar desatualizado)

---

## 5. Filtro de Apresentação

**Sempre aplicar** ao calcular vendas ou estoque de grupos DCB mistos.

```typescript
const _PRES_GRUPOS = [
  ["SH", "SHAMPOO"], ["CR", "CREME"], ["DERM"], ["GEL"],
  ["SOL", "SOLUCAO"], ["CAP", "CAPSULA"], ["COM", "COMPRIMIDO", "CP"]
];
// Exemplo: produto original é SH → incluir só EANs que também são SH
```

---

## 6. Buscar-lote — Wildcards Trier

A Trier usa `%` como wildcard. Quando `buscar-lote` retorna vazio:

```
1. Tentar: buscar-lote(["PRINCÍPIO%"])     → wildcard
2. Tentar: buscar-lote(["PRINCÍPIO"])      → sem wildcard
3. Fallback: similares/{ean}               → por EAN direto
```

**Exemplo:** "CETOCONAZOL 20MG/ML SH 100ML" retorna vazio.
→ `buscar-lote(["CETOCONAZOL%"])` retorna 16 produtos.

---

## 7. Onde verificar ao alterar

| Ponto | Arquivo | O que verifica |
|-------|---------|----------------|
| `analisarUmProduto` | server.ts:542-596 | Estoque via `similares/{ean}` + filtro apresentação |
| `analisarFornecedorEmBackground` | server.ts:1100-1410 | erpEans vs eanList, vendas com erpEans |
| `analisar-referencia` | server.ts:1765-1910 | eans do frontend, vendas-detalhadas |
| SICF batch vendas | server.ts:3644-3830 | filtro `_origem !== "smartped"`, apresentação |
| SICF batch estoque | server.ts:3735-3780 | similares/{ean} com filtro apresentação |

---

## 8. Dependências Cruzadas

**ALTERAR UM PONTO, VERIFICAR OS OUTROS:**

| # | Fluxo | Impacta |
|---|-------|---------|
| 1 | `analisarUmProduto` (estoque) | Card Promoções do Dia, Detail modal |
| 2 | `analisarFornecedorEmBackground` (vendas) | Card Promoções do Dia, Detail modal |
| 3 | `analisar-referencia` (vendas) | P Button / Lupa |
| 4 | SICF batch (vendas+estoque) | Tabela SwapsTable, badges |
