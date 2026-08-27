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

### Feature — Painel "Regras de Otimização" (Parte A + B)

6. **3 toggles novos em OptimizerConfig (src/types.ts)**
   - `alertaProfarma48h` — alerta de duplicidade Profarma 48h (default: true)
   - `alertaConfirmarQtdCaixaMaster` — bloqueio caixa master/fracionado (default: true)
   - `bypassMargemRuptura` — bypass margem na ruptura total (default: true)

7. **Backend: bypassMargemRuptura (server/swap-engine.ts)**
   - Novo param `bypassMargemRuptura` em `findBestSubstitute`
   - Quando false, força filtro margemMinima mesmo em ruptura (antes ignorava)
   - Threadado nas 2 chamadas em server.ts

8. **Backend: alertaConfirmarQtdCaixaMaster (server.ts)**
   - Quando false, força `alertaConfirmarQtd: false` no report (linhas 5885 e 6085)

9. **Frontend: UI painel (src/components/UploadBox.tsx)**
   - Painel "Regras de Otimização" abaixo de "Distribuidoras Disponíveis"
   - 3 checkboxes com labels, mesmo padrão visual das distribuidoras
   - Props config + onConfigChange passadas via App.tsx

10. **Parte B: Profarma 48h com verificação de entrada (SwapsTable.tsx)**
    - `profarmaRecentOrdersEans`: Set<string> → Map<string, string> (ean → dataPedido)
    - Novo endpoint proxy `GET /api/produtos/compras-historico/:ean` (server.ts)
    - useEffect assíncrono verifica se item já foi recebido (compras com fornecedor PROFARMA + dataEntrada >= dataPedido)
    - `profarmaConfirmedEntries` state: itens com entrada confirmada são suprimidos do alerta
    - Toggle `alertaProfarma48h === false` pula toda a checagem

### Fix — "Não Encontrados" voltando ao relatório

11. **Filtro removido em server.ts:6234-6246**
    - Commit 7df0a0f (14/08) adicionou filtro que removia itens "Não Encontrados" (dist inválida ou estoque 0) do report final
    - Frontend (SwapsTable.tsx) tem seção dedicada com badge "PRODUTOS NÃO ENCONTRADOS" e banner de busca manual — que nunca recebia dados
    - Filtro removido: `report` volta ao frontend sem cortes
    - Alerta registrado: NUNCA remover itens do report sem confirmar que o frontend não depende deles pra seção própria (entrada #19 CEGUEIRA ANTIGA)

### Refatoração — Hook useProfarmaAlertCheck

12. **Extração de hook compartilhado (src/hooks/useProfarmaAlertCheck.ts)**
    - Lógica de detecção duplicidade Profarma 48h estava duplicada em SwapsTable.tsx (alerta visual) e useOptimizationResult.ts (modal de bloqueio)
    - Versão do SwapsTable tinha fix de checagem de entrada (proxy compras-historico) e fix UTC vs local — versão do useOptimizationResult NÃO tinha
    - Resultado: modal de bloqueio continuava alertando pra itens com entrada confirmada
    - Hook expõe: `isEanProfarmaAlerted(ean)`, `getProfarmaOrderDate(ean)`
    - Ambos os consumidores agora usam a mesma lógica centralizada
    - Lição: quando a mesma regra de negócio precisa valer em 2+ lugares, extrair hook compartilhado (entrada #20 CEGUEIRA ANTIGA)

### Feature — Grupo "Aguardando Chegar Profarma"

13. **Reclassificação de itens faturados sem entrada (SwapsTable.tsx)**
    - Regra: se item foi faturado pela Profarma recentemente (janela 48h) mas NÃO tem entrada confirmada, ofertas de outros fornecedores são ignoradas e item vai pra grupo novo "Aguardando Chegar Profarma"
    - Motivo: Profarma às vezes segura pedido (não bate mínimo) mas já marca como faturado — vai entregar depois. Mostrar oferta normal arriscaria duplicar
    - Implementação: reutiliza `isEanProfarmaAlerted()` do hook `useProfarmaAlertCheck` (já disponível em SwapsTable.tsx)
    - Grupo tratado como virtual (junto com "Não Encontrados" e "Sem Estoque") no sort e na lógica de UI
    - Badge: `⏳ AGUARDANDO CHEGAR PROFARMA` (amber)
    - Banner explicativo com instrução de ação (aguardar entrega ou cancelar na Profarma)

### Migração de fonte — Profarma: dailyOrders → itens_confirmados

14. **Fonte de dados trocada de dailyOrders/SmartPed pra itens_confirmados/Turso**
    - dailyOrders/DataPedido era pouco confiável (SmartPed retornava data que não batia com o pedido real)
    - Nova fonte: tabela `itens_confirmados` (Turso), alimentada por `/api/itens-confirmados-do-dia` com status="faturado" e `created_at` (setado apenas no INSERT, nunca reescrito no ON CONFLICT — ao contrário de `updated_at` que é resetado a cada resync)
    - Regra simplificada: teve faturado na Profarma + sem entrada depois = pendente (sem janela de 48h)
    - Backend: `getProfarmaFaturadosPendentes(cnpj)` em database.ts + endpoint `/api/profarma-faturados-pendentes`
    - Frontend: `useProfarmaAlertCheck(cnpj, enabled)` — busca do endpoint, checagem de entrada via compras-historico mantida
    - Sync automático: `handleOptimize` agora chama `/api/itens-confirmados-do-dia` antes de otimizar

### Arquivos Modificados Nesta Sessão
- `server/database.ts` — `savePrecosCacheBatch` batch Turso, nova `saveItensConfirmadosBatch`, nova `getProfarmaFaturadosPendentes`
- `server.ts` — import `saveItensConfirmadosBatch`/`getProfarmaFaturadosPendentes`, loop itens confirmados → batch, fix timezone encomendas, proxy compras-historico, params `bypassMargemRuptura`/`alertaConfirmarQtdCaixaMaster`, remoção filtro "Não Encontrados", novo endpoint `/api/profarma-faturados-pendentes`, fix dataPedido variações
- `server/swap-engine.ts` — param `bypassMargemRuptura` em `findBestSubstitute`
- `src/types.ts` — campos `alertaProfarma48h`, `alertaConfirmarQtdCaixaMaster`, `bypassMargemRuptura` em `OptimizerConfig`
- `src/hooks/useOptimizerConfig.ts` — defaults `true` para os 3 novos campos
- `src/hooks/useOptimizationResult.ts` — envio dos 3 novos campos, refatorado pra usar `useProfarmaAlertCheck`, sync itens_confirmados no handleOptimize
- `src/hooks/useProfarmaAlertCheck.ts` — REESCRITO: fonte agora é itens_confirmados via endpoint (não mais dailyOrders)
- `src/components/UploadBox.tsx` — painel "Regras de Otimização" com 3 toggles (textos simplificados)
- `src/components/SwapsTable.tsx` — refatorado pra usar `useProfarmaAlertCheck(cnpj)`, fix UTC vs local, data no alerta, grupo "Aguardando Chegar Profarma"
- `src/components/ConditionSelector.tsx` — skip para "Não Encontrados"/"Sem Estoque"
- `src/App.tsx` — props config/onConfigChange no UploadBox
- `src/hooks/useBilling.ts` — confirmação de encomenda por distribuidora (não espera lote inteiro), `confirmedEncomendaIds`
- `src/main.tsx` — `<App />` envolto por `<ErrorBoundary>`
- `src/components/ErrorBoundary.tsx` — NOVO: classe com `getDerivedStateFromError` + `componentDidCatch`
- `package.json` / `package-lock.json` — `@types/react` e `@types/react-dom` adicionados como devDependencies
- `AGENTS.md` — entradas #18-22 (CEGUEIRA ANTIGA), lista de erros pré-existentes

### Fechamento de sessão — 2026-08-27 (último lote)

15. **Confirmação de encomenda por distribuidora** (não espera lote inteiro)
    - Antes: `confirmarEncomendasAposRetorno` só rodava dentro de `if (isAllFinalized)` — se uma distribuidora demorava, segurava confirmação de todas
    - Agora: roda em **toda iteração** de `checkReturn`, verificando por encomenda quais `codDist` já estão `Status === 3`
    - `confirmedEncomendaIds` (novo state em `useBilling.ts`) evita re-confirmação no mesmo ciclo
    - Reset: novo Set toda vez que `billingContext` é criado

16. **ErrorBoundary adicionado**
    - `src/components/ErrorBoundary.tsx` — classe com `getDerivedStateFromError` + `componentDidCatch`
    - `src/main.tsx` — `<App />` envolvido por `<ErrorBoundary>`
    - Objetivo: tela branca → mensagem de erro com stack trace, auxiliando diagnóstico

17. **Descoberta: `@types/react` nunca foi instalado**
    - O projeto usava React 19 sem `@types/react`/`@types/react-dom` — hooks funcionavam via `jsx-runtime` do Vite, mas a classe `Component` não tinha definição de tipo
    - Instalação como devDependency revelou **27 erros TypeScript pré-existentes** em arquivos não relacionados a nenhuma mudança desta sessão
    - Confirmado via `git stash` + lint no HEAD limpo — mesmos erros. São erros silenciosos de tipos que existiam desde antes
    - **Decisão: adiar fix desses 27 erros pra outra sessão** — não são bloqueadores, o sistema funciona normalmente
    - Lista completa dos erros: ver CEGUEIRA ANTIGA #22 em AGENTS.md

### Erros TypeScript pré-existentes (27, adiados)

> Estes erros existem desde antes de qualquer mudança desta sessão. Confirmados via `git stash` + lint no commit anterior.
> Instalando `@types/react` o TypeScript passa a checar os tipos React corretamente e revela esses gaps.

| # | Arquivo | Erro resumido |
|---|---------|---------------|
| 1 | App.tsx:93 | `"whatsapp_orders"` não atribuível ao union type |
| 2 | App.tsx:130 | `Set<number>` vs `Set<string>` |
| 3 | App.tsx:355 | `precoLiquido` não existe no tipo |
| 4 | App.tsx:1237 | `optimizedFileContent` ausente em literal |
| 5 | App.tsx:1327 | Idem #4 |
| 6 | App.tsx:1572 | Assinatura `MouseEventHandler` incompatível |
| 7 | App.tsx:2128 | Callback com 2 args vs 1 esperado |
| 8 | OfertasDoDiaModal.tsx:880 | `laboratorio` não existe em `CompraHistorico` |
| 9 | SimilarProductsModal.tsx:367 | `title` não existe em LucideProps |
| 10 | SwapsTable.tsx:1589 | `alertaConfirmarQtd` não existe em `SwapReportItem` |
| 11 | WhatsAppOrdersView.tsx:173 | `string` vs union de status |
| 12-14 | useBilling.ts:277,285,450 | `notaCupom` não existe em `FaturadoItem` |
| 15-16 | useOptimizationResult.ts:476,780 | `originalDist` não existe em `SwapReportItem` |
| 17 | useOptimizationResult.ts:477 | `originalCodDist` não existe |
| 18-19 | useOptimizationResult.ts:478,486 | `originalEstoque` → queria `originalSemEstoque` |
| 20-21 | useOptimizationResult.ts:479 | `originalPrecoCotado` → queria `originalPreco` |
| 22 | useOptimizationResult.ts:480 | `originalCondicao` não existe |
| 23 | useOptimizationResult.ts:481 | `originalCodProdutoDist` não existe |
| 24 | useOptimizationResult.ts:482 | `originalPrazo` não existe |
| 25 | useOptimizationResult.ts:483 | `originalCodProduto` não existe |
| 26 | useOptimizationResult.ts:560 | `isProfarmaAlertAck` não existe no tipo |
| 27 | useOptimizationResult.ts:564 | `alertaConfirmarQtd` não existe no tipo |

## Regras Importantes
- **Tudo de vendas/estoque vem do Ferramentinhas** — SmartPed só para pricing
- **erpEans ≠ eanList** — erpEans = Ferramentinhas, eanList = Ferramentinhas + SmartPed
- **Word boundary obrigatório** em filtros de apresentação
- **Wildcard Trier:** quando buscar-lote retorna vazio, tentar `PRINCÍPIO%`
- **estoqueTotal** = `similares/{ean}` (Ferramentinhas), NÃO `eansGrupo`
- **Encomendas:** confirmação DEPOIS do retorno, nunca antes
- **codProduto:** herança para TODOS os itens (manual, encomenda, qualquer origem)
- **resolveCategoria:** SEMPRE normalizar acentos antes de `.includes()` — API Ferramentinhas retorna "Genérico" (com acento)
