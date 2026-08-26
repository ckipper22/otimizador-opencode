import os
import json
import urllib.request

token = os.environ.get("FERRAMENTINHAS_TOKEN", "")
base = "https://api-sgf-gateway.triersistemas.com.br/sgfpod1/rest"
eans = ["7896714208565", "7891150037458", "7897595605276", "7891058022136"]

for ean in eans:
    print("\n" + "=" * 70)
    print(f"TRIER SGF - EAN: {ean}")
    print("=" * 70)

    try:
        url = f"{base}/integracao/produto/obter-v1?codigoBarra={ean}&primeiroRegistro=0&quantidadeRegistros=5"
        req = urllib.request.Request(url, headers={"Authorization": f"Bearer {token}"})
        resp = urllib.request.urlopen(req, timeout=15)
        data = json.loads(resp.read().decode())

        if isinstance(data, list):
            items = data
        else:
            items = [data]

        print(f"Produtos retornados: {len(items)}")

        for i, p in enumerate(items[:3]):
            print(f"\n  Produto #{i}:")
            print(f"    codigo: {p.get('codigo')}")
            print(f"    nome: {p.get('nome')}")
            print(f"    codigoBarras: {p.get('codigoBarras')}")
            print(f"    nomeLaboratorio: {p.get('nomeLaboratorio')}")
            print(f"    nomeGrupo: {p.get('nomeGrupo')} (codigoGrupo={p.get('codigoGrupo')})")
            print(f"    nomeCategoria: {p.get('nomeCategoria')} (codigoCategoria={p.get('codigoCategoria')})")
            print(f"    nomeClassificacao: {p.get('nomeClassificacao')} (codigoClassificacao={p.get('codigoClassificacao')})")
            print(f"    nomeDepartamento: {p.get('nomeDepartamento')}")
            print(f"    nomePrincipioAtivo: {p.get('nomePrincipioAtivo')}")
            print(f"    valorVenda: {p.get('valorVenda')}")
            print(f"    valorCusto: {p.get('valorCusto')}")
            print(f"    quantidadeEstoque: {p.get('quantidadeEstoque')}")
            print(f"    unidade: {p.get('unidade')}")

    except urllib.error.HTTPError as e:
        print(f"  ERRO HTTP {e.code}")
    except Exception as e:
        print(f"  ERRO: {e}")
