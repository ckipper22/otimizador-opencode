# Contexto Ativo — Última Sessão: 2026-08-27 (Turso batch)

## Status do Sistema
- **Versão:** v2026-08-26 (deploy smartped-cli-00069-jzq)
- **URL:** https://smartped-cli-887122622666.us-east1.run.app
- **GitHub:** pushes 26/08 (4 commits)

## Sessão 2026-08-26 — Apresentação, Vendas, WhatsApp e Segurança

### Fixes

1. **mesmaApresentacao() — matching por dosagem/DCB (server/parsers.ts)**
   - Matching por dosagem/DCB quando item do pedido não tem DCB (regex de descrição extraída)
   - DCB emprestado da própria lista de similares quando ausente
   - Liberação prolongada (L.P./XR) separada de comprimido normal (`liberacaoProlongada` flag)

2. **Endpoint /vendas-resumo (server.ts)**
   - Criado `/api/chatbot/produto/vendas-resumo` substituindo `/vendas-detalhadas` (tinha LIMIT 100, subestimava giro rápido)
   - Helper `fetchVendasResumo()` unificado para chamadas internas

3. **Matching de regra WhatsApp — por whatsappRuleId (server.ts)**
   - Trocado de texto (laboratório/descrição) para `whatsappRuleId` direto — mais confiável

4. **Segurança: remoção de secrets hardcoded**
   - Token SmartPed e senha admin removidos do frontend e backend
   - Autenticação client-side insegura removida — login agora só via Google/Firebase

### Deploy
- 4 commits (security, fix apresentação/vendas, feat WhatsApp, docs)
- Push pro GitHub + deploy Cloud Run (smartped-cli-00069-jzq) — verificado no ar, sem segredos no bundle

### O Que Funciona
- `mesmaApresentacao()`: matching robusto com DCB emprestado e L.P./XR separado ✅
- Vendas-resumo: endpoint unificado, sem LIMIT 100 ✅
- WhatsApp regra: matching por whatsappRuleId (não mais texto) ✅
- Segurança: zero secrets no bundle, login só via Firebase ✅
- Encomendas: confirmação só após retorno SmartPed ✅
- codProduto: herança para TODOS os itens ✅
- `resolveCategoria`: acentos normalizados ✅

### O Que Está Pendente
- Documentação reorganizada em `memorias/` + `docs/_archive/`

### Fix Adicional — WhatsApp Lab Match Bug (server.ts)
- **Bug:** comparação `a.includes(b) || b.includes(a)` de laboratório sem checar string vazia — qualquer item/alternativa sem laboratório preenchido dava falso-positivo e era roteado para grupo WhatsApp indevidamente
- **Correção em 3 pontos:**
  1. server.ts:3061 — roteamento do item pro grupo WhatsApp: `labUpper !== "" && (labUpper.includes(termoUpper) || termoUpper.includes(labUpper))`
  2. server.ts:4089 — filtro do item original SmartPed: `origLabWa !== "" && [...whatsappLabNames].some(...)`
  3. server.ts:4115 — filtro dos substitutos SmartPed: `sLab !== "" && [...whatsappLabNames].some(...)`
- `termoUpper` já garantido não-vazio pelo `if (!termoUpper) continue;` na linha 3059

### Arquivos Modificados Nesta Sessão
- `server/parsers.ts` — `mesmaApresentacao()` (DCB emprestado, L.P./XR, dosagem)
- `server.ts` — `/api/chatbot/produto/vendas-resumo`, `fetchVendasResumo()`, matching WhatsApp por `whatsappRuleId`
- Segurança: remoção de tokens/senhas hardcoded (frontend + backend)
- `memorias/` + `docs/_archive/` — reorganização da documentação

## Sessão 2026-08-26 (performance) — Otimização de /api/optimize

### Fixes

1. **Fallback ALERTA reusa marketSimilarMap (server.ts ~5295)**
   - `fetchSimilarGenerics(item.ean)` trocado por `marketSimilarMap[cleanEan(item.ean)] || []`
   - Elimina 43 chamadas de rede sequenciais (~1,7s cada) dentro do loop → FASE-4 de 84s para <10s

2. **FASE-5 estoque reusa marketSimilarMap (server.ts ~4022)**
   - Mesma correção aplicada ao cálculo de estoqueTotal, mantendo o filtro `_origem !== "smartped"` já usado em outros pontos do FASE-5
   - FASE-5 de 42s para 8s

3. **fetchSimilarGenericsBatch paralelizado (server/smartped-api.ts:91)**
   - for sequencial → Promise.all nos lotes de 40 EANs
   - FASE-2 de 33s para 11s
   - Bônus: corrigido bug onde `!response.ok` pulava sem preencher `result[ean] = []`

4. **Try/catch defensivo no loop principal (server.ts ~4181-6194)**
   - Protege contra exceção não tratada em um item derrubar o processamento silenciosamente — loga `[ITEM-ERRO-FATAL]` com EAN + stack e preserva a linha original no output

### O Que Funciona
- Pedido real de 204 itens: 3min40s → 50s (~78% mais rápido) ✅
- Nenhuma mudança de resultado/comportamento verificada across múltiplos testes reais ✅
- Instrumentação de timing (TIMING-BREAKDOWN, TIMING-FINDBEST, TIMING-TARGET-EAN, TIMING-FALLBACK-SIMILARES) permanece no código pra futuras investigações ✅

### Arquivos Modificados Nesta Sessão
- `server.ts` — fallback ALERTA + estoque FASE-5 reusam marketSimilarMap, try/catch defensivo no loop principal, instrumentação de timing
- `server/smartped-api.ts` — fetchSimilarGenericsBatch paralelizado

## Sessão 2026-08-27 — Escritas Turso batch + WhatsApp lab fix

### Fixes

1. **savePrecosCacheBatch → Turso batch (server/database.ts:590)**
   - Branch USE_TURSO: `for...await d.run()` sequencial → `d.batch(statements)` 1 round-trip
   - Branch better-sqlite3 (local) mantida sequencial (sem rede, aceitável)

2. **saveItensConfirmadosBatch nova (server/database.ts:448-479)**
   - Função nova seguindo padrão dos outros `saveXBatch` existentes
   - Reaproveita a mesma SQL do `saveItemConfirmado` (INSERT ON CONFLICT DO UPDATE)
   - Branch USE_TURSO: `d.batch(statements)` 1 round-trip
   - Branch better-sqlite3: loop sequencial

3. **Loop /api/itens-confirmados-do-dia → batch (server.ts:7189-7204)**
   - `for...await saveItemConfirmado()` → `await saveItensConfirmadosBatch()`
   - Desbloqueia a resposta HTTP antes do res.json()

4. **WhatsApp lab match falso-positivo (server.ts:3061, 4089, 4115)**
   - `.includes()` bidirecional sem checar string vazia → blindado com `lab !== ""`

### O Que Funciona
- `tsc --noEmit` limpo ✅
- Escritas Turso: 1 round-trip em vez de N ✅
- Leitores Turso: `Promise.all` (já existia) ✅
- WhatsApp lab: falso-positivo com string vazia eliminado ✅

### Fixes

5. **Fuso horário encomendas +3h (server.ts:2214)**
   - `toLocaleString('pt-BR', ...)` sem `timeZone` → Cloud Run formatava em UTC em vez de Panambi (UTC-3)
   - Adicionado `timeZone: 'America/Sao_Paulo'` — corrige os dois returns da função (linhas 2417 e 2439)

### Arquivos Modificados Nesta Sessão
- `server/database.ts` — `savePrecosCacheBatch` batch Turso, nova `saveItensConfirmadosBatch`
- `server.ts` — import `saveItensConfirmadosBatch`, loop itens confirmados → batch, fix timezone encomendas
- `AGENTS.md` — entrada #18 (CEGUEIRA ANTIGA)

## Regras Importantes
- **Tudo de vendas/estoque vem do Ferramentinhas** — SmartPed só para pricing
- **erpEans ≠ eanList** — erpEans = Ferramentinhas, eanList = Ferramentinhas + SmartPed
- **Word boundary obrigatório** em filtros de apresentação
- **Wildcard Trier:** quando buscar-lote retorna vazio, tentar `PRINCÍPIO%`
- **estoqueTotal** = `similares/{ean}` (Ferramentinhas), NÃO `eansGrupo`
- **Encomendas:** confirmação DEPOIS do retorno, nunca antes
- **codProduto:** herança para TODOS os itens (manual, encomenda, qualquer origem)
- **resolveCategoria:** SEMPRE normalizar acentos antes de `.includes()` — API Ferramentinhas retorna "Genérico" (com acento)
