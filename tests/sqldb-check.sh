#!/usr/bin/env bash
# tests/sqldb-check.sh — verifica el arranque y el guardado de la base (src/sqldb.nx)
# sobre una base de PRUEBA en un directorio temporal. Tarda ~70 s (espera un ciclo
# del hilo de guardado, que es de 60 s).
#
#   ./tests/sqldb-check.sh
#
# Compila src/sqldb.nx REAL con el nyx-db vendoreado (no arranca el servidor) y
# comprueba: (1) base nueva: se crea, se guarda sola y se relee; (2) el guardado
# periódico convive con escrituras concurrentes (toma el mutex del motor);
# (3) un archivo ILEGIBLE se aparta en vez de sobrescribirse con una base vacía.
# El programa se niega a correr si VENINFO_DB no apunta al directorio temporal.
set -euo pipefail
cd "$(dirname "$0")/.."
PROJ=$(pwd)
T=$(mktemp -d)
trap 'rm -rf "$T"' EXIT
mkdir -p "$T/src" "$T/datos"
cp "$PROJ/src/sqldb.nx" "$PROJ/src/num.nx" "$PROJ/src/md.nx" "$T/src/"
cp -r "$PROJ/packages" "$T/packages"
cp "$PROJ/nyx.lock" "$T/" 2>/dev/null || true
printf '[package]\nname = "sqldbtest"\nversion = "0.1.0"\nmain = "src/main.nx"\ndescription = "test de sqldb"\n\n[dependencies]\nnyx-db = "*"\n' > "$T/nyx.toml"
cat > "$T/src/main.nx" <<'EOF'
import "src/num"
import "src/md"
import "src/sqldb"

var parar: Array = [0]

fn escritor() -> int {
    var i: int = 0
    while parar[0] == 0 {
        sql_exec("INSERT INTO visits VALUES (" + int_to_string(i) + ", 1, '/x', 'ip', 'ua', 0)")
        i = i + 1
        sleep(2)
    }
    return 0
}

fn main() {
    let modo: String = getenv("MODO")
    let p: String = db_path()
    if p.indexOf("/datos/") < 0 or p == "/home/admin/veninfo.ndb" {
        println("ABORTO: VENINFO_DB no apunta a la base de prueba: " + p)
        exit(2)
    }
    parar = [0]
    sqldb_init()
    if modo == "escribir" {
        sql_exec("INSERT INTO meta VALUES ('marca', 'hola')")
        thread_spawn(escritor)
        thread_spawn(escritor)
        sleep(66000)          // un ciclo completo del hilo de guardado
        parar[0] = 1
        sleep(200)
        println("filas=" + int_to_string(sql_count("SELECT COUNT(*) FROM visits")))
    }
    if modo == "leer" {
        let rows: Array = sql_rows("SELECT v FROM meta WHERE k = 'marca'")
        var v: String = "(nada)"
        if rows.length() >= 2 {
            let row: Array = rows[1]
            let s: String = row[0]
            v = s
        }
        println("marca=" + v)
        println("filas=" + int_to_string(sql_count("SELECT COUNT(*) FROM visits")))
    }
    exit(0)
}
EOF
(cd "$T" && nyx build >"$T/build.log" 2>&1) || { tail -20 "$T/build.log"; echo "FALLO: no compila"; exit 1; }
BIN="$T/sqldbtest"; DB="$T/datos/prueba.ndb"; fail=0
ok()  { echo "ok $1"; }
mal() { echo "FALLO $1"; fail=1; }

# (1)+(2) base nueva, escritores concurrentes, guardado periódico
out=$(VENINFO_DB="$DB" MODO=escribir "$BIN" 2>&1) || { echo "$out" | tail -5; mal "el proceso murió escribiendo (¿carrera en el guardado?)"; }
escritas=$(echo "$out" | sed -n 's/^filas=//p')
[ -s "$DB" ] && ok "el hilo de guardado escribió la base ($(stat -c%s "$DB") bytes)" || mal "no se guardó la base"
[ "${escritas:-0}" -gt 1000 ] && ok "escrituras concurrentes durante el guardado ($escritas filas)" || mal "pocas filas escritas: ${escritas:-0}"
out=$(VENINFO_DB="$DB" MODO=leer "$BIN" 2>&1)
echo "$out" | grep -q '^marca=hola$' && ok "la base guardada se relee" || { echo "$out" | tail -3; mal "no se releyó la marca"; }
leidas=$(echo "$out" | sed -n 's/^filas=//p')
[ "${leidas:-0}" -gt 0 ] && [ "${leidas:-0}" -le "${escritas:-0}" ] && ok "filas del snapshot coherentes ($leidas de $escritas)" || mal "filas incoherentes: leidas=${leidas:-?} escritas=${escritas:-?}"

# (3) archivo ilegible: se aparta, no se pisa
printf 'esto no es una base nyx-db, pero ocupa mas de unos cuantos bytes para pasar el minimo\n' > "$DB"
antes=$(sha256sum < "$DB")
out=$(VENINFO_DB="$DB" MODO=leer "$BIN" 2>&1)
aparte=$(ls "$T/datos" | grep '^prueba.ndb.ilegible-' || true)
if [ -n "$aparte" ] && [ "$(sha256sum < "$T/datos/$aparte")" = "$antes" ]; then ok "el archivo ilegible se apartó intacto ($aparte)"; else echo "$out" | tail -3; ls -la "$T/datos"; mal "el archivo ilegible no se apartó"; fi
echo "$out" | grep -q '^marca=(nada)$' && ok "arranca con base vacía tras apartarlo" || mal "no arrancó vacío"
echo "$out" | grep -q 'ATENCION' && ok "deja aviso en el log" || mal "sin aviso en el log"

[ "$fail" -eq 0 ] || exit 1
echo "SQLDB: TODOS LOS ASSERTS PASARON"
