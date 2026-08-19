# Memory Bank — Otimizador SmartPed

Banco de memória persistente entre sessões.

## Arquivos

| Arquivo | Conteúdo | Quando atualizar |
|---------|----------|------------------|
| `activeContext.md` | Estado atual da sessão, tarefas pendentes, decisões | **FIM de cada sessão** ou ao digitar `[SAVE]` |
| `README.md` | Este arquivo | Raramente |

## Fonte da Verdade

O `LLM_CONTEXT.md` (raiz) é a fonte da verdade. Este memoryBank é apenas um ponteiro de estado entre sessões.

## Fluxo

```
INÍCIO: Ler memoryBank/activeContext.md → retomar de onde parou
FIM:    Atualizar memoryBank/activeContext.md com resumo da sessão
[SAVE]: Digitar [SAVE] para forçar salvamento imediato
```

## Regra #32 (AGENTS.md)
> Ao final de CADA sessão, atualizar `memoryBank/activeContext.md`. Ao digitar `[SAVE]`, interromper e salvar imediatamente.
