# Rediseño de la calculadora de /finanzas (Enfoque A)

Fecha: 2026-07-02

> **Nota:** algunas decisiones se tomaron con el usuario ausente y están marcadas
> como *(ajustable)*: la lista de 4 monedas, los 3 chips y el texto de compartir.

## Problema

La calculadora actual (una sola `.calc-row` con `flex-wrap`: `[monto] [origen] ⇄ [destino]`
y resultado suelto abajo) tiene flacos reales:

1. **Layout apretado**: en móvil el input de monto, los dos `<select>` y el botón
   redondo envuelven en cualquier orden → se pierde la relación "de → a".
2. **Unidireccional**: solo se puede escribir en el monto (origen).
3. **Sin accesos rápidos** ni forma de **compartir** una conversión.
4. **Demasiadas monedas** (8, con paralelo/COP/BTC/ETH) para el uso real.

> El **formato ya es local** (`fmt_f` agrupa miles con `.` y coma decimal vía
> `group_miles`; `fmt_money` produce `36.500,50 Bs`). **No se toca.**

## Solución — Convertidor de dos paneles, bidireccional, con chips y compartir

```
┌──────────────────────────────────────┐
│ Calculadora                 [⤴ Compartir] │
│ ┌──────────────────────────────────┐ │
│ │ 1                 [Dólar (USD) ▾]│ │  ← campo ORIGEN (editable)
│ └──────────────────────────────────┘ │
│                 ( ⇅ )                 │  ← intercambiar (vertical)
│ ┌──────────────────────────────────┐ │
│ │ 36.500,50      [Bs · BCV ▾]      │ │  ← campo DESTINO (editable)
│ └──────────────────────────────────┘ │
│ 1 Dólar (USD) = 36.500,50 Bs · BCV   │  ← línea de tasa + fuente
│ [Dólar→Bs] [Dólar→USDT] [Dólar→Euro] │  ← accesos rápidos
└──────────────────────────────────────┘
```

Cada panel = un `<input type=number>` + su `<select>` de moneda, apilados en
vertical. El botón ⇅ va centrado entre ambos. Debajo, la línea de tasa y una fila
de chips. Arriba a la derecha, el botón **Compartir**.

### Monedas *(ajustable)*

Reducidas de 8 a **4**: **USD (dólar), Bs (BCV), USDT, Euro**. Se quitan
**Bs paralelo, COP, BTC y ETH** del selector de la calculadora. Mismo pivote USD,
misma `usd_per` reutilizada (las ramas de las monedas quitadas quedan sin uso;
opcionalmente se podan). Las secciones **Divisas / Cripto** de la página siguen
mostrando lo suyo — solo cambia la calculadora; los `js_fetch` de `fx_boot` no se
tocan (BCV = dólares, Euro, USDT = criptoya; el de COP puede quedarse para Divisas).

### Bidireccional

- Escribir en cualquiera de los dos inputs recalcula el otro. Sin bucle de eventos
  porque `js_set_value` fija `.value` **sin** disparar `input` (ya se explota así
  en `calc_swap`).
- **Estado `calc_active`** (módulo, 0 = origen / 1 = destino): recuerda cuál input
  fue el último editado, para saber qué lado es la fuente cuando cambia una moneda,
  llegan tasas nuevas o se pulsa un chip.

### Chips *(ajustable)*

Tres accesos rápidos: `Dólar→Bs (BCV)`, `Dólar→USDT`, `Dólar→Euro`. Cada chip fija
ambos `<select>` (origen=USD, destino=la moneda del chip) y recalcula manteniendo
el monto del lado activo. El usuario ve los selectores actualizarse → transparente.

### Compartir *(ajustable)*

Botón **Compartir** en la tarjeta que difunde la conversión actual e invita a usar
la calculadora. Reusa el patrón del botón del header (`src/layout.nx`): **Web Share
API** con **respaldo a copiar al portapapeles**.

- El texto lo arma el **wasm** desde el estado (todo el cómputo en Nyx) y lo pasa a
  una nueva capacidad de la pasarela `js_share(text, url)`.
- Texto por defecto: `1 Dólar (USD) = 36.500,50 Bs (BCV) · Calcula tú también en`
  seguido de la URL. `url = location.origin + "/finanzas"`.
- `js_share`: si existe `navigator.share` → `navigator.share({text, url})`; si no →
  `navigator.clipboard.writeText(text + " " + url)` con respaldo a `execCommand` /
  `prompt` (misma cadena de fallbacks que layout.nx). Feedback "¡Copiado!".
- **Enlace que precarga la conversión** (deep-link `#usd-bsv-100` leído client-side):
  fuera de alcance por ahora, anotado como mejora opcional.

## Comportamiento (flujos)

| Evento                     | Qué hace                                                            |
|----------------------------|--------------------------------------------------------------------|
| `input` en origen          | `calc_active=0`; destino = origen·usd_per(src)/usd_per(dst); escribe destino |
| `input` en destino         | `calc_active=1`; origen = destino·usd_per(dst)/usd_per(src); escribe origen  |
| `change` en cualquier `<select>` | recalcula desde el lado `calc_active`                        |
| clic en ⇅                  | intercambia monedas **y** valores de ambos inputs; recalcula desde `calc_active` |
| clic en chip               | origen=USD, destino=moneda del chip; mantiene el monto activo; recalcula |
| clic en Compartir          | arma texto desde el estado y llama `js_share(text, url)`            |
| llega respuesta de tasa    | `calc_render()` recalcula desde el lado `calc_active` (idempotente) |
| falta la tasa base         | placeholder "Esperando tasas…" en la línea de tasa; inputs sin recálculo |

## Componentes / archivos

- **`src/main.nx`** (`handle_finanzas`, `cur_options`): markup nuevo — dos paneles
  (input+select), ⇅ vertical, línea de tasa, fila de chips, botón Compartir.
  `cur_options` reducido a 4 monedas. Ids: `#calc-amt`, `#calc-from`,
  `#calc-to-amt` (**nuevo**), `#calc-to`, `#calc-swap`, `#calc-rate`,
  `#calc-share`, chips `#calc-chip-bsv` / `#calc-chip-usdt` / `#calc-chip-eur`.
- **`static/assets/nyx-loader.js`**: nueva capacidad de la pasarela
  `js_share(text, url)` (Web Share API + fallback a portapapeles). Bump `?v=N`.
- **`wasm/veninfo.nx`**:
  - Estado `calc_active: int`; extern `js_share`.
  - `calc_render()` recalcula el lado NO activo a partir del activo.
  - Exports: `calc_from_src`, `calc_from_dst`, `calc_swap` (amplia: intercambia
    valores), `calc_chip_bsv` / `calc_chip_usdt` / `calc_chip_eur`, `calc_share`.
  - Línea de tasa con fuente nombrada (reutiliza `cur_name` + sufijo BCV).
  - `fx_boot(1)` registra los nuevos `dom_on`.
- **`static/assets/style.css`**: rediseño `.calc-*` (paneles apilados, ⇅ vertical,
  `.calc-chip`, `.calc-share`). Bump `veninfo-vN` en `static/sw.js`.
- **`wasm/tests/imports.mjs`**: casos nuevos — cálculo inverso (escribir en
  destino), un chip, swap que intercambia valores, y que `calc_share` invoque
  `js_share` con el texto esperado (mock).

## Fuera de alcance (YAGNI)

- No se cambian las secciones Divisas / Cripto / Bolsa.
- Deep-link que precarga la conversión: mejora opcional, no ahora.
- No historial ni gráficas de tasa.

## Riesgos / gotchas

- **Frontera JS↔wasm**: floats como String; usar `dom_get_value` +
  `string_to_float` y salidas ya formateadas (regla de CLAUDE.md).
- **`js_share` es capacidad nueva de la pasarela**: seguir el patrón
  callback-por-nombre / firmas solo-String; probarla con mock en la suite headless.
- **Leak-by-design del wasm**: la calculadora se dispara por eventos discretos
  (input/change/click), no en bucles → OK.
- **Bumps de versión** al desplegar: `?v=N` (loader + wasm en `nyx-loader.js` y
  `src/main.nx`) y `veninfo-vN` en `sw.js` (procedimiento de CLAUDE.md). Como se
  toca `nyx-loader.js`, `style.css` y `sw.js`, el bump es obligatorio.

## Verificación

1. Suite headless: `node NyxLang/examples/browser/run-node.mjs static/assets/veninfo.wasm wasm/tests/imports.mjs` (verde).
2. `strings venezuelainfo-org | grep -q sismos` tras `nyx build` (carrera del scratch).
3. Manual en `/finanzas`: escribir en ambos lados, cambiar monedas, ⇅, los 3 chips,
   Compartir (móvil con Web Share y escritorio con copiar), estado sin tasas,
   móvil (sin wrap raro), dark mode.
