# Arvore de Consulta - API SmartPed

Integradora de pedidos para distribuidoras farmaceuticas. Fornece condicoes comerciais, cotacoes, substitutos, envio de pedidos e monitoramento de faturamento.

**Base URLs:**
- Producao: `https://api.smartped.com.br`
- Sandbox/Teste: `https://apitest.smartped.com.br`

**Autenticacao:** Token no body do POST (campo `Token`)
**Metodo Padrao:** POST (exceto endpoints de diagnostico)
**Content-Type:** `application/json`

---

## 1. Condicoes por EAN (`/api/Condicoes/Ean`)

Retorna condicoes comerciais diretas do produto em todas as distribuidoras liberadas.

```
POST /api/Condicoes/Ean
```

**Request Body:**
```json
{
  "Token": "seu_token_aqui",
  "parametros": {
    "CnpjCLi": "13408443000168",
    "Ean": "7896714290492",
    "AceitaOntem": 1
  }
}
```

**Parametros do Body:**
| Campo | Tipo | Obrigatorio | Descricao |
|-------|------|-------------|-----------|
| `Token` | string | Sim | Token de autenticacao da API |
| `parametros.CnpjCLi` | string | Sim | CNPJ do cliente (sem pontuacao) |
| `parametros.Ean` | string | Sim | EAN(s) separados por virgula (lotes de ate 40). **INFO DIOGO (24/08/2026):** endpoint JÁ aceita múltiplos EANs — não precisa chamar EAN por EAN |
| `parametros.AceitaOntem` | number | Nao | 1 = aceita condicoes do dia anterior |

**Resposta (200 OK) - Estrutura:**
```json
{
  "Retorno": {
    "itens": [
      {
        "ItemPedido": {
          "Ean": "7896714290492",
          "Descricao": "PANTOPRAZOL 40MG 28CPR",
          "Laboratorio": "NEO QUIMICA",
          "PMC": "45.90",
          "Preco": "12.50",
          "PrecoOriginal": "12.50"
        },
        "Condicoes": [
          {
            "CodDist": 4,
            "NomeDist": "PROFARMA [SP]",
            "Pliquido": "8.50",
            "PliquidoUni": "8.50",
            "Preco": "12.50",
            "PrecoOriginal": "12.50",
            "Desconto": "32.00",
            "DescExtra": "0.00",
            "ValorST": "0.00",
            "Prazo": "28 dias",
            "Estoque": 2,
            "QtdMin": 0,
            "Condicao": "A VISTA",
            "TipoItem": "G"
          }
        ]
      }
    ],
    "minimos": [
      {
        "CodDist": 4,
        "Condicao": "A VISTA",
        "Prazo": "28 dias",
        "VlrMinimo": 300.00,
        "QtdMinima": 0
      }
    ]
  }
}
```

**Uso no sistema (`server.ts`):**
- **Linha 306** - `fetchEanDescriptions()`: Descricao e laboratorio para faturamento
- **Linha 347** - Fallback de cobertura dupla (se Molecula nao resolveu)
- **Linha 1619** - Cotacao paralela na otimizacao do lote
- **Linha 3558** - Consulta em pedidos-do-dia para enriquecimento de descricoes
- **Linha 4069** - Consulta de distribuidores disponiveis
- **Linha 4391** - Busca hibrida: expansao comercial de EANs descobertos por descricao
- **Linha 470** - Endpoint diagnostico: Validacao de comunicacao com a API
- **Linha 4955** - Busca profunda de substitutos (Cockpit Commercial)
- **Linha 5471** - Cotacao em lote para busca de faltas/redistribuicao
- **Linha 5956** - Endpoint diagnostico EAN

**Chaves de extração de preco (fallbacks):**
```
PliquidoUni > Pliquido > Preco > PrecoOriginal
```

**Chaves de estoque (normalizacao via parseSmartPedEstoque):**
```
0 = Sem Estoque
1 = Baixo / Sob Consulta
2 = Estoque Normal
```

**Campos PMC (extração via extractPmc com varredura multipropriedades):**
```
PMC > pmc > Pmc > VlrPmc > vlr_pmc
```

**Notas:**
- Aceita multiplos EANs separados por virgula (chunking em lotes de 40)
- SmartPed retorna EANs como String neste endpoint
- PMC e Preco de Tabela vêm aninhados dentro de cada ItemPedido
- **Resposta inclui array `dists[]` (ou `Dists[]`) na raiz de `Retorno`:** Cada item tem `CodDist` e `NomeDist`. Este array é a fonte primária para popular o cache dinâmico de nomes de distribuidoras (`enrichDistribuidoresFromPayload`). **Não confiar que `NomeDist` venha no objeto `Condicoes[]` individual** — vem separado no `dists[]`.
- **⚠️ BUSCA SEQUENCIAL (INFO DIOGO):** API usa tabela temporária. Requests paralelos sobrescrevem os dados. Sempre usar `await` sequencial com delay entre chamadas quando usando lote de EANs.

> **⚠️ REGRAS CRÍTICAS PARA BUSCA POR DESCRIÇÃO (QtdMin)**
>
> **Causa raiz documentada (Bug 2026-08-14):** O QtdMin (quantidade mínima promocional)
> vem **principalmente do endpoint `Condicoes/Molecula`**, não do `Condicoes/Ean`.
> Qualquer código que busque condições comerciais por EAN **DEVE chamar AMBOS os endpoints
> em paralelo** (`Promise.all`). Chamar apenas `Condicoes/Ean` resulta em QtdMin=0 para
> a maioria das ofertas.
>
> **Padrão obrigatório para expansão de EANs:**
> ```javascript
> // CORRETO - chama ambos em paralelo
> const [eanData, molData] = await Promise.all([
>   fetchCondicoesEan(ean),
>   fetchCondicoesMolecula(ean)
> ]);
>
> // ERRADO - só chama Ean, perde QtdMin dos substitutos
> const eanData = await fetchCondicoesEan(ean);
> ```
>
> **Endpoints que implementam este padrão:**
> - `/api/search-products` (path de descrição) — `server.ts:~4510`
> - `/api/smartped-find-substitutes` (Expansão Híbrida) — `server.ts:~5750`
>
> **Parâmetros obrigatórios:**
> - `Condicoes/Ean`: `{ Ean, AceitaOntem: 1 }` — sem `AceitaOntem`, promoções do dia anterior são omitidas
> - `Condicoes/Molecula`: `{ Ean, ConsideraTipo: 1 }` — filtra substitutos por tipo de item
>
> **Cache de 5 minutos:** Implementado em ambos endpoints para estabilizar a experiência.
> Chave: `endpoint|EAN|token|CNPJ`. TTL: 5 minutos. Max: 2000 entradas.

---

## 2. Condicoes por Molecula (`/api/Condicoes/Molecula`)

Retorna substitutos genericos/similares com base na molecula do EAN consultado.

```
POST /api/Condicoes/Molecula
```

**Request Body:**
```json
{
  "Token": "seu_token_aqui",
  "parametros": {
    "CnpjCLi": "13408443000168",
    "Ean": "7896714290492",
    "ConsideraTipo": 1
  }
}
```

**Parametros do Body:**
| Campo | Tipo | Obrigatorio | Descricao |
|-------|------|-------------|-----------|
| `Token` | string | Sim | Token de autenticacao |
| `parametros.CnpjCLi` | string | Sim | CNPJ do cliente |
| `parametros.Ean` | string | Sim | EAN(s) separados por virgula (lotes de ate 40) |
| `parametros.ConsideraTipo` | number | Nao | 1 = considera tipo de item na busca |

**Resposta (200 OK) - Estrutura:**
```json
{
  "Retorno": {
    "itens": [
      {
        "ItemPedido": {
          "Ean": "7896714290492",
          "Descricao": "PANTOPRAZOL 40MG 28CPR",
          "Laboratorio": "NEO QUIMICA"
        },
        "Substitutos": [
          {
            "Ean": "7899641201539",
            "Descricao": "PANTOPRAZOL MAGNESICO 20MG 28CPR GN",
            "Laboratorio": "EUROFARMA",
            "TipoItem": "G",
            "CodDist": 4,
            "NomeDist": "PROFARMA [SP]",
            "Pliquido": "6.20",
            "PliquidoUni": "6.20",
            "Preco": "9.80",
            "Desconto": "36.73",
            "DescExtra": "0.00",
            "ValorST": "0.00",
            "Prazo": "28 dias",
            "Estoque": 2,
            "QtdMin": 0
          }
        ],
        "Condicoes": [
          {
            "CodDist": 4,
            "NomeDist": "PROFARMA [SP]",
            "Pliquido": "8.50",
            "Estoque": 2,
            "...": "..."
          }
        ]
      }
    ],
    "minimos": [
      {
        "CodDist": 4,
        "Condicao": "A VISTA",
        "Prazo": "28 dias",
        "VlrMinimo": 300.00,
        "QtdMinima": 0
      }
    ]
  }
}
```

**Uso no sistema (`server.ts`):**
- **Linha 316** - `fetchEanDescriptions()`: Busca primaria de descricao/laboratorio
- **Linha 1575** - Endpoint principal de cotacao `/api/optimize`
- **Linha 1921, 1937** - Searches de fallback por texto/DCB/molécula pura
- **Linha 4070** - Distribuidores e condicoes
- **Linha 4972, 5002, 5025** - Busca profunda de substitutos (5 consultas paralelas)
- **Linha 5947** - Diagnostico EAN

**Tabela de Valores de `TipoItem` (retornado por `Condicoes/Molecula`):**

| TipoItem | Categoria | Suffixo Molecula | Tem Substitutos? | Exemplo |
|----------|-----------|------------------|-------------------|---------|
| `"G"` | Genérico | `_G` | SIM | LOSARTANA, AMOXICILINA, OMEPRAZOL |
| `"M"` | Marca/Ref/Ético | `_M` | Depende | DONAREN, REPOFLOR, PURAN T4, DORFLEX |
| `"S"` | Similar | `_S` | Depende | ROSUCOR, SODIX, BUTACID, VICK 44E |
| `"O"` | Outros (catch-all) | `_O` | Depende | PARACETAMOL 750MG, DONEPEZILA |
| `"P"` | **Perfumaria** | (vazio) | **NAO — `Substitutos: []` sempre vazio** | SHAMPOO SEDA, DESODORANTE, ESMALTE |

> **REGRA CRITICA:** Produtos com `TipoItem="P"` (Perfumaria/Cosmeticos) retornam `Substitutos: []` e `Molecula: ""` vazio da API SmartPed. **Nao adicione substitutos manualmente** para esses itens — a propria API ja retorna vazio. Qualquer busca extra para perfumaria e desperdicio de chamadas de API.

> **NOTA SOBRE "O":** O TipoItem `"O"` e um catch-all que a SmartPed usa para produtos que nao se encaixam em G, M, S ou P. Pode incluir referencia, similar, fitoterapico, suplemento. **Use o campo `grupo` da Ferramentinhas como fonte primaria de classificação** (ver AGENTS.md regra #25).

**Validacao empirica (137 EANs testados):**
- TipoItem e suffixo Molecula sao **100% consistentes** quando ambos existem (zero inconsistencias)
- 46% dos itens (64/137) retornam TipoItem vazio — sao nao-medicamentos (perfumaria, conveniencia, equipamentos)
- Genéricos comprimidos podem ter `Molecula` vazio — usar `TipoItem` como fallback

**Notas:**
- `Substitutos` contem equivalentes de mesma molecula (genericos, similares, eticos). **Para Perfumaria (`TipoItem="P"`), sempre vazio.**
- `Condicoes` do proprio EAN original tambem vem no retorno
- Comportamento de achatamento: filhos (`Condicoes`) herdam `Ean`, `Descricao`, `Laboratorio` do pai (`ItemPedido`)
- Retorno pode vir como `itens` (lowercase) ou `Itens` (PascalCase) - checar ambos
- **Resposta inclui array `dists[]` (ou `Dists[]`) na raiz de `Retorno`** (igual a Condicoes/Ean). Fonte para `enrichDistribuidoresFromPayload`. `NomeDist` **não vem** no objeto `Substitutos[]` individual.
- **`TipoItem` vem no objeto `itens[]`** (nivel do ItemPedido), NOS substitutosindividualmente, e nos itemspai. Campo util para decidir se busca substitutos.

---

## 3. Busca de Produtos por Texto (`/api/Produtos/Buscar`)

Busca cadastral por descricao, curinga ou EAN. Nao retorna condicoes comerciais completas.

```
POST /api/Produtos/Buscar
```

**Request Body:**
```json
{
  "Token": "seu_token_aqui",
  "parametros": {
    "CnpjCLi": "13408443000168",
    "Texto": "PARACETAMOL",
    "Pagina": 1
  }
}
```

**Parametros do Body:**
| Campo | Tipo | Obrigatorio | Descricao |
|-------|------|-------------|-----------|
| `Token` | string | Sim | Token de autenticacao |
| `parametros.CnpjCLi` | string | Sim | CNPJ do cliente |
| `parametros.Texto` | string | Sim | Texto de busca (descricao, curinga com %) |
| `parametros.Pagina` | number | Nao | Paginacao de resultados |

**Resposta (200 OK) - Estrutura:**
```json
{
  "Retorno": {
    "Produtos": [
      {
        "Ean": "7890909050203",
        "Descricao": "PARACETAMOL 750MG 20CP",
        "Laboratorio": "MEDLEY",
        "CodProduto": "12345",
        "CodProdutoDist": "67890",
        "CodDist": 4,
        "NomeDist": "PROFARMA [SP]",
        "Pliquido": "3.50",
        "Preco": "5.20"
      }
    ]
  }
}
```

**Uso no sistema (`server.ts`):**
- **Linha 1953** - Busca textual de fallback no lote de otimizacao
- **Linha 4359** - Endpoint `/api/search-products`: Fase 1 de Descoberta da busca hibrida
- **Linha 5050** - Cockpit Comercial: Busca profunda de substitutos
- **Linha 5103** - Busca de alternativas por texto puro

**Notas:**
- Nao retorna `minimos`, `PMC`, `QtdMin` ou condicoes escalonadas
- Por isso o sistema faz a Fase 2 (Expansao): descobre EANs aqui e depois consulta `/api/Condicoes/Ean`
- Suporta operador curinga `%` no texto de busca
- Buscas progressivas curtas (ex: `"PARA%750MG"`) resolvem falsos-negativos

---

## 3b. Fluxo de Busca Hibrida por Descricao (`/api/search-products`)

Quando o usuario digita uma descricao (texto), o sistema executa um fluxo de 3 etapas
para obter condicoes completas incluindo `QtdMin`:

```
[Frontend: busca por texto]
    │
    ▼
POST /api/search-products  (query = "hidroclorotiazida")
    │
    ├── FASE 1: Descoberta de EANs
    │       │
    │       └── POST /api/Produtos/Buscar
    │               └── Retorna array plano de produtos (SEM QtdMin, SEM minimos)
    │               └── Extrai EANs unicos dos resultados
    │
    ├── FASE 2: Expansao Comercial (paralela por EAN)
    │       │
    │       └── Para CADA EAN descoberto, em paralelo:
    │               │
    │               ├── POST /api/Condicoes/Ean  (com AceitaOntem=1)
    │               │       └── Retorna Condicoes[] + minimos[] + dists[]
    │               │       └── QtdMin vem DENTRO de cada condicao (se houver promocao)
    │               │
    │               └── POST /api/Condicoes/Molecula  (com ConsideraTipo=1)
    │                       └── Retorna Substitutos[] com suas Condicoes
    │                       └── QtdMin vem DENTRO de cada condicao do substituto
    │
    └── FASE 3: Merge + Deduplicacao
            │
            ├── Concatena itens de AMBOS os endpoints (Ean + Molecula)
            ├── Cruza minimos[] com cada condicao (matching CodDist+Condicao+Prazo)
            ├── Aplica fallback de PedidoMinimo por nome de distribuidora
            └── Retorna lista unica de ofertas com QtdMin preenchido
```

**Por que sao NECESSARIOS os 3 passos:**

| Endpoint | O que traz | O que NAO traz |
|----------|-----------|----------------|
| `Produtos/Buscar` | Descricao, EANs, Labs | Nao traz precos, QtdMin, minimos |
| `Condicoes/Ean` | Precos, condicoes, QtdMin (se houver), minimos[] | So funciona com EAN numerico |
| `Condicoes/Molecula` | Substitutos com QtdMin, minimos[] | So funciona com EAN numerico |

**Limitacao da SmartPed:**
A API SmartPed NAO disponibiliza `QtdMin` em endpoints de busca textual.
O `QtdMin` (quantidade minima para ativar desconto/promocao) so e retornado
pelos endpoints que trabalham com EANs: `Condicoes/Ean` e `Condicoes/Molecula`.
Por isso, a busca por descricao SEMPRE precisa do fluxo hibrida de 2 fases.

**Parametros importantes no fluxo:**
- `AceitaOntem=1` no `Condicoes/Ean`: inclui condicoes validas desde o dia anterior
- `ConsideraTipo=1` no `Condicoes/Molecula`: filtra substitutos por tipo de item

---

## 4. Similares por EAN (`/api/Condicoes/Similares`)

Retorna medicamentos similares (de referencia) para um EAN.

```
POST /api/Condicoes/Similares
```

**Request Body:**
```json
{
  "Token": "seu_token_aqui",
  "parametros": {
    "CnpjCLi": "13408443000168",
    "Ean": "7896714290492"
  }
}
```

**Uso no sistema (`server.ts`):**
- **Linha 5067** - Busca profunda de substitutos (5 consultas paralelas)

---

## 5. Substitutos por EAN (`/api/Condicoes/Substitutos`)

Retorna substitutos diretos do EAN (alternativas comerciais).

```
POST /api/Condicoes/Substitutos
```

**Request Body:**
```json
{
  "Token": "seu_token_aqui",
  "parametros": {
    "CnpjCLi": "13408443000168",
    "Ean": "7896714290492"
  }
}
```

**Uso no sistema (`server.ts`):**
- **Linha 5084** - Busca profunda de substitutos (5 consultas paralelas)

---

## 6. Distribuidores Disponiveis (`/api/Condicoes/Distribuidores`)

Retorna lista de distribuidores ativos para o cliente.

```
POST /api/Condicoes/Distribuidores
```

**Request Body:**
```json
{
  "Token": "seu_token_aqui",
  "parametros": {
    "CnpjCLi": "13408443000168"
  }
}
```

**Resposta (200 OK) - Estrutura:**
```json
{
  "Retorno": [
    {
      "Codigo": 4,
      "Nome": "PROFARMA [SP]"
    },
    {
      "Codigo": 503,
      "Nome": "GCMEDICAMENTOS"
    }
  ]
}
```

**Campos:** `Codigo` (number) = CodDist, `Nome` (string) = nome comercial da distribuidora.

**Uso no sistema (`server.ts`):**
- **Linha ~4008** - Endpoint `/api/distribuidores` (proxy)
- **Startup** - `loadDistribuidoresFromAPI()` popula `DISTRIBUIDORAS_DYNAMIC_CACHE` na inicialização do servidor
- **Enriquecimento em tempo real** - `enrichDistribuidoresFromPayload()` lê `payload.Retorno.dists[]` de QUALQUER resposta SmartPed

**Notas críticas:**
- A API **não garante** que todos os CodDist ativos apareçam neste endpoint (ex: 503=GCMEDICAMENTOS pode faltar)
- Por isso o sistema usa **cache dinâmico em 3 camadas**: (1) Startup via este endpoint, (2) `dists[]` de respostas de cotação, (3) Mapa estático `DISTRIBUIDORAS_MAP` como último fallback
- Campos variáveis na resposta: `Codigo`/`codigo`, `Nome`/`nome` — sempre normalizar com `Number()` e `String().trim()`

---

## 7. Envio de Pedido (`/api/Pedido/Envio`)

Envia lote de faturamento para a SmartPed processar junto as distribuidoras.

```
POST /api/Pedido/Envio
```

**Request Body:**
```json
{
  "Token": "seu_token_aqui",
  "parametros": {
    "CnpjCLi": "13408443000168",
    "NumPedidoOrigem": "PED-2025-001",
    "Itens": [
      {
        "Ean": "7896714290492",
        "Quantidade": 10,
        "CodDist": 4,
        "CodProduto": "12345",
        "CodProdutoDist": "67890"
      }
    ]
  }
}
```

**Resposta (200 OK):**
```json
{
  "Retorno": {
    "NumPedido": 3221,
    "Mensagem": "Pedido enviado com sucesso",
    "DistBloqEnv": []
  }
}
```

**Uso no sistema (`server.ts`):**
- **Linha 3123** - Endpoint `/api/faturar` (transmissao real)

**Notas:**
- O backend unifica todos os itens de todas as distribuidoras em UMA unica chamada (anti-duplicacao)
- Valida condicoes: `codProduto` e `codProdutoDist` devem ser validos (nao nulos, nao "0")
- Itens com `CodDist === 0` ou sem estoque sao expurgados antes do envio
- Se a resposta contiver `"Já existe um envio pendente"`, o faturamento e rejeitado

---

## 8. Listar Pedidos (`/api/Pedido/Listar`)

Lista pedidos enviados por periodo.

```
POST /api/Pedido/Listar
```

**Request Body:**
```json
{
  "Token": "seu_token_aqui",
  "parametros": {
    "CnpjCLi": "13408443000168",
    "DataInicio": "14/08/2025",
    "DataFim": "14/08/2025"
  }
}
```

**Notas:**
- Formato de data: `DD/MM/YYYY` (funcao utilitaria `formatToSmartpedDate` converte de ISO)

**Uso no sistema (`server.ts`):**
- **Linha 3303** - Endpoint `/api/pedidos-do-dia` (consulta de faturados)
- **Linha 3558** - Endpoint `/api/itens-confirmados-do-dia`

---

## 9. Retorno de Pedido (`/api/Pedido/Retorno`)

Consulta o status detalhado dos itens de um pedido (faturado, falta, erro).

```
POST /api/Pedido/Retorno
```

**Request Body:**
```json
{
  "Token": "seu_token_aqui",
  "parametros": {
    "CnpjCLi": "13408443000168",
    "NumPedido": "3221"
  }
}
```

**Status de Itens:**
| Status | Significado |
|--------|-------------|
| 3 | Faturado (Confirmado) |
| Outros | Nao Confirmado / Falta |

**Uso no sistema (`server.ts`):**
- **Linha 3304** - Consulta de retornos no dia
- **Linha 3580** - Itens confirmados por periodo
- **Linha 3810** - Endpoint `/api/pedido-retorno` (diagnostico individual)

---

## 10. Busca Comparativa (`/api/Produtos/BuscaComparativa`)

Busca produtos com precificacao comparativa entre distribuidoras. **Endpoint mais poderoso que Buscar** — descobre principio ativo automaticamente e retorna TODOS os produtos equivalentes.

> **⚠️ INFO DO DIOGO (CTO SmartPed, 24/08/2026):**
> - **Passar UM EAN** → sistema descobre a composição → retorna TODOS os produtos iguais (mesmo principio ativo), já ordenados por preço
> - **Filtrar por principio + dosage**: `Principio: "LOSARTANA"`, `Descricao: "50%"` → retorna só losartana 50mg
> - **Busca deve ser SEQUENCIAL (não paralela)** — API grava em tabela temporária, requests paralelos sobrescrevem uns aos outros
> - `SoMelhor=1` retorna apenas a melhor oferta por produto

```
POST /api/Produtos/BuscaComparativa
```

**Request Body (por EAN — descobre composição automaticamente):**
```json
{
  "Token": "seu_token_aqui",
  "parametros": {
    "CnpjCLi": "13408443000168",
    "Descricao": "",
    "Principio": "",
    "SoMelhor": 1,
    "EAN": "7896241225530"
  }
}
```

**Request Body (por principio + filtro de dosage):**
```json
{
  "Token": "seu_token_aqui",
  "parametros": {
    "CnpjCLi": "13408443000168",
    "Descricao": "50%",
    "Principio": "LOSARTANA",
    "SoMelhor": 0
  }
}
```

**Parametros do Body:**
| Campo | Tipo | Obrigatorio | Descricao |
|-------|------|-------------|-----------|
| `Token` | string | Sim | Token de autenticacao |
| `parametros.CnpjCLi` | string | Sim | CNPJ do cliente |
| `parametros.EAN` | string | Nao | **UM EAN** — sistema descobre composição e retorna todos equivalentes |
| `parametros.Descricao` | string | Nao | Texto de busca com `%` wildcard (ex: `"50%"`, `"PARACETAMOL%"`) |
| `parametros.Principio` | string | Nao | Principio ativo DCB (ex: `"LOSARTANA"`, `"ALENDRONATO"`) |
| `parametros.SoMelhor` | number | Nao | 0 = todos os resultados, 1 = apenas o melhor por produto |

**Resposta (200 OK) - Estrutura:**
```json
{
  "Retorno": {
    "Produtos": [
      {
        "Ean": 7890909050203,
        "Descricao": "PARACETAMOL 750MG 20CP",
        "Laboratorio": "MEDLEY",
        "CodProduto": "12345",
        "CodDist": 4,
        "NomeDist": "PROFARMA [SP]",
        "Pliquido": "3.50",
        "Preco": "5.20",
        "ChaveKEY": "ABC123XYZ"
      }
    ]
  }
}
```

**Notas:**
- EAN retornado como **NUMERO** (nao string!) - obrigatorio normalizar com `padStart(13, "0")`
- Inclui campo `ChaveKEY` (nao presente no Buscar simples)
- `Descricao` aceita curinga `%` (ex: `"PARACETAMOL%"`, `"50%"`)
- `Principio` usa o nome DCB completo do principio ativo
- `SoMelhor=1` filtra apenas a melhor oferta por produto
- **IMPORTANTE:** Chamadas devem ser SEQUENCIAIS — API usa tabela temporária que é sobrescrita a cada request

---

## 11. Listar Principios Ativos (`/api/Produtos/ListarPrincipios`)

Lista todos os principios ativos (DCB) disponiveis no sistema. Utilizado para autocomplete e filtros.

```
POST /api/Produtos/ListarPrincipios
```

**Request Body:**
```json
{
  "Token": "seu_token_aqui",
  "parametros": {
    "CnpjCLi": "13408443000168"
  }
}
```

**Resposta (200 OK):**
```json
{
  "Mensagem": "OK",
  "Retorno": {
    "Principios": [
      "ACIDO ACETILSALICILICO",
      "ACIDO TRANEXAMICO",
      "AMOXICILINA",
      "... (lista massiva)"
    ]
  }
}
```

**Notas:**
- Retorna lista massiva de todos os principios ativos DCB cadastrados
- Util para popular dropdowns, filtros e validacoes no frontend

---

## 12. Ofertas (`/api/Condicoes/Ofertas`)

Busca ofertas por faixa de desconto, distribuidor e condicao comercial.

```
POST /api/Condicoes/Ofertas
```

**Request Body:**
```json
{
  "Token": "seu_token_aqui",
  "parametros": {
    "CnpjCLi": "13408443000168",
    "DescMin": 10,
    "DescMax": 50,
    "Prazo": "28 dias",
    "CodDist": 4,
    "Condicao": "A VISTA"
  }
}
```

**Parametros do Body:**
| Campo | Tipo | Obrigatorio | Descricao |
|-------|------|-------------|-----------|
| `Token` | string | Sim | Token de autenticacao |
| `parametros.CnpjCLi` | string | Sim | CNPJ do cliente |
| `parametros.DescMin` | number | Nao | Desconto minimo (%) |
| `parametros.DescMax` | number | Nao | Desconto maximo (%) |
| `parametros.Prazo` | string | Nao | Prazo de pagamento (ex: `"28 dias"`) |
| `parametros.CodDist` | number | Nao | Codigo da distribuidora |
| `parametros.Condicao` | string | Nao | Condicao comercial (ex: `"A VISTA"`) |

**Resposta (200 OK):**
```json
{
  "Retorno": [
    {
      "NomeDistribuidora": "PROFARMA [SP]",
      "Laboratorio": "NEO QUIMICA",
      "Descricao": "PARACETAMOL 750MG 20CP",
      "Pliquido": "3.50",
      "ChaveKEY": "ABC123XYZ",
      "Estoque": 2
    }
  ]
}
```

**Codigos de Estoque:**
| Codigo | Significado |
|--------|-------------|
| 0 | Sem estoque |
| 1 | Baixo / Sob consulta |
| 2 | Estoque normal |

**Notas:**
- Retorna **maximo 100 resultados** por consulta
- Retorno e um **array flat** (nao aninhado em `itens`/`ItemPedido`)
- Inclui `NomeDistribuidora`, `Laboratorio`, `Descricao`, `Pliquido`, `ChaveKEY`
- Todos os parametros exceto `CnpjCLi` sao opcionais (filtros combinaveis)

---

## 13. Sugestoes (`/api/Condicoes/Sugestoes`)

Retorna sugestoes de compra baseadas no historico de compras do cliente.

```
POST /api/Condicoes/Sugestoes
```

**Request Body:**
```json
{
  "Token": "seu_token_aqui",
  "parametros": {
    "CnpjCLi": "13408443000168"
  }
}
```

**Resposta (200 OK):**
```json
{
  "Retorno": [
    {
      "CodProduto_Idi": "12345",
      "CodDist_Iof": 4,
      "CodBarra_idi": "7896714290492",
      "estoque_idi": 2,
      "DescricaoProduto_Idi": "PANTOPRAZOL 40MG 28CPR",
      "Laboratorio": "NEO QUIMICA",
      "Preco_idi": "12.50",
      "Desconto": "32.00",
      "DescMedio_mdp": "28.00",
      "Diferenca": "4.00",
      "CodOferta_iof": 9876,
      "Prazo_iof": "28 dias",
      "Posicao": 1,
      "ChaveKEY": "ABC123XYZ",
      "Nome_Dpe": "PROFARMA [SP]",
      "Pliquido": "8.50",
      "Quant": 5
    }
  ]
}
```

**Notas:**
- Retorno e um **array flat**
- Campos `DescMedio_mdp` = desconto medio historico do produto
- Campo `Diferenca` = diferenca entre preco atual e medio
- `Posicao` indica ranking da sugestao
- `CodOferta_iof` e `ChaveKEY` podem ser usados para filtros subsequentes

---

## 14. Lancamentos (`/api/Produtos/Lancamentos`)

Retorna produtos lancados recentemente no catalogo.

```
POST /api/Produtos/Lancamentos
```

**Request Body:**
```json
{
  "Token": "seu_token_aqui",
  "parametros": {
    "CnpjCLi": "13408443000168"
  }
}
```

**Resposta (200 OK):**
```json
{
  "Retorno": [
    {
      "Quantidade": 1,
      "CodDist": 4,
      "NomeDist": "PROFARMA [SP]",
      "CodPromocao": 555,
      "Codigo": "12345",
      "Descricao": "NOVO PRODUTO 100MG 30CPR",
      "Laboratorio": "LABORATORIO XYZ",
      "Preco": "25.00",
      "Estoque": 2,
      "Desconto": "15.00",
      "Ean": "7891234567890",
      "Pliquido1": "21.25",
      "ChaveKEY": "XYZ789ABC",
      "DescontoTotal": "15.00",
      "Extra": "0.00",
      "Prazo": "28 dias",
      "QtdMin": 0,
      "ValorSt": "0.00",
      "CX": 1,
      "PMC": "35.00",
      "MidiaCadCli": "",
      "Posicao": 1,
      "DifMedio": "0.00",
      "Pliquido": "21.25"
    }
  ]
}
```

**Notas:**
- Retorno e um **array flat**
- Inclui dados completos de preco, desconto e estoque
- `CodPromocao` identifica a promocao/campanha atrelada
- `CX` = fator de caixa (multipack)
- `PMC` = preco maximo ao consumidor
- `MidiaCadCli` = midia/vinculo promocional

---

## 15. Ativar Cliente (`/api/Cadastro/Ativar`)

Ativa um cliente no sistema SmartPed. Endpoint administrativo.

```
POST /api/Cadastro/Ativar
```

**Request Body:**
```json
{
  "Token": "seu_token_aqui",
  "parametros": {
    "CnpjCLi": "13408443000168"
  }
}
```

**Notas:**
- Endpoint administrativo (requer permissoes elevadas)
- Ativa o cadastro do cliente para uso da plataforma

---

## 16. Bloquear Cliente (`/api/Cadastro/Bloquear`)

Bloqueia um cliente no sistema SmartPed. Endpoint administrativo.

```
POST /api/Cadastro/Bloquear
```

**Request Body:**
```json
{
  "Token": "seu_token_aqui",
  "parametros": {
    "CnpjCLi": "13408443000168"
  }
}
```

**Notas:**
- Endpoint administrativo (requer permissoes elevadas)
- Bloqueia o cadastro do cliente impedindo uso da plataforma

---

## 17. Envio de Condicao (`/api/Condicoes/Envio`)

Cria uma solicitacao de cotacao (diferente de Pedido/Envio que e para faturamento). Retorna um `NumPedido` que e usado posteriormente com RetornoCondicao.

```
POST /api/Condicoes/Envio
```

**Request Body (com DistribuidoresCnpj):**
```json
{
  "Token": "seu_token_aqui",
  "parametros": {
    "CnpjCLi": "13408443000168",
    "DistribuidoresCnpj": ["12345678000190", "98765432000110"],
    "Prazo": "28 dias",
    "itens": [
      {
        "CodProduto": "12345",
        "CodBarra": "7896714290492",
        "Descricao": "PANTOPRAZOL 40MG 28CPR",
        "Laboratorio": "NEO QUIMICA",
        "Quantidade": 10
      }
    ]
  }
}
```

**Request Body (com Distribuidores):**
```json
{
  "Token": "seu_token_aqui",
  "parametros": {
    "CnpjCLi": "13408443000168",
    "Distribuidores": [4, 7, 12],
    "Prazo": "28 dias",
    "itens": [
      {
        "CodProduto": "12345",
        "CodBarra": "7896714290492",
        "Descricao": "PANTOPRAZOL 40MG 28CPR",
        "Laboratorio": "NEO QUIMICA",
        "Quantidade": 10
      }
    ]
  }
}
```

**Parametros do Body:**
| Campo | Tipo | Obrigatorio | Descricao |
|-------|------|-------------|-----------|
| `Token` | string | Sim | Token de autenticacao |
| `parametros.CnpjCLi` | string | Sim | CNPJ do cliente |
| `parametros.DistribuidoresCnpj` | string[] | Nao* | Array de CNPJs das distribuidoras |
| `parametros.Distribuidores` | number[] | Nao* | Array de IDs das distribuidoras |
| `parametros.Prazo` | string | Nao | Prazo de pagamento desejado |
| `parametros.itens` | object[] | Sim | Itens da cotacao |

*Usar `DistribuidoresCnpj` OU `Distribuidores` - **NAO ambos**.

**Item da cotacao:**
| Campo | Tipo | Obrigatorio | Descricao |
|-------|------|-------------|-----------|
| `CodProduto` | string | Nao | Codigo do produto na distribuidora |
| `CodBarra` | string | Sim | EAN do produto |
| `Descricao` | string | Nao | Descricao do produto |
| `Laboratorio` | string | Nao | Laboratorio/fabricante |
| `Quantidade` | number | Sim | Quantidade desejada |

**Resposta (200 OK):**
```json
{
  "Mensagem": "OK",
  "Retorno": {
    "NumPedido": 3870
  }
}
```

**Notas:**
- Diferente de `/api/Pedido/Envio` (que e para faturamento/billing)
- `NumPedido` retornado e usado com `/api/Condicoes/Retorno` para buscar resultados
- Pode usar CNPJ ou ID para selecionar distribuidoras, mas nao ambos simultaneamente

---

## 18. Retorno de Condicao (`/api/Condicoes/Retorno`)

Consulta os resultados de uma cotacao criada por EnvioCondicao. Pode retornar "Pedido em processamento" se ainda nao finalizou.

```
POST /api/Condicoes/Retorno
```

**Request Body:**
```json
{
  "Token": "seu_token_aqui",
  "parametros": {
    "CnpjCLi": "13408443000168",
    "NumeroPedido": 3870,
    "TempoMaxEspera": 5,
    "ConsideraCaixa": 1
  }
}
```

**Parametros do Body:**
| Campo | Tipo | Obrigatorio | Descricao |
|-------|------|-------------|-----------|
| `Token` | string | Sim | Token de autenticacao |
| `parametros.CnpjCLi` | string | Sim | CNPJ do cliente |
| `parametros.NumeroPedido` | number | Sim | Numero do pedido retornado por EnvioCondicao |
| `parametros.TempoMaxEspera` | number | Nao | Tempo maximo de espera em minutos |
| `parametros.ConsideraCaixa` | number | Nao | 1 = considera fator de caixa nos precos |

**Resposta (200 OK) - Sucesso:**
```json
{
  "Mensagem": "OK",
  "Retorno": {
    "itens": [
      {
        "CodProduto": "12345",
        "CodBarra": "7896714290492",
        "Descricao": "PANTOPRAZOL 40MG 28CPR",
        "Condicoes": [
          {
            "CodDist": 4,
            "NomeDist": "PROFARMA [SP]",
            "Preco": "12.50",
            "Pliquido": "8.50",
            "PliquidoUni": "8.50",
            "Desconto": "32.00",
            "DescExtra": "0.00",
            "ValorST": "0.00",
            "Prazo": "28 dias",
            "Estoque": 2,
            "QtdMin": 0,
            "Condicao": "A VISTA"
          }
        ]
      }
    ],
    "minimos": [
      {
        "CodDist": 4,
        "Condicao": "A VISTA",
        "Prazo": "28 dias",
        "VlrMinimo": 300.00,
        "QtdMinima": 0
      }
    ],
    "dists": [
      {
        "CodDist": 4,
        "NomeDist": "PROFARMA [SP]",
        "LiberadoEnvio": true
      }
    ]
  }
}
```

**Resposta (200 OK) - Ainda processando:**
```json
{
  "Mensagem": "Pedido em processamento",
  "Retorno": null
}
```

**Notas importantes (documentacao SmartPed):**
- `Pliquido` = preco apos todas as consideracoes: `Preco - Desconto - DescontoExtra + ValorSt`
- `PliquidoUni` = `Preco / CX` (preco unitario para itens multipack)
- `minimos` sao por combinacao `CodDist + Condicao + Prazo`
- `dists` contem flag `LiberadoEnvio` que **deve ser verificada** antes de usar EnvioPedido
- Se retornar `"Pedido em processamento"`, deve-se **re-tentar** apos alguns segundos

---

## Endpoints Internos do Backend (Rotas Express)

O backend expoe os seguintes endpoints que orquestram as consultas SmartPed:

| Rota Interna | Metodo | SmartPed Endpoint | Descricao |
|--------------|--------|-------------------|-----------|
| `/api/health` | GET | - | Health check do servidor |
| `/api/optimize` | POST | Condicoes/Ean, Condicoes/Molecula, Produtos/Buscar | Motor principal de otimizacao do lote |
| `/api/faturar` | POST | Pedido/Envio | Faturamento real (envio para SmartPed) |
| `/api/pedidos-do-dia` | POST | Pedido/Listar, Pedido/Retorno | Consulta pedidos por periodo |
| `/api/itens-confirmados-do-dia` | POST | Pedido/Retorno | Itens faturados/nao confirmados por periodo |
| `/api/pedido-retorno` | POST | Pedido/Retorno | Retorno detalhado de um pedido especifico |
| `/api/distribuidores` | POST | Condicoes/Distribuidores | Lista distribuidores disponiveis |
| `/api/search-products` | POST | Produtos/Buscar, Condicoes/Ean, Condicoes/Molecula | Busca de produtos por descricao/EAN (busca hibrida com QtdMin) |
| `/api/smartped-find-substitutes` | POST | Condicoes/Ean, Condicoes/Molecula, Condicoes/Similares, Condicoes/Substitutos, Produtos/Buscar | Busca profunda de substitutos (5 endpoints paralelos) |
| `/api/diagnostico-ean` | POST | Condicoes/Molecula, Condicoes/Ean, Condicoes/Similares, Condicoes/Substitutos | Diagnostico bruto de um EAN |

**Endpoints SmartPed disponiveis para uso futuro:**

| SmartPed Endpoint | Uso potencial |
|-------------------|---------------|
| `/api/Produtos/BuscaComparativa` | Busca com filtro de principio ativo e comparacao de precos |
| `/api/Produtos/ListarPrincipios` | Autocomplete de principios ativos (DCB) no frontend |
| `/api/Condicoes/Ofertas` | Dashboard de ofertas/descontos por distribuidor |
| `/api/Condicoes/Sugestoes` | Sugestoes inteligentes de compra baseadas em historico |
| `/api/Produtos/Lancamentos` | Secao de novos produtos no catalogo |
| `/api/Condicoes/Envio` | Fluxo de cotacao (pre-faturamento) |
| `/api/Condicoes/Retorno` | Resultado de cotacao solicitada |
| `/api/Cadastro/Ativar` | Ativacao de clientes (admin) |
| `/api/Cadastro/Bloquear` | Bloqueio de clientes (admin) |

---

## Fluxo de Consulta Principal (Otimizacao)

```
[Frontend: UploadBox → handleOptimize]
    │
    ▼
POST /api/optimize
    │
    ├── Para cada EAN unico do arquivo SICF (chunks de 40):
    │       │
    │       ├── 1. GET ferramentinhas /api/produtos/similares/{ean}
    │       │       └── Descobre equivalentes locais (EAN_DATABASE)
    │       │
    │       ├── 2. Expandir lote com equivalentes (LOCAL_EQUIVALENTS_DB)
    │       │
    │       ├── 3. POST /api/Condicoes/Ean (EAN original + equivalentes)
    │       │       └── Cotacao comercial direta com estoque
    │       │
    │       ├── 4. POST /api/Condicoes/Molecula (EAN original + equivalentes)
    │       │       └── Substitutos genericos/similares da molecula
    │       │
    │       └── 5. Fallback textual (se iter 3 e 4 falharam):
    │               │
    │               ├── getMoleculeBase(descricao) → extrair principio ativo
    │               ├── cleanDescriptionKeepDosage(descricao) → preservar dosagem
    │               │
    │               ├── POST /api/Condicoes/Molecula (texto DCB puro)
    │               ├── POST /api/Condicoes/Molecula (texto + dosagem)
    │               └── POST /api/Produtos/Buscar (curingas wildcards)
    │
    ├── Deduplicar ofertas (EAN + CodDist + Condicao + Prazo)
    │
    ├── findBestSubstitute() para cada item:
    │       │
    │       ├── Filtro por tipos aceitos (G, S, O, R)
    │       ├── Filtro por estoque > 0
    │       ├── Filtro por categoria estrita (Generico ↔ Generico)
    │       ├── Validacao de swap (validateSwapEquivalence): dosagem, sabor, quantidade
    │       ├── Calculo de economia (precoNovo vs precoBenchmark)
    │       └── Fornecedor externo (WhatsApp): comparacao com tabela manual
    │
    └── Retorna SwapReportItem[] + logs
```

---

## Fluxo de Busca Profunda de Substitutos (Cockpit Comercial)

```
[Frontend: SimilarProductsModal → /api/smartped-find-substitutes]
    │
    ├── 1. GET ferramentinhas /api/produtos/similares/{ean} → DCB/composicao
    │
    └── 5 consultas paralelas na SmartPed (Promise.all):
            │
            ├── POST /api/Condicoes/Ean (por EAN)
            ├── POST /api/Condicoes/Molecula (pelo EAN)
            ├── POST /api/Condicoes/Molecula (pelo texto DCB)
            ├── POST /api/Condicoes/Similares (por EAN)
            ├── POST /api/Condicoes/Substitutos (por EAN)
            └── POST /api/Produtos/Buscar (texto curinga da descricao)
                    │
                    └── Para EANs descobertos:
                            POST /api/Condicoes/Ean (expansao comercial)
```

---

## Fluxo de Cotacao (Condicoes/Envio → Condicoes/Retorno)

```
[Frontend: CotacaoRequest → /api/condicoes-envio]
    │
    ├── 1. POST /api/Condicoes/Envio
    │       └── DistribuidoresCnpj OU Distribuidores + itens[]
    │       └── Retorna NumPedido (ex: 3870)
    │
    ├── 2. POST /api/Condicoes/Retorno (NumeroPedido: 3870)
    │       │
    │       ├── Se "Pedido em processamento":
    │       │       └── Retry apos N segundos (polling)
    │       │
    │       └── Se Mensagem = "OK":
    │               ├── itens[] com Condicoes por produto
    │               ├── minimos[] por CodDist+Condicao+Prazo
    │               └── dists[] com LiberadoEnvio (checar antes de EnvioPedido)
    │
    └── 3. Validação de LiberadoEnvio por distribuidora
            └── Apenas distribuidoras com LiberadoEnvio=true podem receber Pedido/Envio
```

---

## Cache Global de Minimos (`MINIMOS_GLOBAL_CACHE`)

O backend mantem em memoria um cache centralizado de pedidos minimos por distribuidor:

```
Chave: CodDist + Condicao + Prazo → { VlrMinimo, QtdMinima }
```

**Populado por:**
- Toda resposta de `/api/Condicoes/Ean` e `/api/Condicoes/Molecula` que traz `minimos[]`
- Funcao `updateMinimosCache(minimos)` atualiza o cache

**Consultado por:**
- Funcao `getMinimoFromCache(codDist, condicao, prazo)` com matching em 4 niveis:
  1. `CodDist + Condicao + Prazo` (exato)
  2. `CodDist + Prazo` (parcial)
  3. `CodDist + Condicao` (parcial)
  4. `Apenas CodDist` (fallback)

---

## Normalizacao de Respostas

**Inconsistencia de Cases (SmartPed retorna PascalCase ou lowercase):**
```typescript
// Sempre checar ambos:
s.CodDist !== undefined ? s.CodDist : s.codDist
item.Ean || item.ean
item.Descricao || item.descricao
item.Estoque !== undefined ? item.Estoque : item.estoque
```

**Inconsistencia de EAN (String vs Numero):**
- ENDPOINTS `RetornoCondicao` e `RetornoPedido`: EAN como **String** (`"7896241225547"`)
- ENDPOINT `BuscaComparativa` / `Condicoes/Ean`: EAN como **Numero** inteiro (`300652439266`)
- Solucao: `cleanEan()` aplica `padStart(13, "0")` para normalizar

**Parametros de estoque (parseSmartPedEstoque):**
```
0, "N", "SEM ESTOQUE" → 0 (Sem estoque)
1, "SOB CONSULTA"     → 1 (Baixo)
2, "S", "SIM", "OK"  → 2 (Normal)
nulo/undefined        → hasValidPrice ? 2 : 0
```