# Active Context

## Date: 2026-08-21

## Current Task: Pedidos WhatsApp — Design completo, pendente implementação

### Sessão 2026-08-21 — Resumo

#### O que foi feito
1. **Throttling encomendas** — Portado `CONCURRENCY=1, BATCH_DELAY_MS=200` de `/api/optimize` para `/api/encomendas/buscar-ofertas-batch` (server.ts:311-538). Lint OK.
2. **Revisão de pendências** — Verificado que UX Dropdown (#38) já estava resolvido.
3. **Design Pedidos WhatsApp** — Conversa longa sobre requisitos, pontos cegos e decisões.

#### Decisões de Design (Pedidos WhatsApp)
- **Regra de laboratório** = prioridade máxima (sem preço, sem comparação, vai direto WhatsApp)
- **Lista de preço** = compete com SmartPed (motor de troca normal)
- **Cálculo % desconto** = `Preco_SmartPed × (1 - desconto/100)` (campo `Preco` da SmartPed)
- **Classificação genérico** = pela descrição (resolveCategoria())
- **Item sem preço** = aparece no "+" como "Solicitar preço"
- **Tabela `pedidos_whatsapp`** = Turso, com status (Pendente/Confirmado/Recebido/Cancelado)
- **Nova aba "Pedidos WhatsApp"** = lista todos os pedidos enviados
- **Pedido mínimo** = pendente (futura implementação)
- **Automação importação** = futuro

#### Documentação
- Seção 11 adicionada ao `LLM_CONTEXT.md` com todos os requisitos

### Git state
- Branch: `master`
- Alterações pendentes (não commitadas): `server.ts`, `LLM_CONTEXT.md`, `memoryBank/activeContext.md`, `src/components/SwapsTable.tsx`
- **PRÓXIMO:** Criar branch `feature/whatsapp-pedidos` antes de abrir nova sessão de implementação

### Arquivos modificados nesta sessão
- `server.ts` — throttling encomendas batch
- `LLM_CONTEXT.md` — bug #39 marcado RESOLVIDO + seção 11 (Pedidos WhatsApp)
- `memoryBank/activeContext.md` — este arquivo
