import React, { useState, useMemo, useEffect } from "react";
import { OptimizationResponse, SwapReportItem, OptimizerConfig, DistributorOption, ExternalSupplier } from "../types";
import { cleanEan } from "../utils";
import { useProfarmaAlertCheck } from "./useProfarmaAlertCheck";

interface UseOptimizationResultParams {
  config: OptimizerConfig;
  setConfig: React.Dispatch<React.SetStateAction<OptimizerConfig>>;
  disabledDistributors: Set<string>;
  externalSuppliers: ExternalSupplier[];
  distributors: DistributorOption[];
  handleCheckDailyOrders: (token: string, cnpj: string) => Promise<void>;
  dailyOrders: any[];
  setDistributorMinimums: React.Dispatch<React.SetStateAction<Record<string, number>>>;
}

export function useOptimizationResult({
  config,
  setConfig,
  disabledDistributors,
  externalSuppliers,
  distributors,
  handleCheckDailyOrders,
  dailyOrders,
  setDistributorMinimums,
}: UseOptimizationResultParams) {
  const [isLoading, setIsLoading] = useState<boolean>(false);
  const [error, setError] = useState<string | null>(null);
  const [result, setResult] = useState<OptimizationResponse | null>(null);
  const [fileContent, setFileContent] = useState<string>("");
  const [fileName, setFileName] = useState<string>("");
  const [showQuantityInterception, setShowQuantityInterception] = useState<boolean>(true);
  const [preDistributedMap, setPreDistributedMap] = useState<Record<string, { codDist: number; condicao: string; prazo: number; codProdutoDist: string; quant: number }> | null>(null);
  const [logs, setLogs] = useState<string[]>([]);
  const [disregardedCodes, setDisregardedCodes] = useState<Set<string>>(new Set());
  const [disabledItemCodes, setDisabledItemCodes] = useState<Set<string>>(new Set());
  const [billedItemCodes, setBilledItemCodes] = useState<Set<string>>(new Set());
  const [overriddenDistributors, setOverriddenDistributors] = useState<Record<string, string>>({});

  const handleFileLoaded = (content: string, name: string) => {
    setFileContent(content);
    setFileName(name);
    setResult(null);
    setError(null);
    setLogs([]);
    setDisregardedCodes(new Set());
    setDisabledItemCodes(new Set());
    setBilledItemCodes(new Set());
    setOverriddenDistributors({});

    let targetCnpj = config.cnpj;
    try {
      let cleanedContent = content || "";
      if (cleanedContent.startsWith("\ufeff")) {
        cleanedContent = cleanedContent.substring(1);
      }
      const lines = cleanedContent.replace(/\r\n/g, "\n").split("\n");
      for (let i = 0; i < lines.length; i++) {
        const line = lines[i].trim();
        if (!line) continue;
        const parts = line.split(";");
        const tipo = parts[0] ? parts[0].trim() : "";
        if (tipo === "1" && parts[1]) {
          const rawCnpj = parts[1].trim().replace(/\D/g, "");
          if (rawCnpj && rawCnpj.length >= 11) {
            targetCnpj = rawCnpj;
            setConfig(prev => ({
              ...prev,
              cnpj: rawCnpj
            }));
            break;
          }
        }
      }
    } catch (e) {
      console.error("Erro ao analisar CNPJ do arquivo:", e);
    }

    handleCheckDailyOrders(config.token, targetCnpj);
  };

  const handleClearFile = () => {
    setFileContent("");
    setFileName("");
    setResult(null);
    setError(null);
    setLogs([]);
    setDisregardedCodes(new Set());
    setDisabledItemCodes(new Set());
    setBilledItemCodes(new Set());
    setOverriddenDistributors({});
  };

  const handleOptimize = async (overrideFileContent?: string, overridePreDistributedMap?: any, overrideSimulationMode?: boolean) => {
    const isOverrideString = typeof overrideFileContent === "string";
    const activeFileContent = isOverrideString ? overrideFileContent : fileContent;
    if (!activeFileContent) return;

    setIsLoading(true);
    setError(null);
    setResult(null);
    setLogs(["[PREPARANDO] Formatando dados para envio e iniciando conexões..."]);
    setDisregardedCodes(new Set());
    setOverriddenDistributors({});

    try {
      setLogs((prev) => [...prev, "[SISTEMA] Sincronizando pedidos recentes da Profarma para checar duplicidades..."]);
      try {
        await handleCheckDailyOrders(config.token, config.cnpj);
      } catch (err: any) {
        console.error("Erro ao sincronizar pedidos recentes automaticamente:", err);
        setLogs((prev) => [...prev, `[SISTEMA ALERTA] Não foi possível atualizar pedidos recentes para duplicidade: ${err.message}`]);
      }

      // Sincronizar itens confirmados (tabela itens_confirmados do Turso) pra checagem Profarma
      try {
        setLogs((prev) => [...prev, "[SISTEMA] Sincronizando itens confirmados para checagem Profarma..."]);
        await fetch("/api/itens-confirmados-do-dia", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ token: config.token, cnpj: config.cnpj, useTestUrl: config.useTestUrl }),
        });
        setLogs((prev) => [...prev, "[SISTEMA] Itens confirmados sincronizados com sucesso."]);
      } catch (err: any) {
        setLogs((prev) => [...prev, `[SISTEMA ALERTA] Não foi possível sincronizar itens confirmados: ${err.message}`]);
      }

      const storedCutsStr = localStorage.getItem("cortes_recentes");
      const cortesRecentes = storedCutsStr ? JSON.parse(storedCutsStr) : {};

      const response = await fetch("/api/optimize", {
        method: "POST",
        headers: {
          "Content-Type": "application/json"
        },
        body: JSON.stringify({
          fileContent: activeFileContent,
          token: config.token,
          cnpj: config.cnpj,
          margemMinima: config.margemMinima,
          tipos: config.tipos,
          permitirSemEstoque: config.permitirSemEstoque,
          useTestUrl: config.useTestUrl,
          simulationMode: overrideSimulationMode !== undefined ? overrideSimulationMode : config.simulationMode,
          customProductionUrl: config.customProductionUrl,
          customTestUrl: config.customTestUrl,
          customEndpoint: config.customEndpoint,
          disabledDistributors: Array.from(disabledDistributors),
          externalSuppliers,
          cortesRecentes,
          alertaProfarma48h: config.alertaProfarma48h !== false,
          alertaConfirmarQtdCaixaMaster: config.alertaConfirmarQtdCaixaMaster !== false,
          bypassMargemRuptura: config.bypassMargemRuptura !== false,
        })
      });

      let data: any = {};
      const contentType = response.headers.get("content-type");
      if (contentType && contentType.includes("application/json")) {
        data = await response.json();
      } else {
        const text = await response.text();
        const shortText = text.length > 120 ? text.substring(0, 120) + "..." : text;
        throw new Error(`Erro de resposta do servidor (Status ${response.status}): ${shortText || "Resposta vazia"}`);
      }

      if (data.logs) {
        setLogs(data.logs);
      }

      if (!response.ok) {
        throw new Error(data.error || `Erro do servidor (Status ${response.status})`);
      }

      if (data.minimos && Array.isArray(data.minimos)) {
        const newMinimums: Record<string, number> = {};
        data.minimos.forEach((m: any) => {
          const distName = m.NomeDist;
          if (distName) {
            const cond = m.Condicao || m.condicao || m.NomeCondicao || "FIXA";
            const prz = m.Prazo !== undefined ? m.Prazo : (m.prazo !== undefined ? m.prazo : 0);
            const compoundKey = `${distName} [${cond} | ${prz}d]`;
            const vlrMin = m.VlrMinimo !== undefined ? m.VlrMinimo : (m.vlrMinimo !== undefined ? m.vlrMinimo : 0);
            newMinimums[compoundKey] = vlrMin;
          }
        });
        setDistributorMinimums(newMinimums);
      } else if (data.report && data.report.length > 0) {
        const newMinimums: Record<string, number> = {};
        for (const item of data.report) {
          if (item.distribuidora && item.distribuidora !== "Não Encontrados" && item.distribuidora !== "Sem Estoque") {
            const cond = item.condicao || "FIXA";
            const prz = item.prazo !== undefined ? item.prazo : 0;
            const compoundKey = `${item.distribuidora} [${cond} | ${prz}d]`;
            const itemMin = item.pedidoMinimo || 0;
            newMinimums[compoundKey] = itemMin;
          }
        }
        setDistributorMinimums(newMinimums);
      }

      let finalData = data;
      const mapToUse = isOverrideString ? overridePreDistributedMap : preDistributedMap;

      if (mapToUse && finalData.report && Array.isArray(finalData.report)) {
        const fallbackDists: Record<number, string> = {
          4: "Profarma",
          53: "ANB",
          59: "SMARTDISTRIBUIDORA",
          60: "CervoSul",
          81: "GAM",
          624: "Gauchofarma",
          2: "Pan/Santa",
          68: "Dp4",
          79: "NeoSul"
        };

        const updatedReport = finalData.report.map((item: any) => {
          const ean = item.originalEan;
          const mapped = mapToUse[ean];
          if (mapped) {
            const distObj = distributors.find((d: any) => d.Codigo === mapped.codDist);
            const distName = distObj ? distObj.Nome : (fallbackDists[mapped.codDist] || `Fornecedor ${mapped.codDist}`);

            let matchedAlternative = item.alternatives?.find((alt: any) =>
              alt.codDist === mapped.codDist &&
              String(alt.condicao).toUpperCase() === String(mapped.condicao).toUpperCase()
            );

            if (!matchedAlternative) {
              matchedAlternative = item.alternatives?.find((alt: any) => alt.codDist === mapped.codDist);
            }

            if (matchedAlternative) {
              const ecoUnit = Math.max(0, item.originalPreco - matchedAlternative.preco);
              return {
                ...item,
                novoEan: matchedAlternative.ean,
                novaDescricao: matchedAlternative.descricao || item.novaDescricao || item.originalDescricao,
                novoLaboratorio: matchedAlternative.laboratorio || item.novoLaboratorio || item.originalLaboratorio,
                novoPreco: matchedAlternative.preco,
                qtd: mapped.quant,
                economiaUnit: ecoUnit,
                economiaTotal: ecoUnit * mapped.quant,
                distribuidora: matchedAlternative.distribuidora,
                codDist: matchedAlternative.codDist,
                condicao: matchedAlternative.condicao,
                prazo: matchedAlternative.prazo,
                codProdutoDist: mapped.codProdutoDist || matchedAlternative.codProdutoDist || "",
                estoque: matchedAlternative.estoque || 9999,
                isShortage: false
              };
            } else {
              const mockPrice = item.originalPreco || 0;
              return {
                ...item,
                novoEan: item.originalEan,
                novaDescricao: item.originalDescricao,
                novoLaboratorio: item.originalLaboratorio,
                novoPreco: mockPrice,
                qtd: mapped.quant,
                economiaUnit: 0,
                economiaTotal: 0,
                distribuidora: distName,
                codDist: mapped.codDist,
                condicao: mapped.condicao,
                prazo: mapped.prazo,
                codProdutoDist: mapped.codProdutoDist || "",
                estoque: 9999,
                isShortage: false
              };
            }
          }
          return item;
        });

        finalData = {
          ...finalData,
          report: updatedReport,
          summary: {
            totalItems: updatedReport.length,
            itemsTreated: updatedReport.length,
            itemsSwapped: updatedReport.filter((it: any) => it.originalEan !== it.novoEan).length,
            totalSavings: updatedReport.reduce((sum: number, it: any) => sum + (it.economiaTotal || 0), 0)
          }
        };

        setLogs(prev => [
          ...prev,
          `[SUCESSO] Distribuição e faturamento restaurados com sucesso para ${updatedReport.filter((it: any) => !it.isShortage).length} itens com base no log!`
        ]);
      }

      setResult(finalData);
      setShowQuantityInterception(finalData.report?.some((it: any) => it.alertaConfirmarQtd) || false);
      setPreDistributedMap(null);
    } catch (err: any) {
      console.error(err);
      setError(err.message || "Ocorreu um erro inesperado durante a otimização.");
    } finally {
      setIsLoading(false);
    }
  };

  const handleToggleDisregard = (codInterno: string) => {
    setDisregardedCodes((prev) => {
      const next = new Set(prev);
      if (next.has(codInterno)) {
        next.delete(codInterno);
      } else {
        next.add(codInterno);
      }
      return next;
    });
  };

  const handleToggleDisabled = (codInterno: string) => {
    setDisabledItemCodes((prev) => {
      const next = new Set(prev);
      if (next.has(codInterno)) {
        next.delete(codInterno);
      } else {
        next.add(codInterno);
        // Remover item do localStorage itens_manuais_adicionados se for manual
        if (codInterno.startsWith("MANUAL-")) {
          try {
            const stored = localStorage.getItem("itens_manuais_adicionados");
            if (stored) {
              const list = JSON.parse(stored);
              const updated = list.filter((it: any) => it.codInterno !== codInterno);
              localStorage.setItem("itens_manuais_adicionados", JSON.stringify(updated));
            }
          } catch {}
        }
      }
      return next;
    });
  };

  const handleUpdateQty = (codInterno: string, newQty: number) => {
    setResult((prev: any) => {
      if (!prev) return null;
      if (newQty === 0) {
        return {
          ...prev,
          report: prev.report.filter((item: any) => item.codInterno !== codInterno)
        };
      }
      return {
        ...prev,
        report: prev.report.map((item: any) => {
          if (item.codInterno === codInterno) {
            const qty = Math.max(1, newQty);
            let novoPreco = item.novoPreco;
            let economiaUnit = item.economiaUnit;

            // Tier-aware pricing: recalcular preco se item tem tiers
            if (item.tiers && item.tiers.length > 0) {
              // Encontrar o maior tier onde qty >= minQty
              const applicableTier = item.tiers
                .filter((t: any) => qty >= t.minQty)
                .sort((a: any, b: any) => b.minQty - a.minQty)[0];
              if (applicableTier && applicableTier.price > 0) {
                novoPreco = applicableTier.price;
                economiaUnit = (item.originalPreco || 0) - novoPreco;
              }
            }

            return {
              ...item,
              qtd: qty,
              novoPreco,
              economiaUnit,
              economiaTotal: economiaUnit * qty
            };
          }
          return item;
        })
      };
    });
  };

  const handleSelectCondition = (codInterno: string, selectedAlt: any) => {
    console.log(`[HANDLE-SELECT] codInterno=${codInterno} | EAN=${selectedAlt.ean} | dist=${selectedAlt.distribuidora} | codDist=${selectedAlt.codDist} | codProdutoDist="${selectedAlt.codProdutoDist}" | codProduto="${selectedAlt.codProduto}" | preco=${selectedAlt.preco}`);
    // Grava em arquivo para diagnóstico (eu leio via Read)
    fetch("/api/debug-selection", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ codInterno, ean: selectedAlt.ean, dist: selectedAlt.distribuidora, codDist: selectedAlt.codDist, codProdutoDist: selectedAlt.codProdutoDist, codProduto: selectedAlt.codProduto, preco: selectedAlt.preco })
    }).catch(() => {});
    setResult((prev: any) => {
      if (!prev) return null;
      return {
        ...prev,
        report: prev.report.map((item: any) => {
          if (item.codInterno === codInterno) {
            const qty = item.qtd;
            const priceDiff = item.originalPreco - selectedAlt.preco;
            const ecoUnit = priceDiff > 0 ? priceDiff : 0;
            return {
              ...item,
              novoEan: selectedAlt.ean || item.originalEan,
              novaDescricao: selectedAlt.descricao || item.originalDescricao,
              novoLaboratorio: selectedAlt.laboratorio || item.originalLaboratorio || "GENÉRICO",
              novoPreco: selectedAlt.preco,
              economiaUnit: ecoUnit,
              economiaTotal: ecoUnit * qty,
              distribuidora: selectedAlt.distribuidora,
              codDist: selectedAlt.codDist,
              condicao: selectedAlt.condicao,
              prazo: selectedAlt.prazo,
              qtdMin: selectedAlt.qtdMin,
              qtdMax: selectedAlt.qtdMax,
              cx: selectedAlt.cx,
              estoque: selectedAlt.estoque,
              codProdutoDist: selectedAlt.codProdutoDist !== undefined ? selectedAlt.codProdutoDist : (item.codProdutoDist || ""),
              codProduto: (() => {
                const finalCodProdutoDist = selectedAlt.codProdutoDist !== undefined ? selectedAlt.codProdutoDist : (item.codProdutoDist || "");
                const rawCodProduto = selectedAlt.codProduto !== undefined ? selectedAlt.codProduto : (item.codProduto || "");
                const resolved = (rawCodProduto === "0" || !rawCodProduto) ? finalCodProdutoDist : rawCodProduto;
                return resolved || finalCodProdutoDist || "";
              })()
            };
          }
          return item;
        })
      };
    });
  };

  const handleDeleteDistributor = (distName: string) => {
    if (!result) return;
    setResult((prev: any) => {
      if (!prev) return null;
      const updatedReport = prev.report.filter((item: any) => {
        const dist = item.distribuidora || "Não Encontrados";
        const isVirtual = dist === "Não Encontrados" || dist === "Sem Estoque";
        const itemGroupKey = isVirtual
          ? dist
          : `${dist} [${item.condicao || "FIXA"} | ${item.prazo !== undefined ? item.prazo : 0}d]`;
        return itemGroupKey !== distName;
      });

      const activeSwaps = updatedReport.filter((item: any) => !disregardedCodes.has(item.codInterno));
      const newTotalSavings = activeSwaps.reduce((acc: number, it: any) => acc + (it.economiaTotal || 0), 0);

      return {
        ...prev,
        summary: {
          ...prev.summary,
          totalItems: updatedReport.length,
          itemsTreated: updatedReport.length,
          totalSavings: newTotalSavings
        },
        report: updatedReport
      };
    });
  };

  const activeReport = useMemo(() => {
    if (!result) return [];
    return result.report
      .filter((item) => !billedItemCodes.has(item.codInterno))
      .map((item) => {
        const isDisregarded = disregardedCodes.has(item.codInterno);
        const isDisabled = disabledItemCodes.has(item.codInterno);
        const overDist = overriddenDistributors[item.codInterno];

        const baseItem = {
          ...item,
          distribuidora: overDist || item.distribuidora || "Não Encontrados",
          disabled: isDisabled
        };

        if (isDisregarded) {
          let resolvedDist = item.originalDist;
          let resolvedCodDist = item.originalCodDist;
          let resolvedEstoque = item.originalEstoque;
          let resolvedPreco = item.originalPrecoCotado !== undefined ? item.originalPrecoCotado : item.originalPreco;
          let resolvedCondicao = item.originalCondicao;
          let resolvedCodProdutoDist = item.originalCodProdutoDist;
          let resolvedPrazo = item.originalPrazo;
          let resolvedCodProduto = item.originalCodProduto;

          const origEanClean = cleanEan(item.originalEan);
          const origEstNum = item.originalEstoque !== undefined ? Number(item.originalEstoque) : 0;

          if (origEstNum <= 0 && item.alternatives && item.alternatives.length > 0) {
            const origAltsWithStock = item.alternatives.filter((alt: any) => {
              const altEanClean = cleanEan(alt.ean || alt.Ean || "");
              const altEstNum = alt.estoque !== undefined ? Number(alt.estoque) : 0;
              return altEanClean === origEanClean && altEstNum > 0;
            });

            if (origAltsWithStock.length > 0) {
              origAltsWithStock.sort((a: any, b: any) => {
                const priceA = a.preco !== undefined ? Number(a.preco) : 999999;
                const priceB = b.preco !== undefined ? Number(b.preco) : 999999;
                return priceA - priceB;
              });

              const bestAlt = origAltsWithStock[0];
              resolvedDist = bestAlt.distribuidora;
              resolvedCodDist = bestAlt.codDist;
              resolvedEstoque = bestAlt.estoque;
              resolvedPreco = bestAlt.preco;
              resolvedCondicao = bestAlt.condicao;
              resolvedCodProdutoDist = bestAlt.codProdutoDist;
              resolvedPrazo = bestAlt.prazo;
              resolvedCodProduto = bestAlt.codProduto;
            }
          }

          return {
            ...baseItem,
            novoEan: item.originalEan,
            novaDescricao: item.originalDescricao,
            novoLaboratorio: item.originalLaboratorio,
            novoPreco: resolvedPreco,
            economiaUnit: 0,
            economiaTotal: 0,
            distribuidora: overDist || resolvedDist || "Não Encontrados",
            codDist: resolvedCodDist !== undefined ? resolvedCodDist : baseItem.codDist,
            estoque: resolvedEstoque !== undefined ? resolvedEstoque : baseItem.estoque,
            condicao: resolvedCondicao !== undefined ? resolvedCondicao : baseItem.condicao,
            codProdutoDist: resolvedCodProdutoDist !== undefined ? resolvedCodProdutoDist : baseItem.codProdutoDist,
            prazo: resolvedPrazo !== undefined ? resolvedPrazo : baseItem.prazo,
            codProduto: resolvedCodProduto !== undefined ? resolvedCodProduto : baseItem.codProduto,
          };
        }
        return baseItem;
      });
  }, [result, disregardedCodes, disabledItemCodes, overriddenDistributors, billedItemCodes]);

  // Log diagnóstico: verificar se alternatives sobrevive ao activeReport
  useMemo(() => {
    if (!activeReport || activeReport.length === 0) return;
    activeReport.forEach((item: any) => {
      const altsCount = item.alternatives?.length ?? 0;
      console.log(`[ACTIVE-REPORT] EAN=${item.originalEan || item.novoEan} codInterno=${item.codInterno} | alternatives=${altsCount} | dist=${item.distribuidora}`);
      // Log cirúrgico: detalhar cada alternativa para rastrear estoque fictício
      if (altsCount > 0) {
        console.log(`[ALT-DETAILS] EAN=${item.originalEan || item.novoEan} — ${altsCount} alternativas:`);
        item.alternatives.forEach((a: any, i: number) => {
          console.log(`[ALT-DETAILS]   ${i+1}. ${a.distribuidora} | EAN:${a.ean} | estoque:${a.estoque} | preco:${a.preco} | condicao:${a.condicao} | prazo:${a.prazo}`);
        });
      }
    });
  }, [activeReport]);

  const reportEans = useMemo(
    () => Array.from(new Set((result?.report || []).flatMap((item: any) => [item.originalEan, item.novoEan]).filter(Boolean))),
    [result]
  );
  const { isEanProfarmaAlerted, getProfarmaOrderDate } = useProfarmaAlertCheck(config.cnpj, config.alertaProfarma48h !== false, reportEans);

  const pendingAlertItems = useMemo(() => {
    if (!result || !result.report) return [];
    return activeReport.filter((item) => {
      if (item.disabled) return false;

      const isProfarmaAlert = (item.distribuidora && String(item.distribuidora).toUpperCase().includes("PROFARMA")) && (isEanProfarmaAlerted(item.novoEan) || isEanProfarmaAlerted(item.originalEan));

      if (isProfarmaAlert && !item.isProfarmaAlertAck) {
        return true;
      }

      return item.alertaConfirmarQtd;
    }).map((item) => {
      const isProfarmaAlert = (item.distribuidora && String(item.distribuidora).toUpperCase().includes("PROFARMA")) && (isEanProfarmaAlerted(item.novoEan) || isEanProfarmaAlerted(item.originalEan));

      if (isProfarmaAlert) {
        const orderDateRaw = getProfarmaOrderDate(item.novoEan) || getProfarmaOrderDate(item.originalEan) || "";
        const orderDate = orderDateRaw
          ? new Date(orderDateRaw.replace(' ', 'T') + 'Z').toLocaleString('pt-BR', {
              timeZone: 'America/Sao_Paulo', dateStyle: 'short', timeStyle: 'short'
            })
          : "";
        return {
          ...item,
          isProfarmaAlert: true,
          motivoAlertaProfarma: orderDate
            ? `Este item foi enviado para a Profarma em ${orderDate} (dentro das últimas 48h). Verifique a quantidade desejada ou digite 0 para remover do lote.`
            : `Este item foi enviado para a Profarma nas últimas 48h. Verifique a quantidade desejada ou digite 0 para remover do lote.`
        };
      }
      return item;
    });
  }, [result, activeReport, isEanProfarmaAlerted, getProfarmaOrderDate]);

  useEffect(() => {
    if (pendingAlertItems.length > 0) {
      setShowQuantityInterception(true);
    }
  }, [pendingAlertItems]);

  const handleConfirmQtyInInterception = (codInterno: string, newQty: number) => {
    if (newQty === 0) {
      setResult((prev: any) => {
        if (!prev) return null;
        return {
          ...prev,
          report: prev.report.filter((item: any) => item.codInterno !== codInterno)
        };
      });
    } else {
      setResult((prev: any) => {
        if (!prev) return null;
        return {
          ...prev,
          report: prev.report.map((item: any) => {
            if (item.codInterno === codInterno) {
              const qty = Math.max(1, newQty);
              return {
                ...item,
                qtd: qty,
                economiaTotal: (item.economiaUnit || 0) * qty,
                alertaConfirmarQtd: false,
                isProfarmaAlertAck: true
              };
            }
            return item;
          })
        };
      });
    }
  };

  const activeSummary = useMemo(() => {
    if (!result) return null;
    const activeItems = result.report.filter(item => !billedItemCodes.has(item.codInterno));
    const totalItems = activeItems.filter(item => !disabledItemCodes.has(item.codInterno)).length;
    const itemsTreated = activeItems.filter(item => !disabledItemCodes.has(item.codInterno)).length;
    const itemsSwapped = activeItems.filter(item => !disregardedCodes.has(item.codInterno) && item.originalEan !== item.novoEan && !disabledItemCodes.has(item.codInterno)).length;
    const totalSavings = activeItems
      .filter(item => !disregardedCodes.has(item.codInterno) && !disabledItemCodes.has(item.codInterno))
      .reduce((sum, item) => sum + item.economiaTotal, 0);

    return {
      totalItems,
      itemsTreated,
      itemsSwapped,
      totalSavings
    };
  }, [result, disregardedCodes, disabledItemCodes, billedItemCodes]);

  const getOptimizedFileContent = () => {
    if (!result || !fileContent) return "";

    const lines = fileContent.replace(/\r\n/g, "\n").split("\n");
    const finalLines: string[] = [];

    const reportMap = new Map<string, SwapReportItem>(result.report.map(r => [r.codInterno, r]));
    const activeReportMap = new Map<string, SwapReportItem>(activeReport.map(r => [r.codInterno, r]));

    const originalCodInternos = new Set<string>();
    for (const line of lines) {
      const parts = line.split(";");
      if (parts[0] === "2" && parts.length >= 4) {
        originalCodInternos.add(parts[3].trim());
      }
    }

    const manualItemsToAppend = result.report.filter(r => !originalCodInternos.has(r.codInterno) && !disregardedCodes.has(r.codInterno) && !disabledItemCodes.has(r.codInterno));
    let manualItemsAppended = false;

    const appendManualLines = () => {
      if (manualItemsAppended) return;
      for (const item of manualItemsToAppend) {
        const newLine = [
          "2",
          item.novoEan,
          String(item.qtd),
          item.codInterno,
          item.novaDescricao,
          item.novoLaboratorio,
          item.novoPreco.toFixed(2)
        ].join(";");
        finalLines.push(newLine);
      }
      manualItemsAppended = true;
    };

    for (const line of lines) {
      const trimmed = line.trim();
      if (!trimmed) continue;

      const parts = trimmed.split(";");
      const tipo = parts[0];

      if (tipo === "2" && parts.length >= 7) {
        const codInterno = parts[3].trim();
        const reportItem = reportMap.get(codInterno);

        if (disabledItemCodes.has(codInterno)) {
          continue;
        }

        if (reportItem && !disregardedCodes.has(codInterno)) {
          const newLine = [
            "2",
            reportItem.novoEan,
            parts[2],
            reportItem.codInterno,
            reportItem.novaDescricao,
            reportItem.novoLaboratorio,
            reportItem.novoPreco.toFixed(2)
          ].join(";");
          finalLines.push(newLine);
        } else {
          const activeItem = activeReportMap.get(codInterno);
          if (activeItem) {
            const newLine = [
              "2",
              activeItem.novoEan || parts[1],
              String(activeItem.qtd || parts[2]),
              activeItem.codInterno,
              activeItem.novaDescricao || parts[4],
              activeItem.novoLaboratorio || parts[5],
              (activeItem.novoPreco || Number(parts[6]) || 0).toFixed(2)
            ].join(";");
            finalLines.push(newLine);
          } else {
            finalLines.push(line);
          }
        }
      } else if (tipo === "9") {
        appendManualLines();
        finalLines.push(line);
      } else {
        finalLines.push(line);
      }
    }

    appendManualLines();

    return finalLines.join("\r\n");
  };

  const downloadSICF = () => {
    if (!result) return;
    const content = getOptimizedFileContent();
    const blob = new Blob([content], { type: "text/plain;charset=latin1;" });
    const url = URL.createObjectURL(blob);
    const link = document.createElement("a");
    const baseName = fileName.replace(/\.[^/.]+$/, "");
    link.setAttribute("href", url);
    link.setAttribute("download", `${baseName}_otimizado.txt`);
    document.body.appendChild(link);
    link.click();
    document.body.removeChild(link);
  };

  const downloadCSV = () => {
    if (!result) return;
    const headers = [
      "CodInterno",
      "EanOriginal",
      "DescricaoOriginal",
      "LaboratorioOriginal",
      "PrecoOriginal",
      "EanNovo",
      "DescricaoNova",
      "LaboratorioNovo",
      "PrecoNovo",
      "Qtd",
      "EconomiaUnit",
      "EconomiaTotal",
      "Distribuidora",
      "Estoque",
      "Status"
    ];

    const rows = result.report.map((item) => {
      const isDisregarded = disregardedCodes.has(item.codInterno);
      return [
        item.codInterno,
        item.originalEan,
        item.originalDescricao,
        item.originalLaboratorio,
        item.originalPreco.toFixed(2).replace(".", ","),
        isDisregarded ? item.originalEan : item.novoEan,
        isDisregarded ? item.originalDescricao : item.novaDescricao,
        isDisregarded ? item.originalLaboratorio : item.novoLaboratorio,
        isDisregarded ? item.originalPreco.toFixed(2).replace(".", ",") : item.novoPreco.toFixed(2).replace(".", ","),
        item.qtd,
        isDisregarded ? "0,00" : item.economiaUnit.toFixed(2).replace(".", ","),
        isDisregarded ? "0,00" : item.economiaTotal.toFixed(2).replace(".", ","),
        isDisregarded ? (item.originalDist !== undefined ? item.originalDist : item.distribuidora) : item.distribuidora,
        isDisregarded ? (item.originalEstoque !== undefined ? item.originalEstoque : item.estoque) : item.estoque,
        isDisregarded ? "Desconsiderado" : "Otimizado"
      ];
    });

    const csvContent = [headers.join(";"), ...rows.map((r) => r.join(";"))].join("\r\n");
    const blob = new Blob([csvContent], { type: "text/csv;charset=utf-8;" });
    const url = URL.createObjectURL(blob);
    const link = document.createElement("a");
    const baseName = fileName.replace(/\.[^/.]+$/, "");
    link.setAttribute("href", url);
    link.setAttribute("download", `${baseName}_relatorio.csv`);
    document.body.appendChild(link);
    link.click();
    document.body.removeChild(link);
  };

  return {
    isLoading,
    setIsLoading,
    error,
    setError,
    result,
    setResult,
    fileContent,
    setFileContent,
    fileName,
    setFileName,
    showQuantityInterception,
    setShowQuantityInterception,
    preDistributedMap,
    setPreDistributedMap,
    logs,
    setLogs,
    disregardedCodes,
    setDisregardedCodes,
    disabledItemCodes,
    setDisabledItemCodes,
    billedItemCodes,
    setBilledItemCodes,
    overriddenDistributors,
    setOverriddenDistributors,
    handleFileLoaded,
    handleClearFile,
    handleOptimize,
    handleToggleDisregard,
    handleToggleDisabled,
    handleUpdateQty,
    handleSelectCondition,
    handleDeleteDistributor,
    handleConfirmQtyInInterception,
    downloadSICF,
    downloadCSV,
    activeReport,
    activeSummary,
    pendingAlertItems,
  };
}
