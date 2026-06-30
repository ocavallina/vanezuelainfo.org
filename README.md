# venezuelainfo.org

Portal de noticias e información sobre Venezuela, con una sección especial de
**sismos en vivo** (datos del USGS). Escrito enteramente en **Nyx**, consumiendo
la librería `nyx-serve`.

Proyecto independiente: vive fuera de `NyxLang/` y usa `NYX_HOME` para encontrar
el compilador, runtime y stdlib (mismo patrón que `nyx-kv-stack`).

## Estructura

```
venezuelainfo.org/
├── nyx.toml              # paquete (main = src/main.nx; dep: nyx-serve)
├── src/
│   ├── main.nx           # entry point: rutas + arranque del servidor
│   ├── layout.nx         # plantilla HTML compartida (header/footer, tema bandera)
│   ├── articles.nx       # carga de artículos + render de portada y artículo
│   ├── md.nx             # renderizador Markdown -> HTML mínimo
│   └── sismos.nx         # cliente USGS (FDSN text) + caché + tabla de sismos
├── content/
│   ├── index.txt         # un slug por línea (lista de artículos publicados)
│   └── articles/*.md     # artículos en Markdown con front-matter
├── static/assets/style.css
└── packages/nyx-serve/   # nyx-serve vendoreado
```

## Compilar y ejecutar

```bash
cd venezuelainfo.org
NYX_HOME=/home/admin/NyxLang nyx build          # produce ./venezuelainfo-org
PORT=3010 ./venezuelainfo-org                   # arranca el servidor (bloqueante)
```

Rutas:

| Ruta                 | Descripción                                  |
|----------------------|----------------------------------------------|
| `GET /`              | Portada: lista de artículos (orden por fecha)|
| `GET /articulo/{slug}` | Artículo renderizado desde su `.md`        |
| `GET /sismos`        | Tabla de sismos recientes (USGS, en vivo)    |
| `GET /api/health`    | `{"status":"ok"}`                            |
| `GET /assets/*`      | Archivos estáticos (CSS, imágenes)           |

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

`src/sismos.nx` consulta la API pública del USGS (FDSN, `format=text`) acotada al
bounding box de Venezuela (lat 0..13, lon -74..-59), magnitud ≥ 2.5. Usa el
builtin `https_get` (TLS) y cachea el resultado en memoria 5 minutos.

Se usa `format=text` (delimitado por `|`) en lugar de GeoJSON a propósito: el
parser de `std/json` solo lee enteros y truncaría los floats (magnitud,
coordenadas) del GeoJSON.

## Despliegue (producción)

1. Servicio systemd con `Environment=PORT=3010` (espejo de los `deploy/*.service`
   de los sitios de NyxLang) y `WorkingDirectory` en esta carpeta.
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

`packages/nyx-serve/src/server.nx` se editó para que su import interno use la
ruta calificada `import "nyx-serve/src/files"` (en vez de `import "src/files"`),
porque el resolver del build actual (nyx v0.16.1) no resuelve imports internos
relativos de un paquete vendoreado.
