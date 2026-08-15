import { useState, useEffect } from "react";
import { OptimizerConfig, DistributorOption, ExternalSupplier } from "../types";

export function useOptimizerConfig() {
  const [externalSuppliers, setExternalSuppliers] = useState<ExternalSupplier[]>(() => {
    try {
      const saved = localStorage.getItem("external_suppliers");
      return saved ? JSON.parse(saved) : [];
    } catch {
      return [];
    }
  });

  const handleUpdateExternalSuppliers = (newSuppliers: ExternalSupplier[]) => {
    setExternalSuppliers(newSuppliers);
    localStorage.setItem("external_suppliers", JSON.stringify(newSuppliers));
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
      token: "fddfd9871b77f44f243e145207c8e93a",
      cnpj: "13408443000168",
      margemMinima: 0.01,
      tipos: ["G", "O"],
      permitirSemEstoque: false,
      useTestUrl: false,
      simulationMode: false,
      customProductionUrl: "https://api.smartped.com.br",
      customTestUrl: "https://apitest.smartped.com.br",
      customEndpoint: "/api/Condicoes/Molecula"
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
  }, [config.token, config.cnpj, config.useTestUrl, config.customTestUrl, config.customProductionUrl, config.customEndpoint]);

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
  };
}
