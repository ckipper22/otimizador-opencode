import os
import json
import urllib.request

token = os.environ.get("SMARTPED_PRODUCTION_TOKEN", "")
cnpj = "13408443000168"
base = "https://api.smartped.com.br"

for ean in ["7896112114185", "7896006201618", "7891721201806"]:
    print(f"\n=== EAN: {ean} ===")
    body = json.dumps({"Token": token, "parametros": {"CnpjCLi": cnpj, "Ean": ean, "AceitaOntem": 1}}).encode()
    req = urllib.request.Request(f"{base}/api/Condicoes/Ean", data=body, headers={"Content-Type": "application/json"})
    try:
        resp = urllib.request.urlopen(req, timeout=15)
        data = json.loads(resp.read().decode())
        itens = data.get("Retorno", {}).get("itens", [])
        if itens:
            item = itens[0]
            conds = item.get("Condicoes", [])
            print(f"Descricao: {item.get('Descricao', '?')}")
            print(f"Condicoes: {len(conds)}")
            for c in conds[:3]:
                cod_dist = c.get("CodDist", "?")
                cod_prod_dist = c.get("CodProdutoDist", "")
                cod_prod = c.get("CodProduto", "")
                preco = c.get("Preco", "?")
                pliq = c.get("Pliquido", "?")
                print(f"  CodDist={cod_dist} CodProdutoDist='{cod_prod_dist}' CodProduto='{cod_prod}' Preco={preco} Pliquido={pliq}")
        else:
            print("Sem itens")
    except Exception as e:
        print(f"ERRO: {e}")
