#!/usr/bin/env bash
# tests/hora-check.sh — verifica la hora que sale en el aviso push de sismos
# (ve_civil + sismo_hora_txt de src/push.nx).
#
#   ./tests/hora-check.sh
#
# Las funciones NO se copian aquí: se EXTRAEN de src/push.nx y src/bcv.nx y se
# compilan tal cual, así que esto prueba el codigo que corre en produccion y no
# puede divergir de el. Los epochs de los casos estan verificados con `date`
# (TZ=America/Caracas), no calculados a ojo.
#
# Por que existe: la hora se deriva SERVER-SIDE con offset fijo UTC-4 (el aviso se
# arma sin saber la zona del receptor), asi que no pasa por civil_parts del wasm ni
# por la suite del navegador. Y los cruces de dia/anio son terreno de off-by-one
# que no se puede esperar a ver en produccion.
set -euo pipefail
cd "$(dirname "$0")/.."
PROJ=$(pwd)
: "${NYX_HOME:=/home/admin/NyxLang}"
export NYX_HOME
T=$(mktemp -d)
trap 'rm -rf "$T"' EXIT
mkdir -p "$T/src"
printf '[package]\nname = "horatest"\nversion = "0.1.0"\nmain = "src/main.nx"\ndescription = "test de la hora del aviso"\n' > "$T/nyx.toml"
{
  sed -n '/^fn pad2(/,/^}/p' "$PROJ/src/bcv.nx"
  echo
  sed -n '/^fn ve_civil(/,/^}/p' "$PROJ/src/push.nx"
  echo
  sed -n '/^fn sismo_hora_txt(/,/^}/p' "$PROJ/src/push.nx"
} > "$T/src/hora.nx"
n=$(grep -c '^fn ' "$T/src/hora.nx" || true)
if [ "$n" -ne 3 ]; then
  echo "FALLO: se esperaban 3 funciones extraidas (pad2, ve_civil, sismo_hora_txt), salieron $n."
  echo "       ¿Les cambiaron el nombre o la indentacion en src/push.nx / src/bcv.nx?"
  exit 1
fi
cat > "$T/src/main.nx" <<'EOF'
import "src/hora"
var fails: Array = [0]
fn ck(name: String, got: String, want: String) {
    if got != want {
        println("FALLO: " + name + "\n   esperado: [" + want + "]\n   obtenido: [" + got + "]")
        fails[0] = fails[0] + 1
    }
}
fn main() {
    // 2026-07-16 18:35 UTC -> VE 14:35 del mismo dia
    ck("mismo dia", sismo_hora_txt(1784226900, 1784227000), "Hoy a las 14:35")
    // 2026-07-17 02:00 UTC -> VE 22:00 del 16: el dia UTC ya cambio, el VE no.
    // now = 2026-07-17 03:00 UTC -> VE 23:00 del 16 => sigue siendo "Hoy"
    ck("UTC ya cambio de dia, VE no", sismo_hora_txt(1784253600, 1784257200), "Hoy a las 22:00")
    // 2026-07-16 03:00 UTC -> VE 23:00 del 15; now -> VE 10:00 del 16 => con fecha
    ck("cruce de medianoche VE", sismo_hora_txt(1784170800, 1784210400), "15/07 a las 23:00")
    // 2026-01-01 03:30 UTC -> VE 2025-12-31 23:30
    ck("cruce de anio", sismo_hora_txt(1767238200, 1767250000), "31/12 a las 23:30")
    // 2026-03-01 04:00 UTC -> VE 00:00 (pad2 de la hora)
    ck("medianoche VE (pad2)", sismo_hora_txt(1772337600, 1772337700), "Hoy a las 00:00")
    if fails[0] == 0 {
        println("HORA DEL AVISO: TODOS LOS ASSERTS PASARON")
    } else {
        println("FALLOS: " + int_to_string(fails[0]))
    }
}
EOF
out=$(cd "$T" && nyx run 2>&1)
echo "$out" | grep -E "FALLO|PASARON|error" || { echo "$out" | tail -5; exit 1; }
echo "$out" | grep -q "PASARON" || exit 1
