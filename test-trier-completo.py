import json
import urllib.request

token = "eyJhbGciOiJIUzI1NiJ9.eyJjb2RfZmlsaWFsIjoiMSIsInNjb3BlIjpbImRyb2dhcmlhIl0sInRva2VuX2ludGVncmFjYW8iOiJ0cnVlIiwiY29kX2Zhcm1hY2lhIjoiMTIwMzkiLCJleHAiOjQxMDI0NTU2MDAsImlhdCI6MTc2NTMwMDg3NywianRpIjoiNjk4NzUzOGItZTM0ZS00ZjM0LWEyOGEtMzY3ZDg2MjIzYzk2IiwiY29kX3VzdWFyaW8iOiIxMSIsImF1dGhvcml0aWVzIjpbIkFQSV9JTlRFR1JBQ0FPIl19.B3HRuJj9MzXeMYgEFBB7bKdPB1qBz5O_-4JQcDZj8AY"
base = "https://api-sgf-gateway.triersistemas.com.br/sgfpod1/rest"

def test_endpoint(name, url):
    try:
        req = urllib.request.Request(url, headers={"Authorization": f"Bearer {token}"})
        resp = urllib.request.urlopen(req, timeout=10)
        data = json.loads(resp.read().decode())
        if isinstance(data, list):
            print(f"  {name}: OK ({len(data)} itens)")
            return data
        else:
            print(f"  {name}: OK (objeto)")
            return data
    except urllib.error.HTTPError as e:
        print(f"  {name}: HTTP {e.code}")
        return None
    except Exception as e:
        print(f"  {name}: ERRO {e}")
        return None

print("=" * 70)
print("TESTE 1: Busca por EAN (codigoBarra)")
print("=" * 70)
data = test_endpoint("codigoBarra", f"{base}/integracao/produto/obter-v1?codigoBarra=7896714208565&primeiroRegistro=0&quantidadeRegistros=5")
if data and isinstance(data, list) and len(data) > 0:
    p = data[0]
    print(f"  PRIMEIRO: {p.get('nome')} | class={p.get('nomeClassificacao')} | grupo={p.get('nomeGrupo')} | ean={p.get('codigoBarras')}")

print()
print("=" * 70)
print("TESTE 2: Estoque")
print("=" * 70)
data = test_endpoint("estoque", f"{base}/integracao/estoque/obter-v1?primeiroRegistro=0&quantidadeRegistros=3")
if data and isinstance(data, list) and len(data) > 0:
    p = data[0]
    print(f"  PRIMEIRO: {json.dumps(p, indent=2, ensure_ascii=False)[:500]}")

print()
print("=" * 70)
print("TESTE 3: Principio Ativo")
print("=" * 70)
data = test_endpoint("principio-ativo", f"{base}/integracao/produto/principio-ativo/obter-v1?primeiroRegistro=0&quantidadeRegistros=5")
if data and isinstance(data, list) and len(data) > 0:
    for p in data[:3]:
        print(f"  {p}")

print()
print("=" * 70)
print("TESTE 4: Vendas/Pedidos")
print("=" * 70)
for ep in ["vendas", "pedido", "movimentacao"]:
    test_endpoint(ep, f"{base}/integracao/{ep}/obter-v1?primeiroRegistro=0&quantidadeRegistros=2")

print()
print("=" * 70)
print("TESTE 5: Identificador (busca EAN)")
print("=" * 70)
test_endpoint("identificador", f"{base}/integracao/produto/identificador/obter-v1?primeiroRegistro=0&quantidadeRegistros=5")

print()
print("=" * 70)
print("TESTE 6: Produto por Codigo interno")
print("=" * 70)
data = test_endpoint("produto-codigo", f"{base}/integracao/produto/obter-v1?codigo=1&primeiroRegistro=0&quantidadeRegistros=1")
if data and isinstance(data, list) and len(data) > 0:
    p = data[0]
    print(f"  codigo={p.get('codigo')} | nome={p.get('nome')} | class={p.get('nomeClassificacao')} | grupo={p.get('nomeGrupo')}")
    print(f"  codBarras={p.get('codigoBarras')} | lab={p.get('nomeLaboratorio')}")
    print(f"  princAtivo={p.get('nomePrincipioAtivo')} | codPrincAtivo={p.get('codigoPrincipioAtivo')}")
