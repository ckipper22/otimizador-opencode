# Active Context

## Date: 2026-08-24

## Current Task: Botão P (EanPromoButton) + Firebase Auth — RESOLVIDO

### Estado Final da Sessão
- **Branch ativa:** `master`
- **Lint:** `tsc --noEmit` sem erros
- **Deploy:** `smartped-cli-00062-dft` (v2026-08-24-0000)
- **GitHub:** Pushed (commits f9a74c7 + 7ccdc6e)

### O que foi feito nesta sessão
1. **EanPromoButton** — Botão "P" ao lado de cada olhinho (5 ocorrências no SwapsTable)
   - Busca EAN na Trier → pega descrição exata
   - Busca por descrição → grupo DCB completo (todos EANs de todas labs)
   - Chama `analisar-referencia` → vendas somadas de todos os EANs
   - Card (réplica exata do OfertasDoDiaModal) + Detail modal completo
2. **Firebase Auth fix** — `getFirebaseAuth()` async resolveu "Cannot read properties of null"
   - `firebaseClient.ts`: Nova função async que aguarda inicialização
   - `useAuth.ts`: Usa `await getFirebaseAuth()` em vez de import direto
3. **Documentação** — LLM_CONTEXT.md §4.11, AGENTS.md bug #22

### Arquivos criados/modificados
- `src/components/EanPromoButton.tsx` — novo componente
- `src/components/SwapsTable.tsx` — import + 5 inserções
- `src/lib/firebaseClient.ts` — getFirebaseAuth()
- `src/hooks/useAuth.ts` — usa getFirebaseAuth()
- `LLM_CONTEXT.md` — seção 4.11
- `AGENTS.md` — bug #22 na tabela CEGUEIRA ANTIGA

### Pendências
- **Busca manual vs automática** — Falta "Ver todas as ofertas boas" (botão que filtra `boaOferta = true`)
- **Automação importação** — importar listas WhatsApp automaticamente
- **Chatbot** — integrar chatbot para alimentar listas de fornecedores
