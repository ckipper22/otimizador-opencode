const TOKEN = process.env.SMARTPED_PRODUCTION_TOKEN || "";
const CNPJ = "13408443000168";

function getUnitCost(item: any): number {
  if (!item) return 0;
  const pliq = parseFloat(String(item.Pliquido ?? item.pliquido ?? 0).replace(",", "."));
  const pliqUni = parseFloat(String(item.PliquidoUni ?? item.pliquidoUni ?? 0).replace(",", "."));
  if (pliqUni > 0 && (pliq === 0 || pliqUni < pliq)) return pliqUni;
  if (pliq > 0) return pliq;
  return parseFloat(String(item.Preco ?? item.preco ?? 0).replace(",", "."));
}

function isRealOffer(s: any): boolean {
  if (!s) return false;
  const distId = s.CodDist !== undefined ? s.CodDist : (s.codDist !== undefined ? s.codDist : 0);
  const distName = String(s.NomeDist || s.nomeDist || s.distribuidora || "").trim().toLowerCase();
  return Number(distId) > 0 && distName !== "" && distName !== "nao encontrados" && distName !== "não encontrados" && distName !== "sem estoque";
}

function cleanEan(ean: any): string { return String(ean || "").replace(/\D/g, ""); }

async function testFallback() {
  const origEan = "7897595620613";
  const descricao = "ROSUVASTATINA CALCICA 10MG 30CP REV";
  const baseUrl = "https://api.smartped.com.br";

  console.log("=== PASSO 1: Descobrir DCB via Ferramentinhas ===");
  let dcbDescoberto = "";
  try {
    const resp = await fetch(`https://api.ferramentinhas.com/api/produtos/similares/${origEan}`);
    const data = await resp.json();
    const pList = data.produtos || data.items || [];
    console.log(`Ferramentinhas retornou ${pList.length} produtos`);
    
    const pWithDcb = pList.find((p: any) => p.cod_dcb && String(p.cod_dcb).trim().length > 0);
    if (pWithDcb) {
      dcbDescoberto = String(pWithDcb.cod_dcb).trim();
      console.log(`DCB descoberto: "${dcbDescoberto}"`);
    } else {
      console.log("Nenhum DCB encontrado nos produtos");
      // Mostrar o que veio
      pList.slice(0, 5).forEach((p: any, i: number) => {
        console.log(`  ${i+1}. ${p.nom_produto || p.descricao || "?"} | cod_dcb=${p.cod_dcb || "?"} | cod_barra=${p.cod_barra || "?"}`);
      });
    }
  } catch (e: any) {
    console.log(`Erro Ferramentinhas: ${e.message}`);
  }

  // Fallback manual: usar "ROSUVASTATINA" como DCB
  if (!dcbDescoberto) {
    dcbDescoberto = "ROSUVASTATINA";
    console.log(`\nUsando fallback DCB manual: "${dcbDescoberto}"`);
  }

  console.log("\n=== PASSO 2: Condicoes/Molecula com DCB textual ===");
  try {
    const resp = await fetch(`${baseUrl}/api/Condicoes/Molecula`, {
      method: "POST",
      headers: { "Content-Type": "application/json", "Accept": "application/json" },
      body: JSON.stringify({
        Token: TOKEN,
        parametros: { CnpjCLi: CNPJ, Molecula: dcbDescoberto, ConsideraTipo: 1 }
      })
    });
    const data = await resp.json();
    const ret = data.Retorno || data.retorno || data;
    const itens = ret.itens || ret.Itens || [];
    console.log(`Molecula "${dcbDescoberto}" retornou ${itens.length} moléculas`);
    
    let totalSubs = 0;
    for (const entry of itens) {
      const ip = entry.ItemPedido || entry;
      const ean = cleanEan(ip.Ean || ip.ean || "");
      const subs = entry.Substitutos || entry.substitutos || [];
      totalSubs += subs.length;
      
      console.log(`\n  Molécula: EAN=${ean} | ${ip.Descricao || "?"} | ${ip.NomeDist || "?"} | Est=${ip.Estoque}`);
      subs.slice(0, 5).forEach((s: any, i: number) => {
        const sEan = s.Ean || s.ean || "?";
        const dist = s.NomeDist || "?";
        const est = s.Estoque !== undefined ? s.Estoque : "?";
        const price = getUnitCost(s);
        const conds = s.Condicoes || s.condicoes || [];
        console.log(`    ${i+1}. EAN=${sEan} | ${dist} | Est=${est} | R$${price.toFixed(2)} | Conds=${conds.length} | Desc=${(s.Descricao||"?").substring(0,45)}`);
        if (conds.length > 0) {
          conds.slice(0, 3).forEach((c: any, j: number) => {
            console.log(`      cond${j+1}: ${c.NomeDist||"?"} | Est=${c.Estoque} | R$${getUnitCost(c).toFixed(2)} | Cond=${c.Condicao} | Prz=${c.Prazo}`);
          });
        }
      });
    }
    console.log(`\nTotal substitutos encontrados: ${totalSubs}`);
  } catch (e: any) {
    console.log(`Erro: ${e.message}`);
  }

  console.log("\n=== PASSO 3: Condicoes/Molecula com texto limpo ===");
  try {
    // cleanDescription de "ROSUVASTATINA CALCICA 10MG 30CP REV" → "ROSUVASTATINA CALCICA"
    // getMoleculeBase → "ROSUVASTATINA CALCICA"
    const resp = await fetch(`${baseUrl}/api/Condicoes/Molecula`, {
      method: "POST",
      headers: { "Content-Type": "application/json", "Accept": "application/json" },
      body: JSON.stringify({
        Token: TOKEN,
        parametros: { CnpjCLi: CNPJ, Molecula: "ROSUVASTATINA CALCICA", ConsideraTipo: 1 }
      })
    });
    const data = await resp.json();
    const ret = data.Retorno || data.retorno || data;
    const itens = ret.itens || ret.Itens || [];
    console.log(`Molecula "ROSUVASTATINA CALCICA" retornou ${itens.length} moléculas`);
    
    for (const entry of itens.slice(0, 3)) {
      const ip = entry.ItemPedido || entry;
      const ean = cleanEan(ip.Ean || ip.ean || "");
      const subs = entry.Substitutos || entry.substitutos || [];
      console.log(`\n  Molécula: EAN=${ean} | ${ip.Descricao || "?"} | ${ip.NomeDist || "?"}`);
      subs.slice(0, 5).forEach((s: any, i: number) => {
        const sEan = s.Ean || s.ean || "?";
        const dist = s.NomeDist || "?";
        const est = s.Estoque !== undefined ? s.Estoque : "?";
        const price = getUnitCost(s);
        const real = isRealOffer(s);
        console.log(`    ${i+1}. EAN=${sEan} | ${dist} (cod=${s.CodDist}) | Est=${est} | R$${price.toFixed(2)} | Real=${real} | Desc=${(s.Descricao||"?").substring(0,45)}`);
      });
    }
  } catch (e: any) {
    console.log(`Erro: ${e.message}`);
  }

  console.log("\n=== PASSO 4: Produtos/Buscar com descricao ===");
  try {
    const resp = await fetch(`${baseUrl}/api/Produtos/Buscar`, {
      method: "POST",
      headers: { "Content-Type": "application/json", "Accept": "application/json" },
      body: JSON.stringify({
        Token: TOKEN,
        parametros: { CnpjCLi: CNPJ, Texto: "ROSUVASTATINA CALCICA 10MG" }
      })
    });
    const data = await resp.json();
    const ret = data.Retorno || data.retorno || data;
    const itens = Array.isArray(ret) ? ret : (ret.itens || ret.Itens || []);
    console.log(`Produtos/Buscar "ROSUVASTATINA CALCICA 10MG" retornou ${itens.length} itens`);
    
    itens.slice(0, 10).forEach((s: any, i: number) => {
      const ean = s.Ean || s.ean || "?";
      const dist = s.NomeDist || "?";
      const est = s.Estoque !== undefined ? s.Estoque : "?";
      const price = getUnitCost(s);
      const codDist = s.CodDist;
      const real = isRealOffer(s);
      console.log(`  ${i+1}. EAN=${ean} | ${dist} (cod=${codDist}) | Est=${est} | R$${price.toFixed(2)} | Real=${real} | Desc=${(s.Descricao||"?").substring(0,50)}`);
    });
  } catch (e: any) {
    console.log(`Erro: ${e.message}`);
  }
}

testFallback().catch(console.error);
