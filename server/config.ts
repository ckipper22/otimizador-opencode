import dotenv from "dotenv";

dotenv.config();

export const CONFIG = {
  SMARTPED_PRODUCTION_TOKEN: process.env.SMARTPED_PRODUCTION_TOKEN || "",
  SMARTPED_DEFAULT_CNPJ: process.env.SMARTPED_DEFAULT_CNPJ || "13408443000168",
  SMARTPED_PRODUCTION_URL: process.env.SMARTPED_PRODUCTION_URL || "https://api.smartped.com.br",
  FERRAMENTINHAS_API_URL: process.env.FERRAMENTINHAS_API_URL || "https://api.ferramentinhas.com.br",
  APP_ADMIN_EMAILS: (process.env.APP_ADMIN_EMAILS || "ckipper22@gmail.com,aga706panambi@gmail.com").split(",").map(e => e.trim().toLowerCase()),
  APP_ADMIN_PASSWORD: process.env.APP_ADMIN_PASSWORD || "",
  HISTORICO_COMPRAS_MESES: parseInt(process.env.HISTORICO_COMPRAS_MESES || "12", 10),
};

export const PORT = process.env.PORT ? parseInt(process.env.PORT, 10) : (process.env.NODE_ENV === "production" ? 8080 : 3000);
