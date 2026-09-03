import React, { useState, useEffect, useRef } from "react";
import { OptimizationResponse, SwapReportItem, OptimizerConfig, FaturadoItem } from "../types";
import { cleanEan } from "../utils";

// Função pura: calcula delay até a próxima tentativa de polling
// Base: 7s. Falhas consecutivas: backoff linear até 30s. 429: salta pra 30s direto.
const POLL_BASE_MS = 7000;
const POLL_MAX_MS = 30000;
const RATE_LIMIT_DELAY_MS = 30000;

export function getPollDelay(consecutiveFailures: number, lastWas429: boolean): number {
  if (lastWas429) return RATE_LIMIT_DELAY_MS;
  if (consecutiveFailures <= 0) return POLL_BASE_MS;
  // Backoff linear: 7s, 14s, 21s, 28s, 30s (capped)
  return Math.min(POLL_BASE_MS * (1 + consecutiveFailures), POLL_MAX_MS);
}

interface UseBillingParams {
  result: OptimizationResponse | null;
  setResult: React.Dispatch<React.SetStateAction<OptimizationResponse | null>>;
  config: OptimizerConfig;
  activeReport: SwapReportItem[];
  disregardedCodes: Set<string>;
  disabledItemCodes: Set<string>;
  setDisabledItemCodes: React.Dispatch<React.SetStateAction<Set<string>>>;
  billedItemCodes: Set<string>;
  setBilledItemCodes: React.Dispatch<React.SetStateAction<Set<string>>>;
  setLogs: React.Dispatch<React.SetStateAction<string[]>>;
}

export function useBilling({
  result,
  setResult,
  config,
  activeReport,
  disregardedCodes,
  disabledItemCodes,
  setDisabledItemCodes,
  billedItemCodes,
  setBilledItemCodes,
  setLogs,
}: UseBillingParams) {
  const [isBillingLoading, setIsBillingLoading] = useState<boolean>(false);
  const [billingResult, setBillingResult] = useState<any | null>(null);
  const [isBillingModalOpen, setIsBillingModalOpen] = useState<boolean>(false);
  const [billedGroups, setBilledGroups] = useState<Record<string, { status: "faturando" | "retornado", faltas: any[], logs: string[] }>>({});
  const [billingContext, setBillingContext] = useState<{relatedGroups: string[], baseDistName: string, numPedido: number, itemsFaturados: any[], encomendasPendentes?: any[]} | null>(null);
  const [viewingLogs, setViewingLogs] = useState<{groupKeys: string[], title: string} | null>(null);
  const [billingConfirm, setBillingConfirm] = useState<{ specificDistributorName?: string; baseDistName: string; activeItems: any[] } | null>(null);
  const [billingChoice, setBillingChoice] = useState<{ specificDistributorName?: string; baseDistName: string; activeItems: any[] } | null>(null);
  const [faturadosGlobais, setFaturadosGlobais] = useState<FaturadoItem[]>([]);
  const [isFaturadosOpen, setIsFaturadosOpen] = useState<boolean>(false);
  const [orderReturn, setOrderReturn] = useState<any | null>(null);
  const [isCheckingReturn, setIsCheckingReturn] = useState<boolean>(false);
  const [returnCheckLogs, setReturnCheckLogs] = useState<string[]>([]);
  const [manualCutsAlert, setManualCutsAlert] = useState<any[] | null>(null);
  const [autoPollReturn, setAutoPollReturn] = useState<boolean>(false);
  const [suspectItemAlert, setSuspectItemAlert] = useState<{ item: any; specificDistributorName?: string } | null>(null);
  const [confirmedEncomendaIds, setConfirmedEncomendaIds] = useState<Set<string>>(new Set());

  // Polling: refs pra controle de backoff (não causam re-render)
  const consecutiveFailuresRef = useRef(0);
  const lastWas429Ref = useRef(false);
  const pollTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);

  const handleSendBilling = async (specificDistributorNameInput?: any, bypassSuspectCheck = false, bypassConfirm = false, forceDownloadJson = false) => {
    if (!result) return;

    const specificDistributorName = typeof specificDistributorNameInput === "string" ? specificDistributorNameInput : undefined;
    let activeItems = activeReport.filter(item => !disabledItemCodes.has(item.codInterno));
    let baseDistName = specificDistributorName ? specificDistributorName.split(" [")[0] : "Todas as Distribuidoras";

    let relatedGroups: string[] = [];

    const allDistGroups = new Set<string>();
    activeItems.forEach(item => {
        const dist = item.distribuidora || "Não Encontrados";
        if (!specificDistributorName || dist === baseDistName) {
            const isVirtual = dist === "Não Encontrados" || dist === "Sem Estoque";
            const groupKey = isVirtual
              ? dist
              : `${dist} [${item.condicao || "FIXA"} | ${item.prazo !== undefined ? item.prazo : 0}d]`;
            allDistGroups.add(groupKey);
        }
    });

    relatedGroups = Array.from(allDistGroups);

    if (specificDistributorName) {
      activeItems = activeItems.filter(item => {
        const dist = item.distribuidora || "Não Encontrados";
        return dist === baseDistName;
      });
    }

    if (forceDownloadJson) {
      const payloadItems = activeItems.map(item => {
        const baseItem = item;
        const codProdDist = String(baseItem.codProdutoDist || "").trim();
        const codProdRaw = String(baseItem.codProduto || "").trim();
        const finalCodProduto = (codProdRaw === "" || codProdRaw === "0") ? codProdDist : codProdRaw;

        return {
          ...baseItem,
          codProduto: finalCodProduto
        };
      });

      const payload = {
        items: payloadItems,
        token: config.token,
        cnpj: config.cnpj,
        tipos: config.tipos,
        margemMinima: config.margemMinima,
        permitirSemEstoque: config.permitirSemEstoque
      };

      const jsonStr = JSON.stringify(payload, null, 2);
      const blob = new Blob([jsonStr], { type: "application/json;charset=utf-8;" });
      const url = URL.createObjectURL(blob);
      const link = document.createElement("a");
      const sanitizedDistName = baseDistName.replace(/\s+/g, "_");
      link.setAttribute("href", url);
      link.setAttribute("download", `faturamento_payload_${sanitizedDistName}.json`);
      document.body.appendChild(link);
      link.click();
      document.body.removeChild(link);
      return;
    }

    if (!bypassSuspectCheck) {
      const suspectItem = activeItems.find(item =>
        String(item.originalEan).trim() === "7896004706559" ||
        String(item.novoEan).trim() === "7896004706559"
      );
      if (suspectItem) {
        setSuspectItemAlert({
          item: suspectItem,
          specificDistributorName
        });
        return;
      }
    }

    if (activeItems.length === 0) {
      alert("Nenhum item ativo para faturar. Certifique-se de que há itens habilitados.");
      return;
    }

    if (!bypassConfirm) {
      setBillingChoice({
        specificDistributorName,
        baseDistName,
        activeItems
      });
      return;
    }

    setBilledGroups(prev => {
        const next = { ...prev };
        relatedGroups.forEach(g => {
            next[g] = { status: "faturando", faltas: [], logs: ["Iniciando faturamento..."] };
        });
        return next;
    });

    setIsBillingLoading(true);
    setBillingResult(null);
    setIsBillingModalOpen(true);
    setReturnCheckLogs([]);
    setLogs(["[SISTEMA] Iniciando comunicação com API SmartPed...", `[SISTEMA] Preparando ${activeItems.length} itens para envio.`]);

    try {
      const response = await fetch("/api/faturar", {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
        },
        body: JSON.stringify({
          items: activeItems.map(item => {
            const baseItem = item;
            const codProdDist = String(baseItem.codProdutoDist || "").trim();
            const codProdRaw = String(baseItem.codProduto || "").trim();
            const finalCodProduto = (codProdRaw === "" || codProdRaw === "0") ? codProdDist : codProdRaw;

            return {
              ...baseItem,
              codProduto: finalCodProduto
            };
          }),
          token: config.token,
          cnpj: config.cnpj,
          tipos: config.tipos,
          margemMinima: config.margemMinima,
          permitirSemEstoque: config.permitirSemEstoque
        }),
      });

      const data = await response.json();
      if (!response.ok) {
        throw new Error(data.error || "Erro ao enviar faturamento.");
      }

      setBilledItemCodes(prev => {
         const next = new Set(prev);
         activeItems.forEach(i => next.add(i.codInterno));
         return next;
      });

      try {
        const manualItems = activeItems.filter(i => i.codInterno.startsWith("MANUAL-"));
        if (manualItems.length > 0) {
          const stored = localStorage.getItem("itens_manuais_enviados");
          const list = stored ? JSON.parse(stored) : [];
          const numPedido = data.numPedido || "LOTE";

          manualItems.forEach(item => {
            list.push({
              ean: cleanEan(item.novoEan || item.originalEan),
              descricao: item.novaDescricao || item.originalDescricao,
              laboratorio: item.novoLaboratorio || item.originalLaboratorio || "",
              distribuidora: item.distribuidora,
              codDist: item.codDist,
              quantSolicitada: item.qtd,
              precoLiquido: item.novoPreco || item.originalPreco,
              numPedido: String(numPedido),
              dataEnvio: new Date().toISOString()
            });
          });
          localStorage.setItem("itens_manuais_enviados", JSON.stringify(list));
        }
      } catch (e) {
        console.error("Erro ao salvar itens manuais enviados no localStorage:", e);
      }

      setBillingResult(data);
      if (data.logs) {
        setLogs(prev => [...prev, ...data.logs]);
      }

      if (data.numPedido) {
        setAutoPollReturn(true);
        setConfirmedEncomendaIds(new Set());
        setBillingContext({ relatedGroups, baseDistName, numPedido: data.numPedido, itemsFaturados: data.itemsFaturados, encomendasPendentes: data.encomendasPendentes || [] });
      }
    } catch (err: any) {
      console.error(err);
      setIsBillingModalOpen(false);
      alert(err.message || "Erro inesperado ao processar faturamento.");
      setBilledGroups(prev => {
        const next = { ...prev };
        relatedGroups.forEach(g => {
          delete next[g];
        });
        return next;
      });
    } finally {
      setIsBillingLoading(false);
    }
  };

  const handleCloseAndConsolidateBilling = () => {
    if (billingResult && result) {
      const distsInReturn = orderReturn?.Retorno?.Dists || orderReturn?.Retorno?.dists || [];
      const hasFinalizedReturn = distsInReturn.some((d: any) => d.Status === 3);

      if (orderReturn && orderReturn.Retorno && orderReturn.Retorno.Itens && hasFinalizedReturn) {
        handleReRouteShortages();
        return;
      } else {
        const baseDistName = billingContext?.baseDistName || "Todas as Distribuidoras";

        const sentItems = result.report.filter(item => {
          const dist = item.distribuidora || "Não Encontrados";
          const isThisDist = baseDistName === "Todas as Distribuidoras" || dist === baseDistName;
          return isThisDist && !disabledItemCodes.has(item.codInterno) && !billedItemCodes.has(item.codInterno);
        });

        const newFaturadosGlobais = [...faturadosGlobais];
        const itemsToKeep = [];
        const numPedido = billingContext?.numPedido || "LOTE";

        for (const reportItem of result.report) {
          const dist = reportItem.distribuidora || "Não Encontrados";
          const isThisDist = baseDistName === "Todas as Distribuidoras" || dist === baseDistName;
          const wasSentNow = isThisDist && !disabledItemCodes.has(reportItem.codInterno) && !billedItemCodes.has(reportItem.codInterno);
          const wasAlreadyBilled = billedItemCodes.has(reportItem.codInterno);

          if (wasSentNow || wasAlreadyBilled) {
            const currentEan = cleanEan(reportItem.novoEan || reportItem.originalEan);
            if (!newFaturadosGlobais.some(existing => existing.ean === currentEan && existing.notaCupom === `SMARTPED-${numPedido}`)) {
              newFaturadosGlobais.push({
                fornecedor: reportItem.distribuidora,
                ean: currentEan,
                descricao: reportItem.novaDescricao || reportItem.originalDescricao,
                laboratorio: reportItem.novoLaboratorio || reportItem.originalLaboratorio || "",
                valor: reportItem.novoPreco || reportItem.originalPreco,
                quantidade: reportItem.qtd,
                notaCupom: `SMARTPED-${numPedido}`
              });
            }
          } else {
            itemsToKeep.push(reportItem);
          }
        }

        setFaturadosGlobais(newFaturadosGlobais);
        setResult(prev => {
          if (!prev) return null;
          const activeSwaps = itemsToKeep.filter((it) => !disregardedCodes.has(it.codInterno));
          const newTotalSavings = activeSwaps.reduce((sum, it) => sum + (it.economiaTotal || 0), 0);
          return {
            ...prev,
            summary: {
              ...prev.summary,
              totalItems: itemsToKeep.length,
              totalSavings: newTotalSavings
            },
            report: itemsToKeep
          };
        });

        setBilledItemCodes(prev => {
          const next = new Set(prev);
          sentItems.forEach(si => next.delete(si.codInterno));
          return next;
        });

        setBilledGroups(prev => {
          const next = { ...prev };
          if (billingContext && billingContext.relatedGroups) {
            billingContext.relatedGroups.forEach(g => {
              delete next[g];
            });
          }
          return next;
        });
      }
    }

    setIsBillingModalOpen(false);
    setBillingResult(null);
    setOrderReturn(null);
    setAutoPollReturn(false);
  };

  const pollOrderReturn = async (numPedido: number, itemsFaturados: any[], relatedGroups: string[], baseDistName: string) => {
    const checkReturn = async () => {
      try {
        const response = await fetch("/api/pedido-retorno", {
          method: "POST",
          headers: {
            "Content-Type": "application/json",
          },
          body: JSON.stringify({
            numPedido,
            token: config.token,
            cnpj: config.cnpj,
            itemsFaturados
          })
        });

        const data = await response.json();

        if (response.ok && data.logs && data.logs.length > 0) {
           setBilledGroups(prev => {
              const next = { ...prev };
              relatedGroups.forEach(g => {
                 if (!prev[g]) return;
                 const currentLogs = prev[g]?.logs || [];
                 const newLogs = [...currentLogs];
                 data.logs.forEach((l: string) => {
                    if (!newLogs.includes(l)) newLogs.push(l);
                 });
                 next[g] = { ...prev[g], logs: newLogs };
              });
              return next;
           });
        }

        if (response.ok && data.apiResponse && (data.apiResponse.dists || data.apiResponse.Dists || data.apiResponse.Retorno?.dists || data.apiResponse.Retorno?.Dists)) {
          const rawRetorno = data.apiResponse?.Retorno || data.apiResponse?.retorno || data.apiResponse;
          const dists = rawRetorno?.dists || rawRetorno?.Dists || [];
          const itens = rawRetorno?.Itens || rawRetorno?.itens || [];

          const codDistsNoLote = Array.from(new Set((itemsFaturados || []).map((it: any) => String(it.codDist || it.CodDist || "").trim())));

          // Confirmar encomendas por distribuidora — assim que cada uma finaliza (não espera o lote inteiro)
          confirmarEncomendasAposRetorno(itens, itemsFaturados, relatedGroups, dists);

          let isAllFinalized = false;
          if (dists && dists.length > 0) {
            if (codDistsNoLote.length > 0) {
              const distsDoLote = dists.filter((d: any) => codDistsNoLote.includes(String(d.CodDist || d.codDist || "").trim()));
              if (distsDoLote.length > 0) {
                isAllFinalized = distsDoLote.every((d: any) => d.Status === 3);
              } else {
                isAllFinalized = dists.every((d: any) => d.Status === 3);
              }
            } else {
              isAllFinalized = dists.every((d: any) => d.Status === 3);
            }
          }

          if (isAllFinalized) {
            const faltas = itens.filter((it: any) => parseFloat(it.QuantFaturada || it.quantFaturada || "0") === 0);
            const succeededEans = itens.filter((it: any) => parseFloat(it.QuantFaturada || it.quantFaturada || "0") > 0).map((it: any) => String(it.Ean || it.ean).trim());

            setBilledGroups(prev => {
              const next = { ...prev };
              relatedGroups.forEach(g => {
                 const currentLogs = prev[g]?.logs || [];
                 if (!currentLogs.includes("Pedido retornado do distribuidor.")) {
                    currentLogs.push("Pedido retornado do distribuidor.");
                 }
                 next[g] = { status: "retornado", faltas, logs: currentLogs };
              });
              return next;
            });

            setResult(prev => {
              if (!prev) return prev;

              const newFaturadosGlobais: any[] = [];
              const newReport = prev.report.filter(item => {
                const dist = item.distribuidora || "Não Encontrados";
                const currentEan = String(item.novoEan || item.originalEan).trim();
                const itemDistCod = String(item.codDist).trim();

                const isThisDist = baseDistName === "Todas as Distribuidoras"
                  ? itemsFaturados.some((it: any) => String(it.ean || it.Ean).trim() === currentEan && String(it.codDist || it.CodDist).trim() === itemDistCod)
                  : dist === baseDistName;

                if (isThisDist && succeededEans.includes(currentEan)) {
                  const apiReturnItem = itens.find((it: any) => String(it.Ean || it.ean).trim() === currentEan && String(it.CodDist || it.codDist).trim() === itemDistCod);
                  const itemFornecedor = item.distribuidora || apiReturnItem?.NomeDist || apiReturnItem?.nomeDist || baseDistName;
                  newFaturadosGlobais.push({
                      ean: currentEan,
                      descricao: item.novaDescricao || item.originalDescricao,
                      laboratorio: item.novoLaboratorio || item.originalLaboratorio || "",
                      fornecedor: itemFornecedor,
                      quantidade: parseFloat(apiReturnItem?.QuantFaturada || apiReturnItem?.quantFaturada || String(item.qtd)),
                      valor: item.novoPreco || item.originalPreco,
                      notaCupom: `SMARTPED-${numPedido}`
                  });
                  return false;
                }

                if (isThisDist) {
                  const faltaMatch = itens.find((f: any) => String(f.Ean || f.ean).trim() === currentEan && String(f.CodDist || f.codDist).trim() === itemDistCod);
                  if (faltaMatch) {
                    item.observacao = faltaMatch.Motivo || faltaMatch.motivo || "Falta de estoque";
                  }
                }

                return true;
              });

              if (newFaturadosGlobais.length > 0) {
                 setFaturadosGlobais(curr => {
                    const next = [...curr];
                    for (const fItem of newFaturadosGlobais) {
                       if (!next.some(existing => existing.ean === fItem.ean && existing.notaCupom === fItem.notaCupom)) {
                          next.push(fItem);
                       }
                    }
                    if (next.length > curr.length) {
                        setTimeout(() => setIsFaturadosOpen(true), 0);
                    }
                    return next;
                 });
              }

              return { ...prev, report: newReport };
            });

            return true;
          }
        }
        return false;
      } catch (e) {
        console.error(e);
        return false;
      }
    };

    const interval = setInterval(async () => {
      const isDone = await checkReturn();
      if (isDone) {
        clearInterval(interval);
      }
    }, 2000);
  };

  // Confirmar encomendas no sistema externo — por distribuidora, assim que ela finaliza.
  // Verifica se todos os codDist dos itens da encomenda específica já estão com Status === 3.
  const confirmarEncomendasAposRetorno = async (itensRetorno: any[], itemsFaturadosOriginais: any[], relatedGroups: string[], dists: any[]) => {
    if (!billingContext?.encomendasPendentes || billingContext.encomendasPendentes.length === 0) return;

    const finalizedCodDists = new Set(
      dists.filter((d: any) => d.Status === 3).map((d: any) => String(d.CodDist || d.codDist || "").trim())
    );

    // Monta a lista de encomendas elegíveis nesse ciclo.
    // Dois tipos: sucesso (pelo menos 1 item faturado) e falha (finalizado mas 0 faturado)
    const paraConfirmar: { encomenda: any; payload: { id: string; fornecedor: string; dataPrevisao: string; status?: string; observacao?: string } }[] = [];

    try {
      for (const encPendente of billingContext.encomendasPendentes) {
        if (confirmedEncomendaIds.has(encPendente.idEncomenda)) continue;

        // Todos os codDist dos itens dessa encomenda específica precisam estar finalizados
        const encCodDists = Array.from(new Set(encPendente.itens.map((itemEnc: any) => String(itemEnc.codDist || "").trim()))) as string[];
        const todosFinalizados = encCodDists.length > 0 && encCodDists.every((cd: string) => finalizedCodDists.has(cd));
        if (!todosFinalizados) continue;

        // Verificar se pelo menos 1 item desta encomenda foi faturado
        const itensFaturadosDaEnc = encPendente.itens.filter((itemEnc: any) => {
          const eanLimpo = String(itemEnc.ean || "").trim();
          const codDistStr = String(itemEnc.codDist || "").trim();
          const retornoItem = itensRetorno.find((ri: any) =>
            String(ri.Ean || ri.ean || "").trim() === eanLimpo &&
            String(ri.CodDist || ri.codDist || "").trim() === codDistStr
          );
          return retornoItem && parseFloat(retornoItem.QuantFaturada || retornoItem.quantFaturada || "0") > 0;
        });

        if (itensFaturadosDaEnc.length > 0) {
          // Caso de SUCESSO: pelo menos 1 item faturado
          paraConfirmar.push({
            encomenda: encPendente,
            payload: {
              id: encPendente.idEncomenda,
              fornecedor: encPendente.fornecedor,
              dataPrevisao: new Date().toISOString().split("T")[0]
            }
          });
        } else {
          // Caso de FALHA: distribuidor finalizou (Status===3) mas NENHUM item foi faturado
          // Motivo: pegar do campo Motivo/motivo do retorno, ou fallback genérico
          let motivoFallo = "Distribuidor finalizou o pedido sem faturar nenhum item da encomenda.";
          for (const itemEnc of encPendente.itens) {
            const eanLimpo = String(itemEnc.ean || "").trim();
            const codDistStr = String(itemEnc.codDist || "").trim();
            const retornoItem = itensRetorno.find((ri: any) =>
              String(ri.Ean || ri.ean || "").trim() === eanLimpo &&
              String(ri.CodDist || ri.codDist || "").trim() === codDistStr
            );
            if (retornoItem) {
              const motivo = retornoItem.Motivo || retornoItem.motivo || "";
              if (motivo) { motivoFallo = motivo; break; }
            }
          }
          paraConfirmar.push({
            encomenda: encPendente,
            payload: {
              id: encPendente.idEncomenda,
              fornecedor: encPendente.fornecedor,
              dataPrevisao: new Date().toISOString().split("T")[0],
              status: "nao_atendido",
              observacao: motivoFallo
            }
          });
          console.log(`[ENCOMENDAS-CONFIRMACAO] Encomenda ${encPendente.idEncomenda} marcada como NÃO ATENDIDA — motivo: ${motivoFallo}`);
        }
      }

      if (paraConfirmar.length === 0) return;

      console.log(`[ENCOMENDAS-CONFIRMACAO] Confirmando ${paraConfirmar.length} encomenda(s) em lote: ${paraConfirmar.map(p => p.encomenda.idEncomenda).join(", ")}...`);

      let confirmadas = false;
      for (let tentativa = 1; tentativa <= 3; tentativa++) {
        try {
          const respConfirmar = await fetch(`/api/integracao/encomendas/confirmar-pedido`, {
            method: "POST",
            headers: { "Content-Type": "application/json" },
            body: JSON.stringify({
              itens: paraConfirmar.map(p => p.payload)
            })
          });
          if (respConfirmar.ok) {
            confirmadas = true;
            setConfirmedEncomendaIds(prev => {
              const next = new Set(prev);
              for (const p of paraConfirmar) next.add(p.encomenda.idEncomenda);
              return next;
            });
            break;
          } else {
            const errText = await respConfirmar.text().catch(() => "Sem detalhes");
            console.error(`[ENCOMENDAS-CONFIRMACAO] Tentativa ${tentativa}/3 - Falha ao confirmar encomendas em lote: ${respConfirmar.status} - ${errText}`);
          }
        } catch (fetchErr: any) {
          console.error(`[ENCOMENDAS-CONFIRMACAO] Tentativa ${tentativa}/3 - Erro de rede ao confirmar encomendas em lote: ${fetchErr.message}`);
        }
        if (tentativa < 3) await new Promise(r => setTimeout(r, 1000));
      }

      if (confirmadas) {
        for (const p of paraConfirmar) {
          console.log(`[ENCOMENDAS-CONFIRMACAO] Encomenda ${p.encomenda.idEncomenda} confirmada com sucesso.`);
          // Marcar encomenda_confirmada=1 no banco (server-side reconciliation não vai reprocessar)
          fetch("/api/order-items/mark-encomenda-confirmada", {
            method: "POST",
            headers: { "Content-Type": "application/json" },
            body: JSON.stringify({ idEncomenda: p.encomenda.idEncomenda }),
          }).catch(() => {});
        }
      } else {
        const msgsFalha = paraConfirmar.map(p => `⚠️ Encomenda ${p.encomenda.idEncomenda} (fornecedor: ${p.encomenda.fornecedor}) faturada no SmartPed mas NÃO foi possível confirmar no sistema de Encomendas após 3 tentativas — verifique manualmente.`);
        for (const msgFalha of msgsFalha) {
          console.error(`[ENCOMENDAS-CONFIRMACAO] ${msgFalha}`);
        }
        setBilledGroups(prev => {
          const next = { ...prev };
          for (const g of relatedGroups) {
            if (!prev[g]) continue;
            const currentLogs = prev[g]?.logs || [];
            for (const msgFalha of msgsFalha) {
              if (!currentLogs.includes(msgFalha)) currentLogs.push(msgFalha);
            }
            next[g] = { ...prev[g], logs: currentLogs };
          }
          return next;
        });
      }
    } catch (encErr: any) {
      console.error(`[ENCOMENDAS-CONFIRMACAO] Erro ao confirmar encomendas: ${encErr.message}`);
    }
  };

  const handleCheckOrderReturn = async () => {
    if (!billingContext) return;
    if (isCheckingReturn) return;
    const { numPedido, itemsFaturados, relatedGroups, baseDistName } = billingContext;

    setIsCheckingReturn(true);
    try {
      const response = await fetch("/api/pedido-retorno", {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
        },
        body: JSON.stringify({
          numPedido,
          token: config.token,
          cnpj: config.cnpj,
          itemsFaturados
        })
      });

      const data = await response.json();
      if (!response.ok) {
        throw new Error(data.error || "Erro ao consultar retorno.");
      }

      // Sucesso: resetar contadores de falha
      consecutiveFailuresRef.current = 0;
      lastWas429Ref.current = false;

      setOrderReturn(data.apiResponse);
      if (data.logs) {
        setReturnCheckLogs(data.logs);
      }

      if (data.logs && data.logs.length > 0) {
           setBilledGroups(prev => {
              const next = { ...prev };
              relatedGroups.forEach(g => {
                 if (!prev[g]) return;
                 const currentLogs = prev[g]?.logs || [];
                 const newLogs = [...currentLogs];
                 data.logs.forEach((l: string) => {
                    if (!newLogs.includes(l)) newLogs.push(l);
                 });
                 next[g] = { ...prev[g], logs: newLogs };
              });
              return next;
           });
        }

        const rawRetorno = data.apiResponse?.Retorno || data.apiResponse?.retorno || data.apiResponse;
        const dists = rawRetorno?.dists || rawRetorno?.Dists || [];
        const itens = rawRetorno?.Itens || rawRetorno?.itens || [];

        if (dists && dists.length > 0) {
          const codDistsNoLote = Array.from(new Set((itemsFaturados || []).map((it: any) => String(it.codDist || it.CodDist || "").trim())));

          // Confirmar encomendas por distribuidora — assim que cada uma finaliza (não espera o lote inteiro)
          confirmarEncomendasAposRetorno(itens, itemsFaturados, relatedGroups, dists);

          let isAllFinalized = false;
          if (codDistsNoLote.length > 0) {
            const distsDoLote = dists.filter((d: any) => codDistsNoLote.includes(String(d.CodDist || d.codDist || "").trim()));
            if (distsDoLote.length > 0) {
              isAllFinalized = distsDoLote.every((d: any) => d.Status === 3);
            } else {
              isAllFinalized = dists.every((d: any) => d.Status === 3);
            }
          } else {
            isAllFinalized = dists.every((d: any) => d.Status === 3);
          }

          if (isAllFinalized) {
            const faltas = itens.filter((it: any) => parseFloat(it.QuantFaturada || it.quantFaturada || "0") === 0);

            setBilledGroups(prev => {
              const next = { ...prev };
              relatedGroups.forEach(g => {
                 const currentLogs = prev[g]?.logs || [];
                 if (!currentLogs.includes("Pedido retornado do distribuidor.")) {
                    currentLogs.push("Pedido retornado do distribuidor.");
                 }
                 next[g] = { status: "retornado", faltas, logs: currentLogs };
              });
              return next;
            });
            setAutoPollReturn(false);
          }
        }
    } catch (err: any) {
      console.error(err);
      consecutiveFailuresRef.current++;
      // Detectar 429 (rate limit) especificamente
      const is429 = err.message?.includes("429") || err.message?.toLowerCase()?.includes("rate limit");
      lastWas429Ref.current = is429;

      // Só mostrar aviso após 5 falhas consecutivas (~35-40s de erro contínuo)
      // pra não inundar o usuário com popups de erro transitório
      if (consecutiveFailuresRef.current >= 5) {
        const msg = is429
          ? `[TENTATIVA ${consecutiveFailuresRef.current}] Rate limit (429) — aguardando 30s antes da próxima tentativa.`
          : `[TENTATIVA ${consecutiveFailuresRef.current}] Erro persistente: ${err.message}`;
        setReturnCheckLogs(prev => [...prev, `⚠️ ${msg}`]);
        setBilledGroups(prev => {
          const next = { ...prev };
          for (const g of (billingContext?.relatedGroups || [])) {
            if (!prev[g]) continue;
            const currentLogs = prev[g]?.logs || [];
            if (!currentLogs.includes(msg)) next[g] = { ...prev[g], logs: [...currentLogs, msg] };
          }
          return next;
        });
        // Só usar alert() pra falhas MUITO persistentes (10+ = ~70s+)
        if (consecutiveFailuresRef.current >= 10) {
          alert(`Erro persistente ao consultar retorno (${consecutiveFailuresRef.current} tentativas). Verifique a conexão.`);
          consecutiveFailuresRef.current = 0; // reset pra não spammar
        }
      }
    } finally {
      setIsCheckingReturn(false);
    }
  };

  useEffect(() => {
    // Limpar timer anterior se existir
    if (pollTimerRef.current) {
      clearTimeout(pollTimerRef.current);
      pollTimerRef.current = null;
    }

    if (!autoPollReturn || !isBillingModalOpen || !billingContext?.numPedido) return;

    let running = true;

    const poll = async () => {
      if (!running) return;
      await handleCheckOrderReturn();
      if (!running || !autoPollReturn) return;
      const delay = getPollDelay(consecutiveFailuresRef.current, lastWas429Ref.current);
      pollTimerRef.current = setTimeout(poll, delay);
    };

    // Disparar imediatamente na primeira vez
    poll();

    return () => {
      running = false;
      if (pollTimerRef.current) {
        clearTimeout(pollTimerRef.current);
        pollTimerRef.current = null;
      }
    };
  }, [autoPollReturn, isBillingModalOpen, billingContext?.numPedido]);

  const handleExportShortages = () => {
    if (!orderReturn || !orderReturn.Retorno || !orderReturn.Retorno.Itens) return;

    const items = orderReturn.Retorno.Itens;
    const shortages = items.filter((it: any) => it.QuantFaturada < it.Quant);

    if (shortages.length === 0) {
      alert("Excelente notícia! Nenhum corte ou falta foi detectado neste faturamento.");
      return;
    }

    const headers = ["EAN", "Codigo_Dist", "Condicao", "Qtd_Solicitada", "Qtd_Faturada", "Qtd_Falta", "Preco_Liquido", "Motivo_Corte"];
    const rows = shortages.map((it: any) => {
      const missing = it.Quant - it.QuantFaturada;
      return [
        it.Ean,
        it.CodDist,
        it.Condicao,
        it.Quant,
        it.QuantFaturada,
        missing,
        it.Preco.toFixed(2),
        `"${it.Motivo || 'Corte Comercial'}"`
      ];
    });

    const csvContent = "\ufeff" + [headers.join(";"), ...rows.map((r: any) => r.join(";"))].join("\r\n");
    const blob = new Blob([csvContent], { type: "text/csv;charset=utf-8;" });
    const url = URL.createObjectURL(blob);
    const link = document.createElement("a");
    link.setAttribute("href", url);
    link.setAttribute("download", `relatorio_faltas_pedido_${billingResult?.numPedido || 'smartped'}.csv`);
    document.body.appendChild(link);
    link.click();
    document.body.removeChild(link);
  };

  const handleReRouteShortages = async () => {
    if (!orderReturn || !orderReturn.Retorno || !orderReturn.Retorno.Itens || !result) return;

    const items = orderReturn.Retorno.Itens;
    if (items.length === 0) {
      alert("Nenhum item detectado no retorno.");
      return;
    }

    const distsInReturn = orderReturn.Retorno.Dists || orderReturn.Retorno.dists || [];
    const finalizedCodDists = new Set(
      distsInReturn
        .filter((d: any) => d.Status === 3)
        .map((d: any) => String(d.CodDist || d.codDist || "").trim())
    );

    const newFaturadosGlobais = [...faturadosGlobais];
    const itemsToKeep = [];
    const manualCuts: any[] = [];

    for (const reportItem of result.report) {
        const itemDistCod = String(reportItem.codDist).trim();

        if (!finalizedCodDists.has(itemDistCod)) {
            itemsToKeep.push(reportItem);
            continue;
        }

        const ean = String(reportItem.novoEan || reportItem.originalEan).trim();
        const returnItem = items.find((it) => String(it.Ean).trim() === ean && String(it.CodDist).trim() === itemDistCod);
        const isManualOrEncomenda = reportItem.codInterno.startsWith("MANUAL-") || reportItem.origem === "encomenda";

        if (returnItem) {
            if (returnItem.QuantFaturada > 0) {
                newFaturadosGlobais.push({
                    fornecedor: reportItem.distribuidora,
                    ean: ean,
                    descricao: reportItem.novaDescricao || reportItem.originalDescricao,
                    laboratorio: reportItem.novoLaboratorio || reportItem.originalLaboratorio,
                    valor: reportItem.novoPreco || reportItem.originalPreco,
                    quantidade: returnItem.QuantFaturada
                });
            }

            const missingQty = returnItem.Quant - returnItem.QuantFaturada;
            if (missingQty > 0) {
                itemsToKeep.push({
                    ...reportItem,
                    qtd: missingQty,
                    economiaTotal: (reportItem.economiaUnit || 0) * missingQty,
                    isShortage: true
                });

                if (isManualOrEncomenda) {
                  manualCuts.push({
                    descricao: reportItem.novaDescricao || reportItem.originalDescricao,
                    ean,
                    distribuidora: reportItem.distribuidora,
                    solicitado: reportItem.qtd,
                    faturado: returnItem.QuantFaturada,
                    motivo: returnItem.Motivo || "Cortado / Sem Estoque"
                  });
                }
            }
        } else {
             itemsToKeep.push({
                 ...reportItem,
                 isShortage: true
             });

if (isManualOrEncomenda) {
                manualCuts.push({
                 descricao: reportItem.novaDescricao || reportItem.originalDescricao,
                 ean,
                 distribuidora: reportItem.distribuidora,
                 solicitado: reportItem.qtd,
                 faturado: 0,
                 motivo: "Não retornado no faturamento final do distribuidor"
               });
             }
        }
    }

    if (manualCuts.length > 0) {
      setManualCutsAlert(manualCuts);
    }

    setFaturadosGlobais(newFaturadosGlobais);

    setBilledItemCodes(prev => {
       const next = new Set(prev);
       itemsToKeep.forEach(it => {
           if (it.isShortage) {
               next.delete(it.codInterno);
           }
       });
       return next;
    });

    setResult((prev) => {
      if (!prev) return null;
      const activeSwaps = itemsToKeep.filter((it) => !disregardedCodes.has(it.codInterno));
      const newTotalSavings = activeSwaps.reduce((sum, it) => sum + (it.economiaTotal || 0), 0);
      return {
        ...prev,
        summary: {
          ...prev.summary,
          totalItems: itemsToKeep.length,
          totalSavings: newTotalSavings
        },
        report: itemsToKeep
      };
    });

    setBilledGroups(prev => {
        const next = { ...prev };
        if (billingContext && billingContext.relatedGroups) {
            billingContext.relatedGroups.forEach(g => {
                delete next[g];
            });
        } else {
            for (const key of Object.keys(next)) {
                if (next[key].status === "retornado" || next[key].status === "faturando") {
                    delete next[key];
                }
            }
        }
        return next;
    });

    setBillingResult(null);
    setIsBillingModalOpen(false);
  };

  return {
    isBillingLoading,
    billingResult,
    setBillingResult,
    isBillingModalOpen,
    setIsBillingModalOpen,
    billedGroups,
    setBilledGroups,
    billingContext,
    setBillingContext,
    viewingLogs,
    setViewingLogs,
    billingConfirm,
    setBillingConfirm,
    billingChoice,
    setBillingChoice,
    faturadosGlobais,
    setFaturadosGlobais,
    isFaturadosOpen,
    setIsFaturadosOpen,
    orderReturn,
    setOrderReturn,
    isCheckingReturn,
    returnCheckLogs,
    setReturnCheckLogs,
    manualCutsAlert,
    setManualCutsAlert,
    autoPollReturn,
    setAutoPollReturn,
    suspectItemAlert,
    setSuspectItemAlert,
    handleSendBilling,
    handleCloseAndConsolidateBilling,
    pollOrderReturn,
    handleCheckOrderReturn,
    handleExportShortages,
    handleReRouteShortages,
  };
}
