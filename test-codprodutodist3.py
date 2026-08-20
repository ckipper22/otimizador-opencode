import json
import urllib.request

token = "fddfd9871b77f44f243e145207c8e93a"
cnpj = "13408443000168"

# EANs que deram codProdutoDist vazio no JSON final
for ean, nome in [("7897848501065", "CETOCONAZOL"), ("7897595903365", "PURAN T4"), ("7897595637642", "ACICLOVIR")]:
    print(f"\n=== {nome} ({ean}) ===")
    
    # Condicoes/Ean - ver CodProdutoDist
    body = json.dumps({"Token": token, "parametros": {"CnpjCLi": cnpj, "Ean": ean, "AceitaOntem": 1}}).encode()
    req = urllib.request.Request("https://api.smartped.com.br/api/Condicoes/Ean", data=body, headers={"Content-Type": "application/json"})
    resp = urllib.request.urlopen(req, timeout=15)
    data = json.loads(resp.read().decode())
    itens = data.get("Retorno", {}).get("itens", [])
    for item in itens:
        conds = item.get("Condicoes", [])
        print(f"  Ean: Condicoes={len(conds)}")
        for c in conds[:3]:
            print(f"    CodDist={c.get('CodDist')} CodProdutoDist='{c.get('CodProdutoDist','')}' Ean={c.get('Ean','?')}")
    
    # Condicoes/Molecula - ver Substitutos
    body2 = json.dumps({"Token": token, "parametros": {"CnpjCLi": cnpj, "Ean": ean, "ConsideraTipo": 1}}).encode()
    req2 = urllib.request.Request("https://api.smartped.com.br/api/Condicoes/Molecula", data=body2, headers={"Content-Type": "application/json"})
    resp2 = urllib.request.urlopen(req2, timeout=15)
    data2 = json.loads(resp2.read().decode())
    itens2 = data2.get("Retorno", {}).get("itens", [])
    for item in itens2:
        subs = item.get("Substitutos", [])
        print(f"  Molecula: Substitutos={len(subs)}")
        for s in subs[:3]:
            print(f"    Ean={s.get('Ean','?')} CodDist={s.get('CodDist')} CodProdutoDist='{s.get('CodProdutoDist','')}' NomeDist={s.get('NomeDist','?')}")
