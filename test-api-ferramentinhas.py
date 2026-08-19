import json
import urllib.request

eans = ["7896714208565", "7891150037458", "7897595605276", "7891058022136"]
base = "https://api.ferramentinhas.com.br"

for ean in eans:
    print("\n" + "=" * 70)
    print(f"FERRAMENTINHAS - EAN: {ean}")
    print("=" * 70)

    try:
        req = urllib.request.Request(f"{base}/api/produtos/similares/{ean}")
        resp = urllib.request.urlopen(req, timeout=15)
        data = json.loads(resp.read().decode())

        print(f"Success: {data.get('success')}")
        print(f"Encontrou: {data.get('encontrou')}")
        produtos = data.get("produtos", [])
        print(f"Produtos: {len(produtos)}")

        for p in produtos[:3]:
            print(f"\n  nom_produto: {p.get('nom_produto', '?')}")
            print(f"  descricao: {p.get('descricao', '?')}")
            print(f"  nom_laborat: {p.get('nom_laborat', '?')}")
            print(f"  cod_dcb: {p.get('cod_dcb', '?')}")
            print(f"  cod_concentracao: {p.get('cod_concentracao', '?')}")
            print(f"  qtd_estoque: {p.get('qtd_estoque', '?')}")
            print(f"  vlr_custopersonalizado: {p.get('vlr_custopersonalizado', '?')}")
            print(f"  vlr_venda_tabela: {p.get('vlr_venda_tabela', '?')}")
            print(f"  vlr_venda_final: {p.get('vlr_venda_final', '?')}")
            # Verificar se tem campo de tipo/categoria
            for k in sorted(p.keys()):
                if k not in ['ean', 'cod_barra', 'nom_produto', 'descricao', 'nom_laborat', 'laboratorio',
                             'qtd_estoque', 'est_minimo', 'est_maximo', 'estoque_maximo', 'maximo',
                             'cod_reduzido', 'vlr_custopersonalizado', 'vlr_venda_tabela', 'vlr_venda_final',
                             'dat_ultent', 'cod_dcb', 'cod_concentracao']:
                    print(f"  {k}: {p[k]}")

    except Exception as e:
        print(f"ERRO: {e}")
