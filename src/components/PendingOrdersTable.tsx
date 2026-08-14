import React from "react";
import { Clock, CheckCircle, AlertCircle } from "lucide-react";
import { formatCurrency } from "../utils";

interface PendingOrdersTableProps {
  billedGroups: Record<string, { status: "faturando" | "retornado", faltas: any[], logs: string[] }>;
  onViewLogs: (groupKey: string) => void;
}

export const PendingOrdersTable: React.FC<PendingOrdersTableProps> = ({ billedGroups, onViewLogs }) => {
  const groups = Object.entries(billedGroups);

  if (groups.length === 0) return null;

  return (
    <div className="bg-[#DCDAD7] border border-[#141414] p-5 rounded-none shadow-sm text-[#141414] mb-8">
      <h3 className="font-serif italic text-base font-bold text-[#141414] mb-4">Pedidos em Processamento / Retorno</h3>
      <div className="overflow-x-auto border border-[#141414] bg-white">
        <table className="w-full text-left border-collapse font-mono text-xs">
          <thead>
            <tr className="bg-[#141414] text-[#E4E3E0] uppercase tracking-wider text-[9px] font-bold">
              <th className="py-2.5 px-3 border-r border-white/10">Distribuidora</th>
              <th className="py-2.5 px-3 border-r border-white/10 text-center">Status</th>
              <th className="py-2.5 px-3 border-r border-white/10 text-center">Itens com Falta</th>
            </tr>
          </thead>
          <tbody className="divide-y divide-[#141414]/10">
            {groups.map(([name, group]: [string, { status: "faturando" | "retornado", faltas: any[], logs: string[] }]) => (
              <tr key={name} className="hover:bg-gray-50">
                <td className="py-2.5 px-3 border-r border-[#141414]/10 font-bold">{name}</td>
                <td className="py-2.5 px-3 border-r border-[#141414]/10 text-center">
                    {group.status === "faturando" ? (
                        <div className="flex flex-col items-center gap-1">
                            <span className="flex items-center justify-center gap-1.5 text-amber-700 font-bold">
                                <Clock className="w-3 h-3 animate-spin" /> Faturando
                            </span>
                            <button onClick={() => onViewLogs(name)} className="text-[10px] underline text-blue-600 hover:text-blue-800">Ver Logs</button>
                        </div>
                    ) : (
                        <span className="flex items-center justify-center gap-1.5 text-emerald-700 font-bold">
                            <CheckCircle className="w-3 h-3" /> Retornado
                        </span>
                    )}
                </td>
                <td className="py-2.5 px-3 border-r border-[#141414]/10 text-center font-bold text-gray-700">
                    {group.faltas.length}
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </div>
  );
};
