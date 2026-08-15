import { useState, useEffect, useRef } from "react";

export const OFFER_COL_DEFAULTS: Record<string, { vis: boolean; w: number }> = {
  dist:      { vis: true,  w: 150 },
  prod:      { vis: true,  w: 280 },
  pfab:      { vis: true,  w: 100 },
  desc:      { vis: true,  w: 90  },
  descExtra: { vis: false, w: 100 },
  st:        { vis: false, w: 100 },
  pLiq:      { vis: true,  w: 120 },
  prazo:     { vis: true,  w: 80  },
  qtdMin:    { vis: true,  w: 100 },
  pedMin:    { vis: true,  w: 110 },
  acao:      { vis: true,  w: 180 },
};

export const OFFER_COL_LABELS: Record<string, string> = {
  dist: "Distribuidora", prod: "Produto & EAN", pfab: "P. Fábrica",
  desc: "Desc %", descExtra: "Desc Extra %", st: "ST (R$)",
  pLiq: "Preço Líquido", prazo: "Prazo", qtdMin: "Qtd Mín. Item",
  pedMin: "Ped. Mín. Dist", acao: "Qtd / Ação",
};

const OFFER_COL_KEYS = Object.keys(OFFER_COL_DEFAULTS);

const loadColSettings = (): { vis: Record<string, boolean>; widths: Record<string, number> } => {
  try {
    const raw = sessionStorage.getItem("smartped_offer_cols");
    if (raw) {
      const parsed = JSON.parse(raw);
      const vis: Record<string, boolean> = {};
      const widths: Record<string, number> = {};
      for (const k of OFFER_COL_KEYS) {
        vis[k] = parsed.vis?.[k] !== undefined ? parsed.vis[k] : OFFER_COL_DEFAULTS[k].vis;
        widths[k] = parsed.widths?.[k] !== undefined ? parsed.widths[k] : OFFER_COL_DEFAULTS[k].w;
      }
      return { vis, widths };
    }
  } catch {}
  const vis: Record<string, boolean> = {};
  const widths: Record<string, number> = {};
  for (const k of OFFER_COL_KEYS) { vis[k] = OFFER_COL_DEFAULTS[k].vis; widths[k] = OFFER_COL_DEFAULTS[k].w; }
  return { vis, widths };
};

export function useOfferTableColumns() {
  const [offerColVis, setOfferColVis] = useState<Record<string, boolean>>(() => loadColSettings().vis);
  const [offerColWidths, setOfferColWidths] = useState<Record<string, number>>(() => loadColSettings().widths);
  const [showColSettings, setShowColSettings] = useState(false);
  const colSettingsRef = useRef<HTMLDivElement>(null);
  const offersTableRef = useRef<HTMLDivElement>(null);
  const [resizingCol, setResizingCol] = useState<{ key: string; startX: number; startW: number } | null>(null);

  useEffect(() => {
    const vis = offerColVis;
    const widths = offerColWidths;
    try { sessionStorage.setItem("smartped_offer_cols", JSON.stringify({ vis, widths })); } catch {}
  }, [offerColVis, offerColWidths]);

  useEffect(() => {
    if (!resizingCol) return;
    const onMove = (e: MouseEvent) => {
      const delta = e.clientX - resizingCol.startX;
      const newW = Math.max(60, resizingCol.startW + delta);
      setOfferColWidths(prev => ({ ...prev, [resizingCol.key]: newW }));
    };
    const onUp = () => setResizingCol(null);
    document.addEventListener("mousemove", onMove);
    document.addEventListener("mouseup", onUp);
    return () => { document.removeEventListener("mousemove", onMove); document.removeEventListener("mouseup", onUp); };
  }, [resizingCol]);

  useEffect(() => {
    if (!showColSettings) return;
    const onClick = (e: MouseEvent) => {
      if (colSettingsRef.current && !colSettingsRef.current.contains(e.target as Node)) setShowColSettings(false);
    };
    document.addEventListener("mousedown", onClick);
    return () => document.removeEventListener("mousedown", onClick);
  }, [showColSettings]);

  return {
    offerColVis, setOfferColVis,
    offerColWidths, setOfferColWidths,
    showColSettings, setShowColSettings,
    resizingCol, setResizingCol,
    colSettingsRef,
    offersTableRef,
    OFFER_COL_DEFAULTS,
    OFFER_COL_LABELS,
    OFFER_COL_KEYS,
  };
}
