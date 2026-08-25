# Contexto Ativo — Última Sessão: 2026-08-25 (noite)

## Status do Sistema
- **Versão:** v2026-08-24-0000 (deploy smartped-cli-00063-qf4)
- **Servidor local:** Rodando (precisa restart para aplicar mudanças)
- **Últimas alterações:** Promoções do Dia - filtro apresentação estoque/vendas, mesesDiff real

## O Que Funciona
- SICF: vendas/estoque com filtro 4 meses e apresentação ✅
- P button (EanPromoButton): expande EANs via buscar-produto ✅
- Promoções do Dia - Estoque: card mostra estoqueTotal (soma labs) ✅
- Promoções do Dia - Filtro apresentação estoque (SH≠CR) ✅
- Promoções do Dia - Fallback estoqueGrupo→analysis.estoqueTotal ✅
- Reprocessamento: normalizeProducts() reduz falsos positivos ✅
- UI: badges "(4m)" em todos os componentes ✅

## O Que Está Pendente (Testar)
- **Vendas:** Filtro apresentação no background (eanToDesc de allProdutos) - implementado mas não testado
- **MesesDiff real:** Divisor calculado das datas reais em vez de hardcoded /4 - implementado mas não testado

## Tarefa Pendente (Próxima Sessão)
- **Testar vendas do Promoções do Dia:** Após restart do servidor, verificar se CETOCONAZOL SH mostra "1/mês" em vez de "2/mês"
- **Deploy:** Todas as mudanças precisam de deploy quando validadas localmente

## Regras Importantes (AGENTS.md)
- #54: Cálculo de vendas — método único nos 3 fluxos (ANDAM JUNTOS)
- #55: Filtro de apresentação obrigatório na expansão de EANs
- #56: normalizeProducts() antes de comparar products
- **NOVA #29-31:** Bugs de estoque/vendas no Promoções do Dia (corrigidos nesta sessão)

## Arquivos Modificados Nesta Sessão
- `server.ts`: filtro apresentação estoque (analisarUmProduto:543-571), fallback estoqueGrupo (1224-1228), filtro apresentação vendas background (1198-1240), mesesDiff real (1270-1273, 1773-1774), allProdutos escopo (1106)
- `OfertasDoDiaModal.tsx`: estoqueTotal em vez de estoqueMesmoEan (520, 883)
- `EanPromoButton.tsx`: estoqueTotal em vez de estoqueMesmoEan (260, 482)
- `AGENTS.md`: bugs #29-31 adicionados
- `LLM_CONTEXT.md`: seção 1.2.1 (filtro apresentação) adicionada, bugs atualizados, referência api ferramentinhas.txt

## Decisões Arquiteturais
- **eanToDesc** é construído de `allProdutos` (resultados buscar-lote), NÃO de `eansGrupo` (que fica vazio quando produto sem EAN)
- **SmartPed wildcards** (estoque=0, sem descrição) são excluídos do cálculo de vendas via filtro
- **mesesDiff** calculado das datas reais (primeiraData/ultimaData), não hardcoded /4
- **Fallback estoqueGrupo:** quando eansGrupo não tem estoque, usar analysis.estoqueTotal (similares API)

## Documentação
- `api ferramentinhas.txt` disponível na pasta raiz — SEMPRE consultar antes de usar endpoints Ferramentinhas
