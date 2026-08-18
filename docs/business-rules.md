# Regras de Negócio e Fluxo de Dados

## 4. Regras de NegÃ³cio e Fluxo de Dados

### 4.1. O Arquivo SICF
O padrÃ£o da indÃºstria possui estrutura posicional/delimitada:
*   **Tipo 1 (CabeÃ§alho):** ContÃ©m CNPJ do cliente. Ex: `1;13408443000168;...`
*   **Tipo 2 (Item de Linha):** ContÃ©m produto e EAN. Ex: `2;7891234567890;10;123;AMOXICILINA;EMS;15.50;...` (EAN, Quantidade, CÃ³d. Interno, DescriÃ§Ã£o, Lab, PreÃ§o).
*   **Tipo 9 (RodapÃ©):** Marcador de final do arquivo.

*   **Limpeza AutomÃ¡tica de EAN (Zeros Ã  Esquerda):** No parsing do arquivo SICF, inclusÃ£o manual ou retornos da API, o sistema normaliza e remove automaticamente quaisquer zeros Ã  esquerda redundantes do EAN (atravÃ©s da funÃ§Ã£o `cleanEan`). Isso evita preenchimentos indesejados (ex: `0000078924383` vira `78924383`, mantendo-o como EAN-8 padrÃ£o), melhora a legibilidade do relatÃ³rio e impede falhas ou divergÃªncias de mapeamento ao cruzar dados de distribuidores na API.

### 4.2. O Fluxo de OtimizaÃ§Ã£o (O Core Engine)
Quando `/api/optimize` Ã© acionada, os seguintes passos ocorrem:
1.  **Parse & Chunking:** O SICF Ã© lido. EANs Ãºnicos sÃ£o separados. Como a API SmartPed restringe EANs simultÃ¢neos, o servidor faz chamadas agrupadas (em blocos de 40).
2.  **Consulta de MolÃ©cula:** Bate nas rotas `/api/Condicoes/Molecula` (descobre genÃ©ricos) e `/api/Condicoes/Ean` (descobre o preÃ§o original). **Cache L1+L2**: Hits consultam memÃ³ria primeiro, depois SQLite; misses escritos em ambos.
3.  **Filtro de Distribuidoras (`disabledDistributors`):** Qualquer distribuidor desmarcado pelo usuÃ¡rio no painel de UI tem suas ofertas de substitutos sumariamente apagadas do array antes do algoritmo processar.
4.  **SeleÃ§Ã£o e Match (FunÃ§Ã£o `findBestSubstitute` no `server.ts`):** 
    *   **Prioridade Absoluta para Distribuidoras Reais (Fim de Ofertas Fantasmas):** Na ordenaÃ§Ã£o e na escolha da oferta vencedora ou alternativas, qualquer opÃ§Ã£o com `CodDist > 0` (distribuidoras reais) possui **prioridade absoluta** sobre opÃ§Ãµes cujo `CodDist === 0` ou nome do distribuidor seja `"NÃ£o Encontrados"` ou `"Sem Estoque"`. Se houver pelo menos uma oferta comercial real de distribuidora para o EAN, as ofertas fantasmas ("NÃ£o Encontrados") sÃ£o completamente excluÃ­das ou rebaixadas para o final da fila de seleÃ§Ã£o, garantindo que o Otimizador escolha sempre produtos reais que estÃ£o disponÃ­veis nas distribuidoras e nunca oculte ofertas reais por causa de preÃ§os de fallbacks virtuais.
    *   **Soberania do Item Original (Imunidade a Filtros de Painel):** O produto principal (o EAN exato enviado pelo usuÃ¡rio no arquivo SICF) Ã© rigorosamente soberano e imune aos filtros secundÃ¡rios do painel do otimizador (`config.tipos` e `margemMinima`). Se a API SmartPed devolve estoque e condiÃ§Ãµes reais de preÃ§o para o EAN exato original, o item jamais deve cair em status "NÃ£o Encontrados" (CodDist: 0) ou ter suas ofertas excluÃ­das. Os filtros de tipos de substituiÃ§Ã£o (como preferir apenas GenÃ©ricos "G") e de margem de economia mÃ­nima aplicam-se estritamente Ã s propostas de **Swaps** (substitutos alternativos de outros laboratÃ³rios de mesma molÃ©cula) e nunca ao produto base original da compra.
    *   **Busca em Tempo Real com Imunidade de EAN Original e Fluxo de Duas Etapas por DescriÃ§Ã£o:** No endpoint de busca textual e de EAN (`/api/search-products`), se a pesquisa for realizada por descriÃ§Ã£o (texto), o sistema executa um **fluxo obrigatÃ³rio de duas etapas**:
        1. **Busca Cadastral (`/api/Produtos/Buscar`)**: Localiza as opÃ§Ãµes e extrai os EANs corretos.
        2. **CotaÃ§Ã£o Comercial Bypass (`/api/Condicoes/Ean`)**: Realiza uma chamada automÃ¡tica paralela para o endpoint de condiÃ§Ãµes comerciais usando os EANs obtidos. Isso Ã© necessÃ¡rio porque a rota cadastral de busca textual nÃ£o retorna condiÃ§Ãµes comerciais ou tabelas de preÃ§os/PMC das distribuidoras.
        3. **Filtro de EAN Exato (onlyExactEan) na AdiÃ§Ã£o Manual ("+")**: Quando a busca Ã© disparada a partir do modal flutuante de AdiÃ§Ã£o Manual ("+"), o parÃ¢metro `onlyExactEan: true` Ã© enviado no payload. Se a busca for numÃ©rica (por EAN), o backend desativa a chamada de substitutos genÃ©ricos (`Condicoes/Molecula`) e realiza um filtro rÃ­gido pÃ³s-busca para garantir que apenas ofertas do exato mesmo EAN pesquisado sejam retornadas, evitando que concorrentes ou similares poluam o resultado.
        4. **PreservaÃ§Ã£o dos Similares no BotÃ£o do Olhinho (`/api/similares/:ean`)**: O filtro de EAN exato aplica-se estritamente ao modal de adiÃ§Ã£o manual (`+`). O modal de anÃ¡lise de similares ("o olhinho" / `SimilarProductsModal`) continua operando via rota dedicada `/api/similares/:ean` com recuperaÃ§Ã£o automÃ¡tica de descriÃ§Ã£o via `EAN_DATABASE` e busca inteligente por molÃ©cula/DCB, garantindo que a lista completa de similares, genÃ©ricos e equivalentes apareÃ§a corretamente.
    *   Exige que o estoque no distribuidor seja maior que `0` (se `permitirSemEstoque` for falso).
    *   Calcula o `precoNovo`.
    *   Valida se a diferenÃ§a `(precoOriginal - precoNovo) >= margemMinima` (apenas para substitutos de EAN diferente, e somente se o produto original possuir estoque ativo disponÃ­vel nas distribuidoras).
    *   **Bypass de Falta (ExceÃ§Ã£o para Suprimento de Faltas):** A exigÃªncia de `margemMinima` (que sÃ³ sugere substituiÃ§Ã£o se houver economia em relaÃ§Ã£o ao original) aplica-se exclusivamente quando o EAN original possui estoque superior a zero nas distribuidoras reais. Se o item original estiver totalmente indisponÃ­vel (Ruptura/Falta Absoluta nas distribuidoras reais), o sistema ignora sumariamente o filtro de `margemMinima` para os substitutos/swaps. O Otimizador seleciona o substituto de mesma molÃ©cula que tenha estoque ativo, que respeite os `config.tipos` aceitos e a categoria correspondente (GenÃ©rico com GenÃ©rico / Marca com Marca), elegendo a alternativa mais barata disponÃ­vel para suprir a prateleira da farmÃ¡cia.
    *   Se o item original nÃ£o possui estoque de jeito nenhum (ruptura) e for GenÃ©rico, o algoritmo aceitarÃ¡ um substituto genÃ©rico de preÃ§o equivalente (foco em abastecimento em vez de apenas lucro, podendo exceder em atÃ© 10% do valor como fallback definitivo de ruptura).
    *   **OtimizaÃ§Ã£o de Menor PreÃ§o Absoluto com Seletor de Alternativas Comerciais Categorizado:** Para garantir que a farmÃ¡cia sempre veja a melhor oferta do mercado, o algoritmo de otimizaÃ§Ã£o ignora o filtro rÃ­gido de quantidade mÃ­nima (`QtdMin`) na triagem de ofertas de menor custo. Em vez disso, se a quantidade solicitada for inferior ao limite da promoÃ§Ã£o, a interface renderiza um alerta de quantidade mÃ­nima ("MÃ­nimo Promo: X un"). O usuÃ¡rio ganha um painel estruturado de "OpÃ§Ãµes de Compra & SubstituiÃ§Ã£o de LaboratÃ³rio" em cada linha da tabela. O seletor manual de condiÃ§Ãµes separa as opÃ§Ãµes em dois grupos visuais nÃ­tidos via `<optgroup>`:
            1. `ðŸ“‹ CONDIÃ‡ÃƒO DE COMPRA`: Para manter o mesmo medicamento/marca, alterando apenas o distribuidor, preÃ§o ou prazo.
            2. `ðŸ”¬ SUBSTITUIÃ‡ÃƒO`: Para trocar o medicamento por um fabricante ou laboratÃ³rio equivalente mais barato (EAN diferente).
    *   **Alerta de MÃ­nimo Comercial Altamente VisÃ­vel:** Para evitar problemas de faturamento onde a farmÃ¡cia envia pedidos sem atingir a quantidade promocional mÃ­nima exigida, o sistema destaca os itens que nÃ£o cumprem o `qtdMin` com um banner vermelho piscando de alta visibilidade ("âš ï¸ MÃNIMO COMERCIAL: X un (ATENÃ‡ÃƒO: FALTA Y UN!)") diretamente na linha do item.
    - **BotÃµes de RecomendaÃ§Ãµes RÃ¡pidas Descritivas:** Em vez de botÃµes genÃ©ricos de menor custo, a interface renderiza cartÃµes de aÃ§Ã£o rÃ¡pida baseados no contexto do item:
            - **âš¡ RESOLVER ALERTA DE MÃNIMO COMERCIAL ou MELHOR PREÃ‡O SEM MÃNIMO (MESMO PRODUTO)**: Se houver uma oferta do mesmo produto sem limite mÃ­nimo de quantidade, um botÃ£o especÃ­fico com cor contextualizada (vermelho se houver alerta ativo para resolver, ou esmeralda para economia convencional) explica exatamente qual distribuidora serÃ¡ selecionada, o preÃ§o final e a economia unitÃ¡ria obtida para evitar o bloqueio comercial.
            - **ðŸ”¬ SUBSTITUIR POR OUTRO LABORATÃ“RIO MAIS BARATO**: Se houver um substituto genÃ©rico/similar de menor custo de outro fabricante (EAN diferente), o botÃ£o exibe explicitamente qual fabricante serÃ¡ adotado, o distribuidor que o fornece, e o valor total de economia. Isso garante que o comprador saiba exatamente qual aÃ§Ã£o estÃ¡ tomando.
    - **Painel/Modal de Intercambialidade & CondiÃ§Ãµes de Compra (BotÃ£o ao lado do CÃ³digo de Barras):** Para todas as opÃ§Ãµes e linhas da tabela de trocas, o usuÃ¡rio conta com um botÃ£o azul (`Layers`) posicionado estrategicamente ao lado do cÃ³digo de barras (EAN). Esse botÃ£o abre um modal interativo de alta fidelidade que categoriza e ordena todas as alternativas disponÃ­veis de forma extremamente clara em trÃªs grupos (Abas):
            1. `ðŸ“‹ MESMO MEDICAMENTO & CONDIÃ‡Ã•ES`: Exibe as ofertas do exato mesmo produto (mesmo EAN), mas sob outras condiÃ§Ãµes (como distribuidoras sem exigÃªncia de quantidade mÃ­nima ou com prazos diferentes).
            2. `ðŸ”¬ MEDICAMENTOS GENÃ‰RICOS`: Lista todas as opÃ§Ãµes de laboratÃ³rios genÃ©ricos equivalentes ordenadas pelo menor preÃ§o lÃ­quido unitÃ¡rio.
            3. `â­ MEDICAMENTOS SIMILARES E Ã‰TICOS`: ReÃºne todos os medicamentos de marca equivalentes (similares e Ã©ticos/referÃªncia) disponÃ­veis.
       
       *Varredura Ativa e Concorrente da SmartPed em Tempo Real:* Se o item selecionado estiver marcado como "Sem Estoque", "NÃ£o Encontrados", ou se nÃ£o possuir ofertas cadastradas de antemÃ£o, o modal ativa instantaneamente uma busca profunda em tempo real conectando-se ao endpoint `/api/smartped-find-substitutes`.
       O backend descobre as informaÃ§Ãµes de DCB/composiÃ§Ã£o consultando a API do Ferramentinhas pelo EAN do item (e aplicando heurÃ­sticas inteligentes baseadas em texto para o nome do produto caso o EAN falhe) e, em seguida, dispara **cinco consultas assÃ­ncronas concorrentes (em paralelo)** na SmartPed:
            - `Condicoes/Ean` (por EAN)
            - `Condicoes/Molecula` (pelo EAN da molÃ©cula)
            - `Condicoes/Molecula` (pelo texto/cÃ³digo DCB descoberto)
            - `Condicoes/Similares` (por EAN)
            - `Condicoes/Substitutos` (por EAN)
       Todas as ofertas retornadas pelas distribuidoras sÃ£o mescladas, desduplicadas (preservando a com maior estoque/menor preÃ§o) e re-classificadas reativamente no frontend. O modal fornece um botÃ£o para forÃ§ar varreduras manuais e um painel de logs de rastreabilidade integrado que depura detalhadamente a execuÃ§Ã£o de todas as requisiÃ§Ãµes SmartPed para o comprador. Ao clicar em **"Encaminhar Pedido"**, o sistema redireciona reativamente o item para o novo fornecedor/preÃ§o no pedido.
    *   **ExibiÃ§Ã£o e IntegraÃ§Ã£o do PMC (PreÃ§o MÃ¡ximo ao Consumidor) e NormalizaÃ§Ã£o Financeira:** Para dar transparÃªncia completa de precificaÃ§Ã£o e margem comercial para a farmÃ¡cia, o backend calcula e injeta os campos `originalPmc` e `novoPmc` no relatÃ³rio principal, bem como o PMC individual de cada alternativa, extraindo-os diretamente das respostas comerciais da SmartPed. Para garantir 100% de confiabilidade e tolerÃ¢ncia a falhas nos dados de ERPs ou de parceiros:
            - **Tratamento de Strings com VÃ­rgula e SÃ­mbolos de Moeda (`parseFormattedNumber`):** Qualquer valor financeiro vindo da SmartPed ou ERP Trier em formato string contendo vÃ­rgulas como divisor decimal ou prefixos de moeda (ex: `"R$ 41,96"` ou `"R$  41,96"`) Ã© higienizado removendo todos os caracteres nÃ£o-numÃ©ricos (exceto pontuaÃ§Ã£o vÃ¡lida e sinal negativo) e convertido para um nÃºmero decimal de ponto flutuante, eliminando falsos negativos de `NaN` ou `0` e garantindo a extraÃ§Ã£o perfeita de PMC e PreÃ§os de FÃ¡brica.
            - **PersistÃªncia Correta no Cache de Lotes EAN (`itensEan`):** No endpoint `/api/Condicoes/Ean`, as informaÃ§Ãµes de PMC e preÃ§o de tabela/fÃ¡brica vÃªm aninhadas individualmente dentro de cada item do array de ofertas `Condicoes`. O sistema percorre as condiÃ§Ãµes para capturar o PMC real (`PMC`) e o preÃ§o de tabela real (`Preco`/`PrecoOriginal`) do produto direto do JSON nativo da SmartPed, persistindo-os no objeto sintÃ©tico `ItemPedido` no cache de respostas `apiResponses[ean]`. Isso garante que o PMC esteja sempre disponÃ­vel para o otimizador sem depender de referÃªncias locais vazias ou fallbacks incorretos.
            - **Varredura Multipropriedades (`extractPmc` e `extractTablePrice`):** O backend realiza uma busca exaustiva por variaÃ§Ãµes comuns de nomes de atributos no JSON de retorno (como `PMC`, `pmc`, `Pmc`, `VlrPmc`, `vlr_pmc`, `Preco`, `preco`, `PrecoOriginal`, `vlr_venda_tabela`, etc.) para extrair o valor real do PMC e do PreÃ§o de FÃ¡brica/Tabela.
            - **Sem fallback — PMC aparece APENAS se a SmartPed retornar:** O campo PMC (PreÃ§o MÃ¡ximo ao Consumidor) Ã© extraÃ­do direto do JSON da SmartPed. **NUNCA** se calcula PMC via fÃ³rmula (`preco * 1.4`). Se a SmartPed nÃ£o retornar o campo ou vier zerado, o PMC simplesmente nÃ£o aparece na interface.
            - **Case-sensitivity SmartPed:** A API retorna campos com maiÃºsculas/minÃºsculas inconsistentes (`PMC`/`pmc`, `Pmc`, `VlrPmc`). Backend e frontend usam fallback em cascata: `field || field_lowercase || field_PascalCase`.
            - O frontend renderiza PMC de forma destacada e de alta visibilidade:
            - Na tabela principal de itens (`SwapsTable.tsx`), o PMC correspondente Ã© exibido logo abaixo do PreÃ§o LÃ­quido.
            - Na tela de adiÃ§Ã£o manual de itens (`App.tsx`), o PMC aparece dentro da coluna "PreÃ§o LÃ­quido" (pLiq) com estilo visual distinto: **fonte 11px bold, texto rosa, fundo rosa transparente** (`bg-pink-100/60`, `text-pink-700`, `border border-pink-200`), garantindo controle visual completo antes de enviar o item para o lote.
    *   **Cockpit Comercial e AdiÃ§Ã£o Manual de Itens (BotÃ£o Flutuante "+"):** O modal acionado pelo botÃ£o flutuante `+` em `src/App.tsx` opera como um **Cockpit Comercial de Alta Fidelidade** para pesquisa e inserÃ§Ã£o de produtos no lote ativo da SmartPed:
        - **Busca HÃ­brida com ExpansÃ£o de EANs (CotaÃ§Ã£o Comercial Completa por DescriÃ§Ã£o):** A API da SmartPed no endpoint `/api/Produtos/Buscar` nÃ£o processa promoÃ§Ãµes com quantidade mÃ­nima (`QtdMin`) nem descontos escalonados. Para resolver isso, o backend implementa a **Busca HÃ­brida com ExpansÃ£o**:
            1. *Fase de Descoberta*: Realiza a busca cadastral por descriÃ§Ã£o/curinga (`/api/Produtos/Buscar`) e extrai os principais EANs descobertos.
            2. *Fase de ExpansÃ£o*: Para CADA EAN, dispara em paralelo (`Promise.all`) tanto `/api/Condicoes/Ean` (com `AceitaOntem=1`) quanto `/api/Condicoes/Molecula` (com `ConsideraTipo=1`). O endpoint `Condicoes/Ean` traz as condiÃ§Ãµes diretas do produto com `QtdMin` e `minimos[]`. O endpoint `Condicoes/Molecula` traz os substitutos moleculares (genÃ©ricos/similares) com suas prÃ³prias condiÃ§Ãµes e `QtdMin`.
            3. *Merge + Enriquecimento*: Concatena os resultados de AMBOS os endpoints, cruza `minimos[]` com cada condiÃ§Ã£o (matching `CodDist + Condicao + Prazo`), e retorna a lista unificada de ofertas com `QtdMin` preenchido.
        - **DeduplicaÃ§Ã£o Inteligente de Ofertas:** A SmartPed frequentemente retorna mÃºltiplos registros para o mesmo EAN na mesma distribuidora devido a diferentes condiÃ§Ãµes de pagamento e campanhas. O cockpit agrupa as ofertas por `EAN + CodDist`, elegendo a melhor oferta comercial com base nos critÃ©rios estritos de desempate: **1) Menor PreÃ§o LÃ­quido -> 2) Maior Prazo de Pagamento -> 3) Maior Estoque FÃ­sico**.
        - **Grade Comercial Rica (12 Colunas):** Exibe com mÃ¡xima clareza:
            1. *Distribuidora* (Nome, cÃ³digo e condiÃ§Ã£o comercial).
            2. *Produto & EAN* (DescriÃ§Ã£o, EAN, botÃ£o de cÃ³pia e atalho para o olhinho de estoque ERP).
            3. *LaboratÃ³rio* fabricante.
            4. *PreÃ§o FÃ¡brica* (R$).
            5. *Desconto %*.
            6. *Desconto Extra %*.
            7. *SubstituiÃ§Ã£o TributÃ¡ria - ST* (R$).
            8. *PreÃ§o LÃ­quido* (Destaque em verde esmeralda).
            9. *Prazo* de pagamento (dias / Ã  vista).
            10. *Qtd MÃ­nima do Item* (com badge de aviso para pedidos acima de 1 unidade).
            11. *Pedido MÃ­nimo da Distribuidora* (calculado dinamicamente para evitar o erro `ERR:ABAIXO DO MINIMO`).
            12. *Quantidade & AÃ§Ã£o de Adicionar* (inclusÃ£o com feedback visual imediato e atualizaÃ§Ã£o reativa do lote).
    *   **DistinÃ§Ã£o Estrita de Escopos (Olhinho vs BotÃ£o Flutuante "+"):**
        - **BotÃ£o do Olhinho (`SimilarProductsModal.tsx`):** Focado exclusivamente na consulta de estoque local e cadastro no ERP Trier via `/api/similares/:ean`. NÃ£o possui conexÃ£o com a grade comercial SmartPed.
        - **BotÃ£o Flutuante "+" (`App.tsx`):** Focado no Cockpit Comercial ao vivo com a SmartPed, permitindo pesquisar por nome, molÃ©cula ou EAN, filtrar por estoque, deduplicar ofertas e adicionar novos itens diretamente ao lote de faturamento.
    *   **Destaque Visual para Valores Elevados por Item (Blinking Alert):** O usuÃ¡rio pode configurar um limite de valor total por item do pedido (default de R$ 100,00, armazenado em `localStorage`). Qualquer linha cujo valor total da linha (`PreÃ§o Novo * Quantidade`) exceda esse limite passarÃ¡ a pulsar/piscar visualmente na coluna de "Total", acompanhado de uma etiqueta de aviso ("âš ï¸ ALERTA: Confirmar Qtd!"), ajudando o comprador a validar quantidades e evitar compras acidentais de volumes gigantescos de itens de alto custo.
    *   **Busca de Similares (Ãcone do Olhinho) Focada Estritamente no Estoque/Cadastro Local sem SmartPed:** O Ã­cone do olho na tabela de resultados abre o `SimilarProductsModal.tsx` para consultar produtos similares locais no ERP (`/api/similares/:ean`). Para total consistÃªncia comercial, o backend utiliza exatamente a mesma heurÃ­stica de extraÃ§Ã£o de princÃ­pio ativo base (`getMoleculeBase`) que o sistema usa na aba principal de substituiÃ§Ã£o ("pesquisar substituto de verdade"). O modal apresenta na interface um seletor amigÃ¡vel para alternar entre:
            1.  **PadrÃ£o (DCB / ERP):** Faz a busca padrÃ£o direta via EAN na Trier, servindo as composiÃ§Ãµes associadas oficiais. Caso falhe, aciona de forma transparente a busca inteligente por descriÃ§Ã£o.
            2.  **DescriÃ§Ã£o / MolÃ©cula (Regex):** ForÃ§a ativamente o cruzamento por similaridade de descriÃ§Ã£o utilizando o algoritmo avanÃ§ado de limpeza de princÃ­pio ativo descoberto sobre o cadastro local em memÃ³ria (`EAN_DATABASE`).
                *   *Povoamento DinÃ¢mico Reativo:* Para maximizar a cobertura e precisÃ£o comercial (mesmo para itens novos do ERP real que nÃ£o estejam nas planilhas estÃ¡ticas), a busca direta de similares na API da Trier Ã© **sempre realizada em segundo plano** em qualquer consulta. Todos os produtos vinculados retornados do ERP Trier sÃ£o injetados dinamicamente no `EAN_DATABASE` com seus detalhes completos (estoque real, preÃ§o de venda, custo, DCB, cÃ³digo reduzido e Ãºltima entrada).
                *   *PrecisÃ£o Extrema:* O extrator ignora termos de veÃ­culos genÃ©ricos como `CHÃ`, `CHA`, `Ã“LEO`, `OLEO`, `ÃGUA`, `AGUA`, `GEL`, `PASTA` (ex: transformando `"CHA FUNCHO SANITAS"` em `"FUNCHO"`), e o algoritmo restringe o match de substring parcial para exigir **comprimento mÃ­nimo de 4 caracteres**, eliminando correspondÃªncias espÃºrias de termos curtos (como `CHA` batendo de forma errÃ´nea com `CHAMPAGNE` ou `CHAMOMILA`).
            -   **Filtro de Estoque Ativo na UI (Default True):** O modal inclui uma opÃ§Ã£o reativa para ocultar produtos do ERP Trier zerados e sem estoque mÃ­nimo configurado (ex: `Estoque > 0` ou `MÃ­nimo > 0`), que agora vem **ativada por padrÃ£o (true)** para garantir que o usuÃ¡rio veja apenas produtos com giro ativo no ERP local da farmÃ¡cia sem ocultar itens necessÃ¡rios que estejam com estoque zerado, mas com mÃ­nimo maior que zero.
            -   **ParametrizaÃ§Ã£o Estrita de Estoque da SmartPed:** A SmartPed opera estritamente com os cÃ³digos de status de estoque `0` (Sem Estoque), `1` (Baixo / Sob Consulta) e `2` (Estoque Normal). O sistema traduz esses valores programÃ¡ticos em texto descritivo correspondente em vez de exibi-los como quantidade fÃ­sica de caixas ("unidades" ou "un"), evitando que o comprador confunda cÃ³digos de status com saldo fÃ­sico nas distribuidoras. A funÃ§Ã£o utilitÃ¡ria `parseSmartPedEstoque` garante que cotaÃ§Ãµes com preÃ§o comercial ativo e sem flag explÃ­cita de ruptura sejam tratadas como disponÃ­veis (`2`), enquanto ofertas com status `0`, `"N"` ou `"SEM ESTOQUE"` sÃ£o mapeadas para `0`. Esta normalizaÃ§Ã£o se aplica aos filtros de busca comercial (`App.tsx`), `SimilarProductsModal.tsx`, `InterchangeabilityModal.tsx` e `DailyItemsView.tsx`.
            -   **Filtro "Apenas com Estoque" e Helpers Universais da SmartPed (`resolveEstoque` e `resolveQtdMinima`):** Para evitar discrepÃ¢ncias de maiÃºsculas/minÃºsculas no payload da SmartPed (que envia `Estoque`, `estoque`, `estoque_idi` ou `QtdMin`, `qtdMin`, `QtdMinima`, `qtdMinima`), foram criados os helpers unificados `resolveEstoque` e `resolveQtdMinima` em `src/utils.ts`. O filtro no Cockpit Comercial (`App.tsx`) e modais avalia estritamente `resolveEstoque(item) > 0`, descartando com precisÃ£o absoluta ofertas sem estoque (`0`, "Sem Estoque") e mantendo em tela ofertas normais (`2` - Em Estoque) e sob consulta (`1` - Sob Consulta).
            -   **Destaque de Quantidades MÃ­nimas Promocionais:** As condiÃ§Ãµes da SmartPed com quantidades mÃ­nimas escalonadas (ex: campanhas/combos com exigÃªncia de 12 caixas) sÃ£o normalizadas por `resolveQtdMinima`. Na tabela de ofertas do Cockpit Comercial, essas exigÃªncias sÃ£o destacadas com um badge amarelo compacto na coluna **Desconto %** (reproduzindo com fidelidade a interface da SmartPed) e com aviso em destaque na coluna **Qtd MÃ­nima do Item**. Ao clicar no botÃ£o de adicionar, o campo de quantidade Ã© prÃ©-preenchido com o valor mÃ­nimo da promoÃ§Ã£o.
            -   **Filtragem de Ofertas Sem Estoque no Modal de Intercambialidade:** No modal de intercambialidade (`InterchangeabilityModal.tsx`), todas as opÃ§Ãµes comerciais das distribuidoras que possuem estoque fÃ­sico zerado (`alt.estoque <= 0`) sÃ£o sumariamente filtradas e ocultadas. Uma proteÃ§Ã£o especial garante que apenas a "OpÃ§Ã£o Ativa" atual do pedido seja mantida caso ela mesma esteja sem estoque, permitindo que o usuÃ¡rio visualize a seleÃ§Ã£o ativa e possa migrÃ¡-la com facilidade.
            -   **Filtragem Rigorosa de Estoque e ProibiÃ§Ã£o de "NÃ£o Encontrados" na Tabela Principal (`SwapsTable.tsx`) e Backend:** Tanto no backend (`server.ts` em `itemAlternatives`) quanto no frontend (`SwapsTable.tsx` em `isValidAltForTable`, aÃ§Ãµes rÃ¡pidas `cheapestSameProductNoMinAlt` / `cheapestOtherItemAlt` e nos grupos de opÃ§Ãµes comerciais do dropdown), alternativas com distribuidora contendo "NÃƒO ENCONTRADOS" ou estoque fÃ­sico zerado/nulo (`estoque <= 0`) sÃ£o estritamente filtradas e impedidas de aparecer como sugestÃ£o de troca, opÃ§Ã£o de compra ou no menu de seleÃ§Ã£o, assegurando que o comprador jamais visualize ou selecione fornecedores fantasmas ou sem estoque.
            -   **PreservaÃ§Ã£o de Dados de ERP/Trier no Cache de EANs:** O processo de otimizaÃ§Ã£o (`/api/optimize`) mescla novos dados usando o operador spread (`...EAN_DATABASE[cleanedEan]`) em vez de sobrescrever completamente o registro, preservando campos cacheados valiosos (como `vlr_venda_tabela`, `vlr_venda_final`, `vlr_custopersonalizado` e estoque) gerados dinamicamente na varredura comercial de EANs.
            -   **Fallback e PadrÃ£o de ExibiÃ§Ã£o de PreÃ§os de Venda de Tabela:** Em conformidade com o padrÃ£o operacional das farmÃ¡cias e para evitar distorÃ§Ãµes de custos em itens sem ofertas ativas (onde o custo e a venda ficavam idÃªnticos), implementamos fallbacks realistas no backend para itens S.I.C.F: o preÃ§o de tabela (`vlr_venda_tabela`) assume `precoOriginal * 1.4` (PreÃ§o de Tabela/PMC sugerido) e o valor lÃ­quido final (`vlr_venda_final`) assume `precoOriginal * 1.35`. Na interface do modal de similares (`SimilarProductsModal.tsx`), priorizamos a renderizaÃ§Ã£o do campo de venda final lÃ­quida oficial com desconto (`prod.vlr_venda_final`) sobre o valor de tabela para dar uma referÃªncia precisa do valor de prateleira praticado no ERP.
    *   **Regra de Categoria Estrita (GenÃ©rico por GenÃ©rico apenas / Marca por Marca apenas):** Para manter total conformidade regulatÃ³ria e comercial, o algoritmo de otimizaÃ§Ã£o impede rigorosamente a substituiÃ§Ã£o de categorias cruzadas em medicamentos. Se o item original for um GenÃ©rico, o substituto sugerido ou selecionado **deve obrigatoriamente** ser outro GenÃ©rico. Se for de marca (Similar ou ReferÃªncia), o substituto **deve obrigatoriamente** ser de marca (Similar ou ReferÃªncia).
    *   **DetecÃ§Ã£o de GenÃ©ricos de Alta PrecisÃ£o (PrevenÃ§Ã£o de Falsos Positivos):** A classificaÃ§Ã£o de genÃ©ricos prioriza o tipo oficial de item (`TipoItem === "G"`) retornado pela API real. Em caso de ausÃªncia, analisa as palavras-chave na descriÃ§Ã£o e laboratÃ³rio de forma combinada e inteligente, eliminando as classificaÃ§Ãµes incorretas de itens de marca (como "Vynaxa") fabricados por laboratÃ³rios genÃ©ricos famosos (como "EMS" ou "Medley") por meio da verificaÃ§Ã£o do separador de marca (` - ` na descriÃ§Ã£o).
    *   **Blindagem de Dados e Fallback de DescriÃ§Ã£o na Interface:** Ao trocar de condiÃ§Ã£o de compra ou aplicar redistribuiÃ§Ã£o via assistentes de dispersÃ£o e faturamento, o frontend emprega um mecanismo de fallback robusto em cascata (`selectedAlt.descricao || item.novaDescricao || item.originalDescricao`) para garantir que os itens jamais apareÃ§am vazios (sem descriÃ§Ã£o) na tabela interativa do usuÃ¡rio.
    *   **Alerta Visual Pulsante para Itens Originais em Falta (`originalSemEstoque`):** Quando o sistema otimiza ou propÃµe uma troca devido ao produto original estar em falta ou com estoque zerado em todas as condiÃ§Ãµes/fornecedores (`originalSemEstoque`), a interface (`SwapsTable.tsx`) exibe um selo de destaque visual pulsante em vermelho (`ðŸš¨ ORIGINAL EM FALTA / SEM ESTOQUE`), garantindo total transparÃªncia ao comprador sobre o motivo da sugestÃ£o de troca.
5.  **RegeneraÃ§Ã£o do SICF:** ReconstrÃ³i o texto do arquivo usando as strings delimitadas `;` mas agora com os EANs e preÃ§os novos.
6.  **Redirecionamento de Faltas (Shortages):** Itens marcados como falta (`isShortage: true`) que forem redirecionados para outra distribuidora por meio dos assistentes de Dispersar ou Completar pedido perdem a flag de falta (`isShortage: false`), pois passam a ser ofertas vÃ¡lidas com estoque garantido na distribuidora de destino. Isso evita alertas de faltas incorretos e o destaque amarelo visual na nova distribuidora.
7.  **InteligÃªncia de Roteamento ao "Manter Original":** Ao desfazer um swap e manter o EAN original, o sistema nunca envia o item para a distribuidora original importada do ERP Trier se esta estiver sem estoque real ou indisponÃ­vel. O backend (`server.ts`) analisa as condiÃ§Ãµes comerciais compatÃ­veis ativas para o exato EAN original e as ordena de modo a priorizar aquelas que possuem estoque real (`estoque > 0`). Se houver oferta ativa em outra distribuidora, o item Ã© redirecionado automaticamente para a distribuidora de menor custo com estoque disponÃ­vel. O preÃ§o de custo (`novoPreco`) no relatÃ³rio ativo (`App.tsx`) Ã© atualizado para o preÃ§o cotado real correspondente (`originalPrecoCotado`) no distribuidor ativo selecionado.
8.  **HigienizaÃ§Ã£o de HTML (Anti-Vazamento):** Para impedir que tags HTML cruas (ex: `<b>`, `<strong>`, `<span>`) e caracteres de escape da API SmartPed sejam exibidos literalmente para o usuÃ¡rio, o backend (`server.ts`) e o frontend (`SwapsTable.tsx`) utilizam funÃ§Ãµes utilitÃ¡rias de limpeza (`stripHtmlTags` / `stripHtml`). Essas funÃ§Ãµes limpam descriÃ§Ãµes, laboratÃ³rios e mensagens de restriÃ§Ãµes comerciais antes de qualquer renderizaÃ§Ã£o visual ou transmissÃ£o.
9.  **Formatos de Sinais de Economia:** No componente `SwapsTable.tsx`, as economias reais de custos (reduÃ§Ã£o de preÃ§o unitÃ¡rio nas aÃ§Ãµes rÃ¡pidas) sÃ£o formatadas e apresentadas como valores positivos para melhor compreensÃ£o visual, eliminando o sinal negativo (`-R$`) em cenÃ¡rios de desconto real.
10. **PersistÃªncia SQLite (pÃ³s-resposta):** Ao finalizar a resposta ao frontend, o servidor salva o pedido no SQLite (`saveOrder` + `saveOrderItem`) de forma assÃ­ncrona. Isso garante rastreabilidade de todas as otimizaÃ§Ãµes realizadas sem impactar a latÃªncia da resposta HTTP.

### 4.3. Faturamento (`/api/faturar`)
Agrupa os itens pela distribuidora vencedora (`codDist`) e verifica se a soma alcanÃ§a o `pedidoMinimo` (Valor MÃ­nimo de Faturamento da distribuidora). Se nÃ£o atingir, emite um *warning*. Em caso afirmativo, formata um payload massivo e dispara a ordem para a SmartPed. **PersistÃªncia SQLite:** Ao finalizar a resposta, o servidor salva o pedido + itens no SQLite (`saveOrder` + `saveOrderItem`) de forma assÃ­ncrona.

*   **Seletor / OpÃ§Ãµes de Faturamento (Exportar JSON ou Enviar):** Ao clicar em faturar um lote ("Enviar Todos" ou individualmente por distribuidora), o frontend intercepta o processo abrindo o modal interativo `billingChoice`. O comprador escolhe entre:
    1.  **Apenas Gerar JSON para AnÃ¡lise:** Monta o payload exato que seria enviado via POST para a API, e realiza o download de um arquivo `.json` local (ex: `faturamento_payload_Todas_as_Distribuidoras.json`), sem disparar nenhuma chamada de rede para a integradora. Isso possibilita auditar e debugar os dados de forma Offline.
    2.  **De Fato Enviar para Smartped:** Prossegue com o fluxo de faturamento oficial abrindo a tela de confirmaÃ§Ã£o detalhada (`billingConfirm`).
*   **Blindagem (Validation) de Swaps e Regras de Faturamento Seguro:** Antes do faturamento ser transmitido, o backend realiza uma triagem de seguranÃ§a rigorosa em cada item seguindo 4 regras cruciais de blindagem:
    1.  **ValidaÃ§Ã£o Estrita de Swaps:** Se um item original sofreu substituiÃ§Ã£o (swap) por um equivalente, o sistema valida se os cÃ³digos identificadores (`codProduto` e `codProdutoDist`) sÃ£o vÃ¡lidos (nÃ£o vazios, nÃ£o nulos, nÃ£o strings `"null"` ou `"undefined"`, e estritamente diferentes de `"0"` ou `0`). Se for invÃ¡lido, ele Ã© omitido do lote para evitar erros ou faturamentos incorretos na distribuidora.
    2.  **Expurgo de Itens sem Distribuidora / Sem Estoque:** Qualquer item com cÃ³digo de distribuidora zerado (`codDist === 0` ou `originalCodDist === 0`), sem estoque, nÃ£o encontrado ou com nome de distribuidora vazio Ã© sumariamente bloqueado e expurgado antes da montagem final do JSON do payload para a SmartPed.
    3.  **Swap com EAN de Destino VÃ¡lido:** Bloqueia itens substitutos cujo EAN de destino (`novoEan`) seja ausente ou tenha comprimento inferior a 5 caracteres.
    4.  **ConsolidaÃ§Ã£o de Lote Ãšnico:** O backend unifica todos os itens faturÃ¡veis de todas as distribuidoras em uma Ãºnica chamada POST para `/api/Pedido/Envio` da SmartPed, impedindo disparos em paralelo por distribuidora de forma separada que causariam o erro `"JÃ¡ existe um envio pendente"`.
*   **Fallback / Espelhamento AutomÃ¡tico de CÃ³digo de Produto (`codProduto`):** Para evitar que itens com dados cadastrais incompletos (como DAFORIN, COMBTOL e DERMAEX) sejam descartados pela blindagem devido ao campo `codProduto` estar nulo, vazio ou preenchido como `"0"`, implementamos um mecanismo inteligente de espelhamento em ambas as camadas (Frontend e Backend). Sempre que o `codProduto` for identificado como `"0"`, nulo ou vazio, ele herda/copia automaticamente o valor do campo `codProdutoDist` (ID da oferta comercial). Isso se aplica no momento do Swap de alternativas no frontend, na geraÃ§Ã£o de arquivo de payload de anÃ¡lise (JSON), na transmissÃ£o de faturamento real, e no loop de validaÃ§Ã£o final do backend antes de disparar o pedido para a SmartPed.
*   **Duplo Cache de Faturamento:** Ao faturar, o sistema insere os metadados do produto no `FATURAMENTO_ITEMS_CACHE` sob duas chaves distintas e combinadas: `${numPedidoSmartPed}_${codDist}_${codProdutoDist}` e `${numPedidoSmartPed}_${codDist}_${codProduto}`. No momento da consulta do retorno (/api/pedidos-do-dia), onde as tags de descriÃ§Ã£o do produto nÃ£o sÃ£o retornadas de forma nativa pela SmartPed, o backend recupera as descriÃ§Ãµes em O(1) cruzando essas duas chaves do cache, ou em Ãºltima instÃ¢ncia no banco de EANs (`EAN_DATABASE`). Isso garante uma experiÃªncia totalmente livre de itens sem identificaÃ§Ã£o na UI de retornos.
*   **ValidaÃ§Ã£o Estrita de Resposta e Aborto Imediato (Sem ID Falso):** Mesmo que o endpoint da SmartPed responda com HTTP Status `200 OK`, o backend analisa o corpo da resposta JSON de forma rigorosa. Caso a propriedade `Mensagem` contenha expressÃµes de erro (como `"Erro"`, `"Falha"`, `"InvÃ¡lido"` ou o famoso bloqueio `"JÃ¡ existe um envio pendente"`), ou se a tag `Retorno` / `NumPedido` retornar nula ou vazia, o faturamento Ã© sumariamente **rejeitado** retornando `sucesso: false` e um HTTP Status `400 Bad Request` com o erro explÃ­cito para o frontend. Ã‰ terminantemente proibido gerar IDs de contingÃªncia locais no ambiente real. Isso blinda a aplicaÃ§Ã£o contra falsos positivos e garante que os itens permaneÃ§am ativos e intactos na tabela de otimizaÃ§Ã£o do frontend para faturamento posterior.
*   **Tratamento de Distribuidoras Bloqueadas (`DistBloqEnv`):** Quando o lote Ã© aceito com sucesso (com `NumPedido` gerado), mas algumas distribuidoras parceiras estÃ£o bloqueadas, a API retorna essas ocorrÃªncias na tag `resData.Retorno.DistBloqEnv`. O backend extrai estes dados e envia para o frontend, que renderiza um banner visual de alerta (`warning`) proeminente de tom Ã¢mbar na interface de sucesso, indicando detalhadamente quais distribuidoras do lote foram bloqueadas pelo servidor.
*   **Pedidos MÃ­nimos por Quantidade:** Em certas distribuidoras e promoÃ§Ãµes especÃ­ficas, o faturamento mÃ­nimo nÃ£o Ã© medido por valor monetÃ¡rio (R$), mas sim por **quantidade fÃ­sica acumulada de caixas/unidades** (ex: "mÃ­nimo de 5 caixas", "mÃ­nimo de 10 un"). O sistema exibe de forma clara e reativa a contagem total de unidades de cada lote no cabeÃ§alho do grupo da distribuidora (ex: `Total Pedido: R$ 354,20 (28 un)`), permitindo que o comprador valide o atendimento desse criterion fÃ­sico instantaneamente.
*   **ConsolidaÃ§Ã£o AutomÃ¡tica Anti-DuplicaÃ§Ã£o:** Para tornar impossÃ­vel que itens jÃ¡ faturados com sucesso (sem falta) sejam re-enviados ou transferidos para outra distribuidora pelos assistentes (Completar/Dispersar), ao fechar o modal de faturamento (pelo botÃ£o "X" ou "Fechar e Concluir"), o sistema aciona a funÃ§Ã£o `handleCloseAndConsolidateBilling`.

### 4.4. Interceptador Modal de PrÃ©-Faturamento Bloqueante e ValidaÃ§Ã£o Estrita (FASE 1 a 5)
1. **EquivalÃªncia Estrita de Trocas (Backend - `server.ts`):**
   * **Match de Dosagem/ConcentraÃ§Ã£o:** ExtraÃ§Ã£o via Regex de concentraÃ§Ã£o (ex: `10MG`, `100MCG`, `0.4MG/ML`, `15G`). A alternativa DEVE ter dosagem idÃªntica.
   * **Match de ApresentaÃ§Ã£o/Quantidade:** ExtraÃ§Ã£o via Regex de quantidade de comprimidos/mililitros (ex: `30CP`, `60 CAPS`, `100ML`). Rejeita trocas entre apresentaÃ§Ãµes distintas (ex: 30CP por 15CP).
   * **Match de Sabor/FragrÃ¢ncia/Cor (RejeiÃ§Ã£o Absoluta - Hard Block):** NormalizaÃ§Ã£o de texto limpa (remoÃ§Ã£o de acentos, caracteres especiais e caixa alta). Varredura pelo dicionÃ¡rio estrito de sabores (`LIMAO`, `GUARANA`, `LARANJA`, `MORANGO`, `ABACAXI`, `UVA`, `MENTA`, `TUTTI FRUTTI`, `EUCALIPTO`, `TRADICIONAL`, etc.). Se o item original e o substituto possuÃ­rem sabores/fragrÃ¢ncias divergentes, a funÃ§Ã£o `validateSwapEquivalence` retorna `false` IMEDIATAMENTE (Hard Block). A alternativa Ã© sumariamente descartada como opÃ§Ã£o de troca sem exibir alertas.
   * **DetecÃ§Ã£o Refatorada de Caixas Master/Fracionados (`alertaConfirmarQtd`):**
     * **DiscrepÃ¢ncia de PreÃ§o SensÃ­vel:** O alerta por preÃ§o sÃ³ Ã© acionado se `novoPreco > originalPreco * 3` (300%) **E** a diferenÃ§a absoluta `(novoPreco - originalPreco) > R$ 15,00`. Evita falsos positivos em itens baratos como esmaltes, batons e hidratantes.
     * **Filtro de Texto de Embalagem Inteligente:** Ignora siglas de laboratÃ³rios (`GG`, `AL`, `EMS`, `GL`, `BGN`, `GEO`). Valida equivalÃªncia de quantidades entre ERP e substituto (ex: `30CP` vs `C/30` -> nÃ£o alerta). SÃ³ alerta para termos coletivos atacados reais (`FARDO`, `DISPLAY`, `PACOTAO`, `25X4`, `CX COM`) ou contagens $C/N$ divergentes e elevadas ($> 30$).
2. **NormalizaÃ§Ã£o de EANs & PropagaÃ§Ã£o Parent (Backend):**
   * Todos os EANs com 13 dÃ­gitos ou menos sÃ£o normalizados via `padStart(13, "0")`.
   * PropagaÃ§Ã£o das propriedades pai (`Ean`, `Descricao`, `Laboratorio`) para alternativas filhas (`Condicoes`) no achatamento.
3. **Busca FlexÃ­vel por Token & Fallbacks Unificados (Backend):**
   * Limpeza de tokens de ruÃ­do (`SODICO`, `CLORIDRATO`) para evitar falsos negativos no `getLocalEquivalents`.
   * Fallback dinÃ¢mico para chamadas de API SmartPed caso a busca local resulte em zero estoque ou sem correspondÃªncia.
4. **Interceptador Modal de PrÃ©-Faturamento (Frontend - `App.tsx` / `ConfirmQuantitiesModal.tsx`):**
   * **Bloqueio Total da UI de Faturamento:** Se houver qualquer item ativo com `alertaConfirmarQtd: true` ou alerta de duplicaÃ§Ã£o recente na Profarma (`isProfarmaAlert: true`), a renderizaÃ§Ã£o e o faturamento das tabelas (`SwapsTable.tsx`) Ã© **estritamente bloqueado** para confirmaÃ§Ã£o obrigatÃ³ria.
   * **Modal Pop-Up Bloqueante (`ConfirmQuantitiesModal.tsx`):** Exibe os itens sob alerta de fracionamento/preÃ§o discrepante e alertas de duplicidade de pedidos enviados para a Profarma nas Ãºltimas 48 horas. Exibe o produto original ERP, a sugestÃ£o do distribuidor, o preÃ§o unitÃ¡rio cotado, a mensagem contextualizada do alerta, um campo de input livre para ajuste de quantidade e o botÃ£o de confirmaÃ§Ã£o "OK".
   * Digitando `0`, o item Ã© removido do faturamento. Clicar em `OK` atualiza a quantidade no estado e limpa a pendÃªncia do item. Quando a Ãºltima linha pendente for confirmada, o modal fecha automaticamente e libera as tabelas de faturamento.
5. **InteligÃªncia ao "Manter Original" com Estoque:**
   * Ao rejeitar uma troca para manter o item original de marca, se a distribuidora original importada do ERP estiver com estoque zerado, o sistema varre as cotaÃ§Ãµes ativas do mesmo EAN original e redireciona de forma inteligente para a distribuidora ativa com estoque real e preÃ§o mais baixo.
   * RemoÃ§Ã£o do sinal de menos (`-`) nas economias e exibiÃ§Ã£o limpa como `"Economia: R$ X"`.
   * RemoÃ§Ã£o total de concatenaÃ§Ãµes de HTML bruto na UI, utilizando JSX nativo.
6. **Gerador Parametrizado de Pedidos via WhatsApp (GenÃ©ricos Eurofarma):**
   * **ParametrizaÃ§Ã£o Dedicada (`direcionarEurofarmaWhatsapp`):** No painel de configuraÃ§Ãµes (`ConfigurationPanel.tsx`), o comprador pode ativar o direcionamento dos genÃ©ricos da Eurofarma para pedido por WhatsApp, alÃ©m de cadastrar o nÃºmero padrÃ£o de telefone do representante.
   * **Banner e BotÃ£o de AÃ§Ã£o (`SwapsTable.tsx`):** Exibe destaque informativo e o botÃ£o `ðŸ“± Pedido WhatsApp Eurofarma` contabilizando automaticamente os itens ativos do lote pertencentes ao laboratÃ³rio Eurofarma.
   * **Modal Gerador de Pedidos WhatsApp (`WhatsAppOrderModal.tsx`):** Permite revisar e filtrar a seleÃ§Ã£o dos genÃ©ricos Eurofarma, calcular o total de caixas e valor financeiro, e gerar uma mensagem formatada com Markdown profissional para WhatsApp. Conta com botÃ£o de cÃ³pia instantÃ¢nea para a Ã¡rea de transferÃªncia (`Copiar Texto do Pedido`) e botÃ£o de disparo direto no aplicativo/web (`Enviar via WhatsApp`).
    *   Se o retorno jÃ¡ foi consultado e finalizado (Status 3), as faltas reais sÃ£o mantidas no lote (`isShortage: true`) e os itens entregues sÃ£o removidos em definitivo de `result.report`.
    *   Se o retorno ainda nÃ£o foi consultado ou finalizado, o sistema assume preventivamente faturamento integral com sucesso, removendo permanentemente os itens faturados de `result.report` e arquivando-os no histÃ³rico permanente `faturadosGlobais`. Isso blinda o lote contra re-faturamento inadvertido ou erros de estado entre abas ou assistentes.
*   **HeurÃ­stica AvanÃ§ada de ExtraÃ§Ã£o de MolÃ©cula Base (`getMoleculeBase`):** Para contornar limitaÃ§Ãµes da API da SmartPed ao buscar alternativas comerciais (aba "NÃ£o Encontrado"), implementamos um algoritmo inteligente que extrai o princÃ­pio ativo real do medicamento a partir de sua descriÃ§Ã£o textual. A funÃ§Ã£o descarta ativamente dosagens complexas, quantidades fÃ­sicas (comprimidos, cÃ¡psulas, etc.), apresentaÃ§Ãµes e termos comerciais/laboratÃ³rios (como *Medley, EMS, Eurofarma, Uniphar, etc.*). Ao obter a molÃ©cula pura (ex: "CIPROFIBRATO"), a pesquisa pelo endpoint `/api/Condicoes/Molecula` atinge faturamento recorde de sugestÃµes alternativas sem falsos-negativos. Em produtos de perfumaria, maquiagem, conveniÃªncia ou cosmÃ©ticos (que comecem com termos genÃ©ricos como `KIT`, `BOLA`, `CREME`, `CHUPETA`, etc.), o algoritmo Ã© blindado para nÃ£o truncar o termo de forma incompleta (ex: reduzir `"KIT MAQUIAGEM INF GK1356"` para `"KIT"`), mas sim filtrar ativamente as palavras genÃ©ricas e extrair as palavras-chave especÃ­ficas (ex: `"MAQUIAGEM GK1356"`), alÃ©m de empregar uma trava de bloqueio estrita (`ehGenericoCompleto`) que impede que buscas de molÃ©cula textuais puramente genÃ©ricas sejam enviadas para a SmartPed.
*   **Busca Adicional por PrincÃ­pio Ativo e Dosagem (`cleanDescriptionKeepDosage`):** Adicionamos um algoritmo secundÃ¡rio de limpeza textual que descarta apresentaÃ§Ãµes e quantidades fÃ­sicas de comprimidos/unidades, mas **preserva estritamente a dosagem do composto** (ex: transformando `"PARACETAMOL 750MG 20CP"` em `"PARACETAMOL 750MG"`). O sistema agenda uma busca paralela concorrente no endpoint de molÃ©cula com este termo limpo de dosagem. Isso resolve falsos-negativos em medicamentos onde o cadastro do princÃ­pio ativo na distribuidora exige a dosagem correspondente e impede a exibiÃ§Ã£o de sugestÃµes incompatÃ­veis (como xaropes ou gotas para comprimidos).
*   **Motor AvanÃ§ado de GeraÃ§Ã£o de Buscas Curingas (`getWildcardQueries`):** Para contornar cenÃ¡rios onde os cadastros das distribuidoras possuem pequenas divergÃªncias de grafia, espaÃ§amento ou posicionamento de termos (ex: `"PARACETAMOL 750MG 20CP"` vs `"PARACETAMOL 750MG C/20"`), criamos um gerador inteligente de strings de busca baseados no operador curinga `%`. O motor higieniza e remove termos de apresentaÃ§Ã£o fÃ­sica colados aos nÃºmeros (transformando `"30CP"` ou `"30COMP"` em `"30"`) e filtra termos isolados irrelevantes de apresentaÃ§Ã£o (ex: `CP`, `COMP`, `CAPS`, `FR`, `CX`). Adicionalmente, gera buscas progressivas curtas combinando as primeiras palavras comerciais (ex: `"COLA%CILIOS"`) de modo a resolver falsos-negativos para cosmÃ©ticos, produtos de beleza ou correlatos sem princÃ­pios ativos puros, buscando concorrentemente no endpoint `/api/Produtos/Buscar` com faturamento mÃ¡ximo e resiliente. Para garantir total relevÃ¢ncia e precisÃ£o, as palavras genÃ©ricas comuns de perfumaria e conveniÃªncia (como `KIT`, `INFANTIL`, `SABONETE`, etc.) sÃ£o integradas nas listas de desconsideraÃ§Ã£o, impedindo a geraÃ§Ã£o de curingas excessivamente amplos ou inÃºteis (como `"KIT%"`).
*   **Layout Anti-Colapso Flexbox (`shrink-0` nos Modais):** Para evitar que cabeÃ§alhos, painÃ©is de identificaÃ§Ã£o rÃ¡pida, seletores de abas e rodapÃ©s sumissem ou ficassem cobertos sob alta densidade de conteÃºdo nas listas de alternativas, aplicamos propriedades determinÃ­sticas de nÃ£o-reduÃ§Ã£o flexbox (`shrink-0`) nos componentes `InterchangeabilityModal.tsx` e `SimilarProductsModal.tsx`. Isso isola o scroll exclusivamente na Ã¡rea de conteÃºdo dinÃ¢mico, preservando a usabilidade total da tela.


### 4.4. ExclusÃ£o Definitiva de Itens (`disabledItemCodes`)
Quando o usuÃ¡rio clica no Ã­cone de lixeira (excluir), o cÃ³digo interno do item Ã© adicionado ao conjunto de estado `disabledItemCodes` em `App.tsx`. O componente `SwapsTable.tsx` filtra o `processedReport` garantindo que os itens excluÃ­dos sejam sumariamente removidos de todos os cÃ¡lculos, tabelas de faturamento, downloads e agrupamentos (como o "Celerg").

### 4.5. IntegraÃ§Ã£o com Fornecedores do WhatsApp (Copiar e Colar / EdiÃ§Ã£o de Itens)
*   **Entrada de Dados e EdiÃ§Ã£o Individual:** No painel de parÃ¢metros (`ConfigurationPanel.tsx`), o usuÃ¡rio pode gerenciar tabelas de fornecedores de forma granular. AlÃ©m de colar blocos brutos de mensagens do WhatsApp para parsing automÃ¡tico via regex flexÃ­vel, o usuÃ¡rio conta com um sistema de abas de controle para cada fornecedor:
    *   **Aba "Texto Copiado":** Onde se gerencia o texto bruto colado da mensagem e o nome do fornecedor.
    *   **Aba "Produtos":** Uma visualizaÃ§Ã£o interativa contendo todos os produtos capturados pelo sistema. Permite a ediÃ§Ã£o individual da descriÃ§Ã£o e do preÃ§o de qualquer item, exclusÃ£o definitiva de produtos especÃ­ficos de forma amigÃ¡vel e a inserÃ§Ã£o manual/avulsa de novos itens digitando a descriÃ§Ã£o e preÃ§o, resolvendo problemas de condiÃ§Ãµes comerciais dinÃ¢micas que sofrem alteraÃ§Ãµes recorrentes.
    *   **TolerÃ¢ncia e Robustez no Regex de Parsing de PreÃ§os:** O parser de texto (`parsePriceList`) utiliza uma expressÃ£o regular otimizada com tolerÃ¢ncia a sufixos nÃ£o numÃ©ricos no final das linhas (como "final", "lÃ­quido", "cada", etc.) e pontuaÃ§Ãµes indesejadas (como hÃ­fens `-`, pontos e vÃ­rgulas `;`, bullets `â€¢`, emoticons de pÃ­lula `ðŸ’Š`). AlÃ©m disso, o parser suporta nativamente o formato em linhas separadas (quando o nome do produto estÃ¡ em uma linha e o seu respectivo preÃ§o estÃ¡ logo abaixo, na linha seguinte), associando a descriÃ§Ã£o pendente ao valor correspondente de forma automatizada. Isso garante que listas complexas e personalizadas coladas diretamente do chat do WhatsApp sejam interpretadas com precisÃ£o sem perda de dados.
*   **Algoritmo Preciso de ExtraÃ§Ã£o e CorrespondÃªncia (Match de Dosagem/Quantidade):** No backend (`server.ts` na rota `/api/optimize`), se existirem fornecedores externos cadastrados, o sistema calcula a correspondÃªncia combinando um score textual (limpeza de acentos, caracteres especiais e stop-words) com uma verificaÃ§Ã£o determinÃ­stica e segura de dosagem e quantidades fÃ­sicas via expressÃµes regulares:
    *   **LÃ³gica `extractDosageAndQty`:** Extrai dosagens numÃ©ricas vinculadas a unidades mÃ©dicas (`mg`, `mcg`, `g`, `ml`, `ui`, `ug`) e quantidades de embalagem (`cp`, `cpr`, `caps`, `tabs`, `comprimidos`, `amp`, `frasco`, `unidades`).
    *   **Regras Estritas de ValidaÃ§Ã£o:** 
        1.  *DivergÃªncia de Dosagem:* Se ambas as descriÃ§Ãµes comparadas (arquivo de pedido SICF e tabela do fornecedor) contiverem dosagens, elas devem bater exatamente (ex: impede a troca de "Tadalafila 5mg" por "Tadalafila 20mg", mesmo com alto overlap de palavras).
        2.  *DivergÃªncia de ApresentaÃ§Ã£o/Quantidade:* Se ambas as descriÃ§Ãµes especificarem quantidades (ex: "30cp" vs "10cp"), elas devem ser idÃªnticas para permitir a comparaÃ§Ã£o, prevenindo distorÃ§Ãµes no cÃ¡lculo de faturamento e preÃ§os por unidade.
    *   Se as dosagens/quantidades forem validadas e o overlap de palavras for de pelo menos `0.6` (e com correspondÃªncia na primeira palavra da molÃ©cula), o sistema aceita a correspondÃªncia se a economia superar a `margemMinima`.
*   **Interface e CÃ³pia (Faturamento Externo):** Itens direcionados para fornecedores externos aparecem agrupados em blocs destacados na cor esmeralda (verde) com uma tag "WHATSAPP". Em vez de enviar pela API (CORS/vÃ­nculo), a interface disponibiliza o botÃ£o "Copiar Pedido (WhatsApp)", gerando uma mensagem perfeitamente formatada e amigÃ¡vel (em formato de lista de texto) copiada para a Ã¡rea de transferÃªncia do usuÃ¡rio, permitindo o envio instantÃ¢neo via chat.

### 4.7. Resolução de Nomes de Distribuidoras (Crítico para UI)

**Problema:** A API SmartPed **não garante** que o campo `NomeDist` venha no objeto individual de cada oferta (`Condicoes[]`, `Substitutos[]`). O nome vem separado em:
1. Array `dists[]` (ou `Dists[]`) na raiz de `Retorno` — cada item tem `CodDist` + `NomeDist`
2. Endpoint cadastral `/api/Condicoes/Distribuidores` — retorna lista completa `Codigo` + `Nome`
3. Campos variados dependendo do endpoint: `NomeDistribuidora` (Ofertas), `Nome_Dpe` (Sugestoes), `Nome` (Distribuidores)

**Solução arquitetural (server.ts):**
- `DISTRIBUIDORAS_DYNAMIC_CACHE: Record<number, string>` — cache em memória inicializado com 40+ distribuidoras conhecidas no startup
- `loadDistribuidoresFromAPI()` — chamado no startup; consome `/api/Condicoes/Distribuidores` e popula o cache
- `enrichDistribuidoresFromPayload(payload)` — extrai `payload.Retorno.dists[]` de **qualquer** resposta SmartPed e atualiza o cache em tempo real
- `resolveDistName(obj, codDist)` — resolver centralizado (linha ~40):
  ```typescript
  return (
    obj?.NomeDist || obj?.nomeDist ||           // Maioria dos endpoints
    obj?.NomeDistribuidora ||                   // Condicoes/Ofertas
    obj?.Nome_Dpe ||                            // Condicoes/Sugestoes
    obj?.Nome ||                                // Condicoes/Distribuidores
    (code && DISTRIBUIDORAS_DYNAMIC_CACHE[code]) ||  // Cache dinâmico (primário)
    (code && DISTRIBUIDORAS_MAP[code]) ||       // Mapa estático (fallback final)
    (code ? `Distribuidor ${code}` : "Distribuidor")
  );
  ```
- **Substituídos 8+ pontos** de parsing manual por `resolveDistName()` (linhas ~895, 1211, 1741, 2124, 2168, 4242, 4746, 4819, 4875)
- **Erro crítico corrigido:** Linha 2124 lia `melhor.NomeDist` direto do objeto bruto do `findBestSubstitute` (que não tem esse campo). Corrigido para `resolveDistName(melhor, codDist)`.

**Frontend (ConditionSelector.tsx):**
- Recebe `item.distribuidora` **já resolvido** do backend — não faz busca própria
- Dropdown usa `alt.distribuidora` diretamente (linhas 269, 288)
- **Não busca em tempo real** se `item.alternatives.length > 0` (linha 44: removido `&& !isRuptura`)
- Em ruptura, backend envia **TODAS** as alternativas (sem filtro de EAN original + escolhido) — filtro só aplica quando `originalHasStock === true` (server.ts:1995-2001)

**Mapa estático (server/distributors.ts):** Corrigido alinhamento off-by-one (5↔6, 34↔59, 37↔60) + adicionados códigos faltantes (503=GCMEDICAMENTOS, 81=CervoSul, 624=SMARTDISTRIBUIDORA, etc.). Usado apenas como **último fallback** quando API falha completamente.
*   **Controle de Datas FlexÃ­vel (HistÃ³rico por PerÃ­odo):** O endpoint aceita parÃ¢metros adicionais e opcionais `dataInicio` e `dataFim` (formatos ISO `YYYY-MM-DD`). A funÃ§Ã£o utilitÃ¡ria `formatToSmartpedDate` converte o formato de data do padrÃ£o web para o padrÃ£o exigido pelo SGF/Smartped (`DD/MM/YYYY`), possibilitando a pesquisa por qualquer intervalo de dias sem limitaÃ§Ã£o ao dia corrente.
*   **Mapeamento Unificado de Status de Itens:** Para cada pedido do lote retornado, o backend captura os detalhes dos produtos e distribuidores parceiros, categorizando-os estruturalmente:
    *   **Faturado (Confirmado):** Itens cujo distribuidor finalizou o faturamento com sucesso (`Status === 3`) e que possuem `QuantFaturada > 0`.
    *   **NÃ£o Confirmado (Falta):** Itens que nÃ£o tiveram faturamento com nenhum fornecedor (`QuantFaturada === 0`), cortes totais ou de distribuidores que rejeitaram os itens do lote.
*   **Mecanismo de Pesquisa Textual e Abas Interativas no Frontend:** O componente de visualizaÃ§Ã£o permite ao usuÃ¡rio alterar o intervalo de datas da busca e, na renderizaÃ§Ã£o local, aplicar filtros instantÃ¢neos baseados em:
    *   *Pesquisa RÃ¡pida:* Filtragem dinÃ¢mica de texto por nome do produto, EAN ou nome do distribuidor.
    *   *Abas com Contadores DinÃ¢micos:* Abas dedicadas ("Todos", "Faturados", "NÃ£o Confirmados") com cÃ¡lculo reativo em tempo real dos totais de registros em cada categoria, facilitando a identificaÃ§Ã£o imediata das faltas e cortes parciais da triagem.
*   **Assistente de RedistribuiÃ§Ã£o Comercial de Faltas:** Na aba de "NÃ£o Confirmados", os itens possuem checkboxes de seleÃ§Ã£o em lote (com atalho para selecionar todos os visÃ­veis). Ao disparar a redistribuiÃ§Ã£o:
    *   *Pesquisa Comercial Ativa:* O frontend efetua consultas de alternativas em tempo real para os EANs selecionados atravÃ©s do endpoint `/api/search-products`. No backend, para queries numÃ©ricas (EANs), o sistema realiza chamadas paralelas de alta performance aos endpoints `Condicoes/Ean` e `Condicoes/Molecula` da SmartPed. Isso possibilita recuperar e unificar de forma consolidada (e livre de duplicatas) tanto as condiÃ§Ãµes comerciais exatas do produto quanto todas as ofertas de substitutos genÃ©ricos e similares disponÃ­veis no mercado.
    *   *Filtro Anti-RepetiÃ§Ã£o Inteligente:* O sistema filtra as alternativas de modo a ignorar a distribuidora original que cortou/rejeitou o item e distribuidores sem estoque, priorizando e autoselecionando o distribuidor ativo com o menor preÃ§o comercial de reposiÃ§Ã£o.
    *   *InjeÃ§Ã£o de Lote no Otimizador (Remontagem da Tela):* AtravÃ©s de um painel interativo de revisÃ£o, o usuÃ¡rio confirma os novos distribuidores de destino. Ao clicar em confirmar, o assistente monta um relatÃ³rio virtual de substituiÃ§Ã£o (`SwapReportItem[]`) e um arquivo SICF virtual com os itens, injetando-os diretamente no estado global do Otimizador (`App.tsx`). A tela Ã© redirecionada automaticamente para a aba do Otimizador com todos os itens prÃ©-carregados e marcados como selecionados, permitindo que o usuÃ¡rio altere quantidades, revise os pedidos e fature ou baixe o arquivo SICF normalmente na interface principal.

### 4.7. Alerta Visual de Valores Totais Elevados (PrevenÃ§Ã£o de Erros de Fracionamento)
*   **Problema de Fracionados:** No mercado farmacÃªutico, divergÃªncias de conversÃ£o de embalagens ou erros de digitaÃ§Ã£o de quantidades podem gerar faturamentos acidentais gigantescos (valores de lote inflados por falhas de proporÃ§Ã£o de unidades).
*   **Mecanismo de Alerta Visual Piscante:** O sistema possui um sinalizador visual na tabela de resultados do Otimizador (`SwapsTable.tsx`). Qualquer item cujo valor total ativo (`item.novoPreco * item.qtd`) supere um determinado patamar monetÃ¡rio passarÃ¡ a piscar ativamente com uma animaÃ§Ã£o elegante e sutil de fundo (`.animate-blink` em `index.css`), alternando o preenchimento de fundo da cÃ©lula em tons suaves de vermelho/rosa e exibindo as mensagens chamativas `âš ï¸ ALERTA:` e `Confirmar Qtd!`.
*   **Threshold de Alerta PersonalizÃ¡vel pelo UsuÃ¡rio:** Na barra de controles e filtros da tabela de pedidos ativos por distribuidora, o comprador dispÃµe de um widget interativo com um farol pulsante e um input numÃ©rico (`ALERTA TOTAL > R$`).
    *   *Valor PadrÃ£o:* Inicializado em **R$ 100,00** para capturar e sinalizar ativamente qualquer item relevante com valor total elevado.
    *   *PersistÃªncia de PreferÃªncias:* Sempre que o usuÃ¡rio altera o valor limite, a preferÃªncia Ã© salva e re-lida automaticamente no `localStorage` do navegador do usuÃ¡rio, persistindo mesmo apÃ³s reloads.

*   **Mecanismo de SeguranÃ§a e Controle de Acesso (Painel Administrador):**
    *   *Fluxo de AutenticaÃ§Ã£o:* A aplicaÃ§Ã£o possui um fluxo de login obrigatÃ³rio implementado no frontend (`src/App.tsx`) que intercepta toda a renderizaÃ§Ã£o se o usuÃ¡rio nÃ£o estiver autenticado.
    *   *Credenciais Administrativas Fixadas:*
        *   **E-mail:** `ckipper22@gmail.com`
        *   **Senha:** `Aq1sw2de#fr4`
    *   *PersistÃªncia da SessÃ£o:* A sessÃ£o autenticada Ã© guardada sob a chave `app_authenticated` no `localStorage` do navegador.
    *   *Controle de SessÃ£o (Logout):* Um botÃ£o funcional de "Sair" (ðŸšª Sair) foi integrado no cabeÃ§alho superior do painel, permitindo a desconexÃ£o manual e limpeza das credenciais com um Ãºnico clique.

### 4.8. Cache Global de MÃ­nimos e PadronizaÃ§Ã£o de Leitura Comercial (Backend & Frontend)
*   **âš ï¸ REGRA CRÃTICA: QtdMin exige AMBOS os endpoints em paralelo (Bug 2026-08-14):** O `QtdMin` (quantidade mÃ­nima promocional) vem **principalmente do endpoint `Condicoes/Molecula`**, nÃ£o do `Condicoes/Ean`. Qualquer cÃ³digo que busque condiÃ§Ãµes por EAN **DEVE chamar AMBOS em `Promise.all`**. Chamar apenas `Condicoes/Ean` resulta em QtdMin=0 para a maioria das ofertas. AlÃ©m disso, `Condicoes/Ean` **exige o parÃ¢metro `AceitaOntem: 1`** para incluir promoÃ§Ãµes do dia anterior. PadrÃ£o obrigatÃ³rio implementado em: `/api/search-products` (path de descriÃ§Ã£o) e `/api/smartped-find-substitutes` (ExpansÃ£o HÃ­brida). Cache de 5 minutos em ambos para estabilizar.
*   **Cache Global em MemÃ³ria (`MINIMOS_GLOBAL_CACHE` em `server.ts`):** 
    *   Como os endpoints da SmartPed possuem formatos heterogÃªneos (`/api/Condicoes/Ean` e `/api/Condicoes/Molecula` retornam o array `minimos`, enquanto `/api/Produtos/Buscar` retorna apenas um array plano de produtos), o backend mantÃ©m um cache centralizado na memÃ³ria de todos os parÃ¢metros de faturamento mÃ­nimo (`CodDist`, `Condicao`, `Prazo`, `VlrMinimo`, `QtdMinima`).
    *   Sempre que qualquer requisiÃ§Ã£o traz o array `minimos`, a funÃ§Ã£o `updateMinimosCache(minimos)` atualiza ou adiciona essas regras no cache global.
    *   Nas buscas por texto/descriÃ§Ã£o (`/api/smartped-find-substitutes` e `/api/search-products`), o backend enriquece proativamente cada item antes de responder ao cliente, injetando `VlrMinimo` e `pedidoMinimo` calculados via `getMinimoFromCache(codDist, condicao, prazo)`.
*   **Helpers Universais de Propriedades no Frontend (`src/utils.ts`):**
    *   `resolveEstoque(item)`: Normaliza todas as variaÃ§Ãµes de nomes (`Estoque`, `estoque`, `estoque_idi`, `Estoque_idi`).
    *   `resolveQtdMinima(item)`: Normaliza quantidades mÃ­nimas por item (`QtdMin`, `qtdMin`, `QtdMinima`, `qtdMinima`, `Combo.QtdMin`).
    *   `resolvePedidoMinimo(item, minimosArray)`: Normaliza e resolve o valor de faturamento mÃ­nimo da distribuidora (`VlrMinimo`, `vlrMinimo`, `pedidoMinimo`), realizando matching determinÃ­stico de primeiro nÃ­vel por `CodDist + Condicao + Prazo`, segundo nÃ­vel por `CodDist + Prazo`, terceiro por `CodDist + Condicao` e quarto por `CodDist`.

### 4.8. Importador de Payload de Faturamento JSON / Logs de Pedido (UploadBox)
*   **Facilidade de Carga de Massa de Dados:** Adicionamos uma ferramenta e botÃ£o de aÃ§Ã£o permanente ("Importar Payload / JSON") no cabeÃ§alho do `UploadBox.tsx` para carregar conjuntos de dados massivos em segundos.
*   **Parser de JSON Recursivo Inteligente:** O parser analisa o texto colado e localiza recursivamente qualquer array que contenha objetos com propriedades de EAN (independentemente de estarem sob chaves como `Itens`, `itens` ou direto na raiz do JSON), detectando tambÃ©m opcionalmente o CNPJ do cliente associado (`CnpjCLi`).
*   **Extrator Inteligente via Regex de ContingÃªncia:** Caso o texto colado nÃ£o seja um JSON vÃ¡lido (por exemplo, logs contendo apenas trechos de mensagens), o sistema varre o texto utilizando expressÃµes regulares avanÃ§adas para capturar cÃ³digos EAN de 13 dÃ­gitos e quantidades, garantindo que atÃ© colagens informais sejam interpretadas com precisÃ£o.
*   **GeraÃ§Ã£o de Lote de Faturamento (SICF Virtual):** O importador converte os EANs e quantidades em linhas de dados no padrÃ£o S.I.C.F e preenche automaticamente o cabeÃ§alho (`1;CNPJ;`) e rodapÃ© (`9;1;`). Ao processar, o arquivo virtual Ã© carregado no estado principal do Otimizador (`App.tsx`) como se o arquivo original do ERP Trier tivesse sido selecionado, permitindo disparar a otimizaÃ§Ã£o em lote na API real da SmartPed em apenas um clique e sem necessidade de digitaÃ§Ã£o manual!

### 4.9. BotÃ£o Flutuante de Busca nos Pedidos e Card Interativo (SwapsTable)
*   **Melhoria de Usabilidade e Acessibilidade:** O sistema conta com um botÃ£o flutuante de busca posicionado estrategicamente no canto inferior direito (`bottom-28`), empilhado de forma harmÃ´nica logo acima do botÃ£o de adiÃ§Ã£o manual (`bottom-8`).
*   **Card de Busca Draggable (Neo-Brutalismo):** Ao clicar no botÃ£o flutuante, a interface exibe um card interativo de busca com visual neo-brutalista de alto contraste (bordas grossas e sombra sÃ³lida de deslocamento). O card possui suporte completo Ã  movimentaÃ§Ã£o via drag (arrastar e soltar) na tela, permitindo que o comprador ajuste sua posiÃ§Ã£o livremente para ler as tabelas por trÃ¡s enquanto filtra os itens.
*   **IntegraÃ§Ã£o com o DiagnÃ³stico de EANs:** O card flutuante exibe a contagem dinÃ¢mica de resultados correspondentes e conta com um botÃ£o rÃ¡pido que injeta o termo buscado diretamente no Rastreador de DiagnÃ³stico de EANs do lote inteiro em um Ãºnico clique.

### 4.10. Motor de Agrupamento DinÃ¢mico de Equivalentes (Cross-Reference / PrevenÃ§Ã£o de "VisÃ£o em TÃºnel")
*   **Problema de VisÃ£o em TÃºnel Mitigado:** Anteriormente, se o EAN de um produto original (ex: Pantoprazol Eurofarma) estivesse sem estoque na distribuidora, o sistema nÃ£o sugeria equivalentes de grandes laboratÃ³rios concorrentes (ex: AchÃ©, Sandoz, Medley) porque o Otimizador realizava a consulta individual restrita apenas Ã quele EAN na SmartPed, resultando em "visÃ£o em tÃºnel".
*   **Banco de Equivalentes Local e de Mercado:** No backend (`server.ts`), foi introduzido um dicionÃ¡rio estÃ¡tico de equivalentes de mercado (`LOCAL_EQUIVALENTS_DB`) estruturado por PrincÃ­pio Ativo + Dosagem + ApresentaÃ§Ã£o (ex: "PANTOPRAZOL 20MG 28CP", "DAPAGLIFLOZINA 10MG 30CP", etc.) acoplado a um gerador inteligente de similares de mercado em tempo real.
*   **FlexibilizaÃ§Ã£o do `getLocalEquivalents` por InterseÃ§Ã£o de Palavras-Chave:** Em vez de comparaÃ§Ãµes textuais estritas e parciais que travavam em variaÃ§Ãµes sutis, a lÃ³gica agora normaliza os textos e decompÃµe em tokens, aplicando um filtro sofisticado que descarta conectores e variaÃ§Ãµes de sais farmacÃªuticos (como `SÃ“DICO`, `SÃ“DICA`, `SODICO`, `SODICA`, `CLORIDRATO`, `MALEATO`, `MESILATO`, `HEMITARTARATO`, `TARTARATO`, `POTÃSSICO`, `POTASSICO`, `SULFATO`, `ZÃNCICO`, `ZINCICO`, `CÃLCICO`, `CALCICO`, `MONOHIDRATADO`, `MONOIDRATADO`). O casamento se dÃ¡ por interseÃ§Ã£o lÃ³gica: se todas as palavras principais identificadas de molÃ©cula e dosagem corresponderem com os termos indexados de alguma chave do dicionÃ¡rio estÃ¡tico, o match Ã© estabelecido perfeitamente.
*   **GeraÃ§Ã£o Ampliada de Lotes de CotaÃ§Ã£o (`eansToQuote`):** Antes de realizar as consultas em lote na SmartPed, o sistema analisa os EANs originais do pedido e gera uma lista ampliada e enriquecida (`eansToQuote`) contendo o prÃ³prio EAN original, todos os seus equivalentes locais correspondentes e todos os similares de mercado retornados pela API concorrente (Ferramentinhas).
*   **Mecanismo de Fallback Concorrente por Busca Textual (PrincÃ­pio Ativo) no Lote:** Caso um produto do lote original termine sua cotaÃ§Ã£o por EANs/equivalentes prÃ©-calculados sem ofertas ou estoques ativos na SmartPed, o backend dispara autonomamente uma pesquisa textual em tempo real. Essa chamada consome paralelamente a API Ferramentinhas (para resolver o cÃ³digo DCB exato do EAN original) e as rotas de busca de molÃ©cula/produto da SmartPed de forma assÃ­ncrona concorrente (`Promise.all`). As novas ofertas e EANs reais descobertos de mercado sÃ£o injetados dinamicamente no lote e barramento de ofertas (`apiResponses`) e associados como similares vÃ¡lidos do item antes de passar pelo motor analÃ­tico de economia/trocas.
*   **UnificaÃ§Ã£o de Respostas de CotaÃ§Ãµes:** Ao processar o retorno de cotaÃ§Ã£o de cada item original do pedido, o sistema consolida, mescla e unifica as ofertas de todos os EANs equivalentes daquela mesma molÃ©cula em um Ãºnico barramento (`apiResponses`). Se o `ItemPedido` de um concorrente de mercado retornar preÃ§o e estoque ativo na SmartPed, ele Ã© automaticamente transformado em uma alternativa de troca de alto desempenho para o usuÃ¡rio.
*   **ResoluÃ§Ã£o Inteligente:** Garante que o motor de busca consulte e traga dinamicamente todas as ofertas possÃ­veis e os estoques de medicamentos intercambiÃ¡veis de todos os laboratÃ³rios nas distribuidoras reais da SmartPed para suprir faltas sem que o comprador precise saber os EANs dos concorrentes.

### 4.11. Sistema AutomÃ¡tico de Alertas de Duplicidade Profarma (Ãšltimos 2 Dias Ãšteis)
*   **DetecÃ§Ã£o AutomÃ¡tica Sem NavegaÃ§Ã£o Manual:** Para evitar que o usuÃ¡rio precise alternar abas para carregar o histÃ³rico de pedidos recentes antes de visualizar o lote otimizado, o sistema aciona de forma transparente a sincronizaÃ§Ã£o de dados de faturamento do canal Smartped (chamando o endpoint `/api/pedidos-do-dia`) em dois pontos estratÃ©gicos:
    1.  **Na seleÃ§Ã£o do arquivo:** Assim que o comprador faz upload ou carrega o arquivo SICF (no `handleFileLoaded`), a busca em segundo plano Ã© disparada utilizando o CNPJ detectado e o token configurado.
    2.  **No processamento de otimizaÃ§Ã£o:** Na inicializaÃ§Ã£o da otimizaÃ§Ã£o real (`handleOptimize`), o sistema aguarda a resposta da API de pedidos recentes para garantir que os alertas estejam 100% atualizados antes de renderizar a SwapsTable.
*   **CÃ¡lculo Preciso de Ãšltimos 2 Dias Ãšteis (Imunidade de Finais de Semana):** Para que compras realizadas Ã s quintas, sextas ou finais de semana nÃ£o sejam desconsideradas nas otimizaÃ§Ãµes de segundas-feiras devido a janelas fixas de 48 horas de calendÃ¡rio, o sistema calcula dinamicamente as datas retroativas que correspondam estritamente a **2 dias Ãºteis**. O algoritmo de cÃ¡lculo retrocede atÃ© encontrar o limite de dias nÃ£o-finais de semana (sÃ¡bado/domingo), gerando um Set de correspondÃªncia confiÃ¡vel (ex: na segunda-feira, a verificaÃ§Ã£o abrangerÃ¡ as ordens de hoje, domingo, sÃ¡bado e sexta-feira).
*   **Sinalizadores e AÃ§Ã£o na Tabela de Trocas:** Se um medicamento de destino do swap (novo EAN) ou o prÃ³prio produto original jÃ¡ constar como enviado e faturado na distribuidora Profarma (CÃ³digo de Distribuidor 4) dentro da janela calculada, um banner chamativo na linha da tabela adverte sobre o faturamento duplicado recente. O comprador dispÃµe de aÃ§Ãµes instantÃ¢neas de "Manter" ou "Excluir" o item do lote ativo para evitar compras redundantes.

### 4.12. PreparaÃ§Ã£o de Infraestrutura e Deploy Prontos para Cloud Run
*   **Porta do Servidor DinÃ¢mica:** O Express em `server.ts` estÃ¡ configurado para ler dinamicamente a variÃ¡vel de ambiente `PORT` provida no container do Cloud Run. Caso indisponÃ­vel (como em produÃ§Ã£o local), o fallback assume o padrÃ£o `8080`, e em ambiente local do AI Studio assume `3000`, escutando na interface de rede universal `0.0.0.0` para conformidade estrita de ingress do GCP.
*   **Ambiente de ProduÃ§Ã£o e Arquivos EstÃ¡ticos:** Em tempo de execuÃ§Ã£o em produÃ§Ã£o (`NODE_ENV === "production"`), o servidor desliga o middleware do Vite e serve estaticamente os arquivos prontos do frontend compilados na pasta `/dist`. NÃ£o hÃ¡ dependÃªncia de dependÃªncias de desenvolvimento ou transpiladores na nuvem.
*   **ConfiguraÃ§Ã£o do Empacotamento via Esbuild:** No `package.json`, o script `npm run build` faz o bundle unificado do frontend (`vite build`) e tambÃ©m transpila e empacota o backend TypeScript `server.ts` em um Ãºnico arquivo CommonJS executÃ¡vel e independente (`dist/server.cjs`), permitindo iniciar a aplicaÃ§Ã£o em produÃ§Ã£o com o comando nativo `node dist/server.cjs`.

### 4.12.1. DocumentaÃ§Ã£o de Deploy (DEPLOY.md)
*   **Arquivo:** `DEPLOY.md` na raiz do projeto.
*   **ConteÃºdo:** InstruÃ§Ãµes completas e detalhadas para deploy da aplicaÃ§Ã£o no **Google Cloud Run** utilizando o plano gratuito. Inclui: prÃ©-requisitos, instalaÃ§Ã£o do Google Cloud CLI, configuraÃ§Ã£o de projeto e billing, comandos de deploy (mÃ©todo direto e com Dockerfile), configuraÃ§Ã£o de variÃ¡veis de ambiente, persistÃªncia de dados (SQLite em `/tmp`), comandos Ãºteis para monitoramento, informaÃ§Ãµes sobre o free tier do GCP e soluÃ§Ã£o de problemas comuns.
*   **Referenciado em:** `README.md` (seÃ§Ã£o "Deploy" e link direto para o arquivo).

### 4.12.2. Estado Atual do Deploy Cloud Run (2026-08-15)
*   **ServiÃ§o Ativo:** `smartped-cli` no projeto GCP `gen-lang-client-0702342051`, regiÃ£o `us-east1`.
*   **URL:** `https://smartped-cli-887122622666.us-east1.run.app`
*   **ConfiguraÃ§Ã£o:** `NODE_ENV=production`, `DISABLE_SQLITE=true`, memÃ³ria 1Gi, timeout 300s.
*   **Dockerfile:** Single-stage build com `node:20` (nÃ£o `-slim`), `npm rebuild better-sqlite3` para forÃ§ar compilaÃ§Ã£o nativa.
*   **Problema Resolvido:** O `better-sqlite3` causava SIGSEGV (signal 11) no Cloud Run. SoluÃ§Ã£o: desabilitar SQLite via `DISABLE_SQLITE=true` e usar apenas cache L1 (Map em memÃ³ria).
*   **DeduplicaÃ§Ã£o Corrigida:** Chave de deduplicaÃ§Ã£o em `/api/search-products` alterada de `${Ean}_${CodDist}_${Condicao}_${Pliquido}_${Prazo}` para `${Ean}_${CodDist}_${Condicao}_${Prazo}` (sem preÃ§o), conforme documentaÃ§Ã£o.
*   **OrdenaÃ§Ã£o:** Resultados ordenados por `precoLiquido` ascendente. FunÃ§Ã£o `resolvePrecoLiquido` em `src/utils.ts` atualizada para reconhecer campo `precoLiquido` alÃ©m de `Pliquido`/`pliquido`.

### 4.12.3. RegressÃ£o de DeduplicaÃ§Ã£o (Bug HistÃ³rico - 2026-08-15)
*   **Problema:** A chave de deduplicaÃ§Ã£o em `/api/search-products` incluÃ­a o preÃ§o (`Pliquido`), causando ofertas duplicadas para o mesmo EAN/Distribuidor/CondiÃ§Ã£o/Prazo com preÃ§os diferentes.
*   **Causa Raiz:** A versÃ£o anterior ao SQLite (`89b85d2`) jÃ¡ tinha esse bug. Quando o SQLite foi adicionado (`eba2f98`), o bug foi perpetuado. O bug nÃ£o foi percebido porque os testes nÃ£o cobriram produtos com mÃºltiplos preÃ§os para o mesmo distribuidor/condiÃ§Ã£o.
*   **CorreÃ§Ã£o:** Chave alterada para `${Ean}_${CodDist}_${Condicao}_${Prazo}` (sem preÃ§o). Em caso de duplicata, mantÃ©m a oferta de menor preÃ§o lÃ­quido.
*   **Arquivos Afetados:** `server.ts` (linhas ~3095-3113 e ~3454-3479).
*   **ReferÃªncia:** SeÃ§Ã£o 7.7 do LLM_CONTEXT.md (DeduplicaÃ§Ã£o por Chave Combinada).

### 4.13. Blindagem de Faturamento Seguro de Lote Ãšnico (SmartPed Envio)
*   **ValidaÃ§Ã£o Estrita de Swaps:** Se um item original sofreu substituiÃ§Ã£o (swap) por um equivalente, o sistema valida se os cÃ³digos identificadores (`codProduto` e `codProdutoDist`) sÃ£o vÃ¡lidos (nÃ£o vazios, nÃ£o nulos, nÃ£o strings `"null"` ou `"undefined"`, e estritamente diferentes de `"0"` ou `0`). Se for invÃ¡lido, ele Ã© omitido do lote para evitar faturamentos incorretos na distribuidora.
*   **Expurgo de Itens sem Distribuidora / Sem Estoque:** Qualquer item com cÃ³digo de distribuidora zerado (`codDist === 0` ou `originalCodDist === 0`), sem estoque, nÃ£o encontrado ou com nome de distribuidora vazio Ã© sumariamente bloqueado e expurgado antes da montagem final do JSON do payload para a SmartPed.
*   **ConsolidaÃ§Ã£o de Lote Ãšnico:** O backend unifica todos os itens faturÃ¡veis de todas as distribuidoras em uma Ãºnica chamada POST para `/api/Pedido/Envio` da SmartPed, impedindo disparos em paralelo por distribuidora de forma separada que causariam o erro `"JÃ¡ existe um envio pendente"`.

### 4.14. Painel de RevisÃ£o Otimizada de Alertas e Usabilidade UX (SwapsTable)
*   **Filtro DinÃ¢mico de Alertas/PendÃªncias com ExpansÃ£o AutomÃ¡tica:** AdiÃ§Ã£o do filtro interativo `Apenas Alertas/PendÃªncias` que oculta todos os itens normais do lote de cotaÃ§Ã£o e destaca na tela de revisÃ£o apenas as anomalias que exigem validaÃ§Ã£o do comprador. Quando ativado, o sistema **expande automaticamente todos os grupos/distribuidores que contÃªm itens com alerta**, poupando dezenas de cliques manuais. Ao desativÃ¡-lo, o layout volta ao modelo normal compacto. As regras de engajamento do filtro de alertas sÃ£o:
    1.  Produtos com observaÃ§Ãµes ou anotaÃ§Ãµes personalizadas do sistema ou do usuÃ¡rio (`observacao`).
    2.  Medicamentos que nÃ£o atingiram a quantidade mÃ­nima comercial exigida pelo fornecedor (`qtdMin`).
    3.  Medicamentos que excederam o limite mÃ¡ximo parametrizado (`qtdMax`).
    4.  Lotes cuja quantidade informada nÃ£o seja mÃºltiplo da caixa fechada (`cx`).
    5.  OtimizaÃ§Ãµes (trocas) em que o preÃ§o do substituto acabou superando o preÃ§o do original (preÃ§o aumentado).
    6.  Itens alocados em distribuidoras virtuais ou sem ofertas ativas (*NÃ£o Encontrados* ou *Sem Estoque*).
    7.  Distribuidoras ou grupos cujas somatÃ³rias financeiras de itens ativos do lote ainda nÃ£o ultrapassaram ou atingiram o valor mÃ­nimo de faturamento estabelecido.
    8.  Itens com o estado de falta absoluta (`originalSemEstoque` marcado como ativo).
*   **Barra de Controle de Grupo ("Recolher e Ir para o PrÃ³ximo"):** Embaixo de cada tabela de distribuidora expandida, hÃ¡ uma barra de controle de revisÃ£o contendo o botÃ£o "Recolher e Ir para o PrÃ³ximo". Ao clicar, o distribuidor que acaba de ser revisado Ã© minimizado individualmente, e a tela realiza um scroll suave focalizando a cabeceira da prÃ³xima distribuidora pendente na ordem. Isso evita a necessidade de scrollar manualmente de volta ao topo de tabelas longas para fechar o distribuidor.
*   **VisualizaÃ§Ã£o de EAN de Original em Falta:** Quando um item original possui falta absoluta de estoque (`originalSemEstoque`), o painel de revisÃ£o exibe de forma destacada em vermelho brilhante o cÃ³digo de barras (EAN) original que faltou, acompanhado de um atalho visual (`EanEyeButton`) para consulta rÃ¡pida.
*   **Comparador DinÃ¢mico de PreÃ§o Benchmark:** O backend agora calcula dinamicamente o maior valor entre o preÃ§o histÃ³rico de compra importado no arquivo e o melhor preÃ§o de oferta real cotado hoje no mercado para o EAN original. Esse benchmark protege o algoritmo contra falsas economias baixas causadas por defasagem histÃ³rica, garantindo que o sistema recomende sempre a alternativa de menor preÃ§o de mercado e evite perdas financeiras.
*   **Achatamento Estrutural e PropagaÃ§Ã£o Estrita de Propriedades na Raiz:** Em vez de depender de varreduras reversas complexas ou buscas paralelas no banco Trier/`EAN_DATABASE` para resolver nomes de medicamentos equivalentes, o sistema realiza agora o achatamento estrito do JSON de cotaÃ§Ãµes na raiz (`server.ts` nos pontos de ingestÃ£o das cotaÃ§Ãµes da SmartPed e na rotina `processReturnItens`). Cada filho (`Condicoes`) herda por heranÃ§a direta as propriedades ricas de seu pai (`ItemPedido` / `Substitutos`), especificamente `Ean`, `Descricao` e `Laboratorio`, lendo-as de forma agnÃ³stica a maiÃºsculas e minÃºsculas (PascalCase ou lowercase). Isso elimina de forma limpa a exibiÃ§Ã£o de `"Medicamento Equivalente (EAN: ...)"` e garante dados completos e blindados tanto na UI quanto nas exportaÃ§Ãµes.
*   **InteligÃªncia Ativa de ReversÃ£o no "Manter Original":** O botÃ£o "Manter Original" foi blindado contra rupturas de estoque na distribuidora importada. Em vez de reverter o item de forma cega para a distribuidora original que pode estar sem saldo, o sistema pesquisa dinamicamente e resolve o item original para uma distribuidora ativa de mercado que de fato possua estoque real disponÃ­vel hoje. Essa escolha stock-resolved reflete-se perfeitamente nas tabelas de revisÃ£o, nos payloads de faturamento enviados para a SmartPed e nas planilhas faturadas de exportaÃ§Ã£o.

*   **Atalhos Flutuantes de Alta Performance:**
    *   *BotÃ£o Recolher Tudo:* Um botÃ£o flutuante pragmÃ¡tico (`FolderMinus`) que aparece dinamicamente sempre que houver lotes/distribuidoras abertos de forma expandida na tela. Com um Ãºnico clique, minimiza todas de uma sÃ³ vez e rola a janela suavemente de volta para o topo do painel de escolhas.
    *   *BotÃ£o Scroll to Top:* Um atalho redondo fixado no canto inferior direito que rola suavemente a tela para o topo absoluto do aplicativo, poupando a rolagem mecÃ¢nica manual em pedidos gigantescos.

### 4.15. Tratamento de InconsistÃªncia e NormalizaÃ§Ã£o Estrita de EANs (Zeros Ã  Esquerda - Alcon / BD / Abbott)
*   **A InconsistÃªncia da API:** Nos endpoints `RetornoCondicao` e `RetornoPedido`, a SmartPed retorna os EANs como String (ex: `"7896241225547"`). Entretanto, no endpoint `BuscaComparativa` (CotaÃ§Ã£o Individual/Similares), os EANs sÃ£o retornados como **NÃºmero Inteiro Puro** (ex: `300652439266`).
*   **O Impacto nos Zeros Ã  Esquerda:** Produtos importados ou especÃ­ficos de laboratÃ³rios como Alcon (ex: Systane Ultra 10ml, EAN `0300652439266`), BD ou Abbott que iniciam com o dÃ­gito zero tinham o zero Ã  esquerda removido na desserializaÃ§Ã£o numÃ©rica da API (truncando para `300652439266`, com 12 dÃ­gitos), gerando falha total de cruzamento de dados contra o ERP local (Trier) ou bancos de dados locais que registram as strings completas com 13 dÃ­gitos (`"0300652439266"`).
*   **A SoluÃ§Ã£o de NormalizaÃ§Ã£o de EAN (Barramento Unificado):** Unificamos todas as rotinas de limpeza e normalizaÃ§Ã£o (`cleanEan`, `cleanEanLocal` e `cleanEanString`) do frontend e backend para adotar uma lÃ³gica estrita baseada em `padStart`:
    ```typescript
    function cleanEan(ean: string | number | undefined | null): string {
      if (ean === undefined || ean === null) return "";
      const cleaned = String(ean).trim().replace(/\D/g, "");
      if (!cleaned) return "";
      if (cleaned.length <= 13) {
        return cleaned.padStart(13, "0");
      }
      return cleaned;
    }
    ```
    Isso assegura que qualquer EAN numÃ©rico ou string com menos de 13 dÃ­gitos receba zeros Ã  esquerda de forma precisa, eliminando conflitos de cruzamento e garantindo o correto faturamento de medicamentos importados com zero Ã  esquerda.

### 4.16. CorreÃ§Ãµes de LÃ³gica Financeira (Benchmark), Filtro de Similares e UX de NavegaÃ§Ã£o
*   **A "Regra de Ouro" de PreÃ§o Benchmark (`findBestSubstitute`):**
    O cÃ¡lculo do PreÃ§o Benchmark (`precoBenchmark`) foi blindado contra falsas sugestÃµes de economia. 
    * Se o produto original possui oferta ativa com estoque no mercado hoje, o benchmark passa a ser o **menor preÃ§o real de mercado ativo encontrado para o original**, garantindo que a sugestÃ£o de substituto seja vantajosa somente se for mais barata que a realidade imediata de compra do original.
    * Se o original estÃ¡ em ruptura absoluta (estoque zero em todas as distribuidoras), o benchmark recua com seguranÃ§a para o preÃ§o histÃ³rico do ERP (cadastro de compra).
*   **Filtragem de Alternativas de Substitutos Ativas no Backend:**
    * No backend, na funÃ§Ã£o `findBestSubstitute`, as ofertas comerciais concorrentes (`candidatosSubstitutos`) sÃ£o filtradas estritamente para **remover qualquer alternativa cujo estoque na distribuidora seja menor ou igual a zero** (`estoque <= 0` ou `Estoque <= 0`) antes de qualquer cÃ¡lculo de menor custo ou de economia. Isso impede a recomendaÃ§Ã£o de trocas inviÃ¡veis por falta de estoque nas distribuidoras e elimina cortes desnecessÃ¡rios.
*   **Filtros no Modal de Similares (`SimilarProductsModal`):**
    * A lista local de produtos similares (`dataSimilares`) vinda da Trier nÃ£o Ã© filtrada pelo controle de estoque real de distribuidoras, jÃ¡ que este cadastro Ã© puramente cadastral local.
    * O filtro `apenasComEstoqueOuMinimo` foi isolado para atuar exclusivamente sobre a lista de alternativas em tempo real da SmartPed (`smartPedAlternatives`) sob o memo `alternativesToShow`.
    * A restriÃ§Ã£o do estoque mÃ­nimo foi revisada: itens com `qtdMin: 0` na SmartPed representam a ausÃªncia de mÃ­nimo (condiÃ§Ã£o excelente de compra) e sÃ£o mantidos na exibiÃ§Ã£o, nÃ£o sendo mais filtrados incorretamente.
    * **Filtragem de Similares Locais por Estoque FÃ­sico Real:** Corrigimos a lÃ³gica de exibiÃ§Ã£o dos similares locais (`produtosExibidos`) para checar **estritamente se hÃ¡ saldo fÃ­sico em estoque** (`estoque > 0`) sob as chaves de fallback do ERP Trier, eliminando o operador `|| minimo > 0` que ocultava indisponibilidades se o produto tivesse um mÃ­nimo cadastrado.
*   **Melhoria de UX de NavegaÃ§Ã£o por Distribuidoras (`SwapsTable`):**
    * Ao clicar no botÃ£o "Recolher e Ir para o PrÃ³ximo", o sistema forÃ§a a expansÃ£o (`isOpen = true`) da prÃ³xima distribuidora pendente na lista (`setExpandedGroups`) 100ms antes de disparar o scroll suave. Isso evita que o usuÃ¡rio seja direcionado a um painel recolhido/fechado de forma desorientadora.
*   **Enriquecimento de DescriÃ§Ãµes e Cobertura Dupla de EANs (Monitoramento):**
    * Adicionados os cadastros estÃ¡ticos para os EANs `7891142165770` (Macrodantina 100mg C/28 Caps) e `7896112127680` (Maleato de Dexclorfeniramina 0,4mg/ml XPE 100ml) diretamente na base de dados de ERP simulada (`src/utils.ts` em `SAMPLE_SICF_FILE` e `HOMOLOGACAO_SICF_FILE`), garantindo que o `EAN_DATABASE` resolva os nomes instantaneamente.
    * O resolvedor de descriÃ§Ãµes no backend (`fetchEanDescriptions` em `server.ts`) foi otimizado para possuir **dupla-cobertura**: os itens que nÃ£o sÃ£o encontrados pelo endpoint de molÃ©culas (`api/Condicoes/Molecula`) agora passam automaticamente por uma consulta secundÃ¡ria em lote no endpoint de cotaÃ§Ã£o direta por EAN (`api/Condicoes/Ean`). Isso assegura que 100% dos itens do faturamento recebam sua descriÃ§Ã£o comercial legÃ­tima de forma dinÃ¢mica pela API.

### 4.17. Itens Manuais (AdiÃ§Ã£o via BotÃ£o "+")
*   **Fluxo de AdiÃ§Ã£o:** Quando o usuÃ¡rio clica no botÃ£o "+" para adicionar um item manualmente, o sistema:
    1. Gera um `codInterno` Ãºnico (`MANUAL-{timestamp}-{random}`)
    2. Salva no localStorage (`itens_manuais_adicionados`) para acesso imediato
    3. Salva no Turso via endpoint `/api/salvar-item-manual` para persistÃªncia permanente
*   **PersistÃªncia Turso:** Tabela `itens_manuais` com campos: `cod_interno`, `ean`, `descricao`, `laboratorio`, `distribuidora`, `cod_dist`, `qtd`, `preco_liquido`, `preco_fabrica`, `condicao`, `prazo`, `cnpj`, `status`, `data_adicao`
*   **Aba "Itens Manuais" (DailyItemsView):** Mostra TODOS os itens digitados manualmente com status:
    *   **Faturado** (verde): Item manual que aparece na API SmartPed com status "faturado"
    *   **Falta** (vermelho): Item manual que aparece na API SmartPed com status "nao_confirmado"
    *   **NÃ£o Faturado** (cinza): Item manual que nÃ£o aparece na API (ainda nÃ£o processado)
*   **Endpoints:**
    *   `POST /api/salvar-item-manual` — Salva item manual no Turso
    *   `POST /api/itens-manuais` — Busca itens manuais do Turso por CNPJ e perÃ­odo
*   **Purge AutomÃ¡tica:** Dados com mais de 6 meses sÃ£o deletados automaticamente (a cada 24h)

### 4.18. Itens Confirmados (Retorno da SmartPed)
*   **Fluxo de Consulta:** O endpoint `/api/itens-confirmados-do-dia` consulta a API SmartPed para obter pedidos e seus retornos:
    1. Consulta Turso primeiro para itens jÃ¡ confirmados (cache local)
    2. Consulta API SmartPed (`Pedido/Listar` + `Pedido/Retorno`) para novos retornos
    3. Salva no Turso apenas itens com Status === 3 (faturados)
    4. Combina resultados (Turso + API) evitando duplicatas
*   **PersistÃªncia Turso:** Tabela `itens_confirmados` com campos: `num_pedido`, `ean`, `descricao`, `laboratorio`, `cod_dist`, `nome_dist`, `qtd_solicitada`, `qtd_faturada`, `preco_liquido`, `status`, `motivo`, `cnpj`, `data_confirmacao`
*   **UPSERT:** Atualiza se o status mudar (ex: item fica "nao_confirmado" e depois vira "faturado")
*   **Endpoints:**
    *   `POST /api/itens-confirmados-do-dia` — Consulta itens confirmados (Turso + API)

### 4.19. Purge AutomÃ¡tica de Dados (6 Meses)
*   **PropÃ³sito:** Evitar crescimento infinito do banco de dados e manter a performance
*   **Tabelas afetadas:** `orders`, `order_items`, `faturados`, `itens_confirmados`, `itens_manuais`
*   **FrequÃªncia:** A cada 24 horas (via `setInterval` em `startDbCachePurge`)
*   **CritÃ©rio:** Registros com `created_at` mais antigos que 6 meses
*   **FunÃ§Ã£o:** `purgeOldData()` em `server/database.ts`

### 4.20. Fluxo de Busca por Tipo de Item (Ruptura vs Sem Ruptura)

#### 4.20.1. DecisÃ£o: O item estÃ¡ em ruptura?

A decisÃ£o ocorre em `server.ts` (linha ~1367). O sistema verifica se o EAN original tem **qualquer oferta com estoque > 0** na SmartPed:

```
condicoesOriginal = [...condicoesRaw, ...substitutosRaw]
  .filter(s => cleanEan(s.Ean) === cleanEan(item.ean))

originalHasStock = condicoesOriginal.some(s => parseSmartPedEstoque(s.Estoque) > 0)
```

- `originalHasStock = true` → Caminho **SEM ruptura** (item tem estoque)
- `originalHasStock = false` → Caminho **COM ruptura** (item sem estoque)

#### 4.20.2. Fase de CotaÃ§Ã£o Inicial (IGUAL para ambos os caminhos)

Antes de decidir ruptura ou nÃ£o, o sistema jÃ¡ buscou dados da SmartPed:

1. **CotaÃ§Ã£o em lote** (linha ~460-670): Chamada `Condicoes/Ean` + `Condicoes/Molecula` em `Promise.all` para todos os EANs do SICF (batches de 40). Resultado: `apiResponses[ean] = { ItemPedido, Substitutos[], Condicoes[] }`
2. **Fallback por princÃ­pio ativo** (linha ~673-975): Para itens sem ofertas/estoque, busca via `Condicoes/Molecula` (por DCB/molÃ©cula) + `Produtos/Buscar` (por descriÃ§ao limpa). Resultado: novos `Substitutos[]` injetados em `apiResponses[ean]`
3. **UnificaÃ§Ã£o de equivalentes** (linha ~1006-1050): Para cada item, o sistema unifica respostas do EAN original + equivalentes locais (`LOCAL_EQUIVALENTS_DB`) + similares de mercado (Ferramentinhas) em `combinedSubstitutos[]` e `combinedCondicoes[]`

#### 4.20.3. Caminho SEM Ruptura (`originalHasStock = true`)

O item jÃ¡ tem estoque. O objetivo depende do tipo do item:

**GenÃ©ricos (TipoItem "G") — Busca Completa:**
O sistema aplica o mesmo fluxo de busca da ruptura para encontrar todos os fabricantes genÃ©ricos equivalentes:

1. **Filtro de equivalÃªncia** (linha ~1137-1146): `combinedSubstitutos` Ã© filtrado por `validateSwapEquivalence` (dosagem, apresentaÃ§Ã£o, sabor)
2. **TARGET-EAN-PRE** (linha ~1386-1453): Consulta EANs alvo dos substitutos jÃ¡ conhecidos via `Condicoes/Ean` + `Condicoes/Molecula`
3. **RUPTURA-REGEX** (linha ~1455-1573): Busca por descriÃ§Ã£o via `Produtos/Buscar` + `Condicoes/Ean` — **tambÃ©m ativa para genÃ©ricos com estoque**
4. **Rebuild** (linha ~1575-1617): Re-filtra, reconstrÃ³i `stockMapByEanDist`, `substitutos`, `condicoesEnriched`
5. **findBestSubstitute** (swap-engine.ts): Motor escolhe o melhor genÃ©rico com filtros estritos:
   - MantÃ©m mesma categoria: genÃ©rico → genÃ©rico (`isGeneric && !isCandidateGeneric → false`)
   - Filtra por `tiposAceitos` (G, O) — nÃ£o aceita tipos S, R, E como substitutos
   - Exige economia ≥ `margemMinima` em relaÃ§Ã£o ao benchmark
6. **Filtro do dropdown** (linha ~2022): **NÃ£o filtra por EAN** — mantÃ©m TODAS as alternativas genÃ©ricas

**Ã‰ticos/ReferÃªncia/Perfumaria/Similares (TipoItem R, E, O, S) — Busca do Mesmo Produto:**

1. **TARGET-EAN-PRE** (linha ~1386-1453): Consulta EANs alvo dos substitutos (pode incluir mesmo produto com EAN diferente)
2. **findBestSubstitute** (swap-engine.ts): Motor escolhe o melhor preÃ§o/condiÃ§Ã£o para o mesmo produto
3. **Filtro do dropdown** (linha ~2022): Filtra para **mesmo produto** — inclui:
   - EAN original
   - EAN do melhor substituto escolhido
   - EANs de `combinedSubstitutos` com **mesma descriÃ§Ã£o** do original (mesmo produto, cÃ³digo de barras diferente na SmartPed)

**Resultado:**
- GenÃ©ricos: ConditionSelector mostra **todas** as distribuidoras de todos os fabricantes genÃ©ricos encontrados
- Ã‰ticos/Similares: ConditionSelector mostra distribuidoras do mesmo produto (EAN original + EANs com mesma descriÃ§ao)

#### 4.20.4. Caminho COM Ruptura (`originalHasStock = false`)

O item NÃƒO tem estoque. O objetivo Ã© encontrar **qualquer alternativa viÃ¡vel** para suprir a prateleira.

**Fluxo — 3 camadas extras de busca:**

**Camada 1: TARGET-EAN-PRE** (linha ~1386-1453)
- Mesmo do caminho sem ruptura: consulta EANs alvo dos substitutos jÃ¡ conhecidos
- Expande `combinedSubstitutos` com ofertas de distribuidoras

**Camada 2: RUPTURA-REGEX** (linha ~1455-1573) — EXCLUSIVO de ruptura
- Extrai keywords da descriÃ§Ã£o do original (ex: `"ROSUVASTATINA CALCICA 10MG 30CP REV"` → `["ROSUVASTATINA", "10MG", "30"]`)
- Remove stop-words (`COM`, `CPR`, `COMP`, `REV`, `GENERICO`, `CALCICA`, etc.)
- Busca via `Produtos/Buscar` com as 3 primeiras keywords (ex: `"ROSUVASTATINA 10MG 30"`)
- Para cada EAN encontrado, consulta `Condicoes/Ean` em paralelo
- Adiciona novas ofertas ao `combinedSubstitutos` (deduplicando por `${Ean}_${CodDist}_${Condicao}_${Prazo}`)

**Camada 3: Filtro de tipos relaxado** (swap-engine.ts, linha ~35-41)
- Em ruptura (`!originalHasStock`), aceita **qualquer tipo** (G, S, R, E)
- Em sem ruptura, filtra por `tiposAceitos` (G, O)
- Isso permite que um Ã©tico sem estoque seja substituÃ­do por um similar

**Camada 4: Fallback Ferramentinhas** (linha ~1658-1710) — Ãºltimo recurso
- Se `findBestSubstitute` retorna `null` (nenhum substituto SmartPed encontrado)
- Chama `fetchSimilarGenericos(item.ean)` (API Ferramentinhas/Trier)
- Mapeia similares do ERP como candidatos de fallback
- Filtra por `validateSwapEquivalence` + estoque > 0 + preÃ§o > 0
- Se encontrar candidatos, escolhe o mais barato como `isFallback: true`

**Filtro do dropdown** (linha ~2022-2029): Em ruptura, **NÃƒO filtra por EAN** → mantÃ©m TODAS as alternativas para o ConditionSelector.

**Resultado:** O ConditionSelector mostra todas as distribuidoras de todos os EANs equivalentes encontrados (original + genÃ©ricos + similares + descobertos por regex).

#### 4.20.5. Tabela Comparativa Resumida

| Aspecto | Ético/Similar s/ ruptura | Genérico s/ ruptura | Qualquer c/ ruptura |
|---------|--------------------------|---------------------|---------------------|
| `originalHasStock` | `true` | `true` | `false` |
| TARGET-EAN-PRE | Sim | Sim | Sim |
| RUPTURA-REGEX (busca por descriÃ§Ã£o) | **NÃ£o** | **Sim** | **Sim** |
| Tipos aceitos (swap-engine) | G, O (estrito) | G, O (estrito) | **G, S, R, E (qualquer)** |
| Filtro de categoria (genÃ©rico↔genÃ©rico) | **Estrito** | **Estrito** | **FlexÃ­vel** |
| Exigir economia ≥ margemMinima | **Sim** | **Sim** | **NÃ£o** (bypass) |
| Fallback Ferramentinhas | **NÃ£o** | **NÃ£o** | **Sim** |
| EANs no dropdown | **Mesmo produto** (EAN + desc igual) | **TODOS** | **TODOS** |
| `isRupturaSubstitution` | `false` | `false` | `true` (se encontrou substituto) |

#### 4.20.6. Fluxo Visual Simplificado

```
[Arquivo SICF]
    ↓
[Cotação em lote: Condicoes/Ean + Condicoes/Molecula]
    ↓
[Fallback: busca por princípio ativo (DCB/molécula)]
    ↓
[Unificação: combinedSubstitutos + combinedCondicoes]
    ↓
[originalHasStock?]
    ├── SIM (sem ruptura)
    │   ├── [Filtro equivalência]
    │   ├── [TARGET-EAN-PRE]
    │   ├── [isGeneric?]
    │   │   ├── SIM → [RUPTURA-REGEX — busca por descrição]
    │   │   └── NÃO → (pula RUPTURA-REGEX)
    │   ├── [findBestSubstitute — tipos estritos, margemMinima obrigatória]
    │   └── [Dropdown:]
    │       ├── Genérico: TODOS os EANs
    │       └── Ético/Similar: mesmo produto (EAN + desc igual)
    │
    └── NÃO (ruptura)
        ├── [Filtro equivalência]
        ├── [TARGET-EAN-PRE]
        ├── [RUPTURA-REGEX — busca por descrição]
        ├── [findBestSubstitute — tipos relaxados, sem margemMinima]
        ├── [Fallback Ferramentinhas — se findBestSubstitute = null]
        └── [Dropdown: TODOS os EANs encontrados]
```

---


