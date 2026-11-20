#!/bin/bash
# Lanceur macOS : double-clic dans le Finder.
cd "$(dirname "$0")" || exit 1

PY=""
for c in python3 /opt/homebrew/bin/python3 /usr/local/bin/python3; do
  if command -v "$c" >/dev/null 2>&1 && [ "$(command -v "$c")" != "/usr/bin/python3" ] \
     && "$c" -c "import http.server" >/dev/null 2>&1; then PY="$c"; break; fi
done
# /usr/bin/python3 n'est qu'un raccourci tant que les outils Xcode ne sont pas installes.
if [ -z "$PY" ] && xcode-select -p >/dev/null 2>&1 && /usr/bin/python3 -c "import http.server" >/dev/null 2>&1; then
  PY=/usr/bin/python3
fi

if [ -n "$PY" ]; then
  exec "$PY" serveur.py "$@"
fi

if command -v ruby >/dev/null 2>&1 && ruby -e 'require "webrick"' >/dev/null 2>&1; then
  echo "Python introuvable : on utilise Ruby (fourni avec macOS)."
  echo "Air Game tourne sur http://localhost:8317/ (ferme cette fenetre pour arreter)."
  (sleep 1; open "http://localhost:8317/") &
  exec ruby -run -e httpd . -b 127.0.0.1 -p 8317
fi

echo "Python 3 est introuvable."
echo "Installe-le depuis https://www.python.org/downloads/ (ou lance : xcode-select --install),"
echo "puis double-clique a nouveau sur jouer.command."
read -n 1 -s -r -p "Appuie sur une touche pour fermer..."
