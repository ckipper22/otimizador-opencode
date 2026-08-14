import React, { useState, useEffect, useMemo } from 'react';
import { Loader2, RefreshCw, Search, Calendar, CheckCircle2, XCircle, FileText, ShoppingBag, Shuffle, AlertCircle, Check, Info, ArrowRight, TrendingUp } from 'lucide-react';

const getTodayString = () => {
  const d = new Date(new Date().toLocaleString("en-US", { timeZone: "America/Sao_Paulo" }));
  const year = d.getFullYear();
  const month = String(d.getMonth() + 1).padStart(2, '0');
  const day = String(d.getDate()).padStart(2, '0');
  return `${year}-${month}-${day}`;
};

export const DailyItemsView = ({ 
  config,
  onInjectRedistribution
}: { 
  config: any;
  onInjectRedistribution?: (injectedReport: any[], virtualFileContent: string) => void;
}) => {
  const [loading, setLoading] = useState(false);
  const [orders, setOrders] = useState<any[]>([]);
  const [error, setError] = useState<string | null>(null);

  // Filtros de datas e busca
  const [dataInicio, setDataInicio] = useState(getTodayString());
  const [dataFim, setDataFim] = useState(getTodayString());
  const [searchQuery, setSearchQuery] = useState("");
  const [activeTab, setActiveTab] = useState<"todos" | "faturado" | "nao_confirmado" | "manual_nao_faturado">("todos");

  // Estado de seleção de itens (Chave: ean-numPedido-distribuidora)
  const [selectedKeys, setSelectedItemKeys] = useState<Set<string>>(new Set());

  // Estado do Modal de Redistribuição
  const [isRedistributeModalOpen, setIsRedistributeModalOpen] = useState(false);
  const [redistributeItemsData, setRedistributeItemsData] = useState<any[]>([]);
  const [isSearchingAlternatives, setIsSearchingAlternatives] = useState(false);
  const [isSubmittingRedistribution, setIsSubmittingRedistribution] = useState(false);
  const [redistributeLogs, setRedistributeLogs] = useState<string[]>([]);
  const [redistributeError, setRedistributeError] = useState<string | null>(null);
  const [redistributionSuccess, setRedistributionSuccess] = useState(false);

  const fetchOrders = async () => {
    setLoading(true);
    setError(null);
    setSelectedItemKeys(new Set()); // Limpa seleções ao atualizar
    try {
      const response = await fetch("/api/itens-confirmados-do-dia", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          token: config.token,
          cnpj: config.cnpj,
          useTestUrl: config.useTestUrl,
          dataInicio,
          dataFim,
          simulationMode: config.simulationMode
        })
      });
      const data = await response.json();
      if (!response.ok) throw new Error(data.error || "Erro ao buscar itens");
      setOrders(data.itens || []);
    } catch (err: any) {
      setError(err.message);
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => {
    fetchOrders();
  }, []);

  const handleClearManualsHistory = () => {
    if (window.confirm("Deseja realmente limpar todo o histórico de itens manuais enviados do navegador? Isso apagará a lista de controle de pedidos manuais não faturados.")) {
      localStorage.removeItem("itens_manuais_enviados");
      fetchOrders();
    }
  };

  // Ordenação alfabética
  const sortedItems = useMemo(() => {
    return [...orders].sort((a, b) => {
      const nameA = a.nome === "Produto não identificado" ? a.ean : a.nome;
      const nameB = b.nome === "Produto não identificado" ? b.ean : b.nome;
      return nameA.localeCompare(nameB);
    });
  }, [orders]);

  // Obter itens manuais que não faturaram usando o localStorage de itens_manuais_enviados
  const manualNaoFaturados = useMemo(() => {
    const stored = localStorage.getItem("itens_manuais_enviados");
    if (!stored) return [];
    try {
      const listEnviados = JSON.parse(stored);
      // Criar chaves únicas de cruzamento e também conjuntos de EANs
      const enviadosKeys = new Set(listEnviados.map((it: any) => `${String(it.ean).trim()}_${String(it.numPedido || "").trim()}`));
      const enviadosEans = new Set(listEnviados.map((it: any) => String(it.ean).trim()));

      return sortedItems.filter(item => {
        // Apenas faltas reais são elegíveis
        if (item.status !== "nao_confirmado") return false;

        const cleanItemEan = String(item.ean || "").trim();
        const numPed = String(item.numPedido || "").trim();

        return enviadosKeys.has(`${cleanItemEan}_${numPed}`) || enviadosEans.has(cleanItemEan);
      });
    } catch (e) {
      console.error("Erro ao processar itens manuais do localStorage:", e);
      return [];
    }
  }, [sortedItems]);

  // Filtros combinados de Tab e Pesquisa Textual
  const filteredItems = useMemo(() => {
    let itemsToFilter = sortedItems;
    if (activeTab === "manual_nao_faturado") {
      itemsToFilter = manualNaoFaturados;
    }

    return itemsToFilter.filter(item => {
      // 1. Filtro da Tab se não for a aba especial de manuais (pois ela já filtra no useMemo manualNaoFaturados)
      if (activeTab !== "manual_nao_faturado") {
        if (activeTab === "faturado" && item.status !== "faturado") return false;
        if (activeTab === "nao_confirmado" && item.status !== "nao_confirmado") return false;
      }

      // 2. Filtro de Pesquisa (Nome, EAN ou Distribuidora)
      if (searchQuery.trim() !== "") {
        const query = searchQuery.toLowerCase();
        const matchesName = (item.nome || "").toLowerCase().includes(query);
        const matchesEan = (item.ean || "").toLowerCase().includes(query);
        const matchesDist = (item.distribuidora || "").toLowerCase().includes(query);
        return matchesName || matchesEan || matchesDist;
      }

      return true;
    });
  }, [sortedItems, activeTab, searchQuery, manualNaoFaturados]);

  // Contadores dinâmicos para as abas
  const tabCounts = useMemo(() => {
    const counts = { todos: 0, faturado: 0, nao_confirmado: 0, manual_nao_faturado: manualNaoFaturados.length };
    orders.forEach(it => {
      counts.todos++;
      if (it.status === "faturado") counts.faturado++;
      if (it.status === "nao_confirmado") counts.nao_confirmado++;
    });
    return counts;
  }, [orders, manualNaoFaturados]);

  // Chave de unicidade do item para seleção
  const getItemKey = (item: any) => `${item.ean}-${item.numPedido || 'sem_num'}-${item.distribuidora || 'sem_dist'}`;

  // Lista dos itens selecionados atualmente que são do tipo 'não confirmado'
  const selectedUnconfirmedItems = useMemo(() => {
    return orders.filter(it => it.status === "nao_confirmado" && selectedKeys.has(getItemKey(it)));
  }, [orders, selectedKeys]);

  // Manipulação de seleção individual
  const handleToggleSelect = (item: any) => {
    const key = getItemKey(item);
    const newSet = new Set(selectedKeys);
    if (newSet.has(key)) {
      newSet.delete(key);
    } else {
      newSet.add(key);
    }
    setSelectedItemKeys(newSet);
  };

  // Selecionar / Deselecionar todos os não confirmados visíveis na aba atual
  const isAllUnconfirmedSelected = useMemo(() => {
    const unconfirmedVisibles = filteredItems.filter(it => it.status === "nao_confirmado");
    if (unconfirmedVisibles.length === 0) return false;
    return unconfirmedVisibles.every(it => selectedKeys.has(getItemKey(it)));
  }, [filteredItems, selectedKeys]);

  const handleToggleSelectAll = () => {
    const unconfirmedVisibles = filteredItems.filter(it => it.status === "nao_confirmado");
    const newSet = new Set(selectedKeys);

    if (isAllUnconfirmedSelected) {
      // Remove todas as visíveis
      unconfirmedVisibles.forEach(it => newSet.delete(getItemKey(it)));
    } else {
      // Adiciona todas as visíveis
      unconfirmedVisibles.forEach(it => newSet.add(getItemKey(it)));
    }
    setSelectedItemKeys(newSet);
  };

  // Abrir Assistente de Redistribuição e Pesquisar Alternativas
  const handleStartRedistribution = async () => {
    if (selectedUnconfirmedItems.length === 0) return;

    setIsRedistributeModalOpen(true);
    setIsSearchingAlternatives(true);
    setRedistributeError(null);
    setRedistributionSuccess(false);
    setRedistributeLogs([]);
    
    const itemsWithAlternatives: any[] = [];

    try {
      for (const item of selectedUnconfirmedItems) {
        // Busca alternativas comerciais via API search-products para o EAN
        const res = await fetch("/api/search-products", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({
            query: item.ean,
            token: config.token,
            cnpj: config.cnpj,
            useTestUrl: config.useTestUrl,
            simulationMode: config.simulationMode,
            tipos: config.tipos,
            permitirSemEstoque: false // Redistribuição sempre foca em quem tem estoque
          })
        });

        if (res.ok) {
          const data = await res.json();
          const list = data.items || [];
          
          // Filtragem de alternativas:
          // 1. Deve ter estoque > 0
          // 2. Não pode ser a distribuidora de onde falhou, EXCETO se a falha original foi por conta de pedido mínimo (para agrupar e bater o mínimo)
          const motivoOriginal = (item.motivo || "").toLowerCase();
          const ehPedidoMinimo = motivoOriginal.includes("mínimo") || 
                                 motivoOriginal.includes("minimo") || 
                                 motivoOriginal.includes("valor") || 
                                 motivoOriginal.includes("limite") || 
                                 motivoOriginal.includes("min") || 
                                 motivoOriginal.includes("pedido");

          const originalDistNormalized = (item.distribuidora || "").trim().toUpperCase();
          
          // All alternatives with stock (to show in dropdown)
          const alternatives = list.filter((alt: any) => alt.estoque > 0);

          // Filter eligible for recommending the best alternative
          const eligibleForBest = alternatives.filter((alt: any) => {
            const altDistNormalized = (alt.distribuidora || "").trim().toUpperCase();
            const ehMesmaDistribuidora = altDistNormalized === originalDistNormalized;
            if (ehMesmaDistribuidora && !ehPedidoMinimo) {
              return false;
            }
            return true;
          });

          // Pega a melhor alternativa (menor preço líquido) que já vem ordenada da API
          const bestAlternative = eligibleForBest.length > 0 ? eligibleForBest[0] : null;

          itemsWithAlternatives.push({
            originalItem: item,
            alternatives,
            selectedAlternative: bestAlternative,
            checked: !!bestAlternative, // Selecionado por padrão se houver alternativa com estoque
            ehPedidoMinimo
          });
        } else {
          itemsWithAlternatives.push({
            originalItem: item,
            alternatives: [],
            selectedAlternative: null,
            checked: false,
            error: "Erro na resposta da API"
          });
        }
      }

      setRedistributeItemsData(itemsWithAlternatives);
    } catch (err: any) {
      setRedistributeError("Falha ao analisar as alternativas: " + err.message);
    } finally {
      setIsSearchingAlternatives(false);
    }
  };

  // Redistribuir itens gerando relatório virtual e injetando no Otimizador (App.tsx)
  const handleConfirmRedistribution = async () => {
    const activeRedistributions = redistributeItemsData.filter(d => d.checked && d.selectedAlternative);
    if (activeRedistributions.length === 0) return;

    setIsSubmittingRedistribution(true);
    setRedistributeError(null);
    setRedistributeLogs(["[INICIANDO] Mapeando alternativas comerciais selecionadas..."]);

    try {
      // Mapeia para o formato SwapReportItem esperado pelo Otimizador
      const injectedReport = activeRedistributions.map(d => {
        const item = d.originalItem;
        const alt = d.selectedAlternative;
        
        const originalPrice = item.precoLiquido || alt.precoOriginal || alt.precoLiquido;
        const optimizedPrice = alt.precoLiquido;
        const econUnit = Math.max(0, originalPrice - optimizedPrice);
        const econTotal = econUnit * item.quantSolicitada;

        // Map all found alternatives to the format expected by App/SwapsTable
        const mappedAlternatives = (d.alternatives || []).map((a: any) => ({
          ean: a.ean,
          descricao: a.descricao,
          laboratorio: a.laboratorio,
          preco: a.precoLiquido !== undefined ? a.precoLiquido : (a.preco !== undefined ? a.preco : 0),
          distribuidora: a.distribuidora,
          codDist: a.codDist,
          condicao: a.condicao,
          prazo: a.prazo,
          qtdMin: a.qtdMin,
          qtdMax: a.qtdMax,
          cx: a.cx,
          estoque: a.estoque
        }));

        return {
          codInterno: item.ean, // Usa o EAN como código interno para fins de unicidade
          originalEan: item.ean,
          originalDescricao: item.nome || item.descricaoSmartped || "Produto não identificado",
          originalLaboratorio: alt.laboratorio || "Desconhecido",
          originalPreco: originalPrice,
          novoEan: alt.ean,
          novaDescricao: alt.descricao || item.nome || item.descricaoSmartped || "Produto não identificado",
          novoLaboratorio: alt.laboratorio || "Desconhecido",
          novoPreco: optimizedPrice,
          qtd: item.quantSolicitada,
          economiaUnit: econUnit,
          economiaTotal: econTotal,
          distribuidora: alt.distribuidora,
          estoque: alt.estoque || 999,
          codDist: alt.codDist,
          condicao: alt.condicao || "FIXA",
          codProdutoDist: alt.codProdutoDist || "",
          prazo: alt.prazo || 0,
          codProduto: alt.codProduto || alt.codProdutoDist || "",
          pedidoMinimo: alt.pedidoMinimo || 150,
          observacao: alt.mensagem || "",
          alternatives: mappedAlternatives
        };
      });

      // Constrói o conteúdo virtual do arquivo SICF
      const headerLine = `1;${config.cnpj || "13408443000168"};${new Date().toLocaleDateString("pt-BR")};1`;
      const itemLines = activeRedistributions.map(d => {
        const item = d.originalItem;
        const alt = d.selectedAlternative;
        const precoStr = (item.precoLiquido || alt.precoOriginal || alt.precoLiquido).toFixed(2).replace(".", ",");
        return `2;${item.ean};${item.quantSolicitada};${item.ean};${(item.nome || item.descricaoSmartped || "Produto").substring(0, 40)};${(alt.laboratorio || "LAB").substring(0, 15)};${precoStr}`;
      });
      const footerLine = `9;${activeRedistributions.length}`;
      const virtualFileContent = [headerLine, ...itemLines, footerLine].join("\r\n");

      if (onInjectRedistribution) {
        onInjectRedistribution(injectedReport, virtualFileContent);
      }

      setRedistributionSuccess(true);
      setIsRedistributeModalOpen(false);
      setSelectedItemKeys(new Set());
    } catch (err: any) {
      setRedistributeError(err.message);
    } finally {
      setIsSubmittingRedistribution(false);
    }
  };

  return (
    <div className="p-6 bg-white border border-[#141414] shadow-sm relative">
      {/* Cabeçalho principal */}
      <div className="flex flex-col md:flex-row md:items-center justify-between gap-4 mb-6">
        <div>
          <h2 className="text-xl font-bold font-serif italic text-[#141414] flex items-center gap-2">
            <ShoppingBag className="w-5 h-5 text-gray-700" />
            Consulta de Itens por Período
          </h2>
          <p className="text-xs text-gray-500 mt-1">
            Monitore itens confirmados (faturados) e faltas diretas dos pedidos transmitidos ao Smartped.
          </p>
        </div>
        <button
          onClick={fetchOrders}
          disabled={loading}
          className="flex items-center justify-center gap-2 px-4 py-2 bg-[#141414] text-white hover:bg-gray-800 transition-colors text-sm font-semibold disabled:opacity-50"
        >
          {loading ? (
            <>
              <Loader2 className="w-4 h-4 animate-spin" />
              <span>Buscando...</span>
            </>
          ) : (
            <>
              <RefreshCw className="w-4 h-4" />
              <span>Atualizar Itens</span>
            </>
          )}
        </button>
      </div>

      {/* Painel de Filtros de Datas */}
      <div className="grid grid-cols-1 sm:grid-cols-2 md:grid-cols-3 gap-4 p-4 bg-gray-50 border border-gray-200 mb-6 rounded-none">
        <div className="flex flex-col gap-1">
          <label className="text-[10px] font-bold text-gray-600 uppercase flex items-center gap-1">
            <Calendar className="w-3.5 h-3.5" /> Data Inicial
          </label>
          <input
            type="date"
            value={dataInicio}
            onChange={(e) => setDataInicio(e.target.value)}
            className="w-full text-xs px-3 py-2 border border-gray-300 focus:outline-none focus:border-[#141414] bg-white text-gray-800"
          />
        </div>

        <div className="flex flex-col gap-1">
          <label className="text-[10px] font-bold text-gray-600 uppercase flex items-center gap-1">
            <Calendar className="w-3.5 h-3.5" /> Data Final
          </label>
          <input
            type="date"
            value={dataFim}
            onChange={(e) => setDataFim(e.target.value)}
            className="w-full text-xs px-3 py-2 border border-gray-300 focus:outline-none focus:border-[#141414] bg-white text-gray-800"
          />
        </div>

        <div className="flex flex-col gap-1 sm:col-span-2 md:col-span-1 justify-end">
          <button
            onClick={fetchOrders}
            disabled={loading}
            className="w-full py-2 bg-gray-200 hover:bg-gray-300 transition-colors text-xs font-bold text-gray-800 border border-gray-300"
          >
            Filtrar Período
          </button>
        </div>
      </div>

      {/* Barra de Busca e Controle de Abas */}
      <div className="flex flex-col lg:flex-row gap-4 justify-between items-stretch lg:items-center mb-6">
        {/* Abas */}
        <div className="flex border-b border-gray-200">
          <button
            onClick={() => setActiveTab("todos")}
            className={`px-4 py-2.5 text-xs font-bold uppercase transition-all border-b-2 flex items-center gap-2 ${
              activeTab === "todos"
                ? "border-[#141414] text-[#141414] bg-gray-50"
                : "border-transparent text-gray-500 hover:text-gray-800"
            }`}
          >
            Todos ({tabCounts.todos})
          </button>
          <button
            onClick={() => setActiveTab("faturado")}
            className={`px-4 py-2.5 text-xs font-bold uppercase transition-all border-b-2 flex items-center gap-2 ${
              activeTab === "faturado"
                ? "border-emerald-600 text-emerald-800 bg-emerald-50/40"
                : "border-transparent text-gray-500 hover:text-gray-800"
            }`}
          >
            <CheckCircle2 className="w-3.5 h-3.5 text-emerald-600" />
            Faturados ({tabCounts.faturado})
          </button>
          <button
            onClick={() => setActiveTab("nao_confirmado")}
            className={`px-4 py-2.5 text-xs font-bold uppercase transition-all border-b-2 flex items-center gap-2 ${
              activeTab === "nao_confirmado"
                ? "border-rose-600 text-rose-800 bg-rose-50/40"
                : "border-transparent text-gray-500 hover:text-gray-800"
            }`}
          >
            <XCircle className="w-3.5 h-3.5 text-rose-600" />
            Não Confirmados ({tabCounts.nao_confirmado})
          </button>
          <button
            onClick={() => setActiveTab("manual_nao_faturado")}
            className={`px-4 py-2.5 text-xs font-bold uppercase transition-all border-b-2 flex items-center gap-2 ${
              activeTab === "manual_nao_faturado"
                ? "border-amber-600 text-amber-800 bg-amber-50/40"
                : "border-transparent text-gray-500 hover:text-gray-800"
            }`}
          >
            <AlertCircle className="w-3.5 h-3.5 text-amber-600" />
            Manuais Não Faturados ({tabCounts.manual_nao_faturado})
          </button>
        </div>

        {/* Controles de pesquisa e ações adicionais */}
        <div className="flex flex-col sm:flex-row gap-3 items-stretch sm:items-center">
          {activeTab === "manual_nao_faturado" && tabCounts.manual_nao_faturado > 0 && (
            <button
              onClick={handleClearManualsHistory}
              className="px-3 py-2 border border-gray-300 hover:bg-gray-50 text-gray-700 hover:text-gray-900 transition-colors text-xs font-bold uppercase flex items-center gap-1.5 cursor-pointer"
              title="Limpar o registro local de itens manuais enviados"
            >
              <RefreshCw className="w-3.5 h-3.5" />
              <span>Limpar Histórico</span>
            </button>
          )}

          {/* Input Pesquisa */}
          <div className="relative min-w-[280px]">
            <span className="absolute inset-y-0 left-0 flex items-center pl-3 pointer-events-none">
              <Search className="w-4 h-4 text-gray-400" />
            </span>
            <input
              type="text"
              placeholder="Pesquisar por nome, EAN ou distribuidor..."
              value={searchQuery}
              onChange={(e) => setSearchQuery(e.target.value)}
              className="w-full pl-9 pr-4 py-2 border border-gray-300 text-xs focus:outline-none focus:border-[#141414] bg-white text-gray-800"
            />
          </div>
        </div>
      </div>

      {/* Barra flutuante de lote de redistribuição */}
      {selectedUnconfirmedItems.length > 0 && (
        <div className="mb-6 p-4 bg-amber-50 border border-amber-300 flex flex-col sm:flex-row justify-between items-center gap-4 animate-in fade-in slide-in-from-bottom-2 duration-200">
          <div className="flex items-center gap-3">
            <Shuffle className="w-5 h-5 text-amber-600 animate-pulse" />
            <div>
              <p className="text-sm font-bold text-amber-900">
                {selectedUnconfirmedItems.length} {selectedUnconfirmedItems.length === 1 ? "item de falta selecionado" : "itens de faltas selecionados"}
              </p>
              <p className="text-xs text-amber-700">
                Você pode redistribuir estes itens para encontrar ofertas com estoque em outras distribuidoras.
              </p>
            </div>
          </div>
          <button
            onClick={handleStartRedistribution}
            className="px-5 py-2.5 bg-amber-600 hover:bg-amber-700 text-white text-xs font-bold uppercase transition-colors flex items-center gap-2 border border-amber-700 shadow-sm"
          >
            <Shuffle className="w-4 h-4" />
            Redistribuir para Próximo Fornecedor
          </button>
        </div>
      )}

      {error && (
        <div className="p-4 bg-rose-50 border border-rose-200 text-rose-800 text-xs mb-6 font-medium">
          {error}
        </div>
      )}

      {/* Lista de Itens */}
      <div className="border border-[#141414]/20 overflow-hidden">
        {/* Cabeçalho da Tabela */}
        <div className="hidden md:grid grid-cols-12 gap-4 p-3 bg-gray-50 border-b border-[#141414]/20 font-bold text-[10px] text-gray-600 uppercase items-center">
          <div className="col-span-5 flex items-center gap-3">
            {/* Checkbox geral (visível apenas na aba de faltas ou todos para facilitar) */}
            {(activeTab === "nao_confirmado" || activeTab === "todos") && (
              <input
                type="checkbox"
                checked={isAllUnconfirmedSelected}
                onChange={handleToggleSelectAll}
                className="w-4 h-4 border-gray-300 text-[#141414] focus:ring-[#141414] cursor-pointer"
                title="Selecionar todas as faltas visíveis"
              />
            )}
            <span>Produto / EAN</span>
          </div>
          <div className="col-span-2">Distribuidora</div>
          <div className="col-span-1 text-center">Pedido</div>
          <div className="col-span-1 text-center">Status</div>
          <div className="col-span-3 text-right">Qtd Solicitada / Faturada</div>
        </div>

        <div className="divide-y divide-[#141414]/10 bg-white">
          {loading ? (
            <div className="flex flex-col items-center justify-center py-12 gap-2">
              <Loader2 className="w-8 h-8 animate-spin text-[#141414]" />
              <span className="text-xs text-gray-500 font-medium">Carregando itens da API Trier...</span>
            </div>
          ) : filteredItems.length === 0 ? (
            <div className="py-12 text-center text-xs text-gray-500">
              Nenhum item encontrado para os filtros selecionados.
            </div>
          ) : (
            filteredItems.map((item: any, i: number) => {
              const displayName = item.nome === "Produto não identificado" ? `EAN: ${item.ean}` : item.nome;
              const isFaturado = item.status === "faturado";
              const key = getItemKey(item);
              const isSelected = selectedKeys.has(key);

              return (
                <div key={i} className={`grid grid-cols-1 md:grid-cols-12 gap-2 md:gap-4 p-4 md:p-3 items-center text-xs transition-colors ${isSelected ? 'bg-amber-50/55 hover:bg-amber-50' : 'hover:bg-gray-50'}`}>
                  {/* Nome do Produto */}
                  <div className="col-span-1 md:col-span-5 flex items-center gap-3">
                    {!isFaturado && (
                      <input
                        type="checkbox"
                        checked={isSelected}
                        onChange={() => handleToggleSelect(item)}
                        className="w-4 h-4 border-gray-300 text-[#141414] focus:ring-[#141414] cursor-pointer"
                      />
                    )}
                    <div className={!isFaturado ? "pl-0" : "pl-7 md:pl-7"}>
                      <span className="font-bold text-gray-800 text-xs md:text-xs block">{displayName}</span>
                      <span className="text-[10px] text-gray-400 font-mono">EAN: {item.ean}</span>
                    </div>
                  </div>

                  {/* Distribuidora */}
                  <div className="col-span-1 md:col-span-2 text-gray-600">
                    <span className="md:hidden font-semibold text-[10px] uppercase text-gray-400 block mb-0.5">Distribuidora</span>
                    <span className="font-medium">{item.distribuidora || "—"}</span>
                  </div>

                  {/* Pedido */}
                  <div className="col-span-1 md:col-span-1 text-left md:text-center text-gray-600">
                    <span className="md:hidden font-semibold text-[10px] uppercase text-gray-400 block mb-0.5">Pedido</span>
                    <span className="font-mono bg-gray-100 px-1.5 py-0.5 text-[10px] text-gray-700 font-bold border border-gray-200">
                      {item.numPedido || "—"}
                    </span>
                  </div>

                  {/* Status Badge */}
                  <div className="col-span-1 md:col-span-1 text-left md:text-center">
                    <span className="md:hidden font-semibold text-[10px] uppercase text-gray-400 block mb-1">Status</span>
                    {isFaturado ? (
                      <span className="inline-flex items-center px-2 py-0.5 border border-emerald-200 text-emerald-800 bg-emerald-50 text-[10px] font-bold">
                        Confirmado
                      </span>
                    ) : (
                      <span className="inline-flex items-center px-2 py-0.5 border border-rose-200 text-rose-800 bg-rose-50 text-[10px] font-bold">
                        Falta / Não Conf.
                      </span>
                    )}
                  </div>

                  {/* Quantidade Solicitada vs Faturada */}
                  <div className="col-span-1 md:col-span-3 text-left md:text-right">
                    <span className="md:hidden font-semibold text-[10px] uppercase text-gray-400 block mb-1">Quantidades</span>
                    <div className="flex flex-col md:items-end justify-center">
                      <div className="font-bold text-gray-800">
                        {item.quantFaturada} <span className="text-[10px] text-gray-400 font-normal">de</span> {item.quantSolicitada} un
                      </div>
                      <div className="text-[10px] text-gray-500 font-medium">
                        {isFaturado && item.quantFaturada < item.quantSolicitada && (
                          <span className="text-amber-600 font-semibold">Corte Parcial</span>
                        )}
                        {!isFaturado && item.motivo && (
                          <span className="text-rose-500 italic block mt-0.5 font-normal">Motivo: {item.motivo}</span>
                        )}
                      </div>
                    </div>
                  </div>
                </div>
              );
            })
          )}
        </div>
      </div>

      {/* ================= MODAL DO ASSISTENTE DE REDISTRIBUIÇÃO ================= */}
      {isRedistributeModalOpen && (
        <div className="fixed inset-0 bg-black/60 backdrop-blur-sm flex items-center justify-center p-4 z-50">
          <div className="bg-white border border-[#141414] shadow-2xl w-full max-w-4xl max-h-[85vh] flex flex-col rounded-none overflow-hidden animate-in zoom-in-95 duration-200">
            {/* Cabeçalho */}
            <div className="p-5 border-b border-gray-200 bg-[#141414] text-white flex justify-between items-center">
              <div className="flex items-center gap-2.5">
                <Shuffle className="w-5 h-5 text-amber-400 animate-spin-slow" />
                <div>
                  <h3 className="text-base font-bold uppercase tracking-wider">Assistente de Redistribuição de Faltas</h3>
                  <p className="text-[10px] text-gray-300">
                    Buscando as melhores ofertas alternativas para as suas faltas comerciais registradas no Smartped.
                  </p>
                </div>
              </div>
              <button
                onClick={() => setIsRedistributeModalOpen(false)}
                className="text-gray-400 hover:text-white transition-colors p-1"
                disabled={isSubmittingRedistribution}
              >
                <XCircle className="w-5 h-5" />
              </button>
            </div>

            {/* Conteúdo */}
            <div className="flex-1 overflow-y-auto p-6">
              {isSearchingAlternatives ? (
                <div className="flex flex-col items-center justify-center py-20 gap-3">
                  <Loader2 className="w-12 h-12 animate-spin text-amber-600" />
                  <p className="text-sm font-bold text-gray-800">Analisando alternativas em tempo real...</p>
                  <p className="text-xs text-gray-500">Isso pode levar alguns segundos dependendo da quantidade de itens.</p>
                </div>
              ) : redistributionSuccess ? (
                <div className="flex flex-col items-center justify-center py-10 text-center">
                  <div className="w-14 h-14 bg-emerald-50 border border-emerald-300 rounded-full flex items-center justify-center mb-4">
                    <Check className="w-8 h-8 text-emerald-600" />
                  </div>
                  <h4 className="text-lg font-bold text-emerald-950 uppercase">Redistribuição Efetuada com Sucesso!</h4>
                  <p className="text-xs text-emerald-800 max-w-md mt-1">
                    Os itens selecionados foram redistribuídos e enviados aos novos distribuidores disponíveis.
                  </p>

                  {/* Logs de Faturamento */}
                  <div className="w-full mt-6 text-left bg-gray-900 text-gray-100 font-mono text-[10px] p-4 h-48 overflow-y-auto border border-gray-800">
                    <p className="text-amber-400 border-b border-gray-800 pb-1 mb-2 font-bold uppercase tracking-wider">Histórico de Transmissão:</p>
                    {redistributeLogs.map((log, idx) => (
                      <div key={idx} className="py-0.5">{log}</div>
                    ))}
                  </div>

                  <button
                    onClick={() => {
                      setIsRedistributeModalOpen(false);
                      setSelectedItemKeys(new Set());
                    }}
                    className="mt-6 px-6 py-2.5 bg-[#141414] hover:bg-gray-800 text-white text-xs font-bold uppercase transition-colors"
                  >
                    Fechar Assistente
                  </button>
                </div>
              ) : (
                <div>
                  {redistributeError && (
                    <div className="p-4 bg-rose-50 border border-rose-200 text-rose-800 text-xs mb-4 font-semibold flex items-center gap-2">
                      <AlertCircle className="w-4 h-4 shrink-0" />
                      <span>{redistributeError}</span>
                    </div>
                  )}

                  <div className="mb-4 text-xs text-gray-600 flex flex-col gap-2 bg-blue-50/50 border border-blue-200 p-3">
                    <div className="flex items-center gap-2">
                      <Info className="w-4 h-4 text-blue-600 shrink-0" />
                      <span className="font-bold text-blue-950">Filtro de Redistribuição Inteligente:</span>
                    </div>
                    <ul className="list-disc pl-5 text-[11px] text-gray-700 space-y-1">
                      <li>O sistema remove automaticamente distribuidoras que geraram faltas físicas (Sem Estoque) para evitar re-enviar e cortar novamente.</li>
                      <li><strong>💡 Regra de Pedido Mínimo:</strong> Se o item falhou por falta de Pedido Mínimo, a distribuidora original foi mantida como alternativa viável, pois agrupando-o com outros itens agora é possível atingir o valor mínimo de faturamento!</li>
                      <li className="text-amber-800 font-semibold">⚠️ <strong>Aviso Importante:</strong> Dependendo da distribuidora ou da condição promocional selecionada, o pedido mínimo pode ser exigido por **quantidade física de caixas/unidades** (ex: "Mínimo de 5 un ou 10 un") em vez de valor monetário (R$). Fique atento a isso ao preencher os pedidos!</li>
                    </ul>
                  </div>

                  {/* Tabela de Alternativas */}
                  <div className="border border-gray-200 overflow-hidden">
                    <div className="grid grid-cols-12 gap-3 p-3 bg-gray-50 border-b border-gray-200 font-bold text-[9px] text-gray-500 uppercase">
                      <div className="col-span-1 text-center">Redist.</div>
                      <div className="col-span-4">Produto de Falta</div>
                      <div className="col-span-3 text-center">Distribuidora Anterior (Falta)</div>
                      <div className="col-span-4">Melhor Alternativa Comercial</div>
                    </div>

                    <div className="divide-y divide-gray-100 max-h-80 overflow-y-auto">
                      {redistributeItemsData.map((data, idx) => {
                        const item = data.originalItem;
                        const alt = data.selectedAlternative;
                        const originalDistNormalized = (item.distribuidora || "").trim().toUpperCase();
                        const altDistNormalized = alt ? (alt.distribuidora || "").trim().toUpperCase() : "";
                        const ehMesmoDistribuidor = alt && altDistNormalized === originalDistNormalized;
                        
                        return (
                          <div key={idx} className={`grid grid-cols-12 gap-3 p-3 text-xs items-center ${data.checked ? 'bg-amber-50/20' : 'opacity-65'}`}>
                            {/* Checkbox de Ativação */}
                            <div className="col-span-1 flex justify-center">
                              <input
                                type="checkbox"
                                checked={data.checked}
                                disabled={!alt}
                                onChange={(e) => {
                                  const updated = [...redistributeItemsData];
                                  updated[idx].checked = e.target.checked;
                                  setRedistributeItemsData(updated);
                                }}
                                className="w-4 h-4 border-gray-300 text-amber-600 focus:ring-amber-500 cursor-pointer disabled:opacity-30"
                              />
                            </div>

                            {/* Produto */}
                            <div className="col-span-4">
                              <p className="font-bold text-gray-800 leading-tight">{item.nome}</p>
                              <p className="text-[10px] text-gray-400 font-mono mt-0.5">EAN: {item.ean} | Qtd: {item.quantSolicitada} un</p>
                              {data.ehPedidoMinimo && (
                                <span className="inline-block mt-1 px-1.5 py-0.5 bg-blue-50 text-blue-800 border border-blue-200 text-[9px] font-bold">
                                  💡 Falhou por Mínimo
                                </span>
                              )}
                            </div>

                            {/* Onde Falhou */}
                            <div className="col-span-3 text-center">
                              <span className="inline-flex px-2 py-0.5 bg-rose-50 text-rose-800 border border-rose-200 font-medium text-[10px] rounded-none">
                                {item.distribuidora}
                              </span>
                            </div>

                            {/* Recomendação de Destino */}
                            <div className="col-span-4">
                              {alt ? (
                                <div className={`p-2 border ${ehMesmoDistribuidor ? 'border-blue-200 bg-blue-50/30' : 'border-emerald-200 bg-emerald-50/30'}`}>
                                  <p className={`font-bold flex items-center gap-1 ${ehMesmoDistribuidor ? 'text-blue-900' : 'text-emerald-900'}`}>
                                    <TrendingUp className="w-3.5 h-3.5" />
                                    {alt.distribuidora}
                                    {ehMesmoDistribuidor && (
                                      <span className="text-[9px] px-1 bg-blue-100 text-blue-700 font-normal">Original</span>
                                    )}
                                  </p>
                                  <div className="flex justify-between items-center mt-1 text-[10px]">
                                    <span className="text-gray-500 font-mono">Preço: R$ {alt.precoLiquido.toFixed(2)}</span>
                                    <span className={`px-1 font-bold ${ehMesmoDistribuidor ? 'text-blue-700 bg-blue-100' : alt.estoque === 2 ? 'text-emerald-700 bg-emerald-100' : alt.estoque === 1 ? 'text-amber-700 bg-amber-100' : 'text-rose-700 bg-rose-100'}`}>
                                      Estoque: {alt.estoque === 2 ? "Estoque Normal" : alt.estoque === 1 ? "Baixo / Sob Consulta" : "Sem Estoque"}
                                    </span>
                                  </div>
                                  
                                  {/* Detalhes de Condição, Prazo e Pedido Mínimo da Alternativa comercial */}
                                  <div className="mt-1.5 pt-1.5 border-t border-dashed border-gray-200/60 flex flex-col gap-0.5 text-[9px] text-gray-500 font-medium">
                                    <div className="flex justify-between items-center">
                                      <span>Condição: <strong className="text-gray-700 font-bold">{alt.condicao || "FIXA"}</strong></span>
                                      <span>Mínimo: <strong className="text-emerald-800 font-bold">R$ {alt.pedidoMinimo || 150}</strong></span>
                                    </div>
                                    <div className="flex justify-between items-center">
                                      <span>Prazo: <span className="font-bold text-gray-700">{alt.prazo || 0} dias</span></span>
                                      {alt.qtdMinima > 0 && (
                                        <span className="text-rose-700 font-bold">Mínimo Pedido: {alt.qtdMinima} un</span>
                                      )}
                                    </div>
                                    {((alt.qtdMin && alt.qtdMin > 0) || (alt.qtdMax && alt.qtdMax > 0) || (alt.cx && alt.cx > 1)) && (
                                      <div className="mt-1 pt-1 border-t border-dotted border-gray-200 flex flex-wrap gap-1 text-[8px]">
                                        {alt.cx && alt.cx > 1 && (
                                          <span className="bg-gray-100 text-gray-700 px-1 py-0.5 font-bold">Caixa: {alt.cx} un</span>
                                        )}
                                        {alt.qtdMin && alt.qtdMin > 0 && (
                                          <span className="bg-amber-100 text-amber-900 px-1 py-0.5 font-bold">Qtd Mín: {alt.qtdMin} un</span>
                                        )}
                                        {alt.qtdMax && alt.qtdMax > 0 && (
                                          <span className="bg-red-100 text-red-950 px-1 py-0.5 font-bold">Qtd Máx: {alt.qtdMax} un</span>
                                        )}
                                      </div>
                                    )}
                                  </div>

                                  {ehMesmoDistribuidor && (
                                    <p className="text-[9px] text-blue-800 mt-1 italic leading-tight bg-blue-50/50 p-1 border border-blue-100">
                                      Permitido repetir para bater o pedido mínimo na remontagem.
                                    </p>
                                  )}
                                </div>
                              ) : (
                                <span className="text-[10px] font-bold text-rose-600 uppercase flex items-center gap-1">
                                  <XCircle className="w-3.5 h-3.5" /> Sem alternativa c/ estoque
                                </span>
                              )}
                            </div>
                          </div>
                        );
                      })}
                    </div>
                  </div>
                </div>
              )}
            </div>

            {/* Rodapé do Modal */}
            {!redistributionSuccess && (
              <div className="p-4 border-t border-gray-200 bg-gray-50 flex flex-col sm:flex-row justify-between items-center gap-4">
                <span className="text-xs text-gray-500">
                  {redistributeItemsData.filter(d => d.checked).length} item(ns) confirmados para redistribuição.
                </span>

                <div className="flex gap-3">
                  <button
                    onClick={() => setIsRedistributeModalOpen(false)}
                    className="px-4 py-2 bg-white hover:bg-gray-100 text-gray-700 border border-gray-300 text-xs font-bold uppercase transition-colors"
                    disabled={isSubmittingRedistribution}
                  >
                    Cancelar
                  </button>
                  <button
                    onClick={handleConfirmRedistribution}
                    disabled={isSubmittingRedistribution || isSearchingAlternatives || redistributeItemsData.filter(d => d.checked).length === 0}
                    className="px-5 py-2 bg-emerald-600 hover:bg-emerald-700 text-white text-xs font-bold uppercase transition-colors flex items-center gap-2 border border-emerald-700 shadow-sm disabled:opacity-50"
                  >
                    {isSubmittingRedistribution ? (
                      <>
                        <Loader2 className="w-4 h-4 animate-spin" />
                        <span>Carregando...</span>
                      </>
                    ) : (
                      <>
                        <Check className="w-4 h-4" />
                        <span>Confirmar e Carregar no Otimizador</span>
                      </>
                    )}
                  </button>
                </div>
              </div>
            )}
          </div>
        </div>
      )}
    </div>
  );
};
