# Referencia Completa - API Reval (Integracao)

> Status: DOCUMENTACAO - Pronto para implementacao
> Data: 2026-08-22
> Ref: docs/external-suppliers-plan.md, LLM_CONTEXT.md

---

## 1. O que e a Reval

- Razao Social: Reval Atacado de Papelaria Ltda
- CNPJ: 52.434.156/0001-84
- Endereco: Rua Santo Antonio 1.699, Distrito Industrial, Itapui - SP
- Telefone: 14 3664-9811
- WhatsApp: 0800 701 1811
- Site: https://www.reval.net
- O que vende: Papelaria, escritorio, copa, limpeza, brinquedos. NAO vende medicamentos.

---

## 2. Login

### URL
GET https://www.reval.net/login

### Formulario (ASP.NET WebForms)

| Campo HTML | Nome | Tipo |
|------------|------|------|
| CNPJ | ctl00/MainContent/wucLoginCliente/txtUsuario | text |
| Senha | ctl00/MainContent/wucLoginCliente/txtSenha | password |
| Submit | ctl00/MainContent/wucLoginCliente/btnEntrar | submit |

### Hidden Fields (obrigatorios para POST)

| Campo | Valor |
|-------|-------|
| __VIEWSTATE | Extrair do HTML da pagina de login |
| __VIEWSTATEGENERATOR | C2EE9ABB (fixo) |
| ctl00/hddToken | Extrair do HTML |
| ctl00/hddSessionID | Extrair do HTML |
| Demais hidden | Vazios |

### Fluxo

1. GET /login -> Extrair __VIEWSTATE, hddToken, hddSessionID
2. POST /login -> Enviar formulario com CNPJ + Senha + hidden fields
3. Response -> Cookie authCookieReval + ASP.NET_SessionId

### Credenciais de Teste
- CNPJ: 13408443000168
- Senha: revalAq1sw2d
- Nao tem CAPTCHA

---

## 3. Endpoints Descobertos

### 3.1 API de Busca (NAO RECOMENDADO)

POST https://www.reval.net/Services/ProdutoService.asmx/Pesquisa
Content-Type: application/json

Body: {"valor":"copo treinamento","a1Cod":"135379","stEst":"RS","isRca":"N"}

PROBLEMAS: Preco pode estar errado. NAO busca por EAN. Nao retorna embalagem.
NAO USAR ESTE ENDPOINT para precos.

### 3.2 Pagina de Busca (RECOMENDADO)

GET https://www.reval.net/pesquisa/result?q={TERMO}

Funciona com EAN, codigo e descricao. Preco CORRETO. Retorna embalagem e marca.
USAR ESTE ENDPOINT.

### 3.3 Pagina do Produto (DETALHES EXTRAS)

GET https://www.reval.net/produto/{slug}

Retorna TUDO: EAN Unitario, EAN Master, embalagem, preco, estoque, NCM, peso.
So usar se precisar de EAN ou detalhes extras.

---

## 4. Comportamento de Busca

### Funciona
- Substring parcial: cop -> 5 resultados
- Ordem invertida: descartavel copo -> funciona
- Codigo do produto: 056587 -> 1 resultado
- EAN via pagina de busca: funciona

### NAO funciona
- Wildcards: copo* -> 0 resultados
- Typos: copo descartavell -> 0 resultados
- Marca sozinha: kerocopo -> 0 resultados
- EAN via API: ProdutoService.asmx -> 0 resultados

---

## 5. Arquivo CSV da Reval (IMPORTACAO)

### Estrutura do CSV (separador ;)

CODIGO;DESCRICAO;FORNECEDOR;EMBALAGEM;COD. BARRA;GRUPO;REFERENCIA;GRUPO TRIB.;MARGEM;EST;PRECO S/MVA;MVA;PRECO C/MVA;CLASSIF. FISCAL

| Coluna | Conteudo | Utilidade |
|--------|----------|-----------|
| CODIGO | Codigo interno Reval | Identificador |
| DESCRICAO | Nome do produto | Match com SICF |
| FORNECEDOR | Marca/fabricante | Metadata |
| EMBALAGEM | Tipo (UNIDADE, PCT.C/100, CX.C/12) | Calcular preco unitario |
| COD. BARRA | EAN (13 digitos) | Match EXATO com SICF |
| GRUPO | Categoria | Metadata |
| REFERENCIA | Codigo do fabricante | Metadata |
| PRECO C/MVA | Preco de referencia | Baseline (API confirma) |

### Vantagens da importacao CSV

- Ja tem EAN (nao precisa buscar 20k paginas)
- Ja tem embalagem (sabe se e UN, PCT, CX)
- Ja tem fornecedor/marca (metadata completa)
- Fracionados incluidos (PCT.C/80, PCT.C/100, CX.C/12)
- Multiplas variantes (mesmo nome, EANs diferentes = produtos distintos)

### IMPORTANTE: Mesmo nome, produtos diferentes

73279  | ABRACAD WESTERN | PCT.C/80  | EAN 7897186004044 | R$ 5,82
102718 | ABRACAD WESTERN | PCT.C/100 | EAN 7899806992137 | R$ 3,17
102721 | ABRACAD WESTERN | PCT.C/100 | EAN 7899806992151 | R$ 6,40
73429  | ABRACAD WESTERN | PCT.C/100 | EAN 7897186005539 | R$ 10,21

Cada EAN = um produto UNICO. NUNCA assumir que mesma descricao = mesmo produto.

---

## 6. Abordagem de Integracao

### DOIS FLUXOS DISTINTOS

#### Fluxo 1: Otimizacao (SICF) - Match por EAN

O SICF sempre tem EAN. Busca EXATA no catalogo local:

SICF: EAN 7897186004044 + "ABRACAD WESTERN"
  -> Busca catalogo local por EAN
  -> Encontra: Reval cod 73279, PCT.C/80
  -> Busca preco real via API /pesquisa/result?q=7897186004044
  -> Compara com SmartPed

Match: EAN exato (1 resultado)

#### Fluxo 2: Busca Manual (Botao "+") - Match por Descricao

Usuario digita texto. Busca por descricao no catalogo (regex/parcial). Mostra TODAS as variantes:

Usuario digita "abracad western"
  -> Busca por descricao no catalogo local
  -> Mostra 4 variantes:
     73279  -> ABRACAD WESTERN -> PCT.C/80 -> R$ 5,82
     102718 -> ABRACAD WESTERN -> PCT.C/100 -> R$ 3,17
     102721 -> ABRACAD WESTERN -> PCT.C/100 -> R$ 6,40
     73429  -> ABRACAD WESTERN -> PCT.C/100 -> R$ 10,21

Match: descricao parcial (N resultados)

### Diferenca SmartPed vs Reval no "+"

| SmartPed | Reval |
|----------|-------|
| Mostra: Generico, Similar, Referencia | Mostra: todos (sem categoria) |
| Filtra por tipo (G, S, R) | Nao filtra - mostra tudo |
| Substitutos moleculares | So o mesmo produto |

### Resumo dos Fluxos

| Fluxo | Busca por | Resultado |
|-------|-----------|-----------|
| Otimizacao (SICF) | EAN exato | 1 produto |
| Busca manual ("+") | Descricao parcial/regex | N produtos |

### Toggle de Ativacao

O usuario pode ativar/desativar Reval no botao "+":
- Padrao: SmartPed apenas (rapido, ~300ms)
- Toggle ON: SmartPed + Reval (~500ms)
- Controle do usuario (nao busca Reval sem pedir)

---

## 7. Embalagem e Preco Unitario

### Tipos de embalagem

| Embalagem | Qtd | Preco unitario |
|-----------|-----|---------------|
| UNIDADE | 1 | preco / 1 |
| PCT.C/80 | 80 | preco / 80 |
| PCT.C/100 | 100 | preco / 100 |
| CX.C/12 | 12 | preco / 12 |
| CX.C/250 | 250 | preco / 250 |

### Funcao de extracao

function extractPackQty(embalagem) {
  const match = embalagem.match(/(\d+)/);
  return match ? parseInt(match[1]) : 1;
}

### Dois EANs por produto (na pagina do produto)

A Reval tem:
- EAN Unitario (unidade avulsa)
- EAN Master (pacote fechado)

O SmartPed usa o EAN Unitario para match.

---

## 8. Pontos de Atencao

- Cookie de sessao pode expirar -> refazer login automaticamente
- Nao busca por marca sozinha (kerocopo -> 0)
- Nao busca por material sozinha (poliestireno copo -> 0)
- Reval NAO tem categorias (similar, generico, etico) - so produtos
- Preco do CSV e referencia (pode mudar) - sempre confirmar via API

---

## 9. Testes Realizados

### Login
- Login automatizado (POST): Funciona
- Cookie obtido: authCookieReval
- CAPTCHA: Nao tem

### Busca por EAN
- API (ProdutoService.asmx/Pesquisa): 0 resultados
- Pagina de busca (/pesquisa/result?q=): Encontra

### Precos comparados

| Produto | Codigo | Preco API | Preco Pagina | Preco Site |
|---------|--------|-----------|-------------|------------|
| Copo Treinamento 310ml | 056587 | R$ 74,90 (ERRADO) | R$ 7,75 | R$ 7,75 |
| Luva Viniflex M | 027321 | R$ 9,50 | R$ 9,50 | R$ 9,50 |
| Porta Detergente Flat | 129690 | R$ 15,70 | R$ 12,90 | - |
| Bolha de Sabao Slimy | 097073 | R$ 17,90 | - | R$ 22,60 |
| Balao 7 Liso Azul | 000302 | R$ 9,19 | R$ 9,19 | - |

Conclusao: Preco da Pagina de Busca e CONFIABEL. Preco da API NAO e.

---

## 10. Proximos Passos

1. Importar CSV da Reval no Turso (external_suppliers)
2. Criar client HTTP para Reval (server/reval-client.ts)
3. Implementar login automatico com cookie
4. Implementar busca via /pesquisa/result?q=
5. Implementar parser HTML para extrair dados
6. Integrar com motor de trocas (server.ts)
7. Adicionar toggle no ConfigurationPanel
8. Adicionar secao no modal "+"
9. Testes manuais completos

---

## 11. Scripts de Teste

Scripts PowerShell usados nesta sessao:
- test-reval-login.ps1 - Login + busca basica
- test-reval-search2.ps1 - Multiplas buscas
- test-reval-product.ps1 - Acesso a pagina do produto
- test-reval-ean.ps1 - Teste de busca por EAN
- test-reval-regex.ps1 - Teste de wildcards e patterns
- test-reval-page.ps1 - Teste da pagina de busca

Todos salvos em: C:\Users\carlo\AppData\Local\Temp\opencode\
