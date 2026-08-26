# Tech Context — Stack e Integrações

## Stack
| Camada | Tecnologia |
|--------|------------|
| Frontend | React 19 + Vite 6 + Tailwind CSS v4 |
| Backend | Express.js v4 |
| Linguagem | TypeScript |
| Persistência | Turso (SQLite na nuvem) + better-sqlite3 local |
| Cache | L1 Map + L2 Turso |
| Deploy | Google Cloud Run (us-east1) |

## API SmartPed
- **Base:** `https://api.smartped.com.br` (prod) / `https://apitest.smartped.com.br` (sandbox)
- **Endpoints principais:**
  - `Condicoes/Ean` — ofertas por EAN (batch até 40)
  - `Condicoes/Molecula` — substitutos moleculares
  - `Produtos/Buscar` — busca por descrição
  - `Condicoes/Distribuidores` — lista de distribuidoras
  - `Pedido/Envio` — faturamento
- **Autenticação:** Token no body (`Token`)
- **Nota:** Usa tabela temporária — requests paralelos sobrescrevem dados

## API Ferramentinhas/Trier
- **Base:** `https://api.ferramentinhas.com.br`
- **Endpoints:**
  - `/api/produtos/buscar-lote` — body `{itens: [...]}`, response dict
  - `/api/produtos/similares/{ean}` — produtos equivalentes (DCB)
  - `/api/chatbot/produto/vendas-resumo/{ean}` — vendas agregadas
  - `/api/chatbot/produto/vendas-detalhadas/{ean}` — vendas individuais
  - `/api/chatbot/produto/compras-historico/{ean}` — histórico de compras
- **Nota:** buscar-lote usa `ILIKE %termo%` — buscar princípio ativo, não descrição completa

## Firebase Auth
- Google Auth para login
- `getFirebaseAuth()` async (não importar `auth` direto)
- Domínios autorizados: localhost + domínio de produção

## Encomendas (sistema externo)
- **URL:** `https://encomenda-com-smartped-887122622666.us-east1.run.app`
- **Auth:** `x-api-key` via `ENCOMENDAS_INTEGRATION_KEY`
- **Fluxo:** pendentes → busca ofertas → importa → faturamento → confirmação automática
