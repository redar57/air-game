"""Petit serveur local pour Air Game (aucune dependance, Python 3 seulement).

Usage : python3 serveur.py [--no-browser] [--port N]
Fonctionne a l'identique sous Windows, macOS et Linux.
"""
import http.server
import os
import socket
import socketserver
import sys
import threading
import urllib.request
import webbrowser

DEFAULT_PORT = 8317
ROOT = os.path.dirname(os.path.abspath(__file__))
os.chdir(ROOT)


class Handler(http.server.SimpleHTTPRequestHandler):
    # Sous Windows, le registre peut associer .js a "text/plain" : les navigateurs
    # refusent alors de charger les modules. On force donc les bons types.
    extensions_map = {
        **http.server.SimpleHTTPRequestHandler.extensions_map,
        ".js": "text/javascript",
        ".mjs": "text/javascript",
        ".json": "application/json",
        ".html": "text/html; charset=utf-8",
        ".wasm": "application/wasm",
    }

    def __init__(self, *args, **kwargs):
        super().__init__(*args, directory=ROOT, **kwargs)

    def end_headers(self):
        # Pas de cache : une mise a jour du jeu est visible tout de suite.
        self.send_header("Cache-Control", "no-store")
        super().end_headers()

    def log_message(self, *args):
        pass

    def handle(self):
        # Un onglet ferme en plein chargement ne doit pas afficher de trace d'erreur.
        try:
            super().handle()
        except (ConnectionError, socket.timeout):
            pass


class Server(socketserver.ThreadingMixIn, http.server.HTTPServer):
    daemon_threads = True
    # Sous Windows, SO_REUSEADDR permet a DEUX serveurs d'ecouter le meme port
    # (et on ne sait plus lequel repond) : on ne l'active que sur macOS / Linux.
    allow_reuse_address = os.name != "nt"


def is_air_game(port):
    """Vrai si un Air Game tourne deja sur ce port."""
    try:
        with urllib.request.urlopen(f"http://127.0.0.1:{port}/index.html", timeout=1.5) as r:
            return b"AIR GAME" in r.read()
    except Exception:
        return False


def parse_port():
    if "--port" in sys.argv:
        i = sys.argv.index("--port")
        try:
            return int(sys.argv[i + 1]), True
        except (IndexError, ValueError):
            pass
    if os.environ.get("PORT", "").isdigit():
        return int(os.environ["PORT"]), True
    return DEFAULT_PORT, False


def main():
    open_browser = "--no-browser" not in sys.argv
    port, forced = parse_port()
    httpd = None
    for p in ([port] if forced else range(port, port + 20)):
        try:
            httpd = Server(("127.0.0.1", p), Handler)
            port = p
            break
        except OSError:
            if not forced and is_air_game(p):
                # Deja lance dans une autre fenetre : on ouvre juste le jeu.
                print(f"Air Game tourne deja sur http://localhost:{p}/")
                if open_browser:
                    webbrowser.open(f"http://localhost:{p}/")
                return 0
    if httpd is None:
        print(f"Impossible d'ouvrir le port {port} : il est deja utilise par un autre programme.")
        return 1

    url = f"http://localhost:{port}/"
    print(f"Air Game tourne sur {url}")
    print("Laisse cette fenetre ouverte pendant que tu joues (ferme-la pour arreter).")
    if open_browser:
        threading.Timer(0.6, lambda: webbrowser.open(url)).start()
    try:
        httpd.serve_forever()
    except KeyboardInterrupt:
        pass
    return 0


if __name__ == "__main__":
    sys.exit(main())
