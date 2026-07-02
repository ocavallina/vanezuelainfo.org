# Rediseño de la calculadora de /finanzas (Enfoque A)

Fecha: 2026-07-02

## Problema

La calculadora actual (una sola `.calc-row` con `flex-wrap`: `[monto] [origen] ⇄ [destino]`
y resultado suelto abajo) tiene tres flacos reales:

1. **Layout apretado**: en móvil el input de monto, los dos `<select>` y el botón
   redondo envuelven en cualquier orden → se pierde la relación "de → a".
2. **Unidireccional**: solo se puede escribir en el monto (origen).
3. **Sin accesos rápidos**: las conversiones más pedidas (Dólar↔Bs, USDT→Bs)
   exigen tocar los dos selectores cada vez.

> Nota: el **formato ya es local** (`fmt_f` agrupa miles con `.` y usa coma decimal
> vía `group_miles`; `fmt_money` produce `36.500,50 Bs`). **No se toca.**

## Solución — Convertidor de dos paneles, bidireccional, con chips

```
┌──────────────────────────────────────┐
│ Calculadora                          │
│ ┌──────────────────────────────────┐ │
│ │ 1                 [Dólar (USD) ▾]│ │  ← campo ORIGEN (editable)
│ └──────────────────────────────────┘ │
│                 ( ⇅ )                 │  ← intercambiar (vertical)
│ ┌──────────────────────────────────┐ │
│ │ 36.500,50      [Bs · BCV ▾]      │ │  ← campo DESTINO (editable)
│ └──────────────────────────────────┘ │
│ 1 Dólar (USD) = 36.500,50 Bs · BCV   │  ← línea de tasa + fuente
│ [Dólar→Bs] [Bs→Dólar] [USDT→Bs]      │  ← accesos rápidos
└──────────────────────────────────────┘
```

Cada panel = un `<input type=number>` + su `<select>` de moneda, apilados en
vertical. El botón ⇅ va centrado entre ambos. Debajo, la línea de tasa y una fila
de chips.

### Decisiones fijadas

- **Bidireccional**: escribir en cualquiera de los dos inputs recalcula el otro.
  Sin bucle de eventos porque `js_set_value` fija `.value` **sin** disparar `input`
  (ya se explota así en el `calc_swap` actual).
- **Estado `calc_active`** (módulo, 0 = origen / 1 = destino): recuerda cuál input
  fue el último editado, para saber qué lado es la fuente cuando cambia una moneda
  o llegan tasas nuevas.
- **Chips** (3): `Dólar→Bs`, `Bs→Dólar`, `USDT→Bs`. El "Bs" de los chips =
  **paralelo (BSP)** (tasa de calle, la más usada para precios). Cada chip fija
  ambos `<select>` (el usuario ve cuál Bs quedó → transparente). BCV sigue
  disponible manualmente en el selector.
- **Defaults al cargar**: origen USD, destino BSP (paralelo), monto 1 — como hoy.
- **Línea de tasa**: `1 <origen> = <tasa> <destino>` nombrando la fuente del Bs
  cuando alguno de los dos es un Bs (`BCV oficial` / `paralelo`).
- **Formato**: sin cambios (ya localizado).
- **Monedas**: las mismas 8 (USD, BSV, BSP, EUR, COP, USDT, BTC, ETH), mismo
  pivote USD, misma `usd_per` reutilizada tal cual.

## Comportamiento (flujos)

| Evento                     | Qué hace                                                            |
|----------------------------|--------------------------------------------------------------------|
| `input` en origen          | `calc_active=0`; calcula destino = origen·usd_per(src)/usd_per(dst); escribe destino |
| `input` en destino         | `calc_active=1`; calcula origen = destino·usd_per(dst)/usd_per(src); escribe origen  |
| `change` en cualquier `<select>` | recalcula desde el lado `calc_active`                        |
| clic en ⇅                  | intercambia monedas **y** valores de ambos inputs; recalcula desde `calc_active` |
| clic en chip               | fija ambos `<select>`; mantiene el monto del lado `calc_active`; recalcula |
| llega respuesta de tasa    | `calc_render()` recalcula desde el lado `calc_active` (idempotente) |
| falta la tasa base         | ambos lados muestran vacío / placeholder "Esperando tasas…" bajo la línea de tasa |

## Componentes / archivos

- **`src/main.nx`** (`handle_finanzas`, `cur_options`): markup nuevo de la tarjeta
  — dos paneles (input+select), botón ⇅ vertical, contenedor de tasa, fila de chips.
  Ids: `#calc-amt` (origen), `#calc-from`, `#calc-to-amt` (destino, **nuevo**),
  `#calc-to`, `#calc-swap`, `#calc-rate`, chips `#calc-chip-*`.
- **`wasm/veninfo.nx`**:
  - Estado `calc_active: int`.
  - `calc_render()` → recalcula el lado NO activo a partir del activo.
  - Nuevos exports para los handlers: `calc_from_src` (input origen),
    `calc_from_dst` (input destino), `calc_swap` (ampliado: intercambia valores),
    `calc_chip_usdbs` / `calc_chip_bsusd` / `calc_chip_usdtbs`.
  - Línea de tasa con fuente nombrada (reutiliza `cur_name`; añade sufijo fuente).
  - `fx_boot(1)` registra los nuevos `dom_on`.
- **`static/assets/style.css`**: rediseño de `.calc-*` (paneles apilados, ⇅
  vertical, `.calc-chip`). Bump `veninfo-vN` en `static/sw.js`.
- **`wasm/tests/imports.mjs`**: casos nuevos — cálculo inverso (escribir en
  destino), un chip, y que el swap intercambie valores.

## Fuera de alcance (YAGNI)

- No se cambian las secciones Divisas / Cripto / Bolsa.
- No se añaden monedas nuevas ni se toca `usd_per` / `fmt_money`.
- No historial ni gráficas de tasa.

## Riesgos / gotchas

- **Frontera JS↔wasm**: floats van como String; seguir usando `dom_get_value` +
  `string_to_float` y salidas ya formateadas (regla de CLAUDE.md).
- **Leak-by-design del wasm**: la calculadora se dispara por eventos discretos
  (input/change/click), no en bucles → sin renders en loop. OK.
- **Markup duplicado**: no aplica aquí (la calculadora no comparte markup con el
  servidor como sí lo hacen las filas de sismos).
- Recordar el **bump de versión** `?v=N` (loader + wasm en `nyx-loader.js` y
  `src/main.nx`) y `veninfo-vN` en `sw.js` al desplegar (procedimiento de CLAUDE.md).

## Verificación

1. Suite headless: `node NyxLang/examples/browser/run-node.mjs static/assets/veninfo.wasm wasm/tests/imports.mjs` (verde).
2. `strings venezuelainfo-org | grep -q sismos` tras `nyx build` (carrera del scratch).
3. Manual en `/finanzas`: escribir en ambos lados, cambiar monedas, ⇅, los 3 chips,
   estado sin tasas, móvil (sin wrap raro), dark mode.
