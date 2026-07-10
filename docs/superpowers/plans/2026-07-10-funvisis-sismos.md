# FUNVISIS como fuente de sismos (complementaria a EMSC) — Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Que `/sismos` (y la portada) muestren también los sismos locales pequeños de Venezuela que EMSC no cataloga, tomándolos del feed GeoJSON de FUNVISIS (autoridad sísmica nacional), fusionados con EMSC sin duplicados.

**Architecture:** Nuevo módulo `src/funvisis.nx` descarga y parsea `http://www.funvisis.gob.ve/maravilla.json` (HTTP plano, `std/http`) a registros normalizados. `src/sismos.nx` gana `all_quakes()`: une FUNVISIS (primaria en tierra) + EMSC (para fronterizos/offshore que FUNVISIS no lista), deduplica por tiempo+coordenadas y ordena por fecha desc. Todo el render server-side (`sismos_section`/`sismos_data_block`/`sismos_rotator_html`/`quake_by_id`) pasa a consumir esa lista unificada. **El wasm NO cambia** (lee `#s-data` ya fusionado; `iso_to_epoch` ya maneja el offset `-04:00`).

**Tech Stack:** Nyx (server-side), `std/http` (`http_get`, ruta HTTP no-TLS), GeoJSON parseado a mano (evitar `std/json` por su bug de floats y por robustez).

## Global Constraints

- **Registro unificado de sismo** (usado por FUNVISIS, EMSC y `all_quakes`): `Array` de 9 campos, en este orden exacto: `[id, iso, lat, lon, depth, mtype, mag, place, epoch]`. `id/iso/lat/lon/depth/mtype/mag/place` son `String`; `epoch` es `int` (segundos UTC). Los primeros 8 coinciden con lo que ya espera `handle_quake_detail` (`q[1]=iso … q[7]=place`).
- **FUNVISIS es SOLO HTTP** (sin TLS): usar `http_get` de `std/http` (ya importado en `main.nx:6`), NUNCA `https_get` (ése es TLS, para EMSC). Host **con `www.`** (`funvisis.gob.ve` sin www da 404).
- **Nunca romper la página**: si FUNVISIS falla/timeout/vacío, `funvisis_records()` devuelve `[]` y el sitio sigue con EMSC solo.
- **Leer String de `Array`**: SIEMPRE asignar a un `let x: String = arr[i]` tipado antes de usarlo/pasarlo a `string_to_float`/concatenar (gotcha del lenguaje, ver CLAUDE.md).
- **Scope global plano**: no redeclarar `const`/`fn`/`extern` ya existentes. Nombres nuevos con prefijo `fv_`/`funvisis_` para FUNVISIS y `emsc_`/`q_` para lo nuevo de sismos.
- **Mapeo de campos de FUNVISIS (único punto frágil)**: el JSON reutiliza una plantilla de "localizador de tiendas" con claves mal nombradas:
  `properties.phone`=magnitud · `properties.address`=lugar · `properties.city`=hora LOCAL `HH:MM` (UTC-4) · `properties.postalCode`=fecha `DD-MM-YYYY` · `properties.state`=profundidad (`"14.0 km"`) · `properties.lat`/`properties.long`=coordenadas (strings). Documentarlo en cabecera del módulo.
- **Verificación**: este repo NO tiene runner de tests unitarios server-side; el ciclo de prueba es `NYX_HOME=/home/admin/NyxLang nyx build` → guard `strings venezuelainfo-org | grep -q sismos` → `sudo systemctl restart nyx-venezuelainfo` → `curl localhost:3010/...`. Cada tarea define su aserción curl concreta.

---

### Task 1: Módulo `src/funvisis.nx` (fetch + parseo + registros normalizados)

**Files:**
- Create: `src/funvisis.nx`
- Modify: `src/main.nx` (añadir `import "src/funvisis"` junto a los demás imports ~L13; llamar `funvisis_init()` en `main()` junto a `sismos_init()` ~L531; añadir ruta TEMPORAL de debug)
- Test: verificación por `curl` a ruta temporal `/api/fv-debug` (se elimina en Task 4)

**Interfaces:**
- Produces:
  - `funvisis_init()` — resetea holders de caché (patrón de `sismos_init`).
  - `funvisis_records() -> Array` — lista de registros unificados `[id,iso,lat,lon,depth,mtype,mag,place,epoch]` (posiblemente vacía). `id` sintético `"fv-<epoch>-<latx100>-<lonx100>"`. `iso` en local con offset, p.ej. `"2026-07-10T14:29:00-04:00"`. `mtype` fijo `"ML"`.
  - `fv_days_from_civil(y:int,m:int,d:int) -> int` (**pub**, reutilizada por Task 2 para epoch de EMSC).

- [ ] **Step 1: Crear `src/funvisis.nx` con caché + parseo**

```nyx
// src/funvisis.nx — Sismos recientes de FUNVISIS (autoridad sismica nacional de
// Venezuela). Fuente COMPLEMENTARIA a EMSC: FUNVISIS cataloga los locales
// pequenos (M<~4) que la red regional de EMSC no ve.
//
// Feed: http://www.funvisis.gob.ve/maravilla.json (GeoJSON, ~6.4 KB, Content-Length).
// SOLO HTTP (sin TLS) -> http_get de std/http, NO https_get. Host CON www.
//
// El JSON reutiliza una plantilla de "localizador" con campos MAL NOMBRADOS
// (unico punto fragil; si FUNVISIS rediseña el sitio, revisar este mapeo):
//   properties.phone      = magnitud
//   properties.address    = lugar ("38 km al noroeste de San Carlos")
//   properties.city       = hora LOCAL (HH:MM, UTC-4)
//   properties.postalCode = fecha (DD-MM-YYYY)
//   properties.state      = profundidad ("14.0 km")
//   properties.lat/long   = coordenadas (strings)

import "std/http"
import "src/md"

const FV_URL: String = "http://www.funvisis.gob.ve/maravilla.json"
const FV_TTL: int = 180

var __fv_body: Array = [""]
var __fv_ts: Array = [0]

pub fn funvisis_init() {
    __fv_body = [""]
    __fv_ts = [0]
}

// Cuerpo JSON cacheado; descarga por HTTP plano si vacio/vencido. Nunca revienta:
// ante fallo (status != 200 o body vacio) conserva lo cacheado (o "").
fn funvisis_body() -> String {
    let now: int = time()
    let last: int = __fv_ts[0]
    var body: String = __fv_body[0]
    if body.length() == 0 or now - last > FV_TTL {
        let resp: Array = http_get(FV_URL)
        let status: int = resp[1]
        if status == 200 {
            let fresh: String = resp[3]
            if fresh.length() > 0 {
                __fv_body[0] = fresh
                __fv_ts[0] = now
                body = fresh
            }
        }
    }
    return body
}

// Valor string de la propiedad `key` dentro de `chunk`: busca  "key": "VALOR"
// (con el espacio tras los dos puntos, como emite FUNVISIS) y devuelve VALOR.
fn fv_str(chunk: String, key: String) -> String {
    let pat: String = "\"" + key + "\": \""
    let p: int = chunk.indexOf(pat)
    if p < 0 { return "" }
    let start: int = p + pat.length()
    let rest: String = chunk.substring(start, chunk.length())
    let q: int = rest.indexOf("\"")
    if q < 0 { return "" }
    return rest.substring(0, q)
}

// Dias desde 1970-01-01 (algoritmo de Howard Hinnant). Pub: la reutiliza sismos.nx
// para el epoch de EMSC.
pub fn fv_days_from_civil(y: int, m: int, d: int) -> int {
    var yy: int = y
    if m <= 2 { yy = yy - 1 }
    let era: int = yy / 400
    let yoe: int = yy - era * 400
    var mp: int = m - 3
    if m <= 2 { mp = m + 9 }
    let doy: int = (153 * mp + 2) / 5 + d - 1
    let doe: int = yoe * 365 + yoe / 4 - yoe / 100 + doy
    return era * 146097 + doe - 719468
}

// De fecha "DD-MM-YYYY" y hora "HH:MM" LOCALES (UTC-4) a [iso_con_offset, epoch_utc].
// El ISO lleva -04:00 para que el wasm (iso_to_epoch) lo normalice como los Z de EMSC.
fn fv_iso_epoch(fecha: String, hora: String) -> Array {
    let dp: Array = fecha.split("-")
    if dp.length() < 3 {
        let e: Array = ["", 0]
        return e
    }
    let dd: String = dp[0]
    let mo: String = dp[1]
    let yy: String = dp[2]
    var hh: String = "00"
    var mi: String = "00"
    let tp: Array = hora.split(":")
    if tp.length() >= 2 {
        let h0: String = tp[0]
        let m0: String = tp[1]
        hh = h0
        mi = m0
    }
    let iso: String = yy + "-" + mo + "-" + dd + "T" + hh + ":" + mi + ":00-04:00"
    let ep: int = fv_days_from_civil(string_to_int(yy), string_to_int(mo), string_to_int(dd)) * 86400 + string_to_int(hh) * 3600 + string_to_int(mi) * 60 + 14400
    let r: Array = [iso, ep]
    return r
}

// Lista normalizada de sismos FUNVISIS: [id,iso,lat,lon,depth,mtype,mag,place,epoch].
pub fn funvisis_records() -> Array {
    let body: String = funvisis_body()
    let out: Array = []
    if body.length() == 0 {
        return out
    }
    let chunks: Array = body.split("{\"type\": \"Feature\"")
    var i: int = 1
    while i < chunks.length() {
        let chunk: String = chunks[i]
        let mag: String = fv_str(chunk, "phone")
        let place: String = fv_str(chunk, "address")
        let hora: String = fv_str(chunk, "city")
        let fecha: String = fv_str(chunk, "postalCode")
        var depth: String = fv_str(chunk, "state")
        let lat: String = fv_str(chunk, "lat")
        let lon: String = fv_str(chunk, "long")
        if mag.length() > 0 and lat.length() > 0 and lon.length() > 0 {
            let sp: int = depth.indexOf(" ")
            if sp > 0 {
                depth = depth.substring(0, sp)
            }
            let ie: Array = fv_iso_epoch(fecha, hora)
            let iso: String = ie[0]
            let epoch: int = ie[1]
            let latx: int = float_to_int(string_to_float(lat) * 100.0)
            let lonx: int = float_to_int(string_to_float(lon) * 100.0)
            let id: String = "fv-" + int_to_string(epoch) + "-" + int_to_string(latx) + "-" + int_to_string(lonx)
            let rec: Array = [id, iso, lat, lon, depth, "ML", mag, place, epoch]
            out.push(rec)
        }
        i = i + 1
    }
    return out
}
```

- [ ] **Step 2: Enganchar `import`, `funvisis_init()` y ruta temporal de debug en `src/main.nx`**

Añadir el import junto a los demás (tras `import "src/news"`, ~L13):
```nyx
import "src/funvisis"
```
En `main()`, junto a `sismos_init()` (~L531):
```nyx
    funvisis_init()
```
Añadir un handler temporal y su ruta (se ELIMINAN en Task 4). Handler cerca de `handle_sismos`:
```nyx
// TEMPORAL (Task 1/2): vuelca los registros para verificar por curl. Quitar en Task 4.
fn handle_fv_debug(req: Request) -> Response {
    let recs: Array = funvisis_records()
    var sb: StringBuilder = StringBuilder.new()
    sb.append("count=")
    sb.append(int_to_string(recs.length()))
    sb.append("\n")
    var i: int = 0
    while i < recs.length() {
        let r: Array = recs[i]
        let id: String = r[0]
        let iso: String = r[1]
        let mag: String = r[6]
        let place: String = r[7]
        sb.append(id)
        sb.append("\tM")
        sb.append(mag)
        sb.append("\t")
        sb.append(iso)
        sb.append("\t")
        sb.append(place)
        sb.append("\n")
        i = i + 1
    }
    return html_nocache(200, sb.to_string())
}
```
Registrar la ruta donde se registran las demás (junto a `app_get(app, "/sismos", ...)`):
```nyx
    app_get(app, "/api/fv-debug", handle_fv_debug)
```

- [ ] **Step 3: Compilar y verificar guard**

Run:
```bash
cd /home/admin/venezuelainfo.org
NYX_HOME=/home/admin/NyxLang nyx build && strings venezuelainfo-org | grep -q sismos && echo GUARD_OK
```
Expected: `✓ Built: venezuelainfo-org` … `GUARD_OK`

- [ ] **Step 4: Reiniciar y verificar el feed FUNVISIS parseado**

Run:
```bash
sudo systemctl restart nyx-venezuelainfo && sleep 2
curl -s localhost:3010/api/fv-debug | head -25
```
Expected: `count=20` (aprox.), y filas tipo
`fv-<epoch>-...  M3.9  2026-07-10T10:53:00-04:00  10 km al noreste de Naiguata`
(debe aparecer el M3.9 de Naiguatá; magnitudes M1.8–3.9; ISO con `-04:00`).

- [ ] **Step 5: Commit**

```bash
git add src/funvisis.nx src/main.nx
git commit -m "Sismos: módulo FUNVISIS (feed maravilla.json) + ruta debug temporal"
```

---

### Task 2: `all_quakes()` en `src/sismos.nx` (fusión EMSC+FUNVISIS, dedup, orden)

**Files:**
- Modify: `src/sismos.nx` (añadir `import "src/funvisis"`; añadir `emsc_iso_epoch`, `emsc_records`, `dup_in_funvisis`, `sort_recs_desc`, `all_quakes`)
- Modify: `src/main.nx` (ampliar `handle_fv_debug` para volcar también `all_quakes()`)
- Test: `curl localhost:3010/api/fv-debug`

**Interfaces:**
- Consumes: `funvisis_records()`, `fv_days_from_civil()` (Task 1); `emsc_body()`, `quake_in_region()` (ya en sismos.nx).
- Produces:
  - `all_quakes() -> Array` — registros unificados `[id,iso,lat,lon,depth,mtype,mag,place,epoch]`, FUNVISIS + EMSC-no-duplicado, orden por `epoch` desc.

- [ ] **Step 1: Añadir import y helpers de registro/epoch/dedup/orden en `src/sismos.nx`**

Añadir el import bajo `import "src/md"`:
```nyx
import "src/funvisis"
```
Añadir (p.ej. tras `quake_in_region`):
```nyx
// Epoch UTC de un ISO EMSC "2026-07-07T08:41:38.68Z" (siempre Z/UTC). 0 si corto.
fn emsc_iso_epoch(iso: String) -> int {
    if iso.length() < 16 {
        return 0
    }
    let y: int = string_to_int(iso.substring(0, 4))
    let mo: int = string_to_int(iso.substring(5, 7))
    let d: int = string_to_int(iso.substring(8, 10))
    let h: int = string_to_int(iso.substring(11, 13))
    let mi: int = string_to_int(iso.substring(14, 16))
    return fv_days_from_civil(y, mo, d) * 86400 + h * 3600 + mi * 60
}

// Registros EMSC normalizados (aplica quake_in_region + epoch). Mismo shape que FUNVISIS.
fn emsc_records() -> Array {
    let body: String = emsc_body()
    let out: Array = []
    if body.length() == 0 {
        return out
    }
    let lines: Array = body.split("\n")
    var i: int = 0
    while i < lines.length() {
        let line: String = lines[i]
        if line.length() > 5 and !line.startsWith("#") and !line.startsWith("<") {
            let parts: Array = line.split("|")
            if parts.length() >= 13 {
                let place: String = md_trim(parts[12])
                let lat: String = md_trim(parts[2])
                let lon: String = md_trim(parts[3])
                if quake_in_region(lat, lon, place) {
                    let eid: String = md_trim(parts[0])
                    let t: String = md_trim(parts[1])
                    let depth: String = md_trim(parts[4])
                    let mtype: String = md_trim(parts[9])
                    let mag: String = md_trim(parts[10])
                    let ep: int = emsc_iso_epoch(t)
                    let rec: Array = [eid, t, lat, lon, depth, mtype, mag, place, ep]
                    out.push(rec)
                }
            }
        }
        i = i + 1
    }
    return out
}

// ¿Hay en fvrecs un evento que coincida (|Δt|<=90s y |Δlat|,|Δlon|<=0.3)?
fn dup_in_funvisis(fvrecs: Array, ep: int, lat: float, lon: float) -> bool {
    var j: int = 0
    while j < fvrecs.length() {
        let r: Array = fvrecs[j]
        let fep: int = r[8]
        var dt: int = ep - fep
        if dt < 0 { dt = -dt }
        if dt <= 90 {
            let flat: String = r[2]
            let flon: String = r[3]
            var dla: float = string_to_float(flat) - lat
            var dlo: float = string_to_float(flon) - lon
            if dla < 0.0 { dla = -dla }
            if dlo < 0.0 { dlo = -dlo }
            if dla <= 0.3 and dlo <= 0.3 {
                return true
            }
        }
        j = j + 1
    }
    return false
}

// Selection sort in-place por epoch (campo 8) descendente. N pequeño (<=~220).
fn sort_recs_desc(recs: Array) {
    var i: int = 0
    let n: int = recs.length()
    while i < n {
        var best: int = i
        var j: int = i + 1
        while j < n {
            let rj: Array = recs[j]
            let rb: Array = recs[best]
            let ej: int = rj[8]
            let eb: int = rb[8]
            if ej > eb {
                best = j
            }
            j = j + 1
        }
        if best != i {
            let tmp: Array = recs[i]
            recs[i] = recs[best]
            recs[best] = tmp
        }
        i = i + 1
    }
}

// Lista unificada: FUNVISIS (primaria en tierra) + EMSC no-duplicado (fronterizos/
// offshore que FUNVISIS no lista), orden por fecha desc.
pub fn all_quakes() -> Array {
    let fv: Array = funvisis_records()
    let em: Array = emsc_records()
    let merged: Array = []
    var a: int = 0
    while a < fv.length() {
        let fr: Array = fv[a]
        merged.push(fr)
        a = a + 1
    }
    var k: int = 0
    while k < em.length() {
        let r: Array = em[k]
        let ep: int = r[8]
        let la: String = r[2]
        let lo: String = r[3]
        let latf: float = string_to_float(la)
        let lonf: float = string_to_float(lo)
        if !dup_in_funvisis(fv, ep, latf, lonf) {
            merged.push(r)
        }
        k = k + 1
    }
    sort_recs_desc(merged)
    return merged
}
```

- [ ] **Step 2: Ampliar `handle_fv_debug` en `src/main.nx` para volcar `all_quakes()`**

Al final del handler (antes del `return`), añadir:
```nyx
    let allq: Array = all_quakes()
    sb.append("ALL count=")
    sb.append(int_to_string(allq.length()))
    sb.append("\n")
    var m: int = 0
    while m < allq.length() {
        let ar: Array = allq[m]
        let aid: String = ar[0]
        let amag: String = ar[6]
        let aiso: String = ar[1]
        let aplace: String = ar[7]
        sb.append(aid)
        sb.append("\tM")
        sb.append(amag)
        sb.append("\t")
        sb.append(aiso)
        sb.append("\t")
        sb.append(aplace)
        sb.append("\n")
        m = m + 1
    }
```

- [ ] **Step 3: Compilar + guard + reiniciar**

Run:
```bash
cd /home/admin/venezuelainfo.org
NYX_HOME=/home/admin/NyxLang nyx build && strings venezuelainfo-org | grep -q sismos && echo GUARD_OK
sudo systemctl restart nyx-venezuelainfo && sleep 2
```
Expected: build OK + `GUARD_OK`.

- [ ] **Step 4: Verificar fusión, orden y dedup**

Run:
```bash
curl -s localhost:3010/api/fv-debug | sed -n '/ALL count=/,$p' | head -30
```
Expected: `ALL count=` mayor que solo-EMSC; primeras filas ordenadas por fecha desc; aparecen tanto ids `fv-*` (FUNVISIS) como ids EMSC (`2026...`) para fronterizos (NORTHERN COLOMBIA/TRINIDAD); un mismo evento M≥4 no aparece dos veces.
Chequeo de dedup (no debe haber dos filas con la misma fecha/hora y magnitud ~igual en la costa central):
```bash
curl -s localhost:3010/api/fv-debug | sed -n '/ALL count=/,$p' | awk -F'\t' '{print $3, $2}' | sort | uniq -d
```
Expected: sin líneas duplicadas evidentes (o solo eventos genuinamente distintos).

- [ ] **Step 5: Commit**

```bash
git add src/sismos.nx src/main.nx
git commit -m "Sismos: all_quakes() une FUNVISIS (primaria) + EMSC deduplicado"
```

---

### Task 3: Conectar el render a `all_quakes()` (tabla, `#s-data`, rotador, detalle)

**Files:**
- Modify: `src/sismos.nx` (`render_quakes` → itera registros; `sismos_section`, `sismos_data_block`, `sismos_rotator_html`, `quake_by_id` → usan `all_quakes()`)
- Test: `curl localhost:3010/sismos`, `curl localhost:3010/sismos/<fv-id>`

**Interfaces:**
- Consumes: `all_quakes()` (Task 2).
- Produces: (sin API nueva; cambia el origen de datos de las funciones de render existentes).

- [ ] **Step 1: Reescribir `render_quakes` para iterar registros unificados**

Reemplazar la firma/cuerpo de `render_quakes(body: String)` por una versión que recibe la lista (mantiene EXACTAMENTE el mismo markup de fila — sigue duplicado a propósito con `s_row_html` del wasm):
```nyx
// Parser puro: registros unificados -> tabla HTML. "" si no hay nada.
// OJO: el markup de fila lo REPLICA s_row_html en wasm/veninfo.nx — cambiarlos JUNTOS.
pub fn render_quakes(recs: Array) -> String {
    if recs.length() == 0 {
        return "<p>No hay sismos recientes registrados en la zona.</p>"
    }
    var sb: StringBuilder = StringBuilder.new()
    sb.append("<table class=\"quakes\">\n")
    sb.append("<thead><tr><th>Fecha</th><th>Magnitud</th><th>Profundidad</th><th>Lugar</th><th>Distancia</th></tr></thead>\n")
    sb.append("<tbody id=\"qtbody\">\n")
    var i: int = 0
    while i < recs.length() {
        let r: Array = recs[i]
        let eid: String = r[0]
        let t: String = r[1]
        let lat: String = r[2]
        let lon: String = r[3]
        let depth: String = r[4]
        let mtype: String = r[5]
        let mag: String = r[6]
        let place: String = r[7]
        let ft: String = format_time(t)
        let sp: int = ft.indexOf(" ")
        var fdia: String = ft
        var fhora: String = ""
        if sp >= 0 {
            fdia = ft.substring(0, sp)
            fhora = ft.substring(sp + 1, ft.length())
        }
        sb.append("<tr data-id=\"")
        sb.append(attr_escape(eid))
        sb.append("\" data-lat=\"")
        sb.append(attr_escape(lat))
        sb.append("\" data-lon=\"")
        sb.append(attr_escape(lon))
        sb.append("\" data-mag=\"")
        sb.append(attr_escape(mag))
        sb.append("\" data-type=\"")
        sb.append(attr_escape(mtype))
        sb.append("\" data-depth=\"")
        sb.append(attr_escape(depth))
        sb.append("\" data-time=\"")
        sb.append(attr_escape(ft))
        sb.append("\" data-iso=\"")
        sb.append(attr_escape(t))
        sb.append("\" data-place=\"")
        sb.append(attr_escape(place))
        sb.append("\"><td class=\"fh\"><span class=\"f-dia\">")
        sb.append(html_escape(fdia))
        sb.append("</span><span class=\"f-hora\">")
        sb.append(html_escape(fhora))
        sb.append("</span></td><td class=\"mag\">")
        sb.append(html_escape(mag))
        sb.append("</td><td>")
        sb.append(html_escape(fmt_depth(depth)))
        sb.append("</td><td>")
        sb.append(html_escape(place))
        sb.append("</td><td class=\"dist\">&mdash;</td></tr>\n")
        i = i + 1
    }
    sb.append("</tbody>\n</table>\n")
    return sb.to_string()
}
```

- [ ] **Step 2: `sismos_section` usa `all_quakes()`**

```nyx
pub fn sismos_section() -> String {
    let recs: Array = all_quakes()
    if recs.length() == 0 {
        return "<p class=\"error\">No se pudieron cargar los sismos en este momento. Intenta de nuevo en unos minutos.</p>"
    }
    return render_quakes(recs)
}
```

- [ ] **Step 3: `sismos_data_block` (bloque `#s-data`) itera registros**

```nyx
pub fn sismos_data_block() -> String {
    let recs: Array = all_quakes()
    if recs.length() == 0 {
        return ""
    }
    var sb: StringBuilder = StringBuilder.new()
    sb.append("<textarea id=\"s-data\" hidden>")
    var i: int = 0
    while i < recs.length() {
        let r: Array = recs[i]
        let eid: String = r[0]
        let t: String = r[1]
        let lat: String = r[2]
        let lon: String = r[3]
        let depth: String = r[4]
        let mtype: String = r[5]
        let mag: String = r[6]
        let place: String = r[7]
        sb.append(html_escape(eid + "\t" + t + "\t" + lat + "\t" + lon + "\t" + depth + "\t" + mtype + "\t" + mag + "\t" + place))
        sb.append("\n")
        i = i + 1
    }
    sb.append("</textarea>\n")
    return sb.to_string()
}
```

- [ ] **Step 4: `sismos_rotator_html` itera registros**

```nyx
pub fn sismos_rotator_html(maxn: int) -> String {
    let recs: Array = all_quakes()
    var sb: StringBuilder = StringBuilder.new()
    var i: int = 0
    var cnt: int = 0
    while i < recs.length() and cnt < maxn {
        let r: Array = recs[i]
        let mag: String = r[6]
        let place: String = r[7]
        let t: String = r[1]
        sb.append("<div class=\"rot-slide\"><span class=\"news-src mag-badge\">M ")
        sb.append(html_escape(mag))
        sb.append("</span><span class=\"rot-title\">")
        sb.append(html_escape(place))
        sb.append("</span><time class=\"news-date\" data-ts=\"")
        sb.append(attr_escape(t))
        sb.append("\"></time></div>\n")
        cnt = cnt + 1
        i = i + 1
    }
    return sb.to_string()
}
```

- [ ] **Step 5: `quake_by_id` busca en `all_quakes()`**

```nyx
// Busca un evento por id (EMSC o FUNVISIS) en la lista unificada.
// Devuelve [id, iso, lat, lon, depth, mtype, mag, place] o [] si no existe.
pub fn quake_by_id(id: String) -> Array {
    let recs: Array = all_quakes()
    var i: int = 0
    while i < recs.length() {
        let r: Array = recs[i]
        let eid: String = r[0]
        if eid == id {
            let out: Array = [r[0], r[1], r[2], r[3], r[4], r[5], r[6], r[7]]
            return out
        }
        i = i + 1
    }
    let e: Array = []
    return e
}
```
Nota: `sismos_warm()` sigue llamando a `emsc_body()` (calienta EMSC); añadir también un pre-fetch de FUNVISIS opcional NO es necesario (el refresher que se creó en la fase previa ya golpea `sismos_warm`; `all_quakes` calienta ambos en el primer hit). Dejar `sismos_warm` como está.

- [ ] **Step 6: Compilar + guard + reiniciar**

Run:
```bash
cd /home/admin/venezuelainfo.org
NYX_HOME=/home/admin/NyxLang nyx build && strings venezuelainfo-org | grep -q sismos && echo GUARD_OK
sudo systemctl restart nyx-venezuelainfo && sleep 2
```
Expected: build OK + `GUARD_OK`.

- [ ] **Step 7: Verificar `/sismos`, `#s-data` y página de detalle FUNVISIS**

Run:
```bash
# Filas en la tabla server-side (debe incluir eventos FUNVISIS pequeños):
curl -s localhost:3010/sismos | grep -c 'tr data-id'
# El M3.9 Naiguatá debe estar (por lugar):
curl -s localhost:3010/sismos | grep -o 'data-place="[^"]*Naiguat[^"]*"' | head
# Coger un id FUNVISIS del s-data y abrir su detalle:
FVID=$(curl -s localhost:3010/sismos | grep -o 'data-id="fv-[^"]*"' | head -1 | sed 's/data-id="//;s/"//')
echo "fv id = $FVID"
curl -s -o /dev/null -w "/sismos/$FVID -> %{http_code}\n" "localhost:3010/sismos/$FVID"
curl -s "localhost:3010/sismos/$FVID" | grep -o '<h1>[^<]*</h1>' | head
# Salud general:
for p in / /sismos /finanzas /api/health; do curl -s -o /dev/null -w "$p %{http_code}\n" localhost:3010$p; done
```
Expected: conteo de filas ≥ el de solo-EMSC (más los locales); aparece un `data-place` con "Naiguata"; el id `fv-*` existe y `/sismos/<fv-id>` responde **200** con un `<h1>Sismo M…`; todas las rutas 200.

- [ ] **Step 8: Commit**

```bash
git add src/sismos.nx
git commit -m "Sismos: render (tabla, #s-data, rotador, detalle) desde all_quakes()"
```

---

### Task 4: Copia visible, docs y limpieza del debug

**Files:**
- Modify: `src/main.nx` (texto de `handle_sismos`; ELIMINAR `handle_fv_debug` y su ruta)
- Modify: `CLAUDE.md` (sección Sismos + mapa de archivos + rutas)

**Interfaces:** ninguna nueva.

- [ ] **Step 1: Actualizar la copia de `/sismos` para citar ambas fuentes**

En `handle_sismos` (`src/main.nx`), reemplazar el `<p class="lede">` y el `<p class="hint">` por:
```nyx
    sb.append("<p class=\"lede\">Sismos recientes en Venezuela y su zona fronteriza (magnitud &ge; 2). Fuentes: <a href=\"http://www.funvisis.gob.ve\">FUNVISIS</a> (red nacional) y <a href=\"https://www.emsc-csem.org\">EMSC</a>.</p>\n")
    sb.append("<p class=\"hint\">Nota: combinamos FUNVISIS (autoridad sismica nacional, cubre los locales pequenos) con EMSC (aporta los eventos fronterizos y costa afuera: Colombia, Golfo de Paria, Trinidad, mar Caribe). Las horas se muestran en tu hora local.</p>\n")
```

- [ ] **Step 2: Eliminar el handler/ruta de debug y corregir copia del 404**

Borrar de `src/main.nx` la función `handle_fv_debug` completa y la línea `app_get(app, "/api/fv-debug", handle_fv_debug)`.
En `handle_quake_detail`, el mensaje de "no encontrado" dice "ultimos 40" (desactualizado). Cambiar esa frase:
```nyx
        let nf: String = "<section class=\"sismos\"><p><a href=\"/sismos\">&larr; Volver a la lista</a></p><h1>Sismo no encontrado</h1><p>Este evento puede haber salido del listado reciente.</p></section>"
```

- [ ] **Step 3: Actualizar `CLAUDE.md`**

En la sección `## Sismos`: indicar que la fuente ahora es **FUNVISIS (primaria en tierra) + EMSC (fronterizos/offshore)** vía `all_quakes()` en `src/sismos.nx` + módulo `src/funvisis.nx` (feed `maravilla.json`, HTTP plano, campos mal nombrados, horas locales UTC-4, dedup por tiempo+coords). En el **mapa de archivos** añadir la línea de `src/funvisis.nx`. En `## Rutas` no hay cambios (la ruta debug se eliminó). Mantener el aviso de markup de fila duplicado (`render_quakes` ↔ `s_row_html`).

- [ ] **Step 4: Compilar + guard + reiniciar + verificación final**

Run:
```bash
cd /home/admin/venezuelainfo.org
NYX_HOME=/home/admin/NyxLang nyx build && strings venezuelainfo-org | grep -q sismos && echo GUARD_OK
sudo systemctl restart nyx-venezuelainfo && sleep 2
curl -s -o /dev/null -w "/api/fv-debug (debe ser 404) -> %{http_code}\n" localhost:3010/api/fv-debug
for p in / /sismos /finanzas /api/health; do curl -s -o /dev/null -w "$p %{http_code}\n" localhost:3010$p; done
curl -s localhost:3010/sismos | grep -o 'FUNVISIS' | head -1
```
Expected: `/api/fv-debug -> 404`; resto 200; aparece "FUNVISIS" en la página.

- [ ] **Step 5: Commit**

```bash
git add src/main.nx CLAUDE.md
git commit -m "Sismos: copia de /sismos cita FUNVISIS+EMSC, docs y limpieza de debug"
```

---

## Verificación end-to-end (tras todas las tareas)

```bash
cd /home/admin/venezuelainfo.org
NYX_HOME=/home/admin/NyxLang nyx build && strings venezuelainfo-org | grep -q sismos && sudo systemctl restart nyx-venezuelainfo && sleep 2
# 1) Todas las rutas 200:
for p in / /clima /sismos /finanzas /api/health; do curl -s -o /dev/null -w "$p %{http_code}\n" localhost:3010$p; done
# 2) Aparecen los locales de FUNVISIS que EMSC no tiene (p.ej. Naiguatá M3.9, San Carlos):
curl -s localhost:3010/sismos | grep -o 'data-place="[^"]*"' | grep -iE 'naiguat|san carlos|maracay' | head
# 3) Siguen los fronterizos de EMSC:
curl -s localhost:3010/sismos | grep -o 'data-place="[^"]*"' | grep -iE 'colombia|trinidad|caribbean' | head
# 4) Detalle de un evento FUNVISIS responde 200:
FVID=$(curl -s localhost:3010/sismos | grep -o 'data-id="fv-[^"]*"' | head -1 | sed 's/data-id="//;s/"//')
curl -s -o /dev/null -w "/sismos/$FVID -> %{http_code}\n" "localhost:3010/sismos/$FVID"
```
Éxito = rutas 200, presencia simultánea de eventos FUNVISIS (locales) y EMSC (fronterizos), y detalle de un `fv-*` accesible.

## Notas de riesgo / seguimiento
- **`http_read_response` no desfragmenta `Transfer-Encoding: chunked`**. Hoy FUNVISIS manda `Content-Length` (verificado). Si algún día pasa a chunked, `funvisis_body()` recibiría basura; el `fv_str` fallaría y `funvisis_records()` daría `[]` (degradación segura, no crash). Vigilar.
- **Campos mal nombrados**: si FUNVISIS rediseña `maravilla.json`, el mapeo de `fv_str(...)` es el único punto a tocar.
- **Sin caché compartida entre reinicios**: como EMSC, la caché de FUNVISIS vive en RAM (TTL 3 min). Aceptable.
- **wasm intacto**: no se toca `veninfo.nx` ni se sube `veninfo-vN` (no cambió CSS/JS/wasm).
