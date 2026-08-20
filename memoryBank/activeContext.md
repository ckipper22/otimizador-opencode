# Active Context

## Date: 2026-08-20

## Current Task: Fix codProdutoDist empty in faturamento payload

### Root cause (DEFINITIVE)
O `ENRICH-POST-BATCH` só buscava `Condicoes/Ean` para EANs **originais** do SICF. Quando o motor de troca escolhe um substituto com EAN **diferente**, o `combinedCondicoes` tem as condições do EAN original, não do substituto. O enriquecimento tenta casar `cEan === sEan` — mas `cEan` é o EAN original e `sEan` é o EAN do substituto — **nunca casa**.

### Fix applied (2 changes)
1. **`ENRICH-POST-BATCH-SUBS` (server.ts ~line 1300)**: Nova segunda passada que coleta todos EANs únicos de `apiResponses[*].Substitutos` que não têm `apiResponses[subEan]` e busca `Condicoes/Ean` para eles em batch (grupos de 10). Isso popula `apiResponses[subEan].Condicoes` com `CodProdutoDist`.

2. **Bloco de enriquecimento (server.ts ~line 1770 e ~line 2463)**: Agora busca em **2 fontes**:
   - Fonte 1: `combinedCondicoes` (EANs originais/equivalentes)
   - Fonte 2: `apiResponses[sEan].Condicoes` (EANs de substitutos, populados pelo ENRICH-POST-BATCH-SUBS)

### Resultado esperado
- Substitutos com EAN diferente do original agora terão `CodProdutoDist` preenchido
- O ENRICH-POST-BATCH-SUBS adiciona chamadas API extras (grupos de 10) para EANs de substitutos
- Compile OK (tsc --noEmit passou sem erros)

### Próximo passo
- Testar com payload real para verificar se os 5 itens problemáticos agora têm `codProdutoDist`
