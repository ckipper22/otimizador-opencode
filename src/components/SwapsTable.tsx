import React, { useState, useMemo, useCallback, useEffect } from "react";
import { EanEyeButton } from "./EanEyeButton";
import { EanPromoButton } from "./EanPromoButton";
import { ObservationBell } from "./ObservationBell";
import { 
  Search, 
  ArrowRight, 
  ArrowDownRight, 
  Tag, 
  EyeOff, 
  Check, 
  CheckCircle,
  AlertTriangle, 
  ShieldCheck, 
  CheckSquare, 
  Square, 
  X, 
  RefreshCw, 
  ShoppingCart, 
  Truck, 
  Sparkles, 
  Trash2, 
  ChevronRight,
  HelpCircle,
  MessageSquare,
  Copy,
  Layers,
  ArrowUp,
  FolderMinus
} from "lucide-react";
import { SwapReportItem, OptimizerConfig, WhatsAppRule } from "../types";
import { formatCurrency } from "../utils";
import { motion, AnimatePresence } from "motion/react";
import { InterchangeabilityModal } from "./InterchangeabilityModal";
import { WhatsAppOrderModal } from "./WhatsAppOrderModal";
import { ConditionSelector } from "./ConditionSelector";

function stripHtml(str: string | undefined | null): string {
  if (!str) return "";
  return str.replace(/<\/?[^>]+(>|$)/g, "").trim();
}

function getLabBadge(labName: string) {
  const normalized = (labName || "").toUpperCase();
  const isGeneric = normalized.includes("GENERICO") || normalized.includes("GENÉRICO") || normalized.includes("PRATI") || normalized.includes("GERMED") || normalized.includes("TEUTO") || normalized.includes("GEOLAB") || normalized.includes("PRATI-DONADUZZI") || normalized.includes("NEO QUIMICA") || normalized.includes("NEO QUÍMICA") || normalized.includes("GLOBO");
  
  if (isGeneric) {
    return (
      <span className="inline-flex items-center gap-1 px-1.5 py-0.5 bg-emerald-50 border border-emerald-300 text-emerald-800 font-sans text-[9px] font-black rounded-sm uppercase tracking-wide">
        🔬 Genérico
      </span>
    );
  } else {
    return (
      <span className="inline-flex items-center gap-1 px-1.5 py-0.5 bg-purple-50 border border-purple-300 text-purple-800 font-sans text-[9px] font-black rounded-sm uppercase tracking-wide">
        ⭐ Marca/Referência
      </span>
    );
  }
}

function getLabAbbrev(labName: string): string {
  return (labName || "").toUpperCase().trim() || "GEN";
}

interface SwapsTableProps {
  report: SwapReportItem[];
  rawReport?: SwapReportItem[];
  billedItemCodes?: Set<string>;
  disregardedCodes: Set<string>;
  disabledItemCodes: Set<string>;
  onToggleDisregard: (codInterno: string) => void;
  onToggleDisabled: (codInterno: string) => void;
  onUpdateQty: (codInterno: string, newQty: number) => void;
  distributorMinimums: Record<string, number>;
  onSendBilling: (distName: string) => void;
  isBillingLoading: boolean;
  billedGroups?: Record<string, { status: "faturando" | "retornado", faltas: any[] }>;
  onStartCompletingWizard: (distName: string) => void;
  onDisperseItems: (distName: string) => void;
  isSearchingCompleting: string | null;
  isDispersing: Record<string, boolean>;
  onUpdateMinimum: (distName: string, value: number) => void;
  onUpdateDistributor: (codInterno: string, newDist: string) => void;
  onDeleteDistributor: (distName: string) => void;
  distributorOrder: string[];
  onReopenModal?: () => void;
  onSelectCondition?: (codInterno: string, selectedAlt: any) => void;
  dailyOrders?: any[];
  config?: OptimizerConfig;
}

export default function SwapsTable({ 
  report, 
  rawReport = [],
  billedItemCodes = new Set(),
  disregardedCodes, 
  disabledItemCodes,
  onToggleDisregard, 
  onToggleDisabled,
  onUpdateQty,
  distributorMinimums,
  onSendBilling,
  isBillingLoading,
  billedGroups = {},
  onStartCompletingWizard,
  onDisperseItems,
  isSearchingCompleting,
  isDispersing,
  onUpdateMinimum,
  onUpdateDistributor,
  onDeleteDistributor,
  distributorOrder,
  onReopenModal,
  onSelectCondition,
  dailyOrders = [],
  config
}: SwapsTableProps) {
  const [searchTerm, setSearchTerm] = useState("");
  const [isFloatingSearchOpen, setIsFloatingSearchOpen] = useState(false);
  const [interchangeableItem, setInterchangeableItem] = useState<any>(null);
  const [isWhatsAppModalOpen, setIsWhatsAppModalOpen] = useState(false);
  const [selectedWhatsAppRule, setSelectedWhatsAppRule] = useState<WhatsAppRule | null>(null);
  const [filterType, setFilterType] = useState<"all" | "swapped" | "original">("all");

  // Regras ativas de pedido WhatsApp (do config ou fallback para Eurofarma)
  const activeWhatsAppRules = useMemo<WhatsAppRule[]>(() => {
    if (config?.whatsAppRules && config.whatsAppRules.length > 0) {
      return config.whatsAppRules.filter(r => r.ativo !== false);
    }
    return [{
      id: "rule_eurofarma_default",
      nomeRegra: "Genéricos Eurofarma",
      termoFiltro: "EUROFARMA",
      nomeRepresentante: "Representante Eurofarma",
      telefone: config?.telefoneWhatsappEurofarma || "",
      tipoFiltro: "genericos",
      ocultarPrecos: true,
      ativo: true
    }];
  }, [config?.whatsAppRules, config?.telefoneWhatsappEurofarma]);

  const ruleMatchesMap = useMemo(() => {
    const map = new Map<string, SwapReportItem[]>();
    activeWhatsAppRules.forEach(rule => {
      const filterUpper = (rule.termoFiltro || "").trim().toUpperCase();
      const matched = report.filter((item) => {
        if (disabledItemCodes.has(item.codInterno)) return false;
        if (!filterUpper) return true;
        const labOriginal = (item.originalLaboratorio || "").toUpperCase();
        const labNovo = (item.novoLaboratorio || "").toUpperCase();
        const descNovo = (item.novaDescricao || "").toUpperCase();
        const descOrig = (item.originalDescricao || "").toUpperCase();
        return labOriginal.includes(filterUpper) || labNovo.includes(filterUpper) || descNovo.includes(filterUpper) || descOrig.includes(filterUpper);
      });
      map.set(rule.id, matched);
    });
    return map;
  }, [activeWhatsAppRules, report, disabledItemCodes]);

  const eurofarmaItems = useMemo(() => {
    return ruleMatchesMap.get(activeWhatsAppRules[0]?.id || "") || [];
  }, [ruleMatchesMap, activeWhatsAppRules]);
  const [expandedGroups, setExpandedGroups] = useState<Record<string, boolean>>({});
  const [isTrackerOpen, setIsTrackerOpen] = useState(false);
  const [trackerQuery, setTrackerQuery] = useState("");
  const [highValueThreshold, setHighValueThreshold] = useState<number>(() => {
    const saved = localStorage.getItem("highValueThreshold");
    return saved !== null ? parseFloat(saved) : 100.0;
  });
  const [profarmaDecisions, setProfarmaDecisions] = useState<Record<string, 'keep' | 'exclude'>>({});
  const [showOnlyAlerts, setShowOnlyAlerts] = useState(false);
  const [hiddenAlerts, setHiddenAlerts] = useState<Record<string, boolean>>({});
  const [alertInputs, setAlertInputs] = useState<Record<string, number>>({});

  // Calcula dinamicamente o valor acumulado e mínimo de cada distribuidor/grupo
  const groupTotalsAndMins = useMemo(() => {
    const map: Record<string, { totalValue: number; min: number; isVirtual: boolean }> = {};
    for (const item of report) {
      if (disabledItemCodes.has(item.codInterno)) continue;
      const dist = item.distribuidora || "Não Encontrados";
      const isVirtual = dist === "Não Encontrados" || dist === "Sem Estoque";
      const groupKey = isVirtual 
        ? dist 
        : `${dist} [${item.condicao || "FIXA"} | ${item.prazo !== undefined ? item.prazo : 0}d]`;
      
      if (!map[groupKey]) {
        const minVal = distributorMinimums[groupKey] !== undefined ? distributorMinimums[groupKey] : (item.pedidoMinimo || 0);
        map[groupKey] = { totalValue: 0, min: minVal, isVirtual };
      }
      map[groupKey].totalValue += item.novoPreco * item.qtd;
    }
    return map;
  }, [report, disabledItemCodes, distributorMinimums]);

  // Função para identificar se um item exige revisão/possui alertas ativos
  const isItemAlert = useCallback((item: SwapReportItem) => {
    const itemQtd = item.qtd;
    const cxAlerta = !!(item.cx && item.cx > 1 && (itemQtd % item.cx !== 0));
    const qtdMinAlerta = !!(item.qtdMin && item.qtdMin > 0 && (itemQtd < item.qtdMin));
    const qtdMaxAlerta = !!(item.qtdMax && item.qtdMax > 0 && (itemQtd > item.qtdMax));
    
    // Alerta de preço: se o preço do substituto ficou mais alto que o original + R$ 0.01
    const isAccepted = !disregardedCodes.has(item.codInterno);
    const priceIncreased = !isAccepted ? false : (item.novoPreco > item.originalPreco + 0.01);
    const hasObservation = !!item.observacao;
    
    // Se o item pertence à distribuidora Não Encontrados ou Sem Estoque
    const dist = item.distribuidora || "Não Encontrados";
    const isVirtual = dist === "Não Encontrados" || dist === "Sem Estoque";
    
    // Alerta de mínimo do grupo: se o total acumulado do distribuidor não atingiu o pedido mínimo
    const groupKey = isVirtual 
      ? dist 
      : `${dist} [${item.condicao || "FIXA"} | ${item.prazo !== undefined ? item.prazo : 0}d]`;
    
    const groupInfo = groupTotalsAndMins[groupKey];
    const isGroupBelowMin = groupInfo ? (!groupInfo.isVirtual && groupInfo.totalValue < groupInfo.min) : false;
    
    return (
      cxAlerta || 
      qtdMinAlerta || 
      qtdMaxAlerta || 
      priceIncreased || 
      hasObservation || 
      isVirtual || 
      isGroupBelowMin || 
      !!item.originalSemEstoque
    );
  }, [groupTotalsAndMins, disregardedCodes]);

  // Conta a quantidade total de itens que possuem algum alerta/pendência ativo
  const alertItemsCount = useMemo(() => {
    return report.filter(item => !disabledItemCodes.has(item.codInterno) && isItemAlert(item)).length;
  }, [report, disabledItemCodes, isItemAlert]);

  // EAN cleaning helper
  const cleanEanLocal = (e: string) => {
    if (!e) return "";
    const cleaned = String(e).trim().replace(/\D/g, "");
    if (!cleaned) return "";
    if (cleaned.length <= 13) {
      return cleaned.padStart(13, "0");
    }
    return cleaned;
  };

  // Detect recent successful orders at Profarma (last 2 business days)
  const profarmaRecentOrdersEans = useMemo(() => {
    if (!dailyOrders || !Array.isArray(dailyOrders)) return new Set<string>();

    const eans = new Set<string>();
    
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

    dailyOrders.forEach(order => {
      const orderDate = String(order.dataPedido || order.DataPedido || "").trim();
      const isWithinAllowedDates = allowedDates.has(orderDate);

      if (isWithinAllowedDates && order.detalhes?.Itens) {
        order.detalhes.Itens.forEach((item: any) => {
          const codDist = item.CodDist !== undefined ? item.CodDist : (item.codDist !== undefined ? item.codDist : 0);
          const ean = cleanEanLocal(item.Ean || item.ean || "");
          if (ean && (codDist === 4 || String(item.NomeDist || "").toUpperCase().includes("PROFARMA"))) {
            eans.add(ean);
          }
        });
      }
    });

    return eans;
  }, [dailyOrders]);

  const handleThresholdChange = (val: number) => {
    const safeVal = Math.max(0, isNaN(val) ? 0 : val);
    setHighValueThreshold(safeVal);
    localStorage.setItem("highValueThreshold", safeVal.toString());
  };

  const trackerResults = useMemo(() => {
    const trimmed = trackerQuery.trim().toLowerCase();
    if (!trimmed) return [];
    const sourceReport = rawReport && rawReport.length > 0 ? rawReport : report;
    return sourceReport.filter(item => {
      return (
        item.originalEan.toLowerCase().includes(trimmed) ||
        item.novoEan.toLowerCase().includes(trimmed) ||
        item.codInterno.toLowerCase().includes(trimmed) ||
        item.originalDescricao.toLowerCase().includes(trimmed) ||
        item.novaDescricao.toLowerCase().includes(trimmed)
      );
    });
  }, [report, rawReport, trackerQuery]);

  const toggleGroup = (groupName: string) => {
    setExpandedGroups(prev => ({
      ...prev,
      [groupName]: !prev[groupName]
    }));
  };

  // Get list of all distributors to allow manual routing
  const allDistributors = useMemo(() => {
    const set = new Set<string>();
    for (const item of report) {
      if (item.distribuidora && item.distribuidora !== "Não Encontrados") {
        set.add(item.distribuidora);
      }
    }
    // Add some common defaults
    ["ANB", "DrogaCenter", "SantaCruz", "Servimed", "Apolo", "Nacional", "GAM", "PanPharma", "Profarma", "NeoSul"].forEach(d => set.add(d));
    return Array.from(set).sort();
  }, [report]);

  // Filter report based on search term and filter type
  const processedReport = useMemo(() => {
    return report.filter((item) => {
      if (disabledItemCodes.has(item.codInterno)) return false;
      const isSwapped = item.originalEan !== item.novoEan;
      const isDisregarded = disregardedCodes.has(item.codInterno);
      const isTransferred = item.motivoAcao && (item.motivoAcao.startsWith('Dispersado') || item.motivoAcao.startsWith('Puxado'));
                                                      
      // Filter type matching
      if (filterType === "swapped" && (isDisregarded || !isSwapped)) return false;
      if (filterType === "original" && (!isDisregarded && isSwapped)) return false;

      // Alertas apenas
      if (showOnlyAlerts && !isItemAlert(item)) return false;

      const term = searchTerm.toLowerCase();
      return (
        item.originalDescricao.toLowerCase().includes(term) ||
        item.novaDescricao.toLowerCase().includes(term) ||
        item.originalEan.includes(term) ||
        item.novoEan.includes(term) ||
        item.codInterno.includes(term) ||
        (item.distribuidora || "").toLowerCase().includes(term)
      );
    });
  }, [report, disregardedCodes, searchTerm, filterType, disabledItemCodes, showOnlyAlerts, isItemAlert]);

  // Group filtered items by distributor and condition/prazo
  const groups = useMemo(() => {
    const map: Record<string, { 
      name: string; 
      distribuidora: string;
      condicao?: string;
      prazo?: number;
      pedidoMinimo: number;
      items: SwapReportItem[]; 
      totalValue: number; 
      activeCount: number; 
    }> = {};
    
    for (const item of processedReport) {
      const dist = item.distribuidora || "Não Encontrados";
      const isVirtual = dist === "Não Encontrados" || dist === "Sem Estoque";
      const groupKey = isVirtual 
        ? dist 
        : `${dist} [${item.condicao || "FIXA"} | ${item.prazo !== undefined ? item.prazo : 0}d]`;
      
      const isDisabled = disabledItemCodes.has(item.codInterno);
      
      if (!map[groupKey]) {
        map[groupKey] = { 
          name: groupKey, 
          distribuidora: dist,
          condicao: item.condicao,
          prazo: item.prazo,
          pedidoMinimo: item.pedidoMinimo || 0,
          items: [], 
          totalValue: 0, 
          activeCount: 0 
        };
      }
      
      map[groupKey].items.push(item);
      if (!isDisabled) {
        map[groupKey].totalValue += item.novoPreco * item.qtd;
        map[groupKey].activeCount++;
      }
    }
    
    // Sort based on the stable distributorOrder if available, otherwise use default logic
    if (distributorOrder && distributorOrder.length > 0) {
      return distributorOrder
        .map(name => map[name])
        .filter(g => g && g.items.length > 0);
    }

    return Object.values(map).sort((a, b) => {
      const isAVirtual = a.distribuidora === "Não Encontrados" || a.distribuidora === "Sem Estoque";
      const isBVirtual = b.distribuidora === "Não Encontrados" || b.distribuidora === "Sem Estoque";

      if (isAVirtual && !isBVirtual) return 1;
      if (!isAVirtual && isBVirtual) return -1;

      if (!isAVirtual && !isBVirtual) {
        const minA = distributorMinimums[a.name] !== undefined ? distributorMinimums[a.name] : a.pedidoMinimo;
        const isAMet = a.totalValue >= minA;
        const minB = distributorMinimums[b.name] !== undefined ? distributorMinimums[b.name] : b.pedidoMinimo;
        const isBMet = b.totalValue >= minB;

        // Incompletos primeiro (amarelo)
        if (!isAMet && isBMet) return -1;
        // Completos depois (verde)
        if (isAMet && !isBMet) return 1;

        // Mesma categoria, ordena por valor decrescente
        return b.totalValue - a.totalValue;
      }

      // Ambos virtuais
      if (a.distribuidora === "Não Encontrados" && b.distribuidora === "Sem Estoque") return -1;
      if (a.distribuidora === "Sem Estoque" && b.distribuidora === "Não Encontrados") return 1;
      
      return 0;
    });
  }, [processedReport, disabledItemCodes, distributorMinimums, distributorOrder]);

  // Automatically expand/collapse groups when "Apenas Alertas/Pendências" filter is toggled
  useEffect(() => {
    if (showOnlyAlerts) {
      const newExpanded: Record<string, boolean> = {};
      groups.forEach((group) => {
        const hasAlert = group.items.some((item) => isItemAlert(item));
        if (hasAlert) {
          newExpanded[group.name] = true;
        }
      });
      setExpandedGroups(newExpanded);
    }
    // NÃO resetar expandedGroups quando showOnlyAlerts é false
    // Isso preserva o estado de expansão quando o usuário altera quantidades
  }, [showOnlyAlerts]);

  // Items that have an active swap suggestion (for the review panel at the top)
  const swapSuggestions = useMemo(() => {
    return report.filter(item => {
      const hasSwap = item.originalEan !== item.novoEan;
      return hasSwap && !disabledItemCodes.has(item.codInterno);
    });
  }, [report, disabledItemCodes]);

  const acceptedSwapsCount = useMemo(() => {
    return swapSuggestions.filter(item => !disregardedCodes.has(item.codInterno)).length;
  }, [swapSuggestions, disregardedCodes]);

  return (
    <div id="painel-escolhas-revisao" className="space-y-8">
      
      {/* 1. INTERACTIVE SWAP EVALUATION DASHBOARD */}
      {swapSuggestions.length > 0 && (
        <div className="bg-[#DCDAD7] border-4 border-[#141414] p-5 rounded-none shadow-[4px_4px_0px_0px_rgba(20,20,20,1)] text-[#141414]">
          <div className="flex flex-col sm:flex-row sm:items-center sm:justify-between pb-3 border-b border-[#141414]/20 gap-3">
            <div>
              <span className="text-[10px] font-black uppercase tracking-widest font-mono bg-[#141414] text-[#E4E3E0] px-2.5 py-1">
                Painel de Escolhas & Revisão de Substituições
              </span>
              <h3 className="font-serif italic text-lg font-bold text-[#141414] mt-2">
                Avalie as trocas recomendadas pelo motor inteligente
              </h3>
              <p className="text-[11px] text-gray-600 font-semibold uppercase mt-0.5">
                Escolha quais trocas aceitar para obter descontos. Preços em tempo real.
              </p>
            </div>
            <div className="text-left sm:text-right shrink-0">
              <p className="text-[10px] uppercase font-mono font-black text-[#141414]/60">Taxa de Adesão</p>
              <p className="text-xl font-mono font-black text-[#141414]">
                {acceptedSwapsCount} de {swapSuggestions.length} <span className="text-xs text-[#141414]/50">aceitos</span>
              </p>
              <div className="w-full bg-[#141414]/15 h-1.5 mt-1 rounded-none border border-[#141414]/20 overflow-hidden">
                <div 
                  className="bg-emerald-700 h-full transition-all duration-300"
                  style={{ width: `${(acceptedSwapsCount / swapSuggestions.length) * 100}%` }}
                />
              </div>
            </div>
          </div>

          {/* Table of suggested swaps (itens em linha) */}
          <div className="overflow-x-auto mt-5 border border-[#141414] bg-white shadow-sm">
            <table className="w-full text-left border-collapse font-mono text-xs">
              <thead>
                <tr className="bg-[#141414] text-[#E4E3E0] uppercase tracking-wider text-[9px] font-bold">
                  <th className="py-2.5 px-3 border-r border-white/10 text-center w-28">Status</th>
                  <th className="py-2.5 px-3 border-r border-white/10 w-16 text-center">Cód</th>
                  <th className="py-2.5 px-3 border-r border-white/10 min-w-[260px]">De (Produto Original)</th>
                  <th className="py-2.5 px-3 border-r border-white/10 min-w-[260px]">Para (Substituto Recomendado)</th>
                  <th className="py-2.5 px-3 border-r border-white/10 text-center w-14">Qtd</th>
                  <th className="py-2.5 px-3 border-r border-white/10 text-right w-24">Economia Unit.</th>
                  <th className="py-2.5 px-3 border-r border-white/10 text-right w-24">Economia Total</th>
                  <th className="py-2.5 px-3 text-center w-80 min-w-[300px]">Decisão / Escolha</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-[#141414]/10">
                {swapSuggestions.map((item, idx) => {
                  const isAccepted = !disregardedCodes.has(item.codInterno);
                  const percentSaved = Math.max(0, ((item.originalPreco - item.novoPreco) / item.originalPreco) * 100);
                  const unitSavings = item.originalPreco - item.novoPreco;
                  const lineSavings = item.economiaTotal;

                  console.log(`[SWAPS-TABLE] EAN=${item.originalEan} | isRupturaSubstitution=${item.isRupturaSubstitution} | originalSemEstoque=${item.originalSemEstoque} | originalRupturaEan=${item.originalRupturaEan}`);

                  return (
                    <tr 
                      key={item.codInterno} 
                      className={`transition-colors ${
                        item.isShortage ? "bg-yellow-300 hover:bg-yellow-400" : isAccepted ? "bg-emerald-50/40 hover:bg-emerald-50/60" : "bg-gray-50/60 hover:bg-gray-100/50 opacity-80"
                      }`}
                    >
                      {/* Status */}
                      <td className="py-2.5 px-3 border-r border-[#141414]/10 text-center">
                        {isAccepted ? (
                          <span className="bg-emerald-100 text-emerald-800 text-[8px] font-black uppercase tracking-wider px-2 py-0.5 border border-emerald-500 rounded-none inline-block">
                            ✓ ACEITA (-{percentSaved.toFixed(0)}%)
                          </span>
                        ) : (
                          <span className="bg-gray-200 text-gray-700 text-[8px] font-black uppercase tracking-wider px-2 py-0.5 border border-gray-400 rounded-none inline-block">
                            ✕ REVERTIDA
                          </span>
                        )}
                      </td>

                      {/* Code */}
                      <td className="py-2.5 px-3 border-r border-[#141414]/10 text-center font-bold text-gray-500">
                        {item.codInterno}
                      </td>

                      {/* Original Product */}
                      <td className={`py-2.5 px-3 border-r border-[#141414]/10 font-bold ${item.isRupturaSubstitution ? 'bg-red-50' : 'text-gray-700'}`}>
                        <div>
                          <p className={`line-clamp-2 ${item.isRupturaSubstitution ? 'text-red-900 font-black' : ''}`}>
                            {item.isRupturaSubstitution ? item.novaDescricao : item.originalDescricao}
                            {((item.isRupturaSubstitution ? item.novoLaboratorio : item.originalLaboratorio) || "").trim() && (
                              <>
                                <span> - </span>
                                <span className="font-normal text-gray-500">
                                  {getLabAbbrev(item.isRupturaSubstitution ? item.novoLaboratorio : item.originalLaboratorio)}
                                </span>
                              </>
                            )}
                          </p>
                          <div className="text-[10px] text-gray-400 mt-0.5 font-normal flex flex-wrap items-center">
                            EAN: {item.isRupturaSubstitution ? item.novoEan : item.originalEan} <EanEyeButton ean={item.isRupturaSubstitution ? item.novoEan : item.originalEan} descricao={item.isRupturaSubstitution ? item.novaDescricao : item.originalDescricao} laboratorio={item.isRupturaSubstitution ? item.novoLaboratorio : item.originalLaboratorio} qtd={item.qtd || 1} /><EanPromoButton ean={item.isRupturaSubstitution ? item.novoEan : item.originalEan} descricao={item.isRupturaSubstitution ? item.novaDescricao : item.originalDescricao} />
                            {item.alternatives && item.alternatives.length > 0 && (
                              <button
                                onClick={(e) => {
                                  e.stopPropagation();
                                  e.preventDefault();
                                  setInterchangeableItem(item);
                                }}
                                className="inline-flex items-center justify-center p-1 bg-blue-50 hover:bg-blue-600 border border-blue-300 hover:border-blue-700 text-blue-700 hover:text-white rounded-none ml-1 transition-colors cursor-pointer shrink-0"
                                title="Ver todas as condições e intercambialidade (Similares, Genéricos, Éticos)"
                              >
                                <Layers className="w-3.5 h-3.5" />
                              </button>
                            )}
                            {item.isRupturaSubstitution && item.originalRupturaEan && (
                              <button
                                onClick={(e) => {
                                  e.stopPropagation();
                                  e.preventDefault();
                                  alert(`Produto Original (Ruptura):\nEAN: ${item.originalRupturaEan}\nDescrição: ${item.originalRupturaDescricao}\nLaboratório: ${item.originalRupturaLaboratorio}\nPreço Original: R$ ${item.originalRupturaPreco?.toFixed(2)}`);
                                }}
                                className="inline-flex items-center justify-center p-1 bg-red-50 hover:bg-red-600 border border-red-300 hover:border-red-700 text-red-700 hover:text-white rounded-none ml-1 transition-colors cursor-pointer shrink-0"
                                title="Ver produto original (ruptura)"
                              >
                                <AlertTriangle className="w-3.5 h-3.5" />
                              </button>
                            )}
                            <span className="mx-1">|</span> Unit: {formatCurrency(item.isRupturaSubstitution ? item.novoPreco : item.originalPreco)}
                          </div>
                          {/* Vendas + Estoque badge (Painel de Escolhas) */}
                          {((item.vendasMensais ?? 0) > 0 || (item.estoqueTotal ?? 0) > 0) && (
                            <div className="flex items-center gap-2 mt-1">
                               {(item.vendasMensais ?? 0) > 0 && (
                                <span className="text-[9px] font-sans font-bold text-indigo-700 bg-indigo-50 px-1.5 py-0.5 border border-indigo-200 rounded-none inline-flex items-center gap-0.5" title="Média de vendas nos últimos 4 meses">
                                  📊 {item.vendasMensais} un/mês (4m)
                                </span>
                              )}
                              {(item.estoqueTotal ?? 0) > 0 && (
                                <span className="text-[9px] font-sans font-bold text-teal-700 bg-teal-50 px-1.5 py-0.5 border border-teal-200 rounded-none inline-flex items-center gap-0.5">
                                  📦 {item.estoqueTotal} cx
                                </span>
                              )}
                            </div>
                          )}
                          {item.isRupturaSubstitution && item.originalRupturaEan && (
                            <div className="mt-1.5 p-2 bg-yellow-50 border border-yellow-400 rounded-sm">
                              <div className="flex items-center gap-1 text-[10px] font-black text-yellow-800 mb-1">
                                <AlertTriangle className="w-3 h-3 text-yellow-600" />
                                PRODUTO ORIGINAL EM FALTA:
                              </div>
                              <div className="text-[10px] text-yellow-900 font-bold">{item.originalRupturaDescricao}</div>
                              <div className="text-[9px] text-yellow-700 font-mono mt-0.5">
                                EAN: {item.originalRupturaEan} | Lab: {item.originalRupturaLaboratorio} | Preço: R$ {item.originalRupturaPreco?.toFixed(2)}
                              </div>
                            </div>
                          )}
                          <ObservationBell ean={item.isRupturaSubstitution ? item.novoEan : item.originalEan} origem={item.origem} />
                        </div>
                      </td>

                      {/* Replacement Product */}
                      <td className={`py-2.5 px-3 border-r border-[#141414]/10 font-bold ${item.isRupturaSubstitution ? 'bg-red-50' : ''}`}>
                        <div>
                          <p className={`line-clamp-2 ${item.isRupturaSubstitution ? 'text-red-900 font-black' : isAccepted ? "text-emerald-950" : "text-gray-500 line-through font-normal"}`}>
                            {item.novaDescricao}
                            {((item.novoLaboratorio || item.originalLaboratorio) || "").trim() && (
                              <>
                                <span> - </span>
                                <span className="font-normal text-gray-500">
                                  {getLabAbbrev(item.novoLaboratorio || item.originalLaboratorio || "GENÉRICO")}
                                </span>
                              </>
                            )}
                          </p>
                          {item.qtdMin && item.qtdMin > 0 && (
                            <span className="inline-block text-[9px] font-black text-yellow-800 bg-yellow-200 border border-yellow-400 px-1.5 py-0.5 rounded-sm mt-0.5">
                              MÍN: {item.qtdMin} un
                            </span>
                          )}
                          <div className="text-[10px] text-gray-400 mt-0.5 font-normal flex flex-wrap items-center">
                            EAN: {item.novoEan} <EanEyeButton ean={item.novoEan} descricao={item.novaDescricao} laboratorio={item.novoLaboratorio || item.originalLaboratorio} qtd={item.qtd || 1} /><EanPromoButton ean={item.novoEan} descricao={item.novaDescricao} />
                            {item.alternatives && item.alternatives.length > 0 && (
                              <button
                                onClick={(e) => {
                                  e.stopPropagation();
                                  e.preventDefault();
                                  setInterchangeableItem(item);
                                }}
                                className="inline-flex items-center justify-center p-1 bg-blue-50 hover:bg-blue-600 border border-blue-300 hover:border-blue-700 text-blue-700 hover:text-white rounded-none ml-1 transition-colors cursor-pointer shrink-0"
                                title="Ver todas as condições e intercambialidade (Similares, Genéricos, Éticos)"
                              >
                                <Layers className="w-3.5 h-3.5" />
                              </button>
                            )}
                            <span className="mx-1">|</span> Unit: <span className={item.isRupturaSubstitution ? "text-red-700 font-bold ml-1" : isAccepted ? "text-emerald-700 font-bold ml-1" : "text-gray-400 ml-1"}>{formatCurrency(item.novoPreco)}</span>
                          </div>
                          {item.isRupturaSubstitution ? (
                            <div className="mt-1 flex items-start gap-1 text-[9.5px] text-red-700 bg-red-100 p-1.5 rounded-sm border border-red-400 font-bold">
                              <AlertTriangle className="w-3 h-3 shrink-0 mt-0.5 text-red-600" />
                              <span>🔴 RUPTURA: Produto original sem estoque. Substituto promovido como original.</span>
                            </div>
                          ) : item.originalSemEstoque ? (
                            <div className="mt-1 flex items-start gap-1 text-[9.5px] text-red-700 bg-red-50 p-1.5 rounded-sm border border-red-300 font-bold">
                              <AlertTriangle className="w-3 h-3 shrink-0 mt-0.5 text-red-600" />
                              <span>🚨 MOTIVO DA TROCA (RUPTURA): Produto original sem estoque em nenhum fornecedor. Substituto sugerido para evitar falta.</span>
                            </div>
                          ) : item.novoPreco < item.originalPreco ? (
                            <div className="mt-1 flex items-start gap-1 text-[9.5px] text-emerald-800 bg-emerald-50 p-1.5 rounded-sm border border-emerald-300 font-bold">
                              <ArrowDownRight className="w-3 h-3 shrink-0 mt-0.5 text-emerald-600" />
                              <span>💰 MOTIVO DA TROCA (ECONOMIA): Substituto mais barato (Economia de {formatCurrency(item.originalPreco - item.novoPreco)}/un) mantendo o mesmo princípio ativo.</span>
                            </div>
                          ) : item.novoEan === item.originalEan ? (
                            <div className="mt-1 flex items-start gap-1 text-[9.5px] text-blue-800 bg-blue-50 p-1.5 rounded-sm border border-blue-300 font-bold">
                              <CheckCircle className="w-3 h-3 shrink-0 mt-0.5 text-blue-600" />
                              <span>✅ MANTIDO: Mesmo produto na melhor distribuidora disponível com estoque.</span>
                            </div>
                          ) : (
                            <div className="mt-1 flex items-start gap-1 text-[9.5px] text-indigo-800 bg-indigo-50 p-1.5 rounded-sm border border-indigo-300 font-bold">
                              <Sparkles className="w-3 h-3 shrink-0 mt-0.5 text-indigo-600" />
                              <span>💡 MOTIVO DA TROCA: Substituto com estoque disponível no mercado.</span>
                            </div>
                          )}
                          {item.observacao && (
                            <div className="mt-1 flex items-start gap-1 text-[10px] text-amber-700 bg-amber-50 p-1 rounded-sm border border-amber-200">
                              <AlertTriangle className="w-3 h-3 shrink-0 mt-0.5" />
                              <span>{stripHtml(item.observacao)}</span>
                            </div>
                          )}
                          <ObservationBell ean={item.novoEan} origem={item.origem} />
                        </div>
                      </td>

                      {/* Qty */}
                      <td className="py-2.5 px-3 border-r border-[#141414]/10 text-center font-bold text-gray-800">
                        {item.qtd}
                      </td>

                      {/* Unit. Savings */}
                      <td className="py-2.5 px-3 border-r border-[#141414]/10 text-right font-bold text-gray-800">
                        <span className={isAccepted ? "text-emerald-700" : "text-gray-400 line-through"}>
                          {formatCurrency(unitSavings)}
                        </span>
                      </td>

                      {/* Total Savings */}
                      <td className="py-2.5 px-3 border-r border-[#141414]/10 text-right font-black">
                        <span className={isAccepted ? "text-emerald-700" : "text-gray-400 line-through"}>
                          {formatCurrency(lineSavings)}
                        </span>
                      </td>

                      {/* Action buttons */}
                      <td className="py-2 px-3 text-center">
                        <div className="flex items-center justify-center space-x-1">
                          <button
                            onClick={() => {
                              if (isAccepted) onToggleDisregard(item.codInterno);
                            }}
                            className={`text-[9px] uppercase font-black px-2 py-1 rounded-none border transition-all cursor-pointer ${
                              !isAccepted 
                                ? "bg-[#141414] text-[#E4E3E0] border-[#141414]" 
                                : "bg-[#E4E3E0] hover:bg-white text-gray-700 border-gray-300"
                            }`}
                          >
                            Manter Original
                          </button>
                          <button
                            onClick={() => {
                              if (!isAccepted) onToggleDisregard(item.codInterno);
                            }}
                            className={`text-[9px] uppercase font-black px-2 py-1 rounded-none border transition-all cursor-pointer ${
                              isAccepted 
                                ? "bg-emerald-700 text-white border-emerald-700" 
                                : "bg-emerald-600 hover:bg-emerald-700 text-white border-emerald-600"
                            }`}
                          >
                            Aceitar Troca
                          </button>
                          <button
                            onClick={() => onToggleDisabled(item.codInterno)}
                            title="Excluir item (não pedir nem original nem substituto)"
                            className="p-1 ml-1 text-red-500 hover:bg-red-50 hover:text-red-700 border border-transparent hover:border-red-200 transition-colors cursor-pointer"
                          >
                            <Trash2 className="w-3.5 h-3.5" />
                          </button>
                        </div>

                        {/* Seletor de Condição de Compra / Substituição de Laboratório */}
                        {(() => {
                          const altsCount = item.alternatives?.length ?? 0;
                          console.log(`[SWAPS-TABLE] RENDER EAN=${item.originalEan || item.novoEan} "${(item.originalDescricao || "").substring(0, 30)}" codInterno=${item.codInterno} | alternatives=${altsCount} | novoEan=${item.novoEan} | config=${!!config}`);
                          return null;
                        })()}
                        <ConditionSelector item={item} onSelectCondition={onSelectCondition} compact config={config ? { token: config.token, cnpj: config.cnpj, useTestUrl: config.useTestUrl } : undefined} />
                      </td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </div>
        </div>
      )}

      {/* Banners de Direcionamento WhatsApp por Regra */}
      {config?.direcionarEurofarmaWhatsapp !== false && activeWhatsAppRules.map(rule => {
        const matchedItems = ruleMatchesMap.get(rule.id) || [];
        if (matchedItems.length === 0) return null;
        return (
          <div key={rule.id} className="bg-emerald-700 text-white border-2 border-emerald-900 p-4 mb-4 shadow-md flex flex-col sm:flex-row sm:items-center sm:justify-between gap-3">
            <div className="flex items-center space-x-3">
              <div className="p-2 bg-emerald-800 border border-emerald-500/50 rounded-none shrink-0">
                <MessageSquare className="w-5 h-5 text-emerald-200" />
              </div>
              <div>
                <div className="text-xs font-black uppercase tracking-wider flex items-center gap-2">
                  <span>💬 Parametrização Ativa: Pedido WhatsApp ({rule.nomeRegra})</span>
                  <span className="bg-emerald-900 text-emerald-200 text-[9px] px-2 py-0.5 border border-emerald-500/50">
                    {matchedItems.length} {matchedItems.length === 1 ? 'item' : 'itens'}
                  </span>
                </div>
                <p className="text-[11px] text-emerald-100/90 font-sans mt-0.5">
                  Itens com o termo "{rule.termoFiltro}" estão direcionados para pedido via WhatsApp ao vendedor {rule.nomeRepresentante || "cadastrado"}.
                </p>
              </div>
            </div>
            <button
              onClick={() => {
                setSelectedWhatsAppRule(rule);
                setIsWhatsAppModalOpen(true);
              }}
              className="bg-white hover:bg-emerald-50 text-emerald-900 text-xs font-black uppercase tracking-wider px-4 py-2 border-2 border-emerald-900 shadow-sm cursor-pointer shrink-0 transition-all flex items-center justify-center gap-2"
            >
              <MessageSquare className="w-4 h-4 text-emerald-700" />
              <span>Gerar Pedido WhatsApp ({rule.nomeRegra})</span>
            </button>
          </div>
        );
      })}

      {/* 2. ORDER LIST - GROUPED BY DISTRIBUTOR WITH PDF LAYOUT */}
      <div className="bg-[#DCDAD7] border border-[#141414] p-5 rounded-none shadow-sm text-[#141414]">
        
        {/* Table controls */}
        <div className="flex flex-col sm:flex-row sm:items-center sm:justify-between pb-4 border-b border-[#141414]/10 gap-4 mb-6">
          <div>
            <h3 className="font-serif italic text-base font-bold text-[#141414]">
              Relação de Itens Ativos Separados por Distribuidora
            </h3>
            <p className="text-[10px] text-gray-500 uppercase tracking-widest font-mono mt-0.5">
              Revise as quantidades e fature cada distribuidora separadamente em conformidade com o faturamento mínimo.
            </p>
          </div>

          <div className="flex flex-wrap items-center gap-3">
            <button
              onClick={() => onSendBilling("")}
              disabled={isBillingLoading}
              className="flex items-center space-x-1.5 bg-emerald-700 hover:bg-emerald-800 disabled:opacity-50 text-white font-extrabold text-[10px] uppercase tracking-wider py-2 px-3.5 border border-emerald-700 cursor-pointer shadow-xs rounded-none transition-all"
            >
              {isBillingLoading ? (
                <>
                  <RefreshCw className="w-3.5 h-3.5 animate-spin mr-1" />
                  <span>Faturando...</span>
                </>
              ) : (
                <>
                  <Truck className="w-3.5 h-3.5" />
                  <span>⚡ Enviar Todos os Pedidos Juntos</span>
                </>
              )}
            </button>

            {/* Filter buttons */}
            <div className="bg-[#141414]/10 p-0.5 flex space-x-1 border border-[#141414]/10">
              <button
                onClick={() => setFilterType("all")}
                className={`px-3 py-1 text-[9px] uppercase font-bold tracking-wider rounded-none transition-all cursor-pointer ${
                  filterType === "all" ? "bg-[#141414] text-[#E4E3E0]" : "text-[#141414] hover:bg-[#141414]/10"
                }`}
              >
                Todos ({report.length})
              </button>
              <button
                onClick={() => setFilterType("swapped")}
                className={`px-3 py-1 text-[9px] uppercase font-bold tracking-wider rounded-none transition-all cursor-pointer ${
                  filterType === "swapped" ? "bg-[#141414] text-[#E4E3E0]" : "text-[#141414] hover:bg-[#141414]/10"
                }`}
              >
                Otimizados ({report.filter(i => i.originalEan !== i.novoEan && !disregardedCodes.has(i.codInterno)).length})
              </button>
              <button
                onClick={() => setFilterType("original")}
                className={`px-3 py-1 text-[9px] uppercase font-bold tracking-wider rounded-none transition-all cursor-pointer ${
                  filterType === "original" ? "bg-[#141414] text-[#E4E3E0]" : "text-[#141414] hover:bg-[#141414]/10"
                }`}
              >
                Originais/Revertidos ({report.filter(i => i.originalEan === i.novoEan || disregardedCodes.has(i.codInterno)).length})
              </button>
            </div>

            {/* Botão de Filtro de Alertas / Pendências */}
            <button
              onClick={() => setShowOnlyAlerts(!showOnlyAlerts)}
              className={`px-3 py-1.5 text-[9px] uppercase font-black tracking-wider rounded-none transition-all cursor-pointer flex items-center gap-1.5 border-2 ${
                showOnlyAlerts 
                  ? "bg-amber-500 hover:bg-amber-600 text-[#141414] border-[#141414] shadow-[2px_2px_0px_0px_rgba(20,20,20,1)]" 
                  : "bg-amber-50 hover:bg-amber-100 text-amber-950 border-amber-300 shadow-xs"
              }`}
              title="Filtrar e mostrar na tela somente produtos com alguma pendência, observação, preço aumentado ou faturamento mínimo do grupo não atingido"
            >
              <AlertTriangle className={`w-3.5 h-3.5 ${showOnlyAlerts ? "animate-bounce text-amber-950" : "text-amber-600"}`} />
              <span>Apenas Alertas/Pendências ({alertItemsCount})</span>
            </button>

            {/* Botões de Pedidos WhatsApp por Regra / Representante */}
            {activeWhatsAppRules.map(rule => {
              const matchedItems = ruleMatchesMap.get(rule.id) || [];
              if (matchedItems.length === 0) return null;
              return (
                <button
                  key={rule.id}
                  onClick={() => {
                    setSelectedWhatsAppRule(rule);
                    setIsWhatsAppModalOpen(true);
                  }}
                  className="px-3 py-1.5 text-[9px] uppercase font-black tracking-wider rounded-none transition-all cursor-pointer flex items-center gap-1.5 border-2 bg-emerald-600 hover:bg-emerald-700 text-white border-emerald-800 shadow-[2px_2px_0px_0px_rgba(20,20,20,1)]"
                  title={`Montar e gerar pedido formatado para envio direto via WhatsApp ao representante (${rule.nomeRepresentante || rule.nomeRegra})`}
                >
                  <MessageSquare className="w-3.5 h-3.5 text-emerald-200" />
                  <span>📱 Pedido WhatsApp {rule.nomeRegra} ({matchedItems.length})</span>
                </button>
              );
            })}

            {/* High-value threshold indicator controls */}
            <div className="flex items-center gap-1.5 bg-rose-50 border border-rose-300 px-2 py-1 text-[10px] font-black text-rose-950 shadow-xs">
              <span className="shrink-0 flex items-center gap-1.5">
                <span className="relative flex h-2 w-2">
                  <span className="animate-ping absolute inline-flex h-full w-full rounded-full bg-rose-400 opacity-75"></span>
                  <span className="relative inline-flex rounded-full h-2 w-2 bg-rose-600"></span>
                </span>
                ALERTA TOTAL ITEM &gt; R$:
              </span>
              <input
                type="number"
                value={highValueThreshold}
                min="0"
                step="5"
                onChange={(e) => handleThresholdChange(parseFloat(e.target.value) || 0)}
                className="w-14 bg-white border border-[#141414] px-1 py-0.5 text-[10px] text-center font-bold text-[#141414] focus:outline-none focus:ring-1 focus:ring-rose-500"
                title="Valores totais da linha de produto (Preço * Qtd) acima deste limite irão piscar em vermelho para evitar erros de fracionamento ou digitação excessiva"
              />
            </div>

            {/* Search input */}
            <div className="flex items-center gap-2 max-w-xs w-full">
              <button
                type="button"
                onClick={() => {
                  setIsTrackerOpen(!isTrackerOpen);
                  if (!isTrackerOpen) {
                    setTrackerQuery(searchTerm);
                  }
                }}
                className={`px-3 py-1.5 text-[9px] uppercase font-extrabold tracking-wider border border-[#141414] transition-all cursor-pointer flex items-center space-x-1 whitespace-nowrap rounded-none ${
                  isTrackerOpen
                    ? "bg-indigo-600 text-[#E4E3E0] border-indigo-600"
                    : "bg-white text-[#141414] hover:bg-gray-100"
                }`}
                title="Localizar EAN / Código em todo o lote"
              >
                <span>🔍 Localizar EAN</span>
              </button>

              <div className="relative flex-1">
                <span className="absolute inset-y-0 left-0 pl-2.5 flex items-center text-gray-500">
                  <Search className="w-3.5 h-3.5" />
                </span>
                <input
                  type="text"
                  placeholder="Buscar item na tabela..."
                  value={searchTerm}
                  onChange={(e) => setSearchTerm(e.target.value)}
                  className="w-full pl-8 pr-3 py-1.5 border border-[#141414] bg-white text-[10px] font-mono font-bold text-[#141414] focus:outline-none"
                />
              </div>
            </div>
          </div>
        </div>

        {/* Rastreador e Diagnóstico de EANs */}
        {isTrackerOpen && (
          <div className="bg-[#E4E3E0] border border-[#141414] p-4 mb-6 shadow-sm">
            <div className="flex items-center justify-between border-b border-[#141414]/10 pb-2 mb-3">
              <div className="flex items-center space-x-2">
                <span className="text-xs">🔍</span>
                <h4 className="font-serif italic font-bold text-xs text-[#141414] uppercase tracking-wider">
                  Rastreador e Diagnóstico de EAN ou Código no Lote Inteiro
                </h4>
              </div>
              <button
                type="button"
                onClick={() => {
                  setIsTrackerOpen(false);
                  setTrackerQuery("");
                }}
                className="text-[#141414] hover:text-red-600 p-1 transition-colors cursor-pointer"
                title="Fechar rastreador"
              >
                <X className="w-3.5 h-3.5" />
              </button>
            </div>
            
            <p className="text-[9px] text-gray-500 font-mono uppercase tracking-wider mb-3">
              Insira o EAN (ex: 7896004706559) ou código interno para ver se foi excluído (lixeira), revertido, ou qual produto original ele substituiu.
            </p>

            <div className="flex gap-2 max-w-md mb-4">
              <input
                type="text"
                placeholder="EAN ou Código do Produto..."
                value={trackerQuery}
                onChange={(e) => setTrackerQuery(e.target.value)}
                className="flex-1 px-3 py-1.5 border border-[#141414] bg-white text-xs font-mono font-bold text-[#141414] focus:outline-none"
              />
              {trackerQuery && (
                <button
                  type="button"
                  onClick={() => setTrackerQuery("")}
                  className="px-3 py-1 border border-[#141414] bg-gray-200 text-xs font-bold hover:bg-gray-300 transition-colors cursor-pointer rounded-none"
                >
                  Limpar
                </button>
              )}
            </div>

            {trackerQuery && (
              <div className="space-y-3">
                {trackerResults.length === 0 ? (
                  <div className="bg-white border border-dashed border-[#141414]/30 p-4 text-center text-xs text-gray-500 font-mono">
                    Nenhum item correspondente a "{trackerQuery}" foi localizado no lote carregado.
                  </div>
                ) : (
                  <div className="max-h-80 overflow-y-auto space-y-3 pr-1">
                    <div className="text-[9px] uppercase tracking-wider font-bold text-gray-500 mb-1">
                      Encontrado(s) {trackerResults.length} item(ns) no lote original:
                    </div>
                    {trackerResults.map((item, idx) => {
                      const isExcluded = disabledItemCodes.has(item.codInterno);
                      const isReverted = disregardedCodes.has(item.codInterno);
                      const isBilled = billedItemCodes.has(item.codInterno);
                      const isSwapped = item.originalEan !== item.novoEan;
                      
                      let statusLabel = "Ativo no Lote";
                      let statusBg = "bg-green-100 text-green-800 border-green-300";
                      let statusDesc = "";

                      if (isBilled) {
                        statusLabel = "Faturado / Transmitido";
                        statusBg = "bg-blue-100 text-blue-800 border-blue-300";
                        statusDesc = "Este produto já foi enviado para faturamento ou transmitido à distribuidora. Ele foi ocultado da lista de itens pendentes por já ter sido processado.";
                      } else if (isExcluded) {
                        statusLabel = "Excluído / Removido";
                        statusBg = "bg-red-100 text-red-800 border-red-300";
                        statusDesc = "Este produto foi removido do lote (lixeira) e está desconsiderado do faturamento e cálculos de economia.";
                      } else if (isReverted) {
                        statusLabel = "Revertido para o Original";
                        statusBg = "bg-orange-100 text-orange-800 border-orange-300";
                        statusDesc = "Você desconsiderou a sugestão de troca. Ele será comprado no código/EAN original.";
                      } else if (isSwapped) {
                        statusLabel = "Otimizado / Substituído";
                        statusBg = "bg-indigo-100 text-indigo-800 border-indigo-300";
                        statusDesc = `Otimizado com sucesso! Foi substituído por um genérico/similar gerando economia.`;
                      } else {
                        statusLabel = "Original Mantido";
                        statusBg = "bg-gray-100 text-gray-800 border-gray-300";
                        statusDesc = "O item foi mantido com o código original porque não houve alternativa melhor ou elegível.";
                      }

                      return (
                        <div key={idx} className="bg-white border border-[#141414]/30 p-3 shadow-xs text-[#141414]">
                          <div className="flex flex-wrap items-center justify-between gap-2 border-b border-gray-100 pb-2 mb-2">
                            <div className="flex items-center space-x-2">
                              <span className="font-mono text-xs font-bold text-indigo-600">
                                Cód. Interno: {item.codInterno}
                              </span>
                              <span className={`text-[9px] font-bold uppercase tracking-wider px-2 py-0.5 border ${statusBg}`}>
                                {statusLabel}
                              </span>
                            </div>
                            
                            <div className="flex items-center space-x-2 text-[10px] font-mono">
                              <span>Distribuidora:</span>
                              <strong className="text-gray-900 bg-gray-100 px-1.5 py-0.5 border border-gray-200">
                                {item.distribuidora || "Não Encontrados"}
                              </strong>
                            </div>
                          </div>

                          <p className="text-[10px] text-gray-500 font-serif italic mb-2">
                            {statusDesc}
                          </p>

                          {item.originalSemEstoque ? (
                            <div className="mb-2 p-2 bg-red-600 text-white border border-red-800 text-[10px] font-bold flex items-center gap-2 shadow-sm">
                              <span className="bg-white text-red-700 px-1.5 py-0.5 rounded-none font-black text-[9px] uppercase">🚨 MOTIVO DA TROCA (RUPTURA)</span>
                              <span>Produto original ({item.originalLaboratorio || "Lab Original"}) sem estoque em todas as distribuidoras. Substituto sugerido para evitar falta.</span>
                            </div>
                          ) : item.novoPreco < item.originalPreco ? (
                            <div className="mb-2 p-2 bg-emerald-700 text-white border border-emerald-900 text-[10px] font-bold flex items-center gap-2 shadow-sm">
                              <span className="bg-white text-emerald-800 px-1.5 py-0.5 rounded-none font-black text-[9px] uppercase">💰 MOTIVO DA TROCA (ECONOMIA)</span>
                              <span>Substituto mais barato (Economia de {formatCurrency(item.originalPreco - item.novoPreco)}/un) gerando redução no custo do pedido.</span>
                            </div>
                          ) : (
                            <div className="mb-2 p-2 bg-indigo-700 text-white border border-indigo-900 text-[10px] font-bold flex items-center gap-2 shadow-sm">
                              <span className="bg-white text-indigo-800 px-1.5 py-0.5 rounded-none font-black text-[9px] uppercase">💡 MOTIVO DA TROCA (CONDIÇÃO)</span>
                              <span>Substituto sugerido por melhor condição ou prazo na distribuidora parceira.</span>
                            </div>
                          )}

                          <div className="grid grid-cols-1 md:grid-cols-2 gap-4 text-[10px] font-mono mb-2 bg-gray-50 p-2 border border-gray-200/50">
                            <div>
                              <div className="text-[8px] uppercase font-bold text-gray-400 mb-1">Dados Originais no SICF:</div>
                              <div className="font-bold text-gray-800">{item.originalDescricao}</div>
                              <div>EAN Original: {item.originalEan}</div>
                              <div>Laboratório: {item.originalLaboratorio}</div>
                              <div>Preço Original: {formatCurrency(item.originalPreco)}</div>
                            </div>

                            <div className="border-t md:border-t-0 md:border-l border-gray-200 pt-2 md:pt-0 md:pl-3">
                              <div className="text-[8px] uppercase font-bold text-gray-400 mb-1">Dados Propostos / Atual:</div>
                              <div className="font-bold text-indigo-900">{item.novaDescricao}</div>
                              <div>EAN Proposto: {item.novoEan}</div>
                              <div>Laboratório: {item.novoLaboratorio}</div>
                              <div>
                                Preço Atual: <strong>{formatCurrency(item.novoPreco)}</strong>
                              </div>
                            </div>
                          </div>

                          <div className="flex flex-wrap items-center justify-between gap-2 text-[10px] font-mono mt-1 pt-1 border-t border-gray-100">
                            <div>
                              Quantidade: <strong>{item.qtd} un</strong> | 
                              Economia Total: <strong className="text-green-600 font-bold">{formatCurrency(item.economiaTotal)}</strong>
                              {item.motivoAcao && (
                                <span className={`ml-2 px-1.5 py-0.5 text-[8px] uppercase font-bold ${
                                  item.motivoAcao === "whatsapp_regra_lab"
                                    ? "bg-emerald-100 text-emerald-800 border border-emerald-300"
                                    : item.motivoAcao === "lista_preco"
                                    ? "bg-violet-100 text-violet-800 border border-violet-300"
                                    : "bg-yellow-100 text-yellow-800"
                                }`}>
                                  {item.motivoAcao === "whatsapp_regra_lab" ? "📱 WhatsApp" 
                                    : item.motivoAcao === "lista_preco" ? `📋 Lista: ${item.fornecedorLista || item.distribuidora}` 
                                    : item.motivoAcao}
                                </span>
                              )}
                            </div>

                            <div className="flex space-x-1.5">
                              {isBilled ? (
                                <span className="px-2 py-0.5 bg-blue-100 text-blue-800 border border-blue-300 text-[8px] font-black uppercase tracking-wider select-none">
                                  ✓ Enviado para Faturamento
                                </span>
                              ) : isExcluded ? (
                                <button
                                  type="button"
                                  onClick={() => onToggleDisabled(item.codInterno)}
                                  className="px-2 py-0.5 bg-green-600 hover:bg-green-700 text-white text-[8px] uppercase font-extrabold tracking-wider transition-colors cursor-pointer rounded-none"
                                >
                                  Restaurar Item
                                </button>
                              ) : (
                                <>
                                  <button
                                    type="button"
                                    onClick={() => onToggleDisabled(item.codInterno)}
                                    className="px-2 py-0.5 bg-red-600 hover:bg-red-700 text-white text-[8px] uppercase font-extrabold tracking-wider transition-colors cursor-pointer rounded-none"
                                    title="Remover este item do lote"
                                  >
                                    Excluir
                                  </button>
                                  
                                  {isSwapped && (
                                    <button
                                      type="button"
                                      onClick={() => onToggleDisregard(item.codInterno)}
                                      className={`px-2 py-0.5 text-white text-[8px] uppercase font-extrabold tracking-wider transition-colors cursor-pointer rounded-none ${
                                        isReverted 
                                          ? "bg-indigo-600 hover:bg-indigo-700" 
                                          : "bg-amber-600 hover:bg-amber-700"
                                      }`}
                                    >
                                      {isReverted ? "Re-aplicar Otimização" : "Reverter p/ Original"}
                                    </button>
                                  )}
                                </>
                              )}
                            </div>
                          </div>
                        </div>
                      );
                    })}
                  </div>
                )}
              </div>
            )}
          </div>
        )}

        {groups.length > 0 ? (
          <div className="space-y-8">
            {/* Info banner about Minimum Orders */}
            <div className="p-4 bg-amber-50/80 border border-amber-300 text-amber-950 text-xs rounded-none flex items-start gap-2.5 shadow-xs mb-2">
              <span className="text-sm mt-0.5">💡</span>
              <div>
                <p className="font-black text-[10px] uppercase tracking-wider text-amber-950">Atenção às Condições de Faturamento (Pedido Mínimo)</p>
                <p className="mt-0.5 text-gray-700 leading-relaxed text-[11px]">
                  Os valores de <strong>Pedido Mínimo</strong> configurados abaixo representam o limite financeiro sugerido (R$). No entanto, algumas condições comerciais das distribuidoras exigem um <strong>mínimo por QUANTIDADE física de caixas/unidades</strong> (ex: "Mínimo 5 un", "Mínimo 10 un").
                </p>
                <p className="mt-1 text-gray-600 text-[10px] italic">
                  <strong>Dica de Uso:</strong> Observe o total de unidades acumuladas <span className="font-bold">(ex: "Total: R$ 350,00 (25 un)")</span> exibido no cabeçalho de cada grupo para validar as exigências de quantidades da sua promoção antes de enviar!
                </p>
              </div>
            </div>

            {groups.map((group, gIdx) => {
              const minVal = distributorMinimums[group.name] !== undefined ? distributorMinimums[group.name] : group.pedidoMinimo;
              const isMet = group.totalValue >= minVal;
              const diff = minVal - group.totalValue;
              const isVirtual = group.name === "Não Encontrados" || group.name === "Sem Estoque";
              const isNaoEncontrados = group.name === "Não Encontrados";
              const isSemEstoque = group.name === "Sem Estoque";
              const hasShortages = group.items.some(item => item.isShortage);

              let containerBg = "bg-[#E4E3E0] border-[#141414]";
              let headerBg = "bg-[#141414] text-[#E4E3E0] border-[#141414]";
              let headerBadge = "bg-[#E4E3E0] text-[#141414]";
              let tableHeaderBg = "bg-[#DCDAD7] text-[#141414] border-[#141414]/35";
              let tableRowBg = "bg-white hover:bg-slate-50 border-[#141414]/15";
              let tableRowText = "text-gray-800";

              const isExpanded = expandedGroups[group.name] ?? false;
              const billedStatus = billedGroups[group.name]?.status;
              const isExternalManual = group.condicao === "MANUAL" || group.items.some(it => it.codDist === 9999 || it.origem === "lista_preco" || it.motivoAcao === "lista_preco");

              if (billedStatus === "faturando") {
                containerBg = "bg-yellow-50 border-yellow-900";
                headerBg = "bg-yellow-500 text-yellow-950 border-yellow-600 hover:bg-yellow-600 animate-pulse";
                headerBadge = "bg-yellow-950 text-yellow-100";
                tableHeaderBg = "bg-yellow-200 text-yellow-950 border-yellow-300";
                tableRowBg = "bg-yellow-50 hover:bg-yellow-100 border-yellow-200";
                tableRowText = "text-yellow-950";
              } else if (billedStatus === "retornado") {
                containerBg = "bg-orange-50 border-orange-900";
                headerBg = "bg-orange-600 text-orange-50 border-orange-700 hover:bg-orange-700";
                headerBadge = "bg-orange-100 text-orange-950";
                tableHeaderBg = "bg-orange-200 text-orange-950 border-orange-300";
                tableRowBg = "bg-orange-50 hover:bg-orange-100 border-orange-200";
                tableRowText = "text-orange-950";
              } else if (isExternalManual) {
                containerBg = "bg-[#ECFDF5] border-[#10B981]";
                headerBg = "bg-[#10B981] text-white border-[#10B981] hover:bg-[#059669]";
                headerBadge = "bg-[#D1FAE5] text-[#065F46]";
                tableHeaderBg = "bg-[#A7F3D0] text-[#065F46] border-[#10B981]/30";
                tableRowBg = "bg-white hover:bg-[#F0FDF4] border-[#10B981]/20";
                tableRowText = "text-[#065F46]";
              } else if (isVirtual) {
                containerBg = "bg-rose-50 border-rose-900";
                headerBg = "bg-rose-900 text-rose-50 border-rose-950 hover:bg-rose-950";
                headerBadge = "bg-rose-100 text-rose-950";
                tableHeaderBg = "bg-rose-200 text-rose-950 border-rose-300";
                tableRowBg = "bg-rose-50 hover:bg-rose-100 border-rose-200";
                tableRowText = "text-rose-950";
              } else if (hasShortages) {
                containerBg = "bg-amber-50 border-amber-900";
                headerBg = "bg-amber-500 text-amber-950 border-amber-600 hover:bg-amber-600";
                headerBadge = "bg-amber-950 text-amber-100";
                tableHeaderBg = "bg-amber-200 text-amber-950 border-amber-300";
                tableRowBg = "bg-amber-50 hover:bg-amber-100 border-amber-200";
                tableRowText = "text-amber-950";
              } else if (isMet) {
                containerBg = "bg-emerald-50 border-emerald-900";
                headerBg = "bg-emerald-900 text-emerald-50 border-emerald-950 hover:bg-emerald-950";
                headerBadge = "bg-emerald-100 text-emerald-950";
                tableHeaderBg = "bg-emerald-200 text-emerald-950 border-emerald-300";
                tableRowBg = "bg-emerald-50 hover:bg-emerald-100 border-emerald-200";
                tableRowText = "text-emerald-950";
              } else {
                containerBg = "bg-amber-50 border-amber-900";
                headerBg = "bg-amber-600 text-[#141414] border-amber-700 hover:bg-amber-700";
                headerBadge = "bg-[#141414] text-amber-50";
                tableHeaderBg = "bg-amber-200 text-amber-950 border-amber-300";
                tableRowBg = "bg-amber-50 hover:bg-amber-100 border-amber-200";
                tableRowText = "text-amber-950";
              }

              return (
                <div key={gIdx} id={`group-header-${gIdx}`} className={`border shadow-sm rounded-none overflow-hidden transition-all ${containerBg}`}>
                  
                  {/* Distributor PDF block Header */}
                  <div 
                    className={`px-4 py-3.5 flex flex-col md:flex-row md:items-center md:justify-between border-b gap-3 transition-colors cursor-pointer select-none ${headerBg}`}
                    onClick={() => toggleGroup(group.name)}
                  >
                    <div className="flex flex-wrap items-center gap-x-3 gap-y-1.5 font-mono text-xs">
                      <div className="flex items-center gap-2">
                        {isExpanded ? <ChevronRight className="w-4 h-4 rotate-90 transition-transform" /> : <ChevronRight className="w-4 h-4 transition-transform" />}
                        <span className={`font-black uppercase px-2 py-0.5 tracking-wider font-sans text-[11px] ${headerBadge}`}>
                          {group.distribuidora}
                        </span>
                        {group.condicao && (
                          <span className="text-[10px] font-mono px-1.5 py-0.5 bg-black/15 text-current rounded font-bold">
                            Cond: {group.condicao}
                          </span>
                        )}
                        {group.prazo !== undefined && (
                          <span className="text-[10px] font-mono px-1.5 py-0.5 bg-black/15 text-current rounded font-bold">
                            Prazo: {group.prazo}d
                          </span>
                        )}
                      </div>
                      <span className={isMet || isVirtual ? "text-white/60" : "text-[#141414]/60"}>|</span>
                      <span>Itens Ativos: <strong>{group.activeCount}</strong></span>
                      <span className={isMet || isVirtual ? "text-white/60" : "text-[#141414]/60"}>|</span>
                      <span>
                        Total Pedido: <strong className={isMet || isVirtual ? "text-white font-bold" : "text-[#141414] font-bold"}>{formatCurrency(group.totalValue)}</strong>{" "}
                        <span className={isMet || isVirtual ? "text-white/85 font-semibold font-sans text-[10px] bg-white/10 px-1.5 py-0.5 border border-white/10 ml-1" : "text-[#141414]/85 font-semibold font-sans text-[10px] bg-[#141414]/5 px-1.5 py-0.5 border border-[#141414]/10 ml-1"}>
                          ({group.items.reduce((acc, item) => acc + (disabledItemCodes.has(item.codInterno) ? 0 : item.qtd), 0)} un)
                        </span>
                      </span>

                      {(() => {
                        const groupQtdMinima = group.items.reduce((max, item) => Math.max(max, item.qtdMinima || 0), 0);
                        const groupCurrentQtd = group.items.reduce((acc, item) => acc + (disabledItemCodes.has(item.codInterno) ? 0 : item.qtd), 0);
                        const isQtdMinimaMet = groupCurrentQtd >= groupQtdMinima;
                        
                        if (groupQtdMinima > 0) {
                          return (
                            <>
                              <span className={isMet || isVirtual ? "text-white/60" : "text-[#141414]/60"}>|</span>
                              <span className={`inline-flex items-center gap-1 px-1.5 py-0.5 text-[10px] uppercase font-black tracking-wider ${
                                isQtdMinimaMet 
                                  ? "bg-emerald-100 text-emerald-950 border border-emerald-400" 
                                  : "bg-rose-100 text-rose-950 border border-rose-400 animate-pulse"
                              }`}>
                                Lote Mínimo: {groupQtdMinima} un {isQtdMinimaMet ? "(Atingido)" : `(Falta ${groupQtdMinima - groupCurrentQtd} un)`}
                              </span>
                            </>
                          );
                        }
                        return null;
                      })()}
                      
                      {!isVirtual && (
                        <>
                          <span className={isMet ? "text-white/60" : "text-[#141414]/60"}>|</span>
                          <span className="flex items-center gap-1" onClick={(e) => e.stopPropagation()}>
                            Min: 
                            <span className={isMet ? "text-white/60" : "text-[#141414]/60"}>R$</span>
                            <input
                              type="number"
                              value={minVal}
                              onChange={(e) => {
                                const val = Math.max(0, parseFloat(e.target.value) || 0);
                                onUpdateMinimum(group.name, val);
                              }}
                              className="w-14 bg-zinc-800 border border-zinc-700 text-white font-mono text-[11px] px-1 py-0.5 text-center focus:outline-none focus:border-white"
                            />
                          </span>
                        </>
                      )}
                    </div>

                    <div className="flex flex-wrap items-center gap-2" onClick={(e) => e.stopPropagation()}>
                      {isExternalManual ? (
                        <>
                          <span className="bg-emerald-200/80 text-emerald-950 text-[9px] font-black uppercase tracking-widest px-2.5 py-1 border border-emerald-500 rounded-none flex items-center gap-1">
                            <MessageSquare className="w-3 h-3 text-[#059669]" /> WHATSAPP
                          </span>
                          <button
                            onClick={() => {
                              const activeGroupItems = group.items.filter((it: any) => !disabledItemCodes.has(it.codInterno));
                              if (activeGroupItems.length === 0) {
                                alert("Nenhum item ativo neste pedido para copiar.");
                                return;
                              }
                              const today = new Date().toLocaleDateString("pt-BR");
                              let text = `*PEDIDO - ${group.distribuidora}*\n`;
                              text += `Data: ${today}\n\n`;
                              text += `*Itens do Pedido:*\n`;
                              text += `----------------------------------\n`;
                              
                              activeGroupItems.forEach((item: any) => {
                                const isDisregarded = disregardedCodes.has(item.codInterno);
                                const desc = isDisregarded ? item.originalDescricao : item.novaDescricao;
                                const lab = isDisregarded ? item.originalLaboratorio : item.novoLaboratorio;
                                const preco = isDisregarded ? item.originalPreco : item.novoPreco;
                                const totalItem = preco * item.qtd;
                                
                                text += `• *${item.qtd} un* - ${desc} (${lab})\n`;
                                text += `  Preço Unit.: R$ ${preco.toFixed(2).replace(".", ",")} | Total: R$ ${totalItem.toFixed(2).replace(".", ",")}\n\n`;
                              });
                              
                              text += `----------------------------------\n`;
                              text += `*Total do Pedido: R$ ${group.totalValue.toFixed(2).replace(".", ",")}*\n`;
                              text += `_Gerado automaticamente pelo Otimizador SmartPed_`;

                              navigator.clipboard.writeText(text)
                                .then(() => {
                                  alert(`📋 Pedido copiado para a Área de Transferência com sucesso!\n\nAgora você pode abrir a conversa com o fornecedor no WhatsApp e colar (CTRL+V) para enviar o pedido!`);
                                })
                                .catch((err) => {
                                  console.error("Erro ao copiar para clipboard:", err);
                                  alert("Erro ao copiar. Copie o texto manualmente se necessário.");
                                });
                            }}
                            className="flex items-center space-x-1.5 bg-[#10B981] hover:bg-[#059669] text-white font-extrabold text-[9px] uppercase tracking-wider py-1 px-3 border border-[#10B981] cursor-pointer shadow-sm rounded-none"
                          >
                            <Copy className="w-3.5 h-3.5" />
                            <span>Copiar Pedido (WhatsApp)</span>
                          </button>
                        </>
                      ) : !isVirtual ? (
                        <>
                          {isMet ? (
                            <span className="bg-emerald-900/80 text-emerald-300 text-[9px] font-black uppercase tracking-widest px-2 py-1 border border-emerald-500 rounded-none">
                              ✓ MÍNIMO ATINGIDO
                            </span>
                          ) : (
                            <span className="bg-[#141414] text-amber-400 text-[10px] font-black uppercase tracking-widest px-3 py-1.5 border-2 border-[#141414] rounded-none shadow-sm flex items-center gap-1.5">
                              ⚠️ FALTAM {formatCurrency(diff)}
                            </span>
                          )}

                          {!isMet && billedStatus !== "retornado" && (
                            <button
                              onClick={() => onStartCompletingWizard(group.name)}
                              disabled={!!isSearchingCompleting || billedStatus === "faturando"}
                              className="flex items-center space-x-1 bg-indigo-600 hover:bg-indigo-700 disabled:opacity-50 text-white font-extrabold text-[9px] uppercase tracking-wider py-1 px-3 border border-indigo-600 cursor-pointer shadow-sm rounded-none"
                            >
                              {isSearchingCompleting === group.name ? (
                                <>
                                  <RefreshCw className="w-3 h-3 animate-spin mr-1" />
                                  <span>Buscando...</span>
                                </>
                              ) : (
                                <>
                                  <span>⚡ Completar</span>
                                </>
                              )}
                            </button>
                          )}

                          <button
                            onClick={() => onDisperseItems(group.name)}
                            disabled={isDispersing[group.name] || billedStatus === "faturando"}
                            className="flex items-center space-x-1 bg-rose-700 hover:bg-rose-800 disabled:opacity-50 text-white font-extrabold text-[9px] uppercase tracking-wider py-1 px-3 border border-rose-700 cursor-pointer shadow-sm rounded-none"
                          >
                            {isDispersing[group.name] && (
                              <RefreshCw className="w-3 h-3 animate-spin mr-1" />
                            )}
                            <span>🔄 Dispersar</span>
                          </button>
                          <button
                            onClick={() => {
                              if (billedStatus === "faturando" || billedStatus === "retornado") {
                                if (onReopenModal) onReopenModal();
                              } else {
                                onSendBilling(group.name);
                              }
                            }}
                            disabled={isBillingLoading}
                            className="flex items-center space-x-1.5 bg-emerald-600 hover:bg-emerald-700 disabled:opacity-50 text-white font-extrabold text-[9px] uppercase tracking-wider py-1 px-3 border border-emerald-600 cursor-pointer shadow-sm rounded-none"
                          >
                            {billedStatus === "faturando" ? (
                              <>
                                <RefreshCw className="w-3 h-3 animate-spin" />
                                <span>Acompanhar Faturamento...</span>
                              </>
                            ) : (
                              <>
                                <Truck className="w-3 h-3" />
                                <span>{billedStatus === "retornado" ? "Ver Retorno" : "Faturar Este Pedido"}</span>
                              </>
                            )}
                          </button>
                        </>
                      ) : null}
                      
                      {billedStatus === "retornado" && (
                        <span className="bg-orange-100 text-orange-900 text-[9px] font-black uppercase tracking-widest px-2.5 py-1 border border-orange-400">
                          ⚠️ RETORNADO COM FALTAS
                        </span>
                      )}
                      {isNaoEncontrados && (
                        <span className="bg-rose-100 text-rose-900 text-[9px] font-black uppercase tracking-widest px-2.5 py-1 border border-rose-400">
                          ⚠️ PRODUTOS NÃO ENCONTRADOS
                        </span>
                      )}
                      {isSemEstoque && (
                        <span className="bg-rose-100 text-rose-900 text-[9px] font-black uppercase tracking-widest px-2.5 py-1 border border-rose-400">
                          ⚠️ PRODUTOS SEM ESTOQUE
                        </span>
                      )}

                      <button
                        onClick={() => onDeleteDistributor(group.name)}
                        className={`p-1.5 rounded-none border transition-all cursor-pointer ${
                          isVirtual || isMet ? "bg-white/10 hover:bg-white/20 border-white/20 text-white" : "bg-[#141414]/10 hover:bg-[#141414]/20 border-[#141414]/20 text-[#141414]"
                        }`}
                        title="Remover todo o pedido desta distribuidora"
                      >
                        <Trash2 className="w-4 h-4" />
                      </button>
                    </div>
                  </div>

                  {/* Distributor PDF block Table */}
                  {isExpanded && (
                    <>
                      <div className="overflow-x-auto transition-all">
                    {isNaoEncontrados && (
                      <div className="bg-amber-50 border-b border-[#141414]/15 p-3.5 text-amber-950 text-[11px] leading-relaxed flex items-start gap-2.5">
                        <AlertTriangle className="w-4 h-4 text-amber-600 shrink-0 mt-0.5" />
                        <div>
                          <strong>💡 Produtos Não Encontrados na SmartPed:</strong> Estes produtos não retornaram ofertas comerciais da API.

                        </div>
                      </div>
                    )}
                    {isSemEstoque && (
                      <div className="bg-rose-50 border-b border-[#141414]/15 p-3.5 text-rose-950 text-[11px] leading-relaxed flex items-start gap-2.5">
                        <AlertTriangle className="w-4 h-4 text-rose-600 shrink-0 mt-0.5" />
                        <div>
                          <strong>❌ Produtos Sem Estoque:</strong> Estes produtos não possuem estoque disponível em nenhuma distribuidora retornada.

                        </div>
                      </div>
                    )}
<table className="w-full text-left border-collapse font-mono text-xs table-fixed">
                      <thead>
                        <tr className={`uppercase tracking-wider text-[9px] font-bold border-b ${tableHeaderBg}`}>
                          <th className="py-2.5 px-3 text-center w-12 border-r border-[#141414]/15">OK</th>
                          <th className="py-2.5 px-3 text-center w-12 border-r border-[#141414]/15">#</th>
                          <th className="py-2.5 px-3 border-r border-[#141414]/15 min-w-[280px]">Descrição do Item</th>
                          <th className="py-2.5 px-3 border-r border-[#141414]/15 text-center w-36">EAN</th>
                          <th className="py-2.5 px-3 border-r border-[#141414]/15 text-right w-24">Preço Base</th>
                          <th className="py-2.5 px-3 border-r border-[#141414]/15 text-right w-24">Preço Líq.</th>
                          <th className="py-2.5 px-3 border-r border-[#141414]/15 text-right w-24">Extra/Econ.</th>
                          <th className="py-2.5 px-3 border-r border-[#141414]/15 text-center w-24">Qtd.</th>
                          <th className="py-2.5 px-3 border-r border-[#141414]/15 text-right w-28">Total</th>
                          <th className="py-2.5 px-3 text-center w-40">Ação / Escolha de Troca</th>
                        </tr>
                      </thead>
                      <tbody className="divide-y divide-[#141414]/10">
                        {group.items.map((item, idx) => {
                          const isDisabled = disabledItemCodes.has(item.codInterno);
                          const isSwapped = item.originalEan !== item.novoEan;
                          const isDisregarded = disregardedCodes.has(item.codInterno);
                          const isTransferred = item.motivoAcao && (item.motivoAcao.startsWith('Dispersado') || item.motivoAcao.startsWith('Puxado'));
                          
                          const isProfarmaAlert = (item.distribuidora && String(item.distribuidora).toUpperCase() === "PROFARMA") &&
                            (profarmaRecentOrdersEans.has(cleanEanLocal(item.novoEan)) || profarmaRecentOrdersEans.has(cleanEanLocal(item.originalEan)));
                          
                          const itemQtd = item.qtd;
                          const cxAlerta = !!(item.cx && item.cx > 1 && (itemQtd % item.cx !== 0));
                          const qtdMinAlerta = !!(item.qtdMin && item.qtdMin > 0 && (itemQtd < item.qtdMin));
                          const qtdMaxAlerta = !!(item.qtdMax && item.qtdMax > 0 && (itemQtd > item.qtdMax));

                                                    
                          return (
                            <tr 
                              key={item.codInterno} 
                              className={`transition-colors border-b ${
                                isDisabled 
                                  ? "opacity-60 line-through text-gray-400 border-gray-200" 
                                  : isTransferred 
                                    ? `bg-amber-100 hover:bg-amber-200 ${tableRowText} border-amber-200`
                                    : isDisregarded 
                                      ? `bg-rose-50/20 hover:bg-rose-50/40 ${tableRowText} border-rose-200` 
                                      : `${tableRowBg} ${tableRowText}`
                              }`}
                            >
                              {/* OK / Checkbox */}
                              <td className="py-2.5 px-3 text-center border-r border-[#141414]/10">
                                <button
                                  onClick={() => onToggleDisabled(item.codInterno)}
                                  className="text-[#141414] focus:outline-none cursor-pointer inline-block"
                                >
                                  {isDisabled ? (
                                    <Square className="w-4 h-4 text-gray-400" />
                                  ) : (
                                    <CheckSquare className="w-4 h-4 text-[#141414]" />
                                  )}
                                </button>
                              </td>

                              {/* Index */}
                              <td className="py-2.5 px-3 text-center font-bold text-gray-400 border-r border-[#141414]/10">
                                {idx + 1}
                              </td>

                              {/* Description with optimization details */}
                              <td className="py-2.5 px-3 border-r border-[#141414]/10 font-bold text-gray-800">
                                <div className="leading-tight">
                                  <span>{item.novaDescricao}</span>
                                  <div className="flex items-center gap-1.5 flex-wrap mt-1">
                                    {isDisregarded ? (
                                      <>
                                        <span className="text-[10px] font-mono text-gray-700 bg-gray-100 px-1.5 py-0.5 border border-gray-300 font-bold">{item.originalLaboratorio || "GENÉRICO"}</span>
                                        {getLabBadge(item.originalLaboratorio || "GENÉRICO")}
                                      </>
                                    ) : (
                                      <>
                                        <span className="text-[10px] font-mono text-blue-900 bg-blue-50 px-1.5 py-0.5 border border-blue-200 font-bold">{item.novoLaboratorio || item.originalLaboratorio || "GENÉRICO"}</span>
                                        {getLabBadge(item.novoLaboratorio || item.originalLaboratorio || "GENÉRICO")}
                                      </>
                                    )}
                                  </div>
                                  
                                  {/* Vendas + Estoque badge */}
                                  {((item.vendasMensais ?? 0) > 0 || (item.estoqueTotal ?? 0) > 0) && (
                                    <div className="flex items-center gap-2 mt-1">
                                      {(item.vendasMensais ?? 0) > 0 && (
                                        <span className="text-[9px] font-sans font-bold text-indigo-700 bg-indigo-50 px-1.5 py-0.5 border border-indigo-200 rounded-none inline-flex items-center gap-0.5" title="Média de vendas nos últimos 4 meses">
                                          📊 {item.vendasMensais} un/mês (4m)
                                        </span>
                                      )}
                                      {(item.estoqueTotal ?? 0) > 0 && (
                                        <span className="text-[9px] font-sans font-bold text-teal-700 bg-teal-50 px-1.5 py-0.5 border border-teal-200 rounded-none inline-flex items-center gap-0.5">
                                          📦 {item.estoqueTotal} cx
                                        </span>
                                      )}
                                    </div>
                                  )}

                                  {/* Badges */}
                                  <div className="flex flex-wrap items-center gap-1.5 mt-1">
                                    {item.originalSemEstoque && (
                                      <div className="flex flex-col gap-1 w-full">
                                        <span className="text-[8px] bg-red-600 text-white px-1.5 py-0.5 uppercase font-sans tracking-wide border border-red-800 rounded-none font-black animate-pulse shadow-xs inline-flex items-center gap-1 w-fit">
                                          🚨 ORIGINAL EM FALTA / SEM ESTOQUE
                                        </span>
                                        <div className="text-[10px] text-red-700 bg-red-50/70 px-2 py-1 border border-red-200 uppercase font-black flex items-center gap-1.5 w-fit rounded-none font-mono">
                                          <span>EAN ORIGINAL EM FALTA: {item.originalEan}</span>
                                        <EanEyeButton ean={item.originalEan} descricao={item.originalDescricao} laboratorio={item.originalLaboratorio} />
                                        <EanPromoButton ean={item.originalEan} descricao={item.originalDescricao} />
                                          <EanPromoButton ean={item.originalEan} descricao={item.originalDescricao} />
                                        </div>
                                      </div>
                                    )}
                                    {isSwapped && !isDisregarded && (
                                      <span className="text-[8px] bg-emerald-100 text-emerald-800 px-1 py-0.2 uppercase font-sans tracking-wide border border-emerald-400 rounded-none font-black">
                                        ⚡ Otimizado (Troca)
                                      </span>
                                    )}
                                    {isSwapped && isDisregarded && (
                                      <span className="text-[8px] bg-amber-100 text-amber-800 px-1 py-0.2 uppercase font-sans tracking-wide border border-amber-400 rounded-none font-black">
                                        ⚠️ Revertido para Original
                                      </span>
                                    )}
                                    {!isSwapped && (
                                      <span className="text-[8px] bg-[#141414]/10 text-gray-600 px-1 py-0.2 uppercase font-sans tracking-wide border border-gray-300 rounded-none font-black">
                                        Original
                                      </span>
                                    )}
                                    
                                    {isSwapped && (
                                      <span className="text-[8px] text-gray-500 font-sans italic font-normal block">
                                        Original: {item.originalDescricao} (Lab: {item.originalLaboratorio || "GENÉRICO"})
                                      </span>
                                    )}
                                  </div>

                                  <ObservationBell ean={item.originalEan} origem={item.origem} />


                                  {item.observacao && (
                                    <div className="mt-1.5 flex items-start gap-1 text-[10px] text-amber-700 bg-amber-50 p-1 rounded-sm border border-amber-200">
                                      <AlertTriangle className="w-3 h-3 shrink-0 mt-0.5" />
                                      <span>{stripHtml(item.observacao)}</span>
                                    </div>
                                  )}

                                  {item.alertaConfirmarQtd && !hiddenAlerts[item.codInterno] && (
                                    <div className="mt-2 p-2 bg-amber-50 border border-amber-300 text-amber-950 text-xs flex flex-col sm:flex-row sm:items-center sm:justify-between gap-2 rounded-sm shadow-xs">
                                      <div className="flex items-center gap-1.5 font-bold">
                                        <AlertTriangle className="w-4 h-4 text-amber-600 shrink-0" />
                                        <span>⚠️ Ajuste a quantidade pois o produto é potencialmente fracionado.</span>
                                      </div>
                                      <div className="flex items-center gap-1.5 shrink-0">
                                        <input
                                          type="number"
                                          min="0"
                                          className="w-16 px-1.5 py-1 bg-white border border-gray-300 text-black text-xs font-mono font-bold focus:outline-none focus:ring-1 focus:ring-amber-500 rounded-sm"
                                          value={alertInputs[item.codInterno] !== undefined ? alertInputs[item.codInterno] : item.qtd}
                                          onChange={(e) => {
                                            const val = parseInt(e.target.value, 10);
                                            setAlertInputs(prev => ({
                                              ...prev,
                                              [item.codInterno]: isNaN(val) ? 0 : val
                                            }));
                                          }}
                                        />
                                        <button
                                          onClick={() => {
                                            const finalQty = alertInputs[item.codInterno] !== undefined ? alertInputs[item.codInterno] : item.qtd;
                                            onUpdateQty(item.codInterno, finalQty);
                                            setHiddenAlerts(prev => ({ ...prev, [item.codInterno]: true }));
                                          }}
                                          className="px-3 py-1 bg-amber-600 hover:bg-amber-700 text-white font-bold text-xs rounded-sm cursor-pointer transition-colors"
                                        >
                                          OK
                                        </button>
                                      </div>
                                    </div>
                                  )}
<ObservationBell ean={item.novoEan} origem={item.origem} />

                                   {(() => {
                                     if ((item.cx && item.cx > 1) || (item.qtdMin && item.qtdMin > 0) || (item.qtdMax && item.qtdMax > 0)) {
                                       return (
                                         <div className="flex flex-wrap items-center gap-1.5 mt-1.5 pt-1.5 border-t border-dotted border-gray-300">
                                           {item.cx && item.cx > 1 && (
                                             <span className={`text-[8.5px] px-1.5 py-0.5 uppercase tracking-wide font-black flex items-center gap-1 ${
                                               cxAlerta 
                                                 ? "bg-amber-100 text-amber-950 border border-amber-400" 
                                                 : "bg-gray-100 text-gray-700 border border-gray-200"
                                             }`}>
                                               Caixa: {item.cx} un 
                                               {cxAlerta && <span className="font-sans font-semibold text-[8px] text-amber-700">(Não é múltiplo!)</span>}
                                             </span>
                                           )}
                                           {item.qtdMin && item.qtdMin > 0 && (
                                             <span className={`text-[10px] px-2.5 py-1 uppercase tracking-wide font-black flex items-center gap-1.5 rounded-sm border-2 ${
                                               qtdMinAlerta 
                                                 ? "bg-red-600 text-white border-red-800 animate-pulse shadow-sm" 
                                                 : "bg-emerald-100 text-emerald-950 border-emerald-400"
                                             }`}>
                                               ⚠️ MÍNIMO COMERCIAL: {item.qtdMin} un
                                               {qtdMinAlerta ? (
                                                 <span className="font-mono font-black text-[10px] underline decoration-wavy ml-1">
                                                   (ATENÇÃO: FALTA {item.qtdMin - itemQtd} UN!)
                                                 </span>
                                               ) : (
                                                 <span className="font-sans font-bold text-[9px] text-emerald-700 ml-1">
                                                   (Atingido ✓)
                                                 </span>
                                               )}
                                             </span>
                                           )}
                                           {item.qtdMax && item.qtdMax > 0 && (
                                             <span className={`text-[8.5px] px-1.5 py-0.5 uppercase tracking-wide font-black flex items-center gap-1 ${
                                               qtdMaxAlerta 
                                                 ? "bg-orange-100 text-orange-950 border border-orange-400" 
                                                 : "bg-blue-100 text-blue-900 border border-blue-200"
                                             }`}>
                                               Limite Promo: {item.qtdMax} un
                                               {qtdMaxAlerta && <span className="font-sans font-semibold text-[8px] text-orange-700">(Excedeu {item.qtdMax} un)</span>}
                                             </span>
                                           )}
                                         </div>
                                       );
                                     }
                                     return null;
                                   })()}

                                     {/* Comercial condition selection */}
                                     {(() => {
                                       const altsCount = item.alternatives?.length ?? 0;
                                       console.log(`[SWAPS-TABLE-DETAIL] RENDER EAN=${item.originalEan || item.novoEan} codInterno=${item.codInterno} | alternatives=${altsCount} | isDisregarded=${!!(item as any).isDisregarded}`);
                                       return null;
                                     })()}
                                     <ConditionSelector item={item} onSelectCondition={onSelectCondition} config={config ? { token: config.token, cnpj: config.cnpj, useTestUrl: config.useTestUrl } : undefined} />

                                   {/* Alerta de Duplicidade Profarma */}
                                   {isProfarmaAlert && !isDisabled && profarmaDecisions[item.codInterno] !== 'keep' && (
                                     <div className="mt-2.5 p-3 rounded-lg border border-orange-200 bg-orange-50/90 text-orange-950 font-sans shadow-sm flex flex-col sm:flex-row sm:items-center sm:justify-between gap-3 animate-pulse">
                                       <div className="flex items-start gap-2.5">
                                         <AlertTriangle className="w-5 h-5 text-orange-600 shrink-0 mt-0.5" />
                                         <div>
                                           <p className="text-xs font-bold uppercase tracking-wider text-orange-800 leading-none">
                                             Alerta de Duplicidade Profarma
                                           </p>
                                           <p className="text-xs font-medium mt-1">
                                             Este item foi enviado para a Profarma nas últimas 48h. Deseja manter no pedido ou excluir do lote para evitar duplicidade?
                                           </p>
                                         </div>
                                       </div>
                                       <div className="flex items-center gap-2 shrink-0">
                                         <button
                                           onClick={() => {
                                             setProfarmaDecisions(prev => ({ ...prev, [item.codInterno]: 'keep' }));
                                           }}
                                           className="px-2.5 py-1 text-[11px] font-bold uppercase tracking-wider rounded-md border border-orange-300 hover:bg-orange-100 transition-colors bg-white text-orange-800 cursor-pointer shadow-sm"
                                         >
                                           Manter no Pedido
                                         </button>
                                         <button
                                           onClick={() => {
                                             onToggleDisabled(item.codInterno);
                                           }}
                                           className="px-2.5 py-1 text-[11px] font-bold uppercase tracking-wider rounded-md bg-orange-600 hover:bg-orange-700 text-white transition-colors cursor-pointer shadow-sm"
                                         >
                                           Excluir do Lote
                                         </button>
                                       </div>
                                     </div>
                                   )}

                                   {isProfarmaAlert && !isDisabled && profarmaDecisions[item.codInterno] === 'keep' && (
                                     <div className="mt-2.5 p-2 rounded-lg border border-emerald-200 bg-emerald-50 text-emerald-950 font-sans shadow-sm flex items-center justify-between gap-2">
                                       <div className="flex items-center gap-2">
                                         <ShieldCheck className="w-4 h-4 text-emerald-600 shrink-0" />
                                         <span className="text-xs font-semibold">
                                           ✓ Usuário optou por manter a recompra deste produto.
                                         </span>
                                       </div>
                                       <button
                                         onClick={() => {
                                           setProfarmaDecisions(prev => {
                                             const copy = { ...prev };
                                             delete copy[item.codInterno];
                                             return copy;
                                           });
                                         }}
                                         className="text-[10px] underline text-emerald-700 hover:text-emerald-900 cursor-pointer"
                                       >
                                         Desfazer Decisão
                                       </button>
                                     </div>
                                   )}

                                   {isProfarmaAlert && isDisabled && (
                                     <div className="mt-1.5 flex items-center gap-1.5 text-[11px] text-gray-500 italic">
                                       <span>⚠️ Item excluído do lote por alerta de duplicidade Profarma.</span>
                                       <button
                                         onClick={() => {
                                           onToggleDisabled(item.codInterno);
                                         }}
                                         className="text-blue-600 hover:underline font-bold font-sans text-[10px] uppercase ml-1"
                                       >
                                         Reincluir no Lote
                                       </button>
                                     </div>
                                   )}

                                </div>
                              </td>

                              {/* EAN */}
                              <td className="py-2.5 px-3 border-r border-[#141414]/10 font-mono text-gray-500 font-bold">
                                <div className="flex flex-col items-center justify-center text-center leading-tight">
                                  <div className="flex items-center">
                                    {isDisregarded ? item.originalEan : item.novoEan}
                                    <EanEyeButton ean={isDisregarded ? item.originalEan : item.novoEan} descricao={isDisregarded ? item.originalDescricao : item.novaDescricao} laboratorio={isDisregarded ? item.originalLaboratorio : item.novoLaboratorio} />
                                    <EanPromoButton ean={isDisregarded ? item.originalEan : item.novoEan} descricao={isDisregarded ? item.originalDescricao : item.novaDescricao} />
                                    {((item.alternatives && item.alternatives.length > 0) || item.distribuidora === "Sem Estoque" || item.distribuidora === "Não Encontrados") && (
                                      <button
                                        onClick={(e) => {
                                          e.stopPropagation();
                                          e.preventDefault();
                                          setInterchangeableItem(item);
                                        }}
                                        className="inline-flex items-center justify-center p-1 bg-blue-50 hover:bg-blue-600 border border-blue-300 hover:border-blue-700 text-blue-700 hover:text-white rounded-none ml-1 transition-colors cursor-pointer shrink-0"
                                        title={item.distribuidora === "Sem Estoque" || item.distribuidora === "Não Encontrados" ? "Pesquisar substitutos de verdade na SmartPed por molécula/DCB" : "Ver todas as condições e intercambialidade (Similares, Genéricos, Éticos)"}
                                      >
                                        <Layers className="w-3.5 h-3.5" />
                                      </button>
                                    )}
                                  </div>
                                  {isSwapped && !isDisregarded && (
                                    <div className="text-[9px] text-rose-600 mt-1 flex flex-col items-center">
                                      <div className="flex items-center">
                                        <span className="line-through">{item.originalEan}</span>
                                        <EanEyeButton ean={item.originalEan} descricao={item.originalDescricao} laboratorio={item.originalLaboratorio} />
                                      </div>
                                      <span className="uppercase text-[8px] mt-0.5">{item.originalLaboratorio || "GENÉRICO"}</span>
                                    </div>
                                  )}
                                </div>
                              </td>

                              {/* Preço Base (Original) */}
                              <td className="py-2.5 px-3 border-r border-[#141414]/10 text-right text-gray-500">
                                <div className="flex flex-col items-end justify-center">
                                  <span>{formatCurrency(item.originalPreco)}</span>
                                  {item.originalPmc !== undefined && item.originalPmc > 0 && (
                                    <span className="text-[9px] text-gray-400 font-normal mt-0.5" title="Preço Máximo ao Consumidor (PMC)">
                                      PMC: {formatCurrency(item.originalPmc)}
                                    </span>
                                  )}
                                </div>
                              </td>

                              {/* Preço Líquido */}
                              <td className="py-2.5 px-3 border-r border-[#141414]/10 text-right font-bold text-gray-900">
                                <div className="flex flex-col items-end justify-center">
                                  <span>{formatCurrency(item.novoPreco)}</span>
                                  {item.novoPmc !== undefined && item.novoPmc > 0 && (
                                    <span className="text-[9px] text-emerald-600 font-bold mt-0.5" title="Preço Máximo ao Consumidor (PMC) do substituto">
                                      PMC: {formatCurrency(item.novoPmc)}
                                    </span>
                                  )}
                                  {item.tiers && item.tiers.length > 0 && (() => {
                                    const basePrice = item.originalPreco || item.novoPreco;
                                    const bestTier = item.tiers.filter((t: any) => item.qtd >= t.minQty).sort((a: any, b: any) => b.minQty - a.minQty)[0];
                                    const nextTier = item.tiers.filter((t: any) => item.qtd < t.minQty).sort((a: any, b: any) => a.minQty - b.minQty)[0];
                                    if (bestTier) {
                                      return (
                                        <span className="text-[8px] text-emerald-700 bg-emerald-50 border border-emerald-300 px-1 py-0.5 mt-0.5 font-bold rounded-sm" title={`Faixa atingida: ${bestTier.minQty}+ und = R$ ${bestTier.price.toFixed(2)}`}>
                                          FAIXA {bestTier.minQty}+ ★
                                        </span>
                                      );
                                    } else if (nextTier) {
                                      const gap = nextTier.minQty - item.qtd;
                                      return (
                                        <span className="text-[8px] text-amber-700 bg-amber-50 border border-amber-300 px-1 py-0.5 mt-0.5 font-bold rounded-sm" title={`Faltam ${gap} un para faixa de R$ ${nextTier.price.toFixed(2)}`}>
                                          +{gap} un p/ {formatCurrency(nextTier.price)}
                                        </span>
                                      );
                                    }
                                    return null;
                                  })()}
                                </div>
                              </td>

                              {/* Extra/Econ. */}
                              <td className={`py-2.5 px-3 border-r border-[#141414]/10 text-right font-bold ${(item.originalPreco - item.novoPreco) >= 0 ? "text-emerald-600" : "text-rose-600"}`}>
                                {(item.originalPreco - item.novoPreco) >= 0 ? "+" : ""}{formatCurrency((item.originalPreco - item.novoPreco) * item.qtd)}
                                {item.extra ? <div className="text-[9px] text-gray-400 mt-0.5">Extra: {formatCurrency(item.extra)}</div> : null}
                              </td>

                              {/* Qtd - INLINE EDITABLE */}
                              <td className="py-1.5 px-3 border-r border-[#141414]/10 text-center">
                                {isDisabled ? (
                                  <span className="font-bold">{item.qtd}</span>
                                ) : (
                                  <input
                                    type="number"
                                    value={item.qtd}
                                    min="1"
                                    onChange={(e) => {
                                      const qty = Math.max(1, parseInt(e.target.value) || 1);
                                      onUpdateQty(item.codInterno, qty);
                                    }}
                                    className={`font-mono font-bold text-center focus:outline-none focus:ring-2 transition-all duration-300 ${
                                      qtdMinAlerta 
                                        ? "bg-red-50 border-2 border-red-500 text-red-900 focus:ring-red-500 animate-pulse text-sm py-1.5 w-20" 
                                        : "w-16 bg-white border border-[#141414] px-1 py-0.5 text-[11px] text-[#141414] focus:ring-emerald-500"
                                    }`}
                                  />
                                )}
                              </td>

                              {/* Total */}
                              <td className={`py-2.5 px-3 border-r border-[#141414]/10 text-right font-bold transition-all duration-300 ${
                                !isDisabled && (item.novoPreco * item.qtd) > highValueThreshold
                                  ? "animate-blink border-l border-rose-500"
                                  : "text-gray-900"
                              }`}>
                                {isDisabled ? (
                                  <span className="text-gray-300 line-through">{formatCurrency(item.novoPreco * item.qtd)}</span>
                                ) : (
                                  <div className="flex flex-col items-end justify-center">
                                    <div className="flex items-center gap-1 justify-end w-full">
                                      {!isDisabled && (item.novoPreco * item.qtd) > highValueThreshold && (
                                        <span className="text-[9px] text-rose-700 font-black animate-pulse">⚠️ ALERTA:</span>
                                      )}
                                      <span className={(!isDisabled && (item.novoPreco * item.qtd) > highValueThreshold) ? "text-rose-950 font-black text-xs" : ""}>
                                        {formatCurrency(item.novoPreco * item.qtd)}
                                      </span>
                                    </div>
                                    {!isDisabled && (item.novoPreco * item.qtd) > highValueThreshold && (
                                      <span className="text-[8px] uppercase tracking-wide font-extrabold text-rose-800 block mt-0.5 animate-pulse leading-none">
                                        Confirmar Qtd!
                                      </span>
                                    )}
                                  </div>
                                )}
                              </td>

                              {/* Swap Quick Option / Toggle Choice */}
                              <td className="py-2 px-3 text-center space-y-1">
                                {isDisabled ? (
                                  <span className="text-gray-400 text-[10px] uppercase font-bold">Desativado</span>
                                ) : (
                                  <>
                                    {isSwapped ? (
                                      <button
                                        onClick={() => onToggleDisregard(item.codInterno)}
                                        className={`text-[9px] uppercase tracking-wider px-2 py-1 border font-black cursor-pointer rounded-none transition-all w-full text-center mb-1 ${
                                          isDisregarded
                                            ? "bg-emerald-600 hover:bg-emerald-700 text-white border-emerald-600"
                                            : "bg-amber-100 hover:bg-amber-200 text-amber-900 border-amber-300"
                                        }`}
                                      >
                                        {isDisregarded ? "⚡ Ativar Troca" : "↩ Reverter p/ Original"}
                                      </button>
                                    ) : (
                                      <div className="text-gray-400 text-[9px] uppercase font-bold font-sans mb-1">Sem sugestão</div>
                                    )}
                                    {item.motivoAcao && (
                                      <div className={`text-[9px] uppercase font-bold font-sans p-1 border leading-tight ${
                                        item.motivoAcao === "whatsapp_regra_lab"
                                          ? "text-emerald-900 bg-emerald-50 border-emerald-300"
                                          : item.motivoAcao === "lista_preco"
                                          ? "text-violet-900 bg-violet-50 border-violet-300"
                                          : "text-[#141414] bg-[#DCDAD7] border-[#141414]/20"
                                      }`}>
                                        {item.motivoAcao === "whatsapp_regra_lab" ? "📱 WhatsApp" 
                                          : item.motivoAcao === "lista_preco" ? `📋 Lista: ${item.fornecedorLista || item.distribuidora}` 
                                          : item.motivoAcao}
                                      </div>
                                    )}
                                    <button
                                      onClick={() => onToggleDisabled(item.codInterno)}
                                      className="text-rose-600 hover:bg-rose-50 text-[10px] uppercase font-bold flex items-center justify-center gap-1 px-2 py-1 border border-transparent hover:border-rose-200 transition-colors w-full mt-1"
                                    >
                                      <Trash2 className="w-3 h-3" /> Excluir
                                    </button>
                                  </>
                                )}
                              </td>
                            </tr>
                          );
                        })}
                      </tbody>
                    </table>
                  </div>

                  {/* Bottom control bar to minimize this group and scroll to next */}
                  <div className="p-3 bg-[#DCDAD7] border-t border-[#141414]/20 flex flex-col sm:flex-row sm:items-center sm:justify-between gap-3">
                    <span className="text-[10px] font-mono text-gray-500 font-bold uppercase">
                      Revisão de {group.distribuidora} finalizada!
                    </span>
                    <button
                      onClick={(e) => {
                        e.stopPropagation();
                        e.preventDefault();
                        
                        // Collapse this group, and expand the next group if it exists
                        setExpandedGroups(prev => {
                          const nextGroup = groups[gIdx + 1];
                          const nextState = { ...prev, [group.name]: false };
                          if (nextGroup) {
                            nextState[nextGroup.name] = true;
                          }
                          return nextState;
                        });
                        
                        // Scroll smoothly to this group header or next group header
                        setTimeout(() => {
                          const currentHeaderId = `group-header-${gIdx}`;
                          const nextHeaderId = `group-header-${gIdx + 1}`;
                          const targetElement = document.getElementById(nextHeaderId) || document.getElementById(currentHeaderId);
                          if (targetElement) {
                            targetElement.scrollIntoView({ behavior: "smooth", block: "start" });
                          }
                        }, 100);
                      }}
                      className="flex items-center justify-center gap-1.5 bg-rose-600 hover:bg-rose-700 text-white font-extrabold text-[10px] uppercase tracking-wider py-1.5 px-4 shadow-[3px_3px_0px_0px_rgba(20,20,20,1)] border border-[#141414] cursor-pointer rounded-none transition-all active:translate-x-0.5 active:translate-y-0.5 active:shadow-[1px_1px_0px_0px_rgba(20,20,20,1)]"
                      title="Minimizar este distribuidor e focar no próximo"
                    >
                      <FolderMinus className="w-3.5 h-3.5" />
                      <span>Recolher e Ir para o Próximo</span>
                    </button>
                  </div>
                    </>
                  )}
              </div>
            );
          })}
          </div>
        ) : (
          <div className="py-12 text-center text-gray-500 font-mono text-xs">
            Nenhum produto cadastrado corresponde aos filtros de busca ou tipo selecionados.
          </div>
        )}

        <AnimatePresence>
          {interchangeableItem && onSelectCondition && (
            <InterchangeabilityModal
              item={interchangeableItem}
              onClose={() => setInterchangeableItem(null)}
              onSelectCondition={onSelectCondition}
              onUpdateQty={onUpdateQty}
            />
          )}
        </AnimatePresence>

        {/* Botão Flutuante de Busca nos Pedidos e Card Interativo */}
        <div className="fixed bottom-28 right-8 z-40 flex flex-col items-end pointer-events-none">
          <div className="pointer-events-auto flex flex-col items-end">
            <AnimatePresence>
              {isFloatingSearchOpen && (
                <motion.div
                  drag
                  dragMomentum={false}
                  dragConstraints={{ left: -800, right: 0, top: -600, bottom: 100 }}
                  initial={{ opacity: 0, scale: 0.9, y: 20 }}
                  animate={{ opacity: 1, scale: 1, y: 0 }}
                  exit={{ opacity: 0, scale: 0.9, y: 20 }}
                  className="mb-4 w-80 bg-[#F2F1ED] border-4 border-[#141414] shadow-[6px_6px_0px_0px_rgba(20,20,20,1)] p-4 rounded-none cursor-default select-none"
                >
                  {/* Cabeçalho arrastável */}
                  <div className="flex items-center justify-between border-b-2 border-[#141414] pb-2 mb-3 cursor-move">
                    <div className="flex items-center space-x-2">
                      <Search className="w-4 h-4 text-blue-600" />
                      <span className="font-serif italic font-black text-xs uppercase tracking-wider text-[#141414]">
                        Buscar nos Pedidos
                      </span>
                    </div>
                    <button
                      type="button"
                      onClick={() => setIsFloatingSearchOpen(false)}
                      className="text-[#141414]/70 hover:text-rose-600 p-0.5 transition-colors cursor-pointer"
                    >
                      <X className="w-4 h-4" />
                    </button>
                  </div>

                  {/* Input de texto */}
                  <div className="relative mb-3">
                    <span className="absolute inset-y-0 left-0 pl-2.5 flex items-center text-gray-500">
                      <Search className="w-3.5 h-3.5" />
                    </span>
                    <input
                      type="text"
                      placeholder="EAN, descrição, distribuidora..."
                      value={searchTerm}
                      onChange={(e) => setSearchTerm(e.target.value)}
                      className="w-full pl-8 pr-8 py-2 border-2 border-[#141414] bg-white text-xs font-mono font-bold text-[#141414] focus:outline-none focus:ring-0"
                      autoFocus
                    />
                    {searchTerm && (
                      <button
                        type="button"
                        onClick={() => setSearchTerm("")}
                        className="absolute right-2.5 top-2.5 text-gray-400 hover:text-[#141414] cursor-pointer"
                      >
                        <X className="w-3.5 h-3.5" />
                      </button>
                    )}
                  </div>

                  {/* Informações e Diagnóstico rápido */}
                  <div className="flex items-center justify-between gap-2 mt-2">
                    <span className="text-[9px] font-mono font-black text-[#141414]/70 uppercase tracking-wider">
                      {processedReport.length} / {report.length} resultados
                    </span>
                    
                    <button
                      type="button"
                      onClick={() => {
                        setIsTrackerOpen(true);
                        setTrackerQuery(searchTerm);
                      }}
                      className="px-2 py-1 text-[9px] uppercase font-black bg-indigo-600 hover:bg-indigo-700 text-[#E4E3E0] border-2 border-[#141414] shadow-[2px_2px_0px_0px_rgba(20,20,20,1)] transition-all active:translate-x-0.5 active:translate-y-0.5 active:shadow-[1px_1px_0px_0px_rgba(20,20,20,1)] cursor-pointer rounded-none"
                      title="Ver no Diagnóstico do Lote"
                    >
                      Diagnóstico
                    </button>
                  </div>
                </motion.div>
              )}
            </AnimatePresence>

            <motion.div
              whileHover={{ scale: 1.05 }}
              whileTap={{ scale: 0.95 }}
            >
              <button
                onClick={() => setIsFloatingSearchOpen(!isFloatingSearchOpen)}
                className="bg-blue-600 hover:bg-blue-700 text-white rounded-full p-4 shadow-[4px_4px_0px_0px_rgba(20,20,20,1)] border-2 border-[#141414] cursor-pointer flex items-center justify-center transition-colors group"
                title="Buscar item nos pedidos"
              >
                <Search className="w-6 h-6 group-hover:rotate-12 transition-transform" />
              </button>
            </motion.div>
          </div>
        </div>

        {/* Painel Flutuante de Atalhos Rápidos (Recolher Distribuidoras e Voltar ao Topo) */}
        <div className="fixed bottom-6 right-8 z-40 flex flex-col items-end gap-2.5 pointer-events-none">
          <div className="pointer-events-auto flex flex-col items-end gap-2.5">
            <AnimatePresence>
              {Object.values(expandedGroups).some(v => v) && (
                <motion.div
                  initial={{ opacity: 0, scale: 0.9, y: 15 }}
                  animate={{ opacity: 1, scale: 1, y: 0 }}
                  exit={{ opacity: 0, scale: 0.9, y: 15 }}
                  whileHover={{ scale: 1.03 }}
                  whileTap={{ scale: 0.97 }}
                >
                  <button
                    onClick={() => {
                      setExpandedGroups({});
                      // Rola para o cabeçalho do painel de escolha
                      const tableElement = document.getElementById("painel-escolhas-revisao");
                      if (tableElement) {
                        tableElement.scrollIntoView({ behavior: "smooth" });
                      } else {
                        window.scrollTo({ top: 0, behavior: "smooth" });
                      }
                    }}
                    className="flex items-center gap-2 bg-rose-600 hover:bg-rose-700 text-white font-extrabold text-[10px] uppercase tracking-wider py-2.5 px-4 shadow-[4px_4px_0px_0px_rgba(20,20,20,1)] border-2 border-[#141414] cursor-pointer rounded-none transition-all"
                    title="Minimizar todos os distribuidores abertos de uma só vez e voltar ao topo"
                  >
                    <FolderMinus className="w-4 h-4 shrink-0" />
                    <span>Recolher Tudo</span>
                  </button>
                </motion.div>
              )}
            </AnimatePresence>

            <motion.div
              whileHover={{ scale: 1.05 }}
              whileTap={{ scale: 0.95 }}
            >
              <button
                onClick={() => {
                  window.scrollTo({ top: 0, behavior: "smooth" });
                }}
                className="bg-[#141414] hover:bg-black text-white p-3.5 shadow-[4px_4px_0px_0px_rgba(20,20,20,1)] border-2 border-white/20 cursor-pointer flex items-center justify-center transition-colors rounded-full"
                title="Voltar ao Topo da Tela"
              >
                <ArrowUp className="w-4 h-4" />
              </button>
            </motion.div>
          </div>
        </div>

      {/* Modal de Pedido WhatsApp */}
      {isWhatsAppModalOpen && (
        <WhatsAppOrderModal
          items={selectedWhatsAppRule ? (ruleMatchesMap.get(selectedWhatsAppRule.id) || eurofarmaItems) : eurofarmaItems}
          config={config || { token: "", cnpj: "", margemMinima: 0, tipos: [], permitirSemEstoque: false, useTestUrl: false, simulationMode: false }}
          rule={selectedWhatsAppRule || undefined}
          onClose={() => {
            setIsWhatsAppModalOpen(false);
            setSelectedWhatsAppRule(null);
          }}
        />
      )}

      </div>
    </div>
  );
}
