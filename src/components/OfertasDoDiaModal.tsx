import React, { useState, useMemo } from 'react';
import { X, Search, Tag, TrendingUp, Package, ShoppingCart, Loader2 } from 'lucide-react';
import { formatCurrency } from '../utils';

interface CompraHistorico {
  preco: number;
  precoTabela: number;
  fornecedor: string;
  data: string;
  quantidade: number;
  notaFiscal: number | null;
}

interface EstoqueLaboratorio {
  nome: string;
  quantidade: number;
  eans: string[];
}

interface OfertaDia {
  ean: string;
  produto: string;
  laboratorio?: string;
  fornecedor: string;
  fornecedorLista?: string;
  fornecedorId?: string;
  preco: number;
  validade?: string;
  vendasMensais: number;
  estoqueTotal: number;
  estoqueMesmoEan: number;
  melhorPrecoSmartPed: number | null;
  melhorDistribuidora: string | null;
  melhorEanSmartPed?: string | null;
  melhorLabSmartPed?: string | null;
  melhorPrecoPromocao?: number | null;
  melhorDistPromocao?: string | null;
  melhorCondPromocao?: string | null;
  melhorQtdMinPromocao?: number;
  melhorEanPromocao?: string | null;
  melhorPrecoHistorico: number | null;
  melhorFornecedorHistorico: string | null;
  comprasHistorico: CompraHistorico[];
  estoquePorLaboratorio: EstoqueLaboratorio[];
  ultimaCompra: CompraHistorico | null;
  economiaPercent: number;
  economiaValor: number;
  economiaMensal: number;
  boaOferta: boolean;
  erro?: boolean;
  semEan?: boolean;
  description?: string;
  discountPercent?: number;
  isReferencia?: boolean;
  tiers?: { minQty: number; price: number }[];
  bestTierPrice?: number;
}

interface OfertasDoDiaModalProps {
  cnpj: string;
  onClose: () => void;
  onAddToPedido?: (item: OfertaDia, qtd?: number) => void;
}

export function OfertasDoDiaModal({ cnpj, onClose, onAddToPedido }: OfertasDoDiaModalProps) {
  const [ofertas, setOfertas] = useState<OfertaDia[]>([]);
  const [summary, setSummary] = useState({ totalOfertas: 0, ofertasBoas: 0, economiaPotencial: 0 });
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [query, setQuery] = useState('');
  const [filterBoas, setFilterBoas] = useState(false);
  const [detalheAberto, setDetalheAberto] = useState<OfertaDia | null>(null);
  const [dataLoaded, setDataLoaded] = useState(false);
  const [showSearchPanel, setShowSearchPanel] = useState(false);
  const [searchTerm, setSearchTerm] = useState('');
  const [searchResults, setSearchResults] = useState<any[]>([]);
  const [searchLoading, setSearchLoading] = useState(false);
  const [analyzingRef, setAnalyzingRef] = useState<string | null>(null);
  const [addingQtd, setAddingQtd] = useState<{ ean: string; qtd: string } | null>(null);

  const fetchOfertas = async (force = false, search = "") => {
    setLoading(true);
    setError(null);
    try {
      let url = `/api/ofertas-dia/analisar?cnpj=${encodeURIComponent(cnpj)}`;
      if (force) url += '&force=true';
      if (search) url += `&q=${encodeURIComponent(search)}`;
      const res = await fetch(url);
      if (!res.ok) throw new Error('Erro ao buscar ofertas');
      const data = await res.json();
      setOfertas(data.ofertas || []);
      setSummary(data.summary || { totalOfertas: 0, ofertasBoas: 0, economiaPotencial: 0 });
      setDataLoaded(true);
    } catch (err: any) {
      setError(err.message);
    } finally {
      setLoading(false);
    }
  };

  const handleSearch = () => {
    if (!query.trim()) {
      fetchOfertas(false, "");
    } else {
      fetchOfertas(false, query.trim());
    }
  };

  const handleKeyDown = (e: React.KeyboardEvent) => {
    if (e.key === 'Enter') handleSearch();
  };

  const handleSearchProduct = async () => {
    if (!searchTerm.trim() || searchTerm.trim().length < 3) return;
    setSearchLoading(true);
    try {
      const res = await fetch(`/api/ofertas-dia/buscar-produto?q=${encodeURIComponent(searchTerm.trim())}`);
      const data = await res.json();
      setSearchResults(data.produtos || []);
    } catch {
      setSearchResults([]);
    } finally {
      setSearchLoading(false);
    }
  };

  const handleSearchKeyDown = (e: React.KeyboardEvent) => {
    if (e.key === 'Enter') handleSearchProduct();
  };

  const handleAnalyzeReference = async (produto: any) => {
    setAnalyzingRef(produto.ean || produto.descricao);
    try {
      const res = await fetch('/api/ofertas-dia/analisar-referencia', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          ean: produto.ean,
          descricao: produto.descricao,
          cnpj,
          estoque: produto.estoque || 0,
          melhorPreco: produto.melhorPreco || 0,
          labs: produto.labs || [],
          eans: produto.eans || [],
          dcb: produto.dcb,
          codConcentracao: produto.codConcentracao,
        }),
      });
      const data = await res.json();
      if (data.oferta) {
        setOfertas(prev => [data.oferta, ...prev]);
        setDataLoaded(true);
        setShowSearchPanel(false);
        setSearchTerm('');
        setSearchResults([]);
      }
    } catch {
    } finally {
      setAnalyzingRef(null);
    }
  };

  const filteredOfertas = useMemo(() => {
    let result = [...ofertas];
    if (filterBoas) {
      result = result.filter(o => o.boaOferta);
    }
    return result;
  }, [ofertas, filterBoas]);

  const getEconomiaColor = (percent: number) => {
    if (percent >= 15) return 'text-emerald-700 bg-emerald-50';
    if (percent >= 10) return 'text-amber-700 bg-amber-50';
    if (percent > 0) return 'text-blue-700 bg-blue-50';
    return 'text-gray-500 bg-gray-50';
  };

  return (
    <div className="fixed inset-0 z-[100] flex items-center justify-center bg-[#141414]/80 backdrop-blur-sm p-4">
      <div className="bg-white w-full max-w-6xl shadow-2xl flex flex-col max-h-[90vh]">
        {/* Header */}
        <div className="flex items-center justify-between p-4 border-b border-[#141414]/10 bg-amber-50">
          <div className="flex items-center gap-3">
            <div className="bg-amber-600 p-2 rounded-lg">
              <Tag className="w-5 h-5 text-white" />
            </div>
            <div>
              <h2 className="text-sm font-black text-[#141414] uppercase tracking-wider font-sans">
                Ofertas do Dia
              </h2>
              <p className="text-[10px] text-gray-500 font-sans uppercase font-medium mt-0.5">
                {summary.totalOfertas} ofertas | {summary.ofertasBoas} boas | Economia: {formatCurrency(summary.economiaPotencial)}/mês
              </p>
            </div>
          </div>
          <div className="flex items-center gap-2">
            <button
              onClick={() => setShowSearchPanel(!showSearchPanel)}
              className={`p-2 rounded-lg transition-colors ${showSearchPanel ? 'bg-amber-600 text-white' : 'bg-amber-100 text-amber-700 hover:bg-amber-200'}`}
              title="Buscar produto por descrição"
            >
              <Search className="w-4 h-4" />
            </button>
            <button onClick={onClose} className="text-gray-400 hover:text-[#141414] transition-colors p-1">
              <X className="w-5 h-5" />
            </button>
          </div>
        </div>

        {/* Filters */}
        <div className="p-3 bg-white border-b border-[#141414]/10 flex gap-3">
          <div className="relative flex-1">
            <Search className="absolute left-2.5 top-1/2 -translate-y-1/2 w-3.5 h-3.5 text-gray-400" />
            <input
              type="text"
              placeholder="Buscar produto (ex: atenolol 25mg)"
              value={query}
              onChange={(e) => setQuery(e.target.value)}
              onKeyDown={handleKeyDown}
              className="w-full pl-8 pr-3 py-1.5 bg-gray-50 border border-gray-200 text-[#141414] text-[10px] font-bold uppercase tracking-wider font-sans focus:outline-none focus:border-[#141414] focus:ring-1 focus:ring-[#141414] transition-all rounded-none"
            />
          </div>
          <button
            onClick={handleSearch}
            disabled={loading}
            className="px-3 py-1.5 text-[10px] font-bold uppercase tracking-wider border border-amber-600 bg-amber-600 text-white hover:bg-amber-700 transition-colors disabled:opacity-50"
          >
            {loading ? <Loader2 className="w-3 h-3 animate-spin" /> : 'Buscar'}
          </button>
          <button
            onClick={() => setFilterBoas(!filterBoas)}
            className={`px-3 py-1.5 text-[10px] font-bold uppercase tracking-wider border transition-colors ${
              filterBoas
                ? 'bg-emerald-600 text-white border-emerald-600'
                : 'bg-white text-gray-600 border-gray-200 hover:border-emerald-600'
            }`}
          >
            {filterBoas ? '✓ Boas' : 'Todas'}
          </button>
          <button
            onClick={() => fetchOfertas(true)}
            disabled={loading}
            className="px-3 py-1.5 text-[10px] font-bold uppercase tracking-wider border border-gray-200 hover:border-amber-600 transition-colors disabled:opacity-50"
          >
            {loading ? <Loader2 className="w-3 h-3 animate-spin" /> : 'Carregar Todas'}
          </button>
        </div>

        {/* Search Panel - Referencia */}
        {showSearchPanel && (
          <div className="p-3 bg-amber-50 border-b border-amber-200">
            <div className="flex items-center gap-2 mb-2">
              <Search className="w-3.5 h-3.5 text-amber-600" />
              <span className="text-[10px] font-bold uppercase tracking-wider text-amber-700">
                Buscar Produto (Referência)
              </span>
            </div>
            <div className="flex gap-2">
              <input
                type="text"
                placeholder="Buscar por EAN ou descrição (ex: 7898014560176 ou sorinan)"
                value={searchTerm}
                onChange={(e) => setSearchTerm(e.target.value)}
                onKeyDown={handleSearchKeyDown}
                className="flex-1 px-3 py-1.5 bg-white border border-amber-300 text-[#141414] text-[11px] font-sans focus:outline-none focus:border-amber-500 focus:ring-1 focus:ring-amber-500 rounded-none"
              />
              <button
                onClick={handleSearchProduct}
                disabled={searchLoading || searchTerm.trim().length < 3}
                className="px-3 py-1.5 text-[10px] font-bold uppercase tracking-wider border border-amber-600 bg-amber-600 text-white hover:bg-amber-700 transition-colors disabled:opacity-50"
              >
                {searchLoading ? <Loader2 className="w-3 h-3 animate-spin" /> : 'Buscar'}
              </button>
              <button
                onClick={() => { setShowSearchPanel(false); setSearchTerm(''); setSearchResults([]); }}
                className="px-3 py-1.5 text-[10px] font-bold uppercase tracking-wider border border-gray-300 bg-white text-gray-600 hover:border-gray-400 transition-colors"
              >
                Fechar
              </button>
            </div>
            {searchResults.length > 0 && (
              <div className="mt-2 max-h-48 overflow-y-auto border border-amber-200 bg-white">
                <div className="p-1.5 bg-amber-100 border-b border-amber-200">
                  <span className="text-[9px] font-bold uppercase text-amber-700">
                    {searchResults.length} produtos encontrados — clique para analisar
                  </span>
                </div>
                {searchResults.map((p, i) => (
                  <button
                    key={`${p.ean}-${i}`}
                    onClick={() => handleAnalyzeReference(p)}
                    disabled={analyzingRef === (p.ean || p.descricao)}
                    className="w-full text-left px-3 py-2 hover:bg-amber-50 border-b border-gray-100 last:border-0 flex items-center justify-between transition-colors disabled:opacity-50"
                  >
                    <div className="flex-1 min-w-0">
                      <div className="text-[11px] font-bold text-[#141414] truncate">
                        {p.descricao}
                      </div>
                      <div className="text-[9px] text-gray-500 font-sans">
                        {p.ean || 'Sem EAN'} | {p.grupo || '?'} | Est: {p.estoque} cx
                        {p.melhorPreco > 0 && ` | R$ ${p.melhorPreco.toFixed(2)}`}
                      </div>
                      {p.labs && p.labs.length > 1 && (
                        <div className="text-[8px] text-amber-600 font-sans mt-0.5">
                          {p.labs.length} labs: {p.labs.join(", ")}
                        </div>
                      )}
                    </div>
                    {analyzingRef === (p.ean || p.descricao) ? (
                      <Loader2 className="w-3 h-3 animate-spin text-amber-600 ml-2" />
                    ) : (
                      <span className="text-[9px] font-bold text-amber-600 uppercase ml-2 whitespace-nowrap">
                        Analisar →
                      </span>
                    )}
                  </button>
                ))}
              </div>
            )}
            {searchTerm.trim().length >= 3 && !searchLoading && searchResults.length === 0 && (
              <div className="mt-2 text-[10px] text-gray-500 font-sans italic">
                Nenhum produto encontrado para "{searchTerm}"
              </div>
            )}
          </div>
        )}

        {/* Content */}
        <div className="flex-1 overflow-auto bg-gray-50">
          {loading ? (
            <div className="flex items-center justify-center py-12">
              <Loader2 className="w-8 h-8 animate-spin text-amber-600" />
              <span className="ml-3 text-sm text-gray-500 font-sans">Analisando ofertas...</span>
            </div>
          ) : error ? (
            <div className="flex flex-col items-center justify-center py-12 text-red-600">
              <p className="text-sm font-bold font-sans">Erro ao carregar ofertas</p>
              <p className="text-xs mt-1">{error}</p>
              <button onClick={() => fetchOfertas(false, query)} className="mt-3 px-4 py-2 bg-red-600 text-white text-xs font-bold uppercase">
                Tentar Novamente
              </button>
            </div>
          ) : !dataLoaded ? (
            <div className="flex flex-col items-center justify-center py-16 text-gray-500">
              <Tag className="w-16 h-16 mb-4 opacity-20" />
              <p className="text-sm font-bold font-sans mb-1">Ofertas do Dia</p>
              <p className="text-xs text-center max-w-xs leading-relaxed">
                Digite o nome do produto e clique em <strong>Buscar</strong>, ou clique em <strong>Carregar Todas</strong> para ver todas as ofertas analisadas.
              </p>
            </div>
          ) : filteredOfertas.length === 0 ? (
            <div className="flex flex-col items-center justify-center py-12 text-gray-500">
              <Package className="w-12 h-12 mb-3 opacity-30" />
              <p className="text-sm font-bold font-sans">Nenhuma oferta encontrada</p>
              <p className="text-xs mt-1">Tente outro termo ou carregue todas as ofertas</p>
            </div>
          ) : (
            <div className="p-4 grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-4">
              {filteredOfertas.map((oferta, idx) => (
                <div
                  key={`${oferta.ean || idx}-${oferta.fornecedor}`}
                  className={`border-2 p-4 hover:shadow-lg transition-shadow ${
                    oferta.isReferencia
                      ? 'bg-amber-50 border-amber-300'
                      : oferta.boaOferta
                        ? 'bg-white border-emerald-500'
                        : 'bg-white border-gray-200'
                  }`}
                >
                  {/* Header do Card */}
                  <div className="flex items-start justify-between mb-3">
                    <div className="flex-1">
                      <h3 className="text-xs font-black text-[#141414] uppercase tracking-wider font-sans leading-tight">
                        {oferta.produto}
                      </h3>
                      {oferta.ean ? (
                        <p className="text-[10px] text-gray-500 font-mono mt-1">EAN: {oferta.ean}</p>
                      ) : (
                        <p className="text-[10px] text-amber-600 font-sans mt-1">⚠️ Sem EAN</p>
                      )}
                      {oferta.laboratorio && (
                        <p className="text-[10px] text-gray-500 font-sans mt-0.5">{oferta.laboratorio}</p>
                      )}
                    </div>
                    {oferta.boaOferta && (
                      <span className="bg-emerald-600 text-white text-[8px] font-bold uppercase px-2 py-0.5">
                        BOA
                      </span>
                    )}
                    {oferta.isReferencia && (
                      <span className="bg-amber-500 text-white text-[8px] font-bold uppercase px-2 py-0.5">
                        REFERENCIA
                      </span>
                    )}
                  </div>

                  {/* Preco Promocao */}
                  <div className="mb-2">
                    <div className="flex items-baseline gap-2">
                      <span className="text-lg font-black text-amber-600 font-sans">
                        {formatCurrency(oferta.preco)}
                        {oferta.discountPercent ? ` (${oferta.discountPercent}% off)` : ""}
                      </span>
                    </div>
                    <p className="text-xs font-black text-amber-700 font-sans mt-1">
                      {oferta.fornecedorLista || oferta.fornecedor || "N/A"}
                    </p>
                    {oferta.validade && (
                      <p className="text-[9px] text-gray-400 font-sans">Ate: {oferta.validade}</p>
                    )}
                  </div>

                  {/* Tiers de Preco (Preco Condicional) */}
                  {oferta.tiers && oferta.tiers.length > 0 && (
                    <div className="mb-3 border-2 border-orange-400 bg-orange-50 rounded-sm overflow-hidden">
                      <div className="bg-orange-400 text-white text-[9px] font-black uppercase px-2 py-1 flex items-center gap-1">
                        <Package className="w-3 h-3" />
                        PRECO CONDICIONAL — Quantidade Minima
                      </div>
                      <div className="px-2 py-1.5">
                        <div className="text-[9px] text-orange-800 font-sans mb-1">
                          Base: <span className="font-bold">{formatCurrency(oferta.preco)}</span> (sem minimo)
                        </div>
                        <div className="space-y-0.5">
                          {oferta.tiers.map((tier, idx) => {
                            const isBest = idx === oferta.tiers!.length - 1;
                            const savingsVsBase = oferta.preco > 0 ? ((oferta.preco - tier.price) / oferta.preco * 100) : 0;
                            return (
                              <div key={idx} className={`flex items-center justify-between text-[9px] px-1.5 py-0.5 ${isBest ? 'bg-emerald-100 border border-emerald-300 font-bold' : 'bg-white'}`}>
                                <span className="font-sans">
                                  <span className={`inline-block w-12 text-center font-mono font-bold ${isBest ? 'text-emerald-700' : 'text-gray-700'}`}>
                                    {tier.minQty}+
                                  </span>
                                  <span className="text-gray-400 mx-1">und</span>
                                </span>
                                <span className={`font-mono font-bold ${isBest ? 'text-emerald-700' : 'text-amber-700'}`}>
                                  {formatCurrency(tier.price)}
                                </span>
                                {savingsVsBase > 0 && (
                                  <span className={`font-sans ml-1 ${isBest ? 'text-emerald-600' : 'text-gray-500'}`}>
                                    (-{savingsVsBase.toFixed(0)}%)
                                  </span>
                                )}
                                {isBest && <span className="text-emerald-600 ml-1">★</span>}
                              </div>
                            );
                          })}
                        </div>
                      </div>
                    </div>
                  )}

                  {/* Comparacao de Precos */}
                  <div className="mb-3 p-2 bg-gray-50 border border-gray-100 text-[10px] font-sans space-y-1">
                    {oferta.melhorPrecoSmartPed ? (
                      <div className="flex justify-between">
                        <span className="text-gray-600">Melhor SmartPed:</span>
                        <div className="text-right">
                          <span className="font-bold text-[#141414]">
                            {formatCurrency(oferta.melhorPrecoSmartPed)} ({oferta.melhorDistribuidora})
                          </span>
                          {oferta.melhorEanSmartPed && (
                            <p className="text-[9px] text-gray-500 font-mono">
                              EAN: {oferta.melhorEanSmartPed}{oferta.melhorLabSmartPed ? ` | ${oferta.melhorLabSmartPed}` : ''}
                            </p>
                          )}
                        </div>
                      </div>
                    ) : (
                      <div className="flex justify-between">
                        <span className="text-gray-600">Melhor SmartPed:</span>
                        <span className="text-gray-400 italic">Não encontrado</span>
                      </div>
                    )}
                    {oferta.melhorPrecoPromocao && oferta.melhorPrecoSmartPed && oferta.melhorPrecoPromocao < oferta.melhorPrecoSmartPed && (
                      <div className="flex justify-between">
                        <span className="text-orange-600">Pedido mínimo:</span>
                        <div className="text-right">
                          <span className="font-bold text-orange-700">
                            {formatCurrency(oferta.melhorPrecoPromocao)} ({oferta.melhorDistPromocao})
                          </span>
                          <p className="text-[9px] text-orange-500">
                            {oferta.melhorQtdMinPromocao ? `${oferta.melhorQtdMinPromocao}un min` : ''} ·{oferta.melhorCondPromocao}{oferta.melhorEanPromocao ? ` ·EAN: ${oferta.melhorEanPromocao}` : ''}
                          </p>
                        </div>
                      </div>
                    )}
                    {oferta.melhorPrecoHistorico ? (
                      <div className="flex justify-between">
                        <span className="text-gray-600">Melhor que pagou:</span>
                        <span className="font-bold text-blue-700">
                          {formatCurrency(oferta.melhorPrecoHistorico)} ({oferta.melhorFornecedorHistorico})
                        </span>
                      </div>
                    ) : (
                      <div className="flex justify-between">
                        <span className="text-gray-600">Melhor que pagou:</span>
                        <span className="text-gray-400 italic">Sem histórico</span>
                      </div>
                    )}
                    {oferta.melhorPrecoSmartPed && (
                      <div className="flex justify-between border-t border-gray-200 pt-1">
                        <span className="text-gray-600 font-bold">Economia vs SmartPed:</span>
                        <span className={`font-bold ${oferta.economiaPercent > 0 ? 'text-emerald-700' : 'text-red-600'}`}>
                          {oferta.economiaPercent > 0 ? `-${oferta.economiaPercent}%` : '0%'}
                          {oferta.economiaValor > 0 && ` (${formatCurrency(oferta.economiaValor)})`}
                        </span>
                      </div>
                    )}
                  </div>

                  {/* Metricas */}
                  <div className="grid grid-cols-2 gap-2 mb-3">
                    <div className="text-center p-2 bg-gray-50">
                      <p className="text-[10px] text-gray-500 font-sans uppercase">Vendas</p>
                      <p className="text-xs font-bold text-[#141414] font-sans">{oferta.vendasMensais}/mes</p>
                    </div>
                    <div className="text-center p-2 bg-gray-50">
                      <p className="text-[10px] text-gray-500 font-sans uppercase">Estoque</p>
                      <p className="text-xs font-bold text-[#141414] font-sans">{oferta.estoqueMesmoEan} cx</p>
                    </div>
                  </div>

                  {/* Economia Mensal */}
                  {oferta.economiaMensal > 0 && (
                    <div className="mb-3 p-2 bg-emerald-50 border border-emerald-200">
                      <div className="flex items-center gap-2">
                        <TrendingUp className="w-3 h-3 text-emerald-600" />
                        <span className="text-[10px] font-bold text-emerald-700 font-sans uppercase">
                          Economia potencial: {formatCurrency(oferta.economiaMensal)}/mes
                        </span>
                      </div>
                    </div>
                  )}

                  {/* Botoes */}
                  <div className="flex gap-2">
                    {onAddToPedido && oferta.ean && (
                      <>
                        {addingQtd?.ean === oferta.ean ? (
                          <div className="flex-1 flex items-center gap-1">
                            <input
                              type="number"
                              min="1"
                              value={addingQtd.qtd}
                              onChange={(e) => setAddingQtd({ ...addingQtd, qtd: e.target.value })}
                              onKeyDown={(e) => {
                                if (e.key === 'Enter') {
                                  const qty = parseInt(addingQtd.qtd) || 1;
                                  onAddToPedido(oferta, qty);
                                  setAddingQtd(null);
                                }
                              }}
                              className="w-16 px-2 py-2 border border-amber-400 text-[11px] font-bold text-center focus:outline-none focus:ring-1 focus:ring-amber-500"
                              autoFocus
                            />
                            <button
                              onClick={() => {
                                const qty = parseInt(addingQtd.qtd) || 1;
                                onAddToPedido(oferta, qty);
                                setAddingQtd(null);
                              }}
                              className="px-3 py-2 bg-emerald-600 hover:bg-emerald-700 text-white text-[10px] font-bold uppercase transition-colors"
                            >
                              OK
                            </button>
                            <button
                              onClick={() => setAddingQtd(null)}
                              className="px-2 py-2 bg-gray-200 hover:bg-gray-300 text-gray-600 text-[10px] font-bold uppercase transition-colors"
                            >
                              X
                            </button>
                          </div>
                        ) : (
                          <button
                            onClick={() => setAddingQtd({ ean: oferta.ean, qtd: '1' })}
                            className="flex-1 py-2 bg-amber-600 hover:bg-amber-700 text-white text-[10px] font-bold uppercase tracking-wider flex items-center justify-center gap-2 transition-colors"
                          >
                            <ShoppingCart className="w-3 h-3" />
                            Adicionar
                          </button>
                        )}
                      </>
                    )}
                    <button
                      onClick={() => setDetalheAberto(oferta)}
                      className="px-3 py-2 bg-gray-100 hover:bg-gray-200 text-gray-700 text-[10px] font-bold uppercase tracking-wider transition-colors"
                    >
                      Detalhes
                    </button>
                  </div>
                </div>
              ))}
            </div>
          )}
        </div>
      </div>

      {/* Modal de Detalhes */}
      {detalheAberto && (
        <div className="fixed inset-0 z-[110] flex items-center justify-center bg-black/50 backdrop-blur-sm p-4">
          <div className="bg-white w-full max-w-2xl shadow-2xl flex flex-col max-h-[90vh]">
            {/* Header */}
            <div className="flex items-center justify-between p-4 border-b border-gray-200 bg-gray-50">
              <div>
                <h3 className="text-sm font-black text-[#141414] uppercase tracking-wider font-sans">
                  {detalheAberto.produto}
                </h3>
                <p className="text-[10px] text-gray-500 font-sans mt-0.5">
                  EAN: {detalheAberto.ean || "N/A"} | {detalheAberto.laboratorio || ""}
                </p>
              </div>
              <button onClick={() => setDetalheAberto(null)} className="text-gray-400 hover:text-[#141414] transition-colors p-1">
                <X className="w-5 h-5" />
              </button>
            </div>

            {/* Conteudo */}
            <div className="flex-1 overflow-auto p-4 space-y-4">
              {/* Preco Promocao */}
              <div className="p-3 bg-amber-50 border border-amber-200">
                <p className="text-[10px] text-gray-500 font-sans uppercase mb-1">Preco Promocao</p>
                <div className="flex items-baseline gap-2">
                  <span className="text-xl font-black text-amber-600 font-sans">
                    {formatCurrency(detalheAberto.preco)}
                    {detalheAberto.discountPercent ? ` (${detalheAberto.discountPercent}% off)` : ""}
                  </span>
                  <span className="text-[10px] text-gray-500 font-sans">
                    (valido ate {detalheAberto.validade || "N/A"})
                  </span>
                </div>
                <p className="text-xs font-black text-amber-700 font-sans mt-1">
                  {detalheAberto.fornecedorLista || detalheAberto.fornecedor || "N/A"}
                </p>
              </div>

              {/* Tiers de Preco (detail modal) */}
              {detalheAberto.tiers && detalheAberto.tiers.length > 0 && (
                <div className="p-3 bg-orange-50 border-2 border-orange-400">
                  <p className="text-[10px] text-orange-700 font-sans uppercase mb-2 font-black flex items-center gap-1">
                    <Package className="w-3 h-3" />
                    Faixas de Preco (Preco Condicional)
                  </p>
                  <table className="w-full text-[10px] font-sans">
                    <thead>
                      <tr className="text-orange-600 uppercase">
                        <th className="text-left py-1 px-2">Qtd Minima</th>
                        <th className="text-right py-1 px-2">Preco Unit.</th>
                        <th className="text-right py-1 px-2">Economia</th>
                      </tr>
                    </thead>
                    <tbody>
                      <tr className="border-t border-orange-200">
                        <td className="py-1 px-2 text-gray-600">1+ und (base)</td>
                        <td className="py-1 px-2 text-right font-bold text-amber-700">{formatCurrency(detalheAberto.preco)}</td>
                        <td className="py-1 px-2 text-right text-gray-400">—</td>
                      </tr>
                      {detalheAberto.tiers.map((tier, idx) => {
                        const isBest = idx === detalheAberto.tiers!.length - 1;
                        const savingsVsBase = detalheAberto.preco > 0 ? ((detalheAberto.preco - tier.price) / detalheAberto.preco * 100) : 0;
                        const savingsVsSmartPed = detalheAberto.melhorPrecoSmartPed ? ((detalheAberto.melhorPrecoSmartPed - tier.price) / detalheAberto.melhorPrecoSmartPed * 100) : 0;
                        return (
                          <tr key={idx} className={`border-t border-orange-200 ${isBest ? 'bg-emerald-50 font-bold' : ''}`}>
                            <td className="py-1 px-2">
                              <span className={`font-mono font-bold ${isBest ? 'text-emerald-700' : 'text-gray-700'}`}>
                                {tier.minQty}+ und
                              </span>
                              {isBest && <span className="text-emerald-600 ml-1">★ MELHOR</span>}
                            </td>
                            <td className={`py-1 px-2 text-right font-mono font-bold ${isBest ? 'text-emerald-700' : 'text-amber-700'}`}>
                              {formatCurrency(tier.price)}
                            </td>
                            <td className="py-1 px-2 text-right">
                              {savingsVsBase > 0 && (
                                <span className={isBest ? 'text-emerald-600' : 'text-gray-500'}>
                                  -{savingsVsBase.toFixed(0)}% vs base
                                </span>
                              )}
                              {savingsVsSmartPed > 0 && (
                                <span className="text-blue-600 ml-1">
                                  | -{savingsVsSmartPed.toFixed(0)}% vs SmartPed
                                </span>
                              )}
                            </td>
                          </tr>
                        );
                      })}
                    </tbody>
                  </table>
                </div>
              )}

              {/* Comparacao */}
              <div className="p-3 bg-gray-50 border border-gray-200">
                <p className="text-[10px] text-gray-500 font-sans uppercase mb-2">Comparacao</p>
                <div className="space-y-2 text-[10px] font-sans">
                  {detalheAberto.melhorPrecoSmartPed && (
                    <div className="flex justify-between">
                      <span className="text-gray-600">Melhor preco SmartPed:</span>
                      <div className="text-right">
                        <span className="font-bold text-[#141414]">
                          {formatCurrency(detalheAberto.melhorPrecoSmartPed)} ({detalheAberto.melhorDistribuidora})
                        </span>
                        {detalheAberto.melhorEanSmartPed && (
                          <p className="text-[9px] text-gray-500 font-mono">
                            EAN: {detalheAberto.melhorEanSmartPed}{detalheAberto.melhorLabSmartPed ? ` | ${detalheAberto.melhorLabSmartPed}` : ''}
                          </p>
                        )}
                      </div>
                    </div>
                  )}
                  {detalheAberto.melhorPrecoPromocao && detalheAberto.melhorPrecoSmartPed && detalheAberto.melhorPrecoPromocao < detalheAberto.melhorPrecoSmartPed && (
                    <div className="flex justify-between">
                      <span className="text-orange-600">Pedido minimo:</span>
                      <div className="text-right">
                        <span className="font-bold text-orange-700">
                          {formatCurrency(detalheAberto.melhorPrecoPromocao)} ({detalheAberto.melhorDistPromocao})
                        </span>
                        <p className="text-[9px] text-orange-500">
                          {detalheAberto.melhorQtdMinPromocao ? `${detalheAberto.melhorQtdMinPromocao}un min` : ''} ·{detalheAberto.melhorCondPromocao}{detalheAberto.melhorEanPromocao ? ` ·EAN: ${detalheAberto.melhorEanPromocao}` : ''}
                        </p>
                      </div>
                    </div>
                  )}
                  {detalheAberto.melhorPrecoHistorico && (
                    <div className="flex justify-between">
                      <span className="text-gray-600">Melhor que voce ja pagou:</span>
                      <span className="font-bold text-blue-700">
                        {formatCurrency(detalheAberto.melhorPrecoHistorico)} ({detalheAberto.melhorFornecedorHistorico})
                      </span>
                    </div>
                  )}
                  <div className="flex justify-between border-t border-gray-200 pt-2">
                    <span className="text-gray-600 font-bold">Economia vs SmartPed:</span>
                    <span className={`font-bold ${detalheAberto.economiaPercent > 0 ? 'text-emerald-700' : 'text-red-600'}`}>
                      {detalheAberto.economiaPercent > 0 ? `-${detalheAberto.economiaPercent}%` : '0%'}
                      {detalheAberto.economiaValor > 0 && ` (${formatCurrency(detalheAberto.economiaValor)})`}
                    </span>
                  </div>
                </div>
              </div>

              {/* Estoque por Laboratorio */}
              {detalheAberto.estoquePorLaboratorio.length > 0 && (
                <div className="p-3 bg-gray-50 border border-gray-200">
                  <p className="text-[10px] text-gray-500 font-sans uppercase mb-2">Estoque por Laboratorio (mesma composicao)</p>
                  <div className="space-y-1">
                    {detalheAberto.estoquePorLaboratorio.map((lab, i) => {
                      const total = detalheAberto.estoquePorLaboratorio.reduce((s, l) => s + l.quantidade, 0);
                      const percent = total > 0 ? Math.round((lab.quantidade / total) * 100) : 0;
                      const isMesmoEan = lab.eans.includes(detalheAberto.ean);
                      return (
                        <div key={i} className={`flex items-center gap-2 text-[10px] font-sans ${isMesmoEan ? 'font-bold' : ''}`}>
                          <span className="w-28 text-[#141414]">
                            {lab.nome}
                            {isMesmoEan && <span className="text-amber-600 ml-1">*</span>}
                          </span>
                          <div className="flex-1 bg-gray-200 h-2">
                            <div className={`h-2 ${isMesmoEan ? 'bg-amber-500' : 'bg-blue-400'}`} style={{ width: `${percent}%` }} />
                          </div>
                          <span className="w-16 text-right text-gray-600">{lab.quantidade} cx</span>
                          <span className="w-10 text-right text-gray-400">{percent}%</span>
                        </div>
                      );
                    })}
                  </div>
                  <div className="flex justify-between items-center mt-2 pt-2 border-t border-gray-200">
                    <p className="text-[10px] text-gray-500 font-sans">
                      * = mesmo EAN da promocao
                    </p>
                    <p className="text-[10px] text-gray-600 font-sans font-bold">
                      Total: {detalheAberto.estoqueTotal} cx
                    </p>
                  </div>
                </div>
              )}

              {/* Historico de Compras */}
              {detalheAberto.comprasHistorico.length > 0 && (
                <div className="p-3 bg-gray-50 border border-gray-200">
                  <p className="text-[10px] text-gray-500 font-sans uppercase mb-2">Seus Precos (Ultimos 6 meses)</p>
                  <div className="overflow-x-auto">
                    <table className="w-full text-[10px] font-sans">
                      <thead>
                        <tr className="border-b border-gray-200">
                          <th className="text-left py-1 px-2 font-bold text-gray-600">Custo Real</th>
                          <th className="text-left py-1 px-2 font-bold text-gray-600">Tabela</th>
                          <th className="text-left py-1 px-2 font-bold text-gray-600">Fornecedor</th>
                          <th className="text-left py-1 px-2 font-bold text-gray-600">Lab</th>
                          <th className="text-left py-1 px-2 font-bold text-gray-600">Data</th>
                          <th className="text-right py-1 px-2 font-bold text-gray-600">Qtd</th>
                          <th className="text-right py-1 px-2 font-bold text-gray-600">NF</th>
                        </tr>
                      </thead>
                      <tbody>
                        {detalheAberto.comprasHistorico.map((compra, i) => {
                          const isMelhor = compra.preco === detalheAberto.melhorPrecoHistorico;
                          const desconto = compra.precoTabela > 0 
                            ? Math.round(((compra.precoTabela - compra.preco) / compra.precoTabela) * 100) 
                            : 0;
                          return (
                            <tr key={i} className={`border-b border-gray-100 ${isMelhor ? 'bg-emerald-50' : ''}`}>
                              <td className="py-1 px-2 font-bold text-[#141414]">
                                {formatCurrency(compra.preco)}
                                {isMelhor && <span className="text-emerald-600 ml-1">★</span>}
                              </td>
                              <td className="py-1 px-2 text-gray-500">
                                {formatCurrency(compra.precoTabela)}
                                {desconto > 0 && <span className="text-emerald-600 ml-1">(-{desconto}%)</span>}
                              </td>
                              <td className="py-1 px-2 text-gray-600">{compra.fornecedor}</td>
                              <td className="py-1 px-2 text-gray-500 text-[9px]">{compra.laboratorio || '-'}</td>
                              <td className="py-1 px-2 text-gray-500">{compra.data}</td>
                              <td className="py-1 px-2 text-right text-gray-500">{compra.quantidade}</td>
                              <td className="py-1 px-2 text-right text-gray-400">{compra.notaFiscal || "-"}</td>
                            </tr>
                          );
                        })}
                      </tbody>
                    </table>
                  </div>
                </div>
              )}

              {/* Ultima Compra */}
              {detalheAberto.ultimaCompra && (
                <div className="p-3 bg-blue-50 border border-blue-200">
                  <p className="text-[10px] text-gray-500 font-sans uppercase mb-1">Ultima Compra</p>
                  <div className="text-[10px] font-sans space-y-0.5">
                    <p className="text-[#141414]">
                      <span className="font-bold">{formatCurrency(detalheAberto.ultimaCompra.preco)}</span>
                      {" "}em {detalheAberto.ultimaCompra.data}
                    </p>
                    <p className="text-gray-600">
                      Fornecedor: {detalheAberto.ultimaCompra.fornecedor}
                    </p>
                    <p className="text-gray-600">
                      Quantidade: {detalheAberto.ultimaCompra.quantidade} cx
                    </p>
                  </div>
                </div>
              )}

              {/* Metricas */}
              <div className="grid grid-cols-2 gap-2">
                <div className="text-center p-2 bg-gray-50 border border-gray-200">
                  <p className="text-[10px] text-gray-500 font-sans uppercase">Vendas</p>
                  <p className="text-sm font-bold text-[#141414] font-sans">{detalheAberto.vendasMensais}/mes</p>
                </div>
                <div className="text-center p-2 bg-gray-50 border border-gray-200">
                  <p className="text-[10px] text-gray-500 font-sans uppercase">Estoque</p>
                  <p className="text-sm font-bold text-[#141414] font-sans">{detalheAberto.estoqueMesmoEan} cx</p>
                </div>
              </div>

              {/* Economia Mensal */}
              {detalheAberto.economiaMensal > 0 && (
                <div className="p-3 bg-emerald-50 border border-emerald-200">
                  <div className="flex items-center gap-2">
                    <TrendingUp className="w-4 h-4 text-emerald-600" />
                    <span className="text-xs font-bold text-emerald-700 font-sans uppercase">
                      Economia potencial: {formatCurrency(detalheAberto.economiaMensal)}/mes
                    </span>
                  </div>
                </div>
              )}
            </div>

            {/* Footer */}
            <div className="p-4 border-t border-gray-200 bg-gray-50 flex gap-2">
              {onAddToPedido && detalheAberto.ean && (
                <div className="flex-1 flex items-center gap-2">
                  <span className="text-[10px] font-bold text-gray-600 uppercase">Qtd:</span>
                  <input
                    type="number"
                    min="1"
                    defaultValue="1"
                    id="detalhe-qtd"
                    className="w-16 px-2 py-2 border border-amber-400 text-[11px] font-bold text-center focus:outline-none focus:ring-1 focus:ring-amber-500"
                  />
                  <button
                    onClick={() => {
                      const input = document.getElementById('detalhe-qtd') as HTMLInputElement;
                      const qty = parseInt(input?.value || '1') || 1;
                      onAddToPedido(detalheAberto, qty);
                      setDetalheAberto(null);
                    }}
                    className="flex-1 py-2 bg-amber-600 hover:bg-amber-700 text-white text-[10px] font-bold uppercase tracking-wider flex items-center justify-center gap-2 transition-colors"
                  >
                    <ShoppingCart className="w-3 h-3" />
                    Adicionar ao Pedido
                  </button>
                </div>
              )}
              <button
                onClick={() => setDetalheAberto(null)}
                className="px-4 py-2 bg-gray-200 hover:bg-gray-300 text-gray-700 text-[10px] font-bold uppercase tracking-wider transition-colors"
              >
                Fechar
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
