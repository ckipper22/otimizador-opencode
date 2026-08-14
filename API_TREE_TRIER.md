# Arvore de Consulta - API Trier

Sistema ERP local da farmacia. Fornece cadastro de produtos, estoque, precos de venda, similares e historico de vendas.

---

## Duas Camadas de Integracao

### Camada 1: Ferramentinhas (Middleware Proxy) - Em Uso Atual
**Base URL:** `https://api.ferramentinhas.com.br`
**Autenticacao:** Nenhuma (API publica, sem token)
**Metodo Padrao:** GET

### Camada 2: Trier SGF API (Integracao Direta com ERP)
**Base URL:** `http://{SERVER_IP}:4647/sgfpod1/rest`
**Autenticacao:** Bearer Token (fornecido por Trier Sistemas)
**Contato:** parcerias@grupotrier.com.br
**Versao:** 1.5.14

---

## Camada 1: Ferramentinhas (Endpoints Atuais)

### 1. Busca de Similares por EAN

```
GET /api/produtos/similares/{ean}
```

**Parametros:**
| Parametro | Tipo | Obrigatorio | Descricao |
|-----------|------|-------------|-----------|
| `ean` | string (path) | Sim | Codigo de barras do produto (13 digitos) |

**Resposta (200 OK):**
```json
{
  "success": true,
  "encontrou": true,
  "produtos": [
    {
      "ean": "7896241225547",
      "cod_barra": "7896241225547",
      "nom_produto": "PANTOPRAZOL 20MG 28CPR",
      "descricao": "PANTOPRAZOL 20MG 28CPR",
      "nom_laborat": "EUROFARMA",
      "laboratorio": "EUROFARMA",
      "qtd_estoque": 15,
      "est_minimo": 5,
      "est_maximo": 50,
      "estoque_maximo": 50,
      "maximo": 50,
      "cod_reduzido": "12345",
      "vlr_custopersonalizado": "8.50",
      "vlr_venda_tabela": "22.90",
      "vlr_venda_final": "18.50",
      "dat_ultent": "2025-01-15",
      "cod_dcb": "PANTOPRAZOL",
      "cod_concentracao": "20MG"
    }
  ]
}
```

**Uso no sistema (`server.ts`):**
- **Linha 975** - `fetchSimilarGenerics()`: Busca genericos equivalentes para substituicao de faltas
- **Linha 1866** - Busca de fallback na otimizacao automatica do lote
- **Linha 4906** - Descoberta de DCB/composicao para busca de substitutos SmartPed
- **Linha 5692** - Endpoint `/api/similares/:ean`: Consulta principal do botao "Olhinho"

**Chaves de extracao de estoque (fallbacks em cascata):**
```
qtd_estoque > est_minimo > 0
```

**Chaves de extracao de preco de venda (prioridade):**
```
vlr_venda_final (preco com desconto da farmacia - PRIORITARIO)
  > vlr_venda_tabela (preco cheio de tabela)
  > vlr_custopersonalizado (custo personalizado)
```

**Chaves de extracao de estoque maximo (fallbacks):**
```
est_maximo > estoque_maximo > maximo
```

**Notas:**
- O ERP Trier e o banco local de referencia da farmacia
- Produtos retornados sao injetados dinamicamente no `EAN_DATABASE` em memoria para cache
- A busca textual por similaridade usa `getMoleculeBase()` + intersecao de palavras-chave
- Filtro de estoque ativo na UI: `estoque > 0` OU `minimo > 0`

---

### 2. Vendas Detalhadas por EAN

```
GET /api/chatbot/produto/vendas-detalhadas/{ean}
```

**Parametros:**
| Parametro | Tipo | Obrigatorio | Descricao |
|-----------|------|-------------|-----------|
| `ean` | string (path) | Sim | Codigo de barras do produto |

**Resposta:** Objeto com historico detalhado de vendas do produto no ERP.

**Uso no sistema (`server.ts`):**
- **Linha 5899** - Endpoint interno `/api/vendas-detalhadas/:ean` (proxy)

---

### 3. Vendas Semanais por EAN

```
GET /api/chatbot/produto/vendas-semanais/{ean}
```

**Parametros:**
| Parametro | Tipo | Obrigatorio | Descricao |
|-----------|------|-------------|-----------|
| `ean` | string (path) | Sim | Codigo de barras do produto |

**Resposta:** Objeto com historico de vendas semanais do produto.

**Uso no sistema (`server.ts`):**
- **Linha 5915** - Endpoint interno `/api/vendas-semanais/:ean` (proxy)

---

## Camada 2: Trier SGF API (Integracao Direta)

### Parametros Comuns

Todos os endpoints SGF seguem padroes consistentes:

**Paginacao (Obrigatoria):**
| Parametro | Tipo | Obrigatorio | Descricao |
|-----------|------|-------------|-----------|
| `primeiroRegistro` | int32 | Sim | Offset (inicio da paginacao) |
| `quantidadeRegistros` | int32 | Sim | Limite de registros por pagina |

**Filtro por Data (ISO 8601):**
| Parametro | Tipo | Obrigatorio | Descricao |
|-----------|------|-------------|-----------|
| `dataInicial` | string (ISO 8601) | Nao | Data inicio do filtro |
| `dataFinal` | string (ISO 8601) | Nao | Data fim do filtro |

**Filtros Adicionais:**
| Parametro | Tipo | Descricao |
|-----------|------|-----------|
| `codigo` | string | Codigo especifico da entidade |
| `ativo` | boolean | Filtrar por status ativo/inativo |

---

### Produto (Products) - RELEVANCIA: ALTA

#### Obter Produtos por Filtro
```
GET /integracao/produto/obter-v1
```
**Parametros:** primeiroRegistro, quantidadeRegistros, codigo, codigoBarra, ativo
**Uso SmartPed:** Consulta principal de produtos do catalogo

#### Obter Produtos Alterados
```
GET /integracao/produto/obter-alterados-v1
```
**Parametros:** primeiroRegistro, quantidadeRegistros, dataInicial, dataFinal
**Uso SmartPed:** Sincronizacao incremental de atualizacoes de produtos

#### Obter Produtos Movimentados
```
GET /integracao/produto/obter-movimentados-v1
```
**Parametros:** primeiroRegistro, quantidadeRegistros, dataInicial, dataFinal
**Uso SmartPed:** Identificar produtos com movimentacao no periodo

#### Obter Todos os Produtos
```
GET /integracao/produto/obter-todos-v1
```
**Parametros:** primeiroRegistro, quantidadeRegistros
**Uso SmartPed:** Carga completa do catalogo (bulk)

#### Obter Identificadores do Produto
```
GET /integracao/produto/identificador/obter-v1
```
**Parametros:** primeiroRegistro, quantidadeRegistros, codigo
**Uso SmartPed:** Buscar EANs/codigos de barras de um produto

#### Obter Principio Ativo
```
GET /integracao/produto/principio-ativo/obter-v1
```
**Parametros:** primeiroRegistro, quantidadeRegistros
**Uso SmartPed:** Busca de equivalentes genericos por principio ativo (DCB)

---

### Estoque (Stock) - RELEVANCIA: ALTA

#### Obter Estoque por Filtro
```
GET /integracao/estoque/obter-v1
```
**Parametros:** primeiroRegistro, quantidadeRegistros, codigo
**Uso SmartPed:** Consulta de estoque atual por produto

#### Obter Alteracoes de Estoque
```
GET /integracao/estoque/obter-alterados-v1
```
**Parametros:** primeiroRegistro, quantidadeRegistros, dataInicial, dataFinal
**Uso SmartPed:** Monitorar mudancas de estoque

#### Obter Movimentacoes de Estoque
```
GET /integracao/estoque/obter-movimentados-v1
```
**Parametros:** primeiroRegistro, quantidadeRegistros, dataInicial, dataFinal
**Uso SmartPed:** Auditoria de movimentacoes (entradas/saidas)

#### Obter Todo Estoque
```
GET /integracao/estoque/obter-todos-v1
```
**Parametros:** primeiroRegistro, quantidadeRegistros
**Uso SmartPed:** Snapshot completo de estoque

---

### Precificação (Pricing) - RELEVANCIA: ALTA

#### Obter Precificacao por Filtro
```
GET /integracao/produto/precificacao/obter-v1
```
**Parametros:** primeiroRegistro, quantidadeRegistros, codigo
**Uso SmartPed:** Consulta de preco atual do produto

#### Obter Alteracoes de Precificacao
```
GET /integracao/produto/precificacao/obter-alterados-v1
```
**Parametros:** primeiroRegistro, quantidadeRegistros, dataInicial, dataFinal
**Uso SmartPed:** Monitorar mudancas de preco

#### Obter Movimentacoes de Precificacao
```
GET /integracao/produto/precificacao/obter-movimentados-v1
```
**Parametros:** primeiroRegistro, quantidadeRegistros, dataInicial, dataFinal
**Uso SmartPed:** Historico de alteracoes de preco

#### Obter Toda Precificacao
```
GET /integracao/produto/precificacao/obter-todos-v1
```
**Parametros:** primeiroRegistro, quantidadeRegistros
**Uso SmartPed:** Exportacao completa de precos

---

### Desconto (Discounts) - RELEVANCIA: MEDIA

#### Desconto por Vigencia
```
GET /integracao/produto/desconto/vigencia/*
```
**Uso SmartPed:** Consultar descontos ativos por periodo de validade

#### Desconto por Empresa + Grupo Produto
```
GET /integracao/produto/desconto/empresa-grupo-produto/*
```
**Uso SmartPed:** Descontos especificos por empresa e categoria

#### Desconto por Parceiro
```
GET /integracao/produto/desconto/parceiro/*
```
**Uso SmartPed:** Descontos para parceiros comerciais

#### Desconto por Encarte
```
GET /integracao/produto/desconto/encarte/*
```
**Uso SmartPed:** Descontos de encarte/folheto promocional

#### Desconto por Grupo + Condicao Pagamento
```
GET /integracao/produto/desconto/grupo/*
```
**Uso SmartPed:** Descontos por grupo de pagamento

#### Desconto por Produto + Condicao Pagamento
```
GET /integracao/produto/desconto/condicao-pagamento/*
```
**Uso SmartPed:** Descontos especificos por forma de pagamento

#### Desconto Progressivo
```
GET /integracao/produto/desconto/progressivo/*
```
**Uso SmartPed:** Regras de desconto progressivo por quantidade

#### Melhor Desconto
```
GET /integracao/produto/desconto/melhor/*
```
**Uso SmartPed:** Consultar o melhor desconto disponivel para um produto

---

### Venda (Sales) - RELEVANCIA: ALTA

#### Obter Vendas por Filtro
```
GET /integracao/venda/obter-v1
```
**Parametros:** primeiroRegistro, quantidadeRegistros, codigo
**Uso SmartPed:** Consulta de vendas realizadas

#### Obter Vendas Alteradas
```
GET /integracao/venda/obter-alterados-v1
```
**Parametros:** primeiroRegistro, quantidadeRegistros, dataInicial, dataFinal
**Uso SmartPed:** Sincronizacao de vendas atualizadas

#### Obter Todas as Vendas
```
GET /integracao/venda/obter-todos-v1
```
**Parametros:** primeiroRegistro, quantidadeRegistros
**Uso SmartPed:** Exportacao/historico completo de vendas

#### Cancelamentos de Venda
```
GET /integracao/venda/cancelamento/*
```
**Uso SmartPed:** Consultar vendas canceladas

#### Atendimentos Diarios por Vendedor
```
GET /integracao/venda/obter-atendimentos-diario-vendedor-v1
```
**Parametros:** primeiroRegistro, quantidadeRegistros, dataInicial, dataFinal
**Uso SmartPed:** Performance diaria de vendedores

---

### Compra (Purchases) - RELEVANCIA: MEDIA

#### Obter Compras por Filtro
```
GET /integracao/compra/obter-v1
```
**Parametros:** primeiroRegistro, quantidadeRegistros, codigo
**Uso SmartPed:** Consulta de compras de fornecedores

#### Obter Compras Alteradas
```
GET /integracao/compra/obter-alterados-v1
```
**Parametros:** primeiroRegistro, quantidadeRegistros, dataInicial, dataFinal
**Uso SmartPed:** Sincronizacao de compras atualizadas

---

### SmartPed (Integracao Nativa Trier) - RELEVANCIA: ALTA

#### Obter Dados SmartPed
```
GET /integracao/smartped/obter-v1
```
**Parametros:** primeiroRegistro, quantidadeRegistros
**Uso SmartPed:** Integracao direta com modulo SmartPed do Trier

#### Obter Todos os Dados SmartPed
```
GET /integracao/smartped/obter-todos-v1
```
**Parametros:** primeiroRegistro, quantidadeRegistros
**Uso SmartPed:** Exportacao completa de dados SmartPed

**Nota:** Trier possui modulo SmartPed nativo no ERP. Este endpoint acessa dados ja existentes no sistema.

---

### Cliente (Customers) - RELEVANCIA: ALTA

#### Obter Clientes por Filtro
```
GET /integracao/cliente/obter-v1
```
**Parametros:** primeiroRegistro, quantidadeRegistros, codigo
**Uso SmartPed:** Cadastro de clientes para roteirizacao

#### Obter Clientes Alterados
```
GET /integracao/cliente/obter-alterados-v1
```
**Parametros:** primeiroRegistro, quantidadeRegistros, dataInicial, dataFinal
**Uso SmartPed:** Sincronizacao de atualizacoes de clientes

---

### Laboratorio (Laboratory) - RELEVANCIA: MEDIA

#### Obter Laboratorios por Filtro
```
GET /integracao/laboratorio/obter-v1
```
**Parametros:** primeiroRegistro, quantidadeRegistros, codigo
**Uso SmartPed:** Cadastro de laboratorios/fabricantes

#### Obter Laboratorios Alterados
```
GET /integracao/laboratorio/obter-alterados-v1
```
**Parametros:** primeiroRegistro, quantidadeRegistros, dataInicial, dataFinal
**Uso SmartPed:** Sincronizacao de atualizacoes de laboratorios

---

### Fornecedor (Supplier) - RELEVANCIA: MEDIA

#### Obter Fornecedores por Filtro
```
GET /integracao/fornecedor/obter-v1
```
**Parametros:** primeiroRegistro, quantidadeRegistros, codigo
**Uso SmartPed:** Cadastro de fornecedores

#### Obter Fornecedores Alterados
```
GET /integracao/fornecedor/obter-alterados-v1
```
**Parametros:** primeiroRegistro, quantidadeRegistros, dataInicial, dataFinal
**Uso SmartPed:** Sincronizacao de atualizacoes de fornecedores

---

### Pedido (Order) - RELEVANCIA: ALTA

#### Obter Pedidos (Resumido)
```
GET /integracao/pedido/resumido/obter-v1
```
**Parametros:** primeiroRegistro, quantidadeRegistros, codigo
**Uso SmartPed:** Consulta de pedidos de venda

#### Obter Itens do Pedido (Resumido)
```
GET /integracao/pedido/itens/resumido/obter-v1
```
**Parametros:** primeiroRegistro, quantidadeRegistros, codigo
**Uso SmartPed:** Detalhamento de itens por pedido

---

## Endpoints Internos do Backend (Proxy)

O backend (`server.ts`) expoe estes endpoints que consomem a Trier indiretamente:

| Rota Interna | Metodo | Rota Trier Chamada | Descricao |
|--------------|--------|-------------------|-----------|
| `/api/similares/:ean` | GET | `/api/produtos/similares/{ean}` | Busca de similares do Olhinho + fallback por descricao |
| `/api/vendas-detalhadas/:ean` | GET | `/api/chatbot/produto/vendas-detalhadas/{ean}` | Proxy direto de vendas detalhadas |
| `/api/vendas-semanais/:ean` | GET | `/api/chatbot/produto/vendas-semanais/{ean}` | Proxy direto de vendas semanais |

---

## Fluxo de Consulta Tipico

```
[Frontend]
    │
    ├── Botao "Olhinho" (SimilarProductsModal)
    │       │
    │       ▼
    │   GET /api/similares/:ean?descricao=...&forceDesc=false
    │       │
    │       ▼
    │   [Backend server.ts]
    │       │
    │       ├── 1. GET ferramentinhas /api/produtos/similares/{ean}
    │       │       │
    │       │       ├── Se encontrou && !forceDesc → Retorna direto
    │       │       └── Se nao encontrou ou forceDesc → Passo 2
    │       │
    │       └── 2. Fallback por descricao (getMoleculeBase + busca local)
    │               └── Compara palavras-chave com EAN_DATABASE em memoria
    │
    ├── Busca de Faltas (DailyItemsView)
    │       │
    │       ▼
    │   GET /api/similares/:ean (para DCB/composicao)
    │       │
    │       ▼
    │   Usa descricao + DCB para buscar substitutos na SmartPed
    │
    └── View de Vendas (historico)
            │
            ▼
        GET /api/vendas-detalhadas/:ean → Trier
        GET /api/vendas-semanais/:ean → Trier
```

---

## Cache e Persistencia

- Os produtos retornados pela Trier sao salvos em `EAN_DATABASE` (objeto em memoria no backend)
- Campos persistidos por produto:
  ```
  descricao, laboratorio, precoOriginal, qtd_estoque, est_minimo,
  est_maximo, cod_reduzido, vlr_custopersonalizado, vlr_venda_tabela,
  vlr_venda_final, dat_ultent, cod_dcb, cod_concentracao
  ```
- O cache e populado incrementalmente: cada consulta de similares alimenta a base
- Nao ha TTL ou expiracao (o servidor reinicia a cada deploy)

---

## Estrategia de Integracao Recomendada

### Fase 1: Ferramentinhas (Atual)
- Manter endpoints Ferramentinhas para funcionalidades existentes
- Sem mudanca de autenticacao
- Baixo risco

### Fase 2: Trier SGF API (Futuro)
- Implementar integracao direta com endpoints SGF para dados mais completos
- Necessario: Token Bearer + acesso ao servidor Trier (IP/porta)
- Endpoints prioritarios:
  1. `/integracao/produto/obter-v1` (catalogo completo)
  2. `/integracao/estoque/obter-v1` (estoque em tempo real)
  3. `/integracao/venda/obter-v1` (historico de vendas)
  4. `/integracao/cliente/obter-v1` (base de clientes)

### Fase 3: Sincronizacao Incremental
- Usar endpoints `obter-alterados-v1` para sincronizacao eficiente
- Job de sincronizacao periodica (ex: a cada 15 minutos)
- Filtros por data para reduzir volume de dados

---

## Contato para Acesso SGF API

**Trier Sistemas:** parcerias@grupotrier.com.br
**Documentacao:** Solicitar documentacao completa da versao 1.5.14
**Requisitos:**
- IP do servidor ERP da farmacia
- Porta 4647 aberta no firewall
- Token de autenticacao Bearer
- Configuracao de CORS se acesso via browser