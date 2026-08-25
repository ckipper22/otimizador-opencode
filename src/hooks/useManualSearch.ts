import React, { useState, useMemo } from "react";
import { OptimizationResponse, SwapReportItem, OptimizerConfig } from "../types";
import { cleanEan, resolveEstoque, resolveQtdMinima, resolvePrecoLiquido, resolvePedidoMinimo } from "../utils";

interface UseManualSearchParams {
  config: OptimizerConfig;
  result: OptimizationResponse | null;
  setResult: React.Dispatch<React.SetStateAction<OptimizationResponse | null>>;
  distributorMinimums: Record<string, number>;
  setDistributorMinimums: React.Dispatch<React.SetStateAction<Record<string, number>>>;
  disregardedCodes: Set<string>;
}

export function useManualSearch({
  config,
  result,
  setResult,
  distributorMinimums,
  setDistributorMinimums,
  disregardedCodes,
}: UseManualSearchParams) {
  const [manualQuery, setManualQuery] = useState<string>("");
  const [manualSearchResults, setManualSearchResults] = useState<any[]>([]);
  const [manualAllAlternatives, setManualAllAlternatives] = useState<any[]>([]);
  const [manualMinimos, setManualMinimos] = useState<any[]>([]);
  const [manualDcbFound, setManualDcbFound] = useState<string | null>(null);
  const [manualDeduplicar, setManualDeduplicar] = useState<boolean>(false);
  const [manualApenasEstoque, setManualApenasEstoque] = useState<boolean>(true);
  const [manualActionSuccessKey, setManualActionSuccessKey] = useState<string | null>(null);
  const [isManualSearching, setIsManualSearching] = useState<boolean>(false);
  const [manualSearchError, setManualSearchError] = useState<string | null>(null);
  const [manualQty, setManualQty] = useState<number>(1);
  const [manualQuantities, setManualQuantities] = useState<Record<string, number>>({});
  const [manualSearchLogs, setManualSearchLogs] = useState<string[]>([]);
  const [isManualAddModalOpen, setIsManualAddModalOpen] = useState<boolean>(false);
  const [manualModalWidth, setManualModalWidth] = useState<string>(() => sessionStorage.getItem('manual_modal_width') || "1200px");
  const [manualModalHeight, setManualModalHeight] = useState<string>(() => sessionStorage.getItem('manual_modal_height') || "700px");
  const [manualAddOriginItem, setManualAddOriginItem] = useState<{ean: string, descricao: string, laboratorio: string} | null>(null);

  const handleManualSearch = async () => {
    if (manualQuery.trim() === "") {
      setManualSearchResults([]);
      setManualAllAlternatives([]);
      setManualMinimos([]);
      setManualDcbFound(null);
      setManualSearchError(null);
      setManualSearchLogs([]);
      return;
    }
    if (manualQuery.trim().length < 2) {
      setManualSearchError("Digite pelo menos 2 caracteres.");
      return;
    }
    setIsManualSearching(true);
    setManualSearchResults([]);
    setManualAllAlternatives([]);
    setManualMinimos([]);
    setManualDcbFound(null);
    setManualSearchError(null);

    try {
      const storedCutsStr = localStorage.getItem("cortes_recentes");
      const cortesRecentes = storedCutsStr ? JSON.parse(storedCutsStr) : {};

      const isNumeric = /^\d+$/.test(manualQuery.trim());

      const eanMap: Record<string, { descricao: string; laboratorio: string; precoOriginal: number }> = {};
      if (result && Array.isArray(result.report)) {
        result.report.forEach((item: any) => {
          if (item.originalEan) {
            eanMap[item.originalEan] = {
              descricao: item.originalDescricao || "",
              laboratorio: item.originalLaboratorio || "",
              precoOriginal: item.originalPreco || 0
            };
          }
        });
      }

      const searchResp = await fetch("/api/search-products", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          query: manualQuery,
          token: config.token,
          cnpj: config.cnpj,
          useTestUrl: config.useTestUrl,
          simulationMode: config.simulationMode,
          permitirSemEstoque: !manualApenasEstoque || config.permitirSemEstoque,
          tipos: config.tipos,
          margemMinima: config.margemMinima,
          eanMap,
          cortesRecentes,
          onlyExactEan: isNumeric,
          skipMolecula: true
        })
      });
      const searchData = await searchResp.json();
      let allAlts: any[] = [];
      let alts: any[] = [];
      let minimos: any[] = [];
      let dcb: string | null = null;
      let logs: string[] = [];

      if (searchResp.ok && searchData.items) {
        allAlts = searchData.items;
        alts = searchData.items;
        logs = searchData.logs || [];
      }

      setManualAllAlternatives(allAlts);
      setManualSearchResults(alts);
      setManualMinimos(minimos);
      setManualDcbFound(dcb);
      setManualSearchLogs(logs);

      if (allAlts.length === 0 && alts.length === 0) {
        setManualSearchError(`Nenhuma oferta comercial com estoque encontrada para "${manualQuery}".`);
      }
    } catch (err: any) {
      setManualSearchError(err.message || "Erro inesperado ao buscar ofertas na SmartPed.");
    } finally {
      setIsManualSearching(false);
    }
  };

  const getManualDistMinimo = (
    codDist: any,
    condicao: string = "",
    prazo: any = 0,
    fallbackDistName: string = ""
  ): number => {
    const targetDistStr = String(codDist !== undefined ? codDist : "").trim();
    const targetCondStr = String(condicao || "").trim().toUpperCase();
    const targetPrazoStr = String(prazo !== undefined ? prazo : "").trim();

    if (manualMinimos && manualMinimos.length > 0) {
      let match = manualMinimos.find((m: any) => {
        const mDist = String(m.CodDist !== undefined ? m.CodDist : (m.codDist !== undefined ? m.codDist : "")).trim();
        const mCond = String(m.Condicao || m.condicao || "").trim().toUpperCase();
        const mNomeCond = String(m.NomeCondicao || m.nomeCondicao || "").trim().toUpperCase();
        const mPrazo = String(m.Prazo !== undefined ? m.Prazo : (m.prazo !== undefined ? m.prazo : "")).trim();

        return mDist === targetDistStr && (!targetPrazoStr || mPrazo === targetPrazoStr) && (!targetCondStr || mCond === targetCondStr || mNomeCond === targetCondStr);
      });

      if (!match) {
        match = manualMinimos.find((m: any) => {
          const mDist = String(m.CodDist !== undefined ? m.CodDist : (m.codDist !== undefined ? m.codDist : "")).trim();
          const mPrazo = String(m.Prazo !== undefined ? m.Prazo : (m.prazo !== undefined ? m.prazo : "")).trim();
          return mDist === targetDistStr && mPrazo === targetPrazoStr;
        });
      }

      if (!match) {
        match = manualMinimos.find((m: any) => {
          const mDist = String(m.CodDist !== undefined ? m.CodDist : (m.codDist !== undefined ? m.codDist : "")).trim();
          return mDist === targetDistStr;
        });
      }

      if (match) {
        const vlr = Number(match.VlrMinimo !== undefined ? match.VlrMinimo : (match.vlrMinimo !== undefined ? match.vlrMinimo : 0));
        if (vlr > 0) return vlr;
      }
    }

    const nameLower = (fallbackDistName || "").toLowerCase();
    if (nameLower.includes("panpharma") || nameLower.includes("panfarma")) return 250;
    if (nameLower.includes("profarma")) return 250;
    if (nameLower.includes("santacruz") || nameLower.includes("santa cruz")) return 300;
    if (nameLower.includes("servimed")) return 200;
    if (nameLower.includes("gam")) return 150;
    if (nameLower.includes("anb")) return 250;
    if (nameLower.includes("orizon") || nameLower.includes("dimeval")) return 200;

    return 150;
  };

  const processedManualOffers = useMemo(() => {
    const sourceList = manualAllAlternatives.length > 0 ? manualAllAlternatives : manualSearchResults;
    if (!sourceList || sourceList.length === 0) return [];

    let filtered = sourceList;
    if (manualApenasEstoque) {
      filtered = filtered.filter(item => {
        const distName = (item.distribuidora || item.NomeDist || "").toLowerCase();
        if (distName.includes("não encontrados")) return false;

        const est = resolveEstoque(item);
        const qtdMin = resolveQtdMinima(item);

        return est > 0 || qtdMin > 1;
      });
    }

    if (!manualDeduplicar) {
      return [...filtered].sort((a, b) => {
        const pA = resolvePrecoLiquido(a);
        const pB = resolvePrecoLiquido(b);
        return pA - pB;
      });
    }

    const groupMap = new Map<string, any>();

    for (const rawOffer of filtered) {
      const offerEan = String(rawOffer.ean || rawOffer.Ean || "").trim();
      const codDist = String(rawOffer.codDist !== undefined ? rawOffer.codDist : (rawOffer.CodDist !== undefined ? rawOffer.CodDist : rawOffer.distribuidora || rawOffer.NomeDist || "")).trim();

      if (!offerEan || !codDist) continue;

      const groupKey = `${offerEan}___${codDist}`;

      const pLiquido = resolvePrecoLiquido(rawOffer);

      const prazoNum = Number(
        rawOffer.prazo !== undefined ? rawOffer.prazo :
        rawOffer.Prazo !== undefined ? rawOffer.Prazo : 0
      );

      const normalizedOffer = {
        ...rawOffer,
        _calcPLiquido: pLiquido,
        _calcPrazo: prazoNum,
        // Garantir que PMC seja preservado (case-insensitive)
        PMC: rawOffer.PMC ?? rawOffer.pmc ?? rawOffer.Pmc ?? 0
      };

      if (!groupMap.has(groupKey)) {
        groupMap.set(groupKey, normalizedOffer);
      } else {
        const existing = groupMap.get(groupKey);
        const existingPLiquido = existing._calcPLiquido;
        const existingPrazo = existing._calcPrazo;

        if (pLiquido < existingPLiquido - 0.0001) {
          groupMap.set(groupKey, normalizedOffer);
        } else if (Math.abs(pLiquido - existingPLiquido) <= 0.0001) {
          if (prazoNum > existingPrazo) {
            groupMap.set(groupKey, normalizedOffer);
          } else if (prazoNum === existingPrazo && resolveEstoque(rawOffer) > resolveEstoque(existing)) {
            groupMap.set(groupKey, normalizedOffer);
          }
        }
      }
    }

    return Array.from(groupMap.values()).sort((a, b) => a._calcPLiquido - b._calcPLiquido);
  }, [manualAllAlternatives, manualSearchResults, manualDeduplicar, manualApenasEstoque]);

  const handleAddManualItem = (offer: any, quantity: number, itemKey: string) => {
    const qtyToAdd = parseFloat(String(quantity));
    if (isNaN(qtyToAdd) || qtyToAdd <= 0) {
      alert("Defina uma quantidade válida maior que zero.");
      return;
    }

    const offerEan = cleanEan(String(offer.ean || offer.Ean || ""));
    const offerDesc = offer.descricao || offer.Descricao || offer.nom_produto || "";
    const offerLab = offer.laboratorio || offer.Laboratorio || offer.nom_laborat || "";
    const offerDist = offer.distribuidora || offer.NomeDist || (offer.codDist ? `Distribuidora ${offer.codDist}` : "Distribuidora");
    const offerPrecoLiq = Number(offer._calcPLiquido || offer.pliquidoUni || offer.pliquido || offer.precoLiquido || offer.preco || offer.Preco || 0);
    const offerPrecoFab = Number(offer.pfabrica || offer.Pfabrica || offer.precoOriginal || offer.precoFabrica || 0);
    const offerEstoque = Number(offer.estoque !== undefined ? offer.estoque : (offer.Estoque !== undefined ? offer.Estoque : 9999));
    const offerCodDist = Number(offer.codDist !== undefined ? offer.codDist : (offer.CodDist !== undefined ? offer.CodDist : 0));
    const offerCondicao = offer.condicao || offer.Condicao || offer.NomeCondicao || "FIXA";
    const offerPrazo = Number(offer.prazo !== undefined ? offer.prazo : (offer.Prazo !== undefined ? offer.Prazo : 0));
    const offerCodProdDist = offer.codProdutoDist || offer.CodProdutoDist || offer.cod_produtodist || "";
    const offerCodProd = offer.codProduto || offer.CodProduto || offerCodProdDist || "";
    const offerPedMin = getManualDistMinimo(offerCodDist, offerCondicao, offerPrazo, offerDist);

    const randomCod = "MANUAL-" + Date.now() + "-" + Math.floor(1000 + Math.random() * 9000);
    const economiaUnit = Math.max(0, offerPrecoFab - offerPrecoLiq);
    const economiaTotal = economiaUnit * qtyToAdd;

    const calcOriginalPmc = (offer.pmc !== undefined && offer.pmc > 0) || (offer.PMC !== undefined && offer.PMC > 0) ? (offer.pmc || offer.PMC) : (offerPrecoFab > 0 ? Number((offerPrecoFab * 1.4).toFixed(2)) : 0);
    const calcNovoPmc = (offer.pmc !== undefined && offer.pmc > 0) || (offer.PMC !== undefined && offer.PMC > 0) ? (offer.pmc || offer.PMC) : (offerPrecoLiq > 0 ? Number((offerPrecoLiq * 1.4).toFixed(2)) : 0);

    const newItem: SwapReportItem = {
      codInterno: randomCod,
      originalEan: offerEan,
      originalDescricao: offerDesc,
      originalLaboratorio: offerLab,
      originalPreco: offerPrecoFab > 0 ? offerPrecoFab : offerPrecoLiq,
      originalPmc: calcOriginalPmc,
      novoEan: offerEan,
      novaDescricao: offerDesc,
      novoLaboratorio: offerLab,
      novoPreco: offerPrecoLiq,
      novoPmc: calcNovoPmc,
      qtd: qtyToAdd,
      economiaUnit,
      economiaTotal,
      distribuidora: offerDist,
      estoque: offerEstoque,
      codDist: offerCodDist,
      condicao: offerCondicao,
      codProdutoDist: offerCodProdDist,
      prazo: offerPrazo,
      codProduto: offerCodProd,
      pedidoMinimo: offerPedMin,
      origem: offer.origem || "manual",
      motivoAcao: offer.motivoAcao || "",
      whatsappDestino: offer.whatsappDestino || "",
      fornecedorLista: offer.fornecedorLista || "",
      fornecedorId: offer.fornecedorId || "",
      tiers: offer.tiers || [],
      alternatives: [{
        ean: offerEan,
        descricao: offerDesc,
        laboratorio: offerLab,
        distribuidora: offerDist,
        codDist: offerCodDist,
        preco: offerPrecoLiq,
        precoLiquido: offerPrecoLiq,
        estoque: offerEstoque,
        condicao: offerCondicao,
        prazo: offerPrazo,
        codProdutoDist: offerCodProdDist,
        codProduto: offerCodProd,
        pedidoMinimo: offerPedMin,
        qtdMin: offer.QtdMin || offer.qtdMin || 0
      }]
    };

    if (offerDist && offerDist !== "Não Encontrados" && offerDist !== "Sem Estoque") {
      setDistributorMinimums((prev: Record<string, number>) => {
        const cond = offerCondicao;
        const prz = offerPrazo;
        const compoundKey = `${offerDist} [${cond} | ${prz}d]`;
        return { ...prev, [compoundKey]: offerPedMin };
      });
    }

    setResult((prev: any) => {
      const prevReport = prev ? prev.report : [];
      const updatedReport = [newItem, ...prevReport];
      const activeSwaps = updatedReport.filter((item: any) => !disregardedCodes.has(item.codInterno));
      const newTotalSavings = activeSwaps.reduce((acc: number, it: any) => acc + (it.economiaTotal || 0), 0);

      return {
        ...(prev || {}),
        summary: {
          ...(prev ? prev.summary : { totalItems: 0, itemsTreated: 0, itemsSwapped: 0, totalSavings: 0 }),
          totalItems: (prev?.summary?.totalItems || 0) + 1,
          itemsTreated: (prev?.summary?.itemsTreated || 0) + 1,
          itemsSwapped: (prev?.summary?.itemsSwapped || 0) + 1,
          totalSavings: newTotalSavings
        },
        report: updatedReport,
        unmatched: prev ? prev.unmatched : [],
        shortages: prev ? prev.shortages : []
      };
    });

    // Salvar item manual no localStorage para aba "Itens Digitados Manualmente"
    try {
      const stored = localStorage.getItem("itens_manuais_adicionados");
      const list = stored ? JSON.parse(stored) : [];
      list.push({
        codInterno: randomCod,
        ean: offerEan,
        descricao: offerDesc,
        laboratorio: offerLab,
        distribuidora: offerDist,
        codDist: offerCodDist,
        qtd: qtyToAdd,
        precoLiquido: offerPrecoLiq,
        precoFabrica: offerPrecoFab,
        condicao: offerCondicao,
        prazo: offerPrazo,
        dataAdicao: new Date().toISOString(),
        origem: offer.origem || "manual",
        motivoAcao: offer.motivoAcao || "",
        fornecedorLista: offer.fornecedorLista || "",
      });
      localStorage.setItem("itens_manuais_adicionados", JSON.stringify(list));
    } catch (e) {
      console.error("Erro ao salvar item manual no localStorage:", e);
    }

    // Salvar item manual no Turso via endpoint
    try {
      fetch("/api/salvar-item-manual", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          item: {
            codInterno: randomCod,
            ean: offerEan,
            descricao: offerDesc,
            laboratorio: offerLab,
            distribuidora: offerDist,
            codDist: offerCodDist,
            qtd: qtyToAdd,
            precoLiquido: offerPrecoLiq,
            precoFabrica: offerPrecoFab,
            condicao: offerCondicao,
            prazo: offerPrazo,
            dataAdicao: new Date().toISOString(),
            origem: "manual"
          },
          cnpj: config.cnpj || ""
        })
      }).catch(e => console.error("Erro ao salvar item manual no Turso:", e));
    } catch (e) {
      console.error("Erro ao salvar item manual no Turso:", e);
    }

    setManualActionSuccessKey(itemKey);
    setTimeout(() => {
      setManualActionSuccessKey(null);
    }, 2500);
  };

  return {
    manualQuery,
    setManualQuery,
    manualSearchResults,
    setManualSearchResults,
    manualAllAlternatives,
    setManualAllAlternatives,
    manualMinimos,
    setManualMinimos,
    manualDcbFound,
    setManualDcbFound,
    manualDeduplicar,
    setManualDeduplicar,
    manualApenasEstoque,
    setManualApenasEstoque,
    manualActionSuccessKey,
    setManualActionSuccessKey,
    isManualSearching,
    setManualSearchError,
    manualSearchError,
    manualQty,
    setManualQty,
    manualQuantities,
    setManualQuantities,
    manualSearchLogs,
    setManualSearchLogs,
    isManualAddModalOpen,
    setIsManualAddModalOpen,
    manualModalWidth,
    setManualModalWidth,
    manualModalHeight,
    setManualModalHeight,
    manualAddOriginItem,
    setManualAddOriginItem,
    handleManualSearch,
    handleAddManualItem,
    getManualDistMinimo,
    processedManualOffers,
  };
}
