import React, { useState, useMemo } from "react";
import { X, Copy, Check, MessageSquare, ExternalLink, Phone, Building2, Package, EyeOff, Eye, Send, Loader2, Save } from "lucide-react";
import { SwapReportItem, OptimizerConfig, WhatsAppRule } from "../types";
import { formatCurrency } from "../utils";

interface WhatsAppOrderModalProps {
  items: SwapReportItem[];
  config: OptimizerConfig;
  rule?: WhatsAppRule;
  onClose: () => void;
}

export const WhatsAppOrderModal: React.FC<WhatsAppOrderModalProps> = ({
  items,
  config,
  rule,
  onClose,
}) => {
  const [copied, setCopied] = useState(false);
  const [repPhone, setRepPhone] = useState(rule?.telefone || config.telefoneWhatsappEurofarma || "");
  const [repName, setRepName] = useState(rule?.nomeRepresentante || "Representante Comercial");
  const [pharmacyName, setPharmacyName] = useState("");
  const [hidePrices, setHidePrices] = useState<boolean>(rule?.ocultarPrecos !== undefined ? rule.ocultarPrecos : true);
  const [orderNotes, setOrderNotes] = useState("Favor confirmar recebimento e faturamento dos itens.");
  const [saving, setSaving] = useState(false);
  const [saved, setSaved] = useState(false);
  
  // Selection state for items (default all selected)
  const [selectedCodInternos, setSelectedCodInternos] = useState<Set<string>>(() => {
    return new Set(items.map((i) => i.codInterno));
  });

  const toggleItem = (codInterno: string) => {
    setSelectedCodInternos((prev) => {
      const next = new Set(prev);
      if (next.has(codInterno)) {
        next.delete(codInterno);
      } else {
        next.add(codInterno);
      }
      return next;
    });
  };

  const toggleAll = () => {
    if (selectedCodInternos.size === items.length) {
      setSelectedCodInternos(new Set());
    } else {
      setSelectedCodInternos(new Set(items.map((i) => i.codInterno)));
    }
  };

  const activeItems = useMemo(() => {
    return items.filter((item) => selectedCodInternos.has(item.codInterno));
  }, [items, selectedCodInternos]);

  const totalBoxes = useMemo(() => {
    return activeItems.reduce((acc, item) => acc + (item.qtd || 1), 0);
  }, [activeItems]);

  const totalValue = useMemo(() => {
    return activeItems.reduce((acc, item) => acc + (item.novoPreco * item.qtd), 0);
  }, [activeItems]);

  const titleText = rule?.nomeRegra || "Genéricos Eurofarma";

  const generatedMessage = useMemo(() => {
    const todayStr = new Date().toLocaleDateString("pt-BR");
    const cnpjStr = config.cnpj ? ` | CNPJ: ${config.cnpj}` : "";
    const pharmacyHeader = pharmacyName ? `🏥 *Farmácia:* ${pharmacyName}${cnpjStr}\n` : (config.cnpj ? `🏥 *CNPJ:* ${config.cnpj}\n` : "");
    const repHeader = repName ? `👤 *Contato:* ${repName}\n` : "";

    let message = `📦 *PEDIDO DE COMPRA - ${titleText.toUpperCase()}*\n`;
    message += `📅 *Data:* ${todayStr}\n`;
    if (pharmacyHeader) message += pharmacyHeader;
    if (repHeader) message += repHeader;
    message += `\n📋 *ITENS DO PEDIDO (${activeItems.length}):*\n`;
    message += `----------------------------------\n`;

    activeItems.forEach((item, index) => {
      const ean = item.novoEan || item.originalEan || "S/EAN";
      const desc = item.novaDescricao || item.originalDescricao || "Produto sem descrição";
      const qtd = item.qtd || 1;

      message += `${index + 1}. *EAN:* ${ean}\n`;
      message += `   *${desc}*\n`;
      if (hidePrices) {
        message += `   • *Qtd:* ${qtd} caixas\n\n`;
      } else {
        const unitPrice = formatCurrency(item.novoPreco);
        const subtotal = formatCurrency(item.novoPreco * item.qtd);
        message += `   • *Qtd:* ${qtd} cx | *Unit:* ${unitPrice} | *Total:* ${subtotal}\n\n`;
      }
    });

    message += `----------------------------------\n`;
    message += `📊 *RESUMO DO PEDIDO:*\n`;
    message += `• *Total de Itens:* ${activeItems.length}\n`;
    message += `• *Total de Caixas:* ${totalBoxes} caixas/unidades\n`;
    if (!hidePrices) {
      message += `• *Valor Total Estimado:* ${formatCurrency(totalValue)}\n`;
    }

    if (orderNotes.trim()) {
      message += `\n📝 *Observações:* ${orderNotes.trim()}\n`;
    }

    message += `\n_Pedido gerado via Otimizador de Pedidos_`;

    return message;
  }, [activeItems, pharmacyName, config.cnpj, repName, totalBoxes, totalValue, orderNotes, titleText, hidePrices]);

  const handleCopy = () => {
    navigator.clipboard.writeText(generatedMessage);
    setCopied(true);
    setTimeout(() => setCopied(false), 2500);
    // Registrar envio no backend (não bloquear feedback visual)
    if (rule?.id && config?.cnpj) {
      const eans = activeItems.map(i => i.novoEan || i.originalEan).filter(Boolean);
      fetch("/api/whatsapp-rules/registrar-envio", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ regraId: rule.id, termoFiltro: rule.termoFiltro, eans, cnpj: config.cnpj }),
      }).catch(() => {});
    }
  };

  const handleOpenWhatsApp = () => {
    const cleanNumber = repPhone.replace(/\D/g, "");
    const encodedText = encodeURIComponent(generatedMessage);
    
    let url = "";
    if (cleanNumber) {
      // Garantir código de país Brasil (55)
      const fullPhone = cleanNumber.length <= 11 ? `55${cleanNumber}` : cleanNumber;
      url = `https://api.whatsapp.com/send?phone=${fullPhone}&text=${encodedText}`;
    } else {
      url = `https://api.whatsapp.com/send?text=${encodedText}`;
    }

    window.open(url, "_blank");
  };

  const handleSaveOrder = async () => {
    if (saving || saved) return;
    setSaving(true);
    try {
      const payload = {
        fornecedor: rule?.nomeRegra || titleText,
        telefone: repPhone,
        itens: activeItems.map(item => ({
          ean: item.novoEan || item.originalEan,
          descricao: item.novaDescricao || item.originalDescricao,
          laboratorio: item.novoLaboratorio || item.originalLaboratorio,
          qtd: item.qtd || 1,
          preco: item.novoPreco,
          precoLiquido: item.novoPreco,
          observacao: orderNotes.trim() || undefined,
        })),
        status: "Pendente",
        observacao: orderNotes.trim() || undefined,
        origem: "regra_lab",
        cnpj: config.cnpj,
      };
      const res = await fetch("/api/pedidos-whatsapp", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(payload),
      });
      if (!res.ok) throw new Error(`Erro ${res.status}`);
      setSaved(true);
    } catch (err) {
      console.error("Erro ao salvar pedido WhatsApp:", err);
      alert("Erro ao salvar pedido. Tente novamente.");
    } finally {
      setSaving(false);
    }
  };

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center p-4 bg-black/70 backdrop-blur-sm animate-fade-in font-sans">
      <div className="bg-white border-2 border-emerald-600 rounded-none shadow-2xl w-full max-w-4xl max-h-[92vh] flex flex-col overflow-hidden text-slate-800">
        
        {/* Header */}
        <div className="bg-emerald-700 text-white p-4 flex items-center justify-between border-b border-emerald-800">
          <div className="flex items-center space-x-3">
            <div className="p-2 bg-emerald-600 border border-emerald-500 rounded-none">
              <MessageSquare className="w-6 h-6 text-emerald-100" />
            </div>
            <div>
              <h2 className="text-base font-black uppercase tracking-wider flex items-center gap-2">
                <span>Pedido WhatsApp - {titleText}</span>
                <span className="text-[10px] bg-emerald-800 text-emerald-100 px-2 py-0.5 rounded border border-emerald-500/50">
                  {activeItems.length} {activeItems.length === 1 ? "item" : "itens"}
                </span>
              </h2>
              <p className="text-xs text-emerald-100/90 font-sans">
                Formate o pedido diretamente para o representante comercial
              </p>
            </div>
          </div>
          <button
            onClick={onClose}
            className="p-1 text-emerald-100 hover:text-white hover:bg-emerald-600 transition-colors cursor-pointer"
            title="Fechar"
          >
            <X className="w-5 h-5" />
          </button>
        </div>

        {/* Content Body */}
        <div className="p-5 overflow-y-auto flex-1 space-y-4 bg-slate-50/50">
          
          {/* Controls / Info Bar */}
          <div className="grid grid-cols-1 md:grid-cols-3 gap-3 bg-white p-3.5 border border-slate-200 shadow-xs">
            <div>
              <label className="block text-[10px] font-bold text-slate-600 uppercase tracking-wider mb-1 flex items-center gap-1">
                <Building2 className="w-3 h-3 text-emerald-600" /> Nome da Farmácia
              </label>
              <input
                type="text"
                placeholder="Ex: Farmácia Central"
                value={pharmacyName}
                onChange={(e) => setPharmacyName(e.target.value)}
                className="w-full bg-slate-50 border border-slate-300 px-2.5 py-1.5 text-xs text-slate-800 focus:outline-none focus:border-emerald-600 focus:bg-white"
              />
            </div>

            <div>
              <label className="block text-[10px] font-bold text-slate-600 uppercase tracking-wider mb-1 flex items-center gap-1">
                <Phone className="w-3 h-3 text-emerald-600" /> WhatsApp do Vendedor
              </label>
              <input
                type="text"
                placeholder="Ex: (11) 99999-9999"
                value={repPhone}
                onChange={(e) => setRepPhone(e.target.value)}
                className="w-full bg-slate-50 border border-slate-300 px-2.5 py-1.5 text-xs font-mono text-slate-800 focus:outline-none focus:border-emerald-600 focus:bg-white"
              />
            </div>

            <div>
              <label className="block text-[10px] font-bold text-slate-600 uppercase tracking-wider mb-1">
                Contato / Vendedor
              </label>
              <input
                type="text"
                placeholder="Nome do representante"
                value={repName}
                onChange={(e) => setRepName(e.target.value)}
                className="w-full bg-slate-50 border border-slate-300 px-2.5 py-1.5 text-xs text-slate-800 focus:outline-none focus:border-emerald-600 focus:bg-white"
              />
            </div>
          </div>

          {/* Toggle para Ocultar Preços */}
          <div className="bg-amber-50/90 border border-amber-200 p-3 flex items-center justify-between text-xs text-amber-950 font-sans">
            <div className="flex items-center gap-2">
              <EyeOff className="w-4 h-4 text-amber-700 shrink-0" />
              <div>
                <span className="font-bold">Ocultar valores e preços no pedido</span>
                <span className="text-[11px] text-amber-800 block">
                  {hidePrices 
                    ? "O pedido será enviado apenas com EAN, Descrição e Quantidade (sem preços)." 
                    : "Os preços e subtotais serão exibidos na mensagem."}
                </span>
              </div>
            </div>
            <label className="flex items-center space-x-2 cursor-pointer font-bold bg-white px-3 py-1.5 border border-amber-300 shadow-xs hover:bg-amber-100/50">
              <input
                type="checkbox"
                checked={hidePrices}
                onChange={(e) => setHidePrices(e.target.checked)}
                className="w-4 h-4 text-amber-600 border-amber-400 rounded focus:ring-amber-500 accent-amber-600 cursor-pointer"
              />
              <span className="text-xs uppercase tracking-wider">Ocultar Preços</span>
            </label>
          </div>

          {/* Main Grid: Items Table & Live Text Preview */}
          <div className="grid grid-cols-1 lg:grid-cols-12 gap-4">
            
            {/* Left: Items Selection Table */}
            <div className="lg:col-span-7 bg-white border border-slate-200 flex flex-col overflow-hidden shadow-xs">
              <div className="p-3 bg-slate-100 border-b border-slate-200 flex items-center justify-between">
                <span className="text-xs font-bold uppercase tracking-wider text-slate-700 flex items-center gap-1.5">
                  <Package className="w-4 h-4 text-emerald-600" />
                  <span>Itens do Lote</span>
                </span>
                <button
                  type="button"
                  onClick={toggleAll}
                  className="text-[10px] font-bold text-emerald-700 hover:text-emerald-900 underline uppercase tracking-wider cursor-pointer"
                >
                  {selectedCodInternos.size === items.length ? "Desmarcar Todos" : "Marcar Todos"}
                </button>
              </div>

              <div className="overflow-y-auto max-h-[280px] divide-y divide-slate-100 font-mono text-xs">
                {items.length === 0 ? (
                  <div className="p-6 text-center text-slate-400 text-xs font-sans">
                    Nenhum item encontrado para esta regra.
                  </div>
                ) : (
                  items.map((item) => {
                    const isChecked = selectedCodInternos.has(item.codInterno);
                    return (
                      <div
                        key={item.codInterno}
                        onClick={() => toggleItem(item.codInterno)}
                        className={`p-2.5 flex items-start gap-2.5 cursor-pointer transition-colors ${
                          isChecked ? "bg-emerald-50/50 hover:bg-emerald-50" : "bg-white hover:bg-slate-50 opacity-60"
                        }`}
                      >
                        <input
                          type="checkbox"
                          checked={isChecked}
                          onChange={() => {}} // Handled by div click
                          className="mt-0.5 w-4 h-4 text-emerald-600 border-slate-300 rounded focus:ring-emerald-500 accent-emerald-600 cursor-pointer"
                        />
                        <div className="flex-1 min-w-0">
                          <div className="font-bold text-slate-800 text-[11px] truncate">
                            {item.novaDescricao || item.originalDescricao}
                          </div>
                          <div className="flex items-center gap-3 text-[10px] text-slate-500 mt-0.5">
                            <span>EAN: {item.novoEan || item.originalEan}</span>
                            <span className="font-semibold text-emerald-700">Qtd: {item.qtd} caixas</span>
                          </div>
                        </div>
                        {!hidePrices && (
                          <div className="text-right font-bold text-xs text-slate-900 shrink-0">
                            {formatCurrency(item.novoPreco * item.qtd)}
                          </div>
                        )}
                      </div>
                    );
                  })
                )}
              </div>

              {/* Table Footer Summary */}
              <div className="p-3 bg-slate-100 border-t border-slate-200 flex items-center justify-between font-mono text-xs">
                <span className="font-bold text-slate-700">Total de Caixas:</span>
                <div className="text-right">
                  <span className="font-extrabold text-emerald-800 text-sm">
                    {totalBoxes} caixas
                  </span>
                  <span className="text-[10px] text-slate-500 block font-sans">
                    ({activeItems.length} itens marcados)
                  </span>
                </div>
              </div>
            </div>

            {/* Right: Live Text Preview */}
            <div className="lg:col-span-5 bg-emerald-950/90 text-emerald-100 border border-emerald-800 p-3.5 flex flex-col overflow-hidden shadow-xs">
              <div className="flex items-center justify-between pb-2 border-b border-emerald-800/80 mb-2">
                <span className="text-xs font-bold text-emerald-200 uppercase tracking-wider flex items-center gap-1.5 font-sans">
                  <MessageSquare className="w-3.5 h-3.5 text-emerald-400" />
                  <span>Preview do Texto WhatsApp</span>
                </span>
                <span className="text-[9px] bg-emerald-900 text-emerald-300 px-1.5 py-0.5 font-mono">
                  {hidePrices ? "Sem Preços" : "Com Preços"}
                </span>
              </div>

              <div className="flex-1 overflow-y-auto max-h-[280px] bg-emerald-950 p-3 font-mono text-[11px] leading-relaxed whitespace-pre-wrap border border-emerald-800/60 rounded-none text-emerald-200 select-all font-sans">
                {generatedMessage}
              </div>

              <div className="mt-2 text-[10px] text-emerald-400/80 font-sans leading-tight">
                💡 Clique em "Copiar Texto" ou "Enviar no WhatsApp" para encaminhar a mensagem com a quantidade necessária ao fornecedor.
              </div>
            </div>

          </div>

          {/* Observations Box */}
          <div className="bg-white p-3 border border-slate-200 shadow-xs">
            <label className="block text-[10px] font-bold text-slate-600 uppercase tracking-wider mb-1">
              Observações Adicionais para o Pedido
            </label>
            <input
              type="text"
              placeholder="Ex: Favor confirmar faturamento hoje / Entrega na filial"
              value={orderNotes}
              onChange={(e) => setOrderNotes(e.target.value)}
              className="w-full bg-slate-50 border border-slate-300 px-2.5 py-1.5 text-xs text-slate-800 focus:outline-none focus:border-emerald-600 focus:bg-white"
            />
          </div>

        </div>

        {/* Modal Footer Actions */}
        <div className="p-4 bg-white border-t border-slate-200 flex flex-col sm:flex-row items-center justify-between gap-3">
          <div className="text-xs font-medium text-slate-600">
            <span className="font-bold text-slate-800">{activeItems.length}</span> itens marcados para envio.
          </div>

          <div className="flex items-center space-x-2.5 w-full sm:w-auto">
            <button
              type="button"
              onClick={handleSaveOrder}
              disabled={saving || saved || activeItems.length === 0}
              className={`flex-1 sm:flex-none py-2 px-4 border font-bold text-xs uppercase tracking-wider transition-all flex items-center justify-center space-x-2 cursor-pointer shadow-sm disabled:opacity-50 disabled:cursor-not-allowed ${
                saved
                  ? "bg-emerald-600 text-white border-emerald-600"
                  : "bg-white hover:bg-emerald-50 text-emerald-800 border-emerald-300"
              }`}
            >
              {saving ? (
                <>
                  <Loader2 className="w-4 h-4 animate-spin" />
                  <span>Salvando...</span>
                </>
              ) : saved ? (
                <>
                  <Check className="w-4 h-4 text-white" />
                  <span>Pedido Salvo!</span>
                </>
              ) : (
                <>
                  <Save className="w-4 h-4 text-emerald-600" />
                  <span>Salvar Pedido</span>
                </>
              )}
            </button>

            <button
              type="button"
              onClick={handleCopy}
              className={`flex-1 sm:flex-none py-2 px-4 border font-bold text-xs uppercase tracking-wider transition-all flex items-center justify-center space-x-2 cursor-pointer shadow-sm ${
                copied
                  ? "bg-emerald-600 text-white border-emerald-600"
                  : "bg-slate-100 hover:bg-slate-200 text-slate-800 border-slate-300"
              }`}
            >
              {copied ? (
                <>
                  <Check className="w-4 h-4 text-white" />
                  <span>Copiado com Sucesso!</span>
                </>
              ) : (
                <>
                  <Copy className="w-4 h-4 text-slate-600" />
                  <span>Copiar Texto do Pedido</span>
                </>
              )}
            </button>

            <button
              type="button"
              onClick={handleOpenWhatsApp}
              className="flex-1 sm:flex-none py-2 px-5 bg-emerald-600 hover:bg-emerald-700 text-white font-extrabold text-xs uppercase tracking-wider border border-emerald-600 transition-all flex items-center justify-center space-x-2 cursor-pointer shadow-md"
            >
              <Send className="w-4 h-4" />
              <span>Enviar via WhatsApp</span>
              <ExternalLink className="w-3.5 h-3.5 opacity-80" />
            </button>
          </div>
        </div>

      </div>
    </div>
  );
};
