# Contexto Ativo — Sessão 2026-08-19

## Estado Atual

**Última atualização:** 2026-08-19 (Panambi/UTC-3)

## O Que Foi Feito Nesta Sessão

### Melhorias de Performance
1. **`fetchWithRetry`** — nova função `server.ts:536` que combina timeout (AbortController 15s) + retry (1 tentativa extra, delay 2s)
2. **Chamadas batch otimizadas** — `Condicoes/Ean` + `Condicoes/Molecula` no loop de 40 EANs usam `fetchWithRetry(url, opts, 15000, 1)`
3. **RUPTURA-REGEX** — `Condicoes/Ean` por EAN individual + `Produtos/Buscar` por descrição usam `fetchWithRetry`
4. **Fallback principios ativos** — chamada Ferramentinhas `similares/{ean}` atualizada
5. **Deduplicação EANs** — `queriedEanSet` evita chamadas duplicadas cross-item no RUPTURA-REGEX

### Análise de Log (optimize-1787114343885.log)
- 137 itens SICF, 212 EANs expandidos
- 6 batches API, todos 200 OK (retry não foi necessário)
- 119 buscas RUPTURA-REGEX concluídas
- 94 itens FILTRO-REMOVIDO (dist-invalida / estoque-zero)

### Problema Identificado: LOSARTANA dropdown vazio
- EAN 7896714208565 entrou em fallback (sem estoque no batch)
- Produtos/Buscar retornou 26 ofertas
- **EQUIV-FILTER** (`validateSwapEquivalence`) removeu 25 de 26 substitutos
- SUBS-FILTER removeu o último restante
- Resultado: `finalAlternatives=0`, dropdown vazio
- `condicoesEnriched=0` mesmo com ofertas reais

**Próximo passo:** Investigar `swap-validation.ts` (raiz do projeto) para entender por que `validateSwapEquivalence` filtra tão agressivamente

## Pendências

- **Investigar `validateSwapEquivalence`** — EQUIV-FILTER remove 25/26 substitutos LOSARTANA
- **Bug #38:** UX dropdown não separa "Mesmo Produto" vs "Genéricos/Similares"
- **Bug #39:** Performance SICF + encomendas simultâneos
- **Deploy:** Timeout/retry pendente de deploy

## Ambiente

- `npm run dev` (porta 3000) — local
- Cloud Run: `smartped-cli-887122622666.us-east1.run.app`
- Versão: `v2026-08-18-1830` | Branch: `master`
