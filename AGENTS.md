# Diretrizes de Operação do Sistema

> **Contexto completo:** ver `docs/mapa-sistema.md` + `docs/arvore-decisoes-busca-api.md`. Histórico arquivado (até 2026-08-27) em `docs/_archive/memorias/`.
> **Mapa do sistema (arquitetura, APIs, banco):** ver `docs/mapa-sistema.md`

---

## Onde documentar o quê

> **Antes de documentar algo, checar essa tabela pra saber o arquivo certo — não adivinhar.**
> Se o conteúdo for uma árvore de decisão/fluxo de API, ele NÃO vai inteiro no AGENTS.md — vai na árvore, com ponteiro curto no AGENTS.md.

| Tipo de conteúdo | Vai em |
|---|---|
| Bug corrigido (o quê, causa raiz, fix, arquivo:linha) — curto | AGENTS.md, tabela CEGUEIRA ANTIGA |
| Regra permanente de negócio/comportamento esperado — curto | AGENTS.md, seção temática própria |
| Árvore de decisão de matching/busca (qual API chamar, em que ordem, como decidir entre opções) — pode ser longo | `docs/arvore-decisoes-busca-api.md`, seção numerada nova. AGENTS.md só ganha um ponteiro de 2-3 linhas. |
| Schema de banco (tabela/coluna nova, quem lê/escreve) | `docs/mapa-sistema.md` |
| Integração com sistema externo (Encomendas, Chatbot, etc.) | `docs/encomendas-integracao.md` ou arquivo equivalente dedicado ao sistema |
| Regra de processo (como trabalhar, não sobre o código) | AGENTS.md, seção "Regras de Processo" |

---

## CEGUEIRA ANTIGA — Bugs já resolvidos (NÃO tentar corrigir novamente)

| # | Bug | Correção | Onde |
|---|-----|----------|------|
| 1 | Deploy apaga env vars | `--env-vars-file cloud-env.yaml` (NUNCA `--set-env-vars`) | DEPLOY.md |
| 2 | Porta 3000 no Cloud | `NODE_ENV: "production"` no cloud-env.yaml | server/config.ts |
| 3 | QtdMin sempre 0 | Chamar `Condicoes/Ean` + `Condicoes/Molecula` em `Promise.all` | regra #12 |
| 4 | Cache morre no restart | L2 (Turso) persiste. Ler L1→L2, escrever em ambos | regra #13 |
| 5 | SIGSEGV no Cloud | better-sqlite3 causava crash. Usar Turso em produção | regra #15 |
| 6 | PMC não aparece | `offer.PMC \|\| offer.pmc` (case-sensitivity) | regra #30 |
| 7 | Dedup por preço errado | Chave: `${Ean}_${CodDist}_${Condicao}_${Prazo}` (sem preço) | regra #16 |
| 8 | Encomendas "Não autorizado" | `--env-vars-file` com TODAS as variáveis | DEPLOY.md |
| 9 | Encomendas preço R$ 0.00 | Normalizar PascalCase→lowercase antes de retornar | regra #32 |
| 10 | Mojibake em nomes dist. | Usar `isNotFoundName()` — NUNCA `dist.includes("NÃO ENCONTRADOS")` | regra #33 |
| 11 | Firebase Auth null | Usar `getFirebaseAuth()` async — NUNCA importar `auth` direto | firebaseClient.ts |
| 12 | Cross-contamination batch | Filtro `eansDoGrupo` em `_sourceEan` antes de usar condições | regra #49 |
| 13 | L.P./REV junto no estoque | `liberacaoProlongada` flag em `classificarProduto()` | parsers.ts |
| 14 | /api/optimize levava 3min+ | 3 pontos refaziam fetch de dado já carregado em `marketSimilarMap` na mesma requisição (fallback ALERTA, estoque FASE-5, batch sequencial) | server.ts, server/smartped-api.ts |
| 15 | fetchSimilarGenericsBatch sequencial | `for...await` dentro do loop de lotes → trocado por `Promise.all` nos lotes | server/smartped-api.ts:91 |
| 16 | Refetch de similares já em memória | Sempre checar `marketSimilarMap[ean]` (carregado 1x no FASE-2) antes de chamar fetchSimilarGenerics(Batch) de novo dentro do loop principal | server.ts |
| 17 | WhatsApp lab match falso-positivo | `a.includes(b) \|\| b.includes(a)` sem checar string vazia — item sem lab matchava regra. Blindar: `lab !== "" && (lab.includes(termo) \|\| termo.includes(lab))` | server.ts:3061, 4089, 4115 |
| 18 | Escritas Turso N round-trips | `for...await` com `d.run()` sequencial em loops de escrita (savePrecosCacheBatch, saveItemConfirmado) → usar `d.batch(statements)` pra 1 round-trip. Ler lembra-se: `Promise.all` pra leitores, `batch` pra escritores | server/database.ts, server.ts |
| 19 | "Não Encontrados" sumiu do relatório | Filtro em server.ts removia itens sem estoque/smartped do report final — mas frontend tem seção dedicada pra eles. NUNCA remover itens do report sem confirmar que o frontend não depende deles pra seção própria | server.ts:6234-6246 |
| 20 | Lógica Profarma duplicada em 2 arquivos | Mesma regra de negócio (detecção duplicidade Profarma 48h) implementada em SwapsTable.tsx E useOptimizationResult.ts — corrigir um sem corrigir o outro deixava comportamento inconsistente entre tabela e modal de bloqueio. Extrair hook compartilhado quando a mesma regra precisa valer nos dois lugares | src/hooks/useProfarmaAlertCheck.ts |
| 21 | Profarma "faturado agora" sempre | `getProfarmaFaturadosPendentes` usava `updated_at` como data do faturamento — mas `updated_at` é reescrito a cada resync via ON CONFLICT DO UPDATE SET updated_at = datetime('now'), fazendo todo item parecer "faturado agora". Usar `created_at` (setado só no INSERT, nunca reescrito) | server/database.ts |
| 22 | `@types/react` nunca instalado (27 erros ocultos) | Projeto usava React 19 sem `@types/react`/`@types/react-dom` — hooks funcionavam via jsx-runtime do Vite, mas classe Component não tinha definição de tipo. Instalação revelou 27 erros TypeScript pré-existentes (tipos incompletos de SwapReportItem, FaturadoItem, App.tsx). Confirmado via `git stash` + lint no HEAD limpo. **Adiar fix pra outra sessão** — não são bloqueadores | src/types.ts, src/App.tsx, src/hooks/*.ts |
| 23 | Botão "P" sem estoque por laboratório | `classificarProduto()` lê `item.descricao`, mas `analisar-referencia` monta o objeto `product` com chave `description` (inglês) — `mesmaApresentacao()` falha silenciosamente. Fix: adicionar `item.description` como fallback na cadeia de descrição de `classificarProduto()` (parsers.ts:508) | server/parsers.ts:508, server.ts |
| 24 | Sino de observação duplicava fetch (152 chamadas) | Cada linha do relatório fazia fetch `/api/similares/:ean` via IntersectionObserver. SwapsTable renderiza DUAS visões simultâneas (flat + agrupada), cada linha disparava 2x. Fix: backend enriquece report com `avisoOriginal`/`avisoNovo` (server.ts) — ObservationBell vira 100% presentational. Exceção: OrderReturnView usa `ObservationBellFetcher` local (1 instância, sem duplicação) | server.ts, src/components/ObservationBell.tsx, src/components/OrderReturnView.tsx |
| 25 | Alerta Profarma 48h estourava rate limiter | Hook instanciado em 2 lugares, buscava TODOS os 76 EANs pendentes Profarma do sistema, `Promise.all` irrestrito (~152 chamadas simultâneas), inclusive antes de qualquer SICF importado. Fix: batching de 8 EANs + novo parâmetro `relevantEans` (só EANs do relatório atual) — zero chamadas ao abrir sem importar, só EANs do pedido específico ao importar | src/hooks/useProfarmaAlertCheck.ts, src/components/SwapsTable.tsx, src/hooks/useOptimizationResult.ts |
| 26 | Timestamps misturados causavam filtro de data vazio | `data_adicao` salvo em UTC puro, mas `created_at`/`updated_at` usavam `datetime('now', '-3 hours')` — comparação lexicográfica de string nunca casava com data pura. Fix: migrar tudo pra UTC puro (`NOW_UTC = "datetime('now')"`), parse com `+'Z'` no frontend, exibição com `toLocaleString('pt-BR', {timeZone: 'America/Sao_Paulo'})` | server/database.ts, src/hooks/useProfarmaAlertCheck.ts, src/hooks/useOptimizationResult.ts, src/components/SwapsTable.tsx |
| 27 | Turso nunca recebeu migração de origem/id_encomenda | `initTursoSchema()` (usado por local E produção — ambos compartilham o mesmo Turso, confirmado via .env local) só migrava colunas de external_suppliers. As migrações de origem/id_encomenda pra itens_manuais/order_items/itens_confirmados só existiam em `runMigrations()`, usado exclusivamente no caminho SQLite puro sem Turso — nunca executava contra o banco real. Todo INSERT tentando gravar `origem` falhava silenciosamente desde sempre. Fix: replicar as 6 migrações ALTER TABLE em `initTursoSchema()` | server/database.ts:254-270 |
| 28 | Falhas de escrita no Turso 100% silenciosas (2 camadas) | `saveItemManual` tinha `catch {}` interno que engolia qualquer erro do INSERT, e o endpoint nunca checava o retorno — sempre respondia sucesso mesmo com falha real. Os 3 call sites do frontend (useManualSearch.ts, App.tsx x2) também nunca checavam `response.ok` — `fetch()` só rejeita em falha de rede, não em HTTP 4xx/5xx. Fix: catch agora loga e relança (throw) no backend; frontend agora checa `response.ok` e loga o corpo do erro real | server/database.ts, src/hooks/useManualSearch.ts, src/App.tsx |
| 29 | Excluir/editar item manual não atualizava a tela sem F5 | `useMemo` de `filteredItems` (DailyItemsView.tsx) usa `manuaisAdicionados` no cálculo mas não listava como dependência — exclusão/edição atualizava o estado por baixo mas a lista renderizada só recalculava com F5. Fix: adicionar `manuaisAdicionados` às dependências | src/components/DailyItemsView.tsx |
| 30 | Data/hora de itens confirmados sempre mostrava "agora" | `/api/pedido-retorno` (chamado a cada 2s durante faturamento ativo) nunca salvava nada no Turso — só `/api/itens-confirmados-do-dia` salvava, e só depois, incidentalmente, quando alguém abria a tela "Itens do Dia". O `created_at` refletia "quando a tela foi aberta depois", não o momento real do faturamento. Fix: `/api/pedido-retorno` agora salva TODOS os itens do retorno (faturados e não confirmados) no momento real, via `saveItensConfirmadosBatch` — ON CONFLICT preserva `created_at` em chamadas repetidas | server.ts (~linha 7529, dentro de /api/pedido-retorno) |
| 31 | Cross-contamination SmartPed: PASSO 1.5 sem filtro de dosagem | Busca wildcard `Produtos/Buscar` (wildcards.slice(0,3) incluia genérico "MUCOSOLVAN%XAROPE") retornava EAN de formulação diferente (PED 15MG vs AD 30MG mesmo DCB). EAN contaminado entrava em `smartPedEans` → `eanList` → `analisarUmProduto` → `Condicoes/Ean`, misturando preço/estoque adulto com pediátrico. REF-FILTER-EAN não pegava (EANs SmartPed não estão no ERP). Fix: aplicar mesmo filtro `origDosage` (regex `/(\d+)\s*(mg|mcg|g|ml|ui|%)/i` em `prod.Descricao`) que já existia em `eansGrupo` (linhas 1377-1402) e PASSO EXTRA `analisarUmProduto` (linhas 809-820) ANTES de adicionar ao `smartPedEans` | server.ts:1413-1451 (PASSO 1.5) |
| 32 | Filtro de dosagem comparava só número, não unidade | Regex `/(\d+)\s*(mg|mcg|g|ml|ui|%)/i` capturava número E unidade, mas os 4 pontos de comparação só checavam grupo 1 (número) — "10mg" passaria como igual a "10mcg" (1000x diferença). Fix: criar helper `mesmaDosagem()` em `server/parsers.ts` que compara número E unidade (normalizada lowercase), refatorar os 4 pontos: PASSO EXTRA `analisarUmProduto` (812), DCB grouping primário (1400), DCB grouping fallback (1410), PASSO 1.5 wildcards (1435) | server/parsers.ts:321, server.ts (4 locais) |
| 33 | Referência agrupada por DCB em analisarFornecedorEmBackground | `analisarFornecedorEmBackground` (~1397-1420) agrupava todos os produtos por DCB+dosagem sem verificar se é referência/marca — mas regra de ouro (implementada em `analisarUmProduto` via cdb7ced) diz que referência nunca busca similares. Consequência: referência (ex: MUCOSOLVAN PED) tinha `eansGrupo` vazio (dosagem não batia entre descrição promo e catálogo), vendasMensais=0. Fix: antes do agrupamento DCB, resolver categoria via `resolveCategoria()` — se "marca", pular e setar `eansGrupo = [EAN próprio]` direto | server.ts:1404-1416 |
| 34 | Fornecedor externo no SICF ignorava EAN existente + preço zerado bloqueava oferta | Bloco `externalSuppliers` em `/api/optimize` (~5657) nunca comparava `extProd.ean` com `item.ean` — todo matching era por texto (score >= 0.6), fraco e propenso a falso-negativo. Além disso, quando `bestSmartPedPrice <= 0` (sem preço SmartPed nem original), a condição `(bestSmartPedPrice - price) >= margemMinima` nunca fechava — fornecedor com preço real era ignorado. Fix: (A) EAN exato como caminho primário antes do texto, via `cleanEan(extProd.ean) === cleanEan(item.ean)`; (B) branch separada quando `bestSmartPedPrice <= 0`: aceita price > 0 sem checar margemMinima; (C) price null → nota em `observacao` ("fornecedor trabalha com item, sem preço") | server.ts:5657-5823 |
| 35 | Polling de retorno pós-faturamento travou tela com 82 itens | `handleCheckOrderReturn` (useBilling.ts) rodava a cada 2s via `setInterval`, gerando ~30 req/min contra rate limiter de 120/min. Com lote grande (82 itens, 6 dists), estourou o limite — e cada falha disparava `alert()` bloqueante em loop (fecha um, aparece outro 2s depois). Fix: (A) intervalo base 2s→7s; (B) `setInterval` → `setTimeout` auto-agendado com backoff (7s base, até 30s após falhas); (C) alert bloqueante removido — falhas transitórias só logadas, aviso visual após 5 falhas seguidas (~35s); (D) detecção de 429 com recuo de 30s | useBilling.ts:586-689 |
| 36 | Sandbox/simulação removido de propósito | `useTestUrl`, `simulationMode`, `isSandboxToken`, `SMARTPED_SANDBOX_TOKEN`, `SMARTPED_SANDBOX_URL` removidos de TODO o projeto (server.ts: 81→0 refs, frontend: 13 arquivos, config: 2 vars). Decisão explícita: todo endpoint SEMPRE chamar API real de produção, sem exceção, sem caminho alternativo de dado fictício. **NÃO tentar restaurar** — se alguém precisar de ambiente de teste isolado, usar token de produção com pedido identificável, não criar mock. | server.ts, server/config.ts, src/*, .env*, cloud-env.yaml |
| 37 | Fetch duplicado em ConditionSelector (3º caso do mesmo padrão) | SwapsTable monta DUAS visões simultâneas (flat + agrupada, sempre ambas visíveis). Cada linha com `item.alternatives` vazio disparava fetch client-side (`/api/smartped-find-substitutes`) DUAS vezes — uma por instância de ConditionSelector. **Mesmo padrão** dos bugs #24 (ObservationBell/Similares) e #25 (alerta Profarma): componente que busca por linha, montado em 2 visões simultâneas = fetch duplicado. Fix: `liveAlternativesCacheRef` (Map de promises) em nível de SwapsTable, compartilhado via prop `liveAlternativesCache` entre as 2 instâncias — chave `${searchEan}::${searchDesc}` garante 1 chamada por EAN único. Segunda instância que montar entre o mesmo tick reusa a promise já registrada. Cache vive só durante o ciclo de vida do SwapsTable (novo relatório = novo Map) | src/components/SwapsTable.tsx, src/components/ConditionSelector.tsx |
| 38 | Rajada de fetches redundantes em useProfarmaAlertCheck (mesmo hook do bug #25) | 4 fixes, mesma investigação: (1) `relevantEansSet` (Set) era dependência de useEffect — React compara por referência, nova a cada recompute mesmo com mesmo conteúdo → substituído por `relevantEansKey` (string sort+join, só muda quando o CONTEÚDO muda); (2) `isEanProfarmaAlerted`/`getProfarmaOrderDate`/`getFaturadoDistribuidora` recriadas a cada render → envolvidas em `useCallback` com deps estáveis; (3) SwapsTable.tsx tinha 2ª instanciação do hook via `useProfarmaAlertCheck` local (nunca eliminada de fato, só mitigada no #25) — agora essas 3 funções vêm de props via `useOptimizationResult` (única instância); (4) `useMemo` de `groups` em SwapsTable usava `isEanProfarmaAlerted`/`getFaturadoDistribuidora` sem listá-las como dependências → item ficava temporariamente no grupo errado até re-render não relacionado. Resultado: 9 GETs idênticos a `/api/profarma-faturados-pendentes` em sequência rápida durante confirmação de qtd → reduzido pra 1. **Correlacionado** com instabilidade do dynamic import do PendingOrdersTable.tsx em dev (rajada de fetch no mesmo processo Node que serve módulos Vite), embora causalidade exata não tenha sido 100% provada | src/hooks/useProfarmaAlertCheck.ts, src/hooks/useOptimizationResult.ts, src/App.tsx, src/components/SwapsTable.tsx |
| 39 | Duplicidade de compra bloqueava modal desnecessariamente (2 mecanismos concorrentes) | `pendingAlertItems` (useOptimizationResult.ts:553-586) misturava `isProfarmaAlert` (duplicidade de compra) com `alertaConfirmarQtd` (discrepância de fracionado/embalagem) na mesma modal `ConfirmQuantitiesModal` — forçando OK manual por item pra dois casos com necessidades diferentes. Mas duplicidade de compra JÁ era tratada pelo mecanismo passivo "Aguardando Chegar" em SwapsTable (re-agrupa item em grupo separado, ignora outros fornecedores). Fix: remover branch `isProfarmaAlert` do filter (modal só aparece pra `alertaConfirmarQtd`), manter enriquecimento via `.map()` quando item tem ambos os alertas. Plus: textos hardcoded "Profarma" → genéricos (ConfirmQuantitiesModal + UploadBox), auto-select no input de quantidade, botão "Remover" rápido ao lado de OK | src/hooks/useOptimizationResult.ts, src/components/ConfirmQuantitiesModal.tsx, src/components/UploadBox.tsx |
| 40 | Alerta de duplicidade só aparecia na visão detalhada (4º caso do padrão 2 visões) | SwapsTable renderiza DUAS visões simultâneas (flat + agrupada). O bloco "Alerta de Recompra Duplicada" (~70 linhas de JSX com 3 estados: aviso, mantido, excluído) SÓ existia na visão detalhada agrupada — a visão compacta "Painel de Escolhas" não tinha nada equivalente, item com isProfarmaAlert ficava sem indício visual. **Mesma família** dos bugs #24/#37/#38/#39 (informação divergente entre as 2 visões). Dessa vez o fix foi extrair componente `ProfarmaAlertInline` (função no topo do arquivo) em vez de copiar/colar — resolve o bug E elimina a duplicação de código. Componente recebe props (item, decisions, callbacks, funções de lookup) e é usado nas 2 visões. Extração > duplicação sincronizada. Plus: removido campo morto `isProfarmaAlertAck` (escrito mas nunca lido após fix #39) | src/components/SwapsTable.tsx, src/hooks/useOptimizationResult.ts, src/types.ts |
| 41 | Badges Mínimo Comercial/CaixaMaster/Limite Promo só existiam na visão detalhada (5º caso do padrão 2 visões) | SwapsTable renderiza DUAS visões simultâneas. O bloco de badges (`cxAlerta`, `qtdMinAlerta`, `qtdMaxAlerta`) — ~50 linhas de JSX com IIFE — SÓ existia na visão detalhada agrupada (~1757-1799). A visão compacta "Painel de Escolhas" não mostrava nada — usuário aceitava troca sem ver que ficou abaixo do mínimo comercial. **Mesma família** dos bugs #24/#37/#38/#39/#40. Fix: extrair componente `QtyLimitBadges` (função no topo do arquivo, recebe só `item: SwapReportItem` como prop, computa tudo internamente). Usado nas 2 visões. Variáveis locais `itemQtd`/`cxAlerta`/`qtdMinAlerta`/`qtdMaxAlerta` removidas do escopo do map detalhado (obsoletas). Referência restante a `qtdMinAlerta` no input de quantidade inlineada | src/components/SwapsTable.tsx |
| 42 | 4 fixes independentes de investigação ao vivo: (a) "Aguardando Chegar Distribuidora" — fallback genérico aparecia quando alias não encontrado; (b) "SmartPed" vazando pro texto de WhatsApp — empresa terceira não deveria aparecer; (c) item WhatsApp transferido contaminava grupo novo — `motivoAcao`/`origem` não eram limpos no override manual; (d) Data/Hora mostrava primeiro registro, não faturamento real — `created_at` gravado por 2 rotas diferentes, quem gravava primeiro definia pra sempre | (a) SwapsTable.tsx:498 — `getFaturadoDistribuidora` fallback removido, mostra "Aguardando Chegar" sem nome quando não sabe. (b) SwapsTable.tsx:1485 + WhatsAppOrderModal.tsx:108 — texto "Otimizador SmartPed" → "Otimizador de Pedidos". (c) useOptimizationResult.ts:465-469 — `overDist` define `motivoAcao: undefined` e `origem` condicional. **Achado separado:** `codDist` (9999 sentinela) não é resolvido pelo override — item mantém codDist antigo por baixo, precisa decisão sobre como resolver antes de implementar. (d) database.ts — coluna `faturado_at` em `itens_confirmados`, setada SÓ na transição pra `status='faturado'` (ON CONFLICT preserva se já existia). Backfill pra itens antigos (`faturado_at = created_at WHERE status='faturado'`). server.ts:7620 usa `faturado_at || created_at`. DailyItemsView.tsx:839 — parsing UTC consistente (`'Z'` suffix) | SwapsTable.tsx, WhatsAppOrderModal.tsx, useOptimizationResult.ts, database.ts, server.ts, DailyItemsView.tsx |
| 43 | Polling de retorno morria ao fechar a modal de faturamento — encomendas não eram confirmadas, itens_confirmados gravava com data errada | **Limitação antiga:** `handleCheckOrderReturn` (useBilling.ts) só roda enquanto `isBillingModalOpen + autoPollReturn` estão ativos. Fechar a modal mata o polling. `/api/itens-confirmados-do-dia` gravava `itens_confirmados` ao abrir a tela (capturava "quando alguém abriu", não "quando faturou"). **Solução:** job server-side em `server/pedido-monitor.ts`, tabela `pedidos_monitorados`, scheduler a cada 1min, painel manual `PedidosMonitoradosPanel.tsx`. Após `/api/faturar`, pedido é registrado com `itemsFaturados`+`encomendasPendentes` em JSON. Job verifica retorno a cada 10min, salva itens em `itens_confirmados` no momento real, confirma encomendas via `ENCOMENDAS_API_URL`+`x-api-key`. **Correções durante implementação:** (a) `console.log` referenciava `itensFaturados` removida — build quebrado; (b) URL de confirmação de encomendas usava `CONFIG.SMARTPED_PRODUCTION_URL` em vez de `ENCOMENDAS_API_URL` + header `x-api-key` — fixado; (c) endpoint forçar-verificacao sabotava a checagem gravando `last_checked_at` antes de chamar — agora importa `checkPedidoReturn` direto; (d) `PedidosMonitoradosPanel` importado mas nunca renderizado no JSX — adicionado | server/pedido-monitor.ts, server.ts, database.ts, src/components/PedidosMonitoradosPanel.tsx, src/App.tsx, docs/mapa-sistema.md, docs/encomendas-integracao.md |
| 44 | "Manter no Pedido" era cosmético + itens manuais/encomenda travados em "Aguardando Chegar" | Dois problemas com a mesma causa: `profarmaDecisions[codInterno] === 'keep'` (setado por ProfarmaAlertInline) NUNCA era lido no `useMemo` `groups` de SwapsTable — o item continuava classificado como "Aguardando Chegar" mesmo após confirmação de manter, sem botão de enviar e sem outras ofertas. Mesma lógica reclassificava itens adicionados manualmente ("+") ou de encomenda, mesmo com fornecedor escolhido deliberadamente pelo usuário. Fix: `isAguardando` agora verifica `!isManualOrEncomenda && !isKeptByUser` antes de checar `isEanProfarmaAlerted`. `ProfarmaAlertInline` continua mostrando aviso (função dele é visual), mas o grupo real do fornecedor escolhido aparece e botão de enviar volta | src/components/SwapsTable.tsx |
| 45 | Nome "Distribuidor {code}" genérico em vez de nome real — fallback em 14 pontos do código | Quando `resolveDistName()` e fallbacks inline não encontram o CodDist em nenhuma fonte (NomeDist, DISTRIBUIDORAS_MAP, DISTRIBUIDORAS_DYNAMIC_CACHE), retornavam `` `Distribuidor ${code}` `` — parecia nome real de distribuidora, mas era só fallback. Item de referência em ruptura com CodDist não mapeado aparecia como "Distribuidor 503" no relatório. Fix:统一 unificar todos os 14 pontos de fallback (server.ts x10, ConditionSelector.tsx x3, OrderReturnView.tsx x1, App.tsx x4, useManualSearch.ts x1) para "Distribuidor Não Identificado" — texto que deixa claro que o nome não foi resolvido. Investigação de `loadDistribuidoresFromAPI()` confirmou: sem bugs, CodDist pode genuinamente faltar na API SmartPed (limitação de dado externo) | server.ts, src/components/ConditionSelector.tsx, src/components/OrderReturnView.tsx, src/App.tsx, src/hooks/useManualSearch.ts |

**Se o problema parece novo, verifique esta tabela antes de investigar.**

---

> **Árvore de decisões completa** de cada busca/matching: `docs/arvore-decisoes-busca-api.md`

## Mecanismos de Equivalência (como o sistema decide "isso é equivalente àquilo")

> Investigação profunda de 2026-08-27. Três mecanismos independentes decidem quais produtos são "do mesmo grupo" pra fins de estoque total e média de vendas. Cada um usa uma abordagem diferente — o que causava inconsistências reais.

### Os 3 mecanismos

| # | Onde | Quando aciona | Fonte de dados | Como decide equivalência |
|---|------|--------------|----------------|--------------------------|
| 1 | Botão "P" (`/api/ofertas-dia/buscar-produto`, server.ts ~1799) | Usuário clica "P" num item do relatório | `buscar-por-ean` → `buscar-lote` (por texto limpo) | Agrupa por `cod_dcb` + `cod_concentracao`. Sem filtro de unidade. |
| 2 | Fornecedores Externos (`/api/ofertas-dia-analisar`, server.ts ~646) | Batch automático ao analisar lista de fornecedores | `similares/{ean}` (Ferramentinhas) | `mesmaApresentacao()` — DCB emprestado, dosagem, L.P./XR, unidade_apresentacao. **O mais robusto.** |
| 3 | Promoção do Dia (`/api/ofertas-dia-analisar`, server.ts ~1205) | Itens do SICF que não têm no cadastro | `buscar-lote` (por texto limpo), fallback `similares/{ean}` | Filtra por `cod_dcb` + regex de dosagem. Sem unidade_apresentacao. |

### Inconsistência encontrada (corrigida nesta sessão)

**Problema:** mecanismos #1 e #3 usavam `buscar-lote` (busca por texto) como fonte primária, com `similares/{ean}` como fallback. Isso causava:

1. **Mix de apresentações:** Busca por texto "DIMEZIN" retornava NEO QUIMICA 20un junto com DIMEZIN 30un — o DCB batia mas a quantidade era diferente, inflando estoque/vendas artificialmente.
2. **Ordem errada:** `similares/{ean}` já vem filtrado por estoque/atividade do lado da Ferramentinhas e agrupa corretamente por DCB+concentracao — mas só era usado quando o buscar-lote falhava.

**Correção:** inverter a prioridade nos mecanismos #1 e #3:
- Tentar `similares/{ean}` PRIMEIRO (fonte confiável, já filtrada)
- Só cair pro `buscar-lote` por texto se similares retornar erro (sem DCB) ou vazio
- Adicionar filtro `mesmaApresentacao()` no mecanismo #1 pra garantir que unidade_apresentacao bata

### Regra de consistência

> **Ao adicionar novo mecanismo de agrupamento/estoque, SEMPRE usar `mesmaApresentacao()` de `server/parsers.ts`** — não reimplementar filtro de dosagem/unidade do zero. O mecanismo #2 (Fornecedores Externos) é o mais testado e confiável; os outros devem se aproximar dele, não se afastar.

### Botão "P" — corrigido bug de estoque por laboratório (2026-08-28)

**Sintoma:** `/api/ofertas-dia/analisar-referencia` retornava `estoquePorLaboratorio` vazio mesmo com DCB/concentracao batendo entre produtos (validado com dados reais da API Ferramentinhas).

**Causa raiz:** `classificarProduto()` (`server/parsers.ts`) le a descricao do produto em `item.descricao` (portugues), mas o objeto `product` montado em `analisar-referencia` usa a chave `description` (ingles, convencao usada no resto de `analisarUmProduto`). `mesmaApresentacao()` cai no fail-safe de exclusao porque o lado "referencia" nunca tem `unidadeApresentacao`/`formaFarmaceutica` extraidos (description vazia do ponto de vista de `classificarProduto`).

**Fix:** `item.description` adicionado como fallback em `classificarProduto` (parsers.ts:508), na cadeia que ja tinha `descricao`/`nom_produto`/`Descricao`.

**Proposito de analisarUmProduto:** funcao central que calcula `estoqueTotal`/`estoquePorLaboratorio`/`vendasMensais`/`melhorPrecoSmartPed` pra um produto, usada tanto pelo botao P quanto por outros mecanismos — qualquer novo call-site deve garantir que o objeto `product` passado tenha os campos que `classificarProduto` espera (`descricao` OU `description`, `cod_dcb`, `cod_concentracao`).

**Propósito do botão "P":** o botão "P" fora do contexto de "Ofertas do Dia" é PURAMENTE informativo (comparação de preço/estoque pra decisão do usuário) — não deve ter ação de "adicionar ao pedido" nesse contexto, diferente do mesmo botão dentro do fluxo de Ofertas do Dia, onde comprar a promoção faz sentido.

---

> **Árvore de decisões completa** de cada busca/matching: `docs/arvore-decisoes-busca-api.md`

## Dois fluxos de matching independentes — NÃO confundir

> Documentado em 2026-08-30. São dois fluxos completamente independentes, com necessidades diferentes de matching. Misturar eles causa bugs (ex: aplicar lógica de "preço SmartPed" no "estoque por laboratório" ou vice-versa).

### Fluxo 1: Estoque por Laboratório (Ferramentinhas, `similares/{ean}`)

**O que é:** estoque da PRÓPRIA farmácia. O EAN da promoção bate 1:1 com o produto real do estoque da farmácia.

**Fonte:** API Ferramentinhas (`similares/{ean}`) — retorna o produto e seus similares no catálogo local da farmácia.

**Regra de matching:**
- **Referência (marca própria):** EAN exato já basta. NÃO buscar "similares" — cada referência é um produto único, sem equivalente de outro fabricante fazendo sentido somar. Quando `catProduct === "marca"`, pular `mesmaApresentacao()` e usar só `estoqueMesmoEan`.
- **Genérico/Similar:** buscar similares via `mesmaApresentacao()` (DCB, dosagem, forma, unidade). Múltiplos fabricantes fazem o "mesmo" produto, faz sentido somar estoque de todos.

**Cuidado:** a busca `similares/{ean}` é auto-inclusiva (retorna o próprio EAN entre os candidatos). O código já lida com isso via busca direta por EAN exato (`produtoExato`) ANTES de rodar `mesmaApresentacao()`.

### Fluxo 2: Melhor Preço SmartPed (API de distribuidor terceiro)

**O que é:** menor preço encontrado entre os distribuidores da SmartPed (CervoSul, ANB, Profarma, etc.).

**Fonte:** API SmartPed (`Condicoes/Ean`, `Condicoes/Molecula`, `Produtos/Buscar`).

**Regra de matching:**
- O EAN pode ser DIFERENTE do EAN real do produto mesmo sendo fisicamente o mesmo item (cadastro do distribuidor pode divergir).
- Por isso essa busca já usa wildcard/descrição quando o EAN exato não bate (`SMARTPED-BUSCAR` com wildcards) — isso é necessário e correto, inclusive pra item de referência.
- **NÃO simplificar** essa busca pra exigir EAN exato — o cadastro da SmartPed é inconsistente entre distribuidores.

### Por que são independentes

| Aspecto | Estoque (Ferramentinhas) | Preço (SmartPed) |
|---------|-------------------------|------------------|
| Fonte | Catálogo local da farmácia | API de distribuidores terceiros |
| EAN | Confiável (1:1 com produto real) | Pode divergir (cadastro inconsistente) |
| Matching | EAN exato (referência) ou `mesmaApresentacao` (genérico) | Wildcard/descrição (não exige EAN exato) |
| Referência | NÃO busca similares | USA wildcards (necessário) |
| Genérico | Busca similares via `mesmaApresentacao` | USA wildcards (necessário) |

### Regra pra futuras correções

> **Ao alterar lógica de matching, confirmar QUAL dos dois fluxos está sendo afetado.** Uma mudança no `mesmaApresentacao()` afeta estoque (Fluxo 1) mas NÃO afeta preço SmartPed (Fluxo 2). Uma mudança no wildcards da SmartPed afeta preço mas NÃO afeta estoque. Nunca "simplificar" um fluxo baseado no comportamento do outro.

---

## Sino de Observacao (ObservationBell) — arquitetura

**Proposito:** mostrar um aviso visual (`nom_obsvenda`, vindo da Ferramentinhas) quando um produto tem alguma observacao de venda cadastrada (ex: restricao, nota do farmaceutico). Nao faz nenhum calculo, e so exibicao.

### Problema original

Cada linha do relatorio fazia seu proprio fetch (`/api/similares/:ean`) via IntersectionObserver ao entrar na viewport. SwapsTable renderiza DUAS visoes simultaneas na mesma pagina (tabela flat + tabela agrupada por distribuidora, ambas sempre montadas ao mesmo tempo, nao e toggle/aba), entao cada linha disparava a busca DUAS vezes — ~152 chamadas por relatorio.

### Decisao arquitetural

Eliminar o fetch client-side por completo, nao so deduplicar. `/api/optimize` ja roda uma fase batch (`FASE-2-SIMILARES-BATCH`) que busca via `fetchSimilarGenericsBatch()` os "similares" de TODOS os EANs do relatorio numa unica chamada — esse dado ja vem com `nom_obsvenda`, so nao era repassado pro relatorio final. Agora o backend enriquece cada item do relatorio com `avisoOriginal`/`avisoNovo` (`server.ts`, logo antes do `res.json` final de `/api/optimize`) e `ObservationBell.tsx` virou 100% presentational (recebe o texto pronto via prop `observacao`, sem fetch, sem useEffect, sem IntersectionObserver).

### Excecao

`OrderReturnView.tsx` (tela de conferencia de retorno de pedido faturado) usa o sino numa instancia unica, fora do contexto de `/api/optimize` — nao tem acesso a `avisoOriginal`/`avisoNovo`. Criado um componente local `ObservationBellFetcher` nesse arquivo que mantem a busca ao vivo original (uma instancia so, sem o problema de duplicacao).

### Regra de consistencia

Se um novo lugar precisar mostrar observacao de produto DENTRO do fluxo de `/api/optimize`, usar `avisoOriginal`/`avisoNovo` do item — nunca adicionar um novo fetch client-side por linha. Fora desse fluxo (telas que nao passam por `/api/optimize`), replicar o padrao do `ObservationBellFetcher`.

---

## Checagem de Alerta Profarma 48h — timing e escopo

**Proposito:** `useProfarmaAlertCheck` (`src/hooks/useProfarmaAlertCheck.ts`) alerta o usuario quando um item do relatorio ja foi faturado por qualquer distribuidora com alias configurado em `distribuidor_alias` — sem prazo fixo, o aviso fica ativo ate a entrada ser confirmada. Evita duplicar pedido pro mesmo item.

### Comportamento atual (a partir do fix #44)

Duplicidade de compra (isProfarmaAlert) **NAO bloqueia mais via modal** — so aparece no agrupamento passivo "Aguardando Chegar {distribuidor}" em SwapsTable, que joga o item num grupo separado com aviso visual. O usuario pode usar os botoes do componente `ProfarmaAlertInline` ("Manter no Pedido" / "Excluir do Lote" / "Desfazer Decisão") ou os botoes genericos do Painel de Escolhas pra forcar o pedido se quiser.

**Exceções à reclassificação automática (fix #44):** dois casos saem do grupo "Aguardando Chegar" e ficam no grupo real do fornecedor escolhido, com botão de enviar disponível:
1. **"Manter no Pedido" confirmado** — `profarmaDecisions[codInterno] === 'keep'`. O item continua com aviso visual do `ProfarmaAlertInline` (função visual), mas seu grupo vira o fornecedor original/real, com outras ofertas aparecendo quando aplicável.
2. **Itens de origem manual/encomenda** — `item.origem === "manual" || item.origem === "encomenda"`. O usuario escolheu deliberadamente um fornecedor diferente do que esta pendente; reclassificaria duplicaria a escolha do usuario.

A modal `ConfirmQuantitiesModal` so aparece pra `alertaConfirmarQtd` (discrepancia de fracionado/embalagem), que e o unico caso que realmente exige decisao humana sobre quantidade. Se um item tem AMBOS os alertas, ele aparece na modal com os dois avisos visiveis (enriquecimento via `.map()` e preservado).

**NÃO alterar:** itens processados automaticamente pelo motor de otimização (não manual, não confirmado pelo usuario) continuam em "Aguardando Chegar" normalmente — só os 2 casos acima ficam livres.

### Dois bugs historicos (ambos causavam estouro do rate limiter — 120 req/min por IP)

1. **Rajada de concorrencia:** o hook rodava `Promise.all` irrestrito sobre TODOS os EANs pendentes Profarma (76 no momento do diagnostico) pra checar `compras-historico` — e era instanciado em 2 lugares ao mesmo tempo (SwapsTable.tsx e useOptimizationResult.ts), totalizando ~152 chamadas simultaneas. Fix: processamento em lotes de 8 EANs por vez.

2. **Timing errado:** o hook disparava a checagem assim que o app abria (`useOptimizationResult` roda desde o primeiro mount, antes de qualquer relatorio existir) — mesmo sem nenhum SICF importado. Fix: novo terceiro parametro `relevantEans` (lista de EANs do relatorio atual, calculada em ambos os call-sites via `originalEan`+`novoEan`). O hook so busca/processa EANs que estao tanto pendentes quanto no relatorio sendo otimizado agora — nao os 76 do sistema inteiro. Resultado: zero chamadas Profarma ao abrir o site sem importar nada; ao importar um SICF, so os EANs desse pedido especifico (que tambem estao pendentes) disparam a checagem de `compras-historico`.

### Regra

Qualquer novo consumidor de `useProfarmaAlertCheck` deve passar `relevantEans` com os EANs do contexto atual — nao omitir esse argumento (default e array vazio = hook fica inerte).

---

## Itens do Dia (DailyItemsView) — propósito e funcionalidade

Tela de consulta e gestão dos itens do dia, com 4 abas: Todos, Faturados,
Não Confirmados (essas 3 vêm direto da SmartPed via `/api/itens-confirmados-do-dia`,
com histórico persistido no Turso) e Manuais Adicionados (itens
digitados manualmente pelo "+" ou importados de encomendas — fonte:
`itens_manuais` no Turso, mesclado com localStorage como fallback).

**Coluna Data/Hora:** mostra quando o item foi confirmado/adicionado pela
primeira vez (`created_at`, UTC convertido pra Panambi na exibição). Para
os itens vindos da SmartPed, é a hora real do retorno de faturamento
(gravada em `/api/pedido-retorno`, não o momento em que alguém abriu essa
tela). Para itens manuais, é `dataAdicao` (já era UTC puro desde sempre).

**Editar/Excluir:** só disponíveis na aba "Manuais Adicionados" — os itens
das outras abas vêm de fatura já confirmada na SmartPed, não editáveis
por natureza (dado de sistema externo, não nosso). Editar persiste no
Turso via `/api/salvar-item-manual` (ON CONFLICT atualiza a linha
existente); excluir usa o endpoint `/api/deletar-item-manual`.

---

> **Árvore de decisões completa** de cada busca/matching: `docs/arvore-decisoes-busca-api.md`

## Ofertas do Dia (OfertasDoDiaModal) — propósito e funcionalidade

Tela que mostra promoções ativas de fornecedores externos (cadastrados via
WhatsApp/aba Parâmetros, tabela `external_suppliers` no Turso) e ajuda o
comprador a decidir se vale a pena — comparando o preço da promoção contra
(a) o melhor preço disponível na SmartPed entre distribuidores e (b) o
histórico de compras próprio (o que a farmácia já pagou antes por esse produto).

### Fluxo de dados

**Estoque:** fonte é `similares/{ean}` da Ferramentinhas. Regra de
referência-vs-genérico detalhada na seção "Dois fluxos de matching
independentes" (~linha 89) — não duplicar aqui.

**Preço SmartPed:** calculado por `analisarUmProduto` (server.ts) em 2 passos:

1. **PASSO 1** — busca o EAN próprio direto via `Condicoes/Ean`. Se encontrar
   condição válida (preço>0 E estoque>0), usa ela.
2. **PASSO 1.5** — se PASSO 1 não achou condição válida (pode acontecer mesmo
   com EAN cadastrado corretamente — produto real mas sem estoque em nenhum
   distribuidor no momento), expande via `Produtos/Buscar` com wildcards de
   texto (`getWildcardQueries` em `server/parsers.ts`) e complementa com
   `Condicoes/Molecula`.

**Importante:** toda expansão por texto (PASSO 1.5) filtra por dosagem
extraída da descrição (`origDosage`, regex `/(\d+)\s*(mg|mcg|g|ml|ui|%)/i`)
antes de aceitar um EAN candidato — ver bug #31 na tabela CEGUEIRA ANTIGA
(cross-contamination entre MUCOSOLVAN AD 30MG e PED 15MG, mesmo DCB,
dosagem diferente, corrigido em 2026-08-30).

### smartPedCondicoesTodas

Array com TODAS as condições SmartPed válidas (não só a melhor), com
breakdown completo: distribuidora, EAN, laboratório, precoBruto, desconto,
descExtra, valorST, precoLiquido, `qtdMin`, `condicao`. Ordenado por preço
líquido ascendente. Alimenta a tabela "Todas as condições SmartPed" no
modal de detalhe — coluna "Qtd Mín" mostra badge laranja quando `qtdMin > 1`,
label indica se `condicao !== "FIXA"` (promoção/combo).

Os campos `melhorPreco*` continuam existindo em paralelo (usados no dropdown
"Adicionar" e nos chips compactos) — não são redundantes, servem propósitos
diferentes (resumo rápido vs. auditoria completa).

### Design: card vs modal

- **Card da lista** — escaneamento rápido de dezenas de ofertas. Grid de
  no máximo 2 cards por linha (era 3, largura insuficiente). Fontes maiores
  nos pontos-chave: nome do produto (~14px), chips (~11px). fileira de chips
  compactos logo abaixo do preço.
- **Modal "Detalhes"** — avaliação a fundo de uma oferta específica. Mostra
  a tabela completa de todas as condições SmartPed com EAN em cada linha.

### Chips compactos — cores com significado

- **SmartPed (azul):** mostra preço, distribuidor, desconto REAL da condição
  SmartPed (`melhorDescontoSmartPed`, ex: "-2%") — **NÃO confundir** com
  `economiaPercent` (economia da promoção vs preço SmartPed, conceito
  diferente). EAN em mono.
- **Estoque (verde/vermelho):** verde quando `estoqueTotal > 0`, vermelho
  com ⚠ quando `estoqueTotal === 0` — diferencia visualmente num scan rápido.
- **Pago antes (violeta):** menor preço já pago em 12 meses + fornecedor.
  Sem comparativo % contra preço atual (decidido nesta sessão: seria
  potencialmente enganoso porque o dado é o MENOR preço histórico, não o
  mais recente).
- **Não encontrado (amarelo):** badge quando nenhum sistema tem o produto.

**Regra de EAN visível:** o EAN sempre aparece em qualquer lugar que mostre
preço/oferta — é o principal jeito do usuário auditar se o dado bate com o
produto certo. Foi assim que o bug de cross-contamination (#31) foi encontrado.

---

## Comandos

```bash
npm run dev      # Dev server (Vite + Express, porta 3000)
npm run build    # Build frontend + backend (esbuild → dist/server.cjs)
npm run start    # Produção (build prévio necessário)
npm run lint     # Type checking (tsc --noEmit)
```

---

## Regras Críticas

### SmartPed — Ambos endpoints SEMPRE em paralelo
- `Condicoes/Ean` + `Condicoes/Molecula` via `Promise.all`
- `QtdMin` vem do Molecula, não do Ean
- `Condicoes/Ean` exige `AceitaOntem: 1`
- Batch de até 40 EANs — filtro `eansDoGrupo` obrigatório

### Classificação — Fonte: Ferramentinhas `grupo`
- Genérico → subs (só genéricos). Ruptura → similar OK, NÃO referência
- Similar/Referência → sem subs. Ruptura → qualquer coisa com estoque
- Perfumaria/Correlatos → nunca buscar subs
- SmartPed `TipoItem` é fallback
- **Aguardando Chegar:** item faturado por qualquer distribuidora SmartPed recentemente sem entrada confirmada → oferta de outro fornecedor ignorada, grupo separado na UI (fonte: `itens_confirmados` via `/api/profarma-faturados-pendentes`, NÃO dailyOrders). Generalizado de "Profarma 48h" em 2026-08-31.

### Motor de trocas
- Prioridade para ofertas reais (CodDist > 0)
- Ruptura: ignora `margemMinima` (exceto quando `bypassMargemRuptura: false`)
- `CodProdutoDist` obrigatório (vem de `Condicoes/Ean`)
- Deduplicação: `${Ean}_${CodDist}_${Condicao}_${Prazo}` (sem preço)
- **Toggles de regra** (defaults `true`, salvos em localStorage):
  - `bypassMargemRuptura` — se false, sempre aplica margemMinima mesmo em ruptura
  - `alertaConfirmarQtdCaixaMaster` — se false, desativa bloqueio de discrepância caixa master
  - `alertaProfarma48h` — se false, desativa alerta de recompra duplicada

### Faturamento
- Blindagem 4 regras antes de enviar
- Consolidação de lote único (NÃO paralelo por dist.)
- Encomendas: confirmação só após retorno SmartPed

### PMC
- APENAS se API retornar. NUNCA `preco * 1.4`
- Fallback: `PMC || pmc || Pmc`

### Performance — Nunca refazer fetch já feito na mesma requisição
- `marketSimilarMap` é carregado 1x no FASE-2 (`fetchSimilarGenericsBatch`) pra TODOS os EANs do pedido — sempre reusar essa Map, nunca chamar `fetchSimilarGenerics`/`fetchSimilarGenericsBatch` de novo dentro do loop principal do FASE-4/FASE-5 pro mesmo EAN
- Instrumentação de timing já existe no código (`[FASE-N]`, `[TIMING-*]` em server.ts) — antes de investigar lentidão, rodar um teste real e ler os logs existentes antes de adicionar instrumentação nova
- `fetchSimilarGenericsBatch` processa lotes de 40 EANs em paralelo (`Promise.all`) — não voltar pra sequencial sem motivo forte

### Performance — Onde NÃO paralelizar (throttle proposital)

> ⚠️ Esses pontos já tiveram concorrência REDUZIDA de propósito no passado porque APIs externas sobrecarregavam e itens se perdiam. Não "otimizar" aumentando `CONCURRENCY` sem confirmar com o usuário — é o oposto do padrão de bug das entradas #14-16/18 da tabela CEGUEIRA ANTIGA (que são sobre paralelizar coisas que estavam acidentalmente sequenciais).

| Onde | Conc. | Motivo |
|------|-------|--------|
| FASE-3 `/api/optimize` (`Condicoes/Molecula`) — `server.ts:3473-3491` | `CONCURRENCY = 1`, `BATCH_DELAY_MS = 200` | Rate limit SmartPed |
| `analisarFornecedorEmBackground` (promoções/fornecedores externos) — `server.ts:1191-1197` | `CONCURRENCY = 2` | Sobrecarga API Ferramentinhas (itens se perdiam) |
| `/api/encomendas/buscar-ofertas-batch` | `CONCURRENCY = 1` + delay | Bug #39 histórico — mesma razão |

---

## PENDÊNCIAS / Dívida Técnica

> Itens identificados mas adiados de propósito — não são bugs ativos,
> são melhorias arquiteturais pra revisitar com calma. Sempre checar
> esta seção quando o usuário perguntar "o que temos pendente?".

### Stopwords de sal/forma farmacêutica duplicadas em 3+ lugares

**Onde:** (1) `getWildcardQueries` em `server/parsers.ts` (corrigido, usa `PHARMA_SALT_STOPWORDS` exportado); (2) `PALAVRAS_GENERICAS_BLOQUEIO` — Set duplicado verbatim em `server.ts:4285` (dentro de `analisarUmProduto`) e `server.ts:9081` (dentro de `/api/smartped-find-substitutes`) — mesma lista, nenhum dos dois importa do outro; (3) `RUPTURA-REGEX` em `server.ts:5402` — tem SUA PRÓPRIA lista de stopwords (`stopWords` local), já inclui DE/DO/DA mas não sal, e monta busca com ESPAÇO em vez de `%`.

**Por que não foi corrigido agora:** `PALAVRAS_GENERICAS_BLOQUEIO` e `RUPTURA-REGEX` fazem parte do motor de preço central (`analisarUmProduto`, usado por `/api/optimize`). O fluxo de controle não foi totalmente mapeado ainda — se `dcbDescoberto` normalmente já vem resolvido via chamada real à Ferramentinhas antes de cair no fallback de texto, o bug pode ter frequência real bem menor do que parece por leitura de código. Sem rede de teste automatizado robusta pra essa função.

**Recomendação:** consolidar as 4 implementações duplicadas numa função/lista compartilhada (já existe `PHARMA_SALT_STOPWORDS` em `server/parsers.ts` — exportar e usar em todos os pontos). Fazer quando alguém pegar isso com atenção dedicada.

### Bloco "PRODUTO ORIGINAL EM FALTA" só existe na visão compacta

**Onde:** SwapsTable.tsx, visão compacta "Painel de Escolhas" (~linha 735-746, coluna "Produto Original") — mostra descrição/EAN/lab/preço do produto original quando foi substituído por ruptura. A visão detalhada agrupada **não tem nada equivalente**.

**Por que é ambíguo (não é bug óbvio):** a visão detalhada tem coluna única "Descrição" (sem separação original/substituto lado a lado), então pode não ter onde esse bloco encaixar sem redesenhar a coluna. Pode ser diferença de propósito entre as 2 visões, não necessariamente uma omissão.

**Status:** aguarda decisão do Carlos antes de virar prompt de fix — não replicar automaticamente como nos bugs #40/#41.

### "Melhor preço pago" (histórico de compras) não aparece nos cards do SwapsTable

**Onde:** campos `melhorPrecoHistorico`/`melhorFornecedorHistorico` existem no fluxo Ofertas do Dia (`OfertasDoDiaModal.tsx`) mas não no `SwapReportItem`/relatório principal que alimenta o SwapsTable.

**Por que não foi implementado agora:** computar o melhor preço pago pra todo item do `/api/optimize` (180+ itens) exigiria chamadas adicionais de API (histórico de compras via Ferramentinhas) pra cada item — custo de performance significativo. Mesma razão da pendência de `analisarUmProduto` já documentada: motor central de preço, sem mapeamento completo do fluxo de controle, sem teste automatizado robusto.

**Status:** decisão explícita de adiar — não implementar sem revisitar o custo de API e o impacto no tempo de resposta do `/api/optimize`.

### Nome interno `alertaProfarma48h` mantido de propósito

Nome interno `alertaProfarma48h` (config, types.ts, server.ts, etc.) mantém "Profarma"/"48h" no nome mesmo após a generalização de 2026-08-31 (comportamento real: qualquer distribuidora com alias configurado, sem prazo fixo — texto visível já corrigido). Decisão explícita do Carlos: manter o nome interno assim, ajuda a rastrear a origem histórica da feature no código. Não renomear — não é esquecimento, é decisão consciente.

### PedidosMonitoradosPanel fica invisível quando vazio

O componente (`src/components/PedidosMonitoradosPanel.tsx`) retorna `null` quando não há nenhum pedido com `status='monitorando'` (`getPedidosMonitorando`, `database.ts:1242-1250` só busca esse status). Resultado: não tem como saber que a feature existe enquanto não há pedido ativo sendo monitorado — parece que sumiu, não fica claro que é comportamento esperado. Decisão explícita: deixar assim por enquanto (painel só aparece quando relevante) — se no futuro incomodar, considerar sempre mostrar o painel com uma mensagem tipo "nenhum pedido em monitoramento no momento" em vez de sumir completamente.

---

## Convenções de Código

### Nomenclatura
- Backend: lowercase (`distribuidora`, `precoLiquido`)
- SmartPed API: PascalCase (`NomeDist`, `Pliquido`)
- Banco Turso: snake_case (`data_pedido`, `preco_liquido`)
- **Backend normaliza PascalCase→lowercase antes de retornar ao frontend**
- **Endpoints de leitura: `rows.map(r => ({...}))` snake→camelCase**

### Contrato Backend→Frontend
Campos obrigatórios: `distribuidora`, `codDist`, `precoLiquido`, `preco`, `estoque`, `condicao`, `prazo`, `ean`, `descricao`, `laboratorio`

### isNotFoundName()
ÚNICA forma de checar nomes inválidos de distribuidora. Trata: UTF-8, mojibake, sem acento, "Sem Estoque", "Distribuidor*"

### Versão de deploy
Formato: `vYYYY-MM-DD-HHmm` (fuso Panambi/UTC-3). Gerado no build por `vite.config.ts`. NÃO usar `process.env.APP_VERSION`.

---

## O que NÃO fazer

- **NUNCA** usar `--set-env-vars` no deploy (substitui todas as variáveis)
- **NUNCA** importar `auth`/`googleProvider` direto de `firebaseClient.ts`
- **NUNCA** calcular PMC via fórmula (`preco * 1.4`)
- **NUNCA** deduplicar por preço (usar chave sem preço)
- **NUNCA** chamar `Condicoes/Ean` sem `Condicoes/Molecula`
- **NUNCA** retornar linhas cruas do banco (snake_case→camelCase)
- **NUNCA** matar/iniciar processos node (`npm run dev`, `Stop-Process`)
- **NUNCA** fazer deploy sem autorização explícita do usuário
- **NUNCA** inventar endpoints — verificar `docs/API_TREE_SMARTPED.md` / `docs/API_TREE_TRIER.md` primeiro
- **NUNCA** usar `JSON.stringify` para comparar listas (usar `normalizeProducts()`)
- **NUNCA** modificar a construção da linha final do SICF — formato estrito 7 colunas separadas por `;` (`server.ts:6069-6077`). Inserir arrays, colunas adicionais, espaços, ou falhar na conversão do preço de `.` para o padrão ERP quebra o parser do cliente final. Modificar apenas de forma cirúrgica.
- **NUNCA** serializar `melhor` de `findBestSubstitute` sem chamar `resolveDistName(melhor, codDist)` antes — o objeto retornado NÃO tem `NomeDist` populado (é o objeto bruto da SmartPed). Ler `melhor.NomeDist` direto resulta em código genérico (ex: "Distribuidor 503") em vez do nome real. Regra já respeitada em `server.ts:6162`, mas frágil — qualquer novo ponto de serialização deve repetir a chamada.
- **NUNCA** filtrar alternativas do dropdown por EAN quando o item está em ruptura (`!originalHasStock`) — o filtro `sameProductEans` (`server.ts:6018-6036`) só se aplica quando `originalHasStock && !isGeneric`. Em ruptura e genéricos sem ruptura, manter TODAS as alternativas. Remover essa exceção some com ofertas de outras distribuidoras (NeoSul, CervoSul etc.) no ConditionSelector.
- **NUNCA** usar sandbox/simulação — `useTestUrl`, `simulationMode`, `isSandboxToken`, `SMARTPED_SANDBOX_TOKEN`, `SMARTPED_SANDBOX_URL` foram removidos de propósito (CEGUEIRA ANTIGA #36). Todo endpoint SEMPRE chama API real de produção. Se precisar de ambiente de teste isolado, usar token de produção com pedido identificável, não criar mock.

---

## Dependências Cruzadas

> Ao alterar qualquer função, verifique TODOS os pontos listados. Falhar causa bugs silenciosos.

| Função | Arquivo | Impacta |
|--------|---------|---------|
| `resolveCategoria()` | server/parsers.ts | mappedSimilares, TipoItem no swap-engine |
| `resolveDistName()` | server.ts:75 | Todas as linhas com `distribuidora` |
| `isNotFoundName()` | server.ts:68 | Filtragens de distribuidora, blindagem |
| `parseSmartPedEstoque()` | server/parsers.ts | originalHasStock, findBestSubstitute |
| `validateSwapEquivalence()` | swap-validation.ts | filtered substitutos, allAlternatives |
| `isExternalManual` | SwapsTable.tsx | Grupo verde/WhatsApp, "Faturar" |
| Cálculo vendas (4 meses) | server.ts | analisar-referencia, background, batch SICF |
| `normalizeSearchQuery()` | server.ts:7661 | Busca manual (botão "+"), Produtos/Buscar |
| `matchesQuantity()` | server.ts:7715 | Filtro pós-busca por quantidade na descrição |

---

## Fornecedores Externos — Schema e Integração

> Implementado em 2026-08-29 para integração com chatbot WhatsApp de farmácia.

### Campos do ExternalProduct (src/types.ts)

| Campo | Tipo | Obrigatório | Descrição |
|-------|------|-------------|-----------|
| `description` | `string` | Sim | Nome do produto |
| `price` | `number \| null` | Sim | Preço absoluto (null = sem preço) |
| `discountPercent` | `number` | Não | Desconto percentual único (calcula preço via referência SmartPed) |
| `tiers` | `PriceTier[]` | Não | Faixas de preço absoluto (`{minQty, price}`) |
| `discountTiers` | `Array<{minQty, discountPercent}>` | Não | Faixas de desconto percentual (adicionado 2026-08-29) |
| `validade` | `string \| null` | Não | Validade POR ITEM (YYYY-MM-DD ou null) |

### Regra de validade por item

- Se item tem `validade` individual, usa ela
- Senão, usa `validade` do fornecedor (`ExternalSupplier.validade`)
- Item expirado é descartado individualmente (não derruba os outros do mesmo fornecedor)
- Listas ficam acumuladas pra sempre no banco — só o item vencido deixa de ser lido

### Semântica do POST /api/external-suppliers

- Enviar `id` já existente **SUBSTITUI** a lista `products` inteira (não merge)
- Para merge incremental: buscar via `/list`, mesclar localmente, reenviar lista completa
- Diff interno detecta adicionados/modificados/removidos e dispara `analisarFornecedorEmBackground`
- Campo `ean` não é oficial no tipo mas é aceito e usado no diff

### Exibição na UI

- `tiers`: badges laranja em ConfigurationPanel, seção "PRECO CONDICIONAL" em OfertasDoDiaModal, badges em SwapsTable
- `discountTiers`: badges violeta nos mesmos 3 componentes (mutuamente exclusivos com `tiers`)
- `discountTiers` no SwapsTable é display-only (não é populado pelo backend no `/api/optimize` ainda)

### Integração no SICF (`/api/optimize`)

Fornecedores externos também competem durante a otimização em lote (corrigido em 2026-08-31, CEGUEIRA ANTIGA #34). Matching primário por EAN exato (`cleanEan`), fallback por texto. Detalhes: `docs/arvore-decisoes-busca-api.md` seção 12.

**Fluxos que NÃO recebem `externalSuppliers`:** `/api/encomendas/buscar-ofertas-batch` (pendência pra outra sessão).

---

## Busca Manual (Botão "+") — Normalização e Wildcards

> Implementado em 2026-08-29.

### Fluxo da busca de texto

1. **Normalização** (`normalizeSearchQuery`): remove stopwords ("com", "de", "para"), normaliza abreviações ("cp"→"CPR", "caps"→"CAPS"), extrai quantidade standalone (ex: "60" do final)
2. **Wildcard**: converte espaços em `%` antes de mandar pro `Produtos/Buscar` da SmartPed (ex: "PITAVASTATINA 2 60" → busca "PITAVASTATINA%2%" com filtro pós-busca pra quantidade "60")
3. **Fallback relaxado**: se busca normalizada retorna 0 resultados, tenta só com palavras significativas (remove dosagem/quantidade)
4. **Filtro pós-busca** (`matchesQuantity`): se quantidade foi extraída, filtra resultados que têm essa quantidade na descrição do produto

### Exemplo

- Input: "pitavastatina 2 60"
- Normaliza: "PITAVASTATINA 2" (quantidade extraída: "60")
- Busca SmartPed: "PITAVASTATINA%2%"
- SmartPed retorna: PITAVASTATINA CALCICA 2MG 30CPR + 60CPR
- Filtro pós-busca: mantém só 60CPR

---

## Padrão raiz: objeto bruto vs catálogo (causa de quase todos os bugs de 30/08)

> Documentado em 2026-08-30. Praticamente TODO bug corrigido nesta sessão foi a mesma causa em lugares diferentes.

### O problema

Objeto bruto de promoção (vindo do WhatsApp/fornecedor externo) só tem `{description, ean, price, discountTiers}` — **sem metadado de catálogo** (`grupo`, `cod_dcb`, `unidadeApresentacao`, etc.). Funções de classificação/matching que precisam desses campos falham silenciosamente quando recebem o objeto bruto.

### Consequências (cada uma causou bug real hoje)

| Falta | Onde falha | Bug resultante |
|-------|-----------|----------------|
| `grupo`/`classificacao` | `resolveCategoria(product)` | Sempre cai em "outros", nunca "marca" → referência agrupa com genérico |
| `cod_dcb`/`cod_concentracao` | `mesmaApresentacao()` | `dcbConcentracao` null → comparação por regex de dosagem (menos confiável) |
| `unidade_apresentacao` | `mesmaApresentacao()` | `unidadeApresentacao` null → não compara quantidade → aceita 24cp junto com 60cp |

### Regra permanente

> **Ao usar `resolveCategoria()`, `classificarProduto()` ou `mesmaApresentacao()` com produto de fornecedor externo, SEMPRE enriquecer o objeto com dados do catálogo Ferramentinhas PRIMEIRO** (via `produtosRaw.find(ean === product.ean)`) — nunca passar o objeto bruto direto.

---

## 4 listas de EAN independentes — não confundir

> Documentado em 2026-08-30. Cada lista tem sua PRÓPRIA lógica de filtro. Corrigir um NÃO corrige os outros.

| Lista | Usada pra | Onde filtra | Exceção EAN próprio? |
|---|---|---|---|
| `erpEans` | vendas/estoque agregado | REF-FILTER original (~1484) | **Sim** (4222495) |
| `eanList` | precificação SmartPed | REF-FILTER-EAN (~1505) + unidade | **Sim** (398b471, 475531b) |
| `eanListFiltrado` | comprasHistorico/"Seus Preços" | `mesmaApresentacao` (~1553) | **Sim** (dd609ea) |
| `produtos` (em `analisarUmProduto`) | estoquePorLaboratorio | `mesmaApresentacao` ou pulado se marca | **Sim** (35e3bea, cdb7ced) |
| `smartPedEans` / `eanList` (PASSO 1.5) | precificação SmartPed (wildcards) | **Faltava filtro de dosagem** — corrigido em #31 | **Sim** (implícito: `if (ean === product.ean)` no filter) |

### Regra permanente

> **Ao criar/modificar QUALQUER filtro que rode sobre lista de EANs candidatos, sempre perguntar: "isso pode remover o EAN do PRÓPRIO produto sendo analisado?" e adicionar exceção `if (ean === product.ean) return true` ANTES de qualquer outra condição.**

---

## Referência vs Genérico — regra de ouro

> Documentado em 2026-08-30.

**Produto REFERÊNCIA (marca própria):** NUNCA busca "similares" pra estoque — usa só o próprio EAN exato (`estoqueTotal = estoqueMesmoEan`, sem soma de grupo). Motivo: não existe "outro fabricante" fazendo o mesmo produto de marca pra somar.

**Genérico/Similar:** aí sim busca similares via `mesmaApresentacao` — múltiplos fabricantes fazem o "mesmo" produto de fato.

**Categoria do produto** SEMPRE deve ser resolvida a partir do produto MATCHADO no catálogo (`produtoExato`), nunca do objeto bruto da promoção — o objeto bruto não carrega `grupo`/`TipoItem`, sempre cai em "outros" (31da6e3).

---

## Descarte de Recompra Duplicada

> Previne que um EAN faturado recentemente seja processado de novo sem confirmação de entrada. Previne recompra duplicada consultando nosso próprio banco (`itens_confirmados`) + `compras-historico` da Ferramentinhas.
>
> **Detalhes completos:** `docs/arvore-decisoes-busca-api.md` seção 13 (árvore de decisão, janela de 24h, monitoramento background, alerta de atraso, bugs corrigidos).

---

## Fluxo de Busca por Tipo de Item (Ruptura vs Sem Ruptura)

> Migrado de `docs/_archive/business-rules.md` (seção 4.20). Documentação detalhada do motor de deciding.

### Decisão: o item está em ruptura?

`originalHasStock` é calculado em `server.ts` (~linha 1367):

```
condicoesOriginal = [...condicoesRaw, ...substitutosRaw]
  .filter(s => cleanEan(s.Ean) === cleanEan(item.ean))
originalHasStock = condicoesOriginal.some(s => parseSmartPedEstoque(s.Estoque) > 0)
```

- `true` → caminho **SEM ruptura** (item tem estoque)
- `false` → caminho **COM ruptura** (item sem estoque)

### Caminho SEM Ruptura (`originalHasStock = true`)

**Genéricos (TipoItem "G"):** busca completa — RUPTURA-REGEX também ativa pra genéricos com estoque. findBestSubstitute usa tipos estritos (G, O) e exige economia ≥ margemMinima.

**Éticos/Referência/Similares (TipoItem R, E, O, S):** busca do mesmo produto. Filtro do dropdown mantém só EANs com mesma descrição.

**Perfumaria (TipoItem "P"):** SEM busca de substitutos. SmartPed retorna `Substitutos: []`. Buscar APENAS `Condicoes/Ean`.

### Caminho COM Ruptura (`originalHasStock = false`)

3 camadas extras de busca:
1. **TARGET-EAN-PRE:** consulta EANs alvo dos substitutos já conhecidos
2. **RUPTURA-REGEX:** busca por descrição via `Produtos/Buscar` + `Condicoes/Ean` — exclusivo de ruptura
3. **Fallback Ferramentinhas:** se `findBestSubstitute` retorna null, chama `fetchSimilarGenericos` como último recurso

Filtro de tipos **relaxado** (G, S, R, E — qualquer coisa). MargemMinima **não é obrigatória** (bypass).

### Tabela Comparativa

| Aspecto | Ético/Similar s/ ruptura | Genérico s/ ruptura | Qualquer c/ ruptura |
|---------|--------------------------|---------------------|---------------------|
| `originalHasStock` | `true` | `true` | `false` |
| RUPTURA-REGEX | Não | **Sim** | **Sim** |
| Tipos aceitos (swap-engine) | G, O (estrito) | G, O (estrito) | **G, S, R, E (qualquer)** |
| Exigir economia ≥ margemMinima | Sim | Sim | **Não** (bypass) |
| Fallback Ferramentinhas | Não | Não | **Sim** |
| EANs no dropdown | Mesmo produto | TODOS | TODOS |

### Fluxo Visual

```
[originalHasStock?]
    ├── SIM (sem ruptura)
    │   ├── [isGeneric?]
    │   │   ├── SIM → [RUPTURA-REGEX] + tipos estritos + margemMinima
    │   │   └── NÃO → (pula RUPTURA-REGEX)
    │   └── [Dropdown:] Genérico=TODOS, Ético=mesmo produto
    │
    └── NÃO (ruptura)
        ├── [RUPTURA-REGEX] + tipos relaxados + sem margemMinima
        ├── [Fallback Ferramentinhas se findBestSubstitute=null]
        └── [Dropdown: TODOS os EANs encontrados]
```

---

## Regras de Cálculo — Vendas e Estoque

> Migrado de `docs/_archive/vendas-estoque-reference.md`. Regras fundamentais: SmartPed NÃO tem dados de venda nem estoque real do ERP.

### Vendas Mensais

```
1. Buscar vendas-detalhadas/{ean} para CADA EAN do grupo (Ferramentinhas)
2. Filtrar apenas últimos 4 meses
3. Somar TODAS as vendas (NÃO por-EAN)
4. Calcular mesesDiff das datas reais (primeiraData / ultimaData)
5. mediaMensal = Math.round(totalVendas / mesesDiff)
```

**NÃO:**
- Calcular por-EAN e depois somar (infla resultado)
- Usar `vendas-semanais` (desatualizado)
- Dividir por 4 hardcoded (usar mesesDiff real)
- Incluir EANs SmartPed (não têm vendas no ERP)

### Estoque

```
1. Buscar similares/{ean} (Ferramentinhas)
2. Filtrar por apresentação (SH≠CR≠GEL)
3. estoqueTotal = soma de qtd_estoque dos produtos filtrados
4. estoquePorLaboratorio = agrupado por nom_laborat
```

**NÃO:**
- Usar estoque de SmartPed (`Estoque` em Condicoes) — é estoque da dist., não do ERP
- Misturar apresentações (SH com CR)
- Usar `eansGrupo[].estoque` do buscar-lote (pode estar desatualizado)

### Buscar-lote — Wildcards Trier

A Trier usa `%` como wildcard. Quando `buscar-lote` retorna vazio:

```
1. Tentar: buscar-lote(["PRINCÍPIO%"])     → wildcard
2. Tentar: buscar-lote(["PRINCÍPIO"])      → sem wildcard
3. Fallback: similares/{ean}               → por EAN direto
```

Exemplo: "CETOCONAZOL 20MG/ML SH 100ML" retorna vazio → `buscar-lote(["CETOCONAZOL%"])` retorna 16 produtos.

---

## Regras de Processo

### Documentação anda junto com o código

Sempre que uma mudança de código alterar comportamento documentado (regra de negócio, endpoint, schema de banco, fluxo de decisão já descrito em AGENTS.md / `docs/arvore-decisoes-busca-api.md` / `docs/mapa-sistema.md`), atualizar a documentação relevante no MESMO commit da mudança de código — não deixar pra depois. Regra de bolso: se você teve que ler uma dessas docs pra entender o código antes de mexer, você provavelmente precisa atualizá-la depois de mexer. Mudança puramente interna sem impacto em regra documentada não exige atualização.

### Errar na primeira tentativa força reler a documentação

Se uma tentativa de correção falhar (teste não passa, comportamento não muda como esperado, erro persiste, ou o usuário reportar que não funcionou), é OBRIGATÓRIO reler a documentação relevante da área afetada (seção específica do AGENTS.md, `docs/arvore-decisoes-busca-api.md`, ou `docs/mapa-sistema.md`) ANTES de tentar de novo — não iterar às cegas ajustando código por tentativa e erro. Se não existir documentação relevante pra área, isso É um sinal de lacuna — documentá-la depois de resolver o problema.

"Documentação relevante da área afetada" inclui mecanismos **vizinhos/análogos**, não só o arquivo ou função que você acabou de mexer. Exemplo: bugs na recompra duplicada (docs/arvore-decisoes-busca-api.md seção 13) eram quase idênticos a bugs já resolvidos na reconciliação de encomendas (mesma árvore, seção anterior) — reler só a doc do mecanismo que falhou não bastava, era preciso ler também a doc de mecanismos parecidos que já tiveram o mesmo tipo de problema antes.

### Documentação é parte obrigatória do entregável

Antes de considerar qualquer tarefa concluída, passar pelo checklist:

1. A mudança alterou comportamento documentado (regra de negócio, endpoint, schema, fluxo de decisão)? Se sim, algum arquivo de doc foi tocado no mesmo commit (ou logo em seguida)?
2. O conteúdo foi pro arquivo CERTO segundo a tabela "Onde documentar o quê" (não só "documentei em algum lugar")?
3. Se essa tarefa foi uma correção de um bug reportado numa tentativa anterior, a documentação reflete o estado FINAL corrigido — não só o que foi escrito na primeira tentativa (que pode estar descrevendo um comportamento que na prática tinha um bug)?

Exemplos reais de onde isso foi esquecido mesmo com regra já escrita: uma tabela nova (`distribuidor_alias`) nunca foi documentada no mapa do sistema, e 2 correções de bug em sequência numa mesma feature não atualizaram a documentação da feature original.

### Pensar um passo à frente antes de finalizar uma solução

Antes de considerar um fix/feature pronto pra commit, pensar explicitamente: "o que acontece nisso no próximo restart do servidor, numa re-execução, com dado que já existia antes desta mudança, ou em escala maior?" — não só resolver o sintoma relatado.

Exemplos reais: generalizar o alerta de duplicidade da Profarma pra qualquer distribuidora causou 563 falsos-positivos (nomes fantasia da SmartPed não batem com nomes jurídicos da Trier — ninguém pensou "o que acontece rodando isso contra o histórico real inteiro"). O fix disso foi bom, mas uma feature seguinte (recompra duplicada, monitoramento em background) repetiu o mesmo tipo de erro num lugar novo: `ALTER TABLE ... DEFAULT 0` marcou toda linha histórica como "pendente" (ninguém pensou no dado que já existia), e um `codDist=0` fixo numa cláusula `WHERE` fez um UPDATE nunca persistir nada — mas o código reportava sucesso mesmo assim.

### Pode (e deve) contradizer, inclusive o Carlos

Se o prompt recebido pedir algo que pareça tecnicamente causar um problema — baseado em evidência real do código, não em preferência — dizer isso explicitamente ANTES de implementar, em vez de seguir em frente calado e deixar o problema aparecer depois. Isso vale tanto pra apontar um risco técnico quanto pra dizer "isso não bate com o que o código faz hoje, confirma antes de eu prosseguir" (mesma regra que já existe: "se qualquer premissa não bater com o código real, PARAR e reportar" — essa norma só deixa explícito que isso vale mesmo quando quem pediu foi o próprio Carlos).

Não é sobre resistir a pedidos — é sobre não implementar silenciosamente algo que, tecnicamente, parece que vai dar errado, só porque foi pedido assim.

### SwapsTable: sempre preencher as 2 visões simultâneas

SwapsTable renderiza DUAS visões simultâneas na mesma página (tabela flat/compacta + tabela agrupada por distribuidora, ambas sempre montadas ao mesmo tempo, não é toggle/aba). QUALQUER informação visual nova adicionada numa das visões (alerta, badge, aviso, indicador) DEVE existir na outra desde o início — ou ser extraída num componente compartilhado usado nas duas. Copiar/colar o bloco de JSX numa visão só é o padrão de bug mais recorrente deste arquivo (5 ocorrências documentadas: #24, #37, #38, #39, #40, #41). Extração > duplicação sincronizada.

---

## Metodologia de debug — script isolado

> Documentado em 2026-08-30. Pra investigar EAN específico sem rodar análise completa (180 itens, lento).

Criar script standalone (`debug-analisar.ts`, já existe) que:
1. Importa só funções necessárias (`classificarProduto`, `mesmaApresentacao`, `resolveCategoria`)
2. Chama APIs diretamente (Ferramentinhas + SmartPed) pra 1-3 EANs
3. Imprime log específico, sem disparar fluxo completo de `/api/ofertas-dia/analisar`

---

## Pendências conhecidas (não bloqueiam)

- Checagem de FORMA (líquido/ML vs sólido/CPR) no fallback de preço SmartPed (passo 2) — nunca implementada
- Formato "NxM" (ex: "1X10") não reconhecido pelo regex de unidadeApresentacao
- Análise em background processa fornecedor JÁ VENCIDO antes de descartar (desperdício)
- Dados de teste no Turso reduzidos (Forster deletado, TEstando: 9 itens) — sem backup automático

> **Último deploy:** `smartped-cli-00103-bwj`.

---

## Tarefa prioritária da próxima sessão

> Pedido explícito do Carlos.

**Integrar fornecedores externos no fluxo de encomendas (`/api/encomendas/buscar-ofertas-batch`).** Hoje `external_suppliers` só compete no SICF (`/api/optimize`, corrigido na sessão 2026-08-31 — ver CEGUEIRA ANTIGA #34) e na tela "Ofertas do Dia". O fluxo de encomendas não recebe `externalSuppliers` — listas externas não competem lá. Investigar se há bloqueio técnico ou se é só wiring de parâmetro.

---

*Sempre se comunique em português.*
*Fuso horário: America/Sao_Paulo (UTC-3) — Panambi, RS.*
