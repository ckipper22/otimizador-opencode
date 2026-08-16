import React, { useState } from "react";
import { TrendingDown, PackageCheck, DollarSign, ArrowUpRight, Percent, ChevronDown, ChevronUp, BarChart3 } from "lucide-react";
import { OptimizationSummary, SwapReportItem } from "../types";
import { formatCurrency, formatPercentage } from "../utils";

interface OptimizationSummaryProps {
  summary: OptimizationSummary;
  report: SwapReportItem[];
}

export default function OptimizationSummaryStats({
  summary,
  report
}: OptimizationSummaryProps) {
  const [isOpen, setIsOpen] = useState(false);

  // Calculate totals
  const originalTotal = report.reduce((sum, item) => sum + item.originalPreco * item.qtd, 0);
  const optimizedTotal = report.reduce((sum, item) => sum + item.novoPreco * item.qtd, 0);
  const totalSavings = summary.totalSavings;
  const savingsPercent = originalTotal > 0 ? totalSavings / originalTotal : 0;

  return (
    <div id="optimization-summary-stats" className="mb-8">
      {/* Header com botão de expandir/recolher */}
      <button
        onClick={() => setIsOpen(!isOpen)}
        className="w-full flex items-center justify-between p-4 bg-white border border-slate-200/60 rounded-xl shadow-sm hover:bg-slate-50 transition-colors cursor-pointer"
      >
        <div className="flex items-center gap-3">
          <div className="p-2 bg-indigo-50 rounded-lg">
            <BarChart3 className="w-4 h-4 text-indigo-600" />
          </div>
          <div className="text-left">
            <p className="text-sm font-bold text-slate-800">Resumo da Otimização</p>
            <p className="text-[10px] text-slate-500">
              {formatCurrency(originalTotal)} → {formatCurrency(optimizedTotal)} | Economia: {formatCurrency(totalSavings)} ({formatPercentage(savingsPercent)})
            </p>
          </div>
        </div>
        {isOpen ? (
          <ChevronUp className="w-5 h-5 text-slate-400" />
        ) : (
          <ChevronDown className="w-5 h-5 text-slate-400" />
        )}
      </button>

      {/* Conteúdo expansível */}
      {isOpen && (
        <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-4 gap-4 mt-4">
          {/* Cost original */}
          <div className="bg-white border border-slate-200/60 p-5 rounded-xl shadow-sm flex items-center space-x-4">
            <div className="p-3 bg-slate-100 rounded-xl text-slate-500 shrink-0">
              <DollarSign className="w-5 h-5" />
            </div>
            <div>
              <p className="text-[10px] font-bold uppercase tracking-widest text-slate-400">Total Original</p>
              <p className="text-lg font-bold font-mono text-slate-700 mt-0.5">{formatCurrency(originalTotal)}</p>
              <p className="text-[10px] text-slate-400 mt-1">Lote inicial importado</p>
            </div>
          </div>

          {/* Cost Optimized */}
          <div className="bg-white border border-slate-200/60 p-5 rounded-xl shadow-sm flex items-center space-x-4">
            <div className="p-3 bg-indigo-50 rounded-xl text-indigo-600 shrink-0">
              <DollarSign className="w-5 h-5" />
            </div>
            <div>
              <p className="text-[10px] font-bold uppercase tracking-widest text-indigo-400">Total Otimizado</p>
              <p className="text-xl font-extrabold font-mono text-indigo-950 mt-0.5">{formatCurrency(optimizedTotal)}</p>
              <p className="text-[10px] text-indigo-500 font-medium mt-1 flex items-center gap-0.5">
                Preço final de faturamento
              </p>
            </div>
          </div>

          {/* Economia Estimada */}
          <div className="bg-emerald-50 border border-emerald-150 p-5 rounded-xl shadow-sm flex items-center space-x-4 relative overflow-hidden">
            <div className="p-3 bg-emerald-500 text-white rounded-xl shrink-0">
              <TrendingDown className="w-5 h-5" />
            </div>
            <div>
              <p className="text-[10px] font-bold uppercase tracking-widest text-emerald-600">Economia Gerada</p>
              <p className="text-xl font-extrabold font-mono text-emerald-800 mt-0.5">{formatCurrency(totalSavings)}</p>
              <p className="text-[10px] text-emerald-700 font-semibold mt-1 flex items-center gap-1">
                <ArrowUpRight className="w-3.5 h-3.5" />
                {formatPercentage(savingsPercent)} de redução real
              </p>
            </div>
          </div>

          {/* Itens Substituidos */}
          <div className="bg-white border border-slate-200/60 p-5 rounded-xl shadow-sm flex items-center space-x-4">
            <div className="p-3 bg-slate-100 rounded-xl text-slate-500 shrink-0">
              <PackageCheck className="w-5 h-5" />
            </div>
            <div>
              <p className="text-[10px] font-bold uppercase tracking-widest text-slate-400">Substituições</p>
              <p className="text-lg font-bold font-mono text-slate-800 mt-0.5">
                {summary.itemsSwapped} <span className="text-xs font-normal text-slate-400">/ {summary.totalItems}</span>
              </p>
              <p className="text-[10px] text-slate-500 mt-1">
                {summary.totalItems > 0
                  ? formatPercentage(summary.itemsSwapped / summary.totalItems)
                  : "0%"} otimizados
              </p>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
