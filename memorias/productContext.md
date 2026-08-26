# Product Context — Regras de Negócio

## Fluxo Principal
Upload SICF → Parse EANs → Consulta SmartPed (Ean + Molecula em paralelo) → Motor de trocas → Faturamento

## Regras Críticas de Otimização

### SmartPed: Ambos endpoints obrigatórios
- `Condicoes/Ean` + `Condicoes/Molecula` SEMPRE em `Promise.all`
- `QtdMin` vem do Molecula, não do Ean
- `Condicoes/Ean` exige `AceitaOntem: 1`
- Batch de até 40 EANs por chamada

### Classificação de Produtos
Fonte primária: campo `grupo` da Ferramentinhas (`/api/produtos/similares/{ean}`)
- Genérico → busca subs (só genéricos). Ruptura → similar OK, NÃO referência
- Similar/Referência → sem subs. Ruptura → qualquer coisa com estoque
- Perfumaria/Correlatos → nunca buscar subs
- SmartPed `TipoItem` é fallback

### Motor de Trocas (`findBestSubstitute`)
- Prioridade para ofertas reais (CodDist > 0) sobre "Não Encontrados"
- Item original é soberano (imune a filtros de tipo/margem)
- Ruptura: ignora `margemMinima`, aceita qualquer preço com estoque
- Deduplicação: chave `${Ean}_${CodDist}_${Condicao}_${Prazo}` (sem preço)

### Faturamento
- Blindagem 4 regras: validação de swaps, expurgo sem dist/estoque, EAN destino válido, lote único
- `CodProdutoDist` obrigatório (vem de `Condicoes/Ean`)
- Confirmação encomendas: só após retorno SmartPed com status=faturado

### PMC
- APENAS se API retornar. NUNCA calcular `preco * 1.4`
- Case-sensitivity: `PMC || pmc || Pmc`

## Regras de UI

### Tabela (SwapsTable)
- Agrupamento por `distribuidora [condicao | prazo]`
- Botão "Enviar WhatsApp" para itens com `motivoAcao: "whatsapp_regra_lab"`
- Badges vendas/estoque: `text-sm font-bold` (maiores que antes)

### Modal "+"
- Busca híbrida: descrição → Produtos/Buscar → Condicoes/Ean + Molecula
- Deduplicação inteligente por menor preço
- Dropdown: optgroup "Mesmo Produto" | "Genéricos/Similares"

### Itens Manuais
- Persistência dupla: localStorage + Turso
- Aba "Itens Manuais" com status (Faturado/Falta/Não Faturado)
