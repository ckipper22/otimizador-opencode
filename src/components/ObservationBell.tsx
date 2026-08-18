import React, { useState, useEffect, useRef } from "react";
import { BellRing } from "lucide-react";

export const ObservationBell = ({ ean, origem }: { ean: string; origem?: string }) => {
  const [observation, setObservation] = useState<string | null>(null);
  const [hasFetched, setHasFetched] = useState(false);
  const containerRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    if (!ean || ean === "0" || hasFetched) return;
    // Itens manuais/encomenda não buscam observação na Trier
    if (origem === "encomenda" || origem === "manual") return;

    const observer = new IntersectionObserver(
      (entries) => {
        if (entries[0].isIntersecting) {
          fetchObservation();
          observer.disconnect();
        }
      },
      { threshold: 0 }
    );

    if (containerRef.current) {
      observer.observe(containerRef.current);
    }

    return () => observer.disconnect();
  }, [ean, hasFetched]);

  const fetchObservation = async () => {
    setHasFetched(true);
    try {
      const response = await fetch(`/api/similares/${ean}`);
      const result = await response.json();
      
      if (response.ok && result.success && result.produtos) {
        // Encontra EXATAMENTE o produto pelo EAN
        const exactProduct = result.produtos.find((p: any) => 
             p.cod_barra === ean || p.ean === ean
        );
        
        // Só seta a observação se ESTE exato produto tiver a observação
        if (exactProduct && exactProduct.nom_obsvenda) {
          setObservation(exactProduct.nom_obsvenda);
        }
      }
    } catch (error) {
      console.error("Erro ao buscar observação:", error);
    }
  };

  if (!observation) {
    // IMPORTANTE: Não usar "hidden" (display: none), senão o IntersectionObserver nunca dispara!
    return <span ref={containerRef} className="w-px h-px opacity-0 inline-block" />;
  }

  return (
    <div ref={containerRef} className="mt-1 flex items-start gap-1 text-[9px] text-rose-700 bg-rose-50 p-1 rounded-sm border border-rose-200 font-bold uppercase tracking-wider">
      <BellRing className="w-3 h-3 shrink-0 mt-0.5 animate-pulse" />
      <span>{observation}</span>
    </div>
  );
};
