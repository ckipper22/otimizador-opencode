# Project Brief

**Otimizador de Pedidos SmartPed** — ferramenta B2B que automatiza e otimiza financeiramente a compra de medicamentos para farmácias.

## O que faz
1. Upload de arquivo SICF (lista de medicamentos desejados)
2. Consulta API SmartPed em tempo real (preços, estoque, condições comerciais)
3. Motor de trocas sugere substitutos por menor preço com estoque
4. Faturamento direto na API SmartPed
5. Histórico de pedidos e retornos via Turso

## Quem usa
- Compradores de drogarias/farmácias (B2B interno)
- Dois admins principais + empresas autorizadas via Google Auth

## Integrações
| API | Uso |
|-----|-----|
| **SmartPed** | Cotação de preços, estoque, faturamento |
| **Ferramentinhas/Trier** | ERP local (similares, vendas, compras históricas) |
| **Encomendas** | Sistema externo de encomendas do balcão |
| **Firebase Auth** | Autenticação Google |
| **Turso** | Persistência (SQLite na nuvem) |

## Deploy
- Google Cloud Run (`smartped-cli`, us-east1)
- URL: https://smartped-cli-887122622666.us-east1.run.app
