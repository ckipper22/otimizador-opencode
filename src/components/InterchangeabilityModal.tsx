import React, { useState, useEffect, useMemo } from "react";
import { motion } from "motion/react";
import { 
  XCircle, 
  Layers, 
  Tag, 
  Sparkles, 
  AlertTriangle, 
  CheckCircle2, 
  Building2, 
  TrendingDown, 
  Calendar, 
  ArrowRight,
  Info,
  RefreshCw,
  Search,
  ChevronDown,
  ChevronUp,
  Check
} from "lucide-react";
import { formatCurrency, resolveEstoque, resolveQtdMinima } from "../utils";

interface InterchangeabilityModalProps {
  item: any;
  onClose: () => void;
  onSelectCondition: (codInterno: string, selectedAlt: any) => void;
  onUpdateQty?: (codInterno: string, newQty: number) => void;
}

export const InterchangeabilityModal = ({ 
  item, 
  onClose, 
  onSelectCondition,
  onUpdateQty
}: InterchangeabilityModalProps) => {
  const [activeTab, setActiveTab] = useState<"same" | "generic" | "similar_etico">("same");
  
  // Estado local para armazenar e buscar as alternativas reais da SmartPed
  const [alternatives, setAlternatives] = useState<any[]>(item?.alternatives || []);
  const [loading, setLoading] = useState<boolean>(false);
  const [error, setError] = useState<string | null>(null);
  const [searchLogs, setSearchLogs] = useState<string[]>([]);
  const [dcbFound, setDcbFound] = useState<string>("");
  const [showLogs, setShowLogs] = useState<boolean>(false);
  const [localQty, setLocalQty] = useState<number>(item?.qtd || 1);
  const [hiddenAlert, setHiddenAlert] = useState<boolean>(false);

  // Fallbacks de proteção robusta contra dados corrompidos ou ausentes no item original
  const codInterno = item?.codInterno || "";
  const originalEan = item?.originalEan || item?.ean || "";
  const originalDescricao = item?.originalDescricao || item?.descricao || "Medicamento sem descrição";
  const originalLaboratorio = item?.originalLaboratorio || item?.laboratorio || "GENÉRICO";
  const originalPreco = Number(item?.originalPreco !== undefined ? item?.originalPreco : (item?.precoOriginal || 0));
  const novoEan = item?.novoEan || originalEan;
  const novaDescricao = item?.novaDescricao || originalDescricao;
  const novoLaboratorio = item?.novoLaboratorio || originalLaboratorio;
  const novoPreco = Number(item?.novoPreco !== undefined ? item?.novoPreco : (item?.precoOriginal || 0));
  const qtd = Number(item?.qtd !== undefined ? item?.qtd : 1);
  const distribuidora = item?.distribuidora || "Não Encontrados";
  const condicao = item?.condicao || "FIXA";
  const prazo = item?.prazo !== undefined ? item?.prazo : 7;

  const fetchSmartPedAlternatives = async () => {
    if (!originalEan && !originalDescricao) return;
    setLoading(true);
    setError(null);
    try {
      const savedConfigStr = localStorage.getItem("optimizer_config");
      const savedConfig = savedConfigStr ? JSON.parse(savedConfigStr) : {};

      const storedCutsStr = localStorage.getItem("cortes_recentes");
      const cortesRecentes = storedCutsStr ? JSON.parse(storedCutsStr) : {};
      
      const response = await fetch("/api/smartped-find-substitutes", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          ean: originalEan,
          descricao: originalDescricao,
          token: savedConfig.token,
          cnpj: savedConfig.cnpj,
          useTestUrl: savedConfig.useTestUrl,
          cortesRecentes
        })
      });
      
      const result = await response.json();
      if (!response.ok || !result.success) {
        throw new Error(result.error || "Erro ao consultar alternativas comerciais na SmartPed");
      }
      
      setAlternatives(result.alternatives || []);
      if (result.dcbDescoberto) {
        setDcbFound(result.dcbDescoberto);
      }
      setSearchLogs(result.logs || []);
    } catch (err: any) {
      setError(err.message);
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => {
    if (!item) return;
    // Busca automática se estiver zerado, se for Sem Estoque ou se for Não Encontrados
    if (!item.alternatives || item.alternatives.length === 0 || distribuidora === "Sem Estoque" || distribuidora === "Não Encontrados") {
      fetchSmartPedAlternatives();
    }
  }, [item, originalEan, distribuidora]);

  // Heurística de classificação das alternativas baseada no estado local alternatives
  const { sameAlts, genericAlts, similarEticoAlts } = useMemo(() => {
    const alts = alternatives || [];
    const same: any[] = [];
    const generic: any[] = [];
    const similarEtico: any[] = [];

    alts.forEach((alt: any) => {
      const isCurrent = alt.ean === novoEan && 
                        alt.distribuidora === distribuidora && 
                        alt.condicao === condicao && 
                        Math.abs(alt.preco - novoPreco) < 0.001 && 
                        alt.prazo === prazo;

      // Filtrar produtos sem estoque físico disponível (exceto se for a opção ativa atual no pedido)
      if (resolveEstoque(alt) <= 0 && !isCurrent) {
        return;
      }

      // 1. Mesmo produto (EAN idêntico)
      if (alt.ean === originalEan) {
        same.push(alt);
        return;
      }

      const descUpper = (alt.descricao || "").toUpperCase();
      const labUpper = (alt.laboratorio || "").toUpperCase();

      // 2. Classificação de Genérico
      const isGeneric = 
        descUpper.includes("GENERICO") || 
        descUpper.includes("GENÉRICO") || 
        descUpper.includes(" GEN ") || 
        descUpper.includes("GN ") ||
        labUpper.includes("GENERICO") || 
        labUpper.includes("GENÉRICO") ||
        ["EMS", "MEDLEY", "EUROFARMA", "NEO QUIMICA", "NEO QUÍMICA", "TEUTO", "PRATI", "GERMED", "SANDOZ", "GEOLAB", "BIOSINTETICA", "BIOSINTÉTICA", "GLOBO", "PHARMANOS", "ALIPHARM", "BRAINFORMA"].some(g => labUpper.includes(g)) && 
        !descUpper.includes(" - ");

      if (isGeneric) {
        generic.push(alt);
      } else {
        similarEtico.push(alt);
      }
    });

    const sortByPrice = (a: any, b: any) => a.preco - b.preco;

    return {
      sameAlts: same.sort(sortByPrice),
      genericAlts: generic.sort(sortByPrice),
      similarEticoAlts: similarEtico.sort(sortByPrice)
    };
  }, [alternatives, originalEan]);

  // Se a aba selecionada estiver vazia e outra tiver itens, muda a aba ativa
  useEffect(() => {
    if (activeTab === "same" && sameAlts.length === 0) {
      if (genericAlts.length > 0) {
        setActiveTab("generic");
      } else if (similarEticoAlts.length > 0) {
        setActiveTab("similar_etico");
      }
    } else if (activeTab === "generic" && genericAlts.length === 0 && sameAlts.length > 0) {
      setActiveTab("same");
    }
  }, [sameAlts, genericAlts, similarEticoAlts]);

  const activeAlternatives = useMemo(() => {
    switch (activeTab) {
      case "same":
        return sameAlts;
      case "generic":
        return genericAlts;
      case "similar_etico":
        return similarEticoAlts;
    }
  }, [activeTab, sameAlts, genericAlts, similarEticoAlts]);

  if (!item) return null;

  return (
    <div className="fixed inset-0 bg-[#141414]/75 backdrop-blur-sm z-[110] flex items-center justify-center p-2 sm:p-4 animate-fadeIn">
      <motion.div 
        initial={{ opacity: 0, scale: 0.96, y: 10 }}
        animate={{ opacity: 1, scale: 1, y: 0 }}
        exit={{ opacity: 0, scale: 0.96, y: 10 }}
        transition={{ duration: 0.15 }}
        className="bg-white border-4 border-[#141414] max-w-4xl w-full rounded-none overflow-hidden flex flex-col shadow-[8px_8px_0px_0px_rgba(20,20,20,1)] max-h-[92vh] sm:max-h-[85vh]"
        onClick={(e) => e.stopPropagation()}
      >
        {/* Header */}
        <div className="bg-[#141414] text-[#E4E3E0] px-4 sm:px-6 py-4 flex items-center justify-between border-b-2 border-[#141414] shrink-0">
          <div className="flex items-center space-x-3 min-w-0 flex-1">
            <Layers className="w-5 h-5 text-blue-400 shrink-0" />
            <div className="min-w-0 flex-1">
              <h2 className="font-serif italic text-lg sm:text-xl font-bold tracking-tight leading-none">Intercambialidade & Condições de Compra</h2>
              <p className="text-[10px] font-mono mt-1.5 text-gray-400 truncate uppercase">
                Analisando alternativas para a molécula: <span className="text-white font-bold">{originalDescricao}</span>
              </p>
            </div>
          </div>
          <button 
            onClick={onClose} 
            className="text-gray-400 hover:text-white transition-colors cursor-pointer ml-2 shrink-0"
            title="Fechar Painel"
          >
            <XCircle className="w-5.5 h-5.5" />
          </button>
        </div>

        {/* Current Product Quick Card */}
        <div className="bg-gray-50 border-b border-[#141414]/15 p-4 grid grid-cols-1 md:grid-cols-2 gap-4 shrink-0">
          <div className="space-y-1.5">
            <span className="text-[9px] text-gray-500 font-extrabold uppercase tracking-wide">Medicamento Original no Pedido:</span>
            <div className="text-xs font-bold text-gray-800 leading-snug">{originalDescricao}</div>
            <div className="flex flex-wrap gap-x-3 gap-y-1 text-[10px] font-mono text-gray-600">
              <span>EAN: <strong className="text-gray-900">{originalEan}</strong></span>
              <span>Laboratório: <strong className="text-gray-900 uppercase">{originalLaboratorio}</strong></span>
              <span>Qtd Solicitada: <strong className="text-gray-900">{qtd} un</strong></span>
            </div>
            {dcbFound && (
              <div className="text-[9px] font-mono bg-emerald-50 text-emerald-800 border border-emerald-200 px-2 py-0.5 w-fit mt-1 uppercase font-bold">
                🧪 Composição/DCB Descoberta: {dcbFound}
              </div>
            )}
          </div>
          <div className="bg-blue-50/70 border border-blue-200/60 p-3 rounded-none flex flex-col justify-center">
            <span className="text-[9px] text-blue-800 font-extrabold uppercase tracking-wide mb-1 flex items-center gap-1">
              <span className="w-1.5 h-1.5 bg-blue-600 rounded-full animate-ping"></span>
              Distribuidor e Condição Ativa no Pedido:
            </span>
            <div className="flex items-center justify-between">
              <div className="space-y-0.5">
                <div className="text-[11px] font-black text-gray-800 uppercase flex items-center gap-1.5">
                  <Building2 className="w-3 h-3 text-gray-500" />
                  {distribuidora}
                </div>
                <div className="text-[10px] text-gray-600 font-medium">
                  Condição: <strong className="font-bold text-gray-800">{condicao}</strong>
                  {prazo !== undefined && ` | Prazo: ${prazo > 0 ? `${prazo} dias` : "Vista"}`}
                </div>
              </div>
              <div className="text-right">
                <div className="text-xs font-mono text-gray-500 line-through">Orig: {formatCurrency(originalPreco)}</div>
                <div className="text-sm font-extrabold font-mono text-blue-900">{formatCurrency(novoPreco)}</div>
              </div>
            </div>
          </div>
        </div>

        {item?.alertaConfirmarQtd && !hiddenAlert && (
          <div className="mx-4 mt-3 p-3 bg-amber-50 border border-amber-300 text-amber-950 text-xs rounded-sm flex flex-col sm:flex-row sm:items-center sm:justify-between gap-2 shrink-0 shadow-xs">
            <div className="flex items-center gap-1.5 font-bold">
              <AlertTriangle className="w-4 h-4 text-amber-600 shrink-0" />
              <span>⚠️ Ajuste a quantidade pois o produto é potencialmente fracionado.</span>
            </div>
            <div className="flex items-center gap-1.5 shrink-0">
              <input
                type="number"
                min="0"
                className="w-16 px-1.5 py-1 bg-white border border-gray-300 text-black text-xs font-mono font-bold focus:outline-none focus:ring-1 focus:ring-amber-500 rounded-sm"
                value={localQty}
                onChange={(e) => {
                  const val = parseInt(e.target.value, 10);
                  setLocalQty(isNaN(val) ? 0 : val);
                }}
              />
              <button
                onClick={() => {
                  if (onUpdateQty) {
                    onUpdateQty(codInterno, localQty);
                  }
                  setHiddenAlert(true);
                  if (localQty === 0) {
                    onClose();
                  }
                }}
                className="px-3 py-1 bg-amber-600 hover:bg-amber-700 text-white font-bold text-xs rounded-sm cursor-pointer transition-colors"
              >
                OK
              </button>
            </div>
          </div>
        )}

        {/* Tab Selectors & Realtime Sync Button */}
        <div className="bg-gray-100 border-b border-[#141414] px-2 sm:px-4 flex items-center justify-between overflow-x-auto scrollbar-none whitespace-nowrap shrink-0">
          <div className="flex gap-1 sm:gap-2">
            <button 
              onClick={() => setActiveTab("same")}
              className={`py-3 px-4 font-mono text-[10px] sm:text-xs uppercase font-extrabold border-b-2 transition-colors flex items-center gap-2 shrink-0 ${activeTab === "same" ? "border-blue-600 text-blue-950 bg-white/50" : "border-transparent text-gray-500 hover:text-[#141414]"}`}
            >
              📋 Mesmo Medicamento ({sameAlts.length})
            </button>
            <button 
              onClick={() => setActiveTab("generic")}
              className={`py-3 px-4 font-mono text-[10px] sm:text-xs uppercase font-extrabold border-b-2 transition-colors flex items-center gap-2 shrink-0 ${activeTab === "generic" ? "border-emerald-600 text-emerald-950 bg-white/50" : "border-transparent text-gray-500 hover:text-[#141414]"}`}
            >
              🔬 Genéricos ({genericAlts.length})
            </button>
            <button 
              onClick={() => setActiveTab("similar_etico")}
              className={`py-3 px-4 font-mono text-[10px] sm:text-xs uppercase font-extrabold border-b-2 transition-colors flex items-center gap-2 shrink-0 ${activeTab === "similar_etico" ? "border-purple-600 text-purple-950 bg-white/50" : "border-transparent text-gray-500 hover:text-[#141414]"}`}
            >
              ⭐ Similares / Éticos ({similarEticoAlts.length})
            </button>
          </div>
          <button
            onClick={fetchSmartPedAlternatives}
            disabled={loading}
            className="py-1.5 px-3 bg-[#141414] text-white hover:bg-gray-800 disabled:bg-gray-300 font-mono text-[9px] sm:text-[10px] uppercase font-bold border border-black flex items-center gap-1 cursor-pointer transition-all shrink-0 my-1"
            title="Realizar uma varredura profunda e atualizada em todas as distribuidoras da SmartPed para este produto"
          >
            <RefreshCw className={`w-3 h-3 ${loading ? "animate-spin" : ""}`} />
            {loading ? "Varrendo SmartPed..." : "Varredura SmartPed 🔄"}
          </button>
        </div>

        {/* Alternatives Content */}
        <div className="p-4 sm:p-6 overflow-y-auto flex-1 scrollbar-thin space-y-3 bg-gray-50/50">
          {loading ? (
            <div className="py-16 flex flex-col items-center justify-center bg-white border-2 border-dashed border-blue-200">
              <RefreshCw className="w-10 h-10 animate-spin text-blue-600 mb-4" />
              <span className="text-xs uppercase font-bold tracking-widest text-[#141414]">Buscando na Rede SmartPed...</span>
              <p className="text-[10px] text-gray-400 mt-2 text-center max-w-md">
                Consultando concorrentemente tabelas de preço, moléculas de substituição e estoques atualizados das distribuidoras cadastradas.
              </p>
            </div>
          ) : error ? (
            <div className="p-4 bg-rose-50 border-2 border-rose-400 text-rose-900 text-xs font-mono rounded-none flex items-center gap-3">
              <AlertTriangle className="w-6 h-6 text-rose-600 shrink-0" />
              <div>
                <strong className="font-extrabold block uppercase mb-0.5">Falha de Varredura Comercial</strong>
                <span>{error}</span>
                <button 
                  onClick={fetchSmartPedAlternatives}
                  className="block mt-2 font-bold underline cursor-pointer text-rose-950 uppercase text-[10px]"
                >
                  Tentar Novamente ↩
                </button>
              </div>
            </div>
          ) : activeAlternatives.length === 0 ? (
            <div className="py-12 text-center border-2 border-dashed border-gray-300 bg-white p-8">
              <Info className="w-8 h-8 text-gray-400 mx-auto mb-3" />
              <span className="text-xs uppercase font-bold tracking-wider text-gray-500 block">Nenhuma alternativa cadastrada nesta aba</span>
              <p className="text-[10px] text-gray-400 mt-1 max-w-sm mx-auto">
                Não localizamos ofertas com estoque disponível para este tipo de intercâmbio no retorno da SmartPed.
              </p>
              <button
                onClick={fetchSmartPedAlternatives}
                className="mt-4 px-4 py-2 bg-[#141414] hover:bg-black text-white font-mono text-[10px] uppercase font-bold"
              >
                Forçar Varredura SmartPed 🔄
              </button>
            </div>
          ) : (
            <div className="space-y-3">
              <div className="flex items-center justify-between text-[10px] text-gray-500 uppercase font-mono px-1">
                <span>Ordenado por menor preço líquido unitário</span>
                <span>{activeAlternatives.length} opções disponíveis</span>
              </div>
              
              {activeAlternatives.map((alt: any, idx: number) => {
                const isCurrent = alt.ean === novoEan && 
                                  alt.distribuidora === distribuidora && 
                                  alt.condicao === condicao && 
                                  Math.abs(alt.preco - novoPreco) < 0.001 && 
                                  alt.prazo === prazo;

                const priceDiff = originalPreco - alt.preco;
                const isCheaper = priceDiff > 0.005;
                const savingsPct = originalPreco > 0 ? Math.round((priceDiff / originalPreco) * 100) : 0;
                
                const hasMinAlert = alt.qtdMin && alt.qtdMin > 0 && qtd < alt.qtdMin;
                const missingQty = hasMinAlert ? (alt.qtdMin - qtd) : 0;

                return (
                  <div 
                    key={idx} 
                    className={`bg-white border-2 p-3 sm:p-4 transition-all flex flex-col md:flex-row items-stretch md:items-center justify-between gap-4 ${
                      isCurrent 
                        ? "border-blue-600 bg-blue-50/20 shadow-[4px_4px_0px_0px_rgba(37,99,235,1)]" 
                        : "border-[#141414] hover:border-blue-600 shadow-[4px_4px_0px_0px_rgba(20,20,20,1)] hover:shadow-[4px_4px_0px_0px_rgba(37,99,235,1)]"
                    }`}
                  >
                    {/* Alt Product Detail */}
                    <div className="flex-1 space-y-2">
                      <div className="flex items-start gap-2">
                        <span className={`text-[8px] font-mono font-black uppercase px-1.5 py-0.5 tracking-wider shrink-0 ${
                          activeTab === "same" 
                            ? "bg-blue-100 text-blue-900 border border-blue-300" 
                            : activeTab === "generic" 
                              ? "bg-emerald-100 text-emerald-900 border border-emerald-300"
                              : "bg-purple-100 text-purple-900 border border-purple-300"
                        }`}>
                          {activeTab === "same" ? "Mesmo" : activeTab === "generic" ? "Genérico" : "Similar/Ético"}
                        </span>
                        
                        <div>
                          <h3 className="font-extrabold text-xs text-gray-900 leading-tight select-text">
                            {alt.descricao}
                          </h3>
                          <div className="flex flex-wrap gap-x-2.5 gap-y-0.5 text-[9px] font-mono text-gray-500 mt-1 uppercase">
                            <span>EAN: <strong className="text-gray-700 select-text">{alt.ean}</strong></span>
                            <span>Lab: <strong className="text-gray-700 select-text">{alt.laboratorio || "GENÉRICO"}</strong></span>
                            <span>Estoque: <strong className={`${alt.estoque === 2 ? "text-emerald-700 font-bold" : alt.estoque === 1 ? "text-amber-600 font-bold" : "text-rose-600 font-bold"}`}>{alt.estoque === 2 ? "Estoque Normal" : alt.estoque === 1 ? "Baixo / Sob Consulta" : "Sem Estoque"}</strong></span>
                          </div>
                        </div>
                      </div>

                      {/* Distributor & Commercial Conditions info */}
                      <div className="flex flex-wrap items-center gap-x-3 gap-y-1.5 text-[10px] bg-gray-50 border border-gray-200/60 p-2 rounded-sm font-semibold text-gray-700">
                        <div className="flex items-center gap-1">
                          <Building2 className="w-3.5 h-3.5 text-gray-400" />
                          <span>Distribuidora: <strong className="text-gray-900 uppercase select-text">{alt.distribuidora}</strong></span>
                        </div>
                        <span className="text-gray-300">|</span>
                        <div className="flex items-center gap-1">
                          <Tag className="w-3.5 h-3.5 text-gray-400" />
                          <span>Condição: <strong className="text-gray-900 uppercase select-text">{alt.condicao}</strong></span>
                        </div>
                        <span className="text-gray-300">|</span>
                        <div className="flex items-center gap-1">
                          <Calendar className="w-3.5 h-3.5 text-gray-400" />
                          <span>Prazo: <strong className="text-gray-900 uppercase select-text">{alt.prazo > 0 ? `${alt.prazo}d` : "Vista"}</strong></span>
                        </div>
                      </div>

                      {/* Minimum limits notifications */}
                      {alt.qtdMin > 0 ? (
                        hasMinAlert ? (
                          <div className="flex items-center gap-1.5 text-[9px] font-bold text-rose-700 bg-rose-50 border border-rose-200 p-1.5">
                            <AlertTriangle className="w-3.5 h-3.5 text-rose-600 animate-bounce" />
                            <span>
                              MÍNIMO DA PROMOÇÃO DE {alt.qtdMin} UN NÃO ATINGIDO (FALTAM {missingQty} UN NO SEU PEDIDO DE {qtd} UN!)
                            </span>
                          </div>
                        ) : (
                          <div className="flex items-center gap-1.5 text-[9px] font-bold text-emerald-800 bg-emerald-50 border border-emerald-200 p-1.5">
                            <CheckCircle2 className="w-3.5 h-3.5 text-emerald-600" />
                            <span>Mínimo de {alt.qtdMin} un atingido (Seu pedido tem {qtd} un)</span>
                          </div>
                        )
                      ) : (
                        <div className="flex items-center gap-1.5 text-[9px] font-bold text-gray-600 bg-gray-100 p-1.5 border border-gray-200 w-fit">
                          <CheckCircle2 className="w-3 h-3 text-gray-400" />
                          <span>LIVRE DE QUANTIDADE MÍNIMA COMERCIAL</span>
                        </div>
                      )}
                    </div>

                    {/* Cost & Savings Information */}
                    <div className="flex flex-row md:flex-col items-center md:items-end justify-between md:justify-center border-t md:border-t-0 md:border-l border-gray-100 pt-3 md:pt-0 md:pl-5 shrink-0 min-w-[150px] gap-2">
                      <div className="text-left md:text-right font-mono">
                        <span className="text-[9px] text-gray-400 block uppercase font-sans">Preço Líquido</span>
                        <span className="text-base font-black text-gray-900 block leading-none">{formatCurrency(alt.preco)}</span>
                        
                        {alt.pmc !== undefined && alt.pmc > 0 && (
                          <span className="text-[10px] text-indigo-600 font-bold block mt-0.5" title="Preço Máximo ao Consumidor (PMC)">
                            PMC: {formatCurrency(alt.pmc)}
                          </span>
                        )}
                        
                        {isCheaper ? (
                          <span className="text-[10px] text-emerald-600 font-bold flex items-center gap-0.5 mt-1 md:justify-end">
                            <TrendingDown className="w-3 h-3" />
                            Economia: {formatCurrency(priceDiff)} / un ({savingsPct}%)
                          </span>
                        ) : priceDiff === 0 ? (
                          <span className="text-[10px] text-gray-500 font-semibold block mt-1 font-sans">Preço igual ao original</span>
                        ) : (
                          <span className="text-[10px] text-rose-600 font-bold block mt-1">
                            +{formatCurrency(Math.abs(priceDiff))} / un
                          </span>
                        )}
                      </div>

                      {/* Action trigger button */}
                      {isCurrent ? (
                        <span className="inline-flex items-center gap-1 bg-blue-100 text-blue-800 text-[10px] font-bold px-2.5 py-1.5 border border-blue-300">
                          <CheckCircle2 className="w-3.5 h-3.5 text-blue-600" />
                          Opção Ativa
                        </span>
                      ) : (
                        <button
                          onClick={() => {
                            onSelectCondition(codInterno, alt);
                            onClose();
                          }}
                          className={`inline-flex items-center gap-1 text-[10px] font-black px-3 py-2 cursor-pointer transition-all border rounded-none ${
                            hasMinAlert 
                              ? "bg-rose-50 hover:bg-rose-100 border-rose-300 text-rose-950"
                              : "bg-blue-600 hover:bg-[#141414] text-[#E4E3E0] border-[#141414] hover:text-white"
                          }`}
                          title={hasMinAlert ? "Esta opção exige quantidade mínima não atingida, mas você ainda pode selecioná-la se desejar ajustar a quantidade depois." : "Selecionar esta opção"}
                        >
                          Encaminhar Pedido
                          <ArrowRight className="w-3 h-3" />
                        </button>
                      )}
                    </div>
                  </div>
                );
              })}
            </div>
          )}

          {/* Diagnostics Log Console Panel */}
          {searchLogs.length > 0 && (
            <div className="border border-gray-300 bg-white">
              <button 
                onClick={() => setShowLogs(!showLogs)}
                className="w-full px-3 py-2 bg-gray-100 text-gray-700 text-[10px] uppercase font-mono font-bold flex items-center justify-between border-b border-gray-200 cursor-pointer"
              >
                <span className="flex items-center gap-1.5">
                  <Search className="w-3.5 h-3.5" />
                  Console de Rastreabilidade da Varredura ({searchLogs.length} logs)
                </span>
                {showLogs ? <ChevronUp className="w-4 h-4" /> : <ChevronDown className="w-4 h-4" />}
              </button>
              {showLogs && (
                <div className="p-3 bg-gray-900 text-[#00FF00] font-mono text-[9px] leading-relaxed max-h-40 overflow-y-auto select-text scrollbar-thin">
                  {searchLogs.map((log, idx) => (
                    <div key={idx}>{log}</div>
                  ))}
                </div>
              )}
            </div>
          )}
        </div>

        {/* Footer info banner */}
        <div className="bg-gray-150 p-3 text-center border-t border-[#141414]/15 flex items-center justify-center gap-2 text-[10px] text-gray-600 font-medium shrink-0">
          <Sparkles className="w-4 h-4 text-emerald-600 shrink-0" />
          <span>Ao clicar em <strong>"Encaminhar Pedido"</strong>, o otimizador atualiza automaticamente o pedido para a nova condição, distribuidor e preço.</span>
        </div>
      </motion.div>
    </div>
  );
};
