import os
import json
import urllib.request

token = os.environ.get("SMARTPED_PRODUCTION_TOKEN", "")
cnpj = "13408443000168"

# EAN 1: LOSARTANA (genérico)
# EAN 2: SHAMPOO SEDA (perfumaria)
for ean, nome in [("7896714208565", "LOSARTANA"), ("7891150037458", "SHAMPOO SEDA")]:
    print("\n" + "=" * 70)
    print(f"{nome} - EAN: {ean}")
    print("=" * 70)

    # Molecula RAW completo
    body = json.dumps({
        "Token": token,
        "parametros": {"CnpjCLi": cnpj, "Ean": ean, "ConsideraTipo": 1}
    }).encode()
    req = urllib.request.Request("https://api.smartped.com.br/api/Condicoes/Molecula", data=body, headers={"Content-Type": "application/json"})
    resp = urllib.request.urlopen(req, timeout=15)
    data = json.loads(resp.read().decode())

    print("\n--- MOLECULA COMPLETO ---")
    print(json.dumps(data, indent=2, ensure_ascii=False)[:3000])

    # EAN RAW completo
    body2 = json.dumps({
        "Token": token,
        "parametros": {"CnpjCLi": cnpj, "Ean": ean, "AceitaOntem": 1}
    }).encode()
    req2 = urllib.request.Request("https://api.smartped.com.br/api/Condicoes/Ean", data=body2, headers={"Content-Type": "application/json"})
    resp2 = urllib.request.urlopen(req2, timeout=15)
    data2 = json.loads(resp2.read().decode())

    print("\n--- EAN COMPLETO ---")
    print(json.dumps(data2, indent=2, ensure_ascii=False)[:3000])
