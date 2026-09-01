export const HOMOLOGACAO_SICF_FILE = `1;13408443000168;3.0
2;7896004746937;3;19269;EZETIMIBA 10MG 2 BLT X 15 COMP;EMS;18.50
2;7896241225547;2;19270;ABLOK PLUS 100/25MG C/30 COMPRIMIDOS;BIOLAB;42.00
2;7891317024994;5;19271;BUP 150MG C/30;EUROFARMA;36.00
2;7896255711005;1;19272;AKINETON 2MG C/80;BAGO;29.00
2;7891317010751;2;19273;DEXALGEN INJETAVEL C/6;EUROFARMA;44.00
2;7891142165770;1;19268;MACRODANTINA 100MG C/28 CAPSULAS;ADIUM;48.50
2;7896112127680;1;19267;MALEATO DE DEXCLORFENIRAMINA 0,4MG/ML XPE 100ML;TEUTO;8.90
9;5`;

export function formatCurrency(value: any): string {
  const num = typeof value === "number" ? value : parseFloat(String(value || 0));
  return new Intl.NumberFormat("pt-BR", {
    style: "currency",
    currency: "BRL"
  }).format(isNaN(num) ? 0 : num);
}

export function formatPercentage(value: number): string {
  return new Intl.NumberFormat("pt-BR", {
    style: "percent",
    maximumFractionDigits: 1
  }).format(value);
}

export const cleanEan = (ean: string | number | undefined | null): string => {
  if (ean === undefined || ean === null) return "";
  const cleaned = String(ean).trim().replace(/\D/g, "");
  if (!cleaned) return "";
  if (cleaned.length <= 13) {
    return cleaned.padStart(13, "0");
  }
  return cleaned;
};

export const resolveEstoque = (item: any): number => {
  if (!item) return 0;
  return Number(
    item.Estoque !== undefined ? item.Estoque :
    item.estoque !== undefined ? item.estoque :
    item.estoque_idi !== undefined ? item.estoque_idi :
    item.Estoque_idi !== undefined ? item.Estoque_idi : 0
  ) || 0;
};

export const resolveQtdMinima = (item: any): number => {
  if (!item) return 1;
  const raw = (
    item.QtdMin !== undefined ? item.QtdMin :
    item.qtdMin !== undefined ? item.qtdMin :
    item.QtdMinima !== undefined ? item.QtdMinima :
    item.qtdMinima !== undefined ? item.qtdMinima :
    item.qtdminima !== undefined ? item.qtdminima :
    (item.Combo && item.Combo.QtdMin !== undefined ? item.Combo.QtdMin :
    (item.combo && item.combo.qtdMin !== undefined ? item.combo.qtdMin : 1))
  );
  const parsed = parseInt(String(raw).replace(/[^0-9]/g, ""), 10);
  return !isNaN(parsed) && parsed > 0 ? parsed : 1;
};

export const safeEanCompare = (eanA: any, eanB: any): boolean => {
  if (eanA === undefined || eanA === null || eanB === undefined || eanB === null) return false;
  return String(eanA).trim() === String(eanB).trim();
};

export const resolvePrecoLiquido = (item: any): number => {
  if (!item) return 0;
  const pliq = Number(item.Pliquido !== undefined ? item.Pliquido : (item.pliquido !== undefined ? item.pliquido : 0));
  const pliqUni = Number(item.PliquidoUni !== undefined ? item.PliquidoUni : (item.pliquidoUni !== undefined ? item.pliquidoUni : 0));
  const precoLiq = Number(item.precoLiquido !== undefined ? item.precoLiquido : 0);
  
  if (pliqUni > 0 && (pliq === 0 || pliqUni < pliq)) return pliqUni;
  if (pliq > 0) return pliq;
  if (precoLiq > 0) return precoLiq;
  return Number(item.Preco !== undefined ? item.Preco : (item.preco !== undefined ? item.preco : (item.precoOriginal !== undefined ? item.precoOriginal : 0)));
};

export const resolvePedidoMinimo = (item: any, minimosArray?: any[]): number => {
  if (!item) return 0;
  // Se o backend já injetou diretamente no item (caso da descrição enriquecida)
  if (item.VlrMinimo !== undefined && Number(item.VlrMinimo) > 0) return Number(item.VlrMinimo);
  if (item.vlrMinimo !== undefined && Number(item.vlrMinimo) > 0) return Number(item.vlrMinimo);
  if (item.pedidoMinimo !== undefined && Number(item.pedidoMinimo) > 0) return Number(item.pedidoMinimo);

  // Se tivermos o array de mínimos para cruzar (caso do EAN ou cotação)
  if (minimosArray && Array.isArray(minimosArray) && minimosArray.length > 0) {
    const itemCodDist = item.CodDist !== undefined ? item.CodDist : (item.codDist !== undefined ? item.codDist : 0);
    const itemCond = String(item.Condicao || item.condicao || item.NomeCondicao || "").trim().toUpperCase();
    const itemPrazo = item.Prazo !== undefined ? item.Prazo : (item.prazo !== undefined ? item.prazo : 0);

    // 1. Match completo: CodDist + Condicao + Prazo
    let match = minimosArray.find(m => {
      if (!m) return false;
      const mCod = m.CodDist !== undefined ? m.CodDist : (m.codDist !== undefined ? m.codDist : 0);
      const mCond = String(m.Condicao || m.condicao || m.NomeCondicao || "").trim().toUpperCase();
      const mPrazo = m.Prazo !== undefined ? m.Prazo : (m.prazo !== undefined ? m.prazo : 0);
      return Number(mCod) === Number(itemCodDist) && mCond === itemCond && Number(mPrazo) === Number(itemPrazo);
    });
    if (match) {
      const v = Number(match.VlrMinimo !== undefined ? match.VlrMinimo : match.vlrMinimo);
      if (v > 0) return v;
    }

    // 2. Match: CodDist + Prazo
    match = minimosArray.find(m => {
      if (!m) return false;
      const mCod = m.CodDist !== undefined ? m.CodDist : (m.codDist !== undefined ? m.codDist : 0);
      const mPrazo = m.Prazo !== undefined ? m.Prazo : (m.prazo !== undefined ? m.prazo : 0);
      return Number(mCod) === Number(itemCodDist) && Number(mPrazo) === Number(itemPrazo);
    });
    if (match) {
      const v = Number(match.VlrMinimo !== undefined ? match.VlrMinimo : match.vlrMinimo);
      if (v > 0) return v;
    }

    // 3. Match: CodDist + Condicao
    match = minimosArray.find(m => {
      if (!m) return false;
      const mCod = m.CodDist !== undefined ? m.CodDist : (m.codDist !== undefined ? m.codDist : 0);
      const mCond = String(m.Condicao || m.condicao || m.NomeCondicao || "").trim().toUpperCase();
      return Number(mCod) === Number(itemCodDist) && mCond === itemCond;
    });
    if (match) {
      const v = Number(match.VlrMinimo !== undefined ? match.VlrMinimo : match.vlrMinimo);
      if (v > 0) return v;
    }

    // 4. Match: CodDist
    match = minimosArray.find(m => {
      if (!m) return false;
      const mCod = m.CodDist !== undefined ? m.CodDist : (m.codDist !== undefined ? m.codDist : 0);
      return Number(mCod) === Number(itemCodDist);
    });
    if (match) {
      const v = Number(match.VlrMinimo !== undefined ? match.VlrMinimo : match.vlrMinimo);
      if (v > 0) return v;
    }
  }

  return 0;
};
