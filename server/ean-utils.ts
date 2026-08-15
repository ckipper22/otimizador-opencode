import path from "path";
import fs from "fs";

export function cleanEan(ean: string | number | undefined | null): string {
  if (ean === undefined || ean === null) return "";
  const cleaned = String(ean).trim().replace(/\D/g, "");
  if (!cleaned) return "";
  if (cleaned.length <= 13) {
    return cleaned.padStart(13, "0");
  }
  return cleaned;
}

export function normalizeDistName(name: string): string {
  return (name || "")
    .split('[')[0]
    .trim()
    .normalize("NFD")
    .replace(/[\u0300-\u036f]/g, "")
    .toUpperCase();
}

export function cleanCodProduto(codProduto: string | undefined | null, codProdutoDist: string | undefined | null): string {
  const prod = String(codProduto || "").trim();
  const dist = String(codProdutoDist || "").trim();
  return (prod === "" || prod === "0") ? dist : prod;
}

export const EAN_DATABASE: Record<string, {
  descricao: string;
  laboratorio: string;
  precoOriginal: number;
  qtd_estoque?: number;
  est_minimo?: number;
  est_maximo?: number;
  cod_reduzido?: string;
  vlr_custopersonalizado?: number;
  vlr_venda_tabela?: number;
  vlr_venda_final?: number;
  dat_ultent?: string;
  cod_dcb?: string;
  cod_concentracao?: string;
}> = {};

export function getEanDatabaseRecord(ean: string | number | undefined | null) {
  if (ean === undefined || ean === null) return null;
  const cleaned = cleanEan(ean);
  if (!cleaned) return null;
  return EAN_DATABASE[cleaned] || EAN_DATABASE[String(ean).trim()] || null;
}

export function loadEanDatabase() {
  try {
    const utilsPath = path.join(process.cwd(), "src/utils.ts");
    if (fs.existsSync(utilsPath)) {
      const content = fs.readFileSync(utilsPath, "utf-8");
      const filesText: string[] = [];
      const sampleMatch = content.match(/export const SAMPLE_SICF_FILE = `([\s\S]+?)`/);
      if (sampleMatch) filesText.push(sampleMatch[1]);
      const homolMatch = content.match(/export const HOMOLOGACAO_SICF_FILE = `([\s\S]+?)`/);
      if (homolMatch) filesText.push(homolMatch[1]);

      for (const text of filesText) {
        const lines = text.split("\n");
        for (const line of lines) {
          const parts = line.trim().split(";");
          if (parts.length >= 7 && parts[0] === "2") {
            const ean = parts[1].trim();
            const desc = parts[4].trim();
            const lab = parts[5].trim();
            const price = parseFloat(parts[6].replace(",", "."));
            if (ean && desc) {
              const cleaned = cleanEan(ean);
              const data = {
                descricao: desc,
                laboratorio: lab || "Geral",
                precoOriginal: isNaN(price) ? 10.0 : price
              };
              EAN_DATABASE[ean] = data;
              if (cleaned && cleaned !== ean) {
                EAN_DATABASE[cleaned] = data;
              }
            }
          }
        }
      }
      console.log(`[SISTEMA] Base de EANs carregada com sucesso: ${Object.keys(EAN_DATABASE).length} itens mapeados.`);
    }
  } catch (err) {
    console.error("Erro ao carregar banco de dados de EANs:", err);
  }
}
