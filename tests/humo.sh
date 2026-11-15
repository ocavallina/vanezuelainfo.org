#!/usr/bin/env bash
# tests/humo.sh — prueba de humo del BINARIO del servidor en MODO DE PRUEBA.
#
#   ./tests/humo.sh            # usa ./venezuelainfo-org (compilar antes con `nyx build`)
#
# Levanta el binario en 127.0.0.1:$PUERTO con:
#   VENINFO_TEST=1        sin hilos de fondo (ni refresher ni avisos push)
#   VENINFO_DB=<temporal> base de prueba (el binario se niega a arrancar sin ella)
#   VENINFO_KV_PORT=1     puerto cerrado: no habla con el nyx-kv real
# y sin VENINFO_ADMIN_PASSWORD. No toca producción: ni la base, ni nyx-kv, ni manda
# avisos. Sí sale a internet (feeds de sismos/noticias) como cualquier visita.
# Lo que NO cubre por no tener nyx-kv: login real del admin, el interruptor del
# chat ENCENDIDO y el contenido de Baquiano.
set -uo pipefail
cd "$(dirname "$0")/.."
BIN="$(pwd)/venezuelainfo-org"
PUERTO="${PUERTO:-3999}"
B="http://127.0.0.1:$PUERTO"
T=$(mktemp -d)
PID=""
limpiar() { [ -n "$PID" ] && kill "$PID" 2>/dev/null && wait "$PID" 2>/dev/null; rm -rf "$T"; }
trap limpiar EXIT
fail=0
ok()  { echo "ok $1"; }
mal() { echo "FALLO $1"; fail=1; }
es()  { # nombre, esperado, obtenido
  if [ "$2" = "$3" ]; then ok "$1"; else mal "$1: esperado '$2', salió '$3'"; fi; }
code() { curl -s -o /dev/null -m 40 -w '%{http_code}' "$@"; }

[ -x "$BIN" ] || { echo "No existe $BIN: compilar con nyx build"; exit 1; }
if ss -ltn 2>/dev/null | grep -q ":$PUERTO "; then echo "El puerto $PUERTO está ocupado (PUERTO=otro ./tests/humo.sh)"; exit 1; fi

# 1) Sin VENINFO_DB el modo de prueba se NIEGA a arrancar (no debe abrir la base real).
env -u VENINFO_DB VENINFO_TEST=1 PORT="$PUERTO" VENINFO_KV_PORT=1 timeout 20 "$BIN" >"$T/negado.log" 2>&1
es "sin VENINFO_DB, el modo de prueba no arranca (exit 2)" "2" "$?"

# 2) Arranque en modo de prueba
env -u VENINFO_ADMIN_PASSWORD VENINFO_TEST=1 VENINFO_DB="$T/prueba.ndb" VENINFO_KV_PORT=1 \
    PORT="$PUERTO" NYX_SERVE_DRAIN_SECS=1 "$BIN" >"$T/server.log" 2>&1 &
PID=$!
for i in $(seq 1 40); do [ "$(code "$B/api/health")" = "200" ] && break; sleep 0.5; done
es "arranca y responde /api/health" "200" "$(code "$B/api/health")"
grep -q "\[sqldb\] base: $T/prueba.ndb" "$T/server.log" && ok "usa la base de prueba" || mal "no anunció la base de prueba"
grep -q "MODO DE PRUEBA" "$T/server.log" && ok "anuncia el modo de prueba (sin hilos de fondo)" || mal "no anunció el modo de prueba"

# 3) Páginas
for p in / /clima /finanzas /calculadora /noticias /sismos /baquiano /api/rates /manifest.webmanifest /sw.js /assets/style.css; do
  es "GET $p" "200" "$(code "$B$p")"
done
es "GET /no-existe" "404" "$(code "$B/no-existe")"

# 4) Chat oculto (estado por omisión)
es "chat oculto: /chat" "404" "$(code "$B/chat")"
es "chat oculto: /api/rooms" "404" "$(code "$B/api/rooms")"
es "chat oculto: /api/chat" "404" "$(code "$B/api/chat")"
es "chat oculto: /api/chat/general" "404" "$(code "$B/api/chat/general")"
es "chat oculto: POST /api/chat/send" "404" "$(code -X POST -H 'X-Real-IP: 10.1.1.1' --data 'room=general&nick=a&texto=hola' "$B/api/chat/send")"
curl -s -m 40 "$B/" > "$T/index.html"
grep -q 'data-key="chat"' "$T/index.html" && mal "la portada muestra la tarjeta del chat" || ok "la portada no muestra la tarjeta del chat"
grep -q 'data-key="baquiano"' "$T/index.html" && ok "la portada conserva las demás tarjetas" || mal "falta la tarjeta de baquiano"

# 5) CSP con nonce
curl -s -m 40 -D "$T/h.txt" -o "$T/fin.html" "$B/finanzas"
csp=$(grep -i '^content-security-policy:' "$T/h.txt" | tr -d '\r')
nh=$(echo "$csp" | grep -o "'nonce-[0-9a-f]*'" | sed "s/'nonce-//; s/'//")
nb=$(grep -o '<script nonce="[^"]*"' "$T/fin.html" | sed 's/.*nonce="//; s/"//')
[ ${#nh} -eq 32 ] && ok "la CSP lleva un nonce de 128 bits" || mal "nonce ausente o corto en la cabecera: '$nh'"
es "el nonce de la cabecera es el del script del layout" "$nh" "$nb"
grep -q '@NONCE@' "$T/fin.html" && mal "quedó el marcador @NONCE@ sin sustituir" || ok "no queda marcador sin sustituir"
echo "$csp" | grep -q "script-src 'self' 'nonce-" && ! echo "$csp" | grep -q "script-src[^;]*unsafe-inline" && ok "script-src sin unsafe-inline" || mal "script-src permite unsafe-inline"
n2=$(curl -s -m 40 -D - -o /dev/null "$B/finanzas" | grep -io "'nonce-[0-9a-f]*'" | head -1)
[ "'nonce-$nh'" != "$n2" ] && ok "el nonce cambia en cada respuesta" || mal "el nonce se repite"
enlinea=0
for p in / /clima /finanzas /calculadora /noticias /sismos /baquiano; do
  n=$(curl -s -m 40 "$B$p" | grep -oE '<[a-zA-Z][^>]* on[a-z]+="' | wc -l); enlinea=$((enlinea + n))
done
es "sin atributos on*= en las páginas públicas" "0" "$enlinea"

# 6) Detalle de un sismo: SRI de Leaflet
id=$(curl -s -m 40 "$B/sismos" | grep -o 'data-id="[^"]*"' | head -1 | sed 's/data-id="//; s/"//')
if [ -n "$id" ]; then
  curl -s -m 40 "$B/sismos/$id" > "$T/q.html"
  es "detalle de sismo: 4 recursos de unpkg con integrity" "4" "$(grep -o 'unpkg.com[^>]*integrity="sha384-' "$T/q.html" | wc -l)"
  grep -q 'id="qmap"' "$T/q.html" && ok "detalle de sismo: trae el mapa" || mal "detalle sin mapa"
else
  echo "aviso: /sismos no trajo eventos (¿feeds caídos?); se salta el detalle"
fi

# 7) Límite de intentos de login por IP (8 cada 10 min)
ult=""
for i in $(seq 1 9); do ult=$(code -X POST -H 'X-Real-IP: 10.9.9.9' -H "X-Forwarded-For: 1.2.3.$i" --data 'pass=x' "$B/admin/login"); done
es "9º intento de login desde la misma IP (aun cambiando X-Forwarded-For)" "429" "$ult"
r=$(code -X POST -H 'X-Real-IP: 10.9.9.10' --data 'pass=x' "$B/admin/login")
[ "$r" != "429" ] && ok "otra IP no queda bloqueada ($r)" || mal "otra IP quedó bloqueada"

# 8) Alta de avisos push: lista blanca y claves (no se envía ningún aviso)
sub() { curl -s -m 40 -X POST -H 'X-Real-IP: 10.2.2.2' --data-urlencode "endpoint=$1" --data-urlencode "p256dh=$2" --data-urlencode "auth=$3" --data 'topics=sismos' "$B/api/push/subscribe"; }
K=BNcRdreALRFXTkOOUHK1EtK2wtaz5Ry4YfYCA_0QTpQtUbVlUls0VJXg7A8u-Ts1XbjhazAkj7I99e8QcYP7DkM; A=tBHItJI5svbpez7KI4CCXg
sub "https://evil.example:443.push.apple.com/x" "$K" "$A" | grep -q 'no permitido' && ok "push: host con puerto + sufijo rechazado" || mal "push: SSRF aceptado"
sub "https://fcm.googleapis.com/fcm/send/prueba-humo" "abc" "$A" | grep -q 'no validas' && ok "push: claves mal formadas rechazadas" || mal "push: claves malas aceptadas"
sub "https://fcm.googleapis.com/fcm/send/prueba-humo" "$K" "$A" | grep -q '"ok":true' && ok "push: alta válida aceptada" || mal "push: alta válida rechazada"
curl -s -m 40 -X POST --data-urlencode "endpoint=https://fcm.googleapis.com/fcm/send/prueba-humo" "$B/api/push/unsubscribe" | grep -q '"ok":true' && ok "push: baja" || mal "push: baja falló"

# 9) Panel sin sesión
es "GET /admin (login)" "200" "$(code "$B/admin")"

kill -0 "$PID" 2>/dev/null && ok "el proceso sigue vivo al terminar" || { mal "el proceso murió durante la prueba"; tail -5 "$T/server.log"; }
[ "$fail" -eq 0 ] || { echo "--- últimas líneas del servidor"; tail -8 "$T/server.log"; exit 1; }
echo "HUMO: TODOS LOS ASSERTS PASARON"
