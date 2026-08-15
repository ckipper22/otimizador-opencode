import React, { useState, useMemo, useEffect } from "react";
import { SwapReportItem } from "../types";

interface UseDistributorWizardsParams {
  activeReport: SwapReportItem[];
  disabledItemCodes: Set<string>;
  result: { report: SwapReportItem[] } | null;
  setResult: React.Dispatch<React.SetStateAction<any>>;
}

export function useDistributorWizards({
  activeReport,
  disabledItemCodes,
  result,
  setResult,
}: UseDistributorWizardsParams) {
  const [distributorMinimums, setDistributorMinimums] = useState<Record<string, number>>({
    "GAM": 150,
    "PanPharma": 250,
    "Servimed": 200,
    "Profarma": 250,
    "SantaCruz": 300,
    "DrogaCenter": 150,
    "NeoSul": 150,
    "ANB": 150,
    "Distribuidor": 150,
    "Não Encontrados": 0
  });

  const [distributorOrder, setDistributorOrder] = useState<string[]>([]);
  const [expandedGroups, setExpandedGroups] = useState<Record<string, boolean>>({});

  const [isDispersing, setIsDispersing] = useState<Record<string, boolean>>({});
  const [dispersingFromDist, setDispersingFromDist] = useState<string | null>(null);
  const [dispersingEligibleItems, setDispersingEligibleItems] = useState<any[]>([]);
  const [dispersingSelectedCodes, setDispersingSelectedCodes] = useState<Set<string>>(new Set());
  const [isSearchingDispersing, setIsSearchingDispersing] = useState<boolean>(false);
  const [completingTargetDist, setCompletingTargetDist] = useState<string | null>(null);
  const [completingEligibleItems, setCompletingEligibleItems] = useState<any[]>([]);
  const [completingSelectedCodes, setCompletingSelectedCodes] = useState<Set<string>>(new Set());
  const [wizardLogs, setWizardLogs] = useState<string[]>([]);
  const [isSearchingCompleting, setIsSearchingCompleting] = useState<string | null>(null);
  const [isReRoutingShortages, setIsReRoutingShortages] = useState<boolean>(false);

  const [activeItemWizardCod, setActiveItemWizardCod] = useState<string | null>(null);
  const [itemWizardOffers, setItemWizardOffers] = useState<any[]>([]);
  const [isSearchingItemWizard, setIsSearchingItemWizard] = useState<boolean>(false);

  const getGroupMinVal = (gName: string) => {
    if (distributorMinimums[gName] !== undefined) {
      return distributorMinimums[gName];
    }
    const match = gName.match(/^([^\[]+)/);
    if (match) {
      const baseDist = match[1].trim();
      if (distributorMinimums[baseDist] !== undefined) {
        return distributorMinimums[baseDist];
      }
    }
    return 150;
  };

  const distributorGroupings = useMemo(() => {
    if (!activeReport || activeReport.length === 0) return [];
    const map = new Map<string, { name: string; totalValue: number; itemsCount: number; items: any[] }>();
    for (const item of activeReport) {
      const distName = item.distribuidora || "Não Encontrados";
      if (!map.has(distName)) {
        map.set(distName, { name: distName, totalValue: 0, itemsCount: 0, items: [] });
      }
      const group = map.get(distName)!;
      group.totalValue += (item.novoPreco || 0) * (item.qtd || 0);
      group.itemsCount++;
      group.items.push(item);
    }
    return Array.from(map.values());
  }, [activeReport]);

  const handleStartDispersingWizard = async (distName: string) => {
    setDispersingFromDist(distName);
    setIsSearchingDispersing(true);
    setWizardLogs([`[BUSCA] Procurando itens elegíveis para dispersão a partir de ${distName}...`]);
    try {
      const distItems = activeReport.filter(it => it.distribuidora === distName && !disabledItemCodes.has(it.codInterno));
      const otherDists = distributorGroupings.filter(g => g.name !== distName && g.name !== "Não Encontrados" && g.name !== "Sem Estoque");
      const eligible: any[] = [];
      for (const item of distItems) {
        for (const otherDist of otherDists) {
          const otherItem = otherDist.items.find((i: any) => i.codInterno === item.codInterno && i.distribuidora !== distName);
          if (otherItem) {
            eligible.push({ ...item, targetDist: otherDist.name });
          }
        }
      }
      setDispersingEligibleItems(eligible);
      setWizardLogs(prev => [...prev, `[OK] ${eligible.length} itens elegíveis encontrados.`]);
    } catch (err: any) {
      setWizardLogs(prev => [...prev, `[ERRO] ${err.message}`]);
    }
    setIsSearchingDispersing(false);
  };

  const handleStartCompletingWizard = async (distName: string) => {
    setCompletingTargetDist(distName);
    setIsSearchingCompleting(distName);
    setWizardLogs([`[BUSCA] Analisando itens para completar pedido de ${distName}...`]);
    try {
      const targetItems = activeReport.filter(it => it.distribuidora === distName && !disabledItemCodes.has(it.codInterno));
      const otherDists = distributorGroupings.filter(g => g.name !== distName && g.name !== "Não Encontrados" && g.name !== "Sem Estoque");
      const eligible: any[] = [];
      for (const item of targetItems) {
        for (const otherDist of otherDists) {
          const otherItem = otherDist.items.find((i: any) => i.codInterno === item.codInterno && i.distribuidora !== distName);
          if (otherItem) {
            eligible.push({ ...otherItem, targetDist: distName });
          }
        }
      }
      setCompletingEligibleItems(eligible);
      setWizardLogs(prev => [...prev, `[OK] ${eligible.length} itens de outros distribuidores elegíveis.`]);
    } catch (err: any) {
      setWizardLogs(prev => [...prev, `[ERRO] ${err.message}`]);
    }
    setIsSearchingCompleting(null);
  };

  const handleApplyDispersingTransfers = (selectedCodes: string[]) => {
    if (selectedCodes.length === 0 || !dispersingFromDist) return;
    const newResult = { ...result! };
    const newReport = [...newResult.report];
    const updatedMap = new Map<string, any>(newReport.map(r => [r.codInterno, r]));
    for (const code of selectedCodes) {
      const item = dispersingEligibleItems.find((i: any) => i.codInterno === code);
      if (item && updatedMap.has(code)) {
        const existing = updatedMap.get(code);
        updatedMap.set(code, { ...existing, distribuidora: item.targetDist });
      }
    }
    newResult.report = Array.from(updatedMap.values());
    setResult(newResult);
    setDispersingFromDist(null);
    setDispersingEligibleItems([]);
    setDispersingSelectedCodes(new Set());
  };

  const handleApplyCompletingTransfers = (selectedCodes: string[]) => {
    if (selectedCodes.length === 0 || !completingTargetDist) return;
    const newResult = { ...result! };
    const newReport = [...newResult.report];
    const updatedMap = new Map<string, any>(newReport.map(r => [r.codInterno, r]));
    for (const code of selectedCodes) {
      const item = completingEligibleItems.find((i: any) => i.codInterno === code);
      if (item && updatedMap.has(code)) {
        const existing = updatedMap.get(code);
        updatedMap.set(code, { ...existing, distribuidora: completingTargetDist });
      }
    }
    newResult.report = Array.from(updatedMap.values());
    setResult(newResult);
    setCompletingTargetDist(null);
    setCompletingEligibleItems([]);
    setCompletingSelectedCodes(new Set());
  };

  return {
    distributorMinimums, setDistributorMinimums,
    distributorOrder, setDistributorOrder,
    expandedGroups, setExpandedGroups,
    isDispersing, setIsDispersing,
    dispersingFromDist, setDispersingFromDist,
    dispersingEligibleItems, setDispersingEligibleItems,
    dispersingSelectedCodes, setDispersingSelectedCodes,
    isSearchingDispersing,
    completingTargetDist, setCompletingTargetDist,
    completingEligibleItems, setCompletingEligibleItems,
    completingSelectedCodes, setCompletingSelectedCodes,
    wizardLogs, setWizardLogs,
    isSearchingCompleting,
    isReRoutingShortages, setIsReRoutingShortages,
    activeItemWizardCod, setActiveItemWizardCod,
    itemWizardOffers, setItemWizardOffers,
    isSearchingItemWizard, setIsSearchingItemWizard,
    getGroupMinVal,
    distributorGroupings,
    handleStartDispersingWizard,
    handleStartCompletingWizard,
    handleApplyDispersingTransfers,
    handleApplyCompletingTransfers,
  };
}
