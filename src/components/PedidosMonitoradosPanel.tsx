import React, { useState, useEffect, useCallback } from 'react';
import { RefreshCw, Eye, XCircle, Loader2, Clock, CheckCircle2 } from 'lucide-react';

interface PedidoMonitorado {
  numPedido: string;
  cnpj: string;
  baseDistName: string;
  status: string;
  totalItens: number;
  pendingDistsSummary: string[] | null;
  lastCheckedAt: string | null;
  createdAt: string;
  updatedAt: string;
}

export function PedidosMonitoradosPanel({ config }: { config: { cnpj: string } }) {
  const [pedidos, setPedidos] = useState<PedidoMonitorado[]>([]);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [acaoPedido, setAcaoPedido] = useState<string | null>(null);

  const fetchPedidos = useCallback(async () => {
    setLoading(true);
    setError(null);
    try {
      const cnpjParam = config.cnpj ? `?cnpj=${encodeURIComponent(config.cnpj)}` : "";
      const res = await fetch(`/api/pedidos-monitorados${cnpjParam}`);
      const data = await res.json();
      if (data.sucesso) {
        setPedidos(data.pedidos || []);
      } else {
        setError(data.error || "Erro ao listar pedidos monitorados.");
      }
    } catch (e: any) {
      setError(e.message);
    } finally {
      setLoading(false);
    }
  }, [config.cnpj]);

  useEffect(() => { fetchPedidos(); }, [fetchPedidos]);

  const forcarVerificacao = async (numPedido: string) => {
    setAcaoPedido(numPedido);
    try {
      await fetch(`/api/pedidos-monitorados/${numPedido}/forcar-verificacao`, { method: "POST" });
      await fetchPedidos();
    } catch (e: any) {
      setError(e.message);
    } finally {
      setAcaoPedido(null);
    }
  };

  const encerrar = async (numPedido: string) => {
    if (!confirm(`Encerrar monitoramento do pedido ${numPedido}?`)) return;
    setAcaoPedido(numPedido);
    try {
      await fetch(`/api/pedidos-monitorados/${numPedido}/encerrar`, { method: "POST" });
      await fetchPedidos();
    } catch (e: any) {
      setError(e.message);
    } finally {
      setAcaoPedido(null);
    }
  };

  if (pedidos.length === 0 && !loading) return null;

  return (
    <div className="bg-[#DCDAD7] border border-[#141414] p-4 mb-4">
      <div className="flex items-center justify-between mb-3">
        <h3 className="text-xs font-bold uppercase tracking-wider text-[#141414] flex items-center gap-2">
          <Eye className="w-4 h-4" />
          Pedidos Monitorados ({pedidos.length})
        </h3>
        <button
          onClick={fetchPedidos}
          disabled={loading}
          className="text-[10px] font-bold uppercase tracking-wider text-[#141414]/60 hover:text-[#141414] flex items-center gap-1"
        >
          {loading ? <Loader2 className="w-3 h-3 animate-spin" /> : <RefreshCw className="w-3 h-3" />}
          Atualizar
        </button>
      </div>

      {error && (
        <div className="text-[10px] text-red-800 bg-red-100 border border-red-300 p-2 mb-2">{error}</div>
      )}

      <div className="space-y-1">
        {pedidos.map((p) => (
          <div key={p.numPedido} className="flex items-center justify-between bg-white border border-[#141414]/20 px-3 py-2 text-[11px]">
            <div className="flex items-center gap-3">
              <span className="font-mono font-bold text-[#141410]">#{p.numPedido}</span>
              <span className="text-[#141414]/60">{p.baseDistName}</span>
              <span className="text-[#141414]/40">{p.totalItens} itens</span>
              {p.status === "monitorando" ? (
                <span className="flex items-center gap-1 text-amber-700 font-bold uppercase tracking-wider">
                  <Clock className="w-3 h-3" /> Monitorando{p.pendingDistsSummary && p.pendingDistsSummary.length > 0 ? (
                    <span className="font-normal normal-case tracking-normal text-amber-600"> — Aguardando: {p.pendingDistsSummary.join(", ")}</span>
                  ) : null}
                </span>
              ) : (
                <span className="flex items-center gap-1 text-green-700 font-bold uppercase tracking-wider">
                  <CheckCircle2 className="w-3 h-3" /> {p.status}
                </span>
              )}
            </div>
            {p.status === "monitorando" && (
              <div className="flex items-center gap-2">
                <button
                  onClick={() => forcarVerificacao(p.numPedido)}
                  disabled={acaoPedido === p.numPedido}
                  className="text-[10px] font-bold uppercase tracking-wider text-[#141414]/60 hover:text-[#141414] disabled:opacity-50 border border-[#141414]/20 px-2 py-0.5"
                >
                  {acaoPedido === p.numPedido ? <Loader2 className="w-3 h-3 animate-spin" /> : "Verificar Agora"}
                </button>
                <button
                  onClick={() => encerrar(p.numPedido)}
                  disabled={acaoPedido === p.numPedido}
                  className="text-red-600 hover:text-red-800 disabled:opacity-50"
                >
                  <XCircle className="w-3 h-3" />
                </button>
              </div>
            )}
          </div>
        ))}
      </div>
    </div>
  );
}
