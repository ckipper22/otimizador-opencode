import React, { useState } from 'react';
import { AlertTriangle, Check, Info } from 'lucide-react';
import { formatCurrency } from '../utils';

interface ConfirmQuantitiesModalProps {
  items: any[];
  onConfirmQty: (codInterno: string, newQty: number) => void;
}

export const ConfirmQuantitiesModal: React.FC<ConfirmQuantitiesModalProps> = ({
  items,
  onConfirmQty,
}) => {
  const [quantities, setQuantities] = useState<Record<string, number>>(() => {
    const initial: Record<string, number> = {};
    items.forEach((item) => {
      initial[item.codInterno] = item.qtd || 1;
    });
    return initial;
  });

  const handleQtyChange = (codInterno: string, val: string) => {
    const num = parseInt(val, 10);
    setQuantities((prev) => ({
      ...prev,
      [codInterno]: isNaN(num) ? 0 : Math.max(0, num),
    }));
  };

  const handleOkClick = (codInterno: string) => {
    const qty = quantities[codInterno] !== undefined ? quantities[codInterno] : 1;
    onConfirmQty(codInterno, qty);
  };

  if (!items || items.length === 0) return null;

  return (
    <div className="fixed inset-0 z-50 bg-black/70 backdrop-blur-md flex items-center justify-center p-4 overflow-y-auto animate-fade-in">
      <div className="bg-[#E4E3E0] border-2 border-[#141414] max-w-4xl w-full p-6 shadow-2xl rounded-none text-[#141414] font-sans my-8 max-h-[90vh] flex flex-col">
        {/* Modal Header */}
        <div className="flex items-start gap-3 pb-4 border-b border-[#141414]/20 shrink-0">
          <div className="p-2.5 bg-amber-500 text-white rounded-none shrink-0 shadow-sm">
            <AlertTriangle className="w-6 h-6" />
          </div>
          <div>
            <h2 className="text-lg font-serif italic font-bold text-[#141414] leading-tight">
              Atenção: Validação de Quantidades & Fracionados
            </h2>
            <p className="text-xs text-gray-700 mt-1 leading-relaxed">
              Identificamos <strong>{items.length} item(ns)</strong> com indicação de embalagem coletiva/master ou discrepância de preço em relação ao ERP. Ajuste e confirme a quantidade desejada abaixo para liberar a visualização do faturamento.
            </p>
          </div>
        </div>

        {/* Info Banner */}
        <div className="my-4 p-3 bg-amber-100/80 border border-amber-300 text-amber-900 text-xs flex items-center gap-2.5 shrink-0">
          <Info className="w-4 h-4 shrink-0 text-amber-700" />
          <span>
            Digite a quantidade real desejada em caixas/unidades. Digite <strong>0</strong> para remover o item do faturamento. Clique em <strong>OK</strong> em cada linha para validar.
          </span>
        </div>

        {/* Items Table */}
        <div className="overflow-y-auto flex-1 border border-[#141414]/20 bg-white">
          <table className="w-full text-left text-xs border-collapse">
            <thead>
              <tr className="bg-[#141414] text-[#E4E3E0] uppercase text-[10px] tracking-wider font-mono">
                <th className="p-3 border-r border-white/10">Produto Original (ERP)</th>
                <th className="p-3 border-r border-white/10">Sugestão Distribuidor</th>
                <th className="p-3 border-r border-white/10 text-center w-28">Quantidade</th>
                <th className="p-3 text-center w-20">Ação</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-gray-200">
              {items.map((item) => {
                const currentQty = quantities[item.codInterno] !== undefined ? quantities[item.codInterno] : item.qtd;
                const unitPrice = item.novoPreco || item.originalPreco || 0;
                const totalPrice = unitPrice * currentQty;

                return (
                  <tr key={item.codInterno} className="hover:bg-amber-50/50 transition-colors">
                    {/* Original Product */}
                    <td className="p-3 border-r border-gray-200 align-top">
                      <div className="font-bold text-gray-900">{item.originalDescricao}</div>
                      <div className="text-[10px] text-gray-500 font-mono mt-0.5">
                        Cód: {item.codInterno} | EAN: {item.originalEan}
                      </div>
                      <div className="text-[11px] font-semibold text-gray-700 mt-1">
                        Preço ERP: <span className="font-mono">{formatCurrency(item.originalPreco)}</span>
                      </div>
                    </td>

                    {/* Distributor Suggestion */}
                    <td className="p-3 border-r border-gray-200 align-top">
                      <div className="font-bold text-blue-950">{item.novaDescricao || item.originalDescricao}</div>
                      <div className="text-[10px] text-gray-600 font-mono mt-0.5">
                        Distribuidor: <strong>{item.distribuidora}</strong>
                      </div>
                      <div className="text-[11px] font-bold text-emerald-800 mt-1 font-mono">
                        Cotado: {formatCurrency(unitPrice)}/un
                        {currentQty > 0 && (
                          <span className="text-gray-600 font-normal ml-1">
                            (Total: {formatCurrency(totalPrice)})
                          </span>
                        )}
                      </div>
                      {item.isProfarmaAlert ? (
                        <div className="mt-2 text-[10px] bg-rose-100 text-rose-950 border border-rose-300 p-2 rounded-none font-sans font-bold flex flex-col gap-1">
                          <div className="flex items-center gap-1 text-rose-800 font-mono uppercase">
                            <AlertTriangle className="w-3.5 h-3.5 shrink-0 text-rose-600" />
                            <span>Alerta de Duplicidade Profarma</span>
                          </div>
                          <div className="text-[10px] font-normal text-rose-900 leading-tight font-sans">
                            {item.motivoAlertaProfarma || "Este item foi enviado para a Profarma nas últimas 48h. Verifique a quantidade ou digite 0 para remover do lote."}
                          </div>
                        </div>
                      ) : (
                        <div className="mt-2 text-[10px] bg-amber-50 text-amber-900 border border-amber-200 p-1.5 rounded-none font-sans">
                          ⚠️ Ajuste a quantidade pois o produto é potencialmente fracionado.
                          {item.motivoAlerta && (
                            <div className="mt-0.5 text-amber-800 font-medium">{item.motivoAlerta}</div>
                          )}
                        </div>
                      )}
                    </td>

                    {/* Quantity Input */}
                    <td className="p-3 border-r border-gray-200 text-center align-middle">
                      <div className="flex flex-col items-center gap-1">
                        <label className="text-[9px] uppercase font-bold text-gray-500 font-mono">
                          Qtd Caixas
                        </label>
                        <input
                          type="number"
                          min="0"
                          value={currentQty}
                          onChange={(e) => handleQtyChange(item.codInterno, e.target.value)}
                          className="w-20 px-2 py-1.5 border-2 border-[#141414] font-mono text-center font-extrabold bg-white text-sm focus:outline-none focus:ring-2 focus:ring-emerald-600"
                        />
                        {currentQty === 0 && (
                          <span className="text-[9px] text-rose-600 font-bold uppercase tracking-tight">
                            Será Removido
                          </span>
                        )}
                      </div>
                    </td>

                    {/* Action Button */}
                    <td className="p-3 text-center align-middle">
                      <button
                        onClick={() => handleOkClick(item.codInterno)}
                        className="inline-flex items-center justify-center gap-1 bg-emerald-700 hover:bg-emerald-800 text-white font-bold text-xs px-3 py-2 uppercase tracking-wider border border-emerald-800 transition-all cursor-pointer shadow-sm active:scale-95"
                        title={currentQty === 0 ? "Remover item" : "Confirmar quantidade"}
                      >
                        <Check className="w-3.5 h-3.5" />
                        <span>OK</span>
                      </button>
                    </td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        </div>
      </div>
    </div>
  );
};
