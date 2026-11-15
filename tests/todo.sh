#!/usr/bin/env bash
# tests/todo.sh — corre TODAS las suites del proyecto y resume el resultado.
#
#   ./tests/todo.sh            # todo (tarda ~2-3 min; sqldb-check espera 66 s)
#   ./tests/todo.sh --rapido   # sin sqldb-check ni la parte de red de net-check
#
# No incluye tests/humo.sh (levanta el binario del servidor en modo de prueba):
# se corre aparte, después de `nyx build`.
set -uo pipefail
cd "$(dirname "$0")/.."
RAPIDO=0; [ "${1:-}" = "--rapido" ] && RAPIDO=1
fallos=0
corre() { # nombre, comando...
  local nombre="$1"; shift
  local out; out=$("$@" 2>&1); local rc=$?
  if [ $rc -eq 0 ]; then echo "ok    $nombre — $(echo "$out" | tail -1)"
  else echo "FALLO $nombre"; echo "$out" | tail -12 | sed 's/^/      /'; fallos=$((fallos + 1)); fi
}
corre "poligono de Venezuela"   node tests/poly-check.mjs
corre "hora del aviso"          ./tests/hora-check.sh
corre "ruta de la base"         ./tests/dbpath-check.sh
corre "logica de push"          ./tests/push-check.sh
if [ $RAPIDO -eq 1 ]; then
  corre "red y lista blanca (sin red)" ./tests/net-check.sh --sin-red
else
  corre "red y lista blanca"    ./tests/net-check.sh
  corre "base de datos"         ./tests/sqldb-check.sh
fi
corre "front wasm (headless)"   node "$HOME/nyxlang/examples/browser/run-node.mjs" static/assets/veninfo.wasm wasm/tests/imports.mjs
if [ $fallos -eq 0 ]; then echo "TODAS LAS SUITES PASARON"; else echo "SUITES CON FALLOS: $fallos"; exit 1; fi
