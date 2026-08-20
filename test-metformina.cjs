const fs = require('fs');
const raw = Object.fromEntries(fs.readFileSync('.env','utf8').split('\n').filter(l=>l.includes('=')).map(l=>{const[k,...v]=l.split('=');return[k.trim(),v.join('=').trim()]}));
const token = raw.SMARTPED_PRODUCTION_TOKEN.replace(/"/g,'');
const cnpj = raw.SMARTPED_DEFAULT_CNPJ.replace(/"/g,'');
const baseUrl = raw.SMARTPED_PRODUCTION_URL.replace(/"/g,'');

async function test() {
  const body = JSON.stringify({ Token: token, parametros: { CnpjCLi: cnpj, Ean: '7896112126478', AceitaOntem: 1 } });
  const resp = await fetch(baseUrl + '/api/Condicoes/Ean', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body });
  const data = await resp.json();
  const itens = data?.Retorno?.itens || [];
  console.log('Itens:', itens.length);
  for (const item of itens) {
    const condicoes = item.Condicoes || [];
    console.log('Ean:', item.Ean, 'Condicoes:', condicoes.length);
    for (const c of condicoes) {
      const cpd = c.CodProdutoDist || c.codProdutoDist || 'EMPTY';
      console.log('  CodDist=' + c.CodDist + ' Nome=' + (c.NomeDist||'?') + ' CodProdutoDist=' + cpd);
    }
  }
}
test().catch(console.error);
