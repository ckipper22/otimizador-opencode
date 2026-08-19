import json
import urllib.request

token = "fddfd9871b77f44f243e145207c8e93a"
cnpj = "13408443000168"
base = "https://smartped-cli-887122622666.us-east1.run.app"
eans = ["7896714208565", "7891150037458", "7897595605276", "7891058022136"]

for ean in eans:
    print("\n" + "=" * 70)
    print(f"COM MOLECULA - EAN: {ean}")
    print("=" * 70)

    # Chamar SEM onlyExactEan e SEM skipMolecula
    body = json.dumps({
        "token": token,
        "cnpj": cnpj,
        "query": ean,
        "useTestUrl": False,
        "onlyExactEan": False,
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
    print(f"Ofertas totais: {len(items)}")

    if items:
        print(f"Descricao: {items[0]['descricao']}")
        print(f"isGeneric: {items[0].get('isGeneric', '?')}")
        print()

        # Agrupar por EAN
        by_ean = {}
        for it in items:
            e = it.get("ean", "?")
            if e not in by_ean:
                by_ean[e] = []
            by_ean[e].append(it)

        for ean_key, offers in sorted(by_ean.items()):
            same = " <-- MESMO EAN" if ean_key == ean else " <-- SUBSTITUTO"
            print(f"  EAN {ean_key}{same} ({len(offers)} ofertas):")
            for o in offers:
                est = {2: "SIM", 1: "BAIXO", 0: "NAO"}.get(o.get("estoque"), str(o.get("estoque")))
                pmc = f" PMC=R${o['pmc']}" if o.get("pmc", 0) > 0 else ""
                qtd = f" QtdMin={o.get('qtdMin',0)}" if o.get("qtdMin", 0) > 0 else ""
                print(f"    {o['distribuidora']:25s} | R${o['precoLiquido']:7.2f} | Est={est:4s} | {o['condicao']:5s} | {o['prazo']:3}dia | Min=R${o.get('pedidoMinimo',0):>5}{pmc}{qtd}")

    # Logs de molécula
    logs = data.get("logs", [])
    mol_logs = [l for l in logs if any(k in l for k in ["Molecula", "molécula", "SUBS", "Substitutos", "TipoItem", "FILTRO TIPO"])]
    if mol_logs:
        print("\nLogs molécula:")
        for l in mol_logs[:8]:
            print(f"  {l}")
