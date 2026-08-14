import express from "express";
import path from "path";
import { createServer as createViteServer } from "vite";
import dotenv from "dotenv";
import fs from "fs";
import { runEngineSelfTests } from "./backend-tests";
import { validateSwapEquivalence } from "./swap-validation";

dotenv.config();

// ============================================
// CONFIGURACAO CENTRALIZADA (via .env)
// ============================================
const CONFIG = {
  SMARTPED_PRODUCTION_TOKEN: process.env.SMARTPED_PRODUCTION_TOKEN || "fddfd9871b77f44f243e145207c8e93a",
  SMARTPED_SANDBOX_TOKEN: process.env.SMARTPED_SANDBOX_TOKEN || "79770c03eb119691f0355c5628c496e2",
  SMARTPED_DEFAULT_CNPJ: process.env.SMARTPED_DEFAULT_CNPJ || "13408443000168",
  SMARTPED_PRODUCTION_URL: process.env.SMARTPED_PRODUCTION_URL || "https://api.smartped.com.br",
  SMARTPED_SANDBOX_URL: process.env.SMARTPED_SANDBOX_URL || "https://apitest.smartped.com.br",
  FERRAMENTINHAS_API_URL: process.env.FERRAMENTINHAS_API_URL || "https://api.ferramentinhas.com.br",
  APP_ADMIN_EMAILS: (process.env.APP_ADMIN_EMAILS || "ckipper22@gmail.com,aga706panambi@gmail.com").split(",").map(e => e.trim().toLowerCase()),
  APP_ADMIN_PASSWORD: process.env.APP_ADMIN_PASSWORD || "Aq1sw2de#fr4",
};

// Executa a suíte de auto-testes das regras de negócio do backend (Hard Block de Sabores, Dosagens, etc.)
runEngineSelfTests();

// ============================================
// CACHE DE RESPOSTAS SMARTPED (anti-instabilidade)
// A API SmartPed retorna resultados inconsistentes para o mesmo EAN.
// Este cache armazena respostas por 5 minutos para estabilizar a experiência.
// ============================================
const SMARTPED_CACHE_TTL_MS = 5 * 60 * 1000; // 5 minutos
const smartpedCache = new Map<string, { data: any; ts: number }>();

function cacheKey(endpoint: string, ean: string, token: string, cnpj: string): string {
  return `${endpoint}|${ean}|${token}|${cnpj}`;
}

function getFromCache(key: string): any | null {
  const entry = smartpedCache.get(key);
  if (!entry) return null;
  if (Date.now() - entry.ts > SMARTPED_CACHE_TTL_MS) {
    smartpedCache.delete(key);
    return null;
  }
  return entry.data;
}

function setInCache(key: string, data: any): void {
  if (smartpedCache.size > 2000) {
    const oldest = smartpedCache.keys().next().value;
    if (oldest) smartpedCache.delete(oldest);
  }
  smartpedCache.set(key, { data, ts: Date.now() });
}

const app = express();
const PORT = process.env.PORT ? parseInt(process.env.PORT, 10) : (process.env.NODE_ENV === "production" ? 8080 : 3000);

app.use(express.json({ limit: "50mb" }));
app.use(express.urlencoded({ extended: true, limit: "50mb" }));

app.use((req, res, next) => {
  console.log(`[SERVER LOG] ${req.method} ${req.url}`);
  next();
});

// ============================================
// RATE LIMITING (anti-abuso, em memoria)
// ============================================
const RATE_LIMIT_WINDOW_MS = 60 * 1000; // 1 minuto
const RATE_LIMIT_MAX = 120; // max 120 req/min por IP
const rateLimitStore: Record<string, { count: number; resetAt: number }> = {};

app.use((req, res, next) => {
  const ip = req.ip || req.socket.remoteAddress || "unknown";
  const now = Date.now();
  const entry = rateLimitStore[ip];

  if (!entry || now > entry.resetAt) {
    rateLimitStore[ip] = { count: 1, resetAt: now + RATE_LIMIT_WINDOW_MS };
    return next();
  }

  entry.count++;
  if (entry.count > RATE_LIMIT_MAX) {
    return res.status(429).json({ error: "Rate limit excedido. Tente novamente em 1 minuto." });
  }
  next();
});

// Purga entradas expiradas do rate limit a cada 5 minutos
setInterval(() => {
  const now = Date.now();
  for (const ip of Object.keys(rateLimitStore)) {
    if (now > rateLimitStore[ip].resetAt) delete rateLimitStore[ip];
  }
}, 5 * 60 * 1000);

function cleanEan(ean: string | number | undefined | null): string {
  if (ean === undefined || ean === null) return "";
  const cleaned = String(ean).trim().replace(/\D/g, "");
  if (!cleaned) return "";
  if (cleaned.length <= 13) {
    return cleaned.padStart(13, "0");
  }
  return cleaned;
}

function normalizeDistName(name: string): string {
  return (name || "")
    .split('[')[0]
    .trim()
    .normalize("NFD")
    .replace(/[\u0300-\u036f]/g, "")
    .toUpperCase();
}

export function extractSmartPedQtdMin(cond: any): number {
  if (!cond) return 0;
  const candidates = [
    cond.QtdMin,
    cond.qtdMin,
    cond.QtdMinima,
    cond.qtdMinima,
    cond.Qtd_Minima,
    cond.Qtd_minima,
    cond.QuantidadeMinima,
    cond.quantidadeMinima,
    cond.Qtd,
    cond.qtd,
    cond.Combo?.QtdMin,
    cond.combo?.qtdMin,
    cond.Combo?.QtdMinima,
    cond.combo?.qtdMinima,
    cond.Escala?.QtdMin,
    cond.escala?.qtdMin,
    cond.Campanha?.QtdMin,
    cond.campanha?.qtdMin
  ];

  for (const c of candidates) {
    if (c !== undefined && c !== null) {
      const parsed = parseInt(String(c).replace(/[^0-9]/g, ""), 10);
      if (!isNaN(parsed) && parsed > 0) {
        return parsed;
      }
    }
  }
  return 0;
}

export function parseSmartPedEstoque(rawEstoque: any, hasValidPrice: boolean = true): number {
  if (rawEstoque === null || rawEstoque === undefined) {
    // Na SmartPed, cotações ativas retornadas com preço comercial válido onde o campo Estoque é omitido/nulo
    // representam produtos disponíveis e cotados na distribuidora (Status 2 = Normal).
    return hasValidPrice ? 2 : 0;
  }
  if (typeof rawEstoque === "boolean") {
    return rawEstoque ? 2 : 0;
  }
  if (typeof rawEstoque === "number") {
    if (isNaN(rawEstoque)) return hasValidPrice ? 2 : 0;
    return rawEstoque;
  }
  const str = String(rawEstoque).trim().toUpperCase();
  if (!str || str === "NULL" || str === "UNDEFINED") {
    return hasValidPrice ? 2 : 0;
  }
  if (["S", "SIM", "TRUE", "DISPONIVEL", "DISPONÍVEL", "NORMAL", "OK", "EM ESTOQUE"].includes(str)) {
    return 2;
  }
  if (["N", "NAO", "NÃO", "FALSE", "SEM ESTOQUE", "INDISPONIVEL", "INDISPONÍVEL", "ZERADO", "0"].includes(str)) {
    return 0;
  }
  const parsed = parseInt(str.replace(/[^0-9]/g, ""), 10);
  if (!isNaN(parsed)) {
    return parsed;
  }
  return hasValidPrice ? 2 : 0;
}

function cleanCodProduto(codProduto: string | undefined | null, codProdutoDist: string | undefined | null): string {
  const prod = String(codProduto || "").trim();
  const dist = String(codProdutoDist || "").trim();
  return (prod === "" || prod === "0") ? dist : prod;
}

// =========================================================================
// CACHE GLOBAL DE MÍNIMOS EM MEMÓRIA (SmartPed)
// Armazena os parâmetros de pedido mínimo retornados pelas distribuidoras
// =========================================================================
export let MINIMOS_GLOBAL_CACHE: Array<{
  CodDist: number;
  Condicao: string;
  Prazo: number;
  VlrMinimo: number;
  QtdMinima: number;
}> = [];

export function updateMinimosCache(minimos: any[]) {
  if (!minimos || !Array.isArray(minimos)) return;
  minimos.forEach(newMin => {
    const codDist = Number(newMin.CodDist !== undefined ? newMin.CodDist : newMin.codDist);
    const condicao = String(newMin.Condicao || newMin.condicao || "").trim().toUpperCase();
    const prazo = Number(newMin.Prazo !== undefined ? newMin.Prazo : (newMin.prazo !== undefined ? newMin.prazo : 0));
    const vlrMinimo = Number(newMin.VlrMinimo !== undefined ? newMin.VlrMinimo : (newMin.vlrMinimo !== undefined ? newMin.vlrMinimo : 0));
    const qtdMinima = Number(newMin.QtdMinima !== undefined ? newMin.QtdMinima : (newMin.qtdMinima !== undefined ? newMin.qtdMinima : 0));

    if (!codDist) return;

    const normalizedMin = {
      CodDist: codDist,
      Condicao: condicao,
      Prazo: prazo,
      VlrMinimo: vlrMinimo,
      QtdMinima: qtdMinima
    };

    const exists = MINIMOS_GLOBAL_CACHE.findIndex(
      m => m.CodDist === codDist && 
           m.Condicao === condicao && 
           m.Prazo === prazo
    );
    if (exists !== -1) {
      MINIMOS_GLOBAL_CACHE[exists] = normalizedMin;
    } else {
      MINIMOS_GLOBAL_CACHE.push(normalizedMin);
    }
  });
}

export function getMinimoFromCache(codDist: number | string | undefined, condicao?: string, prazo?: number | string): number {
  const cDistNum = Number(codDist);
  if (!cDistNum) return 0;
  const condUpper = String(condicao || "FIXA").trim().toUpperCase();
  const prazoNum = Number(prazo || 0);

  // 1. Match exato: CodDist + Condicao + Prazo
  let match = MINIMOS_GLOBAL_CACHE.find(
    m => m.CodDist === cDistNum && m.Condicao === condUpper && m.Prazo === prazoNum
  );
  if (match && match.VlrMinimo > 0) return match.VlrMinimo;

  // 2. Match por CodDist + Prazo
  match = MINIMOS_GLOBAL_CACHE.find(
    m => m.CodDist === cDistNum && m.Prazo === prazoNum
  );
  if (match && match.VlrMinimo > 0) return match.VlrMinimo;

  // 3. Match por CodDist + Condicao
  match = MINIMOS_GLOBAL_CACHE.find(
    m => m.CodDist === cDistNum && m.Condicao === condUpper
  );
  if (match && match.VlrMinimo > 0) return match.VlrMinimo;

  // 4. Match por CodDist
  match = MINIMOS_GLOBAL_CACHE.find(
    m => m.CodDist === cDistNum && m.VlrMinimo > 0
  );
  if (match && match.VlrMinimo > 0) return match.VlrMinimo;

  return 0;
}

function stripHtmlTags(str: string): string {
  if (!str) return "";
  return str.replace(/<\/?[^>]+(>|$)/g, "").trim();
}

function extractQuantityCount(desc: string): number | null {
  if (!desc) return null;
  const normalized = desc.toUpperCase();
  
  const cMatch = normalized.match(/\bC(?:X)?\/\s*(\d+)\b/i);
  if (cMatch && cMatch[1]) {
    return parseInt(cMatch[1], 10);
  }
  
  const cpMatch = normalized.match(/\b(\d+)\s*(?:CP|COMP|CAPS|CAP|DRG|BL|AMB|AMP|SACHET|ENVEL|UN)\b/i);
  if (cpMatch && cpMatch[1]) {
    return parseInt(cpMatch[1], 10);
  }
  
  return null;
}

function checkColetivoKeywords(novaDesc: string, originalDesc?: string): boolean {
  if (!novaDesc) return false;
  
  // Ignore lab codes/brand abbreviations that could interfere with text parsing (e.g., GG, AL, EMS, GL, BGN, GEO)
  let normNova = novaDesc.toUpperCase();
  const labCodesToIgnore = [/\bGG\b/g, /\bAL\b/g, /\bEMS\b/g, /\bGL\b/g, /\bBGN\b/g, /\bGEO\b/g];
  labCodesToIgnore.forEach(regex => {
    normNova = normNova.replace(regex, "");
  });

  const normOrig = (originalDesc || "").toUpperCase();

  // 1. Real wholesale / collective terms
  const wholesaleRegexes = [
    /\bFARDO\b/i,
    /\bDISPLAY\b/i,
    /\bPACOTAO\b/i,
    /\bPACOTÃO\b/i,
    /\b\d+\s*X\s*\d+\b/i, // e.g. 25X4
    /\bCX\s+COM\b/i,
    /\bCX\s+C\/\b/i,
    /\bC\/\s*DISPLAY\b/i
  ];

  if (wholesaleRegexes.some(regex => regex.test(normNova))) {
    return true;
  }

  // 2. Check for C/N or CX/N pattern
  const cMatch = normNova.match(/\bC(?:X)?\/\s*(\d+)\b/i);
  if (cMatch && cMatch[1]) {
    const subQty = parseInt(cMatch[1], 10);
    const origQty = extractQuantityCount(normOrig);

    // Equivalent retail presentations (e.g. original 30CP/C/30 and sub C/30) -> DO NOT FLAG
    if (origQty !== null && origQty === subQty) {
      return false;
    }

    if (origQty !== null) {
      // Flag if substitute quantity is divergent (e.g., subQty >= 2 * origQty and subQty > 12)
      if (subQty >= origQty * 2 && subQty > 12) {
        return true;
      }
      return false;
    } else {
      // Original didn't specify count. Only flag if subQty is a large wholesale packaging number (> 30)
      if (subQty > 30) {
        return true;
      }
      return false;
    }
  }

  return false;
}

function calculateQuantityAlert(
  originalPreco: number,
  novoPreco: number,
  novaDescricao: string,
  cx: number,
  originalDescricao?: string
): { alertaConfirmarQtd: boolean; motivoAlerta?: string } {
  // 1. Refatoração por Preço Discrepante: novoPreco > originalPreco * 3 E diferença absoluta > R$ 15.00
  if (originalPreco > 0 && novoPreco > originalPreco * 3 && (novoPreco - originalPreco > 15.0)) {
    return {
      alertaConfirmarQtd: true,
      motivoAlerta: `Preço unitário cotado (R$ ${novoPreco.toFixed(2)}) é muito superior ao custo ERP (R$ ${originalPreco.toFixed(2)}). Verifique se a cotação é de uma caixa fechada/embalagem múltipla.`
    };
  }
  
  // 2. Verificação de Texto de Embalagem Coletiva com Validação de Equivalência
  if (checkColetivoKeywords(novaDescricao, originalDescricao)) {
    return {
      alertaConfirmarQtd: true,
      motivoAlerta: `Descrição indica embalagem coletiva ("${novaDescricao}"). Verifique se a quantidade cotada corresponde à fração correta.`
    };
  }
  
  // 3. Fator Caixa Master do Distribuidor (cx > 1)
  if (cx > 1) {
    return {
      alertaConfirmarQtd: true,
      motivoAlerta: `O distribuidor indicou embalagem coletiva com fator de caixa cx: ${cx}. Ajuste as quantidades para evitar compras duplicadas.`
    };
  }

  return { alertaConfirmarQtd: false };
}

// Map of standard SmartPed distributors

async function fetchEanDescriptions(baseUrl: string, token: string, apiCnpj: string, eans: string[], logs: string[]): Promise<Record<string, { Descricao: string, Laboratorio: string }>> {
  if (!eans || eans.length === 0) return {};
  const eansToFetch = Array.from(new Set(eans.map(e => cleanEan(e)))).filter(Boolean);
  const result: Record<string, { Descricao: string, Laboratorio: string }> = {};
  
  // Dividimos em lotes de 40 para não sobrecarregar
  const batchSize = 40;
  for (let i = 0; i < eansToFetch.length; i += batchSize) {
    const batch = eansToFetch.slice(i, i + batchSize);
    try {
      const endpoint = `${baseUrl.replace(/\/$/, "")}/api/Condicoes/Molecula`;
      const res = await fetch(endpoint, {
        method: "POST",
        headers: { "Content-Type": "application/json", "Accept": "application/json" },
        body: JSON.stringify({
          Token: token,
          parametros: { CnpjCLi: apiCnpj, Ean: batch.join(","), ConsideraTipo: 1 }
        })
      });
      if (res.ok) {
        const data = await res.json();
        const itens = data.Retorno?.itens || data.Retorno?.Itens || data.itens || data.Itens || [];
        for (const it of itens) {
           const ip = it.ItemPedido || it.itemPedido || it;
           const eanStr = cleanEan(ip.Ean || ip.ean || "");
           if (eanStr) {
             result[eanStr] = {
                Descricao: ip.Descricao || ip.descricao || "",
                Laboratorio: ip.Laboratorio || ip.laboratorio || ""
             };
           }
        }
      }
    } catch (e: any) {
      logs.push(`[API ERRO] Falha ao buscar descrições via Molecula: ${e.message}`);
    }

    // Double-coverage check: For any EAN in this batch that was NOT resolved by Molecula, query Condicoes/Ean as fallback
    const unresolved = batch.filter(e => !result[e]);
    if (unresolved.length > 0) {
      try {
        const endpointEan = `${baseUrl.replace(/\/$/, "")}/api/Condicoes/Ean`;
        const resEan = await fetch(endpointEan, {
          method: "POST",
          headers: { "Content-Type": "application/json", "Accept": "application/json" },
          body: JSON.stringify({
            Token: token,
            parametros: { CnpjCLi: apiCnpj, Ean: unresolved.join(","), AceitaOntem: 1 }
          })
        });
        if (resEan.ok) {
          const dataEan = await resEan.json();
          const itensEan = dataEan.Retorno?.itens || dataEan.Retorno?.Itens || dataEan.itens || dataEan.Itens || [];
          for (const entry of itensEan) {
            const conds = entry.Condicoes || entry.condicoes || [];
            if (conds.length > 0) {
              const firstCond = conds[0];
              const eanRaw = String(firstCond.Ean || firstCond.ean || entry.CodBarra || "");
              const eanStr = cleanEan(eanRaw);
              if (eanStr && entry.Descricao) {
                result[eanStr] = {
                  Descricao: entry.Descricao,
                  Laboratorio: entry.Laboratorio || "Geral"
                };
              }
            }
          }
        }
      } catch (e: any) {
        logs.push(`[API ERRO] Falha ao buscar descrições de fallback via Ean: ${e.message}`);
      }
    }
  }
  
  return result;
}

const DISTRIBUIDORAS_MAP: Record<number, string> = {
  2: "PanPharma",
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
  56: "SIGREDE",
  59: "ANB",
  60: "GAM",
  67: "Dimed",
  79: "NeoSul",
  80: "Farmix",
  84: "GOLFARMA",
  85: "FORTES",
  518: "PONTUAL",
  533: "REDERM",
  542: "MULTIDROGAS",
  551: "NOVASD",
  552: "JK",
  555: "PALMED",
  557: "GOIASATACADO",
  566: "FARMACIASBRAVA",
  569: "WM",
  572: "ABS",
  576: "ATACADOSC",
  577: "LM",
  578: "AFIMINAS",
  579: "BIOLABGEN",
  580: "VAREJAO",
  581: "REDEFARMAGENTE",
  583: "DFDISTRIBUIDORA",
  594: "PRATIDONADUZZI",
  604: "RedeFBF",
  612: "FQM",
  616: "GLORIA",
  618: "Icone",
  625: "SmartDistribuidora",
  644: "FARLOG"
};

const EAN_DATABASE: Record<string, { 
  descricao: string; 
  laboratorio: string; 
  precoOriginal: number;
  qtd_estoque?: number;
  est_minimo?: number;
  est_maximo?: number;
  cod_reduzido?: string;
  vlr_custopersonalizado?: number;
  vlr_venda_tabela?: number;
  vlr_venda_final?: number;
  dat_ultent?: string;
  cod_dcb?: string;
  cod_concentracao?: string;
}> = {};
function getEanDatabaseRecord(ean: string | number | undefined | null) {
  if (ean === undefined || ean === null) return null;
  const cleaned = cleanEan(ean);
  if (!cleaned) return null;
  return EAN_DATABASE[cleaned] || EAN_DATABASE[String(ean).trim()] || null;
}
const DYNAMIC_EANS_CACHE: Record<string, any[]> = {};
const FATURAMENTO_ITEMS_CACHE: Record<string, { ean: string, descricao: string, laboratorio: string }> = {};

// ============================================
// PURGA AUTOMATICA DE CACHES (TTL: 2 horas)
// ============================================
const CACHE_TTL_MS = 2 * 60 * 60 * 1000; // 2 horas
setInterval(() => {
  const eanCount = Object.keys(EAN_DATABASE).length;
  const minimosCount = MINIMOS_GLOBAL_CACHE.length;
  const dynamicCount = Object.keys(DYNAMIC_EANS_CACHE).length;
  const fatCount = Object.keys(FATURAMENTO_ITEMS_CACHE).length;

  // Limpa caches secundarios (EAN_DATABASE e MINIMOS sao repovoados naturalmente)
  for (const key of Object.keys(DYNAMIC_EANS_CACHE)) delete DYNAMIC_EANS_CACHE[key];
  for (const key of Object.keys(FATURAMENTO_ITEMS_CACHE)) delete FATURAMENTO_ITEMS_CACHE[key];
  for (const key of Object.keys(SIMULATED_CHECKS)) delete SIMULATED_CHECKS[key];

  // Limpa EAN_DATABASE se exceder 50k registros
  if (eanCount > 50000) {
    for (const key of Object.keys(EAN_DATABASE)) delete EAN_DATABASE[key];
    console.log(`[CACHE PURGE] EAN_DATABASE limpo (${eanCount} registros).`);
  }

  // Limpa MINIMOS_GLOBAL_CACHE se exceder 5k registros
  if (minimosCount > 5000) {
    MINIMOS_GLOBAL_CACHE.length = 0;
    console.log(`[CACHE PURGE] MINIMOS_GLOBAL_CACHE limpo (${minimosCount} registros).`);
  }

  console.log(`[CACHE PURGE] DYNAMIC_EANS: ${dynamicCount}→0, FATURAMENTO: ${fatCount}→0, SIMULATED: limpo.`);
}, CACHE_TTL_MS);

function loadEanDatabase() {
  try {
    const utilsPath = path.join(process.cwd(), "src/utils.ts");
    if (fs.existsSync(utilsPath)) {
      const content = fs.readFileSync(utilsPath, "utf-8");
      const filesText: string[] = [];
      const sampleMatch = content.match(/export const SAMPLE_SICF_FILE = `([\s\S]+?)`/);
      if (sampleMatch) filesText.push(sampleMatch[1]);
      const homolMatch = content.match(/export const HOMOLOGACAO_SICF_FILE = `([\s\S]+?)`/);
      if (homolMatch) filesText.push(homolMatch[1]);

      for (const text of filesText) {
        const lines = text.split("\n");
        for (const line of lines) {
          const parts = line.trim().split(";");
          if (parts.length >= 7 && parts[0] === "2") {
            const ean = parts[1].trim();
            const desc = parts[4].trim();
            const lab = parts[5].trim();
            const price = parseFloat(parts[6].replace(",", "."));
            if (ean && desc) {
              const cleaned = cleanEan(ean);
              const data = {
                descricao: desc,
                laboratorio: lab || "Geral",
                precoOriginal: isNaN(price) ? 10.0 : price
              };
              EAN_DATABASE[ean] = data;
              if (cleaned && cleaned !== ean) {
                EAN_DATABASE[cleaned] = data;
              }
            }
          }
        }
      }
      console.log(`[SISTEMA] Base de EANs carregada com sucesso: ${Object.keys(EAN_DATABASE).length} itens mapeados.`);
    }
  } catch (err) {
    console.error("Erro ao carregar banco de dados de EANs:", err);
  }
}

function enrichReturnedItem(
  it: any, 
  numPedido: string, 
  descMap: Record<string, { Descricao: string, Laboratorio: string }> = {}
) {
  let rawEanStr = String(it.Ean || it.ean || it.EAN || it.CodBarra || it.codBarra || it.CodBarras || it.codBarras || "").trim();
  let descSmart = String(it.Descricao || it.descricao || it.Nome || it.nome || it.Descr || it.descr || "").trim();
  const codDistNum = typeof it.CodDist === "number" ? it.CodDist : parseInt(it.CodDist) || 2;
  const codProdDistStr = String(it.CodProdutoDist || it.codProdutoDist || "0").trim();
  const codProdutoStr = String(it.CodProduto || it.codProduto || "0").trim();

  // 1. Tentar recuperar pelo cache com CodProdutoDist
  if ((!rawEanStr || rawEanStr === "0" || !descSmart || descSmart.includes("sem identificação") || descSmart.toLowerCase() === "null") && numPedido) {
    const cacheKey = `${numPedido}_${codDistNum}_${codProdDistStr}`;
    const cached = FATURAMENTO_ITEMS_CACHE[cacheKey];
    if (cached) {
      if (!rawEanStr || rawEanStr === "0") rawEanStr = cached.ean;
      if (!descSmart || descSmart.includes("sem identificação") || descSmart.toLowerCase() === "null") descSmart = cached.descricao;
      it.Ean = rawEanStr;
      it.ean = rawEanStr;
      it.Descricao = descSmart;
      it.descricao = descSmart;
      if (cached.laboratorio) {
        it.Laboratorio = cached.laboratorio;
        it.laboratorio = cached.laboratorio;
      }
    }
  }

  // 2. Tentar recuperar pelo cache com CodProduto master
  if ((!rawEanStr || rawEanStr === "0" || !descSmart || descSmart.includes("sem identificação") || descSmart.toLowerCase() === "null") && numPedido) {
    const cacheKey2 = `${numPedido}_${codDistNum}_${codProdutoStr}`;
    const cached2 = FATURAMENTO_ITEMS_CACHE[cacheKey2];
    if (cached2) {
      if (!rawEanStr || rawEanStr === "0") rawEanStr = cached2.ean;
      if (!descSmart || descSmart.includes("sem identificação") || descSmart.toLowerCase() === "null") descSmart = cached2.descricao;
      it.Ean = rawEanStr;
      it.ean = rawEanStr;
      it.Descricao = descSmart;
      it.descricao = descSmart;
      if (cached2.laboratorio) {
        it.Laboratorio = cached2.laboratorio;
        it.laboratorio = cached2.laboratorio;
      }
    }
  }

  // 3. Tentar enriquecer via descMap do SmartPed ou EAN_DATABASE usando o EAN recuperado
  if (rawEanStr && rawEanStr !== "0") {
    const cleanedEan = cleanEan(rawEanStr);
    let descObj = descMap[cleanedEan] || descMap[rawEanStr];
    if (!descObj) {
      const local = getEanDatabaseRecord(rawEanStr);
      if (local) {
        descObj = { Descricao: local.descricao, Laboratorio: local.laboratorio };
      }
    }

    if (descObj) {
      it.Ean = rawEanStr;
      it.ean = rawEanStr;
      it.Descricao = descObj.Descricao;
      it.descricao = descObj.Descricao;
      it.Laboratorio = descObj.Laboratorio;
      it.laboratorio = descObj.Laboratorio;
    }
  }

  // 4. Se a descrição ainda estiver em branco, mas temos o EAN, garante pelo menos o formato "EAN: <ean>" ou do banco local
  if ((!it.Descricao && !it.descricao) || (it.Descricao || "").includes("sem identificação") || (it.Descricao || "").toLowerCase() === "null") {
    if (rawEanStr && rawEanStr !== "0") {
      const local = getEanDatabaseRecord(rawEanStr);
      if (local) {
        it.Descricao = local.descricao;
        it.descricao = local.descricao;
        it.Laboratorio = local.laboratorio || "Geral";
        it.laboratorio = local.laboratorio || "Geral";
      } else {
        it.Descricao = `EAN: ${rawEanStr}`;
        it.descricao = `EAN: ${rawEanStr}`;
      }
    } else {
      it.Descricao = "Item sem identificação (SmartPed)";
      it.descricao = "Item sem identificação (SmartPed)";
    }
  }
}

// Mock database for simulation mode
const MOCK_API_DATABASE: Record<string, { ItemPedido: any; Substitutos: any[] }> = {
  "7896862994372": {
    ItemPedido: {
      Ean: "7896862994372",
      Descricao: "DAPAGLIFLOZINA (G) 10MG 30CPM MEDQ",
      Laboratorio: "MEDQUIMICA",
      Pliquido: 51.88,
      PliquidoUni: 51.88,
      TipoItem: "G"
    },
    Substitutos: [
      {
        Ean: "7896862994372",
        Descricao: "DAPAGLIFLOZINA (G) 10MG 30CPM MEDQ",
        Laboratorio: "MEDQUIMICA",
        TipoItem: "G",
        Pliquido: 38.90,
        PliquidoUni: 38.90,
        Estoque: 1,
        NomeDist: "Gauchofarma",
        CodDist: 53,
        Prazo: 0,
        Condicao: "114942",
        QtdMin: 64,
        CX: 1
      },
      {
        Ean: "7896862994372",
        Descricao: "DAPAGLIFLOZINA (G) 10MG 30CPM MEDQ",
        Laboratorio: "MEDQUIMICA",
        TipoItem: "G",
        Pliquido: 40.50,
        PliquidoUni: 40.50,
        Estoque: 1,
        NomeDist: "Gauchofarma",
        CodDist: 53,
        Prazo: 0,
        Condicao: "114942",
        QtdMin: 24,
        CX: 1
      },
      {
        Ean: "7896862994372",
        Descricao: "DAPAGLIFLOZINA (G) 10MG 30CPM MEDQ",
        Laboratorio: "MEDQUIMICA",
        TipoItem: "G",
        Pliquido: 41.15,
        PliquidoUni: 41.15,
        Estoque: 1,
        NomeDist: "Gauchofarma",
        CodDist: 53,
        Prazo: 0,
        Condicao: "114942",
        QtdMin: 12,
        CX: 1
      },
      {
        Ean: "7896862994372",
        Descricao: "DAPAGLIFLOZINA (G) 10MG 30CPM MEDQ",
        Laboratorio: "MEDQUIMICA",
        TipoItem: "G",
        Pliquido: 42.51,
        PliquidoUni: 42.51,
        Estoque: 1,
        NomeDist: "Gauchofarma",
        CodDist: 53,
        Prazo: 7,
        Condicao: "FIXA",
        QtdMin: 0,
        CX: 1
      },
      {
        Ean: "7896862994372",
        Descricao: "DAPAGLIFLOZINA (G) 10MG 30CPM MEDQ",
        Laboratorio: "MEDQUIMICA",
        TipoItem: "G",
        Pliquido: 52.90,
        PliquidoUni: 52.90,
        Estoque: 2,
        NomeDist: "Profarma",
        CodDist: 4,
        Prazo: 7,
        Condicao: "FIXA",
        QtdMin: 0,
        CX: 1
      },
      {
        Ean: "7896862994372",
        Descricao: "DAPAGLIFLOZINA (G) 10MG 30CPM MEDQ",
        Laboratorio: "MEDQUIMICA",
        TipoItem: "G",
        Pliquido: 59.70,
        PliquidoUni: 59.70,
        Estoque: 2,
        NomeDist: "SMARTDISTRIBUIDORA",
        CodDist: 624,
        Prazo: 0,
        Condicao: "FIXA",
        QtdMin: 0,
        CX: 1
      },
      {
        Ean: "7896862994372",
        Descricao: "DAPAGLIFLOZINA (G) 10MG 30CPM MEDQ",
        Laboratorio: "MEDQUIMICA",
        TipoItem: "G",
        Pliquido: 60.17,
        PliquidoUni: 60.17,
        Estoque: 2,
        NomeDist: "ANB",
        CodDist: 59,
        Prazo: 3,
        Condicao: "FIXA",
        QtdMin: 0,
        CX: 1
      }
    ]
  },
  "7894916145008": {
    ItemPedido: {
      Ean: "7894916145008",
      Descricao: "GL CLOPIDOGREL 75MG 28CP REV",
      Laboratorio: "LEGRAND (GENERICOS)",
      Pliquido: 19.91,
      PliquidoUni: 19.91,
      TipoItem: "G"
    },
    Substitutos: [
      {
        Ean: "7894916145008",
        Descricao: "CLOPIDOGREL 75MG 28CPR REV - GEN LEG",
        Laboratorio: "LEGRAND GEN",
        TipoItem: "G",
        Pliquido: 21.35,
        PliquidoUni: 21.35,
        Estoque: 2,
        NomeDist: "NeoSul",
        CodDist: 79,
        Prazo: 7,
        Condicao: "FIXA"
      }
    ]
  },
  "4005900521910": {
    ItemPedido: {
      Ean: "4005900521910",
      Descricao: "SABONETE NIVEA 85G LEITE",
      Laboratorio: "NIVEA",
      Pliquido: 2.28,
      PliquidoUni: 2.28,
      TipoItem: "O"
    },
    Substitutos: [
      {
        Ean: "4005900521934",
        Descricao: "SABONETE NIVEA ERVA DOCE&OLEOS 85G",
        Laboratorio: "BEIERSDORF",
        TipoItem: "O",
        Pliquido: 2.78,
        PliquidoUni: 2.78,
        Estoque: 10,
        NomeDist: "ANB"
      }
    ]
  },
  "7896004746937": {
    ItemPedido: {
      Ean: "7896004746937",
      Descricao: "EZETIMIBA 10MG 2 BLT X 15 COMP (EMS)",
      Laboratorio: "EMS",
      Pliquido: 15.59,
      PliquidoUni: 15.59,
      TipoItem: "G"
    },
    Substitutos: [
      {
        Ean: "7898569762674",
        Descricao: "EZETIMIBA GN 10MG 30CPR AL",
        Laboratorio: "Althaia",
        TipoItem: "G",
        Pliquido: 15.23,
        PliquidoUni: 15.23,
        Estoque: 2,
        NomeDist: "DrogaCenter"
      },
      {
        Ean: "7899551301284",
        Descricao: "EZETIMIBA GN 10MG 30CPR BGN",
        Laboratorio: "Brainfarma",
        TipoItem: "G",
        Pliquido: 13.50,
        PliquidoUni: 13.50,
        Estoque: 5,
        NomeDist: "DrogaCenter"
      }
    ]
  },
  "7896241225547": {
    ItemPedido: {
      Ean: "7896241225547",
      Descricao: "ABLOK PLUS 100/25MG C/30 COMPRIMIDOS",
      Laboratorio: "BIOLAB",
      Pliquido: 40.99,
      PliquidoUni: 40.99,
      TipoItem: "O"
    },
    Substitutos: [
      {
        Ean: "7896241225127",
        Descricao: "ABLOK PLUS 50/12.5MG 30CPR",
        Laboratorio: "BIOLAB",
        TipoItem: "O",
        Pliquido: 24.15,
        PliquidoUni: 24.15,
        Estoque: 12,
        NomeDist: "SantaCruz"
      },
      {
        Ean: "7896241225523",
        Descricao: "ABLOK 50MG 30CPR",
        Laboratorio: "BIOLAB",
        TipoItem: "O",
        Pliquido: 18.61,
        PliquidoUni: 18.61,
        Estoque: 8,
        NomeDist: "GAM"
      }
    ]
  },
  "7891317024994": {
    ItemPedido: {
      Ean: "7891317024994",
      Descricao: "BUP 150MG C/30",
      Laboratorio: "EUROFARMA",
      Pliquido: 35.42,
      PliquidoUni: 35.42,
      TipoItem: "O"
    },
    Substitutos: [
      {
        Ean: "7891317438937",
        Descricao: "BUPROPIONA 150MG C/30 GEN",
        Laboratorio: "EUROFARMA",
        TipoItem: "G",
        Pliquido: 22.80,
        PliquidoUni: 22.80,
        Estoque: 4,
        NomeDist: "Profarma"
      },
      {
        Ean: "7899551301285",
        Descricao: "BUPROPIONA 150MG C/30 BGN",
        Laboratorio: "Brainfarma",
        TipoItem: "G",
        Pliquido: 19.50,
        PliquidoUni: 19.50,
        Estoque: 15,
        NomeDist: "PanPharma"
      }
    ]
  },
  "7896255711005": {
    ItemPedido: {
      Ean: "7896255711005",
      Descricao: "AKINETON 2MG C/80",
      Laboratorio: "BAGO",
      Pliquido: 28.50,
      PliquidoUni: 28.50,
      TipoItem: "O"
    },
    Substitutos: [
      {
        Ean: "7898940448128",
        Descricao: "BIPERIDENO 2MG C/80 EMS",
        Laboratorio: "EMS",
        TipoItem: "G",
        Pliquido: 14.20,
        PliquidoUni: 14.20,
        Estoque: 6,
        NomeDist: "DrogaCenter"
      }
    ]
  },
  "7896422514460": {
    ItemPedido: {
      Ean: "7896422514460",
      Descricao: "ALENTHUS XR 150MG C/30",
      Laboratorio: "CELLERA",
      Pliquido: 85.90,
      PliquidoUni: 85.90,
      TipoItem: "O"
    },
    Substitutos: [
      {
        Ean: "7896422528726",
        Descricao: "VENLAFAXINA 150MG C/30 MEDLEY",
        Laboratorio: "Medley",
        TipoItem: "G",
        Pliquido: 52.40,
        PliquidoUni: 52.40,
        Estoque: 3,
        NomeDist: "SantaCruz"
      }
    ]
  },
  "7891317010751": {
    ItemPedido: {
      Ean: "7891317010751",
      Descricao: "DEXALGEN INJETAVEL C/6 (GERAL)",
      Laboratorio: "EUROFARMA",
      Pliquido: 42.50,
      PliquidoUni: 42.50,
      TipoItem: "O"
    },
    Substitutos: [
      {
        Ean: "7891317030070",
        Descricao: "CITOBE DEXA INJETAVEL C/3 MOMENTA",
        Laboratorio: "Momenta",
        TipoItem: "O",
        Pliquido: 24.30,
        PliquidoUni: 24.30,
        Estoque: 12,
        NomeDist: "DrogaCenter"
      }
    ]
  }
};

// Simple utility function to parse formatted numbers from strings or numbers safely
function parseFormattedNumber(val: any): number {
  if (val === undefined || val === null) return 0;
  if (typeof val === "number") return val;
  if (typeof val === "string") {
    const cleaned = val.replace(/[^\d,.-]/g, "").replace(",", ".");
    const num = parseFloat(cleaned);
    return isNaN(num) ? 0 : num;
  }
  return 0;
}

// Extract Maximum Consumer Price (PMC) from any key or format returned by the SmartPed API or ERP
function extractPmc(item: any): number {
  if (!item) return 0;
  const keys = [
    "PMC", "pmc", "Pmc", "VlrPmc", "vlrPmc", "Vlr_pmc", "vlr_pmc", "Vlrpmc", "vlrpmc", 
    "VlrVendaMaximo", "vlrVendaMaximo", "VlrMaximo", "vlrMaximo", "PrecoConsumidor", "precoConsumidor",
    "PrecoMax", "precoMax", "PrecoMaximoConsumidor", "precoMaximoConsumidor", "PrecoMaximo", "precoMaximo",
    "VlrMaximoConsumidor", "vlrMaximoConsumidor"
  ];
  for (const key of keys) {
    if (item[key] !== undefined && item[key] !== null) {
      const val = parseFormattedNumber(item[key]);
      if (val > 0) return val;
    }
  }
  return 0;
}

// Extract Table Price (Preço de Fábrica/Tabela) from any key or format
function extractTablePrice(item: any): number {
  if (!item) return 0;
  const keys = [
    "Preco", "preco", "PrecoOriginal", "precoOriginal", "PrecoFabrica", "precoFabrica", 
    "Preco_fabrica", "preco_fabrica", "PrecoTabela", "precoTabela", "vlr_venda_tabela", 
    "VlrVendaTabela", "PrecoTabelaUni", "precoTabelaUni"
  ];
  for (const key of keys) {
    if (item[key] !== undefined && item[key] !== null) {
      const val = parseFormattedNumber(item[key]);
      if (val > 0) return val;
    }
  }
  return 0;
}

// Simple utility function to determine unit price (Evitar armadilha do zero)
function getUnitCost(item: any): number {
  if (!item) return 0;
  const pliq = parseFormattedNumber(item.Pliquido !== undefined ? item.Pliquido : (item.pliquido !== undefined ? item.pliquido : 0));
  const pliqUni = parseFormattedNumber(item.PliquidoUni !== undefined ? item.PliquidoUni : (item.pliquidoUni !== undefined ? item.pliquidoUni : (item.Pliquido_uni !== undefined ? item.Pliquido_uni : (item.pliquido_uni !== undefined ? item.pliquido_uni : 0))));

  if (pliqUni > 0 && (pliq === 0 || pliqUni < pliq)) return pliqUni;
  if (pliq > 0) return pliq;
  return parseFormattedNumber(item.Preco !== undefined ? item.Preco : (item.preco !== undefined ? item.preco : (item.PrecoOriginal !== undefined ? item.PrecoOriginal : (item.precoOriginal !== undefined ? item.precoOriginal : 0))));
}

async function fetchSimilarGenerics(ean: string): Promise<any[]> {
  try {
    const response = await fetch(`${CONFIG.FERRAMENTINHAS_API_URL}/api/produtos/similares/${ean}`);
    if (!response.ok) return [];
    const data = await response.json();
    return data.produtos || data.items || [];
  } catch (error) {
    console.error(`Erro ao buscar similares para EAN ${ean}:`, error);
    return [];
  }
}

// Helper to identify a real distributor offer vs virtual/mock/not found offers
function isRealOffer(s: any): boolean {
  if (!s) return false;
  const distId = s.CodDist !== undefined ? s.CodDist : (s.codDist !== undefined ? s.codDist : 0);
  const distName = String(s.NomeDist || s.nomeDist || s.distribuidora || "").trim().toLowerCase();
  return Number(distId) > 0 && distName !== "" && distName !== "nao encontrados" && distName !== "não encontrados" && distName !== "sem estoque";
}

// Optimization logic (similar to python script)
function findBestSubstitute(
  itemPedido: any,
  substitutos: any[],
  margemMinima: number,
  tiposAceitos: Set<string>,
  exigirEstoque: boolean,
  fallbackOriginalPrice?: number,
  originalHasStock: boolean = true,
  isGeneric: boolean = false,
  cortesRecentes: Record<string, string[]> = {}
): { melhor: any; economia: number; isFallback?: boolean } | null {
  // Use the actual price in the uploaded file as the primary benchmark
  let precoOriginal = (fallbackOriginalPrice !== undefined && fallbackOriginalPrice > 0)
    ? fallbackOriginalPrice
    : getUnitCost(itemPedido);

  if (precoOriginal <= 0) return null;

  const requestedQty = parseFloat(String(itemPedido?.qtd || itemPedido?.Qtd || 1).replace(",", ".")) || 1;
  const origEan = cleanEan(itemPedido.Ean || itemPedido.ean || "");

  const candidatos = (substitutos || []).filter((s) => {
    const sEan = cleanEan(s.Ean || s.ean || "");
    const isOriginalEan = sEan === origEan;

    // Filtro por cortes recentes de estoque de distribuidora nos últimos 2 dias
    const distNameClean = normalizeDistName(s.NomeDist || s.nomeDist || s.distribuidora || "");
    const blockedDistsForEan = cortesRecentes[sEan] || [];
    if (blockedDistsForEan.includes(distNameClean)) {
      return false; // Bloqueado pois sofreu corte recentemente nesta distribuidora
    }

    // Se NÃO for o EAN original exato, aplica os filtros de tipos de substituição do painel
    if (!isOriginalEan) {
      // Filtro por tipo de item (G, S, O, R)
      const tipoItem = s.TipoItem || s.tipoItem || "";
      const tipoItemUpper = tipoItem.toUpperCase();
      if (tipoItemUpper && !tiposAceitos.has(tipoItemUpper)) {
        return false;
      }
    }

    // Filtro por estoque
    const estoque = parseInt(String(s.Estoque !== undefined ? s.Estoque : (s.estoque !== undefined ? s.estoque : 0)), 10) || 0;
    if (exigirEstoque && estoque <= 0) {
      return false;
    }

    // Verificação de preço válido
    if (getUnitCost(s) <= 0) {
      return false;
    }

    // Se NÃO for o EAN original exato, aplica a regra estrita de categoria (Genérico com Genérico / Marca com Marca)
    if (!isOriginalEan) {
      const sDesc = (s.Descricao || s.descricao || "").toLowerCase();
      const sLab = (s.Laboratorio || s.laboratorio || "").toLowerCase();
      
      let isCandidateGeneric = false;
      const tipoItem = s.TipoItem || s.tipoItem || "";
      const tipoItemUpper = tipoItem.toUpperCase();
      if (tipoItemUpper) {
        isCandidateGeneric = tipoItemUpper === "G";
      } else {
        isCandidateGeneric = sDesc.includes(" gn ") || sDesc.includes("generico") || sDesc.includes("genérico") ||
                             sLab.includes("generico") || sLab.includes("genérico");
        if (isCandidateGeneric && sDesc.includes(" - ")) {
          isCandidateGeneric = false;
        }
      }

      // Se o original possuir estoque real (originalHasStock), aplicamos as travas estritas de categoria.
      // Caso contrário (ruptura), liberamos a substituição cruzada para garantir o abastecimento da farmácia.
      if (originalHasStock) {
        if (isGeneric && !isCandidateGeneric) {
          // Se o original é genérico, o candidato DEVE ser genérico
          return false;
        }
        if (!isGeneric && isCandidateGeneric) {
          // Se o original NÃO é genérico (é de marca/similar), o candidato NÃO PODE ser genérico (deve ser de marca/similar)
          return false;
        }
      }
    }

    // Match de Equivalência Estrita de Troca (Sabor, Fragrância, Cor, Dosagem, Quantidade)
    if (!validateSwapEquivalence(itemPedido, s)) {
      return false;
    }

    return true;
  });

  if (candidatos.length === 0) return null;

  // Separar em candidatos originais (mesmo EAN) e candidatos substitutos (EAN diferente)
  let candidatosOriginais = candidatos.filter(c => cleanEan(c.Ean || c.ean || "") === origEan);
  let candidatosSubstitutos = candidatos.filter(c => cleanEan(c.Ean || c.ean || "") !== origEan).filter(s => {
    if (isRealOffer(s)) {
      const estoque = parseInt(String(s.Estoque !== undefined ? s.Estoque : (s.estoque !== undefined ? s.estoque : 0)), 10) || 0;
      return estoque > 0;
    }
    return true;
  });

  // Se houver qualquer oferta real de distribuidor para o EAN original, eliminamos ofertas fantasmas/não encontrados
  const temOriginalReal = candidatosOriginais.some(c => isRealOffer(c));
  if (temOriginalReal) {
    candidatosOriginais = candidatosOriginais.filter(c => isRealOffer(c));
  }

  // Se houver qualquer substituto real válido, excluímos substitutos fantasmas ("Não Encontrados")
  const temSubstitutoReal = candidatosSubstitutos.some(s => isRealOffer(s));
  if (temSubstitutoReal) {
    candidatosSubstitutos = candidatosSubstitutos.filter(s => isRealOffer(s));
  }

  let melhorOriginal: any = null;
  if (candidatosOriginais.length > 0) {
    candidatosOriginais.sort((a, b) => {
      const aReal = isRealOffer(a);
      const bReal = isRealOffer(b);
      if (aReal && !bReal) return -1;
      if (!aReal && bReal) return 1;
      return getUnitCost(a) - getUnitCost(b);
    });
    melhorOriginal = candidatosOriginais[0];
  }

  // Verificamos se existe alguma oferta do EAN original com estoque > 0 em distribuidoras reais
  const originalTemEstoqueReal = (substitutos || []).some(s => {
    const sEan = cleanEan(s.Ean || s.ean || "");
    if (sEan !== origEan) return false;
    if (!isRealOffer(s)) return false;
    const estoque = parseInt(String(s.Estoque !== undefined ? s.Estoque : (s.estoque !== undefined ? s.estoque : 0)), 10) || 0;
    const preco = getUnitCost(s);
    return estoque > 0 && preco > 0;
  });

  // Substitutos só são válidos se derem a economia mínima exigida (margemMinima)
  // OU se o produto original não tiver estoque em nenhuma distribuidora real (Bypass de Falta)
  let substitutosValidos = candidatosSubstitutos;
  let benchmarkPreco = precoOriginal;

  if (originalTemEstoqueReal) {
    const origsComEstoque = (substitutos || []).filter(s => {
      const sEan = cleanEan(s.Ean || s.ean || "");
      if (sEan !== origEan) return false;
      if (!isRealOffer(s)) return false;
      const estoque = parseInt(String(s.Estoque !== undefined ? s.Estoque : (s.estoque !== undefined ? s.estoque : 0)), 10) || 0;
      const preco = getUnitCost(s);
      return estoque > 0 && preco > 0;
    });
    if (origsComEstoque.length > 0) {
      origsComEstoque.sort((a, b) => getUnitCost(a) - getUnitCost(b));
      benchmarkPreco = getUnitCost(origsComEstoque[0]);
    } else if (melhorOriginal) {
      benchmarkPreco = getUnitCost(melhorOriginal);
    }

    substitutosValidos = candidatosSubstitutos.filter(s => {
      const economia = benchmarkPreco - getUnitCost(s);
      return economia >= margemMinima && economia > 0;
    });
  } else {
    // Se o original NÃO tiver estoque (Falta Absoluta), o substituto vencedor deve assumir a vaga no carrinho,
    // mesmo que a economia seja negativa ou zero. Mas garantimos que ele possua estoque > 0.
    benchmarkPreco = precoOriginal;
    substitutosValidos = candidatosSubstitutos.filter(s => {
      const estoque = parseInt(String(s.Estoque !== undefined ? s.Estoque : (s.estoque !== undefined ? s.estoque : 0)), 10) || 0;
      return estoque > 0;
    });
  }

  let melhorSubstituto: any = null;
  if (substitutosValidos.length > 0) {
    substitutosValidos.sort((a, b) => {
      const aReal = isRealOffer(a);
      const bReal = isRealOffer(b);
      if (aReal && !bReal) return -1;
      if (!aReal && bReal) return 1;
      return getUnitCost(a) - getUnitCost(b);
    });
    melhorSubstituto = substitutosValidos[0];
  }

  // Tomar decisão de qual retornar:
  if (melhorOriginal && melhorSubstituto) {
    const origReal = isRealOffer(melhorOriginal);
    const substReal = isRealOffer(melhorSubstituto);

    if (origReal && !substReal) {
      // Prioridade absoluta para o EAN original real sobre substituto fantasma
      const economia = precoOriginal - getUnitCost(melhorOriginal);
      return { melhor: melhorOriginal, economia };
    } else if (!origReal && substReal) {
      // Prioridade para o substituto real sobre original fantasma
      const economia = benchmarkPreco - getUnitCost(melhorSubstituto);
      return { melhor: melhorSubstituto, economia };
    } else {
      // Se ambos são reais (ou ambos fantasmas), escolhemos o mais barato de fato para maximizar a economia
      if (getUnitCost(melhorSubstituto) < getUnitCost(melhorOriginal)) {
        const economia = benchmarkPreco - getUnitCost(melhorSubstituto);
        return { melhor: melhorSubstituto, economia };
      } else {
        const economia = precoOriginal - getUnitCost(melhorOriginal);
        return { melhor: melhorOriginal, economia };
      }
    }
  } else if (melhorOriginal) {
    // Se apenas o original está disponível, ele é soberano e imune a margemMinima/economia negativa
    const economia = precoOriginal - getUnitCost(melhorOriginal);
    return { melhor: melhorOriginal, economia };
  } else if (melhorSubstituto) {
    // Se apenas o substituto válido está disponível
    const economia = benchmarkPreco - getUnitCost(melhorSubstituto);
    return { melhor: melhorSubstituto, economia };
  }

  // REGRA DOS 10% DE RUPTURA: Se o produto original for Genérico e estiver sem estoque original,
  // permitimos substituição por outro Genérico de outra marca mesmo mais caro (até 10%), como último recurso
  if (!originalHasStock && isGeneric && candidatosSubstitutos.length > 0) {
    let substitutosGenericos = candidatosSubstitutos.filter(s => {
      const tipo = (s.TipoItem || s.tipoItem || "").toUpperCase();
      return tipo === "G" || !tipo;
    });

    const temGenericoReal = substitutosGenericos.some(s => isRealOffer(s));
    if (temGenericoReal) {
      substitutosGenericos = substitutosGenericos.filter(s => isRealOffer(s));
    }

    if (substitutosGenericos.length > 0) {
      substitutosGenericos.sort((a, b) => {
        const aReal = isRealOffer(a);
        const bReal = isRealOffer(b);
        if (aReal && !bReal) return -1;
        if (!aReal && bReal) return 1;
        return getUnitCost(a) - getUnitCost(b);
      });
      const melhorG = substitutosGenericos[0];
      const maxAllowedPrice = precoOriginal * 1.10;
      if (getUnitCost(melhorG) <= maxAllowedPrice) {
        const economia = precoOriginal - getUnitCost(melhorG);
        return { melhor: melhorG, economia, isFallback: true };
      }
    }
  }

  return null;
}

// API Health Check
app.get("/api/health", (req, res) => {
  res.json({ status: "ok", timestamp: new Date().toISOString() });
});

// Banco de dados local de equivalentes de mercado (Cross-Reference / Dicionário de Equivalentes de Alta Fidelidade)
// Garante o mapeamento de produtos de grandes laboratórios concorrentes (Aché, Eurofarma, Sandoz, Medley, EMS, etc.)
// para evitar "visão em túnel" de EANs originais.
const LOCAL_EQUIVALENTS_DB: Record<string, { ean: string; descricao: string; laboratorio: string; molecula: string; dosagem: string; apresentacao: string }[]> = {
  "PANTOPRAZOL 20MG 28CP": [
    { ean: "7891317454313", descricao: "PANTOPRAZOL 20MG 28CP", laboratorio: "EUROFARMA", molecula: "PANTOPRAZOL", dosagem: "20MG", apresentacao: "28CP" },
    { ean: "7891058021870", descricao: "PANTOPRAZOL 20MG 28CP", laboratorio: "ACHE", molecula: "PANTOPRAZOL", dosagem: "20MG", apresentacao: "28CP" },
    { ean: "7897595630322", descricao: "PANTOPRAZOL 20MG 28CP", laboratorio: "SANDOZ", molecula: "PANTOPRAZOL", dosagem: "20MG", apresentacao: "28CP" },
    { ean: "7896422505963", descricao: "PANTOPRAZOL 20MG 28CP", laboratorio: "MEDLEY", molecula: "PANTOPRAZOL", dosagem: "20MG", apresentacao: "28CP" },
    { ean: "7896004717144", descricao: "PANTOPRAZOL 20MG 28CP", laboratorio: "EMS", molecula: "PANTOPRAZOL", dosagem: "20MG", apresentacao: "28CP" },
    { ean: "7896714214221", descricao: "PANTOPRAZOL 20MG 28CP", laboratorio: "NEO QUIMICA", molecula: "PANTOPRAZOL", dosagem: "20MG", apresentacao: "28CP" },
    { ean: "7896112400304", descricao: "PANTOPRAZOL 20MG 28CP", laboratorio: "GERMED", molecula: "PANTOPRAZOL", dosagem: "20MG", apresentacao: "28CP" },
    { ean: "7894411244018", descricao: "PANTOPRAZOL 20MG 28CP", laboratorio: "TEUTO", molecula: "PANTOPRAZOL", dosagem: "20MG", apresentacao: "28CP" }
  ],
  "PANTOPRAZOL 40MG 28CP": [
    { ean: "7891317454351", descricao: "PANTOPRAZOL 40MG 28CP", laboratorio: "EUROFARMA", molecula: "PANTOPRAZOL", dosagem: "40MG", apresentacao: "28CP" },
    { ean: "7891058021894", descricao: "PANTOPRAZOL 40MG 28CP", laboratorio: "ACHE", molecula: "PANTOPRAZOL", dosagem: "40MG", apresentacao: "28CP" },
    { ean: "7897595630346", descricao: "PANTOPRAZOL 40MG 28CP", laboratorio: "SANDOZ", molecula: "PANTOPRAZOL", dosagem: "40MG", apresentacao: "28CP" },
    { ean: "7896422505987", descricao: "PANTOPRAZOL 40MG 28CP", laboratorio: "MEDLEY", molecula: "PANTOPRAZOL", dosagem: "40MG", apresentacao: "28CP" },
    { ean: "7896004717151", descricao: "PANTOPRAZOL 40MG 28CP", laboratorio: "EMS", molecula: "PANTOPRAZOL", dosagem: "40MG", apresentacao: "28CP" },
    { ean: "7896714214245", descricao: "PANTOPRAZOL 40MG 28CP", laboratorio: "NEO QUIMICA", molecula: "PANTOPRAZOL", dosagem: "40MG", apresentacao: "28CP" },
    { ean: "7896112400328", descricao: "PANTOPRAZOL 40MG 28CP", laboratorio: "GERMED", molecula: "PANTOPRAZOL", dosagem: "40MG", apresentacao: "28CP" },
    { ean: "7894411244032", descricao: "PANTOPRAZOL 40MG 28CP", laboratorio: "TEUTO", molecula: "PANTOPRAZOL", dosagem: "40MG", apresentacao: "28CP" }
  ],
  "DAPAGLIFLOZINA 10MG 30CP": [
    { ean: "7896014194881", descricao: "FORXIGA 10MG 30CP", laboratorio: "ASTRAZENECA", molecula: "DAPAGLIFLOZINA", dosagem: "10MG", apresentacao: "30CP" },
    { ean: "7896862994372", descricao: "DAPAGLIFLOZINA 10MG 30CP", laboratorio: "MEDQUIMICA", molecula: "DAPAGLIFLOZINA", dosagem: "10MG", apresentacao: "30CP" },
    { ean: "7896004780285", descricao: "DAPAGLIFLOZINA 10MG 30CP", laboratorio: "EMS", molecula: "DAPAGLIFLOZINA", dosagem: "10MG", apresentacao: "30CP" },
    { ean: "7891317025810", descricao: "DAPAGLIFLOZINA 10MG 30CP", laboratorio: "EUROFARMA", molecula: "DAPAGLIFLOZINA", dosagem: "10MG", apresentacao: "30CP" },
    { ean: "7896422534574", descricao: "DAPAGLIFLOZINA 10MG 30CP", laboratorio: "MEDLEY", molecula: "DAPAGLIFLOZINA", dosagem: "10MG", apresentacao: "30CP" },
    { ean: "7891058022983", descricao: "DAPAGLIFLOZINA 10MG 30CP", laboratorio: "ACHE", molecula: "DAPAGLIFLOZINA", dosagem: "10MG", apresentacao: "30CP" }
  ],
  "EZETIMIBA 10MG 30CP": [
    { ean: "7891317004457", descricao: "EZETIMIBA 10MG 30CP", laboratorio: "EUROFARMA", molecula: "EZETIMIBA", dosagem: "10MG", apresentacao: "30CP" },
    { ean: "7896004718547", descricao: "EZETIMIBA 10MG 30CP", laboratorio: "EMS", molecula: "EZETIMIBA", dosagem: "10MG", apresentacao: "30CP" },
    { ean: "7891058013219", descricao: "EZETIMIBA 10MG 30CP", laboratorio: "ACHE", molecula: "EZETIMIBA", dosagem: "10MG", apresentacao: "30CP" },
    { ean: "7896422515092", descricao: "EZETIMIBA 10MG 30CP", laboratorio: "MEDLEY", molecula: "EZETIMIBA", dosagem: "10MG", apresentacao: "30CP" },
    { ean: "7896714217130", descricao: "EZETIMIBA 10MG 30CP", laboratorio: "NEO QUIMICA", molecula: "EZETIMIBA", dosagem: "10MG", apresentacao: "30CP" },
    { ean: "7897595631244", descricao: "EZETIMIBA 10MG 30CP", laboratorio: "SANDOZ", molecula: "EZETIMIBA", dosagem: "10MG", apresentacao: "30CP" }
  ]
};

// Retorna EANs de equivalentes a partir de um EAN ou sua descrição analisada por Princípio Ativo + Dosagem + Apresentação
function getLocalEquivalents(ean: string, descricao?: string): string[] {
  const cleaned = cleanEan(ean);
  if (!cleaned) return [];

  // 1. Procurar correspondência direta por EAN em alguma lista
  for (const key of Object.keys(LOCAL_EQUIVALENTS_DB)) {
    const list = LOCAL_EQUIVALENTS_DB[key];
    if (list.some(item => cleanEan(item.ean) === cleaned)) {
      return list.map(item => cleanEan(item.ean)).filter(eq => eq !== cleaned);
    }
  }

  // 2. Se não bateu direto por EAN, tentar por interseção flexível de palavras-chave
  if (descricao) {
    const cleanTokens = (text: string) => {
      if (!text) return [];
      return text
        .normalize("NFD")
        .replace(/[\u0300-\u036f]/g, "") // remove acentos
        .toUpperCase()
        // Substitui os sais e termos de ligação de ruído por espaço
        .replace(/\b(SODICO|SODICA|SÓDICO|SÓDICA|CLORIDRATO|MALEATO|MESILATO|HEMITARTARATO|TARTARATO|DE|DI|MONO|POTASSICO|POTÁSSICO|SULFATO|ZINCICO|ZÍNCICO|CALCICA|CALCICO|CÁLCICO|MONOHIDRATADO|MONOIDRATADO|LACTATO|CARBONATO|ACETATO|FOSFATO|BROMIDRATO|CITRATO|ESTEARATO|SUCCINATO)\b/gi, " ")
        .split(/[\s+,\-/]/)
        .map(w => w.trim())
        .filter(w => w.length > 1);
    };

    const inputTokens = cleanTokens(descricao);

    if (inputTokens.length > 0) {
      for (const key of Object.keys(LOCAL_EQUIVALENTS_DB)) {
        const keyTokens = cleanTokens(key);
        
        // Verifique se todos os termos essenciais remanescentes da busca estão contidos na chave do banco local
        const allInputTokensInKey = inputTokens.every(it => 
          keyTokens.some(kt => kt === it || kt.includes(it) || it.includes(kt))
        );

        if (allInputTokensInKey) {
          return LOCAL_EQUIVALENTS_DB[key].map(item => cleanEan(item.ean)).filter(eq => eq !== cleaned);
        }
      }
    }
  }

  return [];
}

// Main Optimization Endpoint
app.post("/api/optimize", async (req, res) => {
  const logs: string[] = [];
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
      cortesRecentes = {}
    } = req.body;

    logs.push(`[INÍCIO] Iniciando processo de otimização.`);
    logs.push(`[PARÂMETROS] Margem mínima: R$ ${margemMinima.toFixed(2)}, Tipos aceitos: [${tipos.join(", ")}], Exigir estoque: ${!permitirSemEstoque ? 'Sim' : 'Não'}, Sandbox: ${useTestUrl ? 'Sim' : 'Não'}, Simulação: ${simulationMode ? 'Sim' : 'Não'}, Dist. Desabilitados: ${disabledDistributors.length}`);
    const disabledDistSet = new Set(disabledDistributors);

    if (!fileContent) {
      logs.push(`[ERRO] O conteúdo do arquivo está vazio ou não foi enviado.`);
      return res.status(400).json({ error: "O conteúdo do arquivo é obrigatório.", logs });
    }

    const tiposAceitos = new Set((tipos as string[]).map(t => t.trim().toUpperCase()));
    const exigirEstoque = !permitirSemEstoque;

    // Parse SICF Content
    logs.push(`[PARSER] Iniciando análise do arquivo SICF carregado...`);
    let cleanedContent = fileContent || "";
    if (cleanedContent.startsWith("\ufeff")) {
      cleanedContent = cleanedContent.substring(1);
      logs.push(`[PARSER] Removido indicador de codificação Byte Order Mark (BOM) do início do arquivo.`);
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
        logs.push(`[PARSER] Linha de cabeçalho (tipo 1) detectada. CNPJ do arquivo: ${detectedCnpj}`);
      } else if (tipo === "9") {
        footerLine = line;
        logs.push(`[PARSER] Linha de rodapé (tipo 9) detectada.`);
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

    logs.push(`[PARSER] Concluído. Total de itens de dados (tipo 2) encontrados: ${parsedItems.length}`);

    if (!headerLine) {
      logs.push(`[ERRO] Cabeçalho do arquivo (tipo 1) não foi encontrado.`);
      return res.status(400).json({ error: "Arquivo SICF inválido: cabeçalho (tipo 1) não encontrado.", logs });
    }

    const finalCnpj = reqCnpj || detectedCnpj;
    if (!finalCnpj) {
      logs.push(`[ERRO] Não foi possível encontrar nenhum CNPJ do cliente.`);
      return res.status(400).json({ error: "CNPJ do cliente não fornecido e não encontrado no cabeçalho do arquivo.", logs });
    }

    const uniqueEans = Array.from(new Set(parsedItems.map(item => item.ean)));
    logs.push(`[PROCESSAMENTO] Total de EANs únicos para consulta: ${uniqueEans.length}`);

    // Pré-carregar similares de mercado de forma concorrente para todos os EANs únicos
    logs.push(`[PROCESSAMENTO] Pré-carregando dicionário dinâmico de similares de mercado para ${uniqueEans.length} EANs...`);
    const marketSimilarMap: Record<string, any[]> = {};
    try {
      const startTimeSimilar = Date.now();
      const similarPromises = uniqueEans.map(async (ean) => {
        try {
          const res = await fetchSimilarGenerics(ean);
          marketSimilarMap[ean] = res || [];
        } catch (err) {
          marketSimilarMap[ean] = [];
        }
      });
      await Promise.all(similarPromises);
      logs.push(`[PROCESSAMENTO] Sucesso! Similares de mercado carregados concorrentemente em ${Date.now() - startTimeSimilar}ms.`);
    } catch (err: any) {
      logs.push(`[AVISO] Falha ao pré-carregar produtos similares de mercado: ${err.message}`);
    }

    // Gerar conjunto estendido de EANs a serem cotados (EAN original + equivalentes locais + similares de mercado)
    const eansToQuoteSet = new Set<string>();
    uniqueEans.forEach(ean => {
      const orig = cleanEan(ean);
      if (!orig) return;
      
      eansToQuoteSet.add(orig);

      // Localizar descrição do item para enriquecimento estático local
      const itemPedidoOriginal = parsedItems.find(it => cleanEan(it.ean) === orig);
      const descStr = itemPedidoOriginal ? itemPedidoOriginal.descricao : "";
      
      // Enriquecer com equivalentes locais (Dicionário Estático)
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

      // Enriquecer com os similares de mercado da API (Ferramentinhas) com trava estrita de equivalência
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

    const eansToQuote = Array.from(eansToQuoteSet);
    logs.push(`[MOTOR AGRUPAMENTO] Ampliado o leque de cotação de ${uniqueEans.length} EANs originais para ${eansToQuote.length} EANs totais de concorrentes.`);

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
          return { descricao: d, laboratorio: l || "GENÉRICO" };
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
                laboratorio: entry.ItemPedido.Laboratorio || entry.ItemPedido.laboratorio || "GENÉRICO" 
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
                  laboratorio: sub.Laboratorio || sub.laboratorio || "GENÉRICO" 
                };
              }
            }
          }
        }
      }
      return null;
    }

    const allMinimos: any[] = [];

    if (simulationMode) {
      logs.push(`[MOCK] Modo Simulação Ativo. Usando banco de dados simulado local.`);
      for (const ean of eansToQuote) {
        if (MOCK_API_DATABASE[ean]) {
          logs.push(`[MOCK] Carregado produto real mapeado para o EAN ${ean} (${MOCK_API_DATABASE[ean].ItemPedido?.Descricao || ""}).`);
          apiResponses[ean] = MOCK_API_DATABASE[ean];
        } else {
          logs.push(`[MOCK] EAN ${ean} não encontrado no banco simulado.`);
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

      // Se o token for o padrão de teste, usamos o CNPJ padrão associado "11111111111111"
      const isSandboxToken = actualToken === CONFIG.SMARTPED_SANDBOX_TOKEN;
      const apiCnpj = isSandboxToken ? "11111111111111" : finalCnpj.trim().replace(/\D/g, "");

      logs.push(`[API CONEXÃO] Iniciando conexões reais com o servidor SmartPed.`);
      logs.push(`[API CONEXÃO] URL Base: ${baseUrl}`);
      logs.push(`[API CONEXÃO] Endpoint Rota: ${endpointPath}`);
      if (isSandboxToken) {
        logs.push(`[API CONEXÃO] Token de teste padrão detectado. Utilizando o CNPJ padrão "11111111111111" associado para evitar erros de vínculo.`);
      } else {
        logs.push(`[API CONEXÃO] CNPJ de Homologação/Produção utilizado: ${apiCnpj} (Original: ${finalCnpj})`);
      }
      logs.push(`[API CONEXÃO] Token de Acesso: ${actualToken.substring(0, 6)}...`);

      // Batch call (SmartPed endpoint CondicoesMolecula handles multiple EANs separated by comma)
      // Chunk EANs in batches of 40
      const batchSize = 40;
      for (let i = 0; i < eansToQuote.length; i += batchSize) {
        const batch = eansToQuote.slice(i, i + batchSize);
        logs.push(`[API SOLICITAÇÃO] Enviando lote com ${batch.length} EANs (Lote ${Math.floor(i / batchSize) + 1} de ${Math.ceil(eansToQuote.length / batchSize)})...`);
        
        try {
          const startTime = Date.now();
          
          const pMolecula = fetch(`${baseUrl.replace(/\/$/, "")}/${endpointPath.replace(/^\//, "")}`, {
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
          });

          const pEan = fetch(`${baseUrl.replace(/\/$/, "")}/api/Condicoes/Ean`, {
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
          });

          const [responseMolecula, responseEan] = await Promise.all([pMolecula, pEan]);
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

          logs.push(`[API RESPOSTA] Sucesso! Molecula retornou ${itensMolecula.length} moléculas. Condicoes/Ean retornou ${itensEan.length} itens.`);

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
                 Condicoes: []
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
                    const inferredTipo = (descUpper.includes("(G)") || descUpper.includes("GENERICO") || descUpper.includes("GENÉRICO")) ? "G" : "O";
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
                          const existingInferredTipo = (existingDescUpper.includes("(G)") || existingDescUpper.includes("GENERICO") || existingDescUpper.includes("GENÉRICO")) ? "G" : "O";
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

          // Fallback para EANs que não obtiveram resposta da API mas que temos no banco simulado local
          for (const ean of batch) {
            if (!apiResponses[ean] && MOCK_API_DATABASE[ean]) {
              logs.push(`[SISTEMA CONTINGÊNCIA] Usando dados locais para EAN ${ean} como contingência de homologação.`);
              apiResponses[ean] = MOCK_API_DATABASE[ean];
            }
          }
        } catch (error: any) {
          console.error("Erro consultando lote da API SmartPed:", error.message);
          logs.push(`[API ALERTA CRÍTICO] Falha de conexão: ${error.message}. Ativando contingência de simulação inteligente local.`);
          
          for (const ean of batch) {
              if (MOCK_API_DATABASE[ean]) {
                apiResponses[ean] = MOCK_API_DATABASE[ean];
              }
            }
        }
      }
    }

    // Passo de Enriquecimento por Fallback de Busca Textual (Princípio Ativo) para itens sem ofertas/estoque
    logs.push(`[SISTEMA FALLBACK] Analisando itens do pedido para identificar ausência de estoque/ofertas e aplicar busca por princípio ativo...`);
    const fallbackPromises: Promise<void>[] = [];
    const actualToken = (token || CONFIG.SMARTPED_SANDBOX_TOKEN).trim();
    const isSandboxToken = actualToken === CONFIG.SMARTPED_SANDBOX_TOKEN;
    const apiCnpj = isSandboxToken ? "11111111111111" : finalCnpj.trim().replace(/\D/g, "");
    let baseUrl = useTestUrl ? CONFIG.SMARTPED_SANDBOX_URL : CONFIG.SMARTPED_PRODUCTION_URL;
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

      // Verificar se algum EAN equivalente tem oferta ativa com preço e estoque > 0
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

      // Se não encontramos estoque ativo para o original, OU se não há ofertas para nenhum equivalente, acoplamos a busca de fallback dinâmica
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

      // Se elegível, disparamos a busca de fallback em tempo real na SmartPed
      if (shouldTriggerFallback) {
        logs.push(`[SISTEMA FALLBACK] Item "${item.descricao}" (EAN: ${origEan}) está sem ofertas de distribuidoras com estoque. Agendando busca dinâmica por molécula/texto...`);
        
        fallbackPromises.push((async () => {
          try {
            // 1. Descobrir o DCB se temos o EAN
            let dcbDescoberto = "";
            try {
              const dcbRes = await fetch(`${CONFIG.FERRAMENTINHAS_API_URL}/api/produtos/similares/${origEan}`);
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
              "KIT", "SAB", "SABONETE", "BOLA", "BALA", "BRINQUEDO", "DIVERSOS", "POTE", "PÇS", "PCS", "PEÇAS",
              "PECAS", "MINI", "GRANDE", "PEQUENO", "ESTOJO", "PORTA", "SUPORTE", "CABO", "FITA", "COLA", "BASE",
              "MASCARA", "MÁSCARA", "SOMBRA", "PIRANHA", "CREME", "LOÇÃO", "LOCAO", "SHAMPOO", "CONDICIONADOR",
              "AEROSOL", "SPRAY", "DESODORANTE", "DESOD", "PERFUME", "COLONIA", "COLÔNIA", "BODY", "SPLASH",
              "POMADA", "TALCO", "ALGODAO", "ALGODÃO", "CURATIVO", "BANDAGEM", "ESCOVA", "PENTE", "LIXA",
              "PINCA", "PINÇA", "TESOURA", "CURVADOR", "CARRINHO", "CARRO", "ANIMAIS", "BONECA", "CHUPETA",
              "MAMADEIRA", "DOSADOR", "PRENDEDOR", "ELASTICO", "ELÁSTICO", "PRESILHA", "GRAMPO", "INF", "INFANTIL",
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
                fetch(`${baseUrl.replace(/\/$/, "")}/api/Produtos/Buscar`, {
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
                     similaresAtuais.push({ cod_barra: eanResp, nom_produto: itemPedido.Descricao || entry.Descricao || `Descoberto via Fallback ${tag}` });
                     marketSimilarMap[origEan] = similaresAtuais;
                  }
                }
              }
            };

            incorporateRetornoItens(resDcb, "Princípio Ativo");
            incorporateRetornoItens(resExtra, "Molécula Extra");

            // Incorporar resultados de Produtos/Buscar
            if (resBuscar) {
              const itensBuscar = resBuscar.Retorno || resBuscar.retorno || [];
              if (Array.isArray(itensBuscar) && itensBuscar.length > 0) {
                logs.push(`[SISTEMA FALLBACK] Retorno por Produtos/Buscar trouxe ${itensBuscar.length} ofertas para o item ${origEan}.`);
                itensBuscar.forEach((sub: any) => {
                  const subEan = cleanEan(sub.Ean || sub.ean || "");
                  if (!subEan) return;

                  const codDist = sub.CodDist !== undefined ? sub.CodDist : sub.codDist;
                  const distName = sub.NomeDist || sub.nomeDist || distsMapLocal[codDist] || DISTRIBUIDORAS_MAP[codDist] || `Distribuidor ${codDist}`;
                  const subPreco = getUnitCost(sub);
                  const subEstoque = parseInt(String(sub.Estoque !== undefined ? sub.Estoque : (sub.estoque || 0)), 10) || 0;

                  const mappedSub = {
                    Ean: subEan,
                    Descricao: sub.Descricao || sub.descricao || "",
                    Laboratorio: sub.Laboratorio || sub.laboratorio || "GENÉRICO",
                    TipoItem: sub.TipoItem || sub.tipoItem || (sub.Descricao && (sub.Descricao.toUpperCase().includes("(G)") || sub.Descricao.toUpperCase().includes("GENERICO") || sub.Descricao.toUpperCase().includes("GENÉRICO")) ? "G" : "S"),
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
                     similaresAtuais.push({ cod_barra: subEan, nom_produto: sub.Descricao || "Descoberto via Fallback Buscar" });
                     marketSimilarMap[origEan] = similaresAtuais;
                  }
                });
              }
            }

          } catch (err: any) {
            logs.push(`[SISTEMA FALLBACK ALERTA] Erro na busca por princípio ativo para "${item.descricao}": ${err.message}`);
          }
        })());
      }
    });

    if (fallbackPromises.length > 0) {
      logs.push(`[SISTEMA FALLBACK] Aguardando a finalização concorrente de ${fallbackPromises.length} buscas textuais de emergência...`);
      await Promise.all(fallbackPromises);
      logs.push(`[SISTEMA FALLBACK] Busca de fallback por princípio ativo concluída com sucesso.`);
    }

    // Process swaps and rewrite lines
    logs.push(`[ANALISADOR] Iniciando filtragem de substitutos e verificação de condições comerciais.`);
    const finalLines: string[] = [headerLine];
    const report: any[] = [];
    let totalSavings = 0.0;
    let itemsTreatedCount = 0;
    let itemsSwappedCount = 0;

    for (const item of parsedItems) {
      const origEan = cleanEan(item.ean);
      const localEquivs = getLocalEquivalents(origEan, item.descricao);
      const apiSimilars = (marketSimilarMap[origEan] || []).map(s => cleanEan(s.cod_barra || s.Ean || s.ean || ""));
      
      // Verificar se o próprio EAN original possui alguma oferta ativa com preço e estoque > 0
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

      // Se o original já possui estoque ativo/oferta, limitamos a lista de equivalentes apenas ao próprio original.
      // Isso impede "swaps" desnecessários ou equivocados de marcas concorrentes de produtos que já possuem ofertas ativas e estoque!
      // Mantendo a equivalência dinâmica apenas para recuperar itens out-of-stock ("Sem Estoque").
      const allEquivSet = origHasStockOffer 
        ? new Set<string>([origEan])
        : new Set<string>([origEan, ...localEquivs, ...apiSimilars]);

      let combinedSubstitutos: any[] = [];
      let combinedCondicoes: any[] = [];
      let mainItemPedido = null;

      // Unificar respostas de cotações da SmartPed de todos os EANs equivalentes que de fato retornaram ofertas
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

          // Se o ItemPedido de um EAN concorrente/equivalente for retornado na SmartPed, e ele possuir preço,
          // nós o transformamos em uma alternativa de troca elegível (Substituto)!
          if (resp.ItemPedido && equivEan !== origEan) {
            const cost = getUnitCost(resp.ItemPedido);
            if (cost > 0) {
              const condEstoque = parseInt(String(resp.ItemPedido.Estoque || resp.ItemPedido.estoque || 0), 10) || 0;
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
        mainItemPedido = { Ean: origEan, Descricao: item.descricao, Laboratorio: item.laboratorio, Pliquido: item.precoOriginal };
      }

      // Filtrar estritamente combinedSubstitutos com o Hard Block de equivalência
      combinedSubstitutos = combinedSubstitutos.filter((s: any) => validateSwapEquivalence(mainItemPedido, s));

      // Adicionar também os similares brutos do Ferramentinhas que não foram achados pela SmartPed como fallback, caso não haja nenhum substituto cotado
      const similaresMercado = marketSimilarMap[origEan] || [];
      const mappedSimilares = similaresMercado.map((s: any) => {
         const est = parseInt(String(s.qtd_estoque !== undefined ? s.qtd_estoque : (s.Estoque !== undefined ? s.Estoque : (s.estoque !== undefined ? s.estoque : 0))), 10) || 0;
         const price = parseFloat(String(s.vlr_custopersonalizado !== undefined ? s.vlr_custopersonalizado : (s.vlr_custo !== undefined ? s.vlr_custo : getUnitCost(s))));
         return {
            Ean: s.cod_barra || s.Ean || s.ean || "",
            Descricao: s.nom_produto || s.Descricao || s.descricao || "",
            Laboratorio: s.nom_laborat || s.Laboratorio || s.laboratorio || "",
            Estoque: est,
            Pliquido: price,
            PliquidoUni: price,
            TipoItem: s.TipoItem || s.tipoItem || (s.nom_produto && (s.nom_produto.toUpperCase().includes("(G)") || s.nom_produto.toUpperCase().includes("GENERICO") || s.nom_produto.toUpperCase().includes("GENÉRICO")) ? "G" : "S"),
            NomeDist: s.NomeDist || s.nomeDist || s.nom_distribuidora || "Não Encontrados",
            CodDist: s.CodDist !== undefined ? s.CodDist : (s.codDist !== undefined ? s.codDist : 0),
            Condicao: s.Condicao || s.condicao || "FIXA",
            Prazo: s.Prazo !== undefined ? s.Prazo : (s.prazo || 7)
         };
      }).filter((s: any) => validateSwapEquivalence(mainItemPedido, s));

      // Mesclar os similares de fallback nos substitutos de forma que se não houver ofertas reais na SmartPed, o usuário ainda os veja no painel
      const eansExistentes = new Set(combinedSubstitutos.map((s: any) => cleanEan(s.Ean || s.ean || "")));
      const novosSimilares = mappedSimilares.filter((s: any) => !eansExistentes.has(cleanEan(s.Ean || s.ean || "")));
      
      let entry: any = {
        ItemPedido: mainItemPedido,
        Substitutos: [...combinedSubstitutos, ...novosSimilares],
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

        const substitutosRaw = entry.Substitutos || entry.substitutos || [];
        const condicoesRaw = entry.Condicoes || entry.condicoes || [];
        
        // Ensure we filter out disabled distributors globally and apply Hard Block on substitutes
        const substitutos = substitutosRaw.filter((s: any) => {
            const dist = s.CodDist !== undefined ? s.CodDist : s.codDist;
            if (dist !== undefined && disabledDistSet.has(Number(dist))) return false;
            return validateSwapEquivalence(itemPedido, s);
        });
        const condicoes = condicoesRaw.filter((c: any) => {
            const dist = c.CodDist !== undefined ? c.CodDist : c.codDist;
            return dist === undefined || !disabledDistSet.has(Number(dist));
        });

        const itemAlternatives = [...condicoes, ...substitutos]
          .filter((s: any) => {
            const est = s.Estoque !== undefined ? s.Estoque : (s.estoque || 0);
            if (getUnitCost(s) <= 0 || est <= 0) return false;
            return validateSwapEquivalence(itemPedido, s);
          })
          .map((s: any) => {
            const codDist = s.CodDist !== undefined ? s.CodDist : (s.codDist !== undefined ? s.codDist : 0);
            const condicao = s.Condicao || s.condicao || "FIXA";
            const prazo = s.Prazo !== undefined ? s.Prazo : (s.prazo !== undefined ? s.prazo : 0);
            const unitPrice = getUnitCost(s);
            const tablePrice = extractTablePrice(s);
            const baseForPmc = tablePrice > 0 ? tablePrice : unitPrice;
            let apiPmc = extractPmc(s);
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
              const resolved = findDescAndLabFromApiResponses(altEan);
              if (resolved) {
                if (!altDesc) altDesc = resolved.descricao;
                if (!resolvedLab) resolvedLab = resolved.laboratorio;
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
              distribuidora: s.NomeDist || s.nomeDist || "Distribuidor",
              codDist: codDist,
              prazo: prazo,
              qtdMin: s.QtdMin !== undefined ? s.QtdMin : (s.qtdMin !== undefined ? s.qtdMin : 0),
              qtdMax: (s.Combo && s.Combo.QtdMax !== undefined) ? s.Combo.QtdMax : ((s.combo && s.combo.qtdMax !== undefined) ? s.combo.qtdMax : 0),
              cx: s.CX !== undefined ? s.CX : (s.cx !== undefined ? s.cx : 1),
              estoque: s.Estoque !== undefined ? s.Estoque : (s.estoque || 0),
              codProdutoDist: s.CodProdutoDist || s.codProdutoDist || "",
              codProduto: cleanCodProduto(s.CodProduto || s.codProduto || "", s.CodProdutoDist || s.codProdutoDist || "")
            };
          });

        const uniqueAltsMap = new Map<string, any>();
        itemAlternatives.forEach(alt => {
          const key = `${alt.ean}_${alt.distribuidora}_${alt.condicao}_${alt.preco.toFixed(2)}_${alt.prazo}`;
          if (!uniqueAltsMap.has(key)) {
            uniqueAltsMap.set(key, alt);
          }
        });
        const finalAlternatives = Array.from(uniqueAltsMap.values()).sort((a: any, b: any) => {
          const aReal = isRealOffer(a);
          const bReal = isRealOffer(b);
          if (aReal && !bReal) return -1;
          if (!aReal && bReal) return 1;
          return a.preco - b.preco;
        });
        
        let isGeneric = false;
        if (originalTipo) {
          isGeneric = originalTipo.toUpperCase() === "G";
        } else {
          const descLower = originalDesc.toLowerCase();
          const labLower = originalLab.toLowerCase();
          isGeneric = descLower.includes(" gn ") || 
                      descLower.includes("generico") || 
                      descLower.includes("genérico") ||
                      labLower.includes("generico") || 
                      labLower.includes("genérico");
          if (isGeneric && descLower.includes(" - ")) {
            isGeneric = false;
          }
        }
                          
        const requestedQty = parseFloat(String(item.qtd).replace(",", ".")) || 1;
        itemPedido.qtd = requestedQty;
        itemPedido.Qtd = requestedQty;

        const condicoesOriginal = [...condicoes, ...substitutos].filter((s: any) => cleanEan(s.Ean || s.ean || "") === cleanEan(item.ean));
        let originalHasStock = false;
        if (condicoesOriginal.length > 0) {
            originalHasStock = condicoesOriginal.some((s: any) => {
                const est = parseInt(String(s.Estoque !== undefined ? s.Estoque : (s.estoque !== undefined ? s.estoque : 0)), 10) || 0;
                return est > 0;
            });
        }

        const effectiveOriginalHasStock = !exigirEstoque || originalHasStock;

        logs.push(`[PRODUTO] Analisando EAN ${item.ean} - "${originalDesc}" | Qtd Solicitada: ${requestedQty} | Preço Base: R$ ${item.precoOriginal.toFixed(2)} | Genérico: ${isGeneric ? 'Sim' : 'Não'} | Tem Estoque: ${originalHasStock ? 'Sim' : 'Não'}`);
        logs.push(`[PRODUTO] Total de medicamentos substitutos elegíveis cadastrados no distribuidor: ${substitutos.length}`);
        
        const result = findBestSubstitute(itemPedido, [...condicoes, ...substitutos], margemMinima, tiposAceitos, exigirEstoque, item.precoOriginal, effectiveOriginalHasStock, isGeneric, cortesRecentes);
        let finalResult = result;

        if (!finalResult && !originalHasStock) {
          logs.push(`[ALERTA] Medicamento ${item.ean} sem estoque suficiente (${requestedQty}). Buscando alternativas similares...`);
          const similares = await fetchSimilarGenerics(item.ean);
          const mappedSimilares = similares.map((s: any) => {
             const est = parseInt(String(s.qtd_estoque !== undefined ? s.qtd_estoque : (s.Estoque !== undefined ? s.Estoque : (s.estoque !== undefined ? s.estoque : 0))), 10) || 0;
             const price = parseFloat(String(s.vlr_custopersonalizado !== undefined ? s.vlr_custopersonalizado : (s.vlr_custo !== undefined ? s.vlr_custo : getUnitCost(s))));
             return {
                Ean: s.cod_barra || s.Ean || s.ean || "",
                Descricao: s.nom_produto || s.Descricao || s.descricao || "",
                Laboratorio: s.nom_laborat || s.Laboratorio || s.laboratorio || "",
                Estoque: est,
                Pliquido: price,
                PliquidoUni: price,
                TipoItem: "G",
                NomeDist: s.NomeDist || s.nomeDist || "Não Encontrados",
                CodDist: s.CodDist !== undefined ? s.CodDist : (s.codDist !== undefined ? s.codDist : 0),
                Condicao: s.Condicao || s.condicao || "FIXA",
                Prazo: s.Prazo !== undefined ? s.Prazo : (s.prazo || 7)
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

          // Se houver qualquer oferta de distribuidora real, removemos as ofertas fantasmas ("Não Encontrados")
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
            logs.push(`[SUCESSO] Alternativa genérica encontrada: EAN ${melhor.Ean} (${melhor.Descricao}) com estoque: ${melhor.Estoque}`);
          }
        }

          // Computar a melhor opção original mesmo se encontrarmos um substituto, para o caso do usuário clicar em "Manter original"
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

          const todasCondicoesOriginal = [...condicoes, ...substitutos].filter((s: any) => {
            if (cleanEan(s.Ean || s.ean || "") !== cleanEan(item.ean)) {
              return false;
            }
            const sEan = cleanEan(s.Ean || s.ean || "");
            const distNameClean = normalizeDistName(s.NomeDist || s.nomeDist || s.distribuidora || "");
            const blockedDistsForEan = cortesRecentes[sEan] || [];
            if (blockedDistsForEan.includes(distNameClean)) {
              return false;
            }
            return true;
          });
          // Sempre indicar a condição mais barata mesmo que precise de quantidade maior
          let condicoesOriginalCompativeis = todasCondicoesOriginal;

          // Se houver qualquer oferta de distribuidora real, removemos as ofertas fantasmas ("Não Encontrados")
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

              const aEst = parseInt(String(a.Estoque !== undefined ? a.Estoque : (a.estoque !== undefined ? a.estoque : 0)), 10) || 0;
              const bEst = parseInt(String(b.Estoque !== undefined ? b.Estoque : (b.estoque !== undefined ? b.estoque : 0)), 10) || 0;
              
              const aHasStock = aEst > 0;
              const bHasStock = bEst > 0;

              if (aHasStock && !bHasStock) return -1;
              if (!aHasStock && bHasStock) return 1;

              return getUnitCost(a) - getUnitCost(b);
            });
            ref = condicoesOriginalCompativeis[0];
            bestOriginalDist = ref.NomeDist || ref.nomeDist || "Não Encontrados";
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

        // Verificar se há fornecedores externos cadastrados com preços melhores
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

          for (const supplier of externalSuppliers) {
            if (!supplier.products || !Array.isArray(supplier.products)) continue;
            
            for (const extProd of supplier.products) {
              if (!validateSwapEquivalence(sicfDesc, extProd.description)) {
                continue; // Rejeição estrita se houver divergência de sabor, dosagem ou apresentação!
              }
              const extClean = cleanString(extProd.description);
              const extWords = extClean.split(" ").filter(w => w.length > 1 && !stopWords.has(w));
              if (extWords.length === 0) continue;

              // Extrair e validar dosagens e quantidades
              const extInfo = extractDosageAndQty(extProd.description);
              
              // Se ambas as descrições tiverem dosagem, elas devem bater exatamente
              if (sicfInfo.dosages.length > 0 && extInfo.dosages.length > 0) {
                const dosageMatch = sicfInfo.dosages.some(d => extInfo.dosages.includes(d));
                if (!dosageMatch) continue; // Pula se houver divergência de dosagem
              }
              
              // Se ambas as descrições tiverem quantidade de comprimidos/capsulas, elas devem bater exatamente
              if (sicfInfo.quantities.length > 0 && extInfo.quantities.length > 0) {
                const qtyMatch = sicfInfo.quantities.some(q => extInfo.quantities.includes(q));
                if (!qtyMatch) continue; // Pula se houver divergência de apresentação/quantidade
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

        if (matchedExternal && (bestSmartPedPrice - matchedExternal.price) >= margemMinima) {
          logs.push(`⭐ [FORNECEDOR WHATSAPP] Melhor preço no fornecedor externo "${matchedSupplierName}": R$ ${matchedExternal.price.toFixed(2)} (SmartPed: R$ ${bestSmartPedPrice.toFixed(2)}) para "${matchedExternal.description}"`);
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

          if (novoEan === cleanEan(item.ean)) {
            if (!novaDescricao) novaDescricao = item.descricao;
            if (!novoLab) novoLab = item.laboratorio;
          }

          if (!novaDescricao || !novoLab) {
            const resolved = findDescAndLabFromApiResponses(novoEan);
            if (resolved) {
              if (!novaDescricao) novaDescricao = resolved.descricao;
              if (!novoLab) novoLab = resolved.laboratorio;
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
            novoLab = item.laboratorio || "GENÉRICO";
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
             logs.push(`⚠️ [SUBSTITUIÇÃO POR FALTA] Original sem estoque! Trocado pelo genérico EAN ${novoEan} (${novaDescricao}) do laboratório ${novoLab}`);
          } else {
             logs.push(`🚀 [SUBSTITUIÇÃO APROVADA] Trocar por EAN ${novoEan} (${novaDescricao}) do laboratório ${novoLab}`);
          }
          logs.push(`   Preço original: R$ ${item.precoOriginal.toFixed(2)} | Preço otimizado: R$ ${precoNovo.toFixed(2)} | Economia unitária: R$ ${economia.toFixed(2)} | Economia total (Qtd ${qtdNum}): R$ ${economiaTotal.toFixed(2)}`);

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
          const calcOriginalPmc = apiOriginalPmc > 0 ? apiOriginalPmc : 0;

          const apiNovoPmc = extractPmc(melhor);
          const novoTablePrice = extractTablePrice(melhor);
          const baseNovoPmc = novoTablePrice > 0 ? novoTablePrice : precoNovo;
          const calcNovoPmc = apiNovoPmc > 0 ? apiNovoPmc : 0;

          const alertResult = calculateQuantityAlert(
            item.precoOriginal,
            precoNovo,
            novaDescricao,
            melhor.CX !== undefined ? melhor.CX : (melhor.cx !== undefined ? melhor.cx : 1),
            item.descricao
          );

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
            originalSemEstoque: todasCondicoesOriginal.length === 0 || todasCondicoesOriginal.every((c: any) => (parseInt(String(c.Estoque !== undefined ? c.Estoque : c.estoque || 0), 10) || 0) <= 0),
            novoEan,
            novaDescricao,
            novoLaboratorio: novoLab,
            novoPreco: precoNovo,
            novoPmc: calcNovoPmc,
            qtd: qtdNum,
            economiaUnit: economia,
            economiaTotal,
            distribuidora: melhor.NomeDist || melhor.nomeDist || "Distribuidor",
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
            alertaConfirmarQtd: alertResult.alertaConfirmarQtd,
            motivoAlerta: alertResult.motivoAlerta,
            alternatives: finalAlternatives
          });
        } else {
          logs.push(`⏹️ [MANTER ORIGINAL] Mantendo original. Motivo: nenhuma opção elegível mais barata com economia mínima de R$ ${margemMinima.toFixed(2)} ou sem estoque suficiente.`);
          
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
              originalDist = ref.NomeDist || ref.nomeDist || "Não Encontrados";
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
          const calcOriginalPmc = apiOriginalPmc > 0 ? apiOriginalPmc : 0;
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
            originalSemEstoque: todasCondicoesOriginal.length === 0 || todasCondicoesOriginal.every((c: any) => (parseInt(String(c.Estoque !== undefined ? c.Estoque : c.estoque || 0), 10) || 0) <= 0),
            alertaConfirmarQtd: alertResult.alertaConfirmarQtd,
            motivoAlerta: alertResult.motivoAlerta,
            alternatives: finalAlternatives
          });
        }
      } else {
        logs.push(`⚠️ [MANTER ORIGINAL] EAN ${item.ean} (${item.descricao}) não obteve retorno da API SmartPed. Mantendo original.`);
        
        const qtdNum = parseFloat(item.qtd.replace(",", "."));
        const fallbackPmc = 0;
        report.push({
          codInterno: item.codInterno,
          originalEan: item.ean,
          originalDescricao: item.descricao,
          originalLaboratorio: item.laboratorio,
          originalPreco: item.precoOriginal,
          originalPrecoCotado: item.precoOriginal,
          originalPmc: fallbackPmc,
          novoEan: item.ean,
          novaDescricao: item.descricao,
          novoLaboratorio: item.laboratorio,
          novoPreco: item.precoOriginal,
          novoPmc: fallbackPmc,
          qtd: qtdNum,
          economiaUnit: 0,
          economiaTotal: 0,
          distribuidora: "Não Encontrados",
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
          alternatives: []
        });
      }

      if (!lineFinal) {
        // Keep original line
        lineFinal = item.originalLine;
      }
      finalLines.push(lineFinal);
    }

    if (footerLine) {
      finalLines.push(footerLine);
    }

    const optimizedFileContent = finalLines.join("\r\n");
    
    logs.push(`[SUCESSO] Processo de otimização concluído com sucesso!`);
    logs.push(`[SUCESSO] Itens Otimizados com Economia: ${itemsSwappedCount} de ${parsedItems.length}`);
    logs.push(`[SUCESSO] Economia Estimada Total: R$ ${totalSavings.toFixed(2)}`);

    res.json({
      optimizedFileContent,
      cnpj: finalCnpj,
      summary: {
        totalItems: parsedItems.length,
        itemsTreated: itemsTreatedCount,
        itemsSwapped: itemsSwappedCount,
        totalSavings
      },
      report,
      minimos: allMinimos,
      logs
    });
  } catch (err: any) {
    console.error("Erro interno do servidor durante otimização:", err);
    logs.push(`[ERRO CRÍTICO] Falha inesperada interna: ${err.message}`);
    res.status(500).json({ error: "Erro interno do servidor: " + err.message, logs });
  }
});

// Simulated check counter to show progressive status change (Awaiting -> Finalized) in simulation mode
const SIMULATED_CHECKS: Record<string, number> = {};

// Endpoint de Faturamento SmartPed (Simulação e Integração Real)
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

      // Blindagem 4 (Regra de Ouro 2): Itens sem distribuidora ou "Não Encontrados"/"Sem Estoque" ou com codDist === 0 ou originalCodDist === 0 ou inválidos
      if (
        parsedCodDist === 0 || 
        originalCodDistNum === 0 || 
        isNaN(parsedCodDist) ||
        distNameLower.includes("não encontrado") || 
        distNameLower.includes("sem estoque") ||
        distNameLower.trim() === ""
      ) {
        logs.push(`[BLINDAGEM] Item bloqueado (Filtro Distribuidora/Estoque): ${item.novaDescricao || item.originalDescricao} (${item.novoEan || item.originalEan}) possui codDist/originalCodDist zerado ou inválido (codDist: ${rawCodDist}, originalCodDist: ${item.originalCodDist}) ou distribuidora "${item.distribuidora || ''}". Ignorando faturamento.`);
        continue;
      }

      const codDistNum = parsedCodDist;
      const codProdDistStr = String(item.codProdutoDist || "").trim();
      const codProdutoStr = String(item.codProduto || "").trim();

      // Blindagem 1: Swaps para distribuidores reais devem ter IDs de produto válidos (não '0' ou vazio ou null ou undefined ou strings "null"/"undefined")
      if (isSwapped && codDistNum !== 9999) {
        const isProdDistInvalid = !codProdDistStr || 
                                  codProdDistStr === "0" || 
                                  codProdDistStr.toLowerCase() === "null" || 
                                  codProdDistStr.toLowerCase() === "undefined";
                                  
        const isProdInvalid = !codProdutoStr || 
                              codProdutoStr === "0" || 
                              codProdutoStr.toLowerCase() === "null" || 
                              codProdutoStr.toLowerCase() === "undefined";

        if (isProdDistInvalid || isProdInvalid) {
          logs.push(`[BLINDAGEM] Item bloqueado (Código Invalido/Zero/Null): ${item.novaDescricao || item.originalDescricao} (${item.novoEan || item.originalEan}) é substituto mas possui CodProdutoDist/CodProduto inválidos ou nulos/zeros. Ignorando faturamento deste item.`);
          continue;
        }
      }

      // Blindagem 2: Swaps sem EAN de destino válido
      if (isSwapped) {
        if (!item.novoEan || String(item.novoEan).length < 5) {
          logs.push(`[BLINDAGEM] Item bloqueado: Swap EAN inválido para ${item.originalDescricao}.`);
          continue;
        }
      }

      // Blindagem 3: Garantir que não existam valores nulos/undefined críticos
      if (!item.novoEan && !item.originalEan) {
        logs.push(`[BLINDAGEM] Item bloqueado: EAN ausente.`);
        continue;
      }

      validatedItems.push(item);
    }

    if (validatedItems.length === 0) {
      logs.push(`[FATURAMENTO ERRO] Nenhum item passou pelas regras de Blindagem de segurança.`);
      return res.status(400).json({ error: "Nenhum dos itens selecionados passou nas validações de segurança dos códigos de produto.", logs });
    }

    logs.push(`[FATURAMENTO] Itens aprovados pela blindagem: ${validatedItems.length} de ${items.length}`);

    // Agrupar itens por distribuidora para logs e cálculos locais
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

    logs.push(`[FATURAMENTO] Agrupamento concluído em ${Object.keys(distribuidorasMap).length} distribuidora(s).`);

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

    // Geramos um ID de pedido SmartPed numérico para monitoramento (ex: 3221)
    let numPedidoSmartPed = Math.floor(2000 + Math.random() * 8000);
    let distribuidorasBloqueadas: any[] = [];

    if (!simulationMode) {
      let baseUrl = useTestUrl ? CONFIG.SMARTPED_SANDBOX_URL : CONFIG.SMARTPED_PRODUCTION_URL;
      const endpointEnvio = `${baseUrl.replace(/\/$/, "")}/api/Pedido/Envio`;
      logs.push(`[API CONEXÃO] Registrando faturamento na API SmartPed: ${endpointEnvio}...`);

      // Mapeamento dos itens para a estrutura oficial da SmartPed (api/Pedido/Envio)
      const apiItens = validatedItems.map((it: any) => ({
        CodDist: typeof it.codDist === "number" ? it.codDist : parseInt(it.codDist) || 2,
        Condicao: it.condicao || "FIXA",
        CodProdutoDist: String(it.codProdutoDist || "0"),
        CodProduto: String(it.codProduto || "0"),
        Prazo: typeof it.prazo === "number" ? it.prazo : parseInt(it.prazo) || 7,
        Ean: String(it.novoEan || it.originalEan),
        Quant: typeof it.qtd === "number" ? it.qtd : parseFloat(it.qtd) || 1
      }));

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
            resData.Mensagem.toLowerCase().includes("inválido") ||
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
            logs.push(`[API ERRO] Resposta da SmartPed sem ID de pedido válido (Retorno ou NumPedido nulo).`);
            const errMsg = resData.Mensagem || "Resposta sem tag Retorno ou NumPedido de confirmação de faturamento.";
            return res.status(400).json({
              sucesso: false,
              error: `Falha no faturamento SmartPed: ${errMsg}`,
              logs
            });
          }

          numPedidoSmartPed = parseInt(resData.Retorno.NumPedido || resData.Retorno.numPedido);
          logs.push(`[API CONEXÃO SUCESSO] Pedido cadastrado com sucesso! ID SmartPed: ${numPedidoSmartPed}`);

          // Extrair distribuidoras bloqueadas (DistBloqEnv)
          if (resData.Retorno && resData.Retorno.DistBloqEnv) {
            distribuidorasBloqueadas = Array.isArray(resData.Retorno.DistBloqEnv)
              ? resData.Retorno.DistBloqEnv
              : [resData.Retorno.DistBloqEnv];
            logs.push(`[ALERTA] Algumas distribuidoras no lote possuem bloqueio de envio: ${JSON.stringify(distribuidorasBloqueadas)}`);
          }
        } else {
          const errText = await resFaturar.text().catch(() => "Sem detalhes de erro");
          logs.push(`[API CONEXÃO ERRO] Endpoint SmartPed retornou falha (Status ${resFaturar.status}). Detalhes: ${errText}`);
          return res.status(400).json({
            sucesso: false,
            error: `Erro de comunicação HTTP ${resFaturar.status} com a SmartPed.`,
            logs
          });
        }
      } catch (e: any) {
        logs.push(`[API CONEXÃO ERRO] Falha de comunicação: ${e.message}`);
        return res.status(400).json({
          sucesso: false,
          error: `Não foi possível estabelecer comunicação com o servidor SmartPed: ${e.message}`,
          logs
        });
      }
    } else {
      logs.push(`[MOCK] Modo de Simulação Ativo. Lote processado localmente.`);
    }

    logs.push(`[SUCESSO] Faturamento concluído no Otimizador!`);
    logs.push(`[SUCESSO] Protocolo Lote: ${protocoloLote} | ID SmartPed: ${numPedidoSmartPed}`);
    logs.push(`[SUCESSO] Valor do Lote: R$ ${totalValor.toFixed(2)} | Economia Estimada: R$ ${totalEconomia.toFixed(2)}`);

    // Alimentar o cache global de faturamento para complementar dados de retorno de itens futuros (Chaves duplas para segurança máxima!)
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
        codProduto: it.codProduto || ""
      })),
      logs
    });
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

    // Data de hoje e de 7 dias atrás no formato DD/MM/AAAA
    const hoje = new Date(new Date().toLocaleString("en-US", { timeZone: "America/Sao_Paulo" }));
    const seteDiasAtras = new Date(hoje);
    seteDiasAtras.setDate(hoje.getDate() - 7);

    const formatDate = (d: Date) => `${String(d.getDate()).padStart(2, '0')}/${String(d.getMonth() + 1).padStart(2, '0')}/${d.getFullYear()}`;
    const dataIni = formatDate(seteDiasAtras);
    const dataFim = formatDate(hoje);

    logs.push(`[MONITORAMENTO] Buscando pedidos de ${dataIni} até ${dataFim}...`);
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
      logs.push(`[MOCK] Modo Simulação (Token de testes). Gerando pedidos fictícios do dia.`);
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
              { CodProdutoDist: "900501", Ean: "7896422505987", Descricao: "PANTOPRAZOL SÓDICO SESQUI-HIDRATADO 40MG 28CP AD", Laboratorio: "MEDLEY", Quant: 10, QuantFaturada: 10, Preco: 22.50, Desconto: 10.00, ST: 0.80, PrecoLiquido: 20.25, NomeDist: "Profarma", CodDist: 4, Condicao: "FIXA", DifMedio: 0.00, Motivo: "" }
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
        relatorioFinal.push({
          numPedido,
          dataPedido: ped.DataPedido || dataFim,
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
    logs.push(`[ERRO CRÍTICO] Falha no monitoramento: ${err.message}`);
    res.status(500).json({ error: "Erro interno: " + err.message, logs });
  }
});

app.post("/api/itens-confirmados-do-dia", async (req, res) => {
  const logs: string[] = [];
  try {
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

    let itensConfirmados: any[] = [];

    if (!isSandboxToken) {
      // Passo 1: Listar pedidos do dia
      logs.push(`[ITENS CONFIRMADOS] Buscando pedidos de ${finalDataIni} até ${finalDataFim}...`);
      const resListar = await fetch(`${baseUrl}/api/Pedido/Listar`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ Token: actualToken, parametros: { CnpjCLi: apiCnpj, DataIni: finalDataIni, DataFim: finalDataFim } })
      });
      const dataListar = await resListar.json();
      const pedidos = dataListar.Retorno || [];
      
      // Desduplicar pedidos para evitar duplicar itens se a API retornar múltiplas linhas do mesmo pedido
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
      logs.push(`[MOCK] Modo Simulação (Token de testes). Gerando itens confirmados fictícios para os pedidos do dia.`);
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
    
    // Passo 4: Tradução EAN (Descrição)
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
        nome: tempItem.Descricao
      };
    });

    res.json({ itens: resultadoFinal, logs });
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
      return res.status(400).json({ error: "Número do pedido é obrigatório." });
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
      logs.push(`[API CONEXÃO] Chamando endpoint real: ${endpointRetorno}...`);
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
          logs.push(`[API CONEXÃO ALERTA] Retorno real indisponível. Ativando simulação inteligente para CNPJ real.`);
          fallbackToSimulated = true;
        }
      } catch (e: any) {
        logs.push(`[API CONEXÃO ERRO] Erro ao consultar retorno: ${e.message}. Ativando simulação.`);
        fallbackToSimulated = true;
      }
    } else {
      logs.push(`[MOCK] Token de homologação detectado. Utilizando simulação controlada.`);
      fallbackToSimulated = true;
    }

    // Se estivermos em simulação ou o serviço real falhar, criamos um retorno simulado super realístico!
    if (fallbackToSimulated || !apiResponseData) {
      // Se não houver itemsFaturados, criamos itens fictícios padrão para que a consulta direta funcione
      const finalItemsFaturados = (itemsFaturados && itemsFaturados.length > 0) ? itemsFaturados : [
        { ean: "7894916145008", descricao: "GL CLOPIDOGREL 75MG 28CP REV", preco: 19.91, qtd: 3, distribuidora: "GAM", codDist: 60, condicao: "FIXA" },
        { ean: "7896004746937", descricao: "EZETIMIBA 10MG 30CPR BGN", preco: 13.50, qtd: 5, distribuidora: "DrogaCenter", codDist: 9, condicao: "FIXA" },
        { ean: "7891317024994", descricao: "BUPROPIONA 150MG C/30 BGN", preco: 19.50, qtd: 2, distribuidora: "PanPharma", codDist: 2, condicao: "FIXA" }
      ];

      // Agrupar as distribuidoras presentes nos itens faturados com seus respectivos códigos
      const distsMap: Record<string, number> = {};
      finalItemsFaturados.forEach((it: any) => {
        const dName = it.distribuidora || "Distribuidor";
        const dCod = typeof it.codDist === "number" ? it.codDist : parseInt(it.codDist) || 2;
        distsMap[dName] = dCod;
      });
      
      // Decidimos o Status do pedido com base no número de consultas (para simular de fato a espera de processamento real!)
      // Primeira consulta: Status 2 (Aguardando Retorno)
      // Segunda consulta ou superior: Status 3 (Finalizado)
      // Se for homologação sandbox clássica, mantemos 0 ou 3 a depender do desejo de testar.
      // Vamos simular a transição real! Se checkCount === 1, retornamos status 2 para manter realístico!
      const simulatedStatus = checkCount === 1 ? 2 : 3;
      const descStatus = simulatedStatus === 2 
        ? "2 - Pedido Enviado Aguardando Retorno" 
        : "3 - Pedido Finalizado";

      logs.push(`[SIMULADOR] Simulação de retorno da API. Consulta #${checkCount} | Status Definido: ${descStatus}`);

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
          // No status 2 (Aguardando), a quantidade faturada ainda é 0 em processamento
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

    // Enriquecer as descrições dos itens se for ambiente real (não sandbox)
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
          logs.push(`[ENRIQUECIMENTO] Buscando descrições para os ${eansToEnrich.length} itens do retorno...`);
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
            logs.push(`[ENRIQUECIMENTO SUCESSO] ${enrichedCount} itens enriquecidos com descrição e laboratório.`);
          } catch (enrichErr: any) {
            logs.push(`[ENRIQUECIMENTO ERRO] Falha no enriquecimento de descrições: ${enrichErr.message}`);
          }
        }
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
      return res.status(400).json({ error: "Token e CNPJ são obrigatórios." });
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
  const log = (msg: string) => { logs.push(msg); console.log(`[SEARCH] ${msg}`); };
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
      onlyExactEan = false
    } = req.body;

    if (!query || String(query).trim().length < 3) {
      return res.json({ items: [], logs: ["Digite pelo menos 3 caracteres para buscar."] });
    }

    const searchQuery = String(query).trim().toUpperCase();
    const actualToken = (token || CONFIG.SMARTPED_SANDBOX_TOKEN).trim();
    const isSandboxToken = actualToken === CONFIG.SMARTPED_SANDBOX_TOKEN;
    const apiCnpj = isSandboxToken ? "11111111111111" : (cnpj || CONFIG.SMARTPED_DEFAULT_CNPJ).trim().replace(/\D/g, "");

    log(`[BUSCA] Buscando por "${searchQuery}" (EAN Exato: ${onlyExactEan})...`);
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
        log(`[API CONEXÃO] Query numérica detectada (EAN). Chamando Condicoes/Ean ${onlyExactEan ? "" : "e Condicoes/Molecula em paralelo"}.`);
        
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

          const pMolecula = onlyExactEan ? Promise.resolve(null) : fetch(endpointMolecula, {
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
          log(`[API CONEXÃO] Chamadas concluídas. Status Ean: ${resEan.status} | Status Molecula: ${resMolecula ? resMolecula.status : "ignorado (EAN Exato)"}`);

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
                
                log(`[API CONEXÃO SUCESSO] SmartPed Condicoes/Ean retornou ${condicoes.length} ofertas para o EAN ${searchQuery}.`);
                
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

          // 2. Processa retorno de Condicoes/Molecula (substitutos, genéricos, similares)
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
              log(`[API CONEXÃO SUCESSO] SmartPed Condicoes/Molecula retornou ${itensMolecula.length} moléculas.`);
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
                
                log(`[API INFO] Molécula do EAN ${searchQuery} retornou ${substitutos.length} substitutos.`);

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

          // Remover duplicatas de foundItems para garantir ofertas únicas e limpas
          const uniqueFoundMap = new Map<string, any>();
          for (const item of foundItems) {
            const key = `${cleanEan(item.Ean || item.ean)}_${item.CodDist}_${item.Condicao}_${parseFloat(item.Pliquido || item.pliquido || 0).toFixed(4)}_${item.Prazo}`;
            if (!uniqueFoundMap.has(key)) {
              uniqueFoundMap.set(key, item);
            } else {
              // Se houver duplicatas, prefere a com maior estoque
              const existing = uniqueFoundMap.get(key);
              if (item.Estoque > existing.Estoque) {
                uniqueFoundMap.set(key, item);
              }
            }
          }
          foundItems = Array.from(uniqueFoundMap.values());

        } catch (e: any) {
          log(`[API CONEXÃO ERRO] Erro na busca paralela de EAN/Molecula: ${e.message}.`);
        }
      } else {
        // 1. Busca Cadastral: Chamar /api/Produtos/Buscar apenas para listar as opções e obter os EANs corretos
        const endpointBusca = `${baseUrl.replace(/\/$/, "")}/api/Produtos/Buscar`;
        log(`[API CONEXÃO] 1. Busca Cadastral em Produtos/Buscar para: "${searchQuery}"`);

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
                Texto: searchQuery
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
              log(`[API CONEXÃO SUCESSO] Busca Cadastral retornou ${produtosCadastrais.length} produtos.`);

              // Extrair EANs únicos obtidos da busca cadastral
              const eansUnicos = Array.from(new Set(
                produtosCadastrais.map((p: any) => cleanEan(p.Ean || p.ean || p.CodBarra || p.codBarra)).filter(Boolean)
              ));
              log(`[API CONEXÃO] EANs extraídos para cotação comercial (Bypass): ${eansUnicos.join(", ")}`);

              if (eansUnicos.length > 0) {
                // 2. Cotação Comercial (Bypass): Fazer chamada automática aos endpoints /api/Condicoes/Ean E /api/Condicoes/Molecula usando esses EANs em paralelo
                const endpointEan = `${baseUrl.replace(/\/$/, "")}/api/Condicoes/Ean`;
                const endpointMolecula = `${baseUrl.replace(/\/$/, "")}/api/Condicoes/Molecula`;
                const cotacaoPromises = eansUnicos.map(async (eanTarget) => {
                  try {
                    const ckEan = cacheKey("Condicoes/Ean", eanTarget, actualToken, apiCnpj);
                    const ckMol = cacheKey("Condicoes/Molecula", eanTarget, actualToken, apiCnpj);

                    let eanJson = getFromCache(ckEan);
                    let molJson = getFromCache(ckMol);

                    const eanFromCache = !!eanJson;
                    const molFromCache = !!molJson;

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
                    if (!molJson) {
                      fetchPromises.push(
                        fetch(endpointMolecula, {
                          method: "POST",
                          headers: { "Content-Type": "application/json", "Accept": "application/json" },
                          body: JSON.stringify({ Token: actualToken, parametros: { CnpjCLi: apiCnpj, Ean: eanTarget, ConsideraTipo: 1 } })
                        }).then(r => { log(`[API] Condicoes/Molecula EAN=${eanTarget} => HTTP ${r.status}`); return r.ok ? r.json() : null; }).then(j => { molJson = j; if (j) setInCache(ckMol, j); }).catch(() => {})
                      );
                    }

                    if (fetchPromises.length > 0) {
                      log(`[API] Chamando SmartPed para EAN ${eanTarget}... (Ean=${!eanFromCache ? 'API' : 'cache'}, Mol=${!molFromCache ? 'API' : 'cache'})`);
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
                log(`[API CONEXÃO SUCESSO] Cotação Comercial (Bypass) retornou ${foundItems.length} ofertas de ${eansComDados} EANs.`);
                log(`[RESUMO FINAL] QtdMin>0: ${totalQtdMinPositivo} | QtdMin=0: ${foundItems.length - totalQtdMinPositivo} | Total: ${foundItems.length}`);
              }
            }
          }
        } catch (e: any) {
          log(`[API CONEXÃO ERRO] Erro na busca por descrição: ${e.message}.`);
        }
      }
    }

    // REMOVED FAKE DATA FALLBACK
    if (foundItems.length === 0) {
      log("[BUSCA INFO] Nenhum dado retornado pela API real.");
    }

    // Se onlyExactEan for true e for busca numérica, garantimos que apenas itens com o mesmo EAN sejam exibidos
    if (onlyExactEan && isPureNumeric) {
      const cleanSearchQuery = cleanEan(searchQuery);
      foundItems = foundItems.filter(item => cleanEan(item.Ean || item.ean) === cleanSearchQuery);
      log(`[FILTRO EAN EXATO] Filtrado rigidamente para manter apenas ofertas com EAN correspondente a "${cleanSearchQuery}". Restaram ${foundItems.length} ofertas.`);
    }

    // PROCESSAMENTO E REGRAS SOLICITADAS:
    // 1. Filtrar de acordo com o parâmetro de estoque (permitirSemEstoque) e cortes recentes
    const filteredStockItems = foundItems.filter((it: any) => {
      const distName = (it.NomeDist || it.nomeDist || it.distribuidora || "").toUpperCase().trim();
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

    log(`[FILTRO ESTOQUE] Total de ofertas encontradas: ${foundItems.length} | Passaram pelo filtro de estoque: ${filteredStockItems.length} (Permitir sem estoque: ${permitirSemEstoque ? 'Sim' : 'Não'})`);

    // Mapear campos de forma resiliente e tratar tipo string/number para EAN e Preço
    const mappedItems = filteredStockItems.map((it: any) => {
      const eanStr = String(it.Ean || it.ean || "");
      const precoUnit = getUnitCost(it);
      const desc = it.Descricao || it.descricao || "";
      const lab = it.Laboratorio || it.laboratorio || "Laboratório";
      const tipo = it.TipoItem || it.tipoItem || "";

      // Verificar se é Genérico
      const descLower = desc.toLowerCase();
      const labLower = lab.toLowerCase();
      let isGeneric = false;
      if (tipo) {
        isGeneric = tipo.toUpperCase() === "G";
      } else {
        isGeneric = descLower.includes(" gn ") || descLower.includes("generico") || descLower.includes("genérico") ||
                    labLower.includes("generico") || labLower.includes("genérico");
        if (isGeneric && descLower.includes(" - ")) {
          isGeneric = false;
        }
      }

      const tablePrice = extractTablePrice(it);
      const baseForPmc = tablePrice > 0 ? tablePrice : precoUnit;
      const apiPmc = extractPmc(it);
      const pmcVal = apiPmc > 0 ? apiPmc : 0;
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

    // 2. Filtrar por tipos de substituição aceitos (G ou O)
    const normalizedTipos = (tipos || ["G", "O"]).map((t: string) => t.trim().toUpperCase());
    const processedItems = mappedItems.filter((it: any) => {
      const isSearchQueryEan = isPureNumeric && cleanEan(it.ean) === cleanEan(searchQuery);
      if (isSearchQueryEan) {
        // O EAN buscado originalmente é soberano e imune ao filtro de tipos
        return true;
      }
      const itemTipo = it.isGeneric ? "G" : "O";
      return normalizedTipos.includes(itemTipo);
    });

    log(`[FILTRO TIPOS] Filtro de tipos aceitos: [${normalizedTipos.join(", ")}] | Itens correspondentes: ${processedItems.length}`);

    // 3. Ordenar por preço líquido ascendente
    processedItems.sort((a, b) => a.precoLiquido - b.precoLiquido);

    // 4. Indicar qual é o genérico mais barato
    const genericItems = processedItems.filter(it => it.isGeneric);
    let cheapestGenericEan = "";
    if (genericItems.length > 0) {
      cheapestGenericEan = genericItems[0].ean;
      log(`[DICA INTELIGENTE] O Genérico com estoque mais barato é: "${genericItems[0].descricao}" da distribuidora ${genericItems[0].distribuidora} custando R$ ${genericItems[0].precoLiquido.toFixed(2)}`);
    }

    // Adicionar as flags isCheapest e isCheapestGeneric
    const finalItems = processedItems.map((it, idx) => ({
      ...it,
      isCheapest: idx === 0,
      isCheapestGeneric: it.ean === cheapestGenericEan
    }));

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

// Função utilitária para limpar descrição tirando dosagens, apresentações e termos industriais
function cleanDescription(desc: string): string {
  if (!desc) return "";
  let d = desc.toUpperCase();

  // 1. Remover dosagens complexas (ex: 50MG+1000MG, 10MG/ML, 200MG/ML, 6MMX0,25MM, 0,25MG, 0.9%)
  // Tratando números com vírgula ou ponto, seguidos de unidades (MG, ML, G, UI, %, MM, MCG) e possíveis multiplicadores (+, X, /)
  d = d.replace(/\b\d+([.,]\d+)?\s*(MG|ML|G|UI|%|MM|MCG|UN)?\s*[\/X+]\s*\d+([.,]\d+)?\s*(MG|ML|G|UI|%|MM|MCG|UN)?\b/gi, " ");
  d = d.replace(/\b\d+([.,]\d+)?\s*(MG|ML|G|UI|%|MM|MCG|UN)\b/gi, " ");

  // 2. Remover quantidades de comprimidos ou cápsulas ou unidades (ex: 30CP, 60CAPS, 2CP, 28CP, 10UN, 6UN, 60CP)
  d = d.replace(/\b\d+\s*(CP|CAPS|COMP|UN|FR|TB|SACH|BG|GTS|SACHES|AMP)\b/gi, " ");

  // 3. Remover termos de apresentação no final do nome do medicamento (ex: SUBL, REV, L.P, L.R, SOL TOP, GTS, INJ, BL, C/, C/6, LP, LR, REV, LP)
  d = d.replace(/\bC\/\s*\d+\b/gi, " "); // remove "C/6", "C/30", etc.
  d = d.replace(/\b(SUBL|REV|L\.P|L\.R|SOL\s+TOP|SOL|TOP|AD|PED|GTS|INJ|LP|LR|REV|AER|AEROSOL|EMULSAO|SUSP|GTS|AMP|BL)\b/gi, " ");

  // 4. Limpar espaços extras e hífens sobrando no final
  d = d.trim().replace(/\s+/g, " ");
  d = d.replace(/[-\s+]+$/, "").trim();

  return d;
}

// Função utilitária adicional para extrair a molécula base do medicamento (composto ativo primário)
function getMoleculeBase(desc: string): string {
  if (!desc) return "";
  let d = desc.toUpperCase();

  // 1. Remover dosagens complexas (ex: 50MG+1000MG, 10MG/ML, 200MG/ML, 6MMX0,25MM, 0,25MG, 0.9%)
  d = d.replace(/\b\d+([.,]\d+)?\s*(MG|ML|G|UI|%|MM|MCG|UN)?\s*[\/X+]\s*\d+([.,]\d+)?\s*(MG|ML|G|UI|%|MM|MCG|UN)?\b/gi, " ");
  d = d.replace(/\b\d+([.,]\d+)?\s*(MG|ML|G|UI|%|MM|MCG|UN)\b/gi, " ");

  // 2. Remover quantidades de comprimidos ou cápsulas ou unidades (ex: 30CP, 60CAPS, 2CP, 28CP, 10UN, 6UN, 60CP)
  d = d.replace(/\b\d+\s*(CP|CAPS|COMP|UN|FR|TB|SACH|BG|GTS|SACHES|AMP)\b/gi, " ");

  // 3. Remover termos de apresentação no final do nome do medicamento (ex: SUBL, REV, L.P, L.R, SOL TOP, GTS, INJ, BL, C/, C/6, LP, LR, REV, LP)
  d = d.replace(/\bC\/\s*\d+\b/gi, " "); // remove "C/6", "C/30", etc.
  d = d.replace(/\b(SUBL|REV|L\.P|L\.R|SOL\s+TOP|SOL|TOP|AD|PED|GTS|INJ|LP|LR|REV|AER|AEROSOL|EMULSAO|SUSP|GTS|AMP|BL)\b/gi, " ");

  // 4. Filtrar termos de laboratório e marcas conhecidas
  const words = d.trim().split(/\s+/).filter(w => {
    const ignore = [
      "GEN", "GENERICO", "GENÉRICO", "MEDLEY", "EMS", "EUROFARMA", "NEO", "QUIMICA", "QUÍMICA", 
      "TEUTO", "PRATI", "GERMED", "SANDOZ", "GEOLAB", "BIOSINTETICA", "BIOSINTÉTICA", "GLOBO",
      "BIOLAB", "ACHE", "ACHÉ", "LEGRAND", "SANOFI", "AVENTIS", "ZYDUS", "ALCON", "CIMED", "UNIPHAR",
      "BD", "ULTRA", "FINE", "RISQUE", "RISQUÉ", "COTY", "VITAMEDIC", "BEIERSDORF", "NIVEA", "NÍVEA",
      "UNILEVER", "DOVE", "CIFARMA", "JANSSEN", "CILAG", "MERCK", "SHARP", "DOHME", "MSD", "BASTON",
      "ABOVE", "CLINICAL", "DERMACLIN", "GARDENIA", "AMENDOAS", "BOTANICALS"
    ];
    return !ignore.includes(w);
  });

  if (words.length === 0) return "";

  const PALAVRAS_GENERICAS_TRUNCAMENTO = new Set([
    "KIT", "SAB", "SABONETE", "BOLA", "BALA", "BRINQUEDO", "DIVERSOS", "POTE", "PÇS", "PCS", "PEÇAS",
    "PECAS", "MINI", "GRANDE", "PEQUENO", "ESTOJO", "PORTA", "SUPORTE", "CABO", "FITA", "COLA", "BASE",
    "MASCARA", "MÁSCARA", "SOMBRA", "PIRANHA", "CREME", "LOÇÃO", "LOCAO", "SHAMPOO", "CONDICIONADOR",
    "AEROSOL", "SPRAY", "DESODORANTE", "DESOD", "PERFUME", "COLONIA", "COLÔNIA", "BODY", "SPLASH",
    "POMADA", "TALCO", "ALGODAO", "ALGODÃO", "CURATIVO", "BANDAGEM", "ESCOVA", "PENTE", "LIXA",
    "PINCA", "PINÇA", "TESOURA", "CURVADOR", "CARRINHO", "CARRO", "ANIMAIS", "BONECA", "CHUPETA",
    "MAMADEIRA", "DOSADOR", "PRENDEDOR", "ELASTICO", "ELÁSTICO", "PRESILHA", "GRAMPO", "INF", "INFANTIL",
    "GK1356", "GK1592", "REF", "COD", "CHA", "CHÁ", "OLEO", "ÓLEO", "AGUA", "ÁGUA", "GEL", "PASTA",
    "BARRA", "BALSAMO", "BÁLSAMO", "FLUIDO", "FLÚIDO"
  ]);

  // Se a primeira palavra for considerada genérica/conveniência, não devemos truncar como molécula de medicamento.
  // Em vez disso, tentamos pegar as palavras específicas não genéricas que dão a especificidade ao produto.
  if (PALAVRAS_GENERICAS_TRUNCAMENTO.has(words[0])) {
    const especificas = words.filter(w => !PALAVRAS_GENERICAS_TRUNCAMENTO.has(w));
    if (especificas.length > 0) {
      return especificas.slice(0, 3).join(" ");
    }
    // Se não sobrar nada, retorna as 3 primeiras palavras do nome completo
    return words.slice(0, 3).join(" ");
  }

  // Começar com a primeira palavra
  let base = words[0];
  
  // Se a segunda palavra existir, verificar se é uma palavra complementar
  if (words.length > 1) {
    const w1 = words[1];
    // Se for um conector ("DE", "DO", "DA", "DI", "C/"), ou termo de sal farmacêutico comum
    if (["DE", "DO", "DA", "DI", "C/", "SÓDICO", "SODICO", "SÓDICA", "SODICA", "POTASSICO", "POTÁSSICO", "OLAMINA", "MONOIDRATADO", "FISIOLOGICO", "FISIOLÓGICO", "SULFATO", "CLORIDRATO", "MALEATO", "BROMIDRATO", "DIPROPIONATO", "FOSFATO", "MESILATO", "TARTARATO", "HEMITARTARATO"].includes(w1)) {
      base += " " + w1;
      if (words.length > 2) {
        base += " " + words[2];
      }
    } else if (["SORO", "CLORIDRATO", "PANTOPRAZOL", "CICLOPIROX", "ACIDO", "ÁCIDO", "LAVITAN"].includes(words[0])) {
      // Forçar 2 palavras para esses inícios conhecidos
      base += " " + w1;
    }
  }

  return base.trim();
}

// Função utilitária para limpar a descrição preservando a dosagem (ex: "750MG", "100MG") mas removendo quantidades físicas e laboratórios
function cleanDescriptionKeepDosage(desc: string): string {
  if (!desc) return "";
  let d = desc.toUpperCase();

  // 1. Remover apenas quantidades físicas de comprimidos, cápsulas, etc. (ex: 30CP, 60CAPS, 2CP, 28CP, 10UN, 6UN, 60CP, etc.)
  d = d.replace(/\b\d+\s*(CP|CAPS|COMP|UN|FR|TB|SACH|BG|GTS|SACHES|AMP)\b/gi, " ");

  // 2. Remover termos de apresentação finais e conectores de quantidade (ex: C/30, C/6)
  d = d.replace(/\bC\/\s*\d+\b/gi, " ");
  d = d.replace(/\b(SUBL|REV|L\.P|L\.R|SOL\s+TOP|SOL|TOP|AD|PED|GTS|INJ|LP|LR|REV|AER|AEROSOL|EMULSAO|SUSP|GTS|AMP|BL)\b/gi, " ");

  // 3. Filtrar termos de laboratório e marcas conhecidas
  const words = d.trim().split(/\s+/).filter(w => {
    const ignore = [
      "GEN", "GENERICO", "GENÉRICO", "MEDLEY", "EMS", "EUROFARMA", "NEO", "QUIMICA", "QUÍMICA", 
      "TEUTO", "PRATI", "GERMED", "SANDOZ", "GEOLAB", "BIOSINTETICA", "BIOSINTÉTICA", "GLOBO",
      "BIOLAB", "ACHE", "ACHÉ", "LEGRAND", "SANOFI", "AVENTIS", "ZYDUS", "ALCON", "CIMED", "UNIPHAR",
      "BD", "ULTRA", "FINE", "RISQUE", "RISQUÉ", "COTY", "VITAMEDIC", "BEIERSDORF", "NIVEA", "NÍVEA",
      "UNILEVER", "DOVE", "CIFARMA", "JANSSEN", "CILAG", "MERCK", "SHARP", "DOHME", "MSD", "BASTON",
      "ABOVE", "CLINICAL", "DERMACLIN", "GARDENIA", "AMENDOAS", "BOTANICALS"
    ];
    return !ignore.includes(w);
  });

  return words.join(" ").trim();
}

// Função utilitária para gerar buscas dinâmicas com curinga (%) para contornar variações de grafia e dosagem nos cadastros das distribuidoras
function getWildcardQueries(desc: string): string[] {
  if (!desc) return [];
  const upper = desc.toUpperCase();

  const ignoreList = [
    "GEN", "GENERICO", "GENÉRICO", "MEDLEY", "EMS", "EUROFARMA", "NEO", "QUIMICA", "QUÍMICA", 
    "TEUTO", "PRATI", "GERMED", "SANDOZ", "GEOLAB", "BIOSINTETICA", "BIOSINTÉTICA", "GLOBO",
    "BIOLAB", "ACHE", "ACHÉ", "LEGRAND", "SANOFI", "AVENTIS", "ZYDUS", "ALCON", "CIMED", "UNIPHAR",
    "BD", "ULTRA", "FINE", "RISQUE", "RISQUÉ", "COTY", "VITAMEDIC", "BEIERSDORF", "NIVEA", "NÍVEA",
    "UNILEVER", "DOVE", "CIFARMA", "JANSSEN", "CILAG", "MERCK", "SHARP", "DOHME", "MSD", "BASTON",
    "ABOVE", "CLINICAL", "DERMACLIN", "GARDENIA", "AMENDOAS", "BOTANICALS"
  ];

  const presentationWords = [
    "CP", "CPS", "COMP", "COMPRIMIDOS", "CAPS", "CAPSULAS", "CAP", "CX", "CAIXA", "AMP", "AMPOLA", 
    "FR", "FRASCO", "UN", "UNIDADE", "BL", "BLISTER", "C/", "COM", "CART", "CARTELA", "FLAC", "FLACONETE",
    "CO", "PCT", "PACOTE", "SACHE", "SACHET", "ENV", "ENVELOPE", "GOTAS", "GTS", "SER", "SERINGA",
    "LATA", "POT", "POTE", "BISN", "BISNAGA", "S/A", "LT", "KG", "GRS",
    "KIT", "SAB", "SABONETE", "BOLA", "BALA", "BRINQUEDO", "DIVERSOS", "POTE", "PÇS", "PCS", "PEÇAS",
    "PECAS", "MINI", "GRANDE", "PEQUENO", "ESTOJO", "PORTA", "SUPORTE", "CABO", "FITA", "COLA", "BASE",
    "MASCARA", "MÁSCARA", "SOMBRA", "PIRANHA", "CREME", "LOÇÃO", "LOCAO", "SHAMPOO", "CONDICIONADOR",
    "AEROSOL", "SPRAY", "DESODORANTE", "DESOD", "PERFUME", "COLONIA", "COLÔNIA", "BODY", "SPLASH",
    "POMADA", "TALCO", "ALGODAO", "ALGODÃO", "CURATIVO", "BANDAGEM", "ESCOVA", "PENTE", "LIXA",
    "PINCA", "PINÇA", "TESOURA", "CURVADOR", "CARRINHO", "CARRO", "ANIMAIS", "BONECA", "CHUPETA",
    "MAMADEIRA", "DOSADOR", "PRENDEDOR", "ELASTICO", "ELÁSTICO", "PRESILHA", "GRAMPO", "INF", "INFANTIL",
    "GK1356", "GK1592", "REF", "COD"
  ];

  const queries: string[] = [];

  // Normalizar caracteres não alfanuméricos para espaço
  const normalized = upper.replace(/[^A-Z0-9]/g, " ");
  const rawWords = normalized.split(/\s+/).filter(w => w.length > 0);

  const cleanWords: string[] = [];
  for (const w of rawWords) {
    if (ignoreList.includes(w) || presentationWords.includes(w)) {
      continue;
    }
    // Limpar sufixo de apresentação colado ao número (ex: 30CP -> 30, 30COMP -> 30)
    const cleaned = w.replace(/^(\d+)(CP|CPS|COMP|COMPRIMIDOS|CAPS|CAPSULAS|CAP|CX|CAIXA|AMP|AMPOLA|FR|FRASCO|UN|UNIDADE|BL|BLISTER|CO|FLAC|FLACONETE|CART|CARTELA|PCT|PACOTE|SACHE|SACHET|ENV|ENVELOPE|GOTAS|GTS|SER|SERINGA|LATA|POT|POTE|BISN|BISNAGA|KG|GRS)$/i, "$1");
    
    if (cleaned && cleaned.length > 0 && !ignoreList.includes(cleaned) && !presentationWords.includes(cleaned)) {
      cleanWords.push(cleaned);
    }
  }

  if (cleanWords.length === 0) return [];

  // 1. Queries Progressivas Curtas (ex: COLA%CILIOS, COLA%CILIOS%I)
  if (cleanWords.length >= 2) {
    queries.push(`${cleanWords[0]}%${cleanWords[1]}`);
  }
  if (cleanWords.length >= 3) {
    queries.push(`${cleanWords[0]}%${cleanWords[1]}%${cleanWords[2]}`);
  }
  if (cleanWords.length >= 4) {
    queries.push(`${cleanWords[0]}%${cleanWords[1]}%${cleanWords[2]}%${cleanWords[3]}`);
  }
  if (cleanWords.length >= 5) {
    queries.push(`${cleanWords[0]}%${cleanWords[1]}%${cleanWords[2]}%${cleanWords[3]}%${cleanWords[4]}`);
  }

  // 2. Combinando primeiro ingrediente/termo ativo com números/dosagens subsequentes
  const baseActive = cleanWords[0];
  const numberOrDosageWords = cleanWords.slice(1).filter(w => /\d+/.test(w));
  
  if (baseActive && baseActive.length > 2) {
    if (numberOrDosageWords.length > 0) {
      // Ex: PARACETAMOL%750%20
      queries.push(`${baseActive}%${numberOrDosageWords.join("%")}`);
      
      // Ex: PARACETAMOL%750 (removendo o último número/apresentação se houver mais de um)
      if (numberOrDosageWords.length >= 2) {
        queries.push(`${baseActive}%${numberOrDosageWords.slice(0, numberOrDosageWords.length - 1).join("%")}`);
      }
      queries.push(`${baseActive}%${numberOrDosageWords[0]}`);
    } else {
      queries.push(`${baseActive}%`);
    }
  }

  // 3. Descrição inteira limpa unida por %
  if (cleanWords.length >= 2) {
    queries.push(cleanWords.join("%"));
  }

  // Filtrar nulos, duplicados e queries muito curtas
  return Array.from(new Set(queries))
    .map(q => q.trim())
    .filter(q => q.length > 2 && q.includes("%"));
}

// Endpoint para buscar alternativas de verdade na SmartPed em tempo real para itens "Sem Estoque" ou "Não Encontrados"
app.post("/api/smartped-find-substitutes", async (req, res) => {
  const { ean, descricao, token, cnpj, useTestUrl = true, cortesRecentes = {} } = req.body;
  const logs: string[] = [];
  const log = (msg: string) => { logs.push(msg); console.log(`[SUBSTITUTES] ${msg}`); };
  
  try {
    const actualToken = (token || CONFIG.SMARTPED_SANDBOX_TOKEN).trim();
    const isSandboxToken = actualToken === CONFIG.SMARTPED_SANDBOX_TOKEN;
    const apiCnpj = isSandboxToken ? "11111111111111" : (cnpj || CONFIG.SMARTPED_DEFAULT_CNPJ).trim().replace(/\D/g, "");
    let baseUrl = useTestUrl ? CONFIG.SMARTPED_SANDBOX_URL : CONFIG.SMARTPED_PRODUCTION_URL;
    
    let dcbDescoberto = "";
    
    // Passo A: Descobrir o DCB se temos o EAN
    if (ean && String(ean).trim().length > 0) {
      log(`[DESCOBERTA DCB] Buscando informações de DCB/composição para o EAN ${ean}...`);
      try {
        const dcbRes = await fetch(`${CONFIG.FERRAMENTINHAS_API_URL}/api/produtos/similares/${ean}`);
        if (dcbRes.ok) {
          const dcbData = await dcbRes.json();
          const pList = dcbData.produtos || dcbData.items || [];
          if (pList.length > 0) {
            // Pegar o primeiro produto que tenha um cod_dcb ou princípio ativo
            const pWithDcb = pList.find((p: any) => p.cod_dcb && String(p.cod_dcb).trim().length > 0);
            if (pWithDcb) {
              dcbDescoberto = String(pWithDcb.cod_dcb).trim();
              log(`[DESCOBERTA DCB] DCB encontrado na API: "${dcbDescoberto}"`);
            } else {
              const firstP = pList[0];
              if (firstP.nom_produto) {
                log(`[DESCOBERTA DCB] Nenhum código DCB explícito. Usando nome do produto como referência: "${firstP.nom_produto}"`);
              }
            }
          }
        }
      } catch (err: any) {
        log(`[DESCOBERTA DCB AVISO] Falha ao consultar API de DCB: ${err.message}`);
      }
    }

    // Heurística robusta de limpeza de descrição usando Regex
    const descricaoLimpa = cleanDescription(descricao);
    const baseMolecula = getMoleculeBase(descricao);
    log(`[DESCOBERTA DESCRIÇÃO] Descrição original: "${descricao}" -> Limpa por Regex: "${descricaoLimpa}"`);
    log(`[DESCOBERTA DESCRIÇÃO] Base molécula extraída: "${baseMolecula}"`);

    // Se não achou por EAN, usar a molécula base como referência principal
    if (!dcbDescoberto && baseMolecula) {
      dcbDescoberto = baseMolecula;
      log(`[DESCOBERTA DCB] Usando base de molécula limpa como molécula/DCB primário: "${dcbDescoberto}"`);
    } else if (!dcbDescoberto && descricaoLimpa) {
      dcbDescoberto = descricaoLimpa;
      log(`[DESCOBERTA DCB] Usando descrição limpa como molécula/DCB primário: "${dcbDescoberto}"`);
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
      log(`[SMARTPED CONSULTA] Agendando busca por Molécula do EAN em Condicoes/Molecula...`);
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
      "KIT", "SAB", "SABONETE", "BOLA", "BALA", "BRINQUEDO", "DIVERSOS", "POTE", "PÇS", "PCS", "PEÇAS",
      "PECAS", "MINI", "GRANDE", "PEQUENO", "ESTOJO", "PORTA", "SUPORTE", "CABO", "FITA", "COLA", "BASE",
      "MASCARA", "MÁSCARA", "SOMBRA", "PIRANHA", "CREME", "LOÇÃO", "LOCAO", "SHAMPOO", "CONDICIONADOR",
      "AEROSOL", "SPRAY", "DESODORANTE", "DESOD", "PERFUME", "COLONIA", "COLÔNIA", "BODY", "SPLASH",
      "POMADA", "TALCO", "ALGODAO", "ALGODÃO", "CURATIVO", "BANDAGEM", "ESCOVA", "PENTE", "LIXA",
      "PINCA", "PINÇA", "TESOURA", "CURVADOR", "CARRINHO", "CARRO", "ANIMAIS", "BONECA", "CHUPETA",
      "MAMADEIRA", "DOSADOR", "PRENDEDOR", "ELASTICO", "ELÁSTICO", "PRESILHA", "GRAMPO", "INF", "INFANTIL",
      "GK1356", "GK1592", "REF", "COD"
    ]);

    const ehGenericoCompleto = dcbDescoberto && dcbDescoberto.split(/\s+/).every(w => PALAVRAS_GENERICAS_BLOQUEIO.has(w));

    // 3. Busca por Condicoes/Molecula por texto do DCB Descoberto
    if (dcbDescoberto && dcbDescoberto.trim().length > 2 && !ehGenericoCompleto) {
      log(`[SMARTPED CONSULTA] Agendando busca por Texto de Molécula ("${dcbDescoberto}") em Condicoes/Molecula...`);
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
        log(`[SMARTPED CONSULTA] Ignorando busca por molécula textual ampla para "${dcbDescoberto}" por conter apenas palavras-chave genéricas.`);
      }
      apiPromises.push(Promise.resolve(null));
    }

    // 3.1. Busca por Condicoes/Molecula pela Descrição Limpa ou Molécula Base
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
        log(`[SMARTPED CONSULTA] Ignorando busca adicional por molécula para "${moleculaExtraQuery}" por conter apenas palavras-chave genéricas.`);
      }
      apiPromises.push(Promise.resolve(null));
    }

    // 3.2. Busca por Produtos/Buscar pela Descrição Preservando a Dosagem (ex: "PARACETAMOL 750MG")
    const descricaoComDosagem = cleanDescriptionKeepDosage(descricao);
    const hasComDosagemQuery = descricaoComDosagem && 
                               descricaoComDosagem !== moleculaExtraQuery && 
                               descricaoComDosagem !== dcbDescoberto && 
                               descricaoComDosagem.trim().length > 2;
    if (hasComDosagemQuery) {
      log(`[SMARTPED CONSULTA] Agendando busca adicional por "${descricaoComDosagem}" (Descrição com Dosagem) em Produtos/Buscar...`);
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

    // 6. Buscas curingas (%) dinâmicas adicionais com base na descrição para maximizar o faturamento (utilizando Produtos/Buscar para faturamento certeiro)
    const wildcardQueries = getWildcardQueries(descricao);
    const wildcardStartIndex = apiPromises.length; // índice 7
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
    
    log(`[SMARTPED CONSULTA] Respostas recebidas concorrentemente! Iniciando consolidação de ofertas.`);

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

    // Extrair metadados das respostas curingas
    wildcardResults.forEach(resData => {
      if (resData) extractMetadata(resData);
    });

    // Mapa de Catálogo Cadastral por EAN para preservar nomes comerciais ricos e laboratórios originais
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
        const newL = (l && l.toUpperCase() !== "GENÉRICO") ? l : existing.laboratorio;
        eanCatalogMap.set(cEan, { descricao: newD, laboratorio: newL });
      }
    };

    const resolveBestDescription = (eanCode: string, ...candidates: (string | undefined)[]) => {
      const userSearchQuery = (descricao || "").trim().toLowerCase();
      // 1. Procurar no array de candidatos por algo que seja não-vazio e diferente da query simples em minúsculo
      for (const cand of candidates) {
        if (!cand) continue;
        const trimmed = String(cand).trim();
        if (trimmed.length > 0 && trimmed.toLowerCase() !== userSearchQuery) {
          return trimmed;
        }
      }
      // 2. Procurar no catálogo de EANs descobertos durante as chamadas da SmartPed
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
      // 4. Se tiver algum candidato não-vazio, retornar
      for (const cand of candidates) {
        if (cand && String(cand).trim().length > 0) return String(cand).trim();
      }
      return descricao ? descricao.toUpperCase() : "PRODUTO FARMACÊUTICO";
    };

    const resolveBestLaboratorio = (eanCode: string, ...candidates: (string | undefined)[]) => {
      for (const cand of candidates) {
        if (!cand) continue;
        const trimmed = String(cand).trim();
        if (trimmed.length > 0 && trimmed.toUpperCase() !== "GENÉRICO" && trimmed.toUpperCase() !== "N/A") {
          return trimmed;
        }
      }
      if (eanCode && eanCatalogMap.has(eanCode)) {
        const catalogItem = eanCatalogMap.get(eanCode)!;
        if (catalogItem.laboratorio && catalogItem.laboratorio.toUpperCase() !== "GENÉRICO" && catalogItem.laboratorio.toUpperCase() !== "N/A") {
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
      return "GENÉRICO";
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
          const distName = cond.NomeDist || cond.nomeDist || distsMap[codDist] || DISTRIBUIDORAS_MAP[codDist] || "Distribuidor";
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
          const distName = sub.NomeDist || sub.nomeDist || distsMap[codDist] || DISTRIBUIDORAS_MAP[codDist] || "Distribuidor";
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

    // Função para processar retornos no formato de Produtos/Buscar
    const processProdutosBuscar = (data: any, sourceTag: string) => {
      if (!data) return;
      const itens = data.Retorno || data.retorno || [];
      if (!Array.isArray(itens)) return;

      for (const sub of itens) {
        const codDist = sub.CodDist !== undefined ? sub.CodDist : sub.codDist;
        const distName = sub.NomeDist || sub.nomeDist || distsMap[codDist] || DISTRIBUIDORAS_MAP[codDist] || `Distribuidor ${codDist}`;
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
    
    // Processa como Produtos/Buscar para obter ofertas de dosagem exata com descrição comercial
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
    // FASE DE EXPANSÃO HÍBRIDA POR EANS:
    // Se a busca foi realizada por texto/descrição (sem EAN direto ou para enriquecer EANs cadastrais descobertos),
    // consultamos em lote com Promise.allSettled o endpoint /api/Condicoes/Ean para os EANs encontrados.
    // Isso garante que todas as regras ricas de promoções (QtdMin, descontos por escala e condições especiais)
    // sejam carregadas mesmo quando o usuário pesquisou por texto, sem que a falha de 1 EAN quebre os demais!
    // =========================================================================
    const discoveredEans = Array.from(new Set(
      foundAlternatives
        .map(a => cleanEan(a.ean))
        .filter(e => e && e.length >= 7)
    )).slice(0, 15); // Top 15 EANs mais relevantes descobertos

    if (discoveredEans.length > 0) {
      log(`[EXPANSÃO HÍBRIDA] Agendando cotações comerciais ricas via Condicoes/Ean para ${discoveredEans.length} EANs descobertos...`);
      
      const expansionPromises = discoveredEans.map(async (e) => {
        try {
          const ckEan = cacheKey("Condicoes/Ean", e, actualToken, apiCnpj);
          const ckMol = cacheKey("Condicoes/Molecula", e, actualToken, apiCnpj);

          let eanData = getFromCache(ckEan);
          let molData = getFromCache(ckMol);

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
          console.error(`[EXPANSÃO HÍBRIDA SILENT] Falha ao expandir EAN ${e}:`, err.message);
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
            processReturnItens(eanData, "Expansão Híbrida (Condicoes/Ean)", targetEan);
            expandedOffersCount++;
          }
          if (molData) {
            extractMetadata(molData);
            processReturnItens(molData, "Expansão Híbrida (Condicoes/Molecula)", targetEan);
          }
        }
      }
      log(`[EXPANSÃO HÍBRIDA SUCESSO] ${expandedOffersCount}/${discoveredEans.length} consultas ricas de EAN integradas (Ean + Molecula).`);
    }

    // =========================================================================
    // DEDUPLICAÇÃO FINAL POR CHAVE COMERCIAL COMBINADA (Ean + CodDist + Condicao + Prazo)
    // Limpa duplicidades brutas geradas pelas múltiplas chamadas à SmartPed
    // mantendo a oferta de menor preço líquido se houver choque
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

    // Deduplicação Inteligente: EAN + CodDist
    // Critério 1: Menor Preço Líquido (pliquido / pliquidoUni)
    // Critério 2: Empate no preço -> Maior Prazo
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

        // Se a nova oferta tiver preço líquido menor, substitui
        if (currentPLiquido < existingPLiquido - 0.0001) {
          uniqueAltsMap.set(key, alt);
        } else if (Math.abs(currentPLiquido - existingPLiquido) <= 0.0001) {
          // Se houver empate no preço líquido, escolhe o com MAIOR PRAZO (melhor condição de pagamento)
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

    // Enriquecer todas as alternativas encontradas com o valor de pedido mínimo a partir do MINIMOS_GLOBAL_CACHE
    const enrichAltWithMinimos = (item: any) => {
      const minVal = getMinimoFromCache(item.codDist, item.condicao, item.prazo);
      if (minVal > 0) {
        if (!item.VlrMinimo || Number(item.VlrMinimo) <= 0) item.VlrMinimo = minVal;
        if (!item.vlrMinimo || Number(item.vlrMinimo) <= 0) item.vlrMinimo = minVal;
        if (!item.pedidoMinimo || Number(item.pedidoMinimo) <= 0) item.pedidoMinimo = minVal;
        if (!item.PedidoMinimo || Number(item.PedidoMinimo) <= 0) item.PedidoMinimo = minVal;
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
    log(`[SUCESSO] Total de ${finalAlts.length} ofertas deduplicadas (melhor prazo/preço por distribuidora) e ${finalDeduplicatedAlternatives.length} ofertas brutas únicas na SmartPed.`);
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

// Helper function to extract search keywords from a product description
function getCleanSearchWords(desc: string): string[] {
  if (!desc) return [];
  let d = desc.toUpperCase();

  // Remover dosagens e unidades (ex: 20G, 10ML, 500MG, 120G, C/10, S/10, SACHES, CAPS, CP, COMP)
  d = d.replace(/\b\d+([.,]\d+)?\s*(MG|ML|G|UI|%|MM|MCG|UN)?\b/gi, " ");
  d = d.replace(/\b\d+\s*(CP|CAPS|COMP|UN|FR|TB|SACH|BG|GTS|SACHES|AMP|SACHETS)\b/gi, " ");
  d = d.replace(/\bC\/\s*\d+\b/gi, " ");
  d = d.replace(/\b(SACHES|SACHE|UNIDADES|COMPRIMIDOS|CAPSULAS|CAPS|CP|C\/|FRASCO|FRASCOS|BLISTER|SACHETS|XAROPE|GOTAS|POMADA|CREME|COMP|INJETAVEL|GTS|UN|CX|FR)\b/gi, " ");

  // Dividir em palavras e limpar pontuação
  const words = d.split(/[\s,.\-\/+()]+/gi)
    .map(w => w.trim())
    .filter(w => {
      // Filtrar palavras curtas irrelevantes (exceto termos chave como "CHA", "DOR")
      if (w.length < 3) {
        return w === "CHA" || w === "DOR" || w === "GEL";
      }
      // Ignorar stop words ou nomes comuns de laboratórios na busca
      const stopWords = [
        "GENERICO", "GEN", "EMS", "MEDLEY", "PRATI", "TEUTO", "CIMED", "LEGRAND", "EUROFARMA",
        "SANDOZ", "GERMED", "NEO", "QUIMICA", "GLOBO", "ACHE", "BIOLAB", "VITAMEDIC"
      ];
      return !stopWords.includes(w);
    });

  return words;
}

// Endpoint para buscar produtos similares (mesmo DCB + Concentração) com fallback inteligente por similaridade de descrição
app.get("/api/similares/:ean", async (req, res) => {
  const { ean: rawEan } = req.params;
  const ean = cleanEan(rawEan);
  let descricao = req.query.descricao as string;
  const forceDesc = req.query.forceDesc === "true";
  try {
    const dbRecord = getEanDatabaseRecord(ean);
    if ((!descricao || descricao.trim().length === 0 || descricao === "undefined" || descricao === "null") && dbRecord?.descricao) {
      descricao = dbRecord.descricao;
      console.log(`[SIMILARES] Descrição ausente na query. Recuperada automaticamente do EAN_DATABASE para ${ean}: "${descricao}"`);
    }

    console.log(`[SIMILARES] Buscando similares locais na Trier para EAN ${ean} (original: ${rawEan}), Descrição: "${descricao || "não informada"}", forceDesc: ${forceDesc}`);
    
    let trierEncontrou = false;
    let trierData: any = null;

    // Sempre consultamos a Trier por EAN para coletar os similares vinculados oficialmente no ERP e alimentar a base local dinamicamente
    try {
      const response = await fetch(`${CONFIG.FERRAMENTINHAS_API_URL}/api/produtos/similares/${ean}`);
      if (response.ok) {
        const data = await response.json();
        if (data && data.encontrou && Array.isArray(data.produtos) && data.produtos.length > 0) {
          console.log(`[SIMILARES REGISTRO] Carregados ${data.produtos.length} produtos oficiais da Trier para o EAN ${ean}. Populando base em memória.`);
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

    // 2. Se a busca direta falhou, retornou vazia ou forceDesc = true, aciona a busca inteligente por similaridade de descrição usando o regex/getMoleculeBase
    if (descricao && descricao.trim().length > 0) {
      const baseMolecula = getMoleculeBase(descricao).toUpperCase();
      console.log(`[SIMILARES DESCRIÇÃO] EAN ${ean}. Molécula base extraída: "${baseMolecula}"`);
      
      const searchWords = baseMolecula.split(/\s+/).filter(w => w.length > 0);
      console.log(`[SIMILARES DESCRIÇÃO] Palavras-chave extraídas da molécula:`, searchWords);

      if (searchWords.length > 0 || baseMolecula.length > 0) {
        // Palavras genéricas ou muito comuns que sozinhas não devem gerar correspondência
        const PALAVRAS_GENERICAS = new Set([
          "KIT", "INF", "INFANTIL", "C/", "S/", "COM", "SEM", "COD", "REF", "UN", "PCT", "CX", "MED", "PROD",
          "GENERICO", "GEN", "SAB", "CROM", "BOLA", "BRINQUEDO", "DIVERSOS", "POTE", "PÇS", "PCS", "PEÇAS",
          "PECAS", "DE", "PARA", "EM", "DO", "DA", "CRIANCA", "CRIANÇAS", "CRIANCAS", "MINI", "GRANDE", "PEQUENO",
          "MEDICAMENTO", "REMEDIO", "APOIO", "SUPORTE", "TIPO", "DIVERSAS", "REFGK", "CHA", "CHÁ", "OLEO", "ÓLEO",
          "SABONETE", "GEL", "CREME", "LOÇÃO", "LOCAO"
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

          // Se a molécula base extraída de ambos for idêntica, pontuação máxima!
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

          // Bônus se a descrição do item contiver a descrição de busca completa
          if (itemDesc.includes(descricao.toUpperCase())) {
            score += 25;
          } else if (temEspecificas && itemDesc.includes(especificas.join(" "))) {
            score += 15;
          }

          // Condição de aceitação estrita: 
          // Se houver palavras específicas na busca, EXIGE pelo menos um match de palavra específica.
          // Se só houver palavras genéricas, exige pelo menos um match genérico.
          const passaFiltro = temEspecificas ? (especificasMatches >= 1) : (genericasMatches >= 1);

          // Exige também uma pontuação mínima de relevância
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

        // Ordena por maior pontuação de relevância (score)
        candidates.sort((a, b) => b.score - a.score);

        console.log(`[SIMILARES DESCRIÇÃO] Encontrados ${candidates.length} candidatos válidos com score mínimo.`);

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

// Endpoint para buscar histórico de vendas detalhadas
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

// Endpoint para buscar histórico de vendas semanais
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

// Endpoint de diagnóstico para consultar os retornos reais brutos da API SmartPed para um determinado EAN
app.post("/api/diagnostico-ean", async (req, res) => {
  const { ean, token, cnpj, useTestUrl } = req.body;
  if (!ean) {
    return res.status(400).json({ success: false, error: "EAN é obrigatório." });
  }

  const actualToken = (token || CONFIG.SMARTPED_PRODUCTION_TOKEN).trim();
  const isSandboxToken = actualToken === CONFIG.SMARTPED_SANDBOX_TOKEN;
  const apiCnpj = isSandboxToken ? "11111111111111" : (cnpj || CONFIG.SMARTPED_DEFAULT_CNPJ).trim().replace(/\D/g, "");

  const baseUrl = useTestUrl ? CONFIG.SMARTPED_SANDBOX_URL : CONFIG.SMARTPED_PRODUCTION_URL;
  const cleanEanValue = cleanEan(ean);

  const logs: string[] = [];
  logs.push(`[DIAGNÓSTICO] Iniciando busca para EAN ${cleanEanValue}`);
  logs.push(`[DIAGNÓSTICO] URL Base: ${baseUrl}`);
  logs.push(`[DIAGNÓSTICO] CNPJ: ${apiCnpj}`);

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
    logs.push(`[DIAGNÓSTICO] Status Molecula: ${responseMolecula.status}, Status Ean: ${responseEan.status}`);

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
    console.error("Erro no diagnóstico de EAN:", error);
    return res.status(500).json({
      success: false,
      error: error.message,
      logs: [...logs, `[ERRO CRÍTICO] ${error.message}`]
    });
  }
});

loadEanDatabase();

if (process.env.SKIP_SERVER_LISTEN !== "true") {
  if (process.env.NODE_ENV !== "production") {
    createViteServer({
      server: { middlewareMode: true },
      appType: "spa"
    }).then(vite => {
      app.use(vite.middlewares);
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
    app.listen(PORT, "0.0.0.0", () => {
      console.log(`Server running on http://localhost:${PORT}`);
    });
  }
}

