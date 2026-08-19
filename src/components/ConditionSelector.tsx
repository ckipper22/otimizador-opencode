import React, { useState, useEffect } from "react";
import { Tag, AlertTriangle, Sparkles, RefreshCw, Loader2 } from "lucide-react";
import { SwapReportItem } from "../types";

type Alternative = NonNullable<SwapReportItem["alternatives"]>[number];

interface ConditionSelectorProps {
  item: SwapReportItem;
  onSelectCondition?: (codInterno: string, selectedAlt: Alternative) => void;
  /** Compacto: usado dentro do Painel de Escolhas (linhas mais estreitas) */
  compact?: boolean;
  /** Configuração para buscar alternativas em tempo real */
  config?: { token?: string; cnpj?: string; useTestUrl?: boolean };
}

/**
 * Seletor de Condição de Compra / Substituição de Laboratório.
 * Extraído da tabela agrupada por distribuidora para reuso no
 * "Painel de Escolhas & Revisão de Substituições".
 *
 * Regra de negócio preservada: só lista alternativas com distribuidora real
 * (exclui "Não Encontrados" / "Sem Estoque") e com estoque > 0.
 */
export function ConditionSelector({ item, onSelectCondition, compact = false, config }: ConditionSelectorProps) {
  const [liveAlternatives, setLiveAlternatives] = useState<Alternative[] | null>(null);
  const [isLoading, setIsLoading] = useState(false);

  // Log de diagnóstico: o que o componente recebeu
  useEffect(() => {
    const altsCount = item.alternatives?.length ?? 0;
    const ean = item.isRupturaSubstitution ? item.novoEan : (item.originalEan || item.novoEan || "=?");
    const desc = (item.isRupturaSubstitution ? item.novaDescricao : (item.originalDescricao || item.novaDescricao || "")).substring(0, 40);
    console.log(`[CONDITION-SELECTOR] EAN=${ean} "${desc}" | isRuptura=${item.isRupturaSubstitution} | item.alternatives=${altsCount} | liveAlternatives=${liveAlternatives?.length ?? "null"} | vai-buscar-tempo-real? ${altsCount === 0 && !!config?.token}`);
  }, [item.alternatives, item.originalEan, item.originalDescricao, item.isRupturaSubstitution, item.novoEan, item.novaDescricao, liveAlternatives, config]);

  // Buscar alternativas em tempo real se o array estiver vazio OU se for ruptura
  useEffect(() => {
    const altsCount = item.alternatives?.length ?? 0;
    const isRuptura = item.isRupturaSubstitution;
    const isManualOrEncomenda = item.origem === "encomenda" || item.origem === "manual";
    
    console.log(`[CONDITION-SELECTOR-DEBUG] EAN=${item.originalEan} | isRuptura=${isRuptura} | altsCount=${altsCount} | liveAlts=${liveAlternatives?.length ?? 'null'} | config=${!!config?.token} | origem=${item.origem}`);

    // Se já tem alternativas (do backend), não buscar em tempo real
    if (altsCount > 0) {
      console.log(`[CONDITION-SELECTOR-DEBUG] PULANDO busca: já tem ${altsCount} alternativas do backend`);
      return;
    }
    // Itens manuais/encomenda nunca buscam em tempo real - já vieram com a oferta escolhida
    if (isManualOrEncomenda) {
      console.log(`[CONDITION-SELECTOR-DEBUG] PULANDO busca: item manual/encomenda (origem=${item.origem})`);
      return;
    }
    if (!config?.token || !config?.cnpj) {
      console.log(`[CONDITION-SELECTOR-DEBUG] PULANDO busca: sem config (token=${!!config?.token}, cnpj=${!!config?.cnpj})`);
      return;
    }
    if (liveAlternatives !== null) {
      console.log(`[CONDITION-SELECTOR-DEBUG] PULANDO busca: já buscou (liveAlts=${liveAlternatives.length})`);
      return;
    }

    // Quando é ruptura, usar o EAN do substituto (novoEan) para buscar alternativas
    const searchEan = isRuptura ? item.novoEan : item.originalEan;
    const searchDesc = isRuptura ? item.novaDescricao : item.originalDescricao;

    console.log(`[CONDITION-SELECTOR-DEBUG] INICIANDO busca: EAN=${searchEan} | DESC="${searchDesc}" | isRuptura=${isRuptura}`);

    const fetchAlternatives = async () => {
      setIsLoading(true);
      try {
        const requestBody = {
          ean: searchEan,
          descricao: searchDesc,
          token: config.token,
          cnpj: config.cnpj,
          useTestUrl: config.useTestUrl
        };
        console.log(`[CONDITION-SELECTOR-DEBUG] Enviando para /api/smartped-find-substitutes:`, JSON.stringify(requestBody, null, 2));
        
        const response = await fetch("/api/smartped-find-substitutes", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify(requestBody)
        });
        const data = await response.json();
        
        console.log(`[CONDITION-SELECTOR-DEBUG] RESPOSTA: response.ok=${response.ok} | alternatives=${data?.alternatives?.length ?? 0} | logs=${JSON.stringify(data?.logs)}`);
        
        if (response.ok && data.alternatives) {
          console.log(`[CONDITION-SELECTOR-DEBUG] SUCESSO: ${data.alternatives.length} alternativas recebidas`);
          data.alternatives.forEach((alt: any, i: number) => {
            console.log(`[CONDITION-SELECTOR-DEBUG]   ${i+1}. ${alt.distribuidora} | EAN:${alt.ean} | preco:${alt.preco} | estoque:${alt.estoque}`);
          });
          
          setLiveAlternatives(data.alternatives);
        } else {
          console.log(`[CONDITION-SELECTOR-DEBUG] FALHA: response.ok=${response.ok} | data=${JSON.stringify(data)}`);
          setLiveAlternatives([]);
        }
      } catch (err) {
        console.log(`[CONDITION-SELECTOR-DEBUG] ERRO:`, err);
        setLiveAlternatives([]);
      } finally {
        setIsLoading(false);
      }
    };

    fetchAlternatives();
  }, [item.alternatives, item.originalEan, item.originalDescricao, item.isRupturaSubstitution, item.novoEan, item.novaDescricao, config, liveAlternatives]);

  const cleanEanLocal = (e: string) => {
    if (!e) return "";
    const cleaned = String(e).trim().replace(/\D/g, "");
    if (!cleaned) return "";
    if (cleaned.length <= 13) return cleaned.padStart(13, "0");
    return cleaned;
  };

  const getAlt = (alt: Alternative) => {
    const a = alt as any;
    return {
      ean: alt.ean || a.Ean || a.ean || "",
      distribuidora: alt.distribuidora || a.NomeDist || a.nomeDist || "",
      condicao: alt.condicao || a.Condicao || a.condicao || "FIXA",
      preco: Number(alt.preco ?? a.Pliquido ?? a.precoLiquido ?? a.preco ?? 0),
      prazo: Number(alt.prazo ?? a.Prazo ?? a.prazo ?? 0),
      qtdMin: Number(alt.qtdMin ?? a.QtdMin ?? a.qtdMin ?? 0),
      laboratorio: alt.laboratorio || a.Laboratorio || a.laboratorio || "",
      descricao: alt.descricao || a.Descricao || a.descricao || "",
      codDist: Number(alt.codDist ?? a.CodDist ?? a.codDist ?? 0),
      estoque: Number(alt.estoque ?? a.Estoque ?? a.estoque ?? 0),
    };
  };

  const alternatives = item.alternatives && item.alternatives.length > 0 ? item.alternatives : (liveAlternatives || []);

  // Log final: quantas alternativas vão pro dropdown
  useEffect(() => {
    if (alternatives.length > 0) {
      const validCount = alternatives.filter(isValidAlt).length;
      const ean = item.isRupturaSubstitution ? item.novoEan : item.originalEan;
      console.log(`[CONDITION-SELECTOR] DROPDOWN EAN=${ean} | total=${alternatives.length} | válidas=${validCount} | fonte=${item.alternatives?.length > 0 ? "backend" : "live-fetch"}`);
    }
  }, [alternatives, item.originalEan, item.isRupturaSubstitution, item.novoEan]);

  // Se está carregando, mostrar loading
  if (isLoading) {
    return (
      <div className={`${compact ? "mt-2 p-2" : "mt-3.5 p-3"} bg-gray-50 border border-gray-200 rounded-sm font-sans`}>
        <div className="flex items-center gap-1.5 text-[10px] text-gray-500 font-bold uppercase tracking-wider">
          <Loader2 className="w-3.5 h-3.5 text-gray-400 animate-spin shrink-0" />
          <span>Buscando opções...</span>
        </div>
      </div>
    );
  }

  // Se não há alternativas, mostrar mensagem informativa
  if (alternatives.length === 0) {
    return (
      <div className={`${compact ? "mt-2 p-2" : "mt-3.5 p-3"} bg-gray-50 border border-gray-200 rounded-sm font-sans`}>
        <div className="flex items-center gap-1.5 text-[10px] text-gray-500 font-bold uppercase tracking-wider">
          <Tag className="w-3.5 h-3.5 text-gray-400 shrink-0" />
          <span>Sem opções alternativas disponíveis</span>
        </div>
      </div>
    );
  }

  const itemQtd = item.qtd;
  const qtdMinAlerta = !!(item.qtdMin && item.qtdMin > 0 && itemQtd < item.qtdMin);

  const isValidAlt = (alt: Alternative) => {
    const altAny = alt as any;
    const dist = String(alt.distribuidora || altAny.NomeDist || altAny.nomeDist || "").trim().toUpperCase();
    if (
      !alt.distribuidora ||
      dist.includes("NÃO ENCONTRADOS") ||
      dist.includes("NAO ENCONTRADOS") ||
      dist.includes("NÃO ENCONTRADO") ||
      dist.includes("NAO ENCONTRADO") ||
      dist.includes("SEM ESTOQUE") ||
      dist.includes("NAO ENCONTR") ||
      dist.includes("NÃO ENCONTR") ||
      dist.includes("ENCONTRADO") ||
      dist === "0" ||
      dist === "" ||
      dist === "DISTRIBUIDOR"
    ) {
      if (isCurrentAlt(alt)) return true;
      return false;
    }
    const stock = Number(alt.estoque ?? 0);
    return stock > 0;
  };

  const normalizeStr = (s: string) => (s || "").trim().toUpperCase();
  const isCurrentAlt = (alt: Alternative) => {
    const altAny = alt as any;
    const altEan = alt.ean || altAny.Ean || "";
    if (cleanEanLocal(altEan) !== cleanEanLocal(item.novoEan)) return false;

    // Match por codDist (mais confiável que nome)
    const altCodDist = Number(alt.codDist ?? altAny.CodDist ?? altAny.codDist ?? 0);
    const itemCodDist = Number((item as any).codDist ?? 0);
    const precoDiff = Math.abs(Number(alt.preco ?? altAny.Pliquido ?? altAny.precoLiquido ?? 0) - Number(item.novoPreco ?? 0));

    if (altCodDist > 0 && itemCodDist > 0) {
      return altCodDist === itemCodDist && precoDiff < 0.10;
    }

    // Fallback: match por nome normalizado
    const altDist = normalizeStr(alt.distribuidora || altAny.NomeDist || altAny.nomeDist || "");
    const itemDist = normalizeStr(item.distribuidora || "");
    return altDist === itemDist && precoDiff < 0.10;
  };

  const validAlts = alternatives.filter(isValidAlt);
  const otherValidAlts = validAlts.filter((alt) => !isCurrentAlt(alt));
  if (otherValidAlts.length === 0) return null;

  const sameProductAlts = validAlts.filter((alt) => {
    const a = alt as any;
    return cleanEanLocal(alt.ean || a.Ean || "") === cleanEanLocal(item.originalEan);
  });
  const otherProductAlts = validAlts.filter((alt) => {
    const a = alt as any;
    return cleanEanLocal(alt.ean || a.Ean || "") !== cleanEanLocal(item.originalEan);
  });

  const cheapestSameProductNoMinAlt = (() => {
    const sameNoMin = validAlts.filter((alt) => {
      const a = alt as any;
      return cleanEanLocal(alt.ean || a.Ean || "") === cleanEanLocal(item.originalEan) && (!(alt.qtdMin ?? a.QtdMin ?? 0) || (alt.qtdMin ?? a.QtdMin ?? 0) <= 0);
    });
    if (sameNoMin.length === 0) return null;
    const cheapest = [...sameNoMin].sort((a, b) => (a.preco ?? (a as any).Pliquido ?? 0) - (b.preco ?? (b as any).Pliquido ?? 0))[0];
    if (isCurrentAlt(cheapest)) return null;
    const currentHasMin = !!(item.qtdMin && item.qtdMin > 0);
    if (currentHasMin || cheapest.preco < item.novoPreco - 0.01) return cheapest;
    return null;
  })();

  const cheapestOtherItemAlt = (() => {
    if (otherProductAlts.length === 0) return null;
    const cheapest = [...otherProductAlts].sort((a, b) => (a.preco ?? (a as any).Pliquido ?? 0) - (b.preco ?? (b as any).Pliquido ?? 0))[0];
    if (isCurrentAlt(cheapest)) return null;
    if (cheapest.preco < item.novoPreco - 0.01) return cheapest;
    return null;
  })();

  const showSameProductNoMinQuickAction =
    !!cheapestSameProductNoMinAlt && (qtdMinAlerta || cheapestSameProductNoMinAlt.preco < item.novoPreco - 0.01);
  const showOtherProductQuickAction = !!cheapestOtherItemAlt && cheapestOtherItemAlt.preco < item.novoPreco - 0.01;

  const currentIndex = alternatives.findIndex(isCurrentAlt);

  const handleChange = (e: React.ChangeEvent<HTMLSelectElement>) => {
    const idx = parseInt(e.target.value, 10);
    const selected = alternatives[idx];
    if (selected && onSelectCondition) {
      onSelectCondition(item.codInterno, selected);
    }
  };

  return (
    <div
      className={`${compact ? "mt-2 p-2" : "mt-3.5 p-3"} bg-gray-50 border border-gray-200 rounded-sm flex flex-col gap-2 font-sans`}
      onClick={(e) => e.stopPropagation()}
    >
      <div className="flex items-center gap-1.5 text-[10px] text-gray-700 font-extrabold uppercase tracking-wider">
        <Tag className="w-3.5 h-3.5 text-gray-500 shrink-0" />
        <span>Opções de Compra &amp; Substituição de Laboratório</span>
      </div>

      {/* Badge da condição atual (sempre visível) */}
      <div className="flex items-center gap-2 p-2 bg-blue-50 border border-blue-300 rounded-sm text-[10px]">
        <span className="font-black text-blue-800 uppercase tracking-wider">★ Atual:</span>
        <span className="font-bold text-blue-900">
          [{item.distribuidora || "Distribuidor"}] {item.novoPreco > 0 ? `R$ ${item.novoPreco.toFixed(2).replace(".", ",")}` : ""}
          {item.condicao ? ` | ${item.condicao}` : ""}{item.prazo ? ` | ${item.prazo}d` : ""}
        </span>
        <span className="text-blue-600 font-mono">EAN: {item.novoEan}</span>
      </div>

      <div className="flex flex-col gap-1">
        <label className="text-[9px] text-gray-500 font-bold uppercase">
          Trocar para outra condição/laboratório:
        </label>
        <select
          value={currentIndex}
          onChange={handleChange}
          className="w-full bg-white border border-gray-300 text-[10px] font-bold text-gray-800 rounded-sm px-2 py-1 focus:ring-1 focus:ring-blue-500 focus:outline-none cursor-pointer"
        >
          {currentIndex === -1 && (
            <option value={-1} disabled>
              Selecione uma condição alternativa...
            </option>
          )}

          {sameProductAlts.length > 0 && (
            <optgroup label="📋 CONDIÇÃO DE COMPRA (Mesmo Medicamento / Mesma Marca)">
              {sameProductAlts.map((alt) => {
                const altIdx = alternatives.indexOf(alt);
                const g = getAlt(alt);
                return (
                  <option key={altIdx} value={altIdx}>
                    [{g.distribuidora || "Distribuidor"}]{" "}
                    {g.qtdMin > 0 ? `⚠️[MÍN:${g.qtdMin}un] ` : ""}{g.condicao} (R$ {g.preco.toFixed(2).replace(".", ",")}){" "}
                    {g.prazo > 0 ? `| ${g.prazo}d` : "| Vista"}
                  </option>
                );
              })}
            </optgroup>
          )}

          {otherProductAlts.length > 0 && (
            <optgroup label="🔬 SUBSTITUIÇÃO (Outro Laboratório / Outro Fabricante)">
              {otherProductAlts.map((alt) => {
                const altIdx = alternatives.indexOf(alt);
                const g = getAlt(alt);
                return (
                  <option key={altIdx} value={altIdx}>
                    [{g.laboratorio || "GENÉRICO"}] {g.descricao.substring(0, 30)}... |{" "}
                    {g.qtdMin > 0 ? `⚠️ [MÍN: ${g.qtdMin}un]` : "✅ [SEM MÍNIMO]"} {g.distribuidora} (R${" "}
                    {g.preco.toFixed(2).replace(".", ",")})
                  </option>
                );
              })}
            </optgroup>
          )}
        </select>
      </div>

      {(showSameProductNoMinQuickAction || showOtherProductQuickAction) && (
        <div className="flex flex-col gap-1.5 pt-2 border-t border-dashed border-gray-200">
          <span className="text-[9px] text-gray-500 font-bold uppercase">Ações Rápidas Recomendadas:</span>

          {showSameProductNoMinQuickAction && cheapestSameProductNoMinAlt && (
            <button
              onClick={() => onSelectCondition?.(item.codInterno, cheapestSameProductNoMinAlt)}
              className={`flex flex-col text-left w-full p-2 rounded-sm border transition-all cursor-pointer ${
                qtdMinAlerta
                  ? "bg-red-50 hover:bg-red-100 border-red-300 text-red-950"
                  : "bg-emerald-50 hover:bg-emerald-100 border-emerald-300 text-emerald-950"
              }`}
              title={`Clique para escolher a condição sem quantidade mínima: R$ ${Number(
                cheapestSameProductNoMinAlt.preco || 0
              ).toFixed(2)}`}
            >
              <div className="flex items-center gap-1 font-black text-[9px] uppercase tracking-wide">
                {qtdMinAlerta ? (
                  <>
                    <AlertTriangle className="w-3.5 h-3.5 text-red-600 animate-bounce shrink-0" />
                    <span className="text-red-700 font-extrabold">⚡ RESOLVER ALERTA DE MÍNIMO COMERCIAL:</span>
                  </>
                ) : (
                  <>
                    <Sparkles className="w-3.5 h-3.5 text-emerald-600 shrink-0" />
                    <span className="text-emerald-700 font-extrabold">⚡ MELHOR PREÇO SEM MÍNIMO (MESMO PRODUTO):</span>
                  </>
                )}
              </div>
              <div className="text-[10px] mt-0.5 leading-tight font-medium">
                Trocar para o <strong>mesmo produto</strong> fornecido por{" "}
                <strong className="underline">{cheapestSameProductNoMinAlt.distribuidora || "Distribuidor"}</strong> sem
                exigência de quantidade mínima comercial.
              </div>
              <div className="text-[9.5px] mt-1 text-gray-600 font-mono flex justify-between w-full">
                <span>
                  Preço Unitário:{" "}
                  <strong>R$ {Number(cheapestSameProductNoMinAlt.preco || 0).toFixed(2).replace(".", ",")}</strong>
                </span>
                {Number(cheapestSameProductNoMinAlt.preco || 0) < item.novoPreco && (
                  <span className="text-emerald-700 font-bold">
                    {" "}
                    Economia: R${" "}
                    {(item.novoPreco - Number(cheapestSameProductNoMinAlt.preco || 0)).toFixed(2).replace(".", ",")} / un
                  </span>
                )}
              </div>
            </button>
          )}

          {showOtherProductQuickAction && cheapestOtherItemAlt && (
            <button
              onClick={() => onSelectCondition?.(item.codInterno, cheapestOtherItemAlt)}
              className="flex flex-col text-left w-full p-2 bg-blue-50 hover:bg-blue-100 border border-blue-300 text-blue-950 rounded-sm transition-all cursor-pointer"
              title={`Clique para trocar para o substituto mais barato: ${
                cheapestOtherItemAlt.descricao || ""
              } - R$ ${Number(cheapestOtherItemAlt.preco || 0).toFixed(2)}`}
            >
              <div className="flex items-center gap-1 font-black text-[9px] uppercase tracking-wide text-blue-800">
                <RefreshCw className="w-3.5 h-3.5 text-blue-600 shrink-0" />
                <span>🔬 SUBSTITUIR POR OUTRO LABORATÓRIO MAIS BARATO:</span>
              </div>
              <div className="text-[10px] mt-0.5 leading-tight font-medium">
                Mudar para o fabricante <strong>{cheapestOtherItemAlt.laboratorio || "GENÉRICO"}</strong> (
                {(cheapestOtherItemAlt.descricao || "").substring(0, 32)}...) fornecido por{" "}
                <strong className="underline">{cheapestOtherItemAlt.distribuidora || "Distribuidor"}</strong>.
              </div>
              <div className="text-[9.5px] mt-1 text-gray-600 font-mono flex justify-between w-full">
                <span>
                  Preço Unitário:{" "}
                  <strong>R$ {Number(cheapestOtherItemAlt.preco || 0).toFixed(2).replace(".", ",")}</strong>
                </span>
                <span className="text-emerald-700 font-bold">
                  Economia: R$ {(item.novoPreco - Number(cheapestOtherItemAlt.preco || 0)).toFixed(2).replace(".", ",")}{" "}
                  / un
                </span>
              </div>
            </button>
          )}
        </div>
      )}
    </div>
  );
}
