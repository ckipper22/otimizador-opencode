import { BellRing } from "lucide-react";

export const ObservationBell = ({ observacao }: { observacao?: string | null }) => {
  if (!observacao) return null;
  return (
    <div className="mt-1 flex items-start gap-1 text-[9px] text-rose-700 bg-rose-50 p-1 rounded-sm border border-rose-200 font-bold uppercase tracking-wider">
      <BellRing className="w-3 h-3 shrink-0 mt-0.5 animate-pulse" />
      <span>{observacao}</span>
    </div>
  );
};
