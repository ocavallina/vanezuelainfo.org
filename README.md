# venezuelainfo.org

Portal de noticias e información sobre Venezuela: **sismos en vivo** (EMSC),
clima, finanzas (BCV/USDT/COP), noticias agregadas, guía de sitios por zona
(Baquiano) y chat colectivo en tiempo real. PWA instalable.

Escrito **enteramente en Nyx**, en ambos lados:

- **Servidor**: binario nativo sobre la librería `nyx-serve` (HTTP, rutas,
  render HTML server-side, cliente HTTPS a APIs externas, WebSocket).
- **Front**: TODO el front dinámico (fetch a las APIs, parseo, cálculo y
  render de finanzas, clima, sismos, rotador y noticias) corre en el navegador
  como **Nyx compilado a WebAssembly** (`wasm/veninfo.nx` → `veninfo.wasm`,
  ~150 KB gzip). El JavaScript restante es una **pasarela** genérica de ~90
  líneas (`nyx-loader.js`: fetch/timers/geolocalización/eventos con callbacks
  por nombre de export) más tres islas bloqueadas por el target: drag&drop de
  la portada (necesita el objeto Event), mapas Leaflet y el chat (WebSocket;
  migrará cuando el target tenga GC).

Proyecto independiente: vive fuera de `NyxLang/` y usa `NYX_HOME` para encontrar
el compilador, runtime y stdlib (mismo patrón que `nyx-kv-stack`).

## Estructura

```
venezuelainfo.org/
├── nyx.toml              # paquete (main = src/main.nx; dep: nyx-serve)
├── src/
│   ├── main.nx           # entry point: rutas + handlers + arranque del servidor
│   ├── layout.nx         # plantilla HTML compartida (PWA, tema bandera, dark mode)
│   ├── articles.nx       # artículos Markdown (portada + detalle)
│   ├── md.nx             # renderizador Markdown -> HTML mínimo
│   ├── sismos.nx         # cliente EMSC (FDSN text) + caché + tabla de sismos
│   ├── news.nx           # agregador RSS de medios venezolanos
│   ├── kv.nx             # cliente RESP2+TLS para nyx-kv (chat/baquiano/admin)
│   ├── chat.nx           # chat colectivo con salas (almacenado en nyx-kv)
│   ├── ws.nx             # WebSocket del chat (push en tiempo real)
│   ├── baquiano.nx       # guía de sitios por zona (contenido en nyx-kv)
│   └── admin.nx          # panel /admin (login de dueño, CSRF, CRUD)
├── wasm/
│   ├── veninfo.nx        # FRONT en Nyx: helpers, finanzas y sismos (→ veninfo.wasm)
│   └── tests/imports.mjs # suite headless del módulo wasm (Node + shim)
├── content/              # index.txt + articles/*.md (artículos en Markdown)
├── static/
│   ├── assets/veninfo.wasm      # módulo wasm compilado (generado)
│   ├── assets/nyx-loader.js     # loader ESM + pasarela (fetch/timers/geo/eventos)
│   ├── assets/nyx-wasi-shim.js  # shim WASI/DOM (copiado del monorepo NyxLang)
│   ├── assets/home.js           # drag&drop de tarjetas (espera Event en wasm)
│   ├── assets/quake.js          # mapa Leaflet del detalle de sismo
│   ├── assets/chat.js           # chat WebSocket (espera GC en wasm)
│   ├── assets/style.css, sw.js  # estilos + service worker (PWA)
│   └── manifest.webmanifest, icon.*
├── deploy/               # unit systemd + drop-in admin + build-wasm.sh
└── packages/nyx-serve/   # nyx-serve vendoreado
```

## Compilar y ejecutar

```bash
cd venezuelainfo.org
NYX_HOME=/home/admin/NyxLang nyx build          # produce ./venezuelainfo-org
PORT=3010 ./venezuelainfo-org                   # arranca el servidor (bloqueante)
```

### Front wasm (solo si se toca `wasm/veninfo.nx`)

```bash
deploy/build-wasm.sh    # make wasm en el monorepo + copia a static/assets/
# probar en headless (mismo shim que el navegador):
node $NYX_HOME/examples/browser/run-node.mjs static/assets/veninfo.wasm wasm/tests/imports.mjs
```

Tras recompilar el wasm hay que subir juntos el `?v=N` de `nyx-loader.js` y
`veninfo.wasm` (en `nyx-loader.js` y `src/main.nx`) y la versión `veninfo-vN`
del service worker (`static/sw.js`).

## Rutas

| Ruta                     | Descripción                                        |
|--------------------------|----------------------------------------------------|
| `GET /`                  | Portada: tarjetas reordenables (clima, finanzas, noticias, baquiano, chat) |
| `GET /clima`             | Pronóstico completo de cualquier ciudad (Open-Meteo) |
| `GET /finanzas`          | Divisas (BCV/USDT P2P/COP), cripto y Bolsa de Caracas |
| `GET /noticias`          | Titulares agregados de medios venezolanos          |
| `GET /sismos`            | Sismos recientes con filtros/orden/paginación (EMSC) |
| `GET /sismos/{id}`       | Detalle de un sismo con mapa (Leaflet)             |
| `GET /baquiano[/{zona}]` | Guía de sitios por estado/región                   |
| `GET /chat` + `WS /ws/chat/{sala}` | Chat colectivo con salas en tiempo real  |
| `GET /articulo/{slug}`   | Artículo renderizado desde su `.md`                |
| `GET /admin`             | Panel del dueño (baquiano + salas de chat)         |
| `GET /api/health`        | Estado del servicio                                |

## Front en Nyx→WASM

`wasm/veninfo.nx` es un módulo único que se compila con el target
`wasm32-wasi` de NyxLang ("Escenario B": FFI `extern "js"`, `#[export_name]`
y `std/dom`). Su `main()` es un router: lee `<input hidden id="pg">` y arranca
los boots de la página. En el navegador hace:

- **Finanzas**: pide DolarAPI/CriptoYa/er-api/CoinGecko él mismo (vía la
  pasarela `js_fetch`), extrae los floats con scanners propios de JSON
  (`std/json` aún trunca floats), calcula promedios/conversiones y arma el HTML.
- **Clima**: tarjeta de portada y página completa (actual, horas, 7 días, AQI),
  buscador de ciudades con geocoding y geolocalización.
- **Sismos**: arranca de un `<textarea id="s-data">` que emite el servidor,
  deriva epoch y hora local con aritmética de calendario propia, y hace
  filtros, orden, paginación, detalle y la tarjeta "más fuerte 24 h".
- **Noticias**: rotador de titulares (clases CSS + `js_interval`) y despliegue
  de detalle. Las fechas "hace X" las pone el servidor en cada request
  (marcador `@REL:` + `rel_fill`, exactas aunque la lista esté cacheada).

Regla de la frontera JS↔wasm: solo cruzan `int` (BigInt) y `String`; los
floats viajan como String. Lo asíncrono (fetch, timers, geolocalización)
re-entra al módulo por **nombre de export** (mismo patrón que `dom_on`).
`static/assets/nyx-loader.js` provee la pasarela y expone `window.nyxReady`.
Si el wasm no carga, cada sección muestra un aviso (sin lógica duplicada en JS).

## Publicar un artículo

1. Crear `content/articles/<slug>.md` con front-matter:

   ```markdown
   ---
   title: Mi titular
   date: 2026-06-29
   summary: Resumen de una línea para la tarjeta de portada.
   ---

   # Mi titular

   Cuerpo en Markdown (encabezados, **negrita**, *cursiva*, listas, enlaces).
   ```

2. Añadir el `<slug>` a `content/index.txt` (un slug por línea).
   Slug válido: solo minúsculas, dígitos y guiones.

No requiere recompilar: los `.md` se leen en cada request.

## Sección de sismos

`src/sismos.nx` consulta la API pública del **EMSC** (seismicportal.eu, FDSN
`format=text`) acotada al bounding box de Venezuela (lat 0..13, lon -74..-59),
magnitud ≥ 3. Usa el builtin `https_get` (TLS) y cachea el resultado en
memoria 5 minutos. Se usa `format=text` (delimitado por `|`) en lugar de
GeoJSON a propósito: el parser de `std/json` solo lee enteros y truncaría los
floats (magnitud, coordenadas).

## Chat y datos persistentes

El chat (salas, mensajes), el Baquiano y las credenciales del panel admin se
guardan en **nyx-kv** (:6380, RESP2+TLS) con un token dedicado de namespace
`veninfo::`. El tiempo real va por WebSocket (`/ws/chat/{sala}`, solo bajada;
el envío es POST) con respaldo de polling.

## Despliegue (producción)

1. Servicio systemd con `Environment=PORT=3010` (ver `deploy/`) y
   `WorkingDirectory` en esta carpeta.
2. Añadir un vhost en `NyxLang/services/gateway/proxy.toml`:

   ```toml
   [upstream.N]
   name = "venezuelainfo"
   hostname = "venezuelainfo.org"
   host = "127.0.0.1"
   port = 3010
   ```

3. Certificado Let's Encrypt para `venezuelainfo.org` y DNS apuntando al gateway.

## Nota de mantenimiento

`packages/nyx-serve/src/server.nx` lleva dos ediciones locales: (1) su import
interno usa la ruta calificada `import "nyx-serve/src/files"` (el resolver no
resuelve imports internos relativos de un paquete vendoreado), y (2) el parche
`serve_ws` que detecta el `Upgrade: websocket` y entrega el fd a un handler
(lo usa el chat). **Al re-vendorear nyx-serve hay que re-aplicar ambos.**
