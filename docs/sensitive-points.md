# Pontos Sensíveis, Débitos Técnicos e Ambiente

## 5. Estado Atual, Débitos Técnicos e Pontos Sensíveis

### Zonas de Perigo Extremo (MUITO CUIDADO AO MODIFICAR)
1.  **Manipulação de Propriedades da API Externa (`server.ts`):** A resposta da SmartPed é muito inconsistente nas maiúsculas/minúsculas. Existem códigos como `s.CodDist !== undefined ? s.CodDist : s.codDist` e `item.Ean || item.ean`. **Nunca presuma que a tipagem exata vinda da rede está perfeita.** Preserve as checagens com duplo *fallback*.
2.  **Construção de Strings SICF (`lineFinal = ["2", novoEan, ...].join(";")`):** Inserir arrays, colunas adicionais, espaços, ou falhar na conversão do preço de `.` (ponto) para o padrão esperado, irá quebrar o parser do ERP do cliente final. Modifique isso apenas de forma cirúrgica.
3.  **Resolução de nomes de distribuidoras (`resolveDistName` em `server.ts`):** A API **não garante** `NomeDist` no objeto da oferta. O nome vem em: `dists[]` da resposta, endpoint `/api/Condicoes/Distribuidores`, ou campos variados (`NomeDistribuidora`, `Nome_Dpe`, `Nome`). **Nunca leia `obj.NomeDist` direto** — sempre use `resolveDistName(obj, codDist)` que implementa a cadeia de fallback completa. O mapa estático `DISTRIBUIDORAS_MAP` (server/distributors.ts) é **último recurso**; o primário é `DISTRIBUIDORAS_DYNAMIC_CACHE` populado no startup + enriquecimento em tempo real.
4.  **Motor de troca (`findBestSubstitute` em `server/swap-engine.ts`):** Retorna objeto `melhor` **sem** `NomeDist` — apenas `CodDist`. A resposta final enviada ao frontend (linha ~2124 em server.ts) **deve** chamar `resolveDistName(melhor, codDist)` antes de serializar. Ler `melhor.NomeDist` direto resulta em "Distribuidor 503".
5.  **Validação de equivalência (`validateSwapEquivalence` em `swap-validation.ts`):** Regex de apresentação (linha ~195) deve incluir `CPR` | `CP` | `COMP` | `CAPS` | `CAP`... Omissão de `CPR` faz ofertas válidas ("30CPR") serem rejeitadas silenciosamente.
6.  **Filtro de EAN no dropdown de ruptura (server.ts:1995-2001):** Em ruptura (`!originalHasStock`), **não filtrar** alternativas por EAN. O filtro `allowedEans = [originalEan, novoEan]` só se aplica quando tem estoque. Remover isso quebra o ConditionSelector (não mostra NeoSul, CervoSul etc.).

### 5.1. Deploy Cloud Run (Estado Atual - 2026-08-15)
*   **Serviço Ativo:** `smartped-cli` no projeto GCP `gen-lang-client-0702342051`, região `us-east1`.
*   **URL:** `https://smartped-cli-887122622666.us-east1.run.app`
*   **Configuração:** `NODE_ENV=production`, memória 1Gi, timeout 300s.
*   **Persistência:** Turso (libSQL na nuvem) — variáveis `TURSO_DATABASE_URL` e `TURSO_AUTH_TOKEN` configuradas no Cloud Run.
*   **Dockerfile:** Single-stage build com `node:20`, sem `DISABLE_SQLITE`.
*   **Fallback:** Se Turso não estiver configurado, usa `better-sqlite3` local (dev) ou fica sem persistência.

### Débitos Técnicos Encontrados
*   **Gerenciamento de Estado no React (Prop Drilling):** Todo o estado macro da aplicação (`fileContent`, arrays, loaders, relatórios, modais) está condensado no componente `<App />`, que o passa para baixo como cascatas de *props* para `<UploadBox>`, `<SwapsTable>`, etc. Idealmente, exigiria um contexto global.
*   **Tratamento de Exceções (`any`):** No lado do backend (TypeScript), há muito uso de `catch (err: any)`. O rastro de stack traces reais não é processado estruturalmente para o cliente, geralmente sendo cuspidas mensagens genéricas ou em `logs: string[]`.
*   **SQLite no Cloud Run via Turso:** O `better-sqlite3` causava SIGSEGV no container gVisor do Cloud Run. Resolvido com migração para Turso (libSQL na nuvem). Ver seção 9.
*   **ConditionSelector em itens de ruptura (Referência/Ético/O):** Quando o item original é de Referência/Ético/O e não tem estoque, o `validateSwapEquivalence` bloqueia os substitutos. O `allAlternativesForRupture` é construído antes do filtro. Corrigido: fallback + filtro de disabledDistSet + incluso mesmo-EAN com estoque=0.

---

## 9. Migração SQLite → Turso (CONCLUÍDO - 2026-08-15)

### O que foi feito
- `@tursodatabase/serverless` instalado
- `server/database.ts` adaptado: detecção automática `TURSO_DATABASE_URL` + `TURSO_AUTH_TOKEN`
- `DISABLE_SQLITE=true` removido do Dockerfile
- Schema inicializado via `initTursoSchema()` no startup
- Testado localmente: conexão OK, CREATE/DROP OK

### Variáveis de Ambiente (Cloud Run)
| Variável | Descrição |
|----------|-----------|
| `TURSO_DATABASE_URL` | `libsql://smartped-db-ckipper22.aws-us-east-1.turso.io` |
| `TURSO_AUTH_TOKEN` | Token de autenticação Turso |

### Fallback de Persistência
| Cenário | Comportamento |
|---------|---------------|
| Turso configurado e online | Usa Turso (L1 + L2 + persistência) |
| Turso não configurado | Usa better-sqlite3 local (dev) |
| better-sqlite3 falha (Cloud Run/gVisor) | Sem persistência, só cache L1 |
| **Turso configurado mas offline** | **Sem persistência** (catch silencioso, sem fallback automático para better-sqlite3) |

**NOTA:** No Cloud Run, better-sqlite3 causa SIGSEGV (gVisor). Se o Turso ficar offline, o sistema funciona apenas com cache L1 (memória). Pedidos e histórico serão perdidos até o Turso voltar.

### Referências
- Docs: https://docs.turso.tech/sdk/ts/quickstart

---

## 6. Ambiente e Execução

**Comandos npm:**
*   `npm run dev`: Inicializa o Vite middleware e o Express (ambos na porta 3000) usando `tsx server.ts`. É o comando base.
*   `npm run build`: Roda o build do frontend e paralelamente constrói via `esbuild` o servidor node-native em `dist/server.cjs`.
*   `npm run start`: Inicia o build pronto de produção.
*   `npm run lint`: Faz verificação de tipagem estrita com `tsc --noEmit`.

**Google Cloud CLI (gcloud):**
*   **Path:** `C:\Users\carlo\AppData\Local\Google\Cloud SDK\google-cloud-sdk\bin\gcloud.cmd`
*   **Alias PowerShell:** `$gcloud = "C:\Users\carlo\AppData\Local\Google\Cloud SDK\google-cloud-sdk\bin\gcloud.cmd"`

**Comandos gcloud mais usados:**
```powershell
# Deploy com variáveis Turso
$envFile = Get-Content .env
$tursoUrl = ($envFile | Select-String "TURSO_DATABASE_URL=").ToString().Split("=",2)[1]
$tursoToken = ($envFile | Select-String "TURSO_AUTH_TOKEN=").ToString().Split("=",2)[1]
& "$gcloud" run deploy smartped-cli --source . --region us-east1 --project gen-lang-client-0702342051 --set-env-vars="TURSO_DATABASE_URL=$tursoUrl,TURSO_AUTH_TOKEN=$tursoToken"

# Ver logs (últimas 20 entradas)
& "$gcloud" logging read "resource.type=cloud_run_revision AND resource.labels.service_name=smartped-cli" --limit 20 --project gen-lang-client-0702342051 --format="text(timestamp,textPayload)"

# Ver logs com filtro (ex: TURSO)
& "$gcloud" logging read "resource.type=cloud_run_revision AND resource.labels.service_name=smartped-cli AND textPayload:TURSO" --limit 20 --project gen-lang-client-0702342051 --format="text(timestamp,textPayload)"

# Logs frescos (últimos 2min)
& "$gcloud" logging read "resource.type=cloud_run_revision AND resource.labels.service_name=smartped-cli" --limit 20 --project gen-lang-client-0702342051 --format="text(timestamp,textPayload)" --freshness=2m

# Descrever serviço
& "$gcloud" run services describe smartped-cli --region us-east1 --project gen-lang-client-0702342051

# Listar revisões
& "$gcloud" run revisions list --region us-east1 --project gen-lang-client-0702342051 --limit 5

# Descrever revisão específica
& "$gcloud" run revisions describe smartped-cli-00022-f44 --region us-east1 --project gen-lang-client-0702342051

# Ver variáveis de ambiente configuradas no serviço
& "$gcloud" run services describe smartped-cli --region us-east1 --project gen-lang-client-0702342051 --format="value(spec.template.spec.containers[0].env)"
```

**Endpoints de administração (chamar via Invoke-RestMethod):**
```powershell
# Trigger sync de preços manual
$envFile = Get-Content .env
$token = ($envFile | Select-String "SMARTPED_PRODUCTION_TOKEN=").ToString().Split("=",2)[1]
$cnpj = ($envFile | Select-String "SMARTPED_DEFAULT_CNPJ=").ToString().Split("=",2)[1]
$body = @{ token = $token; cnpj = $cnpj } | ConvertTo-Json
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

**Variáveis de Ambiente / Conexão:**
*   Todas as credenciais, tokens, CNPJs e URLs externas são centralizadas no bloco `CONFIG` no topo de `server.ts`, que lê de `process.env` com fallbacks. As variáveis são definidas no arquivo `.env` (não commitado).
*   Variáveis disponíveis: `SMARTPED_PRODUCTION_TOKEN`, `SMARTPED_SANDBOX_TOKEN`, `SMARTPED_DEFAULT_CNPJ`, `SMARTPED_PRODUCTION_URL`, `SMARTPED_SANDBOX_URL`, `FERRAMENTINHAS_API_URL`, `TURSO_DATABASE_URL`, `TURSO_AUTH_TOKEN`, `APP_ADMIN_EMAILS`, `APP_ADMIN_PASSWORD`.
*   O sistema depende primordialmente das chaves fornecidas *pelo cliente* no `<ConfigurationPanel />` da tela (CNPJ do cliente, Token SmartPed). O tráfego seguro do Backend é o que esconde as requisições, agindo como um proxy para evitar quebra de CORS de navegadores cliente.

---

## 7. Branches de Backup

| Branch | Commit | Conteúdo |
|--------|--------|----------|
| `master` | `59b81a5` | Estado atual (pós-busca-por-tipo) |
| `backup/pre-busca-etico-generico` | `59b81a5` | Backup antes da busca por tipo de item |
| `pos-grande-refatoracao` | `147c018` | Backup pós-refatoração (SQLite integrado, docs divididos) |
| `backup-tudo-funcionando` | `89b85d2` | Backup pré-refatoração |

---

## 8. Prompt Mestre de Governança

O projeto segue o **Prompt Mestre de Governança de Engenharia com IA** (16 regras). Documentado em `AGENTS.md`. Status: 16/16 regras aplicadas (considerando uso pessoal).

Regras-chave para próximas sessões:
1. Modularização desde o dia 1
2. Documentação em camadas (LLM_CONTEXT.md como índice)
3. Nunca reescrever arquivo inteiro (diff/patch)
4. Leitura cirúrgica (grep + read com offset)
5. Verificação antes de aceitar (tsc + testes + build)
6. Nunca alucinar dado técnico
7. LGPD simplificado para uso pessoal
8. SQLite opcional no Cloud Run (DISABLE_SQLITE=true)
