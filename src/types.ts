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
  isShortage?: boolean;
  originalSemEstoque?: boolean;
  isRupturaSubstitution?: boolean;
  originalRupturaEan?: string;
  originalRupturaDescricao?: string;
  originalRupturaLaboratorio?: string;
  originalRupturaPreco?: number;
  originalPmc?: number;
  novoPmc?: number;
  alternatives?: Array<{
    ean: string;
    descricao: string;
    laboratorio: string;
    preco: number;
    pmc?: number;
    condicao: string;
    distribuidora: string;
    codDist: number;
    prazo: number;
    qtdMin: number;
    qtdMax: number;
    cx: number;
    estoque: number;
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
  ocultarPrecos?: boolean;
  ativo?: boolean;
}

export interface OptimizerConfig {
  token: string;
  cnpj: string;
  margemMinima: number;
  tipos: string[];
  permitirSemEstoque: boolean;
  useTestUrl: boolean;
  simulationMode: boolean;
  customProductionUrl?: string;
  customTestUrl?: string;
  customEndpoint?: string;
  direcionarEurofarmaWhatsapp?: boolean;
  telefoneWhatsappEurofarma?: string;
  whatsAppRules?: WhatsAppRule[];
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
}

export interface DistributorOption {
  Codigo: number;
  Nome: string;
  LiberadoEnvio: number;
  StatusAtual: string;
}

export interface ExternalProduct {
  description: string;
  price: number;
}

export interface ExternalSupplier {
  id: string;
  name: string;
  rawText: string;
  products: ExternalProduct[];
}

export interface AuthorizedCompany {
  id: string;
  email: string;
  nome: string;
  token?: string;
  cnpj?: string;
}

