# Diretrizes Gerais de Operação do Sistema

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
13. **CACHE L1+L2 - NUNCA ASSUMIR QUE É "EM MEMÓRIA":** O cache de API SmartPed possui duas camadas: L1 (Map em memória, 2000 entradas) e L2 (SQLite persistente). Ao ler cache, sempre consultar L1 primeiro; se miss, consultar L2. Ao escrever, sempre escrever em ambos. Nunca assumir que o cache "morreu" apenas porque o servidor reiniciou — o L2 persiste os dados.
14. **SQLite EM PRODUÇÃO USA `/tmp`:** Em Cloud Run, o banco SQLite fica em `/tmp/smartped.db` (volátil, mas persistente entre requests). Não tente gravar em diretórios permanentes — o Cloud Run sobrescreve o filesystem em cada deploy. Use sempre `getDbPath()` de `server/database.ts` para obter o caminho correto.
15. **CLOUD RUN - SQLite OPCIONAL (DISABLE_SQLITE):** O `better-sqlite3` causa SIGSEGV (signal 11) no Cloud Run. Por isso, o Dockerfile define `DISABLE_SQLITE=true`. Quando desabilitado, o sistema funciona apenas com cache L1 (Map em memória). Todas as funções de banco em `server/database.ts` tratam `null` graciosamente. **NUNCA** remova o `DISABLE_SQLITE=true` do Dockerfile sem antes resolver o SIGSEGV.
16. **DEDUPLICAÇÃO POR CHAVE COMERCIAL:** Ao deduplicar ofertas da SmartPed, use a chave `${Ean}_${CodDist}_${Condicao}_${Prazo}` (sem preço). Manter a oferta de menor preço líquido em caso de duplicata. Isso se aplica a `/api/search-products` e `/api/smartped-find-substitutes`.
17. **ORDENAÇÃO POR PREÇO LÍQUIDO:** Os resultados de busca devem ser ordenados por `precoLiquido` ascendente. A função `resolvePrecoLiquido` em `src/utils.ts` deve reconhecer os campos `Pliquido`, `pliquido`, `PliquidoUni`, `pliquidoUni`, `precoLiquido`, `Preco`, `preco`, `precoOriginal`.
18. **LGPD - DADOS PESSOAIS:** O projeto manipula CNPJ (dado pessoal/jurídico sensível).
    * **Mascaramento obrigatório em logs:** CNPJ, CPF, e-mail, telefone — NUNCA em texto claro. Função utilitária: `maskCnpj(cnpj)` que mantém só os 8 primeiros dígitos + `***` (ex: `13.408.443/0001-***`).
    * **Dados sensíveis identificados no projeto:**
        - `cnpj` / `apiCnpj` / `finalCnpj` (em server.ts e App.tsx)
        - `token` da API SmartPed (config.ts via .env)
        - CNPJ do arquivo SICF (cabeçalho tipo 1)
    * **Onde o CNPJ circula (caminhos críticos):**
        - `/api/optimize` → body `cnpj`
        - `/api/faturar` → body `cnpj` (via token + CNPJ default)
        - `/api/pedidos-do-dia` → body `cnpj`
        - `/api/smartped-find-substitutes` → body `cnpj`
        - Cache L1+L2 → chave inclui `cnpj`
        - SQLite `orders.cnpj` / `api_cache.key`
    * **Retenção de dados no SQLite:**
        - `api_cache`: purga automática de registros expirados (TTL > X dias) — implementado em `startDbCachePurge()` em `server/database.ts`.
        - `orders` / `order_items` / `faturados`: **SEM PURGA automática hoje** — registrar como débito técnico para implementar retenção configurável via env var (ex: `DATA_RETENTION_DAYS=90`).
    * **Minimização:** Coletar apenas CNPJ + dados estritamente necessários para cotar e faturar. Nunca armazenar dados de saúde, CPF de funcionários ou dados bancários.
    * **Direito de exclusão:** Se o titular solicitar remoção, o caminho técnico é deletar registros do SQLite por CNPJ (query direta no banco). Endpoint de exclusão não implementado hoje — registrar como débito técnico.
19. **TESTE DE BUSCA ANTES DE COMMIT:** Antes de commitar qualquer alteração em `server.ts` (especialmente na rota `/api/search-products` ou `/api/smartped-find-substitutes`), execute o teste de busca local:
    - Busque por "HIDROCLOROTIAZIDA" e verifique: (1) sem ofertas duplicadas, (2) ordenado por preço líquido crescente, (3) QtdMin aparece nas promoções.
    - Busque por um EAN numérico e verifique o mesmo.
    - Se qualquer teste falhar, NÃO commite — corrija primeiro.
20. **DEDUPLICAÇÃO É REGRA DE NEGÓCIO, NÃO DETALHE:** A deduplicação de ofertas da SmartPed é uma regra de negócio crítica. A chave correta é `${Ean}_${CodDist}_${Condicao}_${Prazo}` (SEM preço). Qualquer alteração nessa chave deve ser validada com testes reais antes de commitar. Ver seção 4.12.3 do LLM_CONTEXT.md para contexto do bug histórico.

*Sempre se comunique em português.*
