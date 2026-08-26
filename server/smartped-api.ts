import { cleanEan } from "./ean-utils";
import { CONFIG } from "./config";

export async function fetchEanDescriptions(baseUrl: string, token: string, apiCnpj: string, eans: string[], logs: string[]): Promise<Record<string, { Descricao: string, Laboratorio: string }>> {
  if (!eans || eans.length === 0) return {};
  const eansToFetch = Array.from(new Set(eans.map(e => cleanEan(e)))).filter(Boolean);
  const result: Record<string, { Descricao: string, Laboratorio: string }> = {};

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

export async function fetchSimilarGenerics(ean: string): Promise<any[]> {
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

export async function fetchSimilarGenericsBatch(eans: string[]): Promise<Record<string, any[]>> {
  const result: Record<string, any[]> = {};
  const MAX_BATCH = 40;

  const uniqueEans = Array.from(new Set(eans.filter(e => e && e.trim()))).map(e => cleanEan(e)).filter(Boolean);
  if (uniqueEans.length === 0) return result;

  const lotes: string[][] = [];
  for (let i = 0; i < uniqueEans.length; i += MAX_BATCH) {
    lotes.push(uniqueEans.slice(i, i + MAX_BATCH));
  }

  await Promise.all(lotes.map(async (lote) => {
    try {
      const response = await fetch(`${CONFIG.FERRAMENTINHAS_API_URL}/api/produtos/similares/batch`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ eans: lote }),
        signal: AbortSignal.timeout(30000)
      });
      if (!response.ok) {
        console.error(`Batch similares falhou: HTTP ${response.status}`);
        for (const ean of lote) result[ean] = [];
        return;
      }
      const data = await response.json();
      for (const ean of lote) {
        const eanData = data[ean];
        if (eanData && eanData.success && eanData.encontrou) {
          result[ean] = eanData.produtos || [];
        } else {
          result[ean] = [];
        }
      }
    } catch (error) {
      console.error(`Erro no batch de similares:`, error);
      for (const ean of lote) {
        result[ean] = [];
      }
    }
  }));

  return result;
}
