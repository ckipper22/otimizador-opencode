# Contexto do Projeto: Otimizador de Pedidos SmartPed (LLM Context)

Este documento atua como o "cérebro" arquitetural do projeto. Ele foi redigido para fornecer contexto de alto nível, mapeamento profundo de regras de negócio, estrutura de arquivos e pontos de atenção técnica. **Ao ler este arquivo, um assistente de IA deve ser capaz de compreender instantaneamente o propósito, as armadilhas e as mecânicas internas da base de código.**

## 1. Visão Geral e Objetivo do Sistema

**O que o software faz:**
O sistema é uma aplicação Web Full-Stack projetada para farmácias e redes de drogarias. O objetivo principal é **otimizar financeiramente compras de medicamentos** utilizando a API da integradora "SmartPed".

**Como funciona:**
O usuário (comprador) faz upload de um arquivo de pedido em formato padrão da indústria farmacêutica (`.sicf` ou `.txt`). O sistema faz o parsing desse arquivo (lendo os EANs dos medicamentos), conecta-se aos servidores da SmartPed, busca todos os concorrentes e distribuidores daquela "molécula", e sugere trocas inteligentes. 
As trocas visam:
1.  Reduzir o custo unitário (respeitando uma margem de economia mínima configurada).
2.  Suprir "faltas" (quando o medicamento original não tem estoque no distribuidor padrão, ele sugere um genérico equivalente).

**Perfil de Uso:**
Destina-se a uso B2B interno, onde o foco é na tabela de dados (SwapsTable), logs em tempo real e eficiência de envio de pedidos.

---

## 2. Stack Tecnológica e Ecossistema

*   **Linguagem Universal:** TypeScript (no Frontend e Backend).
*   **Frontend:**
    *   **Framework:** React 19 executando sobre Vite 6.
    *   **Estilização:** Tailwind CSS v4.0, integrado nativamente via importação no CSS.
    *   **Animações:** `motion` (framer-motion moderno).
    *   **Ícones:** `lucide-react`.
*   **Backend (Servidor Embutido):**
    *   **Framework:** Express.js v4.
    *   **Responsabilidade:** Atua como um BFF (Backend for Frontend). Suas funções vitais são fazer proxy de requisições para a API SmartPed (evitando problemas de CORS e ocultando regras complexas) e rodar o algoritmo pesado de *match* financeiro das moléculas.
    *   **Porta & Ingress (Cloud Run):** Configurado para ler a porta de forma dinâmica através de `process.env.PORT`. Em produção, assume a porta `8080` como padrão e escuta em `0.0.0.0` para conformidade com o Cloud Run, mantendo o fallback para a porta `3000` em ambiente de desenvolvimento local do AI Studio.
    *   **Arquivos Estáticos:** Em modo de produção (`NODE_ENV === "production"`), o servidor desativa o middleware do Vite e serve estaticamente os arquivos compilados da pasta `dist/` gerados no build.
*   **APIs Externas Críticas:** 
    *   SmartPed API. Utiliza dois ambientes mapeáveis: Sandbox (`https://apitest.smartped.com.br`) e Produção (`https://api.smartped.com.br`).
*   **Persistência de Dados:**
    *   **SQLite** via `better-sqlite3` (arquivo: `/tmp/smartped.db` em Cloud Run, `data/smartped.db` local).
    *   Tabelas: `orders`, `order_items`, `api_cache`, `faturados`.
    *   Purga automática de cache expirado no startup (`startDbCachePurge`).
    *   **Cache de API SmartPed em duas camadas:** L1 (Map em memória, 2000 entradas, 5min TTL) + L2 (SQLite persistente, sobrevive a reinícios do servidor).

---

## 3. Arquitetura e Mapeamento de Arquivos

O projeto utiliza um repositório modular (Express + React) com separação clara entre backend e frontend.

### Diretório Raiz
*   `server.ts`: **(CRÍTICO)** Ponto de entrada do servidor Express. Contém apenas as rotas de API e o bootstrap do servidor. Toda a lógica utilitária foi extraída para módulos em `server/`.
*   `swap-validation.ts`: Módulo de validação de similaridade e equivalência de trocas (`validateSwapEquivalence`, `areDosagesEqual`, `areFlavorsEqual`). Contém o dicionário estrito de termos sensíveis (sabores, fragrâncias, cores, dosagens e apresentações).
*   `backend-tests.ts`: Suíte autônoma de auto-testes bloqueantes (`runEngineSelfTests`). Valida 8 cenários mandatórios de troca. Se houver falha, encerra a execução com `process.exit(1)`, abortando o build de produção.

### Módulos Backend (`server/`)
*   `server/config.ts`: Configuração centralizada via `.env` (tokens, URLs, CNPJs).
*   `server/cache.ts`: Cache L1 (Map em memória, 2000 entradas) + L2 (SQLite persistente). TTL 5min para SmartPed. Hit L1 = rápido. Miss L1 = busca SQLite. Escrita = ambos. Purga automática no startup.
*   `server/rate-limiter.ts`: Middleware de rate limiting por IP (120 req/min).
*   `server/ean-utils.ts`: Limpeza de EANs, banco de dados local de EANs (`EAN_DATABASE`), carregamento a partir de arquivos SICF.
*   `server/smartped-api.ts`: Clientes de API externa (`fetchEanDescriptions`, `fetchSimilarGenerics`).
*   `server/parsers.ts`: Utilitários de parsing de texto/números (preço, PMC, dosagem, molécula, curingas, quantidade).
*   `server/distributors.ts`: Mapa de distribuidoras (`DISTRIBUIDORAS_MAP`).
*   `server/equivalents-db.ts`: Banco de dados local de equivalentes de mercado (cross-reference).
*   `server/swap-engine.ts`: Algoritmo core de seleção de melhor substituto (`findBestSubstitute`).
*   `server/smartped-transforms.ts`: Normalização de dados SmartPed (`enrichReturnedItem`, `parseSmartPedEstoque`).
*   `server/mock-data.ts`: Dados de simulação para testes offline.
*   `server/database.ts`: Persistência SQLite (orders, order_items, api_cache, faturados). Usa `/tmp` em produção (Cloud Run).

### Frontend (`src/`)
*   `App.tsx`: Orquestrador visual. Controla guias de navegação (Otimização, Retornos, Itens do Dia), exibe os relatórios gerados e os modais. Reduzido de 5409 para ~2890 linhas via extração de hooks.
*   `types.ts`: Contratos e interfaces (TypeScript). Ponto único da verdade das estruturas de dados (`SwapReportItem`, `OptimizerConfig`, `DistributorOption`).
*   `utils.ts`: Utilitários isolados (ex: `formatCurrency`) e strings de arquivos SICF de teste (ex: `SAMPLE_SICF_FILE`).

#### Hooks Customizados (`src/hooks/`)
*   `useAuth.ts`: Autenticação (login, Google auth, logout, authorizedCompanies).
*   `useOptimizerConfig.ts`: Configuração do otimizador (config, distribuidoras, status backend).
*   `useDailyOrders.ts`: Pedidos do dia e consulta direta de retorno.
*   `useOptimizationResult.ts`: Resultado da otimização (file handling, report, economia, interceptação de quantidades).
*   `useBilling.ts`: Ciclo de vida do faturamento (envio, polling de retornos, faltas, exportação).
*   `useManualSearch.ts`: Cockpit de busca manual de produtos.
*   `useDistributorWizards.ts`: Assistentes de dispersão/completar pedido e mínimos de distribuidora.
*   `useOfferTableColumns.ts`: Configuração de colunas da tabela de ofertas (visibilidade, larguras, resize).

#### Componentes Principais (`src/components/`)
*   `UploadBox.tsx`: Zona de *drag-and-drop*. Nele também são listadas as **Distribuidoras Disponíveis** onde o usuário pode desmarcar (fazer *opt-out*) distribuidores indesejados antes da otimização.
*   `ConfigurationPanel.tsx`: Painel de ajustes finos (Token da API, CNPJ, Valor de Economia Mínima, URLs Customizadas).
*   `SwapsTable.tsx`: A tabela densa de resultados. Exibe o que foi trocado (`De -> Para`), lucros e alertas de ruptura.
*   `OrderReturnView.tsx`, `PendingOrdersTable.tsx`: Interfaces para monitorar o status do pedido (Faturado, Falta, Erro) após o envio final para a SmartPed.

---

## 4. Regras de Negócio e Fluxo de Dados

### 4.1. O Arquivo SICF
O padrão da indústria possui estrutura posicional/delimitada:
*   **Tipo 1 (Cabeçalho):** Contém CNPJ do cliente. Ex: `1;13408443000168;...`
*   **Tipo 2 (Item de Linha):** Contém produto e EAN. Ex: `2;7891234567890;10;123;AMOXICILINA;EMS;15.50;...` (EAN, Quantidade, Cód. Interno, Descrição, Lab, Preço).
*   **Tipo 9 (Rodapé):** Marcador de final do arquivo.

*   **Limpeza Automática de EAN (Zeros à Esquerda):** No parsing do arquivo SICF, inclusão manual ou retornos da API, o sistema normaliza e remove automaticamente quaisquer zeros à esquerda redundantes do EAN (através da função `cleanEan`). Isso evita preenchimentos indesejados (ex: `0000078924383` vira `78924383`, mantendo-o como EAN-8 padrão), melhora a legibilidade do relatório e impede falhas ou divergências de mapeamento ao cruzar dados de distribuidores na API.

### 4.2. O Fluxo de Otimização (O Core Engine)
Quando `/api/optimize` é acionada, os seguintes passos ocorrem:
1.  **Parse & Chunking:** O SICF é lido. EANs únicos são separados. Como a API SmartPed restringe EANs simultâneos, o servidor faz chamadas agrupadas (em blocos de 40).
2.  **Consulta de Molécula:** Bate nas rotas `/api/Condicoes/Molecula` (descobre genéricos) e `/api/Condicoes/Ean` (descobre o preço original). **Cache L1+L2**: Hits consultam memória primeiro, depois SQLite; misses escritos em ambos.
3.  **Filtro de Distribuidoras (`disabledDistributors`):** Qualquer distribuidor desmarcado pelo usuário no painel de UI tem suas ofertas de substitutos sumariamente apagadas do array antes do algoritmo processar.
4.  **Seleção e Match (Função `findBestSubstitute` no `server.ts`):** 
    *   **Prioridade Absoluta para Distribuidoras Reais (Fim de Ofertas Fantasmas):** Na ordenação e na escolha da oferta vencedora ou alternativas, qualquer opção com `CodDist > 0` (distribuidoras reais) possui **prioridade absoluta** sobre opções cujo `CodDist === 0` ou nome do distribuidor seja `"Não Encontrados"` ou `"Sem Estoque"`. Se houver pelo menos uma oferta comercial real de distribuidora para o EAN, as ofertas fantasmas ("Não Encontrados") são completamente excluídas ou rebaixadas para o final da fila de seleção, garantindo que o Otimizador escolha sempre produtos reais que estão disponíveis nas distribuidoras e nunca oculte ofertas reais por causa de preços de fallbacks virtuais.
    *   **Soberania do Item Original (Imunidade a Filtros de Painel):** O produto principal (o EAN exato enviado pelo usuário no arquivo SICF) é rigorosamente soberano e imune aos filtros secundários do painel do otimizador (`config.tipos` e `margemMinima`). Se a API SmartPed devolve estoque e condições reais de preço para o EAN exato original, o item jamais deve cair em status "Não Encontrados" (CodDist: 0) ou ter suas ofertas excluídas. Os filtros de tipos de substituição (como preferir apenas Genéricos "G") e de margem de economia mínima aplicam-se estritamente às propostas de **Swaps** (substitutos alternativos de outros laboratórios de mesma molécula) e nunca ao produto base original da compra.
    *   **Busca em Tempo Real com Imunidade de EAN Original e Fluxo de Duas Etapas por Descrição:** No endpoint de busca textual e de EAN (`/api/search-products`), se a pesquisa for realizada por descrição (texto), o sistema executa um **fluxo obrigatório de duas etapas**:
        1. **Busca Cadastral (`/api/Produtos/Buscar`)**: Localiza as opções e extrai os EANs corretos.
        2. **Cotação Comercial Bypass (`/api/Condicoes/Ean`)**: Realiza uma chamada automática paralela para o endpoint de condições comerciais usando os EANs obtidos. Isso é necessário porque a rota cadastral de busca textual não retorna condições comerciais ou tabelas de preços/PMC das distribuidoras.
        3. **Filtro de EAN Exato (onlyExactEan) na Adição Manual ("+")**: Quando a busca é disparada a partir do modal flutuante de Adição Manual ("+"), o parâmetro `onlyExactEan: true` é enviado no payload. Se a busca for numérica (por EAN), o backend desativa a chamada de substitutos genéricos (`Condicoes/Molecula`) e realiza um filtro rígido pós-busca para garantir que apenas ofertas do exato mesmo EAN pesquisado sejam retornadas, evitando que concorrentes ou similares poluam o resultado.
        4. **Preservação dos Similares no Botão do Olhinho (`/api/similares/:ean`)**: O filtro de EAN exato aplica-se estritamente ao modal de adição manual (`+`). O modal de análise de similares ("o olhinho" / `SimilarProductsModal`) continua operando via rota dedicada `/api/similares/:ean` com recuperação automática de descrição via `EAN_DATABASE` e busca inteligente por molécula/DCB, garantindo que a lista completa de similares, genéricos e equivalentes apareça corretamente.
    *   Exige que o estoque no distribuidor seja maior que `0` (se `permitirSemEstoque` for falso).
    *   Calcula o `precoNovo`.
    *   Valida se a diferença `(precoOriginal - precoNovo) >= margemMinima` (apenas para substitutos de EAN diferente, e somente se o produto original possuir estoque ativo disponível nas distribuidoras).
    *   **Bypass de Falta (Exceção para Suprimento de Faltas):** A exigência de `margemMinima` (que só sugere substituição se houver economia em relação ao original) aplica-se exclusivamente quando o EAN original possui estoque superior a zero nas distribuidoras reais. Se o item original estiver totalmente indisponível (Ruptura/Falta Absoluta nas distribuidoras reais), o sistema ignora sumariamente o filtro de `margemMinima` para os substitutos/swaps. O Otimizador seleciona o substituto de mesma molécula que tenha estoque ativo, que respeite os `config.tipos` aceitos e a categoria correspondente (Genérico com Genérico / Marca com Marca), elegendo a alternativa mais barata disponível para suprir a prateleira da farmácia.
    *   Se o item original não possui estoque de jeito nenhum (ruptura) e for Genérico, o algoritmo aceitará um substituto genérico de preço equivalente (foco em abastecimento em vez de apenas lucro, podendo exceder em até 10% do valor como fallback definitivo de ruptura).
    *   **Otimização de Menor Preço Absoluto com Seletor de Alternativas Comerciais Categorizado:** Para garantir que a farmácia sempre veja a melhor oferta do mercado, o algoritmo de otimização ignora o filtro rígido de quantidade mínima (`QtdMin`) na triagem de ofertas de menor custo. Em vez disso, se a quantidade solicitada for inferior ao limite da promoção, a interface renderiza um alerta de quantidade mínima ("Mínimo Promo: X un"). O usuário ganha um painel estruturado de "Opções de Compra & Substituição de Laboratório" em cada linha da tabela. O seletor manual de condições separa as opções em dois grupos visuais nítidos via `<optgroup>`:
            1. `📋 CONDIÇÃO DE COMPRA`: Para manter o mesmo medicamento/marca, alterando apenas o distribuidor, preço ou prazo.
            2. `🔬 SUBSTITUIÇÃO`: Para trocar o medicamento por um fabricante ou laboratório equivalente mais barato (EAN diferente).
    *   **Alerta de Mínimo Comercial Altamente Visível:** Para evitar problemas de faturamento onde a farmácia envia pedidos sem atingir a quantidade promocional mínima exigida, o sistema destaca os itens que não cumprem o `qtdMin` com um banner vermelho piscando de alta visibilidade ("⚠️ MÍNIMO COMERCIAL: X un (ATENÇÃO: FALTA Y UN!)") diretamente na linha do item.
    - **Botões de Recomendações Rápidas Descritivas:** Em vez de botões genéricos de menor custo, a interface renderiza cartões de ação rápida baseados no contexto do item:
            - **⚡ RESOLVER ALERTA DE MÍNIMO COMERCIAL ou MELHOR PREÇO SEM MÍNIMO (MESMO PRODUTO)**: Se houver uma oferta do mesmo produto sem limite mínimo de quantidade, um botão específico com cor contextualizada (vermelho se houver alerta ativo para resolver, ou esmeralda para economia convencional) explica exatamente qual distribuidora será selecionada, o preço final e a economia unitária obtida para evitar o bloqueio comercial.
            - **🔬 SUBSTITUIR POR OUTRO LABORATÓRIO MAIS BARATO**: Se houver um substituto genérico/similar de menor custo de outro fabricante (EAN diferente), o botão exibe explicitamente qual fabricante será adotado, o distribuidor que o fornece, e o valor total de economia. Isso garante que o comprador saiba exatamente qual ação está tomando.
    - **Painel/Modal de Intercambialidade & Condições de Compra (Botão ao lado do Código de Barras):** Para todas as opções e linhas da tabela de trocas, o usuário conta com um botão azul (`Layers`) posicionado estrategicamente ao lado do código de barras (EAN). Esse botão abre um modal interativo de alta fidelidade que categoriza e ordena todas as alternativas disponíveis de forma extremamente clara em três grupos (Abas):
            1. `📋 MESMO MEDICAMENTO & CONDIÇÕES`: Exibe as ofertas do exato mesmo produto (mesmo EAN), mas sob outras condições (como distribuidoras sem exigência de quantidade mínima ou com prazos diferentes).
            2. `🔬 MEDICAMENTOS GENÉRICOS`: Lista todas as opções de laboratórios genéricos equivalentes ordenadas pelo menor preço líquido unitário.
            3. `⭐ MEDICAMENTOS SIMILARES E ÉTICOS`: Reúne todos os medicamentos de marca equivalentes (similares e éticos/referência) disponíveis.
       
       *Varredura Ativa e Concorrente da SmartPed em Tempo Real:* Se o item selecionado estiver marcado como "Sem Estoque", "Não Encontrados", ou se não possuir ofertas cadastradas de antemão, o modal ativa instantaneamente uma busca profunda em tempo real conectando-se ao endpoint `/api/smartped-find-substitutes`.
       O backend descobre as informações de DCB/composição consultando a API do Ferramentinhas pelo EAN do item (e aplicando heurísticas inteligentes baseadas em texto para o nome do produto caso o EAN falhe) e, em seguida, dispara **cinco consultas assíncronas concorrentes (em paralelo)** na SmartPed:
            - `Condicoes/Ean` (por EAN)
            - `Condicoes/Molecula` (pelo EAN da molécula)
            - `Condicoes/Molecula` (pelo texto/código DCB descoberto)
            - `Condicoes/Similares` (por EAN)
            - `Condicoes/Substitutos` (por EAN)
       Todas as ofertas retornadas pelas distribuidoras são mescladas, desduplicadas (preservando a com maior estoque/menor preço) e re-classificadas reativamente no frontend. O modal fornece um botão para forçar varreduras manuais e um painel de logs de rastreabilidade integrado que depura detalhadamente a execução de todas as requisições SmartPed para o comprador. Ao clicar em **"Encaminhar Pedido"**, o sistema redireciona reativamente o item para o novo fornecedor/preço no pedido.
    *   **Exibição e Integração do PMC (Preço Máximo ao Consumidor) e Normalização Financeira:** Para dar transparência completa de precificação e margem comercial para a farmácia, o backend calcula e injeta os campos `originalPmc` e `novoPmc` no relatório principal, bem como o PMC individual de cada alternativa, extraindo-os diretamente das respostas comerciais da SmartPed. Para garantir 100% de confiabilidade e tolerância a falhas nos dados de ERPs ou de parceiros:
            - **Tratamento de Strings com Vírgula e Símbolos de Moeda (`parseFormattedNumber`):** Qualquer valor financeiro vindo da SmartPed ou ERP Trier em formato string contendo vírgulas como divisor decimal ou prefixos de moeda (ex: `"R$ 41,96"` ou `"R$  41,96"`) é higienizado removendo todos os caracteres não-numéricos (exceto pontuação válida e sinal negativo) e convertido para um número decimal de ponto flutuante, eliminando falsos negativos de `NaN` ou `0` e garantindo a extração perfeita de PMC e Preços de Fábrica.
            - **Persistência Correta no Cache de Lotes EAN (`itensEan`):** No endpoint `/api/Condicoes/Ean`, as informações de PMC e preço de tabela/fábrica vêm aninhadas individualmente dentro de cada item do array de ofertas `Condicoes`. O sistema percorre as condições para capturar o PMC real (`PMC`) e o preço de tabela real (`Preco`/`PrecoOriginal`) do produto direto do JSON nativo da SmartPed, persistindo-os no objeto sintético `ItemPedido` no cache de respostas `apiResponses[ean]`. Isso garante que o PMC esteja sempre disponível para o otimizador sem depender de referências locais vazias ou fallbacks incorretos.
            - **Varredura Multipropriedades (`extractPmc` e `extractTablePrice`):** O backend realiza uma busca exaustiva por variações comuns de nomes de atributos no JSON de retorno (como `PMC`, `pmc`, `Pmc`, `VlrPmc`, `vlr_pmc`, `Preco`, `preco`, `PrecoOriginal`, `vlr_venda_tabela`, etc.) para extrair o valor real do PMC e do Preço de Fábrica/Tabela.
            - **Fallback Baseado no Preço de Tabela:** Se o PMC não for explicitamente retornado ou vier zerado da API, o sistema emprega um fallback automático e preciso baseado no **Preço de Tabela** do produto (`precoTabela * 1.4`), em vez do preço líquido de compra. Isso impede que produtos com alto desconto tenham seu PMC drasticamente subestimado (evitando que um produto de PMC de R$ 41,96 e custo líquido de R$ 6,72 apareça de forma incorreta como R$ 9,41).
            - O frontend renderiza essas informações de forma sofisticada e de alta visibilidade:
            - Na tabela principal de itens (`SwapsTable.tsx`), o PMC correspondente é exibido sutilmente em fonte menor logo abaixo do Preço Base e do Preço Líquido (sinalizado em verde esmeralda para destacar a oferta ativa).
            - No modal de intercambialidade e condições comerciais (`InterchangeabilityModal.tsx`), o PMC de cada alternativa de compra ou laboratório é renderizado logo abaixo do seu respectivo Preço Líquido na lateral direita, facilitando a tomada de decisão pelo comprador.
            - Na tela de adição manual de itens (`App.tsx`), as ofertas pesquisadas exibem o PMC logo abaixo de seu respectivo Preço Líquido na coluna correspondente, garantindo controle visual completo antes de enviar o item para o lote.
    *   **Cockpit Comercial e Adição Manual de Itens (Botão Flutuante "+"):** O modal acionado pelo botão flutuante `+` em `src/App.tsx` opera como um **Cockpit Comercial de Alta Fidelidade** para pesquisa e inserção de produtos no lote ativo da SmartPed:
        - **Busca Híbrida com Expansão de EANs (Cotação Comercial Completa por Descrição):** A API da SmartPed no endpoint `/api/Produtos/Buscar` não processa promoções com quantidade mínima (`QtdMin`) nem descontos escalonados. Para resolver isso, o backend implementa a **Busca Híbrida com Expansão**:
            1. *Fase de Descoberta*: Realiza a busca cadastral por descrição/curinga (`/api/Produtos/Buscar`) e extrai os principais EANs descobertos.
            2. *Fase de Expansão*: Para CADA EAN, dispara em paralelo (`Promise.all`) tanto `/api/Condicoes/Ean` (com `AceitaOntem=1`) quanto `/api/Condicoes/Molecula` (com `ConsideraTipo=1`). O endpoint `Condicoes/Ean` traz as condições diretas do produto com `QtdMin` e `minimos[]`. O endpoint `Condicoes/Molecula` traz os substitutos moleculares (genéricos/similares) com suas próprias condições e `QtdMin`.
            3. *Merge + Enriquecimento*: Concatena os resultados de AMBOS os endpoints, cruza `minimos[]` com cada condição (matching `CodDist + Condicao + Prazo`), e retorna a lista unificada de ofertas com `QtdMin` preenchido.
        - **Deduplicação Inteligente de Ofertas:** A SmartPed frequentemente retorna múltiplos registros para o mesmo EAN na mesma distribuidora devido a diferentes condições de pagamento e campanhas. O cockpit agrupa as ofertas por `EAN + CodDist`, elegendo a melhor oferta comercial com base nos critérios estritos de desempate: **1) Menor Preço Líquido -> 2) Maior Prazo de Pagamento -> 3) Maior Estoque Físico**.
        - **Grade Comercial Rica (12 Colunas):** Exibe com máxima clareza:
            1. *Distribuidora* (Nome, código e condição comercial).
            2. *Produto & EAN* (Descrição, EAN, botão de cópia e atalho para o olhinho de estoque ERP).
            3. *Laboratório* fabricante.
            4. *Preço Fábrica* (R$).
            5. *Desconto %*.
            6. *Desconto Extra %*.
            7. *Substituição Tributária - ST* (R$).
            8. *Preço Líquido* (Destaque em verde esmeralda).
            9. *Prazo* de pagamento (dias / à vista).
            10. *Qtd Mínima do Item* (com badge de aviso para pedidos acima de 1 unidade).
            11. *Pedido Mínimo da Distribuidora* (calculado dinamicamente para evitar o erro `ERR:ABAIXO DO MINIMO`).
            12. *Quantidade & Ação de Adicionar* (inclusão com feedback visual imediato e atualização reativa do lote).
    *   **Distinção Estrita de Escopos (Olhinho vs Botão Flutuante "+"):**
        - **Botão do Olhinho (`SimilarProductsModal.tsx`):** Focado exclusivamente na consulta de estoque local e cadastro no ERP Trier via `/api/similares/:ean`. Não possui conexão com a grade comercial SmartPed.
        - **Botão Flutuante "+" (`App.tsx`):** Focado no Cockpit Comercial ao vivo com a SmartPed, permitindo pesquisar por nome, molécula ou EAN, filtrar por estoque, deduplicar ofertas e adicionar novos itens diretamente ao lote de faturamento.
    *   **Destaque Visual para Valores Elevados por Item (Blinking Alert):** O usuário pode configurar um limite de valor total por item do pedido (default de R$ 100,00, armazenado em `localStorage`). Qualquer linha cujo valor total da linha (`Preço Novo * Quantidade`) exceda esse limite passará a pulsar/piscar visualmente na coluna de "Total", acompanhado de uma etiqueta de aviso ("⚠️ ALERTA: Confirmar Qtd!"), ajudando o comprador a validar quantidades e evitar compras acidentais de volumes gigantescos de itens de alto custo.
    *   **Busca de Similares (Ícone do Olhinho) Focada Estritamente no Estoque/Cadastro Local sem SmartPed:** O ícone do olho na tabela de resultados abre o `SimilarProductsModal.tsx` para consultar produtos similares locais no ERP (`/api/similares/:ean`). Para total consistência comercial, o backend utiliza exatamente a mesma heurística de extração de princípio ativo base (`getMoleculeBase`) que o sistema usa na aba principal de substituição ("pesquisar substituto de verdade"). O modal apresenta na interface um seletor amigável para alternar entre:
            1.  **Padrão (DCB / ERP):** Faz a busca padrão direta via EAN na Trier, servindo as composições associadas oficiais. Caso falhe, aciona de forma transparente a busca inteligente por descrição.
            2.  **Descrição / Molécula (Regex):** Força ativamente o cruzamento por similaridade de descrição utilizando o algoritmo avançado de limpeza de princípio ativo descoberto sobre o cadastro local em memória (`EAN_DATABASE`).
                *   *Povoamento Dinâmico Reativo:* Para maximizar a cobertura e precisão comercial (mesmo para itens novos do ERP real que não estejam nas planilhas estáticas), a busca direta de similares na API da Trier é **sempre realizada em segundo plano** em qualquer consulta. Todos os produtos vinculados retornados do ERP Trier são injetados dinamicamente no `EAN_DATABASE` com seus detalhes completos (estoque real, preço de venda, custo, DCB, código reduzido e última entrada).
                *   *Precisão Extrema:* O extrator ignora termos de veículos genéricos como `CHÁ`, `CHA`, `ÓLEO`, `OLEO`, `ÁGUA`, `AGUA`, `GEL`, `PASTA` (ex: transformando `"CHA FUNCHO SANITAS"` em `"FUNCHO"`), e o algoritmo restringe o match de substring parcial para exigir **comprimento mínimo de 4 caracteres**, eliminando correspondências espúrias de termos curtos (como `CHA` batendo de forma errônea com `CHAMPAGNE` ou `CHAMOMILA`).
            -   **Filtro de Estoque Ativo na UI (Default True):** O modal inclui uma opção reativa para ocultar produtos do ERP Trier zerados e sem estoque mínimo configurado (ex: `Estoque > 0` ou `Mínimo > 0`), que agora vem **ativada por padrão (true)** para garantir que o usuário veja apenas produtos com giro ativo no ERP local da farmácia sem ocultar itens necessários que estejam com estoque zerado, mas com mínimo maior que zero.
            -   **Parametrização Estrita de Estoque da SmartPed:** A SmartPed opera estritamente com os códigos de status de estoque `0` (Sem Estoque), `1` (Baixo / Sob Consulta) e `2` (Estoque Normal). O sistema traduz esses valores programáticos em texto descritivo correspondente em vez de exibi-los como quantidade física de caixas ("unidades" ou "un"), evitando que o comprador confunda códigos de status com saldo físico nas distribuidoras. A função utilitária `parseSmartPedEstoque` garante que cotações com preço comercial ativo e sem flag explícita de ruptura sejam tratadas como disponíveis (`2`), enquanto ofertas com status `0`, `"N"` ou `"SEM ESTOQUE"` são mapeadas para `0`. Esta normalização se aplica aos filtros de busca comercial (`App.tsx`), `SimilarProductsModal.tsx`, `InterchangeabilityModal.tsx` e `DailyItemsView.tsx`.
            -   **Filtro "Apenas com Estoque" e Helpers Universais da SmartPed (`resolveEstoque` e `resolveQtdMinima`):** Para evitar discrepâncias de maiúsculas/minúsculas no payload da SmartPed (que envia `Estoque`, `estoque`, `estoque_idi` ou `QtdMin`, `qtdMin`, `QtdMinima`, `qtdMinima`), foram criados os helpers unificados `resolveEstoque` e `resolveQtdMinima` em `src/utils.ts`. O filtro no Cockpit Comercial (`App.tsx`) e modais avalia estritamente `resolveEstoque(item) > 0`, descartando com precisão absoluta ofertas sem estoque (`0`, "Sem Estoque") e mantendo em tela ofertas normais (`2` - Em Estoque) e sob consulta (`1` - Sob Consulta).
            -   **Destaque de Quantidades Mínimas Promocionais:** As condições da SmartPed com quantidades mínimas escalonadas (ex: campanhas/combos com exigência de 12 caixas) são normalizadas por `resolveQtdMinima`. Na tabela de ofertas do Cockpit Comercial, essas exigências são destacadas com um badge amarelo compacto na coluna **Desconto %** (reproduzindo com fidelidade a interface da SmartPed) e com aviso em destaque na coluna **Qtd Mínima do Item**. Ao clicar no botão de adicionar, o campo de quantidade é pré-preenchido com o valor mínimo da promoção.
            -   **Filtragem de Ofertas Sem Estoque no Modal de Intercambialidade:** No modal de intercambialidade (`InterchangeabilityModal.tsx`), todas as opções comerciais das distribuidoras que possuem estoque físico zerado (`alt.estoque <= 0`) são sumariamente filtradas e ocultadas. Uma proteção especial garante que apenas a "Opção Ativa" atual do pedido seja mantida caso ela mesma esteja sem estoque, permitindo que o usuário visualize a seleção ativa e possa migrá-la com facilidade.
            -   **Filtragem Rigorosa de Estoque e Proibição de "Não Encontrados" na Tabela Principal (`SwapsTable.tsx`) e Backend:** Tanto no backend (`server.ts` em `itemAlternatives`) quanto no frontend (`SwapsTable.tsx` em `isValidAltForTable`, ações rápidas `cheapestSameProductNoMinAlt` / `cheapestOtherItemAlt` e nos grupos de opções comerciais do dropdown), alternativas com distribuidora contendo "NÃO ENCONTRADOS" ou estoque físico zerado/nulo (`estoque <= 0`) são estritamente filtradas e impedidas de aparecer como sugestão de troca, opção de compra ou no menu de seleção, assegurando que o comprador jamais visualize ou selecione fornecedores fantasmas ou sem estoque.
            -   **Preservação de Dados de ERP/Trier no Cache de EANs:** O processo de otimização (`/api/optimize`) mescla novos dados usando o operador spread (`...EAN_DATABASE[cleanedEan]`) em vez de sobrescrever completamente o registro, preservando campos cacheados valiosos (como `vlr_venda_tabela`, `vlr_venda_final`, `vlr_custopersonalizado` e estoque) gerados dinamicamente na varredura comercial de EANs.
            -   **Fallback e Padrão de Exibição de Preços de Venda de Tabela:** Em conformidade com o padrão operacional das farmácias e para evitar distorções de custos em itens sem ofertas ativas (onde o custo e a venda ficavam idênticos), implementamos fallbacks realistas no backend para itens S.I.C.F: o preço de tabela (`vlr_venda_tabela`) assume `precoOriginal * 1.4` (Preço de Tabela/PMC sugerido) e o valor líquido final (`vlr_venda_final`) assume `precoOriginal * 1.35`. Na interface do modal de similares (`SimilarProductsModal.tsx`), priorizamos a renderização do campo de venda final líquida oficial com desconto (`prod.vlr_venda_final`) sobre o valor de tabela para dar uma referência precisa do valor de prateleira praticado no ERP.
    *   **Regra de Categoria Estrita (Genérico por Genérico apenas / Marca por Marca apenas):** Para manter total conformidade regulatória e comercial, o algoritmo de otimização impede rigorosamente a substituição de categorias cruzadas em medicamentos. Se o item original for um Genérico, o substituto sugerido ou selecionado **deve obrigatoriamente** ser outro Genérico. Se for de marca (Similar ou Referência), o substituto **deve obrigatoriamente** ser de marca (Similar ou Referência).
    *   **Detecção de Genéricos de Alta Precisão (Prevenção de Falsos Positivos):** A classificação de genéricos prioriza o tipo oficial de item (`TipoItem === "G"`) retornado pela API real. Em caso de ausência, analisa as palavras-chave na descrição e laboratório de forma combinada e inteligente, eliminando as classificações incorretas de itens de marca (como "Vynaxa") fabricados por laboratórios genéricos famosos (como "EMS" ou "Medley") por meio da verificação do separador de marca (` - ` na descrição).
    *   **Blindagem de Dados e Fallback de Descrição na Interface:** Ao trocar de condição de compra ou aplicar redistribuição via assistentes de dispersão e faturamento, o frontend emprega um mecanismo de fallback robusto em cascata (`selectedAlt.descricao || item.novaDescricao || item.originalDescricao`) para garantir que os itens jamais apareçam vazios (sem descrição) na tabela interativa do usuário.
    *   **Alerta Visual Pulsante para Itens Originais em Falta (`originalSemEstoque`):** Quando o sistema otimiza ou propõe uma troca devido ao produto original estar em falta ou com estoque zerado em todas as condições/fornecedores (`originalSemEstoque`), a interface (`SwapsTable.tsx`) exibe um selo de destaque visual pulsante em vermelho (`🚨 ORIGINAL EM FALTA / SEM ESTOQUE`), garantindo total transparência ao comprador sobre o motivo da sugestão de troca.
5.  **Regeneração do SICF:** Reconstrói o texto do arquivo usando as strings delimitadas `;` mas agora com os EANs e preços novos.
6.  **Redirecionamento de Faltas (Shortages):** Itens marcados como falta (`isShortage: true`) que forem redirecionados para outra distribuidora por meio dos assistentes de Dispersar ou Completar pedido perdem a flag de falta (`isShortage: false`), pois passam a ser ofertas válidas com estoque garantido na distribuidora de destino. Isso evita alertas de faltas incorretos e o destaque amarelo visual na nova distribuidora.
7.  **Inteligência de Roteamento ao "Manter Original":** Ao desfazer um swap e manter o EAN original, o sistema nunca envia o item para a distribuidora original importada do ERP Trier se esta estiver sem estoque real ou indisponível. O backend (`server.ts`) analisa as condições comerciais compatíveis ativas para o exato EAN original e as ordena de modo a priorizar aquelas que possuem estoque real (`estoque > 0`). Se houver oferta ativa em outra distribuidora, o item é redirecionado automaticamente para a distribuidora de menor custo com estoque disponível. O preço de custo (`novoPreco`) no relatório ativo (`App.tsx`) é atualizado para o preço cotado real correspondente (`originalPrecoCotado`) no distribuidor ativo selecionado.
8.  **Higienização de HTML (Anti-Vazamento):** Para impedir que tags HTML cruas (ex: `<b>`, `<strong>`, `<span>`) e caracteres de escape da API SmartPed sejam exibidos literalmente para o usuário, o backend (`server.ts`) e o frontend (`SwapsTable.tsx`) utilizam funções utilitárias de limpeza (`stripHtmlTags` / `stripHtml`). Essas funções limpam descrições, laboratórios e mensagens de restrições comerciais antes de qualquer renderização visual ou transmissão.
9.  **Formatos de Sinais de Economia:** No componente `SwapsTable.tsx`, as economias reais de custos (redução de preço unitário nas ações rápidas) são formatadas e apresentadas como valores positivos para melhor compreensão visual, eliminando o sinal negativo (`-R$`) em cenários de desconto real.
10. **Persistência SQLite (pós-resposta):** Ao finalizar a resposta ao frontend, o servidor salva o pedido no SQLite (`saveOrder` + `saveOrderItem`) de forma assíncrona. Isso garante rastreabilidade de todas as otimizações realizadas sem impactar a latência da resposta HTTP.

### 4.3. Faturamento (`/api/faturar`)
Agrupa os itens pela distribuidora vencedora (`codDist`) e verifica se a soma alcança o `pedidoMinimo` (Valor Mínimo de Faturamento da distribuidora). Se não atingir, emite um *warning*. Em caso afirmativo, formata um payload massivo e dispara a ordem para a SmartPed. **Persistência SQLite:** Ao finalizar a resposta, o servidor salva o pedido + itens no SQLite (`saveOrder` + `saveOrderItem`) de forma assíncrona.

*   **Seletor / Opções de Faturamento (Exportar JSON ou Enviar):** Ao clicar em faturar um lote ("Enviar Todos" ou individualmente por distribuidora), o frontend intercepta o processo abrindo o modal interativo `billingChoice`. O comprador escolhe entre:
    1.  **Apenas Gerar JSON para Análise:** Monta o payload exato que seria enviado via POST para a API, e realiza o download de um arquivo `.json` local (ex: `faturamento_payload_Todas_as_Distribuidoras.json`), sem disparar nenhuma chamada de rede para a integradora. Isso possibilita auditar e debugar os dados de forma Offline.
    2.  **De Fato Enviar para Smartped:** Prossegue com o fluxo de faturamento oficial abrindo a tela de confirmação detalhada (`billingConfirm`).
*   **Blindagem (Validation) de Swaps e Regras de Faturamento Seguro:** Antes do faturamento ser transmitido, o backend realiza uma triagem de segurança rigorosa em cada item seguindo 4 regras cruciais de blindagem:
    1.  **Validação Estrita de Swaps:** Se um item original sofreu substituição (swap) por um equivalente, o sistema valida se os códigos identificadores (`codProduto` e `codProdutoDist`) são válidos (não vazios, não nulos, não strings `"null"` ou `"undefined"`, e estritamente diferentes de `"0"` ou `0`). Se for inválido, ele é omitido do lote para evitar erros ou faturamentos incorretos na distribuidora.
    2.  **Expurgo de Itens sem Distribuidora / Sem Estoque:** Qualquer item com código de distribuidora zerado (`codDist === 0` ou `originalCodDist === 0`), sem estoque, não encontrado ou com nome de distribuidora vazio é sumariamente bloqueado e expurgado antes da montagem final do JSON do payload para a SmartPed.
    3.  **Swap com EAN de Destino Válido:** Bloqueia itens substitutos cujo EAN de destino (`novoEan`) seja ausente ou tenha comprimento inferior a 5 caracteres.
    4.  **Consolidação de Lote Único:** O backend unifica todos os itens faturáveis de todas as distribuidoras em uma única chamada POST para `/api/Pedido/Envio` da SmartPed, impedindo disparos em paralelo por distribuidora de forma separada que causariam o erro `"Já existe um envio pendente"`.
*   **Fallback / Espelhamento Automático de Código de Produto (`codProduto`):** Para evitar que itens com dados cadastrais incompletos (como DAFORIN, COMBTOL e DERMAEX) sejam descartados pela blindagem devido ao campo `codProduto` estar nulo, vazio ou preenchido como `"0"`, implementamos um mecanismo inteligente de espelhamento em ambas as camadas (Frontend e Backend). Sempre que o `codProduto` for identificado como `"0"`, nulo ou vazio, ele herda/copia automaticamente o valor do campo `codProdutoDist` (ID da oferta comercial). Isso se aplica no momento do Swap de alternativas no frontend, na geração de arquivo de payload de análise (JSON), na transmissão de faturamento real, e no loop de validação final do backend antes de disparar o pedido para a SmartPed.
*   **Duplo Cache de Faturamento:** Ao faturar, o sistema insere os metadados do produto no `FATURAMENTO_ITEMS_CACHE` sob duas chaves distintas e combinadas: `${numPedidoSmartPed}_${codDist}_${codProdutoDist}` e `${numPedidoSmartPed}_${codDist}_${codProduto}`. No momento da consulta do retorno (/api/pedidos-do-dia), onde as tags de descrição do produto não são retornadas de forma nativa pela SmartPed, o backend recupera as descrições em O(1) cruzando essas duas chaves do cache, ou em última instância no banco de EANs (`EAN_DATABASE`). Isso garante uma experiência totalmente livre de itens sem identificação na UI de retornos.
*   **Validação Estrita de Resposta e Aborto Imediato (Sem ID Falso):** Mesmo que o endpoint da SmartPed responda com HTTP Status `200 OK`, o backend analisa o corpo da resposta JSON de forma rigorosa. Caso a propriedade `Mensagem` contenha expressões de erro (como `"Erro"`, `"Falha"`, `"Inválido"` ou o famoso bloqueio `"Já existe um envio pendente"`), ou se a tag `Retorno` / `NumPedido` retornar nula ou vazia, o faturamento é sumariamente **rejeitado** retornando `sucesso: false` e um HTTP Status `400 Bad Request` com o erro explícito para o frontend. É terminantemente proibido gerar IDs de contingência locais no ambiente real. Isso blinda a aplicação contra falsos positivos e garante que os itens permaneçam ativos e intactos na tabela de otimização do frontend para faturamento posterior.
*   **Tratamento de Distribuidoras Bloqueadas (`DistBloqEnv`):** Quando o lote é aceito com sucesso (com `NumPedido` gerado), mas algumas distribuidoras parceiras estão bloqueadas, a API retorna essas ocorrências na tag `resData.Retorno.DistBloqEnv`. O backend extrai estes dados e envia para o frontend, que renderiza um banner visual de alerta (`warning`) proeminente de tom âmbar na interface de sucesso, indicando detalhadamente quais distribuidoras do lote foram bloqueadas pelo servidor.
*   **Pedidos Mínimos por Quantidade:** Em certas distribuidoras e promoções específicas, o faturamento mínimo não é medido por valor monetário (R$), mas sim por **quantidade física acumulada de caixas/unidades** (ex: "mínimo de 5 caixas", "mínimo de 10 un"). O sistema exibe de forma clara e reativa a contagem total de unidades de cada lote no cabeçalho do grupo da distribuidora (ex: `Total Pedido: R$ 354,20 (28 un)`), permitindo que o comprador valide o atendimento desse criterion físico instantaneamente.
*   **Consolidação Automática Anti-Duplicação:** Para tornar impossível que itens já faturados com sucesso (sem falta) sejam re-enviados ou transferidos para outra distribuidora pelos assistentes (Completar/Dispersar), ao fechar o modal de faturamento (pelo botão "X" ou "Fechar e Concluir"), o sistema aciona a função `handleCloseAndConsolidateBilling`.

### 4.4. Interceptador Modal de Pré-Faturamento Bloqueante e Validação Estrita (FASE 1 a 5)
1. **Equivalência Estrita de Trocas (Backend - `server.ts`):**
   * **Match de Dosagem/Concentração:** Extração via Regex de concentração (ex: `10MG`, `100MCG`, `0.4MG/ML`, `15G`). A alternativa DEVE ter dosagem idêntica.
   * **Match de Apresentação/Quantidade:** Extração via Regex de quantidade de comprimidos/mililitros (ex: `30CP`, `60 CAPS`, `100ML`). Rejeita trocas entre apresentações distintas (ex: 30CP por 15CP).
   * **Match de Sabor/Fragrância/Cor (Rejeição Absoluta - Hard Block):** Normalização de texto limpa (remoção de acentos, caracteres especiais e caixa alta). Varredura pelo dicionário estrito de sabores (`LIMAO`, `GUARANA`, `LARANJA`, `MORANGO`, `ABACAXI`, `UVA`, `MENTA`, `TUTTI FRUTTI`, `EUCALIPTO`, `TRADICIONAL`, etc.). Se o item original e o substituto possuírem sabores/fragrâncias divergentes, a função `validateSwapEquivalence` retorna `false` IMEDIATAMENTE (Hard Block). A alternativa é sumariamente descartada como opção de troca sem exibir alertas.
   * **Detecção Refatorada de Caixas Master/Fracionados (`alertaConfirmarQtd`):**
     * **Discrepância de Preço Sensível:** O alerta por preço só é acionado se `novoPreco > originalPreco * 3` (300%) **E** a diferença absoluta `(novoPreco - originalPreco) > R$ 15,00`. Evita falsos positivos em itens baratos como esmaltes, batons e hidratantes.
     * **Filtro de Texto de Embalagem Inteligente:** Ignora siglas de laboratórios (`GG`, `AL`, `EMS`, `GL`, `BGN`, `GEO`). Valida equivalência de quantidades entre ERP e substituto (ex: `30CP` vs `C/30` -> não alerta). Só alerta para termos coletivos atacados reais (`FARDO`, `DISPLAY`, `PACOTAO`, `25X4`, `CX COM`) ou contagens $C/N$ divergentes e elevadas ($> 30$).
2. **Normalização de EANs & Propagação Parent (Backend):**
   * Todos os EANs com 13 dígitos ou menos são normalizados via `padStart(13, "0")`.
   * Propagação das propriedades pai (`Ean`, `Descricao`, `Laboratorio`) para alternativas filhas (`Condicoes`) no achatamento.
3. **Busca Flexível por Token & Fallbacks Unificados (Backend):**
   * Limpeza de tokens de ruído (`SODICO`, `CLORIDRATO`) para evitar falsos negativos no `getLocalEquivalents`.
   * Fallback dinâmico para chamadas de API SmartPed caso a busca local resulte em zero estoque ou sem correspondência.
4. **Interceptador Modal de Pré-Faturamento (Frontend - `App.tsx` / `ConfirmQuantitiesModal.tsx`):**
   * **Bloqueio Total da UI de Faturamento:** Se houver qualquer item ativo com `alertaConfirmarQtd: true` ou alerta de duplicação recente na Profarma (`isProfarmaAlert: true`), a renderização e o faturamento das tabelas (`SwapsTable.tsx`) é **estritamente bloqueado** para confirmação obrigatória.
   * **Modal Pop-Up Bloqueante (`ConfirmQuantitiesModal.tsx`):** Exibe os itens sob alerta de fracionamento/preço discrepante e alertas de duplicidade de pedidos enviados para a Profarma nas últimas 48 horas. Exibe o produto original ERP, a sugestão do distribuidor, o preço unitário cotado, a mensagem contextualizada do alerta, um campo de input livre para ajuste de quantidade e o botão de confirmação "OK".
   * Digitando `0`, o item é removido do faturamento. Clicar em `OK` atualiza a quantidade no estado e limpa a pendência do item. Quando a última linha pendente for confirmada, o modal fecha automaticamente e libera as tabelas de faturamento.
5. **Inteligência ao "Manter Original" com Estoque:**
   * Ao rejeitar uma troca para manter o item original de marca, se a distribuidora original importada do ERP estiver com estoque zerado, o sistema varre as cotações ativas do mesmo EAN original e redireciona de forma inteligente para a distribuidora ativa com estoque real e preço mais baixo.
   * Remoção do sinal de menos (`-`) nas economias e exibição limpa como `"Economia: R$ X"`.
   * Remoção total de concatenações de HTML bruto na UI, utilizando JSX nativo.
6. **Gerador Parametrizado de Pedidos via WhatsApp (Genéricos Eurofarma):**
   * **Parametrização Dedicada (`direcionarEurofarmaWhatsapp`):** No painel de configurações (`ConfigurationPanel.tsx`), o comprador pode ativar o direcionamento dos genéricos da Eurofarma para pedido por WhatsApp, além de cadastrar o número padrão de telefone do representante.
   * **Banner e Botão de Ação (`SwapsTable.tsx`):** Exibe destaque informativo e o botão `📱 Pedido WhatsApp Eurofarma` contabilizando automaticamente os itens ativos do lote pertencentes ao laboratório Eurofarma.
   * **Modal Gerador de Pedidos WhatsApp (`WhatsAppOrderModal.tsx`):** Permite revisar e filtrar a seleção dos genéricos Eurofarma, calcular o total de caixas e valor financeiro, e gerar uma mensagem formatada com Markdown profissional para WhatsApp. Conta com botão de cópia instantânea para a área de transferência (`Copiar Texto do Pedido`) e botão de disparo direto no aplicativo/web (`Enviar via WhatsApp`).
    *   Se o retorno já foi consultado e finalizado (Status 3), as faltas reais são mantidas no lote (`isShortage: true`) e os itens entregues são removidos em definitivo de `result.report`.
    *   Se o retorno ainda não foi consultado ou finalizado, o sistema assume preventivamente faturamento integral com sucesso, removendo permanentemente os itens faturados de `result.report` e arquivando-os no histórico permanente `faturadosGlobais`. Isso blinda o lote contra re-faturamento inadvertido ou erros de estado entre abas ou assistentes.
*   **Heurística Avançada de Extração de Molécula Base (`getMoleculeBase`):** Para contornar limitações da API da SmartPed ao buscar alternativas comerciais (aba "Não Encontrado"), implementamos um algoritmo inteligente que extrai o princípio ativo real do medicamento a partir de sua descrição textual. A função descarta ativamente dosagens complexas, quantidades físicas (comprimidos, cápsulas, etc.), apresentações e termos comerciais/laboratórios (como *Medley, EMS, Eurofarma, Uniphar, etc.*). Ao obter a molécula pura (ex: "CIPROFIBRATO"), a pesquisa pelo endpoint `/api/Condicoes/Molecula` atinge faturamento recorde de sugestões alternativas sem falsos-negativos. Em produtos de perfumaria, maquiagem, conveniência ou cosméticos (que comecem com termos genéricos como `KIT`, `BOLA`, `CREME`, `CHUPETA`, etc.), o algoritmo é blindado para não truncar o termo de forma incompleta (ex: reduzir `"KIT MAQUIAGEM INF GK1356"` para `"KIT"`), mas sim filtrar ativamente as palavras genéricas e extrair as palavras-chave específicas (ex: `"MAQUIAGEM GK1356"`), além de empregar uma trava de bloqueio estrita (`ehGenericoCompleto`) que impede que buscas de molécula textuais puramente genéricas sejam enviadas para a SmartPed.
*   **Busca Adicional por Princípio Ativo e Dosagem (`cleanDescriptionKeepDosage`):** Adicionamos um algoritmo secundário de limpeza textual que descarta apresentações e quantidades físicas de comprimidos/unidades, mas **preserva estritamente a dosagem do composto** (ex: transformando `"PARACETAMOL 750MG 20CP"` em `"PARACETAMOL 750MG"`). O sistema agenda uma busca paralela concorrente no endpoint de molécula com este termo limpo de dosagem. Isso resolve falsos-negativos em medicamentos onde o cadastro do princípio ativo na distribuidora exige a dosagem correspondente e impede a exibição de sugestões incompatíveis (como xaropes ou gotas para comprimidos).
*   **Motor Avançado de Geração de Buscas Curingas (`getWildcardQueries`):** Para contornar cenários onde os cadastros das distribuidoras possuem pequenas divergências de grafia, espaçamento ou posicionamento de termos (ex: `"PARACETAMOL 750MG 20CP"` vs `"PARACETAMOL 750MG C/20"`), criamos um gerador inteligente de strings de busca baseados no operador curinga `%`. O motor higieniza e remove termos de apresentação física colados aos números (transformando `"30CP"` ou `"30COMP"` em `"30"`) e filtra termos isolados irrelevantes de apresentação (ex: `CP`, `COMP`, `CAPS`, `FR`, `CX`). Adicionalmente, gera buscas progressivas curtas combinando as primeiras palavras comerciais (ex: `"COLA%CILIOS"`) de modo a resolver falsos-negativos para cosméticos, produtos de beleza ou correlatos sem princípios ativos puros, buscando concorrentemente no endpoint `/api/Produtos/Buscar` com faturamento máximo e resiliente. Para garantir total relevância e precisão, as palavras genéricas comuns de perfumaria e conveniência (como `KIT`, `INFANTIL`, `SABONETE`, etc.) são integradas nas listas de desconsideração, impedindo a geração de curingas excessivamente amplos ou inúteis (como `"KIT%"`).
*   **Layout Anti-Colapso Flexbox (`shrink-0` nos Modais):** Para evitar que cabeçalhos, painéis de identificação rápida, seletores de abas e rodapés sumissem ou ficassem cobertos sob alta densidade de conteúdo nas listas de alternativas, aplicamos propriedades determinísticas de não-redução flexbox (`shrink-0`) nos componentes `InterchangeabilityModal.tsx` e `SimilarProductsModal.tsx`. Isso isola o scroll exclusivamente na área de conteúdo dinâmico, preservando a usabilidade total da tela.


### 4.4. Exclusão Definitiva de Itens (`disabledItemCodes`)
Quando o usuário clica no ícone de lixeira (excluir), o código interno do item é adicionado ao conjunto de estado `disabledItemCodes` em `App.tsx`. O componente `SwapsTable.tsx` filtra o `processedReport` garantindo que os itens excluídos sejam sumariamente removidos de todos os cálculos, tabelas de faturamento, downloads e agrupamentos (como o "Celerg").

### 4.5. Integração com Fornecedores do WhatsApp (Copiar e Colar / Edição de Itens)
*   **Entrada de Dados e Edição Individual:** No painel de parâmetros (`ConfigurationPanel.tsx`), o usuário pode gerenciar tabelas de fornecedores de forma granular. Além de colar blocos brutos de mensagens do WhatsApp para parsing automático via regex flexível, o usuário conta com um sistema de abas de controle para cada fornecedor:
    *   **Aba "Texto Copiado":** Onde se gerencia o texto bruto colado da mensagem e o nome do fornecedor.
    *   **Aba "Produtos":** Uma visualização interativa contendo todos os produtos capturados pelo sistema. Permite a edição individual da descrição e do preço de qualquer item, exclusão definitiva de produtos específicos de forma amigável e a inserção manual/avulsa de novos itens digitando a descrição e preço, resolvendo problemas de condições comerciais dinâmicas que sofrem alterações recorrentes.
    *   **Tolerância e Robustez no Regex de Parsing de Preços:** O parser de texto (`parsePriceList`) utiliza uma expressão regular otimizada com tolerância a sufixos não numéricos no final das linhas (como "final", "líquido", "cada", etc.) e pontuações indesejadas (como hífens `-`, pontos e vírgulas `;`, bullets `•`, emoticons de pílula `💊`). Além disso, o parser suporta nativamente o formato em linhas separadas (quando o nome do produto está em uma linha e o seu respectivo preço está logo abaixo, na linha seguinte), associando a descrição pendente ao valor correspondente de forma automatizada. Isso garante que listas complexas e personalizadas coladas diretamente do chat do WhatsApp sejam interpretadas com precisão sem perda de dados.
*   **Algoritmo Preciso de Extração e Correspondência (Match de Dosagem/Quantidade):** No backend (`server.ts` na rota `/api/optimize`), se existirem fornecedores externos cadastrados, o sistema calcula a correspondência combinando um score textual (limpeza de acentos, caracteres especiais e stop-words) com uma verificação determinística e segura de dosagem e quantidades físicas via expressões regulares:
    *   **Lógica `extractDosageAndQty`:** Extrai dosagens numéricas vinculadas a unidades médicas (`mg`, `mcg`, `g`, `ml`, `ui`, `ug`) e quantidades de embalagem (`cp`, `cpr`, `caps`, `tabs`, `comprimidos`, `amp`, `frasco`, `unidades`).
    *   **Regras Estritas de Validação:** 
        1.  *Divergência de Dosagem:* Se ambas as descrições comparadas (arquivo de pedido SICF e tabela do fornecedor) contiverem dosagens, elas devem bater exatamente (ex: impede a troca de "Tadalafila 5mg" por "Tadalafila 20mg", mesmo com alto overlap de palavras).
        2.  *Divergência de Apresentação/Quantidade:* Se ambas as descrições especificarem quantidades (ex: "30cp" vs "10cp"), elas devem ser idênticas para permitir a comparação, prevenindo distorções no cálculo de faturamento e preços por unidade.
    *   Se as dosagens/quantidades forem validadas e o overlap de palavras for de pelo menos `0.6` (e com correspondência na primeira palavra da molécula), o sistema aceita a correspondência se a economia superar a `margemMinima`.
*   **Interface e Cópia (Faturamento Externo):** Itens direcionados para fornecedores externos aparecem agrupados em blocs destacados na cor esmeralda (verde) com uma tag "WHATSAPP". Em vez de enviar pela API (CORS/vínculo), a interface disponibiliza o botão "Copiar Pedido (WhatsApp)", gerando uma mensagem perfeitamente formatada e amigável (em formato de lista de texto) copiada para a área de transferência do usuário, permitindo o envio instantâneo via chat.

### 4.6. Consulta de Itens por Período, Filtro de Faltas e Assistente de Redistribuição (`/api/itens-confirmados-do-dia`, `/api/faturar` & `DailyItemsView.tsx`)
*   **Controle de Datas Flexível (Histórico por Período):** O endpoint aceita parâmetros adicionais e opcionais `dataInicio` e `dataFim` (formatos ISO `YYYY-MM-DD`). A função utilitária `formatToSmartpedDate` converte o formato de data do padrão web para o padrão exigido pelo SGF/Smartped (`DD/MM/YYYY`), possibilitando a pesquisa por qualquer intervalo de dias sem limitação ao dia corrente.
*   **Mapeamento Unificado de Status de Itens:** Para cada pedido do lote retornado, o backend captura os detalhes dos produtos e distribuidores parceiros, categorizando-os estruturalmente:
    *   **Faturado (Confirmado):** Itens cujo distribuidor finalizou o faturamento com sucesso (`Status === 3`) e que possuem `QuantFaturada > 0`.
    *   **Não Confirmado (Falta):** Itens que não tiveram faturamento com nenhum fornecedor (`QuantFaturada === 0`), cortes totais ou de distribuidores que rejeitaram os itens do lote.
*   **Mecanismo de Pesquisa Textual e Abas Interativas no Frontend:** O componente de visualização permite ao usuário alterar o intervalo de datas da busca e, na renderização local, aplicar filtros instantâneos baseados em:
    *   *Pesquisa Rápida:* Filtragem dinâmica de texto por nome do produto, EAN ou nome do distribuidor.
    *   *Abas com Contadores Dinâmicos:* Abas dedicadas ("Todos", "Faturados", "Não Confirmados") com cálculo reativo em tempo real dos totais de registros em cada categoria, facilitando a identificação imediata das faltas e cortes parciais da triagem.
*   **Assistente de Redistribuição Comercial de Faltas:** Na aba de "Não Confirmados", os itens possuem checkboxes de seleção em lote (com atalho para selecionar todos os visíveis). Ao disparar a redistribuição:
    *   *Pesquisa Comercial Ativa:* O frontend efetua consultas de alternativas em tempo real para os EANs selecionados através do endpoint `/api/search-products`. No backend, para queries numéricas (EANs), o sistema realiza chamadas paralelas de alta performance aos endpoints `Condicoes/Ean` e `Condicoes/Molecula` da SmartPed. Isso possibilita recuperar e unificar de forma consolidada (e livre de duplicatas) tanto as condições comerciais exatas do produto quanto todas as ofertas de substitutos genéricos e similares disponíveis no mercado.
    *   *Filtro Anti-Repetição Inteligente:* O sistema filtra as alternativas de modo a ignorar a distribuidora original que cortou/rejeitou o item e distribuidores sem estoque, priorizando e autoselecionando o distribuidor ativo com o menor preço comercial de reposição.
    *   *Injeção de Lote no Otimizador (Remontagem da Tela):* Através de um painel interativo de revisão, o usuário confirma os novos distribuidores de destino. Ao clicar em confirmar, o assistente monta um relatório virtual de substituição (`SwapReportItem[]`) e um arquivo SICF virtual com os itens, injetando-os diretamente no estado global do Otimizador (`App.tsx`). A tela é redirecionada automaticamente para a aba do Otimizador com todos os itens pré-carregados e marcados como selecionados, permitindo que o usuário altere quantidades, revise os pedidos e fature ou baixe o arquivo SICF normalmente na interface principal.

### 4.7. Alerta Visual de Valores Totais Elevados (Prevenção de Erros de Fracionamento)
*   **Problema de Fracionados:** No mercado farmacêutico, divergências de conversão de embalagens ou erros de digitação de quantidades podem gerar faturamentos acidentais gigantescos (valores de lote inflados por falhas de proporção de unidades).
*   **Mecanismo de Alerta Visual Piscante:** O sistema possui um sinalizador visual na tabela de resultados do Otimizador (`SwapsTable.tsx`). Qualquer item cujo valor total ativo (`item.novoPreco * item.qtd`) supere um determinado patamar monetário passará a piscar ativamente com uma animação elegante e sutil de fundo (`.animate-blink` em `index.css`), alternando o preenchimento de fundo da célula em tons suaves de vermelho/rosa e exibindo as mensagens chamativas `⚠️ ALERTA:` e `Confirmar Qtd!`.
*   **Threshold de Alerta Personalizável pelo Usuário:** Na barra de controles e filtros da tabela de pedidos ativos por distribuidora, o comprador dispõe de um widget interativo com um farol pulsante e um input numérico (`ALERTA TOTAL > R$`).
    *   *Valor Padrão:* Inicializado em **R$ 100,00** para capturar e sinalizar ativamente qualquer item relevante com valor total elevado.
    *   *Persistência de Preferências:* Sempre que o usuário altera o valor limite, a preferência é salva e re-lida automaticamente no `localStorage` do navegador do usuário, persistindo mesmo após reloads.

*   **Mecanismo de Segurança e Controle de Acesso (Painel Administrador):**
    *   *Fluxo de Autenticação:* A aplicação possui um fluxo de login obrigatório implementado no frontend (`src/App.tsx`) que intercepta toda a renderização se o usuário não estiver autenticado.
    *   *Credenciais Administrativas Fixadas:*
        *   **E-mail:** `ckipper22@gmail.com`
        *   **Senha:** `Aq1sw2de#fr4`
    *   *Persistência da Sessão:* A sessão autenticada é guardada sob a chave `app_authenticated` no `localStorage` do navegador.
    *   *Controle de Sessão (Logout):* Um botão funcional de "Sair" (🚪 Sair) foi integrado no cabeçalho superior do painel, permitindo a desconexão manual e limpeza das credenciais com um único clique.

### 4.8. Cache Global de Mínimos e Padronização de Leitura Comercial (Backend & Frontend)
*   **⚠️ REGRA CRÍTICA: QtdMin exige AMBOS os endpoints em paralelo (Bug 2026-08-14):** O `QtdMin` (quantidade mínima promocional) vem **principalmente do endpoint `Condicoes/Molecula`**, não do `Condicoes/Ean`. Qualquer código que busque condições por EAN **DEVE chamar AMBOS em `Promise.all`**. Chamar apenas `Condicoes/Ean` resulta em QtdMin=0 para a maioria das ofertas. Além disso, `Condicoes/Ean` **exige o parâmetro `AceitaOntem: 1`** para incluir promoções do dia anterior. Padrão obrigatório implementado em: `/api/search-products` (path de descrição) e `/api/smartped-find-substitutes` (Expansão Híbrida). Cache de 5 minutos em ambos para estabilizar.
*   **Cache Global em Memória (`MINIMOS_GLOBAL_CACHE` em `server.ts`):** 
    *   Como os endpoints da SmartPed possuem formatos heterogêneos (`/api/Condicoes/Ean` e `/api/Condicoes/Molecula` retornam o array `minimos`, enquanto `/api/Produtos/Buscar` retorna apenas um array plano de produtos), o backend mantém um cache centralizado na memória de todos os parâmetros de faturamento mínimo (`CodDist`, `Condicao`, `Prazo`, `VlrMinimo`, `QtdMinima`).
    *   Sempre que qualquer requisição traz o array `minimos`, a função `updateMinimosCache(minimos)` atualiza ou adiciona essas regras no cache global.
    *   Nas buscas por texto/descrição (`/api/smartped-find-substitutes` e `/api/search-products`), o backend enriquece proativamente cada item antes de responder ao cliente, injetando `VlrMinimo` e `pedidoMinimo` calculados via `getMinimoFromCache(codDist, condicao, prazo)`.
*   **Helpers Universais de Propriedades no Frontend (`src/utils.ts`):**
    *   `resolveEstoque(item)`: Normaliza todas as variações de nomes (`Estoque`, `estoque`, `estoque_idi`, `Estoque_idi`).
    *   `resolveQtdMinima(item)`: Normaliza quantidades mínimas por item (`QtdMin`, `qtdMin`, `QtdMinima`, `qtdMinima`, `Combo.QtdMin`).
    *   `resolvePedidoMinimo(item, minimosArray)`: Normaliza e resolve o valor de faturamento mínimo da distribuidora (`VlrMinimo`, `vlrMinimo`, `pedidoMinimo`), realizando matching determinístico de primeiro nível por `CodDist + Condicao + Prazo`, segundo nível por `CodDist + Prazo`, terceiro por `CodDist + Condicao` e quarto por `CodDist`.

### 4.8. Importador de Payload de Faturamento JSON / Logs de Pedido (UploadBox)
*   **Facilidade de Carga de Massa de Dados:** Adicionamos uma ferramenta e botão de ação permanente ("Importar Payload / JSON") no cabeçalho do `UploadBox.tsx` para carregar conjuntos de dados massivos em segundos.
*   **Parser de JSON Recursivo Inteligente:** O parser analisa o texto colado e localiza recursivamente qualquer array que contenha objetos com propriedades de EAN (independentemente de estarem sob chaves como `Itens`, `itens` ou direto na raiz do JSON), detectando também opcionalmente o CNPJ do cliente associado (`CnpjCLi`).
*   **Extrator Inteligente via Regex de Contingência:** Caso o texto colado não seja um JSON válido (por exemplo, logs contendo apenas trechos de mensagens), o sistema varre o texto utilizando expressões regulares avançadas para capturar códigos EAN de 13 dígitos e quantidades, garantindo que até colagens informais sejam interpretadas com precisão.
*   **Geração de Lote de Faturamento (SICF Virtual):** O importador converte os EANs e quantidades em linhas de dados no padrão S.I.C.F e preenche automaticamente o cabeçalho (`1;CNPJ;`) e rodapé (`9;1;`). Ao processar, o arquivo virtual é carregado no estado principal do Otimizador (`App.tsx`) como se o arquivo original do ERP Trier tivesse sido selecionado, permitindo disparar a otimização em lote na API real da SmartPed em apenas um clique e sem necessidade de digitação manual!

### 4.9. Botão Flutuante de Busca nos Pedidos e Card Interativo (SwapsTable)
*   **Melhoria de Usabilidade e Acessibilidade:** O sistema conta com um botão flutuante de busca posicionado estrategicamente no canto inferior direito (`bottom-28`), empilhado de forma harmônica logo acima do botão de adição manual (`bottom-8`).
*   **Card de Busca Draggable (Neo-Brutalismo):** Ao clicar no botão flutuante, a interface exibe um card interativo de busca com visual neo-brutalista de alto contraste (bordas grossas e sombra sólida de deslocamento). O card possui suporte completo à movimentação via drag (arrastar e soltar) na tela, permitindo que o comprador ajuste sua posição livremente para ler as tabelas por trás enquanto filtra os itens.
*   **Integração com o Diagnóstico de EANs:** O card flutuante exibe a contagem dinâmica de resultados correspondentes e conta com um botão rápido que injeta o termo buscado diretamente no Rastreador de Diagnóstico de EANs do lote inteiro em um único clique.

### 4.10. Motor de Agrupamento Dinâmico de Equivalentes (Cross-Reference / Prevenção de "Visão em Túnel")
*   **Problema de Visão em Túnel Mitigado:** Anteriormente, se o EAN de um produto original (ex: Pantoprazol Eurofarma) estivesse sem estoque na distribuidora, o sistema não sugeria equivalentes de grandes laboratórios concorrentes (ex: Aché, Sandoz, Medley) porque o Otimizador realizava a consulta individual restrita apenas àquele EAN na SmartPed, resultando em "visão em túnel".
*   **Banco de Equivalentes Local e de Mercado:** No backend (`server.ts`), foi introduzido um dicionário estático de equivalentes de mercado (`LOCAL_EQUIVALENTS_DB`) estruturado por Princípio Ativo + Dosagem + Apresentação (ex: "PANTOPRAZOL 20MG 28CP", "DAPAGLIFLOZINA 10MG 30CP", etc.) acoplado a um gerador inteligente de similares de mercado em tempo real.
*   **Flexibilização do `getLocalEquivalents` por Interseção de Palavras-Chave:** Em vez de comparações textuais estritas e parciais que travavam em variações sutis, a lógica agora normaliza os textos e decompõe em tokens, aplicando um filtro sofisticado que descarta conectores e variações de sais farmacêuticos (como `SÓDICO`, `SÓDICA`, `SODICO`, `SODICA`, `CLORIDRATO`, `MALEATO`, `MESILATO`, `HEMITARTARATO`, `TARTARATO`, `POTÁSSICO`, `POTASSICO`, `SULFATO`, `ZÍNCICO`, `ZINCICO`, `CÁLCICO`, `CALCICO`, `MONOHIDRATADO`, `MONOIDRATADO`). O casamento se dá por interseção lógica: se todas as palavras principais identificadas de molécula e dosagem corresponderem com os termos indexados de alguma chave do dicionário estático, o match é estabelecido perfeitamente.
*   **Geração Ampliada de Lotes de Cotação (`eansToQuote`):** Antes de realizar as consultas em lote na SmartPed, o sistema analisa os EANs originais do pedido e gera uma lista ampliada e enriquecida (`eansToQuote`) contendo o próprio EAN original, todos os seus equivalentes locais correspondentes e todos os similares de mercado retornados pela API concorrente (Ferramentinhas).
*   **Mecanismo de Fallback Concorrente por Busca Textual (Princípio Ativo) no Lote:** Caso um produto do lote original termine sua cotação por EANs/equivalentes pré-calculados sem ofertas ou estoques ativos na SmartPed, o backend dispara autonomamente uma pesquisa textual em tempo real. Essa chamada consome paralelamente a API Ferramentinhas (para resolver o código DCB exato do EAN original) e as rotas de busca de molécula/produto da SmartPed de forma assíncrona concorrente (`Promise.all`). As novas ofertas e EANs reais descobertos de mercado são injetados dinamicamente no lote e barramento de ofertas (`apiResponses`) e associados como similares válidos do item antes de passar pelo motor analítico de economia/trocas.
*   **Unificação de Respostas de Cotações:** Ao processar o retorno de cotação de cada item original do pedido, o sistema consolida, mescla e unifica as ofertas de todos os EANs equivalentes daquela mesma molécula em um único barramento (`apiResponses`). Se o `ItemPedido` de um concorrente de mercado retornar preço e estoque ativo na SmartPed, ele é automaticamente transformado em uma alternativa de troca de alto desempenho para o usuário.
*   **Resolução Inteligente:** Garante que o motor de busca consulte e traga dinamicamente todas as ofertas possíveis e os estoques de medicamentos intercambiáveis de todos os laboratórios nas distribuidoras reais da SmartPed para suprir faltas sem que o comprador precise saber os EANs dos concorrentes.

### 4.11. Sistema Automático de Alertas de Duplicidade Profarma (Últimos 2 Dias Úteis)
*   **Detecção Automática Sem Navegação Manual:** Para evitar que o usuário precise alternar abas para carregar o histórico de pedidos recentes antes de visualizar o lote otimizado, o sistema aciona de forma transparente a sincronização de dados de faturamento do canal Smartped (chamando o endpoint `/api/pedidos-do-dia`) em dois pontos estratégicos:
    1.  **Na seleção do arquivo:** Assim que o comprador faz upload ou carrega o arquivo SICF (no `handleFileLoaded`), a busca em segundo plano é disparada utilizando o CNPJ detectado e o token configurado.
    2.  **No processamento de otimização:** Na inicialização da otimização real (`handleOptimize`), o sistema aguarda a resposta da API de pedidos recentes para garantir que os alertas estejam 100% atualizados antes de renderizar a SwapsTable.
*   **Cálculo Preciso de Últimos 2 Dias Úteis (Imunidade de Finais de Semana):** Para que compras realizadas às quintas, sextas ou finais de semana não sejam desconsideradas nas otimizações de segundas-feiras devido a janelas fixas de 48 horas de calendário, o sistema calcula dinamicamente as datas retroativas que correspondam estritamente a **2 dias úteis**. O algoritmo de cálculo retrocede até encontrar o limite de dias não-finais de semana (sábado/domingo), gerando um Set de correspondência confiável (ex: na segunda-feira, a verificação abrangerá as ordens de hoje, domingo, sábado e sexta-feira).
*   **Sinalizadores e Ação na Tabela de Trocas:** Se um medicamento de destino do swap (novo EAN) ou o próprio produto original já constar como enviado e faturado na distribuidora Profarma (Código de Distribuidor 4) dentro da janela calculada, um banner chamativo na linha da tabela adverte sobre o faturamento duplicado recente. O comprador dispõe de ações instantâneas de "Manter" ou "Excluir" o item do lote ativo para evitar compras redundantes.

### 4.12. Preparação de Infraestrutura e Deploy Prontos para Cloud Run
*   **Porta do Servidor Dinâmica:** O Express em `server.ts` está configurado para ler dinamicamente a variável de ambiente `PORT` provida no container do Cloud Run. Caso indisponível (como em produção local), o fallback assume o padrão `8080`, e em ambiente local do AI Studio assume `3000`, escutando na interface de rede universal `0.0.0.0` para conformidade estrita de ingress do GCP.
*   **Ambiente de Produção e Arquivos Estáticos:** Em tempo de execução em produção (`NODE_ENV === "production"`), o servidor desliga o middleware do Vite e serve estaticamente os arquivos prontos do frontend compilados na pasta `/dist`. Não há dependência de dependências de desenvolvimento ou transpiladores na nuvem.
*   **Configuração do Empacotamento via Esbuild:** No `package.json`, o script `npm run build` faz o bundle unificado do frontend (`vite build`) e também transpila e empacota o backend TypeScript `server.ts` em um único arquivo CommonJS executável e independente (`dist/server.cjs`), permitindo iniciar a aplicação em produção com o comando nativo `node dist/server.cjs`.

### 4.13. Blindagem de Faturamento Seguro de Lote Único (SmartPed Envio)
*   **Validação Estrita de Swaps:** Se um item original sofreu substituição (swap) por um equivalente, o sistema valida se os códigos identificadores (`codProduto` e `codProdutoDist`) são válidos (não vazios, não nulos, não strings `"null"` ou `"undefined"`, e estritamente diferentes de `"0"` ou `0`). Se for inválido, ele é omitido do lote para evitar faturamentos incorretos na distribuidora.
*   **Expurgo de Itens sem Distribuidora / Sem Estoque:** Qualquer item com código de distribuidora zerado (`codDist === 0` ou `originalCodDist === 0`), sem estoque, não encontrado ou com nome de distribuidora vazio é sumariamente bloqueado e expurgado antes da montagem final do JSON do payload para a SmartPed.
*   **Consolidação de Lote Único:** O backend unifica todos os itens faturáveis de todas as distribuidoras em uma única chamada POST para `/api/Pedido/Envio` da SmartPed, impedindo disparos em paralelo por distribuidora de forma separada que causariam o erro `"Já existe um envio pendente"`.

### 4.14. Painel de Revisão Otimizada de Alertas e Usabilidade UX (SwapsTable)
*   **Filtro Dinâmico de Alertas/Pendências com Expansão Automática:** Adição do filtro interativo `Apenas Alertas/Pendências` que oculta todos os itens normais do lote de cotação e destaca na tela de revisão apenas as anomalias que exigem validação do comprador. Quando ativado, o sistema **expande automaticamente todos os grupos/distribuidores que contêm itens com alerta**, poupando dezenas de cliques manuais. Ao desativá-lo, o layout volta ao modelo normal compacto. As regras de engajamento do filtro de alertas são:
    1.  Produtos com observações ou anotações personalizadas do sistema ou do usuário (`observacao`).
    2.  Medicamentos que não atingiram a quantidade mínima comercial exigida pelo fornecedor (`qtdMin`).
    3.  Medicamentos que excederam o limite máximo parametrizado (`qtdMax`).
    4.  Lotes cuja quantidade informada não seja múltiplo da caixa fechada (`cx`).
    5.  Otimizações (trocas) em que o preço do substituto acabou superando o preço do original (preço aumentado).
    6.  Itens alocados em distribuidoras virtuais ou sem ofertas ativas (*Não Encontrados* ou *Sem Estoque*).
    7.  Distribuidoras ou grupos cujas somatórias financeiras de itens ativos do lote ainda não ultrapassaram ou atingiram o valor mínimo de faturamento estabelecido.
    8.  Itens com o estado de falta absoluta (`originalSemEstoque` marcado como ativo).
*   **Barra de Controle de Grupo ("Recolher e Ir para o Próximo"):** Embaixo de cada tabela de distribuidora expandida, há uma barra de controle de revisão contendo o botão "Recolher e Ir para o Próximo". Ao clicar, o distribuidor que acaba de ser revisado é minimizado individualmente, e a tela realiza um scroll suave focalizando a cabeceira da próxima distribuidora pendente na ordem. Isso evita a necessidade de scrollar manualmente de volta ao topo de tabelas longas para fechar o distribuidor.
*   **Visualização de EAN de Original em Falta:** Quando um item original possui falta absoluta de estoque (`originalSemEstoque`), o painel de revisão exibe de forma destacada em vermelho brilhante o código de barras (EAN) original que faltou, acompanhado de um atalho visual (`EanEyeButton`) para consulta rápida.
*   **Comparador Dinâmico de Preço Benchmark:** O backend agora calcula dinamicamente o maior valor entre o preço histórico de compra importado no arquivo e o melhor preço de oferta real cotado hoje no mercado para o EAN original. Esse benchmark protege o algoritmo contra falsas economias baixas causadas por defasagem histórica, garantindo que o sistema recomende sempre a alternativa de menor preço de mercado e evite perdas financeiras.
*   **Achatamento Estrutural e Propagação Estrita de Propriedades na Raiz:** Em vez de depender de varreduras reversas complexas ou buscas paralelas no banco Trier/`EAN_DATABASE` para resolver nomes de medicamentos equivalentes, o sistema realiza agora o achatamento estrito do JSON de cotações na raiz (`server.ts` nos pontos de ingestão das cotações da SmartPed e na rotina `processReturnItens`). Cada filho (`Condicoes`) herda por herança direta as propriedades ricas de seu pai (`ItemPedido` / `Substitutos`), especificamente `Ean`, `Descricao` e `Laboratorio`, lendo-as de forma agnóstica a maiúsculas e minúsculas (PascalCase ou lowercase). Isso elimina de forma limpa a exibição de `"Medicamento Equivalente (EAN: ...)"` e garante dados completos e blindados tanto na UI quanto nas exportações.
*   **Inteligência Ativa de Reversão no "Manter Original":** O botão "Manter Original" foi blindado contra rupturas de estoque na distribuidora importada. Em vez de reverter o item de forma cega para a distribuidora original que pode estar sem saldo, o sistema pesquisa dinamicamente e resolve o item original para uma distribuidora ativa de mercado que de fato possua estoque real disponível hoje. Essa escolha stock-resolved reflete-se perfeitamente nas tabelas de revisão, nos payloads de faturamento enviados para a SmartPed e nas planilhas faturadas de exportação.

*   **Atalhos Flutuantes de Alta Performance:**
    *   *Botão Recolher Tudo:* Um botão flutuante pragmático (`FolderMinus`) que aparece dinamicamente sempre que houver lotes/distribuidoras abertos de forma expandida na tela. Com um único clique, minimiza todas de uma só vez e rola a janela suavemente de volta para o topo do painel de escolhas.
    *   *Botão Scroll to Top:* Um atalho redondo fixado no canto inferior direito que rola suavemente a tela para o topo absoluto do aplicativo, poupando a rolagem mecânica manual em pedidos gigantescos.

### 4.15. Tratamento de Inconsistência e Normalização Estrita de EANs (Zeros à Esquerda - Alcon / BD / Abbott)
*   **A Inconsistência da API:** Nos endpoints `RetornoCondicao` e `RetornoPedido`, a SmartPed retorna os EANs como String (ex: `"7896241225547"`). Entretanto, no endpoint `BuscaComparativa` (Cotação Individual/Similares), os EANs são retornados como **Número Inteiro Puro** (ex: `300652439266`).
*   **O Impacto nos Zeros à Esquerda:** Produtos importados ou específicos de laboratórios como Alcon (ex: Systane Ultra 10ml, EAN `0300652439266`), BD ou Abbott que iniciam com o dígito zero tinham o zero à esquerda removido na desserialização numérica da API (truncando para `300652439266`, com 12 dígitos), gerando falha total de cruzamento de dados contra o ERP local (Trier) ou bancos de dados locais que registram as strings completas com 13 dígitos (`"0300652439266"`).
*   **A Solução de Normalização de EAN (Barramento Unificado):** Unificamos todas as rotinas de limpeza e normalização (`cleanEan`, `cleanEanLocal` e `cleanEanString`) do frontend e backend para adotar uma lógica estrita baseada em `padStart`:
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
    Isso assegura que qualquer EAN numérico ou string com menos de 13 dígitos receba zeros à esquerda de forma precisa, eliminando conflitos de cruzamento e garantindo o correto faturamento de medicamentos importados com zero à esquerda.

### 4.16. Correções de Lógica Financeira (Benchmark), Filtro de Similares e UX de Navegação
*   **A "Regra de Ouro" de Preço Benchmark (`findBestSubstitute`):**
    O cálculo do Preço Benchmark (`precoBenchmark`) foi blindado contra falsas sugestões de economia. 
    * Se o produto original possui oferta ativa com estoque no mercado hoje, o benchmark passa a ser o **menor preço real de mercado ativo encontrado para o original**, garantindo que a sugestão de substituto seja vantajosa somente se for mais barata que a realidade imediata de compra do original.
    * Se o original está em ruptura absoluta (estoque zero em todas as distribuidoras), o benchmark recua com segurança para o preço histórico do ERP (cadastro de compra).
*   **Filtragem de Alternativas de Substitutos Ativas no Backend:**
    * No backend, na função `findBestSubstitute`, as ofertas comerciais concorrentes (`candidatosSubstitutos`) são filtradas estritamente para **remover qualquer alternativa cujo estoque na distribuidora seja menor ou igual a zero** (`estoque <= 0` ou `Estoque <= 0`) antes de qualquer cálculo de menor custo ou de economia. Isso impede a recomendação de trocas inviáveis por falta de estoque nas distribuidoras e elimina cortes desnecessários.
*   **Filtros no Modal de Similares (`SimilarProductsModal`):**
    * A lista local de produtos similares (`dataSimilares`) vinda da Trier não é filtrada pelo controle de estoque real de distribuidoras, já que este cadastro é puramente cadastral local.
    * O filtro `apenasComEstoqueOuMinimo` foi isolado para atuar exclusivamente sobre a lista de alternativas em tempo real da SmartPed (`smartPedAlternatives`) sob o memo `alternativesToShow`.
    * A restrição do estoque mínimo foi revisada: itens com `qtdMin: 0` na SmartPed representam a ausência de mínimo (condição excelente de compra) e são mantidos na exibição, não sendo mais filtrados incorretamente.
    * **Filtragem de Similares Locais por Estoque Físico Real:** Corrigimos a lógica de exibição dos similares locais (`produtosExibidos`) para checar **estritamente se há saldo físico em estoque** (`estoque > 0`) sob as chaves de fallback do ERP Trier, eliminando o operador `|| minimo > 0` que ocultava indisponibilidades se o produto tivesse um mínimo cadastrado.
*   **Melhoria de UX de Navegação por Distribuidoras (`SwapsTable`):**
    * Ao clicar no botão "Recolher e Ir para o Próximo", o sistema força a expansão (`isOpen = true`) da próxima distribuidora pendente na lista (`setExpandedGroups`) 100ms antes de disparar o scroll suave. Isso evita que o usuário seja direcionado a um painel recolhido/fechado de forma desorientadora.
*   **Enriquecimento de Descrições e Cobertura Dupla de EANs (Monitoramento):**
    * Adicionados os cadastros estáticos para os EANs `7891142165770` (Macrodantina 100mg C/28 Caps) e `7896112127680` (Maleato de Dexclorfeniramina 0,4mg/ml XPE 100ml) diretamente na base de dados de ERP simulada (`src/utils.ts` em `SAMPLE_SICF_FILE` e `HOMOLOGACAO_SICF_FILE`), garantindo que o `EAN_DATABASE` resolva os nomes instantaneamente.
    * O resolvedor de descrições no backend (`fetchEanDescriptions` em `server.ts`) foi otimizado para possuir **dupla-cobertura**: os itens que não são encontrados pelo endpoint de moléculas (`api/Condicoes/Molecula`) agora passam automaticamente por uma consulta secundária em lote no endpoint de cotação direta por EAN (`api/Condicoes/Ean`). Isso assegura que 100% dos itens do faturamento recebam sua descrição comercial legítima de forma dinâmica pela API.

---

## 5. Estado Atual, Débitos Técnicos e Pontos Sensíveis

### ☢️ Zonas de Perigo Extremo (MUITO CUIDADO AO MODIFICAR)
1.  **Manipulação de Propriedades da API Externa (`server.ts`):** A resposta da SmartPed é muito inconsistente nas maiúsculas/minúsculas. Existem códigos como `s.CodDist !== undefined ? s.CodDist : s.codDist` e `item.Ean || item.ean`. **Nunca presuma que a tipagem exata vinda da rede está perfeita.** Preserve as checagens com duplo *fallback*.
2.  **Construção de Strings SICF (`lineFinal = ["2", novoEan, ...].join(";")`):** Inserir arrays, colunas adicionais, espaços, ou falhar na conversão do preço de `.` (ponto) para o padrão esperado, irá quebrar o parser do ERP do cliente final. Modifique isso apenas de forma cirúrgica.
3.  **Monólito do `server.ts`:** O arquivo está massivo (quase 2 mil linhas). Ele mescla regras de roteamento HTTP, parsing de texto, algoritmia de precificação cruzada e fallback mockado estático. Se for refatorar, quebre em módulos como `parser.ts`, `apiClient.ts` e `optimizerLogic.ts`, mas tenha em mente o limite de contexto de geração de código.

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

**Variáveis de Ambiente / Conexão:**
*   Todas as credenciais, tokens, CNPJs e URLs externas são centralizadas no bloco `CONFIG` no topo de `server.ts`, que lê de `process.env` com fallbacks. As variáveis são definidas no arquivo `.env` (não commitado).
*   Variáveis disponíveis: `SMARTPED_PRODUCTION_TOKEN`, `SMARTPED_SANDBOX_TOKEN`, `SMARTPED_DEFAULT_CNPJ`, `SMARTPED_PRODUCTION_URL`, `SMARTPED_SANDBOX_URL`, `FERRAMENTINHAS_API_URL`, `APP_ADMIN_EMAILS`, `APP_ADMIN_PASSWORD`.
*   O sistema depende primordialmente das chaves fornecidas *pelo cliente* no `<ConfigurationPanel />` da tela (CNPJ do cliente, Token SmartPed). O tráfego seguro do Backend é o que esconde as requisições, agindo como um proxy para evitar quebra de CORS de navegadores cliente.


## 7. Guia de Testes, Diagnósticos e APIs de Referência (Para Prevenção de Desvios)

### 7.1. Massa de Testes Real (EAN de Diagnóstico)
*   **EAN de Teste Central:** `7896714290492`
*   **Produto Associado:** `PANTOPRAZOL 40MG 28CPR GEN NEO QUIMICA`
*   **Laboratório:** `Neo Química`

### 7.2. Detalhes de Integração e Endpoints

#### A) API de Condições SmartPed (Produção Real)
*   **Base URL:** Definida em `CONFIG.SMARTPED_PRODUCTION_URL` (env: `SMARTPED_PRODUCTION_URL`, padrão: `https://api.smartped.com.br`)
*   **Token de Produção:** Definido em `CONFIG.SMARTPED_PRODUCTION_TOKEN` (env: `SMARTPED_PRODUCTION_TOKEN`)
*   **Token de Sandbox:** Definido em `CONFIG.SMARTPED_SANDBOX_TOKEN` (env: `SMARTPED_SANDBOX_TOKEN`)
*   **CNPJ Padrão:** Definido em `CONFIG.SMARTPED_DEFAULT_CNPJ` (env: `SMARTPED_DEFAULT_CNPJ`)
*   **Endpoints Principais:**
    *   `/api/Condicoes/Ean`: Retorna condições comerciais diretas do produto de todas as distribuidoras liberadas para envio.
    *   `/api/Condicoes/Molecula`: Fornece substitutos com base na molécula.

#### B) API do ERP Local / Trier (Ferramentinhas Similares)
*   **Base URL:** Definida em `CONFIG.FERRAMENTINHAS_API_URL` (env: `FERRAMENTINHAS_API_URL`, padrão: `https://api.ferramentinhas.com.br`)
*   **Endpoint de Similares:** `${CONFIG.FERRAMENTINHAS_API_URL}/api/produtos/similares/${ean}`
*   **Documentação Completa:** Ver `API_TREE_TRIER.md` (camadas Ferramentinhas + SGF API nativa)
*   **Retorno Típico:** Retorna um objeto no formato `{ success: boolean, encontrou: boolean, produtos: SimilarProduct[] }`.
*   **Estrutura de Propriedades dos Produtos do ERP:**
    *   `ean`: Código de barras cadastrado localmente no ERP.
    *   `nom_produto`: Nome do medicamento.
    *   `nom_laborat`: Laboratório fabricante.
    *   `qtd_estoque`: Estoque físico atualmente disponível.
    *   `vlr_custopersonalizado`: Preço de custo líquido personalizado de compra.
    *   `vlr_venda_tabela`: Preço de venda cheio de tabela sem as promoções locais aplicadas.
    *   `vlr_venda_final`: Preço de venda líquida final (valor real de prateleira praticado na farmácia com desconto).

### 7.3. Regra de Ouro de Exibição de Preços no Modal de Similares (`SimilarProductsModal.tsx`)
Para evitar discrepâncias em que o preço de venda é exibido igual ao preço de tabela cheio (ignorando os descontos da farmácia), a interface do usuário **DEVE obrigatoriamente priorizar a exibição de `vlr_venda_final`** e, apenas caso este seja nulo ou indefinido, usar o `vlr_venda_tabela` como fallback.
*   **Expressão Correta em Código:**
    `prod.vlr_venda_final !== undefined ? formatCurrency(prod.vlr_venda_final) : formatCurrency(prod.vlr_venda_tabela)`

### 7.4. Equivalência Estrita, Validação e Alertas de Quantidade (Fases 1 e 2)
Para evitar trocas inválidas de medicamentos com dosagens diferentes, fracionados incorretos, sabores misturados ou preços abusivos:
1. **Match de Equivalência Estrita Multidimensional (`validateSwapEquivalence` no backend):**
    * **Dosagem e Volumetria:** O backend extrai todas as concentrações/dosagens via regex (ex: `5MG`, `100ML`, `0.4MG/ML`). Se houver qualquer divergência de dosagem, o swap é bloqueado.
    * **Quantidade de Comprimidos / Apresentação:** Extrai a contagem de comprimidos/cápsulas/drágeas (ex: `15CP`, `30CP`, `60CP`, `30 COMP`). A quantidade no substituto deve bater exatamente com a do original, bloqueando compras que cubram tratamentos parciais (ex: sugerir 15CP para cobrir receita de 30CP).
    * **Sabor, Fragrância e Cor (Correlatos/Eno/Esmaltes):** Usa regex para caçar termos sensíveis de sabor, fragrância ou cor (ex: `Limão`, `Guaraná`, `Renda`, `Rosa`, `Ametista`). Exige correspondência exata de 100% (ex: impede troca de Eno Limão por Guaraná ou esmalte Renda por Rosa).
2. **Busca de Equivalentes Locais baseada em Interseção Flexível de Tokens (`getLocalEquivalents`):**
    * Substitui buscas rígidas por uma correspondência flexível onde a descrição de entrada é dividida em palavras-chave.
    * Remove sais e termos de ligação de ruído comuns (ex: `SODICO`, `CLORIDRATO`, `MALEATO`, `CALCICA`, `SULFATO`).
    * Garante match instantâneo e robusto se todos os termos essenciais remanescentes (ex: `PANTOPRAZOL` e `20MG`) estiverem contidos na chave do banco local, resolvendo a visão em túnel de produtos como o Pantoprazol Eurofarma.
3. **Busca Textual de Fallback Dinâmica no Lote:**
    * Se o EAN original ou a distribuidora original de um item processado no lote automático estiver sem estoque, o backend dispara síncronamente uma busca por princípio ativo/molécula/texto diretamente na SmartPed (integrando os resultados de `Condicoes/Molecula` e `Produtos/Buscar`). Isso garante que o lote venha enriquecido e completo de primeira.
4. **Tratamento de Embalagens Coletivas e Fracionados (`alertaConfirmarQtd`):** O backend calcula se a quantidade e preço sugerem embalagem coletiva (ex: termos como `"C/"`, `"CX/"`, `"DISPLAY"`, ou fator `cx > 1` com quantidade não múltipla). Também sinaliza se houver salto de preço abusivo (> 1.5x do original).
5. **Interface do Usuário com Ações Rápidas de Ajuste:** A tabela principal (`SwapsTable.tsx`) e o modal de detalhes (`InterchangeabilityModal.tsx`) renderizam um card em amarelo âmbar com o `motivoAlerta` e um campo numérico com o botão "OK" direto. Digitar `0` remove o item do lote.

### 7.5. Deduplicação Inteligente de Ofertas e Cockpit Comercial no Modal de Similares (`SimilarProductsModal.tsx`)
Para resolver o problema de condições duplicadas de mesma distribuidora (decorrentes de múltiplos prazos e campanhas na SmartPed) e evitar rejeições de pedidos com erro `"ERR:ABAIXO DO MINIMO"`:
1. **Deduplicação Inteligente de Ofertas (Foco no Melhor Prazo/Preço):**
   * As ofertas retornadas pela SmartPed são agrupadas pela chave composta `EAN + CodDist`.
   * **Critério de Seleção:** Para cada distribuidora, é mantida a oferta com o **menor preço líquido** (`Pliquido` / `PliquidoUni`).
   * **Critério de Desempate:** Em caso de empate no preço líquido, o sistema elege automaticamente o item com o **maior Prazo** (melhor condição de fluxo de caixa para a farmácia).
2. **Grade Comercial Rica e Completa (12 Colunas Estritas):**
   A tabela de similares do modal manual exibe as seguintes 12 colunas formatadas e alinhadas:
   1. `Distribuidora` (`NomeDist` / `Nome_Dpe`)
   2. `Produto / EAN` (`Descricao` e `Ean`)
   3. `Laboratório` (`Laboratorio`)
   4. `Preço Fábrica/Bruto` (`Preco` / `Preco_idi` via `formatCurrency`)
   5. `Desconto %` (`Desconto`)
   6. `Desconto Extra %` (`DescExtra`)
   7. `ST (Imposto)` (`ValorST` / `ValorSt`)
   8. `Preço Líquido` (`Pliquido` / `PliquidoUni` destacado em verde esmeralda)
   9. `Prazo` (`Prazo` - ex: "28 dias")
   10. `Qtd Mínima (Item)` (`QtdMin` com alerta visual destacado em amarelo/vermelho caso exija quantidade mínima de compra)
   11. `Ped. Mínimo (Distribuidora)` (`VlrMinimo` cruzado dinamicamente no array de `minimos` por `CodDist + Condicao + Prazo`)
   12. `Ações` (Botão de adicionar a oferta diretamente ao faturamento)
3. **Barra de Pesquisa Manual Rápida:**
   Permite ao operador digitar qualquer EAN ou descrição para re-cotar e comparar alternativas em tempo real diretamente na SmartPed com filtros de estoque e deduplicação instantâneos.

### 7.6. Scripts Rápidos para Validação de Fluxos
*   `test_smartped_ean.cjs`: Permite realizar consultas manuais aos endpoints `/api/Condicoes/Ean` e `/api/Condicoes/Molecula` usando o token real de diagnóstico para validar se a comunicação com a API da SmartPed está saudável.
*   `test_all_similares.cjs`: Permite realizar uma requisição limpa para a API do ERP Ferramentinhas de Similares a fim de verificar a resposta bruta de um determinado EAN e conferir as chaves de preços retornadas.

### 7.7. Resiliência de Expansão Híbrida, Preservação de Descrição Rica e Deduplicação por Chave Combinada
Para garantir que buscas textuais (como "hidroclorotiazida") encontrem todas as promoções especiais e condições agressivas de distribuidoras (ex: Gauchofarma a R$ 1,19 com condição numérica especial `115378` e QtdMin 12 un):
1. **Expansão Híbrida Resiliente com `Promise.all`:**
   * Em `/api/search-products`, a consulta paralela de EANs descobertos usa `Promise.all` para chamar AMBOS os endpoints (`Condicoes/Ean` + `Condicoes/Molecula`) por EAN, com isolamento de falha individual (`try/catch` por promise).
   * A falha de um EAN isolado não sabota as cotações comerciais dos demais produtos do lote.
   * A adição do `Condicoes/Molecula` foi essencial para trazer `QtdMin` dos substitutos moleculares, que o `Condicoes/Ean` sozinho não retornava na busca por descrição.
2. **Preservação da Descrição Comercial Rica e Laboratório Original:**
   * O backend utiliza um catálogo por EAN (`eanCatalogMap`) e os helpers `resolveBestDescription` e `resolveBestLaboratorio` para garantir que o nome de apresentação completo do produto (ex: `"HIDROCLOROTIAZIDA (G) 25MG 30CPM NEO"`) e seu laboratório real (ex: `"NEO QUIMICA"`) **nunca** sejam sobrescritos pelo termo de busca em minúsculo enviado pelo usuário.
3. **Deduplicação Final por Chave Combinada (`${Ean}_${CodDist}_${Condicao}_${Prazo}`):**
   * Antes do envio da resposta, a lista bruta `allAlternatives` passa por deduplicação estrita pela chave única comercial `${Ean}_${CodDist}_${Condicao}_${Prazo}`, mantendo a oferta de menor preço líquido caso ocorram duplicatas geradas pelas múltiplas chamadas à API da SmartPed, priorizando o menor preço líquido absoluto sem descarte por estoque/sob consulta.
4. **Padrões de Interface do Cockpit Manual (`SimilarProductsModal` / `App.tsx`):**
   * O checkbox "Deduplicação Inteligente" inicia **desmarcado por padrão** (`manualDeduplicar = false`), permitindo ao operador ver todas as condições e promoções existentes de imediato.
   * O checkbox "Apenas com Estoque" inicia **marcado por padrão** (`manualApenasEstoque = true`), com tolerância para promoções: se `Estoque > 0` OU se `QtdMin > 1` (ofertas promocionais sob consulta com lote mínimo exigido), o item é exibido em tela.
   * A grade comercial de 12 colunas conta com largura mínima garantida (`min-w-[1320px]`), cabeçalho fixo (`sticky top-0`), containers com `min-w-0 w-full max-w-full` e barra de rolagem horizontal personalizada (`custom-table-scrollbar`) para navegação em qualquer resolução.


