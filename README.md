<p align="center">
  <img src="docs/banner.svg" alt="VenezuelaInfo" width="820">
</p>

<p align="center">
  <a href="https://venezuelainfo.org"><b>venezuelainfo.org</b></a> &nbsp;·&nbsp;
  Hecho en <a href="https://nyxlang.com">Nyx</a>
</p>

Portal de noticias e información sobre Venezuela: **sismos en vivo**, clima,
finanzas, noticias agregadas, guía de sitios por zona y **chat colectivo en
tiempo real**. Aplicación web instalable (PWA).

---

> ## ⚡ Full-stack en Nyx, de punta a punta
>
> Lo interesante de VenezuelaInfo no es solo lo que hace, sino **con qué está
> hecho**: **cada capa del stack está escrita en [Nyx](https://nyxlang.com)**.
> No hay nginx, ni un framework web de otro lenguaje, ni JavaScript de aplicación,
> ni una base de datos de terceros.
>
> | Capa | En un stack típico | Aquí |
> |------|--------------------|------|
> | **Proxy / TLS** | nginx | **nyx-proxy** — el reverse proxy escrito en Nyx |
> | **Servidor web** | Express, Rails, … | **nyx-serve** — el framework web escrito en Nyx |
> | **Front-end** | React / JavaScript | **Nyx compilado a WebAssembly** |
> | **Base de datos** | Redis / Postgres | **nyx-kv** — la base de datos escrita en Nyx |
>
> Un request **entra** por un proxy Nyx, lo **atiende y renderiza** un servidor Nyx,
> se **hidrata** en el navegador con **Nyx compilado a WASM**, habla con las APIs
> externas desde Nyx y **persiste** en una base de datos Nyx.

---

## Qué ofrece

- 🌎 **Sismos en vivo** — actividad sísmica de Venezuela con filtros, orden, mapa y hora local.
- ⛅ **Clima** — pronóstico completo de cualquier ciudad, con geolocalización.
- 💱 **Finanzas** — tipos de cambio (Dólar BCV, Euro BCV, Binance), cripto y Bolsa de Caracas, con calculadora.
- 📰 **Noticias** — titulares agregados de medios venezolanos.
- 🧭 **Baquiano** — guía de sitios de interés por estado y región.
- 💬 **Chat** — conversación colectiva con salas, en tiempo real.

Todo servido como **PWA instalable**, con tema claro/oscuro y pensado para móvil.

<p align="center">
  🔗 <a href="https://venezuelainfo.org"><b>venezuelainfo.org</b></a>
  &nbsp;·&nbsp; Construido con <a href="https://nyxlang.com"><b>Nyx</b></a>
</p>
