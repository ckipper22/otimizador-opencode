# PROMPT PARA INTEGRAR O ENDPOINT BATCH DE SIMILARES

====================================================

Você é um desenvolvedor integrando o sistema SmartPed à API de Conferência de Produtos (Ferramentinhas). Sua tarefa é substituir as chamadas individuais de similares por um endpoint batch otimizado.


## CONTEXTO

A API de conferência está em: https://api.ferramentinhas.com.br
Repositório: https://github.com/ckipper22/api-com-historico-de-venda


O SmartPed processa SICFs (Solicitações de Insuflamento de Compra de Farmácia) que contêm múltiplos EANs. Atualmente, para cada EAN, o sistema faz uma chamada HTTP separada para buscar produtos similares. Com 100 EANs = 100 chamadas = lento e sobrecarrega o banco.


## ENDPOINT DISPONÍVEL


### POST /api/produtos/similares/batch


**Limites:**
- Máximo: 40 EANs por chamada
- Timeout recomendado: 30 segundos
- Se o SICF tem 100 EANs → dividir em 3 chamadas (40 + 40 + 20)


**Request:**
```json
POST /api/produtos/similares/batch
Content-Type: application/json

{
  "eans": ["7896714208565", "7897595605276", "7891058022136"]
}
```

**Response (sucesso parcial):**
```json
{
  "7896714208565": {
    "success": true,
    "encontrou": true,
    "cod_dcb": "C0001234",
    "cod_concentracao": 100,
    "total": 5,
    "produtos": [
      {
        "cod_reduzido": 1234,
        "nom_produto": "LOSARTANA 50MG 30CP",
        "nom_laborat": "MEDLEY",
        "qtd_estoque": 25.0,
        "vlr_custopersonalizado": 8.50,
        "est_minimo": 10.0,
        "est_critico": 5.0,
        "qtd_demanda": 10.0,
        "dat_ultent": "15-08-2026",
        "cod_dcb": "C0001234",
        "cod_concentracao": 100,
        "vlr_venda_final": 12.90,
        "vlr_venda_tabela": 15.90,
        "nom_obsvenda": "",
        "ean": "7896714208565",
        "classificacao": "Genérico",
        "grupo": "Genérico"
      }
    ]
  },
  "7897595605276": {
    "success": true,
    "encontrou": false,
    "cod_dcb": "C0005678",
    "cod_concentracao": 200,
    "total": 0,
    "produtos": []
  },
  "EAN_INEXISTENTE": {
    "success": false,
    "encontrou": false,
    "error": "EAN EAN_INEXISTENTE não encontrado."
  }
}
```

**Response (erro de validação):**
```json
{
  "success": false,
  "error": "Máximo de 40 EANs por chamada."
}
```


## LÓGICA DE INTEGRAÇÃO

1. Coletar EANs do SICF → agrupar em lotes de até 40
2. Chamar POST /api/produtos/similares/batch para cada lote
3. Processar resposta → cada chave do dict é um EAN com seus similares
4. Classificar produtos → usar campo `classificacao` e `grupo` para decisões de otimização
5. Produtos sem estoque já vêm filtrados (a API retorna apenas itens com estoque > 0 OU estoque crítico/mínimo/demanda > 0)


## CAMPOS ÚTEIS PARA OTIMIZAÇÃO

| Campo | Uso |
|-------|-----|
| `classificacao` | "Genérico", "Referência", "Similar" — priorizar genéricos mais baratos |
| `grupo` | Agrupamento do sistema SGF |
| `vlr_custopersonalizado` | Custo real para a farmácia — calcular margem |
| `vlr_venda_final` | Preço com desconto aplicado |
| `est_critico + est_minimo + qtd_demanda` | Indicadores de urgência de reposição |
| `qtd_estoque` | Estoque atual — 0 = sem item no estoque mas com parâmetros cadastrados |


## TRATAMENTO DE ERROS

- Cada EAN é tratado individualmente — um EAN inválido não falha o batch
- Se `success: false` → EAN não encontrado ou inválido
- Se `encontrou: false` com `success: true` → produto existe mas não tem DCB ou não há similares com estoque
- Retry: em caso de timeout ou erro 500, retry com exponencial backoff (1s, 2s, 4s)


## CÓDIGO EXEMPLO (Python)

```python
import requests

API_BASE = "https://api.ferramentinhas.com.br"

def buscar_similares_batch(eans: list[str]) -> dict:
    """Busca similares para múltiplos EANs em batch (max 40 por chamada)."""
    MAX_BATCH = 40
    resultado = {}
    
    for i in range(0, len(eans), MAX_BATCH):
        lote = eans[i:i + MAX_BATCH]
        resp = requests.post(
            f"{API_BASE}/api/produtos/similares/batch",
            json={"eans": lote},
            timeout=30
        )
        resp.raise_for_status()
        resultado.update(resp.json())
    
    return resultado

# Uso
eans_sicf = ["7896714208565", "7897595605276", "7891058022136"]
similares = buscar_similares_batch(eans_sicf)

for ean, dados in similares.items():
    if dados["success"] and dados["encontrou"]:
        for prod in dados["produtos"]:
            print(f"{ean}: {prod['nom_produto']} - {prod['classificacao']} - R$ {prod['vlr_venda_final']}")
```


## CÓDIGO EXEMPLO (JavaScript/Node)

```javascript
const API_BASE = "https://api.ferramentinhas.com.br";

async function buscarSimilaresBatch(eans) {
  const MAX_BATCH = 40;
  const resultado = {};
  
  for (let i = 0; i < eans.length; i += MAX_BATCH) {
    const lote = eans.slice(i, i + MAX_BATCH);
    const resp = await fetch(`${API_BASE}/api/produtos/similares/batch`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ eans: lote }),
      signal: AbortSignal.timeout(30000)
    });
    const data = await resp.json();
    Object.assign(resultado, data);
  }
  
  return resultado;
}
```
