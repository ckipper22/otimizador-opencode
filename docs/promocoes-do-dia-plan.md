# Plano: Promocoes do Dia (Analise Automatica de Promocoes WhatsApp)

> Status: PLANEJAMENTO - Prioridade ALTA (implementar antes da Reval)
> Data: 2026-08-22
> Ref: docs/external-suppliers-plan.md, docs/reval-api-reference.md

---

## 1. O que e

Sistema que recebe promocoes via WhatsApp (pelo chatbot), salva no banco, analisa automaticamente (vendas, custo, estoque) e mostra ao comprador se a promocao e boa ou nao.

### Fluxo resumido

1. Vendedor manda WhatsApp com promocao
2. Chatbot salva no banco (ofertas do dia)
3. Comprador clica "Buscar ofertas do dia"
4. Sistema analisa: vende? quanto custa? tem estoque?
5. Mostra na tela com economia total
6. Comprador adiciona as boas ao pedido

---

## 2. Dados que o chatbot salva

| Campo | Descricao | Exemplo |
|-------|-----------|---------|
| produto | Nome do produto | Losartana 50mg 30cp |
| ean | Codigo de barras (se tiver) | 7897595620613 |
| laboratorio | Fabricante | EMS |
| fornecedor | Quem enviou a promocao | Gauchafarma |
| preco | Preco promocional | 8.50 |
| validade | ate quando vale | 2026-08-30 |
| quantidade | Embalagem | 30cp |
| data_recebimento | Quando chegou | 2026-08-22 |

---

## 3. Analise automatica (o que o sistema faz)

Para CADA promocao recebida, o sistema busca:

### 3.1 Voce vende esse produto?

Fonte: GET /api/vendas-detalhadas/{ean} (Ferramentinhas)

Retorna: historico de vendas do produto no ERP.
Se nao tem vendas = produto que voce nao vende = descartar.

### 3.2 Qual seu melhor preco?

Fonte: GET /api/similares/{ean} (Ferramentinhas) + GET /api/compras/obter-v1 (Trier)

Retorna:
- Menor preco que voce ja pagou
- Fornecedor (distribuidora: Gauchafarma, CervoSul, etc.)
- Laboratorio (EMS, Medley, etc.)
- Data da compra

### 3.3 Tem estoque?

Fonte: GET /api/similares/{ean} (Ferramentinhas)

Retorna: qtd_estoque por laboratorio.

### 3.4 Quanto vende (total)?

Fonte: GET /api/vendas-semanais/{ean} (Ferramentinhas)

Retorna: vendas por semana. Multiplicar por 4 = vendas mensais.

### 3.5 Comparacao

`
Promocao: R$ 8,50
Melhor preco: R$ 8,90 (Gauchafarma, 15/07)
Economia: R$ 0,40/caixa (4,5%)

Vendas total (todos labs): 80 caixas/mes
Economia mensal potencial: R$ 32,00
`

---

## 4. Tela proposta

### 4.1 Card principal (resumido)

`
Losartana 50mg 30cp - EMS
R$ 8,50 | Melhor: R$ 8,90 (Gauchafarma, 15/07) | -4,5%
Vendas: 80/mes | Estoque: 23 caixas
Economia: R$ 32,00/mes
[Adicionar]  [Estoque: 23 cx]  [Detalhes]
`

### 4.2 Estoque expandido (ao clicar no botao)

`
Estoque por laboratorio:
  EMS:       15 caixas  ████████████ 65%
  Medley:     8 caixas  █████ 35%
  Pharlab:    0 caixas
  Eurofarma:  0 caixas

Total: 23 caixas (29 dias de estoque)
`

### 4.3 Detalhe completo (ao clicar em Detalhes)

`
Losartana 50mg - Analise Completa

PRECO PROMOCAO: R$ 8,50 (valido ate 30/08)

SEUS PRECOS:
  R$ 8,90  | Gauchafarma | EMS       | 15/07  <- MENOR PRECO
  R$ 9,80  | CervoSul    | Medley    | 22/07
  R$ 11,20 | Pan/Santa   | EMS       | 01/08
  R$ 12,00 | ANB         | Eurofarma | 10/08

Menor preco: R$ 8,90 (Gauchafarma, 15/07)
Promocao: R$ 8,50 (4,5% mais barato)

Ultima compra: 01/08 | Pan/Santa | R$ 11,20

[Adicionar]  [Descartar]
`

---

## 5. Tela principal (todas as ofertas)

`
OFERTAS DO DIA - 12/08/2026
[Atualizar]  [Fornecedor: Todos]

RESUMO:
  Total de ofertas: 15 produtos
  Ofertas BOAS (>15%): 8 produtos
  Economia potencial: R$ 342,00/mes

--- MEDICAMENTOS ---

Losartana 50mg 30cp - EMS
  R$ 8,50 | Melhor: R$ 8,90 (Gauchafarma) | -4,5%
  Vendas: 80/mes | Estoque: 23 cx | Economia: R$ 32,00
  [Adicionar]  [Detalhes]

Dipirona 500mg 10cp - Sanofi
  R$ 3,20 | Melhor: R$ 3,80 (CervoSul) | -16%
  Vendas: 120/mes | Estoque: 15 cx | Economia: R$ 72,00
  [Adicionar]  [Detalhes]

--- MATERIAIS ---

Luva Nitrilo M - Vabene
  R$ 9,50 | Melhor: R$ 12,00 (Pan/Santa) | -21%
  Vendas: 200/mes | Estoque: 50 cx | Economia: R$ 500,00
  [Adicionar]  [Detalhes]

TOTAL ECONOMIA POTENCIAL: R$ 604,00/mes
[Adicionar todas as boas ao pedido]
`

---

## 6. Endpoints necessarios (todos ja existem)

| Dado | Endpoint | Fonte |
|------|----------|-------|
| Vendas por produto | GET /api/vendas-detalhadas/{ean} | Ferramentinhas |
| Vendas semanais | GET /api/vendas-semanais/{ean} | Ferramentinhas |
| Custo/estoque/laboratorio | GET /api/produtos/similares/{ean} | Ferramentinhas |
| Historico de compras | GET /integracao/compra/obter-v1 | Trier SGF |
| Precos SmartPed | GET /api/Condicoes/Ean | SmartPed |

---

## 7. Banco de dados

### Tabela: ofertas_dia (novo, Turso)

| Campo | Tipo | Descricao |
|-------|------|-----------|
| id | INTEGER PK | Auto-increment |
| data_recebimento | TEXT | Timestamp ISO |
| produto | TEXT | Nome do produto |
| ean | TEXT | Codigo de barras |
| laboratorio | TEXT | Fabricante |
| fornecedor | TEXT | Quem enviou (distribuidora) |
| preco | REAL | Preco promocional |
| validade | TEXT | Data de validade da promocao |
| quantidade | INTEGER | Qtd na embalagem |
| cnpj | TEXT | Farmacia |
| status | TEXT | ativa/usada/expirada |

---

## 8. Endpoints novos

### POST /api/ofertas-dia
Salva oferta recebida pelo chatbot.

### GET /api/ofertas-dia
Lista ofertas ativas do dia (ou periodo).

### POST /api/ofertas-dia/analisar
Analisa todas as ofertas ativas (vendas, custo, estoque).
Retorna: lista de ofertas com analise completa.

### DELETE /api/ofertas-dia/{id}
Remove oferta (descartar).

---

## 9. Ordem de implementacao

### Fase 1 - Backend (DIA 1)
1. Criar tabela ofertas_dia no Turso
2. Criar endpoints CRUD
3. Criar funcao de analise (vendas + custo + estoque)
4. Integrar com chatbot (receber ofertas)

### Fase 2 - Frontend (DIA 1-2)
5. Criar tela "Ofertas do Dia"
6. Criar card de produto (resumido)
7. Criar expansao de estoque
8. Criar modal de detalhes
9. Botao "Adicionar ao pedido"

### Fase 3 - Integracao (DIA 2)
10. Integrar com pre-pedido (adicionar itens)
11. Integrar com otimizacao (verificar ofertas antes de comprar)
12. Testes manuais

---

## 10. Prioridade

ESTE FEATURE e PRIORITARIO sobre a integracao com Reval porque:
- Ja temos os endpoints prontos (Ferramentinhas + Trier)
- Resolve problema real do comprador (saber se promocao e boa)
- Menos complexidade (nao precisa de login externo, scraping, etc.)
- Impacto direto no economia da farmacia

Ordem:
1. Promocoes do Dia (ESTA SESSAO)
2. Integracao Reval (SESSAO POSTERIOR)
3. Listas de preco externas (SESSAO POSTERIOR)
