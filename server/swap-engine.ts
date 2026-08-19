import { cleanEan, normalizeDistName } from "./ean-utils";
import { getUnitCost, isRealOffer } from "./parsers";
import { validateSwapEquivalence } from "../swap-validation";

export function findBestSubstitute(
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
  let precoOriginal = (fallbackOriginalPrice !== undefined && fallbackOriginalPrice > 0)
    ? fallbackOriginalPrice
    : getUnitCost(itemPedido);

  if (precoOriginal <= 0) return null;

  const requestedQty = parseFloat(String(itemPedido?.qtd || itemPedido?.Qtd || 1).replace(",", ".")) || 1;
  const origEan = cleanEan(itemPedido.Ean || itemPedido.ean || "");

  const candidatos = (substitutos || []).filter((s) => {
    const sEan = cleanEan(s.Ean || s.ean || "");
    const isOriginalEan = sEan === origEan;

    const distNameClean = normalizeDistName(s.NomeDist || s.nomeDist || s.distribuidora || "");
    const blockedDistsForEan = cortesRecentes[sEan] || [];
    if (blockedDistsForEan.includes(distNameClean)) {
      return false;
    }

    if (!isOriginalEan) {
      const tipoItem = s.TipoItem || s.tipoItem || "";
      const tipoItemUpper = tipoItem.toUpperCase();
      if (tipoItemUpper && !tiposAceitos.has(tipoItemUpper) && originalHasStock) {
        return false;
      }
    }

    const estoque = parseInt(String(s.Estoque !== undefined ? s.Estoque : (s.estoque !== undefined ? s.estoque : 0)), 10) || 0;
    if (exigirEstoque && estoque <= 0) {
      return false;
    }

    if (getUnitCost(s) <= 0) {
      return false;
    }

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

      if (originalHasStock) {
        if (isGeneric && !isCandidateGeneric) {
          return false;
        }
        if (!isGeneric && isCandidateGeneric) {
          return false;
        }
      }
    }

    if (!validateSwapEquivalence(itemPedido, s)) {
      return false;
    }

    return true;
  });

  if (candidatos.length === 0) {
    return null;
  }

  let candidatosOriginais = candidatos.filter(c => cleanEan(c.Ean || c.ean || "") === origEan);
  let candidatosSubstitutos = candidatos.filter(c => cleanEan(c.Ean || c.ean || "") !== origEan).filter(s => {
    if (isRealOffer(s)) {
      const estoque = parseInt(String(s.Estoque !== undefined ? s.Estoque : (s.estoque !== undefined ? s.estoque : 0)), 10) || 0;
      return estoque > 0;
    }
    return false;
  });

  const temOriginalReal = candidatosOriginais.some(c => isRealOffer(c));
  if (temOriginalReal) {
    candidatosOriginais = candidatosOriginais.filter(c => isRealOffer(c));
  }

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
    // Sempre filtrar para ofertas reais — nunca escolher "Não Encontrados" como original
    const originaisReais = candidatosOriginais.filter(c => isRealOffer(c));
    melhorOriginal = originaisReais.length > 0 ? originaisReais[0] : null;
  }

  const originalTemEstoqueReal = (substitutos || []).some(s => {
    const sEan = cleanEan(s.Ean || s.ean || "");
    if (sEan !== origEan) return false;
    if (!isRealOffer(s)) return false;
    const estoque = parseInt(String(s.Estoque !== undefined ? s.Estoque : (s.estoque !== undefined ? s.estoque : 0)), 10) || 0;
    const preco = getUnitCost(s);
    return estoque > 0 && preco > 0;
  });

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

  if (melhorOriginal && melhorSubstituto) {
    const origReal = isRealOffer(melhorOriginal);
    const substReal = isRealOffer(melhorSubstituto);

    if (origReal && !substReal) {
      const economia = precoOriginal - getUnitCost(melhorOriginal);
      return { melhor: melhorOriginal, economia };
    } else if (!origReal && substReal) {
      const economia = benchmarkPreco - getUnitCost(melhorSubstituto);
      return { melhor: melhorSubstituto, economia };
    } else {
      if (getUnitCost(melhorSubstituto) < getUnitCost(melhorOriginal)) {
        const economia = benchmarkPreco - getUnitCost(melhorSubstituto);
        return { melhor: melhorSubstituto, economia };
      } else {
        const economia = precoOriginal - getUnitCost(melhorOriginal);
        return { melhor: melhorOriginal, economia };
      }
    }
  } else if (melhorOriginal) {
    const economia = precoOriginal - getUnitCost(melhorOriginal);
    return { melhor: melhorOriginal, economia };
  } else if (melhorSubstituto) {
    const economia = benchmarkPreco - getUnitCost(melhorSubstituto);
    return { melhor: melhorSubstituto, economia };
  }

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
      const genericosReais = substitutosGenericos.filter(s => isRealOffer(s));
      const melhorG = genericosReais.length > 0 ? genericosReais[0] : null;
      if (melhorG) {
        const maxAllowedPrice = precoOriginal * 1.10;
        if (getUnitCost(melhorG) <= maxAllowedPrice) {
          const economia = precoOriginal - getUnitCost(melhorG);
          return { melhor: melhorG, economia, isFallback: true };
        }
      }
    }
  }

  return null;
}
