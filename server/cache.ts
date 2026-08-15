const SMARTPED_CACHE_TTL_MS = 5 * 60 * 1000;
const smartpedCache = new Map<string, { data: any; ts: number }>();

export function cacheKey(endpoint: string, ean: string, token: string, cnpj: string): string {
  return `${endpoint}|${ean}|${token}|${cnpj}`;
}

export function getFromCache(key: string): any | null {
  const entry = smartpedCache.get(key);
  if (!entry) return null;
  if (Date.now() - entry.ts > SMARTPED_CACHE_TTL_MS) {
    smartpedCache.delete(key);
    return null;
  }
  return entry.data;
}

export function setInCache(key: string, data: any): void {
  if (smartpedCache.size > 2000) {
    const oldest = smartpedCache.keys().next().value;
    if (oldest) smartpedCache.delete(oldest);
  }
  smartpedCache.set(key, { data, ts: Date.now() });
}

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

    const existing = MINIMOS_GLOBAL_CACHE.find(
      m => m.CodDist === codDist && m.Condicao === condicao && m.Prazo === prazo
    );

    if (existing) {
      existing.VlrMinimo = vlrMinimo;
      existing.QtdMinima = qtdMinima;
    } else {
      MINIMOS_GLOBAL_CACHE.push({ CodDist: codDist, Condicao: condicao, Prazo: prazo, VlrMinimo: vlrMinimo, QtdMinima: qtdMinima });
    }
  });
}

export function getMinimoFromCache(codDist: number, condicao: string, prazo: number): { VlrMinimo: number; QtdMinima: number } | null {
  const normalizedCondicao = String(condicao || "").trim().toUpperCase();
  const entry = MINIMOS_GLOBAL_CACHE.find(
    m => m.CodDist === codDist && m.Condicao === normalizedCondicao && m.Prazo === prazo
  );
  if (entry) {
    return { VlrMinimo: entry.VlrMinimo, QtdMinima: entry.QtdMinima };
  }
  return null;
}

export const DYNAMIC_EANS_CACHE: Record<string, any[]> = {};
export const FATURAMENTO_ITEMS_CACHE: Record<string, { ean: string, descricao: string, laboratorio: string }> = {};
export const SIMULATED_CHECKS: Record<string, number> = {};

const CACHE_TTL_MS = 2 * 60 * 60 * 1000;
export function startCachePurgeInterval(
  EAN_DATABASE: Record<string, any>,
  MINIMOS_CACHE_REF: { length: number; length_assign?: number }
) {
  setInterval(() => {
    const eanCount = Object.keys(EAN_DATABASE).length;
    const minimosCount = MINIMOS_GLOBAL_CACHE.length;
    const dynamicCount = Object.keys(DYNAMIC_EANS_CACHE).length;
    const fatCount = Object.keys(FATURAMENTO_ITEMS_CACHE).length;

    for (const key of Object.keys(DYNAMIC_EANS_CACHE)) delete DYNAMIC_EANS_CACHE[key];
    for (const key of Object.keys(FATURAMENTO_ITEMS_CACHE)) delete FATURAMENTO_ITEMS_CACHE[key];
    for (const key of Object.keys(SIMULATED_CHECKS)) delete SIMULATED_CHECKS[key];

    if (eanCount > 50000) {
      for (const key of Object.keys(EAN_DATABASE)) delete EAN_DATABASE[key];
      console.log(`[CACHE PURGE] EAN_DATABASE limpo (${eanCount} registros).`);
    }

    if (minimosCount > 5000) {
      MINIMOS_GLOBAL_CACHE.length = 0;
      console.log(`[CACHE PURGE] MINIMOS_GLOBAL_CACHE limpo (${minimosCount} registros).`);
    }

    console.log(`[CACHE PURGE] DYNAMIC_EANS: ${dynamicCount}→0, FATURAMENTO: ${fatCount}→0, SIMULATED: limpo.`);
  }, CACHE_TTL_MS);
}
