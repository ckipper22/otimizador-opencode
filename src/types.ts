export interface OptimizationSummary {
  totalItems: number;
  itemsTreated: number;
  itemsSwapped: number;
  totalSavings: number;
}

export interface SwapReportItem {
  codInterno: string;
  originalEan: string;
  originalDescricao: string;
  originalLaboratorio: string;
  originalPreco: number;
  novoEan: string;
  novaDescricao: string;
  novoLaboratorio: string;
  novoPreco: number;
  qtd: number;
  precoLiquido?: number;
  economiaUnit: number;
  economiaTotal: number;
  distribuidora: string;
  estoque: number;
  codDist?: number;
  condicao?: string;
  codProdutoDist?: string;
  prazo?: number;
  codProduto?: string;
  pedidoMinimo?: number;
  qtdMin?: number;
  qtdMax?: number;
  cx?: number;
  qtdMinima?: number;
  extra?: number;
  motivoAcao?: string;
  observacao?: string;
  avisoOriginal?: string;
  avisoNovo?: string;
  isShortage?: boolean;
  originalSemEstoque?: boolean;
  isRupturaSubstitution?: boolean;
  originalRupturaEan?: string;
  originalRupturaDescricao?: string;
  originalRupturaLaboratorio?: string;
  originalRupturaPreco?: number;
  originalPmc?: number;
  novoPmc?: number;
  origem?: string;
  idEncomenda?: string;
  whatsappDestino?: string;
  whatsappRuleId?: string;
  fornecedorLista?: string;
  fornecedorId?: string;
  vendasMensais?: number;
  estoqueTotal?: number;
  melhorPrecoHistorico?: number;
  melhorFornecedorHistorico?: string;
  tiers?: Array<{ minQty: number; price: number }>;
  discountTiers?: Array<{ minQty: number; discountPercent: number }>;
  originalDist?: string;
  originalCodDist?: number;
  originalEstoque?: number;
  originalPrecoCotado?: number;
  originalCondicao?: string;
  originalCodProdutoDist?: string;
  originalPrazo?: number;
  originalCodProduto?: string;
  alertaConfirmarQtd?: boolean;
  alternatives?: Array<{
    ean: string;
    descricao: string;
    laboratorio: string;
    preco: number;
    precoLiquido?: number;
    pmc?: number;
    condicao: string;
    distribuidora: string;
    codDist: number;
    prazo: number;
    qtdMin: number;
    qtdMax?: number;
    cx?: number;
    estoque: number;
    codProdutoDist?: string;
    codProduto?: string;
    pedidoMinimo?: number;
  }>;
}

export interface OptimizationResponse {
  optimizedFileContent: string;
  cnpj: string;
  summary: OptimizationSummary;
  report: SwapReportItem[];
  error?: string;
}

export interface WhatsAppRule {
  id: string;
  nomeRegra: string;
  termoFiltro: string;
  nomeRepresentante?: string;
  telefone?: string;
  tipoFiltro?: "genericos" | "eticos" | "todos";
  ocultarPrecos?: boolean;
  ativo?: boolean;
}

export interface WhatsAppOrderItem {
  ean: string;
  descricao: string;
  laboratorio?: string;
  qtd: number;
  preco?: number;
  precoLiquido?: number;
  observacao?: string;
}

export interface WhatsAppOrder {
  id: number;
  dataPedido: string;
  fornecedor: string;
  telefone?: string;
  itens: WhatsAppOrderItem[];
  status: "Pendente" | "Confirmado" | "Recebido" | "Cancelado";
  observacao?: string;
  origem: "lista" | "regra_lab";
  cnpj: string;
}

export interface OptimizerConfig {
  token: string;
  cnpj: string;
  margemMinima: number;
  tipos: string[];
  permitirSemEstoque: boolean;
  customEndpoint?: string;
  direcionarEurofarmaWhatsapp?: boolean;
  telefoneWhatsappEurofarma?: string;
  whatsAppRules?: WhatsAppRule[];
  alertaProfarma48h?: boolean;
  alertaConfirmarQtdCaixaMaster?: boolean;
  bypassMargemRuptura?: boolean;
}

export interface DailyOrderDist {
  NomeDist?: string;
  Status?: number;
}

export interface DailyOrderItem {
  Ean?: string;
  Quant?: number;
  QuantFaturada?: number;
  Motivo?: string;
  NomeDist?: string;
  Preco?: number;
  Descricao?: string;
}

export interface DailyOrderDetail {
  dists?: DailyOrderDist[];
  Itens?: DailyOrderItem[];
}

export interface DailyOrder {
  numPedido: string | number;
  dataPedido: string;
  detalhes: DailyOrderDetail;
}

export interface FaturadoItem {
  fornecedor: string;
  ean: string;
  descricao: string;
  laboratorio: string;
  valor: number;
  quantidade: number;
  notaCupom?: string;
}

export interface DistributorOption {
  Codigo: number;
  Nome: string;
  LiberadoEnvio: number;
  StatusAtual: string;
}

export interface PriceTier {
  minQty: number;
  price: number;
}

export interface ExternalProduct {
  description: string;
  price: number | null;
  discountPercent?: number;
  tiers?: PriceTier[];
  discountTiers?: Array<{ minQty: number; discountPercent: number }>;
  validade?: string | null;
}

export interface ExternalSupplier {
  id: string;
  name: string;
  rawText: string;
  validade: string;
  products: ExternalProduct[];
}

export interface AuthorizedCompany {
  id: string;
  email: string;
  nome: string;
  token?: string;
  cnpj?: string;
}

