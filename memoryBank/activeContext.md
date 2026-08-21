# Active Context

## Date: 2026-08-21

## Current Task: Confirmação Automática de Encomendas Pós-Faturamento — Implementado

### Estado Final da Sessão
- **Branch ativa:** `master` (commit pendente)
- **Branch feature:** `feature/whatsapp-pedidos`

### O que foi feito nesta sessão
1. **Verificação de Payload** — Analisado `faturamento_payload_Todas_as_Distribuidoras (5).json` (31 itens). Todos com `codProdutoDist` e `codProduto` preenchidos. Confirmado que mecanismo `disabledItemCodes` (Set) filtra itens ANTES de gerar JSON.
2. **Correção de Info Errada** — Outro sistema de IA afirmou incorretamente que campo `"disabled": false` no JSON controlaria faturamento. Análise confirmou que o controle real é `disabledItemCodes` no frontend (`useBilling.ts:51`).
3. **Confirmação Automática de Encomendas** — Implementado backend (`server.ts:4464-4485`) que após faturamento:
   - Filtra itens com `origem === "encomenda"` e `idEncomenda`
   - Deduplica por `idEncomenda`
   - Chama `POST /api/integracao/encomendas/confirmar-pedido` no sistema externo
   - Execução asíncrona (não bloqueia resposta)
4. **Documentação Atualizada** — `LLM_CONTEXT.md` (seção 4.6) e `AGENTS.md` (regra #38)
5. **Lint OK** — `tsc --noEmit` sem erros

### Faturamento Realizado
- **Pedido SmartPed #224** — sucesso
- **Protocolo:** SP-2026-0821-9459
- **Valor:** R$ 901,22 | Economia: R$ -292,92
- **31 itens** processados e enriquecidos
- **Retorno SmartPed** — HTTP 200

### Backend (sessão anterior — já implementado)
- Tabelas Turso: `pedidos_whatsapp`, `whatsapp_rules`
- 7 endpoints CRUD + integração regra lab no `/api/optimize`
- Normalização snake_case → camelCase em todos endpoints de leitura
- Confirmação automática de encomendas pós-faturamento

### Frontend (sessão anterior — já implementado)
1. **WhatsAppOrdersView.tsx** — Componente completo: lista pedidos, filtro por status, busca, status change
2. **App.tsx** — Nova aba "📱 Pedidos WhatsApp" + TODO removido (confirmação feita pelo backend)
3. **ConfigurationPanel.tsx** — Campo `tipoFiltro` + CRUD sync com Turso + parser de `% desconto`
4. **SwapsTable.tsx** — Badge "📱 WhatsApp" verde para `motivoAcao: "whatsapp_regra_lab"`
5. **WhatsAppOrderModal.tsx** — Botão "Salvar Pedido" que persiste no Turso
6. **types.ts** — `ExternalProduct.discountPercent?: number`

### Mapeamento de Nomenclatura (Banco → API → Frontend)
| Banco (snake_case) | API (camelCase) | Frontend (camelCase) |
|--------------------|-----------------|---------------------|
| `data_pedido` | `dataPedido` | `dataPedido` |
| `nome_regra` | `nomeRegra` | `nomeRegra` |
| `termo_filtro` | `termoFiltro` | `termoFiltro` |
| `tipo_filtro` | `tipoFiltro` | `tipoFiltro` |

### Próxima sessão
- **Persistir fornecedores no Turso** (atualmente só localStorage)
- **Automação importação**: Importar listas WhatsApp automaticamente
- **UI**: Mostrar preview de economia no ConfigurationPanel antes de otimizar
- **Deploy** — Último deploy: `smartped-cli-00050` (pendente)
- **Lint OK** (`tsc --noEmit` sem erros)
