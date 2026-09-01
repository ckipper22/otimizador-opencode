# Plano: Promocoes do Dia (Analise Automatica de Promocoes WhatsApp)

> Status: CONCLUÍDO (2026-08-31)
> Data original: 2026-08-22
> Implementação: AGENTS.md seção "Ofertas do Dia", docs/arvore-decisoes-busca-api.md seções 2-4

---

## 1. O que e

Sistema que recebe promocoes via WhatsApp (pelo chatbot) OU lista manual, salva no banco, analisa automaticamente (vendas, custo, estoque) e mostra ao comprador se a promocao e boa ou nao.

### Fluxo resumido

1. Vendedor manda WhatsApp com promocao (ou usuario adiciona lista manualmente)
2. Chatbot/usuario salva no banco (`external_suppliers`)
3. **Gatilho automatico** dispara analise em background
4. Sistema analisa: vende? quanto custa? tem estoque? comprou antes?
5. **Auto-descarte**: ofertas mais caras que ultimo preco pago ou SmartPed sao descartadas
6. Mostra na tela com economia total
7. Comprador adiciona as boas ao pedido

---

## 2. Arquitetura de Background Processing

### Gatilho: Endpoint POST /api/external-suppliers

Quando uma nova lista de promocoes e salva (via chatbot OU tela do projeto), o endpoint dispara analise em background IMEDIATAMENTE.

```
Chatbot salva     → POST /api/external-suppliers → dispara analise
Usuario adiciona  → POST /api/external-suppliers → dispara analise
                       ↓
              MESMO endpoint, MESMO gatilho
```

### Fluxo de Background Processing

```
1. POST /api/external-suppliers recebe lista
   ├─ Salva produtos em external_suppliers (status_analise = "pendente")
   ├─ Retorna 200 rapidamente (nao espera analise)
   └─ Dispara: analisarProdutosEmBackground(supplierId)

2. Background worker (async, nao bloqueia):
   ├─ Pega 1 produto pendente
   ├─ Busca EAN via buscar-lote (se nao tiver)
   ├─ Busca vendas semanais
   ├─ Busca estoque por laboratorio (similares)
   ├─ Busca historico de compras (preco_tabela + preco_unitario)
   ├─ Busca preco SmartPed (Ean + Molecula)
   ├─ Auto-descarte se: preco > ultimo_pago OU preco > SmartPed
   ├─ Salva dados_analise JSON + status = "analisado"
   └─ Repete proximo produto

3. Quando usuario abre modal:
   ├─ Le external_suppliers WHERE status_analise = "analisado"
   ├─ Dados ja prontos (instantaneo, sem delay)
   └─ Mostra apenas ofertas "analisadas" (nao pendentes)
```

### Colunas novas em external_suppliers

| Coluna | Tipo | Descricao |
|--------|------|-----------|
| `dados_analise` | TEXT (JSON) | Resultado completo da analise |
| `status_analise` | TEXT | `pendente` / `analisado` / `erro` / `descartada` |
| `analyzed_at` | TEXT | Timestamp de quando foi analisada |

### Formato do dados_analise (JSON)

```json
{
  "vendasMensais": 112,
  "estoqueTotal": 22,
  "estoquePorLaboratorio": [
    {"nome": "MEDLEY", "quantidade": 20, "eans": ["7896422506342"]},
    {"nome": "EMS", "quantidade": 2, "eans": ["7896422506343"]}
  ],
  "melhorPrecoSmartPed": 3.27,
  "melhorDistribuidora": "SmartPed",
  "melhorPrecoHistorico": 2.57,
  "melhorFornecedorHistorico": "CERVOSUL",
  "ultimaCompra": {
    "preco": 5.18,
    "precoTabela": 5.54,
    "fornecedor": "GRUPO SC",
    "data": "2026-08-05",
    "quantidade": 15
  },
  "comprasHistorico": [
    {"preco": 5.18, "precoTabela": 5.54, "fornecedor": "GRUPO SC", "data": "2026-08-05", "quantidade": 15}
  ],
  "economiaPercent": 8.6,
  "economiaValor": 0.28,
  "economiaMensal": 31.36,
  "boaOferta": true
}
```

---

## 3. Auto-Descarte de Ofertas Ruins

### Criterios de descarte automatico

| Criterio | Acao |
|----------|------|
| Preco da promocao > ultimo preco que paguei (historico) | ❌ status = "descartada" |
| Preco da promocao > melhor preco SmartPed (com estoque) | ❌ status = "descartada" |
| Sem vendas (produto nao vende) | ❌ status = "descartada" |
| Preco da promocao <= historico E <= SmartPed | ✅ status = "analisado" |

### Justificativa de descarte

```json
{
  "descartada": true,
  "motivo": "Preco R$ 6,29 > ultimo pago R$ 5,56 (SMART DISTRIB)"
}
```

---

## 4. Busca Manual vs Automatica

### Comportamento do botao flutuante

```
Botao flutuante "Promocoes do Dia"
  │
  ├─ Campo de busca: "Digite um produto..."
  │   └─ Se digitar → busca SÓ o que digitou (ex: "losartana")
  │
  ├─ Botao "Buscar"
  │   └─ Executa busca (manual ou automatica)
  │
  └─ Botao "Ver todas as ofertas boas"
      └─ Mostra SÓ as que valem a pena (economia >= 10%)
```

### Fluxo de busca

1. **Busca manual**: Usuario digita "losartana" → filtra por texto no campo `produto`
2. **Busca automatica**: Clica "Buscar" sem texto → carrega todas as ofertas analisadas
3. **Ofertas boas**: Clica "Ver todas as ofertas boas" → filtra por `boaOferta = true`

---

## 5. Origem: WhatsApp vs SmartPed

### Marcacao de origem ao adicionar

Ao adicionar um item da lista de ofertas ao pedido, marcar a origem:

| Origem | Comportamento |
|--------|---------------|
| `origem: "whatsapp"` | Preco exclusivo WhatsApp - NAO vai pra SmartPed |
| `origem: "smartped"` | Preco normal SmartPed - fatura pela API |

### Botao de acao conforme origem

| Itens no lote | Botao mostrado |
|---------------|----------------|
| Todos SmartPed | "Faturar" (chama API SmartPed) |
| Todos WhatsApp | "Enviar WhatsApp" (gera mensagem) |
| Misturado | "Resumir" (mostra quais vao pra onde) |

---

## 6. Endpoints

### Endpoints existentes (modificados)

| Endpoint | Metodo | Mudanca |
|----------|--------|---------|
| `POST /api/external-suppliers` | POST | Adiciona trigger de background processing |
| `GET /api/ofertas-dia/analisar` | GET | Le dados_analise do banco (instantaneo) |

### Fluxo de dados

```
external_suppliers (banco)
  │
  ├─ id, name, products, validade, cnpj (existentes)
  ├─ dados_analise (JSON com resultado da analise)
  ├─ status_analise (pendente/analisado/erro/descartada)
  └─ analyzed_at (timestamp)
  
  ↓
  
GET /api/ofertas-dia/analisar
  │
  ├─ LE dados_analise do banco (nao chama APIs)
  ├─ Retorna ofertas ja analisadas
  └─ Resposta instantanea
```

---

## 7. Tela proposta

### 7.1 Card principal (resumido)

```
Losartana 50mg 30cp - EMS
R$ 8,50 | Melhor: R$ 8,90 (Gauchafarma) | -4,5%
Vendas: 80/mes | Estoque: 23 cx
Economia: R$ 32,00/mes
[Adicionar]  [Detalhes]
```

### 7.2 Estoque expandido (clique em Detalhes)

```
Estoque por Laboratorio (mesma composicao):
  MEDLEY / SANOFI *  ████████████████  20 cx  91%
  ACHE/BIOSINTETICA  █                 2 cx   9%
  EMS                │                 0 cx   0%
  PHARLAB            │                 0 cx   0%

* = mesmo EAN da promocao          Total: 22 cx
```

### 7.3 Historico de compras

```
Seus Precos (Ultimos 6 meses)
Custo Real    Tabela       Fornecedor              Data        Qtd    NF
R$ 5,18       R$ 5,54 (-6%)  GRUPO SC DISTRIBUICAO   2026-08-05  15    8228012
R$ 1,74 ★     R$ 5,54 (-73%) GRUPO SC DISTRIBUICAO   2026-07-02  5     7790319
```

---

## 8. Endpoints da API Ferramentinhas

| Dado | Endpoint | Fonte |
|------|----------|-------|
| Buscar EAN por descricao | POST /api/produtos/buscar-lote | Ferramentinhas |
| Vendas semanais | GET /api/chatbot/produto/vendas-semanais/{ean} | Ferramentinhas |
| Estoque por laboratorio | GET /api/produtos/similares/{ean} | Ferramentinhas |
| Historico de compras | GET /api/produtos/compras-historico/{ean}?meses=6 | Ferramentinhas |
| Precos SmartPed | POST /api/Condicoes/Ean + /api/Condicoes/Molecula | SmartPed |

### Formato da resposta compras-historico

```json
{
  "compras": [
    {
      "data": "2026-08-05",
      "fornecedor": "GRUPO SC DISTRIBUICAO LTDA",
      "nota_fiscal": 8228012,
      "preco_tabela": 5.54,
      "preco_unitario": 5.18,
      "quantidade": 15
    }
  ],
  "resumo": {
    "melhor_preco": 1.74,
    "melhor_fornecedor": "GRUPO SC DISTRIBUICAO LTDA",
    "ultima_compra_preco": 5.18
  }
}
```

---

## 9. Ordem de implementacao

### Fase 1 - Backend (AGORA)
1. ✅ Adicionar colunas dados_analise/status_analise em external_suppliers
2. ✅ Criar funcao de analise em background
3. ✅ Adicionar trigger no POST /api/external-suppliers
4. ✅ Implementar auto-descarte por criterios de preco
5. ✅ Modificar GET /api/ofertas-dia/analisar para ler do banco

### Fase 2 - Frontend (PROXIMO)
6. ✅ Modal de detalhes com historico de compras
7. ✅ Estoque por laboratorio (mesma composicao)
8. Busca manual vs automatica no modal
9. Marcar origem (WhatsApp/SmartPed) ao adicionar
10. Botao "Faturar" vs "Enviar WhatsApp"

### Fase 3 - Integracao
11. Integrar com pre-pedido (adicionar itens)
12. Integrar com otimizacao (verificar ofertas antes de comprar)
13. Testes manuais

---

## 10. Status da implementacao

| Item | Status |
|------|--------|
| Backend: analise de ofertas | ✅ Funcionando |
| Frontend: card de produto | ✅ Funcionando |
| Frontend: modal de detalhes | ✅ Funcionando |
| Estoque por laboratorio | ✅ Funcionando |
| Historico de compras | ✅ Funcionando (preco_tabela + preco_unitario) |
| Background processing | ✅ Funcionando (analisarFornecedorEmBackground no POST /api/external-suppliers) |
| Auto-descarte | ✅ Funcionando (preco > ultimo pago OU > SmartPed → descartada) |
| Busca manual vs automatica | ⏳ Parcial (busca por texto funciona, falta "Ver todas as ofertas boas") |
| Origem WhatsApp/SmartPed | ✅ Funcionando (badge "📋 Lista: {fornecedor}" + botão "Enviar WhatsApp" via isExternalManual) |
