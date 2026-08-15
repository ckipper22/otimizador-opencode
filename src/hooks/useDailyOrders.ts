import { useState, useEffect } from "react";
import { OptimizerConfig } from "../types";

const normalizeDistName = (name: string) => 
  (name || "")
    .split('[')[0]
    .trim()
    .normalize("NFD")
    .replace(/[\u0300-\u036f]/g, "")
    .toUpperCase();

const cleanEan = (ean: string | number | undefined | null): string => {
  if (ean === undefined || ean === null) return "";
  const cleaned = String(ean).trim().replace(/\D/g, "");
  if (!cleaned) return "";
  if (cleaned.length <= 13) {
    return cleaned.padStart(13, "0");
  }
  return cleaned;
};

const getRecentCutsMap = (orders: any[]) => {
  const cutsMap: Record<string, string[]> = {};
  if (!orders || !Array.isArray(orders)) return cutsMap;

  const getRecentBusinessDays = (count: number) => {
    const dates = new Set<string>();
    const d = new Date();
    
    const formatDateStr = (date: Date) => {
      const dd = String(date.getDate()).padStart(2, '0');
      const mm = String(date.getMonth() + 1).padStart(2, '0');
      const yyyy = date.getFullYear();
      return `${dd}/${mm}/${yyyy}`;
    };

    dates.add(formatDateStr(d));

    let businessDaysFound = (d.getDay() === 0 || d.getDay() === 6) ? 0 : 1;
    const tempDate = new Date(d.getTime());
    
    for (let i = 1; i <= 10; i++) {
      tempDate.setDate(tempDate.getDate() - 1);
      const dayOfWeek = tempDate.getDay();
      const isWeekend = dayOfWeek === 0 || dayOfWeek === 6;
      dates.add(formatDateStr(tempDate));
      if (!isWeekend) {
        businessDaysFound++;
        if (businessDaysFound >= count) {
          break;
        }
      }
    }
    return dates;
  };

  const allowedDates = getRecentBusinessDays(2);

  orders.forEach(order => {
    const orderDate = String(order.dataPedido || order.DataPedido || "").trim();
    if (allowedDates.has(orderDate) && order.detalhes?.Itens) {
      order.detalhes.Itens.forEach((item: any) => {
        const ean = cleanEan(item.Ean || item.ean || "");
        if (!ean) return;

        const q = Number(item.Quant || 0);
        const qF = Number(item.QuantFaturada !== undefined ? item.QuantFaturada : q);
        
        const isCut = q > 0 && (
          qF < q || 
          String(item.Motivo || "").toLowerCase().includes("estoque") || 
          String(item.Motivo || "").toLowerCase().includes("falta") || 
          String(item.Motivo || "").toLowerCase().includes("corte")
        );
        
        if (isCut) {
          const distNameClean = normalizeDistName(item.NomeDist || item.Nome || item.distribuidora || "");
          if (distNameClean) {
            if (!cutsMap[ean]) {
              cutsMap[ean] = [];
            }
            if (!cutsMap[ean].includes(distNameClean)) {
              cutsMap[ean].push(distNameClean);
            }
          }
        }
      });
    }
  });

  return cutsMap;
};

export function useDailyOrders(config: OptimizerConfig, mainView: "optimize" | "returns" | "daily_items") {
  const [dailyOrders, setDailyOrders] = useState<any[]>([]);
  const [isCheckingDaily, setIsCheckingDaily] = useState<boolean>(false);
  const [dailyOrderLogs, setDailyOrderLogs] = useState<string[]>([]);
  const [selectedDailyOrder, setSelectedDailyOrder] = useState<any | null>(null);
  const [highlightedOrder, setHighlightedOrder] = useState<any | null>(null);

  const [directNumPedido, setDirectNumPedido] = useState<string>("");
  const [directOrderReturn, setDirectOrderReturn] = useState<any | null>(null);
  const [isCheckingDirectReturn, setIsCheckingDirectReturn] = useState<boolean>(false);
  const [directReturnCheckLogs, setDirectReturnCheckLogs] = useState<string[]>([]);
  const [directAutoPollReturn, setDirectAutoPollReturn] = useState<boolean>(false);

  const handleCheckDailyOrders = async (customToken?: string, customCnpj?: string) => {
    setIsCheckingDaily(true);
    const activeToken = customToken || config.token;
    const activeCnpj = customCnpj || config.cnpj;
    setDailyOrderLogs([`[SISTEMA] Iniciando busca de pedidos dos últimos dias úteis...`]);
    try {
      const response = await fetch("/api/pedidos-do-dia", {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
        },
        body: JSON.stringify({
          token: activeToken,
          cnpj: activeCnpj,
          useTestUrl: config.useTestUrl,
          simulationMode: config.simulationMode
        })
      });
      const data = await response.json();
      if (data.logs) setDailyOrderLogs((prev) => [...prev, ...data.logs]);
      if (!response.ok) throw new Error(data.error || "Erro ao consultar pedidos do dia.");
      const rawOrders = data.pedidos || [];
      const seen = new Set<string>();
      const uniqueOrders: any[] = [];
      for (const order of rawOrders) {
        const num = String(order.numPedido || "").trim();
        if (num && !seen.has(num)) {
          seen.add(num);
          uniqueOrders.push(order);
        }
      }
      uniqueOrders.sort((a, b) => {
        const numA = Number(a.numPedido || 0);
        const numB = Number(b.numPedido || 0);
        return numB - numA;
      });
      setDailyOrders(uniqueOrders);
      try {
        const cutsMap = getRecentCutsMap(uniqueOrders);
        localStorage.setItem("cortes_recentes", JSON.stringify(cutsMap));
        const numCortes = Object.values(cutsMap).reduce((acc, curr) => acc + curr.length, 0);
        setDailyOrderLogs((prev) => [...prev, `[SISTEMA] Identificados ${numCortes} registros de cortes recentes nas distribuidoras para proteção contra furos.`]);
      } catch (e: any) {
        console.error("Erro ao computar cortes de estoque recentes:", e);
      }
    } catch (err: any) {
      setDailyOrderLogs((prev) => [...prev, `[ERRO] ${err.message}`]);
    } finally {
      setIsCheckingDaily(false);
    }
  };

  const handleCheckDirectOrderReturn = async () => {
    if (!directNumPedido.trim()) {
      alert("Por favor, informe o número do pedido.");
      return;
    }
    setIsCheckingDirectReturn(true);
    setDirectReturnCheckLogs([`[SISTEMA] Iniciando consulta em tempo real para o pedido #${directNumPedido.trim()}...`]);
    try {
      const response = await fetch("/api/pedido-retorno", {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
        },
        body: JSON.stringify({
          numPedido: directNumPedido.trim(),
          token: config.token,
          cnpj: config.cnpj,
          useTestUrl: config.useTestUrl,
          itemsFaturados: [],
          simulationMode: config.simulationMode
        })
      });

      const data = await response.json();
      if (!response.ok) {
        throw new Error(data.error || "Erro ao consultar retorno do pedido.");
      }

      setDirectOrderReturn(data.apiResponse);
      if (data.apiResponse) {
        setSelectedDailyOrder({
          numPedido: directNumPedido.trim(),
          dataPedido: new Date().toLocaleDateString("pt-BR"),
          detalhes: data.apiResponse
        });
      }
      if (data.logs) {
        setDirectReturnCheckLogs(data.logs);
      }
    } catch (err: any) {
      console.error(err);
      alert(err.message || "Erro ao consultar retorno.");
    } finally {
      setIsCheckingDirectReturn(false);
    }
  };

  useEffect(() => {
    if (mainView === "returns" && dailyOrders.length === 0 && !isCheckingDaily) {
      handleCheckDailyOrders();
    }
  }, [mainView, dailyOrders.length]);

  useEffect(() => {
    let interval: any;
    if (directAutoPollReturn && mainView === "returns" && directNumPedido.trim()) {
      handleCheckDirectOrderReturn();
      interval = setInterval(() => {
        handleCheckDirectOrderReturn();
      }, 10000);
    }
    return () => clearInterval(interval);
  }, [directAutoPollReturn, mainView, directNumPedido]);

  return {
    dailyOrders,
    isCheckingDaily,
    dailyOrderLogs,
    setDailyOrderLogs,
    selectedDailyOrder,
    setSelectedDailyOrder,
    highlightedOrder,
    setHighlightedOrder,
    directNumPedido,
    setDirectNumPedido,
    directOrderReturn,
    isCheckingDirectReturn,
    directReturnCheckLogs,
    directAutoPollReturn,
    setDirectAutoPollReturn,
    handleCheckDailyOrders,
    handleCheckDirectOrderReturn,
  };
}
