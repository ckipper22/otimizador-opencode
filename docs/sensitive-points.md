# Pontos Sensíveis, Débitos Técnicos e Ambiente

## 5. Estado Atual, Débitos Técnicos e Pontos Sensíveis

### Zonas de Perigo Extremo (MUITO CUIDADO AO MODIFICAR)
1.  **Manipulação de Propriedades da API Externa (`server.ts`):** A resposta da SmartPed é muito inconsistente nas maiúsculas/minúsculas. Existem códigos como `s.CodDist !== undefined ? s.CodDist : s.codDist` e `item.Ean || item.ean`. **Nunca presuma que a tipagem exata vinda da rede está perfeita.** Preserve as checagens com duplo *fallback*.
2.  **Construção de Strings SICF (`lineFinal = ["2", novoEan, ...].join(";")`):** Inserir arrays, colunas adicionais, espaços, ou falhar na conversão do preço de `.` (ponto) para o padrão esperado, irá quebrar o parser do ERP do cliente final. Modifique isso apenas de forma cirúrgica.

### 5.1. Deploy Cloud Run (Estado Atual - 2026-08-15)
*   **Serviço Ativo:** `smartped-cli` no projeto GCP `gen-lang-client-0702342051`, região `us-east1`.
*   **URL:** `https://smartped-cli-887122622666.us-east1.run.app`
*   **Configuração:** `NODE_ENV=production`, `DISABLE_SQLITE=true`, memória 1Gi, timeout 300s.
*   **Dockerfile:** Single-stage build com `node:20` (não `-slim`), `npm rebuild better-sqlite3` para forçar compilação nativa.
*   **Problema:** O `better-sqlite3` causa SIGSEGV (signal 11) no Cloud Run. Testado com v12.11.1 e v13.0.3 — ambos falham no container gVisor do Cloud Run. O problema é o ambiente Cloud Run (gVisor sandbox), não apenas a versão da biblioteca. Por isso, `DISABLE_SQLITE=true` está definido no Dockerfile. Quando desabilitado, o sistema funciona apenas com cache L1 (Map em memória). Todas as funções de banco em `server/database.ts` tratam `null` graciosamente.
*   **Alternativas para resolver:** (1) Usar Cloud Storage para persistência, (2) Usar Cloud SQL (MySQL/PostgreSQL), (3) Aguardar suporte nativo do Cloud Run a SQLite.
*   **Registra como débito técnico:** resolver o SIGSEGV para reativar SQLite em produção.

### Débitos Técnicos Encontrados
*   **Gerenciamento de Estado no React (Prop Drilling):** Todo o estado macro da aplicação (`fileContent`, arrays, loaders, relatórios, modais) está condensado no componente `<App />`, que o passa para baixo como cascatas de *props* para `<UploadBox>`, `<SwapsTable>`, etc. Idealmente, exigiria um contexto global.
*   **Tratamento de Exceções (`any`):** No lado do backend (TypeScript), há muito uso de `catch (err: any)`. O rastro de stack traces reais não é processado estruturalmente para o cliente, geralmente sendo cuspidas mensagens genéricas ou em `logs: string[]`.

---

## 6. Ambiente e Execução

**Comandos:**
*   `npm run dev`: Inicializa o Vite middleware e o Express (ambos na porta 3000) usando `tsx server.ts`. É o comando base.
*   `npm run build`: Roda o build do frontend e paralelamente constrói via `esbuild` o servidor node-native em `dist/server.cjs`.
*   `npm run start`: Inicia o build pronto de produção.
*   `npm run lint`: Faz verificação de tipagem estrita com `tsc --noEmit`.

**Google Cloud CLI (gcloud):**
*   **Path:** `C:\Users\carlo\AppData\Local\Google\Cloud SDK\google-cloud-sdk\bin\gcloud.cmd`
*   **Deploy Cloud Run:** `& "C:\Users\carlo\AppData\Local\Google\Cloud SDK\google-cloud-sdk\bin\gcloud.cmd" run deploy smartped-cli --source . --region us-east1 --project gen-lang-client-0702342051`
*   **Ver logs:** `& "C:\Users\carlo\AppData\Local\Google\Cloud SDK\google-cloud-sdk\bin\gcloud.cmd" logging read "resource.type=cloud_run_revision AND resource.labels.service_name=smartped-cli" --limit 20 --project gen-lang-client-0702342051`
*   **Descrever serviço:** `& "C:\Users\carlo\AppData\Local\Google\Cloud SDK\google-cloud-sdk\bin\gcloud.cmd" run services describe smartped-cli --region us-east1 --project gen-lang-client-0702342051`

**Variáveis de Ambiente / Conexão:**
*   Todas as credenciais, tokens, CNPJs e URLs externas são centralizadas no bloco `CONFIG` no topo de `server.ts`, que lê de `process.env` com fallbacks. As variáveis são definidas no arquivo `.env` (não commitado).
*   Variáveis disponíveis: `SMARTPED_PRODUCTION_TOKEN`, `SMARTPED_SANDBOX_TOKEN`, `SMARTPED_DEFAULT_CNPJ`, `SMARTPED_PRODUCTION_URL`, `SMARTPED_SANDBOX_URL`, `FERRAMENTINHAS_API_URL`, `APP_ADMIN_EMAILS`, `APP_ADMIN_PASSWORD`.
*   O sistema depende primordialmente das chaves fornecidas *pelo cliente* no `<ConfigurationPanel />` da tela (CNPJ do cliente, Token SmartPed). O tráfego seguro do Backend é o que esconde as requisições, agindo como um proxy para evitar quebra de CORS de navegadores cliente.

---

## 7. Branches de Backup

| Branch | Commit | Conteúdo |
|--------|--------|----------|
| `master` | `2114375` | Estado atual |
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
