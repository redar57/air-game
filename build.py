"""Assemble tout le jeu dans un seul fichier, jouer.html, qui s'ouvre d'un double-clic (sans serveur).

Usage : python3 build.py

Chaque module JavaScript est embarqué sous forme d'URL « data: » et relié aux autres par une
« import map » : le code reste identique à celui de src/, seuls les chemins d'import changent.
Le processeur audio (engine-worklet.js) est embarqué comme texte et chargé via une URL Blob.
"""
import base64
import json
import os
import re
import sys

ROOT = os.path.dirname(os.path.abspath(__file__))
OUT = os.path.join(ROOT, "jouer.html")
THREE = "vendor/three.module.min.js"
IMPORT_RE = re.compile(r"""(\bfrom\s*|\bimport\s*)(['"])([^'"]+)\2""")


def read(rel):
    with open(os.path.join(ROOT, rel), encoding="utf-8") as f:
        return f.read()


def key(rel):
    return "airgame/" + rel


def resolve(spec, importer):
    if spec == "three":
        return THREE
    if spec.startswith("."):
        base = os.path.dirname(importer)
        return os.path.normpath(os.path.join(base, spec)).replace(os.sep, "/")
    raise ValueError(f"import inconnu « {spec} » dans {importer}")


def collect(entry):
    """Parcourt les imports depuis entry ; renvoie {chemin: source réécrite}."""
    mods, todo = {}, [entry]
    while todo:
        rel = todo.pop()
        if rel in mods:
            continue
        src = read(rel)
        if rel == THREE:
            mods[rel] = src
            continue

        def sub(m):
            target = resolve(m.group(3), rel)
            todo.append(target)
            name = "three" if target == THREE else key(target)
            return f"{m.group(1)}{m.group(2)}{name}{m.group(2)}"

        mods[rel] = IMPORT_RE.sub(sub, src)
    return mods


def main():
    mods = collect("src/main.js")
    imports = {}
    for rel, src in sorted(mods.items()):
        b64 = base64.b64encode(src.encode("utf-8")).decode("ascii")
        imports["three" if rel == THREE else key(rel)] = "data:text/javascript;base64," + b64

    html = read("index.html")
    # redirection file:// -> jouer.html (inutile ici)
    html = re.sub(r'<script id="redirect">.*?</script>\n?', "", html, flags=re.S)
    html = re.sub(
        r'<script type="importmap">.*?</script>',
        lambda _: '<script type="importmap">' + json.dumps({"imports": imports}) + "</script>",
        html, count=1, flags=re.S,
    )
    worklet = json.dumps(read("src/engine-worklet.js"))
    html = html.replace(
        '<script type="module" src="./src/main.js"></script>',
        f"<script>window.AIRGAME_WORKLET = {worklet};</script>\n"
        f'<script type="module">import "{key("src/main.js")}";</script>',
    )
    if key("src/main.js") not in html:
        sys.exit("index.html : balise <script type=\"module\" src=\"./src/main.js\"> introuvable")
    html = html.replace(
        "<head>",
        "<head>\n<!-- Fichier généré par build.py à partir de index.html et src/ : ne pas le modifier à la main. -->",
        1,
    )
    with open(OUT, "w", encoding="utf-8", newline="\n") as f:
        f.write(html)
    print(f"jouer.html : {len(mods)} modules, {os.path.getsize(OUT) / 1e6:.2f} Mo")


if __name__ == "__main__":
    main()
