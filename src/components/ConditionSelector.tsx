import React from "react";
import { Tag, AlertTriangle, Sparkles, RefreshCw } from "lucide-react";
import { SwapReportItem } from "../types";

type Alternative = NonNullable<SwapReportItem["alternatives"]>[number];

interface ConditionSelectorProps {
  item: SwapReportItem;
  onSelectCondition?: (codInterno: string, selectedAlt: Alternative) => void;
  /** Compacto: usado dentro do Painel de Escolhas (linhas mais estreitas) */
  compact?: boolean;
}

/**
 * Seletor de Condição de Compra / Substituição de Laboratório.
 * Extraído da tabela agrupada por distribuidora para reuso no
 * "Painel de Escolhas & Revisão de Substituições".
 *
 * Regra de negócio preservada: só lista alternativas com distribuidora real
 * (exclui "Não Encontrados" / "Sem Estoque") e com estoque > 0.
 */
export function ConditionSelector({ item, onSelectCondition, compact = false }: ConditionSelectorProps) {
  const alternatives = item.alternatives;
  if (!alternatives || alternatives.length === 0) return null;

  const itemQtd = item.qtd;
  const qtdMinAlerta = !!(item.qtdMin && item.qtdMin > 0 && itemQtd < item.qtdMin);

  const isValidAlt = (alt: Alternative) => {
    const dist = String(alt.distribuidora || "").trim().toUpperCase();
    if (
      !alt.distribuidora ||
      dist.includes("NÃO ENCONTRADOS") ||
      dist.includes("NAO ENCONTRADOS") ||
      dist.includes("NÃO ENCONTRADO") ||
      dist.includes("NAO ENCONTRADO") ||
      dist.includes("SEM ESTOQUE")
    ) {
      return false;
    }
    return Number(alt.estoque ?? 0) > 0;
  };

  const isCurrentAlt = (alt: Alternative) =>
    alt.ean === item.novoEan &&
    alt.distribuidora === item.distribuidora &&
    alt.condicao === item.condicao &&
    Math.abs(alt.preco - item.novoPreco) < 0.001 &&
    alt.prazo === item.prazo;

  const validAlts = alternatives.filter(isValidAlt);
  const otherValidAlts = validAlts.filter((alt) => !isCurrentAlt(alt));
  if (otherValidAlts.length === 0) return null;

  const sameProductAlts = validAlts.filter((alt) => alt.ean === item.originalEan);
  const otherProductAlts = validAlts.filter((alt) => alt.ean !== item.originalEan);

  const cheapestSameProductNoMinAlt = (() => {
    const sameNoMin = validAlts.filter((alt) => alt.ean === item.originalEan && (!alt.qtdMin || alt.qtdMin <= 0));
    if (sameNoMin.length === 0) return null;
    const cheapest = [...sameNoMin].sort((a, b) => a.preco - b.preco)[0];
    if (isCurrentAlt(cheapest)) return null;
    const currentHasMin = !!(item.qtdMin && item.qtdMin > 0);
    if (currentHasMin || cheapest.preco < item.novoPreco - 0.01) return cheapest;
    return null;
  })();

  const cheapestOtherItemAlt = (() => {
    if (otherProductAlts.length === 0) return null;
    const cheapest = [...otherProductAlts].sort((a, b) => a.preco - b.preco)[0];
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

      <div className="flex flex-col gap-1">
        <label className="text-[9px] text-gray-500 font-bold uppercase">
          Selecione a condição ou laboratório desejado:
        </label>
        <select
          value={currentIndex}
          onChange={handleChange}
          className="w-full bg-white border border-gray-300 text-[10px] font-bold text-gray-800 rounded-sm px-2 py-1 focus:ring-1 focus:ring-blue-500 focus:outline-none cursor-pointer"
        >
          {currentIndex === -1 && (
            <option value={-1} disabled>
              Selecione uma condição...
            </option>
          )}

          {sameProductAlts.length > 0 && (
            <optgroup label="📋 CONDIÇÃO DE COMPRA (Mesmo Medicamento / Mesma Marca)">
              {sameProductAlts.map((alt) => {
                const altIdx = alternatives.indexOf(alt);
                return (
                  <option key={altIdx} value={altIdx}>
                    {alt.qtdMin > 0 ? `⚠️ [MÍN: ${alt.qtdMin}un]` : "✅ [SEM MÍNIMO]"} {alt.distribuidora} -{" "}
                    {alt.condicao} (R$ {alt.preco.toFixed(2).replace(".", ",")}){" "}
                    {alt.prazo > 0 ? `| ${alt.prazo}d` : "| Vista"}
                    {isCurrentAlt(alt) ? " (Atual) ★" : ""}
                  </option>
                );
              })}
            </optgroup>
          )}

          {otherProductAlts.length > 0 && (
            <optgroup label="🔬 SUBSTITUIÇÃO (Outro Laboratório / Outro Fabricante)">
              {otherProductAlts.map((alt) => {
                const altIdx = alternatives.indexOf(alt);
                const altDesc = alt.descricao || "";
                return (
                  <option key={altIdx} value={altIdx}>
                    [{alt.laboratorio || "GENÉRICO"}] {altDesc.substring(0, 30)}... |{" "}
                    {alt.qtdMin > 0 ? `⚠️ [MÍN: ${alt.qtdMin}un]` : "✅ [SEM MÍNIMO]"} {alt.distribuidora} (R${" "}
                    {Number(alt.preco ?? 0).toFixed(2).replace(".", ",")}){isCurrentAlt(alt) ? " (Atual) ★" : ""}
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
