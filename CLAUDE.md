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
- **El "front" (interactividad) es JavaScript escrito como STRINGS dentro del
  Nyx** (en `src/main.nx`), que el servidor emite al navegador. Nyx NO corre en
  el navegador. Además: `static/sw.js` (service worker real) y `static/assets/style.css`.
- Librerías client-side por CDN: **Leaflet** (mapas). APIs client-side:
  **Open-Meteo** (clima/geocoding/calidad del aire), **Geolocation**, **localStorage**.

### Mapa de archivos
```
src/main.nx      Entry + rutas + handlers. AQUÍ vive casi todo el "front" (JS en strings):
                 weather_card(), handle_clima(), handle_sismos(), handle_quake_detail().
src/layout.nx    Shell HTML (head, header, footer). page() y page_fixed() (zoom bloqueado),
                 metas PWA, registro del service worker.
src/articles.nx  Portada + render de artículos (server-side desde content/).
src/md.nx        Renderizador Markdown→HTML propio + html_escape.
src/sismos.nx    Cliente EMSC (https_get), parser FDSN text, caché, tabla HTML con data-*.
src/kv.nx        Cliente mínimo RESP2+TLS para nyx-kv (tls_* builtins). Conexión corta por request.
                 Helpers kv_get/set/setex/del/exists/incr/expire/rpush/ltrim/lrange sobre kv_cmd.
src/chat.nx      Chat colectivo CON SALAS: valida/sanea/filtra, guarda/lee por sala en nyx-kv.
                 Parseo de body a mano. Solo el admin crea/borra salas. form_field es pub.
src/baquiano.nx  "Baquiano": guía de sitios por zona (estado/región). Contenido en nyx-kv,
                 editable desde el panel admin. render_baquiano_index/zone() + baquiano_card().
src/admin.nx     Panel admin (/admin): login único de dueño, sesión por cookie + CSRF. CRUD de
                 baquiano y salas + moderación. Handlers propios de Response (no usa los de main).
content/         index.txt (slugs) + articles/*.md (front-matter + cuerpo).
static/          assets/style.css, sw.js, manifest.webmanifest, icon.svg/png.
deploy/          nyx-venezuelainfo.service + admin.conf.example (drop-in del secreto admin).
packages/        nyx-serve vendoreado.
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
  cachean en el gateway (~60s). **Al tocar `style.css` o el JS de `sw.js`, subir
  la versión `veninfo-vN` en `static/sw.js`** para invalidar la caché de las PWA.
- **Tiempos en hora LOCAL**: el servidor manda ISO UTC en `data-iso`; el navegador
  formatea a local (helpers `locPair`/`locStr` en el JS de sismos). No mostrar UTC.
- **Zoom bloqueado**: todas las páginas usan `page_fixed` (`user-scalable=no`).

## Sismos (src/sismos.nx)

- Fuente: **EMSC** (`www.seismicportal.eu`), formato **FDSN text** (delimitado por
  `|`). NO usar USGS (bloqueado/interceptado desde este host) ni GeoJSON (el
  parser de `std/json` trunca floats). Bounding box Venezuela, `limit=200`.
- Columnas FDSN: 0 EventID, 1 Time, 2 Lat, 3 Lon, 4 Depth, 9 MagType, 10 Mag, 12 Lugar.
- Caché del cuerpo crudo en memoria (TTL 5 min, `sismos_ts()`).
- Lista: paginación (perPage=12), filtros (magnitud/distancia/lugar) tras icono,
  **selector de orden** (fecha/distancia/magnitud), geolocalización automática
  persistente, detalle desplegable inline, tarjeta "más fuerte 24 h".
- `/sismos/{id}` = página de detalle con mapa grande (Leaflet + gesture-handling).

## Clima (src/main.nx)

- `weather_card()` = resumen (enlaza a `/clima`). `handle_clima()` = landing
  completa: buscador de cualquier ciudad (geocoding), "Mi ubicación", actual
  completo, próximas horas, 7 días, UV, amanecer/atardecer, calidad del aire.
- Todo client-side con **Open-Meteo** (sin API key, CORS). Ciudad elegida en
  localStorage (`w_lat`/`w_lon`/`w_name`), compartida con la tarjeta.

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
- **Tiempo real: NO** (el gateway no hace upgrade WebSocket). Es **polling**: el
  cliente pide `GET /api/chat` cada 3 s. Render con `textContent` (anti-XSS).
- **Moderación**: escape/saneo, topes (nick 24 / texto 280), filtro de groserías,
  cupo de ritmo **por sala** (`INCR chat:rl:<id>`+`EXPIRE 10`, ~25/10s). Vaciar/borrar
  salas se hace desde el **panel admin** (`/admin/salas`). El antiguo
  `POST /api/chat/clear` + `CHAT_ADMIN_KEY` fue **eliminado** (lo reemplaza el panel).
- **Body POST parseado a mano** (`form_field` + `nyx_url_decode` extern) para
  esquivar el bug de `req.form`/`req.query`. std/web `url_decode` NO decodifica `%XX`.
- **Gotcha ops**: al probar con `./venezuelainfo-org &` en background, el binario
  queda **detached** y retiene el puerto → el systemd entra en bucle "cannot listen".
  Matar strays con `sudo pkill -9 -f venezuelainfo-org` antes de reiniciar el servicio.

## Baquiano (src/baquiano.nx + panel admin)

- Guía de sitios de Venezuela **por zona** (estados/regiones). Tarjeta reordenable
  en la portada (`data-key="baquiano"`), páginas `/baquiano` (índice de zonas) y
  `/baquiano/{zona}` (sitios de la zona, con `req.params`, nunca `req.query`).
- **Contenido en nyx-kv** (namespace `veninfo::`, sin TTL): `baq:zones` (lista de
  ids), `baq:zone:<id>` (nombre), `baq:zone:<id>:sites` (lista `nombre|categoria|
  descripcion`, saneados sin `|`). Ids validados con `is_valid_slug` (pub en articles).
- Se **crea/edita/borra desde el panel admin** (`/admin/baquiano`).

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

`/` · `/clima` · `/finanzas` · `/noticias` · `/chat` · `/baquiano` · `/baquiano/{zona}`
· `/sismos` · `/sismos/{id}` · `/articulo/{slug}` · `/api/health` · `/api/rooms`
· `/api/chat` · `/api/chat/{room}` · `POST /api/chat/send` · `/admin` ·
`POST /admin/login` · `POST /admin/logout` · `/admin/baquiano` (+POST) ·
`/admin/salas` (+POST) · `/manifest.webmanifest` · `/sw.js` · `/icon*.png|svg` · `/assets/*`

## Pendientes / ideas (backlog)

Sin prioridad estricta; tomar lo que aporte.

- [ ] **Indicador en el icono de Filtros** cuando hay filtros activos (punto/badge).
- [ ] **Tarjeta "más fuerte" con respaldo a 7 días**: si no hay sismos en 24 h,
      mostrar el más fuerte reciente; resaltar siempre cualquier M ≥ 6.
- [ ] **`Cache-Control: no-cache` también para `style.css`** (dejar cacheados solo
      iconos/imágenes) para que los cambios de CSS se vean al instante por el dominio.
- [ ] **Círculo de precisión "tú estás aquí"** en los mapas (accuracy de geo).
- [ ] **nyxkv (opcional, dogfooding)**: caché compartido del feed EMSC
      (`SETEX sismos:emsc:body 300 …`) y/o contadores de vistas (`INCR`). Patrón de
      cliente en `nyx-kv-stack/dashboard/src/kv_client.nx`. Decisión actual: NO
      (las prefs de UI van en localStorage; nyxkv solo para estado de servidor).
- [ ] **Front en Nyx→WASM** (a futuro): hoy el JS está escrito a mano como strings.
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
Bugs del lenguaje hallados → anotados en `NyxLang/TASKS.md`.

## Verificación rápida
```bash
NYX_HOME=/home/admin/NyxLang nyx build && sudo systemctl restart nyx-venezuelainfo
for p in / /clima /sismos /api/health; do curl -s -o /dev/null -w "$p %{http_code}\n" localhost:3010$p; done
```
(Probar contra :3010 evita la caché del gateway.)
