# Contexto Ativo — Última Sessão: 2026-08-25 (noite)

## Status do Sistema
- **Versão:** v2026-08-25 (deploy smartped-cli-00066-msq)
- **URL:** https://smartped-cli-887122622666.us-east1.run.app
- **Branch backup:** backup/vendas-estoque-2026-08-25

## Sessão Atual — Vendas/Estoque + Word Boundary + Encomendas

### Bugs Corrigidos
1. **saveOrder ANTES de res.json (server.ts)** — saveOrder + saveOrderItem rodam antes de enviar resposta ao frontend. Catch loga erros em vez de engolir silenciosamente.
2. **Confirmação encomenda condicional (server.ts)** — Só confirma no sistema externo SE orderSaved = true.
3. **CodProdutoDist enrichment no batch de encomendas (server.ts)** — Mapa Ean_CodDist → CodProdutoDist para ofertas do Molecula.
4. **codProduto fallback para codProdutoDist (4 pontos)** — handleAddEncomendaItem, handleConfirmImportEncomendas, handleSelectCondition, useManualSearch.
5. **Vendas: SmartPed EANs excluídos do cálculo (server.ts)** — `erpEans` separado de `eanList`. SmartPed EANs só para pricing.
6. **Fallback buscar-lote com wildcards (server.ts)** — Quando buscar-lote retorna vazio, tenta `PRINCÍPIO%` (wildcard Trier) antes de similares/{ean}.
7. **Estoque total usa `similares/{ean}` (Ferramentinhas)** — estoqueGrupo = analysis.estoqueTotal (não eansGrupo que pode estar desatualizado).
8. **Word boundary em filtros de apresentação (3 pontos)** — Função `hasWordBoundary()` criada em parsers.ts. `includes()` → `hasWordBoundary()` em analisarUmProduto, analisarFornecedorEmBackground, SICF batch.
9. **API Ferramentinhas atualizada** — `buscar` e `buscar-lote` usam `~* \y...\y` (word boundary no SQL) em vez de `ILIKE %...%`.

### Documentação Criada
- `docs/vendas-estoque-reference.md` — Referência completa de vendas/estoque
- `API_TREE_TRIER.md` — Seção wildcard `%` adicionada
- `AGENTS.md` — Regra #48 (wildcard Trier)

### O Que Funciona
- Promoções do Dia: vendas com erpEans (Ferramentinhas) ✅
- Promoções do Dia: estoque via similares/{ean} (Ferramentinhas) ✅
- Filtro apresentação: word boundary (CREME ≠ CREMER) ✅
- Encomendas: codProdutoDist + codProduto nunca vazios ✅
- Encomendas: confirmação só após saveOrder OK ✅
- Buscar-lote: fallback wildcard Trier ✅

### O Que Está Pendente
- Testar(word boundary) com produto que tem "CREMER" no nome
- Verificar se outros pontos do código usam `includes()` para apresentação
- Considerar adicionar parâmetro `forma` no buscar-lote da API Ferramentinhas

### Arquivos Modificados Nesta Sessão
- `server.ts`: saveOrder antes de res.json, confirmação condicional, erpEans, fallbacks wildcard, estoqueGrupo, word boundary filters
- `server/parsers.ts`: hasWordBoundary()
- `src/App.tsx`: codProduto fallback
- `src/hooks/useManualSearch.ts`: codProduto fallback
- `src/hooks/useOptimizationResult.ts`: codProduto fallback
- `AGENTS.md`: regra #48 (wildcard Trier)
- `API_TREE_TRIER.md`: seção wildcard
- `docs/vendas-estoque-reference.md`: documentação completa

## Regras Importantes
- **Tudo de vendas/estoque vem do Ferramentinhas** — SmartPed só para pricing
- **erpEans ≠ eanList** — erpEans = Ferramentinhas, eanList = Ferramentinhas + SmartPed
- **Word boundary obrigatório** em filtros de apresentação
- **Wildcard Trier:** quando buscar-lote retorna vazio, tentar `PRINCÍPIO%`
- **estoqueTotal** = `similares/{ean}` (Ferramentinhas), NÃO `eansGrupo`
