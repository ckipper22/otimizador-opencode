# Integração: Sistema de Encomendas (IA Estúdio)

## 1. Visão Geral

Dois sistemas Cloud Run se comunicam via REST:

| Sistema | URL | Função |
|---------|-----|--------|
| **Otimizador** (este) | `https://smartped-cli-887122622666.us-east1.run.app` | Cota preços, otimiza, fatura |
| **Encomendas** (IA Estúdio) | `https://encomenda-com-smartped-887122622666.us-east1.run.app` | Registra encomendas do balcão |

O Otimizador atua como **cliente** — consulta e envia dados para o banco do Encomendas.

---

## 2. Autenticação (Token de Integração)

### Padrão de Validação

O sistema Encomendas valida o token via header HTTP:

```
x-api-key: enc_sec_9f7a8b3c1d4e2f5061728394a5b6c7d8e9f01234
```

**Fluxo de validação:**
1. Request chega no Encomendas com header `x-api-key`
2. Encomendas compara com sua chave interna configurada
3. Se válido → processa a requisição
4. Se inválido ou ausente → retorna **401** com mensagem: `"Não autorizado. Forneça uma chave de integração válida via header 'x-api-key' ou 'Authorization: Bearer <KEY>'."`

### Onde está configurado

| Camada | Variável | Valor |
|--------|----------|-------|
| `.env` (dev local) | `ENCOMENDAS_INTEGRATION_KEY` | `enc_sec_9f7a8b3c1d4e2f5061728394a5b6c7d8e9f01234` |
| Cloud Run | `ENCOMENDAS_INTEGRATION_KEY` | Mesma chave (via `--env-vars-file`) |
| Backend (`server.ts:209`) | `ENCOMENDAS_API_KEY` | Lê de `process.env.ENCOMENDAS_INTEGRATION_KEY` |

### Como o Otimizador usa

O Otimizador **nunca** envia o token do frontend. O backend (`server.ts`) funciona como **proxy seguro**:
- Frontend chama `/api/integracao/encomendas/pendentes` (sem token)
- Backend injeta `x-api-key` automaticamente antes de repassar ao Encomendas
- Resposta é devolvida ao frontend sem expor a chave

---

## 3. Endpoints da API Encomendas

### 3.1. GET /api/integracao/encomendas/pendentes

**Purpose:** Buscar encomendas com status "Pendente"

**Request (do Otimizador → Encomendas):**
```http
GET https://encomenda-com-smartped-887122622666.us-east1.run.app/api/integracao/encomendas/pendentes
x-api-key: enc_sec_9f7a8b3c1d4e2f5061728394a5b6c7d8e9f01234
Content-Type: application/json
```

**Response (Encomendas → Otimizador):**
```json
{
  "encomendas": [
    {
      "id": 123,
      "codigoBarras": "7891234567890",
      "item": "AMOXICILINA 500MG 21CAP",
      "quantidade": 5,
      "status": "Pendente",
      "cliente": "João Silva",
      "telefone": "(51) 99999-1234",
      "atendente": "Maria",
      "observacoes": "Urgente - cliente precisa até sexta",
      "data": "2026-08-18T14:30:00.000Z"
    }
  ]
}
```

**Campos retornados por encomenda:**

| Campo | Tipo | Descrição |
|-------|------|-----------|
| `id` | number | ID único da encomenda no sistema Encomendas |
| `codigoBarras` | string | EAN do produto (pode ser vazio se balcão não identificou) |
| `item` | string | Descrição do produto (ex: "AMOXICILINA 500MG 21CAP") |
| `quantidade` | number | Quantidade solicitada pelo cliente |
| `status` | string | `"Pendente"` (único status retornado por este endpoint) |
| `cliente` | string | Nome do cliente |
| `telefone` | string | Telefone do cliente |
| `atendente` | string | Nome do atendente que registrou |
| `observacoes` | string | Observações livres do balcão |
| `data` | string | Data/hora do registro (ISO 8601) |

---

### 3.2. POST /api/integracao/encomendas/confirmar-pedido

**Purpose:** Atualizar status de encomendas para "Encomendado" após o pedido ser enviado à distribuidora

**Request (do Otimizador → Encomendas):**
```http
POST https://encomenda-com-smartped-887122622666.us-east1.run.app/api/integracao/encomendas/confirmar-pedido
x-api-key: enc_sec_9f7a8b3c1d4e2f5061728394a5b6c7d8e9f01234
Content-Type: application/json

{
  "itens": [
    {
      "id": 123,
      "fornecedor": "DISTRIBUIDORA EXEMPLO",
      "dataPrevisao": "2026-08-20"
    }
  ]
}
```

**Payload:**

| Campo | Tipo | Obrigatório | Descrição |
|-------|------|-------------|-----------|
| `itens` | array | Sim | Lista de encomendas a confirmar |
| `itens[].id` | number | Sim | ID da encomenda (campo `id` retornado no GET) |
| `itens[].fornecedor` | string | Sim | Nome da distribuidora que será/foi consultada |
| `itens[].dataPrevisao` | string | Sim | Data prevista de chegada (YYYY-MM-DD) |

**Response (Encomendas → Otimizador):**
```json
{
  "sucesso": true,
  "resultado": { ... }
}
```

**Efeito no banco Encomendas:**
- `status` → `"Encomendado"` (era `"Pendente"`)
- `fornecedor` → preenchido com o nome da distribuidora
- `dataPrevisao` → preenchida com a data prevista

---

## 4. Fluxo Completo de Uso

```
┌─────────────────────────────────────────────────────────────────────┐
│                    FLUXO DE INTEGRACAO ENCOMENDAS                    │
├─────────────────────────────────────────────────────────────────────┤
│                                                                      │
│  1. BALCAO cadastra encomenda                                        │
│     └─ Sistema Encomendas: status = "Pendente"                       │
│                                                                      │
│  2. OTIMIZADOR: Botao "📦 Importar Encomendas"                       │
│     └─ Frontend chama GET /api/integracao/encomendas/pendentes       │
│        └─ Backend proxy injeta x-api-key e repassa ao Encomendas     │
│           └─ Encomendas retorna array de encomendas pendentes        │
│                                                                      │
│  3. PARA CADA encomenda pendente:                                    │
│     ├─ COM EAN → busca direta Condicoes/Ean + Condicoes/Molecula    │
│     └─ SEM EAN → Produtos/Buscar por descricao → Ean + Molecula     │
│     └─ Resultado: ofertas SmartPed com preco, estoque, dist.         │
│                                                                      │
│  4. MODAL DE REVISAO                                                 │
│     ├─ Tabela: Checkbox | Produto | Cliente/Hora | Obs | Oferta | Qtd│
│     ├─ Dropdown: 📦 Mesmo Produto | 🔄 Genericos/Similares          │
│     ├─ Usuario ajusta oferta e quantidade                            │
│     └─ Clica "Importar Selecionados"                                 │
│                                                                      │
│  5. CONFIRMACAO                                                      │
│     ├─ Itens injetados no relatorio com origem="encomenda"           │
│     ├─ alternatives = TODAS as ofertas (permite trocar no pre-pedido)│
│     ├─ Salvo em localStorage + Turso (tabela itens_manuais)          │
│     └─ (Opcional) POST confirmar-pedido → status "Encomendado"       │
│                                                                      │
│  6. PRE-PEDIDO (SwapsTable)                                          │
│     ├─ ConditionSelector mostra todas as ofertas como alternativas   │
│     ├─ Usuario pode trocar fornecedor/condicao se pedido min. falhar │
│     └─ Faturamento segue fluxo normal                                │
│                                                                      │
└─────────────────────────────────────────────────────────────────────┘
```

---

## 5. Variaveis de Ambiente

| Variavel | Onde usar | Descricao |
|----------|-----------|-----------|
| `ENCOMENDAS_API_URL` | Otimizador (backend) | URL base do sistema Encomendas |
| `ENCOMENDAS_INTEGRATION_KEY` | Otimizador (backend) | Chave `x-api-key` para autenticacao |

**⚠️ IMPORTANTE:** Ambas as variaveis devem estar configuradas no Cloud Run. O deploy com `--set-env-vars` (apenas Turso) APAGA essas variaveis. Sempre usar `--env-vars-file` com todas as 12 variaveis do `.env`.

---

## 6. Erros Comuns e Solucoes

| Erro | Causa | Solucao |
|------|-------|---------|
| `401 Não autorizado` | `ENCOMENDAS_INTEGRATION_KEY` ausente ou incorreta no Cloud Run | Redeploy com `--env-vars-file` contendo todas as variaveis |
| `500 Resposta não é JSON` | Encomendas offline ou URL incorreta | Verificar `ENCOMENDAS_API_URL` e status do servico Encomendas |
| `400 Array 'itens' é obrigatório` | Payload de confirmar-pedido sem campo `itens` | Verificar formato do payload no frontend |
| Tela branca apos importar | `alternatives` com 1 oferta apenas | Versao 00047+ leva TODAS as ofertas |

---

## 7. Notas Tecnicas

- **Proxy reverso:** O Otimizador esconde a chave de integracao do frontend. Request do browser → `/api/integracao/...` → backend injeta `x-api-key` → Encomendas.
- **Filtro duplo:** O backend Otimizador filtra `status === "Pendente"` mesmo que o Encomendas já filtre (garantia extra).
- **CORS:** O proxy evita problemas de CORS entre navegadores e o servico Encomendas.
- **Rastreabilidade:** Cada item importado salva `idEncomenda` no Turso (tabela `itens_manuais`), permitindo cruzar dados entre sistemas.
