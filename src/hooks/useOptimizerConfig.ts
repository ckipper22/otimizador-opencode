import { useState, useEffect } from "react";
import { OptimizerConfig, DistributorOption, ExternalSupplier } from "../types";

export function useOptimizerConfig() {
  const [externalSuppliers, setExternalSuppliers] = useState<ExternalSupplier[]>([]);
  const [externalSuppliersLoaded, setExternalSuppliersLoaded] = useState(false);

  // Atualiza state local SEM salvar no Turso (edições em andamento)
  const handleUpdateExternalSuppliers = (newSuppliers: ExternalSupplier[]) => {
    setExternalSuppliers(newSuppliers);
  };

  // Salva TODOS os suppliers no Turso + trigger análise (chamado pelo botão "Salvar Listas")
  const flushExternalSuppliersToApi = async () => {
    const snapshot = externalSuppliers;
    await Promise.all(snapshot.map(sup =>
      fetch("/api/external-suppliers", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ ...sup, cnpj: config.cnpj }),
      }).catch(err => console.error("Erro ao salvar fornecedor externo:", err))
    ));
  };

  const handleRemoveExternalSupplier = async (supplierId: string) => {
    try {
      await fetch(`/api/external-suppliers/${supplierId}`, { method: "DELETE" });
    } catch (err) {
      console.error("Erro ao deletar fornecedor externo:", err);
    }
  };
  
  const [distributors, setDistributors] = useState<DistributorOption[]>([]);
  const [disabledDistributors, setDisabledDistributors] = useState<Set<number>>(new Set());
  const [isLoadingDistributors, setIsLoadingDistributors] = useState<boolean>(false);
  const [config, setConfig] = useState<OptimizerConfig>(() => {
    try {
      const saved = localStorage.getItem("optimizer_config");
      if (saved) return JSON.parse(saved);
    } catch (err) {
      console.error(err);
    }
    return {
      token: "",
      cnpj: "13408443000168",
      margemMinima: 0.01,
      tipos: ["G", "O"],
      permitirSemEstoque: false,
      customProductionUrl: "https://api.smartped.com.br",
      customTestUrl: "https://apitest.smartped.com.br",
      customEndpoint: "/api/Condicoes/Molecula",
      alertaProfarma48h: true,
      alertaConfirmarQtdCaixaMaster: true,
      bypassMargemRuptura: true,
    };
  });

  useEffect(() => {
    localStorage.setItem("optimizer_config", JSON.stringify(config));
  }, [config]);

  const [backendStatus, setBackendStatus] = useState<"checking" | "online" | "offline">("checking");

  useEffect(() => {
    async function fetchDistribuidores() {
      if (!config.token || !config.cnpj) return;
      setIsLoadingDistributors(true);
      try {
        const response = await fetch("/api/distribuidores", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify(config)
        });
        if (response.ok) {
          const data = await response.json();
          if (data.distribuidores && Array.isArray(data.distribuidores)) {
            setDistributors(data.distribuidores);
          }
        }
      } catch (err) {
        console.error("Erro ao buscar distribuidores:", err);
      } finally {
        setIsLoadingDistributors(false);
      }
    }
    fetchDistribuidores();
  }, [config.token, config.cnpj, config.customTestUrl, config.customProductionUrl, config.customEndpoint]);

  const handleToggleDistributor = (codigo: number) => {
    setDisabledDistributors(prev => {
      const next = new Set(prev);
      if (next.has(codigo)) {
        next.delete(codigo);
      } else {
        next.add(codigo);
      }
      return next;
    });
  };

  useEffect(() => {
    async function checkBackend() {
      try {
        const response = await fetch("/api/health");
        const data = await response.json();
        if (data && data.status === "ok") {
          setBackendStatus("online");
        } else {
          setBackendStatus("offline");
        }
      } catch (err) {
        console.error("Erro ao checar integridade do backend:", err);
        setBackendStatus("offline");
      }
    }
    checkBackend();
  }, []);

  useEffect(() => {
    if (!config.cnpj || externalSuppliersLoaded) return;
    (async () => {
      try {
        const res = await fetch("/api/external-suppliers/list", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ cnpj: config.cnpj }),
        });
        if (res.ok) {
          const data = await res.json();
          if (data.suppliers && Array.isArray(data.suppliers)) {
            setExternalSuppliers(data.suppliers);
          }
        }
      } catch (err) {
        console.error("Erro ao buscar fornecedores externos:", err);
      } finally {
        setExternalSuppliersLoaded(true);
      }
    })();
  }, [config.cnpj, externalSuppliersLoaded]);

  return {
    config,
    setConfig,
    distributors,
    disabledDistributors,
    isLoadingDistributors,
    externalSuppliers,
    backendStatus,
    handleToggleDistributor,
    handleUpdateExternalSuppliers,
    flushExternalSuppliersToApi,
    handleRemoveExternalSupplier,
  };
}
