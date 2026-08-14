import React from "react";
import { SwapReportItem } from "../types";
import { formatCurrency, formatPercentage } from "../utils";
import { BarChart3, TrendingDown, Landmark, ArrowUpRight } from "lucide-react";

interface VisualChartProps {
  report: SwapReportItem[];
}

export default function VisualChart({ report }: VisualChartProps) {
  if (report.length === 0) return null;

  // Calculate totals
  const originalTotal = report.reduce((sum, item) => sum + item.originalPreco * item.qtd, 0);
  const optimizedTotal = report.reduce((sum, item) => sum + item.novoPreco * item.qtd, 0);
  const totalSavings = originalTotal - optimizedTotal;
  const savingsPercent = originalTotal > 0 ? totalSavings / originalTotal : 0;

  // Group top 4 savings items
  const sortedSwaps = [...report]
    .filter((item) => item.economiaTotal > 0)
    .sort((a, b) => b.economiaTotal - a.economiaTotal)
    .slice(0, 4);

  // Group savings by distributor
  const savingsByDistributor: Record<string, number> = {};
  report.forEach((item) => {
    if (item.economiaTotal <= 0) return;
    const dist = item.distribuidora || "Outras";
    savingsByDistributor[dist] = (savingsByDistributor[dist] || 0) + item.economiaTotal;
  });

  const distSavingsList = Object.entries(savingsByDistributor)
    .map(([name, value]) => ({ name, value }))
    .sort((a, b) => b.value - a.value);

  const maxDistSavings = Math.max(...distSavingsList.map((d) => d.value), 1);

  return (
    <div id="visual-dashboard" className="grid grid-cols-1 lg:grid-cols-3 gap-6 mb-8 text-slate-800">
      {/* Chart 1: Original vs Optimized Comparison */}
      <div className="bg-white p-6 rounded-xl border border-slate-200/80 shadow-sm flex flex-col justify-between">
        <div>
          <h3 className="font-display font-bold text-sm text-slate-900 mb-1 flex items-center gap-1.5">
            <BarChart3 className="w-4 h-4 text-indigo-600" />
            Comparativo de Custos do Pedido
          </h3>
          <p className="text-xs text-slate-500 mb-6">
            Comparação direta entre o valor original total e o novo lote otimizado.
          </p>
        </div>

        <div className="flex h-44 items-end space-x-8 px-4 pb-2 justify-center">
          {/* Original Bar */}
          <div className="flex flex-col items-center flex-1 h-full justify-end">
            <div className="text-[11px] font-bold font-mono text-slate-500 mb-2">{formatCurrency(originalTotal)}</div>
            <div className="w-10 bg-slate-100 rounded-t-lg transition-all hover:bg-slate-200" style={{ height: "100%" }} />
            <div className="text-[10px] uppercase font-bold tracking-widest text-slate-400 mt-2">Original</div>
          </div>

          {/* Optimized Bar */}
          <div className="flex flex-col items-center flex-1 h-full justify-end">
            <div className="text-[11px] font-bold font-mono text-indigo-600 mb-2">{formatCurrency(optimizedTotal)}</div>
            <div
              className="w-10 bg-indigo-600 rounded-t-lg transition-all hover:bg-indigo-700 relative flex items-center justify-center group"
              style={{ height: `${(optimizedTotal / originalTotal) * 100}%` }}
            >
              <span className="absolute -top-10 scale-0 group-hover:scale-100 transition-all bg-slate-950 text-white text-[9px] font-mono font-bold py-1 px-2 rounded-md whitespace-nowrap shadow-md z-10">
                Redução de {formatPercentage(savingsPercent)}
              </span>
            </div>
            <div className="text-[10px] uppercase font-extrabold tracking-widest text-indigo-600 mt-2">Otimizado</div>
          </div>
        </div>
      </div>

      {/* Chart 2: Top Item Swaps (Savings) */}
      <div className="bg-white p-6 rounded-xl border border-slate-200/80 shadow-sm">
        <h3 className="font-display font-bold text-sm text-slate-900 mb-1 flex items-center gap-1.5">
          <TrendingDown className="w-4 h-4 text-emerald-600" />
          Maiores Economias por Item
        </h3>
        <p className="text-xs text-slate-500 mb-5">
          Os itens que trouxeram a maior economia agregada no pedido.
        </p>

        <div className="space-y-4">
          {sortedSwaps.map((item, idx) => {
            const reductionPercent = (item.originalPreco - item.novoPreco) / item.originalPreco;
            return (
              <div key={idx} className="space-y-1.5">
                <div className="flex justify-between items-center text-xs">
                  <span className="font-semibold text-slate-700 truncate max-w-[180px]" title={item.originalDescricao}>
                    {item.originalDescricao}
                  </span>
                  <span className="font-bold text-emerald-600 font-mono">
                    Economia: {formatCurrency(item.economiaTotal)}
                  </span>
                </div>
                <div className="w-full bg-slate-100 h-2 rounded-full overflow-hidden">
                  <div
                    className="bg-emerald-500 h-full transition-all"
                    style={{ width: `${reductionPercent * 100}%` }}
                  />
                </div>
                <div className="flex justify-between items-center text-[9px] uppercase tracking-wider font-bold text-slate-400">
                  <span>{formatCurrency(item.originalPreco)} ➔ {formatCurrency(item.novoPreco)}</span>
                  <span className="text-emerald-600">{formatPercentage(reductionPercent)} OFF</span>
                </div>
              </div>
            );
          })}
        </div>
      </div>

      {/* Chart 3: Distributor Share of Savings */}
      <div className="bg-white p-6 rounded-xl border border-slate-200/80 shadow-sm">
        <h3 className="font-display font-bold text-sm text-slate-900 mb-1 flex items-center gap-1.5">
          <Landmark className="w-4 h-4 text-indigo-600" />
          Economia por Distribuidora
        </h3>
        <p className="text-xs text-slate-500 mb-5">
          Divisão da economia gerada pelos substitutos de cada distribuidora.
        </p>

        <div className="space-y-4">
          {distSavingsList.map((dist, idx) => {
            const widthPercent = (dist.value / maxDistSavings) * 100;
            return (
              <div key={idx} className="space-y-1.5">
                <div className="flex justify-between items-center text-xs">
                  <span className="font-semibold text-slate-700">{dist.name}</span>
                  <span className="font-bold text-slate-800 font-mono">
                    {formatCurrency(dist.value)}
                  </span>
                </div>
                <div className="w-full bg-slate-100 h-2 rounded-full overflow-hidden">
                  <div
                    className="bg-indigo-500 h-full transition-all"
                    style={{ width: `${widthPercent}%` }}
                  />
                </div>
                <div className="text-[9px] uppercase tracking-wider font-bold text-slate-400 text-right">
                  {formatPercentage(dist.value / totalSavings)} da economia total
                </div>
              </div>
            );
          })}
        </div>
      </div>
    </div>
  );
}
