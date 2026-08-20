import json
import urllib.request

token = "fddfd9871b77f44f243e145207c8e93a"
cnpj = "13408443000168"

for ean, nome in [("7897848501065", "CETOCONAZOL"), ("7897595903365", "PURAN T4"), ("7897595637642", "ACICLOVIR")]:
    print(f"\n=== {nome} ({ean}) ===")
    body = json.dumps({"Token": token, "parametros": {"CnpjCLi": cnpj, "Ean": ean, "AceitaOntem": 1}}).encode()
    req = urllib.request.Request("https://api.smartped.com.br/api/Condicoes/Ean", data=body, headers={"Content-Type": "application/json"})
    resp = urllib.request.urlopen(req, timeout=15)
    data = json.loads(resp.read().decode())
    itens = data.get("Retorno", {}).get("itens", [])
    for item in itens:
        conds = item.get("Condicoes", [])
        print(f"  Condicoes: {len(conds)}")
        for c in conds[:5]:
            cod_dist = c.get("CodDist", "?")
            cod_prod_dist = c.get("CodProdutoDist", "")
            ean_cond = c.get("Ean", "?")
            preco = c.get("Pliquido", "?")
            print(f"    CodDist={cod_dist} CodProdutoDist='{cod_prod_dist}' Ean={ean_cond} Pliquido={preco}")
