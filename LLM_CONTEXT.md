# Contexto do Projeto: Otimizador de Pedidos SmartPed (LLM Context)

Este documento é o **índice de contexto** do projeto. Leia-o no início de qualquer sessão para entender o propósito, a stack e onde encontrar detalhes por domínio.

## 1. Visão Geral e Objetivo do Sistema

**O que o software faz:**
Otimiza financeiramente compras de medicamentos para farmácias, conectando-se à API SmartPed para buscar concorrentes e sugere trocas inteligentes por menor preço.

**Como funciona:**
Upload de arquivo SICF → parsing de EANs → consulta SmartPed (moléculas/genéricos) → sugestão de trocas com economia → faturamento direto na API.

**Perfil de Uso:** B2B interno (compradores de drogarias).

---

## 2. Stack Tecnológica

| Camada | Tecnologia |
|--------|------------|
| Frontend | React 19 + Vite 6 + Tailwind CSS v4 |
| Backend | Express.js v4 (BFF/proxy para SmartPed) |
| Linguagem | TypeScript universal |
| Persistência | Turso (SQLite na nuvem) + fallback better-sqlite3 local |
| Cache | L1 (Map memória, 2000 entradas) + L2 (SQLite) |
| APIs | SmartPed (Sandbox/Produção) + Ferramentinhas (ERP) |
| Deploy | Cloud Run (Google Cloud) |

---

## 3. Mapa de Documentação por Domínio

| Arquivo | Conteúdo | Quando ler |
|---------|----------|------------|
| `LLM_CONTEXT.md` (este) | Visão geral + stack + índice | **SEMPRE no início da sessão** |
| `AGENTS.md` | Regras permanentes de operação | **SEMPRE no início da sessão** |
| `docs/architecture.md` | Mapeamento de arquivos, módulos backend, hooks frontend | Ao criar/modificar módulos |
| `docs/business-rules.md` | Regras de negócio, fluxo de dados, algoritmo de otimização | Ao alterar lógica de negócio |
| `docs/sensitive-points.md` | Zonas de perigo, débitos técnicos, ambiente de execução | Antes de tocar em código crítico |
| `docs/testing.md` | Massa de testes, endpoints, scripts de diagnóstico | Ao validar alterações ou debugar |
| `API_TREE_SMARTPED.md` | Árvore de endpoints da SmartPed | Ao integrar novos endpoints |
| `API_TREE_TRIER.md` | Árvore de endpoints do ERP Trier | Ao integrar novos endpoints Trier |

---

## 4. Regras Rápidas (Resumo)

1. Consultar `AGENTS.md` antes de qualquer ação.
2. Nunca logar CNPJ/token em texto claro.
3. Cache L1+L2 — nunca assumir "em memória".
4. Ambos endpoints SmartPed (`Condicoes/Ean` + `Condicoes/Molecula`) em paralelo.
5. Turso em Cloud Run (fallback better-sqlite3 local).
6. Deduplicação por `${Ean}_${CodDist}_${Condicao}_${Prazo}` (sem preço).

---

## 4.1. Cache e Persistência — Contexto de Negócio

### O que o sistema faz
O sistema é um **otimizador de compras em tempo real** para farmácias. O fluxo típico é:
1. Importar arquivo SICF com produtos desejados
2. Consultar API SmartPed para buscar preços/estoque de distribuidoras
3. Sugerir substitutos mais baratos (genéricos, similares)
4. Faturar o pedido diretamente na API SmartPed

### O que muda constantemente (buscar em tempo real)
- Preços das distribuidoras
- Estoque (um produto pode ter estoque agora e não ter daqui a 10 min)
- Promoções e condições comerciais (`QtdMin`, descontos)
- Novos produtos nas distribuidoras

### O que NÃO muda (ou muda raramente)
- Descrição do produto ("SORINAN" sempre será "SORINAN")
- Nome das distribuidoras
- Código EAN do produto
- Laboratório fabricante

### Cache L1 (Map memória) — TTL 5 min
- **Propósito:** Evitar re-chamar a API SmartPed em buscas repetidas (ex: usuário testando variações)
- **Limpeza:** Lazy — só apaga quando a chave é consultada e já expirou
- **Limite:** 2000 entradas (FIFO)
- **Utilidade real no fluxo:** Baixa — no fluxo normal, cada EAN é buscado uma vez

### Cache L2 (Turso/SQLite) — TTL 5 min
- **Propósito:** Backup do cache L1 para quando o servidor reinicia (escalamento para zero do Cloud Run)
- **Limpeza:** Automática a cada 10 min (`startDbCachePurge`)
- **Utilidade real:** Serve como fallback quando o servidor "dorme" e "acorda"

### Persistência permanente (Turso/SQLite) — Sem TTL
- **Tabelas:** `orders`, `order_items`, `faturados`, `itens_confirmados`, `itens_manuais`
- **Propósito:** Histórico de pedidos, faturamento, itens confirmados e itens manuais
- **Utilidade real:** Alta — antes do Turso, esses dados se perdiam a cada restart do Cloud Run
- **Purge automática:** Dados com mais de 6 meses são deletados automaticamente (a cada 24h)

### Tabela `itens_confirmados` — Itens com retorno finalizado
- **Quando salva:** No endpoint `/api/itens-confirmados-do-dia`, ao consultar a API SmartPed
- **O que salva:** Apenas itens com status "faturado" (distribuidora com Status === 3 e QuantFaturada > 0)
- **UPSERT:** Atualiza se o status mudar (ex: item fica "nao_confirmado" e depois vira "faturado")
- **Campos:** num_pedido, ean, descricao, cod_dist, nome_dist, qtd_solicitada, qtd_faturada, preco_liquido, status, motivo, cnpj, data_confirmacao
- **Consulta:** `getItensConfirmados(cnpj, dataInicio?, dataFim?)` — retorna itens confirmados no período

### Tabela `itens_manuais` — Itens adicionados manualmente
- **Quando salva:** Quando o usuário clica no botão "+" para adicionar item manual
- **O que salva:** Todos os itens digitados manualmente (faturados ou não)
- **UPSERT:** Atualiza quantidade e status se já existir
- **Campos:** cod_interno, ean, descricao, laboratorio, distribuidora, cod_dist, qtd, preco_liquido, preco_fabrica, condicao, prazo, cnpj, status, data_adicao
- **Consulta:** `getItensManuais(cnpj, dataInicio?, dataFim?)` — retorna itens manuais no período
- **Endpoints:** `/api/salvar-item-manual` (salvar), `/api/itens-manuais` (consultar)

### Quando o servidor reinicia (Cloud Run)
- Deploy manual (`gcloud run deploy`)
- Escalamento para zero (~15 min sem acesso)
- Escalamento automático (muitas requisições)
- Limite de memória/CPU
- Configuração alterada no Console GCP

### Fallback de persistência
| Cenário | Comportamento |
|---------|---------------|
| Turso configurado e online | Usa Turso (L1 + L2 + persistência) |
| Turso não configurado | Usa better-sqlite3 local (dev) |
| better-sqlite3 falha (Cloud Run/gVisor) | Sem persistência, só cache L1 |
| **Turso configurado mas offline** | **Sem persistência** (catch silencioso, sem fallback automático para better-sqlite3) |

### Conclusão
O cache de 5min para condições comerciais é um "bônus" — o valor real do Turso é a **persistência de pedidos e histórico**, não a performance do cache. O sistema **sempre busca preço/estoque em tempo real** na API SmartPed quando o cache expira.

---

## 4.2. Débitos Técnicos Conhecidos

### ConditionSelector em itens de ruptura (Referência/Ético/O)
- **Problema:** Quando o item original é de Referência/Ético/O e não tem estoque (ruptura), o `validateSwapEquivalence` bloqueia os substitutos antes de salvá-los em `item.alternatives`. O ConditionSelector ficava vazio e buscava em tempo real (lento).
- **Causa raiz:** No caminho de sucesso (linha 1571), `alternatives` era atribuído apenas com `finalAlternatives` (filtrado por `validateSwapEquivalence`), sem fallback para `rawSubstitutosForAlternatives`.
- **Correções aplicadas:**
  1. Fallback `rawSubstitutosForAlternatives` no caminho de sucesso (linha 1571).
  2. Deduplicação em `allAlternativesForRupture` por chave `${Ean}_${CodDist}_${Condicao}_${Prazo}` (sem preço).
  3. Filtro `disabledDistSet` adicionado ao `allAlternativesForRupture` (impedia ORIENTE e outras dist. desabilitadas de vazar para o dropdown).
  4. `itemAlternatives` agora inclui mesmo-EAN mesmo com estoque=0 (seção "CONDIÇÃO DE COMPRA" voltou a aparecer).
  5. `allAlternativesForRupture` inclui mesmo-EAN mesmo com estoque=0 para o fallback.
  6. `findBestSubstitute` em `swap-engine.ts`: removido fallback para ofertas não-reais ("Não Encontrados") em `candidatosSubstitutos` — agora retorna `false` para ofertas não-reais, evitando que "Não Encontrados" ganhe de opções reais mais baratas.
- **Status:** Resolvido e deployado (revisão smartped-cli-00035-w4s).

### Busca no botão "+"
- **Correção aplicada:** `skipMolecula: true` para buscas por descrição (não chama Condicoes/Molecula)
- **Correção aplicada:** `onlyExactEan: true` para buscas numéricas (só EAN exato)
- **Status:** Funcionando

### Itens manuais - persistência
- **Correção aplicada:** Itens manuais salvos em localStorage + Turso
- **Correção aplicada:** Exclusão de item manual remove do localStorage
- **Status:** Funcionando

### Bugs corrigidos nesta sessão
1. `getFromCache()` era síncrona mas chamava `getCache()` (async) → Promise truthy → cache falso
2. `useEffect` em SwapsTable resetava `expandedGroups` quando `showOnlyAlerts` mudava → aba minimizava ao alterar quantidade
3. `scrollIntoView({ block: "center" })` → corrigido para `block: "start"`
4. `originalHasStock` e `todasCondicoesOriginal` usavam `substitutos` (filtrado) em vez de `substitutosRaw` (bruto)
5. `ConditionSelector` em itens de Referência/Ético/O com ruptura: `alternatives` ficava vazio. Corrigido com fallback + deduplicação.
6. `allAlternativesForRupture` não filtrava `disabledDistSet` → ORIENTE e outras dist. desabilitadas vazavam para o dropdown. Corrigido em `server.ts:968`.
7. `itemAlternatives` filtrava mesmo-EAN por `estoque > 0` → seção "CONDIÇÃO DE COMPRA" ficava vazia para itens rupturados. Corrigido: mesmo-EAN agora incluído independentemente de estoque. **Nota:** Revertido no fix #16 — agora mesmo-EAN também exige `estoque > 0` para evitar estoque fictício de catálogo.
8. `findBestSubstitute` em `swap-engine.ts` permitia ofertas não-reais ("Não Encontrados") em `candidatosSubstitutos` quando não havia substitutos reais → escolhia "Não Encontrados" (R$11) em vez de CervoSul (R$8,77). Corrigido: `return false` para não-reais.
9. `TipoItem: "O"` era tratado como Referência/Ético em `validateSwapEquivalence` (swap-validation.ts:129-135) → bloqueava swaps legítimos entre genéricos "O". Removido `"O"` da verificação.
10. `vlr_custopersonalizado` (custo ERP Trier) sobrepun `Pliquido` (preço comercial SmartPed) como preço de substituto. Corrigido em `server.ts:992` e `server.ts:1192` — SmartPed agora tem prioridade.
11. `tiposAceitos = ["G", "O"]` excluía `"S"` (Similar) → todos os substitutos SmartPed eram filtrados durante ruptura. Corrigido em `swap-engine.ts:35-41`: durante ruptura (`!originalHasStock`), qualquer tipo (G, S, R, E) aceito.
12. `isCurrentAlt` em `ConditionSelector.tsx` usava match estrito de 5 campos → nunca casava com ofertas reais. Corrigido para comparação de string normalizada + tolerância R$0,10.
13. Similares Trier eram injetados no array `Substitutos` como falsas alternativas com preços ERP. Removidos do array — Trier só fornece códigos de barras, não preços.
14. `condicoes` da SmartPed (ofertas de preço) não tinham campo `Estoque` → eram descartadas silenciosamente pelo filtro `estoque > 0` do `candidatosSubstitutos`. Corrigido: enriquecimento de `condicoes` com estoque dos `substitutos` correspondentes (mesmo EAN + CodDist) antes de enviar ao `findBestSubstitute`.
15. Enriquecimento de `condicoes` estendido para o `itemAlternatives` (dropdown): `condicoesEnriched` agora zera estoque de condicoes cujo EAN+CodDist não aparece em `substitutos` com estoque > 0. Evita que ANB/SMARTDISTRIBUIDORA (sem estoque real) apareçam no dropdown.
16. **Dropdown mostrava 28 alternativas em vez de 2 (Rosuvastatina):** 3 pontos de fuga permitiam estoque fictício de catálogo SmartPed no dropdown:
    - `condicoesEnriched` (server.ts:1064): `cEan !== origEan` excluía mesmo-EAN do enriquecimento → condicoes mantinham estoque catálogo.
    - `allAlternativesForRupture` (server.ts:946): construído sem enriquecimento de estoque real → fallback usava estoque fictício.
    - `itemAlternatives` (server.ts:1075): `!isSameEan && est <= 0` permitia mesmo-EAN com estoque=0.
    - Frontend `ConditionSelector.tsx:131`: `if (isSameEan) return true` permitia mesmo-EAN independentemente do estoque.
    - **Correção:** (1) Removido `cEan !== origEan` do enriquecimento. (2) `allAlternativesForRupture` agora usa `stockMapByEanDist` para zerar estoque fictício. (3) Filtro `itemAlternatives` agora exige `estoque > 0` para TODOS os itens. (4) Frontend simplificado para `return stock > 0`.

17. **Motor de troca não conhecia NeoSul (R$ 8,04) ao escolher CervoSul (R$ 8,77):**
    - **Causa raiz:** O fluxo consultava apenas o EAN original (7897595620613). A SmartPed **não retorna NeoSul como substituto** desse EAN original. NeoSul só aparece ao consultar o EAN alvo (7898216366149) direto via `Condicoes/Ean`.
    - **Problema arquitetural:** `findBestSubstitute` rodava **antes** de consultar os EANs alvo dos substitutos.
    - **Correção aplicada (server.ts:1295-1380):** Antes do `findBestSubstitute`, coletar todos EANs únicos de substitutos ≠ original → consultar `Condicoes/Ean` + `Condicoes/Molecula` em `Promise.all` para cada → mesclar em `combinedSubstitutos` → rebuild `stockMapByEanDist`/`substitutos`/`condicoesEnriched` → **só então** rodar `findBestSubstitute`.
    - **Status:** Código implementado e corrigido. Bloco PRE agora chama ambos endpoints (Ean + Molecula) conforme regra #12.

18. **Bloco PRE (TARGET-EAN-PRE) não chamava Condicoes/Molecula:**
    - **Problema:** O bloco que consulta EANs alvo antes do motor de troca (server.ts ~1307) chamava apenas `Condicoes/Ean`, violando a regra #12 do AGENTS.md.
    - **Correção:** Adicionada chamada a `Condicoes/Molecula` em `Promise.all` no bloco PRE, igual ao bloco POST (TARGET-EAN-API).
    - **Status:** Corrigido.

19. **Logs de debug removidos:**
    - **Problema:** 11 chamadas a `fs.appendFileSync` escreviam em `debug-logs/stock-trace-*.log` — código de debug desnecessário em produção.
    - **Correção:** Todos os `fs.appendFileSync` removidos. Logs agora vão para o array `logs` (resposta da API). Import de `fs` removido.
    - **Status:** Corrigido.

20. **parseInt para estoque ignorava "Sob Consulta":**
    - **Problema:** O fluxo de otimização usava `parseInt` diretamente para parsear estoque. Quando a API retornava strings como "Sob Consulta", `parseInt` retornava `NaN` → tratado como 0 (sem estoque). O botão flutuante usava `parseSmartPedEstoque` que trata corretamente esses casos.
    - **Causa raiz:** Diferença de parsing entre `/api/search-products` (usava `parseSmartPedEstoque`) e o fluxo de otimização (usava `parseInt` direto).
    - **Correção:** Substituídos 10+ chamadas de `parseInt(...Estoque...)` por `parseSmartPedEstoque(...)` no fluxo de otimização (server.ts). Agora "Sob Consulta" com preço válido é tratado como estoque disponível (retorna 2).
    - **Status:** Corrigido.

21. **Busca por tipo de item — Genéricos buscam completa, Éticos buscam mesmo produto:**

22. **Sync de preços — purge corrigido + fallback descartado + EANs fixos populados:**
    - **Purge:** Movido para DEPOIS da busca bem-sucedida (era antes → perdia 7470 registros se falhasse).
    - **Teste local:** 567 sugestões, 448 EANs, 3601 preços salvos no Turso (teste do sync original).
    - **Fallback inteligente (EANs no Turso):** Criado tabela `sugestoes_eans`, funções, endpoint → **REMOVIDO** — analisado e descartado pois sem preços o `precos_cache` não serve (RUPTURA-REGEX exige preço+estoque).
    - **Decisão final:** **Não sincronizar preços** no Cloud (variam muito, cache desatualizado não ajuda).
    - **Implementado:** Endpoint `/api/sync-eans-fixed` — roda UMA VEZ local, popula EANs do `Sugestoes` na tabela existente `sugestoes_eans` (Turso).
    - **Resultado:** 449 EANs únicos salvos no Turso (tabela `sugestoes_eans`).
    - **Cloud Run:** `runPriceSync` comentado (não roda mais), `checkAndRunPriceSync` comentado (auto-sync 10h desligado), endpoint `/api/sync-prices` mantido mas com placeholder desativado.
    - **Reativação futura:** Descomentar `runPriceSync`, `checkAndRunPriceSync`, endpoint `/api/sync-prices` e configurar Cloud NAT se quiser voltar a sincronizar preços.
    - **Status:** Código limpo, pronto para deploy.
    - **Problema:** O caminho sem ruptura fazia busca limitada para TODOS os tipos de item (apenas TARGET-EAN-PRE, sem RUPTURA-REGEX). Genéricos com estoque não encontravam todos os fabricantes equivalentes. Éticos/Similares tinham dropdown filtrado para apenas 2 EANs.
    - **Causa arquitetural:** A condição `if (!originalHasStock)` bloqueava a RUPTURA-REGEX e o filtro de dropdown flexível para todos os itens com estoque.
    - **Correção aplicada (server.ts):**
      1. **RUPTURA-REGEX** (linha ~1459): Condição alterada de `if (!originalHasStock)` para `if (!originalHasStock || isGeneric)` — genéricos com estoque agora buscam por descrição via `Produtos/Buscar`.
      2. **Filtro do dropdown** (linha ~2022): Três caminhos distintos:
         - **Genérico sem ruptura:** NÃO filtra por EAN — mantém TODAS as alternativas genéricas
         - **Ético/Similar sem ruptura:** Filtra para mesmo produto — inclui EAN original + EANs de `combinedSubstitutos` com mesma descrição (mesmo produto, código de barras diferente na SmartPed)
         - **Ruptura:** NÃO filtra por EAN (inalterado)
      3. **Type filtering em swap-engine.ts:** NÃO alterado — mantém filtros estritos para itens com estoque (genérico→genérico, marca→marca)
    - **Arquivos afetados:** `server.ts` (linhas ~1455-1459, ~2022-2030)
    - **Documentação:** `docs/business-rules.md` seção 4.20 atualizada
    - **Status:** Implementado.

22. **Badge QtdMin no dropdown e mensagem "CONDIÇÃO/PRAZO" corrigida:**
    - **Problema 1:** O dropdown do ConditionSelector mostrava `QtdMin` apenas para substitutos (outro laboratório), não para ofertas do mesmo produto.
    - **Correção 1:** Adicionado `⚠️[MÍN:Xun]` no rendering de `sameProductAlts` em `ConditionSelector.tsx:243-249`.
    - **Problema 2:** Mensagem "CONDIÇÃO/PRAZO" aparecia para itens mantidos (mesmo EAN), implicando troca inexistente.
    - **Correção 2:** Separado em dois casos em `SwapsTable.tsx:637-646`:
      - `novoEan === originalEan` → "✅ MANTIDO: Mesmo produto na melhor distribuidora"
      - `novoEan !== originalEan` → "💡 Substituto com estoque disponível"
    - **Status:** Implementado.

23. **RUPTURA-REGEX consulta precos_cache antes de API:**
    - **Problema:** RUPTURA-REGEX fazia chamadas individuais `Condicoes/Ean` para cada EAN descoberto pelo `Produtos/Buscar` (16 EANs = 16 chamadas API).
    - **Correção:** Antes de chamar API, consulta `precos_cache` via `getPrecoCacheByEans()`. EANs encontrados entram direto no `combinedSubstitutos` sem chamada API. Apenas EANs ausentes vão à API.
    - **Resultado:** Rosuvastatina (16 EANs) → `Cache: 16/16 | API chamada: 0`. Aciclovir (9 EANs) → `Cache: 9/9 | API: 0`.
    - **Status:** Implementado.

24. **RUPTURA-REGEX salva no precos_cache para reuso futuro:**
    - **Problema:** EANs descobertos pelo RUPTURA-REGEX não eram salvos no cache. Na próxima otimização, os mesmos EANs iam à API novamente.
    - **Correção:** Após chamada API no RUPTURA-REGEX, resultados são salvos em batch via `savePrecosCacheBatch()`. EANs ficam disponíveis para reuso no mesmo dia.
    - **Status:** Implementado.

25. **Purge diário do precos_cache às 10h:**
    - **Problema:** preços cached pelo RUPTURA-REGEX poderiam ficar desatualizados se a SmartPed alterasse preços durante o dia.
    - **Correção:** Função `purgePrecosCache()` deleta TODOS os registros antes do `runPriceSync()` às 10h. Ciclo: purge → sync → cache limpo.
    - **Status:** Implementado.

26. **ConditionSelector: badge de condição atual (não tenta match na lista):**
    - **Problema:** `isCurrentAlt` tentava combinar `item.novoEan` + `item.distribuidora` com as alternativas. Mas o item escolhido pelo motor (GCMEDICAMENTOS, R$5.87) **não existia** na lista de alternativas (fora deduplicado/filtrado). Resultado: dropdown sempre mostrava "Selecione uma condição..." sem marcar nada.
    - **Causa raiz:** As alternativas são as opções DISPONÍVEIS para troca, não incluem a opção já escolhida.
    - **Correção:** Badge azul separado acima do dropdown mostra ★ Atual: `[GCMEDICAMENTOS] R$ 5,87 | FIXA | EAN: 7897595635792`. Dropdown lista apenas alternativas para trocar.
    - **Arquivo:** `src/components/ConditionSelector.tsx`
    - **Status:** Implementado.

27. **Sync de preços (`runPriceSync`) — purge antes da sync + Sugestoes retorna null do Cloud:**
    - **Problema 1 (CRÍTICO):** `purgePrecosCache()` era chamado ANTES da busca de Sugestoes. Se a sync falhasse, o cache ficava vazio (7470 registros perdidos).
    - **Correção 1:** Purge movido para DEPOIS da busca bem-sucedida. Agora: busca → [sucesso] → purge → salva.
    - **Problema 2 (BLOQUEIO DE IP):** O endpoint `Condicoes/Sugestoes` retorna `{ Mensagem: "...", Retorno: null }` quando chamado do Cloud Run. Localmente funciona (540 sugestões). Causa provável: SmartPed filtra/rejeita requests de IPs de datacenter (Cloud Run usa IPs dinâmicos de datacenter do Google).
    - **Evidência:** `Condicoes/Ean` e `Condicoes/Molecula` funcionam do Cloud (botão +). Apenas `Sugestoes` falha.
    - **Impacto:** `precos_cache` fica vazio no Cloud — sync de preços não popula dados.
    - **Status:** PURGE CORRIGIDO. Sync funciona LOCAL (testado: 567 sugestões, 448 EANs, 3601 preços salvos). No Cloud falha por bloqueio de IP do `Sugestoes`.
    - **Decisão (esta sessão):** Avaliado fallback inteligente (salvar só EANs no Turso) → **DESCARTADO** — sem preços, o `precos_cache` não serve para nada (RUPTURA-REGEX precisa preço+estoque). Opções restantes: Cloud NAT (~$32/mês), contato SmartPed, ou aceitar cache vazio no Cloud.

28. **Sync de produtos (`runSyncInBackground`) — nunca popula `produtos_cache`:**
    - **Problema:** O endpoint `/api/sync-produtos` não tem trigger automático (diferente do sync-prices que roda às 10h). A tabela `produtos_cache` fica eternamente vazia.
    - **Além disso:** O parsing de `Lancamentos` e `Sugestoes` dentro de `runSyncInBackground` retorna "undefined encontrados" — bug pré-existente.
    - **Status:** PENDENTE — precisa de auto-run + correção de parsing.

29. **Regra de debug: pesquisa em forums/GitHub antes de propor soluções:**
    - **Problema:** Durante debug, tentei propor soluções (fallback para EAN_DATABASE) sem antes pesquisar a causa raiz em forums, GitHub ou documentação profissional.
    - **Regra:** Sempre pesquisar em fonts externas (GitHub issues, StackOverflow, docs oficiais) antes de propor soluções de infra/debug. Evitar "inventar" soluções.
    - **Status:** ADICIONADA como regra #26 no AGENTS.md.

---

## 4.21. Sync de Preços no Cloud — Status Atual

### Contexto
- `runPriceSync()` chama `Condicoes/Sugestoes` para obter EANs do histórico de compras
- **Local:** retorna 567 sugestões, 448 EANs únicos, 3601 preços salvos (testado nesta sessão)
- **Cloud Run:** retorna `{ Mensagem: "...", Retorno: null }` → sync falha → cache vazio
- Outros endpoints (`Condicoes/Ean`, `Condicoes/Molecula`) funcionam normalmente do Cloud

### Causa Provável
SmartPed API filtra ou rejeita requests de IPs de datacenter. Cloud Run usa IPs dinâmicos de datacenter do Google (não residenciais).

### Avaliação de Soluções (esta sessão)

| Opção | Veredito |
|-------|----------|
| **IP estático via Cloud NAT** | Viável (~$32/mês) — resolveria raiz |
| **Proxy residencial** | Complexo, custo variável |
| **Fallback inteligente (EANs no Turso)** | **DESCARTADO** — sem preços, `precos_cache` não serve (RUPTURA-REGEX precisa preço+estoque) |
| **Contato SmartPed** | Pendente — pode resolver raiz |
| **Sync via Cron externo** | Funciona — rodar local e enviar ao Turso |

### Decisão Final (Esta Sessão)

**Não sincronizar preços** no Cloud Run — preços variam muito, cache desatualizado não ajuda. RUPTURA-REGEX chama API direto (mais lento mas sempre fresco).

**Implementado:** Endpoint `/api/sync-eans-fixed` — roda UMA VEZ local, popula EANs do `Sugestoes` na tabela existente `sugestoes_eans` (Turso).
- **Resultado:** 449 EANs únicos salvos no Turso.
- **Cloud Run:** `runPriceSync` comentado, `checkAndRunPriceSync` comentado (auto-sync 10h desligado), endpoint `/api/sync-prices` com placeholder desativado.
- **Reativação futura:** Descomentar `runPriceSync`, `checkAndRunPriceSync`, endpoint `/api/sync-prices` + configurar Cloud NAT (~$32/mês) se quiser voltar a sincronizar preços.

### Opções para Próxima Ação (se quiser resolver)
1. Configurar Cloud NAT no GCP (custo ~$32/mês, resolve definitivamente)
2. Contatar SmartPed para whitelist de IP
3. Aceitar status quo: no Cloud `precos_cache` vazio, RUPTURA-REGEX chama API direto

---

## 5. Funções de Busca por Tipo de Item

### Funções-Chave no Backend

| Função | Arquivo | O que faz |
|--------|---------|-----------|
| `findBestSubstitute()` | `server/swap-engine.ts` | Motor de troca — escolhe o melhor candidato (menor preço com estoque) |
| `validateSwapEquivalence()` | `swap-validation.ts` | Valida dosagem, apresentação, sabor — Hard Block se divergente |
| `parseSmartPedEstoque()` | `server/parsers.ts` | Normaliza estoque SmartPed (0/1/2, "Sob Consulta", etc.) |
| `resolveDistName()` | `server.ts` | Resolve nome da distribuidora com fallback em cascata |
| `getUnitCost()` | `server/parsers.ts` | Extrai preço líquido de qualquer formato SmartPed |
| `isRealOffer()` | `server/parsers.ts` | Diferencia oferta real de "Não Encontrados" (CodDist=0) |
| `cleanEan()` | `server/ean-utils.ts` | Normaliza EAN (remove zeros à esquerda, padStart 13) |

### Endpoints SmartPed Chamados

| Endpoint | Quando chama | O que retorna |
|----------|-------------|---------------|
| `Condicoes/Ean` | Sempre (lote inicial + TARGET-EAN-PRE + RUPTURA-REGEX) | Ofertas comerciais do EAN (preço, estoque, condição) |
| `Condicoes/Molecula` | Sempre em paralelo com Ean | Substitutos moleculares + QtdMin |
| `Produtos/Buscar` | RUPTURA-REGEX (ruptura ou genérico) | Busca por descrição → retorna EANs |
| `Condicoes/Distribuidores` | Startup do servidor | Lista completa de distribuidoras |

### Fluxo de Busca por Tipo

```
┌─────────────────────────────────────────────────────────────────┐
│                    FLUXO DE OTIMIZAÇÃO                           │
│                   endpoint /api/optimize                          │
├─────────────────────────────────────────────────────────────────┤
│                                                                  │
│  1. COTAÇÃO EM LOTE (todos os EANs do SICF)                     │
│     ├─ Condicoes/Ean (batch de 40, AceitaOntem=1)               │
│     └─ Condicoes/Molecula (batch de 40, ConsideraTipo=1)        │
│     → apiResponses[ean] = { ItemPedido, Substitutos[], Condicoes[] }│
│                                                                  │
│  2. FALLBACK POR PRINCÍPIO ATIVO (itens sem ofertas)            │
│     ├─ Ferramentinhas API → descobre DCB/molécula                │
│     ├─ Condicoes/Molecula (por DCB)                             │
│     ├─ Condicoes/Molecula (por molécula extra)                   │
│     └─ Produtos/Buscar (por descrição limpa + dosagem)           │
│     → Injeta novos Substitutos[] em apiResponses[ean]            │
│                                                                  │
│  3. UNIFICAÇÃO POR ITEM (loop parsedItems)                      │
│     ├─ combinedSubstitutos[] (EAN original + equivalentes locais │
│     │   + similares Ferramentinhas)                              │
│     ├─ stockMapByEanDist (estoque real por EAN+CodDist)          │
│     └─ allAlternativesForRupture (deduplicado)                   │
│                                                                  │
│  4. DECISÃO: originalHasStock?                                   │
│     ├─ condicoesOriginal.some(estoque > 0)                       │
│     └─ Define isGeneric (TipoItem="G" ou desc inclui "generico") │
│                                                                  │
│  5. BUSCAS EXTRAS (conforme tipo)                               │
│     ├─ TARGET-EAN-PRE: consulta EANs alvo dos substitutos       │
│     │   └─ Condicoes/Ean + Condicoes/Molecula para cada EAN     │
│     ├─ RUPTURA-REGEX: busca por descrição (Produtos/Buscar)      │
│     │   └─ Ativo se: !originalHasStock OU isGeneric              │
│     └─ Rebuild: substitutos, condicoes, stockMap, condicoesEnriched│
│                                                                  │
│  6. MOTOR DE TROCA (findBestSubstitute)                          │
│     ├─ Filtra por: estoque>0, preço>0, tipo, categoria, equivalência│
│     ├─ Ordena por: isRealOffer DESC, preço ASC                  │
│     ├─ Se originalHasStock: exige economia >= margemMinima       │
│     └─ Se ruptura: aceita qualquer preço com estoque             │
│                                                                  │
│  7. PÓS-MOTOR                                                    │
│     ├─ TARGET-EAN-API: consulta EAN alvo do substituto escolhido│
│     │   └─ Condicoes/Ean + Condicoes/Molecula (enriquece)       │
│     ├─ Filtro do dropdown por tipo:                              │
│     │   ├─ Genérico: TODOS os EANs                               │
│     │   ├─ Ético/Similar: mesmo produto (EAN + desc igual)       │
│     │   └─ Ruptura: TODOS os EANs                                │
│     └─ Fallback Ferramentinhas (apenas ruptura, se motor=null)   │
│                                                                  │
│  8. MONTAGEM DO REPORT                                           │
│     ├─ item.qtdMin = melhor.QtdMin (do motor)                   │
│     ├─ item.alternatives = finalAlternatives (dropdown)          │
│     └─ item.isRupturaSubstitution = !originalHasStock && found   │
│                                                                  │
└─────────────────────────────────────────────────────────────────┘
```

---

## 6. Comandos de Execução

### npm (desenvolvimento)
```bash
npm run dev      # Dev server (Vite + Express, porta 3000)
npm run build    # Build frontend + backend (esbuild → dist/server.cjs)
npm run start    # Produção (build prévio necessário)
npm run lint     # Type checking (tsc --noEmit)
```

### Git
```bash
git status                           # Ver alterações pendentes
git diff                             # Ver diff das alterações
git log --oneline -10                # Ver últimos 10 commits
git checkout master                  # Voltar para branch principal
git checkout -b backup/nome          # Criar branch de backup
git add -A && git commit -m "msg"    # Commit das alterações
git push origin master               # Push para GitHub
```

### Google Cloud CLI (gcloud)
```powershell
# Path do gcloud no Windows
$gcloud = "C:\Users\carlo\AppData\Local\Google\Cloud SDK\google-cloud-sdk\bin\gcloud.cmd"

# Deploy com variáveis Turso
$envFile = Get-Content .env
$tursoUrl = ($envFile | Select-String "TURSO_DATABASE_URL=").ToString().Split("=",2)[1]
$tursoToken = ($envFile | Select-String "TURSO_AUTH_TOKEN=").ToString().Split("=",2)[1]
& "$gcloud" run deploy smartped-cli --source . --region us-east1 --project gen-lang-client-0702342051 --set-env-vars="TURSO_DATABASE_URL=$tursoUrl,TURSO_AUTH_TOKEN=$tursoToken"
```

### Produção (URL fixa)
**URL:** https://smartped-cli-887122622666.us-east1.run.app

**Versão atual (deploy 2026-08-17):** `smartped-cli-00040-dk4`

**Estado do deploy:**
- `runPriceSync` desativado (código comentado)
- `checkAndRunPriceSync` desativado (auto-sync 10h desligado)
- `/api/sync-prices` retorna 503 DESATIVADO
- `/api/sync-eans-fixed` disponível (roda 1x local → popula `sugestoes_eans` no Turso)
- `precos_cache` vazio no Cloud — RUPTURA-REGEX chama API direto

# Ver logs (últimas 20 entradas)
& "$gcloud" logging read "resource.type=cloud_run_revision AND resource.labels.service_name=smartped-cli" --limit 20 --project gen-lang-client-0702342051 --format="text(timestamp,textPayload)"

# Logs frescos (últimos 2min)
& "$gcloud" logging read "resource.type=cloud_run_revision AND resource.labels.service_name=smartped-cli" --limit 20 --project gen-lang-client-0702342051 --format="text(timestamp,textPayload)" --freshness=2m

# Descrever serviço
& "$gcloud" run services describe smartped-cli --region us-east1 --project gen-lang-client-0702342051

# Listar revisões (últimas 5)
& "$gcloud" run revisions list --region us-east1 --project gen-lang-client-0702342051 --limit 5

# Descrever revisão específica
& "$gcloud" run revisions describe smartped-cli-00035-w4s --region us-east1 --project gen-lang-client-0702342051

# Ver variáveis de ambiente configuradas no serviço
& "$gcloud" run services describe smartped-cli --region us-east1 --project gen-lang-client-0702342051 --format="value(spec.template.spec.containers[0].env)"
```

### Endpoints de Administração (chamar via Invoke-RestMethod)
```powershell
# Variáveis base
$envFile = Get-Content .env
$token = ($envFile | Select-String "SMARTPED_PRODUCTION_TOKEN=").ToString().Split("=",2)[1]
$cnpj = ($envFile | Select-String "SMARTPED_DEFAULT_CNPJ=").ToString().Split("=",2)[1]
$body = @{ token = $token; cnpj = $cnpj } | ConvertTo-Json

# Trigger sync de preços manual
Invoke-RestMethod -Uri "https://smartped-cli-887122622666.us-east1.run.app/api/sync-prices" -Method POST -ContentType "application/json" -Body $body

# Status do sync de preços
Invoke-RestMethod -Uri "https://smartped-cli-887122622666.us-east1.run.app/api/sync-prices/status" -Method GET

# Trigger sync de produtos manual
Invoke-RestMethod -Uri "https://smartped-cli-887122622666.us-east1.run.app/api/sync-produtos" -Method POST -ContentType "application/json" -Body $body

# Status do sync de produtos
Invoke-RestMethod -Uri "https://smartped-cli-887122622666.us-east1.run.app/api/sync-status" -Method GET

# Health check
Invoke-RestMethod -Uri "https://smartped-cli-887122622666.us-east1.run.app/api/health" -Method GET
```

### Terminal (processos)
```powershell
# Matar processos node (quando porta 3000 em uso)
Get-Process -Name "node" | Stop-Process -Force

# Verificar porta em uso
Get-NetTCPConnection -LocalPort 3000

# Limpar cache npm
npm cache clean --force
```

---

## 8. Variáveis de Ambiente

| Variável | Descrição |
|----------|-----------|
| `SMARTPED_PRODUCTION_TOKEN` | Token API SmartPed produção |
| `SMARTPED_SANDBOX_TOKEN` | Token API SmartPed sandbox |
| `SMARTPED_DEFAULT_CNPJ` | CNPJ default para chamadas API |
| `SMARTPED_PRODUCTION_URL` | URL base produção (padrão: `https://api.smartped.com.br`) |
| `SMARTPED_SANDBOX_URL` | URL base sandbox (padrão: `https://apitest.smartped.com.br`) |
| `FERRAMENTINHAS_API_URL` | URL API Ferramentinhas |
| `TURSO_DATABASE_URL` | URL do banco Turso (ex: `libsql://smartped-db.turso.io`) |
| `TURSO_AUTH_TOKEN` | Token de autenticação Turso |
| `APP_ADMIN_EMAILS` | E-mails admin (separados por vírgula) |
| `APP_ADMIN_PASSWORD` | Senha admin |

---

## 9. LGPD - Dados Sensíveis

- **CNPJ** circula em: `/api/optimize`, `/api/faturar`, `/api/pedidos-do-dia`, cache L1+L2, SQLite `orders.cnpj`
- **Token SmartPed** circula em: headers de API, cache, `config.ts` via `.env`
- **Mascaramento obrigatório** em logs: `maskCnpj(cnpj)` → `13.408.443/0001-***`
- **Retenção:** Cache tem purga automática (10 min); dados permanentes têm purge de 6 meses (a cada 24h)
