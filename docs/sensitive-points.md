# Pontos Sensíveis, Débitos Técnicos e Ambiente

## 5. Estado Atual, DÃ©bitos TÃ©cnicos e Pontos SensÃ­veis

### â˜¢ï¸ Zonas de Perigo Extremo (MUITO CUIDADO AO MODIFICAR)
1.  **ManipulaÃ§Ã£o de Propriedades da API Externa (`server.ts`):** A resposta da SmartPed Ã© muito inconsistente nas maiÃºsculas/minÃºsculas. Existem cÃ³digos como `s.CodDist !== undefined ? s.CodDist : s.codDist` e `item.Ean || item.ean`. **Nunca presuma que a tipagem exata vinda da rede estÃ¡ perfeita.** Preserve as checagens com duplo *fallback*.
2.  **ConstruÃ§Ã£o de Strings SICF (`lineFinal = ["2", novoEan, ...].join(";")`):** Inserir arrays, colunas adicionais, espaÃ§os, ou falhar na conversÃ£o do preÃ§o de `.` (ponto) para o padrÃ£o esperado, irÃ¡ quebrar o parser do ERP do cliente final. Modifique isso apenas de forma cirÃºrgica.
3.  **MonÃ³lito do `server.ts`:** O arquivo estÃ¡ massivo (quase 2 mil linhas). Ele mescla regras de roteamento HTTP, parsing de texto, algoritmia de precificaÃ§Ã£o cruzada e fallback mockado estÃ¡tico. Se for refatorar, quebre em mÃ³dulos como `parser.ts`, `apiClient.ts` e `optimizerLogic.ts`, mas tenha em mente o limite de contexto de geraÃ§Ã£o de cÃ³digo.

### DÃ©bitos TÃ©cnicos Encontrados
*   **Gerenciamento de Estado no React (Prop Drilling):** Todo o estado macro da aplicaÃ§Ã£o (`fileContent`, arrays, loaders, relatÃ³rios, modais) estÃ¡ condensado no componente `<App />`, que o passa para baixo como cascatas de *props* para `<UploadBox>`, `<SwapsTable>`, etc. Idealmente, exigiria um contexto global.
*   **Tratamento de ExceÃ§Ãµes (`any`):** No lado do backend (TypeScript), hÃ¡ muito uso de `catch (err: any)`. O rastro de stack traces reais nÃ£o Ã© processado estruturalmente para o cliente, geralmente sendo cuspidas mensagens genÃ©ricas ou em `logs: string[]`.

---

## 6. Ambiente e ExecuÃ§Ã£o

**Comandos:**
*   `npm run dev`: Inicializa o Vite middleware e o Express (ambos na porta 3000) usando `tsx server.ts`. Ã‰ o comando base.
*   `npm run build`: Roda o build do frontend e paralelamente constrÃ³i via `esbuild` o servidor node-native em `dist/server.cjs`.
*   `npm run start`: Inicia o build pronto de produÃ§Ã£o.
*   `npm run lint`: Faz verificaÃ§Ã£o de tipagem estrita com `tsc --noEmit`.

**VariÃ¡veis de Ambiente / ConexÃ£o:**
*   Todas as credenciais, tokens, CNPJs e URLs externas sÃ£o centralizadas no bloco `CONFIG` no topo de `server.ts`, que lÃª de `process.env` com fallbacks. As variÃ¡veis sÃ£o definidas no arquivo `.env` (nÃ£o commitado).
*   VariÃ¡veis disponÃ­veis: `SMARTPED_PRODUCTION_TOKEN`, `SMARTPED_SANDBOX_TOKEN`, `SMARTPED_DEFAULT_CNPJ`, `SMARTPED_PRODUCTION_URL`, `SMARTPED_SANDBOX_URL`, `FERRAMENTINHAS_API_URL`, `APP_ADMIN_EMAILS`, `APP_ADMIN_PASSWORD`.
*   O sistema depende primordialmente das chaves fornecidas *pelo cliente* no `<ConfigurationPanel />` da tela (CNPJ do cliente, Token SmartPed). O trÃ¡fego seguro do Backend Ã© o que esconde as requisiÃ§Ãµes, agindo como um proxy para evitar quebra de CORS de navegadores cliente.



