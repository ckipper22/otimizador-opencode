export function stripHtmlTags(str: string): string {
  if (!str) return "";
  return str.replace(/<\/?[^>]+(>|$)/g, "").trim();
}

export function hasWordBoundary(text: string, keyword: string): boolean {
  if (!text || !keyword) return false;
  const escaped = keyword.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
  const regex = new RegExp(`\\b${escaped}\\b`, "i");
  return regex.test(text);
}

export function extractQuantityCount(desc: string): number | null {
  if (!desc) return null;
  const normalized = desc.toUpperCase();

  const cMatch = normalized.match(/\bC(?:X)?\/\s*(\d+)\b/i);
  if (cMatch && cMatch[1]) {
    return parseInt(cMatch[1], 10);
  }

  const cpMatch = normalized.match(/\b(\d+)\s*(?:CP|COMP|CAPS|CAP|DRG|BL|AMB|AMP|SACHET|ENVEL|UN)\b/i);
  if (cpMatch && cpMatch[1]) {
    return parseInt(cpMatch[1], 10);
  }

  return null;
}

export function checkColetivoKeywords(novaDesc: string, originalDesc?: string): boolean {
  if (!novaDesc) return false;

  let normNova = novaDesc.toUpperCase();
  const labCodesToIgnore = [/\bGG\b/g, /\bAL\b/g, /\bEMS\b/g, /\bGL\b/g, /\bBGN\b/g, /\bGEO\b/g];
  labCodesToIgnore.forEach(regex => {
    normNova = normNova.replace(regex, "");
  });

  const normOrig = (originalDesc || "").toUpperCase();

  const wholesaleRegexes = [
    /\bFARDO\b/i,
    /\bDISPLAY\b/i,
    /\bPACOTAO\b/i,
    /\bPACOTÃO\b/i,
    /\b\d+\s*X\s*\d+\b/i,
    /\bCX\s+COM\b/i,
    /\bCX\s+C\/\b/i,
    /\bC\/\s*DISPLAY\b/i
  ];

  if (wholesaleRegexes.some(regex => regex.test(normNova))) {
    return true;
  }

  const cMatch = normNova.match(/\bC(?:X)?\/\s*(\d+)\b/i);
  if (cMatch && cMatch[1]) {
    const subQty = parseInt(cMatch[1], 10);
    const origQty = extractQuantityCount(normOrig);

    if (origQty !== null && origQty === subQty) {
      return false;
    }

    if (origQty !== null) {
      if (subQty >= origQty * 2 && subQty > 12) {
        return true;
      }
      return false;
    } else {
      if (subQty > 30) {
        return true;
      }
      return false;
    }
  }

  return false;
}

export function calculateQuantityAlert(
  originalPreco: number,
  novoPreco: number,
  novaDescricao: string,
  cx: number,
  originalDescricao?: string
): { alertaConfirmarQtd: boolean; motivoAlerta?: string } {
  if (originalPreco > 0 && novoPreco > originalPreco * 3 && (novoPreco - originalPreco > 15.0)) {
    return {
      alertaConfirmarQtd: true,
      motivoAlerta: `Preço unitário cotado (R$ ${novoPreco.toFixed(2)}) é muito superior ao custo ERP (R$ ${originalPreco.toFixed(2)}). Verifique se a cotação é de uma caixa fechada/embalagem múltipla.`
    };
  }

  if (checkColetivoKeywords(novaDescricao, originalDescricao)) {
    return {
      alertaConfirmarQtd: true,
      motivoAlerta: `Descrição indica embalagem coletiva ("${novaDescricao}"). Verifique se a quantidade cotada corresponde à fração correta.`
    };
  }

  if (cx > 1) {
    return {
      alertaConfirmarQtd: true,
      motivoAlerta: `O distribuidor indicou embalagem coletiva com fator de caixa cx: ${cx}. Ajuste as quantidades para evitar compras duplicadas.`
    };
  }

  return { alertaConfirmarQtd: false };
}

export function parseFormattedNumber(val: any): number {
  if (val === undefined || val === null) return 0;
  if (typeof val === "number") return val;
  if (typeof val === "string") {
    const cleaned = val.replace(/[^\d,.-]/g, "").replace(",", ".");
    const num = parseFloat(cleaned);
    return isNaN(num) ? 0 : num;
  }
  return 0;
}

export function extractPmc(item: any): number {
  if (!item) return 0;
  const keys = [
    "PMC", "pmc", "Pmc", "VlrPmc", "vlrPmc", "Vlr_pmc", "vlr_pmc", "Vlrpmc", "vlrpmc",
    "VlrVendaMaximo", "vlrVendaMaximo", "VlrMaximo", "vlrMaximo", "PrecoConsumidor", "precoConsumidor",
    "PrecoMax", "precoMax", "PrecoMaximoConsumidor", "precoMaximoConsumidor", "PrecoMaximo", "precoMaximo",
    "VlrMaximoConsumidor", "vlrMaximoConsumidor"
  ];
  for (const key of keys) {
    if (item[key] !== undefined && item[key] !== null) {
      const val = parseFormattedNumber(item[key]);
      if (val > 0) return val;
    }
  }
  return 0;
}

export function extractTablePrice(item: any): number {
  if (!item) return 0;
  const keys = [
    "Preco", "preco", "PrecoOriginal", "precoOriginal", "PrecoFabrica", "precoFabrica",
    "Preco_fabrica", "preco_fabrica", "PrecoTabela", "precoTabela", "vlr_venda_tabela",
    "VlrVendaTabela", "PrecoTabelaUni", "precoTabelaUni"
  ];
  for (const key of keys) {
    if (item[key] !== undefined && item[key] !== null) {
      const val = parseFormattedNumber(item[key]);
      if (val > 0) return val;
    }
  }
  return 0;
}

export function getUnitCost(item: any): number {
  if (!item) return 0;
  const pliq = parseFormattedNumber(item.Pliquido !== undefined ? item.Pliquido : (item.pliquido !== undefined ? item.pliquido : 0));
  const pliqUni = parseFormattedNumber(item.PliquidoUni !== undefined ? item.PliquidoUni : (item.pliquidoUni !== undefined ? item.pliquidoUni : (item.Pliquido_uni !== undefined ? item.Pliquido_uni : (item.pliquido_uni !== undefined ? item.pliquido_uni : 0))));

  if (pliqUni > 0 && (pliq === 0 || pliqUni < pliq)) return pliqUni;
  if (pliq > 0) return pliq;
  return parseFormattedNumber(item.Preco !== undefined ? item.Preco : (item.preco !== undefined ? item.preco : (item.PrecoOriginal !== undefined ? item.PrecoOriginal : (item.precoOriginal !== undefined ? item.precoOriginal : 0))));
}

export function isRealOffer(s: any): boolean {
  if (!s) return false;
  const distId = s.CodDist !== undefined ? s.CodDist : (s.codDist !== undefined ? s.codDist : 0);
  const distName = String(s.NomeDist || s.nomeDist || s.distribuidora || "").trim().toLowerCase();
  return Number(distId) > 0 && distName !== "" && distName !== "nao encontrados" && distName !== "não encontrados" && distName !== "sem estoque";
}

export function extractSmartPedQtdMin(cond: any): number {
  if (!cond) return 0;
  const candidates = [
    cond.QtdMin, cond.qtdMin, cond.QtdMinima, cond.qtdMinima,
    cond.Qtd_Minima, cond.Qtd_minima, cond.QuantidadeMinima, cond.quantidadeMinima,
    cond.Qtd, cond.qtd,
    cond.Combo?.QtdMin, cond.combo?.qtdMin, cond.Combo?.QtdMinima, cond.combo?.qtdMinima,
    cond.Escala?.QtdMin, cond.escala?.qtdMin,
    cond.Campanha?.QtdMin, cond.campanha?.qtdMin
  ];

  for (const c of candidates) {
    if (c !== undefined && c !== null) {
      const parsed = parseInt(String(c).replace(/[^0-9]/g, ""), 10);
      if (!isNaN(parsed) && parsed > 0) {
        return parsed;
      }
    }
  }
  return 0;
}

export function parseSmartPedEstoque(rawEstoque: any, hasValidPrice: boolean = true): number {
  if (rawEstoque === null || rawEstoque === undefined) {
    return hasValidPrice ? 2 : 0;
  }
  if (typeof rawEstoque === "boolean") {
    return rawEstoque ? 2 : 0;
  }
  if (typeof rawEstoque === "number") {
    if (isNaN(rawEstoque)) return hasValidPrice ? 2 : 0;
    return rawEstoque;
  }
  const str = String(rawEstoque).trim().toUpperCase();
  if (!str || str === "NULL" || str === "UNDEFINED") {
    return hasValidPrice ? 2 : 0;
  }
  if (["S", "SIM", "TRUE", "DISPONIVEL", "DISPONÍVEL", "NORMAL", "OK", "EM ESTOQUE"].includes(str)) {
    return 2;
  }
  if (["N", "NAO", "NÃO", "FALSE", "SEM ESTOQUE", "INDISPONIVEL", "INDISPONÍVEL", "ZERADO", "0"].includes(str)) {
    return 0;
  }
  const parsed = parseInt(str.replace(/[^0-9]/g, ""), 10);
  if (!isNaN(parsed)) {
    return parsed;
  }
  return hasValidPrice ? 2 : 0;
}

export function cleanDescription(desc: string): string {
  if (!desc) return "";
  let d = desc.toUpperCase();

  d = d.replace(/\b\d+([.,]\d+)?\s*(MG|ML|G|UI|%|MM|MCG|UN)?\s*[\/X+]\s*\d+([.,]\d+)?\s*(MG|ML|G|UI|%|MM|MCG|UN)?\b/gi, " ");
  d = d.replace(/\b\d+([.,]\d+)?\s*(MG|ML|G|UI|%|MM|MCG|UN)\b/gi, " ");
  d = d.replace(/\b\d+\s*(CP|CAPS|COMP|UN|FR|TB|SACH|BG|GTS|SACHES|AMP)\b/gi, " ");
  d = d.replace(/\bC\/\s*\d+\b/gi, " ");
  d = d.replace(/\b(SUBL|REV|L\.P|L\.R|SOL\s+TOP|SOL|TOP|AD|PED|GTS|INJ|LP|LR|REV|AER|AEROSOL|EMULSAO|SUSP|GTS|AMP|BL)\b/gi, " ");
  d = d.trim().replace(/\s+/g, " ");
  d = d.replace(/[-\s+]+$/, "").trim();

  return d;
}

export function getMoleculeBase(desc: string): string {
  if (!desc) return "";
  let d = desc.toUpperCase();

  d = d.replace(/\b\d+([.,]\d+)?\s*(MG|ML|G|UI|%|MM|MCG|UN)?\s*[\/X+]\s*\d+([.,]\d+)?\s*(MG|ML|G|UI|%|MM|MCG|UN)?\b/gi, " ");
  d = d.replace(/\b\d+([.,]\d+)?\s*(MG|ML|G|UI|%|MM|MCG|UN)\b/gi, " ");
  d = d.replace(/\b\d+\s*(CP|CAPS|COMP|UN|FR|TB|SACH|BG|GTS|SACHES|AMP)\b/gi, " ");
  d = d.replace(/\bC\/\s*\d+\b/gi, " ");
  d = d.replace(/\b(SUBL|REV|L\.P|L\.R|SOL\s+TOP|SOL|TOP|AD|PED|GTS|INJ|LP|LR|REV|AER|AEROSOL|EMULSAO|SUSP|GTS|AMP|BL)\b/gi, " ");

  const words = d.trim().split(/\s+/).filter(w => {
    const ignore = [
      "GEN", "GENERICO", "GENÉRICO", "MEDLEY", "EMS", "EUROFARMA", "NEO", "QUIMICA", "QUÍMICA",
      "TEUTO", "PRATI", "GERMED", "SANDOZ", "GEOLAB", "BIOSINTETICA", "BIOSINTÉTICA", "GLOBO",
      "BIOLAB", "ACHE", "ACHÉ", "LEGRAND", "SANOFI", "AVENTIS", "ZYDUS", "ALCON", "CIMED", "UNIPHAR",
      "BD", "ULTRA", "FINE", "RISQUE", "RISQUÉ", "COTY", "VITAMEDIC", "BEIERSDORF", "NIVEA", "NÍVEA",
      "UNILEVER", "DOVE", "CIFARMA", "JANSSEN", "CILAG", "MERCK", "SHARP", "DOHME", "MSD", "BASTON",
      "ABOVE", "CLINICAL", "DERMACLIN", "GARDENIA", "AMENDOAS", "BOTANICALS"
    ];
    return !ignore.includes(w);
  });

  if (words.length === 0) return "";

  const PALAVRAS_GENERICAS_TRUNCAMENTO = new Set([
    "KIT", "SAB", "SABONETE", "BOLA", "BALA", "BRINQUEDO", "DIVERSOS", "POTE", "PÇS", "PCS", "PEÇAS",
    "PECAS", "MINI", "GRANDE", "PEQUENO", "ESTOJO", "PORTA", "SUPORTE", "CABO", "FITA", "COLA", "BASE",
    "MASCARA", "MÁSCARA", "SOMBRA", "PIRANHA", "CREME", "LOÇÃO", "LOCAO", "SHAMPOO", "CONDICIONADOR",
    "AEROSOL", "SPRAY", "DESODORANTE", "DESOD", "PERFUME", "COLONIA", "COLÔNIA", "BODY", "SPLASH",
    "POMADA", "TALCO", "ALGODAO", "ALGODÃO", "CURATIVO", "BANDAGEM", "ESCOVA", "PENTE", "LIXA",
    "PINCA", "PINÇA", "TESOURA", "CURVADOR", "CARRINHO", "CARRO", "ANIMAIS", "BONECA", "CHUPETA",
    "MAMADEIRA", "DOSADOR", "PRENDEDOR", "ELASTICO", "ELÁSTICO", "PRESILHA", "GRAMPO", "INF", "INFANTIL",
    "GK1356", "GK1592", "REF", "COD", "CHA", "CHÁ", "OLEO", "ÓLEO", "AGUA", "ÁGUA", "GEL", "PASTA",
    "BARRA", "BALSAMO", "BÁLSAMO", "FLUIDO", "FLÚIDO"
  ]);

  if (PALAVRAS_GENERICAS_TRUNCAMENTO.has(words[0])) {
    const especificas = words.filter(w => !PALAVRAS_GENERICAS_TRUNCAMENTO.has(w));
    if (especificas.length > 0) {
      return especificas.slice(0, 3).join(" ");
    }
    return words.slice(0, 3).join(" ");
  }

  let base = words[0];

  if (words.length > 1) {
    const w1 = words[1];
    if (["DE", "DO", "DA", "DI", "C/", "SÓDICO", "SODICO", "SÓDICA", "SODICA", "POTASSICO", "POTÁSSICO", "OLAMINA", "MONOIDRATADO", "FISIOLOGICO", "FISIOLÓGICO", "SULFATO", "CLORIDRATO", "MALEATO", "BROMIDRATO", "DIPROPIONATO", "FOSFATO", "MESILATO", "TARTARATO", "HEMITARTARATO"].includes(w1)) {
      base += " " + w1;
      if (words.length > 2) {
        base += " " + words[2];
      }
    } else if (["SORO", "CLORIDRATO", "PANTOPRAZOL", "CICLOPIROX", "ACIDO", "ÁCIDO", "LAVITAN"].includes(words[0])) {
      base += " " + w1;
    }
  }

  return base.trim();
}

export function cleanDescriptionKeepDosage(desc: string): string {
  if (!desc) return "";
  let d = desc.toUpperCase();

  d = d.replace(/\b\d+\s*(CP|CAPS|COMP|UN|FR|TB|SACH|BG|GTS|SACHES|AMP)\b/gi, " ");
  d = d.replace(/\bC\/\s*\d+\b/gi, " ");
  d = d.replace(/\b(SUBL|REV|L\.P|L\.R|SOL\s+TOP|SOL|TOP|AD|PED|GTS|INJ|LP|LR|REV|AER|AEROSOL|EMULSAO|SUSP|GTS|AMP|BL)\b/gi, " ");

  const words = d.trim().split(/\s+/).filter(w => {
    const ignore = [
      "GEN", "GENERICO", "GENÉRICO", "MEDLEY", "EMS", "EUROFARMA", "NEO", "QUIMICA", "QUÍMICA",
      "TEUTO", "PRATI", "GERMED", "SANDOZ", "GEOLAB", "BIOSINTETICA", "BIOSINTÉTICA", "GLOBO",
      "BIOLAB", "ACHE", "ACHÉ", "LEGRAND", "SANOFI", "AVENTIS", "ZYDUS", "ALCON", "CIMED", "UNIPHAR",
      "BD", "ULTRA", "FINE", "RISQUE", "RISQUÉ", "COTY", "VITAMEDIC", "BEIERSDORF", "NIVEA", "NÍVEA",
      "UNILEVER", "DOVE", "CIFARMA", "JANSSEN", "CILAG", "MERCK", "SHARP", "DOHME", "MSD", "BASTON",
      "ABOVE", "CLINICAL", "DERMACLIN", "GARDENIA", "AMENDOAS", "BOTANICALS"
    ];
    return !ignore.includes(w);
  });

  return words.join(" ").trim();
}

export function getWildcardQueries(desc: string): string[] {
  if (!desc) return [];
  const upper = desc.toUpperCase();

  const ignoreList = [
    "GEN", "GENERICO", "GENÉRICO", "MEDLEY", "EMS", "EUROFARMA", "NEO", "QUIMICA", "QUÍMICA",
    "TEUTO", "PRATI", "GERMED", "SANDOZ", "GEOLAB", "BIOSINTETICA", "BIOSINTÉTICA", "GLOBO",
    "BIOLAB", "ACHE", "ACHÉ", "LEGRAND", "SANOFI", "AVENTIS", "ZYDUS", "ALCON", "CIMED", "UNIPHAR",
    "BD", "ULTRA", "FINE", "RISQUE", "RISQUÉ", "COTY", "VITAMEDIC", "BEIERSDORF", "NIVEA", "NÍVEA",
    "UNILEVER", "DOVE", "CIFARMA", "JANSSEN", "CILAG", "MERCK", "SHARP", "DOHME", "MSD", "BASTON",
    "ABOVE", "CLINICAL", "DERMACLIN", "GARDENIA", "AMENDOAS", "BOTANICALS"
  ];

  const presentationWords = [
    "CP", "CPS", "COMP", "COMPRIMIDOS", "CAPS", "CAPSULAS", "CAP", "CX", "CAIXA", "AMP", "AMPOLA",
    "FR", "FRASCO", "UN", "UNIDADE", "BL", "BLISTER", "C/", "COM", "CART", "CARTELA", "FLAC", "FLACONETE",
    "CO", "PCT", "PACOTE", "SACHE", "SACHET", "ENV", "ENVELOPE", "GOTAS", "GTS", "SER", "SERINGA",
    "LATA", "POT", "POTE", "BISN", "BISNAGA", "S/A", "LT", "KG", "GRS",
    "KIT", "SAB", "SABONETE", "BOLA", "BALA", "BRINQUEDO", "DIVERSOS", "POTE", "PÇS", "PCS", "PEÇAS",
    "PECAS", "MINI", "GRANDE", "PEQUENO", "ESTOJO", "PORTA", "SUPORTE", "CABO", "FITA", "COLA", "BASE",
    "MASCARA", "MÁSCARA", "SOMBRA", "PIRANHA", "CREME", "LOÇÃO", "LOCAO", "SHAMPOO", "CONDICIONADOR",
    "AEROSOL", "SPRAY", "DESODORANTE", "DESOD", "PERFUME", "COLONIA", "COLÔNIA", "BODY", "SPLASH",
    "POMADA", "TALCO", "ALGODAO", "ALGODÃO", "CURATIVO", "BANDAGEM", "ESCOVA", "PENTE", "LIXA",
    "PINCA", "PINÇA", "TESOURA", "CURVADOR", "CARRINHO", "CARRO", "ANIMAIS", "BONECA", "CHUPETA",
    "MAMADEIRA", "DOSADOR", "PRENDEDOR", "ELASTICO", "ELÁSTICO", "PRESILHA", "GRAMPO", "INF", "INFANTIL",
    "GK1356", "GK1592", "REF", "COD"
  ];

  const queries: string[] = [];

  const normalized = upper.replace(/[^A-Z0-9]/g, " ");
  const rawWords = normalized.split(/\s+/).filter(w => w.length > 0);

  const cleanWords: string[] = [];
  for (const w of rawWords) {
    if (ignoreList.includes(w) || presentationWords.includes(w)) {
      continue;
    }
    const cleaned = w.replace(/^(\d+)(CP|CPS|COMP|COMPRIMIDOS|CAPS|CAPSULAS|CAP|CX|CAIXA|AMP|AMPOLA|FR|FRASCO|UN|UNIDADE|BL|BLISTER|CO|FLAC|FLACONETE|CART|CARTELA|PCT|PACOTE|SACHE|SACHET|ENV|ENVELOPE|GOTAS|GTS|SER|SERINGA|LATA|POT|POTE|BISN|BISNAGA|KG|GRS)$/i, "$1");

    if (cleaned && cleaned.length > 0 && !ignoreList.includes(cleaned) && !presentationWords.includes(cleaned)) {
      cleanWords.push(cleaned);
    }
  }

  if (cleanWords.length === 0) return [];

  if (cleanWords.length >= 2) {
    queries.push(`${cleanWords[0]}%${cleanWords[1]}`);
  }
  if (cleanWords.length >= 3) {
    queries.push(`${cleanWords[0]}%${cleanWords[1]}%${cleanWords[2]}`);
  }
  if (cleanWords.length >= 4) {
    queries.push(`${cleanWords[0]}%${cleanWords[1]}%${cleanWords[2]}%${cleanWords[3]}`);
  }
  if (cleanWords.length >= 5) {
    queries.push(`${cleanWords[0]}%${cleanWords[1]}%${cleanWords[2]}%${cleanWords[3]}%${cleanWords[4]}`);
  }

  const baseActive = cleanWords[0];
  const numberOrDosageWords = cleanWords.slice(1).filter(w => /\d+/.test(w));

  if (baseActive && baseActive.length > 2) {
    if (numberOrDosageWords.length > 0) {
      queries.push(`${baseActive}%${numberOrDosageWords.join("%")}`);
      if (numberOrDosageWords.length > 1) {
        queries.push(`${baseActive}%${numberOrDosageWords.slice(0, -1).join("%")}`);
      }
    }
  }

  if (cleanWords.length >= 2) {
    const firstTwo = cleanWords.slice(0, 2).join("%");
    if (!queries.includes(firstTwo)) {
      queries.push(firstTwo);
    }
  }

  const fullQuery = cleanWords.join("%");
  if (!queries.includes(fullQuery) && cleanWords.length > 1) {
    queries.push(fullQuery);
  }

  return [...new Set(queries)].slice(0, 6);
}

export function getCleanSearchWords(desc: string): string[] {
  if (!desc) return [];
  const upper = desc.toUpperCase();

  const ignoreList = [
    "GEN", "GENERICO", "GENÉRICO", "MEDLEY", "EMS", "EUROFARMA", "NEO", "QUIMICA", "QUÍMICA",
    "TEUTO", "PRATI", "GERMED", "SANDOZ", "GEOLAB", "BIOSINTETICA", "BIOSINTÉTICA", "GLOBO",
    "BIOLAB", "ACHE", "ACHÉ", "LEGRAND", "SANOFI", "AVENTIS", "ZYDUS", "ALCON", "CIMED", "UNIPHAR",
    "BD", "ULTRA", "FINE", "RISQUE", "RISQUÉ", "COTY", "VITAMEDIC", "BEIERSDORF", "NIVEA", "NÍVEA",
    "UNILEVER", "DOVE", "CIFARMA", "JANSSEN", "CILAG", "MERCK", "SHARP", "DOHME", "MSD", "BASTON",
    "ABOVE", "CLINICAL", "DERMACLIN", "GARDENIA", "AMENDOAS", "BOTANICALS"
  ];

  const presentationWords = [
    "CP", "CPS", "COMP", "COMPRIMIDOS", "CAPS", "CAPSULAS", "CAP", "CX", "CAIXA", "AMP", "AMPOLA",
    "FR", "FRASCO", "UN", "UNIDADE", "BL", "BLISTER", "C/", "COM", "CART", "CARTELA", "FLAC", "FLACONETE",
    "CO", "PCT", "PACOTE", "SACHE", "SACHET", "ENV", "ENVELOPE", "GOTAS", "GTS", "SER", "SERINGA",
    "LATA", "POT", "POTE", "BISN", "BISNAGA", "S/A", "LT", "KG", "GRS"
  ];

  const normalized = upper.replace(/[^A-Z0-9]/g, " ");
  const rawWords = normalized.split(/\s+/).filter(w => w.length > 0);

  const cleanWords: string[] = [];
  for (const w of rawWords) {
    if (ignoreList.includes(w) || presentationWords.includes(w)) {
      continue;
    }
    const cleaned = w.replace(/^(\d+)(CP|CPS|COMP|COMPRIMIDOS|CAPS|CAPSULAS|CAP|CX|CAIXA|AMP|AMPOLA|FR|FRASCO|UN|UNIDADE|BL|BLISTER|CO|FLAC|FLACONETE|CART|CARTELA|PCT|PACOTE|SACHE|SACHET|ENV|ENVELOPE|GOTAS|GTS|SER|SERINGA|LATA|POT|POTE|BISN|BISNAGA|KG|GRS)$/i, "$1");

    if (cleaned && cleaned.length > 0 && !ignoreList.includes(cleaned) && !presentationWords.includes(cleaned)) {
      cleanWords.push(cleaned);
    }
  }

  return cleanWords;
}

export type CategoriaProduto = "generico" | "marca" | "similar" | "perfumaria" | "outros";

export function resolveCategoria(item: any): CategoriaProduto {
  if (!item) return "outros";

  // 1. FONTE PRIMARIA: Ferramentinhas "grupo" (mais confiavel, 100% nos testes)
  // Normalizar acentos: "Genérico" → "generico", "Referência" → "referencia"
  const grupo = (item.grupo || item.classificacao || "").toLowerCase().normalize("NFD").replace(/[\u0300-\u036f]/g, "");
  if (grupo.includes("generico")) return "generico";
  if (grupo.includes("similar")) return "similar";
  if (grupo.includes("referencia") || grupo.includes("marca")) return "marca";
  if (grupo.includes("perfumaria") || grupo.includes("correlatos")) return "perfumaria";

  // 2. FALLBACK: SmartPed TipoItem (as vezes vazio, 46% dos casos)
  const tipo = (item.TipoItem || item.tipoItem || "").toUpperCase();
  if (tipo === "G") return "generico";
  if (tipo === "M") return "marca";
  if (tipo === "S") return "similar";
  if (tipo === "P") return "perfumaria";

  // 3. FALLBACK 2: Sufixo Molecula (ex: "LOSARTANA_50MG 30 CP_G")
  const mol = (item.Molecula || item.molecula || "").toUpperCase();
  if (mol.endsWith("_G")) return "generico";
  if (mol.endsWith("_M")) return "marca";
  if (mol.endsWith("_S")) return "similar";
  if (mol.endsWith("_O")) return "outros";

  // 4. FALLBACK 3: Descricao (genéricos comprimidos podem ter Molecula vazio)
  const desc = (item.Descricao || item.descricao || "").toUpperCase();
  if (desc.includes(" GEN ") || desc.includes("GENERICO") || desc.includes("GENÉRICO")) return "generico";

  return "outros";
}

export interface ClassificacaoProduto {
  formaFarmaceutica: string;
  unidadeApresentacao: number | null;
  /** Fonte primária: cod_dcb:cod_concentracao (dosagem terapêutica real, só medicamento).
   *  Fallback: regex de texto (ex: "500MG", "20MG/ML", ou volume "300ML" em cosmético).
   *  Usado como critério de compatibilidade entre dois produtos — não é sempre "dosagem" no sentido farmacológico. */
  identificadorApresentacao: string | null;
  /** Identificador via cod_dcb:cod_concentracao (quando ambos existem). Ex: "06827:91" */
  dcbConcentracao: string | null;
  /** Identificador via regex de dosagem na descrição (sempre calculado quando possível). Ex: "750MG" */
  dosagemTexto: string | null;
  codDcb: string | null;
  codConcentracao: string | null;
  liberacaoProlongada: boolean;
}

const FORMAS_FARMaceuticas: string[][] = [
  ["ENV", "ENVELOPE"], ["CP", "COMPRIMIDO"], ["CAP", "CAPSULA"], ["SH", "SHAMPOO"],
  ["CR", "CREME"], ["DERM"], ["GEL"], ["LOCAO", "LOÇÃO"],
  ["POM", "POMADA"], ["SOL", "SOLUCAO"], ["AER", "AEROSOL"],
  ["AMP", "AMPOLA"], ["SUSP", "SUSPENSAO"], ["GTS", "GOTAS"], ["INJ", "INJETAVEL"],
  ["SACHET"], ["FR", "FRASCO"]
];

const DOSAGEM_REGEX = /\b(\d+(?:[.,]\d+)?)\s*(MG\/ML|MCG\/ML|G\/ML|MG\/G|MG|MCG|G|ML|UI|%)\b/i;

export function classificarProduto(item: any): ClassificacaoProduto {
  const desc = (item.descricao || item.description || item.nom_produto || item.Descricao || "").toUpperCase();
  const nomDesc = (item.nom_descapresentacao || "").toUpperCase();

  // 1. unidade_apresentacao (campo novo da API Ferramentinhas)
  let unidade: number | null = item.unidade_apresentacao ?? null;
  if (unidade === null && nomDesc) {
    const m = nomDesc.match(/C\/\s*(\d+)/);
    if (m) unidade = parseInt(m[1], 10);
  }
  if (unidade === null && desc) {
    const m = desc.match(/(\d+)\s*(?:CP|CPR|COMP|CAPS|CAP|DRG|BL|AMB|AMP|SACHET|ENVEL|UN)\b/);
    if (m) unidade = parseInt(m[1], 10);
  }

  // 2. Dosagem/volume: dois identificadores independentes
  const codDcb = item.cod_dcb || item.CodDcb || null;
  const codConc = item.cod_concentracao || item.CodConcentracao || null;

  // 2a. dcbConcentracao: cod_dcb:cod_concentracao (estruturado, só quando ambos existem)
  const dcbConcentracao = (codDcb && codConc) ? `${codDcb}:${codConc}` : null;

  // 2b. dosagemTexto: regex na descrição (sempre calculado, funciona para SICF sem DCB)
  const dosMatch = desc.match(DOSAGEM_REGEX);
  const dosagemTexto = dosMatch ? dosMatch[0].toUpperCase().replace(/\s+/g, "") : null;

  // identificadorApresentacao: mantido para retrocompatibilidade (DCB tem prioridade, fallback regex)
  let identificador: string | null = dcbConcentracao || dosagemTexto;

  // 3. Forma farmacêutica por keyword
  let forma = "";
  for (const grupo of FORMAS_FARMaceuticas) {
    if (grupo.some(k => hasWordBoundary(desc, k))) {
      forma = grupo[0];
      break;
    }
  }

  // 4. Liberação prolongada (L.P/XR) — nunca intercambiável com versão normal
  const liberacaoProlongada = hasWordBoundary(desc, "L.P") || hasWordBoundary(desc, "LP") || hasWordBoundary(desc, "XR");

  return { formaFarmaceutica: forma, unidadeApresentacao: unidade, identificadorApresentacao: identificador, dcbConcentracao, dosagemTexto, codDcb, codConcentracao: codConc, liberacaoProlongada };
}

export function mesmaApresentacao(a: any, b: any): boolean {
  const ca = classificarProduto(a);
  const cb = classificarProduto(b);

  const aTemDados = ca.unidadeApresentacao !== null || ca.formaFarmaceutica !== "" || ca.identificadorApresentacao !== null;
  const bTemDados = cb.unidadeApresentacao !== null || cb.formaFarmaceutica !== "" || cb.identificadorApresentacao !== null;

  // FAIL-SAFE: se nenhum dos dois tem qualquer dado → excluir
  if (!aTemDados && !bTemDados) return false;

  // Critério 1: identificador de dosagem — dois modos de comparação
  const temDcbA = !!ca.dcbConcentracao;
  const temDcbB = !!cb.dcbConcentracao;
  if (temDcbA && temDcbB) {
    // Ambos têm DCB+concentração → comparar por estrutura (catálogo vs catálogo)
    if (ca.dcbConcentracao !== cb.dcbConcentracao) return false;
    // DCB bata → verificar complementares se disponíveis
    // Unidade: se ambos têm, comparar (gotas=1 vs comprimidos=24 = diferente)
    if (ca.unidadeApresentacao !== null && cb.unidadeApresentacao !== null) {
      if (ca.unidadeApresentacao !== cb.unidadeApresentacao) return false;
    }
    // Forma farmacêutica: se product tem forma, candidato também deve ter (conservador)
    if (ca.formaFarmaceutica && !cb.formaFarmaceutica) return false;
    if (!ca.formaFarmaceutica && cb.formaFarmaceutica) return false;
    if (ca.formaFarmaceutica && cb.formaFarmaceutica && ca.formaFarmaceutica !== cb.formaFarmaceutica) return false;
    // Trava de liberação prolongada ainda vale
    if (ca.liberacaoProlongada !== cb.liberacaoProlongada) return false;
    return true;
  } else {
    // Pelo menos um sem DCB (ex: item SICF cru) → comparar por regex de dosagem
    const temDosagemA = !!ca.dosagemTexto;
    const temDosagemB = !!cb.dosagemTexto;
    if (temDosagemA !== temDosagemB) return false;
    if (temDosagemA && temDosagemB && ca.dosagemTexto !== cb.dosagemTexto) return false;
  }

  // Trava de exclusão: se ambos têm forma farmacêutica conhecida e ela diverge → excluir
  if (ca.formaFarmaceutica && cb.formaFarmaceutica && ca.formaFarmaceutica !== cb.formaFarmaceutica) {
    return false;
  }

  // Trava de exclusão: liberação prolongada (L.P/XR) nunca é a mesma
  // apresentação que a versão normal do mesmo remédio, mesmo com
  // DCB/concentração/unidade iguais.
  if (ca.liberacaoProlongada !== cb.liberacaoProlongada) {
    return false;
  }

  // Critério 2: unidade_apresentacao — se ambos têm, comparar direto
  if (ca.unidadeApresentacao !== null && cb.unidadeApresentacao !== null) {
    return ca.unidadeApresentacao === cb.unidadeApresentacao;
  }

  // Critério 3: forma farmacêutica — se ambos têm, devem ser iguais
  if (ca.formaFarmaceutica && cb.formaFarmaceutica) {
    return ca.formaFarmaceutica === cb.formaFarmaceutica;
  }

  // Sem overlap suficiente → excluir (fail-safe)
  return false;
}
