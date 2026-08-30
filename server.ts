import express from "express";
import path from "path";
import fs from "fs";
import { createServer as createViteServer } from "vite";
import { runEngineSelfTests } from "./backend-tests";
import { validateSwapEquivalence } from "./swap-validation";

import { CONFIG, PORT } from "./server/config";
import { cacheKey, getFromCache, getFromCacheBatch, setInCache, MINIMOS_GLOBAL_CACHE, updateMinimosCache, getMinimoFromCache, DYNAMIC_EANS_CACHE, FATURAMENTO_ITEMS_CACHE, SIMULATED_CHECKS, startCachePurgeInterval } from "./server/cache";
import { rateLimitMiddleware, startRateLimitPurge } from "./server/rate-limiter";
import { cleanEan, normalizeDistName, cleanCodProduto, EAN_DATABASE, getEanDatabaseRecord, loadEanDatabase } from "./server/ean-utils";
import { fetchEanDescriptions, fetchSimilarGenerics, fetchSimilarGenericsBatch } from "./server/smartped-api";
import { stripHtmlTags, extractQuantityCount, checkColetivoKeywords, calculateQuantityAlert, parseFormattedNumber, extractPmc, extractTablePrice, getUnitCost, isRealOffer, extractSmartPedQtdMin, parseSmartPedEstoque, cleanDescription, getMoleculeBase, cleanDescriptionKeepDosage, getWildcardQueries, getCleanSearchWords, resolveCategoria, CategoriaProduto, hasWordBoundary, classificarProduto, mesmaApresentacao, ClassificacaoProduto } from "./server/parsers";
import { DISTRIBUIDORAS_MAP } from "./server/distributors";
import { getDb, USE_TURSO, savePedidoWhatsApp, getPedidosWhatsApp, updatePedidoWhatsAppStatus, deletePedidoWhatsApp, saveWhatsAppRule, getWhatsAppRules, deleteWhatsAppRule, saveExternalSupplier, getExternalSuppliers, deleteExternalSupplier, updateSupplierAnalysis } from "./server/database";

const DISTRIBUIDORAS_DYNAMIC_CACHE: Record<number, string> = {
  2: "Pan/Santa",
  3: "Servimed",
  4: "Profarma",
  6: "SantaCruz",
  8: "PharmaLink",
  9: "DrogaCenter",
  16: "SIC",
  18: "GoiasSaude",
  21: "DISTRIMED",
  26: "Millenium",
  32: "DISMED",
  34: "Medicamental",
  37: "Navarro",
  53: "Gauchofarma",
  56: "SIGREDE",
  59: "ANB",
  60: "GAM",
  67: "Dimed",
  68: "Dp4",
  78: "Medchap",
  79: "NeoSul",
  80: "Farmix",
  81: "CervoSul",
  84: "GOLFARMA",
  85: "FORTES",
  87: "NeoBras",
  503: "GCMEDICAMENTOS",
  505: "DIMEBRAS",
  518: "PONTUAL",
  529: "DMPARANA",
  533: "REDERM",
  542: "MULTIDROGAS",
  551: "PALMED",
  552: "GOIASATACADO",
  555: "FARMACIASBRAVA",
  557: "WM",
  566: "ABS",
  572: "LM",
  576: "ATACADOSC",
  577: "AFIMINAS",
  578: "BIOLABGEN",
  579: "REDEFARMAGENTE",
  580: "DFDISTRIBUIDORA",
  581: "PRATIDONADUZZI",
  583: "RedeFBF",
  594: "FQM",
  604: "GLORIA",
  612: "Icone",
  616: "SmartDistribuidora",
  618: "FARLOG",
  624: "SMARTDISTRIBUIDORA"
};

function isNotFoundName(name: any): boolean {
  if (!name) return false;
  const n = String(name).trim().toLowerCase();
  return !n || n.includes("não encontrado") || n.includes("nao encontrado") || n.includes("nÃ£") || n.includes("sem estoque") || n.startsWith("distribuidor");
}

function resolveDistName(obj: any, codDist?: number): string {
  const code = codDist !== undefined ? Number(codDist) : Number(obj?.CodDist || obj?.codDist || 0);
  const ok = (v: any) => v && !isNotFoundName(v);

  return (
    (ok(obj?.NomeDist) ? obj.NomeDist : undefined) ||
    (ok(obj?.nomeDist) ? obj.nomeDist : undefined) ||
    (ok(obj?.NomeDistribuidora) ? obj.NomeDistribuidora : undefined) ||
    (ok(obj?.Nome_Dpe) ? obj.Nome_Dpe : undefined) ||
    (ok(obj?.Nome) ? obj.Nome : undefined) ||
    (code && DISTRIBUIDORAS_DYNAMIC_CACHE[code] ? DISTRIBUIDORAS_DYNAMIC_CACHE[code] : undefined) ||
    (code && DISTRIBUIDORAS_MAP[code] ? DISTRIBUIDORAS_MAP[code] : undefined) ||
    (code ? `Distribuidor ${code}` : "Distribuidor")
  );
}

async function loadDistribuidoresFromAPI() {
  try {
    const baseUrl = CONFIG.SMARTPED_SANDBOX_URL;
    const actualToken = CONFIG.SMARTPED_SANDBOX_TOKEN;
    const apiCnpj = "11111111111111";
    
    const response = await fetch(`${baseUrl.replace(/\/$/, "")}/api/Condicoes/Distribuidores`, {
      method: "POST",
      headers: { "Content-Type": "application/json", "Accept": "application/json" },
      body: JSON.stringify({ Token: actualToken, parametros: { CnpjCLi: apiCnpj } })
    });
    
    if (response.ok) {
      const data = await response.json();
      const dists = data?.Retorno || data?.retorno || [];
      if (Array.isArray(dists)) {
        dists.forEach((dist: any) => {
          const codigo = Number(dist.Codigo || dist.codigo);
          const nome = String(dist.Nome || dist.nome || "").trim();
          if (codigo && nome) {
            DISTRIBUIDORAS_DYNAMIC_CACHE[codigo] = nome;
          }
        });
        console.log(`[CACHE] ${Object.keys(DISTRIBUIDORAS_DYNAMIC_CACHE).length} distribuidores carregados dinamicamente.`);
      }
    }
  } catch (err: any) {
    console.error("[CACHE ERR] Falha ao carregar distribuidores da API SmartPed:", err.message);
  }
}

function enrichDistribuidoresFromPayload(payload: any) {
  if (payload?.Retorno?.dists && Array.isArray(payload.Retorno.dists)) {
    payload.Retorno.dists.forEach((d: any) => {
      if (d.CodDist && d.NomeDist) DISTRIBUIDORAS_DYNAMIC_CACHE[d.CodDist] = d.NomeDist;
    });
  }
}
import { LOCAL_EQUIVALENTS_DB, getLocalEquivalents } from "./server/equivalents-db";
import { findBestSubstitute } from "./server/swap-engine";
import { enrichReturnedItem } from "./server/smartped-transforms";
import { MOCK_API_DATABASE } from "./server/mock-data";
import { startDbCachePurge, saveOrder, saveOrderItem, getOrder, initTursoSchema, saveItemConfirmado, saveItensConfirmadosBatch, getItensConfirmados, getProfarmaFaturadosPendentes, saveItemManual, deleteItemManual, getItensManuais, purgeOldData, savePrecosCacheBatch, getPrecoCacheByEan, getPrecoCacheByEans, countPrecosCache, getLastPrecoSync, saveProdutoCache, countProdutosCache, listPrecosCache, purgePrecosCache, saveEansFixos, getEansFixos, countEansFixos } from "./server/database";

runEngineSelfTests();

const app = express();

app.use(express.json({ limit: "50mb" }));
app.use(express.urlencoded({ extended: true, limit: "50mb" }));

app.use((req, res, next) => {
  console.log(`[SERVER LOG] ${req.method} ${req.url}`);
  next();
});

// Rate limiting imported from server/rate-limiter.ts
startRateLimitPurge();
app.use(rateLimitMiddleware);

// Cache purge interval
startCachePurgeInterval(EAN_DATABASE, MINIMOS_GLOBAL_CACHE);

// Turso warmup endpoint
app.get("/api/warmup", async (_req, res) => {
  try {
    const d = getDb();
    if (d) { USE_TURSO ? await d.all("SELECT 1") : d.prepare("SELECT 1").get(); }
  } catch {}
  res.json({ ok: true });
});

// Turso keep-alive ping (a cada 4 minutos)
setInterval(async () => {
  try {
    const d = getDb();
    if (d) { USE_TURSO ? await d.all("SELECT 1") : d.prepare("SELECT 1").get(); }
  } catch {}
}, 4 * 60 * 1000);

// Load EAN database on startup
loadEanDatabase();

// Initialize Turso schema (async, non-blocking, with retry for cold start)
async function initTursoSchemaWithRetry(maxTentativas = 4) {
  for (let tentativa = 1; tentativa <= maxTentativas; tentativa++) {
    try {
      await initTursoSchema();
      if (tentativa > 1) console.log(`[DB] Schema Turso inicializado com sucesso na tentativa ${tentativa}`);
      return;
    } catch (e: any) {
      console.error(`[DB] Tentativa ${tentativa}/${maxTentativas} de inicializar schema Turso falhou: ${e.message}`);
      if (tentativa < maxTentativas) {
        await new Promise(r => setTimeout(r, tentativa * 1000));
      }
    }
  }
  console.error(`[DB] Desistindo de inicializar schema Turso após ${maxTentativas} tentativas.`);
}
initTursoSchemaWithRetry();

// Start SQLite cache purge
startDbCachePurge();

// API Health Check
app.get("/api/health", (req, res) => {
  let version = "dev";
  try {
    version = fs.readFileSync(path.join(process.cwd(), "dist", "version.txt"), "utf-8").trim();
  } catch {}
  res.json({ status: "ok", version, timestamp: new Date().toISOString() });
});

// Endpoint para salvar item manual no Turso
app.post("/api/salvar-item-manual", async (req, res) => {
  try {
    const { item, cnpj } = req.body;
    if (!item || !cnpj) {
      return res.status(400).json({ error: "item e cnpj são obrigatórios." });
    }
    await saveItemManual({
      codInterno: item.codInterno,
      ean: item.ean,
      descricao: item.descricao,
      laboratorio: item.laboratorio || "",
      distribuidora: item.distribuidora || "",
      codDist: item.codDist || 0,
      qtd: item.qtd || 1,
      precoLiquido: item.precoLiquido || 0,
      precoFabrica: item.precoFabrica || 0,
      condicao: item.condicao || "",
      prazo: item.prazo || 0,
      cnpj: cnpj,
      dataAdicao: item.dataAdicao || new Date().toISOString(),
      status: item.status || "adicionado",
      origem: item.origem || "manual",
      idEncomenda: item.idEncomenda || null
    });
    res.json({ sucesso: true });
  } catch (err: any) {
    console.error("Erro ao salvar item manual:", err);
    res.status(500).json({ error: err.message });
  }
});

app.post("/api/deletar-item-manual", async (req, res) => {
  try {
    const { codInterno, cnpj } = req.body;
    if (!codInterno || !cnpj) {
      return res.status(400).json({ error: "codInterno e cnpj são obrigatórios." });
    }
    await deleteItemManual(codInterno, cnpj);
    res.json({ sucesso: true });
  } catch (err: any) {
    console.error("Erro ao excluir item manual:", err);
    res.status(500).json({ error: err.message });
  }
});

// Endpoint para buscar itens manuais do Turso
app.post("/api/itens-manuais", async (req, res) => {
  try {
    const { cnpj, dataInicio, dataFim } = req.body;
    if (!cnpj) {
      return res.status(400).json({ error: "cnpj é obrigatório." });
    }
    const rows = await getItensManuais(cnpj, dataInicio, dataFim);
    // Normalizar snake_case (banco) → camelCase (frontend) — regra #28/#32 AGENTS.md
    const itens = rows.map((r: any) => ({
      id: r.id,
      codInterno: r.cod_interno,
      ean: r.ean,
      descricao: r.descricao,
      laboratorio: r.laboratorio,
      distribuidora: r.distribuidora,
      codDist: r.cod_dist,
      qtd: r.qtd,
      precoLiquido: r.preco_liquido,
      precoFabrica: r.preco_fabrica,
      condicao: r.condicao,
      prazo: r.prazo,
      cnpj: r.cnpj,
      status: r.status,
      dataAdicao: r.data_adicao,
      origem: r.origem,
      idEncomenda: r.id_encomenda,
    }));
    res.json({ itens });
  } catch (err: any) {
    console.error("Erro ao buscar itens manuais:", err);
    res.status(500).json({ error: err.message });
  }
});

// ===== PEDIDOS WHATSAPP =====

// Salvar pedido WhatsApp
app.post("/api/pedidos-whatsapp", async (req, res) => {
  try {
    const { fornecedor, telefone, itens, status, observacao, origem, cnpj } = req.body;
    if (!fornecedor || !itens || !Array.isArray(itens) || itens.length === 0 || !cnpj) {
      return res.status(400).json({ error: "fornecedor, itens (array) e cnpj são obrigatórios." });
    }
    await savePedidoWhatsApp({
      dataPedido: new Date().toISOString(),
      fornecedor,
      telefone,
      itens,
      status: status || "Pendente",
      observacao,
      origem: origem || "lista",
      cnpj
    });
    res.json({ sucesso: true });
  } catch (err: any) {
    console.error("Erro ao salvar pedido WhatsApp:", err);
    res.status(500).json({ error: err.message });
  }
});

// Buscar pedidos WhatsApp
app.post("/api/pedidos-whatsapp/list", async (req, res) => {
  try {
    const { cnpj } = req.body;
    if (!cnpj) {
      return res.status(400).json({ error: "cnpj é obrigatório." });
    }
    const rows = await getPedidosWhatsApp(cnpj);
    // Normalizar snake_case (banco) → camelCase (frontend)
    const pedidos = rows.map((r: any) => ({
      id: r.id,
      dataPedido: r.data_pedido,
      fornecedor: r.fornecedor,
      telefone: r.telefone,
      itens: typeof r.itens === "string" ? JSON.parse(r.itens) : r.itens,
      status: r.status,
      observacao: r.observacao,
      origem: r.origem,
      cnpj: r.cnpj
    }));
    res.json({ pedidos });
  } catch (err: any) {
    console.error("Erro ao buscar pedidos WhatsApp:", err);
    res.status(500).json({ error: err.message });
  }
});

// Atualizar status pedido WhatsApp
app.put("/api/pedidos-whatsapp/:id/status", async (req, res) => {
  try {
    const id = Number(req.params.id);
    const { status } = req.body;
    if (!id || !status) {
      return res.status(400).json({ error: "id e status são obrigatórios." });
    }
    const validStatuses = ["Pendente", "Confirmado", "Recebido", "Cancelado"];
    if (!validStatuses.includes(status)) {
      return res.status(400).json({ error: `Status inválido. Use: ${validStatuses.join(", ")}` });
    }
    await updatePedidoWhatsAppStatus(id, status);
    res.json({ sucesso: true });
  } catch (err: any) {
    console.error("Erro ao atualizar pedido WhatsApp:", err);
    res.status(500).json({ error: err.message });
  }
});

// Deletar pedido WhatsApp
app.delete("/api/pedidos-whatsapp/:id", async (req, res) => {
  try {
    const id = Number(req.params.id);
    if (!id) {
      return res.status(400).json({ error: "id é obrigatório." });
    }
    await deletePedidoWhatsApp(id);
    res.json({ sucesso: true });
  } catch (err: any) {
    console.error("Erro ao deletar pedido WhatsApp:", err);
    res.status(500).json({ error: err.message });
  }
});

// ===== REGRAS WHATSAPP (Laboratório) =====

// Salvar regra WhatsApp
app.post("/api/whatsapp-rules", async (req, res) => {
  try {
    const { nomeRegra, termoFiltro, nomeRepresentante, telefone, tipoFiltro, ocultarPrecos, cnpj } = req.body;
    if (!nomeRegra || !termoFiltro || !cnpj) {
      return res.status(400).json({ error: "nomeRegra, termoFiltro e cnpj são obrigatórios." });
    }
    const id = `wr_${Date.now()}_${Math.random().toString(36).slice(2, 8)}`;
    await saveWhatsAppRule({
      id, nomeRegra, termoFiltro, nomeRepresentante, telefone,
      tipoFiltro: tipoFiltro || "todos",
      ocultarPrecos: ocultarPrecos || false,
      ativo: true, cnpj
    });
    res.json({ sucesso: true, id });
  } catch (err: any) {
    console.error("Erro ao salvar regra WhatsApp:", err);
    res.status(500).json({ error: err.message });
  }
});

// Buscar regras WhatsApp
app.post("/api/whatsapp-rules/list", async (req, res) => {
  try {
    const { cnpj } = req.body;
    if (!cnpj) {
      return res.status(400).json({ error: "cnpj é obrigatório." });
    }
    const rows = await getWhatsAppRules(cnpj);
    // Normalizar snake_case (banco) → camelCase (frontend)
    const regras = rows.map((r: any) => ({
      id: r.id,
      nomeRegra: r.nome_regra,
      termoFiltro: r.termo_filtro,
      nomeRepresentante: r.nome_representante,
      telefone: r.telefone,
      tipoFiltro: r.tipo_filtro,
      ocultarPrecos: !!r.ocultar_precos,
      ativo: !!r.ativo,
      cnpj: r.cnpj
    }));
    res.json({ regras });
  } catch (err: any) {
    console.error("Erro ao buscar regras WhatsApp:", err);
    res.status(500).json({ error: err.message });
  }
});

// Deletar regra WhatsApp
app.delete("/api/whatsapp-rules/:id", async (req, res) => {
  try {
    const id = req.params.id;
    if (!id) {
      return res.status(400).json({ error: "id é obrigatório." });
    }
    await deleteWhatsAppRule(id);
    res.json({ sucesso: true });
  } catch (err: any) {
    console.error("Erro ao deletar regra WhatsApp:", err);
    res.status(500).json({ error: err.message });
  }
});

// ===== EXTERNAL SUPPLIERS (TABELAS DE PRECO WHATSAPP) =====
app.post("/api/external-suppliers", async (req, res) => {
  try {
    const { id, name, rawText, validade, products, cnpj } = req.body;
    if (!id || !cnpj) {
      return res.status(400).json({ error: "id e cnpj são obrigatórios." });
    }

    // Verificar se products mudou (comparar com banco atual)
    // Normalizar: ordenar por description+price antes de comparar para evitar falsos positivos
    const normalizeProducts = (arr: any[]) => {
      return arr.map((p: any) => ({
        d: (p.description || p.produto || "").trim().toLowerCase(),
        p: parseFloat(String(p.price || p.preco || 0)).toFixed(2),
        t: p.tiers ? JSON.stringify(p.tiers.sort((a: any, b: any) => a.minQty - b.minQty)) : "",
        dt: p.discountTiers ? JSON.stringify(p.discountTiers.sort((a: any, b: any) => a.minQty - b.minQty)) : "",
      })).sort((a, b) => a.d.localeCompare(b.d) || a.p.localeCompare(b.p));
    };
    const oldRows = await getExternalSuppliers(cnpj);
    const oldSupplier = (oldRows as any[]).find(r => r.id === id);
    const oldProducts = oldSupplier ? JSON.parse(oldSupplier.products || "[]") : [];
    const newProducts = Array.isArray(products) ? products : [];
    const productsChanged = JSON.stringify(normalizeProducts(oldProducts)) !== JSON.stringify(normalizeProducts(newProducts));

    // Salvar fornecedor no banco (SEMPRE, independente de mudanca)
    await saveExternalSupplier({ id, name: name || "", rawText: rawText || "", validade: validade || "", products: JSON.stringify(products || []), cnpj });

    const supplierArray = Array.isArray(products) ? products : [];

    if (productsChanged && oldSupplier) {
      // Calcular diff: quais produtos foram adicionados, modificados, removidos
      const normalizeForCompare = (p: any) => ({
        d: (p.description || p.produto || p.ean || "").trim().toLowerCase(),
        e: (p.ean || p.codigo_barras || "").trim(),
        pr: parseFloat(String(p.price || p.preco || 0)).toFixed(2),
        v: (p.validade || "").trim(),
        t: p.tiers ? JSON.stringify(p.tiers.sort((a: any, b: any) => a.minQty - b.minQty)) : "",
        dt: p.discountTiers ? JSON.stringify(p.discountTiers.sort((a: any, b: any) => a.minQty - b.minQty)) : "",
      });
      const oldMap = new Map<string, any>();
      for (const p of oldProducts) {
        const n = normalizeForCompare(p);
        oldMap.set(`${n.e}_${n.d}_${n.pr}_${n.t}_${n.dt}`, p);
      }
      const newMap = new Map<string, any>();
      for (const p of newProducts) {
        const n = normalizeForCompare(p);
        newMap.set(`${n.e}_${n.d}_${n.pr}_${n.t}_${n.dt}`, p);
      }
      
      const added = newProducts.filter((p: any) => {
        const n = normalizeForCompare(p);
        return !oldMap.has(`${n.e}_${n.d}_${n.pr}_${n.t}_${n.dt}`);
      });
      const modified = newProducts.filter((p: any) => {
        const n = normalizeForCompare(p);
        const key = `${n.e}_${n.d}_${n.pr}_${n.t}_${n.dt}`;
        // Modificado se existe algo parecido no old mas com preço ou descrição diferente
        for (const [oldKey, oldP] of oldMap) {
          const on = normalizeForCompare(oldP);
          if ((on.e && on.e === n.e) || (on.d === n.d && on.d.length > 3)) {
            // MESMO produto (mesmo EAN ou mesma descrição) mas chave diferente = mudou
            return oldKey !== key;
          }
        }
        return false;
      });
      
      const changedProducts = [...added, ...modified];
      const removed = oldProducts.filter((p: any) => {
        const n = normalizeForCompare(p);
        return !newMap.has(`${n.e}_${n.d}_${n.pr}_${n.t}_${n.dt}`);
      });
      
      console.log(`[OFERTAS-DIA] Products diff for ${id}: +${added.length} added, ~${modified.length} modified, -${removed.length} removed`);

      if (changedProducts.length > 0) {
        console.log(`[OFERTAS-DIA] Re-analyzing ${changedProducts.length} changed products`);
        analisarFornecedorEmBackground(id, cnpj, changedProducts).catch(err => {
          console.error(`[OFERTAS-DIA] Background incremental analysis error:`, err.message);
        });
      } else if (removed.length > 0) {
        // Só removidos: limpar cache para re-análise completa
        console.log(`[OFERTAS-DIA] Only removals — clearing cache for full re-analysis`);
        await updateSupplierAnalysis(id, null, "pendente");
        analisarFornecedorEmBackground(id, cnpj).catch(err => {
          console.error(`[OFERTAS-DIA] Background full analysis error:`, err.message);
        });
      }

      // Se há removidos E analisados/adicionados, limpar ofertas dos removidos do cache
      if (removed.length > 0 && changedProducts.length > 0) {
        try {
          const currentDados = (await getExternalSuppliers(cnpj)) as any[];
          const currentSupplier = currentDados.find(r => r.id === id);
          if (currentSupplier?.dados_analise) {
            const dados = typeof currentSupplier.dados_analise === "string" ? JSON.parse(currentSupplier.dados_analise) : currentSupplier.dados_analise;
            if (dados?.ofertas) {
              const removedDescs = new Set(removed.map((p: any) => (p.description || p.produto || "").toLowerCase().trim()));
              const removedEans = new Set(removed.map((p: any) => (p.ean || p.codigo_barras || "")).filter(Boolean));
              const cleanedOfertas = dados.ofertas.filter((o: any) => {
                const oDesc = (o.description || o.produto || "").toLowerCase().trim();
                const oEan = o.ean || "";
                // Manter se NÃO está na lista de removidos
                return !removedDescs.has(oDesc) || (oEan && !removedEans.has(oEan));
              });
              if (cleanedOfertas.length !== dados.ofertas.length) {
                console.log(`[OFERTAS-DIA] CLEANUP: ${dados.ofertas.length - cleanedOfertas.length} removed offers from cache`);
                dados.ofertas = cleanedOfertas;
                await updateSupplierAnalysis(id, dados, "analisado");
              }
            }
          }
        } catch (err: any) {
          console.log(`[OFERTAS-DIA] CLEANUP error: ${err.message}`);
        }
      }
    } else if (!productsChanged && supplierArray.length > 0) {
      // Nada mudou nos produtos — não precisa re-analisar
      console.log(`[OFERTAS-DIA] Products unchanged for ${id} — skipping analysis`);
    }
    
    res.json({ sucesso: true });
  } catch (err: any) {
    console.error("Erro ao salvar fornecedor externo:", err);
    res.status(500).json({ error: err.message });
  }
});

app.post("/api/external-suppliers/list", async (req, res) => {
  try {
    const { cnpj } = req.body;
    if (!cnpj) {
      return res.status(400).json({ error: "cnpj é obrigatório." });
    }
    const rows = await getExternalSuppliers(cnpj);
    const suppliers = (rows as any[]).map((r) => ({
      id: r.id,
      name: r.name,
      rawText: r.raw_text,
      validade: r.validade,
      products: (() => { try { return JSON.parse(r.products || "[]"); } catch { return []; } })(),
      cnpj: r.cnpj,
    }));
    res.json({ suppliers });
  } catch (err: any) {
    console.error("Erro ao listar fornecedores externos:", err);
    res.status(500).json({ error: err.message });
  }
});

app.delete("/api/external-suppliers/:id", async (req, res) => {
  try {
    const id = req.params.id;
    if (!id) {
      return res.status(400).json({ error: "id é obrigatório." });
    }
    await deleteExternalSupplier(id);
    res.json({ sucesso: true });
  } catch (err: any) {
    console.error("Erro ao deletar fornecedor externo:", err);
    res.status(500).json({ error: err.message });
  }
});

// ===== OFERTAS DO DIA - FUNCOES DE BACKGROUND PROCESSING =====

const sleep = (ms: number) => new Promise(r => setTimeout(r, ms));

// Funcao para analisar um unico produto (reutilizada pelo background e pelo endpoint)
// allEans: opcional — lista de todos os EANs do mesmo DCB (expansão por principle active)
async function analisarUmProduto(product: any, cnpj: string, allEans?: string[]): Promise<any> {
  let vendasMensais = 0;
  let estoqueTotal = 0;
  let estoqueMesmoEan = 0;
  let melhorPrecoSmartPed: number | null = null;
  let melhorDistribuidora: string | null = null;
  let melhorEanSmartPed: string | null = null;
  let melhorLabSmartPed: string | null = null;
  let melhorPrecoPromocao: number | null = null;
  let melhorDistPromocao: string | null = null;
  let melhorCondPromocao: string | null = null;
  let melhorQtdMinPromocao: number = 0;
  let melhorEanPromocao: string | null = null;
  let melhorPrecoHistorico: number | null = null;
  let melhorFornecedorHistorico: string | null = null;
  let comprasHistorico: any[] = [];
  let estoquePorLaboratorio: { nome: string; quantidade: number; eans: string[] }[] = [];
  let ultimaCompra: any = null;

  if (product.ean) {
    const baseUrl = process.env.SMARTPED_PRODUCTION_URL || "https://api.smartped.com.br";
    const token = process.env.SMARTPED_PRODUCTION_TOKEN;

    // Buscar vendas via vendas-resumo (agregado sem limite de linhas)
    try {
      const { totalVendas, primeira, ultima } = await fetchVendasResumo(product.ean);
      if (totalVendas > 0 && primeira && ultima) {
        const mesesDiff = Math.max(1, (ultima.getFullYear() - primeira.getFullYear()) * 12 + (ultima.getMonth() - primeira.getMonth()) + 1);
        vendasMensais = Math.round(totalVendas / mesesDiff);
      }
    } catch (err: any) {
      console.log(`[ANALISE] vendas erro: ${err.message} para EAN ${product.ean}`);
    }

    // Buscar estoque via similares (com filtro de apresentação — padrão SICF)
    try {
      const estoqueUrl = `${CONFIG.FERRAMENTINHAS_API_URL}/api/produtos/similares/${product.ean}`;
      const estoqueRes = await fetch(estoqueUrl);
      if (estoqueRes.ok) {
        const estoqueData = await estoqueRes.json();
        const produtosRaw = estoqueData?.produtos || [];

        // Busca direta pelo EAN exato do próprio produto (antecipada — usada pra categoria e estoque)
        const eanLimpo = (product.ean || "").replace(/\D/g, "");
        const produtoExato = produtosRaw.find((p: any) => (p.ean || "").replace(/\D/g, "") === eanLimpo);

        // Filtro por categoria: referência/ético agrupa com referência/ético; genérico/similar agrupa com genérico/similar
        // Usar produtoExato do catálogo (tem campo grupo/classificacao) em vez do objeto bruto da promoção
        const catProduct = resolveCategoria(produtoExato || product);
        const produtosFiltered = produtosRaw.filter((p: any) => {
          const cat = resolveCategoria(p);
          if (catProduct === "marca") return cat === "marca"; // referência: só outras referências
          return cat !== "marca"; // genérico/similar: exclui referências
        });

        if (produtoExato) {
          estoqueMesmoEan = produtoExato.qtd_estoque || 0;
          const labExato = produtoExato.nom_laborat || produtoExato.laboratorio || "Desconhecido";
          estoquePorLaboratorio = [{ nome: labExato, quantidade: estoqueMesmoEan, eans: [produtoExato.ean] }];
        }

        // Referência (marca): NÃO buscar similares — não existe "outro fabricante" pra somar
        // Genérico/similar: buscar outros candidatos via mesmaApresentacao
        let produtos: any[] = [];
        if (catProduct !== "marca") {
          const dcbRef1 = product.cod_dcb || produtosRaw[0]?.cod_dcb || null;
          const concRef1 = product.cod_concentracao || produtosRaw[0]?.cod_concentracao || null;
          const productComDcb = (dcbRef1 && concRef1) ? { ...product, cod_dcb: dcbRef1, cod_concentracao: concRef1 } : product;
          produtos = produtosFiltered.filter((p: any) => {
            const pEan = (p.ean || "").replace(/\D/g, "");
            if (pEan === eanLimpo) return false;
            return mesmaApresentacao(productComDcb, p);
          });
        }

        estoqueTotal = estoqueMesmoEan + produtos.reduce((sum: number, p: any) => sum + (p.qtd_estoque || 0), 0);
        
        const labMap = new Map<string, { quantidade: number; eans: string[] }>();
        for (const entry of estoquePorLaboratorio) {
          labMap.set(entry.nome, { quantidade: entry.quantidade, eans: [...entry.eans] });
        }
        for (const p of produtos) {
          const lab = p.nom_laborat || p.laboratorio || "Desconhecido";
          const existing = labMap.get(lab) || { quantidade: 0, eans: [] };
          existing.quantidade += (p.qtd_estoque || 0);
          if (p.ean) existing.eans.push(p.ean);
          labMap.set(lab, existing);
        }
        estoquePorLaboratorio = Array.from(labMap.entries())
          .map(([nome, dados]) => ({ nome, quantidade: dados.quantidade, eans: dados.eans }))
          .sort((a, b) => b.quantidade - a.quantidade);
      }
    } catch (err: any) {
      console.log(`[ANALISE] estoque erro: ${err.message} para EAN ${product.ean}`);
    }

    // Buscar historico de compras
    try {
      const historicoRes = await fetch(`${CONFIG.FERRAMENTINHAS_API_URL}/api/produtos/compras-historico/${product.ean}?meses=6`);
      if (historicoRes.ok) {
        const historicoData = await historicoRes.json();
        if (historicoData?.resumo) {
          melhorPrecoHistorico = historicoData.resumo.melhor_preco || null;
          melhorFornecedorHistorico = historicoData.resumo.melhor_fornecedor || null;
        }
        // Mapa EAN → lab a partir de estoquePorLaboratorio
        const eanToLabMap = new Map<string, string>();
        for (const lab of estoquePorLaboratorio) {
          for (const ean of lab.eans) {
            if (ean && !eanToLabMap.has(ean)) eanToLabMap.set(ean, lab.nome);
          }
        }
        comprasHistorico = (historicoData?.compras || []).map((c: any) => ({
          preco: parseFloat(c.preco_unitario || c.preco || "0"),
          precoTabela: parseFloat(c.preco_tabela || "0"),
          fornecedor: c.fornecedor || "Desconhecido",
          data: c.data || "",
          quantidade: parseInt(c.quantidade || "0"),
          notaFiscal: c.nota_fiscal || null,
          laboratorio: eanToLabMap.get(product.ean) || "",
        }));
        if (comprasHistorico.length > 0) {
          ultimaCompra = comprasHistorico[0];
        }
      }
    } catch (err: any) {
      console.log(`[ANALISE] historico erro: ${err.message} para EAN ${product.ean}`);
    }

    // Buscar melhor preco SmartPed — Ean como fonte primaria + Molecula para QtdMin
    try {
      const smartPedEanUrl = baseUrl.replace(/\/$/, "") + "/api/Condicoes/Ean";
      const smartPedMolUrl = baseUrl.replace(/\/$/, "") + "/api/Condicoes/Molecula";
      
      // Usar todos os EANs do grupo DCB se disponível, senão só o EAN original
      let eansParaBuscar = (allEans && allEans.length > 0) ? allEans : [product.ean];
      
      // PASSO EXTRA: Se poucos EANs, buscar mais via Ferramentinhas por descrição
      if (eansParaBuscar.length <= 2 && product.description) {
        try {
          const descLimpa = (product.description || "")
            .replace(/[\u{1F300}-\u{1FAFF}\u{2600}-\u{27BF}\u{FE0F}\u{200D}]/gu, "")
            .replace(/[\uDCA5\uDCA4\uDCA6\uFFFD]/g, "")
            .replace(/\\udca5|\\udca4|\\udca6|\\ufffd/gi, "")
            .replace(/\bgenérico\b/gi, "").replace(/\bgen\b/gi, "")
            .replace(/\b(sandoz|medley|biolab|ache|delta|hypera|torrent|germed|prati|discus|tommasi|sanofi|bayer|merck|abbot|abbott|vitamedic|farmoquimica|cimed|união quimica|alten|bussie|pharlab|diméd|dimed|anfarm|emdeplast|geolab|mylan|legrand|teuto|pague|rosário|andromeda|biochemiker|phoenix|medquimica|cristália|cristalia)\b/gi, "")
            .trim();
          const words = descLimpa.split(/\s+/).filter((w: string) => w.length >= 3 && !/^\d+$/.test(w));
          const principioAtivo = words[0];
          if (principioAtivo && principioAtivo.length >= 3) {
            const buscaRes = await fetch(`${CONFIG.FERRAMENTINHAS_API_URL}/api/produtos/buscar-lote`, {
              method: "POST",
              headers: { "Content-Type": "application/json" },
              body: JSON.stringify({ itens: [principioAtivo] }),
            });
            if (buscaRes.ok) {
              const buscaData = await buscaRes.json();
              const resultados = buscaData?.resultados || {};
              let novosEans: string[] = [];
                const origDosageMatch2 = (product.description || "").match(/(\d+)\s*(mg|mcg|g|ml|ui|%)/i);
                const origDosage2 = origDosageMatch2 ? origDosageMatch2[1].toLowerCase() : null;
                for (const key of Object.keys(resultados)) {
                const prods = resultados[key] || [];
                for (const p of prods) {
                  const ean = p.ean || p.cod_barra || "";
                  if (!ean || eansParaBuscar.includes(ean)) continue;
                  if (origDosage2) {
                    const pDesc = (p.nom_produto || "").toLowerCase();
                    const pDosageMatch = pDesc.match(/(\d+)\s*(mg|mcg|g|ml|ui|%)/i);
                    if (pDosageMatch && pDosageMatch[1] !== origDosage2) continue;
                  }
                  novosEans.push(ean);
                }
              }
              if (novosEans.length > 0) {
                eansParaBuscar = [...new Set([...eansParaBuscar, ...novosEans])];
                console.log(`[ANALISE] SmartPed: +${novosEans.length} EANs via descrição (total: ${eansParaBuscar.length})`);
              }
            }
          }
        } catch {}
      }
      
      console.log(`[ANALISE] SmartPed: buscando ${eansParaBuscar.length} EANs`);
      
      // FONTE PRIMARIA: Condicoes/Ean em BATCH (lotes de ate 40 EANs separados por virgula)
      // INFO DIOGO (CTO SmartPed): endpoint JÁ aceita múltiplos EANs — não precisa chamar um por um
      // IMPORTANTE: Chamadas SEQUENCIAIS com delay — API usa tabela temporária que é sobrescrita
      const allCondicoes: any[] = [];
      const BATCH_SIZE = 40;
      const BATCH_DELAY_MS = 500;
      const eanChunks: string[][] = [];
      for (let i = 0; i < eansParaBuscar.length; i += BATCH_SIZE) {
        eanChunks.push(eansParaBuscar.slice(i, i + BATCH_SIZE));
      }
      console.log(`[ANALISE] SmartPed: ${eanChunks.length} batch(es) de ate ${BATCH_SIZE} EANs`);
      
      for (let chunkIdx = 0; chunkIdx < eanChunks.length; chunkIdx++) {
        const chunk = eanChunks[chunkIdx];
        const eanParam = chunk.join(",");
        try {
          const eanRes = await fetch(smartPedEanUrl, {
            method: "POST",
            headers: { "Content-Type": "application/json", "Accept": "application/json" },
            body: JSON.stringify({ Token: token, parametros: { CnpjCLi: cnpj, Ean: eanParam, AceitaOntem: 1 } })
          });
          const eanData = eanRes.ok ? await eanRes.json() : null;
          if (eanData) {
            const itens = eanData?.Retorno?.itens || eanData?.Retorno?.Itens || eanData?.itens || eanData?.Itens || [];
            const distsRaw = eanData?.Retorno?.dists || eanData?.Retorno?.Dists || [];
            for (const d of distsRaw) {
              if (d.CodDist && d.NomeDist) DISTRIBUIDORAS_DYNAMIC_CACHE[d.CodDist] = d.NomeDist;
            }
            let condsNoBatch = 0;
            const sourceEansDebug = new Set<string>();
            for (const entry of itens) {
              const conditions = entry.Condicoes || entry.condicoes || [];
              // Batch: EAN vem em CodBarra (não ItemPedido.Ean como em chamada individual)
              const condEan = entry.ItemPedido?.Ean || entry.ItemPedido?.ean || entry.CodBarra || entry.codBarra || entry.CodProduto || "";
              const condEanStr = String(condEan);
              const condDesc = entry.ItemPedido?.Descricao || entry.ItemPedido?.descricao || entry.Descricao || "";
              const condLab = entry.ItemPedido?.Laboratorio || entry.ItemPedido?.laboratorio || entry.Laboratorio || "";
              sourceEansDebug.add(condEanStr);
              for (const cond of conditions) {
                cond._queryEan = eanParam; // batch — todos os EANs consultados
                cond._sourceEan = condEanStr;
                cond._sourceDesc = condDesc;
                cond._sourceLab = condLab;
              }
              allCondicoes.push(...conditions);
              condsNoBatch += conditions.length;
            }
          } else {
            // Batch failed
          }
        } catch {
          // Batch error
        }
        if (chunkIdx < eanChunks.length - 1) await sleep(BATCH_DELAY_MS);
      }
      
      // COMPLEMENTO: Condicoes/Molecula via campo "Molecula" (aceita EAN como molécula)
      // Testa se retorna condições individuais sem agrupamento mestre
      const molFromMolecula: any[] = [];
      try {
        const molTestEan = eansParaBuscar[0]; // Testar com primeiro EAN
        const molTestRes = await fetch(smartPedMolUrl, {
          method: "POST",
          headers: { "Content-Type": "application/json", "Accept": "application/json" },
          body: JSON.stringify({ Token: token, parametros: { CnpjCLi: cnpj, Molecula: molTestEan, ConsideraTipo: 1 } })
        });
        if (molTestRes.ok) {
          const molTestData = await molTestRes.json();
          const itens = molTestData?.Retorno?.itens || molTestData?.Retorno?.Itens || molTestData?.itens || molTestData?.Itens || [];
          for (const entry of itens) {
            const conditions = entry.Condicoes || entry.condicoes || [];
            const entryEan = entry.ItemPedido?.Ean || entry.ItemPedido?.ean || molTestEan;
            const entryDesc = entry.ItemPedido?.Descricao || entry.ItemPedido?.descricao || "";
            const entryLab = entry.ItemPedido?.Laboratorio || entry.ItemPedido?.laboratorio || "";
            for (const cond of conditions) {
              cond._queryEan = molTestEan;
              cond._sourceEan = entryEan;
              cond._sourceDesc = entryDesc;
              cond._sourceLab = entryLab;
              molFromMolecula.push(cond);
            }
          }
        }
      } catch {}
      
      // Enriquecer com condições da Molecula (via campo) se tiver preços melhores
      for (const mc of molFromMolecula) {
        const precoMc = mc.Pliquido || mc.pliquido || mc.Preco || mc.preco || 0;
        const estMc = parseInt(String(mc.Estoque || "0"));
        if (precoMc > 0 && estMc > 0) {
          // Verificar se já temos condição desta dist neste EAN
          const exists = allCondicoes.some(c => c.CodDist === mc.CodDist && c._sourceEan === mc._sourceEan && c.Condicao === mc.Condicao);
          if (!exists) {
            allCondicoes.push(mc);
          }
        }
      }
      
      // FILTRO CRÍTICO: Manter apenas condições cujo _sourceEan pertence ao grupo DCB do produto
      // A API SmartPed retorna condições para EANs de OUTROS produtos (substitutos) na mesma resposta
      // Sem esse filtro, o melhor preço pode vir de um EAN de outro produto (cross-contamination)
      const eansDoGrupo = new Set(eansParaBuscar.map(e => e.replace(/^0+/, '')));
      const allCondicoesFiltradas = allCondicoes.filter(c => {
        const srcEan = (c._sourceEan || '').replace(/^0+/, '');
        return eansDoGrupo.has(srcEan);
      });
      // Usar array filtrado daqui para frente
      allCondicoes.length = 0;
      allCondicoes.push(...allCondicoesFiltradas);
      
      // Enriquecer QtdMin via Molecula (Ean como parâmetro Ean)
      // IMPORTANTE: Sequencial com delay — mesma razão do Ean (API contamina em paralelo)
      const eanMetadata: Record<string, any> = {};
      try {
        for (let i = 0; i < eansParaBuscar.length; i++) {
          const ean = eansParaBuscar[i];
          try {
            const molRes = await fetch(smartPedMolUrl, {
              method: "POST",
              headers: { "Content-Type": "application/json", "Accept": "application/json" },
              body: JSON.stringify({ Token: token, parametros: { CnpjCLi: cnpj, Ean: ean, ConsideraTipo: 1 } })
            });
            const molData = molRes.ok ? await molRes.json() : null;
            if (molData) {
              const itens = molData?.Retorno?.itens || molData?.Retorno?.Itens || molData?.itens || molData?.Itens || [];
              for (const entry of itens) {
                const conditions = entry.Condicoes || entry.condicoes || [];
                for (const cond of conditions) {
                  const key = `${ean}_${cond.CodDist}_${cond.Condicao}_${cond.Prazo}`;
                  if (cond.QtdMin > 0) eanMetadata[key] = { QtdMin: cond.QtdMin, minimos: cond.minimos };
                }
              }
            }
          } catch {}
          if (i < eansParaBuscar.length - 1) await sleep(500);
        }
      } catch {}
      
      for (const c of allCondicoes) {
        const meta = eanMetadata[`${c._queryEan}_${c.CodDist}_${c.Condicao}_${c.Prazo}`]
          || eanMetadata[`${c._sourceEan}_${c.CodDist}_${c.Condicao}_${c.Prazo}`];
        if (meta) {
          if (meta.QtdMin && (!c.QtdMin || c.QtdMin === 0)) c.QtdMin = meta.QtdMin;
          if (meta.minimos && (!c.minimos || c.minimos.length === 0)) c.minimos = meta.minimos;
        }
      }
      
      // Log resumo por distribuidora (mostra EAN real de cada uma)
      const distSummary = new Map<string, { preco: number; estoque: number; ean: string; condEan: string }>();
      for (const c of allCondicoes) {
        const precoLiquido = c.Pliquido || c.pliquido || c.Preco || c.preco || c.preco_liquido || 0;
        const estoqueDist = parseSmartPedEstoque(c.Estoque ?? c.estoque ?? 0, precoLiquido > 0);
        const distName = resolveDistName(c);
        // Log individual para debugar preço errado
        console.log(`[ANALISE-COND] queryEan=${c._queryEan} sourceEan=${c._sourceEan} dist=${distName}(${c.CodDist}) preco=${precoLiquido} est=${estoqueDist} cond=${c.Condicao} prazo=${c.Prazo}`);
        const key = `${distName}(${c.CodDist})`;
        const existing = distSummary.get(key);
        if (!existing || precoLiquido < existing.preco) {
          distSummary.set(key, { preco: precoLiquido, estoque: estoqueDist, ean: c._queryEan || "?", condEan: c._sourceEan || "?" });
        }
      }
      const distList = Array.from(distSummary.entries()).map(([name, d]) => {
        const swap = d.ean !== d.condEan ? ` [SWAP:${d.ean}→${d.condEan}]` : "";
        return `${name}=R$${d.preco.toFixed(2)}/est=${d.estoque}${swap}`;
      }).join(", ");
      console.log(`[ANALISE-DISTS] Fonte: Ean | ${distList}`);
      
      // Encontrar melhor preco SmartPed — PRIORIZAR condição FIXA (padrão)
      // Condições não-FIXA (ex: 116076 = combo/pedido mínimo) são usadas apenas como fallback
      // Isso evita que o card mostre preço de combo que o comprador não pode usar isoladamente
      let melhorPrecoFixa: number | null = null;
      let melhorDistFixa: string | null = null;
      let melhorEanFixa: string | null = null;
      let melhorLabFixa: string | null = null;
      
      for (const c of allCondicoes) {
        const precoLiquido = c.Pliquido || c.pliquido || c.Preco || c.preco || c.preco_liquido || 0;
        const estoqueRaw = c.Estoque ?? c.estoque ?? 0;
        const estoqueDist = parseSmartPedEstoque(estoqueRaw, precoLiquido > 0);
        const distName = resolveDistName(c);
        const condicao = String(c.Condicao || c.condicao || "").trim().toUpperCase();
        const isFixa = condicao === "FIXA" || condicao === "";
        const fitsFilter = precoLiquido > 0 && estoqueDist > 0;
        
        if (!fitsFilter) {
          console.log(`[ANALISE-SKIP] dist=${distName}(${c.CodDist}) preco=${precoLiquido} estRaw=${estoqueRaw} estParsed=${estoqueDist} cond=${c.Condicao} — filtrado`);
          continue;
        }
        
        // Melhor FIXA (padrão)
        if (isFixa) {
          if (!melhorPrecoFixa || precoLiquido < melhorPrecoFixa) {
            console.log(`[ANALISE-BEST-FIXA] dist=${distName}(${c.CodDist}) preco=${precoLiquido} est=${estoqueDist} ean=${c._sourceEan}`);
            melhorPrecoFixa = precoLiquido;
            melhorDistFixa = distName;
            melhorEanFixa = c._sourceEan || null;
            melhorLabFixa = c._sourceLab || null;
          }
        } else {
          // Melhor promoção/pedido mínimo (não-FIXA)
          if (!melhorPrecoPromocao || precoLiquido < melhorPrecoPromocao) {
            const qtdMinRaw = c.QtdMin ?? c.qtdMin ?? 0;
            console.log(`[ANALISE-BEST-PROMO] dist=${distName}(${c.CodDist}) preco=${precoLiquido} est=${estoqueDist} cond=${c.Condicao} qtdMin=${qtdMinRaw}`);
            melhorPrecoPromocao = precoLiquido;
            melhorDistPromocao = distName;
            melhorCondPromocao = c.Condicao || c.condicao || "";
            melhorQtdMinPromocao = qtdMinRaw;
            melhorEanPromocao = c._sourceEan || null;
          }
        }
      }
      
      // Usar preço FIXA se disponível; senão, usar qualquer condição com estoque
      if (melhorPrecoFixa !== null) {
        melhorPrecoSmartPed = melhorPrecoFixa;
        melhorDistribuidora = melhorDistFixa;
        melhorEanSmartPed = melhorEanFixa;
        melhorLabSmartPed = melhorLabFixa;
        console.log(`[ANALISE-SMARTPED] Melhor FIXA: R$${melhorPrecoFixa.toFixed(2)} (${melhorDistFixa})`);
      } else {
        // Fallback: qualquer condição com estoque (inclui combos/promoções)
        for (const c of allCondicoes) {
          const precoLiquido = c.Pliquido || c.pliquido || c.Preco || c.preco || c.preco_liquido || 0;
          const estoqueRaw = c.Estoque ?? c.estoque ?? 0;
          const estoqueDist = parseSmartPedEstoque(estoqueRaw, precoLiquido > 0);
          if (precoLiquido > 0 && estoqueDist > 0) {
            if (!melhorPrecoSmartPed || precoLiquido < melhorPrecoSmartPed) {
              melhorPrecoSmartPed = precoLiquido;
              melhorDistribuidora = resolveDistName(c);
              melhorEanSmartPed = c._sourceEan || null;
              melhorLabSmartPed = c._sourceLab || null;
            }
          }
        }
        if (melhorPrecoSmartPed) {
          console.log(`[ANALISE-SMARTPED] Nenhuma FIXA com estoque. Fallback: R$${melhorPrecoSmartPed.toFixed(2)} (${melhorDistribuidora})`);
        }
      }
    } catch (err: any) {
      console.log(`[ANALISE] SmartPed erro: ${err.message}`);
    }
  }

  // Se produto so tem desconto percentual (sem preco absoluto), calcular preco efetivo
  const discountPercent = product.discountPercent || product.desconto || 0;
  // Normalizar discountTiers: aceitar JSON valido OU formato PowerShell "@{minQty=1; discountPercent=10}"
  let discountTiers = product.discountTiers;
  if (discountTiers && discountTiers.length > 0 && typeof discountTiers[0] === "string") {
    discountTiers = discountTiers.map((s: string) => {
      const match = s.match(/minQty=(\d+).*?discountPercent=([\d.]+)/);
      if (match) return { minQty: parseInt(match[1]), discountPercent: parseFloat(match[2]) };
      return null;
    }).filter(Boolean);
  }
  console.log(`[ANALISE] ${product.description || product.produto}: preco=${product.preco}, discountPercent=${discountPercent}, discountTiers=${discountTiers?.length || 0} faixas, melhorPrecoSmartPed=${melhorPrecoSmartPed}`);
  if ((!product.preco || product.preco === 0) && discountPercent > 0 && melhorPrecoSmartPed && melhorPrecoSmartPed > 0) {
    product.preco = melhorPrecoSmartPed * (1 - discountPercent / 100);
    product.precoCalculadoViaDesconto = true;
    console.log(`[ANALISE] Preco calculado via desconto: R$ ${product.preco.toFixed(2)} (base: R$ ${melhorPrecoSmartPed.toFixed(2)}, desconto: ${discountPercent}%)`);
  } else if ((!product.preco || product.preco === 0) && discountPercent === 0 && discountTiers && discountTiers.length > 0 && melhorPrecoSmartPed && melhorPrecoSmartPed > 0) {
    // Fallback: usar desconto da faixa de MENOR minQty (desconto garantido sem volume)
    const lowestTier = discountTiers.sort((a: any, b: any) => a.minQty - b.minQty)[0];
    if (lowestTier && lowestTier.discountPercent > 0) {
      product.preco = melhorPrecoSmartPed * (1 - lowestTier.discountPercent / 100);
      product.precoCalculadoViaDesconto = true;
      console.log(`[ANALISE] Preco calculado via discountTiers: R$ ${product.preco.toFixed(2)} (base: R$ ${melhorPrecoSmartPed.toFixed(2)}, desconto: ${lowestTier.discountPercent}% faixa ${lowestTier.minQty}un)`);
    }
  }

  // Para auto-descarte, usar o MENOR preco entre tiers (melhor cenario)
  let bestTierPrice = product.preco;
  if (product.tiers && product.tiers.length > 0) {
    const minTierPrice = Math.min(...product.tiers.map((t: any) => t.price).filter((p: number) => p > 0));
    if (minTierPrice > 0 && minTierPrice < bestTierPrice) {
      bestTierPrice = minTierPrice;
    }
  }

  // Calcular economia vs SmartPed (usando melhor tier price para comparacao)
  let economiaPercent = 0;
  let economiaValor = 0;
  if (melhorPrecoSmartPed && melhorPrecoSmartPed > bestTierPrice) {
    economiaValor = melhorPrecoSmartPed - bestTierPrice;
    economiaPercent = (economiaValor / melhorPrecoSmartPed) * 100;
  }

  // AUTO-DESCARTE: verificar criterios (usar bestTierPrice = melhor cenario)
  let descartada = false;
  let motivoDescarte = "";

  // Criterio 1: Melhor preco da promocao > ultimo preco que paguei
  if (melhorPrecoHistorico && bestTierPrice > melhorPrecoHistorico) {
    descartada = true;
    motivoDescarte = `Preco R$ ${bestTierPrice.toFixed(2)} > ultimo pago R$ ${melhorPrecoHistorico.toFixed(2)} (${melhorFornecedorHistorico || "N/A"})`;
  }

  // Criterio 2: Melhor preco da promocao > melhor preco SmartPed (com estoque)
  if (!descartada && melhorPrecoSmartPed && bestTierPrice > melhorPrecoSmartPed) {
    descartada = true;
    motivoDescarte = `Preco R$ ${bestTierPrice.toFixed(2)} > melhor SmartPed R$ ${melhorPrecoSmartPed.toFixed(2)} (${melhorDistribuidora || "N/A"})`;
  }

  // Criterio 3: Sem vendas
  if (!descartada && vendasMensais === 0) {
    descartada = true;
    motivoDescarte = "Produto sem vendas";
  }

  return {
    vendasMensais,
    estoqueTotal,
    estoqueMesmoEan,
    estoquePorLaboratorio,
    melhorPrecoSmartPed,
    melhorDistribuidora,
    melhorEanSmartPed,
    melhorLabSmartPed,
    melhorPrecoPromocao,
    melhorDistPromocao,
    melhorCondPromocao,
    melhorQtdMinPromocao,
    melhorEanPromocao,
    melhorPrecoHistorico,
    melhorFornecedorHistorico,
    comprasHistorico,
    ultimaCompra,
    economiaPercent: Math.round(economiaPercent * 10) / 10,
    economiaValor: Math.round(economiaValor * 100) / 100,
    economiaMensal: Math.round(economiaValor * vendasMensais * 100) / 100,
    boaOferta: economiaPercent >= 10 && !descartada,
    descartada,
    motivoDescarte,
    precoCalculadoViaDesconto: product.precoCalculadoViaDesconto || false,
    discountPercent: discountPercent || 0,
    bestTierPrice: Math.round(bestTierPrice * 100) / 100,
  };
}

// Funcao para analisar fornecedor em background
async function analisarFornecedorEmBackground(supplierId: string, cnpj: string, productsToAnalyze?: any[]) {
  try {
    const rows = await getExternalSuppliers(cnpj);
    const supplier = (rows as any[]).find(r => r.id === supplierId);
    if (!supplier) return;

    let products: any[] = [];
    try {
      const raw = supplier.products;
      if (Array.isArray(raw)) {
        products = raw;
      } else if (typeof raw === "string") {
        products = JSON.parse(raw || "[]");
      }
    } catch {}

    if (products.length === 0) {
      await updateSupplierAnalysis(supplierId, { ofertas: [], summary: { totalOfertas: 0, ofertasBoas: 0, economiaPotencial: 0 } }, "analisado");
      return;
    }

    // Se productsToAnalyze foi fornecido, analisar SOMENTE esses e mesclar com cache
    const isIncremental = Array.isArray(productsToAnalyze) && productsToAnalyze.length > 0;
    const productsForAnalysis = isIncremental ? productsToAnalyze : products;
    console.log(`[OFERTAS-DIA] ${isIncremental ? `INCREMENTAL: ${productsForAnalysis.length} changed products` : `FULL: ${products.length} products`} for ${supplier.name}`);

    // Buscar EANs para produtos sem codigo de barras
    const uniqueProducts = productsForAnalysis.map((p: any) => ({
      ...p,
      ean: p.ean || p.codigo_barras || "",
      produto: p.produto || p.description || "",
      description: p.produto || p.description || "",
      preco: p.preco || p.price || 0,
    }));

    // Buscar EANs via buscar-lote para produtos sem EAN
    const productsWithoutEan = uniqueProducts.filter(p => !p.ean && p.description);
    console.log(`[OFERTAS-DIA] ${productsWithoutEan.length} produtos sem EAN para buscar`);
    if (productsWithoutEan.length > 0) {
      try {
        // Buscar por PRINCÍPIO ATIVO (ex: "ALENDRONATO") — não "70MG" que pode ter "SOD" no meio
        const buscaTermos = productsWithoutEan.map((p: any) => {
          let desc = p.description
            .replace(/[\u{1F300}-\u{1FAFF}\u{2600}-\u{27BF}\u{FE0F}\u{200D}\u{20E3}\u{E0020}-\u{E007F}\u{1F1E0}-\u{1F1FF}]/gu, "")
            .replace(/[\uDCA5\uDCA4\uDCA6\uFFFD]/g, "")
            .replace(/\\udca5|\\udca4|\\udca6|\\ufffd/gi, "")
            .replace(/\bgenérico\b/gi, "").replace(/\bgen\b/gi, "")
            .replace(/\b(sandoz|medley|biolab|ache|neo\s*quimica|cernosul|cervosul|EMS|Pfizer|Novartis|Eurofarma|Medley|Delta|Hypera|Torrent|Germed|Prati|Discus|Tommasi|Sanofi|Bayer|Merck|Abbot|Abbott|Vitamedic|Farmoquimica|Cimed|União Quimica|Alten|Bussie|Pharlab|Diméd|Dimed|Anfarm|Emdeplast|Geolab|Mylan|Legrand|Teuto|Pague|Rosário|Andromeda|Biochemiker|Phoenix|Medquimica|Cristália|Cristalia|Aché|Ache)\b/gi, "")
            .trim();
          const words = desc.split(/\s+/).filter(w => w.length >= 3 && !/^\d+$/.test(w));
          const principioAtivo = (words[0] || desc).substring(0, 30);
          const dosageMatch = desc.match(/(\d+\s*(?:mg|mcg|ml|g|ui|%))/i);
          const dosageFilter = dosageMatch ? dosageMatch[1].replace(/\s/g, '').toLowerCase() : null;
          return { principioAtivo, dosageFilter, original: desc };
        });
        const termosUnicos = [...new Set(buscaTermos.map(t => t.principioAtivo).filter(t => t.length >= 3))];
        const BATCH_SIZE = 20;
        const allResultados: Record<string, any[]> = {};
        for (let b = 0; b < termosUnicos.length; b += BATCH_SIZE) {
          const batch = termosUnicos.slice(b, b + BATCH_SIZE);
          try {
            const buscaRes = await fetch(`${CONFIG.FERRAMENTINHAS_API_URL}/api/produtos/buscar-lote`, {
              method: "POST",
              headers: { "Content-Type": "application/json" },
              body: JSON.stringify({ itens: batch }),
            });
            if (buscaRes.ok) {
              const buscaData = await buscaRes.json();
              const res = buscaData?.resultados || {};
              for (const key of Object.keys(res)) { allResultados[key] = res[key]; }
              console.log(`[OFERTAS-DIA] buscar-lote batch ${Math.floor(b/BATCH_SIZE)+1}: ${batch.length} termos → ${Object.keys(res).length} com resultado`);
            } else {
              const body = await buscaRes.text().catch(() => "");
              console.log(`[OFERTAS-DIA] buscar-lote batch ${Math.floor(b/BATCH_SIZE)+1} HTTP ${buscaRes.status}: ${body.substring(0, 200)}`);
            }
          } catch (err: any) {
            console.log(`[OFERTAS-DIA] buscar-lote batch ${Math.floor(b/BATCH_SIZE)+1} erro: ${err.message}`);
          }
        }
        console.log(`[OFERTAS-DIA] buscar-lote total: ${Object.keys(allResultados).length} termos com resultado`);
        for (let i = 0; i < productsWithoutEan.length; i++) {
          const termo = buscaTermos[i].principioAtivo;
          const produtosEncontrados = allResultados[termo] || [];
          const { dosageFilter } = buscaTermos[i];
          if (produtosEncontrados.length > 0) {
            let candidatos = produtosEncontrados;
            if (dosageFilter) {
              candidatos = produtosEncontrados.filter((p: any) => {
                const nome = (p.nom_produto || "").toLowerCase();
                return nome.includes(dosageFilter);
              });
              if (candidatos.length === 0) candidatos = produtosEncontrados;
            }
            const bestMatch = candidatos.find((p: any) => p.qtd_estoque > 0) || candidatos[0];
            if (bestMatch?.ean) {
              const product = productsWithoutEan[i];
              const idx = uniqueProducts.findIndex(p => p.description === product.description && !p.ean);
              if (idx >= 0) {
                uniqueProducts[idx].ean = bestMatch.ean;
                console.log(`[OFERTAS-DIA] EAN: ${bestMatch.ean} → "${product.description}" (${bestMatch.nom_produto})`);
              }
            }
          }
        }
      } catch (err: any) {
        console.log(`[OFERTAS-DIA] buscar-lote erro: ${err.message}`);
      }
    }

    // Analisar cada produto com CONCURRENCY=2 para nao sobrecarregar APIs
    const analyzedProducts: any[] = [];
    const CONCURRENCY = 2;
    
    for (let i = 0; i < uniqueProducts.length; i += CONCURRENCY) {
      const batch = uniqueProducts.slice(i, i + CONCURRENCY);
      const results = await Promise.allSettled(
        batch.map(async (product) => {
          // PASSO 1: Descobrir TODOS os EANs do mesmo DCB ANTES de analisar
          let eansGrupo: any[] = [];
          let allProdutos: any[] = [];
          let eanList: string[] = product.ean ? [product.ean] : [];
          console.log(`[OFERTAS-DIA] DCB: product.ean=${product.ean}, description=${(product.description || "").substring(0, 30)}`);
          
          if (product.ean) {
            try {
              allProdutos = [];

              // === FONTE PRIMÁRIA: similares/{ean} (já filtrado por estoque/atividade no lado da Ferramentinhas) ===
              try {
                const simRes = await fetch(`${CONFIG.FERRAMENTINHAS_API_URL}/api/produtos/similares/${product.ean}`);
                if (simRes.ok) {
                  const simData = await simRes.json();
                  const sims = simData?.produtos || [];
                  if (sims.length > 0) {
                    allProdutos = sims;
                    console.log(`[OFERTAS-DIA] SIMILARES-PRIMARIO: ${sims.length} produtos via similares/${product.ean}`);
                  }
                }
              } catch (simErr: any) {
                console.log(`[OFERTAS-DIA] SIMILARES-PRIMARIO erro: ${simErr.message}`);
              }

              // === FALLBACK: buscar-lote por texto (só se similares retornou vazio ou sem DCB) ===
              if (allProdutos.length === 0) {
                const descCompleta = (product.description || product.produto || "")
                  .replace(/[\u{1F300}-\u{1FAFF}\u{2600}-\u{27BF}\u{FE0F}\u{200D}]/gu, "")
                  .replace(/[\uDCA5\uDCA4\uDCA6\uFFFD]/g, "")
                  .replace(/\\udca5|\\udca4|\\udca6|\\ufffd/gi, "")
                  .replace(/\bgenérico\b/gi, "").replace(/\bgen\b/gi, "")
                  .replace(/\b(sandoz|medley|biolab|ache|delta|hypera|torrent|germed|prati|discus|tommasi|sanofi|bayer|merck|abbot|abbott|vitamedic|farmoquimica|cimed|união quimica|alten|bussie|pharlab|diméd|dimed|anfarm|emdeplast|geolab|mylan|legrand|teuto|pague|rosário|andromeda|biochemiker|phoenix|medquimica|cristália|cristalia)\b/gi, "")
                  .replace(/(\d+)\s*(cp|cpr|comprimido|caixa|cx|un|unid|rev|caps|capsulas|tabs|tabletes|gel|creme|pomada|solucao|gotas|spray|aerosol|inh)\b.*$/gi, "$1")
                  .trim()
                  .substring(0, 40);

                if (descCompleta.length >= 3) {
                  try {
                    const buscaRes = await fetch(`${CONFIG.FERRAMENTINHAS_API_URL}/api/produtos/buscar-lote`, {
                      method: "POST",
                      headers: { "Content-Type": "application/json" },
                      body: JSON.stringify({ itens: [descCompleta] }),
                    });
                    if (buscaRes.ok) {
                      const buscaData = await buscaRes.json();
                      const resultados = buscaData?.resultados || {};
                      const resultKeys = Object.keys(resultados);
                      console.log(`[OFERTAS-DIA] buscar-lote (fallback): total_itens=${buscaData?.total_itens}, keys=[${resultKeys.join(", ")}]`);
                      for (const key of Object.keys(resultados)) {
                        if (Array.isArray(resultados[key])) allProdutos.push(...resultados[key]);
                      }
                      console.log(`[OFERTAS-DIA] buscar-lote (fallback): ${allProdutos.length} produtos de ${resultKeys.length} chave(s)`);

                      // Fallback de wildcards (Trier usa %)
                      if (allProdutos.length === 0 && descCompleta.length >= 3) {
                        const palavras = descCompleta.split(/\s+/).filter((w: string) => w.length >= 3 && !/^\d+$/.test(w));
                        const termoSimples = palavras[0] || descCompleta;
                        const termosFallback = [`${termoSimples}%`, termoSimples];
                        for (const termo of termosFallback) {
                          if (allProdutos.length > 0) break;
                          try {
                            const buscaSimplesRes = await fetch(`${CONFIG.FERRAMENTINHAS_API_URL}/api/produtos/buscar-lote`, {
                              method: "POST",
                              headers: { "Content-Type": "application/json" },
                              body: JSON.stringify({ itens: [termo] }),
                            });
                            if (buscaSimplesRes.ok) {
                              const buscaSimplesData = await buscaSimplesRes.json();
                              const resSimples = buscaSimplesData?.resultados || {};
                              for (const key of Object.keys(resSimples)) {
                                if (Array.isArray(resSimples[key])) allProdutos.push(...resSimples[key]);
                              }
                              if (allProdutos.length > 0) {
                                console.log(`[OFERTAS-DIA] buscar-lote WILDCARD: ${allProdutos.length} produtos via "${termo}"`);
                              }
                            }
                          } catch {}
                        }
                      }
                    }
                  } catch {}
                }
              }

              // Extrair dosagem do produto original para filtro de concentracao
              const origDosageMatch = (product.description || "").match(/(\d+)\s*(mg|mcg|g|ml|ui|%)/i);
              const origDosage = origDosageMatch ? origDosageMatch[1].toLowerCase() : null;

              // Filtrar por DCB do EAN original
              const dcb = allProdutos.find((p: any) => (p.ean || p.cod_barra) === product.ean)?.cod_dcb;
              if (dcb) {
                eansGrupo = allProdutos
                  .filter((p: any) => {
                    if (p.cod_dcb !== dcb || !(p.ean || p.cod_barra)) return false;
                    if (!origDosage) return true;
                    const prodDesc = (p.nom_produto || "").toLowerCase();
                    const prodDosageMatch = prodDesc.match(/(\d+)\s*(mg|mcg|g|ml|ui|%)/i);
                    return !prodDosageMatch || prodDosageMatch[1] === origDosage;
                  })
                  .map((p: any) => ({ ean: p.ean || p.cod_barra || "", lab: (p.nom_laborat || "").trim(), estoque: p.qtd_estoque || 0, nom_produto: p.nom_produto || "" }));
                eanList = [...new Set(eansGrupo.filter((e: any) => e.ean).map((e: any) => e.ean))];
                console.log(`[OFERTAS-DIA] DCB: ${eanList.length} EANs para "${product.description}" (dcb: ${dcb}, dosage: ${origDosage || "any"})`);
              } else if (allProdutos.length > 0) {
                // DCB não encontrado — usar TODOS os produtos do grupo (mesma descrição) com filtro dosagem
                eansGrupo = allProdutos
                  .filter((p: any) => {
                    if (!(p.ean || p.cod_barra)) return false;
                    if (!origDosage) return true;
                    const prodDesc = (p.nom_produto || "").toLowerCase();
                    const prodDosageMatch = prodDesc.match(/(\d+)\s*(mg|mcg|g|ml|ui|%)/i);
                    return !prodDosageMatch || prodDosageMatch[1] === origDosage;
                  })
                  .map((p: any) => ({ ean: p.ean || p.cod_barra || "", lab: (p.nom_laborat || "").trim(), estoque: p.qtd_estoque || 0, nom_produto: p.nom_produto || "" }));
                eanList = [...new Set(eansGrupo.filter((e: any) => e.ean).map((e: any) => e.ean))];
                console.log(`[OFERTAS-DIA] DCB-FALLBACK: ${eanList.length} EANs (DCB não encontrado, dosage: ${origDosage || "any"})`);
              } else {
                console.log(`[OFERTAS-DIA] DCB: EAN original ${product.ean} não encontrado em allProdutos (${allProdutos.length} produtos)`);
              }
            } catch {}
          }

          // PASSO 1.5: Buscar EANs extras via SmartPed Produtos/Buscar com wildcards
          // Esses EANs são usados APENAS para buscar preços na SmartPed (Condicoes/Ean)
          // NÃO devem entrar no cálculo de vendas/estoque (SmartPed não tem dados do ERP)
          const smartPedOnlyEans: string[] = [];
          if (product.ean && product.description) {
            try {
              const smartPedToken = process.env.SMARTPED_PRODUCTION_TOKEN;
              const smartPedBaseUrl = (process.env.SMARTPED_PRODUCTION_URL || "https://api.smartped.com.br").replace(/\/$/, "");
              const wildcards = getWildcardQueries(product.description);
              if (wildcards.length > 0 && smartPedToken) {
                const smartPedEans = new Set<string>();
                for (const wildcard of wildcards.slice(0, 3)) {
                  try {
                    const buscarRes = await fetch(`${smartPedBaseUrl}/api/Produtos/Buscar`, {
                      method: "POST",
                      headers: { "Content-Type": "application/json", "Accept": "application/json" },
                      body: JSON.stringify({ Token: smartPedToken, parametros: { CnpjCLi: cnpj, Texto: wildcard } })
                    });
                    if (buscarRes.ok) {
                      const buscarData = await buscarRes.json();
                      const produtos = buscarData?.Retorno || [];
                      for (const prod of Array.isArray(produtos) ? produtos : []) {
                        const ean = cleanEan(prod.Ean || prod.ean || prod.CodBarra || "");
                        if (ean && ean.length >= 8) smartPedEans.add(ean);
                      }
                    }
                  } catch {}
                }
                // EANs extras da SmartPed: só para pricing, NÃO para vendas/estoque
                const newEans = Array.from(smartPedEans).filter(ean => !eanList.includes(ean));
                if (newEans.length > 0) {
                  smartPedOnlyEans.push(...newEans);
                  // Adicionar ao eanList apenas para analisarUmProduto (pricing SmartPed)
                  eanList = [...new Set([...eanList, ...newEans])];
                  console.log(`[OFERTAS-DIA] SMARTPED-BUSCAR: +${newEans.length} EANs via wildcards [${wildcards[0]}] (total eanList: ${eanList.length}, erpEans: ${eansGrupo.length})`);
                }
              }
            } catch {}
          }

          // erpEans: EANs do Ferramentinhas (ERP local) — usados para vendas e estoque
          // SmartPed EANs NÃO entram aqui (não têm dados de venda/estoque no ERP)
          // Fallback: se eansGrupo vazio (key mismatch no buscar-lote), usar allProdutos
          let erpEans = eansGrupo.filter((e: any) => e.ean && !smartPedOnlyEans.includes(e.ean)).map((e: any) => e.ean);
          if (erpEans.length === 0 && allProdutos.length > 0) {
            // Fallback: extrair EANs direto de allProdutos (resultados buscar-lote)
            erpEans = allProdutos.filter((p: any) => (p.ean || p.cod_barra) && !smartPedOnlyEans.includes(p.ean || p.cod_barra)).map((p: any) => p.ean || p.cod_barra);
            console.log(`[OFERTAS-DIA] ERP-FALLBACK: eansGrupo vazio, usando ${erpEans.length} EANs de allProdutos`);
          }

          // Filtro: excluir EANs de Referência/Ético (categoria "marca") — só incluir genéricos e similares
          if (allProdutos.length > 0) {
            const eanCategoriaMap = new Map<string, string>();
            for (const p of allProdutos) {
              const ean = p.ean || p.cod_barra || "";
              if (ean) eanCategoriaMap.set(ean, resolveCategoria(p));
            }
            const beforeRefFilter = erpEans.length;
            erpEans = erpEans.filter(ean => {
              const cat = eanCategoriaMap.get(ean);
              return !cat || cat !== "marca"; // se não tem info, incluir (fallback seguro)
            });
            if (beforeRefFilter !== erpEans.length) {
              console.log(`[REF-FILTER] ${beforeRefFilter} erpEans → ${erpEans.length} após excluir Referência/Ético (${beforeRefFilter - erpEans.length} removidos)`);
            }
          }

          const erpEanSet = new Set(erpEans);

          // PASSO 2: Analisar com TODOS os EANs do grupo
          const analysis = await analisarUmProduto(product, cnpj, eanList);
          
          // PASSO 3: Agregar vendas/compras de TODOS os EANs do ERP (com filtro de apresentação)
          // Usar erpEans (Ferramentinhas), NÃO eanList (que inclui SmartPed EANs sem dados de venda)
          let vendasAgregadas = analysis.vendasMensais;
          let comprasAgregadas = analysis.comprasHistorico || [];
          
          fs.appendFileSync('debug-vendas.log', `[${new Date().toISOString()}] PRE-CHECK erpEans.length=${erpEans.length} eanList.length=${eanList.length} analysis.vendasMensais=${analysis.vendasMensais}\n`);
          if (erpEans.length >= 1) {
            try {
              // Filtrar eans por apresentação usando classificarProduto()
              const origDescV = (product.description || product.produto || "").toUpperCase();

              // Mapa EAN → produto de TODAS as fontes (buscar-lote + eansGrupo)
              const eanToProduto = new Map<string, any>();
              for (const p of allProdutos) {
                const e = p.ean || p.cod_barra || "";
                if (e) eanToProduto.set(e, p);
              }
              for (const e of eansGrupo) {
                if (e.ean) eanToProduto.set(e.ean, e);
              }
              if (product.ean) eanToProduto.set(product.ean, product);

              const eanListFiltrado: string[] = [];
              for (const ean of erpEans) {
                const pProd = eanToProduto.get(ean);
                if (!pProd) continue;
                if (mesmaApresentacao(product, pProd)) eanListFiltrado.push(ean);
              }

              // Somar vendas dos EANs filtrados e dividir por meses reais
              const vendasBatch = await fetchVendasResumoBatch(eanListFiltrado);
              let totalVendasRaw = 0;
              let primeiraData: Date | null = null;
              let ultimaData: Date | null = null;
              for (const ean of eanListFiltrado) {
                const v = vendasBatch[ean];
                if (v && v.totalVendas > 0 && v.primeira && v.ultima) {
                  totalVendasRaw += v.totalVendas;
                  if (!primeiraData || v.primeira < primeiraData) primeiraData = v.primeira;
                  if (!ultimaData || v.ultima > ultimaData) ultimaData = v.ultima;
                }
              }
              // Calcular mesesDiff das datas reais (mesmo método do SICF server.ts:3611)
              const mesesDiff = (primeiraData && ultimaData)
                ? Math.max(1, (ultimaData.getFullYear() - primeiraData.getFullYear()) * 12 + (ultimaData.getMonth() - primeiraData.getMonth()) + 1)
                : 4;

              vendasAgregadas = Math.round(totalVendasRaw / mesesDiff);
              fs.appendFileSync('debug-vendas.log', `[${new Date().toISOString()}] RESULTado total=${totalVendasRaw} meses=${mesesDiff} media=${vendasAgregadas}\n`);
              
              // Compras de todos os EANs
              const allCompras: any[] = [];
              // Mapa EAN → lab para enriquecer compras
              const eanToLab = new Map<string, string>();
              for (const e of eansGrupo) {
                if (e.ean && e.lab) eanToLab.set(e.ean, e.lab);
              }
              // Fallback: quando eansGrupo está vazio (DCB não casou), popular eanToLab de allProdutos
              if (eanToLab.size === 0 && allProdutos.length > 0) {
                for (const p of allProdutos) {
                  const e = p.ean || p.cod_barra || "";
                  const lab = p.nom_laborat || p.laboratorio || "";
                  if (e && lab && !eanToLab.has(e)) eanToLab.set(e, lab);
                }
              }
              const comprasPromises = eanListFiltrado.map(async (ean: string) => {
                try {
                  const histRes = await fetch(`${CONFIG.FERRAMENTINHAS_API_URL}/api/produtos/compras-historico/${ean}?meses=6`);
                  if (histRes.ok) {
                    const histData = await histRes.json();
                    return (histData?.compras || []).map((c: any) => ({
                      preco: c.preco_unitario || c.preco || 0, precoTabela: c.preco_tabela || 0,
                      fornecedor: c.fornecedor || "", data: c.data || "", quantidade: c.quantidade || 0,
                      notaFiscal: c.nota_fiscal || null, laboratorio: eanToLab.get(ean) || "", ean,
                    }));
                  }
                } catch {}
                return [];
              });
              const comprasResults = await Promise.all(comprasPromises);
              for (const compras of comprasResults) { allCompras.push(...compras); }
              allCompras.sort((a: any, b: any) => (b.data || "").localeCompare(a.data || ""));
              comprasAgregadas = allCompras.slice(0, 10);
            } catch {}
          }

          const estoqueGrupoCalc = eansGrupo.length > 0
            ? eansGrupo.reduce((sum: number, e: any) => sum + (e.estoque || 0), 0)
            : 0;
          // Usar estoque do similares API (Ferramentinhas) — é a fonte correta
          // eansGrupo pode ter dados desatualizados ou incompletos do buscar-lote
          const estoqueGrupo = analysis.estoqueTotal || estoqueGrupoCalc;
          
          // Extrair laboratórios únicos do grupo DCB para o campo "laboratorio" do card
          const labsUnicos = [...new Set(eansGrupo.map((e: any) => e.lab).filter(Boolean))];
          const laboratorioStr = labsUnicos.length > 0 ? labsUnicos.join(", ") : (product.laboratorio || "");
          
          return {
            ...product,
            ...analysis,
            vendasMensais: vendasAgregadas,
            comprasHistorico: comprasAgregadas,
            eansGrupo,
            estoqueTotal: estoqueGrupo,
            estoqueMesmoEan: estoqueGrupo,
            laboratorio: laboratorioStr,
          };
        })
      );

      for (const r of results) {
        if (r.status === "fulfilled") {
          analyzedProducts.push(r.value);
        }
      }
    }

    // Ordenar: com EAN primeiro, depois por economia
    analyzedProducts.sort((a, b) => {
      if (a.semEan && !b.semEan) return 1;
      if (!a.semEan && b.semEan) return -1;
      return b.economiaPercent - a.economiaPercent;
    });

    // Calcular resumo
    const ofertasAtivas = analyzedProducts.filter(p => !p.descartada);
    const summary = {
      totalOfertas: analyzedProducts.length,
      ofertasBoas: ofertasAtivas.filter((p) => p.boaOferta).length,
      economiaPotencial: ofertasAtivas.reduce((acc, p) => acc + (p.economiaMensal || 0), 0),
    };

    // Se incremental, mesclar com cache existente
    let finalOfertas = analyzedProducts;
    if (isIncremental) {
      try {
        const existingDados = supplier.dados_analise;
        if (existingDados) {
          const existingParsed = typeof existingDados === "string" ? JSON.parse(existingDados) : existingDados;
          if (existingParsed?.ofertas) {
            // Mapa: description+ean → oferta existente (chave para merge)
            const existingMap = new Map<string, any>();
            for (const o of existingParsed.ofertas) {
              const key = `${(o.description || o.produto || "").toLowerCase().trim()}_${o.ean || ""}`;
              existingMap.set(key, o);
            }
            // Atualizar/inserir analisados, manter os nao-analisados
            for (const a of analyzedProducts) {
              const key = `${(a.description || a.produto || "").toLowerCase().trim()}_${a.ean || ""}`;
              existingMap.set(key, a);
            }
            finalOfertas = Array.from(existingMap.values());
            console.log(`[OFERTAS-DIA] MERGE: ${analyzedProducts.length} re-analisados + ${existingMap.size - analyzedProducts.length} mantidos = ${finalOfertas.length} total`);
          }
        }
      } catch (err: any) {
        console.log(`[OFERTAS-DIA] MERGE fallback (erro no parse): ${err.message}`);
      }
    }

    // Re-sort merged results
    finalOfertas.sort((a, b) => {
      if (a.semEan && !b.semEan) return 1;
      if (!a.semEan && b.semEan) return -1;
      return (b.economiaPercent || 0) - (a.economiaPercent || 0);
    });

    // Recalcular resumo final
    const finalAtivas = finalOfertas.filter(p => !p.descartada);
    const finalSummary = {
      totalOfertas: finalOfertas.length,
      ofertasBoas: finalAtivas.filter((p) => p.boaOferta).length,
      economiaPotencial: finalAtivas.reduce((acc, p) => acc + (p.economiaMensal || 0), 0),
    };

    // Salvar resultado no banco
    const dadosAnalise = { ofertas: finalOfertas, summary: finalSummary };
    await updateSupplierAnalysis(supplierId, dadosAnalise, "analisado");
    
    console.log(`[OFERTAS-DIA] Background analysis complete for ${supplier.name}: ${finalOfertas.length} products, ${finalSummary.ofertasBoas} good offers`);
  } catch (err: any) {
    console.error(`[OFERTAS-DIA] Background analysis error for ${supplierId}:`, err.message);
    await updateSupplierAnalysis(supplierId, { error: err.message }, "erro");
  }
}

// ===== OFERTAS DO DIA - ANALISE DE PROMOCOES (LEITURA DO BANCO) =====
app.get("/api/ofertas-dia/analisar", async (req, res) => {
  try {
    const cnpj = req.query.cnpj as string;
    const forceRefresh = req.query.force === "true";
    const searchQuery = (req.query.q as string || "").trim().toLowerCase();

    if (!cnpj) {
      return res.status(400).json({ error: "cnpj é obrigatório." });
    }

    // 1. Buscar fornecedores do banco
    const rows = await getExternalSuppliers(cnpj);
    const todayUtc3 = new Date(Date.now() - 3 * 60 * 60 * 1000); // UTC-3 (Panambi/RS)
    const today = todayUtc3.toLocaleDateString('sv-SE'); // YYYY-MM-DD
    console.log(`[OFERTAS-DIA] GET suppliers: ${(rows as any[]).length} total for CNPJ ${cnpj}`);

    // Filtrar itens expirados: se item tem validade individual, usa ela; senão usa validade do fornecedor
    const activeSuppliers = (rows as any[]).map((r) => {
      if (!Array.isArray(r.products)) return r;
      const parsed = (() => { try { return JSON.parse(r.products); } catch { return []; } })();
      const filtered = parsed.filter((p: any) => {
        const v = p.validade || r.validade;
        return !v || v >= today;
      });
      return { ...r, products: JSON.stringify(filtered) };
    }).filter((r) => {
      const parsed = (() => { try { return JSON.parse(r.products); } catch { return []; } })();
      return parsed.length > 0;
    });
    console.log(`[OFERTAS-DIA] Active suppliers: ${activeSuppliers.length}, forceRefresh: ${forceRefresh}, searchQuery: "${searchQuery}"`);
    for (const s of activeSuppliers) {
      console.log(`[OFERTAS-DIA] - ${s.name}: status_analise=${s.status_analise}, hasDados=${!!s.dados_analise}, products_type=${typeof s.products}`);
    }

    // 2. Para cada fornecedor, usar cache ou analisar
    const allOfertas: any[] = [];

    for (const supplier of activeSuppliers) {
      // Se ja tem dados_analise e nao e forceRefresh, usar cache
      if (supplier.status_analise === "analisado" && supplier.dados_analise && !forceRefresh) {
        try {
          const dados = typeof supplier.dados_analise === "string" 
            ? JSON.parse(supplier.dados_analise) 
            : supplier.dados_analise;
          
          if (dados && dados.ofertas) {
            console.log(`[OFERTAS-DIA] ${supplier.name}: ${dados.ofertas.length} ofertas cacheadas. Sample:`, JSON.stringify(dados.ofertas[0] ? { produto: dados.ofertas[0].produto, description: dados.ofertas[0].description, ean: dados.ofertas[0].ean, fornecedor: dados.ofertas[0].fornecedor } : null));
            for (const oferta of dados.ofertas) {
              // Filtrar ofertas vencidas: usar validade do item ou do fornecedor
              const ofertaValidade = oferta.validade || supplier.validade;
              if (ofertaValidade && ofertaValidade < today) continue;
              allOfertas.push({
                ...oferta,
                fornecedorLista: supplier.name,
                validade: supplier.validade,
                fornecedorId: supplier.id,
              });
            }
          }
        } catch {}
      } else {
        // Se tem search query, pular fornecedores nao analisados (nao bloquear busca)
        if (searchQuery) {
          console.log(`[OFERTAS-DIA] Pulando fornecedor ${supplier.name} (nao analisado, search ativo)`);
          continue;
        }
        // Analisar em background (NAO bloquear a resposta) — dados ficarao disponiveis na proxima chamada
        console.log(`[OFERTAS-DIA] Disparando analise em background para ${supplier.name}...`);
        analisarFornecedorEmBackground(supplier.id, cnpj).catch(err => {
          console.error(`[OFERTAS-DIA] Erro na analise em background de ${supplier.name}:`, err.message);
        });
      }
    }

    // 3. Filtrar por query de busca (se fornecida) — busca por PALAVRAS (ignora stopwords)
    let filteredOfertas = allOfertas;
    if (searchQuery) {
      const STOPWORDS = new Set(["de", "do", "da", "dos", "das", "com", "para", "por", "sem", "ate", "ou", "e"]);
      const searchWords = searchQuery.split(/\s+/).filter(w => w.length >= 2 && !STOPWORDS.has(w));
      filteredOfertas = allOfertas.filter(o => {
        const text = [
          o.produto || "",
          o.description || "",
          o.ean || "",
          o.fornecedor || "",
          o.laboratorio || "",
          o.fornecedorLista || "",
        ].join(" ").toLowerCase();
        return searchWords.every(word => text.includes(word));
      });
    }

    // 4. Ordenar: com EAN primeiro, depois por economia
    filteredOfertas.sort((a, b) => {
      if (a.semEan && !b.semEan) return 1;
      if (!a.semEan && b.semEan) return -1;
      return (b.economiaPercent || 0) - (a.economiaPercent || 0);
    });
    console.log(`[OFERTAS-DIA] Filter result: ${filteredOfertas.length}/${allOfertas.length} ofertas para "${searchQuery}"`);

    // 4.1 Se busca vazia e termo parece EAN, buscar no Trier como referencia
    if (searchQuery && filteredOfertas.length === 0 && /^\d{7,14}$/.test(searchQuery.trim())) {
      console.log(`[OFERTAS-DIA] Nenhuma promocao para EAN ${searchQuery}. Buscando no Trier...`);
      try {
        const buscaRes = await fetch(`${CONFIG.FERRAMENTINHAS_API_URL}/api/produtos/buscar-lote`, {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ itens: [searchQuery.trim()] }),
        });
        if (buscaRes.ok) {
          const buscaData = await buscaRes.json();
          const resultados = buscaData?.resultados || {};
          const produtosEncontrados = resultados[searchQuery.trim()] || [];
          console.log(`[OFERTAS-DIA] Trier EAN: ${produtosEncontrados.length} resultados`);

          for (const p of produtosEncontrados.slice(0, 3)) {
            const product = {
              ean: p.ean || searchQuery.trim(),
              description: p.nom_produto || p.descricao || "",
              preco: 0,
              discountPercent: 0,
            };
            const analysis = await analisarUmProduto(product, cnpj);
            let preco = analysis.melhorPrecoHistorico || 0;
            filteredOfertas.push({
              ean: product.ean,
              produto: p.nom_produto || p.descricao || "",
              laboratorio: p.nom_laborat || "",
              fornecedor: "",
              fornecedorLista: "Historico",
              validade: "",
              preco,
              isReferencia: true,
              semEan: !p.ean,
              ...analysis,
            });
          }
        }
      } catch (err: any) {
        console.log(`[OFERTAS-DIA] Erro busca Trier EAN: ${err.message}`);
      }
    }

    // 4.2 Se busca vazia e termo parece texto, buscar no Trier como referencia
    if (searchQuery && filteredOfertas.length === 0 && !/^\d{7,14}$/.test(searchQuery.trim())) {
      const cleanSearch = searchQuery
        .replace(/\bgenérico\b/gi, "").replace(/\bgen\b/gi, "")
        .replace(/\b(sandoz|medley|biolab|ache|neo\s*quimica|cernosul|cervosul|EMS|Pfizer|Novartis|Eurofarma|Medley)\b/gi, "")
        .replace(/(\d+)\s*(cp|cpr|comprimido|caixa|cx|un|unid|rev|caps|capsulas|tabs|tabletes|gel|creme|pomada|solucao|gotas|spray|aerosol|inh)\b.*$/gi, "$1")
        .trim().substring(0, 40);
      if (cleanSearch.length >= 3) {
        console.log(`[OFERTAS-DIA] Nenhuma promocao para "${searchQuery}". Buscando no Trier...`);
        try {
          const buscaRes = await fetch(`${CONFIG.FERRAMENTINHAS_API_URL}/api/produtos/buscar-lote`, {
            method: "POST",
            headers: { "Content-Type": "application/json" },
            body: JSON.stringify({ itens: [cleanSearch] }),
          });
          if (buscaRes.ok) {
            const buscaData = await buscaRes.json();
            const resultados = buscaData?.resultados || {};
            const produtosEncontrados = resultados[cleanSearch] || [];
            console.log(`[OFERTAS-DIA] Trier texto: ${produtosEncontrados.length} resultados para "${cleanSearch}"`);

            for (const p of produtosEncontrados.slice(0, 3)) {
              const product = {
                ean: p.ean || "",
                description: p.nom_produto || p.descricao || "",
                preco: 0,
                discountPercent: 0,
              };
              const analysis = await analisarUmProduto(product, cnpj);
              let preco = analysis.melhorPrecoHistorico || 0;
              if (preco > 0) {
                filteredOfertas.push({
                  ean: product.ean,
                  produto: p.nom_produto || p.descricao || "",
                  laboratorio: p.nom_laborat || "",
                  fornecedor: "",
                  fornecedorLista: "Historico",
                  validade: "",
                  preco,
                  isReferencia: true,
                  semEan: !p.ean,
                  ...analysis,
                });
              }
            }
          }
        } catch (err: any) {
          console.log(`[OFERTAS-DIA] Erro busca Trier texto: ${err.message}`);
        }
      }
    }

    // 4. Resumo
    const summary = {
      totalOfertas: filteredOfertas.length,
      ofertasBoas: filteredOfertas.filter((p) => p.boaOferta).length,
      economiaPotencial: filteredOfertas.reduce((acc, p) => acc + (p.economiaMensal || 0), 0),
    };

    res.json({ ofertas: filteredOfertas, summary });
  } catch (err: any) {
    console.error("Erro ao analisar ofertas do dia:", err);
    res.status(500).json({ error: err.message });
  }
});

// ===== OFERTAS DO DIA - BUSCA POR DESCRICAO/EAN (REFERENCIA) =====
app.get("/api/ofertas-dia/buscar-produto", async (req, res) => {
  try {
    const q = (req.query.q as string || "").trim();
    if (!q || q.length < 3) {
      return res.json({ produtos: [] });
    }

    // Se termo numerico (EAN), buscar produto e expandir via descrição
    if (/^\d{7,14}$/.test(q)) {
      const eanRes = await fetch(`${CONFIG.FERRAMENTINHAS_API_URL}/api/produtos/buscar-por-ean/${q}`);
      if (!eanRes.ok) {
        return res.json({ produtos: [] });
      }
      const eanData = await eanRes.json();
      if (!eanData.encontrou || !eanData.produto) {
        return res.json({ produtos: [] });
      }
      const p = eanData.produto;
      const desc = p.nom_produto || "";

      let rawProdutos: any[] = [];

      // === FONTE PRIMÁRIA: similares/{ean} (já filtrado por estoque/atividade no lado da Ferramentinhas) ===
      try {
        const simRes = await fetch(`${CONFIG.FERRAMENTINHAS_API_URL}/api/produtos/similares/${q}`);
        if (simRes.ok) {
          const simData = await simRes.json();
          const sims = simData?.produtos || [];
          if (sims.length > 0) {
            rawProdutos = sims;
            console.log(`[OFERTAS-DIA] Busca EAN SIMILARES-PRIMARIO: ${sims.length} produtos via similares/${q}`);
          }
        }
      } catch (simErr: any) {
        console.log(`[OFERTAS-DIA] Busca EAN SIMILARES-PRIMARIO erro: ${simErr.message}`);
      }

      // === FALLBACK: buscar-lote por texto (só se similares retornou vazio ou sem DCB) ===
      if (rawProdutos.length === 0) {
        const cleanDesc = desc
          .replace(/\bgenérico\b/gi, "").replace(/\bgen\b/gi, "")
          .replace(/\b(sandoz|medley|biolab|ache|neo\s*quimica|cernosul|cervosul|EMS|Pfizer|Novartis|Eurofarma|Medley)\b/gi, "")
          .replace(/(\d+)\s*(cp|cpr|comprimido|caixa|cx|un|unid|rev|caps|capsulas|tabs|tabletes|gel|creme|pomada|solucao|gotas|spray|aerosol|inh)\b.*$/gi, "$1")
          .trim().substring(0, 40);

        if (cleanDesc.length >= 3) {
          try {
            const buscaRes = await fetch(`${CONFIG.FERRAMENTINHAS_API_URL}/api/produtos/buscar-lote`, {
              method: "POST",
              headers: { "Content-Type": "application/json" },
              body: JSON.stringify({ itens: [cleanDesc] }),
            });
            if (buscaRes.ok) {
              const buscaData = await buscaRes.json();
              const resultados = buscaData?.resultados || {};
              const cleanLower = cleanDesc.toLowerCase();
              const foundKey = Object.keys(resultados).find(k => k.toLowerCase() === cleanLower);
              rawProdutos = (foundKey ? resultados[foundKey] : []) as any[];
              console.log(`[OFERTAS-DIA] Busca EAN buscar-lote (fallback): ${rawProdutos.length} produtos via "${cleanDesc}"`);
            }
          } catch {}
        }
      }

      if (rawProdutos.length > 0) {
        // Agrupar por DCB + concentração
        const groups = new Map<string, any[]>();
        for (const rp of rawProdutos) {
          const dcb = rp.cod_dcb || "";
          const conc = rp.cod_concentracao || "";
          const key = `${dcb}_${conc}`;
          if (!groups.has(key)) groups.set(key, []);
          groups.get(key)!.push(rp);
        }

        // Filtrar grupos: manter apenas produtos com mesma unidade_apresentacao do EAN original
        const originalClass = classificarProduto(p);
        const gruposFiltrados: any[][] = [];
        for (const [, items] of groups) {
          if (originalClass.unidadeApresentacao !== null) {
            // EAN original tem unidade_apresentacao — filtrar pra manter só os equivalentes
            const filtrados = items.filter((rp: any) => {
              const cls = classificarProduto(rp);
              return cls.unidadeApresentacao === null || cls.unidadeApresentacao === originalClass.unidadeApresentacao;
            });
            if (filtrados.length > 0) gruposFiltrados.push(filtrados);
          } else {
            // EAN original sem unidade_apresentacao — manter grupo inteiro (fail-safe)
            gruposFiltrados.push(items);
          }
        }

        const produtos: any[] = [];
        for (const items of gruposFiltrados) {
          const withPrice = items.filter((rp: any) => rp.vlr_custopersonalizado && parseFloat(String(rp.vlr_custopersonalizado)) > 0);
          withPrice.sort((a: any, b: any) => parseFloat(String(a.vlr_custopersonalizado)) - parseFloat(String(b.vlr_custopersonalizado)));
          const best = withPrice[0] || items[0];
          const totalEstoque = items.reduce((sum: number, rp: any) => sum + (rp.qtd_estoque || 0), 0);
          const labs = [...new Set(items.map((rp: any) => (rp.nom_laborat || rp.laboratorio || "").trim()).filter(Boolean))];
          const eans = items
            .filter((rp: any) => rp.ean || rp.cod_barra)
            .map((rp: any) => ({
              ean: rp.ean || rp.cod_barra || "",
              lab: (rp.nom_laborat || rp.laboratorio || "").trim(),
              estoque: rp.qtd_estoque || 0,
              preco: rp.vlr_custopersonalizado ? parseFloat(String(rp.vlr_custopersonalizado)) : 0,
            }));
          produtos.push({
            ean: best.ean || best.cod_barra || q,
            descricao: best.nom_produto || best.descricao || desc,
            laboratorio: labs.join(", "),
            grupo: best.grupo || best.classificacao || "",
            estoque: totalEstoque,
            labs,
            eans,
            qtdLabs: labs.length,
            dcb: best.cod_dcb || "",
            codConcentracao: best.cod_concentracao || "",
            melhorPreco: withPrice.length > 0 ? parseFloat(String(withPrice[0].vlr_custopersonalizado)) : 0,
          });
        }
        console.log(`[OFERTAS-DIA] Busca EAN: ${produtos.length} grupo(s) para "${q}" (${rawProdutos.length} produtos)`);
        return res.json({ produtos });
      }

      // Fallback: retornar só o EAN sem expansão
      const produtos = [{
        ean: p.ean || q,
        descricao: desc,
        laboratorio: p.nom_laborat || "",
        grupo: p.grupo || p.classificacao || "",
        estoque: p.qtd_estoque || 0,
      }];
      console.log(`[OFERTAS-DIA] Busca EAN (sem expansão): ${produtos.length} resultado para "${q}"`);
      return res.json({ produtos });
    }

    // Senao, limpar termo e buscar por descricao via buscar-lote
    const cleanSearch = q
      .replace(/\bgenérico\b/gi, "")
      .replace(/\bgen\b/gi, "")
      .replace(/\b(sandoz|medley|biolab|ache|neo\s*quimica|cernosul|cervosul|EMS|Pfizer|Novartis|Eurofarma|Medley)\b/gi, "")
      .replace(/(\d+)\s*(cp|cpr|comprimido|caixa|cx|un|unid|rev|caps|capsulas|tabs|tabletes|gel|creme|pomada|solucao|gotas|spray|aerosol|inh)\b.*$/gi, "$1")
      .trim()
      .substring(0, 40);

    if (cleanSearch.length < 3) {
      return res.json({ produtos: [] });
    }

    const buscaRes = await fetch(`${CONFIG.FERRAMENTINHAS_API_URL}/api/produtos/buscar-lote`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ itens: [cleanSearch] }),
    });

    if (!buscaRes.ok) {
      return res.json({ produtos: [] });
    }

    const buscaData = await buscaRes.json();
    const resultados = buscaData?.resultados || {};
    const cleanLower = cleanSearch.toLowerCase();
    const foundKey = Object.keys(resultados).find(k => k.toLowerCase() === cleanLower);
    const rawProdutos = (foundKey ? resultados[foundKey] : []) as any[];

    // Agrupar por DCB + concentracao (mesmo principio ativo = grupo terapeutico)
    const groups = new Map<string, any[]>();
    for (const p of rawProdutos) {
      const dcb = p.cod_dcb || "";
      const conc = p.cod_concentracao || "";
      const key = `${dcb}_${conc}`;
      if (!groups.has(key)) groups.set(key, []);
      groups.get(key)!.push(p);
    }

    const produtos: any[] = [];
    for (const [key, items] of groups) {
      const [dcb, conc] = key.split("_");
      // Melhor preco (menor custo personalizado)
      const withPrice = items.filter((p: any) => p.vlr_custopersonalizado && parseFloat(String(p.vlr_custopersonalizado)) > 0);
      withPrice.sort((a: any, b: any) => parseFloat(String(a.vlr_custopersonalizado)) - parseFloat(String(b.vlr_custopersonalizado)));
      const best = withPrice[0] || items[0];
      const totalEstoque = items.reduce((sum: number, p: any) => sum + (p.qtd_estoque || 0), 0);
      const labs = [...new Set(items.map((p: any) => (p.nom_laborat || p.laboratorio || "").trim()).filter(Boolean))];
      // Todos os EANs do grupo (para vendas/compras consolidadas)
      const eans = items
        .filter((p: any) => p.ean || p.cod_barra)
        .map((p: any) => ({
          ean: p.ean || p.cod_barra || "",
          lab: (p.nom_laborat || p.laboratorio || "").trim(),
          estoque: p.qtd_estoque || 0,
          preco: p.vlr_custopersonalizado ? parseFloat(String(p.vlr_custopersonalizado)) : 0,
        }));

      produtos.push({
        ean: best.ean || best.cod_barra || "",
        descricao: best.nom_produto || best.descricao || "",
        laboratorio: labs.join(", "),
        grupo: best.grupo || best.classificacao || "",
        estoque: totalEstoque,
        labs: labs,
        eans: eans,
        qtdLabs: labs.length,
        dcb: dcb || undefined,
        codConcentracao: conc || undefined,
        melhorPreco: best.vlr_custopersonalizado ? parseFloat(String(best.vlr_custopersonalizado)) : 0,
      });
    }

    console.log(`[OFERTAS-DIA] Busca descricao: ${rawProdutos.length} produtos → ${produtos.length} grupos para "${cleanSearch}"`);
    res.json({ produtos });
  } catch (err: any) {
    console.error("Erro ao buscar produto:", err);
    res.status(500).json({ error: err.message });
  }
});

// ===== OFERTAS DO DIA - ANALISAR PRODUTO SELECIONADO (REFERENCIA) =====
app.post("/api/ofertas-dia/analisar-referencia", async (req, res) => {
  try {
    const { ean, descricao, cnpj, estoque, melhorPreco, labs, eans, dcb, codConcentracao } = req.body;
    if (!cnpj) {
      return res.status(400).json({ error: "cnpj é obrigatório." });
    }

    const product = {
      ean: ean || "",
      description: descricao || "",
      preco: 0,
      discountPercent: 0,
      cod_dcb: dcb || undefined,
      cod_concentracao: codConcentracao || undefined,
    };

    // Montar lista de EANs para buscar dados consolidados
    const eanList = (eans && eans.length > 0)
      ? eans
      : [{ ean: ean || "", lab: "", estoque: estoque || 0, preco: melhorPreco || 0 }];

    // Deduplicar EANs (mesmo EAN pode aparecer em mais de 1 lab)
    const uniqueEans = [...new Map(eanList.filter((e: any) => e.ean).map((e: any) => [e.ean, e])).values()];

    // Buscar vendas de TODOS os EANs UNICOS via vendas-resumo (agregado sem limite)
    // AGREGAR vendas e depois dividir por meses reais (mesmo método do SICF)
    const vendasBatch = await fetchVendasResumoBatch(uniqueEans.map((e: any) => e.ean));
    let totalVendasRaw = 0;
    let totalVendas = 0;
    let primeiraDataRef: Date | null = null;
    let ultimaDataRef: Date | null = null;
    const eansComMovimento: any[] = [];
    for (const e of uniqueEans as any[]) {
      const v = vendasBatch[e.ean];
      if (v && v.totalVendas > 0 && v.primeira && v.ultima) {
        eansComMovimento.push(e);
        totalVendasRaw += v.totalVendas;
        if (!primeiraDataRef || v.primeira < primeiraDataRef) primeiraDataRef = v.primeira;
        if (!ultimaDataRef || v.ultima > ultimaDataRef) ultimaDataRef = v.ultima;
      }
    }
    // Calcular mesesDiff das datas reais (mesmo método do SICF server.ts:3611)
    const mesesDiffRef = (primeiraDataRef && ultimaDataRef)
      ? Math.max(1, (ultimaDataRef.getFullYear() - primeiraDataRef.getFullYear()) * 12 + (ultimaDataRef.getMonth() - primeiraDataRef.getMonth()) + 1)
      : 4;
    totalVendas = Math.round(totalVendasRaw / mesesDiffRef);

    // Buscar compras-historico de TODOS os EANs UNICOS (não só os com movimentação)
    const allCompras: any[] = [];
    const comprasPromises = uniqueEans
      .map(async (e: any) => {
        try {
          const histRes = await fetch(`${CONFIG.FERRAMENTINHAS_API_URL}/api/produtos/compras-historico/${e.ean}?meses=6`);
          if (histRes.ok) {
            const histData = await histRes.json();
            const compras = histData?.compras || [];
            return compras.map((c: any) => ({
              preco: c.preco_unitario || c.preco || 0,
              precoTabela: c.preco_tabela || 0,
              fornecedor: c.fornecedor || "",
              data: c.data || "",
              quantidade: c.quantidade || 0,
              notaFiscal: c.nota_fiscal || null,
              laboratorio: e.lab || "",
              ean: e.ean,
            }));
          }
        } catch {}
        return [];
      });
    const comprasResults = await Promise.all(comprasPromises);
    for (const compras of comprasResults) {
      allCompras.push(...compras);
    }
    // Ordenar por data desc e pegar ultimas 10
    allCompras.sort((a: any, b: any) => (b.data || "").localeCompare(a.data || ""));
    const ultimasCompras = allCompras.slice(0, 10);

    // Melhor preco historico de todos os EANs
    let melhorPrecoHistorico = 0;
    let melhorFornecedorHistorico = "";
    for (const c of ultimasCompras) {
      const preco = c.preco_unitario || c.preco || 0;
      if (preco > 0 && (melhorPrecoHistorico === 0 || preco < melhorPrecoHistorico)) {
        melhorPrecoHistorico = preco;
        melhorFornecedorHistorico = c.fornecedor || "";
      }
    }

    // Chamar analisarUmProduto para SmartPed (com TODOS os EANs do grupo)
    const eanListStrs = eanList.map((e: any) => e.ean).filter(Boolean);
    const analysis = await analisarUmProduto(product, cnpj, eanListStrs);

    // Usar melhorPrecoHistorico como preco se nao tem preco de promocao
    let preco = melhorPrecoHistorico || melhorPreco || 0;

    // Enriquecer estoque: SEMPRE somar do eansList (não usar estoque do request)
    const estoqueFinal = eanList.reduce((sum: number, e: any) => sum + (e.estoque || 0), 0);

    const result = {
      ean: product.ean,
      produto: descricao,
      laboratorio: (labs && labs.length > 0) ? labs.join(", ") : "",
      fornecedor: "",
      fornecedorLista: "Historico",
      validade: "",
      preco,
      isReferencia: true,
      semEan: !product.ean,
      ...analysis,
      vendasMensais: totalVendas,
      estoqueTotal: estoqueFinal,
      estoqueMesmoEan: estoqueFinal,
      melhorPrecoHistorico,
      melhorFornecedorHistorico,
      comprasHistorico: ultimasCompras,
      ultimaCompra: ultimasCompras[0] || null,
      labs,
      eans: eanList,
      dcb,
      codConcentracao,
    };

    console.log(`[OFERTAS-DIA] Analise referencia: ${descricao} | preco=${preco} | SmartPed=${analysis.melhorPrecoSmartPed}`);
    res.json({ oferta: result });
  } catch (err: any) {
    console.error("Erro ao analisar referencia:", err);
    res.status(500).json({ error: err.message });
  }
});

// ===== INTEGRACAO SISTEMA ENCOMENDAS =====
const ENCOMENDAS_API_URL = process.env.ENCOMENDAS_API_URL || "https://encomenda-com-smartped-887122622666.us-east1.run.app";
const ENCOMENDAS_API_KEY = process.env.ENCOMENDAS_INTEGRATION_KEY || "";

// Proxy GET /api/integracao/encomendas/pendentes -> chama sistema encomendas
app.get("/api/integracao/encomendas/pendentes", async (req, res) => {
  try {
    // Usa a chave do .env diretamente (frontend não precisa enviar)
    const response = await fetch(`${ENCOMENDAS_API_URL}/api/integracao/encomendas/pendentes`, {
      method: "GET",
      headers: {
        "Content-Type": "application/json",
        "x-api-key": ENCOMENDAS_API_KEY
      }
    });

    const rawText = await response.text();
    console.log("[ENCOMENDAS PROXY] Status:", response.status, "Raw response (first 500 chars):", rawText.substring(0, 500));
    
    let data;
    try {
      data = JSON.parse(rawText);
    } catch (e) {
      throw new Error(`Resposta não é JSON válido. Status: ${response.status}. Início da resposta: ${rawText.substring(0, 200)}`);
    }
    
    if (!response.ok) {
      throw new Error(data.error || `Erro ${response.status} ao buscar encomendas`);
    }

    // Filtrar apenas status "Pendente" (garantia extra)
    const pendentes = (data.encomendas || data || []).filter((e: any) => e.status === "Pendente");

    res.json({ encomendas: pendentes });
  } catch (err: any) {
    console.error("Erro ao buscar encomendas pendentes:", err);
    res.status(500).json({ error: err.message });
  }
});

// Proxy POST /api/integracao/encomendas/confirmar-pedido -> chama sistema encomendas
app.post("/api/integracao/encomendas/confirmar-pedido", async (req, res) => {
  try {
    const { itens } = req.body;
    if (!itens || !Array.isArray(itens) || itens.length === 0) {
      return res.status(400).json({ error: "Array 'itens' é obrigatório." });
    }

    // O sistema externo espera POST em /api/integracao/encomendas/confirmar-pedido
    // com { itens: [{ id, fornecedor, dataPrevisao }] }
    const response = await fetch(`${ENCOMENDAS_API_URL}/api/integracao/encomendas/confirmar-pedido`, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        "x-api-key": ENCOMENDAS_API_KEY
      },
      body: JSON.stringify({ itens })
    });

    const data = await response.json();
    if (!response.ok) {
      throw new Error(data.error || `Erro ${response.status} ao confirmar encomendas`);
    }

    res.json({ sucesso: true, resultado: data });
  } catch (err: any) {
    console.error("Erro ao confirmar encomendas:", err);
    res.status(500).json({ error: err.message });
  }
});

// ===== ENCOMENDAS: Busca batch de ofertas para múltiplas encomendas =====
app.post("/api/encomendas/buscar-ofertas-batch", async (req, res) => {
  const logs: string[] = [];
  const ts = () => new Date().toLocaleString('pt-BR', { timeZone: 'America/Sao_Paulo', hour: '2-digit', minute: '2-digit', second: '2-digit' });
  const log = (msg: string) => { const m = `[${ts()}] ${msg}`; logs.push(m); console.log(`[ENCOMENDAS-BATCH] ${m}`); };
  try {
    const { encomendas, token, cnpj, useTestUrl = true, simulationMode = false, margemMinima = 0, disabledDistributors = [] } = req.body;
    const disabledDistSetEncomendas = new Set(disabledDistributors.map(Number));

    if (!encomendas || !Array.isArray(encomendas) || encomendas.length === 0) {
      return res.json({ results: [], logs: ["Nenhuma encomenda fornecida."] });
    }

    const actualToken = (token || CONFIG.SMARTPED_SANDBOX_TOKEN).trim();
    const isSandboxToken = actualToken === CONFIG.SMARTPED_SANDBOX_TOKEN;
    const apiCnpj = isSandboxToken ? "11111111111111" : (cnpj || CONFIG.SMARTPED_DEFAULT_CNPJ).trim().replace(/\D/g, "");
    const baseUrl = useTestUrl ? CONFIG.SMARTPED_SANDBOX_URL : CONFIG.SMARTPED_PRODUCTION_URL;

    log(`Iniciando busca batch para ${encomendas.length} encomendas...`);

    // Processa encomendas SEQUENCIALMENTE (1 por vez) para evitar rate limit da SmartPed
    const ENCOMENDA_CONCURRENCY = 1;
    const ENCOMENDA_DELAY_MS = 200;
    const results: any[] = [];
    for (let g = 0; g < encomendas.length; g += ENCOMENDA_CONCURRENCY) {
      const group = encomendas.slice(g, g + ENCOMENDA_CONCURRENCY);
      const batchResults = await Promise.all(group.map(async (enc: any, idx: number) => {
      const ean = enc.codigoBarras || enc.ean;
      const descricao = enc.item || enc.descricao || "";
      const quantidade = enc.quantidade || 1;
      const idEncomenda = enc.id;
      const cliente = enc.cliente || "";
      const telefone = enc.telefone || "";
      const observacoes = enc.observacoes || "";
      const fornecedorSugerido = enc.fornecedor || "";
      const dataPrevisao = enc.dataPrevisao || "";
      const dataHora = enc.data ? new Date(enc.data).toLocaleString('pt-BR', { dateStyle: 'short', timeStyle: 'short', timeZone: 'America/Sao_Paulo' }) : "";

      try {
        let ofertas: any[] = [];
        let searchLogs: string[] = [];

        if (ean && /^\d+$/.test(String(ean).trim())) {
          // Tem EAN - busca Condicoes/Ean + Condicoes/Molecula
          log(`[${idx}] Busca por EAN: ${ean} (${descricao.substring(0, 40)})`);
          const [eanRes, molRes] = await Promise.all([
            fetch(`${baseUrl}/api/Condicoes/Ean`, {
              method: "POST", headers: { "Content-Type": "application/json" },
              body: JSON.stringify({ Token: actualToken, parametros: { CnpjCLi: apiCnpj, Ean: ean, AceitaOntem: 1 } })
            }),
            fetch(`${baseUrl}/api/Condicoes/Molecula`, {
              method: "POST", headers: { "Content-Type": "application/json" },
              body: JSON.stringify({ Token: actualToken, parametros: { CnpjCLi: apiCnpj, Ean: ean, ConsideraTipo: 1 } })
            })
          ]);

          if (eanRes.ok) {
            const data = await eanRes.json();
            const retorno = data.Retorno || data.retorno;
            const items = retorno?.itens || retorno?.Itens || data.itens || data.Itens || [];
            const dists = retorno?.dists || retorno?.Dists || data.dists || data.Dists || [];
            for (const item of items) {
              const condicoes = item.Condicoes || item.condicoes || [];
              for (const cond of condicoes) {
                if (!cond.NomeDist && !cond.nomeDist) {
                  const distInfo = dists.find((d: any) => String(d.CodDist || d.codDist) === String(cond.CodDist || cond.codDist));
                  if (distInfo) cond.NomeDist = distInfo.NomeDist || distInfo.nomeDist || distInfo.Nome || distInfo.nome;
                }
              }
              ofertas.push(...condicoes);
            }
          }
          if (molRes.ok) {
            const data = await molRes.json();
            const retorno = data.Retorno || data.retorno;
            const items = retorno?.itens || retorno?.Itens || data.itens || data.Itens || [];
            const dists = retorno?.dists || retorno?.Dists || data.dists || data.Dists || [];
            for (const item of items) {
              const subs = item.Substitutos || item.substitutos || [];
              const conds = item.Condicoes || item.condicoes || [];
              for (const sub of subs) {
                if (!sub.NomeDist && !sub.nomeDist) {
                  const distInfo = dists.find((d: any) => String(d.CodDist || d.codDist) === String(sub.CodDist || sub.codDist));
                  if (distInfo) sub.NomeDist = distInfo.NomeDist || distInfo.nomeDist || distInfo.Nome || distInfo.nome;
                }
              }
              ofertas.push(...subs, ...conds);
            }
          }
        } else {
          // Sem EAN - busca por descrição via Produtos/Buscar
          log(`[${idx}] Busca por descrição: "${descricao.substring(0, 40)}..."`);
          const searchRes = await fetch(`${baseUrl}/api/Produtos/Buscar`, {
            method: "POST", headers: { "Content-Type": "application/json" },
            body: JSON.stringify({ Token: actualToken, parametros: { CnpjCLi: apiCnpj, Texto: descricao } })
          });

          if (searchRes.ok) {
            const searchData = await searchRes.json();
            const produtos = searchData.Retorno?.produtos || searchData.retorno?.produtos || searchData.produtos || [];
            // Para cada produto encontrado, busca condições
            const eans = [...new Set(produtos.map((p: any) => p.Ean || p.ean).filter(Boolean))];
            
            for (const foundEan of eans) {
              const [eanRes, molRes] = await Promise.all([
                fetch(`${baseUrl}/api/Condicoes/Ean`, {
                  method: "POST", headers: { "Content-Type": "application/json" },
                  body: JSON.stringify({ Token: actualToken, parametros: { CnpjCLi: apiCnpj, Ean: foundEan, AceitaOntem: 1 } })
                }),
                fetch(`${baseUrl}/api/Condicoes/Molecula`, {
                  method: "POST", headers: { "Content-Type": "application/json" },
                  body: JSON.stringify({ Token: actualToken, parametros: { CnpjCLi: apiCnpj, Ean: foundEan, ConsideraTipo: 1 } })
                })
              ]);

              if (eanRes.ok) {
                const data = await eanRes.json();
                const retorno = data.Retorno || data.retorno;
                const items = retorno?.itens || retorno?.Itens || data.itens || data.Itens || [];
                const distsEan = retorno?.dists || retorno?.Dists || data.dists || data.Dists || [];
                for (const item of items) {
                  const condicoes = item.Condicoes || item.condicoes || [];
                  for (const cond of condicoes) {
                    if (!cond.NomeDist && !cond.nomeDist) {
                      const distInfo = distsEan.find((d: any) => String(d.CodDist || d.codDist) === String(cond.CodDist || cond.codDist));
                      if (distInfo) cond.NomeDist = distInfo.NomeDist || distInfo.nomeDist || distInfo.Nome || distInfo.nome;
                    }
                  }
                  ofertas.push(...condicoes);
                }
              }
              if (molRes.ok) {
                const data = await molRes.json();
                const retorno = data.Retorno || data.retorno;
                const items = retorno?.itens || retorno?.Itens || data.itens || data.Itens || [];
                const distsMol = retorno?.dists || retorno?.Dists || data.dists || data.Dists || [];
                for (const item of items) {
                  const subs = item.Substitutos || item.substitutos || [];
                  const conds = item.Condicoes || item.condicoes || [];
                  for (const sub of subs) {
                    if (!sub.NomeDist && !sub.nomeDist) {
                      const distInfo = distsMol.find((d: any) => String(d.CodDist || d.codDist) === String(sub.CodDist || sub.codDist));
                      if (distInfo) sub.NomeDist = distInfo.NomeDist || distInfo.nomeDist || distInfo.Nome || distInfo.nome;
                    }
                  }
                  ofertas.push(...subs, ...conds);
                }
              }
            }
          }
        }

        // Filtrar apenas ofertas reais com estoque, EAN correto E distribuidoras habilitadas
        const eanLimpo = (ean || "").replace(/^0+/, "");
        const ofertasReais = ofertas.filter((o: any) => {
          const distName = String(o.NomeDist || o.nomeDist || o.distribuidora || "").trim().toLowerCase();
          const distId = Number(o.CodDist || o.codDist || 0);
          const est = o.Estoque !== undefined ? o.Estoque : (o.estoque !== undefined ? o.estoque : 9999);
          const ofertaEan = String(o.Ean || o.ean || "").replace(/^0+/, "");
          const eanCorreto = !eanLimpo || ofertaEan === eanLimpo;
          const distHabilitada = !disabledDistSetEncomendas.has(distId);
          return distId > 0 && distName !== "" && distName !== "nao encontrados" && distName !== "não encontrados" && est > 0 && eanCorreto && distHabilitada;
        });

        // Deduplicar por EAN+CodDist+Condicao+Prazo
        const seen = new Set();
        const ofertasDedup = ofertasReais.filter((o: any) => {
          const key = `${(o.Ean||o.ean||"")}_${o.CodDist||o.codDist||0}_${o.Condicao||o.condicao||""}_${o.Prazo||o.prazo||""}`;
          if (seen.has(key)) return false;
          seen.add(key);
          return true;
        });

        // Enriquecer CodProdutoDist: Substitutos do Molecula NÃO têm CodProdutoDist
        // Copiar de Condicoes/Ean que tenham mesmo EAN + CodDist
        const cpdMap = new Map<string, string>();
        for (const o of ofertasDedup) {
          const cpd = o.CodProdutoDist || o.codProdutoDist || "";
          const eanKey = String(o.Ean || o.ean || "").replace(/^0+/, "");
          const codDistKey = String(o.CodDist || o.codDist || "0");
          if (cpd && eanKey && codDistKey !== "0") {
            cpdMap.set(`${eanKey}_${codDistKey}`, cpd);
          }
        }
        for (const o of ofertasDedup) {
          if (!o.CodProdutoDist && !o.codProdutoDist) {
            const eanKey = String(o.Ean || o.ean || "").replace(/^0+/, "");
            const codDistKey = String(o.CodDist || o.codDist || "0");
            const match = cpdMap.get(`${eanKey}_${codDistKey}`);
            if (match) {
              o.CodProdutoDist = match;
              o.codProdutoDist = match;
            }
          }
        }

        // Ordenar: mesmo EAN primeiro, depois preço
        const originalEanClean = (ean || "").replace(/^0+/, "");
        ofertasDedup.sort((a: any, b: any) => {
          const aEan = (a.Ean||a.ean||"").replace(/^0+/, "");
          const bEan = (b.Ean||b.ean||"").replace(/^0+/, "");
          const aIsSame = aEan === originalEanClean;
          const bIsSame = bEan === originalEanClean;
          if (aIsSame && !bIsSame) return -1;
          if (!aIsSame && bIsSame) return 1;
          const aPrice = Number(a.PliquidoUni||a.pliquidoUni||a.Pliquido||a.pliquido||a.Preco||a.preco||0);
          const bPrice = Number(b.PliquidoUni||b.pliquidoUni||b.Pliquido||b.pliquido||b.Preco||b.preco||0);
          return aPrice - bPrice;
        });

        const ofertasNormalizadas = ofertasDedup.map((o: any) => {
          const cpd = o.CodProdutoDist || o.codProdutoDist || "";
          const cp = o.CodProduto || o.codProduto || "";
          return {
            ...o,
            distribuidora: o.NomeDist || o.nomeDist || o.distribuidora || "",
            codDist: o.CodDist || o.codDist || 0,
            precoLiquido: o.PliquidoUni || o.pliquidoUni || o.Pliquido || o.pliquido || o.precoLiquido || 0,
            preco: o.Preco || o.preco || 0,
            estoque: o.Estoque !== undefined ? o.Estoque : (o.estoque !== undefined ? o.estoque : 0),
            condicao: o.Condicao || o.condicao || "FIXA",
            prazo: o.Prazo !== undefined ? o.Prazo : (o.prazo !== undefined ? o.prazo : 0),
            ean: o.Ean || o.ean || "",
            codProdutoDist: cpd,
            codProduto: cp || cpd || "",
          };
        });

        return {
          encomenda: enc,
          idEncomenda,
          ean,
          descricao,
          quantidade,
          cliente,
          telefone,
          observacoes,
          fornecedorSugerido,
          dataPrevisao,
          dataHora,
          ofertas: ofertasNormalizadas,
          logs: searchLogs,
          temOfertas: ofertasNormalizadas.length > 0,
          selecionada: ofertasNormalizadas.length > 0,
          ofertaSelecionada: ofertasNormalizadas.length > 0 ? ofertasNormalizadas[0] : null,
          qtdSelecionada: quantidade
        };

      } catch (err: any) {
        log(`[${idx}] ERRO: ${err.message}`);
        return {
          encomenda: enc,
          idEncomenda,
          ean,
          descricao,
          quantidade,
          cliente,
          telefone,
          observacoes,
          fornecedorSugerido,
          dataPrevisao,
          dataHora,
          ofertas: [],
          logs: [],
          temOfertas: false,
          selecionada: false,
          ofertaSelecionada: null,
          qtdSelecionada: quantidade,
          erro: err.message
        };
      }
    }));
      results.push(...batchResults);
      if (g + ENCOMENDA_CONCURRENCY < encomendas.length) {
        await new Promise(r => setTimeout(r, ENCOMENDA_DELAY_MS));
      }
    }

    log(`Busca batch concluída. ${results.filter(r => r.temOfertas).length}/${results.length} com ofertas.`);
    res.json({ results, logs });

  } catch (err: any) {
    console.error("Erro batch encomendas:", err);
    res.status(500).json({ error: err.message, logs });
  }
});

// ===== SYNC PRODUTOS (async + timeout + cache) =====
function fetchWithTimeout(url: string, options: RequestInit, timeoutMs = 10000): Promise<Response> {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), timeoutMs);
  return fetch(url, { ...options, signal: controller.signal }).finally(() => clearTimeout(timer));
}

async function fetchWithRetry(url: string, options: RequestInit, timeoutMs = 15000, maxRetries = 1): Promise<Response> {
  let lastError: Error | null = null;
  for (let attempt = 0; attempt <= maxRetries; attempt++) {
    try {
      return await fetchWithTimeout(url, options, timeoutMs);
    } catch (err: any) {
      lastError = err;
      if (attempt < maxRetries) {
        console.log(`[RETRY] Tentativa ${attempt + 1} falhou para ${url}: ${err.message}. Retry em 2s...`);
        await new Promise(r => setTimeout(r, 2000));
      }
    }
  }
  throw lastError;
}

async function fetchVendasResumo(ean: string): Promise<{ totalVendas: number; primeira: Date | null; ultima: Date | null }> {
  try {
    const vendasRes = await fetchWithRetry(`${CONFIG.FERRAMENTINHAS_API_URL}/api/chatbot/produto/vendas-resumo/${ean}`, {}, 10000, 1).catch(() => null);
    if (vendasRes?.ok) {
      const vendasData = await vendasRes.json().catch(() => ({}));
      const d = vendasData?.data || {};
      const totalVendas = Number(d.total_qtd || 0);
      if (totalVendas === 0 || !d.primeira_venda || !d.ultima_venda) {
        return { totalVendas: 0, primeira: null, ultima: null };
      }
      const parseData = (s: string) => {
        const parts = (s || "").split("/");
        return new Date(parseInt(parts[2] || "2026"), parseInt(parts[1] || "1") - 1, parseInt(parts[0] || "1"));
      };
      const primeira = parseData(d.primeira_venda);
      const ultima = parseData(d.ultima_venda);
      if (isNaN(primeira.getTime()) || isNaN(ultima.getTime())) {
        return { totalVendas: 0, primeira: null, ultima: null };
      }
      return { totalVendas, primeira, ultima };
    }
  } catch {}
  return { totalVendas: 0, primeira: null, ultima: null };
}

async function fetchVendasResumoBatch(eans: string[]): Promise<Record<string, { totalVendas: number; primeira: Date | null; ultima: Date | null }>> {
  const result: Record<string, { totalVendas: number; primeira: Date | null; ultima: Date | null }> = {};
  const MAX_BATCH = 40;
  const parseData = (s: string) => {
    const parts = (s || "").split("/");
    return new Date(parseInt(parts[2] || "2026"), parseInt(parts[1] || "1") - 1, parseInt(parts[0] || "1"));
  };
  const uniqueEans = Array.from(new Set(eans.filter(e => e && e.trim())));
  for (let i = 0; i < uniqueEans.length; i += MAX_BATCH) {
    const lote = uniqueEans.slice(i, i + MAX_BATCH);
    try {
      const response = await fetch(`${CONFIG.FERRAMENTINHAS_API_URL}/api/chatbot/produto/vendas-resumo/batch`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ eans: lote }),
        signal: AbortSignal.timeout(30000)
      });
      if (!response.ok) { for (const ean of lote) result[ean] = { totalVendas: 0, primeira: null, ultima: null }; continue; }
      const data = await response.json();
      for (const ean of lote) {
        const d = data[ean];
        if (!d || !d.total_qtd || !d.primeira_venda || !d.ultima_venda) { result[ean] = { totalVendas: 0, primeira: null, ultima: null }; continue; }
        const primeira = parseData(d.primeira_venda);
        const ultima = parseData(d.ultima_venda);
        if (isNaN(primeira.getTime()) || isNaN(ultima.getTime())) { result[ean] = { totalVendas: 0, primeira: null, ultima: null }; continue; }
        result[ean] = { totalVendas: Number(d.total_qtd), primeira, ultima };
      }
    } catch {
      for (const ean of lote) result[ean] = { totalVendas: 0, primeira: null, ultima: null };
    }
  }
  return result;
}

const SYNC_STATE = { running: false, logs: [] as string[], totalSync: 0, totalPrincipios: 0, totalLancamentos: 0, totalSugestoes: 0 };

async function syncEnrichAndSave(ean: string, token: string, cnpj: string, lanc: any, sug: any, logs: string[]) {
  const [eanRes, molRes] = await Promise.all([
    fetchWithTimeout(`${CONFIG.SMARTPED_PRODUCTION_URL}/api/Condicoes/Ean`, {
      method: "POST", headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ Token: token, parametros: { CnpjCLi: cnpj, Ean: ean, AceitaOntem: 1 } })
    }),
    fetchWithTimeout(`${CONFIG.SMARTPED_PRODUCTION_URL}/api/Condicoes/Molecula`, {
      method: "POST", headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ Token: token, parametros: { CnpjCLi: cnpj, Ean: ean, ConsideraTipo: 1 } })
    })
  ]);
  const eanData = eanRes.ok ? await eanRes.json() : null;
  const molData = molRes.ok ? await molRes.json() : null;
  const itemPedido = eanData?.Retorno?.itens?.[0]?.ItemPedido || molData?.Retorno?.itens?.[0]?.ItemPedido || eanData?.Retorno?.Itens?.[0]?.ItemPedido || molData?.Retorno?.Itens?.[0]?.ItemPedido;
  if (!itemPedido) { logs.push(`[SYNC SKIP] EAN ${ean}: sem ItemPedido`); return; }
  let dcb = itemPedido?.CodDCB || itemPedido?.cod_dcb || itemPedido?.DCB || "";
  let molecula = itemPedido?.Molecula || itemPedido?.molecula || itemPedido?.PrincipioAtivo || "";
  let concentracao = itemPedido?.Concentracao || itemPedido?.concentracao || "";
  let apresentacao = itemPedido?.Apresentacao || itemPedido?.apresentacao || "";
  let tipoItem = itemPedido?.TipoItem || itemPedido?.tipoItem || itemPedido?.tipo_item || "";
  if (molecula && molecula.includes("_")) {
    const partes = molecula.split("_");
    if (partes.length >= 1 && !molecula.includes(" ")) molecula = partes[0].trim();
    if (partes.length >= 2 && !concentracao) concentracao = partes[1].trim();
    if (partes.length >= 3 && !tipoItem) tipoItem = partes[2].trim();
  }
  const descricaoReal = itemPedido?.Descricao || itemPedido?.descricao || lanc?.Descricao || sug?.DescricaoProduto_Idi || sug?.Descricao || "";
  if ((!molecula || molecula.trim() === "") && descricaoReal) molecula = getMoleculeBase(descricaoReal);
  if (!molecula && !dcb) { logs.push(`[SYNC SKIP] EAN ${ean}: sem molecula/DCB`); return; }
  await saveProdutoCache({ ean, descricao: descricaoReal, laboratorio: itemPedido?.Laboratorio || lanc?.Laboratorio || sug?.Laboratorio || "", dcb, molecula, concentracao, apresentacao, tipoItem });
}

async function runSyncInBackground(token: string, cnpj: string, tipo?: string) {
  SYNC_STATE.running = true; SYNC_STATE.logs = []; SYNC_STATE.totalSync = 0; SYNC_STATE.totalPrincipios = 0; SYNC_STATE.totalLancamentos = 0; SYNC_STATE.totalSugestoes = 0;
  const logs = SYNC_STATE.logs;
  try {
    if (!tipo || tipo === "principios" || tipo === "all") {
      logs.push("[SYNC] Buscando principios ativos...");
      try {
        const r = await fetchWithTimeout(`${CONFIG.SMARTPED_PRODUCTION_URL}/api/Produtos/ListarPrincipios`, { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ Token: token, parametros: { CnpjCLi: cnpj } }) });
        if (r.ok) { const d = await r.json(); const p = d.Retorno?.Principios || d.Principios || []; logs.push(`[SYNC] ${p.length} principios encontrados.`); SYNC_STATE.totalPrincipios = p.length; } else { logs.push(`[SYNC ERRO] ListarPrincipios: HTTP ${r.status}`); }
      } catch (e: any) { logs.push(`[SYNC ERRO] ListarPrincipios: ${e.name === "AbortError" ? "timeout 10s" : e.message}`); }
    }
    if (!tipo || tipo === "lancamentos" || tipo === "all") {
      logs.push("[SYNC] Buscando lancamentos...");
      try {
        const r = await fetchWithTimeout(`${CONFIG.SMARTPED_PRODUCTION_URL}/api/Produtos/Lancamentos`, { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ Token: token, parametros: { CnpjCLi: cnpj } }) });
        if (r.ok) { const d = await r.json(); const items = d.Retorno || d || []; logs.push(`[SYNC] ${items.length} lancamentos encontrados.`);
          for (let i = 0; i < items.length; i++) { if (i > 0 && i % 10 === 0) logs.push(`[SYNC PROGRESS] Lancamentos: ${i}/${items.length} (${SYNC_STATE.totalSync} salvos)`); const ean = cleanEan(items[i].Ean || items[i].ean); if (!ean) continue; try { await syncEnrichAndSave(ean, token, cnpj, items[i], null, logs); SYNC_STATE.totalSync++; } catch (e: any) { logs.push(`[SYNC ERRO] EAN ${ean}: ${e.name === "AbortError" ? "timeout" : e.message}`); } }
        } else { logs.push(`[SYNC ERRO] Lancamentos: HTTP ${r.status}`); }
      } catch (e: any) { logs.push(`[SYNC ERRO] Lancamentos: ${e.name === "AbortError" ? "timeout 10s" : e.message}`); }
    }
    if (!tipo || tipo === "sugestoes" || tipo === "all") {
      logs.push("[SYNC] Buscando sugestoes...");
      try {
        const r = await fetchWithTimeout(`${CONFIG.SMARTPED_PRODUCTION_URL}/api/Condicoes/Sugestoes`, { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ Token: token, parametros: { CnpjCLi: cnpj } }) });
        if (r.ok) { const d = await r.json(); const items = d.Retorno || d || []; logs.push(`[SYNC] ${items.length} sugestoes encontradas.`);
          for (let i = 0; i < items.length; i++) { if (i > 0 && i % 10 === 0) logs.push(`[SYNC PROGRESS] Sugestoes: ${i}/${items.length} (${SYNC_STATE.totalSync} salvos)`); const ean = cleanEan(items[i].CodBarra_idi || items[i].CodBarra || items[i].ean); if (!ean) continue; try { await syncEnrichAndSave(ean, token, cnpj, null, items[i], logs); SYNC_STATE.totalSync++; } catch (e: any) { logs.push(`[SYNC ERRO] EAN ${ean}: ${e.name === "AbortError" ? "timeout" : e.message}`); } }
        } else { logs.push(`[SYNC ERRO] Sugestoes: HTTP ${r.status}`); }
      } catch (e: any) { logs.push(`[SYNC ERRO] Sugestoes: ${e.name === "AbortError" ? "timeout 10s" : e.message}`); }
    }
    const count = await countProdutosCache(); logs.push(`[SYNC CONCLUIDO] Cache: ${count} | Sincronizados: ${SYNC_STATE.totalSync}`);
  } catch (err: any) { logs.push(`[SYNC ERRO FATAL] ${err.message}`); } finally { SYNC_STATE.running = false; }
}

app.post("/api/sync-produtos", async (req, res) => {
  const { token, cnpj, tipo } = req.body;
  if (!token || !cnpj) return res.status(400).json({ error: "token e cnpj obrigatorios." });
  if (SYNC_STATE.running) return res.status(409).json({ error: "Sync ja esta em andamento.", logs: SYNC_STATE.logs.slice(-10) });
  runSyncInBackground(token, cnpj, tipo);
  res.json({ sucesso: true, message: "Sync iniciado em background. Consulte /api/sync-status para acompanhar." });
});

app.get("/api/sync-status", (_req, res) => {
  res.json({ running: SYNC_STATE.running, totalSync: SYNC_STATE.totalSync, totalPrincipios: SYNC_STATE.totalPrincipios, totalLancamentos: SYNC_STATE.totalLancamentos, logs: SYNC_STATE.logs.slice(-20) });
});

// ===== SYNC PRICES DIARIO (DESATIVADO — código removido) =====
// Para reativar: implementar runPriceSync, checkAndRunPriceSync e endpoints /api/sync-prices
// Ver LLM_CONTEXT.md seção 4.21 para contexto completo

// ===== ENDPOINT SYNC-PRICES DESATIVADO =====
app.post("/api/sync-prices", async (req, res) => {
  res.status(503).json({ error: "DESATIVADO: sincronizacao de precos desligada. Use /api/sync-eans-fixed para popular EANs fixos." });
});

app.get("/api/sync-prices/status", async (_req, res) => {
  res.json({ running: false, totalSaved: 0, totalCache: 0, lastSync: null, logs: ["DESATIVADO: use /api/sync-eans-fixed"] });
});

// ===== SYNC EANS FIXOS (rodar UMA VEZ local — popula eans_fixos no Turso) =====
app.post("/api/sync-eans-fixed", async (req, res) => {
  const { token, cnpj } = req.body;
  if (!token || !cnpj) return res.status(400).json({ error: "token e cnpj obrigatorios." });

  try {
    const baseUrl = CONFIG.SMARTPED_PRODUCTION_URL;
    const sugRes = await fetchWithTimeout(`${baseUrl}/api/Condicoes/Sugestoes`, {
      method: "POST", headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ Token: token, parametros: { CnpjCLi: cnpj } })
    });
    if (!sugRes.ok) return res.status(502).json({ error: `Sugestoes HTTP ${sugRes.status}` });

    const sugData = await sugRes.json();
    const sugestoes = Array.isArray(sugData.Retorno) ? sugData.Retorno : (sugData.Retorno?.itens || sugData.Retorno?.Itens || (Array.isArray(sugData) ? sugData : []));
    if (!Array.isArray(sugestoes) || sugestoes.length === 0) {
      return res.status(502).json({ error: `Sugestoes vazio: ${sugData.Mensagem || "Retorno null"}` });
    }

    const eansWithMeta = sugestoes.map((s: any) => ({
      ean: cleanEan(s.CodBarra_idi || s.CodBarra || s.ean),
      descricao: s.DescricaoProduto_Idi || s.Descricao || null,
      laboratorio: s.Laboratorio || null,
      codDist: s.CodDist_Iof || null,
      nomeDist: s.Nome_Dpe || null,
    })).filter((e: any) => !!e.ean);

    const uniqueEans = [...new Set(eansWithMeta.map((e: any) => e.ean))];
    await saveEansFixos(eansWithMeta);
    const total = await countEansFixos();

    res.json({ sucesso: true, sugestoes: sugestoes.length, eansUnicos: uniqueEans.length, totalNoTurso: total });
  } catch (err: any) {
    res.status(500).json({ error: err.message });
  }
});

app.get("/api/sync-eans-fixed/status", async (_req, res) => {
  const total = await countEansFixos();
  res.json({ total });
});

app.get("/api/precos-cache-stats", async (_req, res) => {
  const count = await countPrecosCache();
  const lastSync = await getLastPrecoSync();
  res.json({ count, lastSync });
});

app.get("/api/precos-cache/:ean", async (req, res) => {
  const ean = req.params.ean;
  if (!ean) return res.status(400).json({ error: "EAN obrigatorio." });
  const rows = await getPrecoCacheByEan(ean);
  // Normalizar snake_case → camelCase — regra #28/#32 AGENTS.md
  const precos = rows.map((r: any) => ({
    ean: r.ean,
    codDist: r.cod_dist,
    condicao: r.condicao,
    prazo: r.prazo,
    precoLiquido: r.preco_liquido,
    estoque: r.estoque,
    nomeDist: r.nome_dist,
    qtdMin: r.qtd_min,
    tipoItem: r.tipo_item,
    ultimaAtualizacao: r.ultima_atualizacao
  }));
  res.json({ ean, total: precos.length, precos });
});

app.get("/api/precos-cache", async (req, res) => {
  const limit = Math.min(parseInt(req.query.limit as string) || 50, 200);
  const rows = await listPrecosCache(limit);
  // Normalizar snake_case → camelCase — regra #28/#32 AGENTS.md
  const precos = rows.map((r: any) => ({
    ean: r.ean,
    codDist: r.cod_dist,
    condicao: r.condicao,
    prazo: r.prazo,
    precoLiquido: r.preco_liquido,
    estoque: r.estoque,
    nomeDist: r.nome_dist,
    qtdMin: r.qtd_min,
    tipoItem: r.tipo_item,
    ultimaAtualizacao: r.ultima_atualizacao
  }));
  res.json({ total: precos.length, precos });
});

// ===== JOB AUTOMATICO 10H (DESATIVADO — runPriceSync comentado) =====
/*
function checkAndRunPriceSync() {
  const now = new Date();
  const hour = now.getHours();
  const minute = now.getMinutes();
  if (hour === 10 && minute === 0 && !PRICE_SYNC_STATE.running) {
    const token = CONFIG.SMARTPED_PRODUCTION_TOKEN;
    const cnpj = "13408443000168";
    if (token) {
      console.log("[AUTO PRICE-SYNC] Iniciando sync automatico de precos as 10h...");
      runPriceSync(token, cnpj);
            }
          }
}
setInterval(checkAndRunPriceSync, 60 * 1000);
*/

// Main Optimization Endpoint
app.post("/api/optimize", async (req, res) => {
  const logs: string[] = [];
  const _phaseStart = Date.now();
  let _p1 = 0, _p2 = 0, _p3 = 0, _p4 = 0, _p5 = 0, _p6 = 0;
  try {
    const {
      fileContent,
      token,
      cnpj: reqCnpj,
      margemMinima = 0.01,
      tipos = ["G", "O"],
      permitirSemEstoque = false,
      useTestUrl = true,
      simulationMode = false,
      customProductionUrl,
      customTestUrl,
      customEndpoint,
      disabledDistributors = [],
      externalSuppliers = [],
      cortesRecentes = {},
      alertaProfarma48h = true,
      alertaConfirmarQtdCaixaMaster = true,
      bypassMargemRuptura = true
    } = req.body;

    logs.push(`[INÃCIO] Iniciando processo de otimizaÃ§Ã£o.`);
    logs.push(`[PARÃ‚METROS] Margem mÃ­nima: R$ ${margemMinima.toFixed(2)}, Tipos aceitos: [${tipos.join(", ")}], Exigir estoque: ${!permitirSemEstoque ? 'Sim' : 'NÃ£o'}, Sandbox: ${useTestUrl ? 'Sim' : 'NÃ£o'}, SimulaÃ§Ã£o: ${simulationMode ? 'Sim' : 'NÃ£o'}, Dist. Desabilitados: ${disabledDistributors.length}`);
    logs.push(`[DEBUG-DIST] Dist. desabilitados (codDist): [${disabledDistributors.join(", ")}]`);
    const disabledDistSet = new Set(disabledDistributors);

    if (!fileContent) {
      logs.push(`[ERRO] O conteÃºdo do arquivo estÃ¡ vazio ou nÃ£o foi enviado.`);
      return res.status(400).json({ error: "O conteÃºdo do arquivo Ã© obrigatÃ³rio.", logs });
    }

    const tiposAceitos = new Set((tipos as string[]).map(t => t.trim().toUpperCase()));
    const exigirEstoque = !permitirSemEstoque;

    // Parse SICF Content
    logs.push(`[PARSER] Iniciando anÃ¡lise do arquivo SICF carregado...`);
    let cleanedContent = fileContent || "";
    if (cleanedContent.startsWith("\ufeff")) {
      cleanedContent = cleanedContent.substring(1);
      logs.push(`[PARSER] Removido indicador de codificaÃ§Ã£o Byte Order Mark (BOM) do inÃ­cio do arquivo.`);
    }
    const lines = cleanedContent.replace(/\r\n/g, "\n").split("\n");
    let headerLine = "";
    let footerLine = "";
    const parsedItems: any[] = [];
    let detectedCnpj = "";

    for (let i = 0; i < lines.length; i++) {
      const line = lines[i].trim();
      if (!line) continue;

      const parts = line.split(";");
      const tipo = parts[0] ? parts[0].trim() : "";

      if (tipo === "1") {
        headerLine = line;
        detectedCnpj = parts[1] || "";
        logs.push(`[PARSER] Linha de cabeÃ§alho (tipo 1) detectada. CNPJ do arquivo: ${detectedCnpj}`);
      } else if (tipo === "9") {
        footerLine = line;
        logs.push(`[PARSER] Linha de rodapÃ© (tipo 9) detectada.`);
      } else if (tipo === "2") {
        if (parts.length < 7) {
          logs.push(`[PARSER] [Aviso] Linha ${i + 1} de dados (tipo 2) ignorada por conter menos de 7 campos.`);
          continue;
        }
        const [_, ean, qtd, codInterno, descricao, laboratorio, precoStr] = parts;
        const cleanedEan = cleanEan(ean);
        parsedItems.push({
          ean: cleanedEan,
          qtd: qtd.trim(),
          codInterno: codInterno.trim(),
          descricao: descricao.trim(),
          laboratorio: laboratorio.trim(),
          precoOriginal: parseFloat(precoStr.replace(",", ".")),
          originalLine: line,
          lineIndex: i
        });
        if (cleanedEan && descricao.trim()) {
          EAN_DATABASE[cleanedEan] = {
            ...EAN_DATABASE[cleanedEan],
            descricao: descricao.trim(),
            laboratorio: laboratorio.trim() || "Geral",
            precoOriginal: parseFloat(precoStr.replace(",", ".")) || 10.0
          };
        }
      }
    }

    logs.push(`[PARSER] ConcluÃ­do. Total de itens de dados (tipo 2) encontrados: ${parsedItems.length}`);
    _p1 = Date.now() - _phaseStart;
    logs.push(`[FASE-1-PARSE] ${_p1}ms`);
    console.log(`[FASE-1-PARSE] ${_p1}ms`);

    if (!headerLine) {
      logs.push(`[ERRO] CabeÃ§alho do arquivo (tipo 1) nÃ£o foi encontrado.`);
      return res.status(400).json({ error: "Arquivo SICF invÃ¡lido: cabeÃ§alho (tipo 1) nÃ£o encontrado.", logs });
    }

    const finalCnpj = reqCnpj || detectedCnpj;
    if (!finalCnpj) {
      logs.push(`[ERRO] NÃ£o foi possÃ­vel encontrar nenhum CNPJ do cliente.`);
      return res.status(400).json({ error: "CNPJ do cliente nÃ£o fornecido e nÃ£o encontrado no cabeÃ§alho do arquivo.", logs });
    }

    // Buscar fornecedores bloqueados por falta de estoque nos últimos 2 dias
    const blockedSuppliers = new Map<string, Set<number>>();
    try {
      const d = getDb();
      if (d) {
        const hoje = new Date();
        const doisDiasAtras = new Date(hoje.getTime() - 2 * 24 * 60 * 60 * 1000);
        const fmt = (d: Date) => `${String(d.getDate()).padStart(2, '0')}/${String(d.getMonth() + 1).padStart(2, '0')}/${d.getFullYear()}`;
        const dataIni = fmt(doisDiasAtras);
        const dataFim = fmt(hoje);
        
        let itens: any[];
        if (USE_TURSO) {
          itens = await d.all(
            `SELECT ean, cod_dist, motivo FROM itens_confirmados 
             WHERE cnpj = ? AND status = 'nao_confirmado' 
             AND data_confirmacao BETWEEN ? AND ?`,
            finalCnpj.replace(/\D/g, ""), dataIni, dataFim
          );
        } else {
          itens = d.prepare(
            `SELECT ean, cod_dist, motivo FROM itens_confirmados 
             WHERE cnpj = ? AND status = 'nao_confirmado' 
             AND data_confirmacao BETWEEN ? AND ?`
          ).all(finalCnpj.replace(/\D/g, ""), dataIni, dataFim);
        }

        const motivoFalta = ["estoque", "falta", "corte", "sem estoque", "indispon"];
        for (const item of itens) {
          const motivo = String(item.motivo || "").toLowerCase();
          if (motivoFalta.some(m => motivo.includes(m)) && !motivo.includes("minimo") && !motivo.includes("pedido m")) {
            const ean = cleanEan(item.ean);
            const codDist = Number(item.cod_dist);
            if (ean && codDist > 0) {
              if (!blockedSuppliers.has(ean)) blockedSuppliers.set(ean, new Set());
              blockedSuppliers.get(ean)!.add(codDist);
            }
          }
        }
        if (blockedSuppliers.size > 0) {
          let total = 0;
          blockedSuppliers.forEach(s => total += s.size);
          logs.push(`[BLOQUEIO FALTA] ${blockedSuppliers.size} EANs com ${total} fornecedores bloqueados por falta nos últimos 2 dias`);
        }
      }
    } catch (err: any) {
      logs.push(`[AVISO] Falha ao buscar fornecedores bloqueados: ${err.message}`);
    }

    const uniqueEans = Array.from(new Set(parsedItems.map(item => item.ean)));
    logs.push(`[PROCESSAMENTO] Total de EANs Ãºnicos para consulta: ${uniqueEans.length}`);

    // PrÃ©-carregar similares de mercado via BATCH (uma sÃ³ chamada pra todos os EANs)
    logs.push(`[PROCESSAMENTO] PrÃ©-carregando dicionÃ¡rio dinÃ¢mico de similares de mercado para ${uniqueEans.length} EANs (batch)...`);
    const marketSimilarMap: Record<string, any[]> = {};
    const _f2Start = Date.now();
    try {
      const startTimeSimilar = Date.now();
      const batchResult = await fetchSimilarGenericsBatch(uniqueEans);
      for (const ean of uniqueEans) {
        const eanClean = cleanEan(ean);
        marketSimilarMap[eanClean] = batchResult[eanClean] || [];
      }
      const totalSimilares = Object.values(marketSimilarMap).reduce((sum, arr) => sum + arr.length, 0);
      logs.push(`[PROCESSAMENTO] Sucesso! Similares de mercado carregados via batch em ${Date.now() - startTimeSimilar}ms. ${uniqueEans.length} EANs, ${totalSimilares} produtos encontrados.`);
    } catch (err: any) {
      logs.push(`[AVISO] Falha ao prÃ©-carregar produtos similares de mercado via batch: ${err.message}`);
    }
    _p2 = Date.now() - _f2Start;
    logs.push(`[FASE-2-SIMILARES-BATCH] ${_p2}ms`);
    console.log(`[FASE-2-SIMILARES-BATCH] ${_p2}ms`);

    // Gerar conjunto estendido de EANs a serem cotados (EAN original + equivalentes locais + similares de mercado)
    const parsedItemsByEan = new Map(parsedItems.map(it => [cleanEan(it.ean), it]));
    const eansToQuoteSet = new Set<string>();
    uniqueEans.forEach(ean => {
      const orig = cleanEan(ean);
      if (!orig) return;
      
      eansToQuoteSet.add(orig);

      // Localizar descriÃ§Ã£o do item para enriquecimento estÃ¡tico local
      const itemPedidoOriginal = parsedItemsByEan.get(orig);
      const descStr = itemPedidoOriginal ? itemPedidoOriginal.descricao : "";
      
      // Enriquecer com equivalentes locais (DicionÃ¡rio EstÃ¡tico)
      const localEquivs = getLocalEquivalents(orig, descStr);
      localEquivs.forEach(eq => {
        const eqClean = cleanEan(eq);
        if (eqClean) {
          const dbRec = getEanDatabaseRecord(eqClean);
          if (!dbRec || !itemPedidoOriginal || validateSwapEquivalence(itemPedidoOriginal, dbRec)) {
            eansToQuoteSet.add(eqClean);
          }
        }
      });

      // Enriquecer com os similares de mercado da API (Ferramentinhas) com trava estrita de equivalÃªncia
      const apiSimilars = marketSimilarMap[orig] || [];
      apiSimilars.forEach(s => {
        const bar = cleanEan(s.cod_barra || s.Ean || s.ean || "");
        if (bar) {
          if (!itemPedidoOriginal || validateSwapEquivalence(itemPedidoOriginal, s)) {
            eansToQuoteSet.add(bar);
          }
        }
      });
    });

    // ===== EXPANSÃO DE EANs VIA BUSCAR-LOTE (Ferramentinhas) =====
    // Para cada item do SICF, buscar mais EANs equivalentes via princípio ativo + dosagem
    // Genéricos: encontra todos os EANs de outros labs
    // Éticos/Ref/Perfumaria: encontra o mesmo produto com EANs diferentes
    {
      const DESCRICOES_PARA_BUSCAR: Array<{ item: any; termo: string }> = [];
      for (const item of parsedItems) {
        const origEan = cleanEan(item.ean);
        if (!item.descricao) continue;
        const descLimpa = (item.descricao || "")
          .replace(/[\u{1F300}-\u{1FAFF}\u{2600}-\u{27BF}\u{FE0F}\u{200D}]/gu, "")
          .replace(/[\uDCA5\uDCA4\uDCA6\uFFFD]/g, "")
          .replace(/\\udca5|\\udca4|\\udca6|\\ufffd/gi, "")
          .replace(/\bgenérico\b/gi, "").replace(/\bgen\b/gi, "")
          .replace(/\b(sandoz|medley|biolab|ache|delta|hypera|torrent|germed|prati|discus|tommasi|sanofi|bayer|merck|abbot|abbott|vitamedic|farmoquimica|cimed|união quimica|alten|bussie|pharlab|diméd|dimed|anfarm|emdeplast|geolab|mylan|legrand|teuto|pague|rosário|andromeda|biochemiker|phoenix|medquimica|cristália|cristalia|neo\s*quimica|e\.jefferson|e jefferson|ems)\b/gi, "")
          .trim();
        const words = descLimpa.split(/\s+/).filter((w: string) => w.length >= 3 && !/^\d+$/.test(w));
        if (words.length === 0) continue;
        const termo = words.join(" ");
        if (termo.length < 3) continue;
        DESCRICOES_PARA_BUSCAR.push({ item, termo });
      }

      if (DESCRICOES_PARA_BUSCAR.length > 0) {
        logs.push(`[BUSCAR-LOTE-SICF] Buscando ${DESCRICOES_PARA_BUSCAR.length} termos via buscar-lote para expansão de EANs...`);
        try {
          const termos = DESCRICOES_PARA_BUSCAR.map(d => d.termo);
          const buscaRes = await fetch(`${CONFIG.FERRAMENTINHAS_API_URL}/api/produtos/buscar-lote`, {
            method: "POST",
            headers: { "Content-Type": "application/json" },
            body: JSON.stringify({ itens: termos }),
          });
          if (buscaRes.ok) {
            const buscaData = await buscaRes.json();
            const resultados = buscaData?.resultados || {};
            let novosEansAdicionados = 0;
            let rejeitados = 0;
            for (const desc of DESCRICOES_PARA_BUSCAR) {
              const prods = resultados[desc.termo] || [];
              for (const p of prods) {
                const ean = cleanEan(p.ean || p.cod_barra || "");
                if (ean && !eansToQuoteSet.has(ean)) {
                  if (!mesmaApresentacao(desc.item, p)) { rejeitados++; continue; }
                  const dbRec = getEanDatabaseRecord(ean);
                  if (!dbRec || validateSwapEquivalence(desc.item, p)) {
                    eansToQuoteSet.add(ean);
                    novosEansAdicionados++;
                  } else {
                    rejeitados++;
                  }
                }
              }
            }
            logs.push(`[BUSCAR-LOTE-SICF] ${novosEansAdicionados} novos EANs adicionados via buscar-lote (${rejeitados} rejeitados por apresentação/equivalência).`);
          }
        } catch (err: any) {
          logs.push(`[BUSCAR-LOTE-SICF] Erro: ${err.message}`);
        }
      }
    }

    const eansToQuote = Array.from(eansToQuoteSet);
    logs.push(`[MOTOR AGRUPAMENTO] Ampliado o leque de cotaÃ§Ã£o de ${uniqueEans.length} EANs originais para ${eansToQuote.length} EANs totais de concorrentes.`);

    // ===== MAPA DE CATEGORIA POR EAN (reaproveita marketSimilarMap já buscado) =====
    // Para cada EAN original do SICF, tenta encontrar o próprio produto na lista de similares
    // (o endpoint /similares/{ean} retorna TODOS os produtos com mesma DCB+concentração,
    // incluindo o próprio, desde que tenha estoque/demanda). Match por EAN normalizado via cleanEan.
    // Se o item original não tem estoque/demand, não aparece na lista → fica sem entrada no map.
    const eanCategoriaMap = new Map<string, CategoriaProduto>();
    for (const origEan of uniqueEans) {
      const eanClean = cleanEan(origEan);
      if (!eanClean) continue;
      const similares = marketSimilarMap[eanClean] || [];
      const selfProduct = similares.find((s: any) => cleanEan(s.ean || s.cod_barra || "") === eanClean);
      if (selfProduct) {
        const cat = resolveCategoria(selfProduct);
        if (cat !== "outros") {
          eanCategoriaMap.set(eanClean, cat);
        }
      }
    }
    if (eanCategoriaMap.size > 0) {
      const cats = [...eanCategoriaMap.values()].reduce((acc, c) => { acc[c] = (acc[c] || 0) + 1; return acc; }, {} as Record<string, number>);
      logs.push(`[CATEGORIA] eanCategoriaMap populado: ${eanCategoriaMap.size} EANs (${Object.entries(cats).map(([k, v]) => `${k}:${v}`).join(", ")})`);
    }

    // ===== WHATSAPP: Regras de Laboratório =====
    // Carregar regras ativas para o CNPJ e marcar itens que vão direto pro WhatsApp
    const whatsappRulesAtivas: any[] = [];
    const whatsappItemsMap = new Map<number, { rule: any; item: any }>(); // lineIndex → {rule, item}
    try {
      const regras = await getWhatsAppRules(finalCnpj);
      if (regras.length > 0) {
        logs.push(`[WHATSAPP-RULES] ${regras.length} regra(s) ativa(s) encontrada(s) para CNPJ ${finalCnpj}`);
        for (const item of parsedItems) {
          const labUpper = (item.laboratorio || "").toUpperCase().trim();
          for (const rule of regras) {
            const termoUpper = (rule.termo_filtro || rule.termoFiltro || "").toUpperCase().trim();
            if (!termoUpper) continue;
            // Match: laboratório contém o termo OU termo contém o laboratório
            // Blindagem: labUpper não-vazio para evitar falso-positivo de .includes("")
            const matches = labUpper !== "" && (labUpper.includes(termoUpper) || termoUpper.includes(labUpper));
            if (!matches) continue;

            // Verificar filtro por tipo — fonte primária: eanCategoriaMap (Ferramentinhas via marketSimilarMap)
            const tipoFiltro = rule.tipo_filtro || rule.tipoFiltro || "todos";
            const origEanForCat = cleanEan(item.ean);
            const catFromMap = eanCategoriaMap.get(origEanForCat);

            let isGenerico: boolean;
            let isSimilar: boolean;
            if (catFromMap) {
              // Dado confiável da Ferramentinhas (match por EAN exato na lista de similares)
              isGenerico = catFromMap === "generico";
              isSimilar = catFromMap === "similar";
            } else {
              // Fallback: regex de texto na descrição SICF quando a Ferramentinhas não tem o dado
              // (item sem estoque/demanda, ou EAN não encontrado no banco Trier)
              const descUpper = (item.descricao || "").toUpperCase();
              isGenerico = descUpper.includes("(G)") || descUpper.includes("GENERICO") || descUpper.includes("GENÉRICO");
              isSimilar = descUpper.includes("(S)") || descUpper.includes("SIMILAR");
            }

            let tipoMatch = true;
            if (tipoFiltro === "genericos") tipoMatch = isGenerico;
            else if (tipoFiltro === "eticos") tipoMatch = !isGenerico && !isSimilar;

            if (tipoMatch) {
              whatsappItemsMap.set(item.lineIndex, { rule, item });
              logs.push(`[WHATSAPP-RULES] Item "${item.descricao}" (lab: ${item.laboratorio}) → regra "${rule.nome_regra || rule.nomeRegra}" (${tipoFiltro})`);
              break; // Uma regra por item
            }
          }
        }
        // NÃO remover EANs WhatsApp do eansToQuote — precisamos consultar SmartPed para ter dados de comparação
        if (whatsappItemsMap.size > 0) {
          logs.push(`[WHATSAPP-RULES] ${whatsappItemsMap.size} item(s) com regra WhatsApp. EANs mantidos na cotação SmartPed para dados de referência.`);
        }
      }
    } catch (err: any) {
      logs.push(`[WHATSAPP-RULES] Erro ao carregar regras: ${err.message}`);
    }

    // Set de nomes de laboratórios que têm regra WhatsApp (para filtrar substitutos)
    const whatsappLabNames = new Set<string>();
    for (const { rule } of whatsappItemsMap.values()) {
      const termo = (rule.termo_filtro || rule.termoFiltro || "").toUpperCase().trim();
      if (termo) whatsappLabNames.add(termo);
    }
    if (whatsappLabNames.size > 0) {
      logs.push(`[WHATSAPP-RULES] Labs com regra WhatsApp: ${[...whatsappLabNames].join(", ")}`);
    }

    const apiResponses: Record<string, any> = {};
    
    // Helper function to resolve description and laboratory of any EAN by scanning all retrieved API responses (ItemPedido and Substitutos)
    function findDescAndLabFromApiResponses(targetEan: string): { descricao: string; laboratorio: string } | null {
      if (!targetEan) return null;
      const cleanTarget = cleanEan(targetEan);
      if (!cleanTarget) return null;
      
      // 1. Direct check in apiResponses[cleanTarget].ItemPedido
      const resp = apiResponses[cleanTarget];
      if (resp?.ItemPedido) {
        const d = resp.ItemPedido.Descricao || resp.ItemPedido.descricao;
        const l = resp.ItemPedido.Laboratorio || resp.ItemPedido.laboratorio;
        if (d) {
          return { descricao: d, laboratorio: l || "GENÃ‰RICO" };
        }
      }

      // 2. Comprehensive scan of all parent ItemPedidos and child Substitutos across all responses
      for (const origEan of Object.keys(apiResponses)) {
        const entry = apiResponses[origEan];
        if (entry) {
          // Check parent ItemPedido
          if (entry.ItemPedido && cleanEan(entry.ItemPedido.Ean || entry.ItemPedido.ean) === cleanTarget) {
            const d = entry.ItemPedido.Descricao || entry.ItemPedido.descricao;
            if (d) {
              return { 
                descricao: d, 
                laboratorio: entry.ItemPedido.Laboratorio || entry.ItemPedido.laboratorio || "GENÃ‰RICO" 
              };
            }
          }
          // Check children Substitutos
          const subs = entry.Substitutos || entry.substitutos || [];
          for (const sub of subs) {
            if (cleanEan(sub.Ean || sub.ean || sub.CodBarra || sub.codBarra) === cleanTarget) {
              const d = sub.Descricao || sub.descricao;
              if (d) {
                return { 
                  descricao: d, 
                  laboratorio: sub.Laboratorio || sub.laboratorio || "GENÃ‰RICO" 
                };
              }
            }
          }
        }
      }
      return null;
    }

    // Build lookup index: EAN → {descricao, laboratorio} from apiResponses (built once, used per-item)
    function buildDescLabIndex(): Map<string, { descricao: string; laboratorio: string }> {
      const index = new Map<string, { descricao: string; laboratorio: string }>();
      for (const origEan of Object.keys(apiResponses)) {
        const entry = apiResponses[origEan];
        if (!entry) continue;
        // Priority 1: direct ItemPedido match
        if (entry.ItemPedido) {
          const ean = cleanEan(entry.ItemPedido.Ean || entry.ItemPedido.ean);
          if (ean && !index.has(ean)) {
            const d = entry.ItemPedido.Descricao || entry.ItemPedido.descricao;
            if (d) index.set(ean, { descricao: d, laboratorio: entry.ItemPedido.Laboratorio || entry.ItemPedido.laboratorio || "GENÃ‰RICO" });
          }
        }
        // Priority 2: Substitutos
        const subs = entry.Substitutos || entry.substitutos || [];
        for (const sub of subs) {
          const ean = cleanEan(sub.Ean || sub.ean || sub.CodBarra || sub.codBarra);
          if (ean && !index.has(ean)) {
            const d = sub.Descricao || sub.descricao;
            if (d) index.set(ean, { descricao: d, laboratorio: sub.Laboratorio || sub.laboratorio || "GENÃ‰RICO" });
          }
        }
      }
      return index;
    }

    const allMinimos: any[] = [];

    if (simulationMode) {
      logs.push(`[MOCK] Modo SimulaÃ§Ã£o Ativo. Usando banco de dados simulado local.`);
      for (const ean of eansToQuote) {
        if (MOCK_API_DATABASE[ean]) {
          logs.push(`[MOCK] Carregado produto real mapeado para o EAN ${ean} (${MOCK_API_DATABASE[ean].ItemPedido?.Descricao || ""}).`);
          apiResponses[ean] = MOCK_API_DATABASE[ean];
        } else {
          logs.push(`[MOCK] EAN ${ean} nÃ£o encontrado no banco simulado.`);
        }
      }
    } else {
      // Call Real SmartPed API
      let baseUrl = useTestUrl ? CONFIG.SMARTPED_SANDBOX_URL : CONFIG.SMARTPED_PRODUCTION_URL;
      if (useTestUrl && customTestUrl) {
        baseUrl = customTestUrl;
      } else if (!useTestUrl && customProductionUrl) {
        baseUrl = customProductionUrl;
      }

      let endpointPath = "/api/Condicoes/Molecula";
      if (customEndpoint) {
        endpointPath = customEndpoint;
      }

      const actualToken = (token || CONFIG.SMARTPED_SANDBOX_TOKEN).trim(); 

      // Se o token for o padrÃ£o de teste, usamos o CNPJ padrÃ£o associado "11111111111111"
      const isSandboxToken = actualToken === CONFIG.SMARTPED_SANDBOX_TOKEN;
      const apiCnpj = isSandboxToken ? "11111111111111" : finalCnpj.trim().replace(/\D/g, "");

      logs.push(`[API CONEXÃƒO] Iniciando conexÃµes reais com o servidor SmartPed.`);
      logs.push(`[API CONEXÃƒO] URL Base: ${baseUrl}`);
      logs.push(`[API CONEXÃƒO] Endpoint Rota: ${endpointPath}`);
      if (isSandboxToken) {
        logs.push(`[API CONEXÃƒO] Token de teste padrÃ£o detectado. Utilizando o CNPJ padrÃ£o "11111111111111" associado para evitar erros de vÃ­nculo.`);
      } else {
        logs.push(`[API CONEXÃƒO] CNPJ de HomologaÃ§Ã£o/ProduÃ§Ã£o utilizado: ${apiCnpj} (Original: ${finalCnpj})`);
      }
      logs.push(`[API CONEXÃƒO] Token de Acesso: ${actualToken.substring(0, 6)}...`);

      const _f3Start = Date.now();
      // Batch call (SmartPed endpoint CondicoesMolecula handles multiple EANs separated by comma)
      // Chunk EANs in batches of 10 — COM CACHE L1+L2
      // Sequencial (CONCURRENCY=1) para evitar rate limit da SmartPed
      const batchSize = 10;
      const eanMolCacheKey = (ean: string) => cacheKey("Condicoes/Molecula", ean, actualToken, apiCnpj);
      const eanEanCacheKey = (ean: string) => cacheKey("Condicoes/Ean", ean, actualToken, apiCnpj);

      // 1. Checar cache para todos os EANs — batch (uma única query no Turso)
      const eanCacheKeys = eansToQuote.map(ean => eanMolCacheKey(ean));
      const cachedBatch = await getFromCacheBatch(eanCacheKeys);
      const eansComCache: string[] = [];
      const eansSemCache: string[] = [];
      for (const ean of eansToQuote) {
        const key = eanMolCacheKey(ean);
        if (cachedBatch[key]) {
          eansComCache.push(ean);
          apiResponses[ean] = cachedBatch[key];
        } else {
          eansSemCache.push(ean);
        }
      }
      logs.push(`[API CACHE] ${eansComCache.length} EANs obtidos do cache local. ${eansSemCache.length} precisam de consulta à API.`);
      console.log(`[API CACHE] HIT: ${eansComCache.length} | MISS: ${eansSemCache.length} | Total: ${eansToQuote.length}`);

      // 2. Apenas EANs sem cache vão para a API — PARALELO com concorrência 3
      async function processBatch(batch: string[], batchNum: number, totalBatches: number) {
        logs.push(`[API SOLICITAÃ‡ÃƒO] Enviando lote com ${batch.length} EANs (Lote ${batchNum} de ${totalBatches})...`);
        
        try {
          const startTime = Date.now();
          
          const pMolecula = fetchWithRetry(`${baseUrl.replace(/\/$/, "")}/${endpointPath.replace(/^\//, "")}`, {
            method: "POST",
            headers: {
              "Content-Type": "application/json",
              "Accept": "application/json",
              "User-Agent": "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36"
            },
            body: JSON.stringify({
              Token: actualToken,
              parametros: { CnpjCLi: apiCnpj, Ean: batch.join(","), ConsideraTipo: 1 }
            })
          }, 15000, 1);

          const pEan = fetchWithRetry(`${baseUrl.replace(/\/$/, "")}/api/Condicoes/Ean`, {
            method: "POST",
            headers: {
              "Content-Type": "application/json",
              "Accept": "application/json",
              "User-Agent": "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36"
            },
            body: JSON.stringify({
              Token: actualToken,
              parametros: { CnpjCLi: apiCnpj, Ean: batch.join(","), AceitaOntem: 1 }
            })
          }, 15000, 1);

          const _redeStart = Date.now();
          const [responseMolecula, responseEan] = await Promise.all([pMolecula, pEan]);
          const _redeMs = Date.now() - _redeStart;
          _condTotalMs += _redeMs;
          _condLotesChamados++;
          logs.push(`[TIMING-CONDICOES] Lote ${batchNum}: rede levou ${_redeMs}ms`);
          const duration = Date.now() - startTime;
          logs.push(`[API RESPOSTA] Lotes respondidos em ${duration}ms (Molecula: ${responseMolecula.status}, Ean: ${responseEan.status}).`);

          const isHtmlMolecula = (responseMolecula.headers.get("content-type") || "").includes("text/html");
          
          if (!responseMolecula.ok || isHtmlMolecula) {
            throw new Error(`Servidor retornou erro ou HTML na rota Molecula (Status ${responseMolecula.status})`);
          }

          const resDataMolecula = await responseMolecula.json();
          const resDataEan = await responseEan.json().catch(() => ({})); // Ignora falhas na rota Ean
          
          const itensMolecula = resDataMolecula.Retorno?.itens || resDataMolecula.Retorno?.Itens || resDataMolecula.itens || resDataMolecula.Itens || [];
          const itensEan = resDataEan.Retorno?.itens || resDataEan.Retorno?.Itens || resDataEan.itens || resDataEan.Itens || [];

          const distsMap: Record<number, string> = {};
          const allDists = [
            ...(resDataMolecula.Retorno?.dists || []),
            ...(resDataEan.Retorno?.dists || [])
          ];
          for (const d of allDists) {
            if (d.CodDist && d.NomeDist) distsMap[d.CodDist] = d.NomeDist;
          }
          
          enrichDistribuidoresFromPayload(resDataMolecula);
          enrichDistribuidoresFromPayload(resDataEan);
          
          const minimosFromApi = [
            ...(resDataMolecula.Retorno?.minimos || resDataMolecula.Retorno?.Minimos || []),
            ...(resDataEan.Retorno?.minimos || resDataEan.Retorno?.Minimos || [])
          ];
          
          minimosFromApi.forEach((m: any) => {
            if (m.CodDist && !m.NomeDist) {
               m.NomeDist = distsMap[m.CodDist] || DISTRIBUIDORAS_MAP[m.CodDist];
            }
          });
          
          allMinimos.push(...minimosFromApi);
          updateMinimosCache(minimosFromApi);

          logs.push(`[API RESPOSTA] Sucesso! Molecula retornou ${itensMolecula.length} molÃ©culas. Condicoes/Ean retornou ${itensEan.length} itens.`);

          for (const entry of itensMolecula) {
            const itemPedido = entry.ItemPedido || entry.itemPedido || entry;
            const eanRaw = String(itemPedido?.Ean || itemPedido?.ean || entry.Ean || entry.ean || "");
            const eanResp = cleanEan(eanRaw);
            if (eanResp) {
              const subsRaw = entry.Substitutos || entry.substitutos || [];
              const substitutos: any[] = [];
              subsRaw.forEach((sub: any) => {
                const conds = sub.Condicoes || sub.condicoes || [];
                if (conds.length === 0) {
                  substitutos.push({
                    ...sub,
                    Ean: sub.Ean || sub.ean || sub.EanProduto_Idi || sub.eanProduto_Idi || "",
                    Descricao: sub.Descricao || sub.descricao || sub.DescricaoProduto_Idi || sub.descricaoProduto_Idi || "",
                    Laboratorio: sub.Laboratorio || sub.laboratorio || ""
                  });
                } else {
                  conds.forEach((cond: any) => {
                    substitutos.push({
                      ...cond,
                      Ean: sub.Ean || sub.ean || sub.EanProduto_Idi || sub.eanProduto_Idi || cond.Ean || cond.ean || "",
                      Descricao: sub.Descricao || sub.descricao || sub.DescricaoProduto_Idi || sub.descricaoProduto_Idi || cond.Descricao || cond.descricao || "",
                      Laboratorio: sub.Laboratorio || sub.laboratorio || cond.Laboratorio || cond.laboratorio || ""
                    });
                  });
                }
              });
              substitutos.forEach((s: any) => {
                 if (s.CodDist && !s.NomeDist) s.NomeDist = distsMap[s.CodDist];
              });
               apiResponses[eanResp] = {
                  ItemPedido: itemPedido,
                  Substitutos: substitutos,
                  Condicoes: (apiResponses[eanResp] && apiResponses[eanResp].Condicoes) || []
               };
            }
          }

          for (const entry of itensEan) {
             const conds = entry.Condicoes || entry.condicoes || [];
             if (conds.length > 0) {
                 const firstCond = conds[0];
                 const eanRaw = String(firstCond.Ean || firstCond.ean || entry.CodBarra || "");
                 const ean = cleanEan(eanRaw);
                 if (ean) {
                    // Capture PMC and factory table price from the conditions list
                    let pmcFromConds = 0;
                    for (const c of conds) {
                       const p = extractPmc(c);
                       if (p > 0) {
                          pmcFromConds = p;
                          break;
                       }
                    }
                    if (pmcFromConds === 0) {
                       pmcFromConds = extractPmc(entry);
                    }

                    let precoFromConds = 0;
                    for (const c of conds) {
                       const pr = extractTablePrice(c);
                       if (pr > 0) {
                          precoFromConds = pr;
                          break;
                       }
                    }
                    if (!precoFromConds) {
                       precoFromConds = extractTablePrice(entry) || firstCond.Preco;
                    }

                    const descUpper = (entry.Descricao || "").toUpperCase();
                    const inferredTipo = (descUpper.includes("(G)") || descUpper.includes("GENERICO") || descUpper.includes("GENÃ‰RICO")) ? "G" : "O";
                    const finalTipoItem = entry.TipoItem || entry.tipoItem || firstCond.TipoItem || firstCond.tipoItem || inferredTipo;

                    if (!apiResponses[ean]) {
                       apiResponses[ean] = {
                          ItemPedido: { 
                             Ean: ean, 
                             Descricao: entry.Descricao, 
                             Laboratorio: entry.Laboratorio, 
                             Pliquido: firstCond.Preco,
                             PMC: pmcFromConds,
                             Preco: precoFromConds,
                             TipoItem: finalTipoItem
                          },
                          Substitutos: [],
                          Condicoes: []
                       };
                    } else {
                       if (!apiResponses[ean].ItemPedido) {
                          apiResponses[ean].ItemPedido = {};
                       }
                       const existingIp = apiResponses[ean].ItemPedido;
                       if (pmcFromConds > 0 && !extractPmc(existingIp)) {
                          existingIp.PMC = pmcFromConds;
                       }
                       if (precoFromConds > 0 && !extractTablePrice(existingIp)) {
                          existingIp.Preco = precoFromConds;
                       }
                       if (!existingIp.TipoItem && !existingIp.tipoItem) {
                          const existingDescUpper = (existingIp.Descricao || entry.Descricao || "").toUpperCase();
                          const existingInferredTipo = (existingDescUpper.includes("(G)") || existingDescUpper.includes("GENERICO") || existingDescUpper.includes("GENÃ‰RICO")) ? "G" : "O";
                          existingIp.TipoItem = existingIp.TipoItem || existingIp.tipoItem || entry.TipoItem || entry.tipoItem || firstCond.TipoItem || firstCond.tipoItem || existingInferredTipo;
                       }
                    }
                    conds.forEach((c: any) => {
                       if (c.CodDist && !c.NomeDist) c.NomeDist = distsMap[c.CodDist];
                    });
                    apiResponses[ean].Condicoes = conds;
                 }
             }
          }

           // Fallback para EANs que nÃ£o obtiveram resposta da API
           // IMPORTANTE: NUNCA usar dados mock — buscar via API individual se necessário
           for (const ean of batch) {
             if (!apiResponses[ean]) {
               logs.push(`[API] EAN ${ean} sem resposta do batch. Será enriquecido no ENRICH-POST-BATCH.`);
             }
           }

          // 3. Salvar respostas no cache L1+L2 para reuso futuro
          for (const ean of batch) {
            if (apiResponses[ean]) {
              setInCache(eanMolCacheKey(ean), apiResponses[ean]);
            }
          }
        } catch (error: any) {
          console.error("Erro consultando lote da API SmartPed:", error.message);
          logs.push(`[API ALERTA CRÃTICO] Falha de conexÃ£o: ${error.message}. EANs serÃ£o enriquecidos no ENRICH-POST-BATCH.`);
        }
      }

      // Executar batches SEQUENCIALMENTE (1 por vez) para evitar rate limit da SmartPed
      // Cada batch: Chamada Molecula + Chamada Ean em paralelo (regra #12 AGENTS.md)
      let _condTotalMs = 0;
      let _condLotesChamados = 0;
      const CONCURRENCY = 1;
      const BATCH_DELAY_MS = 200;
      const totalBatches = Math.ceil(eansSemCache.length / batchSize);
      for (let g = 0; g < totalBatches; g += CONCURRENCY) {
        const group = [];
        for (let b = g; b < Math.min(g + CONCURRENCY, totalBatches); b++) {
          const batchStart = b * batchSize;
          const batch = eansSemCache.slice(batchStart, batchStart + batchSize);
          group.push(processBatch(batch, b + 1, totalBatches));
        }
        await Promise.all(group);
        if (g + CONCURRENCY < totalBatches) {
          await new Promise(r => setTimeout(r, BATCH_DELAY_MS));
        }
      }
      logs.push(`[TIMING-CONDICOES-MOLECULA] ${_condTotalMs}ms somados em ${_condLotesChamados} lotes de até ${batchSize} EANs (${eansToQuote.length} EANs no total)`);
      console.log(`[TIMING-CONDICOES-MOLECULA] ${_condTotalMs}ms somados em ${_condLotesChamados} lotes de até ${batchSize} EANs (${eansToQuote.length} EANs no total)`);
      _p3 = Date.now() - _f3Start;
      logs.push(`[FASE-3-CONDICOES] ${_p3}ms`);
      console.log(`[FASE-3-CONDICOES] ${_p3}ms`);
    }

    // Passo de Enriquecimento por Fallback de Busca Textual (PrincÃ­pio Ativo) para itens sem ofertas/estoque
    logs.push(`[SISTEMA FALLBACK] Analisando itens do pedido para identificar ausÃªncia de estoque/ofertas e aplicar busca por princÃ­pio ativo...`);
    const fallbackPromises: Promise<void>[] = [];
    const actualToken = (token || CONFIG.SMARTPED_SANDBOX_TOKEN).trim();
    const isSandboxToken = actualToken === CONFIG.SMARTPED_SANDBOX_TOKEN;
    const apiCnpj = isSandboxToken ? "11111111111111" : finalCnpj.trim().replace(/\D/g, "");
    let baseUrl = useTestUrl ? CONFIG.SMARTPED_SANDBOX_URL : CONFIG.SMARTPED_PRODUCTION_URL;

    // PASSO PÓS-BATCH: Enriquecer EANs que ficaram sem Condicoes ou completamente ausentes
    // A API SmartPed SEMPRE retorna CodProdutoDist — buscar para TODOS os EANs do pedido
    {
      const eansNeedingFetch: string[] = [];
      for (const item of parsedItems) {
        const ean = cleanEan(item.ean);
        if (!ean) continue;
        const resp = apiResponses[ean];
        if (!resp) {
          eansNeedingFetch.push(ean);
        } else if (!resp.Condicoes || !Array.isArray(resp.Condicoes) || resp.Condicoes.length === 0) {
          eansNeedingFetch.push(ean);
        }
      }
      if (eansNeedingFetch.length > 0) {
        logs.push(`[ENRICH-POST-BATCH] ${eansNeedingFetch.length} EANs sem Condicoes ou ausentes. Buscando via Chamada individual Condicoes/Ean...`);
        const COND_BATCH_SIZE = 10;
        const COND_DELAY_MS = 300;
        for (let ci = 0; ci < eansNeedingFetch.length; ci += COND_BATCH_SIZE) {
          const chunk = eansNeedingFetch.slice(ci, ci + COND_BATCH_SIZE);
          try {
            const condBody = JSON.stringify({
              Token: actualToken,
              parametros: { CnpjCLi: apiCnpj, Ean: chunk.join(","), AceitaOntem: 1 }
            });
            const condResp = await fetchWithRetry(`${baseUrl.replace(/\/$/, "")}/api/Condicoes/Ean`, {
              method: "POST",
              headers: { "Content-Type": "application/json", "Accept": "application/json", "User-Agent": "Mozilla/5.0" },
              body: condBody
            }, 15000, 1);
            if (condResp.ok) {
              const condJson = await condResp.json();
              const condItens = condJson.Retorno?.itens || condJson.Retorno?.Itens || condJson.itens || condJson.Itens || [];
              let enriched = 0;
              for (const entry of condItens) {
                const conds = entry.Condicoes || entry.condicoes || [];
                if (conds.length > 0) {
                  const firstCond = conds[0];
                  const eanKey = cleanEan(firstCond.Ean || firstCond.ean || entry.CodBarra || "");
                  if (eanKey) {
                    if (!apiResponses[eanKey]) {
                      apiResponses[eanKey] = {
                        ItemPedido: { Ean: eanKey, Descricao: entry.Descricao || "", Laboratorio: entry.Laboratorio || "", Pliquido: firstCond.Preco || 0 },
                        Substitutos: [],
                        Condicoes: conds
                      };
                    } else {
                      apiResponses[eanKey].Condicoes = conds;
                    }
                    enriched++;
                  }
                }
              }
              logs.push(`[ENRICH-POST-BATCH] Lote ${Math.floor(ci / COND_BATCH_SIZE) + 1}: ${enriched}/${chunk.length} EANs enriquecidos com Condicoes`);
            } else {
              logs.push(`[ENRICH-POST-BATCH] Lote ${Math.floor(ci / COND_BATCH_SIZE) + 1}: HTTP ${condResp.status}`);
            }
          } catch (err: any) {
            logs.push(`[ENRICH-POST-BATCH] ERRO lote: ${err.message}`);
          }
          if (ci + COND_BATCH_SIZE < eansNeedingFetch.length) {
            await new Promise(r => setTimeout(r, COND_DELAY_MS));
          }
        }
      }

      // PASSO PÓS-BATCH 2: Buscar Condicoes/Ean para EANs de SUBSTITUTOS descobertos pela Molecula
      // O motor de troca pode escolher substitutos com EAN diferente do original.
      // Esses EANs precisam ter suas próprias Condicoes para que o enriquecimento de CodProdutoDist funcione.
      {
        const subEansToFetch = new Set<string>();
        for (const eanKey of Object.keys(apiResponses)) {
          const resp = apiResponses[eanKey];
          const subs = resp?.Substitutos || [];
          for (const s of subs) {
            const sEan = cleanEan(s.Ean || s.ean || "");
            if (sEan && sEan !== eanKey && !apiResponses[sEan]) {
              subEansToFetch.add(sEan);
            }
          }
        }
        if (subEansToFetch.size > 0) {
          const subEanArr = Array.from(subEansToFetch);
          logs.push(`[ENRICH-POST-BATCH-SUBS] ${subEanArr.length} EANs de substitutos sem Condicoes. Buscando Condicoes/Ean...`);
          const COND_BATCH_SIZE = 10;
          for (let ci = 0; ci < subEanArr.length; ci += COND_BATCH_SIZE) {
            const chunk = subEanArr.slice(ci, ci + COND_BATCH_SIZE);
            try {
              const condBody = JSON.stringify({
                Token: actualToken,
                parametros: { CnpjCLi: apiCnpj, Ean: chunk.join(","), AceitaOntem: 1 }
              });
              const condResp = await fetchWithRetry(`${baseUrl.replace(/\/$/, "")}/api/Condicoes/Ean`, {
                method: "POST",
                headers: { "Content-Type": "application/json", "Accept": "application/json", "User-Agent": "Mozilla/5.0" },
                body: condBody
              }, 15000, 1);
              if (condResp.ok) {
                const condJson = await condResp.json();
                const condItens = condJson.Retorno?.itens || condJson.Retorno?.Itens || condJson.itens || condJson.Itens || [];
                let enriched = 0;
                for (const entry of condItens) {
                  const conds = entry.Condicoes || entry.condicoes || [];
                  if (conds.length > 0) {
                    const firstCond = conds[0];
                    const eanKey = cleanEan(firstCond.Ean || firstCond.ean || entry.CodBarra || "");
                    if (eanKey) {
                      if (!apiResponses[eanKey]) {
                        apiResponses[eanKey] = {
                          ItemPedido: { Ean: eanKey, Descricao: entry.Descricao || "", Laboratorio: entry.Laboratorio || "", Pliquido: firstCond.Preco || 0 },
                          Substitutos: [],
                          Condicoes: conds
                        };
                      } else {
                        apiResponses[eanKey].Condicoes = conds;
                      }
                      enriched++;
                    }
                  }
                }
                logs.push(`[ENRICH-POST-BATCH-SUBS] Lote ${Math.floor(ci / COND_BATCH_SIZE) + 1}: ${enriched}/${chunk.length} EANs de substitutos enriquecidos`);
              } else {
                logs.push(`[ENRICH-POST-BATCH-SUBS] Lote ${Math.floor(ci / COND_BATCH_SIZE) + 1}: HTTP ${condResp.status}`);
              }
            } catch (err: any) {
              logs.push(`[ENRICH-POST-BATCH-SUBS] ERRO lote: ${err.message}`);
            }
            if (ci + COND_BATCH_SIZE < subEanArr.length) {
              await new Promise(r => setTimeout(r, 300));
            }
          }
        }
      }
    }
    if (useTestUrl && customTestUrl) {
      baseUrl = customTestUrl;
    } else if (!useTestUrl && customProductionUrl) {
      baseUrl = customProductionUrl;
    }

    parsedItems.forEach((item) => {
      const origEan = cleanEan(item.ean);
      if (!origEan) return;

      const localEquivs = getLocalEquivalents(origEan, item.descricao);
      const apiSimilars = (marketSimilarMap[origEan] || []).map(s => cleanEan(s.cod_barra || s.Ean || s.ean || ""));
      const allEquivs = new Set<string>([origEan, ...localEquivs, ...apiSimilars]);

      // Verificar se algum EAN equivalente tem oferta ativa com preÃ§o e estoque > 0
      let hasOffers = false;
      allEquivs.forEach(eqEan => {
        const resp = apiResponses[eqEan];
        if (resp) {
          if (resp.ItemPedido && getUnitCost(resp.ItemPedido) > 0 && (parseInt(String(resp.ItemPedido.Estoque || resp.ItemPedido.estoque || 0), 10) > 0)) {
            hasOffers = true;
          }
          const subs = resp.Substitutos || resp.substitutos || [];
          if (subs.some((s: any) => getUnitCost(s) > 0 && parseInt(String(s.Estoque || s.estoque || 0), 10) > 0)) {
            hasOffers = true;
          }
        }
      });

      // Se nÃ£o encontramos estoque ativo para o original, OU se nÃ£o hÃ¡ ofertas para nenhum equivalente, acoplamos a busca de fallback dinÃ¢mica
      let originalHasOffersWithStock = false;
      const respOrig = apiResponses[origEan];
      if (respOrig) {
        if (respOrig.ItemPedido && getUnitCost(respOrig.ItemPedido) > 0 && (parseInt(String(respOrig.ItemPedido.Estoque || respOrig.ItemPedido.estoque || 0), 10) > 0)) {
          originalHasOffersWithStock = true;
        }
        const subsOrig = respOrig.Substitutos || respOrig.substitutos || [];
        if (subsOrig.some((s: any) => getUnitCost(s) > 0 && parseInt(String(s.Estoque || s.estoque || 0), 10) > 0)) {
          originalHasOffersWithStock = true;
        }
      }

      const shouldTriggerFallback = (!originalHasOffersWithStock || !hasOffers) && !simulationMode;

      // Se elegÃ­vel, disparamos a busca de fallback em tempo real na SmartPed
      if (shouldTriggerFallback) {
        logs.push(`[SISTEMA FALLBACK] Item "${item.descricao}" (EAN: ${origEan}) estÃ¡ sem ofertas de distribuidoras com estoque. Agendando busca dinÃ¢mica por molÃ©cula/texto...`);
        
        fallbackPromises.push((async () => {
          try {
            // 1. Descobrir o DCB se temos o EAN
            let dcbDescoberto = "";
            try {
              const dcbRes = await fetchWithRetry(`${CONFIG.FERRAMENTINHAS_API_URL}/api/produtos/similares/${origEan}`, {}, 15000, 1);
              if (dcbRes.ok) {
                const dcbData = await dcbRes.json();
                const pList = dcbData.produtos || dcbData.items || [];
                const pWithDcb = pList.find((p: any) => p.cod_dcb && String(p.cod_dcb).trim().length > 0);
                if (pWithDcb) {
                  dcbDescoberto = String(pWithDcb.cod_dcb).trim();
                }
              }
            } catch (err) {
              // ignora erro silencioso
            }

            const descricaoLimpa = cleanDescription(item.descricao);
            const baseMolecula = getMoleculeBase(item.descricao);

            if (!dcbDescoberto && baseMolecula) {
              dcbDescoberto = baseMolecula;
            } else if (!dcbDescoberto && descricaoLimpa) {
              dcbDescoberto = descricaoLimpa;
            }

            const PALAVRAS_GENERICAS_BLOQUEIO = new Set([
              "KIT", "SAB", "SABONETE", "BOLA", "BALA", "BRINQUEDO", "DIVERSOS", "POTE", "PÃ‡S", "PCS", "PEÃ‡AS",
              "PECAS", "MINI", "GRANDE", "PEQUENO", "ESTOJO", "PORTA", "SUPORTE", "CABO", "FITA", "COLA", "BASE",
              "MASCARA", "MÃSCARA", "SOMBRA", "PIRANHA", "CREME", "LOÃ‡ÃƒO", "LOCAO", "SHAMPOO", "CONDICIONADOR",
              "AEROSOL", "SPRAY", "DESODORANTE", "DESOD", "PERFUME", "COLONIA", "COLÃ”NIA", "BODY", "SPLASH",
              "POMADA", "TALCO", "ALGODAO", "ALGODÃƒO", "CURATIVO", "BANDAGEM", "ESCOVA", "PENTE", "LIXA",
              "PINCA", "PINÃ‡A", "TESOURA", "CURVADOR", "CARRINHO", "CARRO", "ANIMAIS", "BONECA", "CHUPETA",
              "MAMADEIRA", "DOSADOR", "PRENDEDOR", "ELASTICO", "ELÃSTICO", "PRESILHA", "GRAMPO", "INF", "INFANTIL",
              "GK1356", "GK1592", "REF", "COD"
            ]);

            const ehGenericoCompleto = dcbDescoberto && dcbDescoberto.split(/\s+/).every(w => PALAVRAS_GENERICAS_BLOQUEIO.has(w));

            const moleculaExtraQuery = baseMolecula && baseMolecula !== dcbDescoberto ? baseMolecula : (descricaoLimpa && descricaoLimpa !== dcbDescoberto ? descricaoLimpa : "");
            const extraEhGenerico = moleculaExtraQuery && moleculaExtraQuery.split(/\s+/).every(w => PALAVRAS_GENERICAS_BLOQUEIO.has(w));

            const descricaoComDosagem = cleanDescriptionKeepDosage(item.descricao);
            const hasComDosagemQuery = descricaoComDosagem && 
                                       descricaoComDosagem !== moleculaExtraQuery && 
                                       descricaoComDosagem !== dcbDescoberto && 
                                       descricaoComDosagem.trim().length > 2;

            // Fazer chamadas em paralelo para a SmartPed
            const apiPromises: Promise<any>[] = [];
            const responseHeaders = {
              "Content-Type": "application/json",
              "Accept": "application/json",
              "User-Agent": "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36"
            };

            // 1. Rota Molecula com dcbDescoberto
            if (dcbDescoberto && dcbDescoberto.trim().length > 2 && !ehGenericoCompleto) {
              apiPromises.push(
                fetch(`${baseUrl.replace(/\/$/, "")}/api/Condicoes/Molecula`, {
                  method: "POST",
                  headers: responseHeaders,
                  body: JSON.stringify({
                    Token: actualToken,
                    parametros: { CnpjCLi: apiCnpj, Molecula: dcbDescoberto, ConsideraTipo: 1 }
                  })
                }).then(r => r.ok ? r.json() : null).catch(() => null)
              );
            } else {
              apiPromises.push(Promise.resolve(null));
            }

            // 2. Rota Molecula com moleculaExtraQuery
            if (moleculaExtraQuery && moleculaExtraQuery.trim().length > 2 && !extraEhGenerico) {
              apiPromises.push(
                fetch(`${baseUrl.replace(/\/$/, "")}/api/Condicoes/Molecula`, {
                  method: "POST",
                  headers: responseHeaders,
                  body: JSON.stringify({
                    Token: actualToken,
                    parametros: { CnpjCLi: apiCnpj, Molecula: moleculaExtraQuery, ConsideraTipo: 1 }
                  })
                }).then(r => r.ok ? r.json() : null).catch(() => null)
              );
            } else {
              apiPromises.push(Promise.resolve(null));
            }

            // 3. Rota Produtos/Buscar com descricaoComDosagem
            if (hasComDosagemQuery) {
              apiPromises.push(
                fetchWithRetry(`${baseUrl.replace(/\/$/, "")}/api/Produtos/Buscar`, {
                  method: "POST",
                  headers: responseHeaders,
                  body: JSON.stringify({
                    Token: actualToken,
                    parametros: { CnpjCLi: apiCnpj, Texto: descricaoComDosagem }
                  })
                }, 15000, 1).then(r => r.ok ? r.json() : null).catch(() => null)
              );
            } else {
              apiPromises.push(Promise.resolve(null));
            }

            const fallbackResults = await Promise.all(apiPromises);
            const resDcb = fallbackResults[0];
            const resExtra = fallbackResults[1];
            const resBuscar = fallbackResults[2];

            const distsMapLocal: Record<number, string> = {};

            const incorporateRetornoItens = (resData: any, tag: string) => {
              if (!resData) return;
              const ret = resData.Retorno || resData.retorno || resData;
              const itensMolecula = ret.itens || ret.Itens || [];
              
              const allDistsLocal = ret.dists || ret.Dists || [];
              for (const d of allDistsLocal) {
                if (d.CodDist && d.NomeDist) distsMapLocal[d.CodDist] = d.NomeDist;
              }
              
              enrichDistribuidoresFromPayload(resData);

              if (itensMolecula.length > 0) {
                logs.push(`[SISTEMA FALLBACK] Retorno por ${tag} trouxe ${itensMolecula.length} novos registros da SmartPed para o item ${origEan}.`);
              }

              for (const entry of itensMolecula) {
                const itemPedido = entry.ItemPedido || entry.itemPedido || entry;
                const eanRaw = String(itemPedido?.Ean || itemPedido?.ean || entry.Ean || entry.ean || "");
                const eanResp = cleanEan(eanRaw);
                if (eanResp) {
                  const subsRaw = entry.Substitutos || entry.substitutos || [];
                  const substitutos: any[] = [];
                  subsRaw.forEach((sub: any) => {
                    const conds = sub.Condicoes || sub.condicoes || [];
                    if (conds.length === 0) {
                      substitutos.push({
                        ...sub,
                        Ean: sub.Ean || sub.ean || sub.EanProduto_Idi || sub.eanProduto_Idi || "",
                        Descricao: sub.Descricao || sub.descricao || sub.DescricaoProduto_Idi || sub.descricaoProduto_Idi || "",
                        Laboratorio: sub.Laboratorio || sub.laboratorio || ""
                      });
                    } else {
                      conds.forEach((cond: any) => {
                        substitutos.push({
                          ...cond,
                          Ean: sub.Ean || sub.ean || sub.EanProduto_Idi || sub.eanProduto_Idi || cond.Ean || cond.ean || "",
                          Descricao: sub.Descricao || sub.descricao || sub.DescricaoProduto_Idi || sub.descricaoProduto_Idi || cond.Descricao || cond.descricao || "",
                          Laboratorio: sub.Laboratorio || sub.laboratorio || cond.Laboratorio || cond.laboratorio || ""
                        });
                      });
                    }
                  });
                  substitutos.forEach((s: any) => {
                     if (s.CodDist && !s.NomeDist) s.NomeDist = distsMapLocal[s.CodDist] || DISTRIBUIDORAS_MAP[s.CodDist];
                  });

                  if (!apiResponses[eanResp]) {
                    apiResponses[eanResp] = {
                       ItemPedido: itemPedido,
                       Substitutos: substitutos,
                       Condicoes: []
                    };
                  } else {
                    const existentes = apiResponses[eanResp].Substitutos || [];
                    const existentesEans = new Set(existentes.map((x: any) => cleanEan(x.Ean || x.ean || "")));
                    const novos = substitutos.filter((s: any) => !existentesEans.has(cleanEan(s.Ean || s.ean || "")));
                    apiResponses[eanResp].Substitutos = [...existentes, ...novos];
                  }

                  const similaresAtuais = marketSimilarMap[origEan] || [];
                  const jaExisteEmSimilares = similaresAtuais.some((s: any) => cleanEan(s.cod_barra || s.Ean || s.ean || "") === eanResp);
                  if (!jaExisteEmSimilares && eanResp !== origEan) {
                     // Marcar como SmartPed — NÃO usar para vendas/estoque (só para pricing)
                     similaresAtuais.push({ cod_barra: eanResp, nom_produto: itemPedido.Descricao || entry.Descricao || `Descoberto via Fallback ${tag}`, _origem: "smartped" });
                     marketSimilarMap[origEan] = similaresAtuais;
                  }
                }
              }
            };

            incorporateRetornoItens(resDcb, "PrincÃ­pio Ativo");
            incorporateRetornoItens(resExtra, "MolÃ©cula Extra");

            // Incorporar resultados de Produtos/Buscar
            if (resBuscar) {
              const itensBuscar = resBuscar.Retorno || resBuscar.retorno || [];
              if (Array.isArray(itensBuscar) && itensBuscar.length > 0) {
                logs.push(`[SISTEMA FALLBACK] Retorno por Produtos/Buscar trouxe ${itensBuscar.length} ofertas para o item ${origEan}.`);
                itensBuscar.forEach((sub: any) => {
                  const subEan = cleanEan(sub.Ean || sub.ean || "");
                  if (!subEan) return;

                  const codDist = sub.CodDist !== undefined ? sub.CodDist : sub.codDist;
                  const distName = resolveDistName(sub, codDist);
                  const subPreco = getUnitCost(sub);
                  const subEstoque = parseSmartPedEstoque(sub.Estoque !== undefined ? sub.Estoque : (sub.estoque || 0), subPreco > 0);

                  const mappedSub = {
                    Ean: subEan,
                    Descricao: sub.Descricao || sub.descricao || "",
                    Laboratorio: sub.Laboratorio || sub.laboratorio || "GENÃ‰RICO",
                    TipoItem: sub.TipoItem || sub.tipoItem || (sub.Descricao && (sub.Descricao.toUpperCase().includes("(G)") || sub.Descricao.toUpperCase().includes("GENERICO") || sub.Descricao.toUpperCase().includes("GENÃ‰RICO")) ? "G" : "S"),
                    Pliquido: subPreco,
                    PliquidoUni: subPreco,
                    Estoque: subEstoque,
                    NomeDist: distName,
                    CodDist: codDist,
                    Condicao: sub.Condicao || sub.condicao || "FIXA",
                    Prazo: sub.Prazo !== undefined ? sub.Prazo : (sub.prazo || 5),
                    CodProdutoDist: sub.CodProdutoDist || sub.codProdutoDist || ""
                  };

                  if (!apiResponses[origEan]) {
                    apiResponses[origEan] = {
                      ItemPedido: { Ean: origEan },
                      Substitutos: [],
                      Condicoes: []
                    };
                  }
                  if (!apiResponses[origEan].Substitutos) {
                    apiResponses[origEan].Substitutos = [];
                  }
                  apiResponses[origEan].Substitutos.push(mappedSub);

                  const similaresAtuais = marketSimilarMap[origEan] || [];
                  const jaExisteEmSimilares = similaresAtuais.some((s: any) => cleanEan(s.cod_barra || s.Ean || s.ean || "") === subEan);
                  if (!jaExisteEmSimilares && subEan !== origEan) {
                     similaresAtuais.push({ cod_barra: subEan, nom_produto: sub.Descricao || "Descoberto via Fallback Buscar", _origem: "smartped" });
                     marketSimilarMap[origEan] = similaresAtuais;
                  }
                });
              }
            }

          } catch (err: any) {
            logs.push(`[SISTEMA FALLBACK ALERTA] Erro na busca por princÃ­pio ativo para "${item.descricao}": ${err.message}`);
          }
        })());
      }
    });

    if (fallbackPromises.length > 0) {
      logs.push(`[SISTEMA FALLBACK] Aguardando a finalizaÃ§Ã£o concorrente de ${fallbackPromises.length} buscas textuais de emergÃªncia...`);
      await Promise.all(fallbackPromises);
      logs.push(`[SISTEMA FALLBACK] Busca de fallback por princÃ­pio ativo concluÃ­da com sucesso.`);
    }

    // Process swaps and rewrite lines
    logs.push(`[ANALISADOR] Iniciando filtragem de substitutos e verificaÃ§Ã£o de condiÃ§Ãµes comerciais.`);
    const finalLines: string[] = [headerLine];
    const report: any[] = [];
    let totalSavings = 0.0;
    let itemsTreatedCount = 0;
    let itemsSwappedCount = 0;

    // Conjunto de EANs já consultados via API neste request (deduplicação cross-item no RUPTURA-REGEX)
    const queriedEanSet = new Set<string>();

    // ===== VENDAS + ESTOQUE (Ferramentinhas) — Batch para todos os EANs do SICF + similares =====
    const _f5Start = Date.now();
    const vendasEstoqueMap: Record<string, { vendasMensais: number; estoqueTotal: number }> = {};
    {
      // 1. Mapear cada EAN expandido → EAN original do SICF (filtrado por apresentação)
      const eanToOriginal = new Map<string, string>();
      for (const item of parsedItems) {
        const origEan = cleanEan(item.ean);
        if (!origEan) continue;
        eanToOriginal.set(origEan, origEan);
        const similares = (marketSimilarMap[origEan] || []).filter((s: any) => s._origem !== "smartped");
        // Enriquecer item com DCB do primeiro similar para comparação correta
        const dcbRef3 = similares[0]?.cod_dcb;
        const concRef3 = similares[0]?.cod_concentracao;
        const itemComDcb = (dcbRef3 && concRef3) ? { ...item, cod_dcb: dcbRef3, cod_concentracao: concRef3 } : item;
        for (const s of similares) {
          const sEan = cleanEan(s.cod_barra || s.Ean || s.ean || "");
          if (sEan && !eanToOriginal.has(sEan)) {
            if (mesmaApresentacao(itemComDcb, s)) eanToOriginal.set(sEan, origEan);
          }
        }
      }
      const allEansForVendas = Array.from(eanToOriginal.keys());

      // Filtro: excluir EANs de Referência/Ético (categoria "marca") — só incluir genéricos e similares
      {
        const eanCatMap = new Map<string, string>();
        for (const item of parsedItems) {
      const origEan = cleanEan(item.ean);
      if (!origEan) continue;
          const similares = (marketSimilarMap[origEan] || []).filter((s: any) => s._origem !== "smartped");
          for (const s of similares) {
            const sEan = cleanEan(s.cod_barra || s.Ean || s.ean || "");
            if (sEan) eanCatMap.set(sEan, resolveCategoria(s));
          }
        }
        const beforeRefFilter = allEansForVendas.length;
        for (let i = allEansForVendas.length - 1; i >= 0; i--) {
          const cat = eanCatMap.get(allEansForVendas[i]);
          if (cat === "marca") allEansForVendas.splice(i, 1);
        }
        if (beforeRefFilter !== allEansForVendas.length) {
          logs.push(`[METRICAS-REF-FILTER] ${beforeRefFilter} EANs → ${allEansForVendas.length} após excluir Referência/Ético (${beforeRefFilter - allEansForVendas.length} removidos)`);
        }
      }

      logs.push(`[METRICAS] Buscando vendas para ${allEansForVendas.length} EANs (${parsedItems.filter(i => i.ean).length} originais + ${allEansForVendas.length - parsedItems.filter(i => i.ean).length} similares)...`);

      // 2. Buscar vendas de TODOS os EANs (expandidos) via vendas-resumo batch
      const vendasByOriginal: Record<string, { total: number; meses: number }> = {};
      const vendasBatch = await fetchVendasResumoBatch(allEansForVendas);
      const vendasResults = allEansForVendas.map((ean) => {
        const v = vendasBatch[ean];
        if (v && v.totalVendas > 0 && v.primeira && v.ultima) {
          const mesesDiff = Math.max(1, (v.ultima.getFullYear() - v.primeira.getFullYear()) * 12 + (v.ultima.getMonth() - v.primeira.getMonth()) + 1);
          return { ean, totalVendas: v.totalVendas, meses: mesesDiff };
        }
        return { ean, totalVendas: 0, meses: 0 };
      });
      // Agregar por EAN original
      for (const r of vendasResults) {
        const origEan = eanToOriginal.get(r.ean) || r.ean;
        if (!vendasByOriginal[origEan]) vendasByOriginal[origEan] = { total: 0, meses: 0 };
        vendasByOriginal[origEan].total += r.totalVendas;
        vendasByOriginal[origEan].meses = Math.max(vendasByOriginal[origEan].meses, r.meses);
      }
      for (const [origEan, data] of Object.entries(vendasByOriginal)) {
        const mediaMensal = data.meses > 0 ? Math.round(data.total / data.meses) : 0;
        vendasEstoqueMap[origEan] = { vendasMensais: mediaMensal, estoqueTotal: vendasEstoqueMap[origEan]?.estoqueTotal || 0 };
      }

      // 3. Buscar estoque apenas dos EANs originais (com filtro de apresentação) — via batch
      const uniqueOriginalEans = Array.from(new Set(parsedItems.map(item => cleanEan(item.ean)).filter(Boolean)));
      const similaresBatch: Record<string, any[]> = {};
      for (const ean of uniqueOriginalEans) {
        similaresBatch[ean] = (marketSimilarMap[ean] || []).filter((s: any) => s._origem !== "smartped");
      }
      for (const ean of uniqueOriginalEans) {
        let estoqueTotal = 0;
        try {
          const itemOrig = parsedItemsByEan.get(ean);
          const produtos = similaresBatch[ean] || [];
          const produtosSemRef = produtos.filter((p: any) => resolveCategoria(p) !== "marca");
          const dcbRef2 = produtos[0]?.cod_dcb;
          const concRef2 = produtos[0]?.cod_concentracao;
          const itemOrigComDcb = (itemOrig && dcbRef2 && concRef2) ? { ...itemOrig, cod_dcb: dcbRef2, cod_concentracao: concRef2 } : itemOrig;
          const produtosFiltrados = itemOrigComDcb
            ? produtosSemRef.filter((p: any) => mesmaApresentacao(itemOrigComDcb, p))
            : produtosSemRef;
          estoqueTotal = produtosFiltrados.reduce((s: number, p: any) => s + (p.qtd_estoque || 0), 0);
        } catch {}
        if (!vendasEstoqueMap[ean]) vendasEstoqueMap[ean] = { vendasMensais: 0, estoqueTotal: 0 };
        vendasEstoqueMap[ean].estoqueTotal = estoqueTotal;
      }

      const comVendas = Object.values(vendasEstoqueMap).filter(v => v.vendasMensais > 0).length;
      const comEstoque = Object.values(vendasEstoqueMap).filter(v => v.estoqueTotal > 0).length;
      logs.push(`[METRICAS] ${comVendas}/${uniqueOriginalEans.length} EANs com vendas, ${comEstoque} com estoque.`);
      _p5 = Date.now() - _f5Start;
      logs.push(`[FASE-5-VENDAS-ESTOQUE] ${_p5}ms`);
      console.log(`[FASE-5-VENDAS-ESTOQUE] ${_p5}ms`);
    }

    let _ruturaTotalMs = 0;
    let _ruturaCount = 0;
    let _descLookupTotalMs = 0;
    let _descLookupCount = 0;
    let _descHadDesc = 0;
    let _descNeededLookup = 0;
    let _tValidate = 0, _tDistName = 0, _tPrice = 0;
    let _cValidate = 0, _cDistName = 0, _cPrice = 0;
    let _tFindBest = 0, _cFindBest = 0, _maxFindBest = 0, _maxFindBestCands = 0;
    let _tTargetEanApi = 0, _cTargetEanApi = 0, _cTargetEanCacheHit = 0;
    let _tFallbackSimilares = 0, _cFallbackSimilares = 0;
    const _f4Start = Date.now();
    for (const item of parsedItems) {
      // ===== DEBUG: Rastrear caminho WhatsApp =====
      const waMatch = whatsappItemsMap.get(item.lineIndex);
      if (item.laboratorio && (item.laboratorio || "").toUpperCase().includes("EUROFARMA")) {
        logs.push(`[DEBUG-WA] lineIndex=${item.lineIndex}, lab="${item.laboratorio}", desc="${item.descricao}", waMatch=${!!waMatch}, mapSize=${whatsappItemsMap.size}`);
      }
      // ===== WHATSAPP: Item com regra de laboratório → vai pro WhatsApp com dados SmartPed =====
      if (waMatch) {
        const { rule } = waMatch;
        const qtdNum = parseFloat(item.qtd.replace(",", "."));
        const ruleName = rule.nome_regra || rule.nomeRegra || "WhatsApp";
        const rulePhone = rule.telefone || "";
        logs.push(`[WHATSAPP-REPORT] Item "${item.descricao}" → WhatsApp via regra "${ruleName}" (com dados SmartPed)`);

        const origEanWa = cleanEan(item.ean);
        const respWa = apiResponses[origEanWa];

        // Montar alternativas SmartPed, filtrando substitutos de labs com regra WhatsApp
        const waAlternatives: any[] = [];
        if (respWa) {
          // Item original SmartPed (se tiver preço e estoque)
          const origCostWa = getUnitCost(respWa.ItemPedido);
          const origStockWa = parseInt(String(respWa.ItemPedido?.Estoque || respWa.ItemPedido?.estoque || 0), 10);
          if (origCostWa > 0 && origStockWa > 0) {
            const origLabWa = (respWa.ItemPedido?.Laboratorio || respWa.ItemPedido?.laboratorio || "").toUpperCase().trim();
            // Blindagem: origLabWa não-vazio para evitar falso-positivo de .includes("")
            const isFromRegisteredLab = origLabWa !== "" && [...whatsappLabNames].some(lab => origLabWa.includes(lab) || lab.includes(origLabWa));
            if (!isFromRegisteredLab) {
              waAlternatives.push({
                ean: origEanWa,
                descricao: respWa.ItemPedido?.Descricao || item.descricao,
                laboratorio: respWa.ItemPedido?.Laboratorio || item.laboratorio,
                distribuidora: resolveDistName(respWa.ItemPedido),
                precoLiquido: origCostWa,
                estoque: origStockWa,
                condicao: respWa.ItemPedido?.Condicao || "",
                prazo: respWa.ItemPedido?.Prazo || 0,
                codDist: respWa.ItemPedido?.CodDist || 0,
                codProdutoDist: respWa.ItemPedido?.CodProdutoDist || "",
                codProduto: respWa.ItemPedido?.CodProduto || "",
                isCurrent: true
              });
            }
          }

          // Substitutos SmartPed (filtrar labs com regra WhatsApp)
          const subsWa = respWa.Substitutos || respWa.substitutos || [];
          for (const s of subsWa) {
            const sCost = getUnitCost(s);
            const sStock = parseInt(String(s.Estoque || s.estoque || 0), 10);
            if (sCost <= 0 || sStock <= 0) continue;
            const sLab = (s.Laboratorio || s.laboratorio || "").toUpperCase().trim();
            // Blindagem: sLab não-vazio para evitar falso-positivo de .includes("")
            const isFromRegisteredLab = sLab !== "" && [...whatsappLabNames].some(lab => sLab.includes(lab) || lab.includes(sLab));
            if (isFromRegisteredLab) {
              logs.push(`[WHATSAPP-FILTER] Substituto "${s.Descricao || s.descricao}" (lab: ${s.Laboratorio || s.laboratorio}) filtrado — lab com regra WhatsApp`);
              continue;
            }
            waAlternatives.push({
              ean: s.Ean || s.ean || "",
              descricao: s.Descricao || s.descricao || "",
              laboratorio: s.Laboratorio || s.laboratorio || "",
              distribuidora: resolveDistName(s),
              precoLiquido: sCost,
              estoque: sStock,
              condicao: s.Condicao || "",
              prazo: s.Prazo || 0,
              codDist: s.CodDist || 0,
              codProdutoDist: s.CodProdutoDist || "",
              codProduto: s.CodProduto || ""
            });
          }
          logs.push(`[WHATSAPP-REPORT] ${waAlternatives.length} alternativa(s) SmartPed disponível(is) para "${item.descricao}"`);
        }

        const _metricasWa = vendasEstoqueMap[origEanWa] || { vendasMensais: 0, estoqueTotal: 0 };
        report.push({
          codInterno: item.codInterno,
          originalEan: item.ean,
          originalDescricao: item.descricao,
          originalLaboratorio: item.laboratorio,
          originalPreco: item.precoOriginal,
          novoEan: item.ean,
          novaDescricao: item.descricao,
          novoLaboratorio: item.laboratorio,
          novoPreco: item.precoOriginal,
          qtd: qtdNum,
          economiaUnit: 0,
          economiaTotal: 0,
          distribuidora: `WhatsApp: ${ruleName}`,
          estoque: _metricasWa.estoqueTotal || 0,
          codDist: 0,
          condicao: "WHATSAPP",
          prazo: 0,
          codProdutoDist: "",
          codProduto: "",
          pedidoMinimo: 0,
          qtdMin: 0,
          qtdMax: 0,
          cx: 1,
          qtdMinima: 0,
          observacao: rulePhone ? `Fornecedor via WhatsApp: ${ruleName} (${rulePhone})` : `Fornecedor via WhatsApp: ${ruleName}`,
          motivoAcao: "whatsapp_regra_lab",
          whatsappRuleId: rule.id,
          whatsappDestino: rulePhone,
          originalSemEstoque: false,
          isRupturaSubstitution: false,
          alertaConfirmarQtd: false,
          vendasMensais: _metricasWa.vendasMensais,
          estoqueTotal: _metricasWa.estoqueTotal,
          alternatives: waAlternatives
        });

        // Manter linha original no SICF
        finalLines.push(item.originalLine);
        continue; // Pular processamento SmartPed (já feito acima)
      }

      const origEan = cleanEan(item.ean);
      try {
      const localEquivs = getLocalEquivalents(origEan, item.descricao);
      const apiSimilars = (marketSimilarMap[origEan] || []).map(s => cleanEan(s.cod_barra || s.Ean || s.ean || ""));
      
      // Verificar se o prÃ³prio EAN original possui alguma oferta ativa com preÃ§o e estoque > 0
      const origResp = apiResponses[origEan];
      let origHasStockOffer = false;
      if (origResp) {
        if (origResp.ItemPedido && getUnitCost(origResp.ItemPedido) > 0 && (parseInt(String(origResp.ItemPedido.Estoque || origResp.ItemPedido.estoque || 0), 10) > 0)) {
          origHasStockOffer = true;
        }
        const subs = origResp.Substitutos || origResp.substitutos || [];
        if (subs.some((s: any) => getUnitCost(s) > 0 && parseInt(String(s.Estoque || s.estoque || 0), 10) > 0)) {
          origHasStockOffer = true;
        }
      }

      // Se o original jÃ¡ possui estoque ativo/oferta, limitamos a lista de equivalentes apenas ao prÃ³prio original.
      // Isso impede "swaps" desnecessÃ¡rios ou equivocados de marcas concorrentes de produtos que jÃ¡ possuem ofertas ativas e estoque!
      // Mantendo a equivalÃªncia dinÃ¢mica apenas para recuperar itens out-of-stock ("Sem Estoque").
      const allEquivSet = origHasStockOffer 
        ? new Set<string>([origEan])
        : new Set<string>([origEan, ...localEquivs, ...apiSimilars]);

      let combinedSubstitutos: any[] = [];
      let combinedCondicoes: any[] = [];
      let mainItemPedido = null;

      // Unificar respostas de cotaÃ§Ãµes da SmartPed de todos os EANs equivalentes que de fato retornaram ofertas
      allEquivSet.forEach(equivEan => {
        const resp = apiResponses[equivEan];
        if (resp) {
          if (!mainItemPedido && resp.ItemPedido) {
            mainItemPedido = resp.ItemPedido;
          }
          if (resp.Substitutos && Array.isArray(resp.Substitutos)) {
            combinedSubstitutos.push(...resp.Substitutos);
          }
          if (resp.Condicoes && Array.isArray(resp.Condicoes)) {
            combinedCondicoes.push(...resp.Condicoes);
          }

          // Se o ItemPedido de um EAN concorrente/equivalente for retornado na SmartPed, e ele possuir preÃ§o,
          // nÃ³s o transformamos em uma alternativa de troca elegÃ­vel (Substituto)!
          if (resp.ItemPedido && equivEan !== origEan) {
            const cost = getUnitCost(resp.ItemPedido);
            if (cost > 0) {
              const condEstoque = parseSmartPedEstoque(resp.ItemPedido.Estoque || resp.ItemPedido.estoque || 0, cost > 0);
              combinedSubstitutos.push({
                Ean: equivEan,
                Descricao: resp.ItemPedido.Descricao || resp.ItemPedido.descricao || "",
                Laboratorio: resp.ItemPedido.Laboratorio || resp.ItemPedido.laboratorio || "CONCORRENTE",
                TipoItem: resp.ItemPedido.TipoItem || resp.ItemPedido.tipoItem || (resp.ItemPedido.Descricao && (resp.ItemPedido.Descricao.toUpperCase().includes("(G)") || resp.ItemPedido.Descricao.toUpperCase().includes("GENERICO")) ? "G" : "S"),
                Pliquido: cost,
                PliquidoUni: cost,
                Estoque: condEstoque,
                NomeDist: resp.ItemPedido.NomeDist || resp.ItemPedido.nomeDist || "Não Encontrados",
                CodDist: resp.ItemPedido.CodDist !== undefined ? resp.ItemPedido.CodDist : (resp.ItemPedido.codDist !== undefined ? resp.ItemPedido.codDist : 0),
                Condicao: resp.ItemPedido.Condicao || resp.ItemPedido.condicao || "FIXA",
                Prazo: resp.ItemPedido.Prazo !== undefined ? resp.ItemPedido.Prazo : (resp.ItemPedido.prazo || 7)
              });
            }
          }
        }
      });

      if (!mainItemPedido) {
        const descUpper = item.descricao.toUpperCase();
        const inferredTipo = (descUpper.includes("(G)") || descUpper.includes("GENERICO") || descUpper.includes("GENÉRICO")) ? "G" : "S";
        mainItemPedido = { Ean: origEan, Descricao: item.descricao, Laboratorio: item.laboratorio, Pliquido: item.precoOriginal, TipoItem: inferredTipo };
      }

      // LOG BRUTO via logs array (sem escrita em arquivo)
      {
        const rawLines = combinedSubstitutos.map((s: any) => {
          const ean = cleanEan(s.Ean || s.ean || "");
          const dist = s.NomeDist || s.nomeDist || "?";
          const codDist = s.CodDist !== undefined ? s.CodDist : s.codDist;
          const est = s.Estoque !== undefined ? s.Estoque : (s.estoque || 0);
          const preco = getUnitCost(s);
          const tipo = s.TipoItem || s.tipoItem || "?";
          return `RAW-SUBS|EAN:${ean}|Dist:${dist}|CodDist:${codDist}|Est:${est}|Preco:${preco}|Tipo:${tipo}`;
        });
        logs.push(`[RAW-SUBS] EAN ${item.ean} (${item.descricao}) — ${combinedSubstitutos.length} substitutos brutos da SmartPed:\n` + rawLines.join("\n"));
      }

      // Construir mapa de estoque REAL dos substitutos brutos (ANTES do filtro de equivalência)
      // Usado para enriquecer both allAlternativesForRupture e condicoesEnriched
      const stockMapByEanDist = new Map<string, number>();
      for (const s of combinedSubstitutos) {
        const sEan = cleanEan(s.Ean || s.ean || "");
        const sCodDist = s.CodDist !== undefined ? s.CodDist : (s.codDist !== undefined ? s.codDist : 0);
        const sPreco = getUnitCost(s);
        const sEst = parseSmartPedEstoque(s.Estoque !== undefined ? s.Estoque : (s.estoque !== undefined ? s.estoque : 0), sPreco > 0);
        if (sEan && sCodDist && sEst > 0) {
          stockMapByEanDist.set(`${sEan}_${sCodDist}`, sEst);
        }
      }

      // Enriquecer combinedSubstitutos com codProdutoDist vindo das Condicoes (Ean endpoint)
      // Substitutos do Molecula NÃO têm CodProdutoDist — só Condicoes do Ean têm
      // Busca em 2 fontes: (1) combinedCondicoes (EANs originais) e (2) apiResponses[subEan].Condicoes (EANs dos substitutos)
      for (const s of combinedSubstitutos) {
        if (!s.CodProdutoDist && !s.codProdutoDist) {
          const sEan = cleanEan(s.Ean || s.ean || "");
          const sCodDist = s.CodDist !== undefined ? s.CodDist : (s.codDist !== undefined ? s.codDist : 0);
          if (sEan && sCodDist) {
            // Fonte 1: combinedCondicoes (dos EANs originais/equivalentes)
            let match = combinedCondicoes.find((c: any) => {
              const cEan = cleanEan(c.Ean || c.ean || "");
              const cCodDist = c.CodDist !== undefined ? c.CodDist : (c.codDist !== undefined ? c.codDist : 0);
              return cEan === sEan && cCodDist === sCodDist && (c.CodProdutoDist || c.codProdutoDist);
            });
            // Fonte 2: apiResponses[sEan].Condicoes (Condicoes/Ean buscadas para EANs de substitutos)
            if (!match && apiResponses[sEan]?.Condicoes?.length > 0) {
              match = apiResponses[sEan].Condicoes.find((c: any) => {
                const cCodDist = c.CodDist !== undefined ? c.CodDist : (c.codDist !== undefined ? c.codDist : 0);
                return cCodDist === sCodDist && (c.CodProdutoDist || c.codProdutoDist);
              });
            }
            if (match) {
              s.CodProdutoDist = match.CodProdutoDist || match.codProdutoDist;
              s.codProdutoDist = s.CodProdutoDist;
            }
          }
        }
      }

      // Converter substitutos brutos para formato do ConditionSelector ANTES do filtro de equivalência
      // Isso garante que o dropdown tenha opções mesmo para Referência/Ético/O em caso de ruptura
      const allAlternativesForRupture = combinedSubstitutos.map((s: any) => {
        const unitPrice = getUnitCost(s);
        const altEan = cleanEan(s.Ean || s.ean || "") || cleanEan(item.ean);
        let altDesc = s.Descricao || s.DescricaoProduto_Idi || s.descricao || "";
        let resolvedLab = s.Laboratorio || s.laboratorio || "";
        const codDist = s.CodDist !== undefined ? s.CodDist : (s.codDist !== undefined ? s.codDist : 0);
        return {
          ean: altEan,
          descricao: altDesc || item.descricao,
          laboratorio: resolvedLab || item.laboratorio || "GENÉRICO",
          preco: unitPrice,
          condicao: s.Condicao || s.condicao || "FIXA",
          distribuidora: resolveDistName(s, codDist),
          codDist: codDist,
          prazo: s.Prazo !== undefined ? s.Prazo : (s.prazo || 7),
          qtdMin: s.QtdMin !== undefined ? s.QtdMin : (s.qtdMin !== undefined ? s.qtdMin : 0),
          estoque: s.Estoque !== undefined ? s.Estoque : (s.estoque || 0),
          codProdutoDist: s.CodProdutoDist || s.codProdutoDist || "",
          codProduto: cleanCodProduto(s.CodProduto || s.codProduto || "", s.CodProdutoDist || s.codProdutoDist || "")
        };
      }).filter((alt: any) => {
        if (isNotFoundName(alt.distribuidora)) return false;
        if (alt.codDist !== undefined && disabledDistSet.has(Number(alt.codDist))) return false;
        // Bloquear fornecedores que falharam por falta de estoque nos últimos 2 dias
        if (blockedSuppliers.has(alt.ean) && blockedSuppliers.get(alt.ean)!.has(Number(alt.codDist))) return false;
        return alt.estoque > 0;
      }).sort((a: any, b: any) => a.preco - b.preco);

      // Enriquecer allAlternativesForRupture com estoque REAL do stockMap
      if (stockMapByEanDist.size > 0) {
        for (const alt of allAlternativesForRupture) {
          const key = `${alt.ean}_${alt.codDist}`;
          const realStock = stockMapByEanDist.get(key);
          if (realStock !== undefined) {
            alt.estoque = realStock;
          }
        }
      }

      // Deduplicar por chave comercial (sem preço) conforme regra de negócio
      const uniqueRuptureMap = new Map<string, any>();
      allAlternativesForRupture.forEach((alt: any) => {
        const key = `${alt.ean}_${alt.codDist}_${alt.condicao}_${alt.prazo}`;
        if (!uniqueRuptureMap.has(key)) {
          uniqueRuptureMap.set(key, alt);
        }
      });
      const deduplicatedAlternativesForRupture = Array.from(uniqueRuptureMap.values());

      logs.push(`[DEBUG-ALTS] EAN ${item.ean} | allAlternativesForRupture: ${allAlternativesForRupture.length} brutos → ${deduplicatedAlternativesForRupture.length} deduplicados`);

      // DEBUG: Logar mainItemPedido e primeiros substitutos para debug de EQUIV-FILTER
      if (combinedSubstitutos.length > 3) {
        const mip = mainItemPedido || {};
        const mipTipo = String(mip.TipoItem || mip.tipoItem || "").trim().toUpperCase();
        const isRef = ["REFERENCIA","REFERÊNCIA","ETICO","ÉTICO","R","E"].includes(mipTipo);
        logs.push(`[EQUIV-DEBUG] EAN ${item.ean} | mainItemPedido: Ean=${mip.Ean||mip.ean||"?"} Desc="${(mip.Descricao||mip.descricao||"?").substring(0,60)}" Tipo=${mipTipo||"??"} isRef=${isRef} Lab="${(mip.Laboratorio||mip.laboratorio||"?").substring(0,30)}"`);
        let passCount = 0;
        for (let i = 0; i < Math.min(5, combinedSubstitutos.length); i++) {
          const s = combinedSubstitutos[i];
          const sEan = cleanEan(s.Ean || s.ean || "");
          const sDesc = (s.Descricao || s.descricao || "?").substring(0, 60);
          const sTipo = s.TipoItem || s.tipoItem || "?";
          const passa = validateSwapEquivalence(mainItemPedido, s);
          if (passa) passCount++;
          logs.push(`[EQUIV-DEBUG]   sub[${i}] EAN=${sEan} Desc="${sDesc}" Tipo=${sTipo} → ${passa ? "PASSA" : "BLOQUEADO"}`);
        }
        logs.push(`[EQUIV-DEBUG] Resultado: ${passCount}/${Math.min(5, combinedSubstitutos.length)} dos primeiros passaram`);
      }

      // Filtrar estritamente combinedSubstitutos com o Hard Block de equivalÃªncia
      const preFilterCount = combinedSubstitutos.length;
      combinedSubstitutos = combinedSubstitutos.filter((s: any) => validateSwapEquivalence(mainItemPedido, s));

      // Filtrar substitutos de labs com regra WhatsApp — esses itens vão pro grupo WhatsApp, não pro pré-pedido normal
      if (whatsappLabNames.size > 0) {
        const preWaFilter = combinedSubstitutos.length;
        combinedSubstitutos = combinedSubstitutos.filter((s: any) => {
          const sLab = (s.Laboratorio || s.laboratorio || "").toUpperCase().trim();
          const isFromRegisteredLab = [...whatsappLabNames].some(lab => sLab.includes(lab) || lab.includes(sLab));
          return !isFromRegisteredLab;
        });
        if (preWaFilter !== combinedSubstitutos.length) {
          logs.push(`[WHATSAPP-FILTER] EAN ${item.ean} — ${preWaFilter} substitutos → ${combinedSubstitutos.length} após filtro WhatsApp (${preWaFilter - combinedSubstitutos.length} de labs WhatsApp removidos)`);
        }
      }
      
      // LOG: O que sobrou após filtro de equivalência
      if (preFilterCount !== combinedSubstitutos.length) {
        const removed = combinedSubstitutos.length;
        const filteredOut = preFilterCount - removed;
        logs.push(`[EQUIV-FILTER] EAN ${item.ean} — ${preFilterCount} brutos → ${removed} após equivalência (${filteredOut} removidos)`);
      }

      // Adicionar tambÃ©m os similares brutos do Ferramentinhas que nÃ£o foram achados pela SmartPed como fallback, caso nÃ£o haja nenhum substituto cotado
      const similaresMercado = marketSimilarMap[origEan] || [];
      const mappedSimilares = similaresMercado.map((s: any) => {
         const est = parseInt(String(s.qtd_estoque !== undefined ? s.qtd_estoque : (s.Estoque !== undefined ? s.Estoque : (s.estoque !== undefined ? s.estoque : 0))), 10) || 0;
         const smartPedPrice = getUnitCost(s);
         const price = smartPedPrice > 0 ? smartPedPrice : parseFloat(String(s.vlr_custopersonalizado !== undefined ? s.vlr_custopersonalizado : (s.vlr_custo !== undefined ? s.vlr_custo : 0)));
         // Classificacao via resolveCategoria (Ferramentinhas grupo > SmartPed TipoItem > suffixo Molecula > descricao)
         const categoria: CategoriaProduto = resolveCategoria(s);
         const tipoMap: Record<CategoriaProduto, string> = { generico: "G", marca: "M", similar: "S", perfumaria: "P", outros: "O" };
         return {
            Ean: s.cod_barra || s.Ean || s.ean || "",
            Descricao: s.nom_produto || s.Descricao || s.descricao || "",
            Laboratorio: s.nom_laborat || s.Laboratorio || s.laboratorio || "",
            Estoque: est,
            Pliquido: price,
            PliquidoUni: price,
            TipoItem: s.TipoItem || s.tipoItem || tipoMap[categoria],
            NomeDist: s.NomeDist || s.nomeDist || s.nom_distribuidora || "Não Encontrados",
            CodDist: s.CodDist !== undefined ? s.CodDist : (s.codDist !== undefined ? s.codDist : 0),
            Condicao: s.Condicao || s.condicao || "FIXA",
            Prazo: s.Prazo !== undefined ? s.Prazo : (s.prazo || 7),
            grupo: s.grupo || s.classificacao || "",
            categoria
         };
      }).filter((s: any) => validateSwapEquivalence(mainItemPedido, s));

      // Trier NÃO adiciona preços - ela só fornece códigos de barras para busca na SmartPed
      // Portanto, novosSimilares da Trier NÃO são incluídos no array Substitutos
      
      let entry: any = {
        ItemPedido: mainItemPedido,
        Substitutos: [...combinedSubstitutos],
        Condicoes: combinedCondicoes
      };

      // Guardar a entrada unificada consolidada para o item
      apiResponses[origEan] = entry;

      let lineFinal = "";
      let ref: any = null;

      if (entry) {
        itemsTreatedCount++;
        const itemPedido = entry.ItemPedido || entry.itemPedido || entry;
        const originalDesc = itemPedido.Descricao || itemPedido.descricao || item.descricao || "";
        const originalLab = itemPedido.Laboratorio || itemPedido.laboratorio || item.laboratorio || "";
        const originalTipo = itemPedido.TipoItem || itemPedido.tipoItem || "";

        let substitutosRaw = entry.Substitutos || entry.substitutos || [];
        let condicoesRaw = entry.Condicoes || entry.condicoes || [];
        
        // Ensure we filter out disabled distributors globally and apply Hard Block on substitutes
        let substitutos = substitutosRaw.filter((s: any) => {
            const dist = s.CodDist !== undefined ? s.CodDist : s.codDist;
            if (dist !== undefined && disabledDistSet.has(Number(dist))) return false;
            return validateSwapEquivalence(itemPedido, s);
        });
        
        // LOG: Quais distribuidoras sobraram após filtro (substitutos)
        {
          const distCount = new Map<string, number>();
          for (const s of substitutos) {
            const d = s.NomeDist || s.nomeDist || "?";
            distCount.set(d, (distCount.get(d) || 0) + 1);
          }
          const distSummary = Array.from(distCount.entries()).map(([d, c]) => `${d}(${c})`).join(", ");
          logs.push(`[SUBS-FILTER] EAN ${item.ean} — ${substitutosRaw.length} brutos → ${substitutos.length} pós-filtro | Dists: ${distSummary}`);
        }
        let condicoes = condicoesRaw.filter((c: any) => {
            const dist = c.CodDist !== undefined ? c.CodDist : c.codDist;
            return dist === undefined || !disabledDistSet.has(Number(dist));
        });

        // Enriquecer condicoes com estoque REAL dos substitutos correspondentes (mesmo EAN + CodDist)
        // Condicoes da SmartPed podem trazer Estoque incorreto (disponibilidade do catálogo, não estoque real)
        // Usa stockMapByEanDist já construído anteriormente (a partir de combinedSubstitutos)
        let condicoesEnriched = condicoes.map((c: any) => {
            const cEan = cleanEan(c.Ean || c.ean || "");
            const cCodDist = c.CodDist !== undefined ? c.CodDist : (c.codDist !== undefined ? c.codDist : 0);
            const key = `${cEan}_${cCodDist}`;
            const mappedEstoque = stockMapByEanDist.get(key);
            if (mappedEstoque !== undefined) {
              return { ...c, Estoque: mappedEstoque };
            }
            return c;
        });

        const _descLabIndex = buildDescLabIndex();
        let itemAlternatives = [...condicoesEnriched, ...substitutos]
          .filter((s: any) => {
            const est = s.Estoque !== undefined ? s.Estoque : (s.estoque || 0);
            { const _t0 = Date.now(); const _r = getUnitCost(s) <= 0; _tPrice += Date.now() - _t0; _cPrice++; if (_r) return false; }
            if (est <= 0) return false;
            { const _t0 = Date.now(); const _dn = resolveDistName(s); const _nf = isNotFoundName(_dn); _tDistName += Date.now() - _t0; _cDistName++; if (_nf) return false; }
            const codDist = s.CodDist !== undefined ? s.CodDist : (s.codDist !== undefined ? s.codDist : 0);
            const altEan = cleanEan(s.Ean || s.ean || "");
            // Bloquear fornecedores que falharam por falta de estoque nos últimos 2 dias
            if (blockedSuppliers.has(altEan) && blockedSuppliers.get(altEan)!.has(Number(codDist))) return false;
            { const _t0 = Date.now(); const _r = validateSwapEquivalence(itemPedido, s); _tValidate += Date.now() - _t0; _cValidate++; return _r; }
          })
          .map((s: any) => {
            const codDist = s.CodDist !== undefined ? s.CodDist : (s.codDist !== undefined ? s.codDist : 0);
            const condicao = s.Condicao || s.condicao || "FIXA";
            const prazo = s.Prazo !== undefined ? s.Prazo : (s.prazo !== undefined ? s.prazo : 0);
            { const _t0 = Date.now(); var unitPrice = getUnitCost(s); var tablePrice = extractTablePrice(s); var apiPmc = extractPmc(s); _tPrice += Date.now() - _t0; _cPrice++; }
            const baseForPmc = tablePrice > 0 ? tablePrice : unitPrice;
            if (!apiPmc && cleanEan(s.Ean || s.ean || "") === cleanEan(item.ean)) {
              apiPmc = extractPmc(itemPedido);
            }
            const unitPmc = apiPmc > 0 ? apiPmc : 0;
            
            const altEan = cleanEan(s.Ean || s.ean || "") || cleanEan(item.ean);
            let altDesc = s.Descricao || s.DescricaoProduto_Idi || s.descricao || s.descricaoProduto_Idi;
            let resolvedLab = s.Laboratorio || s.laboratorio;

            if (altEan === origEan) {
              if (!altDesc) altDesc = originalDesc;
              if (!resolvedLab) resolvedLab = originalLab;
            }

            if (!altDesc || !resolvedLab) {
              _descNeededLookup++;
              const _dlStart = Date.now();
              const _idx = _descLabIndex.get(altEan);
              _descLookupTotalMs += Date.now() - _dlStart;
              _descLookupCount++;
              if (_idx) {
                if (!altDesc) altDesc = _idx.descricao;
                if (!resolvedLab) resolvedLab = _idx.laboratorio;
              }
            } else {
              _descHadDesc++;
            }

            if (!altDesc) {
              const dbRecord = getEanDatabaseRecord(altEan);
              if (dbRecord && dbRecord.descricao) {
                altDesc = dbRecord.descricao;
                if (!resolvedLab) resolvedLab = dbRecord.laboratorio;
              } else if (altEan === cleanEan(item.ean)) {
                altDesc = originalDesc;
              } else {
                altDesc = `Medicamento Equivalente (EAN: ${altEan})`;
              }
            }

            return {
              ean: altEan,
              descricao: altDesc,
              laboratorio: resolvedLab || originalLab || "GENÃ‰RICO",
              preco: unitPrice,
              pmc: unitPmc,
              condicao: condicao,
              distribuidora: resolveDistName(s, codDist),
              codDist: codDist,
              prazo: prazo,
              qtdMin: s.QtdMin !== undefined ? s.QtdMin : (s.qtdMin !== undefined ? s.qtdMin : 0),
              qtdMax: (s.Combo && s.Combo.QtdMax !== undefined) ? s.Combo.QtdMax : ((s.combo && s.combo.qtdMax !== undefined) ? s.combo.qtdMax : 0),
              cx: s.CX !== undefined ? s.CX : (s.cx !== undefined ? s.cx : 1),
              estoque: s.Estoque !== undefined ? s.Estoque : (s.estoque || 0),
              codProdutoDist: s.CodProdutoDist || s.codProdutoDist || "",
              codProduto: cleanCodProduto(s.CodProduto || s.codProduto || "", s.CodProdutoDist || s.codProdutoDist || "")
            };
          })
          .filter((alt: any) => {
            if (!alt.codProdutoDist) {
              logs.push(`[FILTRO-CODPRODDIST] Removido do dropdown: EAN=${alt.ean} ${alt.distribuidora} (CodProdutoDist vazio)`);
              return false;
            }
            return true;
          });

        const uniqueAltsMap = new Map<string, any>();
        itemAlternatives.forEach(alt => {
          const key = `${alt.ean}_${alt.distribuidora}_${alt.condicao}_${alt.preco.toFixed(2)}_${alt.prazo}`;
          if (!uniqueAltsMap.has(key)) {
            uniqueAltsMap.set(key, alt);
          }
        });
        let finalAlternatives = Array.from(uniqueAltsMap.values()).sort((a: any, b: any) => {
          const aReal = isRealOffer(a);
          const bReal = isRealOffer(b);
          if (aReal && !bReal) return -1;
          if (!aReal && bReal) return 1;
          return a.preco - b.preco;
        });

        logs.push(`[DEBUG-ALTS] EAN ${item.ean} | finalAlternatives (pós-filtro): ${finalAlternatives.length} itens | substitutos brutos: ${substitutosRaw.length} | condicoes: ${condicoesRaw.length}`);
        
        // LOG CIRÚRGICO: Detalhar cada alternativa final para rastrear estoque fictício
        if (finalAlternatives.length > 0) {
          const altDetails = finalAlternatives.map((a: any) => {
            const mapKey = `${a.ean}_${a.codDist}`;
            const hasRealStock = stockMapByEanDist.has(mapKey);
            const mapStock = stockMapByEanDist.get(mapKey);
            const fromCondicoes = condicoesEnriched.some((c: any) => cleanEan(c.Ean || c.ean || "") === a.ean && (c.CodDist !== undefined ? c.CodDist : c.codDist) === a.codDist);
            const fromSubstitutos = substitutos.some((s: any) => cleanEan(s.Ean || s.ean || "") === a.ean && (s.CodDist !== undefined ? s.CodDist : s.codDist) === a.codDist);
            return `${a.distribuidora}|EAN:${a.ean}|CodDist:${a.codDist}|estoque:${a.estoque}|preco:${a.preco}|mapOK:${hasRealStock}|mapEst:${mapStock}|fonte:${fromCondicoes ? 'COND' : ''}${fromSubstitutos ? 'SUBS' : ''}`;
          });
          const traceLines = [`[STOCK-TRACE] EAN ${item.ean} (${item.descricao}) — ${finalAlternatives.length} alternativas finais:`];
          altDetails.forEach((d: string) => traceLines.push(`[STOCK-TRACE]   → ${d}`));
          traceLines.forEach((l: string) => logs.push(l));
        }
        
        let isGeneric = false;
        if (originalTipo) {
          isGeneric = originalTipo.toUpperCase() === "G";
        } else {
          const descLower = originalDesc.toLowerCase();
          const labLower = originalLab.toLowerCase();
          isGeneric = descLower.includes(" gn ") || 
                      descLower.includes("generico") || 
                      descLower.includes("genÃ©rico") ||
                      labLower.includes("generico") || 
                      labLower.includes("genÃ©rico");
          if (isGeneric && descLower.includes(" - ")) {
            isGeneric = false;
          }
        }
                          
        const requestedQty = parseFloat(String(item.qtd).replace(",", ".")) || 1;
        itemPedido.qtd = requestedQty;
        itemPedido.Qtd = requestedQty;

        const condicoesOriginal = [...condicoesRaw, ...substitutosRaw].filter((s: any) => cleanEan(s.Ean || s.ean || "") === cleanEan(item.ean));
        let originalHasStock = false;
        if (condicoesOriginal.length > 0) {
            originalHasStock = condicoesOriginal.some((s: any) => {
                const rawEst = s.Estoque !== undefined ? s.Estoque : (s.estoque !== undefined ? s.estoque : 0);
                const est = parseSmartPedEstoque(rawEst, getUnitCost(s) > 0);
                return est > 0;
            });
        }

        // Quando o item original NÃO tem estoque (ruptura), salvar substitutos brutos como alternativas
        const rawSubstitutosForAlternatives = deduplicatedAlternativesForRupture;

        logs.push(`[DEBUG-ALTS] EAN ${item.ean} | rawSubstitutosForAlternatives: ${rawSubstitutosForAlternatives.length} itens | substitutos (pós-filtro): ${substitutos.length} | finalAlternatives (pré-build): aguardando...`);

        const effectiveOriginalHasStock = !exigirEstoque || originalHasStock;

        logs.push(`[PRODUTO] Analisando EAN ${item.ean} - "${originalDesc}" | Qtd Solicitada: ${requestedQty} | PreÃ§o Base: R$ ${item.precoOriginal.toFixed(2)} | GenÃ©rico: ${isGeneric ? 'Sim' : 'NÃ£o'} | Tem Estoque: ${originalHasStock ? 'Sim' : 'NÃ£o'}`);
        logs.push(`[PRODUTO] Total de medicamentos substitutos elegÃ­veis cadastrados no distribuidor: ${substitutos.length}`);
        
        // CONSULTAR EANS ALVO ANTES DO MOTOR DE TROCA
        // Coletar todos EANs únicos de substitutos (diferentes do original) que têm ofertas válidas
        const targetEans = new Set<string>();
        for (const s of combinedSubstitutos) {
          const sEan = cleanEan(s.Ean || s.ean || "");
          if (sEan && sEan !== origEan) targetEans.add(sEan);
        }
        logs.push(`[TARGET-EAN-PRE] targetEans.size = ${targetEans.size} | EANs: [${Array.from(targetEans).join(", ")}]`);
        
        if (targetEans.size > 0) {
          try {
            // Separar EANs que já temos no apiResponses (cache do batch) dos que precisam de consulta
            const targetEansArray = Array.from(targetEans);
            const uncachedTargetEans = targetEansArray.filter(te => !apiResponses[te]);
            const cachedTargetEans = targetEansArray.filter(te => !!apiResponses[te]);
            
            if (cachedTargetEans.length > 0) {
              logs.push(`[TARGET-EAN-PRE] ${cachedTargetEans.length} EAN(s) alvo já em cache do batch: [${cachedTargetEans.join(", ")}]`);
              // Usar dados do apiResponses para EANs já cached
              for (const targetEan of cachedTargetEans) {
                const cachedResp = apiResponses[targetEan];
                const allItens = [...(cachedResp?.ItemPedido ? [cachedResp.ItemPedido] : []), ...(cachedResp?.Substitutos || [])];
                for (const item of allItens) {
                  const itemCondicoes = item.Condicoes || item.condicoes || [];
                  // Adicionar Condicoes ao combinedCondicoes para enriquecimento de CodProdutoDist
                  if (itemCondicoes.length > 0) {
                    combinedCondicoes.push(...itemCondicoes);
                  }
                  for (const c of itemCondicoes) {
                    const cEan = cleanEan(c.Ean || c.ean || targetEan);
                    const cCodDist = c.CodDist !== undefined ? c.CodDist : (c.codDist !== undefined ? c.codDist : 0);
                    const cCond = c.Condicao || c.condicao || "FIXA";
                    const cPrazo = c.Prazo !== undefined ? c.Prazo : (c.prazo || 7);
                    const cPreco = getUnitCost(c);
                    const cEst = parseSmartPedEstoque(c.Estoque !== undefined ? c.Estoque : (c.estoque || 0), cPreco > 0);
                    const cDist = c.NomeDist || c.nomeDist || DISTRIBUIDORAS_MAP[cCodDist] || `Distribuidor ${cCodDist}`;
                    if (cPreco <= 0 || cEst <= 0) continue;
                    if (cCodDist && disabledDistSet.has(Number(cCodDist))) continue;
                    combinedSubstitutos.push({ Ean: cEan, Descricao: item.Descricao || item.descricao || "", Laboratorio: item.Laboratorio || item.laboratorio || "", TipoItem: "G", Pliquido: cPreco, PliquidoUni: cPreco, Estoque: cEst, NomeDist: cDist, CodDist: cCodDist, Condicao: cCond, Prazo: cPrazo, QtdMin: c.QtdMin !== undefined ? c.QtdMin : (c.qtdMin !== undefined ? c.qtdMin : 0), CX: c.CX !== undefined ? c.CX : (c.cx || 1), CodProdutoDist: c.CodProdutoDist || c.codProdutoDist || "" });
                  }
                }
              }
            }

            if (uncachedTargetEans.length > 0) {
              logs.push(`[TARGET-EAN-PRE] Consultando ${uncachedTargetEans.length} EAN(s) alvo na API: [${uncachedTargetEans.join(", ")}]`);
          const searchPromises = uncachedTargetEans.map(targetEan => {
            const headers = { "Content-Type": "application/json", "Accept": "application/json", "User-Agent": "Mozilla/5.0" };
            const eanBody = JSON.stringify({ Token: actualToken, parametros: { CnpjCLi: apiCnpj, Ean: targetEan, AceitaOntem: 1 } });
            const molBody = JSON.stringify({ Token: actualToken, parametros: { CnpjCLi: apiCnpj, Ean: targetEan, ConsideraTipo: 1 } });
            return Promise.all([
              fetch(`${baseUrl.replace(/\/$/, "")}/api/Condicoes/Ean`, { method: "POST", headers, body: eanBody }).then(r => r.ok ? r.json() : null).catch(() => null),
              fetch(`${baseUrl.replace(/\/$/, "")}/api/Condicoes/Molecula`, { method: "POST", headers, body: molBody }).then(r => r.ok ? r.json() : null).catch(() => null)
            ]);
          });
          const searchResults = await Promise.all(searchPromises);
          
          for (let i = 0; i < searchResults.length; i++) {
            const [eanData, molData] = searchResults[i];
            const targetEan = uncachedTargetEans[i];
            const eanItens = eanData?.Retorno?.itens || [];
            const molItens = molData?.Retorno?.itens || [];
            const allItens = [...eanItens, ...molItens];
            if (!allItens.length) continue;
            
            for (const item of allItens) {
              const itemCondicoes = item.Condicoes || item.condicoes || [];
              // Adicionar Condicoes ao combinedCondicoes para que o 2º enriquecimento possa encontrar CodProdutoDist
              if (itemCondicoes.length > 0) {
                combinedCondicoes.push(...itemCondicoes);
              }
              for (const c of itemCondicoes) {
                const cEan = cleanEan(c.Ean || c.ean || targetEan);
                const cCodDist = c.CodDist !== undefined ? c.CodDist : (c.codDist !== undefined ? c.codDist : 0);
                const cCond = c.Condicao || c.condicao || "FIXA";
                const cPrazo = c.Prazo !== undefined ? c.Prazo : (c.prazo || 7);
                const cPreco = getUnitCost(c);
                const cEst = parseSmartPedEstoque(c.Estoque !== undefined ? c.Estoque : (c.estoque || 0), cPreco > 0);
                const cDist = c.NomeDist || c.nomeDist || DISTRIBUIDORAS_MAP[cCodDist] || `Distribuidor ${cCodDist}`;
                
                if (cPreco <= 0 || cEst <= 0) continue;
                if (cCodDist && disabledDistSet.has(Number(cCodDist))) continue;
                
                combinedSubstitutos.push({
                  Ean: cEan,
                  Descricao: item.Descricao || item.descricao || "",
                  Laboratorio: item.Laboratorio || item.laboratorio || "",
                  TipoItem: "G",
                  Pliquido: cPreco,
                  PliquidoUni: cPreco,
                  Estoque: cEst,
                  NomeDist: cDist,
                  CodDist: cCodDist,
                  Condicao: cCond,
                  Prazo: cPrazo,
                  QtdMin: c.QtdMin !== undefined ? c.QtdMin : (c.qtdMin !== undefined ? c.qtdMin : 0),
                  CX: c.CX !== undefined ? c.CX : (c.cx || 1),
                  CodProdutoDist: c.CodProdutoDist || c.codProdutoDist || ""
                });
              }
            }
          }
          } // fim uncachedTargetEans
          logs.push(`[TARGET-EAN-PRE] combinedSubstitutos expandido: ${combinedSubstitutos.length} itens | combinedCondicoes: ${combinedCondicoes.length} entradas`);
        } catch (err) {
          logs.push(`[TARGET-EAN-PRE] ERRO: ${err}`);
        }
        
        // BUSCA POR DESCRIÇÃO EM CASO DE RUPTURA OU GENÉRICO
        // Quando o original não tem estoque (ruptura) OU é genérico, buscar por descrição para encontrar mais opções
        // Genéricos podem ter múltiplos fabricantes com EANs diferentes — busca completa garante cobertura total
        const shouldSearchByDescription = !originalHasStock || isGeneric;
        console.log(`[RUPTURA-REGEX-CHECK] EAN ${item.ean} | originalHasStock=${originalHasStock} | isGeneric=${isGeneric} | vai-buscar-por-descricao? ${shouldSearchByDescription}`);
        if (shouldSearchByDescription) {
          try {
            const descUpper = originalDesc.toUpperCase();
            logs.push(`[RUPTURA-REGEX] Descrição original: "${originalDesc}"`);
            console.log(`[RUPTURA-REGEX] Descrição original: "${originalDesc}"`);
            
            // Extrair princípio ativo + dosagem + quantidade
            // Regex: pegar palavras significativas (não artigos/preposições)
            const stopWords = new Set(['COM', 'CPR', 'COMP', 'REV', 'GEN', 'GENERICO', 'GENÉRICO', 'C/', 'CX', 'EM', 'DE', 'DO', 'DA', 'DOS', 'DAS', 'PARA', 'POR', 'SEM', 'CALCICA', 'CALCIO']);
            const keywords = descUpper
              .replace(/[^A-Z0-9\s]/g, ' ')
              .split(/\s+/)
              .filter(w => w.length > 1 && !stopWords.has(w));
            
            logs.push(`[RUPTURA-REGEX] Keywords extraídas: [${keywords.join(', ')}]`);
            console.log(`[RUPTURA-REGEX] Keywords extraídas: [${keywords.join(', ')}]`);
            
            if (keywords.length >= 2) {
              // Montar padrão de busca: primeiras 3-4 palavras mais significativas
              const searchPattern = keywords.slice(0, 3).join(' ');
              logs.push(`[RUPTURA-REGEX] Padrão de busca montado: "${searchPattern}"`);
              console.log(`[RUPTURA-REGEX] Padrão de busca montado: "${searchPattern}"`);
              
              const descSearchBody = JSON.stringify({
                Token: actualToken,
                parametros: { CnpjCLi: apiCnpj, Texto: searchPattern }
              });
              
              logs.push(`[${!originalHasStock ? 'RUPTURA' : 'GENÉRICO'}-REGEX] Chamando Produtos/Buscar com texto="${searchPattern}"`);
              
              const _ruturaStart = Date.now();
              const descResp = await fetchWithRetry(`${baseUrl.replace(/\/$/, "")}/api/Produtos/Buscar`, {
                method: "POST",
                headers: { "Content-Type": "application/json", "Accept": "application/json", "User-Agent": "Mozilla/5.0" },
                body: descSearchBody
              }, 15000, 1).then(r => r.ok ? r.json() : null).catch(() => null);
              const _ruturaMs = Date.now() - _ruturaStart;
              _ruturaTotalMs += _ruturaMs;
              _ruturaCount++;
              logs.push(`[TIMING-RUPTURA] EAN ${item.ean} levou ${_ruturaMs}ms`);
              console.log(`[TIMING-RUPTURA] EAN ${item.ean} levou ${_ruturaMs}ms`);
              
              const descProdutos = descResp?.Retorno || descResp?.retorno || [];
              logs.push(`[RUPTURA-REGEX] Produtos/Buscar retornou ${descProdutos.length} produtos`);
              console.log(`[RUPTURA-REGEX] Produtos/Buscar retornou ${descProdutos.length} produtos`);
              
              // FILTRO DE APRESENTAÇÃO: remover produtos com apresentação diferente
              const _descProdutosFiltrados = descProdutos.filter((p: any) => mesmaApresentacao(item, p));
              if (_descProdutosFiltrados.length < descProdutos.length) {
                logs.push(`[RUPTURA-REGEX] Filtro apresentação: ${descProdutos.length} → ${_descProdutosFiltrados.length} produtos (removidos ${descProdutos.length - _descProdutosFiltrados.length} com apresentação diferente)`);
              }

              if (Array.isArray(_descProdutosFiltrados) && _descProdutosFiltrados.length > 0) {
                const descEans = Array.from(new Set(
                  _descProdutosFiltrados.map((p: any) => cleanEan(p.Ean || p.ean || p.CodBarra || p.codBarra)).filter(Boolean)
                ));
                
                logs.push(`[RUPTURA-REGEX] EANs extraídos: [${descEans.join(', ')}]`);
                console.log(`[RUPTURA-REGEX] EANs extraídos: [${descEans.join(', ')}]`);
                
                // PASSO 1: Consultar precos_cache para EANs descobertos
                const cachedPrices = await getPrecoCacheByEans(descEans);
                let addedFromCache = 0;
                let addedFromApi = 0;
                
                // Adicionar ofertas do cache (sem chamada API)
                for (const [cachedEan, precos] of cachedPrices) {
                  const produtoInfo = _descProdutosFiltrados.find((p: any) => cleanEan(p.Ean || p.ean || p.CodBarra || p.codBarra) === cachedEan);
                  const descFromProd = produtoInfo?.Descricao || produtoInfo?.descricao || '';
                  const labFromProd = produtoInfo?.Laboratorio || produtoInfo?.laboratorio || '';
                  
                  for (const pc of precos) {
                    if (pc.preco_liquido <= 0 || pc.estoque <= 0) continue;
                    if (pc.cod_dist && disabledDistSet.has(Number(pc.cod_dist))) continue;
                    
                    const alreadyExists = combinedSubstitutos.some((s: any) =>
                      cleanEan(s.Ean || s.ean) === cachedEan && s.CodDist === pc.cod_dist && s.Condicao === pc.condicao && s.Prazo === pc.prazo
                    );
                    
                    if (!alreadyExists) {
                      combinedSubstitutos.push({
                        Ean: cachedEan,
                        Descricao: descFromProd || pc.nome_dist || '',
                        Laboratorio: labFromProd,
                        TipoItem: pc.tipo_item || 'G',
                        Pliquido: pc.preco_liquido,
                        PliquidoUni: pc.preco_liquido,
                        Estoque: pc.estoque,
                        NomeDist: pc.nome_dist || DISTRIBUIDORAS_MAP[pc.cod_dist] || `Distribuidor ${pc.cod_dist}`,
                        CodDist: pc.cod_dist,
                        Condicao: pc.condicao,
                        Prazo: pc.prazo,
                        QtdMin: pc.qtd_min || 0,
                        CX: 1,
                        CodProdutoDist: pc.cod_produto_dist || ""
                      });
                      addedFromCache++;
                    }
                  }
                }
                
                // PASSO 2: Chamar API apenas para EANs ausentes do cache E ainda não consultados neste request
                const eansNotInCache = descEans.filter(ean => !cachedPrices.has(ean) && !queriedEanSet.has(ean));
                const dedupSkipped = descEans.filter(ean => !cachedPrices.has(ean) && queriedEanSet.has(ean)).length;
                if (dedupSkipped > 0) console.log(`[RUPTURA-REGEX] Dedup: ${dedupSkipped} EANs já consultados neste request — pulando`);
                console.log(`[RUPTURA-REGEX] Cache: ${cachedPrices.size}/${descEans.length} EANs | Novos do cache: ${addedFromCache} | API chamada: ${eansNotInCache.length}`);
                
                if (eansNotInCache.length > 0) {
                  // Marcar EANs como consultados para evitar duplicação cross-item
                  for (const ean of eansNotInCache) queriedEanSet.add(ean);
                  
                  const descSearchPromises = eansNotInCache.map(descEan => {
                    const headers = { "Content-Type": "application/json", "Accept": "application/json", "User-Agent": "Mozilla/5.0" };
                    const eanBody = JSON.stringify({ Token: actualToken, parametros: { CnpjCLi: apiCnpj, Ean: descEan, AceitaOntem: 1 } });
                    return fetchWithRetry(`${baseUrl.replace(/\/$/, "")}/api/Condicoes/Ean`, { method: "POST", headers, body: eanBody }, 15000, 1)
                      .then(r => r.ok ? r.json() : null)
                      .catch(() => null);
                  });
                  
                  const descResults = await Promise.all(descSearchPromises);
                  
                  // Salvar resultados da API no precos_cache para reuso futuro
                  const toCache: { ean: string; codDist: number; condicao: string; prazo: number; precoLiquido: number; estoque: number; nomeDist: string; qtdMin: number; tipoItem?: string }[] = [];
                  
                  for (const descData of descResults) {
                    const descItens = descData?.Retorno?.itens || [];
                    for (const di of descItens) {
                      const diCondicoes = di.Condicoes || di.condicoes || [];
                      // Adicionar Condicoes ao combinedCondicoes para enriquecimento de CodProdutoDist
                      if (diCondicoes.length > 0) {
                        combinedCondicoes.push(...diCondicoes);
                      }
                      for (const dc of diCondicoes) {
                        const dcEan = cleanEan(dc.Ean || dc.ean || '');
                        const dcCodDist = dc.CodDist !== undefined ? dc.CodDist : (dc.codDist !== undefined ? dc.codDist : 0);
                        const dcPreco = getUnitCost(dc);
                        const dcEst = parseSmartPedEstoque(dc.Estoque !== undefined ? dc.Estoque : (dc.estoque || 0), dcPreco > 0);
                        const dcCond = dc.Condicao || dc.condicao || 'FIXA';
                        const dcPrazo = dc.Prazo !== undefined ? dc.Prazo : (dc.prazo || 7);
                        const dcDist = dc.NomeDist || dc.nomeDist || DISTRIBUIDORAS_MAP[dcCodDist] || `Distribuidor ${dcCodDist}`;
                        
                        if (dcPreco <= 0 || dcEst <= 0) continue;
                        if (dcCodDist && disabledDistSet.has(Number(dcCodDist))) continue;
                        
                        // Coletar para cache
                        toCache.push({
                          ean: dcEan,
                          codDist: dcCodDist,
                          condicao: dcCond,
                          prazo: dcPrazo,
                          precoLiquido: dcPreco,
                          estoque: dcEst,
                          nomeDist: dcDist,
                          qtdMin: dc.QtdMin !== undefined ? dc.QtdMin : (dc.qtdMin !== undefined ? dc.qtdMin : 0),
                          tipoItem: 'G'
                        });
                        
                        const alreadyExists = combinedSubstitutos.some((s: any) =>
                          cleanEan(s.Ean || s.ean) === dcEan && s.CodDist === dcCodDist && s.Condicao === dcCond && s.Prazo === dcPrazo
                        );
                        
                        if (!alreadyExists) {
                          combinedSubstitutos.push({
                            Ean: dcEan,
                            Descricao: di.Descricao || di.descricao || '',
                            Laboratorio: di.Laboratorio || di.laboratorio || '',
                            TipoItem: 'G',
                            Pliquido: dcPreco,
                            PliquidoUni: dcPreco,
                            Estoque: dcEst,
                            NomeDist: dcDist,
                            CodDist: dcCodDist,
                            Condicao: dcCond,
                            Prazo: dcPrazo,
                            QtdMin: dc.QtdMin !== undefined ? dc.QtdMin : (dc.qtdMin !== undefined ? dc.qtdMin : 0),
                            CX: dc.CX !== undefined ? dc.CX : (dc.cx || 1),
                            CodProdutoDist: dc.CodProdutoDist || dc.codProdutoDist || ""
                          });
                          addedFromApi++;
                        }
                      }
                    }
                  }
                  
                  // Salvar em batch no precos_cache
                  if (toCache.length > 0) {
                    await savePrecosCacheBatch(toCache);
                    console.log(`[RUPTURA-REGEX] ${toCache.length} preços salvos no precos_cache para reuso futuro`);
                  }
                }
                
                logs.push(`[RUPTURA-REGEX] Cache: ${addedFromCache} | API: ${addedFromApi} | Total: ${combinedSubstitutos.length}`);
                console.log(`[RUPTURA-REGEX] Cache: ${addedFromCache} | API: ${addedFromApi} | Total: ${combinedSubstitutos.length}`);
              } else {
                logs.push(`[RUPTURA-REGEX] Nenhum produto encontrado para "${searchPattern}"`);
              }
            } else {
              logs.push(`[RUPTURA-REGEX] Keywords insuficientes (${keywords.length}): [${keywords.join(', ')}]`);
            }
          } catch (err) {
            logs.push(`[RUPTURA-REGEX] ERRO: ${err}`);
          }
        }
        
        // Re-filtrar equivalência e rebuild substitutos/condicoes
          combinedSubstitutos = combinedSubstitutos.filter((s: any) => validateSwapEquivalence(mainItemPedido, s));

          // Re-filtrar labs WhatsApp (pós-RUPTURA-REGEX)
          if (whatsappLabNames.size > 0) {
            combinedSubstitutos = combinedSubstitutos.filter((s: any) => {
              const sLab = (s.Laboratorio || s.laboratorio || "").toUpperCase().trim();
              const isFromRegisteredLab = [...whatsappLabNames].some(lab => sLab.includes(lab) || lab.includes(sLab));
              return !isFromRegisteredLab;
            });
          }
          
          // Rebuild substitutosRaw e condicoesRaw
          substitutosRaw = combinedSubstitutos;
          condicoesRaw = combinedCondicoes;
          logs.push(`[DIAG-CONDICOES] EAN ${item.ean} | combinedCondicoes.length=${combinedCondicoes.length} | combinedSubstitutos.length=${combinedSubstitutos.length}`);
          if (combinedCondicoes.length > 0) {
            const cppdCount = combinedCondicoes.filter((c: any) => c.CodProdutoDist || c.codProdutoDist).length;
            logs.push(`[DIAG-CONDICOES]   ${cppdCount} entries with CodProdutoDist out of ${combinedCondicoes.length}`);
          }
          
          // Rebuild stockMapByEanDist
          stockMapByEanDist.clear();
          for (const s of combinedSubstitutos) {
            const sEan = cleanEan(s.Ean || s.ean || "");
            const sCodDist = s.CodDist !== undefined ? s.CodDist : (s.codDist !== undefined ? s.codDist : 0);
            const sPreco = getUnitCost(s);
            const sEst = parseSmartPedEstoque(s.Estoque !== undefined ? s.Estoque : (s.estoque !== undefined ? s.estoque : 0), sPreco > 0);
            if (sEan && sCodDist && sEst > 0) {
              stockMapByEanDist.set(`${sEan}_${sCodDist}`, sEst);
            }
          }
          
          // Rebuild substitutos (com filtro disabledDistSet + equivalência)
          substitutos = substitutosRaw.filter((s: any) => {
            const dist = s.CodDist !== undefined ? s.CodDist : s.codDist;
            if (dist !== undefined && disabledDistSet.has(Number(dist))) return false;
            const sEan = cleanEan(s.Ean || s.ean || "");
            const sCodDist = Number(dist);
            // Bloquear fornecedores que falharam por falta de estoque nos últimos 2 dias
            if (blockedSuppliers.has(sEan) && blockedSuppliers.get(sEan)!.has(sCodDist)) return false;
            return validateSwapEquivalence(itemPedido, s);
          });
          
          // Rebuild condicoes (com filtro disabledDistSet)
          condicoes = condicoesRaw.filter((c: any) => {
            const dist = c.CodDist !== undefined ? c.CodDist : c.codDist;
            if (dist === undefined) return true;
            if (disabledDistSet.has(Number(dist))) return false;
            const cEan = cleanEan(c.Ean || c.ean || "");
            const cCodDist = Number(dist);
            // Bloquear fornecedores que falharam por falta de estoque nos últimos 2 dias
            if (blockedSuppliers.has(cEan) && blockedSuppliers.get(cEan)!.has(cCodDist)) return false;
            return true;
          });
          
          // Rebuild condicoesEnriched
condicoesEnriched = condicoes.map((c: any) => {
            const cEan = cleanEan(c.Ean || c.ean || "");
            const cCodDist = c.CodDist !== undefined ? c.CodDist : (c.codDist !== undefined ? c.codDist : 0);
            const key = `${cEan}_${cCodDist}`;
            const mappedEstoque = stockMapByEanDist.get(key);
            if (mappedEstoque !== undefined) return { ...c, Estoque: mappedEstoque };
            return c;
          });

          // Segunda rodada de enriquecimento: substitutos sem codProdutoDist → buscar em combinedCondicoes
          // (agora com TARGET-EAN-PRE e RUPTURA-REGEX já adicionaram mais Condicoes)
          // Busca em 2 fontes: (1) combinedCondicoes e (2) apiResponses[sEan].Condicoes
          {
            for (const s of substitutos) {
              if (!s.CodProdutoDist && !s.codProdutoDist) {
                const sEan = cleanEan(s.Ean || s.ean || "");
                const sCodDist = s.CodDist !== undefined ? s.CodDist : (s.codDist !== undefined ? s.codDist : 0);
                if (sEan && sCodDist) {
                  // Fonte 1: combinedCondicoes (dos EANs originais/equivalentes + RUPTURA-REGEX)
                  let match = combinedCondicoes.find((c: any) => {
                    const cEan = cleanEan(c.Ean || c.ean || "");
                    const cCodDist = c.CodDist !== undefined ? c.CodDist : (c.codDist !== undefined ? c.codDist : 0);
                    return cEan === sEan && cCodDist === sCodDist && (c.CodProdutoDist || c.codProdutoDist);
                  });
                  // Fonte 2: apiResponses[sEan].Condicoes (Condicoes/Ean buscadas para EANs de substitutos)
                  if (!match && apiResponses[sEan]?.Condicoes?.length > 0) {
                    match = apiResponses[sEan].Condicoes.find((c: any) => {
                      const cCodDist = c.CodDist !== undefined ? c.CodDist : (c.codDist !== undefined ? c.codDist : 0);
                      return cCodDist === sCodDist && (c.CodProdutoDist || c.codProdutoDist);
                    });
                  }
                  if (match) {
                    s.CodProdutoDist = match.CodProdutoDist || match.codProdutoDist;
                    s.codProdutoDist = s.CodProdutoDist;
                    logs.push(`[ENRICH-CODPRODDIST] OK: EAN=${sEan} CodDist=${sCodDist} → CodProdutoDist=${s.CodProdutoDist}`);
                  } else {
                    logs.push(`[ENRICH-CODPRODDIST] MISS: EAN=${sEan} CodDist=${sCodDist} não encontrado em nenhuma fonte`);
                  }
                }
              }
            }
          }

          // Rebuild itemAlternatives e finalAlternatives (dropdown do usuário)
          const _descLabIndex2 = buildDescLabIndex();
          itemAlternatives = [...condicoesEnriched, ...substitutos]
            .filter((s: any) => {
              const est = s.Estoque !== undefined ? s.Estoque : (s.estoque || 0);
              { const _t0 = Date.now(); const _r = getUnitCost(s) <= 0; _tPrice += Date.now() - _t0; _cPrice++; if (_r) return false; }
              if (est <= 0) return false;
              { const _t0 = Date.now(); const _dn = resolveDistName(s); const _nf = isNotFoundName(_dn); _tDistName += Date.now() - _t0; _cDistName++; if (_nf) return false; }
              const codDist = s.CodDist !== undefined ? s.CodDist : (s.codDist !== undefined ? s.codDist : 0);
              const altEan = cleanEan(s.Ean || s.ean || "");
              // Bloquear fornecedores que falharam por falta de estoque nos últimos 2 dias
              if (blockedSuppliers.has(altEan) && blockedSuppliers.get(altEan)!.has(Number(codDist))) return false;
              { const _t0 = Date.now(); const _r = validateSwapEquivalence(itemPedido, s); _tValidate += Date.now() - _t0; _cValidate++; return _r; }
            })
            .map((s: any) => {
              const codDist = s.CodDist !== undefined ? s.CodDist : (s.codDist !== undefined ? s.codDist : 0);
              const condicao = s.Condicao || s.condicao || "FIXA";
              const prazo = s.Prazo !== undefined ? s.Prazo : (s.prazo !== undefined ? s.prazo : 0);
              { const _t0 = Date.now(); var unitPrice = getUnitCost(s); var tablePrice = extractTablePrice(s); var apiPmc = extractPmc(s); _tPrice += Date.now() - _t0; _cPrice++; }
              const baseForPmc = tablePrice > 0 ? tablePrice : unitPrice;
              if (!apiPmc && cleanEan(s.Ean || s.ean || "") === cleanEan(item.ean)) {
                apiPmc = extractPmc(itemPedido);
              }
              const unitPmc = apiPmc > 0 ? apiPmc : 0;
              const altEan = cleanEan(s.Ean || s.ean || "") || cleanEan(item.ean);
              let altDesc = s.Descricao || s.DescricaoProduto_Idi || s.descricao || s.descricaoProduto_Idi;
              let resolvedLab = s.Laboratorio || s.laboratorio;
              if (altEan === origEan) {
                if (!altDesc) altDesc = originalDesc;
                if (!resolvedLab) resolvedLab = originalLab;
              }
              if (!altDesc || !resolvedLab) {
                const _dlStart2 = Date.now();
                const _idx2 = _descLabIndex2.get(altEan);
                _descLookupTotalMs += Date.now() - _dlStart2;
                _descLookupCount++;
                if (_idx2) {
                  if (!altDesc) altDesc = _idx2.descricao;
                  if (!resolvedLab) resolvedLab = _idx2.laboratorio;
                }
              }
              if (!altDesc) {
                const dbRecord = getEanDatabaseRecord(altEan);
                if (dbRecord && dbRecord.descricao) {
                  altDesc = dbRecord.descricao;
                  if (!resolvedLab) resolvedLab = dbRecord.laboratorio;
                } else if (altEan === cleanEan(item.ean)) {
                  altDesc = originalDesc;
                } else {
                  altDesc = `Medicamento Equivalente (EAN: ${altEan})`;
                }
              }
              return {
                ean: altEan,
                descricao: altDesc,
                laboratorio: resolvedLab || originalLab || "GENÉRICO",
                preco: unitPrice,
                pmc: unitPmc,
                condicao: condicao,
                distribuidora: resolveDistName(s, codDist),
                codDist: codDist,
                prazo: prazo,
                qtdMin: s.QtdMin !== undefined ? s.QtdMin : (s.qtdMin !== undefined ? s.qtdMin : 0),
                qtdMax: (s.Combo && s.Combo.QtdMax !== undefined) ? s.Combo.QtdMax : ((s.combo && s.combo.qtdMax !== undefined) ? s.combo.qtdMax : 0),
                cx: s.CX !== undefined ? s.CX : (s.cx !== undefined ? s.cx : 1),
                estoque: s.Estoque !== undefined ? s.Estoque : (s.estoque || 0),
                codProdutoDist: s.CodProdutoDist || s.codProdutoDist || "",
                codProduto: cleanCodProduto(s.CodProduto || s.codProduto || "", s.CodProdutoDist || s.codProdutoDist || "")
              };
            })
            .filter((alt: any) => {
              if (!alt.codProdutoDist) {
                return false;
              }
              return true;
            });

          const uniqueAltsMap2 = new Map<string, any>();
          itemAlternatives.forEach(alt => {
            const key = `${alt.ean}_${alt.distribuidora}_${alt.condicao}_${alt.preco.toFixed(2)}_${alt.prazo}`;
            if (!uniqueAltsMap2.has(key)) {
              uniqueAltsMap2.set(key, alt);
            }
          });
          finalAlternatives = Array.from(uniqueAltsMap2.values()).sort((a: any, b: any) => {
            const aReal = isRealOffer(a);
            const bReal = isRealOffer(b);
            if (aReal && !bReal) return -1;
            if (!aReal && bReal) return 1;
            return a.preco - b.preco;
          });
          logs.push(`[REBUILD] EAN ${item.ean} | itemAlternatives: ${itemAlternatives.length} | finalAlternatives: ${finalAlternatives.length}`);
        }
        
        // LOG ANTES DO MOTOR DE TROCA
        const allCandidates = [...condicoesEnriched, ...substitutos];
        const candidatesWithStock = allCandidates.filter((s: any) => {
          const est = parseSmartPedEstoque(s.Estoque !== undefined ? s.Estoque : (s.estoque || 0), getUnitCost(s) > 0);
          return est > 0 && getUnitCost(s) > 0;
        });
        logs.push(`[MOTOR-DEBUG] ANTES findBestSubstitute | combinedSubstitutos=${combinedSubstitutos.length} | condicoesEnriched=${condicoesEnriched.length} | substitutos=${substitutos.length} | allCandidates=${allCandidates.length} | candidatesWithStock=${candidatesWithStock.length}`);
        console.log(`[MOTOR-DEBUG] ANTES findBestSubstitute | combinedSubstitutos=${combinedSubstitutos.length} | condicoesEnriched=${condicoesEnriched.length} | substitutos=${substitutos.length} | allCandidates=${allCandidates.length} | candidatesWithStock=${candidatesWithStock.length}`);
        
        // DIAG: candidatos ANB (CodDist=59) com EAN 7896112126478
        const metCandidates = allCandidates.filter((c: any) => {
          const cEan = cleanEan(c.Ean || c.ean || '');
          const cCodDist = c.CodDist !== undefined ? c.CodDist : (c.codDist !== undefined ? c.codDist : 0);
          return cEan === '7896112126478' && cCodDist === 59;
        });
        metCandidates.forEach((c: any, i: number) => {
          const cpd = c.CodProdutoDist || c.codProdutoDist || 'EMPTY';
          const src = (condicoesEnriched.includes(c)) ? 'condicoesEnriched' : 'substitutos';
          logs.push(`[DIAG-METFORMINA] cand[${i}] fonte=${src} CodProdutoDist=${cpd} preco=${getUnitCost(c)} desc=${(c.Descricao||c.descricao||'').substring(0,30)}`);
        });

        // Listar top 5 candidatos por preço
        const top5 = candidatesWithStock
          .sort((a: any, b: any) => getUnitCost(a) - getUnitCost(b))
          .slice(0, 5);
        top5.forEach((c: any, i: number) => {
          const ean = cleanEan(c.Ean || c.ean || '');
          const desc = c.Descricao || c.descricao || '';
          const dist = c.NomeDist || c.nomeDist || '';
          const preco = getUnitCost(c);
          const est = parseSmartPedEstoque(c.Estoque !== undefined ? c.Estoque : (c.estoque || 0), preco > 0);
          logs.push(`[MOTOR-DEBUG]   ${i+1}. EAN:${ean} "${desc.substring(0, 30)}" | dist:${dist} | preco:${preco} | estoque:${est}`);
        });
        
        const _fbsT0 = Date.now();
        const result = findBestSubstitute(itemPedido, [...condicoesEnriched, ...substitutos], margemMinima, tiposAceitos, exigirEstoque, item.precoOriginal, effectiveOriginalHasStock, isGeneric, cortesRecentes, bypassMargemRuptura);
        const _fbsMs = Date.now() - _fbsT0;
        _tFindBest += _fbsMs; _cFindBest++;
        if (_fbsMs > _maxFindBest) { _maxFindBest = _fbsMs; _maxFindBestCands = condicoesEnriched.length + substitutos.length; }
        let finalResult = result;
        
        // LOG DEPOIS DO MOTOR DE TROCA
        if (finalResult) {
          let m = finalResult.melhor;
          const eanEscolhido = cleanEan(m.Ean || m.ean || '');
          const descEscolhido = (m.Descricao || m.descricao || '').substring(0, 40);
          const distEscolhido = m.NomeDist || m.nomeDist || '';
          const precoEscolhido = getUnitCost(m);
          logs.push(`[MOTOR-DEBUG] DEPOIS findBestSubstitute | ESCOLHIDO: EAN:${eanEscolhido} "${descEscolhido}" | dist:${distEscolhido} | preco:${precoEscolhido} | economia:${finalResult.economia?.toFixed(2)} | CodProdutoDist:${m.CodProdutoDist || m.codProdutoDist || 'EMPTY'}`);
          console.log(`[MOTOR-DEBUG] DEPOIS findBestSubstitute | ESCOLHIDO: EAN:${eanEscolhido} "${descEscolhido}" | dist:${distEscolhido} | preco:${precoEscolhido} | economia:${finalResult.economia?.toFixed(2)} | CodProdutoDist:${m.CodProdutoDist || m.codProdutoDist || 'EMPTY'}`);

          // FORÇAR BUSCA: Se CodProdutoDist vazio, buscar Condicoes/Ean novamente para EAN+CodDist
          if (!m.CodProdutoDist && !m.codProdutoDist) {
            const retryEan = cleanEan(m.Ean || m.ean || "");
            const retryCodDist = m.CodDist !== undefined ? m.CodDist : (m.codDist !== undefined ? m.codDist : 0);
            if (retryEan && retryCodDist) {
              logs.push(`[RETRY-CODPRODDIST] CodProdutoDist vazio para EAN=${retryEan} CodDist=${retryCodDist}. Buscando Condicoes/Ean novamente...`);
              try {
                const retryHeaders = { "Content-Type": "application/json", "Accept": "application/json", "User-Agent": "Mozilla/5.0" };
                const retryBody = JSON.stringify({ Token: actualToken, parametros: { CnpjCLi: apiCnpj, Ean: retryEan, AceitaOntem: 1 } });
                const retryResp = await fetchWithRetry(`${baseUrl.replace(/\/$/, "")}/api/Condicoes/Ean`, {
                  method: "POST",
                  headers: retryHeaders,
                  body: retryBody
                }, 15000, 1);
                if (retryResp.ok) {
                  const retryJson = await retryResp.json();
                  const retryItens = retryJson.Retorno?.itens || retryJson.Retorno?.Itens || retryJson.itens || retryJson.Itens || [];
                  for (const entry of retryItens) {
                    const conds = entry.Condicoes || entry.condicoes || [];
                    for (const c of conds) {
                      const cCodDist = c.CodDist !== undefined ? c.CodDist : (c.codDist !== undefined ? c.codDist : 0);
                      const cCpd = c.CodProdutoDist || c.codProdutoDist || "";
                      if (cCodDist === retryCodDist && cCpd) {
                        m.CodProdutoDist = cCpd;
                        m.codProdutoDist = cCpd;
                        logs.push(`[RETRY-CODPRODDIST] OK: EAN=${retryEan} CodDist=${retryCodDist} → CodProdutoDist=${cCpd}`);
                        break;
                      }
                    }
                    if (m.CodProdutoDist || m.codProdutoDist) break;
                  }
                  if (!m.CodProdutoDist && !m.codProdutoDist) {
                    logs.push(`[RETRY-CODPRODDIST] MISS: EAN=${retryEan} CodDist=${retryCodDist} — CodProdutoDist ainda vazio após retry`);
                    // DISCARD: Re-run motor excluding the failed candidate
                    const failedEan = retryEan;
                    const failedCodDist = retryCodDist;
                    const remainingCandidates = [...condicoesEnriched, ...substitutos].filter((c: any) => {
                      const cEan = cleanEan(c.Ean || c.ean || '');
                      const cCodDist = c.CodDist !== undefined ? c.CodDist : (c.codDist !== undefined ? c.codDist : 0);
                      return !(cEan === failedEan && cCodDist === failedCodDist);
                    });
                    logs.push(`[RETRY-CODPRODDIST] Re-run motor: ${remainingCandidates.length} candidatos restantes (excluído EAN=${failedEan} CodDist=${failedCodDist})`);
                    const _fbsR0 = Date.now();
                    const retryResult = findBestSubstitute(itemPedido, remainingCandidates, margemMinima, tiposAceitos, exigirEstoque, item.precoOriginal, effectiveOriginalHasStock, isGeneric, cortesRecentes, bypassMargemRuptura);
                    const _fbsRMs = Date.now() - _fbsR0;
                    _tFindBest += _fbsRMs; _cFindBest++;
                    if (_fbsRMs > _maxFindBest) { _maxFindBest = _fbsRMs; _maxFindBestCands = remainingCandidates.length; }
                    if (retryResult) {
                      const rm = retryResult.melhor;
                      const rCpd = rm.CodProdutoDist || rm.codProdutoDist;
                      if (rCpd) {
                        finalResult = retryResult;
                        m = rm;
                        logs.push(`[RETRY-CODPRODDIST] RE-RUN OK: ${rm.NomeDist || rm.nomeDist} EAN=${cleanEan(rm.Ean || rm.ean || '')} CodProdutoDist=${rCpd}`);
                      } else {
                        finalResult = null;
                        logs.push(`[RETRY-CODPRODDIST] RE-RUN also empty CodProdutoDist — Descartando substituto para este item`);
                      }
                    } else {
                      finalResult = null;
                      logs.push(`[RETRY-CODPRODDIST] RE-RUN: nenhum substituto restante`);
                    }
                  }
                  // Atualizar apiResponses com as novas condições para reuso
                  if (!apiResponses[retryEan]) {
                    apiResponses[retryEan] = { ItemPedido: { Ean: retryEan }, Substitutos: [], Condicoes: [] };
                  }
                  for (const entry of retryItens) {
                    const conds = entry.Condicoes || entry.condicoes || [];
                    if (conds.length > 0) {
                      const existingConds = apiResponses[retryEan].Condicoes || [];
                      apiResponses[retryEan].Condicoes = [...existingConds, ...conds];
                    }
                  }
                }
              } catch (retryErr: any) {
                logs.push(`[RETRY-CODPRODDIST] ERRO: ${retryErr.message}`);
              }
            }
          }
        } else {
          logs.push(`[MOTOR-DEBUG] DEPOIS findBestSubstitute | NENHUM substituto encontrado`);
          console.log(`[MOTOR-DEBUG] DEPOIS findBestSubstitute | NENHUM substituto encontrado`);
        }

        if (!finalResult && !originalHasStock) {
          logs.push(`[ALERTA] Medicamento ${item.ean} sem estoque suficiente (${requestedQty}). Buscando alternativas similares...`);
           const _fsT0 = Date.now();
           const similares = marketSimilarMap[cleanEan(item.ean)] || [];
           _tFallbackSimilares += Date.now() - _fsT0;
           _cFallbackSimilares++;
            const mappedSimilares = similares.map((s: any) => {
               const est = parseInt(String(s.qtd_estoque !== undefined ? s.qtd_estoque : (s.Estoque !== undefined ? s.Estoque : (s.estoque !== undefined ? s.estoque : 0))), 10) || 0;
               const smartPedPrice = getUnitCost(s);
               const price = smartPedPrice > 0 ? smartPedPrice : parseFloat(String(s.vlr_custopersonalizado !== undefined ? s.vlr_custopersonalizado : (s.vlr_custo !== undefined ? s.vlr_custo : 0)));
               // Classificacao via resolveCategoria
               const categoria: CategoriaProduto = resolveCategoria(s);
               const tipoMap: Record<CategoriaProduto, string> = { generico: "G", marca: "M", similar: "S", perfumaria: "P", outros: "O" };
               return {
                 Ean: s.cod_barra || s.Ean || s.ean || "",
                 Descricao: s.nom_produto || s.Descricao || s.descricao || "",
                 Laboratorio: s.nom_laborat || s.Laboratorio || s.laboratorio || "",
                 Estoque: est,
                 Pliquido: price,
                 PliquidoUni: price,
                 TipoItem: s.TipoItem || s.tipoItem || tipoMap[categoria],
                 NomeDist: s.NomeDist || s.nomeDist || "Não Encontrados",
                 CodDist: s.CodDist !== undefined ? s.CodDist : (s.codDist !== undefined ? s.codDist : 0),
                 Condicao: s.Condicao || s.condicao || "FIXA",
                 Prazo: s.Prazo !== undefined ? s.Prazo : (s.prazo || 7),
                 grupo: s.grupo || s.classificacao || "",
                 categoria
              };
          });
          let candidatos = mappedSimilares.filter(s => {
             const sEan = cleanEan(s.Ean);
             const distNameClean = normalizeDistName(s.NomeDist);
             const blockedDistsForEan = cortesRecentes[sEan] || [];
             if (blockedDistsForEan.includes(distNameClean)) {
               return false;
             }
             if (!validateSwapEquivalence(item.descricao, s.Descricao)) {
               return false;
             }
             return (!exigirEstoque || s.Estoque > 0) && s.Pliquido > 0;
          });

          // Se houver qualquer oferta de distribuidora real, removemos as ofertas fantasmas ("NÃ£o Encontrados")
          const temRealCand = candidatos.some(c => isRealOffer(c));
          if (temRealCand) {
            candidatos = candidatos.filter(c => isRealOffer(c));
          }

          if (candidatos.length > 0) {
            candidatos.sort((a,b) => {
              const aReal = isRealOffer(a);
              const bReal = isRealOffer(b);
              if (aReal && !bReal) return -1;
              if (!aReal && bReal) return 1;
              return getUnitCost(a) - getUnitCost(b);
            });
            const melhor = candidatos[0];
            finalResult = { melhor, economia: item.precoOriginal - getUnitCost(melhor), isFallback: true };
            logs.push(`[SUCESSO] Alternativa genÃ©rica encontrada: EAN ${melhor.Ean} (${melhor.Descricao}) com estoque: ${melhor.Estoque}`);
          }
        }

          // Computar a melhor opÃ§Ã£o original mesmo se encontrarmos um substituto, para o caso do usuÃ¡rio clicar em "Manter original"
          let bestOriginalDist = "Não Encontrados";
          let bestOriginalCodDist = 0;
          let bestOriginalEstoque = 0;
          let bestOriginalCondicao = "FIXA";
          let bestOriginalCodProdutoDist = "";
          let bestOriginalPrazo = 7;
          let bestOriginalCodProduto = "";
          let bestOriginalNovoPreco = item.precoOriginal;
          let bestOriginalObservacao = "";
          let bestOriginalQtdMin = 0;
          let bestOriginalQtdMax = 0;
          let bestOriginalCx = 1;
          let bestOriginalQtdMinima = 0;

          const todasCondicoesOriginal = [...condicoesRaw, ...substitutosRaw].filter((s: any) => {
            if (cleanEan(s.Ean || s.ean || "") !== cleanEan(item.ean)) {
              return false;
            }
            const sEan = cleanEan(s.Ean || s.ean || "");
            const distNameClean = normalizeDistName(s.NomeDist || s.nomeDist || s.distribuidora || "");
            const blockedDistsForEan = cortesRecentes[sEan] || [];
            if (blockedDistsForEan.includes(distNameClean)) {
              return false;
            }
            const codDist = s.CodDist !== undefined ? s.CodDist : (s.codDist !== undefined ? s.codDist : 0);
            if (disabledDistSet.has(Number(codDist))) {
              return false;
            }
            return true;
          });
          // Sempre indicar a condiÃ§Ã£o mais barata mesmo que precise de quantidade maior
          let condicoesOriginalCompativeis = todasCondicoesOriginal;

          // Se houver qualquer oferta de distribuidora real, removemos as ofertas fantasmas ("NÃ£o Encontrados")
          const temOrigRealComp = condicoesOriginalCompativeis.some((c: any) => isRealOffer(c));
          if (temOrigRealComp) {
            condicoesOriginalCompativeis = condicoesOriginalCompativeis.filter((c: any) => isRealOffer(c));
          }

          if (condicoesOriginalCompativeis.length > 0) {
            condicoesOriginalCompativeis.sort((a: any, b: any) => {
              const aReal = isRealOffer(a);
              const bReal = isRealOffer(b);
              if (aReal && !bReal) return -1;
              if (!aReal && bReal) return 1;

              const aPreco = getUnitCost(a);
              const bPreco = getUnitCost(b);
              const aEst = parseSmartPedEstoque(a.Estoque !== undefined ? a.Estoque : (a.estoque !== undefined ? a.estoque : 0), aPreco > 0);
              const bEst = parseSmartPedEstoque(b.Estoque !== undefined ? b.Estoque : (b.estoque !== undefined ? b.estoque : 0), bPreco > 0);
              
              const aHasStock = aEst > 0;
              const bHasStock = bEst > 0;

              if (aHasStock && !bHasStock) return -1;
              if (!aHasStock && bHasStock) return 1;

              return getUnitCost(a) - getUnitCost(b);
            });
            ref = condicoesOriginalCompativeis[0];
            bestOriginalDist = resolveDistName(ref, bestOriginalCodDist);
            bestOriginalCodDist = ref.CodDist !== undefined ? ref.CodDist : (ref.codDist !== undefined ? ref.codDist : 0);
            bestOriginalEstoque = ref.Estoque !== undefined ? ref.Estoque : 0;
            bestOriginalCondicao = ref.Condicao || ref.condicao || "FIXA";
            bestOriginalCodProdutoDist = ref.CodProdutoDist || ref.codProdutoDist || "";
            bestOriginalPrazo = ref.Prazo !== undefined ? ref.Prazo : (ref.prazo || 7);
            bestOriginalCodProduto = cleanCodProduto(ref.CodProduto || ref.codProduto || "", ref.CodProdutoDist || ref.codProdutoDist || "");
            bestOriginalObservacao = stripHtmlTags(ref.Mensagem || ref.mensagem || ref.Restricao || ref.restricao || ref.Observacao || ref.observacao || ref.Obs || ref.obs || ref.Motivo || ref.motivo || "");
            bestOriginalQtdMin = ref.QtdMin !== undefined ? ref.QtdMin : (ref.qtdMin !== undefined ? ref.qtdMin : 0);
            bestOriginalQtdMax = (ref.Combo && ref.Combo.QtdMax !== undefined) ? ref.Combo.QtdMax : ((ref.combo && ref.combo.qtdMax !== undefined) ? ref.combo.qtdMax : 0);
            bestOriginalCx = ref.CX !== undefined ? ref.CX : (ref.cx !== undefined ? ref.cx : 1);

            const refMatching = allMinimos.find(m => {
              const mDist = String(m.CodDist ?? m.codDist ?? "").trim();
              const mCond = String(m.Condicao || m.condicao || "").trim().toUpperCase();
              const mNomeCond = String(m.NomeCondicao || m.nomeCondicao || "").trim().toUpperCase();
              const mPrazo = String(m.Prazo ?? m.prazo ?? "").trim();
              return mDist === String(bestOriginalCodDist).trim() && mPrazo === String(bestOriginalPrazo).trim() && (mCond === String(bestOriginalCondicao).trim().toUpperCase() || mNomeCond === String(bestOriginalCondicao).trim().toUpperCase());
            });
            if (refMatching) {
              bestOriginalQtdMinima = refMatching.QtdMinima !== undefined ? refMatching.QtdMinima : (refMatching.qtdMinima !== undefined ? refMatching.qtdMinima : 0);
            }

            if (getUnitCost(ref) > 0) {
              bestOriginalNovoPreco = getUnitCost(ref);
            }
          }

          // Se nenhuma condição original foi encontrada, preencher bestOriginalDist do primeiro substituto válido
          // Evita badge "★ Atual: [Não Encontrados]" quando o item tem substitutos reais
          if (isNotFoundName(bestOriginalDist) && substitutos.length > 0) {
            const firstValidSub = substitutos.find((s: any) => {
              const est = parseSmartPedEstoque(s.Estoque !== undefined ? s.Estoque : (s.estoque || 0), getUnitCost(s) > 0);
              return est > 0 && (s.CodDist || s.codDist || 0) > 0;
            });
            if (firstValidSub) {
              const subCodDist = firstValidSub.CodDist !== undefined ? firstValidSub.CodDist : (firstValidSub.codDist !== undefined ? firstValidSub.codDist : 0);
              bestOriginalDist = resolveDistName(firstValidSub, subCodDist);
              bestOriginalCodDist = subCodDist;
              bestOriginalEstoque = firstValidSub.Estoque !== undefined ? firstValidSub.Estoque : 0;
              bestOriginalCondicao = firstValidSub.Condicao || firstValidSub.condicao || "FIXA";
              bestOriginalCodProdutoDist = firstValidSub.CodProdutoDist || firstValidSub.codProdutoDist || "";
              bestOriginalPrazo = firstValidSub.Prazo !== undefined ? firstValidSub.Prazo : (firstValidSub.prazo || 7);
              bestOriginalCodProduto = cleanCodProduto(firstValidSub.CodProduto || firstValidSub.codProduto || "", firstValidSub.CodProdutoDist || firstValidSub.codProdutoDist || "");
              bestOriginalNovoPreco = getUnitCost(firstValidSub);
            }
          }

        // Verificar se hÃ¡ fornecedores externos cadastrados com preÃ§os melhores
        let matchedExternal: any = null;
        let matchedSupplierName = "";
        
        if (externalSuppliers && externalSuppliers.length > 0) {
          const cleanString = (str: string) => {
            return str
              .toLowerCase()
              .normalize("NFD")
              .replace(/[\u0300-\u036f]/g, "")
              .replace(/[^a-z0-9\s]/g, " ")
              .replace(/\s+/g, " ")
              .trim();
          };

          const extractDosageAndQty = (str: string) => {
            const normalized = str.toLowerCase();
            
            // Extrair dosagens (ex: 5mg, 500mg, 10ml, 5g, 100mcg, 1000ui)
            const dosageRegex = /(\d+[,.]?\d*)\s*(mg|mcg|g|ml|ui|ug)\b/gi;
            const dosages: string[] = [];
            let dMatch;
            while ((dMatch = dosageRegex.exec(normalized)) !== null) {
              dosages.push(`${dMatch[1].replace(",", ".")}${dMatch[2].toLowerCase()}`);
            }

            // Extrair quantidades (ex: 30cp, 10 caps, 60 comprimidos)
            const qtyRegex = /(\d+)\s*(cp|cpr|caps|capsulas|tabs|comprimidos|comprimido|amp|frascos|frasco|unidades|unidade|un)\b/gi;
            const quantities: string[] = [];
            let qMatch;
            while ((qMatch = qtyRegex.exec(normalized)) !== null) {
              quantities.push(qMatch[1]);
            }

            return { dosages, quantities };
          };

          const sicfDesc = item.descricao || "";
          const sicfClean = cleanString(sicfDesc);
          const sicfWords = sicfClean.split(" ").filter(w => w.length > 1);
          const stopWords = new Set(["de", "com", "cp", "cpr", "generico", "gen", "c/", "emb", "cx", "mg", "g", "ml"]);
          
          const sicfInfo = extractDosageAndQty(sicfDesc);

          let bestExternalMatch: any = null;
          let bestExternalScore = 0;

          const todayStr = new Date(Date.now() - 3 * 60 * 60 * 1000).toISOString().slice(0, 10); // UTC-3
          for (const supplier of externalSuppliers) {
            // Filtrar: só fornecedores analisados (não descartados)
            if (supplier.status_analise === "descartada") continue;
            if (!supplier.products || !Array.isArray(supplier.products)) continue;
            
            for (const extProd of supplier.products) {
              // Filtrar item individual: validade do item > validade do fornecedor
              const itemValidade = extProd.validade || supplier.validade;
              if (itemValidade && itemValidade < todayStr) continue;
              if (!validateSwapEquivalence(sicfDesc, extProd.description)) {
                continue; // RejeiÃ§Ã£o estrita se houver divergÃªncia de sabor, dosagem ou apresentaÃ§Ã£o!
              }
              const extClean = cleanString(extProd.description);
              const extWords = extClean.split(" ").filter(w => w.length > 1 && !stopWords.has(w));
              if (extWords.length === 0) continue;

              // Extrair e validar dosagens e quantidades
              const extInfo = extractDosageAndQty(extProd.description);
              
              // Se ambas as descriÃ§Ãµes tiverem dosagem, elas devem bater exatamente
              if (sicfInfo.dosages.length > 0 && extInfo.dosages.length > 0) {
                const dosageMatch = sicfInfo.dosages.some(d => extInfo.dosages.includes(d));
                if (!dosageMatch) continue; // Pula se houver divergÃªncia de dosagem
              }
              
              // Se ambas as descriÃ§Ãµes tiverem quantidade de comprimidos/capsulas, elas devem bater exatamente
              if (sicfInfo.quantities.length > 0 && extInfo.quantities.length > 0) {
                const qtyMatch = sicfInfo.quantities.some(q => extInfo.quantities.includes(q));
                if (!qtyMatch) continue; // Pula se houver divergÃªncia de apresentaÃ§Ã£o/quantidade
              }

              let matches = 0;
              for (const word of extWords) {
                if (sicfWords.includes(word)) {
                  matches++;
                }
              }

              const score = matches / extWords.length;
              const firstWordExt = extClean.split(" ")[0];
              const firstWordSicf = sicfClean.split(" ")[0];
              const firstWordMatches = firstWordExt === firstWordSicf || sicfWords.includes(firstWordExt);

              if (firstWordMatches && score >= 0.6) {
                if (!bestExternalMatch || score > bestExternalScore) {
                  bestExternalMatch = extProd;
                  bestExternalScore = score;
                  matchedSupplierName = supplier.name;
                }
              }
            }
          }

          if (bestExternalMatch) {
            matchedExternal = bestExternalMatch;
          }
        }

        let bestSmartPedPrice = item.precoOriginal;
        if (finalResult) {
          bestSmartPedPrice = getUnitCost(finalResult.melhor);
        } else if (bestOriginalNovoPreco > 0) {
          bestSmartPedPrice = bestOriginalNovoPreco;
        }

        // Calcular preço do fornecedor externo (suporte a % desconto e discountTiers)
        if (matchedExternal) {
          // Normalizar discountTiers: aceitar JSON valido OU formato PowerShell
          let extDiscountTiers = matchedExternal.discountTiers;
          if (extDiscountTiers && extDiscountTiers.length > 0 && typeof extDiscountTiers[0] === "string") {
            extDiscountTiers = extDiscountTiers.map((s: string) => {
              const match = s.match(/minQty=(\d+).*?discountPercent=([\d.]+)/);
              if (match) return { minQty: parseInt(match[1]), discountPercent: parseFloat(match[2]) };
              return null;
            }).filter(Boolean);
          }
          if ((!matchedExternal.price || matchedExternal.price === 0) && matchedExternal.discountPercent && matchedExternal.discountPercent > 0 && bestSmartPedPrice > 0) {
            matchedExternal.price = bestSmartPedPrice * (1 - matchedExternal.discountPercent / 100);
            logs.push(`[FORNECEDOR WHATSAPP] Preço calculado via ${matchedExternal.discountPercent}% desconto: R$ ${matchedExternal.price.toFixed(2)} (base SmartPed: R$ ${bestSmartPedPrice.toFixed(2)})`);
          } else if ((!matchedExternal.price || matchedExternal.price === 0) && (!matchedExternal.discountPercent || matchedExternal.discountPercent === 0) && extDiscountTiers && extDiscountTiers.length > 0 && bestSmartPedPrice > 0) {
            // Fallback: usar desconto da faixa de MENOR minQty (desconto garantido sem volume)
            const lowestTier = extDiscountTiers.sort((a: any, b: any) => a.minQty - b.minQty)[0];
            if (lowestTier && lowestTier.discountPercent > 0) {
              matchedExternal.price = bestSmartPedPrice * (1 - lowestTier.discountPercent / 100);
              matchedExternal.discountPercent = lowestTier.discountPercent;
              logs.push(`[FORNECEDOR WHATSAPP] Preço calculado via discountTiers: R$ ${matchedExternal.price.toFixed(2)} (base SmartPed: R$ ${bestSmartPedPrice.toFixed(2)}, desconto: ${lowestTier.discountPercent}% faixa ${lowestTier.minQty}un)`);
            }
          }
        }

        if (matchedExternal && matchedExternal.price > 0 && (bestSmartPedPrice - matchedExternal.price) >= margemMinima) {
          const discountInfo = matchedExternal.discountPercent ? ` (${matchedExternal.discountPercent}% desconto)` : "";
          logs.push(`⭐ [FORNECEDOR WHATSAPP] Melhor preço no fornecedor externo "${matchedSupplierName}": R$ ${matchedExternal.price.toFixed(2)}${discountInfo} (SmartPed: R$ ${bestSmartPedPrice.toFixed(2)}) para "${matchedExternal.description}"`);
          const melhorExt = {
            Ean: item.ean,
            Descricao: matchedExternal.description,
            Laboratorio: item.laboratorio,
            NomeDist: matchedSupplierName,
            CodDist: 9999,
            Estoque: 999,
            Condicao: "MANUAL",
            Prazo: 0,
            PliquidoUni: matchedExternal.price,
            Pliquido: matchedExternal.price,
            CodProdutoDist: "",
            CodProduto: "",
            Mensagem: "Pedido via WhatsApp"
          };
          finalResult = {
            melhor: melhorExt,
            economia: item.precoOriginal - matchedExternal.price,
            isFallback: false
          };
        }

        if (finalResult) {
          const { melhor, economia, isFallback } = finalResult;
          const qtdNum = parseFloat(item.qtd.replace(",", "."));
          const economiaTotal = economia * qtdNum;
          totalSavings += economiaTotal;
          itemsSwappedCount++;
          const precoNovo = getUnitCost(melhor);

          // Format new item line in SICF standard:
          // 2;EAN;QTD;COD_INTERNO;DESCRICAO;LABORATORIO;PRECO
          const novoEan = cleanEan(melhor.Ean || melhor.ean || item.ean);
          let novaDescricao = melhor.Descricao || melhor.DescricaoProduto_Idi || melhor.descricao || melhor.descricaoProduto_Idi;
          let novoLab = melhor.Laboratorio || melhor.laboratorio;

          // CONSULTA AO EAN ALVO: Se o EAN alvo for diferente do original, buscar TODOS os distribuidores
          logs.push(`[TARGET-EAN-CHECK] item.ean=${item.ean} | novoEan=${novoEan} | saoIguais=${novoEan === cleanEan(item.ean)}`);
          if (novoEan !== cleanEan(item.ean)) {
            try {
              // Verificar se já temos no apiResponses (cache do batch ou TARGET-EAN-PRE)
              let allTargetCondicoes: any[] = [];
              if (apiResponses[novoEan]) {
                logs.push(`[TARGET-EAN-CHECK] EAN ${novoEan} encontrado no cache do batch — pulando chamada API`);
                _cTargetEanCacheHit++;
                const cachedResp = apiResponses[novoEan];
                const cachedItem = cachedResp?.ItemPedido;
                const cachedSubs = cachedResp?.Substitutos || [];
                if (cachedItem?.Condicoes) allTargetCondicoes.push(...cachedItem.Condicoes);
                for (const sub of cachedSubs) {
                  if (sub.Condicoes) allTargetCondicoes.push(...sub.Condicoes);
                  else allTargetCondicoes.push(sub);
                }
              } else {
                logs.push(`[TARGET-EAN-API] Chamando API para EAN alvo ${novoEan}...`);
              // Chamar Condicoes/Ean E Condicoes/Molecula em paralelo (igual search-products)
              const targetHeaders = { "Content-Type": "application/json", "Accept": "application/json", "User-Agent": "Mozilla/5.0" };
              const targetBody = JSON.stringify({ Token: actualToken, parametros: { CnpjCLi: apiCnpj, Ean: novoEan, AceitaOntem: 1 } });
              const targetBodyMol = JSON.stringify({ Token: actualToken, parametros: { CnpjCLi: apiCnpj, Ean: novoEan, ConsideraTipo: 1 } });
              const _teT0 = Date.now();
              const [targetEanResp, targetMolResp] = await Promise.all([
                fetch(`${baseUrl.replace(/\/$/, "")}/api/Condicoes/Ean`, { method: "POST", headers: targetHeaders, body: targetBody }).then(r => r.ok ? r.json() : null).catch(() => null),
                fetch(`${baseUrl.replace(/\/$/, "")}/api/Condicoes/Molecula`, { method: "POST", headers: targetHeaders, body: targetBodyMol }).then(r => r.ok ? r.json() : null).catch(() => null)
              ]);
              _tTargetEanApi += Date.now() - _teT0;
              _cTargetEanApi++;
              // Extrair condições de ambas as respostas
              const eanItens = targetEanResp?.Retorno?.itens || [];
              const molItens = targetMolResp?.Retorno?.itens || [];
              allTargetCondicoes = [...eanItens, ...molItens].flatMap((it: any) => it.Condicoes || it.condicoes || []);
              }
              // Enriquecer condições do EAN alvo com estoque REAL dos substitutos já consultados
              const subsByEanDist = new Map<string, number>();
              for (const s of combinedSubstitutos) {
                const sEan = cleanEan(s.Ean || s.ean || "");
                const sCodDist = s.CodDist !== undefined ? s.CodDist : (s.codDist !== undefined ? s.codDist : 0);
                const sPreco = getUnitCost(s);
                const sEst = parseSmartPedEstoque(s.Estoque !== undefined ? s.Estoque : (s.estoque !== undefined ? s.estoque : 0), sPreco > 0);
                if (sEan && sCodDist && sEst > 0) subsByEanDist.set(`${sEan}_${sCodDist}`, sEst);
              }
              for (const c of allTargetCondicoes) {
                const cEan = cleanEan(c.Ean || c.ean || novoEan);
                const cCodDist = c.CodDist !== undefined ? c.CodDist : (c.codDist !== undefined ? c.codDist : 0);
                const realStock = subsByEanDist.get(`${cEan}_${cCodDist}`);
                if (realStock !== undefined) c.Estoque = realStock;
              }
              const targetCondicoes = allTargetCondicoes;
              logs.push(`[TARGET-EAN-API] Total condições: ${targetCondicoes.length} (enriquecidas) — EAN ${novoEan}`);
              logs.push(`[TARGET-EAN-API] Resposta OK — ${targetCondicoes.length} condições retornadas para EAN ${novoEan}`);
              const existingKeys = new Set(finalAlternatives.map((a: any) => `${a.ean}_${a.codDist}_${a.condicao}_${a.prazo}`));
              let added = 0;
              for (const c of targetCondicoes) {
                const cEan = cleanEan(c.Ean || c.ean || novoEan);
                const cCodDist = c.CodDist !== undefined ? c.CodDist : (c.codDist !== undefined ? c.codDist : 0);
                const cCond = c.Condicao || c.condicao || "FIXA";
                const cPrazo = c.Prazo !== undefined ? c.Prazo : (c.prazo || 7);
                const cPreco = getUnitCost(c);
                const cEst = parseSmartPedEstoque(c.Estoque !== undefined ? c.Estoque : (c.estoque || 0), cPreco > 0);
                const cDist = c.NomeDist || c.nomeDist || DISTRIBUIDORAS_MAP[cCodDist] || `Distribuidor ${cCodDist}`;
                if (cPreco <= 0 || cEst <= 0) continue;
                if (isNotFoundName(cDist)) continue;
                if (cCodDist && disabledDistSet.has(Number(cCodDist))) continue;
                const key = `${cEan}_${cCodDist}_${cCond}_${cPrazo}`;
                if (existingKeys.has(key)) continue;
                existingKeys.add(key);
                finalAlternatives.push({
                  ean: cEan,
                  descricao: c.Descricao || c.descricao || "",
                  laboratorio: c.Laboratorio || c.laboratorio || "",
                  preco: cPreco,
                  condicao: cCond,
                  distribuidora: cDist,
                  codDist: cCodDist,
                  prazo: cPrazo,
                  qtdMin: c.QtdMin !== undefined ? c.QtdMin : (c.qtdMin !== undefined ? c.qtdMin : 0),
                  estoque: cEst,
                  codProdutoDist: c.CodProdutoDist || c.codProdutoDist || "",
                  codProduto: cleanCodProduto(c.CodProduto || c.codProduto || "", c.CodProdutoDist || c.codProdutoDist || "")
                });
                added++;
              }
              if (added > 0) {
                finalAlternatives.sort((a: any, b: any) => a.preco - b.preco);
                logs.push(`[TARGET-EAN] EAN alvo ${novoEan}: ${added} novas distribuidoras adicionadas. Total: ${finalAlternatives.length}`);
              }
            } catch (err) {
              logs.push(`[TARGET-EAN] Erro ao consultar EAN alvo ${novoEan}: ${err}`);
            }
          } else {
            logs.push(`[TARGET-EAN-CHECK] EAN alvo IGUAL ao original — pulando consulta`);
          }

          // FILTRO FINAL DO DROPDOWN (ConditionSelector)
          // - Ruptura: mostrar TODAS as alternativas (sem filtro de EAN)
          // - Genérico sem ruptura: mostrar TODAS as alternativas (busca completa entre fabricantes)
          // - Ético/Similar/Perfumaria sem ruptura: filtrar para mesmo produto (mesmo EAN ou EAN diferente com mesma descrição)
          if (originalHasStock && !isGeneric) {
            // Éticos/Similares: mesmo EAN + EAN do melhor substituto + EANs com mesma descrição (mesmo produto, código de barras diferente)
            const sameProductEans = new Set<string>();
            sameProductEans.add(cleanEan(item.ean));
            sameProductEans.add(novoEan);
            const origDescClean = originalDesc.toUpperCase().trim();
            for (const s of combinedSubstitutos) {
              const sDesc = (s.Descricao || s.descricao || '').toUpperCase().trim();
              const sEan = cleanEan(s.Ean || s.ean || '');
              if (sEan && sDesc === origDescClean) {
                sameProductEans.add(sEan);
              }
            }
            finalAlternatives = finalAlternatives.filter((a: any) => sameProductEans.has(cleanEan(a.ean)));
            logs.push(`[FILTRO-DROPDOWN] Ético/Similar — EANs do mesmo produto: [${Array.from(sameProductEans).join(", ")}] | Alternativas: ${finalAlternatives.length}`);
          } else {
            const reason = !originalHasStock ? 'Ruptura' : 'Genérico';
            logs.push(`[FILTRO-DROPDOWN] ${reason} — mantendo TODAS as ${finalAlternatives.length} alternativas (sem filtro de EAN)`);
          }

          if (novoEan === cleanEan(item.ean)) {
            if (!novaDescricao) novaDescricao = item.descricao;
            if (!novoLab) novoLab = item.laboratorio;
          }

          if (!novaDescricao || !novoLab) {
            const _dlStart3 = Date.now();
            const _idx3 = _descLabIndex.get(novoEan);
            _descLookupTotalMs += Date.now() - _dlStart3;
            _descLookupCount++;
            if (_idx3) {
              if (!novaDescricao) novaDescricao = _idx3.descricao;
              if (!novoLab) novoLab = _idx3.laboratorio;
            }
          }

          if (!novaDescricao) {
            const dbRecord = getEanDatabaseRecord(novoEan);
            if (dbRecord && dbRecord.descricao) {
              novaDescricao = dbRecord.descricao;
              if (!novoLab) novoLab = dbRecord.laboratorio;
            } else if (novoEan === cleanEan(item.ean)) {
              novaDescricao = item.descricao;
            } else {
              novaDescricao = `Medicamento Equivalente (EAN: ${novoEan})`;
            }
          }
          if (!novoLab) {
            novoLab = item.laboratorio || "GENÃ‰RICO";
          }

          lineFinal = [
            "2",
            novoEan,
            item.qtd,
            item.codInterno,
            novaDescricao,
            novoLab,
            precoNovo.toFixed(2)
          ].join(";");
          
          if (isFallback) {
             logs.push(`âš ï¸ [SUBSTITUIÃ‡ÃƒO POR FALTA] Original sem estoque! Trocado pelo genÃ©rico EAN ${novoEan} (${novaDescricao}) do laboratÃ³rio ${novoLab}`);
          } else {
             logs.push(`ðŸš€ [SUBSTITUIÃ‡ÃƒO APROVADA] Trocar por EAN ${novoEan} (${novaDescricao}) do laboratÃ³rio ${novoLab}`);
          }
          logs.push(`   PreÃ§o original: R$ ${item.precoOriginal.toFixed(2)} | PreÃ§o otimizado: R$ ${precoNovo.toFixed(2)} | Economia unitÃ¡ria: R$ ${economia.toFixed(2)} | Economia total (Qtd ${qtdNum}): R$ ${economiaTotal.toFixed(2)}`);

          const codDist = melhor.CodDist !== undefined ? melhor.CodDist : (melhor.codDist !== undefined ? melhor.codDist : 0);
          const condicao = melhor.Condicao || melhor.condicao || "FIXA";
          const prazo = melhor.Prazo !== undefined ? melhor.Prazo : (melhor.prazo !== undefined ? melhor.prazo : 0);

          let pedidoMinimo = 0;
          const matchingMinimo = allMinimos.find(m => {
            const mDist = String(m.CodDist ?? m.codDist ?? "").trim();
            const mCond = String(m.Condicao || m.condicao || "").trim().toUpperCase();
            const mNomeCond = String(m.NomeCondicao || m.nomeCondicao || "").trim().toUpperCase();
            const mPrazo = String(m.Prazo ?? m.prazo ?? "").trim();
            
            const oDist = String(codDist).trim();
            const oCond = String(condicao).trim().toUpperCase();
            const oPrazo = String(prazo).trim();
            
            // Match by CodDist + Prazo AND (Condicao or NomeCondicao)
            return mDist === oDist && mPrazo === oPrazo && (mCond === oCond || mNomeCond === oCond);
          });
          if (matchingMinimo) {
            pedidoMinimo = matchingMinimo.VlrMinimo ?? matchingMinimo.vlrMinimo ?? 0;
          }

          const apiOriginalPmc = extractPmc(ref) || extractPmc(itemPedido);
          const originalTablePrice = extractTablePrice(ref) || extractTablePrice(itemPedido);
          const baseOriginalPmc = originalTablePrice > 0 ? originalTablePrice : item.precoOriginal;
          const calcOriginalPmc = apiOriginalPmc > 0 ? apiOriginalPmc : (baseOriginalPmc > 0 ? Number((baseOriginalPmc * 1.4).toFixed(2)) : 0);

          const apiNovoPmc = extractPmc(melhor);
          const novoTablePrice = extractTablePrice(melhor);
          const baseNovoPmc = novoTablePrice > 0 ? novoTablePrice : precoNovo;
          const calcNovoPmc = apiNovoPmc > 0 ? apiNovoPmc : (baseNovoPmc > 0 ? Number((baseNovoPmc * 1.4).toFixed(2)) : 0);

          const alertResult = calculateQuantityAlert(
            item.precoOriginal,
            precoNovo,
            novaDescricao,
            melhor.CX !== undefined ? melhor.CX : (melhor.cx !== undefined ? melhor.cx : 1),
            item.descricao
          );

          const isRupturaSubstitution = !originalHasStock && finalResult && novoEan !== cleanEan(item.ean);
          logs.push(`[RUPTURA-DEBUG] EAN ${item.ean} | originalHasStock=${originalHasStock} | finalResult=${!!finalResult} | isRupturaSubstitution=${isRupturaSubstitution} | novoEan=${novoEan} | precoNovo=${precoNovo}`);

          report.push({
            codInterno: item.codInterno,
            originalEan: item.ean,
            originalDescricao: item.descricao,
            originalLaboratorio: item.laboratorio,
            originalPreco: item.precoOriginal,
            originalPrecoCotado: bestOriginalNovoPreco,
            originalPmc: calcOriginalPmc,
            originalDist: bestOriginalDist,
            originalCodDist: bestOriginalCodDist,
            originalEstoque: bestOriginalEstoque,
            originalCondicao: bestOriginalCondicao,
            originalCodProdutoDist: bestOriginalCodProdutoDist,
            originalPrazo: bestOriginalPrazo,
            originalCodProduto: bestOriginalCodProduto,
            originalObservacao: bestOriginalObservacao,
            originalSemEstoque: todasCondicoesOriginal.length === 0 || todasCondicoesOriginal.every((c: any) => {
              const rawEst = c.Estoque !== undefined ? c.Estoque : (c.estoque !== undefined ? c.estoque : 0);
              return parseSmartPedEstoque(rawEst, getUnitCost(c) > 0) <= 0;
            }),
            isRupturaSubstitution,
            originalRupturaEan: isRupturaSubstitution ? item.ean : undefined,
            originalRupturaDescricao: isRupturaSubstitution ? item.descricao : undefined,
            originalRupturaLaboratorio: isRupturaSubstitution ? item.laboratorio : undefined,
            originalRupturaPreco: isRupturaSubstitution ? item.precoOriginal : undefined,
            novoEan,
            novaDescricao,
            novoLaboratorio: novoLab,
            novoPreco: precoNovo,
            novoPmc: calcNovoPmc,
            qtd: qtdNum,
            economiaUnit: economia,
            economiaTotal,
            distribuidora: resolveDistName(melhor, codDist),
            estoque: melhor.Estoque !== undefined ? melhor.Estoque : (melhor.estoque || 0),
            codDist,
            condicao,
            codProdutoDist: melhor.CodProdutoDist || melhor.codProdutoDist || "",
            prazo,
            codProduto: cleanCodProduto(melhor.CodProduto || melhor.codProduto || "", melhor.CodProdutoDist || melhor.codProdutoDist || ""),
            pedidoMinimo,
            qtdMin: melhor.QtdMin !== undefined ? melhor.QtdMin : (melhor.qtdMin !== undefined ? melhor.qtdMin : 0),
            qtdMax: (melhor.Combo && melhor.Combo.QtdMax !== undefined) ? melhor.Combo.QtdMax : ((melhor.combo && melhor.combo.qtdMax !== undefined) ? melhor.combo.qtdMax : 0),
            cx: melhor.CX !== undefined ? melhor.CX : (melhor.cx !== undefined ? melhor.cx : 1),
            qtdMinima: (matchingMinimo && matchingMinimo.QtdMinima !== undefined) ? matchingMinimo.QtdMinima : ((matchingMinimo && matchingMinimo.qtdMinima !== undefined) ? matchingMinimo.qtdMinima : 0),
            observacao: stripHtmlTags(melhor.Mensagem || melhor.mensagem || melhor.Restricao || melhor.restricao || melhor.Observacao || melhor.observacao || melhor.Obs || melhor.obs || melhor.Motivo || melhor.motivo || ""),
            alertaConfirmarQtd: alertaConfirmarQtdCaixaMaster ? alertResult.alertaConfirmarQtd : false,
            motivoAlerta: alertaConfirmarQtdCaixaMaster ? alertResult.motivoAlerta : undefined,
            vendasMensais: (vendasEstoqueMap[cleanEan(item.ean)] || {}).vendasMensais || 0,
            estoqueTotal: (vendasEstoqueMap[cleanEan(item.ean)] || {}).estoqueTotal || 0,
            alternatives: (() => {
              const chosen = finalAlternatives.length > 0 ? finalAlternatives : (rawSubstitutosForAlternatives.length > 0 ? rawSubstitutosForAlternatives : (substitutos.length > 0 ? substitutos : []));
              // ENRICH-ALL-ALTS: Construir mapa global Ean_CodDist → CodProdutoDist a partir de TODAS as fontes
              const codProdutoDistMap = new Map<string, string>();
              // Fonte 1: combinedCondicoes (Condicoes/Ean dos EANs originais/equivalentes)
              for (const c of combinedCondicoes) {
                const cEan = cleanEan(c.Ean || c.ean || "");
                const cCodDist = c.CodDist !== undefined ? c.CodDist : (c.codDist !== undefined ? c.codDist : 0);
                const cppd = c.CodProdutoDist || c.codProdutoDist || "";
                if (cEan && cCodDist && cppd) codProdutoDistMap.set(`${cEan}_${cCodDist}`, cppd);
              }
              // Fonte 1b: condicoesEnriched (condicoes originais com estoque enriquecido, já têm CodProdutoDist)
              for (const c of condicoesEnriched) {
                const cEan = cleanEan(c.Ean || c.ean || "");
                const cCodDist = c.CodDist !== undefined ? c.CodDist : (c.codDist !== undefined ? c.codDist : 0);
                const cppd = c.CodProdutoDist || c.codProdutoDist || "";
                if (cEan && cCodDist && cppd) codProdutoDistMap.set(`${cEan}_${cCodDist}`, cppd);
              }
              // Fonte 1c: substitutos (já enriquecidos via combinedCondicoes + apiResponses em etapa anterior)
              for (const s of substitutos) {
                const sEan = cleanEan(s.Ean || s.ean || "");
                const sCodDist = s.CodDist !== undefined ? s.CodDist : (s.codDist !== undefined ? s.codDist : 0);
                const cppd = s.CodProdutoDist || s.codProdutoDist || "";
                if (sEan && sCodDist && cppd) codProdutoDistMap.set(`${sEan}_${sCodDist}`, cppd);
              }
              // Fonte 2: Todas as Condicoes de apiResponses (batch + TARGET-EAN-PRE + TARGET-EAN-API)
              for (const respEan of Object.keys(apiResponses)) {
                const resp = apiResponses[respEan];
                const condicoesResp = resp?.Condicoes || resp?.ItemPedido?.Condicoes || [];
                for (const c of condicoesResp) {
                  const cEan = cleanEan(c.Ean || c.ean || respEan);
                  const cCodDist = c.CodDist !== undefined ? c.CodDist : (c.codDist !== undefined ? c.codDist : 0);
                  const cppd = c.CodProdutoDist || c.codProdutoDist || "";
                  if (cEan && cCodDist && cppd) codProdutoDistMap.set(`${cEan}_${cCodDist}`, cppd);
                }
                // Substitutos do batch também têm CodProdutoDist enriquecido
                const subsResp = resp?.Substitutos || [];
                for (const s of subsResp) {
                  const sEan = cleanEan(s.Ean || s.ean || "");
                  const sCodDist = s.CodDist !== undefined ? s.CodDist : (s.codDist !== undefined ? s.codDist : 0);
                  const cppd = s.CodProdutoDist || s.codProdutoDist || "";
                  if (sEan && sCodDist && cppd) codProdutoDistMap.set(`${sEan}_${sCodDist}`, cppd);
                }
              }
              // Enriquecer cada alternativa com codProdutoDist do mapa
              for (const a of chosen) {
                if (!a.codProdutoDist) {
                  const aEan = cleanEan(a.ean || "");
                  const key = `${aEan}_${a.codDist || 0}`;
                  const found = codProdutoDistMap.get(key);
                  if (found) {
                    a.codProdutoDist = found;
                    if (!a.codProduto) a.codProduto = found;
                  }
                }
              }
              const filtered = chosen.filter((a: any) => {
                const d = a.distribuidora || a.NomeDist || a.nomeDist || "";
                return !isNotFoundName(d) && (a.codDist || 0) > 0;
              });
              const cppdMissing = chosen.filter((a: any) => !a.codProdutoDist).length;
              logs.push(`[DEBUG-ALTS] EAN ${item.ean} | CAMINHO SUCESSO | finalAlternatives=${finalAlternatives.length} | rawSubstitutos=${rawSubstitutosForAlternatives.length} | substitutos=${substitutos.length} → RESULTADO: ${filtered.length} alternativas (de ${chosen.length}) | semCodProdutoDist=${cppdMissing}`);
              return filtered.length > 0 ? filtered : chosen;
            })()
          });
        } else {
          logs.push(`â¹ï¸ [MANTER ORIGINAL] Mantendo original. Motivo: nenhuma opÃ§Ã£o elegÃ­vel mais barata com economia mÃ­nima de R$ ${margemMinima.toFixed(2)} ou sem estoque suficiente.`);
          
          let originalDist = bestOriginalDist;
          let originalCodDist = bestOriginalCodDist;
          let originalEstoque = bestOriginalEstoque;
          let originalCondicao = bestOriginalCondicao;
          let originalCodProdutoDist = bestOriginalCodProdutoDist;
          let originalPrazo = bestOriginalPrazo;
          let originalCodProduto = bestOriginalCodProduto;
          let originalNovoPreco = bestOriginalNovoPreco;
          let originalObservacao = bestOriginalObservacao;

          if (todasCondicoesOriginal.length === 0 && substitutos.length > 0) {
            const validSubstitutos = exigirEstoque 
              ? substitutos.filter((s: any) => {
                  const est = parseInt(String(s.Estoque !== undefined ? s.Estoque : (s.estoque !== undefined ? s.estoque : 0)), 10) || 0;
                  return est > 0;
                })
              : substitutos;

            if (validSubstitutos.length > 0) {
              const ref = validSubstitutos[0];
              originalDist = resolveDistName(ref, originalCodDist);
              originalCodDist = ref.CodDist !== undefined ? ref.CodDist : (ref.codDist !== undefined ? ref.codDist : 0);
              originalEstoque = ref.Estoque !== undefined ? ref.Estoque : 0;
              originalCondicao = ref.Condicao || ref.condicao || "FIXA";
              originalCodProdutoDist = ref.CodProdutoDist || ref.codProdutoDist || "";
              originalPrazo = ref.Prazo !== undefined ? ref.Prazo : (ref.prazo || 7);
              originalCodProduto = cleanCodProduto(ref.CodProduto || ref.codProduto || "", ref.CodProdutoDist || ref.codProdutoDist || "");
              originalObservacao = stripHtmlTags(ref.Mensagem || ref.mensagem || ref.Restricao || ref.restricao || ref.Observacao || ref.observacao || ref.Obs || ref.obs || ref.Motivo || ref.motivo || "");
            }
          }

          let originalQtdMin = bestOriginalQtdMin;
          let originalQtdMax = bestOriginalQtdMax;
          let originalCx = bestOriginalCx;
          let originalQtdMinima = bestOriginalQtdMinima;

          if (todasCondicoesOriginal.length === 0 && substitutos.length > 0) {
            const validSubstitutos = exigirEstoque 
              ? substitutos.filter((s: any) => {
                  const est = parseInt(String(s.Estoque !== undefined ? s.Estoque : (s.estoque !== undefined ? s.estoque : 0)), 10) || 0;
                  return est > 0;
                })
              : substitutos;

            if (validSubstitutos.length > 0) {
              const ref = validSubstitutos[0];
              originalQtdMin = ref.QtdMin !== undefined ? ref.QtdMin : (ref.qtdMin !== undefined ? ref.qtdMin : 0);
              originalQtdMax = (ref.Combo && ref.Combo.QtdMax !== undefined) ? ref.Combo.QtdMax : ((ref.combo && ref.combo.qtdMax !== undefined) ? ref.combo.qtdMax : 0);
              originalCx = ref.CX !== undefined ? ref.CX : (ref.cx !== undefined ? ref.cx : 1);
              
              const refMatching = allMinimos.find(m => {
                const mDist = String(m.CodDist ?? m.codDist ?? "").trim();
                const mCond = String(m.Condicao || m.condicao || "").trim().toUpperCase();
                const mNomeCond = String(m.NomeCondicao || m.nomeCondicao || "").trim().toUpperCase();
                const mPrazo = String(m.Prazo ?? m.prazo ?? "").trim();
                return mDist === String(originalCodDist).trim() && mPrazo === String(originalPrazo).trim() && (mCond === String(originalCondicao).trim().toUpperCase() || mNomeCond === String(originalCondicao).trim().toUpperCase());
              });
              if (refMatching) {
                originalQtdMinima = refMatching.QtdMinima !== undefined ? refMatching.QtdMinima : (refMatching.qtdMinima !== undefined ? refMatching.qtdMinima : 0);
              }
            }
          }

          const allOptions = [...condicoes, ...substitutos];
          const hasAnyStock = allOptions.some((s: any) => {
            const est = parseInt(String(s.Estoque !== undefined ? s.Estoque : (s.estoque !== undefined ? s.estoque : 0)), 10) || 0;
            return est > 0;
          });

          if (allOptions.length > 0 && !hasAnyStock && exigirEstoque) {
            originalDist = "Sem Estoque";
          }

          const qtdNum = parseFloat(item.qtd.replace(",", "."));
          const calcEconomia = Math.max(0, item.precoOriginal - originalNovoPreco);

          const apiOriginalPmc = extractPmc(ref) || extractPmc(itemPedido);
          const originalTablePrice = extractTablePrice(ref) || extractTablePrice(itemPedido);
          const baseOriginalPmc = originalTablePrice > 0 ? originalTablePrice : item.precoOriginal;
          const calcOriginalPmc = apiOriginalPmc > 0 ? apiOriginalPmc : (baseOriginalPmc > 0 ? Number((baseOriginalPmc * 1.4).toFixed(2)) : 0);
          const calcNovoPmc = calcOriginalPmc;

          const alertResult = calculateQuantityAlert(
            item.precoOriginal,
            originalNovoPreco,
            item.descricao,
            originalCx,
            item.descricao
          );

          report.push({
            codInterno: item.codInterno,
            originalEan: item.ean,
            originalDescricao: item.descricao,
            originalLaboratorio: item.laboratorio,
            originalPreco: item.precoOriginal,
            originalPrecoCotado: originalNovoPreco,
            originalPmc: calcOriginalPmc,
            novoEan: item.ean,
            novaDescricao: item.descricao,
            novoLaboratorio: item.laboratorio,
            novoPreco: originalNovoPreco,
            novoPmc: calcNovoPmc,
            qtd: qtdNum,
            economiaUnit: calcEconomia,
            economiaTotal: calcEconomia * qtdNum,
            distribuidora: originalDist,
            estoque: originalEstoque,
            codDist: originalCodDist,
            condicao: originalCondicao,
            codProdutoDist: originalCodProdutoDist,
            prazo: originalPrazo,
            codProduto: originalCodProduto,
            pedidoMinimo: bestOriginalNovoPreco === item.precoOriginal ? 0 : 150,
            qtdMin: originalQtdMin,
            qtdMax: originalQtdMax,
            cx: originalCx,
            qtdMinima: originalQtdMinima,
            observacao: originalObservacao,
            originalSemEstoque: todasCondicoesOriginal.length === 0 || todasCondicoesOriginal.every((c: any) => {
              const rawEst = c.Estoque !== undefined ? c.Estoque : (c.estoque !== undefined ? c.estoque : 0);
              return parseSmartPedEstoque(rawEst, getUnitCost(c) > 0) <= 0;
            }),
            isRupturaSubstitution: false,
            originalRupturaEan: undefined,
            originalRupturaDescricao: undefined,
            originalRupturaLaboratorio: undefined,
            originalRupturaPreco: undefined,
            alertaConfirmarQtd: alertaConfirmarQtdCaixaMaster ? alertResult.alertaConfirmarQtd : false,
            motivoAlerta: alertaConfirmarQtdCaixaMaster ? alertResult.motivoAlerta : undefined,
            vendasMensais: (vendasEstoqueMap[cleanEan(item.ean)] || {}).vendasMensais || 0,
            estoqueTotal: (vendasEstoqueMap[cleanEan(item.ean)] || {}).estoqueTotal || 0,
            alternatives: (() => {
              const chosen = finalAlternatives.length > 0 ? finalAlternatives : (rawSubstitutosForAlternatives.length > 0 ? rawSubstitutosForAlternatives : (substitutos.length > 0 ? substitutos : []));
              // ENRICH-ALL-ALTS: Construir mapa global Ean_CodDist → CodProdutoDist a partir de TODAS as fontes
              const codProdutoDistMap = new Map<string, string>();
              for (const c of combinedCondicoes) {
                const cEan = cleanEan(c.Ean || c.ean || "");
                const cCodDist = c.CodDist !== undefined ? c.CodDist : (c.codDist !== undefined ? c.codDist : 0);
                const cppd = c.CodProdutoDist || c.codProdutoDist || "";
                if (cEan && cCodDist && cppd) codProdutoDistMap.set(`${cEan}_${cCodDist}`, cppd);
              }
              for (const c of condicoesEnriched) {
                const cEan = cleanEan(c.Ean || c.ean || "");
                const cCodDist = c.CodDist !== undefined ? c.CodDist : (c.codDist !== undefined ? c.codDist : 0);
                const cppd = c.CodProdutoDist || c.codProdutoDist || "";
                if (cEan && cCodDist && cppd) codProdutoDistMap.set(`${cEan}_${cCodDist}`, cppd);
              }
              for (const s of substitutos) {
                const sEan = cleanEan(s.Ean || s.ean || "");
                const sCodDist = s.CodDist !== undefined ? s.CodDist : (s.codDist !== undefined ? s.codDist : 0);
                const cppd = s.CodProdutoDist || s.codProdutoDist || "";
                if (sEan && sCodDist && cppd) codProdutoDistMap.set(`${sEan}_${sCodDist}`, cppd);
              }
              for (const respEan of Object.keys(apiResponses)) {
                const resp = apiResponses[respEan];
                const condicoesResp = resp?.Condicoes || resp?.ItemPedido?.Condicoes || [];
                for (const c of condicoesResp) {
                  const cEan = cleanEan(c.Ean || c.ean || respEan);
                  const cCodDist = c.CodDist !== undefined ? c.CodDist : (c.codDist !== undefined ? c.codDist : 0);
                  const cppd = c.CodProdutoDist || c.codProdutoDist || "";
                  if (cEan && cCodDist && cppd) codProdutoDistMap.set(`${cEan}_${cCodDist}`, cppd);
                }
                const subsResp = resp?.Substitutos || [];
                for (const s of subsResp) {
                  const sEan = cleanEan(s.Ean || s.ean || "");
                  const sCodDist = s.CodDist !== undefined ? s.CodDist : (s.codDist !== undefined ? s.codDist : 0);
                  const cppd = s.CodProdutoDist || s.codProdutoDist || "";
                  if (sEan && sCodDist && cppd) codProdutoDistMap.set(`${sEan}_${sCodDist}`, cppd);
                }
              }
              for (const a of chosen) {
                if (!a.codProdutoDist) {
                  const aEan = cleanEan(a.ean || "");
                  const key = `${aEan}_${a.codDist || 0}`;
                  const found = codProdutoDistMap.get(key);
                  if (found) {
                    a.codProdutoDist = found;
                    if (!a.codProduto) a.codProduto = found;
                  }
                }
              }
              const filtered = chosen.filter((a: any) => {
                const d = a.distribuidora || a.NomeDist || a.nomeDist || "";
                return !isNotFoundName(d) && (a.codDist || 0) > 0;
              });
              const cppdMissing = chosen.filter((a: any) => !a.codProdutoDist).length;
              logs.push(`[DEBUG-ALTS] EAN ${item.ean} | CAMINHO MANTER ORIGINAL | finalAlternatives=${finalAlternatives.length} | rawSubstitutos=${rawSubstitutosForAlternatives.length} | substitutos=${substitutos.length} → RESULTADO: ${filtered.length} alternativas (de ${chosen.length}) | semCodProdutoDist=${cppdMissing}`);
              return filtered.length > 0 ? filtered : chosen;
            })()
          });
        }
} else {
        logs.push(`⚠️ [MANTER ORIGINAL] EAN ${item.ean} (${item.descricao}) não obteve retorno da API SmartPed. Mantendo original.`);
        
        const qtdNum = parseFloat(item.qtd.replace(",", "."));
        const fallbackOriginalPmc = item.precoOriginal > 0 ? Number((item.precoOriginal * 1.4).toFixed(2)) : 0;
        const fallbackNovoPmc = fallbackOriginalPmc;
        report.push({
          codInterno: item.codInterno,
          originalEan: item.ean,
          originalDescricao: item.descricao,
          originalLaboratorio: item.laboratorio,
          originalPreco: item.precoOriginal,
          originalPrecoCotado: item.precoOriginal,
          originalPmc: fallbackOriginalPmc,
          novoEan: item.ean,
          novaDescricao: item.descricao,
          novoLaboratorio: item.laboratorio,
          novoPreco: item.precoOriginal,
          novoPmc: fallbackNovoPmc,
          qtd: qtdNum,
          economiaUnit: 0,
          economiaTotal: 0,
          distribuidora: "NÃ£o Encontrados",
          estoque: 0,
          codDist: 0,
          condicao: "FIXA",
          codProdutoDist: "",
          prazo: 7,
          codProduto: "",
          pedidoMinimo: 0,
          qtdMin: 0,
          qtdMax: 0,
          cx: 1,
          qtdMinima: 0,
          observacao: "Sem retorno comercial da SmartPed",
          alertaConfirmarQtd: false,
          originalSemEstoque: true,
          vendasMensais: (vendasEstoqueMap[cleanEan(item.ean)] || {}).vendasMensais || 0,
          estoqueTotal: (vendasEstoqueMap[cleanEan(item.ean)] || {}).estoqueTotal || 0,
          alternatives: []
        });
      }

      if (!lineFinal) {
        // Keep original line
        lineFinal = item.originalLine;
      }
      finalLines.push(lineFinal);
    } catch (itemErr: any) {
      logs.push(`[ITEM-ERRO-FATAL] EAN ${item.ean} (${item.descricao}) — erro não tratado: ${itemErr?.message || itemErr}\nStack: ${itemErr?.stack || 'sem stack'}`);
      console.error(`[ITEM-ERRO-FATAL] EAN ${item.ean}:`, itemErr);
      finalLines.push(item.originalLine);
    }
    }

    logs.push(`[TIMING-RUPTURA-TOTAL] ${_ruturaTotalMs}ms somados em ${_ruturaCount} chamadas RUPTURA-REGEX`);
    console.log(`[TIMING-RUPTURA-TOTAL] ${_ruturaTotalMs}ms somados em ${_ruturaCount} chamadas RUPTURA-REGEX`);
    logs.push(`[TIMING-DESC-LOOKUP] ${_descLookupTotalMs}ms em ${_descLookupCount} buscas de descrição (via Map index) | ${_descHadDesc} já tinham desc, ${_descNeededLookup} precisaram lookup`);
    console.log(`[TIMING-DESC-LOOKUP] ${_descLookupTotalMs}ms em ${_descLookupCount} buscas de descrição (via Map index) | ${_descHadDesc} já tinham desc, ${_descNeededLookup} precisaram lookup`);
    logs.push(`[TIMING-BREAKDOWN] validateSwapEquivalence: ${_tValidate}ms/${_cValidate} | resolveDistName: ${_tDistName}ms/${_cDistName} | preco: ${_tPrice}ms/${_cPrice}`);
    console.log(`[TIMING-BREAKDOWN] validateSwapEquivalence: ${_tValidate}ms/${_cValidate} | resolveDistName: ${_tDistName}ms/${_cDistName} | preco: ${_tPrice}ms/${_cPrice}`);
    logs.push(`[TIMING-FINDBEST] total: ${_tFindBest}ms/${_cFindBest} chamadas | pior chamada: ${_maxFindBest}ms com ${_maxFindBestCands} candidatos`);
    console.log(`[TIMING-FINDBEST] total: ${_tFindBest}ms/${_cFindBest} chamadas | pior chamada: ${_maxFindBest}ms com ${_maxFindBestCands} candidatos`);
    logs.push(`[TIMING-TARGET-EAN] API: ${_tTargetEanApi}ms/${_cTargetEanApi} chamadas | cache-hit: ${_cTargetEanCacheHit}x`);
    console.log(`[TIMING-TARGET-EAN] API: ${_tTargetEanApi}ms/${_cTargetEanApi} chamadas | cache-hit: ${_cTargetEanCacheHit}x`);
    logs.push(`[TIMING-FALLBACK-SIMILARES] ${_tFallbackSimilares}ms/${_cFallbackSimilares} chamadas`);
    console.log(`[TIMING-FALLBACK-SIMILARES] ${_tFallbackSimilares}ms/${_cFallbackSimilares} chamadas`);
    _p4 = Date.now() - _f4Start;
    logs.push(`[FASE-4-LOOP-ITENS] ${_p4}ms`);
    console.log(`[FASE-4-LOOP-ITENS] ${_p4}ms`);

    const _f6Start = Date.now();
    if (footerLine) {
      finalLines.push(footerLine);
    }

    const optimizedFileContent = finalLines.join("\r\n");
    
    logs.push(`[SUCESSO] Processo de otimizaÃ§Ã£o concluÃ­do com sucesso!`);
    logs.push(`[SUCESSO] Itens Otimizados com Economia: ${itemsSwappedCount} de ${parsedItems.length}`);
    logs.push(`[SUCESSO] Economia Estimada Total: R$ ${totalSavings.toFixed(2)}`);

    // Salvar logs em arquivo para debug (facilita leitura pelo agente)
    try {
      const logDir = "debug-logs";
      if (!fs.existsSync(logDir)) fs.mkdirSync(logDir, { recursive: true });
      const logFile = `${logDir}/optimize-${Date.now()}.log`;
      fs.writeFileSync(logFile, logs.join("\n"), "utf-8");
      logs.push(`[LOG-SALVO] ${logFile}`);
    } catch (e) { /* ignore */ }

    _p6 = Date.now() - _f6Start;
    const _totalPhases = _p1 + _p2 + _p3 + _p4 + _p5 + _p6;
    const _totalReal = Date.now() - _phaseStart;
    logs.push(`[FASE-6-RESTO] ${_p6}ms`);
    logs.push(`[FASE-TOTAL-SOMA] ${_totalPhases}ms (fases 1-6 somadas) | real: ${_totalReal}ms`);
    console.log(`[FASE-6-RESTO] ${_p6}ms`);
    console.log(`[FASE-TOTAL-SOMA] ${_totalPhases}ms (fases 1-6 somadas) | real: ${_totalReal}ms`);

    // Enriquecer report com avisos de observação (nom_obsvenda) do marketSimilarMap
    // pra que o ObservationBell não precise buscar individualmente por EAN
    for (const item of report) {
      if (item.origem === "encomenda" || item.origem === "manual") {
        item.avisoOriginal = "";
        item.avisoNovo = "";
        continue;
      }
      const eanOrigClean = cleanEan(item.originalEan);
      const eanNovoClean = cleanEan(item.novoEan);
      const similaresOrig = marketSimilarMap[eanOrigClean] || [];
      const exactOrig = similaresOrig.find((p: any) => cleanEan(p.ean || p.cod_barra || "") === eanOrigClean);
      item.avisoOriginal = exactOrig?.nom_obsvenda || "";
      if (item.novoEan && item.novoEan !== item.originalEan) {
        const similaresNovo = marketSimilarMap[eanNovoClean] || [];
        const exactNovo = similaresNovo.find((p: any) => cleanEan(p.ean || p.cod_barra || "") === eanNovoClean);
        item.avisoNovo = exactNovo?.nom_obsvenda || "";
      } else {
        item.avisoNovo = "";
      }
    }

    res.json({
      optimizedFileContent,
      cnpj: finalCnpj,
      summary: {
        totalItems: parsedItems.length,
        itemsTreated: itemsTreatedCount,
        itemsSwapped: itemsSwappedCount,
        totalSavings
      },
      report: report,
      minimos: allMinimos,
      logs
    });

    try {
      const pedidoNum = `OPT_${Date.now()}`;
      saveOrder(pedidoNum, finalCnpj, new Date().toISOString(), { parsedItems: parsedItems.length, totalSavings });
      for (const item of report) {
        if (item.novoEan && item.novoEan !== item.originalEan) {
          saveOrderItem({
            numPedido: pedidoNum,
            ean: item.novoEan,
            descricao: item.novaDescricao || item.originalDescricao || "",
            laboratorio: item.novoLaboratorio || item.originalLaboratorio || "",
            codDist: Number(item.codDist || 0),
            nomeDist: item.distribuidora || "",
            qtd: Number(item.qtd || 0),
            precoLiquido: Number(item.novoPreco || 0),
            precoOriginal: Number(item.originalPreco || 0),
            economia: Number(item.economiaTotal || 0),
            isSwap: true
          });
        }
      }
    } catch {}
  } catch (err: any) {
    console.error("Erro interno do servidor durante otimizaÃ§Ã£o:", err);
    logs.push(`[ERRO CRÃTICO] Falha inesperada interna: ${err.message}`);
    res.status(500).json({ error: "Erro interno do servidor: " + err.message, logs });
  }
});
// Endpoint de Faturamento SmartPed (SimulaÃ§Ã£o e IntegraÃ§Ã£o Real)
app.post("/api/faturar", async (req, res) => {
  const logs: string[] = [];
  try {
    const {
      items = [],
      token,
      cnpj,
      useTestUrl = true,
      simulationMode = false
    } = req.body;

    logs.push(`[FATURAMENTO] Iniciando faturamento na SmartPed.`);
    logs.push(`[FATURAMENTO] Total de itens selecionados: ${items.length}`);

    if (items.length === 0) {
      logs.push(`[FATURAMENTO ERRO] Nenhum item ativo selecionado para faturamento.`);
      return res.status(400).json({ error: "Selecione ao menos um item para faturar.", logs });
    }

    const actualToken = (token || CONFIG.SMARTPED_SANDBOX_TOKEN).trim();
    const isSandboxToken = actualToken === CONFIG.SMARTPED_SANDBOX_TOKEN;
    const apiCnpj = isSandboxToken ? "11111111111111" : (cnpj || CONFIG.SMARTPED_DEFAULT_CNPJ).trim().replace(/\D/g, "");

    logs.push(`[FATURAMENTO] Token: ${actualToken.substring(0, 6)}... | CNPJ: ${apiCnpj}`);

    // ==========================================
    // BLINDAGEM (VALIDATION) DOS ITENS DO LOTE
    // ==========================================
    const validatedItems: any[] = [];
    for (const item of items) {
      item.codProduto = cleanCodProduto(item.codProduto, item.codProdutoDist);
      const isSwapped = String(item.novoEan || "").trim() !== String(item.originalEan || "").trim();
      
      const rawCodDist = item.codDist;
      const parsedCodDist = typeof rawCodDist === "number" ? rawCodDist : (rawCodDist !== undefined && rawCodDist !== null ? parseInt(String(rawCodDist), 10) : NaN);
      const originalCodDistNum = typeof item.originalCodDist === "number" ? item.originalCodDist : (item.originalCodDist !== undefined && item.originalCodDist !== null ? parseInt(String(item.originalCodDist), 10) : NaN);
      const distNameLower = String(item.distribuidora || "").toLowerCase();

      // Blindagem 4 (Regra de Ouro 2): Itens sem distribuidora ou "Não Encontrados"/"Sem Estoque" ou com codDist === 0 ou inválidos
      // Exceção: ruptura legítima — substitute válido (codDist>0) quando original não tinha ofertas (originalCodDist=0)
      const isLegitimaRuptura = parsedCodDist > 0 && (originalCodDistNum === 0 || isNaN(originalCodDistNum));
      if (
        (parsedCodDist === 0 || isNaN(parsedCodDist)) ||
        (!isLegitimaRuptura && originalCodDistNum === 0) ||
        isNotFoundName(item.distribuidora) ||
        distNameLower.trim() === ""
      ) {
        logs.push(`[BLINDAGEM] Item bloqueado (Filtro Distribuidora/Estoque): ${item.novaDescricao || item.originalDescricao} (${item.novoEan || item.originalEan}) possui codDist/originalCodDist zerado ou invÃ¡lido (codDist: ${rawCodDist}, originalCodDist: ${item.originalCodDist}) ou distribuidora "${item.distribuidora || ''}". Ignorando faturamento.`);
        continue;
      }

      const codDistNum = parsedCodDist;
      const codProdDistStr = String(item.codProdutoDist || "").trim();
      const codProdutoStr = String(item.codProduto || "").trim();

      // Blindagem 1: Swaps para distribuidores reais devem ter IDs de produto vÃ¡lidos (nÃ£o '0' ou vazio ou null ou undefined ou strings "null"/"undefined")
      // Fornecedor externo (codDist=9999) nÃ£o pode ser faturado via SmartPed — bloquear
      if (codDistNum === 9999) {
        logs.push(`[BLINDAGEM] Item bloqueado (Fornecedor Externo): ${item.novaDescricao || item.originalDescricao} (${item.novoEan || item.originalEan}) possui codDist=9999 (Pedido via WhatsApp). Faturamento via SmartPed nÃ£o disponÃ­vel para fornecedores externos.`);
        continue;
      }
      if (isSwapped) {
        const isProdDistInvalid = !codProdDistStr || 
                                  codProdDistStr === "0" || 
                                  codProdDistStr.toLowerCase() === "null" || 
                                  codProdDistStr.toLowerCase() === "undefined";
                                  
        const isProdInvalid = !codProdutoStr || 
                              codProdutoStr === "0" || 
                              codProdutoStr.toLowerCase() === "null" || 
                              codProdutoStr.toLowerCase() === "undefined";

        if (isProdDistInvalid || isProdInvalid) {
          logs.push(`[BLINDAGEM] Item bloqueado (CÃ³digo Invalido/Zero/Null): ${item.novaDescricao || item.originalDescricao} (${item.novoEan || item.originalEan}) Ã© substituto mas possui CodProdutoDist/CodProduto invÃ¡lidos ou nulos/zeros. Ignorando faturamento deste item.`);
          continue;
        }
      }

      // Blindagem 2: Swaps sem EAN de destino vÃ¡lido
      if (isSwapped) {
        if (!item.novoEan || String(item.novoEan).length < 5) {
          logs.push(`[BLINDAGEM] Item bloqueado: Swap EAN invÃ¡lido para ${item.originalDescricao}.`);
          continue;
        }
      }

      // Blindagem 3: Garantir que nÃ£o existam valores nulos/undefined crÃ­ticos
      if (!item.novoEan && !item.originalEan) {
        logs.push(`[BLINDAGEM] Item bloqueado: EAN ausente.`);
        continue;
      }

      validatedItems.push(item);
    }

    if (validatedItems.length === 0) {
      logs.push(`[FATURAMENTO ERRO] Nenhum item passou pelas regras de Blindagem de seguranÃ§a.`);
      return res.status(400).json({ error: "Nenhum dos itens selecionados passou nas validaÃ§Ãµes de seguranÃ§a dos cÃ³digos de produto.", logs });
    }

    logs.push(`[FATURAMENTO] Itens aprovados pela blindagem: ${validatedItems.length} de ${items.length}`);

    // Agrupar itens por distribuidora para logs e cÃ¡lculos locais
    const distribuidorasMap: Record<string, typeof validatedItems> = {};
    let totalValor = 0;
    let totalEconomia = 0;

    for (const item of validatedItems) {
      const dist = item.distribuidora || "Distribuidora Geral";
      if (!distribuidorasMap[dist]) {
        distribuidorasMap[dist] = [];
      }
      distribuidorasMap[dist].push(item);
      totalValor += (item.novoPreco || item.originalPreco) * (item.qtd || 1);
      totalEconomia += (item.economiaTotal || 0);
    }

    const pedidosDistribuidoras: any[] = [];
    const protocoloLote = "SP-" + new Date().getFullYear() + "-" + String(new Date().getMonth() + 1).padStart(2, "0") + String(new Date().getDate()).padStart(2, "0") + "-" + Math.floor(1000 + Math.random() * 9000);

    logs.push(`[FATURAMENTO] Agrupamento concluÃ­do em ${Object.keys(distribuidorasMap).length} distribuidora(s).`);

    for (const [distName, distItems] of Object.entries(distribuidorasMap)) {
      const valorPedido = distItems.reduce((acc, item) => acc + (item.novoPreco || item.originalPreco) * (item.qtd || 1), 0);
      const economiaPedido = distItems.reduce((acc, item) => acc + (item.economiaTotal || 0), 0);
      const pedidoId = "PED-" + distName.substring(0, 3).toUpperCase() + "-" + Math.floor(40000 + Math.random() * 20000);

      logs.push(`[FATURAMENTO] [${distName}] ${distItems.length} itens | Valor: R$ ${valorPedido.toFixed(2)} | Economia: R$ ${economiaPedido.toFixed(2)}`);
      
      pedidosDistribuidoras.push({
        distribuidora: distName,
        pedidoId,
        itensCount: distItems.length,
        valorTotal: valorPedido,
        economia: economiaPedido,
        status: "Pendente Retorno"
      });
    }

    // Geramos um ID de pedido SmartPed numÃ©rico para monitoramento (ex: 3221)
    let numPedidoSmartPed = Math.floor(2000 + Math.random() * 8000);
    let distribuidorasBloqueadas: any[] = [];

    if (!simulationMode) {
      let baseUrl = useTestUrl ? CONFIG.SMARTPED_SANDBOX_URL : CONFIG.SMARTPED_PRODUCTION_URL;
      const endpointEnvio = `${baseUrl.replace(/\/$/, "")}/api/Pedido/Envio`;
      logs.push(`[API CONEXÃƒO] Registrando faturamento na API SmartPed: ${endpointEnvio}...`);

      // Mapeamento dos itens para a estrutura oficial da SmartPed (api/Pedido/Envio)
      // Para itens com codProdutoDist ou codProduto vazio/0, buscar nas alternatives
      const apiItens = validatedItems.map((it: any) => {
        let codProdDist = String(it.codProdutoDist || "").trim();
        let codProd = String(it.codProduto || "").trim();
        // Se codProdutoDist ou codProduto vazio/0 e tem alternatives, copiar do substituto escolhido
        // IMPORTANTE: aplica para TODOS os itens (origem=encomenda, manual, ou qualquer outra)
        if ((!codProdDist || codProdDist === "0" || !codProd || codProd === "0") && it.alternatives && it.alternatives.length > 0) {
          const altMatch = it.alternatives.find((a: any) => a.codProdutoDist && String(a.codProdutoDist).trim() !== "" && String(a.codProdutoDist).trim() !== "0");
          if (altMatch) {
            codProdDist = String(altMatch.codProdutoDist || "").trim();
            codProd = String(altMatch.codProduto || altMatch.codProdutoDist || "").trim();
            logs.push(`[BLINDAGEM] codProdutoDist/codProduto recuperado do alternativo: ${it.novaDescricao || it.originalDescricao} → codProdutoDist=${codProdDist}, codProduto=${codProd}`);
          }
        }
        // Se ainda estiver 0, tentar herdar do item pai (código original do ERP)
        if ((!codProd || codProd === "0") && it.codProduto && String(it.codProduto).trim() !== "" && String(it.codProduto).trim() !== "0") {
          codProd = String(it.codProduto).trim();
          logs.push(`[BLINDAGEM] codProduto herdado do pai: ${it.novaDescricao || it.originalDescricao} → codProduto=${codProd}`);
        }
        if ((!codProdDist || codProdDist === "0") && it.codProdutoDist && String(it.codProdutoDist).trim() !== "" && String(it.codProdutoDist).trim() !== "0") {
          codProdDist = String(it.codProdutoDist).trim();
          logs.push(`[BLINDAGEM] codProdutoDist herdado do pai: ${it.novaDescricao || it.originalDescricao} → codProdutoDist=${codProdDist}`);
        }
        return {
          CodDist: typeof it.codDist === "number" ? it.codDist : parseInt(it.codDist) || 2,
          Condicao: it.condicao || "FIXA",
          CodProdutoDist: codProdDist || "0",
          CodProduto: codProd || "0",
          Prazo: typeof it.prazo === "number" ? it.prazo : parseInt(it.prazo) || 7,
          Ean: String(it.novoEan || it.originalEan),
          Quant: typeof it.qtd === "number" ? it.qtd : parseFloat(it.qtd) || 1
        };
      });

      const apiPayload = {
        Token: actualToken,
        parametros: {
          CnpjCLi: apiCnpj,
          Pedido: {
            NumeroPedCliente: protocoloLote,
            Itens: apiItens
          }
        }
      };

      try {
        logs.push(`[API PAYLOAD] Enviando ${apiItens.length} itens para a SmartPed.`);
        logs.push(`[API PAYLOAD DETALHES] ${JSON.stringify(apiPayload, null, 2)}`);

        const resFaturar = await fetch(endpointEnvio, {
          method: "POST",
          headers: {
            "Content-Type": "application/json",
            "Accept": "application/json"
          },
          body: JSON.stringify(apiPayload),
          signal: AbortSignal.timeout(30000)
        });

        logs.push(`[API RESPOSTA] Status HTTP ${resFaturar.status} ${resFaturar.statusText}`);

        if (resFaturar.ok) {
          const resData = await resFaturar.json();
          logs.push(`[API RESPOSTA COMPLETA] ${JSON.stringify(resData, null, 2)}`);

          const isErrorMsg = resData.Mensagem && (
            resData.Mensagem.toLowerCase().includes("erro") ||
            resData.Mensagem.toLowerCase().includes("falha") ||
            resData.Mensagem.toLowerCase().includes("invÃ¡lido") ||
            resData.Mensagem.toLowerCase().includes("invalido")
          );

          if (isErrorMsg) {
            logs.push(`[API ERRO] SmartPed recusou o envio: "${resData.Mensagem}"`);
            return res.status(400).json({
              sucesso: false,
              error: `A SmartPed recusou o faturamento: ${resData.Mensagem}`,
              logs
            });
          }

          const hasRetorno = resData.Retorno && (resData.Retorno.NumPedido || resData.Retorno.numPedido);
          if (!hasRetorno) {
            logs.push(`[API ERRO] Resposta da SmartPed sem ID de pedido vÃ¡lido (Retorno ou NumPedido nulo).`);
            const errMsg = resData.Mensagem || "Resposta sem tag Retorno ou NumPedido de confirmaÃ§Ã£o de faturamento.";
            return res.status(400).json({
              sucesso: false,
              error: `Falha no faturamento SmartPed: ${errMsg}`,
              logs
            });
          }

          numPedidoSmartPed = parseInt(resData.Retorno.NumPedido || resData.Retorno.numPedido);
          logs.push(`[API CONEXÃƒO SUCESSO] Pedido cadastrado com sucesso! ID SmartPed: ${numPedidoSmartPed}`);

          // Extrair distribuidoras bloqueadas (DistBloqEnv)
          if (resData.Retorno && resData.Retorno.DistBloqEnv) {
            distribuidorasBloqueadas = Array.isArray(resData.Retorno.DistBloqEnv)
              ? resData.Retorno.DistBloqEnv
              : [resData.Retorno.DistBloqEnv];
            logs.push(`[ALERTA] Algumas distribuidoras no lote possuem bloqueio de envio: ${JSON.stringify(distribuidorasBloqueadas)}`);
          }
        } else {
          const errText = await resFaturar.text().catch(() => "Sem detalhes de erro");
          logs.push(`[API CONEXÃƒO ERRO] Endpoint SmartPed retornou falha (Status ${resFaturar.status}). Detalhes: ${errText}`);
          return res.status(400).json({
            sucesso: false,
            error: `Erro de comunicaÃ§Ã£o HTTP ${resFaturar.status} com a SmartPed.`,
            logs
          });
        }
      } catch (e: any) {
        logs.push(`[API CONEXÃƒO ERRO] Falha de comunicaÃ§Ã£o: ${e.message}`);
        return res.status(400).json({
          sucesso: false,
          error: `NÃ£o foi possÃ­vel estabelecer comunicaÃ§Ã£o com o servidor SmartPed: ${e.message}`,
          logs
        });
      }
    } else {
      logs.push(`[MOCK] Modo de SimulaÃ§Ã£o Ativo. Lote processado localmente.`);
    }

    logs.push(`[SUCESSO] Faturamento concluÃ­do no Otimizador!`);
    logs.push(`[SUCESSO] Protocolo Lote: ${protocoloLote} | ID SmartPed: ${numPedidoSmartPed}`);
    logs.push(`[SUCESSO] Valor do Lote: R$ ${totalValor.toFixed(2)} | Economia Estimada: R$ ${totalEconomia.toFixed(2)}`);

    // Alimentar o cache global de faturamento para complementar dados de retorno de itens futuros (Chaves duplas para seguranÃ§a mÃ¡xima!)
    if (numPedidoSmartPed && Array.isArray(validatedItems)) {
      validatedItems.forEach((it: any) => {
        const codDistVal = typeof it.codDist === "number" ? it.codDist : parseInt(it.codDist) || 2;
        const codProdDistVal = String(it.codProdutoDist || "0").trim();
        const codProdutoVal = String(it.codProduto || "0").trim();
        const eanVal = String(it.novoEan || it.originalEan || "").trim();
        const descVal = String(it.novaDescricao || it.originalDescricao || "").trim();
        const labVal = String(it.novoLaboratorio || it.originalLaboratorio || "").trim();

        if (eanVal) {
          if (codProdDistVal && codProdDistVal !== "0") {
            const cacheKey = `${numPedidoSmartPed}_${codDistVal}_${codProdDistVal}`;
            FATURAMENTO_ITEMS_CACHE[cacheKey] = {
              ean: eanVal,
              descricao: descVal,
              laboratorio: labVal
            };
          }
          if (codProdutoVal && codProdutoVal !== "0") {
            const cacheKey2 = `${numPedidoSmartPed}_${codDistVal}_${codProdutoVal}`;
            FATURAMENTO_ITEMS_CACHE[cacheKey2] = {
              ean: eanVal,
              descricao: descVal,
              laboratorio: labVal
            };
          }
        }
      });
    }

    // Salvar pedido no Turso ANTES de responder ao frontend (garante persistência)
    let orderSaved = false;
    try {
      saveOrder(String(numPedidoSmartPed), apiCnpj, new Date().toISOString(), { totalValor, totalEconomia }, { protocoloLote, distribuidorasBloqueadas });
      for (const it of validatedItems) {
        saveOrderItem({
          numPedido: String(numPedidoSmartPed),
          ean: it.novoEan || it.originalEan || "",
          descricao: it.novaDescricao || it.originalDescricao || "",
          laboratorio: it.novoLaboratorio || it.originalLaboratorio || "",
          codDist: Number(it.codDist || 2),
          nomeDist: it.distribuidora || "",
          qtd: Number(it.qtd || 1),
          precoLiquido: Number(it.novoPreco || 0),
          precoOriginal: Number(it.originalPreco || 0),
          economia: Number(it.economiaTotal || 0),
          isSwap: it.novoEan !== it.originalEan,
          origem: it.origem || 'manual',
          idEncomenda: it.idEncomenda || null
        });
      }
      orderSaved = true;
      logs.push(`[TURSO] Pedido ${numPedidoSmartPed} salvo com sucesso.`);
    } catch (saveErr: any) {
      console.error(`[TURSO] Erro ao salvar pedido ${numPedidoSmartPed}:`, saveErr.message);
      logs.push(`[TURSO ERRO] Falha ao salvar pedido: ${saveErr.message}`);
    }

    // Montar lista de encomendas pendentes de confirmação (confirmar DEPOIS do retorno)
    const encomendasPendentes: any[] = [];
    if (orderSaved) {
      const encomendasItens = validatedItems.filter((it: any) => it.origem === "encomenda" && it.idEncomenda);
      if (encomendasItens.length > 0) {
        const idsEncomenda = [...new Set(encomendasItens.map((it: any) => String(it.idEncomenda)))];
        for (const id of idsEncomenda) {
          const itensDaEncomenda = encomendasItens.filter((it: any) => String(it.idEncomenda) === id);
          encomendasPendentes.push({
            idEncomenda: id,
            fornecedor: itensDaEncomenda[0]?.distribuidora || "",
            itens: itensDaEncomenda.map((it: any) => ({
              ean: it.novoEan || it.originalEan || "",
              codDist: it.codDist || 0,
              descricao: it.novaDescricao || it.originalDescricao || ""
            }))
          });
        }
      }
    }

    res.json({
      sucesso: true,
      protocoloLote,
      numPedido: numPedidoSmartPed,
      dataFaturamento: new Date().toISOString(),
      cnpjFaturado: apiCnpj,
      valorTotal: totalValor,
      economiaTotal: totalEconomia,
      pedidosDistribuidoras,
      distribuidorasBloqueadas,
      encomendasPendentes,
      itemsFaturados: validatedItems.map((it: any) => ({
        ean: it.novoEan || it.originalEan,
        descricao: it.novaDescricao || it.originalDescricao,
        laboratorio: it.novoLaboratorio || it.originalLaboratorio,
        qtd: it.qtd || 1,
        preco: it.novoPreco || it.originalPreco,
        distribuidora: it.distribuidora || "Distribuidora Geral",
        codDist: it.codDist || 2,
        condicao: it.condicao || "FIXA",
        codProdutoDist: it.codProdutoDist || "",
        codProduto: it.codProduto || "",
        origem: it.origem || "manual",
        idEncomenda: it.idEncomenda || null
      })),
      logs
    });

    // NÃO confirmar encomendas aqui — aguardar retorno do SmartPed
    // Confirmação agora é feita pelo frontend após poll retornar status=faturado
  } catch (err: any) {
    console.error("Erro no faturamento do servidor:", err);
    logs.push(`[ERRO FATURAMENTO] Erro interno: ${err.message}`);
    res.status(500).json({ error: "Erro interno ao processar faturamento: " + err.message, logs });
  }
});

// Endpoint para Monitorar Pedidos do Dia (Listar + Retorno)
app.post("/api/pedidos-do-dia", async (req, res) => {
  const logs: string[] = [];
  try {
    const { token, cnpj, useTestUrl = true, simulationMode = false } = req.body;

    const actualToken = (token || CONFIG.SMARTPED_SANDBOX_TOKEN).trim();
    const isSandboxToken = actualToken === CONFIG.SMARTPED_SANDBOX_TOKEN || simulationMode;
    const apiCnpj = (actualToken === CONFIG.SMARTPED_SANDBOX_TOKEN || simulationMode) ? "11111111111111" : (cnpj || CONFIG.SMARTPED_DEFAULT_CNPJ).trim().replace(/\D/g, "");

    const baseUrl = useTestUrl ? CONFIG.SMARTPED_SANDBOX_URL : CONFIG.SMARTPED_PRODUCTION_URL;
    const endpointListar = `${baseUrl.replace(/\/$/, "")}/api/Pedido/Listar`;
    const endpointRetorno = `${baseUrl.replace(/\/$/, "")}/api/Pedido/Retorno`;

    // Data de hoje e de 7 dias atrÃ¡s no formato DD/MM/AAAA
    const hoje = new Date(new Date().toLocaleString("en-US", { timeZone: "America/Sao_Paulo" }));
    const seteDiasAtras = new Date(hoje);
    seteDiasAtras.setDate(hoje.getDate() - 7);

    const formatDate = (d: Date) => `${String(d.getDate()).padStart(2, '0')}/${String(d.getMonth() + 1).padStart(2, '0')}/${d.getFullYear()}`;
    const dataIni = formatDate(seteDiasAtras);
    const dataFim = formatDate(hoje);

    logs.push(`[MONITORAMENTO] Buscando pedidos de ${dataIni} atÃ© ${dataFim}...`);
    logs.push(`[MONITORAMENTO] Endpoint Listar: ${endpointListar}`);
    
    let pedidosResumidos: any[] = [];
    
    if (!isSandboxToken) {
      try {
        const resListar = await fetch(endpointListar, {
          method: "POST",
          headers: { "Content-Type": "application/json", "Accept": "application/json" },
          body: JSON.stringify({
            Token: actualToken,
            parametros: { CnpjCLi: apiCnpj, DataIni: dataIni, DataFim: dataFim }
          })
        });
        
        if (resListar.ok) {
          const dataListar = await resListar.json();
          logs.push(`[MONITORAMENTO RESPOSTA RAW] ${JSON.stringify(dataListar)}`);
          const retornoListar = dataListar.Retorno || dataListar.retorno || [];
          if (Array.isArray(retornoListar)) {
            pedidosResumidos = retornoListar;
          } else if (retornoListar && Array.isArray(retornoListar.pedidos || retornoListar.Pedidos)) {
            pedidosResumidos = retornoListar.pedidos || retornoListar.Pedidos;
          } else if (Array.isArray(dataListar.pedidos)) {
            pedidosResumidos = dataListar.pedidos;
          }
          logs.push(`[MONITORAMENTO SUCESSO] ${pedidosResumidos.length} pedidos encontrados.`);
        } else {
          logs.push(`[MONITORAMENTO ALERTA] Falha na API Listar (Status ${resListar.status}).`);
        }
      } catch (err: any) {
        logs.push(`[MONITORAMENTO ERRO] Erro na API Listar: ${err.message}`);
      }
    } else {
      logs.push(`[MOCK] Modo SimulaÃ§Ã£o (Token de testes). Gerando pedidos fictÃ­cios do dia.`);
      const now = new Date();
      const formatDate = (d: Date) => {
        const dd = String(d.getDate()).padStart(2, '0');
        const mm = String(d.getMonth() + 1).padStart(2, '0');
        const yyyy = d.getFullYear();
        return `${dd}/${mm}/${yyyy}`;
      };
      const todayStr = formatDate(now);
      const yesterday = new Date(now.getTime() - 24 * 60 * 60 * 1000);
      const yesterdayStr = formatDate(yesterday);

      pedidosResumidos = [
        { NumPedido: 52, DataPedido: todayStr },
        { NumPedido: 51, DataPedido: yesterdayStr },
        { NumPedido: 50, DataPedido: "02/07/2026" },
        { NumPedido: 49, DataPedido: "02/07/2026" },
        { NumPedido: 48, DataPedido: "02/07/2026" },
        { NumPedido: 47, DataPedido: "01/07/2026" },
        { NumPedido: 46, DataPedido: "30/06/2026" },
        { NumPedido: 45, DataPedido: "30/06/2026" },
        { NumPedido: 44, DataPedido: "29/06/2026" },
        { NumPedido: 43, DataPedido: "29/06/2026" }
      ];
    }

    const relatorioFinal: any[] = [];

    // Remover duplicatas e ordenar decrescente (mais recentes primeiro)
    const seenPedidos = new Set<string>();
    const uniquePedidosResumidos: any[] = [];
    for (const ped of pedidosResumidos) {
      const numPedido = String(ped.NumPedido || ped.numeroPedido || ped.numero_pedido || "").trim();
      if (numPedido && !seenPedidos.has(numPedido)) {
        seenPedidos.add(numPedido);
        uniquePedidosResumidos.push(ped);
      }
    }
    uniquePedidosResumidos.sort((a, b) => {
      const numA = Number(a.NumPedido || a.numeroPedido || a.numero_pedido || 0);
      const numB = Number(b.NumPedido || b.numeroPedido || b.numero_pedido || 0);
      return numB - numA;
    });
    pedidosResumidos = uniquePedidosResumidos;

    // Para cada pedido, buscar detalhes do Retorno
    for (const ped of pedidosResumidos) {
      const numPedido = ped.NumPedido || ped.numeroPedido || ped.numero_pedido;
      if (!numPedido) continue;

      let pedDetalhes: any = null;
      logs.push(`[MONITORAMENTO DETALHE] Consultando detalhes do Pedido ${numPedido}...`);

      if (!isSandboxToken) {
        try {
          const resRetorno = await fetch(endpointRetorno, {
            method: "POST",
            headers: { "Content-Type": "application/json", "Accept": "application/json" },
            body: JSON.stringify({
              Token: actualToken,
              parametros: { CnpjCLi: apiCnpj, NumeroPedido: numPedido, NumPedido: numPedido }
            })
          });

          if (resRetorno.ok) {
            const dataRet = await resRetorno.json();
            pedDetalhes = dataRet.Retorno || dataRet.retorno;
            if (!pedDetalhes && dataRet.dists) {
              pedDetalhes = dataRet;
            }
          }
        } catch (err: any) {
          logs.push(`[MONITORAMENTO ERRO DETALHE] Erro ao consultar detalhes do pedido ${numPedido}: ${err.message}`);
        }
      } else {
        // Mock
        const numP = Number(numPedido);
        if (numP === 52) {
          pedDetalhes = {
            CnpjLoja: apiCnpj,
            NumeroPedCliente: "REG-52",
            dists: [{ NomeDist: "Profarma", Status: 3, DesStatus: "3 - Pedido Finalizado", CodDist: 4 }],
            Itens: [
              { CodProdutoDist: "900501", Ean: "7896422505987", Descricao: "PANTOPRAZOL SÃ“DICO SESQUI-HIDRATADO 40MG 28CP AD", Laboratorio: "MEDLEY", Quant: 10, QuantFaturada: 10, Preco: 22.50, Desconto: 10.00, ST: 0.80, PrecoLiquido: 20.25, NomeDist: "Profarma", CodDist: 4, Condicao: "FIXA", DifMedio: 0.00, Motivo: "" }
            ]
          };
        } else if (numP === 51) {
          pedDetalhes = {
            CnpjLoja: apiCnpj,
            NumeroPedCliente: "REG-51",
            dists: [{ NomeDist: "Profarma", Status: 3, DesStatus: "3 - Pedido Finalizado", CodDist: 4 }],
            Itens: [
              { CodProdutoDist: "900502", Ean: "7896014194881", Descricao: "FORXIGA 10MG C/30 COMPRIMIDOS", Laboratorio: "ASTRAZENECA", Quant: 5, QuantFaturada: 5, Preco: 154.00, Desconto: 5.00, ST: 4.50, PrecoLiquido: 146.30, NomeDist: "Profarma", CodDist: 4, CodDistOriginal: 4, NomeDistOriginal: "Profarma", CodDistRecomendado: 4, NomeDistRecomendado: "Profarma", CodDistFaturado: 4, NomeDistFaturado: "Profarma", Condicao: "FIXA", DifMedio: 0.00, Motivo: "" }
            ]
          };
        } else if (numP === 48) {
          pedDetalhes = {
            CnpjLoja: apiCnpj,
            NumeroPedCliente: "REG-48",
            dists: [{ NomeDist: "Pan/Santa", Status: 3, DesStatus: "3 - Pedido Finalizado", CodDist: 2 }],
            Itens: [
              { CodProdutoDist: "100570", Ean: "7896004715438", Descricao: "BRONDILAT XAROPE PEDIATRICO 120ML", Laboratorio: "ACHE", Quant: 5, QuantFaturada: 5, Preco: 36.30, Desconto: 5.00, ST: 1.09, PrecoLiquido: 35.58, NomeDist: "Pan/Santa", CodDist: 2, Condicao: "FIXA", DifMedio: 2.25, Motivo: "" },
              { CodProdutoDist: "400182", Ean: "7896004734892", Descricao: "BISOLVON XAROPE EXPECTORANTE ADULTO 120ML", Laboratorio: "SANOFI", Quant: 10, QuantFaturada: 10, Preco: 29.28, Desconto: 2.00, ST: 1.31, PrecoLiquido: 30.00, NomeDist: "Pan/Santa", CodDist: 2, Condicao: "FIXA", DifMedio: 28.69, Motivo: "" },
              { CodProdutoDist: "403920", Ean: "7896004702112", Descricao: "SALONPAS ADESIVO GRANDE 4 UNIDADES", Laboratorio: "HISAMITSU", Quant: 15, QuantFaturada: 15, Preco: 14.45, Desconto: 10.00, ST: 1.45, PrecoLiquido: 14.46, NomeDist: "Pan/Santa", CodDist: 2, Condicao: "FIXA", DifMedio: 0.27, Motivo: "" },
              { CodProdutoDist: "403922", Ean: "7896004702129", Descricao: "SALONPAS ADESIVO PEQUENO 10 UNIDADES", Laboratorio: "HISAMITSU", Quant: 8, QuantFaturada: 8, Preco: 9.06, Desconto: 10.00, ST: 0.91, PrecoLiquido: 9.06, NomeDist: "Pan/Santa", CodDist: 2, Condicao: "FIXA", DifMedio: 0.44, Motivo: "" },
              { CodProdutoDist: "403733", Ean: "7896004789311", Descricao: "TYLENOL 750MG C/10 COMPRIMIDOS", Laboratorio: "KENVUE / JOHNSON&JOHNSON", Quant: 20, QuantFaturada: 15, Preco: 19.66, Desconto: 12.00, ST: 0.97, PrecoLiquido: 18.27, NomeDist: "Pan/Santa", CodDist: 2, Condicao: "FIXA", DifMedio: 0.98, Motivo: "Corte Parcial de Estoque" }
            ]
          };
        } else if (numP === 50) {
          pedDetalhes = {
            CnpjLoja: apiCnpj,
            NumeroPedCliente: "REG-50",
            dists: [{ NomeDist: "GAM", Status: 2, DesStatus: "2 - Aguardando faturamento", CodDist: 1 }, { NomeDist: "DrogaCenter", Status: 2, DesStatus: "2 - Aguardando faturamento", CodDist: 3 }],
            Itens: [
              { CodProdutoDist: "500120", Ean: "7891010101010", Descricao: "DORFLEX C/36 COMPRIMIDOS", Laboratorio: "SANOFI", Quant: 30, QuantFaturada: 0, Preco: 18.50, Desconto: 8.00, ST: 0.50, PrecoLiquido: 17.50, NomeDist: "GAM", CodDist: 1, Condicao: "FIXA", DifMedio: 1.20, Motivo: "Aguardando faturamento..." },
              { CodProdutoDist: "500340", Ean: "7892020202020", Descricao: "NEOSALDINA C/30 DRAGEAS", Laboratorio: "TAKEDA", Quant: 20, QuantFaturada: 0, Preco: 25.00, Desconto: 5.00, ST: 0.80, PrecoLiquido: 24.00, NomeDist: "DrogaCenter", CodDist: 3, Condicao: "FIXA", DifMedio: 0.50, Motivo: "Aguardando faturamento..." }
            ]
          };
        } else if (numP === 49) {
          pedDetalhes = {
            CnpjLoja: apiCnpj,
            NumeroPedCliente: "REG-49",
            dists: [{ NomeDist: "DrogaCenter", Status: 3, DesStatus: "3 - Pedido Finalizado", CodDist: 3 }],
            Itens: [
              { CodProdutoDist: "300450", Ean: "7893030303030", Descricao: "AMOXICILINA 500MG C/21 CAPSULAS", Laboratorio: "EMS", Quant: 10, QuantFaturada: 0, Preco: 15.00, Desconto: 12.00, ST: 0.40, PrecoLiquido: 13.20, NomeDist: "DrogaCenter", CodDist: 3, Condicao: "FIXA", DifMedio: 2.10, Motivo: "Sem Estoque Comercial" },
              { CodProdutoDist: "300460", Ean: "7894040404040", Descricao: "IBUPROFENO 600MG C/20 COMPRIMIDOS", Laboratorio: "MEDLEY", Quant: 15, QuantFaturada: 15, Preco: 12.00, Desconto: 10.00, ST: 0.30, PrecoLiquido: 10.80, NomeDist: "DrogaCenter", CodDist: 3, Condicao: "FIXA", DifMedio: 0.00, Motivo: "" }
            ]
          };
        } else {
          pedDetalhes = {
            CnpjLoja: apiCnpj,
            NumeroPedCliente: "REG-" + numP,
            dists: [{ NomeDist: "Servimed", Status: 3, DesStatus: "3 - Pedido Finalizado", CodDist: 4 }],
            Itens: [
              { CodProdutoDist: "400980", Ean: "7894916145008", Descricao: "OMEPRAZOL 20MG C/28 CAPSULAS", Laboratorio: "CIMED", Quant: 25, QuantFaturada: 25, Preco: 9.90, Desconto: 15.00, ST: 0.20, PrecoLiquido: 8.40, NomeDist: "Servimed", CodDist: 4, Condicao: "FIXA", DifMedio: 0.50, Motivo: "" }
            ]
          };
        }
      }

      if (pedDetalhes) {
        const dataPedido = ped.DataPedido || ped.dataPedido || ped.data_pedido || ped.Data || ped.data || "";
        if (!dataPedido) {
          logs.push(`[PEDIDO-DIAG] dataPedido vazio para numPedido=${numPedido}. Grafias tentadas: DataPedido, dataPedido, data_pedido, Data, data. JSON raw: ${JSON.stringify({ DataPedido: ped.DataPedido, dataPedido: ped.dataPedido, data_pedido: ped.data_pedido, Data: ped.Data, data: ped.data })}`);
        }
        relatorioFinal.push({
          numPedido,
          dataPedido,
          detalhes: pedDetalhes
        });
      }
    }

    // Enrich descriptions
    if (!isSandboxToken) {
      const eansToEnrich: string[] = [];
      for (const ped of relatorioFinal) {
        if (ped.detalhes?.Itens) {
          for (const it of ped.detalhes.Itens) {
            const ean = it.Ean || it.ean || it.EAN || "";
            if (ean) eansToEnrich.push(String(ean));
          }
        }
      }
      const descMap = await fetchEanDescriptions(baseUrl, actualToken, apiCnpj, eansToEnrich, logs);
      for (const ped of relatorioFinal) {
        if (ped.detalhes?.Itens) {
          for (const it of ped.detalhes.Itens) {
            enrichReturnedItem(it, ped.numPedido, descMap);
          }
        }
      }
    }

    res.json({ pedidos: relatorioFinal, logs });
  } catch (err: any) {
    console.error("Erro em pedidos-do-dia:", err);
    logs.push(`[ERRO CRÃTICO] Falha no monitoramento: ${err.message}`);
    res.status(500).json({ error: "Erro interno: " + err.message, logs });
  }
});

app.post("/api/itens-confirmados-do-dia", async (req, res) => {
  const logs: string[] = [];
  try {
    const agoraProcessamento = new Date().toISOString();
    const { token, cnpj, useTestUrl = true, dataInicio, dataFim, simulationMode = false } = req.body;
    const actualToken = (token || CONFIG.SMARTPED_SANDBOX_TOKEN).trim();
    const isSandboxToken = actualToken === CONFIG.SMARTPED_SANDBOX_TOKEN || simulationMode;
    const apiCnpj = isSandboxToken ? "11111111111111" : (cnpj || CONFIG.SMARTPED_DEFAULT_CNPJ).trim().replace(/\D/g, "");

    const baseUrl = useTestUrl ? CONFIG.SMARTPED_SANDBOX_URL : CONFIG.SMARTPED_PRODUCTION_URL;
    const hoje = new Date(new Date().toLocaleString("en-US", { timeZone: "America/Sao_Paulo" }));
    const formatDate = (d: Date) => `${String(d.getDate()).padStart(2, '0')}/${String(d.getMonth() + 1).padStart(2, '0')}/${d.getFullYear()}`;
    const dataHoje = formatDate(hoje);

    const formatToSmartpedDate = (dateStr?: string) => {
      if (!dateStr) return null;
      const parts = dateStr.split("-");
      if (parts.length === 3) {
        return `${parts[2]}/${parts[1]}/${parts[0]}`;
      }
      return dateStr;
    };

    const finalDataIni = dataInicio ? formatToSmartpedDate(dataInicio) : dataHoje;
    const finalDataFim = dataFim ? formatToSmartpedDate(dataFim) : dataHoje;

    // Passo 0: Consultar Turso primeiro para itens já confirmados
    logs.push(`[TURSO] Consultando itens confirmados no banco local...`);
    console.log(`[TURSO] Consultando itens confirmados para CNPJ ${apiCnpj} de ${finalDataIni} ate ${finalDataFim}...`);
    const itensTurso = await getItensConfirmados(apiCnpj, finalDataIni, finalDataFim);
    if (itensTurso.length > 0) {
      logs.push(`[TURSO] ${itensTurso.length} itens encontrados no banco local.`);
      console.log(`[TURSO] ${itensTurso.length} itens encontrados no banco local.`);
    }

    const createdAtMap = new Map<string, string>();
    for (const it of itensTurso) {
      const key = `${it.num_pedido}_${it.ean}_${it.cod_dist}`;
      if (it.created_at) createdAtMap.set(key, it.created_at);
    }

    let itensConfirmados: any[] = [];

    if (!isSandboxToken) {
      // Passo 1: Listar pedidos do dia
      logs.push(`[ITENS CONFIRMADOS] Buscando pedidos de ${finalDataIni} atÃ© ${finalDataFim}...`);
      const resListar = await fetch(`${baseUrl}/api/Pedido/Listar`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ Token: actualToken, parametros: { CnpjCLi: apiCnpj, DataIni: finalDataIni, DataFim: finalDataFim } })
      });
      const dataListar = await resListar.json();
      const pedidos = dataListar.Retorno || [];
      
      // Desduplicar pedidos para evitar duplicar itens se a API retornar mÃºltiplas linhas do mesmo pedido
      const seenPedidos = new Set<string>();
      const uniquePedidos: any[] = [];
      for (const ped of pedidos) {
        const numPedido = String(ped.NumPedido || ped.numeroPedido || "").trim();
        if (numPedido && !seenPedidos.has(numPedido)) {
          seenPedidos.add(numPedido);
          uniquePedidos.push(ped);
        }
      }
      
      // Passo 2 & 3: Retorno e Filtros
      for (const ped of uniquePedidos) {
        const numPedido = ped.NumPedido;
        const resRetorno = await fetch(`${baseUrl}/api/Pedido/Retorno`, {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ Token: actualToken, parametros: { CnpjCLi: apiCnpj, NumeroPedido: numPedido } })
        });
        const dataRet = await resRetorno.json();
        const detalhes = dataRet.Retorno;
        
        if (detalhes && detalhes.dists && detalhes.Itens) {
          const distsFinalizadas = detalhes.dists.filter((d: any) => d.Status === 3);
          const codsDistFinalizadas = distsFinalizadas.map((d: any) => d.CodDist);
          
          detalhes.Itens.forEach((it: any) => {
            const rawEan = String(it.Ean || it.ean || it.EAN || it.CodBarra || it.codBarra || it.CodBarras || it.codBarras || "").trim();
            const descSmart = String(it.Descricao || it.descricao || it.Nome || it.nome || it.Descr || it.descr || "").trim();
            const codDistNum = typeof it.CodDist === "number" ? it.CodDist : parseInt(it.CodDist) || 2;
            const codProdDistStr = String(it.CodProdutoDist || it.codProdutoDist || "0").trim();
            const codProdutoStr = String(it.CodProduto || it.codProduto || "0").trim();

            const isFaturado = codsDistFinalizadas.includes(it.CodDist) && it.QuantFaturada > 0;
            const status = isFaturado ? "faturado" : "nao_confirmado";
            const distribuidoraNome = detalhes.dists.find((d: any) => d.CodDist === it.CodDist)?.NomeDist || "Desconhecida";

            itensConfirmados.push({
              ean: rawEan,
              quantSolicitada: it.Quant || it.quant || 0,
              quantFaturada: it.QuantFaturada || it.quantFaturada || 0,
              precoLiquido: it.PrecoLiquido || it.Preco || 0,
              distribuidora: distribuidoraNome,
              codDist: codDistNum,
              codProdutoDist: codProdDistStr,
              codProduto: codProdutoStr,
              status,
              motivo: it.Motivo || "",
              numPedido,
              descricaoSmartped: descSmart
            });
          });
        }
      }
    } else {
      logs.push(`[MOCK] Modo SimulaÃ§Ã£o (Token de testes). Gerando itens confirmados fictÃ­cios para os pedidos do dia.`);
      itensConfirmados = [
        {
          ean: "7896004715438",
          quantSolicitada: 5,
          quantFaturada: 5,
          precoLiquido: 35.58,
          distribuidora: "Pan/Santa",
          codDist: 2,
          codProdutoDist: "100570",
          codProduto: "100570",
          status: "faturado",
          motivo: "",
          numPedido: 48,
          descricaoSmartped: "BRONDILAT XAROPE PEDIATRICO 120ML"
        },
        {
          ean: "7896004734892",
          quantSolicitada: 10,
          quantFaturada: 10,
          precoLiquido: 30.00,
          distribuidora: "Pan/Santa",
          codDist: 2,
          codProdutoDist: "400182",
          codProduto: "400182",
          status: "faturado",
          motivo: "",
          numPedido: 48,
          descricaoSmartped: "BISOLVON XAROPE EXPECTORANTE ADULTO 120ML"
        },
        {
          ean: "7896004702112",
          quantSolicitada: 15,
          quantFaturada: 15,
          precoLiquido: 14.46,
          distribuidora: "Pan/Santa",
          codDist: 2,
          codProdutoDist: "403920",
          codProduto: "403920",
          status: "faturado",
          motivo: "",
          numPedido: 48,
          descricaoSmartped: "SALONPAS ADESIVO GRANDE 4 UNIDADES"
        },
        {
          ean: "7896004702129",
          quantSolicitada: 8,
          quantFaturada: 8,
          precoLiquido: 9.06,
          distribuidora: "Pan/Santa",
          codDist: 2,
          codProdutoDist: "403922",
          codProduto: "403922",
          status: "faturado",
          motivo: "",
          numPedido: 48,
          descricaoSmartped: "SALONPAS ADESIVO PEQUENO 10 UNIDADES"
        },
        {
          ean: "7896004789311",
          quantSolicitada: 20,
          quantFaturada: 15,
          precoLiquido: 18.27,
          distribuidora: "Pan/Santa",
          codDist: 2,
          codProdutoDist: "403733",
          codProduto: "403733",
          status: "faturado",
          motivo: "Corte Parcial de Estoque",
          numPedido: 48,
          descricaoSmartped: "TYLENOL 750MG C/10 COMPRIMIDOS"
        },
        {
          ean: "7893030303030",
          quantSolicitada: 10,
          quantFaturada: 0,
          precoLiquido: 13.20,
          distribuidora: "DrogaCenter",
          codDist: 3,
          codProdutoDist: "300450",
          codProduto: "300450",
          status: "nao_confirmado",
          motivo: "Sem Estoque Comercial",
          numPedido: 49,
          descricaoSmartped: "AMOXICILINA 500MG C/21 CAPSULAS"
        },
        {
          ean: "7894040404040",
          quantSolicitada: 15,
          quantFaturada: 15,
          precoLiquido: 10.80,
          distribuidora: "DrogaCenter",
          codDist: 3,
          codProdutoDist: "300460",
          codProduto: "300460",
          status: "faturado",
          motivo: "",
          numPedido: 49,
          descricaoSmartped: "IBUPROFENO 600MG C/20 COMPRIMIDOS"
        },
        {
          ean: "7891010101010",
          quantSolicitada: 30,
          quantFaturada: 0,
          precoLiquido: 17.50,
          distribuidora: "GAM",
          codDist: 1,
          codProdutoDist: "500120",
          codProduto: "500120",
          status: "nao_confirmado",
          motivo: "Aguardando faturamento...",
          numPedido: 50,
          descricaoSmartped: "DORFLEX C/36 COMPRIMIDOS"
        },
        {
          ean: "7892020202020",
          quantSolicitada: 20,
          quantFaturada: 0,
          precoLiquido: 24.00,
          distribuidora: "DrogaCenter",
          codDist: 3,
          codProdutoDist: "500340",
          codProduto: "500340",
          status: "nao_confirmado",
          motivo: "Aguardando faturamento...",
          numPedido: 50,
          descricaoSmartped: "NEOSALDINA C/30 DRAGEAS"
        }
      ];
    }
    
    // Passo 4: TraduÃ§Ã£o EAN (DescriÃ§Ã£o)
    const eans = [...new Set(itensConfirmados.map(it => it.ean))].filter(Boolean);
    const descricoes = await fetchEanDescriptions(baseUrl, actualToken, apiCnpj, eans, logs);
    
    const resultadoFinal = itensConfirmados.map(it => {
      const tempItem = {
        Ean: it.ean,
        Descricao: it.descricaoSmartped,
        CodDist: it.codDist,
        CodProdutoDist: it.codProdutoDist,
        CodProduto: it.codProduto
      };
      
      enrichReturnedItem(tempItem, it.numPedido, descricoes);
      
      return {
        ...it,
        ean: tempItem.Ean,
        descricaoSmartped: tempItem.Descricao,
        nome: tempItem.Descricao,
        dataProcessamento: createdAtMap.get(`${it.numPedido}_${it.ean}_${it.codDist}`) || agoraProcessamento
      };
    });

    // Salvar itens confirmados (faturados) no Turso para histÃ³rico permanente
    const itensFaturados = resultadoFinal.filter(it => it.status === "faturado");
    if (itensFaturados.length > 0) {
      logs.push(`[TURSO] Salvando ${itensFaturados.length} itens confirmados no histÃ³rico...`);
      await saveItensConfirmadosBatch(itensFaturados.map(it => ({
        numPedido: String(it.numPedido),
        ean: it.ean,
        descricao: it.descricaoSmartped || it.nome || "",
        laboratorio: "",
        codDist: it.codDist,
        nomeDist: it.distribuidora || "",
        qtdSolicitada: it.quantSolicitada || 0,
        qtdFaturada: it.quantFaturada || 0,
        precoLiquido: it.precoLiquido || 0,
        status: it.status,
        motivo: it.motivo || "",
        cnpj: apiCnpj,
        dataConfirmacao: finalDataFim
      })));
      logs.push(`[TURSO] Itens confirmados salvos com sucesso.`);
    }

    // Combinar resultados: Turso (histórico) + API (tempo real)
    // Evitar duplicatas usando chave: numPedido + ean + codDist
    const chavesApi = new Set(resultadoFinal.map(it => `${it.numPedido}_${it.ean}_${it.codDist}`));
    const itensTursoNovos = itensTurso.filter(it => !chavesApi.has(`${it.num_pedido}_${it.ean}_${it.cod_dist}`));
    
    const resultadoCombinado = [
      ...resultadoFinal.map(it => ({
        ...it,
        fonte: "api"
      })),
      ...itensTursoNovos.map(it => ({
        ean: it.ean,
        quantSolicitada: it.qtd_solicitada,
        quantFaturada: it.qtd_faturada,
        precoLiquido: it.preco_liquido,
        distribuidora: it.nome_dist,
        codDist: it.cod_dist,
        codProdutoDist: "",
        codProduto: "",
        status: it.status,
        motivo: it.motivo || "",
        numPedido: it.num_pedido,
        descricaoSmartped: it.descricao,
        nome: it.descricao,
        dataProcessamento: it.created_at,
        fonte: "turso"
      }))
    ];

    logs.push(`[RESUMO] ${resultadoFinal.length} da API + ${itensTursoNovos.length} do Turso = ${resultadoCombinado.length} itens únicos.`);
    console.log(`[ITENS CONFIRMADOS] ${resultadoFinal.length} da API + ${itensTursoNovos.length} do Turso = ${resultadoCombinado.length} itens únicos. Faturados salvos: ${itensFaturados.length}`);

    res.json({ itens: resultadoCombinado, logs });
  } catch (err: any) {
    res.status(500).json({ error: err.message });
  }
});

// Endpoint para buscar Profarma faturados sem entrada confirmada
app.get("/api/profarma-faturados-pendentes", async (req, res) => {
  try {
    const cnpj = (req.query.cnpj as string || "").replace(/\D/g, "");
    if (!cnpj) {
      return res.status(400).json({ error: "cnpj é obrigatório" });
    }
    const result = await getProfarmaFaturadosPendentes(cnpj);
    res.json({ eans: result });
  } catch (err: any) {
    res.status(500).json({ error: err.message });
  }
});

// Endpoint para Consultar Retorno do Pedido (api/Pedido/Retorno)
app.post("/api/pedido-retorno", async (req, res) => {
  const logs: string[] = [];
  try {
    const {
      numPedido,
      token,
      cnpj,
      useTestUrl = true,
      itemsFaturados = [],
      simulationMode = false
    } = req.body;

    if (!numPedido) {
      return res.status(400).json({ error: "NÃºmero do pedido Ã© obrigatÃ³rio." });
    }

    const actualToken = (token || CONFIG.SMARTPED_SANDBOX_TOKEN).trim();
    const isSandboxToken = actualToken === CONFIG.SMARTPED_SANDBOX_TOKEN || simulationMode;
    const apiCnpj = (actualToken === CONFIG.SMARTPED_SANDBOX_TOKEN || simulationMode) ? "11111111111111" : (cnpj || CONFIG.SMARTPED_DEFAULT_CNPJ).trim().replace(/\D/g, "");

    logs.push(`[RETORNO] Consultando status do Pedido ID SmartPed: ${numPedido}`);
    logs.push(`[RETORNO] CNPJ: ${apiCnpj} | Token: ${actualToken.substring(0, 6)}...`);

    let checkCount = SIMULATED_CHECKS[String(numPedido)] || 0;
    checkCount++;
    SIMULATED_CHECKS[String(numPedido)] = checkCount;

    let baseUrl = useTestUrl ? CONFIG.SMARTPED_SANDBOX_URL : CONFIG.SMARTPED_PRODUCTION_URL;
    const endpointRetorno = `${baseUrl.replace(/\/$/, "")}/api/Pedido/Retorno`;

    let apiResponseData: any = null;
    let fallbackToSimulated = false;

    if (!isSandboxToken) {
      logs.push(`[API CONEXÃƒO] Chamando endpoint real: ${endpointRetorno}...`);
      try {
        const resRetorno = await fetch(endpointRetorno, {
          method: "POST",
          headers: {
            "Content-Type": "application/json",
            "Accept": "application/json"
          },
          body: JSON.stringify({
            Token: actualToken,
            parametros: {
              CnpjCLi: apiCnpj,
              NumeroPedido: parseInt(numPedido) || numPedido,
              NumPedido: parseInt(numPedido) || numPedido
            }
          }),
          signal: AbortSignal.timeout(15000)
        });

        logs.push(`[API RESPOSTA] Status HTTP ${resRetorno.status}`);
        if (resRetorno.ok) {
          apiResponseData = await resRetorno.json();
          logs.push(`[API SUCESSO] Dados retornados com sucesso pela SmartPed.`);
        } else {
          logs.push(`[API CONEXÃƒO ALERTA] Retorno real indisponÃ­vel. Ativando simulaÃ§Ã£o inteligente para CNPJ real.`);
          fallbackToSimulated = true;
        }
      } catch (e: any) {
        logs.push(`[API CONEXÃƒO ERRO] Erro ao consultar retorno: ${e.message}. Ativando simulaÃ§Ã£o.`);
        fallbackToSimulated = true;
      }
    } else {
      logs.push(`[MOCK] Token de homologaÃ§Ã£o detectado. Utilizando simulaÃ§Ã£o controlada.`);
      fallbackToSimulated = true;
    }

    // Se estivermos em simulaÃ§Ã£o ou o serviÃ§o real falhar, criamos um retorno simulado super realÃ­stico!
    if (fallbackToSimulated || !apiResponseData) {
      // Se nÃ£o houver itemsFaturados, criamos itens fictÃ­cios padrÃ£o para que a consulta direta funcione
      const finalItemsFaturados = (itemsFaturados && itemsFaturados.length > 0) ? itemsFaturados : [
        { ean: "7894916145008", descricao: "GL CLOPIDOGREL 75MG 28CP REV", preco: 19.91, qtd: 3, distribuidora: "GAM", codDist: 60, condicao: "FIXA" },
        { ean: "7896004746937", descricao: "EZETIMIBA 10MG 30CPR BGN", preco: 13.50, qtd: 5, distribuidora: "DrogaCenter", codDist: 9, condicao: "FIXA" },
        { ean: "7891317024994", descricao: "BUPROPIONA 150MG C/30 BGN", preco: 19.50, qtd: 2, distribuidora: "PanPharma", codDist: 2, condicao: "FIXA" }
      ];

      // Agrupar as distribuidoras presentes nos itens faturados com seus respectivos cÃ³digos
      const distsMap: Record<string, number> = {};
      finalItemsFaturados.forEach((it: any) => {
        const dName = it.distribuidora || "Distribuidor";
        const dCod = typeof it.codDist === "number" ? it.codDist : parseInt(it.codDist) || 2;
        distsMap[dName] = dCod;
      });
      
      // Decidimos o Status do pedido com base no nÃºmero de consultas (para simular de fato a espera de processamento real!)
      // Primeira consulta: Status 2 (Aguardando Retorno)
      // Segunda consulta ou superior: Status 3 (Finalizado)
      // Se for homologaÃ§Ã£o sandbox clÃ¡ssica, mantemos 0 ou 3 a depender do desejo de testar.
      // Vamos simular a transiÃ§Ã£o real! Se checkCount === 1, retornamos status 2 para manter realÃ­stico!
      const simulatedStatus = checkCount === 1 ? 2 : 3;
      const descStatus = simulatedStatus === 2 
        ? "2 - Pedido Enviado Aguardando Retorno" 
        : "3 - Pedido Finalizado";

      logs.push(`[SIMULADOR] SimulaÃ§Ã£o de retorno da API. Consulta #${checkCount} | Status Definido: ${descStatus}`);

      const distsList = Object.entries(distsMap).map(([distName, distCod], dIdx) => ({
        NumPedidos: [String(numPedido + dIdx)],
        CodDist: distCod,
        NomeDist: String(distName),
        Cnpjs: ["00000000000000"],
        Status: simulatedStatus,
        DesStatus: `${simulatedStatus} - ${simulatedStatus === 2 ? "Aguardando Retorno do Distribuidor" : "Pedido Finalizado no Distribuidor"}`
      }));

      // Criar itens com faturamento simulado
      const simulatedItens = finalItemsFaturados.map((it: any, idx: number) => {
        // Se status for 3 (Finalizado), vamos simular alguns cortes/falta de estoque!
        // Cortamos o estoque de cerca de 10% dos itens (ou pelo menos 1 item se tiver mais de 4) para demonstrar as faltas
        let quantFaturada = it.qtd;
        let motivo = "EPAN_OK";
        
        if (simulatedStatus === 3) {
          // Corta se for o segundo item ou se for um sorteio azarado de 10%
          const shouldCut = idx === 1 || (idx > 0 && idx % 7 === 0);
          if (shouldCut) {
            quantFaturada = 0; // Faltou totalmente
            motivo = "FALTA DE ESTOQUE NO DISTRIBUIDOR (Corte Comercial)";
            logs.push(`[CORTADO] Item EAN ${it.ean} - "${it.descricao}" cortado pelo distribuidor por falta de estoque.`);
          } else {
            logs.push(`[FATURADO] Item EAN ${it.ean} - faturadas ${quantFaturada} de ${it.qtd} unidades.`);
          }
        } else {
          // No status 2 (Aguardando), a quantidade faturada ainda Ã© 0 em processamento
          quantFaturada = 0;
          motivo = "Aguardando faturamento final do distribuidor...";
        }

        return {
          CodDist: it.codDist || 2,
          Condicao: it.condicao || "FIXA",
          CodProdutoDist: it.codProdutoDist || "0",
          CodProduto: it.codProduto || "0",
          Desconto: 10,
          Preco: it.preco,
          Prazo: it.prazo || 7,
          Ean: it.ean,
          Quant: it.qtd,
          QuantFaturada: quantFaturada,
          Motivo: motivo,
          CX: 0,
          Descricao: it.descricao || "Item (EAN: " + it.ean + ")",
          Laboratorio: it.laboratorio || "Geral"
        };
      });

      apiResponseData = {
        Mensagem: "OK",
        Retorno: {
          CnpjLoja: apiCnpj,
          NumeroPedCliente: "REG-" + numPedido,
          Itens: simulatedItens,
          dists: distsList
        }
      };
    }

    // Enriquecer as descriÃ§Ãµes dos itens se for ambiente real (nÃ£o sandbox)
    if (!isSandboxToken && apiResponseData) {
      const apiRet = apiResponseData.Retorno || apiResponseData.retorno || apiResponseData;
      const apiItens = apiRet.Itens || apiRet.itens || [];
      if (Array.isArray(apiItens) && apiItens.length > 0) {
        const eansToEnrich: string[] = [];
        for (const it of apiItens) {
          const eanVal = it.Ean || it.ean || it.EAN || it.EanBarras;
          if (eanVal) eansToEnrich.push(String(eanVal).trim());
        }
        if (eansToEnrich.length > 0) {
          logs.push(`[ENRIQUECIMENTO] Buscando descriÃ§Ãµes para os ${eansToEnrich.length} itens do retorno...`);
          try {
            const descMap = await fetchEanDescriptions(baseUrl, actualToken, apiCnpj, eansToEnrich, logs);
            let enrichedCount = 0;
            for (const it of apiItens) {
              const eanVal = String(it.Ean || it.ean || it.EAN || it.EanBarras || "").trim();
              if (eanVal && descMap[eanVal]) {
                it.Descricao = descMap[eanVal].Descricao || it.Descricao || it.descricao;
                it.descricao = descMap[eanVal].Descricao || it.descricao || it.Descricao;
                it.Laboratorio = descMap[eanVal].Laboratorio || it.Laboratorio || it.laboratorio;
                it.laboratorio = descMap[eanVal].Laboratorio || it.laboratorio || it.Laboratorio;
                enrichedCount++;
              }
            }
            logs.push(`[ENRIQUECIMENTO SUCESSO] ${enrichedCount} itens enriquecidos com descriÃ§Ã£o e laboratÃ³rio.`);
          } catch (enrichErr: any) {
            logs.push(`[ENRIQUECIMENTO ERRO] Falha no enriquecimento de descriÃ§Ãµes: ${enrichErr.message}`);
          }
        }
      }
    }

    // Salvar itens do retorno no Turso (faturados E não confirmados) — registrado no momento REAL do retorno
    if (apiResponseData) {
      try {
        const apiRet = apiResponseData.Retorno || apiResponseData.retorno || apiResponseData;
        const apiItens = apiRet.Itens || apiRet.itens || [];
        if (Array.isArray(apiItens) && apiItens.length > 0) {
          const hoje = new Date(new Date().toLocaleString("en-US", { timeZone: "America/Sao_Paulo" }));
          const dataConfirmacaoHoje = `${String(hoje.getDate()).padStart(2, '0')}/${String(hoje.getMonth() + 1).padStart(2, '0')}/${hoje.getFullYear()}`;
          const itensParaSalvar = apiItens.map((it: any) => ({
            numPedido: String(numPedido),
            ean: String(it.Ean || it.ean || it.EAN || "").trim(),
            descricao: it.Descricao || it.descricao || "",
            laboratorio: it.Laboratorio || it.laboratorio || "",
            codDist: typeof it.CodDist === "number" ? it.CodDist : parseInt(it.CodDist) || 0,
            nomeDist: "",
            qtdSolicitada: parseInt(it.Quant || it.quant || "0") || 0,
            qtdFaturada: parseFloat(it.QuantFaturada || it.quantFaturada || "0") || 0,
            precoLiquido: parseFloat(it.Preco || it.preco || "0") || 0,
            status: (parseFloat(it.QuantFaturada || it.quantFaturada || "0") || 0) > 0 ? "faturado" : "nao_confirmado",
            motivo: it.Motivo || it.motivo || "",
            cnpj: apiCnpj,
            dataConfirmacao: dataConfirmacaoHoje
          })).filter((it: any) => it.ean);
          if (itensParaSalvar.length > 0) {
            await saveItensConfirmadosBatch(itensParaSalvar);
            logs.push(`[TURSO] ${itensParaSalvar.length} itens do retorno salvos no histórico.`);
          }
        }
      } catch (saveErr: any) {
        logs.push(`[TURSO ERRO] Falha ao salvar itens do retorno: ${saveErr.message}`);
        console.error("[TURSO ERRO] Falha ao salvar itens do retorno:", saveErr.message);
      }
    }

    res.json({
      sucesso: true,
      apiResponse: apiResponseData,
      logs
    });
  } catch (err: any) {
    console.error("Erro ao consultar retorno:", err);
    res.status(500).json({ error: "Erro interno do servidor ao consultar retorno: " + err.message });
  }
});

// Endpoint para Buscar Produtos com Estoque e Recomendar Genericos (api/Produtos/BuscaComparativa)

// Endpoint para buscar distribuidores
app.post("/api/distribuidores", async (req, res) => {
  try {
    const { token, cnpj, useTestUrl = true, customTestUrl, customProductionUrl, customEndpoint } = req.body;
    
    if (!token || !cnpj) {
      return res.status(400).json({ error: "Token e CNPJ sÃ£o obrigatÃ³rios." });
    }

    let baseUrl = useTestUrl ? CONFIG.SMARTPED_SANDBOX_URL : CONFIG.SMARTPED_PRODUCTION_URL;
    if (useTestUrl && customTestUrl) {
      baseUrl = customTestUrl.replace(/\/$/, "");
    } else if (!useTestUrl && customProductionUrl) {
      baseUrl = customProductionUrl.replace(/\/$/, "");
    }

    const actualToken = (token || CONFIG.SMARTPED_SANDBOX_TOKEN).trim();
    const isSandboxToken = actualToken === CONFIG.SMARTPED_SANDBOX_TOKEN;
    const apiCnpj = isSandboxToken ? "11111111111111" : cnpj.trim().replace(/\D/g, "");

    const endpoint = `${baseUrl}/api/Condicoes/Distribuidores`;
    const payload = {
      Token: actualToken,
      parametros: { CnpjCLi: apiCnpj }
    };

    const response = await fetch(endpoint, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(payload)
    });

    if (!response.ok) {
      throw new Error(`Erro na API da SmartPed: ${response.status}`);
    }

    const data = await response.json();
    return res.json({ distribuidores: data.Retorno || data });
  } catch (err: any) {
    console.error("Erro ao buscar distribuidores:", err);
    res.status(500).json({ error: err.message });
  }
});

app.post("/api/search-products", async (req, res) => {
  const logs: string[] = [];
  const ts = () => new Date().toLocaleString('pt-BR', { timeZone: 'America/Sao_Paulo', hour: '2-digit', minute: '2-digit', second: '2-digit' });
  const log = (msg: string) => { const m = `[${ts()}] ${msg}`; logs.push(m); console.log(`[SEARCH] ${m}`); };
  try {
    const {
      query,
      token,
      cnpj,
      useTestUrl = true,
      simulationMode = false,
      permitirSemEstoque = false,
      tipos = ["G", "O"],
      margemMinima = 0,
      cortesRecentes = {},
      onlyExactEan = false,
      skipMolecula = false
    } = req.body;

    if (!query || String(query).trim().length < 3) {
      return res.json({ items: [], logs: ["Digite pelo menos 3 caracteres para buscar."] });
    }

    const searchQuery = String(query).trim().toUpperCase();
    const actualToken = (token || CONFIG.SMARTPED_SANDBOX_TOKEN).trim();
    const isSandboxToken = actualToken === CONFIG.SMARTPED_SANDBOX_TOKEN;
    const apiCnpj = isSandboxToken ? "11111111111111" : (cnpj || CONFIG.SMARTPED_DEFAULT_CNPJ).trim().replace(/\D/g, "");

    // Normalizar query de busca: remover stopwords, normalizar abreviacoes, limpar espacos
    const normalizeSearchQuery = (q: string): { query: string; quantity: string | null } => {
      let s = q.trim().toUpperCase();
      // Remover stopwords que nao ajudam na busca
      const stopwords = ["COM", "DE", "DO", "DA", "DOS", "DAS", "PARA", "POR", "SEM", "ATE", "OU", "E", "EM", "O", "A", "OS", "AS", "UM", "UMA"];
      const words = s.split(/\s+/).filter(w => w.length > 0 && !stopwords.includes(w));

      // Extrair quantidade standalone (numero sozinho no final, ex: "60", "120")
      // NAO extrair quando a query e 100% numerica com 8+ digitos (EAN)
      let quantity: string | null = null;
      const isEan = words.length === 1 && /^\d{8,}$/.test(words[0]);
      if (!isEan) {
        const lastWord = words[words.length - 1] || "";
        if (/^\d+$/.test(lastWord) && parseInt(lastWord) > 1) {
          quantity = lastWord;
          words.pop(); // remover do query de busca
        }
      }

      // Normalizar abreviacoes de apresentacao
      const normalized = words.map(w => {
        // Dosagem: manter como esta (2MG, 500MCG, 10ML, etc.)
        if (/^\d+\s*(MG|MCG|ML|G|UI|%)$/i.test(w)) return w.replace(/\s+/g, "");
        // Apresentacao: normalizar
        if (/^(CP|CPR|COMPRIMIDO|COMPR)$/i.test(w)) return "CPR";
        if (/^(CAPS|CAPSULA|CAPSULAS)$/i.test(w)) return "CAPS";
        if (/^(UND|UN|UNID|UNIDADE)$/i.test(w)) return "UND";
        if (/^(REV|REVESTIDO)$/i.test(w)) return "REV";
        if (/^(TABS|TABLETE|TABLETES)$/i.test(w)) return "TABS";
        return w;
      });
      return { query: normalized.join(" ").replace(/\s+/g, " ").trim(), quantity };
    };

    // Versao "relaxed": remover dosagem e quantidade, manter so nome do principio ativo
    const getRelaxedQuery = (q: string): string => {
      const words = q.toUpperCase().split(/\s+/);
      return words
        .filter(w => !/^\d+/.test(w))      // remover palavras que comecam com numero (2MG, 60CPR, etc.)
        .filter(w => w.length >= 3)         // remover palavras muito curtas
        .join(" ")
        .trim();
    };

    // Verificar se uma descricao contem a quantidade desejada
    const matchesQuantity = (desc: string, qty: string | null): boolean => {
      if (!qty) return true; // sem filtro de quantidade
      const num = parseInt(qty);
      if (isNaN(num) || num <= 0) return true;
      const descUpper = (desc || "").toUpperCase();
      // Buscar padroes como "60CPR", "60 CPR", "60UND", "60 UND", "60 COMP", etc.
      const qtyPatterns = [
        new RegExp(`\\b${num}\\s*(CPR|COMP|COMPRIMIDO|CAPS|CAPSULA|UND|UN|UNID|REV|TABS|TABLETE|CP)\\b`, "i"),
        new RegExp(`\\b${num}\\b`), // fallback: numero sozinho
      ];
      return qtyPatterns.some(p => p.test(descUpper));
    };

    const { query: normalizedQuery, quantity } = normalizeSearchQuery(searchQuery);
    log(`[BUSCA] Buscando por "${normalizedQuery}" (original: "${searchQuery}", quantidade: ${quantity || "auto"}, EAN Exato: ${onlyExactEan})...`);
    log(`[DEBUG-PARAMS] queryRaw="${query}" searchQuery="${searchQuery}" isSandboxToken=${isSandboxToken} useTestUrl=${useTestUrl} apiCnpj="${apiCnpj}" baseUrl="${useTestUrl ? CONFIG.SMARTPED_SANDBOX_URL : CONFIG.SMARTPED_PRODUCTION_URL}"`);

    let foundItems: any[] = [];
    let usedRealApi = false;

    const isPureNumeric = /^\d+$/.test(searchQuery);

    if (!simulationMode && !isSandboxToken) {
      let baseUrl = useTestUrl ? CONFIG.SMARTPED_SANDBOX_URL : CONFIG.SMARTPED_PRODUCTION_URL;
      
      if (isPureNumeric) {
        // Busca paralela no endpoint de Ean e de Molecula da SmartPed para trazer tanto o produto exato quanto todos os substitutos
        const endpointEan = `${baseUrl.replace(/\/$/, "")}/api/Condicoes/Ean`;
        const endpointMolecula = `${baseUrl.replace(/\/$/, "")}/api/Condicoes/Molecula`;
        log(`[API CONEXÃƒO] Query numÃ©rica detectada (EAN). Chamando Condicoes/Ean ${onlyExactEan ? "(apenas EAN exato)" : skipMolecula ? "(sem Molecula)" : "e Condicoes/Molecula em paralelo"}.`);
        
        try {
          const pEan = fetch(endpointEan, {
            method: "POST",
            headers: {
              "Content-Type": "application/json",
              "Accept": "application/json"
            },
            body: JSON.stringify({
              Token: actualToken,
              parametros: {
                CnpjCLi: apiCnpj,
                Ean: searchQuery,
                AceitaOntem: 1
              }
            })
          });

          const pMolecula = (onlyExactEan || skipMolecula) ? Promise.resolve(null) : fetch(endpointMolecula, {
            method: "POST",
            headers: {
              "Content-Type": "application/json",
              "Accept": "application/json"
            },
            body: JSON.stringify({
              Token: actualToken,
              parametros: {
                CnpjCLi: apiCnpj,
                Ean: searchQuery,
                ConsideraTipo: 1
              }
            })
          });

          const [resEan, resMolecula] = await Promise.all([pEan, pMolecula]);
          log(`[API CONEXÃƒO] Chamadas concluÃ­das. Status Ean: ${resEan.status} | Status Molecula: ${resMolecula ? resMolecula.status : "ignorado (EAN Exato)"}`);

          let distsMap: Record<number, string> = {};
          let minimosFromApi: any[] = [];

          // 1. Processa retorno de Condicoes/Ean
          if (resEan.ok) {
            const resData = await resEan.json();
            const retorno = resData.Retorno || resData.retorno;
            const itemsReturned = retorno?.itens || retorno?.Itens || resData.itens || resData.Itens || [];
            const minimos = retorno?.minimos || retorno?.Minimos || resData.minimos || resData.Minimos || [];
            const dists = retorno?.dists || retorno?.Dists || resData.dists || resData.Dists || [];

            minimosFromApi.push(...minimos);
            for (const d of dists) {
              const cDist = d.CodDist !== undefined ? d.CodDist : d.codDist;
              const nDist = d.NomeDist || d.nomeDist || d.Nome || d.nome;
              if (cDist !== undefined && nDist) distsMap[cDist] = nDist;
            }

            if (itemsReturned.length > 0) {
              const cleanQuery = cleanEan(searchQuery);
              const entry = itemsReturned.find((i: any) => {
                const cb = cleanEan(i.CodBarra || i.codBarra);
                const eanVal = cleanEan(i.Ean || i.ean);
                const hasCond = (i.Condicoes || i.condicoes || []).some((c: any) => cleanEan(c.Ean || c.ean) === cleanQuery);
                return cb === cleanQuery || eanVal === cleanQuery || hasCond;
              });

              if (entry) {
                const condicoes = entry.Condicoes || entry.condicoes || [];
                const desc = entry.Descricao || entry.descricao || `PRODUTO EAN ${searchQuery}`;
                const lab = entry.Laboratorio || entry.laboratorio || "N/A";
                
                log(`[API CONEXÃƒO SUCESSO] SmartPed Condicoes/Ean retornou ${condicoes.length} ofertas para o EAN ${searchQuery}.`);
                
                for (const cond of condicoes) {
                  const codDist = cond.CodDist !== undefined ? cond.CodDist : cond.codDist;
                  const condicao = cond.Condicao || cond.condicao || "FIXA";
                  const prazo = cond.Prazo !== undefined ? cond.Prazo : (cond.prazo || 5);
                  
                  let pedidoMinimo = 0;
                  const matchingMinimo = minimos.find((m: any) => {
                    const mDist = String(m.CodDist !== undefined ? m.CodDist : (m.codDist !== undefined ? m.codDist : "")).trim();
                    const mCond = String(m.Condicao || m.condicao || "").trim().toUpperCase();
                    const mNomeCond = String(m.NomeCondicao || m.nomeCondicao || "").trim().toUpperCase();
                    const mPrazo = String(m.Prazo !== undefined ? m.Prazo : (m.prazo !== undefined ? m.prazo : "")).trim();
                    
                    const oDist = String(codDist).trim();
                    const oCond = String(condicao).trim().toUpperCase();
                    const oPrazo = String(prazo).trim();
                    
                    return mDist === oDist && mPrazo === oPrazo && (mCond === oCond || mNomeCond === oCond);
                  });
                  if (matchingMinimo) {
                    pedidoMinimo = matchingMinimo.VlrMinimo !== undefined ? matchingMinimo.VlrMinimo : (matchingMinimo.vlrMinimo !== undefined ? matchingMinimo.vlrMinimo : 0);
                  }

                  if (!pedidoMinimo || pedidoMinimo === 0) {
                    const nomeDistLower = String(cond.NomeDist || cond.nomeDist || cond.NomeDistribuidora || DISTRIBUIDORAS_MAP[codDist] || "").toLowerCase();
                    if (nomeDistLower.includes("panpharma") || nomeDistLower.includes("panfarma")) pedidoMinimo = 250;
                    else if (nomeDistLower.includes("profarma")) pedidoMinimo = 250;
                    else if (nomeDistLower.includes("santacruz") || nomeDistLower.includes("santa cruz")) pedidoMinimo = 300;
                    else if (nomeDistLower.includes("servimed")) pedidoMinimo = 200;
                    else if (nomeDistLower.includes("gam")) pedidoMinimo = 150;
                    else if (nomeDistLower.includes("anb")) pedidoMinimo = 250;
                    else if (nomeDistLower.trim().length > 0) pedidoMinimo = 150; 
                  }

                  const condTablePrice = extractTablePrice(cond);
                  const condBasePmc = condTablePrice > 0 ? condTablePrice : (cond.Pliquido !== undefined ? cond.Pliquido : cond.Preco);
                  const apiPmc = extractPmc(cond);
                  const finalPmc = apiPmc > 0 ? apiPmc : 0;

                  log(`[PMC DEBUG] EAN=${searchQuery} Dist=${codDist} apiPmc=${apiPmc} basePmc=${condBasePmc} finalPmc=${finalPmc}`);

                  foundItems.push({
                    Descricao: cond.Descricao || cond.descricao || desc,
                    Laboratorio: cond.Laboratorio || cond.laboratorio || lab,
                    NomeDist: (() => {
                      let nomeDist = cond.NomeDist || cond.nomeDist || cond.NomeDistribuidora;
                      if (!nomeDist && dists && dists.length > 0) {
                        const distInfo = dists.find((d: any) => String(d.CodDist || d.codDist) === String(codDist));
                        if (distInfo) {
                          nomeDist = distInfo.NomeDist || distInfo.nomeDist || distInfo.NomeDistribuidora || distInfo.Nome || distInfo.nome || distInfo.Fantasia || distInfo.fantasia;
                        }
                      }
                      return nomeDist || DISTRIBUIDORAS_MAP[codDist] || `Distribuidora ${codDist}`;
                    })(),
                    CodDist: codDist,
                    Condicao: condicao,
                    CodProdutoDist: String(cond.CodProdutoDist || cond.codProdutoDist || "0"),
                    Preco: cond.Preco !== undefined ? cond.Preco : cond.preco,
                    Pliquido: cond.Pliquido !== undefined ? cond.Pliquido : cond.pliquido,
                    PliquidoUni: cond.PliquidoUni !== undefined ? cond.PliquidoUni : cond.Pliquido,
                    PMC: finalPmc,
                    Estoque: parseInt(String(cond.Estoque !== undefined ? cond.Estoque : 0), 10) || 0,
                    Ean: String(cond.Ean || cond.ean || searchQuery),
                    Prazo: prazo,
                    TipoItem: cond.TipoItem || cond.tipoItem || entry.TipoItem || entry.tipoItem || "O",
                    PedidoMinimo: pedidoMinimo,
                    QtdMin: cond.QtdMin !== undefined ? cond.QtdMin : (cond.qtdMin !== undefined ? cond.qtdMin : 0),
                    QtdMax: (cond.Combo && cond.Combo.QtdMax !== undefined) ? cond.Combo.QtdMax : ((cond.combo && cond.combo.qtdMax !== undefined) ? cond.combo.qtdMax : 0),
                    CX: cond.CX !== undefined ? cond.CX : (cond.cx !== undefined ? cond.cx : 1),
                    QtdMinima: (matchingMinimo && matchingMinimo.QtdMinima !== undefined) ? matchingMinimo.QtdMinima : ((matchingMinimo && matchingMinimo.qtdMinima !== undefined) ? matchingMinimo.qtdMinima : 0)
                  });
                }
                usedRealApi = true;
              }
            }
          }

          // 2. Processa retorno de Condicoes/Molecula (substitutos, genÃ©ricos, similares)
          if (resMolecula && resMolecula.ok) {
            const resDataMolecula = await resMolecula.json();
            const retornoMolecula = resDataMolecula.Retorno || resDataMolecula.retorno;
            const itensMolecula = retornoMolecula?.itens || retornoMolecula?.Itens || resDataMolecula.itens || resDataMolecula.Itens || [];
            const minimosMolecula = retornoMolecula?.minimos || retornoMolecula?.Minimos || resDataMolecula.minimos || resDataMolecula.Minimos || [];
            const distsMolecula = retornoMolecula?.dists || retornoMolecula?.Dists || resDataMolecula.dists || resDataMolecula.Dists || [];

            minimosFromApi.push(...minimosMolecula);
            for (const d of distsMolecula) {
              const cDist = d.CodDist !== undefined ? d.CodDist : d.codDist;
              const nDist = d.NomeDist || d.nomeDist || d.Nome || d.nome;
              if (cDist !== undefined && nDist) distsMap[cDist] = nDist;
            }

            if (itensMolecula.length > 0) {
              log(`[API CONEXÃƒO SUCESSO] SmartPed Condicoes/Molecula retornou ${itensMolecula.length} molÃ©culas.`);
              for (const entry of itensMolecula) {
                const subsRaw = entry.Substitutos || entry.substitutos || [];
                const substitutos: any[] = [];
                subsRaw.forEach((sub: any) => {
                  const conds = sub.Condicoes || sub.condicoes || [];
                  if (conds.length === 0) {
                    substitutos.push(sub);
                  } else {
                    conds.forEach((cond: any) => {
                      substitutos.push({
                        ...cond,
                        Ean: sub.Ean || sub.EanProduto_Idi || cond.Ean || cond.ean,
                        Descricao: sub.Descricao || sub.DescricaoProduto_Idi || cond.Descricao || cond.descricao,
                        Laboratorio: sub.Laboratorio || sub.laboratorio || cond.Laboratorio || cond.laboratorio
                      });
                    });
                  }
                });
                const itemPedido = entry.ItemPedido || entry.itemPedido || {};
                const origDesc = itemPedido.Descricao || itemPedido.descricao || "";
                const origLab = itemPedido.Laboratorio || itemPedido.laboratorio || "";
                
                log(`[API INFO] MolÃ©cula do EAN ${searchQuery} retornou ${substitutos.length} substitutos.`);

                for (const sub of substitutos) {
                  const codDist = sub.CodDist !== undefined ? sub.CodDist : sub.codDist;
                  const condicao = sub.Condicao || sub.condicao || "FIXA";
                  const prazo = sub.Prazo !== undefined ? sub.Prazo : (sub.prazo || 5);
                  const subEan = String(sub.Ean || sub.ean || sub.CodBarra || sub.codBarra || "");
                  const subDesc = sub.Descricao || sub.descricao || origDesc;
                  const subLab = sub.Laboratorio || sub.laboratorio || origLab || "N/A";
                  
                  let subPreco = sub.Pliquido !== undefined ? sub.Pliquido : (sub.pliquido !== undefined ? sub.pliquido : (sub.PliquidoUni !== undefined ? sub.PliquidoUni : (sub.pliquidoUni !== undefined ? sub.pliquidoUni : (sub.Preco !== undefined ? sub.Preco : (sub.preco !== undefined ? sub.preco : 0)))));
                  let subEstoque = parseInt(String(sub.Estoque !== undefined ? sub.Estoque : (sub.estoque !== undefined ? sub.estoque : 0)), 10) || 0;

                  let pedidoMinimo = 0;
                  const matchingMinimo = minimosFromApi.find((m: any) => {
                    const mDist = String(m.CodDist !== undefined ? m.CodDist : (m.codDist !== undefined ? m.codDist : "")).trim();
                    const mCond = String(m.Condicao || m.condicao || "").trim().toUpperCase();
                    const mNomeCond = String(m.NomeCondicao || m.nomeCondicao || "").trim().toUpperCase();
                    const mPrazo = String(m.Prazo !== undefined ? m.Prazo : (m.prazo !== undefined ? m.prazo : "")).trim();
                    
                    const oDist = String(codDist).trim();
                    const oCond = String(condicao).trim().toUpperCase();
                    const oPrazo = String(prazo).trim();
                    
                    return mDist === oDist && mPrazo === oPrazo && (mCond === oCond || mNomeCond === oCond);
                  });
                  if (matchingMinimo) {
                    pedidoMinimo = matchingMinimo.VlrMinimo !== undefined ? matchingMinimo.VlrMinimo : (matchingMinimo.vlrMinimo !== undefined ? matchingMinimo.vlrMinimo : 0);
                  }

                  if (!pedidoMinimo || pedidoMinimo === 0) {
                    const nomeDistLower = String(sub.NomeDist || sub.nomeDist || sub.NomeDistribuidora || distsMap[codDist] || DISTRIBUIDORAS_MAP[codDist] || "").toLowerCase();
                    if (nomeDistLower.includes("panpharma") || nomeDistLower.includes("panfarma")) pedidoMinimo = 250;
                    else if (nomeDistLower.includes("profarma")) pedidoMinimo = 250;
                    else if (nomeDistLower.includes("santacruz") || nomeDistLower.includes("santa cruz")) pedidoMinimo = 300;
                    else if (nomeDistLower.includes("servimed")) pedidoMinimo = 200;
                    else if (nomeDistLower.includes("gam")) pedidoMinimo = 150;
                    else if (nomeDistLower.includes("anb")) pedidoMinimo = 250;
                    else if (nomeDistLower.trim().length > 0) pedidoMinimo = 150;
                  }

                  const subTablePrice = extractTablePrice(sub);
                  const subBasePmc = subTablePrice > 0 ? subTablePrice : subPreco;
                  const apiPmc = extractPmc(sub);
                  const finalPmc = apiPmc > 0 ? apiPmc : 0;

                  foundItems.push({
                    Descricao: subDesc,
                    Laboratorio: subLab,
                    NomeDist: (() => {
                      let nomeDist = sub.NomeDist || sub.nomeDist || sub.NomeDistribuidora;
                      if (!nomeDist && distsMolecula && distsMolecula.length > 0) {
                        const distInfo = distsMolecula.find((d: any) => String(d.CodDist || d.codDist) === String(codDist));
                        if (distInfo) {
                          nomeDist = distInfo.NomeDist || distInfo.nomeDist || distInfo.NomeDistribuidora || distInfo.Nome || distInfo.nome || distInfo.Fantasia || distInfo.fantasia;
                        }
                      }
                      return nomeDist || distsMap[codDist] || DISTRIBUIDORAS_MAP[codDist] || `Distribuidora ${codDist}`;
                    })(),
                    CodDist: codDist,
                    Condicao: condicao,
                    CodProdutoDist: String(sub.CodProdutoDist || sub.codProdutoDist || "0"),
                    Preco: sub.Preco !== undefined ? sub.Preco : sub.preco || subPreco,
                    Pliquido: subPreco,
                    PliquidoUni: sub.PliquidoUni !== undefined ? sub.PliquidoUni : subPreco,
                    PMC: finalPmc,
                    Estoque: subEstoque,
                    Ean: subEan,
                    Prazo: prazo,
                    TipoItem: sub.TipoItem || sub.tipoItem || "O",
                    PedidoMinimo: pedidoMinimo,
                    QtdMin: sub.QtdMin !== undefined ? sub.QtdMin : (sub.qtdMin !== undefined ? sub.qtdMin : 0),
                    QtdMax: (sub.Combo && sub.Combo.QtdMax !== undefined) ? sub.Combo.QtdMax : ((sub.combo && sub.combo.qtdMax !== undefined) ? sub.combo.qtdMax : 0),
                    CX: sub.CX !== undefined ? sub.CX : (sub.cx !== undefined ? sub.cx : 1),
                    QtdMinima: (matchingMinimo && matchingMinimo.QtdMinima !== undefined) ? matchingMinimo.QtdMinima : ((matchingMinimo && matchingMinimo.qtdMinima !== undefined) ? matchingMinimo.qtdMinima : 0)
                  });
                }
                usedRealApi = true;
              }
            }
          }

          // Remover duplicatas de foundItems para garantir ofertas Ãºnicas e limpas
          const uniqueFoundMap = new Map<string, any>();
          for (const item of foundItems) {
            const key = `${cleanEan(item.Ean || item.ean)}_${item.CodDist}_${item.Condicao}_${item.Prazo}`;
            if (!uniqueFoundMap.has(key)) {
              uniqueFoundMap.set(key, item);
            } else {
              // Se houver duplicatas, prefere a com menor preÃ§o lÃ­quido
              const existing = uniqueFoundMap.get(key);
              const newPrice = parseFloat(item.Pliquido || item.pliquido || 0);
              const existPrice = parseFloat(existing.Pliquido || existing.pliquido || 0);
              if (newPrice < existPrice - 0.0001) {
                uniqueFoundMap.set(key, item);
              } else if (Math.abs(newPrice - existPrice) <= 0.0001 && item.Estoque > existing.Estoque) {
                uniqueFoundMap.set(key, item);
              }
            }
          }
          foundItems = Array.from(uniqueFoundMap.values());

        } catch (e: any) {
          log(`[API CONEXÃƒO ERRO] Erro na busca paralela de EAN/Molecula: ${e.message}.`);
        }
      } else {
        // 1. Busca Cadastral: Chamar /api/Produtos/Buscar apenas para listar as opÃ§Ãµes e obter os EANs corretos
        const endpointBusca = `${baseUrl.replace(/\/$/, "")}/api/Produtos/Buscar`;
        log(`[API CONEXÃƒO] 1. Busca Cadastral em Produtos/Buscar para: "${normalizedQuery}" (original: "${searchQuery}") ${skipMolecula ? "(sem Molecula - busca exata)" : ""}`);

        // Tentar com query normalizada, depois fallback relaxed se nada encontrar
        const queriesToTry = [normalizedQuery];
        const relaxed = getRelaxedQuery(normalizedQuery);
        if (relaxed && relaxed !== normalizedQuery) {
          queriesToTry.push(relaxed);
        }

        for (const tryQuery of queriesToTry) {
          if (foundItems.length > 0) break; // ja encontrou, nao precisa tentar proxima

          try {
            const resBusca = await fetch(endpointBusca, {
              method: "POST",
              headers: {
                "Content-Type": "application/json",
                "Accept": "application/json"
              },
              body: JSON.stringify({
                Token: actualToken,
                parametros: {
                  CnpjCLi: apiCnpj,
                  Texto: tryQuery.split(/\s+/).filter(Boolean).join("%")
                }
              })
            });

            if (resBusca.ok) {
              const resData = await resBusca.json();
              log(`[DEBUG-BUSCAR] Resposta raw keys: ${Object.keys(resData).join(", ")}`);
              const produtosCadastrais = resData.Retorno || resData.retorno || [];
              if (!Array.isArray(produtosCadastrais)) {
                log(`[DEBUG-BUSCAR] Retorno NAO e array: ${typeof produtosCadastrais}. Conteudo: ${JSON.stringify(produtosCadastrais).substring(0, 200)}`);
              }
              if (Array.isArray(produtosCadastrais) && produtosCadastrais.length > 0) {
                log(`[API CONEXÃƒO SUCESSO] Busca Cadastral retornou ${produtosCadastrais.length} produtos para "${tryQuery}".`);

                // Extrair EANs Ãºnicos obtidos da busca cadastral
                const eansUnicos = Array.from(new Set(
                  produtosCadastrais.map((p: any) => cleanEan(p.Ean || p.ean || p.CodBarra || p.codBarra)).filter(Boolean)
                ));
                log(`[API CONEXÃƒO] EANs extraÃ­dos para cotaÃ§Ã£o comercial (Bypass${skipMolecula ? ", sem Molecula" : ""}): ${eansUnicos.join(", ")}`);

                if (eansUnicos.length > 0) {
                  // 2. CotaÃ§Ã£o Comercial (Bypass): Fazer chamada automÃ¡tica aos endpoints /api/Condicoes/Ean E /api/Condicoes/Molecula usando esses EANs em paralelo
                  const endpointEan = `${baseUrl.replace(/\/$/, "")}/api/Condicoes/Ean`;
                  const endpointMolecula = `${baseUrl.replace(/\/$/, "")}/api/Condicoes/Molecula`;
                  const cotacaoPromises = eansUnicos.map(async (eanTarget) => {
                    try {
                      const ckEan = cacheKey("Condicoes/Ean", eanTarget, actualToken, apiCnpj);
                      const ckMol = skipMolecula ? null : cacheKey("Condicoes/Molecula", eanTarget, actualToken, apiCnpj);

                    let eanJson = await getFromCache(ckEan);
                    let molJson = ckMol ? await getFromCache(ckMol) : null;

                    const eanFromCache = !!eanJson;
                    const molFromCache = skipMolecula ? true : !!molJson;

                    const fetchPromises: Promise<void>[] = [];
                    if (!eanJson) {
                      fetchPromises.push(
                        fetch(endpointEan, {
                          method: "POST",
                          headers: { "Content-Type": "application/json", "Accept": "application/json" },
                          body: JSON.stringify({ Token: actualToken, parametros: { CnpjCLi: apiCnpj, Ean: eanTarget, AceitaOntem: 1 } })
                        }).then(r => { log(`[API] Condicoes/Ean EAN=${eanTarget} => HTTP ${r.status}`); return r.ok ? r.json() : null; }).then(j => { eanJson = j; if (j) setInCache(ckEan, j); }).catch(() => {})
                      );
                    }
                    if (!molJson && !skipMolecula) {
                      fetchPromises.push(
                        fetch(endpointMolecula, {
                          method: "POST",
                          headers: { "Content-Type": "application/json", "Accept": "application/json" },
                          body: JSON.stringify({ Token: actualToken, parametros: { CnpjCLi: apiCnpj, Ean: eanTarget, ConsideraTipo: 1 } })
                        }).then(r => { log(`[API] Condicoes/Molecula EAN=${eanTarget} => HTTP ${r.status}`); return r.ok ? r.json() : null; }).then(j => { molJson = j; if (j && ckMol) setInCache(ckMol, j); }).catch(() => {})
                      );
                    }

                    if (fetchPromises.length > 0) {
                      log(`[API] Chamando SmartPed para EAN ${eanTarget}... (Ean=${!eanFromCache ? 'API' : 'cache'}, Mol=${skipMolecula ? 'ignorado' : !molFromCache ? 'API' : 'cache'})`);
                      await Promise.all(fetchPromises);
                    } else {
                      log(`[CACHE HIT] EAN ${eanTarget}: Ambos endpoints servidos do cache (5min TTL)`);
                    }

                    // Conta o que retornou para este EAN
                    const eanItems = eanJson?.Retorno?.itens || eanJson?.Retorno?.Itens || eanJson?.itens || eanJson?.Itens || [];
                    const molItems = molJson?.Retorno?.itens || molJson?.Retorno?.Itens || molJson?.itens || molJson?.Itens || [];
                    let qtdMinPositive = 0;
                    for (const it of eanItems) {
                      for (const c of (it.Condicoes || it.condicoes || [])) {
                        const q = c.QtdMin ?? c.qtdMin ?? 0;
                        if (q > 0) qtdMinPositive++;
                      }
                    }
                    let molSubCount = 0;
                    for (const it of molItems) {
                      const subs = it.Substitutos || it.substitutos || [];
                      for (const s of subs) {
                        const conds = s.Condicoes || s.condicoes || [];
                        if (conds.length === 0) {
                          molSubCount++;
                          const q = s.QtdMin ?? s.qtdMin ?? 0;
                          if (q > 0) qtdMinPositive++;
                        } else {
                          for (const c of conds) {
                            molSubCount++;
                            const q = c.QtdMin ?? c.qtdMin ?? 0;
                            if (q > 0) qtdMinPositive++;
                          }
                        }
                      }
                    }
                    log(`[RESUMO EAN] ${eanTarget}: Ean=${eanItems.length} itens, Molecula=${molSubCount} substitutos, QtdMin>0=${qtdMinPositive}`);

                    return { ean: eanJson, molecula: molJson };
                  } catch (err: any) {
                    console.error(`[SEARCH-PRODUCTS SILENT] Falha ao expandir EAN ${eanTarget}:`, err.message);
                    return null;
                  }
                });

                const resultadosSettled = await Promise.allSettled(cotacaoPromises);
                let distsMap: Record<number, string> = {};
                let minimosFromApi: any[] = [];

                for (const result of resultadosSettled) {
                  if (result.status !== "fulfilled" || !result.value) continue;
                  const { ean: resCotacao, molecula: resMolecula } = result.value;

                  // --- Processa retorno de Condicoes/Ean ---
                  if (resCotacao) {
                    const retorno = resCotacao.Retorno || resCotacao.retorno || resCotacao;
                    const itemsReturned = retorno?.itens || retorno?.Itens || resCotacao.itens || resCotacao.Itens || [];
                    const minimos = retorno?.minimos || retorno?.Minimos || resCotacao.minimos || resCotacao.Minimos || [];
                    const dists = retorno?.dists || retorno?.Dists || resCotacao.dists || resCotacao.Dists || [];

                    minimosFromApi.push(...minimos);
                    for (const d of dists) {
                      const cDist = d.CodDist !== undefined ? d.CodDist : d.codDist;
                      const nDist = d.NomeDist || d.nomeDist || d.Nome || d.nome;
                      if (cDist !== undefined && nDist) distsMap[cDist] = nDist;
                    }
                    
                    enrichDistribuidoresFromPayload(resCotacao);

                    for (const entry of itemsReturned) {
                      const itemPedido = entry.ItemPedido || entry.itemPedido || {};
                      const condicoes = entry.Condicoes || entry.condicoes || [];
                      const desc = itemPedido.Descricao || itemPedido.descricao || entry.Descricao || entry.descricao || "";
                      const lab = itemPedido.Laboratorio || itemPedido.laboratorio || entry.Laboratorio || entry.laboratorio || "N/A";
                      const entryEan = String(entry.Ean || entry.ean || itemPedido.Ean || itemPedido.ean || entry.CodBarra || entry.codBarra || "");

                      for (const cond of condicoes) {
                        const codDist = cond.CodDist !== undefined ? cond.CodDist : cond.codDist;
                        const condicao = cond.Condicao || cond.condicao || "FIXA";
                        const prazo = cond.Prazo !== undefined ? cond.Prazo : (cond.prazo || 5);

                        let pedidoMinimo = 0;
                        const matchingMinimo = minimos.find((m: any) => {
                          const mDist = String(m.CodDist !== undefined ? m.CodDist : (m.codDist !== undefined ? m.codDist : "")).trim();
                          const mCond = String(m.Condicao || m.condicao || "").trim().toUpperCase();
                          const mNomeCond = String(m.NomeCondicao || m.nomeCondicao || "").trim().toUpperCase();
                          const mPrazo = String(m.Prazo !== undefined ? m.Prazo : (m.prazo !== undefined ? m.prazo : "")).trim();
                          const oDist = String(codDist).trim();
                          const oCond = String(condicao).trim().toUpperCase();
                          const oPrazo = String(prazo).trim();
                          return mDist === oDist && mPrazo === oPrazo && (mCond === oCond || mNomeCond === oCond);
                        });
                        if (matchingMinimo) {
                          pedidoMinimo = matchingMinimo.VlrMinimo !== undefined ? matchingMinimo.VlrMinimo : (matchingMinimo.vlrMinimo !== undefined ? matchingMinimo.vlrMinimo : 0);
                        }

                        if (!pedidoMinimo || pedidoMinimo === 0) {
                          const nomeDistLower = String(cond.NomeDist || cond.nomeDist || cond.NomeDistribuidora || DISTRIBUIDORAS_MAP[codDist] || "").toLowerCase();
                          if (nomeDistLower.includes("panpharma") || nomeDistLower.includes("panfarma")) pedidoMinimo = 250;
                          else if (nomeDistLower.includes("profarma")) pedidoMinimo = 250;
                          else if (nomeDistLower.includes("santacruz") || nomeDistLower.includes("santa cruz")) pedidoMinimo = 300;
                          else if (nomeDistLower.includes("servimed")) pedidoMinimo = 200;
                          else if (nomeDistLower.includes("gam")) pedidoMinimo = 150;
                          else if (nomeDistLower.includes("anb")) pedidoMinimo = 250;
                          else if (nomeDistLower.trim().length > 0) pedidoMinimo = 150; 
                        }

                        const subPreco = getUnitCost(cond);
                        const apiPmc = extractPmc(cond);
                        const finalPmc = apiPmc > 0 ? apiPmc : 0;

                        foundItems.push({
                          Descricao: cond.Descricao || cond.descricao || desc,
                          Laboratorio: cond.Laboratorio || cond.laboratorio || lab,
                          NomeDist: (() => {
                            let nomeDist = cond.NomeDist || cond.nomeDist || cond.NomeDistribuidora;
                            if (!nomeDist && dists && dists.length > 0) {
                              const distInfo = dists.find((d: any) => String(d.CodDist || d.codDist) === String(codDist));
                              if (distInfo) {
                                nomeDist = distInfo.NomeDist || distInfo.nomeDist || distInfo.NomeDistribuidora || distInfo.Nome || distInfo.nome || distInfo.Fantasia || distInfo.fantasia;
                              }
                            }
                            return nomeDist || distsMap[codDist] || DISTRIBUIDORAS_MAP[codDist] || `Distribuidora ${codDist}`;
                          })(),
                          CodDist: codDist,
                          Condicao: condicao,
                          CodProdutoDist: String(cond.CodProdutoDist || cond.codProdutoDist || "0"),
                          Preco: cond.Preco !== undefined ? cond.Preco : cond.preco,
                          Pliquido: subPreco,
                          PliquidoUni: cond.PliquidoUni !== undefined ? cond.PliquidoUni : subPreco,
                          PMC: finalPmc,
                          Estoque: parseInt(String(cond.Estoque !== undefined ? cond.Estoque : 0), 10) || 0,
                          Ean: entryEan || searchQuery,
                          Prazo: prazo,
                          TipoItem: cond.TipoItem || cond.tipoItem || "O",
                          PedidoMinimo: pedidoMinimo,
                          QtdMin: cond.QtdMin !== undefined ? cond.QtdMin : (cond.qtdMin !== undefined ? cond.qtdMin : 0),
                          QtdMax: cond.QtdMax !== undefined ? cond.QtdMax : (cond.qtdMax !== undefined ? cond.qtdMax : 0),
                          CX: cond.CX !== undefined ? cond.CX : (cond.cx !== undefined ? cond.cx : 1),
                          QtdMinima: (matchingMinimo && matchingMinimo.QtdMinima !== undefined) ? matchingMinimo.QtdMinima : ((matchingMinimo && matchingMinimo.qtdMinima !== undefined) ? matchingMinimo.qtdMinima : 0)
                        });
                      }
                    }
                  }

                  // --- Processa retorno de Condicoes/Molecula (substitutos moleculares com QtdMin) ---
                  if (resMolecula) {
                    const retornoMol = resMolecula.Retorno || resMolecula.retorno || resMolecula;
                    const itensMol = retornoMol?.itens || retornoMol?.Itens || resMolecula.itens || resMolecula.Itens || [];
                    const minimosMol = retornoMol?.minimos || retornoMol?.Minimos || resMolecula.minimos || resMolecula.Minimos || [];
                    const distsMol = retornoMol?.dists || retornoMol?.Dists || resMolecula.dists || resMolecula.Dists || [];

                    minimosFromApi.push(...minimosMol);
                    for (const d of distsMol) {
                      const cDist = d.CodDist !== undefined ? d.CodDist : d.codDist;
                      const nDist = d.NomeDist || d.nomeDist || d.Nome || d.nome;
                      if (cDist !== undefined && nDist) distsMap[cDist] = nDist;
                    }
                    
                    enrichDistribuidoresFromPayload(resMolecula);

                    for (const entry of itensMol) {
                      const subsRaw = entry.Substitutos || entry.substitutos || [];
                      const substitutos: any[] = [];
                      subsRaw.forEach((sub: any) => {
                        const conds = sub.Condicoes || sub.condicoes || [];
                        if (conds.length === 0) {
                          substitutos.push(sub);
                        } else {
                          conds.forEach((cond: any) => {
                            substitutos.push({
                              ...cond,
                              Ean: sub.Ean || sub.EanProduto_Idi || cond.Ean || cond.ean,
                              Descricao: sub.Descricao || sub.DescricaoProduto_Idi || cond.Descricao || cond.descricao,
                              Laboratorio: sub.Laboratorio || sub.laboratorio || cond.Laboratorio || cond.laboratorio
                            });
                          });
                        }
                      });
                      const itemPedido = entry.ItemPedido || entry.itemPedido || {};
                      const origDesc = itemPedido.Descricao || itemPedido.descricao || "";
                      const origLab = itemPedido.Laboratorio || itemPedido.laboratorio || "";

                      for (const sub of substitutos) {
                        const codDist = sub.CodDist !== undefined ? sub.CodDist : sub.codDist;
                        const condicao = sub.Condicao || sub.condicao || "FIXA";
                        const prazo = sub.Prazo !== undefined ? sub.Prazo : (sub.prazo || 5);
                        const subEan = String(sub.Ean || sub.ean || sub.CodBarra || sub.codBarra || "");
                        const subDesc = sub.Descricao || sub.descricao || origDesc;
                        const subLab = sub.Laboratorio || sub.laboratorio || origLab || "N/A";

                        let subPreco = sub.Pliquido !== undefined ? sub.Pliquido : (sub.pliquido !== undefined ? sub.pliquido : (sub.PliquidoUni !== undefined ? sub.PliquidoUni : (sub.pliquidoUni !== undefined ? sub.pliquidoUni : (sub.Preco !== undefined ? sub.Preco : (sub.preco !== undefined ? sub.preco : 0)))));

                        let pedidoMinimo = 0;
                        const matchingMinimo = minimosFromApi.find((m: any) => {
                          const mDist = String(m.CodDist !== undefined ? m.CodDist : (m.codDist !== undefined ? m.codDist : "")).trim();
                          const mCond = String(m.Condicao || m.condicao || "").trim().toUpperCase();
                          const mNomeCond = String(m.NomeCondicao || m.nomeCondicao || "").trim().toUpperCase();
                          const mPrazo = String(m.Prazo !== undefined ? m.Prazo : (m.prazo !== undefined ? m.prazo : "")).trim();
                          const oDist = String(codDist).trim();
                          const oCond = String(condicao).trim().toUpperCase();
                          const oPrazo = String(prazo).trim();
                          return mDist === oDist && mPrazo === oPrazo && (mCond === oCond || mNomeCond === oCond);
                        });
                        if (matchingMinimo) {
                          pedidoMinimo = matchingMinimo.VlrMinimo !== undefined ? matchingMinimo.VlrMinimo : (matchingMinimo.vlrMinimo !== undefined ? matchingMinimo.vlrMinimo : 0);
                        }

                        if (!pedidoMinimo || pedidoMinimo === 0) {
                          const nomeDistLower = String(sub.NomeDist || sub.nomeDist || sub.NomeDistribuidora || distsMap[codDist] || DISTRIBUIDORAS_MAP[codDist] || "").toLowerCase();
                          if (nomeDistLower.includes("panpharma") || nomeDistLower.includes("panfarma")) pedidoMinimo = 250;
                          else if (nomeDistLower.includes("profarma")) pedidoMinimo = 250;
                          else if (nomeDistLower.includes("santacruz") || nomeDistLower.includes("santa cruz")) pedidoMinimo = 300;
                          else if (nomeDistLower.includes("servimed")) pedidoMinimo = 200;
                          else if (nomeDistLower.includes("gam")) pedidoMinimo = 150;
                          else if (nomeDistLower.includes("anb")) pedidoMinimo = 250;
                          else if (nomeDistLower.trim().length > 0) pedidoMinimo = 150;
                        }

                        const subTablePrice = extractTablePrice(sub);
                        const subBasePmc = subTablePrice > 0 ? subTablePrice : subPreco;
                        const apiPmc = extractPmc(sub);
                        const finalPmc = apiPmc > 0 ? apiPmc : 0;

                        foundItems.push({
                          Descricao: subDesc,
                          Laboratorio: subLab,
                          NomeDist: (() => {
                            let nomeDist = sub.NomeDist || sub.nomeDist || sub.NomeDistribuidora;
                            if (!nomeDist && distsMol && distsMol.length > 0) {
                              const distInfo = distsMol.find((d: any) => String(d.CodDist || d.codDist) === String(codDist));
                              if (distInfo) {
                                nomeDist = distInfo.NomeDist || distInfo.nomeDist || distInfo.NomeDistribuidora || distInfo.Nome || distInfo.nome || distInfo.Fantasia || distInfo.fantasia;
                              }
                            }
                            return nomeDist || distsMap[codDist] || DISTRIBUIDORAS_MAP[codDist] || `Distribuidora ${codDist}`;
                          })(),
                          CodDist: codDist,
                          Condicao: condicao,
                          CodProdutoDist: String(sub.CodProdutoDist || sub.codProdutoDist || "0"),
                          Preco: sub.Preco !== undefined ? sub.Preco : sub.preco,
                          Pliquido: subPreco,
                          PliquidoUni: sub.PliquidoUni !== undefined ? sub.PliquidoUni : subPreco,
                          PMC: finalPmc,
                          Estoque: parseInt(String(sub.Estoque !== undefined ? sub.Estoque : (sub.estoque !== undefined ? sub.estoque : 0)), 10) || 0,
                          Ean: subEan || searchQuery,
                          Prazo: prazo,
                          TipoItem: sub.TipoItem || sub.tipoItem || itemPedido.TipoItem || itemPedido.tipoItem || "O",
                          PedidoMinimo: pedidoMinimo,
                          QtdMin: sub.QtdMin !== undefined ? sub.QtdMin : (sub.qtdMin !== undefined ? sub.qtdMin : 0),
                          QtdMax: sub.QtdMax !== undefined ? sub.QtdMax : (sub.qtdMax !== undefined ? sub.qtdMax : 0),
                          CX: sub.CX !== undefined ? sub.CX : (sub.cx !== undefined ? sub.cx : 1),
                          QtdMinima: (matchingMinimo && matchingMinimo.QtdMinima !== undefined) ? matchingMinimo.QtdMinima : ((matchingMinimo && matchingMinimo.qtdMinima !== undefined) ? matchingMinimo.qtdMinima : 0)
                        });
                      }
                    }
                  }
                }
                usedRealApi = true;
                const totalQtdMinPositivo = foundItems.filter(i => (i.QtdMin || 0) > 0).length;
                const eansComDados = new Set(foundItems.map(i => i.Ean)).size;
                log(`[API CONEXÃƒO SUCESSO] CotaÃ§Ã£o Comercial (Bypass) retornou ${foundItems.length} ofertas de ${eansComDados} EANs.`);
                log(`[RESUMO FINAL] QtdMin>0: ${totalQtdMinPositivo} | QtdMin=0: ${foundItems.length - totalQtdMinPositivo} | Total: ${foundItems.length}`);
              }
            }
          }
        } catch (e: any) {
          log(`[API CONEXÃƒO ERRO] Erro na busca por descriÃ§Ã£o: ${e.message}.`);
        }
        } // end for (tryQuery)
      }
    }

    // FILTRO POR QUANTIDADE: se usuario buscou com quantidade (ex: "60"), filtrar so itens que tem essa qtd na descricao
    if (quantity && foundItems.length > 0) {
      const beforeQtyFilter = [...foundItems];
      foundItems = foundItems.filter(item => matchesQuantity(item.Descricao || item.descricao || item.Description || "", quantity));
      log(`[FILTRO-QTD] ${beforeQtyFilter.length} itens -> ${foundItems.length} apos filtrar por qtd=${quantity}`);
      // Se filtrou tudo, manter todos (fallback: usuario errou quantidade mas quer ver os produtos)
      if (foundItems.length === 0) {
        log(`[FILTRO-QTD] Fallback: mantendo todos ${beforeQtyFilter.length} itens (nenhum tinha qtd=${quantity} na descricao)`);
        foundItems = beforeQtyFilter;
      }
    }

    // DEDUPLICAÃ‡ÃƒO FINAL (ambos os caminhos: EAN e texto)
    if (foundItems.length > 0) {
      const uniqueMap = new Map<string, any>();
      for (const item of foundItems) {
        const key = `${cleanEan(item.Ean || item.ean)}_${item.CodDist}_${item.Condicao}_${item.Prazo}`;
        if (!uniqueMap.has(key)) {
          uniqueMap.set(key, item);
        } else {
          const existing = uniqueMap.get(key);
          const newPrice = Number(item.Pliquido || item.PliquidoUni || item.pliquido || item.Preco || 9999);
          const existPrice = Number(existing.Pliquido || existing.PliquidoUni || existing.pliquido || existing.Preco || 9999);
          if (newPrice < existPrice - 0.0001) {
            uniqueMap.set(key, item);
          } else if (Math.abs(newPrice - existPrice) <= 0.0001 && Number(item.Estoque || 0) > Number(existing.Estoque || 0)) {
            uniqueMap.set(key, item);
          }
        }
      }
      const before = foundItems.length;
      foundItems = Array.from(uniqueMap.values());
      if (before !== foundItems.length) {
        log(`[DEDUPLICAÃ‡ÃƒO] ${before} -> ${foundItems.length} ofertas (removidas ${before - foundItems.length} duplicatas).`);
      }
    }

    // REMOVED FAKE DATA FALLBACK
    if (foundItems.length === 0) {
      log("[BUSCA INFO] Nenhum dado retornado pela API real.");
    }

    // Se onlyExactEan for true e for busca numÃ©rica, garantimos que apenas itens com o mesmo EAN sejam exibidos
    if (onlyExactEan && isPureNumeric) {
      const cleanSearchQuery = cleanEan(searchQuery);
      foundItems = foundItems.filter(item => cleanEan(item.Ean || item.ean) === cleanSearchQuery);
      log(`[FILTRO EAN EXATO] Filtrado rigidamente para manter apenas ofertas com EAN correspondente a "${cleanSearchQuery}". Restaram ${foundItems.length} ofertas.`);
    }

    // PROCESSAMENTO E REGRAS SOLICITADAS:
    // 1. Filtrar de acordo com o parÃ¢metro de estoque (permitirSemEstoque) e cortes recentes
    const filteredStockItems = foundItems.filter((it: any) => {
      const distName = (resolveDistName(it)).toUpperCase().trim();
      const distNameClean = normalizeDistName(distName);
      const eanStr = cleanEan(it.Ean || it.ean || "");

      const blockedDistsForEan = cortesRecentes[eanStr] || [];
      if (blockedDistsForEan.includes(distNameClean)) {
        return false; // Bloqueado por corte recente
      }

      const rawEstoque = it.Estoque !== undefined ? it.Estoque : (it.estoque !== undefined ? it.estoque : undefined);
      const stock = parseSmartPedEstoque(rawEstoque, getUnitCost(it) > 0);
      it.Estoque = stock;
      it.estoque = stock;

      if (permitirSemEstoque) {
        return true;
      }
      return stock > 0;
    });

    log(`[FILTRO ESTOQUE] Total de ofertas encontradas: ${foundItems.length} | Passaram pelo filtro de estoque: ${filteredStockItems.length} (Permitir sem estoque: ${permitirSemEstoque ? 'Sim' : 'NÃ£o'})`);

    // Mapear campos de forma resiliente e tratar tipo string/number para EAN e PreÃ§o
    const mappedItems = filteredStockItems.map((it: any) => {
      const eanStr = String(it.Ean || it.ean || "");
      const precoUnit = getUnitCost(it);
      const desc = it.Descricao || it.descricao || "";
      const lab = it.Laboratorio || it.laboratorio || "LaboratÃ³rio";
      const tipo = it.TipoItem || it.tipoItem || "";

      // Verificar se Ã© GenÃ©rico
      const descLower = desc.toLowerCase();
      const labLower = lab.toLowerCase();
      let isGeneric = false;
      if (tipo) {
        isGeneric = tipo.toUpperCase() === "G";
      } else {
        isGeneric = descLower.includes(" gn ") || descLower.includes("generico") || descLower.includes("genÃ©rico") ||
                    labLower.includes("generico") || labLower.includes("genÃ©rico");
        if (isGeneric && descLower.includes(" - ")) {
          isGeneric = false;
        }
      }

      const tablePrice = extractTablePrice(it);
      const baseForPmc = tablePrice > 0 ? tablePrice : precoUnit;
      const apiPmc = extractPmc(it);
      const pmcVal = apiPmc > 0 ? apiPmc : 0;
      log(`[PMC MAP DEBUG] EAN=${eanStr} apiPmc=${apiPmc} pmcVal=${pmcVal} fieldPMC=${it.PMC} fieldpmc=${it.pmc} fieldPmc=${it.Pmc}`);
      const precoOriginalVal = tablePrice > 0 ? tablePrice : precoUnit;

      const itemCodDist = it.CodDist !== undefined ? it.CodDist : (it.codDist !== undefined ? it.codDist : 2);
      const itemCondicao = it.Condicao || it.condicao || "FIXA";
      const itemPrazo = it.Prazo !== undefined ? it.Prazo : (it.prazo || 7);
      const cachedMinimo = getMinimoFromCache(itemCodDist, itemCondicao, itemPrazo);

      const rawPedMin = it.PedidoMinimo !== undefined ? it.PedidoMinimo : (it.pedidoMinimo !== undefined ? it.pedidoMinimo : (it.VlrMinimo !== undefined ? it.VlrMinimo : it.vlrMinimo));
      const finalPedMin = Number(rawPedMin) > 0 ? Number(rawPedMin) : cachedMinimo;

      return {
        ean: eanStr,
        descricao: desc,
        laboratorio: lab,
        distribuidora: it.NomeDist || it.nomeDist || "Distribuidora",
        codDist: itemCodDist,
        condicao: itemCondicao,
        codProdutoDist: String(it.CodProdutoDist || it.codProdutoDist || "0"),
        codProduto: String(it.CodProduto || it.codProduto || "0"),
        precoOriginal: precoOriginalVal,
        precoLiquido: precoUnit,
        pmc: pmcVal,
        estoque: parseInt(String(it.Estoque !== undefined ? it.Estoque : 0), 10) || 0,
        prazo: itemPrazo,
        isGeneric,
        pedidoMinimo: finalPedMin,
        VlrMinimo: finalPedMin,
        vlrMinimo: finalPedMin,
        qtdMin: it.QtdMin !== undefined ? it.QtdMin : (it.qtdMin !== undefined ? it.qtdMin : 0),
        qtdMax: it.QtdMax !== undefined ? it.QtdMax : (it.qtdMax !== undefined ? it.qtdMax : 0),
        cx: it.CX !== undefined ? it.CX : (it.cx !== undefined ? it.cx : 1),
        qtdMinima: it.QtdMinima !== undefined ? it.QtdMinima : (it.qtdMinima !== undefined ? it.qtdMinima : 0)
      };
    });

    // 2. Filtrar por tipos de substituiÃ§Ã£o aceitos (G ou O)
    const normalizedTipos = (tipos || ["G", "O"]).map((t: string) => t.trim().toUpperCase());
    const processedItems = mappedItems.filter((it: any) => {
      const isSearchQueryEan = isPureNumeric && cleanEan(it.ean) === cleanEan(searchQuery);
      if (isSearchQueryEan) {
        // O EAN buscado originalmente Ã© soberano e imune ao filtro de tipos
        return true;
      }
      const itemTipo = it.isGeneric ? "G" : "O";
      return normalizedTipos.includes(itemTipo);
    });

    log(`[FILTRO TIPOS] Filtro de tipos aceitos: [${normalizedTipos.join(", ")}] | Itens correspondentes: ${processedItems.length}`);

    // 3. Ordenar por preÃ§o lÃ­quido ascendente
    processedItems.sort((a, b) => a.precoLiquido - b.precoLiquido);

    // 4. Indicar qual Ã© o genÃ©rico mais barato
    const genericItems = processedItems.filter(it => it.isGeneric);
    let cheapestGenericEan = "";
    if (genericItems.length > 0) {
      cheapestGenericEan = genericItems[0].ean;
      log(`[DICA INTELIGENTE] O GenÃ©rico com estoque mais barato Ã©: "${genericItems[0].descricao}" da distribuidora ${genericItems[0].distribuidora} custando R$ ${genericItems[0].precoLiquido.toFixed(2)}`);
    }

    // Adicionar as flags isCheapest e isCheapestGeneric
    const finalItems = processedItems.map((it, idx) => ({
      ...it,
      isCheapest: idx === 0,
      isCheapestGeneric: it.ean === cheapestGenericEan
    }));

    log(`[PMC FINAL DEBUG] Final items with PMC: ${finalItems.filter(i => i.pmc > 0).length}/${finalItems.length} | Sample: ${finalItems.slice(0,3).map(i => `${i.ean}:pmc=${i.pmc}`).join(', ')}`);

    res.json({
      sucesso: true,
      items: finalItems,
      logs
    });
  } catch (err: any) {
    console.error("Erro na busca de produtos:", err);
    res.status(500).json({ error: "Erro interno ao buscar produtos: " + err.message });
  }
});
// Endpoint para buscar alternativas de verdade na SmartPed em tempo real para itens "Sem Estoque" ou "NÃ£o Encontrados"
app.post("/api/smartped-find-substitutes", async (req, res) => {
  const { ean, descricao, token, cnpj, useTestUrl = true, cortesRecentes = {} } = req.body;
  const logs: string[] = [];
  const ts = () => new Date().toLocaleString('pt-BR', { timeZone: 'America/Sao_Paulo', hour: '2-digit', minute: '2-digit', second: '2-digit' });
  const log = (msg: string) => { const m = `[${ts()}] ${msg}`; logs.push(m); console.log(`[SUBSTITUTES] ${m}`); };
  
  try {
    const actualToken = (token || CONFIG.SMARTPED_SANDBOX_TOKEN).trim();
    const isSandboxToken = actualToken === CONFIG.SMARTPED_SANDBOX_TOKEN;
    const apiCnpj = isSandboxToken ? "11111111111111" : (cnpj || CONFIG.SMARTPED_DEFAULT_CNPJ).trim().replace(/\D/g, "");
    let baseUrl = useTestUrl ? CONFIG.SMARTPED_SANDBOX_URL : CONFIG.SMARTPED_PRODUCTION_URL;
    
    let dcbDescoberto = "";
    
    // Passo A: Descobrir o DCB se temos o EAN
    if (ean && String(ean).trim().length > 0) {
      log(`[DESCOBERTA DCB] Buscando informaÃ§Ãµes de DCB/composiÃ§Ã£o para o EAN ${ean}...`);
      try {
        const dcbRes = await fetch(`${CONFIG.FERRAMENTINHAS_API_URL}/api/produtos/similares/${ean}`);
        if (dcbRes.ok) {
          const dcbData = await dcbRes.json();
          const pList = dcbData.produtos || dcbData.items || [];
          if (pList.length > 0) {
            // Pegar o primeiro produto que tenha um cod_dcb ou princÃ­pio ativo
            const pWithDcb = pList.find((p: any) => p.cod_dcb && String(p.cod_dcb).trim().length > 0);
            if (pWithDcb) {
              dcbDescoberto = String(pWithDcb.cod_dcb).trim();
              log(`[DESCOBERTA DCB] DCB encontrado na API: "${dcbDescoberto}"`);
            } else {
              const firstP = pList[0];
              if (firstP.nom_produto) {
                log(`[DESCOBERTA DCB] Nenhum cÃ³digo DCB explÃ­cito. Usando nome do produto como referÃªncia: "${firstP.nom_produto}"`);
              }
            }
          }
        }
      } catch (err: any) {
        log(`[DESCOBERTA DCB AVISO] Falha ao consultar API de DCB: ${err.message}`);
      }
    }

    // HeurÃ­stica robusta de limpeza de descriÃ§Ã£o usando Regex
    const descricaoLimpa = cleanDescription(descricao);
    const baseMolecula = getMoleculeBase(descricao);
    log(`[DESCOBERTA DESCRIÃ‡ÃƒO] DescriÃ§Ã£o original: "${descricao}" -> Limpa por Regex: "${descricaoLimpa}"`);
    log(`[DESCOBERTA DESCRIÃ‡ÃƒO] Base molÃ©cula extraÃ­da: "${baseMolecula}"`);

    // Se nÃ£o achou por EAN, usar a molÃ©cula base como referÃªncia principal
    if (!dcbDescoberto && baseMolecula) {
      dcbDescoberto = baseMolecula;
      log(`[DESCOBERTA DCB] Usando base de molÃ©cula limpa como molÃ©cula/DCB primÃ¡rio: "${dcbDescoberto}"`);
    } else if (!dcbDescoberto && descricaoLimpa) {
      dcbDescoberto = descricaoLimpa;
      log(`[DESCOBERTA DCB] Usando descriÃ§Ã£o limpa como molÃ©cula/DCB primÃ¡rio: "${dcbDescoberto}"`);
    }

    // Passo B: Fazer chamadas em paralelo para a SmartPed
    const apiPromises: Promise<any>[] = [];
    const responseHeaders = {
      "Content-Type": "application/json",
      "Accept": "application/json"
    };

    // 1. Busca por Condicoes/Ean
    if (ean) {
      log(`[SMARTPED CONSULTA] Agendando busca por EAN em Condicoes/Ean...`);
      apiPromises.push(
        fetch(`${baseUrl}/api/Condicoes/Ean`, {
          method: "POST",
          headers: responseHeaders,
          body: JSON.stringify({
            Token: actualToken,
            parametros: { CnpjCLi: apiCnpj, Ean: ean, AceitaOntem: 1 }
          })
        }).then(r => r.ok ? r.json() : null).catch(() => null)
      );
    } else {
      apiPromises.push(Promise.resolve(null));
    }

    // 2. Busca por Condicoes/Molecula por EAN
    if (ean) {
      log(`[SMARTPED CONSULTA] Agendando busca por MolÃ©cula do EAN em Condicoes/Molecula...`);
      apiPromises.push(
        fetch(`${baseUrl}/api/Condicoes/Molecula`, {
          method: "POST",
          headers: responseHeaders,
          body: JSON.stringify({
            Token: actualToken,
            parametros: { CnpjCLi: apiCnpj, Ean: ean, ConsideraTipo: 1 }
          })
        }).then(r => r.ok ? r.json() : null).catch(() => null)
      );
    } else {
      apiPromises.push(Promise.resolve(null));
    }

    const PALAVRAS_GENERICAS_BLOQUEIO = new Set([
      "KIT", "SAB", "SABONETE", "BOLA", "BALA", "BRINQUEDO", "DIVERSOS", "POTE", "PÃ‡S", "PCS", "PEÃ‡AS",
      "PECAS", "MINI", "GRANDE", "PEQUENO", "ESTOJO", "PORTA", "SUPORTE", "CABO", "FITA", "COLA", "BASE",
      "MASCARA", "MÃSCARA", "SOMBRA", "PIRANHA", "CREME", "LOÃ‡ÃƒO", "LOCAO", "SHAMPOO", "CONDICIONADOR",
      "AEROSOL", "SPRAY", "DESODORANTE", "DESOD", "PERFUME", "COLONIA", "COLÃ”NIA", "BODY", "SPLASH",
      "POMADA", "TALCO", "ALGODAO", "ALGODÃƒO", "CURATIVO", "BANDAGEM", "ESCOVA", "PENTE", "LIXA",
      "PINCA", "PINÃ‡A", "TESOURA", "CURVADOR", "CARRINHO", "CARRO", "ANIMAIS", "BONECA", "CHUPETA",
      "MAMADEIRA", "DOSADOR", "PRENDEDOR", "ELASTICO", "ELÃSTICO", "PRESILHA", "GRAMPO", "INF", "INFANTIL",
      "GK1356", "GK1592", "REF", "COD"
    ]);

    const ehGenericoCompleto = dcbDescoberto && dcbDescoberto.split(/\s+/).every(w => PALAVRAS_GENERICAS_BLOQUEIO.has(w));

    // 3. Busca por Condicoes/Molecula por texto do DCB Descoberto
    if (dcbDescoberto && dcbDescoberto.trim().length > 2 && !ehGenericoCompleto) {
      log(`[SMARTPED CONSULTA] Agendando busca por Texto de MolÃ©cula ("${dcbDescoberto}") em Condicoes/Molecula...`);
      apiPromises.push(
        fetch(`${baseUrl}/api/Condicoes/Molecula`, {
          method: "POST",
          headers: responseHeaders,
          body: JSON.stringify({
            Token: actualToken,
            parametros: { CnpjCLi: apiCnpj, Molecula: dcbDescoberto, ConsideraTipo: 1 }
          })
        }).then(r => r.ok ? r.json() : null).catch(() => null)
      );
    } else {
      if (ehGenericoCompleto) {
        log(`[SMARTPED CONSULTA] Ignorando busca por molÃ©cula textual ampla para "${dcbDescoberto}" por conter apenas palavras-chave genÃ©ricas.`);
      }
      apiPromises.push(Promise.resolve(null));
    }

    // 3.1. Busca por Condicoes/Molecula pela DescriÃ§Ã£o Limpa ou MolÃ©cula Base
    const moleculaExtraQuery = baseMolecula && baseMolecula !== dcbDescoberto ? baseMolecula : (descricaoLimpa && descricaoLimpa !== dcbDescoberto ? descricaoLimpa : "");
    const extraEhGenerico = moleculaExtraQuery && moleculaExtraQuery.split(/\s+/).every(w => PALAVRAS_GENERICAS_BLOQUEIO.has(w));

    if (moleculaExtraQuery && moleculaExtraQuery.trim().length > 2 && !extraEhGenerico) {
      log(`[SMARTPED CONSULTA] Agendando busca adicional por "${moleculaExtraQuery}" em Condicoes/Molecula...`);
      apiPromises.push(
        fetch(`${baseUrl}/api/Condicoes/Molecula`, {
          method: "POST",
          headers: responseHeaders,
          body: JSON.stringify({
            Token: actualToken,
            parametros: { CnpjCLi: apiCnpj, Molecula: moleculaExtraQuery, ConsideraTipo: 1 }
          })
        }).then(r => r.ok ? r.json() : null).catch(() => null)
      );
    } else {
      if (extraEhGenerico) {
        log(`[SMARTPED CONSULTA] Ignorando busca adicional por molÃ©cula para "${moleculaExtraQuery}" por conter apenas palavras-chave genÃ©ricas.`);
      }
      apiPromises.push(Promise.resolve(null));
    }

    // 3.2. Busca por Produtos/Buscar pela DescriÃ§Ã£o Preservando a Dosagem (ex: "PARACETAMOL 750MG")
    const descricaoComDosagem = cleanDescriptionKeepDosage(descricao);
    const hasComDosagemQuery = descricaoComDosagem && 
                               descricaoComDosagem !== moleculaExtraQuery && 
                               descricaoComDosagem !== dcbDescoberto && 
                               descricaoComDosagem.trim().length > 2;
    if (hasComDosagemQuery) {
      log(`[SMARTPED CONSULTA] Agendando busca adicional por "${descricaoComDosagem}" (DescriÃ§Ã£o com Dosagem) em Produtos/Buscar...`);
      apiPromises.push(
        fetch(`${baseUrl}/api/Produtos/Buscar`, {
          method: "POST",
          headers: responseHeaders,
          body: JSON.stringify({
            Token: actualToken,
            parametros: { CnpjCLi: apiCnpj, Texto: descricaoComDosagem }
          })
        }).then(r => r.ok ? r.json() : null).catch(() => null)
      );
    } else {
      apiPromises.push(Promise.resolve(null));
    }

    // 4. Busca por Condicoes/Similares
    if (ean) {
      log(`[SMARTPED CONSULTA] Agendando busca por Similares em Condicoes/Similares...`);
      apiPromises.push(
        fetch(`${baseUrl}/api/Condicoes/Similares`, {
          method: "POST",
          headers: responseHeaders,
          body: JSON.stringify({
            Token: actualToken,
            parametros: { CnpjCLi: apiCnpj, Ean: ean }
          })
        }).then(r => r.ok ? r.json() : null).catch(() => null)
      );
    } else {
      apiPromises.push(Promise.resolve(null));
    }

    // 5. Busca por Condicoes/Substitutos
    if (ean) {
      log(`[SMARTPED CONSULTA] Agendando busca por Substitutos em Condicoes/Substitutos...`);
      apiPromises.push(
        fetch(`${baseUrl}/api/Condicoes/Substitutos`, {
          method: "POST",
          headers: responseHeaders,
          body: JSON.stringify({
            Token: actualToken,
            parametros: { CnpjCLi: apiCnpj, Ean: ean }
          })
        }).then(r => r.ok ? r.json() : null).catch(() => null)
      );
    } else {
      apiPromises.push(Promise.resolve(null));
    }

    // 6. Buscas curingas (%) dinÃ¢micas adicionais com base na descriÃ§Ã£o para maximizar o faturamento (utilizando Produtos/Buscar para faturamento certeiro)
    const wildcardQueries = getWildcardQueries(descricao);
    const wildcardStartIndex = apiPromises.length; // Ã­ndice 7
    for (const q of wildcardQueries) {
      log(`[SMARTPED CONSULTA] Agendando busca adicional curinga por "${q}" em Produtos/Buscar...`);
      apiPromises.push(
        fetch(`${baseUrl}/api/Produtos/Buscar`, {
          method: "POST",
          headers: responseHeaders,
          body: JSON.stringify({
            Token: actualToken,
            parametros: { CnpjCLi: apiCnpj, Texto: q }
          })
        }).then(r => r.ok ? r.json() : null).catch(() => null)
      );
    }

    const allResults = await Promise.all(apiPromises);
    const resEan = allResults[0];
    const resMoleculaEan = allResults[1];
    const resMoleculaText = allResults[2];
    const resDescricaoLimpa = allResults[3];
    const resDescricaoComDosagem = allResults[4];
    const resSimilares = allResults[5];
    const resSubstitutos = allResults[6];

    const wildcardResults = allResults.slice(wildcardStartIndex);
    
    log(`[SMARTPED CONSULTA] Respostas recebidas concorrentemente! Iniciando consolidaÃ§Ã£o de ofertas.`);

    const foundAlternatives: any[] = [];
    const distsMap: Record<number, string> = {};
    const minimosList: any[] = [];

    const extractMetadata = (data: any) => {
      if (!data) return;
      const ret = data.Retorno || data.retorno || data;
      
      const dists = ret.dists || ret.Dists || [];
      for (const d of dists) {
        const cDist = d.CodDist !== undefined ? d.CodDist : d.codDist;
        const nDist = d.NomeDist || d.nomeDist || d.Nome || d.nome;
        if (cDist !== undefined && nDist) distsMap[cDist] = nDist;
      }

      const minimos = ret.minimos || ret.Minimos || [];
      if (Array.isArray(minimos) && minimos.length > 0) {
        minimosList.push(...minimos);
        updateMinimosCache(minimos);
      }
    };

    extractMetadata(resEan);
    extractMetadata(resMoleculaEan);
    extractMetadata(resMoleculaText);
    extractMetadata(resDescricaoLimpa);
    extractMetadata(resDescricaoComDosagem);
    extractMetadata(resSimilares);
    extractMetadata(resSubstitutos);

    enrichDistribuidoresFromPayload(resEan);
    enrichDistribuidoresFromPayload(resMoleculaEan);
    enrichDistribuidoresFromPayload(resMoleculaText);
    enrichDistribuidoresFromPayload(resDescricaoLimpa);
    enrichDistribuidoresFromPayload(resDescricaoComDosagem);
    enrichDistribuidoresFromPayload(resSimilares);
    enrichDistribuidoresFromPayload(resSubstitutos);

    // Extrair metadados das respostas curingas
    wildcardResults.forEach(resData => {
      if (resData) {
        extractMetadata(resData);
        enrichDistribuidoresFromPayload(resData);
      }
    });

    // Mapa de CatÃ¡logo Cadastral por EAN para preservar nomes comerciais ricos e laboratÃ³rios originais
    const eanCatalogMap = new Map<string, { descricao: string; laboratorio: string }>();

    const recordCatalogInfo = (eanCode: string, desc?: string, lab?: string) => {
      const cEan = cleanEan(eanCode);
      if (!cEan) return;
      const d = String(desc || "").trim();
      const l = String(lab || "").trim();
      if (!eanCatalogMap.has(cEan)) {
        eanCatalogMap.set(cEan, { descricao: d, laboratorio: l });
      } else {
        const existing = eanCatalogMap.get(cEan)!;
        const newD = d.length > existing.descricao.length ? d : existing.descricao;
        const newL = (l && l.toUpperCase() !== "GENÃ‰RICO") ? l : existing.laboratorio;
        eanCatalogMap.set(cEan, { descricao: newD, laboratorio: newL });
      }
    };

    const resolveBestDescription = (eanCode: string, ...candidates: (string | undefined)[]) => {
      const userSearchQuery = (descricao || "").trim().toLowerCase();
      // 1. Procurar no array de candidatos por algo que seja nÃ£o-vazio e diferente da query simples em minÃºsculo
      for (const cand of candidates) {
        if (!cand) continue;
        const trimmed = String(cand).trim();
        if (trimmed.length > 0 && trimmed.toLowerCase() !== userSearchQuery) {
          return trimmed;
        }
      }
      // 2. Procurar no catÃ¡logo de EANs descobertos durante as chamadas da SmartPed
      if (eanCode && eanCatalogMap.has(eanCode)) {
        const catalogItem = eanCatalogMap.get(eanCode)!;
        if (catalogItem.descricao && catalogItem.descricao.toLowerCase() !== userSearchQuery) {
          return catalogItem.descricao;
        }
      }
      // 3. Procurar no banco de dados interno de EANs (getEanDatabaseRecord)
      if (eanCode) {
        const dbRec = getEanDatabaseRecord(eanCode);
        if (dbRec && dbRec.descricao) {
          return dbRec.descricao;
        }
      }
      // 4. Se tiver algum candidato nÃ£o-vazio, retornar
      for (const cand of candidates) {
        if (cand && String(cand).trim().length > 0) return String(cand).trim();
      }
      return descricao ? descricao.toUpperCase() : "PRODUTO FARMACÃŠUTICO";
    };

    const resolveBestLaboratorio = (eanCode: string, ...candidates: (string | undefined)[]) => {
      for (const cand of candidates) {
        if (!cand) continue;
        const trimmed = String(cand).trim();
        if (trimmed.length > 0 && trimmed.toUpperCase() !== "GENÃ‰RICO" && trimmed.toUpperCase() !== "N/A") {
          return trimmed;
        }
      }
      if (eanCode && eanCatalogMap.has(eanCode)) {
        const catalogItem = eanCatalogMap.get(eanCode)!;
        if (catalogItem.laboratorio && catalogItem.laboratorio.toUpperCase() !== "GENÃ‰RICO" && catalogItem.laboratorio.toUpperCase() !== "N/A") {
          return catalogItem.laboratorio;
        }
      }
      if (eanCode) {
        const dbRec = getEanDatabaseRecord(eanCode);
        if (dbRec && dbRec.laboratorio) {
          return dbRec.laboratorio;
        }
      }
      for (const cand of candidates) {
        if (cand && String(cand).trim().length > 0) return String(cand).trim();
      }
      return "GENÃ‰RICO";
    };

    const processReturnItens = (data: any, sourceTag: string, fallbackEan?: string) => {
      if (!data) return;
      const ret = data.Retorno || data.retorno || data;
      const rawItens = ret.itens !== undefined ? ret.itens : (ret.Itens !== undefined ? ret.Itens : (Array.isArray(ret) ? ret : []));
      const itens = Array.isArray(rawItens) ? rawItens : [rawItens];
      
      for (const entry of itens) {
        if (!entry) continue;
        const itemPedido = entry.ItemPedido || entry.itemPedido || (entry.Ean || entry.ean ? entry : {});
        const origDesc = itemPedido.Descricao || itemPedido.descricao || entry.Descricao || entry.descricao || "";
        const origLab = itemPedido.Laboratorio || itemPedido.laboratorio || entry.Laboratorio || entry.laboratorio || "";
        const entryEanDirect = cleanEan(itemPedido.Ean || itemPedido.ean || entry.Ean || entry.ean || fallbackEan || "");
        if (entryEanDirect && origDesc) {
          recordCatalogInfo(entryEanDirect, origDesc, origLab);
        }
        
        const condicoes = entry.Condicoes || entry.condicoes || (entry.CodDist !== undefined || entry.codDist !== undefined ? [entry] : []);
        for (const cond of condicoes) {
          const codDist = cond.CodDist !== undefined ? cond.CodDist : cond.codDist;
          const distName = resolveDistName(cond, codDist);
          const subPreco = getUnitCost(cond);
          const subEstoque = parseSmartPedEstoque(cond.Estoque !== undefined ? cond.Estoque : cond.estoque, subPreco > 0);
          const condTablePrice = extractTablePrice(cond);
          const condBasePmc = condTablePrice > 0 ? condTablePrice : subPreco;
          const apiPmc = extractPmc(cond);
          const unitPmc = apiPmc > 0 ? apiPmc : 0;
          
          const rawPreco = cond.Preco !== undefined ? cond.Preco : (cond.preco !== undefined ? cond.preco : (cond.Preco_idi !== undefined ? cond.Preco_idi : subPreco));
          const rawDesconto = cond.Desconto !== undefined ? cond.Desconto : (cond.desconto !== undefined ? cond.desconto : 0);
          const rawDescExtra = cond.DescExtra !== undefined ? cond.DescExtra : (cond.descExtra !== undefined ? cond.descExtra : 0);
          const rawValorST = cond.ValorST !== undefined ? cond.ValorST : (cond.ValorSt !== undefined ? cond.ValorSt : (cond.valorST !== undefined ? cond.valorST : (cond.valorSt !== undefined ? cond.valorSt : 0)));
          const rawPliquido = cond.Pliquido !== undefined ? cond.Pliquido : (cond.pliquido !== undefined ? cond.pliquido : subPreco);
          const rawPliquidoUni = cond.PliquidoUni !== undefined ? cond.PliquidoUni : (cond.pliquidoUni !== undefined ? cond.pliquidoUni : rawPliquido);

          const resolvedEan = cleanEan(cond.Ean || cond.ean || itemPedido.Ean || itemPedido.ean || entry.Ean || entry.ean || fallbackEan || ean || "");
          const finalDesc = resolveBestDescription(resolvedEan, cond.Descricao, cond.descricao, itemPedido.Descricao, itemPedido.descricao, entry.Descricao, entry.descricao, origDesc);
          const finalLab = resolveBestLaboratorio(resolvedEan, cond.Laboratorio, cond.laboratorio, itemPedido.Laboratorio, itemPedido.laboratorio, entry.Laboratorio, entry.laboratorio, origLab);

          if (resolvedEan && finalDesc) {
            recordCatalogInfo(resolvedEan, finalDesc, finalLab);
          }

          foundAlternatives.push({
            ean: resolvedEan,
            descricao: finalDesc,
            laboratorio: finalLab,
            preco: rawPreco,
            precoBruto: rawPreco,
            desconto: Number(rawDesconto) || 0,
            descExtra: Number(rawDescExtra) || 0,
            valorST: Number(rawValorST) || 0,
            pliquido: rawPliquido,
            pliquidoUni: rawPliquidoUni,
            pmc: unitPmc,
            condicao: cond.Condicao || cond.condicao || "FIXA",
            distribuidora: distName,
            codDist: codDist,
            prazo: cond.Prazo !== undefined ? cond.Prazo : (cond.prazo || 5),
            qtdMin: extractSmartPedQtdMin(cond),
            qtdMax: (cond.Combo && cond.Combo.QtdMax !== undefined) ? cond.Combo.QtdMax : ((cond.combo && cond.combo.qtdMax !== undefined) ? cond.combo.qtdMax : 0),
            cx: cond.CX !== undefined ? cond.CX : (cond.cx !== undefined ? cond.cx : 1),
            estoque: subEstoque,
            codProdutoDist: cond.CodProdutoDist || cond.codProdutoDist || "",
            codProduto: cond.CodProduto || cond.codProduto || cond.CodProdutoDist || cond.codProdutoDist || ""
          });
        }

        const substitutos = entry.Substitutos || entry.substitutos || [];
        const flatSubstitutos: any[] = [];
        substitutos.forEach((sub: any) => {
          const conds = sub.Condicoes || sub.condicoes || [];
          if (conds.length === 0) {
            flatSubstitutos.push({
              ...sub,
              Ean: sub.Ean || sub.ean || sub.EanProduto_Idi || sub.eanProduto_Idi || "",
              Descricao: sub.Descricao || sub.descricao || sub.DescricaoProduto_Idi || sub.descricaoProduto_Idi || "",
              Laboratorio: sub.Laboratorio || sub.laboratorio || ""
            });
          } else {
            conds.forEach((cond: any) => {
              flatSubstitutos.push({
                ...cond,
                Ean: sub.Ean || sub.ean || sub.EanProduto_Idi || sub.eanProduto_Idi || cond.Ean || cond.ean || "",
                Descricao: sub.Descricao || sub.descricao || sub.DescricaoProduto_Idi || sub.descricaoProduto_Idi || cond.Descricao || cond.descricao || "",
                Laboratorio: sub.Laboratorio || sub.laboratorio || cond.Laboratorio || cond.laboratorio || ""
              });
            });
          }
        });

        for (const sub of flatSubstitutos) {
          const codDist = sub.CodDist !== undefined ? sub.CodDist : sub.codDist;
          const distName = resolveDistName(sub, codDist);
          const subPreco = getUnitCost(sub);
          const subEstoque = parseSmartPedEstoque(sub.Estoque !== undefined ? sub.Estoque : sub.estoque, subPreco > 0);
          const apiPmc = extractPmc(sub);
          const unitPmc = apiPmc > 0 ? apiPmc : 0;

          const rawPreco = sub.Preco !== undefined ? sub.Preco : (sub.preco !== undefined ? sub.preco : (sub.Preco_idi !== undefined ? sub.Preco_idi : subPreco));
          const rawDesconto = sub.Desconto !== undefined ? sub.Desconto : (sub.desconto !== undefined ? sub.desconto : 0);
          const rawDescExtra = sub.DescExtra !== undefined ? sub.DescExtra : (sub.descExtra !== undefined ? sub.descExtra : 0);
          const rawValorST = sub.ValorST !== undefined ? sub.ValorST : (sub.ValorSt !== undefined ? sub.ValorSt : (sub.valorST !== undefined ? sub.valorST : (sub.valorSt !== undefined ? sub.valorSt : 0)));
          const rawPliquido = sub.Pliquido !== undefined ? sub.Pliquido : (sub.pliquido !== undefined ? sub.pliquido : subPreco);
          const rawPliquidoUni = sub.PliquidoUni !== undefined ? sub.PliquidoUni : (sub.pliquidoUni !== undefined ? sub.pliquidoUni : rawPliquido);

          const resolvedSubEan = cleanEan(sub.Ean || sub.ean || itemPedido.Ean || itemPedido.ean || entry.Ean || entry.ean || fallbackEan || ean || "");
          const finalSubDesc = resolveBestDescription(resolvedSubEan, sub.Descricao, sub.descricao, itemPedido.Descricao, itemPedido.descricao, entry.Descricao, entry.descricao, origDesc);
          const finalSubLab = resolveBestLaboratorio(resolvedSubEan, sub.Laboratorio, sub.laboratorio, itemPedido.Laboratorio, itemPedido.laboratorio, entry.Laboratorio, entry.laboratorio, origLab);

          if (resolvedSubEan && finalSubDesc) {
            recordCatalogInfo(resolvedSubEan, finalSubDesc, finalSubLab);
          }

          foundAlternatives.push({
            ean: resolvedSubEan,
            descricao: finalSubDesc,
            laboratorio: finalSubLab,
            preco: rawPreco,
            precoBruto: rawPreco,
            desconto: Number(rawDesconto) || 0,
            descExtra: Number(rawDescExtra) || 0,
            valorST: Number(rawValorST) || 0,
            pliquido: rawPliquido,
            pliquidoUni: rawPliquidoUni,
            pmc: unitPmc,
            condicao: sub.Condicao || sub.condicao || "FIXA",
            distribuidora: distName,
            codDist: codDist,
            prazo: sub.Prazo !== undefined ? sub.Prazo : (sub.prazo || 5),
            qtdMin: extractSmartPedQtdMin(sub),
            qtdMax: (sub.Combo && sub.Combo.QtdMax !== undefined) ? sub.Combo.QtdMax : ((sub.combo && sub.combo.qtdMax !== undefined) ? sub.combo.qtdMax : 0),
            cx: sub.CX !== undefined ? sub.CX : (sub.cx !== undefined ? sub.cx : 1),
            estoque: subEstoque,
            codProdutoDist: sub.CodProdutoDist || sub.codProdutoDist || "",
            codProduto: sub.CodProduto || sub.codProduto || sub.CodProdutoDist || sub.codProdutoDist || ""
          });
        }
      }
    };

    // FunÃ§Ã£o para processar retornos no formato de Produtos/Buscar
    const processProdutosBuscar = (data: any, sourceTag: string) => {
      if (!data) return;
      const itens = data.Retorno || data.retorno || [];
      if (!Array.isArray(itens)) return;

      for (const sub of itens) {
        const codDist = sub.CodDist !== undefined ? sub.CodDist : sub.codDist;
        const distName = resolveDistName(sub, codDist);
        const subPreco = getUnitCost(sub);
        const subEstoque = parseSmartPedEstoque(sub.Estoque !== undefined ? sub.Estoque : sub.estoque, subPreco > 0);
        const subTablePrice = extractTablePrice(sub);
        const subBasePmc = subTablePrice > 0 ? subTablePrice : subPreco;
        const apiPmc = extractPmc(sub);
        const unitPmc = apiPmc > 0 ? apiPmc : 0;

        const rawPreco = sub.Preco !== undefined ? sub.Preco : (sub.preco !== undefined ? sub.preco : (sub.Preco_idi !== undefined ? sub.Preco_idi : subPreco));
        const rawDesconto = sub.Desconto !== undefined ? sub.Desconto : (sub.desconto !== undefined ? sub.desconto : 0);
        const rawDescExtra = sub.DescExtra !== undefined ? sub.DescExtra : (sub.descExtra !== undefined ? sub.descExtra : 0);
        const rawValorST = sub.ValorST !== undefined ? sub.ValorST : (sub.ValorSt !== undefined ? sub.ValorSt : (sub.valorST !== undefined ? sub.valorST : (sub.valorSt !== undefined ? sub.valorSt : 0)));
        const rawPliquido = sub.Pliquido !== undefined ? sub.Pliquido : (sub.pliquido !== undefined ? sub.pliquido : subPreco);
        const rawPliquidoUni = sub.PliquidoUni !== undefined ? sub.PliquidoUni : (sub.pliquidoUni !== undefined ? sub.pliquidoUni : rawPliquido);

        const subEan = cleanEan(sub.Ean || sub.ean || sub.CodBarra || sub.codBarra || "");
        const finalDesc = resolveBestDescription(subEan, sub.Descricao, sub.descricao, sub.DescricaoProduto_Idi, sub.descricaoProduto_Idi);
        const finalLab = resolveBestLaboratorio(subEan, sub.Laboratorio, sub.laboratorio);

        if (subEan && finalDesc) {
          recordCatalogInfo(subEan, finalDesc, finalLab);
        }

        foundAlternatives.push({
          ean: subEan,
          descricao: finalDesc,
          laboratorio: finalLab,
          preco: rawPreco,
          precoBruto: rawPreco,
          desconto: Number(rawDesconto) || 0,
          descExtra: Number(rawDescExtra) || 0,
          valorST: Number(rawValorST) || 0,
          pliquido: rawPliquido,
          pliquidoUni: rawPliquidoUni,
          pmc: unitPmc,
          condicao: sub.Condicao || sub.condicao || "FIXA",
          distribuidora: distName,
          codDist: codDist,
          prazo: sub.Prazo !== undefined ? sub.Prazo : (sub.prazo || 5),
          qtdMin: extractSmartPedQtdMin(sub),
          qtdMax: (sub.Combo && sub.Combo.QtdMax !== undefined) ? sub.Combo.QtdMax : ((sub.combo && sub.combo.qtdMax !== undefined) ? sub.combo.qtdMax : 0),
          cx: sub.CX !== undefined ? sub.CX : (sub.cx !== undefined ? sub.cx : 1),
          estoque: subEstoque,
          codProdutoDist: sub.CodProdutoDist || sub.codProdutoDist || "",
          codProduto: sub.CodProduto || sub.codProduto || sub.CodProdutoDist || sub.codProdutoDist || ""
        });
      }
    };

    processReturnItens(resEan, "Condicoes/Ean");
    processReturnItens(resMoleculaEan, "Condicoes/Molecula (EAN)");
    processReturnItens(resMoleculaText, "Condicoes/Molecula (Texto/DCB)");
    processReturnItens(resDescricaoLimpa, "Condicoes/Molecula (Descricao Limpa Regex)");
    
    // Processa como Produtos/Buscar para obter ofertas de dosagem exata com descriÃ§Ã£o comercial
    processProdutosBuscar(resDescricaoComDosagem, "Produtos/Buscar (Descricao com Dosagem)");
    
    processReturnItens(resSimilares, "Condicoes/Similares");
    processReturnItens(resSubstitutos, "Condicoes/Substitutos");

    // Processar itens das respostas curingas como Produtos/Buscar
    wildcardResults.forEach((resData, idx) => {
      const qTerm = wildcardQueries[idx];
      if (resData) {
        processProdutosBuscar(resData, `Produtos/Buscar (Curinga: "${qTerm}")`);
      }
    });

    // =========================================================================
    // FASE DE EXPANSÃƒO HÃBRIDA POR EANS:
    // Se a busca foi realizada por texto/descriÃ§Ã£o (sem EAN direto ou para enriquecer EANs cadastrais descobertos),
    // consultamos em lote com Promise.allSettled o endpoint /api/Condicoes/Ean para os EANs encontrados.
    // Isso garante que todas as regras ricas de promoÃ§Ãµes (QtdMin, descontos por escala e condiÃ§Ãµes especiais)
    // sejam carregadas mesmo quando o usuÃ¡rio pesquisou por texto, sem que a falha de 1 EAN quebre os demais!
    // =========================================================================
    const discoveredEans = Array.from(new Set(
      foundAlternatives
        .map(a => cleanEan(a.ean))
        .filter(e => e && e.length >= 7)
    )).slice(0, 15); // Top 15 EANs mais relevantes descobertos

    if (discoveredEans.length > 0) {
      log(`[EXPANSÃƒO HÃBRIDA] Agendando cotaÃ§Ãµes comerciais ricas via Condicoes/Ean para ${discoveredEans.length} EANs descobertos...`);
      
      const expansionPromises = discoveredEans.map(async (e) => {
        try {
          const ckEan = cacheKey("Condicoes/Ean", e, actualToken, apiCnpj);
          const ckMol = cacheKey("Condicoes/Molecula", e, actualToken, apiCnpj);

          let eanData = await getFromCache(ckEan);
          let molData = await getFromCache(ckMol);

          const fetchPromises: Promise<void>[] = [];

          if (!eanData) {
            fetchPromises.push(
              fetch(`${baseUrl}/api/Condicoes/Ean`, {
                method: "POST",
                headers: responseHeaders,
                body: JSON.stringify({ Token: actualToken, parametros: { CnpjCLi: apiCnpj, Ean: e, AceitaOntem: 1 } })
              }).then(r => { log(`[API] Condicoes/Ean EAN=${e} => HTTP ${r.status}`); return r.ok ? r.json() : null; }).then(j => { eanData = j; if (j) setInCache(ckEan, j); }).catch(() => {})
            );
          }

          if (!molData) {
            fetchPromises.push(
              fetch(`${baseUrl}/api/Condicoes/Molecula`, {
                method: "POST",
                headers: responseHeaders,
                body: JSON.stringify({ Token: actualToken, parametros: { CnpjCLi: apiCnpj, Ean: e, ConsideraTipo: 1 } })
              }).then(r => { log(`[API] Condicoes/Molecula EAN=${e} => HTTP ${r.status}`); return r.ok ? r.json() : null; }).then(j => { molData = j; if (j) setInCache(ckMol, j); }).catch(() => {})
            );
          }

          if (fetchPromises.length > 0) {
            await Promise.all(fetchPromises);
          } else {
            log(`[CACHE HIT] EAN ${e}: Ambos endpoints servidos do cache`);
          }

          return { ean: e, eanData, molData };
        } catch (err: any) {
          console.error(`[EXPANSÃƒO HÃBRIDA SILENT] Falha ao expandir EAN ${e}:`, err.message);
          return { ean: e, eanData: null, molData: null };
        }
      });

      const expansionSettled = await Promise.allSettled(expansionPromises);
      let expandedOffersCount = 0;

      for (const result of expansionSettled) {
        if (result.status === "fulfilled" && result.value) {
          const { ean: targetEan, eanData, molData } = result.value;
          if (eanData) {
            extractMetadata(eanData);
            enrichDistribuidoresFromPayload(eanData);
            processReturnItens(eanData, "ExpansÃ£o HÃ­brida (Condicoes/Ean)", targetEan);
            expandedOffersCount++;
          }
          if (molData) {
            extractMetadata(molData);
            enrichDistribuidoresFromPayload(molData);
            processReturnItens(molData, "ExpansÃ£o HÃ­brida (Condicoes/Molecula)", targetEan);
          }
        }
      }
      log(`[EXPANSÃƒO HÃBRIDA SUCESSO] ${expandedOffersCount}/${discoveredEans.length} consultas ricas de EAN integradas (Ean + Molecula).`);
    }

    // =========================================================================
    // DEDUPLICAÃ‡ÃƒO FINAL POR CHAVE COMERCIAL COMBINADA (Ean + CodDist + Condicao + Prazo)
    // Limpa duplicidades brutas geradas pelas mÃºltiplas chamadas Ã  SmartPed
    // mantendo a oferta de menor preÃ§o lÃ­quido se houver choque
    // =========================================================================
    const uniqueOffersMap = new Map<string, any>();

    foundAlternatives.forEach((offer: any) => {
      const offerEan = cleanEan(offer.Ean || offer.ean || "");
      if (!offerEan || offer.preco <= 0) return;

      const codDist = offer.CodDist !== undefined ? offer.CodDist : (offer.codDist !== undefined ? offer.codDist : 0);
      const condicao = String(offer.Condicao || offer.condicao || "FIXA").trim().toUpperCase();
      const prazo = offer.Prazo !== undefined ? offer.Prazo : (offer.prazo !== undefined ? offer.prazo : 0);
      
      const uniqueKey = `${offerEan}_${codDist}_${condicao}_${prazo}`;
      const currentPrice = Number(offer.Pliquido || offer.PliquidoUni || offer.pliquidoUni || offer.pliquido || offer.preco || 9999);

      if (!uniqueOffersMap.has(uniqueKey)) {
        uniqueOffersMap.set(uniqueKey, offer);
      } else {
        const existing = uniqueOffersMap.get(uniqueKey);
        const existingPrice = Number(existing.Pliquido || existing.PliquidoUni || existing.pliquidoUni || existing.pliquido || existing.preco || 9999);
        if (currentPrice < existingPrice) {
          uniqueOffersMap.set(uniqueKey, offer);
        } else if (Math.abs(currentPrice - existingPrice) <= 0.0001 && Number(offer.estoque || 0) > Number(existing.estoque || 0)) {
          uniqueOffersMap.set(uniqueKey, offer);
        }
      }
    });

    const finalDeduplicatedAlternatives = Array.from(uniqueOffersMap.values());

    // DeduplicaÃ§Ã£o Inteligente: EAN + CodDist
    // CritÃ©rio 1: Menor PreÃ§o LÃ­quido (pliquido / pliquidoUni)
    // CritÃ©rio 2: Empate no preÃ§o -> Maior Prazo
    const uniqueAltsMap = new Map<string, any>();
    finalDeduplicatedAlternatives.forEach(alt => {
      if (!alt.ean || alt.preco <= 0) return;

      const altEanStr = cleanEan(alt.ean);
      const distNameClean = normalizeDistName(alt.distribuidora || "");
      const blockedDistsForEan = cortesRecentes[altEanStr] || [];
      if (blockedDistsForEan.includes(distNameClean)) {
        return; // Ignorar oferta se estiver cortada recentemente nesta distribuidora
      }

      const distIdentifier = alt.codDist !== undefined ? String(alt.codDist) : distNameClean;
      const key = `${altEanStr}___${distIdentifier}`;

      const currentPLiquido = getUnitCost(alt);
      const currentPrazo = Number(alt.prazo) || 0;

      if (!uniqueAltsMap.has(key)) {
        uniqueAltsMap.set(key, alt);
      } else {
        const existing = uniqueAltsMap.get(key);
        const existingPLiquido = getUnitCost(existing);
        const existingPrazo = Number(existing.prazo) || 0;

        // Se a nova oferta tiver preÃ§o lÃ­quido menor, substitui
        if (currentPLiquido < existingPLiquido - 0.0001) {
          uniqueAltsMap.set(key, alt);
        } else if (Math.abs(currentPLiquido - existingPLiquido) <= 0.0001) {
          // Se houver empate no preÃ§o lÃ­quido, escolhe o com MAIOR PRAZO (melhor condiÃ§Ã£o de pagamento)
          if (currentPrazo > existingPrazo) {
            uniqueAltsMap.set(key, alt);
          } else if (currentPrazo === existingPrazo && (alt.estoque || 0) > (existing.estoque || 0)) {
            uniqueAltsMap.set(key, alt);
          }
        }
      }
    });

    const finalAlts = Array.from(uniqueAltsMap.values()).sort((a, b) => {
      const pA = getUnitCost(a);
      const pB = getUnitCost(b);
      return pA - pB;
    });

    // Enriquecer todas as alternativas encontradas com o valor de pedido mÃ­nimo a partir do MINIMOS_GLOBAL_CACHE
    const enrichAltWithMinimos = (item: any) => {
      const minVal = getMinimoFromCache(item.codDist, item.condicao, item.prazo);
      if (minVal && minVal.VlrMinimo > 0) {
        if (!item.VlrMinimo || Number(item.VlrMinimo) <= 0) item.VlrMinimo = minVal.VlrMinimo;
        if (!item.vlrMinimo || Number(item.vlrMinimo) <= 0) item.vlrMinimo = minVal.VlrMinimo;
        if (!item.pedidoMinimo || Number(item.pedidoMinimo) <= 0) item.pedidoMinimo = minVal.VlrMinimo;
        if (!item.PedidoMinimo || Number(item.PedidoMinimo) <= 0) item.PedidoMinimo = minVal.VlrMinimo;
      }
    };

    finalDeduplicatedAlternatives.forEach(enrichAltWithMinimos);
    finalAlts.forEach(enrichAltWithMinimos);

    // Se minimosList estiver vazio ou incompleto, complementar com entradas do cache para as distribuidoras encontradas
    const distIdsFound = new Set<number>(finalDeduplicatedAlternatives.map(a => Number(a.codDist)).filter(Boolean));
    const cachedMinimosForDists = MINIMOS_GLOBAL_CACHE.filter(m => distIdsFound.has(m.CodDist));
    cachedMinimosForDists.forEach(cm => {
      const exists = minimosList.some(m => {
        const mCod = Number(m.CodDist !== undefined ? m.CodDist : m.codDist);
        const mCond = String(m.Condicao || m.condicao || "").trim().toUpperCase();
        const mPrazo = Number(m.Prazo !== undefined ? m.Prazo : (m.prazo !== undefined ? m.prazo : 0));
        return mCod === cm.CodDist && mCond === cm.Condicao && mPrazo === cm.Prazo;
      });
      if (!exists) {
        minimosList.push({
          CodDist: cm.CodDist,
          Condicao: cm.Condicao,
          Prazo: cm.Prazo,
          VlrMinimo: cm.VlrMinimo,
          QtdMinima: cm.QtdMinima,
          NomeDist: distsMap[cm.CodDist] || ""
        });
      }
    });

    const qtdMinPositivo = finalAlts.filter(a => (a.QtdMin || a.qtdMin || 0) > 0).length;
    const qtdMinZero = finalAlts.length - qtdMinPositivo;
    log(`[SUCESSO] Total de ${finalAlts.length} ofertas deduplicadas (melhor prazo/preÃ§o por distribuidora) e ${finalDeduplicatedAlternatives.length} ofertas brutas Ãºnicas na SmartPed.`);
    log(`[RESUMO QTDMIN] QtdMin>0: ${qtdMinPositivo} | QtdMin=0: ${qtdMinZero} | Total: ${finalAlts.length}`);

    res.json({
      success: true,
      dcbDescoberto,
      descricaoLimpa,
      alternatives: finalAlts,
      allAlternatives: finalDeduplicatedAlternatives,
      minimos: minimosList,
      logs
    });
  } catch (error: any) {
    console.error("Erro no endpoint smartped-find-substitutes:", error);
    res.status(500).json({
      success: false,
      error: "Erro ao buscar substitutos na SmartPed: " + error.message,
      logs
    });
  }
});
// Endpoint para buscar produtos similares (mesmo DCB + ConcentraÃ§Ã£o) com fallback inteligente por similaridade de descriÃ§Ã£o
app.get("/api/similares/:ean", async (req, res) => {
  const { ean: rawEan } = req.params;
  const ean = cleanEan(rawEan);
  let descricao = req.query.descricao as string;
  const forceDesc = req.query.forceDesc === "true";
  try {
    const dbRecord = getEanDatabaseRecord(ean);
    if ((!descricao || descricao.trim().length === 0 || descricao === "undefined" || descricao === "null") && dbRecord?.descricao) {
      descricao = dbRecord.descricao;
      console.log(`[SIMILARES] DescriÃ§Ã£o ausente na query. Recuperada automaticamente do EAN_DATABASE para ${ean}: "${descricao}"`);
    }

    console.log(`[SIMILARES] Buscando similares locais na Trier para EAN ${ean} (original: ${rawEan}), DescriÃ§Ã£o: "${descricao || "nÃ£o informada"}", forceDesc: ${forceDesc}`);
    
    let trierEncontrou = false;
    let trierData: any = null;

    // Sempre consultamos a Trier por EAN para coletar os similares vinculados oficialmente no ERP e alimentar a base local dinamicamente
    try {
      const response = await fetch(`${CONFIG.FERRAMENTINHAS_API_URL}/api/produtos/similares/${ean}`);
      if (response.ok) {
        const data = await response.json();
        if (data && data.encontrou && Array.isArray(data.produtos) && data.produtos.length > 0) {
          console.log(`[SIMILARES REGISTRO] Carregados ${data.produtos.length} produtos oficiais da Trier para o EAN ${ean}. Populando base em memÃ³ria.`);
          for (const prod of data.produtos) {
            const pEan = cleanEan(prod.ean || prod.cod_barra || prod.cod_barras || "");
            const pDesc = prod.nom_produto || prod.descricao;
            if (pEan && pDesc) {
              EAN_DATABASE[pEan] = {
                descricao: pDesc,
                laboratorio: prod.nom_laborat || prod.laboratorio || "Geral",
                precoOriginal: parseFloat(prod.vlr_venda_final || prod.vlr_venda_tabela || prod.vlr_custopersonalizado || "10.0") || 10.0,
                qtd_estoque: prod.qtd_estoque !== undefined ? parseFloat(prod.qtd_estoque) : undefined,
                                 est_minimo: prod.est_minimo !== undefined ? parseFloat(prod.est_minimo) : undefined,
                 est_maximo: prod.est_maximo !== undefined ? parseFloat(prod.est_maximo) : (prod.estoque_maximo !== undefined ? parseFloat(prod.estoque_maximo) : (prod.maximo !== undefined ? parseFloat(prod.maximo) : undefined)),
                cod_reduzido: prod.cod_reduzido,
                vlr_custopersonalizado: prod.vlr_custopersonalizado !== undefined ? parseFloat(prod.vlr_custopersonalizado) : undefined,
                vlr_venda_tabela: prod.vlr_venda_tabela !== undefined ? parseFloat(prod.vlr_venda_tabela) : undefined,
                vlr_venda_final: prod.vlr_venda_final !== undefined ? parseFloat(prod.vlr_venda_final) : undefined,
                dat_ultent: prod.dat_ultent,
                cod_dcb: prod.cod_dcb,
                cod_concentracao: prod.cod_concentracao
              };
            }
          }
          if (!forceDesc) {
            trierEncontrou = true;
            trierData = data;
          }
        }
      }
    } catch (errDirect) {
      console.warn(`[SIMILARES] Falha ou erro na consulta direta ao ERP para EAN ${ean}:`, errDirect);
    }

    if (trierEncontrou && trierData && !forceDesc) {
      return res.json({
        ...trierData,
        success: true
      });
    }

    // 2. Se a busca direta falhou, retornou vazia ou forceDesc = true, aciona a busca inteligente por similaridade de descriÃ§Ã£o usando o regex/getMoleculeBase
    if (descricao && descricao.trim().length > 0) {
      const baseMolecula = getMoleculeBase(descricao).toUpperCase();
      console.log(`[SIMILARES DESCRIÃ‡ÃƒO] EAN ${ean}. MolÃ©cula base extraÃ­da: "${baseMolecula}"`);
      
      const searchWords = baseMolecula.split(/\s+/).filter(w => w.length > 0);
      console.log(`[SIMILARES DESCRIÃ‡ÃƒO] Palavras-chave extraÃ­das da molÃ©cula:`, searchWords);

      if (searchWords.length > 0 || baseMolecula.length > 0) {
        // Palavras genÃ©ricas ou muito comuns que sozinhas nÃ£o devem gerar correspondÃªncia
        const PALAVRAS_GENERICAS = new Set([
          "KIT", "INF", "INFANTIL", "C/", "S/", "COM", "SEM", "COD", "REF", "UN", "PCT", "CX", "MED", "PROD",
          "GENERICO", "GEN", "SAB", "CROM", "BOLA", "BRINQUEDO", "DIVERSOS", "POTE", "PÃ‡S", "PCS", "PEÃ‡AS",
          "PECAS", "DE", "PARA", "EM", "DO", "DA", "CRIANCA", "CRIANÃ‡AS", "CRIANCAS", "MINI", "GRANDE", "PEQUENO",
          "MEDICAMENTO", "REMEDIO", "APOIO", "SUPORTE", "TIPO", "DIVERSAS", "REFGK", "CHA", "CHÃ", "OLEO", "Ã“LEO",
          "SABONETE", "GEL", "CREME", "LOÃ‡ÃƒO", "LOCAO"
        ]);

        const especificas = searchWords.filter(w => !PALAVRAS_GENERICAS.has(w));
        const temEspecificas = especificas.length > 0;

        // Encontrar EANs candidatos no cadastro local (EAN_DATABASE carregado do S.I.C.F.)
        const candidates: any[] = [];
        
        for (const [dbEan, item] of Object.entries(EAN_DATABASE)) {
          if (!item.descricao || dbEan === ean) continue;
          const itemDesc = item.descricao.toUpperCase();
          const itemMolecula = getMoleculeBase(item.descricao).toUpperCase();

          let score = 0;
          let especificasMatches = 0;
          let genericasMatches = 0;

          // Se a molÃ©cula base extraÃ­da de ambos for idÃªntica, pontuaÃ§Ã£o mÃ¡xima!
          if (baseMolecula && itemMolecula && baseMolecula === itemMolecula) {
            score += 100;
            especificasMatches += 2;
          } else {
            const itemWords = itemDesc.split(/[\s,.\-\/+()]+/gi).map(w => w.trim()).filter(w => w.length > 0);

            for (const word of searchWords) {
              const isGenerica = PALAVRAS_GENERICAS.has(word);
              
              // Match exato de palavra inteira (token)
              if (itemWords.includes(word)) {
                if (isGenerica) {
                  score += 1;
                  genericasMatches++;
                } else {
                  score += 10;
                  especificasMatches++;
                }
              } else {
                // Match parcial (prefixo ou substring parcial relevante, comprimento >= 4)
                let partialMatch = false;
                for (const itemWord of itemWords) {
                  if (itemWord.length >= 4 && word.length >= 4) {
                    if (itemWord.startsWith(word) || word.startsWith(itemWord)) {
                      partialMatch = true;
                      break;
                    }
                  }
                }
                
                if (partialMatch) {
                  if (isGenerica) {
                    score += 0.5;
                    genericasMatches++;
                  } else {
                    score += 5;
                    especificasMatches++;
                  }
                }
              }
            }
          }

          // BÃ´nus se a descriÃ§Ã£o do item contiver a descriÃ§Ã£o de busca completa
          if (itemDesc.includes(descricao.toUpperCase())) {
            score += 25;
          } else if (temEspecificas && itemDesc.includes(especificas.join(" "))) {
            score += 15;
          }

          // CondiÃ§Ã£o de aceitaÃ§Ã£o estrita: 
          // Se houver palavras especÃ­ficas na busca, EXIGE pelo menos um match de palavra especÃ­fica.
          // Se sÃ³ houver palavras genÃ©ricas, exige pelo menos um match genÃ©rico.
          const passaFiltro = temEspecificas ? (especificasMatches >= 1) : (genericasMatches >= 1);

          // Exige tambÃ©m uma pontuaÃ§Ã£o mÃ­nima de relevÃ¢ncia
          const scoreMinimo = temEspecificas ? 5 : 1;

          if (passaFiltro && score >= scoreMinimo) {
            candidates.push({
              ean: dbEan,
              descricao: item.descricao,
              laboratorio: item.laboratorio,
              precoOriginal: item.precoOriginal,
              qtd_estoque: item.qtd_estoque,
              est_minimo: item.est_minimo,
              est_maximo: item.est_maximo,
              cod_reduzido: item.cod_reduzido,
              vlr_custopersonalizado: item.vlr_custopersonalizado,
              vlr_venda_tabela: item.vlr_venda_tabela,
              vlr_venda_final: item.vlr_venda_final,
              dat_ultent: item.dat_ultent,
              cod_dcb: item.cod_dcb,
              cod_concentracao: item.cod_concentracao,
              score
            });
          }
        }

        // Ordena por maior pontuaÃ§Ã£o de relevÃ¢ncia (score)
        candidates.sort((a, b) => b.score - a.score);

        console.log(`[SIMILARES DESCRIÃ‡ÃƒO] Encontrados ${candidates.length} candidatos vÃ¡lidos com score mÃ­nimo.`);

        if (candidates.length > 0) {
          const resultProdutos = candidates.slice(0, 50).map(c => ({
            cod_barra: c.ean,
            ean: c.ean,
            nom_produto: c.descricao,
            nom_laborat: c.laboratorio,
            cod_reduzido: c.cod_reduzido || "Cadastro",
            qtd_estoque: c.qtd_estoque !== undefined ? c.qtd_estoque : 0,
            vlr_custopersonalizado: c.vlr_custopersonalizado || c.precoOriginal,
            vlr_venda_tabela: c.vlr_venda_tabela || (c.precoOriginal ? Number((c.precoOriginal * 1.4).toFixed(2)) : 10.0),
            vlr_venda_final: c.vlr_venda_final || c.vlr_venda_tabela || (c.precoOriginal ? Number((c.precoOriginal * 1.35).toFixed(2)) : 10.0),
            est_minimo: c.est_minimo !== undefined ? c.est_minimo : 0,
            est_maximo: c.est_maximo !== undefined ? c.est_maximo : 0,
            dat_ultent: c.dat_ultent || "-",
            cod_dcb: c.cod_dcb || "Cadastro Local",
            cod_concentracao: c.cod_concentracao || "Similaridade"
          }));

          return res.json({
            success: true,
            encontrou: true,
            produtos: resultProdutos,
            regexUsed: true,
            moleculaBuscada: baseMolecula,
            eanReferencia: ean
          });
        }
      }
    }

    return res.json({
      success: true,
      encontrou: false,
      produtos: [],
      error: "Nenhum produto similar correspondente encontrado no cadastro local."
    });
  } catch (error: any) {
    console.error("Erro ao buscar similares:", error);
    res.status(500).json({ success: false, error: error.message });
  }
});

// Endpoint para buscar histÃ³rico de vendas detalhadas
app.get("/api/vendas-detalhadas/:ean", async (req, res) => {
  const { ean } = req.params;
  try {
    const response = await fetch(`${CONFIG.FERRAMENTINHAS_API_URL}/api/chatbot/produto/vendas-detalhadas/${ean}`);
    if (!response.ok) {
      throw new Error(`API Error: ${response.status}`);
    }
    const data = await response.json();
    return res.json(data);
  } catch (error: any) {
    console.error("Erro ao buscar vendas detalhadas:", error);
    res.status(500).json({ status: "error", message: error.message });
  }
});

// Endpoint para buscar histÃ³rico de vendas semanais
app.get("/api/vendas-semanais/:ean", async (req, res) => {
  const { ean } = req.params;
  try {
    const response = await fetch(`${CONFIG.FERRAMENTINHAS_API_URL}/api/chatbot/produto/vendas-semanais/${ean}`);
    if (!response.ok) {
      throw new Error(`API Error: ${response.status}`);
    }
    const data = await response.json();
    return res.json(data);
  } catch (error: any) {
    console.error("Erro ao buscar vendas semanais:", error);
    res.status(500).json({ status: "error", message: error.message });
  }
});

// Proxy para compras-historico (usado na verificação de entrada Profarma 48h)
app.get("/api/produtos/compras-historico/:ean", async (req, res) => {
  const { ean } = req.params;
  const meses = (req.query.meses as string) || "1";
  try {
    const response = await fetch(`${CONFIG.FERRAMENTINHAS_API_URL}/api/produtos/compras-historico/${ean}?meses=${meses}`);
    if (!response.ok) {
      throw new Error(`API Error: ${response.status}`);
    }
    const data = await response.json();
    return res.json(data);
  } catch (error: any) {
    console.error("Erro ao buscar compras-historico:", error);
    res.status(500).json({ status: "error", message: error.message });
  }
});

// Endpoint de diagnÃ³stico para consultar os retornos reais brutos da API SmartPed para um determinado EAN
app.post("/api/diagnostico-ean", async (req, res) => {
  const { ean, token, cnpj, useTestUrl } = req.body;
  if (!ean) {
    return res.status(400).json({ success: false, error: "EAN Ã© obrigatÃ³rio." });
  }

  const actualToken = (token || CONFIG.SMARTPED_PRODUCTION_TOKEN).trim();
  const isSandboxToken = actualToken === CONFIG.SMARTPED_SANDBOX_TOKEN;
  const apiCnpj = isSandboxToken ? "11111111111111" : (cnpj || CONFIG.SMARTPED_DEFAULT_CNPJ).trim().replace(/\D/g, "");

  const baseUrl = useTestUrl ? CONFIG.SMARTPED_SANDBOX_URL : CONFIG.SMARTPED_PRODUCTION_URL;
  const cleanEanValue = cleanEan(ean);

  const logs: string[] = [];
  logs.push(`[DIAGNÃ“STICO] Iniciando busca para EAN ${cleanEanValue}`);
  logs.push(`[DIAGNÃ“STICO] URL Base: ${baseUrl}`);
  logs.push(`[DIAGNÃ“STICO] CNPJ: ${apiCnpj}`);

  try {
    const pMolecula = fetch(`${baseUrl}/api/Condicoes/Molecula`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        Token: actualToken,
        parametros: { CnpjCLi: apiCnpj, Ean: cleanEanValue, ConsideraTipo: 1 }
      })
    });

    const pEan = fetch(`${baseUrl}/api/Condicoes/Ean`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        Token: actualToken,
        parametros: { CnpjCLi: apiCnpj, Ean: cleanEanValue, AceitaOntem: 1 }
      })
    });

    const [responseMolecula, responseEan] = await Promise.all([pMolecula, pEan]);
    logs.push(`[DIAGNÃ“STICO] Status Molecula: ${responseMolecula.status}, Status Ean: ${responseEan.status}`);

    const resDataMolecula = responseMolecula.ok ? await responseMolecula.json().catch(() => ({})) : {};
    const resDataEan = responseEan.ok ? await responseEan.json().catch(() => ({})) : {};

    return res.json({
      success: true,
      logs,
      molecula: resDataMolecula,
      ean: resDataEan,
      info: {
        cleanEanValue,
        tokenUsed: `${actualToken.substring(0, 6)}...`,
        cnpjUsed: apiCnpj,
        baseUrlUsed: baseUrl
      }
    });
  } catch (error: any) {
    console.error("Erro no diagnÃ³stico de EAN:", error);
    return res.status(500).json({
      success: false,
      error: error.message,
      logs: [...logs, `[ERRO CRÃTICO] ${error.message}`]
    });
  }
});

// Debug endpoint: grava seleções de ConditionSelector em arquivo para diagnóstico
app.post("/api/debug-selection", (req, res) => {
  try {
    const { codInterno, ean, dist, codDist, codProdutoDist, codProduto, preco, timestamp } = req.body || {};
    const logLine = `[${new Date().toISOString()}] codInterno=${codInterno} | EAN=${ean} | dist=${dist} | codDist=${codDist} | codProdutoDist="${codProdutoDist}" | codProduto="${codProduto}" | preco=${preco}\n`;
    const fs = require("fs");
    const logDir = path.join(process.cwd(), "debug-logs");
    if (!fs.existsSync(logDir)) fs.mkdirSync(logDir, { recursive: true });
    fs.appendFileSync(path.join(logDir, "selection.log"), logLine);
    res.json({ ok: true });
  } catch (err) {
    res.json({ ok: false });
  }
});

if (process.env.SKIP_SERVER_LISTEN !== "true") {
  if (process.env.NODE_ENV !== "production") {
    createViteServer({
      server: { middlewareMode: true },
      appType: "spa"
    }).then(async vite => {
      app.use(vite.middlewares);
      await loadDistribuidoresFromAPI();
      app.listen(PORT, "0.0.0.0", () => {
        console.log(`Server running on http://localhost:${PORT}`);
      });
    });
  } else {
    const distPath = path.join(process.cwd(), "dist");
    app.use(express.static(distPath));
    app.get("*", (req, res) => {
      res.sendFile(path.join(distPath, "index.html"));
    });
    (async () => {
      await loadDistribuidoresFromAPI();
      app.listen(PORT, "0.0.0.0", () => {
        console.log(`Server running on http://localhost:${PORT}`);
      });
    })();
  }
}
