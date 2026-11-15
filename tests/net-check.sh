#!/usr/bin/env bash
# tests/net-check.sh — verifica el cliente de salida (src/net.nx) y la lista blanca
# de endpoints push (push_host_ok de src/push.nx).
#
#   ./tests/net-check.sh           # todo (la parte de red SALE a internet)
#   ./tests/net-check.sh --sin-red # solo la lista blanca (determinista)
#
# El código se EXTRAE de src/ y se compila tal cual (patrón de hora-check.sh): no
# arranca el servidor ni toca ninguna base.
#
# Por qué existe: desde nyx 0.44 std/http verifica certificados. net.nx verifica
# todo MENOS bcv.org.ve (cadena rota); si esa excepción se pierde, las tasas caen
# al respaldo en silencio, y si se ensancha, se deja de verificar a los demás.
set -euo pipefail
cd "$(dirname "$0")/.."
PROJ=$(pwd)
RED=1; [ "${1:-}" = "--sin-red" ] && RED=0
T=$(mktemp -d)
trap 'rm -rf "$T"' EXIT
mkdir -p "$T/src"
printf '[package]\nname = "nettest"\nversion = "0.1.0"\nmain = "src/main.nx"\ndescription = "test de net.nx"\n' > "$T/nyx.toml"
{
  echo 'import "std/http"'
  # net.nx entero (solo depende de std/http).
  cat "$PROJ/src/net.nx"
  echo
  sed -n '/^fn starts_with(/,/^}/p' "$PROJ/src/push.nx"
  sed -n '/^fn ends_with(/,/^}/p' "$PROJ/src/push.nx"
  sed -n '/^fn push_host_ok(/,/^}/p' "$PROJ/src/push.nx"
  cat <<'EOF'

var fallos: Array = [0]

fn host(nombre: String, url: String, esperado: bool) {
    if push_host_ok(url) == esperado {
        println("ok " + nombre)
    } else {
        println("FALLO " + nombre + ": " + url)
        fallos[0] = fallos[0] + 1
    }
}

fn red(nombre: String, url: String, debe_responder: bool) {
    let b: String = net_get(url)
    let respondio: bool = b.length() > 0
    if respondio == debe_responder {
        println("ok " + nombre + " (" + int_to_string(b.length()) + " bytes)")
    } else {
        println("FALLO " + nombre + ": " + url + " -> " + int_to_string(b.length()) + " bytes")
        fallos[0] = fallos[0] + 1
    }
}

fn main() {
    host("fcm", "https://fcm.googleapis.com/fcm/send/abc", true)
    host("mozilla", "https://updates.push.services.mozilla.com/wpush/v2/x", true)
    host("apple", "https://web.push.apple.com/Qx", true)
    host("windows", "https://db5p.notify.windows.com/w/?token=x", true)
    host("http plano", "http://fcm.googleapis.com/x", false)
    host("host ajeno", "https://evil.example/x", false)
    host("puerto + sufijo (SSRF)", "https://evil.example:443.push.apple.com/x", false)
    host("userinfo", "https://fcm.googleapis.com@evil.example/x", false)
    host("userinfo + sufijo", "https://evil.example@x.push.apple.com/x", false)
    host("query sin ruta", "https://evil.example?.push.apple.com/x", false)
    host("fragmento", "https://evil.example#.push.apple.com/x", false)
    host("barra invertida", "https://evil.example\\.push.apple.com/x", false)
    host("espacio", "https://evil.example .push.apple.com/x", false)
    host("sufijo sin punto", "https://evilpush.apple.com.evil.example/x", false)
    host("vacio", "https:///x", false)
    if getenv("NET_CHECK_RED") == "1" {
        red("BCV (excepcion: cadena sin verificar)", "https://www.bcv.org.ve/", true)
        red("criptoya (verificado)", "https://criptoya.com/api/binancep2p/USDT/VES/1", true)
        red("EMSC (verificado)", "https://www.seismicportal.eu/fdsnws/event/1/query?limit=1&format=text", true)
        red("FUNVISIS (http plano)", "http://www.funvisis.gob.ve/maravilla.json", true)
        red("cert vencido se RECHAZA", "https://expired.badssl.com/", false)
        red("cert de otro nombre se RECHAZA", "https://wrong.host.badssl.com/", false)
        red("cert autofirmado se RECHAZA", "https://self-signed.badssl.com/", false)
    }
    if fallos[0] > 0 {
        println("HAY FALLOS: " + int_to_string(fallos[0]))
        exit(1)
    }
    println("NET: TODOS LOS ASSERTS PASARON")
}
EOF
} > "$T/src/main.nx"
(cd "$T" && nyx build >"$T/build.log" 2>&1) || { cat "$T/build.log"; echo "FALLO: no compila"; exit 1; }
NET_CHECK_RED=$RED "$T/nettest"
