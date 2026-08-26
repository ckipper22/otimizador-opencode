# Contexto Ativo — Última Sessão: 2026-08-25 (noite)

## Status do Sistema
- **Versão:** v2026-08-25 (deploy smartped-cli-00068-dkk)
- **URL:** https://smartped-cli-887122622666.us-east1.run.app
- **GitHub:** ff21fc1

## Sessão Anterior — Timing Encomendas + codProduto Manual

### Bugs Corrigidos

1. **FIX 1: Timing de confirmação de encomendas (server.ts + useBilling.ts)**
   - **Problema:** Encomendas eram confirmadas como "Encomendado" no sistema externo ANTES do SmartPed retornar. Se viesse falta, status ficava errado.
   - **Correção:** Confirmação movida de `/api/faturar` para frontend após poll retornar `isAllFinalized`.
   - **Backend:** `/api/faturar` retorna `encomendasPendentes[]` (não confirma mais). Itens incluem `origem` e `idEncomenda`.
   - **Frontend:** Nova função `confirmarEncomendasAposRetorno()` em `useBilling.ts`. Só confirma encomendas onde pelo menos 1 item teve `QuantFaturada > 0`.
   - **Arquivos:** `server.ts:6484-6530` (removeu bloco de confirmação, adicionou encomendasPendentes), `useBilling.ts:478-520` (confirmarEncomendasAposRetorno), `useBilling.ts:34` (billingContext.encomendasPendentes)

2. **FIX 2: Herança de codProduto para itens manuais (server.ts)**
   - **Problema:** Itens com `origem="manual"` (Trok G, Sal de Fruta) tinham `codProduto: "0"` na alternativa selecionada. Regra de herança só cobria `origem="encomenda"`.
   - **Correção:** Condição expandida para cobrir qualquer origem. Fallback adicional herda do item pai.
   - **Arquivo:** `server.ts:6307-6335` (apiItens map)

## Sessão Atual — Filtro Tipo WhatsApp + Fix Acento resolveCategoria

### Bugs Corrigidos

3. **FIX 3: Filtro tipo WhatsApp "Só Genéricos" usava regex de texto (server.ts)**
   - **Problema:** `server.ts:3008-3010` usava `descUpper.includes("(G)")` / `"GENERICO"` pra decidir se item é genérico. Descrição SICF frequentemente não tem esses marcadores → regex falhava silenciosamente.
   - **Correção:** Criado `eanCategoriaMap` (server.ts:2989-3010) que classifica via `resolveCategoria()` usando `marketSimilarMap` (Ferramentinhas). Match por EAN normalizado via `cleanEan()`. Fallback explícito pra regex quando dado não disponível.
   - **Fluxo:** `marketSimilarMap[origEan]` → find `selfProduct` (mesmo EAN) → `resolveCategoria(selfProduct)` → armazena no Map
   - **Cobertura testada:** 6/18 EANs (33%) — 3 genéricos, 2 marcas, 1 similar. Todos corretos. 12 fallback = 6 perfumaria (sem DCB) + 6 sem estoque/demanda (esperado).
   - **Arquivo:** `server.ts:2989-3010` (construção), `server.ts:3029-3050` (uso no check WhatsApp)

4. **FIX 4: Bug sistêmico de acento no `resolveCategoria` (server/parsers.ts)**
   - **Problema:** `"Genérico".toLowerCase()` = `"genérico"` → `.includes("generico")` = **false** (é ≠ e). afetava TODOS os 9 call sites de `resolveCategoria`. Generics classificados como "outros" incorretamente.
   - **Correção:** Adicionado `.normalize("NFD").replace(/[\u0300-\u036f]/g, "")` após `.toLowerCase()` em `resolveCategoria`.
   - **Impacto confirmado com dado real:** 3 genéricos que antes eram "outros" agora são "generico" corretamente (LEVOTIROXINA, CICLOBENZAPRINA, DEXAMETASONA).
   - **Auditoria:** Outros 6 pontos com `.toLowerCase().includes()` no codebase são SEGUROS (descrições SICF=ASCII, ou já tratam ambas versões).
   - **Arquivo:** `server/parsers.ts:453-458`

### O Que Funciona
- WhatsApp regra "Só Genéricos": classifica via Ferramentinhas (não mais regex) ✅
- WhatsApp regra "Só Éticos": classifica via Ferramentinhas ✅
- Fallback regex explícito quando Ferramentinhas não tem dado ✅
- `resolveCategoria`: acentos normalizados, funciona com "Genérico", "Referência", etc. ✅
- Encomendas: confirmação só após retorno SmartPed com status=faturado ✅
- Encomendas: apenas itens QuantFaturada > 0 são confirmados ✅
- codProduto: herança para TODOS os itens (manual, encomenda, qualquer origem) ✅

### O Que Está Pendente
- **Problema 2 (WhatsApp grupo separado):** Ainda NÃO diagnosticado. Precisa rastrear caso real pra confirmar se item WhatsApp passa pelo bloco `if (waMatch)` ou pelo caminho normal.
- Testar fluxo completo: faturar item manual → verificar que codProduto não é "0"
- Testar encomenda com falta → verificar que NÃO é confirmada no sistema externo

### Arquivos Modificados Nesta Sessão
- `server.ts:2989-3010` — eanCategoriaMap (construção)
- `server.ts:3029-3050` — Filtro tipo WhatsApp (usa eanCategoriaMap + fallback regex)
- `server/parsers.ts:453-458` — Fix acento resolveCategoria (normalize NFD)
- `test-ean-categoria.ts` — Script de teste standalone (pode deletar)

## Regras Importantes
- **Tudo de vendas/estoque vem do Ferramentinhas** — SmartPed só para pricing
- **erpEans ≠ eanList** — erpEans = Ferramentinhas, eanList = Ferramentinhas + SmartPed
- **Word boundary obrigatório** em filtros de apresentação
- **Wildcard Trier:** quando buscar-lote retorna vazio, tentar `PRINCÍPIO%`
- **estoqueTotal** = `similares/{ean}` (Ferramentinhas), NÃO `eansGrupo`
- **Encomendas:** confirmação DEPOIS do retorno, nunca antes
- **codProduto:** herança para TODOS os itens (manual, encomenda, qualquer origem)
- **resolveCategoria:** SEMPRE normalizar acentos antes de `.includes()` — API Ferramentinhas retorna "Genérico" (com acento)
