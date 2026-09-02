# Integração: Sistema de Encomendas (IA Estúdio)

> Atualizado em 2026-08-31. Movido de `docs/_archive/`.
> Detalhes de schema/tabelas: `docs/mapa-sistema.md` seção 4.

---

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
x-api-key: SUA_CHAVE_INTEGRACAO
```

**Fluxo de validação:**
1. Request chega no Encomendas com header `x-api-key`
2. Encomendas compara com sua chave interna configurada
3. Se válido → processa a requisição
4. Se inválido ou ausente → retorna **401** com mensagem: `"Não autorizado. Forneça uma chave de integração válida via header 'x-api-key' ou 'Authorization: Bearer <KEY>'."`

### Onde está configurado

| Camada | Variável | Valor |
|--------|----------|-------|
| `.env` (dev local) | `ENCOMENDAS_INTEGRATION_KEY` | `SUA_CHAVE_INTEGRACAO` |
| Cloud Run | `ENCOMENDAS_INTEGRATION_KEY` | Mesma chave (via `--env-vars-file`) |
| Backend (`server.ts`) | `ENCOMENDAS_API_KEY` | Lê de `process.env.ENCOMENDAS_INTEGRATION_KEY` |

### Como o Otimizador usa

O Otimizador **nunca** envia o token do frontend. O backend (`server.ts`) funciona como **proxy seguro**:
- Frontend chama `/api/integracao/encomendas/pendentes` (sem token)
- Backend injeta `x-api-key` automaticamente antes de repassar ao Encomendas
- Resposta é devolvida ao frontend sem expor a chave

---

## 3. Endpoints

### 3.1. GET /api/integracao/encomendas/pendentes (proxy)

**Purpose:** Buscar encomendas com status "Pendente"

**Request (do Otimizador → Encomendas):**
```http
GET https://encomenda-com-smartped-887122622666.us-east1.run.app/api/integracao/encomendas/pendentes
x-api-key: SUA_CHAVE_INTEGRACAO
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

### 3.2. POST /api/integracao/encomendas/confirmar-pedido (proxy)

**Purpose:** Atualizar status de encomendas para "Encomendado" após o pedido ser enviado à distribuidora

**Request (do Otimizador → Encomendas):**
```http
POST https://encomenda-com-smartped-887122622666.us-east1.run.app/api/integracao/encomendas/confirmar-pedido
x-api-key: SUA_CHAVE_INTEGRACAO
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
| `itens[].status` | string | Não | Se `"nao_atendido"`, encomenda NÃO avança pra "Encomendado" — fica "Pendente" com observação anexada. Qualquer outro valor (ou omitido) = confirma normalmente. |
| `itens[].observacao` | string | Não | Texto livre, anexado ao campo de observações com timestamp automático. Pode vir junto com `status: "nao_atendido"` ou sozinho. |

**Response (Encomendas → Otimizador):**
```json
{
  "sucesso": true,
  "resultado": { ... }
}
```

**Efeito no banco Encomendas:**
- `status` → `"Encomendado"` (era `"Pendente"`) — ou permanece `"Pendente"` se `status: "nao_atendido"`
- `fornecedor` → preenchido com o nome da distribuidora
- `dataPrevisao` → preenchida com a data prevista

---

### 3.3. POST /api/encomendas/buscar-ofertas-batch (direto, não é proxy)

**Purpose:** Buscar ofertas SmartPed pra lote de encomendas de uma vez

**Diferença dos endpoints anteriores:** Este NÃO é proxy pro Encomendas — é busca direta na SmartPed, feito por este servidor.

**Endpoint local:** `POST /api/encomendas/buscar-ofertas-batch`

**Throttle proposital:**
- `CONCURRENCY = 1` (processa 1 EAN por vez)
- `ENCOMENDA_DELAY_MS = 200` (delay entre EANs)
- **Motivo:** Bug #39 — APIs externas sobrecarregavam e itens se perdiam quando processados em paralelo

---

### 3.4. POST /api/integracao/encomendas/reconciliar (server-side)

**Purpose:** Verificar encomendas pendentes de confirmação que ficaram "esquecidas" porque o navegador do usuário fechou antes do distribuidor retornar.

**Endpoint local:** `POST /api/integracao/encomendas/reconciliar`

**Lógica:**
1. Busca em `order_items` linhas com `origem = 'encomenda'`, `id_encomenda IS NOT NULL` e `encomenda_confirmada = 0`
2. Agrupa por `num_pedido`
3. Para cada `numPedido`, consulta `/api/pedido-retorno` (SmartPed) — throttle `CONCURRENCY=1`, delay 2s entre pedidos
4. Para cada item de encomenda:
   - Se distribuidor finalizou (`Status === 3`) E `QuantFaturada > 0`: confirmar normalmente
   - Se finalizou E `QuantFaturada === 0`: confirmar com `status: "nao_atendido"` + motivo do retorno
   - Se ainda não finalizou: pular, tentar no próximo ciclo
5. Marca `encomenda_confirmada = 1` no banco após confirmação bem-sucedida

**Throttle:**
- `CONCURRENCY = 1` (1 pedido SmartPed por vez)
- Delay de 2s entre pedidos
- Retry automático no próximo ciclo se falhar

**Pode ser chamado:** manualmente (botão) ou futuramente como job periódico (setInterval de alguns minutos). Nesta primeira versão, é sob demanda.

### 3.5. POST /api/order-items/mark-encomenda-confirmada

**Purpose:** Marcar encomenda como confirmada no banco (chamado pelo client-side após confirmação bem-sucedida).

**Payload:** `{ idEncomenda: string }`

**Efeito:** `UPDATE order_items SET encomenda_confirmada = 1 WHERE id_encomenda = ? AND origem = 'encomenda'`

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
│  2. OTIMIZADOR: Botao "Importar Encomendas"                          │
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
│     ├─ Dropdown: Mesmo Produto | Genericos/Similares                 │
│     ├─ Usuario ajusta oferta e quantidade                            │
│     └─ Clica "Importar Selecionados"                                 │
│                                                                      │
│  5. CONFIRMACAO                                                      │
│     ├─ Itens injetados no relatorio com origem="encomenda"           │
│     ├─ alternatives = TODAS as ofertas (permite trocar no pre-pedido)│
│     ├─ Salvo em Turso (tabela itens_manuais, campo origem/id_encomenda)│
│     └─ (Opcional) POST confirmar-pedido → status "Encomendado"       │
│                                                                      │
│  6. PRE-PEDIDO (SwapsTable)                                          │
│     ├─ ConditionSelector mostra todas as ofertas como alternativas   │
│     ├─ Usuario pode trocar fornecedor/condicao se pedido min. falhar │
│     └─ Faturamento segue fluxo normal                                │
│                                                                      │
│  7. POS-FATURAMENTO (automatico)                                     │
│     ├─ Apos retorno SmartPed, POST confirmar-pedido enviado          │
│     │  automaticamente pra encomendas processadas                     │
│     │  (sucesso → "Encomendado" / falha → "nao_atendido")            │
│     └─ Marca encomenda_confirmada=1 no banco (previne dupla)         │
│                                                                      │
│  8. RECONCILIACAO (server-side, sob demanda)                         │
│     └─ Se navegador fechou antes do retorno:                          │
│        ├─ Busca itens com encomenda_confirmada=0                      │
│        ├─ Consulta SmartPed Pedido/Retorno (CONCURRENCY=1)            │
│        ├─ Finalizou + faturado → confirma                             │
│        ├─ Finalizou + NÃO faturado → "nao_atendido"                  │
│        └─ Ainda aguardando → tenta no próximo ciclo                  │
│                                                                      │
└─────────────────────────────────────────────────────────────────────┘
```

---

## 5. Variaveis de Ambiente

| Variavel | Onde usar | Descricao |
|----------|-----------|-----------|
| `ENCOMENDAS_API_URL` | Otimizador (backend) | URL base do sistema Encomendas |
| `ENCOMENDAS_INTEGRATION_KEY` | Otimizador (backend) | Chave `x-api-key` para autenticacao |

**⚠️ IMPORTANTE:** Ambas as variaveis devem estar configuradas no Cloud Run. O deploy com `--set-env-vars` (apenas Turso) APAGA essas variaveis. Sempre usar `--env-vars-file` com todas as variaveis do `.env`.

---

## 6. Colunas origem/id_encomenda

As tabelas `order_items`, `itens_confirmados` e `itens_manuais` possuem as colunas `origem` e `id_encomenda` pra rastrear se um item veio de encomenda vs. fluxo manual/normal.

- `origem`: valor `'encomenda'` quando o item foi importado do sistema Encomendas
- `id_encomenda`: ID da encomenda no sistema Encomendas (cruza dados entre sistemas)

**Histórico:** Bug #27 — migração dessas colunas nunca rodava contra Turso (só existia em `runMigrations`, usado exclusivamente no caminho SQLite puro). Corrigido: `initTursoSchema()` agora tem as 6 migrações ALTER TABLE (database.ts:266-271).

---

## 7. Erros Comuns e Solucoes

| Erro | Causa | Solucao |
|------|-------|---------|
| `401 Não autorizado` | `ENCOMENDAS_INTEGRATION_KEY` ausente ou incorreta no Cloud Run | Redeploy com `--env-vars-file` contendo todas as variaveis |
| `500 Resposta não é JSON` | Encomendas offline ou URL incorreta | Verificar `ENCOMENDAS_API_URL` e status do servico Encomendas |
| `400 Array 'itens' é obrigatório` | Payload de confirmar-pedido sem campo `itens` | Verificar formato do payload no frontend |

---

## 8. Notas Tecnicas

- **Proxy reverso:** O Otimizador esconde a chave de integracao do frontend. Request do browser → `/api/integracao/...` → backend injeta `x-api-key` → Encomendas.
- **Filtro duplo:** O backend Otimizador filtra `status === "Pendente"` mesmo que o Encomendas já filtre (garantia extra).
- **CORS:** O proxy evita problemas de CORS entre navegadores e o servico Encomendas.
- **Rastreabilidade:** Cada item importado salva `idEncomenda` no Turso (tabela `itens_manuais`), permitindo cruzar dados entre sistemas.
- **Pendência:** Fornecedores externos (`external_suppliers`) NÃO competem no fluxo de encomendas (`/api/encomendas/buscar-ofertas-batch`). Decisão pra outra sessão.

---

## 9. Monitoramento Server-Side de Retorno (pedidos_monitorados)

### Problema que resolve

O polling de retorno (`handleCheckOrderReturn` em `useBilling.ts`) só roda enquanto a modal de faturamento está aberta. Fechar a modal mata o polling — encomendas não são confirmadas se a modal fechar antes do retorno completo. Além disso, `/api/itens-confirmados-do-dia` gravava `itens_confirmados` toda vez que a tela era aberta, mas isso capturava "quando alguém abriu a tela", não "quando faturou de verdade".

### Solução

Job server-side persistido em `server/pedido-monitor.ts` que sobrevive ao fechamento da modal e ao restart do servidor.

### Quando começa

Após envio bem-sucedido em `/api/faturar` (server.ts:~7443). O endpoint insere uma linha em `pedidos_monitorados` com status `monitorando`, armazenando `itemsFaturados`, `encomendasPendentes`, `relatedGroups` e `baseDistName` como JSON serializado.

### Intervalo de verificação

- **Scheduler:** `setInterval` a cada 1 minuto (server.ts:~178)
- **Por pedido:** age a cada 10 minutos (`last_checked_at` check)
- **Forçar agora:** `POST /api/pedidos-monitorados/:numPedido/forcar-verificacao` — ignora o intervalo de 10min, chama `checkPedidoReturn` direto

### O que acontece em cada cenário

| Cenário | Ação |
|---------|------|
| Distribuidor com Status !== 3 | Aguarda próxima verificação |
| Distribuidor Status === 3, pelo menos 1 item faturado | Salva em `itens_confirmados` (via `saveItensConfirmadosBatch`), confirma encomenda (`ENCOMENDAS_API_URL` com `x-api-key`) |
| Distribuidor Status === 3, nenhum item faturado | Salva em `itens_confirmados` como `nao_confirmado`, confirma encomenda como `nao_atendido` com motivo |
| Todos distribuidores finalizados | Marca `status='concluido'` em `pedidos_monitorados` |

### Confirmação de encomendas

O job chama diretamente `ENCOMENDAS_API_URL/api/integracao/encomendas/confirmar-pedido` com header `x-api-key: ENCOMENDAS_API_KEY` (mesmas env vars de server.ts). Não usa o proxy interno do servidor — evita overhead de HTTP round-trip desnecessário.

### Painel de intervenção manual

`PedidosMonitoradosPanel.tsx` — componente que lista pedidos com `status='monitorando'`, botões "Verificar Agora" e "Encerrar Monitoramento". Acessível na aba "Otimizador de Pedidos" abaixo do UploadBox.

### Endpoints

| Endpoint | Método | Descrição |
|----------|--------|-----------|
| `/api/pedidos-monitorados` | GET | Lista pedidos monitorados (filtro opcional `?cnpj=`) |
| `/api/pedidos-monitorados/:numPedido/forcar-verificacao` | POST | Verifica retorno imediatamente |
| `/api/pedidos-monitorados/:numPedido/encerrar` | POST | Para monitoramento (status `encerrado_manual`) |

### Correção importante (FIX 2)

O endpoint de confirmação de encomendas em `pedido-monitor.ts` agora usa `ENCOMENDAS_API_URL` + `x-api-key: ENCOMENDAS_API_KEY` (lido direto de `process.env`), NÃO `CONFIG.SMARTPED_PRODUCTION_URL`. A rota interna `/api/integracao/encomendas/confirmar-pedido` em server.ts é um proxy que faz a mesma coisa — o job a chama direto pra evitar round-trip.
