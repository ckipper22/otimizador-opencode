# Active Context

## Date: 2026-08-23

## Current Task: Correção de Estoque no Modal Promoções do Dia — RESOLVIDO

### Estado Final da Sessão
- **Branch ativa:** `master`
- **Lint:** `tsc --noEmit` sem erros

### O que foi feito nesta sessão
1. **Correção de estoque** — `estoqueMesmoEan` agora usa total do grupo DCB (`eansGrupo.reduce()`) em vez de 1 EAN
2. **`analisarFornecedorEmBackground`** (server.ts:836-847): Extraído `estoqueGrupo`, usado para `estoqueTotal` E `estoqueMesmoEan`
3. **`analisar-referencia`** (server.ts:1329): `estoqueMesmoEan` usa `estoqueFinal` (soma de `eanList`) em vez de request body

### Arquivos modificados
- `server.ts` — linhas 836-847, 1329
- `docs/ler-primeiro.md` — seções 2.6, 2.7, 3 atualizadas
- `LLM_CONTEXT.md` — seção 4.10 adicionada

### Pendências
- **Deploy** — Pendente (deployar após commit)
- **Busca manual vs automática** — Falta "Ver todas as ofertas boas" (botão que filtra `boaOferta = true`)
- **Automação importação** — importar listas WhatsApp automaticamente
- **Chatbot** — integrar chatbot para alimentar listas de fornecedores
