#!/usr/bin/env bash
# tests/dbpath-check.sh — verifica la resolución de la ruta de la base (db_path de
# src/sqldb.nx): VENINFO_DB manda; sin variable, vacía o solo espacios → ruta por omisión.
#
#   ./tests/dbpath-check.sh
#
# db_path y md_trim se EXTRAEN del código real y se compilan tal cual (mismo patrón
# que hora-check.sh). No arranca el servidor ni toca ninguna base.
set -euo pipefail
cd "$(dirname "$0")/.."
PROJ=$(pwd)
T=$(mktemp -d)
trap 'rm -rf "$T"' EXIT
mkdir -p "$T/src"
printf '[package]\nname = "dbpathtest"\nversion = "0.1.0"\nmain = "src/main.nx"\ndescription = "test de db_path"\n' > "$T/nyx.toml"
{
  sed -n '/^const DB_PATH_DEFAULT/p' "$PROJ/src/sqldb.nx"
  sed -n '/^pub fn db_path(/,/^}/p' "$PROJ/src/sqldb.nx"
  echo
  sed -n '/^fn is_space(/,/^}/p' "$PROJ/src/md.nx"
  echo
  sed -n '/^pub fn md_trim(/,/^}/p' "$PROJ/src/md.nx"
  echo
  echo 'fn main() { println(db_path()) }'
} > "$T/src/main.nx"
n=$(grep -c '^pub fn ' "$T/src/main.nx" || true)
if [ "$n" -ne 2 ]; then
  echo "FALLO: se esperaban 2 funciones extraidas (db_path, md_trim), salieron $n."
  exit 1
fi
(cd "$T" && nyx build >"$T/build.log" 2>&1) || { cat "$T/build.log"; echo "FALLO: no compila"; exit 1; }
BIN="$T/dbpathtest"
DEF=/home/admin/veninfo.ndb
fail=0
check() { # nombre, esperado, obtenido
  if [ "$2" = "$3" ]; then echo "ok $1"; else echo "FALLO $1: esperado '$2', salió '$3'"; fail=1; fi
}
check "sin variable -> omisión"   "$DEF"            "$(env -u VENINFO_DB "$BIN")"
check "variable vacía -> omisión" "$DEF"            "$(VENINFO_DB= "$BIN")"
check "solo espacios -> omisión"  "$DEF"            "$(VENINFO_DB='   ' "$BIN")"
check "variable puesta"           "/tmp/x/copia.ndb" "$(VENINFO_DB=/tmp/x/copia.ndb "$BIN")"
check "se recorta el espacio"     "/tmp/x/copia.ndb" "$(VENINFO_DB=' /tmp/x/copia.ndb ' "$BIN")"
[ "$fail" -eq 0 ] || exit 1
echo "RUTA DE LA BASE: TODOS LOS ASSERTS PASARON"
