import React, { useState, useMemo } from 'react';
import { X, Search } from 'lucide-react';
import { FaturadoItem } from '../types';
import { formatCurrency } from '../utils';

export function FaturadosModal({ faturados, onClose }: { faturados: FaturadoItem[], onClose: () => void }) {
  const [query, setQuery] = useState("");

  const filteredItems = useMemo(() => {
    let result = [...faturados];
    if (query) {
       const lower = query.toLowerCase();
       result = result.filter(item => 
         item.descricao.toLowerCase().includes(lower) ||
         item.ean.includes(lower) ||
         item.laboratorio.toLowerCase().includes(lower) ||
         item.fornecedor.toLowerCase().includes(lower)
       );
    }
    result.sort((a, b) => a.descricao.localeCompare(b.descricao));
    return result;
  }, [faturados, query]);

  const total = useMemo(() => {
    return filteredItems.reduce((acc, curr) => acc + (curr.valor * curr.quantidade), 0);
  }, [filteredItems]);

  return (
    <div className="fixed inset-0 z-[100] flex items-center justify-center bg-[#141414]/80 backdrop-blur-sm p-4">
      <div className="bg-white w-full max-w-4xl shadow-2xl flex flex-col max-h-[90vh]">
        <div className="flex items-center justify-between p-4 border-b border-[#141414]/10 bg-gray-50">
          <div>
            <h2 className="text-sm font-black text-[#141414] uppercase tracking-wider font-sans">
              Itens Faturados
            </h2>
            <p className="text-[10px] text-gray-500 font-sans uppercase font-medium mt-0.5">
              Total Faturado: <span className="text-emerald-700 font-bold">{formatCurrency(total)}</span>
            </p>
          </div>
          <button
            onClick={onClose}
            className="text-gray-400 hover:text-[#141414] transition-colors p-1"
          >
            <X className="w-5 h-5" />
          </button>
        </div>

        <div className="p-3 bg-white border-b border-[#141414]/10">
          <div className="relative">
            <Search className="absolute left-2.5 top-1/2 -translate-y-1/2 w-3.5 h-3.5 text-gray-400" />
            <input
              type="text"
              placeholder="Pesquisar por descrição, EAN, laboratório ou fornecedor..."
              value={query}
              onChange={(e) => setQuery(e.target.value)}
              className="w-full pl-8 pr-3 py-1.5 bg-gray-50 border border-gray-200 text-[#141414] text-[10px] font-bold uppercase tracking-wider font-sans focus:outline-none focus:border-[#141414] focus:ring-1 focus:ring-[#141414] transition-all rounded-none"
            />
          </div>
        </div>

        <div className="flex-1 overflow-auto bg-gray-50">
          <table className="w-full text-left border-collapse">
            <thead className="sticky top-0 bg-[#141414] z-10">
              <tr className="uppercase tracking-wider text-[9px] font-bold text-[#E4E3E0]">
                <th className="py-2.5 px-3 border-r border-white/10 font-sans w-1/5">Fornecedor</th>
                <th className="py-2.5 px-3 border-r border-white/10 font-sans w-[120px]">Cód. Barras</th>
                <th className="py-2.5 px-3 border-r border-white/10 font-sans">Descrição / Lab</th>
                <th className="py-2.5 px-3 border-r border-white/10 font-sans text-center w-20">Valor</th>
                <th className="py-2.5 px-3 font-sans text-center w-20">Qtd</th>
              </tr>
            </thead>
            <tbody>
              {filteredItems.length === 0 ? (
                <tr>
                  <td colSpan={5} className="py-8 text-center text-gray-500 font-sans text-xs uppercase font-medium">
                    Nenhum item faturado encontrado.
                  </td>
                </tr>
              ) : (
                filteredItems.map((item, idx) => (
                  <tr key={idx} className="border-b border-[#141414]/5 hover:bg-emerald-50/40 transition-colors text-[10px] bg-white">
                    <td className="py-2.5 px-3 border-r border-[#141414]/10 font-bold text-gray-700">
                      {item.fornecedor}
                    </td>
                    <td className="py-2.5 px-3 border-r border-[#141414]/10 font-mono text-gray-500">
                      {item.ean}
                    </td>
                    <td className="py-2.5 px-3 border-r border-[#141414]/10 font-bold text-[#141414]">
                      {item.descricao}
                      <span className="ml-1 text-gray-400 font-normal">| Lab: </span>
                      <span className="text-gray-600 uppercase tracking-wider">{item.laboratorio}</span>
                    </td>
                    <td className="py-2.5 px-3 border-r border-[#141414]/10 text-center font-bold text-emerald-700">
                      {formatCurrency(item.valor)}
                    </td>
                    <td className="py-2.5 px-3 text-center font-bold text-[#141414]">
                      {item.quantidade}
                    </td>
                  </tr>
                ))
              )}
            </tbody>
          </table>
        </div>
      </div>
    </div>
  );
}
