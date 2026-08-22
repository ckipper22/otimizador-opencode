# Plano: Fornecedores Externos (Listas + WhatsApp)

> Status: PLANEJAMENTO
> Data: 2026-08-21
> Refs: AGENTS.md, LLM_CONTEXT.md, docs/architecture.md, docs/business-rules.md
> Ref Tecnica Reval: docs/reval-api-reference.md
> Promocoes do Dia (PRIORIDADE): docs/promocoes-do-dia-plan.md

---

## 1. Visao Geral

Integrar fornecedores externos (distribuidoras fora da SmartPed, ex: Reval) ao sistema de otimizacao.

Funcionalidades:
1. Importar listas de preco de qualquer formato (CSV, TXT, Excel)
2. Colar listas WhatsApp (promocoes avulsas)
3. Competir no motor de trocas quando ha preco valido
4. Mostrar disponibilidade quando nao ha preco (fornecedor trabalha com o item)

---

## 2. Arquitetura

### 2.1 Tabela Existente: external_suppliers

Ja implementada em server/database.ts:233-244. Schema:

- id TEXT PRIMARY KEY
- name TEXT ("Reval", "Drogaria Z")
- raw_text TEXT (texto original importado)
- validade TEXT (null = sem expiracao)
- products TEXT (JSON serializado ExternalProduct[])
- cnpj TEXT
- created_at, updated_at TEXT

Index em cnpj e validade. Purge apos 6 meses.

### 2.2 Tipo Existente: ExternalProduct (src/types.ts:168)

Campos atuais:
- description: string
- price: number | null (null = fornecedor trabalha, sem preco)
- discountPercent?: number

### 2.3 Tipo Existente: ExternalSupplier (src/types.ts:174)

Campos atuais:
- id, name, rawText, validade, products (ExternalProduct[])

---

## 3. Schema Proposto (Novos Campos)

### 3.1 ExternalProduct EXPANDIDO

Adicionar campos ao ExternalProduct:

- **ean**: string | null — Codigo de barras (match com SmartPed)
- **codigoFornecedor**: string | null — Codigo interno do fornecedor (ex: "088590" da Reval)
- **marca**: string | null — Fabricante/marca (ex: "3M", "NEWEX")
- **grupo**: string | null — Categoria (ex: "ABAF")
- **precoRef**: number | null — Preco de referencia (preco C/MVA, pode mudar)
- **validade**: string | null — Validade POR ITEM (YYYY-MM-DD ou null)

Campos existentes mantidos:
- description (obrigatorio)
- price (null = sem preco, numero = preco valido)
- discountPercent (opcional)

### 3.2 ExternalSupplier EXPANDIDO

Adicionar campos ao ExternalSupplier:

- **pedidoMinimo**: number — Pedido minimo do fornecedor (default 0)

### 3.3 Migration Turso

NENHUMA migration destrutiva. Campos novos sao OPCIONAIS (nullable). Registros antigos continuam funcionando.

---

## 4. Endpoints Novos

### 4.1 POST /api/external-suppliers (JA EXISTE - server.ts:395)

Endpoint atual salva fornecedor. Adaptar para:
- Aceitar pedidoMinimo no payload
- Aceitar products com novos campos (ean, codigoFornecedor, etc.)
- Merge: se fornecedor ja existe (mesmo id), atualizar preços/validades dos itens

### 4.2 POST /api/external-suppliers/import-csv (NOVO)

Parser universal de arquivo:
- Entrada: arquivo (Buffer) + nome fornecedor + pedidoMinimo
- Auto-detecta: delimitador (, ; \t), encoding (UTF-8, Latin-1), header
- Auto-mapeia colunas por palavras-chave
- Retorna: { mappedColumns, preview (5 linhas), totalRows }
- Endpoint auxiliar para validar antes de confirmar

### 4.3 POST /api/external-suppliers/import-csv/confirm (NOVO)

Apos usuario validar mapeamento:
- Processa arquivo completo
- Salva/atualiza no Turso
- Retorna: { imported: number, updated: number, errors: string[] }

### 4.4 POST /api/external-suppliers/paste-whatsapp (NOVO)

Parser de texto WhatsApp:
- Entrada: { supplierId, text }
- Parseia: "PRODUTO PRECO ate VALIDADE"
- Match por similaridade de descricao com itens existentes
- Atualiza preco + validade dos itens matchados
- Retorna: { matched: number, unmatched: string[] }

---

## 5. Parser Universal (server/parsers.ts ou server/external-supplier-parser.ts)

### 5.1 Auto-Detecao de Formato

```
Arquivo recebido
  ├─ Termina com .xlsx/.xls? → parser Excel (lib xlsx)
  ├─ Termina com .csv/.txt? → parser CSV/TXT
  └─ Nao sabe? → tenta CSV primeiro, depois Excel
```

### 5.2 Auto-Detecao de Delimitador

Le primeiras 10 linhas e conta:
- Mais virgulas → delimitador ","
- Mais pontoevirgulas → delimitador ";"
- Mais tabs → delimitador "\t"

### 5.3 Auto-Detecao de Colunas (Keyword Matching)

Para cada coluna do header, busca palavras-chave:

| Coluna do sistema | Palavras-chave |
|-------------------|---------------|
| ean | ean, cod barras, barcode, gtin, dcb, codigo barra |
| description | descricao, produto, nome, item, desc |
| precoRef | preco, custo, valor, venda, mva, s/mva, c/mva |
| codigoFornecedor | codigo, cod, ref, referencia |
| marca | fornecedor, marca, fabricante, lab, laboratorio |
| grupo | grupo, categoria, classe |

### 5.4 Parser WhatsApp

Entrada: texto livre colado pelo usuario.

Pattern detection:
- Linhas com "R$" ou "," seguido de 2 digitos → linha com preco
- "ate DD/MM" ou "valido ate DD/MM" ou "vencimento" → validade
- Resto = nome do produto

Exemplo:
```
DIPRONA 500mg 30cp R$ 8,50 valido ate 30/08
AMOXICILINA 500mg 21cp R$ 12,00
```
Resultado:
- { description: "DIPRONA 500mg 30cp", price: 8.50, validade: "2026-08-30" }
- { description: "AMOXICILINA 500mg 21cp", price: 12.00, validade: null }

---

## 6. Frontend

### 6.1 ConfigurationPanel.tsx — Card de Fornecedores Existentes

Cada fornecedor mostra:
- Nome + badge (ATIVA / EXPIRADA / SEM PRECO)
- Pedido minimo (editavel)
- Quantidade de itens
- Botao: "Atualizar lista" (importar arquivo)
- Botao: "Colar WhatsApp" (colar texto)
- Botao: Editar / Excluir

### 6.2 Modal "Novo Fornecedor" (novo componente ou integrado)

Tela 1 — Dados basicos:
- Nome do fornecedor (input)
- Pedido minimo (input R$)
- Validade global (opcional, date picker)

Tela 2 — Como importar:
- Opcao A: "Importar arquivo" (CSV/TXT/Excel)
- Opcao B: "Colar lista WhatsApp" (textarea)

### 6.3 Tela de Mapeamento de Colunas (a_modal_mapeamento)

Apos selecionar arquivo:
- Mostra preview (5 primeiras linhas)
- Mostra colunas detectadas + mapeamento auto
- Usuario pode ajustar mapeamento (dropdown por coluna)
- Botoes: Confirmar / Cancelar

### 6.4 Botao "+" (App.tsx) — Mudancas

Adicionar secao "Fornecedores externos" no resultado da busca:

```
[Resultado SmartPed - ordenado por preco]
  CervoSul     R$ 8,77
  ANB          R$ 8,90
  Pan/Santa    R$ 9,10
─────────────────────────────
Reval — solicitar preco          (sem preco)
```

Quando fornecedor tem preco valido + nao expirado:
- Entra no bloco principal
- Badge "LISTA" ao inves de "FIXA"
- Ordenado por preco normalmente

### 6.5 Pre-Pedido (SwapsTable) — Agrupamento

Itens de fornecedores externos aparecem agrupados:

```
SmartPed (CervoSul, ANB, Pan...)
  DIPRONA 500mg    R$ 8,77
  Subtotal: R$ 1.240,00  (acima do minimo)

Reval
  DIPRONA 500mg    R$ 8,50
  Subtotal: R$ 280,00  (minimo R$ 500 — faltam R$ 220)
```

---

## 7. Regras de Negocio

### 7.1 Prioridade

```
1. REGRA DE LABORATORIO (prioridade maxima — WhatsApp)
   → Vai direto pro WhatsApp, sem preco, sem comparacao

2. LISTA EXTERNA (compete com SmartPed)
   → Tem preco + validade ativa → entra no motor de trocas
   → Sem preco → so mostra "fornecedor trabalha com item"

3. SMARTPED (baseline — sempre competidor)
```

### 7.2 Motor de Trocas

- Fornecedor externo com preco valido e nao expirado → entra como candidato
- Comporta igual a qualquer otra oferta (menor preco vence)
- Badge "LISTA" para identificar visualmente
- Se validade expirou → sai do motor, volta a ser "solicitar preco"

### 7.3 Pedido Minimo

- Informativo, NAO bloqueante
- Exibe no botao "+" e no pre-pedido
- Usuario decide se adiciona mais itens ou remove

### 7.4 Merge de Listas

Quando importa nova lista para fornecedor ja existente:
- Itens novos → adicionados
- Itens existentes → preco e validade atualizados
- Itens ausentes na nova lista → MANTIDOS (nao deletados)

### 7.5 Atualizacao WhatsApp

Quando colar texto WhatsApp:
- Match por similaridade de descricao (4+ caracteres, fuzzy)
- Atualiza preco + validade dos itens matchados
- Itens sem match → aviso "itens nao encontrados na lista"

---

## 8. Arquivos Impactados

### Backend (modificar)

| Arquivo | Mudanca |
|---------|---------|
| server/database.ts | Adicionar campo pedidoMinimo (nullable, sem migration) |
| server.ts | Adaptar POST /api/external-suppliers, novos endpoints import |
| src/types.ts | Expandir ExternalProduct e ExternalSupplier |

### Backend (criar)

| Arquivo | Funcao |
|---------|--------|
| server/external-supplier-parser.ts | Parser universal (CSV/TXT/Excel + WhatsApp) |

### Frontend (modificar)

| Arquivo | Mudanca |
|---------|---------|
| src/components/ConfigurationPanel.tsx | Cards de fornecedores + botoes importar |
| src/App.tsx | Secao "Fornecedores externos" no modal "+" |
| src/hooks/useOptimizerConfig.ts | Carregar fornecedores com novos campos |

### Frontend (criar)

| Arquivo | Funcao |
|---------|--------|
| src/components/ExternalSupplierImportModal.tsx | Modal de importacao + mapeamento de colunas |

### Documentacao (atualizar)

| Arquivo | Secao |
|---------|-------|
| AGENTS.md | Nova regra sobre fornecedores externos |
| LLM_CONTEXT.md | Secao 4.x — nova feature |

---

## 9. Dependencias Externas

| Lib | Uso | Tamanho | Obrigatoria? |
|-----|-----|---------|-------------|
| xlsx (SheetJS) | Ler Excel (.xlsx/.xls) | ~45 KB | Sim (se quiser suporte Excel) |
| CSV parsing | Ler CSV/TXT | 0 (JS puro) | N/A |

---

## 10. Ordem de Implementacao

### Fase 1 — Backend (DIA 1)

1. Expandir tipos (ExternalProduct, ExternalSupplier) em src/types.ts
2. Criar parser universal (server/external-supplier-parser.ts)
   - Auto-detect delimitador
   - Auto-detect colunas
   - Parser WhatsApp
3. Adaptar endpoint POST /api/external-suppliers (aceitar novos campos)
4. Criar endpoint POST /api/external-suppliers/import-csv
5. Criar endpoint POST /api/external-suppliers/import-csv/confirm
6. Criar endpoint POST /api/external-suppliers/paste-whatsapp

### Fase 2 — Frontend (DIA 1-2)

7. Criar ExternalSupplierImportModal.tsx (modal de importacao)
8. Atualizar ConfigurationPanel.tsx (cards de fornecedores)
9. Atualizar useOptimizerConfig.ts (carregar com novos campos)

### Fase 3 — Integracao Motor de Trocas (DIA 2)

10. Adaptar findBestSubstitute (server/swap-engine.ts) para aceitar ofertas de fornecedores externos
11. Adaptar itemAlternatives (server.ts) para incluir fornecedores externos
12. Adaptar modal "+" (App.tsx) para mostrar secao "Fornecedores externos"
13. Adaptar SwapsTable.tsx para agrupar itens por fornecedor

### Fase 4 — Documentacao (DIA 2)

14. Atualizar AGENTS.md com regras de fornecedores externos
15. Atualizar LLM_CONTEXT.md com nova feature
16. Atualizar docs/business-rules.md

---

## 11. Riscos e Mitigacoes

| Risco | Impacto | Mitigacao |
|-------|---------|-----------|
| Arquivo Excel precisa de lib externa | Build maior ~45KB | xlsx e leve e bem mantida |
| Parser WhatsApp impreciso | Itens nao matchados | Preview antes de confirmar + merge manual |
| 20k itens num JSON field | Leitura lenta? | 3MB e aceitavel para SQLite/Turso |
| Atualizacao sobrescreve precos | Perda de dados | Merge inteligente (so atualiza price+validade) |
| Validade por item vs por fornecedor | Complexidade | Validade por item (mais preciso) |

---

## 12. Testes Manuais

1. Importar CSV da Reval (20k itens) — verificar parsing e insercao no Turso
2. Colar texto WhatsApp — verificar match de descricao e atualizacao de preco
3. Buscar no modal "+" item da Reval com preco — verificar badge "LISTA"
4. Buscar no modal "+" item da Reval sem preco — verificar "solicitar preco"
5. Expirar validade de um item — verificar que sai do motor de trocas
6. Verificar pedido minimo — verificar aviso no pre-pedido
7. Verificar merge — importar nova lista e verificar que precos atualizam

---

## 13. Perguntas Pendentes

1. **Excel:** Quer suporte a .xlsx desde o inicio ou so CSV/TXT?
2. **Validade:** Por item (cada promocao tem validade propria) ou por fornecedor?
3. **Merge:** Quando importar nova lista, deletar itens ausentes ou manter?
4. **WhatsApp:** Parser automatico ou usuario confirma cada match?
