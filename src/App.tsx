import React, { useState, useMemo, useEffect, useRef, Suspense } from "react";
import { FileDown, CheckCircle, CheckCircle2, RefreshCw, AlertCircle, Sparkles, Wifi, WifiOff, Send, Truck, X, ShieldCheck, Search, Plus, AlertTriangle, Clock, ArrowLeft, Trash2, ArrowDown, ChevronRight, XCircle, Copy, Lock, Mail, Eye, EyeOff, Settings, ArrowUp, GripVertical, ShoppingBag, Package, Loader2, Check, AlertCircle as AlertCircleIcon } from "lucide-react";
import { motion, AnimatePresence, useDragControls } from "motion/react";
import UploadBox from "./components/UploadBox";
import ConfigurationPanel from "./components/ConfigurationPanel";
import OptimizationSummaryStats from "./components/OptimizationSummary";
import SwapsTable from "./components/SwapsTable";
import { OrderReturnView } from "./components/OrderReturnView";
import { PendingOrdersTable } from "./components/PendingOrdersTable";
import { FaturadosModal } from "./components/FaturadosModal";
import { ConfirmQuantitiesModal } from "./components/ConfirmQuantitiesModal";
import { BillingLogsModal } from "./components/BillingLogsModal";
import VisualChart from "./components/VisualChart";
import { DailyItemsView } from "./components/DailyItemsView";
import { OptimizerConfig, OptimizationResponse, SwapReportItem, DistributorOption, ExternalSupplier, AuthorizedCompany } from "./types";
import { EanEyeButton } from "./components/EanEyeButton";
import { HOMOLOGACAO_SICF_FILE, formatCurrency, resolveEstoque, resolveQtdMinima, resolvePedidoMinimo } from "./utils";
import { useAuth } from "./hooks/useAuth";
import { useOptimizerConfig } from "./hooks/useOptimizerConfig";
import { useDailyOrders } from "./hooks/useDailyOrders";
import { useOptimizationResult } from "./hooks/useOptimizationResult";
import { useBilling } from "./hooks/useBilling";
import { useManualSearch } from "./hooks/useManualSearch";

const LazySwapsTable = React.lazy(() => import("./components/SwapsTable"));
const LazyOrderReturnView = React.lazy(() => import("./components/OrderReturnView").then(m => ({ default: m.OrderReturnView })));
const LazyDailyItemsView = React.lazy(() => import("./components/DailyItemsView").then(m => ({ default: m.DailyItemsView })));
const LazyPendingOrdersTable = React.lazy(() => import("./components/PendingOrdersTable").then(m => ({ default: m.PendingOrdersTable })));

const normalizeDistName = (name: string) => 
  (name || "")
    .split('[')[0]
    .trim()
    .normalize("NFD")
    .replace(/[\u0300-\u036f]/g, "")
    .toUpperCase();

export default function App() {
  const dragControls = useDragControls();
  const isDragging = useRef(false);

  // Custom Hooks
  const {
    isAuthenticated,
    currentUserEmail,
    loginEmail,
    setLoginEmail,
    loginPassword,
    setLoginPassword,
    showPassword,
    setShowPassword,
    loginError,
    setLoginError,
    authorizedCompanies,
    setAuthorizedCompanies,
    isAdmin,
    handleLoginSubmit,
    handleGoogleLogin,
    handleLogout,
  } = useAuth();

  const {
    config,
    setConfig,
    distributors,
    disabledDistributors,
    isLoadingDistributors,
    externalSuppliers,
    backendStatus,
    handleToggleDistributor,
    handleUpdateExternalSuppliers,
  } = useOptimizerConfig();

  // Application State
  const [activeTab, setActiveTab] = useState<"production" | "homologation" | "daily_items">("production");
  const [mainView, setMainView] = useState<"optimize" | "returns" | "daily_items">("optimize");

  const {
    dailyOrders,
    isCheckingDaily,
    dailyOrderLogs,
    setDailyOrderLogs,
    selectedDailyOrder,
    setSelectedDailyOrder,
    highlightedOrder,
    setHighlightedOrder,
    directNumPedido,
    setDirectNumPedido,
    directOrderReturn,
    isCheckingDirectReturn,
    directReturnCheckLogs,
    directAutoPollReturn,
    setDirectAutoPollReturn,
    handleCheckDailyOrders,
    handleCheckDirectOrderReturn,
  } = useDailyOrders(config, mainView);

  // Distributor minimums (used by UI, wizard, and hooks)
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

  // Optimization Result Hook
  const {
    isLoading, setIsLoading,
    error, setError,
    result, setResult,
    fileContent, setFileContent,
    fileName, setFileName,
    showQuantityInterception, setShowQuantityInterception,
    preDistributedMap, setPreDistributedMap,
    logs, setLogs,
    disregardedCodes, setDisregardedCodes,
    disabledItemCodes, setDisabledItemCodes,
    billedItemCodes, setBilledItemCodes,
    overriddenDistributors, setOverriddenDistributors,
    handleFileLoaded, handleClearFile, handleOptimize,
    handleToggleDisregard, handleToggleDisabled,
    handleUpdateQty, handleSelectCondition, handleDeleteDistributor,
    handleConfirmQtyInInterception,
    downloadSICF, downloadCSV,
    activeReport, activeSummary, pendingAlertItems,
  } = useOptimizationResult({
    config, setConfig, disabledDistributors, externalSuppliers,
    distributors, handleCheckDailyOrders, dailyOrders,
    setDistributorMinimums,
  });

  // Billing Hook
  const {
    isBillingLoading, billingResult, setBillingResult,
    isBillingModalOpen, setIsBillingModalOpen,
    billedGroups, setBilledGroups,
    billingContext, setBillingContext,
    viewingLogs, setViewingLogs,
    billingConfirm, setBillingConfirm,
    billingChoice, setBillingChoice,
    faturadosGlobais, setFaturadosGlobais,
    isFaturadosOpen, setIsFaturadosOpen,
    orderReturn, setOrderReturn,
    isCheckingReturn, returnCheckLogs, setReturnCheckLogs,
    manualCutsAlert, setManualCutsAlert,
    autoPollReturn, setAutoPollReturn,
    suspectItemAlert, setSuspectItemAlert,
    handleSendBilling, handleCloseAndConsolidateBilling,
    pollOrderReturn, handleCheckOrderReturn,
    handleExportShortages, handleReRouteShortages,
  } = useBilling({
    result, setResult, config, activeReport,
    disregardedCodes, disabledItemCodes, setDisabledItemCodes,
    billedItemCodes, setBilledItemCodes, setLogs,
  });

  // Manual Search Hook
  const {
    manualQuery, setManualQuery,
    manualSearchResults, setManualSearchResults,
    manualAllAlternatives, setManualAllAlternatives,
    manualMinimos, setManualMinimos,
    manualDcbFound, setManualDcbFound,
    manualDeduplicar, setManualDeduplicar,
    manualApenasEstoque, setManualApenasEstoque,
    manualActionSuccessKey, setManualActionSuccessKey,
    isManualSearching, setManualSearchError, manualSearchError,
    manualQty, setManualQty,
    manualQuantities, setManualQuantities,
    manualSearchLogs, setManualSearchLogs,
    isManualAddModalOpen, setIsManualAddModalOpen,
    manualModalWidth, setManualModalWidth,
    manualModalHeight, setManualModalHeight,
    manualAddOriginItem, setManualAddOriginItem,
    handleManualSearch, handleAddManualItem, getManualDistMinimo,
    processedManualOffers,
  } = useManualSearch({
    config, result, setResult,
    distributorMinimums, setDistributorMinimums,
    disregardedCodes,
  });

  const [isConfigOpen, setIsConfigOpen] = useState<boolean>(false);

  // Column settings for offers table (persisted in sessionStorage)
  const OFFER_COL_DEFAULTS: Record<string, { vis: boolean; w: number }> = {
    dist:      { vis: true,  w: 150 },
    prod:      { vis: true,  w: 280 },
    pfab:      { vis: true,  w: 100 },
    desc:      { vis: true,  w: 90  },
    descExtra: { vis: false, w: 100 },
    st:        { vis: false, w: 100 },
    pLiq:      { vis: true,  w: 120 },
    prazo:     { vis: true,  w: 130 },
    acao:      { vis: true,  w: 180 },
  };
  const OFFER_COL_LABELS: Record<string, string> = {
    dist: "Distribuidora", prod: "Produto & EAN", pfab: "P. Fábrica",
    desc: "Desc %", descExtra: "Desc Extra %", st: "ST (R$)",
    pLiq: "Preço Líquido", prazo: "Prazo / Mín",
    acao: "Qtd / Ação",
  };
  const OFFER_COL_KEYS = Object.keys(OFFER_COL_DEFAULTS);

  const loadColSettings = (): { vis: Record<string, boolean>; widths: Record<string, number> } => {
    try {
      const raw = sessionStorage.getItem("smartped_offer_cols");
      if (raw) {
        const parsed = JSON.parse(raw);
        const vis: Record<string, boolean> = {};
        const widths: Record<string, number> = {};
        for (const k of OFFER_COL_KEYS) {
          vis[k] = parsed.vis?.[k] !== undefined ? parsed.vis[k] : OFFER_COL_DEFAULTS[k].vis;
          widths[k] = parsed.widths?.[k] !== undefined ? parsed.widths[k] : OFFER_COL_DEFAULTS[k].w;
        }
        return { vis, widths };
      }
    } catch {}
    const vis: Record<string, boolean> = {};
    const widths: Record<string, number> = {};
    for (const k of OFFER_COL_KEYS) { vis[k] = OFFER_COL_DEFAULTS[k].vis; widths[k] = OFFER_COL_DEFAULTS[k].w; }
    return { vis, widths };
  };

  const [offerColVis, setOfferColVis] = useState<Record<string, boolean>>(() => loadColSettings().vis);
  const [offerColWidths, setOfferColWidths] = useState<Record<string, number>>(() => loadColSettings().widths);
  const [showColSettings, setShowColSettings] = useState(false);
  const colSettingsRef = useRef<HTMLDivElement>(null);
  const offersTableRef = useRef<HTMLDivElement>(null);
  const [resizingCol, setResizingCol] = useState<{ key: string; startX: number; startW: number } | null>(null);

  useEffect(() => {
    const vis = offerColVis;
    const widths = offerColWidths;
    try { sessionStorage.setItem("smartped_offer_cols", JSON.stringify({ vis, widths })); } catch {}
  }, [offerColVis, offerColWidths]);

  useEffect(() => {
    if (!resizingCol) return;
    const onMove = (e: MouseEvent) => {
      const delta = e.clientX - resizingCol.startX;
      const newW = Math.max(60, resizingCol.startW + delta);
      setOfferColWidths(prev => ({ ...prev, [resizingCol.key]: newW }));
    };
    const onUp = () => setResizingCol(null);
    document.addEventListener("mousemove", onMove);
    document.addEventListener("mouseup", onUp);
    return () => { document.removeEventListener("mousemove", onMove); document.removeEventListener("mouseup", onUp); };
  }, [resizingCol]);

  useEffect(() => {
    if (!showColSettings) return;
    const onClick = (e: MouseEvent) => {
      if (colSettingsRef.current && !colSettingsRef.current.contains(e.target as Node)) setShowColSettings(false);
    };
    document.addEventListener("mousedown", onClick);
    return () => document.removeEventListener("mousedown", onClick);
  }, [showColSettings]);

  // Distributor ordering and grouping states
  const [distributorOrder, setDistributorOrder] = useState<string[]>([]);
  const [expandedGroups, setExpandedGroups] = useState<Record<string, boolean>>({});

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

  const [showStats, setShowStats] = useState<boolean>(false);
  const [isSwapsTableVisible, setIsSwapsTableVisible] = useState<boolean>(true);

  // Encomendas Import State
  const [isEncomendasImportOpen, setIsEncomendasImportOpen] = useState<boolean>(false);
  const [manualAddFromEncomendas, setManualAddFromEncomendas] = useState<string | null>(null);
  const [encomendasList, setEncomendasList] = useState<any[]>([]);
  const [encomendasWithOffers, setEncomendasWithOffers] = useState<any[]>([]);
  const [isSearchingEncomendas, setIsSearchingEncomendas] = useState<boolean>(false);
  const [encomendasSearchError, setEncomendasSearchError] = useState<string | null>(null);
  const [encomendasSearchLogs, setEncomendasSearchLogs] = useState<string[]>([]);
  const [encomendasModalWidth, setEncomendasModalWidth] = useState<string>(() => sessionStorage.getItem('encomendas_modal_width') || "1200px");
  const [encomendasModalHeight, setEncomendasModalHeight] = useState<string>(() => sessionStorage.getItem('encomendas_modal_height') || "800px");
  const [encomendasQuantities, setEncomendasQuantities] = useState<Record<string, number>>({});
  const [encomendasActionSuccessKey, setEncomendasActionSuccessKey] = useState<string | null>(null);
  const [encomendasAddedKeys, setEncomendasAddedKeys] = useState<Set<string>>(new Set());
  const [showEncomendasLogs, setShowEncomendasLogs] = useState<boolean>(false);
  const encomendasTableRef = useRef<HTMLDivElement>(null);

  const distributorGroupings = useMemo(() => {
    if (!activeReport || activeReport.length === 0) return [];
    const map = new Map<string, { name: string; totalValue: number; itemsCount: number; items: any[] }>();
    for (const item of activeReport) {
      const distName = item.distribuidora || "Não Encontrados";
      if (!map.has(distName)) {
        map.set(distName, { name: distName, totalValue: 0, itemsCount: 0, items: [] });
      }
      const group = map.get(distName)!;
      group.totalValue += item.precoLiquido * item.qtd;
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

  // Importar Encomendas - Busca encomendas pendentes no sistema externo e busca ofertas na SmartPed
  const handleImportEncomendas = async () => {
    setIsEncomendasImportOpen(true);
    setEncomendasWithOffers([]);
    setEncomendasSearchError(null);
    setEncomendasSearchLogs(["[INICIANDO] Buscando encomendas pendentes no sistema externo..."]);

    try {
      // 1. Buscar encomendas pendentes via proxy (server usa a chave do .env)
      const response = await fetch("/api/integracao/encomendas/pendentes", {
        method: "GET",
        headers: { "Content-Type": "application/json" }
      });

      const data = await response.json();
      if (!response.ok) {
        throw new Error(data.error || `Erro ${response.status} ao buscar encomendas`);
      }

      const encomendas = data.encomendas || [];
      setEncomendasList(encomendas);
      setEncomendasSearchLogs(prev => [...prev, `[OK] ${encomendas.length} encomenda(s) pendente(s) encontrada(s).`]);

      if (encomendas.length === 0) {
        setEncomendasSearchLogs(prev => [...prev, `[INFO] Nenhuma encomenda pendente no momento.`]);
        return;
      }

      // 2. Buscar ofertas para TODAS as encomendas em PARALELO (batch) - evita timeout
      setIsSearchingEncomendas(true);
      setEncomendasSearchLogs(prev => [...prev, `[BATCH] Buscando ofertas para ${encomendas.length} encomenda(s) em paralelo...`]);

      const batchResp = await fetch("/api/encomendas/buscar-ofertas-batch", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          encomendas,
          token: config.token,
          cnpj: config.cnpj,
          useTestUrl: config.useTestUrl,
          simulationMode: config.simulationMode,
          margemMinima: config.margemMinima,
          disabledDistributors: Array.from(disabledDistributors)
        })
      });

      const batchData = await batchResp.json();
      if (!batchResp.ok) {
        throw new Error(batchData.error || `Erro ${batchResp.status} na busca batch`);
      }

      // Adicionar logs do batch
      if (batchData.logs) {
        setEncomendasSearchLogs(prev => [...prev, ...batchData.logs]);
      }

      const results = batchData.results || [];

      setEncomendasWithOffers(results);
      setEncomendasSearchLogs(prev => [...prev, `[CONCLUÍDO] Busca finalizada para todas as encomendas.`]);

    } catch (err: any) {
      setEncomendasSearchError(err.message);
      setEncomendasSearchLogs(prev => [...prev, `[ERRO] ${err.message}`]);
    } finally {
      setIsSearchingEncomendas(false);
    }
  };

  // Adicionar item de encomenda individual (estilo botão "+")
  const handleAddEncomendaItem = (item: any, quantity: number, itemKey: string) => {
    const qtyToAdd = parseFloat(String(quantity));
    if (isNaN(qtyToAdd) || qtyToAdd <= 0) {
      alert("Defina uma quantidade válida maior que zero.");
      return;
    }

    const oferta = item.ofertaSelecionada;
    if (!oferta) {
      alert("Selecione uma oferta válida.");
      return;
    }

    const randomCod = "MANUAL-" + Date.now() + "-" + Math.floor(1000 + Math.random() * 9000);
    
    const offerEan = String(oferta.ean || oferta.Ean || item.ean || "").trim();
    const offerDesc = oferta.descricao || oferta.Descricao || item.descricao;
    const offerLab = oferta.laboratorio || oferta.Laboratorio || oferta.nom_laborat || "";
    const offerDist = oferta.distribuidora || oferta.NomeDist || (oferta.codDist ? `Distribuidora ${oferta.codDist}` : "Distribuidora");
    const offerPrecoLiq = Number(oferta.pliquidoUni || oferta.pliquido || oferta.precoLiquido || oferta.preco || oferta.Preco || 0);
    const offerPrecoFab = Number(oferta.pfabrica || oferta.Pfabrica || oferta.precoOriginal || oferta.precoFabrica || 0);
    const offerEstoque = Number(oferta.estoque !== undefined ? oferta.estoque : (oferta.Estoque !== undefined ? oferta.Estoque : 9999));
    const offerCodDist = Number(oferta.codDist !== undefined ? oferta.codDist : (oferta.CodDist !== undefined ? oferta.CodDist : 0));
    const offerCondicao = oferta.condicao || oferta.Condicao || oferta.NomeCondicao || "FIXA";
    const offerPrazo = Number(oferta.prazo !== undefined ? oferta.prazo : (oferta.Prazo !== undefined ? oferta.Prazo : 0));
    const offerCodProdDist = oferta.codProdutoDist || oferta.CodProdutoDist || oferta.cod_produtodist || "";
    const offerCodProd = oferta.codProduto || oferta.CodProduto || "";

    // Calcular pedido mínimo da distribuidora
    let offerPedMin = 150;
    const nameLower = (offerDist || "").toLowerCase();
    if (nameLower.includes("panpharma") || nameLower.includes("panfarma")) offerPedMin = 250;
    else if (nameLower.includes("profarma")) offerPedMin = 250;
    else if (nameLower.includes("santacruz") || nameLower.includes("santa cruz")) offerPedMin = 300;
    else if (nameLower.includes("servimed")) offerPedMin = 200;
    else if (nameLower.includes("gam")) offerPedMin = 150;
    else if (nameLower.includes("anb")) offerPedMin = 250;
    else if (nameLower.includes("orizon") || nameLower.includes("dimeval")) offerPedMin = 200;

    const newItem = {
      codInterno: randomCod,
      originalEan: offerEan,
      originalDescricao: oferta.descricao || oferta.Descricao || item.descricao,
      originalLaboratorio: offerLab,
      originalPreco: offerPrecoFab > 0 ? offerPrecoFab : offerPrecoLiq,
      originalPmc: oferta.PMC && oferta.PMC > 0 ? oferta.PMC : (offerPrecoFab > 0 ? Number((offerPrecoFab * 1.4).toFixed(2)) : 0),
      novoEan: offerEan,
      novaDescricao: oferta.descricao || oferta.Descricao || item.descricao,
      novoLaboratorio: offerLab,
      novoPreco: offerPrecoLiq,
      novoPmc: oferta.PMC && oferta.PMC > 0 ? oferta.PMC : (offerPrecoLiq > 0 ? Number((offerPrecoLiq * 1.4).toFixed(2)) : 0),
      qtd: qtyToAdd,
      economiaUnit: Math.max(0, offerPrecoFab - offerPrecoLiq),
      economiaTotal: Math.max(0, offerPrecoFab - offerPrecoLiq) * qtyToAdd,
      distribuidora: offerDist,
      estoque: offerEstoque,
      codDist: offerCodDist,
      condicao: offerCondicao,
      codProdutoDist: offerCodProdDist,
      prazo: offerPrazo,
      codProduto: offerCodProd,
      pedidoMinimo: offerPedMin,
      origem: "encomenda",
      idEncomenda: item.idEncomenda,
      alternatives: (item.ofertas || []).filter(Boolean).map((o: any) => {
        const oEan = String(o.ean || o.Ean || "").trim();
        const oDesc = o.descricao || o.Descricao || offerDesc;
        const oLab = o.laboratorio || o.Laboratorio || o.nom_laborat || offerLab;
        const oDist = o.distribuidora || o.NomeDist || (o.codDist ? `Distribuidora ${o.codDist}` : "Distribuidora");
        const oPLiq = Number(o.pliquidoUni || o.pliquido || o.precoLiquido || o.preco || o.Preco || 0);
        const oEst = Number(o.estoque !== undefined ? o.estoque : (o.Estoque !== undefined ? o.Estoque : 0));
        const oCodDist = Number(o.codDist !== undefined ? o.codDist : (o.CodDist !== undefined ? o.CodDist : 0));
        const oCond = o.condicao || o.Condicao || o.NomeCondicao || "FIXA";
        const oPrazo = Number(o.prazo !== undefined ? o.prazo : (o.Prazo !== undefined ? o.Prazo : 0));
        const oCodProdDist = o.codProdutoDist || o.CodProdutoDist || o.cod_produtodist || "";
        const oCodProd = o.codProduto || o.CodProduto || "";
        let oPedMin = 150;
        const oNameLower = (oDist || "").toLowerCase();
        if (oNameLower.includes("panpharma") || oNameLower.includes("panfarma")) oPedMin = 250;
        else if (oNameLower.includes("profarma")) oPedMin = 250;
        else if (oNameLower.includes("santacruz") || oNameLower.includes("santa cruz")) oPedMin = 300;
        else if (oNameLower.includes("servimed")) oPedMin = 200;
        else if (oNameLower.includes("gam")) oPedMin = 150;
        else if (oNameLower.includes("anb")) oPedMin = 250;
        else if (oNameLower.includes("orizon") || oNameLower.includes("dimeval")) oPedMin = 200;
        return {
          ean: oEan,
          descricao: oDesc,
          laboratorio: oLab,
          distribuidora: oDist,
          codDist: oCodDist,
          preco: oPLiq,
          precoLiquido: oPLiq,
          estoque: oEst,
          condicao: oCond,
          prazo: oPrazo,
          codProdutoDist: oCodProdDist,
          codProduto: oCodProd,
          pedidoMinimo: oPedMin,
          qtdMin: o.QtdMin || o.qtdMin || 0
        };
      })
    };

    // Adicionar ao relatório de otimização
    setResult((prev: any) => {
      const prevReport = prev ? prev.report : [];
      const updatedReport = [newItem, ...prevReport];
      const activeSwaps = updatedReport.filter((it: any) => !disregardedCodes.has(it.codInterno));
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

    // Salvar no localStorage
    try {
      const stored = localStorage.getItem("itens_manuais_adicionados");
      const list = stored ? JSON.parse(stored) : [];
      list.push({
        codInterno: randomCod,
        ean: offerEan,
        descricao: oferta.descricao || oferta.Descricao || item.descricao,
        laboratorio: offerLab,
        distribuidora: offerDist,
        codDist: offerCodDist,
        qtd: qtyToAdd,
        precoLiquido: offerPrecoLiq,
        precoFabrica: offerPrecoFab,
        condicao: offerCondicao,
        prazo: offerPrazo,
        dataAdicao: new Date().toISOString(),
        origem: "encomenda",
        idEncomenda: item.idEncomenda
      });
      localStorage.setItem("itens_manuais_adicionados", JSON.stringify(list));
    } catch (e) {
      console.error("Erro ao salvar item manual no localStorage:", e);
    }

    // Salvar no Turso via endpoint
    try {
      fetch("/api/salvar-item-manual", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          item: {
            codInterno: randomCod,
            ean: offerEan,
            descricao: oferta.descricao || oferta.Descricao || item.descricao,
            laboratorio: offerLab,
            distribuidora: offerDist,
            codDist: offerCodDist,
            qtd: qtyToAdd,
            precoLiquido: offerPrecoLiq,
            precoFabrica: offerPrecoFab,
            condicao: offerCondicao,
            prazo: offerPrazo,
            dataAdicao: new Date().toISOString(),
            origem: "encomenda",
            idEncomenda: item.idEncomenda
          },
          cnpj: config.cnpj || ""
        })
      }).catch(e => console.error("Erro ao salvar item manual no Turso:", e));
    } catch (e) {
      console.error("Erro ao salvar item manual no Turso:", e);
    }

    // Feedback visual
    setEncomendasActionSuccessKey(itemKey);
    setEncomendasAddedKeys(prev => new Set(prev).add(itemKey));
    setTimeout(() => {
      setEncomendasActionSuccessKey(null);
    }, 2500);
  };

  // Confirmar Importação de Encomendas - Salva como itens manuais com origem="encomenda"
  const handleConfirmImportEncomendas = async () => {
    const itensParaImportar = encomendasWithOffers.filter(e => e.selecionada && e.temOfertas && e.ofertaSelecionada);
    if (itensParaImportar.length === 0) return;

    try {
      for (const item of itensParaImportar) {
        const oferta = item.ofertaSelecionada;
        const randomCod = "MANUAL-" + Date.now() + "-" + Math.floor(1000 + Math.random() * 9000);
        
        const offerEan = String(oferta.ean || oferta.Ean || item.ean || "").trim();
        const offerDesc = oferta.descricao || oferta.Descricao || item.descricao;
        const offerLab = oferta.laboratorio || oferta.Laboratorio || oferta.nom_laborat || "";
        const offerDist = oferta.distribuidora || oferta.NomeDist || (oferta.codDist ? `Distribuidora ${oferta.codDist}` : "Distribuidora");
        const offerPrecoLiq = Number(oferta.pliquidoUni || oferta.pliquido || oferta.precoLiquido || oferta.preco || oferta.Preco || 0);
        const offerPrecoFab = Number(oferta.pfabrica || oferta.Pfabrica || oferta.precoOriginal || oferta.precoFabrica || 0);
        const offerEstoque = Number(oferta.estoque !== undefined ? oferta.estoque : (oferta.Estoque !== undefined ? oferta.Estoque : 9999));
        const offerCodDist = Number(oferta.codDist !== undefined ? oferta.codDist : (oferta.CodDist !== undefined ? oferta.CodDist : 0));
        const offerCondicao = oferta.condicao || oferta.Condicao || oferta.NomeCondicao || "FIXA";
        const offerPrazo = Number(oferta.prazo !== undefined ? oferta.prazo : (oferta.Prazo !== undefined ? oferta.Prazo : 0));
        const offerCodProdDist = oferta.codProdutoDist || oferta.CodProdutoDist || oferta.cod_produtodist || "";
        const offerCodProd = oferta.codProduto || oferta.CodProduto || "";

        // Calcular pedido mínimo da distribuidora
        let offerPedMin = 150;
        const nameLower = (offerDist || "").toLowerCase();
        if (nameLower.includes("panpharma") || nameLower.includes("panfarma")) offerPedMin = 250;
        else if (nameLower.includes("profarma")) offerPedMin = 250;
        else if (nameLower.includes("santacruz") || nameLower.includes("santa cruz")) offerPedMin = 300;
        else if (nameLower.includes("servimed")) offerPedMin = 200;
        else if (nameLower.includes("gam")) offerPedMin = 150;
        else if (nameLower.includes("anb")) offerPedMin = 250;
        else if (nameLower.includes("orizon") || nameLower.includes("dimeval")) offerPedMin = 200;

        const newItem = {
          codInterno: randomCod,
          originalEan: offerEan,
          originalDescricao: offerDesc,
          originalLaboratorio: offerLab,
          originalPreco: offerPrecoFab > 0 ? offerPrecoFab : offerPrecoLiq,
          originalPmc: oferta.PMC && oferta.PMC > 0 ? oferta.PMC : (offerPrecoFab > 0 ? Number((offerPrecoFab * 1.4).toFixed(2)) : 0),
          novoEan: offerEan,
          novaDescricao: offerDesc,
          novoLaboratorio: offerLab,
          novoPreco: offerPrecoLiq,
          novoPmc: oferta.PMC && oferta.PMC > 0 ? oferta.PMC : (offerPrecoLiq > 0 ? Number((offerPrecoLiq * 1.4).toFixed(2)) : 0),
          qtd: item.qtdSelecionada,
          economiaUnit: Math.max(0, offerPrecoFab - offerPrecoLiq),
          economiaTotal: Math.max(0, offerPrecoFab - offerPrecoLiq) * item.qtdSelecionada,
          distribuidora: offerDist,
          estoque: offerEstoque,
          codDist: offerCodDist,
          condicao: offerCondicao,
          codProdutoDist: offerCodProdDist,
          prazo: offerPrazo,
          codProduto: offerCodProd,
          pedidoMinimo: offerPedMin,
          origem: "encomenda",
          idEncomenda: item.idEncomenda,
          alternatives: (item.ofertas || []).filter(Boolean).map((o: any) => {
            const oEan = String(o.ean || o.Ean || "").trim();
            const oDesc = o.descricao || o.Descricao || offerDesc;
            const oLab = o.laboratorio || o.Laboratorio || o.nom_laborat || offerLab;
            const oDist = o.distribuidora || o.NomeDist || (o.codDist ? `Distribuidora ${o.codDist}` : "Distribuidora");
            const oPLiq = Number(o.pliquidoUni || o.pliquido || o.precoLiquido || o.preco || o.Preco || 0);
            const oEst = Number(o.estoque !== undefined ? o.estoque : (o.Estoque !== undefined ? o.Estoque : 0));
            const oCodDist = Number(o.codDist !== undefined ? o.codDist : (o.CodDist !== undefined ? o.CodDist : 0));
            const oCond = o.condicao || o.Condicao || o.NomeCondicao || "FIXA";
            const oPrazo = Number(o.prazo !== undefined ? o.prazo : (o.Prazo !== undefined ? o.Prazo : 0));
            const oCodProdDist = o.codProdutoDist || o.CodProdutoDist || o.cod_produtodist || "";
            const oCodProd = o.codProduto || o.CodProduto || "";
            let oPedMin = 150;
            const oNameLower = (oDist || "").toLowerCase();
            if (oNameLower.includes("panpharma") || oNameLower.includes("panfarma")) oPedMin = 250;
            else if (oNameLower.includes("profarma")) oPedMin = 250;
            else if (oNameLower.includes("santacruz") || oNameLower.includes("santa cruz")) oPedMin = 300;
            else if (oNameLower.includes("servimed")) oPedMin = 200;
            else if (oNameLower.includes("gam")) oPedMin = 150;
            else if (oNameLower.includes("anb")) oPedMin = 250;
            else if (oNameLower.includes("orizon") || oNameLower.includes("dimeval")) oPedMin = 200;
            return {
              ean: oEan,
              descricao: oDesc,
              laboratorio: oLab,
              distribuidora: oDist,
              codDist: oCodDist,
              preco: oPLiq,
              precoLiquido: oPLiq,
              estoque: oEst,
              condicao: oCond,
              prazo: oPrazo,
              codProdutoDist: oCodProdDist,
              codProduto: oCodProd,
              pedidoMinimo: oPedMin,
              qtdMin: o.QtdMin || o.qtdMin || 0
            };
          })
        };

        // Adicionar ao relatório de otimização
        setResult((prev: any) => {
          const prevReport = prev ? prev.report : [];
          const updatedReport = [newItem, ...prevReport];
          const activeSwaps = updatedReport.filter((it: any) => !disregardedCodes.has(it.codInterno));
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

        // Salvar no localStorage
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
            qtd: item.qtdSelecionada,
            precoLiquido: offerPrecoLiq,
            precoFabrica: offerPrecoFab,
            condicao: offerCondicao,
            prazo: offerPrazo,
            dataAdicao: new Date().toISOString(),
            origem: "encomenda",
            idEncomenda: item.idEncomenda
          });
          localStorage.setItem("itens_manuais_adicionados", JSON.stringify(list));
        } catch (e) {
          console.error("Erro ao salvar item manual no localStorage:", e);
        }

        // Salvar no Turso via endpoint
        try {
          await fetch("/api/salvar-item-manual", {
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
                qtd: item.qtdSelecionada,
                precoLiquido: offerPrecoLiq,
                precoFabrica: offerPrecoFab,
                condicao: offerCondicao,
                prazo: offerPrazo,
                dataAdicao: new Date().toISOString(),
                origem: "encomenda",
                idEncomenda: item.idEncomenda
              },
              cnpj: config.cnpj || ""
            })
          });
        } catch (e) {
          console.error("Erro ao salvar item manual no Turso:", e);
        }
      }

      // Fechar modal e limpar estado
      setIsEncomendasImportOpen(false);
      setEncomendasList([]);
      setEncomendasWithOffers([]);
      
      // TODO: Chamar endpoint para confirmar encomendas no sistema externo
      // const idsConfirmar = itensParaImportar.map(i => ({ id: i.idEncomenda, fornecedor: i.ofertaSelecionada.distribuidora, dataPrevisao: new Date().toISOString().split('T')[0] }));
      // await fetch("/api/integracao/encomendas/confirmar-pedido", { method: "POST", ... });

    } catch (err: any) {
      console.error("Erro ao importar encomendas:", err);
      alert("Erro ao importar encomendas: " + err.message);
    }
  };

  // Switch tabs and automatically configure state for homologation
  const handleSwitchTab = (tab: "production" | "homologation" | "daily_items") => {
    setActiveTab(tab);
    setError(null);
    setResult(null);
    setLogs([]);
    setDisregardedCodes(new Set());
    setDisabledItemCodes(new Set());
    setBilledItemCodes(new Set());
    setOverriddenDistributors({});
    
    if (tab === "homologation") {
      setFileContent(HOMOLOGACAO_SICF_FILE);
      setFileName("pedido_homologacao_smartped.txt");
      setConfig({
        token: "79770c03eb119691f0355c5628c496e2",
        cnpj: "13408443000168",
        margemMinima: 0.01,
        tipos: ["G", "O"],
        permitirSemEstoque: false,
        useTestUrl: true,
        simulationMode: false,
        customProductionUrl: "https://api.smartped.com.br",
        customTestUrl: "https://apitest.smartped.com.br",
        customEndpoint: "/api/Condicoes/Molecula"
      });
    } else {
      setFileContent("");
      setFileName("");
      setConfig({
        token: "fddfd9871b77f44f243e145207c8e93a",
        cnpj: "13408443000168",
        margemMinima: 0.01,
        tipos: ["G", "O"],
        permitirSemEstoque: false,
        useTestUrl: false,
        simulationMode: false,
        customProductionUrl: "https://api.smartped.com.br",
        customTestUrl: "https://apitest.smartped.com.br",
        customEndpoint: "/api/Condicoes/Molecula"
      });
    }
  };

  const handleSaveRaw = () => {
    const rawHTML = document.documentElement.outerHTML;
    const blob = new Blob([rawHTML], { type: "text/html;charset=utf-8" });
    const url = URL.createObjectURL(blob);
    const link = document.createElement("a");
    link.href = url;
    link.download = `tela_raw_${new Date().toISOString().replace(/[:.]/g, '-')}.html`;
    document.body.appendChild(link);
    link.click();
    document.body.removeChild(link);
    URL.revokeObjectURL(url);
  };

  if (!isAuthenticated) {
    return (
      <>
        <div className="min-h-screen bg-[#E4E3E0] text-[#141414] font-sans flex items-center justify-center p-4">
        {/* Formulário de Login Brutalista e Minimalista Sofisticado */}
        <div className="w-full max-w-md bg-[#F2F1EE] border-4 border-[#141414] p-8 shadow-[8px_8px_0px_0px_rgba(20,20,20,1)] relative overflow-hidden">
          {/* Top decorative icon */}
          <div className="flex justify-center mb-6">
            <div className="bg-[#141414] text-[#E4E3E0] p-4 rounded-none flex items-center justify-center border-2 border-[#141414] shadow-[4px_4px_0px_0px_rgba(20,20,20,0.3)]">
              <ShieldCheck className="w-10 h-10 text-emerald-400" />
            </div>
          </div>
          
          <div className="text-center mb-8">
            <h2 className="text-2xl font-black text-[#141414] tracking-tight uppercase">Acesso Restrito</h2>
            <div className="h-1 w-20 bg-[#141414] mx-auto my-3"></div>
            <p className="text-xs text-[#141414]/70 uppercase tracking-widest font-extrabold leading-relaxed">
              Painel Administrativo SmartPed
            </p>
          </div>

          <form onSubmit={handleLoginSubmit} className="space-y-5">
            <div>
              <label className="block text-[10px] font-black uppercase tracking-wider text-[#141414] mb-1.5 flex items-center gap-1">
                <Mail className="w-3 h-3" />
                E-mail do Administrador
              </label>
              <div className="relative">
                <input
                  type="email"
                  required
                  value={loginEmail}
                  onChange={(e) => {
                    setLoginEmail(e.target.value);
                    if (loginError) setLoginError("");
                  }}
                  placeholder="exemplo@email.com"
                  className="w-full bg-white border-2 border-[#141414] px-4 py-2.5 text-sm font-bold text-[#141414] placeholder-[#141414]/40 focus:outline-none focus:ring-2 focus:ring-[#141414]/20 rounded-none"
                />
              </div>
            </div>

            <div>
              <label className="block text-[10px] font-black uppercase tracking-wider text-[#141414] mb-1.5 flex items-center gap-1">
                <Lock className="w-3 h-3" />
                Senha de Acesso
              </label>
              <div className="relative">
                <input
                  type={showPassword ? "text" : "password"}
                  required
                  value={loginPassword}
                  onChange={(e) => {
                    setLoginPassword(e.target.value);
                    if (loginError) setLoginError("");
                  }}
                  placeholder="••••••••••••"
                  className="w-full bg-white border-2 border-[#141414] px-4 py-2.5 pr-10 text-sm font-bold text-[#141414] placeholder-[#141414]/40 focus:outline-none focus:ring-2 focus:ring-[#141414]/20 rounded-none"
                />
                <button
                  type="button"
                  onClick={() => setShowPassword(!showPassword)}
                  className="absolute right-3 top-1/2 -translate-y-1/2 text-[#141414]/60 hover:text-[#141414] transition-colors cursor-pointer"
                >
                  {showPassword ? <EyeOff className="w-4 h-4" /> : <Eye className="w-4 h-4" />}
                </button>
              </div>
            </div>

            {loginError && (
              <div className="p-3 bg-rose-100 border-2 border-rose-500 text-rose-950 text-xs font-bold flex items-start gap-2 rounded-none">
                <AlertCircle className="w-4 h-4 text-rose-600 shrink-0 mt-0.5" />
                <span>{loginError}</span>
              </div>
            )}

            <button
              type="submit"
              className="w-full bg-[#141414] text-[#E4E3E0] hover:bg-[#141414]/90 py-3 text-xs font-black uppercase tracking-widest transition-all border-2 border-[#141414] active:translate-y-1 active:shadow-none shadow-[4px_4px_0px_0px_rgba(20,20,20,0.3)] cursor-pointer flex items-center justify-center gap-2"
            >
              <ShieldCheck className="w-4 h-4" />
              <span>Autenticar Entrada</span>
            </button>

            <div className="relative flex py-2 items-center">
              <div className="flex-grow border-t-2 border-[#141414]/20"></div>
              <span className="flex-shrink mx-4 text-[10px] font-black uppercase text-[#141414]/50">OU</span>
              <div className="flex-grow border-t-2 border-[#141414]/20"></div>
            </div>

            <button
              type="button"
              onClick={handleGoogleLogin}
              className="w-full bg-white text-[#141414] hover:bg-gray-50 py-3 text-xs font-black uppercase tracking-widest transition-all border-2 border-[#141414] active:translate-y-1 active:shadow-none shadow-[4px_4px_0px_0px_rgba(20,20,20,0.3)] cursor-pointer flex items-center justify-center gap-2"
            >
              <svg className="w-4 h-4" viewBox="0 0 24 24">
                <path fill="#4285F4" d="M22.56 12.25c0-.78-.07-1.53-.2-2.25H12v4.26h5.92c-.26 1.37-1.04 2.53-2.21 3.31v2.77h3.57c2.08-1.92 3.28-4.74 3.28-8.09z"/>
                <path fill="#34A853" d="M12 23c2.97 0 5.46-.98 7.28-2.66l-3.57-2.77c-.98.66-2.23 1.06-3.71 1.06-2.86 0-5.29-1.93-6.16-4.53H2.18v2.84C3.99 20.53 7.7 23 12 23z"/>
                <path fill="#FBBC05" d="M5.84 14.09c-.22-.66-.35-1.36-.35-2.09s.13-1.43.35-2.09V7.06H2.18C1.43 8.55 1 10.22 1 12s.43 3.45 1.18 4.94l2.85-2.22.81-.63z"/>
                <path fill="#EA4335" d="M12 5.38c1.62 0 3.06.56 4.21 1.64l3.15-3.15C17.45 2.09 14.97 1 12 1 7.7 1 3.99 3.47 2.18 7.06l3.66 2.84c.87-2.6 3.3-4.52 6.16-4.52z"/>
              </svg>
              <span>Entrar com Conta Google</span>
            </button>
          </form>

          <div className="mt-8 pt-5 border-t border-[#141414]/10 text-center">
            <span className="text-[9px] text-[#141414]/50 uppercase tracking-widest font-extrabold block">
              Sistema Seguro &bull; Conexão Criptografada
            </span>
          </div>
        </div>
      </div>


      </>
    );
  }

  return (
    <Suspense fallback={<div className="min-h-screen bg-[#E4E3E0] flex items-center justify-center"><RefreshCw className="w-8 h-8 animate-spin text-[#141414]" /></div>}>
    <div className="min-h-screen bg-[#E4E3E0] text-[#141414] font-sans pb-16">
      {/* Header Banner */}
      <header className="bg-[#DCDAD7] border-b border-[#141414] py-5 sticky top-0 z-10">
        <div className="max-w-7xl mx-auto px-4 sm:px-6 lg:px-8 flex flex-col sm:flex-row sm:items-center sm:justify-between gap-4">
          <div className="flex items-center space-x-3">
            <div className="bg-[#141414] text-[#E4E3E0] p-2.5 rounded-none flex items-center justify-center">
              <Sparkles className="w-5 h-5 fill-current" />
            </div>
            <div>
              <h1 className="text-lg font-extrabold text-[#141414] tracking-tight uppercase">Otimizador de Pedidos SmartPed</h1>
              <p className="text-[10px] text-[#141414]/70 mt-0.5 uppercase tracking-widest font-bold">
                Economize substituindo produtos por equivalentes mais baratos na distribuidora
              </p>
            </div>
          </div>
          <div className="flex items-center space-x-2 relative">
            <button
              onClick={handleSaveRaw}
              className="text-[10px] font-bold uppercase tracking-widest px-2.5 py-1.5 bg-blue-100 text-blue-800 border border-blue-400 hover:bg-blue-200 transition-colors cursor-pointer"
              title="Salvar tela para análise"
            >
              SALVAR TELA RAW
            </button>
            {backendStatus === "checking" && (
              <span className="text-[10px] font-bold uppercase tracking-widest px-2.5 py-1.5 bg-amber-100 text-amber-800 border border-amber-300 flex items-center space-x-1">
                <RefreshCw className="w-3 h-3 animate-spin" />
                <span>Verificando Motor...</span>
              </span>
            )}
            {backendStatus === "online" && (
              <span className="text-[10px] font-bold uppercase tracking-widest px-2.5 py-1.5 bg-emerald-100 text-emerald-800 border border-emerald-400 flex items-center space-x-1">
                <Wifi className="w-3 h-3" />
                <span>Motor Online</span>
              </span>
            )}
            {backendStatus === "offline" && (
              <span className="text-[10px] font-bold uppercase tracking-widest px-2.5 py-1.5 bg-rose-100 text-rose-800 border border-rose-400 flex items-center space-x-1">
                <WifiOff className="w-3 h-3 text-rose-600 animate-pulse" />
                <span>Motor Offline</span>
              </span>
            )}

            {/* Version / Build Info */}
            <div className="text-[9px] font-mono text-gray-500 bg-gray-100 border border-gray-200 px-2 py-1 flex items-center gap-2 select-text">
              <span>{typeof __BUILD_INFO__ !== 'undefined' ? __BUILD_INFO__.version : 'dev'}</span>
              <span className="text-gray-400">|</span>
              <span>{typeof __BUILD_INFO__ !== 'undefined' ? __BUILD_INFO__.commit : ''}</span>
            </div>

            {/* Parâmetros do Otimizador Trigger */}
            <div className="relative">
              <button
                onClick={() => setIsConfigOpen(!isConfigOpen)}
                className={`text-[10px] font-bold uppercase tracking-widest px-2.5 py-1.5 transition-all flex items-center space-x-1 rounded cursor-pointer border ${
                  isConfigOpen
                    ? "bg-[#141414] text-[#E4E3E0] border-[#141414]"
                    : "bg-[#141414]/10 text-[#141414] hover:bg-[#141414]/20 border-[#141414]/20"
                }`}
              >
                <span>⚙️ Parâmetros</span>
              </button>

              {isConfigOpen && (
                <>
                  {/* Backdrop Overlay */}
                  <div 
                    onClick={() => setIsConfigOpen(false)}
                    className="fixed inset-0 bg-black/40 backdrop-blur-sm z-50 cursor-pointer transition-opacity"
                  />
                  
                  {/* Drawer Container */}
                  <div className="fixed right-0 top-0 h-screen w-full sm:w-[480px] bg-white shadow-2xl z-50 flex flex-col text-slate-800 text-left border-l border-[#141414]/15">
                    {/* Drawer Header */}
                    <div className="flex justify-between items-center p-5 border-b border-[#141414]/10 bg-[#DCDAD7]">
                      <div className="flex items-center space-x-2">
                        <span className="text-base">⚙️</span>
                        <h2 className="font-serif italic font-bold text-base text-[#141414]">
                          Parâmetros do Otimizador
                        </h2>
                      </div>
                      <button
                        onClick={() => setIsConfigOpen(false)}
                        className="text-[#141414] hover:bg-[#141414]/10 p-1.5 rounded-full transition-colors cursor-pointer"
                      >
                        <X className="w-5 h-5" />
                      </button>
                    </div>

                    {/* Drawer Body (Scrollable) */}
                    <div className="flex-1 overflow-y-auto p-6 space-y-6 scrollbar-thin">
                      <ConfigurationPanel
                        config={config}
                        onChange={setConfig}
                        onOptimize={() => {
                          handleOptimize();
                          setIsConfigOpen(false);
                        }}
                        isLoading={isLoading}
                        disabled={!fileContent}
                        externalSuppliers={externalSuppliers}
                        onUpdateExternalSuppliers={handleUpdateExternalSuppliers}
                        authorizedCompanies={authorizedCompanies}
                        onUpdateAuthorizedCompanies={setAuthorizedCompanies}
                        isAdmin={isAdmin}
                      />
                    </div>
                  </div>
                </>
              )}
            </div>

            <span className="text-[10px] font-bold uppercase tracking-widest px-2.5 py-1.5 bg-[#141414] text-[#E4E3E0]">
              Formato SICF
            </span>
            <span className="text-[10px] font-bold uppercase tracking-widest px-2.5 py-1.5 bg-[#E4E3E0] text-[#141414] border border-[#141414]">
              Conexão Direta SmartPed
            </span>
            <button
              onClick={handleLogout}
              className="text-[10px] font-black uppercase tracking-widest px-2.5 py-1.5 bg-rose-100 hover:bg-rose-200 text-rose-800 border border-rose-400 transition-colors cursor-pointer flex items-center space-x-1"
              title="Sair do painel administrador"
            >
              <span>🚪 Sair</span>
            </button>
          </div>
        </div>
      </header>

      {/* Tab Navigation */}
      <div className="max-w-7xl mx-auto px-4 sm:px-6 lg:px-8 mt-6">
        <div className="flex border-b border-[#141414]">
          <button
            onClick={() => setMainView("optimize")}
            className={`py-3 px-6 text-xs font-bold uppercase tracking-wider border-t border-l border-r border-transparent rounded-none transition-all flex items-center space-x-2 ${
              mainView === "optimize"
                ? "bg-[#DCDAD7] border-[#141414] text-[#141414] border-b-[#E4E3E0] -mb-[1px] z-10 font-extrabold"
                : "text-[#141414]/60 hover:text-[#141414] hover:bg-[#DCDAD7]/50"
            }`}
          >
            <span>⚡ Otimizador de Pedidos</span>
          </button>
          <button
            onClick={() => setMainView("returns")}
            className={`py-3 px-6 text-xs font-bold uppercase tracking-wider border-t border-l border-r border-transparent rounded-none transition-all flex items-center space-x-2 ${
              mainView === "returns"
                ? "bg-[#DCDAD7] border-[#141414] text-[#141414] border-b-[#E4E3E0] -mb-[1px] z-10 font-extrabold"
                : "text-[#141414]/60 hover:text-[#141414] hover:bg-[#DCDAD7]/50"
            }`}
          >
            <span>📋 Acompanhamento de Retornos</span>
          </button>
          <button
            onClick={() => setMainView("daily_items")}
            className={`py-3 px-6 text-xs font-bold uppercase tracking-wider border-t border-l border-r border-transparent rounded-none transition-all flex items-center space-x-2 ${
              mainView === "daily_items"
                ? "bg-[#DCDAD7] border-[#141414] text-[#141414] border-b-[#E4E3E0] -mb-[1px] z-10 font-extrabold"
                : "text-[#141414]/60 hover:text-[#141414] hover:bg-[#DCDAD7]/50"
            }`}
          >
            <span>📅 Itens do Dia</span>
          </button>
        </div>
      </div>

      {/* Main Container */}
      <main className="max-w-7xl mx-auto px-4 sm:px-6 lg:px-8 mt-6">
        {/* Alerts & Errors */}
        {error && (
          <div className="mb-6 p-4 bg-rose-100 border border-rose-400 rounded-none text-rose-900 flex items-start space-x-3">
            <AlertCircle className="w-5 h-5 text-rose-700 shrink-0 mt-0.5" />
            <div>
              <p className="text-xs font-bold uppercase tracking-wide">Falha na Otimização</p>
              <p className="text-xs text-rose-800 mt-1 font-mono">{error}</p>
              <div className="mt-3">
                <button
                  onClick={async () => {
                    setConfig(prev => ({ ...prev, simulationMode: true }));
                    if (fileContent) {
                      await handleOptimize(undefined, undefined, true);
                    }
                  }}
                  className="text-[10px] font-bold uppercase tracking-wider text-[#E4E3E0] bg-[#141414] hover:bg-neutral-800 px-3 py-1.5 rounded-none"
                >
                  Ativar Modo Simulação (Offline) para Teste
                </button>
              </div>
            </div>
          </div>
        )}

        {/* Views */}
        {mainView === "daily_items" && (
          <LazyDailyItemsView 
            config={config} 
            onInjectRedistribution={(injectedReport: any[], virtualFileContent: string) => {
              setFileContent(virtualFileContent);
              setFileName(`redistribuicao_faltas_${Date.now()}.txt`);
              
              // Extrair valores de pedido mínimo das condições injetadas na remontagem
              const newMinimums: Record<string, number> = {};
              for (const item of injectedReport) {
                if (item.distribuidora && item.distribuidora !== "Não Encontrados" && item.distribuidora !== "Sem Estoque") {
                  const cond = item.condicao || "FIXA";
                  const prz = item.prazo !== undefined ? item.prazo : 0;
                  const compoundKey = `${item.distribuidora} [${cond} | ${prz}d]`;
                  const itemMin = item.pedidoMinimo || 150; // Fallback se zerado
                  newMinimums[compoundKey] = itemMin;
                }
              }
              setDistributorMinimums(prev => ({
                ...prev,
                ...newMinimums
              }));

              setResult({
                cnpj: config.cnpj,
                summary: {
                  totalItems: injectedReport.length,
                  itemsTreated: injectedReport.length,
                  itemsSwapped: injectedReport.filter(it => it.originalEan !== it.novoEan).length,
                  totalSavings: injectedReport.reduce((sum, it) => sum + (it.economiaTotal || 0), 0)
                },
                report: injectedReport
              });
              setMainView("optimize");
              
              // Limpar filtros/desconsiderações anteriores para que todos os novos itens venham selecionados por padrão
              setDisregardedCodes(new Set());
              setDisabledItemCodes(new Set());
              setBilledItemCodes(new Set());
              setOverriddenDistributors({});
            }}
          />
        )}
        
        {mainView === "optimize" && (
          <div className="mb-8">
            <UploadBox
              fileContent={fileContent}
              fileName={fileName}
              onFileLoaded={handleFileLoaded}
              onClearFile={handleClearFile}
              onOptimize={handleOptimize}
              isLoading={isLoading}
              distributors={distributors}
              disabledDistributors={disabledDistributors}
              onToggleDistributor={handleToggleDistributor}
              isLoadingDistributors={isLoadingDistributors}
              cnpj={config.cnpj}
              onImportPreDistributed={(map, virtualFileContent, detectedCnpj) => {
                setFileContent(virtualFileContent);
                setFileName(`importacao_log_${Date.now()}.txt`);
                
                if (detectedCnpj) {
                  setConfig(prev => ({
                    ...prev,
                    cnpj: detectedCnpj
                  }));
                }

                setDisregardedCodes(new Set());
                setDisabledItemCodes(new Set());
                setBilledItemCodes(new Set());
                setOverriddenDistributors({});
                setPreDistributedMap(map);

                // Executar otimização real imediatamente com o mapa temporário
                handleOptimize(virtualFileContent, map);
              }}
              onImportDirectReport={(injectedReport: any[], virtualFileContent: string, detectedCnpj?: string) => {
                setFileContent(virtualFileContent);
                setFileName(`importacao_log_${Date.now()}.txt`);
                
                if (detectedCnpj) {
                  setConfig(prev => ({
                    ...prev,
                    cnpj: detectedCnpj
                  }));
                }

                // Configurar valores mínimos de pedido compostos
                const newMinimums: Record<string, number> = {};
                for (const item of injectedReport) {
                  if (item.distribuidora && item.distribuidora !== "Não Encontrados" && item.distribuidora !== "Sem Estoque") {
                    const cond = item.condicao || "FIXA";
                    const prz = item.prazo !== undefined ? item.prazo : 0;
                    const compoundKey = `${item.distribuidora} [${cond} | ${prz}d]`;
                    const itemMin = item.pedidoMinimo || 150;
                    newMinimums[compoundKey] = itemMin;
                  }
                }
                setDistributorMinimums(prev => ({
                  ...prev,
                  ...newMinimums
                }));

                setResult({
                  cnpj: detectedCnpj || config.cnpj,
                  summary: {
                    totalItems: injectedReport.length,
                    itemsTreated: injectedReport.length,
                    itemsSwapped: injectedReport.filter(it => it.originalEan !== it.novoEan).length,
                    totalSavings: injectedReport.reduce((sum, it) => sum + (it.economiaTotal || 0), 0)
                  },
                  report: injectedReport
                });
                
                // Limpar seleções e desconsiderações para refletir exatamente os itens importados
                setDisregardedCodes(new Set());
                setDisabledItemCodes(new Set());
                setBilledItemCodes(new Set());
                setOverriddenDistributors({});
                setLogs(["[SISTEMA] Lote pré-distribuído importado com sucesso via Log de Payload!"]);
              }}
            />
          </div>
        )}

        {mainView === "returns" && selectedDailyOrder && (
          <div className="space-y-6 mb-8 animate-fade-in">
            <div className="flex justify-between items-center bg-[#DCDAD7] border border-[#141414] p-4">
              <button
                onClick={() => setSelectedDailyOrder(null)}
                className="flex items-center space-x-2 text-xs font-bold uppercase tracking-wider text-[#141414] hover:underline"
              >
                <ArrowLeft className="w-4 h-4" />
                <span>Voltar para Lista de Pedidos</span>
              </button>
              <span className="text-[10px] font-mono uppercase bg-[#141414] text-[#E4E3E0] px-2 py-1 font-bold">
                Pedido #{selectedDailyOrder.numPedido}
              </span>
            </div>

            <div className="bg-white border border-[#141414]/20 p-6 rounded-none shadow-sm">
              <LazyOrderReturnView
                orderReturn={selectedDailyOrder.detalhes || selectedDailyOrder}
                numPedido={selectedDailyOrder.numPedido}
                cnpjLoja={selectedDailyOrder.detalhes?.Retorno?.CnpjLoja || config.cnpj}
                dataPedido={selectedDailyOrder.dataPedido}
                itemsFaturados={[]}
                isReRoutingShortages={isReRoutingShortages}
                onReRouteShortages={async () => {
                  const details = selectedDailyOrder.detalhes || selectedDailyOrder;
                  if (!details?.Retorno?.Itens) return;
                  setIsReRoutingShortages(true);
                  try {
                    const items = details.Retorno.Itens;
                    const shortages = items.filter((it: any) => it.QuantFaturada < it.Quant);
                    
                    if (shortages.length === 0) {
                      alert("Nenhum corte foi detectado neste faturamento.");
                      setIsReRoutingShortages(false);
                      return;
                    }

                    let reRoutedCount = 0;
                    const logMessages: string[] = [];

                    for (const shortage of shortages) {
                      const missingQty = shortage.Quant - shortage.QuantFaturada;
                      const currentDistCod = shortage.CodDist;

                      const storedCutsStr = localStorage.getItem("cortes_recentes");
                      const cortesRecentes = storedCutsStr ? JSON.parse(storedCutsStr) : {};

                      const response = await fetch("/api/search-products", {
                        method: "POST",
                        headers: { "Content-Type": "application/json" },
                        body: JSON.stringify({
                          query: shortage.Ean,
                          token: config.token,
                          cnpj: config.cnpj,
                          useTestUrl: config.useTestUrl,
                          simulationMode: config.simulationMode,
                          tipos: config.tipos,
                          margemMinima: config.margemMinima,
                          permitirSemEstoque: config.permitirSemEstoque,
                          cortesRecentes
                        })
                      });
                      const data = await response.json();
                      if (response.ok && data.items && data.items.length > 0) {
                        const alternatives = data.items.filter((it: any) => it.codDist !== currentDistCod && it.estoque > 0);
                        if (alternatives.length > 0) {
                          alternatives.sort((a: any, b: any) => a.precoLiquido - b.precoLiquido);
                          const nextBest = alternatives[0];
                          reRoutedCount++;
                          logMessages.push(`[REENVIO FALTA] Falta de ${missingQty} un de ${shortage.Ean} re-roteada para ${nextBest.distribuidora} (Preço: R$ ${nextBest.precoLiquido.toFixed(2)})`);
                        } else {
                          logMessages.push(`[FALTA SEM OPÇÃO] EAN ${shortage.Ean} - Sem fornecedor alternativo viável com estoque.`);
                        }
                      }
                    }

                    if (reRoutedCount > 0) {
                      setDailyOrderLogs(prev => [...prev, ...logMessages]);
                      alert(`Sucesso! ${reRoutedCount} corte(s) de itens foram re-roteados com sucesso para novos distribuidores alternativos com estoque.`);
                    } else {
                      alert("Não foram encontradas ofertas alternativas viáveis com estoque disponível para os cortes detectados.");
                    }
                  } catch (err: any) {
                    console.error(err);
                    alert("Erro ao re-rotear faltas: " + err.message);
                  } finally {
                    setIsReRoutingShortages(false);
                  }
                }}
                onExportShortages={() => {
                  const details = selectedDailyOrder.detalhes || selectedDailyOrder;
                  if (!details?.Retorno?.Itens) return;
                  const items = details.Retorno.Itens;
                  const shortages = items.filter((it: any) => it.QuantFaturada < it.Quant);
                  if (shortages.length === 0) {
                    alert("Nenhum corte foi detectado neste faturamento.");
                    return;
                  }
                  const headers = ["EAN", "Codigo_Dist", "Condicao", "Qtd_Solicitada", "Qtd_Faturada", "Qtd_Falta", "Preco_Liquido", "Motivo_Corte"];
                  const rows = shortages.map((it: any) => {
                    const missing = it.Quant - it.QuantFaturada;
                    return [
                      it.Ean,
                      it.CodDist,
                      it.Condicao,
                      it.Quant,
                      it.QuantFaturada,
                      missing,
                      it.Preco.toFixed(2),
                      `"${it.Motivo || 'Corte Comercial'}"`
                    ];
                  });
                  const csvContent = "\ufeff" + [headers.join(";"), ...rows.map((r: any) => r.join(";"))].join("\r\n");
                  const blob = new Blob([csvContent], { type: "text/csv;charset=utf-8;" });
                  const url = URL.createObjectURL(blob);
                  const link = document.createElement("a");
                  link.setAttribute("href", url);
                  link.setAttribute("download", `relatorio_faltas_pedido_${selectedDailyOrder.numPedido}.csv`);
                  document.body.appendChild(link);
                  link.click();
                  document.body.removeChild(link);
                }}
              />
            </div>
          </div>
        )}

        {mainView === "returns" && !selectedDailyOrder && (
          <div className="space-y-6 mb-8">
            {/* Direct Return Controller Card */}
            <div className="bg-[#DCDAD7] border border-[#141414] p-6 rounded-none">
              <div className="flex flex-col lg:flex-row lg:items-center lg:justify-between gap-6">
                <div>
                  <h2 className="font-serif italic text-lg text-[#141414]">Consultar Pedido por Número</h2>
                  <p className="text-[10px] text-[#141414]/70 uppercase font-semibold tracking-wider mt-1">
                    Digite o número de um pedido específico para consultar seu faturamento e cortes em tempo real.
                  </p>
                </div>
                
                <div className="flex flex-wrap items-center gap-4">
                  <div className="flex items-center space-x-2">
                    <span className="text-[10px] font-bold uppercase text-[#141414]/60 tracking-wider">Número do Pedido:</span>
                    <input
                      type="text"
                      value={directNumPedido}
                      onChange={(e) => setDirectNumPedido(e.target.value)}
                      placeholder="Ex: 5321"
                      className="bg-white border border-[#141414] text-[#141414] text-xs font-mono font-bold px-3 py-2 rounded-none focus:outline-none w-32"
                    />
                  </div>

                  <div className="flex items-center space-x-3">
                    <label className="flex items-center space-x-1.5 text-[10px] font-bold uppercase cursor-pointer select-none">
                      <input
                        type="checkbox"
                        checked={directAutoPollReturn}
                        onChange={(e) => setDirectAutoPollReturn(e.target.checked)}
                        className="rounded-none border-[#141414] text-[#141414] focus:ring-0"
                      />
                      <span>Auto-Consultar (10s)</span>
                    </label>

                    <button
                      onClick={handleCheckDirectOrderReturn}
                      disabled={isCheckingDirectReturn || !directNumPedido.trim()}
                      className="flex items-center space-x-1.5 bg-[#141414] text-[#E4E3E0] hover:bg-neutral-800 disabled:opacity-50 text-[10px] uppercase font-bold tracking-widest px-4 py-2.5 rounded-none transition-all border border-[#141414] cursor-pointer"
                    >
                      <RefreshCw className={`w-3.5 h-3.5 ${isCheckingDirectReturn ? "animate-spin" : ""}`} />
                      <span>{isCheckingDirectReturn ? "Consultando..." : "Consultar Status"}</span>
                    </button>
                  </div>
                </div>
              </div>

              {directReturnCheckLogs.length > 0 && (
                <div className="mt-4 pt-4 border-t border-[#141414]/10">
                  <h4 className="text-[10px] font-bold uppercase tracking-widest text-[#141414]/60 mb-2">Logs do Monitoramento</h4>
                  <div className="bg-[#141414] text-[#D1D5DB] p-4 font-mono text-[10px] leading-relaxed max-h-28 overflow-y-auto rounded-none border border-[#141414] space-y-1">
                    {directReturnCheckLogs.map((log: string, lIdx: number) => (
                      <p key={lIdx} className={log.includes("[SUCESSO]") ? "text-emerald-400 font-bold" : log.includes("[ERRO") ? "text-rose-400 font-bold" : "text-gray-300"}>
                        {log}
                      </p>
                    ))}
                  </div>
                </div>
              )}
            </div>

            {/* Monitoramento de Pedidos do Dia */}
            <div className="bg-white border border-gray-200 p-6 rounded-none shadow-sm">
              <div className="flex items-center space-x-2 border-b border-gray-100 pb-4 mb-4">
                <div className="w-1.5 h-6 bg-red-600 rounded-sm"></div>
                <h2 className="text-lg font-bold text-gray-800">Selecionar pedido</h2>
              </div>

              <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-4 mb-5">
                <div className="flex items-center space-x-3">
                  <button
                    onClick={() => {
                      if (highlightedOrder) {
                        setSelectedDailyOrder(highlightedOrder);
                      } else {
                        alert("Por favor, selecione um pedido primeiro clicando em 'selecionar'.");
                      }
                    }}
                    className="flex items-center space-x-2 border border-emerald-500 bg-[#f9fdfa] hover:bg-emerald-50 text-emerald-700 font-bold text-[11px] uppercase tracking-wider px-4 py-2 rounded transition-all cursor-pointer"
                  >
                    <span className="w-4 h-4 bg-emerald-500 text-white rounded-full flex items-center justify-center text-[10px] font-bold">✓</span>
                    <span>Confirmar</span>
                  </button>

                  <button
                    onClick={() => {
                      setHighlightedOrder(null);
                    }}
                    className="flex items-center space-x-2 border border-rose-400 bg-[#fdf9f9] hover:bg-rose-50 text-rose-700 font-bold text-[11px] uppercase tracking-wider px-4 py-2 rounded transition-all cursor-pointer"
                  >
                    <span className="w-4 h-4 bg-rose-500 text-white rounded-full flex items-center justify-center text-[10px] font-bold">×</span>
                    <span>Cancelar</span>
                  </button>
                </div>

                <button
                  onClick={handleCheckDailyOrders}
                  disabled={isCheckingDaily}
                  className="flex items-center space-x-1.5 bg-[#141414] text-[#E4E3E0] hover:bg-neutral-800 disabled:opacity-50 text-[10px] uppercase font-bold tracking-widest px-4 py-2.5 rounded transition-all border border-[#141414] cursor-pointer font-mono"
                >
                  <RefreshCw className={`w-3 h-3 ${isCheckingDaily ? "animate-spin" : ""}`} />
                  <span>{isCheckingDaily ? "Buscando Pedidos..." : "Carregar Pedidos Recentes"}</span>
                </button>
              </div>

              {dailyOrderLogs.length > 0 && (
                <div className="mb-5 pt-2 border-t border-gray-100">
                  <h4 className="text-[10px] font-bold uppercase tracking-widest text-gray-400 mb-2 font-mono">Logs do Monitoramento Diário</h4>
                  <div className="bg-[#141414] text-[#D1D5DB] p-3 font-mono text-[9px] leading-relaxed max-h-24 overflow-y-auto rounded-none border border-[#141414] space-y-1">
                    {dailyOrderLogs.map((log: string, lIdx: number) => (
                      <p key={lIdx} className={log.includes("[SUCESSO]") ? "text-emerald-400 font-bold" : log.includes("[ERRO") ? "text-rose-400 font-bold" : "text-gray-300"}>
                        {log}
                      </p>
                    ))}
                  </div>
                </div>
              )}

              {dailyOrders.length === 0 ? (
                <div className="bg-gray-50 border border-dashed border-gray-300 p-8 text-center rounded-none">
                  <Clock className="w-8 h-8 text-gray-400 mx-auto mb-3" />
                  <h3 className="text-xs font-bold uppercase tracking-wider text-gray-700">Nenhum pedido carregado</h3>
                  <p className="text-[11px] text-gray-500 max-w-md mx-auto mt-1">
                    Clique em <strong className="text-gray-800">"Carregar Pedidos Recentes"</strong> para listar as ordens enviadas recentemente.
                  </p>
                </div>
              ) : (
                <div className="overflow-x-auto border border-gray-200">
                  <table className="w-full text-left text-[11px] border-collapse bg-white">
                    <thead>
                      <tr className="bg-gray-50 text-gray-600 font-bold border-b border-gray-200 uppercase text-[9px] tracking-wider">
                        <th className="py-2.5 px-3 text-center w-28">#</th>
                        <th className="py-2.5 px-3 font-semibold text-gray-500">Cód Empresa</th>
                        <th className="py-2.5 px-4 font-semibold text-gray-500">Empresa</th>
                        <th className="py-2.5 px-4 text-center font-semibold text-gray-500">Nº Pedido</th>
                        <th className="py-2.5 px-4 font-semibold text-gray-500">Data Geração</th>
                        <th className="py-2.5 px-4 font-semibold text-gray-500">Tipo</th>
                        <th className="py-2.5 px-4 font-semibold text-gray-500">Cód. Vínculo</th>
                        <th className="py-2.5 px-3 text-center w-12">#</th>
                      </tr>
                    </thead>
                    <tbody className="divide-y divide-gray-100 text-gray-700">
                      {dailyOrders.map((order, idx) => {
                        const isSelected = highlightedOrder?.numPedido === order.numPedido;
                        return (
                          <tr 
                            key={idx} 
                            onClick={() => {
                              setHighlightedOrder(order);
                              setSelectedDailyOrder(order);
                            }}
                            className={`cursor-pointer transition-colors ${isSelected ? 'bg-emerald-50/40 font-bold' : 'hover:bg-gray-50/50'}`}
                          >
                            {/* Selecionar Action Button */}
                            <td className="py-2 px-3 text-center">
                              {isSelected ? (
                                <button 
                                  className="w-full py-1 text-[10px] font-bold uppercase bg-emerald-600 border border-emerald-600 text-white rounded transition-colors"
                                  onClick={(e) => {
                                    e.stopPropagation();
                                    setSelectedDailyOrder(order);
                                  }}
                                >
                                  selecionar
                                </button>
                              ) : (
                                <button 
                                  className="w-full py-1 text-[10px] font-bold uppercase bg-white border border-blue-500 text-blue-500 rounded hover:bg-blue-50 transition-colors"
                                  onClick={(e) => {
                                    e.stopPropagation();
                                    setHighlightedOrder(order);
                                  }}
                                >
                                  selecionar
                                </button>
                              )}
                            </td>

                            <td className="py-2.5 px-3 font-mono text-gray-600">1</td>
                            <td className="py-2.5 px-4 font-sans uppercase font-bold text-gray-700">CARLOS KIPPER LTDA</td>
                            <td className="py-2.5 px-4 text-center font-mono font-bold text-blue-600 text-xs">{order.numPedido}</td>
                            <td className="py-2.5 px-4 font-mono text-gray-600">{order.dataPedido}</td>
                            <td className="py-2.5 px-4 font-sans text-gray-500 font-medium">Normal</td>
                            <td className="py-2.5 px-4 text-gray-400 font-mono">-</td>
                            
                            {/* Red play/action icon */}
                            <td className="py-2.5 px-3 text-center">
                              <div className="w-5 h-5 rounded-full border border-red-200 bg-red-50 flex items-center justify-center text-red-600 mx-auto hover:bg-red-100 transition-colors">
                                <span className="text-[9px] pl-0.5">▶</span>
                              </div>
                            </td>
                          </tr>
                        );
                      })}
                    </tbody>
                  </table>
                </div>
              )}
            </div>
          </div>
        )}

        {/* Loading Spinner Overlays */}
        {isLoading && (
          <div className="py-12 flex flex-col items-center justify-center text-[#141414]/70">
            <RefreshCw className="w-8 h-8 animate-spin text-[#141414] mb-4" />
            <h3 className="text-xs font-bold uppercase tracking-widest text-[#141414]">Otimizando Pedido</h3>
            <p className="text-[10px] text-[#141414]/60 mt-1 max-w-sm text-center uppercase tracking-wide font-semibold">
              Aguarde enquanto fazemos a varredura do arquivo e buscamos as melhores condições de moléculas nas distribuidoras...
            </p>
          </div>
        )}

        {/* Results Visual Section */}
        {result && !isLoading && (
          <div className="space-y-6">
            <div className="bg-[#DCDAD7] border border-[#141414] rounded-none p-5 flex flex-col sm:flex-row sm:items-center sm:justify-between gap-4">
              <div className="flex items-center space-x-3">
                <div className="bg-green-700 text-white p-2.5 rounded-none">
                  <CheckCircle className="w-5 h-5" />
                </div>
                <div>
                  <h3 className="text-base font-serif italic text-[#141414]">Pedido Otimizado com Sucesso!</h3>
                  <p className="text-[10px] uppercase font-bold text-[#141414]/70 mt-1">
                    CNPJ do cabeçalho do arquivo: <span className="font-mono text-[#141414]">{result.cnpj}</span>.
                  </p>
                </div>
              </div>

              {/* Action Buttons */}
              <div className="flex flex-wrap items-center gap-2">
                <button
                  onClick={() => setShowStats(!showStats)}
                  className="flex items-center space-x-2 bg-[#E4E3E0] hover:bg-white text-[#141414] border border-[#141414] font-bold text-[10px] uppercase tracking-widest py-2.5 px-4 rounded-none transition-all cursor-pointer"
                  title={showStats ? "Esconder Estatísticas" : "Ver Estatísticas"}
                >
                  <ArrowDown className={`w-4 h-4 transition-transform ${showStats ? "rotate-180" : ""}`} />
                  <span>{showStats ? "Esconder Resumo" : "Ver Resumo Economia"}</span>
                </button>
                <button
                  onClick={handleSendBilling}
                  disabled={isBillingLoading}
                  className="flex items-center space-x-2 bg-emerald-700 hover:bg-emerald-800 disabled:opacity-50 text-white font-bold text-[10px] uppercase tracking-widest py-2.5 px-4 rounded-none transition-all border border-emerald-700 cursor-pointer shadow-sm animate-pulse-subtle"
                >
                  {isBillingLoading ? (
                    <>
                      <RefreshCw className="w-4 h-4 animate-spin" />
                      <span>Faturando...</span>
                    </>
                  ) : (
                    <>
                      <Truck className="w-4 h-4" />
                      <span>⚡ Enviar Todos os Pedidos Juntos</span>
                    </>
                  )}
                </button>
                <button
                  onClick={downloadSICF}
                  className="flex items-center space-x-2 bg-[#141414] hover:bg-neutral-800 text-[#E4E3E0] font-bold text-[10px] uppercase tracking-widest py-2.5 px-4 rounded-none transition-all border border-[#141414] cursor-pointer"
                >
                  <FileDown className="w-4 h-4" />
                  <span>Baixar Novo Pedido (SICF)</span>
                </button>
                <button
                  onClick={downloadCSV}
                  className="flex items-center space-x-2 bg-[#E4E3E0] hover:bg-white text-[#141414] border border-[#141414] font-bold text-[10px] uppercase tracking-widest py-2.5 px-4 rounded-none transition-all cursor-pointer"
                >
                  <span>Baixar Planilha (.csv)</span>
                </button>
              </div>
            </div>

            {/* Metrics & Charts (Retractable) */}
            {showStats && activeSummary && (
              <div className="animate-fade-in space-y-6">
                <OptimizationSummaryStats summary={activeSummary} report={activeReport} />
                <VisualChart report={activeReport} />
              </div>
            )}

            {/* DISTRIBUTOR MINIMUMS PANEL */}
            <div className="hidden bg-[#DCDAD7] border border-[#141414] p-6 rounded-none shadow-sm text-[#141414]">
              <div className="flex items-center space-x-2.5 mb-2">
                <Truck className="w-5 h-5 text-[#141414] shrink-0" />
                <h4 className="font-serif italic text-base font-bold text-[#141414]">
                  Divisão de Pedidos por Distribuidora & Faturamento Mínimo
                </h4>
              </div>
              <p className="text-xs text-[#141414]/70 uppercase tracking-wide font-semibold mb-6">
                Gerencie o faturamento mínimo exigido por cada distribuidora parceira para evitar cancelamentos. Use as opções inteligentes para dispersar ou completar pedidos.
              </p>

              <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-6">
                {distributorGroupings
                  .filter(g => g.name !== "Não Encontrados" && g.name !== "Sem Estoque")
                  .map((g, idx) => {
                    const minVal = getGroupMinVal(g.name);
                    const isMet = g.totalValue >= minVal;
                    const diff = minVal - g.totalValue;
                    const pct = minVal > 0 ? Math.min(100, (g.totalValue / minVal) * 100) : 100;

                    return (
                      <div key={idx} className="bg-[#E4E3E0] border border-[#141414] p-4 flex flex-col justify-between">
                        <div>
                          <div className="flex items-center justify-between">
                            <span className="text-xs font-black uppercase tracking-wider font-mono bg-[#141414] text-[#E4E3E0] px-2 py-0.5">
                              {g.name}
                            </span>
                            <button
                              onClick={() => handleDeleteDistributor(g.name)}
                              className="text-[#141414] hover:text-rose-700 transition-colors"
                            >
                              <Trash2 className="w-4 h-4" />
                            </button>
                          </div>
                            {isMet ? (
                              <span className="bg-emerald-100 border border-emerald-500 text-emerald-800 text-[9px] font-black uppercase tracking-widest px-1.5 py-0.5">
                                ✓ atingido
                              </span>
                            ) : (
                              <span className="bg-amber-100 border border-amber-500 text-amber-800 text-[9px] font-black uppercase tracking-widest px-1.5 py-0.5">
                                ⚠️ pendente
                              </span>
                            )}
                          
                          <div className="mt-4 grid grid-cols-2 gap-2 text-xs">
                            <div>
                              <p className="text-[9px] uppercase font-bold text-[#141414]/60">Itens Ativos</p>
                              <p className="font-bold text-[#141414] mt-0.5">{g.itemsCount} un</p>
                            </div>
                            <div>
                              <p className="text-[9px] uppercase font-bold text-[#141414]/60">Subtotal Atual</p>
                              <p className="font-bold text-[#141414] mt-0.5 font-mono">{formatCurrency(g.totalValue)}</p>
                            </div>
                          </div>

                          {/* Inline editable Minimum */}
                          <div className="mt-3 pt-3 border-t border-[#141414]/10 flex items-center justify-between text-xs">
                            <span className="text-[10px] uppercase font-bold text-[#141414]/60">Faturamento Mínimo</span>
                            <div className="flex items-center space-x-1">
                              <span className="font-mono text-[10px]">R$</span>
                              <input
                                type="number"
                                value={minVal}
                                onChange={(e) => {
                                  const val = Math.max(0, parseFloat(e.target.value) || 0);
                                  setDistributorMinimums(prev => ({ ...prev, [g.name]: val }));
                                }}
                                className="w-16 bg-white border border-[#141414] px-1.5 py-0.5 text-[10px] font-mono text-[#141414] font-bold text-center focus:outline-none"
                              />
                            </div>
                          </div>

                          {/* Progress bar */}
                          <div className="mt-4">
                            <div className="w-full bg-[#DCDAD7] h-2.5 border border-[#141414] overflow-hidden">
                              <div
                                className={`h-full transition-all duration-300 ${isMet ? "bg-emerald-600" : "bg-amber-50"}`}
                                style={{ width: `${pct}%` }}
                              />
                            </div>
                            <div className="flex justify-between items-center mt-1 text-[9px] font-mono font-bold text-[#141414]/70">
                              <span>{pct.toFixed(0)}% do mínimo</span>
                              {!isMet && <span>Faltam {formatCurrency(diff)}</span>}
                            </div>
                          </div>
                        </div>
                      </div>
                    );
                  })}
              </div>

              {/* Warning for "Não Encontrados" virtual supplier */}
              {distributorGroupings.some(g => g.name === "Não Encontrados") && (
                <div className="mt-6 p-4 bg-amber-50 border-2 border-amber-400 text-amber-900 rounded-none relative">
                  <button
                    onClick={() => handleDeleteDistributor("Não Encontrados")}
                    className="absolute top-2 right-2 text-amber-600 hover:text-amber-800 transition-colors"
                    title="Remover todos os itens não encontrados"
                  >
                    <Trash2 className="w-4 h-4" />
                  </button>
                  <div className="flex items-start space-x-3">
                    <AlertTriangle className="w-5 h-5 text-amber-600 shrink-0 mt-0.5" />
                    <div>
                      <p className="text-xs font-black uppercase tracking-wider">Aviso de Produtos Não Encontrados na SmartPed</p>
                      <p className="text-xs text-amber-800 mt-1 leading-relaxed">
                        Identificamos que <strong>{distributorGroupings.find(g => g.name === "Não Encontrados")?.itemsCount} itens</strong> do seu arquivo não possuem cadastro comercial ou ofertas de preços cadastradas nas distribuidoras. Eles foram agrupados sob a categoria <strong>"Não Encontrados"</strong> e serão ignorados durante o envio de faturamento para evitar erros, mas continuarão listados no relatório abaixo para que você os identifique com facilidade.
                      </p>
                    </div>
                  </div>
                </div>
              )}

              {/* Warning for "Sem Estoque" virtual supplier */}
              {distributorGroupings.some(g => g.name === "Sem Estoque") && (
                <div className="mt-4 p-4 bg-rose-50 border-2 border-rose-400 text-rose-900 rounded-none relative">
                  <button
                    onClick={() => handleDeleteDistributor("Sem Estoque")}
                    className="absolute top-2 right-2 text-rose-600 hover:text-rose-800 transition-colors"
                    title="Remover todos os itens sem estoque"
                  >
                    <Trash2 className="w-4 h-4" />
                  </button>
                  <div className="flex items-start space-x-3">
                    <AlertTriangle className="w-5 h-5 text-rose-600 shrink-0 mt-0.5" />
                    <div>
                      <p className="text-xs font-black uppercase tracking-wider">Aviso de Produtos Sem Estoque</p>
                      <p className="text-xs text-rose-800 mt-1 leading-relaxed">
                        Identificamos que <strong>{distributorGroupings.find(g => g.name === "Sem Estoque")?.itemsCount} itens</strong> não possuem estoque disponível em nenhuma distribuidora retornada. Eles foram agrupados sob a categoria <strong>"Sem Estoque"</strong> e serão ignorados durante o faturamento a menos que você os redirecione manualmente no relatório abaixo.
                      </p>
                    </div>
                  </div>
                </div>
              )}
            </div>


            
            {/* WIZARDS */}
            {dispersingFromDist && (
              <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/60 backdrop-blur-sm p-4">
                <div className="bg-[#141414] text-[#E4E3E0] p-6 rounded-none border-2 border-white/20 shadow-2xl max-w-4xl w-full max-h-[90vh] flex flex-col">
                <div className="flex items-center justify-between border-b border-[#E4E3E0]/20 pb-4 mb-4">
                  <div>
                    <h4 className="font-serif italic text-base font-bold text-rose-400">
                      Assistente de Dispersão - Distribuir Pedido de {dispersingFromDist}
                    </h4>
                    <p className="text-[10px] text-gray-400 uppercase tracking-widest font-mono mt-1">
                      Enviando os produtos deste lote para as demais distribuidoras ativas na tela que tenham estoque
                    </p>
                  </div>
                  <button
                    onClick={() => setDispersingFromDist(null)}
                    className="text-[#E4E3E0]/70 hover:text-white transition-all cursor-pointer"
                  >
                    <X className="w-5 h-5" />
                  </button>
                </div>

                <div className="overflow-auto flex-1">
                  <table className="w-full text-[10px] uppercase font-mono tracking-wider text-left border-collapse relative">
                    <thead>
                      <tr className="border-b border-[#E4E3E0]/20 text-gray-400">
                        <th className="p-2 w-8 text-center">
                          <input
                            type="checkbox"
                            checked={dispersingSelectedCodes.size === dispersingEligibleItems.length && dispersingEligibleItems.length > 0}
                            onChange={(e) => {
                              if (e.target.checked) {
                                setDispersingSelectedCodes(new Set(dispersingEligibleItems.map(i => i.item.codInterno)));
                              } else {
                                setDispersingSelectedCodes(new Set());
                              }
                            }}
                            className="rounded-none border-gray-600 text-rose-600 focus:ring-0 cursor-pointer w-4 h-4"
                          />
                        </th>
                        <th className="p-2">Produto</th>
                        <th className="p-2 text-center">Qtde</th>
                        <th className="p-2 text-right">Preço Atual</th>
                        <th className="p-2 text-right">Novo Destino</th>
                        <th className="p-2 text-right">Novo Preço</th>
                      </tr>
                    </thead>
                    <tbody>
                      {dispersingEligibleItems.map((eleg, idx) => {
                        const isChecked = dispersingSelectedCodes.has(eleg.item.codInterno);
                        const isNoOption = !eleg.offer;
                        return (
                          <tr key={idx} className={`${isNoOption ? "opacity-50" : "hover:bg-white/5"}`}>
                            <td className="p-2 text-center">
                              {!isNoOption && (
                                <input
                                  type="checkbox"
                                  checked={isChecked}
                                  onChange={(e) => {
                                    const newSet = new Set(dispersingSelectedCodes);
                                    if (e.target.checked) {
                                      newSet.add(eleg.item.codInterno);
                                    } else {
                                      newSet.delete(eleg.item.codInterno);
                                    }
                                    setDispersingSelectedCodes(newSet);
                                  }}
                                  className="rounded-none border-gray-600 text-rose-600 focus:ring-0 cursor-pointer w-4 h-4"
                                />
                              )}
                            </td>
                            <td className="p-2 font-bold text-white">{eleg.item.novaDescricao}</td>
                            <td className="p-2 text-center font-bold text-white">{eleg.item.qtd}</td>
                            <td className="p-2 text-right text-gray-400">{formatCurrency(eleg.currentPrice)}</td>
                            <td className="p-2 text-right text-rose-400 font-bold">{eleg.targetDist}</td>
                            <td className="p-2 text-right text-white">
                              {eleg.targetPrice > 0 ? formatCurrency(eleg.targetPrice) : "-"}
                            </td>
                          </tr>
                        );
                      })}
                    </tbody>
                  </table>
                </div>

                <div className="flex justify-end space-x-2 pt-4 border-t border-white/10 mt-4">
                  <button
                    onClick={() => setDispersingFromDist(null)}
                    className="px-4 py-2 border border-white/20 hover:bg-white/10 text-xs font-bold uppercase transition-all"
                  >
                    Cancelar
                  </button>
                  <button
                    onClick={() => handleApplyDispersingTransfers(Array.from(dispersingSelectedCodes))}
                    disabled={dispersingSelectedCodes.size === 0}
                    className="bg-rose-600 hover:bg-rose-700 disabled:opacity-50 text-white px-5 py-2 text-xs font-bold uppercase transition-all border border-rose-600 cursor-pointer"
                  >
                    Confirmar Dispersão
                  </button>
                </div>
              </div>
              </div>
            )}

            {completingTargetDist && (
              <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/60 backdrop-blur-sm p-4">
                <div className="bg-[#141414] text-[#E4E3E0] p-6 rounded-none border-2 border-white/20 shadow-2xl max-w-4xl w-full max-h-[90vh] flex flex-col">
                <div className="flex items-center justify-between border-b border-[#E4E3E0]/20 pb-4 mb-4">
                  <div>
                    <h4 className="font-serif italic text-base font-bold text-emerald-400">
                      Assistente de Consolidação - Completar Pedido de {completingTargetDist}
                    </h4>
                    <p className="text-[10px] text-gray-400 uppercase tracking-widest font-mono mt-1">
                      Analisando produtos de outros distribuidores elegíveis para transferência
                    </p>
                  </div>
                  <button
                    onClick={() => setCompletingTargetDist(null)}
                    className="text-[#E4E3E0]/70 hover:text-white transition-all cursor-pointer"
                  >
                    <X className="w-5 h-5" />
                  </button>
                </div>

                <div className="overflow-auto flex-1">
                  <table className="w-full text-[10px] uppercase font-mono tracking-wider text-left border-collapse relative">
                    <thead>
                      <tr className="border-b border-[#E4E3E0]/20 text-gray-400">
                        <th className="p-2 w-8 text-center">
                          <input
                            type="checkbox"
                            checked={completingSelectedCodes.size === completingEligibleItems.length && completingEligibleItems.length > 0}
                            onChange={(e) => {
                              if (e.target.checked) {
                                setCompletingSelectedCodes(new Set(completingEligibleItems.map(i => i.item.codInterno)));
                              } else {
                                setCompletingSelectedCodes(new Set());
                              }
                            }}
                            className="rounded-none border-gray-600 text-emerald-600 focus:ring-0 cursor-pointer w-4 h-4"
                          />
                        </th>
                        <th className="p-2">Produto</th>
                        <th className="p-2 text-center">Qtde</th>
                        <th className="p-2 text-right">Preço Atual</th>
                        <th className="p-2 text-right">Novo Preço</th>
                        <th className="p-2 text-right">Acréscimo</th>
                      </tr>
                    </thead>
                    <tbody>
                      {completingEligibleItems.length === 0 && (
                        <tr>
                          <td colSpan={6} className="p-4 text-center text-gray-500">Nenhum item elegível encontrado nos outros pedidos.</td>
                        </tr>
                      )}
                      {completingEligibleItems.map((eleg, idx) => {
                        const isChecked = completingSelectedCodes.has(eleg.item.codInterno);
                        return (
                          <tr key={idx} className="hover:bg-white/5">
                            <td className="p-2 text-center">
                              <input
                                type="checkbox"
                                checked={isChecked}
                                onChange={(e) => {
                                  const newSet = new Set(completingSelectedCodes);
                                  if (e.target.checked) {
                                    newSet.add(eleg.item.codInterno);
                                  } else {
                                    newSet.delete(eleg.item.codInterno);
                                  }
                                  setCompletingSelectedCodes(newSet);
                                }}
                                className="rounded-none border-gray-600 text-emerald-600 focus:ring-0 cursor-pointer w-4 h-4"
                              />
                            </td>
                            <td className="p-2 font-bold text-white">{eleg.item.novaDescricao}</td>
                            <td className="p-2 text-center font-bold text-white">{eleg.item.qtd}</td>
                            <td className="p-2 text-right text-gray-400">
                              {formatCurrency(eleg.currentPrice)} <span className="text-[8px] bg-[#262626] px-1 py-0.5 rounded text-gray-300">{eleg.currentDist}</span>
                            </td>
                            <td className="p-2 text-right text-emerald-400 font-bold">{formatCurrency(eleg.targetPrice)}</td>
                            <td className="p-2 text-right text-amber-400">
                              +{eleg.pctIncrease.toFixed(1)}%
                            </td>
                          </tr>
                        );
                      })}
                    </tbody>
                  </table>
                </div>

                <div className="flex justify-end space-x-2 pt-4 border-t border-white/10 mt-4">
                  <button
                    onClick={() => setCompletingTargetDist(null)}
                    className="px-4 py-2 border border-white/20 hover:bg-white/10 text-xs font-bold uppercase transition-all"
                  >
                    Cancelar
                  </button>
                  <button
                    onClick={() => handleApplyCompletingTransfers(Array.from(completingSelectedCodes))}
                    disabled={completingSelectedCodes.size === 0}
                    className="bg-emerald-600 hover:bg-emerald-700 disabled:opacity-50 text-white px-5 py-2 text-xs font-bold uppercase transition-all border border-emerald-600 cursor-pointer"
                  >
                    Confirmar Consolidação
                  </button>
                </div>
              </div>
              </div>
            )}

            {/* MANUAL ITEM ADDITION BAR */}
            {/* Blocking Interception Modal if there are pending quantity/fracionado alerts */}
            {showQuantityInterception && pendingAlertItems.length > 0 ? (
              <ConfirmQuantitiesModal
                items={pendingAlertItems}
                onConfirmQty={handleConfirmQtyInInterception}
              />
            ) : (
              <div className="bg-white border border-[#141414] overflow-hidden shadow-sm">
                <div 
                  className="bg-[#141414] text-[#E4E3E0] px-5 py-4 flex items-center justify-between cursor-pointer select-none"
                  onClick={() => setIsSwapsTableVisible(!isSwapsTableVisible)}
                >
                  <div className="flex items-center space-x-3">
                    <div className={`transition-transform ${isSwapsTableVisible ? "rotate-90" : ""}`}>
                      <ChevronRight className="w-5 h-5" />
                    </div>
                    <h3 className="font-serif italic text-lg tracking-wide">Painel de Escolhas & Revisão de Substituições</h3>
                  </div>
                  <span className="text-[10px] font-mono uppercase bg-white/10 px-2 py-1 tracking-widest">
                    {isSwapsTableVisible ? "Recolher Painel" : "Expandir Painel"}
                  </span>
                </div>

                <LazyPendingOrdersTable billedGroups={billedGroups} onViewLogs={(logs, name) => setViewingLogs({groupKeys: [name], title: name})} />
                
                {isSwapsTableVisible && (
                  <div className="p-5 animate-fade-in">
                    <LazySwapsTable
                      report={activeReport}
                      rawReport={result ? result.report : []}
                      billedItemCodes={billedItemCodes}
                      disregardedCodes={disregardedCodes}
                      disabledItemCodes={disabledItemCodes}
                      onToggleDisregard={handleToggleDisregard}
                      onToggleDisabled={handleToggleDisabled}
                      onUpdateQty={handleUpdateQty}
                      distributorMinimums={distributorMinimums}
                      onSendBilling={handleSendBilling}
                      isBillingLoading={isBillingLoading}
                      billedGroups={billedGroups}
                      onStartCompletingWizard={handleStartCompletingWizard}
                      onDisperseItems={handleStartDispersingWizard}
                      isSearchingCompleting={isSearchingCompleting}
                      isDispersing={isDispersing}
                      onReopenModal={() => setIsBillingModalOpen(true)}
                      onUpdateMinimum={(distName, value) => {
                        setDistributorMinimums(prev => ({ ...prev, [distName]: value }));
                      }}
                      onUpdateDistributor={(codInterno, newDist) => {
                        setOverriddenDistributors(prev => ({ ...prev, [codInterno]: newDist }));
                      }}
                      onDeleteDistributor={handleDeleteDistributor}
                      distributorOrder={distributorOrder}
                      onSelectCondition={handleSelectCondition}
                      dailyOrders={dailyOrders}
                      config={config}
                    />
                  </div>
                )}
              </div>
            )}

          </div>
        )}

        {/* Billing Success Modal */}
        {/* Floating Buttons: Importar Encomendas + Manual Add (responsive stacking on mobile) */}
        {mainView === "optimize" && (
          <>
            {/* Importar Encomendas Button - mobile: bottom-20, desktop: bottom-28 */}
            <motion.div
              drag
              dragMomentum={false}
              whileDrag={{ scale: 1.1 }}
              onDragStart={() => (isDragging.current = true)}
              onDragEnd={() => setTimeout(() => (isDragging.current = false), 50)}
              className="fixed bottom-20 md:bottom-28 right-4 md:right-8 z-40"
            >
              <button
                onClick={() => {
                  if (!isDragging.current) {
                    handleImportEncomendas();
                  }
                }}
                className="bg-violet-700 hover:bg-violet-800 text-white rounded-full p-4 md:p-4 shadow-[4px_4px_0px_0px_rgba(20,20,20,1)] border-2 border-[#141414] cursor-pointer flex items-center justify-center space-x-2 transition-colors group"
                title="Importar Encomendas Pendentes"
              >
                <ShoppingBag className="w-6 h-6 group-hover:scale-110 transition-transform" />
              </button>
            </motion.div>

            {/* Manual Add Button (+) - mobile: bottom-8, desktop: bottom-8 */}
            <motion.div
              drag
              dragMomentum={false}
              whileDrag={{ scale: 1.1 }}
              onDragStart={() => (isDragging.current = true)}
              onDragEnd={() => setTimeout(() => (isDragging.current = false), 50)}
              className="fixed bottom-8 right-4 md:right-8 z-40"
            >
              <button
                onClick={() => {
                  if (!isDragging.current) setIsManualAddModalOpen(true);
                }}
                className="bg-emerald-700 hover:bg-emerald-800 text-white rounded-full p-4 md:p-4 shadow-[4px_4px_0px_0px_rgba(20,20,20,1)] border-2 border-[#141414] cursor-pointer flex items-center justify-center space-x-2 transition-colors group"
              >
                <Plus className="w-6 h-6 group-hover:scale-110 transition-transform" />
              </button>
            </motion.div>
          </>
        )}

        {/* Manual Add Modal */}
        <AnimatePresence>
          {isManualAddModalOpen && (
            <motion.div
              drag
              dragListener={false}
              dragMomentum={false}
              dragConstraints={{ left: -800, right: 800, top: -600, bottom: 800 }}
              dragControls={dragControls}
              className="fixed z-50 p-3"
              style={{
                top: "5vh",
                left: "5vw",
                width: manualModalWidth,
                height: manualModalHeight,
                minWidth: "450px",
                minHeight: "350px",
                maxWidth: "calc(100vw - 2rem)",
                maxHeight: "calc(100vh - 4rem)",
              }}
              onPointerDown={(e) => {
                if (e.target === e.currentTarget) {
                  dragControls.start(e);
                }
              }}
            >
              <div
                className="relative bg-[#DCDAD7] border-4 border-[#141414] rounded-none flex flex-col shadow-[8px_8px_0px_0px_rgba(20,20,20,1)] w-full h-full overflow-hidden select-text"
                ref={(node) => {
                  if (node) {
                    const observer = new ResizeObserver((entries) => {
                      for (let entry of entries) {
                        const { width, height } = entry.contentRect;
                        if (width > 100 && height > 100) {
                          const wStr = `${width}px`;
                          const hStr = `${height}px`;
                          sessionStorage.setItem('manual_modal_width', wStr);
                          sessionStorage.setItem('manual_modal_height', hStr);
                        }
                      }
                    });
                    observer.observe(node);
                  }
                }}
              >
                {/* Resize Handles on all 4 edges and 4 corners */}
                {/* Top Edge */}
                <div 
                  className="absolute top-0 left-3 right-3 h-2 cursor-ns-resize z-35 bg-transparent"
                  onPointerDown={(e) => {
                    e.stopPropagation();
                    const startY = e.clientY;
                    const parent = e.currentTarget.parentElement;
                    if (!parent) return;
                    const startH = parent.offsetHeight;
                    const onMove = (me: PointerEvent) => {
                      const dy = me.clientY - startY;
                      const newH = Math.max(350, startH - dy);
                      setManualModalHeight(`${newH}px`);
                      sessionStorage.setItem('manual_modal_height', `${newH}px`);
                    };
                    const onUp = () => {
                      window.removeEventListener('pointermove', onMove);
                      window.removeEventListener('pointerup', onUp);
                    };
                    window.addEventListener('pointermove', onMove);
                    window.addEventListener('pointerup', onUp);
                  }}
                />
                {/* Bottom Edge */}
                <div 
                  className="absolute bottom-0 left-3 right-3 h-2 cursor-ns-resize z-35 bg-transparent"
                  onPointerDown={(e) => {
                    e.stopPropagation();
                    const startY = e.clientY;
                    const parent = e.currentTarget.parentElement;
                    if (!parent) return;
                    const startH = parent.offsetHeight;
                    const onMove = (me: PointerEvent) => {
                      const dy = me.clientY - startY;
                      const newH = Math.max(350, startH + dy);
                      setManualModalHeight(`${newH}px`);
                      sessionStorage.setItem('manual_modal_height', `${newH}px`);
                    };
                    const onUp = () => {
                      window.removeEventListener('pointermove', onMove);
                      window.removeEventListener('pointerup', onUp);
                    };
                    window.addEventListener('pointermove', onMove);
                    window.addEventListener('pointerup', onUp);
                  }}
                />
                {/* Left Edge */}
                <div 
                  className="absolute left-0 top-3 bottom-3 w-2 cursor-ew-resize z-35 bg-transparent"
                  onPointerDown={(e) => {
                    e.stopPropagation();
                    const startX = e.clientX;
                    const parent = e.currentTarget.parentElement;
                    if (!parent) return;
                    const startW = parent.offsetWidth;
                    const onMove = (me: PointerEvent) => {
                      const dx = me.clientX - startX;
                      const newW = Math.max(450, startW - dx);
                      setManualModalWidth(`${newW}px`);
                      sessionStorage.setItem('manual_modal_width', `${newW}px`);
                    };
                    const onUp = () => {
                      window.removeEventListener('pointermove', onMove);
                      window.removeEventListener('pointerup', onUp);
                    };
                    window.addEventListener('pointermove', onMove);
                    window.addEventListener('pointerup', onUp);
                  }}
                />
                {/* Right Edge */}
                <div 
                  className="absolute right-0 top-3 bottom-3 w-2 cursor-ew-resize z-35 bg-transparent"
                  onPointerDown={(e) => {
                    e.stopPropagation();
                    const startX = e.clientX;
                    const parent = e.currentTarget.parentElement;
                    if (!parent) return;
                    const startW = parent.offsetWidth;
                    const onMove = (me: PointerEvent) => {
                      const dx = me.clientX - startX;
                      const newW = Math.max(450, startW + dx);
                      setManualModalWidth(`${newW}px`);
                      sessionStorage.setItem('manual_modal_width', `${newW}px`);
                    };
                    const onUp = () => {
                      window.removeEventListener('pointermove', onMove);
                      window.removeEventListener('pointerup', onUp);
                    };
                    window.addEventListener('pointermove', onMove);
                    window.addEventListener('pointerup', onUp);
                  }}
                />
                {/* Corners: Top-Left */}
                <div 
                  className="absolute top-0 left-0 w-4 h-4 cursor-nwse-resize z-40 bg-transparent"
                  onPointerDown={(e) => {
                    e.stopPropagation();
                    const startX = e.clientX;
                    const startY = e.clientY;
                    const parent = e.currentTarget.parentElement;
                    if (!parent) return;
                    const startW = parent.offsetWidth;
                    const startH = parent.offsetHeight;
                    const onMove = (me: PointerEvent) => {
                      const dx = me.clientX - startX;
                      const dy = me.clientY - startY;
                      const newW = Math.max(450, startW - dx);
                      const newH = Math.max(350, startH - dy);
                      setManualModalWidth(`${newW}px`);
                      setManualModalHeight(`${newH}px`);
                      sessionStorage.setItem('manual_modal_width', `${newW}px`);
                      sessionStorage.setItem('manual_modal_height', `${newH}px`);
                    };
                    const onUp = () => {
                      window.removeEventListener('pointermove', onMove);
                      window.removeEventListener('pointerup', onUp);
                    };
                    window.addEventListener('pointermove', onMove);
                    window.addEventListener('pointerup', onUp);
                  }}
                />
                {/* Top-Right */}
                <div 
                  className="absolute top-0 right-0 w-4 h-4 cursor-nesw-resize z-40 bg-transparent"
                  onPointerDown={(e) => {
                    e.stopPropagation();
                    const startX = e.clientX;
                    const startY = e.clientY;
                    const parent = e.currentTarget.parentElement;
                    if (!parent) return;
                    const startW = parent.offsetWidth;
                    const startH = parent.offsetHeight;
                    const onMove = (me: PointerEvent) => {
                      const dx = me.clientX - startX;
                      const dy = me.clientY - startY;
                      const newW = Math.max(450, startW + dx);
                      const newH = Math.max(350, startH - dy);
                      setManualModalWidth(`${newW}px`);
                      setManualModalHeight(`${newH}px`);
                      sessionStorage.setItem('manual_modal_width', `${newW}px`);
                      sessionStorage.setItem('manual_modal_height', `${newH}px`);
                    };
                    const onUp = () => {
                      window.removeEventListener('pointermove', onMove);
                      window.removeEventListener('pointerup', onUp);
                    };
                    window.addEventListener('pointermove', onMove);
                    window.addEventListener('pointerup', onUp);
                  }}
                />
                {/* Bottom-Left */}
                <div 
                  className="absolute bottom-0 left-0 w-4 h-4 cursor-nesw-resize z-40 bg-transparent"
                  onPointerDown={(e) => {
                    e.stopPropagation();
                    const startX = e.clientX;
                    const startY = e.clientY;
                    const parent = e.currentTarget.parentElement;
                    if (!parent) return;
                    const startW = parent.offsetWidth;
                    const startH = parent.offsetHeight;
                    const onMove = (me: PointerEvent) => {
                      const dx = me.clientX - startX;
                      const dy = me.clientY - startY;
                      const newW = Math.max(450, startW - dx);
                      const newH = Math.max(350, startH + dy);
                      setManualModalWidth(`${newW}px`);
                      setManualModalHeight(`${newH}px`);
                      sessionStorage.setItem('manual_modal_width', `${newW}px`);
                      sessionStorage.setItem('manual_modal_height', `${newH}px`);
                    };
                    const onUp = () => {
                      window.removeEventListener('pointermove', onMove);
                      window.removeEventListener('pointerup', onUp);
                    };
                    window.addEventListener('pointermove', onMove);
                    window.addEventListener('pointerup', onUp);
                  }}
                />
                {/* Bottom-Right */}
                <div 
                  className="absolute bottom-0 right-0 w-4 h-4 cursor-nwse-resize z-40 bg-transparent"
                  onPointerDown={(e) => {
                    e.stopPropagation();
                    const startX = e.clientX;
                    const startY = e.clientY;
                    const parent = e.currentTarget.parentElement;
                    if (!parent) return;
                    const startW = parent.offsetWidth;
                    const startH = parent.offsetHeight;
                    const onMove = (me: PointerEvent) => {
                      const dx = me.clientX - startX;
                      const dy = me.clientY - startY;
                      const newW = Math.max(450, startW + dx);
                      const newH = Math.max(350, startH + dy);
                      setManualModalWidth(`${newW}px`);
                      setManualModalHeight(`${newH}px`);
                      sessionStorage.setItem('manual_modal_width', `${newW}px`);
                      sessionStorage.setItem('manual_modal_height', `${newH}px`);
                    };
                    const onUp = () => {
                      window.removeEventListener('pointermove', onMove);
                      window.removeEventListener('pointerup', onUp);
                    };
                    window.addEventListener('pointermove', onMove);
                    window.addEventListener('pointerup', onUp);
                  }}
                />
                {/* Modal Header */}
                <div 
                  className="bg-[#141414] text-[#E4E3E0] px-5 py-3.5 flex items-center justify-between border-b-2 border-[#141414] cursor-move select-none shrink-0"
                  onPointerDown={(e) => dragControls.start(e)}
                >
                  <div className="flex flex-col">
                    <div className="flex items-center space-x-2.5">
                      <Search className="w-5 h-5 text-emerald-400" />
                      <h2 className="font-serif italic text-lg sm:text-xl font-bold tracking-tight">
                        Cockpit Comercial & Adição Manual (SmartPed)
                      </h2>
                      <span className="bg-emerald-500/20 text-emerald-300 border border-emerald-500/30 text-[10px] font-mono px-2 py-0.5 font-bold uppercase tracking-wider hidden sm:inline-block">
                        SmartPed Live API
                      </span>
                    </div>
                    {manualAddOriginItem && (
                      <p className="text-[10px] text-emerald-300 font-mono mt-1">
                        Origem: {manualAddOriginItem.ean} - {manualAddOriginItem.descricao} / {manualAddOriginItem.laboratorio}
                      </p>
                    )}
                  </div>
                   <button onClick={() => { setIsManualAddModalOpen(false); setManualQuery(""); setManualAddOriginItem(null); if (manualAddFromEncomendas) { setEncomendasAddedKeys(prev => new Set([...prev, manualAddFromEncomendas])); setManualAddFromEncomendas(null); setIsEncomendasImportOpen(true); } }} className="text-[#E4E3E0]/70 hover:text-white transition-colors cursor-pointer">
                    <XCircle className="w-6 h-6" />
                  </button>
                </div>
                
                {/* Modal Content */}
                <div className="p-4 sm:p-5 overflow-y-auto flex-1 flex flex-col space-y-4 min-w-0 w-full max-w-full">
                  {/* Busca e Controles do Cockpit */}
                  <div className="bg-white border-2 border-[#141414] p-3 sm:p-4 shadow-[3px_3px_0px_0px_rgba(20,20,20,1)]">
                    <div className="grid grid-cols-1 md:grid-cols-12 gap-3 items-end">
                      <div className="md:col-span-8">
                        <label className="block text-[10px] uppercase font-bold text-[#141414] mb-1">
                          Buscar Produto na SmartPed (Nome, Molécula ou EAN)
                        </label>
                        <div className="relative">
                          <input
                            type="text"
                            placeholder="Ex: Losartana, Ablok, 7891106000888..."
                            value={manualQuery}
                            onChange={(e) => setManualQuery(e.target.value)}
                            onKeyDown={(e) => { if (e.key === "Enter") handleManualSearch(); }}
                            className="w-full bg-white border-2 border-[#141414] px-3 py-2 text-xs font-mono rounded-none focus:outline-none focus:ring-1 focus:ring-[#141414]"
                          />
                          <button 
                            onClick={handleManualSearch}
                            className="absolute right-3 top-2.5 text-[#141414]/40 hover:text-[#141414] transition-colors cursor-pointer"
                          >
                            <Search className="w-4 h-4" />
                          </button>
                        </div>
                      </div>
                      <div className="md:col-span-4 flex gap-2">
                        <button
                          onClick={() => {
                            if (manualQuery.trim() === "") {
                              setManualSearchResults([]);
                              setManualAllAlternatives([]);
                              setManualMinimos([]);
                              setManualDcbFound(null);
                              setManualSearchError(null);
                              setManualSearchLogs([]);
                            } else {
                              handleManualSearch();
                            }
                          }}
                          disabled={isManualSearching}
                          className="w-full flex items-center justify-center space-x-2 bg-[#141414] hover:bg-neutral-800 text-[#E4E3E0] font-bold text-xs uppercase tracking-wider py-2.5 px-4 rounded-none transition-all border-2 border-[#141414] cursor-pointer disabled:opacity-50"
                        >
                          {isManualSearching ? (
                            <RefreshCw className="w-4 h-4 animate-spin text-emerald-400" />
                          ) : (
                            <Search className="w-4 h-4 text-emerald-400" />
                          )}
                          <span>{isManualSearching ? "Buscando..." : "Consultar Ofertas"}</span>
                        </button>
                      </div>
                    </div>

                    {/* Barra de Filtros e Deduplicação Inteligente */}
                    <div className="mt-3 pt-3 border-t border-gray-200 flex flex-wrap items-center justify-between gap-3 text-xs font-mono">
                      <div className="flex items-center gap-4 flex-wrap">
                        <label className="flex items-center gap-2 cursor-pointer select-none">
                          <input 
                            type="checkbox"
                            checked={manualDeduplicar}
                            onChange={(e) => setManualDeduplicar(e.target.checked)}
                            className="w-4 h-4 accent-emerald-700 rounded-none cursor-pointer"
                          />
                          <span className="font-bold text-[#141414] text-[11px] uppercase">
                            Deduplicação Inteligente (Melhor Prazo & Preço)
                          </span>
                        </label>

                        <label className="flex items-center gap-2 cursor-pointer select-none">
                          <input 
                            type="checkbox"
                            checked={manualApenasEstoque}
                            onChange={(e) => setManualApenasEstoque(e.target.checked)}
                            className="w-4 h-4 accent-emerald-700 rounded-none cursor-pointer"
                          />
                          <span className="font-bold text-[#141414] text-[11px] uppercase">
                            Apenas com Estoque
                          </span>
                        </label>
                      </div>

                      {manualDcbFound && (
                        <div className="bg-blue-50 border border-blue-300 text-blue-900 px-2 py-0.5 text-[10px] font-bold flex items-center gap-1.5">
                          <Sparkles className="w-3 h-3 text-blue-600" />
                          <span>Molécula / DCB: {manualDcbFound}</span>
                        </div>
                      )}
                    </div>
                  </div>

                  {/* Feedback de Carregamento */}
                  {isManualSearching && (
                    <div className="py-8 flex flex-col items-center justify-center text-[#141414]/70 bg-white border-2 border-dashed border-[#141414]/40">
                      <RefreshCw className="w-7 h-7 animate-spin text-emerald-600 mb-2" />
                      <span className="text-xs uppercase font-bold tracking-wider text-[#141414]">
                        Consultando SmartPed e canais de distribuição ao vivo...
                      </span>
                    </div>
                  )}

                  {/* Mensagem de Erro */}
                  {manualSearchError && (
                    <div className="p-3 bg-rose-100 border-2 border-rose-400 text-rose-900 text-xs font-mono flex items-center gap-2">
                      <AlertCircle className="w-4 h-4 shrink-0" />
                      <span>{manualSearchError}</span>
                    </div>
                  )}

                  {/* Grade Comercial de Ofertas (12 Colunas) */}
                  {!isManualSearching && processedManualOffers.length > 0 && (
                    <div className="space-y-2 flex-1 flex flex-col min-w-0 w-full max-w-full">
                      <div className="flex items-center justify-between text-[11px] uppercase font-bold text-[#141414] font-mono px-1">
                        <span className="flex items-center gap-2">
                          <span>Ofertas Comerciais: {processedManualOffers.length}</span>
                          {manualDeduplicar && manualAllAlternatives.length > processedManualOffers.length && (
                            <span className="text-gray-500 font-normal text-[10px]">
                              ({manualAllAlternatives.length} brutas agrupadas por distribuidora)
                            </span>
                          )}
                        </span>
                        <span className="text-emerald-700 font-bold">
                          ✓ Ordenado por Menor Preço Líquido
                        </span>
                      </div>

                      <div ref={offersTableRef} className="overflow-x-auto overflow-y-visible custom-table-scrollbar border-2 border-[#141414] bg-white shadow-[3px_3px_0px_0px_rgba(20,20,20,1)] pb-2 w-full max-w-full block relative">
                        <div className="absolute top-1 right-1 z-20" ref={colSettingsRef}>
                          <button onClick={() => setShowColSettings(!showColSettings)} className="bg-[#141414] hover:bg-gray-800 text-white p-1.5 cursor-pointer transition-colors" title="Configurar colunas">
                            <Settings className="w-3.5 h-3.5" />
                          </button>
                          {showColSettings && (
                            <div className="absolute right-0 top-full mt-1 bg-white border-2 border-[#141414] shadow-[3px_3px_0px_0px_rgba(20,20,20,1)] z-30 min-w-[180px] py-1">
                              <div className="px-2 py-1 text-[9px] font-bold uppercase tracking-wider text-gray-500 border-b border-gray-200">Colunas</div>
                              {OFFER_COL_KEYS.map(k => (
                                <label key={k} className="flex items-center gap-2 px-2 py-1 hover:bg-gray-50 cursor-pointer text-[10px] font-mono">
                                  <input
                                    type="checkbox"
                                    checked={offerColVis[k]}
                                    onChange={() => setOfferColVis(prev => ({ ...prev, [k]: !prev[k] }))}
                                    className="w-3 h-3 accent-[#141414]"
                                  />
                                  {OFFER_COL_LABELS[k]}
                                </label>
                              ))}
                              <div className="border-t border-gray-200 mt-1 pt-1 px-2">
                                <button onClick={() => { const v: Record<string, boolean> = {}; const w: Record<string, number> = {}; for (const k of OFFER_COL_KEYS) { v[k] = OFFER_COL_DEFAULTS[k].vis; w[k] = OFFER_COL_DEFAULTS[k].w; } setOfferColVis(v); setOfferColWidths(w); }} className="text-[9px] text-gray-500 hover:text-[#141414] cursor-pointer font-bold">Restaurar padrão</button>
                              </div>
                            </div>
                          )}
                        </div>
                        <table className="w-full text-xs font-mono whitespace-nowrap" style={{ minWidth: OFFER_COL_KEYS.filter(k => offerColVis[k]).reduce((s, k) => s + offerColWidths[k], 0) }}>
                          <thead className="bg-[#141414] text-white sticky top-0 z-10">
                            <tr>
                              {offerColVis.dist && <th className="px-2.5 py-2 border-b border-r border-gray-700 font-bold uppercase tracking-wider text-[10px] text-left relative select-none" style={{ width: offerColWidths.dist }}><span>Distribuidora</span><div className="absolute right-0 top-0 bottom-0 w-1 cursor-col-resize hover:bg-gray-500/50" onMouseDown={(e) => { e.preventDefault(); setResizingCol({ key: 'dist', startX: e.clientX, startW: offerColWidths.dist }); }} /></th>}
                              {offerColVis.prod && <th className="px-2.5 py-2 border-b border-r border-gray-700 font-bold uppercase tracking-wider text-[10px] text-left relative select-none" style={{ width: offerColWidths.prod }}><span>Produto, EAN & Lab</span><div className="absolute right-0 top-0 bottom-0 w-1 cursor-col-resize hover:bg-gray-500/50" onMouseDown={(e) => { e.preventDefault(); setResizingCol({ key: 'prod', startX: e.clientX, startW: offerColWidths.prod }); }} /></th>}
                              {offerColVis.pfab && <th className="px-2.5 py-2 border-b border-r border-gray-700 font-bold uppercase tracking-wider text-[10px] text-right relative select-none" style={{ width: offerColWidths.pfab }}><span>P. Fábrica</span><div className="absolute right-0 top-0 bottom-0 w-1 cursor-col-resize hover:bg-gray-500/50" onMouseDown={(e) => { e.preventDefault(); setResizingCol({ key: 'pfab', startX: e.clientX, startW: offerColWidths.pfab }); }} /></th>}
                              {offerColVis.desc && <th className="px-2.5 py-2 border-b border-r border-gray-700 font-bold uppercase tracking-wider text-[10px] text-right relative select-none" style={{ width: offerColWidths.desc }}><span>Desc %</span><div className="absolute right-0 top-0 bottom-0 w-1 cursor-col-resize hover:bg-gray-500/50" onMouseDown={(e) => { e.preventDefault(); setResizingCol({ key: 'desc', startX: e.clientX, startW: offerColWidths.desc }); }} /></th>}
                              {offerColVis.descExtra && <th className="px-2.5 py-2 border-b border-r border-gray-700 font-bold uppercase tracking-wider text-[10px] text-right relative select-none" style={{ width: offerColWidths.descExtra }}><span>Desc Extra %</span><div className="absolute right-0 top-0 bottom-0 w-1 cursor-col-resize hover:bg-gray-500/50" onMouseDown={(e) => { e.preventDefault(); setResizingCol({ key: 'descExtra', startX: e.clientX, startW: offerColWidths.descExtra }); }} /></th>}
                              {offerColVis.st && <th className="px-2.5 py-2 border-b border-r border-gray-700 font-bold uppercase tracking-wider text-[10px] text-right relative select-none" style={{ width: offerColWidths.st }}><span>ST (R$)</span><div className="absolute right-0 top-0 bottom-0 w-1 cursor-col-resize hover:bg-gray-500/50" onMouseDown={(e) => { e.preventDefault(); setResizingCol({ key: 'st', startX: e.clientX, startW: offerColWidths.st }); }} /></th>}
                              {offerColVis.pLiq && <th className="px-2.5 py-2 border-b border-r border-gray-700 font-bold uppercase tracking-wider text-[10px] text-right text-emerald-400 relative select-none" style={{ width: offerColWidths.pLiq }}><span>Preço Líquido</span><div className="absolute right-0 top-0 bottom-0 w-1 cursor-col-resize hover:bg-gray-500/50" onMouseDown={(e) => { e.preventDefault(); setResizingCol({ key: 'pLiq', startX: e.clientX, startW: offerColWidths.pLiq }); }} /></th>}
                              {offerColVis.prazo && <th className="px-2.5 py-2 border-b border-r border-gray-700 font-bold uppercase tracking-wider text-[10px] text-center relative select-none" style={{ width: offerColWidths.prazo }}><span>Prazo / Mín</span><div className="absolute right-0 top-0 bottom-0 w-1 cursor-col-resize hover:bg-gray-500/50" onMouseDown={(e) => { e.preventDefault(); setResizingCol({ key: 'prazo', startX: e.clientX, startW: offerColWidths.prazo }); }} /></th>}
                              {offerColVis.acao && <th className="px-2.5 py-2 border-b border-gray-700 font-bold uppercase tracking-wider text-[10px] text-center relative select-none" style={{ width: offerColWidths.acao }}><span>Qtd / Ação</span><div className="absolute right-0 top-0 bottom-0 w-1 cursor-col-resize hover:bg-gray-500/50" onMouseDown={(e) => { e.preventDefault(); setResizingCol({ key: 'acao', startX: e.clientX, startW: offerColWidths.acao }); }} /></th>}
                            </tr>
                          </thead>
                          <tbody className="divide-y divide-gray-200">
                            {processedManualOffers.map((offer: any, oIdx: number) => {
                              const offerEan = String(offer.ean || offer.Ean || "").trim();
                              const offerDesc = offer.descricao || offer.Descricao || offer.nom_produto || "";
                              const offerLab = offer.laboratorio || offer.Laboratorio || offer.nom_laborat || "";
                              const offerDist = offer.distribuidora || offer.NomeDist || (offer.codDist ? `Distribuidora ${offer.codDist}` : "Distribuidora");
                              const offerCodDist = offer.codDist !== undefined ? offer.codDist : (offer.CodDist !== undefined ? offer.CodDist : 0);
                              const offerCond = offer.condicao || offer.Condicao || offer.NomeCondicao || "FIXA";
                              const offerPrazo = Number(offer.prazo !== undefined ? offer.prazo : (offer.Prazo !== undefined ? offer.Prazo : 0));
                              
                              const pFabrica = Number(offer.pfabrica || offer.Pfabrica || offer.precoOriginal || offer.precoFabrica || 0);
                              const pLiquido = Number(offer._calcPLiquido || offer.pliquidoUni || offer.pliquido || offer.precoLiquido || offer.preco || 0);
                              const descPerc = Number(offer.desconto !== undefined ? offer.desconto : (offer.Desconto !== undefined ? offer.Desconto : (pFabrica > 0 && pLiquido < pFabrica ? ((1 - (pLiquido / pFabrica)) * 100) : 0)));
                              const descExtraPerc = Number(offer.descextra !== undefined ? offer.descextra : (offer.DescExtra !== undefined ? offer.DescExtra : 0));
                              const valorSt = Number(offer.valorst !== undefined ? offer.valorst : (offer.ValorSt !== undefined ? offer.ValorSt : 0));
                              const qtdMinItem = resolveQtdMinima(offer);
                              const pedMinDist = resolvePedidoMinimo(offer, manualMinimos) || getManualDistMinimo(offerCodDist, offerCond, offerPrazo, offerDist);
                              const estoqueNum = resolveEstoque(offer);

                              const itemRowKey = `${offerEan}_${offerCodDist}_${offerCond}_${offerPrazo}_${oIdx}`;
                              const currentQty = manualQuantities[itemRowKey] !== undefined ? manualQuantities[itemRowKey] : Math.max(1, qtdMinItem);
                              const isAddedSuccess = manualActionSuccessKey === itemRowKey;

                              const isPromotionalMin = qtdMinItem > 1;

                              return (
                                <tr key={itemRowKey} className={`transition-colors ${isPromotionalMin ? "bg-amber-50/70 hover:bg-amber-100/70 border-l-4 border-l-amber-500" : (oIdx % 2 === 0 ? "bg-white hover:bg-gray-50" : "bg-gray-50/70 hover:bg-gray-100/70")}`}>
                                  {offerColVis.dist && <td className="px-2.5 py-2 border-r border-gray-200 align-middle" style={{ width: offerColWidths.dist }}>
                                    <div className="font-bold text-[#141414] select-text">{offerDist}</div>
                                    <div className="text-[9px] text-gray-500 flex items-center flex-wrap gap-1 mt-0.5">
                                      <span className="bg-gray-200 px-1 py-0.2 font-mono">Cód {offerCodDist}</span>
                                      <span className="truncate max-w-[90px]">{offerCond}</span>
                                      {estoqueNum === 1 ? (
                                        <span className="bg-amber-100 text-amber-800 border border-amber-300 px-1 py-0.2 font-bold text-[9px] flex items-center gap-0.5">
                                          <span className="w-1.5 h-1.5 rounded-full bg-amber-500 inline-block"></span> Sob Consulta
                                        </span>
                                      ) : estoqueNum >= 2 ? (
                                        <span className="bg-emerald-100 text-emerald-800 border border-emerald-300 px-1 py-0.2 font-bold text-[9px] flex items-center gap-0.5">
                                          <span className="w-1.5 h-1.5 rounded-full bg-emerald-600 inline-block"></span> Em Estoque
                                        </span>
                                      ) : (
                                        <span className="bg-rose-100 text-rose-800 border border-rose-300 px-1 py-0.2 font-bold text-[9px] flex items-center gap-0.5">
                                          <span className="w-1.5 h-1.5 rounded-full bg-rose-600 inline-block"></span> Sem Estoque
                                        </span>
                                      )}
                                    </div>
                                  </td>}

                                  {offerColVis.prod && <td className="px-2.5 py-2 border-r border-gray-200 align-middle whitespace-normal" style={{ width: offerColWidths.prod }}>
                                    <div className="font-bold text-[#141414] select-text line-clamp-2 leading-tight">{offerDesc}</div>
                                    {offerLab && <div className="text-[9px] font-bold text-blue-600 mt-0.5 truncate" title={offerLab}>{offerLab}</div>}
                                    <div className="flex items-center gap-1.5 mt-1">
                                      <span className="text-[10px] text-gray-600 font-mono select-text">{offerEan}</span>
                                      <button onClick={() => navigator.clipboard.writeText(offerEan)} className="text-gray-400 hover:text-[#141414] cursor-pointer" title="Copiar EAN">
                                        <Copy className="w-3 h-3" />
                                      </button>
                                      <EanEyeButton ean={offerEan} descricao={offerDesc} laboratorio={offerLab} />
                                    </div>
                                  </td>}

                                  {offerColVis.pfab && <td className="px-2.5 py-2 border-r border-gray-200 align-middle text-right text-gray-600" style={{ width: offerColWidths.pfab }}>
                                    {pFabrica > 0 ? formatCurrency(pFabrica) : "-"}
                                  </td>}

                                  {offerColVis.desc && <td className="px-2.5 py-2 border-r border-gray-200 align-middle text-right font-bold text-blue-700" style={{ width: offerColWidths.desc }}>
                                    <div className="flex items-center justify-end gap-1.5">
                                      <span>{descPerc > 0 ? `${descPerc.toFixed(1)}%` : "-"}</span>
                                      {qtdMinItem > 1 && (
                                        <span className="bg-amber-400 text-[#141414] font-black text-[9px] px-1 py-0.5 border border-amber-600 rounded-none shadow-xs" title={`Promoção condicionada: Qtd Mínima de ${qtdMinItem} un`}>
                                          {qtdMinItem}
                                        </span>
                                      )}
                                    </div>
                                  </td>}

                                  {offerColVis.descExtra && <td className="px-2.5 py-2 border-r border-gray-200 align-middle text-right text-purple-700" style={{ width: offerColWidths.descExtra }}>
                                    {descExtraPerc > 0 ? `${descExtraPerc.toFixed(1)}%` : "-"}
                                  </td>}

                                  {offerColVis.st && <td className="px-2.5 py-2 border-r border-gray-200 align-middle text-right text-gray-600" style={{ width: offerColWidths.st }}>
                                    {valorSt > 0 ? formatCurrency(valorSt) : "R$ 0,00"}
                                  </td>}

                                  {offerColVis.pLiq && <td className="px-2.5 py-2 border-r border-gray-200 align-middle text-right" style={{ width: offerColWidths.pLiq }}>
                                    <div className="flex flex-col items-end gap-0.5">
                                      <span className="font-black text-sm text-emerald-700 bg-emerald-50 px-1.5 py-0.5 border border-emerald-200">
                                        {formatCurrency(pLiquido)}
                                      </span>
                                       {((offer.PMC !== undefined && offer.PMC > 0) || (offer.pmc !== undefined && offer.pmc > 0)) && (
                                        <span className="text-[11px] font-bold text-pink-700 bg-pink-100/60 px-1.5 py-0.5 border border-pink-200" title="Preço Máximo ao Consumidor (PMC)">
                                          PMC: {formatCurrency(offer.PMC || offer.pmc || 0)}
                                        </span>
                                      )}
                                    </div>
                                  </td>}

                                  {offerColVis.prazo && <td className="px-2.5 py-2 border-r border-gray-200 align-middle text-center" style={{ width: offerColWidths.prazo }}>
                                    <div className="flex flex-col items-center gap-0.5">
                                      <span className="bg-gray-100 border border-gray-300 text-gray-800 font-bold px-1.5 py-0.5 text-[10px]">
                                        {offerPrazo > 0 ? `${offerPrazo}d` : "À Vista"}
                                      </span>
                                      {qtdMinItem > 1 && (
                                        <span className="bg-amber-100 text-amber-900 border border-amber-300 font-bold px-1.5 py-0.5 text-[9px]" title="Quantidade mínima exigida por item">
                                          Mín {qtdMinItem} un
                                        </span>
                                      )}
                                      <span className="text-[9px] text-gray-500 font-medium" title="Valor mínimo para faturamento desta distribuidora">
                                        Ped: {formatCurrency(pedMinDist)}
                                      </span>
                                    </div>
                                  </td>}

                                  {offerColVis.acao && <td className="px-2.5 py-2 align-middle text-center" style={{ width: offerColWidths.acao }}>
                                    <div className="flex items-center justify-center gap-1.5">
                                      <input
                                        type="number"
                                        min={Math.max(1, qtdMinItem)}
                                        value={currentQty}
                                        onChange={(e) => {
                                          const val = Math.max(1, parseInt(e.target.value) || 1);
                                          setManualQuantities(prev => ({ ...prev, [itemRowKey]: val }));
                                        }}
                                        className="w-14 bg-white border-2 border-[#141414] px-1 py-1 text-xs font-mono text-center rounded-none focus:outline-none focus:ring-1 focus:ring-[#141414]"
                                      />
                                      <button
                                        onClick={() => handleAddManualItem(offer, currentQty, itemRowKey)}
                                        className={`flex items-center justify-center font-extrabold text-[10px] uppercase tracking-wider px-2.5 py-1.5 rounded-none transition-all cursor-pointer h-[28px] whitespace-nowrap border ${
                                          isAddedSuccess 
                                            ? 'bg-emerald-600 text-white border-emerald-700' 
                                            : 'bg-[#141414] hover:bg-emerald-700 text-white border-[#141414]'
                                        }`}
                                      >
                                        {isAddedSuccess ? (
                                          <span className="flex items-center gap-1">
                                            <CheckCircle2 className="w-3 h-3" /> Adicionado!
                                          </span>
                                        ) : (
                                          "Adicionar"
                                        )}
                                      </button>
                                    </div>
                                  </td>}
                                </tr>
                              );
                            })}
                          </tbody>
                        </table>
                      </div>
                      <div className="flex items-center justify-between text-[10px] text-gray-500 font-mono px-1">
                        <span>← Use a barra de rolagem horizontal ou clique em ⚙️ para ajustar colunas →</span>
                        <span>{processedManualOffers.length} {processedManualOffers.length === 1 ? 'oferta exibida' : 'ofertas exibidas'}</span>
                      </div>
                      <button
                        onClick={() => offersTableRef.current?.scrollTo({ top: 0, behavior: 'smooth' })}
                        className="fixed bottom-6 right-6 z-50 bg-[#141414] hover:bg-emerald-700 text-white w-10 h-10 flex items-center justify-center shadow-[2px_2px_0px_0px_rgba(20,20,20,1)] border-2 border-[#141414] cursor-pointer transition-colors"
                        title="Voltar ao topo"
                      >
                        <ArrowUp className="w-5 h-5" />
                      </button>
                    </div>
                  )}

                  {!isManualSearching && processedManualOffers.length === 0 && manualQuery.trim().length >= 2 && !manualSearchError && (
                    <div className="p-6 bg-white border-2 border-[#141414] text-center text-xs text-gray-600 font-mono shadow-[3px_3px_0px_0px_rgba(20,20,20,1)]">
                      Nenhuma oferta comercial com estoque localizada para "{manualQuery}".
                    </div>
                  )}
                </div>
              </div>
</motion.div>
            )}
          </AnimatePresence>

        {/* Encomendas Import Modal - Estilo igual ao modal "+" (manual add) */}
        <AnimatePresence>
          {isEncomendasImportOpen && (
            <motion.div
              drag
              dragListener={false}
              dragMomentum={false}
              dragConstraints={{ left: -800, right: 800, top: -600, bottom: 800 }}
              dragControls={dragControls}
              className="fixed z-50 p-3"
              style={{
                top: "5vh",
                left: "5vw",
                width: encomendasModalWidth,
                height: encomendasModalHeight,
                minWidth: "500px",
                minHeight: "400px",
                maxWidth: "calc(100vw - 2rem)",
                maxHeight: "calc(100vh - 4rem)",
              }}
              onPointerDown={(e) => {
                if (e.target === e.currentTarget) {
                  dragControls.start(e);
                }
              }}
            >
              <div
                className="relative bg-[#DCDAD7] border-4 border-[#141414] rounded-none flex flex-col shadow-[8px_8px_0px_0px_rgba(20,20,20,1)] w-full h-full overflow-hidden select-text"
                ref={(node) => {
                  if (node) {
                    const observer = new ResizeObserver((entries) => {
                      for (let entry of entries) {
                        const { width, height } = entry.contentRect;
                        if (width > 100 && height > 100) {
                          const wStr = `${width}px`;
                          const hStr = `${height}px`;
                          sessionStorage.setItem('encomendas_modal_width', wStr);
                          sessionStorage.setItem('encomendas_modal_height', hStr);
                        }
                      }
                    });
                    observer.observe(node);
                  }
                }}
              >
                {/* Resize Handles */}
                <div 
                  className="absolute top-0 left-3 right-3 h-2 cursor-ns-resize z-35 bg-transparent"
                  onPointerDown={(e) => {
                    e.stopPropagation();
                    const startY = e.clientY;
                    const parent = e.currentTarget.parentElement;
                    if (!parent) return;
                    const startH = parent.offsetHeight;
                    const onMove = (me: PointerEvent) => {
                      const dy = me.clientY - startY;
                      const newH = Math.max(400, startH - dy);
                      setEncomendasModalHeight(`${newH}px`);
                      sessionStorage.setItem('encomendas_modal_height', `${newH}px`);
                    };
                    const onUp = () => {
                      window.removeEventListener('pointermove', onMove);
                      window.removeEventListener('pointerup', onUp);
                    };
                    window.addEventListener('pointermove', onMove);
                    window.addEventListener('pointerup', onUp);
                  }}
                />
                <div 
                  className="absolute bottom-0 left-3 right-3 h-2 cursor-ns-resize z-35 bg-transparent"
                  onPointerDown={(e) => {
                    e.stopPropagation();
                    const startY = e.clientY;
                    const parent = e.currentTarget.parentElement;
                    if (!parent) return;
                    const startH = parent.offsetHeight;
                    const onMove = (me: PointerEvent) => {
                      const dy = me.clientY - startY;
                      const newH = Math.max(400, startH + dy);
                      setEncomendasModalHeight(`${newH}px`);
                      sessionStorage.setItem('encomendas_modal_height', `${newH}px`);
                    };
                    const onUp = () => {
                      window.removeEventListener('pointermove', onMove);
                      window.removeEventListener('pointerup', onUp);
                    };
                    window.addEventListener('pointermove', onMove);
                    window.addEventListener('pointerup', onUp);
                  }}
                />
                <div 
                  className="absolute left-0 top-3 bottom-3 w-2 cursor-ew-resize z-35 bg-transparent"
                  onPointerDown={(e) => {
                    e.stopPropagation();
                    const startX = e.clientX;
                    const parent = e.currentTarget.parentElement;
                    if (!parent) return;
                    const startW = parent.offsetWidth;
                    const onMove = (me: PointerEvent) => {
                      const dx = me.clientX - startX;
                      const newW = Math.max(500, startW - dx);
                      setEncomendasModalWidth(`${newW}px`);
                      sessionStorage.setItem('encomendas_modal_width', `${newW}px`);
                    };
                    const onUp = () => {
                      window.removeEventListener('pointermove', onMove);
                      window.removeEventListener('pointerup', onUp);
                    };
                    window.addEventListener('pointermove', onMove);
                    window.addEventListener('pointerup', onUp);
                  }}
                />
                <div 
                  className="absolute right-0 top-3 bottom-3 w-2 cursor-ew-resize z-35 bg-transparent"
                  onPointerDown={(e) => {
                    e.stopPropagation();
                    const startX = e.clientX;
                    const parent = e.currentTarget.parentElement;
                    if (!parent) return;
                    const startW = parent.offsetWidth;
                    const onMove = (me: PointerEvent) => {
                      const dx = me.clientX - startX;
                      const newW = Math.max(500, startW + dx);
                      setEncomendasModalWidth(`${newW}px`);
                      sessionStorage.setItem('encomendas_modal_width', `${newW}px`);
                    };
                    const onUp = () => {
                      window.removeEventListener('pointermove', onMove);
                      window.removeEventListener('pointerup', onUp);
                    };
                    window.addEventListener('pointermove', onMove);
                    window.addEventListener('pointerup', onUp);
                  }}
                />
                {/* Modal Header */}
                <div 
                  className="bg-violet-800 text-white px-5 py-3.5 flex items-center justify-between border-b-2 border-[#141414] cursor-move select-none shrink-0"
                  onPointerDown={(e) => dragControls.start(e)}
                >
                  <div className="flex flex-col">
                    <div className="flex items-center space-x-2.5">
                      <Package className="w-5 h-5 text-violet-300" />
                      <h2 className="font-serif italic text-lg sm:text-xl font-bold tracking-tight">
                        Importar Encomendas Pendentes
                      </h2>
                      <span className="bg-violet-500/20 text-violet-300 border border-violet-500/30 text-[10px] font-mono px-2 py-0.5 font-bold uppercase tracking-wider hidden sm:inline-block">
                        SmartPed Live API
                      </span>
                    </div>
                    <p className="text-[10px] text-violet-200 font-mono mt-1">
                      {encomendasWithOffers.length > 0 ? 
                        `${encomendasWithOffers.filter(e => e.selecionada && e.temOfertas).length} de ${encomendasWithOffers.length} encomendas prontas para importar` :
                        isSearchingEncomendas ? "Buscando ofertas na SmartPed..." : "Buscando encomendas pendentes..."}
                    </p>
                  </div>
                  <button onClick={() => { setIsEncomendasImportOpen(false); setEncomendasList([]); setEncomendasWithOffers([]); setEncomendasAddedKeys(new Set()); }} className="text-white/70 hover:text-white transition-colors cursor-pointer">
                    <XCircle className="w-6 h-6" />
                  </button>
                </div>

{/* Modal Content - Estilo Manual Add Modal */}
                <div className="p-2 sm:p-3 overflow-y-auto flex-1 flex flex-col space-y-2 min-w-0 w-full max-w-full">
                  {/* Status de Busca */}
                  {isSearchingEncomendas && (
                    <div className="flex items-center justify-center gap-2 p-4 bg-white border-2 border-[#141414]">
                      <Loader2 className="w-6 h-6 animate-spin text-violet-600" />
                      <p className="text-sm font-bold text-gray-800">Buscando ofertas na SmartPed para cada encomenda...</p>
                    </div>
                  )}

                  {encomendasSearchError && (
                    <div className="p-4 bg-rose-50 border-2 border-rose-300 text-rose-800 text-xs font-medium flex items-center gap-2">
                      <AlertCircleIcon className="w-4 h-4 shrink-0" />
                      <span>Erro: {encomendasSearchError}</span>
                    </div>
                  )}

                  {!isSearchingEncomendas && !encomendasSearchError && encomendasWithOffers.length === 0 && encomendasList.length === 0 && (
                    <div className="p-6 bg-violet-50 border-2 border-violet-200 text-center">
                      <Package className="w-10 h-10 text-violet-300 mx-auto mb-2" />
                      <p className="text-sm font-bold text-violet-800">Nenhuma encomenda pendente</p>
                      <p className="text-[11px] text-violet-600 mt-1">Não há encomendas com status "Pendente" no momento.</p>
                    </div>
                  )}

                  {/* Tabela de Encomendas - Estilo Manual Add Modal */}
                  {encomendasWithOffers.length > 0 && !isSearchingEncomendas && (
                    <div className="bg-white border-2 border-[#141414] shadow-[3px_3px_0px_0px_rgba(20,20,20,1)] flex-1 min-h-0 flex flex-col">
                      {/* Toolbar */}
                      <div className="bg-gray-100 border-b border-gray-200 p-2 flex flex-wrap items-center justify-between gap-2">
                        <div className="flex items-center gap-2">
                          <label className="flex items-center gap-1.5 text-[9px] font-bold text-gray-600 cursor-pointer">
                            <input
                              type="checkbox"
                              checked={encomendasWithOffers.every(e => e.selecionada && e.temOfertas)}
                              onChange={(e) => {
                                setEncomendasWithOffers(prev => prev.map(item => ({ ...item, selecionada: e.target.checked && item.temOfertas })));
                              }}
                              className="w-3.5 h-3.5 border-gray-300 text-violet-600 focus:ring-violet-500"
                            />
                            <span className="font-bold text-[#141414] text-[9px] uppercase">Sel. todas</span>
                          </label>
                          <span className="text-[9px] text-gray-500 font-mono">
                            {encomendasWithOffers.filter(e => e.selecionada && e.temOfertas).length} de {encomendasWithOffers.length}
                          </span>
                        </div>
                        <div className="flex items-center gap-1.5">
                          <span className="text-[9px] text-gray-500">Logs:</span>
                          <button
                            onClick={() => setShowEncomendasLogs(!showEncomendasLogs)}
                            className="px-1.5 py-0.5 text-[9px] font-bold uppercase bg-gray-200 hover:bg-gray-300 border border-gray-300 transition-colors"
                          >
                            {showEncomendasLogs ? 'Ocultar' : 'Mostrar'}
                          </button>
                        </div>
                      </div>

                      {/* Tabela de Ofertas - Estilo Manual Add Modal */}
                      <div ref={encomendasTableRef} className="overflow-x-auto overflow-y-auto custom-table-scrollbar border-t border-gray-200 bg-white flex-1 min-h-0">
                        <table className="w-full text-xs font-mono whitespace-nowrap" style={{ minWidth: 840 }}>
                          <thead className="bg-[#141414] text-white sticky top-0 z-10">
                            <tr>
                              <th className="px-2 py-1 border-b border-r border-gray-700 font-bold uppercase tracking-wider text-[9px] text-center relative select-none" style={{ width: 36 }}>
                                <input
                                  type="checkbox"
                                  checked={encomendasWithOffers.every(e => e.selecionada && e.temOfertas)}
                                  onChange={(e) => {
                                    setEncomendasWithOffers(prev => prev.map(item => ({ ...item, selecionada: e.target.checked && item.temOfertas })));
                                  }}
                                  className="w-4 h-4 border-gray-300 text-violet-600 focus:ring-violet-500"
                                />
                              </th>
                              <th className="px-2 py-1 border-b border-r border-gray-700 font-bold uppercase tracking-wider text-[9px] text-left relative select-none" style={{ width: 200 }}>
                                <span>Produto & EAN</span>
                              </th>
                              <th className="px-2 py-1 border-b border-r border-gray-700 font-bold uppercase tracking-wider text-[9px] text-left relative select-none" style={{ width: 150 }}>
                                <span>Cliente / Hora</span>
                              </th>
                              <th className="px-2 py-1 border-b border-r border-gray-700 font-bold uppercase tracking-wider text-[9px] text-left relative select-none" style={{ width: 180 }}>
                                <span>Observação</span>
                              </th>
                              <th className="px-2 py-1 border-b border-r border-gray-700 font-bold uppercase tracking-wider text-[9px] text-left relative select-none" style={{ width: 180 }}>
                                <span>Oferta (Dropdown)</span>
                              </th>
                              <th className="px-2 py-1 border-b border-gray-700 font-bold uppercase tracking-wider text-[9px] text-center relative select-none" style={{ width: 90 }}>
                                <span>Qtd</span>
                              </th>
                            </tr>
                          </thead>
                          <tbody className="divide-y divide-gray-200">
                            {encomendasWithOffers.map((item, idx) => {
                              const enc = item.encomenda;
                              const temOfertas = item.temOfertas;
                              const ofertaSel = item.ofertaSelecionada;
                              const temErro = !!item.erro;
                              const semOfertas = !temOfertas && !temErro;
                              
                              const itemRowKey = `${item.idEncomenda}_${idx}`;
                              const currentQty = encomendasQuantities[itemRowKey] !== undefined ? encomendasQuantities[itemRowKey] : item.quantidade;
                              const isAddedSuccess = encomendasActionSuccessKey === itemRowKey;
                              const isAdded = encomendasAddedKeys.has(itemRowKey);
                              const disabled = !item.selecionada || !temOfertas || !item.ofertaSelecionada;

                              return (
                                <tr key={itemRowKey} className={`transition-colors ${isAdded ? 'bg-yellow-100 border-l-4 border-yellow-400' : (item.selecionada ? 'bg-violet-50/70' : (idx % 2 === 0 ? 'bg-white' : 'bg-gray-50/70'))} ${temErro ? 'border-l-4 border-l-rose-500' : ''}`}>
                                  {/* Checkbox */}
                                  <td className="px-2 py-1 border-r border-gray-200 align-middle text-center">
                                    <input
                                      type="checkbox"
                                      checked={item.selecionada}
                                      disabled={!item.temOfertas}
                                      onChange={(e) => {
                                        setEncomendasWithOffers(prev => {
                                          const updated = [...prev];
                                          updated[idx] = { ...updated[idx], selecionada: e.target.checked && item.temOfertas };
                                          return updated;
                                        });
                                      }}
                                      className="w-4 h-4 border-gray-300 text-violet-600 focus:ring-violet-500 disabled:opacity-30 cursor-pointer"
                                    />
                                  </td>

                                  {/* Produto & EAN */}
                                  <td className="px-2 py-1 border-r border-gray-200 align-middle whitespace-normal" style={{ width: 200 }}>
                                    <div className="font-bold text-[#141414] select-text line-clamp-2 leading-tight text-[10px]">{item.descricao}</div>
                                    <div className="flex items-center gap-1 mt-0.5">
                                      <span className="text-[9px] text-gray-600 font-mono select-text">{item.ean || "—"}</span>
                                      <button onClick={() => navigator.clipboard.writeText(item.ean || "")} className="text-gray-400 hover:text-[#141414] cursor-pointer" title="Copiar EAN">
                                        <Copy className="w-3 h-3" />
                                      </button>
                                      {item.erro && (
                                        <span className="text-[8px] bg-rose-100 text-rose-700 px-1 py-0.5 font-bold">ERRO</span>
                                      )}
                                      {!item.erro && !item.temOfertas && (
                                        <span className="text-[8px] bg-amber-100 text-amber-700 px-1 py-0.5 font-bold">Sem ofertas</span>
                                      )}
                                    </div>
                                  </td>

                                  {/* Cliente / Hora */}
                                  <td className="px-2 py-1 border-r border-gray-200 align-middle whitespace-normal" style={{ width: 150 }}>
                                    <div className="text-[12px] text-gray-600 select-text font-bold">{item.cliente || "—"}</div>
                                    {item.telefone && (
                                      <div className="text-[11px] text-gray-500 font-mono select-text">{item.telefone}</div>
                                    )}
                                    {item.dataHora && (
                                      <div className="text-[11px] text-violet-600 font-mono select-text mt-0.5">{item.dataHora}</div>
                                    )}
                                    {item.fornecedorSugerido && (
                                      <div className="text-[11px] text-emerald-600 font-bold mt-0.5">Fornec: {item.fornecedorSugerido}</div>
                                    )}
                                    {item.dataPrevisao && (
                                      <div className="text-[11px] text-blue-600 font-mono mt-0.5">Prev: {item.dataPrevisao}</div>
                                    )}
                                  </td>

                                  {/* Observação */}
                                  <td className="px-2 py-1 border-r border-gray-200 align-middle whitespace-normal" style={{ width: 180 }}>
                                    <div className="text-[12px] text-red-700 bg-red-50 font-bold select-text line-clamp-2 leading-tight px-1.5 py-0.5 rounded">
                                      {item.observacoes || "—"}
                                    </div>
                                  </td>

                                  {/* Oferta Dropdown */}
                                  <td className="px-2 py-1 border-r border-gray-200 align-middle" style={{ width: 180 }}>
                                    {item.temOfertas && item.ofertas.length > 0 ? (
                                      (() => {
                                        const originalEan = (item.ean || "").replace(/^0+/, "");
                                        const mesmoProduto = item.ofertas.filter((o: any) => (o.ean || o.Ean || "").replace(/^0+/, "") === originalEan);
                                        const genericosSimilares = item.ofertas.filter((o: any) => (o.ean || o.Ean || "").replace(/^0+/, "") !== originalEan);
                                        return (
                                          <select
                                            value={item.ofertaSelecionada ? `${item.ofertaSelecionada.distribuidora}|${item.ofertaSelecionada.precoLiquido || item.ofertaSelecionada.preco || 0}` : ""}
                                            onChange={(e) => {
                                              const [dist, preco] = e.target.value.split("|");
                                              const oferta = item.ofertas.find((o: any) => o.distribuidora === dist && (o.precoLiquido || o.preco || 0) == preco);
                                              if (oferta) {
                                                setEncomendasWithOffers(prev => {
                                                  const updated = [...prev];
                                                  updated[idx] = { ...updated[idx], ofertaSelecionada: oferta };
                                                  return updated;
                                                });
                                              }
                                            }}
                                            disabled={!item.selecionada}
                                            className="w-full text-xs px-2 py-1 border border-gray-300 bg-white disabled:bg-gray-100"
                                          >
                                            <option value="">-- Escolher oferta --</option>
                                            {mesmoProduto.length > 0 && (
                                              <optgroup label="📦 Mesmo Produto (mesmo EAN)">
                                                {mesmoProduto.map((o: any, oi: number) => (
                                                  <option key={`same-${oi}`} value={`${o.distribuidora}|${o.precoLiquido || o.preco || 0}`}>
                                                    {o.distribuidora} - R$ {(o.precoLiquido || o.preco || 0).toFixed(2)} - {o.estoque === 2 ? "Normal" : o.estoque === 1 ? "Baixo" : "Sem"} - {o.condicao || "FIXA"} {o.prazo ? `${o.prazo}d` : "À Vista"}
                                                  </option>
                                                ))}
                                              </optgroup>
                                            )}
                                            {genericosSimilares.length > 0 && (
                                              <optgroup label="🔄 Genéricos/Similares (outro EAN)">
                                                {genericosSimilares.map((o: any, oi: number) => (
                                                  <option key={`gen-${oi}`} value={`${o.distribuidora}|${o.precoLiquido || o.preco || 0}`}>
                                                    {o.distribuidora} - R$ {(o.precoLiquido || o.preco || 0).toFixed(2)} - {o.estoque === 2 ? "Normal" : o.estoque === 1 ? "Baixo" : "Sem"} - {o.condicao || "FIXA"} {o.prazo ? `${o.prazo}d` : "À Vista"}
                                                  </option>
                                                ))}
                                              </optgroup>
                                            )}
                                          </select>
                                        );
                                      })()
                                    ) : (
                                      <div className="flex items-center gap-2">
                                        <span className="text-[10px] text-amber-700 bg-amber-100 px-1.5 py-0.5 font-bold">Sem ofertas</span>
                                        <button
                                          onClick={() => {
                                            setManualAddOriginItem({ ean: item.ean || "", descricao: item.descricao, laboratorio: "" });
                                            setManualAddFromEncomendas(itemRowKey);
                                            setIsManualAddModalOpen(true);
                                            setIsEncomendasImportOpen(false);
                                          }}
                                          className="px-2 py-1 text-[10px] font-bold uppercase bg-amber-600 hover:bg-amber-700 text-white border border-amber-700 transition-colors"
                                          title="Buscar manualmente no modal Adição Manual"
                                        >
                                          Buscar manual
                                        </button>
                                      </div>
                                    )}
                                  </td>

                                  {/* Qtd */}
                                  <td className="px-2 py-1 border-r border-gray-200 align-middle text-center" style={{ width: 90 }}>
                                    <input
                                      type="number"
                                      min={1}
                                      value={currentQty}
                                      onChange={(e) => {
                                        const val = Math.max(1, parseInt(e.target.value) || 1);
                                        setEncomendasQuantities(prev => ({ ...prev, [itemRowKey]: val }));
                                      }}
                                      className="w-12 bg-white border-2 border-[#141414] px-1 py-0.5 text-xs font-mono text-center rounded-none focus:outline-none focus:ring-1 focus:ring-[#141414]"
                                    />
</td>
                                </tr>
                              );
                            })}
                          </tbody>
                        </table>
                      </div>
                      <div className="flex items-center justify-between text-[10px] text-gray-500 font-mono px-1">
                        <span>← Use a barra de rolagem horizontal →</span>
                        <span>{encomendasWithOffers.filter(e => e.selecionada && e.temOfertas).length} encomendas selecionadas</span>
                      </div>
                    </div>
                  )}

                  {/* Botões de Ação */}
                  {encomendasWithOffers.length > 0 && !isSearchingEncomendas && (
<div className="flex justify-end gap-2 pt-1.5 border-t border-gray-200">
                       <button
                         onClick={() => {
                           setIsEncomendasImportOpen(false);
                           setEncomendasList([]);
                           setEncomendasWithOffers([]);
                           setEncomendasAddedKeys(new Set());
                         }}
                         className="px-3 py-1.5 bg-white hover:bg-gray-100 text-gray-700 border border-gray-300 text-[9px] font-bold uppercase transition-colors"
                       >
                         Cancelar
                       </button>
                       <button
                         onClick={handleConfirmImportEncomendas}
                         disabled={encomendasWithOffers.filter(e => e.selecionada && e.temOfertas && e.ofertaSelecionada).length === 0}
                         className="px-4 py-1.5 bg-violet-700 hover:bg-violet-800 text-white text-[9px] font-bold uppercase transition-colors flex items-center gap-1.5 border border-violet-800 shadow-sm disabled:opacity-50 disabled:cursor-not-allowed"
                       >
                         <Check className="w-3.5 h-3.5" />
                         <span>Importar Selecionados</span>
                       </button>
                     </div>
                  )}
                </div>
              </div>
            </motion.div>
          )}
        </AnimatePresence>

        {isBillingModalOpen && (
          <div className="fixed inset-0 bg-[#141414]/70 backdrop-blur-sm z-50 flex items-center justify-center p-4">
            <div className="bg-[#E4E3E0] border-4 border-[#141414] max-w-2xl w-full rounded-none overflow-hidden flex flex-col shadow-[8px_8px_0px_0px_rgba(20,20,20,1)] max-h-[90vh]">
              {/* Modal Header */}
              <div className="bg-[#141414] text-[#E4E3E0] px-6 py-4 flex items-center justify-between border-b-2 border-[#141414]">
                <div className="flex items-center space-x-2.5">
                  <ShieldCheck className="w-5 h-5 text-emerald-400" />
                  <span className="text-xs font-black uppercase tracking-widest font-mono">
                    {billingResult ? "Faturamento de Lote SmartPed Concluído" : "Processando Faturamento..."}
                  </span>
                </div>
                <button
                  onClick={handleCloseAndConsolidateBilling}
                  className="text-[#E4E3E0]/70 hover:text-white transition-all cursor-pointer"
                >
                  <X className="w-5 h-5" />
                </button>
              </div>

              {/* Modal Body */}
              <div className="p-6 overflow-y-auto space-y-6 flex-1">
                {!billingResult ? (
                  <div className="flex flex-col items-center justify-center py-12 h-64">
                    <RefreshCw className="w-10 h-10 text-emerald-500 animate-spin mb-4" />
                    <p className="font-bold uppercase tracking-widest text-sm text-[#141414]">Comunicando com API SmartPed...</p>
                    <p className="text-xs text-[#141414]/60 mt-2 font-mono">Enviando pedidos e aguardando confirmação. Por favor, não feche esta janela.</p>
                  </div>
                ) : (
                  <>
                {/* Banner verde */}
                <div className="bg-emerald-100 border-2 border-emerald-500 p-4 rounded-none flex items-start space-x-3 text-emerald-900">
                  <CheckCircle className="w-5 h-5 text-emerald-700 shrink-0 mt-0.5" />
                  <div>
                    <p className="text-xs font-bold uppercase tracking-wide">Pedidos Enviados com Sucesso!</p>
                    <p className="text-xs text-emerald-800 mt-1">
                      O lote de faturamento foi processado pela API SmartPed e distribuído automaticamente entre as distribuidoras parceiras homologadas.
                    </p>
                  </div>
                </div>

                {/* Alerta de Distribuidoras Bloqueadas */}
                {billingResult.distribuidorasBloqueadas && billingResult.distribuidorasBloqueadas.length > 0 && (
                  <div className="bg-amber-100 border-2 border-amber-500 p-4 rounded-none flex items-start space-x-3 text-amber-950">
                    <AlertTriangle className="w-5 h-5 text-amber-700 shrink-0 mt-0.5" />
                    <div>
                      <p className="text-xs font-bold uppercase tracking-wide">Distribuidoras Bloqueadas pelo Servidor!</p>
                      <p className="text-xs text-amber-900 mt-1 font-semibold">
                        A SmartPed processou o pedido principal, mas notificou bloqueio de envio para as seguintes distribuidoras do lote:
                      </p>
                      <div className="mt-2 space-y-1.5">
                        {billingResult.distribuidorasBloqueadas.map((dist: any, dIdx: number) => {
                          const name = dist.NomeDist || dist.Nome || (typeof dist === "object" ? `Distribuidora ID ${dist.CodDist || ""}` : String(dist));
                          const reason = dist.Mensagem || dist.mensagem || "";
                          return (
                            <div key={dIdx} className="text-[11px] font-mono bg-amber-50 p-2 border border-amber-200 rounded-none text-amber-950">
                              <span className="font-bold text-amber-900">{name}</span>
                              {reason ? `: "${reason}"` : ' (Bloqueada pelo servidor para faturamento)'}
                            </div>
                          );
                        })}
                      </div>
                    </div>
                  </div>
                )}

                {/* Resumo Geral */}
                <div>
                  <h4 className="text-[10px] font-bold uppercase tracking-widest text-[#141414]/60 mb-2">Dados Gerais do Lote</h4>
                  <div className="grid grid-cols-2 sm:grid-cols-3 gap-4 bg-[#DCDAD7] p-4 border border-[#141414] rounded-none">
                    <div>
                      <p className="text-[9px] uppercase font-bold text-[#141414]/60 tracking-wider">Protocolo Lote</p>
                      <p className="text-xs font-mono font-bold text-[#141414] mt-0.5">{billingResult.protocoloLote}</p>
                    </div>
                    <div>
                      <p className="text-[9px] uppercase font-bold text-[#141414]/60 tracking-wider">CNPJ Faturamento</p>
                      <p className="text-xs font-mono font-bold text-[#141414] mt-0.5">{billingResult.cnpjFaturado}</p>
                    </div>
                    <div>
                      <p className="text-[9px] uppercase font-bold text-[#141414]/60 tracking-wider">Data/Hora</p>
                      <p className="text-xs font-mono font-bold text-[#141414] mt-0.5">
                        {new Date(billingResult.dataFaturamento).toLocaleTimeString("pt-BR")} - {new Date(billingResult.dataFaturamento).toLocaleDateString("pt-BR")}
                      </p>
                    </div>
                    <div className="pt-2 border-t border-[#141414]/10 col-span-2 sm:col-span-1">
                      <p className="text-[9px] uppercase font-bold text-[#141414]/60 tracking-wider">Itens Otimizados</p>
                      <p className="text-xs font-bold text-[#141414] mt-0.5">
                        {billingResult.pedidosDistribuidoras.reduce((acc: number, p: any) => acc + p.itensCount, 0)} Itens faturados
                      </p>
                    </div>
                    <div className="pt-2 border-t border-[#141414]/10">
                      <p className="text-[9px] uppercase font-bold text-[#141414]/60 tracking-wider">Valor do Lote</p>
                      <p className="text-xs font-bold text-[#141414] mt-0.5">{formatCurrency(billingResult.valorTotal)}</p>
                    </div>
                    <div className="pt-2 border-t border-[#141414]/10 text-green-800">
                      <p className="text-[9px] uppercase font-bold text-green-800/60 tracking-wider">Economia Obtida</p>
                      <p className="text-xs font-extrabold mt-0.5">{formatCurrency(billingResult.economiaTotal)}</p>
                    </div>
                  </div>
                </div>

                {/* Detalhamento por distribuidora */}
                <div>
                  <h4 className="text-[10px] font-bold uppercase tracking-widest text-[#141414]/60 mb-2">Pedidos de Distribuidoras Parceiras</h4>
                  <div className="space-y-3">
                    {billingResult.pedidosDistribuidoras.map((p: any, idx: number) => (
                      <div key={idx} className="bg-[#F2F1ED] p-4 border border-[#141414] rounded-none flex flex-col sm:flex-row sm:items-center sm:justify-between gap-3">
                        <div>
                          <span className="inline-flex items-center px-2 py-0.5 text-[9px] font-black uppercase tracking-widest bg-[#141414] text-[#E4E3E0]">
                            {p.distribuidora}
                          </span>
                          <p className="text-[11px] font-mono text-[#141414]/70 mt-1.5 uppercase font-semibold">
                            ID Pedido: <span className="text-[#141414] font-bold">{p.pedidoId}</span> | Itens: {p.itensCount}
                          </p>
                        </div>
                        <div className="text-right flex sm:flex-col items-center justify-between sm:justify-end gap-2 sm:gap-0">
                          <p className="text-[10px] text-[#141414]/60 font-semibold uppercase tracking-wider">Total faturado</p>
                          <p className="text-xs font-bold text-[#141414] font-mono">{formatCurrency(p.valorTotal)}</p>
                          <p className="text-[10px] text-green-700 font-bold font-mono mt-0.5">Economia de {formatCurrency(p.economia)}</p>
                        </div>
                      </div>
                    ))}
                  </div>
                </div>

                {/* Real-time Order Return Monitoring (Acompanhamento de Retorno) */}
                <div className="border-t border-b border-[#141414]/10 py-5">
                  <div className="flex flex-col sm:flex-row sm:items-center sm:justify-between gap-2 mb-3">
                    <div>
                      <h4 className="text-[10px] font-bold uppercase tracking-widest text-[#141414]/60">
                        Acompanhamento de Retorno (SmartPed api/Pedido/Retorno)
                      </h4>
                      <p className="text-[10px] text-gray-500 uppercase tracking-wide font-semibold">
                        Aguarde o retorno da distribuidora para verificar cortes de estoque
                      </p>
                    </div>

                    <div className="flex items-center space-x-3">
                      <label className="flex items-center space-x-1.5 text-[10px] font-bold uppercase cursor-pointer select-none">
                        <input
                          type="checkbox"
                          checked={autoPollReturn}
                          onChange={(e) => setAutoPollReturn(e.target.checked)}
                          className="rounded-none border-[#141414] text-[#141414] focus:ring-0"
                        />
                        <span>Auto-Consultar (2s)</span>
                      </label>

                      <button
                        onClick={handleCheckOrderReturn}
                        disabled={isCheckingReturn}
                        className="flex items-center space-x-1 bg-[#141414] text-[#E4E3E0] hover:bg-neutral-800 disabled:opacity-50 text-[10px] uppercase font-bold tracking-widest px-3 py-1.5 rounded-none transition-all border border-[#141414] cursor-pointer"
                      >
                        <RefreshCw className={`w-3.5 h-3.5 ${isCheckingReturn ? "animate-spin" : ""}`} />
                        <span>{isCheckingReturn ? "Consultando..." : "Consultar Retorno"}</span>
                      </button>
                    </div>
                  </div>

                  {!orderReturn ? (
                    <div className="p-4 bg-amber-50 border border-amber-300 text-amber-900 rounded-none flex items-start space-x-3">
                      <Clock className="w-5 h-5 text-amber-700 shrink-0 mt-0.5" />
                      <div>
                        <p className="text-xs font-bold uppercase tracking-wider">Aguardando Consulta Inicial</p>
                        <p className="text-[11px] leading-relaxed mt-1">
                          Clique em <strong>"Consultar Retorno"</strong> acima para consultar se as distribuidoras parceiras já enviaram a confirmação final do faturamento e se houve cortes de itens por falta de estoque.
                        </p>
                        <p className="text-[10px] text-amber-800 font-semibold uppercase mt-1.5 font-mono">
                          💡 Teste Sandbox: A primeira consulta simula o estado "Aguardando Retorno (Status 2)", e a segunda simula "Pedido Finalizado (Status 3)" com corte simulado realista!
                        </p>
                      </div>
                    </div>
                  ) : (
                    <LazyOrderReturnView                      orderReturn={orderReturn}                      itemsFaturados={billingResult.itemsFaturados}                      onReRouteShortages={handleReRouteShortages}                      onExportShortages={handleExportShortages}                      isReRoutingShortages={isReRoutingShortages}                    />
                  )}
                </div>
                </>
                )}
                {/* Logs colapsáveis do faturamento */}
                <div>
                  <h4 className="text-[10px] font-bold uppercase tracking-widest text-[#141414]/60 mb-2">Logs da Transação de Faturamento</h4>
                  <div className="bg-[#141414] text-[#D1D5DB] p-4 font-mono text-[10px] whitespace-pre-wrap leading-relaxed max-h-64 overflow-y-auto rounded-none border border-[#141414] space-y-1 flex flex-col-reverse">
                    <div className="flex flex-col space-y-1">
                      {logs.map((log: string, lIdx: number) => (
                        <p key={lIdx} className={log.includes("[SUCESSO]") ? "text-emerald-400 font-bold" : log.includes("[ERRO") ? "text-rose-400 font-bold" : "text-gray-300"}>
                          {log}
                        </p>
                      ))}
                      {returnCheckLogs.map((log: string, lIdx: number) => (
                        <p key={"ret-" + lIdx} className="text-cyan-400 font-bold">
                          {log}
                        </p>
                      ))}
                    </div>
                  </div>
                </div>
              </div>

              {/* Modal Footer */}
              <div className="bg-[#DCDAD7] border-t border-[#141414]/20 px-6 py-4 flex justify-end">
                {billingResult ? (
                  <button
                    onClick={handleCloseAndConsolidateBilling}
                    className="bg-[#141414] hover:bg-neutral-800 text-[#E4E3E0] font-bold text-xs uppercase tracking-wider py-2.5 px-6 rounded-none transition-all cursor-pointer border border-[#141414]"
                  >
                    Fechar e Concluir
                  </button>
                ) : (
                  <button
                    onClick={handleCloseAndConsolidateBilling}
                    className="bg-neutral-600 hover:bg-neutral-800 text-white font-bold text-xs uppercase tracking-wider py-2.5 px-6 rounded-none transition-all cursor-pointer border border-[#141414]/20"
                  >
                    Fechar Modal
                  </button>
                )}
              </div>
            </div>
          </div>
        )}

        {/* Modal de Alerta de Cortes em Pedidos Manuais */}
        {manualCutsAlert && (
          <div className="fixed inset-0 bg-[#141414]/70 backdrop-blur-sm z-50 flex items-center justify-center p-4">
            <div className="bg-[#E4E3E0] border-4 border-[#141414] max-w-lg w-full rounded-none overflow-hidden flex flex-col shadow-[8px_8px_0px_0px_rgba(20,20,20,1)] max-h-[85vh]">
              {/* Header */}
              <div className="bg-[#d91d1d] text-white px-6 py-4 flex items-center justify-between border-b-2 border-[#141414]">
                <div className="flex items-center space-x-2.5">
                  <AlertTriangle className="w-5 h-5 text-yellow-300" />
                  <span className="text-xs font-black uppercase tracking-widest font-mono text-white">
                    Aviso: Itens Manuais Não Faturados!
                  </span>
                </div>
                <button
                  onClick={() => setManualCutsAlert(null)}
                  className="text-white hover:text-gray-200 transition-all cursor-pointer"
                >
                  <X className="w-5 h-5" />
                </button>
              </div>

              {/* Body */}
              <div className="p-6 overflow-y-auto space-y-4 text-left">
                <p className="text-xs text-[#141414]/80 font-semibold uppercase tracking-wide">
                  ⚠️ Os seguintes itens adicionados manualmente não puderam ser faturados e foram marcados como faltas:
                </p>

                <div className="space-y-3">
                  {manualCutsAlert.map((cut: any, idx: number) => (
                    <div key={idx} className="bg-white border-2 border-[#141414]/20 p-3.5 rounded-none font-mono text-[11px] text-gray-800 relative">
                      <div className="absolute top-3 right-3 text-[10px] font-bold text-rose-600 bg-rose-50 border border-rose-200 px-1.5 py-0.5">
                        Falta: {cut.solicitado - cut.faturado} un
                      </div>
                      <p className="font-sans font-bold text-xs text-[#141414] pr-16">{cut.descricao}</p>
                      <p className="text-[10px] text-gray-500 mt-1 font-semibold">EAN: <span className="text-[#141414]">{cut.ean}</span></p>
                      <p className="text-[10px] text-gray-500 font-semibold">Distribuidora: <span className="text-[#141414] uppercase">{cut.distribuidora}</span></p>
                      
                      <div className="mt-2.5 pt-2 border-t border-gray-100 flex items-center justify-between text-[10px] bg-gray-50 p-1.5 border border-gray-100">
                        <span>Pedida: <strong>{cut.solicitado}</strong> | Faturada: <strong className="text-rose-600">{cut.faturado}</strong></span>
                        <span className="text-rose-700 font-bold">{cut.motivo}</span>
                      </div>
                    </div>
                  ))}
                </div>

                <div className="bg-amber-50 border border-amber-300 p-3 rounded-none text-[10px] text-amber-950 font-sans leading-relaxed">
                  💡 <strong>O que fazer?</strong> Esses itens retornaram ao seu lote principal de otimização como faltas ativas. Você pode tentar re-roteá-los para distribuidoras alternativas ou pesquisar novas ofertas no botão flutuante.
                </div>
              </div>

              {/* Footer */}
              <div className="bg-[#DCDAD7] border-t border-[#141414]/20 px-6 py-4 flex justify-end">
                <button
                  onClick={() => setManualCutsAlert(null)}
                  className="bg-[#141414] hover:bg-neutral-800 text-[#E4E3E0] font-bold text-xs uppercase tracking-wider py-2 px-5 rounded-none transition-all cursor-pointer border border-[#141414]"
                >
                  Entendi, vou Ajustar
                </button>
              </div>
            </div>
          </div>
        )}


        {/* Floating Button for Faturados */}
        {faturadosGlobais.length > 0 && (
          <button
            onClick={() => setIsFaturadosOpen(true)}
            className="fixed bottom-6 right-6 bg-emerald-700 hover:bg-emerald-800 text-white shadow-lg flex items-center justify-center p-4 rounded-full transition-transform hover:scale-105 z-40 group cursor-pointer"
            title="Ver itens faturados"
          >
            <div className="absolute -top-2 -right-2 bg-rose-600 text-white text-[10px] font-bold px-2 py-0.5 rounded-full border-2 border-white shadow-sm">
              {faturadosGlobais.length}
            </div>
            <span className="font-bold text-xs uppercase tracking-wider mr-2 hidden group-hover:inline-block">Faturados</span>
            <svg xmlns="http://www.w3.org/2000/svg" width="24" height="24" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" className="w-5 h-5"><path d="M6 2 3 6v14a2 2 0 0 0 2 2h14a2 2 0 0 0 2-2V6l-3-4Z"/><path d="M3 6h18"/><path d="M16 10a4 4 0 0 1-8 0"/></svg>
          </button>
        )}

        {isFaturadosOpen && (
          <FaturadosModal 
            faturados={faturadosGlobais} 
            onClose={() => setIsFaturadosOpen(false)} 
          />
        )}
        {viewingLogs && (
          <BillingLogsModal 
            groupKeys={viewingLogs.groupKeys}
            billedGroups={billedGroups}
            title={viewingLogs.title} 
            onClose={() => setViewingLogs(null)} 
          />
        )}
        {suspectItemAlert && (
          <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/60 backdrop-blur-xs p-4 animate-fade-in">
            <div className="bg-[#E4E3E0] border-2 border-red-600 max-w-lg w-full shadow-2xl flex flex-col overflow-hidden">
              {/* Cabeçalho de Alerta de Segurança */}
              <div className="bg-red-600 text-white px-6 py-4 flex items-center justify-between border-b-2 border-[#141414]">
                <div className="flex items-center space-x-2">
                  <span className="text-xl animate-bounce">⚠️</span>
                  <h3 className="font-serif italic font-extrabold text-xs uppercase tracking-wider">
                    ALERTA: Item Suspeito Detectado para Faturamento
                  </h3>
                </div>
                <button
                  onClick={() => setSuspectItemAlert(null)}
                  className="text-white hover:text-gray-200 transition-colors cursor-pointer text-sm font-bold"
                >
                  ✕
                </button>
              </div>

              {/* Conteúdo do Alerta */}
              <div className="p-6 space-y-4">
                <p className="text-xs text-[#141414] leading-relaxed">
                  O produto com o EAN suspeito <strong className="font-mono bg-red-100 text-red-800 px-1.5 py-0.5 border border-red-200">7896004706559</strong> foi localizado entre os itens ativos que serão faturados agora!
                </p>

                <div className="bg-white border border-[#141414] p-3 space-y-1.5 font-mono text-[10px] text-[#141414]">
                  <div className="border-b border-gray-100 pb-1 font-bold uppercase text-red-600">
                    Dados do Item no Lote Atual:
                  </div>
                  <div>
                    <strong>Cód. Interno:</strong> {suspectItemAlert.item.codInterno}
                  </div>
                  <div>
                    <strong>EAN Original:</strong> {suspectItemAlert.item.originalEan}
                  </div>
                  <div>
                    <strong>EAN Atual / Proposto:</strong> {suspectItemAlert.item.novoEan}
                  </div>
                  <div>
                    <strong>Descrição:</strong> {suspectItemAlert.item.novaDescricao || suspectItemAlert.item.originalDescricao}
                  </div>
                  <div>
                    <strong>Laboratório:</strong> {suspectItemAlert.item.novoLaboratorio || suspectItemAlert.item.originalLaboratorio}
                  </div>
                  <div>
                    <strong>Distribuidora:</strong> {suspectItemAlert.item.distribuidora}
                  </div>
                  <div>
                    <strong>Quantidade:</strong> {suspectItemAlert.item.qtd} un
                  </div>
                  <div>
                    <strong>Preço Unitário:</strong> R$ {(suspectItemAlert.item.novoPreco || suspectItemAlert.item.originalPreco).toFixed(2).replace(".", ",")}
                  </div>
                </div>

                <div className="text-[10px] text-gray-700 leading-relaxed bg-yellow-50 border border-yellow-200 p-3 font-medium space-y-1.5">
                  <strong>O que deseja fazer?</strong> 
                  <ul className="list-disc list-inside space-y-1 text-gray-600">
                    <li><strong className="text-red-700">Excluir e Continuar:</strong> Remove este item do lote (envia para lixeira) e prossegue faturando todos os outros itens normais de imediato.</li>
                    <li><strong>Manter e Faturar:</strong> Ignora o alerta temporariamente e envia o lote contendo este item também.</li>
                    <li><strong>Cancelar:</strong> Interrompe todo o processo de faturamento para permitir a análise manual na tabela.</li>
                  </ul>
                </div>
              </div>

              {/* Rodapé / Ações */}
              <div className="bg-[#DCDAD7] border-t border-[#141414]/20 px-6 py-4 flex flex-col sm:flex-row sm:justify-end gap-2">
                <button
                  onClick={() => setSuspectItemAlert(null)}
                  className="px-4 py-2 bg-gray-500 hover:bg-gray-600 text-white font-bold text-[9px] uppercase tracking-wider rounded-none transition-colors cursor-pointer"
                >
                  Cancelar
                </button>
                <button
                  onClick={() => {
                    const specDist = suspectItemAlert.specificDistributorName;
                    setSuspectItemAlert(null);
                    handleSendBilling(specDist, true);
                  }}
                  className="px-4 py-2 bg-amber-600 hover:bg-amber-700 text-white font-bold text-[9px] uppercase tracking-wider rounded-none transition-colors cursor-pointer"
                >
                  Manter e Faturar
                </button>
                <button
                  onClick={() => {
                    const cod = suspectItemAlert.item.codInterno;
                    const specDist = suspectItemAlert.specificDistributorName;
                    
                    setDisabledItemCodes(prev => {
                      const next = new Set(prev);
                      next.add(cod);
                      return next;
                    });
                    
                    setSuspectItemAlert(null);
                    
                    alert(`O item com código ${cod} foi excluído do faturamento e enviado para a Lixeira. Prosseguindo com o envio do restante do lote...`);
                    
                    setTimeout(() => {
                      handleSendBilling(specDist, true);
                    }, 100);
                  }}
                  className="px-4 py-2 bg-red-600 hover:bg-red-700 text-white font-bold text-[9px] uppercase tracking-wider rounded-none transition-all cursor-pointer shadow-md"
                >
                  Excluir Item e Continuar Faturamento
                </button>
              </div>
            </div>
          </div>
        )}
        {billingChoice && (
          <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/60 backdrop-blur-xs p-4 animate-fade-in">
            <div className="bg-[#E4E3E0] border-4 border-[#141414] max-w-lg w-full shadow-[8px_8px_0px_0px_rgba(20,20,20,1)] flex flex-col overflow-hidden">
              <div className="bg-[#141414] text-[#E4E3E0] px-6 py-4 flex items-center justify-between border-b-2 border-[#141414]">
                <div className="flex items-center space-x-2">
                  <Truck className="w-5 h-5 text-indigo-400" />
                  <h3 className="font-serif italic font-extrabold text-xs uppercase tracking-wider">
                    Opções de Faturamento: {billingChoice.baseDistName}
                  </h3>
                </div>
                <button
                  onClick={() => setBillingChoice(null)}
                  className="text-white hover:text-gray-200 transition-colors cursor-pointer text-sm font-bold"
                >
                  ✕
                </button>
              </div>

              <div className="p-6 space-y-4">
                <p className="text-xs text-[#141414] leading-relaxed">
                  Você escolheu processar o lote de <strong className="font-bold text-indigo-700">{billingChoice.baseDistName}</strong> contendo <strong className="font-mono bg-indigo-100 text-indigo-800 px-1.5 py-0.5 border border-indigo-200">{billingChoice.activeItems.length} itens</strong>.
                </p>
                
                <div className="bg-blue-50 border border-blue-200 text-blue-900 p-3 rounded-none text-[10px] space-y-2">
                  <p className="font-bold uppercase tracking-wide">💡 COMO DESEJA PROSSEGUIR?</p>
                  <p className="leading-relaxed">
                    Você pode escolher **gerar apenas o arquivo de payload em formato JSON** para analisar as informações de forma bruta localmente, ou prosseguir normalmente para a transmissão oficial.
                  </p>
                </div>
              </div>

              <div className="bg-[#DCDAD7] border-t border-[#141414]/20 px-6 py-4 flex flex-col sm:flex-row sm:justify-end gap-2">
                <button
                  onClick={() => setBillingChoice(null)}
                  className="px-4 py-2.5 bg-gray-500 hover:bg-gray-600 text-white font-bold text-[9px] uppercase tracking-wider rounded-none transition-colors cursor-pointer"
                >
                  Cancelar
                </button>
                <button
                  onClick={() => {
                    const { specificDistributorName } = billingChoice;
                    setBillingChoice(null);
                    handleSendBilling(specificDistributorName, true, true, true);
                  }}
                  className="px-4 py-2.5 bg-[#141414] hover:bg-neutral-800 text-white font-extrabold text-[9px] uppercase tracking-wider rounded-none transition-colors cursor-pointer flex items-center justify-center gap-1.5"
                >
                  <FileDown className="w-3.5 h-3.5" />
                  <span>Apenas Gerar JSON para Análise</span>
                </button>
                <button
                  onClick={() => {
                    const { specificDistributorName, baseDistName, activeItems } = billingChoice;
                    setBillingChoice(null);
                    setBillingConfirm({ specificDistributorName, baseDistName, activeItems });
                  }}
                  className="px-4 py-2.5 bg-emerald-700 hover:bg-emerald-800 text-white font-extrabold text-[9px] uppercase tracking-wider rounded-none transition-colors cursor-pointer flex items-center justify-center gap-1.5"
                >
                  <Truck className="w-3.5 h-3.5" />
                  <span>De Fato Enviar para SmartPed</span>
                </button>
              </div>
            </div>
          </div>
        )}
        {billingConfirm && (
          <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/60 backdrop-blur-xs p-4 animate-fade-in">
            <div className="bg-[#E4E3E0] border-4 border-[#141414] max-w-lg w-full shadow-[8px_8px_0px_0px_rgba(20,20,20,1)] flex flex-col overflow-hidden">
              <div className="bg-[#141414] text-[#E4E3E0] px-6 py-4 flex items-center justify-between border-b-2 border-[#141414]">
                <div className="flex items-center space-x-2">
                  <ShieldCheck className="w-5 h-5 text-emerald-400" />
                  <h3 className="font-serif italic font-extrabold text-xs uppercase tracking-wider">
                    Confirmar Faturamento Lote SmartPed
                  </h3>
                </div>
                <button
                  onClick={() => setBillingConfirm(null)}
                  className="text-white hover:text-gray-200 transition-colors cursor-pointer text-sm font-bold"
                >
                  ✕
                </button>
              </div>

              <div className="p-6 space-y-4">
                <p className="text-xs text-[#141414] leading-relaxed">
                  Você está prestes a faturar <strong className="font-mono bg-emerald-100 text-emerald-800 px-1.5 py-0.5 border border-emerald-200">{billingConfirm.activeItems.length} itens</strong> para a distribuidora: <strong className="font-bold text-indigo-700">{billingConfirm.baseDistName}</strong>.
                </p>
                
                <div className="bg-amber-50 border border-amber-200 text-amber-900 p-3 rounded-none text-[10px] space-y-1">
                  <p className="font-bold uppercase tracking-wide">⚠️ REQUISITO IMPORTANTE:</p>
                  <p className="leading-relaxed">Certifique-se de que revisou todos os itens <strong>fracionados</strong> e suas quantidades antes de continuar. Essa ação transmitirá o pedido de forma oficial.</p>
                </div>
              </div>

              <div className="bg-[#DCDAD7] border-t border-[#141414]/20 px-6 py-4 flex justify-end gap-2">
                <button
                  onClick={() => setBillingConfirm(null)}
                  className="px-4 py-2 bg-gray-500 hover:bg-gray-600 text-white font-bold text-[9px] uppercase tracking-wider rounded-none transition-colors cursor-pointer"
                >
                  Cancelar
                </button>
                <button
                  onClick={() => {
                    const { specificDistributorName } = billingConfirm;
                    setBillingConfirm(null);
                    handleSendBilling(specificDistributorName, false, true);
                  }}
                  className="px-5 py-2 bg-emerald-700 hover:bg-emerald-800 text-white font-extrabold text-[9px] uppercase tracking-wider rounded-none transition-colors cursor-pointer shadow-sm"
                >
                  ✓ Confirmar e Enviar Faturamento
                </button>
              </div>
            </div>
          </div>
        )}
      </main>

    </div>
    </Suspense>
  );
}
