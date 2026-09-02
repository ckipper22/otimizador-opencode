import { useState, useEffect, useMemo, useCallback } from "react";

function cleanEan(e: string): string {
  if (!e) return "";
  const cleaned = String(e).trim().replace(/\D/g, "");
  if (!cleaned) return "";
  if (cleaned.length <= 13) {
    return cleaned.padStart(13, "0");
  }
  return cleaned;
}

interface FaturadoPendente {
  ean: string;
  dataFaturado: string;
  aliasTrier: string;
  codDist: number;
}

/**
 * Hook compartilhado para detecção de itens faturados sem entrada confirmada.
 * Generalizado de "Profarma 48h" pra qualquer distribuidora SmartPed
 * que tenha um alias de匹配 configurado (tabela distribuidor_alias).
 * Fonte: tabela itens_confirmados (Turso) JOIN distribuidor_alias.
 * Usado tanto em SwapsTable.tsx (alerta visual + grupo "Aguardando Chegar")
 * quanto em useOptimizationResult.ts (modal de confirmação antes de faturar).
 */
export function useProfarmaAlertCheck(
  cnpj: string,
  alertaProfarma48hEnabled: boolean,
  relevantEans: string[] = []
) {
  const relevantEansSet = useMemo(
    () => new Set(relevantEans.map(cleanEan).filter(Boolean)),
    [relevantEans]
  );
  const relevantEansKey = useMemo(
    () => Array.from(relevantEansSet).sort().join(","),
    [relevantEansSet]
  );
  // Map ean → { dataFaturado, aliasTrier, codDist }
  const [faturadosMap, setFaturadosMap] = useState<Map<string, { dataFaturado: string; aliasTrier: string; codDist: number }>>(new Map());
  const [isLoading, setIsLoading] = useState(false);

  // Buscar faturados pendentes quando o hook é montado ou cnpj muda
  useEffect(() => {
    if (!alertaProfarma48hEnabled || !cnpj || relevantEansSet.size === 0) {
      setFaturadosMap(new Map());
      return;
    }

    let cancelled = false;
    (async () => {
      setIsLoading(true);
      try {
        const res = await fetch(`/api/profarma-faturados-pendentes?cnpj=${encodeURIComponent(cnpj)}`);
        if (!res.ok) return;
        const data = await res.json();
        const eans: FaturadoPendente[] = data.eans || [];
        if (!cancelled) {
          const map = new Map<string, { dataFaturado: string; aliasTrier: string; codDist: number }>();
          for (const entry of eans) {
            const ean = cleanEan(entry.ean);
            if (ean && relevantEansSet.has(ean)) {
              map.set(ean, { dataFaturado: entry.dataFaturado, aliasTrier: entry.aliasTrier, codDist: entry.codDist });
            }
          }
          setFaturadosMap(map);
        }
      } catch {
        // Ignore errors — keep empty map (no alerts)
      } finally {
        if (!cancelled) setIsLoading(false);
      }
    })();
    return () => { cancelled = true; };
  }, [cnpj, alertaProfarma48hEnabled, relevantEansKey]);

  // EANs com entrada confirmada via compras-historico (checagem secundária)
  const [confirmedEntries, setConfirmedEntries] = useState<Set<string>>(new Set());
  const [checking, setChecking] = useState<Set<string>>(new Set());

  // Verificar entradas confirmadas via proxy compras-historico
  useEffect(() => {
    if (!alertaProfarma48hEnabled) return;
    if (faturadosMap.size === 0) return;

    const toCheck = Array.from(faturadosMap.entries()).filter(
      ([ean]) => !confirmedEntries.has(ean) && !checking.has(ean)
    );
    if (toCheck.length === 0) return;

    const newChecking = new Set(checking);
    toCheck.forEach(([ean]) => newChecking.add(ean));
    setChecking(newChecking);

    let cancelled = false;
    (async () => {
      const confirmed = new Set<string>();
      // PROTEÇÃO DE PERFORMANCE: manter BATCH_SIZE=8 e escopo relevantEans.
      // A API da Trier é frágil sob volume (histórico de perda de itens por
      // sobrecarga — ver CEGUEIRA ANTIGA #24, #25). Nunca aumentar BATCH_SIZE
      // pra compensar volume maior; aumentar delay entre lotes se necessário.
      // Nunca expandir relevantEans pra "tudo pendente" — só EANs do relatório.
      const BATCH_SIZE = 8;
      for (let i = 0; i < toCheck.length; i += BATCH_SIZE) {
        if (cancelled) break;
        const batch = toCheck.slice(i, i + BATCH_SIZE);
        await Promise.all(
          batch.map(async ([ean, entry]) => {
            try {
              const res = await fetch(`/api/produtos/compras-historico/${ean}?meses=1`);
              if (!res.ok) return;
              const data = await res.json();
              const compras = data.compras || data.Compras || [];
              const faturadoDate = new Date(entry.dataFaturado.replace(' ', 'T') + 'Z');
              const faturadoDateOnly = new Date(faturadoDate.getFullYear(), faturadoDate.getMonth(), faturadoDate.getDate());
              const aliasTrierUpper = entry.aliasTrier.toUpperCase();
              for (const compra of compras) {
                const fornecedor = String(compra.fornecedor || compra.Fornecedor || "").toUpperCase();
                const dataEntrada = compra.data || compra.Data || compra.dataEntrada || "";
                if (aliasTrierUpper && fornecedor.includes(aliasTrierUpper) && dataEntrada) {
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
      }
      if (!cancelled) {
        setConfirmedEntries((prev) => {
          const next = new Set(prev);
          confirmed.forEach((ean) => next.add(ean));
          return next;
        });
        setChecking((prev) => {
          const next = new Set(prev);
          toCheck.forEach(([ean]) => next.delete(ean));
          return next;
        });
      }
    })();
    return () => {
      cancelled = true;
    };
  }, [faturadosMap, alertaProfarma48hEnabled]);

  /** true se o EAN está faturado sem entrada confirmada */
  const isEanProfarmaAlerted = useCallback((rawEan: string): boolean => {
    if (!alertaProfarma48hEnabled) return false;
    const ean = cleanEan(rawEan);
    return faturadosMap.has(ean) && !confirmedEntries.has(ean);
  }, [faturadosMap, confirmedEntries, alertaProfarma48hEnabled]);

  /** Retorna a data do faturamento (YYYY-MM-DD HH:MM:SS) ou undefined */
  const getProfarmaOrderDate = useCallback((rawEan: string): string | undefined => {
    const ean = cleanEan(rawEan);
    return faturadosMap.get(ean)?.dataFaturado;
  }, [faturadosMap]);

  /** Retorna o alias Trier da distribuidora que faturou o EAN, ou undefined se não há alerta */
  const getFaturadoDistribuidora = useCallback((rawEan: string): string | undefined => {
    const ean = cleanEan(rawEan);
    return faturadosMap.get(ean)?.aliasTrier;
  }, [faturadosMap]);

  return {
    isEanProfarmaAlerted,
    getProfarmaOrderDate,
    getFaturadoDistribuidora,
    isLoadingProfarma: isLoading,
  };
}
