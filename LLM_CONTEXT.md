# Contexto do Projeto: Otimizador de Pedidos SmartPed (LLM Context)

Este documento é o **índice de contexto** do projeto. Leia-o no início de qualquer sessão para entender o propósito, a stack e onde encontrar detalhes por domínio.

## 1. Visão Geral e Objetivo do Sistema

**O que o software faz:**
Otimiza financeiramente compras de medicamentos para farmácias, conectando-se à API SmartPed para buscar concorrentes e sugere trocas inteligentes por menor preço.

**Como funciona:**
Upload de arquivo SICF → parsing de EANs → consulta SmartPed (moléculas/genéricos) → sugestão de trocas com economia → faturamento direto na API.

**Perfil de Uso:** B2B interno (compradores de drogarias).

---

## 2. Stack Tecnológica

| Camada | Tecnologia |
|--------|------------|
| Frontend | React 19 + Vite 6 + Tailwind CSS v4 |
| Backend | Express.js v4 (BFF/proxy para SmartPed) |
| Linguagem | TypeScript universal |
| Persistência | SQLite (better-sqlite3, opcional via DISABLE_SQLITE) |
| Cache | L1 (Map memória, 2000 entradas) + L2 (SQLite) |
| APIs | SmartPed (Sandbox/Produção) + Ferramentinhas (ERP) |
| Deploy | Cloud Run (Google Cloud) |

---

## 3. Mapa de Documentação por Domínio

| Arquivo | Conteúdo | Quando ler |
|---------|----------|------------|
| `LLM_CONTEXT.md` (este) | Visão geral + stack + índice | **SEMPRE no início da sessão** |
| `AGENTS.md` | Regras permanentes de operação | **SEMPRE no início da sessão** |
| `docs/architecture.md` | Mapeamento de arquivos, módulos backend, hooks frontend | Ao criar/modificar módulos |
| `docs/business-rules.md` | Regras de negócio, fluxo de dados, algoritmo de otimização | Ao alterar lógica de negócio |
| `docs/sensitive-points.md` | Zonas de perigo, débitos técnicos, ambiente de execução | Antes de tocar em código crítico |
| `docs/testing.md` | Massa de testes, endpoints, scripts de diagnóstico | Ao validar alterações ou debugar |
| `API_TREE_SMARTPED.md` | Árvore de endpoints da SmartPed | Ao integrar novos endpoints |
| `API_TREE_TRIER.md` | Árvore de endpoints do ERP Trier | Ao integrar novos endpoints Trier |

---

## 4. Regras Rápidas (Resumo)

1. Consultar `AGENTS.md` antes de qualquer ação.
2. Nunca logar CNPJ/token em texto claro.
3. Cache L1+L2 — nunca assumir "em memória".
4. Ambos endpoints SmartPed (`Condicoes/Ean` + `Condicoes/Molecula`) em paralelo.
5. SQLite opcional em Cloud Run (`DISABLE_SQLITE=true`).
6. Deduplicação por `${Ean}_${CodDist}_${Condicao}_${Prazo}` (sem preço).

---

## 5. Variáveis de Ambiente

| Variável | Descrição |
|----------|-----------|
| `SMARTPED_PRODUCTION_TOKEN` | Token API SmartPed produção |
| `SMARTPED_SANDBOX_TOKEN` | Token API SmartPed sandbox |
| `SMARTPED_DEFAULT_CNPJ` | CNPJ default para chamadas API |
| `SMARTPED_PRODUCTION_URL` | URL base produção (padrão: `https://api.smartped.com.br`) |
| `SMARTPED_SANDBOX_URL` | URL base sandbox (padrão: `https://apitest.smartped.com.br`) |
| `FERRAMENTINHAS_API_URL` | URL API Ferramentinhas |
| `DISABLE_SQLITE` | `true` para desativar SQLite (Cloud Run) |
| `APP_ADMIN_EMAILS` | E-mails admin (separados por vírgula) |
| `APP_ADMIN_PASSWORD` | Senha admin |

---

## 6. Comandos de Execução

```bash
npm run dev      # Dev server (Vite + Express, porta 3000)
npm run build    # Build frontend + backend (esbuild → dist/server.cjs)
npm run start    # Produção (build prévio necessário)
npm run lint     # Type checking (tsc --noEmit)
```

---

## 7. LGPD - Dados Sensíveis

- **CNPJ** circula em: `/api/optimize`, `/api/faturar`, `/api/pedidos-do-dia`, cache L1+L2, SQLite `orders.cnpj`
- **Token SmartPed** circula em: headers de API, cache, `config.ts` via `.env`
- **Mascaramento obrigatório** em logs: `maskCnpj(cnpj)` → `13.408.443/0001-***`
- **Retenção:** Cache tem purga automática; `orders`/`faturados` sem purga (débito técnico)
