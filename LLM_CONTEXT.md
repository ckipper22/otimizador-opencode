# Contexto do Projeto: Otimizador de Pedidos SmartPed (LLM Context)

Este documento é o **índice de contexto** do projeto. Leia-o no início de qualquer sessão para entender o propósito, a stack e onde encontrar detalhes por domínio.

## 1. Visão Geral e Objetivo do Sistema

**O que o software faz:**
Otimiza financeiramente compras de medicamentos para farmácias, conectando-se à API SmartPed para buscar concorrentes e sugere trocas inteligentes por menor preço.

**Como funciona:**
Upload de arquivo SICF → parsing de EANs → consulta SmartPed (moléculas/genéricos) → sugestão de trocas com economia → faturamento direto na API.

**Perfil de Uso:** B2B interno (compradores de drogarias).

**Fuso horário do usuário:** America/Sao_Paulo (UTC-3) — Panambi, RS.

---

## 1.1. BUGS JÁ RESOLVIDOS — NÃO TENTAR CORRIGIR NOVAMENTE

> **Leia esta tabela ANTES de qualquer investigação.** Se o problema parecer familiar, a correção já existe.

| Bug | Sintoma | Correção | Arquivo |
|-----|---------|----------|---------|
| Deploy apaga env vars | Variáveis Some/not authorized/401 | `--env-vars-file cloud-env.yaml` (NUNCA `--set-env-vars`) | DEPLOY.md |
| Porta 3000 no Cloud | Server starts on 3000, Cloud expects 8080 | `NODE_ENV: "production"` no cloud-env.yaml | server/config.ts:16 |
| Encomendas "Sem ofertas" | `ofertas:[]` para EANs válidos | Extrair `item.Condicoes[]` (não `item` direto) | server.ts batch endpoint |
| QtdMin sempre 0 | Só chamava `Condicoes/Ean` | Chamar AMBOS `Ean` + `Molecula` em `Promise.all` | AGENTS.md #12 |
| Cache morre no restart | Acha que L1 sumiu | L2 (Turso) persiste. Ler L1→L2, escrever em ambos | AGENTS.md #13 |
| PMC ausente/errado | `PMC: 0` ou `undefined` | `offer.PMC \|\| offer.pmc` (case-sensitivity) | AGENTS.md #28 |
| SIGSEGV no Cloud | better-sqlite3 crash | Turso em produção, better-sqlite3 só local | AGENTS.md #15 |
| NomeDist ausente | Dropdown sem nomes | Extrair de `Retorno.dists[]` via `CodDist` match | API_TREE_SMARTPED.md |
| Dedup por preço errado | Ofertas duplicadas na UI | Chave: `${Ean}_${CodDist}_${Condicao}_${Prazo}` (sem preço) | AGENTS.md #16 |
| Encomendas preço R$ 0.00 | Backend retorna PascalCase (NomeDist, Pliquido), frontend espera lowercase | Normalizar antes de retornar no batch endpoint | server.ts, App.tsx:3165 |
| Mojibake impedia filtro de "Não Encontrados" | Defaults hardcoded tinham `"NÃ£o Encontrados"` (Latin-1), comparações usavam UTF-8 — nunca casavam | Usar `isNotFoundName()` (helper centralizado) em TODAS as checagens. **NUNCA** fazer `dist.includes("NÃO ENCONTRADOS")` inline | server.ts `isNotFoundName()`, AGENTS.md #19, #31 |

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
| `docs/encomendas-integration.md` | API Encomendas: auth, endpoints, fluxo completo | Ao integrar ou debugar encomendas |

---

## 4. Regras Rápidas (Resumo)

1. Consultar `AGENTS.md` antes de qualquer ação.
2. Nunca logar CNPJ/token em texto claro.
3. Cache L1+L2 — nunca assumir "em memória".
4. Ambos endpoints SmartPed (`Condicoes/Ean` + `Condicoes/Molecula`) em paralelo.
5. Turso em Cloud Run (fallback better-sqlite3 local).
6. Deduplicação por `${Ean}_${CodDist}_${Condicao}_${Prazo}` (sem preço).
7. **TipoItem "P" = Perfumaria** — API retorna `Substitutos: []` e `Molecula: ""`. Não buscar substitutos para perfumaria. Ver `API_TREE_SMARTPED.md` seção 2.
8. **Classificação vem da Ferramentinhas** (`grupo`), NÃO da SmartPed. Ver AGENTS.md #25.
9. **REGEX sempre como complemento** — Molecula como base + Produtos/Buscar pra enriquecer. Ver AGENTS.md #25.
10. **ALINHAMENTO FRONTEND/BACKEND** — sempre que alterar um lado, confirmar no outro. Ver AGENTS.md #27.
11. **`resolveCategoria()`** — função normalizadora em `server/parsers.ts`. Fonte: Ferramentinhas `grupo` > SmartPed TipoItem > suffixo Molecula > descrição. Usar em vez de lógica espalhada.
12. **DEPENDÊNCIAS CRUZADAS** — antes de alterar qualquer função, consultar tabela em AGENTS.md (seção "DEPENDÊNCIAS CRUZADAS"). Cada função lista todos os pontos que precisam ser verificados.

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

30. **Modal Importar Encomendas — Refatoração Completa (2026-08-18):**
    - **Layout tabela horizontal** (igual modal "+" adição manual): Checkbox | Produto&EAN | Cliente/Hora | Observação | Oferta(Dropdown) | Qtd
    - **Dropdown separado em 2 grupos** (`<optgroup>`): 📦 Mesmo Produto (mesmo EAN) | 🔄 Genéricos/Similares (outro EAN)
    - **Ordenação**: mesmo EAN primeiro, depois preço ascendente
    - **Busca sem filtro `tipos`** — encomendas não filtram por [G,O], retorna todas ofertas com estoque
    - **Observação**: TODAS em vermelho (`text-red-700 bg-red-50 font-bold text-[12px]`)
    - **Cliente/Hora**: telefone, dataHora, fornecedor, previsão em `text-[11px]` (tamanho dropdown)
    - **Estado persistente**: linha amarela + botão verde "Adicionado" ao importar (não some após 2.5s)
    - **Botões "Adicionar" individuais REMOVIDOS** — fluxo: marcar checkboxes → ajustar qtd → "Importar Selecionados" (um clique)
    - **Toolbar/rodapé compactos** — mais linhas visíveis
    - **Proteção anti-busca-desnecessária**: ConditionSelector e ObservationBell pulam itens `origem="encomenda" || "manual"` (evita centenas de chamadas Molecula/Similares/Substitutos)
    - **`alternatives` preenchido** nos 3 pontos de adição (encomenda individual, lote, botão "+") — evita busca tempo real
    - **Arquivos**: `src/App.tsx` (modal encomendas), `src/hooks/useManualSearch.ts`, `src/components/ConditionSelector.tsx`, `src/components/ObservationBell.tsx`, `src/components/SwapsTable.tsx`

31. **PMC — Correção completa (2026-08-18):**
    - **Problema 1:** Backend (`server.ts` `/api/search-products`) retornava `pmc: 0` para todos — `extractPmc()` não encontrava o campo pois `foundItems` tinha PMC mas o re-mapping para `mappedItems` perdia a informação.
    - **Problema 2:** Frontend (`App.tsx:2830`) só verificava `offer.PMC` (uppercase), mas o backend retornava `pmc` (lowercase).
    - **Causa raiz backend:** `extractPmc()` era chamado em dados brutos da SmartPed antes do enriquecimento. PMC real vinha no array `foundItems` via `PMC: finalPmc` mas o re-mapping re-extraía de `c` (raw) que não tinha PMC.
    - **Correções:**
      1. Backend: `extractPmc()` agora busca em `foundItems` (enriquecidos) ANTES de buscar em `c` (raw). Não calcula mais fallback `preco * 1.4`.
      2. Frontend: PMC case-sensitivity corrigido — `(offer.PMC !== undefined && offer.PMC > 0) || (offer.pmc !== undefined && offer.pmc > 0)`.
      3. Normalização: `useManualSearch.ts:227` usa `PMC: rawOffer.PMC ?? rawOffer.pmc ?? rawOffer.Pmc ?? 0`.
      4. Visual: PMC exibido dentro da coluna "Preço Líquido" (pLiq), fonte 11px bold, texto rosa, fundo rosa transparente (`bg-pink-100/60`).
    - **Regra definida:** PMC só aparece se a SmartPed retornar. NUNCA calcular fallback `preco * 1.4`.
    - **Arquivos afetados:** `server.ts` (extractPmc + response mapping), `src/App.tsx:2830` (case-sensitivity), `src/hooks/useManualSearch.ts` (normalização)
    - **Deploy:** `smartped-cli-00045-hxd` (Cloud Run)
    - **Status:** RESOLVIDO

32. **Encomendas — alternatives agora leva todas as ofertas (2026-08-18):**
    - **Problema:** Ao importar encomendas (lote ou individual), o `alternatives` recebia apenas 1 oferta (a selecionada no dropdown). Resultado: ConditionSelector no pré-pedido ficava sem opções para trocar fornecedor/condição. Se o pedido mínimo não batia, não havia como mudar.
    - **Causa raiz:** `handleConfirmImportEncomendas` e `handleAddEncomendaItem` criavam `alternatives: [{...singleOffer}]` em vez de mapear todas as `item.ofertas`.
    - **Correções:**
      1. Ambos os caminhos agora fazem `(item.ofertas || []).filter(Boolean).map(...)` — todas as ofertas viram alternativas.
      2. `types.ts`: campos `precoLiquido`, `codProdutoDist`, `codProduto`, `pedidoMinimo`, `origem`, `idEncomenda` adicionados ao tipo `SwapReportItem` e `alternatives`.
    - **Deploy:** `smartped-cli-00047-c4j` (Cloud Run)
    - **Status:** RESOLVIDO

33. **PMC precedência de operadores — tela branca no modal "+":**
    - **Problema:** Condição `{(offer.PMC !== undefined && offer.PMC > 0) || (offer.pmc !== undefined && offer.pmc > 0) && (<span>)}` tinha precedência incorreta — `&&` vinculava antes de `||`, fazendo retornar `true` (React null) quando `offer.PMC > 0`.
    - **Correção:** Adicionados parênteses externos: `{((... || ...)) && (<span>)}`.
    - **Deploy:** `smartped-cli-00047-c4j` (Cloud Run)
    - **Status:** RESOLVIDO

34. **Variáveis de ambiente perdidas no deploy — encomendas "Não autorizado":**
    - **Problema:** Deploy com `--set-env-vars="TURSO_..."` substituiu TODAS as variáveis, apagando `ENCOMENDAS_INTEGRATION_KEY` e `ENCOMENDAS_API_URL` do Cloud Run. Encomendas retornavam 401 "Não autorizado".
    - **Causa raiz:** `--set-env-vars` substitui (não adiciona). Variáveis de integração foram perdidas.
    - **Correção:** Deploy agora usa `--env-vars-file cloud-env.yaml` com todas as 12 variáveis do `.env`.
    - **Nota:** Arquivo `cloud-env.yaml` é temporário (gerado e deletado após deploy). Não commitar.
    - **Deploy:** `smartped-cli-00046-q6q` + `00047-c4j` (Cloud Run)
    - **Status:** RESOLVIDO

35. **REGRESSÃO — "Não Encontrados" como substituto escolhido (2026-08-18):**
    - **Problema:** EAN 7897595635792 (ROSUVASTATINA) aparece com `★ Atual: [Não Encontrados] R$ 11,02 | FIXA`.
    - **Causa raiz:** `findBestSubstitute` em `swap-engine.ts` **está correto** (rejeita não-reais com `return false`). Porém, a cadeia de fallback do `alternatives` (server.ts:2825-2829) cai em `rawSubstitutosForAlternatives` ou `substitutos` quando `finalAlternatives` está vazio. Esses arrays vêm de `allAlternativesForRupture` (server.ts:1696) que pode conter "Não Encontrados" de `mappedSimilares` (CodDist=0).
    - **Correção:** Filtrar ofertas não-reais do `allAlternativesForRupture` e da cadeia de fallback do `alternatives` via `isNotFoundName()`.
    - **Status:** RESOLVIDO (bug #42)

36. **REGRESSÃO — CodDist aparecendo em vez de NomeDist (2026-08-18):**
    - **Problema:** Dropdown mostra código do fornecedor (ex: `12345`) em vez do nome (ex: `GCMEDICAMENTOS`).
    - **Causa raiz:** `resolveDistName()` (server.ts:68-81) usa `DISTRIBUIDORAS_DYNAMIC_CACHE` populado apenas com dados do **sandbox** no startup. O código antigo (commit `8763c6f`) fazia `distsMapLocal[d.CodDist] = d.NomeDist` inline a cada resposta da API via `Retorno.dists[]`. O commit `363cb98` (busca por tipo) abandonou esse padrão — `allAlternativesForRupture` (server.ts:1630) e `itemAlternatives` (server.ts:1836) usam `s.NomeDist || s.nomeDist || "Distribuidor"` mas `NomeDist` **não vem** nos objetos individuais de substitutos SmartPed (vem em `Retorno.dists[]`, não no `Substitutos[]`).
    - **Correção:** Restaurado `DISTRIBUIDORAS_MAP` como fallback em `resolveDistName()` + `allAlternativesForRupture` e `itemAlternatives` agora usam `resolveDistName()`.
    - **Status:** RESOLVIDO (bug #42)

37. **Ruptura falso — mesmo EAN como substituto de si mesmo (2026-08-18):**
    - **Problema:** TANDERALGIN 15CP (EAN 7893454714479) mostra "🔴 RUPTURA" mas o substituto tem o **mesmo EAN** e mesma descrição. Preço unitário idêntico (R$ 6,15).
    - **Causa raiz:** `isRupturaSubstitution = !originalHasStock && finalResult` (server.ts:2774). Se `condicoesOriginal` fica vazio porque o filtro `cleanEan(s.Ean) === cleanEan(item.ean)` (server.ts:1900) não casa (zeros à esquerda, formatação diferente), `originalHasStock = false`. Motor encontra substituto com mesmo EAN (outro CodDist) → `isRupturaSubstitution = true` indevidamente.
    - **Correção:** `isRupturaSubstitution` agora inclui `&& novoEan !== cleanEan(item.ean)` — mesmo EAN = não ruptura.
    - **Status:** RESOLVIDO (bug #42)

38. **UX — Dropdown não separa "Mesmo Produto" vs "Genéricos/Similares" (2026-08-18):**
    - **Problema:** Modal de busca manual (botão "+") e ConditionSelector não separaram ofertas do mesmo produto de genéricos/similares. Regra #27 do AGENTS.md define `<optgroup>` mas não está funcionando na prática.
    - **Status:** **PENDENTE** — UX improvement.

38. **UX — Dropdown não separa "Mesmo Produto" vs "Genéricos/Similares" (2026-08-18):**
    - **Problema:** Modal de busca manual (botão "+") e ConditionSelector não separaram ofertas do mesmo produto de genéricos/similares. Regra #27 do AGENTS.md define `<optgroup>` mas não está funcionando na prática.
    - **Status:** **PENDENTE** — UX improvedment.

39. **Performance — Tela lenta durante SICF + encomendas simultâneos (2026-08-18/21):**
    - **Problema:** Processar SICF (otimização em lote) e importar encomendas ao mesmo tempo causa lentidão. Muitas chamadas simultâneas à API SmartPed.
    - **Causa raiz:** `/api/encomendas/buscar-ofertas-batch` usava `Promise.all(encomendas.map(...))` — N encomendas = 2N chamadas simultâneas à SmartPed. Zero throttling.
    - **Correção:** Portado padrão `CONCURRENCY=1, BATCH_DELAY_MS=200` (já usado em `/api/optimize`) para o endpoint de encomendas. Agora processa 1 encomenda por vez com 200ms de intervalo.
    - **Arquivo:** `server.ts:311-538`
    - **Status:** RESOLVIDO

40. **Itens imaginários no JSON de envio — Fornecedor externo (codDist=9999) (2026-08-18):**
    - **Problema:** Itens de fornecedor externo (codDist=9999, "Pedido via WhatsApp") são criados com `CodProduto: ""` e `CodProdutoDist: ""` (server.ts:2536-2550). Blindagem 1 pula para `codDist===9999` (server.ts:3138). SmartPed recebe `CodProduto: "0"` e `CodProdutoDist: "0"`.
    - **Additional risk:** `parseInt(it.codDist) || 2` (server.ts:3227) silenciosamente remapeia codDist=0 para distribuidor 2 (Pan/Santa). Blindagem deveria bloquear, mas edge cases existem.
    - **Status:** RESOLVIDO (bug #42) — codDist=9999 bloqueado na Blindagem.

41. **Blindagem bloqueia ruptura legítima (2026-08-18):**
    - **Problema:** `originalCodDistNum === 0` (server.ts:3123) bloqueia substitutos de ruptura cujo original não tinha ofertas (codDist=0). Substituto tem codDist>0 válido mas é barrado porque o original era "Não Encontrados".
    - **Correção:** Blindagem 4 permite ruptura quando `parsedCodDist > 0` (substituto válido) mesmo que `originalCodDistNum === 0` (original sem oferta).
    - **Status:** RESOLVIDO (bug #42)

42. **Mojibake impedia filtro de "Não Encontrados" — dropdown vazio + badge errado (2026-08-18):**
    - **Problema:** Defaults hardcoded tinham `"NÃ£o Encontrados"` (encoding Latin-1/Windows-1252), mas todas as comparações usavam UTF-8 correto (`"não encontrados"`) — nunca casavam. Resultado: badge mostrava `[NÃ£o Encontrados]` e dropdown ficava vazio.
    - **Causa raiz:** Arquivo fonte misturado Latin-1/UTF-8. "NÃ£o Encontrados" são bytes UTF-8 (C3 A3 6F) interpretados como Latin-1.
    - **Correções:**
      1. Helper `isNotFoundName(name)` — detecta UTF-8, mojibake (`nÃ£`), sem acento, "Sem Estoque", "Distribuidor*"
      2. `resolveDistName()` usa `isNotFoundName` → pula nomes inválidos → cai no cache/mapa correto
      3. 5 defaults hardcoded corrigidos de `"NÃ£o Encontrados"` para `"Não Encontrados"`
      4. 6 filtros migrados para `isNotFoundName()` (alternativas SUCESSO/MANTER, allAlternativesForRupture, condicoesEnriched x2, filteredReport)
      5. Blindagem 4 migrou para `isNotFoundName()`
      6. Fallback badge `bestOriginalDist` usa `isNotFoundName()`
    - **Regra:** AGENTS.md #31 — "NUNCA fazer checagem inline, SEMPRE usar `isNotFoundName()`"
    - **Status:** RESOLVIDO

---

## 4.3. Sessão 2026-08-20 — Correções de CodProdutoDist e Filtros de Dropdown

### Contexto
Otimização de lote grandes (~100+ EANs) revelou problemas com `CodProdutoDist` (código do produto dentro da distribuidora). Itens eram escolhidos pelo motor de trocas mas tinham `CodProdutoDist: EMPTY` → faturamento falhava.

### Bugs Corrigidos nesta Sessão

#### 43. RETRY-CODPRODDIST não descartava candidatos inválidos (2026-08-20)
- **Problema:** Quando o motor escolhia um substituto com `CodProdutoDist` vazio, o RETRY tentava até 17 vezes buscar o código via `Condicoes/Ean`, mas **nunca descartava** o candidato. Resultado: item aparecia como "escolhido" mas não podia ser faturado.
- **Causa raiz:** SmartPed API retorna distribuidoras em `Condicoes` de EANs diferentes — o `CodDist` (ex: 81=CervoSul) aparece com o EAN errado na resposta. Quando consulta direto, a distribuidora não tem aquele EAN → `CodProdutoDist`永远 vazio.
- **Evidência:**
  - EAN 7898060139920 (CICLOBENZAPRINA) + CodDist=81 (CervoSul): `Condicoes/Ean` retorna CodDist=624, 59, 503 — NÃO 81
  - CervoSul não tem EAN 7898060139920 no catálogo (confirmado pelo usuário no SmartPed)
  - Retry 17× sem sucesso mas candidato continuava sendo usado
- **Correção (`server.ts:2669-2696`):** Se RETRY falha:
  1. Remove candidato falho da lista
  2. Re-rodar `findBestSubstitute` com candidatos restantes
  3. Novo escolhido com `CodProdutoDist` válido → usa ele
  4. Se nenhum válido → `finalResult = null` (sem troca para este item)
- **Arquivos:** `server.ts:2630` (`let m` em vez de `const m`), `server.ts:2669-2696`
- **Status:** RESOLVIDO

#### 44. Dropdown mostrava opções com CodProdutoDist vazio (2026-08-20)
- **Problema:** ConditionSelector listava alternativas que tinham `CodProdutoDist: EMPTY`. Se o usuário selecionasse uma delas, o faturamento falharia.
- **Causa raiz:** `itemAlternatives` era construído a partir de `condicoesEnriched` + `substitutos` sem verificar se `CodProdutoDist` existia.
- **Evidência:** EAN 7896658048692 tinha 14 alternativas sem código, EAN 7895296449281 tinha 16.
- **Correção (`server.ts:2045-2055` e `server.ts:2576-2586`):** Filtro `.filter(alt => alt.codProdutoDist)` após `.map()` em AMBOS os pontos onde `itemAlternatives` é construído (construção inicial + rebuild pós-TARGET-EAN-API).
- **Arquivos:** `server.ts:2048` (filtro 1), `server.ts:2579` (filtro 2)
- **Status:** RESOLVIDO

### Fluxo de Diagnóstico (reutilizável)
1. Ler log: `$log | Select-String "CodProdutoDist:EMPTY"` → lista itens afetados
2. Para cada item, verificar RETRY: `$log | Select-String "RETRY-CODPRODDIST.*EAN=xxx"`
3. Verificar se RE-RUN descartou: `$log | Select-String "Re-run motor"`
4. Verificar dropdown: `$log | Select-String "semCodProdutoDist"` → itens com alternativas inválidas
5. **Teste direto na API:** Criar script `test-codprodutodist.ts` para chamar `Condicoes/Ean` e verificar quais CodDist retornam para um EAN específico

### Pontos de Verificação ao Alterar
| Função/Ponto | Arquivo:Linhas | O que verifica |
|-------------|---------------|----------------|
| RETRY-CODPRODDIST | `server.ts:2638-2712` | Busca CodProdutoDist via Condicoes/Ean. Se falhar, descarta candidato |
| RE-RUN motor | `server.ts:2671-2696` | Re-rodar findBestSubstitute excluindo candidato falho |
| Filtro itemAlternatives (1) | `server.ts:2048` | Remove opções sem codProdutoDist do dropdown |
| Filtro itemAlternatives (2) | `server.ts:2579` | Remove opções sem codProdutoDist no rebuild |
| findBestSubstitute | `server/swap-engine.ts` | Motor de trocas — escolhe melhor candidato |
| CodProdutoDist mapping | `server.ts:2399` | Extrai CodProdutoDist de Condicoes (RUPTURA-REGEX) |
| ENRICH-CODPRODDIST | `server.ts:2474-2506` | Enriquece codProdutoDist de fontes combinadas |

### Regra Derivada
- **AGENTS.md #28 (atualizar):** "Sempre que o motor escolher um substituto, verificar se `CodProdutoDist` existe. Se vazio após retry, descartar candidato e re-rodar motor."
- **AGENTS.md #29 (novo):** "Dropdown (ConditionSelector) NUNCA deve mostrar alternativas com `codProdutoDist` vazio — filtrar antes de renderizar."

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

# Deploy CORRETO — usa --env-vars-file (NÃO --set-env-vars, que substitui todas as vars)
# cloud-env.yaml contém TODAS as 13 variáveis (inclui NODE_ENV=production → porta 8080)
# build-env.yaml contém variáveis de build (Firebase config) para o Dockerfile

& "$gcloud" run deploy smartped-cli --source . --region us-east1 --project gen-lang-client-0702342051 --env-vars-file cloud-env.yaml --build-env-vars-file build-env.yaml
```

**cloud-env.yaml** (runtime env vars — commitado, mas NÃO o .env):
```yaml
SMARTPED_PRODUCTION_TOKEN: "fddfd9871b77f44f243e145207c8e93a"
SMARTPED_SANDBOX_TOKEN: "79770c03eb119691f0355c5628c496e2"
SMARTPED_DEFAULT_CNPJ: "13408443000168"
SMARTPED_PRODUCTION_URL: "https://api.smartped.com.br"
SMARTPED_SANDBOX_URL: "https://apitest.smartped.com.br"
FERRAMENTINHAS_API_URL: "https://api.ferramentinhas.com.br"
APP_ADMIN_EMAILS: "ckipper22@gmail.com,aga706panambi@gmail.com"
APP_ADMIN_PASSWORD: "Aq1sw2de#fr4"
ENCOMENDAS_API_URL: "https://encomenda-com-smartped-887122622666.us-east1.run.app"
ENCOMENDAS_INTEGRATION_KEY: "enc_sec_9f7a8b3c1d4e2f5061728394a5b6c7d8e9f01234"
TURSO_DATABASE_URL: "libsql://smartped-db-ckipper22.aws-us-east-1.turso.io"
TURSO_AUTH_TOKEN: "eyJhbGciOiJFZERTQSIsInR5cCI6IkpXVCJ9..."
NODE_ENV: "production"
```

**build-env.yaml** (build-time env vars para Dockerfile — NÃO commitar se tiver segredos):
```yaml
FIREBASE_API_KEY: "AIzaSyCS1rsR1TkAxY3VBkJDfXXDSQDRVHALGxs"
FIREBASE_AUTH_DOMAIN: "gen-lang-client-0702342051.firebaseapp.com"
FIREBASE_PROJECT_ID: "gen-lang-client-0702342051"
FIREBASE_STORAGE_BUCKET: "gen-lang-client-0702342051.firebasestorage.app"
FIREBASE_MESSAGING_SENDER_ID: "887122622666"
FIREBASE_APP_ID: "1:887122622666:web:667517613ca87c91015c33"
FIREBASE_MEASUREMENT_ID: ""
FIREBASE_FIRESTORE_DATABASE_ID: "ai-studio-otimizadordepedi-748c6a3d-532e-4702-871a-e8730b62c0d1"
```

### Firebase Config no Cloud Run (Fix 2026-08-20)

**Problema:** O arquivo `firebase-applet-config.json` está no `.gitignore` (não vai pro repo). Durante o build no Cloud Run, o Vite fazia análise estática do `import '../../firebase-applet-config.json'` e falhava porque o arquivo não existia.

**Solução aplicada:**
1. **Dockerfile:** Adicionado step que cria `firebase-applet-config.json` a partir dos build args (`FIREBASE_API_KEY`, etc.) se fornecidos, senão cria um JSON vazio
2. **src/lib/firebaseClient.ts:** Usa `import.meta.glob('../../firebase-applet-config.json', { eager: false })` — importação verdadeiramente dinâmica que escapa da análise estática do Vite
3. **build-env.yaml:** Contém as variáveis Firebase para o build

**Código em `src/lib/firebaseClient.ts`:**
```typescript
const firebaseConfigModules = import.meta.glob<{ default: any }>('../../firebase-applet-config.json', { eager: false });

// ... no initFirebase():
if (typeof window !== 'undefined' && firebaseConfigModules['../../firebase-applet-config.json']) {
  const configModule = await firebaseConfigModules['../../firebase-applet-config.json']();
  firebaseConfig = configModule.default || configModule;
}
```

**Dockerfile relevante (steps 14-16):**
```dockerfile
ARG FIREBASE_API_KEY
ARG FIREBASE_AUTH_DOMAIN
# ... outros args

RUN if [ -n "$FIREBASE_API_KEY" ]; then \
    cat > firebase-applet-config.json <<EOF \
{ "apiKey": "$FIREBASE_API_KEY", ... } \
EOF \
  else \
    echo '{"apiKey":"",...}' > firebase-applet-config.json; \
  fi
```

### Produção (URL fixa)
**URL:** https://smartped-cli-887122622666.us-east1.run.app

**Sistema de Versão:** Formato `vYYYY-MM-DD-HHmm` (fuso Panambi/UTC-3). 
- Gerado automaticamente no build pelo `vite.config.ts` (função `getBuildInfo()`)
- Escrito em `dist/version.txt` via plugin Vite `closeBundle` hook
- Lido pelo `server.ts` em `/api/health` para exibir no header e health check
- **NÃO** usar `process.env.APP_VERSION` no Cloud Run (não confiável com Dockerfile)
- Serve para rastreabilidade em testes local e Cloud

**Versão atual:** `v2026-08-20-1857`

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
| `ENCOMENDAS_API_URL` | URL base do sistema encomendas (ex: `https://encomenda-com-smartped-...`) |
| `ENCOMENDAS_INTEGRATION_KEY` | Chave `x-api-key` para autenticação entre sistemas |

---

## 10. Integração com Sistema de Encomendas (IMPLEMENTADA - 2026-08-17)

### Contexto
Temos **dois sistemas separados** que se integram:

| Sistema | URL | Função |
|---------|-----|--------|
| **Otimizador (este projeto)** | https://smartped-cli-887122622666.us-east1.run.app | Cota preços, otimiza compras, fatura na SmartPed |
| **Encomendas (outro projeto)** | https://encomenda-com-smartped-887122622666.us-east1.run.app | Registra encomendas do balcão (status: Pendente/Encomendado/Recebido) |

### Fluxo de Integração Implementado

```
1. Balcão cadastra encomenda → status "Pendente" (sistema encomendas)
2. Otimizador: Botão "📦 Importar Encomendas" → GET /api/integracao/encomendas/pendentes
3. Para cada encomenda:
   - COM EAN → busca direta Condicoes/Ean + Condicoes/Molecula
   - SEM EAN → Produtos/Buscar por descrição → Condicoes/Ean + Molecula
4. Modal de revisão mostra ofertas encontradas → usuário seleciona/ajusta qtd
5. Confirma → salva como itens manuais (origem="encomenda", id_encomenda) + injeta no lote
6. (Opcional) POST /api/integracao/encomendas/confirmar-pedido para baixar status
```

### Endpoints Implementados (NESTE Projeto - Otimizador)

| Endpoint | Método | Função |
|----------|--------|--------|
| `/api/integracao/encomendas/pendentes` | GET | Proxy → sistema encomendas externo (valida x-api-key) |
| `/api/integracao/encomendas/confirmar-pedido` | POST | Proxy → sistema encomendas externo (valida x-api-key) |

### Especificação da API do Sistema Encomendas (Externo)

**URL Base:** https://encomenda-com-smartped-887122622666.us-east1.run.app

**Autenticação:** `x-api-key: <CHAVE_INTEGRACAO>` (configurada em `ENCOMENDAS_INTEGRATION_KEY`)

**GET /api/integracao/encomendas/pendentes** (sistema encomendas)
- Retorna: array de `{ id, codigoBarras, item, quantidade, status, cliente, telefone, atendente, observacoes, data }`
- Filtro: apenas `status === "Pendente"`

**POST /api/integracao/encomendas/confirmar-pedido** (sistema encomendas)
- Payload: `{ itens: [{ id, fornecedor, dataPrevisao }] }`
- Atualiza: status → "Encomendado", preenche `fornecedor` e `dataPrevisao`

### Frontend: Botão "Importar Encomendas" (📦)

- **Posição:** Flutuante, `bottom-20` (mobile) / `bottom-28` (desktop), acima do botão "+"
- **Fluxo:** Clica → busca pendentes → busca ofertas SmartPed para cada → modal de revisão
- **Modal:** Draggable, redimensionável, mostra logs, permite escolher oferta e qtd por encomenda
- **Confirma:** Injeta itens no relatório ativo + salva em localStorage + Turso (origem="encomenda")

### Itens Manuais - Novos Campos (Tabela `itens_manuais`)

| Campo | Tipo | Descrição |
|-------|------|-----------|
| `origem` | TEXT DEFAULT 'manual' | `'manual'` (botão +) ou `'encomenda'` (importado) |
| `id_encomenda` | TEXT | ID da encomenda no sistema externo (para rastreabilidade) |

### DailyItemsView - Filtro "Apenas Encomendas"

- Na aba "Itens Manuais", checkbox "📦 Apenas Encomendas" filtra para `origem === "encomenda"`
- Tag visual violeta "📦 Encomenda" aparece no nome do produto
- ID da encomenda exibido junto ao EAN

### Variáveis de Ambiente Novas

| Variável | Descrição |
|----------|-----------|
| `ENCOMENDAS_API_URL` | URL base do sistema encomendas (ex: `https://encomenda-com-smartped-...`) |
| `ENCOMENDAS_INTEGRATION_KEY` | Chave `x-api-key` para autenticação entre sistemas |

### Observações Importantes

- O sistema encomendas **já tem** os endpoints necessários implementados
- Proxies HTTP criados no otimizador validam `x-api-key` antes de repassar
- Itens importados são tratados **exatamente como itens manuais** (mesma tabela, mesma UI)
- Tag `origem="encomenda"` permite diferenciar visualmente sem duplicar lógica
- Responsividade mobile: botões flutuantes ajustam posição, modais têm `maxWidth: calc(100vw - 2rem)`

---

## 9. LGPD - Dados Sensíveis

- **CNPJ** circula em: `/api/optimize`, `/api/faturar`, `/api/pedidos-do-dia`, cache L1+L2, SQLite `orders.cnpj`
- **Token SmartPed** circula em: headers de API, cache, `config.ts` via `.env`
- **Mascaramento obrigatório** em logs: `maskCnpj(cnpj)` → `13.408.443/0001-***`
- **Retenção:** Cache tem purga automática (10 min); dados permanentes têm purge de 6 meses (a cada 24h)

---

## 11. Pedidos WhatsApp — Requisitos de Design (Sessão 2026-08-21)

### Visão Geral
Integrar os fluxos WhatsApp (listas de preço + regras por laboratório) ao pré-pedido existente, com nova aba "Pedidos WhatsApp" para rastreabilidade. **Sem código ainda — apenas design.**

### Duas Fontes WhatsApp

| Fonte | Comportamento | Prioridade |
|-------|---------------|------------|
| **Regra de Laboratório** | Filtro por lab + tipo (genéricos/éticos/todos). **SEM preço, SEM comparação.** Vai direto pro WhatsApp | **MÁXIMA** — sobrepõe tudo |
| **Lista de Preço** | Compete com SmartPed e outras listas. Preço calculado via `Preco_SmartPed × (1 - desconto%)` | Normal — entra no motor de trocas |

### Hierarquia de Prioridade
```
1. REGRA DE LABORATÓRIO (prioridade máxima)
   → Sem preço, sem comparação, vai direto pro WhatsApp
   → Filtro: genéricos / éticos / todos (configurável por regra)

2. LISTA DE PREÇO (compete com SmartPed)
   → Preço líquido direto → usa
   → % desconto → Preco_SmartPed × (1 - desconto/100)
   → Sem preço → "Solicitar preço" (aparece no botão +)
   → Item sem CMED/SmartPed → descarta

3. SMARTPED (baseline — sempre competidor)
```

### Cálculo de Preço com % Desconto
- Base: campo `Preco` da SmartPed (extraído por `extractTablePrice()` em `server/parsers.ts:133`)
- Fórmula: `precoLiquido = Preco × (1 - desconto/100)`
- Se `Preco = 0` ou item não encontrado na SmartPed → descarta item

### Classificação de Produto (Genérico/Referência/Similar)
- Sistema descobre pela descrição se é genérico ou não
- Usa `resolveCategoria()` em `server/parsers.ts` como fonte
- SmartPed TipoItem é fallback quando Ferramentinhas não tem o produto

### Itens Sem Preço
- Aparecem no botão "+" indicando "fornecedor trabalha com este item"
- Complemento: "Solicitar preço via WhatsApp"
- Útil para descobrir quais fornecedores trabalham com determinado item

### Tabela `pedidos_whatsapp` (Turso)
| Campo | Tipo | Descrição |
|-------|------|-----------|
| `id` | INTEGER PK | Auto-increment |
| `data_pedido` | TEXT | Timestamp do envio (ISO) |
| `fornecedor` | TEXT | Nome do fornecedor/regra |
| `telefone` | TEXT | Número WhatsApp |
| `itens` | TEXT | JSON com lista de itens |
| `status` | TEXT | Pendente/Confirmado/Recebido/Cancelado |
| `observacao` | TEXT | Nota do comprador |
| `origem` | TEXT | "lista" ou "regra_lab" |
| `cnpj` | TEXT | Farmácia do usuário |

### Nova Aba "Pedidos WhatsApp"
- Aba separada no sistema (junto a Production, Homologation, Daily Items)
- Lista todos os pedidos enviados via WhatsApp
- Mostra: data, fornecedor, quantidade de itens, status
- Permite marcar status (Pendente → Confirmado → Recebido)

### Pontos Pendentes (futuro)
- **Pedido mínimo** — quando tiver essa informação dos fornecedores
- **Automação importação** — importar listas automaticamente de mensagens WhatsApp
- **Concorrência entre fornecedores WhatsApp** — quando múltiplos fornecedores têm o mesmo item

### Fluxo de Decisão (Resumo Visual)
```
Item do SICF/Encomenda
  │
  ├─ Existe regra de laboratório para este lab?
  │   ├─ SIM → Item bate com filtro (genérico/ético/todo)?
  │   │   ├─ SIM → Vai direto pro WhatsApp (sem preço, sem comparação)
  │   │   └─ NÃO → Continua para lista/SmartPed
  │   └─ NÃO → Continua
  │
  ├─ Existe lista de preço com este item?
  │   ├─ SIM (com preço) → Compete com SmartPed no motor de trocas
  │   ├─ SIM (só % desconto) → Calcula: Preco_SmartPed × (1 - desconto%)
  │   └─ SIM (sem preço) → "Solicitar preço" no botão +
  │
  └─ SmartPed (baseline)
      └─ Compete normalmente
```

### Arquivos Impactados (estimativa)
- `server.ts` — Novos endpoints CRUD `/api/pedidos-whatsapp`, `/api/whatsapp-rules` + integração regra lab no optimize
- `server/database.ts` — Tabelas `pedidos_whatsapp`, `whatsapp_rules` + funções CRUD
- `src/types.ts` — Tipos `WhatsAppRule` (expandido com `tipoFiltro`), `WhatsAppOrder`, `WhatsAppOrderItem`
- `src/App.tsx` — Nova aba "Pedidos WhatsApp"
- `src/components/` — Novo componente `WhatsAppOrdersView.tsx`
- `src/components/ConfigurationPanel.tsx` — Regras de lab com filtro tipo
- `src/components/SwapsTable.tsx` — Integração regra lab no pré-pedido

---

## 4.4. Sessão 2026-08-21 — Backend WhatsApp Implementado

### O que foi implementado
1. **Tabelas Turso** (`server/database.ts`):
   - `pedidos_whatsapp` — id, data_pedido, fornecedor, telefone, itens (JSON), status, observacao, origem, cnpj
   - `whatsapp_rules` — id, nome_regra, termo_filtro, nome_representante, telefone, tipo_filtro, ocultar_precos, ativo, cnpj

2. **Funções CRUD** (`server/database.ts`):
   - `savePedidoWhatsApp()`, `getPedidosWhatsApp()`, `updatePedidoWhatsAppStatus()`, `deletePedidoWhatsApp()`
   - `saveWhatsAppRule()`, `getWhatsAppRules()`, `deleteWhatsAppRule()`

3. **Endpoints** (`server.ts`):
   - `POST /api/pedidos-whatsapp` — Salvar pedido WhatsApp
   - `POST /api/pedidos-whatsapp/list` — Listar pedidos por CNPJ
   - `PUT /api/pedidos-whatsapp/:id/status` — Atualizar status (Pendente/Confirmado/Recebido/Cancelado)
   - `DELETE /api/pedidos-whatsapp/:id` — Deletar pedido
   - `POST /api/whatsapp-rules` — Criar regra de laboratório
   - `POST /api/whatsapp-rules/list` — Listar regras ativas
   - `DELETE /api/whatsapp-rules/:id` — Deletar regra

4. **Integração regra lab no optimize** (`server.ts`):
   - No início de `/api/optimize`, carrega regras ativas para o CNPJ
   - Para cada item, verifica se `laboratorio` bate com `termoFiltro` da regra
   - Filtra por `tipoFiltro`: `genericos` (só genéricos), `eticos` (só referência), `todos`
   - Itens匹配ados são marcados com `motivoAcao: "whatsapp_regra_lab"` e vão direto pro report sem consulta SmartPed
   - EANs desses itens são removidos do `eansToQuote` (economiza chamadas API)

5. **Tipos** (`src/types.ts`):
   - `WhatsAppRule` expandido com `tipoFiltro: "genericos" | "eticos" | "todos"`
   - `WhatsAppOrder` e `WhatsAppOrderItem` adicionados
   - Campo `whatsappDestino` (telefone) adicionado ao `SwapReportItem`

### O que falta (próxima sessão)
- **Frontend**: Aba "Pedidos WhatsApp", componente `WhatsAppOrdersView.tsx`
- **Frontend**: ConfigurationPanel para gerenciar regras de lab
- **Frontend**: SwapsTable mostrar badge WhatsApp para itens com `motivoAcao: "whatsapp_regra_lab"`
- **Lista de preço**: Integração compete com SmartPed (injetar itens da lista como alternativas no motor)
- **Automação importação**: Importar listas WhatsApp automaticamente

### Mapeamento de Nomenclatura (Banco ↔ API ↔ Frontend)

**Regra:** Banco usa snake_case, API normaliza para camelCase antes de retornar, frontend usa camelCase.

| Campo no Banco (snake_case) | Endpoint API (camelCase) | Tipo |
|-----------------------------|--------------------------|------|
| `data_pedido` | `dataPedido` | string (ISO) |
| `nome_regra` | `nomeRegra` | string |
| `termo_filtro` | `termoFiltro` | string |
| `nome_representante` | `nomeRepresentante` | string |
| `telefone` | `telefone` | string |
| `tipo_filtro` | `tipoFiltro` | "genericos" \| "eticos" \| "todos" |
| `ocultar_precos` | `ocultarPrecos` | boolean |
| `ativo` | `ativo` | boolean |

**Endpoints de leitura normalizam:** `/api/pedidos-whatsapp/list` e `/api/whatsapp-rules/list` fazem `rows.map(r => ({...}))` convertendo snake_case → camelCase.

**Endpoints de escrita recebem camelCase** do frontend e convertem para snake_case no SQL.

**Dentro do optimize** (`/api/optimize`), as regras vêm direto do banco (snake_case) — o código usa fallback `rule.termo_filtro || rule.termoFiltro` para tolerância.

### Purge
- `pedidos_whatsapp` adicionado ao `purgeOldData()` (6 meses)

## 4.5. Sessão 2026-08-21 — External Suppliers: Migrado para Turso com Validade

### Contexto
Fornecedores WhatsApp (tabelas de preços) estavam salvos apenas em `localStorage` — perdiam-se ao limpar cache ou trocar dispositivo. Agora persistem no Turso com campo de validade.

### O que foi implementado

1. **Tabela Turso `external_suppliers`** (`server/database.ts`):
   - `id` TEXT PK, `name`, `raw_text`, `validade` (YYYY-MM-DD), `products` (JSON), `cnpj`, `created_at`, `updated_at`
   - Index em `cnpj` e `validade`

2. **Funções CRUD** (`server/database.ts`):
   - `saveExternalSupplier()`, `getExternalSuppliers()`, `deleteExternalSupplier()`

3. **Endpoints** (`server.ts`):
   - `POST /api/external-suppliers` — Salvar fornecedor
   - `POST /api/external-suppliers/list` — Listar por CNPJ
   - `DELETE /api/external-suppliers/:id` — Deletar

4. **Frontend migrado** (`useOptimizerConfig.ts`):
   - `externalSuppliers` carrega do Turso via API (não mais localStorage)
   - `handleUpdateExternalSuppliers` salva no Turso a cada alteração
   - `externalSuppliersLoaded` controla o estado de carregamento

5. **Campo validade** (`ConfigurationPanel.tsx`):
   - Input `type="date"` no card de cada fornecedor expandido
   - Badge visual: 🟢 `ATIVA` (com preço + não expirada), 🟡 `EXPIRADA` (validade < hoje), ⚪ `SEM PREÇO` (só itens sem preço)
   - Aviso em texto quando expirada: "Proposta expirada — preços não serão comparados"

6. **Produtos sem preço** (`ExternalProduct.price: number | null`):
   - `price: null` = "fornecedor trabalha com este item, mas não tem preço"
   - Badge visual: `só item` (cinza, itálico)
   - Esses itens **nunca somem** — persistem no Turso para referência futura
   - Campo de preço opcional (placeholder "opcional")

### Regra de Validade
- A validade é **por fornecedor** (cada tabela de preços tem sua data)
- Quando expirada (`validade < hoje`): preços não são comparados no motor de trocas
- Itens sem preço (`price: null`) são mantidos independente da validade
- **Purge automático:** `external_suppliers` incluído no `purgeOldData()` (6 meses)
- **Futuro (chatbot):** chatbot irá popular listas automaticamente com validade diária

### Nomenclatura (Banco ↔ API ↔ Frontend)
- Banco: `raw_text`, `validade`, `products` (snake_case/JSON)
- API: `rawText`, `validade`, `products` (camelCase, JSON parseado)
- Frontend: `rawText`, `validade`, `products` (camelCase, `ExternalSupplier[]`)

---

## 4.6. Sessão 2026-08-21 — Confirmação Automática de Encomendas Pós-Faturamento + Verificação de Payload

### Contexto
1. **Encomendas:** Após faturar um lote que contém itens de encomenda (origem="encomenda"), o status da encomenda no sistema externo não era atualizado para "Encomendado". O endpoint `confirmar-pedido` existia mas não era chamado automaticamente.
2. **Verificação de Payload:** Outro sistema de IA afirmou incorretamente que itens com `"disabled": false` no JSON seriam faturados mesmo se desmarcados na tela. Análise confirmou que o mecanismo correto é `disabledItemCodes` (Set de `codInterno`) no frontend, que filtra ANTES de gerar o JSON.

### O que foi implementado

1. **Backend (`server.ts:4464-4485`):** Após o `saveOrder` pós-faturamento, o código:
   - Filtra itens com `origem === "encomenda"` e `idEncomenda` preenchido
   - Deduplica por `idEncomenda` (cada encomenda = 1 chamada)
   - Chama `POST /api/integracao/encomendas/confirmar-pedido` no sistema externo
   - Payload: `{ itens: [{ id, fornecedor, dataPrevisao }] }`
   - Execução asíncrona (não bloqueia a resposta ao frontend)
   - Erros são logados no console mas não afetam o faturamento

2. **Frontend (`src/App.tsx:861`):** TODO removido, substituído por comentário indicando que a confirmação é feita pelo backend.

### Verificação de Payload (esta sessão)

**Payload analisado:** `faturamento_payload_Todas_as_Distribuidoras (5).json` (31 itens)

**Resultado:**
- ✅ Todos os 31 itens têm `codProdutoDist` e `codProduto` preenchidos
- ✅ Todos os `codDist` estão corretos (2=Pan/Santa, 4=Profarma, 59=ANB, 60=GAM)
- ✅ Todos os preços são > 0
- ✅ Ruptura Rosuvastatina (Pharlab R$ 8,01 via ANB) correta
- ✅ Alerta Benegrip (R$ 301,80 vs ERP R$ 9,95) sinalizado
- ✅ Maracugina PI Noite (encomenda #56) incluída
- ✅ 4 itens problemáticos (Metformina, Aciclovir, Puran T4, Cetoconazol) NÃO estão no payload

**Bug de display identificado:** Alguns itens mostram `economiaUnit: 0` quando preço escolhido > original (ex: CODEX R$ 35,89→43,52). Bug de cálculo frontend, não afeta faturamento.

**Mecanismo de exclusão correto:**
- `disabledItemCodes` (Set) no frontend filtra itens antes de gerar JSON
- Campo `"disabled"` no JSON é irrelevante para o backend
- `useBilling.ts:51` filtra: `activeReport.filter(item => !disabledItemCodes.has(item.codInterno))`

### Fluxo Completo Agora
```
Importar encomendas → Buscar ofertas → Modal de revisão → Confirmar importação
    → Itens injetados no lote (origem="encomenda", idEncomenda)
    → Otimização roda normalmente
    → Faturamento envia à SmartPed
    → Após saveOrder, backend chama confirmar-pedido
    → Sistema externo atualiza status para "Encomendado"
```

### Arquivos Afetados
- `server.ts` — Adicionado bloco de confirmação automática (linhas 4464-4485)
- `src/App.tsx` — TODO removido (linha 861)

### Resultado do Faturamento (esta sessão)
- **Pedido SmartPed #224** — sucesso
- **Protocolo:** SP-2026-0821-9459
- **Valor:** R$ 901,22 | Economia: R$ -292,92 (negativa porque alguns itens foram para distribuidoras mais caras)
- **31 itens** processados e enriquecidos
- **Retorno SmartPed** — HTTP 200

### Notas
- A confirmação é por `idEncomenda` (não por item) — se uma encomenda tem vários itens, todos são confirmados juntos
- Se o sistema externo estiver offline, o erro é logado mas não afeta o faturamento
- `ENCOMENDAS_API_URL` e `ENCOMENDAS_API_KEY` devem estar configurados no `.env`
