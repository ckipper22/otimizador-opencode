const fs = require('fs');
const env = Object.fromEntries(
  fs.readFileSync('.env', 'utf8')
    .split('\n')
    .filter(l => l.includes('='))
    .map(l => { const [k, ...v] = l.split('='); return [k.trim(), v.join('=').trim()]; })
);
const clean = (s) => s ? s.replace(/^"|"$/g, '').trim() : s;

async function main() {
  const prodUrl = clean(env.SMARTPED_PRODUCTION_URL) || 'https://api.smartped.com.br';
  const prodToken = clean(env.SMARTPED_PRODUCTION_TOKEN);
  const cnpj = clean(env.SMARTPED_DEFAULT_CNPJ);

  // Test BATCH request with multiple EANs (like the server does)
  const testEans = '7896862994372,7896112114185,7896112116660';
  console.log('=== BATCH com 3 EANs ===');
  console.log('EANs:', testEans);
  
  const body = JSON.stringify({
    Token: prodToken,
    parametros: { CnpjCLi: cnpj, Ean: testEans, AceitaOntem: 1 }
  });

  const resp = await fetch(prodUrl + '/api/Condicoes/Ean', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body
  });
  const data = await resp.json();
  const itens = data.Retorno?.itens || data.Retorno?.Itens || [];
  console.log('Status:', resp.status, '| Msg:', data.Mensagem);
  console.log('Itens retornados:', itens.length);
  
  for (const item of itens) {
    const conds = item.Condicoes || [];
    const ean = conds[0]?.Ean || item.CodBarra || 'UNKNOWN';
    const cppd = conds.filter(c => c.CodProdutoDist && c.CodProdutoDist !== '').length;
    console.log('  EAN:', ean, '| Condicoes:', conds.length, '| ComCodProdDist:', cppd, '| CodBarra:', item.CodBarra);
  }
  
  // Also test with single EAN to compare
  console.log('\n=== SINGLE EAN (7896862994372) ===');
  const body2 = JSON.stringify({
    Token: prodToken,
    parametros: { CnpjCLi: cnpj, Ean: '7896862994372', AceitaOntem: 1 }
  });
  const resp2 = await fetch(prodUrl + '/api/Condicoes/Ean', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: body2
  });
  const data2 = await resp2.json();
  const itens2 = data2.Retorno?.itens || [];
  console.log('Itens:', itens2.length);
  if (itens2.length > 0) {
    const conds = itens2[0].Condicoes || [];
    console.log('  Condicoes:', conds.length, '| CodBarra:', itens2[0].CodBarra);
  }
}

main().catch(console.error);
