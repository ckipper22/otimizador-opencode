import React, { useState, useMemo, useEffect } from 'react';
import { ChevronDown, ChevronRight, CheckCircle2, PackageX, CheckSquare, XSquare, Search, RefreshCw, Download, HelpCircle, Check, X, ArrowDown, Plus } from 'lucide-react';
import { EanEyeButton } from "./EanEyeButton";
import { ObservationBell } from "./ObservationBell";
import { formatCurrency } from '../utils';

function ObservationBellFetcher({ ean }: { ean: string }) {
  const [observacao, setObservacao] = useState<string | null>(null);

  useEffect(() => {
    if (!ean || ean === "0") return;
    let cancelled = false;

    (async () => {
      try {
        const res = await fetch(`/api/similares/${ean}`);
        const json = await res.json();
        if (cancelled || !res.ok || !json.success || !json.produtos) return;
        const exact = json.produtos.find((p: any) => p.cod_barra === ean || p.ean === ean);
        if (exact?.nom_obsvenda && !cancelled) setObservacao(exact.nom_obsvenda);
      } catch { /* silencioso */ }
    })();

    return () => { cancelled = true; };
  }, [ean]);

  return <ObservationBell observacao={observacao} />;
}

export function OrderReturnView({ 
  orderReturn, 
  itemsFaturados, 
  onReRouteShortages, 
  onExportShortages, 
  isReRoutingShortages,
  numPedido,
  cnpjLoja,
  dataPedido
}: any) {
  const [expandedDists, setExpandedDists] = useState<Record<string, boolean>>({});

  const toggleDist = (distName: string) => {
    setExpandedDists(prev => ({
      ...prev,
      [distName]: !prev[distName]
    }));
  };

  // Support both raw response format and pre-extracted Return format
  const rawRetorno = orderReturn?.Retorno || orderReturn?.retorno || orderReturn;
  const dists = rawRetorno?.dists || rawRetorno?.Dists || [];
  const items = rawRetorno?.Itens || rawRetorno?.itens || [];

  // Group items by distributor
  const itemsByDist = useMemo(() => {
    const map: Record<string, any[]> = {};
    items.forEach((it: any) => {
      const distInfo = dists.find((d: any) => String(d.CodDist || d.codDist) === String(it.CodDist || it.codDist));
      const distName = distInfo ? (distInfo.NomeDist || distInfo.nomeDist) : "Desconhecido";
      const key = `${it.CodDist || distInfo?.CodDist || "0"}-${distName}`;
      if (!map[key]) map[key] = [];
      map[key].push(it);
    });
    return map;
  }, [items, dists]);

  // Aggregate dists info
  const distCards = dists.map((dist: any) => {
    const name = dist.NomeDist || dist.nomeDist || "Distribuidor Não Identificado";
    const key = `${dist.CodDist || dist.codDist}-${name}`;
    const distItems = itemsByDist[key] || [];
    
    // Calculate total based on unit price and quantities faturadas
    const total = distItems.reduce((acc, it) => {
      const p = it.Preco || it.preco || 0;
      const qFat = it.QuantFaturada !== undefined ? it.QuantFaturada : (it.quantFaturada !== undefined ? it.quantFaturada : 0);
      return acc + (p * qFat);
    }, 0);

    const status = dist.Status || dist.status || 3;
    const statusDesc = dist.DesStatus || dist.desStatus || (status === 3 ? "3 - Pedido Finalizado" : "2 - Aguardando faturamento");

    return {
      id: dist.CodDist || dist.codDist,
      name,
      key,
      status,
      statusDesc,
      total,
      minimo: 0.01, // From user screenshot
      items: distItems
    };
  });

  const hasShortages = items.some((it: any) => {
    const requested = it.Quant || it.quant || 0;
    const faturado = it.QuantFaturada !== undefined ? it.QuantFaturada : (it.quantFaturada !== undefined ? it.quantFaturada : 0);
    return faturado < requested;
  });

  const allDistsFinalized = useMemo(() => {
    if (dists.length === 0) return true;
    // Status 3 significa finalizado, Status 4/5 etc também são estados de encerramento
    return dists.every((d: any) => d.Status === 3 || d.Status === 4 || d.Status === 5);
  }, [dists]);

  return (
    <div className="flex flex-col gap-4 font-sans text-gray-800">
      {/* Header Actions */}
      <div className="flex flex-col md:flex-row md:items-center justify-between border-b border-gray-200 pb-3 mb-2 gap-3">
        <div className="border-l-[4px] border-[#d91d1d] pl-3">
          <h4 className="text-[11px] font-bold text-[#141414]/50 uppercase tracking-widest font-mono">Visualizador</h4>
          <p className="text-sm text-[#141414] font-medium mt-0.5">
            Pedido: <span className="font-bold text-blue-600 font-mono text-base">{numPedido || rawRetorno?.NumeroPedCliente || orderReturn?.numPedido || "—"}</span>
            <span className="mx-2 text-gray-300">|</span>
            Loja: <span className="font-bold text-gray-700">{cnpjLoja || rawRetorno?.CnpjLoja || "1"}</span>
            {dataPedido && (
              <>
                <span className="mx-2 text-gray-300">|</span>
                Data: <span className="font-bold text-gray-700 font-mono">{dataPedido}</span>
              </>
            )}
          </p>
        </div>
        <div className="flex gap-2 font-sans">
          {hasShortages && (
            <>
              <button
                onClick={onReRouteShortages}
                disabled={isReRoutingShortages || !allDistsFinalized}
                className="bg-white hover:bg-gray-50 border border-gray-300 text-gray-700 font-bold text-[11px] uppercase tracking-wider px-4 py-2 flex items-center gap-2 transition-colors disabled:opacity-50 cursor-pointer shadow-sm rounded-none"
                title={!allDistsFinalized ? "Aguarde a finalização de todas as distribuidoras do lote para pedir faltas." : "Desviar faltas para distribuidores alternativos"}
              >
                {isReRoutingShortages ? <RefreshCw className="w-3.5 h-3.5 animate-spin" /> : <span>⇄</span>}
                {!allDistsFinalized ? "Aguardando Distribuidoras..." : "Pedir Faltas"}
              </button>
              <button
                onClick={onExportShortages}
                className="bg-white hover:bg-gray-50 border border-gray-300 text-gray-700 font-bold text-[11px] uppercase tracking-wider px-4 py-2 flex items-center gap-2 transition-colors cursor-pointer shadow-sm rounded-none"
              >
                <Download className="w-3.5 h-3.5" />
                Exportar Faltas
              </button>
            </>
          )}
        </div>
      </div>

      <div className="space-y-4">
        {distCards.map((card: any) => {
          const isExpanded = expandedDists[card.key] !== false; // Default to open! Like the user's second screenshot
          const isFinalized = card.status === 3;

          return (
            <div key={card.key} className="border border-gray-300 shadow-sm bg-white overflow-hidden">
              {/* Collapsible Header bar matching screenshot */}
              <div 
                onClick={() => toggleDist(card.key)}
                className="bg-white p-4 flex items-center justify-between cursor-pointer hover:bg-gray-50 transition-colors select-none border-b border-gray-100"
              >
                <div className="flex items-center gap-3">
                  <span className="text-gray-500">
                    {isExpanded ? <ChevronDown className="w-5 h-5" /> : <ChevronRight className="w-5 h-5" />}
                  </span>
                  <span className="font-medium text-[#141414] text-xs">
                    Distribuidora: <span className="font-bold text-gray-700">{card.id}-{card.name}</span>
                  </span>
                </div>

                <div className="flex items-center gap-8">
                  {/* Big Blue CheckCircle representing finalization */}
                  {isFinalized ? (
                    <div className="w-10 h-10 rounded-full border border-blue-500 bg-blue-50 flex items-center justify-center">
                      <Check className="w-6 h-6 text-blue-600 stroke-[3]" />
                    </div>
                  ) : (
                    <div className="w-10 h-10 rounded-full border border-amber-500 bg-amber-50 flex items-center justify-center">
                      <RefreshCw className="w-5 h-5 text-amber-600 animate-spin" />
                    </div>
                  )}

                  <div className="text-right text-xs">
                    <div className="font-semibold text-gray-500">Status: <span className="text-[#141414] font-bold">{card.statusDesc}</span></div>
                    <div className="text-[#141414] font-bold mt-0.5">Total: <span className="text-blue-600">{formatCurrency(card.total)}</span></div>
                    <div className="text-[10px] text-gray-500 font-bold mt-0.5">Mínimo: <span className="text-gray-600 font-normal">{formatCurrency(card.minimo)}</span></div>
                  </div>
                </div>
              </div>

              {/* Items Table inside collapsible block */}
              {isExpanded && (
                <div className="overflow-x-auto border-t border-gray-200">
                  {card.items.length === 0 ? (
                    <div className="p-8 text-center text-xs text-gray-500 font-mono">
                      Nenhum item faturado neste distribuidor para este pedido.
                    </div>
                  ) : (
                    <table className="w-full text-left text-[11px] border-collapse bg-white">
                      <thead>
                        <tr className="bg-gray-50 text-gray-600 font-bold border-b border-gray-200 uppercase text-[9px] tracking-wider">
                          <th className="py-2 px-3 text-center w-8">#</th>
                          <th className="py-2 px-2 text-center">Cód. Prod. Dist.</th>
                          <th className="py-2 px-3">Descrição</th>
                          <th className="py-2 px-2">Laboratório</th>
                          <th className="py-2 px-2 text-center">Qtd.</th>
                          <th className="py-2 px-3 text-right">R$ Preço</th>
                          <th className="py-2 px-3 text-right">
                            % Desc.
                            <HelpCircle className="w-3 h-3 text-blue-500 inline ml-1 cursor-help" />
                          </th>
                          <th className="py-2 px-3 text-right">R$ ST</th>
                          <th className="py-2 px-3 text-right">R$ P. Líquido</th>
                          <th className="py-2 px-2 text-center">Estoque</th>
                          <th className="py-2 px-2 text-center">Faturado</th>
                          <th className="py-2 px-3 text-right">Dif Médio</th>
                          <th className="py-2 px-3">Motivo</th>
                        </tr>
                      </thead>
                      <tbody className="divide-y divide-gray-200 font-mono">
                        {card.items.map((it: any, i: number) => {
                          const requested = it.Quant || it.quant || 0;
                          const faturado = it.QuantFaturada !== undefined ? it.QuantFaturada : (it.quantFaturada !== undefined ? it.quantFaturada : 0);
                          const isCut = faturado < requested;
                          
                          const desc = it.Descricao || it.descricao || "Item (EAN: " + it.Ean + ")";
                          const lab = it.Laboratorio || it.laboratorio || "-";
                          const price = it.Preco || it.preco || 0;
                          const desconto = it.Desconto || it.desconto || 0;
                          const st = it.ST || it.st || 0;
                          
                          // Calculated net price: original price minus discount, plus ST
                          const precoLiquido = it.PrecoLiquido || it.precoLiquido || (price * (1 - desconto / 100)) || price;
                          const codProdDist = it.CodProdutoDist || it.codProdutoDist || it.CodProdDist || "—";
                          const difMedio = it.DifMedio || it.difMedio || 0;

                          return (
                            <tr key={i} className={`hover:bg-gray-50/50 ${isCut ? 'bg-red-50/20' : ''}`}>
                              {/* Left circular status representation */}
                              <td className="py-3 px-3 text-center">
                                {isCut ? (
                                  <div className="w-5 h-5 rounded-full bg-red-100 border border-red-300 text-red-600 flex items-center justify-center font-bold text-xs" title="Item cortado ou com falta">
                                    <X className="w-3 h-3 stroke-[2.5]" />
                                  </div>
                                ) : (
                                  <div className="w-5 h-5 rounded-full bg-green-100 border border-green-300 text-green-600 flex items-center justify-center font-bold text-xs" title="Item faturado totalmente">
                                    <Check className="w-3 h-3 stroke-[2.5]" />
                                  </div>
                                )}
                              </td>

                              <td className="py-3 px-2 text-center text-gray-700 font-bold">{codProdDist}</td>
                              
                              <td className="py-3 px-3 font-sans font-semibold text-gray-900 text-xs">
                                {desc}
                                <div className="text-[9px] text-gray-500 font-mono mt-0.5 flex items-center">EAN: {it.Ean || it.ean} <EanEyeButton ean={it.Ean || it.ean} descricao={it.Descricao || it.descricao} laboratorio={it.Laboratorio || it.laboratorio} /></div>
                                <ObservationBellFetcher ean={it.Ean || it.ean} />
                              </td>

                              <td className="py-3 px-2 text-gray-600 text-[10px] font-sans uppercase font-medium">{lab}</td>

                              {/* Numeric visual counter representation */}
                              <td className="py-3 px-2 text-center">
                                <div className="inline-flex items-center justify-center border border-gray-300 rounded bg-white px-2 py-0.5 max-w-[55px] mx-auto text-[10px] font-bold text-gray-800">
                                  <span>{requested}</span>
                                  <div className="flex flex-col ml-1.5 text-[6px] text-gray-400 leading-none">
                                    <span>▲</span>
                                    <span>▼</span>
                                  </div>
                                </div>
                              </td>

                              <td className="py-3 px-3 text-right text-gray-700">{formatCurrency(price)}</td>
                              
                              <td className="py-3 px-3 text-right text-gray-700">
                                {desconto.toFixed(2)}%
                              </td>
                              
                              <td className="py-3 px-3 text-right text-gray-700">
                                {formatCurrency(st)}
                              </td>
                              
                              <td className="py-3 px-3 text-right text-[#141414] font-bold">
                                {formatCurrency(precoLiquido)}
                              </td>

                              {/* Stock light */}
                              <td className="py-3 px-2 text-center">
                                <div className="w-3 h-3 rounded-full bg-[#82c91e] border border-green-600 mx-auto" title="Com Estoque" />
                              </td>

                              {/* Billing status checkmark/icon */}
                              <td className="py-3 px-2 text-center">
                                {faturado === requested ? (
                                  <div className="w-5 h-5 rounded-full border border-green-500 bg-green-50 flex items-center justify-center mx-auto text-green-600">
                                    <Check className="w-3 h-3 stroke-[3]" />
                                  </div>
                                ) : faturado > 0 ? (
                                  <span className="bg-amber-100 text-amber-900 px-1.5 py-0.5 text-[10px] font-bold rounded">
                                    {faturado} faturados
                                  </span>
                                ) : (
                                  <div className="w-5 h-5 rounded-full border border-red-500 bg-red-50 flex items-center justify-center mx-auto text-red-600" title="Item cortado totalmente">
                                    <X className="w-3 h-3 stroke-[3]" />
                                  </div>
                                )}
                              </td>

                              {/* Dif Médio with down arrow */}
                              <td className="py-3 px-3 text-right font-bold text-rose-600 whitespace-nowrap">
                                {difMedio !== 0 ? (
                                  <div className="flex items-center justify-end gap-0.5">
                                    <span>-{difMedio.toFixed(2)}</span>
                                    <span className="text-[10px] text-rose-500">↓</span>
                                  </div>
                                ) : "0,00"}
                              </td>

                              <td className="py-3 px-3 text-gray-500 text-[10px] font-sans" title={it.Motivo || it.motivo}>
                                {it.Motivo || it.motivo || "—"}
                              </td>
                            </tr>
                          );
                        })}
                      </tbody>
                    </table>
                  )}
                </div>
              )}
            </div>
          );
        })}
      </div>
    </div>
  );
}
