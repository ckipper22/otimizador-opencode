import React from "react";
import { Settings, HelpCircle, Shield, Play, Sliders, Plus, Trash2, ChevronDown, ChevronUp, MessageSquare, Edit2, Save, FileText, List, Check, X, Building2, UserCheck } from "lucide-react";
import { OptimizerConfig, ExternalSupplier, AuthorizedCompany, WhatsAppRule } from "../types";

interface ConfigurationPanelProps {
  config: OptimizerConfig;
  onChange: (config: OptimizerConfig) => void;
  onOptimize: () => void;
  isLoading: boolean;
  disabled: boolean;
  externalSuppliers: ExternalSupplier[];
  onUpdateExternalSuppliers: (suppliers: ExternalSupplier[]) => void;
  authorizedCompanies?: AuthorizedCompany[];
  onUpdateAuthorizedCompanies?: (companies: AuthorizedCompany[]) => void;
  isAdmin?: boolean;
}

export default function ConfigurationPanel({
  config,
  onChange,
  onOptimize,
  isLoading,
  disabled,
  externalSuppliers,
  onUpdateExternalSuppliers,
  authorizedCompanies = [],
  onUpdateAuthorizedCompanies,
  isAdmin = false
}: ConfigurationPanelProps) {
  const [showAdvanced, setShowAdvanced] = React.useState<boolean>(false);
  const [showSuppliersSection, setShowSuppliersSection] = React.useState<boolean>(false);
  const [showCompaniesSection, setShowCompaniesSection] = React.useState<boolean>(false);
  const [expandedSupplierId, setExpandedSupplierId] = React.useState<string | null>(null);

  // Regras de WhatsApp Parametrizadas
  const rulesList: WhatsAppRule[] = (config.whatsAppRules && config.whatsAppRules.length > 0)
    ? config.whatsAppRules
    : [{
        id: "rule_eurofarma_default",
        nomeRegra: "Genéricos Eurofarma",
        termoFiltro: "EUROFARMA",
        nomeRepresentante: "Representante Eurofarma",
        telefone: config.telefoneWhatsappEurofarma || "",
        ocultarPrecos: true,
        ativo: true
      }];

  const handleAddRule = () => {
    const newRule: WhatsAppRule = {
      id: `rule_${Date.now()}`,
      nomeRegra: "Novo Representante / Laboratório",
      termoFiltro: "",
      nomeRepresentante: "",
      telefone: "",
      ocultarPrecos: true,
      ativo: true
    };
    onChange({
      ...config,
      whatsAppRules: [...rulesList, newRule]
    });
  };

  const handleUpdateRule = (id: string, updatedFields: Partial<WhatsAppRule>) => {
    const updated = rulesList.map(r => r.id === id ? { ...r, ...updatedFields } : r);
    onChange({
      ...config,
      whatsAppRules: updated
    });
  };

  const handleRemoveRule = (id: string) => {
    const updated = rulesList.filter(r => r.id !== id);
    onChange({
      ...config,
      whatsAppRules: updated
    });
  };

  // Estados para cadastro de empresas autorizadas
  const [newCompNome, setNewCompNome] = React.useState("");
  const [newCompEmail, setNewCompEmail] = React.useState("");
  const [newCompToken, setNewCompToken] = React.useState("");
  const [newCompCnpj, setNewCompCnpj] = React.useState("");

  // Estados para abas e edição de itens individuais nos Fornecedores do WhatsApp
  const [supplierTabs, setSupplierTabs] = React.useState<Record<string, "text" | "items">>({});
  const [editingProductId, setEditingProductId] = React.useState<{ supplierId: string, index: number } | null>(null);
  const [editDescription, setEditDescription] = React.useState<string>("");
  const [editPrice, setEditPrice] = React.useState<string>("");
  const [showAddFormSupplierId, setShowAddFormSupplierId] = React.useState<string | null>(null);
  const [newProdDesc, setNewProdDesc] = React.useState<string>("");
  const [newProdPrice, setNewProdPrice] = React.useState<string>("");

  const parsePriceList = (text: string) => {
    const lines = text.split("\n");
    const products: { description: string; price: number }[] = [];
    let pendingDescription = "";

    for (const line of lines) {
      const trimmed = line.trim();
      if (!trimmed) continue;
      
      const priceRegex = /(?:r\$)?\s*(\d+[\d\s]*[,.]\d{2})(?:\s*[^0-9\r\n]*)?\s*$/i;
      const match = trimmed.match(priceRegex);
      if (match) {
        const priceStr = match[1].replace(/\s/g, "").replace(",", ".");
        const price = parseFloat(priceStr);
        let description = trimmed.substring(0, match.index).trim();
        description = description.replace(/[-\s•💊;]+$/, "").replace(/^[-\s•💊;]+/, "").trim();
        
        // Se a descrição na linha do preço for vazia ou apenas um marcador, usa a descrição pendente da linha anterior
        if ((!description || description === "-" || description === "•") && pendingDescription) {
          description = pendingDescription;
        }

        description = description.replace(/[-\s•💊;]+$/, "").replace(/^[-\s•💊;]+/, "").trim();
        if (description && !isNaN(price)) {
          products.push({ description, price });
          pendingDescription = ""; // Consumido
        }
      } else {
        // Se a linha não tem preço, guardamos ela como potencial descrição para a próxima linha
        pendingDescription = trimmed;
      }
    }
    return products;
  };

  const handleAddSupplier = () => {
    const newId = `sup_${Date.now()}`;
    const newSupplier: ExternalSupplier = {
      id: newId,
      name: `Fornecedor ${externalSuppliers.length + 1}`,
      rawText: "",
      products: []
    };
    onUpdateExternalSuppliers([...externalSuppliers, newSupplier]);
    setExpandedSupplierId(newId);
    setShowSuppliersSection(true);
  };

  const handleRemoveSupplier = (id: string) => {
    onUpdateExternalSuppliers(externalSuppliers.filter(s => s.id !== id));
    if (expandedSupplierId === id) {
      setExpandedSupplierId(null);
    }
  };

  const handleUpdateSupplier = (id: string, name: string, rawText: string) => {
    const updated = externalSuppliers.map(s => {
      if (s.id === id) {
        return {
          ...s,
          name,
          rawText,
          products: parsePriceList(rawText)
        };
      }
      return s;
    });
    onUpdateExternalSuppliers(updated);
  };

  // Deletar um produto individual de um fornecedor do WhatsApp
  const handleDeleteProduct = (supplierId: string, index: number) => {
    const updated = externalSuppliers.map(s => {
      if (s.id === supplierId) {
        const updatedProds = s.products.filter((_, idx) => idx !== index);
        const newRawText = updatedProds.map(p => `${p.description} ${p.price.toFixed(2).replace(".", ",")}`).join("\n");
        return {
          ...s,
          products: updatedProds,
          rawText: newRawText
        };
      }
      return s;
    });
    onUpdateExternalSuppliers(updated);
  };

  // Salvar a edição de um produto individual
  const handleSaveEditProduct = (supplierId: string, index: number, newDesc: string, newPriceStr: string) => {
    const price = parseFloat(newPriceStr.replace(",", ".")) || 0;
    const updated = externalSuppliers.map(s => {
      if (s.id === supplierId) {
        const updatedProds = s.products.map((p, idx) => {
          if (idx === index) {
            return { description: newDesc, price };
          }
          return p;
        });
        const newRawText = updatedProds.map(p => `${p.description} ${p.price.toFixed(2).replace(".", ",")}`).join("\n");
        return {
          ...s,
          products: updatedProds,
          rawText: newRawText
        };
      }
      return s;
    });
    onUpdateExternalSuppliers(updated);
    setEditingProductId(null);
  };

  // Adicionar produto manual/avulso
  const handleAddManualProduct = (supplierId: string, desc: string, priceStr: string) => {
    const price = parseFloat(priceStr.replace(",", ".")) || 0;
    if (!desc.trim() || price <= 0) return;
    const updated = externalSuppliers.map(s => {
      if (s.id === supplierId) {
        const updatedProds = [...s.products, { description: desc.trim(), price }];
        const newRawText = updatedProds.map(p => `${p.description} ${p.price.toFixed(2).replace(".", ",")}`).join("\n");
        return {
          ...s,
          products: updatedProds,
          rawText: newRawText
        };
      }
      return s;
    });
    onUpdateExternalSuppliers(updated);
    setNewProdDesc("");
    setNewProdPrice("");
    setShowAddFormSupplierId(null);
  };

  const handleInputChange = (e: React.ChangeEvent<HTMLInputElement>) => {
    const { name, value, type, checked } = e.target;
    onChange({
      ...config,
      [name]: type === "checkbox" ? checked : value
    });
  };

  const handleNumberChange = (e: React.ChangeEvent<HTMLInputElement>) => {
    const { name, value } = e.target;
    onChange({
      ...config,
      [name]: parseFloat(value) || 0
    });
  };

  const toggleType = (type: string) => {
    const updatedTipos = config.tipos.includes(type)
      ? config.tipos.filter((t) => t !== type)
      : [...config.tipos, type];
    onChange({
      ...config,
      tipos: updatedTipos
    });
  };

  return (
    <div id="configuration-panel" className="text-slate-800 space-y-6">
      <div>
        {/* Operation Mode */}
        <div className="mb-5 bg-slate-50 p-4 border border-slate-100 rounded-xl">
          <div className="flex items-center justify-between mb-2">
            <span className="text-[10px] font-bold uppercase tracking-widest text-slate-400">Ambiente de Execução</span>
          </div>
          <div className="flex flex-col space-y-2">
            <label className="flex items-start space-x-3 cursor-pointer">
              <input
                type="checkbox"
                name="simulationMode"
                checked={config.simulationMode}
                onChange={handleInputChange}
                className="w-4.5 h-4.5 text-indigo-600 bg-white border-slate-300 rounded focus:ring-indigo-500 accent-indigo-600 mt-0.5"
              />
              <div>
                <p className="text-xs font-bold text-slate-800">Modo de Simulação Offline</p>
                <p className="text-[10px] text-slate-500 mt-0.5 leading-relaxed">
                  Busca condições de ddemonstração locais sem chamadas HTTP externas reais. Ideal para homologação e demonstração.
                </p>
              </div>
            </label>
          </div>
        </div>

        {/* API Credentials */}
        <div className="space-y-4">
          <div>
            <label className="block text-xs font-semibold text-slate-700 mb-1.5 flex items-center justify-between">
              <span className="flex items-center gap-1.5">
                SmartPed API Token
                <span className="text-slate-400 cursor-help" title="Seu token de API fornecido pelo SmartPed.">
                  <HelpCircle className="w-3.5 h-3.5" />
                </span>
              </span>
            </label>
            <input
              type="text"
              name="token"
              disabled={config.simulationMode}
              value={config.simulationMode ? "79770c03eb119691f0355c5628c496e2" : config.token}
              onChange={handleInputChange}
              placeholder="Digite o Token da sua API"
              className="w-full bg-slate-50 border border-slate-200 rounded-lg py-2 px-3 text-xs font-mono text-slate-800 transition-all disabled:opacity-50 focus:outline-none focus:bg-white focus:ring-2 focus:ring-indigo-500/20 focus:border-indigo-500"
            />
          </div>

          <div>
            <label className="block text-xs font-semibold text-slate-700 mb-1.5 flex items-center justify-between">
              <span className="flex items-center gap-1.5">
                CNPJ do Cliente (Opcional)
                <span className="text-slate-400 cursor-help" title="Deixe vazio para extrair automaticamente do cabeçalho do arquivo SICF.">
                  <HelpCircle className="w-3.5 h-3.5" />
                </span>
              </span>
            </label>
            <input
              type="text"
              name="cnpj"
              disabled={config.simulationMode}
              value={config.simulationMode ? "11111111111111" : config.cnpj}
              onChange={handleInputChange}
              placeholder="Auto-extrair do arquivo"
              className="w-full bg-slate-50 border border-slate-200 rounded-lg py-2 px-3 text-xs font-mono text-slate-800 transition-all disabled:opacity-50 focus:outline-none focus:bg-white focus:ring-2 focus:ring-indigo-500/20 focus:border-indigo-500"
            />
            {((config.token === "79770c03eb119691f0355c5628c496e2" || !config.token) && !config.simulationMode) && (
              <div className="mt-2 p-2.5 bg-emerald-50 border-l-2 border-emerald-500 rounded-r-lg text-[10px] text-emerald-800 leading-relaxed">
                💡 <strong>Demonstração SmartPed</strong>: Ao usar o Token padrão de testes, o CNPJ é mapeado para <span className="font-bold">11111111111111</span> na API para evitar erros de vínculo. O arquivo baixado preserva seu CNPJ original intacto.
              </div>
            )}
          </div>

          {/* Configuration Settings */}
          <div className="grid grid-cols-2 gap-4">
            <div>
              <label className="block text-xs font-semibold text-slate-700 mb-1.5 flex items-center justify-between">
                <span className="flex items-center gap-1">
                  Economia Min.
                  <span className="text-slate-400 cursor-help" title="Diferença de preço mínima por unidade para realizar a troca (em R$).">
                    <HelpCircle className="w-3.5 h-3.5" />
                  </span>
                </span>
              </label>
              <div className="relative rounded-lg shadow-sm">
                <span className="absolute inset-y-0 left-0 pl-3 flex items-center text-xs text-slate-400 font-semibold font-mono">R$</span>
                <input
                  type="number"
                  step="0.01"
                  min="0"
                  name="margemMinima"
                  value={config.margemMinima}
                  onChange={handleNumberChange}
                  className="w-full bg-slate-50 border border-slate-200 rounded-lg py-2 pl-8 pr-3 text-xs font-mono text-slate-800 focus:outline-none focus:bg-white focus:ring-2 focus:ring-indigo-500/20 focus:border-indigo-500"
                />
              </div>
            </div>

            <div className="flex flex-col justify-end pb-1">
              <label className="flex items-center space-x-2 text-xs font-semibold text-slate-700 cursor-pointer mb-1">
                <input
                  type="checkbox"
                  name="permitirSemEstoque"
                  checked={config.permitirSemEstoque}
                  onChange={handleInputChange}
                  className="w-4.5 h-4.5 text-indigo-600 bg-white border-slate-300 rounded focus:ring-indigo-500 accent-indigo-600"
                />
                <span>Sem Estoque</span>
              </label>
            </div>
          </div>

          {/* Substitution Types */}
          <div>
            <span className="block text-xs font-semibold text-slate-700 mb-2">Tipos Aceitos para Substituição</span>
            <div className="flex space-x-2">
              <button
                type="button"
                onClick={() => toggleType("G")}
                className={`flex-1 py-2 px-3 border text-xs font-bold transition-all rounded-lg ${
                  config.tipos.includes("G")
                    ? "bg-indigo-600 text-white border-indigo-600 shadow-sm"
                    : "bg-slate-50 text-slate-600 border-slate-200 hover:bg-slate-100"
                }`}
              >
                G - Genérico
              </button>
              <button
                type="button"
                onClick={() => toggleType("O")}
                className={`flex-1 py-2 px-3 border text-xs font-bold transition-all rounded-lg ${
                  config.tipos.includes("O")
                    ? "bg-indigo-600 text-white border-indigo-600 shadow-sm"
                    : "bg-slate-50 text-slate-600 border-slate-200 hover:bg-slate-100"
                }`}
              >
                O - Similar
              </button>
            </div>
            <p className="text-[10px] text-slate-400 mt-1.5 leading-relaxed">
              Itens de perfumaria, higiene, ou sem molécula associada (P) nunca são alterados para garantir total segurança.
            </p>
          </div>

          {/* DIRECIONAMENTO E PARÂMETROS DE PEDIDOS VIA WHATSAPP */}
          <div className="bg-emerald-50/70 border border-emerald-200/80 p-3.5 rounded-lg space-y-3">
            <div className="flex items-center justify-between">
              <label className="flex items-center space-x-2.5 text-xs font-bold text-emerald-950 cursor-pointer">
                <input
                  type="checkbox"
                  name="direcionarEurofarmaWhatsapp"
                  checked={config.direcionarEurofarmaWhatsapp !== false}
                  onChange={(e) => {
                    onChange({
                      ...config,
                      direcionarEurofarmaWhatsapp: e.target.checked
                    });
                  }}
                  className="w-4.5 h-4.5 text-emerald-600 bg-white border-emerald-300 rounded focus:ring-emerald-500 accent-emerald-600 cursor-pointer"
                />
                <span className="flex items-center gap-1.5 text-emerald-950 font-bold">
                  <MessageSquare className="w-4 h-4 text-emerald-600 shrink-0" />
                  <span>Direcionar Pedidos Diretos via WhatsApp (Representantes)</span>
                </span>
              </label>
            </div>

            <p className="text-[10px] text-emerald-800/90 font-normal leading-relaxed">
              Cadastre e gerencie parâmetros para encaminhar itens de laboratórios (ex: Eurofarma, Medley, etc.) direto para o representante. <strong>Sem preços na mensagem</strong> por padrão (confia no preço negociado no dia).
            </p>

            {config.direcionarEurofarmaWhatsapp !== false && (
              <div className="space-y-2.5 pt-1">
                {rulesList.map((rule) => (
                  <div key={rule.id} className="bg-white border border-emerald-300/80 p-3 rounded-md shadow-xs space-y-2">
                    <div className="flex items-center justify-between gap-2 border-b border-emerald-100 pb-1.5">
                      <input
                        type="text"
                        value={rule.nomeRegra}
                        onChange={(e) => handleUpdateRule(rule.id, { nomeRegra: e.target.value })}
                        placeholder="Ex: Genéricos Eurofarma"
                        className="font-bold text-xs text-emerald-950 bg-slate-50 border border-slate-200 px-2 py-1 rounded focus:bg-white focus:outline-none focus:border-emerald-500 flex-1"
                      />
                      <div className="flex items-center gap-2 shrink-0">
                        <label className="flex items-center space-x-1 text-[10px] text-emerald-900 font-bold cursor-pointer">
                          <input
                            type="checkbox"
                            checked={rule.ativo !== false}
                            onChange={(e) => handleUpdateRule(rule.id, { ativo: e.target.checked })}
                            className="w-3.5 h-3.5 text-emerald-600 rounded accent-emerald-600"
                          />
                          <span>Ativo</span>
                        </label>
                        {rulesList.length > 1 && (
                          <button
                            type="button"
                            onClick={() => handleRemoveRule(rule.id)}
                            className="p-1 text-rose-500 hover:text-rose-700 hover:bg-rose-50 rounded cursor-pointer"
                            title="Remover Regra"
                          >
                            <Trash2 className="w-3.5 h-3.5" />
                          </button>
                        )}
                      </div>
                    </div>

                    <div className="grid grid-cols-1 sm:grid-cols-2 gap-2 text-[10px]">
                      <div>
                        <label className="block font-bold text-slate-600 mb-0.5">Termo / Laboratório Filtro</label>
                        <input
                          type="text"
                          value={rule.termoFiltro}
                          onChange={(e) => handleUpdateRule(rule.id, { termoFiltro: e.target.value })}
                          placeholder="Ex: EUROFARMA"
                          className="w-full bg-slate-50 border border-slate-200 rounded px-2 py-1 text-slate-800 font-mono focus:bg-white uppercase"
                        />
                      </div>
                      <div>
                        <label className="block font-bold text-slate-600 mb-0.5">Nome do Representante</label>
                        <input
                          type="text"
                          value={rule.nomeRepresentante || ""}
                          onChange={(e) => handleUpdateRule(rule.id, { nomeRepresentante: e.target.value })}
                          placeholder="Ex: João - Eurofarma"
                          className="w-full bg-slate-50 border border-slate-200 rounded px-2 py-1 text-slate-800 focus:bg-white"
                        />
                      </div>
                      <div className="sm:col-span-2">
                        <label className="block font-bold text-slate-600 mb-0.5">Telefone WhatsApp do Vendedor</label>
                        <input
                          type="text"
                          value={rule.telefone || ""}
                          onChange={(e) => handleUpdateRule(rule.id, { telefone: e.target.value })}
                          placeholder="Ex: (11) 99999-9999"
                          className="w-full bg-slate-50 border border-slate-200 rounded px-2 py-1 text-slate-800 font-mono focus:bg-white"
                        />
                      </div>
                    </div>

                    <div className="pt-1 flex items-center justify-between border-t border-slate-100">
                      <label className="flex items-center space-x-1.5 text-[10px] text-slate-700 font-semibold cursor-pointer">
                        <input
                          type="checkbox"
                          checked={rule.ocultarPrecos !== false}
                          onChange={(e) => handleUpdateRule(rule.id, { ocultarPrecos: e.target.checked })}
                          className="w-3.5 h-3.5 text-emerald-600 rounded accent-emerald-600"
                        />
                        <span>Ocultar preços na mensagem (envia só EAN e Quantidade)</span>
                      </label>
                    </div>
                  </div>
                ))}

                <button
                  type="button"
                  onClick={handleAddRule}
                  className="w-full py-1.5 bg-white hover:bg-emerald-100/50 text-emerald-800 border border-dashed border-emerald-400 font-bold text-xs rounded transition-all flex items-center justify-center space-x-1 cursor-pointer"
                >
                  <Plus className="w-3.5 h-3.5" />
                  <span>Adicionar Parâmetro / Representante WhatsApp</span>
                </button>
              </div>
            )}
          </div>

          {/* SEÇÃO FORNECEDORES WHATSAPP (COPIAR E COLAR / EDIÇÃO DE ITENS) */}
          <div className="border-t border-slate-100 pt-4 mt-4">
            <button
              type="button"
              onClick={() => setShowSuppliersSection(!showSuppliersSection)}
              className="w-full flex items-center justify-between text-xs font-semibold text-slate-700 hover:text-indigo-600 focus:outline-none"
            >
              <span className="flex items-center gap-1.5">
                <MessageSquare className="w-4 h-4 text-emerald-600" />
                <span>Tabelas de Fornecedores WhatsApp</span>
                {externalSuppliers.length > 0 && (
                  <span className="bg-emerald-100 text-emerald-800 text-[9px] px-1.5 py-0.5 font-bold rounded-full">
                    {externalSuppliers.length}
                  </span>
                )}
              </span>
              {showSuppliersSection ? <ChevronUp className="w-4 h-4" /> : <ChevronDown className="w-4 h-4" />}
            </button>

            {showSuppliersSection && (
              <div className="mt-3 space-y-3">
                <p className="text-[10px] text-slate-500 leading-normal">
                  Cole tabelas recebidas ou gerencie produtos individualmente. O otimizador buscará automaticamente e comparará de forma precisa.
                </p>

                {externalSuppliers.length === 0 ? (
                  <div className="p-3 bg-slate-50 border border-dashed border-slate-200 rounded-lg text-center text-[10px] text-slate-400">
                    Nenhum fornecedor externo cadastrado.
                  </div>
                ) : (
                  <div className="space-y-2">
                    {externalSuppliers.map((sup) => {
                      const isExpanded = expandedSupplierId === sup.id;
                      const activeTab = supplierTabs[sup.id] || "text";
                      return (
                        <div key={sup.id} className="border border-slate-200 rounded-lg overflow-hidden bg-white shadow-xs">
                          <div 
                            onClick={() => setExpandedSupplierId(isExpanded ? null : sup.id)}
                            className="px-3 py-2 bg-slate-50 border-b border-slate-200/55 flex items-center justify-between cursor-pointer hover:bg-slate-100"
                          >
                            <span className="text-xs font-bold text-slate-700">{sup.name || "Sem Nome"}</span>
                            <div className="flex items-center space-x-2">
                              <span className="text-[9px] font-semibold bg-emerald-50 text-emerald-700 border border-emerald-200 px-1.5 py-0.5 rounded">
                                {sup.products.length} itens
                              </span>
                              <button
                                type="button"
                                onClick={(e) => {
                                  e.stopPropagation();
                                  handleRemoveSupplier(sup.id);
                                }}
                                className="text-rose-500 hover:text-rose-700 focus:outline-none p-0.5 rounded hover:bg-slate-200/50"
                                title="Excluir Fornecedor"
                              >
                                <Trash2 className="w-3.5 h-3.5" />
                              </button>
                            </div>
                          </div>

                          {isExpanded && (
                            <div className="p-3 space-y-3 bg-white">
                              {/* Tabs de Controle do Fornecedor */}
                              <div className="flex border-b border-slate-100 mb-2">
                                <button
                                  type="button"
                                  onClick={() => setSupplierTabs({ ...supplierTabs, [sup.id]: "text" })}
                                  className={`flex-1 py-1.5 text-[10px] font-bold text-center flex items-center justify-center gap-1 border-b-2 transition-colors cursor-pointer ${
                                    activeTab === "text"
                                      ? "border-emerald-500 text-emerald-700 bg-emerald-50/25"
                                      : "border-transparent text-slate-500 hover:text-slate-700"
                                  }`}
                                >
                                  <FileText className="w-3 h-3" />
                                  <span>Texto Copiado</span>
                                </button>
                                <button
                                  type="button"
                                  onClick={() => setSupplierTabs({ ...supplierTabs, [sup.id]: "items" })}
                                  className={`flex-1 py-1.5 text-[10px] font-bold text-center flex items-center justify-center gap-1 border-b-2 transition-colors cursor-pointer ${
                                    activeTab === "items"
                                      ? "border-emerald-500 text-emerald-700 bg-emerald-50/25"
                                      : "border-transparent text-slate-500 hover:text-slate-700"
                                  }`}
                                >
                                  <List className="w-3 h-3" />
                                  <span>Produtos ({sup.products.length})</span>
                                </button>
                              </div>

                              {/* Conteúdo Aba TEXTO COPIADO */}
                              {activeTab === "text" && (
                                <div className="space-y-2.5">
                                  <div>
                                    <label className="block text-[9px] font-bold text-slate-500 uppercase mb-1">Nome do Fornecedor / Tabela</label>
                                    <input
                                      type="text"
                                      value={sup.name}
                                      onChange={(e) => handleUpdateSupplier(sup.id, e.target.value, sup.rawText)}
                                      placeholder="Ex: Germed Promo, WhatsApp Distribuidor"
                                      className="w-full bg-slate-50 border border-slate-200 rounded px-2.5 py-1.5 text-xs text-slate-800 focus:bg-white focus:outline-none focus:ring-1 focus:ring-indigo-500"
                                    />
                                  </div>

                                  <div>
                                    <label className="block text-[9px] font-bold text-slate-500 uppercase mb-1">Colar Tabela de Preços (WhatsApp)</label>
                                    <textarea
                                      value={sup.rawText}
                                      onChange={(e) => handleUpdateSupplier(sup.id, sup.name, e.target.value)}
                                      placeholder={`Cole o texto do WhatsApp aqui...\nExemplo:\nTadalafila 5mg 30cp Germed 5,99\nEnalapril 2,49\nSinvastatina Novartis 3,19`}
                                      className="w-full bg-slate-50 border border-slate-200 rounded px-2.5 py-1.5 text-[11px] font-mono text-slate-700 focus:bg-white focus:outline-none focus:ring-1 focus:ring-indigo-500 h-28 resize-none"
                                    />
                                  </div>
                                </div>
                              )}

                              {/* Conteúdo Aba PRODUTOS IDENTIFICADOS */}
                              {activeTab === "items" && (
                                <div className="space-y-2.5">
                                  <div className="max-h-[220px] overflow-y-auto border border-slate-100 rounded-lg p-2 bg-slate-50 space-y-1.5 scrollbar-thin">
                                    {sup.products.length === 0 ? (
                                      <p className="text-center text-[10px] text-slate-400 py-4">
                                        Nenhum item reconhecido. Cole um texto ou adicione manualmente abaixo.
                                      </p>
                                    ) : (
                                      sup.products.map((prod, pIdx) => {
                                        const isEditing = editingProductId?.supplierId === sup.id && editingProductId?.index === pIdx;
                                        return (
                                          <div key={pIdx} className="flex items-center justify-between p-2 bg-white rounded border border-slate-200/60 shadow-xs text-xs">
                                            {isEditing ? (
                                              <div className="flex flex-1 items-center space-x-1">
                                                <input
                                                  type="text"
                                                  value={editDescription}
                                                  onChange={(e) => setEditDescription(e.target.value)}
                                                  className="flex-1 min-w-0 bg-slate-50 border border-slate-300 rounded px-1.5 py-1 text-[11px] focus:bg-white focus:outline-none"
                                                />
                                                <div className="relative w-16 shrink-0">
                                                  <span className="absolute inset-y-0 left-1 flex items-center text-[9px] text-slate-400">R$</span>
                                                  <input
                                                    type="text"
                                                    value={editPrice}
                                                    onChange={(e) => setEditPrice(e.target.value)}
                                                    className="w-full bg-slate-50 border border-slate-300 rounded pl-4 pr-1 py-1 text-[11px] text-right focus:bg-white focus:outline-none font-mono"
                                                  />
                                                </div>
                                                <div className="flex items-center space-x-0.5 shrink-0">
                                                  <button
                                                    type="button"
                                                    onClick={() => handleSaveEditProduct(sup.id, pIdx, editDescription, editPrice)}
                                                    className="p-1 bg-emerald-500 hover:bg-emerald-600 text-white rounded cursor-pointer"
                                                    title="Salvar"
                                                  >
                                                    <Check className="w-3 h-3" />
                                                  </button>
                                                  <button
                                                    type="button"
                                                    onClick={() => setEditingProductId(null)}
                                                    className="p-1 bg-slate-200 hover:bg-slate-300 text-slate-600 rounded cursor-pointer"
                                                    title="Cancelar"
                                                  >
                                                    <X className="w-3 h-3" />
                                                  </button>
                                                </div>
                                              </div>
                                            ) : (
                                              <>
                                                <div className="flex-1 min-w-0 pr-2">
                                                  <p className="font-semibold text-slate-700 truncate" title={prod.description}>
                                                    {prod.description}
                                                  </p>
                                                </div>
                                                <div className="flex items-center space-x-1.5 shrink-0">
                                                  <span className="font-mono font-bold text-emerald-700 bg-emerald-50 px-1.5 py-0.5 rounded text-[10px]">
                                                    R$ {prod.price.toLocaleString("pt-BR", { minimumFractionDigits: 2, maximumFractionDigits: 2 })}
                                                  </span>
                                                  <button
                                                    type="button"
                                                    onClick={() => {
                                                      setEditingProductId({ supplierId: sup.id, index: pIdx });
                                                      setEditDescription(prod.description);
                                                      setEditPrice(prod.price.toFixed(2).replace(".", ","));
                                                    }}
                                                    className="p-1 text-slate-400 hover:text-indigo-600 focus:outline-none cursor-pointer hover:bg-slate-100 rounded"
                                                    title="Editar item"
                                                  >
                                                    <Edit2 className="w-3 h-3" />
                                                  </button>
                                                  <button
                                                    type="button"
                                                    onClick={() => handleDeleteProduct(sup.id, pIdx)}
                                                    className="p-1 text-rose-400 hover:text-rose-600 focus:outline-none cursor-pointer hover:bg-rose-50 rounded"
                                                    title="Excluir item"
                                                  >
                                                    <Trash2 className="w-3 h-3" />
                                                  </button>
                                                </div>
                                              </>
                                            )}
                                          </div>
                                        );
                                      })
                                    )}
                                  </div>

                                  {/* Form de Adicionar Manualmente */}
                                  {showAddFormSupplierId === sup.id ? (
                                    <div className="p-2 bg-emerald-50 border border-emerald-100 rounded-lg space-y-2">
                                      <p className="text-[9px] font-bold text-emerald-800 uppercase">Novo Item Manual</p>
                                      <div className="flex space-x-1.5">
                                        <input
                                          type="text"
                                          placeholder="Descrição do produto (ex: Dorflex 36cp)"
                                          value={newProdDesc}
                                          onChange={(e) => setNewProdDesc(e.target.value)}
                                          className="flex-1 bg-white border border-slate-200 rounded px-2 py-1 text-xs focus:outline-none focus:ring-1 focus:ring-emerald-500"
                                        />
                                        <div className="relative w-18 shrink-0">
                                          <span className="absolute inset-y-0 left-1.5 flex items-center text-[9px] text-slate-400 font-mono">R$</span>
                                          <input
                                            type="text"
                                            placeholder="0,00"
                                            value={newProdPrice}
                                            onChange={(e) => setNewProdPrice(e.target.value)}
                                            className="w-full bg-white border border-slate-200 rounded pl-5 pr-1.5 py-1 text-xs text-right font-mono focus:outline-none focus:ring-1 focus:ring-emerald-500"
                                          />
                                        </div>
                                      </div>
                                      <div className="flex justify-end space-x-1.5">
                                        <button
                                          type="button"
                                          onClick={() => {
                                            setShowAddFormSupplierId(null);
                                            setNewProdDesc("");
                                            setNewProdPrice("");
                                          }}
                                          className="px-2.5 py-1 text-[10px] text-slate-600 bg-white border border-slate-200 hover:bg-slate-50 font-semibold rounded cursor-pointer"
                                        >
                                          Cancelar
                                        </button>
                                        <button
                                          type="button"
                                          onClick={() => handleAddManualProduct(sup.id, newProdDesc, newProdPrice)}
                                          disabled={!newProdDesc.trim() || !newProdPrice}
                                          className="px-2.5 py-1 text-[10px] text-white bg-emerald-600 hover:bg-emerald-700 disabled:opacity-50 font-semibold rounded cursor-pointer"
                                        >
                                          Adicionar
                                        </button>
                                      </div>
                                    </div>
                                  ) : (
                                    <button
                                      type="button"
                                      onClick={() => setShowAddFormSupplierId(sup.id)}
                                      className="w-full py-1 bg-white hover:bg-slate-50 text-slate-600 border border-dashed border-slate-200 hover:border-slate-300 text-[10px] font-bold rounded-lg flex items-center justify-center space-x-1 transition-all"
                                    >
                                      <Plus className="w-3 h-3" />
                                      <span>Inserir Item Avulso</span>
                                    </button>
                                  )}
                                </div>
                              )}
                            </div>
                          )}
                        </div>
                      );
                    })}
                  </div>
                )}

                <button
                  type="button"
                  onClick={handleAddSupplier}
                  className="w-full py-1.5 px-3 bg-emerald-50 hover:bg-emerald-100 text-emerald-700 border border-dashed border-emerald-300 hover:border-emerald-400 text-xs font-bold transition-all rounded-lg flex items-center justify-center space-x-1"
                >
                  <Plus className="w-3.5 h-3.5" />
                  <span>Adicionar Fornecedor WhatsApp</span>
                </button>
              </div>
            )}
          </div>

          {/* Seção de Cadastro de Empresas Autorizadas (Apenas Admin) */}
          {isAdmin && (
            <div className="border border-slate-200 rounded-xl p-4 bg-slate-50/70 space-y-3">
              <button
                type="button"
                onClick={() => setShowCompaniesSection(!showCompaniesSection)}
                className="w-full flex items-center justify-between text-xs font-bold text-slate-800 hover:text-indigo-600 transition-colors cursor-pointer"
              >
                <div className="flex items-center space-x-2">
                  <Building2 className="w-4 h-4 text-indigo-600" />
                  <span>Gerenciar Empresas Autorizadas ({authorizedCompanies.length})</span>
                </div>
                {showCompaniesSection ? <ChevronUp className="w-4 h-4" /> : <ChevronDown className="w-4 h-4" />}
              </button>

              {showCompaniesSection && (
                <div className="space-y-4 pt-2">
                  <p className="text-[11px] text-slate-500 leading-relaxed">
                    Cadastre os e-mails do Google autorizados a acessar o sistema. Cada farmácia cadastrada fará login com sua conta Google e configurará seu próprio Token e CNPJ nas configurações.
                  </p>

                  <form onSubmit={(e) => {
                    e.preventDefault();
                    if (!newCompEmail || !newCompNome) return;
                    const newComp: AuthorizedCompany = {
                      id: `comp_${Date.now()}`,
                      nome: newCompNome.trim(),
                      email: newCompEmail.trim().toLowerCase()
                    };
                    if (onUpdateAuthorizedCompanies) {
                      onUpdateAuthorizedCompanies([...authorizedCompanies, newComp]);
                    }
                    setNewCompNome("");
                    setNewCompEmail("");
                    setNewCompToken("");
                    setNewCompCnpj("");
                  }} className="space-y-2.5 bg-white p-3 border border-slate-200 rounded-lg">
                    <div className="text-[11px] font-bold text-slate-700">Nova Empresa / Farmácia Autorizada</div>
                    <div>
                      <input
                        type="text"
                        placeholder="Nome da Farmácia / Empresa"
                        value={newCompNome}
                        onChange={(e) => setNewCompNome(e.target.value)}
                        required
                        className="w-full bg-slate-50 border border-slate-200 rounded px-2.5 py-1 text-xs font-medium text-slate-800"
                      />
                    </div>
                    <div>
                      <input
                        type="email"
                        placeholder="E-mail Google autorizado (ex: farmacia@gmail.com)"
                        value={newCompEmail}
                        onChange={(e) => setNewCompEmail(e.target.value)}
                        required
                        className="w-full bg-slate-50 border border-slate-200 rounded px-2.5 py-1 text-xs font-medium text-slate-800"
                      />
                    </div>
                    <button
                      type="submit"
                      className="w-full py-1.5 bg-indigo-600 hover:bg-indigo-700 text-white rounded text-xs font-bold transition-all flex items-center justify-center space-x-1 mt-1 cursor-pointer"
                    >
                      <Plus className="w-3.5 h-3.5" />
                      <span>Autorizar E-mail</span>
                    </button>
                  </form>

                  {authorizedCompanies.length > 0 && (
                    <div className="space-y-2 pt-1">
                      <div className="text-[11px] font-bold text-slate-700">Empresas Cadastradas:</div>
                      {authorizedCompanies.map(comp => (
                        <div key={comp.id} className="p-2.5 bg-white border border-slate-200 rounded-lg flex items-center justify-between text-xs">
                          <div>
                            <div className="font-bold text-slate-800">{comp.nome}</div>
                            <div className="text-[10px] text-slate-500">{comp.email}</div>
                          </div>
                          <button
                            type="button"
                            onClick={() => {
                              if (onUpdateAuthorizedCompanies) {
                                onUpdateAuthorizedCompanies(authorizedCompanies.filter(c => c.id !== comp.id));
                              }
                            }}
                            className="p-1.5 text-rose-600 hover:bg-rose-50 rounded transition-colors cursor-pointer"
                            title="Remover acesso"
                          >
                            <Trash2 className="w-4 h-4" />
                          </button>
                        </div>
                      ))}
                    </div>
                  )}
                </div>
              )}
            </div>
          )}

          {!config.simulationMode && (
            <div className="space-y-3 pt-2">
              <div className="flex items-center">
                <label className="flex items-center space-x-2 text-xs font-medium text-slate-600 cursor-pointer">
                  <input
                    type="checkbox"
                    name="useTestUrl"
                    checked={config.useTestUrl}
                    onChange={handleInputChange}
                    className="w-4 h-4 text-indigo-600 bg-white border-slate-300 rounded accent-indigo-600"
                  />
                  <span>Usar API Testes (Sandbox)</span>
                </label>
              </div>

              {/* Advanced API Config Toggle */}
              <div className="pt-1">
                <button
                  type="button"
                  onClick={() => setShowAdvanced(!showAdvanced)}
                  id="toggle-advanced-api"
                  className="text-xs text-left font-semibold text-indigo-600 hover:text-indigo-800 focus:outline-none flex items-center space-x-1"
                >
                  <Sliders className="w-3.5 h-3.5" />
                  <span>{showAdvanced ? "Ocultar domínios da API" : "Customizar URLs da API"}</span>
                </button>
                
                {showAdvanced && (
                  <div id="advanced-api-fields" className="mt-2.5 p-3 border border-slate-150 bg-slate-50 rounded-lg space-y-3 font-mono text-[10px]">
                    <div>
                      <label className="block font-bold text-slate-500 mb-1">
                        URL de Produção
                      </label>
                      <input
                        type="text"
                        name="customProductionUrl"
                        value={config.customProductionUrl || ""}
                        onChange={handleInputChange}
                        placeholder="https://api.smartped.com.br"
                        className="w-full bg-white border border-slate-200 rounded px-2 py-1 text-[10px] focus:outline-none"
                      />
                    </div>
                    <div>
                      <label className="block font-bold text-slate-500 mb-1">
                        URL de Homologação (Sandbox)
                      </label>
                      <input
                        type="text"
                        name="customTestUrl"
                        value={config.customTestUrl || ""}
                        onChange={handleInputChange}
                        placeholder="https://apitest.smartped.com.br"
                        className="w-full bg-white border border-slate-200 rounded px-2 py-1 text-[10px] focus:outline-none"
                      />
                    </div>
                    <p className="text-[9px] text-slate-400 leading-normal">
                      Modifique apenas em caso de migrações nos caminhos de infraestrutura da distribuidora.
                    </p>
                  </div>
                )}
              </div>
            </div>
          )}
        </div>
      </div>

      <div className="pt-5 border-t border-slate-100 mt-6">
        <button
          onClick={onOptimize}
          disabled={disabled || isLoading}
          className="w-full flex items-center justify-center space-x-2 bg-indigo-600 hover:bg-indigo-700 disabled:opacity-50 text-white font-bold text-xs uppercase tracking-widest py-3 px-4 rounded-xl transition-all disabled:cursor-not-allowed shadow-md shadow-indigo-500/10 cursor-pointer"
        >
          {isLoading ? (
            <>
              <svg className="animate-spin -ml-1 mr-3 h-4 w-4 text-white" fill="none" viewBox="0 0 24 24">
                <circle className="opacity-25" cx="12" cy="12" r="10" stroke="currentColor" strokeWidth="4" />
                <path className="opacity-75" fill="currentColor" d="M4 12a8 8 0 018-8V0C5.373 0 0 5.373 0 12h4zm2 5.291A7.962 7.962 0 014 12H0c0 3.042 1.135 5.824 3 7.938l3-2.647z" />
              </svg>
              <span>Otimizando...</span>
            </>
          ) : (
            <>
              <Play className="w-3.5 h-3.5 fill-current" />
              <span>Otimizar Pedido</span>
            </>
          )}
        </button>
        {disabled && !isLoading && (
          <p className="text-center text-[11px] font-semibold text-rose-500 mt-2">
            ⚠️ Faça o upload do arquivo para otimizar.
          </p>
        )}
      </div>
    </div>
  );
}
