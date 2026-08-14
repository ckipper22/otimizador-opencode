import React, { useState, useMemo, useEffect, useRef } from "react";
import { FileDown, CheckCircle, CheckCircle2, RefreshCw, AlertCircle, Sparkles, Wifi, WifiOff, Send, Truck, X, ShieldCheck, Search, Plus, AlertTriangle, Clock, ArrowLeft, Trash2, ArrowDown, ChevronRight, XCircle, Copy, Lock, Mail, Eye, EyeOff, Settings, ArrowUp, GripVertical } from "lucide-react";
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
import { HOMOLOGACAO_SICF_FILE, formatCurrency, resolveEstoque, resolveQtdMinima, resolvePedidoMinimo, safeEanCompare, resolvePrecoLiquido } from "./utils";
import { auth, googleProvider } from "./lib/firebaseClient";
import { signInWithPopup, signOut } from "firebase/auth";

const normalizeDistName = (name: string) => 
  (name || "")
    .split('[')[0]
    .trim()
    .normalize("NFD")
    .replace(/[\u0300-\u036f]/g, "")
    .toUpperCase();

const cleanEan = (ean: string | number | undefined | null): string => {
  if (ean === undefined || ean === null) return "";
  const cleaned = String(ean).trim().replace(/\D/g, "");
  if (!cleaned) return "";
  if (cleaned.length <= 13) {
    return cleaned.padStart(13, "0");
  }
  return cleaned;
};

const getRecentCutsMap = (orders: any[]) => {
  const cutsMap: Record<string, string[]> = {};
  if (!orders || !Array.isArray(orders)) return cutsMap;

  // Calculate strings of the last 2 business days in DD/MM/YYYY
  const getRecentBusinessDays = (count: number) => {
    const dates = new Set<string>();
    const d = new Date();
    
    const formatDateStr = (date: Date) => {
      const dd = String(date.getDate()).padStart(2, '0');
      const mm = String(date.getMonth() + 1).padStart(2, '0');
      const yyyy = date.getFullYear();
      return `${dd}/${mm}/${yyyy}`;
    };

    dates.add(formatDateStr(d));

    let businessDaysFound = (d.getDay() === 0 || d.getDay() === 6) ? 0 : 1;
    const tempDate = new Date(d.getTime());
    
    for (let i = 1; i <= 10; i++) {
      tempDate.setDate(tempDate.getDate() - 1);
      const dayOfWeek = tempDate.getDay();
      const isWeekend = dayOfWeek === 0 || dayOfWeek === 6;
      dates.add(formatDateStr(tempDate));
      if (!isWeekend) {
        businessDaysFound++;
        if (businessDaysFound >= count) {
          break;
        }
      }
    }
    return dates;
  };

  const allowedDates = getRecentBusinessDays(2);

  orders.forEach(order => {
    const orderDate = String(order.dataPedido || order.DataPedido || "").trim();
    if (allowedDates.has(orderDate) && order.detalhes?.Itens) {
      order.detalhes.Itens.forEach((item: any) => {
        const ean = cleanEan(item.Ean || item.ean || "");
        if (!ean) return;

        // Check if cut happened
        const q = Number(item.Quant || 0);
        const qF = Number(item.QuantFaturada !== undefined ? item.QuantFaturada : q);
        
        // If QuantFaturada is less than Quant, or explicitly mentioned lack of stock, or QuantFaturada is 0
        const isCut = q > 0 && (
          qF < q || 
          String(item.Motivo || "").toLowerCase().includes("estoque") || 
          String(item.Motivo || "").toLowerCase().includes("falta") || 
          String(item.Motivo || "").toLowerCase().includes("corte")
        );
        
        if (isCut) {
          const distNameClean = normalizeDistName(item.NomeDist || item.Nome || item.distribuidora || "");
          if (distNameClean) {
            if (!cutsMap[ean]) {
              cutsMap[ean] = [];
            }
            if (!cutsMap[ean].includes(distNameClean)) {
              cutsMap[ean].push(distNameClean);
            }
          }
        }
      });
    }
  });

  return cutsMap;
};

export default function App() {
  const dragControls = useDragControls();
  const isDragging = useRef(false);

  // Estados de Autenticação de Segurança
  const [isAuthenticated, setIsAuthenticated] = useState<boolean>(() => {
    return localStorage.getItem("app_authenticated") === "true";
  });
  const [currentUserEmail, setCurrentUserEmail] = useState<string>(() => {
    return localStorage.getItem("current_user_email") || "";
  });
  const [loginEmail, setLoginEmail] = useState("");
  const [loginPassword, setLoginPassword] = useState("");
  const [showPassword, setShowPassword] = useState(false);
  const [loginError, setLoginError] = useState("");

  const [authorizedCompanies, setAuthorizedCompanies] = useState<AuthorizedCompany[]>(() => {
    try {
      const saved = localStorage.getItem("authorized_companies");
      return saved ? JSON.parse(saved) : [
        { id: "comp_1", email: "aga706panambi@gmail.com", nome: "Farmácia Aga706 Panambi", token: "fddfd9871b77f44f243e145207c8e93a", cnpj: "13408443000168" }
      ];
    } catch {
      return [];
    }
  });

  useEffect(() => {
    localStorage.setItem("authorized_companies", JSON.stringify(authorizedCompanies));
  }, [authorizedCompanies]);

  const isAdmin = currentUserEmail === "ckipper22@gmail.com" || currentUserEmail === "aga706panambi@gmail.com" || !currentUserEmail;

  const handleLoginSubmit = (e: React.FormEvent) => {
    e.preventDefault();
    const cleanEmail = loginEmail.trim().toLowerCase();
    const password = loginPassword;
    
    if ((cleanEmail === "ckipper22@gmail.com" || cleanEmail === "aga706panambi@gmail.com") && password === "Aq1sw2de#fr4") {
      localStorage.setItem("app_authenticated", "true");
      localStorage.setItem("current_user_email", cleanEmail);
      setCurrentUserEmail(cleanEmail);
      setIsAuthenticated(true);
      setLoginError("");
    } else {
      const foundComp = authorizedCompanies.find(c => c.email.toLowerCase() === cleanEmail);
      if (foundComp) {
        localStorage.setItem("app_authenticated", "true");
        localStorage.setItem("current_user_email", cleanEmail);
        setCurrentUserEmail(cleanEmail);
        setIsAuthenticated(true);
        setLoginError("");
      } else {
        setLoginError("E-mail ou senha incorretos, ou farmácia não cadastrada.");
      }
    }
  };

  const handleGoogleLogin = async () => {
    try {
      setLoginError("");
      const result = await signInWithPopup(auth, googleProvider);
      const user = result.user;
      const verifiedEmail = user.email?.toLowerCase();

      if (verifiedEmail) {
        if (verifiedEmail === "ckipper22@gmail.com" || verifiedEmail === "aga706panambi@gmail.com") {
          localStorage.setItem("app_authenticated", "true");
          localStorage.setItem("current_user_email", verifiedEmail);
          setCurrentUserEmail(verifiedEmail);
          setIsAuthenticated(true);
          setLoginError("");
          return;
        } else {
          const foundComp = authorizedCompanies.find(c => c.email.toLowerCase() === verifiedEmail);
          if (foundComp) {
            localStorage.setItem("app_authenticated", "true");
            localStorage.setItem("current_user_email", verifiedEmail);
            setCurrentUserEmail(verifiedEmail);
            setIsAuthenticated(true);
            setLoginError("");
            return;
          } else {
            await signOut(auth);
            setLoginError(`Acesso negado. A conta Google autenticada ("${verifiedEmail}") não está cadastrada. Solicite ao administrador (ckipper22@gmail.com) o cadastro.`);
          }
        }
      } else {
        setLoginError("Não foi possível obter o e-mail da conta Google autenticada.");
      }
    } catch (error: any) {
      console.error("Google login error:", error);
      if (error.code === 'auth/popup-closed-by-user') {
        setLoginError("Autenticação Google cancelada pelo usuário.");
      } else {
        setLoginError(`Erro na autenticação Google: ${error.message || error}`);
      }
    }
  };

  const handleLogout = async () => {
    try {
      await signOut(auth);
    } catch (e) {
      // ignore
    }
    localStorage.removeItem("app_authenticated");
    localStorage.removeItem("current_user_email");
    setIsAuthenticated(false);
    setCurrentUserEmail("");
  };

  // Application State
  const [activeTab, setActiveTab] = useState<"production" | "homologation" | "daily_items">("production");
  const [mainView, setMainView] = useState<"optimize" | "returns" | "daily_items">("optimize");
  
  // Direct Return tracking states
  const [directNumPedido, setDirectNumPedido] = useState<string>("");
  const [directOrderReturn, setDirectOrderReturn] = useState<any | null>(null);
  const [isCheckingDirectReturn, setIsCheckingDirectReturn] = useState<boolean>(false);
  const [directReturnCheckLogs, setDirectReturnCheckLogs] = useState<string[]>([]);
  const [directAutoPollReturn, setDirectAutoPollReturn] = useState<boolean>(false);

  const [dailyOrders, setDailyOrders] = useState<any[]>([]);
  const [isCheckingDaily, setIsCheckingDaily] = useState<boolean>(false);
  const [dailyOrderLogs, setDailyOrderLogs] = useState<string[]>([]);
  const [selectedDailyOrder, setSelectedDailyOrder] = useState<any | null>(null);
  const [highlightedOrder, setHighlightedOrder] = useState<any | null>(null);

  const [fileContent, setFileContent] = useState<string>("");
  const [fileName, setFileName] = useState<string>("");

  const [externalSuppliers, setExternalSuppliers] = useState<ExternalSupplier[]>(() => {
    try {
      const saved = localStorage.getItem("external_suppliers");
      return saved ? JSON.parse(saved) : [];
    } catch {
      return [];
    }
  });

  const handleUpdateExternalSuppliers = (newSuppliers: ExternalSupplier[]) => {
    setExternalSuppliers(newSuppliers);
    localStorage.setItem("external_suppliers", JSON.stringify(newSuppliers));
  };
  
  // Distributors state
  const [distributors, setDistributors] = useState<DistributorOption[]>([]);
  const [disabledDistributors, setDisabledDistributors] = useState<Set<number>>(new Set());
  const [isLoadingDistributors, setIsLoadingDistributors] = useState<boolean>(false);
  const [config, setConfig] = useState<OptimizerConfig>(() => {
    try {
      const saved = localStorage.getItem("optimizer_config");
      if (saved) return JSON.parse(saved);
    } catch (err) {
      console.error(err);
    }
    return {
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
    };
  });

  useEffect(() => {
    localStorage.setItem("optimizer_config", JSON.stringify(config));
  }, [config]);

  const [isLoading, setIsLoading] = useState<boolean>(false);
  const [error, setError] = useState<string | null>(null);
  const [result, setResult] = useState<OptimizationResponse | null>(null);
  const [showQuantityInterception, setShowQuantityInterception] = useState<boolean>(true);
  const [preDistributedMap, setPreDistributedMap] = useState<Record<string, { codDist: number; condicao: string; prazo: number; codProdutoDist: string; quant: number }> | null>(null);
  const [logs, setLogs] = useState<string[]>([]);
  const [backendStatus, setBackendStatus] = useState<"checking" | "online" | "offline">("checking");
  const [isConfigOpen, setIsConfigOpen] = useState<boolean>(false);
  
  // Track disregarded swaps (by codInterno)
  const [disregardedCodes, setDisregardedCodes] = useState<Set<string>>(new Set());
  
  // Track disabled item codes (totally excluded from the orders)
  const [disabledItemCodes, setDisabledItemCodes] = useState<Set<string>>(new Set());

  // Track billed item codes (removed from active list as soon as billed)
  const [billedItemCodes, setBilledItemCodes] = useState<Set<string>>(new Set());

  // Track manually overridden distributors (by codInterno)
  const [overriddenDistributors, setOverriddenDistributors] = useState<Record<string, string>>({});

  // Billing (Faturamento) States
  const [isBillingLoading, setIsBillingLoading] = useState<boolean>(false);
  const [billingResult, setBillingResult] = useState<any | null>(null);
  const [isBillingModalOpen, setIsBillingModalOpen] = useState<boolean>(false);
  const [billedGroups, setBilledGroups] = useState<Record<string, { status: "faturando" | "retornado", faltas: any[], logs: string[] }>>({});
  const [billingContext, setBillingContext] = useState<{relatedGroups: string[], baseDistName: string, numPedido: number, itemsFaturados: any[]} | null>(null);
  const [viewingLogs, setViewingLogs] = useState<{groupKeys: string[], title: string} | null>(null);
  const [billingConfirm, setBillingConfirm] = useState<{ specificDistributorName?: string; baseDistName: string; activeItems: any[] } | null>(null);
  const [billingChoice, setBillingChoice] = useState<{ specificDistributorName?: string; baseDistName: string; activeItems: any[] } | null>(null);

  // Manual Item Search states
  const [manualQuery, setManualQuery] = useState<string>("");
  const [faturadosGlobais, setFaturadosGlobais] = useState<import("./types").FaturadoItem[]>([]);
  const [isFaturadosOpen, setIsFaturadosOpen] = useState<boolean>(false);
  const [isManualAddModalOpen, setIsManualAddModalOpen] = useState<boolean>(false);
  const [manualModalWidth, setManualModalWidth] = useState<string>(() => sessionStorage.getItem('manual_modal_width') || "1200px");
  const [manualModalHeight, setManualModalHeight] = useState<string>(() => sessionStorage.getItem('manual_modal_height') || "700px");
  const [manualAddOriginItem, setManualAddOriginItem] = useState<{ean: string, descricao: string, laboratorio: string} | null>(null);
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

  // Column settings for offers table (persisted in sessionStorage)
  const OFFER_COL_DEFAULTS: Record<string, { vis: boolean; w: number }> = {
    dist:      { vis: true,  w: 150 },
    prod:      { vis: true,  w: 280 },
    pfab:      { vis: true,  w: 100 },
    desc:      { vis: true,  w: 90  },
    descExtra: { vis: false, w: 100 },
    st:        { vis: false, w: 100 },
    pLiq:      { vis: true,  w: 120 },
    prazo:     { vis: true,  w: 80  },
    qtdMin:    { vis: true,  w: 100 },
    pedMin:    { vis: true,  w: 110 },
    acao:      { vis: true,  w: 180 },
  };
  const OFFER_COL_LABELS: Record<string, string> = {
    dist: "Distribuidora", prod: "Produto & EAN", pfab: "P. Fábrica",
    desc: "Desc %", descExtra: "Desc Extra %", st: "ST (R$)",
    pLiq: "Preço Líquido", prazo: "Prazo", qtdMin: "Qtd Mín. Item",
    pedMin: "Ped. Mín. Dist", acao: "Qtd / Ação",
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

  // Order Return tracking states
  const [orderReturn, setOrderReturn] = useState<any | null>(null);
  const [isCheckingReturn, setIsCheckingReturn] = useState<boolean>(false);
  const [returnCheckLogs, setReturnCheckLogs] = useState<string[]>([]);
  const [manualCutsAlert, setManualCutsAlert] = useState<any[] | null>(null);
  const [autoPollReturn, setAutoPollReturn] = useState<boolean>(false);

  // Distributor minimums and smart routing states
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

  const [showStats, setShowStats] = useState<boolean>(true);
  const [isSwapsTableVisible, setIsSwapsTableVisible] = useState<boolean>(true);
  const [suspectItemAlert, setSuspectItemAlert] = useState<{ item: any; specificDistributorName?: string } | null>(null);

  useEffect(() => {
    async function fetchDistribuidores() {
      if (!config.token || !config.cnpj) return;
      setIsLoadingDistributors(true);
      try {
        const response = await fetch("/api/distribuidores", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify(config)
        });
        if (response.ok) {
          const data = await response.json();
          if (data.distribuidores && Array.isArray(data.distribuidores)) {
            setDistributors(data.distribuidores);
          }
        }
      } catch (err) {
        console.error("Erro ao buscar distribuidores:", err);
      } finally {
        setIsLoadingDistributors(false);
      }
    }
    fetchDistribuidores();
  }, [config.token, config.cnpj, config.useTestUrl, config.customTestUrl, config.customProductionUrl, config.customEndpoint]);

  const handleToggleDistributor = (codigo: number) => {
    setDisabledDistributors(prev => {
      const next = new Set(prev);
      if (next.has(codigo)) {
        next.delete(codigo);
      } else {
        next.add(codigo);
      }
      return next;
    });
  };

  // Check Backend Status
  useEffect(() => {
    async function checkBackend() {
      try {
        const response = await fetch("/api/health");
        const data = await response.json();
        if (data && data.status === "ok") {
          setBackendStatus("online");
        } else {
          setBackendStatus("offline");
        }
      } catch (err) {
        console.error("Erro ao checar integridade do backend:", err);
        setBackendStatus("offline");
      }
    }
    checkBackend();
  }, []);

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

  // File loading callback
  const handleFileLoaded = (content: string, name: string) => {
    setFileContent(content);
    setFileName(name);
    setResult(null);
    setError(null);
    setLogs([]);
    setDisregardedCodes(new Set());
    setDisabledItemCodes(new Set());
    setBilledItemCodes(new Set());
    setOverriddenDistributors({});

    let targetCnpj = config.cnpj;
    // Tentar extrair o CNPJ da primeira linha (Cabeçalho tipo 1) do arquivo carregado
    try {
      let cleanedContent = content || "";
      if (cleanedContent.startsWith("\ufeff")) {
        cleanedContent = cleanedContent.substring(1);
      }
      const lines = cleanedContent.replace(/\r\n/g, "\n").split("\n");
      for (let i = 0; i < lines.length; i++) {
        const line = lines[i].trim();
        if (!line) continue;
        const parts = line.split(";");
        const tipo = parts[0] ? parts[0].trim() : "";
        if (tipo === "1" && parts[1]) {
          const rawCnpj = parts[1].trim().replace(/\D/g, "");
          if (rawCnpj && rawCnpj.length >= 11) {
            targetCnpj = rawCnpj;
            setConfig(prev => ({
              ...prev,
              cnpj: rawCnpj
            }));
            break;
          }
        }
      }
    } catch (e) {
      console.error("Erro ao analisar CNPJ do arquivo:", e);
    }

    // DISPARAR BUSCA AUTOMÁTICA DOS PEDIDOS DE PROFARMA
    handleCheckDailyOrders(config.token, targetCnpj);
  };

  const handleClearFile = () => {
    setFileContent("");
    setFileName("");
    setResult(null);
    setError(null);
    setLogs([]);
    setDisregardedCodes(new Set());
    setDisabledItemCodes(new Set());
    setBilledItemCodes(new Set());
    setOverriddenDistributors({});
  };

  // Perform Optimization
  const handleOptimize = async (overrideFileContent?: string, overridePreDistributedMap?: any, overrideSimulationMode?: boolean) => {
    const isOverrideString = typeof overrideFileContent === "string";
    const activeFileContent = isOverrideString ? overrideFileContent : fileContent;
    if (!activeFileContent) return;

    setIsLoading(true);
    setError(null);
    setResult(null);
    setLogs(["[PREPARANDO] Formatando dados para envio e iniciando conexões..."]);
    setDisregardedCodes(new Set());
    setOverriddenDistributors({});

    try {
      // Buscar sempre os pedidos dos últimos dois dias úteis da Profarma (automático) antes de processar o arquivo SICF
      setLogs((prev) => [...prev, "[SISTEMA] Sincronizando pedidos recentes da Profarma para checar duplicidades..."]);
      try {
        await handleCheckDailyOrders(config.token, config.cnpj);
      } catch (err: any) {
        console.error("Erro ao sincronizar pedidos recentes automaticamente:", err);
        setLogs((prev) => [...prev, `[SISTEMA ALERTA] Não foi possível atualizar pedidos recentes para duplicidade: ${err.message}`]);
      }

      const storedCutsStr = localStorage.getItem("cortes_recentes");
      const cortesRecentes = storedCutsStr ? JSON.parse(storedCutsStr) : {};

      const response = await fetch("/api/optimize", {
        method: "POST",
        headers: {
          "Content-Type": "application/json"
        },
        body: JSON.stringify({
          fileContent: activeFileContent,
          token: config.token,
          cnpj: config.cnpj,
          margemMinima: config.margemMinima,
          tipos: config.tipos,
          permitirSemEstoque: config.permitirSemEstoque,
          useTestUrl: config.useTestUrl,
          simulationMode: overrideSimulationMode !== undefined ? overrideSimulationMode : config.simulationMode,
          customProductionUrl: config.customProductionUrl,
          customTestUrl: config.customTestUrl,
          customEndpoint: config.customEndpoint,
          disabledDistributors: Array.from(disabledDistributors),
          externalSuppliers,
          cortesRecentes
        })
      });

      let data: any = {};
      const contentType = response.headers.get("content-type");
      if (contentType && contentType.includes("application/json")) {
        data = await response.json();
      } else {
        const text = await response.text();
        const shortText = text.length > 120 ? text.substring(0, 120) + "..." : text;
        throw new Error(`Erro de resposta do servidor (Status ${response.status}): ${shortText || "Resposta vazia"}`);
      }

      if (data.logs) {
        setLogs(data.logs);
      }

      if (!response.ok) {
        throw new Error(data.error || `Erro do servidor (Status ${response.status})`);
      }

      // Update minimum order values based on the API response using compound key (distribuidora + condicao + prazo)
      if (data.minimos && Array.isArray(data.minimos)) {
        const newMinimums: Record<string, number> = {};
        data.minimos.forEach((m: any) => {
          const distName = m.NomeDist;
          if (distName) {
            const cond = m.Condicao || m.condicao || m.NomeCondicao || "FIXA";
            const prz = m.Prazo !== undefined ? m.Prazo : (m.prazo !== undefined ? m.prazo : 0);
            const compoundKey = `${distName} [${cond} | ${prz}d]`;
            const vlrMin = m.VlrMinimo !== undefined ? m.VlrMinimo : (m.vlrMinimo !== undefined ? m.vlrMinimo : 0);
            newMinimums[compoundKey] = vlrMin;
          }
        });
        setDistributorMinimums(newMinimums);
      } else if (data.report && data.report.length > 0) {
        // Fallback to report items if minimos array is missing
        const newMinimums: Record<string, number> = {};
        for (const item of data.report) {
          if (item.distribuidora && item.distribuidora !== "Não Encontrados" && item.distribuidora !== "Sem Estoque") {
            const cond = item.condicao || "FIXA";
            const prz = item.prazo !== undefined ? item.prazo : 0;
            const compoundKey = `${item.distribuidora} [${cond} | ${prz}d]`;
            const itemMin = item.pedidoMinimo || 0;
            newMinimums[compoundKey] = itemMin;
          }
        }
        setDistributorMinimums(newMinimums);
      }

      // Restore pre-distributed items if mapping is active
      let finalData = data;
      const mapToUse = isOverrideString ? overridePreDistributedMap : preDistributedMap;

      if (mapToUse && finalData.report && Array.isArray(finalData.report)) {
        const fallbackDists: Record<number, string> = {
          4: "Profarma",
          53: "ANB",
          59: "SMARTDISTRIBUIDORA",
          60: "CervoSul",
          81: "GAM",
          624: "Gauchofarma",
          2: "Pan/Santa",
          68: "Dp4",
          79: "NeoSul"
        };

        const updatedReport = finalData.report.map((item: any) => {
          const ean = item.originalEan;
          const mapped = mapToUse[ean];
          if (mapped) {
            const distObj = distributors.find((d: any) => d.Codigo === mapped.codDist);
            const distName = distObj ? distObj.Nome : (fallbackDists[mapped.codDist] || `Fornecedor ${mapped.codDist}`);

            // Procurar se existe alguma alternativa correspondente a essa distribuidora e condicao/prazo
            let matchedAlternative = item.alternatives?.find((alt: any) => 
              alt.codDist === mapped.codDist && 
              String(alt.condicao).toUpperCase() === String(mapped.condicao).toUpperCase()
            );

            if (!matchedAlternative) {
              matchedAlternative = item.alternatives?.find((alt: any) => alt.codDist === mapped.codDist);
            }

            if (matchedAlternative) {
              const ecoUnit = Math.max(0, item.originalPreco - matchedAlternative.preco);
              return {
                ...item,
                novoEan: matchedAlternative.ean,
                novaDescricao: matchedAlternative.descricao || item.novaDescricao || item.originalDescricao,
                novoLaboratorio: matchedAlternative.laboratorio || item.novoLaboratorio || item.originalLaboratorio,
                novoPreco: matchedAlternative.preco,
                qtd: mapped.quant,
                economiaUnit: ecoUnit,
                economiaTotal: ecoUnit * mapped.quant,
                distribuidora: matchedAlternative.distribuidora,
                codDist: matchedAlternative.codDist,
                condicao: matchedAlternative.condicao,
                prazo: matchedAlternative.prazo,
                codProdutoDist: mapped.codProdutoDist || matchedAlternative.codProdutoDist || "",
                estoque: matchedAlternative.estoque || 9999,
                isShortage: false
              };
            } else {
              // Criar oferta virtual correspondente ao log
              const mockPrice = item.originalPreco || 0;
              return {
                ...item,
                novoEan: item.originalEan,
                novaDescricao: item.originalDescricao,
                novoLaboratorio: item.originalLaboratorio,
                novoPreco: mockPrice,
                qtd: mapped.quant,
                economiaUnit: 0,
                economiaTotal: 0,
                distribuidora: distName,
                codDist: mapped.codDist,
                condicao: mapped.condicao,
                prazo: mapped.prazo,
                codProdutoDist: mapped.codProdutoDist || "",
                estoque: 9999,
                isShortage: false
              };
            }
          }
          return item;
        });

        finalData = {
          ...finalData,
          report: updatedReport,
          summary: {
            totalItems: updatedReport.length,
            itemsTreated: updatedReport.length,
            itemsSwapped: updatedReport.filter((it: any) => it.originalEan !== it.novoEan).length,
            totalSavings: updatedReport.reduce((sum: number, it: any) => sum + (it.economiaTotal || 0), 0)
          }
        };

        setLogs(prev => [
          ...prev,
          `[SUCESSO] Distribuição e faturamento restaurados com sucesso para ${updatedReport.filter((it: any) => !it.isShortage).length} itens com base no log!`
        ]);
      }

      setResult(finalData);
      setShowQuantityInterception(finalData.report?.some((it: any) => it.alertaConfirmarQtd) || false);
      setPreDistributedMap(null); // Limpar após uso
    } catch (err: any) {
      console.error(err);
      setError(err.message || "Ocorreu um erro inesperado durante a otimização.");
    } finally {
      setIsLoading(false);
    }
  };

  // Toggle item disregard status
  const handleToggleDisregard = (codInterno: string) => {
    setDisregardedCodes((prev) => {
      const next = new Set(prev);
      if (next.has(codInterno)) {
        next.delete(codInterno);
      } else {
        next.add(codInterno);
      }
      return next;
    });
  };

  // Toggle item disabled/active status
  const handleToggleDisabled = (codInterno: string) => {
    setDisabledItemCodes((prev) => {
      const next = new Set(prev);
      if (next.has(codInterno)) {
        next.delete(codInterno);
      } else {
        next.add(codInterno);
      }
      return next;
    });
  };

  // Update item quantity inline
  const handleUpdateQty = (codInterno: string, newQty: number) => {
    setResult((prev: any) => {
      if (!prev) return null;
      if (newQty === 0) {
        return {
          ...prev,
          report: prev.report.filter((item: any) => item.codInterno !== codInterno)
        };
      }
      return {
        ...prev,
        report: prev.report.map((item: any) => {
          if (item.codInterno === codInterno) {
            const qty = Math.max(1, newQty);
            return {
              ...item,
              qtd: qty,
              economiaTotal: (item.economiaUnit || 0) * qty
            };
          }
          return item;
        })
      };
    });
  };

  // Update item condition selection inline
  const handleSelectCondition = (codInterno: string, selectedAlt: any) => {
    setResult((prev: any) => {
      if (!prev) return null;
      return {
        ...prev,
        report: prev.report.map((item: any) => {
          if (item.codInterno === codInterno) {
            const qty = item.qtd;
            const priceDiff = item.originalPreco - selectedAlt.preco;
            const ecoUnit = priceDiff > 0 ? priceDiff : 0;
            return {
              ...item,
              novoEan: selectedAlt.ean || item.originalEan,
              novaDescricao: selectedAlt.descricao || item.originalDescricao,
              novoLaboratorio: selectedAlt.laboratorio || item.originalLaboratorio || "GENÉRICO",
              novoPreco: selectedAlt.preco,
              economiaUnit: ecoUnit,
              economiaTotal: ecoUnit * qty,
              distribuidora: selectedAlt.distribuidora,
              codDist: selectedAlt.codDist,
              condicao: selectedAlt.condicao,
              prazo: selectedAlt.prazo,
              qtdMin: selectedAlt.qtdMin,
              qtdMax: selectedAlt.qtdMax,
              cx: selectedAlt.cx,
              estoque: selectedAlt.estoque,
              codProdutoDist: selectedAlt.codProdutoDist !== undefined ? selectedAlt.codProdutoDist : (item.codProdutoDist || ""),
              codProduto: (() => {
                const finalCodProdutoDist = selectedAlt.codProdutoDist !== undefined ? selectedAlt.codProdutoDist : (item.codProdutoDist || "");
                const rawCodProduto = selectedAlt.codProduto !== undefined ? selectedAlt.codProduto : (item.codProduto || "");
                return (rawCodProduto === "0" || !rawCodProduto) ? finalCodProdutoDist : rawCodProduto;
              })()
            };
          }
          return item;
        })
      };
    });
  };

  // Delete all items for a specific distributor
  const handleDeleteDistributor = (distName: string) => {
    if (!result) return;
    setResult((prev: any) => {
      if (!prev) return null;
      const updatedReport = prev.report.filter((item: any) => {
        const dist = item.distribuidora || "Não Encontrados";
        const isVirtual = dist === "Não Encontrados" || dist === "Sem Estoque";
        const itemGroupKey = isVirtual 
          ? dist 
          : `${dist} [${item.condicao || "FIXA"} | ${item.prazo !== undefined ? item.prazo : 0}d]`;
        return itemGroupKey !== distName;
      });
      
      const activeSwaps = updatedReport.filter((item: any) => !disregardedCodes.has(item.codInterno));
      const newTotalSavings = activeSwaps.reduce((acc: number, it: any) => acc + (it.economiaTotal || 0), 0);
      
      return {
        ...prev,
        summary: {
          ...prev.summary,
          totalItems: updatedReport.length,
          itemsTreated: updatedReport.length,
          totalSavings: newTotalSavings
        },
        report: updatedReport
      };
    });
  };

  // Derived active state of the report items (restored to original when disregarded)
  const activeReport = useMemo(() => {
    if (!result) return [];
    return result.report
      .filter((item) => !billedItemCodes.has(item.codInterno))
      .map((item) => {
        const isDisregarded = disregardedCodes.has(item.codInterno);
        const isDisabled = disabledItemCodes.has(item.codInterno);
        const overDist = overriddenDistributors[item.codInterno];
        
        const baseItem = {
          ...item,
          distribuidora: overDist || item.distribuidora || "Não Encontrados",
          disabled: isDisabled
        };

        if (isDisregarded) {
          let resolvedDist = item.originalDist;
          let resolvedCodDist = item.originalCodDist;
          let resolvedEstoque = item.originalEstoque;
          let resolvedPreco = item.originalPrecoCotado !== undefined ? item.originalPrecoCotado : item.originalPreco;
          let resolvedCondicao = item.originalCondicao;
          let resolvedCodProdutoDist = item.originalCodProdutoDist;
          let resolvedPrazo = item.originalPrazo;
          let resolvedCodProduto = item.originalCodProduto;

          const origEanClean = cleanEan(item.originalEan);
          const origEstNum = item.originalEstoque !== undefined ? Number(item.originalEstoque) : 0;

          if (origEstNum <= 0 && item.alternatives && item.alternatives.length > 0) {
            const origAltsWithStock = item.alternatives.filter((alt: any) => {
              const altEanClean = cleanEan(alt.ean || alt.Ean || "");
              const altEstNum = alt.estoque !== undefined ? Number(alt.estoque) : 0;
              return altEanClean === origEanClean && altEstNum > 0;
            });

            if (origAltsWithStock.length > 0) {
              origAltsWithStock.sort((a: any, b: any) => {
                const priceA = a.preco !== undefined ? Number(a.preco) : 999999;
                const priceB = b.preco !== undefined ? Number(b.preco) : 999999;
                return priceA - priceB;
              });

              const bestAlt = origAltsWithStock[0];
              resolvedDist = bestAlt.distribuidora;
              resolvedCodDist = bestAlt.codDist;
              resolvedEstoque = bestAlt.estoque;
              resolvedPreco = bestAlt.preco;
              resolvedCondicao = bestAlt.condicao;
              resolvedCodProdutoDist = bestAlt.codProdutoDist;
              resolvedPrazo = bestAlt.prazo;
              resolvedCodProduto = bestAlt.codProduto;
            }
          }

          return {
            ...baseItem,
            novoEan: item.originalEan,
            novaDescricao: item.originalDescricao,
            novoLaboratorio: item.originalLaboratorio,
            novoPreco: resolvedPreco,
            economiaUnit: 0,
            economiaTotal: 0,
            distribuidora: overDist || resolvedDist || "Não Encontrados",
            codDist: resolvedCodDist !== undefined ? resolvedCodDist : baseItem.codDist,
            estoque: resolvedEstoque !== undefined ? resolvedEstoque : baseItem.estoque,
            condicao: resolvedCondicao !== undefined ? resolvedCondicao : baseItem.condicao,
            codProdutoDist: resolvedCodProdutoDist !== undefined ? resolvedCodProdutoDist : baseItem.codProdutoDist,
            prazo: resolvedPrazo !== undefined ? resolvedPrazo : baseItem.prazo,
            codProduto: resolvedCodProduto !== undefined ? resolvedCodProduto : baseItem.codProduto,
          };
        }
        return baseItem;
      });
  }, [result, disregardedCodes, disabledItemCodes, overriddenDistributors, billedItemCodes]);

  // Detect recent successful orders at Profarma (last 2 business days)
  const profarmaRecentOrdersEans = useMemo(() => {
    if (!dailyOrders || !Array.isArray(dailyOrders)) return new Set<string>();

    const eans = new Set<string>();
    
    const getRecentBusinessDays = (count: number) => {
      const dates = new Set<string>();
      const d = new Date();
      
      const formatDateStr = (date: Date) => {
        const dd = String(date.getDate()).padStart(2, '0');
        const mm = String(date.getMonth() + 1).padStart(2, '0');
        const yyyy = date.getFullYear();
        return `${dd}/${mm}/${yyyy}`;
      };

      dates.add(formatDateStr(d));

      let businessDaysFound = (d.getDay() === 0 || d.getDay() === 6) ? 0 : 1;
      const tempDate = new Date(d.getTime());
      
      for (let i = 1; i <= 10; i++) {
        tempDate.setDate(tempDate.getDate() - 1);
        const dayOfWeek = tempDate.getDay();
        const isWeekend = dayOfWeek === 0 || dayOfWeek === 6;
        dates.add(formatDateStr(tempDate));
        if (!isWeekend) {
          businessDaysFound++;
          if (businessDaysFound >= count) {
            break;
          }
        }
      }
      return dates;
    };

    const allowedDates = getRecentBusinessDays(2);

    dailyOrders.forEach(order => {
      const orderDate = String(order.dataPedido || order.DataPedido || "").trim();
      const isWithinAllowedDates = allowedDates.has(orderDate);

      if (isWithinAllowedDates && order.detalhes?.Itens) {
        order.detalhes.Itens.forEach((item: any) => {
          const codDist = item.CodDist !== undefined ? item.CodDist : (item.codDist !== undefined ? item.codDist : 0);
          const ean = String(item.Ean || item.ean || "").replace(/\D/g, "");
          if (ean && (codDist === 4 || String(item.NomeDist || "").toUpperCase().includes("PROFARMA"))) {
            eans.add(ean);
          }
        });
      }
    });

    return eans;
  }, [dailyOrders]);

  // Pending alert items for quantity/fracionado/Profarma interception
  const pendingAlertItems = useMemo(() => {
    if (!result || !result.report) return [];
    return activeReport.filter((item) => {
      if (item.disabled) return false;
      
      const isProfarmaAlert = (item.distribuidora && String(item.distribuidora).toUpperCase().includes("PROFARMA")) &&
        (profarmaRecentOrdersEans.has(String(item.novoEan || "").replace(/\D/g, "")) || profarmaRecentOrdersEans.has(String(item.originalEan || "").replace(/\D/g, "")));

      if (isProfarmaAlert && !item.isProfarmaAlertAck) {
        return true;
      }

      return item.alertaConfirmarQtd;
    }).map((item) => {
      const isProfarmaAlert = (item.distribuidora && String(item.distribuidora).toUpperCase().includes("PROFARMA")) &&
        (profarmaRecentOrdersEans.has(String(item.novoEan || "").replace(/\D/g, "")) || profarmaRecentOrdersEans.has(String(item.originalEan || "").replace(/\D/g, "")));

      if (isProfarmaAlert) {
        return {
          ...item,
          isProfarmaAlert: true,
          motivoAlertaProfarma: "⚠️ Alerta de Duplicidade Profarma: Este item foi enviado para a Profarma nas últimas 48h. Verifique a quantidade desejada ou digite 0 para remover do lote."
        };
      }
      return item;
    });
  }, [result, activeReport, profarmaRecentOrdersEans]);

  const handleConfirmQtyInInterception = (codInterno: string, newQty: number) => {
    if (newQty === 0) {
      setResult((prev: any) => {
        if (!prev) return null;
        return {
          ...prev,
          report: prev.report.filter((item: any) => item.codInterno !== codInterno)
        };
      });
    } else {
      setResult((prev: any) => {
        if (!prev) return null;
        return {
          ...prev,
          report: prev.report.map((item: any) => {
            if (item.codInterno === codInterno) {
              const qty = Math.max(1, newQty);
              return {
                ...item,
                qtd: qty,
                economiaTotal: (item.economiaUnit || 0) * qty,
                alertaConfirmarQtd: false,
                isProfarmaAlertAck: true
              };
            }
            return item;
          })
        };
      });
    }
  };

  // Derived active metrics summary
  const activeSummary = useMemo(() => {
    if (!result) return null;
    const activeItems = result.report.filter(item => !billedItemCodes.has(item.codInterno));
    const totalItems = activeItems.filter(item => !disabledItemCodes.has(item.codInterno)).length;
    const itemsTreated = activeItems.filter(item => !disabledItemCodes.has(item.codInterno)).length;
    const itemsSwapped = activeItems.filter(item => !disregardedCodes.has(item.codInterno) && item.originalEan !== item.novoEan && !disabledItemCodes.has(item.codInterno)).length;
    const totalSavings = activeItems
      .filter(item => !disregardedCodes.has(item.codInterno) && !disabledItemCodes.has(item.codInterno))
      .reduce((sum, item) => sum + item.economiaTotal, 0);

    return {
      totalItems,
      itemsTreated,
      itemsSwapped,
      totalSavings
    };
  }, [result, disregardedCodes, disabledItemCodes, billedItemCodes]);

  // Generate dynamic SICF content reflecting only currently active swaps
  const getOptimizedFileContent = () => {
    if (!result || !fileContent) return "";
    
    const lines = fileContent.replace(/\r\n/g, "\n").split("\n");
    const finalLines: string[] = [];
    
    const reportMap = new Map<string, SwapReportItem>(result.report.map(r => [r.codInterno, r]));
    const activeReportMap = new Map<string, SwapReportItem>(activeReport.map(r => [r.codInterno, r]));
    
    // Track codes present in original uploaded file
    const originalCodInternos = new Set<string>();
    for (const line of lines) {
      const parts = line.split(";");
      if (parts[0] === "2" && parts.length >= 4) {
        originalCodInternos.add(parts[3].trim());
      }
    }

    // Filter manual items to append
    const manualItemsToAppend = result.report.filter(r => !originalCodInternos.has(r.codInterno) && !disregardedCodes.has(r.codInterno) && !disabledItemCodes.has(r.codInterno));
    let manualItemsAppended = false;

    const appendManualLines = () => {
      if (manualItemsAppended) return;
      for (const item of manualItemsToAppend) {
        const newLine = [
          "2",
          item.novoEan,
          String(item.qtd),
          item.codInterno,
          item.novaDescricao,
          item.novoLaboratorio,
          item.novoPreco.toFixed(2)
        ].join(";");
        finalLines.push(newLine);
      }
      manualItemsAppended = true;
    };

    for (const line of lines) {
      const trimmed = line.trim();
      if (!trimmed) continue;
      
      const parts = trimmed.split(";");
      const tipo = parts[0];
      
      if (tipo === "2" && parts.length >= 7) {
        const codInterno = parts[3].trim();
        const reportItem = reportMap.get(codInterno);
        
        if (disabledItemCodes.has(codInterno)) {
          // If the item is completely disabled, skip writing it to the optimized file
          continue;
        }
        
        if (reportItem && !disregardedCodes.has(codInterno)) {
          // Swap is active, rewrite with optimized values
          const newLine = [
            "2",
            reportItem.novoEan,
            parts[2], // keep quantity string
            reportItem.codInterno,
            reportItem.novaDescricao,
            reportItem.novoLaboratorio,
            reportItem.novoPreco.toFixed(2)
          ].join(";");
          finalLines.push(newLine);
        } else {
          const activeItem = activeReportMap.get(codInterno);
          if (activeItem) {
            const newLine = [
              "2",
              activeItem.novoEan || parts[1],
              String(activeItem.qtd || parts[2]),
              activeItem.codInterno,
              activeItem.novaDescricao || parts[4],
              activeItem.novoLaboratorio || parts[5],
              (activeItem.novoPreco || Number(parts[6]) || 0).toFixed(2)
            ].join(";");
            finalLines.push(newLine);
          } else {
            finalLines.push(line);
          }
        }
      } else if (tipo === "9") {
        // Append manual items right before footer 9
        appendManualLines();
        finalLines.push(line);
      } else {
        // Keeps header (1) or other lines unchanged
        finalLines.push(line);
      }
    }
    
    // In case there is no line starting with 9, append manual items at the end
    appendManualLines();
    
    return finalLines.join("\r\n");
  };

  // File downloads
  const downloadSICF = () => {
    if (!result) return;
    const content = getOptimizedFileContent();
    const blob = new Blob([content], { type: "text/plain;charset=latin1;" });
    const url = URL.createObjectURL(blob);
    const link = document.createElement("a");
    const baseName = fileName.replace(/\.[^/.]+$/, "");
    link.setAttribute("href", url);
    link.setAttribute("download", `${baseName}_otimizado.txt`);
    document.body.appendChild(link);
    link.click();
    document.body.removeChild(link);
  };

  const downloadCSV = () => {
    if (!result) return;
    const headers = [
      "CodInterno",
      "EanOriginal",
      "DescricaoOriginal",
      "LaboratorioOriginal",
      "PrecoOriginal",
      "EanNovo",
      "DescricaoNova",
      "LaboratorioNovo",
      "PrecoNovo",
      "Qtd",
      "EconomiaUnit",
      "EconomiaTotal",
      "Distribuidora",
      "Estoque",
      "Status"
    ];

    const rows = result.report.map((item) => {
      const isDisregarded = disregardedCodes.has(item.codInterno);
      return [
        item.codInterno,
        item.originalEan,
        item.originalDescricao,
        item.originalLaboratorio,
        item.originalPreco.toFixed(2).replace(".", ","),
        isDisregarded ? item.originalEan : item.novoEan,
        isDisregarded ? item.originalDescricao : item.novaDescricao,
        isDisregarded ? item.originalLaboratorio : item.novoLaboratorio,
        isDisregarded ? item.originalPreco.toFixed(2).replace(".", ",") : item.novoPreco.toFixed(2).replace(".", ","),
        item.qtd,
        isDisregarded ? "0,00" : item.economiaUnit.toFixed(2).replace(".", ","),
        isDisregarded ? "0,00" : item.economiaTotal.toFixed(2).replace(".", ","),
        isDisregarded ? (item.originalDist !== undefined ? item.originalDist : item.distribuidora) : item.distribuidora,
        isDisregarded ? (item.originalEstoque !== undefined ? item.originalEstoque : item.estoque) : item.estoque,
        isDisregarded ? "Desconsiderado" : "Otimizado"
      ];
    });

    const csvContent = [headers.join(";"), ...rows.map((r) => r.join(";"))].join("\r\n");
    const blob = new Blob([csvContent], { type: "text/csv;charset=utf-8;" });
    const url = URL.createObjectURL(blob);
    const link = document.createElement("a");
    const baseName = fileName.replace(/\.[^/.]+$/, "");
    link.setAttribute("href", url);
    link.setAttribute("download", `${baseName}_relatorio.csv`);
    document.body.appendChild(link);
    link.click();
    document.body.removeChild(link);
  };

  // Enviar faturamento para SmartPed (geral ou por distribuidora!)
  const handleSendBilling = async (specificDistributorNameInput?: any, bypassSuspectCheck = false, bypassConfirm = false, forceDownloadJson = false) => {
    if (!result) return;
    
    const specificDistributorName = typeof specificDistributorNameInput === "string" ? specificDistributorNameInput : undefined;
    let activeItems = activeReport.filter(item => !disabledItemCodes.has(item.codInterno));
    let baseDistName = specificDistributorName ? specificDistributorName.split(" [")[0] : "Todas as Distribuidoras";
    
    let relatedGroups: string[] = [];
    
    const allDistGroups = new Set<string>();
    activeItems.forEach(item => {
        const dist = item.distribuidora || "Não Encontrados";
        if (!specificDistributorName || dist === baseDistName) {
            const isVirtual = dist === "Não Encontrados" || dist === "Sem Estoque";
            const groupKey = isVirtual 
              ? dist 
              : `${dist} [${item.condicao || "FIXA"} | ${item.prazo !== undefined ? item.prazo : 0}d]`;
            allDistGroups.add(groupKey);
        }
    });
    
    relatedGroups = Array.from(allDistGroups);

    if (specificDistributorName) {
      // Now filter activeItems so we send ALL items for this baseDistName
      activeItems = activeItems.filter(item => {
        const dist = item.distribuidora || "Não Encontrados";
        return dist === baseDistName;
      });
    }

    if (forceDownloadJson) {
      // Gerar JSON para análise sem checar nada ou enviar
      const payloadItems = activeItems.map(item => {
        const baseItem = item;
        const codProdDist = String(baseItem.codProdutoDist || "").trim();
        const codProdRaw = String(baseItem.codProduto || "").trim();
        const finalCodProduto = (codProdRaw === "" || codProdRaw === "0") ? codProdDist : codProdRaw;

        return {
          ...baseItem,
          codProduto: finalCodProduto
        };
      });

      const payload = {
        items: payloadItems,
        token: config.token,
        cnpj: config.cnpj,
        useTestUrl: config.useTestUrl,
        simulationMode: config.simulationMode,
        tipos: config.tipos,
        margemMinima: config.margemMinima,
        permitirSemEstoque: config.permitirSemEstoque
      };

      const jsonStr = JSON.stringify(payload, null, 2);
      const blob = new Blob([jsonStr], { type: "application/json;charset=utf-8;" });
      const url = URL.createObjectURL(blob);
      const link = document.createElement("a");
      const sanitizedDistName = baseDistName.replace(/\s+/g, "_");
      link.setAttribute("href", url);
      link.setAttribute("download", `faturamento_payload_${sanitizedDistName}.json`);
      document.body.appendChild(link);
      link.click();
      document.body.removeChild(link);
      return;
    }

    // Verificar se o item suspeito "7896004706559" está entre os itens ativos a serem faturados
    if (!bypassSuspectCheck) {
      const suspectItem = activeItems.find(item => 
        String(item.originalEan).trim() === "7896004706559" || 
        String(item.novoEan).trim() === "7896004706559"
      );
      if (suspectItem) {
        setSuspectItemAlert({
          item: suspectItem,
          specificDistributorName
        });
        return; // Interrompe o faturamento temporariamente para mostrar o modal de alerta
      }
    }

    if (activeItems.length === 0) {
      alert("Nenhum item ativo para faturar. Certifique-se de que há itens habilitados.");
      return;
    }

    if (!bypassConfirm) {
      setBillingChoice({
        specificDistributorName,
        baseDistName,
        activeItems
      });
      return;
    }
      
    setBilledGroups(prev => {
        const next = { ...prev };
        relatedGroups.forEach(g => {
            next[g] = { status: "faturando", faltas: [], logs: ["Iniciando faturamento..."] };
        });
        return next;
    });

    setIsBillingLoading(true);
    setError(null);
    setBillingResult(null);
    setIsBillingModalOpen(true);
    setReturnCheckLogs([]);
    setLogs(["[SISTEMA] Iniciando comunicação com API SmartPed...", `[SISTEMA] Preparando ${activeItems.length} itens para envio.`]);

    try {
      const response = await fetch("/api/faturar", {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
        },
        body: JSON.stringify({
          items: activeItems.map(item => {
            const baseItem = item;
            const codProdDist = String(baseItem.codProdutoDist || "").trim();
            const codProdRaw = String(baseItem.codProduto || "").trim();
            const finalCodProduto = (codProdRaw === "" || codProdRaw === "0") ? codProdDist : codProdRaw;

            return {
              ...baseItem,
              codProduto: finalCodProduto
            };
          }),
          token: config.token,
          cnpj: config.cnpj,
          useTestUrl: config.useTestUrl,
          simulationMode: config.simulationMode,
          tipos: config.tipos,
          margemMinima: config.margemMinima,
          permitirSemEstoque: config.permitirSemEstoque
        }),
      });

      const data = await response.json();
      if (!response.ok) {
        throw new Error(data.error || "Erro ao enviar faturamento.");
      }

      // Hide billed items from the UI instantly
      setBilledItemCodes(prev => {
         const next = new Set(prev);
         activeItems.forEach(i => next.add(i.codInterno));
         return next;
      });

      // Salvar itens manuais enviados no faturamento para posterior verificação de faltas
      try {
        const manualItems = activeItems.filter(i => i.codInterno.startsWith("MANUAL-"));
        if (manualItems.length > 0) {
          const stored = localStorage.getItem("itens_manuais_enviados");
          const list = stored ? JSON.parse(stored) : [];
          const numPedido = data.numPedido || "LOTE";
          
          manualItems.forEach(item => {
            list.push({
              ean: cleanEan(item.novoEan || item.originalEan),
              descricao: item.novaDescricao || item.originalDescricao,
              laboratorio: item.novoLaboratorio || item.originalLaboratorio || "",
              distribuidora: item.distribuidora,
              codDist: item.codDist,
              quantSolicitada: item.qtd,
              precoLiquido: item.novoPreco || item.originalPreco,
              numPedido: String(numPedido),
              dataEnvio: new Date().toISOString()
            });
          });
          localStorage.setItem("itens_manuais_enviados", JSON.stringify(list));
        }
      } catch (e) {
        console.error("Erro ao salvar itens manuais enviados no localStorage:", e);
      }

      setBillingResult(data);
      if (data.logs) {
        setLogs(prev => [...prev, ...data.logs]);
      }

      // Start polling for the order automatically
      if (data.numPedido) {
        setAutoPollReturn(true);
        setBillingContext({ relatedGroups, baseDistName, numPedido: data.numPedido, itemsFaturados: data.itemsFaturados });
      }
    } catch (err: any) {
      console.error(err);
      setIsBillingModalOpen(false);
      alert(err.message || "Erro inesperado ao processar faturamento.");
      setBilledGroups(prev => {
        const next = { ...prev };
        relatedGroups.forEach(g => {
          delete next[g];
        });
        return next;
      });
    } finally {
      setIsBillingLoading(false);
    }
  };

  const handleCloseAndConsolidateBilling = () => {
    if (billingResult && result) {
      const distsInReturn = orderReturn?.Retorno?.Dists || orderReturn?.Retorno?.dists || [];
      const hasFinalizedReturn = distsInReturn.some((d: any) => d.Status === 3);
      
      if (orderReturn && orderReturn.Retorno && orderReturn.Retorno.Itens && hasFinalizedReturn) {
        handleReRouteShortages();
        return;
      } else {
        const baseDistName = billingContext?.baseDistName || "Todas as Distribuidoras";
        
        const sentItems = result.report.filter(item => {
          const dist = item.distribuidora || "Não Encontrados";
          const isThisDist = baseDistName === "Todas as Distribuidoras" || dist === baseDistName;
          return isThisDist && !disabledItemCodes.has(item.codInterno) && !billedItemCodes.has(item.codInterno);
        });

        const newFaturadosGlobais = [...faturadosGlobais];
        const itemsToKeep = [];
        const numPedido = billingContext?.numPedido || "LOTE";
        
        for (const reportItem of result.report) {
          const dist = reportItem.distribuidora || "Não Encontrados";
          const isThisDist = baseDistName === "Todas as Distribuidoras" || dist === baseDistName;
          const wasSentNow = isThisDist && !disabledItemCodes.has(reportItem.codInterno) && !billedItemCodes.has(reportItem.codInterno);
          const wasAlreadyBilled = billedItemCodes.has(reportItem.codInterno);
          
          if (wasSentNow || wasAlreadyBilled) {
            const currentEan = cleanEan(reportItem.novoEan || reportItem.originalEan);
            if (!newFaturadosGlobais.some(existing => existing.ean === currentEan && existing.notaCupom === `SMARTPED-${numPedido}`)) {
              newFaturadosGlobais.push({
                fornecedor: reportItem.distribuidora,
                ean: currentEan,
                descricao: reportItem.novaDescricao || reportItem.originalDescricao,
                laboratorio: reportItem.novoLaboratorio || reportItem.originalLaboratorio || "",
                valor: reportItem.novoPreco || reportItem.originalPreco,
                quantidade: reportItem.qtd,
                notaCupom: `SMARTPED-${numPedido}`
              });
            }
          } else {
            itemsToKeep.push(reportItem);
          }
        }
        
        setFaturadosGlobais(newFaturadosGlobais);
        setResult(prev => {
          if (!prev) return null;
          const activeSwaps = itemsToKeep.filter((it) => !disregardedCodes.has(it.codInterno));
          const newTotalSavings = activeSwaps.reduce((sum, it) => sum + (it.economiaTotal || 0), 0);
          return {
            ...prev,
            summary: {
              ...prev.summary,
              totalItems: itemsToKeep.length,
              totalSavings: newTotalSavings
            },
            report: itemsToKeep
          };
        });
        
        setBilledItemCodes(prev => {
          const next = new Set(prev);
          sentItems.forEach(si => next.delete(si.codInterno));
          return next;
        });
        
        setBilledGroups(prev => {
          const next = { ...prev };
          if (billingContext && billingContext.relatedGroups) {
            billingContext.relatedGroups.forEach(g => {
              delete next[g];
            });
          }
          return next;
        });
      }
    }
    
    setIsBillingModalOpen(false);
    setBillingResult(null);
    setOrderReturn(null);
    setAutoPollReturn(false);
  };

  const pollOrderReturn = async (numPedido: number, itemsFaturados: any[], relatedGroups: string[], baseDistName: string) => {
    const checkReturn = async () => {
      try {
        const response = await fetch("/api/pedido-retorno", {
          method: "POST",
          headers: {
            "Content-Type": "application/json",
          },
          body: JSON.stringify({
            numPedido,
            token: config.token,
            cnpj: config.cnpj,
            useTestUrl: config.useTestUrl,
            itemsFaturados,
            simulationMode: config.simulationMode
          })
        });

        const data = await response.json();
        
        // Update logs even if not finished
        if (response.ok && data.logs && data.logs.length > 0) {
           setBilledGroups(prev => {
              const next = { ...prev };
              relatedGroups.forEach(g => {
                 const currentLogs = prev[g]?.logs || [];
                 // Avoid adding duplicate logs
                 const newLogs = [...currentLogs];
                 data.logs.forEach((l: string) => {
                    if (!newLogs.includes(l)) newLogs.push(l);
                 });
                 next[g] = { ...prev[g], logs: newLogs };
              });
              return next;
           });
        }

        if (response.ok && data.apiResponse && (data.apiResponse.dists || data.apiResponse.Dists || data.apiResponse.Retorno?.dists || data.apiResponse.Retorno?.Dists)) {
          const rawRetorno = data.apiResponse?.Retorno || data.apiResponse?.retorno || data.apiResponse;
          const dists = rawRetorno?.dists || rawRetorno?.Dists || [];
          const itens = rawRetorno?.Itens || rawRetorno?.itens || [];

          // Extraímos os códigos das distribuidoras envolvidas no lote enviado
          const codDistsNoLote = Array.from(new Set((itemsFaturados || []).map((it: any) => String(it.codDist || it.CodDist || "").trim())));
          
          let isAllFinalized = false;
          if (dists && dists.length > 0) {
            if (codDistsNoLote.length > 0) {
              const distsDoLote = dists.filter((d: any) => codDistsNoLote.includes(String(d.CodDist || d.codDist || "").trim()));
              if (distsDoLote.length > 0) {
                isAllFinalized = distsDoLote.every((d: any) => d.Status === 3);
              } else {
                isAllFinalized = dists.every((d: any) => d.Status === 3);
              }
            } else {
              isAllFinalized = dists.every((d: any) => d.Status === 3);
            }
          }

          if (isAllFinalized) { // Finalizado
            // Extract faltas
            const faltas = itens.filter((it: any) => parseFloat(it.QuantFaturada || it.quantFaturada || "0") === 0);
            const succeededEans = itens.filter((it: any) => parseFloat(it.QuantFaturada || it.quantFaturada || "0") > 0).map((it: any) => String(it.Ean || it.ean).trim());
            
            // Update billedGroups state
            setBilledGroups(prev => {
              const next = { ...prev };
              relatedGroups.forEach(g => {
                 const currentLogs = prev[g]?.logs || [];
                 // Ensure "Pedido retornado" is added
                 if (!currentLogs.includes("Pedido retornado do distribuidor.")) {
                    currentLogs.push("Pedido retornado do distribuidor.");
                 }
                 next[g] = { status: "retornado", faltas, logs: currentLogs };
              });
              return next;
            });
            
            // Extract the faturados from the current result before updating it
            setResult(prev => {
              if (!prev) return prev;
              
              const newFaturadosGlobais: any[] = [];
              const newReport = prev.report.filter(item => {
                const dist = item.distribuidora || "Não Encontrados";
                const currentEan = String(item.novoEan || item.originalEan).trim();
                const itemDistCod = String(item.codDist).trim();

                // Identifica se o item de report pertence a este lote faturado
                const isThisDist = baseDistName === "Todas as Distribuidoras"
                  ? itemsFaturados.some((it: any) => String(it.ean || it.Ean).trim() === currentEan && String(it.codDist || it.CodDist).trim() === itemDistCod)
                  : dist === baseDistName;
                
                if (isThisDist && succeededEans.includes(currentEan)) {
                  const apiReturnItem = itens.find((it: any) => String(it.Ean || it.ean).trim() === currentEan && String(it.CodDist || it.codDist).trim() === itemDistCod);
                  const itemFornecedor = item.distribuidora || apiReturnItem?.NomeDist || apiReturnItem?.nomeDist || baseDistName;
                  newFaturadosGlobais.push({
                      ean: currentEan,
                      descricao: item.novaDescricao || item.originalDescricao,
                      laboratorio: item.novoLaboratorio || item.originalLaboratorio || "",
                      fornecedor: itemFornecedor,
                      quantidade: parseFloat(apiReturnItem?.QuantFaturada || apiReturnItem?.quantFaturada || String(item.qtd)),
                      valor: item.novoPreco || item.originalPreco,
                      notaCupom: `SMARTPED-${numPedido}`
                  });
                  return false; // Remove successfully billed item
                }
                
                // If it's a falta, keep it and update observation
                if (isThisDist) {
                  const faltaMatch = itens.find((f: any) => String(f.Ean || f.ean).trim() === currentEan && String(f.CodDist || f.codDist).trim() === itemDistCod);
                  if (faltaMatch) {
                    item.observacao = faltaMatch.Motivo || faltaMatch.motivo || "Falta de estoque";
                  }
                }

                return true;
              });
              
              if (newFaturadosGlobais.length > 0) {
                 setFaturadosGlobais(curr => {
                    const next = [...curr];
                    for (const fItem of newFaturadosGlobais) {
                       if (!next.some(existing => existing.ean === fItem.ean && existing.notaCupom === fItem.notaCupom)) {
                          next.push(fItem);
                       }
                    }
                    if (next.length > curr.length) {
                        setTimeout(() => setIsFaturadosOpen(true), 0);
                    }
                    return next;
                 });
              }
              
              return { ...prev, report: newReport };
            });

            return true; // Stop polling
          }
        }
        return false; // Continue polling
      } catch (e) {
        console.error(e);
        return false;
      }
    };

    const interval = setInterval(async () => {
      const isDone = await checkReturn();
      if (isDone) {
        clearInterval(interval);
      }
    }, 2000); // 2 seconds
  };

  // Consultar status de retorno do pedido faturado
  const handleCheckOrderReturn = async () => {
    if (!billingContext) return;
    const { numPedido, itemsFaturados, relatedGroups, baseDistName } = billingContext;
    
    setIsCheckingReturn(true);
    try {
      const response = await fetch("/api/pedido-retorno", {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
        },
        body: JSON.stringify({
          numPedido,
          token: config.token,
          cnpj: config.cnpj,
          useTestUrl: config.useTestUrl,
          itemsFaturados,
          simulationMode: config.simulationMode
        })
      });

      const data = await response.json();
      if (!response.ok) {
        throw new Error(data.error || "Erro ao consultar retorno.");
      }

      setOrderReturn(data.apiResponse);
      if (data.logs) {
        setReturnCheckLogs(data.logs);
      }
      
      // Update billedGroups
      if (data.logs && data.logs.length > 0) {
           setBilledGroups(prev => {
              const next = { ...prev };
              relatedGroups.forEach(g => {
                 const currentLogs = prev[g]?.logs || [];
                 // Avoid adding duplicate logs
                 const newLogs = [...currentLogs];
                 data.logs.forEach((l: string) => {
                    if (!newLogs.includes(l)) newLogs.push(l);
                 });
                 next[g] = { ...prev[g], logs: newLogs };
              });
              return next;
           });
        }
        
        const rawRetorno = data.apiResponse?.Retorno || data.apiResponse?.retorno || data.apiResponse;
        const dists = rawRetorno?.dists || rawRetorno?.Dists || [];
        const itens = rawRetorno?.Itens || rawRetorno?.itens || [];
        
        if (dists && dists.length > 0) {
          // Extraímos os códigos das distribuidoras envolvidas no lote enviado
          const codDistsNoLote = Array.from(new Set((itemsFaturados || []).map((it: any) => String(it.codDist || it.CodDist || "").trim())));
          
          let isAllFinalized = false;
          if (codDistsNoLote.length > 0) {
            const distsDoLote = dists.filter((d: any) => codDistsNoLote.includes(String(d.CodDist || d.codDist || "").trim()));
            if (distsDoLote.length > 0) {
              isAllFinalized = distsDoLote.every((d: any) => d.Status === 3);
            } else {
              isAllFinalized = dists.every((d: any) => d.Status === 3);
            }
          } else {
            isAllFinalized = dists.every((d: any) => d.Status === 3);
          }
          
          if (isAllFinalized) { // Finalizado
            // Extract faltas
            const faltas = itens.filter((it: any) => parseFloat(it.QuantFaturada || it.quantFaturada || "0") === 0);
            
            // Update billedGroups state
            setBilledGroups(prev => {
              const next = { ...prev };
              relatedGroups.forEach(g => {
                 const currentLogs = prev[g]?.logs || [];
                 // Ensure "Pedido retornado" is added
                 if (!currentLogs.includes("Pedido retornado do distribuidor.")) {
                    currentLogs.push("Pedido retornado do distribuidor.");
                 }
                 next[g] = { status: "retornado", faltas, logs: currentLogs };
              });
              return next;
            });
            setAutoPollReturn(false); // Stop polling
          }
        }
    } catch (err: any) {
      console.error(err);
      alert(err.message || "Erro ao consultar retorno.");
    } finally {
      setIsCheckingReturn(false);
    }
  };

  // Efeito para polling automático de status se ativado
  useEffect(() => {
    let interval: any;
    if (autoPollReturn && isBillingModalOpen && billingContext && billingContext.numPedido) {
      handleCheckOrderReturn();
      interval = setInterval(() => {
        handleCheckOrderReturn();
      }, 2000);
    }
    return () => clearInterval(interval);
  }, [autoPollReturn, isBillingModalOpen, billingContext?.numPedido]);

  // Consultar status de retorno do pedido diretamente pelo painel de retornos
  const handleCheckDirectOrderReturn = async () => {
    if (!directNumPedido.trim()) {
      alert("Por favor, informe o número do pedido.");
      return;
    }
    setIsCheckingDirectReturn(true);
    setDirectReturnCheckLogs([`[SISTEMA] Iniciando consulta em tempo real para o pedido #${directNumPedido.trim()}...`]);
    try {
      const response = await fetch("/api/pedido-retorno", {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
        },
        body: JSON.stringify({
          numPedido: directNumPedido.trim(),
          token: config.token,
          cnpj: config.cnpj,
          useTestUrl: config.useTestUrl,
          itemsFaturados: [], // Vazio para o backend mockar itens realísticos em simulação
          simulationMode: config.simulationMode
        })
      });

      const data = await response.json();
      if (!response.ok) {
        throw new Error(data.error || "Erro ao consultar retorno do pedido.");
      }

      setDirectOrderReturn(data.apiResponse);
      if (data.apiResponse) {
        setSelectedDailyOrder({
          numPedido: directNumPedido.trim(),
          dataPedido: new Date().toLocaleDateString("pt-BR"),
          detalhes: data.apiResponse
        });
      }
      if (data.logs) {
        setDirectReturnCheckLogs(data.logs);
      }
    } catch (err: any) {
      console.error(err);
      alert(err.message || "Erro ao consultar retorno.");
    } finally {
      setIsCheckingDirectReturn(false);
    }
  };

  const handleCheckDailyOrders = async (customToken?: string, customCnpj?: string) => {
    setIsCheckingDaily(true);
    const activeToken = customToken || config.token;
    const activeCnpj = customCnpj || config.cnpj;
    setDailyOrderLogs([`[SISTEMA] Iniciando busca de pedidos dos últimos dias úteis...`]);
    try {
      const response = await fetch("/api/pedidos-do-dia", {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
        },
        body: JSON.stringify({
          token: activeToken,
          cnpj: activeCnpj,
          useTestUrl: config.useTestUrl,
          simulationMode: config.simulationMode
        })
      });
      const data = await response.json();
      if (data.logs) setDailyOrderLogs((prev) => [...prev, ...data.logs]);
      if (!response.ok) throw new Error(data.error || "Erro ao consultar pedidos do dia.");
      const rawOrders = data.pedidos || [];
      const seen = new Set<string>();
      const uniqueOrders: any[] = [];
      for (const order of rawOrders) {
        const num = String(order.numPedido || "").trim();
        if (num && !seen.has(num)) {
          seen.add(num);
          uniqueOrders.push(order);
        }
      }
      uniqueOrders.sort((a, b) => {
        const numA = Number(a.numPedido || 0);
        const numB = Number(b.numPedido || 0);
        return numB - numA;
      });
      setDailyOrders(uniqueOrders);
      // Calcular e persistir mapa de cortes recentes nos últimos dois dias úteis
      try {
        const cutsMap = getRecentCutsMap(uniqueOrders);
        localStorage.setItem("cortes_recentes", JSON.stringify(cutsMap));
        const numCortes = Object.values(cutsMap).reduce((acc, curr) => acc + curr.length, 0);
        setDailyOrderLogs((prev) => [...prev, `[SISTEMA] Identificados ${numCortes} registros de cortes recentes nas distribuidoras para proteção contra furos.`]);
      } catch (e: any) {
        console.error("Erro ao computar cortes de estoque recentes:", e);
      }
    } catch (err: any) {
      setDailyOrderLogs((prev) => [...prev, `[ERRO] ${err.message}`]);
    } finally {
      setIsCheckingDaily(false);
    }
  };

  // Efeito para buscar pedidos do dia automaticamente ao entrar na aba de retornos
  useEffect(() => {
    if (mainView === "returns" && dailyOrders.length === 0 && !isCheckingDaily) {
      handleCheckDailyOrders();
    }
  }, [mainView, dailyOrders.length]);

  // Efeito para polling automático de status no painel direto
  useEffect(() => {
    let interval: any;
    if (directAutoPollReturn && mainView === "returns" && directNumPedido.trim()) {
      handleCheckDirectOrderReturn();
      interval = setInterval(() => {
        handleCheckDirectOrderReturn();
      }, 10000);
    }
    return () => clearInterval(interval);
  }, [directAutoPollReturn, mainView, directNumPedido]);

    // Pesquisar produtos comercializados para adição manual
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
        
        // Tentativa 1: Endpoint de busca de substitutos SmartPed
        const response = await fetch("/api/smartped-find-substitutes", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({
            ean: isNumeric ? manualQuery.trim() : "",
            descricao: isNumeric ? "" : manualQuery.trim(),
            token: config.token,
            cnpj: config.cnpj,
            useTestUrl: config.useTestUrl,
            cortesRecentes
          })
        });

        const data = await response.json();
        
        let allAlts: any[] = [];
        let alts: any[] = [];
        let minimos: any[] = [];
        let dcb: string | null = null;
        let logs: string[] = [];

        if (response.ok && (data.alternatives?.length > 0 || data.allAlternatives?.length > 0)) {
          allAlts = data.allAlternatives || data.alternatives || [];
          alts = data.alternatives || [];
          minimos = data.minimos || [];
          dcb = data.dcbDescoberto || null;
          logs = data.logs || [];
        } else {
          // Fallback: tentar endpoint geral /api/search-products
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

          const fallbackResp = await fetch("/api/search-products", {
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
              onlyExactEan: false
            })
          });
          const fallbackData = await fallbackResp.json();
          if (fallbackResp.ok && fallbackData.items) {
            allAlts = fallbackData.items;
            alts = fallbackData.items;
            logs = fallbackData.logs || [];
          }
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

    // Obter valor mínimo do pedido da distribuidora
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

    // Processamento e Deduplicação Inteligente das ofertas manuais
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

          // Se tiver estoque ativo OU se for uma promoção válida com compra mínima exigida (QtdMin > 1), exibe em tela!
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

      // Agrupamento por EAN + CodDist
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
          _calcPrazo: prazoNum
        };

        if (!groupMap.has(groupKey)) {
          groupMap.set(groupKey, normalizedOffer);
        } else {
          const existing = groupMap.get(groupKey);
          const existingPLiquido = existing._calcPLiquido;
          const existingPrazo = existing._calcPrazo;

          // Critério 1: Menor Preço Líquido
          if (pLiquido < existingPLiquido - 0.0001) {
            groupMap.set(groupKey, normalizedOffer);
          } else if (Math.abs(pLiquido - existingPLiquido) <= 0.0001) {
            // Desempate: Maior Prazo
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

    // Adicionar o produto pesquisado ao lote otimizado
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
      const offerCodProd = offer.codProduto || offer.CodProduto || "";
      const offerPedMin = getManualDistMinimo(offerCodDist, offerCondicao, offerPrazo, offerDist);

      const randomCod = "MANUAL-" + Date.now() + "-" + Math.floor(1000 + Math.random() * 9000);
      const economiaUnit = Math.max(0, offerPrecoFab - offerPrecoLiq);
      const economiaTotal = economiaUnit * qtyToAdd;

      const calcOriginalPmc = offer.pmc !== undefined && offer.pmc > 0 ? offer.pmc : (offerPrecoFab > 0 ? Number((offerPrecoFab * 1.4).toFixed(2)) : 0);
      const calcNovoPmc = offer.pmc !== undefined && offer.pmc > 0 ? offer.pmc : (offerPrecoLiq > 0 ? Number((offerPrecoLiq * 1.4).toFixed(2)) : 0);

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
        pedidoMinimo: offerPedMin
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

      setManualActionSuccessKey(itemKey);
      setTimeout(() => {
        setManualActionSuccessKey(null);
      }, 2500);
    };

    // Group items by distributor to track faturamento mínimo and manage splitting
  const [distributorOrder, setDistributorOrder] = useState<string[]>([]);
  const [expandedGroups, setExpandedGroups] = useState<Record<string, boolean>>({});

  const toggleGroup = (groupName: string) => {
    setExpandedGroups(prev => ({
      ...prev,
      [groupName]: !prev[groupName]
    }));
  };

  // Update distributor order when result changes using compound keys (distribuidora + condicao + prazo)
  useEffect(() => {
    if (result && result.report) {
      const currentSuppliers = new Set(result.report.map(item => {
        const dist = item.distribuidora || "Não Encontrados";
        const isVirtual = dist === "Não Encontrados" || dist === "Sem Estoque";
        return isVirtual 
          ? dist 
          : `${dist} [${item.condicao || "FIXA"} | ${item.prazo !== undefined ? item.prazo : 0}d]`;
      }));
      
      setDistributorOrder(prevOrder => {
        // If this is the first time we're setting the order, prioritize non-met groups
        if (prevOrder.length === 0) {
          const supplierList = Array.from(currentSuppliers);
          
          // Helper to calculate total for a compound key from original report
          const getSupplierTotal = (key: string) => {
            return result.report
              .filter(item => {
                const dist = item.distribuidora || "Não Encontrados";
                const isVirtual = dist === "Não Encontrados" || dist === "Sem Estoque";
                const itemKey = isVirtual 
                  ? dist 
                  : `${dist} [${item.condicao || "FIXA"} | ${item.prazo !== undefined ? item.prazo : 0}d]`;
                return itemKey === key;
              })
              .reduce((acc, item) => acc + (item.novoPreco * item.qtd), 0);
          };

          return (supplierList as string[]).sort((a: string, b: string) => {
            const minA = getGroupMinVal(a);
            const minB = getGroupMinVal(b);
            const totalA = getSupplierTotal(a);
            const totalB = getSupplierTotal(b);
            const metA = totalA >= minA;
            const metB = totalB >= minB;

            if (metA !== metB) return metA ? 1 : -1;
            return a.localeCompare(b);
          });
        }

        // Subsequent updates: Keep existing order but sync with current suppliers
        const newOrder = [...prevOrder];
        
        // Add new suppliers that aren't in the order yet
        currentSuppliers.forEach(dist => {
          if (!newOrder.includes(dist)) {
            newOrder.push(dist);
          }
        });

        // Filter out suppliers that no longer exist in the report
        return newOrder.filter(dist => currentSuppliers.has(dist));
      });
    }
  }, [result, distributorMinimums]);

  const distributorGroupings = useMemo(() => {
    if (!result || !activeReport) return [];
    const groups: Record<string, { name: string; itemsCount: number; totalValue: number; items: SwapReportItem[] }> = {};
    
    for (const item of activeReport) {
      const dist = item.distribuidora || "Não Encontrados";
      const isVirtual = dist === "Não Encontrados" || dist === "Sem Estoque";
      const groupKey = isVirtual 
        ? dist 
        : `${dist} [${item.condicao || "FIXA"} | ${item.prazo !== undefined ? item.prazo : 0}d]`;
      
      const isDisabled = disabledItemCodes.has(item.codInterno);
      
      if (!groups[groupKey]) {
        groups[groupKey] = { name: groupKey, itemsCount: 0, totalValue: 0, items: [] };
      }
      
      if (!isDisabled) {
        groups[groupKey].itemsCount++;
        groups[groupKey].totalValue += item.novoPreco * item.qtd;
        groups[groupKey].items.push({
          ...item,
          disabled: isDisabled
        } as any);
      }
    }
    
    // Sort based on the stable distributorOrder state
    return distributorOrder
      .map(name => groups[name] || { name, itemsCount: 0, totalValue: 0, items: [] });
  }, [result, activeReport, disabledItemCodes, distributorMinimums, distributorOrder]);

  // Dispersar todos os itens de uma distribuidora que não atingiu o mínimo para outras distribuidoras ativas
  const handleApplyCompletingTransfers = (selectedCodes: string[]) => {
    if (!result) return;
    
    const updatedReport = [...result.report];
    const selectedSet = new Set(selectedCodes);
    let transferredCount = 0;
    const logMessages: string[] = [];

    completingEligibleItems.forEach((eleg) => {
      if (selectedSet.has(eleg.item.codInterno)) {
        const idx = updatedReport.findIndex(r => r.codInterno === eleg.item.codInterno);
        if (idx !== -1) {
          const off = eleg.offer;
          updatedReport[idx] = {
            ...updatedReport[idx],
            novoEan: off.ean || updatedReport[idx].novoEan || updatedReport[idx].originalEan,
            novaDescricao: off.descricao || updatedReport[idx].novaDescricao || updatedReport[idx].originalDescricao,
            novoLaboratorio: off.laboratorio || updatedReport[idx].novoLaboratorio || updatedReport[idx].originalLaboratorio || "GENÉRICO",
            novoPreco: off.precoLiquido,
            distribuidora: off.distribuidora,
            estoque: off.estoque,
            codDist: off.codDist,
            condicao: off.condicao,
            codProdutoDist: off.codProdutoDist,
            codProduto: off.codProduto,
            prazo: off.prazo,
            motivoAcao: `Puxado p/ ${off.distribuidora}`,
            economiaUnit: Math.max(0, updatedReport[idx].originalPreco - off.precoLiquido),
            economiaTotal: Math.max(0, updatedReport[idx].originalPreco - off.precoLiquido) * updatedReport[idx].qtd,
            isShortage: false
          };
          transferredCount++;
          logMessages.push(`[SUCESSO] Item "${eleg.item.novaDescricao}" puxado para ${off.distribuidora}`);
        }
      }
    });
    
    if (transferredCount > 0) {
      setResult((prev: any) => {
        if (!prev) return null;
        const activeSwaps = updatedReport.filter((it: any) => !disregardedCodes.has(it.codInterno));
        const newTotalSavings = activeSwaps.reduce((sum, it) => sum + (it.economiaTotal || 0), 0);
        return {
          ...prev,
          summary: {
            ...prev.summary,
            totalSavings: newTotalSavings
          },
          report: updatedReport 
        };
      });
      setLogs(prev => [...prev, ...logMessages]);
    }
    setCompletingTargetDist(null);
  };

  const handleStartDispersingWizard = async (fromDist: string) => {
    setDispersingEligibleItems([]);
    setDispersingSelectedCodes(new Set());
    const grouping = distributorGroupings.find(g => g.name === fromDist);
    if (!grouping || grouping.items.length === 0) return;
    setIsSearchingDispersing(true);
    setDispersingFromDist(fromDist);
    const fromDistNormalized = normalizeDistName(fromDist);
    const targetDistsUpper = distributorGroupings
      .filter(g => normalizeDistName(g.name) !== fromDistNormalized && g.name !== "Não Encontrados" && g.name !== "Sem Estoque" && g.itemsCount > 0)
      .map(g => normalizeDistName(g.name));

    console.log("\n[DISPERSAR PEDIDO] Iniciando assistente para dispersar de: " + fromDist);
    console.log("[DISPERSAR PEDIDO] Distribuidores de destino considerados: " + (targetDistsUpper.join(", ") || "NENHUM"));

    try {
      const eligibleList: any[] = [];
      const allCodes = new Set<string>();
      
      for (const item of grouping.items) {
        try {
          console.log("[DISPERSAR PEDIDO] Testando item: " + item.novaDescricao + " (EAN: " + item.novoEan + ")...");
          const storedCutsStr = localStorage.getItem("cortes_recentes");
          const cortesRecentes = storedCutsStr ? JSON.parse(storedCutsStr) : {};

          const response = await fetch("/api/search-products", {
            method: "POST",
            headers: { "Content-Type": "application/json" },
            body: JSON.stringify({
              query: item.novoEan,
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
          if (response.ok) {
            const data = await response.json();
            if (data && data.items && data.items.length > 0) {
              const allOffers = data.items.filter((it: any) => 
                it.estoque > 0 && 
                normalizeDistName(it.distribuidora || "") !== fromDistNormalized &&
                targetDistsUpper.includes(normalizeDistName(it.distribuidora || ""))
              );
              
              if (allOffers.length > 0) {
                console.log("[DISPERSAR PEDIDO] Ofertas disponíveis:", allOffers.map(o => `${o.distribuidora} (R$${o.precoLiquido})`).join(", "));
                
                allOffers.sort((a: any, b: any) => a.precoLiquido - b.precoLiquido);
                
                const bestOffer = allOffers[0];
                
                const pctIncrease = ((bestOffer.precoLiquido / item.novoPreco) - 1) * 100;
                console.log("[DISPERSAR PEDIDO] -> Oferta selecionada: " + bestOffer.distribuidora + " (Preço: " + bestOffer.precoLiquido + ")");
                
                eligibleList.push({
                  item,
                  targetDist: bestOffer.distribuidora,
                  currentPrice: item.novoPreco,
                  targetPrice: bestOffer.precoLiquido,
                  pctIncrease: pctIncrease,
                  offer: bestOffer,
                  allOffers: allOffers
                });
                allCodes.add(item.codInterno);
              } else {
                console.log("[DISPERSAR PEDIDO] -> Nenhuma oferta com estoque.");
                eligibleList.push({ item, targetDist: "Sem Opção", currentPrice: item.novoPreco, targetPrice: 0, pctIncrease: 0, offer: null });
              }
            } else {
              console.log("[DISPERSAR PEDIDO] -> API não retornou itens.");
              eligibleList.push({ item, targetDist: "Sem Opção", currentPrice: item.novoPreco, targetPrice: 0, pctIncrease: 0, offer: null });
            }
          } else {
            console.log("[DISPERSAR PEDIDO] -> Erro na API HTTP " + response.status);
            eligibleList.push({ item, targetDist: "Erro API", currentPrice: item.novoPreco, targetPrice: 0, pctIncrease: 0, offer: null });
          }
        } catch (itemErr) {
          console.error("[DISPERSAR PEDIDO] -> Erro ao testar:", itemErr);
          eligibleList.push({ item, targetDist: "Erro", currentPrice: item.novoPreco, targetPrice: 0, pctIncrease: 0, offer: null });
        }
      }
      
      console.log("\n[DISPERSAR PEDIDO] Análise concluída.");
      setDispersingEligibleItems(eligibleList);
      setDispersingSelectedCodes(allCodes);
    } catch (err: any) {
      console.error(err);
      alert("Erro ao pesquisar alternativas de dispersão: " + err.message);
    } finally {
      setIsSearchingDispersing(false);
    }
  };

  const handleApplyDispersingTransfers = (selectedCodes: string[]) => {
    if (!result) return;
    
    const updatedReport = [...result.report];
    const selectedSet = new Set(selectedCodes);
    let transferredCount = 0;
    const logMessages: string[] = [];

    dispersingEligibleItems.forEach((eleg) => {
      if (selectedSet.has(eleg.item.codInterno) && eleg.offer) {
        const idx = updatedReport.findIndex(r => r.codInterno === eleg.item.codInterno);
        if (idx !== -1) {
          const off = eleg.offer;
          const mappedAlternatives = (eleg.allOffers || []).map((o: any) => ({
            ean: o.ean,
            descricao: o.descricao,
            laboratorio: o.laboratorio,
            preco: o.precoLiquido !== undefined ? o.precoLiquido : (o.preco !== undefined ? o.preco : 0),
            distribuidora: o.distribuidora,
            codDist: o.codDist,
            condicao: o.condicao,
            prazo: o.prazo,
            qtdMin: o.qtdMin,
            qtdMax: o.qtdMax,
            cx: o.cx,
            estoque: o.estoque
          }));

          updatedReport[idx] = {
            ...updatedReport[idx],
            novoEan: off.ean || updatedReport[idx].novoEan || updatedReport[idx].originalEan,
            novaDescricao: off.descricao || updatedReport[idx].novaDescricao || updatedReport[idx].originalDescricao,
            novoLaboratorio: off.laboratorio || updatedReport[idx].novoLaboratorio || updatedReport[idx].originalLaboratorio || "GENÉRICO",
            novoPreco: off.precoLiquido,
            distribuidora: off.distribuidora,
            estoque: off.estoque,
            codDist: off.codDist,
            condicao: off.condicao,
            codProdutoDist: off.codProdutoDist,
            codProduto: off.codProduto,
            prazo: off.prazo,
            motivoAcao: `Dispersado p/ ${off.distribuidora}`,
            economiaUnit: Math.max(0, updatedReport[idx].originalPreco - off.precoLiquido),
            economiaTotal: Math.max(0, updatedReport[idx].originalPreco - off.precoLiquido) * updatedReport[idx].qtd,
            isShortage: false,
            alternatives: mappedAlternatives
          };
          transferredCount++;
          logMessages.push(`[SUCESSO] Item "${eleg.item.novaDescricao}" dispersado para ${off.distribuidora}`);
        }
      }
    });
    
    if (transferredCount > 0) {
      setResult((prev: any) => {
        if (!prev) return null;
        const activeSwaps = updatedReport.filter((it: any) => !disregardedCodes.has(it.codInterno));
        const newTotalSavings = activeSwaps.reduce((sum, it) => sum + (it.economiaTotal || 0), 0);
        return {
          ...prev,
          summary: {
            ...prev.summary,
            totalSavings: newTotalSavings
          },
          report: updatedReport 
        };
      });
      setLogs(prev => [...prev, ...logMessages]);
    }
    setDispersingFromDist(null);
  };

  const handleStartCompletingWizard = async (toDist: string) => {
    setIsSearchingCompleting(toDist);
    setCompletingEligibleItems([]);
    setCompletingSelectedCodes(new Set());
    
    const targetDistClean = normalizeDistName(toDist);
    console.log("\n[COMPLETAR PEDIDO] Iniciando assistente para completar a distribuidora: " + targetDistClean + " (" + toDist + ")");
    
    const otherItems = activeReport.filter(r => {
      const rDistClean = normalizeDistName(r.distribuidora || "");
      return rDistClean !== targetDistClean && 
             r.distribuidora !== "Não Encontrados" && 
             r.distribuidora !== "Sem Estoque" && 
             !disabledItemCodes.has(r.codInterno) && 
             !r.disabled;
    });
    
    console.log("[COMPLETAR PEDIDO] Total de itens em outras distribuidoras: " + otherItems.length);

    if (otherItems.length === 0) {
      alert("Não há itens direcionados para outras distribuidoras para analisar.");
      setIsSearchingCompleting(null);
      return;
    }

    try {
      const eligibleList: any[] = [];
      for (const item of otherItems) {
        try {
          console.log("[COMPLETAR PEDIDO] Peguei o item " + item.novaDescricao + " (codigo ean " + item.novoEan + "), e pesquisei na " + targetDistClean + "...");
          
          const storedCutsStr = localStorage.getItem("cortes_recentes");
          const cortesRecentes = storedCutsStr ? JSON.parse(storedCutsStr) : {};

          const response = await fetch("/api/search-products", {
            method: "POST",
            headers: { "Content-Type": "application/json" },
            body: JSON.stringify({
              query: item.novoEan,
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
          
          if (response.ok) {
            const data = await response.json();
            if (data && data.items) {
              const descLower = item.novaDescricao.toLowerCase();
              const labLower = item.novoLaboratorio.toLowerCase();
              const itemIsGeneric = descLower.includes(" gn ") || descLower.includes("generico") || descLower.includes("genérico") || labLower.includes("generico") || labLower.includes("genérico") || labLower.includes("medley") || labLower.includes("ems") || labLower.includes("althaia") || labLower.includes("prati");
              
              const targetOffer = data.items.find((it: any) => {
                 const offerDistNorm = normalizeDistName(it.distribuidora || "");
                 return offerDistNorm === targetDistClean && it.estoque > 0;
              });
              
              if (targetOffer) {
                const currentPrice = item.novoPreco;
                const targetPrice = targetOffer.precoLiquido;
                const ratio = targetPrice / currentPrice;
                const increase = ((ratio - 1) * 100);
                
                console.log("[COMPLETAR PEDIDO] ...a situação é essa para o ean " + item.novoEan + ": Oferta ENCONTRADA! Preço lá: R$ " + targetPrice.toFixed(2) + " (Atual: R$ " + currentPrice.toFixed(2) + " na " + item.distribuidora + ")");
                
                // Regra de acréscimo de no máximo 10% do preço atual
                if (ratio <= 1.10) {
                  console.log("[COMPLETAR PEDIDO] -> APROVADO! (" + increase.toFixed(1) + "% <= 10%) O item será sugerido para transferência.");
                  eligibleList.push({ 
                    item, 
                    offer: targetOffer,
                    currentPrice: currentPrice,
                    currentDist: item.distribuidora,
                    targetPrice: targetPrice,
                    pctIncrease: increase
                  });
                } else {
                  console.log("[COMPLETAR PEDIDO] -> REJEITADO! Fica inviável puxar pois está " + increase.toFixed(1) + "% mais caro (Acima do limite de 10%).");
                }
              } else {
                 const availableDists = data.items.map((it:any) => it.distribuidora).join(', ');
                 console.log("[COMPLETAR PEDIDO] ...a situação é essa para o ean " + item.novoEan + ": NÃO TEM NESTA DISTRIBUIDORA OU ESTÁ SEM ESTOQUE. Só foi encontrado em: " + (availableDists || "nenhuma"));
              }
            } else {
               console.log("[COMPLETAR PEDIDO] ...a situação é essa para o ean " + item.novoEan + ": API não retornou nenhum item.");
            }
          } else {
            console.log("[COMPLETAR PEDIDO] ...a situação é essa para o ean " + item.novoEan + ": Erro na API -> HTTP " + response.status);
          }
        } catch (itemErr) {
          console.error("[COMPLETAR PEDIDO] ...a situação é essa para o ean " + item.novoEan + ": Falha na consulta ->", itemErr);
        }
      }

      console.log("\n[COMPLETAR PEDIDO] Análise concluída. Total de itens que podem ser puxados para " + toDist + ": " + eligibleList.length);

      if (eligibleList.length > 0) {
        setCompletingEligibleItems(eligibleList);
        setCompletingSelectedCodes(new Set(eligibleList.map(i => i.item.codInterno)));
        setCompletingTargetDist(toDist);
      } else {
        alert("Nenhum item de outras distribuidoras pode ser puxado para " + toDist + " (limite de 10% de acréscimo e verificação de estoque). Verifique o log do console (F12) para detalhes.");
      }
    } catch (err: any) {
      console.error("[COMPLETAR PEDIDO] Erro fatal:", err);
      alert("Erro ao pesquisar alternativas para completar: " + err.message);
    } finally {
      setIsSearchingCompleting(null);
    }
  };


  const handleReRouteShortages = async () => {
    if (!orderReturn || !orderReturn.Retorno || !orderReturn.Retorno.Itens || !result) return;

    const items = orderReturn.Retorno.Itens;
    if (items.length === 0) {
      alert("Nenhum item detectado no retorno.");
      return;
    }

    const distsInReturn = orderReturn.Retorno.Dists || orderReturn.Retorno.dists || [];
    // Apenas consideramos distribuidoras que já finalizaram o processamento (Status === 3)
    const finalizedCodDists = new Set(
      distsInReturn
        .filter((d: any) => d.Status === 3)
        .map((d: any) => String(d.CodDist || d.codDist || "").trim())
    );

    const newFaturadosGlobais = [...faturadosGlobais];
    const itemsToKeep = [];
    const manualCuts: any[] = [];
    
    for (const reportItem of result.report) {
        const itemDistCod = String(reportItem.codDist).trim();
        
        // Se a distribuidora deste item ainda não finalizou o faturamento, mantemos o item intocado no lote para continuarmos aguardando
        if (!finalizedCodDists.has(itemDistCod)) {
            itemsToKeep.push(reportItem);
            continue;
        }

        const ean = String(reportItem.novoEan || reportItem.originalEan).trim();
        const returnItem = items.find((it) => String(it.Ean).trim() === ean && String(it.CodDist).trim() === itemDistCod);
        const isManual = reportItem.codInterno.startsWith("MANUAL-");

        if (returnItem) {
            if (returnItem.QuantFaturada > 0) {
                newFaturadosGlobais.push({
                    fornecedor: reportItem.distribuidora,
                    ean: ean,
                    descricao: reportItem.novaDescricao || reportItem.originalDescricao,
                    laboratorio: reportItem.novoLaboratorio || reportItem.originalLaboratorio,
                    valor: reportItem.novoPreco || reportItem.originalPreco,
                    quantidade: returnItem.QuantFaturada
                });
            }

            const missingQty = returnItem.Quant - returnItem.QuantFaturada;
            if (missingQty > 0) {
                itemsToKeep.push({
                    ...reportItem,
                    qtd: missingQty,
                    economiaTotal: (reportItem.economiaUnit || 0) * missingQty,
                    isShortage: true
                });

                if (isManual) {
                  manualCuts.push({
                    descricao: reportItem.novaDescricao || reportItem.originalDescricao,
                    ean,
                    distribuidora: reportItem.distribuidora,
                    solicitado: reportItem.qtd,
                    faturado: returnItem.QuantFaturada,
                    motivo: returnItem.Motivo || "Cortado / Sem Estoque"
                  });
                }
            }
        } else {
             itemsToKeep.push({
                 ...reportItem,
                 isShortage: true
             });

             if (isManual) {
               manualCuts.push({
                 descricao: reportItem.novaDescricao || reportItem.originalDescricao,
                 ean,
                 distribuidora: reportItem.distribuidora,
                 solicitado: reportItem.qtd,
                 faturado: 0,
                 motivo: "Não retornado no faturamento final do distribuidor"
               });
             }
        }
    }

    if (manualCuts.length > 0) {
      setManualCutsAlert(manualCuts);
    }

    setFaturadosGlobais(newFaturadosGlobais);
    
    // Un-hide shortages from billedItemCodes so they reappear in the main list
    setBilledItemCodes(prev => {
       const next = new Set(prev);
       itemsToKeep.forEach(it => {
           if (it.isShortage) {
               next.delete(it.codInterno);
           }
       });
       return next;
    });

    setResult((prev) => {
      if (!prev) return null;
      const activeSwaps = itemsToKeep.filter((it) => !disregardedCodes.has(it.codInterno));
      const newTotalSavings = activeSwaps.reduce((sum, it) => sum + (it.economiaTotal || 0), 0);
      return {
        ...prev,
        summary: {
          ...prev.summary,
          totalItems: itemsToKeep.length,
          totalSavings: newTotalSavings
        },
        report: itemsToKeep
      };
    });

    setBilledGroups(prev => {
        const next = { ...prev };
        if (billingContext && billingContext.relatedGroups) {
            billingContext.relatedGroups.forEach(g => {
                delete next[g];
            });
        } else {
            // Fallback just in case
            for (const key of Object.keys(next)) {
                if (next[key].status === "retornado" || next[key].status === "faturando") {
                    delete next[key];
                }
            }
        }
        return next;
    });

    setBillingResult(null);
    setIsBillingModalOpen(false);
  };

  // Exportar relatório de faltas detectadas no retorno do distribuidor (Status 3)
  const handleExportShortages = () => {
    if (!orderReturn || !orderReturn.Retorno || !orderReturn.Retorno.Itens) return;
    
    const items = orderReturn.Retorno.Itens;
    // Filtrar itens onde houve falta (QuantFaturada < Quant)
    const shortages = items.filter((it: any) => it.QuantFaturada < it.Quant);

    if (shortages.length === 0) {
      alert("Excelente notícia! Nenhum corte ou falta foi detectado neste faturamento.");
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
    link.setAttribute("download", `relatorio_faltas_pedido_${billingResult?.numPedido || 'smartped'}.csv`);
    document.body.appendChild(link);
    link.click();
    document.body.removeChild(link);
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
          <DailyItemsView 
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
              <OrderReturnView
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

                <PendingOrdersTable billedGroups={billedGroups} onViewLogs={(logs, name) => setViewingLogs({groupKeys: [name], title: name})} />
                
                {isSwapsTableVisible && (
                  <div className="p-5 animate-fade-in">
                    <SwapsTable
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
        {/* Floating Manual Add Button */}
        {mainView === "optimize" && (
          <motion.div
            drag
            dragMomentum={false}
            whileDrag={{ scale: 1.1 }}
            onDragStart={() => (isDragging.current = true)}
            onDragEnd={() => setTimeout(() => (isDragging.current = false), 50)}
            className="fixed bottom-8 right-8 z-40"
          >
            <button
              onClick={() => {
                if (!isDragging.current) setIsManualAddModalOpen(true);
              }}
              className="bg-emerald-700 hover:bg-emerald-800 text-white rounded-full p-4 shadow-[4px_4px_0px_0px_rgba(20,20,20,1)] border-2 border-[#141414] cursor-pointer flex items-center justify-center space-x-2 transition-colors group"
            >
              <Plus className="w-6 h-6 group-hover:scale-110 transition-transform" />
            </button>
          </motion.div>
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
                  <button onClick={() => { setIsManualAddModalOpen(false); setManualQuery(""); setManualAddOriginItem(null); }} className="text-[#E4E3E0]/70 hover:text-white transition-colors cursor-pointer">
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
                              {offerColVis.prazo && <th className="px-2.5 py-2 border-b border-r border-gray-700 font-bold uppercase tracking-wider text-[10px] text-center relative select-none" style={{ width: offerColWidths.prazo }}><span>Prazo</span><div className="absolute right-0 top-0 bottom-0 w-1 cursor-col-resize hover:bg-gray-500/50" onMouseDown={(e) => { e.preventDefault(); setResizingCol({ key: 'prazo', startX: e.clientX, startW: offerColWidths.prazo }); }} /></th>}
                              {offerColVis.qtdMin && <th className="px-2.5 py-2 border-b border-r border-gray-700 font-bold uppercase tracking-wider text-[10px] text-center relative select-none" style={{ width: offerColWidths.qtdMin }}><span>Qtd Mín. Item</span><div className="absolute right-0 top-0 bottom-0 w-1 cursor-col-resize hover:bg-gray-500/50" onMouseDown={(e) => { e.preventDefault(); setResizingCol({ key: 'qtdMin', startX: e.clientX, startW: offerColWidths.qtdMin }); }} /></th>}
                              {offerColVis.pedMin && <th className="px-2.5 py-2 border-b border-r border-gray-700 font-bold uppercase tracking-wider text-[10px] text-right relative select-none" style={{ width: offerColWidths.pedMin }}><span>Ped. Mín. Dist</span><div className="absolute right-0 top-0 bottom-0 w-1 cursor-col-resize hover:bg-gray-500/50" onMouseDown={(e) => { e.preventDefault(); setResizingCol({ key: 'pedMin', startX: e.clientX, startW: offerColWidths.pedMin }); }} /></th>}
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
                                    <span className="font-black text-sm text-emerald-700 bg-emerald-50 px-1.5 py-0.5 border border-emerald-200">
                                      {formatCurrency(pLiquido)}
                                    </span>
                                  </td>}

                                  {offerColVis.prazo && <td className="px-2.5 py-2 border-r border-gray-200 align-middle text-center" style={{ width: offerColWidths.prazo }}>
                                    <span className="bg-gray-100 border border-gray-300 text-gray-800 font-bold px-1.5 py-0.5 text-[10px]">
                                      {offerPrazo > 0 ? `${offerPrazo}d` : "À Vista"}
                                    </span>
                                  </td>}

                                  {offerColVis.qtdMin && <td className="px-2.5 py-2 border-r border-gray-200 align-middle text-center" style={{ width: offerColWidths.qtdMin }}>
                                    {qtdMinItem > 1 ? (
                                      <span className="bg-amber-100 text-amber-900 border border-amber-300 font-bold px-1.5 py-0.5 text-[10px]" title="Quantidade mínima exigida por item">
                                        Mín {qtdMinItem} un
                                      </span>
                                    ) : (
                                      <span className="text-gray-500">1 un</span>
                                    )}
                                  </td>}

                                  {offerColVis.pedMin && <td className="px-2.5 py-2 border-r border-gray-200 align-middle text-right" style={{ width: offerColWidths.pedMin }}>
                                    <span className="text-[11px] font-bold text-gray-700" title="Valor mínimo para faturamento desta distribuidora">
                                      {formatCurrency(pedMinDist)}
                                    </span>
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
                    <OrderReturnView                      orderReturn={orderReturn}                      itemsFaturados={billingResult.itemsFaturados}                      onReRouteShortages={handleReRouteShortages}                      onExportShortages={handleExportShortages}                      isReRoutingShortages={isReRoutingShortages}                    />
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
  );
}
