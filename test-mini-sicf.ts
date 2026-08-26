const MINI_SICF = `1;13408443000168;3.0
2;7891721202988;1;17371;LEVOTIROXINA SODICA 25MCG 30CP;MERCK SA;8.05
2;7898060139951;4;18792;CLORIDRATO DE CICLOBENZAPRINA 10MG 30CP REV;GLOBO;8.73
2;7898148294596;2;1467;ACETATO DE DEXAMETASONA 1MG/G CR DERM 10G;PRATI DONADUZZI;4.74
2;7899095262669;1;17749;MESILATO DE DOXAZOSINA 2MG 30CP;GEOLAB;7.59
2;7896637022767;1;4522;DONAREN 50MG 60CP REV;APSEN;45.29
2;7896015518875;1;111;AVAMYS 27,5MCG/DOSES SUS SPR 120DOSES;GSK;55.62
2;7896523206790;1;2786;GEL LUBRIFICANTE K-MED 50G;CIMED;9.18
2;7898947385693;10;15025;SUCCINATO DE METOPROLOL 25MG 30CP REV L.P;NEO QUIMICA;18.08
2;7896658008825;1;525;LEVOID 100MCG 30CP;ACHE;13.3
9;201`;

const body = JSON.stringify({
  fileContent: MINI_SICF,
  token: "",
  cnpj: "13408443000168",
  margemMinima: 0.01,
  tipos: ["G", "O"],
  permitirSemEstoque: false,
  useTestUrl: true,
  simulationMode: false,
  disabledDistributors: [],
  externalSuppliers: [],
  cortesRecentes: {}
});

const start = Date.now();
console.log(`[TEST] Enviando 9 itens...`);

const res = await fetch('http://localhost:3000/api/optimize', {
  method: 'POST',
  headers: { 'Content-Type': 'application/json' },
  body
});
const elapsed = Date.now() - start;
console.log(`[TEST] HTTP ${res.status} em ${elapsed}ms`);

const json = await res.json();
if (json.error) {
  console.log(`[ERRO] ${json.error}`);
} else {
  const items = json.results || json.itens || [];
  console.log(`[TEST] ${items.length} itens no resultado`);
  for (const item of items.slice(0, 5)) {
    const desc = (item.descricao || item.Descricao || '').substring(0, 45);
    const preco = item.precoLiquido || item.PrecoLiquido || item.preco || '?';
    const vendas = item.vendasMensais ?? '?';
    const estoque = item.estoqueTotal ?? '?';
    console.log(`  ${desc}... | R$${preco} | vendas:${vendas} | est:${estoque}`);
  }
  if (items.length > 5) console.log(`  ... e mais ${items.length - 5} itens`);
  
  const fs = await import('fs');
  fs.writeFileSync('test-results-before.json', JSON.stringify(json, null, 2));
  console.log(`[TEST] Resultados salvos em test-results-before.json`);
}
