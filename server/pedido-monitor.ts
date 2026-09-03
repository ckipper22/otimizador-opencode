// Monitoramento server-side de retorno de pedido.
// Porta a lógica de checkReturn / confirmarEncomendasAposRetorno do useBilling.ts
// pra rodar como job em background, sobrevivendo ao fechamento da modal.

import { CONFIG } from "./config";
import {
  getPedidosMonitorando,
  updatePedidoMonitoradoLastChecked,
  updatePedidoMonitoradoStatus,
  updatePedidoMonitoradoPendingDists,
  updatePedidoMonitoradoEncomendasPendentes,
  saveItensConfirmadosBatch,
} from "./database";

// Reutilizar fetch global (Node 18+)
const fetchGlobal = globalThis.fetch;

// Encomendas — URL e chave do sistema externo (mesmas vars de server.ts)
const ENCOMENDAS_API_URL = process.env.ENCOMENDAS_API_URL || "https://encomenda-com-smartped-887122622666.us-east1.run.app";
const ENCOMENDAS_API_KEY = process.env.ENCOMENDAS_INTEGRATION_KEY || "";

interface PedidoMonitorado {
  id: number;
  num_pedido: string;
  cnpj: string;
  token: string;
  items_faturados: string; // JSON
  encomendas_pendentes: string; // JSON
  related_groups: string; // JSON array
  base_dist_name: string;
  status: string;
  last_checked_at: string | null;
  created_at: string;
  updated_at: string;
}

// Verificar retorno de UM pedido junto à SmartPed
export async function checkPedidoReturn(pedido: PedidoMonitorado): Promise<{ done: boolean; logs: string[] }> {
  const logs: string[] = [];
  const numPedido = pedido.num_pedido;
  const itemsFaturados = JSON.parse(pedido.items_faturados || "[]");
  const encomendasPendentes = JSON.parse(pedido.encomendas_pendentes || "[]");
  const relatedGroups: string[] = JSON.parse(pedido.related_groups || "[]");
  const baseDistName = pedido.base_dist_name;

  const actualToken = (pedido.token || CONFIG.SMARTPED_PRODUCTION_TOKEN).trim();
  const apiCnpj = (pedido.cnpj || CONFIG.SMARTPED_DEFAULT_CNPJ).trim().replace(/\D/g, "");

  logs.push(`[PEDIDO-MONITOR] Verificando retorno do pedido ${numPedido}...`);

  try {
    const baseUrl = CONFIG.SMARTPED_PRODUCTION_URL;
    const endpointRetorno = `${baseUrl.replace(/\/$/, "")}/api/Pedido/Retorno`;

    const resRetorno = await fetchGlobal(endpointRetorno, {
      method: "POST",
      headers: { "Content-Type": "application/json", "Accept": "application/json" },
      body: JSON.stringify({
        Token: actualToken,
        parametros: {
          CnpjCLi: apiCnpj,
          NumeroPedido: parseInt(numPedido) || numPedido,
          NumPedido: parseInt(numPedido) || numPedido
        }
      }),
      signal: AbortSignal.timeout(15000)
    });

    if (!resRetorno.ok) {
      logs.push(`[PEDIDO-MONITOR] API retornou status ${resRetorno.status} — aguardando próxima verificação.`);
      return { done: false, logs };
    }

    const apiResponseData = await resRetorno.json();
    const rawRetorno = apiResponseData?.Retorno || apiResponseData?.retorno || apiResponseData;
    const dists = rawRetorno?.dists || rawRetorno?.Dists || [];
    const itens = rawRetorno?.Itens || rawRetorno?.itens || [];

    if (!dists || dists.length === 0) {
      logs.push(`[PEDIDO-MONITOR] Sem dados de distribuidoras no retorno — aguardando.`);
      return { done: false, logs };
    }

    // Determinar quais codDists estão neste lote
    const codDistsNoLote = Array.from(new Set(
      itemsFaturados.map((it: any) => String(it.codDist || it.CodDist || "").trim())
    ));

    // Verificar se TODOS os distribuidores do lote finalizaram (Status === 3)
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

    // Salvar itens faturados no Turso (usa saveItensConfirmadosBatch que já tem faturado_at do fix #42)
    const finalizedCodDists = new Set(
      dists.filter((d: any) => d.Status === 3).map((d: any) => String(d.CodDist || d.codDist || "").trim())
    );

    const itensParaSalvar = itens
      .filter((it: any) => {
        const codDistStr = String(it.CodDist || it.codDist || "").trim();
        return finalizedCodDists.has(codDistStr);
      })
      .map((it: any) => {
        const quantFaturada = parseFloat(it.QuantFaturada || it.quantFaturada || "0");
        const status = quantFaturada > 0 ? "faturado" : "nao_confirmado";
        const hoje = new Date(new Date().toLocaleString("en-US", { timeZone: "America/Sao_Paulo" }));
        const dataConfirmacao = `${String(hoje.getDate()).padStart(2, '0')}/${String(hoje.getMonth() + 1).padStart(2, '0')}/${hoje.getFullYear()}`;
        return {
          numPedido,
          ean: String(it.Ean || it.ean || it.EAN || "").trim(),
          descricao: it.Descricao || it.descricao || "",
          laboratorio: it.Laboratorio || it.laboratorio || "",
          codDist: typeof it.CodDist === "number" ? it.CodDist : parseInt(it.CodDist) || 0,
          nomeDist: "",
          qtdSolicitada: parseInt(it.Quant || "0") || 0,
          qtdFaturada: quantFaturada,
          precoLiquido: parseFloat(it.Preco || "0") || 0,
          status,
          motivo: it.Motivo || it.motivo || "",
          cnpj: apiCnpj,
          dataConfirmacao
        };
      });

    if (itensParaSalvar.length > 0) {
      try {
        await saveItensConfirmadosBatch(itensParaSalvar);
        logs.push(`[PEDIDO-MONITOR] ${itensParaSalvar.length} itens salvos no historico.`);
      } catch (e: any) {
        logs.push(`[PEDIDO-MONITOR] Erro ao salvar itens: ${e.message}`);
      }
    }

    // Confirmar encomendas por distribuidora
    if (encomendasPendentes.length > 0) {
      const resolvedIds = await confirmarEncomendasAposRetorno(numPedido, itens, encomendasPendentes, relatedGroups, dists, logs);
      if (resolvedIds.length > 0) {
        const remaining = encomendasPendentes.filter((e: any) => !resolvedIds.includes(e.idEncomenda));
        if (remaining.length !== encomendasPendentes.length) {
          await updatePedidoMonitoradoEncomendasPendentes(numPedido, remaining);
          logs.push(`[PEDIDO-MONITOR] ${resolvedIds.length} encomenda(s) resolvida(s) e removida(s) do rastreamento.`);
        }
      }
    }

    if (isAllFinalized) {
      logs.push(`[PEDIDO-MONITOR] Todos os distribuidores finalizados — pedido ${numPedido} concluido.`);
      await updatePedidoMonitoradoPendingDists(numPedido, null);
      return { done: true, logs };
    }

    // Montar resumo dos distribuidores pendentes (Status !== 3)
    const pendingDists = (codDistsNoLote.length > 0
      ? dists.filter((d: any) => codDistsNoLote.includes(String(d.CodDist || d.codDist || "").trim()))
      : dists
    ).filter((d: any) => d.Status !== 3);
    const pendingSummary = pendingDists.length > 0
      ? JSON.stringify(pendingDists.map((d: any) => d.NomeDist || d.nomeDist || `Dist ${d.CodDist || d.codDist}`))
      : null;
    await updatePedidoMonitoradoPendingDists(numPedido, pendingSummary);

    logs.push(`[PEDIDO-MONITOR] Ainda ha distribuidores pendentes — continuando monitoramento.`);
    return { done: false, logs };

  } catch (e: any) {
    logs.push(`[PEDIDO-MONITOR] Erro ao verificar pedido ${numPedido}: ${e.message}`);
    return { done: false, logs };
  }
}

// Confirmar encomendas no sistema externo — por distribuidora, assim que ela finaliza.
async function confirmarEncomendasAposRetorno(
  numPedido: string,
  itensRetorno: any[],
  encomendasPendentes: any[],
  relatedGroups: string[],
  dists: any[],
  logs: string[]
): Promise<string[]> {
  const finalizedCodDists = new Set(
    dists.filter((d: any) => d.Status === 3).map((d: any) => String(d.CodDist || d.codDist || "").trim())
  );

  const paraConfirmar: { encomenda: any; payload: { id: string; fornecedor: string; dataPrevisao: string; status?: string; observacao?: string } }[] = [];
  const resolvedIds: string[] = [];

  for (const encPendente of encomendasPendentes) {
    const encCodDists = Array.from(new Set(
      encPendente.itens.map((itemEnc: any) => String(itemEnc.codDist || "").trim())
    )) as string[];
    const todosFinalizados = encCodDists.length > 0 && encCodDists.every((cd: string) => finalizedCodDists.has(cd));
    if (!todosFinalizados) continue;

    resolvedIds.push(encPendente.idEncomenda);

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
      paraConfirmar.push({
        encomenda: encPendente,
        payload: {
          id: encPendente.idEncomenda,
          fornecedor: encPendente.fornecedor,
          dataPrevisao: new Date().toISOString().split("T")[0]
        }
      });
    } else {
      // Falha: distribuidor finalizou mas nenhum item faturado
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
      logs.push(`[PEDIDO-MONITOR] Encomenda ${encPendente.idEncomenda} marcada como NAO ATENDIDA — motivo: ${motivoFallo}`);
    }
  }

  if (paraConfirmar.length === 0) return resolvedIds;

  logs.push(`[PEDIDO-MONITOR] Confirmando ${paraConfirmar.length} encomenda(s): ${paraConfirmar.map(p => p.encomenda.idEncomenda).join(", ")}...`);

  let confirmadas = false;
  for (let tentativa = 1; tentativa <= 3; tentativa++) {
    try {
      const respConfirmar = await fetchGlobal(`${ENCOMENDAS_API_URL}/api/integracao/encomendas/confirmar-pedido`, {
        method: "POST",
        headers: { "Content-Type": "application/json", "x-api-key": ENCOMENDAS_API_KEY },
        body: JSON.stringify({ itens: paraConfirmar.map(p => p.payload) })
      });
      if (respConfirmar.ok) {
        confirmadas = true;
        break;
      } else {
        const errText = await respConfirmar.text().catch(() => "Sem detalhes");
        logs.push(`[PEDIDO-MONITOR] Tentativa ${tentativa}/3 - Falha ao confirmar encomendas: ${respConfirmar.status} - ${errText}`);
      }
    } catch (fetchErr: any) {
      logs.push(`[PEDIDO-MONITOR] Tentativa ${tentativa}/3 - Erro de rede: ${fetchErr.message}`);
    }
    if (tentativa < 3) await new Promise(r => setTimeout(r, 1000));
  }

  if (!confirmadas) {
    const msgs = paraConfirmar.map(p => `Encomenda ${p.encomenda.idEncomenda} (fornecedor: ${p.encomenda.fornecedor}) faturada no SmartPed mas NAO foi possivel confirmar no sistema de Encomendas apos 3 tentativas — verifique manualmente.`);
    for (const msg of msgs) {
      logs.push(`[PEDIDO-MONITOR] ATENCAO: ${msg}`);
    }
  }

  return resolvedIds;
}

// Função principal: processar TODOS os pedidos monitorados
export async function checkAllMonitoredPedidos(): Promise<void> {
  const pedidos = await getPedidosMonitorando();
  if (pedidos.length === 0) return;

  console.log(`[PEDIDO-MONITOR] Verificando ${pedidos.length} pedido(s) monitorado(s))...`);

  const now = Date.now();
  const TEN_MINUTES_MS = 10 * 60 * 1000;

  for (const pedido of pedidos) {
    // Pular se já foi verificado nos últimos 10 minutos
    if (pedido.last_checked_at) {
      const lastChecked = new Date(pedido.last_checked_at + "Z").getTime();
      if (now - lastChecked < TEN_MINUTES_MS) continue;
    }

    const { done, logs } = await checkPedidoReturn(pedido);

    for (const log of logs) console.log(log);

    await updatePedidoMonitoradoLastChecked(pedido.num_pedido);

    if (done) {
      await updatePedidoMonitoradoStatus(pedido.num_pedido, "concluido");
    }
  }
}
