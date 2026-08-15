import { cleanEan } from "./ean-utils";

export const LOCAL_EQUIVALENTS_DB: Record<string, { ean: string; descricao: string; laboratorio: string; molecula: string; dosagem: string; apresentacao: string }[]> = {
  "PANTOPRAZOL 20MG 28CP": [
    { ean: "7891317454313", descricao: "PANTOPRAZOL 20MG 28CP", laboratorio: "EUROFARMA", molecula: "PANTOPRAZOL", dosagem: "20MG", apresentacao: "28CP" },
    { ean: "7891058021870", descricao: "PANTOPRAZOL 20MG 28CP", laboratorio: "ACHE", molecula: "PANTOPRAZOL", dosagem: "20MG", apresentacao: "28CP" },
    { ean: "7897595630322", descricao: "PANTOPRAZOL 20MG 28CP", laboratorio: "SANDOZ", molecula: "PANTOPRAZOL", dosagem: "20MG", apresentacao: "28CP" },
    { ean: "7896422505963", descricao: "PANTOPRAZOL 20MG 28CP", laboratorio: "MEDLEY", molecula: "PANTOPRAZOL", dosagem: "20MG", apresentacao: "28CP" },
    { ean: "7896004717144", descricao: "PANTOPRAZOL 20MG 28CP", laboratorio: "EMS", molecula: "PANTOPRAZOL", dosagem: "20MG", apresentacao: "28CP" },
    { ean: "7896714214221", descricao: "PANTOPRAZOL 20MG 28CP", laboratorio: "NEO QUIMICA", molecula: "PANTOPRAZOL", dosagem: "20MG", apresentacao: "28CP" },
    { ean: "7896112400304", descricao: "PANTOPRAZOL 20MG 28CP", laboratorio: "GERMED", molecula: "PANTOPRAZOL", dosagem: "20MG", apresentacao: "28CP" },
    { ean: "7894411244018", descricao: "PANTOPRAZOL 20MG 28CP", laboratorio: "TEUTO", molecula: "PANTOPRAZOL", dosagem: "20MG", apresentacao: "28CP" }
  ],
  "PANTOPRAZOL 40MG 28CP": [
    { ean: "7891317454351", descricao: "PANTOPRAZOL 40MG 28CP", laboratorio: "EUROFARMA", molecula: "PANTOPRAZOL", dosagem: "40MG", apresentacao: "28CP" },
    { ean: "7891058021894", descricao: "PANTOPRAZOL 40MG 28CP", laboratorio: "ACHE", molecula: "PANTOPRAZOL", dosagem: "40MG", apresentacao: "28CP" },
    { ean: "7897595630346", descricao: "PANTOPRAZOL 40MG 28CP", laboratorio: "SANDOZ", molecula: "PANTOPRAZOL", dosagem: "40MG", apresentacao: "28CP" },
    { ean: "7896422505987", descricao: "PANTOPRAZOL 40MG 28CP", laboratorio: "MEDLEY", molecula: "PANTOPRAZOL", dosagem: "40MG", apresentacao: "28CP" },
    { ean: "7896004717151", descricao: "PANTOPRAZOL 40MG 28CP", laboratorio: "EMS", molecula: "PANTOPRAZOL", dosagem: "40MG", apresentacao: "28CP" },
    { ean: "7896714214245", descricao: "PANTOPRAZOL 40MG 28CP", laboratorio: "NEO QUIMICA", molecula: "PANTOPRAZOL", dosagem: "40MG", apresentacao: "28CP" },
    { ean: "7896112400328", descricao: "PANTOPRAZOL 40MG 28CP", laboratorio: "GERMED", molecula: "PANTOPRAZOL", dosagem: "40MG", apresentacao: "28CP" },
    { ean: "7894411244032", descricao: "PANTOPRAZOL 40MG 28CP", laboratorio: "TEUTO", molecula: "PANTOPRAZOL", dosagem: "40MG", apresentacao: "28CP" }
  ],
  "DAPAGLIFLOZINA 10MG 30CP": [
    { ean: "7896014194881", descricao: "FORXIGA 10MG 30CP", laboratorio: "ASTRAZENECA", molecula: "DAPAGLIFLOZINA", dosagem: "10MG", apresentacao: "30CP" },
    { ean: "7896862994372", descricao: "DAPAGLIFLOZINA 10MG 30CP", laboratorio: "MEDQUIMICA", molecula: "DAPAGLIFLOZINA", dosagem: "10MG", apresentacao: "30CP" },
    { ean: "7896004780285", descricao: "DAPAGLIFLOZINA 10MG 30CP", laboratorio: "EMS", molecula: "DAPAGLIFLOZINA", dosagem: "10MG", apresentacao: "30CP" },
    { ean: "7891317025810", descricao: "DAPAGLIFLOZINA 10MG 30CP", laboratorio: "EUROFARMA", molecula: "DAPAGLIFLOZINA", dosagem: "10MG", apresentacao: "30CP" },
    { ean: "7896422534574", descricao: "DAPAGLIFLOZINA 10MG 30CP", laboratorio: "MEDLEY", molecula: "DAPAGLIFLOZINA", dosagem: "10MG", apresentacao: "30CP" },
    { ean: "7891058022983", descricao: "DAPAGLIFLOZINA 10MG 30CP", laboratorio: "ACHE", molecula: "DAPAGLIFLOZINA", dosagem: "10MG", apresentacao: "30CP" }
  ],
  "EZETIMIBA 10MG 30CP": [
    { ean: "7891317004457", descricao: "EZETIMIBA 10MG 30CP", laboratorio: "EUROFARMA", molecula: "EZETIMIBA", dosagem: "10MG", apresentacao: "30CP" },
    { ean: "7896004718547", descricao: "EZETIMIBA 10MG 30CP", laboratorio: "EMS", molecula: "EZETIMIBA", dosagem: "10MG", apresentacao: "30CP" },
    { ean: "7891058013219", descricao: "EZETIMIBA 10MG 30CP", laboratorio: "ACHE", molecula: "EZETIMIBA", dosagem: "10MG", apresentacao: "30CP" },
    { ean: "7896422515092", descricao: "EZETIMIBA 10MG 30CP", laboratorio: "MEDLEY", molecula: "EZETIMIBA", dosagem: "10MG", apresentacao: "30CP" },
    { ean: "7896714217130", descricao: "EZETIMIBA 10MG 30CP", laboratorio: "NEO QUIMICA", molecula: "EZETIMIBA", dosagem: "10MG", apresentacao: "30CP" },
    { ean: "7897595631244", descricao: "EZETIMIBA 10MG 30CP", laboratorio: "SANDOZ", molecula: "EZETIMIBA", dosagem: "10MG", apresentacao: "30CP" }
  ]
};

export function getLocalEquivalents(ean: string, descricao?: string): string[] {
  const cleaned = cleanEan(ean);
  if (!cleaned) return [];

  for (const key of Object.keys(LOCAL_EQUIVALENTS_DB)) {
    const list = LOCAL_EQUIVALENTS_DB[key];
    if (list.some(item => cleanEan(item.ean) === cleaned)) {
      return list.map(item => cleanEan(item.ean)).filter(eq => eq !== cleaned);
    }
  }

  if (descricao) {
    const cleanTokens = (text: string) => {
      if (!text) return [];
      return text
        .normalize("NFD")
        .replace(/[\u0300-\u036f]/g, "")
        .toUpperCase()
        .replace(/\b(SODICO|SODICA|SÓDICO|SÓDICA|CLORIDRATO|MALEATO|MESILATO|HEMITARTARATO|TARTARATO|DE|DI|MONO|POTASSICO|POTÁSSICO|SULFATO|ZINCICO|ZÍNCICO|CALCICA|CALCICO|CÁLCICO|MONOHIDRATADO|MONOIDRATADO|LACTATO|CARBONATO|ACETATO|FOSFATO|BROMIDRATO|CITRATO|ESTEARATO|SUCCINATO)\b/gi, " ")
        .split(/[\s+,\-/]/)
        .map(w => w.trim())
        .filter(w => w.length > 1);
    };

    const inputTokens = cleanTokens(descricao);

    if (inputTokens.length > 0) {
      for (const key of Object.keys(LOCAL_EQUIVALENTS_DB)) {
        const keyTokens = cleanTokens(key);

        const allInputTokensInKey = inputTokens.every(it =>
          keyTokens.some(kt => kt === it || kt.includes(it) || it.includes(kt))
        );

        if (allInputTokensInKey) {
          return LOCAL_EQUIVALENTS_DB[key].map(item => cleanEan(item.ean)).filter(eq => eq !== cleaned);
        }
      }
    }
  }

  return [];
}
