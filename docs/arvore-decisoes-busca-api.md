# Árvore de Decisões — Buscas em APIs Externas

> Documento de referência densa. Cada seção = uma função/fluxo. Árvore de decisão indentada com bullets.
> **NÃO duplicar conteúdo** — em AGENTS.md, só adicionar ponteiros pra cá.

---

## 1. `analisarUmProduto` (server.ts:611–1195)

> Função central de análise de 1 produto. Usada pelo botão "P", background, e batch SICF.
> Retorna: `melhorPrecoSmartPed`, `estoqueTotal`, `estoquePorLaboratorio`, `vendasMensais`, `comprasHistorico`, `smartPedCondicoesTodas`.

### 1a. Vendas (`fetchVendasResumo`)

- SEMPRE chamar `fetchVendasResumo(product.ean)` — busca agregada sem limite de linhas
- Calcular `vendasMensais = totalVendas / mesesDiff`

### 1b. Estoque (Ferramentinhas `similares/{ean}`)

- Chamar `GET /api/produtos/similares/{ean}`
- Buscar `produtoExato` por EAN exato na lista de produtos retornada
- Se `produtoExato`: `estoqueMesmoEan = produtoExato.qtd_estoque`
- Resolver categoria do produto via `resolveCategoria(produtoExato || product)` — **NÃO usar objeto bruto da promoção**
- **Referência (marca):** NÃO buscar similares. `estoqueTotal = estoqueMesmoEan`. `estoquePorLaboratorio` = só o produto exato
- **Genérico/similar:** buscar candidatos via `mesmaApresentacao()` — filtrar por mesma categoria primeiro
  - `cod_dcb` + `cod_concentracao` do `product` (ou fallback `produtosRaw[0]`)
  - `produtoExato` EXCLUÍDO do filtro (já contabilizado em `estoqueMesmoEan`)
  - Somar `qtd_estoque` dos similares → `estoqueTotal`
  - Agrupar por `nom_laborat` → `estoquePorLaboratorio`

### 1c. Histórico de compras (`compras-historico/{ean}`)

- Chamar `GET /api/produtos/compras-historico/{ean}?meses=${CONFIG.HISTORICO_COMPRAS_MESES}` (12 meses)
- Mapear lab de cada compra via `eanToLabMap` (construído a partir de `estoquePorLaboratorio`)
- `ultimaCompra = comprasHistorico[0]` (mais recente)

### 1d. Melhor preço SmartPed — PASSO 1: EAN próprio

- Chamar `POST /api/Condicoes/Ean` com `{ Ean: product.ean, AceitaOntem: 1 }`
- Se retornar condição válida (`preco > 0` E `estoque > 0`): `passo1Sucesso = true`
- Se sucesso: `eansParaBuscar = [product.ean]` (NÃO expandir)
- Se falha: `eansParaBuscar = allEans || [product.ean]` (usar grupo se disponível)

### 1e. PASSO EXTRA (só se PASSO 1 falhou E ≤2 EANs) — server.ts:790–833

- Buscar descrição limpa (remove emojis, genérico, laboratórios conhecidos)
- Extrair primeira palavra significativa (≥3 chars, não-númerica) → `principioAtivo`
- Chamar `POST /api/produtos/buscar-lote` com `{ itens: [principioAtivo] }`
- Para cada resultado, checar dosagem via `mesmaDosagem()` (compara número E unidade, ex: "10mg" ≠ "10mcg")
- Adicionar novos EANs a `eansParaBuscar`

### 1f. Batch final: Condicoes/Ean — server.ts:838–892

- Lotes de até 40 EANs separados por vírgula
- Chamar `POST /api/Condicoes/Ean` com `{ Ean: eanParam, AceitaOntem: 1 }`
- Filtrar: manter só condições com `_sourceEan` pertencente ao `eansDoGrupo` (evita cross-contamination)

### 1g. Complemento: Condicoes/Molecula (via campo Molecula) — server.ts:894–934

- Chamar `POST /api/Condicoes/Molecula` com `{ Molecula: eansParaBuscar[0], ConsideraTipo: 1 }`
- Usa o EAN como parâmetro `Molecula` (a API aceita EAN nesse campo)
- Retorna condições individuais **sem agrupamento mestre**
- Enriquecer `allCondicoes`: adicionar condições com preço+estoque que não existem ainda (dedup por `CodDist + _sourceEan + Condicao`)
- **Sequencial com delay** — mesma razão do batch Ean (API contamina tabela temporária)

### 1h. Enriquecimento QtdMin via Molecula — server.ts:948–983

- Loop sequencial por EAN em `eansParaBuscar` (com delay de 500ms entre chamadas)
- Chamar `POST /api/Condicoes/Molecula` com `{ Ean: ean, ConsideraTipo: 1 }`
- Extrair `QtdMin` de cada condição retornada → popular em `eanMetadata[key]`
- Pra cada condição em `allCondicoes`: se `QtdMin` ausente/zero, preencher de `eanMetadata`
- **Sequencial com delay** — API contamina em paralelo (já documentado em AGENTS.md)

### 1i. Preço de promoção com desconto percentual — server.ts:1097–1121

Quando o fornecedor externo (WhatsApp) manda só percentual de desconto (sem preço absoluto), o backend calcula `product.preco` a partir do melhor preço SmartPed:

- Se `product.preco` vazio/zero E `discountPercent > 0` E `melhorPrecoSmartPed` existe:
  `preco = melhorPrecoSmartPed * (1 - discountPercent/100)`
  → `precoCalculadoViaDesconto = true`
- Senão se `product.preco` vazio/zero E `discountTiers` existe E `melhorPrecoSmartPed` existe:
  `preco = melhorPrecoSmartPed * (1 - menorTier.discountPercent/100)`
  → `precoCalculadoViaDesconto = true`

O flag `precoCalculadoViaDesconto` sinaliza pro frontend que o preço já embute desconto — **QUALQUER lugar que reaplique desconto/tier em cima de `oferta.preco` precisa checar esse flag**, senão duplica desconto. Regra: quando `precoCalculadoViaDesconto = true`, os preços de TODAS as faixas (inclusive a menor) devem ser calculados a partir de `melhorPrecoSmartPed`, não de `oferta.preco`.

### 1j. Retorno

- `allCondicoes` (já filtradas e enriquecidas) → melhor preço por distribuidora
- `estoqueTotal`, `estoquePorLaboratorio`, `vendasMensais`, `comprasHistorico`
- `smartPedCondicoesTodas` inclui `qtdMin` e `condicao` pra cada condição (exibido na tabela "Todas as condições SmartPed" no modal)
- `naoEncontradoEmNenhumSistema: true` quando `estoqueTotal === 0` E `melhorPrecoSmartPed === null` E `comprasHistorico.length === 0` — badge amarelo no card/modal

---

## 2. `analisarFornecedorEmBackground` (server.ts:1197–~1700)

> Processa fornecedores externos (WhatsApp/Parâmetros) em background.
> Para cada produto: descobre EANs do grupo, filtra, e chama `analisarUmProduto`.

### 2a. Validação e setup

- Carregar fornecedor do Turso via `getExternalSuppliers(cnpj)`
- Parse de `supplier.products` (JSON array)
- Se `productsToAnalyze` fornecido: modo INCREMENTAL (só produtos mudados)
- `CONCURRENCY = 2` (throttle proposital — API Ferramentinhas sobrecarrega)

### 2b. Busca de EANs para produtos sem código de barras — server.ts:1232–1303

- Para cada produto sem `ean`: extrair princípio ativo (remove emojis, genérico, laboratórios)
- Batch de até 20 termos → `POST /api/produtos/buscar-lote` com `{ itens: batch }`
- Para cada resultado: filtrar por dosagem (`dosageFilter`) antes de aceitar
- Se encontrou produto com `qtd_estoque > 0`: atribuir `ean` ao produto

### 2c. PASSO 1: Descobrir EANs do grupo — server.ts:1314–1433

#### Fonte primária: `similares/{ean}`

- Chamar `GET /api/produtos/similares/{product.ean}`
- Retorna lista de produtos do catálogo local (já filtrados por estoque/atividade)

#### Fallback: `buscar-lote` por texto (só se similares retornou vazio ou sem DCB)

- Limpar descrição (remover emojis, genérico, laboratórios, formas farmacêuticas)
- Chamar `POST /api/produtos/buscar-lote` com `{ itens: [descCompleta] }`
- Se vazio: fallback wildcards com `%` (ex: `"ACIDO%FOLICO"`)
- Para cada resultado: adicionar a `allProdutos`

#### Filtrar por DCB + dosagem — server.ts:1399–1432

> **Exceção Referência/marca (corrigido em 2026-08-31):** antes de entrar no agrupamento por DCB, resolver categoria via `resolveCategoria(produtoExatoDCB || product)`. Se `categoria === "marca"`: PULAR agrupamento, setar `eansGrupo = [EAN próprio]` e `eanList = [product.ean]` direto. Mesma regra de `analisarUmProduto` (referência nunca busca similares), replicada aqui porque é um mecanismo paralelo/duplicado.

- Filtrar por `cod_dcb === dcb` + dosagem via `mesmaDosagem()` (compara número E unidade)
- Se DCB não encontrado: filtrar só por dosagem
- Resultado: `eansGrupo` (produtos do mesmo DCB+dosagem) → `eanList` (EANs únicos)

### 2d. PASSO 1.5: Wildcards SmartPed (`Produtos/Buscar`) — server.ts:1436–~1465

> **Nota:** essa lógica NÃO está em `analisarUmProduto` — está aqui porque precisa de `product.description`
> pra gerar wildcards, e `analisarUmProduto` recebe o objeto enriquecido (não o bruto do WhatsApp).

- Gerar wildcards via `getWildcardQueries(product.description)` (server/parsers.ts:322)
- Iterar TODOS os wildcards gerados (sem `.slice()`), com early-break: parar assim que pelo menos 1 EAN válido for encontrado
- Para cada wildcard:
  - Chamar `POST /api/Produtos/Buscar` com `{ Texto: wildcard }`
  - **FILTRAR por dosagem** via `mesmaDosagem()` antes de aceitar candidato
  - Adicionar EANs válidos a `smartPedOnlyEans` e `eanList`
- `smartPedOnlyEans` = EANs extras da SmartPed: **só pra pricing, NÃO pra vendas/estoque**

### 2e. REF-FILTER (erpEans) — server.ts:1490–1516

- `erpEans` = EANs de `eansGrupo` que NÃO estão em `smartPedOnlyEans`
- Fallback: se `eansGrupo` vazio, usar `allProdutos` direto
- Filtrar: excluir EANs de referência/ético de OUTROS produtos (categoria `"marca"`)
- **Exceção:** próprio EAN do produto sempre fica (mesmo que seja marca)

### 2f. REF-FILTER-EAN (eanList) — server.ts:1517–1550

- `eanList` = EANs completos (ERP + SmartPed) — usado por `analisarUmProduto`
- Filtrar:
  - Excluir referências de outros produtos (`cat === "marca"`)
  - Excluir candidatos com `unidadeApresentacao` diferente (ex: 30cp vs 60cp)
  - **Exceção:** próprio EAN do produto sempre fica

### 2g. `eanListFiltrado` pra vendas/compras — server.ts:1580–1591

- Filtrar `erpEans` por `mesmaApresentacao(product, pProd)` — só EANs com mesma apresentação
- Usar pra `fetchVendasResumoBatch` e compras agregadas
- **Não confundir** com `eanList` (pricing) — `eanListFiltrado` é só vendas/estoque

### 2h. Chamada final — server.ts:1556

- `analisarUmProduto(product, cnpj, eanList)` — segue árvore 1
- `eanList` já pré-expandido por tudo acima (DCB + wildcards SmartPed)
- `analisarUmProduto` recebe `allEans = eanList` e usa como `eansParaBuscar` no PASSO 1

### 2i. Enriquecimento pós-análise — server.ts:1558–~1700

- Agregar vendas de `eanListFiltrado` (Ferramentinhas, com filtro `mesmaApresentacao`)
- Agregar compras de todos os EANs do ERP (janela: 12 meses via `CONFIG.HISTORICO_COMPRAS_MESES`)
- Calcular `vendasAgregadas` e `comprasAgregadas` (separados do retorno de `analisarUmProduto`)

---

## 3. `/api/ofertas-dia/buscar-produto` (server.ts:1961)

> Botão "P" — busca produto por texto. Dois caminhos: SmartPed (texto puro) ou Ferramentinhas (EAN).

### Se query NÃO é numérica (texto)

- Chamar `POST /api/Produtos/Buscar` com `{ Texto: query }` (SmartPed)
- Para cada resultado com `CodDist > 0`: coletar `distsMap`, `minimos`
- Para cada item retornado: extrair `condicoes` → mapear para `foundItems[]`

### Se query É numérica (EAN)

- `POST /api/Condicoes/Ean` + `POST /api/Condicoes/Molecula` em `Promise.all`
  - Exceto se `onlyExactEan` (só Ean) ou `skipMolecula`
- Processar retorno Ean: conditions → `foundItems[]` com preço/tipo/estoque
- Processar retorno Molecula: substitutos → `foundItems[]`
- Mapear distribuidoras do payload

### Fallback (SmartPed retornou 0 items)

- Chamar `GET /api/produtos/buscar-por-ean/{query}` (Ferramentinhas)
- Se encontrou produto: chamar `GET /api/produtos/buscar-lote` com `{ itens: [limpo] }`
- Para cada resultado: coletar DCB, `analisarUmProduto(product)` pra ter preço SmartPed
- Merge com `foundItems[]`

---

## 4. `/api/ofertas-dia/analisar-referencia` (server.ts:2157)

> Análise detalhada de 1 produto específico (quando usuário clica pra ver detalhes).

- Chamar `GET /api/produtos/buscar-por-ean/{ean}` (Ferramentinhas) → `produto`
- Enriquecer `product` com campos do catálogo: `cod_dcb`, `cod_concentracao`, `grupo`, `unidadeApresentacao`, `description`
- Chamar `analisarUmProduto(product)` — segue árvore 1
- Retornar: `estoquePorLaboratorio`, `melhorPrecoSmartPed`, `comprasHistorico`, `smartPedCondicoesTodas`

---

## 5. Busca manual (Botão "+") — `normalizeSearchQuery` (server.ts:7792)

> Busca de texto via `POST /api/buscar-smartped`.

### Normalização

1. Remover stopwords ("com", "de", "para", etc.)
2. Extrair quantidade standalone (ex: "60" do final) — NÃO extrair se EAN puro (8+ dígitos)
3. Normalizar abreviações: CP→CPR, CAPS→CAPS, UND→UND, REV→REV, TABS→TABS
4. Juntar com espaços

### Routing

- **Query numérica (EAN):** `Condicoes/Ean` + `Condicoes/Molecula` em paralelo
  - `Condicoes/Ean` com `{ Ean: query, AceitaOntem: 1 }`
  - `Condicoes/Molecula` com `{ Ean: query, ConsideraTipo: 1 }` (exceto `onlyExactEan`/`skipMolecula`)
- **Query texto:** `POST /api/Produtos/Buscar` com `{ Texto: normalizedQuery }`
  - Se 0 resultados: fallback `getRelaxedQuery()` (remove dosagem/quantidade, mantém só nome)
  - Filtro pós-busca: `matchesQuantity(descricao, quantity)` — checar padrões "60CPR", "60 CPR", etc.

### Outros parâmetros

- `simulationMode`: simula sem API real
- `permitirSemEstoque`: inclui itens com estoque 0
- `tipos`: filtro por tipo (default ["G", "O"])

---

## 6. `/api/optimize` — FASE-3: Condicoes SmartPed (server.ts:~3440)

> Batch de precificação do SICF. Processa TODOS os EANs do pedido.

### Pré-cache (L1+L2)

- Checar cache Turso para todos os EANs (`getFromCacheBatch`)
- EANs com cache → `eansComCache`, sem cache → `eansSemCache`
- Cache hit vai direto pra `apiResponses[ean]`

### Batch API (só EANs sem cache)

- Lotes de 10 EANs (não 40 — diferent do PASSO 1 de `analisarUmProduto`)
- `POST /api/Condicoes/Molecula` + `POST /api/Condicoes/Ean` em `Promise.all`
  - `Condicoes/Molecula`: `{ Ean: batch.join(","), ConsideraTipo: 1 }`
  - `Condicoes/Ean`: `{ Ean: batch.join(","), AceitaOntem: 1 }`
- **Concorrência = 1, delay entre lotes** (rate limit SmartPed — NÃO alterar sem autorização)
- Merge itens Molecula + Ean → `apiResponses[ean]`
- Salvar em cache L1+L2

### Resultado

- Cada EAN tem `ItemPedido` + `Substitutos[]` + `Condicoes[]`
- Usado pelo motor de trocas (FASE-4) pra decidir substitutos

---

## 7. `/api/optimize` — ALERTA Fallback (server.ts:~3880)

> Quando um item SICF NÃO tem ofertas com estoque na FASE-3.

### Trigger

- `originalHasOffersWithStock === false` (nenhuma condição do ItemPedido ou Substitutos tem preço+estoque)

### Fluxo (paralelo, em `fallbackPromises`)

1. Descobrir DCB: `GET /api/produtos/similares/{ean}` → pegar `cod_dcb` do primeiro produto
2. Se DCB não descoberto: fallback `getMoleculeBase(descricao)` ou `cleanDescription(descricao)`
3. Checar se é "genérico completo" (todas as palavras são de bloqueio) → NÃO buscar nesse caso
4. Chamar em paralelo:
   - `POST /api/Condicoes/Molecula` com DCB (se não for genérico completo)
   - `POST /api/Condicoes/Molecula` com "molécula extra" (base molecular alternativa, se diferente do DCB)
   - `POST /api/Produtos/Buscar` com descrição+dosagem (se disponível)
5. Incorporar resultados: `incorporateRetornoItens()` → merge em `apiResponses[ean]`
6. Adicionar EANs novos ao `marketSimilarMap` (marcados com `_origem: "smartped"` — NÃO usar pra vendas/estoque)

---

## 8. `fetchSimilarGenericsBatch` (server/smartped-api.ts:105)

> Batch de similares da Ferramentinhas. Chamado uma vez no FASE-2 de `/api/optimize`.

- Lotes de 40 EANs
- `POST /api/produtos/similares/batch` com `{ eans: lote }`
- `Promise.all` nos lotes (paralelo)
- Retorna `Record<ean, produto[]>` — lista de produtos similares no catálogo da farmácia
- Cada produto tem: `ean`, `nom_produto`, `cod_dcb`, `cod_concentracao`, `nom_laborat`, `qtd_estoque`, `grupo`, `unidade_apresentacao`, `nom_obsvenda`

---

## 9. `fetchSimilarGenerics` (server/smartped-api.ts:81)

> Busca individual de similares (1 EAN por vez).

- `GET /api/produtos/similares/{ean}`
- Retorna `produto[]` — auto-inclusivo (retorna o próprio EAN entre os candidatos)
- Usado em contextos onde batch não é necessário (ex: botão P individual, fallback)

---

## 10. `/api/smartped-find-substitutes` (server.ts:8692)

> Endpoint pra buscar substitutos de um EAN específico (usado pelo frontend).

- Recebe `{ ean, texto?, token?, cnpj? }`
- Se `ean`: chamar `Condicoes/Ean` + `Condicoes/Molecula` em paralelo
- Se `texto`: chamar `Produtos/Buscar`
- Retornar substitutos encontrados com preço/estoque

---

## 11. `/api/encomendas/buscar-ofertas-batch` (server.ts)

> Busca ofertas pra itens de encomendas (lote).

- **Concorrência = 1** (throttle proposital — mesma razão do FASE-3)
- Para cada EAN: chamar `analisarUmProduto` ou equivalente
- Segue árvore 1

---

## Regra de consistência entre fluxos

> **NÃO misturar lógica de matching entre fluxos diferentes.**

| Fluxo | Fonte estoque | Fonte preço | Matching |
|-------|---------------|-------------|----------|
| Ofertas do Dia (2-4) | Ferramentinhas `similares/{ean}` | SmartPed `Condicoes/Ean` + `Molecula` | `mesmaApresentacao()` pra agrupar, EAN exato pra referência |
| SICF/Otimização (6-7) | SmartPed `Condicoes` (tem campo `Estoque`) | SmartPed `Condicoes` | DCB+dosagem pra wildcards, EAN exato pra batch |
| Busca manual (5) | SmartPed (retorna estoque por condição) | SmartPed | Texto normalizado + filtro pós-busca |
| Ferramentinhas (8-9) | Ferramentinhas `similares` | N/A (só estoque) | EAN exato (auto-inclusivo) |

---

## Referência cruzada

- **AGENTS.md** → "Dois fluxos de matching independentes" (seção ~linha 89): regra geral
- **AGENTS.md** → "Mecanismos de Equivalência": 3 mecanismos de agrupamento
- **AGENTS.md** → "Ofertas do Dia — propósito e funcionalidade": contexto do card/modal
- **API_TREE_SMARTPED.md** (arquivado): detalhes de cada endpoint SmartPed
- **API_TREE_TRIER.md** (arquivado): detalhes de cada endpoint Ferramentinhas
