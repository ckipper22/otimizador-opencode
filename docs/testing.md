# Guia de Testes, Diagnósticos e APIs de Referência

## 7. Guia de Testes, DiagnÃ³sticos e APIs de ReferÃªncia (Para PrevenÃ§Ã£o de Desvios)

### 7.1. Massa de Testes Real (EAN de DiagnÃ³stico)
*   **EAN de Teste Central:** `7896714290492`
*   **Produto Associado:** `PANTOPRAZOL 40MG 28CPR GEN NEO QUIMICA`
*   **LaboratÃ³rio:** `Neo QuÃ­mica`

### 7.2. Detalhes de IntegraÃ§Ã£o e Endpoints

#### A) API de CondiÃ§Ãµes SmartPed (ProduÃ§Ã£o Real)
*   **Base URL:** Definida em `CONFIG.SMARTPED_PRODUCTION_URL` (env: `SMARTPED_PRODUCTION_URL`, padrÃ£o: `https://api.smartped.com.br`)
*   **Token de ProduÃ§Ã£o:** Definido em `CONFIG.SMARTPED_PRODUCTION_TOKEN` (env: `SMARTPED_PRODUCTION_TOKEN`)
*   **Token de Sandbox:** Definido em `CONFIG.SMARTPED_SANDBOX_TOKEN` (env: `SMARTPED_SANDBOX_TOKEN`)
*   **CNPJ PadrÃ£o:** Definido em `CONFIG.SMARTPED_DEFAULT_CNPJ` (env: `SMARTPED_DEFAULT_CNPJ`)
*   **Endpoints Principais:**
    *   `/api/Condicoes/Ean`: Retorna condiÃ§Ãµes comerciais diretas do produto de todas as distribuidoras liberadas para envio.
    *   `/api/Condicoes/Molecula`: Fornece substitutos com base na molÃ©cula.

#### B) API do ERP Local / Trier (Ferramentinhas Similares)
*   **Base URL:** Definida em `CONFIG.FERRAMENTINHAS_API_URL` (env: `FERRAMENTINHAS_API_URL`, padrÃ£o: `https://api.ferramentinhas.com.br`)
*   **Endpoint de Similares:** `${CONFIG.FERRAMENTINHAS_API_URL}/api/produtos/similares/${ean}`
*   **DocumentaÃ§Ã£o Completa:** Ver `API_TREE_TRIER.md` (camadas Ferramentinhas + SGF API nativa)
*   **Retorno TÃ­pico:** Retorna um objeto no formato `{ success: boolean, encontrou: boolean, produtos: SimilarProduct[] }`.
*   **Estrutura de Propriedades dos Produtos do ERP:**
    *   `ean`: CÃ³digo de barras cadastrado localmente no ERP.
    *   `nom_produto`: Nome do medicamento.
    *   `nom_laborat`: LaboratÃ³rio fabricante.
    *   `qtd_estoque`: Estoque fÃ­sico atualmente disponÃ­vel.
    *   `vlr_custopersonalizado`: PreÃ§o de custo lÃ­quido personalizado de compra.
    *   `vlr_venda_tabela`: PreÃ§o de venda cheio de tabela sem as promoÃ§Ãµes locais aplicadas.
    *   `vlr_venda_final`: PreÃ§o de venda lÃ­quida final (valor real de prateleira praticado na farmÃ¡cia com desconto).

### 7.3. Regra de Ouro de ExibiÃ§Ã£o de PreÃ§os no Modal de Similares (`SimilarProductsModal.tsx`)
Para evitar discrepÃ¢ncias em que o preÃ§o de venda Ã© exibido igual ao preÃ§o de tabela cheio (ignorando os descontos da farmÃ¡cia), a interface do usuÃ¡rio **DEVE obrigatoriamente priorizar a exibiÃ§Ã£o de `vlr_venda_final`** e, apenas caso este seja nulo ou indefinido, usar o `vlr_venda_tabela` como fallback.
*   **ExpressÃ£o Correta em CÃ³digo:**
    `prod.vlr_venda_final !== undefined ? formatCurrency(prod.vlr_venda_final) : formatCurrency(prod.vlr_venda_tabela)`

### 7.4. EquivalÃªncia Estrita, ValidaÃ§Ã£o e Alertas de Quantidade (Fases 1 e 2)
Para evitar trocas invÃ¡lidas de medicamentos com dosagens diferentes, fracionados incorretos, sabores misturados ou preÃ§os abusivos:
1. **Match de EquivalÃªncia Estrita Multidimensional (`validateSwapEquivalence` no backend):**
    * **Dosagem e Volumetria:** O backend extrai todas as concentraÃ§Ãµes/dosagens via regex (ex: `5MG`, `100ML`, `0.4MG/ML`). Se houver qualquer divergÃªncia de dosagem, o swap Ã© bloqueado.
    * **Quantidade de Comprimidos / ApresentaÃ§Ã£o:** Extrai a contagem de comprimidos/cÃ¡psulas/drÃ¡geas (ex: `15CP`, `30CP`, `60CP`, `30 COMP`). A quantidade no substituto deve bater exatamente com a do original, bloqueando compras que cubram tratamentos parciais (ex: sugerir 15CP para cobrir receita de 30CP).
    * **Sabor, FragrÃ¢ncia e Cor (Correlatos/Eno/Esmaltes):** Usa regex para caÃ§ar termos sensÃ­veis de sabor, fragrÃ¢ncia ou cor (ex: `LimÃ£o`, `GuaranÃ¡`, `Renda`, `Rosa`, `Ametista`). Exige correspondÃªncia exata de 100% (ex: impede troca de Eno LimÃ£o por GuaranÃ¡ ou esmalte Renda por Rosa).
2. **Busca de Equivalentes Locais baseada em InterseÃ§Ã£o FlexÃ­vel de Tokens (`getLocalEquivalents`):**
    * Substitui buscas rÃ­gidas por uma correspondÃªncia flexÃ­vel onde a descriÃ§Ã£o de entrada Ã© dividida em palavras-chave.
    * Remove sais e termos de ligaÃ§Ã£o de ruÃ­do comuns (ex: `SODICO`, `CLORIDRATO`, `MALEATO`, `CALCICA`, `SULFATO`).
    * Garante match instantÃ¢neo e robusto se todos os termos essenciais remanescentes (ex: `PANTOPRAZOL` e `20MG`) estiverem contidos na chave do banco local, resolvendo a visÃ£o em tÃºnel de produtos como o Pantoprazol Eurofarma.
3. **Busca Textual de Fallback DinÃ¢mica no Lote:**
    * Se o EAN original ou a distribuidora original de um item processado no lote automÃ¡tico estiver sem estoque, o backend dispara sÃ­ncronamente uma busca por princÃ­pio ativo/molÃ©cula/texto diretamente na SmartPed (integrando os resultados de `Condicoes/Molecula` e `Produtos/Buscar`). Isso garante que o lote venha enriquecido e completo de primeira.
4. **Tratamento de Embalagens Coletivas e Fracionados (`alertaConfirmarQtd`):** O backend calcula se a quantidade e preÃ§o sugerem embalagem coletiva (ex: termos como `"C/"`, `"CX/"`, `"DISPLAY"`, ou fator `cx > 1` com quantidade nÃ£o mÃºltipla). TambÃ©m sinaliza se houver salto de preÃ§o abusivo (> 1.5x do original).
5. **Interface do UsuÃ¡rio com AÃ§Ãµes RÃ¡pidas de Ajuste:** A tabela principal (`SwapsTable.tsx`) e o modal de detalhes (`InterchangeabilityModal.tsx`) renderizam um card em amarelo Ã¢mbar com o `motivoAlerta` e um campo numÃ©rico com o botÃ£o "OK" direto. Digitar `0` remove o item do lote.

### 7.5. DeduplicaÃ§Ã£o Inteligente de Ofertas e Cockpit Comercial no Modal de Similares (`SimilarProductsModal.tsx`)
Para resolver o problema de condiÃ§Ãµes duplicadas de mesma distribuidora (decorrentes de mÃºltiplos prazos e campanhas na SmartPed) e evitar rejeiÃ§Ãµes de pedidos com erro `"ERR:ABAIXO DO MINIMO"`:
1. **DeduplicaÃ§Ã£o Inteligente de Ofertas (Foco no Melhor Prazo/PreÃ§o):**
   * As ofertas retornadas pela SmartPed sÃ£o agrupadas pela chave composta `EAN + CodDist`.
   * **CritÃ©rio de SeleÃ§Ã£o:** Para cada distribuidora, Ã© mantida a oferta com o **menor preÃ§o lÃ­quido** (`Pliquido` / `PliquidoUni`).
   * **CritÃ©rio de Desempate:** Em caso de empate no preÃ§o lÃ­quido, o sistema elege automaticamente o item com o **maior Prazo** (melhor condiÃ§Ã£o de fluxo de caixa para a farmÃ¡cia).
2. **Grade Comercial Rica e Completa (12 Colunas Estritas):**
   A tabela de similares do modal manual exibe as seguintes 12 colunas formatadas e alinhadas:
   1. `Distribuidora` (`NomeDist` / `Nome_Dpe`)
   2. `Produto / EAN` (`Descricao` e `Ean`)
   3. `LaboratÃ³rio` (`Laboratorio`)
   4. `PreÃ§o FÃ¡brica/Bruto` (`Preco` / `Preco_idi` via `formatCurrency`)
   5. `Desconto %` (`Desconto`)
   6. `Desconto Extra %` (`DescExtra`)
   7. `ST (Imposto)` (`ValorST` / `ValorSt`)
   8. `PreÃ§o LÃ­quido` (`Pliquido` / `PliquidoUni` destacado em verde esmeralda)
   9. `Prazo` (`Prazo` - ex: "28 dias")
   10. `Qtd MÃ­nima (Item)` (`QtdMin` com alerta visual destacado em amarelo/vermelho caso exija quantidade mÃ­nima de compra)
   11. `Ped. MÃ­nimo (Distribuidora)` (`VlrMinimo` cruzado dinamicamente no array de `minimos` por `CodDist + Condicao + Prazo`)
   12. `AÃ§Ãµes` (BotÃ£o de adicionar a oferta diretamente ao faturamento)
3. **Barra de Pesquisa Manual RÃ¡pida:**
   Permite ao operador digitar qualquer EAN ou descriÃ§Ã£o para re-cotar e comparar alternativas em tempo real diretamente na SmartPed com filtros de estoque e deduplicaÃ§Ã£o instantÃ¢neos.

### 7.6. Scripts RÃ¡pidos para ValidaÃ§Ã£o de Fluxos
*   `test_smartped_ean.cjs`: Permite realizar consultas manuais aos endpoints `/api/Condicoes/Ean` e `/api/Condicoes/Molecula` usando o token real de diagnÃ³stico para validar se a comunicaÃ§Ã£o com a API da SmartPed estÃ¡ saudÃ¡vel.
*   `test_all_similares.cjs`: Permite realizar uma requisiÃ§Ã£o limpa para a API do ERP Ferramentinhas de Similares a fim de verificar a resposta bruta de um determinado EAN e conferir as chaves de preÃ§os retornadas.

### 7.7. ResiliÃªncia de ExpansÃ£o HÃ­brida, PreservaÃ§Ã£o de DescriÃ§Ã£o Rica e DeduplicaÃ§Ã£o por Chave Combinada
Para garantir que buscas textuais (como "hidroclorotiazida") encontrem todas as promoÃ§Ãµes especiais e condiÃ§Ãµes agressivas de distribuidoras (ex: Gauchofarma a R$ 1,19 com condiÃ§Ã£o numÃ©rica especial `115378` e QtdMin 12 un):
1. **ExpansÃ£o HÃ­brida Resiliente com `Promise.all`:**
   * Em `/api/search-products`, a consulta paralela de EANs descobertos usa `Promise.all` para chamar AMBOS os endpoints (`Condicoes/Ean` + `Condicoes/Molecula`) por EAN, com isolamento de falha individual (`try/catch` por promise).
   * A falha de um EAN isolado nÃ£o sabota as cotaÃ§Ãµes comerciais dos demais produtos do lote.
   * A adiÃ§Ã£o do `Condicoes/Molecula` foi essencial para trazer `QtdMin` dos substitutos moleculares, que o `Condicoes/Ean` sozinho nÃ£o retornava na busca por descriÃ§Ã£o.
2. **PreservaÃ§Ã£o da DescriÃ§Ã£o Comercial Rica e LaboratÃ³rio Original:**
   * O backend utiliza um catÃ¡logo por EAN (`eanCatalogMap`) e os helpers `resolveBestDescription` e `resolveBestLaboratorio` para garantir que o nome de apresentaÃ§Ã£o completo do produto (ex: `"HIDROCLOROTIAZIDA (G) 25MG 30CPM NEO"`) e seu laboratÃ³rio real (ex: `"NEO QUIMICA"`) **nunca** sejam sobrescritos pelo termo de busca em minÃºsculo enviado pelo usuÃ¡rio.
3. **DeduplicaÃ§Ã£o Final por Chave Combinada (`${Ean}_${CodDist}_${Condicao}_${Prazo}`):**
   * Antes do envio da resposta, a lista bruta `allAlternatives` passa por deduplicaÃ§Ã£o estrita pela chave Ãºnica comercial `${Ean}_${CodDist}_${Condicao}_${Prazo}`, mantendo a oferta de menor preÃ§o lÃ­quido caso ocorram duplicatas geradas pelas mÃºltiplas chamadas Ã  API da SmartPed, priorizando o menor preÃ§o lÃ­quido absoluto sem descarte por estoque/sob consulta.
   * **âš ï¸ REGRA CRÃTICA:** NUNCA incluir o preÃ§o na chave de deduplicaÃ§Ã£o. Ver seÃ§Ã£o 4.12.3 para contexto do bug histÃ³rico (2026-08-15).
4. **PadrÃµes de Interface do Cockpit Manual (`SimilarProductsModal` / `App.tsx`):**
   * O checkbox "DeduplicaÃ§Ã£o Inteligente" inicia **desmarcado por padrÃ£o** (`manualDeduplicar = false`), permitindo ao operador ver todas as condiÃ§Ãµes e promoÃ§Ãµes existentes de imediato.
   * O checkbox "Apenas com Estoque" inicia **marcado por padrÃ£o** (`manualApenasEstoque = true`), com tolerÃ¢ncia para promoÃ§Ãµes: se `Estoque > 0` OU se `QtdMin > 1` (ofertas promocionais sob consulta com lote mÃ­nimo exigido), o item Ã© exibido em tela.
   * A grade comercial de 12 colunas conta com largura mÃ­nima garantida (`min-w-[1320px]`), cabeÃ§alho fixo (`sticky top-0`), containers com `min-w-0 w-full max-w-full` e barra de rolagem horizontal personalizada (`custom-table-scrollbar`) para navegaÃ§Ã£o em qualquer resoluÃ§Ã£o.



