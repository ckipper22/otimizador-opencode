# Diretrizes de Operação do Sistema

> **Contexto completo:** ver `memorias/` (projectbrief.md, productContext.md, systemPatterns.md, techContext.md, progress.md)

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

**Se o problema parece novo, verifique esta tabela antes de investigar.**

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

### Motor de trocas
- Prioridade para ofertas reais (CodDist > 0)
- Ruptura: ignora `margemMinima`
- `CodProdutoDist` obrigatório (vem de `Condicoes/Ean`)
- Deduplicação: `${Ean}_${CodDist}_${Condicao}_${Prazo}` (sem preço)

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
- **NUNCA** inventar endpoints — verificar `API_TREE_*.md` primeiro
- **NUNCA** usar `JSON.stringify` para comparar listas (usar `normalizeProducts()`)

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

---

*Sempre se comunique em português.*
*Fuso horário: America/Sao_Paulo (UTC-3) — Panambi, RS.*
