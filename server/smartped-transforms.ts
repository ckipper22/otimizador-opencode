import { cleanEan, getEanDatabaseRecord } from "./ean-utils";
import { FATURAMENTO_ITEMS_CACHE } from "./cache";

export function enrichReturnedItem(
  it: any,
  numPedido: string,
  descMap: Record<string, { Descricao: string, Laboratorio: string }> = {}
) {
  let rawEanStr = String(it.Ean || it.ean || it.EAN || it.CodBarra || it.codBarra || it.CodBarras || it.codBarras || "").trim();
  let descSmart = String(it.Descricao || it.descricao || it.Nome || it.nome || it.Descr || it.descr || "").trim();
  const codDistNum = typeof it.CodDist === "number" ? it.CodDist : parseInt(it.CodDist) || 2;
  const codProdDistStr = String(it.CodProdutoDist || it.codProdutoDist || "0").trim();
  const codProdutoStr = String(it.CodProduto || it.codProduto || "0").trim();

  if ((!rawEanStr || rawEanStr === "0" || !descSmart || descSmart.includes("sem identificação") || descSmart.toLowerCase() === "null") && numPedido) {
    const cacheKeyValue = `${numPedido}_${codDistNum}_${codProdDistStr}`;
    const cached = FATURAMENTO_ITEMS_CACHE[cacheKeyValue];
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
