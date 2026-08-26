const SENSITIVE_TERMS = [
  "LIMAO", "GUARANA", "LARANJA", "MORANGO", "ABACAXI", "UVA", "MENTA",
  "TUTTI FRUTTI", "EUCALIPTO", "TRADICIONAL", "SEM SABOR",
  "CHOCOLATE", "BAUNILHA", "NEUTRO", "COCO", "MACA", "CEREJA",
  "MELANCIA", "MARACUJA", "PESSEGO", "TANGERINA", "SALADA DE FRUTAS",
  "FRUTAS VERMELHAS", "FRUTAS TROPICAIS", "FRUTAS SILVESTRES",
  "VERMELHO", "ROSA", "AZUL", "AMARELO", "VERDE", "BRANCO", "PRETO", "CINZA",
  "DOURADO", "PRATA", "ALFAZEMA", "LAVANDA", "ERVA DOCE", "CALENDULA",
  "CAMOMILA", "ALECRIM", "FRAMBOESA", "AMETISTA", "RENDA", "RENDINHA", "AMARELINDO",
  "NUDE", "LILAS", "CORAL", "VINHO", "MARROM", "BEGE", "CREME"
];
const SENSITIVE_REGEXES = SENSITIVE_TERMS.map(
  term => new RegExp(`\\b${term.replace(/\s+/g, "\\s+")}\\b`, 'i')
);

export function validateSwapEquivalence(
  orig: any,
  alt: any
): boolean {
  if (!orig || !alt) return true;

  const getDesc = (val: any): string => {
    if (!val) return "";
    if (typeof val === "string") return val;
    if (typeof val === "object" && val !== null) {
      return (
        val.descricao ||
        val.Descricao ||
        val.description ||
        val.Description ||
        val.DescricaoProduto_Idi ||
        val.descricaoProduto_Idi ||
        val.DescricaoProduto ||
        val.descricaoProduto ||
        val.nom_produto ||
        val.Nom_Produto ||
        val.produto ||
        val.Produto ||
        val.nome ||
        val.Nome ||
        val.desc ||
        val.Desc ||
        ""
      );
    }
    return String(val);
  };

  const getTipo = (val: any): string => {
    if (!val || typeof val !== "object") return "";
    return String(
      val.tipo ||
      val.Tipo ||
      val.tipoItem ||
      val.TipoItem ||
      val.Tipo_Item ||
      val.tipo_item ||
      val.categoria ||
      val.Categoria ||
      val.classificacao ||
      val.Classificacao ||
      ""
    ).trim().toUpperCase();
  };

  const getLab = (val: any): string => {
    if (!val || typeof val !== "object") return "";
    return String(
      val.laboratorio ||
      val.Laboratorio ||
      val.laboratory ||
      val.nom_laborat ||
      val.nom_laboratorio ||
      val.fabricante ||
      val.Fabricante ||
      ""
    ).trim().toUpperCase();
  };

  const getDosageProp = (val: any): string | null => {
    if (typeof val === "object" && val !== null && val.dosagem) {
      return String(val.dosagem).toUpperCase().trim();
    }
    return null;
  };

  const getQtdProp = (val: any): number | null => {
    if (typeof val === "object" && val !== null) {
      const q = val.qtd !== undefined ? val.qtd : (val.Qtd !== undefined ? val.Qtd : val.quantidade);
      if (q !== undefined && q !== null) {
        const parsed = parseFloat(String(q).replace(",", "."));
        if (!isNaN(parsed) && parsed > 0) return parsed;
      }
    }
    return null;
  };

  const origEanStr = typeof orig === "object" && orig ? String(orig.Ean || orig.ean || orig.cod_barra || "").replace(/\D/g, "") : "";
  const altEanStr = typeof alt === "object" && alt ? String(alt.Ean || alt.ean || alt.cod_barra || "").replace(/\D/g, "") : "";

  // Se forem exatamente o mesmo EAN, é a mesma mercadoria
  if (origEanStr && altEanStr && origEanStr === altEanStr) {
    return true;
  }

  const origDesc = getDesc(orig);
  const altDesc = getDesc(alt);

  // Se uma das descrições estiver ausente e não for o mesmo EAN, recusa por precaução de segurança
  if (!origDesc || !altDesc) {
    return false;
  }

  // 0. Direto por propriedade se fornecida no objeto
  const origDosProp = getDosageProp(orig);
  const altDosProp = getDosageProp(alt);
  if (origDosProp && altDosProp && origDosProp !== altDosProp) {
    return false;
  }

  const origQtdProp = getQtdProp(orig);
  const altQtdProp = getQtdProp(alt);
  if (origQtdProp !== null && altQtdProp !== null && origQtdProp !== altQtdProp) {
    return false;
  }

  // 1. Função de Normalização de Texto: Remover acentos, caixa alta, caracteres especiais
  const normalizeText = (text: string) => {
    if (!text) return "";
    return text
      .normalize("NFD")
      .replace(/[\u0300-\u036f]/g, "") // remove acentos
      .toUpperCase()
      .replace(/[^A-Z0-9\s]/g, " ")   // remove caracteres especiais, mantendo espaço
      .replace(/\s+/g, " ")
      .trim();
  };

  const normOrig = normalizeText(origDesc);
  const normAlt = normalizeText(altDesc);

  // Trava Comercial Estrita de Não-Substituição de Medicamentos de Referência (Éticos)
  const origTipo = getTipo(orig);
  const isOrigReferencia = 
    origTipo === "REFERENCIA" || 
    origTipo === "REFERÊNCIA" || 
    origTipo === "ETICO" || 
    origTipo === "ÉTICO" || 
    origTipo === "R" || 
    origTipo === "E";

  const origLab = getLab(orig);
  const isDaiichi = origLab.includes("DAIICHI") || origLab.includes("SANKYO");
  const isHirudoid = normOrig.includes("HIRUDOID");

  if (isOrigReferencia || isDaiichi || isHirudoid) {
    // Se os EANs forem diferentes, a troca deve ser bloqueada sumariamente para segurança absoluta
    if (!origEanStr || !altEanStr || origEanStr !== altEanStr) {
      return false;
    }
  }

  // 2. Dicionário de Palavras-Chave de Sabores, Fragrâncias e Cores
  // 3. Regra de Rejeição Absoluta (Hard Block de Sabores/Cores/Fragrâncias)
  for (const termRegex of SENSITIVE_REGEXES) {
    const origHas = termRegex.test(normOrig);
    const altHas = termRegex.test(normAlt);
    if (origHas !== altHas) {
      return false; // Rejeição absoluta imediata por divergência de sabor/fragrância/cor!
    }
  }

  // 4. Match de Dosagem / Concentração
  const extractDosages = (desc: string) => {
    const DOSAGE_REGEX = /\b\d+(?:[.,]\d+)?\s*(?:MG\/ML|MCG\/ML|G\/ML|MG|MCG|G|ML|UI|%)\b/gi;
    const matches = desc.match(DOSAGE_REGEX) || [];
    return Array.from(new Set(matches.map(m => m.toUpperCase().replace(/\s+/g, "").replace(",", "."))));
  };

  const origDosages = extractDosages(normOrig);
  const altDosages = extractDosages(normAlt);

  if (origDosages.length > 0 || altDosages.length > 0) {
    if (origDosages.length !== altDosages.length) return false;
    const sortedOrig = [...origDosages].sort();
    const sortedAlt = [...altDosages].sort();
    for (let i = 0; i < sortedOrig.length; i++) {
      if (sortedOrig[i] !== sortedAlt[i]) return false;
    }
  }

  // 5. Match de Quantidade de Comprimidos / Apresentação (Tolerância Estrita)
  const extractPresentations = (desc: string) => {
    const matches: string[] = [];
    const p1 = desc.match(/\b\d+\s*(?:CP|COMP|CAPS|CAP|CPR|DRG|SACHE|SACHET|AMP|ENV|EV)\b/gi) || [];
    p1.forEach(m => {
      const digits = m.match(/\d+/);
      if (digits) matches.push(digits[0]);
    });

    const p2 = desc.match(/\b(?:C|CX|COMPR)\/?\s*(\d+)\b/gi) || [];
    p2.forEach(m => {
      const digits = m.match(/\d+/);
      if (digits) matches.push(digits[0]);
    });

    return Array.from(new Set(matches));
  };

  const origPres = extractPresentations(normOrig);
  const altPres = extractPresentations(normAlt);

  if (origPres.length > 0 && altPres.length > 0) {
    const sortedOrig = [...origPres].sort();
    const sortedAlt = [...altPres].sort();
    if (sortedOrig.length !== sortedAlt.length) return false;
    for (let i = 0; i < sortedOrig.length; i++) {
      if (sortedOrig[i] !== sortedAlt[i]) return false;
    }
  }

  return true;
}

export function areDosagesEqual(desc1: string, desc2: string): boolean {
  return validateSwapEquivalence(desc1, desc2);
}

export function areFlavorsEqual(desc1: string, desc2: string): boolean {
  return validateSwapEquivalence(desc1, desc2);
}
