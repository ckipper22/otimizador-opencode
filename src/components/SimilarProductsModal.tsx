import React, { useState, useEffect, useMemo } from "react";
import { 
  XCircle, 
  RefreshCw, 
  AlertCircle, 
  Eye, 
  ShoppingCart, 
  BarChart, 
  BellRing, 
  Copy, 
  Building2, 
  Sparkles, 
  Check, 
  Search, 
  Filter, 
  Layers, 
  CheckCircle2, 
  SlidersHorizontal,
  Calendar,
  Package,
  Boxes,
  HelpCircle
} from "lucide-react";
import { formatCurrency, resolveEstoque, resolveQtdMinima, resolvePedidoMinimo } from "../utils";
import { motion, AnimatePresence } from "motion/react";

export type Tab = 'similares' | 'detalhadas' | 'semanais' | 'diagnostico';

export interface SimilarProductsModalProps {
  ean: string;
  onClose: () => void;
  descricao?: string;
  laboratorio?: string;
  qtd?: number;
  originalEan?: string;
  codInterno?: string;
  onSelectCondition?: (codInterno: string, selectedAlt: any) => void;
  onAddProduct?: (product: any) => void;
}

export const SimilarProductsModal: React.FC<SimilarProductsModalProps> = ({ 
  ean, 
  onClose, 
  descricao, 
  laboratorio, 
  qtd = 1,
  originalEan,
  codInterno,
  onSelectCondition,
  onAddProduct
}) => {
  const [activeTab, setActiveTab] = useState<Tab>('similares');
  const [selectedProduct, setSelectedProduct] = useState<{ean: string, name: string} | null>(null);

  // Dados do estoque local ERP Trier
  const [dataSimilares, setDataSimilares] = useState<any>(null);
  const [loadingSimilares, setLoadingSimilares] = useState(false);
  const [errorSimilares, setErrorSimilares] = useState<string | null>(null);
  const [buscarDescricaoParecida, setBuscarDescricaoParecida] = useState(false);
  const [apenasComEstoqueOuMinimo, setApenasComEstoqueOuMinimo] = useState(false);

  // Dados históricos e diagnóstico
  const [dataDetalhadas, setDataDetalhadas] = useState<any>(null);
  const [loadingDetalhadas, setLoadingDetalhadas] = useState(false);
  const [errorDetalhadas, setErrorDetalhadas] = useState<string | null>(null);

  const [dataSemanais, setDataSemanais] = useState<any>(null);
  const [loadingSemanais, setLoadingSemanais] = useState(false);
  const [errorSemanais, setErrorSemanais] = useState<string | null>(null);

  const [dataDiag, setDataDiag] = useState<any>(null);
  const [loadingDiag, setLoadingDiag] = useState(false);
  const [errorDiag, setErrorDiag] = useState<string | null>(null);

  // Busca de similares locais na Trier
  useEffect(() => {
    const fetchSimilares = async () => {
      setLoadingSimilares(true);
      setErrorSimilares(null);
      try {
        const url = originalEan && originalEan !== ean
          ? `/api/similares/${ean}?descricao=${encodeURIComponent(descricao || "")}&forceDesc=${buscarDescricaoParecida}&originalEan=${originalEan}`
          : `/api/similares/${ean}?descricao=${encodeURIComponent(descricao || "")}&forceDesc=${buscarDescricaoParecida}`;
        const response = await fetch(url);
        const result = await response.json();
        if (!response.ok || !result.success) throw new Error(result.error || "Erro ao buscar similares locais no ERP Trier");
        setDataSimilares(result);
      } catch (err: any) {
        setErrorSimilares(err.message);
      } finally {
        setLoadingSimilares(false);
      }
    };
    if (ean) {
      fetchSimilares();
    }
  }, [ean, buscarDescricaoParecida, originalEan]);

  const produtosExibidos = useMemo(() => {
    if (!dataSimilares?.produtos) return [];
    if (!apenasComEstoqueOuMinimo) return dataSimilares.produtos;
    return dataSimilares.produtos.filter((prod: any) => {
      const estoque = Number(prod.estoque || prod.estoque_atual || prod.estoqueAtual || prod.qtd_estoque || 0);
      const minimo = Number(prod.est_minimo || prod.estMinimo || 0);
      return estoque > 0 || minimo > 0;
    });
  }, [dataSimilares?.produtos, apenasComEstoqueOuMinimo]);

  const fetchDiagnostico = async (productEan: string) => {
    setLoadingDiag(true);
    setErrorDiag(null);
    setDataDiag(null);
    try {
      const savedConfigStr = localStorage.getItem("optimizer_config");
      const savedConfig = savedConfigStr ? JSON.parse(savedConfigStr) : {};
      
      const response = await fetch("/api/diagnostico-ean", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          ean: productEan,
          token: savedConfig.token,
          cnpj: savedConfig.cnpj
        })
      });
      const result = await response.json();
      if (!response.ok || !result.success) {
        throw new Error(result.error || "Erro ao consultar diagnóstico do EAN");
      }
      setDataDiag(result);
    } catch (err: any) {
      setErrorDiag(err.message);
    } finally {
      setLoadingDiag(false);
    }
  };

  const fetchDetalhadas = async (productEan: string) => {
    setLoadingDetalhadas(true);
    setErrorDetalhadas(null);
    setDataDetalhadas(null);
    try {
      const response = await fetch(`/api/vendas-detalhadas/${productEan}`);
      const result = await response.json();
      if (!response.ok || result.status === 'error') throw new Error(result.message || "Erro ao buscar vendas");
      setDataDetalhadas(result.data || []);
    } catch (err: any) {
      setErrorDetalhadas(err.message);
    } finally {
      setLoadingDetalhadas(false);
    }
  };

  const fetchSemanais = async (productEan: string) => {
    setLoadingSemanais(true);
    setErrorSemanais(null);
    setDataSemanais(null);
    try {
      const response = await fetch(`/api/vendas-semanais/${productEan}`);
      const result = await response.json();
      if (!response.ok || result.status === 'error') throw new Error(result.message || "Erro ao buscar vendas");
      setDataSemanais(result.data || []);
    } catch (err: any) {
      setErrorSemanais(err.message);
    } finally {
      setLoadingSemanais(false);
    }
  };

  const handleSelectProductForHistory = (productEan: string, productName: string, tab: Tab) => {
    if (!productEan) {
      alert("EAN não disponível para este produto. Verifique o cadastro.");
      return;
    }
    setSelectedProduct({ ean: productEan, name: productName });
    setActiveTab(tab);
    if (tab === 'detalhadas') fetchDetalhadas(productEan);
    if (tab === 'semanais') fetchSemanais(productEan);
  };

  const loadOriginalProductHistory = (tab: Tab) => {
    setSelectedProduct({ ean: ean, name: "Produto Original" });
    setActiveTab(tab);
    if (tab === 'detalhadas') fetchDetalhadas(ean);
    if (tab === 'semanais') fetchSemanais(ean);
  };

  return (
    <div id="similar_products_modal_overlay" className="fixed inset-0 bg-[#141414]/75 backdrop-blur-sm z-[100] flex items-center justify-center p-2 sm:p-4">
      <motion.div 
        id="similar_products_modal_container"
        initial={{ opacity: 0, scale: 0.96 }}
        animate={{ opacity: 1, scale: 1 }}
        exit={{ opacity: 0, scale: 0.96 }}
        className="bg-white border-2 sm:border-4 border-[#141414] max-w-7xl w-full rounded-none overflow-hidden flex flex-col shadow-[6px_6px_0px_0px_rgba(20,20,20,1)] max-h-[96vh]"
        onClick={(e) => e.stopPropagation()}
      >
        {/* Cabeçalho do Modal */}
        <div id="similar_products_modal_header" className="bg-[#141414] text-[#E4E3E0] px-4 sm:px-6 py-3.5 flex items-center justify-between border-b-2 border-[#141414] shrink-0">
          <div className="flex items-center space-x-3 min-w-0 flex-1">
            <div className="w-8 h-8 rounded-none bg-blue-500/20 border border-blue-500/40 flex items-center justify-center text-blue-400 shrink-0">
              <Building2 className="w-5 h-5" />
            </div>
            <div className="min-w-0 flex-1">
              <div className="flex items-center gap-2 flex-wrap">
                <h2 className="font-serif italic text-lg sm:text-xl font-bold tracking-tight leading-none text-white">
                  Estoque & Similares (ERP Trier)
                </h2>
                <span className="bg-blue-500/20 text-blue-300 border border-blue-500/30 text-[10px] font-mono px-2 py-0.5 font-bold uppercase tracking-wider">
                  Consulta de Cadastro Local
                </span>
              </div>
              <p className="text-[10px] sm:text-[11px] font-mono mt-1 text-[#E4E3E0]/80 truncate flex items-center gap-2" title={`${ean} ${descricao ? ` - ${descricao}` : ''} ${laboratorio ? `/ ${laboratorio}` : ''}`}>
                <span className="select-text font-bold text-white">EAN: {ean}</span>
                <button onClick={() => navigator.clipboard.writeText(ean)} className="text-[#E4E3E0]/60 hover:text-white cursor-pointer" title="Copiar EAN"><Copy className="w-3 h-3" /></button>
                <span className="bg-blue-800 text-blue-200 px-1.5 py-0.2 rounded font-bold text-[9px]">Qtd: {qtd > 0 ? qtd : 1} un</span>
                <span className="select-text text-gray-300 truncate">{descricao && `| ${descricao}`} {laboratorio && `| ${laboratorio}`}</span>
              </p>
            </div>
          </div>
          <button id="close_similar_products_modal_btn" onClick={onClose} className="text-[#E4E3E0]/70 hover:text-white transition-colors cursor-pointer ml-3 p-1 shrink-0">
            <XCircle className="w-6 h-6" />
          </button>
        </div>
        
        {/* Barra de Abas */}
        <div id="similar_products_modal_tabs" className="bg-gray-100 border-b border-[#141414] px-2 sm:px-4 flex gap-1 sm:gap-2 overflow-x-auto scrollbar-none whitespace-nowrap shrink-0">
          <button 
            id="tab_similares_trier"
            onClick={() => setActiveTab('similares')}
            className={`py-3 px-4 font-mono text-[11px] sm:text-xs uppercase font-bold border-b-2 transition-colors flex items-center gap-2 shrink-0 ${activeTab === 'similares' ? 'border-[#141414] text-[#141414] bg-white' : 'border-transparent text-gray-600 hover:text-[#141414]'}`}
          >
            <Building2 className="w-3.5 h-3.5" /> Similares no ERP Trier
            {produtosExibidos.length > 0 && (
              <span className="bg-blue-700 text-white text-[10px] px-1.5 py-0.2 font-mono rounded-full font-bold">
                {produtosExibidos.length}
              </span>
            )}
          </button>
          <button 
            id="tab_vendas_detalhadas"
            onClick={() => loadOriginalProductHistory('detalhadas')}
            className={`py-3 px-4 font-mono text-[11px] sm:text-xs uppercase font-bold border-b-2 transition-colors flex items-center gap-2 shrink-0 ${activeTab === 'detalhadas' ? 'border-[#141414] text-[#141414] bg-white' : 'border-transparent text-gray-600 hover:text-[#141414]'}`}
          >
            <ShoppingCart className="w-3.5 h-3.5" /> Vendas Detalhadas
          </button>
          <button 
            id="tab_desempenho_semanal"
            onClick={() => loadOriginalProductHistory('semanais')}
            className={`py-3 px-4 font-mono text-[11px] sm:text-xs uppercase font-bold border-b-2 transition-colors flex items-center gap-2 shrink-0 ${activeTab === 'semanais' ? 'border-[#141414] text-[#141414] bg-white' : 'border-transparent text-gray-600 hover:text-[#141414]'}`}
          >
            <BarChart className="w-3.5 h-3.5" /> Desempenho Semanal
          </button>
          <button 
            id="tab_diagnostico_api"
            onClick={() => {
              const targetEan = selectedProduct?.ean || ean;
              setSelectedProduct(selectedProduct || { ean, name: "Produto Original" });
              setActiveTab('diagnostico');
              fetchDiagnostico(targetEan);
            }}
            className={`py-3 px-4 font-mono text-[11px] sm:text-xs uppercase font-bold border-b-2 transition-colors flex items-center gap-2 shrink-0 ${activeTab === 'diagnostico' ? 'border-[#141414] text-[#141414] bg-white' : 'border-transparent text-gray-600 hover:text-[#141414]'}`}
            title="Verificar as condições comerciais cruas que retornam diretamente da API da SmartPed"
          >
            <RefreshCw className="w-3.5 h-3.5" /> Diagnóstico API
          </button>
        </div>

        {/* Conteúdo Principal */}
        <div id="similar_products_modal_body" className="p-3 sm:p-5 overflow-y-auto flex-1 scrollbar-thin">
          
          {/* ========================================================================= */}
          {/* ABA 1: ESTOQUE LOCAL TRIER                                                */}
          {/* ========================================================================= */}
          {activeTab === 'similares' && (
            <div className="space-y-4">
              <div className="flex flex-col sm:flex-row sm:items-center sm:justify-between gap-3 bg-gray-50 border-2 border-[#141414] p-3 text-[#141414] font-mono text-xs shadow-[2px_2px_0px_0px_rgba(20,20,20,1)]">
                <div className="flex items-center gap-2">
                  <Sparkles className="w-4.5 h-4.5 text-blue-600 shrink-0" />
                  <div>
                    <span className="font-bold text-[#141414]">Método de Equivalência (Estoque Local ERP)</span>
                    <p className="text-[10px] text-gray-500 font-sans mt-0.5">Defina como o sistema deve cruzar dados de similares no seu ERP</p>
                  </div>
                </div>
                <div className="flex gap-2">
                  <button
                    onClick={() => setBuscarDescricaoParecida(false)}
                    className={`px-3 py-1.5 font-bold uppercase text-[10px] border-2 border-[#141414] transition-colors cursor-pointer ${!buscarDescricaoParecida ? 'bg-[#141414] text-white shadow-[1px_1px_0px_0px_rgba(20,20,20,1)]' : 'bg-white text-[#141414] hover:bg-gray-100'}`}
                  >
                    Padrão (DCB / ERP)
                  </button>
                  <button
                    onClick={() => setBuscarDescricaoParecida(true)}
                    className={`px-3 py-1.5 font-bold uppercase text-[10px] border-2 border-[#141414] transition-colors cursor-pointer ${buscarDescricaoParecida ? 'bg-[#141414] text-white shadow-[1px_1px_0px_0px_rgba(20,20,20,1)]' : 'bg-white text-[#141414] hover:bg-gray-100'}`}
                  >
                    Descrição / Molécula (Regex)
                  </button>
                </div>
              </div>

              <div className="flex items-center bg-white border-2 border-[#141414] p-3 shadow-[2px_2px_0px_0px_rgba(20,20,20,1)] text-[#141414] font-mono text-xs">
                <label className="flex items-center gap-3 cursor-pointer select-none">
                  <input
                    type="checkbox"
                    checked={apenasComEstoqueOuMinimo}
                    onChange={(e) => setApenasComEstoqueOuMinimo(e.target.checked)}
                    className="w-4 h-4 accent-blue-600 border-2 border-[#141414] rounded cursor-pointer"
                  />
                  <div>
                    <span className="font-bold text-[11px] uppercase tracking-wider block">Estoque Maior que Zero ou Mínimo Cadastrado</span>
                    <p className="text-[10px] text-gray-500 font-sans mt-0.5">Ocultar itens zerados e sem estoque mínimo (sem movimentação no ERP)</p>
                  </div>
                </label>
              </div>

              {dataSimilares?.regexUsed && (
                <div className="my-3 p-3 bg-amber-100/80 border border-amber-300 text-amber-900 text-xs flex items-center gap-2.5">
                  <AlertCircle className="w-4 h-4 shrink-0" />
                  <span>Este produto não está cadastrado no ERP local desta farmácia. Mostrando busca aproximada por descrição, limitada aos produtos já carregados nesta sessão — pode não refletir todos os equivalentes reais disponíveis.</span>
                </div>
              )}

              {loadingSimilares ? (
                <div className="py-12 flex flex-col items-center justify-center text-[#141414]/70">
                  <RefreshCw className="w-8 h-8 animate-spin text-[#141414] mb-3" />
                  <span className="text-xs uppercase font-bold tracking-wider">Buscando similares no banco de dados da Trier...</span>
                </div>
              ) : (!dataSimilares?.encontrou || !produtosExibidos || produtosExibidos.length === 0 || errorSimilares) ? (
                <div className="p-6 bg-amber-50 border-2 border-[#141414] text-[#141414] text-xs font-mono text-center space-y-3 shadow-[4px_4px_0px_0px_rgba(20,20,20,1)]">
                  <AlertCircle className="w-8 h-8 text-amber-600 mx-auto" />
                  <p className="font-bold uppercase tracking-wider text-amber-900">Nenhum similar correspondente localizado no ERP local</p>
                  <p className="text-[11px] font-sans text-gray-600 max-w-md mx-auto leading-normal">
                    {apenasComEstoqueOuMinimo 
                      ? "O filtro de estoque está ativo e ocultou os itens sem saldo."
                      : "Este produto não possui cadastro ou composição ativa/DCB associada na sua Trier."
                    }
                  </p>
                </div>
              ) : (
                <div className="hidden lg:block overflow-x-auto border border-[#141414]">
                  <table className="w-full text-left text-xs font-mono whitespace-nowrap">
                    <thead className="bg-[#141414] text-white">
                      <tr>
                        <th className="px-3 py-2 border-b border-r border-gray-700 font-bold uppercase tracking-wider text-[10px]">Ações</th>
                        <th className="px-3 py-2 border-b border-r border-gray-700 font-bold uppercase tracking-wider text-[10px]">Nome do Produto e Laboratório</th>
                        <th className="px-3 py-2 border-b border-r border-gray-700 font-bold uppercase tracking-wider text-[10px]">EAN</th>
                        <th className="px-3 py-2 border-b border-r border-gray-700 font-bold uppercase tracking-wider text-[10px]">Cód. Reduzido</th>
                        <th className="px-3 py-2 border-b border-r border-gray-700 font-bold uppercase tracking-wider text-[10px]">Estoque</th>
                        <th className="px-3 py-2 border-b border-r border-gray-700 font-bold uppercase tracking-wider text-[10px]">Custo</th>
                        <th className="px-3 py-2 border-b border-r border-gray-700 font-bold uppercase tracking-wider text-[10px]">Venda</th>
                        <th className="px-3 py-2 border-b border-r border-gray-700 font-bold uppercase tracking-wider text-[10px]">Est. Mín.</th>
                        <th className="px-3 py-2 border-b border-r border-gray-700 font-bold uppercase tracking-wider text-[10px]">DCB</th>
                        <th className="px-3 py-2 border-b border-gray-700 font-bold uppercase tracking-wider text-[10px]">Obs. Venda</th>
                      </tr>
                    </thead>
                    <tbody>
                      {produtosExibidos.map((prod: any, idx: number) => (
                        <tr key={idx} className={`hover:bg-black/5 transition-colors ${idx % 2 === 0 ? "bg-white" : "bg-gray-50"} border-b border-gray-200`}>
                          <td className="px-3 py-2 border-r border-gray-200">
                            <div className="flex gap-2">
                              <button 
                                onClick={() => handleSelectProductForHistory(prod.cod_barra || prod.ean, prod.nom_produto, 'detalhadas')}
                                className="bg-[#141414] hover:bg-black text-white px-2 py-1 text-[9px] uppercase font-bold flex items-center gap-1 cursor-pointer transition-colors"
                              >
                                <ShoppingCart className="w-3 h-3" /> Vendas
                              </button>
                              <button 
                                onClick={() => handleSelectProductForHistory(prod.cod_barra || prod.ean, prod.nom_produto, 'semanais')}
                                className="bg-blue-600 hover:bg-blue-700 text-white px-2 py-1 text-[9px] uppercase font-bold flex items-center gap-1 cursor-pointer transition-colors"
                              >
                                <BarChart className="w-3 h-3" /> Semanal
                              </button>
                            </div>
                          </td>
                          <td className="px-3 py-2 border-r border-gray-200 whitespace-normal min-w-[200px]">
                            <div className="flex items-center gap-2">
                              {prod.nom_obsvenda && (
                                <span title={prod.nom_obsvenda}>
                                  <BellRing className="w-4 h-4 text-rose-500 animate-pulse shrink-0" />
                                </span>
                              )}
                              <span className="font-bold select-text">{prod.nom_produto}</span>
                              - <span className="text-gray-500 select-text">{prod.nom_laborat}</span>
                            </div>
                          </td>
                          <td className="px-3 py-2 border-r border-gray-200 text-gray-600 select-text">{prod.cod_barra || prod.ean}</td>
                          <td className="px-3 py-2 border-r border-gray-200 text-gray-600 select-text">{prod.cod_reduzido}</td>
                          <td className="px-3 py-2 border-r border-gray-200 font-bold">{Number(prod.qtd_estoque).toFixed(2)}</td>
                          <td className="px-3 py-2 border-r border-gray-200">{formatCurrency(prod.vlr_custopersonalizado)}</td>
                          <td className="px-3 py-2 border-r border-gray-200 text-blue-700 font-bold">
                            {prod.vlr_venda_final !== undefined ? formatCurrency(prod.vlr_venda_final) : formatCurrency(prod.vlr_venda_tabela)}
                          </td>
                          <td className="px-3 py-2 border-r border-gray-200">{Number(prod.est_minimo || 0).toFixed(2)}</td>
                          <td className="px-3 py-2 border-r border-gray-200">{prod.cod_dcb || "-"}</td>
                          <td className="px-3 py-2 text-[10px] text-rose-600 font-bold max-w-[200px] whitespace-normal">
                            {prod.nom_obsvenda || ""}
                          </td>
                        </tr>
                      ))}
                    </tbody>
                  </table>
                </div>
              )}
            </div>
          )}

          {/* ========================================================================= */}
          {/* ABA 2: VENDAS DETALHADAS                                                  */}
          {/* ========================================================================= */}
          {activeTab === 'detalhadas' && (
            <>
              {selectedProduct && (
                <div className="mb-4 flex items-center gap-3 bg-[#f9fdfa] border border-blue-500 p-3 text-blue-900">
                  <ShoppingCart className="w-6 h-6 text-blue-600 shrink-0" />
                  <div className="min-w-0">
                    <p className="text-[10px] font-bold uppercase tracking-wider text-blue-700">Histórico de Vendas Detalhado</p>
                    <p className="font-mono text-xs sm:text-sm truncate select-text">{selectedProduct.name} (EAN: {selectedProduct.ean})</p>
                  </div>
                </div>
              )}
              {loadingDetalhadas ? (
                <div className="py-12 flex flex-col items-center justify-center text-[#141414]/70">
                  <RefreshCw className="w-8 h-8 animate-spin text-[#141414] mb-3" />
                  <span className="text-xs uppercase font-bold tracking-wider">Buscando histórico...</span>
                </div>
              ) : errorDetalhadas ? (
                <div className="p-4 bg-rose-100 border border-rose-400 text-rose-900 text-xs font-mono flex items-center gap-2">
                  <AlertCircle className="w-4 h-4 shrink-0" />
                  <span>{errorDetalhadas}</span>
                </div>
              ) : !dataDetalhadas || dataDetalhadas.length === 0 ? (
                <div className="p-4 bg-gray-100 border border-gray-300 text-gray-700 text-xs font-mono text-center">
                  Nenhum histórico de vendas encontrado no último ano.
                </div>
              ) : (
                <div className="overflow-x-auto border border-[#141414]">
                  <table className="w-full text-left text-xs font-mono whitespace-nowrap">
                    <thead className="bg-[#141414] text-white">
                      <tr>
                        <th className="px-3 py-2 border-b border-r border-[#E4E3E0]/20 font-bold uppercase tracking-wider text-[10px]">Data</th>
                        <th className="px-3 py-2 border-b border-r border-[#E4E3E0]/20 font-bold uppercase tracking-wider text-[10px]">Hora</th>
                        <th className="px-3 py-2 border-b border-r border-[#E4E3E0]/20 font-bold uppercase tracking-wider text-[10px]">Nota/Cupom</th>
                        <th className="px-3 py-2 border-b border-r border-[#E4E3E0]/20 font-bold uppercase tracking-wider text-[10px]">Cliente</th>
                        <th className="px-3 py-2 border-b border-r border-[#E4E3E0]/20 font-bold uppercase tracking-wider text-[10px]">Quantidade</th>
                        <th className="px-3 py-2 border-b border-r border-[#E4E3E0]/20 font-bold uppercase tracking-wider text-[10px]">Vlr. Unitário</th>
                        <th className="px-3 py-2 border-b border-[#E4E3E0]/20 font-bold uppercase tracking-wider text-[10px]">Vlr. Total</th>
                      </tr>
                    </thead>
                    <tbody>
                      {dataDetalhadas.map((venda: any, idx: number) => (
                        <tr key={idx} className={`hover:bg-black/5 transition-colors ${idx % 2 === 0 ? "bg-white" : "bg-gray-50"} border-b border-[#141414]/10`}>
                          <td className="px-3 py-2 border-r border-[#141414]/10">{venda.data_venda}</td>
                          <td className="px-3 py-2 border-r border-[#141414]/10">{venda.hora_venda}</td>
                          <td className="px-3 py-2 border-r border-[#141414]/10">{venda.num_nota_cupom}</td>
                          <td className="px-3 py-2 border-r border-[#141414]/10 truncate max-w-[200px]">{venda.nome_cliente || 'Consumidor Final'}</td>
                          <td className="px-3 py-2 border-r border-[#141414]/10 font-bold">{Number(venda.quantidade).toFixed(2)}</td>
                          <td className="px-3 py-2 border-r border-[#141414]/10">{formatCurrency(venda.valor_unitario)}</td>
                          <td className="px-3 py-2 font-bold text-blue-700">{formatCurrency(venda.valor_total)}</td>
                        </tr>
                      ))}
                    </tbody>
                  </table>
                </div>
              )}
            </>
          )}

          {/* ========================================================================= */}
          {/* ABA 3: DESEMPENHO SEMANAL                                                 */}
          {/* ========================================================================= */}
          {activeTab === 'semanais' && (
            <>
              {selectedProduct && (
                <div className="mb-4 flex items-center gap-3 bg-[#f9fdfa] border border-blue-500 p-3 text-blue-900">
                  <BarChart className="w-6 h-6 text-blue-600 shrink-0" />
                  <div className="min-w-0">
                    <p className="text-[10px] font-bold uppercase tracking-wider text-blue-700">Desempenho Semanal</p>
                    <p className="font-mono text-xs sm:text-sm truncate select-text">{selectedProduct.name} (EAN: {selectedProduct.ean})</p>
                  </div>
                </div>
              )}
              {loadingSemanais ? (
                <div className="py-12 flex flex-col items-center justify-center text-[#141414]/70">
                  <RefreshCw className="w-8 h-8 animate-spin text-[#141414] mb-3" />
                  <span className="text-xs uppercase font-bold tracking-wider">Buscando desempenho...</span>
                </div>
              ) : errorSemanais ? (
                <div className="p-4 bg-rose-100 border border-rose-400 text-rose-900 text-xs font-mono flex items-center gap-2">
                  <AlertCircle className="w-4 h-4 shrink-0" />
                  <span>{errorSemanais}</span>
                </div>
              ) : !dataSemanais || dataSemanais.length === 0 ? (
                <div className="p-4 bg-gray-100 border border-gray-300 text-gray-700 text-xs font-mono text-center">
                  Nenhum desempenho semanal encontrado no último ano.
                </div>
              ) : (
                <div className="overflow-x-auto border border-[#141414]">
                  <table className="w-full text-left text-xs font-mono whitespace-nowrap">
                    <thead className="bg-[#141414] text-white">
                      <tr>
                        <th className="px-3 py-2 border-b border-r border-[#E4E3E0]/20 font-bold uppercase tracking-wider text-[10px]">Semana Início</th>
                        <th className="px-3 py-2 border-b border-[#E4E3E0]/20 font-bold uppercase tracking-wider text-[10px]">Qtd. Vendida</th>
                      </tr>
                    </thead>
                    <tbody>
                      {dataSemanais.map((venda: any, idx: number) => (
                        <tr key={idx} className={`hover:bg-black/5 transition-colors ${idx % 2 === 0 ? "bg-white" : "bg-gray-50"} border-b border-[#141414]/10`}>
                          <td className="px-3 py-2 border-r border-[#141414]/10">{venda.semana_inicio}</td>
                          <td className="px-3 py-2 font-bold text-blue-700">{Number(venda.qtd_vendida).toFixed(2)}</td>
                        </tr>
                      ))}
                    </tbody>
                  </table>
                </div>
              )}
            </>
          )}

          {/* ========================================================================= */}
          {/* ABA 4: DIAGNÓSTICO API BRUTA                                              */}
          {/* ========================================================================= */}
          {activeTab === 'diagnostico' && (
            <>
              {selectedProduct && (
                <div className="mb-4 flex items-center gap-3 bg-blue-50 border border-blue-400 p-3 text-blue-900">
                  <RefreshCw className="w-6 h-6 text-blue-600 shrink-0" />
                  <div className="min-w-0">
                    <p className="text-[10px] font-bold uppercase tracking-wider text-blue-700">Diagnóstico de Retorno SmartPed</p>
                    <p className="font-mono text-xs sm:text-sm truncate select-text">{selectedProduct.name} (EAN: {selectedProduct.ean})</p>
                  </div>
                </div>
              )}

              {loadingDiag ? (
                <div className="py-12 flex flex-col items-center justify-center text-[#141414]/70">
                  <RefreshCw className="w-8 h-8 animate-spin text-[#141414] mb-3" />
                  <span className="text-xs uppercase font-bold tracking-wider">Consultando SmartPed em tempo real...</span>
                </div>
              ) : errorDiag ? (
                <div className="p-4 bg-rose-100 border border-rose-400 text-rose-900 text-xs font-mono flex items-center gap-2">
                  <AlertCircle className="w-4 h-4 shrink-0" />
                  <span>{errorDiag}</span>
                </div>
              ) : dataDiag ? (
                <div className="space-y-4">
                  <div className="p-3 bg-gray-50 border border-gray-300 font-mono text-[10px] sm:text-xs grid grid-cols-2 md:grid-cols-4 gap-2">
                    <div><span className="text-gray-400 font-bold uppercase block text-[9px]">EAN Consultado:</span> <span className="font-bold select-text">{dataDiag.info?.cleanEanValue}</span></div>
                    <div><span className="text-gray-400 font-bold uppercase block text-[9px]">CNPJ Utilizado:</span> <span className="font-bold select-text">{dataDiag.info?.cnpjUsed}</span></div>
                    <div><span className="text-gray-400 font-bold uppercase block text-[9px]">URL da API:</span> <span className="font-bold text-gray-700 select-text truncate block">{dataDiag.info?.baseUrlUsed}</span></div>
                    <div><span className="text-gray-400 font-bold uppercase block text-[9px]">Status de Resposta:</span> <span className="font-bold text-emerald-700 select-text">Sucesso (200)</span></div>
                  </div>

                  <div className="bg-[#141414] text-gray-300 p-4 font-mono rounded-none border-2 border-[#141414]">
                    <div className="flex justify-between items-center border-b border-gray-700 pb-2 mb-3">
                      <span className="text-xs uppercase font-extrabold text-emerald-400">
                        Logs de Diagnóstico & JSON de Retorno
                      </span>
                      <button 
                        onClick={() => {
                          const jsonStr = JSON.stringify({ ean: dataDiag.ean, molecula: dataDiag.molecula }, null, 2);
                          navigator.clipboard.writeText(jsonStr);
                          alert("JSON copiado para a área de transferência!");
                        }}
                        className="bg-emerald-600 hover:bg-emerald-700 text-white text-[10px] uppercase font-bold px-2.5 py-1.5 cursor-pointer"
                      >
                        Copiar JSON Bruto
                      </button>
                    </div>

                    <div className="max-h-[150px] overflow-y-auto text-[10px] border-b border-gray-800 pb-3 mb-3 text-gray-400 space-y-1">
                      {dataDiag.logs?.map((l: string, i: number) => (
                        <div key={i}>{l}</div>
                      ))}
                    </div>

                    <div>
                      <span className="text-[10px] text-gray-400 uppercase font-bold block mb-1">Visualização do Retorno:</span>
                      <pre className="text-[10px] leading-relaxed overflow-x-auto whitespace-pre bg-black p-3 text-emerald-400 max-h-[350px] overflow-y-auto scrollbar-thin">
                        {JSON.stringify(dataDiag.ean?.Retorno || dataDiag.ean || {}, null, 2)}
                      </pre>
                    </div>
                  </div>
                </div>
              ) : null}
            </>
          )}

        </div>
      </motion.div>
    </div>
  );
};
