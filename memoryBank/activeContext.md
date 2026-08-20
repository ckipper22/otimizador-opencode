# Active Context

## Date: 2026-08-20

## Current Task: Deploy Cloud Run falhando — container não inicia

### O que foi feito nesta sessão (COMMITADO + PUSHADO)
1. **Fix codProdutoDist vazio** — ENRICH-POST-BATCH-SUBS busca EANs de substitutos em `Condicoes/Ean`
2. **Filtro dropdown semCodProdutoDist** — remove alternativas com `codProdutoDist` vazio do ConditionSelector
3. **Bloco amarelo produto original ruptura** — SwapsTable.tsx mostra "PRODUTO ORIGINAL EM FALTA" em amarelo para itens de ruptura
4. **Mensagem "Nenhuma encomenda pendente"** — App.tsx mostra mensagem quando API retorna array vazio
5. **Backup branch** `backup/resolvido-codigo-distribuidora` criada e pushada
6. **Commit** `e483d58` pushado no master

### Deploy — STATUS: FALHANDO
- **Revisão atual funcionando:** `smartped-cli-00049-g9g` (versão anterior, sem as alterações novas)
- **Revisões novas falham:** 00050 e 00051 — "container failed to start on port 8080"
- **Causa identificada:** Buildpacks usados pelo `gcloud run deploy --source .` ignoram o Dockerfile (onde `ENV NODE_ENV=production` está). Sem `NODE_ENV=production`, server.ts config.ts:16 faz fallback para porta 3000 em vez de 8080. Cloud Run health check em 8080 → timeout.
- **cloud-env.yaml:** Agora tem 13 variáveis (incluindo `NODE_ENV: "production"`)
- **Buildpacks vs Dockerfile:** `gcloud run deploy --source .` às vezes usa buildpacks (bun), às vezes Dockerfile. Quando usa Dockerfile, build falha em `firebase-applet-config.json` (Vite/Rollup não resolve o import)

### Problema residual
- **Dockerfile build:** Falha em `Could not resolve "../../firebase-applet-config.json"` — Vite/Rollup não consegue resolver o import JSON do `src/lib/firebaseClient.ts`
- **Buildpacks build:** Funciona mas container falha ao iniciar (porta errada sem NODE_ENV)
- **Solução possível:** Adicionar `NODE_ENV: "production"` ao cloud-env.yaml (JÁ FEITO) E garantir que buildpacks são usados (não Dockerfile)

### Próximo passo (PRÓXIMA SESSÃO)
1. Deploy com `NODE_ENV` no cloud-env.yaml — pode resolver se buildpacks forem usados
2. Se Dockerfile for usado: criar `.gcloudignore` para forçar buildpacks, OU corrigir o Dockerfile
3. Se ainda falhar: considerar remover o `firebaseClient.ts` (não parece usado em produção) ou mover o JSON para dentro de `src/`
4. Testar se container inicia corretamente na porta 8080

### Git state
- Branch: `master` (ahead of origin by 0 — tudo pushado)
- Commit: `e483d58` (último)
- Branch backup: `backup/resolvido-codigo-distribuidora` (pushada)
- cloud-env.yaml: criado com 13 vars (incl NODE_ENV) — NÃO commitar (sensitive)

### Arquivos modificados nesta sessão
- `server.ts` — ENRICH-POST-BATCH-SUBS, filtro semCodProdutoDist
- `server/parsers.ts` — alterações menores
- `server/smartped-api.ts` — alterações menores
- `src/App.tsx` — msg "Nenhuma encomenda pendente"
- `src/components/SwapsTable.tsx` — bloco amarelo produto original ruptura
- `src/hooks/useOptimizationResult.ts` — alterações menores
- `AGENTS.md`, `LLM_CONTEXT.md` — documentação atualizada
