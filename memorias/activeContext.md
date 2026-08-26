# Contexto Ativo — Última Sessão: 2026-08-26

## Status do Sistema
- **Versão:** v2026-08-26 (deploy smartped-cli-00069-jzq)
- **URL:** https://smartped-cli-887122622666.us-east1.run.app
- **GitHub:** pushes 26/08 (4 commits)

## Sessão 2026-08-26 — Apresentação, Vendas, WhatsApp e Segurança

### Fixes

1. **mesmaApresentacao() — matching por dosagem/DCB (server/parsers.ts)**
   - Matching por dosagem/DCB quando item do pedido não tem DCB (regex de descrição extraída)
   - DCB emprestado da própria lista de similares quando ausente
   - Liberação prolongada (L.P./XR) separada de comprimido normal (`liberacaoProlongada` flag)

2. **Endpoint /vendas-resumo (server.ts)**
   - Criado `/api/chatbot/produto/vendas-resumo` substituindo `/vendas-detalhadas` (tinha LIMIT 100, subestimava giro rápido)
   - Helper `fetchVendasResumo()` unificado para chamadas internas

3. **Matching de regra WhatsApp — por whatsappRuleId (server.ts)**
   - Trocado de texto (laboratório/descrição) para `whatsappRuleId` direto — mais confiável

4. **Segurança: remoção de secrets hardcoded**
   - Token SmartPed e senha admin removidos do frontend e backend
   - Autenticação client-side insegura removida — login agora só via Google/Firebase

### Deploy
- 4 commits (security, fix apresentação/vendas, feat WhatsApp, docs)
- Push pro GitHub + deploy Cloud Run (smartped-cli-00069-jzq) — verificado no ar, sem segredos no bundle

### O Que Funciona
- `mesmaApresentacao()`: matching robusto com DCB emprestado e L.P./XR separado ✅
- Vendas-resumo: endpoint unificado, sem LIMIT 100 ✅
- WhatsApp regra: matching por whatsappRuleId (não mais texto) ✅
- Segurança: zero secrets no bundle, login só via Firebase ✅
- Encomendas: confirmação só após retorno SmartPed ✅
- codProduto: herança para TODOS os itens ✅
- `resolveCategoria`: acentos normalizados ✅

### O Que Está Pendente
- **WhatsApp grupo separado:** ainda NÃO diagnosticado — precisa rastrear caso real
- Documentação reorganizada em `memorias/` + `docs/_archive/`

### Arquivos Modificados Nesta Sessão
- `server/parsers.ts` — `mesmaApresentacao()` (DCB emprestado, L.P./XR, dosagem)
- `server.ts` — `/api/chatbot/produto/vendas-resumo`, `fetchVendasResumo()`, matching WhatsApp por `whatsappRuleId`
- Segurança: remoção de tokens/senhas hardcoded (frontend + backend)
- `memorias/` + `docs/_archive/` — reorganização da documentação

## Regras Importantes
- **Tudo de vendas/estoque vem do Ferramentinhas** — SmartPed só para pricing
- **erpEans ≠ eanList** — erpEans = Ferramentinhas, eanList = Ferramentinhas + SmartPed
- **Word boundary obrigatório** em filtros de apresentação
- **Wildcard Trier:** quando buscar-lote retorna vazio, tentar `PRINCÍPIO%`
- **estoqueTotal** = `similares/{ean}` (Ferramentinhas), NÃO `eansGrupo`
- **Encomendas:** confirmação DEPOIS do retorno, nunca antes
- **codProduto:** herança para TODOS os itens (manual, encomenda, qualquer origem)
- **resolveCategoria:** SEMPRE normalizar acentos antes de `.includes()` — API Ferramentinhas retorna "Genérico" (com acento)
