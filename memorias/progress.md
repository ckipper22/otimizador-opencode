# Progress — Histórico Resumido

## Sessões Recentes (Agosto 2026)

### 2026-08-25 (noite)
- Timing de confirmação de encomendas (só após retorno SmartPed)
- Herança de codProduto para itens manuais
- Filtro tipo WhatsApp via Ferramentinhas (não regex)
- Fix acento resolveCategoria (NFD normalization)
- SmartPed batch EAN implementado
- SmartPed multi-EAN expansion para Promoções do Dia
- Filtro de apresentação (SH≠CR) em vendas/estoque

### 2026-08-24
- Botão P (EanPromoButton) ao lado do olhinho
- Firebase Auth fix (getFirebaseAuth async)
- Price tiers (quantity breaks) para promoções WhatsApp
- Deploy v2026-08-24-0000

### 2026-08-23
- PFAB vs Pliquido: preço de tabela para desconto
- Correção estoque no modal Promoções do Dia
- Sync de preços: purge corrigido, fallback descartado

### 2026-08-22
- Promoções do Dia: background processing
- Auto-descarte de ofertas
- Origem WhatsApp/SmartPed

### 2026-08-21
- Backend WhatsApp implementado
- External suppliers migrados para Turso com validade
- Confirmação automática de encomendas pós-faturamento

### 2026-08-20
- Correções CodProdutoDist e filtros de dropdown
- RETRY-CODPRODDIST com descarte de candidatos inválidos
- Cross-contamination filter

## Bugs Históricos Importantes
- Deploy apaga variáveis (usar --env-vars-file)
- better-sqlite3 SIGSEGV (migrado para Turso)
- Mojibake em nomes de distribuidora (isNotFoundName)
- Deduplicação por preço errado (chave sem preço)
- Encomendas preço R$ 0.00 (normalização PascalCase→lowercase)
