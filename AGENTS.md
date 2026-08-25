# Diretrizes Gerais de Operação do Sistema

> **ANTES DE QUALQUER COISA: Leia a seção "CEGUEIRA ANTIGA" abaixo. São bugs já resolvidos que se repetem quando não consultados.**

---

## CEGUEIRA ANTIGA — BUGS JÁ RESOLVIDOS, NÃO TENTAR CORRIGIR NOVAMENTE

| # | Bug | Causa Raiz | Correção Já Aplicada | Onde Verificar |
|---|-----|-----------|----------------------|----------------|
| 1 | **Deploy apaga variáveis de ambiente** | `--set-env-vars` SUBSTITUI todas as variáveis | Usar `--env-vars-file cloud-env.yaml` com TODAS as 12 variáveis | `cloud-env.yaml`, LLM_CONTEXT.md #34 |
| 2 | **Servidor sobe na porta 3000 em vez de 8080 no Cloud Run** | Cloud Run não seta `NODE_ENV=production` | `cloud-env.yaml` deve conter `NODE_ENV: "production"` | `server/config.ts:16` |
| 3 | **Encomendas retornam "Sem ofertas"** | Batch endpoint fazia `push(...items)` em vez de `push(...item.Condicoes[])` | Extrair `Condicoes[]` e `Substitutos[]` de dentro de cada `item` | `server.ts` batch endpoint ~linhas 327-397 |
| 4 | **`Condicoes/Ean` sozinho retorna QtdMin=0** | QtdMin vem do `Condicoes/Molecula` | Chamar AMBOS em `Promise.all` sempre | AGENTS.md #12, regra obrigatória |
| 5 | **Cache morre a cada restart do Cloud Run** | Cache L1 (Map) é perdido | Cache L2 (Turso) persiste. Nunca assumir "em memória" | AGENTS.md #13 |
| 6 | **PMC não aparece / aparece errado** | Case-sensitivity SmartPed (`PMC`/`pmc`/`Pmc`) | Usar fallback: `offer.PMC \|\| offer.pmc` | AGENTS.md #28, server.ts extractPmc |
| 7 | **`Condicoes/Ean` exige `AceitaOntem: 1`** | Sem ele, promoções do dia anterior são omitidas | Sempre incluir `AceitaOntem: 1` | AGENTS.md #12 |
| 8 | **Desconto duplo em fornecedor externo** | `analisarUmProduto` usava `Pliquido` (já com desconto dist.) como base | Usar `Preco` (tabela/PFAB) como base. `Pliquido` = desconto duplo | AGENTS.md #43, server.ts `analisarUmProduto()` |
| 8 | **Deduplicação por preço (ERRADO)** | Chave deve ser `${Ean}_${CodDist}_${Condicao}_${Prazo}` SEM preço | Manter menor preço líquido | AGENTS.md #16, #20 |
| 9 | **`better-sqlite3` causa SIGSEGV no Cloud Run** | gVisor não suporta mmaps | Usar Turso em produção, better-sqlite3 só local | AGENTS.md #15 |
| 10 | **Campo `dists[]` da SmartPed ignorado** | `NomeDist` não vem no objeto `Condicoes[]` individual | Extrair de `Retorno.dists[]` via match por `CodDist` | API_TREE_SMARTPED.md #123, #253 |
| 11 | **Itens manuais perdidos** | Salvos só em localStorage | Persistir em localStorage + Turso | AGENTS.md #21 |
| 12 | **Encomendas "Não autorizado"** | Deploy substituiu variáveis de integração | Usar `--env-vars-file` com TODAS as variáveis | LLM_CONTEXT.md #34 |
| 13 | **Encomendas preço R$ 0.00** | Backend retorna PascalCase (NomeDist, Pliquido), frontend espera lowercase (distribuidora, precoLiquido) | Normalizar campos antes de retornar no batch endpoint | server.ts batch endpoint, App.tsx linhas 3165-3206 |
| 14 | **REGRESSÃO: "Não Encontrados" como substituto** | Motor de trocas volta a permitir ofertas não-reais | Verificar `findBestSubstitute` em `swap-engine.ts` — `return false` para `!isRealOffer` | LLM_CONTEXT.md #35 |
| 15 | **REGRESSÃO: CodDist em vez de NomeDist** | `resolveDistName()` ou mapeamento `dists[]` não aplicado nos endpoints | Verificar extração de `Retorno.dists[]` via `CodDist` match | LLM_CONTEXT.md #36 |
| 16 | **Ruptura falso (mesmo EAN como substituto)** | `parseSmartPedEstoque` retorna 0 incorreto OU motor reinjeta mesmo-EAN | Verificar parsing de estoque + filtro de substitutos | LLM_CONTEXT.md #37 |
| 17 | **Itens imaginários no JSON de envio** | Fornecedor externo (codDist=9999) tem `CodProduto: ""` → SmartPed recebe "0" | Revisar Blindagem 1 para codDist=9999 + `parseInt(codDist)\|\|2` edge case | LLM_CONTEXT.md #40 |
| 18 | **Blindagem bloqueia ruptura legítima** | `originalCodDist===0` bloqueia substitutos válidos (codDist>0) | Permitir ruptura quando `parsedCodDist > 0` mesmo com `originalCodDistNum === 0` | LLM_CONTEXT.md #41 |
| 19 | **Mojibake impedia filtro de "Não Encontrados"** | Defaults hardcoded tinham `"NÃ£o Encontrados"` (encoding Latin-1), comparações usavam UTF-8 (`"não encontrados"`) — nunca casavam | Usar `isNotFoundName()` (helper centralizado) em TODAS as checagens. **NUNCA** fazer `dist.includes("NÃO ENCONTRADOS")` inline | server.ts `isNotFoundName()`, LLM_CONTEXT.md #42 |
| 20 | **INSERT OR REPLACE apagava análise de ofertas** | `saveExternalSupplier` usava `INSERT OR REPLACE` — colunas `dados_analise`, `status_analise`, `analyzed_at` viravam NULL a cada save do frontend | `INSERT ... ON CONFLICT(id) DO UPDATE SET ...` preserva colunas de análise | `server/database.ts:776`, LLM_CONTEXT.md #44 |
| 21 | **Filtro validade em UTC (Cloud Run)** | `new Date().toLocaleDateString('sv-SE')` retornava data UTC — fornecedor com validade "hoje" (UTC-3) era filtrado como expirado | Offset `-3h`: `new Date(Date.now() - 3*60*60*1000)` | `server.ts:897`, `server.ts:4287`, LLM_CONTEXT.md #45 |
| 22 | **Firebase Auth "Cannot read properties of null"** | `auth` e `googleProvider` exportados como `null` — `initFirebase()` async, módulos importam antes de terminar | Usar `getFirebaseAuth()` (async) que aguarda inicialização. **NUNCA** importar `auth`/`googleProvider` direto de `firebaseClient.ts` | `src/lib/firebaseClient.ts`, `src/hooks/useAuth.ts` |
| 23 | **SmartPed "visão em túnel" — Promoções do Dia** | `analisarUmProduto` buscava SmartPed com 1 EAN — perdia ofertas de outros labs (Teuto, Germed, etc.) | Expandir EANs via `buscar-lote` (DCB) ANTES de analisar, passar `allEans` para `analisarUmProduto`. Buscar `Condicoes/Ean` para CADA EAN do grupo | `server.ts` `analisarFornecedorEmBackground` ~linha 797, `analisarUmProduto` |
| 24 | **Tier regex não detectava emojis (💥)** | Character class `[•\-*\s]` não incluía emojis Unicode | Usar ranges Unicode específicos (`\u{1F300}-\u{1FAFF}`) NÃO `\p{Emoji}` (que inclui dígitos) | `ConfigurationPanel.tsx:171` |
| 25 | **Mojibake em termos de busca causava HTTP 500** | `\udca5Alendronato` (corrupção do 💥) não era limpo antes de enviar à API | Limpar `\udca5\|\udca4\|\udca6\|\ufffd` antes de enviar | `server.ts` `analisarFornecedorEmBackground` |
| 26 | **Buscar-lote sem "mg" não acha produto** | `ILIKE %ALLENDRONATO 70%` não casa com `ALLENDRONATO SOD 70MG` (SOD no meio) | Buscar por princípio ativo (primeira palavra) + filtrar dosagem no JS | `server.ts` `analisarFornecedorEmBackground` |
| 27 | **Cross-contamination: preço de outro produto aparece no card** | `Condicoes/Ean` batch retorna condições de EANs de OUTROS produtos na mesma resposta. Filtrar por `_sourceEan ∈ eansDoGrupo` | Filtro `eansDoGrupo` (Set normalizado) em `analisarUmProduto`. **NUNCA** chamar `Condicoes/Ean` sem esse filtro | `server.ts:721-731` |
| 28 | **SMARTDISTRIBUIDORA (CodDist=624) retorna estoque fantasma** | API retorna `Estoque: 1` mas SmartPed UI mostra bolinha vermelha (sem estoque real). Probabilidade ~50% de faturar com erro | Ao faturar, logar aviso quando `distName === "SMARTDISTRIBUIDORA"` e `estoque === 1`. Considerar SMARTDISTRIBUIDORA como low-trust | `server.ts` faturamento |
| 29 | **Card estoque "0 cx" mas detail mostra "3 cx" (CETOCONAZOL SH)** | `estoqueMesmoEan` filtrava por EAN exato (0cx), `estoqueTotal` somava labs (3cx). Cada lab tem EAN diferente para SH | Card usa `estoqueTotal`. Backend: filtro apresentação em `analisarUmProduto` (SH≠CR via `_PRES_GRUPOS`). Fallback `estoqueGrupo`→`analysis.estoqueTotal` | `OfertasDoDiaModal.tsx:520,883`, `EanPromoButton.tsx:260,482`, `server.ts:543-571`, `server.ts:1224-1228` |
| 30 | **Vendas "2/mês" em vez de "1/mês"** | Background aggregation buscava vendas de 16 EANs (SmartPed wildcards) sem filtro de apresentação. `eansGrupo` vazio quando produto sem EAN inicial | Filtro apresentação no bloco vendas: `eanToDesc` de `allProdutos` (buscar-lote). EANs sem descrição excluídos. Padrão SICF | `server.ts:1198-1240` |
| 31 | **Divisor hardcoded vendas (/4)** | `vendasAgregadas = Math.round(total / 4)` — sempre dividia por 4 independente do período real | Calcular `mesesDiff` das datas reais (primeiraData/ultimaData). Padrão SICF `server.ts:3611` | `server.ts:1270-1273` (background), `server.ts:1773-1774` (analisar-referencia) |

**SE O PROBLEMA PARECE NOVO, VERIFIQUE ESTA TABELA ANTES DE INVESTIGAR.**
Se estiver aqui, a correção já existe. Não reinvente a roda.

---

Ao atuar neste projeto, opere sob os seguintes pilares inegociáveis:

1. **CONSULTA OBRIGATÓRIA (FONTE DA VERDADE):** Antes de propor, escrever ou alterar qualquer linha de código, consulte o arquivo de contexto principal do projeto (`LLM_CONTEXT.md`). Respeite estritamente a arquitetura definida, a stack tecnológica, os pontos sensíveis e as restrições arquiteturais listadas nele.
2. **ANÁLISE DE IMPACTO E ANTI-REGRESSÃO:** Ao propor uma solução, pense passo a passo. Explique brevemente quais arquivos, componentes e lógicas globais serão impactados. Sua prioridade zero é garantir que a nova implementação não causará regressão (quebra) em funcionalidades que já existem e funcionam.
3. **ATUALIZAÇÃO CONTÍNUA DO "CÉREBRO" DO PROJETO:** Sempre que você criar um novo domínio de dados, alterar uma regra de negócio central ou modificar estruturas críticas (como interfaces globais, schemas de banco ou rotas), você é OBRIGADO a editar e atualizar diretamente o arquivo de contexto do projeto (`LLM_CONTEXT.md`). Mantenha a documentação da IA sempre sincronizada com a realidade do código. Não imprima o texto de atualização no chat, faça a edição diretamente no arquivo.
4. **PRESERVAÇÃO DE DADOS E RETROCOMPATIBILIDADE (BACKWARD COMPATIBILITY):** Assuma sempre que o sistema já possui dados reais de usuários em produção.
    * É EXPRESSAMENTE PROIBIDO alterar a estrutura de tabelas/coleções raiz de forma destrutiva.
    * Não crie rotinas de exclusão em massa ou migrações forçadas de dados antigos a menos que explicitamente solicitado pelo humano.
    * Ao adicionar novas propriedades aos modelos de dados, schemas ou tipagens, elas devem ser OBRIGATORIAMENTE opcionais (ex: uso do `?` em TypeScript ou equivalentes) para garantir que os registros do passado continuem sendo lidos e renderizados perfeitamente sem quebrar a aplicação.
5. **ECONOMIA EXTREMA DE TOKENS:** Priorize máxima concisão. Elimine loops, chamadas redundantes e lógica inchada. Tanto no consumo da aplicação quanto nos custos de desenvolvimento.
6. **PROIBIDO ALUCINAR:** Nunca invente dados, tabelas, colunas, bibliotecas, parâmetros, EANs ou substâncias. Na dúvida exata, pare e pergunte imediatamente.
7. **SIMULAÇÃO DE ESPECIALISTAS VIRTUAIS:** Antes de responder, simule criticamente um Arquiteto/SysOps (infra), um QA Cético (caça falhas) e um Especialista em Custo (tokens e recursos). Nunca concorde automaticamente; aponte prós, contras e o próximo gargalo gerado.
8. **DIVISÃO CIRÚRGICA:** Divida tarefas em etapas microscópicas. Execute uma por vez, pare e aguarde obrigatoriamente o 'OK' do desenvolvedor.
9. **BUSCA CIRÚRGICA E VALIDAÇÃO:** Faça buscas cirúrgicas e validações diretas no ambiente. Antes de fechar qualquer correção, busque pontos correlacionados via grep para evitar soluções isoladas que quebrem o sistema.
10. **VELOCIDADE, SEGURANÇA E COMPATIBILIDADE:** Se preocupe com velocidade, segurança, redundância, economia de tokens, compatibilidade cross-device, facilidade para o usuário, código mal formatado e facilidade de parametrização.
11. **DEBUG PROATIVO POR COMPARAÇÃO DE CAMINHOS:** Quando um fluxo funciona (ex: busca por EAN) e outro não (ex: busca por descrição), **compare os dois caminhos de código lado a lado** antes de culpar APIs externas ou instabilidade. A causa raiz quase sempre é uma diferença no código: parâmetro faltando (`AceitaOntem`), endpoint ausente (`Condicoes/Molecula`), campo errado (`Descricao` vs `Texto`). **Nunca assuma que é "instabilidade da API" sem antes comparar os caminhos que funcionam vs os que não funcionam.** O padrão de debug deve ser: (1) identificar o caminho que funciona, (2) identificar o que não funciona, (3) diff linha por linha, (4) aplicar a correção no caminho quebrado. Documente a causa raiz em `API_TREE_SMARTPED.md` e `LLM_CONTEXT.md` para que o erro nunca mais se repita.
12. **PADRÃO OBRIGATÓRIO: AMBOS OS ENDPOINTS SMARTPED EM PARALELO:** Qualquer código que busque condições comerciais por EAN **DEVE chamar `Condicoes/Ean` E `Condicoes/Molecula` em `Promise.all`**. O `QtdMin` vem principalmente do `Molecula`. Chamar apenas `Condicoes/Ean` resulta em QtdMin=0. Além disso, `Condicoes/Ean` exige `AceitaOntem: 1`. Este padrão está implementado em `/api/search-products` e `/api/smartped-find-substitutes`.
13. **CACHE L1+L2 - NUNCA ASSUMIR QUE É "EM MEMÓRIA":** O cache de API SmartPed possui duas camadas: L1 (Map em memória, 2000 entradas) e L2 (Turso/SQLite persistente). Ao ler cache, sempre consultar L1 primeiro; se miss, consultar L2. Ao escrever, sempre escrever em ambos. Nunca assumir que o cache "morreu" apenas porque o servidor reiniciou — o L2 persiste os dados.
14. **TURSO EM PRODUÇÃO:** O banco de produção usa Turso (libSQL na nuvem) via `@tursodatabase/serverless`. As variáveis `TURSO_DATABASE_URL` e `TURSO_AUTH_TOKEN` devem estar configuradas no Cloud Run. Em dev local, fallback para `better-sqlite3` se Turso não estiver configurado.
15. **CLOUD RUN - TURSO RESOLVE SIGSEGV:** O `better-sqlite3` causava SIGSEGV no Cloud Run (gVisor). Resolvido com migração para Turso. **NUNCA** remova as variáveis `TURSO_DATABASE_URL`/`TURSO_AUTH_TOKEN` do Cloud Run.
16. **DEDUPLICAÇÃO POR CHAVE COMERCIAL:** Ao deduplicar ofertas da SmartPed, use a chave `${Ean}_${CodDist}_${Condicao}_${Prazo}` (sem preço). Manter a oferta de menor preço líquido em caso de duplicata. Isso se aplica a `/api/search-products` e `/api/smartped-find-substitutes`.
17. **ORDENAÇÃO POR PREÇO LÍQUIDO:** Os resultados de busca devem ser ordenados por `precoLiquido` ascendente. A função `resolvePrecoLiquido` em `src/utils.ts` deve reconhecer os campos `Pliquido`, `pliquido`, `PliquidoUni`, `pliquidoUni`, `precoLiquido`, `Preco`, `preco`, `precoOriginal`.
18. **DADOS PESSOAIS - MASCARAMENTO BÁSICO:** Projeto de uso pessoal/interno (não sujeito a LGPD completa). Apenas mascarar CNPJ e token em logs por boa prática (ex: `13.408.443/0001-***`). Nunca logar credenciais em texto claro.
19. **TESTE DE BUSCA ANTES DE COMMIT:** Antes de commitar qualquer alteração em `server.ts` (especialmente na rota `/api/search-products` ou `/api/smartped-find-substitutes`), execute o teste de busca local:
    - Busque por "HIDROCLOROTIAZIDA" e verifique: (1) sem ofertas duplicadas, (2) ordenado por preço líquido crescente, (3) QtdMin aparece nas promoções.
    - Busque por um EAN numérico e verifique o mesmo.
    - Se qualquer teste falhar, NÃO commite — corrija primeiro.
20. **DEDUPLICAÇÃO É REGRA DE NEGÓCIO, NÃO DETALHE:** A deduplicação de ofertas da SmartPed é uma regra de negócio crítica. A chave correta é `${Ean}_${CodDist}_${Condicao}_${Prazo}` (SEM preço). Qualquer alteração nessa chave deve ser validada com testes reais antes de commitar. Ver seção 4.12.3 do LLM_CONTEXT.md para contexto do bug histórico.
21. **ITENS MANUAIS - PERSISTÊNCIA DUPLA:** Itens adicionados manualmente via botão "+" devem ser salvos em localStorage (acesso imediato) E no Turso (persistência permanente). Nunca confiar apenas em localStorage — dados se perdem ao trocar de navegador ou limpar cache.
22. **ITENS CONFIRMADOS - CACHE TURSO + API:** O endpoint `/api/itens-confirmados-do-dia` deve consultar Turso primeiro (histórico) e depois API SmartPed (tempo real). Combinar resultados evitando duplicatas. Salvar no Turso apenas itens com Status === 3 (faturados).
23. **PURGE AUTOMÁTICA 6 MESES:** Dados permanentes (`orders`, `order_items`, `faturados`, `itens_confirmados`, `itens_manuais`) têm purge automática após 6 meses. Nunca confiar em crescimento infinito do banco.
24. **DEPLOY APENAS COM AUTORIZAÇÃO:** Nunca fazer deploy sem confirmação explícita do usuário. Sempre perguntar antes de executar `gcloud run deploy`.

25. **PARADA OBRIGATÓRIA ANTES DE COMANDOS DESTRUTIVOS/IRREVERSÍVEIS:** Antes de executar qualquer comando que altere estado de produção ou seja irreversível (`gcloud run deploy`, `git push --force`, `DELETE`/`DROP` no banco, migrações destrutivas, `npm publish`, etc.), **SEMPRE** confirmar explicitamente com o usuário. Não assumir que "build passou = pode deployar". Aguardar "sim, deploy agora" ou equivalente.

26. **PROIBIDO MATAR/INICIAR SERVIDOR LOCAL:** É **OBRIGAÇÃO DO USUÁRIO** iniciar e finalizar o servidor de desenvolvimento (`npm run dev`, `node`, etc.). O agente **NUNCA** deve executar `Stop-Process`, `kill`, `Get-Process | Stop-Process`, `npm run dev`, `npm run start` ou qualquer comando que mate ou inicie processos node. O agente pode ler logs de arquivos e sugerir comandos ao usuário, mas NUNCA executá-los. Exceção: o agente PODE matar processos APENAS se o usuário pedir explicitamente.

27. **CLASSIFICAÇÃO DE PRODUTOS — FONTE ÚNICA: FERRAMENTINHAS `grupo`:** A classificação do produto vem do campo `grupo` retornado pelo endpoint `/api/produtos/similares/{ean}` da Ferramentinhas. **NÃO usar** TipoItem da SmartPed como fonte primária (às vezes vem vazio ou incorreto). Valores do campo `grupo`:
    - **"Genérico"** → Busca subs (só genéricos). Ruptura → pode similar, NÃO referência.
    - **"Similar"** → Sem subs. Ruptura → qualquer coisa com estoque.
    - **"Referência"** → Sem subs. Ruptura → qualquer coisa com estoque.
    - **"Perfumaria"** / **"Correlatos"** → **Nunca buscar subs.**
    - **Sem grupo / vazio** → Tratar como "Referência" (fallback seguro).
    - SmartPed TipoItem é **fallback** quando Ferramentinhas não tem o produto. Valores SmartPed: `"G"=Genérico`, `"M"=Marca/Ref`, `"S"=Similar`, `"O"=Outros`, `"P"=Perfumaria`.
    - **REGEX complementar SEMPRE:** `Condicoes/Molecula` como base + `Produtos/Buscar` (RUPTURA-REGEX) como complemento para achar produtos que o Molecula não trouxe. Merge + deduplicação.

26. **COMPORTAMENTO POR TIPO + STATUS:**

    | Tipo | Com Estoque | Ruptura |
    |------|-------------|---------|
    | Genérico | Só genéricos como sub | REGEX + similar OK. NÃO referência |
    | Referência | Nada | Qualquer coisa com estoque |
    | Similar | Nada | Qualquer coisa com estoque |
    | Perfumaria | Nada | Nada |
    | Sem classificação | Nada | Qualquer coisa com estoque |

27. **ALINHAMENTO FRONTEND/BACKEND — OBRIGATÓRIO:** Sempre que alterar backend (`server.ts`, `server/*.ts`), verificar se o frontend (`App.tsx`, componentes) usa os mesmos campos/nomes. E vice-versa. Se o backend retornar campo novo, o frontend precisa ler. Se o frontend esperar campo que o backend não retorna, o preço vira R$ 0.00.

28. **NOMENCLATURA PADRONIZADA — NÃO PERDER NOMES:**
    - Backend: `distribuidora`, `codDist`, `precoLiquido`, `preco`, `estoque`, `condicao`, `prazo`, `ean`, `descricao`, `laboratorio` (tudo lowercase)
    - SmartPed API: `NomeDist`, `CodDist`, `Pliquido`, `Preco`, `Estoque`, `Condicao`, `Prazo`, `Ean`, `Descricao` (PascalCase)
    - Ferramentinhas: `nom_produto`, `nom_laborat`, `vlr_custopersonalizado`, `vlr_venda_final`, `qtd_estoque`, `cod_dcb`, `grupo`, `classificacao`
    - **NUNCA misturar.** O backend normaliza de PascalCase (SmartPed) pra lowercase antes de retornar ao frontend.
    - **BANCO → API → FRONTEND:** Banco Turso usa snake_case (`data_pedido`, `nome_regra`, `preco_liquido`). **TODOS os endpoints de leitura** devem normalizar com `rows.map(r => ({...}))` convertendo snake_case → camelCase antes de `res.json()`. **NUNCA** retornar linhas cruas do banco. Exemplo:
      ```typescript
      const rows = await getItensManuais(cnpj);
      const itens = rows.map((r: any) => ({
        codInterno: r.cod_interno,
        precoLiquido: r.preco_liquido,
        dataAdicao: r.data_adicao,
        // ...todos os campos
      }));
      res.json({ itens });
      ```
    - **Exceção:** Endpoints internos (otimização, blockedSuppliers) que usam dados do banco apenas em memória e não retornam ao frontend.
28. **PESQUISA EXTERNA ANTES DE DEBUGAR:** Quando um bug não tem causa óbvia no código (ex: funciona local mas não no Cloud), SEMPRE pesquisar em fonts externas (GitHub issues, StackOverflow, docs oficiais da plataforma, forums) antes de propor soluções. Evitar "inventar" soluções sem evidência externa. Registrar descobertas em `LLM_CONTEXT.md` (seção 4.21 ou similar).

29. **MODAL ENCOMENDAS — PADRÃO IGUAL AO MODAL "+" (ADIÇÃO MANUAL):** O modal de importar encomendas deve seguir exatamente o padrão do modal de adição manual (botão "+"):
    - Tabela horizontal: Checkbox | Produto&EAN | Cliente/Hora | Observação | Oferta(Dropdown) | Qtd
    - Dropdown com `<optgroup>`: 📦 Mesmo Produto | 🔄 Genéricos/Similares
    - Busca SEM filtro `tipos` (encomendas não filtram por [G,O])
    - Botões "Adicionar" individuais REMOVIDOS → fluxo: checkbox + qtd + "Importar Selecionados" (um clique)
    - Estado persistente: linha amarela + botão verde "Adicionado" (não some após timeout)
    - `alternatives` preenchido na criação → evita busca tempo real no ConditionSelector/ObservationBell
    - **`alternatives` leva TODAS as ofertas** (não apenas a selecionada) → ConditionSelector no pré-pedido permite trocar fornecedor/condição
    - Proteção: ConditionSelector e ObservationBell pulam itens `origem="encomenda" || "manual"`

30. **PMC — APENAS SE API RETORNA, SEM FALLBACK:** PMC (Preço Máximo ao Consumidor) só aparece se a SmartPed retornar o campo. **NUNCA** calcular fallback `preco * 1.4`. Backend (`server.ts` `/api/search-products`) não calcula PMC — repassa `PMC` direto do JSON SmartPed. Frontend (`App.tsx`) normaliza `offer.PMC || offer.pmc` (case-sensitivity). Visual: fonte 11px bold, texto rosa, fundo rosa transparente (`bg-pink-100/60`). Campo `originalPmc`/`novoPmc` nas linhas do relatório vem do `useOptimizationResult.activeReport` via spread `...item`.
31. **CASE-SENSITIVITY SMARTPED:** A API SmartPed retorna campos com maiúsculas/minúsculas inconsistentes (`PMC`/`pmc`, `Pmc`, `VlrPmc`). Sempre usar fallback: `field || field_lowercase || field_PascalCase`. Verificar em: `/api/search-products` (backend), `App.tsx` (frontend), `useManualSearch.ts` (normalização).
32. **CONTRATO DE CAMPOS: BACKEND → FRONTEND:** O backend normaliza os campos da SmartPed antes de retornar ao frontend. **Campos obrigatórios no retorno de qualquer endpoint de busca:**
    - `distribuidora` (não `NomeDist`), `codDist` (não `CodDist`)
    - `precoLiquido` (não `Pliquido`), `preco` (não `Preco`)
    - `estoque` (não `Estoque`), `condicao` (não `Condicao`), `prazo` (não `Prazo`)
    - `ean` (não `Ean`), `descricao`, `laboratorio`
    - Frontend (App.tsx, ConditionSelector, SwapsTable) SEMPRE usa lowercase. Se o backend retornar PascalCase, o preço aparece R$ 0.00.
33. **VALIDAÇÃO DE NOMES DE DISTRIBUIDORA — SEMPRE USAR `isNotFoundName()`:** Nunca fazer checagem inline como `dist.includes("NÃO ENCONTRADOS")` ou `dist.startsWith("DISTRIBUIDOR")`. SEMPRE usar o helper `isNotFoundName(name)` (server.ts, linha ~68) que trata automaticamente: UTF-8, mojibake (`nÃ£`), sem acento, "Sem Estoque" e "Distribuidor*". O mojibake ocorre porque o arquivo fonte pode ter encoding Latin-1 misturado com UTF-8.

34. **MEMORY BANK — AUTO-ATUALIZAÇÃO OBRIGATÓRIA:** Sempre que o usuário digitar o gatilho EXATO `[SAVE]`, o agente tem a OBRIGAÇÃO ABSOLUTA de interromper a análise e invocar imediatamente a ferramenta `write` ou `edit` para resumir e atualizar o arquivo `memoryBank/activeContext.md`. É EXPRESSAMENTE PROIBIDO gerar a frase de confirmação "Estado salvo com sucesso" ANTES que o log do sistema confirme que a gravação física no HD foi concluída. Ler `memoryBank/` no início de cada sessão para retomar contexto.

33. **PROIBIDO MATAR OU INICIAR PROCESSOS `npm run dev` / `node`:** É OBRIGAÇÃO DO USUÁRIO iniciar e finalizar o servidor de desenvolvimento. O agente NUNCA deve executar `Stop-Process`, `kill`, `Get-Process | Stop-Process`, `npm run dev`, `npm run start` ou qualquer comando que mate ou inicie processos node. O agente pode ler logs de arquivos e sugerir comandos ao usuário, mas NUNCA executá-los. Exceção: o agente PODE matar processos APENAS se o usuário pedir explicitamente.

34. **LOGS EM ARQUIVO PARA DEBUG:** Quando o usuário pedir para ver logs da otimização, o agente deve configurar gravação de logs em arquivo (ex: `debug-logs/optimize-*.log`) via `fs.appendFileSync` no endpoint relevante. Assim o agente pode ler o arquivo com a ferramenta `Read` sem precisar acessar o terminal do usuário.

35. **CODPRODDIST OBRIGATÓRIO PARA FATURAMENTO:** Sempre que o motor escolher um substituto, verificar se `CodProdutoDist` existe. Se vazio após retry, descartar candidato e re-rodar motor com candidatos restantes (`server.ts:2669-2696`). O `CodProdutoDist` vem EXCLUSIVAMENTE do endpoint `Condicoes/Ean` — `Condicoes/Molecula` NÃO retorna esse campo.

36. **DROPDOWN NÃO MOSTRA ITENS SEM CODPRODDIST:** O ConditionSelector (dropdown de alternativas) NUNCA deve mostrar alternativas com `codProdutoDist` vazio — filtrar antes de renderizar (`server.ts:2048`, `server.ts:2579`). Itens sem código falhariam no faturamento.

37. **VERSIONAMENTO DE DEPLOY — DATA/HORA FUSO PANAMBI (UTC-3):** A versão do deploy **SEMPRE** segue o formato `vYYYY-MM-DD-HHmm` no fuso horário de Panambi/RS (UTC-3).
    - Gerado automaticamente no build pelo `vite.config.ts` (função `getBuildInfo()`)
    - Escrito em `dist/version.txt` via plugin Vite `closeBundle` hook
    - Lido pelo `server.ts` em `/api/health` para exibir no header e health check
    - **NÃO** usar `process.env.APP_VERSION` no Cloud Run (não confiável com Dockerfile)
    - Serve para rastreabilidade em testes local e Cloud

38. **ENCOMENDAS — CONFIRMAÇÃO AUTOMÁTICA PÓS-FATURAMENTO:** Quando itens com `origem="encomenda"` são faturados, o backend automaticamente chama `POST /api/integracao/encomendas/confirmar-pedido` no sistema externo para atualizar o status para "Encomendado". Fluxo: faturamento → saveOrder → filtra itens `origem="encomenda"` com `idEncomenda` → deduplica por `idEncomenda` → chama `confirmar-pedido`. Execução asíncrona (não bloqueia resposta). Erros são logados mas não afetam faturamento. **Arquivo:** `server.ts:4464-4485`.

39. **ITENS DE LISTA_PRECO — NÃO FATURAR NA SMARTPED:** Itens com `origem: "lista_preco"` ou `motivoAcao: "lista_preco"` representam fornecedores externos (ex: Forster) que NÃO estão conectados à SmartPed. O botão correto é "Copiar Pedido (WhatsApp)", NÃO "Faturar Este Pedido". O check `isExternalManual` em `SwapsTable.tsx:1206` controla isso: `group.items.some(it => it.codDist === 9999 || it.origem === "lista_preco" || it.motivoAcao === "lista_preco")`. Quando `isExternalManual = true`, o grupo fica verde e mostra botão WhatsApp.

40. **BUSCAR-LOTE — BODY `{itens:[...]}` NÃO `{termos:[...]}`:** O endpoint `/api/produtos/buscar-lote` da Ferramentinhas espera body `{"itens": ["TERM1", "TERM2"]}`. A resposta é um dict `{ "resultados": { "termo": [produtos] } }`. **NUNCA** usar `{ termos: [...] }` — a API retorna erro silencioso ou vazio. Referência: `main.py` (Ferramentinhas API), `server.ts:657`.

41. **TERMOS DE BUSCA LIMPOS ANTES DE ENVIAR:** Ao usar `buscar-lote`, remover termos que atrapalham a busca: "GENÉRICO", "GENERICO", nomes de marca/genérico (Sandoz, Novartis, EMS, Medley, etc.). Enviar só a substância + dosagem. Ex: "ATENOLOL 25MG GENÉRICO SANDOZ" → enviar "ATENOLOL 25MG". **Arquivo:** `server.ts:~657` (função de limpeza antes do POST).

42. **DOCUMENTAÇÃO — ATUALIZAÇÃO OBRIGATÓRIA EM AMBOS:** Sempre que o usuário pedir para "atualizar documentação" ou "atualizar docs", o agente é OBRIGADO a atualizar **TANTO** `LLM_CONTEXT.md` **QUANTO** `AGENTS.md`. O `LLM_CONTEXT.md` é o "cérebro" (contexto técnico, arquitetura, sessões). O `AGENTS.md` é o "protocolo" (regras permanentes, bugs resolvidos, dependências). Nunca atualizar um sem o outro. A exceção é quando a mudança é puramente técnica (ex: bug fix sem nova regra de negócio) — aí basta `LLM_CONTEXT.md` + tabela de bugs resolvidos. **ALÉM DISSO**, SEMPRE salvar um resumo na `supermemory` (mode: add, type: project-config) para persistir entre sessões.

43. **PFAB vs PLIQUIDO — PREÇO DE TABELA PARA CÁLCULO DE DESCONTO:** Para medicamentos regulados (Referência/Ético), a SmartPed retorna `PFAB`/`Preco` (preço de fábrica/tabela CMED) e `Pliquido` (preço líquido JÁ COM desconto da distribuidora). Ao calcular preço efetivo com desconto de fornecedor externo, **SEMPRE** usar `Preco` (tabela) como base, **NUNCA** `Pliquido`. Fórmula correta: `precoEfetivo = Preco × (1 - desconto/100)`. Usar `Pliquido` causa desconto duplo (desconto da dist. + desconto do fornecedor). Para perfumaria/cosméticos, `Preco` pode vir zerado — usar `Pliquido` como fallback. **Arquivo:** `server.ts` `analisarUmProduto()` (linha ~566).

44. **PRICE TIERS (QUANTITY BREAKS) — Promoções WhatsApp:** Promoções podem ter preço por faixa (ex: "70und R$2.29, 140und R$2.19"). Parser em `ConfigurationPanel.tsx` detecta padrões `NNund X,XX`, `NN+ X,XX`. Backend calcula `bestTierPrice` (menor tier) para auto-descarte. Frontend mostra banner "PRECO CONDICIONAL" + tabela faixas. `tiers` é opcional em `ExternalProduct` e `SwapReportItem`. **Arquivos:** `ConfigurationPanel.tsx` (parser), `server.ts` (analisarUmProduto), `OfertasDoDiaModal.tsx` (card+detail), `SwapsTable.tsx` (badge).

45. **SMARTPED MULTI-EAN — NUNCA BUSCAR SÓ COM 1 EAN:** Ao analisar promoções, SEMPRE expandir EANs via `buscar-lote` (princípio ativo + filtro dosagem) ANTES de chamar SmartPed. Passar `allEans` para `analisarUmProduto`. SmartPed busca `Condicoes/Ean` para CADA EAN (batches de 10). **Arquivo:** `server.ts` `analisarFornecedorEmBackground` (linha ~801), `analisarUmProduto` (parâmetro `allEans`).

46. **MOJIBAKE EM TERMOS DE BUSCA:** SmartPed pode retornar `\udca5` (corrupção de 💥) em descrições. SEMPRE limpar `\udca5|\udca4|\udca6|\ufffd` antes de enviar termos à API. **Arquivo:** `server.ts` `analisarFornecedorEmBackground`.

47. **BUSCAR-LOTE — PRINCÍPIO ATIVO NÃO FULL DESCRIPTION:** O `buscar-lote` da Ferramentinhas usa `ILIKE %termo%`. Buscar com descrição completa falha porque "ALLENDRONATO SOD 70MG" tem "SOD" entre "ALLENDRONATO" e "70MG". **SEMPRE** buscar com princípio ativo (primeira palavra) + filtrar dosagem no JS. **Arquivo:** `server.ts` `analisarFornecedorEmBackground`.

48. **ANALYSIS CACHE — LIMPAR QUANDO PRODUCTS MUDAM:** POST `/api/external-suppliers` compara oldProducts vs newProducts. Se diferentes → `updateSupplierAnalysis(id, null, "pendente")` para forçar re-análise. **Arquivo:** `server.ts` POST `/api/external-suppliers` (linha ~397).

49. **SMARTPED BATCH EAN — FILTRO DE CROSS-CONTAMINAÇÃO OBRIGATÓRIO:** A API SmartPed `Condicoes/Ean` aceita múltiplos EANs separados por vírgula (lotes de até 40). Porém, retorna condições de EANs de OUTROS produtos que estão na mesma resposta (substitutos). **SEMPRE** aplicar filtro `eansDoGrupo` (Set normalizado com zeros à esquerda removidos) em `_sourceEan` antes de usar as condições. **Arquivo:** `server.ts:721-731`. Ver LLM_CONTEXT.md #4.22 para detalhes completos.

50. **SMARTPED BATCH EAN — QUANDO USAR vs NÃO USAR:**
    - **USAR batch quando:** `analisarUmProduto` (Promoções do Dia),RUPTURA-REGEX (busca por descrição), Qualquer fluxo com >1 EAN do mesmo grupo DCB
    - **NÃO usar batch quando:** `/api/search-products` (single EAN endpoint), busca por EAN específico no botão "+"
    - **Motivo:** Batch retorna condições de TODOS os EANs do grupo + substitutos → precisa de cross-contamination filter. Single EAN não tem esse problema.
    - **Max batch:** 40 EANs por chamada (`Condicoes/Ean`). `Condicoes/Molecula` aceita batch similar mas **SEMPRE** chamar ambos em `Promise.all`.

51. **SMARTPED BATCH — SMARTDISTRIBUIDORA LOW-TRUST:** SMARTDISTRIBUIDORA (CodDist=624) frequentemente retorna `Estoque: 1` mas o SmartPed UI mostra bolinha vermelha (sem estoque real). Ao mostrar SMARTDISTRIBUIDORA no card ou dropdown, considerar como "low-trust" — preferir distribuidora com estoque confirmado quando disponível.

52. **LEITURA OBRIGATÓRIA DE DOCUMENTAÇÃO ANTES DE CODAR:** Ao iniciar QUALQUER tarefa que envolva integração com APIs (SmartPed, Ferramentinhas, Trier, Encomendas, Reval, etc.), **LER OBRIGATORIAMENTE**:
    - `API_TREE_SMARTPED.md` (se for usar endpoints SmartPed)
    - `API_TREE_TRIER.md` (se for usar endpoints Ferramentinhas/Trier)
    - `docs/external-suppliers-plan.md` (se for usar fornecedores externos)
    - `docs/encomendas-integration.md` (se for usar encomendas)
    - `LLM_CONTEXT.md` seção relevante
    **NUNCA** começar a codar sem ler a documentação da API que será usada. A informação pode estar lá mas não será usada se não for lida antes.

53. **USAR ENDPOINTS DOCUMENTADOS, NÃO INVENTAR:** Antes de implementar uma chamada a uma API, VERIFICAR se o endpoint já está documentado em `API_TREE_*.md`. Se estiver, usar exatamente os parâmetros e formato documentados. Se não estiver, perguntar ao usuário antes de inventar um endpoint.

54. **CÁLCULO DE VENDAS — MÉTODO ÚNICO EM TODOS OS FLUXOS:** O cálculo de vendas mensais DEVE seguir o mesmo método em TODOS os pontos do sistema:
    - **API:** Usar `vendas-detalhadas/{ean}` (NÃO `vendas-semanais`)
    - **Filtro:** Apenas últimos **4 meses**
    - **Cálculo:** Somar vendas de TODOS os EANs do grupo → dividir por 4 meses → arredondar
    - **NÃO calcular por-EAN e depois somar** (infla o resultado)
    - **Fluxos vinculados (ANDAM JUNTOS):**
      1. `analisar-referencia` (P button / lupa) — `server.ts` linha ~1638
      2. `analisarFornecedorEmBackground` (Promoções do Dia) — `server.ts` linha ~1170
      3. Batch SICF (optimize) — `server.ts` linha ~3477
    - **Ao alterar QUALQUER um, verificar os outros dois.** Documentar em `AGENTS.md #54` e `LLM_CONTEXT.md #4.24`

55. **EXPANSÃO DE EANs — FILTRO DE APRESENTAÇÃO OBRIGATÓRIO:** Ao expandir EANs via `buscar-lote` ou `marketSimilarMap`, FILTRAR por apresentação farmacêutica antes de adicionar:
    - **Grupos:** `["SH", "SHAMPOO"]`, `["CR", "CREME"]`, `["DERM"]`, `["GEL"]`, etc.
    - Se o original é SH (shampoo), NÃO adicionar CR (creme) ao grupo
    - Aplicar em: batch SICF (linha ~2497), RUPTURA-REGEX (linha ~4151), `analisarFornecedorEmBackground` (linha ~967)
    - **Ao alterar, verificar os 3 pontos.**

56. **REPROCESSAMENTO DE LISTAS — COMPARAÇÃO NORMALIZADA:** O endpoint `POST /api/external-suppliers` compara `products` via JSON stringify. Usar `normalizeProducts()` para ordenar por description+price ANTES de comparar, evitando falsos positivos por reordenação de campos. **NÃO usar `JSON.stringify` direto.**

---

## DEPENDÊNCIAS CRUZADAS — AO MUDAR UM PONTO, VERIFIQUE OS OUTROS

> **REGRA:** Quando alterar qualquer função/regra abaixo, verifique TODOS os pontos listados na coluna "Impacta". Falhar nisso causa bugs silenciosos.

| # | Função/Regra | Arquivo | Impacta (verificar ao alterar) |
|---|-------------|---------|-------------------------------|
| 1 | `resolveCategoria()` | `server/parsers.ts` | `server.ts` mappedSimilares (linha ~1734), mappedSimilares fallback (linha ~2340), ` TipoItem` no swap-engine |
| 2 | `resolveDistName()` | `server.ts:75` | Todas as linhas que usam `distribuidora` no relatório, `DISTRIBUIDORAS_DYNAMIC_CACHE`, `DISTRIBUIDORAS_MAP` |
| 3 | `fetchSimilarGenericsBatch()` | `server/smartped-api.ts` | `server.ts` optimize flow (linha ~830), fallback ruptura (linha ~2330) |
| 4 | `codProdutoDist` mapping | `server.ts` (alternatives linha ~1665, ~1719, faturamento linha ~3323) | Blindagem 1 (linha ~3233), payload SmartPed (linha ~3324) |
| 5 | ` TipoItem` classification | `server/parsers.ts` + `AGENTS.md #27` | `server.ts` isGeneric (linha ~1911), `tiposAceitos` (linha ~754), `RUPTURA-REGEX` check (linha ~2053), swap-engine filtros |
| 6 | `isNotFoundName()` | `server.ts:68` | TODAS as filtragens de distribuidora, `resolveDistName`, `allAlternativesForRupture`, blindagem |
| 7 | `disabledDistSet` | `server.ts:750` | batch encomendas, optimize flow (linha ~1777, ~1795, ~2268), `todasCondicoesOriginal` (linha ~2404) |
| 8 | `cleanCodProduto()` | `server/parsers.ts` | `server.ts` todas as linhas que setam `codProduto` (linhas ~2302, ~2456, ~2720, ~2886, etc.) |
| 9 | `validateSwapEquivalence()` | `swap-validation.ts` | `server.ts` filtered substitutos (linha ~1775), `allAlternativesForRupture` filter, `finalAlternatives` |
| 10 | `parseSmartPedEstoque()` | `server/parsers.ts` | `server.ts` `originalHasStock` (linha ~1934), `findBestSubstitute`, filtros de estoque |
| 11 | `isExternalManual` | `SwapsTable.tsx:1206` | Grupo verde/WhatsApp, botão "Copiar Pedido", esconde "Faturar", badge "📋 Lista:" |
| 12 | **Cálculo de vendas (últimos 4 meses)** | `server.ts` vendas-detalhadas | `server.ts` `analisar-referencia` (~1700), `analisarFornecedorEmBackground` (~1170), batch SICF (~3477). **ANDAM JUNTOS — alterar um, verificar os outros dois.** |

**COMO USAR:** Antes de alterar qualquer função, busque no código por todos os pontos listados na coluna "Impacta" e verifique se a alteração é compatível.

*Sempre se comunique em português.*

*Fuso horário do usuário: America/Sao_Paulo (UTC-3) — Panambi, RS. Sempre que mencionar horários, usar esse fuso.*
