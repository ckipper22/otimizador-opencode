import React, { useState } from "react";
import { X, TrendingUp, ShoppingCart, Loader2 } from "lucide-react";
import { AnimatePresence, motion } from "motion/react";
import { formatCurrency } from "../utils";

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

interface PromAnalysis {
  ean: string;
  produto: string;
  laboratorio?: string;
  fornecedor: string;
  fornecedorLista?: string;
  preco: number;
  validade?: string;
  vendasMensais: number;
  estoqueTotal: number;
  estoqueMesmoEan: number;
  melhorPrecoSmartPed: number | null;
  melhorDistribuidora: string | null;
  melhorPrecoHistorico: number | null;
  melhorFornecedorHistorico: string | null;
  comprasHistorico: CompraHistorico[];
  estoquePorLaboratorio: EstoqueLaboratorio[];
  ultimaCompra: CompraHistorico | null;
  economiaPercent: number;
  economiaValor: number;
  economiaMensal: number;
  boaOferta: boolean;
  isReferencia?: boolean;
  discountPercent?: number;
}

export const EanPromoButton = ({ ean, descricao }: { ean: string; descricao?: string }) => {
  const [loading, setLoading] = useState(false);
  const [detail, setDetail] = useState<PromAnalysis | null>(null);
  const [showFullDetail, setShowFullDetail] = useState(false);
  const [error, setError] = useState<string | null>(null);

  if (!ean || ean === "0") return null;

  const handleAnalyze = async (e: React.MouseEvent) => {
    e.stopPropagation();
    e.preventDefault();
    if (loading) return;

    setLoading(true);
    setError(null);
    setDetail(null);
    setShowFullDetail(false);

    try {
      const savedConfigStr = localStorage.getItem("optimizer_config");
      const savedConfig = savedConfigStr ? JSON.parse(savedConfigStr) : {};
      const cnpj = savedConfig.cnpj || "";

      // 1) Buscar pelo EAN para pegar a descricao exata da Trier
      const buscaEanRes = await fetch(`/api/ofertas-dia/buscar-produto?q=${encodeURIComponent(ean)}`);
      const buscaEanData = await buscaEanRes.json();
      const produtoEan = buscaEanData?.produtos?.[0];
      const descricaoTrier = produtoEan?.descricao || descricao || "";

      // 2) Buscar por DESCRICAO para pegar TODOS os EANs do grupo DCB
      const searchQuery = descricaoTrier || ean;
      const buscaRes = await fetch(`/api/ofertas-dia/buscar-produto?q=${encodeURIComponent(searchQuery)}`);
      const buscaData = await buscaRes.json();
      const produtos = buscaData?.produtos || [];
      // Encontrar o grupo que contem o EAN original (todos os grupos sao mesmo DCB)
      let produto = produtos.find((p: any) => p.eans?.some((e: any) => e.ean === ean));
      // Se nao encontrou o EAN exato, usar o primeiro grupo (mesmo DCB = mesmas vendas)
      if (!produto && produtos.length > 0) produto = produtos[0];
      // Ultimo fallback: usar resultado da busca por EAN (sem eans array)
      if (!produto) produto = produtoEan;

      if (!produto) {
        setError("Produto nao encontrado na Trier");
        setLoading(false);
        return;
      }

      const analiseRes = await fetch("/api/ofertas-dia/analisar-referencia", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          ean: produto.ean || ean,
          descricao: produto.descricao || descricao || "",
          cnpj,
          estoque: produto.estoque || 0,
          melhorPreco: produto.melhorPreco || 0,
          labs: produto.labs || [],
          eans: produto.eans || [],
          dcb: produto.dcb,
          codConcentracao: produto.codConcentracao,
        }),
      });

      const analiseData = await analiseRes.json();
      if (analiseData.oferta) {
        setDetail(analiseData.oferta);
      } else {
        setError("Falha ao analisar produto");
      }
    } catch (err: any) {
      setError(err.message || "Erro ao analisar");
    } finally {
      setLoading(false);
    }
  };

  return (
    <>
      <button
        onClick={handleAnalyze}
        disabled={loading}
        className="inline-flex items-center justify-center p-1 hover:bg-amber-100 rounded-none transition-colors ml-0.5 cursor-pointer text-amber-600 hover:text-amber-800 disabled:opacity-50 disabled:cursor-wait"
        title="Analise de Precos (Promocoes do Dia)"
      >
        {loading ? (
          <Loader2 className="w-3.5 h-3.5 animate-spin" />
        ) : (
          <span className="text-[11px] font-black font-mono leading-none">P</span>
        )}
      </button>

      <AnimatePresence>
        {detail && !showFullDetail && (
          <motion.div
            initial={{ opacity: 0 }}
            animate={{ opacity: 1 }}
            exit={{ opacity: 0 }}
            className="fixed inset-0 z-[110] flex items-center justify-center bg-black/50 backdrop-blur-sm p-4"
            onClick={() => setDetail(null)}
          >
            <motion.div
              initial={{ scale: 0.96 }}
              animate={{ scale: 1 }}
              exit={{ scale: 0.96 }}
              className="w-full max-w-lg max-h-[90vh] overflow-auto"
              onClick={(e) => e.stopPropagation()}
            >
              {/* Card - replica exata do OfertasDoDiaModal */}
              <div className={`border-2 p-4 ${
                detail.isReferencia
                  ? 'bg-amber-50 border-amber-300'
                  : detail.boaOferta
                    ? 'bg-white border-emerald-500'
                    : 'bg-white border-gray-200'
              }`}>
                {/* Header do Card */}
                <div className="flex items-start justify-between mb-3">
                  <div className="flex-1">
                    <h3 className="text-xs font-black text-[#141414] uppercase tracking-wider font-sans leading-tight">
                      {detail.produto}
                    </h3>
                    {detail.ean ? (
                      <p className="text-[10px] text-gray-500 font-mono mt-1">EAN: {detail.ean}</p>
                    ) : (
                      <p className="text-[10px] text-amber-600 font-sans mt-1">⚠️ Sem EAN</p>
                    )}
                    {detail.laboratorio && (
                      <p className="text-[10px] text-gray-500 font-sans mt-0.5">{detail.laboratorio}</p>
                    )}
                  </div>
                  <div className="flex gap-1 items-start">
                    {detail.boaOferta && (
                      <span className="bg-emerald-600 text-white text-[8px] font-bold uppercase px-2 py-0.5">
                        BOA
                      </span>
                    )}
                    {detail.isReferencia && (
                      <span className="bg-amber-500 text-white text-[8px] font-bold uppercase px-2 py-0.5">
                        REFERENCIA
                      </span>
                    )}
                    <button
                      onClick={() => setDetail(null)}
                      className="text-gray-400 hover:text-[#141414] transition-colors p-0.5 ml-1"
                    >
                      <X className="w-4 h-4" />
                    </button>
                  </div>
                </div>

                {/* Preco Promocao */}
                <div className="mb-2">
                  <div className="flex items-baseline gap-2">
                    <span className="text-lg font-black text-amber-600 font-sans">
                      {formatCurrency(detail.preco)}
                      {detail.discountPercent ? ` (${detail.discountPercent}% off)` : ""}
                    </span>
                  </div>
                  <p className="text-xs font-black text-amber-700 font-sans mt-1">
                    {detail.fornecedorLista || detail.fornecedor || "N/A"}
                  </p>
                  {detail.validade && (
                    <p className="text-[9px] text-gray-400 font-sans">Ate: {detail.validade}</p>
                  )}
                </div>

                {/* Comparacao de Precos */}
                <div className="mb-3 p-2 bg-gray-50 border border-gray-100 text-[10px] font-sans space-y-1">
                  {detail.melhorPrecoSmartPed != null && detail.melhorPrecoSmartPed > 0 ? (
                    <div className="flex justify-between">
                      <span className="text-gray-600">Melhor SmartPed:</span>
                      <span className="font-bold text-[#141414]">
                        {formatCurrency(detail.melhorPrecoSmartPed)} ({detail.melhorDistribuidora})
                      </span>
                    </div>
                  ) : (
                    <div className="flex justify-between">
                      <span className="text-gray-600">Melhor SmartPed:</span>
                      <span className="text-gray-400 italic">Não encontrado</span>
                    </div>
                  )}
                  {detail.melhorPrecoHistorico != null && detail.melhorPrecoHistorico > 0 ? (
                    <div className="flex justify-between">
                      <span className="text-gray-600">Melhor que pagou:</span>
                      <span className="font-bold text-blue-700">
                        {formatCurrency(detail.melhorPrecoHistorico)} ({detail.melhorFornecedorHistorico})
                      </span>
                    </div>
                  ) : (
                    <div className="flex justify-between">
                      <span className="text-gray-600">Melhor que pagou:</span>
                      <span className="text-gray-400 italic">Sem histórico</span>
                    </div>
                  )}
                  {detail.melhorPrecoSmartPed != null && detail.melhorPrecoSmartPed > 0 && (
                    <div className="flex justify-between border-t border-gray-200 pt-1">
                      <span className="text-gray-600 font-bold">Economia vs SmartPed:</span>
                      <span className={`font-bold ${detail.economiaPercent > 0 ? 'text-emerald-700' : 'text-red-600'}`}>
                        {detail.economiaPercent > 0 ? `-${detail.economiaPercent}%` : '0%'}
                        {detail.economiaValor > 0 && ` (${formatCurrency(detail.economiaValor)})`}
                      </span>
                    </div>
                  )}
                </div>

                {/* Metricas */}
                <div className="grid grid-cols-2 gap-2 mb-3">
                  <div className="text-center p-2 bg-gray-50">
                    <p className="text-[10px] text-gray-500 font-sans uppercase">Vendas</p>
                    <p className="text-xs font-bold text-[#141414] font-sans">{detail.vendasMensais}/mes</p>
                  </div>
                  <div className="text-center p-2 bg-gray-50">
                    <p className="text-[10px] text-gray-500 font-sans uppercase">Estoque</p>
                    <p className="text-xs font-bold text-[#141414] font-sans">{detail.estoqueMesmoEan} cx</p>
                  </div>
                </div>

                {/* Economia Mensal */}
                {detail.economiaMensal > 0 && (
                  <div className="mb-3 p-2 bg-emerald-50 border border-emerald-200">
                    <div className="flex items-center gap-2">
                      <TrendingUp className="w-3 h-3 text-emerald-600" />
                      <span className="text-[10px] font-bold text-emerald-700 font-sans uppercase">
                        Economia potencial: {formatCurrency(detail.economiaMensal)}/mes
                      </span>
                    </div>
                  </div>
                )}

                {/* Botoes */}
                <div className="flex gap-2">
                  <button
                    onClick={() => setShowFullDetail(true)}
                    className="flex-1 py-2 bg-amber-600 hover:bg-amber-700 text-white text-[10px] font-bold uppercase tracking-wider flex items-center justify-center gap-2 transition-colors"
                  >
                    <ShoppingCart className="w-3 h-3" />
                    Detalhes
                  </button>
                  <button
                    onClick={() => setDetail(null)}
                    className="px-3 py-2 bg-gray-100 hover:bg-gray-200 text-gray-700 text-[10px] font-bold uppercase tracking-wider transition-colors"
                  >
                    Fechar
                  </button>
                </div>
              </div>
            </motion.div>
          </motion.div>
        )}
      </AnimatePresence>

      {/* Modal de Detalhes completo - replica exata do OfertasDoDiaModal */}
      <AnimatePresence>
        {detail && showFullDetail && (
          <motion.div
            initial={{ opacity: 0 }}
            animate={{ opacity: 1 }}
            exit={{ opacity: 0 }}
            className="fixed inset-0 z-[110] flex items-center justify-center bg-black/50 backdrop-blur-sm p-4"
            onClick={() => setShowFullDetail(false)}
          >
            <motion.div
              initial={{ scale: 0.96 }}
              animate={{ scale: 1 }}
              exit={{ scale: 0.96 }}
              className="bg-white w-full max-w-2xl shadow-2xl flex flex-col max-h-[90vh]"
              onClick={(e) => e.stopPropagation()}
            >
              {/* Header */}
              <div className="flex items-center justify-between p-4 border-b border-gray-200 bg-gray-50">
                <div>
                  <h3 className="text-sm font-black text-[#141414] uppercase tracking-wider font-sans">
                    {detail.produto}
                  </h3>
                  <p className="text-[10px] text-gray-500 font-sans mt-0.5">
                    EAN: {detail.ean || "N/A"} | {detail.laboratorio || ""}
                  </p>
                </div>
                <button onClick={() => setShowFullDetail(false)} className="text-gray-400 hover:text-[#141414] transition-colors p-1">
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
                      {formatCurrency(detail.preco)}
                      {detail.discountPercent ? ` (${detail.discountPercent}% off)` : ""}
                    </span>
                    <span className="text-[10px] text-gray-500 font-sans">
                      (valido ate {detail.validade || "N/A"})
                    </span>
                  </div>
                  <p className="text-xs font-black text-amber-700 font-sans mt-1">
                    {detail.fornecedorLista || detail.fornecedor || "N/A"}
                  </p>
                </div>

                {/* Comparacao */}
                <div className="p-3 bg-gray-50 border border-gray-200">
                  <p className="text-[10px] text-gray-500 font-sans uppercase mb-2">Comparacao</p>
                  <div className="space-y-2 text-[10px] font-sans">
                    {detail.melhorPrecoSmartPed != null && detail.melhorPrecoSmartPed > 0 && (
                      <div className="flex justify-between">
                        <span className="text-gray-600">Melhor preco SmartPed:</span>
                        <span className="font-bold text-[#141414]">
                          {formatCurrency(detail.melhorPrecoSmartPed)} ({detail.melhorDistribuidora})
                        </span>
                      </div>
                    )}
                    {detail.melhorPrecoHistorico != null && detail.melhorPrecoHistorico > 0 && (
                      <div className="flex justify-between">
                        <span className="text-gray-600">Melhor que voce ja pagou:</span>
                        <span className="font-bold text-blue-700">
                          {formatCurrency(detail.melhorPrecoHistorico)} ({detail.melhorFornecedorHistorico})
                        </span>
                      </div>
                    )}
                    <div className="flex justify-between border-t border-gray-200 pt-2">
                      <span className="text-gray-600 font-bold">Economia vs SmartPed:</span>
                      <span className={`font-bold ${detail.economiaPercent > 0 ? 'text-emerald-700' : 'text-red-600'}`}>
                        {detail.economiaPercent > 0 ? `-${detail.economiaPercent}%` : '0%'}
                        {detail.economiaValor > 0 && ` (${formatCurrency(detail.economiaValor)})`}
                      </span>
                    </div>
                  </div>
                </div>

                {/* Estoque por Laboratorio */}
                {detail.estoquePorLaboratorio && detail.estoquePorLaboratorio.length > 0 && (
                  <div className="p-3 bg-gray-50 border border-gray-200">
                    <p className="text-[10px] text-gray-500 font-sans uppercase mb-2">Estoque por Laboratorio (mesma composicao)</p>
                    <div className="space-y-1">
                      {detail.estoquePorLaboratorio.map((lab, i) => {
                        const total = detail.estoquePorLaboratorio.reduce((s, l) => s + l.quantidade, 0);
                        const percent = total > 0 ? Math.round((lab.quantidade / total) * 100) : 0;
                        const isMesmoEan = lab.eans.includes(detail.ean);
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
                      <p className="text-[10px] text-gray-500 font-sans">* = mesmo EAN da promocao</p>
                      <p className="text-[10px] text-gray-600 font-sans font-bold">Total: {detail.estoqueTotal} cx</p>
                    </div>
                  </div>
                )}

                {/* Historico de Compras */}
                {detail.comprasHistorico && detail.comprasHistorico.length > 0 && (
                  <div className="p-3 bg-gray-50 border border-gray-200">
                    <p className="text-[10px] text-gray-500 font-sans uppercase mb-2">Seus Precos (Ultimos 6 meses)</p>
                    <div className="overflow-x-auto">
                      <table className="w-full text-[10px] font-sans">
                        <thead>
                          <tr className="border-b border-gray-200">
                            <th className="text-left py-1 px-2 font-bold text-gray-600">Custo Real</th>
                            <th className="text-left py-1 px-2 font-bold text-gray-600">Tabela</th>
                            <th className="text-left py-1 px-2 font-bold text-gray-600">Fornecedor</th>
                            <th className="text-left py-1 px-2 font-bold text-gray-600">Data</th>
                            <th className="text-right py-1 px-2 font-bold text-gray-600">Qtd</th>
                            <th className="text-right py-1 px-2 font-bold text-gray-600">NF</th>
                          </tr>
                        </thead>
                        <tbody>
                          {detail.comprasHistorico.map((compra, i) => {
                            const isMelhor = compra.preco === detail.melhorPrecoHistorico;
                            const desconto = compra.precoTabela > 0
                              ? Math.round(((compra.precoTabela - compra.preco) / compra.precoTabela) * 100)
                              : 0;
                            return (
                              <tr key={i} className={`border-b border-gray-100 ${isMelhor ? 'bg-emerald-50' : ''}`}>
                                <td className="py-1 px-2 font-bold text-[#141414]">
                                  {formatCurrency(compra.preco)}
                                  {isMelhor && <span className="text-emerald-600 ml-1">*</span>}
                                </td>
                                <td className="py-1 px-2 text-gray-500">
                                  {formatCurrency(compra.precoTabela)}
                                  {desconto > 0 && <span className="text-emerald-600 ml-1">(-{desconto}%)</span>}
                                </td>
                                <td className="py-1 px-2 text-gray-600">{compra.fornecedor}</td>
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
                {detail.ultimaCompra && (
                  <div className="p-3 bg-blue-50 border border-blue-200">
                    <p className="text-[10px] text-gray-500 font-sans uppercase mb-1">Ultima Compra</p>
                    <div className="text-[10px] font-sans space-y-0.5">
                      <p className="text-[#141414]">
                        <span className="font-bold">{formatCurrency(detail.ultimaCompra.preco)}</span>
                        {" "}em {detail.ultimaCompra.data}
                      </p>
                      <p className="text-gray-600">
                        Fornecedor: {detail.ultimaCompra.fornecedor}
                      </p>
                      <p className="text-gray-600">
                        Quantidade: {detail.ultimaCompra.quantidade} cx
                      </p>
                    </div>
                  </div>
                )}

                {/* Metricas */}
                <div className="grid grid-cols-2 gap-2">
                  <div className="text-center p-2 bg-gray-50 border border-gray-200">
                    <p className="text-[10px] text-gray-500 font-sans uppercase">Vendas</p>
                    <p className="text-sm font-bold text-[#141414] font-sans">{detail.vendasMensais}/mes</p>
                  </div>
                  <div className="text-center p-2 bg-gray-50 border border-gray-200">
                    <p className="text-[10px] text-gray-500 font-sans uppercase">Estoque</p>
                    <p className="text-sm font-bold text-[#141414] font-sans">{detail.estoqueMesmoEan} cx</p>
                  </div>
                </div>

                {/* Economia Mensal */}
                {detail.economiaMensal > 0 && (
                  <div className="p-3 bg-emerald-50 border border-emerald-200">
                    <div className="flex items-center gap-2">
                      <TrendingUp className="w-4 h-4 text-emerald-600" />
                      <span className="text-xs font-bold text-emerald-700 font-sans uppercase">
                        Economia potencial: {formatCurrency(detail.economiaMensal)}/mes
                      </span>
                    </div>
                  </div>
                )}
              </div>

              {/* Footer - replica exata do OfertasDoDiaModal */}
              <div className="p-4 border-t border-gray-200 bg-gray-50 flex gap-2">
                <div className="flex-1 flex items-center gap-2">
                  <span className="text-[10px] font-bold text-gray-600 uppercase">Qtd:</span>
                  <input
                    type="number"
                    min="1"
                    defaultValue="1"
                    id="ean-promo-qtd"
                    className="w-16 px-2 py-2 border border-amber-400 text-[11px] font-bold text-center focus:outline-none focus:ring-1 focus:ring-amber-500"
                  />
                  <button
                    className="flex-1 py-2 bg-amber-600 hover:bg-amber-700 text-white text-[10px] font-bold uppercase tracking-wider flex items-center justify-center gap-2 transition-colors"
                  >
                    <ShoppingCart className="w-3 h-3" />
                    Adicionar ao Pedido
                  </button>
                </div>
                <button
                  onClick={() => setShowFullDetail(false)}
                  className="px-4 py-2 bg-gray-200 hover:bg-gray-300 text-gray-700 text-[10px] font-bold uppercase tracking-wider transition-colors"
                >
                  Fechar
                </button>
              </div>
            </motion.div>
          </motion.div>
        )}
      </AnimatePresence>

      {/* Error toast */}
      <AnimatePresence>
        {error && (
          <motion.div
            initial={{ opacity: 0, y: 10 }}
            animate={{ opacity: 1, y: 0 }}
            exit={{ opacity: 0, y: 10 }}
            className="fixed bottom-4 right-4 z-[120] bg-red-600 text-white text-xs font-mono px-3 py-2 shadow-lg flex items-center gap-2"
          >
            {error}
            <button onClick={() => setError(null)} className="hover:text-red-200 cursor-pointer">
              <X className="w-3 h-3" />
            </button>
          </motion.div>
        )}
      </AnimatePresence>
    </>
  );
};
