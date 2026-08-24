const TOKEN = "fddfd9871b77f44f243e145207c8e93a";
const CNPJ = "13408443000168";
const BASE = "https://api.smartped.com.br";
const sleep = (ms: number) => new Promise(r => setTimeout(r, ms));

async function queryEan(ean: string): Promise<any> {
  const res = await fetch(`${BASE}/api/Condicoes/Ean`, {
    method: "POST",
    headers: { "Content-Type": "application/json", Accept: "application/json" },
    body: JSON.stringify({ Token: TOKEN, parametros: { CnpjCLi: CNPJ, Ean: ean, AceitaOntem: 1 } })
  });
  return res.json();
}

function extractConds(data: any, queryEan: string) {
  const itens = data?.Retorno?.itens || [];
  const results: any[] = [];
  for (const entry of itens) {
    const condEan = entry.ItemPedido?.Ean || queryEan;
    const conds = entry.Condicoes || [];
    for (const c of conds) {
      results.push({
        queryEan,
        condEan,
        codDist: c.CodDist,
        preco: c.Pliquido || c.Preco || 0,
        estoque: c.Estoque || 0,
        cond: c.Condicao,
      });
    }
  }
  return results;
}

async function main() {
  const testEans = [
    "7893454101644",  // Delta
    "7896714231204",  // Neo Quimica
    "7896112162322",  // Teuto
    "7897595610089",  // Sandoz
  ];

  // TESTE 1: Sequencial com delay 2s
  console.log("=== TESTE 1: Sequencial com delay 2s ===");
  for (const ean of testEans) {
    const data = await queryEan(ean);
    const conds = extractConds(data, ean);
    const gaucha = conds.filter(c => c.codDist === 53);
    console.log(`  ${ean}: ${conds.length} conds, Gauchofarma=${gaucha.length > 0 ? gaucha.map(c => `R$${c.preco}/est=${c.estoque}`).join(",") : "NONE"}`);
    await sleep(2000);
  }

  // TESTE 2: Paralelo (Promise.all) — como o servidor faz
  console.log("\n=== TESTE 2: Paralelo (Promise.all) ===");
  const parallelResults = await Promise.all(testEans.map(ean => queryEan(ean)));
  for (let i = 0; i < testEans.length; i++) {
    const conds = extractConds(parallelResults[i], testEans[i]);
    const gaucha = conds.filter(c => c.codDist === 53);
    console.log(`  ${testEans[i]}: ${conds.length} conds, Gauchofarma=${gaucha.length > 0 ? gaucha.map(c => `R$${c.preco}/est=${c.estoque}`).join(",") : "NONE"}`);
  }

  // TESTE 3: Sequencial SEM delay
  console.log("\n=== TESTE 3: Sequencial SEM delay ===");
  for (const ean of testEans) {
    const data = await queryEan(ean);
    const conds = extractConds(data, ean);
    const gaucha = conds.filter(c => c.codDist === 53);
    console.log(`  ${ean}: ${conds.length} conds, Gauchofarma=${gaucha.length > 0 ? gaucha.map(c => `R$${c.preco}/est=${c.estoque}`).join(",") : "NONE"}`);
  }
}

main().catch(console.error);
