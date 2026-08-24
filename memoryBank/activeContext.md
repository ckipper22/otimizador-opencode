# Active Context

## Date: 2026-08-24

## Current Task: Sessão — Price Tiers + EAN Lookup + SmartPed Multi-EAN

### Estado Atual
- **Branch:** `master`
- **Lint:** `tsc --noEmit` sem erros
- **Build:** `npm run build` OK
- **Último deploy:** `smartped-cli-00063-qf4` (precisa de novo deploy com mudanças desta sessão)

### O que foi feito nesta sessão

#### 1. Price Tiers (Quantity Breaks) para Promoções WhatsApp
- **Tipo `PriceTier`** (`src/types.ts`): `interface PriceTier { minQty: number; price: number }` + `tiers?` em `ExternalProduct` e `SwapReportItem`
- **Parser** (`ConfigurationPanel.tsx`): Detecta padrões `70und 2,29`, `50+ 5,00`. Adiciona ao último produto. Tiers ordenados por minQty.
- **Backend** (`server.ts`): `analisarUmProduto()` calcula `bestTierPrice` (menor tier). Auto-descarte usa `bestTierPrice`.
- **Frontend card** (`OfertasDoDiaModal.tsx`): Banner laranja "PRECO CONDICIONAL" + tabela de faixas com ★ no melhor tier
- **Frontend detail** (`OfertasDoDiaModal.tsx`): Seção "Faixas de Preço" com tabela completa
- **Frontend SwapsTable** (`SwapsTable.tsx`): Badge "FAIXA X+ ★" (verde) ou "+N un p/ R$" (amarelo)
- **handleUpdateQty** (`useOptimizationResult.ts`): Recalcula `novoPreco` quando qty atinge tier
- **ConfigurationPanel**: Tags miniatura + preço com asterisco quando tem tiers

#### 2. Turso Timestamps UTC-3
- **SQL syntax fix** (`server/database.ts:459`): `datetime('now)` → `datetime('now')`
- **Todos `datetime('now')` → `datetime('now', '-3 hours')`** (~30 ocorrências)
- **Validade comparison** (`ConfigurationPanel.tsx`): `new Date().toISOString()` → `new Date(Date.now() - 3*60*60*1000).toISOString()`

#### 3. Botões Salvar/Editar/Excluir na aba Tabelas
- **Dirty tracking** (`ConfigurationPanel.tsx`): `tabelasDirty` state + `markTabelasDirty()`
- **Botão "Salvar Listas"** / "Salvo ✓" (igual aba Regras)
- **Confirmação de exclusão** (`window.confirm`)
- **DELETE real no Turso** (`useOptimizerConfig.ts`): `handleRemoveExternalSupplier` chama `DELETE /api/external-suppliers/:id`
- **Props** (`App.tsx`): `onRemoveExternalSupplier` passado ao ConfigurationPanel

#### 4. Analysis Cache Clearing
- **POST `/api/external-suppliers`** (`server.ts`): Compara oldProducts vs newProducts. Se diferentes → `updateSupplierAnalysis(id, null, "pendente")` → force re-análise
- **`updateSupplierAnalysis`** (`server/database.ts`): Aceita `null` para dadosAnalise (salva SQL NULL)

#### 5. Tier Regex — Emojis (💥)
- **Causa:** `\p{Emoji}` removia dígitos 0-9 (Unicode Modern)
- **Correção:** Ranges específicos (`\u{1F300}-\u{1FAFF}`) + limpeza com `replace(/[\u{1F300}-\u{1FAFF}...]/gu, "")`

#### 6. Mojibake + EAN Lookup
- **Mojibake cleanup**: `\udca5|\udca4|\udca6|\ufffd` removido dos termos de busca
- **Buscar-lote por princípio ativo** (não full description que falha por "SOD" no meio)
- **3 fallbacks**: buscar-lote com dosagem → buscar-lote sem dosagem → proxy backend
- **Proxy URL fix**: URL absoluta `http://localhost:3000/api/...` em vez de relativa

#### 7. SmartPed Multi-EAN Expansion
- **`analisarUmProduto(product, cnpj, allEans?)`**: Novo parâmetro opcional `allEans`
- **SmartPed busca `Condicoes/Ean` para CADA EAN** do grupo (batches de 10, paralelo)
- **`analisarFornecedorEmBackground`**: Descobre EANs via `buscar-lote` (princípio ativo + filtro dosagem) ANTES de analisar
- **Enriquecimento por descrição**: Se ≤2 EANs, busca MAIS via Ferramentinhas por princípio ativo
- **Vendas/compras agregadas** de TODOS os EANs do grupo

### Documentação atualizada
- `AGENTS.md` — Bugs #23-26 (SmartPed visão em túnel, tier emojis, mojibake, buscar-lote sem mg)
- `LLM_CONTEXT.md` — Tabela de bugs atualizada
- `supermemory` — 5 entradas novas (price tiers, timestamps, EAN lookup, mojibake, multi-EAN)

### Pendências
- **Deploy** — Precisa de novo deploy com todas as mudanças desta sessão
- **Teste completo** — Validar que `eansGrupo` aparece no `dados_analise` (DCB expansion funcionando)
- **Busca manual vs automática** — Falta "Ver todas as ofertas boas"
- **SmartPed EANs extras** — Gauchofarma, CervoSul, etc. só aparecem se buscar por descrição na SmartPed (API não suporta busca textual)

### Bugs resolvidos nesta sessão
1. SQL syntax error `datetime('now)` (server/database.ts:459)
2. Timestamps em UTC em vez de UTC-3
3. Exclusão não propagava para Turso (ghost entries)
4. Sem botão Salvar na aba Tabelas
5. Analysis cache não limpa quando products mudam
6. Tier regex não detectava emojis (💥)
7. Mojibake em termos de busca
8. Buscar-lote sem "mg" não acha produto (SOD no meio)
9. SmartPed "visão em túnel" — buscava com 1 EAN
10. Proxy URL relativa falhava no servidor
