import React, { useState, useMemo } from 'react';
import { X, Search, Tag, TrendingUp, Package, ShoppingCart, Loader2, Filter } from 'lucide-react';
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
  descartada?: boolean;
  motivoDescarte?: string;
  naoEncontradoEmNenhumSistema?: boolean;
  erro?: boolean;
  semEan?: boolean;
  description?: string;
  discountPercent?: number;
  isReferencia?: boolean;
  tiers?: { minQty: number; price: number }[];
  discountTiers?: { minQty: number; discountPercent: number }[];
  bestTierPrice?: number;
  smartPedCondicoesTodas?: { distribuidora: string; ean: string; laboratorio: string; precoBruto: number; desconto: number; descExtra: number; valorST: number; precoLiquido: number; qtdMin: number; condicao: string }[];
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
  const [addingQtd, setAddingQtd] = useState<{ ean: string; qtd: string; selectedPrice?: number } | null>(null);
  const [filterFornecedor, setFilterFornecedor] = useState('');

  const fetchOfertas = async (search = "") => {
    setLoading(true);
    setError(null);
    try {
      let url = `/api/ofertas-dia/analisar?cnpj=${encodeURIComponent(cnpj)}`;
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
      fetchOfertas("");
    } else {
      fetchOfertas(query.trim());
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

  const fornecedoresDisponiveis = useMemo(() => {
    const names = ofertas.map(o => o.fornecedorLista || o.fornecedor).filter(Boolean);
    return [...new Set(names)].sort();
  }, [ofertas]);

  const filteredOfertas = useMemo(() => {
    let result = ofertas.filter(o => !o.descartada);
    if (filterBoas) {
      result = result.filter(o => o.boaOferta);
    }
    if (filterFornecedor) {
      result = result.filter(o => (o.fornecedorLista || o.fornecedor) === filterFornecedor);
    }
    return result;
  }, [ofertas, filterBoas, filterFornecedor]);

  const descartadasCount = useMemo(() => ofertas.filter(o => o.descartada).length, [ofertas]);
  const ofertasValidasCount = useMemo(() => ofertas.filter(o => !o.descartada).length, [ofertas]);

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
        <div className="flex items-center justify-between p-3 border-b border-[#141414]/10 bg-amber-50">
          <div className="flex items-center gap-3">
            <div className="bg-amber-600 p-2 rounded-lg">
              <Tag className="w-5 h-5 text-white" />
            </div>
            <div>
              <h2 className="text-sm font-black text-[#141414] uppercase tracking-wider font-sans">
                Ofertas do Dia
              </h2>
              <p className="text-[10px] text-gray-500 font-sans uppercase font-medium mt-0.5">
                {filteredOfertas.length} de {ofertasValidasCount} ofertas
                {summary.ofertasBoas > 0 && ` | ${summary.ofertasBoas} boas (≥10%)`}
                {descartadasCount > 0 && ` | ${descartadasCount} descartadas`}
                {` | Economia: ${formatCurrency(summary.economiaPotencial)}/mês`}
              </p>
            </div>
          </div>
          <div className="flex items-center gap-2">
            <button
              onClick={() => setShowSearchPanel(!showSearchPanel)}
              className={`flex items-center gap-1.5 px-2.5 py-1.5 rounded-lg text-[10px] font-bold uppercase tracking-wider transition-colors ${showSearchPanel ? 'bg-amber-600 text-white' : 'bg-amber-100 text-amber-700 hover:bg-amber-200'}`}
              title="Busca Avulsa — buscar e analisar um produto específico"
            >
              <Search className="w-3.5 h-3.5" />
              <span className="hidden sm:inline">Busca Avulsa</span>
            </button>
            <button onClick={onClose} className="text-gray-400 hover:text-[#141414] transition-colors p-1">
              <X className="w-5 h-5" />
            </button>
          </div>
        </div>

        {/* Filters */}
        <div className="p-3 bg-white border-b border-[#141414]/10 space-y-2">
          {/* Row 1: Busca por texto */}
          <div className="flex gap-2">
            <div className="relative flex-1">
              <Search className="absolute left-2.5 top-1/2 -translate-y-1/2 w-3.5 h-3.5 text-gray-400" />
              <input
                type="text"
                placeholder="Filtrar ofertas carregadas (ex: atenolol 25mg)"
                value={query}
                onChange={(e) => setQuery(e.target.value)}
                onKeyDown={handleKeyDown}
                className="w-full pl-8 pr-3 py-1.5 bg-gray-50 border border-gray-200 text-[#141414] text-[10px] font-sans focus:outline-none focus:border-[#141414] focus:ring-1 focus:ring-[#141414] transition-all rounded-none"
              />
            </div>
            <button
              onClick={handleSearch}
              disabled={loading}
              className="px-3 py-1.5 text-[10px] font-bold uppercase tracking-wider border border-amber-600 bg-amber-600 text-white hover:bg-amber-700 transition-colors disabled:opacity-50"
            >
              {loading ? <Loader2 className="w-3 h-3 animate-spin" /> : 'Filtrar'}
            </button>
          </div>
          {/* Row 2: Filtros (fornecedor + boas + atualizar) */}
          <div className="flex items-center gap-2 flex-wrap">
            <div className="flex items-center gap-1.5">
              <Filter className="w-3 h-3 text-gray-400" />
              <select
                value={filterFornecedor}
                onChange={(e) => setFilterFornecedor(e.target.value)}
                className="text-[10px] font-bold uppercase tracking-wider border border-gray-200 bg-white text-gray-700 px-2 py-1.5 rounded-none focus:outline-none focus:border-[#141414] cursor-pointer"
              >
                <option value="">Todos os fornecedores</option>
                {fornecedoresDisponiveis.map(f => (
                  <option key={f} value={f}>{f}</option>
                ))}
              </select>
            </div>
            <button
              onClick={() => setFilterBoas(!filterBoas)}
              title={filterBoas ? 'Mostrar todas as ofertas (inclui descartadas e sem economia)' : 'Filtrar apenas ofertas com economia >= 10% vs SmartPed'}
              className={`px-3 py-1.5 text-[10px] font-bold uppercase tracking-wider border transition-colors ${
                filterBoas
                  ? 'bg-emerald-600 text-white border-emerald-600'
                  : 'bg-white text-gray-600 border-gray-200 hover:border-emerald-600'
              }`}
            >
              {filterBoas ? '✓ Boas' : 'Apenas Boas'}
            </button>
          </div>
        </div>

        {/* Search Panel - Referencia */}
        {showSearchPanel && (
          <div className="p-3 bg-amber-50 border-b border-amber-200">
            <div className="flex items-center gap-2 mb-2">
              <Search className="w-3.5 h-3.5 text-amber-600" />
              <span className="text-[10px] font-bold uppercase tracking-wider text-amber-700">
                Busca Avulsa — EAN ou Descrição
              </span>
            </div>
            <div className="flex gap-2">
              <input
                type="text"
                placeholder="EAN (ex: 7898014560176) ou descrição (ex: sorinan 10mg)"
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
              <button onClick={() => fetchOfertas(query)} className="mt-3 px-4 py-2 bg-red-600 text-white text-xs font-bold uppercase">
                Tentar Novamente
              </button>
            </div>
          ) : !dataLoaded ? (
            <div className="flex flex-col items-center justify-center py-16 text-gray-500">
              <Tag className="w-16 h-16 mb-4 opacity-20" />
              <p className="text-sm font-bold font-sans mb-1">Ofertas do Dia</p>
              <p className="text-xs text-center max-w-xs leading-relaxed">
                As ofertas são analisadas automaticamente ao salvar listas de fornecedores.
                Use a <strong>Busca Avulsa</strong> (botão acima) para analisar um produto específico.
              </p>
            </div>
          ) : filteredOfertas.length === 0 ? (
            <div className="flex flex-col items-center justify-center py-12 text-gray-500">
              <Package className="w-12 h-12 mb-3 opacity-30" />
              <p className="text-sm font-bold font-sans">Nenhuma oferta encontrada</p>
              <p className="text-xs mt-1 text-center max-w-xs">
                {filterBoas
                  ? 'Nenhuma oferta com economia ≥ 10% vs SmartPed. Desative o filtro "Apenas Boas" para ver todas.'
                  : filterFornecedor
                    ? `Nenhuma oferta de "${filterFornecedor}". Tente outro fornecedor.`
                    : 'Nenhum resultado para este filtro. Tente outro termo ou remova os filtros.'}
              </p>
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

                  {/* Chips compactos — info rapida */}
                  <div className="flex flex-wrap gap-1 mb-3">
                    {oferta.melhorPrecoSmartPed && (
                      <span className="inline-flex items-center gap-0.5 px-1.5 py-0.5 text-[9px] font-bold rounded-full bg-blue-50 text-blue-700 border border-blue-200">
                        smartped {formatCurrency(oferta.melhorPrecoSmartPed)} ({oferta.melhorDistribuidora}) · <span className="font-mono">{oferta.melhorEanSmartPed || '—'}</span>
                      </span>
                    )}
                    {!oferta.melhorPrecoSmartPed && oferta.naoEncontradoEmNenhumSistema && (
                      <span className="inline-flex items-center px-1.5 py-0.5 text-[9px] font-bold rounded-full bg-yellow-100 text-yellow-700 border border-yellow-300">
                        Nao encontrado — verificar manualmente
                      </span>
                    )}
                    {!oferta.melhorPrecoSmartPed && !oferta.naoEncontradoEmNenhumSistema && (
                      <span className="inline-flex items-center px-1.5 py-0.5 text-[9px] font-bold rounded-full bg-gray-100 text-gray-400 border border-gray-200 italic">
                        smartped: nao encontrado
                      </span>
                    )}
                    {oferta.economiaPercent > 0 && (
                      <span className="inline-flex items-center px-1.5 py-0.5 text-[9px] font-bold rounded-full bg-emerald-50 text-emerald-700 border border-emerald-200">
                        -{oferta.economiaPercent}% vs smartped
                      </span>
                    )}
                    {oferta.vendasMensais > 0 && (
                      <span className="inline-flex items-center px-1.5 py-0.5 text-[9px] font-bold rounded-full bg-gray-50 text-gray-600 border border-gray-200">
                        {oferta.vendasMensais}/mês
                      </span>
                    )}
                    <span className="inline-flex items-center px-1.5 py-0.5 text-[9px] font-bold rounded-full bg-gray-50 text-gray-600 border border-gray-200">
                      {oferta.estoqueTotal} cx estoque
                    </span>
                    {oferta.melhorPrecoHistorico && (
                      <span className="inline-flex items-center px-1.5 py-0.5 text-[9px] font-bold rounded-full bg-violet-50 text-violet-700 border border-violet-200">
                        pago antes {formatCurrency(oferta.melhorPrecoHistorico)} ({oferta.melhorFornecedorHistorico})
                      </span>
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

                  {/* Tiers de Desconto (Desconto Condicional) */}
                  {!oferta.tiers && oferta.discountTiers && oferta.discountTiers.length > 0 && (
                    <div className="mb-3 border-2 border-violet-400 bg-violet-50 rounded-sm overflow-hidden">
                      <div className="bg-violet-400 text-white text-[9px] font-black uppercase px-2 py-1 flex items-center gap-1">
                        <Package className="w-3 h-3" />
                        DESCONTO CONDICIONAL — Quantidade Minima
                      </div>
                      <div className="px-2 py-1.5">
                        <div className="space-y-0.5">
                          {oferta.discountTiers.map((tier, idx) => {
                            const isBest = idx === oferta.discountTiers!.length - 1;
                            return (
                              <div key={idx} className={`flex items-center justify-between text-[9px] px-1.5 py-0.5 ${isBest ? 'bg-emerald-100 border border-emerald-300 font-bold' : 'bg-white'}`}>
                                <span className="font-sans">
                                  <span className={`inline-block w-12 text-center font-mono font-bold ${isBest ? 'text-emerald-700' : 'text-gray-700'}`}>
                                    {tier.minQty}+
                                  </span>
                                  <span className="text-gray-400 mx-1">und</span>
                                </span>
                                <span className={`font-mono font-bold ${isBest ? 'text-emerald-700' : 'text-violet-700'}`}>
                                  {tier.discountPercent}% desc
                                </span>
                                {isBest && <span className="text-emerald-600 ml-1">★</span>}
                              </div>
                            );
                          })}
                        </div>
                      </div>
                    </div>
                  )}

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
                          <div className="flex-1 flex items-center gap-1">
                            <select
                              onChange={(e) => {
                                const val = e.target.value;
                                if (val === '') return;
                                if (val === 'base') {
                                  setAddingQtd({ ean: oferta.ean, qtd: '1', selectedPrice: oferta.preco });
                                } else if (val === 'smartped') {
                                  setAddingQtd({ ean: oferta.melhorEanSmartPed || oferta.ean, qtd: '1', selectedPrice: oferta.melhorPrecoSmartPed || 0 });
                                } else {
                                  const idx = parseInt(val);
                                  const tier = oferta.tiers![idx];
                                  setAddingQtd({ ean: oferta.ean, qtd: String(tier.minQty), selectedPrice: tier.price });
                                }
                              }}
                              defaultValue=""
                              className="flex-1 bg-white border border-amber-400 text-[10px] font-bold text-gray-800 rounded-sm px-2 py-2 focus:ring-1 focus:ring-amber-500 focus:outline-none cursor-pointer"
                            >
                              <option value="" disabled>Adicionar ▼</option>
                              <optgroup label="PROMOCAO">
                                <option value="base">{oferta.fornecedorLista || oferta.fornecedor} | {formatCurrency(oferta.preco)} | Sem minimo</option>
                                {oferta.tiers && oferta.tiers.map((tier, idx) => {
                                  const isBest = idx === oferta.tiers!.length - 1;
                                  const savings = oferta.preco > 0 ? ((oferta.preco - tier.price) / oferta.preco * 100) : 0;
                                  return (
                                    <option key={idx} value={idx}>
                                      {oferta.fornecedorLista || oferta.fornecedor} | {formatCurrency(tier.price)} | {tier.minQty}+ und{isBest ? ' ★' : ''}{savings > 0 ? ` (-${savings.toFixed(0)}%)` : ''}
                                    </option>
                                  );
                                })}
                              </optgroup>
                              {oferta.melhorPrecoSmartPed && oferta.melhorPrecoSmartPed > 0 && (
                                <optgroup label="SMARTPED">
                                  <option value="smartped">{oferta.melhorDistribuidora} | {formatCurrency(oferta.melhorPrecoSmartPed)} | Melhor SmartPed</option>
                                </optgroup>
                              )}
                            </select>
                          </div>
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

              {/* Chips compactos — info rapida (modal) */}
              <div className="flex flex-wrap gap-1">
                {detalheAberto.melhorPrecoSmartPed && (
                  <span className="inline-flex items-center gap-0.5 px-1.5 py-0.5 text-[9px] font-bold rounded-full bg-blue-50 text-blue-700 border border-blue-200">
                    smartped {formatCurrency(detalheAberto.melhorPrecoSmartPed)} ({detalheAberto.melhorDistribuidora}) · <span className="font-mono">{detalheAberto.melhorEanSmartPed || '—'}</span>
                  </span>
                )}
                {!detalheAberto.melhorPrecoSmartPed && detalheAberto.naoEncontradoEmNenhumSistema && (
                  <span className="inline-flex items-center px-1.5 py-0.5 text-[9px] font-bold rounded-full bg-yellow-100 text-yellow-700 border border-yellow-300">
                    Nao encontrado — verificar manualmente
                  </span>
                )}
                {!detalheAberto.melhorPrecoSmartPed && !detalheAberto.naoEncontradoEmNenhumSistema && (
                  <span className="inline-flex items-center px-1.5 py-0.5 text-[9px] font-bold rounded-full bg-gray-100 text-gray-400 border border-gray-200 italic">
                    smartped: nao encontrado
                  </span>
                )}
                {detalheAberto.economiaPercent > 0 && (
                  <span className="inline-flex items-center px-1.5 py-0.5 text-[9px] font-bold rounded-full bg-emerald-50 text-emerald-700 border border-emerald-200">
                    -{detalheAberto.economiaPercent}% vs smartped
                  </span>
                )}
                {detalheAberto.vendasMensais > 0 && (
                  <span className="inline-flex items-center px-1.5 py-0.5 text-[9px] font-bold rounded-full bg-gray-50 text-gray-600 border border-gray-200">
                    {detalheAberto.vendasMensais}/mês
                  </span>
                )}
                <span className="inline-flex items-center px-1.5 py-0.5 text-[9px] font-bold rounded-full bg-gray-50 text-gray-600 border border-gray-200">
                  {detalheAberto.estoqueTotal} cx estoque
                </span>
                {detalheAberto.melhorPrecoHistorico && (
                  <span className="inline-flex items-center px-1.5 py-0.5 text-[9px] font-bold rounded-full bg-violet-50 text-violet-700 border border-violet-200">
                    pago antes {formatCurrency(detalheAberto.melhorPrecoHistorico)} ({detalheAberto.melhorFornecedorHistorico})
                  </span>
                )}
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

              {/* Breakdown completo por distribuidor */}
              {detalheAberto.smartPedCondicoesTodas && detalheAberto.smartPedCondicoesTodas.length > 0 ? (
                <div className="p-3 bg-gray-50 border border-gray-200">
                  <p className="text-[10px] text-gray-500 font-sans uppercase mb-2">Todas as condicoes SmartPed (por preco)</p>
                  <div className="overflow-x-auto">
                    <table className="w-full text-[10px] font-sans">
                      <thead>
                        <tr className="border-b border-gray-200">
                          <th className="text-left py-1 px-1 font-bold text-gray-600">Distribuidora</th>
                          <th className="text-left py-1 px-1 font-bold text-gray-600 font-mono">EAN</th>
                          <th className="text-left py-1 px-1 font-bold text-gray-600">Lab</th>
                          <th className="text-right py-1 px-1 font-bold text-gray-600">Bruto</th>
                          <th className="text-right py-1 px-1 font-bold text-gray-600">Desc</th>
                          <th className="text-right py-1 px-1 font-bold text-gray-600">Extra</th>
                          <th className="text-right py-1 px-1 font-bold text-gray-600">ST</th>
                          <th className="text-right py-1 px-1 font-bold text-gray-600">Liquido</th>
                          <th className="text-right py-1 px-1 font-bold text-gray-600">Qtd Mín</th>
                        </tr>
                      </thead>
                      <tbody>
                        {detalheAberto.smartPedCondicoesTodas.map((cond, i) => {
                          const isBest = i === 0;
                          return (
                            <tr key={i} className={`border-b border-gray-100 ${isBest ? 'bg-emerald-50 font-bold' : ''}`}>
                              <td className="py-1 px-1 text-[#141414]">
                                {cond.distribuidora}
                                {isBest && <span className="text-emerald-600 ml-1">★</span>}
                              </td>
                              <td className="py-1 px-1 font-mono text-gray-600">{cond.ean || '—'}</td>
                              <td className="py-1 px-1 text-gray-500">{cond.laboratorio || '—'}</td>
                              <td className="py-1 px-1 text-right text-gray-500">{cond.precoBruto > 0 ? formatCurrency(cond.precoBruto) : '—'}</td>
                              <td className="py-1 px-1 text-right text-gray-500">{cond.desconto > 0 ? `${cond.desconto}%` : '—'}</td>
                              <td className="py-1 px-1 text-right text-gray-500">{cond.descExtra > 0 ? formatCurrency(cond.descExtra) : '—'}</td>
                              <td className="py-1 px-1 text-right text-gray-500">{cond.valorST > 0 ? formatCurrency(cond.valorST) : '—'}</td>
                              <td className={`py-1 px-1 text-right font-mono ${isBest ? 'text-emerald-700 font-bold' : 'text-[#141414]'}`}>
                                {formatCurrency(cond.precoLiquido)}
                              </td>
                              <td className="py-1 px-1 text-right">
                                {cond.qtdMin > 1 && (
                                  <span className="inline-flex items-center px-1.5 py-0.5 rounded text-[9px] font-medium bg-orange-100 text-orange-700">
                                    min {cond.qtdMin}un
                                  </span>
                                )}
                                {cond.condicao !== "FIXA" && (
                                  <span className="text-[9px] text-purple-600 ml-1">
                                    {cond.condicao.toLowerCase()}
                                  </span>
                                )}
                              </td>
                            </tr>
                          );
                        })}
                      </tbody>
                    </table>
                  </div>
                </div>
              ) : (
                <div className="p-3 bg-gray-50 border border-gray-200">
                  <p className="text-[10px] text-gray-500 font-sans uppercase mb-1">Condicoes SmartPed</p>
                  <p className="text-[10px] text-gray-400 italic font-sans">Nao encontrado</p>
                </div>
              )}

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
                  <p className="text-[10px] text-gray-500 font-sans uppercase">Vendas (4m)</p>
                  <p className="text-sm font-bold text-[#141414] font-sans">{detalheAberto.vendasMensais}/mês</p>
                </div>
                <div className="text-center p-2 bg-gray-50 border border-gray-200">
                  <p className="text-[10px] text-gray-500 font-sans uppercase">Estoque</p>
                  <p className="text-sm font-bold text-[#141414] font-sans">{detalheAberto.estoqueTotal} cx</p>
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
                  <select
                    onChange={(e) => {
                      const val = e.target.value;
                      if (val === '') return;
                      if (val === 'base') {
                        setAddingQtd({ ean: detalheAberto.ean, qtd: '1', selectedPrice: detalheAberto.preco });
                      } else if (val === 'smartped') {
                        setAddingQtd({ ean: detalheAberto.melhorEanSmartPed || detalheAberto.ean, qtd: '1', selectedPrice: detalheAberto.melhorPrecoSmartPed || 0 });
                      } else {
                        const idx = parseInt(val);
                        const tier = detalheAberto.tiers![idx];
                        setAddingQtd({ ean: detalheAberto.ean, qtd: String(tier.minQty), selectedPrice: tier.price });
                      }
                    }}
                    defaultValue=""
                    className="px-2 py-2 border border-amber-400 text-[10px] font-bold bg-white focus:outline-none focus:ring-1 focus:ring-amber-500 cursor-pointer"
                  >
                    <option value="" disabled>Adicionar ▼</option>
                    <optgroup label="PROMOCAO">
                      <option value="base">{detalheAberto.fornecedorLista || detalheAberto.fornecedor} | {formatCurrency(detalheAberto.preco)} | Sem minimo</option>
                      {detalheAberto.tiers && detalheAberto.tiers.map((tier, idx) => {
                        const isBest = idx === detalheAberto.tiers!.length - 1;
                        const savings = detalheAberto.preco > 0 ? ((detalheAberto.preco - tier.price) / detalheAberto.preco * 100) : 0;
                        return (
                          <option key={idx} value={idx}>
                            {detalheAberto.fornecedorLista || detalheAberto.fornecedor} | {formatCurrency(tier.price)} | {tier.minQty}+ und{isBest ? ' ★' : ''}{savings > 0 ? ` (-${savings.toFixed(0)}%)` : ''}
                          </option>
                        );
                      })}
                    </optgroup>
                    {detalheAberto.melhorPrecoSmartPed && detalheAberto.melhorPrecoSmartPed > 0 && (
                      <optgroup label="SMARTPED">
                        <option value="smartped">{detalheAberto.melhorDistribuidora} | {formatCurrency(detalheAberto.melhorPrecoSmartPed)} | Melhor SmartPed</option>
                      </optgroup>
                    )}
                  </select>
                  <span className="text-[10px] font-bold text-gray-600 uppercase">Qtd:</span>
                  <input
                    type="number"
                    min="1"
                    value={addingQtd?.ean === detalheAberto.ean ? addingQtd.qtd : '1'}
                    onChange={(e) => setAddingQtd({ ...addingQtd, ean: detalheAberto.ean, qtd: e.target.value })}
                    className="w-16 px-2 py-2 border border-amber-400 text-[11px] font-bold text-center focus:outline-none focus:ring-1 focus:ring-amber-500"
                  />
                  <button
                    onClick={() => {
                      const qty = parseInt(addingQtd?.qtd || '1') || 1;
                      onAddToPedido(detalheAberto, qty);
                      setAddingQtd(null);
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
