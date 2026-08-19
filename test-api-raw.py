import json
import urllib.request

token = "fddfd9871b77f44f243e145207c8e93a"
cnpj = "13408443000168"
eans = ["7896714208565", "7891150037458", "7897595605276", "7891058022136"]

for ean in eans:
    print("\n" + "=" * 70)
    print(f"RAW MOLECULA - EAN: {ean}")
    print("=" * 70)

    # Chamar a SmartPed DIRETO pelo Python (sem passar pelo BFF)
    # Condicoes/Molecula
    body_mol = json.dumps({
        "Token": token,
        "parametros": {
            "CnpjCLi": cnpj,
            "Ean": ean,
            "ConsideraTipo": 1
        }
    }).encode()

    try:
        req = urllib.request.Request(
            "https://api.smartped.com.br/api/Condicoes/Molecula",
            data=body_mol,
            headers={"Content-Type": "application/json"}
        )
        resp = urllib.request.urlopen(req, timeout=15)
        raw = resp.read().decode()
        data = json.loads(raw)

        msg = data.get("Mensagem", "")
        retorno = data.get("Retorno")

        if msg:
            print(f"Mensagem: {msg}")
        if retorno is None:
            print("Retorno: null")
            continue

        itens = retorno.get("itens") or retorno.get("Itens") or []
        minimos = retorno.get("minimos") or retorno.get("Minimos") or []
        dists = retorno.get("dists") or retorno.get("Dists") or []

        print(f"Itens (moleculas): {len(itens)}")
        print(f"Minimos: {len(minimos)}")
        print(f"Dists: {len(dists)}")

        for i, entry in enumerate(itens):
            ip = entry.get("ItemPedido") or entry.get("itemPedido") or {}
            subs = entry.get("Substitutos") or entry.get("substitutos") or []
            conds = entry.get("Condicoes") or entry.get("condicoes") or []

            print(f"\n  Molecula #{i}:")
            print(f"    ItemPedido.Descricao: {ip.get('Descricao', '?')}")
            print(f"    ItemPedido.TipoItem: {ip.get('TipoItem', '?')}")
            print(f"    ItemPedido.CodDCB: {ip.get('CodDCB', '?')}")
            print(f"    ItemPedido.CodPrincipio: {ip.get('CodPrincipio', '?')}")
            print(f"    Substitutos: {len(subs)}")
            print(f"    Condicoes: {len(conds)}")

            for j, sub in enumerate(subs[:5]):
                sub_desc = sub.get("Descricao", sub.get("DescricaoProduto_Idi", "?"))
                sub_ean = sub.get("Ean", sub.get("EanProduto_Idi", "?"))
                sub_lab = sub.get("Laboratorio", sub.get("laboratorio", "?"))
                sub_estoque = sub.get("Estoque", sub.get("estoque", "?"))
                sub_tipo = sub.get("TipoItem", sub.get("tipoItem", "?"))
                sub_cat = sub.get("Categoria", sub.get("categoria", sub.get("TipoProduto", sub.get("tipoProduto", "?"))))
                sub_condicoes = sub.get("Condicoes") or sub.get("condicoes") or []

                print(f"    Sub #{j}: EAN={sub_ean} Desc={sub_desc[:50]} Lab={sub_lab} Est={sub_estoque} Tipo={sub_tipo} Cat={sub_cat} Conds={len(sub_condicoes)}")
                for c in sub_condicoes[:3]:
                    print(f"      Cond: CodDist={c.get('CodDist')} Preco={c.get('Preco')} Pliquido={c.get('Pliquido')} Estoque={c.get('Estoque')} Condicao={c.get('Condicao')} Prazo={c.get('Prazo')} QtdMin={c.get('QtdMin')}")

            for j, cond in enumerate(conds[:5]):
                print(f"    Cond #{j}: EAN={cond.get('Ean','?')} CodDist={cond.get('CodDist')} Preco={cond.get('Preco')} Pliquido={cond.get('Pliquido')} Estoque={cond.get('Estoque')} Tipo={cond.get('TipoItem','?')}")

    except Exception as e:
        print(f"ERRO: {e}")

    # Tambem Condicoes/Ean raw
    print(f"\n--- RAW EAN ---")
    body_ean = json.dumps({
        "Token": token,
        "parametros": {
            "CnpjCLi": cnpj,
            "Ean": ean,
            "AceitaOntem": 1
        }
    }).encode()

    try:
        req = urllib.request.Request(
            "https://api.smartped.com.br/api/Condicoes/Ean",
            data=body_ean,
            headers={"Content-Type": "application/json"}
        )
        resp = urllib.request.urlopen(req, timeout=15)
        raw = resp.read().decode()
        data = json.loads(raw)

        msg = data.get("Mensagem", "")
        retorno = data.get("Retorno")

        if msg:
            print(f"Mensagem: {msg}")
        if retorno is None:
            print("Retorno: null")
            continue

        itens = retorno.get("itens") or retorno.get("Itens") or []
        print(f" itens: {len(itens)}")

        for i, item in enumerate(itens[:2]):
            ip = item.get("ItemPedido") or {}
            conds = item.get("Condicoes") or item.get("condicoes") or []
            print(f"  ItemPedido.TipoItem: {ip.get('TipoItem','?')}")
            print(f"  ItemPedido.Descricao: {ip.get('Descricao','?')[:60]}")
            print(f"  Condicoes: {len(conds)}")
            for c in conds[:3]:
                print(f"    CodDist={c.get('CodDist')} NomeDist={c.get('NomeDist','?')} Preco={c.get('Preco')} Pliquido={c.get('Pliquido')} Estoque={c.get('Estoque')} Condicao={c.get('Condicao')} TipoItem={c.get('TipoItem','?')}")
    except Exception as e:
        print(f"ERRO EAN: {e}")
