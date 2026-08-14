import { validateSwapEquivalence } from "./swap-validation.js";

export function runEngineSelfTests() {
  console.log("\n==================================================");
  console.log("🧪 EXECUTANDO SUITE DE AUTO-TESTES DO BACKEND (HARD BLOCK & SWAP EQUIVALENCE)");
  console.log("==================================================");

  interface TestCase {
    name: string;
    orig: any;
    alt: any;
    expected: boolean;
  }

  const tests: TestCase[] = [
    {
      name: "1. Hard Block por Sabor (ENO Guaraná vs ENO Limão)",
      orig: { descricao: "SAL DE FRUTA ENO GUARANA PO EFERV 2ENV 5G", dosagem: "5G", qtd: 2 },
      alt: { descricao: "SAL DE FRUTAS ENO LIMÃO C/60EV 5G", dosagem: "5G", qtd: 60 },
      expected: false,
    },
    {
      name: "1b. Hard Block por Sabor (ENO Guaraná vs ENO Tradicional)",
      orig: { DescricaoProduto_Idi: "SAL DE FRUTA ENO GUARANA 5G", dosagem: "5G", qtd: 1 },
      alt: { Descricao: "SAL DE FRUTAS ENO TRADICIONAL 5G", dosagem: "5G", qtd: 1 },
      expected: false,
    },
    {
      name: "1c. Sabor Idêntico Permitido (ENO Guaraná vs ENO Guaraná C/2ENV)",
      orig: { DescricaoProduto_Idi: "SAL DE FRUTA ENO GUARANA PO EFERV 5G", dosagem: "5G" },
      alt: { nom_produto: "SAL DE FRUTAS ENO GUARANA C/2ENV 5G", dosagem: "5G" },
      expected: true,
    },
    {
      name: "2. Equivalência de Dosagem (Reconter 10mg vs Reconter 15mg)",
      orig: { descricao: "RECONTER 10MG 30CP", dosagem: "10MG", qtd: 30 },
      alt: { descricao: "RECONTER 15MG 30CP", dosagem: "15MG", qtd: 30 },
      expected: false,
    },
    {
      name: "3. Equivalência de Quantidade/Comprimidos (Ciclobenzaprina 30CP vs 15CP)",
      orig: { descricao: "CICLOBENZAPRINA 15MG 30CP", dosagem: "15MG", qtd: 30 },
      alt: { descricao: "CICLOBENZAPRINA 15MG 15CP", dosagem: "15MG", qtd: 15 },
      expected: false,
    },
    {
      name: "4. Equivalência de Cores (Esmalte Amarelindo vs Rendinha)",
      orig: { descricao: "ESMALTE RISQUE CR AMARELINDO 8ML", dosagem: "8ML", qtd: 1 },
      alt: { descricao: "ESMALTE RISQUE RENDINHA 8ML", dosagem: "8ML", qtd: 1 },
      expected: false,
    },
    {
      name: "5. Equivalência Correta Permitida (Doralgina 20DRG vs Doralgina C/20 COMP-GG)",
      orig: { descricao: "DORALGINA 20DRG", dosagem: "300MG", qtd: 20 },
      alt: { descricao: "DORALGINA C/20 COMP-GG", dosagem: "300MG", qtd: 20 },
      expected: true,
    },
    {
      name: "6. Bloqueio de Substituição de Referência (Hirudoid vs Fledoid)",
      orig: { descricao: "HIRUDOID 300 POM DERM 40G", ean: "7897411601529", tipo: "Referência" },
      alt: { descricao: "FLEDOID GEL 300 40G", ean: "7898040325183", tipo: "Similar" },
      expected: false,
    },
  ];

  let passed = 0;
  let failed = 0;

  for (const t of tests) {
    const result = validateSwapEquivalence(t.orig, t.alt);
    if (result === t.expected) {
      console.log(`✅ [PASS] ${t.name} => Retornou ${result}`);
      passed++;
    } else {
      console.error(`❌ [FAIL] ${t.name}`);
      console.error(`   - Esperado: ${t.expected}, Mas Obteve: ${result}`);
      console.error(`   - Original:`, JSON.stringify(t.orig));
      console.error(`   - Substituto:`, JSON.stringify(t.alt));
      failed++;
    }
  }

  console.log("--------------------------------------------------");
  console.log(`📊 Resultado Final dos Testes: ${passed}/${tests.length} PASSARAM`);
  console.log("--------------------------------------------------\n");

  if (failed > 0) {
    console.error("\n🚨🚨🚨 ERRO CRÍTICO: SUITE DE TESTES DO BACKEND FALHOU! 🚨🚨🚨");
    console.error(`FORAM DETECTADAS ${failed} FALHAS DE REGRESSÃO EM REGRAS COMERCIAIS ESSENCIAIS.`);
    console.error("O BUILD DE PRODUÇÃO SERÁ CANCELADO PARA PROTEGER O SISTEMA.");
    console.error("--------------------------------------------------\n");
    process.exit(1);
  }
}

// Executa os testes imediatamente ao rodar o script diretamente
runEngineSelfTests();
