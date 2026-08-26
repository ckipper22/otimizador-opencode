import os
import json
import urllib.request

token = os.environ.get("SMARTPED_PRODUCTION_TOKEN", "")
cnpj = "13408443000168"
base = "https://smartped-cli-887122622666.us-east1.run.app"
eans = ["7896714208565", "7891150037458", "7897595605276", "7891058022136"]

for ean in eans:
    print("\n" + "=" * 70)
    print(f"EAN: {ean}")
    print("=" * 70)

    body = json.dumps({
        "token": token,
        "cnpj": cnpj,
        "query": ean,
        "useTestUrl": False,
        "onlyExactEan": True,
        "skipMolecula": False
    }).encode()

    req = urllib.request.Request(
        f"{base}/api/search-products",
        data=body,
        headers={"Content-Type": "application/json"}
    )
    resp = urllib.request.urlopen(req, timeout=30)
    data = json.loads(resp.read().decode())

    items = data.get("items", [])
    print(f"Ofertas: {len(items)}")

    if items:
        print(f"Descricao: {items[0]['descricao']}")
        print(f"Laboratorio: {items[0].get('laboratorio', '?')}")
        print(f"isGeneric: {items[0].get('isGeneric', '?')}")
        print()
        for it in items:
            est = {2: "SIM", 1: "BAIXO", 0: "NAO"}.get(it.get("estoque"), str(it.get("estoque")))
            pmc = f" PMC=R$ {it['pmc']}" if it.get("pmc", 0) > 0 else ""
            print(f"  {it['distribuidora']:25s} | R$ {it['precoLiquido']:7.2f} | Est={est:4s} | {it['condicao']:5s} | {it['prazo']:3}dia | Min=R$ {it.get('pedidoMinimo',0):>5}{pmc}")

    logs = data.get("logs", [])
    print("\nLogs API:")
    for l in logs:
        if any(k in l for k in ["SmartPed", "FILTRO", "SUCESSO", "itens", "Condicoes", "Molecula", "PMC"]):
            print(f"  {l}")
