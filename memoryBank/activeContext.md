# Contexto Ativo — Última Sessão: 2026-08-25 (noite)

## Status do Sistema
- **Versão:** v2026-08-25 (deploy smartped-cli-00065-mz7)
- **URL:** https://smartped-cli-887122622666.us-east1.run.app
- **Servidor local:** Rodando (precisa restart para aplicar mudanças)

## Sessão Atual — Correções Encomendas + Faturamento

### Bugs Corrigidos
1. **saveOrder depois de res.json() (server.ts)** — `saveOrder` + `saveOrderItem` agora rodam ANTES de `res.json()`. Flag `orderSaved` controla se confirmação de encomenda pode disparar. Catch loga erros em vez de engolir silenciosamente.
2. **Confirmação encomenda incondicional (server.ts)** — Agora só confirma no sistema externo SE `orderSaved = true`. Elimina bug de marcar "Encomendado" sem pedido salvo no Turso.
3. **CodProdutoDist vazio no batch de encomendas (server.ts)** — Adicionado enriquecimento: mapa `Ean_CodDist → CodProdutoDist` a partir de ofertas que têm o campo. Substitutos do Molecula (sem CodProdutoDist) recebem valor do mapa. Normalização agora inclui `codProdutoDist` e `codProduto` explicitamente.
4. **codProduto vazio em 4 pontos (App.tsx, useManualSearch.ts, useOptimizationResult.ts)** — `codProduto` agora herda de `codProdutoDist` como fallback em: handleAddEncomendaItem, handleConfirmImportEncomendas, handleSelectCondition, useManualSearch. Se a SmartPed retorna `codProduto: ""` mas `codProdutoDist: "776661"`, o item agora usa "776661".

### O Que Funciona
- SICF: vendas/estoque com filtro 4 meses e apresentação ✅
- P button (EanPromoButton): expande EANs via buscar-produto ✅
- Promoções do Dia - Estoque/Filtro apresentação ✅
- **Encomendas: codProdutoDist + codProduto nunca vazios** ✅
- **Encomendas: confirmação só dispara após saveOrder OK** ✅

### O Que Está Pendente (Testar)
- **Encomenda real:** Testar importação de encomenda → selecionar oferta → faturar → verificar que item aparece no faturamento SmartPed
- **Dropdown:** Verificar que selecting different offer in ConditionSelector herda codProduto corretamente
- **Vendas Promoções do Dia:** CETOCONAZOL SH deve mostrar "1/mês" (filtro apresentação)

## Arquivos Modificados Nesta Sessão
- `server.ts`: saveOrder antes de res.json (6207-6226), confirmação condicional (6240-6265), enriquecimento CodProdutoDist batch (2152-2172), normalização codProduto (2175-2192)
- `src/App.tsx`: offerCodProd fallback para offerCodProdDist (548, 731)
- `src/hooks/useManualSearch.ts`: offerCodProd fallback (270)
- `src/hooks/useOptimizationResult.ts`: codProduto fallback duplo (400-404)

## Regras Importantes
- **AGENTS.md #24/#25:** Deploy APENAS com autorização explícita do usuário
- **AGENTS.md #35:** CodProdutoDist vem EXCLUSIVAMENTE de Condicoes/Ean
- **AGENTS.md #36:** Dropdown NUNCA mostra alternativas com codProdutoDist vazio
- **AGENTS.md #54:** Cálculo de vendas — método único nos 3 fluxos (ANDAM JUNTOS)
- **AGENTS.md #55:** Filtro de apresentação obrigatório na expansão de EANs

## Documentação
- `api ferramentinhas.txt` disponível na pasta raiz — SEMPRE consultar antes de usar endpoints Ferramentinhas
