#!/usr/bin/env bash
# tests/push-check.sh — lógica pura de src/push.nx que no se puede esperar a ver en
# producción: validación de las claves de una suscripción y el descarte del aviso
# duplicado cuando el MISMO sismo llega por las dos fuentes (EMSC y FUNVISIS).
#
#   ./tests/push-check.sh
#
# Las funciones se EXTRAEN de src/push.nx y se compilan tal cual.
set -euo pipefail
cd "$(dirname "$0")/.."
PROJ=$(pwd)
T=$(mktemp -d)
trap 'rm -rf "$T"' EXIT
mkdir -p "$T/src"
cp "$PROJ/src/num.nx" "$T/src/"
printf '[package]\nname = "pushtest"\nversion = "0.1.0"\nmain = "src/main.nx"\ndescription = "test de push"\n' > "$T/nyx.toml"
{
  echo 'import "src/num"'
  for f in starts_with b64url_ok sismo_fuente push_seen_otra_fuente; do
    sed -n "/^fn $f(/,/^}/p" "$PROJ/src/push.nx"; echo
  done
  cat <<'EOF'
var fallos: Array = [0]
fn t(nombre: String, obtenido: bool, esperado: bool) {
    if obtenido == esperado { println("ok " + nombre) } else { println("FALLO " + nombre); fallos[0] = fallos[0] + 1 }
}
// registro de sismo como los de all_quakes(): [id, time, lat, lon, depth, mtype, mag, place, epoch]
fn rec(id: String, lat: String, lon: String, ep: int) -> Array {
    let r: Array = [id, "", lat, lon, "", "", "4.0", "x", ep]
    return r
}
fn main() {
    fallos = [0]
    t("p256dh real (87)", b64url_ok("BNcRdreALRFXTkOOUHK1EtK2wtaz5Ry4YfYCA_0QTpQtUbVlUls0VJXg7A8u-Ts1XbjhazAkj7I99e8QcYP7DkM", 80, 100), true)
    t("auth real (22)", b64url_ok("tBHItJI5svbpez7KI4CCXg", 16, 32), true)
    t("clave corta", b64url_ok("abc", 80, 100), false)
    t("clave con comilla", b64url_ok("tBHItJI5svbpez7KI4CC'g", 16, 32), false)
    t("clave con espacio", b64url_ok("tBHItJI5svbpez7KI4CC g", 16, 32), false)
    t("clave enorme", b64url_ok("AAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAA", 80, 100), false)

    // Huellas ya avisadas: [fuente, epoch, lat, lon]
    let g1: Array = ["em", "1000000", "10.50", "-66.90"]
    let g2: Array = ["fv", "2000000", "8.10", "-71.20"]
    let geo: Array = [g1, g2]
    t("FUNVISIS repite uno de EMSC (60 s, 0,1 grados)", push_seen_otra_fuente(geo, rec("fv-1000060-1045--6695", "10.45", "-66.95", 1000060)), true)
    t("EMSC repite uno de FUNVISIS", push_seen_otra_fuente(geo, rec("20261115_0000123", "8.2", "-71.1", 1999940)), true)
    t("misma fuente (replica) NO se descarta", push_seen_otra_fuente(geo, rec("20261115_0000124", "10.50", "-66.90", 1000030)), false)
    t("otra fuente pero 10 min despues", push_seen_otra_fuente(geo, rec("fv-1000600-1050--6690", "10.50", "-66.90", 1000600)), false)
    t("otra fuente pero a 1 grado", push_seen_otra_fuente(geo, rec("fv-1000000-1150--6690", "11.50", "-66.90", 1000000)), false)
    t("coordenadas basura no abortan", push_seen_otra_fuente(geo, rec("fv-x", "10,5", "", 1000000)), false)
    let vacio: Array = []
    t("sin huellas", push_seen_otra_fuente(vacio, rec("fv-1", "10.5", "-66.9", 1000000)), false)
    if fallos[0] > 0 { println("HAY FALLOS: " + int_to_string(fallos[0])); exit(1) }
    println("PUSH: TODOS LOS ASSERTS PASARON")
}
EOF
} > "$T/src/main.nx"
(cd "$T" && nyx build >"$T/build.log" 2>&1) || { tail -15 "$T/build.log"; echo "FALLO: no compila"; exit 1; }
"$T/pushtest"
