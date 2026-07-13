# venezuelainfo.org — Guía para Claude Code

Portal de noticias e información sobre Venezuela, **escrito en Nyx** (dogfooding).
Sitio full-stack desplegado en https://venezuelainfo.org. Proyecto **independiente**
fuera del monorepo del lenguaje (igual patrón que `nyx-kv-stack`).

> Complementa al `README.md` (guía pública). Este archivo es el contexto interno:
> cómo está hecho, cómo NO romperlo, y las trampas ya descubiertas.

## Qué es / cómo corre

- Compila a un binario nativo `venezuelainfo-org` que es el **servidor web**
  (consume la librería `nyx-serve`).
- **Servicio**: systemd `nyx-venezuelainfo.service`, escucha en **:3010**.
- **Frente público**: detrás del gateway HTTPS (`NyxLang/services/gateway`), vhost
  `venezuelainfo.org` → `127.0.0.1:3010` (ver `proxy.toml` del gateway). Cert
  Let's Encrypt (renovación con hooks que paran/arrancan el gateway).

## Build / deploy

```bash
cd /home/admin/venezuelainfo.org
NYX_HOME=/home/admin/NyxLang nyx build      # produce ./venezuelainfo-org
sudo systemctl restart nyx-venezuelainfo    # recarga el servicio (NO el gateway)

# Front wasm (paso SEPARADO, solo si se tocó wasm/veninfo.nx):
deploy/build-wasm.sh                        # make wasm en el monorepo + copia a static/assets/
# ...y SUBIR JUNTOS el ?v=N de nyx-loader.js + veninfo.wasm (en el propio
# nyx-loader.js y en src/main.nx) + veninfo-vN en static/sw.js + rebuild+restart.
# Test headless del módulo:
node /home/admin/NyxLang/examples/browser/run-node.mjs static/assets/veninfo.wasm wasm/tests/imports.mjs
```

- **`NYX_HOME` apunta al monorepo** `NyxLang/` a propósito: ahí están el
  compilador, runtime y `std/` en su versión de desarrollo. No es saltarse el PM.
- Dependencias del proyecto (`nyx-serve`) van por el PM (`nyx.toml`) y están
  **vendoreadas** en `packages/`.
- Reiniciar SOLO `nyx-venezuelainfo` no causa downtime de los otros sitios.
  Tras el restart, el **primer hit por el dominio puede dar un 502 transitorio**
  (conexión idle del proxy); recargar resuelve.

## Arquitectura (importante)

- **Todo el servidor es Nyx** (`src/*.nx`): HTTP, rutas, render de HTML
  server-side, lectura de Markdown, cliente HTTPS a APIs externas, parseo, caché.
- **El front es Nyx→WASM con una PASARELA JS mínima** (fases A–E, 2026-07-02):
  TODO el cómputo, los fetch a APIs, el parseo y el render dinámico viven en
  **`wasm/veninfo.nx`** → `static/assets/veninfo.wasm` (~150 KB gzip,
  `deploy/build-wasm.sh`), cargado por **`static/assets/nyx-loader.js`** (ESM,
  `window.nyxReady`) sobre el shim `nyx-wasi-shim.js` (copia del monorepo).
  `main()` del wasm es un ROUTER: lee `<input hidden id="pg">` que emite cada
  handler y dispara los boots de esa página:
  - `index` → `fx_boot(0)` + `wcard_boot()` (tarjeta clima) + `rot_boot()` (rotador)
  - `finanzas` → `fx_boot(1)` (con cripto) + `news_boot()` (expand lista BVC)
  - `clima` → `clima_boot()` (página completa + buscador de ciudades + geo)
  - `sismos` → `sismos_boot()` (lee `<textarea id="s-data">` del server, deriva
    epoch/hora local, filtros/orden/paginación/selección/destacado, geo cada 2 min)
  - `noticias` → `news_boot()` (expand con `js_delegate` + `data-idx` + `#n-sel`)
  La **pasarela** (imports del loader, patrón callback-por-NOMBRE-de-export como
  `dom_on`): `js_fetch(url,method,body,handler)` (handler recibe status+body),
  `js_interval/js_timeout`, `js_geo(ok,err)`, `js_delegate` (delegación de click
  → hidden + handler; ignora clicks en `<a>`), `js_on_enter`, `js_media`,
  `js_count`, `js_tz_offset_min`, `js_ls_get/set`, `js_set_attr/js_remove_attr/
  js_toggle_class/js_set_value`. Formalizarla como `std/browser` es la tarea 6
  de `NyxLang/HANDOFF-veninfo-front.md`.
- **JS restante (solo lo bloqueado por el target)**: `nyx-loader.js` (pasarela),
  `home.js` (SOLO drag&drop/orden de tarjetas — necesita objeto Event/closures),
  `quake.js` (Leaflet), `chat.js` (WebSocket/timers; migrar cuando haya GC en
  wasm — fase F planificada), `sw.js`. Sin respaldo JS duplicado: si el wasm no
  carga, las secciones muestran aviso.
- Librerías client-side por CDN: **Leaflet** (mapas). APIs consumidas por el
  wasm vía pasarela: **Open-Meteo** (clima/geocoding/AQI), DolarAPI, CriptoYa,
  er-api, CoinGecko, bigdatacloud (reverse geocode), **Geolocation**, **localStorage**.

### Mapa de archivos
```
src/main.nx      Entry + rutas + handlers (HTML server-side; el JS vive en static/assets/*.js
                 y se referencia con <script src="/assets/X.js?v=N" defer>).
src/layout.nx    Shell HTML (head, header, footer). page() y page_fixed() (zoom bloqueado),
                 metas PWA, registro del service worker.
src/articles.nx  Portada + render de artículos (server-side desde content/).
src/md.nx        Renderizador Markdown→HTML propio + html_escape.
src/sismos.nx    Cliente EMSC (https_get), parser FDSN text, all_quakes() (fusión con
                 FUNVISIS + dedup por tiempo+coords), caché, tabla HTML con data-*.
src/funvisis.nx  Cliente FUNVISIS (http_get, HTTP plano, feed maravilla.json), mapeo de
                 campos mal nombrados a registros, caché en RAM.
src/kv.nx        Cliente mínimo RESP2+TLS para nyx-kv (tls_* builtins). Conexión corta por request.
                 Helpers kv_get/set/setex/del/exists/incr/expire/rpush/ltrim/lrange sobre kv_cmd.
                 nyx-kv guarda: admin (pass/sesiones), chat (salas/mensajes/rate-limit), baquiano.
src/sqldb.nx     Adaptador sobre nyx-db (SQL en Nyx, EMBEBIDO). ÚNICO módulo que importa el motor
                 (import "nyx-db/src/*"); expone sql_exec/sql_rows/sql_count/sql_esc/db_day y
                 sqldb_init() (db_load del .ndb + CREATE TABLE + hilo saver + shutdown handler).
                 Guarda: visitas (analítica) y rates (histórico de tasas). Ver gotchas de nyx-db.
src/rates.nx     Tasas en nyx-db: rates_snapshot() (refresher) toma Dólar/Euro BCV de src/bcv.nx
                 (BCV DIRECTO) y Binance de CriptoYa; guarda en tabla rates POR FECHA VALOR (day =
                 ordinal de vigencia) con respaldo a DolarAPI si BCV falla. rates_api_json() sirve
                 GET /api/rates (hoy + próxima con fecha valor + bin) que consume el front.
                 rate_chart() = mini-gráficos 14 días de /finanzas.
src/bcv.nx       Lectura DIRECTA de bcv.org.ve (raspa HTML: id=dolar/euro -> strong-tb; coma->punto;
                 fecha valor del atributo content ISO -> ordinal días). BCV publica ~4pm la tasa del
                 día hábil SIGUIENTE. Funciona pese al cert TLS roto porque el runtime NO valida
                 certs (SSL_VERIFY_NONE). Frágil (scraping) -> rates.nx cae a DolarAPI si da vacío.
src/chat.nx      Chat colectivo CON SALAS: valida/sanea/filtra, guarda/lee por sala en nyx-kv.
                 Parseo de body a mano. Solo el admin crea/borra salas. form_field es pub.
                 chat_ws_handler = handler del upgrade WS (valida sala, delega en src/ws).
src/ws.nx        WebSocket del chat (RFC 6455 via std/websocket): registro fd<->sala bajo
                 mutex, un hilo lector por conexión, ws_broadcast() al publicar. Solo bajada;
                 el envío sigue por POST. ws_init() se llama desde main().
src/baquiano.nx  "Baquiano": guía de sitios por zona (estado/región). Contenido en nyx-kv,
                 editable desde el panel admin. render_baquiano_index/zone() + baquiano_card().
src/admin.nx     Panel admin (/admin): login único de dueño, sesión por cookie + CSRF. CRUD de
                 baquiano y salas + moderación. Handlers propios de Response (no usa los de main).
                 También: visit_middleware (INSERT por hit en nyx-db; cuenta por LISTA
                 BLANCA de páginas reales vía visit_counts → excluye sondeos de bots
                 /wp-*, *.php, /.env…) + /admin/visitas (contadores/serie/registro/"Lo
                 más visto" por SQL sobre la tabla visits).
wasm/veninfo.nx  Root del front Nyx→WASM: cabecera + imports + ambos bloques de externs
                 (pasarela) + main() router por #pg. PARTIDO en módulos (make wasm ya resuelve
                 imports project-relative vía NYX_PROJECT_DIR=$PROJ/wasm; scope global plano →
                 símbolos visibles entre archivos, NO redeclarar). Módulos hermanos en wasm/:
                 common.nx (helpers puros / fechas iso_to_epoch,civil_parts / scanners JSON
                 jnum/jstr/jseg — std/json ya NO trunca floats pero su adopción está diferida) /
                 finanzas.nx (calculadora + fx_*) / clima.nx / sismos.nx / noticias.nx
                 (rotador+expand) / chat.nx (Fase F: cliente de chat en Nyx, ESCRITO EN FRÍO
                 —compila pero NO enchufado: /chat sigue con chat.js; ver go-live abajo).
                 build-wasm.sh sigue pasando solo FILE=wasm/veninfo.nx.
wasm/tests/imports.mjs  Test headless (mocks DOM/localStorage/pasarela + fixtures reales):
                 node NyxLang/examples/browser/run-node.mjs static/assets/veninfo.wasm wasm/tests/imports.mjs
content/         index.txt (slugs) + articles/*.md (front-matter + cuerpo).
static/          assets/style.css, sw.js, manifest.webmanifest, icon.svg/png,
                 assets/nyx-loader.js (loader ESM + pasarela), assets/nyx-wasi-shim.js (COPIA
                 del monorepo; la refresca build-wasm.sh), assets/veninfo.wasm (generado),
                 assets/home.js (drag&drop), assets/quake.js (Leaflet), assets/chat.js (WS).
deploy/          nyx-venezuelainfo.service + admin.conf.example (drop-in del secreto admin)
                 + build-wasm.sh (compila wasm/veninfo.nx y copia artefactos).
packages/        nyx-serve vendoreado + nyx-db vendoreado (9 módulos del modo embebido:
                 sql_lexer/sql_parser/btree/wal/store/planner/executor/persist/query).
```

## Reglas críticas / gotchas (NO romper)

- **NO usar `req.query`**: `req.query.get(...)` devuelve un puntero basura →
  `GC Out of Memory + SEGV` (bug del lenguaje; `req.params.get` SÍ funciona).
  Pasar datos al cliente por **localStorage** y hacer el trabajo client-side.
- **Imports internos de paquetes** deben ir **calificados**:
  `import "nyx-serve/src/files"` (no `import "src/files"`) — el resolver actual
  no resuelve el relativo en paquetes vendoreados.
- **Scope global plano entre módulos**: los `const`/`fn` de todos los `.nx`
  importados comparten un único scope. NO redeclarar el mismo `const` en dos
  módulos (ej. `KV_HOST`) → "already declared". Declararlo una vez o inline.
- **NO redeclarar un `extern "C"` que ya provee `std/`**: el scope global plano
  también aplica a los `extern`. `std/web` ahora declara `extern nyx_url_decode`;
  como `main.nx` importa `std/web`, ese símbolo es visible en TODOS los módulos.
  Declararlo otra vez (lo hacía `src/chat.nx`) da error de LINK **`invalid
  redefinition of function 'nyx_url_decode'`** (no lo detecta el front del compilador,
  revienta en clang). Usar el de `std/web` sin redeclarar.
- **nyx-serve vendoreado lleva un PARCHE LOCAL** (`serve_ws` + detección de
  `Upgrade: websocket` en `__serve_ka_worker`, `packages/nyx-serve/src/server.nx`):
  entrega `[fd, path, headers_flat]` a un handler `Fn(Array) -> int` registrado con
  `serve_ws(...)`; si devuelve 1 el server NO cierra el fd. **Al re-vendorear
  nyx-serve hay que re-aplicar el parche** (upstream `products/serve` no lo tiene).
- **2º PARCHE LOCAL de nyx-serve: sin global `App` por valor** (`server.nx`, commit
  `ebb2e97`). Upstream tenía `var __serve_app: App = app_new()` (global struct por
  valor). El compilador **nyx v0.18.0** numera MAL ese inicializador en
  `__nyx_init_globals` (SSA fuera de secuencia → `clang: instruction expected to be
  numbered … or greater`), y revienta CUALQUIER `nyx build` del proyecto. Workaround:
  se guardan los 3 campos que usa el worker por separado (`__serve_mw`/`__serve_routes`/
  `__serve_static`, punteros) seteados en `serve_app()`. **Re-aplicar al re-vendorear**
  mientras el compilador tenga la regresión (o si upstream mete otro global struct).
- **nyx-serve ignora `headers_flat` en 301/302** (`packages/nyx-serve/src/server.nx`):
  en un redirect usa `resp.body` como valor de `Location` y NO emite otras
  cabeceras → **no se puede fijar `Set-Cookie` en un redirect**. Para fijar/limpiar
  cookie: responder `200` con `Set-Cookie` + `<meta refresh>` (ver
  `set_cookie_and_go` en `src/admin.nx`). En `redirect()` el destino va en el body.
- **Literales de array globales multi-elemento se inicializan vacíos**: inicializar
  los holders dentro de una función (ver `sismos_init()`), no confiar en el literal.
- **Leer String de Array/Map**: asignar SIEMPRE a un `let x: String = arr[i]`
  tipado antes de usarlo (coacciona i64→ptr). Usarlo crudo en concatenación/args
  da basura.
- **Caché**: las páginas HTML usan `html_nocache(...)` (Cache-Control: no-cache)
  para que el gateway no las sirva viejas. Los assets (CSS/JS/iconos) SÍ se
  cachean en el gateway (~60s). **Al tocar `style.css`, `chat.js` o el JS de
  `sw.js`, subir la versión `veninfo-vN` en `static/sw.js`** para invalidar la
  caché de las PWA. El SW **jamás cachea `/api/*`** (rama excluida; si se quita,
  el chat de la PWA se congela con la primera respuesta).
- **Frontera JS↔wasm: SOLO int (BigInt en JS) y String cruzan.** Los floats van
  como String (`string_to_float` adentro) o salen ya formateados. NUNCA llamar
  `exports.*` a pelo fuera de nyx-loader.js (pasar Number donde va i64 =
  TypeError). Multi-valor con `|`; tabular con `\n`/`\t` (JS sanea separadores).
- **NO parsear JSON con floats via `std/json` en el wasm** (trunca floats, mismo
  bug de siempre): JS extrae los valores del JSON y los pasa en strings planas.
- **El wasm NO tiene GC** (leak-by-design): ~120 KB filtrados por render de
  sismos (~72 MB tras 600 renders; una sesión normal ni se nota, recargar
  resetea). Por eso: filtros con evento `change` (no `input`), parseo único en
  `sismos_load`, filas armadas con StringBuilder. No meter renders en bucles.
- **El markup de fila de sismos está DUPLICADO adrede**: `render_quakes`
  (src/sismos.nx, server) y `s_row_html` (wasm/veninfo.nx, navegador) — el wasm
  regenera `#qtbody`. Cambiarlos JUNTOS (hay comentario cruzado).
- **CARRERA del scratch `script.nx` del monorepo**: tanto `deploy/build-wasm.sh`
  (make wasm) como **`nyx build` del proyecto** usan `$NYX_HOME/script.nx` como
  scratch. Si OTRA sesión está compilando/testeando en NyxLang a la vez, el
  binario puede salir con el programa EQUIVOCADO (pasó 2026-07-02: el server
  quedó compilado con un test de docstrings y el servicio entró en bucle).
  Tras CADA `nyx build`: verificar con `strings venezuelainfo-org | grep -q
  sismos` antes de reiniciar. El shim `nyx-wasi-shim.js` se re-copia del
  monorepo en cada build del wasm.
- **Fechas "hace X" server-side con marcador**: el HTML de noticias/BVC se
  cachea ~30 min, así que `render_list/render_slides` (src/news.nx) emiten
  `@REL:<epoch>@` dentro del `<time>` y `rel_fill()` lo sustituye EN CADA
  request (news_full_html/news_rotator_html/bvc_list_html ya lo aplican). Si se
  añade otra lista cacheada con fechas: emitir el marcador y envolver el getter.
- **El rotador es CSS + clases**: sin wasm, `:first-child` muestra el primer
  slide (fallback estático); `rot_boot` añade `.rot-live` al stage y va moviendo
  `.on` vía `:nth-child` con `js_interval`. No volver a manipular `style.display`.
- **`dom_on` registra por NOMBRE de export y los handlers reciben CERO args**:
  el contexto va por estado del módulo o inputs hidden (`#s-selected` +
  `dom_get_value`). El loader debe setear `dom.ref.exports` tras instanciar
  (ya lo hace) o los listeners revientan.
- **Dark mode**: automático con `prefers-color-scheme` redefiniendo variables.
  Para TEXTO azul usar `var(--enlace)` (claro en oscuro); `var(--azul)` queda
  SOLO para fondos (botones, thead). Texto sobre amarillo: color fijo `#14213d`.
- **Tiempos en hora LOCAL**: el servidor manda ISO UTC (`data-iso`/`#s-data`) y
  el wasm los convierte con `iso_to_epoch` + `civil_parts` + `js_tz_offset_min()`
  (wasm/veninfo.nx). Las fechas relativas de noticias van server-side (`rel_fill`).
  No mostrar UTC al usuario.
- **Zoom bloqueado**: todas las páginas usan `page_fixed` (`user-scalable=no`).

## Portada / tarjetas (src/main.nx: handle_index + static/assets/home.js)

- Tarjetas (`.home-card` con `data-key`) dentro de `#home-cards`. Orden guardado en
  `localStorage` (`card_order`, lista de `data-key`). Botón ⚙️ (`#cfg-btn`) activa el
  **modo edición** (`#home-cards.editing`). Todo el JS en `static/assets/home.js`.
- **Dos formas de reordenar** (ambas guardan en `card_order`):
  1. **Drag&drop** HTML5 (escritorio) — `draggable` solo en modo edición.
  2. **Flechas ↑/↓** (`.card-move`/`.cm-btn`) que `home.js` inyecta por JS en
     cada tarjeta; visibles solo en modo edición. **Imprescindibles para móvil/PWA**
     (el drag nativo táctil no funciona). Mueven con `previous/nextElementSibling`.
- CSS de todo esto en `static/assets/style.css` (`.cfg-btn`, `.home-card`,
  `.card-move`, `.cm-btn`). **Al tocarlo, subir `veninfo-vN` en `static/sw.js`.**

## Sismos (src/sismos.nx + src/funvisis.nx)

- Fuente: **FUNVISIS** (primaria en tierra) **+ EMSC** (fronterizos/costa afuera),
  fusionadas por `all_quakes()` (src/sismos.nx): junta `funvisis_records()` y
  `emsc_records()`, descartando de EMSC los duplicados de FUNVISIS por
  tiempo+coordenadas (`dup_in_funvisis`).
  - **FUNVISIS** (`src/funvisis.nx`): feed `http://www.funvisis.gob.ve/maravilla.json`
    (GeoJSON, HTTP **plano** sin TLS → `http_get`, NO `https_get`). Reutiliza una
    plantilla de "localizador" con campos **mal nombrados** (único punto frágil si
    FUNVISIS rediseña el sitio): `phone`=magnitud, `address`=lugar, `city`=hora LOCAL
    (HH:MM, **UTC-4**), `postalCode`=fecha (DD-MM-YYYY), `state`=profundidad,
    `lat`/`long`=coordenadas. Caché en RAM (TTL 3 min).
  - **EMSC** (`www.seismicportal.eu`), formato **FDSN text** (delimitado por
    `|`). NO usar GeoJSON (el parser de `std/json` trunca floats). Bounding box de fetch
    lat 0..13 / lon -74..-59, `minmag=2.5`, `limit=200`. (USGS estuvo bloqueado desde
    este host; en 2026-07 volvió a responder, pero se mantiene EMSC como fuente
    fronteriza/offshore, complementada por FUNVISIS para los locales.)
- Columnas FDSN: 0 EventID, 1 Time, 2 Lat, 3 Lon, 4 Depth, 9 MagType, 10 Mag, 12 Lugar.
- **Inclusión por GEOGRAFÍA, no por nombre** (`quake_in_region` en src/sismos.nx): el
  filtro antiguo `place.indexOf("VENEZUELA")` descartaba ~la mitad de los eventos de
  la caja (sismos sentidos en Venezuela con etiqueta vecina: NORTHERN COLOMBIA / GULF
  OF PARIA / TRINIDAD / CARIBBEAN SEA → **causaban "no se registró"**). Ahora se
  incluye si el nombre contiene VENEZUELA **o** el epicentro cae en la caja ajustada
  lat 0.5..12.9 / lon -73.6..-60.5 (excluye Barbados/Windward por lon > -60.5). El
  helper se aplica dentro de `emsc_records()` (única fuente que lo necesita; los
  eventos FUNVISIS ya vienen todos en tierra); el render consume `all_quakes()`.
- Caché del cuerpo crudo en memoria (TTL 3 min, `sismos_ts()`); refresher warmea
  sismos cada 10 min (main.nx; noticias/tasas siguen cada 30 min).
- El servidor emite la tabla completa (SEO/no-JS) + `<textarea id="s-data" hidden>`
  (TSV de 8 campos, `sismos_data_block()`); la interactividad (paginación 12/pág,
  filtros mag/dist/lugar, orden fecha/distancia/magnitud, detalle inline, destacado
  24 h, geolocalización persistente cada 2 min) corre en **wasm/veninfo.nx**
  (`sismos_boot`), que regenera `#qtbody`. El markup de fila está duplicado adrede
  (`render_quakes` server ↔ `s_row_html` wasm) — cambiarlos JUNTOS.
- `/sismos/{id}` = página de detalle con mapa grande (Leaflet + gesture-handling,
  `quake.js`; la distancia usa `nyx.havKm` del wasm).

## Clima (src/main.nx)

- `weather_card()` = resumen (enlaza a `/clima`). `handle_clima()` = landing
  completa: buscador de cualquier ciudad (geocoding), "Mi ubicación", actual
  completo, próximas horas, 7 días, UV, amanecer/atardecer, calidad del aire.
- Todo corre en **wasm/veninfo.nx** (`wcard_boot`/`clima_boot`): fetch a
  **Open-Meteo** (sin API key, CORS) vía `js_fetch`, parseo con los scanners
  (jarr para los arrays hourly/daily — los ISO de timezone=auto son LOCALES),
  render con dom_set_html. Ciudad elegida en localStorage (`w_lat`/`w_lon`/
  `w_name`), compartida entre tarjeta y página.

## Bases de datos: nyx-kv (KV) + nyx-db (SQL embebido)

El proyecto usa **dos bases de datos, ambas escritas en Nyx** (modelo híbrido):

- **nyx-kv** (`:6380`, RESP2+**TLS**+AUTH por token, `src/kv.nx`, conexión corta por
  request) para lo **crítico / KV-shaped**: `admin:*` (pass + sesiones), `chat:*`
  (salas/mensajes/rate-limit), `baq:*` (baquiano). Persiste (token enterprise, sin TTL).
- **nyx-db** (SQL relacional, **modo EMBEBIDO** = librería in-process, `src/sqldb.nx`)
  para lo **analítico / regenerable**: tablas `visits` (analítica) y `rates` (histórico
  de tasas) + `meta`. Snapshot binario en **`/home/admin/veninfo.ndb`** (fuera del repo;
  `db_load` al arrancar, `db_save` cada 60 s por un hilo y en SIGTERM vía shutdown handler).

**Por qué embebido y no el daemon**: el server RESP2 de nyx-db **no tiene TLS ni AUTH**
(sería un retroceso vs nyx-kv) y su servicio fue retirado. Embebido = "SQLite-en-Nyx"
dentro del propio proceso, sin puerto. `sqldb_init()` se llama en `main()`.

**Gotchas de nyx-db (v0.5.0) — NO romper:**
- **Concurrencia OK sin mutex propio**: nyx-db serializa todo con su `g_db_mtx` interno;
  los 16 workers llaman `sql_exec`/`sql_rows` directo (probado con ráfagas paralelas).
- **Toda celda vuelve como String** (incluso números y NULL). NULL llega como el literal
  **`"__NULL__"`**. Castear con `string_to_int/float`; guardar contra `""`/`"__NULL__"`
  (ver `sql_count` y `sf()`). La fila `[0]` de un SELECT es el **header**.
- **Múltiples agregados en un SELECT SIN GROUP BY → NULL** (bug: `SELECT MIN(x),MAX(x),
  AVG(x) FROM t` cae al path de columnas). Funcionan: **un** agregado (`SELECT COUNT(*)
  FROM t WHERE …`) y **GROUP BY**. Para mín/máx/prom de tasas se calcula **en código**.
- **ORDER BY sobre un agregado/alias no es fiable** → "Lo más visto" hace `GROUP BY path`
  y **ordena en Nyx** (top 10).
- **Sin binds / parámetros**: TODO valor de request (path/ip/ua) va por **`sql_esc`**
  (`'`→`''` + strip control + cap). Numéricos y `kind` son literales del código.
- **Sin transacciones reales** (BEGIN/COMMIT son stubs) ni `ALTER TABLE`: si cambia el
  esquema, recrear la tabla (dato regenerable). Solo datos regenerables viven aquí.
- **Al re-vendorear nyx-db**: copiar los 9 módulos embebidos a `packages/nyx-db/src/`
  (NO `commands.nx`/`limits.nx`, que son del daemon). Cero colisiones de nombres con
  el resto (nyx-db prefija globals con `g_`/`p_`).

## Chat colectivo (src/chat.nx + src/kv.nx)

- Chat público en `/chat` **con salas**; tarjeta reordenable en la portada
  (`data-key="chat"`). Selector de sala en el JS (localStorage `chat_room`).
- **Salas**: la sala `general` usa la clave legacy `chat:msgs`; el resto usan
  `chat:room:<id>:msgs`. Índice de salas creadas por el admin en la lista
  `chat:rooms` (entradas `id|nombre`). **Solo el admin crea/borra salas** (panel).
  Endpoints: `GET /api/rooms` (lista), `GET /api/chat/{room}` (mensajes),
  `POST /api/chat/send` (campo `room` en el body). Sala validada con `is_valid_slug`
  + existencia; rate-limit **por sala** (`chat:rl:<id>`).
- **Almacenamiento: nyx-kv** (:6380, RESP2+TLS) — `RPUSH`/`LTRIM -200 -1`/
  `LRANGE -50 -1`. Formato `ts|nick|texto` (nick/texto saneados sin `|`). **Token
  dedicado** (NO admin) en `/home/admin/.veninfo-chat-token` (0600) o env
  `NYXKV_CHAT_TOKEN`; `TOKEN_CREATE veninfo enterprise 0` (namespace `veninfo::`).
- **Sin TTL forzado**: el TTL de 24h del daemon **solo aplica al plan `free`**
  (`auth_force_ttl` devuelve false para `enterprise`, ver
  `nyx-kv-stack/.../auth.nx`). El token `veninfo` es enterprise → las claves
  (`chat:*`, `baq:*`, `admin:*`) **persisten indefinidamente** (no ponerles `EXPIRE`
  salvo rate-limit y sesiones). La app no pone `EXPIRE` en `chat:msgs`.
- **Tiempo real: SÍ (WebSocket)** desde 2026-07-01. El gateway (nyx-proxy) hace
  passthrough del Upgrade (solo por TLS/:443) hacia :3010; el upgrade lo detecta el
  **parche local de nyx-serve** (`serve_ws` en `packages/nyx-serve/src/server.nx`,
  ver gotchas) y lo maneja `src/ws.nx` + `chat_ws_handler` (`src/chat.nx`). Endpoint
  `GET /ws/chat/{sala}` → 101; el servidor **solo empuja** (broadcast al publicar);
  el envío sigue por POST. El cliente (`static/assets/chat.js`) manda un ping `'p'`
  cada 25 s (keepalive NAT) y cae a **polling (4 s)** si el WS no conecta, con
  backoff exponencial y pausa con la pestaña oculta. Render con `textContent`
  (anti-XSS), incremental (solo anexa mensajes no vistos).
- **OJO**: si el proceso del gateway es ANTERIOR al soporte WS (binario recompilado
  pero servicio sin reiniciar), el Upgrade viaja por el pool HTTP y da 502. El hilo
  lector de `src/ws.nx` se protege cerrando el fd ante datos que no sean frames de
  cliente (texto enmascarado/close), para no envenenar el pool del gateway.
- **Moderación**: escape/saneo, topes (nick 24 / texto 280), filtro de groserías,
  cupo de ritmo **por sala** (`INCR chat:rl:<id>`+`EXPIRE 10`, ~25/10s). Vaciar/borrar
  salas se hace desde el **panel admin** (`/admin/salas`). El antiguo
  `POST /api/chat/clear` + `CHAT_ADMIN_KEY` fue **eliminado** (lo reemplaza el panel).
- **Body POST parseado a mano** (`form_field` en `chat.nx` + `nyx_url_decode` de
  `std/web`) para esquivar el bug de `req.form`/`req.query`. `nyx_url_decode`
  decodifica `%XX` + `+` (el símbolo lo aporta `std/web`; no redeclararlo, ver arriba).
- **Gotcha ops**: al probar con `./venezuelainfo-org &` en background, el binario
  queda **detached** y retiene el puerto → el systemd entra en bucle "cannot listen".
  Matar strays con `sudo pkill -9 -f venezuelainfo-org` antes de reiniciar el servicio.

## Baquiano (src/baquiano.nx + panel admin)

- **Guía turística de Venezuela por zona** (24 estados). Tarjeta reordenable en la
  portada (`data-key="baquiano"`), `/baquiano` (índice) y `/baquiano/{zona}` (ficha de
  zona, con `req.params`, nunca `req.query`).
- **Contenido en nyx-kv** (namespace `veninfo::`, sin TTL), modelo plano por zona:
  `baq:zones` (lista de ids), `baq:zone:<id>` (nombre), `baq:zone:<id>:capital`,
  `:desc` (panorama), `:facts` (lista `etiqueta|valor` — datos prácticos, **extensible**),
  `:municipios` (lista `municipio|capital`), `:sites` (destinos, `nombre|categoria|
  descripcion`), `:poblados` (directorio, `municipio|localidades`). Todo saneado sin `|`.
  Ids `is_valid_slug`. La ficha pública muestra todo + un **enlace a Google Maps por
  destino** (`maps_url`/`baq_urlenc`, URL de búsqueda `nombre, zona, Venezuela`).
- Se **crea/edita/borra desde el panel admin** (`/admin/baquiano`): editar zona
  (nombre/capital/panorama/imagen) + add/del de datos/municipios/destinos/directorio.
- **Imágenes** (Wikipedia): cada destino lleva un 4º campo opcional `imgurl` en su entrada
  (`nombre|categoria|descripcion|imgurl`) y cada zona una clave `:img` (portada). Se
  autorrellenan con `wiki_image()` (busca en `es.wikipedia.org/w/api.php` pageimages;
  parseo por scan de string, NO std/json). **Fetch SÍNCRONO por zona** (`baquiano_fetch_zone`,
  botón "Buscar imagenes de la zona" en el admin — fiable) o global en hilo
  (`baquiano_fetch_start`, botón "Buscar imagenes"). Override manual por sitio
  (`site_set_img`) y por zona (campo imagen del form). Render: `<img class=baq-hero>` +
  `baq-site-img`, con fallback y crédito a Wikimedia.
  - **GOTCHA Wikipedia**: la API **EXIGE un User-Agent descriptivo**; con el UA por defecto
    de `https_get` **bloquea/throttlea la IP tras una ráfaga** (las llamadas devuelven vacío).
    Por eso `wiki_get()` usa `http_build_request`+`http_tls_request` (std/http) con
    `User-Agent: venezuelainfo.org/...` y un **throttle de 0.8 s** por llamada. No quitar.
- **Hoteles/reseñas (gratis)**: enlaces a Google Maps — "Ver en Google Maps (reseñas y
  fotos)" por destino, "Hoteles cerca" por destino y "Hoteles en {estado}" por zona
  (`maps_url`/`hotels_url`, sin API). Places API embebida (de pago) queda de futuro.
- **Carga inicial**: `content/baquiano-seed.txt` (delim `~~~`, párrafos con centinela
  `~~P~~`) → `baquiano_import()` (wipe+reload, botón "Importar guía" en el admin). El
  seed se generó a partir de `content/guia_turistica_venezuela.md` (referencia).
- **GOTCHA nyx-kv: el cliente (src/kv.nx) TRUNCA valores que contienen `\n` real** al
  escribir (el SET queda cortado en el primer salto). Por eso `desc` guarda los párrafos
  con el centinela `~~P~~` (no `\n`); `zone_edit` convierte los `\n` del textarea a
  `~~P~~` antes de `kv_set`. No almacenar strings con saltos de línea en nyx-kv.

## Panel admin (src/admin.nx)

- `/admin`: **login único de dueño**. Hash `salt:sha256(salt+pass)` en `admin:pass`
  (nyx-kv, namespace `veninfo::`, inaccesible a anónimos). Sesión = cookie
  `veninfo_admin` (HttpOnly, Secure, SameSite=Strict); estado en `admin:sess:<sid>`
  (`SETEX` TTL 2h) cuyo valor es el **token CSRF** de esa sesión.
- **Secreto**: `VENINFO_ADMIN_PASSWORD` por systemd drop-in (`deploy/admin.conf.example`).
  `admin_init()` siembra `admin:pass` al arrancar solo si no existe. Sin secreto y
  sin hash previo, el panel queda **cerrado** (login siempre falla). Cambiar clave:
  `DEL admin:pass` (redis-cli con el token veninfo) + re-sembrar.
- **CSRF**: todos los POST de mutación exigen el campo `csrf` == token de sesión.
- Gestiona: **Baquiano** (zonas/sitios) y **Salas de chat** (crear/borrar/vaciar).
- Reusa el patrón de `nyx-kv-stack/dashboard/src/auth_local.nx` (hash/salt/sesión).

## Rutas

`/` · `/clima` · `/finanzas` · `/noticias` · `/chat` · `WS /ws/chat/{sala}` ·
`/baquiano` · `/baquiano/{zona}`
· `/sismos` · `/sismos/{id}` · `/articulo/{slug}` · `/api/health` · `/api/rooms`
· `/api/chat` · `/api/chat/{room}` · `POST /api/chat/send` · `/admin` ·
`POST /admin/login` · `POST /admin/logout` · `/admin/baquiano` (+POST) ·
`/admin/salas` (+POST) · `/admin/visitas` (+POST) · `/calculadora` ·
`/manifest.webmanifest` · `/manifest-calc.webmanifest` · `/sw.js` · `/icon*.png|svg` · `/assets/*`

## Pendientes / ideas (backlog)

Sin prioridad estricta; tomar lo que aporte.

- [ ] **Tarjeta "más fuerte" con respaldo a 7 días**: si no hay sismos en 24 h,
      mostrar el más fuerte reciente; resaltar siempre cualquier M ≥ 6.
- [ ] **`Cache-Control: no-cache` también para `style.css`** (dejar cacheados solo
      iconos/imágenes) para que los cambios de CSS se vean al instante por el dominio.
- [ ] **Círculo de precisión "tú estás aquí"** en los mapas (accuracy de geo).
- [x] **Contador/analítica de visitas** — HECHO: `visits` en **nyx-db (SQL)** vía el
      middleware global + `/admin/visitas` (total/únicos/hoy/7 días/"Lo más visto"/registro).
- [x] **Histórico de tasas** — HECHO: `rates` en **nyx-db (SQL)**, snapshot server-side
      cada 30 min (refresher) + sección "Histórico" en `/finanzas`.
- [ ] **Caché compartido del feed EMSC en nyx-kv** (`SETEX sismos:emsc:body 300 …`):
      hoy la caché de sismos vive solo en RAM del proceso (se pierde al reiniciar).
- [ ] **Fase F: chat en Nyx** — BLOQUEADA hasta que el monorepo entregue GC/arenas
      en el target wasm (tarea 2 de `NyxLang/HANDOFF-veninfo-front.md`; sin GC una
      pestaña de chat de horas filtra memoria sin tope). Diseño listo: externs
      `js_ws(url,on_msg,on_close)` + `js_ws_send` + `js_on_submit` (preventDefault)
      + `js_on_visibility`/`js_hidden` + `js_scroll_bottom` en la pasarela; POST por
      `js_fetch`; render incremental en Nyx.
- [ ] **Adoptar lo que entregue el monorepo** (HANDOFF-veninfo-front.md): al llegar
      std/json con floats → borrar los scanners jnum/jstr/jseg/jarr; closures+Event
      → migrar drag&drop de home.js y borrar js_delegate/js_on_enter; std/browser →
      borrar la pasarela del loader; make wasm multi-archivo → partir veninfo.nx.
- [ ] **Leaflet con SRI o autoalojado** (hoy unpkg sin integrity ni fallback).
- [ ] **Robustez WS del gateway** (en el monorepo): locking del SSL del túnel,
      timeout de idle, propagación simétrica del cierre (limitaciones "de piloto").
- [ ] **Notification API en el chat** (avisar mensajes nuevos con pestaña oculta;
      viable ya que el WS empuja).
- [ ] **Más artículos** en `content/articles/` (+ slug en `content/index.txt`).

## Hecho (hitos)

Desplegado y en producción: portada + artículos Markdown; sismos (EMSC) con mapa,
filtros, paginación, orden (fecha/distancia/magnitud), geolocalización persistente,
hora local, detalle por evento; clima completo en `/clima` (cualquier ciudad +
geolocalización + actual/horas/7 días/UV/amanecer/AQI); PWA (manifest + SW +
iconos); HTML `no-cache`; behind gateway con TLS. Nav superior (con Clima/Baquiano).
**Baquiano** (guía de sitios por zona, contenido en nyx-kv, editable en el panel).
**Chat con salas** (solo admin las crea, mensajes aislados por sala). **Panel admin**
(`/admin`, login de dueño + sesión por cookie + CSRF, CRUD de baquiano y salas).
**Chat en tiempo real por WebSocket** (2026-07-01: parche serve_ws + src/ws.nx +
chat.js con respaldo de polling; pendiente solo reiniciar nyx-gateway). **Front
extraído a static/assets/*.js** (main.nx bajó de ~770 a ~470 líneas), **dark mode**,
focus visible, reduced-motion, badge de filtros activos, `ws` en /api/health, y fix
del SW que cacheaba `/api/*` (congelaba el chat en la PWA).
**Front Nyx→WASM completo (2026-07-02, fases A–E el mismo día del release del
Escenario B)**: `wasm/veninfo.nx` → `veninfo.wasm` (~150 KB gzip) hace TODO el
front dinámico en Nyx — finanzas (fetch+parseo+render), clima (tarjeta + página
completa + buscador de ciudades + geolocalización), sismos (self-boot desde
`#s-data`, filtros/orden/paginación/detalle/destacado, hora local derivada en
Nyx), rotador de titulares y expand de noticias/BVC — sobre una pasarela de
capacidades en nyx-loader.js (js_fetch/js_interval/js_geo/js_delegate/…,
callback-por-nombre-de-export). Fechas "hace X" movidas al SERVIDOR
(marcador @REL: + rel_fill por request). Se BORRARON veninfo.js, fx.js,
clima.js y sismos.js; quedan solo loader, home.js (drag&drop), quake.js
(Leaflet), chat.js y sw.js. Suite headless de ~60 asserts con fixtures reales
(wasm/tests/imports.mjs). Handoff de 7 tareas del lenguaje al monorepo
(`NyxLang/HANDOFF-veninfo-front.md` + puntero en TASKS.md).
Bugs del lenguaje hallados → anotados en `NyxLang/TASKS.md`.
**Calculadora simplificada** (3 tasas: Dólar BCV / Euro BCV / Dólar Binance, con
conversión bidireccional Bs↔divisa; PWA propia en `/calculadora`).
**Segunda base de datos: nyx-db (SQL en Nyx, embebido)** — modelo híbrido con nyx-kv.
`visits` (analítica: contador + "Lo más visto" + registro) y `rates` (histórico de
tasas graficado en `/finanzas`) viven en SQL (`packages/nyx-db` vendoreado + `src/sqldb.nx`);
sesiones/chat/baquiano siguen en nyx-kv. Persistencia por snapshot `.ndb`. Bugs de
nyx-db v0.5.0 sorteados (agregados múltiples sin GROUP BY, `__NULL__`, sin binds → `sql_esc`).

## Verificación rápida
```bash
NYX_HOME=/home/admin/NyxLang nyx build && sudo systemctl restart nyx-venezuelainfo
for p in / /clima /sismos /api/health; do curl -s -o /dev/null -w "$p %{http_code}\n" localhost:3010$p; done
```
(Probar contra :3010 evita la caché del gateway.)
