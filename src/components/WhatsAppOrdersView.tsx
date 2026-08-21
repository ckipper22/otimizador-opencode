import React, { useState, useEffect, useMemo } from 'react';
import { Loader2, RefreshCw, Trash2, CheckCircle, Clock, Package, MessageSquare, ChevronDown, ChevronRight, AlertCircle, Search } from 'lucide-react';
import { WhatsAppOrder, WhatsAppOrderItem, OptimizerConfig } from '../types';

const getTodayString = () => {
  const d = new Date(new Date().toLocaleString("en-US", { timeZone: "America/Sao_Paulo" }));
  const year = d.getFullYear();
  const month = String(d.getMonth() + 1).padStart(2, '0');
  const day = String(d.getDate()).padStart(2, '0');
  return `${year}-${month}-${day}`;
};

const STATUS_COLORS: Record<string, { bg: string; text: string; border: string; icon: React.ReactNode }> = {
  Pendente: { bg: "bg-amber-50", text: "text-amber-800", border: "border-amber-300", icon: <Clock className="w-3.5 h-3.5" /> },
  Confirmado: { bg: "bg-blue-50", text: "text-blue-800", border: "border-blue-300", icon: <CheckCircle className="w-3.5 h-3.5" /> },
  Recebido: { bg: "bg-emerald-50", text: "text-emerald-800", border: "border-emerald-300", icon: <Package className="w-3.5 h-3.5" /> },
  Cancelado: { bg: "bg-rose-50", text: "text-rose-800", border: "border-rose-300", icon: <AlertCircle className="w-3.5 h-3.5" /> },
};

const STATUS_ORDER = ["Pendente", "Confirmado", "Recebido", "Cancelado"];

function formatCurrency(value: number): string {
  return new Intl.NumberFormat("pt-BR", { style: "currency", currency: "BRL" }).format(value);
}

function formatDate(iso: string): string {
  if (!iso) return "—";
  try {
    const d = new Date(iso);
    return d.toLocaleDateString("pt-BR", { day: "2-digit", month: "2-digit", year: "numeric", hour: "2-digit", minute: "2-digit" });
  } catch {
    return iso;
  }
}

interface WhatsAppOrdersViewProps {
  config: OptimizerConfig;
}

export const WhatsAppOrdersView = ({ config }: WhatsAppOrdersViewProps) => {
  const [orders, setOrders] = useState<WhatsAppOrder[]>([]);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [expandedOrderId, setExpandedOrderId] = useState<number | null>(null);
  const [searchTerm, setSearchTerm] = useState("");
  const [filterStatus, setFilterStatus] = useState<"all" | WhatsAppOrder["status"]>("all");

  const fetchOrders = async () => {
    setLoading(true);
    setError(null);
    try {
      const res = await fetch("/api/pedidos-whatsapp/list", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ cnpj: config.cnpj }),
      });
      if (!res.ok) throw new Error(`Erro ${res.status}`);
      const data = await res.json();
      setOrders(data.pedidos || []);
    } catch (err: any) {
      setError(err.message || "Erro ao carregar pedidos");
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => {
    if (config.cnpj) fetchOrders();
  }, [config.cnpj]);

  const handleStatusChange = async (id: number, newStatus: WhatsAppOrder["status"]) => {
    try {
      const res = await fetch(`/api/pedidos-whatsapp/${id}/status`, {
        method: "PUT",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ status: newStatus }),
      });
      if (!res.ok) throw new Error(`Erro ${res.status}`);
      setOrders(prev => prev.map(o => o.id === id ? { ...o, status: newStatus } : o));
    } catch (err: any) {
      setError(err.message || "Erro ao atualizar status");
    }
  };

  const handleDelete = async (id: number) => {
    if (!confirm("Excluir este pedido WhatsApp?")) return;
    try {
      const res = await fetch(`/api/pedidos-whatsapp/${id}`, { method: "DELETE" });
      if (!res.ok) throw new Error(`Erro ${res.status}`);
      setOrders(prev => prev.filter(o => o.id !== id));
    } catch (err: any) {
      setError(err.message || "Erro ao deletar pedido");
    }
  };

  const filteredOrders = useMemo(() => {
    let result = orders;
    if (filterStatus !== "all") {
      result = result.filter(o => o.status === filterStatus);
    }
    if (searchTerm.trim()) {
      const q = searchTerm.toLowerCase();
      result = result.filter(o =>
        o.fornecedor?.toLowerCase().includes(q) ||
        o.telefone?.toLowerCase().includes(q) ||
        o.itens?.some(i => i.descricao?.toLowerCase().includes(q) || i.ean?.includes(q))
      );
    }
    return result;
  }, [orders, filterStatus, searchTerm]);

  const statusCounts = useMemo(() => {
    const counts: Record<string, number> = { all: orders.length };
    STATUS_ORDER.forEach(s => { counts[s] = orders.filter(o => o.status === s).length; });
    return counts;
  }, [orders]);

  const totalItens = orders.reduce((sum, o) => sum + (o.itens?.length || 0), 0);

  return (
    <div className="space-y-4">
      {/* Header */}
      <div className="flex items-center justify-between">
        <div className="flex items-center gap-3">
          <div className="p-2 bg-emerald-100 border border-emerald-300 rounded-none">
            <MessageSquare className="w-5 h-5 text-emerald-700" />
          </div>
          <div>
            <h2 className="text-sm font-black uppercase tracking-wider text-[#141414]">
              Pedidos WhatsApp
            </h2>
            <p className="text-[10px] text-slate-500">
              {orders.length} pedidos | {totalItens} itens total
            </p>
          </div>
        </div>
        <button
          onClick={fetchOrders}
          disabled={loading}
          className="px-3 py-1.5 text-[10px] font-bold uppercase tracking-wider bg-[#141414] text-[#E4E3E0] hover:bg-neutral-800 disabled:opacity-50 flex items-center gap-1.5 cursor-pointer"
        >
          <RefreshCw className={`w-3.5 h-3.5 ${loading ? "animate-spin" : ""}`} />
          Atualizar
        </button>
      </div>

      {/* Error */}
      {error && (
        <div className="p-3 bg-rose-50 border border-rose-300 text-rose-800 text-xs flex items-center gap-2">
          <AlertCircle className="w-4 h-4 shrink-0" />
          {error}
          <button onClick={() => setError(null)} className="ml-auto text-rose-600 hover:text-rose-800 cursor-pointer">✕</button>
        </div>
      )}

      {/* Filters */}
      <div className="flex flex-wrap items-center gap-3">
        {/* Status filter tabs */}
        <div className="flex border border-[#141414]">
          <button
            onClick={() => setFilterStatus("all")}
            className={`px-3 py-1.5 text-[10px] font-bold uppercase tracking-wider transition-colors cursor-pointer ${
              filterStatus === "all"
                ? "bg-[#141414] text-[#E4E3E0]"
                : "bg-white text-[#141414] hover:bg-[#DCDAD7]"
            }`}
          >
            Todos ({statusCounts.all})
          </button>
          {STATUS_ORDER.map(s => (
            <button
              key={s}
              onClick={() => setFilterStatus(s)}
              className={`px-3 py-1.5 text-[10px] font-bold uppercase tracking-wider border-l border-[#141414] transition-colors cursor-pointer ${
                filterStatus === s
                  ? "bg-[#141414] text-[#E4E3E0]"
                  : "bg-white text-[#141414] hover:bg-[#DCDAD7]"
              }`}
            >
              {s} ({statusCounts[s] || 0})
            </button>
          ))}
        </div>

        {/* Search */}
        <div className="relative flex-1 min-w-[200px] max-w-xs">
          <Search className="absolute left-2 top-1/2 -translate-y-1/2 w-3.5 h-3.5 text-slate-400" />
          <input
            type="text"
            value={searchTerm}
            onChange={e => setSearchTerm(e.target.value)}
            placeholder="Buscar fornecedor, EAN, produto..."
            className="w-full pl-7 pr-2 py-1.5 text-[11px] border border-slate-300 rounded-none focus:outline-none focus:border-[#141414] bg-white"
          />
        </div>
      </div>

      {/* Orders list */}
      {loading && orders.length === 0 ? (
        <div className="flex items-center justify-center py-12 text-slate-400">
          <Loader2 className="w-5 h-5 animate-spin mr-2" />
          <span className="text-xs">Carregando pedidos...</span>
        </div>
      ) : filteredOrders.length === 0 ? (
        <div className="text-center py-12 text-slate-400">
          <MessageSquare className="w-8 h-8 mx-auto mb-2 opacity-30" />
          <p className="text-xs">Nenhum pedido WhatsApp encontrado.</p>
          <p className="text-[10px] mt-1">Pedidos são criados ao gerar pedidos WhatsApp no pré-pedido.</p>
        </div>
      ) : (
        <div className="space-y-2">
          {filteredOrders.map(order => {
            const isExpanded = expandedOrderId === order.id;
            const sc = STATUS_COLORS[order.status] || STATUS_COLORS.Pendente;
            return (
              <div
                key={order.id}
                className="border border-slate-200 bg-white hover:border-slate-300 transition-colors"
              >
                {/* Order header */}
                <div
                  className="flex items-center gap-3 px-4 py-3 cursor-pointer select-none"
                  onClick={() => setExpandedOrderId(isExpanded ? null : order.id)}
                >
                  <div className="text-slate-400 shrink-0">
                    {isExpanded ? <ChevronDown className="w-4 h-4" /> : <ChevronRight className="w-4 h-4" />}
                  </div>

                  <div className={`flex items-center gap-1.5 px-2 py-0.5 text-[10px] font-bold uppercase tracking-wider border ${sc.bg} ${sc.text} ${sc.border} shrink-0`}>
                    {sc.icon}
                    {order.status}
                  </div>

                  <div className="flex-1 min-w-0">
                    <div className="text-xs font-bold text-[#141414] truncate">
                      {order.fornecedor}
                      {order.telefone && (
                        <span className="text-[10px] text-slate-400 font-normal ml-2">{order.telefone}</span>
                      )}
                    </div>
                    <div className="text-[10px] text-slate-500 flex items-center gap-2">
                      <span>{formatDate(order.dataPedido)}</span>
                      <span className="text-slate-300">|</span>
                      <span>{order.itens?.length || 0} itens</span>
                      {order.origem && (
                        <>
                          <span className="text-slate-300">|</span>
                          <span className="uppercase font-bold">{order.origem}</span>
                        </>
                      )}
                    </div>
                  </div>

                  {/* Status change buttons */}
                  <div className="flex items-center gap-1 shrink-0" onClick={e => e.stopPropagation()}>
                    {order.status === "Pendente" && (
                      <button
                        onClick={() => handleStatusChange(order.id, "Confirmado")}
                        className="px-2 py-1 text-[9px] font-bold uppercase bg-blue-100 text-blue-800 border border-blue-300 hover:bg-blue-200 cursor-pointer transition-colors"
                        title="Marcar como Confirmado"
                      >
                        Confirmar
                      </button>
                    )}
                    {order.status === "Confirmado" && (
                      <button
                        onClick={() => handleStatusChange(order.id, "Recebido")}
                        className="px-2 py-1 text-[9px] font-bold uppercase bg-emerald-100 text-emerald-800 border border-emerald-300 hover:bg-emerald-200 cursor-pointer transition-colors"
                        title="Marcar como Recebido"
                      >
                        Recebido
                      </button>
                    )}
                    {order.status !== "Cancelado" && order.status !== "Recebido" && (
                      <button
                        onClick={() => handleStatusChange(order.id, "Cancelado")}
                        className="px-2 py-1 text-[9px] font-bold uppercase bg-rose-50 text-rose-700 border border-rose-200 hover:bg-rose-100 cursor-pointer transition-colors"
                        title="Cancelar"
                      >
                        Cancelar
                      </button>
                    )}
                    <button
                      onClick={() => handleDelete(order.id)}
                      className="p-1 text-rose-400 hover:text-rose-600 hover:bg-rose-50 cursor-pointer transition-colors"
                      title="Excluir pedido"
                    >
                      <Trash2 className="w-3.5 h-3.5" />
                    </button>
                  </div>
                </div>

                {/* Expanded items */}
                {isExpanded && order.itens && order.itens.length > 0 && (
                  <div className="border-t border-slate-200 bg-slate-50/50 px-4 py-3">
                    {order.observacao && (
                      <div className="mb-2 text-[10px] text-slate-600 italic">
                        Obs: {order.observacao}
                      </div>
                    )}
                    <table className="w-full text-[10px]">
                      <thead>
                        <tr className="text-slate-500 uppercase font-bold border-b border-slate-200">
                          <th className="text-left py-1 pr-2">EAN</th>
                          <th className="text-left py-1 pr-2">Produto</th>
                          <th className="text-left py-1 pr-2">Lab</th>
                          <th className="text-right py-1 pr-2">Qtd</th>
                          <th className="text-right py-1 pr-2">Preço</th>
                          <th className="text-left py-1">Obs</th>
                        </tr>
                      </thead>
                      <tbody>
                        {order.itens.map((item: WhatsAppOrderItem, idx: number) => (
                          <tr key={idx} className="border-b border-slate-100 last:border-0">
                            <td className="py-1 pr-2 font-mono text-slate-600">{item.ean}</td>
                            <td className="py-1 pr-2 font-bold text-[#141414] max-w-[200px] truncate">{item.descricao}</td>
                            <td className="py-1 pr-2 text-slate-500">{item.laboratorio || "—"}</td>
                            <td className="py-1 pr-2 text-right font-bold">{item.qtd}</td>
                            <td className="py-1 pr-2 text-right text-green-700 font-bold">
                              {item.precoLiquido ? formatCurrency(item.precoLiquido) : item.preco ? formatCurrency(item.preco) : "—"}
                            </td>
                            <td className="py-1 text-slate-500 italic max-w-[150px] truncate">{item.observacao || ""}</td>
                          </tr>
                        ))}
                      </tbody>
                    </table>
                  </div>
                )}
              </div>
            );
          })}
        </div>
      )}
    </div>
  );
};

export default WhatsAppOrdersView;
