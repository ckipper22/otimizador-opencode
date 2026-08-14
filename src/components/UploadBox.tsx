import React, { useRef, useState } from "react";
import { Upload, FileText, Trash2, CheckCircle, Sparkles, RefreshCw, AlertTriangle, Clipboard, FileDown } from "lucide-react";
import { SAMPLE_SICF_FILE } from "../utils";
import { DistributorOption } from "../types";

interface UploadBoxProps {
  fileContent: string;
  fileName: string;
  onFileLoaded: (content: string, name: string) => void;
  onClearFile: () => void;
  onOptimize?: () => void;
  isLoading?: boolean;
  distributors?: DistributorOption[];
  disabledDistributors?: Set<number>;
  onToggleDistributor?: (codigo: number) => void;
  isLoadingDistributors?: boolean;
  cnpj?: string;
  onImportDirectReport?: (injectedReport: any[], virtualFileContent: string, detectedCnpj?: string) => void;
  onImportPreDistributed?: (preDistributedMap: Record<string, { codDist: number, condicao: string, prazo: number, codProdutoDist: string, quant: number }>, virtualFileContent: string, detectedCnpj?: string) => void;
}

export default function UploadBox({
  fileContent,
  fileName,
  onFileLoaded,
  onClearFile,
  onOptimize,
  isLoading,
  distributors = [],
  disabledDistributors = new Set(),
  onToggleDistributor,
  isLoadingDistributors,
  cnpj,
  onImportDirectReport,
  onImportPreDistributed
}: UploadBoxProps) {
  const fileInputRef = useRef<HTMLInputElement>(null);
  const [isDragging, setIsDragging] = useState(false);
  
  // Estados para o Modal de Importação Rápida
  const [isImportModalOpen, setIsImportModalOpen] = useState(false);
  const [importText, setImportText] = useState("");
  const [importError, setImportError] = useState("");

  const handleFileChange = (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    if (!file) return;

    const reader = new FileReader();
    reader.onload = (event) => {
      const text = event.target?.result as string;
      onFileLoaded(text, file.name);
    };
    reader.readAsText(file, "latin1"); // SICF is typically Latin-1/ISO-8859-1
  };

  const onDragOver = (e: React.DragEvent) => {
    e.preventDefault();
    setIsDragging(true);
  };

  const onDragLeave = () => {
    setIsDragging(false);
  };

  const onDrop = (e: React.DragEvent) => {
    e.preventDefault();
    setIsDragging(false);
    const file = e.dataTransfer.files?.[0];
    if (!file) return;

    const reader = new FileReader();
    reader.onload = (event) => {
      const text = event.target?.result as string;
      onFileLoaded(text, file.name);
    };
    reader.readAsText(file, "latin1");
  };

  const loadSample = () => {
    onFileLoaded(SAMPLE_SICF_FILE, "pedido_exemplo_smartped.txt");
  };

  // Algoritmo de parsing resiliente de payload ou lista de EANs
  const handleImportSubmit = () => {
    if (!importText.trim()) {
      setImportError("Por favor, cole um JSON ou log válido contendo itens.");
      return;
    }

    try {
      let items: any[] = [];
      let detectedCnpjFromImport = "";
      
      let jsonText = importText.trim();
      const startIdx = jsonText.indexOf('{');
      const endIdx = jsonText.lastIndexOf('}');
      const arrayStartIdx = jsonText.indexOf('[');
      const arrayEndIdx = jsonText.lastIndexOf(']');

      let parsedObj: any = null;

      // Se parece conter um JSON ou Array
      if ((startIdx !== -1 && endIdx !== -1 && endIdx > startIdx) || (arrayStartIdx !== -1 && arrayEndIdx !== -1 && arrayEndIdx > arrayStartIdx)) {
        try {
          const isObjectFirst = startIdx !== -1 && (arrayStartIdx === -1 || startIdx < arrayStartIdx);
          const targetText = isObjectFirst 
            ? jsonText.substring(startIdx, endIdx + 1)
            : jsonText.substring(arrayStartIdx, arrayEndIdx + 1);

          parsedObj = JSON.parse(targetText);
        } catch (e) {
          try {
            parsedObj = JSON.parse(jsonText);
          } catch (e2) {
            // Segue para Regex
          }
        }
      }

      if (parsedObj) {
        const findItensArray = (obj: any): any[] | null => {
          if (!obj || typeof obj !== "object") return null;
          if (Array.isArray(obj)) {
            const hasEan = obj.some(item => item && (item.Ean || item.ean || item.EAN));
            if (hasEan) return obj;
          }
          if (obj.CnpjCLi || obj.cnpjCli || obj.cnpj || obj.CnpjLoja || obj.CnpjCli) {
            detectedCnpjFromImport = String(obj.CnpjCLi || obj.cnpjCli || obj.cnpj || obj.CnpjLoja || obj.CnpjCli);
          }
          for (const key of Object.keys(obj)) {
            const val = obj[key];
            if (val && typeof val === "object") {
              const found = findItensArray(val);
              if (found) return found;
            }
          }
          return null;
        };

        const foundItems = findItensArray(parsedObj);
        if (foundItems && foundItems.length > 0) {
          items = foundItems;
        }
      }

      // Se falhar ou não achar itens por JSON, usar Regex inteligente linha por linha
      if (items.length === 0) {
        const lines = importText.split("\n");
        const regexAnyEan = /\b\d{13}\b/; // qualquer número de 13 dígitos
        
        for (const line of lines) {
          const matchEan = line.match(regexAnyEan);
          if (matchEan) {
            const ean = matchEan[0];
            let qtd = 1;
            const matchQtd = line.match(/"(?:Quant|quant|qtd|Qtd|QuantFaturada|QuantSolicitada|quantidade|quantity|Quant)"\s*:\s*([0-9.]+)/i);
            if (matchQtd) {
              qtd = parseFloat(matchQtd[1]) || 1;
            } else {
              const cleanLine = line.replace(ean, "");
              const matchNum = cleanLine.match(/[\s;,=](\d+)(?:\D|$)/);
              if (matchNum) {
                qtd = parseInt(matchNum[1]) || 1;
              }
            }
            if (!items.some(it => String(it.Ean || it.ean || "") === ean)) {
              items.push({ Ean: ean, Quant: qtd });
            }
          }
        }
      }

      const cleanEanString = (ean: any): string => {
        if (ean === undefined || ean === null) return "";
        const cleaned = String(ean).trim().replace(/\D/g, "");
        if (!cleaned) return "";
        if (cleaned.length <= 13) {
          return cleaned.padStart(13, "0");
        }
        return cleaned;
      };

      if (items.length === 0) {
        throw new Error("Não conseguimos extrair nenhum EAN de 13 dígitos ou array de itens do texto fornecido.");
      }

      const finalCnpj = (detectedCnpjFromImport || cnpj || "13408443000168").replace(/\D/g, "");

      // Verificar se algum dos itens analisados possui dados comerciais de distribuidora e faturamento
      const hasDistributionData = items.some(it => 
        it.distribuidora || it.Distribuidora || it.codDist || it.CodDist || 
        it.condicao || it.Condicao || it.prazo || it.Prazo || it.NomeDist || it.nomeDist ||
        it.novoPreco || it.NovoPreco || it.precoLiquido || it.PrecoLiquido || it.preco || it.Preco
      );

      if (hasDistributionData) {
        if (onImportPreDistributed) {
          const preDistributedMap: Record<string, { codDist: number, condicao: string, prazo: number, codProdutoDist: string, quant: number }> = {};
          
          items.forEach((it) => {
            const rawEan = cleanEanString(it.originalEan || it.Ean || it.ean || it.EAN || "");
            if (!rawEan) return;

            const qty = parseFloat(String(it.qtd || it.Quant || it.quant || it.quantidade || it.Qtd || 1)) || 1;
            const distCode = parseInt(String(it.codDist || it.CodDist || 0)) || 0;
            const cond = String(it.condicao || it.Condicao || "FIXA").trim();
            const prz = parseInt(String(it.prazo || it.Prazo || 0)) || 0;
            const codProdDist = String(it.codProdutoDist || it.CodProdutoDist || it.codProduto || it.CodProduto || "").trim();

            preDistributedMap[rawEan] = {
              codDist: distCode,
              condicao: cond,
              prazo: prz,
              codProdutoDist: codProdDist,
              quant: qty
            };
          });

          // Gerar um arquivo SICF virtual compatível para fins de otimização de verdade das condições na SmartPed
          const header = `1;${finalCnpj};CLIENTE IMPORTADO;`;
          const sicfLines = [header];
          
          Object.entries(preDistributedMap).forEach(([ean, info]) => {
            sicfLines.push(`2;${ean};${info.quant};${info.codProdutoDist || "1000"};PRODUTO IMPORTADO;IMPORTADO;0`);
          });
          sicfLines.push(`9;1;`);
          const fileContentString = sicfLines.join("\r\n");

          onImportPreDistributed(preDistributedMap, fileContentString, finalCnpj);

          setIsImportModalOpen(false);
          setImportText("");
          setImportError("");
          return;
        }

        if (onImportDirectReport) {
          // Mapear os itens para a estrutura estrita de SwapReportItem (fallback offline)
          const mappedItems = items.map((it, idx) => {
            const rawEan = cleanEanString(it.originalEan || it.Ean || it.ean || it.EAN || "");
            const cleanNovoEan = cleanEanString(it.novoEan || it.NovoEan || rawEan);
            
            const qty = parseFloat(String(it.qtd || it.Quant || it.quant || it.quantidade || it.Qtd || 1)) || 1;
            
            const origPrice = parseFloat(String(it.originalPreco || it.OriginalPreco || it.precoOriginal || it.PrecoOriginal || it.Preco || it.preco || 0)) || 0;
            const newPrice = parseFloat(String(it.novoPreco || it.NovoPreco || it.precoLiquido || it.PrecoLiquido || it.Preco || it.preco || 0)) || 0;
            
            const dist = String(it.distribuidora || it.Distribuidora || it.NomeDist || it.nomeDist || "Sem Estoque").trim();
            const cond = String(it.condicao || it.Condicao || "FIXA").trim();
            const prz = parseInt(String(it.prazo || it.Prazo || 0)) || 0;
            const codDistNum = parseInt(String(it.codDist || it.CodDist || 0)) || 0;
            const codProdDist = String(it.codProdutoDist || it.CodProdutoDist || it.codProduto || it.CodProduto || "").trim();
            
            const origDesc = String(it.originalDescricao || it.OriginalDescricao || it.Descricao || it.descricao || `PRODUTO ${rawEan}`).replace(/;/g, " ").trim();
            const newDesc = String(it.novaDescricao || it.NovaDescricao || it.originalDescricao || it.Descricao || it.descricao || `PRODUTO ${cleanNovoEan}`).replace(/;/g, " ").trim();
            
            const origLab = String(it.originalLaboratorio || it.OriginalLaboratorio || it.Laboratorio || it.laboratorio || "IMPORTADO").replace(/;/g, " ").trim();
            const newLab = String(it.novoLaboratorio || it.NovoLaboratorio || it.originalLaboratorio || it.Laboratorio || it.laboratorio || "IMPORTADO").replace(/;/g, " ").trim();

            const codInt = String(it.codInterno || it.CodInterno || `IMP-${idx}-${Math.floor(1000 + Math.random() * 9000)}`);
            
            const ecoUnit = Math.max(0, origPrice - newPrice);
            const ecoTotal = ecoUnit * qty;

            const isShortageVal = it.isShortage || it.IsShortage || dist === "Sem Estoque" || dist === "Não Encontrados";

            return {
              codInterno: codInt,
              originalEan: rawEan,
              originalDescricao: origDesc,
              originalLaboratorio: origLab,
              originalPreco: origPrice,
              novoEan: cleanNovoEan,
              novaDescricao: newDesc,
              novoLaboratorio: newLab,
              novoPreco: newPrice,
              qtd: qty,
              economiaUnit: ecoUnit,
              economiaTotal: ecoTotal,
              distribuidora: dist,
              estoque: parseInt(String(it.estoque || it.Estoque || 9999)) || 9999,
              codDist: codDistNum,
              condicao: cond,
              codProdutoDist: codProdDist,
              prazo: prz,
              codProduto: String(it.codProduto || it.CodProduto || "").trim(),
              pedidoMinimo: parseFloat(String(it.pedidoMinimo || it.PedidoMinimo || 0)) || 0,
              isShortage: isShortageVal,
              originalPmc: parseFloat(String(it.originalPmc || it.OriginalPmc || 0)) || 0,
              novoPmc: parseFloat(String(it.novoPmc || it.NovoPmc || 0)) || 0,
              alternatives: Array.isArray(it.alternatives) ? it.alternatives : []
            };
          });

          // Gerar um arquivo SICF virtual compatível com esses itens para fins de regeneração/download caso necessário
          const header = `1;${finalCnpj};CLIENTE IMPORTADO;`;
          const sicfLines = [header];
          
          mappedItems.forEach((it) => {
            sicfLines.push(`2;${it.originalEan};${it.qtd};${it.codProdutoDist || "1000"};${it.originalDescricao};${it.originalLaboratorio};${it.originalPreco}`);
          });
          sicfLines.push(`9;1;`);
          const fileContentString = sicfLines.join("\r\n");

          onImportDirectReport(mappedItems, fileContentString, finalCnpj);

          setIsImportModalOpen(false);
          setImportText("");
          setImportError("");
          return;
        }
      }

      const header = `1;${finalCnpj};CLIENTE IMPORTADO;`;
      
      const sicfLines = [header];
      
      items.forEach((it, idx) => {
        const rawEan = cleanEanString(it.Ean || it.ean || it.EAN || "");
        const qtd = String(it.Quant || it.quant || it.qtd || it.Qtd || 1).trim();
        const codReduzido = String(it.CodProdutoDist || it.CodProduto || it.codProduto || idx + 1000).trim();
        const descricao = String(it.Descricao || it.descricao || `PRODUTO IMPORTADO ${rawEan}`).replace(/;/g, " ").trim();
        const laboratorio = String(it.Laboratorio || it.laboratorio || "IMPORTADO").replace(/;/g, " ").trim();
        const preco = String(it.Preco || it.preco || "10.00").replace(",", ".").trim();
        
        if (rawEan && rawEan.length >= 10) {
          sicfLines.push(`2;${rawEan};${qtd};${codReduzido};${descricao};${laboratorio};${preco}`);
        }
      });
      
      sicfLines.push(`9;1;`);
      
      const fileContentString = sicfLines.join("\r\n");
      onFileLoaded(fileContentString, `payload_importado_${items.length}_itens.txt`);
      
      setIsImportModalOpen(false);
      setImportText("");
      setImportError("");
    } catch (err: any) {
      setImportError(err.message || "Erro desconhecido ao processar o payload.");
    }
  };

  return (
    <div id="upload-box-container" className="bg-white border border-slate-200/80 p-6 rounded-xl shadow-sm">
      <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-4 mb-6">
        <div>
          <h2 className="font-display font-bold text-lg text-slate-900 mb-1 flex items-center gap-2">
            <FileText className="w-5 h-5 text-indigo-600" />
            Carregar Arquivo de Pedido (SICF)
          </h2>
          <p className="text-xs text-slate-500 tracking-wide">
            Selecione o arquivo de lote gerado pelo seu sistema ou cole um payload de faturamento.
          </p>
        </div>
        <button
          type="button"
          onClick={(e) => {
            e.stopPropagation();
            setIsImportModalOpen(true);
          }}
          className="text-xs font-bold uppercase tracking-wider text-emerald-800 bg-emerald-50 hover:bg-emerald-100 border border-emerald-200 py-2.5 px-4 rounded-lg transition-all flex items-center gap-1.5 shrink-0 cursor-pointer shadow-sm"
        >
          <Clipboard className="w-4 h-4 text-emerald-600" />
          Importar Payload / JSON
        </button>
      </div>

      {fileContent ? (
        <div className="flex flex-col gap-4">
          <div className="flex flex-col sm:flex-row sm:items-center justify-between p-4 bg-slate-50 border border-slate-200 rounded-lg gap-4">
          <div className="flex items-center space-x-3 overflow-hidden">
            <div className="bg-slate-900 text-white p-2.5 rounded-lg shrink-0">
              <FileText className="w-5 h-5" />
            </div>
            <div className="overflow-hidden">
              <p className="text-xs font-mono font-bold text-slate-800 truncate">{fileName}</p>
              <p className="text-[10px] text-emerald-600 font-bold uppercase tracking-wider flex items-center mt-1">
                <CheckCircle className="w-3.5 h-3.5 mr-1" />
                Pedido pronto ({fileContent.split("\n").filter(Boolean).length} linhas de dados)
              </p>
            </div>
          </div>
          <div className="flex items-center gap-3 self-end sm:self-auto">
            {onOptimize && (
              <button
                onClick={onOptimize}
                disabled={isLoading}
                className="flex items-center justify-center space-x-1.5 bg-indigo-600 hover:bg-indigo-700 disabled:opacity-50 text-white font-bold text-xs uppercase tracking-wider py-2.5 px-4 rounded-lg transition-all cursor-pointer shadow-sm"
              >
                {isLoading ? (
                  <>
                    <RefreshCw className="w-3.5 h-3.5 animate-spin" />
                    <span>Otimizando...</span>
                  </>
                ) : (
                  <>
                    <Sparkles className="w-3.5 h-3.5 text-amber-300 fill-current" />
                    <span>Otimizar Pedido</span>
                  </>
                )}
              </button>
            )}
            <button
              onClick={onClearFile}
              className="text-slate-400 hover:text-rose-600 hover:bg-rose-50 p-2.5 rounded-lg transition-colors border border-transparent"
              title="Remover arquivo"
            >
              <Trash2 className="w-4.5 h-4.5" />
            </button>
          </div>
        </div>

        {/* Distributors List */}
        {distributors.length > 0 && (
          <div className="bg-white border border-slate-200 rounded-lg p-4">
            <h3 className="text-xs font-bold text-slate-800 uppercase tracking-wider mb-3">Distribuidoras Disponíveis</h3>
            <div className="grid grid-cols-1 sm:grid-cols-2 md:grid-cols-3 gap-3">
              {distributors.map(dist => {
                const isDisabled = disabledDistributors.has(dist.Codigo);
                return (
                  <label 
                    key={dist.Codigo}
                    className={`flex items-center space-x-2 p-2 rounded border cursor-pointer transition-colors ${isDisabled ? 'bg-slate-50 border-slate-200 opacity-60' : 'bg-indigo-50/50 border-indigo-200 hover:bg-indigo-50'}`}
                  >
                    <input 
                      type="checkbox"
                      checked={!isDisabled}
                      onChange={() => onToggleDistributor && onToggleDistributor(dist.Codigo)}
                      className="rounded text-indigo-600 focus:ring-indigo-500 bg-white border-slate-300 w-4 h-4 cursor-pointer"
                    />
                    <div className="flex flex-col">
                      <span className={`text-xs font-semibold ${isDisabled ? 'text-slate-500' : 'text-slate-800'}`}>
                        {dist.Nome}
                      </span>
                      {dist.StatusAtual && (
                        <span className="text-[10px] text-slate-400">{dist.StatusAtual}</span>
                      )}
                    </div>
                  </label>
                );
              })}
            </div>
          </div>
        )}
        
        {isLoadingDistributors && (
          <div className="flex items-center text-xs text-slate-500 space-x-2">
            <RefreshCw className="w-3.5 h-3.5 animate-spin" />
            <span>Buscando distribuidoras...</span>
          </div>
        )}

        {!isLoadingDistributors && distributors.length === 0 && fileContent && (
          <div className="bg-amber-50 border border-amber-200 text-amber-800 text-xs rounded-lg p-3.5 flex items-start space-x-2.5">
            <AlertTriangle className="w-4.5 h-4.5 shrink-0 text-amber-600 mt-0.5" />
            <div className="flex flex-col gap-0.5">
              <span className="font-semibold">Nenhuma distribuidora encontrada</span>
              <span className="text-[11px] text-amber-700/90 leading-relaxed">Não foi possível carregar distribuidoras autorizadas para o CNPJ <strong>{cnpj || "não identificado"}</strong>. Certifique-se de que o Token e o CNPJ estão corretamente configurados no painel de configurações para o ambiente desejado (Produção ou Homologação).</span>
            </div>
          </div>
        )}

      </div>
      ) : (
        <div
          onDragOver={onDragOver}
          onDragLeave={onDragLeave}
          onDrop={onDrop}
          onClick={() => fileInputRef.current?.click()}
          className={`border-2 border-dashed p-10 flex flex-col items-center justify-center cursor-pointer transition-all rounded-xl ${
            isDragging
              ? "border-indigo-500 bg-indigo-50/40 text-indigo-900"
              : "border-slate-300 hover:border-indigo-400 hover:bg-slate-50/50 text-slate-500"
          }`}
        >
          <input
            type="file"
            ref={fileInputRef}
            onChange={handleFileChange}
            accept=".txt,.sicf"
            className="hidden"
          />
          <div className={`p-4 bg-slate-100 rounded-full mb-4 text-slate-600 transition-transform ${isDragging ? "scale-110 bg-indigo-100 text-indigo-600" : ""}`}>
            <Upload className="w-7 h-7" />
          </div>
          <p className="text-sm font-semibold text-slate-800 text-center tracking-wide">
            Arraste seu arquivo SICF aqui ou <span className="text-indigo-600 underline">clique para procurar</span>
          </p>
          <p className="text-xs text-slate-400 font-mono mt-1.5">Formatos compatíveis: .txt, .sicf (Latin-1)</p>

          <div className="mt-8 pt-5 border-t border-slate-100 w-full flex flex-col sm:flex-row items-center justify-center gap-3">
            <span className="text-xs font-medium text-slate-400 flex items-center gap-1.5">
              <Sparkles className="w-3.5 h-3.5 text-indigo-500" />
              Não possui arquivo agora?
            </span>
            <button
              type="button"
              onClick={(e) => {
                e.stopPropagation();
                loadSample();
              }}
              className="text-[11px] font-bold uppercase tracking-wider text-indigo-600 bg-indigo-50 hover:bg-indigo-100 py-2 px-4 rounded-lg transition-all"
            >
              Testar com arquivo de exemplo
            </button>
          </div>
        </div>
      )}

      {/* Modal de Importação Rápida */}
      {isImportModalOpen && (
        <div className="fixed inset-0 bg-slate-900/60 backdrop-blur-sm flex items-center justify-center p-4 z-50 animate-fade-in">
          <div className="bg-white border-4 border-slate-900 p-6 rounded-none w-full max-w-2xl shadow-[8px_8px_0px_0px_rgba(15,23,42,1)] text-slate-800">
            <div className="flex justify-between items-center mb-4 pb-3 border-b border-slate-200">
              <div className="flex items-center gap-2">
                <Clipboard className="w-5 h-5 text-emerald-600" />
                <h3 className="font-serif italic font-bold text-lg text-slate-900">
                  Importar Payload ou Logs de Pedido (JSON)
                </h3>
              </div>
              <button
                type="button"
                onClick={() => {
                  setIsImportModalOpen(false);
                  setImportError("");
                  setImportText("");
                }}
                className="text-slate-400 hover:text-slate-700 transition-colors cursor-pointer"
              >
                <Trash2 className="w-5 h-5" />
              </button>
            </div>

            <p className="text-xs text-slate-600 mb-4 leading-relaxed">
              Cole abaixo o JSON do payload enviado ao faturamento, a resposta da SmartPed ou qualquer log contendo uma lista de EANs e quantidades. O sistema irá extrair os itens de forma inteligente e gerar um lote de faturamento pronto para otimização!
            </p>

            <div className="mb-4">
              <textarea
                value={importText}
                onChange={(e) => {
                  setImportText(e.target.value);
                  if (importError) setImportError("");
                }}
                placeholder={`Cole seu payload JSON aqui...\nExemplo:\n{\n  "Itens": [\n    { "Ean": "7908134200552", "Quant": 5 }\n  ]\n}`}
                rows={10}
                className="w-full font-mono text-xs p-3 bg-slate-50 border-2 border-slate-900 text-slate-800 placeholder-slate-400 focus:outline-none focus:bg-white rounded-none"
              />
            </div>

            {importError && (
              <div className="p-3 bg-rose-50 border border-rose-300 text-rose-900 text-xs font-semibold mb-4 rounded-none flex items-start gap-2">
                <AlertTriangle className="w-4 h-4 text-rose-600 shrink-0 mt-0.5" />
                <span>{importError}</span>
              </div>
            )}

            <div className="flex justify-end gap-3">
              <button
                type="button"
                onClick={() => {
                  setIsImportModalOpen(false);
                  setImportError("");
                  setImportText("");
                }}
                className="px-4 py-2 text-xs font-bold uppercase border-2 border-slate-900 text-slate-800 hover:bg-slate-100 transition-colors cursor-pointer"
              >
                Cancelar
              </button>
              <button
                type="button"
                onClick={handleImportSubmit}
                className="px-5 py-2 text-xs font-black uppercase bg-emerald-600 hover:bg-emerald-700 text-white border-2 border-slate-900 shadow-[4px_4px_0px_0px_rgba(15,23,42,1)] active:translate-y-0.5 active:shadow-[2px_2px_0px_0px_rgba(15,23,42,1)] transition-all cursor-pointer flex items-center gap-1.5"
              >
                <FileDown className="w-4 h-4" />
                Processar e Carregar Lote
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
