import React, { useState } from "react";
import { Eye } from "lucide-react";
import { SimilarProductsModal } from "./SimilarProductsModal";
import { AnimatePresence } from "motion/react";

export const EanEyeButton = ({ ean, descricao, laboratorio, qtd, originalEan }: { ean: string, descricao?: string, laboratorio?: string, qtd?: number, originalEan?: string }) => {
  const [isOpen, setIsOpen] = useState(false);
  
  if (!ean || ean === "0") return null;

  return (
    <>
      <button
        onClick={(e) => {
          e.stopPropagation();
          e.preventDefault();
          setIsOpen(true);
        }}
        className="inline-flex items-center justify-center p-1 hover:bg-[#141414]/10 rounded-none transition-colors ml-1 cursor-pointer text-[#141414]/60 hover:text-emerald-700"
        title="Ver informações detalhadas do produto (DCB)"
      >
        <Eye className="w-3.5 h-3.5" />
      </button>
      <AnimatePresence>
        {isOpen && <SimilarProductsModal ean={ean} descricao={descricao} laboratorio={laboratorio} qtd={qtd} originalEan={originalEan} onClose={() => setIsOpen(false)} />}
      </AnimatePresence>
    </>
  );
};
