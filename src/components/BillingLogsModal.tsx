import React from "react";
import { X } from "lucide-react";

interface BillingLogsModalProps {
  groupKeys: string[];
  billedGroups: Record<string, { status: "faturando" | "retornado", faltas: any[], logs: string[] }>;
  onClose: () => void;
  title: string;
}

export const BillingLogsModal: React.FC<BillingLogsModalProps> = ({ groupKeys, billedGroups, onClose, title }) => {
  const logs = groupKeys.flatMap(key => billedGroups[key]?.logs || []);
  
  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/50 backdrop-blur-sm p-4">
      <div className="bg-white border border-[#141414] w-full max-w-2xl max-h-[80vh] flex flex-col shadow-2xl">
        <div className="flex justify-between items-center p-4 border-b border-[#141414]/10 bg-[#DCDAD7]">
          <h2 className="font-serif italic font-bold text-lg text-[#141414]">{title}</h2>
          <button onClick={onClose} className="p-1 hover:bg-[#141414]/10 rounded-full transition-colors">
            <X className="w-5 h-5 text-[#141414]" />
          </button>
        </div>
        <div className="p-4 overflow-y-auto flex-1 font-mono text-[11px] bg-[#141414] text-[#D1D5DB] space-y-1">
          {logs.length === 0 ? (
            <p className="text-center py-10 opacity-50">Nenhum log disponível.</p>
          ) : (
            logs.map((log, index) => (
              <div key={index} className="border-b border-white/5 pb-1 last:border-0">{log}</div>
            ))
          )}
        </div>
      </div>
    </div>
  );
};
