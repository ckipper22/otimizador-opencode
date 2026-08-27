import { useState, useEffect } from "react";

function cleanEan(e: string): string {
  if (!e) return "";
  const cleaned = String(e).trim().replace(/\D/g, "");
  if (!cleaned) return "";
  if (cleaned.length <= 13) {
    return cleaned.padStart(13, "0");
  }
  return cleaned;
}

interface ProfarmaFaturadoPendente {
  ean: string;
  dataFaturado: string;
}

/**
 * Hook compartilhado para detecção de itens Profarma faturados sem entrada.
 * Fonte: tabela itens_confirmados (Turso) via /api/profarma-faturados-pendentes.
 * Usado tanto em SwapsTable.tsx (alerta visual + grupo "Aguardando Chegar Profarma")
 * quanto em useOptimizationResult.ts (modal de confirmação antes de faturar).
 */
export function useProfarmaAlertCheck(
  cnpj: string,
  alertaProfarma48hEnabled: boolean
) {
  // Map ean → data do faturamento (YYYY-MM-DD HH:MM:SS do Turso)
  const [profarmaFaturadosMap, setProfarmaFaturadosMap] = useState<Map<string, string>>(new Map());
  const [isLoading, setIsLoading] = useState(false);

  // Buscar Profarma faturados pendentes quando o hook é montado ou cnpj muda
  useEffect(() => {
    if (!alertaProfarma48hEnabled || !cnpj) {
      setProfarmaFaturadosMap(new Map());
      return;
    }

    let cancelled = false;
    (async () => {
      setIsLoading(true);
      try {
        const res = await fetch(`/api/profarma-faturados-pendentes?cnpj=${encodeURIComponent(cnpj)}`);
        if (!res.ok) return;
        const data = await res.json();
        const eans: ProfarmaFaturadoPendente[] = data.eans || [];
        if (!cancelled) {
          const map = new Map<string, string>();
          for (const entry of eans) {
            const ean = cleanEan(entry.ean);
            if (ean) {
              map.set(ean, entry.dataFaturado);
            }
          }
          setProfarmaFaturadosMap(map);
        }
      } catch {
        // Ignore errors — keep empty map (no alerts)
      } finally {
        if (!cancelled) setIsLoading(false);
      }
    })();
    return () => { cancelled = true; };
  }, [cnpj, alertaProfarma48hEnabled]);

  // EANs com entrada confirmada via compras-historico (cheçagem secundária)
  const [profarmaConfirmedEntries, setProfarmaConfirmedEntries] = useState<Set<string>>(new Set());
  const [profarmaChecking, setProfarmaChecking] = useState<Set<string>>(new Set());

  // Verificar entradas confirmadas via proxy compras-historico
  useEffect(() => {
    if (!alertaProfarma48hEnabled) return;
    if (profarmaFaturadosMap.size === 0) return;

    const toCheck = Array.from(profarmaFaturadosMap.entries()).filter(
      ([ean]) => !profarmaConfirmedEntries.has(ean) && !profarmaChecking.has(ean)
    );
    if (toCheck.length === 0) return;

    const newChecking = new Set(profarmaChecking);
    toCheck.forEach(([ean]) => newChecking.add(ean));
    setProfarmaChecking(newChecking);

    let cancelled = false;
    (async () => {
      const confirmed = new Set<string>();
      await Promise.all(
        toCheck.map(async ([ean, dataFaturado]) => {
          try {
            const res = await fetch(`/api/produtos/compras-historico/${ean}?meses=1`);
            if (!res.ok) return;
            const data = await res.json();
            const compras = data.compras || data.Compras || [];
            // Parse dataFaturado (YYYY-MM-DD HH:MM:SS) → local Date
            const faturadoDate = new Date(dataFaturado.replace(' ', 'T'));
            // Use only date portion for comparison (strip time)
            const faturadoDateOnly = new Date(faturadoDate.getFullYear(), faturadoDate.getMonth(), faturadoDate.getDate());
            for (const compra of compras) {
              const fornecedor = String(compra.fornecedor || compra.Fornecedor || "").toUpperCase();
              const dataEntrada = compra.data || compra.Data || compra.dataEntrada || "";
              if (fornecedor.includes("PROFARMA") && dataEntrada) {
                // Parse YYYY-MM-DD → local Date (sem UTC shift)
                const entradaParts = dataEntrada.split("-");
                const entradaDate =
                  entradaParts.length === 3
                    ? new Date(parseInt(entradaParts[0]), parseInt(entradaParts[1]) - 1, parseInt(entradaParts[2]))
                    : new Date(dataEntrada);
                if (!isNaN(entradaDate.getTime()) && entradaDate >= faturadoDateOnly) {
                  confirmed.add(ean);
                  break;
                }
              }
            }
          } catch {
            // Ignore errors — keep the alert visible
          }
        })
      );
      if (!cancelled) {
        setProfarmaConfirmedEntries((prev) => {
          const next = new Set(prev);
          confirmed.forEach((ean) => next.add(ean));
          return next;
        });
        setProfarmaChecking((prev) => {
          const next = new Set(prev);
          toCheck.forEach(([ean]) => next.delete(ean));
          return next;
        });
      }
    })();
    return () => {
      cancelled = true;
    };
  }, [profarmaFaturadosMap, alertaProfarma48hEnabled]);

  /** true se o EAN está faturado pela Profarma sem entrada confirmada */
  const isEanProfarmaAlerted = (rawEan: string): boolean => {
    if (!alertaProfarma48hEnabled) return false;
    const ean = cleanEan(rawEan);
    return profarmaFaturadosMap.has(ean) && !profarmaConfirmedEntries.has(ean);
  };

  /** Retorna a data do faturamento Profarma (YYYY-MM-DD HH:MM:SS) ou undefined */
  const getProfarmaOrderDate = (rawEan: string): string | undefined => {
    const ean = cleanEan(rawEan);
    return profarmaFaturadosMap.get(ean);
  };

  return {
    isEanProfarmaAlerted,
    getProfarmaOrderDate,
    isLoadingProfarma: isLoading,
  };
}
