# Exemplos de Respostas das APIs (Testado 2026-08-19)

> **NÃO DELETAR.** Estes são os retornos REAIS das APIs testados em 2026-08-19.
> Use como referência quando precisar saber a estrutura dos dados.

---

## 1. Ferramentinhas — `/api/produtos/similares/{ean}`

### LOSARTANA (7896714208565) — 11 produtos retornados
```json
{
  "cod_concentracao": 1,
  "cod_dcb": "05432",
  "cod_reduzido": 16824,
  "dat_ultent": "13-03-2026",
  "ean": "7896004708539",
  "est_critico": 80.0,
  "est_minimo": 80.0,
  "nom_laborat": "GERMED",
  "nom_obsvenda": "VENDER PRIMEIRO OS DA EUROFARMA - CARMEM SO USA ESSA",
  "nom_produto": "LOSARTANA POT 50MG 30CP REV",
  "qtd_demanda": 80.0,
  "qtd_estoque": 112.0,
  "vlr_custopersonalizado": 1.49,
  "vlr_venda_final": 5.4,
  "vlr_venda_tabela": 21.73,
  "classificacao": "Sem classificação",
  "grupo": "Genérico"
}
```

### AMOX+CLAV (7897595605276) — 1 produto
```json
{
  "cod_concentracao": 485,
  "cod_dcb": "C0000093",
  "cod_reduzido": 3733,
  "nom_laborat": "SANDOZ",
  "nom_produto": "AMOX+CLAV POT 250+62,5MG/5 75",
  "qtd_estoque": 2.0,
  "vlr_custopersonalizado": 26.44,
  "vlr_venda_final": 40.9,
  "vlr_venda_tabela": 84.15,
  "classificacao": "Genérico",
  "grupo": "Genérico"
}
```

### DONEPEZILA (7896862993962) — 1 produto
```json
{
  "cod_concentracao": 13,
  "cod_dcb": "03182",
  "cod_reduzido": 20005,
  "nom_laborat": "MEDQUIMICA",
  "nom_produto": "DONEPEZILA 10MG 30CP REV",
  "qtd_estoque": 0.0,
  "vlr_custopersonalizado": 29.67,
  "vlr_venda_final": 56.88,
  "vlr_venda_tabela": 81.78,
  "classificacao": "Sem classificação",
  "grupo": "Genérico"
}
```

### SHAMPOO SEDA (7891150037458) — 404 (não cadastrado)
```json
{ "success": false, "error": "EAN 7891150037458 não encontrado." }
```

---

## 2. SmartPed — `Condicoes/Molecula`

### LOSARTANA (7896714208565) — TipoItem="G", 1 substituto
```json
{
  "Mensagem": "OK",
  "Retorno": {
    "itens": [{
      "Molecula": "LOSARTANA POTASSICA_50MG 30 CP_G",
      "TipoItem": "G",
      "Descricao": "LOSARTANA POTASSICA 50MG 30CP GEN NEO QUIMICA",
      "Laboratorio": "Neo Química",
      "Substitutos": [{
        "Ean": "7897595627360",
        "Descricao": "LOSARTANA POTASSICA 50MG 30CP GEN SANDOZ",
        "Laboratorio": "Sandoz",
        "TipoItem": "G",
        "CodDist": 624,
        "NomeDist": "SMARTDISTRIBUIDORA",
        "Preco": 1.82,
        "Pliquido": 2.31,
        "Estoque": 1,
        "Condicao": "FIXA",
        "Prazo": 0,
        "QtdMin": 0
      }]
    }]
  }
}
```

### SHAMPOO SEDA (7891150037458) — TipoItem="P", 0 substitutos
```json
{
  "Mensagem": "OK",
  "Retorno": {
    "itens": [{
      "Molecula": "",
      "TipoItem": "P",
      "Descricao": "SHAMPOO SEDA 325ML ANTICASPA HIDRATACAO DIARIA",
      "Laboratorio": "UNILEVER",
      "Substitutos": []
    }]
  }
}
```

### DONEPEZILA (7896862993962) — TipoItem="O", 0 substitutos
```json
{
  "Mensagem": "OK",
  "Retorno": {
    "itens": [{
      "Molecula": "CLORIDRATO DE DONEPEZILA_10MG 30 CP_O",
      "TipoItem": "O",
      "Substitutos": []
    }]
  }
}
```

### PARACETAMOL 750MG (7896714294377) — TipoItem="O", suffixo "_O"
```json
{
  "Retorno": {
    "itens": [{
      "Molecula": "PARACETAMOL_750MG 20 CP_O",
      "TipoItem": "O"
    }]
  }
}
```

---

## 3. SmartPed — `Condicoes/Ean`

### LOSARTANA (7896714208565) — 6 ofertas
```json
{
  "Retorno": {
    "itens": [{
      "CodProduto": "10597",
      "CodBarra": "7896714208565",
      "Descricao": "LOSARTANA POTASSICA 50MG 30CP GEN NEO QUIMICA",
      "Condicoes": [
        { "CodDist": 624, "Condicao": "FIXA", "Preco": 7.94, "Pliquido": 2.42, "Estoque": 2, "Prazo": 0, "PMC": 0 },
        { "CodDist": 503, "Condicao": "FIXA", "Preco": 7.12, "Pliquido": 2.70, "Estoque": 1, "Prazo": 7, "PMC": 0 },
        { "CodDist": 70,  "Condicao": "FIXA", "Preco": 7.94, "Pliquido": 2.88, "Estoque": 1, "Prazo": 30, "PMC": 9.37 },
        { "CodDist": 79,  "Condicao": "FIXA", "Preco": 2.87, "Pliquido": 3.04, "Estoque": 2, "Prazo": 7, "PMC": 0 },
        { "CodDist": 53,  "Condicao": "FIXA", "Preco": 3.22, "Pliquido": 3.22, "Estoque": 1, "Prazo": 7, "PMC": 0 },
        { "CodDist": 81,  "Condicao": "FIXA", "Preco": 3.51, "Pliquido": 3.39, "Estoque": 2, "Prazo": 7, "PMC": 0 }
      ]
    }]
  }
}
```

---

## 4. Trier SGF API — `/integracao/produto/obter-v1`

### LOSARTANA GERMED (codigo=16824)
```json
{
  "codigo": 16824,
  "nome": "LOSARTANA POT 50MG 30CP REV",
  "codigoBarras": 7896004708539,
  "nomeLaboratorio": "GERMED",
  "nomeGrupo": "GENERICOS",
  "codigoGrupo": 4000,
  "nomeClassificacao": "",
  "nomeCategoria": "",
  "nomeDepartamento": "",
  "nomePrincipioAtivo": "LOSARTANA POTASSICA",
  "codigoPrincipioAtivo": "05432",
  "valorVenda": 5.4,
  "valorCusto": 1.49,
  "quantidadeEstoque": 112
}
```

**Nota:** O filtro `codigoBarra` NÃO funciona (retorna sempre os mesmos 5 produtos). Usar `codigo` (código interno) para busca exata.

---

## 5. Mapeamento de Classificação

| Fonte | Campo | Valores | Confiabilidade |
|-------|-------|---------|----------------|
| **Ferramentinhas** | `grupo` | Genérico, Similar, Referência, Perfumaria | ✅ ALTA (fonte primária) |
| **Ferramentinhas** | `classificacao` | Genérico, Similar, "Sem classificação" | ⚠️ Média (às vezes vazio) |
| **SmartPed** | `TipoItem` | G, M, S, O, P | ⚠️ Média (46% vazio) |
| **SmartPed** | `Molecula` suffixo | _G, _M, _S, _O | ⚠️ Média (vazio pra genérico comprimido) |
| **Trier SGF** | `nomeGrupo` | GENERICOS, RX, SIMILARES, PERFUMARIA | ✅ ALTA (mas filtro EAN não funciona) |
