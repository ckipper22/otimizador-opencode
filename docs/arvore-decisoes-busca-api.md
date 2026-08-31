# Árvore de Decisões — Buscas em APIs Externas

> Documento de referência densa. Cada seção = uma função/fluxo. Árvore de decisão indentada com bullets.
> **NÃO duplicar conteúdo** — em AGENTS.md, só adicionar ponteiros pra cá.

---

## 1. `analisarUmProduto` (server.ts:611)

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

- Chamar `GET /api/produtos/compras-historico/{ean}`
- Mapear lab de cada compra via `eanToLabMap` (construído a partir de `estoquePorLaboratorio`)
- `ultimaCompra = comprasHistorico[0]` (mais recente)

### 1d. Melhor preço SmartPed — 2 passos

#### PASSO 1: EAN próprio

- Chamar `POST /api/Condicoes/Ean` com `{ Ean: product.ean, AceitaOntem: 1 }`
- Se retornar condição válida (`preco > 0` E `estoque > 0`): `passo1Sucesso = true`
- Se sucesso: `eansParaBuscar = [product.ean]` (NÃO expandir)
- Se falha: `eansParaBuscar = allEans || [product.ean]` (usar grupo se disponível)

#### PASSO EXTRA (só se PASSO 1 falhou E ≤2 EANs)

- Buscar descrição limpa (remove emojis, genérico, laboratórios conhecidos)
- Extrair primeira palavra significativa (≥3 chars, não-númerica) → `principioAtivo`
- Chamar `POST /api/produtos/buscar-lote` com `{ itens: [principioAtivo] }`
- Para cada resultado, checar dosagem (`origDosage2`) — manter só candidatos com mesma dosagem (regex `/(\d+)\s*(mg|mcg|g|ml|ui|%)/i`)
- Adicionar novos EANs a `eansParaBuscar`

#### PASSO 1.5: Wildcards (só se PASSO 1 falhou)

- Gerar wildcards via `getWildcardQueries(product.description)` (server/parsers.ts:322)
- **FILTRAR por dosagem extraída da descrição** (`origDosage`) antes de aceitar candidato (evita cross-contamination, ex: MUCOSOLVAN AD 30MG vs PED 15MG)
- Chamar `POST /api/Produtos/Buscar` com `{ Texto: wildcard }` para cada wildcard
- Para cada resultado: checar dosagem antes de adicionar a `eansParaBuscar`

#### Batch final: Condicoes/Ean

- Lotes de até 40 EANs separados por vírgula
- Chamar `POST /api/Condicoes/Ean` com `{ Ean: eanParam, AceitaOntem: 1 }`
- Filtrar: manter só condições com `_sourceEan` pertencente ao `eansDoGrupo` (evita cross-contamination)
- **NÃO chamar `Condicoes/Molecula`** — `QtdMin` vem do `Ean` aqui (não do Molecula como no SICF)

---

## 2. `analisarFornecedorEmBackground` (server.ts:~1173)

> Processa fornecedores externos (WhatsApp/Parâmetros) em background.

- Para cada fornecedor: verificar `validade` do fornecedor
- Para cada produto do fornecedor: verificar `validade` individual (override do fornecedor)
- Enriquecer objeto bruto com dados do catálogo Ferramentinhas (`produtosRaw.find(ean === product.ean)`)
- Chamar `analisarUmProduto(product)` — segue árvore 1

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
