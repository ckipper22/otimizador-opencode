import os
import json
import urllib.request
import re

token = os.environ.get("SMARTPED_PRODUCTION_TOKEN", "")
cnpj = "13408443000168"

items_o = [
    ("7896714294377", "PARACETAMOL 750MG 20CP", "NEO QUIMICA"),
    ("7896862994372", "DAPAGLIFLOZINA 10MG 30CP REV", "MEDQUIMICA"),
    ("7898700412369", "LORATADINA 10MG 12CP", "VITAMEDIC"),
    ("7891000096482", "NUTREN SENIOR S/SABOR PO 370G", "NESTLE"),
    ("7897947606517", "LAVITAN A-Z 60CP REV", "CIMED"),
    ("7898103651068", "CLORIDRATO DE NARATRIPTANA 2,5MG 8CP REV", "NOVA QUIMICA"),
    ("7896862993962", "CLORIDRATO DE DONEPEZILA 10MG 30CP REV", "MEDQUIMICA"),
]

print("=" * 80)
print("ANALISE DOS ITENS TipoItem='O' - REGEX DE CLASSIFICACAO")
print("=" * 80)

for ean, desc_sicf, lab_sicf in items_o:
    body = json.dumps({
        "Token": token,
        "parametros": {"CnpjCLi": cnpj, "Ean": ean, "ConsideraTipo": 1}
    }).encode()

    try:
        req = urllib.request.Request("https://api.smartped.com.br/api/Condicoes/Molecula",
                                     data=body, headers={"Content-Type": "application/json"})
        resp = urllib.request.urlopen(req, timeout=15)
        data = json.loads(resp.read().decode())

        retorno = data.get("Retorno")
        if not retorno:
            print(f"\nEAN {ean}: API retornou null")
            continue

        itens = retorno.get("itens") or []
        if not itens:
            print(f"\nEAN {ean}: Sem itens")
            continue

        entry = itens[0]
        mol = entry.get("Molecula", "")
        tipo = entry.get("TipoItem", "")
        desc_api = entry.get("Descricao", "")
        lab_api = entry.get("Laboratorio", "")
        subs = entry.get("Substitutos") or []

        print(f"\nEAN: {ean}")
        print(f"  Desc SICF:  {desc_sicf}")
        print(f"  Lab SICF:   {lab_sicf}")
        print(f"  TipoItem:   {tipo}")
        print(f"  Molecula:   {mol}")
        print(f"  Desc API:   {desc_api}")
        print(f"  Lab API:    {lab_api}")
        print(f"  Substitutos: {len(subs)}")

        # REGEX na descricao combinada (SICF + API)
        combined_desc = (desc_sicf + " " + desc_api).lower()
        combined_lab = (lab_sicf + " " + lab_api).lower()

        # Padroes de genrico
        gen_patterns_desc = [
            r'\bgen\b',           # "GEN" sozinho
            r'generico',          # "generico"
            r'generico',          # "generico"
            r'gn\b',             # "GN" no fim
            r'\bgen\s',          # "GEN " seguido de espaco
        ]
        gen_patterns_lab = [
            r'generico',
            r'generico',
        ]

        is_gen_desc = any(re.search(p, combined_desc) for p in gen_patterns_desc)
        is_gen_lab = any(re.search(p, combined_lab) for p in gen_patterns_lab)
        has_dash = ' - ' in combined_desc

        print(f"\n  ANALISE REGEX:")
        print(f"    Desc contem padrao gen: {is_gen_desc}")
        print(f"    Lab contem 'generico':  {is_gen_lab}")
        print(f"    Tem ' - ' na desc:      {has_dash}")

        if is_gen_desc or is_gen_lab:
            if has_dash:
                print(f"    RESULTADO: MARCA (tem ' - ' = separador de marca)")
                print(f"    Ex: 'CLONAZEPAM - MEDLEY' = marca do MEDLEY, nao e generico")
            else:
                print(f"    RESULTADO: GENERICO (pelo regex)")
        else:
            print(f"    RESULTADO: NAO identificado como generico")

        # Verificar tambem: e suplemento/alimento?
        supl_patterns = ['nutren', 'lavitan', 'complexo b', 'vitamina', 'colageno', 'omega']
        is_supl = any(p in combined_desc.lower() for p in supl_patterns)
        if is_supl:
            print(f"    NOTA: Parece suplemento/alimento (nao medicamento)")

    except Exception as e:
        print(f"\nEAN {ean}: ERRO - {e}")
