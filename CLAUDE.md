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
  wasm vía pasarela: **Open-Meteo** (clima/geocoding/AQI), CriptoYa (Binance P2P),
  er-api, CoinGecko, bigdatacloud (reverse geocode), **Geolocation**, **localStorage**.
  Las tasas **BCV** las pide el wasm a **nuestro `/api/rates`** (mismo origen; el
  servidor raspa BCV — BCV no da CORS). Wikipedia (imágenes de Baquiano) también es
  server-side. La calculadora guarda en **localStorage**: preferencias de filtro y los
  **datos de pago** del usuario (pago móvil/transferencia).

### Mapa de archivos
```
src/main.nx      Entry + rutas + handlers (HTML server-side; el JS vive en static/assets/*.js
                 y se referencia con <script src="/assets/X.js?v=N" defer>).
src/layout.nx    Shell HTML (head, header, footer). page() y page_fixed() (zoom bloqueado),
                 metas PWA, registro del service worker.
src/articles.nx  Portada + render de artículos (server-side desde content/).
src/md.nx        Renderizador Markdown→HTML propio + html_escape.
src/num.nx       Parseo numérico SEGURO (to_int0/to_float0). TODO valor de red/kv/db pasa por aquí:
                 string_to_int/string_to_float ABORTAN el proceso con entrada no numérica. Capa
                 fina sobre los builtins string_to_int_or/string_to_float_or (que el monorepo
                 entregó a raíz del crash 2026-07-16). Ver el gotcha abajo.
src/net.nx       ÚNICO cliente HTTP(S) de salida (net_get), sobre std/http. Nació porque https_get
                 no des-chunkeaba (causa del crash 2026-07-16, ya arreglado en el runtime); se
                 mantiene porque el builtin sigue sin dar STATUS ni cabeceras propias (UA).
src/sismos.nx    Cliente EMSC (net_get), parser FDSN text, all_quakes() (fusión con
                 FUNVISIS + dedup por tiempo+coords), caché, tabla HTML con data-*.
                 sismos_ts() = máx(ts EMSC, ts FUNVISIS) — el "Actualizado" de /sismos.
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
                 más visto" por SQL sobre la tabla visits) + /admin/push (contador de
                 suscripciones + "Enviar prueba" a un tema).
src/push.nx      Notificaciones Web Push (VAPID RFC 8292 + cifrado RFC 8291) sobre std/webpush.
                 push_init (claves VAPID en meta + tabla push_subs), push_subscribe/unsubscribe,
                 push_send_one/push_send_topic, push_worker (hilo 30s: sismos M≥3.5 / tasa BCV
                 cambiada / chat coalescido, con watermarks en meta), push_chat_mark. Ver sección abajo.
wasm/veninfo.nx  Root del front Nyx→WASM: cabecera + imports + ambos bloques de externs
                 (pasarela) + main() router por #pg. PARTIDO en módulos (make wasm ya resuelve
                 imports project-relative vía NYX_PROJECT_DIR=$PROJ/wasm; scope global plano →
                 símbolos visibles entre archivos, NO redeclarar). Módulos hermanos en wasm/:
                 common.nx (helpers puros / fechas iso_to_epoch,civil_parts / scanners JSON
                 jnum/jstr/jseg — std/json ya NO trunca floats pero su adopción está diferida) /
                 finanzas.nx (fx_* + calculadora: tasas de /api/rates con toggle Hoy/Mañana
                 según fecha valor BCV; datos de pago del usuario en localStorage, anexables al
                 compartir) / clima.nx / sismos.nx / noticias.nx
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

- **NUNCA parsear un número de fuera con `string_to_int`/`string_to_float`: ABORTAN EL
  PROCESO** (runtime/strings.c) con entrada no numérica — no devuelven 0 ni fallan de
  forma atrapable. Como todo el sitio es UN proceso, un solo valor corrupto se lleva el
  servidor Y los hilos (push, refresher). **Usar SIEMPRE `to_int0`/`to_float0` de
  `src/num.nx`.** OJO con `""`: también aborta (no solo las strings no numéricas).
  Desde 2026-07-16 el runtime tiene **`string_to_int_or(s, def)` / `string_to_float_or(s,
  def)`** (builtins entregados a raíz de este incidente), y `src/num.nx` es ya solo una
  capa fina sobre ellos: se sigue usando el módulo para tener los nombres cortos en un
  único sitio donde cambiar la política. Los `string_to_*` SIN `_or` siguen abortando.
  - **Incidente 2026-07-16 06:32:43 UTC** (el servicio murió; systemd lo revivió):
    `💥 Runtime Error: String '2\r\n3d1c\r\n1' no es un número válido`. `3d1c` = 15644 =
    **tamaño de chunk hexadecimal**: un marcador de `Transfer-Encoding: chunked` se coló
    DENTRO de un número (ver el gotcha siguiente). Reproducible: `string_to_float("2\r\n3d1c\r\n1")`.
  - El viejo `to_int0` de `src/push.nx` **NO era seguro** pese a llamarse "parseo seguro" (y a
    que este archivo lo vendía como tal): filtraba `""`/`"__NULL__"` y luego llamaba
    `string_to_int` a pelo. Mismo defecto tenía `sql_count` (`src/sqldb.nx`) y `sf` (`src/rates.nx`).
    Ahora todos delegan en `src/num.nx`, que valida el string COMPLETO.
- **Salir a la red SIEMPRE por `net_get` (`src/net.nx`), no por `https_get`.** El motivo
  original —`https_get` no desencapsulaba `Transfer-Encoding: chunked` y metía los marcadores
  de tamaño DENTRO del cuerpo (**CriptoYa y bolsadecaracas.com responden chunked**), lo que
  partió un número y **abortó el proceso el 2026-07-16**— **ya está ARREGLADO en el runtime**
  (mismo día, a raíz de este incidente: `read_http_response` de tls.c des-chunkea). Pero
  `net_get` se mantiene por lo otro que el builtin sigue sin dar: el **STATUS** (con
  `https_get` un 403/500 es indistinguible de un éxito: solo ves "" o basura, y se sirve caché
  vieja creyendo que falló la red) y **cabeceras propias** (va con `User-Agent: Nyx/1.0`, que a
  Wikipedia le vale un bloqueo por ráfaga).
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
- **Inclusión: nombre O POLÍGONO** (`quake_in_region` + `point_in_ve`, src/sismos.nx).
  Se incluye si el nombre contiene VENEZUELA (EMSC es la autoridad sobre sus eventos)
  **o** si el epicentro cae dentro del **polígono Venezuela + ~60 km** (`ve_poly_init`,
  39 vértices, ray casting). Hacen falta las dos vías: filtrar SOLO por nombre
  descartaba ~la mitad de los eventos reales (sismos sentidos aquí con etiqueta vecina:
  NORTHERN COLOMBIA / GULF OF PARIA / TRINIDAD / CARIBBEAN SEA → "no se registró").
  Se aplica en `emsc_records()` (los eventos FUNVISIS vienen ya de la agencia
  venezolana); el render y el push consumen `all_quakes()`, así que **lista y alertas
  comparten criterio**.
- **POR QUÉ un polígono y no una caja** (2026-07-16): **Venezuela es CÓNCAVA**, así que
  cualquier rectángulo que la contenga (Zulia al oeste, Delta Amacuro al este) contiene
  también Bucaramanga, Guyana entera y el norte de Brasil. La caja anterior
  (lat 0.5..12.9 / lon -73.6..-60.5) no estaba mal calibrada: la herramienta no daba
  para más. Medido sobre los 211 eventos del feed de ese día, dejaba pasar **65 M≥3.5
  de Colombia — 48 del nido de Bucaramanga** (~6.75/-73.03, uno de los enjambres más
  activos del mundo: M4+ a diario a ~116 km de la frontera y profundos, no se sienten
  aquí), más Grenada/Tobago y un M6.3 en Colombia central a ~700 km. Es decir, ~1/3 de
  las alertas era ruido de vecinos. Con el polígono: 211 → 132 eventos, 0 del nido.
- **El criterio es la DISTANCIA, no la nacionalidad**: un M4.9 *colombiano* a ~40 km de
  San Cristóbal SÍ entra (se siente); el nido de Bucaramanga NO. El polígono incluye
  las **dependencias federales** (Los Roques, La Orchila, La Blanquilla, Los Testigos),
  el Golfo de Paria y Trinidad occidental, y la franja costa afuera del norte de Paria
  (falla de El Pilar). Al norte de Paria la línea es **arbitraria ±15 km** (un OFFSHORE
  SUCRE y un GRENADA REGION pueden estar a 16 km); ahí decide el atajo por nombre.
- **Al tocar el polígono: `node tests/poly-check.mjs`** (50 puntos de control; extrae
  los vértices del propio `src/sismos.nx`, no los duplica). Con un volcado
  `lat|lon|mag|place` como argumento, además reparte los eventos reales dentro/fuera.
- **GOTCHA del compilador**: los holders `__ve_lon`/`__ve_lat` se inicializan con `[0]`
  (int) y NO con `[0.0]`, aunque contengan floats: un literal **float en un array
  GLOBAL** revienta el codegen (`call void @nyx_array_push(..., i64 0.0)` → clang:
  "floating point constant invalid for type"). Los floats se asignan en `ve_poly_init()`.
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
- **Sin TTL forzado (arreglado 2026-07-17, ANTES roto)**: el TTL de 24h del daemon debe aplicar
  **solo al plan `free`** (`auth_force_ttl` devuelve false para pro/enterprise). El token `veninfo`
  es enterprise, así que `chat:*`/`baq:*`/`admin:*` deben persistir. **PERO durante meses NO fue
  así**: `auth_force_ttl` era código muerto (no se llamaba desde ningún sitio) y el daemon forzaba
  24h a TODA clave mirando solo `g_public_mode`. Baquiano y el chat caducaban cada 24h desde la
  última escritura — la pérdida "recurrente" que se achacó al leak/crash del daemon. Cableado en
  `nyx-kv-stack` (`maybe_enforce_ttl` en `lib/src/commands.nx` **y** en el vendoring
  `daemon/packages/nyx-kv/src/commands.nx`, que es COPIA — editar lib/ no basta). Verificado:
  `SET` con el token veninfo → `TTL` = -1. Detalle: la app **no** debe poner `EXPIRE` en `chat:*`/
  `baq:*` (solo en rate-limit y sesiones). Ver la memoria `nyx-language-gotchas.md` para el detalle
  y los bugs colaterales del daemon (SAVE bloqueado para enterprise, PERSIST no marca dirty).
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
  cupo de ritmo **por sala** (~25/10s). **OJO**: NO usa `INCR`+`EXPIRE` (nyx-kv puede tener
  `EXPIRE` roto → deja TTL -1 → contador atascado → "Demasiados mensajes" permanente, incidente
  2026-07-14). Usa **ventana por timestamp en el valor** `chat:rl:<id>` = `"count|inicio"` con
  GET/SET **bajo el mutex `CHAT_RL_MU`** (los 16 workers son hilos del mismo proceso; sin mutex
  el read-modify-write subcontaba bajo flood paralelo; `chat_init()` lo crea desde main) +
  `EXPIRE 600` best-effort (solo limpieza; NO se depende de él). El valor leído de nyx-kv se
  valida con `all_digits` antes de `string_to_int` (un valor corrupto NO numérico abortaría
  el proceso: el runtime hace exit(1) también con strings no numéricos, no solo con ""). Vaciar/borrar
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
- **Seed = respaldo COMPLETO** (`content/baquiano-seed.txt`, delim `~~~`, párrafos `~~P~~`):
  registros Z/D/F/M/S/P **+ imágenes** (6º campo de `S` = imgurl del destino, `I~~~id~~~url` =
  portada). `baquiano_import()` (wipe+reload) restaura TODO **incluidas las imágenes** sin
  re-buscar. `baquiano_export()`/`baquiano_backup()` (`write_file`) vuelcan el estado actual
  al seed. Admin: **"Importar guía"** (restaurar todo) · **"Respaldar al seed"** (guardar el
  estado, tras editar o buscar imágenes) · **"Restaurar (no destructivo)"** (solo texto).
  El seed original se generó de `content/guia_turistica_venezuela.md` (referencia).
- **⚠️ nyx-kv pierde datos**: la causa RECURRENTE (Baquiano/chat desaparecen cada ~24h) era el
  **TTL forzado del daemon**, ARREGLADO 2026-07-17 (ver el punto "Sin TTL forzado" arriba y la
  memoria `nyx-language-gotchas.md`) — no era el leak/crash. Aun así, si Baquiano sale
  vacío/incompleto por cualquier motivo, **admin → "Importar guía"** lo restaura del seed (con
  imágenes) y, con el fix activo, lo reescribe SIN TTL (a diferencia de PERSIST, el import hace SET
  → marca el estado dirty → el bg-saver lo persiste). Tras editar en admin, **"Respaldar al seed"** + commit.
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
  `admin_init()` siembra `admin:pass` al arrancar solo si no existe. **Auto-curación**: se
  llama TAMBIÉN periódicamente desde `refresher_worker` (tick ~30 min) porque nyx-kv pierde
  datos (perdió `admin:pass` el 2026-07-14 → login roto); así se re-siembra sola. Sin secreto y
  sin hash previo, el panel queda **cerrado** (login siempre falla). Cambiar clave:
  `DEL admin:pass` (redis-cli con el token veninfo) + re-sembrar.
- **CSRF**: todos los POST de mutación exigen el campo `csrf` == token de sesión.
- Gestiona: **Baquiano** (zonas/sitios) y **Salas de chat** (crear/borrar/vaciar).
- Reusa el patrón de `nyx-kv-stack/dashboard/src/auth_local.nx` (hash/salt/sesión).

## Rutas

`/` · `/clima` · `/finanzas` · `/noticias` · `/chat` · `WS /ws/chat/{sala}` ·
`/baquiano` · `/baquiano/{zona}`
· `/sismos` · `/sismos/{id}` · `/articulo/{slug}` · `/api/health` · `/api/rates` · `/api/rooms`
· `/api/chat` · `/api/chat/{room}` · `POST /api/chat/send` · `/admin` ·
`POST /admin/login` · `POST /admin/logout` · `/admin/baquiano` (+POST) ·
`/admin/salas` (+POST) · `/admin/visitas` (+POST) · `POST /admin/noticias` · `POST /admin/push` ·
`/calculadora` · `GET /api/push/config` · `POST /api/push/subscribe` · `POST /api/push/unsubscribe` ·
`/manifest.webmanifest` · `/manifest-calc.webmanifest` · `/sw.js` · `/icon*.png|svg` · `/assets/*`

## Notificaciones Web Push (src/push.nx + static/sw.js + JS suelto en src/layout.nx)

- **Cripto entregada por el monorepo** (`std/webpush` + `std/webpushcrypto`, VAPID ES256 + RFC 8291,
  binary-safe). `src/push.nx` NO reimplementa cripto: llama `vapid_jwt`/`webpush_encrypt`/`webpush_send`.
- **Claves VAPID**: cadena de recuperación en `push_init()`: env `VENINFO_VAPID_KEY` > `meta` (nyx-db)
  > **respaldo `/home/admin/.veninfo-vapid-key`** (se LEE al arrancar; si meta se perdió con el .ndb,
  se re-siembra desde el archivo) > generar (`ec_p256_keypair`, 97B = 32 priv ‖ 65 pub) y persistir en
  ambos. Cada fuente se valida con `vapid_kp_ok` (decodifica a 97B; una clave truncada daría claves
  basura en silencio). La pública se sirve en `GET /api/push/config` y **debe ser ESTABLE** (si cambia,
  todas las suscripciones se invalidan).
- **Suscripciones en nyx-db** (tabla `push_subs`, NO nyx-kv por inestable): `endpoint|p256dh|auth|topics|
  created`. `POST /api/push/subscribe` (form-urlencoded, parseado con `form_field`). **Allowlist de host
  del endpoint anti-SSRF** (fcm.googleapis.com / *.push.services.mozilla.com / web/*.push.apple.com /
  *.notify.windows.com) — sin ella el server haría POST a hosts arbitrarios. Dedup por endpoint. 404/410
  del push service → borra la suscripción. **OJO: todo lo que toque `endpoint` en SQL usa
  `sql_esc_n(…, PUSH_EP_MAX=2048)`**, NO `sql_esc` (capa a 256 y los endpoints reales lo superan —
  WNS ~450+; truncado = suscriptor roto en silencio: el primer envío da 404 y borra la fila).
- **Suscripción por TEMAS**: los TRES temas ON por defecto (decisión del commit `109166e`; el botón
  "Activar" sin abrir el desplegable suscribe a sismos+tasas+chat). La elección del usuario se
  **persiste en localStorage (`push_topics`)** y se restaura al cargar: la auto-resuscripción silenciosa
  (permiso concedido + suscripción perdida) y el cambio de checkboxes ya suscrito re-POSTean con los
  temas elegidos, no con los defaults. El **chat va coalescido/throttleado** (1 aviso/sala/5 min); el
  flag `push_chat_dirty` se consume **SOLO al notificar** (dentro de la ventana se conserva para
  avisar al expirar; borrarlo antes descartaba mensajes en vez de coalescerlos).
- **Envío fuera del hilo de request**: hilo `push_worker` (cada 30s). Tasas y chat van por
  **watermarks en meta** (`push_wm_tasa` = valor BCV previo, `push_chat_dirty:<sala>`/
  `push_chat_last:<sala>`). `push_chat_mark(sala)` se llama desde `handle_chat_send` con
  `chat_body_room()` (la MISMA normalización default+trim que usa `chat_post`; parsear el body
  aparte creaba claves meta fantasma con throttle propio). En `push_send_topic` el payload se
  arma una vez y el **JWT VAPID se cachea por audiencia**.
- **Sismos: dedup por ID DE EVENTO (tabla `push_seen(id, ts)`), NO por watermark de tiempo.**
  `push_wm_sismos` quedó como valor informativo; quien decide es `push_seen`. Un watermark de
  epoch perdía sismos de dos formas: (1) el epoch tiene granularidad de **minuto** (ni
  `emsc_iso_epoch` ni `fv_iso_epoch` parsean segundos), así que en un enjambre el segundo evento
  del mismo minuto caía en `epoch <= wm` **y además cortaba el bucle ahí**; (2) con **dos feeds de
  latencia distinta**, un evento EMSC reciente subía el watermark por encima de un sismo local que
  FUNVISIS aún no había publicado → al llegar, descartado PARA SIEMPRE. Ventana de candidatos
  `PUSH_SISMO_MAXAGE`=6h, tope `PUSH_SISMO_BURST`=5 por tick (los más FUERTES, no los más
  recientes), poda a 48h. **La siembra inicial se marca con `push_seen_init` en meta, NO con
  `push_wm_sismos`**: al desplegar sobre una instalación existente el watermark ya existía pero la
  tabla nacía vacía → se habrían re-notificado de golpe los M≥3.5 de las últimas 6h (mismo caso si
  se pierde el `.ndb`).
- **El aviso de sismo lleva la HORA** (`sismo_hora_txt` + `ve_civil`, `src/push.nx`): cuerpo
  "Hoy a las 14:35" (o "15/07 a las 23:00" si no es del mismo día). **ABSOLUTA y no relativa**
  ("hace 3 min") a propósito: el payload se cifra UNA vez al enviarlo pero el push service lo
  retiene hasta 30 min si el teléfono está sin red — un "hace 3 min" entregado 25 minutos
  después MIENTE. **Única hora del proyecto derivada SERVER-SIDE**, con offset FIJO UTC-4: el
  aviso se arma sin saber la zona del receptor (el resto del sitio la deriva en el cliente con
  `js_tz_offset_min`; ver la regla "Tiempos en hora LOCAL"). Venezuela no tiene horario de
  verano, así que -4 vale todo el año. **Al tocarlo: `./tests/hora-check.sh`** (extrae las
  funciones del propio `src/push.nx` y las compila; cubre los cruces de día/año, que es donde
  este tipo de código se rompe).
- **TTL por tema** (`topic_ttl`, `src/push.nx`): cuánto retiene el push service el aviso si el
  teléfono está SIN RED — sismos **30 min**, tasas **6 h**, chat **1 h** (`webpush_send` acepta
  `ttl` desde 2026-07-16; antes era fijo en 24 h y un móvil apagado recibía al reconectar la
  tanda entera de avisos viejos como si fueran de ahora). `topic_ttl` acepta el tema y también
  el tag por evento (`sismo-<id>`).
- **`tag` = qué reemplaza a qué**: dos notificaciones con el mismo tag NO se apilan, la nueva
  sustituye a la vieja. Tasas/chat mandan el **tema** (solo interesa el último valor); sismos manda
  **`sismo-<id>`, uno por evento** — con el tag fijo `"sismos"` un lote colapsaba en UNA sola
  notificación y encima sobrevivía la del sismo **más flojo** (se emitía de nuevo a viejo, y la
  última entregada gana). El SW pasa **`renotify: true`**: sin él un reemplazo entra MUDO (no suena
  ni vibra) y un M6.0 podía sustituir a un aviso no leído sin avisar. Se emite de viejo→nuevo para
  que el más reciente quede arriba en la pila.
- **Cliente = JS suelto en `src/layout.nx`** (la pasarela wasm NO expone `pushManager`/`serviceWorker.
  ready`): widget `#push-box` **GLOBAL en el pie** (`<footer>` de `page_v`, todas las páginas
  full_chrome; NO en la Calculadora), revelado solo si el navegador soporta push. Botón `#push-btn`
  "Activar" + desplegable de temas (`#push-topics-btn` → `#push-topics`, checkboxes sismos/tasas/chat) →
  permiso + `pushManager.subscribe({applicationServerKey})` + POST. El SW (`static/sw.js`) tiene `push`
  + `notificationclick`. **iOS: 16.4+ y PWA instalada** (no pestaña Safari).
- **Verificar sin esperar un sismo**: `/admin` → "Enviar prueba" (POST /admin/push, CSRF) →
  `push_send_test_async(tema,…)` (hilo aparte: los envíos van en serie con hasta ~10s por endpoint
  colgado; dentro del request daban 502 del gateway → reintento → duplicados). La URL de destino
  la elige el worker según el tema (/sismos, /finanzas, /chat). También muestra el nº de suscripciones
  y el **resultado de la última prueba** (`push_test_summary`, meta `push_test_result`): el hilo
  persiste `ok/expiradas/errores + último código` porque el POST ya redirigió cuando terminan los
  envíos. Antes solo se contaban INTENTOS → 40 envíos correctos y 40 rechazos 403 (clave VAPID mala)
  se veían idénticos, y la única herramienta de diagnóstico no diagnosticaba nada.
- **Desmarcar TODOS los temas = baja**: en `push_subscribe` el `DELETE` va PRIMERO e incondicional.
  Antes el `return "Sin temas"` iba ANTES del DELETE → la fila vieja sobrevivía y **los avisos
  seguían llegando**; encima el cliente lo llama con `silent=true`, así que no se veía ningún error.
- **GOTCHAS que costaron** (ver memoria): `string_to_int`/`string_to_float` **abortan el proceso**
  con CUALQUIER entrada no numérica, `""` incluido (usar `to_int0`/`to_float0` de `src/num.nx` —
  el viejo `to_int0` de este archivo NO validaba y abortaba igual); leer un int de un Array NATIVO
  como String = **SEGV** (el registro de sismos: `rec[8]` epoch es int); `pub` es palabra reservada
  (no usar de nombre de var).

## Pendientes / ideas (backlog)

Sin prioridad estricta; tomar lo que aporte.

- [ ] **Tarjeta "más fuerte" con respaldo a 7 días**: si no hay sismos en 24 h,
      mostrar el más fuerte reciente; resaltar siempre cualquier M ≥ 6.
- [x] **Refresco de `style.css` al cambiar** — HECHO vía **versionado `?v=N`** (en
      `src/layout.nx` + shell del SW); al tocar CSS, subir ese `?v=` (y el `veninfo-vN` del SW).
- [ ] **Baquiano — expansión**: Places API embebida (reseñas/hoteles de pago, requiere clave
      Google + facturación); mapa Leaflet por zona; import no destructivo por defecto;
      contenido más profundo / completar directorio.
- [ ] **nyx-kv perdió datos bajo GC OOM** (incidente 2026-07-12, ver memoria
      `nyx-language-gotchas.md`): es del daemon (monorepo). Mitigado con el botón "Restaurar"
      de Baquiano; el arreglo real va en NyxLang.
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
- [x] **Web Push real (app cerrada)** — HECHO 2026-07-14: el monorepo entregó la cripto
      (`std/webpush` + `std/webpushcrypto`) y se implementó en `src/push.nx` (VAPID + RFC 8291,
      avisos de sismos M≥3.5 / tasa BCV / chat coalescido; suscripción por temas; SW con push +
      notificationclick; "Enviar prueba" en /admin). Ver sección **Notificaciones Web Push** arriba.
- [ ] **Umbral de sismos configurable desde /admin** (hoy const `PUSH_MAG_MIN`). (El payload de la
      tasa BCV ya se afinó: `tasa_2dec` en src/push.nx muestra 2 decimales con coma, 2026-07-15.)
- [ ] **Notification API local en foco** (badge con pestaña oculta cuando el WS empuja) — opcional,
      complementa el push (que es para la app cerrada).
- [ ] **`notificationclick` enfoca sin navegar** (`static/sw.js`): si ya hay una pestaña abierta en
      `/sismos`, la enfoca pero NO la recarga → el usuario ve la lista vieja, sin el sismo del aviso.
      Falta `.navigate(u)` antes del `focus()` (detectado 2026-07-16, fuera del alcance de ese cambio).
- [x] **TTL del push** — HECHO 2026-07-16: el monorepo hizo `webpush_send` configurable por llamada
      y `src/push.nx` manda **TTL por tema** (`topic_ttl`): sismos 30 min, tasas 6 h, chat 1 h. Antes
      era fijo en 24 h → un teléfono apagado recibía al reconectar la tanda de avisos viejos como si
      fueran de ahora (y ninguno lleva la hora en el texto).
- [ ] **Caja de `quake_in_region` muy generosa** (`src/sismos.nx`): el rectángulo lat 0.5..12.9 /
      lon -73.6..-60.5 incluye oriente colombiano, Guyana entera y norte de Brasil — un sismo a
      ~1000 km de Venezuela entra en "Sismos recientes en Venezuela". Y el `minmag=2.5` del fetch no
      cuadra con el "magnitud ≥ 2" del lede de `/sismos`.
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
**Sismos: FUNVISIS + EMSC** (inclusión por geografía, no por nombre; ver sección Sismos).
**Baquiano → guía turística de los 24 estados** (nyx-kv, editable en admin, seed
`content/baquiano-seed.txt`) con **imágenes de Wikipedia** (fetch por zona, override manual)
y **hoteles/reseñas por enlaces a Google Maps**; import no destructivo + botón "Restaurar".
**Tasas BCV DIRECTAS** (`src/bcv.nx` raspa bcv.org.ve) con **fecha valor** → la calculadora
muestra Hoy y, cuando BCV publica ~4pm, **Mañana** (toggle); front vía `/api/rates`; respaldo
DolarAPI. **Calculadora: datos de pago** (pago móvil/transferencia) en localStorage,
incluibles al compartir. **PWA en iOS**: botón "Instalar app" + hint "Compartir → Añadir a
inicio" (solo Safari). `style.css` **versionado** (`?v=N`, cache-busting).

## Verificación rápida
```bash
NYX_HOME=/home/admin/NyxLang nyx build && sudo systemctl restart nyx-venezuelainfo
for p in / /clima /sismos /api/health; do curl -s -o /dev/null -w "$p %{http_code}\n" localhost:3010$p; done
```
(Probar contra :3010 evita la caché del gateway.)
